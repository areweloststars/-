// 휴대폰 안 이야기 AI(Gemma 4)와 뜻 그림: 가짜 AI 엔진으로 문장 바꾸기·검사·되돌리기, 그림 꼴 고르기
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./page.cjs');
// 화면이 바뀔 때까지 기다려요 (정해진 짧은 시간만 기다리면 컴퓨터가 바쁠 때 실패해요)
const until = async (ok, ms = 3000) => { const t = Date.now(); while (!ok() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 15)); };

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

// 요청 글의 번호 줄('N. ★가 든 앱 문장 (★ = 뜻)')을 읽는 가짜 AI의 공통 부분: list는 [번호, ★ 줄, 뜻]
const STAR_LINES = `req => req.messages[0].content.split('\\n').map(l => l.match(/^(\\d+)\\. (.+) \\(★ = ([^)]+)\\)$/)).filter(Boolean)`;
// 홀수 번째는 ★를 두고 앞에 까닭을 붙여 고쳐 쓰고, 짝수 번째는 앱 문장을 그대로 베껴요(고친 게 아니니 앱 문장이 남아요)
const FAKE = `{ calls: 0, prompts: [], interruptGenerate() {}, chat: { completions: { create: async req => {
  AI.engine.calls++; AI.engine.prompts.push(req.messages[0].content);
  const list = (${STAR_LINES})(req);
  const out = list.map((m, i) => m[1] + '. ' + (i % 2 ? m[2] : '모두가 깜짝 놀라 지켜보는 가운데, ' + m[2]));
  return { choices: [{ message: { content: '**좋아요!**\\n' + out.join('\\n') } }] };
} } } }`;

