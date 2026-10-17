/* ================= 사진으로 새 단어장 만들기 =================
   1) 단어장 사진 → 이 기기 안에서 글자 인식(OCR)으로 영어 단어와 뜻을 읽음 (API 없이)  2) 학생이 확인·수정
   3) 바로 만들기: 단어를 에피소드로 나누고, 뜻을 보고 그림 칸(이모지·사람·동물)을 자동으로 골라 게임으로
      (Claude를 쓸 수 있는 화면에서는 고르면 이야기·팁·예문까지 Claude가 써 줌) */
const MK = { useAI: false, run: null, step: 'pick', images: [], rows: [], name: '', ctl: null, err: '', note: '', log: [], sample: null, caps: null, ready: false, deck: null, paste: '', pasteOpen: null };
const MK_MIN = 4, MK_MAX = 80;
const POS_KEYS = ['n', 'v', 'a', 'd', 'p', 'x'];

async function mkInit() {
  try {
    if (!window.claude || typeof claude.use !== 'function') return;
    MK.sample = await claude.use('sample');
    if (MK.sample && MK.sample.limits) MK.caps = await MK.sample.limits().catch(() => null);
  } catch (e) { MK.sample = null; }
  finally { MK.ready = true; if (!$('#make').hidden) renderMake(); }
}
const mkCanAI = () => !!MK.sample;
const mkCanPhoto = () => !!(MK.sample && MK.caps && MK.caps.images);
// Claude 호출 실패를 학생에게 보일 말로
function mkErrText(e) {
  const c = e && e.code;
  if (c === 'cancelled') return '';
  if (c === 'not_granted' || c === 'sampling_disabled' || c === 'not_declared' || c === 'capability_disabled' || c === 'capability_removed') { MK.sample = null; return 'Claude 사용이 허락되지 않아서 자동으로 만들 수 없어요. 단어를 직접 입력하면 간단한 단어장으로 만들 수 있어요.'; }
  if (c === 'images_unavailable') { MK.caps = null; return '이 화면에서는 사진을 보낼 수 없어요. 단어를 직접 입력해 주세요.'; }
  if (c === 'image_rejected') return '사진을 읽을 수 없어요. 다른 사진(JPG·PNG)으로 해 주세요.';
  if (c === 'rate_limited') return 'Claude 사용량이 잠깐 많아요. 조금 뒤에 다시 눌러 주세요.';
  if (c === 'session_expired') return '로그인이 끝났어요. 다시 로그인한 뒤 해 주세요.';
  if (c === 'refused') return 'Claude가 이 내용은 만들 수 없다고 했어요. 단어를 조금 바꿔서 다시 해 보세요.';
  if (c === 'invalid_json' || c === 'empty_completion') return '답을 제대로 받지 못했어요. 다시 눌러 주세요.';
  if (c === 'prompt_too_large') return '단어가 너무 많아요. 단어 수를 줄여서 해 주세요.';
  return '잠깐 연결이 불안정해요. 다시 눌러 주세요.';
}
// 품사 표시(n. v. adj. …)와 발음기호([ˈ…], /…/)는 단어·뜻에서 뺌
const POS_TOK = /(^|\s)\(?(?:n|v|a|adj|adv|ad|prep|conj|vt|vi|pron|int)\.\)?(?=\s|$)/gi;
const IPA_TOK = /\[[^\]가-힣]*\]|\/[^/\s가-힣][^/가-힣]{0,30}\//g;
function mkCleanEn(s) { return String(s || '').replace(IPA_TOK, ' ').replace(POS_TOK, ' ').replace(/[{}|<>"]/g, '').replace(/\s+/g, ' ').replace(/^[\s\-–—:=~.,]+|[\s\-–—:=~.,]+$/g, '').trim().slice(0, 40); }
// 뜻 맨 앞의 '-'는 '-하는 것을'처럼 한글 바로 앞에 붙은 자리 표시면 남김
function mkCleanKo(s) { return String(s || '').replace(IPA_TOK, ' ').replace(POS_TOK, ' ').replace(/[{}|<>]/g, '').replace(/\s+/g, ' ').replace(/^(?:[\s–—:=.,]|-(?![가-힣]))+|[\s\-–—:=,]+$/g, '').trim().slice(0, 60); }
// 쓸 수 있는 줄: 영어와 (글자가 있는) 뜻이 다 있음
const mkRowOk = r => !!(mkCleanEn(r.en) && mkCleanKo(r.ko) && mkAnsFrom(null, mkCleanKo(r.ko)).length);
const mkValidRows = () => mkDedupe(MK.rows).filter(mkRowOk);

/* ---------- 화면 ---------- */
function openMake() {
  closeOverlay();
  if (MK.step === 'making') { showScreen('make'); renderMake(); return; }
  if (MK.step === 'done' && !MK.deck) MK.step = 'pick'; // 완성된 단어장이 있으면 완성 화면을 다시 보여 줌
  showScreen('make'); renderMake();
}
function renderMake() {
  const el = $('#make'); if (!el) return;
  const head = `<div class="topbar"><button type="button" class="iconbtn" data-mk="home" aria-label="미션 목록으로">${ICON.back}</button><span class="toplab">NEW WORD BOOK</span></div><h2 class="stitle">사진으로 새 단어장 만들기</h2>`;
  let body = '';
  if (MK.step === 'pick') body = mkPickHTML();
  else if (MK.step === 'reading') body = `<div class="mkwait ocr"><div class="spin" aria-hidden="true"></div><p><b>사진 속 단어를 읽고 있어요</b><br><small id="ocrlab">글자 읽는 도구 준비 중</small></p><button type="button" class="btn" data-mk="stop">그만두기</button><div class="ocrbar" aria-hidden="true"><i id="ocrbar"></i></div></div><p class="mksmall mkslow" id="ocrslow" hidden>오래 걸리고 있어요. 사진이 흐리거나 기울었으면 ‘그만두기’를 누르고 더 밝고 가깝게 다시 찍어 보세요. 단어를 직접 입력해도 돼요.</p><p class="mksmall">사진은 이 기기 안에서만 읽어요. 어디에도 보내지 않아요.</p>`;
  else if (MK.step === 'review') body = mkReviewHTML();
  else if (MK.step === 'making') body = mkMakingHTML();
  else if (MK.step === 'done') body = mkDoneHTML();
  el.innerHTML = head + (MK.err ? `<p class="mkerr" role="alert">${esc(MK.err)}</p>` : '') + body;
  if (MK.step === 'review') mkBindRows();
}
function mkPickHTML() {
  const thumbs = MK.images.map((im, i) => `<div class="mkimg"><img src="${im.url}" alt="고른 사진 ${i + 1}"><button type="button" data-mk="rmimg" data-i="${i}" aria-label="사진 ${i + 1} 빼기">${ICON.close}</button></div>`).join('');
  return `
    <ol class="mksteps"><li><b>사진</b> 단어장 쪽을 찍어요</li><li><b>확인</b> 읽은 단어와 뜻을 고쳐요</li><li><b>완성</b> 그림·미션이 바로 생겨요</li></ol>
    <p class="mksmall mkcopy">사진과 읽은 단어는 이 기기에만 저장되고 어디에도 올리지 않아요. 교재 내용은 출판사의 저작물이라, 직접 가진 교재로 혼자 공부할 때만 쓰고 만든 단어장을 다른 사람과 나누거나 인터넷에 올리지 마세요.</p>
    <div class="mkpick">
      <label class="btn good mkbtn">${ICON.camera}<span>사진 찍기</span><input class="mkfile" type="file" accept="image/*" capture="environment" data-mkfile="1" aria-label="사진 찍기"></label>
      <label class="btn mkbtn">${ICON.pic}<span>앨범에서 고르기</span><input class="mkfile" type="file" accept="image/*" multiple data-mkfile="1" aria-label="앨범에서 고르기"></label>
    </div>
    <div class="mkdrop" id="mkdrop" contenteditable="true" role="textbox" aria-label="사진 붙여넣기" data-ph="사진 붙여넣기: 갤러리에서 사진을 ‘복사’한 뒤 여기를 길게 눌러 ‘붙여넣기’"></div>
    <details class="mkhelp"><summary>사진 버튼이 안 열려요</summary>
      <ol>
        <li><b>Claude 앱 안</b>에서는 휴대폰에 따라 사진 고르기 창이 안 열릴 수 있어요. 맨 위 <b>공유</b> 단추로 링크를 복사해 <b>Chrome·삼성 인터넷</b>에서 열면 잘 돼요.</li>
        <li>갤러리에서 사진을 <b>복사</b>해 위 점선 칸에 <b>붙여넣기</b> 해도 돼요.</li>
        <li>갤러리(구글 렌즈·삼성 ‘텍스트 추출’)로 사진 속 글자를 <b>복사</b>한 뒤, 아래 <b>단어 직접 입력·붙여넣기</b> 칸에 붙여넣어도 바로 단어장이 돼요.</li>
      </ol>
    </details>
    ${MK.images.length ? `<div class="mkimgs">${thumbs}</div><p class="mksmall">사진 ${MK.images.length}장 · 한 번에 ${OCR_MAX}장까지</p><button type="button" class="startbtn" data-mk="read">${ICON.play}사진 속 단어 읽기</button>` : '<p class="mksmall">‘영어 단어 + 한글 뜻’이 한 줄씩 나란히 있는 쪽을 <b>똑바로, 밝게</b> 찍으면 가장 잘 읽어요. 사진은 이 기기 안에서 읽고, 따로 API나 로그인이 필요 없어요.</p>'}
    <details class="mkpaste"${MK.pasteOpen ? ' open' : ''}><summary>${ICON.pen}단어 직접 입력·붙여넣기</summary>
      <p class="mksmall">한 줄에 하나씩 <b>영어 - 뜻</b> 모양으로 써요. 뜻이 여러 개면 쉼표로 나눠요.<br>예) explore - 탐험하다, 조사하다</p>
      <textarea id="mkpaste" rows="7" placeholder="explore - 탐험하다, 조사하다&#10;harvest - 수확">${esc(MK.paste)}</textarea>
      <button type="button" class="btn" data-mk="parse">이 단어들로 확인하기</button>
    </details>
    ${mkAiHTML()}`;
}
function mkReviewHTML() {
  const n = mkValidRows().length;
  const rows = MK.rows.map((r, i) => `<div class="mkrow${r.flag ? ' flag' : ''}" data-i="${i}"><input class="mken" value="${esc(r.en)}" placeholder="영어" aria-label="${i + 1}번 영어" autocapitalize="off" autocorrect="off" spellcheck="false"><input class="mkko" value="${esc(r.ko)}" placeholder="뜻 (쉼표로 여러 개)" aria-label="${i + 1}번 뜻"><button type="button" data-mk="rmrow" data-i="${i}" aria-label="${i + 1}번 지우기">${ICON.close}</button>${r.snip ? `<img class="mksnip" src="${r.snip}" alt="${i + 1}번 줄의 사진 속 원래 모습">` : ''}${r.flag && OCR_FLAG[r.flag] ? `<span class="mkguess bad">⚠ ${OCR_FLAG[r.flag]}</span>` : ''}${r.guess ? '<span class="mkguess">사진에 뜻이 없어 Claude가 채운 뜻</span>' : ''}${r.ko && !mkAnsFrom(null, mkCleanKo(r.ko)).length ? '<span class="mkguess">뜻을 한글이나 영어 글자로 써 주세요</span>' : ''}</div>`).join('');
  const ok = n >= MK_MIN && n <= MK_MAX;
  return `
    ${MK.note ? `<p class="mknote">${esc(MK.note)}</p>` : ''}
    <p class="mksmall">잘못 읽은 글자가 있으면 고쳐 주세요. <b>뜻이 여러 개면 쉼표로</b> 나눠요. 게임에서는 쉼표로 나눈 뜻을 <b>모두</b> 써야 정답이에요.${MK.rows.some(r => r.snip) ? ' 줄마다 아래에 사진 속 원래 줄을 함께 보여 줘요(이 화면에만 보이고 저장하지 않아요).' : ''}</p>
    <label class="mklab">단어장 이름<input id="mkname" value="${esc(MK.name)}" maxlength="24" placeholder="예) Day 03 단어"></label>
    <div class="mkrows">${rows}</div>
    <button type="button" class="linkbtn" data-mk="addrow">＋ 단어 추가</button>
    <p class="mkcount">${n}단어${n < MK_MIN ? ` · ${MK_MIN}단어 이상 필요해요` : n > MK_MAX ? ` · ${MK_MAX}단어까지만 만들 수 있어요` : ` · 에피소드 약 ${Math.max(1, Math.round(n / 6))}개`}</p>
    <button type="button" class="startbtn" data-mk="make"${ok ? '' : ' disabled'}>${ICON.play}${MK.redo ? '이 단어장 이야기 새로 만들기' : 'AI 이야기로 게임 만들기'}</button>
    ${mkAiHTML()}
    <button type="button" class="linkbtn" data-mk="restart">처음으로</button>${buildLabel() ? `<p class="mksmall">${buildLabel()}</p>` : ''}`;
}
// 인터넷 없이 쓰게 준비하기 (사진 고르기·확인 화면에 보여 줘요)
// 1) 이야기 AI를 이 브라우저에서 쓸 수 있는지. 못 쓰면 까닭과 크롬으로 여는 방법
// 2) 사진 읽기·목소리·글꼴·AI 실행 파일(약 58MB)과 이야기 AI(약 3GB)를 한 번에 받아 두는 단추 (진행률·실패 까닭·다시 받기)
//    모바일 데이터면 이야기 AI를 받기 전에 한 번 더 묻는 단추가 돼요 (confirmTap)
//    다 받으면 그다음부터는 인터넷 없이(비행기 모드에서도) 사진을 읽고 이야기를 써요
function mkAiHTML() {
  if (MK.aiWhy === undefined) {
    MK.aiWhy = null;
    aiWhyNot().then(w => { MK.aiWhy = w; mkAiPut(); }, () => { MK.aiWhy = '이야기 AI를 확인하지 못했어요.'; mkAiPut(); });
  }
  if (MK.offline === undefined) {
    MK.offline = null;
    offlineHave().then(ok => { if (MK.offline == null) { MK.offline = ok ? 'ok' : 'no'; mkAiPut(); } });
  }
  if (MK.aiWhy == null) return '<div class="mknote mkai" id="mkai">이야기 AI를 이 기기에서 쓸 수 있는지 확인하는 중…</div>';
  const dl = MK.aiDl || {}, ai = !MK.aiWhy, aiReady = ai && !!(AI.engine || aiReadyBefore()), files = MK.offline === 'ok' || MK.offline === 'nosw';
  const done = files && (!ai || aiReady);
  const aiPart = !ai ? `<b>⚠ 이야기 AI를 쓸 수 없어요.</b> ${esc(MK.aiWhy)}<br>이대로 만들면 앱이 줄거리에 맞춘 기본 문장으로 이야기를 만들어요.`
    : aiReady ? '<b>✓ 이야기 AI(Gemma 4)를 이 기기에 받아 두었어요.</b> 인터넷 없이도 줄거리에 맞게 문장을 다듬어요. 에피소드마다 30초~1분쯤 걸려요.'
      : `<b>✓ 이 기기에서 이야기 AI(Gemma 4)를 쓸 수 있어요.</b> 처음 한 번 AI(${AI_SIZE})를 받아요.`;
  const filePart = MK.offline === 'ok' ? (ai ? '✓ 사진 읽기·목소리 파일도 이 기기에 받아 두었어요.' : '✓ 사진 읽기·목소리 파일은 이 기기에 받아 두었어요. 인터넷 없이도 단어장을 만들고 게임을 해요.')
    : MK.offline === 'nosw' ? '이 브라우저는 게임 파일을 저장해 두지 못해서 인터넷 없이는 열리지 않아요. 크롬이나 삼성 인터넷으로 열어 주세요.'
      : `게임 파일(사진 읽기·목소리 등, 약 ${offlineMB()}MB)${ai ? '도' : '을'} 받아 두면 인터넷 없이 써요.`;
  let act = '';
  if (dl.state === 'run') act = `<b>인터넷 없이 쓰게 준비하는 중</b><br>${esc(dl.text || '')}<div class="ocrbar" aria-hidden="true"><i style="width:${Math.round((dl.p || 0) * 100)}%"></i></div><button type="button" class="linkbtn" data-mk="aidlstop">그만 받기</button>`;
  else if (dl.state === 'fail') act = `<b>⚠ 다 받지 못했어요.</b> ${esc(dl.text || '')}<br><button type="button" class="btn" data-mk="aidl">다시 받기</button>`;
  else if (!done) act = `${ai && !aiReady && aiMobileData() ? '<b>지금은 모바일 데이터로 연결돼 있어요.</b> ' : ''}<b>와이파이</b>에서 화면을 켜 둔 채로 받아 주세요. 한 번만 받으면 그다음부터는 인터넷 없이(비행기 모드에서도) 써요.<br><button type="button" class="btn" data-mk="aidl">인터넷 없이 쓰게 준비하기</button>${ai && !aiReady ? ' <small>(안 받아 두면 ‘게임 만들기’를 누를 때 이야기 AI만 받아요)</small>' : ''}`;
  const head = ai && done && MK.offline === 'ok' && dl.state !== 'fail' ? '<b>✓ 인터넷 없이 쓸 준비가 됐어요.</b><br>' : '';
  return `<div class="mknote mkai ${ai && dl.state !== 'fail' ? 'ok' : 'bad'}" id="mkai">${head}${aiPart}<br>${filePart}${act ? `<br>${act}` : ''}</div>`;
}
// 상자만 다시 그려요 (입력 중인 단어 칸은 그대로)
function mkAiPut() { const el = document.getElementById('mkai'); if (el) el.outerHTML = mkAiHTML(); }
// 받기 진행 글: 단계마다 0→100이 다시 시작돼요 (받기 → 그래픽 칩에 올리기 → 마무리)
function mkAiProgText(p, t, lab) {
  const step = /^Loading model from cache/.test(t) ? '그래픽 칩에 올리는 중' : /^Loading GPU shader/.test(t) ? '마무리하는 중' : '';
  const pct = Math.floor(clamp(p, 0, 1) * 100);
  return step ? `이야기 AI 준비 중 · ${step} ${pct}%` : `${lab} ${pct}%`;
}
// 단어장 없이 먼저 받아 두기: 사진 읽기·목소리·글꼴·AI 실행 파일 → 이야기 AI(이 기기에서 돌릴 수 있을 때만)
// 하나가 안 받아져도 다른 것은 받아요. 못 받은 것과 까닭을 모아 보여 줘요
async function mkAiPrefetch() {
  if (MK.aiDl && MK.aiDl.state === 'run') return;
  const ctl = MK.aiDlCtl = new AbortController();
  let last = '';
  const put = st => { MK.aiDl = st; mkAiPut(); };
  const step = (p, x) => { if (x !== last) { last = x; put({ state: 'run', text: x, p }); } };
  const onProg = (p, t) => step(p, mkAiProgText(p, t, `이야기 AI(${AI_SIZE}) 받는 중`));
  const errs = [];
  put({ state: 'run', text: '받기 준비 중', p: 0 });
  wakeHold('aidl'); // 받는 동안 화면이 꺼지지 않게
  try {
    if (MK.offline !== 'ok') {
      const r = await offlinePrep(p => step(p, `게임 파일 받는 중 ${Math.floor(clamp(p, 0, 1) * 100)}%`), ctl.signal);
      if (r.bad.length) errs.push(`게임 파일 ${r.bad.length}개를 받지 못했어요. 인터넷 연결을 확인하고 다시 받아 주세요.`);
      else MK.offline = r.stored ? 'ok' : 'nosw';
    }
    if (!MK.aiWhy) {
      AI.onRetry = t => put({ state: 'run', text: `인터넷 연결이 끊겨서 이어 받는 중 (${t + 1}/${AI_TRIES}번째)`, p: (MK.aiDl && MK.aiDl.p) || 0 });
      const aborted = new Promise((_, no) => {
        const f = () => { if (!AI.engine) aiDrop(); no({ code: 'cancelled' }); };
        if (ctl.signal.aborted) f(); else ctl.signal.addEventListener('abort', f, { once: true });
      });
      aborted.catch(() => { });
      try { await Promise.race([aiLoad(onProg), aborted]); }
      catch (e) { if (e && e.code === 'cancelled') throw e; errs.push((AI.err && AI.err.text) || '이야기 AI를 받지 못했어요.'); }
    }
    if (errs.length) put({ state: 'fail', text: errs.join(' ') });
    else { put({ state: 'ok' }); toast(MK.offline === 'ok' ? '인터넷 없이 쓸 준비가 됐어요' : '다 받아 두었어요'); }
  } catch (e) { put(e && e.code === 'cancelled' ? null : { state: 'fail', text: '받지 못했어요. 다시 받아 주세요.' }); }
  finally { if (AI.onProgress === onProg) AI.onProgress = null; AI.onRetry = null; if (MK.aiDlCtl === ctl) MK.aiDlCtl = null; wakeFree('aidl'); }
}
function mkMakingHTML() {
  const items = MK.log.map(l => `<li class="${l.state}"><span>${esc(l.text)}${l.state === 'run' ? '<i class="dotdot" aria-hidden="true"></i>' : ''}</span></li>`).join('');
  return `<div class="mkwait"><div class="spin" aria-hidden="true"></div><p><b>게임을 만들고 있어요</b><br><small>에피소드마다 30초~1분쯤 걸려요. 다 만들 때까지 이 화면을 켜 두세요. 다른 앱을 열면 이야기 AI가 멈출 수 있어요.</small></p></div>
    <ol class="mklog">${items}</ol>
    <button type="button" class="btn" data-mk="stop">그만두기</button>`;
}
function mkDoneHTML() {
  const d = MK.deck; if (!d) return '';
  const n = Object.keys(d.words).length;
  return `<div class="mkdone"><div class="badge">${badgeSVG('#7CF29C')}<span>완성!</span></div>
    <p><b>${esc(d.name)}</b> — ${n}단어, 에피소드 ${d.scenes.length}개</p>
    <div class="mkthumbs">${d.scenes.map(s => `<div><img src="${'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">${genScene(d.panels[s.key] || [])}</svg>`)}" alt=""><span>${esc(s.title)}</span></div>`).join('')}</div>
    ${MK.aiNote ? `<p class="mknote">${esc(MK.aiNote)}</p>` : ''}
    ${MK.aiDiag && MK.aiDiag.length ? `<details class="mkdiag"><summary>AI가 쓴 글 보기 (문제 찾기용)</summary>${MK.aiEnv ? `<p><small>${esc(MK.aiEnv)}</small></p>` : ''}${MK.aiDiag.map(d => `<p><b>${esc(d.title)}</b>${d.info ? `<br><small>${esc(d.info)}</small>` : ''}<br>${d.why.map(esc).join('<br>')}</p><pre>${esc(d.raw || '(빈 답)')}</pre>`).join('')}</details>` : ''}
    ${MK.saveNote ? `<p class="mksmall">${esc(MK.saveNote)}</p>` : ''}
    <p class="mksmall">교재로 만든 단어장은 개인 공부용으로만 써 주세요. 다른 사람과 나누거나 인터넷에 올리지 마세요.</p>
    <button type="button" class="startbtn" data-mk="play">${ICON.play}이 단어장으로 게임 시작</button></div>`;
}
function mkLog(text, state = 'run') { MK.log.push({ text, state }); if (!$('#make').hidden) renderMake(); return MK.log.length - 1; }
function mkLogSet(i, state, text) { if (MK.log[i]) { MK.log[i].state = state; if (text) MK.log[i].text = text; } if (!$('#make').hidden) renderMake(); }
function mkBindRows() {
  for (const inp of document.querySelectorAll('#make .mkrow input')) inp.addEventListener('input', () => {
    const i = +inp.closest('.mkrow').dataset.i, r = MK.rows[i]; if (!r) return;
    if (inp.classList.contains('mken')) r.en = inp.value; else { r.ko = inp.value; r.guess = false; }
    if (r.flag) { r.flag = ''; const row = inp.closest('.mkrow'); row.classList.remove('flag'); const g = row.querySelector('.mkguess.bad'); if (g) g.remove(); }
    mkCountOnly();
  });
  const nm = $('#mkname'); if (nm) nm.addEventListener('input', () => { MK.name = nm.value; });
}
function mkCountOnly() {
  const n = mkValidRows().length, c = $('#make .mkcount'), b = $('#make [data-mk="make"]'), b2 = $('#make [data-mk="makeai"]');
  if (b2) b2.disabled = !(n >= MK_MIN && n <= MK_MAX);
  if (c) c.textContent = `${n}단어${n < MK_MIN ? ` · ${MK_MIN}단어 이상 필요해요` : n > MK_MAX ? ` · ${MK_MAX}단어까지만 만들 수 있어요` : ` · 에피소드 약 ${Math.max(1, Math.round(n / 6))}개`}`;
  if (b) b.disabled = !(n >= MK_MIN && n <= MK_MAX);
}
// "영어 - 뜻" 줄들을 단어 목록으로. 번호·글머리표·품사·표(탭) 칸도 정리하고, 못 읽은 줄 수도 셈
const HANGUL = /[가-힣]/, LATIN = /[A-Za-z]/;
function mkParse(text) {
  const rows = []; let skipped = 0;
  for (const raw of String(text || '').split(/\n+/)) {
    let line = raw.replace(/\r/g, '').trim(); if (!line) continue;
    let en = '', ko = '';
    if (line.includes('\t')) {
      // 표에서 복사: 영어 칸(숫자·품사 칸 제외)과 한글 칸
      const cells = line.split('\t').map(c => c.trim()).filter(Boolean);
      en = cells.find(c => LATIN.test(c) && !HANGUL.test(c) && !/^\(?(?:n|v|a|adj|adv|ad|prep|conj)\.?\)?$/i.test(c)) || '';
      ko = cells.find(c => HANGUL.test(c)) || '';
    } else {
      line = line.replace(/^(?:\(?\d{1,3}[.)]?|[①-⑳]|[•·▪■□☐✓✔*\-–—])\s*/, '');
      const m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/) || line.match(/^([^가-힣:=]+?)\s*[:=]\s*(.+)$/) || line.match(/^([^가-힣]+?)\s{2,}(.+)$/);
      if (m && LATIN.test(m[1]) && !HANGUL.test(m[1])) { en = m[1]; ko = m[2]; }
      else {
        const k = line.search(HANGUL), j = line.search(LATIN);
        if (k > 0 && j >= 0 && j < k) { en = line.slice(0, k); ko = line.slice(k); }
        else if (k === 0 && j > 0) { ko = line.slice(0, j); en = line.slice(j); } // 한글이 먼저 나온 줄
      }
    }
    en = mkCleanEn(en); ko = mkCleanKo(ko);
    if (en && ko && LATIN.test(en)) rows.push({ en, ko, pos: 'x' }); else skipped++;
  }
  rows.skipped = skipped;
  return rows;
}
// 같은 단어(대소문자 무시)는 하나로: 뜻이 다르면 합침
function mkDedupe(rows) {
  const at = new Map(), out = [];
  for (const r of rows) {
    const en = mkCleanEn(r.en), k = en.toLowerCase(), ko = mkCleanKo(r.ko);
    if (!en) continue;
    if (at.has(k)) {
      const o = out[at.get(k)], have = o.ko.split(/\s*,\s*/);
      for (const part of ko.split(/\s*,\s*/)) if (part && !have.includes(part)) have.push(part);
      o.ko = have.filter(Boolean).join(', ').slice(0, 60);
      continue;
    }
    at.set(k, out.length);
    out.push({ en, ko, pos: POS_KEYS.includes(r.pos) ? r.pos : 'x', guess: !!r.guess, flag: r.flag || '' });
  }
  return out;
}

