/* ================= 뜻 그림: 단어 뜻이 한눈에 보이는 그림 칸 =================
   그 줄을 하는 인물(주인공·친구·말썽꾼)을 이야기마다 정해 둔 모습으로 그리고,
   뜻 갈래에 따라 그림 꼴을 골라요: 건네기(act) · 전→후(change) · 비교(compare) · 금지(no) · 많음(many) · 마음(feel).
   그림에는 영어 단어나 뜻 글자를 쓰지 않아요 (문제를 풀 때 답이 보이지 않게). */

// 이야기마다 인물 셋의 모습 (주인공은 이야기 틀의 hero)
const SF_KIT = {
  '용과 기사 레오': { F: { kind: 'person', hat: 'crown', hair: 'long', outfit: 'pink' }, V: { kind: 'dragon' } },
  '거북이 토토의 역전승': { F: { kind: 'squirrel' }, V: { kind: 'hare' } },
  '막내 돼지의 튼튼한 집': { F: { kind: 'emoji', emoji: '🐷' }, V: { kind: 'wolf' } },
  '알라딘과 수다쟁이 지니': { F: { kind: 'genie' }, V: { kind: 'person', hat: 'turban', extra: ['robe', 'beard'], outfit: 'navy', skin: 1 } },
  '마법 학교의 루나': { F: { kind: 'bird' }, V: { kind: 'emoji', emoji: '👻' } },
  '우주비행사 민의 모험': { F: { kind: 'emoji', emoji: '🤖' }, V: { kind: 'emoji', emoji: '👽' } },
  '해적 선장 해나': { F: { kind: 'bird' }, V: { kind: 'octopus' } },
  '탐정 셜리의 사건 수첩': { F: { kind: 'emoji', emoji: '🐕' }, V: { kind: 'person', extra: 'suit', outfit: 'navy', hat: 'cap' } },
  '흥부와 보은 제비': { F: { kind: 'bird' }, V: { kind: 'person', outfit: 'red', hair: 'bun', extra: ['beard', 'glasses'], hat: 'cap' } },
  '신데렐라의 유리 구두': { F: { kind: 'person', hat: 'pointy', extra: 'robe', outfit: 'purple', hair: 'bun', hairColor: 'grey' }, V: { kind: 'person', outfit: 'pink', hair: 'curly', hairColor: 'red' } },
  '헨젤과 그레텔의 과자 집': { F: { kind: 'person', outfit: 'pink', hair: 'pony', hairColor: 'blond' }, V: { kind: 'person', hat: 'pointy', extra: 'robe', outfit: 'navy', hair: 'long', hairColor: 'grey' } },
  '손오공과 파초선': { F: { kind: 'person', hair: 'bald', extra: 'robe', outfit: 'yellow' }, V: { kind: 'emoji', emoji: '👹' } }
};
const stKit = (f, who) => ({ ...(who === 'H' ? f.hero : ((SF_KIT[f.title] || {})[who] || f.hero)) });
// 상대역: 말썽꾼·친구의 상대는 주인공, 주인공의 상대는 친구
const ST_OTHER = { V: 'H', H: 'F', F: 'H' };
// 그 줄을 하는 인물: 단어 앞에서 '은/는'이 붙은 인물(주어). 없으면 문장 틀 첫머리 인물, 그것도 없으면 주인공
const stRoleOf = t => {
  const s = String(t || ''), at = s.search(/\{Wq?[:}]/), head = at < 0 ? s : s.slice(0, at);
  const tp = [...head.matchAll(/\{([HFV]):(?:은|는)\}/g)].pop() || (at >= 0 ? s.slice(at).match(/\{([HFV]):(?:은|는)\}/) : null);
  return tp ? tp[1] : /^\{V[:}]/.test(s) ? 'V' : /^\{F[:}]/.test(s) ? 'F' : 'H';
};
// 뜻 자체를 나타내는 기호 이모지(가위·공사 표지·금지 표시 …)는 건네거나 늘어놓는 물건으로 쓰지 않아요 (뜻이 거꾸로 읽혀요)
const ST_SYM = /✂️|🚧|🧹|🌵|🚫|⛔|🛑|🐜|🐘|💥|🔧|🥁|🐷/;
const stSym = e => e && !ST_SYM.test(e) ? e : '';

