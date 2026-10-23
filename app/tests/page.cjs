// 테스트용: 게임 화면을 jsdom에서 켜요. 네트워크·음성·그림 그리기(캔버스)는 없는 휴대폰 앱 화면처럼 흉내 내요.
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const { build, parts } = require('../build.cjs');

// 캔버스 2D: 글자 너비 재기만 대충, 나머지 그리기 함수는 아무 일도 안 함
function fakeCanvas() {
  const ctx = { measureText: t => ({ width: String(t).length * 8 }) };
  return new Proxy(ctx, { get: (o, k) => (k in o ? o[k] : () => { }) });
}

// store: localStorage에 미리 넣어 둘 값 { 키: 글 또는 객체 }
// before: 게임 코드보다 먼저 페이지 안에서 돌릴 코드 (가짜 휴대폰 목소리 등, 게임이 켜질 때 살펴보는 것)
function bootPage(store = {}, before = '') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));
  const dom = new JSDOM(build(), { url: 'https://example.test/word-game/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.scrollTo = () => { };
  w.Element.prototype.scrollIntoView = () => { };
  w.matchMedia = () => ({ matches: false, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
  w.HTMLCanvasElement.prototype.getContext = fakeCanvas;
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  w.HTMLMediaElement.prototype.pause = () => { };
  w.HTMLMediaElement.prototype.load = () => { };
  w.URL.createObjectURL = () => 'blob:test';
  w.URL.revokeObjectURL = () => { };
  w.fetch = () => Promise.reject(new Error('no network in tests'));
  for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  const ctx = dom.getInternalVMContext();
  w.addEventListener('error', e => errors.push(String(e.message || e.error)));
  if (before) vm.runInContext(before, ctx, { filename: 'test-before.js' });
  vm.runInContext(parts().js, ctx, { filename: 'word-game/app.js' });
  const run = code => vm.runInContext(code, ctx);
  return {
    window: w,
    document: w.document,
    errors,
    run,
    // 페이지 안 값은 다른 실행 환경의 객체라서 JSON으로 꺼내 비교
    json: code => JSON.parse(run(`JSON.stringify(${code})`)),
    storage: () => { const o = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k); } return o; },
    close: () => w.close()
  };
}

// 시험용 가짜 이야기 AI: 요청 글의 번호 줄('N. ★가 든 줄 (★ = 뜻)')을 모두 고쳐 써요(앞에 까닭을 붙여요). 페이지 안에서 AI.engine = FAKE_AI
// (새 단어장은 이야기 AI가 써야 만들어져요: 단어장을 만드는 시험에 써요)
const FAKE_AI = `{ interruptGenerate() {}, chat: { completions: { create: async req => ({ choices: [{ message: { content: req.messages[0].content.split('\\n').map(l => l.match(/^(\\d+)\\. (.+) \\(★ = [^)]+\\)$/)).filter(Boolean).map(m => m[1] + '. 모두가 깜짝 놀라 지켜보는 가운데, ' + m[2]).join('\\n') } }] }) } } }`;

module.exports = { bootPage, FAKE_AI };
