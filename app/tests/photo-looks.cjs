// 사진 읽기 점검용 합성 사진: 단어 목록을 찍거나 캡처한 흔한 모양을 직접 만들어요.
// 다크 모드 채팅 답(공유 창·입력 칸·스크롤 단추), 어두운 책상 위 기운 두 단 목록, 옆으로 찍은 칸 표,
// 단어 옆에 아이콘이 있고 뜻이 아랫줄인 휴대폰 단어장, 품사 칸이 있는 컴퓨터 표.
// 낱말은 일반 사전 낱말이고 뜻은 직접 썼어요. 교재·문제지의 사진이나 내용·꾸밈은 흉내 내지 않아요.
// 단독 실행: node app/tests/photo-looks.cjs [--all] [--save 폴더]   (Playwright Chromium이 있어야 해요)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const GAME = path.join(__dirname, '..', '..', 'word-game');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KO = "'IBM Plex Sans KR',sans-serif", EN = "'Noto Sans',sans-serif", SERIF = "'Liberation Serif','Noto Serif',serif";
const HEAD = '<!doctype html><meta charset=utf-8><link rel=stylesheet href="/word-game/fonts/fonts.css">';

/* ---------- 낱말 (일반 사전 낱말 + 직접 쓴 뜻) ---------- */
const CHAT = [
  { t: '1. 회사·경영', items: [['Profitable', '수익성 있는, 이익이 되는'], ['Merger', '합병'], ['Revenue', '수익, 매출'], ['Budget', '예산'], ['Forecast', '예측, 전망'], ['Negotiate', '협상하다'], ['Invest', '투자하다'], ['Partnership', '동업, 협력 관계'], ['Incentive', '동기, 장려책'], ['Overhead', '간접비, 경상비']] },
  { t: '2. 법·규칙', items: [['Regulation', '규정, 규제'], ['Clause', '조항'], ['Enforce', '집행하다, 시행하다'], ['Exempt', '면제된'], ['Breach', '위반, 파기'], ['Clarify', '명확하게 하다'], ['Penalty', '벌금, 처벌'], ['Verify', '확인하다, 검증하다'], ['Authorize', '권한을 주다, 허가하다'], ['Dishonest', '부정직한, 거짓된']] },
  { t: '3. 사람·일', items: [['Colleague', '동료'], ['Recruit', '채용하다, 모집하다'], ['Promote', '승진시키다, 홍보하다'], ['Resign', '사임하다, 물러나다'], ['Evaluate', '평가하다'], ['Supervise', '감독하다'], ['Assign', '배정하다, 맡기다'], ['Reputation', '명성, 평판'], ['Format', '형식, 서식'], ['Duty', '의무, 직무']] },
  { t: '4. 문서·보고', items: [['Summary', '요약'], ['Brief', '간단한, 짧은'], ['Draft', '초안, 원고'], ['Vague', '모호한, 막연한'], ['Precise', '정확한, 정밀한'], ['Subsidiary', '부수적인, 자회사'], ['Obvious', '명백한, 분명한'], ['Outline', '개요, 윤곽'], ['Appendix', '부록'], ['Revise', '고치다, 수정하다']] },
];
const LIST = [['rough', '거친'], ['journey', '여행, 여정'], ['chase', '뒤쫓다'], ['cottage', '오두막'], ['riddle', '수수께끼'], ['strict', '엄격한'], ['measure', '재다, 측정하다'], ['honest', '정직한'],
  ['protect', '보호하다, 지키다'], ['delicious', '맛있는'], ['borrow', '빌리다'], ['harvest', '수확, 추수'], ['arrive', '도착하다'], ['take part in', '참가하다'], ['kingdom', '왕국']];
