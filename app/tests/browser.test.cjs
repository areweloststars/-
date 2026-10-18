// 진짜 브라우저(Playwright Chromium)에서: 잠근 사이트를 열쇠 링크로 열고, 만들기 화면의 'AI 진단'을 가짜 AI 엔진으로 끝까지 돌려요.
// 그리고 AI 일꾼이 쓰는 llm/gpu-watch.js를 진짜 WebGPU(SwiftShader)에 붙여서, 그래픽 칩 소식(정보·오류·장치 닫음·잃음)이 화면까지 오는지 봐요.
// Playwright가 없는 컴퓨터에서는 건너뛰어요 (브라우저를 따로 받지 않아요)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { build, seal, keyFrom, out } = require('../build.cjs');

let pw = null;
for (const p of ['playwright', path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright')]) { try { pw = require(p); break; } catch (e) { } }
const exe = (() => { try { return pw && pw.chromium.executablePath(); } catch (e) { return ''; } })();
const skip = !pw ? 'Playwright가 없어요' : !(exe && fs.existsSync(exe)) ? 'Playwright Chromium이 없어요' : false;

const GAME = path.join(__dirname, '..', '..', 'word-game');
// 열쇠가 있으면 진짜로 빌드한 word-game/index.html, 없으면 지금 소스를 시험용 열쇠로 잠근 페이지
function site() {
  let key = keyFrom(process.env.SITE_KEY || '');
  if (!key) try { key = keyFrom(fs.readFileSync(path.join(__dirname, '..', '.site-key'), 'utf8')); } catch (e) { }
  if (key) return { key, page: fs.readFileSync(out, 'utf8') };
  key = crypto.randomBytes(32);
  return { key, page: seal(build(), key) };
}
// 시험용 일꾼: gpu-watch.js를 먼저 불러 놓고, 글 읽기 조각 하나(web-llm.js의 'word-game patch'처럼),
// WebLLM처럼 어댑터 → 장치 → 잡히지 않은 오류 → 읽기를 기다리는 버퍼 → 장치 닫기
const WATCH = `import '/word-game/llm/gpu-watch.js';
self.wgPrefillChunkDone({ ms: 12.4, tokens: 32, size: 32, index: 0, count: 9 });
const a = navigator.gpu && await navigator.gpu.requestAdapter();
if (!a) postMessage({ adapter: false });
else {
  const d = await a.requestDevice();
  d.createBuffer({ size: 4, usage: 0 });
  console.warn('watch test warning');
  await new Promise(r => setTimeout(r, 200));
  const buf = d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const mapped = buf.mapAsync(GPUMapMode.READ).then(() => 'mapped', e => e.name + ': ' + e.message);
  (function tryCreateBuffer() { d.destroy(); })();
  const mapErr = await mapped, lost = await d.lost;
  postMessage({ adapter: true, mapErr, lost: lost.reason });
}`;
// 시험용 일꾼: 진짜 AI 일꾼(llm/worker.js: gpu-watch.js + 고쳐 쓴 web-llm.js)을 불러 놓고 다 불렀다고 알려요
const LLM = `import '/word-game/llm/worker.js';
postMessage({ loaded: true, hook: typeof self.wgPrefillChunkDone === 'function' });`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain' };

test('browser: the locked site opens with its key link, AI 진단 runs to the end with a fake engine, and the worker GPU watch reports real WebGPU events', { skip, timeout: 120000 }, async t => {
  const { key, page: locked } = site();
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/__test/watch.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(WATCH); }
    if (u === '/__test/llm.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(LLM); }
    if (u === '/word-game/' || u === '/word-game/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(locked); }
    const f = path.join(GAME, u.replace(/^\/word-game\//, ''));
    if (!u.startsWith('/word-game/') || !f.startsWith(GAME) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const browser = await pw.chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(`${origin}/word-game/#k=${key.toString('base64url')}`);
    await page.waitForFunction(() => typeof MK === 'object' && typeof renderMake === 'function' && !!document.getElementById('make'), null, { timeout: 30000 });
    // 가짜 AI 엔진 (진짜 Gemma는 여기서 받을 수 없어요). 일꾼은 진짜 llm/worker.js가 떠요
    await page.evaluate(() => {
      try { localStorage.setItem('wg-ai-ready', AI_MODEL); } catch (e) { }
      const eng = { interruptGenerate() { }, chat: { completions: { create: async req => (async function* () {
        for (let i = 0; i < req.max_tokens; i++) yield { choices: [{ delta: { content: '가' } }] };
        yield { choices: [], usage: { prompt_tokens: req.messages[0].content.length * 2 + 8, completion_tokens: req.max_tokens, extra: { prefill_tokens_per_s: 150.5, decode_tokens_per_s: 12.4 } } };
      })() } } };
      AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: async (w, id, cfg) => { cfg.initProgressCallback({ progress: 1, text: 'Loading model from cache[20/20]' }); return eng; } };
      AI.gpu = true; AI.gpuWhy = ''; MK.aiWhy = ''; MK.offline = 'no';
      openMake();
    });
    const btn = page.locator('#mkai [data-mk="bench"]');
    await btn.waitFor();
    assert.equal((await btn.textContent()).trim(), 'AI 진단 (3~6분)');
    await btn.click();
    await page.waitForFunction(() => /결과: 모든 단계를 마쳤어요/.test((document.getElementById('mkbenchout') || {}).textContent || ''), null, { timeout: 30000 });
    const text = await page.locator('#mkbenchout').textContent();
    const labs = ['1 저장소에서 불러오기', '2 그래픽 준비(처음 한 번)', '3 짧은 글 읽기', '4 중간 글 16토큰씩 읽기', '5 중간 글 32토큰씩 읽기', '6 중간 글 64토큰씩 읽기', '7 중간 글 128토큰씩 읽기', '8 긴 글 읽기(실제 크기)', '9 길게 쓰기'];
    for (const lab of labs) assert.ok(text.includes(`${lab}: ok (성공)`), text);
    // 가짜 엔진은 조각 시간을 보내지 않아요: 안전한 크기는 남기지 않아요 (진짜 일꾼은 조각 크기 바꾸기 부탁을 받아도 멀쩡해요)
    assert.match(text, /이 기기의 안전한 조각 크기: 아직 못 찾았어요/);
    await page.locator('#mkai [data-mk="benchcopy"]').click();
    await page.waitForFunction(t => navigator.clipboard.readText().then(c => c === t), text, { timeout: 5000 });
    // 진짜 WebGPU에 붙인 gpu-watch.js: 이 화면이 띄운 일꾼 이름으로 오는 소식만 받아요
    const got = await page.evaluate(async () => {
      AI.wnames.add('wg-ai-pw'); aiGpuListen();
      const t0 = Date.now(), w = new Worker('/__test/watch.js', { type: 'module', name: 'wg-ai-pw' });
      const res = await new Promise((ok, no) => { w.onmessage = e => ok(e.data); w.onerror = e => no(new Error(e.message || 'worker error')); setTimeout(() => no(new Error('watch worker timeout')), 20000); });
      await new Promise(r => setTimeout(r, 300));
      w.terminate();
      return { res, lines: aiGpuLines(t0), dev: aiDevText(), chunks: AI.chunkLog.filter(e => e.at >= t0).map(e => [e.took, e.tokens, e.size]) };
    });
    // 글 읽기 조각 시간: 일꾼의 gpu-watch.js → BroadcastChannel → 이 화면
    assert.deepEqual(got.chunks, [[12, 32, 32]]);
    if (!got.res.adapter) t.diagnostic('WebGPU adapter not available here: the GPU watch was checked only in node'); 
    else {
      assert.match(got.dev, /^AI 일꾼의 그래픽 칩: google \/ swiftshader.*\| 한도: maxBufferSize \d+MB.*\| 기능: shader-f16 (있음|없음) · subgroups (있음|없음) · timestamp-query (있음|없음)/);
      const all = got.lines.join('\n');
      assert.match(all, /GPU 오류: GPUValidationError \/ \S/);
      assert.match(all, /일꾼 경고 글: watch test warning/);
      assert.match(all, /GPU 장치를 닫음\(device\.destroy\): tryCreateBuffer watch\.js:\d+/);
      assert.match(all, /GPU 끊김 까닭: destroyed \//);
      // 읽기를 기다리던 버퍼가 있는데 장치를 닫으면 크롬은 mapAsync를 AbortError로 끝내요 (휴대폰에서 본 오류와 같은 꼴)
      assert.match(got.res.mapErr, /^AbortError: /);
      t.diagnostic('mapAsync after destroy: ' + got.res.mapErr);
      for (const l of got.lines) t.diagnostic(l);
    }
    // 진짜 AI 일꾼: 고쳐 쓴 web-llm.js가 브라우저에서 열리고, 조각 크기 바꾸기 부탁(모델이 없어도)에 오류가 나지 않아요
    const llm = await page.evaluate(async () => {
      const w = new Worker('/__test/llm.js', { type: 'module' }), errs = [];
      w.onerror = e => errs.push(e.message || 'worker error');
      const first = await new Promise(ok => { w.onmessage = e => ok(e.data); setTimeout(() => ok(null), 20000); });
      w.postMessage({ wgPrefillChunk: 32 });
      await new Promise(r => setTimeout(r, 300));
      w.terminate();
      return { first, errs };
    });
    assert.deepEqual(llm, { first: { loaded: true, hook: true }, errs: [] });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    srv.close();
  }
});
