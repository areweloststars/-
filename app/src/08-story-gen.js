/* ---------- 그림 자동으로 고르기: 뜻에 들어 있는 말을 보고 이모지·자세·표시를 정해요 (Claude 없이) ---------- */
const AUTO_PIC = [
  [/붕대|상처|부상|다치|반창고|치료/, { e: '🩹', mark: 'plus' }],
  [/장애|장벽|울타리|가로막|차단|방해/, { e: '🚧', mark: 'cross' }],
  [/묶|동여|밧줄|끈|매듭/, { e: '🪢' }],
  [/다발|꾸러미|묶음|뭉치|더미|소포|짐/, { e: '📦' }],
  [/결속|유대|단결|연대|동맹|접착|우정|친구/, { e: '🤝', mark: 'heart' }],
  [/돈|비용|가격|값|요금|지불|예산|경제|재정|부유|월급|임금|세금|투자|저축/, { e: '💰', mark: 'money' }],
  [/반대|거절|거부|금지|부정|막다|방해|저항|반박|취소/, { p: 'shrug', face: 'angry', mark: 'cross' }],
  [/찬성|동의|승인|허락|인정|지지|수락/, { p: 'cheer', mark: 'check' }],
  [/증가|늘|오르|상승|향상|성장|확대|개선|발전|높이/, { e: '📈', mark: 'up' }],
  [/감소|줄|떨어|하락|축소|낮추|약화|내리/, { e: '📉', mark: 'down' }],
  [/시간|기간|일정|마감|늦|이르|일찍|즉시|곧|다가오|최근|오늘|내일|매일/, { e: '⏰', mark: 'clock' }],
  [/생각|고려|여기|간주|판단|추측|예상|상상|기억|믿|의심|궁금/, { p: 'think', mark: 'idea' }],
  [/말하|설명|발표|언급|주장|알리|전하|대답|질문|묻|회견|연설|토론|논의/, { p: 'point', hold: '🎤', mark: 'exclaim' }],
  [/기쁘|기쁜|행복|즐거|만족|축하|신나|성공|승리|이기/, { p: 'cheer', mark: 'star' }],
  [/슬프|슬픈|우울|실망|후회|외로|실패/, { p: 'sad', mark: 'sweat' }],
  [/화나|화난|분노|짜증|화가/, { p: 'stand', face: 'angry', mark: 'exclaim' }],
  [/걱정|불안|두려|무서|위험|긴장|조심|주의|경고/, { p: 'shrug', face: 'worry', mark: 'sweat' }],
  [/사랑|좋아|아끼|친절|돕|도움|지원|협력|함께|도와/, { p: 'wave', mark: 'heart' }],
  [/빠르|빠른|서두|달리|급하|신속/, { p: 'run', mark: 'exclaim' }],
  [/느리|느린|천천/, { a: 'tortoise' }],
  [/정확|목표|겨냥|목적|초점|집중/, { e: '🎯', mark: 'check' }],
  [/결함|흠|결점|문제|고장|실수|오류|잘못|수리|고치/, { e: '🔧', mark: 'cross' }],
  [/법|규칙|규정|정책|의원|정부|국가|공식|재판|권리/, { e: '⚖️' }],
  [/교통|버스|운전|이동|여행|도로|차량|승객/, { e: '🚌' }],
  [/학교|공부|배우|교육|학생|수업|지식|연구|시험|과학/, { e: '📚', mark: 'idea' }],
  [/일하|직장|업무|회사|사업|직업|고용|근무|경영|관리|사무/, { e: '💼' }],
  [/건강|병|의사|아프|치료|약|병원|의학|다치/, { e: '🏥', mark: 'plus' }],
  [/음식|먹|요리|맛|식사|배고|마시/, { e: '🍱' }],
  [/집|건물|짓|건설|세우|주택/, { e: '🏠' }],
  [/자연|환경|나무|숲|식물|기후|날씨/, { e: '🌳' }],
  [/바다|강|비가|젖|물/, { e: '🌊' }],
  [/잠|자다|피곤|휴식|쉬/, { p: 'sleep' }],
  [/보다|관찰|조사|검사|확인|발견|찾|살피/, { e: '🔍', mark: 'question' }],
  [/만들|생산|창조|제작|발명|개발/, { e: '🛠️', mark: 'idea' }],
  [/주다|제공|공급|선물|기부|나누|건네/, { p: 'hold', hold: '🎁' }],
  [/받|얻|획득|모으|수집|구하/, { p: 'hold', hold: '📦', mark: 'plus' }],
  [/보내|전송|편지|메일|연락/, { e: '✉️' }],
  [/전화|통화/, { e: '📱' }],
  [/컴퓨터|기술|기계|디지털|인터넷|장치/, { e: '💻' }],
  [/음악|노래|소리|춤/, { p: 'cheer', mark: 'music' }],
  [/중요|필수|핵심|주요|필요|중대/, { e: '⭐', mark: 'exclaim' }],
  [/새로|새로운|최신|현대|혁신/, { e: '✨' }],
  [/오래된|고대|전통|역사|과거|옛/, { e: '🏺' }],
  [/거대|큰|엄청|많은|풍부/, { e: '🐘' }],
  [/작은|조그|미세|적은|부족/, { e: '🐜' }],
  [/강하|강한|힘|튼튼|견고/, { e: '💪' }],
  [/약하|약한|부서|깨지/, { e: '🥚', mark: 'sweat' }],
  [/안전|보호|지키|방어/, { e: '🛡️', mark: 'check' }],
  [/시작|출발|개시|열다/, { e: '🚀' }],
  [/끝|마치|완료|종료|닫/, { e: '🏁', mark: 'check' }],
  [/선택|고르|결정/, { p: 'point', mark: 'question' }],
  [/바꾸|변화|변하|전환|수정/, { e: '🔄' }],
  [/사람|인간|사회|대중|공공|시민|공동/, { e: '👥' }],
  [/웃|재미|유머|농담|웃긴/, { p: 'cheer', face: 'happy', mark: 'music' }]
];
const AUTO_BG = ['sky', 'warm', 'mint', 'lavender', 'blush', 'sand'];
const AUTO_OUT = ['blue', 'red', 'green', 'orange', 'purple', 'yellow', 'pink', 'navy'];
const AUTO_HAIR = ['short', 'long', 'pony', 'curly', 'bun', 'side'];
const AUTO_EMO = ['📘', '💡', '🔑', '🧩', '🎈', '🌟'];
const AUTO_POSE = ['hold', 'point', 'wave', 'cheer', 'think'];
let mkPicN = 0;
// 뜻을 낱말 단위로 맞춰 봄. 한 글자 열쇠말('물'·'강'·'약'·'늘')은 낱말 첫머리에서 바로 끝나거나 '다·이다' 같은 꼬리만 붙을 때만
// ('장애물'이 바다 그림, '강조하다'가 강 그림, '약속'이 병원 그림이 되지 않게)
const AUTO_TAIL = /^(?:|다|이다|리다|어나다|어지다|자다|추다|나다|내다|있다|없다|이|가|을|를|의|에|은|는|과|와|도|으로|로)$/;
function autoPicHit(ko) {
  const toks = String(ko || '').replace(/\([^)]*\)/g, ' ').split(/[\s,·/;]+/).map(t => t.replace(/[^가-힣]/g, '')).filter(Boolean);
  return AUTO_PIC.find(([re]) => toks.some(t => {
    for (let i = 0; i < t.length; i++) {
      const m = t.slice(i).match(re); if (!m) return false;
      const at = i + m.index, k = m[0];
      if (k.length >= 2 || (at === 0 && AUTO_TAIL.test(t.slice(1)))) return true;
      i = at;
    }
    return false;
  })) || null;
}
function mkAutoPanel(en, ko, pos, i) {
  const hit = autoPicHit(ko);
  const h = hit ? hit[1] : (pos === 'v' || (pos !== 'n' && i % 2)) ? { p: AUTO_POSE[i % AUTO_POSE.length], mark: i % 3 ? 'none' : 'exclaim' } : { e: AUTO_EMO[i % AUTO_EMO.length] };
  const spec = { bg: AUTO_BG[i % AUTO_BG.length], sign: shortW(en).slice(0, 18), signStyle: h.p ? 'bubble' : 'board' };
  if (h.e) spec.subject = { kind: 'emoji', emoji: h.e };
  else if (h.a) spec.subject = { kind: h.a };
  else spec.subject = { kind: 'person', pose: h.p || 'stand', hair: AUTO_HAIR[i % AUTO_HAIR.length], outfit: AUTO_OUT[i % AUTO_OUT.length], skin: i % 3 === 2 ? 1 : 0, face: h.face };
  if (h.hold) spec.hold = h.hold;
  if (h.mark) spec.mark = h.mark;
  return spec;
}