// 칸 표 (뜻 첫 글자가 동·명·부·형인 낱말 포함: 품사 표시로 잘못 지우지 않는지)
const TABLE = [['animal', '동물'], ['east', '동쪽'], ['clear', '명확한, 분명한'], ['holiday', '명절, 휴일'], ['kitchen', '부엌'], ['parents', '부모'], ['brothers', '형제'], ['awful', '형편없는, 끔찍한'],
  ['island', '섬'], ['village', '마을'], ['bridge', '다리'], ['weather', '날씨'], ['promise', '약속하다'], ['healthy', '건강한'], ['shadow', '그림자'], ['narrow', '좁은']];
// 휴대폰 단어장·컴퓨터 표
const APP = [['forest', '숲'], ['decide', '결정하다'], ['danger', '위험'], ['invite', '초대하다'], ['curious', '호기심이 많은'], ['collect', '모으다, 수집하다'], ['repair', '수리하다, 고치다'],
  ['delicious', '맛있는'], ['neighbor', '이웃'], ['arrive', '도착하다'], ['ancient', '고대의'], ['whisper', '속삭이다']];
const POSW = ['noun', 'verb', 'noun', 'verb', 'adjective', 'verb', 'verb', 'adjective', 'noun', 'verb', 'adjective', 'verb'];

