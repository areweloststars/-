"""Gemma 4 E2B: 파인튜닝한 가중치를 앱이 쓰는 크롬용 모델(MLC q4f16_1)에 넣어요.

앱은 mlc-ai/gemma-4-E2B-it-q4f16_1-MLC(WebLLM 0.2.86)와 그 모델 라이브러리(.wasm)를 써요. 이 판은 MLC 공식 도구가 아닌
개인 판(akaashrp/mlc-llm 42fa855)으로 만들어서, 지금 pip로 받는 mlc_llm(0.26.dev6)으로는 같은 꼴을 만들 수 없어요.
그래서 공식 MLC 파일을 그대로 두고, 파인튜닝으로 바뀐 글 층의 선형 가중치(q/k/v/o, gate_up, down …)만 같은 방법으로
4비트로 다시 눌러 그 자리(같은 shard, 같은 byteOffset)에 덮어써요. 이름·모양·자리가 그대로라 .wasm도 그대로 써요.

눌러 담는 방법 (MLC group quantization q4f16_1, NK): 16비트로 바꾼 가중치를 입력 축 32개씩 묶어
scale = max|w| / 7 (16비트), q = round_half_even(w / scale + 7)을 0~14로 자르고 (나눗셈·덧셈마다 16비트로 반올림),
8개를 uint32 하나에 4비트씩(낮은 자리부터) 넣어요. gate_up_proj = [gate_proj; up_proj] (출력 축으로 이어 붙임).
2026-10-27 바꾸지 않은 원본(google/gemma-4-E2B-it 3e22461)으로 공식 파일과 바이트까지 같은지 확인했어요 (--verify).

쓰는 법
  python mlc_patch.py --hf <원본 또는 합친 모델 폴더 | safetensors 주소> --mlc <공식 MLC 폴더> --verify
  python mlc_patch.py --hf <합친 모델 폴더> --mlc <공식 MLC 폴더> --out <새 폴더>
  --mlc-url: 공식 MLC 파일 주소 (없는 shard를 받아요). 기본은 mlc-ai/gemma-4-E2B-it-q4f16_1-MLC
  --only: 이름에 이 글이 든 가중치만 (예: layers.0.)
필요한 것: Python 3, numpy (그 밖에는 표준 라이브러리)
"""
import argparse
import glob
import hashlib
import json
import os
import shutil
import struct
import sys
import urllib.request

import numpy as np

MLC_URL = "https://huggingface.co/mlc-ai/gemma-4-E2B-it-q4f16_1-MLC/resolve/main/"
# 글 층의 선형 가중치 (MLC 이름 끝 → HF 이름 끝들). 파인튜닝(LoRA)이 바꾸는 것들이에요
LINEARS = {
    "self_attn.q_proj": ["self_attn.q_proj.weight"],
    "self_attn.k_proj": ["self_attn.k_proj.weight"],
    "self_attn.v_proj": ["self_attn.v_proj.weight"],
    "self_attn.o_proj": ["self_attn.o_proj.weight"],
    "mlp.gate_up_proj": ["mlp.gate_proj.weight", "mlp.up_proj.weight"],
    "mlp.down_proj": ["mlp.down_proj.weight"],
}


class SafeTensors:
    """safetensors 파일 하나 이상(폴더) 또는 주소 하나에서 이름으로 텐서를 읽어요 (주소는 필요한 부분만 받아요)"""

    def __init__(self, src):
        self.where = {}
        if src.startswith("http://") or src.startswith("https://"):
            self._add(src, remote=True)
        else:
            files = sorted(glob.glob(os.path.join(src, "*.safetensors"))) if os.path.isdir(src) else [src]
            if not files:
                sys.exit(f"safetensors 파일이 없어요: {src}")
            for f in files:
                self._add(f, remote=False)

    def _read(self, src, remote, start, end):
        if remote:
            req = urllib.request.Request(src, headers={"Range": f"bytes={start}-{end - 1}"})
            with urllib.request.urlopen(req, timeout=600) as r:
                data = r.read()
        else:
            with open(src, "rb") as f:
                f.seek(start)
                data = f.read(end - start)
        if len(data) != end - start:
            raise IOError(f"{src}: {start}-{end} 읽기가 모자라요 ({len(data)})")
        return data

    def _add(self, src, remote):
        n = struct.unpack("<Q", self._read(src, remote, 0, 8))[0]
        head = json.loads(self._read(src, remote, 8, 8 + n))
        head.pop("__metadata__", None)
        for name, info in head.items():
            self.where[name] = (src, remote, 8 + n, info)

    def get(self, name):
        src, remote, base, info = self.where[name]
        o0, o1 = info["data_offsets"]
        data = self._read(src, remote, base + o0, base + o1)
        if info["dtype"] == "BF16":
            u16 = np.frombuffer(data, dtype=np.uint16).reshape(info["shape"])
            return (u16.astype(np.uint32) << 16).view(np.float32)
        if info["dtype"] == "F16":
            return np.frombuffer(data, dtype=np.float16).reshape(info["shape"]).astype(np.float32)
        if info["dtype"] == "F32":
            return np.frombuffer(data, dtype=np.float32).reshape(info["shape"])
        raise ValueError(f"{name}: {info['dtype']}는 몰라요")


