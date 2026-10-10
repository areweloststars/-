// 실행: npm test  (먼저 npm install로 jsdom을 받아요)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build, out } = require('../build.cjs');
const { bootPage } = require('./page.cjs');

const STORE_KEY = 'day02-voca-mission-v1';
// 일반 사전 뜻으로 만든 연습용 단어 목록 (교재 내용 아님)
const ROWS = [
  ['plaster', '반창고', 'n'], ['fence', '울타리, 담장', 'n'], ['parcel', '소포, 꾸러미', 'n'], ['tie', '묶다, 매다', 'v'],
  ['explain', '설명하다', 'v'], ['ancient', '고대의', 'a'], ['quickly', '빠르게', 'd'], ['brave', '용감한', 'a'],
  ['decide', '결정하다', 'v'], ['carefully', '조심스럽게', 'd'], ['harvest', '수확', 'n'], ['shiver', '떨다', 'v']
].map(([en, ko, pos]) => ({ en, ko, pos }));

test('word-game/index.html is built from app/src (run: npm run build)', () => {
  assert.ok(fs.readFileSync(out, 'utf8') === build(), 'word-game/index.html differs from app/src — run: npm run build');
});

test('boots with the original demo deck and no errors', async () => {
  const p = bootPage();
  try {
    assert.match(p.document.querySelector('#home').textContent, /창작 데모/);
    const s = p.json('({ deck: SAVE.deck, scenes: SCENES.length, words: Object.keys(WORDS).length })');
    assert.equal(s.deck, 'tales-v1');
    assert.equal(s.scenes, 7);
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('demo deck: each story line marks its own words once, every word has answers', () => {
  const p = bootPage();
  try {
    const scenes = p.json(`SCENES.map(s => ({ key: s.key, words: s.words, marks: s.lines.join('\\n').match(/\\{[^|}]+\\|[^}]+\\}/g) || [] }))`);
    for (const s of scenes) {
      const ids = s.marks.map(m => m.slice(1, m.indexOf('|')));
      assert.deepEqual(ids, s.words, `scene ${s.key}: words in story order`);
    }
    const bad = p.json(`Object.keys(WORDS).filter(id => !WORDS[id].ans || !WORDS[id].ans.length || !WORDS[id].m || !WORDS[id].scene)`);
    assert.deepEqual(bad, []);
    // 그림은 장면마다 있음
    const art = p.json('SCENES.filter(s => !ART[s.key] || !/<svg/.test(ART[s.key])).map(s => s.key)');
    assert.deepEqual(art, []);
  } finally { p.close(); }
});

test('old progress (the earlier built-in deck) is kept under its own deck id and survives the first save', () => {
  const oldBest = { s1: { stars: 3, elapsed: 61000 } };
  const p = bootPage({ [STORE_KEY]: { v: 2, dir: 'ko', best: oldBest, lives: 2, bank: 4200, done: 1 } });
  try {
    const s = p.json('({ deck: SAVE.deck, dir: SAVE.dir, best: SAVE.best, lives: SAVE.lives, old: SAVE.decks.day02 })');
    assert.equal(s.deck, 'tales-v1');
    assert.equal(s.dir, 'ko'); // 설정은 그대로
    assert.deepEqual(s.best, {});
    assert.equal(s.lives, 3);
    assert.deepEqual(s.old.best, oldBest);
    p.run('persist()');
    const saved = JSON.parse(p.storage()[STORE_KEY]);
    assert.deepEqual(saved.decks.day02.best, oldBest);
    assert.equal(saved.decks.day02.bank, 4200);
  } finally { p.close(); }
});

test('a deck made on this device is saved, reopened after reload, and keeps its own progress', async () => {
  const p = bootPage();
  let store;
  try {
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, err: MK.err, id: MK.deck && MK.deck.id, scenes: MK.deck && MK.deck.scenes.length, words: MK.deck && Object.keys(MK.deck.words).length })');
    assert.equal(made.err, '');
    assert.equal(made.step, 'done');
    assert.equal(made.words, ROWS.length);
    assert.ok(made.scenes >= 2);
    assert.deepEqual(p.errors, []);
    p.run(`switchDeck(${JSON.stringify(made.id)}); SAVE.best[SCENES[0].key] = { stars: 2, elapsed: 30000 }; persist();`);
    store = p.storage();
    var id = made.id;
  } finally { p.close(); }
  const q = bootPage(store);
  try {
    const s = q.json('({ deck: SAVE.deck, cur: DECK.id, words: Object.keys(WORDS).length, best: Object.keys(SAVE.best).length })');
    assert.equal(s.deck, id);
    assert.equal(s.cur, id);
    assert.equal(s.words, ROWS.length);
    assert.equal(s.best, 1);
    // 기본 단어장으로 돌아가도 사진 단어장 기록은 남음
    q.run(`switchDeck('tales-v1')`);
    assert.equal(q.json(`SAVE.decks[${JSON.stringify(id)}].best ? Object.keys(SAVE.decks[${JSON.stringify(id)}].best).length : 0`), 1);
  } finally { q.close(); }
});

test('OCR layout: pairs words with meanings on the same row or below, column by column', () => {
  const p = bootPage();
  try {
    const W = (t, x, y, c = 92, w = t.length * 14) => ({ t, x0: x, y0: y, x1: x + w, y1: y + 22, c });
    const words = [
      W('1', 4, 10), W('garden', 30, 10), W('n.', 150, 10), W('정원', 190, 10),
      W('2', 4, 60), W('fence', 30, 60), W('울타리,', 190, 60), W('담장', 250, 60),
      W('3', 4, 110), W('parcel', 30, 110), W('소포', 34, 140), // 뜻이 아랫줄에 있는 사전식
      W('river', 520, 10), W('강', 640, 10), W('quickly', 520, 60), W('빠르게', 640, 60)
    ];
    const dict = [['garden', 1], ['fence', 2], ['parcel', 3], ['river', 4], ['quickly', 5]];
    const rows = p.json(`ocrPairs(${JSON.stringify(words)}, new Map(${JSON.stringify(dict)}))`);
    assert.deepEqual(rows, ['garden - 정원', 'fence - 울타리, 담장', 'parcel - 소포', 'river - 강', 'quickly - 빠르게']);
    // 확인 화면용 '사진 속 원래 줄' 상자: 영어 단어와 뜻을 함께 감쌈 (기울기를 펴도 원래 위치로)
    const boxes = p.json(`(() => { OCR.boxes = new Map(); ocrPairs(${JSON.stringify(words)}, new Map(${JSON.stringify(dict)}), 0.01); const b = Object.fromEntries(OCR.boxes); OCR.boxes = null; return b; })()`);
    assert.deepEqual(Object.keys(boxes).sort(), ['fence', 'garden', 'parcel', 'quickly', 'river']);
    assert.deepEqual(boxes.fence, { x0: 30, y0: 60, x1: 278, y1: 82 });
    assert.deepEqual(boxes.parcel, { x0: 30, y0: 110, x1: 114, y1: 162 });
    // 잘 헷갈리는 글자 고치기: 'fenee' → 'fence'
    assert.equal(p.json(`ocrFix('fenee', new Map(${JSON.stringify(dict)}))`), 'fence');
  } finally { p.close(); }
});

test('OCR dictionary pages: headwords and meaning lines survive common misreads', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = "";');
    const mean = t => p.json(`ocrMeanLine(${JSON.stringify(t)}, window.__L)`);
    // '('를 못 읽은 설명 괄호, 유의어 기호 ⓢ를 읽은 글자·영어·숫자
    assert.deepEqual(mean('동 1.탐험하다@ 6, 1916) 2. 문제. 생각 등을) 조사하다 @) [8'), ['탐험하다', '조사하다']);
    // 번호를 낱자모로 읽음('ㅇ.'), 비슷한 모양 글자(물→울)
    assert.deepEqual(mean('명 1.물타리 ㅇ.담장'), ['울타리', '담장']);
    // 대괄호로 적은 바꿔 쓸 말, 말줄임표로 시작하는 뜻
    assert.deepEqual(mean('동 제한[금지]하다, …하게 하다'), ['제한하다', '금지하다', '~하게 하다']);
    // 뜻 뒤에 붙은 ⓢ 글자('닫다운'), '['를 못 읽은 대괄호
    assert.deepEqual(mean('동 1.닫다운 close 2.잠그다'), ['닫다', '잠그다']);
    assert.deepEqual(mean('동 감독관리]하다'), ['관리하다']);
    // '~' 자리 표시가 든 뜻, 붙어 읽힌 두 낱말과 비슷한 모양 글자('머리를강다' → '머리를 감다')
    assert.deepEqual(mean('막 ~하려 하다'), ['막 ~하려 하다']);
    assert.deepEqual(mean('1. 00머리를강다)'), ['머리를 감다']);
    // 여러 번 읽은 결과로 다듬기: 비슷한 꼴은 다수결, 이 줄에만 붙어 읽힌 뜻은 다른 읽기에 나온 부분으로
    assert.equal(p.json(`koNear('묶다', '묵다')`), true);
    assert.equal(p.json(`koNear('묶다', '개다')`), false);
    const best = { ms: ['묵다', '상자 바구니'], conf: 0.5 };
    assert.deepEqual(p.json(`(() => { const b = ${JSON.stringify(best)}; return ocrAgree(b, [b, { ms: ['묶다', '상자', '바구니'], conf: 0.6 }, { ms: ['묶다'], conf: 0.55 }]); })()`), ['묶다', '상자', '바구니']);
    // 표제어: 끝 글자를 쉼표로 읽음, 같은 쪽에 여러 번 나온 비슷한 낱말, 다른 표제어로 쓴 낱말은 빼기
    const dict = `new Map([['harvest', 1], ['hope', 1], ['hop', 1], ['garden', 1], ['fence', 1], ['river', 1], ['quickly', 1], ['the', 1]])`;
    assert.equal(p.json(`ocrHeadPick([{ t: 'harves,', c: 60 }, { t: 'harves', c: 55 }], new Map(), ${dict}, () => false)`), 'harvest');
    assert.equal(p.json(`ocrHeadPick([{ t: 'hop', c: 45 }, { t: 'hcp', c: 30 }], new Map([['hope', 2]]), ${dict}, () => false)`), 'hope');
    assert.equal(p.json(`ocrHeadPick([{ t: 'hop', c: 45 }, { t: 'hcp', c: 30 }], new Map([['hope', 2]]), ${dict}, w => w === 'hope')`), 'hop');
    // 또렷하게 두 번 똑같이 읽힌 낱말은 쪽에 비슷한 낱말이 있어도 그대로
    assert.equal(p.json(`ocrHeadPick([{ t: 'hop', c: 60 }, { t: 'hop', c: 50 }], new Map([['hope', 2]]), ${dict}, () => false)`), 'hop');
    // 표제어 찾기: 바로 밑에 붙은 작은 영어(어원 설명)와 여백 선에서 멀리 떨어진 큰 낱말은 표제어가 아님
    const W = (t, x, y, h, c = 95) => ({ t, x0: x, y0: y, x1: x + Math.round(t.length * h * 0.6), y1: y + h, c });
    const words = [W('garden', 20, 100, 34), W('fence', 20, 300, 34), W('river', 22, 500, 34), W('river', 24, 536, 28), W('quickly', 300, 400, 34)];
    for (let k = 0; k < 10; k++) words.push(W('the', 420, 100 + k * 50, 20));
    assert.deepEqual(p.json(`ocrHeadwords(${JSON.stringify(words)}, ${dict}, 1000).map(h => h.t)`), ['garden', 'fence', 'river']);
  } finally { p.close(); }
});

