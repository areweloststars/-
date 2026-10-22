/* ---------- 소리 ---------- */
// 효과음 엔진은 소리를 다 낸 뒤 잠깐 있다 쉬게 해요(quiet): 켜 둔 채로 휴대폰 목소리가 말하면 두 소리 흐름이 겹쳐
// 보급형 휴대폰에서 목소리가 지지직거릴 수 있어요
const Sound = (() => {
  let ctx = null, out = null, last = 0, restT = 0;
  function rest(ms) { clearTimeout(restT); restT = setTimeout(quiet, ms); }
  function quiet() { if (Date.now() - last < 2200) return rest(2300 - (Date.now() - last)); try { if (ctx && ctx.state === 'running') ctx.suspend(); } catch (e) { } }
  function ac() {
    if (!ctx) {
      try { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); out = ctx.createGain(); out.gain.value = .55; out.connect(ctx.destination); } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => { });
    return ctx;
  }
  function tone(f, d, type = 'sine', v = .12, t0 = 0, f2) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + t0, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + d + .03);
  }
  function noise(d, v = .2, f1 = 800, f2 = 3000, type = 'bandpass', t0 = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + t0, len = Math.max(1, Math.floor(c.sampleRate * d)), buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; fl.type = type; fl.frequency.setValueAtTime(f1, t); fl.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    src.connect(fl); fl.connect(g); g.connect(out); src.start(t); src.stop(t + d);
  }
  const fx = {
    tap: () => tone(700, .05, 'triangle', .05),
    zoom: () => { noise(.32, .1, 500, 2800); tone(320, .26, 'sine', .05, 0, 760); },
    know: () => { tone(880, .09, 'triangle', .11); tone(1320, .14, 'triangle', .1, .07); },
    combo: () => { tone(1047, .07, 'square', .045); tone(1319, .07, 'square', .045, .06); tone(1568, .16, 'square', .045, .12); },
    dont: () => { tone(587, .09, 'triangle', .06); tone(440, .18, 'triangle', .06, .09); },
    ok: () => { tone(1047, .08, 'triangle', .11); tone(1319, .1, 'triangle', .11, .07); tone(1760, .18, 'sine', .09, .14); },
    coin: () => { tone(1976, .05, 'square', .035); tone(2637, .16, 'square', .035, .05); },
    bad: () => { tone(196, .13, 'square', .07); tone(147, .24, 'square', .07, .11); },
    slot: () => { tone(1175, .05, 'triangle', .08); tone(1568, .07, 'triangle', .06, .04); },
    bonus: () => { tone(330, .34, 'sawtooth', .035, 0, 990); tone(880, .22, 'triangle', .06, .28, 1320); },
    life: () => { noise(.5, .26, 600, 80, 'lowpass'); tone(110, .55, 'sine', .14, 0, 55); },
    gameover: () => { [392, 349, 311, 262].forEach((f, i) => tone(f, .32, 'triangle', .09, i * .28)); noise(.9, .2, 500, 60, 'lowpass', 1.1); },
    unlock: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .14, 'square', .05, i * .09)); },
    project: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, .22, 'triangle', .1, i * .12)); },
    tick: () => tone(1250, .03, 'square', .03),
    count: () => tone(620, .1, 'triangle', .1),
    go: () => tone(940, .28, 'triangle', .12),
    win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'triangle', .1, i * .1)); tone(1319, .4, 'triangle', .08, .42); },
    fail: () => { noise(.7, .32, 900, 60, 'lowpass'); tone(180, .6, 'sawtooth', .06, 0, 45); },
    boom: () => { noise(.42, .28, 1400, 90, 'lowpass'); tone(160, .36, 'sawtooth', .05, 0, 55); }
  };
  return {
    play(n) { if (!SAVE.sound) return; try { if (fx[n]) { fx[n](); last = Date.now(); rest(2400); } } catch (e) { } },
    unlock() { if (SAVE.sound) { ac(); rest(2400); } },
    quiet
  };
})();
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } }
const hasSS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
const canEsp = typeof WebAssembly === 'object' && typeof DecompressionStream === 'function' && typeof Blob === 'function';
const canSpeak = hasSS || canEsp || typeof Worker === 'function';
// 기기에 그 언어 목소리가 있는지 (앱 안 화면은 목록이 비어 있는 경우가 많아요)
let ssVoices = [];
const ssLoad = () => {
  try { ssVoices = speechSynthesis.getVoices() || []; } catch (e) { ssVoices = []; }
  try { const el = document.getElementById('vstat'); if (el) el.textContent = voiceStat(); const vp = document.getElementById('vpick'); if (vp && !vp.contains(document.activeElement)) vp.innerHTML = voicePickHTML(); } catch (e) { }
};
if (hasSS) { ssLoad(); try { speechSynthesis.addEventListener('voiceschanged', ssLoad); } catch (e) { } }
const ssHas = lang => ssVoices.some(v => String(v.lang || '').replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2)));
// 목록을 기다리는 건 한 번만 (목소리가 없는 화면에서 문장마다 기다리지 않게. 나중에 목록이 오면 voiceschanged로 채워져요)
let ssWaited = null;
function ssWait() {
  if (!hasSS || ssVoices.length) return Promise.resolve();
  return ssWaited || (ssWaited = (async () => { for (let i = 0; i < 12 && !ssVoices.length; i++) { await sleep(120); ssLoad(); } })());
}
// 같은 언어 목소리가 여럿이면 자연스러운 것부터 (Google·신경망 목소리 먼저, 로봇 같은 엔진은 뒤로)
function voiceScore(v, lang) {
  const want = lang.replace('_', '-').toLowerCase(), vl = String(v.lang || '').replace('_', '-').toLowerCase(), n = `${v.name || ''} ${v.voiceURI || ''}`.toLowerCase();
  return (vl === want ? 120 : vl.startsWith(want.slice(0, 2)) ? 70 : 0) + (/natural|neural|enhanced|premium/.test(n) ? 100 : 0) + (/google/.test(n) ? 85 : 0)
    + (/microsoft|siri|yuna|samantha/.test(n) ? 60 : 0) + (v.localService ? 5 : 0) + (v.localService === false ? -40 : 0) + (v.default ? 8 : 0) - (/espeak|pico|festival|flite/.test(n) ? 160 : 0);
}
// (인터넷으로 받는 목소리는 연결이 약하면 끊기거나 지직거려서 기기 안 목소리 뒤로. 설정에서 고른 목소리가 있으면 그것)
const langVoices = lang => ssVoices.filter(v => String(v.lang || '').replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())).sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang));
const voiceKey = v => v.voiceURI || v.name || '';
const bestVoice = lang => { const vs = langVoices(lang), pick = SAVE[lang.slice(0, 2).toLowerCase() + 'Voice']; return (pick && vs.find(v => voiceKey(v) === pick)) || vs[0] || null; };
/* 목소리 지켜보기: 소리를 내려고 한 뒤 3초 안에 실제로 시작하지 않으면 이야기 화면에 알려요(VDiag.on).
   무엇이 안 됐는지 짧게 모아 두었다가 진단 줄로 보여 줘요 (주인이 화면을 캡처해 알려 줄 수 있게).
   tries: 소리를 내려고 한 번 수, starts: 실제로 시작한 번 수, armAt: 아직 시작하지 않은 첫 시도 시각 */
