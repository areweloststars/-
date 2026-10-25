// 이야기 AI 실험실: 이 컴퓨터의 크롬(WebGPU)에서 진짜 모델로 새 이야기 설계를 시험해요. 저장소에 넣지 않아요.
// node lab.cjs <modelId> <out.json> [design ...]   (design: A 한 번에 N줄 · A2 계획 한 줄 + N줄)
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const { chromium } = require('playwright-core');
const REPO = 'C:/Users/Administrator/word-game-app';
const { build } = require(REPO + '/app/build.cjs');
const GAME = path.join(REPO, 'word-game');
const PORT = 43117; // 모델 저장소(Cache Storage)는 주소마다 따로라서 늘 같은 포트로
const PROFILE = path.join(os.tmpdir(), 'wg-llm-profile');
const [, , MODEL = 'gemma-4-E2B-it-q4f16_1-MLC', OUT = path.join(__dirname, 'out.json'), ...DESIGNS0] = process.argv;
const DESIGNS = DESIGNS0.length ? DESIGNS0 : ['A', 'A2'];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 일반 사전 낱말로 만든 시험 단어 (교재 내용 아님)
const SETS = [
  [['rule', '규칙'], ['permit', '허락하다'], ['schedule', '일정'], ['report', '보고서'], ['examine', '검사하다'], ['protect', '보호하다']],
  [['borrow', '빌리다'], ['brave', '용감한'], ['anxious', '불안한'], ['harvest', '수확'], ['whisper', '속삭이다'], ['encourage', '격려하다']],
  [['compare', '비교하다'], ['reduce', '줄이다'], ['abandon', '버리다'], ['survey', '설문 조사'], ['discover', '발견하다'], ['celebrate', '축하하다']]
];
const SEEDS = [[0, 3], [1, 4], [2, 5]];

const C = '[^\\n\\r{}|<>*#★\\[\\]()0-9:]';
const lit = s => JSON.stringify(s);
function grammarFor(items, plan) {
  const rules = [`c ::= ${C}`, 'en ::= "." | "!" | "?"'];
  items.forEach((x, i) => rules.push(`l${i + 1} ::= c{2,80} ${lit(x.core)} c{0,48} en`));
  const body = items.map((x, i) => `l${i + 1}`).join(' "\\n" ');
  rules.unshift(plan ? `root ::= "계획: " c{10,120} en "\\n" ${body}` : `root ::= ${body}`);
  return rules.join('\n');
}
function promptFor(fr, items, plan) {
  return `어린이 그림책 이야기를 써요. 가장 중요한 것은 앞뒤가 맞는 이야기예요. 줄마다 앞 줄 때문에 일어난 일이고, 그 일이 다음 줄로 이어져요.
제목: ${fr.title}
인물: ${fr.H}(주인공), ${fr.F}(친구), ${fr.V}(말썽꾼)
이야기 시작: ${fr.intro.join(' ')}
이야기 끝: ${fr.outro.join(' ')}
${plan ? `먼저 '계획: '으로 시작하는 한 줄에 누가 무엇을 하려는데 무엇이 문제이고 어떻게 풀리는지 써요. 그다음 줄부터 이야기를 써요.\n` : ''}시작과 끝 사이를 ${items.length}줄로 이어 써요. 줄마다 한두 문장, 문장 끝은 '~요'. 번호나 따옴표 표시는 쓰지 않아요.
줄마다 아래 인물이 나오고, 따옴표 속 말을 꼭 그대로 넣어요:
${items.map((x, i) => `${i + 1}줄: ${x.who}, '${x.core}'`).join('\n')}`;
}

