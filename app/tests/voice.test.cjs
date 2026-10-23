// 이야기 목소리: 소리가 시작하지 않으면 알려 주고 다시 준비하기, 게임을 열 때 이야기 AI 내려놓기
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./page.cjs');
const vm = require('node:vm');
// 화면이 바뀔 때까지 기다려요 (정해진 짧은 시간만 기다리면 컴퓨터가 바쁠 때 실패해요)
const until = async (ok, ms = 3000) => { const t = Date.now(); while (!ok() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 15)); };

// 가짜 휴대폰 목소리 (한국어·영어 하나씩). __stuck이면 speak()를 받아도 시작하지 않아요 (굳어 버린 음성 엔진처럼).
// 멈추면(cancel) 크롬처럼 조금 뒤에 ‘취소됨’ 신호를 보내요
const FAKE_SPEECH = stuck => `(() => {
  window.__stuck = ${stuck}; window.__said = [];
  const voices = [{ lang: 'ko-KR', name: 'Phone Korean', voiceURI: 'ko', localService: true }, { lang: 'en-US', name: 'Phone English', voiceURI: 'en', localService: true }];
  let cur = null;
  const ss = { speaking: false, pending: false, paused: false, getVoices: () => voices, addEventListener() { }, removeEventListener() { },
    cancel() { const u = cur; cur = null; ss.speaking = ss.pending = false; if (u) setTimeout(() => u.onerror && u.onerror({ error: 'canceled' }), 0); },
    resume() { ss.paused = false; },
    speak(u) {
      cur = u; ss.pending = true; __said.push(u.lang + (__stuck ? ' stuck' : ' ok'));
      if (__stuck) return;
      setTimeout(() => {
        if (cur !== u) return;
        ss.pending = false; ss.speaking = true; u.onstart && u.onstart();
        setTimeout(() => { if (cur !== u) return; cur = null; ss.speaking = false; u.onend && u.onend(); }, 30);
      }, 5);
    } };
  window.speechSynthesis = ss;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
})()`;