/* ---------- 화면 캡처 모양 ---------- */
const STAT = (t, dark) => `<div class=sb><span>${t}</span><span class=sbr><b>LTE</b><svg width=17 height=12 viewBox="0 0 17 12"><rect x=0 y=8 width=3 height=4 /><rect x=4.5 y=5.5 width=3 height=6.5 /><rect x=9 y=3 width=3 height=9 /><rect x=13.5 y=0 width=3 height=12 /></svg><span class=bat${dark ? ' d' : ''}>37</span></span></div>`;
const NAVB = '<div class=navb><span>|||</span><span>◯</span><span>‹</span></div>';
function chatHTML(o) {
  let n = 0;
  const body = ['<p>요청하신 대로 <b>영단어 — 뜻</b> 형식으로 정리했어요. 외우기 쉽게 주제별로 나눴습니다.</p>'];
  for (const s of CHAT) body.push(`<h3>${esc(s.t)}</h3>` + s.items.map(([en, ko]) => { const i = n++; return `<div class=e data-i=${i}><span class=nb>${i + 1}.</span> <b>${esc(en)}</b> — ${esc(ko)}</div>`; }).join(''));
  body.push('<hr><p>원하시면 이 단어들로 단어 시험도 만들어 드릴게요.</p><h3>시험 방식</h3><p>1. 영어를 보고 뜻 쓰기</p><p>2. 뜻을 보고 영어 쓰기</p>');
  const css = `*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#000;color:#ececec;font-family:${EN.replace(',sans-serif', '')},${KO}}
.ct{padding:0 18px;font-size:17px;line-height:1.5;position:relative}.ct p{margin:14px 0}.ct h3{font-size:18px;margin:26px 0 14px}.ct .e{margin:0 0 10px}.ct hr{border:0;border-top:1px solid #333;margin:26px 0}
.nb{display:inline-block;min-width:26px}.sb{position:fixed;top:0;left:0;right:0;height:30px;display:flex;justify-content:space-between;align-items:center;padding:0 18px;font:600 14px ${EN};background:rgba(0,0,0,.7);color:#fff}
.sb svg{fill:currentColor}.sbr{display:flex;gap:5px;align-items:center;font-size:10px}.bat{background:#bbb;color:#000;border-radius:7px;padding:0 5px;font-weight:700}
.cover{position:fixed}.share{top:36px;left:10px;right:10px;height:74px;border-radius:22px;background:#2a2a2a;display:flex;align-items:center;padding:0 16px;gap:10px}
.share div{flex:1;font-size:15px;line-height:1.35}.share small{color:#a0a0a0;font-size:13px}.share i{background:#fff;color:#000;border-radius:20px;width:70px;height:38px;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:20px}
.arrow{width:40px;height:40px;border-radius:20px;background:#2f2f2f;border:1px solid #444;color:#ddd;display:flex;align-items:center;justify-content:center;font-size:22px}
.inp{left:10px;right:10px;bottom:46px;height:52px;border-radius:26px;background:#2a2a2a;display:flex;align-items:center;gap:12px;padding:0 10px 0 16px;color:#9a9a9a;font-size:16px}
.inp b{color:#ddd;font-size:24px;font-weight:300}.inp span{flex:1}.inp i{width:34px;height:34px;border-radius:17px;background:#3b6df5;display:block}
.navb{position:fixed;left:0;right:0;bottom:0;height:44px;background:#000;display:flex;justify-content:space-around;align-items:center;color:#aaa;font-size:20px}`;
  const share = o.share ? '<div class="cover share"><div><b>채팅 링크를 공유할까요?</b><br><small>다른 사람이 채팅할 수 있는 사본을 만들어요</small></div><i>⤴</i></div>' : '';
  return `${HEAD}<style>${css}</style><div class=ct id=ct>${body.join('')}</div>${STAT(o.time, true)}${share}<div class="cover arrow" id=arrow>↓</div><div class="cover inp"><b>+</b><span>ChatGPT에게 답변하기</span>🎙<i></i></div>${NAVB}
<script>(${chatPlace})(${JSON.stringify(o)})</script>`;
}
// 답을 스크롤해 o.at번 줄이 y에 오게, 스크롤 단추는 o.arrowOn번 줄(없으면 목록 뒤 문단) 위에
function chatPlace(o) {
  const ct = document.getElementById('ct'), at = document.querySelector(`[data-i="${o.at}"]`);
  ct.style.top = (o.y - at.offsetTop) + 'px';
  const ar = document.getElementById('arrow'), tgt = o.arrowOn == null ? document.querySelector('hr + p') : document.querySelector(`[data-i="${o.arrowOn}"]`);
  const r = tgt.getBoundingClientRect(); ar.style.top = (r.top + r.height / 2 - 20) + 'px'; ar.style.left = (o.arrowX || 160) + 'px';
}
// 휴대폰 단어장: 단어 줄 오른쪽에 스피커·별 아이콘, 뜻은 아랫줄 회색
function belowHTML() {
  const ic = '<svg class=ic viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7" stroke="currentColor" stroke-width="1.8" fill="none"/></svg><svg class=ic viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>';
  const rows = APP.slice(0, 10).map(([en, ko], i) => `<div class=e data-i=${i}><div class=top><b>${esc(en)}</b><span class=sp></span>${ic}</div><div class=m>${esc(ko)}</div></div>`).join('');
  return `${HEAD}<style>*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:#fff;color:#111;font-family:${EN.replace(',sans-serif', '')},${KO}}
.sb{height:30px;display:flex;justify-content:space-between;align-items:center;padding:0 20px;font:600 13px ${EN}}.ab{height:52px;display:flex;align-items:center;padding:0 16px;font:700 18px ${KO};border-bottom:1px solid #e6e6e6}
.e{padding:12px 16px;border-bottom:1px solid #e6e6e6}.top{display:flex;align-items:center;gap:8px}.top b{font-size:19px}.sp{flex:1}.ic{width:20px;height:20px;color:#888}.m{font-size:15px;color:#555;margin-top:5px;font-family:${KO}}</style>
<div class=sb><span>9:41</span><span>LTE 80%</span></div><div class=ab>내 단어장</div>${rows}`;
}
// 컴퓨터 화면 표: 번호 | 단어 | 품사 | 뜻
function pcTableHTML() {
  const rows = APP.map(([en, ko], i) => `<tr data-i=${i}><td>${i + 1}</td><td><b>${esc(en)}</b></td><td class=p>${POSW[i]}</td><td class=k>${esc(ko)}</td></tr>`).join('');
  return `${HEAD}<style>html,body{margin:0;background:#fff;color:#1f2328;font-family:${EN.replace(',sans-serif', '')},${KO}}.pg{padding:18px 40px}h1{font-size:26px;margin:4px 0 14px}
table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:9px 14px;text-align:left;border-bottom:1px solid #e1e4e8}th{background:#f6f8fa}td.p{color:#6a737d;font-style:italic}td.k{font-family:${KO}}tr:nth-child(odd) td{background:#f5f7fb}</style>
<div class=pg><h1>Word List: Nature &amp; Travel</h1><table><tr><th>No.</th><th>Word</th><th>Part</th><th>Meaning</th></tr>${rows}</table></div>`;
}

