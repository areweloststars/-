// 그림 스토리 단어 미션: 한 번 열어 두면 인터넷 없이도 열리게 하는 서비스 워커 (게임이 이 폴더(scope ./)에 등록해요)
// - 게임 페이지(./, index.html): 인터넷에서 새 판을 먼저 받아요. 잠깐 기다려도 안 오거나 인터넷이 없으면 저장해 둔 판을 열어요.
// - 이 폴더의 파일(llm/ ocr/ tts/ fonts/ icons/ manifest): 저장해 둔 것을 먼저 쓰고, 없으면 받아서 저장해요.
// - 다른 사이트로 가는 요청(이야기 AI 모델·WebGPU 라이브러리 받기)은 건드리지 않아요. WebLLM이 자기 저장소에 따로 저장해요.
//   이름이 PREFIX로 시작하지 않는 저장소(WebLLM 것 등)는 절대 지우지 않아요.
// - 처음 설치할 때는 작은 핵심만 저장해요(CORE_FILES). 사진 읽기·목소리·글꼴·AI 실행(llm/) 파일은 게임의
//   '인터넷 없이 쓰게 준비하기'로 받거나 처음 쓸 때 저장해요 (처음 열 때 받는 양을 줄이려고요).
// VERSION = 이 폴더 파일들(index.html, sw.js 말고)의 지문. 파일이 바뀌면 바꿔요: npm test가 새 값을 알려 줘요 (app/tests/offline.test.cjs)
const VERSION = '4880f73a27cd';
const PREFIX = 'word-game-';
const CORE = PREFIX + 'core-' + VERSION;
const FILES = PREFIX + 'files-' + VERSION;
const CORE_FILES = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'fonts/fonts.css'];
const PAGE_WAIT_MS = 3000;
const SCOPE = self.registration.scope;
const SCOPE_PATH = new URL(SCOPE).pathname;

// 다른 주소로 옮겨 온 응답은 페이지로 그대로 내줄 수 없어서 새 응답으로 옮겨 담아요
async function plain(r) {
  if (!r.redirected) return r;
  return new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers });
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CORE);
    await Promise.all(CORE_FILES.map(async p => {
      const url = new URL(p, SCOPE).href;
      const r = await fetch(url, { cache: 'reload' });
      if (!r.ok) throw new Error('precache failed: ' + p);
      await c.put(url, await plain(r));
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CORE && k !== FILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 다른 사이트(AI 모델 등)와 이 폴더 밖은 그대로 인터넷으로
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_PATH)) return;
  const path = url.pathname.slice(SCOPE_PATH.length);
  if (path === '' || path === 'index.html') {
    // 새 판 확인(?v=…, 화면이 직접 부름)은 언제나 인터넷으로. 페이지 열기만 여기서 맡아요
    if (req.mode !== 'navigate') return;
    const net = fetch(req).then(async r => {
      if (r.ok && r.type === 'basic') { const c = await caches.open(CORE); await c.put(SCOPE, await plain(r.clone())); }
      return r;
    });
    e.waitUntil(net.then(() => { }, () => { }));
    e.respondWith(page(net));
    return;
  }
  if (path === 'sw.js' || req.headers.has('range')) return;
  e.respondWith(file(e, req));
});

// 페이지: 인터넷 먼저 (PAGE_WAIT_MS까지 기다려요). 안 되면 저장해 둔 판
async function page(net) {
  const old = await caches.match(SCOPE, { cacheName: CORE });
  if (!old) return net;
  const late = new Promise(ok => setTimeout(() => ok(null), PAGE_WAIT_MS));
  try {
    const r = await Promise.race([net, late]);
    if (r && r.ok) return r;
  } catch (x) { }
  return old;
}

// 이 폴더의 파일: 저장해 둔 것 먼저, 없으면 받아서 저장
async function file(e, req) {
  const hit = (await caches.match(req, { cacheName: CORE })) || (await caches.match(req, { cacheName: FILES }));
  if (hit) return hit;
  const r = await fetch(req);
  if (r.status === 200 && r.type === 'basic') {
    const copy = r.clone();
    e.waitUntil(caches.open(FILES).then(c => c.put(req, copy)).catch(() => { }));
  }
  return r;
}
