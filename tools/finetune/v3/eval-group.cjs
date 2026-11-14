// 묶음 짜기 재기 (2026-11-06, 서버 11판 /group). 사용자: "뉴런은 단어들을 한 장면에 어울리는 묶음으로 모으는 것에 집중해 줘.
// 보여 주는 이야기 묶음은 2개뿐이어도 좋아" (좋아를 받은 2편은 단어 6개가 처음부터 한 장면에 모이는 묶음이었어요).
// 시험 묶음 몇 개를 합친 단어장(30개쯤)을 보내 6개씩 한 장면 묶음을 받고, --review면 그 묶음을 한 번 더 따져 보게 해요.
// 그다음 앞쪽 묶음 --stories개를 그 장면대로 이야기로 써요 (앱처럼 표시를 붙이고 점검기로 봐요. 이어짐은 사용자가 판정).
//
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> \
//   node tools/finetune/v3/eval-group.cjs <이름> --sets=1,2,3,4,5 [--effort=medium] [--review] [--stories=1] [--style=twist] [--size=4]
//   --size=4 (서버 14판): 단어장 단어 4개씩 (남으면 5개까지). AI가 단어를 더하는 --free(12·13판)는 사용자 판정으로 없앴어요 (2026-11-09)
//   --from=<이름> --pick=2,6 [--title=…]: 묶지 않고 grp-<이름>.json의 묶음(AI가 더한 단어는 빼고)으로 이야기만 써요 (사용자가 고른 묶음으로)
// 결과: tools/story-lab/grp-<이름>.txt / .json (저장소에 넣지 않아요). 하루 무료 한도(429)면 멈춰요.
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { REPO, TEST_SETS, parse, check, retag, toText, bootPage } = require('./check.cjs');
const { client, neurons } = require('./server-client.cjs');

const arg = (k, d) => { const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '=')); return a == null ? d : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const NAME = process.argv.slice(2).find(a => !a.startsWith('--')) || 'run';
const API = (process.env.WG_STORY || '').replace(/\/$/, '');
if (!API) { console.error('WG_STORY=<이야기 서버 주소>와 WG_TOKEN=<열쇠>를 주세요'); process.exit(2); }
const SETS = String(arg('sets', '1,2,3,4,5')).split(',').map(Number).filter(n => n >= 1 && n <= TEST_SETS.length);
const MODEL = arg('model', '@cf/nvidia/nemotron-3-120b-a12b'), EFFORT = arg('effort', 'medium'), REVIEW = !!arg('review');
const STORIES = Number(arg('stories', 1)) || 0, STYLE = arg('style', 'twist'), SIZE = Number(arg('size', 6)) === 4 ? 4 : 6;
const FROM = arg('from'), PICK = String(arg('pick', '')).split(',').map(Number).filter(n => n >= 1), TITLE = arg('title');
// --fix=1 (2026-11-11 사용자가 정함): 점검기가 문제를 찾으면(표시가 빠진 단어 등) 그곳만 /fix로 고쳐 써요. 끊기면 생각 low로 한 번 더
const FIX = Number(arg('fix', 0)) || 0;
// --pool=a,b,c (서버 19판 pick): 묶지 않고, grp-<이름>.json들의 묶음을 후보로 모아 AI가 가장 나은 것만 고르게 해요
const POOL = String(arg('pool', '')).split(',').filter(Boolean);
const OUT = path.join(REPO, 'tools', 'story-lab', `grp-${NAME}`);

// 단어장: 고른 시험 묶음을 차례대로 합쳐요 (같은 단어는 한 번)
const WORDS = [];
for (const s of SETS) for (const w of TEST_SETS[s - 1]) if (!WORDS.some(x => x[0].toLowerCase() === w[0].toLowerCase())) WORDS.push(w);
const byEn = new Map(WORDS.map(w => [w[0].toLowerCase(), w]));

