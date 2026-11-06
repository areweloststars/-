// 이야기 서버 재기 (2026-10-31, 5~8번 실험): 서버(server/story-worker)에 단어를 보내 이야기를 받고, 앱 점검기(check.cjs)로 보고,
// 틀리면 /fix로 그곳만 고쳐 달라고 해요 (6번). 점검 전에 앱처럼 표시를 붙여요 (retag: AI가 뜻 말 칸을 문장과 다르게 적어도 앱의 aiMark로 찾아요). 꼴(text·json, 5번)·뼈대 먼저(plan, 8번)·작가+편집자(drafts·editor, 7번)를 골라 견줘요.
// 이야기가 이어지는지·뜻이 맞는지·재미있는지는 결과 글을 읽고 판정해요 (게임에 넣는 기준: 30편 가운데 27편).
//
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//   WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> node tools/finetune/v3/eval-server.cjs <이름> \
//     --model=@cf/google/gemma-4-26b-a4b-it [--effort=none] [--format=json] [--plan] \
//     [--drafts=3 --editor=@cf/nvidia/nemotron-3-120b-a12b --editor-effort=none] [--fix=2] [--sets=6,8] [--tries=2] [--regroup]
//     [--format=plain] [--stream]   ← 서버 7판: 표시 없이 쓰기(점검 전에 앱처럼 표시를 붙여요), 흘려 받기(생각 보통이 끊기지 않게)
//     [--style=simple]   ← 서버 10판: 쉬운 이야기 꼴 (한 인물이 한 가지 일을 차례로)
//     [--rescue]   ← 서버 8판: 흘려 받기가 120초에서 끊겨 답이 없거나 망가지면, 모은 생각 글을 메모(notes)로 보내 생각 끔으로 다시 써요
// 결과: tools/story-lab/srv-<이름>.txt / .json (저장소에 넣지 않아요). 하루 무료 한도(429)면 멈춰요.
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { REPO, TEST_SETS, parse, check, retag, toText, bootPage } = require('./check.cjs');

const arg = (k, d) => { const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '=')); return a == null ? d : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const NAME = process.argv.slice(2).find(a => !a.startsWith('--')) || 'run';
const API = (process.env.WG_STORY || '').replace(/\/$/, '');
if (!API) { console.error('WG_STORY=<이야기 서버 주소>와 WG_TOKEN=<열쇠>를 주세요'); process.exit(2); }
const SETS = arg('regroup') ? require('./regroup-prompts.json').map(s => s.words) : TEST_SETS;
const PICK = String(arg('sets', '')).split(',').map(Number).filter(n => n >= 1 && n <= SETS.length);
const TRIES = Number(arg('tries', 1)) || 1, FIX = Number(arg('fix', 2)) || 0, RESCUE = !!arg('rescue');
const ASK = { model: arg('model'), effort: arg('effort'), format: arg('format', 'json'), plan: !!arg('plan'), drafts: Number(arg('drafts', 1)) || 1, editor: arg('editor'), editorEffort: arg('editor-effort'), stream: !!arg('stream'), style: arg('style') };
for (const k of Object.keys(ASK)) if (ASK[k] == null || ASK[k] === false || (k === 'drafts' && ASK[k] === 1)) delete ASK[k];
const OUT = path.join(REPO, 'tools', 'story-lab', `srv-${NAME}`);

// 하루 무료 10,000 Neuron을 얼마나 쓰는지: Cloudflare 요금표(2026-10-31)의 백만 토큰당 Neuron (입력, 출력)
const PRICES = {
  '@cf/openai/gpt-oss-120b': [31818, 68182],
  '@cf/google/gemma-4-26b-a4b-it': [9091, 27273],
  '@cf/zai-org/glm-4.7-flash': [5500, 36400],
  '@cf/nvidia/nemotron-3-120b-a12b': [45455, 136364],
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': [26668, 204805],
  '@cf/qwen/qwen3.8-27b': [40909, 290909],
  '@cf/mistralai/mistral-small-3.1-24b-instruct': [31876, 50488]
};
const neurons = steps => steps.reduce((a, s) => { const p = PRICES[s.model]; return p && s.in != null ? a + (s.in * p[0] + (s.out || 0) * p[1]) / 1e6 : a; }, 0);

