// 고쳐 쓴 WebLLM(word-game/llm/web-llm.js의 'word-game patch'): 글을 나눠 읽는 조각 크기를 앱이 줄일 수 있고, 조각마다 걸린 시간을 알려요.
// 진짜 그래픽 칩 없이 Node에서: WebLLM 파일을 그대로 읽어 안쪽 함수와 LLMChatPipeline을 꺼내고, TVM은 가짜로 채워요
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'word-game', 'llm', 'web-llm.js'), 'utf8');
function lib() {
  const body = SRC.replace(/\nexport \{[^}]*\};\s*\n\/\/# sourceMappingURL=index\.js\.map\s*$/, '\n');
  assert.notEqual(body, SRC, 'web-llm.js 끝의 export 줄을 찾지 못했어요');
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn { getChunkedPrefillInputData, wgPrefillChunk, wgPrefillChunkDone, LLMChatPipeline };')();
}
const W = lib();
const TOKENS = Array.from({ length: 275 }, (_, i) => 1000 + i);

// 가짜 TVM: 무엇을 불러도 또 가짜를 돌려줘요. 모델 정보(_metadata)는 512토큰 조각으로 만든 모델처럼, 부른 함수와 인자는 적어 둬요
function fakeTvm(calls) {
  const any = name => new Proxy(function () { }, {
    get(t, k) {
      if (k === 'toString') return () => (name.endsWith('getFunction()()') ? JSON.stringify({ prefill_chunk_size: 512, params: [] }) : name);
      if (k === 'then') return undefined;
      return any(name + '.' + String(k));
    },
    apply(t, self, args) { calls.push([name, args.map(a => (a && a.shape ? a.shape : a))]); return any(name + '()'); }
  });
  const base = any('tvm');
  return new Proxy({}, { get: (t, k) => (k === 'makeShapeTuple' ? a => ({ shape: a }) : k === 'detachFromCurrentScope' || k === 'attachToCurrentScope' ? x => x : base[k]) });
}
const CONV = { system_template: '', system_message: '', roles: { user: 'user', assistant: 'assistant' }, seps: [''], role_content_sep: '', role_empty_sep: '', stop_str: [], stop_token_ids: [], system_prefix_token_ids: [] };
function pipeline(extra) {
  const calls = [];
  const config = Object.assign({ conv_template: CONV, conv_config: {}, vocab_size: 100, context_window_size: 4096, sliding_window_size: -1, attention_sink_size: -1, tokenizer_info: { token_postproc_method: 'raw', prepend_space_in_encode: false } }, extra);
  const p = new W.LLMChatPipeline(fakeTvm(calls), { encode: () => TOKENS }, config, undefined, undefined, undefined);
  return { p, calls };
}
const quiet = f => { const o = console.log, i = console.info; console.log = console.info = () => { }; try { return f(); } finally { console.log = o; console.info = i; } };

test('WebLLM patch: the chunk size the app asks for is used only when smaller than the compiled size', () => {
  assert.equal(W.wgPrefillChunk(512, 32), 32);
  assert.equal(W.wgPrefillChunk(512, 16), 16);
  assert.equal(W.wgPrefillChunk(512, 31.7), 31);
  for (const want of [undefined, null, 0, -8, 'x', 512, 2048, NaN]) assert.equal(W.wgPrefillChunk(512, want), 512, String(want));
  // 275토큰 글을 32토큰씩: 32 × 8 + 19, 이어 붙이면 원래 글 그대로
  const [chunks, lens] = W.getChunkedPrefillInputData([TOKENS], W.wgPrefillChunk(512, 32), () => 0);
  assert.deepEqual(lens, [32, 32, 32, 32, 32, 32, 32, 32, 19]);
  assert.deepEqual(chunks.flat(2), TOKENS);
  // 줄이지 않으면 한 조각
  assert.deepEqual(W.getChunkedPrefillInputData([TOKENS], W.wgPrefillChunk(512, undefined), () => 0)[1], [275]);
});