/* ---------- 종이(사진으로 찍을 쪽) ---------- */
const PAPER = `.paper{box-sizing:border-box;position:relative}`;
// 칸을 그은 표 (번호 | 단어 | 뜻)
function tableHTML() {
  const rows = TABLE.map(([en, ko], i) => `<tr><td class=n>${i + 1}</td><td><b>${esc(en)}</b></td><td class=k>${esc(ko)}</td></tr>`).join('');
  return `${HEAD}<style>body{margin:0;background:#777}${PAPER}.paper{width:820px;padding:54px 58px 60px;background:#fbf9f3;color:#1d1d1d;font-family:${EN};font-size:19px}
.hd{border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:16px;font-size:1.4em;font-weight:700}table{border-collapse:collapse;width:100%}th,td{border:1.5px solid #333;padding:9px 12px;text-align:left}th{background:#e8e4da}td.n{width:60px}td.k{font-family:${KO}}</style>
<div class=paper><div class=hd>Word Table</div><table><tr><th>No.</th><th>Word</th><th>Meaning</th></tr>${rows}</table></div>`;
}
function listHTML() {
  const e = (x, i) => `<div class=e><span class=n>${String(i + 1).padStart(2, '0')}</span><b>${esc(x[0])}</b><span class=m>${esc(x[1])}</span></div>`;
  return `${HEAD}<style>body{margin:0;background:#777}${PAPER}.paper{width:1000px;padding:54px 58px 60px;background:#fbf9f3;color:#1d1d1d;font-family:${EN};font-size:16px}
.hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #333;padding-bottom:8px;margin-bottom:16px}.hd b{font-size:1.45em}.hd span{font-size:.85em;font-family:${KO}}
.list{columns:2;column-gap:44px;column-rule:1px solid #bbb}.e{display:grid;grid-template-columns:34px 128px 1fr;column-gap:12px;align-items:baseline;padding:8px 0;break-inside:avoid}.n{color:#444;font-size:.9em}.m{font-family:${KO}}
.ft{text-align:center;margin-top:20px;color:#666;font-size:.8em}</style><div class=paper><div class=hd><b>Review Test</b><span>단어 15개</span></div><div class=list>${LIST.map(e).join('')}</div><div class=ft>- 12 -</div></div>`;
}
/* ---------- 사진기: 책상 위 종이를 기울여·조명·흐림·잡티를 넣어 찍음 (잡티는 정해진 씨앗으로 늘 같게) ---------- */
function camScript(o) {
  const im = new Image();
  im.onload = () => {
    const W = im.naturalWidth, H = im.naturalHeight, cv = document.getElementById('paper'); cv.width = W; cv.height = H;
    cv.style.width = Math.round(W * Math.min(o.fit * innerWidth / W, o.fit * innerHeight / H)) + 'px';
    cv.getContext('2d').drawImage(im, 0, 0);
    const nz = document.getElementById('noise'), nw = Math.round(innerWidth * devicePixelRatio / 2), nh = Math.round(innerHeight * devicePixelRatio / 2);
    nz.width = nw; nz.height = nh; const ng = nz.getContext('2d'), nd = ng.createImageData(nw, nh);
    let a = o.seed >>> 0; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = 0; i < nd.data.length; i += 4) { const v = 128 + (rnd() - .5) * 200; nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255; }
    ng.putImageData(nd, 0, 0);
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__ready = true; }));
  };
  im.src = '/mem/paper.png';
}
function camHTML(c) {
  const BG = { wood: 'linear-gradient(160deg,#7a5c3e,#4a3424)', dark: 'linear-gradient(135deg,#3a3d42,#1f2124)', papers: 'linear-gradient(112deg,#8f8b84 0%,#8f8b84 30%,#efede8 30%,#efede8 47%,#6d6a64 47%)' }[c.bg];
  const LIGHT = { tl: 'radial-gradient(ellipse 90% 80% at 25% 15%,#fff 0%,#f4f1ea 45%,#b5afa4 100%)', br: 'radial-gradient(ellipse 90% 80% at 80% 85%,#fff 0%,#f2efe8 40%,#a8a298 100%)', side: 'linear-gradient(90deg,#8f8a84 0%,#d8d4cc 30%,#fff 60%,#f6f3ee 100%)', dim: 'radial-gradient(ellipse 80% 70% at 55% 40%,#e9dcc6 0%,#b5a58c 60%,#7d6f5c 100%)' }[c.light];
  return `<!doctype html><meta charset=utf-8><style>html,body{margin:0;height:100%;overflow:hidden;background:${BG}}
#scene{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;perspective:1500px}
#paper{transform:rotateX(${c.rx}deg) rotateY(${c.ry}deg) rotateZ(${c.rz}deg);filter:blur(${c.blur}px) brightness(${c.bright || 1}) drop-shadow(0 14px 22px rgba(0,0,0,.45))}
#light{position:fixed;inset:0;mix-blend-mode:multiply;background:${LIGHT}}#noise{position:fixed;inset:0;width:100%;height:100%;opacity:${c.noise};mix-blend-mode:overlay}
</style><div id=scene><canvas id=paper></canvas></div><div id=light></div><canvas id=noise></canvas><script>(${camScript})(${JSON.stringify({ fit: c.fit, seed: c.seed || 7 })})</script>`;
}

