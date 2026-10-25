// 실행: npm test  (먼저 npm install로 jsdom을 받아요)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { build, out, seal, unseal, sumOf, sum } = require('../build.cjs');
const { bootPage, FAKE_AI } = require('./page.cjs');

const STORE_KEY = 'day02-voca-mission-v1';
// 일반 사전 뜻으로 만든 연습용 단어 목록 (교재 내용 아님)
const ROWS = [
  ['plaster', '반창고', 'n'], ['fence', '울타리, 담장', 'n'], ['parcel', '소포, 꾸러미', 'n'], ['tie', '묶다, 매다', 'v'],
  ['explain', '설명하다', 'v'], ['ancient', '고대의', 'a'], ['quickly', '빠르게', 'd'], ['brave', '용감한', 'a'],
  ['decide', '결정하다', 'v'], ['carefully', '조심스럽게', 'd'], ['harvest', '수확', 'n'], ['shiver', '떨다', 'v']
].map(([en, ko, pos]) => ({ en, ko, pos }));

test('word-game/index.html is the locked build of app/src (run: SITE_KEY=… npm run build)', () => {
  const page = fs.readFileSync(out, 'utf8');
  assert.equal(sumOf(page), sum(build()), 'word-game/index.html differs from app/src — run: SITE_KEY=<링크의 # 뒤 열쇠> npm run build');
  // 사이트에 올라가는 파일에는 게임 코드가 그대로 들어 있지 않고, 검색에도 나오지 않게
  assert.ok(!page.includes('function mkRead') && !page.includes('ocrEchoHeads'));
  assert.match(page, /<meta name="robots" content="noindex/);
});

test('locked page opens only with its key', () => {
  const crypto = require('node:crypto');
  const html = build(), key = crypto.randomBytes(32), page = seal(html, key);
  assert.equal(unseal(page, key), html.replace('/*@@DECKS@@*/[]', '[]'));
  assert.throws(() => unseal(page, crypto.randomBytes(32)));
  // 같은 게임·같은 열쇠면 같은 파일 (다시 만들어도 바뀌지 않음), 열쇠가 다르면 다른 파일
  assert.equal(seal(html, key), page);
  assert.notEqual(seal(html, crypto.randomBytes(32)), page);
  assert.ok(!page.includes(key.toString('base64url')));
});

test('private decks go only into the locked game and into the deck archive', () => {
  const crypto = require('node:crypto');
  const { lockDecks, openDecks } = require('../build.cjs');
  // 일반 낱말로 만든 연습용 단어장 (교재 내용 아님)
  const deck = { v: 1, id: 'p-test', name: '연습 이야기', created: 1, updated: 100, source: 'text',
    words: { borrow: { m: '빌리다', ans: [{ t: '빌리다', ok: ['빌리다'] }], pos: 'v' }, explain: { m: '설명하다', ans: [{ t: '설명하다', ok: ['설명하다'] }], pos: 'v' } },
    scenes: [{ key: 'p-test-e1', title: '도서관 모험', words: ['borrow', 'explain'], lines: ['책을 {borrow|빌렸어요} </script>', '규칙을 {explain|설명했어요}'] }], panels: {} };
  const key = crypto.randomBytes(32), box = lockDecks([deck], key);
  assert.ok(!box.includes('borrow') && !box.includes('도서관'));
  assert.deepEqual(openDecks(box, key), [deck]);
  const game = unseal(seal(build(), key, [deck], 'x'), key);
  assert.ok(game.includes('"p-test"') && !game.includes('</script>",'), '단어장 글 속 </script>는 풀어 쓰지 않음');
  // 앱: 보관함에 없으면 넣고, 지운 뒤에는 같은 판을 다시 넣지 않고, 사용자가 고친 더 새 판은 그대로
  const p = bootPage();
  try {
    const seed = d => p.json(`DeckStore.seed(${JSON.stringify(d)})`);
    assert.equal(seed(deck), true);
    assert.equal(p.json(`DeckStore.get('p-test').name`), '연습 이야기');
    assert.equal(seed(deck), false);
    p.run(`DeckStore.del('p-test')`);
    assert.equal(seed(deck), false);
    assert.equal(seed(Object.assign({}, deck, { updated: Date.now() + 1000 })), true);
    p.run(`DeckStore.put(Object.assign({}, DeckStore.get('p-test'), { name: '내가 고친 이름' }))`);
    assert.equal(seed(Object.assign({}, deck, { updated: 200 })), false);
    assert.equal(p.json(`DeckStore.get('p-test').name`), '내가 고친 이름');
  } finally { p.close(); }
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

test('speech: dictionary marks are read as words, and Korean is never read by the robotic fallback', async () => {
  const p = bootPage();
  try {
    const ko = p.json(`['~을 설명하다, ~의 비율을 차지하다', '~에 도움이 되다', '~가 되다', '~할 수 있다', '(값을) 지불하다', '사과/배'].map(sayKo)`);
    assert.deepEqual(ko, ['무엇을 설명하다, 무엇의 비율을 차지하다', '무엇에 도움이 되다', '무엇이 되다', '할 수 있다', '값을 지불하다', '사과, 배']);
    const en = p.json(`['give sth to sb', 'be capable of ~', '(be) aware of', 'look up/down'].map(sayEn)`);
    assert.deepEqual(en, ['give something to somebody', 'be capable of', 'be aware of', 'look up, down']);
    // 이 화면에는 음성 기능이 없어요: 한국어는 자막으로 넘어가라는 신호만, eSpeak는 부르지 않아요
    const r = await p.run(`(async () => { let esp = 0; const f = Esp.speak; Esp.speak = () => { esp++; return Promise.resolve(); };
      try { await tts('기사가 길을 설명했어요.', 'ko-KR', 1); return 'spoke'; } catch (e) { return (e && e.name) + ':' + esp; } finally { Esp.speak = f; } })()`);
    assert.equal(r, 'NoKoVoice:0');
    // 가운뎃점은 짧게 쉬어 읽기
    assert.equal(p.json(`sayKo('(계획·행사를) 취소하다')`), '계획, 행사를 취소하다');
    // 목소리 고르기: 인터넷으로 받는 목소리보다 기기 안 목소리, 설정에서 고른 목소리가 있으면 그것
    p.run(`ssVoices = [{ name: 'Google 한국의', lang: 'ko-KR', localService: false, voiceURI: 'net-ko' }, { name: 'Yuna', lang: 'ko-KR', localService: true, voiceURI: 'local-ko' }, { name: 'Samantha', lang: 'en-US', localService: true, voiceURI: 'local-en' }]`);
    assert.equal(p.json(`bestVoice('ko-KR').voiceURI`), 'local-ko');
    p.run(`SAVE.koVoice = 'net-ko'`);
    assert.equal(p.json(`bestVoice('ko-KR').voiceURI`), 'net-ko');
    const pick = p.json(`voicePickHTML()`);
    assert.match(pick, /<option value="net-ko" selected>Google 한국의 · 인터넷<\/option>/);
    assert.match(pick, /data-voice="en"/);
    p.run(`SAVE.koVoice = 'gone'; ssVoices = []`);
    assert.equal(p.json(`voicePickHTML()`), '');
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
    p.run(`AI.gpu = true; AI.engine = ${FAKE_AI};`); // 이 기기의 이야기 AI가 써요 (가짜 AI)
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
    const rows = p.json(`ocrPairs(${JSON.stringify(words)}, new Map(${JSON.stringify(dict)})).map(l => l.replace(OCR_SPACED, ''))`);
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
    assert.deepEqual(p.json(`ocrPairs(${JSON.stringify(words)}, new Map(${dict})).map(l => l.replace(OCR_SPACED, ''))`),
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

test('OCR app screenshots: gray meanings keep their spacing, marks and leading parts', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = ""; OCR.low = new Set();');
    // 회색 뜻은 글자마다 떼어 읽혀요: 글자 사이 틈(글자 높이 40에 대한 비율)과 낱말 목록으로 띄어쓰기를 되살림
    const row = toks => { let x = 400; return toks.map(([t, g]) => { x += Math.round((g || 0) * 40); const w = { t, x0: x, y0: 100, x1: x + 30 * Math.max(1, (t.match(/[가-힣]/g) || []).length) * (/^[~(),·\-]$/.test(t) ? 0.4 : 1), y1: 140, c: 93 }; x = w.x1; return w; }); };
    const sp = toks => p.json(`koSpace(${JSON.stringify(row(toks))}, window.__L, 40, 30)`);
    assert.equal(sp([['빌'], ['리', 0.45], ['다,', 0.35], ['꾸', 0.6], ['다', 0.3]]), '빌리다, 꾸다');
    assert.equal(sp([['범'], ['위', 0.5], ['를', 0.5], ['좁', 0.8], ['히', 0.47], ['다', 0.45]]), '범위를 좁히다');
    assert.equal(sp([['~'], ['을', 0.1], ['기', 0.68], ['대', 0.4], ['하', 0.45], ['다', 0.28]]), '~을 기대하다');
    assert.equal(sp([['~'], ['에', 0.1], ['더하여,', 0.43], ['~', 0.34], ['외에도', 0.34]]), '~에 더하여, ~ 외에도');
    assert.equal(sp([['반'], ['드', 0.3], ['시', 0.3], ['~', 0.7], ['하다', 0.35]]), '반드시 ~하다');
    assert.equal(sp([['한'], ['쌍', 0.71], ['의,', 0.3], ['몇', 0.6], ['개', 0.72], ['의', 0.3]]), '한 쌍의, 몇 개의');
    // '·'를 '-'로 읽음, 이름씨 뒤 '하다'는 틈이 넓어도 붙임, 괄호 안에서 붙어 있던 두 낱말은 가운뎃점으로
    assert.equal(sp([['('], ['계', 0.1], ['획', 0.2], ['-', 0.1], ['행', 0.1], ['사', 0.43], ['를', 0.29], [')', 0.1], ['취', 0.77], ['소', 0.49], ['하다', 0.43]]), '(계획·행사를) 취소하다');
    assert.equal(sp([['신'], ['청', 0.37], ['하다', 0.97]]), '신청하다');
    assert.equal(sp([['('], ['생', 0.1], ['각', 0.23], ['해', 0.09], ['답', 0.37], ['을)', 0.29]]), '(생각·해답을)');
    // 영어·한국어 읽기 합치기: 영어 낱말 뒤 '-ing'는 영어로, 또렷한 한글 '하'·'다'는 흐린 영어('stet')로 바꾸지 않음,
    // 한국어 읽기가 기호만 낸 자리의 흐린 영어 사전 낱말은 살림 ('a great deal')
    const W = (t, x, y, c = 95, w = t.length * 20, h = 40) => ({ t, x0: x, y0: y, x1: x + w, y1: y + h, c });
    const dict = JSON.stringify(['stop', 'stet', 'a', 'great', 'deal', 'of', 'call', 'off', 'carry', 'on', 'in', 'charge', 'misunderstanding', 'ad', 'want', 'as', 'matter', 'fact'].map(w => [w, 1]));
    const merged = p.json(`ocrMerge(${JSON.stringify([W('5601', 95, 100, 51), W('-119', 196, 96, 36), W('하', 392, 100, 93, 30), W('다', 430, 100, 97, 30)])},
      ${JSON.stringify([W('stop', 95, 100, 93), W('-ing', 196, 96, 92), W('Stet', 392, 100, 56)])}, new Map(${dict})).map(w => w.t).sort()`);
    assert.deepEqual(merged, ['-ing', 'stop', '다', '하'].sort());
    const faint = p.json(`ocrMerge(${JSON.stringify([W('39169', 94, 300, 0, 236)])}, ${JSON.stringify([W('a', 94, 308, 13, 23, 26), W('great', 129, 303, 13), W('deal', 245, 300, 47)])}, new Map(${dict})).map(w => w.t)`);
    assert.deepEqual(faint, ['a', 'great', 'deal']);
    // 짝지은 줄 다듬기: 가운뎃점·괄호 짝, 쉼표를 못 읽은 두 번째 '~' 뜻, 'ㅐ'를 'ㅏ'로 읽은 두 글자 뜻, 두 글자 영어 'ad', '-ing'와 '-하는'
    const chk = (en, ko) => p.json(`(() => { const r = ocrCheckRow({ en: ${JSON.stringify(en)}, ko: ${JSON.stringify(ko)} }, new Map(${dict}), window.__L); return r && [r.ko, r.flag]; })()`);
    assert.deepEqual(chk('call off', '(계획-행사를) 취소하다'), ['(계획·행사를) 취소하다', '']);
    assert.deepEqual(chk('call off', '계획·행사를) 취소하다'), ['(계획·행사를) 취소하다', '']);
    assert.deepEqual(chk('call off', '(일정을 미루다'), ['(일정을) 미루다', '']);
    assert.deepEqual(chk('carry on', '일ㆍ대화를 계속하다'), ['(일·대화를) 계속하다', '']);
    assert.deepEqual(chk('in charge of', '~을 맡고 있는 ~을 책임지는'), ['~을 맡고 있는, ~을 책임지는', '']);
    assert.deepEqual(chk('misunderstanding', '오하, 착각'), ['오해, 착각', '']);
    assert.deepEqual(chk('ad', '광고'), ['광고', '']);
    assert.deepEqual(chk('stop -ing', '-하는 것을 멈추다'), ['-하는 것을 멈추다', '']);
    // 낱말이 아닌 덩어리: 두 글자 이하는 빼고, 세 글자 이상은 남겨서 고쳐 달라고 표시 (흐린 뜻이 통째로 빠지지 않게)
    assert.deepEqual(chk('want ad', '구인 광고, 쬬잡'), ['구인 광고', 'drop']);
    assert.deepEqual(chk('want ad', '구인 광고, 떡볶쬬잡'), ['구인 광고, 떡볶쬬잡', 'ko']);
    // 다섯 낱말 숙어는 단어 줄, 문장은 아님. 뜻 맨 앞 '-하는'의 '-'는 남김
    assert.deepEqual(p.json(`[ocrRowOk({ en: 'as a matter of fact', ko: '사실은' }), ocrRowOk({ en: 'The rain fell on the roof.', ko: '비가 왔다' })]`), [true, false]);
    assert.equal(p.json(`mkCleanKo('-하는 것을 멈추다')`), '-하는 것을 멈추다');
    assert.equal(p.json(`mkCleanKo('- 취소하다')`), '취소하다');
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
    // '명사 + 이다'는 그대로 (비슷한 모양의 다른 낱말로 바꾸지 않음), '명사 + 이·가' 뒤의 '되다'는 띄어 쓴 그대로
    assert.deepEqual(mean('필수적이다'), ['필수적이다']);
    assert.deepEqual(mean('~에 도움이 되다'), ['~에 도움이 되다']);
    // 사진 방향 고르기: 옆으로 누운 글줄을 잘못 읽은 세 글자 낱말('for', 'off')은 세지 않음
    const page = ws => ({ blocks: [{ paragraphs: [{ lines: [{ words: ws.map((t, i) => ({ text: t, confidence: 90, bbox: { x0: i * 50, y0: 0, x1: i * 50 + 40, y1: 20 } })) }] }] }] });
    const dhits = ws => p.json(`ocrDictHits(${JSON.stringify(page(ws))}, new Map(${JSON.stringify(['for', 'off', 'jot', 'roe', 'river', 'borrow', 'ancient'].map(w => [w, 1]))}))`);
    assert.equal(dhits(['for', 'off', 'jot', 'roe']), 0);
    assert.equal(dhits(['river', 'borrow', 'ancient', 'for']), 3);
    // 여러 번 읽은 뜻 다듬기: 같은 줄의 비슷한 꼴 두 뜻은 따로 두고, 비슷한 꼴 가운데 낱말 목록에 그대로 있는 꼴을 먼저
    assert.deepEqual(p.json(`(() => { const b = { ms: ['가다', '나다'], conf: 0.9 }; return ocrAgree(b, [b, { ms: ['가다', '나다'], conf: 0.8 }], window.__L); })()`), ['가다', '나다']);
    assert.deepEqual(p.json(`(() => { const b = { ms: ['공무하다'], conf: 0.9 }; return ocrAgree(b, [b, { ms: ['공무하다'], conf: 0.8 }, { ms: ['공부하다'], conf: 0.85 }], window.__L); })()`), ['공부하다']);
  } finally { p.close(); }
});

test('OCR fixes for common photo problems: lost bold words, first syllables, dashes, icons, extra rows', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = ""; OCR.low = new Set();');
    const W = (t, x, y, c = 95, w = t.length * 20, h = 40) => ({ t, x0: x, y0: y, x1: x + w, y1: y + h, c });
    const D = ws => `new Map(${JSON.stringify(ws.map(w => [w, 1]))})`;
    const pairs = (words, dict) => p.json(`ocrPairs(${JSON.stringify(words)}, ${D(dict)}, 0, window.__L).map(l => l.replace(OCR_SPACED, ''))`);
    // 다크 모드 채팅 화면: 굵은 흰 영어를 영어 읽기는 맞게 읽고 신뢰도 0, 한국어 읽기는 숫자·기호 섞인 조각 → 영어 단어로
    const A = [W('2.', 60, 100, 91, 40), W('삐타900', 160, 100, 21, 190), W('합병', 450, 100, 92, 90)];
    const E = [W('2', 60, 100, 97, 30), W('Merger', 160, 100, 0, 190), W('Et4', 450, 100, 0, 90)];
    assert.deepEqual(p.json(`ocrMerge(${JSON.stringify(A)}, ${JSON.stringify(E)}, ${D(['merger'])}).map(w => w.t).sort()`), ['2.', 'Merger', '합병'].sort());
    // 그 자리에 또렷한 한글 낱말이 있으면 신뢰도 0인 영어로 바꾸지 않음
    assert.deepEqual(p.json(`ocrMerge(${JSON.stringify([W('정원', 160, 100, 93, 90), W('가꾸다', 300, 100, 93)])}, ${JSON.stringify([W('Pass', 160, 100, 0, 90)])}, ${D(['pass'])}).map(w => w.t)`), ['정원', '가꾸다']);
    // 낱말 첫 글자가 따로 읽힌 '부 / 정직한'은 남기고(반대 뜻이 되지 않게), 품사 표시 '명'은 뺌.
    // 띄어 쓴 줄표는 구분 기호(뜻에 넣지 않음), 뒤 글자에 붙은 '-하는'의 '-'는 뜻의 일부
    const rows = [W('dishonest', 100, 100), W('부', 400, 100, 90, 30), W('정직한,', 434, 100, 95, 120), W('거짓된', 574, 100),
      W('garden', 100, 200), W('명', 400, 200, 90, 30), W('정원', 452, 200),
      W('rebuild', 100, 300), W('-', 300, 300, 80, 14), W('다시', 334, 300), W('짓다', 400, 300),
      W('avoid', 100, 400), W('-', 300, 400, 80, 14), W('하는', 316, 400), W('것을', 380, 400), W('피하다', 444, 400)];
    assert.deepEqual(pairs(rows, ['dishonest', 'garden', 'rebuild', 'avoid']), ['dishonest - 부정직한, 거짓된', 'garden - 정원', 'rebuild - 다시 짓다', 'avoid - -하는 것을 피하다']);
    // 영어를 못 읽은 번호 줄의 뜻은 윗줄 뜻에 붙이지 않음, 단어 옆 아이콘(한 글자 '때')보다 아래 줄 뜻, 단어 오른쪽 품사 칸('noun')은 단어가 아님
    const more = [W('12.', 40, 100, 93, 50), W('clause', 160, 100), W('조항', 450, 100), W('13.', 40, 160, 93, 50), W('시행하다', 450, 160),
      W('giant', 160, 300), W('때', 900, 300, 60, 30), W('거인', 160, 350), W('river', 160, 450), W('noun', 420, 450), W('강', 600, 450, 95, 30)];
    assert.deepEqual(pairs(more, ['clause', 'giant', 'river', 'noun']), ['clause - 조항', 'giant - 거인', 'river - 강']);
    // 단어 칸과 줄이 맞지 않는 맨 위 머리말 줄(제목 상자)은 단어 줄이 아님
    const list = ['brave', 'animal', 'east', 'clear', 'kitchen', 'awful'].map((t, i) => [W(t, 100, 300 + i * 60), W(['용감한', '동물', '동쪽', '명확한', '부엌', '형편없는'][i], 400, 300 + i * 60)]).flat();
    assert.deepEqual(pairs([W('day', 700, 100), W('이름', 900, 100), ...list], ['brave', 'animal', 'east', 'clear', 'kitchen', 'awful', 'day']).map(l => l.split(' - ')[0]), ['brave', 'animal', 'east', 'clear', 'kitchen', 'awful']);
    // 밑줄·점·낱자모 조각 지우기 ('~'는 남김), 이음 어미가 붙은 말('먹지', '가며')은 낱말로 봄
    assert.deepEqual(p.json(`['친절한 ㅇ', '용감한._', '(외국 여행용) 여권 _ㅎ', '많은 ~', '짐을 싸다_'].map(ocrKo)`), ['친절한', '용감한', '(외국 여행용) 여권', '많은 ~', '짐을 싸다']);
    assert.deepEqual(p.json(`['먹지', '가며', '갈지'].map(w => koWordOk(w, window.__L))`), [true, true, true]);
    assert.deepEqual(p.json(`(() => { const r = ocrCheckRow({ en: 'skip', ko: '먹지 않다' }, ${D(['skip'])}, window.__L); return [r.ko, r.flag]; })()`), ['먹지 않다', '']);
    // 제목 줄('Review Test')의 큰 낱말은 사전식 쪽의 표제어가 아님
    const T = (t, x, y, h) => ({ t, x0: x, y0: y, x1: x + Math.round(t.length * h * 0.6), y1: y + h, c: 95 });
    const page = [T('Review', 100, 50, 46), T('Test', 300, 52, 42), ...['rough', 'journey', 'chase', 'riddle', 'strict', 'measure'].map((t, i) => T(t, 100, 200 + i * 60, 29))];
    assert.deepEqual(p.json(`ocrHeadwords(${JSON.stringify(page)}, ${D(['review', 'test', 'rough', 'journey', 'chase', 'riddle', 'strict', 'measure'])}, 1000).map(h => h.t)`), []);
  } finally { p.close(); }
});

test('OCR chat lists: middle-dot pairs, meanings wrapped to the next line, glued numbers, wide boxes, labels', () => {
  const p = bootPage();
  try {
    p.window.__lex = fs.readFileSync(require('node:path').join(__dirname, '../../word-game/ocr/ko-lex.txt'), 'utf8');
    p.run('window.__L = new Set(window.__lex.split("\\n").filter(Boolean)); window.__lex = ""; OCR.low = new Set();');
    const W = (t, x, y, c = 95, w = t.length * 20, h = 40) => ({ t, x0: x, y0: y, x1: x + w, y1: y + h, c });
    const dot = (x, y) => W('ㆍ', x, y + 15, 90, 8, 10);
    const D = ws => `new Map(${JSON.stringify(ws.map(w => [w, 1]))})`;
    const pairs = (words, dict) => p.json(`ocrPairs(${JSON.stringify(words)}, ${D(dict)}, 0, window.__L).map(l => l.replace(OCR_SPACED, ''))`);
    // 'blanket 담요 · ladder 사다리 · kettle / 주전자 · drawer 서랍 · harvest 수확, / 추수 · valley 골짜기':
    // 줄 끝 단어의 뜻은 다음 줄 맨 앞, 쉼표로 끝난 뜻은 다음 줄 맨 앞에서 이어지고, 가운뎃점은 뜻에 넣지 않고, 순서는 줄마다 왼쪽부터
    const inline = [W('blanket', 100, 100), W('담요', 260, 100), dot(320, 100), W('ladder', 340, 100), W('사다리', 480, 100), dot(550, 100), W('kettle', 570, 100),
      W('주전자', 100, 170), dot(180, 170), W('drawer', 200, 170), W('서랍', 340, 170), dot(400, 170), W('harvest', 420, 170), W('수확,', 580, 170),
      W('추수', 100, 240), dot(180, 240), W('valley', 200, 240), W('골짜기', 340, 240)];
    assert.deepEqual(pairs(inline, ['blanket', 'ladder', 'kettle', 'drawer', 'harvest', 'valley']),
      ['blanket - 담요', 'ladder - 사다리', 'kettle - 주전자', 'drawer - 서랍', 'harvest - 수확, 추수', 'valley - 골짜기']);
    // 두 칸 낱말 카드('valley [아이콘]   tremble [아이콘]' / 아랫줄 뜻)는 이어 쓴 목록이 아님: 아랫줄 맨 앞 뜻을 오른쪽 칸 단어가 가져가지 않음
    const grid = [W('valley', 80, 380), W('삐', 500, 380, 9, 20), W(')', 524, 380, 88, 15), W('tremble', 660, 380), W('빼', 1076, 380, 9, 39), W(')', 1101, 380, 63, 19),
      W('계곡,', 80, 460), W('골짜기', 190, 460), W('떨다', 660, 460)];
    assert.deepEqual(pairs(grid, ['valley', 'tremble']).sort(), ['tremble - 떨다', 'valley - 계곡, 골짜기']);
    // 단어와 뜻 사이에 소수가 있는 줄('Lite 3.5 빠름')은 화면의 이름표: 단어 줄이 아님
    assert.deepEqual(pairs([W('Lite', 100, 100), W('3.5', 200, 100), W('빠름', 280, 100), W('garden', 100, 200), W('정원', 300, 200)], ['lite', 'garden']), ['garden - 정원']);
    // 영어 읽기가 번호·줄표를 붙여 읽은 단어('5.garden', 'O.kettle-')와, 줄표 너머 뜻까지 넓게 잡힌 단어 상자도 단어로
    const A = [W('5.', 40, 100, 96, 40), W('85016', 100, 100, 0, 200), W('정원', 340, 100), W('9.', 40, 200, 95, 40), W('6916', 100, 200, 65, 90), W('주전자', 260, 200),
      W('1.', 40, 300, 92, 40), W('010101810', 100, 300, 48, 220), W('담요', 300, 300, 96, 88)];
    const E = [W('5.garden', 40, 100, 81, 260), W('O.kettle-', 40, 200, 78, 190), W('blanket', 100, 300, 73, 236)];
    assert.deepEqual(p.json(`ocrMerge(${JSON.stringify(A)}, ${JSON.stringify(E)}, ${D(['garden', 'kettle', 'blanket'])}).map(w => w.t).sort()`),
      ['1.', '5.', '9.', 'blanket', 'garden', 'kettle', '담요', '정원', '주전자'].sort());
    // 이어 쓴 목록에서 신뢰도 0으로 읽힌 굵은 단어: 바로 왼쪽이 가운뎃점이면 쌍의 시작 ('골짜기 · meadow 풀밭')
    const A2 = [W('골짜기,', 60, 100, 95), W('ㆍ', 220, 115, 85, 4, 10), W('ㅋ', 236, 100, 55, 12), W('006800', 250, 100, 23, 120), W('풀밭', 400, 100, 89)];
    assert.ok(p.json(`ocrMerge(${JSON.stringify(A2)}, ${JSON.stringify([W('meadow', 250, 100, 0, 120)])}, ${D(['meadow'])}).map(w => w.t)`).includes('meadow'));
    // 쌍 사이 가운뎃점·잡티는 뜻에서 지움, 괄호 바로 뒤 조사 다음은 띄어쓰기 ('일정(을 잡다)')
    assert.deepEqual(p.json(`['장소ㆍ', '안건 ㆍ', '목적지 ㆍ ＊'].map(ocrKo)`), ['장소', '안건', '목적지']);
    assert.deepEqual(pairs([W('schedule', 100, 100), W('일정', 300, 100), W('(을', 345, 100, 86, 60), W('잡다)', 410, 100, 90, 100)], ['schedule']), ['schedule - 일정 (을 잡다)']);
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

test('new version bar: an old page open on the phone sees the new build and reloads on tap', async () => {
  const p = bootPage();
  try {
    p.window.WG_BUILD = 'aaaaaaaaaaaa';
    let asked = '';
    p.window.fetch = async (u, o) => { asked = String(u) + ' ' + JSON.stringify(o); return { text: async () => 'const SITE = {"v":1,"sum":"bbbbbbbbbbbbcccc","decks":""}' }; };
    assert.equal(await p.run('checkNewBuild(true)'), true);
    assert.match(asked, /no-store/);
    const bar = p.document.getElementById('newbuild');
    assert.match(bar.textContent, /새 판이 나왔어요/);
    // 같은 판이면 띠가 없어요
    bar.remove();
    p.window.WG_BUILD = 'bbbbbbbbbbbb';
    assert.equal(await p.run('checkNewBuild(true)'), false);
    assert.equal(p.document.getElementById('newbuild'), null);
    assert.equal(p.run('buildLabel()'), '판 bbbbbbb');
  } finally { p.close(); }
});