def quantize(w32):
    """MLC q4f16_1 (NK): [out, in] → q_weight uint32 [out, in/8], q_scale float16 [out, in/32]"""
    w = w32.astype(np.float16)
    out, k = w.shape
    if k % 32:
        raise ValueError(f"입력 축 {k}가 32로 나눠지지 않아요")
    g = w.reshape(out, k // 32, 32)
    scale = (np.abs(g).max(axis=2).astype(np.float32) / np.float32(7)).astype(np.float16)
    with np.errstate(divide="ignore", invalid="ignore"):
        d = (g.astype(np.float32) / scale[..., None].astype(np.float32)).astype(np.float16)
        x = (d.astype(np.float32) + np.float32(7)).astype(np.float16).astype(np.float32)
        q = np.clip(np.nan_to_num(np.rint(x), nan=0.0), 0, 14).astype(np.uint32).reshape(out, k // 8, 8)
    packed = np.zeros((out, k // 8), dtype=np.uint32)
    for j in range(8):
        packed |= q[:, :, j] << np.uint32(4 * j)
    return packed, scale


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hf", required=True)
    ap.add_argument("--mlc", required=True)
    ap.add_argument("--mlc-url", default=MLC_URL)
    ap.add_argument("--out")
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    if not a.verify and not a.out:
        sys.exit("--verify 또는 --out을 주세요")
    tc = json.load(open(os.path.join(a.mlc, "tensor-cache.json")))
    rec = {t["name"]: (sh, t) for sh in tc["records"] for t in sh["records"]}
    hf = SafeTensors(a.hf)

    def shard_path(sh):
        p = os.path.join(a.mlc, sh["dataPath"])
        if not os.path.exists(p):
            print(f"  받는 중 {sh['dataPath']}", flush=True)
            tmp = p + ".part"
            with urllib.request.urlopen(a.mlc_url + sh["dataPath"], timeout=600) as r, open(tmp, "wb") as f:
                shutil.copyfileobj(r, f)
            os.replace(tmp, p)
        return p

    jobs = []
    for name in rec:
        if not (name.startswith("language_model.layers.") and name.endswith(".q_weight")):
            continue
        base = name[: -len(".q_weight")]
        layer, rest = base[len("language_model.layers."):].split(".", 1)
        if rest not in LINEARS or a.only not in base:
            continue
        hf_names = [f"model.language_model.layers.{layer}.{x}" for x in LINEARS[rest]]
        if all(n in hf.where for n in hf_names):
            jobs.append((base, hf_names))
    print(f"다시 눌러 담을 가중치 {len(jobs)}개", flush=True)

    changed = {}
    bad = 0
    out_shards = {}
    for i, (base, hf_names) in enumerate(jobs):
        w = np.concatenate([hf.get(n) for n in hf_names], axis=0)
        qw, qs = quantize(w)
        for suffix, arr in ((".q_weight", qw), (".q_scale", qs)):
            sh, t = rec[base + suffix]
            if list(arr.shape) != t["shape"]:
                sys.exit(f"{base + suffix}: 모양이 달라요 {arr.shape} ≠ {t['shape']}")
            b = arr.tobytes()
            src = shard_path(sh)
            if a.verify:
                with open(src, "rb") as f:
                    f.seek(t["byteOffset"])
                    old = f.read(t["nbytes"])
                if old != b:
                    bad += 1
                    print(f"  다름: {base + suffix}", flush=True)
            else:
                dst = out_shards.get(sh["dataPath"])
                if dst is None:
                    dst = os.path.join(a.out, sh["dataPath"])
                    os.makedirs(a.out, exist_ok=True)
                    shutil.copyfile(src, dst)
                    out_shards[sh["dataPath"]] = dst
                with open(dst, "r+b") as f:
                    f.seek(t["byteOffset"])
                    f.write(b)
                changed[sh["dataPath"]] = sh
        if (i + 1) % 20 == 0 or i + 1 == len(jobs):
            print(f"  {i + 1}/{len(jobs)} {base}", flush=True)
    if a.verify:
        print("결과: 모두 같아요" if not bad else f"결과: 다른 텐서 {bad}개", flush=True)
        sys.exit(1 if bad else 0)
    # 바꾼 shard의 md5와 tensor-cache.json, 나머지 파일(설정·토크나이저·바뀌지 않은 shard)
    for path, sh in changed.items():
        sh["md5sum"] = hashlib.md5(open(os.path.join(a.out, path), "rb").read()).hexdigest()
    json.dump(tc, open(os.path.join(a.out, "tensor-cache.json"), "w"), indent=2)
    for sh in tc["records"]:
        if sh["dataPath"] not in out_shards:
            shutil.copyfile(shard_path(sh), os.path.join(a.out, sh["dataPath"]))
    for f in os.listdir(a.mlc):
        p = os.path.join(a.mlc, f)
        if os.path.isfile(p) and not f.startswith("params_shard_") and f != "tensor-cache.json" and not f.endswith(".part"):
            if not os.path.exists(os.path.join(a.out, f)):
                shutil.copyfile(p, os.path.join(a.out, f))
    print(f"다 됐어요: {a.out} (바꾼 shard {len(changed)}개)", flush=True)


if __name__ == "__main__":
    main()