// said: 최근 문장 4개가 얼마 만에 시작했는지와 어느 목소리였는지, drop: 소리를 내지 못하고 넘어간 영어 단어 수
const VDiag = { tries: 0, starts: 0, armAt: 0, t: 0, errs: [], on: null, waitMs: 3000, said: [], drop: 0 };
function vTry() {
  VDiag.tries++;
  if (VDiag.armAt) return;
  VDiag.armAt = Date.now();
  clearTimeout(VDiag.t);
  VDiag.t = setTimeout(() => { if (VDiag.armAt && VDiag.on) VDiag.on('nostart'); }, VDiag.waitMs);
}
function vStart() { VDiag.starts++; VDiag.armAt = 0; clearTimeout(VDiag.t); if (VDiag.on) VDiag.on('start'); }
// 지켜보기를 쉬어요 (멈춤·화면 나감)
function vIdle() { VDiag.armAt = 0; clearTimeout(VDiag.t); }
// 안 된 까닭 (같은 것은 한 번만, 최근 4개)
function vErr(what) {
  const s = String(what || '').slice(0, 48); if (!s) return;
  VDiag.errs = VDiag.errs.filter(x => x !== s); VDiag.errs.push(s); if (VDiag.errs.length > 4) VDiag.errs.shift();
  if (VDiag.on) VDiag.on('err');
}
// 진단용: 휴대폰 목소리 문장마다 말하라고 한 뒤 시작하기까지 걸린 시간(시작하지 않았으면 기다린 시간)·언어·고른 목소리 (최근 4개)
function vSaid(lang, ms, ok, v) {
  VDiag.said.push({ lang: lang.slice(0, 2), ms: Math.max(0, Math.round(ms)), ok, name: String((v && v.name) || '기본 목소리').slice(0, 32), uri: String((v && v.voiceURI) || '').slice(0, 40), local: v ? v.localService : null });
  if (VDiag.said.length > 4) VDiag.said.shift();
}
// 이야기 속 영어 단어를 소리 내지 못하고 넘어갔을 때: 그냥 빠뜨리지 않고 진단 줄에 세어 둬요
function vDrop(e) { VDiag.drop++; vErr('영어 단어 못 냄: ' + ((e && (e.name && e.name !== 'Error' ? e.name : e.message)) || '오류')); }
// 말하는 중인 문장을 붙잡아 둠 (크롬은 붙잡지 않은 문장을 치워 버려서 끝 신호가 오지 않을 때가 있어요)
let ssCur = null;
// 그 언어 기기 목소리가 소리를 못 냈으면 이번에는 다른 방법으로
// ssProbed: 목록이 비어 있을 때 한 번 해 본 언어 (나중에 목록이 오면 그 목소리를 써요)
// 언어마다: ssWoke 엔진이 그 언어로 깨어 있는지 (아니면 첫 문장은 시작을 오래 기다려요. 이야기 AI를 내려놓은 뒤에도 다시 오래),
// ssEver 이번에 한 번이라도 소리를 냈는지, ssMiss 연달아 소리를 내지 못한 번 수
const ssBroken = {}, ssOk = {}, ssProbed = {}, ssWoke = {}, ssEver = {}, ssMiss = {};
// 시작을 기다리는 시간(ms): 목록 없이 해 볼 때, 그 언어가 깨어 있을 때, 그 언어 첫 문장
const SS_WAIT = { probe: 2500, warm: 3500, cold: 7000 };
// 이 시각까지는 말을 시작하지 않아요 (이야기 AI를 내려놓은 뒤 휴대폰이 메모리를 정리하는 동안)
let ssCalm = 0;
// 이야기 AI를 내려놓았을 때: 휴대폰이 메모리를 정리하는 동안 목소리가 늦게 시작하거나 끊길 수 있어서
// 잠깐(ms) 쉬었다가 말하고, 언어마다 첫 문장은 시작을 오래 기다려요
function voiceCold(ms = 0) {
  for (const k of Object.keys(ssWoke)) delete ssWoke[k];
  if (ms) ssCalm = Math.max(ssCalm, Date.now() + ms);
}
// probe: 목소리 목록이 비어 있는 화면에서 소리가 나는지 한 번 해 볼 때 (짧게 기다림)
function ssSpeak(text, lang, rate, probe = false) {
  return new Promise((res, rej) => {
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      if (speechSynthesis.paused) speechSynthesis.resume(); // 멈춘 채 굳어 버린 엔진 깨우기
      const u = new SpeechSynthesisUtterance(text), v = bestVoice(lang), l2 = lang.slice(0, 2), t0 = Date.now();
      if (v) u.voice = v;
      u.lang = v && v.lang ? v.lang : lang; u.rate = rate;
      ssCur = u; voiceGate(); // 말하는 동안 고품질 목소리 일꾼은 쉬어요
      Sound.quiet(); Narr.quiet();
      let done = false, poll = 0, g = 0;
      const fin = (ok, err) => { if (done) return; done = true; clearTimeout(st); clearTimeout(g); clearInterval(poll); if (ssCur === u) { ssCur = null; voiceGate(); } ok ? res() : rej(err); };
      // 목소리 목록은 있는데 실제로는 소리가 안 나는 화면이 있어요: 시작하지 않으면 실패로 보고 다른 방법으로
      // (첫 문장은 음성 엔진이 깨어나느라 늦을 수 있어 더 기다려요)
      // (먼저 실패로 정해 두고 멈춰요: 멈출 때 바로 오는 ‘취소됨’ 신호를 그만두기로 잘못 읽으면 이야기가 멈춰 버려요)
      const st = setTimeout(() => {
        if (!probe) { vErr(`기기 ${l2}: 시작 안 함`); vSaid(lang, Date.now() - t0, false, v); }
        fin(false, Object.assign(new Error('tts did not start'), { nostart: true }));
        try { speechSynthesis.cancel(); } catch (e) { }
      }, probe ? SS_WAIT.probe : ssWoke[l2] ? SS_WAIT.warm : SS_WAIT.cold);
      u.onstart = () => {
        if (done) return; // 기다리다 그만둔 뒤 늦게 온 시작 신호 (살펴보기 타이머를 새로 만들지 않아요)
        ssWoke[l2] = ssEver[l2] = true; ssMiss[l2] = 0; clearTimeout(st); vStart(); vSaid(lang, Date.now() - t0, true, v);
        // 끝 신호가 안 오는 기기용: 말하기가 멈췄는지 살펴보고(말하는 중이라고 한 번은 알려 준 기기에서만, 두 번 연달아 멈춰 있을 때),
        // 그래도 안 끝나면 아주 넉넉한 시간 뒤에 넘어가요. 예전에는 시간을 글자 수로 짧게 잡아서,
        // 천천히 읽는 기기에서는 다음 문장이 앞 문장을 중간에 끊었어요
        let seen = false, idle = 0;
        poll = setInterval(() => { try { const on = speechSynthesis.speaking || speechSynthesis.pending; if (on) { seen = true; idle = 0; } else if (seen && ++idle >= 2) fin(true); } catch (e) { } }, 400);
        g = setTimeout(() => fin(true), 8000 + [...text].length * 500 / rate);
      };
      u.onend = () => fin(true);
      u.onerror = e => {
        const stop = e && (e.error === 'interrupted' || e.error === 'canceled');
        if (!stop && !probe) vErr(`기기 ${lang.slice(0, 2)}: ${(e && e.error) || '오류'}`);
        fin(false, stop ? { name: 'AbortError' } : new Error('tts'));
      };
      if (!probe) vTry();
      speechSynthesis.speak(u);
    } catch (e) { if (ssCur) { ssCur = null; voiceGate(); } vErr(`기기 ${lang.slice(0, 2)}: ${(e && e.name) || '오류'}`); rej(e); }
  });
}
/* 기기 목소리가 없을 때: 앱 옆에 올려 둔 eSpeak NG(WASM, GPL-3.0)로 이 기기 안에서 목소리를 만들어요. API·토큰 없음.
   처음 한 번 약 9MB를 받고, 한 문장은 보통 1초 안에 만들어져요. */