test('OCR app screenshots: two-line words, articles, stray letters and glued words', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = "";');
    const W = (t, x, y, c = 95, w = t.length * 20, h = 40) => ({ t, x0: x, y0: y, x1: x + w, y1: y + h, c });
    const dict = JSON.stringify(['take', 'a', 'break', 'look', 'forward', 'to', 'give', 'up', 'hold', 'on', 'lot', 'of', 'turn', 'away', 'at'].map(w => [w, 1]));
    // 단어장 앱 화면: 왼쪽 영어(두 줄로 넘어가기도 함), 오른쪽 한글 뜻(다음 줄로 넘어가기도 함)
    const words = [
      W('take', 100, 100), W('a', 196, 108, 95, 20, 32), W('break', 226, 100), W('잠시', 440, 100), W('쉬다', 530, 100),
      W('look', 100, 300), W('forward', 196, 300), W('to', 100, 370), W('~을', 440, 300), W('기대하다', 510, 300),
      W('give', 100, 500, 95, 60), W('아', 150, 492, 50, 26, 56), W('up', 180, 500, 60, 40), W('포기하다', 440, 500),
      W('hold', 100, 700), W('on', 196, 700), W('기다리다,', 440, 700), W('버티다', 600, 700), W('(전화를)', 440, 770), W('끊지', 600, 770), W('않다', 690, 770)
    ];
    assert.deepEqual(p.json(`ocrPairs(${JSON.stringify(words)}, new Map(${dict}))`),
      ['take a break - 잠시 쉬다', 'look forward to - ~을 기대하다', 'give up - 포기하다', 'hold on - 기다리다, 버티다 (전화를) 끊지 않다']);
    // 영어·한국어로 두 번 읽은 것 합치기: 영어 사이 'of'를 '아'로 읽은 것은 영어로, 한글 뜻 속 '의'를 'of'로 읽은 것은 한글로,
    // 한글 획 아랫부분만 읽은 낮은 조각('LS')은 버림
    const A = [W('아', 172, 100, 30, 30), W('~', 440, 300, 80, 20), W('의', 470, 300, 93, 30), W('기분을', 510, 300)];
    const E = [W('lot', 100, 100, 97, 60), W('of', 172, 100, 96, 40), W('of', 470, 300, 71, 30), W('LS', 620, 324, 80, 40, 16), W('break', 100, 500, 96)];
    assert.deepEqual(p.json(`ocrMerge(${JSON.stringify(A)}, ${JSON.stringify(E)}, new Map(${dict})).map(w => w.t).sort()`), ['break', 'lot', 'of', '~', '기분을', '의'].sort());
    // 띄어쓰기를 못 읽어 붙은 영어
    assert.equal(p.json(`ocrFix('takeabreak', new Map(${dict}))`), 'take a break');
    assert.equal(p.json(`ocrFix('tumaway', new Map(${dict}))`), 'turn away');
    assert.equal(p.json(`ocrFix('ata', new Map(${dict}))`), 'at a');
    // 붙어 읽힌 한글 뜻 나누기, 쉼표를 못 읽은 뜻 나누기 (명사 둘은 그대로)
    assert.deepEqual(p.json(`koFixWord('결정을내리다', window.__L, true)`), ['결정을 내리다', 0.5]);
    assert.deepEqual(p.json(`koFixWord('~에게도움을주다', window.__L, true)`), ['~에게 도움을 주다', 0.5]);
    assert.deepEqual(p.json(`koListSplit('빠르게 신속하게', window.__L)`), ['빠르게', '신속하게']);
    assert.deepEqual(p.json(`koListSplit('맑은 깨끗한', window.__L)`), ['맑은', '깨끗한']);
    assert.deepEqual(p.json(`koListSplit('출발 시간', window.__L)`), ['출발 시간']);
    // 모든 영어 단어가 같은 크기인 단어장 화면은 사전식 쪽(큰 표제어)으로 보지 않음 (한글을 영어로 잘못 읽은 작은 잡티가 많아도)
    const list = ['river', 'borrow', 'ancient', 'whisper', 'courage', 'explain'].map((t, i) => W(t, 100, 100 + i * 150))
      .concat(Array.from({ length: 12 }, (_, i) => W('Xq', 440 + (i % 3) * 120, 110 + (i >> 1) * 140, 30, 40, 18)));
    assert.equal(p.json(`ocrHeadwords(${JSON.stringify(list)}, new Map(${JSON.stringify(['river', 'borrow', 'ancient', 'whisper', 'courage', 'explain'].map(w => [w, 1]))}), 1080).length`), 0);
  } finally { p.close(); }
});

