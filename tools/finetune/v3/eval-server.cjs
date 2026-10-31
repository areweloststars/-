// 이야기 서버 재기 (2026-10-31, 5~8번 실험): 서버(server/story-worker)에 단어를 보내 이야기를 받고, 앱 점검기(check.cjs)로 보고,
// 틀리면 /fix로 그곳만 고쳐 달라고 해요 (6번). 꼴(text·json, 5번)·뼈대 먼저(plan, 8번)·작가+편집자(drafts·editor, 7번)를 골라 견줘요.
// 이야기가 이어지는지·뜻이 맞는지·재미있는지는 결과 글을 읽고 판정해요 (게임에 넣는 기준: 30편 가운데 27편).
//
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
//   WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> node tools/finetune/v3/eval-server.cjs <이름> \
//     --model=@cf/google/gemma-4-26b-a4b-it [--effort=none] [--format=json] [--plan] \
//     [--drafts=3 --editor=@cf/nvidia/nemotron-3-120b-a12b --editor-effort=none] [--fix=2] [--sets=6,8] [--tries=2] [--regroup]
// 결과: tools/story-lab/srv-<이름>.txt / .json (저장소에 넣지 않아요). 하루 무료 한도(429)면 멈춰요.
const fs = require('node:fs'), path = require('node:path');
const { REPO, TEST_SETS, parse, check, bootPage } = require('./check.cjs');

const arg = (k, d) => { const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '=')); return a == null ? d : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const NAME = process.argv.slice(2).find(a => !a.startsWith('--')) || 'run';
const API = (process.env.WG_STORY || '').replace(/\/$/, '');
if (!API) { console.error('WG_STORY=<이야기 서버 주소>와 WG_TOKEN=<열쇠>를 주세요'); process.exit(2); }
const SETS = arg('regroup') ? require('./regroup-prompts.json').map(s => s.words) : TEST_SETS;
const PICK = String(arg('sets', '')).split(',').map(Number).filter(n => n >= 1 && n <= SETS.length);
const TRIES = Number(arg('tries', 1)) || 1, FIX = Number(arg('fix', 2)) || 0;
const ASK = { model: arg('model'), effort: arg('effort'), format: arg('format', 'json'), plan: !!arg('plan'), drafts: Number(arg('drafts', 1)) || 1, editor: arg('editor'), editorEffort: arg('editor-effort') };
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

async function post(route, body) {
  const r = await fetch(API + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.WG_TOKEN || '') }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) { const e = new Error('하루 무료 한도: ' + String(j.error || '').slice(0, 160)); e.stop = true; throw e; }
  if (!r.ok) throw new Error(`서버 ${r.status}: ${String(j.error || '').slice(0, 300)}${j.shape ? ' ' + JSON.stringify(j.shape) : ''}`);
  return j;
}

async function main() {
  const p = bootPage(), txt = [], runs = [];
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  const save = () => fs.writeFileSync(OUT + '.json', JSON.stringify({ name: NAME, ask: ASK, fix: FIX, runs }, null, 1));
  say(`# 이야기 서버 재기 · ${NAME} · ${JSON.stringify(ASK)} · 고쳐 쓰기 ${FIX}번까지${arg('regroup') ? ' · 주제 묶음' : ''} · ${new Date().toISOString().slice(0, 16)}`);
  const sets = PICK.length ? PICK : SETS.map((_, i) => i + 1);
  try {
    outer: for (const s of sets) for (let k = 0; k < TRIES; k++) {
      const words = SETS[s - 1], t0 = Date.now(), steps = [];
      const run = { set: s, try: k + 1, words: words.map(w => w[0]) };
      try {
        const r = await post('/story', { words, ...ASK });
        steps.push(...(r.steps || []));
        let text = r.text, c = check(p, words, parse(text));
        Object.assign(run, { skeleton: r.plan, drafts: r.drafts, edited: r.edited, first: { ok: !c.why.length, why: c.why, text } });
        const fixes = [];
        for (let f = 0; f < FIX && c.why.length; f++) {
          const x = await post('/fix', { words, story: text, problems: c.why.slice(0, 40).map(w => w.slice(0, 200)), ...(ASK.model ? { model: ASK.model } : {}), ...(ASK.effort ? { effort: ASK.effort } : {}), format: ASK.format || 'json' });
          steps.push(...(x.steps || []));
          text = x.text; c = check(p, words, parse(text));
          fixes.push({ ok: !c.why.length, why: c.why });
        }
        Object.assign(run, { fixes, ok: !c.why.length, why: c.why, warn: c.warn, text, ...parse(text) });
      } catch (e) {
        if (e.stop) { say('\n' + e.message + ' → 멈춰요 (한국 시간 오전 9시에 다시 채워져요)'); break outer; }
        Object.assign(run, { ok: false, err: String((e && e.message) || e), first: { ok: false, why: [] } });
      }
      Object.assign(run, { steps, neurons: Math.round(neurons(steps)), ms: Date.now() - t0 });
      runs.push(run); save();
      say(`\n[묶음 ${s} · ${k + 1}번째] 처음 ${run.first.ok ? '통과' : '실패'} → ${run.ok ? '통과' : '실패'}${run.fixes && run.fixes.length ? ` (고쳐 쓰기 ${run.fixes.length}번)` : ''} · ${run.neurons} Neuron · ${(run.ms / 1000).toFixed(0)}초`);
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
  say(`\n== ${NAME}: 처음 통과 ${runs.filter(r => r.first && r.first.ok).length}/${n} → 고쳐 쓴 뒤 ${runs.filter(r => r.ok).length}/${n}` +
    ` · 한 편 평균 ${Math.round(avg(r => r.neurons || 0))} Neuron (하루 무료로 ${avg(r => r.neurons || 0) ? Math.floor(10000 / avg(r => r.neurons || 0)) : '?'}편쯤) · ${(avg(r => r.ms) / 1000).toFixed(0)}초 ==`);
  say('이야기가 이어지는지·뜻이 맞게 쓰였는지·재미있는지는 위 글을 읽고 판정해요 (기준: 30편 가운데 27편).');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
