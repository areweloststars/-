/* ================= 뜻 그림: 단어 뜻이 한눈에 보이는 그림 칸 =================
   그 줄을 하는 인물(주인공·친구·말썽꾼)을 이야기마다 정해 둔 모습으로 그리고,
   뜻 갈래에 따라 그림 꼴을 골라요: 건네기(act) · 전→후(change) · 비교(compare) · 금지(no) · 많음(many) · 마음(feel).
   그림에는 영어 단어나 뜻 글자를 쓰지 않아요 (문제를 풀 때 답이 보이지 않게). */

// 이야기마다 인물 셋의 모습 (주인공은 이야기 틀의 hero)
const SF_KIT = {
  '용과 기사 레오': { F: { kind: 'person', hat: 'crown', hair: 'long', outfit: 'pink' }, V: { kind: 'dragon' } },
  '거북이 토토의 역전승': { F: { kind: 'squirrel' }, V: { kind: 'hare' } },
  '막내 돼지의 튼튼한 집': { F: { kind: 'pig' }, V: { kind: 'wolf' } },
  '알라딘과 수다쟁이 지니': { F: { kind: 'genie' }, V: { kind: 'person', hat: 'turban', extra: ['robe', 'beard'], outfit: 'navy', skin: 1 } },
  '마법 학교의 루나': { F: { kind: 'bird' }, V: { kind: 'emoji', emoji: '👻' } },
  '우주비행사 민의 모험': { F: { kind: 'emoji', emoji: '🤖' }, V: { kind: 'emoji', emoji: '👽' } },
  '해적 선장 해나': { F: { kind: 'bird' }, V: { kind: 'octopus' } },
  '탐정 셜리의 사건 수첩': { F: { kind: 'emoji', emoji: '🐕' }, V: { kind: 'person', extra: 'suit', outfit: 'navy', hat: 'cap' } },
  '흥부와 보은 제비': { F: { kind: 'bird' }, V: { kind: 'person', outfit: 'red', hair: 'bun', extra: 'beard' } },
  '신데렐라의 유리 구두': { F: { kind: 'person', hat: 'pointy', extra: 'robe', outfit: 'purple', hair: 'bun', hairColor: 'grey' }, V: { kind: 'person', outfit: 'pink', hair: 'curly', hairColor: 'red' } },
  '헨젤과 그레텔의 과자 집': { F: { kind: 'person', outfit: 'pink', hair: 'pony', hairColor: 'blond' }, V: { kind: 'person', hat: 'pointy', extra: 'robe', outfit: 'navy', hair: 'long', hairColor: 'grey' } },
  '손오공과 파초선': { F: { kind: 'person', hair: 'bald', extra: 'robe', outfit: 'yellow' }, V: { kind: 'emoji', emoji: '👹' } }
};
const stKit = (f, who) => ({ ...(who === 'H' ? f.hero : ((SF_KIT[f.title] || {})[who] || f.hero)) });
// 상대역: 말썽꾼·친구의 상대는 주인공, 주인공의 상대는 친구
const ST_OTHER = { V: 'H', H: 'F', F: 'H' };
// 그 줄을 하는 인물: 문장 틀이 {V…}·{F…}로 시작하면 그 인물, 아니면 주인공
const stRoleOf = t => /^\{V[:}]/.test(t || '') ? 'V' : /^\{F[:}]/.test(t || '') ? 'F' : 'H';