// 흘려 받기 글 읽기 (서버 7판 stream): 답 글(content)과 생각 글(reasoning_content)을 따로 모아요. 쓴 토큰은 마지막 조각(usage)에
function readSSE(raw) {
  let text = '', usage = null, think = 0, reasoning = '', err = '';
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/^data:\s?(.*)$/), d = m && m[1].trim();
    if (!d || d === '[DONE]') continue;
    let j;
    try { j = JSON.parse(d); } catch { continue; }
    if (j.error || j.errors) err = JSON.stringify(j.error || j.errors).slice(0, 300);
    const c = j.choices && j.choices[0], dl = c && (c.delta || c.message);
    if (dl) { if (typeof dl.content === 'string') text += dl.content; const t = String(dl.reasoning_content || dl.reasoning || ''); think += t.length; reasoning += t; }
    else if (typeof j.response === 'string') text += j.response;
    if (j.usage) usage = j.usage;
  }
  return { text, usage, think, reasoning, err };
}
// 120초에서 끊기면 마지막 조각(usage)이 오지 않아요 → 토큰을 어림해요 (2026-11-04 잰 값: 쓰기 요청 입력 1,345토큰쯤, 생각 글 3.2자·답 글 1.5자에 1토큰쯤)
let lastIn = 1345;
let W = null; // 서버 코드의 _ (clean·broken): 흘려 받은 글을 서버의 한 번 쓰기와 똑같이 다듬어요
async function postOnce(route, body) {
  const t0 = Date.now();
  const r = await fetch(API + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.WG_TOKEN || '') }, body: JSON.stringify(body) });
  if (r.ok && /event-stream/i.test(r.headers.get('content-type') || '')) {
    const s = readSSE(await r.text()), u = s.usage || {};
    if (u.prompt_tokens && route === '/story' && !body.notes) lastIn = u.prompt_tokens;
    const step = { step: route === '/fix' ? 'fix' : 'write', model: body.model || W.MODELS[0], effort: body.effort, ms: Date.now() - t0, think: s.think,
      in: u.prompt_tokens ?? (body.notes ? lastIn + Math.round(body.notes.length / 3.2) : lastIn), out: u.completion_tokens ?? Math.round(s.think / 3.2 + s.text.length / 1.5), ...(s.usage ? {} : { est: true }) };
    if (!s.text.trim()) throw Object.assign(new Error(`흘려 받은 답이 비었어요${s.err ? ': ' + s.err : ''} (생각 글 ${s.think}자, ${(step.ms / 1000).toFixed(0)}초)`), { server: true, cut: true, reasoning: s.reasoning, step });
    return { text: W.clean(s.text), stream: true, reasoning: s.reasoning, steps: [step] };
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) { const e = new Error('하루 무료 한도: ' + String(j.error || '').slice(0, 160)); e.stop = true; throw e; }
  if (!r.ok) throw Object.assign(new Error(`서버 ${r.status}: ${String(j.error || '').slice(0, 300)}${j.shape ? ' ' + JSON.stringify(j.shape) : ''}`), { server: true });
  return j;
}
// 연결이 끊긴 것(fetch failed·terminated)만 한 번 더 물어요: 이 세션의 프록시가 긴 연결을 끊은 적이 있어요 (2026-11-03, 277초 뒤 server_draining).
// 서버가 준 오류·하루 한도는 다시 묻지 않아요
async function post(route, body) {
  try { return await postOnce(route, body); } catch (e) {
    if (e.stop || e.server) throw e;
    return postOnce(route, body);
  }
}
// 흘려 받은 답이 망가졌으면 한 번 더 물어요 (서버가 한 번에 받을 때 writeStory·fix가 하는 것과 같게).
// --rescue면 같은 것을 다시 묻지 않고, 끊기기 전까지 모은 생각 글을 메모로 보내 생각 끔으로 써요 (서버 8판 notes)
async function askServer(route, body) {
  let r;
  try { r = await post(route, body); } catch (e) {
    if (!(RESCUE && route === '/story' && e.cut)) throw e;
    return rescue(body, e.reasoning, [e.step]);
  }
  if (!r.stream || !W.broken(r.text)) return r;
  if (RESCUE && route === '/story') return rescue(body, r.reasoning, r.steps);
  const again = await post(route, body);
  return { ...again, steps: [...r.steps, ...again.steps.map(s => ({ ...s, step: s.step + '-again' }))] };
}
async function rescue(body, reasoning, before) {
  const notes = String(reasoning || '').trim().slice(-W.MAX_NOTES).trim();
  if (!notes) throw Object.assign(new Error('끊긴 흘려 받기에 생각 글도 없어요'), { server: true, steps: before });
  try {
    const x = await post('/story', { ...body, effort: 'none', notes });
    return { ...x, rescued: true, notes, steps: [...before, ...x.steps.map(s => ({ ...s, step: 'rescue' }))] };
  } catch (e) {
    // 다시 쓰기도 안 되면 끊긴 첫 요청과 다시 쓰기 요청을 모두 세고, 다시 쓰기의 생각 글을 남겨요 (까닭을 보려고)
    throw Object.assign(e, { message: '생각 메모로 다시 썼지만 ' + e.message, steps: [...before, ...(e.step ? [{ ...e.step, step: 'rescue' }] : [])], rescueThinking: e.reasoning, notes, step: undefined });
  }
}