/* ---------- 모양 목록: quick = npm test에서 늘 보는 것, min = 맞아야 하는 단어 수 (지금 코드가 맞히는 수보다 조금 낮게) ---------- */
const chatTruth = () => CHAT.flatMap(s => s.items);
const FORMATS = [
  { id: 'chat-dark-share', quick: true, min: 12, shot: { vw: 360, vh: 780, dpr: 3, html: () => chatHTML({ time: 'SKT 2:05', share: true, at: 24, y: 62 }) }, truth: chatTruth },
  { id: 'chat-dark-top', min: 9, shot: { vw: 360, vh: 780, dpr: 3, html: () => chatHTML({ time: 'SKT 2:05', share: false, at: 0, y: 150, arrowOn: 8, arrowX: 205 }) }, truth: chatTruth },
  { id: 'photo-twocol-dark-desk', quick: true, min: 12, page: listHTML, cam: { rz: 4, rx: 4, ry: 2, blur: .6, light: 'br', q: 70, bg: 'wood', fit: .93, noise: .07, seed: 11 }, truth: () => LIST },
  { id: 'photo-table-sideways', quick: true, min: 11, page: tableHTML, cam: { rz: 90, rx: 4, ry: -3, blur: .6, light: 'tl', q: 74, bg: 'papers', fit: .94, noise: .06, seed: 13 }, truth: () => TABLE },
  { id: 'shot-icons-below', quick: true, min: 8, shot: { vw: 432, vh: 936, dpr: 2.5, html: belowHTML }, truth: () => APP },
  { id: 'pc-table-pos', quick: true, min: 10, shot: { vw: 1280, vh: 800, dpr: 1.5, html: pcTableHTML }, truth: () => APP },
];
// 화면에 다 보이는(위아래 막대·공유 창·단추에 가리지 않은) 줄만 정답으로
const VISIBLE = () => {
  const covers = [...document.querySelectorAll('.cover,.sb,.navb')].map(e => e.getBoundingClientRect()), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  return [...document.querySelectorAll('[data-i]')].filter(e => {
    const r = e.getBoundingClientRect(), a = e.querySelector('.a span'), ra = a ? a.getBoundingClientRect() : r;
    const box = { left: r.left, right: Math.max(r.right, ra.right), top: r.top, bottom: Math.max(r.bottom, ra.bottom) };
    return box.top >= 0 && box.bottom <= innerHeight && !covers.some(c => hit(box, c));
  }).flatMap(e => e.dataset.i.split(',').map(Number));
};
const entry = ([en, ko]) => ({ en: en.replace(/\s*~$/, '').trim(), ko: Array.isArray(ko) ? ko : ko.split(/\s*[,;]\s*/) });

