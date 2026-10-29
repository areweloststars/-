// 파인튜닝 3차 모범 답안 묶기: stories/*.json(Claude가 쓴 이야기·그림 설명) → train.jsonl, test-prompts.json.
// 점검은 check.cjs와 같고 모범 답안은 더 엄하게 (warn도 고쳐요, 제목 14자, 줄 48자).
// 요청 글의 단어 차례는 제목으로 정한 차례로 섞어요: 게임에서 단어는 아무 차례로나 오고, 이야기 차례는 AI가 정해야 해서요.
//   node tools/finetune/v3/build.cjs
// 이야기 파일: [{ "t": "제목", "plan": "줄거리 한 문장", "w": [["영어", "뜻", "품사"], …],
//               "l": ["첫 줄", "단어 줄 ({영어|뜻})" 또는 이음 줄, …, "끝 줄"], "pic": { "영어": "영어 그림 설명", … } }, …]
const fs = require('node:fs'), path = require('node:path');
const { TEST_SETS, prompt, answer, check, bootPage } = require('./check.cjs');

const dir = path.join(__dirname, 'stories');
const stories = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map((s, i) => Object.assign({ from: `${f}#${i + 1}` }, s)));
const testWords = new Set(TEST_SETS.flat().flatMap(w => [w[0].toLowerCase(), w[1]]));
// 그림 설명(영어)에도 시험 단어를 쓰지 않아요 (끝 e·y를 떼고 앞부분으로: serve → serving·server, lazy → lazily)
const testEn = new RegExp(`\\b(?:${TEST_SETS.flat().map(w => w[0].toLowerCase().replace(/[ey]$/, '')).join('|')})`, 'i');
// 제목으로 정해지는 섞기 (다시 묶어도 같은 차례)
const shuffle = (list, key) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; const j = h % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const p = bootPage();
const out = [], seenTitle = new Set();
let bad = 0;
try {
  for (const s of stories) {
    const why = [], n = s.w.length;
    if (n < 6 || n > 8) why.push(`단어 ${n}개 (6~8개)`);
    for (const [en, ko] of s.w) if (testWords.has(en.toLowerCase()) || testWords.has(ko)) why.push(`시험 단어: ${en} ${ko}`);
    for (const [en, text] of Object.entries(s.pic || {})) { const m = text.match(testEn); if (m) why.push(`그림 ${en}: 시험 단어 ${m[0]}…`); }
    if (seenTitle.has(s.t)) why.push('같은 제목');
    seenTitle.add(s.t);
    const parsed = { title: s.t, plan: s.plan || '', lines: s.l, pics: Object.entries(s.pic || {}).map(([en, text]) => ({ en, text })) };
    const r = check(p, s.w, parsed, true);
    why.push(...r.why, ...r.warn);
    // 시험 단어의 뜻이 이야기·줄거리에 지나가듯 나와도 안 돼요 (재기가 부풀어요)
    why.push(...p.json(`(() => { const T = ${JSON.stringify(TEST_SETS.flat())}, ls = ${JSON.stringify([s.plan || '', ...s.l])}.map(l => l.replace(/\\{[^|}]+\\|([^}]+)\\}/g, '$1'));
      return T.filter(([en, ko, pos]) => ls.some(l => aiMark(l, en, stLex(en, { en, ko, pos }, SF[0]), ko))).map(([en, ko]) => '시험 단어 뜻이 나옴: ' + ko); })()`));
    if (why.length) { bad++; console.log(`✘ ${s.from} ‘${s.t}’: ${why.join(' / ')}`); continue; }
    out.push({ messages: [{ role: 'user', content: prompt(shuffle(s.w, s.t)) }, { role: 'assistant', content: answer(s) }] });
  }
} finally { p.close(); }
fs.writeFileSync(path.join(__dirname, 'train.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''));
fs.writeFileSync(path.join(__dirname, 'test-prompts.json'), JSON.stringify(TEST_SETS.map((words, i) => ({ set: i + 1, words, prompt: prompt(words) })), null, 1) + '\n');
const byN = {}, pos = {}, words = new Set();
for (const s of stories) { byN[s.w.length] = (byN[s.w.length] || 0) + 1; for (const w of s.w) { pos[w[2]] = (pos[w[2]] || 0) + 1; words.add(w[0]); } }
const extra = stories.reduce((a, s) => a + (s.l.length - s.w.length - 2), 0);
console.log(`이야기 ${stories.length}편 (단어 수별 ${JSON.stringify(byN)}, 품사 ${JSON.stringify(pos)}, 서로 다른 단어 ${words.size}개, 이음 줄 ${extra}개) → 통과 ${out.length}, 고칠 것 ${bad}`);
process.exit(bad ? 1 : 0);