// 뜻 갈래 → 그림 꼴. 차례대로 보고 처음 맞는 것을 써요 (앞쪽이 더 좁은 뜻). null을 돌려주면 다음 규칙으로
// c = { e: 뜻에 맞는 이모지(없으면 ''), me: 그 줄의 인물, other: 상대, face(pose, face): 표정·자세를 바꾼 인물, trend: 'up'|'down'|'' }
const ST_PIC = [
  [/빌려주|빌려 주|대여하|대출해 주/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '📕', dir: 'ab' })],
  [/빌리|빌려|대출|차용|꾸다/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '📕', dir: 'ba' })],
  // '주다'가 가벼운 동사인 말(상처를 주다·겁을 주다·벌을 주다·영향을 주다)은 선물이 아니에요
  [/(?:상처|피해|고통|해|손해|충격)(?:을|를)? 주다|다치게 하|아프게 하/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: '💥', dir: 'ab' })],
  [/(?:겁|공포)(?:을|를)? 주다|겁먹게 하|무섭게 하/, c => ({ layout: 'act', a: c.face('point', 'shout'), b: c.other, item: '😱', dir: 'ab' })],
  [/벌(?:을|를)? 주다|벌하다|처벌/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: '💢', dir: 'ab' })],
  [/(?:영향|영감)(?:을|를)? 주다|영향을 미치|보여 주다/, c => ({ layout: 'act', a: c.face('point', 'open'), b: c.other, item: '✨', dir: 'ab' })],
  [/가르치|설명|알려 ?주|알려 ?줘|안내|조언|충고|지도하/, c => ({ layout: 'act', a: c.face('point', 'open'), b: c.other, item: c.e || '💡', dir: 'ab' })],
  [/(?<!(?:영향|상처|겁|벌|영감|충격|피해|고통|해|손해|부담|스트레스)(?:을|를)? |보여 |알려 |가르쳐 )주다|건네|넘겨|선물|기부|기증|제공|공급|나누어|나눠|베풀|바치|전달|배달|(?<!시간을 )보내|(?:편지|소포|짐)(?:을|를)? 부치/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🎁', dir: 'ab' })],
  [/(?<!(?:고통|벌|상처|영향|스트레스|공격|충격|피해|비난|오해)(?:을|를)? )받다|받아|얻다|얻어|획득|수령|입수|물려받|상속/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🎁', dir: 'ba' })],
  [/교환|맞바꾸|바꿔 주|거래|무역|교역/, c => ({ layout: 'act', a: c.me, b: c.other, item: c.e || '🔄', dir: 'both' })],
  [/돕|도와|도움|지원하다|원조|구조하|구해 주|구하다|구해/, c => ({ layout: 'act', a: c.face('hold', 'smile'), b: c.other, item: c.e || '🤝', dir: 'ab' })],
  [/칭찬|격려|응원|축하|감사|박수|손뼉/, c => ({ layout: 'act', a: c.face('cheer', 'happy'), b: c.other, item: c.e || '👏', dir: 'ab' })],
  [/훔치|빼앗|도둑|약탈|가로채/, c => ({ layout: 'act', a: c.face('run', 'shout'), b: c.other, item: c.e || '💰', dir: 'ba' })],
  [/공격|때리|(?<!(?:피아노|기타|북|드럼|건반|테니스|탁구|골프|공|시험|점|장난|천막|박수|손뼉)(?:을|를)? )치다|싸우|다투|괴롭히|위협/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: '💥', dir: 'ab' })],
  [/비난|비판|꾸짖|야단|혼내|불평|항의/, c => ({ layout: 'act', a: c.face('point', 'angry'), b: c.other, item: c.e || '💢', dir: 'ab' })],
  [/줄이|줄어|감소|축소|낮추|낮아|덜다|삭감|하락|약해|약화/, c => ({ layout: 'change', from: (stSym(c.e) || '🍪').repeat(5), to: stSym(c.e) || '🍪' })],
  // '떨어지다'·'오르다'는 장면이 숫자·양을 말할 때만 (그림 힌트가 📉/📈)
  [/떨어지/, c => c.trend === 'down' ? { layout: 'change', from: '🍪'.repeat(5), to: '🍪' } : null],
  [/오르/, c => c.trend === 'up' ? { layout: 'change', from: '🌱', to: '🌳' } : null],
  [/늘리|늘어|증가|확대|확장|키우|커지|성장|자라|불어나|상승|강해|강화|발전|개선|향상|나아지/, c => ({ layout: 'change', from: stSym(c.e) || '🌱', to: (stSym(c.e) || '🌳').repeat(stSym(c.e) ? 5 : 1) })],
  [/고치|수리|수선|복구|복원/, () => ({ layout: 'change', from: '🏚️', to: '🏠' })],
  [/회복|치료|낫다|완쾌/, () => ({ layout: 'change', from: '🤕', to: '😄' })],
  [/정리하|정돈|청소|치우다|치워|치운/, () => ({ layout: 'change', from: '🧦🧸📚', to: '✨' })],
  [/부수|깨뜨|망가|파괴|부서지|깨지|무너지|붕괴|고장/, c => ({ layout: 'change', from: stSym(c.e) || '🏠', to: '💥' })],
  [/녹다|녹이|녹아/, () => ({ layout: 'change', from: '🧊', to: '💧' })],
  [/얼다|얼리|얼어/, () => ({ layout: 'change', from: '💧', to: '🧊' })],
  [/변하|바뀌|바꾸|변화|변신|변형|전환/, c => ({ layout: 'change', from: stSym(c.e) || '🐛', to: stSym(c.e) ? '✨' : '🦋' })],
  [/비교|대조|견주/, c => ({ layout: 'compare', left: c.e || '🍎', right: '🍊', rel: 'vs' })],
  [/(?<![가-힣] )(?:같은|같다)|동일|똑같|비슷|유사|닮|동등/, c => ({ layout: 'compare', left: c.e || '🍎', right: c.e || '🍎', rel: '=' })],
  [/다르|다른|차이|구별|구분|달리(?= |$)|반대의|반대편|정반대|맞은편/, c => ({ layout: 'compare', left: c.e || '🍎', right: '🍊', rel: '≠' })],
  [/보다 큰|더 큰|우월|능가|뛰어나다|뛰어나게|뛰어남|초과/, () => ({ layout: 'compare', left: '🐘', right: '🐭', rel: '>' })],
  // '~어 버리다'(다 해 버리다)는 버리는 장면이 아니에요
  [/(?<!(?:어|아|여|워|와|져|쳐|해|려|러) )버리|내버리|던져 버리|폐기/, c => ({ layout: 'act', a: c.face('point', 'serious'), b: '🗑️', item: c.e && c.e !== '🗑️' ? c.e : '🥫', dir: 'ab' })],
  [/포기|단념/, c => ({ subject: c.face('sad', 'worry'), hold: '🏳️' })],
  [/멈추|멈춰|정지하|정지시|중단|그만두/, c => ({ subject: c.face('stand', 'serious'), hold: '🛑' })],
  [/없애|제거|삭제|지우다/, c => ({ layout: 'act', a: c.face('point', 'serious'), b: '🗑️', item: stSym(c.e) || '🍬', dir: 'ab' })],
  [/금지|막다|막아|막았|가로막|차단|방해|거절|거부|반대하|반대(?= |$)|사양|피하|회피|취소|부정하|무시/, c => ({ layout: 'no', thing: stSym(c.e) || '🍬', by: c.face('shrug', 'serious') })],
  [/부족|결핍|모자라|(?<!(?:수|거의|전례|유례|관련|관계|상관|쓸모|필요|틀림|끊임|의미|재미|소용|어이|변함|다름|문제|빈틈|거침|흠|힘|맛|멋|철|정신|가차|버릇|염치|상관) ?)없는|(?<!(?:수|거의|전례|유례|관련|관계|상관|쓸모|필요|틀림|끊임|의미|재미|소용|어이|변함|다름|문제|빈틈|거침|흠|힘|맛|멋|철|정신|가차|버릇|염치) ?)없다|텅|가난|궁핍/, c => ({ layout: 'no', thing: stSym(c.e) || '🍞' })],
  [/호기심|신기하|신기한|신기해|흥미/, c => ({ layout: 'feel', who: c.face('think', 'wow'), feel: '❓✨' })],
  [/다양|여러 가지|갖가지|가지각색/, () => ({ layout: 'many', thing: '🍎🍌🍇🍊🍓🥝' })],
  // 'X이 많은'(말이 많은·경험이 많은)은 물건이 많은 게 아니에요
  [/(?<![가-힣][이가] )많|풍부|가득|넘치|넉넉|무수|군중|대량|흔한|수많/, c => ({ layout: 'many', thing: stSym(c.e) || '🍎', n: 9 })],
  [/외로|쓸쓸|고독/, c => ({ layout: 'feel', who: c.face('sad', 'worry'), feel: '😢' })],
  [/드문|희귀|적은|소수|유일|혼자|홀로/, c => ({ layout: 'many', thing: stSym(c.e) || '🍎', n: 1 })],
  [/불안|걱정|두려|무서|겁|긴장|초조|떨리|조마조마/, c => ({ layout: 'feel', who: c.face('think', 'worry'), feel: '😰' })],
  [/화나|화난|화가 ?나|화가 ?난|화내|분노|짜증|성나|성난|격분|격노/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😠💢' })],
  [/기쁘|기쁜|기쁨|행복|즐겁|즐거|즐기|신나|신난|만족|뿌듯|자랑스|흐뭇/, c => ({ layout: 'feel', who: c.face('cheer', 'happy'), feel: '😄🎉' })],
  [/슬프|슬픈|슬픔|우울|눈물|서운|실망|좌절|비참|비통/, c => ({ layout: 'feel', who: c.face('sad', 'worry'), feel: '😢' })],
  [/놀라|놀란|당황|깜짝|충격/, c => ({ layout: 'feel', who: c.face('stand', 'wow'), feel: '😲❗' })],
  [/후회|뉘우치|반성/, c => ({ layout: 'feel', who: c.face('sad', 'worry'), feel: '😣💭' })],
  [/부러(?!지|뜨|져|진)|질투|샘내/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😒' + (c.e || '🍰') })],
  [/원하|바라(?!보)|갈망|소망|꿈꾸|희망|기대하|기대감|기대되|기대(?= |$)/, c => ({ layout: 'feel', who: c.face('think', 'smile'), feel: c.e || '🌟' })],
  [/기억|추억|떠올|회상|그리워/, c => ({ layout: 'feel', who: c.face('think', 'smile'), feel: (c.e || '🎈') + '💭' })],
  [/생각|상상|궁금|고민|의심|추측|짐작|헷갈|모르/, c => ({ layout: 'feel', who: c.face('think', 'serious'), feel: '❓' + (c.e || '💭') })],
  [/깨닫|이해|알아차|발견|찾아내|발명|아이디어/, c => ({ layout: 'feel', who: c.face('point', 'wow'), feel: '💡' })],
  [/사랑|좋아하|아끼는|아끼다|소중/, c => ({ layout: 'feel', who: c.face('stand', 'happy'), feel: '😍' + (c.e || '') })],
  [/싫어|미워|혐오|싫증/, c => ({ layout: 'feel', who: c.face('stand', 'angry'), feel: '😖' + (c.e || '') })],
  [/피곤|지친|졸리|지루/, c => ({ layout: 'feel', who: c.face('sleep', 'smile'), feel: '😴' })]
];
// 뜻 그림 칸 하나. hit = 예전 뜻 갈래 그림({e, a, p, face, hold, mark})
// otherRole: 문장 틀에 함께 나오는 인물 (없으면 기본 상대역)
function stPanel(w, r, f, i, role, hit, otherRole) {
  // 추상어 장면(08-story-plot.js)은 그 줄의 사건을 그려요: 이야기 이모지(X)와 심사하는 인물로
  if (typeof hit === 'function') {
    const me = stKit(f, role), X = { ...ST_PX, ...((f.N && f.N.X) || {}) };
    const pf = who => (pose, fc) => { const k = { ...who }; if (k.kind !== 'emoji') { k.pose = pose; k.face = fc; } return k; };
    const spec = hit({ X, me, other: stKit(f, otherRole || ST_OTHER[role] || 'F'), face: pf(me), hface: pf(stKit(f, 'H')), judge: { kind: 'emoji', emoji: X.judge }, V: stKit(f, 'V'), F: stKit(f, 'F'), H: stKit(f, 'H') });
    if (spec) return { bg: f.bg, ...spec };
    hit = {};
  }
  hit = hit || {};
  const me = stKit(f, role), other = stKit(f, otherRole || ST_OTHER[role] || 'F');
  const e0 = typeof hit.e === 'string' ? hit.e : typeof hit.hold === 'string' ? hit.hold : '';
  const e = /📉|📈|📊|⚖️|🔁|🔄|✅|❌|❓|❗|➕|➖|💯|🆗/.test(e0) || /[\u{1F600}-\u{1F64F}\u{1F910}-\u{1F91C}\u{1F920}-\u{1F92F}\u{1F970}-\u{1F97A}\u{1F466}-\u{1F483}\u{1F486}-\u{1F487}\u{1F574}-\u{1F575}\u{1F6B6}\u{1F926}\u{1F937}\u{1F9B8}-\u{1F9B9}\u{1F9CD}-\u{1F9DF}]/u.test(e0) ? '' : e0;
  const trend = /📈/.test(e0) ? 'up' : /📉/.test(e0) ? 'down' : '';
  const face = (pose, fc) => { const k = { ...me }; if (k.kind !== 'emoji') { k.pose = pose; k.face = fc; } return k; };
  // 이야기 문장이 쓰는 첫 뜻으로만 골라요 (뒤쪽의 드문 뜻이 그림을 가로채지 않게)
  const text = (w && w.m) || String((r && r.ko) || '').replace(/\([^)]*\)/g, ' ').split(/[,;/]/)[0];
  let spec = null;
  for (const [re, mk] of ST_PIC) if (stHit(re, text) && (spec = mk({ e, me, other, face, role, trend }))) break;
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
    else if (!e && e0 && !hit.a && w && w.kind === 'n') spec = { subject: { kind: 'emoji', emoji: e0 } }; // 얼굴 이모지(🤫)는 이름씨 그림으로는 괜찮아요
    if (hit.mark) spec.mark = hit.mark;
  }
  return { bg: f.bg, ...spec };
}
