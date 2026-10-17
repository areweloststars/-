// 문제 찾기용: AI 일꾼 안에서 그래픽 칩(WebGPU)이 스스로 알려 주는 일을 화면에 보내요.
// worker.js가 WebLLM보다 먼저 불러요 (WebLLM이 그래픽 장치를 만들기 전에, 그리고 WebLLM의 기록 함수가 console을 묶기 전에).
// - 그래픽 칩 정보·한도·기능 (한 번), WebLLM이 부탁한 한도
// - 장치를 잃음(device.lost: reason·message), 잡히지 않은 오류(uncapturederror: 오류 종류·글), 누가 device.destroy()를 불렀는지
// - 일꾼의 console.error·console.warn 글 (TVM이 자세한 오류를 여기에 써요. 길이·개수는 잘라요)
// WebLLM의 메시지와 섞이지 않게 BroadcastChannel('wg-ai-gpu')로 보내요. 이 휴대폰 안에서만 오가요 (어디에도 보내지 않아요)
'use strict';
(() => {
  const G = typeof self !== 'undefined' ? self : globalThis;
  const T0 = Date.now();
  let ch = null;
  try { ch = typeof BroadcastChannel === 'function' ? new BroadcastChannel('wg-ai-gpu') : null; } catch (e) { ch = null; }
  // w: 이 일꾼의 이름(화면이 자기 일꾼 소식만 고르게), ms: 일꾼이 뜨고 몇 ms 뒤
  const send = d => { try { if (ch) ch.postMessage(Object.assign({ w: String(G.name || ''), ms: Date.now() - T0 }, d)); } catch (e) { } };
  const cut = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 500);
  const typeOf = x => { try { return (x && x.constructor && x.constructor.name) || (x && x.name) || typeof x; } catch (e) { return '?'; } };
  // console 글 한 조각을 글로: GPU 오류는 '종류: 글', 잃음 정보는 'lost(까닭): 글', 오류 이벤트는 그 속 오류
  const show = x => {
    try {
      if (x == null || typeof x !== 'object') return String(x);
      if (x.error && typeof x.error === 'object' && 'message' in x.error) return `${typeOf(x.error)}: ${x.error.message}`;
      if ('reason' in x && 'message' in x && !(x instanceof Error)) return `lost(${x.reason}): ${x.message}`;
      if ('message' in x) return `${typeOf(x)}: ${x.message}`;
      const j = JSON.stringify(x);
      return j && j !== '{}' ? j : String(x);
    } catch (e) { return String(x); }
  };
  // console.error·warn: 원래대로 찍고, 앞의 40개만 보내요 (한 줄 400자)
  let logN = 0;
  for (const level of ['error', 'warn']) {
    const orig = console[level];
    if (typeof orig !== 'function') continue;
    console[level] = function (...a) {
      if (logN < 40) { logN++; send({ kind: 'console', level, msg: cut(a.map(show).join(' '), 400) }); }
      return orig.apply(this, a);
    };
  }
  if (typeof G.addEventListener === 'function') {
    G.addEventListener('unhandledrejection', e => { if (logN < 40) { logN++; send({ kind: 'reject', msg: cut(show(e && e.reason), 400) }); } });
    G.addEventListener('error', e => { if (logN < 40) { logN++; send({ kind: 'reject', msg: cut((e && (e.message || show(e.error))) || 'error', 400) }); } });
  }
  // 누가 device.destroy()를 불렀는지: 부른 함수 이름 몇 개 ('tryCreateBuffer'면 버퍼를 못 만들어서, 'dispose'면 잃은 뒤 정리)
  const caller = () => {
    const st = String((new Error()).stack || '').split('\n').slice(3, 9);
    return st.map(l => { const m = l.match(/at (?:async )?(?:([^\s(]+) \()?.*?([\w.-]+\.js):(\d+)/) || l.match(/^\s*([^\s@]*)@.*?([\w.-]+\.js):(\d+)/); return m ? `${m[1] || '?'} ${m[2]}:${m[3]}` : ''; })
      .filter(Boolean).join(' < ').slice(0, 300);
  };
  const LIM = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxStorageBuffersPerShaderStage'];
  const FEAT = ['shader-f16', 'subgroups', 'timestamp-query'];
  let adapterSent = false, devN = 0;
  function watchDevice(dev) {
    const n = ++devN;
    let errN = 0;
    try {
      dev.lost.then(info => send({ kind: 'lost', n, reason: cut(info && info.reason, 40), msg: cut(info && info.message) }), () => { });
    } catch (e) { }
    try {
      dev.addEventListener('uncapturederror', ev => {
        const er = ev && ev.error;
        if (errN++ < 20) send({ kind: 'error', n, type: typeOf(er), msg: cut(er && er.message) });
      });
    } catch (e) { }
    try {
      const destroy = dev.destroy;
      if (typeof destroy === 'function') dev.destroy = function () { send({ kind: 'destroy', n, by: caller() }); return destroy.apply(this, arguments); };
    } catch (e) { }
    return n;
  }
  function watchAdapter(ad) {
    if (!adapterSent) {
      adapterSent = true;
      const inf = ad.info || {}, lim = {}, feats = {};
      for (const k of LIM) try { lim[k] = +ad.limits[k] || 0; } catch (e) { }
      for (const f of FEAT) try { feats[f] = !!ad.features.has(f); } catch (e) { }
      send({ kind: 'adapter', info: { vendor: cut(inf.vendor, 60), architecture: cut(inf.architecture, 60), device: cut(inf.device, 60), description: cut(inf.description, 120) }, fallback: !!(inf.isFallbackAdapter || ad.isFallbackAdapter), limits: lim, feats });
    }
    const req = ad.requestDevice;
    if (typeof req !== 'function') return;
    ad.requestDevice = async function (desc) {
      const want = {}, wl = (desc && desc.requiredLimits) || {};
      for (const k of LIM) if (wl[k] != null) want[k] = +wl[k];
      let dev;
      try { dev = await req.apply(this, arguments); } catch (e) { send({ kind: 'device-fail', type: typeOf(e), msg: cut(e && e.message) }); throw e; }
      const n = dev ? watchDevice(dev) : 0;
      send({ kind: 'device', n, want, feats: ((desc && desc.requiredFeatures) || []).map(String) });
      return dev;
    };
  }
  const gpu = G.navigator && G.navigator.gpu;
  if (gpu && typeof gpu.requestAdapter === 'function') {
    const reqA = gpu.requestAdapter;
    gpu.requestAdapter = async function () {
      const ad = await reqA.apply(this, arguments);
      if (ad) try { watchAdapter(ad); } catch (e) { }
      return ad;
    };
  }
})();
