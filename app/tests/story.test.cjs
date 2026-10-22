// 이야기 자동 만들기: 한국어 활용·조사와 문장 품질 회귀 테스트
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./page.cjs');

let page;
const P = () => page || (page = bootPage());
test.after(() => page && page.close());

test('Korean conjugation follows the irregular rules', () => {
  const past = P().json(`Object.fromEntries(${JSON.stringify(['묶', '설명하', '미루', '짓', '돕', '모르', '쓰', '듣', '받', '오', '마시', '되', '보내', '떨', '잡', '무섭', '그렇', '하얗', '좋', '따르', '서두르', '아프', '바쁘', '모으', '다치', '이루', '건네', '덥', '길', '책임을 지', '신경 쓰'])}.map(s => [s, koPast(s, '')]))`);
  assert.deepEqual(past, {
    묶: '묶었어요', 설명하: '설명했어요', 미루: '미뤘어요', 짓: '지었어요', 돕: '도왔어요', 모르: '몰랐어요', 쓰: '썼어요', 듣: '들었어요', 받: '받았어요', 오: '왔어요',
    마시: '마셨어요', 되: '됐어요', 보내: '보냈어요', 떨: '떨었어요', 잡: '잡았어요', 무섭: '무서웠어요', 그렇: '그랬어요', 하얗: '하얬어요', 좋: '좋았어요', 따르: '따랐어요',
    서두르: '서둘렀어요', 아프: '아팠어요', 바쁘: '바빴어요', 모으: '모았어요', 다치: '다쳤어요', 이루: '이뤘어요', 건네: '건넸어요', 덥: '더웠어요', 길: '길었어요',
    '책임을 지': '책임을 졌어요', '신경 쓰': '신경 썼어요'
  });
  const r = P().json(`({ ryeo: ['묶', '떨', '듣', '돕', '짓', '하'].map(s => koVerbForms(s, '').ryeo), neun: ['묶', '떨', '만들'].map(koVerbAttr), attr: ['무섭', '용감하', '작', '빨갛', '길', '재미있', '크'].map(s => koAdjAttr(s, '')) })`);
  assert.deepEqual(r.ryeo, ['묶으려고', '떨려고', '들으려고', '도우려고', '지으려고', '하려고']);
  assert.deepEqual(r.neun, ['묶는', '떠는', '만드는']);
  assert.deepEqual(r.attr, ['무서운', '용감한', '작은', '빨간', '긴', '재미있는', '큰']);
  const parts = P().json(`[['기사', '이'], ['용', '이'], ['학교', '로'], ['길', '로'], ['집', '로'], ['붕대', '을'], ['다발', '을'], ['토토', '와'], ['민', '과'], ['‘유대’', '이라고'], ['방패', '이었어요']].map(([w, p]) => koP(w, p))`);
  assert.deepEqual(parts, ['기사가', '용이', '학교로', '길로', '집으로', '붕대를', '다발을', '토토와', '민과', '‘유대’라고', '방패였어요']);
});

test('part of speech is guessed from the Korean meaning (with English hints)', () => {
  const cases = [['반창고', 'plaster', 'n'], ['묶다', 'tie', 'v'], ['용감한', 'brave', 'a'], ['고대의', 'ancient', 'a'], ['빠르게', 'quickly', 'd'], ['단지', 'merely', 'd'],
    ['그렇지 않으면', 'otherwise', 'd'], ['중요하다', 'important', 'a'], ['예방하다', 'prevent', 'v'], ['효과적인', 'effective', 'a'], ['제한', 'limit', 'n'], ['행운', 'luck', 'n'],
    ['큰', 'big', 'a'], ['가게', 'store', 'n'], ['회의', 'meeting', 'n'], ['공급', 'supply', 'n'], ['꺼리는', 'reluctant', 'a'], ['피할 수 없는', 'inevitable', 'a'], ['의심하다', 'suspect', 'v']];
  const got = P().json(`${JSON.stringify(cases)}.map(([m, en]) => koKind(m, en, 'x').kind)`);
  assert.deepEqual(got, cases.map(c => c[2]));
});

