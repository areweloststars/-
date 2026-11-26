// E4B 휴대폰 시험 페이지에서만 쓰는 '조각을 조금씩 올리기'. 게임의 엔진 파일(word-game/llm/web-llm.js)은 고치지 않아요:
// 시험 일꾼(e4b-worker.js)이 그 글을 받아 patchWebLLM으로 한 군데를 끼워 넣은 뒤 불러요.
//
// 왜: WebLLM은 받아 둔 모델 조각(shard)을 통째로 메모리에 읽고, 조각 안 기록(record)마다 writeBuffer 한 번으로 그래픽 칩에 써요.
// 그러면 큰 조각(Gemma 4 E4B의 앞쪽 조각은 수백 MB)이 잠깐 서너 벌 생겨요: 읽은 조각, 그래픽 칩 쪽으로 보내는 사본, 그 준비 버퍼, 그래픽 칩 버퍼.
// 8GB 폰에서 93조각 중 6조각(1.37GB)을 올리고 탭이 꺼졌어요. 여기서는 조각을 캐시의 Response 흐름으로 받으며
// 기록마다 piece 바이트(8MB)씩 쓰고, 한 조각을 쓸 때마다 그래픽 칩이 끝내기를 기다려요. 그래서 한 번에 한 조각만 오가요.

// 한 조각(shard)을 흐름(body)에서 읽어 기록마다 나눠 써요. 기록은 크기가 4의 배수여야 해요 (부르는 쪽이 형식을 봐요).
// 기록 안에서 쓰는 자리는 piece(4의 배수)의 배수라서, 쓰는 자리와 크기가 모두 4의 배수예요 (writeBuffer 규칙).
//   hooks.begin(rec) → 그 기록의 그래픽 칩 텐서, hooks.write(텐서, 자리, 바이트) → 바로 복사,
//   hooks.settle() → 그래픽 칩이 끝날 때까지, hooks.end(rec, 텐서) → 저장, hooks.drop(텐서) → 실패했을 때 풀기
export async function wgStreamShard(body, records, piece, hooks) {
  const recs = records.slice().sort((a, b) => a.byteOffset - b.byteOffset || a.nbytes - b.nbytes);
  let largest = 4, end = 0;
  for (const r of recs) {
    if (!Number.isSafeInteger(r.byteOffset) || r.byteOffset < 0 || !Number.isSafeInteger(r.nbytes) || r.nbytes < 0 || r.nbytes % 4 !== 0) {
      throw new Error('wgStreamShard: bad record ' + JSON.stringify(r));
    }
    if (r.nbytes > 0) {
      if (r.byteOffset < end) throw new Error('wgStreamShard: records overlap at byte ' + r.byteOffset);
      end = r.byteOffset + r.nbytes;
      largest = Math.max(largest, r.nbytes);
    }
  }
  const stage = new Uint8Array(Math.min(Math.max(4, Math.floor(piece / 4) * 4), largest));
  const reader = body.getReader();
  let pos = 0, ri = 0, cur, written = 0, filled = 0;
  // 지금 자리까지 온 0바이트 기록
  const emptyRecords = async () => {
    while (ri < recs.length && recs[ri].nbytes === 0 && recs[ri].byteOffset <= pos) {
      await hooks.end(recs[ri], hooks.begin(recs[ri]));
      ri++;
    }
  };
  try {
    for (;;) {
      await emptyRecords();
      if (ri >= recs.length) break;
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      let p = 0;
      while (p < chunk.length) {
        await emptyRecords();
        if (ri >= recs.length) break;
        const rec = recs[ri];
        if (pos < rec.byteOffset) { // 기록 사이 빈자리
          const skip = Math.min(rec.byteOffset - pos, chunk.length - p);
          p += skip; pos += skip;
          continue;
        }
        if (cur === undefined) { cur = hooks.begin(rec); written = 0; filled = 0; }
        const recEnd = rec.byteOffset + rec.nbytes;
        const take = Math.min(recEnd - pos, chunk.length - p, stage.length - filled);
        stage.set(chunk.subarray(p, p + take), filled);
        filled += take; p += take; pos += take;
        if (filled === stage.length || pos === recEnd) {
          hooks.write(cur, written, stage.subarray(0, filled));
          written += filled; filled = 0;
          await hooks.settle();
        }
        if (pos === recEnd) {
          const finished = cur;
          cur = undefined;
          await hooks.end(rec, finished);
          ri++;
        }
      }
      pos += chunk.length - p;
    }
    await emptyRecords();
    if (ri < recs.length) throw new Error(`wgStreamShard: the shard ended at byte ${pos} before record ${recs[ri].name || ri} was complete`);
  } catch (err) {
    if (cur !== undefined) { try { hooks.drop(cur); } catch (e) { /* 처음 오류를 남겨요 */ } }
    throw err;
  } finally {
    reader.cancel().catch(() => { });
  }
}

