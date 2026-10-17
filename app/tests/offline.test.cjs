// 인터넷 없이 쓰기: 설치용 웹 앱 정보(manifest), 서비스 워커(sw.js), 글꼴을 이 사이트에서, 미리 받아 둘 파일 목록
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { build, parts } = require('../build.cjs');
const { bootPage } = require('./page.cjs');

const GAME = path.join(__dirname, '..', '..', 'word-game');
const rd = p => fs.readFileSync(path.join(GAME, p));
const walk = d => fs.readdirSync(path.join(GAME, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name).split(path.sep).join('/')]);
// sw.js의 VERSION: 이 폴더 파일들(index.html·sw.js 말고)의 지문. 파일이 바뀌면 저장해 둔 옛 파일을 버리고 새로 받아요
function staticSum() {
  const h = crypto.createHash('sha256');
  for (const f of walk('').sort()) if (f !== 'index.html' && f !== 'sw.js') h.update(f + '\0').update(rd(f)).update('\0');
  return h.digest('hex').slice(0, 12);
}
const SW = rd('sw.js').toString('utf8');

test('sw.js VERSION matches the static files, and its core files exist', () => {
  const v = (SW.match(/const VERSION = '([^']*)'/) || [])[1];
  assert.equal(v, staticSum(), `word-game/ 파일이 바뀌었어요. word-game/sw.js의 VERSION을 '${staticSum()}'(으)로 바꿔 주세요`);
  const core = JSON.parse(SW.match(/const CORE_FILES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  for (const f of core) if (f !== './') assert.ok(fs.existsSync(path.join(GAME, f)), f);
});

test('manifest: Korean game name, start_url ./, icons 192/512/maskable with real sizes; pages link it', () => {
  const m = JSON.parse(rd('manifest.webmanifest'));
  const title = parts().shell.match(/<title>([^<]+)<\/title>/)[1];
  assert.equal(m.name, title);
  assert.ok(m.short_name && m.short_name.length <= 12);
  assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.display, 'standalone');
  assert.match(m.background_color, /^#[0-9A-F]{6}$/i); assert.match(m.theme_color, /^#[0-9A-F]{6}$/i);
  const png = f => { const b = rd(f); assert.equal(b.toString('latin1', 1, 4), 'PNG', f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const sizes = m.icons.map(i => [i.sizes, i.purpose, png(i.src).join('x')]);
  assert.deepEqual(sizes, [['192x192', 'any', '192x192'], ['512x512', 'any', '512x512'], ['512x512', 'maskable', '512x512']]);
  for (const page of [parts().shell, fs.readFileSync(path.join(__dirname, '..', 'src', 'lock.html'), 'utf8')]) {
    assert.match(page, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(page, /<meta name="theme-color" content="#[0-9A-F]{6}"/i);
  }
});

test('the game loads no third-party files: fonts come from fonts/fonts.css next to the page', () => {
  const html = build();
  assert.match(html, /<link rel="stylesheet" href="fonts\/fonts\.css">/);
  assert.doesNotMatch(html, /googleapis|gstatic/);
  // 페이지가 받아 오는 주소(href·src·url())는 모두 이 사이트 안의 상대 주소
  for (const m of html.matchAll(/(?:href|src)="([^"]*)"|url\((['"]?)([^)'"]*)\2\)/g)) {
    const u = m[1] || m[3] || '';
    assert.ok(!/^(?:https?:)?\/\//i.test(u), u);
  }
  const css = rd('fonts/fonts.css').toString('utf8');
  const files = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
  assert.ok(files.length > 100);
  let bytes = 0;
  for (const f of files) { assert.match(f, /^files\/[\w.-]+\.woff2$/); bytes += fs.statSync(path.join(GAME, 'fonts', f)).size; }
  assert.ok(bytes < 10 * 1048576, `fonts ${bytes} bytes`);
  for (const fam of ['Black Han Sans', 'IBM Plex Sans KR', 'Lilita One', 'Noto Sans']) assert.ok(css.includes(`font-family:'${fam}'`), fam);
  for (const w of [400, 500, 600, 700]) assert.ok(css.includes(`font-family:'IBM Plex Sans KR';font-style:normal;font-weight:${w}`), w);
  assert.equal((css.match(/font-display:swap/g) || []).length, files.length);
  assert.ok(fs.existsSync(path.join(GAME, 'fonts', 'OFL.txt')));
  // 앱이 미리 받는 글꼴 수와 맞아요
  const p = bootPage();
  try { assert.equal(p.json('OFFLINE_FONTS'), new Set(files).size); } finally { p.close(); }
});

test('offline files: the list matches the OCR and voice files, and getting ready fetches them all with progress', async () => {
  const want = ['ocr', 'tts'].flatMap(d => walk(d)).filter(f => !/LICENSE|NOTICE|COPYRIGHT/.test(f)).sort();
  const p = bootPage();
  try {
    const list = p.json('OFFLINE_FILES');
    assert.deepEqual(list.map(f => f[0]).sort(), want);
    for (const [f, n] of list) assert.equal(n, fs.statSync(path.join(GAME, f)).size, f);
    assert.ok(p.json('offlineMB()') >= 45 && p.json('offlineMB()') <= 60);
    // 서비스 워커가 맡은 페이지처럼: 파일마다 한 번씩 받고, 진행률은 0 → 1
    p.run(`window.__got = []; window.__prog = [];
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
      window.fetch = async u => { __got.push(String(u)); return /fonts\\.css$/.test(u) ? { ok: true, text: async () => "src:url(files/a-400.woff2) x url(files/b-400.woff2)" } : /missing/.test(u) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };`);
    const r = await p.run('offlinePrep(x => __prog.push(x), null)');
    const got = p.json('__got').map(u => u.replace('https://example.test/word-game/', ''));
    assert.deepEqual(got.filter(u => !/fonts/.test(u)).sort(), want);
    assert.ok(got.includes('fonts/files/a-400.woff2') && got.includes('fonts/files/b-400.woff2'));
    const prog = p.json('__prog');
    assert.equal(prog[prog.length - 1], 1);
    assert.ok(prog.every((x, i) => i === 0 || x >= prog[i - 1]));
    assert.equal(r.stored, true); assert.equal(r.bad.length, 0);
    // 못 받은 파일은 모아서 알려요. 그만두면 멈춰요
    p.run(`window.fetch = async u => /en-joe/.test(u) ? { ok: false, status: 404 } : { ok: true, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) };`);
    const r2 = await p.run('offlinePrep(null, null)');
    assert.deepEqual(Array.from(r2.bad).sort(), ['tts/en-joe.0.wasm', 'tts/en-joe.1.wasm']);
    const c = new p.window.AbortController(); c.abort();
    p.window.__c = c;
    assert.equal(await p.run('offlinePrep(null, __c.signal).then(() => "done", e => e.code)'), 'cancelled');
  } finally { p.close(); }
});

test('make screen: one button gets the files and the story AI ready for offline use, and says when it is done', async () => {
  const p = bootPage();
  try {
    p.run(`Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
      window.fetch = async u => ({ ok: true, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) });
      AI.retryMs = 0; window.Worker = class { addEventListener() { } terminate() { } };
      AI.lib = { prebuiltAppConfig: { model_list: [{ model_id: AI_MODEL }] }, CreateWebWorkerMLCEngine: async (w, id, cfg) => { cfg.initProgressCallback({ progress: 0.5, text: 'Fetching param cache[3/20]' }); return { chat: {} }; } };
      AI.gpu = true; MK.step = 'pick'; MK.aiWhy = ''; showScreen('make'); renderMake();`);
    const box = () => p.document.getElementById('mkai');
    await new Promise(r => setTimeout(r, 10));
    assert.match(box().textContent, /이야기 AI\(Gemma 4\)를 쓸 수 있어요.*약 3GB.*사진 읽기·목소리 파일\(약 \d+MB\).*와이파이.*비행기 모드.*인터넷 없이 쓰게 준비하기/);
    box().querySelector('[data-mk="aidl"]').click();
    await new Promise(r => setTimeout(r, 60));
    assert.match(box().textContent, /인터넷 없이 쓸 준비가 됐어요.*이야기 AI\(Gemma 4\)를 이 기기에 받아 두었어요.*사진 읽기·목소리 파일도/);
    assert.equal(box().querySelector('[data-mk="aidl"]'), null);
    // 이야기 AI를 못 쓰는 휴대폰도 사진 읽기·목소리 파일은 받아 둘 수 있어요
    p.run(`MK.aiWhy = '이 브라우저에는 AI 계산 기능(WebGPU)이 없어요.'; MK.offline = 'no'; MK.aiDl = null; mkAiPut();`);
    assert.match(box().textContent, /이야기 AI를 쓸 수 없어요.*WebGPU.*인터넷 없이 쓰게 준비하기/);
    // 서비스 워커가 없는 브라우저: 저장해 둘 수 없다고 말해요
    p.run(`Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });`);
    box().querySelector('[data-mk="aidl"]').click();
    await new Promise(r => setTimeout(r, 40));
    assert.match(box().textContent, /저장해 두지 못해서 인터넷 없이는 열리지 않아요/);
    assert.deepEqual(p.errors, []);
  } finally { p.close(); }
});

test('service worker registers only on https or localhost, never inside the Claude app; the new-build check skips when offline', async () => {
  const p = bootPage();
  try {
    p.run(`window.__reg = []; Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: null, addEventListener() { }, register: async (u, o) => { __reg.push([u, o.scope]); return {}; } } });`);
    p.run('swRegister()');
    assert.deepEqual(p.json('__reg'), [['https://example.test/word-game/sw.js', './']]);
    p.run('window.claude = {}; swRegister(); delete window.claude;');
    assert.equal(p.json('__reg.length'), 1);
    // 인터넷이 없으면 새 판 확인을 하지 않아요 (아무 요청도 없어요)
    p.window.WG_BUILD = 'aaaaaaaaaaaa';
    let asked = 0;
    p.window.fetch = async () => { asked++; return { text: async () => '' }; };
    Object.defineProperty(p.window.navigator, 'onLine', { configurable: true, value: false });
    assert.equal(await p.run('checkNewBuild(true)'), false);
    assert.equal(asked, 0);
    // 인터넷이 있으면 사이트 파일만 받아요: 쿠키·리퍼러 없이, 기기의 단어·열쇠는 주소에 넣지 않아요
    let opts = null, url = '';
    p.window.fetch = async (u, o) => { url = String(u); opts = o; return { text: async () => '' }; };
    Object.defineProperty(p.window.navigator, 'onLine', { configurable: true, value: true });
    p.window.localStorage.setItem('word-game-site-key', 'K'.repeat(43));
    await p.run('checkNewBuild(true)');
    assert.match(url, /^\/word-game\/\?v=\d+$/);
    assert.equal(opts.credentials, 'omit'); assert.equal(opts.referrerPolicy, 'no-referrer'); assert.equal(opts.cache, 'no-store');
  } finally { p.close(); }
});

// sw.js를 가짜 브라우저(caches·fetch·self)에서 돌려요
function swEnv(online) {
  const stores = new Map(), handlers = {};
  const keyOf = r => typeof r === 'string' ? r : r.url;
  const mkCache = name => { if (!stores.has(name)) stores.set(name, new Map()); const m = stores.get(name); return { put: async (k, v) => { m.set(keyOf(k), v); }, match: async k => m.get(keyOf(k)) }; };
  const res = (body, extra = {}) => ({ ok: true, status: 200, type: 'basic', redirected: false, body, clone() { return res(body, extra); }, ...extra });
  const net = [];
  const env = {
    URL, Response: class { constructor(b, o) { this.body = b; Object.assign(this, o); } }, console,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; },
    caches: {
      open: async n => mkCache(n), keys: async () => [...stores.keys()], delete: async n => stores.delete(n),
      match: async (k, o) => { for (const [n, m] of stores) if (!o || !o.cacheName || o.cacheName === n) { const v = m.get(keyOf(k)); if (v) return v; } }
    },
    fetch: async r => { net.push(keyOf(r)); if (!online.on) throw new TypeError('Failed to fetch'); return res('net:' + keyOf(r)); },
    self: { registration: { scope: 'https://site.test/-/word-game/' }, location: { origin: 'https://site.test' }, addEventListener: (k, f) => { handlers[k] = f; }, skipWaiting: async () => { }, clients: { claim: async () => { } } }
  };
  env.self.caches = env.caches;
  vm.runInNewContext(SW, env);
  const fire = async (k, ev) => { const waits = []; let resp = null; ev.waitUntil = p => waits.push(p); ev.respondWith = p => { resp = p; }; handlers[k](ev); await Promise.all(waits); return resp ? await resp : undefined; };
  const req = (url, mode = 'cors') => ({ url, method: 'GET', mode, headers: { has: () => false } });
  return { stores, fire, req, net };
}

test('sw.js: the page is network-first with a cached fallback, static files cache-first, other sites untouched', async () => {
  const online = { on: true };
  const { stores, fire, req, net } = swEnv(online);
  await fire('install', {});
  const v = SW.match(/const VERSION = '([^']*)'/)[1];
  assert.ok(stores.get('word-game-core-' + v).has('https://site.test/-/word-game/'));
  assert.ok(stores.get('word-game-core-' + v).has('https://site.test/-/word-game/fonts/fonts.css'));
  // 남의 저장소(WebLLM)와 옛 판 저장소: 옛 판만 지워요
  stores.set('webllm/model', new Map()); stores.set('word-game-files-old', new Map());
  await fire('activate', {});
  assert.ok(stores.has('webllm/model')); assert.ok(!stores.has('word-game-files-old'));
  // 페이지: 인터넷이 되면 새 판, 안 되면 저장해 둔 판
  const page = 'https://site.test/-/word-game/';
  assert.equal((await fire('fetch', { request: req(page, 'navigate') })).body, 'net:' + page);
  online.on = false;
  assert.equal((await fire('fetch', { request: req(page + 'index.html', 'navigate') })).body, 'net:' + page);
  // 이 폴더의 파일: 처음엔 받아서 저장, 다음엔 인터넷 없이 저장해 둔 것
  online.on = true;
  const f = page + 'tts/voices.json';
  assert.equal((await fire('fetch', { request: req(f) })).body, 'net:' + f);
  online.on = false;
  const n0 = net.length;
  assert.equal((await fire('fetch', { request: req(f) })).body, 'net:' + f);
  assert.equal(net.length, n0, '저장해 둔 것을 써요');
  // 다른 사이트(AI 모델)·새 판 확인(?v=)·이 폴더 밖은 건드리지 않아요
  assert.equal(await fire('fetch', { request: req('https://huggingface.co/mlc-ai/x/resolve/main/params_shard_0.bin') }), undefined);
  assert.equal(await fire('fetch', { request: req(page + '?v=1') }), undefined);
  assert.equal(await fire('fetch', { request: req('https://site.test/-/index.html', 'navigate') }), undefined);
});
