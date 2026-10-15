// 휴대폰 안 이야기 AI(Gemma)와 뜻 그림: 가짜 AI 엔진으로 문장 바꾸기·검사·되돌리기, 그림 꼴 고르기
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./page.cjs');

const ROWS = [['borrow', '빌리다'], ['encourage', '격려하다'], ['anxious', '불안한, 걱정하는'], ['abandon', '버리다, 포기하다'], ['reduce', '줄이다'], ['compare', '비교하다']]
  .map(([en, ko]) => ({ en, ko, pos: 'x' }));
const rowsObj = JSON.stringify(Object.fromEntries(ROWS.map(r => [r.en, r])));

test('AI lines: the meaning is found in the sentence and marked, other sentences are refused', () => {
  const p = bootPage();
  try {
    const m = p.json(`(() => {
      const f = SF[0], rows = ${rowsObj};
      const mark = (id, line) => aiMark(line, id, stLex(id, rows[id], f), rows[id].ko);
      return [
        mark('encourage', '공주는 “넌 할 수 있어!” 하며 레오를 격려했어요.'),
        mark('anxious', '용이 다가오자 공주는 불안한 얼굴로 성문을 바라봤어요.'),
        mark('anxious', '공주는 밤새 걱정했어요.'),
        mark('borrow', '레오는 대장장이에게서 망원경을 빌렸어요.'),
        mark('borrow', '레오는 망원경을 들고 성벽에 올랐어요.'),
        mark('reduce', '레오는 간식을 절반으로 줄였어요.')
      ];
    })()`);
    assert.equal(m[0], '공주는 “넌 할 수 있어!” 하며 레오를 {encourage|격려했어요}.');
    assert.equal(m[1], '용이 다가오자 공주는 {anxious|불안한} 얼굴로 성문을 바라봤어요.');
    assert.equal(m[2], '공주는 밤새 {anxious|걱정했어요}.');
    assert.equal(m[3], '레오는 대장장이에게서 망원경을 {borrow|빌렸어요}.');
    assert.equal(m[4], null, '뜻이 없는 문장은 쓰지 않아요');
    assert.equal(m[5], '레오는 간식을 절반으로 {reduce|줄였어요}.');
    // 답 읽기: 번호 줄만, '[낱말] 인물 → 문장' 꼴도
    assert.deepEqual(p.json(`aiParse('네, 써 볼게요!\\n1. [빌리다] 기사 레오 → 레오는 망원경을 빌렸어요.\\n2) **공주는 레오를 격려했어요.**\\n엉뚱한 줄', 3)`), ['레오는 망원경을 빌렸어요.', '공주는 레오를 격려했어요.', null]);
    // 영어가 섞이거나 너무 짧은 줄은 버려요
    assert.deepEqual(p.json(`['Leo borrowed a telescope.', '좋아요', '레오는 망원경을 빌렸어요.'].map(aiLineOk)`), [false, false, true]);
  } finally { p.close(); }
});

// 요청 글의 '이제 써 줘:' 목록을 읽어서 답하는 가짜 AI. 짝수 번호는 뜻을 빼먹어요(앱 문장이 남아야 해요)
const FAKE = `{ calls: 0, interruptGenerate() {}, chat: { completions: { create: async req => {
  AI.engine.calls++;
  const list = req.messages[0].content.split('이제 써 줘:')[1].trim().split('\\n');
  const out = list.map((l, i) => { const m = l.match(/^(\\d+)\\. \\[([^\\]]+)\\] (.+)$/); return m[1] + '. ' + (i % 2 ? m[3] + '은 하늘을 올려다봤어요.' : m[3] + '은 깜짝 놀라 ' + m[2] + ' 일을 떠올렸어요.'); });
  return { choices: [{ message: { content: out.join('\\n') } }] };
} } } }`;

