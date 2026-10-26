/* ================= 휴대폰 안 AI로 이야기 쓰기 (Gemma 4 E2B, WebLLM) =================
   처음 한 번 AI 모델(약 3GB)을 와이파이로 받아 브라우저에 저장하고, 그다음부터는 인터넷 없이(비행기 모드에서도) 이 기기에서 이야기를 써요.
   단어·사진·이야기는 이 휴대폰 밖으로 나가지 않아요.
   이야기 틀·인물·단어 순서(말썽 → 해결)는 앱이 정하고(mkStory), AI는 앱이 쓴 이야기 전체를 보고
   번호 붙은 단어 줄만 더 재미있게 고쳐 써요 (그 줄의 인물은 그대로: 그림도 그 인물로 그려져 있어요).
   AI는 단어 뜻을 다시 쓰지 않아요: 앱이 단어 뜻 자리를 ★로 바꿔 보내고, AI는 ★ 앞뒤만 써요.
   앱이 ★ 자리에 단어 뜻을 그대로 되돌려 넣어요. ★가 없거나 두 번이거나 문장과 맞지 않은 줄은 그 줄들만 담아 한 번 더 묻고,
   그래도 이 에피소드에 모자라면 남은 줄만 담아 더 물어요 (다시 묻기는 AI_AGAIN_MAX번까지).
   그 뒤 AI가 에피소드 단어 줄의 2/3(AI_MIN_SHARE, 올림) 이상을 써야 단어장을 만들어요 (남은 줄은 줄거리 틀 문장 그대로, 단어마다 칩이 있게).
   이야기 AI를 못 돌리거나 준비·쓰기에 실패하면 단어장을 만들지 않아요 (mkMake).
   모델 파일은 저장소에 없어요: word-game/llm/NOTICE.txt (Gemma 4: Apache 2.0) */