// 받은 묶음 확인: 모르는 단어·두 번 쓴 단어·빠진 단어·크기
function readGroups(j) {
  const problems = [], used = new Set(), groups = [];
  for (const g of (j && Array.isArray(j.groups) ? j.groups : [])) {
    const ws = [];
    for (const x of (g && Array.isArray(g.words) ? g.words : [])) {
      const k = String(x && (x.word ?? x) || '').trim().toLowerCase();
      if (!byEn.has(k)) { problems.push(`모르는 단어: ${String(k).slice(0, 30)}`); continue; }
      if (used.has(k)) { problems.push(`두 번 쓴 단어: ${k}`); continue; }
      used.add(k);
      ws.push({ word: byEn.get(k)[0], event: String((x && x.event) || '').trim() });
    }
    if (ws.length) groups.push({ scene: String((g && g.scene) || '').trim(), words: ws });
  }
  // 15판 size 4: 안 맞는 단어는 남은 단어(leftover)로 따로 와요 (억지로 묶지 않게)
  const leftover = [];
  for (const x of (j && Array.isArray(j.leftover) ? j.leftover : [])) {
    const k = String(x && (x.word ?? x) || '').trim().toLowerCase();
    if (byEn.has(k) && !used.has(k)) { used.add(k); leftover.push(byEn.get(k)[0]); }
  }
  const missing = WORDS.filter(w => !used.has(w[0].toLowerCase())).map(w => w[0]);
  if (missing.length) problems.push(`빠진 단어: ${missing.join(', ')}`);
  for (const [i, g] of groups.entries()) if (SIZE === 4 ? g.words.length < 4 || g.words.length > 5 : g.words.length < SIZE - 1 || g.words.length > SIZE + 1) problems.push(`묶음 ${i + 1}: 단어 ${g.words.length}개`);
  return { groups, problems, missing, leftover };
}
// 빠진 단어는 가장 작은 묶음에 넣어요 (이야기를 쓸 수 있게. 고친 것은 적어 둬요)
function patch(r) {
  const groups = r.groups.map(g => ({ ...g, words: g.words.slice() })), notes = [];
  // 15판 size 4: 빠진 단어를 묶음에 억지로 넣지 않아요 (14판에서 이렇게 넣은 묶음이 이상해졌어요) → 남은 단어로
  if (SIZE === 4) return { groups, notes: r.missing.length ? [`AI가 빠뜨린 ${r.missing.join(', ')} → 남은 단어로`] : [], leftover: [...(r.leftover || []), ...r.missing] };
  for (const en of r.missing) {
    if (!groups.length) groups.push({ scene: '', words: [] });
    const g = groups.reduce((a, b) => (b.words.length < a.words.length ? b : a));
    g.words.push({ word: en, event: '' });
    notes.push(`빠진 ${en} → 묶음 ${groups.indexOf(g) + 1}에 넣음`);
  }
  return { groups, notes };
}
const sceneText = g => `장면: ${g.scene}\n` + g.words.map(x => `- ${x.word}: ${x.event || '(이 장면에 맞게)'}`).join('\n');

