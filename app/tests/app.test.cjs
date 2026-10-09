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
