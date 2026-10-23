/* ---------- 오버레이 ---------- */
function openOverlay(html, bare) {
  closeOverlay();
  const ov = document.createElement('div');
  ov.className = 'ov'; ov.id = 'ov';
  ov.innerHTML = bare ? `<div class="ovc">${html}</div>` : `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  const f = $('.btn', ov); if (f) f.focus({ preventScroll: true });
  return ov;
}
function closeOverlay() { const o = $('#ov'); if (o) o.remove(); }

/* ---------- 이벤트 ---------- */
function bindEvents() {
  // 설정에서 목소리를 바꾸면 바로 들려줌
  $('#home').addEventListener('change', e => {
    const vs = e.target.closest('select[data-voice]');
    if (!vs) return;
    SAVE[vs.dataset.voice + 'Voice'] = vs.value; persist();
    const st = $('#vstat'); if (st) st.textContent = voiceStat();
    voiceTry(vs.dataset.voice === 'ko' ? 'ko-KR' : 'en-US');
  });
  $('#home').addEventListener('click', e => {
    const sb = e.target.closest('.seg button');
    if (sb) {
      const set = sb.parentElement.dataset.set;
      SAVE[set] = set === 'sound' || set === 'narr' || set === 'netVoice' ? sb.dataset.v === 'true' : set === 'rate' ? parseFloat(sb.dataset.v) : sb.dataset.v;
      persist();
      if (set === 'sound' && SAVE.sound) { Sound.unlock(); Sound.play('know'); }
      if ((set === 'rate' || set === 'narr') && SAVE.narr) { Narr.unlock(); sayWord(SCENES[0].words[0], wordRate()).catch(() => { }); }
      renderHome();
      return;
    }
    const mc = e.target.closest('.mcard');
    if (mc) {
      Sound.unlock();
      if (mc.dataset.locked) { Sound.play('bad'); buzz(30); toast(mc.dataset.locked); mc.classList.remove('nope'); void mc.offsetWidth; mc.classList.add('nope'); return; }
      Sound.play('tap'); openMission(mc.dataset.boss ? 'boss' : 'scene', mc.dataset.scene); return;
    }
    if (e.target.closest('[data-review]')) { Sound.unlock(); Sound.play('tap'); openMission('review'); return; }
    if (e.target.closest('[data-decks]')) { Sound.unlock(); Sound.play('tap'); openDecks(); return; }
    if (e.target.closest('[data-make]')) { Sound.unlock(); Sound.play('tap'); openMake(); return; }
    const vt = e.target.closest('[data-act="vtry"]');
    if (vt) { voiceTry(vt.dataset.lang); return; }
    const rs = e.target.closest('[data-reset]');
    if (rs) {
      // 한 번 더 눌러야 초기화 (실수 방지)
      if (rs.dataset.armed) { SAVE.best = {}; SAVE.bank = 0; SAVE.lives = LIVES; persist(); renderHome(); toast('진행을 처음부터 다시 시작해요'); }
      else { rs.dataset.armed = '1'; rs.textContent = '정말 초기화할까요? 한 번 더 누르면 깬 에피소드와 모은 시간이 지워져요'; rs.classList.add('armed'); }
    }
  });
  $('#story').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'home') goHome();
      else if (act === 'vplay') { Sound.unlock(); Narr.unlock(); if (SV.on) svPause(); else svPlay(); }
      else if (act === 'vvoice') {
        SAVE.narr = !SAVE.narr; SV.narrFail = false; persist(); Narr.unlock();
        if (SV.on) svShow(); else if (SV.busy && M.kind === 'scene') svShow(true); else { Narr.stop(); svCtl(); }
      }
      else if (act === 'vspeed') {
        SAVE.rate = RATES[(RATES.indexOf(SAVE.rate) + 1) % RATES.length]; persist(); Narr.unlock();
        Narr.setRate(SAVE.rate);
        // 읽던 줄은 새 속도로 처음부터 (진행 막대·시간이 맞게)
        if (SV.busy && M.kind === 'scene') svShow(!SV.on); else svCtl();
        fsQuiet(true);
      }
      else if (act === 'start') { Sound.unlock(); startPlay(); }
      else if (act === 'vfull') { Sound.unlock(); Narr.unlock(); if (FS.on) exitFS(); else enterFS(); }
      else if (act === 'vfix') vFix();
      else if (act === 'vnet') voiceNetOn();
      else if (act === 'vcopy') copyLink();
      else if (act === 'vout') openOutside();
      return;
    }
    const sb = e.target.closest('.seg button');
    if (sb) { SAVE.diff = sb.dataset.v; persist(); updateBrief(); return; }
    const chip = e.target.closest('.wchip');
    if (chip && SP) {
      Sound.unlock(); Narr.unlock();
      const id = chip.dataset.id;
      if (M.kind === 'scene') {
        const i = SV.lines.findIndex(l => l.word === id);
        // 지금 읽어 주는 단어를 한 번 더 누르면 멈춤
        if (SV.busy && !SV.on && SV.i === i) { svPause(); return; }
        svOne(i);
      }
      else svWord(id);
      return;
    }
    if (e.target.closest('#spanel') && SP) {
      if (FS.on && SP.host.classList.contains('quiet')) { fsQuiet(true); return; }
      if (M.kind === 'scene') { Narr.unlock(); if (SV.on) svPause(); else svPlay(); }
      else if (SP.current) { svHalt(); markChip(null); SP.zoomFull(); SP.current = null; setSub('<p>아래 단어를 누르면 그림 속 장면을 보여 줘요</p>'); }
    }
  });
  $('#play').addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'pause') pause();
      else if (act === 'restart') { Sound.play('tap'); startPlay(); }
      else if (act === 'dir') {
        SAVE.dir = SAVE.dir === 'en' ? 'ko' : 'en'; persist(); setDirChip(); Sound.play('tap');
        // 풀던 카드는 새 방향으로 바꾸되 남은 시간은 그대로 (시간을 다시 채우는 꼼수 방지)
        if (M.queue.length && (M.state === 'ask' || M.state === 'idle')) {
          M.keys = keysFor(curId()); M.cardMs = cardTime(M.keys); M.matched = new Set(); $('#ain').value = ''; fillCard(curId());
          if (M.state === 'idle') { M.cardLeft = M.cardMs; M.lastSec = null; updateFuse(true); fuseTo(1, 0); }
          else { M.cardLeft = Math.min(M.cardLeft, M.cardMs); updateFuse(true); if (M.timing && !M.paused && !(M.grace > 0)) fuseRun(); focusInput(); }
        } else toast(`다음 카드부터 ${SAVE.dir === 'en' ? '영어 보고 뜻 쓰기' : '뜻 보고 영어 쓰기'}로 바뀌어요`);
      } else if (act === 'zoom') { if (!M.full) zoomOutFull(); else if (showing()) zoomIn(); else zoomCard(); }
      return;
    }
    if (e.target.closest('#say')) { const id = curId(); Narr.unlock(); sayWord(id, wordRate()).catch(voiceWait); return; }
    if (e.target.closest('#picbtn')) { togglePic(); return; }
    const fresh = performance.now() - (M.barAt || 0) < 400;
    if (e.target.closest('#dont')) { if (fresh) return; Sound.unlock(); dont(); return; }
    if (e.target.closest('#next')) { if (fresh) return; nextCard(); return; }
  });
  document.addEventListener('click', e => {
    const dk = e.target.closest('[data-deck]');
    if (dk) { Sound.unlock(); Sound.play('tap'); if (dk.dataset.deck !== DECK.id && switchDeck(dk.dataset.deck)) toast(`‘${DECK.name}’ 단어장으로 바꿨어요`); goHome(); return; }
    const dr = e.target.closest('[data-deckredo]');
    if (dr) { Sound.unlock(); Sound.play('tap'); mkRedoDeck(dr.dataset.deckredo); return; }
    const dd = e.target.closest('[data-deckdel]');
    if (dd) {
      // 한 번 더 눌러야 지움 (실수 방지)
      if (!dd.dataset.armed) { dd.dataset.armed = '1'; dd.classList.add('armed'); dd.setAttribute('aria-label', '한 번 더 누르면 지워져요'); toast('한 번 더 누르면 이 단어장과 진행 기록이 지워져요'); return; }
      const id = dd.dataset.deckdel;
      if (DECK.id === id) switchDeck(DECK_BUILTIN.id);
      if (SAVE.decks) delete SAVE.decks[id];
      persist();
      DeckStore.del(id).then(() => { if ($('#ov .decklist')) openDecks(); });
      renderHome(); openDecks(); toast('단어장을 지웠어요');
      return;
    }
    const b = e.target.closest('[data-ov]');
    if (!b) return;
    const a = b.dataset.ov;
    if (a === 'resume') resume();
    else if (a === 'again') startPlay();
    else if (a === 'home') goHome();
    else if (a === 'story') openMission(M.kind, M.key);
    else if (a === 'next') { const n = nextMission(); if (n) openMission(n.kind, n.key); else goHome(); }
    else if (a === 'restart1') openMission('scene', SCENES[0].key);
    else if (a === 'make') openMake();
    else if (a === 'close') closeOverlay();
  });
  window.addEventListener('popstate', onNavBack);
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('keydown', e => {
    if (FS.on && e.key === 'Escape') { e.preventDefault(); exitFS(); return; }
    if (e.key === 'Escape' && $('#ov .decklist')) { e.preventDefault(); closeOverlay(); return; }
    if ($('#play').hidden || $('#ov') || !M.active) return;
    if (e.key === 'Escape') { e.preventDefault(); pause(); }
    else if (e.key === 'Enter' && M.state === 'answer' && document.activeElement !== $('#next')) { e.preventDefault(); if (performance.now() - (M.barAt || 0) >= 400) nextCard(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (M.active && !M.paused && !M.over) pause();
    if (!$('#story').hidden && (SV.on || SV.busy)) svPause(); // 화면이 꺼지면 스토리도 멈춤
    persist();
  });
  // 휴대폰 자판이 올라오면 보이는 높이에 맞춰 미션 화면을 줄여서 입력칸이 자판 바로 위에 오게
  setVVH();
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { setVVH(); if (!$('#play').hidden && window.scrollY) window.scrollTo(0, 0); });
  let rz = 0;
  window.addEventListener('resize', () => {
    setVVH();
    if (window.innerWidth > window.innerHeight) { const r = $('#vrot'); if (r) r.hidden = true; }
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (PP && !$('#play').hidden && M.queue.length) { ppRefit(); fitWords(); }
      if (SP && !$('#story').hidden) spRelayout();
    }, 150);
  });
}

/* ---------- 인터넷 없이 쓰기 (설치하는 웹 앱) ----------
   서비스 워커(word-game/sw.js)가 게임 페이지와 이 폴더의 파일을 이 기기 브라우저에 저장해요.
   한 번 열어 두면 인터넷 없이도 게임이 열려요 (열쇠는 잠금 페이지가 이 기기에 기억해 둬요).
   서비스 워커는 https나 이 컴퓨터(localhost)에서만 돌아요. Claude 화면 안에서는 켜지 않아요. */
const PWA = { reg: null };
function swRegister() {
  try {
    const sw = navigator.serviceWorker;
    if (!sw || window.claude) return;
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!(location.protocol === 'https:' || (location.protocol === 'http:' && local))) return;
    const first = !sw.controller;
    // 처음 저장될 때: 서비스 워커가 맡기 전에 받은 이 폴더의 파일(글꼴 조각 등)을 한 번 더 불러 저장되게 해요 (보통 브라우저에 남아 있어서 금방이에요)
    if (first) sw.addEventListener('controllerchange', () => setTimeout(swWarm, 500), { once: true });
    PWA.reg = sw.register(new URL('sw.js', location.href).href, { scope: './' }).catch(() => null);
  } catch (e) { }
}
function swWarm() {
  try {
    const base = new URL('./', location.href).href;
    const seen = new Set();
    for (const e of performance.getEntriesByType('resource')) {
      const u = String(e.name || '').split('#')[0];
      if (!u.startsWith(base) || u === base || /index\.html|sw\.js|\?/.test(u.slice(base.length)) || seen.has(u)) continue;
      seen.add(u);
      fetch(u).then(r => r.arrayBuffer()).catch(() => { });
    }
  } catch (e) { }
}
// 서비스 워커가 이 페이지를 맡을 때까지 기다려요 (처음 열 때는 조금 걸려요). 맡으면 true
function swControl(ms) {
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
  if (!sw || sw.controller || !PWA.reg) return Promise.resolve(!!(sw && sw.controller));
  return new Promise(ok => {
    const t = setTimeout(() => ok(!!sw.controller), ms);
    sw.addEventListener('controllerchange', () => { clearTimeout(t); ok(true); }, { once: true });
  });
}
// 인터넷 없이 쓰려고 미리 받아 둘 파일: 사진 읽기(OCR), 목소리(TTS), 이야기 AI를 돌리는 WebLLM(llm/). [경로, 바이트]
// (app/tests/offline.test.cjs가 실제 파일과 맞는지 봐요. llm/은 처음 열 때 받지 않으려고 sw.js가 미리 저장하지 않아요)
// 글꼴 조각은 fonts/fonts.css에 적힌 것을 모두 받아요. 이야기 AI 모델은 WebLLM이 따로 받아 저장해요
const OFFLINE_FILES = [
  ['llm/web-llm.js', 6821360], ['llm/worker.js', 1379], ['llm/gpu-watch.js', 7005],
  ['ocr/tesseract.min.js', 66695], ['ocr/worker.min.js', 123724], ['ocr/tesseract-core-lstm.wasm.js', 3938277],
  ['ocr/eng-traineddata.wasm', 2952873], ['ocr/kor-traineddata.wasm', 1572336], ['ocr/words-en.txt', 1139787], ['ocr/ko-lex.txt', 1900788],
  ['tts/voices.json', 1582], ['tts/espeak-ng.js', 178386], ['tts/espeak-ng-gz.wasm', 9137545], ['tts/ort.wasm.min.js', 49026],
  ['tts/ort-wasm-simd-threaded.mjs', 24618], ['tts/ort-wasm-simd-threaded.wasm', 11246032], ['tts/en-joe.0.wasm', 9000000], ['tts/en-joe.1.wasm', 7599901]
];
const OFFLINE_FONT = 11000; // 글꼴 조각 하나 (평균 바이트, 진행률용)
const OFFLINE_FONTS = 467;
const offlineMB = () => Math.round((OFFLINE_FILES.reduce((a, f) => a + f[1], 0) + OFFLINE_FONTS * OFFLINE_FONT) / 1048576);
// 다 받아 둔 적이 있는지: 사진 읽기·목소리 파일이 모두 저장소(서비스 워커)에 있으면 true
async function offlineHave() {
  try {
    if (typeof caches === 'undefined' || !(navigator.serviceWorker && navigator.serviceWorker.controller)) return false;
    for (const [p] of OFFLINE_FILES) if (!(await caches.match(new URL(p, location.href).href))) return false;
    return true;
  } catch (e) { return false; }
}
// 받아 두기: 파일을 한 번씩 불러요. 서비스 워커가 맡고 있으면 그때 이 기기에 저장해요. onProg(0~1)
// 돌려줌: { bad: 못 받은 파일, stored: 저장됐는지(서비스 워커가 맡았는지) }. 그만두면 { code: 'cancelled' }
async function offlinePrep(onProg, signal) {
  const stop = () => { if (signal && signal.aborted) throw { code: 'cancelled' }; };
  const stored = await swControl(20000);
  stop();
  const url = p => new URL(p, location.href).href;
  let fonts = [];
  try {
    const r = await fetch(url('fonts/fonts.css'), { signal });
    if (r.ok) fonts = [...new Set((await r.text()).match(/files\/[\w.-]+\.woff2/g) || [])].map(f => ['fonts/' + f, OFFLINE_FONT]);
  } catch (e) { stop(); }
  const list = OFFLINE_FILES.concat(fonts), total = list.reduce((a, f) => a + f[1], 0), bad = [];
  let got = 0;
  const tick = n => { got += n; if (onProg) onProg(Math.min(1, got / total)); };
  const one = async ([p, size]) => {
    let n = 0;
    try {
      const r = await fetch(url(p), { signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (r.body && r.body.getReader) {
        const rd = r.body.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; const k = Math.min(value.length, size - n); if (k > 0) { n += k; tick(k); } }
      } else await r.arrayBuffer();
    } catch (e) { stop(); bad.push(p); }
    if (n < size) tick(size - n);
  };
  const queue = list.slice();
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) { stop(); await one(queue.shift()); } }));
  return { bad, stored };
}

function boot(data) {
  loadSave();
  if (data && data.save && typeof data.save === 'object') Object.assign(SAVE, data.save);
  snapshotBuiltin();
  for (const d of PRIVATE_DECKS) DeckStore.seed(d);
  bootDeck();
  if (!DIFF[SAVE.diff]) SAVE.diff = 'normal';
  if (SAVE.dir !== 'en' && SAVE.dir !== 'ko') SAVE.dir = 'en';
  if (typeof SAVE.narr !== 'boolean') SAVE.narr = true;
  if (typeof SAVE.netVoice !== 'boolean') SAVE.netVoice = false;
  if (!RATES.includes(SAVE.rate)) SAVE.rate = 1;
  for (const k of ['best', 'wrong', 'seen', 'decks']) if (!SAVE[k] || typeof SAVE[k] !== 'object' || Array.isArray(SAVE[k])) SAVE[k] = {};
  SAVE.sound = SAVE.sound !== false;
  if (!(SAVE.lives > 0)) { SAVE.best = {}; SAVE.bank = 0; SAVE.lives = LIVES; }
  SAVE.lives = Math.min(LIVES, Math.round(SAVE.lives)); SAVE.bank = clamp(+SAVE.bank || 0, 0, BANK_MAX);
  const keep = new Set([...SCENES.map(s => s.key), 'boss', 'review']);
  for (const k in SAVE.best) if (!keep.has(k) || !SAVE.best[k] || typeof SAVE.best[k].elapsed !== 'number') delete SAVE.best[k];
  document.documentElement.lang = 'ko';
  bindEvents();
  bindMake();
  renderHome();
  showScreen('home');
  mkInit();
  // AI 진단 중에 탭이 꺼졌으면 (다음에 열 때) 결과가 남아 있다고 알려요
  try { const b = aiBenchLoad(); if (b && b.crashNew) { b.crashNew = false; setTimeout(() => toast('AI 진단 중에 탭이 꺼졌어요. 새 단어장 만들기 화면에서 결과를 볼 수 있어요'), 1200); } } catch (e) { }
  // 내 Claude 계정 저장소에 연결되면 다른 기기에서 만든 단어장도 목록에 보임
  DeckStore.onChange(() => { if ($('#ov .decklist')) openDecks(); });
  DeckStore.connect();
  swRegister();
  setTimeout(() => checkNewBuild(true), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNewBuild(false); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!$('#play').hidden && M.queue.length) fitWords(); });
}
// 새 판 알림: 휴대폰에 옛 판이 열려 있으면(탭을 닫지 않았거나 브라우저가 기억해 둔 판) 띠를 보여 주고, 누르면 새로 고쳐요.
// 사이트 파일 속 지문("sum")을 이 판의 지문(잠금 페이지가 남긴 WG_BUILD)과 견줘요. 열 때와 화면으로 돌아올 때(10분에 한 번까지)
// 인터넷이 없으면 하지 않아요. 사이트 파일만 받아 보고, 이 기기의 단어·기록·열쇠는 아무것도 보내지 않아요
let buildCheckedAt = 0;
async function checkNewBuild(force) {
  const cur = window.WG_BUILD;
  if (!cur || !/^https?:$/.test(location.protocol) || $('#newbuild') || navigator.onLine === false) return false;
  if (!force && Date.now() - buildCheckedAt < 10 * 60 * 1000) return false;
  buildCheckedAt = Date.now();
  try {
    const r = await fetch(location.pathname + '?v=' + Date.now(), { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    const m = (await r.text()).match(/"sum":"([0-9a-f]{12})/);
    if (!m || m[1] === cur) return false;
  } catch (e) { return false; }
  const bar = document.createElement('button');
  bar.type = 'button'; bar.id = 'newbuild'; bar.className = 'newbuild';
  bar.innerHTML = '<b>새 판이 나왔어요</b> · 눌러서 새로 고침';
  bar.addEventListener('click', () => { if (MK.step === 'making' && !confirmTap(bar)) return; location.reload(); });
  document.body.appendChild(bar);
  return true;
}
// 만드는 중이면 한 번 더 눌러야 새로 고쳐요 (만들던 단어장이 사라지니까)
// html: 처음 눌렀을 때 단추에 보일 글 (한 번 더 누르면 true)
function confirmTap(el, html = '<b>단어장을 만드는 중이에요</b> · 한 번 더 누르면 멈추고 새로 고쳐요') { if (el.dataset.armed) return true; el.dataset.armed = '1'; el.innerHTML = html; return false; }
const buildLabel = () => window.WG_BUILD ? `판 ${String(window.WG_BUILD).slice(0, 7)}` : '';
const HOT = window.claude && window.claude.hot;
try { if (HOT && HOT.snapshot) HOT.snapshot(() => ({ save: SAVE })); } catch (e) { }
if (HOT && HOT.ready) HOT.ready(boot); else boot((HOT && HOT.data) || {});

