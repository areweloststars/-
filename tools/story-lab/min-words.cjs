// 이야기 AI가 단어 몇 개까지 이야기를 혼자 쓸 수 있는지 재기: 앱 문장(줄거리 틀)은 주지 않고 단어 뜻만 주고,
// 제목과 짧은 이야기(첫 줄 + 단어 줄 + 마지막 줄)를 처음부터 쓰게 해요. 단어 5개 → 4 → 3 → 2 → 1개 차례로.
// 사이트나 시험(npm test)은 이 파일을 쓰지 않아요. 단어는 일반 사전 낱말이고 뜻은 직접 썼어요 (교재 단어 아님).
//
//   node tools/story-lab/min-words.cjs [단어 수들, 기본 5 4 3 2 1]
//   결과: tools/story-lab/min-words.txt (이야기 전문과 자동 점검), min-words.json (AI 답 원문)
//
// 자동 점검(형식): 제목이 있는지, 이야기 줄 수(단어 수 + 2 안팎), 뜻이 모두 들어갔는지(활용꼴 포함, 앱의 aiMark),
// 한 줄에 뜻을 몰아 쓰지 않았는지, 줄마다 앱의 문장 검사(aiLineWhy: 영어·기호·끝맺음·반복 …), 설명 글('써 드릴게요'), 같은 줄 되풀이.
// 이야기가 앞뒤가 맞는지(개연성)는 사람이(또는 Claude가) 읽고 판단해요.
//
// 브라우저 + WebLLM(앱이 쓰는 것 그대로). WG_BROWSER=chrome 이면 설치된 크롬(진짜 그래픽 칩)으로 띄워요.
// WG_MODEL=f16|f32 (기본 f16: 휴대폰과 같은 16비트), WG_CHUNK=<토큰> (기본 8: 휴대폰처럼 잘게 나눠 읽기).
// 모델 저장소는 app-run.cjs와 같은 폴더·포트를 써서, 전에 받아 둔 모델을 다시 받지 않아요.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const REPO = path.join(__dirname, '..', '..');
const GAME = path.join(REPO, 'word-game');
const MODEL = process.env.WG_MODEL || 'f16', CHUNK = process.env.WG_CHUNK == null ? 8 : +process.env.WG_CHUNK || 0;
const PROFILE = process.env.WG_PROFILE || path.join(os.tmpdir(), 'wg-app-run-profile');
const PORT = +process.env.WG_PORT || 43118; // 모델 저장소는 주소마다 따로라서 app-run.cjs와 같은 포트로
const NS = process.argv.slice(2).map(Number).filter(n => n >= 1 && n <= 5);
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

// 이야기 하나 (페이지 안에서 돌아요): 요청 글을 만들어 이야기 AI에 묻고, 답을 앱의 함수로 점검해요
const STORY = async ({ set, n }) => {
  const ws = set.slice(0, n), lines = n + 2;
  const list = ws.map(w => `‘${w[1]}’`).join(', ');
  const prompt = `어린이 그림책에 실을 짧은 이야기를 써 주세요.
꼭 넣을 말: ${list}
- 첫 줄은 이야기 제목이에요.
- 그다음 줄부터 이야기를 ${lines}줄 써요. 한 줄에 한 문장씩.
- ${n > 1 ? '꼭 넣을 말은 이야기 둘째 줄부터 한 줄에 하나씩, 적힌 순서대로 넣어요.' : '꼭 넣을 말은 이야기 둘째 줄에 넣어요.'} 말 끝은 문장에 맞게 바꿔도 돼요(먹다 → 먹었어요).
- 앞 줄에서 일어난 일 때문에 다음 줄의 일이 일어나게 써요.
- 문장 끝은 '~요'로 해요. 영어, 괄호, 번호, 설명 글, 욕설, 다치는 장면은 쓰지 않아요.`;
  const t0 = performance.now();
  let text = '', first = 0, tokens = 0, usage = null, err = '';
  try {
    const reply = await AI.engine.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, top_p: 0.9, max_tokens: 100 + 60 * (lines + 1), stream: true, stream_options: { include_usage: true } });
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
    await page.evaluate(m => { AI.gpu = true; AI.gpuWhy = ''; AI.model = m === 'f32' ? AI_MODEL_F32 : AI_MODEL; }, MODEL);
    const t0 = Date.now();
    log('loading the story AI…');
    const ready = page.evaluate(() => aiLoad(p => { window.__prog = Math.round(p * 100); }).then(() => ({ model: AI.engineId, gpu: AI.gpuName })));
    let done = false, last = '';
    ready.finally(() => { done = true; });
    while (!done) { await new Promise(r => setTimeout(r, 15000)); const pr = await page.evaluate(() => window.__prog).catch(() => null); if (!done && pr !== last) { last = pr; log('  load', pr + '%'); } }
    const info = await ready;
    if (CHUNK) await page.evaluate(c => aiChunkSet(c), CHUNK);
    log('ready', JSON.stringify(info), `chunk ${CHUNK || '모델 그대로'}`, Math.round((Date.now() - t0) / 1000) + 's');
    say(`# 단어 몇 개까지 이야기를 혼자 쓰나 · ${info.model} · 조각 ${CHUNK || '모델 그대로'}토큰 · ${out.started.slice(0, 16)}`);
    for (const n of NS.length ? NS : [5, 4, 3, 2, 1]) {
      const rs = [];
      for (let s = 0; s < SETS.length; s++) for (let k = 0; k < TRIES; k++) {
        const r = await page.evaluate(STORY, { set: SETS[s], n });
        r.set = 'ABC'[s]; r.try = k + 1; rs.push(r); out.runs.push(r);
        fs.writeFileSync(OUT + '.json', JSON.stringify(out, null, 1));
        say(`\n[단어 ${n}개 · 묶음 ${r.set} · ${r.try}번째] ${r.ok ? '형식 통과' : '형식 실패: ' + r.why.join(' · ')}${r.ok && !r.order ? ' (순서 다름)' : ''} · ${(r.ms / 1000).toFixed(1)}초`);
        say(`  넣을 말: ${r.words.join(', ')}`);
        say(`  제목: ${r.title || '(없음)'}`);
        r.body.forEach((l, i) => say(`  ${i + 1}. ${l}`));
        if (!r.title && !r.body.length) say(`  (답 원문) ${String(r.raw).slice(0, 300).replace(/\n/g, ' / ')}`);
      }
      say(`\n== 단어 ${n}개: 형식 통과 ${rs.filter(r => r.ok).length}/${rs.length}편 ==`);
    }
    const byN = {};
    for (const r of out.runs) { const b = byN[r.n] || (byN[r.n] = [0, 0]); b[0] += r.ok ? 1 : 0; b[1]++; }
    say('\n# 요약 (형식 통과 / 시도) — 이야기가 앞뒤가 맞는지는 위 이야기를 읽고 판단해요');
    for (const n of Object.keys(byN).sort((a, b) => b - a)) say(`  단어 ${n}개: ${byN[n][0]}/${byN[n][1]}`);
    if (errs.length) say('page errors: ' + errs.slice(0, 5).join(' | '));
    log('done →', OUT + '.txt');
  } finally { await ctx.close(); srv.close(); }
}

if (require.main === module) main().catch(e => { console.error('FAILED', e); process.exit(1); });
module.exports = { STORY, SETS };