async function main() {
  W = (await import(pathToFileURL(path.join(REPO, 'server', 'story-worker', 'worker.mjs')).href)).default._;
  const p = bootPage(), txt = [], runs = [];
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  const save = () => fs.writeFileSync(OUT + '.json', JSON.stringify({ name: NAME, ask: ASK, fix: FIX, runs }, null, 1));
  say(`# 이야기 서버 재기 · ${NAME} · ${JSON.stringify(ASK)} · 고쳐 쓰기 ${FIX}번까지${arg('regroup') ? ' · 주제 묶음' : ''} · ${new Date().toISOString().slice(0, 16)}`);
  const sets = PICK.length ? PICK : SETS.map((_, i) => i + 1);
  try {
    outer: for (const s of sets) for (let k = 0; k < TRIES; k++) {
      const words = SETS[s - 1], t0 = Date.now(), steps = [];
      const run = { set: s, try: k + 1, words: words.map(w => w[0]), ko: words.map(w => w[1]) };
      try {
        const r = await askServer('/story', { words, ...ASK });
        steps.push(...(r.steps || []));
        // 앱처럼 표시를 붙이고 점검해요
        const look = t => { const o = retag(p, words, parse(t)); return { text: toText(o), c: check(p, words, o), retagged: o.retagged }; };
        let L = look(r.text), text = L.text, c = L.c;
        Object.assign(run, { skeleton: r.plan, drafts: r.drafts, edited: r.edited, rescued: r.rescued, thinking: r.rescued ? r.notes : r.reasoning, rawOk: !check(p, words, parse(r.text)).why.length, first: { ok: !c.why.length, why: c.why, text, retagged: L.retagged } });
        const fixes = [];
        for (let f = 0; f < FIX && c.why.length; f++) {
          const x = await askServer('/fix', { words, story: text, problems: c.why.slice(0, 40).map(w => w.slice(0, 200)), ...(ASK.model ? { model: ASK.model } : {}), ...(ASK.effort ? { effort: ASK.effort } : {}), format: ASK.format || 'json', ...(ASK.stream ? { stream: true } : {}), ...(ASK.style ? { style: ASK.style } : {}) });
          steps.push(...(x.steps || []));
          L = look(x.text); text = L.text; c = L.c;
          fixes.push({ ok: !c.why.length, why: c.why, retagged: L.retagged });
        }
        Object.assign(run, { fixes, ok: !c.why.length, why: c.why, warn: c.warn, text, ...parse(text) });
      } catch (e) {
        if (e.stop) { say('\n' + e.message + ' → 멈춰요 (한국 시간 오전 9시에 다시 채워져요)'); break outer; }
        if (e.steps) steps.push(...e.steps); else if (e.step) steps.push(e.step); // 끊긴 요청도 무료 한도를 써요 (어림)
        Object.assign(run, { ok: false, err: String((e && e.message) || e), first: { ok: false, why: [] }, ...(e.notes ? { thinking: e.notes, rescueThinking: e.rescueThinking } : {}) });
      }
      Object.assign(run, { steps, neurons: Math.round(neurons(steps)), ms: Date.now() - t0 });
      runs.push(run); save();
      say(`\n[묶음 ${s} · ${k + 1}번째]${run.rescued ? ' (생각이 120초에서 끊겨 생각 메모로 다시 씀)' : ''} 처음 ${run.first.ok ? '통과' : '실패'}${run.first.retagged && run.first.retagged.length ? ` (앱이 표시 붙임: ${run.first.retagged.join(', ')})` : ''} → ${run.ok ? '통과' : '실패'}${run.fixes && run.fixes.length ? ` (고쳐 쓰기 ${run.fixes.length}번)` : ''} · ${run.neurons} Neuron${steps.some(x => x.est) ? '(어림)' : ''} · ${(run.ms / 1000).toFixed(0)}초`);
      if (run.err) { say('  오류: ' + run.err); continue; }
      if (!run.first.ok) say('  처음 실패: ' + run.first.why.slice(0, 6).join(' · '));
      if (!run.ok) say('  남은 실패: ' + run.why.slice(0, 6).join(' · '));
      say(`  단어: ${words.map(w => w[0] + ' ' + w[1]).join(', ')}`);
      if (run.skeleton) say(`  뼈대: ${run.skeleton.source} / ${run.skeleton.hero} / ${run.skeleton.problem} → ${run.skeleton.solution}`);
      if (run.drafts) say(`  초안 ${run.drafts.length}편: ${run.drafts.map(d => (d.match(/^제목:\s*(.*)$/m) || [])[1] || '?').join(' / ')} → 편집 ${run.edited ? '함' : '못 함(첫 초안)'}`);
      say(`  제목: ${run.title || '(없음)'}`);
      say(`  줄거리: ${run.plan || '(없음)'}`);
      run.lines.forEach((l, i) => say(`  ${i + 1}. ${l}`));
      run.pics.forEach(pc => say(`  [그림 ${pc.en || '?'}] ${pc.text}`));
    }
  } finally { p.close(); save(); }
  const n = runs.length, avg = f => (n ? runs.reduce((a, r) => a + f(r), 0) / n : 0);
  say(`\n== ${NAME}: 처음 통과 ${runs.filter(r => r.first && r.first.ok).length}/${n} → 고쳐 쓴 뒤 ${runs.filter(r => r.ok).length}/${n}${RESCUE ? ` · 생각 메모로 다시 씀 ${runs.filter(r => r.rescued).length}편` : ''}` +
    ` · 한 편 평균 ${Math.round(avg(r => r.neurons || 0))} Neuron (하루 무료로 ${avg(r => r.neurons || 0) ? Math.floor(10000 / avg(r => r.neurons || 0)) : '?'}편쯤) · ${(avg(r => r.ms) / 1000).toFixed(0)}초 ==`);
  say('이야기가 이어지는지·뜻이 맞게 쓰였는지·재미있는지는 위 글을 읽고 판정해요 (기준: 30편 가운데 27편).');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
