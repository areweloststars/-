// E4B 휴대폰 시험 페이지(tools/phone-test/)의 '조각을 조금씩 올리기'(stream-load.js): 받아 둔 모델 조각을 흐름으로 읽으며
// 기록마다 몇 MB씩 그래픽 칩에 써요. 게임의 엔진 파일은 그대로 두고, 시험 일꾼이 그 글에 한 군데를 끼워 넣어 불러요.
// 진짜 그래픽 칩 없이 Node에서: 끼워 넣은 엔진 글을 그대로 돌려 TVM의 조각 올리기를 꺼내고, 그래픽 칩·캐시는 가짜로 채워요
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'word-game', 'llm', 'web-llm.js'), 'utf8');
const mod = () => import(pathToFileURL(path.join(ROOT, 'tools', 'phone-test', 'stream-load.js')).href);
// 끼워 넣은 엔진 글을 돌려 TVM(libExports$2)을 꺼내요 (webllm.test.cjs와 같은 방법)
function tvmOf(src) {
  const body = src.replace(/\nexport \{[^}]*\};\s*\n\/\/# sourceMappingURL=index\.js\.map\s*$/, '\n');
  assert.notEqual(body, src, 'web-llm.js 끝의 export 줄을 찾지 못했어요');
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn libExports$2;')();
}

const streamOf = (bytes, cuts) => new ReadableStream({
  start(c) { let at = 0, k = 0; while (at < bytes.length) { const n = Math.min(cuts[k++ % cuts.length], bytes.length - at); c.enqueue(bytes.slice(at, at + n)); at += n; } c.close(); }
});
let seed = 7;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
// 가짜 기록: 앞과 사이에 빈자리(조각마다 다르게), 크기는 4의 배수, 가끔 0바이트
function layout() {
  const recs = [];
  let at = rnd(9);
  for (let i = 0, n = 1 + rnd(6); i < n; i++) {
    const nbytes = rnd(5) === 0 ? 0 : 4 * (1 + rnd(90));
    recs.push({ name: 'w' + i, byteOffset: at, nbytes });
    at += nbytes + (rnd(3) === 0 ? rnd(7) : 0);
  }
  return { recs, bytes: Uint8Array.from({ length: at + rnd(5) }, () => rnd(256)) };
}

test('phone test: wgStreamShard puts every record byte for byte in place however the shard stream is cut, in aligned pieces no bigger than asked', async () => {
  const { wgStreamShard } = await mod();
  for (let round = 0; round < 300; round++) {
    const { recs, bytes } = layout();
    const piece = [4, 8, 12, 30, 64, 1 << 20][round % 6];
    const cuts = Array.from({ length: 1 + rnd(4) }, () => 1 + rnd(round % 2 ? 40 : 400));
    const got = new Map(), sizes = [];
    let settles = 0;
    await wgStreamShard(streamOf(bytes, cuts), recs.slice().reverse(), piece, {
      begin: rec => ({ rec, buf: new Uint8Array(rec.nbytes) }),
      write: (h, off, b) => {
        assert.equal(off % 4, 0); assert.equal(b.length % 4, 0);
        assert.ok(b.length > 0 && b.length <= Math.max(4, piece - (piece % 4)), `${b.length} > ${piece}`);
        h.buf.set(b, off); sizes.push(b.length);
      },
      settle: async () => { settles++; },
      end: async (rec, h) => { assert.equal(h.rec, rec); assert.ok(!got.has(rec.name)); got.set(rec.name, h.buf); },
      drop: () => assert.fail('nothing should be dropped')
    });
    assert.equal(settles, sizes.length, '조각마다 그래픽 칩이 끝내기를 기다려요');
    assert.deepEqual([...got.keys()].sort(), recs.map(r => r.name).sort(), '기록마다 한 번씩');
    for (const r of recs) assert.deepEqual(got.get(r.name), bytes.subarray(r.byteOffset, r.byteOffset + r.nbytes), `${round} ${r.name}`);
  }
});

test('phone test: wgStreamShard stops with an error when the shard is short or the records are bad, and drops the half-written record', async () => {
  const { wgStreamShard } = await mod();
  const bytes = new Uint8Array(40), dropped = [];
  const hooks = { begin: rec => rec.name, write: () => { }, settle: async () => { }, end: async () => { }, drop: h => dropped.push(h) };
  await assert.rejects(wgStreamShard(streamOf(bytes, [7]), [{ name: 'a', byteOffset: 0, nbytes: 16 }, { name: 'b', byteOffset: 16, nbytes: 32 }], 8, hooks), /ended at byte 40 before record b/);
  assert.deepEqual(dropped, ['b']);
  await assert.rejects(wgStreamShard(streamOf(bytes, [7]), [{ name: 'c', byteOffset: 0, nbytes: 6 }], 8, hooks), /bad record/);
  await assert.rejects(wgStreamShard(streamOf(bytes, [7]), [{ name: 'd', byteOffset: 0, nbytes: 16 }, { name: 'e', byteOffset: 12, nbytes: 8 }], 8, hooks), /overlap/);
});

