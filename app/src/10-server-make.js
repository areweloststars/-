/* ================= 이야기 서버로 만들기: 묶음은 사람이 골라요 (2026-11-16 사용자가 정함) =================
   AI는 자연스러운 묶음을 스스로 가려내지 못했어요 (가려내기 시험 4/11, 3/13). 그래서:
   1) 이야기 서버(/group, 4개씩)를 SV_ROUNDS번 불러 후보 묶음을 모아요.
   2) 사용자가 '어울려요'라고 고른 묶음만 이야기(/story, 그 장면대로)로 써요.
   3) 고르지 않은 단어는 이야기 없이 단어 미션으로만 넣어요.
   서버로는 단어 글자(영어·뜻·품사)와 서버가 쓴 글(장면·생각 메모)만 보내요. 사진은 보내지 않아요.
   서버 주소·열쇠는 이 기기에만 저장해요 (localStorage 'wg-srv'). 저장소·사이트 파일에는 없어요. */
const SV_KEY = 'wg-srv', SV_ROUNDS = 3, SV_KEEP = 2, SV_NOTES = 20000;
const SRV = { cands: [], picked: new Set(), rows: null, form: false, note: '', neurons: 0 };
function svConf() {
  try { const c = JSON.parse(localStorage.getItem(SV_KEY) || 'null'); return c && typeof c.api === 'string' && typeof c.token === 'string' && c.api && c.token ? c : null; } catch (e) { return null; }
}
// 주소는 https만 (끝의 /는 떼요). 잘못됐으면 까닭 글
function svSave(api, token) {
  api = String(api || '').trim().replace(/\/+$/, ''); token = String(token || '').trim();
  if (api && !/^https?:\/\//i.test(api)) api = 'https://' + api;
  let u = null; try { u = new URL(api); } catch (e) { /* 아래에서 */ }
  if (!u || u.protocol !== 'https:') return '서버 주소가 맞지 않아요. https://로 시작하는 주소를 넣어 주세요.';
  if (token.length < 8 || /\s/.test(token)) return '서버 열쇠가 맞지 않아요.';
  try { localStorage.setItem(SV_KEY, JSON.stringify({ api: u.origin + u.pathname.replace(/\/+$/, ''), token })); } catch (e) { return '이 기기에 저장하지 못했어요 (저장 공간).'; }
  return '';
}
// 흘려 받기 글: 답 글(content)·생각 글(reasoning)·쓴 양(usage)
function svSSE(raw) {
  let text = '', reasoning = '', usage = null, err = '';
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/^data:\s?(.*)$/), d = m && m[1].trim();
    if (!d || d === '[DONE]') continue;
    let j; try { j = JSON.parse(d); } catch (e) { continue; }
    if (j.error || j.errors) err = JSON.stringify(j.error || j.errors).slice(0, 200);
    const c = j.choices && j.choices[0], dl = c && (c.delta || c.message);
    if (dl) { if (typeof dl.content === 'string') text += dl.content; reasoning += String(dl.reasoning_content || dl.reasoning || ''); }
    else if (typeof j.response === 'string') text += j.response;
    if (j.usage) usage = j.usage;
  }
  return { text, reasoning, usage, err };
}
function svJSON(t) {
  const s = String(t || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const body = s.slice(a, b + 1);
  for (const c of [body, body.replace(/,\s*([}\]])/g, '$1')]) { try { return JSON.parse(c); } catch (e) { /* 다음 */ } }
  return null;
}
// 답 나누기: '제목:', '줄거리:', '이야기:', '그림:' (굵게 표시·번호·글머리표를 떼요)
function svParse(text) {
  const ls = String(text || '').split('\n').map(s => s.replace(/\*\*/g, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim()).filter(Boolean);
  const out = { title: '', plan: '', lines: [], pics: [] };
  let part = '';
  for (const l of ls) {
    let m;
    if ((m = l.match(/^제목\s*[:：]\s*(.*)$/))) { out.title = m[1].replace(/^[‘'“"]|[’'”"]$/g, '').trim(); part = ''; continue; }
    if ((m = l.match(/^줄거리\s*[:：]\s*(.*)$/))) { out.plan = m[1].trim(); part = ''; continue; }
    if ((m = l.match(/^이야기\s*[:：]\s*(.*)$/))) { part = 'story'; if (m[1]) out.lines.push(m[1]); continue; }
    if ((m = l.match(/^그림\s*[:：]\s*(.*)$/))) { part = 'pic'; if (m[1]) out.pics.push(m[1]); continue; }
    if (part === 'story') out.lines.push(l);
    else if (part === 'pic') out.pics.push(l);
  }
  out.pics = out.pics.map(l => { const m = l.match(/^([^:：]{1,30}?)\s*[:：]\s*(.+)$/); return m ? { key: m[1].trim(), text: m[2].trim() } : { key: '', text: l }; });
  return out;
}
// 답이 쓸모없는지: 묶음은 groups가 없으면, 이야기는 이야기 줄이 3줄이 안 되면
const svUseless = (route, t) => (route === '/group' ? !(((svJSON(t) || {}).groups) || []).length : svParse(t).lines.length < 3);
// 한 번 묻기. 답이 비면(120초에서 끊김) cut 오류에 그때까지의 생각 글을 실어요
async function svPost(route, body, signal) {
  const c = svConf(); if (!c) throw { text: '이야기 서버 주소와 열쇠를 먼저 넣어 주세요.' };
  let r;
  try { r = await fetch(c.api + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.token }, body: JSON.stringify(body), signal }); }
  catch (e) { if (signal && signal.aborted) throw { code: 'cancelled' }; throw { net: true, text: '이야기 서버에 연결하지 못했어요. 인터넷과 서버 주소를 확인해 주세요.' }; }
  if (r.ok && /event-stream/i.test(r.headers.get('content-type') || '')) {
    let raw = ''; try { raw = await r.text(); } catch (e) { if (signal && signal.aborted) throw { code: 'cancelled' }; }
    const s = svSSE(raw);
    if (s.usage && s.usage.neurons != null) SRV.neurons += +s.usage.neurons || 0;
    // 생각 끔이면 Nemotron의 답 글이 생각 칸으로 와요
    if (!s.text.trim() && body.effort === 'none' && s.reasoning.trim()) { s.text = s.reasoning; s.reasoning = ''; }
    if (!s.text.trim()) throw { cut: true, reasoning: s.reasoning, text: '이야기 서버의 답이 중간에 끊겼어요.' };
    return { text: s.text.trim(), reasoning: s.reasoning };
  }
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) throw { stop: true, text: '오늘 이야기 서버의 무료 한도를 다 썼어요. 내일 오전 9시 뒤에 다시 해 주세요.' };
  if (r.status === 401 || r.status === 403) throw { text: '이야기 서버가 열쇠를 받아 주지 않았어요. 서버 주소와 열쇠를 다시 넣어 주세요.', auth: true };
  if (!r.ok) throw { text: `이야기 서버 오류 (${r.status}): ${String(j.error || '').slice(0, 120)}` };
  return { text: String(j.text || ''), reasoning: '' };
}
// 묻기 + 이어 생각하기: 끊기면 그때까지의 생각 글을 메모로 주고 생각을 켠 채 SV_KEEP번까지, 그래도 끊기면 생각 끔으로 메모대로
async function svAsk(route, body, signal) {
  let notes = '';
  const add = t => { notes = (notes + '\n\n' + String(t || '')).trim().slice(-SV_NOTES).trim(); };
  for (let k = 0; k <= SV_KEEP + 1; k++) {
    const last = k === SV_KEEP + 1;
    if (k && !notes) throw { text: '이야기 서버의 답이 끊겼고 이어 쓸 생각 글도 없어요.' };
    try {
      const x = await svPost(route, { ...body, ...(k ? { notes } : {}), ...(last ? { effort: 'none' } : {}) }, signal);
      if (!svUseless(route, x.text)) return x;
      if (last) throw { text: '이야기 서버가 쓸 수 있는 답을 주지 않았어요.' };
      add(x.reasoning || x.text);
    } catch (e) {
      if (!e || !e.cut || last) throw e;
      add(e.reasoning);
    }
  }
}
const svWordsOf = rows0 => rows0.map(r => [r.en, r.ko, r.pos]);
// 답의 묶음 읽기: 이 단어장 단어만, 한 묶음에 4~5개, 단어마다 일(event)이 있는 것만 후보로
function svReadGroups(j, byLow) {
  const out = [];
  for (const g of (j && Array.isArray(j.groups) ? j.groups : [])) {
    const ws = [], seen = new Set();
    for (const x of (g && Array.isArray(g.words) ? g.words : [])) {
      const en = byLow[String((x && (x.word != null ? x.word : x)) || '').trim().toLowerCase()], ev = String((x && x.event) || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      if (en && !seen.has(en) && ev) { seen.add(en); ws.push({ word: en, event: ev }); }
    }
    const scene = String((g && g.scene) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (scene && ws.length >= 4 && ws.length <= 5) out.push({ scene, words: ws });
  }
  return out;
}
const svKeyOf = g => g.words.map(x => x.word.toLowerCase()).sort().join(',');
const svShuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// 후보 묶음 모으기 (rounds번). 단어가 40개를 넘으면 40개씩 나눠 물어요 (서버 /group은 6~40개)
async function svCollect(rounds) {
  const nm = $('#mkname'); if (nm) MK.name = nm.value;
  const rows0 = mkValidRows();
  if (rows0.length < 6 || rows0.length > MK_MAX) { MK.err = rows0.length < 6 ? '이야기 서버로 묶으려면 단어가 6개 이상 필요해요.' : `${MK_MAX}단어까지만 만들 수 있어요.`; renderMake(); return; }
  if (!svConf()) { SRV.form = true; renderMake(); return; }
  const fresh = !SRV.rows || SRV.rows.map(r => r.en + '|' + r.ko).join('\n') !== rows0.map(r => r.en + '|' + r.ko).join('\n');
  if (fresh) { SRV.cands = []; SRV.picked = new Set(); SRV.neurons = 0; }
  SRV.rows = rows0; SRV.note = '';
  const byLow = Object.create(null); for (const r of rows0) byLow[r.en.toLowerCase()] = r.en;
  const ctl = MK.ctl = new AbortController();
  MK.err = ''; MK.fail = false; MK.log = []; MK.step = 'making'; MK.sv = 'group'; renderMake();
  const have = new Set(SRV.cands.map(svKeyOf));
  try {
    wakeHold('make');
    for (let k = 0; k < rounds; k++) {
      const li = mkLog(`묶음 후보 만드는 중 (${k + 1}/${rounds})`);
      try {
        const list = svShuffle(svWordsOf(rows0)), parts = [];
        const n = Math.ceil(list.length / 40); for (let i = 0; i < n; i++) parts.push(list.slice(Math.round(i * list.length / n), Math.round((i + 1) * list.length / n)));
        let got = 0;
        for (const part of parts) {
          if (part.length < 6) continue;
          const x = await svAsk('/group', { words: part, effort: 'medium', stream: true, size: 4 }, ctl.signal);
          for (const g of svReadGroups(svJSON(x.text), byLow)) { const key = svKeyOf(g); if (!have.has(key)) { have.add(key); SRV.cands.push(g); got++; } }
        }
        mkLogSet(li, 'ok', `묶음 후보 ${k + 1}/${rounds}: 새 후보 ${got}개`);
      } catch (e) {
        if (e && (e.code === 'cancelled' || e.stop || e.auth || e.net)) { mkLogSet(li, 'warn', `묶음 후보 ${k + 1}/${rounds}: 멈췄어요`); throw e; }
        mkLogSet(li, 'warn', `묶음 후보 ${k + 1}/${rounds}: 이번에는 받지 못했어요`);
      }
    }
    if (!SRV.cands.length) throw { text: '이야기 서버가 묶음 후보를 주지 않았어요. 잠시 뒤에 다시 해 주세요.' };
    MK.step = 'srvpick';
  } catch (e) {
    const why = e && e.code === 'cancelled' ? '만들기를 멈췄어요.' : (e && e.text) || '이야기 서버에서 오류가 났어요.';
    if (e && e.auth) SRV.form = true;
    // 받은 후보가 있으면 그것으로 고르게 해요
    if (SRV.cands.length && !(e && e.auth)) { MK.step = 'srvpick'; SRV.note = why + ' 지금까지 받은 후보를 보여 드려요.'; }
    else { MK.step = 'review'; MK.err = why; }
  } finally { wakeFree('make'); MK.sv = ''; }
  if ($('#make').hidden && MK.step === 'srvpick') toast('묶음 후보가 준비됐어요. ‘새 단어장 만들기’에서 골라 주세요');
  if (!$('#make').hidden) renderMake();
}
// 고른 묶음과 단어가 겹치는 후보는 함께 고를 수 없어요
function svClash(i) {
  const mine = new Set(SRV.cands[i].words.map(x => x.word));
  for (const j of SRV.picked) if (j !== i && SRV.cands[j].words.some(x => mine.has(x.word))) return true;
  return false;
}
function svCountText() {
  const used = new Set(); for (const i of SRV.picked) SRV.cands[i].words.forEach(x => used.add(x.word));
  const all = (SRV.rows || []).length;
  return SRV.picked.size ? `고른 묶음 ${SRV.picked.size}개 (이야기 ${SRV.picked.size}편) · 단어 ${used.size}개 · 이야기 없이 넣는 단어 ${all - used.size}개` : '어울리는 묶음을 눌러서 골라 주세요';
}
function svPickHTML() {
  const ko = Object.create(null); for (const r of SRV.rows || []) ko[r.en] = r.ko;
  const cards = SRV.cands.map((g, i) => {
    const on = SRV.picked.has(i), off = !on && svClash(i);
    return `<button type="button" class="svcand${on ? ' on' : ''}${off ? ' off' : ''}" data-mk="svtog" data-i="${i}" aria-pressed="${on}"${off ? ' disabled' : ''}>
      <b class="svscene">${on ? '✔ ' : ''}${esc(g.scene)}</b>
      <span class="svwords">${g.words.map(x => `<span class="svw"><b>${esc(x.word)}</b> ${esc(ko[x.word] || '')}<small>${esc(x.event)}</small></span>`).join('')}</span>
      ${off ? '<small class="svoff">고른 묶음과 단어가 겹쳐요</small>' : ''}</button>`;
  }).join('');
  return `${SRV.note ? `<p class="mknote">${esc(SRV.note)}</p>` : ''}
    <p class="mksmall"><b>실제로 있을 법한 상황이고 단어가 그 상황에 잘 맞는 묶음</b>만 눌러서 골라 주세요. 고른 묶음만 이야기로 써요. 고르지 않은 단어는 이야기 없이 단어 미션으로 넣어요.</p>
    <div class="svcands">${cards}</div>
    <p class="mkcount" id="svcount">${esc(svCountText())}</p>
    <button type="button" class="startbtn" data-mk="svmake"${SRV.picked.size ? '' : ' disabled'}>${ICON.play}고른 묶음으로 이야기 만들기</button>
    <button type="button" class="btn" data-mk="svmore">후보 더 만들기 (1번 더)</button>
    <button type="button" class="linkbtn" data-mk="svback">단어 고치러 돌아가기</button>
    <p class="mksmall">이야기 한 편에 2~8분쯤 걸려요. 하루 무료 한도 안에서 6편쯤 쓸 수 있어요.${SRV.neurons ? ` (지금까지 쓴 양: 약 ${Math.round(SRV.neurons).toLocaleString()} / 10,000)` : ''}</p>`;
}
// 확인 화면의 이야기 서버 칸: 주소·열쇠를 넣지 않았으면 넣는 칸, 넣었으면 시작 단추
function svReviewHTML() {
  if (MK.redo) return '';
  const c = svConf(), n = mkValidRows().length, ok = n >= 6 && n <= MK_MAX;
  if (!c || SRV.form) return `<div class="mknote svbox"><b>이야기 서버로 만들기</b> (묶음을 직접 골라요)<br><small>서버 주소와 열쇠는 이 기기에만 저장해요. 서버로는 단어 글자(영어·뜻·품사)만 보내고, 사진은 보내지 않아요.</small>
    <label class="mklab">서버 주소<input id="svapi" value="${esc(c ? c.api : '')}" placeholder="https://…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <label class="mklab">서버 열쇠<input id="svtok" type="password" value="" placeholder="${c ? '바꾸려면 새 열쇠를 넣어요' : '열쇠'}" autocomplete="off"></label>
    <button type="button" class="btn" data-mk="svsave">이 기기에 저장</button>${c ? ' <button type="button" class="linkbtn" data-mk="svcancel">닫기</button>' : ''}</div>`;
  return `<div class="mknote svbox"><b>이야기 서버로 만들기</b> (묶음을 직접 골라요)<br><small>서버가 묶음 후보를 ${SV_ROUNDS}번 만들어요 (5~20분). 그 가운데 어울리는 묶음만 고르면 그 묶음으로 이야기를 써요. 서버로는 단어 글자만 보내요.</small><br>
    <button type="button" class="btn good" data-mk="svgo"${ok ? '' : ' disabled'}>${ICON.play}묶음 후보 만들기</button>
    ${SRV.cands.length && SRV.rows ? '<button type="button" class="btn" data-mk="svshow">받아 둔 후보 보기</button>' : ''}
    <button type="button" class="linkbtn" data-mk="svedit">서버 주소·열쇠 바꾸기</button></div>`;
}
// 표시 붙이기: 서버 plain 꼴은 {영어|뜻} 표시 없이 와요. 표시가 없는 줄에서 aiMark로 뜻 자리를 찾아 붙여요 (가운데 줄 먼저, 한 줄에 단어 하나)
function svRetag(words, lines) {
  const TAG = /\{([^{|}]+)\|([^{|}]+)\}/g, out = lines.slice();
  const pref = [...out.keys()].slice(1, -1).concat(out.length > 1 ? [0, out.length - 1] : [0]);
  const need = words.filter(([en]) => !out.some(l => [...l.matchAll(TAG)].some(m => m[1].trim().toLowerCase() === en.toLowerCase())))
    .map(([en, ko, pos]) => {
      const lex = stLex(en, { en, ko, pos }, SF[0]), cand = [];
      for (const i of pref) { if (/\{[^{|}]+\|[^{|}]+\}/.test(out[i])) continue; const m = aiMark(out[i], en, lex, ko); if (m) cand.push([i, m]); }
      return { en, cand };
    }).sort((a, b) => a.cand.length - b.cand.length);
  let best = [], cur = [];
  const used = new Set();
  const go = k => {
    if (cur.length + (need.length - k) <= best.length) return;
    if (k === need.length) { best = cur.slice(); return; }
    for (const [i, m] of need[k].cand) if (!used.has(i)) { used.add(i); cur.push([need[k].en, i, m]); go(k + 1); cur.pop(); used.delete(i); }
    go(k + 1);
  };
  go(0);
  for (const [, i, m] of best) out[i] = m;
  return out;
}
// 서버 이야기 글 → mkEpisode가 받는 꼴 {title, lines, words: {영어: {pic}}}
function svStoryRes(text, words) {
  const o = svParse(text), lines = svRetag(words, o.lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  const byKey = Object.create(null);
  for (const [en, ko] of words) { byKey[en.toLowerCase()] = en; byKey[String(ko).replace(/\s+/g, '')] = en; }
  const info = {};
  for (const pc of o.pics) { const en = byKey[pc.key.toLowerCase()] || byKey[pc.key.replace(/\s+/g, '')]; if (en && !info[en]) info[en] = { pic: pc.text }; }
  const tagged = words.filter(([en]) => lines.some(l => l.toLowerCase().includes('{' + en.toLowerCase() + '|'))).length;
  return { title: o.title, lines, words: info, tagged };
}
const svSceneText = g => `장면: ${g.scene}\n` + g.words.map(x => `- ${x.word}: ${x.event}`).join('\n');
// 고른 묶음으로 단어장 만들기: 묶음마다 이야기 한 편, 고르지 않은 단어는 이야기 없이
async function svMake() {
  const rows0 = SRV.rows || [], picks = [...SRV.picked].sort((a, b) => a - b).map(i => SRV.cands[i]);
  if (!picks.length) return;
  const rows = Object.create(null); for (const r of rows0) rows[r.en] = r;
  const ctl = MK.ctl = new AbortController(), id = 'u' + Date.now().toString(36);
  MK.err = ''; MK.fail = false; MK.log = []; MK.step = 'making'; MK.sv = 'story'; MK.saveNote = ''; MK.aiNote = ''; MK.aiDiag = null; MK.aiEnv = ''; mkPicN = 0;
  const deck = { v: 1, id, name: mkCleanKo(MK.name) || `새 단어장 ${new Date().getMonth() + 1}/${new Date().getDate()}`, created: Date.now(), updated: Date.now(), source: MK.images.length ? 'photo' : 'text', words: {}, scenes: [], panels: {} };
  renderMake();
  const used = new Set(), plain = [];
  let stop = '', n = 0, done = 0;
  const push = (title, ws, res) => {
    const key = `${id}-e${++n}`, out = mkEpisode(key, title, ws, rows, res);
    deck.scenes.push(out.scene); Object.assign(deck.words, out.words); deck.panels[key] = out.specs;
  };
  try {
    wakeHold('make');
    for (let k = 0; k < picks.length; k++) {
      const g = picks[k], ws = g.words.map(x => x.word).filter(w => rows[w] && !used.has(w));
      if (ws.length < 3) continue;
      ws.forEach(w => used.add(w));
      if (stop) { plain.push(...ws); continue; }
      const li = mkLog(`이야기 ${k + 1}/${picks.length} 쓰는 중: ${g.scene.slice(0, 30)}`);
      try {
        const words = ws.map(w => [w, rows[w].ko, rows[w].pos]);
        const x = await svAsk('/story', { words, effort: 'medium', format: 'plain', stream: true, scene: svSceneText({ scene: g.scene, words: g.words.filter(y => ws.includes(y.word)) }).slice(0, 3000) }, ctl.signal);
        const res = svStoryRes(x.text, words);
        // 단어 절반 이상이 이야기 줄에 들어가야 이야기로 써요
        if (res.lines.length < 3 || res.tagged * 2 < ws.length) throw { text: '이야기에 단어가 잘 들어가지 않았어요.' };
        push(res.title || `이야기 ${k + 1}`, ws, res); done++;
        mkLogSet(li, 'ok', `이야기 ${k + 1} ‘${res.title || ''}’ 완성`);
      } catch (e) {
        if (e && e.code === 'cancelled') throw e;
        if (e && (e.stop || e.auth || e.net)) stop = e.text;
        plain.push(...ws);
        mkLogSet(li, 'warn', `이야기 ${k + 1}: 쓰지 못해서 이야기 없이 넣어요${e && e.text ? ` (${e.text.slice(0, 60)})` : ''}`);
      }
    }
    // 고르지 않은 단어·이야기를 못 쓴 단어: 이야기 없이 단어 미션으로
    const rest = plain.concat(rows0.map(r => r.en).filter(w => !used.has(w)));
    mkChunk(rest).forEach((ws, i) => push(`단어 미션 ${i + 1}`, ws, null));
    deck.scenes = deck.scenes.filter(sc => sc.words.length);
    if (!deck.scenes.length) throw { code: 'empty_completion' };
    const saved = await DeckStore.put(deck);
    MK.aiNote = `이야기 서버가 고른 묶음 ${picks.length}개 가운데 ${done}편을 썼어요.${rest.length ? ` 단어 ${rest.length}개는 이야기 없이 넣었어요.` : ''}${stop ? ' ' + stop : ''}`;
    MK.saveNote = saved.cloud ? '내 Claude 계정에도 저장했어요. 다른 기기에서 이 앱을 열어도 보여요.' : saved.local ? '이 기기에 저장했어요.' : '저장 공간이 없어 이번 방문 동안만 쓸 수 있어요.';
    MK.deck = deck; MK.step = 'done'; MK.images.forEach(im => URL.revokeObjectURL(im.url)); MK.images = []; MK.rows = []; MK.name = ''; MK.paste = ''; MK.note = '';
    SRV.cands = []; SRV.picked = new Set(); SRV.rows = null;
    Sound.play('project'); voiceWarm();
    if ($('#make').hidden) toast(`‘${deck.name}’ 단어장이 완성됐어요! 홈 위 단어장 단추에서 골라요`);
  } catch (e) {
    MK.step = 'srvpick'; SRV.note = e && e.code === 'cancelled' ? '만들기를 멈췄어요. 고른 묶음은 그대로 있어요.' : (e && e.text) || mkErrText(e) || '만들지 못했어요.';
  } finally { wakeFree('make'); MK.sv = ''; }
  if (!$('#make').hidden) renderMake();
}
// 만들기 화면의 이야기 서버 단추들
function svClick(a, b) {
  if (a === 'svsave') {
    const cur = svConf(), api = ($('#svapi') || {}).value, tok = ($('#svtok') || {}).value || (cur ? cur.token : '');
    const nm = $('#mkname'); if (nm) MK.name = nm.value;
    const err = svSave(api, tok);
    if (err) { toast(err); return; }
    SRV.form = false; MK.err = ''; toast('이 기기에 저장했어요'); renderMake();
  }
  else if (a === 'svedit' || a === 'svcancel') { const nm = $('#mkname'); if (nm) MK.name = nm.value; SRV.form = a === 'svedit'; renderMake(); }
  else if (a === 'svgo') { if (MK.benchCtl) { toast('AI 진단 중이에요. 끝난 뒤에 해 주세요'); return; } svCollect(SV_ROUNDS); }
  else if (a === 'svmore') svCollect(1);
  else if (a === 'svshow') { MK.err = ''; MK.step = 'srvpick'; renderMake(); }
  else if (a === 'svback') { MK.step = 'review'; renderMake(); }
  else if (a === 'svtog') {
    const i = +b.dataset.i; if (!SRV.cands[i]) return;
    if (SRV.picked.has(i)) SRV.picked.delete(i); else if (!svClash(i)) SRV.picked.add(i);
    const y = window.scrollY; renderMake(); window.scrollTo(0, y);
  }
  else if (a === 'svmake') svMake();
}
