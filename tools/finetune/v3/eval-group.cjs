// 묶음 짜기 재기 (2026-11-06, 서버 11판 /group). 사용자: "뉴런은 단어들을 한 장면에 어울리는 묶음으로 모으는 것에 집중해 줘.
// 보여 주는 이야기 묶음은 2개뿐이어도 좋아" (좋아를 받은 2편은 단어 6개가 처음부터 한 장면에 모이는 묶음이었어요).
// 시험 묶음 몇 개를 합친 단어장(30개쯤)을 보내 6개씩 한 장면 묶음을 받고, --review면 그 묶음을 한 번 더 따져 보게 해요.
// 그다음 앞쪽 묶음 --stories개를 그 장면대로 이야기로 써요 (앱처럼 표시를 붙이고 점검기로 봐요. 이어짐은 사용자가 판정).
//
//   NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> \
//   node tools/finetune/v3/eval-group.cjs <이름> --sets=1,2,3,4,5 [--effort=medium] [--review] [--stories=1] [--style=twist]
// 결과: tools/story-lab/grp-<이름>.txt / .json (저장소에 넣지 않아요). 하루 무료 한도(429)면 멈춰요.
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const { REPO, TEST_SETS, parse, check, retag, bootPage } = require('./check.cjs');
const { client, neurons } = require('./server-client.cjs');

const arg = (k, d) => { const a = process.argv.find(x => x === '--' + k || x.startsWith('--' + k + '=')); return a == null ? d : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true; };
const NAME = process.argv.slice(2).find(a => !a.startsWith('--')) || 'run';
const API = (process.env.WG_STORY || '').replace(/\/$/, '');
if (!API) { console.error('WG_STORY=<이야기 서버 주소>와 WG_TOKEN=<열쇠>를 주세요'); process.exit(2); }
const SETS = String(arg('sets', '1,2,3,4,5')).split(',').map(Number).filter(n => n >= 1 && n <= TEST_SETS.length);
const MODEL = arg('model', '@cf/nvidia/nemotron-3-120b-a12b'), EFFORT = arg('effort', 'medium'), REVIEW = !!arg('review');
const STORIES = Number(arg('stories', 1)) || 0, STYLE = arg('style', 'twist');
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
  const missing = WORDS.filter(w => !used.has(w[0].toLowerCase())).map(w => w[0]);
  if (missing.length) problems.push(`빠진 단어: ${missing.join(', ')}`);
  for (const [i, g] of groups.entries()) if (g.words.length < 5 || g.words.length > 7) problems.push(`묶음 ${i + 1}: 단어 ${g.words.length}개`);
  return { groups, problems, missing };
}
// 빠진 단어는 가장 작은 묶음에 넣어요 (이야기를 쓸 수 있게. 고친 것은 적어 둬요)
function patch(r) {
  const groups = r.groups.map(g => ({ ...g, words: g.words.slice() })), notes = [];
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
  const p = bootPage(), txt = [], res = { name: NAME, sets: SETS, model: MODEL, effort: EFFORT, style: STYLE, words: WORDS.map(w => [w[0], w[1]]), passes: [], stories: [], steps: [] };
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  const save = () => { res.neurons = Math.round(neurons(res.steps)); fs.writeFileSync(OUT + '.json', JSON.stringify(res, null, 1)); };
  const showGroups = (title, r) => {
    say(`\n## ${title}${r.problems.length ? ' · 문제: ' + r.problems.join(' · ') : ' · 문제 없음'}`);
    r.groups.forEach((g, i) => { say(`[묶음 ${i + 1}] ${g.scene}`); g.words.forEach(x => say(`  - ${x.word} (${byEn.get(x.word.toLowerCase())[1]}): ${x.event}`)); });
  };
  say(`# 묶음 짜기 재기 · ${NAME} · 시험 묶음 ${SETS.join(',')} → 단어 ${WORDS.length}개 · ${MODEL.split('/').pop()} 생각 ${EFFORT}${REVIEW ? ' · 다시 따지기' : ''} · 이야기 ${STORIES}편 (${STYLE}) · ${new Date().toISOString().slice(0, 16)}`);
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
    const g1 = await ask('/group', { words: WORDS, model: MODEL, effort: EFFORT, stream: true }, '묶기');
    let r = readGroups(W.parseJSON(g1.text));
    res.passes.push({ step: 'group', rescued: !!g1.rescued, ...r, thinking: g1.rescued ? g1.notes : g1.reasoning, raw: g1.text });
    showGroups(`묶기${g1.rescued ? ' (생각이 끊겨 메모로 다시 씀)' : ''}`, r); save();
    // 2) 다시 따지기
    if (REVIEW && r.groups.length) {
      const g2 = await ask('/group', { words: WORDS, model: MODEL, effort: EFFORT, stream: true, draft: JSON.stringify({ groups: r.groups }) }, '다시 따지기');
      const r2 = readGroups(W.parseJSON(g2.text));
      res.passes.push({ step: 'review', rescued: !!g2.rescued, ...r2, thinking: g2.rescued ? g2.notes : g2.reasoning, raw: g2.text });
      showGroups(`다시 따지기${g2.rescued ? ' (생각이 끊겨 메모로 다시 씀)' : ''}`, r2);
      if (r2.groups.length) r = r2; else say('(다시 따진 답을 못 읽어서 처음 묶음을 써요)');
      save();
    }
    const fin = patch(r);
    res.final = fin.groups; res.patched = fin.notes;
    if (fin.notes.length) say(`\n고친 것: ${fin.notes.join(' · ')}`);
    save();
    // 3) 앞쪽 묶음으로 이야기 (그 장면대로)
    for (const [i, g] of fin.groups.slice(0, STORIES).entries()) {
      const gw = g.words.map(x => byEn.get(x.word.toLowerCase()));
      const st = { group: i + 1, words: gw.map(w => w[0]), ko: gw.map(w => w[1]), scene: sceneText(g) };
      try {
        const x = await ask('/story', { words: gw, model: MODEL, effort: EFFORT, format: 'plain', stream: true, style: STYLE, scene: st.scene }, `이야기 ${i + 1}`);
        const o = retag(p, gw, parse(x.text)), chk = check(p, gw, o);
        Object.assign(st, { rescued: !!x.rescued, title: o.title, plan: o.plan, lines: o.lines, pics: o.pics, retagged: o.retagged, ok: !chk.why.length, why: chk.why });
        say(`\n## 이야기 (묶음 ${i + 1})${x.rescued ? ' (생각이 끊겨 메모로 다시 씀)' : ''} · 점검 ${st.ok ? '통과' : '실패: ' + chk.why.slice(0, 4).join(' · ')}`);
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