test('voice: a phone voice that does not start gets a note with a diagnostics line, and 목소리 다시 준비 brings it back', async () => {
  const p = bootPage({}, FAKE_SPEECH(true));
  try {
    p.run('VDiag.waitMs = 120');
    p.run('openMission("scene", SCENES[0].key)');
    const note = () => p.document.getElementById('vnote');
    await until(() => note() && !note().hidden);
    assert.ok(note() && !note().hidden, '소리가 시작하지 않으면 알림이 떠요');
    const t = note().textContent;
    assert.match(t, /목소리가 나오지 않았어요\. 휴대폰 미디어 음량을 확인해 주세요\./);
    assert.match(t, /진단: 기기 목소리 한1 영1 대기 · 시도 1 · 시작 0 · /);
    assert.match(t, /이야기 AI 없음/);
    const btn = note().querySelector('[data-act="vfix"]');
    assert.equal(btn.textContent, '목소리 다시 준비');
    // 한국어 목소리가 시작하지 않았다고 적어 둔 뒤의 안내: 없다고 하지 않고 다시 준비하라고 해요
    p.run('ssBroken.ko = true; vErr("기기 ko: 시작 안 함"); svCtl()');
    const hint = p.document.getElementById('vhint');
    assert.match(hint.textContent, /휴대폰의 한국어 목소리가 소리를 내지 않아서/);
    assert.ok(hint.querySelector('[data-act="vfix"]'));
    assert.match(note().querySelector('.vdiag').textContent, /\(안 됨: ko\) · 시도 1 · 시작 0 · 오류: 기기 ko: 시작 안 함/, '새 오류가 진단 줄에 바로 보여요');
    // 엔진이 다시 말할 수 있게 되면: 다시 준비 → 지금 줄부터 다시 읽고 알림이 사라져요
    p.run('__stuck = false');
    btn.click();
    await until(() => p.json('VDiag.starts') > 0);
    assert.ok(p.json('VDiag.starts') > 0, '다시 준비하면 목소리가 시작해요');
    assert.ok(note().hidden);
    assert.deepEqual(p.json('ssBroken'), {});
    assert.deepEqual(p.json('VDiag.errs'), []);
    assert.ok(p.json('__said').includes('ko-KR ok'));
    assert.doesNotMatch(hint.textContent, /소리를 내지 않아서/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('voice: a working phone voice shows no note, and pausing stops the watch', async () => {
  const p = bootPage({}, FAKE_SPEECH(false));
  try {
    p.run('VDiag.waitMs = 120');
    p.run('openMission("scene", SCENES[0].key)');
    await until(() => p.json('VDiag.starts') > 0);
    await new Promise(r => setTimeout(r, 250));
    assert.ok(p.json('VDiag.starts') > 0);
    assert.ok(p.document.getElementById('vnote').hidden);
    // 멈춘 뒤에는 시작하지 않은 시도가 없어서 알림이 뜨지 않아요
    p.run('__stuck = true; svPause()');
    await new Promise(r => setTimeout(r, 250));
    assert.equal(p.json('VDiag.armAt'), 0);
    assert.ok(p.document.getElementById('vnote').hidden);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('story AI: opening a story puts the loaded AI down to free phone memory, but not while a deck is being made or downloaded', () => {
  const p = bootPage();
  try {
    const load = () => p.run('window.__dead = window.__dead || []; AI.engine = { chat: {} }; AI.worker = { terminate() { __dead.push(1); } }; AI.loading = Promise.resolve(AI.engine)');
    load();
    p.run('MK.step = "making"; openMission("scene", SCENES[0].key)');
    assert.equal(p.json('!!AI.engine'), true, '만드는 중에는 그대로');
    p.run('goHome(); MK.step = "pick"; MK.aiDl = { state: "run" }; openMission("scene", SCENES[0].key)');
    assert.equal(p.json('!!AI.engine'), true, '받는 중에는 그대로');
    p.run('goHome(); MK.aiDl = { state: "ok" }; openMission("scene", SCENES[0].key)');
    assert.deepEqual(p.json('{ engine: AI.engine, worker: AI.worker, loading: AI.loading, dead: __dead }'), { engine: null, worker: null, loading: null, dead: [1] });
    // 다시 쓸 때는 이 기기에 저장해 둔 모델을 올려요 (다시 받지 않아요)
    p.run('localStorage.setItem("wg-ai-ready", AI_MODEL)');
    assert.equal(p.json('aiNeedsDownload()'), false);
    // 목소리 다시 준비도 이야기 AI를 내려놓아요
    load();
    p.run('vFix()');
    assert.equal(p.json('!!AI.engine'), false);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

// 가짜 휴대폰 목소리 2: 언어마다 시작까지 걸리는 시간을 차례로 정해요 (__plan.en = [250, -1]: 250ms 뒤 시작, 다음은 시작 안 함). 정하지 않으면 5ms
const FAKE_SPEECH_PLAN = `(() => {
  window.__said = []; window.__plan = {};
  const voices = [{ lang: 'ko-KR', name: 'Phone Korean', voiceURI: 'ko-voice', localService: true }, { lang: 'en-US', name: 'Phone English', voiceURI: 'en-voice', localService: true }];
  let cur = null;
  const ss = { speaking: false, pending: false, paused: false, getVoices: () => voices, addEventListener() { }, removeEventListener() { },
    cancel() { const u = cur; cur = null; ss.speaking = ss.pending = false; if (u) setTimeout(() => u.onerror && u.onerror({ error: 'canceled' }), 0); },
    resume() { ss.paused = false; },
    speak(u) {
      const l = String(u.lang).slice(0, 2), q = __plan[l] || [], d = q.length ? q.shift() : 5;
      cur = u; ss.pending = true; __said.push({ lang: u.lang, d, rate: u.rate, at: Date.now() });
      if (d < 0) return;
      setTimeout(() => {
        if (cur !== u) return;
        ss.pending = false; ss.speaking = true; u.onstart && u.onstart();
        setTimeout(() => { if (cur !== u) return; cur = null; ss.speaking = false; u.onend && u.onend(); }, 40);
      }, d);
    } };
  window.speechSynthesis = ss;
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
})();`;
// 가짜 고품질 목소리 일꾼: 받은 말만 적어 둬요 (일꾼을 쓸 수 있는 기기처럼)
const FAKE_WORKER = `(() => {
  window.__workers = [];
  window.indexedDB = window.indexedDB || {}; window.DecompressionStream = window.DecompressionStream || class { };
  window.Worker = class { constructor() { this.posts = []; __workers.push(this); } postMessage(m) { this.posts.push(JSON.parse(JSON.stringify(m))); } terminate() { this.dead = true; } };
})();`;
const ROWS = [['apple', '사과'], ['river', '강'], ['window', '창문'], ['bridge', '다리'], ['candle', '양초'], ['garden', '정원']].map(([en, ko]) => ({ en, ko, pos: 'x' }));

test('voice: one slow first English start does not mark English broken or start the backup voice; diagnostics show each voice and its start delay', async () => {
  const p = bootPage({}, FAKE_SPEECH_PLAN + FAKE_WORKER);
  try {
    // 깨어 있는 언어는 80ms, 그 언어 첫 문장은 600ms까지 기다려요. 영어 첫 단어는 250ms 뒤에 시작해요
    // (예전에는 한국어가 깨어 있으면 영어 첫 단어도 짧게 기다려서, 한 번 늦으면 이번 방문 내내 안 된다고 정했어요)
    p.run('SS_WAIT.warm = 80; SS_WAIT.cold = 600; VDiag.waitMs = 5000; __plan.en = [250]');
    p.run('openMission("scene", SCENES[0].key)');
    await until(() => p.json('!!ssEver.en'), 6000);
    p.run('svPause()');
    assert.equal(p.json('!!ssEver.en'), true, '영어 단어가 휴대폰 목소리로 나와요');
    assert.deepEqual(p.json('ssBroken'), {});
    assert.equal(p.json('__workers.length'), 0, '고품질 목소리를 받기 시작하지 않아요');
    assert.equal(p.json('VDiag.drop'), 0);
    const en = p.json('VDiag.said').find(s => s.lang === 'en');
    assert.ok(en && en.ok && en.ms >= 200, JSON.stringify(en));
    assert.match(p.json('voiceDiag()'), /최근 문장: .*ko \d+ms Phone Korean \[ko-voice\] 기기 \/ en \d+ms Phone English \[en-voice\] 기기/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('voice: an English word that does not start once is tried again on the phone voice; one that cannot be spoken is counted in the diagnostics', async () => {
  const p = bootPage({}, FAKE_SPEECH_PLAN + FAKE_WORKER);
  try {
    p.run('SS_WAIT.warm = 80; SS_WAIT.cold = 300');
    const id = JSON.stringify(p.json('SCENES[0].words[0]'));
    await p.run(`sayWord(${id}, 1)`);
    assert.equal(p.json('!!ssEver.en'), true);
    // 한 번 소리를 낸 영어 목소리가 한 번 시작하지 않으면: 한 번 더 해서 나와요 (안 된다고 정하지 않고 고품질 목소리도 받지 않아요)
    p.run('__plan.en = [-1, 5]; __said.length = 0');
    await p.run(`svWordSay(${id}, () => true, 1)`);
    assert.deepEqual(p.json('__said.map(s => s.d)'), [-1, 5]);
    assert.deepEqual(p.json('ssBroken'), {});
    assert.equal(p.json('__workers.length'), 0);
    assert.equal(p.json('VDiag.drop'), 0);
    // 두 번 연달아 안 되면 그때 안 된다고 정하고 고품질 목소리를 준비해요. 이번 단어는 낼 수 없어서 진단 줄에 세어요
    p.run('__plan.en = [-1, -1]; __said.length = 0');
    await p.run(`svWordSay(${id}, () => true, 1)`);
    assert.deepEqual(p.json('__said.map(s => s.d)'), [-1, -1]);
    assert.equal(p.json('ssBroken.en'), true);
    assert.equal(p.json('__workers.length'), 1);
    assert.equal(p.json('VDiag.drop'), 1);
    const d = p.json('voiceDiag()');
    assert.match(d, /빠진 영어 단어 1/);
    assert.match(d, /영어 단어 못 냄: VoiceLoading/);
    assert.match(d, /en 시작 안 함 \d+ms Phone English \[en-voice\] 기기/);
    // 안 된다고 정한 뒤에도 30초마다 휴대폰 영어 목소리를 한 번 다시 해 봐요: 소리가 나면 다시 써요 (이야기 내내 영어가 빠지지 않게)
    p.run('ssBrokenAt.en = Date.now() - SS_WAIT.again - 1; __plan.en = [5]; __said.length = 0');
    await p.run(`svWordSay(${id}, () => true, 1)`);
    assert.deepEqual(p.json('__said.map(s => s.d)'), [5]);
    assert.equal(p.json('!!ssBroken.en'), false);
    assert.equal(p.json('VDiag.drop'), 1);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('voice: English words use one speed when made ahead and when spoken, so the made-ahead sound is used', async () => {
  const p = bootPage({}, FAKE_SPEECH_PLAN + FAKE_WORKER);
  try {
    p.run('SAVE.rate = 0.8; ssBroken.en = true; window.__synth = []; Voice.ready = () => true; Voice.synth = (t, l, r) => { __synth.push([t, l, r]); return new Promise(() => { }); }');
    const id = JSON.stringify(p.json('SCENES[0].words[0]'));
    p.run(`SV.lines = [parseLine('{' + ${id} + '|x}')]; voicePrefetch(); sayWord(${id}, SAVE.rate)`);
    await until(() => p.json('__synth.length') >= 2);
    const [made, said] = p.json('__synth');
    assert.deepEqual(made, said);
    assert.ok(Math.abs(made[2] - 0.8 * 0.72) < 1e-9, String(made[2]));
    assert.equal(made[2], p.json('wordSpeed(0.8)'));
  } finally { p.close(); }
});

test('story AI: put down when the make screen is left or a deck finishes while elsewhere (not while making); if still loaded at story open, the first line waits', async () => {
  const p = bootPage({}, FAKE_SPEECH_PLAN);
  try {
    const load = () => p.run('window.__dead = window.__dead || []; AI.engine = { chat: {} }; AI.worker = { terminate() { __dead.push(1); } }; AI.loading = Promise.resolve(AI.engine)');
    load();
    p.run('showScreen("make"); MK.step = "making"; goHome()');
    assert.equal(p.json('!!AI.engine'), true, '만드는 중에는 그대로');
    p.run('MK.step = "pick"; showScreen("make"); goHome()');
    assert.equal(p.json('!!AI.engine'), false, '만들기 화면을 나가면 내려놓아요');
    // 다른 화면에 있는 동안 다 만들면 그때 내려놓아요
    load();
    p.run(`MK.rows = ${JSON.stringify(ROWS)}; MK.useAI = false;`);
    await p.run('mkMake()');
    assert.equal(p.json('MK.step'), 'done', p.json('MK.err'));
    assert.equal(p.json('!!AI.engine'), false, '다 만들면 내려놓아요');
    // 그래도 이야기를 열 때 올라가 있으면 내려놓고, 휴대폰이 메모리를 정리하는 동안(1.5초) 첫 문장을 기다려요
    load();
    const t0 = Date.now();
    p.run('openMission("scene", SCENES[0].key)');
    assert.equal(p.json('!!AI.engine'), false);
    await new Promise(r => setTimeout(r, 500));
    assert.equal(p.json('__said.length'), 0, '바로 읽지 않아요');
    await until(() => p.json('__said.length') > 0, 4000);
    assert.ok(p.json('__said[0].at') - t0 >= 1400, String(p.json('__said[0].at') - t0));
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('voice: the backup English voice rests while the phone voice speaks, and its heavy setup waits while a story is read by the phone Korean voice', async () => {
  const p = bootPage({}, FAKE_SPEECH_PLAN + FAKE_WORKER);
  try {
    p.run('openMission("scene", SCENES[0].key); Voice.start()');
    assert.deepEqual(p.json('__workers[0].posts.map(m => m.t)').slice(0, 2), ['gate', 'init']);
    const gates = () => p.json('__workers[0].posts.filter(m => m.t === "gate")');
    assert.equal(gates()[0].heavy, true, '이야기를 읽는 동안에는 무거운 준비를 미뤄요');
    await until(() => gates().some(m => m.hold) && !gates()[gates().length - 1].hold);
    assert.ok(gates().some(m => m.hold && m.heavy), '휴대폰 목소리가 말하는 동안 쉬어요');
    assert.equal(gates()[gates().length - 1].hold, false, '말을 마치면 쉬기를 풀어요');
    // 휴대폰 영어 목소리를 못 쓰면 이야기 중에도 준비해요 (영어 단어가 이야기 내내 빠지지 않게)
    p.run('ssBroken.en = true; svCtl()');
    assert.equal(gates()[gates().length - 1].heavy, false);
    // 일꾼이 무거운 준비를 하는 동안에는 휴대폰 목소리가 기다렸다가 말해요
    p.run('svPause(); __said.length = 0; __workers[0].onmessage({ data: { t: "busy", on: true } }); tts("사과", "ko-KR", 1).catch(() => { })');
    await new Promise(r => setTimeout(r, 150));
    assert.equal(p.json('__said.length'), 0, '무거운 준비를 하는 동안 기다려요');
    p.run('__workers[0].onmessage({ data: { t: "busy", on: false } })');
    await until(() => p.json('__said.length') > 0);
    assert.equal(p.json('__said[0].lang'), 'ko-KR');
    p.run('delete ssBroken.en; svCtl()');
    p.run('goHome()');
    await until(() => { const g = gates(); return !g[g.length - 1].hold && !g[g.length - 1].heavy; });
    const g = gates();
    assert.deepEqual(g[g.length - 1], { t: 'gate', hold: false, heavy: false }, '이야기를 나가면 준비를 이어 가요');
    // 일꾼 쪽: 쉬라고 하면 준비를 시작하지 않고, 풀리면 시작해요
    const box = { calls: [], posts: [] };
    box.postMessage = m => box.posts.push(m);
    box.importScripts = u => { box.calls.push(u); throw new Error('stop here'); };
    box.self = box;
    vm.createContext(box);
    vm.runInContext(p.json('VOICE_WORKER'), box);
    box.onmessage({ data: { t: 'gate', hold: false, heavy: true } });
    box.onmessage({ data: { t: 'init', base: 'https://example.test/tts/' } });
    await new Promise(r => setTimeout(r, 40));
    assert.deepEqual(box.calls, [], '이야기를 읽는 동안에는 시작하지 않아요');
    box.onmessage({ data: { t: 'gate', hold: true, heavy: false } });
    await new Promise(r => setTimeout(r, 40));
    assert.deepEqual(box.calls, [], '휴대폰 목소리가 말하는 동안에는 시작하지 않아요');
    box.onmessage({ data: { t: 'gate', hold: false, heavy: false } });
    await until(() => box.calls.length > 0);
    assert.deepEqual(box.calls, ['https://example.test/tts/ort.wasm.min.js']);
    assert.deepEqual(JSON.parse(JSON.stringify(box.posts.filter(m => m.t === 'busy'))), [{ t: 'busy', on: true }, { t: 'busy', on: false }], '무거운 일을 하는 동안을 알려요');
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});