const Esp = (() => {
  let ready = null, tok = 0;
  const cache = new Map();
  function load() {
    if (!ready) ready = (async () => {
      const [mod, wasm] = await Promise.all([
        import(new URL('tts/espeak-ng.js', location.href).href),
        (async () => {
          const r = await fetch(new URL('tts/espeak-ng-gz.wasm', location.href).href);
          if (!r.ok) throw new Error('esp fetch');
          const buf = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
          return WebAssembly.compile(buf);
        })()
      ]);
      return { E: mod.default, wasm };
    })().catch(e => { ready = null; throw e; });
    return ready;
  }
  async function wav(text, lang, rate) {
    const key = lang + '|' + rate + '|' + text;
    if (cache.has(key)) return cache.get(key);
    const { E, wasm } = await load();
    const v = /^ko/i.test(lang) ? 'ko' : 'en-us';
    const m = await E({
      arguments: ['-v', v, '-s', String(Math.round((v === 'ko' ? 165 : 140) * clamp(rate, .5, 2))), '-w', 'o.wav', ' ' + text.replace(/\s+/g, ' ').slice(0, 400)],
      instantiateWasm(imports, done) { WebAssembly.instantiate(wasm, imports).then(inst => done(inst)); return {}; },
      print() { }, printErr() { }
    });
    const url = URL.createObjectURL(new Blob([m.FS.readFile('o.wav')], { type: 'audio/wav' }));
    if (cache.size > 60) { const [k0, u0] = cache.entries().next().value; URL.revokeObjectURL(u0); cache.delete(k0); }
    cache.set(key, url);
    return url;
  }
  async function speak(text, lang, rate) {
    const my = ++tok;
    const url = await wav(text, lang, rate);
    if (my !== tok) throw { name: 'AbortError' };
    return Narr.playUrl(url);
  }
  return { speak, stop() { tok++; }, warm() { load().catch(() => { }); } };
})();
/* ---------- 고품질 영어 목소리: 기기 안 신경망 음성(VITS, Piper Joe) ----------
   기기에 영어 목소리가 없는 곳(앱 안 화면 등)에서만 받아서 써요. 한국어는 기기 목소리(없으면 eSpeak)로 읽어요.
   (예전 한국어 신경망 목소리는 학습 데이터가 비상업 라이선스라 뺐어요)
   글자 → (eSpeak NG) 발음기호 → (ONNX Runtime) 목소리. 이 기기의 백그라운드 일꾼(Worker)에서 돌아서 화면이 멈추지 않아요.
   처음 한 번 약 37MB를 받아 기기에 저장해 두고, 다음부터는 바로 써요. API·토큰 없음. */
