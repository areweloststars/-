/* ================= 휴대폰 안 AI로 이야기 쓰기 (Gemma 3 1B, WebLLM) =================
   처음 한 번 AI 모델(약 0.7GB)을 받아 브라우저에 저장하고, 그다음부터는 인터넷 없이 이 기기에서 이야기를 써요.
   이야기 틀·인물·단어 순서(말썽 → 해결)는 앱이 정하고(mkStory), AI는 단어마다 한 문장씩 앞 문장에 이어서 다시 써요.
   AI 문장에 단어 뜻이 없거나 이상하면 그 줄만 앱이 만든 문장을 그대로 둬요.
   모델 파일은 저장소에 없어요: word-game/llm/NOTICE.txt (Gemma 이용 약관) */
const AI_MODEL = 'gemma3-1b-it-q4f16_1-MLC';
const AI_SIZE = '약 0.7GB';
const AI = { engine: null, loading: null, gpu: null };
const aiURL = p => new URL(p, location.href).href;
// 이 기기에서 AI를 돌릴 수 있는지 (WebGPU)
async function aiGpuOk() {
  if (AI.gpu != null) return AI.gpu;
  try { AI.gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { AI.gpu = false; }
  return AI.gpu;
}
// 전에 모델을 다 받아 둔 적이 있는지 (처음 안내 문구에만 써요)
const aiReadyBefore = () => { try { return localStorage.getItem('wg-ai-ready') === AI_MODEL; } catch (e) { return false; } };
// 모델 준비: 처음이면 내려받고(진행률 onProgress(0~1, 글)), 다음부터는 저장된 것으로 금방
function aiLoad(onProgress) {
  if (AI.engine) return Promise.resolve(AI.engine);
  if (!AI.loading) {
    AI.loading = (async () => {
      const lib = await import(aiURL('llm/web-llm.js'));
      const worker = new Worker(aiURL('llm/worker.js'), { type: 'module' });
      const eng = await lib.CreateWebWorkerMLCEngine(worker, AI_MODEL, {
        initProgressCallback: p => { if (AI.onProgress) AI.onProgress(+p.progress || 0, String(p.text || '')); }
      });
      try { localStorage.setItem('wg-ai-ready', AI_MODEL); } catch (e) { }
      AI.engine = eng;
      return eng;
    })().catch(e => { AI.loading = null; throw e; });
  }
  AI.onProgress = onProgress;
  return AI.loading;
}

// 단어 뜻 찾기 열쇠: 학생 뜻의 기본꼴·활용꼴·줄기 ('격려하다' → 격려했어요·격려하는·격려…)
function aiKeys(w, ko) {
  const keys = new Set();
  const senses = String(ko || '').replace(/\([^)]*\)|\[[^\]]*\]|~/g, ' ').split(/\s*[,;/]\s*/).map(s => s.replace(/[^가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const add = s => { s = String(s || '').trim(); if (s && /[가-힣]/.test(s)) keys.add(s); };
  for (const s of senses) {
    add(s);
    add(s.replace(/다$/, ''));
    add(s.replace(/(하다|되다|시키다|하는|한|된|스럽다|스러운|롭다|로운|적인|이다|다)$/, ''));
  }
  for (const v of Object.values((w && w.forms) || {})) add(String(v).split(' ')[0].replace(/(어요|아요|요)$/, '')); // '줄였어요' → '줄였' (과거 글자는 남겨요)
  if (w && w.base) add(w.base);
  // 너무 짧은 열쇠(한 글자)는 빼요: '수'·'빈' 같은 글자가 아무 데나 걸리지 않게
  return [...keys].filter(k => k.replace(/\s/g, '').length >= 2).sort((a, b) => b.length - a.length);
}
// AI 문장에서 단어 뜻 자리를 찾아 {영어|그 낱말 덩어리}로 ('격려' → {encourage|격려했어요}). 못 찾으면 null
// 다른 낱말 속에 든 글자('기억' 속 '억')는 쓰지 않아요: 낱말 첫머리에서 시작할 때만
function aiMark(line, id, w, ko) {
  for (const k of aiKeys(w, ko)) {
    for (let at = line.indexOf(k); at >= 0; at = line.indexOf(k, at + 1)) {
      if (at > 0 && /[가-힣A-Za-z0-9]/.test(line[at - 1])) continue;
      let end = at + k.length;
      while (end < line.length && /[가-힣]/.test(line[end])) end++;
      return line.slice(0, at) + `{${id}|${line.slice(at, end)}}` + line.slice(end);
    }
  }
  return null;
}
// AI가 쓴 한 줄을 다듬고 쓸 만한지 봐요
function aiClean(s) {
  let t = String(s || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:\d+\s*[.)]|[-•*])\s*/, '').trim();
  // '[낱말] 인물 → 문장' 꼴로 답하면 문장만
  if (t.includes('→')) t = t.split('→').pop().trim();
  t = t.replace(/^\[[^\]]*\]\s*/, '').replace(/^["“']|["”']$/g, '').trim();
  return t;
}
const aiLineOk = t => t.length >= 6 && t.length <= 90 && /[가-힣]{2}/.test(t) && !/[{}|<>]/.test(t) && !/[A-Za-z]{3,}/.test(t) && !/(.)\1{4,}/.test(t);

// 요청 글: 이야기 앞부분 + 인물 + 번호마다 [뜻] 누가
function aiPrompt(f, intro, items) {
  const ex = [
    '1. [훔치다] 장난꾸러기 너구리 → 장난꾸러기 너구리가 곰네 부엌에서 꿀단지를 몰래 훔쳤어요.',
    '2. [불안한] 아기 곰 보보 → 꿀단지가 사라지자 아기 곰 보보는 불안한 얼굴로 숲을 두리번거렸어요.',
    '3. [빌리다] 아기 곰 보보 → 보보는 발자국을 찾으려고 엄마 곰에게서 돋보기를 빌렸어요.',
    '4. [격려하다] 엄마 곰 → 엄마 곰은 “넌 꼭 찾을 수 있어!” 하며 보보를 격려했어요.'
  ].join('\n');
  const list = items.map((x, i) => `${i + 1}. [${x.mean}] ${x.who}`).join('\n');
  return `너는 어린이 그림책 작가야. 아래 이야기에 이어서, 번호마다 한 문장씩 써 줘.

이야기 앞부분: ${intro}
등장인물: ${f.H}(주인공), ${f.F}(친구), ${f.V}(말썽꾼). 소중한 것: ${f.G}.

규칙:
- 번호마다 딱 한 문장, 40자 안팎. 앞 문장에서 자연스럽게 이어지게.
- 문장마다 [ ] 안의 낱말을 꼭 넣어. 끝은 문장에 맞게 바꿔도 돼 (빌리다 → 빌렸어요, 불안한 → 불안했어요).
- 그 낱말의 뜻이 장면으로 바로 보이게. 웃기고 따뜻하게. 무섭거나 나쁜 말은 쓰지 마.
- 번호와 문장만 써. 영어는 쓰지 마.

예시 (다른 이야기):
${ex}

이제 써 줘:
${list}`;
}
// AI 답에서 번호별 문장
function aiParse(text, n) {
  const out = Array(n).fill(null);
  for (const raw of String(text || '').split(/\n+/)) {
    const m = raw.match(/^\s*(\d{1,2})\s*[.)]\s*(.+)$/);
    if (!m) continue;
    const k = +m[1] - 1;
    if (k >= 0 && k < n && !out[k]) out[k] = aiClean(m[2]);
  }
  return out;
}

