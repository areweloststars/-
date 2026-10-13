/* ---------- 소리 ---------- */
const Sound = (() => {
  let ctx = null, out = null;
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
    play(n) { if (!SAVE.sound) return; try { fx[n] && fx[n](); } catch (e) { } },
    unlock() { if (SAVE.sound) ac(); }
  };
})();
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { } }
const hasSS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
const canEsp = typeof WebAssembly === 'object' && typeof DecompressionStream === 'function' && typeof Blob === 'function';
const canSpeak = hasSS || canEsp || typeof Worker === 'function';
// 기기에 그 언어 목소리가 있는지 (앱 안 화면은 목록이 비어 있는 경우가 많아요)
let ssVoices = [];
const ssLoad = () => { try { ssVoices = speechSynthesis.getVoices() || []; } catch (e) { ssVoices = []; } try { const el = document.getElementById('vstat'); if (el) el.textContent = voiceStat(); } catch (e) { } };
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
    + (/microsoft|siri|yuna|samantha/.test(n) ? 60 : 0) + (v.localService ? 5 : 0) + (v.default ? 8 : 0) - (/espeak|pico|festival|flite/.test(n) ? 160 : 0);
}
const bestVoice = lang => ssVoices.filter(v => String(v.lang || '').replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())).sort((a, b) => voiceScore(b, lang) - voiceScore(a, lang))[0] || null;
// 말하는 중인 문장을 붙잡아 둠 (크롬은 붙잡지 않은 문장을 치워 버려서 끝 신호가 오지 않을 때가 있어요)
let ssCur = null, ssWoke = false;
// 그 언어 기기 목소리가 소리를 못 냈으면 이번에는 다른 방법으로
// ssProbed: 목록이 비어 있을 때 한 번 해 본 언어 (나중에 목록이 오면 그 목소리를 써요)
const ssBroken = {}, ssOk = {}, ssProbed = {};
// probe: 목소리 목록이 비어 있는 화면에서 소리가 나는지 한 번 해 볼 때 (짧게 기다림)
function ssSpeak(text, lang, rate, probe = false) {
  return new Promise((res, rej) => {
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      if (speechSynthesis.paused) speechSynthesis.resume(); // 멈춘 채 굳어 버린 엔진 깨우기
      const u = new SpeechSynthesisUtterance(text), v = bestVoice(lang);
      if (v) u.voice = v;
      u.lang = v && v.lang ? v.lang : lang; u.rate = rate;
      ssCur = u;
      let done = false, poll = 0, g = 0;
      const fin = (ok, err) => { if (done) return; done = true; clearTimeout(st); clearTimeout(g); clearInterval(poll); if (ssCur === u) ssCur = null; ok ? res() : rej(err); };
      // 목소리 목록은 있는데 실제로는 소리가 안 나는 화면이 있어요: 시작하지 않으면 실패로 보고 다른 방법으로
      // (첫 문장은 음성 엔진이 깨어나느라 늦을 수 있어 더 기다려요)
      const st = setTimeout(() => { try { speechSynthesis.cancel(); } catch (e) { } fin(false, Object.assign(new Error('tts did not start'), { nostart: true })); }, probe ? 2500 : ssWoke ? 3500 : 7000);
      u.onstart = () => {
        ssWoke = true; clearTimeout(st);
        // 끝 신호가 안 오는 기기용: 말하기가 멈췄는지 살펴보고(말하는 중이라고 한 번은 알려 준 기기에서만, 두 번 연달아 멈춰 있을 때),
        // 그래도 안 끝나면 아주 넉넉한 시간 뒤에 넘어가요. 예전에는 시간을 글자 수로 짧게 잡아서,
        // 천천히 읽는 기기에서는 다음 문장이 앞 문장을 중간에 끊었어요
        let seen = false, idle = 0;
        poll = setInterval(() => { try { const on = speechSynthesis.speaking || speechSynthesis.pending; if (on) { seen = true; idle = 0; } else if (seen && ++idle >= 2) fin(true); } catch (e) { } }, 400);
        g = setTimeout(() => fin(true), 8000 + [...text].length * 500 / rate);
      };
      u.onend = () => fin(true);
      u.onerror = e => fin(false, e && (e.error === 'interrupted' || e.error === 'canceled') ? { name: 'AbortError' } : new Error('tts'));
      speechSynthesis.speak(u);
    } catch (e) { rej(e); }
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
const idb = () => new Promise((ok, no) => { const r = indexedDB.open('voca-voice', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function cget(k) { try { const db = await idb(); return await new Promise(ok => { const q = db.transaction('f').objectStore('f').get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); } catch (e) { return null; } }
async function cput(k, v) { try { const db = await idb(); await new Promise(ok => { const t = db.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch (e) { } }
let doneBytes = 0;
const TOTAL = 37e6;
async function file(name, gz) {
  const key = 'v1/' + name;
  let buf = await cget(key);
  if (!buf) {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error('fetch ' + name);
    let body = r.body;
    if (gz) body = body.pipeThrough(new DecompressionStream('gzip'));
    const rd = body.getReader(), parts = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); n += value.length; if (!gz) { doneBytes += value.length; postMessage({ t: 'prog', p: Math.min(0.99, doneBytes / TOTAL) }); } }
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
    return O.InferenceSession.create(all, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
  sess[lang].catch(() => { delete sess[lang]; });
  return sess[lang];
}
async function init(b) {
  base = b;
  importScripts(base + 'ort.wasm.min.js');
  O = self.ort;
  O.env.wasm.numThreads = 1; O.env.wasm.proxy = false; O.env.wasm.wasmPaths = base;
  cfg = await (await fetch(base + 'voices.json')).json();
  const [m, w] = await Promise.all([import(base + 'espeak-ng.js'), file('espeak-ng-gz.wasm', true).then(b => WebAssembly.compile(b))]);
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
  try {
    if (m.t === 'init') { ready = ready || init(m.base); ready.catch(() => { ready = null; }); await ready; await model('en'); postMessage({ t: 'ready', lang: 'en' }); return; }
    await ready;
    const v = cfg[m.lang], s = await model(m.lang);
    const x = ids(await ipa(m.text, m.lang), v);
    const r = await s.run({ input: new O.Tensor('int64', BigInt64Array.from(x.map(BigInt)), [1, x.length]), input_lengths: new O.Tensor('int64', BigInt64Array.from([BigInt(x.length)]), [1]), scales: new O.Tensor('float32', Float32Array.from([0.667, v.len / (m.rate || 1), 0.8]), [3]) });
    const out = r.output.data, w = wav(out, 22050);
    postMessage({ t: 'wav', id: m.id, wav: w }, [w]);
  } catch (err) { postMessage({ t: 'err', id: m.id, msg: String(err && err.message || err) }); }
};`;
const Voice = (() => {
  let w = null, seq = 0, readyEn = false, failed = false, prog = 0, busy = false;
  const pend = new Map(), cache = new Map(), listeners = [], queue = [];
  const ok = typeof Worker === 'function' && typeof WebAssembly === 'object' && typeof DecompressionStream === 'function' && typeof indexedDB === 'object';
  function start() {
    if (w || failed || !ok) return;
    try {
      w = new Worker(URL.createObjectURL(new Blob([VOICE_WORKER], { type: 'text/javascript' })));
      w.onmessage = e => {
        const m = e.data;
        if (m.t === 'prog') { prog = m.p; listeners.forEach(f => f()); }
        else if (m.t === 'ready') { if (m.lang === 'en') readyEn = true; prog = 1; listeners.forEach(f => f()); }
        else if (m.t === 'err' && m.id == null) { failed = true; listeners.forEach(f => f()); } // 준비 실패: 기기 목소리·eSpeak로
        else if (m.t === 'wav' || m.t === 'err') {
          const p = pend.get(m.id); if (!p) return; pend.delete(m.id);
          if (m.t === 'wav') p.ok(URL.createObjectURL(new Blob([m.wav], { type: 'audio/wav' }))); else { if (/fetch|init|session/i.test(m.msg) && !readyEn) failed = true; p.no(new Error(m.msg)); }
        }
      };
      w.onerror = () => { failed = true; for (const p of pend.values()) p.no(new Error('voice worker')); pend.clear(); listeners.forEach(f => f()); };
      w.postMessage({ t: 'init', base: new URL('tts/', location.href).href });
    } catch (e) { failed = true; }
  }
  // 만들기는 한 번에 하나씩. 지금 들려줄 문장(urgent)은 미리 만들어 두는 문장들보다 먼저
  // (안 그러면 이야기 첫 영어 단어가 앞에 쌓인 한국어 복습 문장들을 다 기다리느라 6초쯤 늦게 나왔어요)
  function pump() {
    if (busy || !queue.length) return;
    const k = queue.findIndex(j => j.urgent), job = queue.splice(k >= 0 ? k : 0, 1)[0];
    if (failed || !w) { job.rej(new Error('voice off')); pump(); return; }
    busy = true;
    const id = ++seq, fin = () => { busy = false; pump(); };
    pend.set(id, { ok: u => { job.res(u); fin(); }, no: e => { job.rej(e); fin(); } });
    w.postMessage({ id, text: job.text, lang: job.L, rate: job.rate });
  }
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
  return {
    start, synth, whenReady, onChange(f) { listeners.push(f); },
    ready: lang => !failed && /^en/i.test(lang) && readyEn,
    get failed() { return failed || !ok; }, get progress() { return prog; }, get loading() { return !!w && !readyEn && !failed; }
  };
})();

// 소리 내어 읽기 좋게 다듬기. 한국어 뜻: ‘~을 설명하다’ → ‘무엇을 설명하다’, 괄호·빗금 정리
const KO_JOSA = { 을: '을', 를: '을', 이: '이', 가: '이', 은: '은', 는: '은', 과: '과', 와: '과', 으로: '으로', 로: '으로', 에게: '에게', 에서: '에서', 에: '에', 의: '의', 도: '도', 만: '만', 부터: '부터', 까지: '까지', 보다: '보다' };
function sayKo(t) {
  return String(t || '')
    .replace(/[~∼〜]\s*(에게|에서|으로|부터|까지|보다|을|를|이|가|은|는|과|와|로|에|의|도|만)(?![가-힣])/g, (_, j) => '무엇' + KO_JOSA[j])
    .replace(/[~∼〜]/g, '').replace(/[()[\]{}<>「」『』]/g, ' ').replace(/\s*[/|]\s*/g, ', ')
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
  if (gone()) throw { name: 'AbortError' };
  // 목소리 목록이 아예 비어 있어도 소리를 내는 화면이 있어 한 번은 해 봐요 (안 나면 다시 해 보지 않고, 나중에 목록이 오면 그 목소리를 써요)
  const l2 = lang.slice(0, 2), probe = !devVoice(lang) && hasSS && !ssVoices.length && !ssProbed[l2];
  if (devVoice(lang) || probe) {
    try { await ssSpeak(text, lang, rate, probe); if (probe) ssOk[l2] = true; return; }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (probe) ssProbed[l2] = true; else if (e && e.nostart) ssBroken[l2] = true;
      if (!devVoice(lang)) { if (!ko) voiceWarm(); svCtl(); }
    }
    if (gone()) throw { name: 'AbortError' };
  }
  if (ko) throw { name: 'NoKoVoice' };
  if (!Voice.failed) {
    Voice.start();
    // 기기에 저장해 둔 목소리를 엔진에 올리는 중이면 잠깐 기다려요
    if (Voice.loading && Voice.progress >= 0.99) await Voice.whenReady(6000);
    if (gone()) throw { name: 'AbortError' };
    if (Voice.ready(lang)) {
      try {
        const u = await Voice.synth(text, lang, rate, true);
        if (gone()) throw { name: 'AbortError' };
        return await Narr.playUrl(u);
      } catch (e) { if (e && e.name === 'AbortError') throw e; }
    } else if (Voice.loading) throw { name: 'VoiceLoading' };
  }
  if (canEsp) return Esp.speak(text, lang, rate);
  throw new Error('no tts');
}
// 기기에 영어 목소리가 없을 때만(앱 안 화면 등) 고품질 영어 목소리를 미리 받아 둠
function voiceWarm(note) {
  ssWait().then(() => {
    if (Voice.failed || Voice.ready('en') || Voice.loading || devVoice('en-US')) return;
    Voice.start();
    if (note) toast('영어 발음용 고품질 목소리를 준비하고 있어요 · 처음 한 번만 약 37MB를 받아요');
  });
}
// 앱 안 화면(카카오톡·인스타그램 등 앱 속 브라우저): 휴대폰 목소리를 쓸 수 없는 경우가 많아요
const inApp = /; wv\)|KAKAOTALK|NAVER\(inapp|Instagram|FBA[NV]|\bLine\/|DaumApps|everytimeApp/i.test(navigator.userAgent || '');
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
  if (!inApp) return `이 기기에는 한국어 목소리가 없어서 한국어 자막은 글로만 보여 주고, 영어 단어는 소리로 들려줘요. 휴대폰 <b>설정 → 텍스트 음성 변환(TTS)</b>에서 한국어 음성을 받으면 자막도 읽어 줘요.`;
  return `이 앱 안 화면에서는 휴대폰 목소리를 쓸 수 없어서 한국어 자막은 글로만 보여 줘요. <b>Chrome</b>이나 <b>삼성 인터넷</b>에서 열면 휴대폰의 자연스러운 목소리로 자막과 영어 발음을 읽어 줘요.
    ${inKakao ? '<button type="button" class="linkbtn" data-act="vout">다른 브라우저로 열기</button> ' : ''}<button type="button" class="linkbtn" data-act="vcopy">링크 복사</button>`;
}
// 설정 화면에 보여 줄 이 기기 목소리 상태
function voiceStat() {
  const dev = lang => { const v = bestVoice(lang); return v ? `기기 목소리${v.name ? ` (${v.name})` : ''}` : ''; };
  const ko = devVoice('ko-KR') ? dev('ko-KR') : '없음 → 자막으로';
  const en = devVoice('en-US') ? dev('en-US') : Voice.ready('en') ? '기기 안 고품질 목소리' : Voice.loading ? `고품질 목소리 준비 중 (${Math.round(Voice.progress * 100)}%)` : Voice.failed ? 'eSpeak' : '고품질 목소리 (처음 들을 때 받아요)';
  return `한국어: ${ko} · 영어: ${en}${inApp ? ' · 앱 안 화면' : ''}`;
}
// 발음 단추를 눌렀는데 영어 목소리가 아직 준비 중일 때 알려 줌
function voiceWait(e) { if (e && e.name === 'VoiceLoading') toast(`영어 발음용 고품질 목소리를 준비하고 있어요 (${Math.round(Voice.progress * 100)}%) · 다 되면 발음이 나와요`); }
function ttsStop() { ttsTok++; if (hasSS) try { speechSynthesis.cancel(); } catch (e) { } Esp.stop(); Narr.stop(); }
// 영어 단어 발음은 음성 속도 설정과 상관없이 보통 빠르기보다 빨라지지 않게 (느리게는 됨)
const wordRate = () => Math.min(SAVE.rate, 1);
const wordSay = id => WORDS[id] && WORDS[id].say || shortW(id);
function sayWord(id, rate) { return tts(wordSay(id), 'en-US', Math.min(rate, 1) * .85); }
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
    ac();
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
  function setRate(r) { try { if (el) el.playbackRate = r; if (src) src.playbackRate.value = r; } catch (e) { } }
  function playEl(u, rate) {
    return new Promise((res, rej) => {
      el = el || new Audio();
      let done = false, guard = 0;
      const fin = (ok, err) => { if (done) return; done = true; clearTimeout(guard); el.onended = el.onerror = null; if (cur === stopper) cur = null; ok ? res() : rej(err); };
      const stopper = () => { try { el.pause(); } catch (e) { } fin(false, { name: 'AbortError' }); };
      cur = stopper;
      el.onended = () => fin(true);
      el.onerror = () => fin(false, new Error('media error'));
      el.muted = false; el.src = u;
      try { el.preservesPitch = true; el.webkitPreservesPitch = true; } catch (e) { }
      el.defaultPlaybackRate = rate; el.playbackRate = rate;
      const p = el.play();
      if (p && p.catch) p.catch(err => fin(false, err));
      guard = setTimeout(() => fin(true), 40000);
    });
  }
  // <audio>가 막힌 앱 안 화면용: Web Audio로 재생
  const ubufs = new Map();
  async function playUrlWA(u, rate) {
    const c = ac();
    if (!c || c.state !== 'running') throw new Error('audio locked');
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
      s.start();
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
  return { unlock, playUrl, stop, setRate };
})();