// 뜻 갈래 → 그림 꼴. 차례대로 보고 처음 맞는 것을 써요 (앞쪽이 더 좁은 뜻)
// c = { e: 뜻에 맞는 이모지(없으면 ''), me: 그 줄의 인물, other: 상대, face(sp): 얼굴을 바꾼 인물 }
const ST_PIC = [
  [/빌려주|빌려 주|대여하|대출해 주/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '📕', dir: 'ab' })],
  [/빌리|빌려|대출|차용|꾸다/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '📕', dir: 'ba' })],
  [/주다|건네|넘겨|선물|기부|기증|제공|공급|나누어|나눠|베풀|바치|전달|배달|보내|부치/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🎁', dir: 'ab' })],
  [/받다|받아|얻다|얻어|획득|수령|입수|물려받|상속/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🎁', dir: 'ba' })],
  [/바꾸|교환|맞바꾸|거래|무역|교역/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🔄', dir: 'both' })],
  [/가르치|설명|알려|안내|조언|충고|지도하/, c => ({ layout: 'act', a: c.face('point', 'open'), b: c.other, item: c.e || '💡', dir: 'ab' })],
  [/돕|도와|도움|지원|구조|구하다|구해/, c => ({ layout: 'act', a: c.face('hold', 'smile'), b: c.other, item: c.e || '🤝', dir: 'ab' })],
  [/훔치|빼앗|도둑|약탈|가로채/, c => ({ layout: 'act', a: c.face('run', 'shout'), b: c.other, item: c.e || '💰', dir: 'ba' })],
  [/공격|때리|치다|싸우|다투|괴롭히|위협/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: c.e || '💥', dir: 'ab' })],
  [/칭찬|격려|응원|축하|감사/, c => ({ layout: 'act', a: c.face('cheer', 'happy'), b: c.other, item: c.e || '👏', dir: 'ab' })],
  [/비난|비판|꾸짖|야단|혼내|불평|항의/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: c.e || '💢', dir: 'ab' })],
  [/줄이|줄어|감소|축소|낮추|낮아|절약|아끼|덜다|삭감|하락|떨어지|약해|약화/, c => ({ layout: 'change', from: (c.e || '📦').repeat(5), to: c.e || '📦' })],
  [/늘리|늘어|증가|확대|확장|키우|커지|성장|자라|불어나|상승|오르|강해|강화|발전/, c => ({ layout: 'change', from: c.e || '🌱', to: (c.e || '🌳').repeat(c.e ? 5 : 1) })],
  [/고치|수리|수선|복구|복원|회복|치료|낫다|나아지|개선|향상|정리하|청소/, c => ({ layout: 'change', from: c.e === '🔧' || !c.e ? '💔' : '🤕', to: c.e && c.e !== '🔧' ? c.e : '❤️' })],
  [/부수|깨뜨|망가|파괴|부서지|깨지|무너지|붕괴|고장/, c => ({ layout: 'change', from: c.e || '🏠', to: '💥' })],
  [/변하|바뀌|변화|변신|변형|전환|녹다|녹이|얼다|얼리/, c => ({ layout: 'change', from: c.e || '🐛', to: c.e ? '✨' : '🦋' })],
  [/비교|대조|견주/, c => ({ layout: 'compare', left: c.e || '🍎', right: '🍊', rel: 'vs' })],
  [/같은|같다|동일|똑같|비슷|유사|닮/, c => ({ layout: 'compare', left: c.e || '🍎', right: c.e || '🍎', rel: '=' })],
  [/다르|다른|차이|구별|구분|달리/, c => ({ layout: 'compare', left: c.e || '🍎', right: '🍊', rel: '≠' })],
  [/보다 큰|더 큰|우월|능가|뛰어나|초과/, c => ({ layout: 'compare', left: '🐘', right: '🐭', rel: '>' })],
  [/금지|막다|막아|막았|가로막|차단|방해|거절|거부|반대|사양|피하|회피|포기|단념|버리|그만두|중단|멈추|끊다|없애|제거|삭제|취소|부정하|무시/, c => ({ layout: 'no', thing: c.e || '🍬', by: c.face('shrug', 'serious') })],
  [/부족|결핍|모자라|없는|없다|빈|텅|가난|궁핍/, c => ({ layout: 'no', thing: c.e || '🍞' })],
  [/호기심|신기|흥미/, c => ({ layout: 'feel', who: c.face('think', 'wow'), feel: '❓✨' })],
  [/많|풍부|가득|넘치|넉넉|무수|다양|군중|대량|흔한|수많/, c => ({ layout: 'many', thing: c.e || '🍎', n: 9 })],
  [/드문|희귀|적은|소수|유일|외로|혼자|홀로/, c => ({ layout: 'many', thing: c.e || '🍎', n: 1 })],
  [/불안|걱정|두려|무서|겁|긴장|초조|떨리|조마조마/, c => ({ layout: 'feel', who: c.face('think', 'worry'), feel: '😰' })],
  [/화나|화가|화내|분노|짜증|성나|격분/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😠💢' })],
  [/기쁘|기쁨|행복|즐겁|즐기|신나|만족|뿌듯|자랑스/, c => ({ layout: 'feel', who: c.face('cheer', 'happy'), feel: '😄🎉' })],
  [/슬프|슬픔|우울|눈물|서운|실망|좌절/, c => ({ layout: 'feel', who: c.face('sad', 'worry'), feel: '😢' })],
  [/놀라|놀란|당황|깜짝|충격/, c => ({ layout: 'feel', who: c.face('stand', 'wow'), feel: '😲❗' })],
  [/후회|뉘우치|반성/, c => ({ layout: 'feel', who: c.face('sad', 'worry'), feel: '😣💭' })],
  [/부러|질투|샘내/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😒' + (c.e || '🍰') })],
  [/원하|바라|갈망|소망|꿈꾸|희망|기대/, c => ({ layout: 'feel', who: c.face('think', 'smile'), feel: c.e || '🌟' })],
  [/기억|추억|떠올|회상|그리워/, c => ({ layout: 'feel', who: c.face('think', 'smile'), feel: (c.e || '🎈') + '💭' })],
  [/생각|상상|궁금|고민|의심|추측|짐작|헷갈|모르/, c => ({ layout: 'feel', who: c.face('think', 'serious'), feel: '❓' + (c.e || '💭') })],
  [/깨닫|이해|알아차|발견|찾아내|발명|아이디어/, c => ({ layout: 'feel', who: c.face('point', 'wow'), feel: '💡' })],
  [/사랑|좋아하|아끼는|소중/, c => ({ layout: 'feel', who: c.face('stand', 'happy'), feel: '😍' + (c.e || '') })],
  [/싫어|미워|혐오|싫증/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😖' + (c.e || '') })],
  [/피곤|지친|졸리|지루/, c => ({ layout: 'feel', who: c.face('sleep', 'smile'), feel: '😴' })]
];
// 뜻 그림 칸 하나. hit = 예전 뜻 갈래 그림({e, a, p, face, hold, mark})
function stPanel(w, r, f, i, role, hit) {
  hit = hit || {};
  const me = stKit(f, role), other = stKit(f, ST_OTHER[role] || 'F');
  const e = typeof hit.e === 'string' ? hit.e : typeof hit.hold === 'string' ? hit.hold : '';
  const face = (pose, fc) => { const k = { ...me }; if (k.kind !== 'emoji') { k.pose = pose; k.face = fc; } return k; };
  const text = [w && w.m, r && r.ko].filter(Boolean).join(' ');
  let spec = null;
  for (const [re, mk] of ST_PIC) if (stHit(re, text)) { spec = mk({ e, me, other, face, role }); break; }
  if (!spec) {
    // 맞는 꼴이 없으면 한 장면: 뜻 이모지가 있으면 인물이 그것을 들고, 없으면 인물만 (표정은 뜻에 맞게)
    const sj = { ...me };
    if (sj.kind !== 'emoji') {
      if (hit.p) sj.pose = hit.p; else sj.pose = e ? 'hold' : ['stand', 'point', 'wave', 'cheer', 'think'][i % 5];
      if (hit.face) sj.face = hit.face;
    }
    spec = hit.a ? { subject: { kind: hit.a } } : { subject: sj };
    // 물건·장소·생각 같은 이름씨는 그 이모지를 크게, 동작이면 인물이 들고
    if (e && !hit.a) { if (sj.kind === 'emoji' || (w && w.kind === 'n')) spec = { subject: { kind: 'emoji', emoji: e } }; else spec.hold = e; }
    if (hit.mark) spec.mark = hit.mark;
  }
  return { bg: f.bg, ...spec };
}