// WebLLM 0.2.86 안 TVM의 fetchTensorCacheInternal: 받은 조각을 하나씩 그래픽 칩에 올리는 되풀이의 시작
const ANCHOR = `\t\t                for (let i = 0; i < list.length; ++i) {
\t\t                    const shard = list[i];
\t\t                    const dataUrl = new URL(shard.dataPath, tensorCacheUrl).href;
\t\t                    let buffer;
`;
// 끼워 넣는 글: globalThis.wgStreamLoad(조각 크기, 바이트)가 있고, 그래픽 칩(WebGPU)·Cache API 저장소이고,
// 조각의 기록이 모두 그대로 복사하는 형식(BF16 묶음이 아님, 크기 4의 배수)이면 globalThis.wgStreamShard로 올리고 다음 조각으로 가요.
// 처음 한 번 'wg-stream: …' 진행 글을 보내요 (시험 페이지가 이 길로 올렸는지 알게).
const GLUE = `\t\t                    if (globalThis.wgStreamLoad && typeof globalThis.wgStreamShard === "function" &&
\t\t                        device.deviceType === DeviceStrToEnum.webgpu && artifactCache instanceof ArtifactCache && this.lib.webGPUContext !== undefined &&
\t\t                        shard.records.every(rec => !(rec.format === "f32-to-bf16" && rec.dtype === "float32") && rec.nbytes % 4 === 0)) {
\t\t                        const wgPiece = typeof globalThis.wgStreamLoad === "number" && globalThis.wgStreamLoad >= 4 ? globalThis.wgStreamLoad : 8 * 1024 * 1024;
\t\t                        if (!this.wgStreamed) {
\t\t                            this.wgStreamed = true;
\t\t                            for (let j = 0; j < this.initProgressCallback.length; ++j) {
\t\t                                this.initProgressCallback[j]({ progress: fetchedBytes / totalBytes, timeElapsed: timeElapsed, text: "wg-stream: loading each shard in pieces of " + Math.round(wgPiece / 1048576) + "MB" });
\t\t                            }
\t\t                        }
\t\t                        const response = yield artifactCache.fetchWithCache(dataUrl);
\t\t                        if (!response || !response.body) {
\t\t                            throw new Error("Cannot stream " + dataUrl);
\t\t                        }
\t\t                        const gpuContext = this.lib.webGPUContext;
\t\t                        yield globalThis.wgStreamShard(response.body, shard.records, wgPiece, {
\t\t                            begin: rec => {
\t\t                                const arr = this.withNewScope(() => this.detachFromCurrentScope(this.empty(rec.shape, rec.dtype, device)));
\t\t                                if (arr.numStorageBytes() !== rec.nbytes || arr.byteOffset % 4 !== 0) {
\t\t                                    arr.dispose();
\t\t                                    throw new Error("Cannot stream record " + rec.name + ": " + rec.nbytes + " bytes into a tensor of " + arr.numStorageBytes());
\t\t                                }
\t\t                                return arr;
\t\t                            },
\t\t                            write: (arr, offset, bytes) => gpuContext.copyRawBytesToBuffer(bytes, arr.getDataPtr(), arr.byteOffset + offset, bytes.length),
\t\t                            settle: () => device.sync(),
\t\t                            end: (rec, arr) => {
\t\t                                try {
\t\t                                    this.tensorCacheUpdate(rec.name, arr, false);
\t\t                                }
\t\t                                finally {
\t\t                                    arr.dispose();
\t\t                                }
\t\t                                return Promise.resolve();
\t\t                            },
\t\t                            drop: arr => arr.dispose(),
\t\t                        });
\t\t                        fetchedBytes += shard.nbytes;
\t\t                        timeElapsed = Math.ceil((perf.now() - tstart) / 1000);
\t\t                        reportCallback(++fetchedShards, /*loading=*/ true);
\t\t                        continue;
\t\t                    }
`;

// web-llm.js 글에 위 글을 끼워 넣어요. 끼울 자리가 꼭 한 번 있어야 해요 (WebLLM 판이 바뀌면 여기서 멈춰요)
export function patchWebLLM(src) {
  const at = src.indexOf(ANCHOR);
  if (at < 0 || src.indexOf(ANCHOR, at + 1) >= 0) throw new Error('web-llm.js에서 조각 올리기 자리를 찾지 못했어요 (WebLLM 판이 바뀌었나요?)');
  const cut = at + ANCHOR.length - '\t\t                    let buffer;\n'.length;
  return src.slice(0, cut) + GLUE + src.slice(cut);
}