/* ---------- 이야기 자동 만들기: Claude 없이, 이야기 틀 + 단어 종류(동사·형용사·부사·명사)별 문장 틀로 ---------- */
const jong = s => { const c = String(s).trim().slice(-1).charCodeAt(0); return c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 : 0; };
const J = (w, a, b) => w + (jong(w) ? a : b); // 받침에 맞는 조사: J('기사', '이', '가') → '기사가'
const SF = [
  { title: '용과 기사 레오', H: '기사 레오', F: '꼬마 공주', V: '배고픈 용', P: '하늘 성', bg: 'sky', hero: { kind: 'person', hat: 'helm', outfit: 'grey', hair: 'short' },
    intro: ['옛날 옛적 {P}에 {H}{이가} 살았어요.', '어느 날 {V}{이가} 성 앞에 나타났어요!'], outro: ['결국 {V}{은는} 떡볶이를 얻어먹고 친구가 됐답니다.'] },
  { title: '거북이 토토의 역전승', H: '거북이 토토', F: '다람쥐 응원단', V: '잘난 척 토끼', P: '숲속 운동장', bg: 'mint', hero: { kind: 'tortoise' },
    intro: ['{P}에서 달리기 대회가 열렸어요.', '{V}{은는} "이번에도 내가 1등!"이라며 웃었죠.'], outro: ['결승선! {H}{이가} 또 이겼어요. 꾸준함이 최고예요!'] },
  { title: '막내 돼지의 튼튼한 집', H: '막내 돼지', F: '첫째 형', V: '심술쟁이 늑대', P: '언덕 마을', bg: 'warm', hero: { kind: 'pig' },
    intro: ['{P}에 돼지 삼형제가 살았어요.', '{H}{은는} 벽돌로 집을 짓기로 했어요.'], outro: ['후~ 불어도 끄떡없는 집! {V}{은는} 콧물만 흘리고 돌아갔어요.'] },
  { title: '알라딘과 수다쟁이 지니', H: '알라딘', F: '램프 요정 지니', V: '욕심쟁이 대신', P: '사막 왕국', bg: 'sand', hero: { kind: 'person', hat: 'turban', outfit: 'purple', hair: 'short', skin: 1 },
    intro: ['{P}의 골목에서 {H}{이가} 낡은 램프를 주웠어요.', '쓱쓱 문지르자 {F}{이가} 펑! 나타났어요.'], outro: ['마지막 소원은 "모두 함께 간식 파티!" 왕국이 들썩였어요.'] },
  { title: '마법 학교의 루나', H: '견습 마법사 루나', F: '부엉이 선생님', V: '장난꾸러기 유령', P: '구름 위 마법 학교', bg: 'lavender', hero: { kind: 'person', hat: 'pointy', extra: 'robe', outfit: 'purple', hair: 'long' },
    intro: ['{P}에 첫 수업 종이 울렸어요.', '{H}{은는} 오늘 주문 시험을 봐야 했죠.'], outro: ['시험 합격! {V}마저 박수를 쳤답니다.'] },
  { title: '우주비행사 민의 모험', H: '우주비행사 민', F: '로봇 삐삐', V: '장난꾸러기 외계인', P: '달 기지', bg: 'night', hero: { kind: 'person', hat: 'helm', outfit: 'white', hair: 'short' },
    intro: ['카운트다운 3, 2, 1! 로켓이 {P}로 날아갔어요.', '그런데 {V}{이가} 기지 문을 잠가 버렸어요!'], outro: ['{V}{와과} 화해한 {H}, 이제 우주 친구가 생겼어요.'] },
  { title: '해적 선장 해나', H: '선장 해나', F: '수다쟁이 앵무새', V: '졸린 바다 괴물', P: '보물섬', bg: 'sea', hero: { kind: 'person', hat: 'cap', outfit: 'red', hair: 'pony' },
    intro: ['{H}{이가} 보물 지도를 펼쳤어요.', '목적지는 바로 {P}!'], outro: ['보물 상자 안에는… 단어 카드가 가득! 진짜 보물이었어요.'] },
  { title: '탐정 셜리의 사건 수첩', H: '탐정 셜리', F: '강아지 조수 왓슨', V: '괴도 X', P: '안개 낀 도시', bg: 'grey', hero: { kind: 'person', extra: 'glasses', outfit: 'brown', hat: 'cap', hair: 'bob' },
    intro: ['{P}에서 케이크가 사라졌어요!', '{H}{은는} 돋보기를 꺼냈어요.'], outro: ['범인은 배고팠던 {F}! 모두 웃으며 케이크를 나눠 먹었어요.'] }
];
// 단어 종류별 문장 틀. {W}는 {영어|뜻 표현} 자리, {H}{F}{V}{P}는 이야기 인물·장소
const ST = {
  hada: [s => `{H}{이가} 드디어 계획을 {W:${s}했어요}!`, s => `"이번엔 꼭 {W:${s}할} 거야!" {H}{이가} 외쳤어요.`, s => `{F}{이가} {H}에게 {W:${s}하라고} 귓속말했어요.`, s => `{V}{은는} 몰래 {W:${s}하려다} 딱 걸렸어요.`],
  // 동사는 '-기'로 바꿔 넣음 ('묶다' → '묶기 싫다며'). 기본형을 그대로 넣으면 '묶다 싫다며'처럼 틀린 문장이 돼요
  verb: [m => `{H}의 수첩 첫 줄: "오늘의 미션은 {W:${vNoun(m)}}!"`, m => `{F}{이가} 소리쳤어요. "지금 할 일은 {W:${vNoun(m)}}!"`, m => `{V}{은는} 절대 {W:${vNoun(m)}} 싫다며 버텼어요.`],
  adj: [m => `{H}{은는} 정말 {W:${m}} 표정을 지었어요.`, m => `{F}{이가} 가져온 건 아주 {W:${m}} 소식이었어요.`, m => `{V}{은는} {W:${m}} 눈빛으로 쳐다봤어요.`],
  adv: [m => `{H}{은는} {W:${m}} 한 걸음 내디뎠어요.`, m => `{F}{은는} 모든 걸 {W:${m}} 해냈어요.`, m => `{V}조차 {W:${m}} 고개를 끄덕였어요.`],
  noun: [m => `{H}{은는} 길에서 {W:${m}}${jong(m) ? '을' : '를'} 발견했어요.`, m => `{P} 게시판에 ‘{W:${m}}’ 공고가 붙었어요.`, m => `{F}{은는} {W:${m}}에 대해 신나게 떠들었어요.`, m => `{V}{이가} 가장 무서워하는 건 바로 {W:${m}}!`]
};
const vNoun = m => /다$/.test(m) ? m.slice(0, -1) + '기' : m;
// 뜻 하나 → 단어 종류
function mkKind(m, pos) {
  if (/하다$/.test(m) && m.length > 2) return 'hada';
  if (/(게|히|이|로|으로)$/.test(m) && (pos === 'd' || /(하게|스럽게|롭게|적으로|히)$/.test(m))) return 'adv';
  // '빠르게'·'쉽게'처럼 '-게'로 끝나는 뜻은 부사 (명사 '가게'·'무게'·'지게'·'집게'는 빼고)
  if (/[^\s]게$/.test(m) && !/\s/.test(m) && !/(가게|무게|지게|집게)$/.test(m)) return 'adv';
  if (/(는|은|ㄴ|한|운|적인|던|의|러운|스러운)$/.test(m) || pos === 'a') return /다$/.test(m) ? 'verb' : 'adj';
  if (/다$/.test(m) || pos === 'v') return 'verb';
  return 'noun';
}
// 접두사·접미사로 만드는 암기 팁
// 접두사·접미사로 만드는 암기 팁 (뜻과 맞을 때만: 'reluctant'를 re-(다시)로 풀지 않게)
const AFFIX = [
  [/^un[a-z]{3,}/, 'un-(아닌)', m => /않|없|못|불|비|무/.test(m)], [/^mis[a-z]{3,}/, 'mis-(잘못)', m => /잘못|오/.test(m)],
  [/^pre[a-z]{3,}/, 'pre-(미리)', m => /미리|사전|예|전/.test(m)], [/^inter[a-z]{3,}/, 'inter-(사이)', m => /사이|상호|국제|간/.test(m)],
  [/^trans[a-z]{3,}/, 'trans-(가로질러, 옮겨)', m => /옮|전|교통|번역|변/.test(m)], [/^over[a-z]{3,}/, 'over-(넘치게)', m => /과|넘|지나/.test(m)],
  [/^[a-z]{3,}tion$/, '-tion(~하는 것)', m => !/다$/.test(m)], [/^[a-z]{3,}ful$/, '-ful(가득한)', () => true], [/^[a-z]{3,}less$/, '-less(없는)', m => /없|않/.test(m)],
  [/^[a-z]{3,}able$/, '-able(~할 수 있는)', () => true], [/^[a-z]{3,}ly$/, '-ly(~하게)', m => /(게|히|이)$/.test(m)], [/^[a-z]{3,}ness$/, '-ness(~함, 상태)', m => !/다$/.test(m)]
];
function mkTip(en, m) {
  const w = en.toLowerCase();
  if (/\s/.test(w)) return `${w.split(/\s+/).join(' + ')} → 한 덩어리로 외워요: ${m}`;
  const hits = AFFIX.filter(([re, , ok]) => re.test(w) && ok(m)).map(a => a[1]).slice(0, 2);
  return hits.length ? `${hits.join(' + ')} → ${m}` : '';
}
// 에피소드 하나: 이야기 자막 + 단어마다 그림 칸·그림 설명·팁
function mkStory(epWords, rows, n) {
  const f = SF[((n % SF.length) + SF.length) % SF.length];
  const fill = t => t.replace(/\{([HFVP])\}(\{(이가|은는|을를|와과)\})?/g, (all, k, j, jj) => {
    const nm = f[k]; if (!jj) return nm;
    const [a, b] = { 이가: ['이', '가'], 은는: ['은', '는'], 을를: ['을', '를'], 와과: ['과', '와'] }[jj];
    return J(nm, a, b);
  });
  const lines = f.intro.map(fill), words = {}, used = {};
  epWords.forEach((id, i) => {
    const r = rows[id], m = (r.ko.split(/\s*,\s*/)[0] || r.ko).replace(/\([^)]*\)/g, '').replace(/^~\s*/, '').trim() || r.ko;
    const kind = mkKind(m, r.pos), list = ST[kind];
    const k = used[kind] = (used[kind] || 0); used[kind]++;
    const arg = kind === 'hada' ? m.replace(/하다$/, '') : m;
    let line = fill(list[(k + n) % list.length](arg));
    line = line.replace(/\{W:([^}]+)\}/, (all, t) => `{${id}|${t}}`);
    lines.push(line);
    const hit = autoPicHit(r.ko);
    const h = hit ? hit[1] : {};
    let panel;
    if (h.e) panel = { subject: { kind: 'emoji', emoji: h.e } };
    else {
      const sj = Object.assign({}, f.hero);
      if (sj.kind === 'person') { sj.pose = h.p || AUTO_POSE[i % AUTO_POSE.length]; if (h.face) sj.face = h.face; }
      else sj.pose = h.p === 'run' || h.p === 'sleep' ? h.p : ['wave', 'cheer', 'hold'][i % 3];
      panel = { subject: sj };
      if (h.hold) panel.hold = h.hold;
      else if (!h.p && i % 2) panel.hold = AUTO_EMO[i % AUTO_EMO.length];
    }
    Object.assign(panel, { bg: f.bg, sign: shortW(id).slice(0, 18), signStyle: panel.subject.kind === 'emoji' ? 'board' : 'bubble', mark: h.mark || (i % 3 ? 'none' : 'exclaim') });
    const plain = line.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
    words[id] = { panel, pic: plain.slice(0, 120), tip: mkTip(id, m) };
  });
  f.outro.forEach(o => lines.push(fill(o)));
  return { title: f.title, lines, words };
}