// 일반 사전 뜻으로 만든 단어 목록 (명사·동사·형용사·부사·숙어가 섞임)
const WORDS = [
  ['fence', '울타리, 담장'], ['plaster', '반창고(를 붙이다)'], ['parcel', '소포, 꾸러미'], ['tie', '묶다, 매다'], ['friendship', '우정, 친분'], ['ribbon', '리본, 끈'], ['stick', '막대기'],
  ['explain', '설명하다'], ['ancient', '고대의'], ['quickly', '빠르게'], ['brave', '용감한'], ['decide', '결정하다'], ['carefully', '조심스럽게'], ['harvest', '수확'],
  ['carry out', '실행하다, 수행하다'], ['revenue', '수익'], ['postpone', '연기하다, 미루다'], ['reluctant', '꺼리는, 마지못한'], ['inevitable', '피할 수 없는'], ['abundant', '풍부한'], ['merely', '단지'],
  ['give up', '포기하다'], ['look forward to', '~을 고대하다'], ['in advance', '미리'], ['take part in', '~에 참가하다'], ['be about to', '막 ~하려 하다'], ['rather', '오히려, 꽤'], ['otherwise', '그렇지 않으면'],
  ['get along with', '~와 잘 지내다'], ['because of', '~ 때문에'], ['afford', '~할 여유가 있다'], ['curious', '호기심이 많은'], ['shiver', '떨다'], ['repair', '수리하다'], ['steal', '훔치다'],
  ['suspect', '의심하다, 용의자'], ['necessary', '필요한'], ['frighten', '겁먹게 하다'], ['citizen', '시민'], ['library', '도서관'], ['fear', '두려움'], ['deadline', '마감']
];
const STORIES = () => P().json(`(() => {
  const W = ${JSON.stringify(WORDS)}, rows = {}; for (const [en, ko] of W) rows[en] = { en, ko, pos: 'x' };
  const ids = Object.keys(rows), out = [];
  for (let n = 0; n < SF.length; n++) for (let k = 0; k * 7 < ids.length; k++) {
    const ep = ids.slice(k * 7, k * 7 + 7), st = mkStory(ep, rows, n + k), e = mkEpisode('t', st.title, ep, rows, st);
    out.push({ ids: ep, lines: e.scene.lines, order: e.scene.words });
  }
  return out;
})()`);

test('auto story: every word once, grammatical particles, no leftovers or repeats', () => {
  const finals = P().json(`(${JSON.stringify(WORDS.map(w => w[1]))}).length`);
  assert.equal(finals, WORDS.length);
  const fin = s => { const c = s.charCodeAt(s.length - 1) - 0xAC00; return c >= 0 && c < 11172 ? c % 28 : 0; };
  for (const st of STORIES()) {
    const marks = st.lines.join('\n').match(/\{[^|}]+\|[^}]+\}/g) || [];
    assert.deepEqual(marks.map(m => m.slice(1, m.indexOf('|'))).sort(), st.ids.slice().sort(), 'each word marked exactly once');
    assert.equal(new Set(st.lines).size, st.lines.length, 'no repeated line');
    for (const l of st.lines) {
      const plain = l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
      assert.doesNotMatch(plain, /[{}|~]|undefined|null|\s\s/, `leftover in "${plain}"`);
      assert.match(plain, /[.!?”]$/, `line ends without punctuation: "${plain}"`);
      // 단어 바로 뒤 조사가 받침에 맞는지
      for (const m of l.matchAll(/\{[^|}]+\|([^}]+)\}’?(을|를|이|가|은|는|과|와|으로|로)(?=[\s.,!?”]|$)/g)) {
        const f = fin(m[1]), p = m[2];
        const want = { 을: f ? '을' : '를', 를: f ? '을' : '를', 이: f ? '이' : '가', 가: f ? '이' : '가', 은: f ? '은' : '는', 는: f ? '은' : '는', 과: f ? '과' : '와', 와: f ? '과' : '와', 으로: f && f !== 8 ? '으로' : '로', 로: f && f !== 8 ? '으로' : '로' }[p];
        assert.equal(p, want, `particle after "${m[1]}" in "${plain}"`);
      }
      // '로봇 삐삐가 로봇 삐삐와'처럼 같은 이름이 한 문장에서 자기 자신과 엮이지 않음
      assert.doesNotMatch(plain, /((?:\S+ )?\S+)[이가은는] \1[와과]/, `self-pairing in "${plain}"`);
    }
  }
});