(async () => {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/word-game/' || u === '/word-game/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(build()); }
    const f = path.join(GAME, u.replace(/^\/word-game\//, ''));
    if (!u.startsWith('/word-game/') || !f.startsWith(GAME) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(ok => srv.listen(PORT, '127.0.0.1', ok));
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false, serviceWorkers: 'block', viewport: { width: 900, height: 700 } });
  const out = { model: MODEL, designs: DESIGNS, runs: [] };
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e)));
    await page.goto(`http://127.0.0.1:${PORT}/word-game/`);
    await page.waitForFunction(() => typeof mkStory === 'function' && typeof SF === 'object', null, { timeout: 60000 });
    const gpu = await page.evaluate(async () => { const a = navigator.gpu && await navigator.gpu.requestAdapter(); return a ? [a.info.vendor, a.info.architecture, a.features.has('shader-f16')].join(' / ') : 'no adapter'; });
    log('WebGPU:', gpu);
    // 모델 올리기 (처음이면 받아요)
    const loading = page.evaluate(async id => {
      const lib = await import('/word-game/llm/web-llm.js');
      const rec = lib.prebuiltAppConfig.model_list.find(m => m.model_id === id);
      if (!rec) throw new Error('no model ' + id);
      const ov = Object.assign({}, rec.overrides || {}, { context_window_size: 4096 });
      if (/gemma/i.test(id)) Object.assign(ov, { sliding_window_size: -1, attention_sink_size: -1 });
      const appConfig = Object.assign({}, lib.prebuiltAppConfig, { model_list: [Object.assign({}, rec, { overrides: ov })] });
      window.__prog = '';
      const t0 = performance.now();
      window.__eng = await lib.CreateMLCEngine(id, { appConfig, initProgressCallback: p => { window.__prog = p.text; } });
      return Math.round(performance.now() - t0);
    }, MODEL);
    let done = false; loading.finally(() => { done = true; });
    while (!done) { await new Promise(r => setTimeout(r, 10000)); if (!done) log('load:', await page.evaluate(() => window.__prog).catch(() => '?')); }
    out.loadMs = await loading;
    log('model ready in', out.loadMs, 'ms');
    for (let s = 0; s < SETS.length; s++) {
      const rows = Object.fromEntries(SETS[s].map(([en, ko]) => [en, { en, ko, pos: 'x' }]));
      for (const seed of SEEDS[s]) {
        const fr = await page.evaluate(({ words, rows, seed }) => {
          const f = SF[((seed % SF.length) + SF.length) % SF.length], res = mkStory(words, rows, seed);
          const items = [];
          res.lines.forEach(l => { const m = l.match(/\{([^|}]+)\|([^}]+)\}/); if (!m) return; const role = res.roles[m[1]]; items.push({ id: m[1], core: m[2], role, who: role ? f[role] : '', app: l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1') }); });
          const fill = t => stFill(t, f, null, '', k => f[k]);
          return { title: f.title, H: f.H, F: f.F, V: f.V, S: f.S, intro: f.intro.map(fill), outro: f.outro.map(fill), items };
        }, { words: SETS[s].map(w => w[0]), rows, seed });
        for (const d of DESIGNS) {
          const plan = d === 'A2';
          const grammar = grammarFor(fr.items, plan), prompt = promptFor(fr, fr.items, plan);
          let r;
          try {
            // enable_thinking:false는 어느 모델이든 '<think></think>'를 넣어요: Qwen에만 써요
            r = await page.evaluate(async ({ prompt, grammar, qwen }) => {
              const t0 = performance.now();
              const req = { messages: [{ role: 'user', content: prompt }], temperature: 0.8, top_p: 0.9, max_tokens: 900, response_format: { type: 'grammar', grammar } };
              if (qwen) req.extra_body = { enable_thinking: false };
              const rep = await window.__eng.chat.completions.create(req);
              return { text: rep.choices[0].message.content, ms: Math.round(performance.now() - t0), usage: rep.usage };
            }, { prompt, grammar, qwen: /qwen/i.test(MODEL) });
          } catch (e) { r = { error: String(e && e.message || e) }; }
          // 앱의 검사: 줄마다 인물이 나오는지, 어린이 말·길이 등 (aiLineWhy)
          const lines = r.text ? r.text.split('\n').filter(Boolean).filter(l => !/^계획: /.test(l)) : [];
          const checks = r.text ? await page.evaluate(({ lines, fr }) => lines.map((l, i) => { const x = fr.items[i]; const short = x && x.role ? (fr.S[x.role] || fr[x.role]) : ''; return { cast: !short || l.includes(short), why: aiLineWhy(l, x ? x.core : '', { sent: 3, max: 140 }) }; }), { lines, fr }) : [];
          out.runs.push({ set: s, seed, design: d, title: fr.title, items: fr.items, intro: fr.intro, outro: fr.outro, prompt, ...r, lines, checks });
          log(`set ${s} seed ${seed} ${d} ${fr.title}: ${r.error ? 'ERROR ' + r.error.slice(0, 200) : r.ms + 'ms, ' + lines.length + ' lines'}`);
          fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
        }
      }
    }
    out.errors = errs;
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    log('done →', OUT);
  } finally { await ctx.close(); srv.close(); }
})().catch(e => { console.error('FAILED', e); process.exit(1); });
