// 파인튜닝 모범 답안 묶기: stories/*.json(Claude가 쓴 이야기)을 시험(min-words.cjs)과 똑같은 요청 글로 묶어 train.jsonl을 만들고,
// 답마다 시험과 같은 점검을 해요 (제목, 이야기 줄 수 = 단어 수 + 2, 뜻이 둘째 줄부터 한 줄에 하나씩 적힌 순서대로 들어갔는지(앱의 aiMark),
// 한 줄에 뜻을 몰아 쓰지 않았는지, 줄마다 앱의 문장 검사(aiLineWhy), 같은 줄·같은 시작 되풀이). 시험 단어(min-words.cjs의 SETS)는 넣지 않아요.
//   node tools/finetune/build-data.cjs   → tools/finetune/train.jsonl (한 줄에 {"messages": [user, assistant]})
// 이야기 파일: [{ "words": [["영어", "뜻", "품사"], …], "title": "제목", "lines": ["첫 줄", "단어 줄", …, "끝 줄"] }, …]
// 단어는 일반 사전 낱말이고 뜻·이야기는 Claude가 새로 썼어요 (교재 단어 아님).
const fs = require('node:fs'), path = require('node:path');
const REPO = path.join(__dirname, '..', '..');
const { storyPrompt, SETS } = require(path.join(REPO, 'tools', 'story-lab', 'min-words.cjs'));
const { bootPage } = require(path.join(REPO, 'app', 'tests', 'page.cjs'));

const dir = path.join(__dirname, 'stories');
const stories = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).map((s, i) => Object.assign({ from: `${f}#${i + 1}` }, s)));
const testWords = new Set(SETS.flat().flatMap(w => [w[0], w[1]]));
const p = bootPage();
let bad = 0;
const out = [];
const seenTitle = new Set();
try {
  for (const s of stories) {
    const why = [];
    const n = s.words.length;
    if (n < 1 || n > 8) why.push(`단어 ${n}개`);
    for (const [en, ko] of s.words) if (testWords.has(en) || testWords.has(ko)) why.push(`시험 단어: ${en} ${ko}`);
    if (!s.title || s.title.length > 20) why.push('제목');
    if (seenTitle.has(s.title)) why.push('같은 제목'); seenTitle.add(s.title);
    if (s.lines.length !== n + 2) why.push(`이야기 ${s.lines.length}줄 (${n + 2}줄이어야 해요)`);
    // 시험과 같은 점검 (앱의 함수로)
    const r = p.json(`(() => {
      const words = ${JSON.stringify(s.words)}, body = ${JSON.stringify(s.lines)}, why = [];
      const at = words.map(([en, ko, pos]) => { const w = stLex(en, { en, ko, pos }, SF[0]); return body.map((t, i) => (aiMark(t, en, w, ko) ? i : -1)).filter(i => i >= 0); });
      words.forEach(([en, ko], k) => { if (!at[k].includes(k + 1)) why.push(\`뜻 '\${ko}'이 \${k + 2}번째 줄(이야기 \${k + 2}줄)에 없음 (찾은 줄: \${at[k].map(i => i + 1).join(',') || '없음'})\`); });
      body.forEach((t, i) => { const c = at.filter(a => a.includes(i)).length; if (c >= 2) why.push(\`\${i + 1}줄에 뜻 \${c}개\`); });
      body.forEach((t, i) => { const b = aiLineWhy(t, '', { sent: 1, max: 140 }); if (b) why.push(\`\${i + 1}줄: \${b}\`); });
      const dup = body.filter((t, i) => body.slice(0, i).some(q => q === t || (t.length > 12 && q.slice(0, 12) === t.slice(0, 12)))).length;
      if (dup) why.push(\`같은 줄·같은 시작 되풀이 \${dup}줄\`);
      return why;
    })()`);
    why.push(...r);
    if (why.length) { bad++; console.log(`✘ ${s.from} ‘${s.title}’: ${why.join(' / ')}`); continue; }
    out.push({ messages: [{ role: 'user', content: storyPrompt(s.words.map(w => w[1])) }, { role: 'assistant', content: [s.title, ...s.lines].join('\n') }] });
  }
} finally { p.close(); }
const byN = {};
for (const s of stories) byN[s.words.length] = (byN[s.words.length] || 0) + 1;
const words = new Set(stories.flatMap(s => s.words.map(w => w[0])));
fs.writeFileSync(path.join(__dirname, 'train.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + '\n');
console.log(`이야기 ${stories.length}편 (단어 수별 ${JSON.stringify(byN)}, 서로 다른 단어 ${words.size}개) → 통과 ${out.length}, 고칠 것 ${bad}`);
process.exit(bad ? 1 : 0);