test('auto story: problems come before resolutions, meanings drive the scene', () => {
  const s = P().json(`(() => {
    const rows = {}; for (const [en, ko] of [['friendship', '우정, 친분'], ['tie', '묶다'], ['fence', '울타리, 담장']]) rows[en] = { en, ko, pos: 'x' };
    const st = mkStory(['friendship', 'tie', 'fence'], rows, 0);
    return { lines: st.lines, pic: Object.fromEntries(Object.entries(st.words).map(([k, w]) => [k, w.panel.subject.emoji || w.panel.hold || w.panel.subject.kind])) };
  })()`);
  const at = id => s.lines.findIndex(l => l.includes(`{${id}|`));
  assert.ok(at('fence') < at('tie') && at('tie') < at('friendship'), s.lines.join('\n'));
  assert.match(s.lines[at('fence')], /가로막|넘으려고/);
  assert.match(s.lines[at('tie')], /\{tie\|묶었어요\}/);
  assert.deepEqual(s.pic, { friendship: '🤝', tie: '🪢', fence: '🚧' });
});

test('Korean helpers: spoken verb forms, letter names, look-alike verbs and adjectives', () => {
  const f = P().json(`['보존하', '듣', '돕', '만들'].map(s => { const f = koVerbForms(s, ''); return [f.ja, f.ya, f.lge, f.lsu]; })`);
  assert.deepEqual(f, [['보존하자', '보존해야 해', '보존할게', '보존할 수'], ['듣자', '들어야 해', '들을게', '들을 수'], ['돕자', '도와야 해', '도울게', '도울 수'], ['만들자', '만들어야 해', '만들게', '만들 수']]);
  // 영어 글자 하나는 글자 이름으로 읽어요 ('괴도 X는', '미스터 M이')
  assert.deepEqual(P().json(`[koP('괴도 X', '은'), koP('미스터 M', '이'), koP('Bob', '은')]`), ['괴도 X는', '미스터 M이', 'Bob은']);
  // 꼴이 같은 동사·형용사는 영어로 가름, '그 결과'의 '결과'는 이름씨, '-안'으로 끝난 이름씨는 형용사가 아님
  const k = P().json(`[['차다', 'kick'], ['차다', 'cold'], ['세다', 'count'], ['세다', 'strong'], ['결과', 'result'], ['그 결과', 'as a result'], ['대안', 'alternative'], ['너그러운', 'generous'], ['녹초가 된', 'exhausted']].map(([m, e]) => koKind(m, e, 'x').kind)`);
  assert.deepEqual(k, ['v', 'a', 'v', 'a', 'n', 'd', 'n', 'a', 'a']);
});

test('auto story: verbs get a scene with fitting things from the story world, trouble before help', () => {
  const W = [['submit', '~을 제출하다'], ['deliver', '배달하다'], ['reserve', '예약하다'], ['run out of', '~이 바닥나다'], ['pretend', '~인 척하다'], ['kick', '차다'],
    ['entrust', '위탁하다'], ['evaporate', '증발하다'], ['steal', '훔치다'], ['rescue', '구조하다'], ['generous', '너그러운'], ['lazy', '게으른']];
  const st = ids => P().json(`(() => { const rows = {}; for (const [en, ko] of ${JSON.stringify(W)}) rows[en] = { en, ko, pos: 'x' }; return mkStory(${JSON.stringify(ids)}, rows, 0).lines; })()`);
  const lines = st(['submit', 'deliver', 'reserve', 'run out of', 'pretend', 'kick']);
  const at = id => lines.find(l => l.includes(`{${id}|`)) || '';
  // 기사 이야기(0번)의 물건: 서류는 '작전 계획서', 나를 짐은 '떡볶이 도시락', 예약할 자리는 '성 연회장 맨 앞자리', 떨어지는 것은 '떡볶이'
  assert.match(at('submit'), /작전 계획서를 .*\{submit\|제출했어요\}/);
  assert.match(at('deliver'), /떡볶이 도시락을 .*\{deliver\|배달했어요\}/);
  assert.match(at('reserve'), /맨 앞자리를 미리 \{reserve\|예약했어요\}/);
  assert.match(at('run out of'), /떡볶이가 (벌써 )?\{run out of\|바닥났어요\}/);
  assert.match(at('pretend'), /\{pretend\|잠든 척했어요\}/);
  assert.match(at('kick'), /공을 뻥 \{kick\|찼어요\}/);
  // 장면이 없는 동사는 말하는 줄로(무엇을 하는지 앞뒤로 알 수 있게), 저절로 일어나는 일은 말하지 않는 줄로
  const l2 = st(['entrust', 'evaporate', 'steal', 'rescue']);
  assert.match(l2.find(l => l.includes('{entrust|')).replace(/\{[^|}]+\|([^}]+)\}/g, '$1'), /(자|야 해|게)!”|수 있을까\?”/);
  assert.doesNotMatch(l2.find(l => l.includes('{evaporate|')), /“/);
  // 말썽(훔치다) 뒤, 해결(구조하다) 앞에 단어 없는 다짐 한 줄
  const iS = l2.findIndex(l => l.includes('{steal|')), iR = l2.findIndex(l => l.includes('{rescue|'));
  assert.ok(iS < iR, l2.join('\n'));
  assert.ok(l2.slice(iS + 1, iR).some(l => !/\{[^|}]+\|/.test(l) && /포기하지|물러설|같이 해 보자/.test(l)), l2.join('\n'));
  // 나쁜 성품은 말썽꾼 쪽, 좋은 성품은 주인공 쪽
  const l3 = st(['generous', 'lazy']);
  assert.match(l3.find(l => l.includes('{lazy|')), /용[은이] /);
  assert.doesNotMatch(l3.find(l => l.includes('{generous|')), /용[은이] /);
  // 인물은 처음에 온이름('기사 레오'), 그다음부터 짧은 이름('레오')
  const all = [...lines, ...l2].join('\n');
  assert.match(all, /기사 레오/);
  assert.match(all, /(?<!기사 )레오[는가이와]/);
  // 이음말: '이번에는 …는'처럼 겹치는 말은 쓰지 않음
  for (const l of [...lines, ...l2, ...l3]) assert.doesNotMatch(l, /^이번에는 /);
});