test('phone test: patchWebLLM fits this WebLLM, and the patched tensor cache streams shards in pieces only when wgStreamLoad is set', async () => {
  const { wgStreamShard, patchWebLLM } = await mod();
  assert.throws(() => patchWebLLM('nothing here'), /자리를 찾지 못했어요/);
  const T = tvmOf(patchWebLLM(SRC));
  const gpu = new Map(); // 가짜 그래픽 칩 버퍼: 주소 → 바이트
  let ptr = 0, made = [], writes = [], texts = [], stored = new Map(), asked = [];
  const tensor = (shape, dtype) => {
    const n = shape.reduce((a, b) => a * b, 1) * ({ float16: 2, uint8: 1 }[dtype] || 4);
    const t = { p: ++ptr, byteOffset: 0, numStorageBytes: () => n, getDataPtr: () => t.p, dispose() { t.freed = true; },
      copyFromRawBytes(b) { gpu.set(t.p, Uint8Array.from(b)); }, copyFrom(cpu) { gpu.set(t.p, Uint8Array.from(cpu.data)); } };
    gpu.set(t.p, new Uint8Array(n));
    made.push(t);
    return t;
  };
  const inst = {
    env: { logger: () => { } }, withNewScope: f => f(), detachFromCurrentScope: x => x, cpu: () => ({ deviceType: 1 }),
    empty: (shape, dtype, dev) => (dev.deviceType === 1 ? { data: null, dispose() { } } : tensor(shape, dtype)),
    ctx: { arrayDecodeStorage: (cpu, b) => { cpu.data = Uint8Array.from(b); } },
    lib: { webGPUContext: { copyRawBytesToBuffer: (b, p, off, n) => { writes.push(n); gpu.get(p).set(b.subarray(0, n), off); } } },
    tensorCacheUpdate: (name, t) => stored.set(name, gpu.get(t.p)),
    getPackedBF16Bytes: T.Instance.prototype.getPackedBF16Bytes, loadTensorCacheRecordData: T.Instance.prototype.loadTensorCacheRecordData
  };
  const device = { deviceType: 15, sync: async () => { } };
  // 조각 셋: 큰 것(기록 둘, 사이에 빈자리), 작은 것, 크기가 4의 배수가 아닌 기록이 든 것(이건 예전 방법으로)
  const fill = n => Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) % 251);
  const shards = [fill(4000), fill(96), fill(10)];
  const list = [
    { dataPath: 's0.bin', nbytes: 4000, records: [{ name: 'emb', shape: [1000], dtype: 'float16', format: 'raw', byteOffset: 0, nbytes: 2000 }, { name: 'ple', shape: [496], dtype: 'float32', format: 'raw', byteOffset: 2016, nbytes: 1984 }] },
    { dataPath: 's1.bin', nbytes: 96, records: [{ name: 'norm', shape: [24], dtype: 'float32', format: 'raw', byteOffset: 0, nbytes: 96 }] },
    { dataPath: 's2.bin', nbytes: 10, records: [{ name: 'odd', shape: [6], dtype: 'uint8', format: 'raw', byteOffset: 2, nbytes: 6 }] }
  ];
  const cache = Object.assign(Object.create(T.ArtifactCache.prototype), {
    hasAllKeys: async () => true,
    fetchWithCache: async (url, type) => {
      const b = shards[+url.match(/s(\d)\.bin$/)[1]];
      asked.push([url.split('/').pop(), type || 'stream']);
      return type === 'arraybuffer' ? b.slice().buffer : new Response(streamOf(b, [333]));
    }
  });
  const want = { emb: shards[0].subarray(0, 2000), ple: shards[0].subarray(2016), norm: shards[1], odd: shards[2].subarray(2, 8) };
  const load = async flag => {
    made = []; writes = []; texts = []; stored = new Map(); asked = [];
    Object.assign(inst, { initProgressCallback: [p => texts.push(p.text)], wgStreamed: false });
    globalThis.wgStreamShard = wgStreamShard;
    if (flag !== undefined) globalThis.wgStreamLoad = flag;
    try { await T.Instance.prototype.fetchTensorCacheInternal.call(inst, 'https://example.org/model/', list, device, cache); }
    finally { delete globalThis.wgStreamLoad; delete globalThis.wgStreamShard; }
    for (const [k, v] of Object.entries(want)) assert.deepEqual(stored.get(k), Uint8Array.from(v), k);
    assert.ok(made.every(t => t.freed), '올린 뒤 자기 몫은 풀어요 (캐시가 따로 잡아요)');
    assert.match(texts.at(-1), /^Loading model from cache\[3\/3\]: /);
  };
  await load(256);
  assert.deepEqual(asked, [['s0.bin', 'stream'], ['s1.bin', 'stream'], ['s2.bin', 'arraybuffer']]);
  assert.equal(texts.filter(t => /^wg-stream: loading each shard in pieces of 0MB$/.test(t)).length, 1);
  assert.ok(Math.max(...writes) <= 256 && writes.length >= 17, `writes ${writes}`);
  await load(true);
  assert.equal(Math.max(...writes), 2000, 'true면 8MB씩: 이 작은 기록은 한 번에');
  assert.equal(texts.filter(t => /^wg-stream: .* 8MB$/.test(t)).length, 1);
  await load(undefined);
  assert.deepEqual(asked, [['s0.bin', 'arraybuffer'], ['s1.bin', 'arraybuffer'], ['s2.bin', 'arraybuffer']], '깃발이 없으면 예전대로 통째로 읽어요');
  assert.equal(texts.some(t => /wg-stream/.test(t)), false);
});
