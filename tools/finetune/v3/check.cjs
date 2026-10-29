// 파인튜닝 3차: 단어 6~8개만 받고 학습한 Gemma가 제목 · 줄거리 · 이야기 · 그림 설명을 써요.
// - 이야기: 첫 줄(단어 없음) → 단어 줄(단어마다 한 번, {영어|뜻}) → 끝 줄(단어 없음). 단어 차례는 AI가 이야기에 맞게 정하고,
//   단어 없는 이음 줄을 2개까지 넣을 수 있어요 (개연성이 1순위: 까닭·결과를 넣을 자리).
// - 그림: 단어마다 한 줄 `영어 단어: 영어 그림 설명`. 그 단어 줄의 장면을 그려서 단어 뜻이 떠오르게 (휴대폰의 그림 AI가 그려요).
// 모범 답안 묶기(build.cjs)와 모델 재기(eval.cjs)가 함께 써요. 시험 단어(TEST_SETS)는 모범 답안에 넣지 않아요.
// 단어는 일반 사전 낱말이고 뜻·이야기·그림 설명은 Claude가 새로 썼어요 (교재 단어 아님).
const path = require('node:path');
const REPO = path.join(__dirname, '..', '..', '..');
const { bootPage } = require(path.join(REPO, 'app', 'tests', 'page.cjs'));