test('WebLLM patch: the pipeline takes wg_prefill_chunk from the model config, keeps the KV cache at the compiled size, and can change between requests', () => {
  const { p, calls } = quiet(() => pipeline({ wg_prefill_chunk: 32 }));
  assert.equal(p.prefillChunkSize, 32);
  assert.equal(p.wgCompiledPrefillChunk, 512);
  // KV 캐시: [최대 시퀀스 1, 문맥 4096, 조각 512(컴파일된 크기), 페이지 16, 미끄럼 창 없음]
  assert.deepEqual(calls.filter(c => c[1].length === 5 && c[1].every(Array.isArray)).map(c => c[1]), [[[1], [4096], [512], [16], [0]]]);
  assert.equal(quiet(() => p.wgSetPrefillChunk(64)), 64);
  assert.equal(quiet(() => p.wgSetPrefillChunk(0)), 512);
  assert.equal(quiet(() => p.wgSetPrefillChunk(1024)), 512);
  // 설정이 없으면 컴파일된 크기 그대로
  assert.equal(quiet(() => pipeline({})).p.prefillChunkSize, 512);
});

test('WebLLM patch: the model-manifest prompt path (Gemma 4) reads 275 tokens in 32-token chunks and reports each chunk after the GPU finished it', async () => {
  const { p } = quiet(() => pipeline({ wg_prefill_chunk: 32 }));
  // 모델 목록(manifest)으로 올린 모델처럼: 글 한 토막, 토큰 275개
  p.artifact = {};
  p.conversation = { isTextCompletion: false, config: {}, appendMessage() { }, appendReplyHeader() { }, getArtifactPromptSegments: () => ['story'] };
  const [chunks, n] = await p.getArtifactPrefillChunks();
  assert.equal(n, 275);
  assert.deepEqual(chunks.map(c => c.tokenIds.length), [32, 32, 32, 32, 32, 32, 32, 32, 19]);
  assert.deepEqual(chunks.flatMap(c => c.tokenIds), TOKENS);
  // 읽기: 조각마다 그래픽 칩이 다 끝낼 때까지 기다리고(device.sync) 걸린 시간을 알려요
  let syncs = 0, busy = 0;
  const seen = [];
  p.device = { sync: async () => { syncs++; await new Promise(r => setTimeout(r, 2)); busy = 0; } };
  p.getArtifactTextEmbeddings = ids => ({ ids });
  p.artifactPrefillAndForward = (emb, ids) => { busy++; p.filledKVCacheLength += ids.length; return { ids }; };
  globalThis.wgPrefillChunkDone = d => { assert.equal(busy, 0, '그래픽 칩이 조각을 다 끝낸 뒤에 알려요'); seen.push(d); };
  try {
    const out = await p.forwardPrefill('story', 'user', undefined, undefined);
    assert.equal(out.promptLen, 275);
    assert.equal(p.filledKVCacheLength, 275);
    assert.equal(syncs, 9);
    assert.deepEqual(seen.map(d => [d.tokens, d.size, d.index, d.count]), [32, 32, 32, 32, 32, 32, 32, 32, 19].map((t, i) => [t, 32, i, 9]));
    for (const d of seen) assert.ok(d.ms >= 1, `조각 시간에 기다린 시간이 들어가요 (${d.ms}ms)`);
    // 알릴 곳이 없으면 기다리지 않아요 (WebLLM 원래대로)
    delete globalThis.wgPrefillChunkDone;
    syncs = 0; p.filledKVCacheLength = 0;
    await p.forwardPrefill('story', 'user', undefined, undefined);
    assert.equal(syncs, 0);
  } finally { delete globalThis.wgPrefillChunkDone; }
});

test('WebLLM patch: every changed spot is marked and listed in NOTICE.txt', () => {
  const marks = SRC.split('\n').filter(l => l.includes('word-game patch')).length;
  assert.equal(marks, 9);
  const notice = fs.readFileSync(path.join(__dirname, '..', '..', 'word-game', 'llm', 'NOTICE.txt'), 'utf8');
  assert.match(notice, /Changes made to web-llm\.js for this game/);
  assert.match(notice, /wg_prefill_chunk/);
  assert.match(notice, /wgPrefillChunkDone/);
});