test('OCR word-list pages: example-line heads, two columns, two words on a slanted line, split syllables', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = "";');
    const W = (t, x, y, c = 95) => ({ t, x0: x, y0: Math.round(y), x1: x + t.length * 16, y1: Math.round(y) + 30, c });
    // 글줄 하나: 낱말을 왼쪽부터 늘어놓음 (sl: 휘어 찍혀 비스듬한 줄의 기울기)
    const line = (y, x, toks, sl = 0, c = 95) => { const o = [], x0 = x; for (const t of toks) { o.push(typeof t === 'string' ? W(t, x, y + sl * (x - x0), c) : W(t.t, x, y + sl * (x - x0), t.c)); x = o[o.length - 1].x1 + 14; } return o; };
    // 두 단 단어장: 번호 + 낱말 + 발음 + 뜻, 바로 아래 그 낱말로 시작하는 예문과 번역. 낱말 크기는 예문과 같음
    const words = [
      ...line(100, 104, ['1borrow', '[bárou]', '빌리다']), ...line(150, 110, ['borrow', 'a', 'book', 'from', 'the', 'library']), ...line(185, 110, ['도서관에서', '책을', '빌리다']),
      ...line(120, 715, ['2', 'explain', '[ikspléin]', '설명하다']), ...line(170, 730, ['explain', 'the', 'rule']), ...line(205, 730, ['규칙을', '설명하다']),
      ...line(300, 95, ['3', 'ancient', '[éinʃənt]', '고대의']), ...line(350, 110, ['ancient', 'ruins']),
      // 흐리게 읽힌 낱말: 예문이 같은 낱말로 또렷하게 시작하면 낱말로 봄
      ...line(320, 715, ['4', W('courage', 0, 0, 20), '[kə́ːridʒ]', '용기']), ...line(370, 730, ['courage', 'to', 'try']),
      ...line(500, 95, ['5', 'whisper', '[wíspər]', '속삭이다']), ...line(550, 110, ['whisper', 'a', 'secret']),
      // 쪽 너비로 쓴 줄에 낱말 둘 ('A … : B …'), 사진이 휘어 줄이 오른쪽으로 내려감. 사이 설명 줄, 예문 줄 둘
      ...line(700, 60, ['6-7', 'gather', '[gǽðər]', '모으다', ':', 'collect', '[kəlékt]', '수집하다'], 0.08),
      ...line(760, 110, ['gather는', '모으는', '것,', 'collect는', '수집하는', '것'], 0.08),
      ...line(800, 110, ['gather', 'the', 'papers', '서류를', '모으다'], 0.08), ...line(840, 110, ['collect', 'old', 'coins', '옛날', '동전을', '모으다'], 0.08),
      // 예문 첫 낱말을 잘못 읽어('pone') 짝이 없어도 단의 낱말 자리에서 발음 기호가 붙은 낱말은 낱말 줄. 발음 기호 없는 머리글('DAY 07')은 아님
      ...line(950, 95, ['8', 'arrive', '[əráiv]', '도착하다']), ...line(1000, 110, ['pone', 'at', 'the', 'station']), ...line(40, 95, ['DAY', '07'])
    ];
    const dict = JSON.stringify(['borrow', 'book', 'from', 'the', 'library', 'explain', 'rule', 'ancient', 'ruins', 'courage', 'to', 'try', 'whisper', 'secret', 'gather', 'papers', 'collect', 'old', 'coins', 'a', 'arrive', 'at', 'station', 'day'].map(w => [w, 1]));
    const heads = p.json(`ocrHeadwords(${JSON.stringify(words)}, new Map(${dict}), 1200).map(h => ({ t: h.t, col: h.col, x0: h.x0, right: h.right || 0, eok: !!h.eok }))`);
    assert.deepEqual(heads.map(h => h.t + ':' + h.col), ['borrow:0', 'explain:1', 'ancient:0', 'courage:1', 'whisper:0', 'gather:0', 'collect:0', 'arrive:0']);
    const hd = t => heads.find(h => h.t === t);
    assert.ok(hd('courage').eok);
    assert.ok(hd('gather').right > 0 && hd('gather').right < hd('collect').x0, '첫 낱말의 뜻 자리는 둘째 낱말 앞까지');
    // 세로 모음 'ㅣ'가 떨어져 숫자·기호로 읽힌 글자('기' → '7 |'), 가운데 글자가 잡티로 빠져 '하다'만 남은 뜻
    const mean = t => p.json(`ocrMeanLine(${JSON.stringify(t)}, window.__L)`);
    assert.deepEqual(mean('이7 |다, 먹0|다'), ['이기다', '먹이다']);
    assert.deepEqual(mean('청소하다, 정2 하다'), ['청소하다']);
    assert.deepEqual(mean('청소하다, 정@ 하다'), ['청소하다']);
    // 여러 번 읽은 뜻 다듬기: 같은 줄의 비슷한 꼴 두 뜻은 따로 두고, 비슷한 꼴 가운데 낱말 목록에 그대로 있는 꼴을 먼저
    assert.deepEqual(p.json(`(() => { const b = { ms: ['가다', '나다'], conf: 0.9 }; return ocrAgree(b, [b, { ms: ['가다', '나다'], conf: 0.8 }], window.__L); })()`), ['가다', '나다']);
    assert.deepEqual(p.json(`(() => { const b = { ms: ['공무하다'], conf: 0.9 }; return ocrAgree(b, [b, { ms: ['공무하다'], conf: 0.8 }, { ms: ['공부하다'], conf: 0.85 }], window.__L); })()`), ['공부하다']);
  } finally { p.close(); }
});