const VOICE_WORKER = `
let O = null, E = null, espWasm = null, cfg = null, base = '';
const sess = {};
// 쉬기: hold면 휴대폰 목소리가 말하는 중이라 받기·준비·만들기를 모두 쉬어요. heavy면 멈출 수 없는 무거운 준비
// (엔진 스크립트·eSpeak 올리기, 목소리 모델 올리기)를 시작하지 않아요 (이야기 화면에서 휴대폰 한국어 목소리로 읽는 동안)
let hold = false, heavy = false;
const waiters = [];
async function gate(big) { while (hold || (big && heavy)) await new Promise(r => waiters.push(r)); }
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('voca-voice', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function cget(k) { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction('f').objectStore('f').get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch (e) { return null; } }
async function cput(k, v) { try { const db = await idb(); await new Promise(ok => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { } }
let doneBytes = 0;
const TOTAL = 37e6;
async function file(name, gz) {
  const key = 'v1/' + name;
  await gate();
  let buf = await cget(key);
  if (!buf) {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error('fetch ' + name);
    let body = r.body;
    if (gz) body = body.pipeThrough(new DecompressionStream('gzip'));
    const rd = body.getReader(), parts = []; let n = 0;
    for (;;) { await gate(); const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; if (!gz) { doneBytes += value.length; postMessage({ t: 'prog', p: Math.min(0.99, doneBytes / TOTAL) }); } }
    buf = new Uint8Array(n); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    buf = buf.buffer;
    cput(key, buf);
  } else { doneBytes += buf.byteLength; postMessage({ t: 'prog', p: Math.min(0.99, doneBytes / TOTAL) }); }
  return buf;
}
async function model(lang) {
  if (sess[lang]) return sess[lang];
  sess[lang] = (async () => {
    const v = cfg[lang], name = 'en-joe';
    const parts = await Promise.all(Array.from({ length: v.parts }, (_, i) => file(name + '.' + i + '.wasm')));
    const all = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0)); let o = 0;
    for (const p of parts) { all.set(new Uint8Array(p), o); o += p.byteLength; }
    await gate(true);
    return O.InferenceSession.create(all, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
  sess[lang].catch(() => { delete sess[lang]; });
  return sess[lang];
}
async function init(b) {
  base = b;
  await gate(true);
  importScripts(base + 'ort.wasm.min.js');
  O = self.ort;
  O.env.wasm.numThreads = 1; O.env.wasm.proxy = false; O.env.wasm.wasmPaths = base;
  cfg = await (await fetch(base + 'voices.json')).json();
  const [m, w] = await Promise.all([import(base + 'espeak-ng.js'), file('espeak-ng-gz.wasm', true).then(async b => { await gate(true); return WebAssembly.compile(b); })]);
  E = m.default; espWasm = w;
}
async function ipa(text, lang) {
  const m = await E({ arguments: ['-q', '--ipa', '-v', lang === 'ko' ? 'ko' : 'en-us', '--phonout', 'p.txt', ' ' + text],
    instantiateWasm(imports, done) { WebAssembly.instantiate(espWasm, imports).then(i => done(i)); return {}; }, print() { }, printErr() { } });
  return m.FS.readFile('p.txt', { encoding: 'utf8' }).split('\\n').map(s => s.trim()).filter(Boolean);
}
function ids(lines, v) {
  const out = [v.map['^'], v.map['_']];
  lines.forEach((l, i) => {
    if (i) out.push(...v.sep);
    for (const ch of l) { const id = v.map[ch]; if (id != null) out.push(id, v.map['_']); }
  });
  out.push(...v.end, v.map['$']);
  return out;
}
function wav(f, sr) {
  let peak = 0; for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i]));
  // 앞뒤 조용한 부분 잘라 내기 (한국어 목소리는 문장 앞에 0.5초 넘게 빈 소리가 붙어 나와서 늦게 들렸어요)
  const th = peak * 0.03, win = Math.max(1, Math.round(sr * 0.01));
  const loud = i => { for (let k = i; k < Math.min(f.length, i + win); k++) if (Math.abs(f[k]) > th) return true; return false; };
  let a = 0, z = f.length;
  while (a < z && !loud(a)) a += win;
  while (z > a && !loud(Math.max(a, z - win))) z -= win;
  a = Math.max(0, a - Math.round(sr * 0.04)); z = Math.min(f.length, z + Math.round(sr * 0.12));
  if (z > a) f = f.subarray(a, z);
  const g = peak > 0.01 ? Math.min(3, 0.9 / peak) : 1;
  const b = new ArrayBuffer(44 + f.length * 2), d = new DataView(b);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); d.setUint32(4, 36 + f.length * 2, true); s(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); s(36, 'data'); d.setUint32(40, f.length * 2, true);
  for (let i = 0; i < f.length; i++) d.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f[i] * g)) * 32767, true);
  return b;
}
let ready = null;
onmessage = async e => {
  const m = e.data;
  if (m.t === 'gate') { hold = !!m.hold; heavy = !!m.heavy; waiters.splice(0).forEach(f => f()); return; }
  try {
    if (m.t === 'init') { ready = ready || init(m.base); ready.catch(() => { ready = null; }); await ready; await model('en'); postMessage({ t: 'ready', lang: 'en' }); return; }
    await ready;
    await gate();
    const v = cfg[m.lang], s = await model(m.lang);
    const x = ids(await ipa(m.text, m.lang), v);
    const r = await s.run({ input: new O.Tensor('int64', BigInt64Array.from(x.map(BigInt)), [1, x.length]), input_lengths: new O.Tensor('int64', BigInt64Array.from([BigInt(x.length)]), [1]), scales: new O.Tensor('float32', Float32Array.from([0.667, v.len / (m.rate || 1), 0.8]), [3]) });
    const out = r.output.data, w = wav(out, 22050);
    postMessage({ t: 'wav', id: m.id, wav: w }, [w]);
  } catch (err) { postMessage({ t: 'err', id: m.id, msg: String(err && err.message || err) }); }
};`;
const Voice = (() => {
  let w = null, seq = 0, readyEn = false, failed = false, prog = 0, busy = false, force = false, gs = { hold: false, heavy: false };
  const pend = new Map(), cache = new Map(), listeners = [], queue = [];
  const ok = typeof Worker === 'function' && typeof WebAssembly === 'object' && typeof DecompressionStream === 'function' && typeof indexedDB === 'object';
  function start() {
    if (w || failed || !ok) return;
    try {
      w = new Worker(URL.createObjectURL(new Blob([VOICE_WORKER], { type: 'text/javascript' })));
      w.onmessage = e => {
        const m = e.data;
        if (m.t === 'prog') { prog = m.p; listeners.forEach(f => f()); }
        else if (m.t === 'ready') { if (m.lang === 'en') readyEn = true; prog = 1; force = false; listeners.forEach(f => f()); }
        else if (m.t === 'err' && m.id == null) { failed = true; force = false; vErr('고품질 준비: ' + m.msg); listeners.forEach(f => f()); } // 준비 실패: 기기 목소리·eSpeak로
        else if (m.t === 'wav' || m.t === 'err') {
          const p = pend.get(m.id); if (!p) return; pend.delete(m.id);
          if (m.t === 'wav') p.ok(URL.createObjectURL(new Blob([m.wav], { type: 'audio/wav' }))); else { if (/fetch|init|session/i.test(m.msg) && !readyEn) failed = true; p.no(new Error(m.msg)); }
        }
      };
      w.onerror = e => { failed = true; vErr('고품질 일꾼: ' + ((e && e.message) || '오류')); for (const p of pend.values()) p.no(new Error('voice worker')); pend.clear(); listeners.forEach(f => f()); };
      w.postMessage({ t: 'gate', hold: gs.hold, heavy: gs.heavy });
      w.postMessage({ t: 'init', base: new URL('tts/', location.href).href });
    } catch (e) { failed = true; }
  }
  // 만들기는 한 번에 하나씩. 지금 들려줄 문장(urgent)은 미리 만들어 두는 문장들보다 먼저
  // (안 그러면 이야기 첫 영어 단어가 앞에 쌓인 한국어 복습 문장들을 다 기다리느라 6초쯤 늦게 나왔어요)
  // 휴대폰 목소리가 말하는 동안에는 미리 만들어 두는 일을 쉬어요 (보급형 휴대폰에서 그 목소리가 끊기거나 지직거리지 않게)
  // (이미 맡긴 일과 받기·준비도 일꾼 안에서 쉬어요: gate)
  let waitT = 0;
  const ssBusy = () => { try { return hasSS && (speechSynthesis.speaking || speechSynthesis.pending); } catch (e) { return false; } };
  function pump() {
    if (busy || !queue.length) return;
    const k = queue.findIndex(j => j.urgent);
    if (k < 0 && ssBusy()) { if (!waitT) waitT = setTimeout(() => { waitT = 0; pump(); }, 400); return; }
    const job = queue.splice(k >= 0 ? k : 0, 1)[0];
    if (failed || !w) { job.rej(new Error('voice off')); pump(); return; }
    busy = true;
    const id = ++seq, fin = () => { busy = false; pump(); };
    pend.set(id, { ok: u => { job.res(u); fin(); }, no: e => { job.rej(e); fin(); } });
    w.postMessage({ id, text: job.text, lang: job.L, rate: job.rate });
  }
  // 쉬기를 일꾼에게 알려요. hold: 휴대폰 목소리가 말하는 중이면 모두 쉬어요. heavy: 이야기 화면에서 휴대폰 한국어 목소리로
  // 읽는 중이면 무거운 준비를 이야기를 나간 뒤로 미뤄요 (‘목소리 다시 준비’를 누른 뒤 준비가 끝날 때까지는 빼고: force)
  function gate(h, big) {
    h = !!h; big = !!big && !force;
    if (gs.hold === h && gs.heavy === big) return;
    gs = { hold: h, heavy: big };
    if (w) try { w.postMessage({ t: 'gate', hold: h, heavy: big }); } catch (e) { }
  }
  function forceNow() { force = true; gate(gs.hold, false); }
  // 문장 하나 → wav 주소. 같은 문장은 한 번만 만들어요
  function synth(text, lang, rate = 1, urgent = false) {
    if (!/^en/i.test(lang)) return Promise.reject(new Error('english only'));
    const L = 'en', key = L + '|' + rate + '|' + text;
    if (cache.has(key)) { if (urgent) { const j = queue.find(q => q.key === key); if (j) j.urgent = true; } return cache.get(key); }
    start();
    const p = new Promise((res, rej) => { queue.push({ key, text: String(text).slice(0, 300), L, rate, res, rej, urgent }); });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    pump();
    return p;
  }
  // 준비될 때까지 잠깐 기다리기 (준비됐으면 true)
  function whenReady(ms) {
    if (readyEn || failed || !w) return Promise.resolve(readyEn);
    return new Promise(res => { const t = setTimeout(() => res(readyEn), ms); const f = () => { if (readyEn || failed) { clearTimeout(t); res(readyEn); } }; listeners.push(f); });
  }
  // 처음 상태로: 일꾼을 닫고 기다리던 문장은 그만둬요. 준비에 실패했었다면 이 기기에 저장해 둔 목소리 파일이
  // 망가졌을 수 있어서 지워요 (다음에 쓸 때 다시 받아요. 미리 받아 두었으면 인터넷 없이도 돼요)
  function reset() {
    const was = failed;
    if (w) try { w.terminate(); } catch (e) { }
    w = null; failed = false; readyEn = false; prog = 0; force = false;
    clearTimeout(waitT); waitT = 0;
    // (줄을 먼저 비워요: 만들던 문장을 그만두면 다음 문장을 꺼내 가려고 해요)
    const jobs = queue.splice(0), ps = [...pend.values()];
    pend.clear(); cache.clear();
    for (const j of jobs) j.rej({ name: 'AbortError' });
    for (const p of ps) p.no({ name: 'AbortError' });
    busy = false;
    if (was) try { indexedDB.deleteDatabase('voca-voice'); } catch (e) { }
    listeners.forEach(f => f());
  }
  return {
    start, synth, whenReady, reset, gate, force: forceNow, onChange(f) { listeners.push(f); },
    ready: lang => !failed && /^en/i.test(lang) && readyEn,
    get failed() { return failed || !ok; }, get progress() { return prog; }, get loading() { return !!w && !readyEn && !failed; }, get held() { return gs.heavy; }
  };
})();