// 시험 묶음 10개 (게임처럼 단어 6~7개). 묶음마다 3번씩 = 30편 (게임에 넣는 기준: 27편)
const TEST_SETS = [
  [['refund', '환불하다', 'v'], ['deliver', '배달하다', 'v'], ['invite', '초대하다', 'v'], ['delay', '미루다', 'v'], ['repair', '수리하다', 'v'], ['confirm', '확인하다', 'v']],
  [['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['anxious', '불안한', 'a'], ['harvest', '수확', 'n'], ['whisper', '속삭이다', 'v'], ['encourage', '격려하다', 'v']],
  [['compare', '비교하다', 'v'], ['reduce', '줄이다', 'v'], ['abandon', '버리다', 'v'], ['survey', '설문 조사', 'n'], ['discover', '발견하다', 'v'], ['celebrate', '축하하다', 'v']],
  [['rule', '규칙', 'n'], ['permit', '허락하다', 'v'], ['schedule', '일정', 'n'], ['report', '보고서', 'n'], ['examine', '검사하다', 'v'], ['protect', '보호하다', 'v']],
  [['honest', '정직한', 'a'], ['rescue', '구조하다', 'v'], ['ancient', '고대의', 'a'], ['explain', '설명하다', 'v'], ['shiver', '떨다', 'v'], ['reward', '보상', 'n']],
  [['contract', '계약', 'n'], ['private', '개인적인', 'a'], ['popular', '인기 있는', 'a'], ['arrange', '정리하다', 'v'], ['refuse', '거절하다', 'v'], ['apologize', '사과하다', 'v']],
  [['temporary', '임시의', 'a'], ['convenient', '편리한', 'a'], ['previous', '이전의', 'a'], ['require', '요구하다', 'v'], ['attend', '참석하다', 'v'], ['cancel', '취소하다', 'v']],
  [['predict', '예측하다', 'v'], ['lazy', '게으른', 'a'], ['opinion', '의견', 'n'], ['solve', '해결하다', 'v'], ['quiet', '조용한', 'a'], ['deny', '부인하다', 'v']],
  [['hesitate', '망설이다', 'v'], ['generous', '너그러운', 'a'], ['journey', '여행', 'n'], ['collect', '모으다', 'v'], ['accident', '사고', 'n'], ['forgive', '용서하다', 'v'], ['recover', '회복하다', 'v']],
  [['invent', '발명하다', 'v'], ['curious', '호기심 많은', 'a'], ['ingredient', '재료', 'n'], ['mix', '섞다', 'v'], ['taste', '맛보다', 'v'], ['serve', '대접하다', 'v']]
];
const TRIES = 3;

// 요청 글 (학습·시험·게임이 똑같이 써요). 학습한 모델에게는 짧게 (휴대폰은 긴 요청 글을 읽다가 멈추기도 해요)
const prompt = words => `영어 단어로 이야기와 그림 설명을 써 주세요. 제목, 줄거리, 이야기, 그림 차례로.
단어마다 이야기 한 줄에 {영어|뜻}으로 넣고, 단어 차례는 이야기에 맞게 정해요.
${words.map(([en, ko]) => `${en} - ${ko}`).join('\n')}`;

// 답 글 (모범 답안): 이야기 줄의 단어 차례대로 그림 줄을 써요
const answer = s => {
  const order = s.l.flatMap(l => [...l.matchAll(/\{([^{|}]+)\|/g)].map(m => m[1]));
  return [`제목: ${s.t}`, `줄거리: ${s.plan}`, '이야기:', ...s.l, '그림:', ...order.map(en => `${en}: ${s.pic[en]}`)].join('\n');
};

// 답 나누기: '제목:', '줄거리:', '이야기:', '그림:' 표시로. 게임도 이만큼은 너그럽게 읽어요 (굵게 표시·번호·글머리표를 떼요)
function parse(text) {
  const ls = String(text || '').split('\n').map(s => s.replace(/\*\*/g, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim()).filter(Boolean);
  const out = { title: '', plan: '', lines: [], pics: [] };
  let part = '';
  for (const l of ls) {
    let m;
    if ((m = l.match(/^제목\s*[:：]\s*(.*)$/))) { out.title = m[1].replace(/^[‘'“"]|[’'”"]$/g, '').trim(); part = ''; continue; }
    if ((m = l.match(/^줄거리\s*[:：]\s*(.*)$/))) { out.plan = m[1].trim(); part = ''; continue; }
    if ((m = l.match(/^이야기\s*[:：]\s*(.*)$/))) { part = 'story'; if (m[1]) out.lines.push(m[1]); continue; }
    if ((m = l.match(/^그림\s*[:：]\s*(.*)$/))) { part = 'pic'; if (m[1]) out.pics.push(m[1]); continue; }
    if (part === 'story') out.lines.push(l);
    else if (part === 'pic') out.pics.push(l);
  }
  out.pics = out.pics.map(l => { const m = l.match(/^([A-Za-z][A-Za-z '’-]*?)\s*[:：]\s*(.+)$/); return m ? { en: m[1].trim(), text: m[2].trim() } : { en: '', text: l }; });
  return out;
}

// 그림 설명에 넣지 않을 말 (어린이 그림책): 다치는 장면·무기·무서운 것
const PIC_BLOCK = /\b(blood|bloody|kill\w*|dead|death|die|dying|gun|knife|sword|weapon\w*|corpse|skull|scary|horror|violent|fight\w*|nude|naked)\b/i;

// 점검 (페이지 안에서 앱 함수로): why = 틀린 까닭(있으면 실패), warn = 모범 답안에서만 실패로 보는 것
const CHECK = ({ words, out, strict, PIC_BLOCK_SRC }) => {
  const why = [], warn = [], PIC_BLOCK = new RegExp(PIC_BLOCK_SRC, 'i');
  const n = words.length, TAG = /\{([^{|}]+)\|([^{|}]+)\}/g, { title, plan, lines, pics } = out;
  if (!title) why.push('제목 없음');
  else if (title.length > (strict ? 14 : 16)) why.push(`제목이 김 (${title.length}자)`);
  else if (/[{}|A-Za-z]/.test(title)) why.push('제목에 표시·영어');
  if (!plan) why.push('줄거리 없음');
  else { const b = aiLineWhy(plan, '', { sent: 1, max: 80 }); if (b) why.push(`줄거리: ${b}`); }
  if (lines.length < n + 2 || lines.length > n + 4) why.push(`이야기 ${lines.length}줄 (${n + 2}~${n + 4}줄이어야 해요)`);
  const lex = words.map(([en, ko, pos]) => stLex(en, { en, ko, pos }, SF[0]));
  const idx = Object.fromEntries(words.map(([en], k) => [en.toLowerCase(), k]));
  const seen = words.map(() => 0), plain = lines.map(l => l.replace(TAG, '$2'));
  lines.forEach((l, i) => {
    const tags = [...l.matchAll(TAG)], rest = l.replace(TAG, '');
    if (/[{}|]/.test(rest)) why.push(`${i + 1}줄: 짝 안 맞는 표시`);
    if ((i === 0 || i === lines.length - 1) && tags.length) why.push(`${i + 1}줄: 첫 줄·끝 줄에는 단어를 넣지 않아요`);
    if (tags.length > 1) why.push(`${i + 1}줄: 단어 표시 ${tags.length}개 (한 줄에 하나만)`);
    for (const [, en, ko] of tags) {
      const k = idx[en.trim().toLowerCase()];
      if (k == null) { why.push(`${i + 1}줄: 없는 단어 ${en.trim()}`); continue; }
      seen[k]++;
      if (!aiMark(ko.trim(), words[k][0], lex[k], words[k][1])) why.push(`${i + 1}줄: '${ko.trim()}'은(는) ${words[k][1]}의 뜻이 아니에요`);
    }
    const b = aiLineWhy(plain[i], tags.length ? tags[0][2] : '', { sent: 1, max: 140 });
    if (b) why.push(`${i + 1}줄: ${b}`);
    if (plain[i].length > 48) warn.push(`${i + 1}줄이 김 (${plain[i].length}자)`);
  });
  words.forEach(([en], k) => { if (seen[k] !== 1) why.push(`${en}: 이야기에 ${seen[k]}번 (한 번이어야 해요)`); });
  // 단어 뜻을 표시 밖(다른 줄)에 또 쓰면 학생이 어느 말이 단어인지 헷갈려요
  words.forEach(([en, ko], k) => lines.forEach((l, i) => { if (aiMark(l.replace(TAG, ' '), en, lex[k], ko)) warn.push(`${i + 1}줄에 '${ko}' 뜻이 또 나옴`); }));
  const dup = plain.filter((t, i) => plain.slice(0, i).some(q => q === t || (t.length > 12 && q.slice(0, 12) === t.slice(0, 12)))).length;
  if (dup) why.push(`같은 줄·같은 시작 되풀이 ${dup}줄`);
  // 그림 설명: 단어마다 한 줄, 영어로, 장면 하나
  const picOf = {};
  for (const p of pics) {
    const k = idx[String(p.en).toLowerCase()];
    if (k == null) { why.push(`그림: 없는 단어 ${p.en || '(이름 없음)'}`); continue; }
    if (picOf[k] != null) { why.push(`그림: ${p.en} 두 번`); continue; }
    picOf[k] = p.text;
    const nw = p.text.split(/\s+/).length;
    if (/[가-힣]/.test(p.text)) why.push(`그림 ${p.en}: 한글이 섞임`);
    else if (nw < 6 || nw > 45) why.push(`그림 ${p.en}: 낱말 ${nw}개 (6~45개)`);
    if (PIC_BLOCK.test(p.text)) why.push(`그림 ${p.en}: 어린이 그림책에 맞지 않는 말`);
    if (/\b(text|letters|words|written|says|saying|label)\b/i.test(p.text)) warn.push(`그림 ${p.en}: 글자를 그리게 하는 말 (그림 AI는 글자를 잘 못 그려요)`);
  }
  words.forEach(([en], k) => { if (picOf[k] == null) why.push(`그림: ${en} 없음`); });
  return { why, warn };
};
const check = (p, words, out, strict = false) => p.json(`(${CHECK})(${JSON.stringify({ words, out, strict, PIC_BLOCK_SRC: PIC_BLOCK.source })})`);

module.exports = { REPO, TEST_SETS, TRIES, prompt, answer, parse, check, bootPage };
