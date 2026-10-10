// word-game/index.html을 app/src에서 만들어요. 손으로 index.html을 고치지 말고 src를 고친 뒤 이 파일을 실행하세요.
// 사이트에는 게임을 잠근 페이지(src/lock.html)가 올라가요: 게임 전체를 AES-GCM으로 잠그고, 열쇠는 공유 링크의 # 뒤에만 있어요.
// 열쇠는 저장소에 넣지 않아요 (app/.site-key는 .gitignore에 있어요). 링크의 # 뒤 43글자가 곧 열쇠예요.
//   SITE_KEY=<열쇠 또는 링크> node app/build.cjs  → word-game/index.html 다시 쓰기 (SITE_KEY가 없으면 app/.site-key 파일의 열쇠로)
//   node app/build.cjs --new-key                  → 새 열쇠를 만들어 app/.site-key에 두고 그 열쇠로 쓰기 (예전 링크로는 더 이상 안 열려요)
//   node app/build.cjs --link                     → 지금 열쇠로 공유 링크 보여 주기
//   node app/build.cjs --check                    → 지금 index.html이 src와 같은지만 확인 (열쇠 없이 돼요. 다르면 실패)
// src/NN-이름.js 파일들은 번호 순서대로 하나의 <script>로 이어 붙여요 (모두 같은 전역 범위에서 돌아요).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const src = path.join(__dirname, 'src');
const out = path.join(__dirname, '..', 'word-game', 'index.html');
const keyFile = path.join(__dirname, '.site-key');
const SITE_URL = 'https://areweloststars.github.io/-/word-game/';
const MARKS = { css: '/*@@STYLES@@*/\n', js: '/*@@SCRIPT@@*/\n', site: '/*@@SITE@@*/null' };

// 조각들: 껍데기 HTML, CSS, 이어 붙인 JS (테스트도 이 JS를 그대로 실행해요)
function parts() {
  const read = f => fs.readFileSync(path.join(src, f), 'utf8');
  const js = fs.readdirSync(src).filter(f => /^\d\d-[\w-]+\.js$/.test(f)).sort().map(read).join('');
  const shell = read('shell.html');
  for (const mark of [MARKS.css, MARKS.js]) if (shell.split(mark).length !== 2) throw new Error(`shell.html needs exactly one ${mark.trim()}`);
  return { shell, css: read('styles.css'), js };
}
// 잠그기 전의 게임 페이지 (테스트는 이것을 그대로 띄워요)
function build() {
  const p = parts();
  // 바꿔 넣을 글에 '$'가 있어도 그대로 들어가도록 함수로 바꿈
  return p.shell.replace(MARKS.css, () => p.css).replace(MARKS.js, () => p.js);
}
const sum = html => crypto.createHash('sha256').update(html).digest('hex');
const b64u = buf => Buffer.from(buf).toString('base64url');
// 열쇠: 32바이트를 base64url로 쓴 43글자. 링크 전체를 넣어도 # 뒤만 씀
function keyFrom(s) {
  const m = String(s || '').trim().match(/(?:^|[#&])(?:k=)?([A-Za-z0-9_-]{43})(?=$|&)/);
  return m ? Buffer.from(m[1], 'base64url') : null;
}
const linkOf = key => `${SITE_URL}#k=${b64u(key)}`;
// 잠근 페이지: 같은 게임·같은 열쇠면 늘 같은 파일이 되도록 IV를 (열쇠, 게임)의 HMAC에서 얻어요 (다시 만들어도 쓸데없이 바뀌지 않게)
function seal(html, key) {
  if (!key || key.length !== 32) throw new Error('site key must be 32 bytes');
  const iv = crypto.createHmac('sha256', key).update(html).digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(html, 'utf8'), c.final(), c.getAuthTag()]);
  const site = JSON.stringify({ v: 1, sum: sum(html), iv: b64u(iv), data: data.toString('base64') });
  const lock = fs.readFileSync(path.join(src, 'lock.html'), 'utf8');
  if (lock.split(MARKS.site).length !== 2) throw new Error(`lock.html needs exactly one ${MARKS.site}`);
  return lock.replace(MARKS.site, () => site);
}
// 잠근 페이지에 적힌 원래 게임의 지문 (열쇠 없이 최신인지 확인할 때)
const sumOf = page => (String(page).match(/"sum":"([0-9a-f]{64})"/) || [])[1] || '';
// 잠근 페이지를 열쇠로 풀기 (테스트용)
function unseal(page, key) {
  const site = JSON.parse(String(page).match(/const SITE = (\{.*?\});/)[1]);
  const data = Buffer.from(site.data, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(site.iv, 'base64url'));
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8');
}
module.exports = { build, parts, out, seal, unseal, sumOf, sum, keyFrom, linkOf };

if (require.main === module) {
  const html = build();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (sumOf(cur) !== sum(html)) {
      console.error('word-game/index.html is out of date. Run: SITE_KEY=<링크의 # 뒤 열쇠> node app/build.cjs');
      process.exit(1);
    }
    console.log('word-game/index.html is up to date');
  } else {
    let key = keyFrom(process.env.SITE_KEY) || (fs.existsSync(keyFile) ? keyFrom(fs.readFileSync(keyFile, 'utf8')) : null);
    if (process.argv.includes('--new-key')) { key = crypto.randomBytes(32); fs.writeFileSync(keyFile, b64u(key) + '\n', { mode: 0o600 }); }
    if (!key) {
      console.error('사이트 열쇠가 없어요. SITE_KEY=<공유 링크 또는 # 뒤 열쇠> node app/build.cjs 로 실행하세요. (처음이면 --new-key: 예전 링크는 안 열려요)');
      process.exit(1);
    }
    if (process.argv.includes('--link')) { console.log(linkOf(key)); process.exit(0); }
    fs.writeFileSync(out, seal(html, key));
    console.log(`built word-game/index.html (game ${html.length} chars, locked)`);
  }
}