// 소리 내어 읽기 좋게 다듬기. 한국어 뜻: ‘~을 설명하다’ → ‘무엇을 설명하다’, 괄호·빗금 정리
const KO_JOSA = { 을: '을', 를: '을', 이: '이', 가: '이', 은: '은', 는: '은', 과: '과', 와: '과', 으로: '으로', 로: '으로', 에게: '에게', 에서: '에서', 에: '에', 의: '의', 도: '도', 만: '만', 부터: '부터', 까지: '까지', 보다: '보다' };
function sayKo(t) {
  return String(t || '')
    .replace(/[~∼〜]\s*(에게|에서|으로|부터|까지|보다|을|를|이|가|은|는|과|와|로|에|의|도|만)(?![가-힣])/g, (_, j) => '무엇' + KO_JOSA[j])
    .replace(/[~∼〜]/g, '').replace(/[()[\]{}<>「」『』]/g, ' ').replace(/\s*[/|·ㆍ]\s*/g, ', ')
    .replace(/\s+([,.!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
// 영어 단어: 사전식 약어를 말로 (sb → somebody), 물결표·괄호 정리
function sayEn(t) {
  return String(t || '').replace(/\bsb\b/gi, 'somebody').replace(/\bsth\b/gi, 'something').replace(/\bto-v\b/gi, 'to do').replace(/\bv-?ing\b/gi, 'doing')
    .replace(/[~∼〜]/g, ' ').replace(/[()[\]{}<>]/g, ' ').replace(/\s*[/|]\s*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,;:-]+$/g, '').trim();
}

// 목소리 고르기: 기기 목소리(그 언어가 있고 소리가 나면) → 영어는 기기 안 고품질 목소리 → (그것도 못 쓰는 기기에서만) eSpeak 영어
// 한국어는 기기 목소리가 없으면 { name: 'NoKoVoice' }: 자막으로 보여 줘요
// (eSpeak 한국어는 음성 인식기로 재 보니 글자의 63~85%를 알아듣지 못해, 뚝뚝 끊기는 기계음으로만 들렸어요)
// 영어 고품질 목소리를 받는 중이면 { name: 'VoiceLoading' } (eSpeak 영어도 단어의 3분의 1만 알아들어서, 발음 공부에는 기다리는 편이 나아요)
let ttsTok = 0;
const devVoice = lang => hasSS && (ssHas(lang) || ssOk[lang.slice(0, 2)]) && !ssBroken[lang.slice(0, 2)];
async function tts(text, lang, rate) {
  const ko = /^ko/i.test(lang);
  text = ko ? sayKo(text) : sayEn(text);
  if (!text) throw new Error('no tts');
  const my = ++ttsTok, gone = () => my !== ttsTok;
  await ssWait();
  // 이야기 AI를 막 내려놓았으면 휴대폰이 메모리를 정리할 때까지 잠깐 쉬었다가 말해요
  if (ssCalm > Date.now()) await sleep(ssCalm - Date.now());
  if (gone()) throw { name: 'AbortError' };
  // 목소리 목록이 아예 비어 있어도 소리를 내는 화면이 있어 한 번은 해 봐요 (안 나면 다시 해 보지 않고, 나중에 목록이 오면 그 목소리를 써요)
  const l2 = lang.slice(0, 2), probe = !devVoice(lang) && hasSS && !ssVoices.length && !ssProbed[l2];
  if (devVoice(lang) || probe) {
    try { await ssSpeak(text, lang, rate, probe); if (probe) ssOk[l2] = true; return; }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      // 안 된다고 정하는 건 이번에 한 번도 소리를 내지 못한 목소리가 시작하지 않았을 때와 두 번 연달아 안 됐을 때만이에요
      // (한 번 늦게 시작했다고 정해 버리면 그 뒤 영어 단어가 모두 고품질 목소리를 기다리느라 빠졌어요)
      if (probe) ssProbed[l2] = true;
      else { ssMiss[l2] = (ssMiss[l2] || 0) + 1; if (ssMiss[l2] >= 2 || (e && e.nostart && !ssEver[l2])) ssBroken[l2] = true; }
      if (gone()) throw { name: 'AbortError' };
      // 한 번 안 됐을 뿐이면 다른 목소리로 바꾸지 않아요 (고품질 목소리도 받지 않아요). 부른 쪽이 한 번 더 해 보거나 그 줄만 넘어가요
      if (devVoice(lang)) throw { name: 'PhoneMiss' };
      if (!ko) voiceWarm(); svCtl();
    }
    if (gone()) throw { name: 'AbortError' };
  }
  if (ko) { if (hasSS) vErr(ssVoices.length ? '한국어 기기 목소리 안 됨' : '기기 목소리 목록 없음'); throw { name: 'NoKoVoice' }; }
  if (!Voice.failed) {
    Voice.start(); // (이야기 화면에서 휴대폰 한국어 목소리로 읽는 동안에는 일꾼이 무거운 준비를 이야기를 나간 뒤로 미뤄요)
    // 기기에 저장해 둔 목소리를 엔진에 올리는 중이면 잠깐 기다려요 (미뤄 둔 때는 기다리지 않아요)
    if (Voice.loading && Voice.progress >= 0.99 && !Voice.held) await Voice.whenReady(6000);
    if (gone()) throw { name: 'AbortError' };
    if (Voice.ready(lang)) {
      try {
        const u = await Voice.synth(text, lang, rate, true);
        if (gone()) throw { name: 'AbortError' };
        return await Narr.playUrl(u);
      } catch (e) { if (e && e.name === 'AbortError') throw e; vErr('고품질: ' + ((e && (e.message || e.name)) || '오류')); }
    } else if (Voice.loading) throw { name: 'VoiceLoading' };
  }
  if (canEsp) return Esp.speak(text, lang, rate).catch(e => { if (!(e && e.name === 'AbortError')) vErr('eSpeak: ' + ((e && (e.message || e.name)) || '오류')); throw e; });
  vErr('쓸 수 있는 목소리 없음');
  throw new Error('no tts');
}
// 기기에 영어 목소리가 없을 때만(앱 안 화면 등) 고품질 영어 목소리를 미리 받아 둠
function voiceWarm(note) {
  ssWait().then(() => {
    if (Voice.failed || Voice.ready('en') || Voice.loading || devVoice('en-US')) return;
    // 받기·준비(무거운 일)는 휴대폰 목소리가 말을 마친 틈에 시작 (최대 20초 기다림)
    let n = 0;
    const go = () => { try { if (hasSS && (speechSynthesis.speaking || speechSynthesis.pending) && n++ < 40) { setTimeout(go, 500); return; } } catch (e) { } Voice.start(); };
    go();
    if (note) toast('영어 발음용 고품질 목소리를 준비하고 있어요 · 처음 한 번만 약 37MB를 받아요');
  });
}
// 고품질 영어 목소리 일꾼에게 지금 쉴지 알려요: 휴대폰 목소리가 말하는 중이면 모두 쉬고,
// 이야기 화면에서 휴대폰 한국어 목소리로 읽는 중이면 무거운 준비를 이야기를 나간 뒤로 미뤄요
function voiceGate() {
  try { Voice.gate(!!ssCur, M.kind === 'scene' && !!SAVE.narr && !$('#story').hidden && devVoice('ko-KR')); } catch (e) { }
}
// 앱 안 화면(Claude 앱·카카오톡·인스타그램 등 앱 속 브라우저): 휴대폰 목소리를 쓸 수 없는 경우가 많아요
const inApp = /; wv\)|\bClaude\/|KAKAOTALK|NAVER\(inapp|Instagram|FBA[NV]|\bLine\/|DaumApps|everytimeApp/i.test(navigator.userAgent || '');
const inKakao = /KAKAOTALK/i.test(navigator.userAgent || '');
// 지금 게임을 여는 링크 (열쇠는 이 기기에 기억된 것)
function gameLink() { let k = ''; try { k = localStorage.getItem('word-game-site-key') || ''; } catch (e) { } return location.origin + location.pathname + (k ? '#k=' + k : ''); }
async function copyLink() {
  const t = gameLink(), told = () => toast('링크를 복사했어요 · Chrome이나 삼성 인터넷 주소창에 붙여 넣어 열어 주세요');
  try { await navigator.clipboard.writeText(t); told(); return; } catch (e) { }
  try { const a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); if (ok) { told(); return; } } catch (e) { }
  toast('복사가 안 돼요 · 오른쪽 위 메뉴의 ‘다른 브라우저로 열기’를 써 주세요');
}
// 카카오톡 안에서는 바깥 브라우저로 바로 열 수 있어요
function openOutside() { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(gameLink()); }
// 한국어 기기 목소리가 없을 때 이야기 화면에 보여 줄 안내 (HTML)
function voiceOutsideHTML() {
  if (!SAVE.narr || devVoice('ko-KR')) return '';
  // 한국어 목소리는 있는데 소리를 내지 않았을 때 (굳어 버린 음성 엔진 등)
  if (hasSS && ssHas('ko-KR') && ssBroken.ko) return `휴대폰의 한국어 목소리가 소리를 내지 않아서 한국어 자막은 글로만 보여 줘요. 휴대폰 미디어 음량을 확인하고 <button type="button" class="linkbtn" data-act="vfix">목소리 다시 준비</button>를 눌러 보세요.`;
  if (!inApp) return `이 기기에는 한국어 목소리가 없어서 한국어 자막은 글로만 보여 주고, 영어 단어는 소리로 들려줘요. 휴대폰 <b>설정 → 텍스트 음성 변환(TTS)</b>에서 한국어 음성을 받으면 자막도 읽어 줘요.`;
  return `이 앱 안 화면(Claude 앱·카카오톡 등)에서는 휴대폰 목소리를 쓸 수 없어서 한국어 자막은 글로만 보여 줘요. <b>Chrome</b>이나 <b>삼성 인터넷</b>에서 열면 휴대폰의 자연스러운 목소리로 자막과 영어 발음을 읽어 줘요. 아래 단추로 링크를 복사해 주소창에 붙여 넣으면 돼요.
    ${inKakao ? '<button type="button" class="linkbtn" data-act="vout">다른 브라우저로 열기</button> ' : ''}<button type="button" class="linkbtn" data-act="vcopy">링크 복사</button>`;
}
// 설정 화면에 보여 줄 이 기기 목소리 상태
function voiceStat() {
  const dev = lang => { const v = bestVoice(lang); return v ? `기기 목소리${v.name ? ` (${v.name})` : ''}` : ''; };
  const ko = devVoice('ko-KR') ? dev('ko-KR') : '없음 → 자막으로';
  const en = devVoice('en-US') ? dev('en-US') : Voice.ready('en') ? '기기 안 고품질 목소리' : Voice.loading ? `고품질 목소리 준비 중 (${Math.round(Voice.progress * 100)}%)` : Voice.failed ? 'eSpeak' : '고품질 목소리 (처음 들을 때 받아요)';
  return `한국어: ${ko} · 영어: ${en}${inApp ? ' · 앱 안 화면' : ''}`;
}
// 설정: 이 기기의 한국어·영어 목소리 고르기와 들어 보기 (지지직거리거나 어색한 목소리를 다른 것으로 바꿀 수 있게). 고른 것은 SAVE.koVoice·enVoice
function voicePickHTML() {
  const row = (lang, lab) => {
    const vs = langVoices(lang), k = lang.slice(0, 2), pick = SAVE[k + 'Voice'];
    if (!vs.length) return '';
    return `<div class="vrow"><label class="vsel"><span>${lab}</span><select data-voice="${k}" aria-label="${lab} 목소리">`
      + `<option value="">자동</option>${vs.map(v => `<option value="${esc(voiceKey(v))}"${voiceKey(v) === pick ? ' selected' : ''}>${esc(v.name || v.lang)}${v.localService === false ? ' · 인터넷' : ''}</option>`).join('')}</select></label>`
      + `<button type="button" class="linkbtn" data-act="vtry" data-lang="${lang}">들어 보기</button></div>`;
  };
  return row('ko-KR', '한국어') + row('en-US', '영어');
}
function voiceTry(lang) {
  ttsStop(); Narr.unlock();
  const ko = /^ko/.test(lang);
  tts(ko ? '안녕하세요. 이 목소리로 이야기를 읽어 줄게요.' : 'Hello! I will read the English words with this voice.', lang, ko ? SAVE.rate : wordRate())
    .catch(e => { if (e && e.name === 'NoKoVoice') toast('이 화면에서는 한국어 목소리를 쓸 수 없어요'); else voiceWait(e); });
}
// 발음 단추를 눌렀는데 영어 목소리가 아직 준비 중일 때 알려 줌
function voiceWait(e) { if (e && e.name === 'VoiceLoading') toast(`영어 발음용 고품질 목소리를 준비하고 있어요 (${Math.round(Voice.progress * 100)}%) · 다 되면 발음이 나와요`); }
function ttsStop() { ttsTok++; if (hasSS) try { speechSynthesis.cancel(); } catch (e) { } Esp.stop(); Narr.stop(); }
// 영어 단어 발음은 음성 속도 설정과 상관없이 보통 빠르기보다 빨라지지 않게 (느리게는 됨). 휴대폰 목소리는 보통 빠르기도 빠르게 들려서 0.72배로 또박또박
const wordRate = () => Math.min(SAVE.rate, 1);
const wordSay = id => WORDS[id] && WORDS[id].say || shortW(id);
// (말할 때와 미리 만들어 둘 때 빠르기가 같아야 미리 만든 소리를 써요: 둘 다 wordSpeed)
const WORD_RATE = .72;
const wordSpeed = rate => Math.min(rate, 1) * WORD_RATE;
function sayWord(id, rate) { return tts(wordSay(id), 'en-US', wordSpeed(rate)); }
function announce(t) { const el = $('#live'); if (el) el.textContent = t; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 기기 안에서 만든 목소리(wav 주소)를 재생. 앱 안 화면처럼 브라우저 음성 기능이 없는 곳에서도 들리게 함.
   <audio>로 재생(속도를 바꿔도 목소리 높이 유지), 안 되면 Web Audio로 재생 */
const Narr = (() => {
  let el = null, ctx = null, mode = 'el', unlocked = false, cur = null, src = null, silent = '';
  function ac() {
    try {
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => { });
    } catch (e) { ctx = null; }
    return ctx;
  }
  // 0.1초짜리 무음 wav (첫 탭에서 재생 권한을 받는 데만 씀)
  function silentUrl() {
    if (silent) return silent;
    const n = 1600, b = new ArrayBuffer(44 + n * 2), d = new DataView(b), s = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, 16000, true); d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); s(36, 'data'); d.setUint32(40, n * 2, true);
    return (silent = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
  }
  // 첫 탭에서 한 번: 재생 권한을 받아 둠
  function unlock() {
    ac(); setTimeout(quiet, 1500);
    if (unlocked) return;
    unlocked = true;
    try {
      el = el || new Audio();
      el.preload = 'auto'; el.muted = true; el.src = silentUrl();
      const warm = el.src, p = el.play();
      // 준비 재생이 늦게 끝나도, 그 사이 진짜 음성이 시작됐으면 멈추지 않음
      const done = () => { if (!cur && el.src === warm) { try { el.pause(); } catch (e) { } el.muted = false; } };
      if (p && p.then) p.then(done, done); else done();
    } catch (e) { }
  }
  function stop() { const c = cur; cur = null; if (c) c(); }
  // 재생 중이 아니면 Web Audio 엔진을 쉬게 함 (휴대폰 목소리와 소리 흐름이 겹치지 않게). 다시 쓸 때 ac()가 깨워요
  function quiet() { try { if (ctx && ctx.state === 'running' && !src) ctx.suspend(); } catch (e) { } }
  function setRate(r) { try { if (el) el.playbackRate = r; if (src) src.playbackRate.value = r; } catch (e) { } }
  function playEl(u, rate) {
    return new Promise((res, rej) => {
      el = el || new Audio();
      let done = false, guard = 0;
      const fin = (ok, err) => { if (done) return; done = true; clearTimeout(guard); el.onended = el.onerror = null; if (cur === stopper) cur = null; ok ? res() : rej(err); };
      const stopper = () => { try { el.pause(); } catch (e) { } fin(false, { name: 'AbortError' }); };
      cur = stopper;
      el.onended = () => fin(true);
      el.onerror = () => { vErr('재생기: 파일 오류'); fin(false, new Error('media error')); };
      let began = false;
      const go = () => { if (!done && !began) { began = true; vStart(); } };
      el.onplaying = go;
      el.muted = false; el.src = u;
      try { el.preservesPitch = true; el.webkitPreservesPitch = true; } catch (e) { }
      el.defaultPlaybackRate = rate; el.playbackRate = rate;
      vTry();
      const p = el.play();
      if (p && p.then) p.then(go, err => { if (!(err && err.name === 'AbortError')) vErr('재생기: ' + ((err && err.name) || '막힘')); fin(false, err); });
      guard = setTimeout(() => fin(true), 40000);
    });
  }
  // <audio>가 막힌 앱 안 화면용: Web Audio로 재생
  const ubufs = new Map();
  async function playUrlWA(u, rate) {
    const c = ac();
    if (!c || c.state !== 'running') { vErr('웹 오디오: ' + (c ? c.state : '없음')); throw new Error('audio locked'); }
    if (!ubufs.has(u)) {
      const ab = await (await fetch(u)).arrayBuffer();
      ubufs.set(u, await new Promise((res, rej) => c.decodeAudioData(ab, res, rej)));
      if (ubufs.size > 80) ubufs.delete(ubufs.keys().next().value);
    }
    return playBuf(c, ubufs.get(u), rate);
  }
  function playBuf(c, buf, rate) {
    return new Promise((res, rej) => {
      const s = c.createBufferSource();
      s.buffer = buf; s.playbackRate.value = rate; s.connect(c.destination);
      let done = false;
      const fin = (ok, err) => { if (done) return; done = true; clearTimeout(guard); if (src === s) src = null; if (cur === stopper) cur = null; ok ? res() : rej(err); };
      const stopper = () => { try { s.stop(); } catch (e) { } fin(false, { name: 'AbortError' }); };
      const guard = setTimeout(() => fin(true), (buf.duration / rate) * 1000 + 3000);
      s.onended = () => fin(true);
      cur = stopper; src = s;
      vTry();
      s.start();
      if (c.state === 'running') vStart();
    });
  }
  async function playUrl(u, rate = 1) {
    stop();
    if (mode === 'el') {
      try { await playEl(u, rate); return; }
      catch (e) { if (e && e.name === 'AbortError') throw e; mode = 'wa'; } // <audio>가 막히면 이후로는 Web Audio로
    }
    await playUrlWA(u, rate);
  }
  // 처음 상태로: 재생기와 Web Audio 엔진을 버리고 다음 탭에서 새로 만들어요 (굳어 버린 소리 흐름 풀기)
  function reset() {
    stop();
    try { if (el) { el.pause(); el.removeAttribute('src'); } } catch (e) { }
    try { if (ctx && ctx.close) ctx.close().catch(() => { }); } catch (e) { }
    el = null; ctx = null; src = null; unlocked = false; mode = 'el'; ubufs.clear();
  }
  // 진단 줄용: 재생 방법(<audio> 또는 Web Audio)과 Web Audio 상태
  const state = () => (mode === 'el' ? '재생기' : '웹 오디오') + (ctx ? ' ' + ({ running: '켜짐', suspended: '쉬는 중', closed: '닫힘' }[ctx.state] || ctx.state) : '');
  return { unlock, playUrl, stop, setRate, quiet, reset, state };
})();
// '목소리 다시 준비': 목소리 엔진들을 처음처럼 되돌려요. 굳은 기기 목소리 깨우기, 안 된다고 적어 둔 기록 지우기,
// 재생기·고품질 목소리 새로 준비. 누른 탭 안에서 불러야 재생 권한도 다시 받아요(Narr.unlock)
function voiceReset() {
  ttsStop();
  if (hasSS) { try { speechSynthesis.cancel(); if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) { } }
  for (const o of [ssBroken, ssOk, ssProbed, ssWoke, ssEver, ssMiss]) for (const k of Object.keys(o)) delete o[k];
  ssWaited = null; ssCur = null;
  if (hasSS) ssLoad();
  Narr.reset();
  Voice.reset();
  // 누른 사람이 바란 준비: 휴대폰에 영어 목소리가 없으면 고품질 목소리의 무거운 준비도 이야기 화면에서 바로 해요
  if (!devVoice('en-US')) Voice.force();
  voiceGate();
  vIdle(); VDiag.tries = 0; VDiag.starts = 0; VDiag.errs = []; VDiag.said = []; VDiag.drop = 0;
  Narr.unlock(); Sound.unlock();
}
// 진단 줄: 무엇이 안 됐는지 한 줄로 (화면을 캡처해 알려 줄 수 있게). 이 기기의 단어·기록은 넣지 않아요
function voiceDiag() {
  const n = l => ssVoices.filter(v => String(v.lang || '').toLowerCase().startsWith(l)).length;
  let ss = '없음';
  if (hasSS) { ss = `한${n('ko')} 영${n('en')}`; try { ss += speechSynthesis.speaking ? ' 말하는 중' : speechSynthesis.pending ? ' 대기' : ''; if (speechSynthesis.paused) ss += ' 멈춤'; } catch (e) { } }
  const broken = Object.keys(ssBroken).filter(k => ssBroken[k]);
  const hq = Voice.ready('en') ? '준비됨' : Voice.loading ? `받는 중 ${Math.round(Voice.progress * 100)}%` : Voice.failed ? '실패' : '안 씀';
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller ? '켬' : '끔';
  const ai = typeof AI !== 'undefined' && (AI.engine || AI.worker) ? '올라가 있음' : '없음';
  // 최근 문장: 언어, 말하라고 한 뒤 시작까지 걸린 시간(시작하지 않았으면 기다린 시간), 목소리 이름 [voiceURI], 기기 안·인터넷 목소리
  const said = VDiag.said.map(s => `${s.lang} ${s.ok ? '' : '시작 안 함 '}${s.ms}ms ${s.name}${s.uri && s.uri !== s.name ? ` [${s.uri}]` : ''}${s.local === true ? ' 기기' : s.local === false ? ' 인터넷' : ''}`).join(' / ');
  return [`기기 목소리 ${ss}${broken.length ? ` (안 됨: ${broken.join('·')})` : ''}`, `시도 ${VDiag.tries} · 시작 ${VDiag.starts}`,
    VDiag.errs.length ? `오류: ${VDiag.errs.join(', ')}` : '', said ? `최근 문장: ${said}` : '', VDiag.drop ? `빠진 영어 단어 ${VDiag.drop}` : '', `고품질 영어 ${hq}`, Narr.state(), `오프라인 저장 ${sw}`, `이야기 AI ${ai}`,
    inApp ? '앱 안 화면' : '', typeof buildLabel === 'function' ? buildLabel() : ''].filter(Boolean).join(' · ');
}

