/* ---------- 1) 사진 속 단어 읽기: 이 기기 안에서 글자 인식(Tesseract). 따로 연결할 API나 열쇠가 없어요
   ① 사진 다듬기(그림자·명암 고르게) ② 한국어+영어로 한 번, 영어 전용으로 한 번 읽기 → 영어 단어는 영어 전용 결과를 믿음
   ③ 글자 위치로 줄·칸을 다시 짜서 '영어 → 오른쪽이나 바로 아래 한글 뜻'으로 짝짓기 (두 단(칸) 쪽, 한 줄에 두 단어도)
   ④ 영어 사전(SCOWL 약 11만 단어)으로 잘못 읽은 글자 고치기 ---------- */
const OCR_MAX = 10;
const OCR = { worker: null, eng: null, loading: null, i: 0, n: 1, dict: null, low: new Set(), boxes: null };
const ocrURL = p => new URL(p, location.href).href;
function ocrShow(label, pct) {
  const bar = $('#ocrbar'), lab = $('#ocrlab');
  if (bar) bar.style.width = Math.round(clamp(pct, 0, 1) * 100) + '%';
  if (lab && label) lab.textContent = label;
}
function ocrLog(m) {
  if (!m || MK.step !== 'reading') return;
  const p = typeof m.progress === 'number' ? m.progress : 0, st = String(m.status || '');
  if (/core/.test(st)) ocrShow('글자 읽는 도구 준비 중', 0.05 + p * 0.1);
  else if (/recogniz/.test(st)) ocrShow(`사진 ${OCR.i + 1}/${OCR.n} 읽는 중`, 0.3 + 0.7 * (OCR.i + p * 0.5 + (OCR.pass ? 0.5 : 0)) / OCR.n);
}
// 글자 사전(압축 파일)은 앱 옆에 함께 올려 둔 파일이에요. 직접 받아서 글자 인식 도구에 넘겨요
const ocrLangData = {};
function ocrLang(code) {
  if (!ocrLangData[code]) ocrLangData[code] = fetch(ocrURL(`ocr/${code}-traineddata.wasm`)).then(r => { if (!r.ok) throw { code: 'ocr_load' }; return r.arrayBuffer(); }).catch(e => { delete ocrLangData[code]; throw e; });
  return ocrLangData[code].then(b => ({ code, data: new Uint8Array(b.slice(0)) }));
}
const ocrOpts = () => ({ workerPath: ocrURL('ocr/worker.min.js'), corePath: ocrURL('ocr/tesseract-core-lstm.wasm.js'), cacheMethod: 'none', workerBlobURL: true, logger: ocrLog, errorHandler: () => { } });
// 영어 사전: 단어 → 1(흔한 말) / 2(드문 말)
function ocrDict() {
  if (!OCR.dict) OCR.dict = fetch(ocrURL('ocr/words-en.txt')).then(r => r.ok ? r.text() : '').then(t => {
    const m = new Map(); for (const l of t.split('\n')) if (l) m.set(l.replace('*', ''), l.endsWith('*') ? 2 : 1); return m;
  }).catch(() => new Map());
  return OCR.dict;
}
function ocrWorker() {
  if (OCR.worker) return Promise.resolve(OCR.worker);
  if (!OCR.loading) OCR.loading = (async () => {
    if (!window.Tesseract) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'ocr/tesseract.min.js'; s.onload = ok; s.onerror = () => no({ code: 'ocr_load' }); document.head.appendChild(s); });
    ocrShow('한국어·영어 글자 사전 불러오는 중', 0.08);
    ocrDict(); koLex();
    const [kor, eng2] = await Promise.all([ocrLang('kor'), ocrLang('eng')]);
    const [w, we] = await Promise.all([Tesseract.createWorker([kor], 1, ocrOpts()), Tesseract.createWorker([eng2], 1, ocrOpts())]);
    // 영어 전용 읽기는 11 = 흩어진 글자 찾기: 표·두 단 쪽에서도 영어 낱말을 빠짐없이 찾고, 줄·칸은 위치로 앱이 다시 짬
    await w.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '4' }); // 4 = 세로로 이어진 글줄: 한글 뜻을 문맥으로 더 정확히
    await we.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '11', tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'-~.,()/ " });
    OCR.worker = w; OCR.eng = we; return w;
  })().catch(e => { OCR.loading = null; throw (e && e.code ? e : { code: 'ocr_load' }); });
  return OCR.loading;
}
function ocrStop() {
  MK.run = null;
  const ws = [OCR.worker, OCR.eng]; OCR.worker = null; OCR.eng = null; OCR.loading = null;
  for (const w of ws) if (w) try { w.terminate(); } catch (e) { }
}
// 사진 → 글자 읽기 좋은 흑백 그림 (그림자 지운 뒤 명암을 넓힘. 너무 크면 줄이고 작은 화면 캡처는 키움)
async function ocrImage(file) {
  let src = null, url = '';
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { src = null; }
  if (!src) src = await new Promise((ok, no) => { const im = new Image(); url = URL.createObjectURL(file); im.onload = () => ok(im); im.onerror = () => no({ code: 'image_rejected' }); im.src = url; });
  const w0 = src.naturalWidth || src.width, h0 = src.naturalHeight || src.height, big = Math.max(w0, h0);
  const k = Math.min(1.3, 2600 / big); // 작은 글자는 조금 키우고(너무 키우면 흐려짐) 너무 큰 사진은 긴 쪽 2600px로 줄임
  const W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H); g.drawImage(src, 0, 0, W, H);
  if (src.close) src.close();
  if (url) URL.revokeObjectURL(url);
  // 어두운 바탕에 밝은 글씨(다크 모드 앱 화면, 검은 슬라이드): 밝기를 뒤집어 흰 바탕 검은 글씨로 만든 뒤 다듬어요.
  // 그대로 두면 아래 배경 고르기가 검은 바탕을 회색으로, 글씨 둘레를 검게 번지게 만들어서 한글 뜻을 거의 못 읽어요
  const dark = ocrDarkBg(c);
  if (dark) { const id = g.getImageData(0, 0, W, H), d = id.data; for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } g.putImageData(id, 0, 0); }
  try {
    // 배경 밝기: 아주 작게 줄였다 키운 그림 (글자는 사라지고 그림자·조명만 남음)
    const s = document.createElement('canvas'), sw = Math.max(8, Math.round(W / 24)), sh = Math.max(8, Math.round(H / 24));
    s.width = sw; s.height = sh; const sg = s.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(c, 0, 0, sw, sh);
    // 글자 획을 지우려고 작은 그림에서 밝은 쪽을 남김(최댓값 3×3)
    const sd = sg.getImageData(0, 0, sw, sh), sp = sd.data, lum = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) lum[i] = 0.3 * sp[i * 4] + 0.59 * sp[i * 4 + 1] + 0.11 * sp[i * 4 + 2];
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let mx = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < sh && xx >= 0 && xx < sw) mx = Math.max(mx, lum[yy * sw + xx]); }
      const i = (y * sw + x) * 4; sp[i] = sp[i + 1] = sp[i + 2] = mx;
    }
    sg.putImageData(sd, 0, 0);
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H; const bgg = bg.getContext('2d', { willReadFrequently: true });
    bgg.imageSmoothingQuality = 'high'; bgg.drawImage(s, 0, 0, W, H);
    const id = g.getImageData(0, 0, W, H), d = id.data, b = bgg.getImageData(0, 0, W, H).data;
    const out = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2], bv = Math.max(40, b[i]);
      out[j] = Math.min(255, v / bv * 255);
    }
    // 밝은 쪽 끝(종이)만 하얗게 맞춤. 어두운 쪽은 늘리지 않음(굵은 글자가 뭉개지지 않게)
    const lo = 0, hi = 245, span = hi - lo, lut = gam => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) t[v] = 255 * Math.pow(clamp((v - lo) / span, 0, 1), gam); return t; };
    const put = (cv, cg, t) => { const im = cg.createImageData(W, H), q = im.data; for (let i = 0, j = 0; i < q.length; i += 4, j++) { q[i] = q[i + 1] = q[i + 2] = t[out[j]]; q[i + 3] = 255; } cg.putImageData(im, 0, 0); };
    put(c, g, lut(1));
    // 뒤집은 다크 모드 화면은 뜻 글씨가 옅은 회색이라, 한국어로 읽을 그림은 가운데 밝기를 진하게 해서 흑백을 나눌 때 획이 끊기지 않게.
    // 굵은 영어는 진하게 하면 오히려 뭉개져서 영어는 원래 밝기 그림(c.plain)으로 읽어요
    if (dark) {
      const p = document.createElement('canvas'); p.width = W; p.height = H; p.getContext('2d').drawImage(c, 0, 0);
      put(c, g, lut(1.8)); c.plain = p;
    }
  } catch (e) { /* 다듬기가 안 되면 원래 사진으로 */ }
  return c;
}
// 바탕이 어두운 사진인지: 작게 줄인 그림의 밝기 가운데값이 어두우면 (글씨는 바탕보다 적으니 가운데값은 바탕 밝기)
function ocrDarkBg(c) {
  try {
    const s = document.createElement('canvas'), w = 48, h = Math.max(8, Math.round(48 * c.height / c.width));
    s.width = w; s.height = h; const g = s.getContext('2d'); g.drawImage(c, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data, lum = [];
    for (let i = 0; i < d.length; i += 4) lum.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
    lum.sort((a, b) => a - b);
    return lum[lum.length >> 1] < 100;
  } catch (e) { return false; }
}
// 사진 기울기: Tesseract가 찾은 긴 줄들의 밑줄 기울기 가운데값
function ocrSlope(...datas) {
  const sl = [];
  for (const data of datas) for (const b of (data && data.blocks) || []) for (const pa of b.paragraphs || []) for (const ln of pa.lines || []) {
    const bl = ln.baseline; if (!bl) continue;
    const dx = bl.x1 - bl.x0; if (dx > 150) sl.push((bl.y1 - bl.y0) / dx);
  }
  sl.sort((a, b) => a - b);
  return sl.length ? clamp(sl[sl.length >> 1], -0.2, 0.2) : 0;
}
// Tesseract 결과 → 낱말 [{t, x0, y0, x1, y1, c}]
function ocrWords(data) {
  const out = [];
  for (const b of (data && data.blocks) || []) for (const pa of b.paragraphs || []) for (const ln of pa.lines || []) for (const w of ln.words || []) {
    const t = String(w.text || '').trim(); if (!t || !w.bbox) continue;
    out.push({ t, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, c: +w.confidence || 0 });
  }
  return out;
}
const OCR_POS = /^[([]?(?:n|v|a|adj|adv|ad|prep|conj|vt|vi|pron|int|명|동|형|부)[.)\]]?$/i;
const isLat = t => /[A-Za-z]{2,}/.test(t) && !HANGUL.test(t);
// 영어 단어 고치기: 사전에 없으면 자주 헷갈리는 글자(l/I/1, rn/m, 0/o…)나 한 글자 차이로 사전에 있는 말을 찾음
function ocrFix(word, dict) {
  if (!dict || !dict.size) return word;
  const lw = word.toLowerCase().replace(/[^a-z0-9|'’\-]/g, '');
  if (!lw || lw.length < 3 || dict.has(lw)) return lw.length ? (dict.has(lw) ? lw : word) : word;
  const best = list => { let b = null; for (const x of list) { const t = dict.get(x); if (t && (!b || t < b[1])) b = [x, t]; } return b && b[0]; };
  const CONF = [['1', 'l'], ['1', 'i'], ['|', 'l'], ['|', 'i'], ['0', 'o'], ['5', 's'], ['8', 'b'], ['rn', 'm'], ['m', 'rn'], ['vv', 'w'], ['cl', 'd'], ['ii', 'u'], ['li', 'h'], ['l', 'i'], ['i', 'l'], ['c', 'e'], ['e', 'c'], ['n', 'u'], ['u', 'n'], ['h', 'b'], ['t', 'f'], ['f', 't'], ['a', 'o'], ['o', 'a']];
  const c1 = [];
  for (const [a, b] of CONF) { let i = lw.indexOf(a); while (i >= 0) { c1.push(lw.slice(0, i) + b + lw.slice(i + a.length)); i = lw.indexOf(a, i + 1); } }
  let hit = best(c1.map(x => x.replace(/[^a-z'\-]/g, '')));
  if (hit) return hit;
  const sp = ocrSplit(lw, dict); if (sp) return sp;
  hit = best([lw.slice(1), lw.slice(0, -1)].map(x => x.replace(/[^a-z'\-]/g, ''))); // 앞뒤에 붙은 번호·점 같은 글자
  if (hit) return hit;
  if (lw.length >= 5 && /^[a-z]+$/.test(lw)) {
    const AB = 'abcdefghijklmnopqrstuvwxyz', c2 = [];
    for (let i = 0; i < lw.length; i++) { c2.push(lw.slice(0, i) + lw.slice(i + 1)); for (const ch of AB) { c2.push(lw.slice(0, i) + ch + lw.slice(i + 1)); c2.push(lw.slice(0, i) + ch + lw.slice(i)); } }
    for (const ch of AB) c2.push(lw + ch); // 끝 글자를 못 읽은 것('harves')
    hit = best(c2); if (hit) return hit;
  }
  for (const x of c1) { const sp2 = ocrSplit(x, dict); if (sp2) return sp2; } // 'tumaway' → 'turnaway' → 'turn away'
  return word;
}
// 띄어쓰기를 못 읽어 붙은 영어 낱말 나누기 ('takeabreak' → 'take a break', 'turnaway' → 'turn away').
// 흔한 사전 낱말 둘로(또는 사이에 'a'를 두고) 나뉠 때만. 'a'가 낀 숙어('take a break', 'at a time')가 많아서 그쪽을 조금 더 쳐줘요
function ocrSplit(x, dict) {
  if (x.length < 3 || !/^[a-z]+$/.test(x) || !dict) return '';
  const lv = w => dict.get(w) || 9;
  let best = '', bs = 2.51;
  for (let i = 2; i <= x.length - 1; i++) {
    const a = x.slice(0, i), b = x.slice(i);
    if (!dict.has(a) || (b.length < 2 && b !== 'a')) continue;
    if (dict.has(b) && (x.length >= 5 || b === 'a')) { const v = lv(a) + lv(b) + (Math.min(a.length, b.length) < 3 ? 0.5 : 0); if (v < bs) { bs = v; best = a + ' ' + b; } } // 짧은 말은 'at a'처럼 'a'가 붙은 것만
    if (b[0] === 'a' && b.length >= 3 && dict.has(b.slice(1))) { const v = lv(a) + lv(b.slice(1)) - 0.25; if (v < bs) { bs = v; best = a + ' a ' + b.slice(1); } }
  }
  return best;
}
// 두 번 읽은 결과 합치기: 영어 전용으로 또렷하게 읽은 영어 낱말이 있으면 그 자리의 낱말을 바꿈
function ocrMerge(A, E, dict) {
  const ov = (a, b) => { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0)) : 0; };
  const out = A.slice();
  const known = lw => !!(dict && (dict.has(lw) || (lw.includes('-') && lw.split('-').every(p => p && dict.has(p))) || /\s/.test(ocrSplit(lw, dict))));
  // 또렷한 사전 낱말의 글자 높이 가운데값: 이보다 아주 낮은 영어는 한글 획 아랫부분만 읽은 조각 ('LS', 'A')
  const eh = E.filter(e => e.c >= 85 && /^[A-Za-z]{3,}$/.test(e.t) && dict && dict.has(e.t.toLowerCase())).map(e => e.y1 - e.y0).sort((a, b) => a - b), hm = eh.length >= 3 ? eh[eh.length >> 1] : 0;
  for (const e of E) {
    const lw = e.t.toLowerCase().replace(/[^a-z'\-]/g, '');
    // 흐리게(55 미만) 읽힌 영어도 네 글자 이상 사전 낱말이면 살림 ('10 invite'처럼 번호에 바짝 붙은 단어가 신뢰도 20~40으로 나와 통째로 빠졌어요).
    // 대신 확인 화면에서 빨간 칸(흐리게 읽힘)으로 보여 줌
    const weak = e.c < 55, inD = known(lw);
    if (hm && e.y1 - e.y0 < hm * 0.55) continue;
    // 한 글자는 또렷한 'a'만 ('take a break'), 사전에 없는 말은 세 글자 이상 또렷할 때만 (한글 획을 영어로 읽은 'OHA'·'LS' 같은 잡티가 단어 자리를 차지했어요)
    if (!/^[A-Za-z][A-Za-z'’\-]*[.,]?$/.test(e.t) || (e.t.length < 2 && !(/^[aA]$/.test(e.t) && e.c >= 80)) || (weak && !(e.c >= 15 && lw.length >= 4 && inD)) || (!inD && (e.c < 70 || lw.length < 3))) continue;
    const hits = out.filter(a => ov(a, e) > 0.45);
    // 한글 자리는 그대로. 단, 사전에 있는 영어 낱말을 또렷하게 읽었으면 영어로 (한국어 전용 읽기는 영어를 한글처럼 읽기도 해서:
    // 'of'를 '아'로, 'up'을 '니'로). 한 글자 한글은 더 또렷한 쪽이어도 영어에 자리를 내줌
    const hang = hits.filter(a => HANGUL.test(a.t)), one = hang.every(a => a.t.replace(/[^가-힣]/g, '').length <= 1);
    // 짧은 낱말(of·up·a)은 같은 줄 바로 옆에 또렷한 영어 낱말이 있을 때만 (한글 뜻 속 '~의'의 '의'를 'of'로 읽은 것이 뜻 자리를 차지하지 않게)
    const eh2 = e.y1 - e.y0, ctx = lw.length >= 4 || E.some(o => o !== e && (o.c >= 80 || (o.c >= 60 && o.t.length >= 5)) && /^[A-Za-z]{2,}$/.test(o.t) && dict && dict.has(o.t.toLowerCase())
      && Math.abs((o.y0 + o.y1) / 2 - (e.y0 + e.y1) / 2) < eh2 * 0.6 && (Math.abs(o.x0 - e.x1) < eh2 * 1.5 || Math.abs(e.x0 - o.x1) < eh2 * 1.5));
    const good = inD && ((e.c >= 75 && lw.length >= 3 && (ctx || e.c >= 90)) || (e.c >= 60 && lw.length >= 5) || ((e.c >= 85 || (one && e.c >= 50 && lw.length >= 2)) && ctx));
    if (hang.some(a => !good || (a.c >= e.c && a.t.replace(/[^가-힣]/g, '').length >= 2))) continue;
    for (const a of hits) out.splice(out.indexOf(a), 1);
    out.push(e);
    if (weak) OCR.low.add(lw);
  }
  return out;
}
// 낱말 → 줄 → (넓은 틈으로 나눈) 덩어리 → '영어 - 뜻' 줄들
function ocrPairs(words, dict, slope = 0) {
  // 기운 사진: 낱말 위치를 반듯하게 (세로 위치에서 기울기만큼 빼기)
  if (slope) words = words.map(w => { const d = slope * (w.x0 + w.x1) / 2; return Object.assign({}, w, { y0: w.y0 - d, y1: w.y1 - d, _o: w }); });
  // '설명하다'가 '설 / 명 / 하다'로 쪼개 읽히면 가운데 '명'은 품사 표시가 아니라 낱말의 한 글자: 바로 왼쪽에 붙은 한글이 있으면 남김
  const hs0 = words.map(w => w.y1 - w.y0).sort((a, b) => a - b), h0 = hs0[hs0.length >> 1] || 20;
  // (왼쪽 글자 상자가 낱말 전체 폭으로 잡혀 겹치기도 해요: '증' 상자가 '증명하다'를 덮음)
  const glued = w => /^[명동형부]$/.test(w.t) && words.some(o => o !== w && HANGUL.test(o.t) && Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h0 * 0.5 && o.x0 < w.x0 && w.x0 - o.x1 < h0 * 0.6);
  // 품사 표시 'a'와 관사 'a'('take a break', 'a lot of') 구별: 바로 오른쪽에 영어 낱말이 이어지면 관사
  // 줄 끝의 'a'도 바로 뒤에 뜻이 붙어 있지 않고 다음 줄에 영어가 이어지면 관사 ('take a / break')
  const line0 = (o, w) => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h0 * 0.5, en2 = o => /^[A-Za-z]{2,}/.test(o.t);
  const article = w => /^[aA]$/.test(w.t) && (words.some(o => o !== w && en2(o) && line0(o, w) && o.x0 > w.x1 - 3 && o.x0 - w.x1 < h0)
    || (words.some(o => en2(o) && line0(o, w) && o.x1 < w.x0 + 3 && w.x0 - o.x1 < h0) && !words.some(o => HANGUL.test(o.t) && line0(o, w) && o.x0 > w.x1 && o.x0 - w.x1 < h0 * 2)
      && words.some(o => en2(o) && o.y0 > w.y1 && o.y0 - w.y1 < h0 * 1.5)));
  // 영어 단어 위에 겹치거나 영어 사이·바로 옆에 홀로 낀 한두 글자 한글은 영어 획을 한글로 읽은 잡티 ('give 아 up', 'explain' 위의 '빠 내')
  const lat = w => /^[A-Za-z]{2,}/.test(w.t) && !HANGUL.test(w.t);
  const sameRow = (o, w) => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < Math.max(h0 * 0.6, (w.y1 - w.y0) * 0.5);
  const speck = w => /^[가-힣]{1,2}[,.)]?$/.test(w.t) && (words.some(o => lat(o) && sameRow(o, w) && o.x0 < w.x0 && o.x1 > (w.x0 + w.x1) / 2)
    || (/^[가-힣][,.)]?$/.test(w.t) && words.some(o => lat(o) && sameRow(o, w) && o.x1 > w.x0 - h0 * 0.4 && o.x0 < w.x0)
      && !words.some(o => o !== w && HANGUL.test(o.t) && sameRow(o, w) && o.x0 > w.x0 && o.x0 - w.x1 < h0 * 1.2)));
  words = words.filter(w => (!OCR_POS.test(w.t) || glued(w) || article(w)) && !speck(w) && !/^[\d.)(\-–—•·:]+$/.test(w.t) && !(w.c < 25 && !HANGUL.test(w.t) && !(w.c >= 15 && w.t.length >= 4 && dict && dict.has(w.t.toLowerCase().replace(/[^a-z'\-]/g, ''))))
    && !(/^[A-Za-z.]{1,2}$/.test(w.t) && w.c < 60));
  if (!words.length) return [];
  const hs = words.map(w => w.y1 - w.y0).sort((a, b) => a - b), h = hs[hs.length >> 1] || 20;
  // 줄 만들기: 왼쪽부터, 바로 왼쪽 낱말과 높이가 이어지는 줄에 붙임 (사진이 조금 기울어도 됨)
  const lines = [];
  for (const w of words.slice().sort((a, b) => a.x0 - b.x0)) {
    const yc = (w.y0 + w.y1) / 2;
    let best = null, bd = 1e9;
    for (const L of lines) { const last = L.w[L.w.length - 1], d = Math.abs(yc - (last.y0 + last.y1) / 2); if (d < h * 0.6 && w.x0 > last.x0 && w.x0 - last.x1 < h * 14 && d < bd) { bd = d; best = L; } }
    if (best) best.w.push(w); else lines.push({ w: [w] });
  }
  // 덩어리: 낱말 사이가 글자 높이의 1.6배보다 넓으면 끊음
  const segs = [];
  for (const L of lines) {
    let cur = null;
    for (const w of L.w) {
      if (cur && w.x0 - cur.x1 > h * 1.6) cur = null;
      if (!cur) { cur = { w: [], x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 }; segs.push(cur); }
      cur.w.push(w); cur.x1 = Math.max(cur.x1, w.x1); cur.y0 = Math.min(cur.y0, w.y0); cur.y1 = Math.max(cur.y1, w.y1);
    }
  }
  for (const s of segs) {
    const ycs = s.w.map(w => (w.y0 + w.y1) / 2).sort((a, b) => a - b);
    s.yc = ycs[ycs.length >> 1]; // 키 큰 글자 상자 하나에 흔들리지 않게 가운데값
    s.t = s.w.map(w => w.t).join(' ').replace(/\s+([,.;])/g, '$1');
    // 혼자 떨어진 흐릿한 한 글자(품사 표시를 한글로 잘못 읽은 것 등)는 뜻으로 쓰지 않음
    if (s.w.length === 1 && /^[가-힣]$/.test(s.t) && s.w[0].c < 45) { s.kind = 'x'; continue; }
    s.kind = HANGUL.test(s.t) ? (/[A-Za-z]{2,}/.test(s.t) ? 'mix' : 'ko') : isLat(s.t) && s.t.replace(/[^A-Za-z]/g, '').length >= 3 ? 'en' : 'x';
  }
  segs.sort((a, b) => a.yc - b.yc || a.x0 - b.x0);
  const koRight = (s, tol) => segs.some(o => o.kind === 'ko' && Math.abs(o.yc - s.yc) < h * tol && o.x0 > s.x1);
  const SHORT = new Set(['a', 'an', 'to', 'of', 'in', 'on', 'up', 'by', 'at', 'as', 'be', 'do', 'go', 'it', 'so', 'no', 'or', 'if', 'off', 'out', 'for', 'with', 'one', 'sb', 'sth']);
  // 두 줄로 나뉘어 찍힌 영어 단어·숙어('look forward / to'): 바로 아랫줄이 같은 왼쪽 끝에서 시작하는 영어이고 그 줄 오른쪽에 뜻이 없으면,
  // 그리고 윗줄 오른쪽에는 뜻이 있으면 한 단어로 이어 붙임
  for (const s of segs) {
    if (s.kind !== 'en' || !koRight(s, 0.85)) continue;
    for (let nx; (nx = segs.find(o => o !== s && (o.kind === 'en' || (o.kind === 'x' && SHORT.has(o.t.toLowerCase()))) && Math.abs(o.x0 - s.x0) < h * 0.8 && o.yc > s.yc + h * 0.6 && o.y0 - s.y1 < h * 1.2)) && !koRight(nx, 0.6);) {
      s.t += ' ' + nx.t; s.w.push(...nx.w); s.x1 = Math.max(s.x1, nx.x1); s.y1 = Math.max(s.y1, nx.y1); nx.kind = 'joined';
    }
  }
  const used = new Set(), out = [];
  const fixEn = t => {
    const ws = t.split(/\s+/).map(x => /[A-Za-z]/.test(x) ? ocrFix(x, dict) : '').filter(Boolean);
    while (ws.length > 1 && ws[0].length <= 2 && !SHORT.has(ws[0].toLowerCase())) ws.shift();
    while (ws.length > 1 && ws[ws.length - 1].length <= 2 && !SHORT.has(ws[ws.length - 1].toLowerCase())) ws.pop();
    return ws.join(' ');
  };
  // 같은 줄 오른쪽 뜻 → 없으면 바로 아래 뜻 (영어 단어와 왼쪽 끝이 비슷한 곳)
  // 품사 표시(v. n.)를 한글 한 글자로 잘못 읽은 덩어리는 더 긴 뜻 덩어리가 있으면 건너뜀
  const right = s => {
    let r = segs.filter(o => o !== s && !used.has(o) && o.kind === 'ko' && Math.abs(o.yc - s.yc) < h * 0.85 && o.x0 > s.x1 - h * 0.3).sort((a, b) => a.x0 - b.x0);
    // 같은 줄 오른쪽 칸의 다른 영어 단어부터는 그 단어의 뜻 ('river 강 … mirror 거울'에서 river가 '거울'을 넘보다 '강'까지 잃지 않게)
    const nx = segs.filter(q => q !== s && q.kind === 'en' && Math.abs(q.yc - s.yc) < h * 0.7 && q.x0 > s.x1).sort((a, b) => a.x0 - b.x0)[0];
    if (nx) r = r.filter(o => o.x0 < nx.x0);
    return r.length > 1 && r[0].t.replace(/[^가-힣]/g, '').length <= 1 ? r[1] : r[0]; };
  const nextEnRight = (s, o) => segs.some(q => q !== s && q.kind === 'en' && Math.abs(q.yc - s.yc) < h * 0.7 && q.x0 > s.x1 && q.x0 < o.x0);
  const below = s => segs.filter(o => !used.has(o) && o.kind === 'ko' && o.yc > s.yc + h * 0.5 && o.yc < s.yc + h * 2.6 && o.x0 > s.x0 - h * 2.5 && o.x0 < s.x0 + Math.max(h * 3, (s.x1 - s.x0) * 0.6)).sort((a, b) => a.yc - b.yc)[0];
  for (const s of segs) {
    if (used.has(s)) continue;
    if (s.kind === 'mix') {
      // 한 덩어리에 '영어 뜻 영어 뜻'이 이어지면 한글 뒤에 영어가 시작되는 곳에서 나눔
      used.add(s);
      const parts = []; let cur = [];
      for (const w of s.w) { if (cur.length && /[A-Za-z]{2,}/.test(w.t) && !HANGUL.test(w.t) && cur.some(x => HANGUL.test(x.t))) { parts.push(cur); cur = []; } cur.push(w); }
      if (cur.length) parts.push(cur);
      for (const p of parts) {
        const k = p.findIndex(x => HANGUL.test(x.t)); if (k <= 0) continue;
        const en = fixEn(p.slice(0, k).map(x => x.t).join(' ')), ko = p.slice(k).map(x => x.t).join(' ').replace(/\s+([,.;])/g, '$1');
        if (en) out.push({ t: en + ' - ' + ko, x: p[0].x0, y: (p[0].y0 + p[0].y1) / 2, b: ocrBox(p) });
      }
      continue;
    }
    if (s.kind !== 'en') continue;
    let m = right(s);
    if (m && nextEnRight(s, m)) m = null;
    if (!m) m = below(s);
    if (!m) continue;
    used.add(s); used.add(m);
    // 뜻이 두 줄로 넘어가면('기다리다, 버티다, (전화를) / 끊지 않다') 바로 아랫줄 같은 칸의 한글도 (그 줄 왼쪽에 다른 영어 단어가 없을 때)
    let mt = m.t, mw = [...m.w];
    for (let c = m, nx; (nx = segs.find(o => o.kind === 'ko' && !used.has(o) && Math.abs(o.x0 - c.x0) < h * 1.2 && o.yc > c.yc + h * 0.6 && o.y0 - c.y1 < h * 1.2)) && !segs.some(q => q.kind === 'en' && Math.abs(q.yc - nx.yc) < h * 0.7 && q.x1 <= nx.x0);) {
      used.add(nx); mt += ' ' + nx.t; mw.push(...nx.w); c = nx;
    }
    const en = fixEn(s.t);
    if (en) out.push({ t: en + ' - ' + mt, x: s.x0, y: s.yc, b: ocrBox([...s.w, ...mw]) });
  }
  // 읽는 순서: 왼쪽 단(칸)을 위에서 아래로 다 읽고 오른쪽 단으로
  const pw = Math.max(...words.map(w => w.x1)) || 1, xs = out.map(o => o.x).sort((a, b) => a - b), cuts = [];
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > pw * 0.18) cuts.push((xs[i] + xs[i - 1]) / 2);
  const col = x => cuts.filter(c => x > c).length;
  if (OCR.boxes) for (const o of out) ocrKeepBox(o.t, o.b);
  return out.sort((a, b) => col(a.x) - col(b.x) || a.y - b.y).map(o => o.t);
}
// 확인 화면에 보여 줄 '사진 속 원래 줄' 위치: 낱말 상자들을 감싸는 상자 (기울기를 펴기 전의 원래 위치로)
function ocrBox(ws) {
  const o = ws.map(w => w._o || w);
  return { x0: Math.min(...o.map(w => w.x0)), y0: Math.min(...o.map(w => w.y0)), x1: Math.max(...o.map(w => w.x1)), y1: Math.max(...o.map(w => w.y1)) };
}
function ocrKeepBox(line, b) {
  const en = String(line).split(' - ')[0].trim().toLowerCase();
  if (en && b && isFinite(b.x0) && !OCR.boxes.has(en)) OCR.boxes.set(en, b);
}
// 사진에서 그 줄만 작게 잘라 낸 그림 (화면에만 보여 주고 단어장에는 저장하지 않아요)
function ocrSnip(c, b) {
  try {
    const pad = Math.max(6, (b.y1 - b.y0) * 0.35);
    const x = Math.max(0, b.x0 - pad), y = Math.max(0, b.y0 - pad);
    const w = Math.min(c.width - x, b.x1 - b.x0 + pad * 2), h = Math.min(c.height - y, b.y1 - b.y0 + pad * 2);
    if (w < 8 || h < 8) return '';
    const k = Math.min(1, 96 / h, 900 / w), o = document.createElement('canvas');
    o.width = Math.max(1, Math.round(w * k)); o.height = Math.max(1, Math.round(h * k));
    o.getContext('2d').drawImage(c, x, y, w, h, 0, 0, o.width, o.height);
    return o.toDataURL('image/jpeg', 0.72);
  } catch (e) { return ''; }
}
// 읽은 글자 다듬기: 낱글자로 벌어진 한글 붙이기, 번호 지우기, 영어 줄 아래 뜻 줄 합치기
function ocrTidy(text) {
  let lines = String(text || '').split(/\n/).map(l => l.replace(/[|｜¦]/g, ' ').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim()).filter(l => l.length > 1);
  lines = lines.map(l => {
    const t = l.split(' '), out = [];
    for (let i = 0; i < t.length; i++) {
      if (/^[가-힣][,.;]?$/.test(t[i])) {
        let j = i, s = '';
        while (j < t.length && /^[가-힣][,.;]?$/.test(t[j])) { s += t[j++]; if (/[,.;]$/.test(s)) break; }
        if (j - i >= 2) { if (!/[,.;]$/.test(s) && j < t.length && /^[가-힣]/.test(t[j])) s += t[j++]; out.push(s); i = j - 1; continue; }
      }
      out.push(t[i]);
    }
    return out.join(' ');
  });
  const numbered = lines.filter(l => /^\(?\d{1,3}(?:[.)\s]|[A-Za-z])/.test(l)).length;
  const listy = numbered >= Math.max(2, lines.length * 0.3);
  lines = lines.map(l => {
    let m = l.replace(/^\(?\d{1,3}[.)]?\s*(?=[A-Za-z])/, '');
    if (listy && m === l) m = l.replace(/^[lI|S5]\s?(?=[a-z]{3})/, '');
    return m;
  });
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], nx = lines[i + 1];
    if (nx && LATIN.test(l) && !HANGUL.test(l) && l.split(' ').length <= 4 && HANGUL.test(nx) && !LATIN.test(nx)) { out.push(l + ' - ' + nx); i++; }
    else out.push(l);
  }
  return out.join('\n');
}
// 예문·설명처럼 단어 줄이 아닌 것은 빼요
const ocrRowOk = r => { const en = r.en.replace(/[^A-Za-z\s'~\-]/g, ' ').replace(/\s+/g, ' ').trim(); r.en = en; return en.length >= 2 && en.split(' ').length <= 4 && HANGUL.test(r.ko) && r.ko.length <= 40; };
// 뜻에 섞여 들어온 영어 낱자·기호 정리
const ocrKo = s => s.replace(/(^|\s)[A-Za-z|\\/_=+*#&%$@^]{1,2}(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- 읽은 단어 점검: 영어 사전·한국어 낱말 목록(hunspell-ko + kengdic, 약 17만 개)으로 진짜 낱말인지 봐요 ---------- */
const KO_END = ['하다', '하게', '하는', '하고', '한', '해서', '했다', '함', '하기', '되다', '되는', '된', '시키다', '받다', '이다', '적인', '적으로', '적', '스러운', '스럽게', '스럽다', '로운', '롭게', '롭다', '으로', '로', '에게', '에서', '는', '은', '을', '를', '에', '와', '과', '의', '이', '가', '도', '게', '히', '기', '음', '다', '고'];
let KOLEX = null;
function koLex() {
  if (!KOLEX) KOLEX = fetch(ocrURL('ocr/ko-lex.txt')).then(r => r.ok ? r.text() : '').then(t => new Set(t.split('\n').filter(Boolean))).catch(() => new Set());
  return KOLEX;
}
function koWordOk(w, L) {
  const c = w.charCodeAt(w.length - 1) - 0xAC00;
  const cands = [w];
  for (const e of KO_END) if (w.length > e.length && w.endsWith(e)) cands.push(w.slice(0, -e.length));
  if (c >= 0 && c < 11172 && (c % 28 === 4 || c % 28 === 8)) cands.push(w.slice(0, -1) + String.fromCharCode(0xAC00 + c - c % 28)); // 받침 ㄴ·ㄹ 관형형 → 어간
  return cands.some(s => (s.length >= 2 && L.has(s)) || L.has(s + '다') || L.has(s + '하다'));
}
// 낱말 목록에 그대로 있거나 '어간 + 하다·시키다…' 꼴로 확실한 낱말인지 ('습이'처럼 조사를 떼어야만 통과하는 잡티와 구별)
const KO_VEND = ['하다', '시키다', '되다', '받다', '이다', '스럽다', '롭다', '하는', '하게', '한', '적인', '적으로', '스러운', '로운']; // '이다': '필수적이다'처럼 명사 + 이다
function koExact(t, L) {
  t = String(t).replace(/\(.*$/, '').replace(/[^가-힣]/g, '');
  if (t.length < 2) return false;
  if (L.has(t)) return true;
  // 낱말 목록에는 '머리를'처럼 조사가 붙은 꼴도 있어서, 을·를로 끝난 앞말에 '하다'를 붙인 것은 낱말로 치지 않음
  return KO_VEND.some(e => t.endsWith(e) && t.length - e.length >= 2 && L.has(t.slice(0, -e.length)) && !/[을를]$/.test(t.slice(0, -e.length)));
}
// 뜻 한 덩어리 → 'ok' | 'one'(한 글자뿐: 확인 필요) | 'bad'(낱말이 아님)
function koChunk(chunk, L) {
  // '~을'·'~에' 같은 자리 표시는 낱말 수에서 빼요 ('~을 기대하다')
  const core = chunk.replace(/\([^)]*\)/g, ' ').replace(/(^|\s)~[가-힣]{0,3}(?=\s|$)/g, ' ').replace(/[^가-힣\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!core) return 'bad';
  const ws = core.split(' ');
  if (ws.length === 1 && ws[0].length === 1) return L.has(ws[0]) ? 'one' : 'bad';
  const good = ws.filter(w => koWordOk(w, L)).length;
  return good >= Math.max(1, ws.length * 0.6) ? 'ok' : 'bad';
}
// 짝지은 줄 점검: 엉터리 뜻 덩어리는 빼고, 의심스러운 줄에는 표시(flag)를 붙임. 쓸 수 없는 줄은 null
function ocrCheckRow(r, dict, L) {
  const enWords = r.en.toLowerCase().split(/\s+/).filter(Boolean);
  const enOk = enWords.length && enWords.every(w => dict.has(w) || (w.includes('-') && w.split('-').every(p => p && dict.has(p))) || (w.length <= 3 && ['a', 'an', 'to', 'of', 'in', 'on', 'up', 'by', 'at', 'for', 'off', 'out', 'sb', 'sth'].includes(w)));
  if (r.en.replace(/[^A-Za-z]/g, '').length < 3) return null; // 'jo', 'or' 같은 조각
  // 괄호 짝 맞추기, 괄호 안 띄어쓰기 정리
  let ko = r.ko.replace(/^[)\]]+|[(\[]+$/g, '').replace(/\(([^)]*)$/, '$1').replace(/^([^(]*)\)/, '$1').replace(/\(\s*([^)]*?)\s*\)/g, (a, x) => '(' + x.split(/\s+/).reduce((acc, w) => acc.length && /^[가-힣]$/.test(acc[acc.length - 1].slice(-1) + w) && w.length === 1 && acc[acc.length - 1].length === 1 ? (acc[acc.length - 1] += w, acc) : (acc.push(w), acc), []).join(' ') + ')').trim();
  if (!L.size) return Object.assign(r, { ko, flag: enOk ? '' : 'en' });
  // 낱말이 아닌 낱말 고치기(붙어 읽힌 낱말, 비슷한 모양 글자), 쉼표를 못 읽어 붙은 뜻 나누기
  // 한 글자씩 떨어져 읽힌 낱말 ('마 시다' → '마시다'). '수'·'것' 같은 말은 띄어 쓰는 말이라 붙이지 않음 ('할 수 없는')
  const glue = ws => { for (let i = ws.length - 2; i >= 0; i--) if (/^[가-힣]$/.test(ws[i]) && !/^(수|것|줄|때|데|바|지|뿐|듯|척|체|만|등|중)$/.test(ws[i]) && /^[가-힣]+$/.test(ws[i + 1]) && L.has(ws[i] + ws[i + 1])) ws.splice(i, 2, ws[i] + ws[i + 1]); return ws; };
  ko = ko.replace(/~\s+(?=[가-힣])/g, '~').split(/\s*,\s*/).map(p => koListSplit(glue(p.split(' ')).map((w, k) => koFixWord(w, L, k === 0)[0]).join(' '), L).join(', ')).join(', ');
  let parts = ko.split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 1) parts = parts.filter(p => !/^[가-힣]$/.test(p) || parts.every(q => /^[가-힣]$/.test(q))); // 다른 뜻 옆에 홀로 붙은 한 글자는 아이콘·기호를 읽은 것
  const st = parts.map(p => koChunk(p, L));
  const keep = parts.filter((p, i) => st[i] !== 'bad');
  let flag = '';
  if (!keep.length) { if (!enOk) return null; flag = 'ko'; }
  else { ko = keep.join(', '); if (keep.length < parts.length) flag = 'drop'; else if (keep.length === 1 && st[parts.indexOf(keep[0])] === 'one') flag = 'one'; }
  if (!enOk) flag = flag || 'en';
  if (!flag && OCR.low.has(r.en.toLowerCase())) flag = 'low';
  return Object.assign(r, { ko, flag });
}
const OCR_FLAG = { ko: '사진에서 뜻을 제대로 읽지 못했어요. 뜻을 고쳐 주세요', drop: '흐린 뜻 일부를 뺐어요. 빠진 뜻이 있으면 더해 주세요', one: '한 글자 뜻이에요. 맞는지 확인해 주세요', en: '사전에 없는 영어예요. 철자를 확인해 주세요', low: '사진에서 흐리게 읽혔어요. 영어와 뜻을 꼭 확인해 주세요' };

/* ---------- 기운 사진 바로 세우기 + 사전식 쪽(큰 표제어 옆에 뜻) 읽기 ---------- */
// 기울기: 같은 줄에서 바로 오른쪽에 붙은 비슷한 크기의 낱말끼리 높이 차이 / 거리 (가운데값)
function ocrPairSlope(words) {
  const ws = words.filter(w => w.y1 - w.y0 >= 10 && w.t.length >= 2), sl = [];
  for (const w of ws) {
    const h = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2;
    let best = null, bd = 1e9;
    for (const o of ws) {
      if (o === w) continue;
      const oh = o.y1 - o.y0, gap = o.x0 - w.x1;
      if (gap < -2 || gap > h * 2.5 || oh < h * 0.7 || oh > h * 1.4) continue;
      const dy = Math.abs((o.y0 + o.y1) / 2 - cy); if (dy > h * 0.8) continue;
      if (gap < bd) { bd = gap; best = o; }
    }
    if (best) { const dx = (best.x0 + best.x1) / 2 - (w.x0 + w.x1) / 2; if (dx > h) sl.push(((best.y0 + best.y1) / 2 - cy) / dx); }
  }
  if (sl.length < 6) return 0;
  sl.sort((a, b) => a - b);
  return clamp(sl[sl.length >> 1], -0.2, 0.2);
}
// 영어 사전에 있는 네 글자 이상 낱말을 또렷하게(신뢰도 60 이상) 몇 개 읽었는지: 사진 방향 고르기에 씀
// (옆으로 누운 글줄은 'for'·'off'·'jot' 같은 세 글자 낱말로 잘못 읽히기 쉬워서 세 글자 낱말은 세지 않아요)
function ocrDictHits(data, dict) { return ocrWords(data).filter(w => /^[A-Za-z]{4,}[.,]?$/.test(w.t) && w.c >= 60 && dict.has(w.t.toLowerCase().replace(/[.,]$/, ''))).length; }
// 그림을 90° 단위로 돌림 (max: 긴 쪽 최대 크기, 방향 고르기용으로 작게)
function ocrTurn(c, deg, max) {
  const k = max ? Math.min(1, max / Math.max(c.width, c.height)) : 1, sw = deg % 180 !== 0;
  const W = Math.round(c.width * k), H = Math.round(c.height * k), o = document.createElement('canvas');
  o.width = sw ? H : W; o.height = sw ? W : H;
  const g = o.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, o.width, o.height);
  g.translate(o.width / 2, o.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(c, -W / 2, -H / 2, W, H);
  return o;
}
function ocrRotate(c, slope) {
  const a = -Math.atan(slope), W = c.width, H = c.height;
  const nw = Math.round(Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))), nh = Math.round(Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a)));
  const o = document.createElement('canvas'); o.width = nw; o.height = nh;
  const g = o.getContext('2d'); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, nw, nh);
  g.translate(nw / 2, nh / 2); g.rotate(a); g.drawImage(c, -W / 2, -H / 2);
  return o;
}
// 표제어: 다른 영어보다 크게(1.35배 이상) 쓰인, 쪽 왼쪽의 사전 낱말
function ocrHeadwords(words, dict, W) {
  // 굵은 표제어가 'harv' + 'est'나 'fenc' + 'e['처럼 조각으로 읽히면 붙여 봄 (붙인 말이 사전에 있을 때만. 안 그러면 앞 조각이 다른 짧은 낱말로 고쳐져 원래 단어를 잃어요)
  const glue = [];
  for (const a of words) for (const b of words) {
    if (a === b || !/^[A-Za-z]+$/.test(a.t)) continue;
    const bm = b.t.match(/^[A-Za-z]+/); if (!bm) continue;
    const ha = a.y1 - a.y0, gap = b.x0 - a.x1;
    if (gap < -3 || gap > ha * 0.35 || Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) > ha * 0.4) continue;
    for (let k = bm[0].length; k >= 1; k--) {
      const t = a.t + bm[0].slice(0, k);
      if (!dict.has(t.toLowerCase())) continue;
      glue.push({ t, x0: a.x0, y0: Math.min(a.y0, b.y0), x1: Math.round(b.x0 + (b.x1 - b.x0) * Math.min(1, k / b.t.length)), y1: Math.max(a.y1, b.y1), c: Math.min(a.c, b.c), glue: true });
      break;
    }
  }
  // 발음 기호가 붙어 읽힌 표제어('fence[fens]')는 앞 낱말만
  const lat = words.concat(glue).map(w => { const m = w.t.match(/^([A-Za-z][A-Za-z\-]*)(?:[.,]?$|\[)/); return m ? Object.assign({}, w, { t: w.t.startsWith(m[1] + '[') ? m[1] : w.t }) : null; }).filter(Boolean).sort((a, b) => b.c - a.c);
  // 기준 글자 높이: 또렷하게 읽은 사전 낱말의 가운데값. 한글을 영어로 잘못 읽은 작은 잡티까지 세면 기준이 낮아져서
  // 모든 영어 단어가 같은 크기인 단어장 화면의 단어를 큰 표제어로 착각해 사전식 쪽으로 읽었어요
  const real = lat.filter(w => w.c >= 60 && dict.has(w.t.toLowerCase().replace(/[^a-z\-]/g, '')));
  const hs = (real.length >= 5 ? real : lat).map(w => w.y1 - w.y0).sort((a, b) => a - b), med = hs[hs.length >> 1] || 20;
  // 쪽의 다른 곳에 또렷하게 나온 사전 낱말 (사전으로도 못 고친 표제어를 예문 속 같은 낱말로 맞춰 봄: 'arden' → 'garden')
  const pgw = new Set(); for (const w of words) if (w.c >= 50) for (const p of w.t.toLowerCase().split(/[^a-z]+/)) if (p.length >= 4 && dict.has(p)) pgw.add(p);
  const out = [];
  for (const w of lat) {
    const h = w.y1 - w.y0, t = w.t.toLowerCase().replace(/[^a-z\-]/g, '');
    if (h < med * 1.35 || t.length < 3 || w.x0 > W * 0.35) continue;
    let fixed = dict.has(t) ? t : ocrFix(t, dict);
    if (!dict.has(fixed)) { let bd = 3; for (const p of pgw) { const d = ocrEdit(t, p); if (d < bd && d <= (p.length >= 5 ? 2 : 1)) { bd = d; fixed = p; } } }
    if (!dict.has(fixed) || fixed.length < 3) continue;
    // 한 줄에 표제어는 하나. 같은 자리를 더 넓게 읽은 낱말이 있으면 그쪽('art'보다 'cart')
    const same = out.findIndex(o => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.6);
    // 겹치지 않으면 더 왼쪽 것 (표제어 오른쪽의 발음 기호를 영어 낱말처럼 읽는 일이 있어요)
    if (same >= 0) { const o = out[same]; if (w.x0 < o.x1 && w.x1 > o.x0 ? (w.x1 - w.x0) > (o.x1 - o.x0) * 1.15 : w.x1 <= o.x0) out[same] = Object.assign({}, w, { t: fixed, raw: w.t }); continue; }
    out.push(Object.assign({}, w, { t: fixed, raw: w.t }));
  }
  out.sort((a, b) => a.y0 - b.y0);
  // 표제어 바로 밑에 붙은 작은 영어(어원 설명 'gard(en)' 같은 것)는 표제어가 아님: 위아래로 거의 붙은 두 낱말 가운데 작은 쪽을 뺌
  for (let k = out.length - 1; k > 0; k--) {
    const a = out[k - 1], b = out[k], ha = a.y1 - a.y0, hb = b.y1 - b.y0;
    if (b.y0 - a.y1 >= Math.min(ha, hb) * 0.5) continue;
    out.splice(hb < ha * 0.9 || (hb < ha * 1.1 && b.c < a.c) ? k : k - 1, 1);
  }
  // 표제어는 왼쪽 여백에 나란히 놓여요. 사진이 기울거나 휘면 여백 선도 비스듬하니, 표제어 셋 이상이면 그 선(x = 기울기·y + 절편)에서
  // 표제어 높이 2.5배 넘게 벗어난 것(예문 속 굵은 낱말 등)을 뺌. 둘뿐이면 가장 왼쪽 표제어에서 3.5배까지
  if (out.length) {
    const hm = out.map(o => o.y1 - o.y0).sort((a, b) => a - b)[out.length >> 1];
    if (out.length >= 3) {
      const sl = [];
      for (let p = 0; p < out.length; p++) for (let q = p + 1; q < out.length; q++) { const dy = out[q].y0 - out[p].y0; if (Math.abs(dy) > hm) sl.push((out[q].x0 - out[p].x0) / dy); }
      sl.sort((a, b) => a - b);
      const s = sl.length ? clamp(sl[sl.length >> 1], -0.3, 0.3) : 0, ic = out.map(o => o.x0 - s * o.y0).sort((a, b) => a - b), i0 = ic[ic.length >> 1];
      for (let k = out.length - 1; k >= 0; k--) if (Math.abs(out[k].x0 - s * out[k].y0 - i0) > hm * 2.5) out.splice(k, 1);
    } else { const minX = Math.min(...out.map(o => o.x0)); for (let k = out.length - 1; k >= 0; k--) if (out[k].x0 - minX > hm * 3.5) out.splice(k, 1); }
  }
  // 낱말 줄 아래에 그 낱말로 시작하는 예문이 있는 단어장 쪽은 표제어가 크지 않아도, 단이 둘이어도 그쪽으로 찾아요
  const eco = ocrEchoHeads(words, dict, W);
  return eco.length >= 4 && eco.length > out.length ? eco : out;
}
// 단어장 목록(낱말 줄 + 그 낱말로 시작하는 예문 줄)의 표제어: 줄의 첫 영어 낱말(앞에 번호만 올 수 있음)인데,
// 바로 아래 몇 줄 안에 같은 왼쪽 끝에서 같은 낱말(활용형도: 첫 네 글자)로 시작하는 줄이 있는 것 ('borrow' 아래 'borrow a book from the library').
// 단이 여럿이면 단마다 오른쪽 끝(다음 단의 왼쪽 끝)을 함께 적어 둬요
function ocrEchoHeads(words, dict, W) {
  // 번호가 붙어 읽힌 낱말('12borrow', '7travel')은 번호를 떼고 그만큼 왼쪽 끝을 옮김.
  // 발음 기호가 붙어 읽힌 낱말은 앞 낱말만 ('travel(trævəl)', '('를 글자로 읽은 'travelitrævəl)'은 사전에 있는 가장 긴 앞부분). ph: 발음 기호가 붙어 있었음
  const cut = (w, n) => Object.assign({}, w, { t: w.t.slice(0, n), x1: Math.round(w.x0 + (w.x1 - w.x0) * n / w.t.length), ph: true });
  const lat = words.map(w => {
    const m = w.t.match(/^[\d\W_]{1,3}(?=[A-Za-z]{3})/);
    if (m) w = Object.assign({}, w, { t: w.t.slice(m[0].length), x0: Math.round(w.x0 + (w.x1 - w.x0) * m[0].length / w.t.length) });
    const g = w.t.match(/^([A-Za-z][A-Za-z\-]{2,})[\[(]/);
    if (g) return cut(w, g[1].length);
    if (/^[A-Za-z]{6,}[\])]$/.test(w.t)) { const s = w.t.toLowerCase(); for (let n = s.length - 3; n >= 4; n--) if (dict.has(s.slice(0, n))) return cut(w, n); }
    return w;
  }).filter(w => /^[A-Za-z][A-Za-z\-]*[.,]?$/.test(w.t));
  const norm = t => t.toLowerCase().replace(/[^a-z\-]/g, '');
  const same = (a, b) => Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.6;
  // 낱말과 바로 오른쪽에 붙은 조각을 이어 읽은 글자 ('bo' + 'rrow')
  const joined = w => { const t = norm(w.t), nx = t.length < 5 && lat.find(o => o !== w && same(o, w) && o.x0 >= w.x1 - 3 && o.x0 - w.x1 < (w.y1 - w.y0) * 0.5); return t + (nx ? norm(nx.t) : ''); };
  // 글자 높이 기준: 또렷한 영어 낱말 높이의 가운데값 (위아래로 튀어나온 글자가 없는 낱말('measure')은 상자가 낮아서 그 높이로 재면 너무 좁아요)
  const hs = lat.filter(w => w.c >= 60).map(w => w.y1 - w.y0).sort((a, b) => a - b), med = hs[hs.length >> 1] || 0;
  // 줄의 첫 영어 낱말인지 (앞의 번호를 영어로 잘못 읽은 것('02' → 'oz')은 낱말로 치지 않음)
  const first = (w, hb) => !lat.some(o => o !== w && same(o, w) && o.x1 <= w.x0 + 3 && w.x0 - o.x1 < hb * 4 && norm(o.t).length >= 3);
  // 예문 줄: 바로 아래 몇 줄 안에, 비슷한 왼쪽 끝(낱말 앞 번호의 폭만큼 어긋나기도 해요)에서 같은 낱말로 시작하는 줄의 첫 낱말.
  // 또렷하게(45 이상) 읽혔으면 첫 네 글자, 흐리면 첫 다섯 글자까지 같아야 해요. 위에서부터
  const echoes = (w, t, hb) => lat.filter(o => {
    if (o === w || o.y0 <= w.y0 + (w.y1 - w.y0) * 0.6 || o.y0 - w.y1 >= hb * 3.5 || Math.abs(o.x0 - w.x0) >= hb * 3 || !first(o, hb)) return false;
    const j = joined(o), k = o.c >= 45 ? Math.min(4, t.length) : 5;
    return t.length >= k && j.slice(0, k) === t.slice(0, k);
  }).sort((a, b) => a.y0 - b.y0);
  const word = w => { const t = norm(w.t); if (t.length < 3) return ''; if (dict.has(t)) return t; const f = ocrFix(t, dict); return dict.has(f) ? f : ''; };
  const out = [];
  for (const w of lat) {
    const h = w.y1 - w.y0, hb = Math.max(h, med), t = word(w);
    if (!t || !first(w, hb)) continue;
    const es = echoes(w, t, hb), echo = es[0];
    // 표제어가 흐리게 읽혔어도(신뢰도 45 미만) 예문이 그 낱말 그대로 또렷하게 시작하면 표제어 (eok: 예문으로 확인된 낱말)
    const eok = t.length >= 4 && es.some(o => o.c >= 70 && joined(o).startsWith(t));
    if (!echo || (w.c < 45 && !eok)) continue;
    // 예문 하나에 낱말 줄 후보가 여럿이면(사이의 설명 줄도 그 낱말로 시작할 때) 맨 위 줄이 낱말 줄
    const cand = Object.assign({}, w, { t, raw: w.t, echo, eok }), prev = out.findIndex(o => o.echo === echo);
    if (prev < 0) out.push(cand); else if (w.y0 < out[prev].y0) out[prev] = cand;
  }
  // 예문 줄 자신이 다른 예문의 표제어로 잡히지 않게: 다른 표제어의 예문인 낱말은 뺌
  const isEcho = w => out.some(p => p.echo && p.echo.x0 === w.x0 && p.echo.y0 === w.y0);
  const heads = out.filter(o => !isEcho(o)).sort((a, b) => a.y0 - b.y0);
  // 단 나누기: 왼쪽 끝이 크게 떨어지면 다른 단
  const xs = heads.map(o => o.x0).sort((a, b) => a - b), cuts = [];
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > W * 0.18) cuts.push(xs[i]);
  for (const o of heads) { o.col = cuts.filter(x => o.x0 >= x).length; o.colRight = cuts[o.col] ? cuts[o.col] - (o.y1 - o.y0) * 0.6 : 0; }
  // 예문 첫 낱말을 잘못 읽어 짝이 없는 낱말 줄: 단의 낱말 왼쪽 끝에 놓인 줄의 첫 사전 낱말이고 바로 뒤에 발음 기호('[…]', '(…)')가 붙었으면 낱말 줄.
  // 같은 단의 다른 낱말 줄과는 한 항목(낱말 줄 + 예문 + 번역) 높이만큼 떨어져 있어야 해요
  if (heads.length >= 4) {
    const PH = /[\[\]()əæðʃʒŋːɔʌɪʊɛɑˈ]|[áéíóúàèìòù]/;
    for (const w of lat) {
      const h = w.y1 - w.y0, hb = Math.max(h, med);
      if (w.c < 45 || heads.some(o => o.x0 === w.x0 && o.y0 === w.y0) || isEcho(w) || !first(w, hb)) continue;
      const t = word(w); if (!t || heads.some(o => o.t === t)) continue;
      const col = cuts.filter(x => w.x0 >= x - hb * 1.5).length, hc = heads.filter(o => o.col === col);
      if (hc.length < 2) continue;
      if (Math.abs(w.x0 - hc.map(o => o.x0).sort((a, b) => a - b)[hc.length >> 1]) > hb * 1.5) continue;
      if (!w.ph && !words.some(o => o !== w && same(o, w) && o.x0 >= w.x1 - 3 && o.x0 - w.x1 < hb * 1.2 && PH.test(o.t))) continue;
      const ys = hc.map(o => o.y0).sort((a, b) => a - b), gs = ys.slice(1).map((y, i) => y - ys[i]).sort((a, b) => a - b), sp = gs[gs.length >> 1];
      if (hc.some(o => Math.abs(o.y0 - w.y0) < sp * 0.6)) continue;
      heads.push(Object.assign({}, w, { t, raw: w.t, col, colRight: cuts[col] ? cuts[col] - h * 0.6 : 0, echo: null, eok: false }));
    }
  }
  // 한 줄에 낱말 둘('A [발음] 뜻 : B [발음] 뜻'): 표제어 줄 오른쪽의 사전 낱말인데, 아래 몇 줄 안에 단의 왼쪽 끝에서
  // 그 낱말로 시작하는 예문이 있으면 둘째 표제어 (흐리게(60 미만) 읽혔으면 예문이 그 낱말 그대로 또렷하게 시작할 때만).
  // 휘어 찍힌 쪽은 줄이 비스듬해서 표제어 둘레 글줄의 기울기를 따라 같은 줄인지 봐요 (사이의 ':'는 '-'나 잡티로 읽히기도 해서 따지지 않아요)
  for (const hd of heads.slice()) {
    const h = hd.y1 - hd.y0, hb = Math.max(h, med), rx = hd.colRight || W, hx = (hd.x0 + hd.x1) / 2, hy = (hd.y0 + hd.y1) / 2;
    const sl = ocrPairSlope(words.filter(o => Math.abs((o.y0 + o.y1) / 2 - hy) < h * 4));
    for (const w of lat) {
      const t = norm(w.t);
      if (w === hd || w.c < 25 || t.length < 4 || !dict.has(t) || w.x0 < hd.x1 + h * 3 || w.x0 > rx) continue;
      if (Math.abs((w.y0 + w.y1) / 2 - (hy + sl * ((w.x0 + w.x1) / 2 - hx))) > Math.min(h, w.y1 - w.y0) * 0.6) continue;
      const ex = lat.find(o => o.c >= 60 && o.y0 > hd.y1 && o.y0 - hd.y1 < hb * 8 && Math.abs(o.x0 - hd.x0) < hb * 3 && joined(o).startsWith(t.slice(0, 4)) && first(o, hb));
      if (!ex || (w.c < 60 && !(ex.c >= 70 && joined(ex).startsWith(t))) || heads.some(o => o.t === t)) continue;
      hd.right = Math.min(hd.right || 1e9, w.x0 - h * 0.5);
      heads.push(Object.assign({}, w, { t, raw: w.t, col: hd.col, colRight: hd.colRight, echo: ex }));
    }
  }
  return heads.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}
// 두 영어 낱말의 편집 거리 (최대 3까지만 셈)
function ocrEdit(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 4;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return Math.min(4, prev[b.length]);
}
// 표제어 고르기: 여러 번 읽은 글자(신뢰도만큼), 사전으로 고친 말, 끝 글자를 쉼표로 읽은 말('harves,' → 'harvest'),
// 같은 쪽의 다른 곳(예문·어원 설명)에 나온 비슷한 낱말, 두 번 이상 똑같이 읽힌 낱말에 점수를 줘서 가장 높은 것. 다른 표제어로 읽은 낱말은 고르지 않음
function ocrHeadPick(reads, pg, dict, taken) {
  const sc = new Map(), raws = [];
  const add = (w, v) => { if (w && w.length >= 3 && dict.has(w) && !taken(w)) sc.set(w, (sc.get(w) || 0) + v); };
  for (const r of reads) {
    const raw = String(r.t || '').toLowerCase().replace(/[^a-z\-,.]/g, ''), t = raw.replace(/[^a-z\-]/g, '');
    if (t.length < 2) continue;
    raws.push(t);
    const k = clamp((r.c || 0) / 100, 0.2, 1) ** 2; // 또렷한 읽기 하나가 흐린 읽기 둘보다 믿을 만해요
    if (dict.has(t)) add(t, k * (r.glue ? 0.6 : 1));
    else {
      add(ocrFix(t, dict), 0.5 * k);
      if (/[,.]$/.test(raw)) for (const ch of 'rdeslnt') add(t + ch, 0.6 * k);
    }
  }
  if (!raws.length) return '';
  // 사전에 있는 낱말로 또렷하게 읽혔으면 쪽의 다른 낱말은 거의 보지 않음 ('hope'를 예문의 'rope'로 바꾸지 않게)
  const pw = 0.6 * (1 - Math.max(0, ...reads.filter(r => dict.has(String(r.t || '').toLowerCase().replace(/[^a-z\-]/g, ''))).map(r => clamp((r.c || 0) / 100, 0, 1))));
  for (const [w] of pg) if (w.length >= 3 && dict.has(w) && !sc.has(w) && raws.some(r => ocrEdit(r, w) <= (w.length >= 5 ? 2 : 1))) add(w, 0);
  let best = '', bs = -1e9;
  for (const [w, v] of sc) {
    const same = reads.filter(r => String(r.t || '').toLowerCase().replace(/[^a-z\-]/g, '') === w).map(r => clamp((r.c || 0) / 100, 0.2, 1)).sort((a, b) => b - a);
    const s = v + pw * Math.min(2, pg.get(w) || 0) - 0.4 * Math.min(...raws.map(r => ocrEdit(r, w))) + (dict.get(w) === 1 ? 0.2 : 0) + (same.length >= 2 ? 0.5 * same[1] : 0);
    if (s > bs) { bs = s; best = w; }
  }
  return best;
}
/* ---------- 한글 뜻 바로잡기 ---------- */
// 사진 글자 읽기가 자주 헷갈리는 비슷한 모양의 자모 묶음 (첫소리 · 가운뎃소리 · 받침 번호)
const KO_LOOK = [
  [[0, 1, 15], [0, 5], [0, 18], [3, 4, 16], [3, 5], [2, 3], [2, 5], [6, 7, 17], [6, 11], [7, 8], [9, 10, 12, 13, 14], [11, 18], [2, 11]],
  [[0, 2], [4, 6], [0, 4], [1, 3, 5, 7], [8, 12], [13, 17], [8, 13, 18], [11, 19], [9, 14], [16, 20]],
  [[0, 1, 2, 24], [16, 17, 21], [4, 8], [19, 20, 22, 23], [7, 8, 25], [0, 4], [0, 8], [0, 16], [0, 21]]
];
// 자모 하나를 다른 것으로 바꾸는 값: 같은 자모 0, 비슷한 모양 1 (받침이 생기거나 없어지는 것은 1.5), 그 밖 2.5
const KO_COST = KO_LOOK.map((gs, k) => {
  const n = [19, 21, 28][k], m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : 2.5));
  for (const g of gs) for (const a of g) for (const b of g) if (a !== b) m[a][b] = k === 2 && (!a || !b) ? 1.5 : 1;
  return m;
});
const koCost = (x, y) => KO_COST[0][x[0]][y[0]] + KO_COST[1][x[1]][y[1]] + KO_COST[2][x[2]][y[2]];
// 두 뜻이 같은 말을 조금 다르게 읽은 것인지 (글자 수가 같고 모양이 비슷한 자모만 조금 다름: '묶다'·'묵다')
function koNear(a, b) {
  if (a === b) return true;
  const A = [...a], B = [...b];
  if (A.length !== B.length) return false;
  let cost = 0;
  for (let k = 0; k < A.length; k++) if (A[k] !== B[k]) {
    const x = koSplit(A[k]), y = koSplit(B[k]);
    if (!x || !y) return false;
    cost += koCost(x, y);
    if (cost > 2.5) return false;
  }
  return true;
}
// 낱말 목록에 확실히 있는 꼴인지 (그대로, 또는 '어간 + 하다·시키다…', 또는 그 뒤에 조사)
const koSure = (w, L) => koExact(w, L) || KO_END.some(e => w.endsWith(e) && w.length - e.length >= 2 && koExact(w.slice(0, -e.length), L));
// 낱말이 아닌 세 글자 이상 한글 낱말을 모양이 비슷한 글자로 바꿔 진짜 낱말을 찾음 ('렬정하다' → '결정하다', '물타리' → '울타리')
// 가장 적게 바꾼 후보 가운데 앞쪽 글자를 바꾼 것 (번호·괄호 바로 뒤 첫 글자가 가장 자주 틀려요: '물타리' → '물타기'보다 '울타리').
// 그래도 여럿이면 어느 쪽인지 모르니 그대로. 두 글자 낱말은 여러 번 읽은 결과의 다수결에 맡겨요
function koLook(w, L) {
  const ch = [...w], n = ch.length, sp = ch.map(koSplit);
  if (n < 3 || n > 8 || sp.some(x => !x)) return w;
  // 짧은 낱말은 아무 글자나 조금 바꿔도 다른 낱말이 되기 쉬워서 더 엄격하게. 같은 값이면 낱말 목록에 그 꼴 그대로 있는 것
  // (아무 명사에나 '하다'를 붙인 꼴보다 목록에 있는 동사), 그다음 앞쪽 글자를 바꾼 것
  let best = '', bc = n === 3 ? 2.01 : 3.01, bd = 2, bp = 99, tie = false;
  const test = (arr, cost, pos) => {
    if (cost > bc + 1e-6) return;
    const s = arr.join(''); if (!koExact(s, L)) return;
    const dir = L.has(s) ? 0 : 1, same = Math.abs(cost - bc) < 1e-6;
    if (cost < bc - 1e-6 || (same && (dir < bd || (dir === bd && pos < bp)))) { bc = cost; bd = dir; bp = pos; best = s; tie = false; }
    else if (same && dir === bd && pos === bp && s !== best) tie = true;
  };
  // 한 글자에서 자모 한두 개
  for (let p = 0; p < n; p++) {
    const x = sp[p];
    for (let i = 0; i < 19; i++) for (let m = 0; m < 21; m++) for (let f = 0; f < 28; f++) {
      const d = (i !== x[0]) + (m !== x[1]) + (f !== x[2]); if (!d || d > 2) continue;
      const cost = koCost(x, [i, m, f]); if (cost > bc + 1e-6) continue;
      const arr = ch.slice(); arr[p] = koJoin(i, m, f); test(arr, cost, p);
    }
  }
  // 네 글자 이상이면 두 글자에서 비슷한 자모 하나씩
  if (n >= 4) {
    const alt = sp.map(x => { const o = []; for (let k = 0; k < 3; k++) for (let v = 0; v < [19, 21, 28][k]; v++) if (v !== x[k] && KO_COST[k][x[k]][v] === 1) { const y = x.slice(); y[k] = v; o.push(koJoin(y[0], y[1], y[2])); } return o; });
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) for (const a of alt[p]) for (const b of alt[q]) { const arr = ch.slice(); arr[p] = a; arr[q] = b; test(arr, 2, p); }
  }
  return best && !tie ? best : w;
}
// 두 글자 동사('강다')의 첫 글자에서 모양이 비슷한 자모 하나만 바꿔 진짜 낱말이 되는 것 가운데 가장 비슷한 것이 하나뿐이면 그것 ('가다'보다 '감다'). 아니면 ''
function koLookVerb(w, L) {
  const ch = [...w], x = koSplit(ch[0]);
  if (ch.length !== 2 || ch[1] !== '다' || !x) return '';
  let best = '', bc = 2, tie = false;
  for (let k = 0; k < 3; k++) for (let v = 0; v < [19, 21, 28][k]; v++) {
    const cost = KO_COST[k][x[k]][v]; if (!cost || cost > 1.5 || cost > bc) continue;
    const y = x.slice(); y[k] = v; const t = koJoin(y[0], y[1], y[2]) + '다'; if (!L.has(t)) continue;
    if (cost < bc) { bc = cost; best = t; tie = false; } else tie = true;
  }
  return tie ? '' : best;
}
// 붙어 읽힌 한글을 낱말 목록에 있는 꼴 n개 이하로 나눔 (앞 낱말을 길게). 마지막 낱말은 두 글자 동사의 비슷한 모양 글자 하나까지('강다' → '감다'),
// 한 글자 낱말은 '수'·'것'처럼 홀로 쓰이는 말만
function koSeg(x, L, n) {
  if (koSure(x, L) || /^(수|것|줄|때|곳|중|등)$/.test(x)) return [x];
  if (n > 1) for (let i = x.length - 1; i >= 2; i--) { const a = x.slice(0, i); if (!koSure(a, L)) continue; const r = koSeg(x.slice(i), L, n - 1); if (r) return [a, ...r]; }
  const v = koLookVerb(x, L); return v ? [v] : null;
}
const KO_PRT = ['에게서', '에서', '에게', '으로', '로', '의', '을', '를', '에', '와', '과', '이', '가', '은', '는', '도'];
// 낱말 목록에 없는 한글 낱말 하나 고치기 → [고친 말(띄어쓰기가 들어갈 수 있음), 고친 정도]. 못 고치면 [그대로, 0]
// 뜻 뒤에 붙은 유의어 기호 ⓢ를 읽은 글자('닫다운' → '닫다') → 비슷한 모양 글자('렬정하다' → '결정하다') →
// (첫 낱말이면) 앞에 붙은 품사 표시('형회상자(를' → '상자(를') → 붙어 읽힌 낱말 나누기('머리를감다' → '머리를 감다', '~에게도움을주다' → '~에게 도움을 주다')
function koFixWord(w, L, first) {
  const m = w.match(/^(~?)([가-힣]+)(.*)$/);
  // '-다'로 끝난 낱말은 그대로 목록에 있어야 진짜 ('강다'는 '강하다'가 있어도 낱말이 아님). '~하려'·'~에게' 같은 자리 표시는 그대로
  if (!m || /^~[가-힣]{0,3}$/.test(w) || (/다$/.test(m[2]) ? koExact(m[2], L) : koWordOk(m[2], L))) return [w, 0];
  const cut = m[2].match(/^([가-힣]+다)([가-힣])$/), cs = cut && koSplit(cut[2]);
  if (cut && cs[0] === 11 && cut[1].length >= 2 && koWordOk(cut[1], L)) return [m[1] + cut[1], 0.5]; // 'ⓢ'를 '운'·'오'처럼 동그라미 글자로 읽은 것
  const lk = koLook(m[2], L) !== m[2] ? koLook(m[2], L) : koLookVerb(m[2], L);
  if (lk && lk !== m[2]) return [m[1] + lk + m[3], 0.3];
  if (first && !m[1]) for (const s of [1, 2]) if (m[2].length - s >= 2 && koSure(m[2].slice(s), L) && !/^(하다|되다|시키다|받다|당하다)$/.test(m[2].slice(s))) return [m[2].slice(s) + m[3], 1];
  for (const s of first && !m[1] ? [0, 1, 2] : [0]) {
    let x = m[2].slice(s), head = m[1];
    if (head) { const pr = KO_PRT.find(p => x.startsWith(p) && x.length >= p.length + 2); if (pr) { head += pr + ' '; x = x.slice(pr.length); } }
    const sg = x.length >= 3 && koSeg(x, L, 3);
    if (sg && (sg.length > 1 || head.length > 1)) return [head + sg.join(' ') + m[3], s ? 1 : 0.5];
  }
  return [w, 0];
}
// 쉼표를 못 읽어 한 덩어리가 된 뜻 나누기: '-다'로 끝난 낱말 뒤('사라지다 없어지다', '위태롭게 하다 위험에 빠뜨리다'),
// 같은 꼴로 끝나는 꾸밈말·어찌말이 나란히 있을 때('임의로 무작위로', '적합한 알맞은')
function koListSplit(p, L) {
  const ws = p.split(' ').filter(Boolean);
  if (ws.length < 2 || /[()]/.test(p)) return [p];
  const out = []; let cur = [];
  ws.forEach((w, i) => { cur.push(w); if (i < ws.length - 1 && /^[가-힣]+다$/.test(w) && (w.length >= 3 || cur.length > 1) && koExact(w, L)) { out.push(cur.join(' ')); cur = []; } });
  if (cur.length) out.push(cur.join(' '));
  if (out.length > 1) return out;
  const end = w => /(로|게|히)$/.test(w) ? 'd' : /(한|은|는|운|인|된|던|른)$/.test(w) ? 'a' : '';
  const okw = w => koWordOk(w, L) || (/로$/.test(w) && koExact(w.slice(0, -1), L));
  if (ws.length <= 3 && end(ws[0]) && ws.every(w => /^[가-힣]{2,}$/.test(w) && end(w) === end(ws[0]) && okw(w))) return ws;
  return [p];
}
// 짝 없는 ')': '('를 못 읽은 설명 괄호예요. ')' 뒤에 뜻이 이어지면 괄호 안이었을 낱말(최대 4개)을 뺌
// ('2. 문제 · 생각 등을) 조사하다' → '2. 조사하다'). '다'로 끝난 뜻이나 숫자·영어·기호를 만나면 멈춰요
function ocrParen(t) {
  let out = '', depth = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') depth++;
    if (ch !== ')') { out += ch; continue; }
    if (depth > 0) { depth--; out += ch; continue; }
    if (/^\s*[가-힣~]/.test(t.slice(i + 1))) {
      for (let k = 0; k < 4; k++) {
        const m = out.match(/([가-힣]+)([\s.·ㆍ,]*)$/);
        if (!m || /다$/.test(m[1])) break;
        out = out.slice(0, out.length - m[0].length);
      }
    }
    out += ' ';
  }
  return out;
}
const KO_BAR = { 2: ['리', '기'], 7: ['기'], 'ㄱ': ['기'], 0: ['이'], o: ['이'], O: ['이'], 'ㅇ': ['이'], L: ['니'], 'ㄴ': ['니'] };
// 뜻 줄 글자 → 뜻 목록: 품사 표시(명·동), 번호, 영어 동의어, 기호를 빼고 진짜 낱말인 뜻만 (최대 4개)
function ocrMeanLine(text, L) {
  let t = String(text || '').replace(/[㈀-㋿①-⓿]/g, ' ')
    // 세로 모음 'ㅣ'가 떨어져 숫자·기호로 읽힌 글자('기' → '7 |', '이' → '0|'): 이어서 확실한 낱말이 될 때만 되돌림
    .replace(/([가-힣]+)\s?([27ㄱ0oOㅇLㄴ])\s?[|Il1ㅣ]\s?([가-힣]*)/g, (a, x, j, z) => { for (const f of [s => L.has(s), s => koExact(s, L)]) for (const g of KO_BAR[j]) if (f(x + g + z)) return x + g + z; return a; })
    // 어원 설명('…에서 유래'), 괄호와 붙어 읽힌 품사 표시('형(상자'), 낱말 앞에 붙은 낱자모('ㅋ감독')는 지움
    .replace(/에서\s*유래\S*/g, ' ').replace(/(^|[\s.\d])[명동형부통][(\[{]/g, '$1 ').replace(/(^|\s)[ㄱ-ㅣ]+(?=[가-힣])/g, '$1')
    // 홀로 읽힌 낱자모('ㅇ.')는 번호를 잘못 읽은 것: 뜻 나누는 자리로
    .replace(/(^|[\s\d.])[ㄱ-ㅣ](?=[\s.]|$)/g, '$1, ')
    // 말줄임표로 시작하는 뜻('…하게 하다')은 '~하게 하다'
    .replace(/(?:…|⋯|\.{2,}|-{2,})\s*(?=[가-힣])/g, ' ~')
    // 바꿔 쓸 수 있는 말을 대괄호로 적은 뜻: '제한[금지]하다' → '제한하다, 금지하다' (']'를 못 읽은 '제한[금지 하다'도)
    .replace(/\[([가-힣]+)[}|)]/g, '[$1]').replace(/([가-힣]+)\[([가-힣]+)\]\s?([가-힣]*)/g, '$1$3, $2$3')
    .replace(/([가-힣]+)\[([가-힣]+)\s+(하다|되다|시키다|하게|하는|한)(?![가-힣])/g, '$1$3, $2$3')
    // '['를 못 읽은 '감독관리]하다': ']' 앞에서 뒷말과 이어 진짜 낱말이 되는 부분만 ('관리하다')
    .replace(/([가-힣]+)\]([가-힣]+)/g, (a, x, z) => { for (let k = x.length - 2; k >= Math.max(0, x.length - 4); k--) if (koExact(x.slice(k) + z, L)) return ' ' + x.slice(k) + z; return x + ' ' + z; });
  t = ocrParen(t)
    // 괄호: 앞 글자에 붙은 한글 괄호('머리(를 감다)')만 남기고, 띄어 쓴 설명 괄호·영어 괄호는 뺌.
    // 짝 없는 '('는 그 글자만 지움 (발음 기호 끝을 '(]'로 읽은 것 뒤의 뜻까지 지우지 않게)
    .replace(/(^|[^가-힣])\([^()]*\)/g, '$1 ')
    .replace(/\(([^()]*)\)/g, (a, x) => /[가-힣]/.test(x) ? a : ' ')
    .replace(/\((?![^()]*\))/g, ' ')
    .replace(/[A-Za-z0-9@#*_=|\[\]{}<>"“”'`^:;!?&%$+\\]+|~(?![가-힣])/g, m => /\d/.test(m) ? m.replace(/\d+/g, d => ' ' + d + '.').replace(/[^\d.]/g, ' ') : ' ');
  const parts = t.split(/\s*(?:\d+\s*\.|[,，·ㆍ/]|\.\s)\s*/).map(p => p.replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out = [];
  out.fix = 0; // 글자를 떼거나 바꿔서 낱말을 만든 횟수 (많을수록 덜 믿을 만한 줄)
  const ok = w => /^~[가-힣]{0,3}$/.test(w) || koWordOk(w.replace(/^~/, '').replace(/\(.*$/, '').replace(/[()]/g, ''), L); // '~하려'·'~에게' 같은 자리 표시도 뜻의 일부
  for (let pi = 0; pi < parts.length; pi++) {
    let p = parts[pi], ws = p.split(' ');
    // 가운데 글자를 잡티로 읽어 갈라진 낱말('정리하다' → '정', '하다')의 뒤쪽 '하다'는 뜻이 아님
    if (/^(하다|되다|시키다)$/.test(p) && /^[가-힣]$/.test(parts[pi - 1] || '')) continue;
    // '설 명 하다'처럼 낱글자로 쪼개 읽힌 한글은 먼저 붙임 (그래야 가운데 '명'이 품사 표시로 지워지지 않아요)
    // 붙인 말이 진짜 낱말일 때만 ('더 밍 흥상자'처럼 잡티 글자까지 붙여 뜻을 망치지 않게)
    for (let i = 0; i < ws.length; i++) if (/^[가-힣]$/.test(ws[i]) && /^[가-힣]$/.test(ws[i + 1] || '')) {
      let j = i, t = ''; while (j < ws.length && /^[가-힣]$/.test(ws[j])) t += ws[j++];
      if (j < ws.length && /^[가-힣]/.test(ws[j])) t += ws[j++];
      if (koWordOk(t.replace(/\(.*$/, ''), L)) ws.splice(i, j - i, t);
    }
    ws = ws.filter(w => !/^(명|동|형|부|유|반|참|명동|동명|숙)$/.test(w));
    let cut = 0; while (ws.length > 1 && /^[가-힣]$/.test(ws[0]) && !/^~/.test(ws[1])) { ws.shift(); cut++; } // '명'을 잘못 읽은 한 글자 등 ('막 ~하려 하다'의 '막'은 둠)
    if (cut && /^(하다|되다|시키다)$/.test(ws.join(' '))) continue; // 앞 글자만 남고 가운데가 잡티로 빠진 낱말('정@ 하다')의 '하다'
    // 낱말이 아닌 낱말 고치기: 뜻 뒤에 붙은 유의어 기호 ⓢ를 읽은 글자('닫다운' → '닫다'), 비슷한 모양 글자('렬정하다' → '결정하다'),
    // 품사 표시가 앞에 붙어 읽힌 것('형회상자(를' → '상자(를')
    ws = ws.map((w, k) => { if (ok(w) && !/다$/.test(w)) return w; const [x, f] = koFixWord(w, L, k === 0); out.fix += f; return x; }).flatMap(w => w.split(' '));
    // 떨어져 읽힌 '하다'·'되다'·'시키다'는 앞 낱말에 붙임 ('제한 하다' → '제한하다')
    // ('도움이 되다'처럼 앞말이 '명사 + 이·가·을·를'이면 띄어 쓴 그대로)
    for (let i = ws.length - 1; i > 0; i--) if (/^(하다|되다|시키다)$/.test(ws[i]) && /^[가-힣]+[^게고지아어여]$/.test(ws[i - 1]) && koExact(ws[i - 1] + ws[i], L)
      && !(/[이가을를]$/.test(ws[i - 1]) && ws[i - 1].length >= 3 && L.has(ws[i - 1].slice(0, -1)))) ws.splice(i - 1, 2, ws[i - 1] + ws[i]);
    // 앞말 없이 '하게 하다'로 시작하면 앞 말줄임표를 못 읽은 것: '~하게 하다'
    if (/^(하게|되게|하도록)/.test(ws[0] || '')) ws[0] = '~' + ws[0];
    while (ws.length && !ok(ws[0])) ws.shift();
    while (ws.length > 1 && !ok(ws[ws.length - 1]) && !/\)$/.test(ws[ws.length - 1])) ws.pop();
    // '-다'로 끝난 뜻 뒤에 이어진 낱말은 버림 (유의어 표시 ⓢ 같은 기호를 글자로 잘못 읽은 것: '닫다 윤허', '조사하다 비)')
    const end = ws.findIndex(w => /^~?[가-힣]+다$/.test(w) && !/^(하다|되다)$/.test(w) && ok(w));
    if (end >= 0 && end < ws.length - 1 && !ws.slice(end + 1).some(w => /\(/.test(w))) { ws = ws.slice(0, end + 1); out.fix++; }
    // 뜻 끝에 홀로 붙은 한 글자('울타리 기')는 괄호·기호를 잘못 읽은 것 (것·수·때처럼 뜻의 일부가 되는 말은 둠)
    if (ws.length > 1 && /^[가-힣]$/.test(ws[ws.length - 1]) && !/^(것|수|때|곳|일|말|줄|적|편|쪽|채|척|체|듯|뿐|만|등)$/.test(ws[ws.length - 1])) { ws.pop(); out.fix += 0.5; }
    p = ws.join(' ').replace(/\(\s*([^)]*?)\s*\)/g, (a, x) => '(' + x.replace(/\s+/g, ' ') + ')');
    // 네 낱말 이상은 뜻이 아니라 예문 번역 같은 문장 ('그 아이는 날마다 학교에 걸어서 간다')
    if (p && p.split(' ').length <= 3 && koChunk(p.replace(/^~/, ''), L) === 'ok' && !out.includes(p)) out.push(p);
    if (out.length >= 4) break;
  }
  out.loose = out.filter(m => !m.split(' ').some(t => koExact(t.replace(/^~/, ''), L))).length;
  return out;
}
// 여러 번 읽은 뜻 줄 가운데 가장 믿을 만한 줄: 줄 점수 + 다른 읽기에서도 (같거나 비슷하게) 나온 뜻마다 3점
function ocrBestMean(cands) {
  let best = null;
  for (const cd of cands) {
    let v = 0;
    for (const m of new Set(cd.ms)) v += cands.filter(o => o !== cd && o.ms.some(x => koNear(m, x))).length;
    cd.v = cd.sc + v * 3;
    if (!best || cd.v > best.v) best = cd;
  }
  return best;
}
// 고른 줄의 뜻을 여러 번 읽은 결과로 다듬음
// - 비슷하게 읽힌 꼴 가운데 가장 많이 나온 꼴로 ('묵다' 한 번, '묶다' 두 번 → '묶다')
// - 쉼표를 못 읽어 붙은 뜻은 다른 읽기에서 따로 나온 뜻으로 나눔 ('상자 바구니' → '상자', '바구니')
// - 다른 읽기에 없는 뜻: 일부만 나왔으면 그 부분만, 다른 뜻이 둘 이상 확인된 줄의 홀로 읽힌 낱말·짧은 잡티('하복 아남 개')는 뺌
function ocrAgree(best, cands, L) {
  const out = [], others = cands.filter(cd => cd !== best);
  const sup = best.ms.map(m => others.filter(cd => cd.ms.some(x => koNear(m, x))).length);
  const confirmed = i => sup.filter((v, j) => j !== i && v).length;
  best.ms.forEach((m, i) => {
    if (/ /.test(m)) {
      const ws = m.split(' '), sub = [];
      for (let a = 0; a < ws.length;) {
        let b = ws.length;
        for (; b > a; b--) if (b - a < ws.length && others.some(cd => cd.ms.includes(ws.slice(a, b).join(' ')))) break;
        if (b === a) break;
        sub.push(ws.slice(a, b).join(' ')); a = b;
      }
      if (sub.length > 1 && sub.join(' ') === m && !/~|(^| )(하다|되다)$/.test(m)) { for (const x of sub) if (!out.includes(x)) out.push(x); return; }
      if (!sup[i]) {
        const part = [];
        for (const cd of others) for (const x of cd.ms) if (x.length >= 2 && (' ' + m + ' ').includes(' ' + x + ' ') && !part.includes(x)) part.push(x);
        if (part.length) { part.sort((p, q) => m.indexOf(p) - m.indexOf(q)); for (const x of part) if (!out.includes(x)) out.push(x); return; }
        if (!/다$/.test(m) && ws.every(x => x.length <= 2) && confirmed(i)) return;
      }
    } else if (!sup[i] && confirmed(i) >= 2) return;
    // 같은 줄의 다른 뜻은 모양이 비슷해도('가다, 나다') 이 뜻의 다른 읽기로 치지 않음
    const vs = new Map();
    for (const cd of cands) for (const x of cd.ms) if (koNear(m, x) && (x === m || !best.ms.includes(x))) vs.set(x, (vs.get(x) || 0) + 1 + cd.conf);
    // 낱말 목록에 그대로 있는 낱말이 더 많은 꼴을 먼저 ('공무하다'가 두 번, '공부하다'가 한 번이어도 '공부하다'), 그다음 많이 나온 꼴
    const lx = x => L ? x.split(' ').filter(w => L.has(w.replace(/^~/, '').replace(/\(.*$/, ''))).length : 0;
    let pick = m, pv = -1, pl = -1;
    for (const [x, v] of vs) { const l = lx(x); if (l > pl || (l === pl && v > pv)) { pl = l; pv = v; pick = x; } }
    if (!out.includes(pick)) out.push(pick);
  });
  return out.slice(0, 4);
}
// 한 표제어의 뜻이 여러 줄이면('1. 2.' 다음 줄에 '3.') 줄마다 여러 번 읽은 결과로 다듬어 위에서부터 이어 붙임 (최대 4개)
// 가장 믿을 만한 줄은 늘 넣고, 다른 줄은 또렷하게(신뢰도 55 이상) 읽혔고 다른 읽기에서도 나온 뜻만
function ocrLines(best, cands, L) {
  const lines = [];
  for (const cd of [...cands].sort((a, b) => a.y - b.y)) {
    const ln = lines.find(l => Math.abs(l.y - cd.y) < Math.max(l.h, cd.h) * 0.6);
    if (ln) ln.cs.push(cd); else lines.push({ y: cd.y, h: cd.h, cs: [cd] });
  }
  const out = [];
  for (const ln of lines) {
    const main = ln.cs.includes(best), b = main ? best : ocrBestMean(ln.cs);
    let ms = ocrAgree(b, ln.cs, L);
    if (!main) {
      if (b.conf < 0.55) continue;
      ms = ms.filter(m => ln.cs.some(cd => cd !== b && cd.ms.some(x => koNear(m, x))));
    }
    for (const m of ms) if (!out.includes(m)) out.push(m);
  }
  return out.slice(0, 4);
}
// 오츠 방법으로 흑백 나누기 (잘라 낸 그림 안의 밝기 분포로 기준을 정함)
function ocrOtsu(cv, g) {
  const id = g.getImageData(0, 0, cv.width, cv.height), d = id.data, hist = new Float64Array(256), n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[d[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
  for (let i = 0; i < d.length; i += 4) { const v = d[i] > th ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(id, 0, 0);
}
// 쪽의 한 부분을 기울기만큼 돌려서(글줄이 수평이 되게, 점 cx·cy를 축으로) s배로 잘라 냄
// back(x, y): 잘라 낸 그림 속 위치 → 원래 쪽 위치
function ocrCutLevel(c, cx, cy, a, x0, y0, w, h, s) {
  const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(w * s)); o.height = Math.max(1, Math.round(h * s));
  const g = o.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, o.width, o.height);
  g.imageSmoothingQuality = 'high';
  g.scale(s, s); g.translate(cx - x0, cy - y0); g.rotate(-a); g.drawImage(c, -cx, -cy);
  const cos = Math.cos(a), sin = Math.sin(a);
  const back = (px, py) => { const u = px / s + x0 - cx, v = py / s + y0 - cy; return [cx + u * cos - v * sin, cy + u * sin + v * cos]; };
  return { o, back };
}
// 표제어 줄의 오른쪽 끝: 단 경계(rx) 바로 앞에 글자 높이보다 넓은 빈자리(단 사이)가 있으면 rx 그대로.
// 없으면 줄이 경계를 넘어 이어지는 것이라 경계 뒤에서 처음 나오는 넓은 빈자리(글자 높이 2.5배)까지
function ocrLineEnd(c, cx, cy, a, hh, left, rx) {
  const x0 = Math.max(left, Math.round(rx - hh * 4)), w = c.width - x0;
  if (w < hh * 2) return rx;
  const { o } = ocrCutLevel(c, cx, cy, a, x0, Math.round(cy - hh * 0.5), w, Math.max(4, Math.round(hh)), 1);
  const d = o.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, o.width, o.height).data;
  const lum = []; for (let i = 0; i < d.length; i += 4) lum.push(d[i]);
  lum.sort((p, q) => p - q);
  const th = lum[Math.floor(lum.length * 0.7)] * 0.6, ink = new Uint8Array(o.width); // 바탕(밝은 쪽)보다 한참 어두운 점이 글자
  for (let x = 0; x < o.width; x++) { let n = 0; for (let y = 0; y < o.height; y++) if (d[(y * o.width + x) * 4] < th) n++; ink[x] = n >= 2 ? 1 : 0; }
  const gap = (from, to, len) => { let run = 0; for (let x = Math.max(0, from); x < Math.min(o.width, to); x++) { run = ink[x] ? 0 : run + 1; if (run >= len) return x - run + 1; } return -1; };
  const bx = Math.round(rx) - x0;
  if (gap(0, bx + Math.round(hh), Math.round(hh * 1.2)) >= 0) return rx;
  const end = gap(bx, o.width, Math.round(hh * 2.5));
  return end < 0 ? c.width : x0 + end + Math.round(hh * 0.5);
}
// 사전식 쪽: 표제어마다 오른쪽 뜻 자리만 잘라서 한국어로 다시 읽음
async function ocrDictPage(c, words, dict, L, run) {
  const heads = ocrHeadwords(words, dict, c.width);
  if (window.__dd) window.__dd.push('heads ' + heads.map(h => h.t + '@' + h.x0 + ',' + h.y0 + '-' + h.y1 + 'c' + Math.round(h.c)).join(' '));
  if (heads.length < 2) return null;
  // 쪽의 다른 곳(예문·어원 설명)에 나온 영어 낱말 수: 표제어를 비슷한 다른 낱말로 읽었을 때 바로잡는 데 씀
  // (표제어 자리와 그 표제어 바로 밑 어원 설명 줄은 빼요: 어원 설명 속 낱말을 잘못 읽은 것이 표제어를 그 낱말로 바꾸지 않게)
  const inHead = w => heads.some(h => w.x0 < h.x1 && w.x1 > h.x0 && w.y0 < h.y1 && w.y1 > h.y0);
  const pgOf = hw => {
    const hh = hw.y1 - hw.y0, pg = new Map();
    for (const w of words) {
      if (w.c < 30 || inHead(w) || (w.y1 > hw.y0 - hh * 0.5 && w.y0 < hw.y1 + hh * 1.8 && w.x0 < hw.x1 + hh * 3)) continue;
      for (const p of w.t.toLowerCase().split(/[^a-z]+/)) if (p.length >= (w.c >= 50 ? 3 : 5)) pg.set(p, (pg.get(p) || 0) + 1);
    }
    return pg;
  };
  // 표제어 둘레의 글줄 기울기 (쪽이 휘어 있으면 위아래 기울기가 달라요)
  const slopeAll = ocrPairSlope(words);
  for (const h of heads) { const cy = (h.y0 + h.y1) / 2, hh = h.y1 - h.y0; h.a = Math.atan(ocrPairSlope(words.filter(w => Math.abs((w.y0 + w.y1) / 2 - cy) < hh * 4)) || slopeAll); }
  // 1) 표제어 확인: 오른쪽에 붙은 조각('fenc' 옆 'e')까지 넓게, 기울기를 바로잡아 한 줄로 다시 읽고 여러 읽기·쪽의 다른 낱말로 고름
  const owner = new Map(); for (const h of [...heads].sort((a, b) => b.c - a.c)) if (h.c >= 50 && !owner.has(h.t)) owner.set(h.t, h);
  const ok = [];
  await OCR.eng.setParameters({ tessedit_pageseg_mode: '7' });
  try {
    for (const hw of heads) {
      const hh = hw.y1 - hw.y0, cx = (hw.x0 + hw.x1) / 2, cy = (hw.y0 + hw.y1) / 2;
      let x1 = hw.x1;
      for (let more = true; more;) { more = false; for (const w of words) if (/^[A-Za-z]+[.,]?$/.test(w.t) && w.y1 - w.y0 >= hh * 0.6 && w.x1 > x1 && w.x0 > x1 - 3 && w.x0 - x1 <= hh * 0.35 && Math.abs((w.y0 + w.y1) / 2 - cy) < hh * 0.5) { x1 = w.x1; more = true; } }
      const pad = Math.round(hh * 0.25);
      const reads = [{ t: hw.raw, c: hw.c, glue: hw.glue }];
      const reread = async (s, bin) => {
        try {
          const cut = ocrCutLevel(c.plain || c, cx, cy, hw.a, hw.x0 - pad, hw.y0 - pad, x1 - hw.x0 + pad * 2, hh + pad * 2, s).o;
          if (bin) ocrOtsu(cut, cut.getContext('2d', { willReadFrequently: true }));
          const r = await OCR.eng.recognize(cut);
          // 첫 낱말 (앞에 번호가 함께 잘려 들어왔으면('15 travel') 번호는 건너뜀)
          const toks = String(r.data.text || '').trim().split(/[\s\[(]+/).filter(Boolean);
          reads.push({ t: toks.find(x => /[A-Za-z]/.test(x)) || toks[0] || '', c: r.data.confidence || 0 });
        } catch (e) { }
      };
      await reread(2, false);
      if (MK.run !== run) return null;
      // 두 읽기가 다르면 흑백으로 더 크게 한 번 더
      const norm = x => String(x || '').toLowerCase().replace(/[^a-z\-]/g, '');
      if (!(dict.has(hw.t) && norm(reads[1] && reads[1].t) === hw.t)) { await reread(3, true); if (MK.run !== run) return null; }
      // 바로 아래 예문이 이 낱말 그대로 또렷하게 시작하면(eok) 그것도 한 번 읽은 것으로 침 (발음 기호와 붙어 읽혀 다시 읽기가 낱말 끝을 놓칠 때)
      const pg = pgOf(hw), pick = ocrHeadPick(hw.eok ? reads.concat({ t: hw.t, c: 90 }) : reads, pg, dict, w => owner.has(w) && owner.get(w) !== hw) || hw.t;
      if (window.__dd) window.__dd.push('reread ' + reads.map(r => r.t + ' c' + Math.round(r.c)).join(' / ') + ' => ' + pick);
      const conf = Math.max(0, ...reads.slice(1).filter(r => norm(r.t) === pick).map(r => r.c));
      // 처음에 아주 흐리게(50 미만) 읽힌 표제어는 다시 읽어서 확인되지 않고 쪽의 다른 곳에도 두 번 이상 나오지 않으면 버림 (각주 한글을 'ray'로 읽은 것 같은 잡티).
      // 바로 아래 예문이 그 낱말로 또렷하게 시작하는 표제어(eok)는 흐리게 찍혔어도 둠
      if ((hw.c || 0) < 50 && conf < 45 && (pg.get(pick) || 0) < 2 && !(hw.eok && pick === hw.t)) continue;
      hw.ek = !!hw.eok && pick === hw.t; hw.t = pick; hw.rc = conf;
      if (!owner.has(pick)) owner.set(pick, hw);
      ok.push(hw);
    }
  } finally { await OCR.eng.setParameters({ tessedit_pageseg_mode: '11' }); }
  if (ok.length < 2) return null;
  // 2) 뜻: 표제어 오른쪽 글줄을 기울기를 바로잡아 잘라서 한국어로 읽음
  const rows = [];
  await OCR.worker.setParameters({ tessedit_pageseg_mode: '6' });
  try {
    for (let i = 0; i < ok.length; i++) {
      const hw = ok[i], hh = hw.y1 - hw.y0, cx = (hw.x0 + hw.x1) / 2, cy = (hw.y0 + hw.y1) / 2, sin = Math.sin(hw.a), cos = Math.cos(hw.a);
      // 바로잡은 그림(이 표제어 가운데를 축으로 돌림)에서 각 표제어 가운데의 높이
      const yOf = h => cy - ((h.x0 + h.x1) / 2 - cx) * sin + ((h.y0 + h.y1) / 2 - cy) * cos;
      // 같은 단의 표제어끼리만 위아래 경계로 (단이 여럿인 단어장 쪽), 뜻 자리는 다음 단 앞까지.
      // 위아래는 바로잡은 높이로 따져요 (휘어 찍혀 비스듬한 줄의 둘째 낱말('A … : B …'의 B)이 다음 줄로 잡히지 않게)
      const col = ok.filter(h => (h.col || 0) === (hw.col || 0)), line = h => Math.abs(yOf(h) - cy) < hh * 0.6;
      const nx = col.filter(h => yOf(h) > cy + hh * 0.6).sort((a, b) => yOf(a) - yOf(b))[0], pv = col.filter(h => yOf(h) < cy - hh * 0.6).sort((a, b) => yOf(b) - yOf(a))[0];
      const left = Math.round(hw.x1 + hh * 2);
      // 단이 여럿인 쪽이라도 쪽 너비로 쓴 줄은 단 사이 빈자리를 넘어 이어져요: 그때는 줄이 끝나는 빈자리까지
      const right = Math.round(hw.right || (hw.colRight ? ocrLineEnd(c.plain || c, cx, cy, hw.a, hh, left, hw.colRight) : c.width));
      // 예문이 바로 아래 오는 단어장은 예문 줄 앞까지만 (예문 번역을 뜻으로 읽지 않게)
      const ey0 = hw.echo ? cy - (hw.echo.x0 - cx) * sin + (hw.echo.y0 - cy) * cos - 2 : 1e9;
      const top = Math.max(0, Math.round(Math.max(cy - hh * 1.1, pv ? yOf(pv) : -1e9))), bottom = Math.round(Math.min(cy + hh * 2.2, nx ? yOf(nx) : 1e9, ey0));
      if (left >= right - 20 || bottom - top < 10) continue;
      const cands = [];
      // 뜻 자리를 s배로 읽어 줄마다 후보로 (가는 한글 글씨는 크기에 따라 잘 읽히는 게 달라서 크기를 바꿔 여러 번 읽어요)
      const readAt = async (s, bin) => {
        const { o, back } = ocrCutLevel(c, cx, cy, hw.a, left, top, right - left, bottom - top, s);
        if (bin) ocrOtsu(o, o.getContext('2d', { willReadFrequently: true })); // 색 띠(초록 제목 띠 등) 위 글자: 잘라 낸 곳만의 기준으로 흑백
        const r = await OCR.worker.recognize(o, {}, { blocks: true });
        if (MK.run !== run) return false;
        for (const b of r.data.blocks || []) for (const pa of b.paragraphs || []) for (const ln of pa.lines || []) {
          const ms = ocrMeanLine(ln.text, L);
          if (window.__dd) window.__dd.push(hw.t + ' x' + s + ' c' + Math.round(ln.confidence) + ' ' + ln.text.trim() + ' => ' + JSON.stringify(ms));
          if (!ms.length) continue;
          // 위치는 뜻이 시작되는 첫 한글 낱말로 (휘어 내려가는 긴 줄은 줄 전체 상자의 가운데가 실제보다 아래로 잡혀요)
          const fw = (ln.words || []).find(w => /[가-힣]/.test(w.text || '') && w.bbox);
          const bb = (fw && fw.bbox) || ln.bbox || { x0: 0, x1: 0, y0: 0, y1: 0 };
          const ly = (bb.y0 + bb.y1) / 2 / s + top, mh = (bb.y1 - bb.y0) / s;
          // 뜻 글자는 표제어 밑줄에 맞춰 찍혀요: 기대하는 뜻 줄 가운데 = 표제어 밑줄 - 뜻 글자 높이 절반. 다른 표제어 줄에 더 가까우면 그 표제어 것
          const ey = h => yOf(h) + (h.y1 - h.y0) / 2 - mh / 2;
          let closest = hw, cd = Math.abs(ly - ey(hw));
          for (const h of col) if (h !== hw && !line(h) && Math.abs(ly - ey(h)) < cd) { cd = Math.abs(ly - ey(h)); closest = h; }
          if (closest !== hw) continue;
          const conf = clamp((+ln.confidence || 50) / 100, 0.2, 1);
          const sc = Math.min(8, ms.join('').length) * conf - Math.max(0, Math.abs(ly - ey(hw)) - hh * 0.5) / hh * 6 - (ms.fix || 0) * 0.5 - (ms.loose || 0) * 1.5;
          const lb = ln.bbox || bb, pts = [back(lb.x0, lb.y0), back(lb.x1, lb.y0), back(lb.x0, lb.y1), back(lb.x1, lb.y1)];
          cands.push({ s, sc, ms, conf, y: ly, h: mh, b: { x0: Math.min(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), x1: Math.max(...pts.map(p => p[0])), y1: Math.max(...pts.map(p => p[1])) } });
        }
        return true;
      };
      if (!(await readAt(1)) || !(await readAt(1.5))) return null;
      let best = ocrBestMean(cands);
      // 아무것도 못 읽었거나 고른 줄의 뜻이 다른 크기로 읽은 결과와 다르면 흑백으로 2배 크게 한 번 더 읽어서 다수결
      if (!best || best.ms.some(m => !cands.some(o => o.s !== best.s && o.ms.includes(m)))) { if (!(await readAt(2, true))) return null; best = ocrBestMean(cands); }
      if (best) {
        rows.push(hw.t + ' - ' + ocrLines(best, cands, L).join(', '));
        if (OCR.boxes) ocrKeepBox(hw.t, ocrBox([hw, best.b]));
        // 흐리게 읽힌 줄: 확인 화면에서 빨간 칸 (표제어가 흐려도 바로 아래 예문이 같은 낱말로 또렷하게 시작하면 표제어는 확인된 것)
        if (best.conf < 0.5 || (Math.max(hw.c || 0, hw.rc || 0) < 85 && !hw.ek)) OCR.low.add(hw.t);
      }
      ocrShow('', 0.3 + 0.7 * (OCR.i + 0.6 + 0.4 * (i + 1) / ok.length) / OCR.n);
    }
  } finally { await OCR.worker.setParameters({ tessedit_pageseg_mode: '4' }); }
  return rows.length >= 2 ? rows : null;
}
async function mkRead() {
  if (!MK.images.length) return;
  const run = MK.run = {};
  MK.err = ''; MK.step = 'reading'; OCR.i = 0; OCR.pass = 0; OCR.low = new Set(); OCR.n = Math.min(OCR_MAX, MK.images.length); renderMake();
  ocrShow('글자 읽는 도구 준비 중', 0.03);
  try {
    await ocrWorker();
    const dict = await ocrDict();
    if (MK.run !== run) return;
    const lines = [], snips = new Map(); let raw = '';
    const slowT = setTimeout(() => { const s = $('#ocrslow'); if (s && MK.run === run) s.hidden = false; }, 75000);
    for (let i = 0; i < OCR.n; i++) {
      OCR.boxes = new Map();
      OCR.i = i; OCR.pass = 0; ocrShow(`사진 ${i + 1}/${OCR.n} 읽는 중`, 0.3 + 0.7 * i / OCR.n);
      let c = await ocrImage(MK.images[i].file);
      if (MK.run !== run) return;
      // 영어 먼저: 사전식 쪽(큰 표제어 + 오른쪽 뜻)이면 표제어마다 뜻 자리만 따로 읽고 끝 (한국어 전체 읽기는 건너뜀)
      let r2 = await OCR.eng.recognize(c.plain || c, {}, { text: true, blocks: true });
      if (MK.run !== run) return;
      // 옆으로 눕거나 거꾸로 찍힌 사진(사진 정보에 방향이 없을 때): 영어 낱말이 거의 안 읽힐 때만 작게 줄여 90°·270°·180°로 돌려 보고
      // 가장 잘 읽히는 방향으로 다시 읽음. 바로 찍힌 사진은 이 단계를 건너뛰어서 느려지지 않아요
      if (ocrDictHits(r2.data, dict) < 4) {
        ocrShow('사진 방향 확인 중', 0.3 + 0.7 * (i + 0.2) / OCR.n);
        let best = { n: ocrDictHits(r2.data, dict) * 1.5, deg: 0 };
        for (const deg of [90, 270, 180]) {
          const t = ocrTurn(c, deg, 1400), rr = await OCR.eng.recognize(t, {}, { text: true, blocks: true });
          if (MK.run !== run) return;
          const n = ocrDictHits(rr.data, dict); if (n > best.n) best = { n, deg };
        }
        if (best.deg) { c = ocrTurn(c, best.deg); r2 = await OCR.eng.recognize(c, {}, { text: true, blocks: true }); if (MK.run !== run) return; }
      }
      OCR.pass = 1;
      raw += ((r2.data && r2.data.text) || '') + '\n';
      const keepSnips = () => { for (const [en, b] of OCR.boxes) if (!snips.has(en)) { const u = ocrSnip(c.plain || c, b); if (u) snips.set(en, u); } };
      const dictRows = await ocrDictPage(c, ocrWords(r2.data), dict, await koLex(), run);
      if (MK.run !== run) return;
      if (dictRows) { keepSnips(); lines.push(...dictRows); continue; }
      const r1 = await OCR.worker.recognize(c, {}, { text: true, blocks: true });
      if (MK.run !== run) return;
      raw += ((r1.data && r1.data.text) || '') + '\n';
      OCR.boxes = new Map();
      const pairs = ocrPairs(ocrMerge(ocrWords(r1.data), ocrWords(r2.data), dict), dict, ocrSlope(r1.data, r2.data));
      keepSnips();
      // 위치로 짝을 못 지으면 글자만으로
      lines.push(...(pairs.length ? pairs : ocrTidy((r1.data && r1.data.text) || '').split('\n')));
    }
    const tidy = ocrTidy(lines.join('\n'));
    const L = await koLex();
    const parsed = mkParse(tidy).map(r => Object.assign(r, { ko: ocrKo(r.ko) }));
    clearTimeout(slowT); OCR.boxes = null;
    const rows = mkDedupe(parsed.filter(ocrRowOk)).map(r => ocrCheckRow(r, dict, L)).filter(Boolean);
    // 확인 화면: 줄마다 사진 속 원래 줄을 함께 보여 줌 (영어 단어로 찾음)
    for (const r of rows) { const k = r.en.toLowerCase(); r.snip = snips.get(k) || snips.get(k.split(' ')[0]) || ''; }
    MK.paste = tidy;
    const day = (raw + '\n' + tidy).match(/\b(day|unit|lesson)\s*0*(\d{1,3})\b/i);
    if (day && !mkCleanKo(MK.name)) MK.name = day[1][0].toUpperCase() + day[1].slice(1).toLowerCase() + ' ' + day[2].padStart(2, '0');
    if (!rows.length) {
      MK.step = 'pick'; MK.pasteOpen = true;
      MK.err = '사진에서 ‘영어 단어 + 한글 뜻’ 줄을 찾지 못했어요. 아래 칸에 읽은 글자를 넣어 두었으니 고쳐서 ‘이 단어들로 확인하기’를 눌러 주세요.';
    } else {
      MK.rows = rows.slice(0, MK_MAX); MK.step = 'review';
      voiceWarm(); // 단어를 확인하는 동안 목소리를 미리 준비 (단어장을 다 만든 뒤 받기 시작하면 첫 이야기 줄이 늦게 나와요)
      const nf = rows.filter(r => r.flag).length;
      MK.note = `사진에서 ${rows.length}단어를 읽었어요.` + (nf ? ` 그중 ${nf}개는 빨간 칸으로 표시했어요. 꼭 확인하고 고쳐 주세요.` : ' 틀린 글자가 없는지 한 번 훑어봐 주세요.') + (rows.length > MK_MAX ? ` 앞의 ${MK_MAX}개만 가져왔어요.` : '');
    }
  } catch (e) {
    OCR.boxes = null;
    if (MK.run !== run) return;
    MK.step = 'pick';
    MK.err = e && e.code === 'ocr_load' ? '글자 읽는 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (처음 한 번 약 9MB를 받아요)' : e && e.code === 'image_rejected' ? '사진을 열 수 없어요. JPG·PNG 사진으로 해 주세요.' : '사진을 읽지 못했어요. 다른 사진으로 하거나 단어를 직접 입력해 주세요.';
    ocrStop();
  }
  MK.run = null;
  renderMake();
}