// 앱이 만든 이야기(res)의 단어 줄을 AI 문장으로 바꿔요. 바꾼 줄 수를 돌려줘요
async function aiRewrite(eng, res, rows, n, signal) {
  const f = SF[((n % SF.length) + SF.length) % SF.length];
  const lines = res.lines.slice();
  const idx = [], items = [];
  lines.forEach((l, i) => {
    const m = l.match(/\{([^|}]+)\|([^}]+)\}/);
    if (!m || !rows[m[1]]) return;
    const id = m[1], r = rows[id], w = stLex(id, r, f);
    const sense = String(r.ko).split(/\s*[,;/]\s*/)[0].replace(/\([^)]*\)/g, '').replace(/~\s*/g, '').trim() || w.m;
    // 앱 문장을 하는 인물을 그대로 (그림도 그 인물로 그려져 있어요)
    const plain = l.replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
    const who = [f.V, f.S && f.S.V].some(x => x && plain.includes(x)) ? f.V : [f.F, f.S && f.S.F].some(x => x && plain.includes(x)) ? f.F : f.H;
    idx.push(i); items.push({ id, w, ko: r.ko, mean: sense, who });
  });
  if (!items.length) return 0;
  const first = lines.findIndex(l => /\{[^|}]+\|/.test(l));
  const intro = lines.slice(0, Math.max(0, first)).join(' ').replace(/\{[^|}]+\|([^}]+)\}/g, '$1');
  const prompt = aiPrompt(f, intro, items);
  const stop = () => { try { eng.interruptGenerate(); } catch (e) { } };
  if (signal) { if (signal.aborted) throw { code: 'cancelled' }; signal.addEventListener('abort', stop, { once: true }); }
  let text = '';
  try {
    const reply = await eng.chat.completions.create({ messages: [{ role: 'user', content: prompt }], temperature: 0.7, top_p: 0.9, max_tokens: Math.min(1200, 90 * items.length + 60) });
    text = (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
  } finally { if (signal) signal.removeEventListener('abort', stop); }
  if (signal && signal.aborted) throw { code: 'cancelled' };
  const got = aiParse(text, items.length);
  let changed = 0;
  items.forEach((x, k) => {
    const t = got[k];
    if (!t || !aiLineOk(t)) return;
    const marked = aiMark(t, x.id, x.w, x.ko);
    if (!marked) return;
    lines[idx[k]] = /[.!?”"…]$/.test(marked) ? marked : marked + '.';
    const wd = res.words && res.words[x.id];
    if (wd) wd.pic = marked.replace(/\{[^|}]+\|([^}]+)\}/g, '$1').slice(0, 120);
    changed++;
  });
  res.lines = lines;
  return changed;
}