// 합성 사진 한 장 → { buffer, mime, entries }
async function render(browser, origin, mem, f) {
  const all = f.truth();
  if (f.shot) {
    mem.set('/mem/page.html', f.shot.html());
    const ctx = await browser.newContext({ deviceScaleFactor: f.shot.dpr, serviceWorkers: 'block' }), p = await ctx.newPage();
    try {
      await p.setViewportSize({ width: f.shot.vw, height: f.shot.vh });
      await p.goto(origin + '/mem/page.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
      const kept = await p.evaluate(VISIBLE), buffer = await p.screenshot(f.jpg ? { type: 'jpeg', quality: f.jpg } : { type: 'png' });
      return { buffer, mime: f.jpg ? 'image/jpeg' : 'image/png', entries: kept.map(i => entry(all[i])) };
    } finally { await ctx.close(); }
  }
  const ctx = await browser.newContext({ deviceScaleFactor: 3, serviceWorkers: 'block' }), p = await ctx.newPage();
  try {
    mem.set('/mem/page.html', f.page());
    await p.setViewportSize({ width: 1100, height: 900 }); await p.goto(origin + '/mem/page.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
    mem.set('/mem/paper.png', await p.locator('.paper').screenshot({ type: 'png' }));
    mem.set('/mem/cam.html', camHTML(f.cam));
    await p.setViewportSize({ width: 1000, height: 1333 }); await p.goto(origin + '/mem/cam.html'); await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    return { buffer: await p.screenshot({ type: 'jpeg', quality: f.cam.q }), mime: 'image/jpeg', entries: all.map(entry) };
  } finally { await ctx.close(); }
}

// 게임의 만들기 화면에서 사진을 읽게 하고 확인 화면의 줄을 가져옴 (사진첩에서 고른 것과 같은 'change' 이벤트)
async function readPhoto(page, img, name) {
  await page.setInputFiles('#make input[data-mkfile][multiple]', { name, mimeType: img.mime, buffer: img.buffer });
  await page.click('#make [data-mk="read"]');
  await page.waitForFunction(() => MK.step !== 'reading' && !MK.run, null, { timeout: 240000, polling: 300 });
  const rows = await page.evaluate(() => (MK.rows || []).map(r => ({ en: r.en, ko: r.ko, flag: r.flag || '' })));
  await page.evaluate(() => { MK.images = []; MK.rows = []; MK.step = 'pick'; MK.err = ''; MK.note = ''; MK.name = ''; MK.paste = ''; renderMake(); });
  return rows;
}

// 맞은 단어: 영어가 같고(대소문자·바깥 기호 무시) 정답 뜻이 모두 그 줄 뜻에 있음(띄어쓰기·기호 무시)
const normEn = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/^[^a-z]+|[^a-z]+$/g, '');
const normKo = s => String(s || '').replace(/[^가-힣~0-9a-z]/gi, '');
function score(entries, rows) {
  const miss = [];
  let ok = 0;
  for (const e of entries) {
    const r = rows.find(x => normEn(x.en) === normEn(e.en));
    if (r && e.ko.every(m => normKo(r.ko).includes(normKo(m)))) ok++; else miss.push(`${e.en} → ${r ? r.ko : '(없음)'}`);
  }
  return { ok, n: entries.length, miss };
}

// 시험용 정적 서버: /word-game/ (잠근 페이지 + 글꼴·글자 읽기 파일), /mem/ (그때그때 만든 합성 화면)
function serve(locked) {
  const mem = new Map(), TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (mem.has(u)) { const b = mem.get(u); res.writeHead(200, { 'content-type': Buffer.isBuffer(b) ? 'image/png' : 'text/html; charset=utf-8' }); return res.end(b); }
    if (u === '/word-game/' || u === '/word-game/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(locked); }
    const f = path.join(GAME, u.replace(/^\/word-game\//, ''));
    if (!u.startsWith('/word-game/') || !f.startsWith(GAME) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ origin: `http://127.0.0.1:${srv.address().port}`, mem, close: () => srv.close() })));
}

// 합성 사진을 만들어 게임으로 읽고 모양마다 점수를 냄. formats: FORMATS의 일부
async function runLooks(pw, formats, { locked, key, save, log = () => { } }) {
  const srv = await serve(locked), browser = await pw.chromium.launch();
  const out = [];
  try {
    const page = await (await browser.newContext({ serviceWorkers: 'block', locale: 'ko-KR' })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(`${srv.origin}/word-game/#k=${key}`);
    await page.waitForFunction(() => typeof openMake === 'function' && !!document.getElementById('make'), null, { timeout: 60000 });
    await page.evaluate(() => openMake());
    await page.waitForSelector('#make input[data-mkfile][multiple]', { state: 'attached', timeout: 20000 });
    for (const f of formats) {
      const img = await render(browser, srv.origin, srv.mem, f);
      if (save) { fs.mkdirSync(save, { recursive: true }); fs.writeFileSync(path.join(save, f.id + (img.mime === 'image/png' ? '.png' : '.jpg')), img.buffer); }
      const t0 = Date.now(), rows = await readPhoto(page, img, f.id + (img.mime === 'image/png' ? '.png' : '.jpg')), s = score(img.entries, rows);
      out.push(Object.assign({ id: f.id, min: f.min, ms: Date.now() - t0, rows }, s));
      log(`${f.id}: ${s.ok}/${s.n} (기준 ${f.min}) ${((Date.now() - t0) / 1000).toFixed(1)}s${s.miss.length ? ' · 틀림: ' + s.miss.slice(0, 6).join(' | ') : ''}`);
    }
    out.errors = errors;
  } finally { await browser.close(); srv.close(); }
  return out;
}

module.exports = { FORMATS, runLooks, score, CHAT, TABLE };

if (require.main === module) {
  const crypto = require('node:crypto'), { build, seal } = require('../build.cjs');
  let pw = null;
  for (const p of ['playwright', path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright')]) { try { pw = require(p); break; } catch (e) { } }
  if (!pw) { console.error('Playwright가 없어요'); process.exit(2); }
  const k = crypto.randomBytes(32), arg = process.argv.slice(2), si = arg.indexOf('--save');
  const formats = arg.includes('--all') ? FORMATS : FORMATS.filter(f => f.quick);
  runLooks(pw, formats, { locked: seal(build(), k), key: k.toString('base64url'), save: si >= 0 ? arg[si + 1] : '', log: console.log }).then(r => {
    const ok = r.reduce((a, x) => a + x.ok, 0), n = r.reduce((a, x) => a + x.n, 0);
    console.log(`모두: ${ok}/${n} (${Math.round(100 * ok / n)}%)${r.errors.length ? ' · 페이지 오류: ' + r.errors.join(' | ') : ''}`);
    process.exit(r.every(x => x.ok >= x.min) ? 0 : 1);
  }).catch(e => { console.error(e); process.exit(1); });
}
