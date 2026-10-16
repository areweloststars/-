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
    // 답 읽기: 번호마다 후보 목록. 번호 꼴이 여러 가지여도 ('**1.**', '①', '1번.', '(1)', 한 줄에 여러 번호)
    const parsed = p.json(`[
      aiParse('네, 써 볼게요!\\n1. [빌리다] 기사 레오 → 레오는 망원경을 빌렸어요.\\n2) **공주는 레오를 격려했어요.**\\n엉뚱한 줄', 3),
      aiParse('**1.** 레오는 망원경을 빌렸어요.\\n② 공주는 레오를 격려했어요.', 2),
      aiParse('1번. 레오는 망원경을 빌렸어요.\\n(2) 공주는 레오를 격려했어요.', 2),
      aiParse('1. 레오는 망원경을 빌렸어요. 2. 공주는 레오를 격려했어요.', 2)
    ]`);
    for (const x of parsed.slice(1)) assert.deepEqual(x, [['레오는 망원경을 빌렸어요.'], ['공주는 레오를 격려했어요.']]);
    assert.deepEqual(parsed[0], [['레오는 망원경을 빌렸어요.'], ['공주는 레오를 격려했어요.'], []]);
    // 영어·한자가 섞이거나, 너무 짧거나, 같은 말을 되풀이하거나, 끝맺지 않은 줄은 버려요
    assert.deepEqual(p.json(`['Leo borrowed a telescope.', '좋아요', '레오는 망원경을 빌렸어요.', '레오는 대장장이에게서 望遠鏡을 빌렸어요.', '레오는 망원경을 빌렸어요. 레오는 망원경을 빌렸어요.', '공주는 레오를 격려하며'].map(aiLineOk)`), [false, false, true, false, false, false]);
    // 다듬기: 대사 따옴표는 그대로, '[뜻] 인물:' 꼬리표와 끝의 (설명)은 떼요
    assert.deepEqual(p.json(`['“넌 할 수 있어!” 공주는 레오를 격려했어요.', '[빌리다] 기사 레오: 레오는 망원경을 빌렸어요.', '레오는 망원경을 빌렸어요. (빌리다 → 빌렸어요)', '“레오는 망원경을 빌렸어요.”'].map(aiClean)`),
      ['“넌 할 수 있어!” 공주는 레오를 격려했어요.', '레오는 망원경을 빌렸어요.', '레오는 망원경을 빌렸어요.', '레오는 망원경을 빌렸어요.']);
    // 짧은 열쇠가 다른 낱말에 걸리지 않고, 불규칙·한 글자 줄기·빈자리 뜻·이름씨·둘째 뜻도 찾아요
    const more = p.json(`(() => {
      const f = SF[0];
      const mk = (id, ko, line) => aiMark(line, id, stLex(id, { ko }, f), ko);
      return [
        mk('reduce', '줄이다', '줄이 끊어지자 레오는 간식을 줄였어요.'),
        mk('hope', '바라다', '레오는 하늘을 바라보며 평화를 바랐어요.'),
        mk('sleep', '자다', '용은 자기 동굴에서 쿨쿨 잤어요.'),
        mk('go', '가다', '레오는 칼을 가지고 성으로 갔어요.'),
        mk('help', '돕다', '레오는 공주를 도와주었어요.'),
        mk('scary', '무서운', '공주는 용이 무서워서 숨었어요.'),
        mk('lookforward', '~을 고대하다', '공주는 축제를 고대하며 잠들었어요.'),
        mk('survey', '설문 조사', '공주는 마을에서 설문조사를 했어요.'),
        mk('support', '지원하다, 돕다', '레오는 공주를 도왔어요.'),
        mk('helpful', '도움이 되다', '레오는 도움이 필요했어요.'),
        mk('anxious', '불안한', '성벽이 불안정해서 흔들렸어요.')
      ];
    })()`);
    assert.deepEqual(more, [
      '줄이 끊어지자 레오는 간식을 {reduce|줄였어요}.',
      '레오는 하늘을 바라보며 평화를 {hope|바랐어요}.',
      '용은 자기 동굴에서 쿨쿨 {sleep|잤어요}.',
      '레오는 칼을 가지고 성으로 {go|갔어요}.',
      '레오는 공주를 {help|도와주었어요}.',
      '공주는 용이 {scary|무서워서} 숨었어요.',
      '공주는 축제를 {lookforward|고대하며} 잠들었어요.',
      '공주는 마을에서 {survey|설문조사}를 했어요.',
      '레오는 공주를 {support|도왔어요}.',
      null,
      null
    ]);
  } finally { p.close(); }
});