test('AI story: lines with the meaning replace the app lines, the rest stay; the deck says the AI wrote it', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma3-1b-it-q4f16_1-MLC' });
  try {
    const r = p.json(`(() => {
      const rows = ${rowsObj};
      const res = mkStory(['borrow', 'encourage', 'anxious', 'abandon'], rows, 0);
      return { before: res.lines.slice() };
    })()`);
    p.run(`AI.gpu = true; AI.engine = ${FAKE};`);
    await p.run(`(async () => { const rows = ${rowsObj}; const res = mkStory(['borrow', 'encourage', 'anxious', 'abandon'], rows, 0); window.__n = await aiRewrite(AI.engine, res, rows, 0, null); window.__res = res; })()`);
    const res = p.json('window.__res'), n = p.json('window.__n');
    assert.equal(n, 2, res.lines.join('\n'));
    const wordLines = res.lines.filter(l => /\{[^|}]+\|/.test(l));
    assert.equal(wordLines.length, 4);
    // 바꾼 줄은 AI 문장, 안 바꾼 줄은 앱 문장 그대로
    assert.equal(wordLines.filter(l => /깜짝 놀라/.test(l)).length, 2);
    for (const l of wordLines.filter(l => !/깜짝 놀라/.test(l))) assert.ok(r.before.includes(l), l);
    // 단어 줄마다 단어 표시는 하나
    for (const l of wordLines) assert.equal((l.match(/\{[^|}]+\|/g) || []).length, 1);

    // 단어장 만들기 전체: AI 준비 → 에피소드마다 AI → 저장 안내
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; AI.engine.calls = 0;`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, err: MK.err, note: MK.saveNote, calls: AI.engine.calls, scenes: MK.deck.scenes.length, log: MK.log.map(l => l.text) })');
    assert.equal(made.step, 'done', made.err);
    assert.equal(made.calls, made.scenes);
    assert.match(made.note, /AI\(Gemma\)가 썼어요/);
    assert.ok(made.log.some(t => /이야기 AI 준비 완료/.test(t)), made.log.join('\n'));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI story: a phone that cannot run the AI still gets a deck, and is told why', async () => {
  const p = bootPage();
  try {
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, note: MK.saveNote })');
    assert.equal(made.step, 'done');
    assert.match(made.note, /이야기 AI를 돌릴 수 없어서/);
  } finally { p.close(); }
});

test('meaning pictures: the layout follows the meaning, the doer is the story character, no English on the picture', () => {
  const p = bootPage();
  try {
    const pics = p.json(`(() => {
      const rows = ${rowsObj};
      const st = mkStory(Object.keys(rows), rows, 0);
      return Object.fromEntries(Object.entries(st.words).map(([k, w]) => { const n = genNormalize(w.panel); return [k, { layout: n.layout || 'one', dir: n.dir, sign: n.sign, rel: n.rel }]; }));
    })()`);
    assert.equal(pics.borrow.layout, 'act'); assert.equal(pics.borrow.dir, 'ba');
    assert.equal(pics.encourage.layout, 'act'); assert.equal(pics.encourage.dir, 'ab');
    assert.equal(pics.anxious.layout, 'feel');
    assert.equal(pics.abandon.layout, 'no');
    assert.equal(pics.reduce.layout, 'change');
    assert.equal(pics.compare.layout, 'compare'); assert.equal(pics.compare.rel, 'VS');
    for (const [k, v] of Object.entries(pics)) assert.ok(!v.sign || !v.sign.includes(k), k);
    // 그 줄을 하는 인물(주인공·친구·말썽꾼)이 그림에 나와요: 기사 이야기의 말썽꾼은 용
    const v = p.json(`(() => { const f = SF[0]; const w = stLex('steal', { ko: '훔치다' }, f); return genNormalize(stPanel(w, { ko: '훔치다' }, f, 0, 'V', {})); })()`);
    assert.equal(v.layout, 'act'); assert.equal(v.a.kind, 'dragon'); assert.equal(v.dir, 'ba');
  } finally { p.close(); }
});