test('typed list parser reads numbered, colon, tab and Korean-first lines', () => {
  const p = bootPage();
  try {
    const rows = p.json(`mkParse(${JSON.stringify('1. garden - 정원\nfence: 울타리, 담장\nparcel\t소포\n묶다 tie\n그냥 메모')}).map(r => r.en + '=' + r.ko)`);
    assert.deepEqual(rows, ['garden=정원', 'fence=울타리, 담장', 'parcel=소포', 'tie=묶다']);
  } finally { p.close(); }
});

test('answers: meaning variants count, negated meanings do not', () => {
  const p = bootPage();
  try {
    const r = p.json(`(() => {
      SAVE.dir = 'en';
      const ans = mkAnsFrom(null, '정확하게, 묶다');
      const ok = (s, k) => ans[k].ok.some(a => hasMeaning(norm(s), a));
      return { groups: ans.map(g => g.t), exact: ok('정확하게', 0), stem: ok('정확', 0), neg1: ok('부정확하게', 0), neg2: ok('정확하지 않게', 0), tie: ok('묶다', 1) };
    })()`);
    assert.deepEqual(r.groups, ['정확하게', '묶다']);
    assert.equal(r.exact, true);
    assert.equal(r.stem, true);
    assert.equal(r.neg1, false);
    assert.equal(r.neg2, false);
    assert.equal(r.tie, true);
  } finally { p.close(); }
});

