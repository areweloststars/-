// 파인튜닝 2차 모범 답안 묶기: stories/*.json(Claude가 쓴 이야기) → train.jsonl, test-prompts.json.
// 점검은 check.cjs와 같아요. 모범 답안은 더 엄하게: warn(뜻 되풀이, 48자 넘는 줄)도 고치고, 제목은 14자까지.
//   node tools/finetune/v2/build.cjs   → tools/finetune/v2/train.jsonl (한 줄에 {"messages": [user, assistant]})
// 이야기 파일: [{ "t": "제목", "w": [["영어", "뜻", "품사"], …], "l": ["첫 줄", "단어 줄 ({영어|뜻})", …, "끝 줄"] }, …]
const fs = require('node:fs'), path = require('node:path');
const { TEST_SETS, prompt, check, bootPage } = require('./check.cjs');

const dir = path.join(__dirname, 'stories');
const stories = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map((s, i) => Object.assign({ from: `${f}#${i + 1}` }, s)));
const testWords = new Set(TEST_SETS.flat().flatMap(w => [w[0].toLowerCase(), w[1]]));
const p = bootPage();
const out = [], seenTitle = new Set();
let bad = 0;
try {
  for (const s of stories) {
    const why = [], n = s.w.length;
    if (n < 1 || n > 8) why.push(`단어 ${n}개`);
    for (const [en, ko] of s.w) if (testWords.has(en.toLowerCase()) || testWords.has(ko)) why.push(`시험 단어: ${en} ${ko}`);
    if (!s.t || s.t.length > 14) why.push(`제목 ${s.t ? s.t.length + '자' : '없음'} (14자까지)`);
    if (seenTitle.has(s.t)) why.push('같은 제목');
    seenTitle.add(s.t);
    const r = check(p, s.w, s.t, s.l, 48);
    why.push(...r.why, ...r.warn);
    // 시험 단어의 뜻이 이야기에 지나가듯 나와도 안 돼요 (재기가 부풀어요)
    why.push(...p.json(`(() => { const T = ${JSON.stringify(TEST_SETS.flat())}, ls = ${JSON.stringify(s.l)}.map(l => l.replace(/\\{[^|}]+\\|([^}]+)\\}/g, '$1'));
      return T.filter(([en, ko, pos]) => ls.some(l => aiMark(l, en, stLex(en, { en, ko, pos }, SF[0]), ko))).map(([en, ko]) => '시험 단어 뜻이 나옴: ' + ko); })()`));
    if (why.length) { bad++; console.log(`✘ ${s.from} ‘${s.t}’: ${why.join(' / ')}`); continue; }
    out.push({ messages: [{ role: 'user', content: prompt(s.w) }, { role: 'assistant', content: [s.t, ...s.l].join('\n') }] });
  }
} finally { p.close(); }
fs.writeFileSync(path.join(__dirname, 'train.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''));
fs.writeFileSync(path.join(__dirname, 'test-prompts.json'), JSON.stringify(TEST_SETS.map((words, i) => ({ set: i + 1, words, prompt: prompt(words) })), null, 1) + '\n');
const byN = {}, pos = {}, words = new Set();
for (const s of stories) { byN[s.w.length] = (byN[s.w.length] || 0) + 1; for (const w of s.w) { pos[w[2]] = (pos[w[2]] || 0) + 1; words.add(w[0]); } }
const chars = stories.flatMap(s => s.l.map(l => l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1').length));
console.log(`이야기 ${stories.length}편 (단어 수별 ${JSON.stringify(byN)}, 품사 ${JSON.stringify(pos)}, 서로 다른 단어 ${words.size}개, 줄 평균 ${chars.length ? (chars.reduce((a, b) => a + b, 0) / chars.length).toFixed(1) : 0}자) → 통과 ${out.length}, 고칠 것 ${bad}`);
process.exit(bad ? 1 : 0);
