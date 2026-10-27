// 점검기(aiMark)가 단어 뜻의 어떤 꼴을 알아보는지 미리 시험해요. 새 이야기를 쓰기 전에 낯선 꼴만 확인하면 고치는 횟수가 줄어요.
//   node tools/finetune/v3/mark.cjs '[["follow","따라가다","v",["따라갔어요","따라가"]]]'   → follow: ✔따라갔어요 ✘따라가
// 알아낸 것: 한 글자 형용사 뜻(쓴·신·먼·싼)은 못 알아봐요 → 낱말 모음에서 '맛이 쓴'처럼 바꿨어요.
//   '-어서·-아' 같은 꼴(헐거워서·따라가·숨긴·얼면)을 못 알아볼 때가 있어요. '-었어요·-자·-며'는 대개 알아봐요.
const path = require('node:path');
const { bootPage } = require(path.join(__dirname, '..', '..', '..', 'app', 'tests', 'page.cjs'));
const p = bootPage();
try {
  const q = JSON.parse(process.argv[2]);
  console.log(p.json(`(${JSON.stringify(q)}).map(([en, ko, pos, forms]) => en + ': ' + forms.map(f => (aiMark(f, en, stLex(en, { en, ko, pos }, SF[0]), ko) ? '✔' : '✘') + f).join(' '))`).join('\n'));
} finally { p.close(); }