test('AI story: lines with the meaning replace the app lines, copied lines stay; the deck says the AI wrote it', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
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
    // 문제 찾기용 기록: 줄마다 썼는지, 못 썼으면 왜인지
    const why = p.json('AI.diag[AI.diag.length - 1].why');
    assert.equal(why.filter(x => /: 씀$/.test(x)).length, 2, why.join('\n'));
    assert.ok(why.some(x => /앱 문장을 그대로 씀|못 찾음|없음/.test(x)), why.join('\n'));
    // 요청 글에는 앱 이야기 전체(앞부분·다짐·끝맺음)가 들어가고, 단어 줄에만 번호. 단어 뜻 자리는 ★로 바꾸고 줄 끝에 '(★ = 뜻)'
    for (const l of r.before) {
      const m = l.match(/\{[^|}]+\|([^}]+)\}/);
      assert.ok(prompt.includes(m ? l.replace(m[0], '★') + ` (★ = ${m[1]})` : l), l);
    }
    assert.equal((prompt.match(/^\d+\. [^\n]*★[^\n]* \(★ = [^)]+\)$/gm) || []).length, 4);
    // 단어 뜻은 요청 글의 번호 줄 속에 쓰지 않아요 (AI가 뜻을 다시 쓰지 않게)
    for (const l of prompt.split('\n').filter(x => /^\d+\. /.test(x))) assert.equal((l.match(/★/g) || []).length, 2, l);
    const wordLines = res.lines.filter(l => /\{[^|}]+\|/.test(l));
    assert.equal(wordLines.length, 4);
    assert.equal(wordLines.filter(l => /깜짝 놀라/.test(l)).length, 2);
    for (const l of wordLines.filter(l => !/깜짝 놀라/.test(l))) assert.ok(r.before.includes(l), l);
    for (const l of wordLines) assert.equal((l.match(/\{[^|}]+\|/g) || []).length, 1);
    // ★ 자리에는 앱 문장의 단어 표시가 그대로 돌아와요
    for (const l of wordLines.filter(l => /깜짝 놀라/.test(l))) assert.ok(r.before.includes(l.replace('모두가 깜짝 놀라 지켜보는 가운데, ', '')), l);

    // 단어장 만들기 전체: AI 준비 → 에피소드마다 AI → 저장 안내
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; AI.engine.calls = 0; showScreen('make');`);
    await p.run('mkMake()');
    const made = p.json('({ step: MK.step, err: MK.err, note: MK.aiNote, calls: AI.engine.calls, scenes: MK.deck.scenes.length, log: MK.log.map(l => l.text) })');
    assert.equal(made.step, 'done', made.err);
    assert.equal(made.calls, made.scenes);
    assert.match(made.note, /이야기 AI\(Gemma 4\)가 단어 문장 \d+줄 가운데 [1-9]\d*줄을 다듬었어요/);
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
    assert.equal(ov.context_window_size, 4096);
    assert.equal(ov.attention_sink_size, -1);
    assert.equal(p.json('__cfg.appConfig.model_list[0].model_id'), 'gemma-4-E2B-it-q4f16_1-MLC');
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
    assert.match(p.json('AI.err.text'), /브라우저 저장 공간이 모자라요 \(이 사이트가 쓸 수 있는 공간 약 300MB, 필요 약 3400MB\)/);
  } finally { p.close(); }
});

test('AI loading: a phone that kept the old story AI (Gemma 3 1B) frees that space before getting Gemma 4', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma3-1b-it-q4f16_1-MLC' });
  try {
    p.run(PLAN_LIB([{ ok: true }]));
    p.run('window.__del = []; AI.lib.deleteModelAllInfoInCache = async id => { __del.push(id); }');
    assert.equal(await p.run('aiLoad(() => {}).then(e => !!e)'), true);
    assert.deepEqual(p.json('__del'), ['gemma3-1b-it-q4f16_1-MLC']);
    assert.equal(p.window.localStorage.getItem('wg-ai-ready'), 'gemma-4-E2B-it-q4f16_1-MLC');
  } finally { p.close(); }
});

test('make screen: the story AI can be downloaded before making a deck, and a failure says why with a retry button', async () => {
  const p = bootPage();
  try {
    p.run(PLAN_LIB([{ at: 0.3, name: 'QuotaExceededError', err: 'The quota has been exceeded.' }, { ok: true }]));
    // 사진 읽기·목소리 파일은 받아지는 휴대폰 (서비스 워커가 맡은 페이지)
    p.run(`Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } }); window.fetch = async () => ({ ok: true, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) });`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.step = 'review'; MK.aiWhy = ''; showScreen('make'); renderMake();`);
    const box = () => p.document.getElementById('mkai');
    assert.match(box().textContent, /쓸 수 있어요.*인터넷 없이 쓰게 준비하기/);
    box().querySelector('[data-mk="aidl"]').click();
    await until(() => /다 받지 못했어요/.test(box().textContent));
    assert.match(box().textContent, /다 받지 못했어요.*받는 중\(30%\)에 멈췄어요\. 브라우저 저장 공간이 모자라요.*QuotaExceededError|The quota/);
    assert.match(box().textContent, /사진 읽기·목소리 파일도 이 기기에 받아 두었어요/);
    assert.ok(box().querySelector('[data-mk="aidl"]'), '다시 받기 단추');
    box().querySelector('[data-mk="aidl"]').click();
    await until(() => /인터넷 없이 쓸 준비가 됐어요/.test(box().textContent));
    assert.match(box().textContent, /인터넷 없이 쓸 준비가 됐어요.*받아 두었어요/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('mobile data: making a deck does not start the 3GB AI download, and says to use the get-ready button on Wi-Fi', async () => {
  const p = bootPage();
  try {
    const conn = c => Object.defineProperty(p.window.navigator, 'connection', { configurable: true, value: c });
    for (const c of [{ type: 'cellular' }, { type: 'wifi', saveData: true }]) {
      conn(c);
      p.run(PLAN_LIB([{ ok: true }]));
      p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
      await p.run('mkMake()');
      const a = p.json('({ step: MK.step, note: MK.aiNote, log: MK.log.map(l => l.text), n: __workers.length })');
      assert.equal(a.step, 'done');
      assert.equal(a.n, 0, '받기를 시작하지 않아요');
      assert.match(a.note, /모바일 데이터로 연결돼 있어서 이야기 AI\(약 3GB\)는 받지 않았어요.*기본 문장.*와이파이에서 ‘인터넷 없이 쓰게 준비하기’ 단추/);
      assert.ok(a.log.some(t => /모바일 데이터라서 이야기 AI\(약 3GB\)는 받지 않고/.test(t)), a.log.join('\n'));
    }
    // 와이파이·유선이거나 종류를 모르면 지금처럼 받아요
    for (const c of [{ type: 'wifi' }, { type: 'ethernet', saveData: false }, { type: 'unknown' }, undefined]) {
      conn(c);
      p.run('aiDrop(); localStorage.removeItem("wg-ai-ready")');
      p.run(PLAN_LIB([{ ok: true }]));
      p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
      await p.run('mkMake()');
      assert.equal(p.json('__workers.length'), 1, JSON.stringify(c));
      assert.doesNotMatch(p.json('MK.aiNote'), /모바일 데이터/);
    }
    // 이미 받아 둔 AI는 모바일 데이터여도 써요 (더 받지 않아요)
    conn({ type: 'cellular' });
    p.run('aiDrop()');
    p.run(PLAN_LIB([{ ok: true }]));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    assert.equal(p.json('__workers.length'), 1);
  } finally { p.close(); }
});

test('mobile data: the get-ready button asks once more in the page (about 3GB, use Wi-Fi), then downloads', async () => {
  const p = bootPage();
  try {
    Object.defineProperty(p.window.navigator, 'connection', { configurable: true, value: { type: 'cellular' } });
    p.run(PLAN_LIB([{ ok: true }]));
    p.run(`Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } }); window.fetch = async () => ({ ok: true, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) }); window.confirm = () => { throw new Error('no confirm()'); };`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.step = 'review'; MK.aiWhy = ''; MK.offline = 'no'; showScreen('make'); renderMake();`);
    const box = () => p.document.getElementById('mkai');
    assert.match(box().textContent, /지금은 모바일 데이터로 연결돼 있어요/);
    const btn = box().querySelector('[data-mk="aidl"]');
    btn.click();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(p.json('__workers.length'), 0, '첫 번째 누름에는 받지 않아요');
    assert.equal(p.json('MK.aiDl || null'), null);
    assert.match(btn.textContent, /모바일 데이터로 연결돼 있어요\. 이야기 AI는 약 3GB라서 와이파이에서 받는 게 좋아요.*한 번 더 눌러요/);
    btn.click();
    await until(() => /인터넷 없이 쓸 준비가 됐어요/.test(box().textContent));
    assert.equal(p.json('__workers.length'), 1);
    assert.match(box().textContent, /인터넷 없이 쓸 준비가 됐어요/);
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

test('AI story: an error while the AI writes is shown on the finished screen with its text', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
  try {
    p.run(`AI.gpu = true; AI.engine = { chat: { completions: { create: async () => { throw new Error('Prompt tokens exceed context window size'); } } } };`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, diag: MK.aiDiag, log: MK.log.map(l => l.text) })');
    assert.equal(a.step, 'done');
    assert.match(a.note, /문장을 쓰다가 오류가 났어요 \(오류: Prompt tokens exceed context window size\)/);
    assert.ok(a.diag.length >= 1 && /오류가 났어요: Prompt tokens exceed/.test(a.diag[0].why[0]), JSON.stringify(a.diag));
    assert.ok(a.log.some(t => /AI가 쓰다가 오류가 나서 기본 문장으로 \(Prompt tokens/.test(t)), a.log.join('\n'));
    assert.match(p.document.querySelector('#make .mkdiag').textContent, /AI가 쓴 글 보기.*Prompt tokens exceed/);
  } finally { p.close(); }
});

// 휴대폰이 그래픽 칩(GPU)을 잃었을 때 크롬이 내는 오류 (WebLLM 일꾼이 글로 보내요)
const LOST = "AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.";
// 가짜 WebLLM: 엔진을 만들 때마다 정해 둔 차례대로 다른 엔진을 줘요
//  'lost' 쓰자마자 그래픽 칩을 잃음, 'lost-stream' 토큰 3개를 쓰고 잃음, 'stream' 조금씩 써서 끝까지(쓴 토큰 수도 알려 줌), 'write' 한 번에 다 씀
// __calls: 몇 번째 엔진이 글을 썼는지, __onCall: 쓰기 시작할 때 부를 함수
const ENGINES_LIB = kinds => `(() => {
  window.__workers = []; window.__kinds = ${JSON.stringify(kinds)}; window.__calls = []; window.__onCall = null;
  window.Worker = class { constructor() { this.l = {}; this.dead = false; __workers.push(this); } addEventListener(k, f) { (this.l[k] = this.l[k] || []).push(f); } terminate() { this.dead = true; } };
  AI.retryMs = 0;
  const rewrite = req => (${STAR_LINES})(req).map(m => m[1] + '. 모두가 깜짝 놀라 지켜보는 가운데, ' + m[2]).join('\\n');
  const make = (kind, n) => ({ interruptGenerate() {}, chat: { completions: { create: async req => {
    __calls.push(n); if (__onCall) __onCall(n);
    if (kind === 'lost') throw ${JSON.stringify(LOST)};
    if (kind === 'lost-stream') return (async function* () { for (const t of ['1.', ' 모두가', ' 깜짝']) yield { choices: [{ delta: { content: t } }] }; throw ${JSON.stringify(LOST)}; })();
    if (kind === 'stream') { const text = rewrite(req); return (async function* () { for (const t of text.match(/[\\s\\S]{1,6}/g)) yield { choices: [{ delta: { content: t } }] }; yield { choices: [], usage: { prompt_tokens: 321, completion_tokens: 42 } }; })(); }
    return { choices: [{ message: { content: rewrite(req) } }] };
  } } } });
  let n = 0;
  AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: (w, id, cfg) => new Promise(ok => { const k = n++; setTimeout(() => { cfg.initProgressCallback({ progress: 1, text: 'Loading model from cache[20/20]' }); ok(make(__kinds[k] || 'write', k)); }, 5); }) };
  AI.gpu = true;
})()`;
// 화면을 가리거나(다른 앱·화면 꺼짐) 다시 보이게 해요
const VIS = `window.setVis = on => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => !on }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => on ? 'visible' : 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); };`;

test('AI story: the lost-graphics-chip error (mapAsync, unmapped) is classed as lost; the engine is dropped, reloaded once and the same episode is written again', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
  try {
    assert.deepEqual(p.json(`[${JSON.stringify(LOST)}, new Error(${JSON.stringify(LOST)}), 'The Device was lost before mapping was resolved.', 'Instance dropped', 'GPUDevice lost', 'context lost', 'Error: Model not loaded before trying to complete ChatCompletionRequest.', 'Prompt tokens exceed context window size', 'TypeError: Failed to fetch', 'Cannot find model record'].map(aiLost)`),
      [true, true, true, true, true, true, true, false, false, false]);
    // 단어 6개 = 에피소드 하나 (휴대폰에서 실패한 경우와 같아요). 첫 엔진은 토큰 3개를 쓰고 그래픽 칩을 잃어요
    p.run(ENGINES_LIB(['lost-stream', 'write']));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, calls: __calls, dead: __workers.map(w => w.dead), diag: MK.aiDiag, log: MK.log.map(l => l.text), scenes: MK.deck.scenes.length, lines: MK.deck.scenes[0].lines })');
    assert.equal(a.step, 'done');
    assert.equal(a.scenes, 1);
    assert.deepEqual(a.calls, [0, 1], '다시 준비한 엔진이 같은 에피소드를 한 번 더 써요');
    assert.deepEqual(a.dead, [true, false], '잃은 엔진의 일꾼은 멈춰요');
    assert.ok(a.lines.some(l => /깜짝 놀라/.test(l)), a.lines.join('\n'));
    assert.match(a.note, /단어 문장 6줄 가운데 6줄을 다듬었어요\. 쓰는 중에 그래픽 칩 연결이 한 번 끊겨서.*AI를 다시 준비해 그 에피소드를 다시 썼어요/);
    assert.ok(a.log.some(t => /쓰는 중에 그래픽 칩 연결이 끊겼어요\. AI를 다시 준비해서 한 번 더 써요/.test(t)), a.log.join('\n'));
    assert.ok(a.log.some(t => /완성 \(AI 문장 6줄\)/.test(t)), a.log.join('\n'));
    // 'AI가 쓴 글 보기': 어느 단계에서 몇 초 만에 토큰 몇 개를 쓰고 멈췄는지, 그때까지 쓴 글
    assert.match(a.diag[0].why[0], /AI가 문장을 쓰다가 오류가 났어요: AbortError: .*mapAsync.*unmapped/);
    // 컴퓨터(안드로이드가 아니고 휴대폰 그래픽 칩도 아님)는 모델이 만들어진 조각 크기(512토큰) 그대로 읽어요
    assert.match(a.diag[0].info, /^멈춘 단계: 글을 쓰는 중 · 시작하고 \d+\.\d초 뒤 · 이야기 읽기 \d+\.\d초 · 쓴 토큰 3개 · 읽기 조각 512토큰$/);
    assert.equal(a.diag[0].raw, '1. 모두가 깜짝');
    assert.match(p.document.querySelector('#make .mkdiag').textContent, /멈춘 단계: 글을 쓰는 중.*쓴 토큰 3개.*mapAsync/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI story: losing the graphics chip again after the reload does not loop; the next deck starts a fresh engine', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
  try {
    p.run(ENGINES_LIB(['lost', 'lost', 'write']));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, calls: __calls, dead: __workers.map(w => w.dead), eng: !!AI.engine, diag: MK.aiDiag, lines: MK.deck.scenes[0].lines })');
    assert.equal(a.step, 'done');
    assert.deepEqual(a.calls, [0, 1], '한 번만 다시 써요');
    assert.deepEqual(a.dead, [true, true], '엔진은 한 번만 다시 준비하고, 또 잃으면 버려요');
    assert.equal(a.eng, false, '죽은 엔진을 다음 단어장에 쓰지 않아요');
    assert.ok(!a.lines.some(l => /깜짝 놀라/.test(l)), '앱의 기본 문장으로');
    assert.match(a.note, /문장을 쓰다가 오류가 났어요 \(오류: AbortError: Failed to execute 'mapAsync'.*AI를 다시 준비해서 한 번 더 써 봤지만 또 끊겨서, 남은 이야기는 기본 문장으로 만들었어요\. 다른 앱을 닫고, 다 만들 때까지 화면을 켜 두세요\./);
    assert.equal(a.diag.length, 2);
    for (const d of a.diag) assert.match(d.info, /^멈춘 단계: 이야기를 읽고 쓰는 중 · 시작하고 \d+\.\d초 뒤 · 읽기 조각 512토큰$/);
    // 다음 단어장: 새 엔진을 준비해서 써요
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    assert.deepEqual(p.json('__calls'), [0, 1, 2]);
    assert.equal(p.json('__workers.length'), 3);
    assert.match(p.json('MK.aiNote'), /다듬었어요\.$/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('making a deck keeps the screen awake, asks again after the page comes back, explains the hidden page, and lets go at the end', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
  try {
    // 가짜 화면 켜 두기: 브라우저는 화면이 가려지면 스스로 풀어요 (release 이벤트)
    p.run(`window.__wl = { asked: 0, freed: 0, live: null, fail: false };
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async type => {
        __wl.asked++; __wl.type = type;
        if (__wl.fail) throw new DOMException('not allowed', 'NotAllowedError');
        const s = { released: false, l: [], addEventListener(k, f) { if (k === 'release') s.l.push(f); }, release: async () => { if (!s.released) { s.released = true; __wl.freed++; s.l.forEach(f => f()); } } };
        __wl.live = s; return s;
      } } });
      window.__uaRelease = () => { const s = __wl.live; if (s && !s.released) { s.released = true; s.l.forEach(f => f()); } };`);
    p.run(VIS);
    p.run(ENGINES_LIB(['stream']));
    // AI가 쓰는 동안 다른 앱을 열었다가 돌아와요
    p.run(`__onCall = () => { __wl.atCall = !!(__wl.live && !__wl.live.released); setVis(false); __uaRelease(); __wl.hiddenLog = MK.log.length; setVis(true); };`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, note: MK.aiNote, wl: __wl, held: WAKE.tags.size, lock: !!WAKE.lock, log: MK.log.map(l => l.text), diag: MK.aiDiag, env: MK.aiEnv })');
    assert.equal(a.step, 'done');
    assert.equal(a.wl.type, 'screen');
    assert.equal(a.wl.atCall, true, 'AI가 쓰는 동안 화면을 켜 둬요');
    assert.equal(a.wl.asked, 2, '돌아오면 다시 부탁해요');
    assert.equal(a.wl.freed, 1, '다 만들면 풀어요');
    assert.equal(a.held, 0); assert.equal(a.lock, false);
    // 돌아오면 무슨 일인지 기록에, 다 만들면 안내 글에
    assert.ok(a.log.slice(a.wl.hiddenLog).some(t => t === '만드는 중에 화면이 꺼지거나 다른 앱이 열렸어요. 이러면 크롬이 AI의 그래픽 작업을 멈출 수 있어요. 다 만들 때까지 이 화면을 켜 두세요.'), a.log.join('\n'));
    assert.match(a.note, /다듬었어요\. 만드는 중에 화면이 꺼지거나 다른 앱이 열렸어요\. 이러면 크롬이 AI의 그래픽 작업을 멈출 수 있어요\. 다음에는 다 만들 때까지 이 화면을 켜 두세요\.$/);
    // 끝까지 쓴 글의 기록: 걸린 시간, 읽은·쓴 토큰 수, 가려진 횟수
    assert.match(a.diag[0].info, /^걸린 시간 \d+\.\d초 · 이야기 읽기 \d+\.\d초 · 읽은 토큰 321개 · 쓴 토큰 42개 · 읽기 조각 512토큰 · 그동안 화면 꺼짐·다른 앱 1번$/);
    assert.match(a.diag[0].why.join(' '), /: 씀/);
    // 거절돼도 그냥 만들어요 (오류 없음)
    p.run(`__wl.fail = true; __onCall = null; MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    assert.equal(p.json('MK.step'), 'done');
    assert.equal(p.json('__wl.asked'), 3);
    assert.doesNotMatch(p.json('MK.aiNote'), /화면이 꺼지거나/);
    assert.equal(p.json('WAKE.tags.size'), 0);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI loading: stopping during the first download stops the worker and the progress updates', async () => {
  const p = bootPage();
  try {
    p.run(FAKE_LIB(false));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; window.__done = mkMake();`);
    await until(() => p.json('MK.log.map(l => l.text)').some(t => /12%/.test(t)));
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
    await until(() => /이야기 AI를 쓸 수 없어요/.test(p.document.getElementById('mkai').textContent));
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

test('AI check: low phone memory, a small GPU buffer limit and missing f16 each give a plain reason', async () => {
  const p = bootPage();
  try {
    const nav = p.window.navigator;
    const gpu = (f16, buf) => Object.defineProperty(nav, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ features: new Set(f16 ? ['shader-f16'] : []), limits: { maxStorageBufferBindingSize: buf } }) } });
    const why = async () => { p.run('AI.gpu = null; AI.gpuWhy = ""'); return p.run('aiWhyNot()'); };
    // 크롬이 알려 준 메모리(RAM)가 8GB보다 작으면(실제 4~6GB 휴대폰) 그래픽 칩을 보기 전에 안 된다고 해요: 올리다가 탭이 꺼져요
    gpu(true, 2 ** 30);
    for (const mem of [2, 4]) {
      Object.defineProperty(nav, 'deviceMemory', { configurable: true, value: mem });
      assert.match(await why(), new RegExp(`메모리\\(RAM\\)가 작아서 이야기 AI를 돌릴 수 없어요 \\(크롬이 알려 준 메모리 약 ${mem}GB, 이야기 AI는 8GB 필요\\).*게임은 앱이 쓴 문장으로 그대로 할 수 있어요`));
      assert.equal(p.json('AI.gpu'), false);
    }
    Object.defineProperty(nav, 'deviceMemory', { configurable: true, value: 8 });
    // 그래픽 칩 버퍼 한도: 기본 128MB는 모자라요 (모델 기록이 없으면 192MB 필요)
    gpu(true, 134217728);
    assert.match(await why(), /한 번에 다룰 수 있는 크기가 작아요\(약 128MB, 이야기 AI는 약 192MB 필요\)/);
    // 모델 기록이 있으면 그 값으로
    p.run('AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL, buffer_size_required_bytes: 262144000 }] } }');
    gpu(true, 201326592);
    assert.match(await why(), /약 192MB, 이야기 AI는 약 250MB 필요/);
    p.run('AI.lib = null');
    gpu(false, 2 ** 30);
    assert.match(await why(), /16비트 계산/);
    gpu(true, 2 ** 30);
    assert.equal(await why(), '');
    assert.equal(p.json('AI.gpu'), true);
    // 문제 찾기용: 그래픽 칩 이름을 기억해요 ('AI가 쓴 글 보기' 맨 위 줄)
    Object.defineProperty(nav, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ features: new Set(['shader-f16']), limits: { maxStorageBufferBindingSize: 2 ** 30 }, info: { vendor: 'qualcomm', architecture: 'adreno-8xx' } }) } });
    assert.equal(await why(), '');
    assert.equal(p.json('aiEnvText()'), '기기: 메모리 약 8GB · 그래픽 칩 qualcomm adreno-8xx · 버퍼 한도 1024MB');
  } finally { p.close(); }
});

test('AI answer: thinking blocks are removed before reading the numbered lines', () => {
  const p = bootPage();
  try {
    const t = p.json(`[
      '<think>1. 먼저 무엇을 쓸지 생각해요.</think>\\n1. 레오는 망원경을 빌렸어요.',
      '<|channel>thought\\n1. 생각하는 줄이에요.<channel|>1. 레오는 망원경을 빌렸어요.',
      '1. 생각만 남은 줄이에요.\\n</thought>\\n1. 레오는 망원경을 빌렸어요.',
      '1. 레오는 망원경을 빌렸어요.\\n<think>2. 끝나지 않은 생각',
      '1. 레오는 망원경을 빌렸어요.<end_of_turn>'
    ].map(aiNoThink)`);
    for (const x of t) assert.equal(x, '1. 레오는 망원경을 빌렸어요.');
    assert.deepEqual(p.json(`aiParse(aiNoThink('<thought>1. 공주를 먼저 써야지.\\n2. 다음 줄도.</thought>1. 레오는 망원경을 빌렸어요.\\n2. 공주는 레오를 격려했어요.'), 2)`), [['레오는 망원경을 빌렸어요.'], ['공주는 레오를 격려했어요.']]);
  } finally { p.close(); }
});

test('AI lines for children: rude, drug, gory or hateful lines fall back to the app line, with the reason', async () => {
  const p = bootPage();
  try {
    assert.deepEqual(p.json(`['레오는 마약을 빌렸어요.', '레오는 피범벅이 된 망원경을 빌렸어요.', '새끼 고양이가 망원경을 빌렸어요.', '촛불이 꺼져서 레오는 망원경을 빌렸어요.', '레오는 망원경을 빌렸어요.'].map(aiLineWhy)`),
      ['어린이에게 맞지 않는 말', '어린이에게 맞지 않는 말', '', '', '']);
    // 가짜 AI: 첫 줄은 맞지 않는 말, 둘째 줄은 괜찮은 말
    p.run(`AI.engine = { interruptGenerate() {}, chat: { completions: { create: async req => {
      const list = (${STAR_LINES})(req);
      return { choices: [{ message: { content: list.map((m, i) => m[1] + '. ' + (i === 0 ? '모두가 마약 이야기를 하는 사이, ' : '모두가 깜짝 놀라 지켜보는 가운데, ') + m[2]).join('\\n') } }] };
    } } } };`);
    await p.run(`(async () => { const rows = ${rowsObj}; const res = mkStory(['borrow', 'encourage'], rows, 0); window.__before = res.lines.slice(); window.__n = await aiRewrite(AI.engine, res, rows, 0, null); window.__res = res; })()`);
    assert.equal(p.json('window.__n'), 1);
    const why = p.json('AI.diag[AI.diag.length - 1].why');
    assert.match(why[0], /: 어린이에게 맞지 않는 말$/);
    assert.match(why[1], /: 씀$/);
    assert.ok(!p.json('window.__res.lines.join(" ")').includes('마약'));
  } finally { p.close(); }
});

// 손으로 만든 이야기 한 편 (이야기 틀 SF[0]: 기사 레오·꼬마 공주·배고픈 용). ★ 자리 종류가 다 들어 있어요:
// 문장 끝('불안했어요.'), 뒤에 낱말이 오는 꼴('용감한 얼굴로'), 조사가 붙는 이름씨('설문 조사를')
const STAR_ROWS = JSON.stringify(Object.fromEntries([['anxious', '불안한, 걱정하는'], ['borrow', '빌리다'], ['abandon', '버리다, 포기하다'], ['brave', '용감한'], ['survey', '설문 조사'], ['encourage', '격려하다']].map(([en, ko]) => [en, { en, ko, pos: 'x' }])));
const STAR_RES = JSON.stringify({ lines: [
  '옛날 옛적 하늘 성에 기사 레오가 살았어요.',
  '어둠 속에서 이상한 소리가 나자 꼬마 공주는 {anxious|불안했어요}.',
  '먼저 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.',
  '용은 다 먹은 사탕 껍질을 아무 데나 {abandon|버렸어요}.',
  '레오는 {brave|용감한} 얼굴로 성문 앞에 섰어요.',
  '공주는 마을에서 {survey|설문 조사}를 했어요.',
  '드디어 공주는 레오의 어깨를 두드리며 {encourage|격려했어요}.',
  '레오와 용은 친구가 됐답니다.'
], words: { borrow: { pic: '' } } });
// 정해 둔 답을 그대로 돌려주는 가짜 AI로 STAR_RES를 고쳐 써요
const starRun = async (p, answer) => {
  p.run(`AI.engine = { prompts: [], interruptGenerate() {}, chat: { completions: { create: async req => { AI.engine.prompts.push(req.messages[0].content); return { choices: [{ message: { content: ${JSON.stringify(answer)} } }] }; } } } };`);
  await p.run(`(async () => { const res = ${STAR_RES}; window.__n = await aiRewrite(AI.engine, res, ${STAR_ROWS}, 0, null); window.__res = res; })()`);
  return p.json('({ n: window.__n, lines: window.__res.lines, words: window.__res.words, diag: AI.diag[AI.diag.length - 1], prompt: AI.engine.prompts[0] })');
};

test('AI ★ answers: the phone failure re-created with general words (copied [meaning] tags, other words for the meaning, a chatty first line, a three-sentence line) is refused line by line, keeping the app lines and the raw answer', async () => {
  const p = bootPage();
  try {
    const answer = '어린이 그림책 작가로서 다정하고 깨끗한 이야기로 고쳐 드릴게요.\n\n'
      + '1. [불안했어요] 꼬마 공주는 어둠 속에서 마음이 콩닥콩닥 뛰었어요.\n'
      + '2. [빌렸어요] 레오는 도서관에서 두꺼운 지도책을 가져왔어요.\n'
      + '3. [버렸어요] 용은 사탕 껍질을 깨끗하고 예쁘게 모았어요.\n'
      + '4. [용감한] 레오는 씩씩한 얼굴로 성문 앞에 섰어요.\n'
      + '5. [설문 조사] 공주는 마을 사람들에게 이것저것 물어보았어요.\n'
      + '6. [격려했어요] 공주는 레오의 어깨를 두드렸어요. 용은 이제 착한 이웃이 되었어요. 성에는 달콤한 냄새가 가득했어요.';
    const before = JSON.parse(STAR_RES).lines;
    const r = await starRun(p, answer);
    assert.equal(r.n, 0);
    assert.deepEqual(r.lines, before, '모두 앱 문장 그대로');
    assert.deepEqual(r.diag.why, ['1. anxious: ★가 없음', '2. borrow: ★가 없음', '3. abandon: ★가 없음', '4. brave: ★가 없음', '5. survey: ★가 없음', '6. encourage: 문장이 너무 많음']);
    // 'AI가 쓴 글 보기'에는 AI가 쓴 글이 그대로 남아요
    assert.equal(r.diag.raw, answer);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI ★ answers: the exact word mark goes back where ★ is; copied tags, (★ = meaning) notes, bold, quotes around ★ or the line are removed, the noun particle follows the word, and a line split in two is joined', async () => {
  const p = bootPage();
  try {
    const answer = '네, 고쳐 볼게요!\n\n'
      + '1. [불안했어요] 용의 그림자가 성벽에 비치자, 꼬마 공주는 ★.\n'
      + '2. (★ = 빌렸어요) 길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 ★.\n'
      + '3. **배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 ★.** (★ = 버렸어요)\n'
      + '4. "공주를 지키려고 레오는 ‘★’ 얼굴로 성문 앞에 섰어요."\n'
      + '5. 용이 좋아하는 간식을 알아보려고 공주는 마을에서 ★을 했어요.\n'
      + '6. 레오가 지쳐 보였어요.\n그래서 공주는 레오의 어깨를 두드리며 ★.';
    const r = await starRun(p, answer);
    assert.equal(r.n, 6, r.diag.why.join('\n'));
    assert.deepEqual(r.lines.slice(1, 7), [
      '용의 그림자가 성벽에 비치자, 꼬마 공주는 {anxious|불안했어요}.',
      '길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.',
      '배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 {abandon|버렸어요}.',
      '공주를 지키려고 레오는 {brave|용감한} 얼굴로 성문 앞에 섰어요.',
      '용이 좋아하는 간식을 알아보려고 공주는 마을에서 {survey|설문 조사}를 했어요.',
      '레오가 지쳐 보였어요. 그래서 공주는 레오의 어깨를 두드리며 {encourage|격려했어요}.'
    ]);
    assert.deepEqual(r.diag.why, ['1. anxious: 씀', '2. borrow: 씀', '3. abandon: 씀', '4. brave: 씀', '5. survey: 씀', '6. encourage: 씀']);
    // 그림 설명도 새 문장으로
    assert.equal(r.words.borrow.pic, '길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 빌렸어요.');
    // 앞뒤 줄은 그대로
    assert.equal(r.lines[0], '옛날 옛적 하늘 성에 기사 레오가 살았어요.');
    assert.equal(r.lines[7], '레오와 용은 친구가 됐답니다.');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI ★ checks: missing or doubled ★, a ★ that does not fit the sentence, the meaning word again next to ★, 안/못 before ★ and another character are refused with a reason; the child-safety list still applies; the meaning written out in full is still used', () => {
  const p = bootPage();
  try {
    const fit = (k, t) => p.json(`(() => { const q = aiReq(${STAR_RES}, ${STAR_ROWS}, 0); return aiFit(aiClean(${JSON.stringify(t)}), q.items[${k}], q.f); })()`);
    const why = (k, t) => { const r = fit(k, t); return r.line ? '씀' : r.why; };
    assert.equal(why(0, '용의 그림자가 비치자, 꼬마 공주는 마음이 콩닥콩닥 뛰었어요.'), '★가 없음');
    assert.equal(why(0, '용의 그림자가 비치자, 꼬마 공주는 ★. 그래서 공주는 ★.'), '★가 두 번');
    assert.equal(why(0, '용의 그림자가 비치자, 꼬마 공주는 ★게 됐어요.'), '★ 자리가 문장과 안 맞음', '★는 끝말까지 품고 있어요');
    assert.equal(why(1, '길을 찾으려고 레오는 도서관에서 지도책을 ★ 그래서 기뻤어요.'), '★ 자리가 문장과 안 맞음');
    assert.equal(why(3, '공주를 지키려고 레오는 ★.'), '★ 자리가 문장과 안 맞음', '‘용감한’ 뒤에는 낱말이 와야 해요');
    assert.equal(why(3, '공주를 지키려고 레오는 ★게 섰어요.'), '★ 자리가 문장과 안 맞음');
    assert.equal(why(3, '공주를 지키려고 레오는 용감하고 ★ 얼굴로 섰어요.'), '★ 옆에 같은 말');
    assert.equal(why(1, '길을 찾으려고 레오는 도서관에서 지도책을 못 ★.'), '안·못이 ★ 뜻을 뒤집음');
    assert.equal(why(0, '숲속의 여우는 깜짝 놀라서 ★.'), '인물이 바뀜', '그림 속 인물(공주)이 그대로여야 해요');
    assert.equal(why(0, '모두가 마약 이야기를 하는 사이, 꼬마 공주는 ★.'), '어린이에게 맞지 않는 말');
    assert.equal(why(0, '어둠 속에서 이상한 소리가 나자 꼬마 공주는 ★.'), '앱 문장을 그대로 씀');
    assert.equal(why(5, '레오가 지쳐 보였어요. 공주는 웃었어요. 그래서 공주는 레오의 어깨를 두드리며 ★.'), '문장이 너무 많음');
    // 메모·덧붙인 뜻·따옴표는 떼고 ★ 하나로 봐요
    for (const t of ['★ = 불안했어요: 용의 그림자가 비치자, 꼬마 공주는 ★.', '용의 그림자가 비치자, 꼬마 공주는 ★(불안했어요).', '용의 그림자가 비치자, 꼬마 공주는 “★”.', '용의 그림자가 비치자, 꼬마 공주는 ★ 불안했어요.', '용의 그림자가 비치자, 꼬마 공주는 ☆.'])
      assert.deepEqual(fit(0, t), { line: '용의 그림자가 비치자, 꼬마 공주는 {anxious|불안했어요}.' }, t);
    // ★를 줄기처럼 보고 ★ 말의 끝말을 또 붙였으면 그 끝말만 떼요
    assert.deepEqual(fit(0, '용의 그림자가 비치자, 꼬마 공주는 ★했어요.'), { line: '용의 그림자가 비치자, 꼬마 공주는 {anxious|불안했어요}.' });
    assert.deepEqual(fit(3, '공주를 지키려고 레오는 ★한 얼굴로 섰어요.'), { line: '공주를 지키려고 레오는 {brave|용감한} 얼굴로 섰어요.' });
    // ★ 없이 뜻을 그대로 쓴 줄은 예전처럼 뜻 자리를 찾아요 (다른 말로 바꾼 뜻은 안 돼요)
    assert.deepEqual(fit(0, '용의 그림자가 비치자, 꼬마 공주는 불안했어요.'), { line: '용의 그림자가 비치자, 꼬마 공주는 {anxious|불안했어요}.', how: '뜻 낱말로' });
    // 이름씨 뒤 조사는 받침에 맞게
    assert.deepEqual(fit(4, '공주는 마을에서 ★이었어요.'), { line: '공주는 마을에서 {survey|설문 조사}였어요.' });
  } finally { p.close(); }
});

test('AI prompt: numbered lines carry ★ with the meaning only in the (★ = …) note, one worked example keeps ★, and the child-safety rule names what to leave out instead of adjectives such as clean or kind', () => {
  const p = bootPage();
  try {
    const prompt = p.json(`aiReq(${STAR_RES}, ${STAR_ROWS}, 0).prompt`);
    const L = prompt.split('\n');
    // 예시 하나: '앱 줄 → 고친 줄' 한 줄, 따라 쓸 꼬리표('줄:'·'답:') 없이. ★가 끝말까지 품은 꼴, 고친 줄에도 ★가 딱 한 번
    assert.ok(L.includes('예시: 아기 곰은 높은 다리 위에서도 ★. (★ = 용감했어요) → 강 건너에서 엄마가 손을 흔들자, 아기 곰은 높은 다리 위에서도 ★.'), prompt);
    assert.doesNotMatch(prompt, /^(?:줄|답)\s*:/m);
    const ex = L.find(l => l.startsWith('예시: ')).split('→')[1];
    assert.equal((ex.match(/★/g) || []).length, 1);
    assert.doesNotMatch(ex, /용감/);
    // 예시를 그대로 읽으면 화살표 뒤의 고친 줄이 나와요 (작은 모델이 예시 꼴을 따라 써도 앱이 읽어요)
    assert.equal(p.json(`aiClean(AI_EXAMPLE)`), '강 건너에서 엄마가 손을 흔들자, 아기 곰은 높은 다리 위에서도 ★.');
    // 번호 줄: 단어 뜻 자리는 ★, 뜻은 줄 끝 메모에만
    assert.deepEqual(L.filter(l => /^\d+\. /.test(l)), [
      '1. 어둠 속에서 이상한 소리가 나자 꼬마 공주는 ★. (★ = 불안했어요)',
      '2. 먼저 레오는 도서관에서 두꺼운 지도책을 ★. (★ = 빌렸어요)',
      '3. 용은 다 먹은 사탕 껍질을 아무 데나 ★. (★ = 버렸어요)',
      '4. 레오는 ★ 얼굴로 성문 앞에 섰어요. (★ = 용감한)',
      '5. 공주는 마을에서 ★를 했어요. (★ = 설문 조사)',
      '6. 드디어 공주는 레오의 어깨를 두드리며 ★. (★ = 격려했어요)'
    ]);
    // 번호 없는 줄은 그대로
    assert.ok(L.includes('옛날 옛적 하늘 성에 기사 레오가 살았어요.') && L.includes('레오와 용은 친구가 됐답니다.'));
    // 이야기 속으로 새어 들 꾸밈말 없이: 빼야 할 것만
    // 분위기 말('무서운 내용 없이')도 빼요: 단어 뜻에 따라 조금 긴장되는 장면이 필요해요
    assert.doesNotMatch(prompt, /깨끗|다정|무서운|싸움/);
    assert.ok(L.includes('- 어린이가 읽어요. 욕설이나 다치는 장면은 쓰지 않아요.'), prompt);
    assert.match(prompt, /한두 문장/);
    assert.match(prompt, /인물은 그대로/);
    assert.match(prompt, /★ 표시는 지우거나 바꾸지 말고 딱 한 번 그대로 써요/);
    assert.match(prompt, /그 말과 뜻이 어울리게 ★ 앞뒤를 써요/);
    assert.equal(L[L.length - 1], "답은 번호 줄만 1번부터 차례로 '1. 고친 문장' 꼴로 써요. 다른 말은 쓰지 않아요.");
    // 답 읽기: 예시처럼 '답:'을 붙인 번호 줄, 메모만 쓰고 다음 줄에 쓴 문장, 두 줄로 나눠 쓴 한 답
    assert.deepEqual(p.json(`aiParse('답: 1. 공주는 ★.\\n2. (★ = 빌렸어요)\\n레오는 지도책을 ★.\\n3. 용은 배가 불렀어요.\\n그래서 껍질을 ★.', 3)`),
      [['공주는 ★.'], ['레오는 지도책을 ★.'], ['용은 배가 불렀어요. 그래서 껍질을 ★.', '용은 배가 불렀어요.']]);
  } finally { p.close(); }
});

test('AI ★ answers: labels copied from an example (줄:/답:, 고친 문장:, the meaning used as a label), an echoed app line with the rewrite after → or on the next line, a note-only line and other number shapes give a clean line with the word mark back in place', async () => {
  const p = bootPage();
  try {
    const answer = '1. 줄: 어둠 속에서 이상한 소리가 나자 꼬마 공주는 ★. (★ = 불안했어요)\n'
      + '답: 용의 그림자가 성벽에 비치자, 꼬마 공주는 ★.\n'
      + '2. 먼저 레오는 도서관에서 두꺼운 지도책을 ★. (★ = 빌렸어요) → 길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 ★.\n'
      + '3. 용은 다 먹은 사탕 껍질을 아무 데나 ★. (★ = 버렸어요)\n'
      + '→ 배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 ★.\n'
      + '4번 답: 고친 문장: 공주를 지키려고 레오는 ★ 얼굴로 성문 앞에 섰어요.\n'
      + '답 5. 설문 조사: 용이 좋아하는 간식을 알아보려고 공주는 마을에서 ★를 했어요.\n'
      + '6. 줄: 드디어 공주는 레오의 어깨를 두드리며 ★. 답: 레오가 지쳐 보이자, 공주는 레오의 어깨를 두드리며 ★.';
    const want = [
      '용의 그림자가 성벽에 비치자, 꼬마 공주는 {anxious|불안했어요}.',
      '길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.',
      '배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 {abandon|버렸어요}.',
      '공주를 지키려고 레오는 {brave|용감한} 얼굴로 성문 앞에 섰어요.',
      '용이 좋아하는 간식을 알아보려고 공주는 마을에서 {survey|설문 조사}를 했어요.',
      '레오가 지쳐 보이자, 공주는 레오의 어깨를 두드리며 {encourage|격려했어요}.'
    ];
    let r = await starRun(p, answer);
    assert.equal(r.n, 6, r.diag.why.join('\n'));
    assert.deepEqual(r.lines.slice(1, 7), want);
    assert.deepEqual(r.diag.why, ['1. anxious: 씀', '2. borrow: 씀', '3. abandon: 씀', '4. brave: 씀', '5. survey: 씀', '6. encourage: 씀']);
    // 그림 설명에도 꼬리표가 들어가지 않아요
    assert.equal(r.words.borrow.pic, '길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 빌렸어요.');
    // '1. 답: …', 메모만 쓴 번호 줄 다음 줄의 문장, 뜻을 꼬리표처럼 앞에 붙인 줄, 빈 번호 줄 다음의 '줄:'(되풀이)·'답:' 두 줄
    r = await starRun(p, '1. 답: 용의 그림자가 성벽에 비치자, 꼬마 공주는 ★.\n'
      + '2. ★ = 빌렸어요\n길을 잃지 않으려고 레오는 도서관에서 두꺼운 지도책을 ★.\n'
      + '3. 버렸어요: 배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 ★.\n'
      + '4.\n줄: 레오는 ★ 얼굴로 성문 앞에 섰어요. (★ = 용감한)\n답: 공주를 지키려고 레오는 ★ 얼굴로 성문 앞에 섰어요.');
    assert.deepEqual(r.lines.slice(1, 5), want.slice(0, 4), r.diag.why.join('\n'));
    assert.deepEqual(r.diag.why.slice(4), ['5. survey: 답에서 이 번호를 못 찾음', '6. encourage: 답에서 이 번호를 못 찾음']);
    // 꼬리표만 떼고 앱 문장을 되풀이한 줄은 고친 게 아니에요
    r = await starRun(p, '1. 줄: 어둠 속에서 이상한 소리가 나자 꼬마 공주는 ★. (★ = 불안했어요)\n2. 고친 줄: 먼저 레오는 도서관에서 두꺼운 지도책을 ★.');
    assert.equal(r.n, 0);
    assert.deepEqual(r.diag.why.slice(0, 2), ['1. anxious: 답에서 이 번호를 못 찾음', '2. borrow: 앱 문장을 그대로 씀']);
    assert.deepEqual(r.lines, JSON.parse(STAR_RES).lines);
    // 대답·정답 같은 낱말 속 '답:'은 꼬리표가 아니에요
    assert.equal(p.json(`aiClean('공주가 외쳤어요. “정답: 사과!” 레오는 ★.')`), '공주가 외쳤어요. “정답: 사과!” 레오는 ★.');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI ★ checks: an app line that already has two sentences may get one more (a reason or a result), four are still too many; the limit counts the word mark so an accepted line always fits the deck', async () => {
  const p = bootPage();
  try {
    const rows = JSON.stringify({ profit: { en: 'profit', ko: '이익, 수익', pos: 'x' }, dream: { en: 'dream', ko: '꿈', pos: 'x' } });
    const res = JSON.stringify({ lines: ['옛날 옛적 하늘 성에 기사 레오가 살았어요.', '레오는 매운 떡볶이를 팔아 {profit|이익}을 냈어요. 그 돈으로 떡볶이를 또 샀죠.', '꼬마 공주는 레오에게 {dream|꿈}을 물었어요. “나는 최고의 방패 선수가 될 거야!”', '레오와 용은 친구가 됐답니다.'] });
    const fit = (k, t) => p.json(`(() => { const q = aiReq(${res}, ${rows}, 0); const r = aiFit(aiClean(${JSON.stringify(t)}), q.items[${k}], q.f, q); return r.line || r.why; })()`);
    assert.equal(fit(0, '떡볶이가 인기가 많았어요. 레오는 매운 떡볶이를 팔아 ★을 냈어요. 그 돈으로 떡볶이를 또 샀죠.'), '떡볶이가 인기가 많았어요. 레오는 매운 떡볶이를 팔아 {profit|이익}을 냈어요. 그 돈으로 떡볶이를 또 샀죠.');
    assert.equal(fit(0, '떡볶이가 인기가 많았어요. 손님이 줄을 섰어요. 레오는 매운 떡볶이를 팔아 ★을 냈어요. 그 돈으로 떡볶이를 또 샀죠.'), '문장이 너무 많음');
    // 대사(따옴표 속)는 한 문장으로 세요
    assert.equal(fit(1, '공주는 레오의 마음이 궁금했어요. 그래서 레오에게 ★을 물었어요. “나는 최고의 방패 선수가 될 거야!”'), '공주는 레오의 마음이 궁금했어요. 그래서 레오에게 {dream|꿈}을 물었어요. “나는 최고의 방패 선수가 될 거야!”');

    // 길이: 단어 표시({anxious|…})까지 넣어 140자. 꼭 맞는 줄은 쓰고 단어장(mkEpisode)에도 남아요, 한 글자라도 넘으면 앱 문장을 그대로 둬요
    const fits = '아주 깊은 밤에 용의 커다란 그림자가 높은 성벽 위로 천천히 지나가고 차가운 바람이 낡은 나무 창문을 덜컹덜컹 흔들었어요. 게다가 탁자 위 촛불까지 훅 꺼지자 꼬마 공주는 폭신한 이불을 머리끝까지 뒤집어쓴 채 숨을 죽이고 ★.';
    const over = fits.replace('탁자 위', '탁자 위의');
    assert.equal(fits.replace('★', '불안했어요').length, 130);
    let r = await starRun(p, `1. ${over}`);
    assert.equal(r.diag.why[0], '1. anxious: 너무 김');
    r = await starRun(p, `1. ${fits}`);
    assert.equal(r.diag.why[0], '1. anxious: 씀');
    assert.equal(r.lines[1].length, 140);
    const ep = p.json(`(() => { const res = window.__res, rows = ${STAR_ROWS}; return mkEpisode('t', '시험', Object.keys(rows), rows, res).scene.lines; })()`);
    assert.ok(ep.includes(r.lines[1]), ep.join('\n'));
    assert.ok(!ep.some(l => /잊지 말아야 할 단어/.test(l)), ep.join('\n'));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI ★ checks: when a line is skipped and the rest renumbered, an answer that fits another line is not put on this word but moved to the line it belongs to; repeating a few words of the line before (as the prompt asks) is still fine', async () => {
  const p = bootPage();
  try {
    // 2번 줄을 빼먹고 나머지를 1씩 당겨 썼어요
    const r = await starRun(p, '1. 용의 그림자가 비치자, 꼬마 공주는 ★.\n'
      + '2. 배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 ★.\n'
      + '3. 공주를 지키려고 레오는 ★ 얼굴로 성문 앞에 섰어요.\n'
      + '4. 용이 좋아하는 간식을 알아보려고 공주는 마을에서 ★를 했어요.\n'
      + '5. 레오가 지쳐 보이자, 공주는 레오의 어깨를 두드리며 ★.');
    const before = JSON.parse(STAR_RES).lines;
    assert.deepEqual(r.lines.slice(1, 7), [
      '용의 그림자가 비치자, 꼬마 공주는 {anxious|불안했어요}.',
      before[2],
      '배가 부른 용은 다 먹은 사탕 껍질을 아무 데나 {abandon|버렸어요}.',
      '공주를 지키려고 레오는 {brave|용감한} 얼굴로 성문 앞에 섰어요.',
      '용이 좋아하는 간식을 알아보려고 공주는 마을에서 {survey|설문 조사}를 했어요.',
      '레오가 지쳐 보이자, 공주는 레오의 어깨를 두드리며 {encourage|격려했어요}.'
    ]);
    assert.deepEqual(r.diag.why, ['1. anxious: 씀', '2. borrow: 다른 줄 답 같음', '3. abandon: 씀 (2번 답을 옮겨 씀)', '4. brave: 씀 (3번 답을 옮겨 씀)', '5. survey: 씀 (4번 답을 옮겨 씀)', '6. encourage: 씀 (5번 답을 옮겨 씀)']);
    // 낱말 하나뿐인 줄('레오는 누구보다 ★'): ★ 바로 앞 낱말이 같으면 그 줄의 답이에요
    const rows = JSON.stringify(Object.fromEntries([['borrow', '빌리다'], ['brave', '용감한'], ['wait', '기다리다']].map(([en, ko]) => [en, { en, ko, pos: 'x' }])));
    const res = JSON.stringify({ lines: ['옛날 옛적 하늘 성에 기사 레오가 살았어요.', '먼저 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.', '레오는 누구보다 {brave|용감했어요}.', '레오는 성 축제를 손꼽아 {wait|기다렸어요}.', '레오와 용은 친구가 됐답니다.'] });
    const fit = (k, t) => p.json(`(() => { const q = aiReq(${res}, ${rows}, 0); const r = aiFit(aiClean(${JSON.stringify(t)}), q.items[${k}], q.f, q); return r.line || r.why + (r.to != null ? ' → ' + (r.to + 1) : ''); })()`);
    assert.equal(fit(0, '용이 나타나도 물러서지 않았으니, 레오는 누구보다 ★.'), '다른 줄 답 같음 → 2');
    assert.equal(fit(1, '축제에서 방패 솜씨를 뽐내고 싶어서 레오는 성 축제를 손꼽아 ★.'), '다른 줄 답 같음 → 3');
    // 앞 줄 일을 까닭으로 되풀이해 이어 쓴 줄, 이야기 곳곳에 나오는 낱말 하나만 겹친 줄은 괜찮아요
    assert.equal(fit(1, '도서관에서 두꺼운 지도책을 빌려 다 읽은 레오는 누구보다 ★.'), '도서관에서 두꺼운 지도책을 빌려 다 읽은 레오는 누구보다 {brave|용감했어요}.');
    assert.equal(fit(2, '용이 무섭지 않게 된 레오는 누구보다 신이 나서 성 축제를 손꼽아 ★.'), '용이 무섭지 않게 된 레오는 누구보다 신이 나서 성 축제를 손꼽아 {wait|기다렸어요}.');
    assert.equal(fit(0, '성 축제가 다가오자 레오는 도서관에서 두꺼운 지도책을 ★.'), '성 축제가 다가오자 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI ★ checks: a noun ★ must be followed by a particle or a word (not end the sentence or shine like a star), a meaning that ends in 의 may keep 의 after ★, words only from the worked example are refused, and a one-syllable meaning comes with its other sense', async () => {
  const p = bootPage();
  try {
    const fit = (k, t, more) => p.json(`(() => { const q = aiReq(${STAR_RES}, ${STAR_ROWS}, 0); ${more || ''}; const r = aiFit(aiClean(${JSON.stringify(t)}), q.items[${k}], q.f, q); return r.line || r.why; })()`);
    // 이름씨(설문 조사)
    assert.equal(fit(4, '해가 지자 공주는 마을에서 드디어 ★.'), '★ 자리가 문장과 안 맞음');
    assert.equal(fit(4, '공주의 눈이 마을 하늘의 ★처럼 반짝였어요.'), '★ 자리가 문장과 안 맞음');
    assert.equal(fit(4, '공주는 ★, 그것부터 마을에서 시작했어요.'), '★ 자리가 문장과 안 맞음');
    assert.equal(fit(4, '용이 좋아하는 간식을 알아보려고 공주는 마을에서 ★를 했어요.'), '용이 좋아하는 간식을 알아보려고 공주는 마을에서 {survey|설문 조사}를 했어요.');
    assert.equal(fit(4, '공주는 마을에서 ★ 결과를 꼼꼼히 정리했어요.'), '공주는 마을에서 {survey|설문 조사} 결과를 꼼꼼히 정리했어요.');
    // 예시에만 나오는 말(아기 곰·엄마가 손을 흔들자·강 건너·높은 다리)은 예시를 따라 쓴 거예요. 앱 이야기에도 있으면 괜찮아요
    assert.equal(fit(0, '강 건너에서 엄마가 손을 흔들자, 꼬마 공주는 ★.'), '예시를 따라 씀');
    assert.equal(fit(1, '아기 곰이 손을 흔들자, 레오는 도서관에서 두꺼운 지도책을 ★.'), '예시를 따라 씀');
    assert.equal(fit(1, '강 건너 마을로 가려고 레오는 도서관에서 두꺼운 지도책을 ★.', 'q.text += "\\n레오는 강 건너 마을을 바라봤어요."'), '강 건너 마을로 가려고 레오는 도서관에서 두꺼운 지도책을 {borrow|빌렸어요}.');
    // '-의' 뜻(고대의): ★ 자리는 '고대', AI가 붙인 '의'는 표시 밖에 그대로. '-의' 뜻이 아니면('용감한') '★의'는 안 돼요
    const rows = JSON.stringify({ ancient: { en: 'ancient', ko: '고대의', pos: 'x' }, amount: { en: 'amount', ko: '양, 액수', pos: 'x' } });
    const res = JSON.stringify({ lines: ['옛날 옛적 하늘 성에 기사 레오가 살았어요.', '레오는 동굴 깊은 곳에서 {ancient|고대} 지도를 발견했어요.', '레오는 그제야 {amount|양}이 왜 중요한지 깨달았어요.'] });
    const q = p.json(`(() => { const q = aiReq(${res}, ${rows}, 0); return { ok: aiFit('횃불을 비추자, 레오는 동굴 깊은 곳에서 ★의 지도를 발견했어요.', q.items[0], q.f, q), bare: aiFit('횃불을 비추자, 레오는 동굴 깊은 곳에서 ★ 지도를 발견했어요.', q.items[0], q.f, q), prompt: q.prompt }; })()`);
    assert.deepEqual(q.ok, { line: '횃불을 비추자, 레오는 동굴 깊은 곳에서 {ancient|고대}의 지도를 발견했어요.' });
    assert.deepEqual(q.bare, { line: '횃불을 비추자, 레오는 동굴 깊은 곳에서 {ancient|고대} 지도를 발견했어요.' });
    assert.equal(fit(3, '공주를 지키려고 레오는 ★의 얼굴로 섰어요.'), '★ 자리가 문장과 안 맞음');
    // 한 글자 뜻('양')은 다른 뜻을 덧붙여 알려 줘요 ('하얀 양 떼'로 읽지 않게). 두 글자 넘는 뜻은 그대로
    assert.ok(q.prompt.split('\n').includes('2. 레오는 그제야 ★이 왜 중요한지 깨달았어요. (★ = 양, 액수와 같은 뜻)'), q.prompt);
    assert.ok(q.prompt.split('\n').includes('1. 레오는 동굴 깊은 곳에서 ★ 지도를 발견했어요. (★ = 고대)'), q.prompt);
    assert.deepEqual(p.errors, []);
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

/* ---------- 그래픽 칩 소식과 AI 진단 ---------- */
// 가짜 BroadcastChannel: AI 일꾼(llm/gpu-watch.js)이 그래픽 칩 소식을 보내는 것처럼. __gpuSend(소식, 일꾼 이름)은 이름이 없으면 이 화면이 마지막에 띄운 일꾼 이름을 붙여요
const CHAN = `(() => {
  window.__chans = [];
  window.BroadcastChannel = class { constructor(n) { this.name = n; this.onmessage = null; __chans.push(this); } postMessage() {} close() {} };
  window.__gpuSend = (d, w) => { const name = w || [...AI.wnames].pop(); for (const c of __chans) if (c.name === 'wg-ai-gpu' && c.onmessage) c.onmessage({ data: Object.assign({ w: name, ms: 1234 }, d) }); };
  window.__gpuDev = () => {
    __gpuSend({ kind: 'adapter', info: { vendor: 'qualcomm', architecture: 'adreno-8xx', device: '', description: 'Adreno (TM) 830' }, limits: { maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824, maxComputeWorkgroupStorageSize: 32768, maxComputeInvocationsPerWorkgroup: 1024 }, feats: { 'shader-f16': true, subgroups: true, 'timestamp-query': false } });
    __gpuSend({ kind: 'device', n: 1, want: { maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824, maxComputeWorkgroupStorageSize: 32768, maxComputeInvocationsPerWorkgroup: 1024 }, feats: ['shader-f16', 'subgroups'] });
  };
})()`;
// 가짜 WebLLM (진단용): 엔진을 만들면 그래픽 칩 정보를 보내요. 요청마다 읽은 토큰(글자 수 × 2 + 8)을 지금 조각 크기로 나눠 읽는 것처럼
// 조각마다 걸린 시간(조각 크기 × __msPerTok ms)을 일꾼처럼 보내고, max_tokens만큼 조금씩 쓰고 사용량(초당 토큰)을 알려요.
// 조각 크기: 엔진을 만들 때의 모델 설정(overrides.wg_prefill_chunk, 없으면 512), 그 뒤로는 일꾼에게 보낸 { wgPrefillChunk } (진짜 worker.js처럼 512보다 작을 때만)
//  'ok' 늘 성공, 'lost-long' 긴 글(600자 넘음)을 읽다가 그래픽 칩을 잃음(오류 소식은 바로, 끊김 소식은 오류보다 늦게), 'hang-long' 긴 글에서 멈춘 채 답이 없음
//  'lost-64' 64토큰 조각으로 중간 글을 읽다가 조각 하나 뒤에 그래픽 칩을 잃음, 'hang-64' 64토큰 조각으로 조각 2개를 읽고 멈춤 (그 사이 탭이 꺼지는 것처럼)
const BENCH_LIB = kind => `(() => {
  window.__workers = []; window.__reqs = []; window.__wake = []; window.__cfgs = []; window.__size = 512; window.__msPerTok = 6;
  window.Worker = class { constructor(u, o) { this.name = o && o.name; this.l = {}; this.dead = false; __workers.push(this); } addEventListener(k, f) { (this.l[k] = this.l[k] || []).push(f); } terminate() { this.dead = true; }
    postMessage(m) { if (m && 'wgPrefillChunk' in m) { const n = Math.floor(+m.wgPrefillChunk); __size = n > 0 && n < 512 ? n : 512; } } };
  const chunks = (tokens, upto) => { const n = Math.ceil(tokens / __size); for (let i = 0; i < Math.min(n, upto == null ? n : upto); i++) __gpuSend({ kind: 'chunk', took: __size * __msPerTok, tokens: Math.min(__size, tokens - i * __size), size: __size, i, of: n }); };
  const K = ${JSON.stringify(kind)};
  const eng = { interruptGenerate() {}, chat: { completions: { create: async req => {
    const text = req.messages[0].content, len = text.length, tokens = Math.round(len * 2 + 8);
    __reqs.push({ text, len, max: req.max_tokens, ignore: req.ignore_eos, stream: req.stream, t: req.temperature, size: __size }); __wake.push(WAKE.tags.has('bench'));
    if (K === 'hang-long' && len > 600) { __gpuSend({ kind: 'console', level: 'warn', msg: 'slow shader compile' }); return new Promise(() => {}); }
    if (K === 'hang-64' && __size === 64 && len > 100) { chunks(tokens, 2); return new Promise(() => {}); }
    if ((K === 'lost-long' && len > 600) || (K === 'lost-64' && __size === 64 && len > 100)) {
      if (K === 'lost-64') chunks(tokens, 1);
      __gpuSend({ kind: 'error', n: 1, type: 'GPUOutOfMemoryError', msg: 'Not enough memory left.' });
      __gpuSend({ kind: 'destroy', n: 1, by: 'tryCreateBuffer web-llm.js:4880 < alloc web-llm.js:9000' });
      setTimeout(() => __gpuSend({ kind: 'lost', n: 1, reason: 'unknown', msg: 'Device lost: the GPU process was killed.' }), 60);
      throw new DOMException("Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved.", 'AbortError');
    }
    chunks(tokens);
    return (async function* () {
      for (let i = 0; i < req.max_tokens; i++) yield { choices: [{ delta: { content: '가' } }] };
      yield { choices: [], usage: { prompt_tokens: tokens, completion_tokens: req.max_tokens, extra: { prefill_tokens_per_s: 150.5, decode_tokens_per_s: 12.4 } } };
    })();
  } } } };
  AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: (w, id, cfg) => new Promise(ok => setTimeout(() => {
    __cfgs.push(cfg);
    const o = (cfg.appConfig && cfg.appConfig.model_list[0].overrides) || {};
    __size = o.wg_prefill_chunk > 0 && o.wg_prefill_chunk < 512 ? o.wg_prefill_chunk : 512;
    __gpuDev(); cfg.initProgressCallback({ progress: 1, text: 'Loading model from cache[20/20]' }); ok(eng);
  }, 5)) };
  AI.gpu = true; AI.retryMs = 0;
})()`;
const benchOpen = p => { p.run(`MK.step = 'pick'; MK.aiWhy = ''; MK.offline = 'no'; showScreen('make'); renderMake();`); return p.document.getElementById('mkai'); };
const benchOut = p => (p.document.getElementById('mkbenchout') || {}).textContent || '';
// 휴대폰처럼: 안드로이드 크롬, 그래픽 칩 이름 (bootPage의 before 코드로 게임보다 먼저)
const ANDROID = `Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Linux; Android 15; SM-S931N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36' });`;
const GPU_INFO = info => `Object.defineProperty(navigator, 'gpu', { configurable: true, value: { requestAdapter: async () => ({ info: ${JSON.stringify(info)}, features: new Set(['shader-f16']), limits: { maxStorageBufferBindingSize: 1073741824 } }) } });`;
const ADRENO = { vendor: 'qualcomm', architecture: 'adreno-8xx', device: '', description: 'Adreno (TM) 830' };
const ADRENO_KEY = 'gemma-4-E2B-it-q4f16_1-MLC · qualcomm / adreno-8xx / Adreno (TM) 830';
const READY = { 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' };
const chunkRec = p => JSON.parse(p.window.localStorage.getItem('wg-ai-chunk') || '{}');
const SWEEP = [16, 32, 64, 128].map((n, i) => `${i + 4} 중간 글 ${n}토큰씩 읽기`);
const benchRun = async (p, done = /결과: / ) => { benchOpen(p).querySelector('[data-mk="bench"]').click(); await until(() => done.test(benchOut(p)) && !/하는 중이에요/.test(benchOut(p)), 5000); return benchOut(p); };

test('AI chunk size: phones read prompts in 32-token chunks through the model config, computers keep the compiled 512', async () => {
  // 안드로이드 크롬: 모델 설정에 32토큰 조각이 들어가요
  for (const [name, before] of [['android', ANDROID], ['adreno', GPU_INFO(ADRENO)], ['mali', GPU_INFO({ vendor: 'arm', architecture: 'valhall', device: '', description: 'Mali-G715' })]]) {
    const p = bootPage(READY, before);
    try {
      p.run(CHAN); p.run(BENCH_LIB('ok'));
      await p.run('aiLoad()');
      assert.equal(p.json('__cfgs[0].appConfig.model_list[0].overrides.wg_prefill_chunk'), 32, name);
      assert.equal(p.json('__cfgs[0].appConfig.model_list[0].overrides.context_window_size'), 4096);
      assert.deepEqual([p.json('AI.chunk'), p.json('aiChunkPick()'), p.json('__size')], [32, 32, 32], name);
    } finally { p.close(); }
  }
  // 컴퓨터(엔비디아 그래픽 칩): 설정에 넣지 않고 모델이 만들어진 512토큰 그대로
  const q = bootPage(READY, GPU_INFO({ vendor: 'nvidia', architecture: 'ampere', device: '', description: '' }));
  try {
    q.run(CHAN); q.run(BENCH_LIB('ok'));
    await q.run('aiLoad()');
    assert.equal(q.json('"wg_prefill_chunk" in __cfgs[0].appConfig.model_list[0].overrides'), false);
    assert.deepEqual([q.json('AI.chunk'), q.json('aiChunkPick()'), q.json('__size'), q.json('aiIsPhone()')], [512, 512, 512, false]);
  } finally { q.close(); }
});

test('AI diagnosis: warm-up, short prompt, the same middle prompt in 16/32/64/128-token chunks, then the real request and the long write with the safe size', async () => {
  const p = bootPage(READY, ANDROID + GPU_INFO(ADRENO));
  try {
    p.run(CHAN); p.run(BENCH_LIB('ok'));
    // 다른 탭의 일꾼 소식은 받지 않아요
    p.run('aiGpuListen(); __gpuSend({ kind: "lost", reason: "unknown", msg: "other tab" }, "wg-ai-someone-else")');
    const box = benchOpen(p);
    const btn = box.querySelector('[data-mk="bench"]');
    assert.equal(btn.textContent, 'AI 진단 (3~6분)');
    assert.match(box.textContent, /그래픽 칩이 어느 단계에서 멈추는지.*안전한 조각 크기를 찾아요.*이 휴대폰에만 남고 어디로도 보내지 않아요/);
    const out = await benchRun(p), L = out.split('\n');
    assert.match(L[0], /^AI 진단 · gemma-4-E2B-it-q4f16_1-MLC · \d{4}-\d\d-\d\d \d\d:\d\d · Android 15 · Chrome 155\.0\.0\.0/);
    assert.ok(L.includes('AI 일꾼의 그래픽 칩: qualcomm / adreno-8xx / Adreno (TM) 830 | 한도: maxBufferSize 1024MB · maxStorageBufferBindingSize 1024MB · maxComputeWorkgroupStorageSize 32KB · maxComputeInvocationsPerWorkgroup 1024 | 기능: shader-f16 있음 · subgroups 있음 · timestamp-query 없음 | WebLLM이 부탁한 한도: maxBufferSize 1024MB · maxStorageBufferBindingSize 1024MB · maxComputeWorkgroupStorageSize 32KB · maxComputeInvocationsPerWorkgroup 1024'), out);
    assert.match(out, /^1 저장소에서 불러오기: ok \(성공\) · \d+\.\d초$/m);
    // 휴대폰은 처음부터 32토큰씩 읽어요. 조각 크기 재기는 조각 수와 가장 오래 걸린 조각(크기 × 6ms)을 적어요
    const line = (lab, size, n, tail = '') => new RegExp(`^${lab.replace(/[()]/g, '\\$&')}: ok \\(성공\\) · \\d+\\.\\d초${size ? ` · 조각 ${size}토큰` : ''} · 조각 \\d+개 · 조각 최대 ${n}ms · 읽은 토큰 \\d+ · 쓴 토큰 \\d+ · 첫 글자까지 \\d+\\.\\d초 · 읽기 150\\.5토큰/초 · 쓰기 12\\.4토큰/초${tail}$`, 'm');
    assert.match(out, line('2 그래픽 준비(처음 한 번)', 32, 192));
    assert.match(out, line('3 짧은 글 읽기', 32, 192));
    [16, 32, 64, 128].forEach((n, i) => assert.match(out, line(SWEEP[i], 0, n * 6), out));
    assert.match(out, line('8 긴 글 읽기(실제 크기)', 128, 768));
    assert.match(out, line('9 길게 쓰기', 128, 768));
    assert.equal(L[L.length - 2], '이 기기의 안전한 조각 크기: 128토큰 (이야기를 만들 때 이 크기로 나눠 읽어요)');
    assert.equal(L[L.length - 1], '결과: 모든 단계를 마쳤어요.');
    assert.doesNotMatch(out, /other tab/);
    // 요청: 짧은 인사 → 짧은 글 → 같은 중간 글을 16·32·64·128토큰씩 → 실제 에피소드 요청 글 → 짧은 글로 길게, 정해 둔 토큰 수만큼 끝까지
    const reqs = p.json('__reqs');
    assert.deepEqual(reqs.map(r => [r.max, r.ignore, r.stream, r.t, r.size]), [[4, true, true, 0.7, 32], [16, true, true, 0.7, 32], [4, true, true, 0.7, 16], [4, true, true, 0.7, 32], [4, true, true, 0.7, 64], [4, true, true, 0.7, 128], [16, true, true, 0.7, 128], [300, true, true, 0.7, 128]]);
    assert.ok(reqs[0].len < reqs[1].len && reqs[1].len < reqs[2].len && reqs[2].len < reqs[6].len, reqs.map(r => r.len).join());
    assert.ok([3, 4, 5].every(i => reqs[i].text === reqs[2].text), '조각 크기만 바꿔 같은 글을 읽어요');
    assert.ok(reqs[2].len * 2 + 8 < 512 && reqs[6].len * 2 + 8 > 1024, '중간 글은 한 조각(512) 안, 실제 요청은 여러 조각');
    assert.equal(reqs[6].text, p.json(`(() => { const rows = Object.create(null); for (const [en, ko] of AI_BENCH_WORDS) rows[en] = { en, ko, pos: 'x' }; return aiPrompt(aiReq(mkStory(AI_BENCH_WORDS.map(w => w[0]), rows, 0), rows, 0).story); })()`));
    assert.equal(reqs[7].text, reqs[1].text);
    // 이 기기(모델 + 그래픽 칩)의 안전한 크기로 남아요
    assert.deepEqual(chunkRec(p)[ADRENO_KEY].safe, 128);
    assert.deepEqual(chunkRec(p)[ADRENO_KEY].bad, []);
    // 진단하는 동안 화면을 켜 두고, 끝나면 풀어요. 결과는 이 기기에 남아요
    assert.deepEqual(p.json('__wake'), [true, true, true, true, true, true, true, true]);
    assert.equal(p.json('WAKE.tags.size'), 0);
    assert.equal(JSON.parse(p.window.localStorage.getItem('wg-ai-bench')).state, 'done');
    assert.equal(p.json('!!AI.engine'), true, '다 되면 엔진은 그대로 써요');
    // 결과 복사: 클립보드에, 안 되면 글을 골라 둬요
    p.run('window.__copied = null; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async t => { __copied = t; } } })');
    p.document.querySelector('#mkai [data-mk="benchcopy"]').click();
    await until(() => p.json('__copied') != null);
    assert.equal(p.json('__copied'), out);
    p.run('Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } })');
    p.document.querySelector('#mkai [data-mk="benchcopy"]').click();
    await until(() => /복사하지 못했어요/.test((p.document.querySelector('.toast') || {}).textContent || ''));
    assert.match(p.document.querySelector('.toast').textContent, /길게 눌러 복사/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI diagnosis: a chunk slower than 1.2 seconds stops the sweep from going larger; the largest size under 1 second is saved', async () => {
  const p = bootPage(READY, ANDROID + GPU_INFO(ADRENO));
  try {
    // 조각 크기 × 10ms: 64토큰 640ms(안전), 128토큰 1280ms(한계에 가까움)
    p.run(CHAN); p.run(BENCH_LIB('ok')); p.run('__msPerTok = 10');
    const out = await benchRun(p);
    assert.match(out, /^6 중간 글 64토큰씩 읽기: ok \(성공\) · .*조각 최대 640ms/m);
    assert.match(out, /^7 중간 글 128토큰씩 읽기: ok \(성공\) · .*조각 최대 1280ms · .* · 조각 하나가 1\.2초를 넘어서 그래픽 칩 한계에 가까워요$/m);
    assert.match(out, /^8 긴 글 읽기\(실제 크기\): ok \(성공\) · \d+\.\d초 · 조각 64토큰 · /m);
    assert.match(out, /^이 기기의 안전한 조각 크기: 64토큰/m);
    assert.deepEqual([chunkRec(p)[ADRENO_KEY].safe, chunkRec(p)[ADRENO_KEY].bad], [64, [128]]);
    assert.deepEqual(p.json('__reqs.map(r => r.size)'), [32, 32, 16, 32, 64, 128, 64, 64]);
    // 다시 진단하면 한계에 가까웠던 크기는 건너뛰어요
    p.run('__reqs.length = 0');
    const again = await benchRun(p, /결과: 모든 단계를 마쳤어요/);
    assert.match(again, /^7 중간 글 128토큰씩 읽기: 건너뜀 · 전에 이 크기가 안 돼서 건너뛰었어요$/m);
    assert.deepEqual(p.json('__reqs.map(r => r.size)'), [64, 64, 16, 32, 64, 64, 64], '불러올 때부터 찾아 둔 64토큰으로 읽어요');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI diagnosis: the sweep stops at the first size that loses the GPU, does not reuse that engine, and the next deck reads with the largest safe size', async () => {
  const p = bootPage(READY, ANDROID + GPU_INFO(ADRENO));
  try {
    p.run(CHAN); p.run(BENCH_LIB('lost-64'));
    const out = await benchRun(p, /결과: 6단계에서 멈췄어요/);
    assert.match(out, /^5 중간 글 32토큰씩 읽기: ok \(성공\)/m);
    assert.match(out, /^6 중간 글 64토큰씩 읽기: fail \(실패\) · \d+\.\d초 · 조각 1개 · 조각 최대 384ms · 읽을 토큰 약 \d+\(어림\) · 쓴 토큰 0 · 64토큰 조각은 이제 쓰지 않아요 · 오류: AbortError: Failed to execute 'mapAsync'/m);
    assert.match(out, /^ {3}- GPU 끊김 까닭: unknown \/ Device lost: the GPU process was killed\. \(일꾼 1\.2초\)$/m);
    for (const lab of ['7 중간 글 128토큰씩 읽기', '8 긴 글 읽기(실제 크기)', '9 길게 쓰기']) assert.ok(out.split('\n').includes(`${lab}: 안 함`), out);
    assert.match(out, /^이 기기의 안전한 조각 크기: 32토큰/m);
    assert.equal(p.json('__reqs.length'), 5, '실패한 뒤에는 더 묻지 않아요');
    assert.equal(p.json('!!AI.engine'), false, '잃은 엔진은 버려요');
    assert.deepEqual(p.json('__workers.map(w => w.dead)'), [true]);
    assert.deepEqual([chunkRec(p)[ADRENO_KEY].safe, chunkRec(p)[ADRENO_KEY].bad], [32, [64]]);
    // 다음 단어장: 새 엔진을 안전한 크기(32토큰)로 불러와 쓰고, 'AI가 쓴 글 보기'에 조각 크기와 가장 오래 걸린 조각이 나와요
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    assert.equal(p.json('__cfgs[1].appConfig.model_list[0].overrides.wg_prefill_chunk'), 32);
    assert.equal(p.json('__reqs[5].size'), 32);
    const a = p.json('({ step: MK.step, diag: MK.aiDiag })');
    assert.equal(a.step, 'done');
    assert.match(a.diag[0].info, /^걸린 시간 \d+\.\d초 · 이야기 읽기 \d+\.\d초 · 읽은 토큰 \d+개 · 쓴 토큰 \d+개 · 읽기 조각 32토큰 · 조각 \d+개 · 조각 최대 192ms$/);
    assert.match(p.document.querySelector('#make .mkdiag').textContent, /읽기 조각 32토큰 · 조각 \d+개 · 조각 최대 192ms/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI diagnosis: a GPU lost event sent over the channel during the long prompt is recorded with its reason and message, and the bench stops there', async () => {
  const p = bootPage(READY);
  try {
    p.run(CHAN); p.run(BENCH_LIB('lost-long'));
    const out = await benchRun(p, /결과: 8단계에서 멈췄어요/);
    assert.match(out, /^7 중간 글 128토큰씩 읽기: ok \(성공\)/m);
    assert.match(out, /^8 긴 글 읽기\(실제 크기\): fail \(실패\) · \d+\.\d초 · 조각 128토큰 · 읽을 토큰 약 \d+\(어림\) · 쓴 토큰 0 · 128토큰 조각은 이제 쓰지 않아요 · 오류: AbortError: Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped before mapping was resolved\.$/m);
    // 그래픽 칩이 알려 준 까닭: 끊김 소식이 오류보다 늦게 와도 그 단계에 붙어요
    assert.match(out, /^ {3}- GPU 오류: GPUOutOfMemoryError \/ Not enough memory left\. \(일꾼 1\.2초\)$/m);
    assert.match(out, /^ {3}- GPU 장치를 닫음\(device\.destroy\): tryCreateBuffer web-llm\.js:4880 < alloc web-llm\.js:9000/m);
    assert.match(out, /^ {3}- GPU 끊김 까닭: unknown \/ Device lost: the GPU process was killed\. \(일꾼 1\.2초\)$/m);
    assert.match(out, /^9 길게 쓰기: 안 함$/m);
    assert.equal(p.json('__reqs.length'), 7, '실패한 뒤에는 더 묻지 않아요');
    assert.equal(p.json('!!AI.engine'), false, '잃은 엔진은 버려요');
    assert.deepEqual(p.json('__workers.map(w => w.dead)'), [true]);
    const saved = JSON.parse(p.window.localStorage.getItem('wg-ai-bench'));
    assert.equal(saved.state, 'fail');
    assert.equal(saved.stages[7].gpu.length, 3);
    // 그래픽 칩을 잃은 크기는 쓰지 않아요: 다음에는 64토큰
    assert.equal(p.json('aiChunkPick()'), 64);
    assert.equal(p.json('WAKE.tags.size'), 0);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI diagnosis: if the tab dies during a stage, the next load shows the partial result with that stage as crashed', async () => {
  const p = bootPage(READY);
  let store;
  try {
    p.run(CHAN); p.run(BENCH_LIB('hang-long'));
    benchOpen(p).querySelector('[data-mk="bench"]').click();
    const saved = () => JSON.parse(p.window.localStorage.getItem('wg-ai-bench') || 'null');
    await until(() => { const b = saved(); return b && b.stages[7].state === 'run' && (b.stages[7].gpu || []).length === 1; });
    assert.match(benchOut(p), /^8 긴 글 읽기\(실제 크기\): 하는 중 · \d+\.\d초째/m);
    assert.ok(p.document.querySelector('#mkai [data-mk="benchstop"]'), '진단 그만두기 단추');
    // 진단 중에는 단어장 만들기를 미뤄요
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.step = 'review'; renderMake();`);
    p.document.querySelector('#make [data-mk="make"]').click();
    assert.equal(p.json('MK.step'), 'review');
    assert.match(p.document.querySelector('.toast').textContent, /AI 진단 중이에요/);
    store = p.storage(); // 이때 탭이 꺼졌다고 쳐요
    // (이 시험 화면은 그만두기로 끝내요)
    p.document.querySelector('#mkai [data-mk="benchstop"]').click();
    await until(() => saved().state === 'stop');
    assert.match(benchOut(p), /^8 긴 글 읽기\(실제 크기\): 그만둠/m);
    assert.match(benchOut(p), /결과: 중간에 그만뒀어요\.$/);
  } finally { p.close(); }
  // 탭이 꺼진 뒤 다시 열어요
  const q = bootPage(store);
  try {
    await until(() => /AI 진단 중에 탭이 꺼졌어요/.test((q.document.querySelector('.toast') || {}).textContent || ''), 4000);
    assert.match(q.document.querySelector('.toast').textContent, /새 단어장 만들기 화면에서 결과를 볼 수 있어요/);
    benchOpen(q);
    const out = benchOut(q);
    assert.match(out, /^1 저장소에서 불러오기: ok \(성공\)/m);
    assert.match(out, /^7 중간 글 128토큰씩 읽기: ok \(성공\)/m);
    assert.match(out, /^8 긴 글 읽기\(실제 크기\): crashed \(탭 꺼짐\) · \d+\.\d초 뒤 꺼짐 · 조각 128토큰/m);
    assert.match(out, /^ {3}- 일꾼 경고 글: slow shader compile/m);
    assert.match(out, /^9 길게 쓰기: 안 함$/m);
    assert.match(out, /결과: 8단계에서 멈췄어요 \(진단 중에 탭이 꺼졌어요\)\.$/);
    assert.equal(q.document.querySelector('#mkai [data-mk="bench"]').disabled, false, '다시 진단할 수 있어요');
    assert.equal(JSON.parse(q.window.localStorage.getItem('wg-ai-bench')).state, 'crash');
    store = q.storage();
  } finally { q.close(); }
  // 한 번만 알려요
  const r = bootPage(store);
  try {
    await new Promise(ok => setTimeout(ok, 1500));
    assert.ok(!/AI 진단 중에 탭이 꺼졌어요/.test((r.document.querySelector('.toast') || {}).textContent || ''));
    assert.match(benchOut(benchOpen(r) && r), /crashed \(탭 꺼짐\)/);
  } finally { r.close(); }
});

test('AI diagnosis: a tab that dies while reading in 64-token chunks keeps that size as running in the saved result; the next run and the next deck do not use it', async () => {
  const p = bootPage(READY, ANDROID + GPU_INFO(ADRENO));
  let store;
  try {
    p.run(CHAN); p.run(BENCH_LIB('hang-64'));
    benchOpen(p).querySelector('[data-mk="bench"]').click();
    const saved = () => JSON.parse(p.window.localStorage.getItem('wg-ai-bench') || 'null');
    await until(() => { const b = saved(); return b && b.stages[5].state === 'run' && b.stages[5].cn === 2; });
    assert.match(benchOut(p), /^6 중간 글 64토큰씩 읽기: 하는 중 · \d+\.\d초째 · 조각 2개 · 조각 최대 384ms/m);
    store = p.storage(); // 이때 탭이 꺼졌다고 쳐요
    assert.equal(JSON.parse(store['wg-ai-chunk'])[ADRENO_KEY].safe, 32, '32토큰까지는 이미 안전한 크기로 남아 있어요');
    p.document.querySelector('#mkai [data-mk="benchstop"]').click();
    await until(() => saved().state === 'stop');
  } finally { p.close(); }
  const q = bootPage(store, ANDROID + GPU_INFO(ADRENO));
  try {
    benchOpen(q);
    const out = benchOut(q);
    assert.match(out, /^6 중간 글 64토큰씩 읽기: crashed \(탭 꺼짐\) · \d+\.\d초 뒤 꺼짐 · 조각 2개 · 조각 최대 384ms · 읽을 토큰 약 \d+\(어림\) · 쓴 토큰 0 · 64토큰 조각은 이제 쓰지 않아요$/m);
    assert.match(out, /^이 기기의 안전한 조각 크기: 32토큰/m);
    assert.match(out, /결과: 6단계에서 멈췄어요 \(진단 중에 탭이 꺼졌어요\)\.$/);
    assert.deepEqual([chunkRec(q)[ADRENO_KEY].safe, chunkRec(q)[ADRENO_KEY].bad], [32, [64]]);
    await q.run('aiGpuInfo()');
    assert.equal(q.json('aiChunkPick()'), 32);
    // 다시 진단: 64토큰과 그보다 큰 크기는 건너뛰고, 실제 요청과 길게 쓰기는 32토큰으로
    q.run(CHAN); q.run(BENCH_LIB('hang-64'));
    const again = await benchRun(q, /결과: 모든 단계를 마쳤어요/);
    assert.match(again, /^6 중간 글 64토큰씩 읽기: 건너뜀 · 전에 이 크기가 안 돼서 건너뛰었어요$/m);
    assert.match(again, /^7 중간 글 128토큰씩 읽기: 건너뜀 · 전에 64토큰 조각이 안 돼서 건너뛰었어요$/m);
    assert.match(again, /^8 긴 글 읽기\(실제 크기\): ok \(성공\) · \d+\.\d초 · 조각 32토큰 · /m);
    assert.deepEqual(q.json('__reqs.map(r => r.size)'), [32, 32, 16, 32, 32, 32]);
    assert.deepEqual(q.errors, []);
  } finally { q.close(); }
});

test('AI story: the make flow reads with the saved safe size, and an engine already loaded with another size is switched before writing', async () => {
  const store = Object.assign({ 'wg-ai-chunk': { [ADRENO_KEY]: { safe: 64, bad: [128], at: 1 } } }, READY);
  const p = bootPage(store, ANDROID + GPU_INFO(ADRENO));
  try {
    p.run(CHAN); p.run(BENCH_LIB('ok'));
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    assert.equal(p.json('__cfgs[0].appConfig.model_list[0].overrides.wg_prefill_chunk'), 64);
    assert.deepEqual(p.json('__reqs.map(r => r.size)'), [64]);
    assert.match(p.json('MK.aiDiag[0].info'), /· 읽기 조각 64토큰 · 조각 \d+개 · 조각 최대 384ms$/);
    // 진단이 다른 크기(32토큰)를 찾았어요: 올라와 있는 AI도 다음 글부터 그 크기로
    p.run(`localStorage.setItem('wg-ai-chunk', JSON.stringify({ ${JSON.stringify(ADRENO_KEY)}: { safe: 32, bad: [64], at: 2 } }))`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; MK.step = 'review';`);
    await p.run('mkMake()');
    assert.equal(p.json('__cfgs.length'), 1, '엔진은 다시 불러오지 않아요');
    assert.deepEqual(p.json('__reqs.map(r => r.size)'), [64, 32]);
    assert.match(p.json('MK.aiDiag[0].info'), /· 읽기 조각 32토큰 · 조각 \d+개 · 조각 최대 192ms$/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI story: GPU events sent by the AI worker show in the make diagnostics (reason and message of the loss, error type and message)', async () => {
  const p = bootPage({ 'wg-ai-ready': 'gemma-4-E2B-it-q4f16_1-MLC' });
  try {
    p.run(CHAN);
    p.run(ENGINES_LIB(['lost-stream', 'write']));
    // 첫 엔진이 쓰기 시작하면: 그래픽 칩 정보, 메모리 오류, 콘솔 오류 글이 오고, 끊김 소식은 오류보다 조금 늦게 와요
    p.run(`__onCall = n => { if (n) return; __gpuDev(); __gpuSend({ kind: 'error', type: 'GPUOutOfMemoryError', msg: 'Not enough memory left.' }); __gpuSend({ kind: 'console', level: 'error', msg: 'Device lost, calling Instance.dispose().' }); setTimeout(() => __gpuSend({ kind: 'lost', reason: 'unknown', msg: 'Device lost (GPU process gone)' }), 40); };`);
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false; showScreen('make');`);
    await p.run('mkMake()');
    const a = p.json('({ step: MK.step, diag: MK.aiDiag, env: MK.aiEnv })');
    assert.equal(a.step, 'done');
    assert.deepEqual(a.diag[0].gpu, [
      'GPU 오류: GPUOutOfMemoryError / Not enough memory left. (일꾼 1.2초)',
      '일꾼 오류 글: Device lost, calling Instance.dispose(). (일꾼 1.2초)',
      'GPU 끊김 까닭: unknown / Device lost (GPU process gone) (일꾼 1.2초)'
    ]);
    assert.deepEqual(a.diag[1].gpu, [], '다시 준비한 엔진의 기록에는 앞의 소식이 없어요');
    assert.match(a.env, /(^|\n)AI 일꾼의 그래픽 칩: qualcomm \/ adreno-8xx/);
    const shown = p.document.querySelector('#make .mkdiag').textContent;
    assert.match(shown, /GPU 끊김 까닭: unknown \/ Device lost \(GPU process gone\)/);
    assert.match(shown, /GPU 오류: GPUOutOfMemoryError \/ Not enough memory left\./);
    assert.match(shown, /AI 일꾼의 그래픽 칩: qualcomm/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('AI worker GPU watch (llm/gpu-watch.js): adapter, device limits, lost reason, uncaptured errors, destroy caller and console errors go out on the channel', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const sent = [], logged = [];
  let lose, devListener = null, destroyed = 0;
  class GPUOutOfMemoryError { constructor(m) { this.message = m; } }
  class GPUValidationError { constructor(m) { this.message = m; } }
  const device = { lost: new Promise(r => { lose = r; }), addEventListener: (k, f) => { if (k === 'uncapturederror') devListener = f; }, destroy() { destroyed++; } };
  const adapter = {
    info: { vendor: 'qualcomm', architecture: 'adreno-8xx', device: '', description: 'Adreno (TM) 830' },
    limits: { maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824, maxComputeWorkgroupStorageSize: 32768, maxComputeInvocationsPerWorkgroup: 1024, maxStorageBuffersPerShaderStage: 10 },
    features: new Set(['shader-f16', 'subgroups']),
    requestDevice: async () => device
  };
  const ctx = {
    self: null, Date, Promise, Error, JSON, String, Object, Set,
    BroadcastChannel: class { constructor(n) { this.name = n; } postMessage(d) { sent.push(Object.assign({ ch: this.name }, d)); } },
    console: { error: (...a) => logged.push(a), warn: (...a) => logged.push(a), log() { } },
    navigator: { gpu: { requestAdapter: async () => adapter } }
  };
  ctx.self = { name: 'wg-ai-test', navigator: ctx.navigator, addEventListener() { } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'word-game', 'llm', 'gpu-watch.js'), 'utf8'), ctx, { filename: 'gpu-watch.js' });
  // WebLLM처럼: 어댑터 → 장치 → 버퍼를 못 만들면 장치를 닫음 → 잃음
  vm.runInContext(`globalThis.__run = async () => {
    const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const dev = await ad.requestDevice({ requiredLimits: { maxBufferSize: 1073741824, maxComputeWorkgroupStorageSize: 32768 }, requiredFeatures: ['shader-f16'] });
    function tryCreateBuffer() { dev.destroy(); }
    tryCreateBuffer();
    return dev;
  };`, ctx, { filename: 'web-llm.js' });
  const dev = await ctx.__run();
  assert.equal(dev, device);
  devListener({ error: new GPUOutOfMemoryError('Not enough memory left.') });
  ctx.console.error(new GPUValidationError('Buffer size exceeds the limit.'), 'while creating a buffer');
  ctx.console.warn('A'.repeat(1000));
  lose({ reason: 'unknown', message: 'GPU process gone' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(destroyed, 1, '원래 destroy도 불러요');
  assert.equal(logged.length, 2, '원래 console에도 찍어요');
  assert.ok(sent.every(m => m.ch === 'wg-ai-gpu' && m.w === 'wg-ai-test' && typeof m.ms === 'number'));
  // vm 안에서 만든 객체라서 JSON으로 꺼내 비교
  const by = k => JSON.parse(JSON.stringify(sent.filter(m => m.kind === k)));
  assert.deepEqual(by('adapter')[0].info, { vendor: 'qualcomm', architecture: 'adreno-8xx', device: '', description: 'Adreno (TM) 830' });
  assert.deepEqual(by('adapter')[0].feats, { 'shader-f16': true, subgroups: true, 'timestamp-query': false });
  assert.equal(by('adapter')[0].limits.maxComputeInvocationsPerWorkgroup, 1024);
  assert.deepEqual([by('device')[0].want, by('device')[0].feats], [{ maxBufferSize: 1073741824, maxComputeWorkgroupStorageSize: 32768 }, ['shader-f16']]);
  assert.match(by('destroy')[0].by, /^tryCreateBuffer web-llm\.js:\d+/);
  assert.deepEqual([by('error')[0].type, by('error')[0].msg], ['GPUOutOfMemoryError', 'Not enough memory left.']);
  assert.deepEqual(by('console').map(m => [m.level, m.msg.slice(0, 80)]), [['error', 'GPUValidationError: Buffer size exceeds the limit. while creating a buffer'], ['warn', 'A'.repeat(80)]]);
  assert.equal(by('console')[1].msg.length, 400, '긴 글은 잘라요');
  assert.deepEqual([by('lost')[0].reason, by('lost')[0].msg, by('lost')[0].n], ['unknown', 'GPU process gone', 1]);
  // 글 읽기 조각 하나가 끝남 (web-llm.js의 'word-game patch'가 불러요): 걸린 ms(반올림)·토큰 수·조각 크기·몇 번째
  ctx.self.wgPrefillChunkDone({ ms: 123.6, tokens: 32, size: 32, index: 2, count: 9 });
  const c = by('chunk')[0];
  assert.deepEqual([c.took, c.tokens, c.size, c.i, c.of, c.w], [124, 32, 32, 2, 9, 'wg-ai-test']);
});