// 일반 사전 뜻으로 쓴 추상어 (토익·수능에 흔한 말). 뜻 갈래가 이야기 줄거리 속 일로 이어지는지
test('abstract words become events of the episode plot, with a matching picture', () => {
  const W = [['appraisal', '평가, 감정', 'n'], ['proficiency', '숙련도, 능숙함', 'n'], ['unprecedented', '전례 없는', 'a'], ['tentative', '잠정적인, 임시의', 'a'], ['consecutive', '연속적인', 'a'], ['restructure', '구조를 개편하다', 'v'],
    ['ambiguous', '모호한, 애매한', 'a'], ['obsolete', '구식의', 'a'], ['deteriorate', '악화되다', 'v'], ['meticulous', '꼼꼼한', 'a'], ['pertinent', '관련 있는, 적절한', 'a'], ['alleviate', '완화하다', 'v']];
  const r = P().json(`(() => { const rows = {}; for (const [en, ko, pos] of ${JSON.stringify(W)}) rows[en] = { en, ko, pos };
    const ids = Object.keys(rows), out = [];
    for (let n = 0; n < SF.length; n++) for (const ep of [ids.slice(0, 6), ids.slice(6)]) { const st = mkStory(ep, rows, n); out.push({ lines: st.lines, panels: Object.fromEntries(ep.map(id => [id, st.words[id].panel])), f: SF[n] }); }
    return out; })()`);
  // 단어만 끼워 넣던 빈 문장은 이제 안 나와요
  const FILLER = /열쇠는 바로|에 관한 공고|딱 어울리는 하루|이야기를 나눴어요|“이건 정말 .* 일이야!”/;
  for (const { lines, panels, f } of r) {
    const text = lines.join('\n'), at = id => lines.findIndex(l => l.includes(`{${id}|`));
    for (const l of lines) assert.doesNotMatch(l, FILLER, l);
    if (at('appraisal') >= 0) {
      // 심사는 단어 줄 가운데 맨 끝, 그 이야기의 심사하는 인물이 그 이야기의 목표를 평가해요
      const word = lines.map((l, i) => /\{[^|}]+\|/.test(l) ? i : -1).filter(i => i >= 0);
      assert.equal(at('appraisal'), word[word.length - 1], text);
      assert.ok(lines[at('appraisal')].includes(f.N.judge), text);
      // 말썽(전례 없는·연속적인)이 먼저, 잠정적 계획 → 구조 개편 → 숙련도 순서
      assert.ok(at('unprecedented') < at('tentative') && at('consecutive') < at('tentative'), text);
      assert.ok(at('tentative') < at('proficiency') && at('restructure') < at('proficiency'), text);
      assert.equal(panels.appraisal.layout, 'act');
      assert.equal(panels.appraisal.a.emoji, f.N.X.judge);
      assert.deepEqual(panels.appraisal.b, f.hero, '심사하는 인물이 주인공의 솜씨를 평가해요 (목표 물건은 아직 없을 수도 있어요)');
    } else {
      assert.ok(at('deteriorate') < at('meticulous') && at('obsolete') < at('alleviate'), text);
      assert.deepEqual([panels.alleviate.from, panels.alleviate.to], ['😰', '😌']);
    }
    // '전례 없는'은 '없다(부족)' 그림이 아니에요. 추상어 그림이 인물만 덩그러니 서 있지 않아요
    for (const [id, pn] of Object.entries(panels)) {
      assert.notEqual(pn.layout, 'no', id);
      assert.ok(pn.layout || pn.hold, `${id}: ${JSON.stringify(pn)}`);
    }
  }
});