test('auto story: every word once, no template leftovers, no repeated lines', () => {
  const p = bootPage();
  try {
    for (let n = 0; n < 8; n++) {
      const s = p.json(`(() => {
        const rows = {}; for (const r of ${JSON.stringify(ROWS)}) rows[r.en] = r;
        const ids = Object.keys(rows).slice(0, 7), st = mkStory(ids, rows, ${n}), ep = mkEpisode('t', st.title, ids, rows, st);
        return { ids, lines: ep.scene.lines, order: ep.scene.words };
      })()`);
      const marks = s.lines.join('\n').match(/\{[^|}]+\|[^}]+\}/g) || [];
      assert.deepEqual(marks.map(m => m.slice(1, m.indexOf('|'))).sort(), s.ids.slice().sort(), `story ${n}: each word marked once`);
      for (const l of s.lines) {
        assert.doesNotMatch(l, /\{[HFVPW]|\{(이가|은는|을를|와과)\}|undefined|null/, `story ${n}: leftover in "${l}"`);
        assert.doesNotMatch(l, /을\(를\)|이\(가\)|은\(는\)/, `story ${n}: unresolved particle in "${l}"`);
      }
      assert.equal(new Set(s.lines).size, s.lines.length, `story ${n}: repeated line`);
    }
  } finally { p.close(); }
});
