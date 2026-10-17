// 이야기 목소리: 소리가 시작하지 않으면 알려 주고 다시 준비하기, 게임을 열 때 이야기 AI 내려놓기
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./page.cjs');
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
