// 파인튜닝 3차 새 이야기의 단어 묶음 뽑기: 낱말 모음(word-pool.json)에서 무작위로 6~8개씩.
// 게임 단어장은 주제가 섞여 있어서, 주제가 다른 단어들로도 이어지는 이야기를 쓰는 모범 답안이 필요해요.
//   node tools/finetune/v3/pick.cjs 1   → 첫째 묶음(stories/01.json)에 쓸 단어 25벌
// 차례는 늘 같아요 (씨앗 고정). 덜 쓴 단어부터 뽑고, 뜻이 겹치는 단어는 한 벌에 넣지 않아요.
// 낱말 모음은 일반 사전 낱말이고 뜻은 Claude가 썼어요 (교재 단어 아님).
const fs = require('node:fs'), path = require('node:path');
const { TEST_SETS, bootPage } = require('./check.cjs');

const SETS = 228, PER_FILE = 25, SIZES = [6, 7, 6, 7, 6, 8, 7, 6];
const pool = JSON.parse(fs.readFileSync(path.join(__dirname, 'word-pool.json'), 'utf8'));
const batch = Number(process.argv[2] || 1);

// 낱말 모음 점검: 같은 단어 두 번, 시험 단어, 시험 단어 뜻이 들어간 뜻
const testWords = new Set(TEST_SETS.flat().flatMap(w => [w[0].toLowerCase(), w[1]]));
const seen = new Set(), bad = [];
for (const [en, ko] of pool) {
  if (seen.has(en)) bad.push(`두 번: ${en}`);
  seen.add(en);
  if (testWords.has(en) || testWords.has(ko)) bad.push(`시험 단어: ${en} ${ko}`);
}
const p = bootPage();
try {
  bad.push(...p.json(`(() => { const T = ${JSON.stringify(TEST_SETS.flat())}, P = ${JSON.stringify(pool)};
    return P.flatMap(([pe, pk]) => T.filter(([en, ko, pos]) => aiMark(pk, en, stLex(en, { en, ko, pos }, SF[0]), ko)).map(([, ko]) => '시험 단어 뜻이 나옴: ' + pe + ' ' + pk + ' → ' + ko)); })()`));
} finally { p.close(); }
if (bad.length) { console.log(bad.join('\n')); process.exit(1); }

// 이미 쓴 단어 (모든 이야기 파일)
const used = {};
for (const f of fs.readdirSync(path.join(__dirname, 'stories')).filter(f => f.endsWith('.json')))
  for (const s of JSON.parse(fs.readFileSync(path.join(__dirname, 'stories', f), 'utf8'))) if (!/^\d\d\.json$/.test(f)) for (const [en] of s.w) used[en] = (used[en] || 0) + 1;

let seed = 3;
const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const stem = ko => ko.replace(/(하다|다)$/, '');
const clash = (a, b) => { const x = stem(a), y = stem(b); return x.length > 1 && y.length > 1 && (x.includes(y) || y.includes(x)); };

// 처음부터 끝까지 같은 차례로 뽑고, 이번 묶음 몫만 보여 줘요 (번호가 붙은 이야기 파일은 이 차례를 따라요)
const count = Object.fromEntries(pool.map(([en]) => [en, used[en] || 0]));
const sets = [];
for (let k = 0; k < SETS; k++) {
  const size = SIZES[k % SIZES.length], set = [];
  const order = pool.map(w => [count[w[0]] + rnd(), w]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  for (const w of order) {
    if (set.length === size) break;
    if (set.some(o => clash(o[1], w[1]))) continue;
    set.push(w);
  }
  set.forEach(([en]) => count[en]++);
  sets.push(set);
}
const mine = sets.slice((batch - 1) * PER_FILE, batch * PER_FILE);
mine.forEach((set, i) => console.log(`${(batch - 1) * PER_FILE + i + 1}. ${JSON.stringify(set)}`));
