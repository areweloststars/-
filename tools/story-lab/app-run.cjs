// 단어장 만들기 재기: 앱이 단어장을 만들 때 쓰는 코드 그대로(mkStory → aiRewrite: 줄거리 틀 → 이야기 AI가 단어 줄을 고쳐 씀 →
// 다시 묻기 → 베낌·★ 검사)를 진짜 이야기 AI로 여러 단어 묶음에 돌려서, 에피소드가 만들어지는 비율과 줄마다 버린 까닭을 적어요.
// 사이트나 시험(npm test)은 이 파일을 쓰지 않아요. 단어는 일반 사전 낱말이에요 (교재 단어 아님).
//
//   node tools/story-lab/app-run.cjs [out.json] [phone|pc] [묶음 수] [틀 수]
//   phone: 휴대폰처럼 요청 글을 440토큰 안으로 나눠 물어요 (aiBudget). pc: 에피소드마다 요청 하나
//
// 브라우저: 기본은 Playwright의 Chromium + SwiftShader(그래픽 칩 없이 CPU로 WebGPU, 16비트 계산이 없어서 q4f32 모델).
//   WG_BROWSER=chrome 이면 이 컴퓨터에 설치된 크롬(진짜 그래픽 칩)으로 띄워요 (playwright-core도 돼요).
// 모델 파일: WG_HF_MIRROR=<폴더>를 주면 huggingface 대신 그 폴더(<폴더>/mlc-ai/<모델>/resolve/main/…)에서,
//   WG_LIB_DIR=<폴더>를 주면 모델 라이브러리(.wasm)를 그 폴더에서 읽어요 (인터넷이 막힌 곳에서 미리 받아 두고 쓸 때).
// 모델 저장소(브라우저 Cache Storage)는 WG_PROFILE 폴더(기본: 임시 폴더/wg-app-run-profile)에 남아요.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const REPO = path.join(__dirname, '..', '..');
const { build } = require(path.join(REPO, 'app', 'build.cjs'));
let pw;
for (const m of ['playwright', 'playwright-core']) { try { pw = require(m); break; } catch (e) { } }
if (!pw) { console.error('playwright 또는 playwright-core가 필요해요'); process.exit(1); }
const GAME = path.join(REPO, 'word-game');
const MIRROR = process.env.WG_HF_MIRROR || '', LIBDIR = process.env.WG_LIB_DIR || '';
const PROFILE = process.env.WG_PROFILE || path.join(os.tmpdir(), 'wg-app-run-profile');
const PORT = +process.env.WG_PORT || 43118; // 모델 저장소는 주소마다 따로라서 늘 같은 포트로
const [, , OUT = path.join(__dirname, 'app-run.json'), MODE = 'phone', NSET = '6', NFRAME = '2'] = process.argv;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 일반 사전 낱말 (영어, 뜻, 품사). 이야기 틀이 다루기 어려운 추상적인 말도 섞었어요.
// WG_SETS=<json 파일>을 주면 그 묶음들로 재요 ([[["영어", "뜻", "품사"], …], …]). 저장소 밖 임시 파일로 주고, 다 쓰면 지워요
const SETS = process.env.WG_SETS ? JSON.parse(fs.readFileSync(process.env.WG_SETS, 'utf8')) : [
  [['refund', '환불하다', 'v'], ['deliver', '배달하다', 'v'], ['invite', '초대하다', 'v'], ['delay', '미루다', 'v'], ['repair', '수리하다', 'v'], ['confirm', '확인하다', 'v']],
  [['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['anxious', '불안한', 'a'], ['harvest', '수확', 'n'], ['whisper', '속삭이다', 'v'], ['encourage', '격려하다', 'v']],
  [['compare', '비교하다', 'v'], ['reduce', '줄이다', 'v'], ['abandon', '버리다', 'v'], ['survey', '설문 조사', 'n'], ['discover', '발견하다', 'v'], ['celebrate', '축하하다', 'v']],
  [['rule', '규칙', 'n'], ['permit', '허락하다', 'v'], ['schedule', '일정', 'n'], ['report', '보고서', 'n'], ['examine', '검사하다', 'v'], ['protect', '보호하다', 'v']],
  [['honest', '정직한', 'a'], ['rescue', '구조하다', 'v'], ['ancient', '고대의', 'a'], ['explain', '설명하다', 'v'], ['shiver', '떨다', 'v'], ['reward', '보상', 'n']],
  [['contract', '계약', 'n'], ['private', '개인적인', 'a'], ['popular', '인기 있는', 'a'], ['arrange', '정리하다', 'v'], ['refuse', '거절하다', 'v'], ['apologize', '사과하다', 'v']]
];

(async () => {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/word-game/' || u === '/word-game/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(build()); }
    let root = GAME, rel = '';
    if (MIRROR && u.startsWith('/hf/')) { root = MIRROR; rel = u.slice(4); }
    else if (LIBDIR && u.startsWith('/lib/')) { root = LIBDIR; rel = u.slice(5); }
    else if (u.startsWith('/word-game/')) rel = u.slice(11);
    const f = path.join(root, rel);
    if (!rel || !f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'content-length': fs.statSync(f).size });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(ok => srv.listen(PORT, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${PORT}`;
  const chrome = process.env.WG_BROWSER === 'chrome';
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, chrome ? { channel: 'chrome', headless: false, serviceWorkers: 'block' }
    : { args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'], serviceWorkers: 'block' });
  const out = { mode: MODE, started: new Date().toISOString(), runs: [] };
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e)));
    await page.goto(`${origin}/word-game/`);
    await page.waitForFunction(() => typeof mkStory === 'function' && typeof aiRewrite === 'function', null, { timeout: 60000 });
    // 모델 파일을 이 서버에서 읽게 (미리 받아 둔 곳이 있을 때)
    await page.evaluate(async ({ mirror, lib }) => {
      AI.web = await import('/word-game/llm/web-llm.js');
      for (const m of AI.web.prebuiltAppConfig.model_list) {
        if (mirror) m.model = m.model.replace('https://huggingface.co/', location.origin + '/hf/');
        if (lib) m.model_lib = location.origin + '/lib/' + m.model_lib.split('/').pop();
      }
    }, { mirror: !!MIRROR, lib: !!LIBDIR });
    const t0 = Date.now();
    log('loading the story AI…');
    let last = '';
    const ready = page.evaluate(() => aiLoad(p => { window.__prog = Math.round(p * 100); }).then(() => ({ model: AI.engineId, chunk: AI.chunk, gpu: AI.gpuName })));
    let done = false; ready.finally(() => { done = true; });
    while (!done) { await new Promise(r => setTimeout(r, 15000)); const pr = await page.evaluate(() => window.__prog).catch(() => null); if (!done && pr !== last) { last = pr; log('  load', pr + '%'); } }
    out.load = await ready; out.loadMs = Date.now() - t0;
    log('ready', JSON.stringify(out.load), Math.round(out.loadMs / 1000) + 's');
    // 휴대폰처럼: 요청 글 길이 한도(440토큰)로 나눠 물어요. 조각 크기는 그대로 둬요 (나눠 읽어도 결과는 같고, 이 컴퓨터에서 더 느려지기만 해요)
    if (MODE === 'phone') await page.evaluate(() => { const k = aiChunkKey({ vendor: 'qualcomm', architecture: 'adreno-8xx' }); aiChunkPut(k, r => { r.safe = AI.chunk || 512; }); AI.gpuInfo = { vendor: 'qualcomm', architecture: 'adreno-8xx', device: '', description: '' }; });
    for (let s = 0; s < Math.min(+NSET, SETS.length); s++) {
      for (let k = 0; k < +NFRAME; k++) {
        const seed = (s * 5 + k * 7) % 12;
        const t1 = Date.now();
        const r = await page.evaluate(async ({ set, seed }) => {
          const rows = Object.fromEntries(set.map(([en, ko, pos]) => [en, { en, ko, pos }]));
          const res = mkStory(set.map(w => w[0]), rows, seed);
          const app = res.lines.slice();
          AI.diag = [];
          let n = 0, err = '';
          try { n = await aiRewrite(AI.engine, res, rows, seed, null, true); } catch (e) { err = String((e && e.message) || e); }
          const lines = aiWordLines(res, rows);
          return { title: res.title, app, lines: res.lines, wrote: n, of: lines, need: aiNeed(lines), copied: AI.copied, err, diag: (AI.diag || []).map(d => ({ title: d.title, why: d.why, raw: d.raw, info: d.info })) };
        }, { set: SETS[s], seed });
        r.set = s; r.seed = seed; r.ms = Date.now() - t1; r.ok = !r.err && r.wrote >= r.need;
        out.runs.push(r);
        fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
        log(`set ${s} seed ${seed} ${r.title}: ${r.ok ? '만들어짐' : '실패'} (${r.wrote}/${r.of}, 필요 ${r.need}) ${Math.round(r.ms / 1000)}s${r.err ? ' ERROR ' + r.err.slice(0, 160) : ''}`);
      }
    }
    const okN = out.runs.filter(r => r.ok).length;
    out.summary = { episodes: out.runs.length, made: okN, lines: out.runs.reduce((a, r) => a + r.of, 0), wrote: out.runs.reduce((a, r) => a + r.wrote, 0) };
    out.errors = errs;
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    log(`done: ${okN}/${out.runs.length} episodes made, ${out.summary.wrote}/${out.summary.lines} lines by the AI →`, OUT);
  } finally { await ctx.close(); srv.close(); }
})().catch(e => { console.error('FAILED', e); process.exit(1); });
