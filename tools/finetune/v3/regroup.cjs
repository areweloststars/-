// 4차 실험: 시험 단어 61개(TEST_SETS)를 장면이 비슷한 것끼리 다시 묶어요. 같은 모델·같은 단어로 '묶는 법'만 바꿔서
// 이야기가 더 잘 이어지는지 봐요 (원래 묶음 결과는 허깅페이스 …-wordstory4-…의 eval/outputs.json).
// 묶음은 Claude가 손으로 정한 '잘 묶었을 때'예요: 앱이 저절로 묶는 방법은 이 실험에서 나아지면 그때 만들어요.
//   node tools/finetune/v3/regroup.cjs → tools/finetune/v3/regroup-prompts.json
const fs = require('node:fs'), path = require('node:path');
const { TEST_SETS, prompt } = require('./check.cjs');
const GROUPS = [
  ['택배와 수리', ['deliver', 'delay', 'repair', 'confirm', 'refund', 'convenient']],
  ['생일 파티', ['invite', 'schedule', 'cancel', 'temporary', 'attend', 'celebrate']],
  ['요리', ['curious', 'invent', 'ingredient', 'mix', 'taste', 'serve']],
  ['개미와 베짱이', ['lazy', 'harvest', 'collect', 'borrow', 'generous', 'encourage']],
  ['사고와 구조', ['journey', 'accident', 'shiver', 'brave', 'rescue', 'recover']],
  ['유적 탐험', ['ancient', 'survey', 'discover', 'examine', 'report', 'protect']],
  ['반 회의', ['previous', 'rule', 'opinion', 'compare', 'require', 'permit']],
  ['다툼과 화해', ['whisper', 'deny', 'refuse', 'hesitate', 'honest', 'apologize', 'forgive']],
  ['인기 가게', ['popular', 'contract', 'private', 'arrange', 'explain', 'reward']],
  ['수수께끼', ['anxious', 'predict', 'quiet', 'abandon', 'reduce', 'solve']]
];
const all = new Map(TEST_SETS.flat().map(w => [w[0], w]));
const used = GROUPS.flatMap(g => g[1]);
if (used.length !== all.size || new Set(used).size !== used.length || used.some(w => !all.has(w))) throw new Error('시험 단어를 한 번씩 다 써야 해요');
const out = GROUPS.map(([theme, ws], i) => {
  const words = ws.map(w => all.get(w));
  return { set: i + 1, theme, words, prompt: prompt(words) };
});
fs.writeFileSync(path.join(__dirname, 'regroup-prompts.json'), JSON.stringify(out, null, 1) + '\n');
console.log(out.map(o => `${o.set}. ${o.theme}: ${o.words.map(w => w[0]).join(', ')}`).join('\n'));
