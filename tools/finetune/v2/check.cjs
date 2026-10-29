// 파인튜닝 2차: 학습한 Gemma가 단어만 받고 제목 + 이야기를 처음부터 써요. 단어 줄에는 {영어|뜻} 표시를 넣어요
// (게임의 단어장 형식 그대로: mkEpisode가 읽어요). 요청 글·답 나누기·점검을 모범 답안 묶기(build.cjs)와 모델 재기(eval.cjs)가 함께 써요.
// 시험 단어(TEST_SETS)는 모범 답안에 넣지 않아요. 단어는 일반 사전 낱말이고 뜻은 직접 썼어요 (교재 단어 아님).
const path = require('node:path');
const REPO = path.join(__dirname, '..', '..', '..');
const { bootPage } = require(path.join(REPO, 'app', 'tests', 'page.cjs'));

// 시험 묶음 10개 (게임 에피소드처럼 4~7단어). 묶음마다 3번씩 = 30편
const TEST_SETS = [
  [['refund', '환불하다', 'v'], ['deliver', '배달하다', 'v'], ['invite', '초대하다', 'v'], ['delay', '미루다', 'v'], ['repair', '수리하다', 'v'], ['confirm', '확인하다', 'v']],
  [['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['anxious', '불안한', 'a'], ['harvest', '수확', 'n'], ['whisper', '속삭이다', 'v'], ['encourage', '격려하다', 'v']],
  [['compare', '비교하다', 'v'], ['reduce', '줄이다', 'v'], ['abandon', '버리다', 'v'], ['survey', '설문 조사', 'n'], ['discover', '발견하다', 'v'], ['celebrate', '축하하다', 'v']],
  [['rule', '규칙', 'n'], ['permit', '허락하다', 'v'], ['schedule', '일정', 'n'], ['report', '보고서', 'n'], ['examine', '검사하다', 'v'], ['protect', '보호하다', 'v']],
  [['honest', '정직한', 'a'], ['rescue', '구조하다', 'v'], ['ancient', '고대의', 'a'], ['explain', '설명하다', 'v'], ['shiver', '떨다', 'v'], ['reward', '보상', 'n']],
  [['contract', '계약', 'n'], ['private', '개인적인', 'a'], ['popular', '인기 있는', 'a'], ['arrange', '정리하다', 'v'], ['refuse', '거절하다', 'v'], ['apologize', '사과하다', 'v']],
  [['temporary', '임시의', 'a'], ['convenient', '편리한', 'a'], ['previous', '이전의', 'a'], ['require', '요구하다', 'v']],
  [['predict', '예측하다', 'v'], ['lazy', '게으른', 'a'], ['opinion', '의견', 'n'], ['solve', '해결하다', 'v'], ['quiet', '조용한', 'a']],
  [['hesitate', '망설이다', 'v'], ['generous', '너그러운', 'a'], ['journey', '여행', 'n'], ['collect', '모으다', 'v'], ['accident', '사고', 'n'], ['forgive', '용서하다', 'v'], ['recover', '회복하다', 'v']],
  [['invent', '발명하다', 'v'], ['curious', '호기심 많은', 'a'], ['ingredient', '재료', 'n'], ['mix', '섞다', 'v'], ['taste', '맛보다', 'v']]
];
const TRIES = 3;

// 요청 글 (학습·시험·게임이 똑같이 써요). 학습한 모델에게는 짧게: 휴대폰은 긴 요청 글을 읽다가 멈추기도 해요
const prompt = words => `영어 단어 이야기를 써 주세요. 제목 한 줄, 이야기 ${words.length + 2}줄.
단어마다 한 줄에 차례대로 {영어|뜻} 꼴로 넣어요.
${words.map(([en, ko], i) => `${i + 1}. ${en} - ${ko}`).join('\n')}`;

// 답 나누기: 빈 줄은 빼고 첫 줄이 제목. 게임도 이만큼은 너그럽게 읽어요 ('제목:'·번호·글머리표·굵게 표시를 떼요)
function parse(text) {
  const ls = String(text || '').split('\n').map(s => s.replace(/\*\*/g, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim()).filter(Boolean);
  const title = (ls[0] || '').replace(/^제목\s*[:：]\s*/, '').replace(/^[‘'“"]|[’'”"]$/g, '').trim();
  return { title, lines: ls.slice(1) };
}

// 점검 (페이지 안에서 앱 함수로): why = 틀린 까닭(있으면 실패), warn = 모범 답안에서만 실패로 보는 것
const CHECK = ({ words, title, lines, maxLen }) => {
  const why = [], warn = [];
  const n = words.length, TAG = /\{([^{|}]+)\|([^{|}]+)\}/g;
  if (!title) why.push('제목 없음');
  else if (title.length > 16) why.push(`제목이 김 (${title.length}자)`);
  else if (/[{}|]/.test(title)) why.push('제목에 표시');
  if (lines.length !== n + 2) why.push(`이야기 ${lines.length}줄 (${n + 2}줄이어야 해요)`);
  const lex = words.map(([en, ko, pos]) => stLex(en, { en, ko, pos }, SF[0]));
  const plain = lines.map(l => l.replace(TAG, '$2'));
  lines.forEach((l, i) => {
    const tags = [...l.matchAll(TAG)], rest = l.replace(TAG, '');
    if (/[{}|]/.test(rest)) why.push(`${i + 1}줄: 짝 안 맞는 표시`);
    const k = i - 1; // 단어 차례 (0부터). 첫 줄과 끝 줄은 단어 없음
    if (k < 0 || k >= n) { if (tags.length) why.push(`${i + 1}줄: 단어 표시가 있으면 안 돼요`); }
    else if (tags.length !== 1) why.push(`${i + 1}줄: 단어 표시 ${tags.length}개 (1개여야 해요)`);
    else {
      const [, en, ko] = tags[0], [wen, wko] = words[k];
      if (en.trim().toLowerCase() !== wen.toLowerCase()) why.push(`${i + 1}줄: ${wen} 자리에 ${en.trim()}`);
      else if (!aiMark(ko.trim(), wen, lex[k], wko)) why.push(`${i + 1}줄: '${ko.trim()}'은(는) ${wko}의 뜻이 아니에요`);
    }
    const keep = tags.length ? tags[0][2] : '';
    const b = aiLineWhy(plain[i], keep, { sent: 1, max: 140 });
    if (b) why.push(`${i + 1}줄: ${b}`);
    if (plain[i].length > maxLen) warn.push(`${i + 1}줄이 김 (${plain[i].length}자)`);
  });
  // 단어 뜻을 표시 밖(다른 줄)에 또 쓰면 학생이 어느 말이 단어인지 헷갈려요
  words.forEach(([en, ko], k) => lines.forEach((l, i) => { if (i !== k + 1 && aiMark(l.replace(TAG, ' '), en, lex[k], ko)) warn.push(`${i + 1}줄에 '${ko}' 뜻이 또 나옴`); }));
  const dup = plain.filter((t, i) => plain.slice(0, i).some(q => q === t || (t.length > 12 && q.slice(0, 12) === t.slice(0, 12)))).length;
  if (dup) why.push(`같은 줄·같은 시작 되풀이 ${dup}줄`);
  return { why, warn };
};
const check = (p, words, title, lines, maxLen = 60) => p.json(`(${CHECK})(${JSON.stringify({ words, title, lines, maxLen })})`);

module.exports = { REPO, TEST_SETS, TRIES, prompt, parse, check, bootPage };