// 요청 글의 번호 줄('N. [뜻] 앱 문장')을 읽어서 답하는 가짜 AI. 홀수 번째는 뜻을 넣어 고쳐 쓰고, 짝수 번째는 앱 문장을 그대로 베껴요(고친 게 아니니 앱 문장이 남아요)
const FAKE = `{ calls: 0, prompts: [], interruptGenerate() {}, chat: { completions: { create: async req => {
  AI.engine.calls++; AI.engine.prompts.push(req.messages[0].content);
  const list = req.messages[0].content.split('\\n').map(l => l.match(/^(\\d+)\\. \\[([^\\]]+)\\] (.+)$/)).filter(Boolean);
  const out = list.map((m, i) => m[1] + '. ' + (i % 2 ? m[3] : '그러자 모두가 깜짝 놀라 ' + m[2].replace(/^~\\S*\\s/, '') + ' 일을 떠올렸어요.'));
  return { choices: [{ message: { content: '**좋아요!**\\n' + out.join('\\n') } }] };
} } } }`;

test('AI story: lines with the meaning replace the app lines, copied lines stay; the deck says the AI wrote it', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma3-1b-it-q4f16_1-MLC' });
  try {
    const r = p.json(`(() => {
      const rows = ${rowsObj};
      const res = mkStory(['borrow', 'encourage', 'anxious', 'abandon'], rows, 0);
      return { before: res.lines.slice() };
    })()`);
    p.run(`AI.gpu = true; AI.engine = ${FAKE};`);
    await p.run(`(async () => { const rows = ${rowsObj}; const res = mkStory(['borrow', 'encourage', 'anxious', 'abandon'], rows, 0); window.__n = await aiRewrite(AI.engine, res, rows, 0, null); window.__res = res; })()`);
    const res = p.json('window.__res'), n = p.json('window.__n'), prompt = p.json('AI.engine.prompts[0]');
    assert.equal(n, 2, res.lines.join('\n'));
    // 요청 글에는 앱 이야기 전체(앞부분·다짐·끝맺음)가 들어가고, 단어 줄에만 번호
    for (const l of r.before) assert.ok(prompt.includes(l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1')), l);
    assert.equal((prompt.match(/^\d+\. \[/gm) || []).length, 4);
    const wordLines = res.lines.filter(l => /\{[^|}]+\|/.test(l));
    assert.equal(wordLines.length, 4);
    assert.equal(wordLines.filter(l => /깜짝 놀라/.test(l)).length, 2);
    for (const l of wordLines.filter(l => !/깜짝 놀라/.test(l))) assert.ok(r.before.includes(l), l);
    for (const l of wordLines) assert.equal((l.match(/\{[^|}]+\|/g) || []).length, 1);

    // 단어장 만들기 전체: AI 준비 → 에피소드마다 AI → 저장 안내
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; AI.engine.calls = 0;`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, err: MK.err, note: MK.aiNote, calls: AI.engine.calls, scenes: MK.deck.scenes.length, log: MK.log.map(l => l.text) })');
    assert.equal(made.step, 'done', made.err);
    assert.equal(made.calls, made.scenes);
    assert.match(made.note, /이야기 AI\(Gemma\)가 단어 문장 \d+줄 가운데 [1-9]\d*줄을 다듬었어요/);
    assert.ok(made.log.some(t => /이야기 AI 준비 완료/.test(t)), made.log.join('\n'));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

// 가짜 WebLLM: 엔진 만들기가 끝나지 않아요 (내려받는 중). 가짜 일꾼은 fail이면 곧 오류를 내요
const FAKE_LIB = fail => `(() => {
  window.__workers = [];
  window.Worker = class { constructor() { this.l = {}; this.dead = false; __workers.push(this); if (${fail}) setTimeout(() => (this.l.error || []).forEach(f => f({ message: 'no worker file' })), 20); }
    addEventListener(k, f) { (this.l[k] = this.l[k] || []).push(f); } terminate() { this.dead = true; } };
  AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: (w, id, cfg) => { window.__cfg = cfg; return new Promise(() => { setTimeout(() => cfg.initProgressCallback({ progress: 0.12, text: 'Fetching param cache[1/20]' }), 10); }); } };
  AI.gpu = true;
})()`;

test('AI loading: a worker that cannot start ends the wait, and the next deck tries again', async () => {
  const p = bootPage();
  try {
    p.run(FAKE_LIB(true));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, loading: !!AI.loading, workers: __workers.length, dead: __workers.map(w => w.dead), f16: __cfg.appConfig.model_list[0].required_features })');
    assert.equal(a.step, 'done');
    assert.match(a.note, /이야기 AI를 쓰지 못했어요\. AI를 받는 중\(12%\)에 멈췄어요\. AI를 돌리는 파일을 열지 못했어요.*\(오류: ai worker: no worker file\)/);
    assert.equal(a.loading, false);
    assert.deepEqual(a.dead, [true]);
    assert.deepEqual(a.f16, ['shader-f16'], 'f16이 없는 기기는 다 받기 전에 거절되게');
    // 모델 설정의 두 창 크기가 부딪치지 않게 (WindowSizeConfigurationError)
    const ov = p.json('__cfg.appConfig.model_list[0].overrides');
    assert.equal(ov.sliding_window_size, -1);
    assert.ok(ov.context_window_size > 0 && ov.context_window_size <= 4096);
    p.run(`MK.rows = ${JSON.stringify(ROWS)};`);
    await p.run('mkMake()');
    assert.equal(p.json('__workers.length'), 2);
  } finally { p.close(); }
});

// 가짜 WebLLM: 정해 둔 차례대로 실패하거나(받기 몇 %에서 어떤 오류) 성공해요
const PLAN_LIB = plan => `(() => {
  window.__workers = []; window.__plan = ${JSON.stringify(plan)};
  window.Worker = class { constructor() { this.l = {}; this.dead = false; __workers.push(this); } addEventListener(k, f) { (this.l[k] = this.l[k] || []).push(f); } terminate() { this.dead = true; } };
  AI.retryMs = 0;
  AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: (w, id, cfg) => new Promise((ok, no) => {
    const step = __plan.shift() || { ok: true };
    setTimeout(() => {
      cfg.initProgressCallback({ progress: step.at || 0.5, text: step.text || 'Fetching param cache[3/20]' });
      if (step.ok) ok({ chat: { completions: { create: async () => ({ choices: [{ message: { content: '' } }] }) } } });
      else no(step.name ? Object.assign(new Error(step.err), { name: step.name }) : new TypeError(step.err));
    }, 5);
  }) };
  AI.gpu = true;
})()`;

test('AI loading: a dropped connection is retried and the download continues; the reason is shown when it keeps failing', async () => {
  const p = bootPage();
  try {
    // 한 번 끊기고 두 번째에 성공: 일꾼 둘, 기록에 '이어 받는 중'
    p.run(PLAN_LIB([{ at: 0.16, err: 'Failed to fetch' }, { ok: true }]));
    const eng = await p.run('aiLoad(() => {}).then(e => !!e)');
    assert.equal(eng, true);
    assert.equal(p.json('__workers.length'), 2);
    assert.deepEqual(p.json('__workers.map(w => w.dead)'), [true, false]);
    p.run('aiDrop(); localStorage.removeItem("wg-ai-ready")');
    // 세 번 다 끊김: 단어장은 만들어지고, 어느 단계에서 왜 멈췄는지 보여요
    p.run(PLAN_LIB([{ at: 0.16, err: 'Failed to fetch' }, { at: 0.2, err: 'Failed to fetch' }, { at: 0.25, err: 'Failed to fetch' }]));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, log: MK.log.map(l => l.text), n: __workers.length })');
    assert.equal(a.step, 'done');
    assert.equal(a.n, 3);
    assert.match(a.note, /AI를 받는 중\(25%\)에 멈췄어요\. 인터넷 연결이 끊겨서 다 받지 못했어요.*\(오류: (?:TypeError: )?Failed to fetch\)/);
    assert.ok(a.log.some(t => /이어 받는 중 \(2\/3번째\)/.test(t)) && a.log.some(t => /이어 받는 중 \(3\/3번째\)/.test(t)), a.log.join('\n'));
    // 그래픽 칩에 올리다 기기를 잃으면 다시 받지 않고 바로 까닭을 알려요
    p.run('aiDrop()');
    p.run('aiDrop()');
    p.run(PLAN_LIB([{ at: 1, text: 'Loading model from cache[20/20]', name: 'WindowSizeConfigurationError', err: 'Only one of context_window_size and sliding_window_size can be positive.' }]));
    await p.run('aiLoad(() => {}).catch(() => 0)');
    assert.match(p.json('AI.err.text'), /그래픽 칩에 올리는 중\(100%\)에 멈췄어요\. 앱의 AI 설정이 모델과 맞지 않았어요/);
    p.run(PLAN_LIB([{ at: 0.4, text: 'Loading model from cache[8/20]', err: 'Device was lost' }]));
    await p.run('aiLoad(() => {}).catch(() => 0)');
    assert.equal(p.json('__workers.length'), 1);
    assert.match(p.json('AI.err.text'), /그래픽 칩에 올리는 중\(40%\)에 멈췄어요\. 그래픽 메모리가 모자랐어요/);
  } finally { p.close(); }
});

test('AI loading: too little browser storage is found before downloading, and persistent storage is asked for', async () => {
  const p = bootPage();
  try {
    p.run(PLAN_LIB([{ ok: true }]));
    p.run('window.__persist = 0; Object.defineProperty(navigator, "storage", { configurable: true, value: { persisted: async () => false, persist: async () => { __persist++; return false; }, estimate: async () => ({ quota: 300 * 1048576, usage: 10 * 1048576 }) } })');
    await p.run('aiLoad(() => {}).catch(() => 0)');
    assert.equal(p.json('__workers.length'), 0);
    assert.equal(p.json('__persist'), 1);
    assert.match(p.json('AI.err.text'), /브라우저 저장 공간이 모자라요 \(이 사이트가 쓸 수 있는 공간 약 300MB, 필요 약 820MB\)/);
  } finally { p.close(); }
});

test('make screen: the story AI can be downloaded before making a deck, and a failure says why with a retry button', async () => {
  const p = bootPage();
  try {
    p.run(PLAN_LIB([{ at: 0.3, name: 'QuotaExceededError', err: 'The quota has been exceeded.' }, { ok: true }]));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.step = 'review'; MK.aiWhy = ''; showScreen('make'); renderMake();`);
    const box = () => p.document.getElementById('mkai');
    assert.match(box().textContent, /쓸 수 있어요.*지금 AI 받아 두기/);
    box().querySelector('[data-mk="aidl"]').click();
    await new Promise(r => setTimeout(r, 40));
    assert.match(box().textContent, /받지 못했어요.*받는 중\(30%\)에 멈췄어요\. 브라우저 저장 공간이 모자라요.*QuotaExceededError|The quota/);
    assert.ok(box().querySelector('[data-mk="aidl"]'), '다시 받기 단추');
    box().querySelector('[data-mk="aidl"]').click();
    await new Promise(r => setTimeout(r, 40));
    assert.match(box().textContent, /받아 두었어요/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('deck list: a made deck can get new stories and pictures, keeping its words, episodes, id and progress key', async () => {
  const p = bootPage();
  try {
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const before = p.json('(() => { const d = MK.deck; return { id: d.id, created: d.created, updated: d.updated, eps: d.scenes.map(s => s.words.slice().sort()), keys: d.scenes.map(s => s.key), n: DeckStore.list().length }; })()');
    // 옛 판 이야기처럼 바꿔 두고, 지금 쓰는 단어장으로
    p.run(`(() => { const d = DeckStore.get(${JSON.stringify(before.id)}); d.scenes[0].lines = ['옛 이야기 한 줄 {' + d.scenes[0].words[0] + '|옛 뜻}']; switchDeck(d.id); })()`);
    p.run('MK.step = "pick"; MK.deck = null; openDecks()');
    const btn = p.document.querySelector(`[data-deckredo="${before.id}"]`);
    assert.ok(btn, '단어장 목록에 새 이야기 단추');
    btn.click();
    const rv = p.json('({ step: MK.step, rows: MK.rows.length, redo: !!MK.redo, label: document.querySelector("#make [data-mk=make]").textContent, note: MK.note })');
    assert.equal(rv.step, 'review');
    assert.equal(rv.rows, ROWS.length);
    assert.match(rv.label, /이 단어장 이야기 새로 만들기/);
    assert.match(rv.note, /단어·뜻·에피소드 묶음과 진행 기록은 그대로/);
    await new Promise(r => setTimeout(r, 5));
    await p.run('mkMake()');
    const after = p.json('(() => { const d = DeckStore.get(MK.deck.id); return { id: d.id, created: d.created, updated: d.updated, eps: d.scenes.map(s => s.words.slice().sort()), keys: d.scenes.map(s => s.key), n: DeckStore.list().length, line0: d.scenes[0].lines.join(" "), cur: DECK.id, redo: MK.redo }; })()');
    assert.equal(after.id, before.id);
    assert.equal(after.created, before.created);
    assert.ok(after.updated > before.updated);
    assert.deepEqual(after.eps, before.eps);
    assert.deepEqual(after.keys, before.keys);
    assert.equal(after.n, before.n, '새 단어장을 더 만들지 않아요');
    assert.doesNotMatch(after.line0, /옛 이야기/);
    assert.equal(after.cur, before.id);
    assert.equal(after.redo, null);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI loading: stopping during the first download stops the worker and the progress updates', async () => {
  const p = bootPage();
  try {
    p.run(FAKE_LIB(false));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; window.__done = mkMake();`);
    await new Promise(r => setTimeout(r, 80));
    const mid = p.json('MK.log.map(l => l.text)');
    assert.ok(mid.some(t => /12%/.test(t)), mid.join('\n'));
    p.run('MK.ctl.abort()');
    await p.run('window.__done');
    const a = p.json('({ step: MK.step, dead: __workers.map(w => w.dead), prog: AI.onProgress, loading: !!AI.loading })');
    assert.equal(a.step, 'review');
    assert.deepEqual(a.dead, [true]);
    assert.equal(a.prog, null);
    assert.equal(a.loading, false);
  } finally { p.close(); }
});

test('AI story: a phone that cannot run the AI still gets a deck, and is told why', async () => {
  const p = bootPage();
  try {
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, note: MK.aiNote, log: MK.log.map(l => l.text) })');
    assert.equal(made.step, 'done');
    assert.match(made.note, /AI 계산 기능\(WebGPU\)이 없어요/);
    assert.ok(made.log.some(t => /이야기 AI를 쓸 수 없어서/.test(t)), made.log.join('\n'));
    // 만들기 전 화면에도 까닭이 보여요
    p.run('MK.step = "review"; MK.aiWhy = undefined; renderMake()');
    await new Promise(r => setTimeout(r, 20));
    assert.match(p.document.getElementById('mkai').textContent, /이야기 AI를 쓸 수 없어요.*WebGPU/);
  } finally { p.close(); }
});

test('AI story: in an app browser such as KakaoTalk, the make screen says to open the page in Chrome', async () => {
  const p = bootPage();
  try {
    Object.defineProperty(p.window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36 KAKAOTALK/10.9.0', configurable: true });
    const why = await p.run('aiWhyNot()');
    assert.match(why, /카카오톡 안에서 열린 화면.*다른 브라우저로 열기.*크롬/);
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
    assert.equal(pics.abandon.layout, 'act', '버리다: 쓰레기통에 던지는 장면');
    assert.equal(pics.reduce.layout, 'change');
    assert.equal(pics.compare.layout, 'compare'); assert.equal(pics.compare.rel, 'VS');
    for (const [k, v] of Object.entries(pics)) assert.ok(!v.sign || !v.sign.includes(k), k);
    // 거절은 금지 표시, 포기는 흰 깃발
    const more = p.json(`['거절하다', '포기하다'].map(ko => { const f = SF[0]; const w = stLex('x', { ko }, f); const n = genNormalize(stPanel(w, { ko }, f, 0, 'H', {})); return n.layout || ('one:' + n.hold); })`);
    assert.deepEqual(more, ['no', 'one:🏳️']);
    // 검토에서 찾은 함정: 달리다는 '다르다'가 아니고, 화가는 화난 게 아니고, 박수는 공격이 아니고, 상처를 주다는 선물이 아니에요
    const traps = p.json(`[['run', '달리다'], ['painter', '화가'], ['applaud', '박수를 치다'], ['hurt', '상처를 주다'], ['change', '바꾸다'], ['melt', '녹다'], ['various', '다양한'], ['talkative', '말이 많은']].map(([en, ko]) => {
      const f = SF[0]; const w = stLex(en, { ko }, f); const hit = (w.sem && w.sem[2]) || {}; const n = genNormalize(stPanel(w, { ko }, f, 0, 'H', hit));
      return [en, n.layout || 'one', n.item || (n.from && n.from.emoji) || n.feel || (n.thing && n.thing.emoji) || ''];
    })`);
    const T = Object.fromEntries(traps.map(([en, l, x]) => [en, [l, x]]));
    assert.notEqual(T.run[0], 'compare');
    assert.notEqual(T.painter[0], 'feel');
    assert.deepEqual(T.applaud, ['act', '👏']);
    assert.deepEqual(T.hurt, ['act', '💥']);
    assert.equal(T.change[0], 'change');
    assert.deepEqual(T.melt, ['change', '🧊']);
    assert.equal(T.various[0], 'many'); assert.equal([...T.various[1]].length > 2, true);
    assert.notEqual(T.talkative[0], 'many');
    // 그 줄을 하는 인물(주인공·친구·말썽꾼)이 그림에 나와요: 기사 이야기의 말썽꾼은 용
    const v = p.json(`(() => { const f = SF[0]; const w = stLex('steal', { ko: '훔치다' }, f); return genNormalize(stPanel(w, { ko: '훔치다' }, f, 0, 'V', {})); })()`);
    assert.equal(v.layout, 'act'); assert.equal(v.a.kind, 'dragon'); assert.equal(v.dir, 'ba');
  } finally { p.close(); }
});