// 칩은 배우는 뜻 그대로: '-의' 뜻은 '의'까지 ('장래의'를 '장래'로 떼면 다른 낱말). '의'를 뗀 말도 뜻 목록에 있으면 떼요 ('구식의, 구식' → '구식 물건')
test('word chip keeps a -의 meaning unless the bare noun is listed too', () => {
  const stories = P().json(`(() => {
    const rows = { prospective: { en: 'prospective', ko: '장래의, 유망한', pos: 'x' }, 'old-fashioned': { en: 'old-fashioned', ko: '구식의, 구식', pos: 'x' }, ancient: { en: 'ancient', ko: '고대의', pos: 'x' } };
    return SF.map((f, n) => mkStory(Object.keys(rows), rows, n).lines.join('\\n'));
  })()`);
  assert.equal(stories.length, 12);
  for (const s of stories) {
    assert.match(s, /\{prospective\|장래의\} 꿈/);
    assert.match(s, /\{old-fashioned\|구식\} 물건/);
    assert.match(s, /\{ancient\|고대의/);
  }
});

// 돈·물건·계획 줄은 그 이야기의 목표와 이어져요: 사건(E)·찾는 물건(G)·물건 쓰임(use)·번 돈으로 살 것(buy)·다짐(vow) 가운데 하나를 말해요
// (경주 이야기에 뜬금없는 케이크 가게·물 모으기가 나오지 않게). 일반 사전 낱말과 직접 쓴 뜻
const BIZ = [
  ['profitable', '수익성이 있는, 이익이 되는'], ['considerable', '상당한, 많은'], ['feasible', '실행 가능한, 실현 가능한'], ['budget', '예산'],
  ['secure', '확보하다, 안전한'], ['classify', '분류하다'], ['inquire', '문의하다, 묻다'], ['revenue', '수익, 수입'], ['moderate', '적당한, 온건한'],
  ['fluctuate', '변동하다, 오르내리다'], ['expenditure', '지출, 비용'], ['refund', '환불, 환불하다'], ['wage', '임금, 급여'], ['earn', '벌다'],
  ['save', '저축하다, 아끼다'], ['purchase', '구입하다, 사다'], ['sell', '판매하다, 팔다'], ['operate', '운영하다, 작동하다'], ['customer', '손님, 고객'], ['savings', '저축, 저금']
];
test('money, supply and plan lines serve the goal of every story world', () => {
  const r = P().json(`(() => {
    const W = ${JSON.stringify(BIZ)}, rows = {}; for (const [en, ko] of W) rows[en] = { en, ko, pos: 'x' };
    const ids = Object.keys(rows), plain = l => l.replace(/\\{[^|}]+\\|([^}]+)\\}/g, '$1'), bad = [], props = [];
    let n = 0;
    SF.forEach((f, k) => {
      if (!(f.N.use && f.N.buy && f.N.vow && f.N.dream && f.N.X && f.N.X.supply)) props.push(f.title);
      const goal = [f.E, f.G, f.N.use, f.N.buy, f.N.vow];
      for (let i = 0; i < ids.length; i += 7) {
        const ep = ids.slice(i, i + 7), lines = mkStory(ep, rows, k).lines;
        for (const id of ep) { const l = lines.find(x => x.includes('{' + id + '|')); n++; if (!l || !goal.some(g => plain(l).includes(g))) bad.push(f.title + ': ' + (l || id)); }
      }
    });
    return { n, worlds: SF.length, bad, props };
  })()`);
  assert.deepEqual(r.props, []);
  assert.deepEqual(r.bad, []);
  assert.equal(r.n, r.worlds * BIZ.length);
});
