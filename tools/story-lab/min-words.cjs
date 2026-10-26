// 이야기 AI가 단어 몇 개까지 이야기를 혼자 쓸 수 있는지 재기: 앱 문장(줄거리 틀)은 주지 않고 단어 뜻만 주고,
// 제목과 짧은 이야기(첫 줄 + 단어 줄 + 마지막 줄)를 처음부터 쓰게 해요. 단어 5개 → 4 → 3 → 2 → 1개 차례로.
// 사이트나 시험(npm test)은 이 파일을 쓰지 않아요. 단어는 일반 사전 낱말이고 뜻은 직접 썼어요 (교재 단어 아님).
//
//   node tools/story-lab/min-words.cjs [단어 수들, 기본 5 4 3 2 1] [모델 id들]
//   모델 id(…-MLC)를 주면 그 모델들을 차례로 받아 같은 시험을 해요 (WebLLM 목록에 있는 무료 모델, 다 쓴 모델은 지워요).
//   모델을 주지 않으면 앱의 이야기 AI(Gemma 4 E2B, WG_MODEL=f16|f32)로 해요.
//   결과: tools/story-lab/min-words.txt (이야기 전문과 자동 점검), min-words.json (AI 답 원문)
//
// 자동 점검(형식): 제목이 있는지, 이야기 줄 수(단어 수 + 2 안팎), 뜻이 모두 들어갔는지(활용꼴 포함, 앱의 aiMark),
// 한 줄에 뜻을 몰아 쓰지 않았는지, 줄마다 앱의 문장 검사(aiLineWhy: 영어·기호·끝맺음·반복 …), 설명 글('써 드릴게요'), 같은 줄 되풀이.
// 이야기가 앞뒤가 맞는지(개연성)는 사람이(또는 Claude가) 읽고 판단해요.
//
// WG_API=http://127.0.0.1:11434 (+ WG_API_MODEL=<이름>): 브라우저 대신 OpenAI 꼴 서버(Ollama·llama-server)의 모델에 물어요.
//   크롬용(WebLLM)으로 바꾸기 전에 다른 무료 모델(한국어 모델 등)의 글솜씨부터 재 볼 때. 점검은 jsdom에서 앱 함수로 똑같이 해요.
// 브라우저 + WebLLM(앱이 쓰는 것 그대로). WG_BROWSER=chrome 이면 설치된 크롬(진짜 그래픽 칩)으로 띄워요.
// WG_MODEL=f16|f32 (기본 f16: 휴대폰과 같은 16비트), WG_CHUNK=<토큰> (기본 8: 휴대폰처럼 잘게 나눠 읽기).
// 모델 저장소는 app-run.cjs와 같은 폴더·포트를 써서, 전에 받아 둔 모델을 다시 받지 않아요.
// WG_MODEL_URL=https://huggingface.co/<이름>/<저장소>: 앱의 이야기 AI를 같은 꼴의 다른 모델 파일(파인튜닝한 판, tools/finetune)로 바꿔 재요.
//   모델 라이브러리(.wasm)·설정은 앱 것 그대로예요 (WG_MODEL=f16일 때만).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const REPO = path.join(__dirname, '..', '..');
const GAME = path.join(REPO, 'word-game');
const PROMPT_EN = !!process.env.WG_PROMPT_EN; // 요청 글에 영어 낱말을 함께 줘요 (storyPrompt)
const MODEL_URL = (process.env.WG_MODEL_URL || '').replace(/\/+$/, '');
const MODEL = process.env.WG_MODEL || 'f16', CHUNK = process.env.WG_CHUNK == null ? 8 : +process.env.WG_CHUNK || 0;
const PROFILE = process.env.WG_PROFILE || path.join(os.tmpdir(), 'wg-app-run-profile');
const PORT = +process.env.WG_PORT || 43118; // 모델 저장소는 주소마다 따로라서 app-run.cjs와 같은 포트로
const NS = process.argv.slice(2).map(Number).filter(n => n >= 1 && n <= 5);
const MODELS = process.argv.slice(2).filter(a => /-MLC/.test(a));
const TRIES = +process.env.WG_TRIES || 2;
const OUT = path.join(__dirname, 'min-words');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// 일반 사전 낱말 (영어, 뜻, 품사). 단어 n개 시험은 묶음마다 앞의 n개를 써요. C는 시험 단어장에 흔한 추상적인 말
const SETS = [
  [['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['harvest', '수확', 'n'], ['whisper', '속삭이다', 'v'], ['discover', '발견하다', 'v']],
  [['abandon', '버리다', 'v'], ['anxious', '불안한', 'a'], ['reward', '보상', 'n'], ['compare', '비교하다', 'v'], ['rescue', '구조하다', 'v']],
  [['temporary', '임시의', 'a'], ['convenient', '편리한', 'a'], ['previous', '이전의', 'a'], ['require', '요구하다', 'v'], ['confirm', '확인하다', 'v']]
];

// 요청 글: 뜻 n개(적힌 순서대로) → 제목 + 이야기 n + 2줄. 파인튜닝 모범 답안(tools/finetune)도 이 글 그대로 써요
// en(영어 낱말들)을 주면 뜻 옆에 괄호로 붙여요: 뜻을 헷갈리지 않게 (빌리다 ≠ 빌다). 시험에서는 WG_PROMPT_EN=1
const storyPrompt = (meanings, en) => {
  const n = meanings.length, lines = n + 2;
  const list = meanings.map((m, i) => (en ? `‘${m}’(${en[i]})` : `‘${m}’`)).join(', ');
  return `어린이 그림책에 실을 짧은 이야기를 써 주세요.
꼭 넣을 말: ${list}
- 첫 줄은 이야기 제목이에요.
- 그다음 줄부터 이야기를 ${lines}줄 써요. 한 줄에 한 문장씩.
- ${n > 1 ? '꼭 넣을 말은 이야기 둘째 줄부터 한 줄에 하나씩, 적힌 순서대로 넣어요.' : '꼭 넣을 말은 이야기 둘째 줄에 넣어요.'} 말 끝은 문장에 맞게 바꿔도 돼요(먹다 → 먹었어요).
- 앞 줄에서 일어난 일 때문에 다음 줄의 일이 일어나게 써요.
- 문장 끝은 '~요'로 해요. 영어, 괄호, 번호, 설명 글, 욕설, 다치는 장면은 쓰지 않아요.`;
};
// 이야기 하나 (페이지 안에서 돌아요): 요청 글(prompt)로 이야기 AI에 묻고, 답을 앱의 함수로 점검해요
const STORY = async ({ set, n, noThink, prompt }) => {
  const ws = set.slice(0, n), lines = n + 2;
  const t0 = performance.now();
  let text = '', first = 0, tokens = 0, usage = null, err = '';
  try {
    const reply = await AI.engine.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, top_p: 0.9, max_tokens: 100 + 60 * (lines + 1), stream: true, stream_options: { include_usage: true }, ...(noThink ? { extra_body: { enable_thinking: false } } : {}) });
    if (reply && typeof reply[Symbol.asyncIterator] === 'function') {
      for await (const ch of reply) {
        const d = ch && ch.choices && ch.choices[0] && ch.choices[0].delta && ch.choices[0].delta.content;
        if (d) { if (!tokens) first = performance.now(); tokens++; text += d; }
        if (ch && ch.usage) usage = ch.usage;
      }
    } else text = (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
  } catch (e) { err = String((e && e.message) || e); }
  const ms = Math.round(performance.now() - t0);
  // 점검: 마크다운·번호·꼬리표를 떼고, 맨 앞의 설명 글은 빼고(표시), 첫 줄은 제목, 나머지는 이야기 줄
  const META = /요청|작성했|작성해|써\s*드릴|드릴게요|다음은|알겠습니다|물론|이야기입니다|좋아요[,!]|^이야기\s*[:：]?$|^제목\s*[:：]?$/;
  let L = aiNoThink(text).split(/\n+/).map(s => s.replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '').replace(/^\s*(?:\d+\s*[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  const why = [];
  let meta = 0;
  while (L.length && META.test(L[0]) && !/^제목\s*[:：]\s*\S/.test(L[0])) { L.shift(); meta++; }
  const title = L.length ? L[0].replace(/^제목\s*[:：]\s*/, '').replace(/^[‘“"'《<「]+|[’”"'》>」]+$/g, '').trim() : '';
  const body = L.slice(1).map(s => s.replace(/^이야기\s*[:：]\s*/, '').trim()).filter(Boolean);
  meta += body.filter(s => META.test(s)).length;
  if (meta) why.push(`설명 글 ${meta}줄`);
  if (!title) why.push('제목 없음');
  if (body.length < n + 1 || body.length > n + 4) why.push(`이야기 ${body.length}줄 (${lines}줄 부탁)`);
  // 뜻 찾기 (활용꼴 포함): 단어마다 들어간 줄
  const at = ws.map(([en, ko, pos]) => { const w = stLex(en, { en, ko, pos }, SF[0]); return body.map((s, i) => (aiMark(s, en, w, ko) ? i : -1)).filter(i => i >= 0); });
  const miss = ws.filter((w, k) => !at[k].length).map(w => w[1]);
  if (miss.length) why.push(`뜻 빠짐: ${miss.join(', ')}`);
  const crammed = body.filter((s, i) => at.filter(a => a.includes(i)).length >= 2).length;
  if (crammed) why.push(`한 줄에 뜻 몰아 씀 ${crammed}줄`);
  const order = at.every(a => a.length) && at.every((a, k) => !k || a[0] > at[k - 1][0]);
  // 줄마다 앱의 문장 검사 (한두 문장, 한글, 기호·영어 없음, 끝맺음, 반복 …)
  const bad = body.map((s, i) => [i + 1, aiLineWhy(s, '', { sent: 2, max: 140 })]).filter(b => b[1]);
  if (bad.length) why.push(...bad.map(b => `${b[0]}줄: ${b[1]}`));
  const dup = body.filter((s, i) => body.slice(0, i).some(p => p === s || (s.length > 12 && p.slice(0, 12) === s.slice(0, 12)))).length;
  if (dup) why.push(`같은 줄·같은 시작 되풀이 ${dup}줄`);
  if (err) why.unshift('오류: ' + err.slice(0, 160));
  return { n, words: ws.map(w => w[0] + ' ' + w[1]), prompt, raw: text, title, body, ok: !why.length, order, why, ms, firstMs: first ? Math.round(first - t0) : 0, tokens, usage };
};

async function main() {
  let pw;
  for (const m of ['playwright', 'playwright-core']) { try { pw = require(m); break; } catch (e) { } }
  if (!pw) throw new Error('playwright 또는 playwright-core가 필요해요 (npm.cmd i --no-save playwright-core)');
  const { build } = require(path.join(REPO, 'app', 'build.cjs'));
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u === '/word-game/' || u === '/word-game/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(build()); }
    const rel = u.startsWith('/word-game/') ? u.slice(11) : '', f = path.join(GAME, rel);
    if (!rel || !f.startsWith(GAME) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'content-length': fs.statSync(f).size });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(ok => srv.listen(PORT, '127.0.0.1', ok));
  const chrome = process.env.WG_BROWSER === 'chrome';
  const ctx = await pw.chromium.launchPersistentContext(PROFILE, chrome ? { channel: 'chrome', headless: false, serviceWorkers: 'block' }
    : { args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader'], serviceWorkers: 'block' });
  const txt = [], out = { model: MODEL, chunk: CHUNK, started: new Date().toISOString(), runs: [] };
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e)));
    await page.goto(`http://127.0.0.1:${PORT}/word-game/`);
    await page.waitForFunction(() => typeof aiLoad === 'function' && typeof aiMark === 'function', null, { timeout: 60000 });
    const byModel = [];
    for (const id of MODELS.length ? MODELS : ['']) {
    const t0 = Date.now();
    log('loading', id || 'the story AI', '…');
    let ready;
    if (!id) {
      await page.evaluate(async ({ m, url }) => {
        AI.gpu = true; AI.gpuWhy = ''; AI.model = m === 'f32' ? AI_MODEL_F32 : AI_MODEL;
        if (!url) return;
        const lib = AI.web || (AI.web = await import('/word-game/llm/web-llm.js'));
        lib.prebuiltAppConfig.model_list.find(r => r.model_id === AI.model).model = url;
      }, { m: MODEL, url: MODEL_URL });
      if (MODEL_URL) log('model files from', MODEL_URL);
      ready = page.evaluate(() => aiLoad(p => { window.__prog = Math.round(p * 100) + '%'; }).then(() => ({ model: AI.engineId })));
    } else ready = page.evaluate(async ({ id, chunk }) => {
      // 앱의 AI를 쓰지 않고 WebLLM에서 바로 올려요 (그래픽 칩을 비우려고 앞 모델은 내려요)
      if (AI.engine) { try { await AI.engine.unload(); } catch (e) { } AI.engine = null; }
      const lib = AI.web || (AI.web = await import('/word-game/llm/web-llm.js'));
      const rec = lib.prebuiltAppConfig.model_list.find(m => m.model_id === id);
      if (!rec) throw new Error('목록에 없는 모델: ' + id);
      const ov = Object.assign({}, rec.overrides || {}, { context_window_size: 4096 }, chunk ? { prefill_chunk_size: chunk } : {});
      const appConfig = Object.assign({}, lib.prebuiltAppConfig, { model_list: [Object.assign({}, rec, { overrides: ov })] });
      AI.engine = await lib.CreateMLCEngine(id, { appConfig, initProgressCallback: p => { window.__prog = String(p.text || '').slice(0, 80); } });
      return { model: id };
    }, { id, chunk: CHUNK });
    let done = false, last = '';
    ready.finally(() => { done = true; });
    while (!done) { await new Promise(r => setTimeout(r, 15000)); const pr = await page.evaluate(() => window.__prog).catch(() => null); if (!done && pr !== last) { last = pr; log('  load', pr); } }
    let info;
    try { info = await ready; } catch (e) { say(`\n# ${id}: 올리지 못했어요 (${String((e && e.message) || e).slice(0, 200)})`); continue; }
    if (CHUNK && !id) await page.evaluate(c => aiChunkSet(c), CHUNK);
    log('ready', JSON.stringify(info), `chunk ${CHUNK || '모델 그대로'}`, Math.round((Date.now() - t0) / 1000) + 's');
    say(`\n# 단어 몇 개까지 이야기를 혼자 쓰나 · ${info.model}${MODEL_URL && !id ? ' (' + MODEL_URL + ')' : ''} · 조각 ${CHUNK || '모델 그대로'}토큰 · ${new Date().toISOString().slice(0, 16)}`);
    const noThink = /qwen3/i.test(info.model);
    const mine = [];
    for (const n of NS.length ? NS : [5, 4, 3, 2, 1]) {
      const rs = [];
      for (let s = 0; s < SETS.length; s++) for (let k = 0; k < TRIES; k++) {
        const r = await page.evaluate(STORY, { set: SETS[s], n, noThink, prompt: storyPrompt(SETS[s].slice(0, n).map(w => w[1]), PROMPT_EN ? SETS[s].slice(0, n).map(w => w[0]) : null) });
        r.model = info.model; r.set = 'ABC'[s]; r.try = k + 1; rs.push(r); mine.push(r); out.runs.push(r);
        fs.writeFileSync(OUT + '.json', JSON.stringify(out, null, 1));
        say(`\n[${MODELS.length ? info.model.replace(/-q4f\d+_1-MLC$/, '') + ' · ' : ''}단어 ${n}개 · 묶음 ${r.set} · ${r.try}번째] ${r.ok ? '형식 통과' : '형식 실패: ' + r.why.join(' · ')}${r.ok && !r.order ? ' (순서 다름)' : ''} · ${(r.ms / 1000).toFixed(1)}초`);
        say(`  넣을 말: ${r.words.join(', ')}`);
        say(`  제목: ${r.title || '(없음)'}`);
        r.body.forEach((l, i) => say(`  ${i + 1}. ${l}`));
        if (!r.title && !r.body.length) say(`  (답 원문) ${String(r.raw).slice(0, 300).replace(/\n/g, ' / ')}`);
      }
      say(`\n== ${info.model} · 단어 ${n}개: 형식 통과 ${rs.filter(r => r.ok).length}/${rs.length}편 ==`);
    }
    byModel.push([info.model, mine]);
    // 다 쓴 모델은 내리고 지워요 (PC 저장 공간). 앱의 AI(Gemma)는 남겨요
    if (id && !process.env.WG_KEEP) await page.evaluate(async id => { try { await AI.engine.unload(); } catch (e) { } AI.engine = null; try { await AI.web.deleteModelAllInfoInCache(id); } catch (e) { } }, id);
    }
    say('\n# 요약 (형식 통과 / 시도 · 한 편 평균 시간) — 이야기가 앞뒤가 맞는지는 위 이야기를 읽고 판단해요');
    for (const [m, rs] of byModel) {
      const byN = {};
      for (const r of rs) { const b = byN[r.n] || (byN[r.n] = [0, 0, 0]); b[0] += r.ok ? 1 : 0; b[1]++; b[2] += r.ms; }
      say(`  ${m}: ` + Object.keys(byN).sort((a, b) => b - a).map(n => `단어 ${n}개 ${byN[n][0]}/${byN[n][1]} (${(byN[n][2] / byN[n][1] / 1000).toFixed(1)}초)`).join(' · '));
    }
    if (errs.length) say('page errors: ' + errs.slice(0, 5).join(' | '));
    log('done →', OUT + '.txt');
  } finally { await ctx.close(); srv.close(); }
}

// OpenAI 꼴 서버에 묻는 엔진: 앱이 WebLLM에 묻는 꼴(chat.completions.create, stream)을 그대로 받아요
function apiEngine(base, model) {
  async function* stream(req) {
    const body = { model, messages: req.messages, temperature: req.temperature, top_p: req.top_p, max_tokens: req.max_tokens, stream: true };
    const r = await fetch(base.replace(/\/$/, '') + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('서버 ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const dec = new TextDecoder();
    let buf = '';
    for await (const part of r.body) {
      buf += dec.decode(part, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') continue;
        const j = JSON.parse(line.slice(5).trim()), d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (d) yield { choices: [{ delta: { content: d } }] };
      }
    }
  }
  return { chat: { completions: { create: async req => stream(req) } } };
}
async function viaApi(base, model) {
  const { bootPage } = require(path.join(REPO, 'app', 'tests', 'page.cjs'));
  const p = bootPage(), txt = [], rs = [];
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  try {
    p.window.__llm = apiEngine(base, model);
    p.run('AI.engine = window.__llm');
    say(`# 단어 몇 개까지 이야기를 혼자 쓰나 · ${model} (${base}) · ${new Date().toISOString().slice(0, 16)}`);
    for (const n of NS.length ? NS : [5, 4, 3, 2, 1]) {
      const mine = [];
      for (let s = 0; s < SETS.length; s++) for (let k = 0; k < TRIES; k++) {
        const r = await p.run(`(${STORY})(${JSON.stringify({ set: SETS[s], n, prompt: storyPrompt(SETS[s].slice(0, n).map(w => w[1]), PROMPT_EN ? SETS[s].slice(0, n).map(w => w[0]) : null) })})`);
        r.set = 'ABC'[s]; r.try = k + 1; mine.push(r); rs.push(r);
        fs.writeFileSync(OUT + '.json', JSON.stringify({ model, runs: rs }, null, 1));
        say(`\n[${model} · 단어 ${n}개 · 묶음 ${r.set} · ${r.try}번째] ${r.ok ? '형식 통과' : '형식 실패: ' + r.why.join(' · ')}${r.ok && !r.order ? ' (순서 다름)' : ''} · ${(r.ms / 1000).toFixed(1)}초`);
        say(`  넣을 말: ${r.words.join(', ')}`);
        say(`  제목: ${r.title || '(없음)'}`);
        r.body.forEach((l, i) => say(`  ${i + 1}. ${l}`));
        if (!r.title && !r.body.length) say(`  (답 원문) ${String(r.raw).slice(0, 300).replace(/\n/g, ' / ')}`);
      }
      say(`\n== ${model} · 단어 ${n}개: 형식 통과 ${mine.filter(r => r.ok).length}/${mine.length}편 ==`);
    }
  } finally { p.close(); }
}

if (require.main === module) (process.env.WG_API ? viaApi(process.env.WG_API, process.env.WG_API_MODEL || '') : main()).catch(e => { console.error('FAILED', e); process.exit(1); });
module.exports = { STORY, SETS, storyPrompt };
