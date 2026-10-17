/* ================= 휴대폰 안 AI로 이야기 쓰기 (Gemma 4 E2B, WebLLM) =================
   처음 한 번 AI 모델(약 3GB)을 와이파이로 받아 브라우저에 저장하고, 그다음부터는 인터넷 없이(비행기 모드에서도) 이 기기에서 이야기를 써요.
   단어·사진·이야기는 이 휴대폰 밖으로 나가지 않아요.
   이야기 틀·인물·단어 순서(말썽 → 해결)는 앱이 정하고(mkStory), AI는 앱이 쓴 이야기 전체를 보고
   번호 붙은 단어 줄만 더 재미있게 고쳐 써요 (누가 무엇을 하는지는 그대로: 그림도 그 인물로 그려져 있어요).
   AI 문장에 단어 뜻이 없거나 이상하면 그 줄은 앱 문장을 그대로 둬요.
   모델 파일은 저장소에 없어요: word-game/llm/NOTICE.txt (Gemma 4: Apache 2.0) */
const AI_MODEL = 'gemma-4-E2B-it-q4f16_1-MLC';
const AI_SIZE = '약 3GB';
// gen: 준비를 그만둘 때마다 늘어요 (그만둔 준비가 늦게 끝나도 쓰지 않게)
const AI = { engine: null, loading: null, gpu: null, worker: null, gen: 0, onProgress: null, onRetry: null, err: null, phase: { step: 'init', pct: 0 } };
const aiURL = p => new URL(p, location.href).href;
// WebLLM의 모델 기록 (가짜 AI.lib 또는 받아 둔 AI.web). 아직 안 받았으면 null
const aiRec = () => { const L = AI.lib || AI.web, list = L && L.prebuiltAppConfig && L.prebuiltAppConfig.model_list; return (list && list.find(m => m.model_id === AI_MODEL)) || null; };
// 그래픽 칩이 한 번에 다뤄야 하는 버퍼 크기 (모델 기록 값, 없으면 WebLLM 0.2.86 기록의 192MB)
const AI_BUF = 201326592;
const aiBufNeed = () => +((aiRec() || {}).buffer_size_required_bytes) || AI_BUF;
// 이 기기에서 AI를 돌릴 수 있는지: 메모리(RAM) 4GB 이상 + WebGPU + 반정밀도(shader-f16) + 큰 버퍼.
// 이 모델은 f16 셰이더가 있어야 돌아가고, 그래픽 칩이 192MB짜리 버퍼를 다룰 수 있어야 해요
async function aiGpuOk() {
  if (AI.gpu != null) return AI.gpu;
  try {
    const mem = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
    if (typeof mem === 'number' && mem < 4) { AI.gpu = false; AI.gpuWhy = 'mem'; AI.gpuMem = mem; return false; }
    const a = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const f16 = !!(a && a.features && a.features.has('shader-f16'));
    AI.gpuBuf = a && a.limits ? +a.limits.maxStorageBufferBindingSize || 0 : 0;
    AI.gpuWhy = !navigator.gpu ? 'nogpu' : !a ? 'noadapter' : !f16 ? 'nof16' : AI.gpuBuf < aiBufNeed() ? 'buf' : '';
    AI.gpu = !AI.gpuWhy;
  } catch (e) { AI.gpu = false; AI.gpuWhy = 'noadapter'; }
  return AI.gpu;
}
// 앱 안에서 열린 브라우저 (카카오톡·네이버·인스타그램 …): 이런 화면은 대개 AI 계산 기능(WebGPU)이 없어요
const AI_INAPP = [[/KAKAOTALK/i, '카카오톡'], [/NAVER\(inapp|NAVER/, '네이버 앱'], [/Instagram/, '인스타그램'], [/FBAN|FBAV|FB_IAB/, '페이스북'], [/\bLine\//, '라인'], [/DaumApps/, '다음 앱'], [/everytimeApp/i, '에브리타임'], [/; wv\)/, '다른 앱']];
// 이 브라우저에서 이야기 AI를 못 쓰는 까닭 ('' = 쓸 수 있어요)
async function aiWhyNot() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '', app = (AI_INAPP.find(([re]) => re.test(ua)) || [])[1];
  if (await aiGpuOk()) return '';
  if (AI.gpuWhy === 'mem') return `이 휴대폰은 메모리(RAM)가 작아서${AI.gpuMem ? `(약 ${AI.gpuMem}GB)` : ''} 이야기 AI를 돌릴 수 없어요. 이야기 AI는 4GB 넘게 필요해요. 게임은 앱이 쓴 문장으로 그대로 할 수 있어요.`;
  if (app) return `${app} 안에서 열린 화면이에요. 오른쪽 위 ⋮ 메뉴에서 ‘다른 브라우저로 열기’를 눌러 크롬으로 열어 주세요.`;
  if (AI.gpuWhy === 'nogpu') return '이 브라우저에는 AI 계산 기능(WebGPU)이 없어요. 휴대폰의 최신 크롬으로 열어 주세요.';
  if (AI.gpuWhy === 'nof16') return '이 휴대폰의 그래픽 칩이 이야기 AI에 필요한 기능(16비트 계산)을 지원하지 않아요.';
  if (AI.gpuWhy === 'buf') return `이 휴대폰의 그래픽 칩은 한 번에 다룰 수 있는 크기가 작아요(약 ${Math.round(AI.gpuBuf / 1048576)}MB, 이야기 AI는 약 ${Math.round(aiBufNeed() / 1048576)}MB 필요). 그래서 이야기 AI를 돌릴 수 없어요.`;
  return '이 휴대폰의 그래픽 칩을 AI 계산에 쓸 수 없어요. 크롬을 최신으로 업데이트한 뒤 다시 열어 보세요.';
}
// 전에 모델을 다 받아 둔 적이 있는지 (처음 안내 문구에만 써요)
const aiReadyBefore = () => { try { return localStorage.getItem('wg-ai-ready') === AI_MODEL; } catch (e) { return false; } };
// AI 일꾼을 멈추고 처음 상태로 (준비 실패·그만두기·GPU를 잃었을 때)
function aiDrop() {
  const w = AI.worker;
  AI.gen++; AI.worker = null; AI.engine = null; AI.loading = null; AI.onProgress = null;
  if (w) try { w.terminate(); } catch (e) { }
}
// 모델 준비: 처음이면 내려받고(진행률 onProgress(0~1, 단계 글)), 다음부터는 저장된 것으로 금방
// 인터넷이 끊겨 실패하면 잠깐 쉬었다가 두 번 더 해 봐요 (다 받은 조각은 브라우저에 저장돼 있어서 이어 받아요)
const AI_TRIES = 3;
const AI_CTX = 4096;
function aiLoad(onProgress) {
  if (AI.engine) return Promise.resolve(AI.engine);
  if (!AI.loading) {
    const gen = AI.gen;
    AI.err = null; AI.phase = { step: 'init', pct: 0 };
    AI.loading = (async () => {
      const lib = AI.lib || (AI.web = AI.web || await import(aiURL('llm/web-llm.js'))); // AI.lib: 시험용 가짜
      if (gen !== AI.gen) throw { code: 'cancelled' };
      // 처음 받을 때: 브라우저가 이 사이트 저장 공간을 지우지 않게 부탁하고, 쓸 수 있는 공간을 확인해요
      if (!aiReadyBefore()) { await aiDropOld(lib); const st = await aiStorage(); if (st && st.quota && st.quota < AI_NEED) throw { code: 'quota', quota: st.quota }; }
      for (let t = 1; ; t++) {
        try { return await aiStart(lib, gen); }
        catch (e) {
          if (gen !== AI.gen || t >= AI_TRIES || !aiNetErr(e)) throw e;
          if (AI.onRetry) AI.onRetry(t);
          await new Promise(r => setTimeout(r, AI.retryMs == null ? 1500 * t : AI.retryMs));
          if (gen !== AI.gen) throw { code: 'cancelled' };
        }
      }
    })().catch(e => {
      if (/ShaderF16|FeatureSupport|shader-f16/i.test(String((e && e.message) || e))) AI.gpu = false;
      if (gen === AI.gen) { AI.err = aiErrInfo(e); aiDrop(); }
      throw e;
    });
  }
  AI.onProgress = onProgress;
  return AI.loading;
}
// 한 번 해 보기: 새 일꾼을 띄워 모델을 올려요. 실패하면 일꾼을 닫아요
async function aiStart(lib, gen) {
  const worker = AI.worker = new Worker(aiURL('llm/worker.js'), { type: 'module' });
  // 일꾼이 아예 못 뜨면(파일을 못 받음 등) 답이 영영 안 오니, 오류가 나면 바로 끝내요
  const dead = new Promise((_, no) => worker.addEventListener('error', e => no(new Error('ai worker: ' + ((e && e.message) || 'failed to start'))), { once: true }));
  dead.catch(() => { });
  // f16이 없는 기기는 3GB를 다 받기 전에 거절되게 (모델 기록에도 있지만 빠지지 않게 늘 넣어요)
  const rec = lib.prebuiltAppConfig && lib.prebuiltAppConfig.model_list.find(m => m.model_id === AI_MODEL);
  // WebLLM의 sliding_window_size는 모델 속 '부분 주의'가 아니라 기억(KV 캐시) 전체를 고리처럼 돌려 쓰는 설정이에요.
  // 모델 설정이 '전체 창'과 '미끄럼 창'을 둘 다 켜 두면 켜다가 멈춰요 (WindowSizeConfigurationError).
  // 전체 창만 쓰게 맞춰요(-1 = 끔): 이야기 한 편(지시 + 이야기 + 답)은 4천 토큰 안에 들어가요
  const appConfig = rec ? { ...lib.prebuiltAppConfig, model_list: [{ ...rec, required_features: ['shader-f16'], overrides: { ...(rec.overrides || {}), context_window_size: AI_CTX, sliding_window_size: -1, attention_sink_size: -1 } }] } : undefined;
  try {
    const eng = await Promise.race([lib.CreateWebWorkerMLCEngine(worker, AI_MODEL, {
      appConfig,
      initProgressCallback: p => {
        if (gen !== AI.gen) return;
        const t = String(p.text || ''), pct = Math.floor(Math.max(0, Math.min(1, +p.progress || 0)) * 100);
        const step = /^Fetching param/.test(t) ? 'fetch' : /^Loading model from cache/.test(t) ? 'load' : /^Loading GPU shader/.test(t) ? 'shader' : AI.phase.step;
        AI.phase = { step, pct: step === AI.phase.step || step !== 'init' ? pct : AI.phase.pct };
        if (AI.onProgress) AI.onProgress(+p.progress || 0, t);
      }
    }), dead]);
    if (gen !== AI.gen) throw { code: 'cancelled' };
    try { localStorage.setItem('wg-ai-ready', AI_MODEL); } catch (e) { }
    AI.engine = eng;
    return eng;
  } catch (e) {
    if (AI.worker === worker) { AI.worker = null; try { worker.terminate(); } catch (x) { } }
    throw e;
  }
}
// 예전 이야기 AI(Gemma 3 1B, 약 0.7GB)를 받아 둔 휴대폰: 새 AI를 받기 전에 옛 모델을 브라우저 저장소에서 지워 공간을 비워요
async function aiDropOld(lib) {
  let old = '';
  try { old = localStorage.getItem('wg-ai-ready') || ''; } catch (e) { }
  if (!old || old === AI_MODEL || !lib.deleteModelAllInfoInCache) return;
  try { await lib.deleteModelAllInfoInCache(old); } catch (e) { }
  try { localStorage.removeItem('wg-ai-ready'); } catch (e) { }
}
// 모델을 받는 데 필요한 브라우저 저장 공간 (모델 약 3GB + 여유, 약 3.3GB)
const AI_NEED = 3400 * 1024 * 1024;
async function aiStorage() {
  try {
    const s = typeof navigator !== 'undefined' && navigator.storage;
    if (!s) return null;
    if (s.persist && s.persisted && !(await s.persisted())) await s.persist().catch(() => false);
    const e = s.estimate ? await s.estimate() : null;
    return e ? { quota: +e.quota || 0, usage: +e.usage || 0 } : null;
  } catch (e) { return null; }
}
const aiMsgOf = e => { const m = String((e && (e.message || e.code)) || (e && e.name) || e || ''), n = e && e.name && e.name !== 'Error' && !m.includes(e.name) ? e.name + ': ' : ''; return (n + m).replace(/\s+/g, ' ').trim(); };
// 인터넷이 끊겨서 실패했는지 (다시 해 볼 만한 오류)
const aiNetErr = e => /Failed to fetch|NetworkError|network|Load failed|ERR_|Cannot fetch|fetch failed|status:? ?(?:5\d\d|429)|timed? ?out|aborted by|connection/i.test(aiMsgOf(e)) && !/QuotaExceeded/i.test(aiMsgOf(e));
// 실패를 학생이 읽을 말로: 어느 단계(받기 몇 %·기기에 올리기·마무리)에서 무슨 일이 났는지 + 실제 오류 글 조금
function aiErrInfo(e) {
  const raw = aiMsgOf(e), ph = AI.phase || { step: 'init', pct: 0 };
  const where = ph.step === 'fetch' ? `AI를 받는 중(${ph.pct}%)에` : ph.step === 'load' ? `받은 AI를 그래픽 칩에 올리는 중(${ph.pct}%)에` : ph.step === 'shader' ? 'AI 준비를 마무리하는 중에' : 'AI 준비를 시작할 때';
  let why;
  if ((e && e.code === 'quota') || /QuotaExceeded|quota/i.test(raw)) why = `브라우저 저장 공간이 모자라요${e && e.quota ? ` (이 사이트가 쓸 수 있는 공간 약 ${Math.round(e.quota / 1048576)}MB, 필요 약 ${Math.round(AI_NEED / 1048576)}MB)` : ''}. 휴대폰 저장 공간을 더 비운 뒤 다시 받아 주세요.`;
  else if (aiNetErr(e)) why = '인터넷 연결이 끊겨서 다 받지 못했어요. 받은 부분은 저장돼 있어서 다시 받으면 이어서 받아요. 와이파이에서 화면을 켜 둔 채로 해 주세요.';
  else if (/device (?:was )?lost|DeviceLost|out of memory|OutOfMemory|Allocation|GPUOutOfMemory/i.test(raw)) why = '그래픽 메모리가 모자랐어요. 다른 앱을 닫고 다시 해 주세요.';
  else if (/exceeds limit|maxStorage|maxBuffer|maxCompute|requestDevice|Cannot initialize runtime/i.test(raw)) why = '이 휴대폰 그래픽 칩의 한도가 이 AI에 모자라요.';
  else if (/ShaderF16|FeatureSupport|shader-f16/i.test(raw)) why = '이 휴대폰의 그래픽 칩이 이야기 AI에 필요한 기능(16비트 계산)을 지원하지 않아요.';
  else if (/WindowSize|AttentionSink|ConfigurationError|context_window_size|sliding_window_size/i.test(raw)) why = '앱의 AI 설정이 모델과 맞지 않았어요. 앱을 고쳐야 하는 문제라서 알려 주시면 고칠게요.';
  else if (/ai worker/i.test(raw)) why = 'AI를 돌리는 파일을 열지 못했어요. 페이지를 새로 고친 뒤 다시 해 주세요.';
  else why = '알 수 없는 오류가 났어요. 다시 받아 보고, 또 안 되면 이 화면을 캡처해서 알려 주세요.';
  return { where, why, raw: raw.slice(0, 120), text: `${where} 멈췄어요. ${why}${raw ? ` (오류: ${raw.slice(0, 120)})` : ''}` };
}
// GPU를 잃었거나 모델이 내려간 오류인지 (한 번 다시 준비해 볼 만한 오류)
const aiLost = e => /ModelNotLoaded|not loaded|device (?:was )?lost|DeviceLost/i.test(String((e && e.message) || e));

/* ---------- AI 문장에서 단어 뜻 찾기 ----------
   열쇠 = 학생 뜻의 기본꼴·줄기·활용꼴(모든 뜻에서), 짧은 열쇠는 뒤에 붙을 글자(need)까지 맞아야 해요
   ('줄이'는 '줄이 끊어지자'가 아니라 '줄였어요'에서만, '가'는 '갔어요'에서만) */
function aiKeys(w, ko) {
  const keys = new Map();
  const add = (s, need = null, min = 2) => { s = String(s || '').trim(); if (!s || !/[가-힣]/.test(s) || s.replace(/\s/g, '').length < min) return; if (!keys.has(s) || (keys.get(s) && !need)) keys.set(s, need); };
  // '~을 고대하다' → '고대하다', '~하는 경향이 있다' → '경향이 있다' (빈자리와 그 뒤 조사·토막은 빼요)
  const senses = String(ko || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s*[,;/]\s*/)
    .map(s => s.replace(/^\s*~\s*[가-힣]*\s+(?=[가-힣])/, '').replace(/~\s*(?:에게서|에서|에게|으로|을|를|이|가|은|는|과|와|로|에|의|도|만|보다)?(?=\s|$)/g, ' ').replace(/~/g, ' ')
      .replace(/[^가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (const s of senses) {
    add(s);
    if (/다$/.test(s)) add(s.replace(/다$/, ''), /^(?:[고며면니는던지자게기려라도]|었|았|어서|아서|어요|아요)/);
    const root = s.replace(/(하다|되다|시키다|하는|한|된|스럽다|스러운|롭다|로운|적인|이다|다)$/, '');
    if (!/\s/.test(s) && root !== s.replace(/다$/, '')) add(root, /적인$/.test(s) ? /^적/ : /^(?:[하했한해할함합히되된됐돼될서요]|스럽|스러|롭|로)/);
  }
  // 활용꼴: 첫 뜻(이야기 문장이 쓰는 꼴)과 다른 뜻들 모두. '~하는 경향이 있다'처럼 앱이 자리 낱말을 넣은 꼴은 빼요
  const allForms = w && w.sub !== 'aux' ? [w.forms || {}] : [];
  for (const s of senses) { const k = koKind(s, w && w.id); allForms.push(k.kind === 'v' ? koVerbForms(k.stem, w && w.id) : k.kind === 'a' && k.stem ? koAdjForms(k, w && w.id) : {}); }
  for (const F of allForms) {
    const one = (F.ki || '').length === 2;
    for (const [name, v] of Object.entries(F)) {
      const x = String(v).replace(/\s(해|수)$/, '').replace(/(어요|아요|요)$/, '');
      add(x, name === 'lsu' && x.length === 1 ? /^\s*(?:수|거|것|게|래|까|줄)/ : x.length === 1 ? /^(?:어|다|고|지|던|는데|으니|더니)/
        : name === 'ji' ? /^\s*(?:않|못|말)/
          : one && (name === 'go' || name === 'ja') ? /^(?![가-힣])/
            : one && name === 'ki' ? /^(?:로|를|가|는|도|에|\s*(?:위해|전|시작|싫|좋|바빴|바빠|힘들))/ : null, 1);
    }
    // 한 글자 줄기('가다'의 '가', '자다'의 '자'): 바로 뒤가 활용 글자일 때만
    const st1 = (F.ki || '').slice(0, -1);
    if (st1.length === 1 && !koSplit(st1)[2]) add(st1, /^(?:었|았|어서|아서|어요|아요|[고며면는던자](?![가-힣])|지\s*(?:않|못))/, 1);
  }
  if (w && w.forms && /게$/.test(w.forms.ge || '')) add(w.forms.ge.slice(0, -1));
  // 한 글자 이름씨('꿈', '힘'): 조사가 붙거나 낱말이 끝날 때만
  if (w && w.kind === 'n' && w.m.length === 1) add(w.m, /^(?:이었|였|이에요|예요|이야|이라|(?:을|를|이|가|은|는|에서|에게|에|의|도|만|과|와|으로|로|처럼|까지|부터)?(?![가-힣]))/, 1);
  // '-아/어' 꼴(도와, 무서워, 몰라)과 '-으' 꼴(들으며)
  const stem = w && w.sub !== 'aux' && w.forms && w.forms.ki ? w.forms.ki.slice(0, -1) : w && w.forms && /게$/.test(w.forms.ge || '') ? w.forms.ge.slice(0, -1) : '';
  if (stem) {
    if (w.kind === 'a') add(stem, /^(?:[아어았었게고지은다]|워|웠)/);
    const inf = koInf(stem, w.id);
    add(inf, koDIrr(stem, w.id) ? /^(?:요|도|[.,!?]|$|\s*(?:주|줬|준|줄|보|봤|본|볼))/ : /(빌려|보여|알려|들려)$/.test(inf) ? /^(?:요|서|도|야|했|해|[.,!?]|$|\s(?!주|줬|준|줄|드))/ : /^(?:요|서|도|야|했|해|하|한|라|주|줬|준|줄|\s|[.,!?]|$)/);
    const eu = koEu(stem, w.id);
    if (eu !== stem) add(eu, /^(?:며|면|니|러|세|려)/);
  }
  if (w && w.base && w.sub !== 'aux') add(w.base);
  return [...keys].sort((a, b) => b[0].length - a[0].length);
}
// AI 문장에서 단어 뜻 자리를 찾아 {영어|그 낱말 덩어리}로 ('격려' → {encourage|격려했어요}). 못 찾으면 null
// 낱말 첫머리에서 시작할 때만('기억' 속 '억'은 안 돼요). 이름씨 뜻은 조사를 표시 밖에 둬요({survey|설문 조사}를)
function aiMark(line, id, w, ko) {
  for (const [k, need] of aiKeys(w, ko)) {
    const re = new RegExp(k.split(' ').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'g');
    for (let m; (m = re.exec(line));) {
      const at = m.index;
      if (at > 0 && /[가-힣A-Za-z0-9]/.test(line[at - 1])) continue;
      if (need && !need.test(line.slice(at + m[0].length))) continue;
      let end = at + m[0].length;
      while (end < line.length && /[가-힣]/.test(line[end])) end++;
      if (w && w.kind === 'n') { const pm = line.slice(at + m[0].length, end).match(/^(을|를|이|가|은|는|에|의|도|만|과|와|으로|로)$/); if (pm) end -= pm[0].length; }
      return line.slice(0, at) + `{${id}|${line.slice(at, end)}}` + line.slice(end);
    }
  }
  return null;
}
// AI가 쓴 한 줄 다듬기: 마크다운·번호·'[뜻] 인물 →' 꼴·끝의 (설명)·줄 전체를 감싼 따옴표를 떼요
function aiClean(s) {
  let t = String(s || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:\d+\s*[.)]|[-•*])\s*/, '').trim();
  t = t.replace(/\s*[\[(][^\])]*[\])]\s*$/, '').trim();
  if (t.includes('→')) t = t.slice(t.indexOf('→') + 1).trim();
  else { const e = t.match(/^\[[^\]]*\][^.!?]*?\s*(?:->|=>|⇒|➜|:|：|\s[-–—]\s)\s*(.+)$/); if (e) t = e[1]; }
  t = t.replace(/^\[[^\]]*\]\s*/, '').trim();
  t = t.replace(/\*+([^*\s][^*]*)\*+/g, '$1').replace(/\[([^\]\s]+)\](?=[가-힣.!?,]|$)/g, '$1');
  if (/^["“‘']/.test(t) && /["”’']$/.test(t) && !/["“”‘’']/.test(t.slice(1, -1))) t = t.slice(1, -1).trim();
  t = t.replace(/([.!?])\1{2,}/g, '…');
  return t;
}
// 어린이·청소년이 읽어요: 욕, 성적인 말, 약물, 자해, 끔찍한 폭력, 혐오 표현이 든 AI 문장은 버리고 앱 문장을 써요.
// 너무 넓게 잡지 않게 낱말을 골랐어요 ('새끼 고양이', '불이 꺼져서', '시발점'은 괜찮아요)
const AI_BLOCK = /씨발|시발(?!점)|씨바|ㅅㅂ|ㅆㅂ|개새끼|병신|존나|좆|지랄|닥쳐|썅|미친놈|미친년|섹스|성관계|야동|음란|알몸|나체|포르노|마약|대마초|필로폰|코카인|헤로인|마리화나|자살|자해|피투성이|피범벅|시체|살해|살인|죽여|죽였|짱깨|쪽바리|깜둥이|\b(?:fuck\w*|shit\w*|bitch\w*|porn\w*|sex\w*|nude|naked|cocaine|heroin|suicide|kill\w*|corpse)\b/i;
// 쓸 만한 한 줄인지: 한 문장, 한글, 표시·괄호·영어·한자/가나 없음, 같은 말 되풀이 없음, 끝맺음, 따옴표 짝, 어린이에게 맞는 말
// AI 문장이 쓸 만한지: 못 쓰면 까닭(짧게), 쓸 만하면 ''
// (AI가 앞뒤 이유를 붙여 쓰면 길어져요: 한 줄 140자까지)
function aiLineWhy(t) {
  if (AI_BLOCK.test(t)) return '어린이에게 맞지 않는 말';
  if (t.length < 6) return '너무 짧음';
  if (t.length > 140) return '너무 김';
  if (!/[가-힣]{2}/.test(t)) return '한글 없음';
  if (/[{}|<>\[\]()*~]/.test(t)) return '기호 섞임';
  if (/[A-Za-z]{3,}/.test(t)) return '영어 섞임';
  if (/(.)\1{4,}/.test(t)) return '같은 글자 반복';
  if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(t)) return '한자·일본 글자';
  if (/(.{12,}).*\1/.test(t)) return '같은 말 반복';
  if (!(/[.!?…”"’]$/.test(t) || /(요|다)$/.test(t))) return '끝맺음 없음';
  if ((t.match(/[“”"]/g) || []).length % 2) return '따옴표 짝 안 맞음';
  if (/(?:^|[\s.!?])\d{1,2}\s*[.)]\s/.test(t)) return '번호 섞임';
  return '';
}
const aiLineOk = t => !aiLineWhy(t);

// 요청 글: 앱이 쓴 이야기 전체. 단어 줄만 번호와 [뜻]을 붙여요. AI는 번호 붙은 줄만 고쳐 써요
// story: [{ n: 0(그대로 둘 줄) | 1.., mean, text }]
function aiPrompt(story) {
  const body = story.map(s => s.n ? `${s.n}. [${s.mean}] ${s.text}` : s.text).join('\n');
  return `너는 어린이 그림책 작가야. 읽는 사람은 어린이와 청소년이야. 아래 이야기에서 번호 붙은 줄만 더 재미있게 고쳐 써 줘.

이야기:
${body}

규칙:
- 번호마다 딱 한 문장. 그 줄에서 누가 무엇을 하는지는 그대로 둬.
- [ ] 안의 말을 꼭 넣어. 끝은 문장에 맞게 바꿔도 돼.
- 왜 그랬는지나 그래서 어떻게 됐는지를 넣어서 앞뒤 줄과 이어지게.
- 다정하고 깨끗한 이야기로. 싸움·다치는 일·연애·무서운 말·거친 말은 쓰지 마.
- 끝은 '~요'로. 영어는 쓰지 마.

답은 번호 붙은 줄만 1번부터 차례로, '1. 문장' 꼴로 써.`;
}
// AI 답에서 생각하는 글(생각 블록)을 떼요. Gemma 4는 생각 모드를 켤 때만(<|think|>) 생각을 쓰고, 이 앱은 켜지 않지만
// 혹시 나오면 그 속의 '1. …' 줄을 답으로 읽지 않게: <think>…</think>, <thought>…</thought>, <|channel>thought…<channel|>,
// 끝 표시만 남았으면 그 앞까지, 시작 표시만 남았으면(답이 잘림) 그 뒤를 모두 떼요. 남은 특수 표시(<|…|>, <eos> 등)도 지워요.
// (WebLLM의 enable_thinking:false는 Qwen3용 '<think></think>'를 답 앞에 넣는 설정이라 Gemma 4에는 쓰지 않아요)
function aiNoThink(s) {
  let t = String(s || '');
  t = t.replace(/<(think|thought|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').replace(/<\|channel\|?>[\s\S]*?<\|?channel\|>/g, '');
  const end = /<\/(?:think|thought|thinking|reasoning)>|<\|?channel\|>/gi;
  let last = -1;
  for (let m; (m = end.exec(t));) last = m.index + m[0].length;
  if (last >= 0) t = t.slice(last);
  const open = t.search(/<(?:think|thought|thinking|reasoning)>|<\|channel\|?>/i);
  if (open >= 0) t = t.slice(0, open);
  return t.replace(/<\|[^|<>]{0,30}\|>|<\|[a-z_]{1,20}>|<[a-z_]{1,20}\|>|<(?:eos|bos|end_of_turn|start_of_turn)>/gi, '').trim();
}
// AI 답에서 번호별 문장 후보들 (번호 꼴이 여러 가지여도: **1.**, 1번., (1), ①, ### 1.)
function aiParse(text, n) {
  const cand = Array.from({ length: n }, () => []);
  const src = String(text || '').replace(/\*\*|__/g, '').replace(/([.!?”"])\s+(?=\d{1,2}\s*[.)]\s)/g, '$1\n');
  const L = src.split(/\n+/);
  const NUM = /^\s*(?:[-#>*]+\s*)?\(?(?:(\d{1,2})\s*(?:번)?\s*[.):：]|([①-⑳]))\s*(.*)$/;
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(NUM);
    if (!m) continue;
    const k = m[1] ? +m[1] - 1 : m[2].charCodeAt(0) - 0x2460;
    let t = aiClean(m[3]);
    // '1. [뜻] 인물'만 쓰고 문장은 다음 줄에 쓴 경우
    if ((!t || (!/[.!?”"…]$/.test(t) && /^\[[^\]]*\]/.test(m[3].trim()))) && L[i + 1] && !NUM.test(L[i + 1])) t = aiClean(L[i + 1]);
    if (k >= 0 && k < n && t) cand[k].push(t);
  }
  return cand;
}

// 앱이 만든 이야기(res)의 단어 줄을 AI 문장으로 바꿔요. 바꾼 줄 수를 돌려줘요
async function aiRewrite(eng, res, rows, n, signal) {
  const f = SF[((n % SF.length) + SF.length) % SF.length];
  const lines = res.lines.slice(), plainOf = l => l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
  const idx = [], items = [];
  lines.forEach((l, i) => {
    const m = l.match(/\{([^|}]+)\|([^}]+)\}/);
    if (!m || !rows[m[1]]) return;
    const id = m[1], r = rows[id], w = stLex(id, r, f);
    // 사전처럼 빈자리는 '~'로 ('~을 고대하다')
    const mean = w.slot != null ? `~${w.slot} ${w.m}` : w.m;
    idx.push(i); items.push({ id, w, ko: r.ko, mean });
  });
  if (!items.length) return 0;
  const story = lines.map((l, i) => { const k = idx.indexOf(i); return k >= 0 ? { n: k + 1, mean: items[k].mean, text: plainOf(l) } : { n: 0, text: plainOf(l) }; });
  const stop = () => { try { eng.interruptGenerate(); } catch (e) { } };
  if (signal) { if (signal.aborted) throw { code: 'cancelled' }; signal.addEventListener('abort', stop, { once: true }); }
  let text = '';
  try {
    const reply = await eng.chat.completions.create({ messages: [{ role: 'user', content: aiPrompt(story) }], temperature: 0.7, top_p: 0.9, max_tokens: Math.min(1200, 90 * items.length + 60) });
    text = (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
  } finally { if (signal) signal.removeEventListener('abort', stop); }
  if (signal && signal.aborted) throw { code: 'cancelled' };
  const cand = aiParse(aiNoThink(text), items.length);
  // 앞에 붙은 '인물 이름:' 꼬리표는 떼요
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [f.H, f.F, f.V, ...Object.values(f.S || {})].filter(Boolean).sort((a, b) => b.length - a.length);
  const label = new RegExp('^(?:' + names.map(escRe).join('|') + ')\\s*[:：\\-–—]\\s*');
  const same = (a, b) => a.replace(/[.!?]$/, '').trim() === b.replace(/[.!?]$/, '').trim();
  let changed = 0;
  // 문제 찾기용 기록: AI가 쓴 글과 줄마다 쓰지 못한 까닭 (완성 화면에서 펼쳐 볼 수 있어요)
  const diag = { title: f.title, raw: String(text).slice(0, 1600), why: [] };
  items.forEach((x, k) => {
    let marked = null, why = cand[k].length ? '' : '답에서 이 번호를 못 찾음';
    for (const t0 of cand[k]) {
      const t = t0.replace(label, '');
      // 앱 문장을 그대로 베낀 줄은 고쳐 쓴 게 아니에요 (앱 문장이 그대로 남아요)
      if (same(t, story[idx[k]].text)) { why = why || '앱 문장을 그대로 씀'; continue; }
      const bad = aiLineWhy(t);
      if (bad) { why = why || bad; continue; }
      const mk = aiMark(t, x.id, x.w, x.ko);
      // '루나는 에 {…|의존했어요}'처럼 조사만 덩그러니 남은 줄은 버려요
      if (mk && !/(^|\s)(을|를|에|에게|에서|에도|과|와|으로|로)\s\{/.test(mk)) { marked = mk; break; }
      why = why || (mk ? '조사만 남음' : `뜻 ‘${x.w.m}’이 없음`);
    }
    diag.why.push(`${k + 1}. ${x.id}: ${marked ? '씀' : why}`);
    if (!marked) return;
    lines[idx[k]] = /[.!?”"…]$/.test(marked) ? marked : marked + '.';
    const wd = res.words && res.words[x.id];
    if (wd) wd.pic = plainOf(marked).slice(0, 120);
    changed++;
  });
  res.lines = lines;
  AI.diag = (AI.diag || []).concat([diag]).slice(-8);
  return changed;
}