async function main() {
  const W = (await import(pathToFileURL(path.join(REPO, 'server', 'story-worker', 'worker.mjs')).href)).default._;
  const c = client({ api: API, token: process.env.WG_TOKEN || '', W, rescue: true });
  const p = bootPage(), txt = [], res = { name: NAME, ...(TITLE ? { title: TITLE } : {}), sets: SETS, model: MODEL, effort: EFFORT, style: STYLE, words: WORDS.map(w => [w[0], w[1]]), passes: [], stories: [], steps: [] };
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  const save = () => { res.neurons = Math.round(neurons(res.steps)); fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1)); };
  const showGroups = (title, r) => {
    say(`\n## ${title}${r.problems.length ? ' · 문제: ' + r.problems.join(' · ') : ' · 문제 없음'}`);
    r.groups.forEach((g, i) => { say(`[묶음 ${i + 1}] ${g.scene} (${g.words.length}개)`); g.words.forEach(x => say(`  - ${x.word} (${byEn.get(x.word.toLowerCase())[1]}): ${x.event}`)); });
    if (r.leftover && r.leftover.length) say(`[남은 단어] ${r.leftover.map(en => `${en} (${byEn.get(en.toLowerCase())[1]})`).join(', ')}`);
  };
  say(`# 묶음 짜기 재기 · ${NAME} · 시험 묶음 ${SETS.join(',')} → 단어 ${WORDS.length}개 · ${MODEL.split('/').pop()} 생각 ${EFFORT}${SIZE !== 6 ? ` · ${SIZE}개씩` : ''}${FROM ? ` · ${FROM}의 묶음 ${PICK.join(',')}로 이야기만` : ''}${REVIEW ? ' · 다시 따지기' : ''} · 이야기 ${STORIES}편 (${STYLE}) · ${new Date().toISOString().slice(0, 16)}`);
  try {
    const ask = async (route, body, label) => {
      try {
        const r = await c.ask(route, body);
        res.steps.push(...(r.steps || []));
        return r;
      } catch (e) {
        res.steps.push(...(e.steps || (e.step ? [e.step] : [])));
        throw Object.assign(e, { label });
      }
    };
    // 1) 묶기
    let r;
    if (POOL.length) {
      const cands = [];
      for (const n of POOL) for (const g of JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'story-lab', `grp-${n}.json`), 'utf8')).final || []) {
        const ws = g.words.filter(x => !x.added && x.event && byEn.has(x.word.toLowerCase()));
        if (ws.length >= 4) cands.push({ from: n, scene: g.scene, words: ws.map(x => ({ word: x.word, event: x.event })) });
      }
      res.candidates = cands;
      say(`\n후보 묶음 ${cands.length}개 (${POOL.join(', ')})`);
      const g1 = await ask('/group', { words: WORDS, model: MODEL, effort: EFFORT, stream: true, size: SIZE, pick: true, draft: JSON.stringify({ candidates: cands.map(({ scene, words }) => ({ scene, words })) }) }, '후보에서 고르기');
      r = readGroups(W.parseJSON(g1.text));
      // 고른 묶음이 어느 후보인지 (단어가 같은 후보)
      const key = g => g.words.map(x => x.word.toLowerCase()).sort().join(',');
      r.groups.forEach(g => { const c = cands.find(c => key(c) === key(g)); g.from = c ? c.from : '(새로 만듦)'; });
      res.passes.push({ step: 'pick', rescued: !!g1.rescued, ...r, raw: g1.text });
      showGroups('후보에서 고르기', r);
      r.groups.forEach((g, i) => say(`  묶음 ${i + 1} ← ${g.from}`));
    } else if (FROM) {
      // 사용자가 고른 묶음으로 이야기만: AI가 더한 단어는 빼요 (14판, 사용자 판정)
      const src = JSON.parse(fs.readFileSync(path.join(REPO, 'tools', 'story-lab', `grp-${FROM}.json`), 'utf8'));
      const groups = PICK.map(n => src.final[n - 1]).filter(Boolean).map(g => ({ scene: g.scene, words: g.words.filter(x => !x.added && byEn.has(x.word.toLowerCase())) }));
      r = { groups, problems: [], missing: [] };
      res.from = { name: FROM, pick: PICK };
      showGroups(`${FROM}의 묶음 ${PICK.join(',')} (AI가 더한 단어는 뺌)`, r);
    } else {
      const g1 = await ask('/group', { words: WORDS, model: MODEL, effort: EFFORT, stream: true, ...(SIZE !== 6 ? { size: SIZE } : {}) }, '묶기');
      r = readGroups(W.parseJSON(g1.text));
      res.passes.push({ step: 'group', rescued: !!g1.rescued, ...r, thinking: g1.rescued ? g1.notes : g1.reasoning, raw: g1.text });
      showGroups(`묶기${g1.rescued ? ' (생각이 끊겨 메모로 다시 씀)' : ''}`, r);
    }
    save();
    // 2) 다시 따지기
    if (REVIEW && !FROM && r.groups.length) {
      const g2 = await ask('/group', { words: WORDS, model: MODEL, effort: EFFORT, stream: true, draft: JSON.stringify({ groups: r.groups, leftover: [...(r.leftover || []), ...(r.missing || [])] }), ...(SIZE !== 6 ? { size: SIZE } : {}) }, '다시 따지기');
      const r2 = readGroups(W.parseJSON(g2.text));
      res.passes.push({ step: 'review', rescued: !!g2.rescued, ...r2, thinking: g2.rescued ? g2.notes : g2.reasoning, raw: g2.text });
      showGroups(`다시 따지기${g2.rescued ? ' (생각이 끊겨 메모로 다시 씀)' : ''}`, r2);
      if (r2.groups.length) r = r2; else say('(다시 따진 답을 못 읽어서 처음 묶음을 써요)');
      save();
    }
    const fin = FROM ? { groups: r.groups, notes: [] } : patch(r);
    res.final = fin.groups; res.patched = fin.notes; res.leftover = fin.leftover || [];
    if (fin.notes.length) say(`\n고친 것: ${fin.notes.join(' · ')}`);
    save();
    // 3) 앞쪽 묶음으로 이야기 (그 장면대로)
    // 이야기를 쓸 묶음: 앞쪽부터 (단어 3개 이상인 묶음만: 서버 /story는 3~10개)
    const writable = fin.groups.map((g, i) => [g, i]).filter(([g]) => g.words.length >= 3 && g.words.length <= 10);
    for (const [g, i] of writable.slice(0, STORIES)) {
      const gw = g.words.map(x => byEn.get(x.word.toLowerCase()));
      const st = { group: FROM ? PICK[i] : i + 1, words: gw.map(w => w[0]), ko: gw.map(w => w[1]), scene: sceneText(g) };
      try {
        const x = await ask('/story', { words: gw, model: MODEL, effort: EFFORT, format: 'plain', stream: true, style: STYLE, scene: st.scene }, `이야기 ${i + 1}`);
        let o = retag(p, gw, parse(x.text)), chk = check(p, gw, o);
        const firstWhy = chk.why;
        // 고쳐 쓰기: 점검기가 찾은 문제만 (표시가 빠진 단어·사전 꼴 등)
        const fixes = [];
        for (let f = 0; f < FIX && chk.why.length; f++) {
          const fb = { words: gw, story: toText(o), problems: chk.why.slice(0, 40).map(w => w.slice(0, 200)), model: MODEL, format: 'plain', style: STYLE, stream: true };
          let y;
          try { y = await ask('/fix', { ...fb, effort: EFFORT }, `고쳐 쓰기 ${i + 1}`); } catch (e) { if (e.stop || !e.cut) throw e; y = await ask('/fix', { ...fb, effort: 'low' }, `고쳐 쓰기 ${i + 1}`); }
          o = retag(p, gw, parse(y.text)); chk = check(p, gw, o);
          fixes.push({ ok: !chk.why.length, why: chk.why });
        }
        Object.assign(st, { rescued: !!x.rescued, continued: x.continued, title: o.title, plan: o.plan, lines: o.lines, pics: o.pics, retagged: o.retagged, ok: !chk.why.length, why: chk.why, firstWhy, fixes });
        const how = x.rescued ? (x.continued ? ` (생각이 끊겨 ${x.continued}번 이어 생각함)` : ' (생각이 끊겨 메모로 다시 씀)') : '';
        say(`\n## 이야기 (묶음 ${i + 1})${how} · 점검 ${st.ok ? '통과' : '실패: ' + chk.why.slice(0, 4).join(' · ')}${fixes.length ? ` (고쳐 쓰기 ${fixes.length}번, 처음 문제: ${firstWhy.slice(0, 3).join(' · ')})` : ''}`);
        say(`제목: ${o.title}`); say(`줄거리: ${o.plan}`); o.lines.forEach((l, k) => say(`  ${k + 1}. ${l}`));
      } catch (e) {
        if (e.stop) throw e;
        Object.assign(st, { err: String(e.message || e) });
        say(`\n## 이야기 (묶음 ${i + 1}) 오류: ${st.err}`);
      }
      res.stories.push(st); save();
    }
  } catch (e) {
    say(`\n${e.stop ? e.message + ' → 멈춰요 (한국 시간 오전 9시에 다시 채워져요)' : `${e.label || ''} 오류: ${e.message || e}`}`);
    res.err = String(e.message || e);
  } finally { p.close(); save(); }
  say(`\n== ${NAME}: 묶음 ${(res.final || []).length}개 · 문제 ${(res.passes.at(-1) || { problems: [] }).problems.length}개 · 이야기 ${res.stories.filter(s => s.lines).length}편 (점검 통과 ${res.stories.filter(s => s.ok).length}) · ${res.neurons} Neuron${res.steps.some(s => s.est) ? '(어림 섞임)' : ''} ==`);
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