// 이야기 AI 모델 두 가지 (같은 Gemma 4 E2B, WebLLM 0.2.86 기록). 이 기기에서 쓸 모델은 aiModel 하나로 정해요.
// AI_MODEL(q4f16): 16비트 계산(shader-f16)을 하는 그래픽 칩용. 그래픽 메모리 약 3.4GB. 휴대폰은 늘 이것만 써요.
// AI_MODEL_F32(q4f32): 16비트 계산이 없는 컴퓨터 그래픽 칩용. 그래픽 메모리 약 3.9GB, 받을 파일도 조금 더 커요.
//   휴대폰은 RAM을 그래픽 칩과 나눠 써서, 메모리를 더 쓰는 q4f32는 쓰지 않아요.
// size: 받을 크기 글, need: 처음 받을 때 필요한 브라우저 저장 공간 (모델 + 여유, 모델 기록의 그래픽 메모리 값쯤)
const AI_MODEL = 'gemma-4-E2B-it-q4f16_1-MLC';
const AI_MODEL_F32 = 'gemma-4-E2B-it-q4f32_1-MLC';
const AI_MODELS = { [AI_MODEL]: { size: '약 3GB', need: 3400 * 1024 * 1024, f16: true }, [AI_MODEL_F32]: { size: '약 3.5GB', need: 3900 * 1024 * 1024, f16: false } };
const AI_SIZE = AI_MODELS[AI_MODEL].size;
// gen: 준비를 그만둘 때마다 늘어요 (그만둔 준비가 늦게 끝나도 쓰지 않게)
// work: 지금 쓰는 중인 글 하나의 기록 (단계·시작 시각·쓴 토큰 수). 쓰지 않을 때는 null
// gpuLog: AI 일꾼이 보낸 그래픽 칩 소식 (끊김·오류·콘솔 오류 글), gpuDev: 일꾼이 쓰는 그래픽 칩 정보, wnames: 이 화면이 띄운 일꾼 이름들
// bench: 'AI 진단' 기록 (아직 안 읽었으면 undefined)
// chunk: 지금 일꾼이 글을 나눠 읽는 조각 크기(토큰, 일꾼이 없으면 0), chunkLog: 일꾼이 보낸 조각마다 걸린 시간(i/of: 몇 번째 조각/모두 몇 개), onChunk: 조각 시간이 올 때마다
// gap: 조각마다 그래픽 칩을 쉬게 하는 시간(ms), sampleLog: 글을 다 읽은 뒤 첫 토큰 고르기의 시작·끝 소식, onSample: 그 소식이 올 때마다
// model: aiGpuOk가 고른 모델 id (아직 모르거나 둘 다 못 쓰면 null), engineId: 지금 올라와 있는 모델 id
const AI = { model: null, engineId: '', engine: null, loading: null, gpu: null, worker: null, gen: 0, onProgress: null, onRetry: null, err: null, phase: { step: 'init', pct: 0 }, work: null, gpuLog: [], gpuDev: null, wnames: new Set(), gpuCh: null, onGpu: null, chunk: 0, chunkLog: [], onChunk: null, gap: 0, sampleLog: [], onSample: null };
const aiURL = p => new URL(p, location.href).href;
// WebLLM의 모델 기록 (가짜 AI.lib 또는 받아 둔 AI.web). 아직 안 받았으면 null
const aiRecOf = id => { const L = AI.lib || AI.web, list = L && L.prebuiltAppConfig && L.prebuiltAppConfig.model_list; return (list && list.find(m => m.model_id === id)) || null; };
const aiRec = () => aiRecOf(aiModel());
// 이 기기에서 쓸 모델 id: aiGpuOk가 그래픽 칩을 보고 고른 것 (아직 안 봤거나 둘 다 못 쓰면 q4f16).
// 받기·불러오기·크기 글·저장 공간 확인(aiStoreNeed)·이 기기 기록(wg-ai-ready·조각 크기·진단)·옛 모델 지우기가 모두 이 함수로 모델을 정해요
const aiModel = () => (AI.model && AI_MODELS[AI.model] ? AI.model : AI_MODEL);
const aiSize = () => AI_MODELS[aiModel()].size;
const aiStoreNeed = () => AI_MODELS[aiModel()].need;
// 그래픽 칩이 한 번에 다뤄야 하는 버퍼 크기 (모델 기록 값, 없으면 WebLLM 0.2.86 기록의 192MB)
const AI_BUF = 201326592;
const aiBufOf = id => +((aiRecOf(id) || {}).buffer_size_required_bytes) || AI_BUF;
const aiBufNeed = () => aiBufOf(aiModel());
// 이 기기에서 AI를 돌릴 수 있는지: 메모리(RAM) 8GB + WebGPU + 큰 버퍼 + (q4f16은) 반정밀도(shader-f16).
// 그래픽 칩이 192MB짜리 버퍼를 다룰 수 있어야 해요. 반정밀도가 없는 컴퓨터는 q4f32를 써요 (aiChoose).
// 모델이 그래픽 메모리를 약 3.4GB 써요. 휴대폰은 RAM을 그래픽 칩과 나눠 써서, 크롬이 4GB라고 알려 주는 휴대폰(실제 4~6GB)은
// 그래픽 칩에 올리다가 탭이 꺼져요 (갤럭시 A16: '그래픽 칩에 올리는 중 3%'). 크롬은 RAM을 가까운 2의 거듭제곱으로, 8GB까지만 알려 줘요
const AI_MEM = 8;
async function aiGpuOk() {
  if (AI.gpu != null) return AI.gpu;
  try {
    const mem = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
    if (typeof mem === 'number' && mem < AI_MEM) { AI.gpu = false; AI.gpuWhy = 'mem'; AI.gpuMem = mem; return false; }
    const a = navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const f16 = !!(a && a.features && a.features.has('shader-f16'));
    AI.gpuBuf = a && a.limits ? +a.limits.maxStorageBufferBindingSize || 0 : 0;
    // 문제 찾기용: 어떤 그래픽 칩인지 ('qualcomm adreno-8xx' 같은 이름)
    const inf = a && a.info;
    AI.gpuName = inf ? [inf.vendor, inf.architecture || inf.device || inf.description].filter(Boolean).join(' ').slice(0, 60) : '';
    AI.gpuInfo = aiInfoOf(inf);
    const pick = navigator.gpu && a ? aiChoose(f16, AI.gpuBuf, aiIsPhone(AI.gpuInfo) || aiIOS()) : null;
    AI.model = (pick && pick.id) || null; AI.gpuNeed = (pick && pick.need) || 0;
    AI.gpuWhy = !navigator.gpu ? 'nogpu' : !a ? 'noadapter' : pick.why;
    AI.gpu = !AI.gpuWhy;
  } catch (e) { AI.gpu = false; AI.gpuWhy = 'noadapter'; }
  return AI.gpu;
}
// 모델 고르기: f16 그래픽 칩이 16비트 계산(shader-f16)을 하는지, buf 그래픽 칩 버퍼 한도(바이트), phone 휴대폰인지.
// 16비트 계산이 되고 버퍼가 모델 기록만큼 크면 q4f16. 아니면 컴퓨터만 q4f32 (필요한 기능은 없고, 버퍼는 모델 기록만큼).
// 휴대폰은 q4f16만 써요. 둘 다 못 쓰면 id 없이 모자란 것(why: 'nof16' 휴대폰의 16비트 계산, 'buf' 버퍼 한도)과 필요한 버퍼(need)
function aiChoose(f16, buf, phone) {
  if (f16 && buf >= aiBufOf(AI_MODEL)) return { id: AI_MODEL, why: '' };
  if (!phone && buf >= aiBufOf(AI_MODEL_F32)) return { id: AI_MODEL_F32, why: '' };
  if (phone && !f16) return { id: null, why: 'nof16' };
  return { id: null, why: 'buf', need: phone || f16 ? aiBufOf(AI_MODEL) : aiBufOf(AI_MODEL_F32) };
}
const aiDevWord = () => (aiIsPhone() ? '휴대폰' : '컴퓨터');
// iPhone·iPad (아이패드는 Mac처럼 알려요: 터치가 되면): 메모리를 그래픽 칩과 나눠 써서 모델은 휴대폰처럼 q4f16만
const aiIOS = () => { try { const ua = navigator.userAgent || ''; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch (e) { return false; } };
// 앱 안에서 열린 브라우저 (카카오톡·네이버·인스타그램 …): 이런 화면은 대개 AI 계산 기능(WebGPU)이 없어요
const AI_INAPP = [[/KAKAOTALK/i, '카카오톡'], [/NAVER\(inapp|NAVER/, '네이버 앱'], [/Instagram/, '인스타그램'], [/FBAN|FBAV|FB_IAB/, '페이스북'], [/\bLine\//, '라인'], [/DaumApps/, '다음 앱'], [/everytimeApp/i, '에브리타임'], [/; wv\)/, '다른 앱']];
// 이 브라우저에서 이야기 AI를 못 쓰는 까닭 ('' = 쓸 수 있어요)
async function aiWhyNot() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '', app = (AI_INAPP.find(([re]) => re.test(ua)) || [])[1];
  if (await aiGpuOk()) return '';
  if (AI.gpuWhy === 'mem') return `${aiIsPhone() ? '이 휴대폰은' : '이 컴퓨터는'} 메모리(RAM)가 작아서 이야기 AI를 돌릴 수 없어요 (크롬이 알려 준 메모리 약 ${AI.gpuMem}GB, 이야기 AI는 ${AI_MEM}GB 필요).`;
  if (app) return `${app} 안에서 열린 화면이에요. 오른쪽 위 ⋮ 메뉴에서 ‘다른 브라우저로 열기’를 눌러 크롬으로 열어 주세요.`;
  if (AI.gpuWhy === 'nogpu') return `이 브라우저에는 AI 계산 기능(WebGPU)이 없어요. ${aiIsPhone() ? '휴대폰의 최신 크롬으로' : '컴퓨터의 최신 크롬이나 엣지로'} 열어 주세요.`;
  if (AI.gpuWhy === 'nof16') return '이 휴대폰의 그래픽 칩이 이야기 AI에 필요한 기능(16비트 계산)을 지원하지 않아요.';
  if (AI.gpuWhy === 'buf') return `이 ${aiDevWord()}의 그래픽 칩은 한 번에 다룰 수 있는 크기가 작아요(약 ${Math.round(AI.gpuBuf / 1048576)}MB, 이야기 AI는 약 ${Math.round((AI.gpuNeed || aiBufNeed()) / 1048576)}MB 필요). 그래서 이야기 AI를 돌릴 수 없어요.`;
  return `이 ${aiDevWord()}의 그래픽 칩을 AI 계산에 쓸 수 없어요. ${aiIsPhone() ? '크롬을' : '크롬이나 엣지를'} 최신으로 업데이트한 뒤 다시 열어 보세요.`;
}
// 전에 모델을 다 받아 둔 적이 있는지 (처음 안내 문구에만 써요)
const aiReadyBefore = () => { try { return localStorage.getItem('wg-ai-ready') === aiModel(); } catch (e) { return false; } };
// 모바일 데이터(또는 데이터 절약 모드)로 연결돼 있는지: 학생 요금제를 지키려고 3GB 모델은 이때 저절로 받지 않아요.
// 연결 정보(navigator.connection)가 없거나 종류를 모르면(와이파이·유선 포함) false
const aiMobileData = () => { try { const c = navigator.connection; return !!(c && (c.type === 'cellular' || c.saveData === true)); } catch (e) { return false; } };
// 이야기 AI를 쓰려면 아직 받아야 하는지 (지금 올라와 있지도, 전에 다 받아 두지도 않았어요)
const aiNeedsDownload = () => !AI.engine && !aiReadyBefore();
// AI 일꾼을 멈추고 처음 상태로 (준비 실패·그만두기·GPU를 잃었을 때)
function aiDrop() {
  const w = AI.worker;
  AI.gen++; AI.worker = null; AI.engine = null; AI.engineId = ''; AI.loading = null; AI.onProgress = null; AI.chunk = 0; AI.gap = 0;
  if (w) try { w.terminate(); } catch (e) { }
}
// 이야기 AI를 내려놓아요: 단어장 만들기를 마쳤을 때(다른 화면에 가 있으면)와 만들기 화면을 나갈 때, 그래도 남아 있으면 게임을 열 때.
// AI(약 3GB)가 그래픽 칩·메모리에 올라가 있으면 메모리가 작은 휴대폰에서 휴대폰 목소리(TTS)가 소리를 못 내거나 화면이 꺼질 수 있어요.
// 단어장을 만들거나 받는 중, AI 진단 중이면 그대로 둬요. 내려놓은 뒤 휴대폰이 메모리를 정리하는 동안은 목소리가 늦게 시작할 수 있어서
// 1.5초 쉬었다가 말하고 언어마다 첫 문장은 오래 기다려요(voiceCold). 다음에 만들 때는 이 기기에 저장해 둔 모델을 다시 올려요 (인터넷 없이). 내려놓았으면 true
function aiRelease() {
  if (!AI.engine && !AI.worker) return false;
  if (MK.step === 'making' || (MK.aiDl && MK.aiDl.state === 'run') || (AI.bench && AI.bench.state === 'run')) return false;
  aiDrop();
  if (typeof voiceCold === 'function') voiceCold(1500);
  return true;
}
/* ---------- 글을 나눠 읽는 조각 크기 ----------
   AI는 요청 글을 조각으로 나눠 읽어요. 이 모델은 512토큰 조각으로 만들어졌어요(모델 파일 이름의 cs512).
   조각 하나는 그래픽 칩이 한 번에 하는 일 하나예요. 휴대폰 그래픽 칩(갤럭시 S25의 Adreno)은 한 번에 하는 일이 너무 오래 걸리면
   멈춘 것으로 보고 그래픽 칩을 다시 켜요(VK_ERROR_DEVICE_LOST). 47토큰은 됐고, 약 275토큰을 한 조각으로 읽다가 끊겼어요.
   그래서 휴대폰은 32토큰씩 나눠 읽고(web-llm.js의 'word-game patch'), 컴퓨터는 512토큰 그대로 읽어요.
   'AI 진단'이 조각 크기를 바꿔 가며 재서 이 기기에서 안전한 크기를 찾으면, 그 크기를 이 기기(localStorage)에 모델·그래픽 칩마다 남겨서 써요.
   그래픽 칩을 잃었거나 탭이 꺼진 크기, 조각 하나가 너무 오래 걸린 크기는 다시 쓰지 않아요 (그보다 작은 크기로) */
const AI_CHUNK = 512;
const AI_CHUNK_PHONE = 32;
const AI_CHUNK_KEY = 'wg-ai-chunk';
// 조각 하나가 AI_CHUNK_OK_MS보다 짧게 끝나야 안전한 크기로 남겨요. AI_CHUNK_SLOW_MS보다 길면 그래픽 칩 한계에 가까워서 더 큰 조각은 재지 않아요
const AI_CHUNK_OK_MS = 1000, AI_CHUNK_SLOW_MS = 1200;
// 휴대폰은 조각 하나를 다 읽을 때마다 그래픽 칩을 잠깐(ms) 쉬게 해요 (모델 설정 wg_prefill_gap: web-llm.js의 'word-game patch').
// 쉬지 않고 오래 읽다가 크롬의 그래픽 칩 프로세스가 꺼진 적이 있어요(갤럭시 S25, 약 490토큰). 컴퓨터는 쉬지 않아요(0)
const AI_GAP_PHONE = 25;
const aiInfoOf = inf => { const s = k => String((inf && inf[k]) || '').trim().slice(0, 80); return { vendor: s('vendor'), architecture: s('architecture'), device: s('device'), description: s('description') }; };
// 이 화면이 본 그래픽 칩 이름 (aiGpuOk가 먼저 읽어 뒀으면 그대로)
async function aiGpuInfo() {
  if (AI.gpuInfo) return AI.gpuInfo;
  let inf = null;
  try { const a = typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); inf = a && a.info; } catch (e) { inf = null; }
  return (AI.gpuInfo = aiInfoOf(inf));
}
// 휴대폰인지: 안드로이드 브라우저이거나 휴대폰 그래픽 칩(Qualcomm Adreno, Arm Mali, Imagination PowerVR)
function aiIsPhone(info) {
  let ua = '';
  try { ua = navigator.userAgent || ''; } catch (e) { }
  const g = info || AI.gpuInfo || {};
  return /Android/i.test(ua) || /^(?:qualcomm|arm|imagination)\b/i.test(g.vendor || '') || /adreno|mali|powervr|valhall|bifrost|midgard|rogue/i.test([g.architecture, g.device, g.description].join(' '));
}
// 남겨 둘 이름: 모델 + 그래픽 칩 이름
const aiChunkKey = info => { const g = info || AI.gpuInfo || {}; return `${aiModel()} · ${[g.vendor, g.architecture, g.device, g.description].filter(Boolean).join(' / ') || '그래픽 칩 이름 모름'}`; };
function aiChunkAll() {
  try { const o = JSON.parse(localStorage.getItem(AI_CHUNK_KEY) || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; }
}
// 이 기기의 기록: safe 안전한 크기(0 = 모름), bad 쓰지 않을 크기들
function aiChunkRec(key) {
  const r = aiChunkAll()[key] || {};
  return { safe: +r.safe > 0 ? Math.floor(+r.safe) : 0, bad: Array.isArray(r.bad) ? r.bad.map(Number).filter(n => n > 0) : [], at: +r.at || 0 };
}
function aiChunkPut(key, f) {
  const all = aiChunkAll(), r = aiChunkRec(key);
  f(r); r.at = Date.now(); all[key] = r;
  try { localStorage.setItem(AI_CHUNK_KEY, JSON.stringify(all)); } catch (e) { }
  return r;
}
// 이 크기는 이 기기에서 다시 쓰지 않아요 (그래픽 칩을 잃음·탭이 꺼짐·조각 하나가 너무 오래 걸림)
const aiChunkBad = (key, n) => aiChunkPut(key, r => { if (!r.bad.includes(n)) r.bad.push(n); r.bad.sort((a, b) => a - b); if (r.safe >= n) r.safe = 0; });
// 쓸 조각 크기: 진단으로 찾은 안전한 크기, 없으면 휴대폰 32·컴퓨터 512. 안 되는 크기가 있으면 그보다 작게(반씩)
function aiChunkPick(info) {
  aiBenchLoad(); // 진단 중에 탭이 꺼졌으면 그때 재던 크기를 먼저 '안 됨'으로 적어요
  const r = aiChunkRec(aiChunkKey(info));
  // 컴퓨터는 늘 모델이 만들어진 512토큰에서 시작해요 (진단이 찾은 '안전한 크기'는 휴대폰에서만 써요). 안 된 크기가 있으면 그보다 작게
  let n = aiIsPhone(info) ? r.safe || AI_CHUNK_PHONE : AI_CHUNK;
  const lim = r.bad.length ? Math.min(...r.bad) : Infinity;
  while (n > 1 && n >= lim) n = Math.floor(n / 2);
  return Math.max(1, Math.min(n, AI_CHUNK));
}
// 올라와 있는 AI가 글을 n토큰씩 나눠 읽게 해요 (일꾼에게 알려요). 글을 쓰는 중이 아닐 때만 불러요
function aiChunkSet(n) {
  const w = AI.worker;
  AI.chunk = n;
  if (w && typeof w.postMessage === 'function') try { w.postMessage({ wgPrefillChunk: n }); } catch (e) { }
}
// t0(ms) 뒤에 온 조각 시간: n 조각 수, max 가장 오래 걸린 조각(ms), size 조각 크기
function aiChunkSince(t0) {
  const L = AI.chunkLog.filter(e => e.at >= t0);
  return { n: L.length, max: L.reduce((m, e) => Math.max(m, e.took), 0), size: L.length ? L[L.length - 1].size : 0 };
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
      // 어느 모델을 받고 어느 옛 모델을 지울지 정하기 전에 그래픽 칩을 먼저 봐요 (AI.lib: 시험용 가짜는 시험이 정해요)
      if (!AI.lib && AI.gpu == null) await aiGpuOk();
      if (gen !== AI.gen) throw { code: 'cancelled' };
      // 처음 받을 때: 브라우저가 이 사이트 저장 공간을 지우지 않게 부탁하고, 쓸 수 있는 공간을 확인해요
      if (!aiReadyBefore()) { await aiDropOld(lib); const st = await aiStorage(); if (st && st.quota && st.quota < aiStoreNeed()) throw { code: 'quota', quota: st.quota }; }
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
  // 일꾼마다 이름을 붙여요: 일꾼이 그래픽 칩 소식을 보낼 때 이 이름을 붙여서, 이 화면이 띄운 일꾼 소식만 받아요
  aiGpuListen();
  // 글을 나눠 읽을 조각 크기 (휴대폰은 작게, 진단으로 찾은 크기가 있으면 그 크기). 512보다 작을 때만 모델 설정에 넣어요
  const info = await aiGpuInfo(), chunk = aiChunkPick(info), gap = aiIsPhone(info) ? AI_GAP_PHONE : 0;
  if (gen !== AI.gen) throw { code: 'cancelled' };
  const name = 'wg-ai-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  AI.wnames.add(name);
  const worker = AI.worker = new Worker(aiURL('llm/worker.js'), { type: 'module', name });
  AI.chunk = chunk; AI.gap = gap;
  // 일꾼이 아예 못 뜨면(파일을 못 받음 등) 답이 영영 안 오니, 오류가 나면 바로 끝내요
  const dead = new Promise((_, no) => worker.addEventListener('error', e => no(new Error('ai worker: ' + ((e && e.message) || 'failed to start'))), { once: true }));
  dead.catch(() => { });
  // q4f16: f16이 없는 기기는 3GB를 다 받기 전에 거절되게 (모델 기록에도 있지만 빠지지 않게 늘 넣어요). q4f32는 필요한 기능이 없어요
  const id = aiModel(), f16 = AI_MODELS[id].f16, rec = lib.prebuiltAppConfig && lib.prebuiltAppConfig.model_list.find(m => m.model_id === id);
  // WebLLM의 sliding_window_size는 모델 속 '부분 주의'가 아니라 기억(KV 캐시) 전체를 고리처럼 돌려 쓰는 설정이에요.
  // 모델 설정이 '전체 창'과 '미끄럼 창'을 둘 다 켜 두면 켜다가 멈춰요 (WindowSizeConfigurationError).
  // 전체 창만 쓰게 맞춰요(-1 = 끔): 이야기 한 편(지시 + 이야기 + 답)은 4천 토큰 안에 들어가요
  // wg_prefill_chunk: 글을 이 크기 조각으로 나눠 읽어요, wg_prefill_gap: 조각마다 쉬는 시간(ms) (web-llm.js의 'word-game patch')
  const appConfig = rec ? { ...lib.prebuiltAppConfig, model_list: [{ ...rec, ...(f16 ? { required_features: ['shader-f16'] } : {}), overrides: { ...(rec.overrides || {}), context_window_size: AI_CTX, sliding_window_size: -1, attention_sink_size: -1, ...(chunk < AI_CHUNK ? { wg_prefill_chunk: chunk } : {}), ...(gap ? { wg_prefill_gap: gap } : {}) } }] } : undefined;
  try {
    const eng = await Promise.race([lib.CreateWebWorkerMLCEngine(worker, id, {
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
    try { localStorage.setItem('wg-ai-ready', id); } catch (e) { }
    AI.engine = eng; AI.engineId = id;
    return eng;
  } catch (e) {
    if (AI.worker === worker) { AI.worker = null; try { worker.terminate(); } catch (x) { } }
    throw e;
  }
}
// 예전 이야기 AI(Gemma 3 1B, 약 0.7GB)나 이 기기가 이제 쓰지 않는 다른 Gemma 4 모델을 받아 둔 기기: 새 AI를 받기 전에 옛 모델을 브라우저 저장소에서 지워 공간을 비워요.
// 지금 쓸 모델(aiModel)과 올라와 있는 모델은 지우지 않아요 (컴퓨터가 q4f32를 쓰면 q4f32는 그대로)
async function aiDropOld(lib) {
  let old = '';
  try { old = localStorage.getItem('wg-ai-ready') || ''; } catch (e) { }
  if (!old || old === aiModel() || old === AI.engineId || !lib.deleteModelAllInfoInCache) return;
  // 이 기기의 모델을 아직 고르지 못했으면(그래픽 칩을 못 봄) 다른 Gemma 4 모델은 지우지 않아요
  if (/^gemma-4-/.test(old) && !AI.model) return;
  try { await lib.deleteModelAllInfoInCache(old); } catch (e) { }
  try { localStorage.removeItem('wg-ai-ready'); } catch (e) { }
}
// 모델을 받는 데 필요한 브라우저 저장 공간 (모델 약 3GB + 여유, 약 3.3GB)
const AI_NEED = AI_MODELS[AI_MODEL].need; // (q4f16 값. 지금 모델의 값은 aiStoreNeed)
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
  if ((e && e.code === 'quota') || /QuotaExceeded|quota/i.test(raw)) why = `브라우저 저장 공간이 모자라요${e && e.quota ? ` (이 사이트가 쓸 수 있는 공간 약 ${Math.round(e.quota / 1048576)}MB, 필요 약 ${Math.round(aiStoreNeed() / 1048576)}MB)` : ''}. ${aiDevWord()} 저장 공간을 더 비운 뒤 다시 받아 주세요.`;
  else if (aiNetErr(e)) why = '인터넷 연결이 끊겨서 다 받지 못했어요. 받은 부분은 저장돼 있어서 다시 받으면 이어서 받아요. 와이파이에서 화면을 켜 둔 채로 해 주세요.';
  else if (AI_GPU_LOST.test(raw) || /out of memory|OutOfMemory|Allocation|GPUOutOfMemory/i.test(raw)) why = '그래픽 메모리가 모자랐어요. 다른 앱을 닫고 다시 해 주세요.';
  else if (/exceeds limit|maxStorage|maxBuffer|maxCompute|requestDevice|Cannot initialize runtime/i.test(raw)) why = `이 ${aiDevWord()} 그래픽 칩의 한도가 이 AI에 모자라요.`;
  else if (/ShaderF16|FeatureSupport|shader-f16/i.test(raw)) why = `이 ${aiDevWord()}의 그래픽 칩이 이야기 AI에 필요한 기능(16비트 계산)을 지원하지 않아요.`;
  else if (/WindowSize|AttentionSink|ConfigurationError|context_window_size|sliding_window_size/i.test(raw)) why = '앱의 AI 설정이 모델과 맞지 않았어요. 앱을 고쳐야 하는 문제라서 알려 주시면 고칠게요.';
  else if (/ai worker/i.test(raw)) why = 'AI를 돌리는 파일을 열지 못했어요. 페이지를 새로 고친 뒤 다시 해 주세요.';
  else why = '알 수 없는 오류가 났어요. 다시 받아 보고, 또 안 되면 이 화면을 캡처해서 알려 주세요.';
  return { where, why, raw: raw.slice(0, 120), text: `${where} 멈췄어요. ${why}${raw ? ` (오류: ${raw.slice(0, 120)})` : ''}` };
}
// 그래픽 칩(GPU)을 잃었을 때 나오는 오류 글. 크롬은 그래픽 칩을 잃으면(GPU 프로세스가 꺼짐·메모리 부족·그래픽 칩이 오래 걸린 일을 멈춤·
// 화면이 꺼지거나 다른 앱으로 감) device.lost를 알려요. 그러면 WebLLM과 TVM이 엔진을 내리면서 device.destroy()를 부르고,
// 크롬은 그때 읽기를 기다리던 버퍼를 풀어서 'AbortError: … mapAsync … Buffer was unmapped before mapping was resolved.'가 나요.
// 그냥 잃었으면 'The Device was lost before mapping was resolved.', 크롬 연결이 끊기면 'Instance dropped'·'GPU connection lost' 같은 글이에요
const AI_GPU_LOST = /device (?:was |is )?lost|DeviceLost|GPUDevice lost|lost before mapping|mapAsync|unmapped|destroyed before mapping|Instance dropped|instance reference no longer exists|context (?:was )?lost|GPU connection lost/i;
// GPU를 잃었거나 모델이 내려간 오류인지 (엔진을 버리고 한 번 다시 준비해 볼 만한 오류)
const aiLost = e => { const m = aiMsgOf(e); return /ModelNotLoaded|not loaded/i.test(m) || AI_GPU_LOST.test(m); };
// 이야기 AI가 지금 그래픽 칩을 쓰는 중인지 (그래픽 칩에 올리는 중이거나 글을 쓰는 중)
const aiBusy = () => !!AI.work || (!!AI.loading && !AI.engine);
// 'AI가 쓴 글 보기'에 보일 한 줄: 어느 단계에서(이야기 읽기 → 글쓰기) 몇 초 만에, 토큰을 몇 개 쓰고 멈췄는지 (failed: 오류로 멈춤)
// 글을 몇 토큰씩 나눠 읽었는지, 조각 하나가 가장 오래 걸린 시간도 (그래픽 칩 한계에 얼마나 가까웠는지)
function aiWorkText(w, failed) {
  const sec = ms => `${(Math.max(0, ms) / 1000).toFixed(1)}초`, u = w.usage || {};
  const toks = +u.completion_tokens || w.tokens, out = [];
  if (failed) out.push(`멈춘 단계: ${!w.stream ? '이야기를 읽고 쓰는 중' : w.step === 'write' ? '글을 쓰는 중' : '이야기를 읽는 중(아직 쓴 글 없음)'}`, `시작하고 ${sec(Date.now() - w.t0)} 뒤`);
  else out.push(`걸린 시간 ${sec(Date.now() - w.t0)}`);
  if (w.first) out.push(`이야기 읽기 ${sec(w.first - w.t0)}`);
  if (+u.prompt_tokens) out.push(`읽은 토큰 ${+u.prompt_tokens}개`);
  if (w.stream || +u.completion_tokens) out.push(`쓴 토큰 ${toks}개`);
  const c = aiChunkSince(w.t0), size = c.size || w.size;
  if (size) out.push(`읽기 조각 ${size}토큰${c.n ? ` · 조각 ${c.n}개 · 조각 최대 ${c.max}ms` : ''}`);
  if (w.hidden) out.push(`그동안 화면 꺼짐·다른 앱 ${w.hidden}번`);
  return out.join(' · ');
}
// 'AI가 쓴 글 보기'·'AI 진단'의 자세한 줄 (그래픽 칩을 잃었을 때 어디서 멈췄는지 가리려고). o: est 요청 글 토큰(어림), tin 실제로 읽은 토큰,
// workers 요청 전 일꾼, last 마지막 조각 12개의 시간(ms), ci/cof 몇 번째 조각까지/모두 몇 개, gap 조각마다 쉰 시간,
// samp 첫 토큰 고르기(예전 진단 기록처럼 workers가 없으면 적지 않아요. '' 안 함 · start 시작 · end 끝), lostGap 마지막 조각 소식에서 GPU 끊김 소식까지(ms), failed 오류로 멈춤
function aiMoreText(o) {
  const out = [];
  if (o.est || o.tin) out.push(`요청 글 토큰: ${[o.est ? `어림 ${o.est}` : '', o.tin ? `실제 ${o.tin}` : ''].filter(Boolean).join(' · ')}`);
  if (o.workers) out.push(`요청 전 일꾼: ${o.workers}`);
  if (o.last && o.last.length) out.push(`마지막 조각 ${o.last.length}개(ms): ${o.last.join(' ')}${o.cof ? ` · 조각 ${o.ci}/${o.cof}까지 읽음` : ''}${o.gap ? ` · 조각마다 ${o.gap}ms 쉼` : ''}`);
  if (o.failed && o.workers != null) out.push(`첫 토큰 고르기: ${o.samp === 'end' ? '끝남 (글을 다 읽고 쓰는 중에 멈췄어요)' : o.samp === 'start' ? '시작했지만 안 끝남 (글을 다 읽은 바로 뒤에 멈췄어요)' : '시작 안 함 (글을 읽는 중에 멈췄어요)'}`);
  if (o.lostGap != null) out.push(`마지막 조각 소식 뒤 ${aiSec(o.lostGap)} 만에 GPU 끊김 소식`);
  return out;
}
// 같은 일꾼 시계(ms)가 있으면 그것으로, 없으면 받은 시각으로 두 소식 사이 시간
const aiGapMs = (a, b) => Math.max(0, a.ms > 0 && b.ms > 0 ? b.ms - a.ms : b.at - a.at);
// 글 하나(w: aiRewrite의 기록)의 자세한 줄: t0 뒤에 온 조각·첫 토큰·끊김 소식으로
function aiWorkMore(w, failed) {
  const L = AI.chunkLog.filter(e => e.at >= w.t0), c = L[L.length - 1], u = w.usage || {};
  const lost = AI.gpuLog.find(e => e.at >= w.t0 && e.kind === 'lost'), S = AI.sampleLog.filter(e => e.at >= w.t0 && (!lost || e.at <= lost.at));
  const before = lost ? L.filter(e => e.at <= lost.at) : L, lc = before[before.length - 1];
  return aiMoreText({ est: w.est, tin: +u.prompt_tokens || 0, workers: w.workers, last: L.slice(-12).map(e => e.took), ci: c ? c.i + 1 : 0, cof: c ? c.of : 0, gap: w.gap, samp: S.length ? S[S.length - 1].step : '', lostGap: lost && lc ? aiGapMs(lc, lost) : null, failed });
}
// AI가 글을 읽기 직전: 다른 무거운 일꾼을 멈추고, 돌고 있는 일꾼을 적어요 (문제 찾기용).
// 글자 읽기(OCR) 일꾼이 남아 있으면 닫아요 (사진을 읽는 중이 아닐 때만). 영어 목소리는 준비 중이면 적기만 해요
function aiCalm() {
  const out = [`AI ${AI.worker ? 1 : 0}개`];
  try {
    if (typeof OCR !== 'undefined' && (OCR.worker || OCR.eng || OCR.loading)) {
      if (MK.step !== 'reading') { ocrStop(); out.push('글자 읽기(OCR) 닫음'); } else out.push('글자 읽기(OCR) 도는 중');
    }
  } catch (e) { }
  try { if (typeof Voice !== 'undefined' && Voice.loading) out.push('영어 목소리 준비 중'); } catch (e) { }
  return out.join(' · ');
}
// 이야기 AI를 곧 쓸 기기인지 (쓸 수 있다고 확인했거나, 받아 두었거나, 올라와 있음): 단어를 확인하는 동안 영어 목소리(약 37MB)를 미리 받지 않아요
const aiSoon = () => AI.gpu === true || !!AI.engine || aiReadyBefore();
// 이야기 AI가 일하는 중(단어장 만들기·AI 진단·AI 준비·글쓰기)인지: 이때는 영어 목소리를 받거나 준비하지 않아요 (그래픽 칩·메모리를 나눠 쓰지 않게)
const aiQuiet = () => aiBusy() || (typeof MK !== 'undefined' && MK.step === 'making') || !!(AI.bench && AI.bench.state === 'run');
// 'AI가 쓴 글 보기' 맨 위 한 줄: 이 기기 (크롬이 알려 준 메모리, 그래픽 칩 이름, 버퍼 한도)
function aiEnvText() {
  const out = [];
  try { const m = navigator.deviceMemory; if (m) out.push(`메모리 약 ${m}GB`); } catch (e) { }
  if (AI.gpuName) out.push(`그래픽 칩 ${AI.gpuName}`);
  if (AI.gpuBuf) out.push(`버퍼 한도 ${Math.round(AI.gpuBuf / 1048576)}MB`);
  if (AI.model === AI_MODEL_F32) out.push('16비트 계산 없음 → q4f32 모델');
  return out.length ? `기기: ${out.join(' · ')}` : '';
}

/* ---------- 그래픽 칩이 스스로 알려 주는 일 (문제 찾기용) ----------
   AI 일꾼(word-game/llm/gpu-watch.js)이 그래픽 칩 정보, 장치를 잃은 까닭(device.lost), 잡히지 않은 오류(uncapturederror),
   device.destroy()를 부른 곳, 일꾼의 console.error·warn 글을 BroadcastChannel('wg-ai-gpu')로 보내요 (WebLLM의 메시지와 따로).
   이 휴대폰 안에서만 오가요. 'AI가 쓴 글 보기'와 'AI 진단' 결과에 붙여요 */
const AI_GPU_CH = 'wg-ai-gpu';
function aiGpuListen() {
  if (AI.gpuCh || typeof BroadcastChannel !== 'function') return;
  try { AI.gpuCh = new BroadcastChannel(AI_GPU_CH); AI.gpuCh.onmessage = m => aiGpuGot(m && m.data); } catch (e) { AI.gpuCh = null; }
}
function aiGpuGot(d) {
  if (!d || typeof d !== 'object' || !AI.wnames.has(d.w)) return;
  // 글 읽기 조각 하나가 끝남 (took: 걸린 ms, tokens: 토큰 수, size: 조각 크기). 그래픽 칩 소식과 따로 남겨요
  if (d.kind === 'chunk') {
    const ev = { kind: 'chunk', at: Date.now(), ms: +d.ms || 0, took: Math.max(0, Math.round(+d.took || 0)), tokens: +d.tokens || 0, size: +d.size || 0, i: Math.max(0, Math.floor(+d.i || 0)), of: Math.max(0, Math.floor(+d.of || 0)) };
    AI.chunkLog.push(ev);
    if (AI.chunkLog.length > 400) AI.chunkLog.splice(0, AI.chunkLog.length - 400);
    if (AI.onChunk) try { AI.onChunk(ev); } catch (e) { }
    return;
  }
  // 글을 다 읽은 뒤 첫 토큰 고르기의 시작·끝: 그래픽 칩을 잃은 때가 글을 읽는 중인지, 다 읽은 바로 뒤인지, 쓰는 중인지 가려요
  if (d.kind === 'sample') {
    const ev = { kind: 'sample', at: Date.now(), ms: +d.ms || 0, step: d.at === 'end' ? 'end' : 'start', tokens: +d.tokens || 0 };
    AI.sampleLog.push(ev);
    if (AI.sampleLog.length > 40) AI.sampleLog.splice(0, AI.sampleLog.length - 40);
    if (AI.onSample) try { AI.onSample(ev); } catch (e) { }
    return;
  }
  const s = (v, n) => String(v == null ? '' : v).slice(0, n || 500);
  const ev = { kind: s(d.kind, 20), at: Date.now(), ms: +d.ms || 0, n: +d.n || 0, reason: s(d.reason, 40), type: s(d.type, 60), level: s(d.level, 10), msg: s(d.msg), by: s(d.by, 300) };
  if (ev.kind === 'adapter') AI.gpuDev = Object.assign(AI.gpuDev || {}, { info: d.info || {}, limits: d.limits || {}, feats: d.feats || {}, fallback: !!d.fallback });
  if (ev.kind === 'device') AI.gpuDev = Object.assign(AI.gpuDev || {}, { want: d.want || {}, wantF: Array.isArray(d.feats) ? d.feats.map(String) : [] });
  AI.gpuLog.push(ev);
  if (AI.gpuLog.length > 80) AI.gpuLog.splice(0, AI.gpuLog.length - 80);
  if (AI.onGpu) try { AI.onGpu(ev); } catch (e) { }
}
// t0(ms) 뒤에 온 소식 (그래픽 칩 정보는 빼요)
const aiGpuSince = t0 => AI.gpuLog.filter(e => e.at >= t0 && e.kind !== 'adapter' && e.kind !== 'device');
const aiSec = ms => `${(Math.max(0, ms) / 1000).toFixed(1)}초`;
// 소식 한 줄: GPU 끊김 까닭: reason / message, GPU 오류: 종류 / 글 …
function aiGpuLine(e) {
  const at = ` (일꾼 ${aiSec(e.ms)})`;
  if (e.kind === 'lost') return `GPU 끊김 까닭: ${e.reason || '?'} / ${e.msg || '(글 없음)'}${at}`;
  if (e.kind === 'error') return `GPU 오류: ${e.type || '?'} / ${e.msg || '(글 없음)'}${at}`;
  if (e.kind === 'destroy') return `GPU 장치를 닫음(device.destroy): ${e.by || '(부른 곳 모름)'}${at}`;
  if (e.kind === 'device-fail') return `GPU 장치를 만들지 못함: ${e.type || '?'} / ${e.msg || '(글 없음)'}${at}`;
  if (e.kind === 'console') return `일꾼 ${e.level === 'warn' ? '경고' : '오류'} 글: ${e.msg}${at}`;
  if (e.kind === 'reject') return `일꾼에서 처리 안 된 오류: ${e.msg}${at}`;
  return `${e.kind}: ${e.msg}${at}`;
}
const aiGpuLines = t0 => { const L = aiGpuSince(t0).map(aiGpuLine); return L.length > 14 ? L.slice(0, 13).concat([`… 소식 ${L.length - 13}개 더`]) : L; };
// 그래픽 칩을 잃었다는 오류가 났을 때: 끊김 소식(device.lost)이 오류보다 조금 늦게 올 수 있어서 잠깐(최대 0.6초) 기다려요
function aiGpuWait(t0) {
  const ms = AI.gpuLateMs == null ? 600 : AI.gpuLateMs, end = Date.now() + ms;
  const has = () => aiGpuSince(t0).some(e => e.kind === 'lost');
  return new Promise(ok => { const f = () => (!AI.gpuCh || has() || Date.now() >= end ? ok() : setTimeout(f, 40)); f(); });
}
// AI 일꾼이 쓰는 그래픽 칩: 이름(vendor / architecture / device / description), 한도, 기능, WebLLM이 부탁한 한도
function aiDevText() {
  const d = AI.gpuDev;
  if (!d || !d.info) return '';
  const fmt = (k, v) => !(+v) ? '?' : k === 'maxComputeWorkgroupStorageSize' ? `${Math.round(v / 1024)}KB` : /Size$/.test(k) ? `${Math.round(v / 1048576)}MB` : String(v);
  const i = d.info, L = d.limits || {}, F = d.feats || {}, W = d.want;
  const name = [i.vendor, i.architecture, i.device, i.description].map(x => String(x || '').trim()).filter(Boolean).join(' / ') || '(이름 없음)';
  const lim = ['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup'].map(k => `${k} ${fmt(k, L[k])}`).join(' · ');
  const feats = Object.keys(F).map(k => `${k} ${F[k] ? '있음' : '없음'}`).join(' · ');
  const want = W && Object.keys(W).length ? ` | WebLLM이 부탁한 한도: ${Object.keys(W).map(k => `${k} ${fmt(k, W[k])}`).join(' · ')}` : '';
  return `AI 일꾼의 그래픽 칩: ${name}${d.fallback ? ' (대체 어댑터)' : ''} | 한도: ${lim}${feats ? ` | 기능: ${feats}` : ''}${want}`;
}

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
// AI가 쓴 한 줄 다듬기: 마크다운·번호·'[뜻] 인물 →' 꼴·'앱 줄 → 고친 줄' 꼴·앞뒤의 [꼬리표]·(설명)·'(★ = 뜻)' 메모·
// '답:'·'고친 문장:' 같은 꼬리표·줄 전체를 감싼 따옴표를 떼요. 메모만 있는 줄('★ = 뜻')은 빈 글이 돼요 (문장은 다음 줄에 있어요)
const AI_LABEL = /^(?:줄|답|문장|고친\s*(?:줄|문장)|새\s*(?:줄|문장)|바꾼\s*(?:줄|문장)|원래\s*(?:줄|문장))\s*[:：]\s*/;
// '답:' 꼬리표 (낱말 첫머리에서만: '정답:'·'대답:'은 아니에요)
const AI_ANS = /(?:^|[\s.!?)\]）])답\s*[:：]\s*/g;
function aiClean(s) {
  let t = String(s || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:\d+\s*[.)]|[-•*])\s*/, '').trim();
  // 요청 글의 '(★ = 뜻)' 메모를 따라 쓴 것은 어디에 있든 떼요
  t = t.replace(/\s*[(\[（]\s*[★☆]\s*[=:：][^)\]）]*[)\]）]/g, '').trim();
  if (/^[★☆]\s*[=:：]\s*[^★☆.!?]*[.!?]?$/.test(t)) return '';
  t = t.replace(/\s*[\[(][^\])]*[\])]\s*$/, '').trim();
  // 예시처럼 '앱 줄 → 고친 줄'로 썼으면 마지막 화살표 뒤만
  const arrow = t.match(/^.*(?:→|->|=>|⇒|➜)\s*(.*)$/);
  if (arrow) t = arrow[1].trim();
  else { const e = t.match(/^\[[^\]]*\][^.!?]*?\s*(?::|：|\s[-–—]\s)\s*(.+)$/); if (e) t = e[1]; }
  // '줄: 앱 줄 답: 고친 줄'처럼 한 줄에 둘 다 썼으면 마지막 '답:' 뒤만
  const ans = [...t.matchAll(AI_ANS)].pop();
  if (ans) t = t.slice(ans.index + ans[0].length);
  t = t.replace(/^\[[^\]]*\]\s*/, '').replace(/^[(（][^)）]*[)）]\s*/, '').replace(AI_LABEL, '').trim();
  t = t.replace(/\*+([^*\s][^*]*)\*+/g, '$1').replace(/\[([^\]\s]+)\](?=[가-힣.!?,]|$)/g, '$1');
  t = aiUnquote(t);
  t = t.replace(/([.!?])\1{2,}/g, '…');
  return t;
}
// 줄 전체를 감싼 따옴표만 떼요 (속에 다른 따옴표가 있으면 대사라서 그대로)
const aiUnquote = t => /^["“‘']/.test(t) && /["”’']$/.test(t) && !/["“”‘’']/.test(t.slice(1, -1)) ? t.slice(1, -1).trim() : t;
// 어린이·청소년이 읽어요: 욕, 성적인 말, 약물, 자해, 끔찍한 폭력, 혐오 표현이 든 AI 문장은 버려요 (단어장 만들기에서는 그 줄만 한 번 더 물어요).
// 너무 넓게 잡지 않게 낱말을 골랐어요 ('새끼 고양이', '불이 꺼져서', '시발점'은 괜찮아요)
const AI_BLOCK = /씨발|시발(?!점)|씨바|ㅅㅂ|ㅆㅂ|개새끼|병신|존나|좆|지랄|닥쳐|썅|미친놈|미친년|섹스|성관계|야동|음란|알몸|나체|포르노|마약|대마초|필로폰|코카인|헤로인|마리화나|자살|자해|피투성이|피범벅|시체|살해|살인|죽여|죽였|짱깨|쪽바리|깜둥이|\b(?:fuck\w*|shit\w*|bitch\w*|porn\w*|sex\w*|nude|naked|cocaine|heroin|suicide|kill\w*|corpse)\b/i;
// AI 문장이 쓸 만한지: 못 쓰면 까닭(짧게), 쓸 만하면 ''
// 한두 문장(세 문장부터는 다음 줄 이야기까지 앞질러 써요), 한글, 표시·괄호·영어·한자/가나 없음, 같은 말 되풀이 없음, 끝맺음, 따옴표 짝, 어린이에게 맞는 말
// (AI가 앞뒤 이유를 붙여 쓰면 길어져요: 한 줄 140자까지). keep: 어린이 낱말 검사에서 뺄 말 (앱이 넣은 단어 뜻)
// o: { max 글자 수(단어 표시를 넣을 자리를 뺀 길이), sent 문장 수 } (aiFit이 줄마다 정해요)
function aiLineWhy(t, keep, o) {
  const max = (o && +o.max) || 140, sent = (o && +o.sent) || 2;
  if (AI_BLOCK.test(keep ? String(t).split(keep).join(' ') : t)) return '어린이에게 맞지 않는 말';
  if (t.length < 6) return '너무 짧음';
  if (t.length > max) return '너무 김';
  if (!/[가-힣]{2}/.test(t)) return '한글 없음';
  if (/[{}|<>\[\]()*~★]/.test(t)) return '기호 섞임';
  if (/[A-Za-z]{3,}/.test(t)) return '영어 섞임';
  if (/(.)\1{4,}/.test(t)) return '같은 글자 반복';
  if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(t)) return '한자·일본 글자';
  if (/(.{12,}).*\1/.test(t)) return '같은 말 반복';
  if (!(/[.!?…”"’]$/.test(t) || /(요|다)$/.test(t))) return '끝맺음 없음';
  if ((t.match(/[“”"]/g) || []).length % 2) return '따옴표 짝 안 맞음';
  if (/(?:^|[\s.!?])\d{1,2}\s*[.)]\s/.test(t)) return '번호 섞임';
  if (aiSentN(t) > sent) return '문장이 너무 많음';
  return '';
}
const aiLineOk = t => !aiLineWhy(t);
// 문장 수: 대사(따옴표 속)는 한 낱말로 보고, 문장 끝 뒤에 새 문장이 이어진 수 + 1
const aiSentN = t => (String(t).replace(/[“"][^”"]*[”"]/g, '말').match(/[.!?…](?=\s+[가-힣‘“"])/g) || []).length + 1;

// 요청 글: 앱이 쓴 이야기 전체. 단어 줄만 번호를 붙이고 단어 뜻 자리는 ★로, 줄 끝에 '(★ = 뜻)'.
// AI는 번호 붙은 줄만 고쳐 쓰고 ★는 그대로 둬요 (앱이 ★ 자리에 뜻을 되돌려 넣어요).
// 작은 모델(약 2B)도 따라 하게 짧게, 예시 하나(일반 낱말)와 함께. 어린이 안전 규칙은 이야기 속으로 새어 들지 않게
// '다정한·깨끗한' 같은 꾸밈말 대신 빼야 할 것만 적어요 (휴대폰에서 이런 꾸밈말이 이야기 속에 들어가 단어 뜻을 바꿔 버렸어요)
// '싸움·무서운 내용' 같은 분위기 말도 빼요: 단어 뜻에 따라 조금 긴장되는 장면(불안한·위험한·버리다)이 필요해요. 나쁜 말은 AI_BLOCK이 걸러요
// story: [{ n: 0(그대로 둘 줄) | 1.., core: ★ 자리의 말, hint: 다른 뜻(한 글자 뜻일 때), text }]
// 예시는 앱 문장에 가장 많은 꼴(문장 끝 '-었어요')로: ★가 끝말까지 품고 있어서 ★ 뒤에 '했어요'를 또 붙이지 않는 것을 보여 줘요.
// '줄:'·'답:' 같은 꼬리표 없이 '앱 줄 → 고친 줄' 한 줄로 보여 줘요: 작은 모델이 꼴을 따라 해도 꼬리표가 이야기에 들어가지 않고, 앱은 화살표 뒤만 읽어요
// 휴대폰이 한 번에 짧게 읽도록 규칙·예시를 짧게 써요 (요청 글 토큰은 AI_BUDGET 안: aiParts)
// '그대로 쓰지 말아요' 규칙은 처음부터 넣어요: 컴퓨터에서 이 규칙 없이 물었더니 단어 줄 6줄 가운데 4~6줄을 앱 문장 그대로 베꼈고,
// 이 규칙을 넣어 다시 물었을 때는 절반쯤을 새로 썼어요
const AI_EXAMPLE = '아기 곰은 ★. (★ = 용감했어요) → 엄마가 손을 흔들자, 아기 곰은 ★.';
// 예시에만 나오는 말: 앱 이야기에 없는데 AI 답에 나오면 예시를 따라 쓴 거예요 (엉뚱한 아기 곰·엄마가 이야기와 그림에 들어가요). 예시를 바꾸면 함께 바꿔요
const AI_EXAMPLE_ONLY = [/아기\s*곰/, /엄마가\s*손/];
function aiPrompt(story) {
  const body = story.map(s => s.n ? `${s.n}. ${s.text} (★ = ${s.core}${s.hint ? `, ${s.hint}` : ''})` : s.text).join('\n');
  return `어린이 그림책 이야기예요. 번호 줄만 더 재미있게 고쳐 써요.
- 줄마다 한두 문장으로, 앞 줄과 이어지게 까닭이나 결과를 넣어요.
- 인물은 그대로 둬요.
- ★는 지우거나 바꾸지 말고 딱 한 번 써요. 괄호 속 말은 앱이 나중에 ★ 자리에 넣어요. 뜻이 어울리게 ★ 앞뒤를 써요.
- 욕설, 다치는 장면, 영어, 괄호는 쓰지 않아요. 문장 끝은 '~요'로 해요.
- 원래 문장을 그대로 쓰지 말아요. ★ 앞뒤 말을 새로 쓰고, 왜 그랬는지나 그다음 일을 더해요.
예시: ${AI_EXAMPLE}

이야기:
${body}

답은 '1. 고친 문장' 꼴로 번호 줄만 써요.`;
}
/* ---------- 요청 글 길이 ----------
   휴대폰(갤럭시 S25)에서 약 440토큰까지 읽은 요청은 됐고, 약 490토큰을 읽다가 크롬의 그래픽 칩 프로세스가 꺼졌어요.
   그래서 요청 글은 AI_BUDGET 토큰(어림) 안으로: 마지막 번호 줄 뒤의 줄은 빼고, 그래도 길면 번호 줄을 차례대로 둘(셋…)로 나눠
   따로 물어요. 나눈 요청마다 이야기 첫 줄을 앞에 둬요. 어림 = 글자 수 × AI_TOK_PER_CHAR + 대화 틀 AI_TOK_TMPL
   (Gemma 토큰 나누기로 잰 앱 요청 글에서 글자당 토큰이 가장 큰 값보다 조금 크게) */
const AI_BUDGET = 440, AI_TOK_PER_CHAR = 0.68, AI_TOK_TMPL = 9;
const aiTokEst = t => Math.ceil(String(t).length * AI_TOK_PER_CHAR) + AI_TOK_TMPL;
// 길이 한도는 휴대폰만 (글을 작은 조각으로 나눠 읽는 기기). 컴퓨터는 예전처럼 에피소드마다 요청 하나
const aiBudget = () => (aiIsPhone(AI.gpuInfo) ? AI_BUDGET : Infinity);
// story(aiReq의 이야기 줄)를 요청 글로: [{ items: 이 요청의 번호 줄 차례들(0부터), prompt, est: 토큰 어림 }]
// 번호 줄을 차례대로 k묶음(가능한 한 고르게)으로 나눠요. k = 1부터, 모든 묶음이 AI_BUDGET 안이 될 때까지 (한 줄씩이 되면 그대로)
function aiParts(story, first, budget = AI_BUDGET) {
  const at = story.map((s, i) => (s.n ? i : -1)).filter(i => i >= 0);
  for (let k = 1; ; k++) {
    const parts = [];
    for (let j = 0; j < k; j++) {
      const a = Math.round(j * at.length / k), b = Math.round((j + 1) * at.length / k), from = a ? at[a - 1] + 1 : 0;
      // 번호는 요청마다 1부터. 앞 묶음 뒤의 줄부터 이 묶음 마지막 번호 줄까지 (나눈 요청은 이야기 첫 줄을 앞에)
      const st = (from && first ? [{ n: 0, text: first }] : []).concat(story.slice(from, at[b - 1] + 1).map(s => (s.n ? Object.assign({}, s, { n: s.n - a }) : s)));
      const prompt = aiPrompt(st);
      parts.push({ items: Array.from({ length: b - a }, (_, i) => a + i), prompt, est: aiTokEst(prompt) });
    }
    if (k >= at.length || parts.every(q => q.est <= budget)) return parts;
  }
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
// AI 답에서 번호별 문장 후보들 (번호 꼴이 여러 가지여도: **1.**, 1번., (1), ①, ### 1., '답: 1.', '1번 답:', '답 2.')
// 번호 없는 줄(앞에 붙인 인사말 등)은 읽지 않아요. 번호 줄에 꼬리표·메모만 있으면 다음 줄을,
// 두 문장을 두 줄로 나눠 써서 ★가 다음 줄에 있으면 두 줄을 이어 붙인 것도 후보로 넣어요.
// 요청 줄을 되풀이한 줄('줄: 앱 문장')은 고친 문장이 아니라서 읽지 않고 그다음 줄을 봐요.
// 번호 줄에 ★가 있으면 다음 줄도 뒤 후보로 넣어요: 번호 줄에 앱 문장을 되풀이하고 고친 문장은 다음 줄('→ …')에 쓴 경우
// (aiFit은 후보를 차례로 보고, 앱 문장을 그대로 쓴 줄은 버려요. 다른 번호 줄의 답이면 줄 짝 맞추기가 걸러요)
// items(번호 줄들)를 주면: 답 줄에 요청 글의 '(★ = 뜻)' 메모를 따라 쓴 경우 번호보다 메모를 믿어요 (그 뜻의 번호 줄로).
// AI가 단어 없는 이야기 첫 줄까지 '1.'로 번호를 붙여 쓰면 번호가 하나씩 밀려요: 번호 줄이 단어 줄보다 많고, 맨 앞 번호 줄에
// ★도 메모도 단어 뜻도 없으면 그 줄은 이야기 첫 줄로 보고 건너뛰어요 (예전에는 줄마다 앞 단어의 답과 견줘서 다 버리거나 엉뚱한 줄을 썼어요)
const AI_ECHO = /^\s*(?:줄|원래\s*(?:줄|문장)|원문|고치기\s*전)\s*[:：]/;
const AI_TAG = /[(\[（]\s*[★☆]\s*[=:：]\s*([^)\]）]*)[)\]）]/;
const aiTagKey = s => String(s || '').replace(/[\s‘’“”"'.,，]/g, '');
function aiParse(text, n, items) {
  const cand = Array.from({ length: n }, () => []), ents = [];
  const src = String(text || '').replace(/\*\*|__/g, '').replace(/([.!?”"])\s+(?=\d{1,2}\s*[.)]\s)/g, '$1\n');
  const L = src.split(/\n+/);
  const NUM = /^\s*(?:[-#>*]+\s*)?(?:답\s*[:：]?\s*)?\(?(?:(\d{1,2})\s*(?:번)?\s*(?:답)?\s*[.):：]|([①-⑳]))\s*(.*)$/;
  const echo = s => AI_ECHO.test(s) && ![...String(s).matchAll(AI_ANS)].length;
  // ★ 대신 괄호로 뜻을 써넣은 줄('토토는 (이전의) 신청서는'): 그 괄호 속 말이 번호 줄 하나의 뜻과 같으면 메모처럼 써요
  const parenCore = s => { if (!items) return undefined; for (const pm of String(s).matchAll(/[(\[（]\s*([^)\]）★]{1,30}?)\s*[)\]）]/g)) if (items.some(x => aiTagKey(x.core) === aiTagKey(pm[1]))) return pm[1]; return undefined; };
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(NUM);
    if (!m) continue;
    const num = m[1] ? +m[1] : m[2].charCodeAt(0) - 0x2460 + 1;
    if (num < 1 || num > n + 3) continue;
    let j = i + 1;
    while (j < L.length && !NUM.test(L[j]) && echo(L[j])) j++;
    const raw = j < L.length && !NUM.test(L[j]) ? L[j] : '', nx = raw ? aiClean(raw) : '';
    let t = echo(m[3]) ? '' : aiClean(m[3]);
    const c = [];
    // '1. [뜻] 인물'·'1. (★ = 뜻)'·'1. 줄: 앱 문장'만 쓰고 문장은 다음 줄에 쓴 경우
    if ((!t || (!/[.!?”"…]$/.test(t) && /^[\[(（]/.test(m[3].trim()))) && nx) t = nx;
    else if (t && nx && !t.includes('★') && nx.includes('★') && /[.!?…]$/.test(t)) c.push(t + ' ' + nx);
    if (t) c.push(t);
    if (t && nx && t !== nx && t.includes('★')) c.push(nx);
    ents.push({ num, c, tag: (m[3].match(AI_TAG) || raw.match(AI_TAG) || [])[1] ?? parenCore(m[3] + ' ' + raw), line: m[3] + ' ' + raw });
  }
  // 메모의 뜻이 번호 줄 하나의 뜻과 같으면 그 줄 (뜻 뒤에 붙인 '다른 뜻' 설명은 빼고도 견줘요)
  const tagAt = tag => {
    if (tag == null || !items) return -1;
    const ks = [aiTagKey(tag), aiTagKey(String(tag).split(/[,，]/)[0])], hit = items.map((x, i) => (ks.includes(aiTagKey(x.core)) ? i : -1)).filter(i => i >= 0);
    return hit.length === 1 ? hit[0] : -1;
  };
  const story = e => !/[★☆]/.test(e.line) && e.tag == null && !(items || []).some(x => { const h = aiTagKey(x.core).slice(0, 2); return h.length === 2 && aiTagKey(e.line).includes(h); });
  let lead = 0;
  while (ents.some(e => e.num === lead + 1) && ents.filter(e => e.num === lead + 1).every(story)) lead++;
  const shift = Math.min(lead, Math.max(0, ents.reduce((a, e) => Math.max(a, e.num), 0) - n)), front = cand.map(() => []);
  for (const e of ents) {
    const tk = tagAt(e.tag), k = tk >= 0 ? tk : e.num - 1 - shift;
    if (k >= 0 && k < n) (tk >= 0 ? front : cand)[k].push(...e.c);
  }
  return cand.map((c, k) => front[k].concat(c));
}

/* ---------- ★ 자리에 단어 뜻 되돌리기 ----------
   x: 단어 줄 하나 (aiReq): core ★ 자리의 말('빌렸어요'), star ★로 바꾼 앱 문장, plain 앱 문장, before·after 앱 문장에서 ★ 앞뒤 글,
   wrap 앱 문장이 ★를 ‘ ’로 감쌌는지, cls ★ 자리 종류 (end 문장 끝 '빌렸어요.', mid 뒤에 낱말이 오는 '용감한 얼굴', stick 조사가 붙는 이름씨 '조사를') */
const aiEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ★ 꼴 맞추기: 비슷한 별 표시는 ★로, '★ = 뜻' 메모는 떼고, ★(뜻)·뜻(★)·★ 뜻처럼 뜻을 덧붙였으면 ★ 하나로,
// 앱 문장에 없던 따옴표가 ★만 감쌌으면 떼요
function aiStarTidy(t, x) {
  const c = aiEsc(x.core).replace(/\\? +/g, '\\s*');
  let s = String(t || '').replace(/[☆⭐🌟✩✪✫✬✭✮✯✰]\uFE0F?/gu, '★');
  s = s.replace(new RegExp(`[(\\[（]?\\s*★\\s*[=:：]\\s*[‘“"']?${c}[’”"']?\\s*[)\\]）]?`, 'g'), ' ');
  // 뜻을 꼬리표처럼 앞에 붙였으면('빌렸어요: 레오는 …') 떼요
  s = s.replace(new RegExp(`^\\s*[‘“"']?${c}[’”"']?\\s*[:：]\\s*`), '');
  s = s.replace(/★\s*[(\[（][^)\]）★]{1,30}[)\]）]/g, '★').replace(new RegExp(`${c}\\s*[(\\[（]\\s*★\\s*[)\\]）]`, 'g'), '★').replace(/[(\[（]\s*★\s*[)\]）]/g, '★');
  s = s.replace(new RegExp(`★\\s*${c}(?![가-힣])|(?<![가-힣])${c}\\s*★`, 'g'), '★');
  // ★를 지우고 그 자리에 괄호로 뜻을 써넣었으면('토토는 (이전의) 신청서는') 그 괄호가 ★ 자리예요 (한 번만 나올 때)
  if (!s.includes('★')) { const pr = new RegExp(`[(\\[（]\\s*[‘“"']?${c}[’”"']?\\s*[)\\]）]`, 'g'); if ((s.match(pr) || []).length === 1) s = s.replace(pr, '★'); }
  if (!x.wrap) s = s.replace(/[‘“"'「]\s*★\s*[’”"'」]/g, '★');
  s = s.replace(/^[\s,.:：/|\-–—]+/, '').replace(/\s+([.,!?…])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return aiUnquote(s);
}
// 이 줄에 나오는 인물 (이야기 틀의 주인공 H·친구 F·말썽꾼 V, 긴 이름이나 짧은 이름으로)
const aiCast = (s, f) => ['H', 'F', 'V'].filter(k => [f[k], f.S && f.S[k]].some(nm => nm && s.includes(nm)));
// 이름씨 뒤 조사: 받침에 맞게 고쳐요 (AI는 ★의 받침을 몰라요). 바꿀 조사 → koP에 넣을 꼴
const AI_JOSA = /^(이었어요|였어요|이에요|예요|이라고|라고|이라는|라는|이랑|랑|이나|나|으로|로|을|를|이|가|은|는|과|와)(?![가-힣])/;
const AI_JOSA_BASE = { 였어요: '이었어요', 예요: '이에요', 라고: '이라고', 라는: '이라는', 랑: '이랑', 나: '이나', 으로: '로', 를: '을', 가: '이', 는: '은', 와: '과' };
/* ---------- 줄 짝 맞추기 ----------
   AI가 한 줄을 빼먹고 번호를 당겨 쓰면 다른 단어 줄의 답이 이 번호로 와요 (★ 자리에 엉뚱한 단어 뜻이 들어가요).
   답에서 ★가 든 토막(쉼표·문장 끝으로 나눈 것)의 낱말을 번호 줄(★ 줄)마다 견줘 봐요. 낱말: 두 글자 이상인 한글 덩어리
   (인물 이름·이음말·흔한 끝말은 빼요), 앞 두 글자가 같으면 같은 낱말로 ('지도책을' = '지도책', '두드리며' = '두드렸어요').
   다른 줄 답으로 보는 때: 그 줄 낱말의 절반 이상이 답에 있고, 이 줄과는 하나도 안 겹치면서 그 줄과 두 낱말 이상 겹치거나
   ★ 바로 앞뒤 낱말이 그 줄의 ★ 앞뒤 낱말과 같을 때('레오는 누구보다 ★'), 또는 이 줄보다 뒤의 줄과 두 낱말 이상 더 겹칠 때.
   (앞 줄과 이어 쓰라고 해서 다른 줄 낱말을 조금 되풀이하거나, 이야기 곳곳에 나오는 장소 낱말 하나가 겹치는 것은 괜찮아요)
   ★ 토막에 겹치는 낱말이 하나도 없으면 답 전체를 뒤의 줄들과만 견줘요 (앞 줄 일을 까닭으로 되풀이해 쓰는 것은 괜찮게) */
const AI_STOP = new Set(Object.values(ST_LINK).flat().join(' ').split(' ').concat(['했어요', '했죠', '해요', '있었어요', '없었어요', '됐어요', '이었어요', '였어요', '했답니다', '됐답니다', '그래서', '그러자', '그때', '정말', '아주', '너무', '모두', '다시', '이제', '함께', '같이', '갑자기', '오늘', '오늘도']));
const AI_PRT = /(?:에게서|에서|에게|으로|이랑|처럼|까지|부터|보다|을|를|이|가|은|는|의|도|만|로|과|와|랑)$/;
function aiWords(s, f) {
  const nm = new Set([f.H, f.F, f.V, ...Object.values(f.S || {})].filter(Boolean).join(' ').split(' '));
  return [...new Set((String(s).match(/[가-힣]{2,}/g) || []).filter(w => { const b = w.replace(AI_PRT, ''); return !AI_STOP.has(w) && !AI_STOP.has(b) && !nm.has(w) && !nm.has(b); }))];
}
// 답 s가 단어 줄 x보다 다른 번호 줄에 맞으면 그 줄의 차례(0부터), 아니면 -1. req: aiReq 결과
function aiOtherLine(s, x, req, f) {
  const k = req.items.indexOf(x);
  if (k < 0 || req.items.length < 2) return -1;
  const anchors = req.items.map(y => aiWords(y.star, f)), hit = (ws, a) => a.filter(w => ws.some(v => v.slice(0, 2) === w.slice(0, 2))).length;
  const score = ws => anchors.map(a => hit(ws, a));
  // ★ 바로 앞뒤 낱말
  const nb = t => { const i = t.indexOf('★'); return aiWords(((t.slice(0, i).match(/[가-힣]+\s*$/) || [''])[0]) + ' ' + ((t.slice(i + 1).match(/^\s*[가-힣]+/) || [''])[0]), f); };
  const part = String(s).split(/[,.!?…;]+/).find(p => p.includes('★')) || s;
  let sc = score(aiWords(part, f)), from = 0;
  if (sc.every(v => !v)) { sc = score(aiWords(s, f)); from = k + 1; }
  const best = lo => { let j = -1; sc.forEach((v, i) => { if (i !== k && i >= lo && v && (j < 0 || v > sc[j])) j = i; }); return j; };
  const ok = j => j >= 0 && sc[j] * 2 >= anchors[j].length && sc[j] > sc[k];
  if (!sc[k]) { const j = best(from); return ok(j) && (sc[j] >= 2 || hit(nb(s), nb(req.items[j].star)) > 0) ? j : -1; }
  // 이 줄과도 겹치면 뒤의 줄과만 견줘요 (앞 줄 일을 길게 되풀이해 이어 쓴 것은 괜찮게)
  const j = best(Math.max(from, k + 1));
  return ok(j) && sc[j] >= sc[k] + 2 ? j : -1;
}
// AI가 쓴 한 줄(t)을 단어 줄(x)에 맞춰 봐요. 쓸 수 있으면 { line: ★ 자리에 {영어|뜻}을 넣은 줄 }, 못 쓰면 { why: 까닭 }
// (다른 번호 줄의 답 같으면 to: 그 줄의 차례). ★가 없어도 단어 뜻을 그대로(활용꼴 포함) 쓴 줄은 예전처럼 뜻 자리를 찾아 써요 (how: '뜻 낱말로')
// req(aiReq 결과)를 주면 이야기 전체와 견줘요: 예시만 따라 쓴 말, 다른 번호 줄의 답
const AI_COPY = '앱 문장을 그대로 씀';
// 이야기의 단어 없는 줄(첫 줄 등)을 거의 그대로 되풀이한 문장은 떼요: AI가 '안개 낀 도시에서 케이크가 사라졌어요. 그래서 …'처럼
// 이야기 첫 줄을 다시 쓰고 이어 쓰는 일이 많았어요 (여러 줄이 같은 첫 문장으로 시작해서 이야기가 되풀이돼요).
// ★가 없는 문장 가운데, 단어 없는 줄 하나의 낱말(aiWords, 앞 두 글자로 견줘요)을 60% 이상 담은 문장. 남는 문장이 없으면 그대로 둬요
function aiDropEcho(s, req, f) {
  const ctx = req && Array.isArray(req.story) ? req.story.filter(e => !e.n).map(e => aiWords(e.text, f).map(w => w.slice(0, 2))).filter(ws => ws.length >= 3) : [];
  const parts = String(s).split(/(?<=[.!?…])\s+/);
  if (!ctx.length || parts.length < 2) return s;
  const echo = p => { const pw = new Set(aiWords(p, f).map(w => w.slice(0, 2))); return ctx.some(ws => ws.filter(w => pw.has(w)).length >= ws.length * 0.6); };
  const keep = parts.filter(p => /★/.test(p) || !echo(p));
  return keep.length && keep.length < parts.length ? keep.join(' ') : s;
}
function aiFit(t0, x, f, req) {
  const names = [f.H, f.F, f.V, ...Object.values(f.S || {})].filter(Boolean).sort((a, b) => b.length - a.length);
  // 앞에 붙은 '인물 이름:' 꼬리표는 떼요
  const t = t0.replace(new RegExp('^(?:' + names.map(aiEsc).join('|') + ')\\s*[:：\\-–—]\\s*'), '');
  // 따옴표·띄어쓰기·끝 문장부호만 다른 줄도 같은 줄로 봐요 (앱 문장의 ‘★’이라는 → 용감한이라는처럼 따옴표만 지운 베낌)
  const bare = s => String(s).replace(/[‘’“”"'「」『』\s]/g, '').replace(/[.!?…]+$/, '');
  const same = (a, b) => bare(a) === bare(b);
  const want = aiCast(x.star, f), castOk = s => !want.length || aiCast(s, f).some(k => want.includes(k));
  const s = aiDropEcho(aiStarTidy(t, x), req, f), stars = (s.match(/★/g) || []).length;
  if (stars > 1) return { why: stars === 2 ? '★가 두 번' : `★가 ${stars}번` };
  // 예시에만 나오는 말(아기 곰·높은 다리 …)을 앱 이야기에 없는데 썼으면 예시를 따라 쓴 거예요
  const story = req ? req.text : x.plain;
  if (AI_EXAMPLE_ONLY.some(re => re.test(s) && !re.test(story))) return { why: '예시를 따라 씀' };
  // 문장 수: 앱 줄이 두 문장이면 까닭·결과 한 문장을 더해 세 문장까지. 길이: 단어 표시({영어|뜻})와 끝 마침표까지 넣어 MK_LINE_MAX 안
  // (더 긴 줄은 단어장에 들어가지 않아요: mkEpisode)
  const sent = Math.max(2, aiSentN(x.plain) + 1), room = (line, plain) => MK_LINE_MAX - (line.length - plain.length) - (/[.!?”"…]$/.test(line) ? 0 : 1);
  if (!stars) {
    // 앱 문장을 그대로 베낀 줄은 고쳐 쓴 게 아니에요 (앱 문장이 그대로 남아요)
    if (same(s, x.plain)) return { why: AI_COPY };
    const mk = aiMark(s, x.id, x.w, x.ko), bad = aiLineWhy(s, mk ? mk.match(/\{[^|}]+\|([^}]+)\}/)[1] : '', { sent, max: mk ? room(mk, s) : MK_LINE_MAX });
    if (bad) return { why: bad };
    if (!mk) return { why: '★가 없음' };
    // '루나는 에 {…|의존했어요}'처럼 조사만 덩그러니 남은 줄은 버려요
    if (/(^|\s)(을|를|에|에게|에서|에도|과|와|으로|로)\s\{/.test(mk)) return { why: '조사만 남음' };
    if (!castOk(s)) return { why: '인물이 바뀜' };
    return { line: mk, how: '뜻 낱말로' };
  }
  if (same(s, x.star)) return { why: AI_COPY };
  if (req) { const j = aiOtherLine(s, x, req, f); if (j >= 0) return { why: '다른 줄 답 같음', to: j }; }
  const at = s.indexOf('★'), before = s.slice(0, at);
  let after = s.slice(at + 1);
  // ★ 자리가 문장에 맞는지: 문장 끝 꼴('빌렸어요')은 뒤에 문장부호나 닫는 따옴표만, '용감한'처럼 뒤에 낱말이 오는 꼴은 띄어 쓴 낱말이 와야 해요.
  // 이름씨는 조사를 받침에 맞게 고쳐요. 이름씨 ★ 뒤에는 조사·'이에요' 같은 말이나 띄어 쓴 낱말이 와야 해요
  // ('드디어 ★.'처럼 이름씨로 끝난 토막 글, '★처럼 반짝였어요'처럼 ★를 별 그림으로 읽은 줄은 버려요)
  if (x.cls === 'stick') {
    const q = (after.match(/^[’”"']/) || [''])[0], pm = after.slice(q.length).match(AI_JOSA);
    if (pm) after = q + koP(x.core, AI_JOSA_BASE[pm[1]] || pm[1]).slice(x.core.length) + after.slice(q.length + pm[1].length);
    const rest = after.slice(q.length);
    if (!/^(?:[가-힣]|\s+[^\s.!?…,])/.test(rest) || (/^(?:처럼|같이|모양)/.test(rest) && /반짝|빛나|빛났|빛이/.test(s))) return { why: '★ 자리가 문장과 안 맞음' };
  } else {
    // ★를 줄기처럼 보고 끝말을 또 붙였으면('★했어요', '★요', '★한 얼굴') 그 끝말이 ★ 말의 끝과 같을 때만 떼요
    const tail = (after.match(/^[가-힣]+/) || [''])[0];
    if (tail && x.core.endsWith(tail)) after = after.slice(tail.length);
    // '-의' 뜻('고대의')은 ★ 자리에 '의' 없이 들어가요: AI가 '★의 지도'처럼 '의'를 붙였으면 표시 밖에 그대로 둬요 ({ancient|고대}의 지도)
    const rest = x.cls === 'mid' && x.w && x.w.sub === 'pert' ? after.replace(/^의(?=\s)/, '') : after;
    if (!(x.cls === 'end' ? /^(?:[.!?…"”’'」』]|$)/ : /^[’”"']?,?\s+[^\s.!?…]/).test(rest)) return { why: '★ 자리가 문장과 안 맞음' };
  }
  const line = before + `{${x.id}|${x.core}}` + after, plain = before + x.core + after;
  // ★ 뒤에 ★ 말의 끝말을 붙였거나('발자국을 ★했어요.') 조사만 바꿨을 뿐 앱 문장과 똑같은 줄도 베낀 거예요
  if (same(plain, x.plain)) return { why: AI_COPY };
  const bad = aiLineWhy(plain, x.core, { sent, max: room(line, plain) });
  if (bad) return { why: bad };
  // ★ 바로 옆에 같은 뜻 낱말을 또 썼거나('불안해서 ★'), 앱 문장에 없던 '안·못'이 ★ 뜻을 뒤집으면 버려요
  const head = x.core.replace(/\s/g, '').slice(0, 2);
  const near = (b, a) => { const p = (b.replace(/[‘“"'\s]+$/, '').match(/[가-힣]+$/) || [''])[0], n = (a.replace(/^[’”"',\s]+/, '').match(/^[가-힣]+/) || [''])[0]; return /^[가-힣]{2}$/.test(head) && (p.startsWith(head) || n.startsWith(head)); };
  if (near(before, after) && !near(x.before, x.after)) return { why: '★ 옆에 같은 말' };
  const negB = /(?:^|\s)(?:안|못)\s*$/, negA = /^\s*(?:않|못하|못\s)/;
  if (x.cls !== 'stick' && ((negB.test(before) && !negB.test(x.before)) || (negA.test(after) && !negA.test(x.after)))) return { why: '안·못이 ★ 뜻을 뒤집음' };
  if (!castOk(plain)) return { why: '인물이 바뀜' };
  return { line };
}

// 한 글자 뜻('양', '배', '눈')은 다른 뜻으로 읽히기 쉬워요('양, 액수'의 '양'을 '하얀 양 떼'로): 단어의 다른 뜻을 덧붙여 알려 줘요 ('액수와 같은 뜻').
// 두 글자 이상인 뜻이나 다른 뜻이 없는 단어는 '' (요청 글을 짧게)
function aiHint(core, ko) {
  if (String(core).replace(/\s/g, '').length !== 1) return '';
  const o = String(ko || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/\s*[,;/]\s*/).map(s => s.replace(/~/g, '').replace(/\s+/g, ' ').trim()).filter(s => /[가-힣]{2}/.test(s) && s !== core).slice(0, 2);
  return o.length ? `${o.slice(0, -1).concat(koP(o[o.length - 1], '과')).join(', ')} 같은 뜻` : '';
}
// 요청 준비: 앱이 만든 이야기(res)에서 단어 줄을 찾아 번호를 붙이고 단어 뜻 자리를 ★로 (AI 진단도 같은 방법으로 실제 크기의 요청 글을 만들어요)
function aiReq(res, rows, n, budget = AI_BUDGET) {
  const f = SF[((n % SF.length) + SF.length) % SF.length];
  const lines = res.lines.slice(), plainOf = l => l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
  const idx = [], items = [];
  lines.forEach((l, i) => {
    const m = l.match(/\{([^|}]+)\|([^}]+)\}/);
    if (!m || !rows[m[1]]) return;
    const id = m[1], r = rows[id], w = stLex(id, r, f), end = m.index + m[0].length;
    const before = plainOf(l.slice(0, m.index)), after = plainOf(l.slice(end)), wrap = l[m.index - 1] === '‘' && l[end] === '’';
    const tail = wrap ? after.slice(1) : after;
    const cls = w.kind === 'n' || /^[가-힣]/.test(tail) ? 'stick' : /^(?:[.!?…"”’'」』]|\s*$)/.test(tail) ? 'end' : 'mid';
    idx.push(i); items.push({ id, w, ko: r.ko, core: m[2], hint: aiHint(m[2], r.ko), before, after, wrap, cls, star: before + '★' + after, plain: plainOf(l) });
  });
  const story = lines.map((l, i) => { const k = idx.indexOf(i); return k >= 0 ? { n: k + 1, core: items[k].core, hint: items[k].hint, text: items[k].star } : { n: 0, text: plainOf(l) }; });
  // text: 앱 이야기 전체 (AI 답에 예시만 따라 쓴 말이 있는지 견줘요), parts: 보낼 요청들 (aiParts), prompt: 첫 요청 글
  const parts = items.length ? aiParts(story, plainOf(lines[0] || ''), budget) : [];
  return { f, lines, plainOf, idx, items, story, text: lines.map(plainOf).join('\n'), parts, prompt: parts.length ? parts[0].prompt : '' };
}
// 단어장에 쓰려면 이야기 AI가 에피소드 단어 줄의 이만큼(2/3, 올림) 이상을 써야 해요. 모자라면 단어장을 만들지 않아요 (mkMake)
const AI_MIN_SHARE = 2 / 3;
const aiNeed = n => Math.ceil(n * AI_MIN_SHARE - 1e-9);
// 이야기(res)의 단어 줄 수 (AI가 쓸 번호 줄: aiReq와 같은 방법으로 셈)
const aiWordLines = (res, rows) => res.lines.filter(l => { const m = l.match(/\{([^|}]+)\|([^}]+)\}/); return !!(m && rows[m[1]]); }).length;
// 다시 묻기 요청: 버린 번호 줄(miss: 이야기 전체의 번호 줄 차례)만 담아요. 이야기 첫 줄(단어 없는 줄)을 앞에 두고 번호는 1부터,
// 같은 ★ 꼴과 길이 한도(aiParts). at: 'AI가 쓴 글 보기'에 이야기 전체의 번호로 적으려고. round: 몇 번째 다시 묻기인지 (1부터)
// copied: 버린 줄의 절반 이상이 앱 문장을 그대로 베낀 줄이었는지 ('AI가 쓴 글 보기' 제목에 '베끼지 말고 새로'로 적어요)
function aiReqAgain(req, miss, budget, copied = false, round = 1) {
  const items = miss.map(k => req.items[k]), head = req.story[0] && !req.story[0].n ? [req.story[0]] : [];
  const story = head.concat(items.map((x, i) => ({ n: i + 1, core: x.core, hint: x.hint, text: x.star })));
  return Object.assign({}, req, { items, story, at: miss, again: true, round, copied, parts: aiParts(story, head.length ? head[0].text : '', budget) });
}
// 앱이 만든 줄거리 틀(res)의 단어 줄을 AI 문장으로 바꿔요. 바꾼 줄 수를 돌려줘요.
// 요청이 여럿으로 나뉘면(aiParts) 차례로 묻고, 다 끝난 뒤에 한꺼번에 바꿔요 (중간에 오류가 나면 아무 줄도 바꾸지 않고 오류를 넘겨요)
// again(단어장 만들기): 규칙에 맞지 않아 버린 번호 줄만 담아 다시 물어요. 첫 번째 다시 묻기는 버린 줄이 있으면 늘,
// 두 번째부터는 그래도 이 에피소드에 모자랄 때만(aiNeed: 이대로면 단어장을 못 만들어요) 남은 줄만 담아 AI_AGAIN_MAX번까지.
// 컴퓨터에서 같은 줄을 두 번 물어도 또 베낀 줄이 있었어요: 한 번 더 물으면(약 5초, 휴대폰은 약 30초) 처음부터 다시 만드는 것보다 빨라요
const AI_AGAIN_MAX = 3;
// 묻는 온도: 처음 0.9, 다시 물을 때 1 (처음에 0.7로 물었을 때 앱 문장을 거의 다 베꼈고, 0.9로 다시 물으니 절반쯤을 새로 썼어요)
const AI_TEMP = 0.9, AI_TEMP_AGAIN = 1;
const AI_DIAG_N = 12;
async function aiRewrite(eng, res, rows, n, signal, again) {
  const budget = aiBudget(), req = aiReq(res, rows, n, budget), { lines, plainOf, idx, items, parts } = req;
  if (!items.length) return 0;
  const stop = () => { try { eng.interruptGenerate(); } catch (e) { } };
  if (signal) { if (signal.aborted) throw { code: 'cancelled' }; signal.addEventListener('abort', stop, { once: true }); }
  // 진단이 이 기기의 안전한 조각 크기를 새로 찾았으면 올라와 있는 AI도 그 크기로 읽어요
  if (AI.chunk) { const want = aiChunkPick(AI.gpuInfo); if (want !== AI.chunk) aiChunkSet(want); }
  const fits = items.map(() => null), whys = items.map(() => '');
  AI.copied = 0;
  try {
    for (let j = 0; j < parts.length; j++) await aiAsk(eng, req, parts[j], j, parts.length, fits, signal, whys);
    const need = Math.max(1, aiNeed(items.length));
    let miss = again ? items.map((x, k) => k).filter(k => !fits[k]) : [];
    for (let round = 1; miss.length && round <= AI_AGAIN_MAX && (round === 1 || items.length - miss.length < need); round++) {
      const copied = miss.filter(k => whys[k] === AI_COPY).length * 2 >= miss.length;
      const re = aiReqAgain(req, miss, budget, copied, round), got = miss.map(() => null), why2 = miss.map(() => '');
      for (let j = 0; j < re.parts.length; j++) await aiAsk(eng, re, re.parts[j], j, re.parts.length, got, signal, why2);
      miss.forEach((k, i) => { if (got[i]) fits[k] = got[i]; else whys[k] = why2[i] || whys[k]; });
      miss = miss.filter(k => !fits[k]);
    }
  } finally { if (signal) signal.removeEventListener('abort', stop); }
  // 끝까지 앱 문장을 그대로 베낀 줄 수 (단어장 만들기의 안내 글에 써요)
  AI.copied = items.filter((x, k) => !fits[k] && whys[k] === AI_COPY).length;
  let changed = 0;
  items.forEach((x, k) => {
    const fit = fits[k];
    if (!fit) return;
    const marked = fit.line;
    lines[idx[k]] = /[.!?”"…]$/.test(marked) ? marked : marked + '.';
    const wd = res.words && res.words[x.id];
    if (wd) wd.pic = plainOf(marked).slice(0, 120);
    changed++;
  });
  res.lines = lines;
  return changed;
}
// 요청 하나(part: aiParts의 묶음, j번째/모두 of개)를 묻고, 답을 번호 줄마다 맞춰 fits(이야기 전체의 번호 줄 차례)에 넣어요.
// 답의 번호는 요청마다 1부터예요. 'AI가 쓴 글 보기' 기록도 요청마다 남겨요
// whyOut: 쓰지 못한 줄의 까닭 (fits와 같은 차례)
async function aiAsk(eng, req, part, j, of, fits, signal, whyOut) {
  const f = req.f, mine = part.items.map(k => req.items[k]), sub = Object.assign({}, req, { items: mine });
  const title = (req.again ? `${f.title} · 다시 묻기${req.round > 1 ? ` ${req.round}` : ''}${req.copied ? ' (베끼지 말고 새로)' : ''}` : f.title) + (of > 1 ? ` · 요청 ${j + 1}/${of}` : '');
  let text = '';
  // 글을 조금씩 받아요(stream): 이야기를 다 읽었는지(첫 토큰), 토큰을 몇 개 썼는지 알 수 있어요. 멈추면 그 기록을 남겨요
  // (stream이 아닌 답이 와도 읽어요: 시험용 가짜 AI). 묻기 전에 다른 무거운 일꾼을 멈추고 돌던 일꾼을 적어요
  const workers = aiCalm();
  const work = AI.work = { step: 'read', t0: Date.now(), first: 0, tokens: 0, hidden: 0, stream: false, usage: null, size: AI.chunk, gap: AI.gap, est: part.est, workers };
  try {
    const reply = await eng.chat.completions.create({ messages: [{ role: 'user', content: part.prompt }], temperature: req.again ? AI_TEMP_AGAIN : AI_TEMP, top_p: 0.9, max_tokens: Math.min(1200, 90 * mine.length + 60), stream: true, stream_options: { include_usage: true } });
    if (reply && typeof reply[Symbol.asyncIterator] === 'function') {
      work.stream = true;
      for await (const ch of reply) {
        const c0 = ch && ch.choices && ch.choices[0], d = c0 && c0.delta && c0.delta.content;
        if (d) { if (!work.tokens) { work.step = 'write'; work.first = Date.now(); } work.tokens++; text += d; }
        if (ch && ch.usage) work.usage = ch.usage;
      }
    } else {
      text = (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
      work.usage = (reply && reply.usage) || null;
    }
  } catch (e) {
    // 문제 찾기용 기록: 어느 단계에서 몇 초 만에 몇 토큰을 쓰고 멈췄는지 (그만두기는 빼요)
    // 그래픽 칩을 잃었으면 그래픽 칩이 알려 준 까닭(끊김·오류)과, 글을 읽던 중인지 다 읽은 뒤인지도 붙여요
    if (!(e && e.code === 'cancelled') && !(signal && signal.aborted)) {
      const msg = aiMsgOf(e) || '알 수 없는 오류', info = aiWorkText(work, true);
      if (aiLost(e)) await aiGpuWait(work.t0);
      AI.diag = (AI.diag || []).concat([{ title, raw: String(text).slice(0, 1600), why: [`AI가 문장을 쓰다가 오류가 났어요: ${msg.slice(0, 300)}`], info, more: aiWorkMore(work, true), gpu: aiGpuLines(work.t0) }]).slice(-AI_DIAG_N);
    }
    throw e;
  } finally { if (AI.work === work) AI.work = null; }
  if (signal && signal.aborted) throw { code: 'cancelled' };
  const cand = aiParse(aiNoThink(text), mine.length, mine);
  // 문제 찾기용 기록: AI가 쓴 글과 줄마다 쓰지 못한 까닭 (완성 화면에서 펼쳐 볼 수 있어요)
  const diag = { title, raw: String(text).slice(0, 1600), why: [], info: aiWorkText(work, false), more: aiWorkMore(work, false), gpu: aiGpuLines(work.t0) };
  const got = mine.map(() => null), whys = [], moved = [];
  mine.forEach((x, k) => {
    let why = cand[k].length ? '' : '답에서 이 번호를 못 찾음';
    for (const t of cand[k]) {
      const r = aiFit(t, x, f, sub);
      if (r.line) { got[k] = r; break; }
      if (r.to != null) moved.push({ t, from: k, to: r.to });
      why = why || r.why;
    }
    whys[k] = why;
  });
  // 줄을 빼먹고 번호를 당겨 쓴 답: 그 답이 맞는 줄(이 요청 안)이 아직 비어 있으면 그 줄로 옮겨 봐요
  for (const mv of moved) {
    if (got[mv.to]) continue;
    const r = aiFit(mv.t, mine[mv.to], f, sub);
    if (r.line) got[mv.to] = Object.assign(r, { from: mv.from });
  }
  // 기록의 번호는 이야기 전체의 번호 줄 차례 (요청을 나눴어도 단어 줄 순서대로)
  const num = k => (req.at ? req.at[part.items[k]] : part.items[k]) + 1;
  mine.forEach((x, k) => {
    const fit = got[k];
    diag.why.push(`${num(k)}. ${x.id}: ${!fit ? whys[k] : fit.how ? `씀 (★ 없이 ${fit.how})` : fit.from != null ? `씀 (${num(fit.from)}번 답을 옮겨 씀)` : '씀'}`);
    if (fit) fits[part.items[k]] = fit;
    else if (whyOut) whyOut[part.items[k]] = whys[k];
  });
  AI.diag = (AI.diag || []).concat([diag]).slice(-AI_DIAG_N);
}

/* ---------- AI 진단 (문제 찾기용) ----------
   만들기 화면 AI 상자의 'AI 진단' 단추: 진짜 AI로 단계를 차례로 해 보고, 처음 실패한 단계에서 멈춰요.
   1 불러오기 → 2 그래픽 준비(처음 쓸 때 그래픽 칩이 계산 방법을 준비하는 시간을 따로 재요) → 3 짧은 글 →
   4~7 같은 중간 글(약 275토큰)을 16·32·64·128토큰씩 나눠 읽기 → 8 실제 크기 요청 → 9 길게 쓰기 (8·9는 찾은 안전한 조각 크기로).
   조각 크기 재기: 조각 하나가 1.2초를 넘으면 그래픽 칩 한계에 가까워서 더 큰 크기는 재지 않아요. 1초 안에 끝난 가장 큰 크기를
   이 기기의 안전한 조각 크기로 남기고 이야기 만들기에 써요. 실패하면(그래픽 칩을 잃음) 그 엔진은 다시 쓰지 않고 멈춰요.
   단계마다 성공·실패, 걸린 시간, 조각 크기·조각 수·가장 오래 걸린 조각, 읽은·쓴 토큰 수, 초당 토큰 수(WebLLM이 알려 준 값),
   그동안 그래픽 칩이 알려 준 일(끊김 까닭·오류)을 남겨요.
   결과는 이 휴대폰(localStorage)에만 남고 어디에도 보내지 않아요. 진단 중에 탭이 꺼지면, 다음에 열 때 하던 단계를 '탭 꺼짐'으로 보여 주고
   그때 재던 조각 크기는 다시 쓰지 않아요 */
const AI_BENCH_KEY = 'wg-ai-bench';
const AI_BENCH = [
  { k: 'load', label: '1 저장소에서 불러오기' },
  { k: 'warm', label: '2 그래픽 준비(처음 한 번)', out: 4 },
  { k: 'tiny', label: '3 짧은 글 읽기', out: 16 },
  { k: 'sweep', size: 16, label: '4 중간 글 16토큰씩 읽기', out: 4 },
  { k: 'sweep', size: 32, label: '5 중간 글 32토큰씩 읽기', out: 4 },
  { k: 'sweep', size: 64, label: '6 중간 글 64토큰씩 읽기', out: 4 },
  { k: 'sweep', size: 128, label: '7 중간 글 128토큰씩 읽기', out: 4 },
  { k: 'long', label: '8 긴 글 읽기(실제 크기)', out: 16 },
  { k: 'len', len: 448, label: '9 글 길이 448토큰 읽기', out: 4 },
  { k: 'len', len: 512, label: '10 글 길이 512토큰 읽기', out: 4 },
  { k: 'len', len: 576, label: '11 글 길이 576토큰 읽기', out: 4 },
  { k: 'write', label: '12 길게 쓰기(600토큰)', out: 600 }
];
// 진단이 너무 길어지지 않게: 불러오기가 끝나고 이만큼(8분) 지나면 남은 단계는 건너뛰어요
const AI_BENCH_MAX_MS = 8 * 60 * 1000;
// 진단에 쓰는 단어 (일반 사전 낱말과 직접 쓴 뜻). 실제 에피소드처럼 6개
const AI_BENCH_WORDS = [['borrow', '빌리다'], ['encourage', '격려하다'], ['whisper', '속삭이다'], ['brave', '용감한'], ['harvest', '수확'], ['compare', '비교하다']];
const AI_BENCH_WARM = '안녕! 한 낱말로 인사해 줘.';
const AI_BENCH_TINY = '너는 어린이 그림책 작가야. 읽는 사람은 어린이와 청소년이야. 용감한 고양이가 나오는 이야기의 첫 문장을 한 문장으로 써 줘.';
// 실제 에피소드 요청 글: 단어장 만들기와 똑같이 앱 이야기(mkStory)를 만들고 aiRewrite와 같은 방법(aiReq)으로 (요청을 나누면 첫 요청)
function aiBenchLong() {
  const rows = Object.create(null);
  for (const [en, ko] of AI_BENCH_WORDS) rows[en] = { en, ko, pos: 'x' };
  return aiReq(mkStory(AI_BENCH_WORDS.map(w => w[0]), rows, 0), rows, 0, aiBudget()).prompt;
}
// 중간 글: 실제 요청 글의 앞부분. 3단계에서 잰 '글자당 토큰'으로 450토큰 안쪽이 되게 잘라요 (실제 글보다는 늘 짧게).
// 갤럭시 S25에서는 약 275토큰이었어요 (이 글을 한 조각으로 읽다가 그래픽 칩이 끊겼어요). 조각 크기 재기는 모두 이 글로 해요
function aiBenchChunk(long, perChar) {
  const r = perChar > 0.1 && perChar < 3 ? perChar : 0.7, n = Math.min(Math.floor(420 / r), Math.floor(long.length * 0.75));
  let t = long.slice(0, n);
  const nl = t.lastIndexOf('\n');
  if (n < long.length && nl > n * 0.6) t = t.slice(0, nl);
  return t + '\n\n위 이야기의 첫 줄을 한 문장으로 다시 써 줘.';
}
// 글 길이 재기(9~11단계): 실제 요청 글(base)의 이야기 줄을 되풀이해 붙여서 target 토큰쯤 되는 글을 만들어요.
// ratio: 글자당 토큰 (앞 단계에서 실제로 읽은 토큰으로 맞춘 값). 목표에 가장 가까운 줄 수로
function aiBenchLen(base, target, ratio) {
  const r = ratio > 0.1 && ratio < 3 ? ratio : AI_TOK_PER_CHAR, est = t => t.length * r + AI_TOK_TMPL;
  const L = base.split('\n'), s0 = L.indexOf('이야기:') + 1, s1 = L.lastIndexOf('');
  const ok = s0 > 0 && s1 > s0, head = ok ? L.slice(0, s0) : [], story = ok ? L.slice(s0, s1) : L, tail = ok ? L.slice(s1) : [], body = [];
  const text = () => head.concat(body, tail).join('\n');
  for (let i = 0; i < 400 && est(text()) < target; i++) body.push(story[i % story.length]);
  if (body.length > 1) { const over = est(text()) - target, last = body.pop(); if (over < target - est(text())) body.push(last); }
  return text();
}
const aiUaText = () => {
  try {
    const ua = navigator.userAgent || '', a = ua.match(/Android ([\d.]+)/), c = ua.match(/Chrome\/([\d.]+)/);
    let app = false; try { app = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); } catch (e) { }
    return [a && `Android ${a[1]}`, c && `Chrome ${c[1]}`, app && '설치한 앱'].filter(Boolean).join(' · ');
  } catch (e) { return ''; }
};
function aiBenchSave(b) { b.seen = Date.now(); try { localStorage.setItem(AI_BENCH_KEY, JSON.stringify(b)); } catch (e) { } }
// 저장해 둔 진단 결과. 진단하는 중으로 남아 있으면 그때 탭이 꺼진 거예요: 하던 단계를 '탭 꺼짐'으로 바꿔요 (crashNew: 이번에 처음 찾음).
// 조각 크기를 재거나 긴 글을 읽다가 꺼졌으면 그 조각 크기는 이 기기에서 다시 쓰지 않아요
function aiBenchLoad() {
  if (AI.bench !== undefined) return AI.bench;
  let b = null;
  try { b = JSON.parse(localStorage.getItem(AI_BENCH_KEY) || 'null'); } catch (e) { b = null; }
  if (!b || b.v !== 1 || !Array.isArray(b.stages)) b = null;
  AI.bench = b;
  if (b && b.state === 'run') {
    b.state = 'crash';
    for (const st of b.stages) {
      if (st.state !== 'run') continue;
      st.state = 'crash'; st.s = Math.max(0, ((b.seen || st.t0) - st.t0) / 1000);
      if (b.ckey && st.size > 0 && (st.k === 'sweep' || st.k === 'long')) { aiChunkBad(b.ckey, st.size); st.note = `${st.size}토큰 조각은 이제 쓰지 않아요`; }
    }
    aiBenchSave(b);
    b.crashNew = true;
  }
  return b;
}
// 한 단계 묻기: 실제 이야기 쓰기와 같은 설정, 정해 둔 토큰 수만큼 끝까지 쓰게(ignore_eos). 조금씩 받아서 첫 글자까지 걸린 시간도 재요
async function aiBenchAsk(eng, prompt, out, st) {
  const t0 = Date.now();
  st.tin = 0; st.tout = 0; st.first = null; st.workers = aiCalm();
  const reply = await eng.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, top_p: 0.9, max_tokens: out, ignore_eos: true, stream: true, stream_options: { include_usage: true } });
  let usage = null;
  if (reply && typeof reply[Symbol.asyncIterator] === 'function') {
    for await (const ch of reply) {
      const c0 = ch && ch.choices && ch.choices[0], d = c0 && c0.delta && c0.delta.content;
      if (d) { if (st.first == null) st.first = (Date.now() - t0) / 1000; st.tout++; }
      if (ch && ch.usage) usage = ch.usage;
    }
  } else usage = reply && reply.usage;
  if (usage) {
    const x = usage.extra || {};
    st.tin = +usage.prompt_tokens || 0; st.tout = +usage.completion_tokens || st.tout;
    st.pre = +x.prefill_tokens_per_s || 0; st.dec = +x.decode_tokens_per_s || 0;
  }
}
// 진단하기: 단계를 차례로. 실패하면 거기서 멈춰요. onChange(b): 단계가 바뀌거나 그래픽 칩 소식·조각 시간이 올 때마다
async function aiBenchRun(signal, onChange) {
  const b = AI.bench = { v: 1, model: aiModel(), t0: Date.now(), state: 'run', env: aiEnvText(), dev: '', ua: aiUaText(), ckey: '', safe: 0, stages: AI_BENCH.map(s => Object.assign({ k: s.k, label: s.label, state: '' }, s.size ? { size: s.size } : {})) };
  if (aiNeedsDownload()) b.stages[0].label = '1 받기·저장소에서 불러오기';
  // top: 이 크기부터는 재지 않아요 (한계에 가까웠던 크기)
  // lenRatio: 글 길이 재기 글을 만들 때 쓸 글자당 토큰 (실제 요청·길이 재기에서 읽은 토큰으로 맞춰요)
  let cur = null, eng = null, perChar = 0, lenRatio = 0, long = '', mid = '', top = Infinity, phone = true;
  const put = () => { aiBenchSave(b); if (onChange) try { onChange(b); } catch (e) { } };
  AI.onGpu = ev => {
    if (AI.bench !== b) return;
    if (ev.kind === 'adapter' || ev.kind === 'device') { b.dev = aiDevText(); put(); return; }
    // 끝난 뒤 10초 안에 온 소식은 마지막 단계에 붙여요 (끊김 소식이 오류보다 늦게 올 수 있어요)
    const st = cur || (b.end && Date.now() - b.end < 10000 ? b.stages.filter(s => s.state && s.state !== 'skip').pop() : null);
    if (!st) return;
    st.gpu = (st.gpu || []).concat([aiGpuLine(ev)]).slice(0, 16);
    // 마지막 조각 소식에서 끊김 소식까지 걸린 시간
    if (ev.kind === 'lost' && st.lastAt && st.lostGap == null) st.lostGap = aiGapMs({ at: st.lastAt, ms: st.lastMs || 0 }, ev);
    put();
  };
  // 조각 하나가 끝날 때마다 그 단계에 적고 저장해요 (탭이 꺼져도 어디까지 읽었는지 남게)
  AI.onChunk = ev => {
    if (AI.bench !== b || !cur || cur.k === 'load') return;
    cur.cn = (cur.cn || 0) + 1; cur.cmax = Math.max(cur.cmax || 0, ev.took);
    if (ev.size) cur.size = ev.size;
    // 마지막 조각 12개의 시간, 몇 번째 조각/모두 몇 개, 받은 시각 (끊겼을 때 어디까지 읽었는지)
    cur.last = (cur.last || []).concat([ev.took]).slice(-12); cur.ci = ev.i + 1; cur.cof = ev.of; cur.lastAt = ev.at; cur.lastMs = ev.ms;
    put();
  };
  // 글을 다 읽고 첫 토큰을 고르기 시작함·끝남
  AI.onSample = ev => { if (AI.bench !== b || !cur || cur.k === 'load') return; cur.samp = ev.step; put(); };
  const stopped = new Promise((_, no) => {
    const f = () => no({ code: 'cancelled' });
    if (signal) { if (signal.aborted) f(); else signal.addEventListener('abort', f, { once: true }); }
  });
  stopped.catch(() => { });
  const PH = { init: '준비 시작', fetch: '받는 중', load: '그래픽 칩에 올리는 중', shader: '마무리하는 중' };
  put();
  try {
    const info = await Promise.race([aiGpuInfo(), stopped]);
    b.ckey = aiChunkKey(info); phone = aiIsPhone(info); b.desk = !phone;
    for (let i = 0; i < AI_BENCH.length; i++) {
      const def = AI_BENCH[i], st = b.stages[i];
      const maxMs = AI.benchMaxMs == null ? AI_BENCH_MAX_MS : AI.benchMaxMs; // AI.benchMaxMs: 시험용
      if (i > 0 && b.t1 && Date.now() - b.t1 >= maxMs) { st.state = 'skip'; st.note = `진단이 ${Math.round(maxMs / 60000)}분을 넘어서 건너뛰었어요`; b.late = true; put(); continue; }
      // 컴퓨터는 조각 크기를 재지 않아요: 모델이 만들어진 512토큰 그대로 읽어요 (안 됐거나 너무 오래 걸린 크기가 있을 때만 작게)
      if (def.k === 'sweep' && !phone) { st.state = 'skip'; st.note = '컴퓨터는 조각 크기를 재지 않고 모델이 만들어진 크기 그대로 읽어요'; put(); continue; }
      if (def.k === 'sweep') {
        // 처음 재기 전에 전에 찾은 안전한 크기를 지워요 (이번에 다시 찾아요). 전에 안 된 크기와 그보다 큰 크기, 한계에 가까웠던 크기부터는 건너뛰어요
        if (def === AI_BENCH.find(d => d.k === 'sweep')) aiChunkPut(b.ckey, r => { r.safe = 0; });
        const bad = aiChunkRec(b.ckey).bad.filter(n => n <= def.size);
        if (bad.length || def.size >= top) {
          st.state = 'skip';
          st.note = def.size >= top ? `${top}토큰 조각이 한계에 가까워서 건너뛰었어요` : bad.includes(def.size) ? '전에 이 크기가 안 돼서 건너뛰었어요' : `전에 ${bad[0]}토큰 조각이 안 돼서 건너뛰었어요`;
          put();
          continue;
        }
      }
      cur = st; st.state = 'run'; st.t0 = Date.now(); put();
      try {
        if (def.k === 'load') {
          // 늘 새로 불러와서 재요 (올라와 있던 AI는 내려놓아요)
          if (AI.engine || AI.worker || AI.loading) aiDrop();
          // 어느 단계 몇 %까지 갔는지 (10%마다 저장해요: 탭이 꺼져도 어디까지 갔는지 남게)
          let last = '';
          eng = await Promise.race([aiLoad(() => { const ph = AI.phase || {}, k = `${ph.step}:${Math.floor((ph.pct || 0) / 10)}`; st.at = `${PH[ph.step] || ph.step} ${ph.pct || 0}%`; if (k !== last) { last = k; put(); } }), stopped]);
          st.at = ''; b.t1 = Date.now();
        } else {
          if (!long) long = aiBenchLong();
          if (def.k === 'sweep') { if (!mid) mid = aiBenchChunk(long, perChar); aiChunkSet(def.size); }
          // 실제 크기 요청·글 길이 재기·길게 쓰기는 이 기기에 쓸 조각 크기로 (방금 찾은 안전한 크기)
          if (def.k === 'long' || def.k === 'len' || def.k === 'write') aiChunkSet(aiChunkPick(info));
          st.size = AI.chunk; st.gap = AI.gap;
          const prompt = def.k === 'long' ? long : def.k === 'len' ? aiBenchLen(long, def.len, lenRatio || perChar) : def.k === 'sweep' ? mid : def.k === 'warm' ? AI_BENCH_WARM : AI_BENCH_TINY;
          if ((def.k === 'sweep' || def.k === 'long') && perChar) st.est = Math.round(prompt.length * perChar + 8);
          if (def.k === 'len') st.est = Math.round(prompt.length * (lenRatio || perChar || AI_TOK_PER_CHAR)) + AI_TOK_TMPL;
          await Promise.race([aiBenchAsk(eng, prompt, def.out, st), stopped]);
          if (def.k === 'tiny' && st.tin > 8) perChar = (st.tin - 8) / AI_BENCH_TINY.length;
          // 글자당 토큰을 실제로 읽은 토큰(usage.prompt_tokens)으로 맞춰요: 다음 길이 재기 글이 목표에 가깝게
          if ((def.k === 'long' || def.k === 'len') && st.tin > AI_TOK_TMPL) lenRatio = (st.tin - AI_TOK_TMPL) / prompt.length;
          if (def.k === 'len' && st.tin && Math.abs(st.tin - def.len) > 40) st.note = `목표와 ${st.tin - def.len}토큰 차이`;
          // 컴퓨터: 실제 크기 요청에서 조각 하나가 너무 오래 걸렸으면 그 크기는 다음부터 쓰지 않아요 (그래픽 칩 한계에 가까워요. 반으로 줄여요)
          if (!phone && def.k === 'long' && st.cmax > AI_CHUNK_SLOW_MS && st.size > 1) { aiChunkBad(b.ckey, st.size); st.note = `조각 하나가 ${(AI_CHUNK_SLOW_MS / 1000).toFixed(1)}초를 넘어서 다음부터 ${aiChunkPick(info)}토큰씩 읽어요`; }
          if (def.k === 'sweep') {
            if (!st.cn) st.note = '조각 시간을 받지 못해서 안전한 크기로 남기지 않았어요';
            else if (st.cmax > AI_CHUNK_SLOW_MS) { top = def.size; aiChunkBad(b.ckey, def.size); st.note = `조각 하나가 ${(AI_CHUNK_SLOW_MS / 1000).toFixed(1)}초를 넘어서 그래픽 칩 한계에 가까워요`; }
            else if (st.cmax < AI_CHUNK_OK_MS) { b.safe = def.size; aiChunkPut(b.ckey, r => { r.safe = def.size; }); }
          }
        }
        st.state = 'ok';
      } catch (e) {
        if (e && e.code === 'cancelled') { st.state = 'stop'; throw e; }
        st.state = 'fail';
        st.err = (def.k === 'load' && AI.err ? AI.err.text : aiMsgOf(e) || '알 수 없는 오류').slice(0, 300);
        // 이 조각 크기는 이 기기에서 다시 쓰지 않아요 (실제 크기 요청은 그래픽 칩을 잃었을 때만)
        if (st.size > 0 && (def.k === 'sweep' || (def.k === 'long' && aiLost(e)))) { aiChunkBad(b.ckey, st.size); st.note = `${st.size}토큰 조각은 이제 쓰지 않아요`; }
        // 그래픽 칩을 잃었으면 끊김 소식을 잠깐 기다려요
        if (def.k === 'load' || aiLost(e)) await aiGpuWait(st.t0);
        throw e;
      } finally { st.s = (Date.now() - st.t0) / 1000; put(); }
    }
    b.state = 'done';
  } catch (e) {
    b.state = e && e.code === 'cancelled' ? 'stop' : 'fail';
    if (b.state === 'stop') { if (eng) try { eng.interruptGenerate(); } catch (x) { } if (!AI.engine) aiDrop(); }
    // 실패한 엔진은 다시 쓰지 않아요 (다음 단어장은 새로 불러와요)
    else aiDrop();
  } finally { cur = null; b.end = Date.now(); if (b.desk) b.chunk = aiChunkPick(AI.gpuInfo); if (AI.bench === b) { AI.onChunk = null; AI.onSample = null; } put(); }
  return b;
}
// 진단 중에 화면이 꺼지거나 다른 앱이 열리면 그 단계에 적어요
function aiBenchOnVis() {
  const b = AI.bench;
  if (!b || b.state !== 'run' || typeof document === 'undefined' || !document.hidden) return;
  const st = b.stages.find(s => s.state === 'run');
  if (st) { st.hid = (st.hid || 0) + 1; aiBenchSave(b); }
}
// 진단 결과 글: 한 단계에 한 줄 + 기기 줄 + 그래픽 칩 소식 + 이 기기의 안전한 조각 크기 (복사해서 보낼 수 있게 글로만)
function aiBenchText(b) {
  if (!b) return '';
  const d = new Date(b.t0), two = n => String(n).padStart(2, '0');
  const out = [`AI 진단 · ${b.model || AI_MODEL} · ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}${b.ua ? ' · ' + b.ua : ''}`];
  if (b.env) out.push(b.env);
  if (b.dev) out.push(b.dev);
  const ST = { ok: 'ok (성공)', fail: 'fail (실패)', crash: 'crashed (탭 꺼짐)', stop: '그만둠', run: '하는 중', skip: '건너뜀', '': '안 함' };
  for (const st of b.stages) {
    const p = [`${st.label}: ${ST[st.state] != null ? ST[st.state] : st.state}`];
    if (st.state === 'run') p.push(`${aiSec(Date.now() - st.t0)}째`);
    else if (st.state && st.state !== 'skip' && st.s != null) p.push(`${(+st.s).toFixed(1)}초${st.state === 'crash' ? ' 뒤 꺼짐' : ''}`);
    if (st.at) p.push(st.at);
    if (st.k !== 'load' && st.k !== 'sweep' && st.size && st.state && st.state !== 'skip') p.push(`조각 ${st.size}토큰`);
    if (st.cn) p.push(`조각 ${st.cn}개 · 조각 최대 ${st.cmax}ms`);
    if (st.tin) p.push(`읽은 토큰 ${st.tin}`); else if (st.est && st.state && st.state !== 'skip') p.push(`읽을 토큰 약 ${st.est}(어림)`);
    if (st.k !== 'load' && st.state && st.state !== 'skip') p.push(`쓴 토큰 ${st.tout || 0}`);
    if (st.first != null) p.push(`첫 글자까지 ${(+st.first).toFixed(1)}초`);
    if (st.pre) p.push(`읽기 ${(+st.pre).toFixed(1)}토큰/초`);
    if (st.dec) p.push(`쓰기 ${(+st.dec).toFixed(1)}토큰/초`);
    if (st.note) p.push(st.note);
    if (st.hid) p.push(`화면 꺼짐·다른 앱 ${st.hid}번`);
    if (st.err) p.push(`오류: ${st.err}`);
    out.push(p.join(' · '));
    for (const g of st.gpu || []) out.push(`   - ${g}`);
    // 멈춘 단계: 요청 전 일꾼, 마지막 조각 12개의 시간, 첫 토큰 고르기, 마지막 조각에서 끊김까지
    if (st.k !== 'load' && (st.state === 'fail' || st.state === 'crash' || st.state === 'run')) for (const m of aiMoreText({ workers: st.workers, last: st.last, ci: st.ci, cof: st.cof, gap: st.gap, samp: st.samp || '', lostGap: st.lostGap, failed: st.state !== 'run' })) out.push(`   · ${m}`);
  }
  // 조각 크기를 재기 시작했으면: 이번에 찾은 안전한 크기 (이야기를 만들 때 이 크기로 읽어요)
  if (b.stages.some(s => s.k === 'sweep' && s.state && s.state !== 'skip')) out.push(b.safe ? `이 기기의 안전한 조각 크기: ${b.safe}토큰 (이야기를 만들 때 이 크기로 나눠 읽어요)` : '이 기기의 안전한 조각 크기: 아직 못 찾았어요');
  // 컴퓨터: 쓸 조각 크기 (모델이 만들어진 512토큰, 안 됐거나 너무 오래 걸린 크기가 있으면 그보다 작게)
  if (b.desk && b.chunk) out.push(`이 컴퓨터의 조각 크기: ${b.chunk}토큰 (${b.chunk < AI_CHUNK ? '안 됐거나 너무 오래 걸린 크기가 있어서 작게 읽어요' : '모델이 만들어진 크기 그대로'})`);
  const bad = b.stages.find(s => s.state === 'fail' || s.state === 'crash');
  out.push(b.state === 'run' ? '결과: 진단하는 중이에요. 화면을 켜 둔 채 기다려 주세요.' : b.state === 'done' ? (b.late ? '결과: 진단이 길어져서 남은 단계는 건너뛰었어요.' : '결과: 모든 단계를 마쳤어요.') : b.state === 'stop' ? '결과: 중간에 그만뒀어요.'
    : bad ? `결과: ${bad.label.split(' ')[0]}단계에서 멈췄어요${bad.state === 'crash' ? ' (진단 중에 탭이 꺼졌어요)' : ''}.` : '결과: 멈췄어요.');
  return out.join('\n');
}
