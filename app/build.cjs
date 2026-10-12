// word-game/index.html을 app/src에서 만들어요. 손으로 index.html을 고치지 말고 src를 고친 뒤 이 파일을 실행하세요.
// 사이트에는 게임을 잠근 페이지(src/lock.html)가 올라가요: 게임 전체를 AES-GCM으로 잠그고, 열쇠는 공유 링크의 # 뒤에만 있어요.
// 열쇠는 저장소에 넣지 않아요 (app/.site-key는 .gitignore에 있어요). 링크의 # 뒤 43글자가 곧 열쇠예요.
// 주인의 단어장(교재 단어로 만든 이야기 단어장)은 app/decks.enc에 같은 열쇠로 잠가 두고, 잠근 게임 안에만 넣어요.
//   SITE_KEY=<열쇠 또는 링크> node app/build.cjs  → word-game/index.html 다시 쓰기 (SITE_KEY가 없으면 app/.site-key 파일의 열쇠로)
//   node app/build.cjs --decks-out <폴더>          → app/decks.enc를 풀어 단어장마다 <id>.json으로 쓰기 (고칠 때. 폴더는 저장소 밖이나 .gitignore 안에)
//   node app/build.cjs --decks-in <폴더>           → 폴더의 *.json을 app/decks.enc로 잠그고 다시 빌드
//   node app/build.cjs --new-key                  → 새 열쇠를 만들어 app/.site-key에 두고 그 열쇠로 쓰기 (예전 링크로는 더 이상 안 열려요)
//   node app/build.cjs --link                     → 지금 열쇠로 공유 링크 보여 주기
//   node app/build.cjs --check                    → 지금 index.html이 src·decks.enc와 같은지만 확인 (열쇠 없이 돼요. 다르면 실패)
// src/NN-이름.js 파일들은 번호 순서대로 하나의 <script>로 이어 붙여요 (모두 같은 전역 범위에서 돌아요).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const src = path.join(__dirname, 'src');
const out = path.join(__dirname, '..', 'word-game', 'index.html');
const keyFile = path.join(__dirname, '.site-key');
const decksFile = path.join(__dirname, 'decks.enc');
const SITE_URL = 'https://areweloststars.github.io/-/word-game/';
const MARKS = { css: '/*@@STYLES@@*/\n', js: '/*@@SCRIPT@@*/\n', site: '/*@@SITE@@*/null', decks: '/*@@DECKS@@*/[]' };

// 조각들: 껍데기 HTML, CSS, 이어 붙인 JS (테스트도 이 JS를 그대로 실행해요)
function parts() {
  const read = f => fs.readFileSync(path.join(src, f), 'utf8');
  const js = fs.readdirSync(src).filter(f => /^\d\d-[\w-]+\.js$/.test(f)).sort().map(read).join('');
  const shell = read('shell.html');
  for (const mark of [MARKS.css, MARKS.js]) if (shell.split(mark).length !== 2) throw new Error(`shell.html needs exactly one ${mark.trim()}`);
  if (js.split(MARKS.decks).length !== 2) throw new Error(`the scripts need exactly one ${MARKS.decks}`);
  return { shell, css: read('styles.css'), js };
}
// 잠그기 전의 게임 페이지, 주인 단어장은 빈 채로 (테스트는 이것을 그대로 띄워요)
function build() {
  const p = parts();
  // 바꿔 넣을 글에 '$'가 있어도 그대로 들어가도록 함수로 바꿈
  return p.shell.replace(MARKS.css, () => p.css).replace(MARKS.js, () => p.js);
}
const sum = text => crypto.createHash('sha256').update(text).digest('hex');
const b64u = buf => Buffer.from(buf).toString('base64url');
// 열쇠: 32바이트를 base64url로 쓴 43글자. 링크 전체를 넣어도 # 뒤만 씀
function keyFrom(s) {
  const m = String(s || '').trim().match(/(?:^|[#&])(?:k=)?([A-Za-z0-9_-]{43})(?=$|&)/);
  return m ? Buffer.from(m[1], 'base64url') : null;
}
const linkOf = key => `${SITE_URL}#k=${b64u(key)}`;
// 잠그기: 같은 글·같은 열쇠면 늘 같은 결과가 되도록 IV를 (열쇠, 글)의 HMAC에서 얻어요 (다시 만들어도 쓸데없이 바뀌지 않게)
function encrypt(text, key) {
  if (!key || key.length !== 32) throw new Error('site key must be 32 bytes');
  const iv = crypto.createHmac('sha256', key).update(text).digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  return { iv: b64u(iv), data: Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]).toString('base64') };
}
function decrypt(box, key) {
  const data = Buffer.from(box.data, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64url'));
  d.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8');
}
// 주인 단어장 파일(app/decks.enc) ↔ 단어장 배열
const lockDecks = (decks, key) => JSON.stringify(Object.assign({ v: 1 }, encrypt(JSON.stringify(decks), key))) + '\n';
const openDecks = (text, key) => JSON.parse(decrypt(JSON.parse(text), key));
// 잠근 페이지: 주인 단어장을 게임에 넣고 통째로 잠가 lock.html에 담아요.
// sum = 단어장을 넣기 전 게임의 지문, decks = decks.enc 파일의 지문 (열쇠 없이 최신인지 확인할 때 써요)
function seal(html, key, decks = [], decksSum = '') {
  if (html.split(MARKS.decks).length !== 2) throw new Error(`game page needs exactly one ${MARKS.decks}`);
  const game = html.replace(MARKS.decks, () => JSON.stringify(decks).replace(/</g, '\\u003c'));
  const box = encrypt(game, key);
  const site = JSON.stringify({ v: 1, sum: sum(html), decks: decksSum, iv: box.iv, data: box.data });
  const lock = fs.readFileSync(path.join(src, 'lock.html'), 'utf8');
  if (lock.split(MARKS.site).length !== 2) throw new Error(`lock.html needs exactly one ${MARKS.site}`);
  return lock.replace(MARKS.site, () => site);
}
const field = (page, k) => (String(page).match(new RegExp(`"${k}":"([0-9a-f]*)"`)) || [])[1];
const sumOf = page => field(page, 'sum') || '';
const decksSumOf = page => field(page, 'decks') || '';
// 잠근 페이지를 열쇠로 풀기 (테스트·확인용)
const unseal = (page, key) => decrypt(JSON.parse(String(page).match(/const SITE = (\{.*?\});/)[1]), key);
module.exports = { build, parts, out, seal, unseal, sumOf, decksSumOf, sum, keyFrom, linkOf, lockDecks, openDecks };

if (require.main === module) {
  const html = build(), arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
  const decksText = () => fs.existsSync(decksFile) ? fs.readFileSync(decksFile, 'utf8') : '';
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', dt = decksText();
    if (sumOf(cur) !== sum(html) || decksSumOf(cur) !== (dt ? sum(dt) : '')) {
      console.error('word-game/index.html is out of date. Run: SITE_KEY=<링크의 # 뒤 열쇠> node app/build.cjs');
      process.exit(1);
    }
    console.log('word-game/index.html is up to date');
  } else {
    let key = keyFrom(process.env.SITE_KEY) || (fs.existsSync(keyFile) ? keyFrom(fs.readFileSync(keyFile, 'utf8')) : null);
    if (process.argv.includes('--new-key')) {
      // 주인 단어장은 예전 열쇠로 풀어서 새 열쇠로 다시 잠가요
      const dt = decksText(), decks = dt ? (key ? openDecks(dt, key) : null) : [];
      if (!decks) { console.error('app/decks.enc를 풀 예전 열쇠가 없어요. SITE_KEY=<예전 링크>와 함께 실행하세요.'); process.exit(1); }
      key = crypto.randomBytes(32); fs.writeFileSync(keyFile, b64u(key) + '\n', { mode: 0o600 });
      if (dt) fs.writeFileSync(decksFile, lockDecks(decks, key));
    }
    if (!key) {
      console.error('사이트 열쇠가 없어요. SITE_KEY=<공유 링크 또는 # 뒤 열쇠> node app/build.cjs 로 실행하세요. (처음이면 --new-key: 예전 링크는 안 열려요)');
      process.exit(1);
    }
    if (process.argv.includes('--link')) { console.log(linkOf(key)); process.exit(0); }
    if (arg('--decks-out')) {
      const dir = arg('--decks-out'), dt = decksText();
      fs.mkdirSync(dir, { recursive: true });
      for (const d of dt ? openDecks(dt, key) : []) fs.writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(d, null, 1) + '\n');
      console.log(`wrote decks to ${dir}`); process.exit(0);
    }
    if (arg('--decks-in')) {
      const dir = arg('--decks-in');
      const decks = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      for (const d of decks) if (!d || !d.id || !Array.isArray(d.scenes) || !d.words) throw new Error('not a deck: ' + JSON.stringify(d).slice(0, 80));
      fs.writeFileSync(decksFile, lockDecks(decks, key));
      console.log(`locked ${decks.length} deck(s) into app/decks.enc`);
    }
    const dt = decksText();
    fs.writeFileSync(out, seal(html, key, dt ? openDecks(dt, key) : [], dt ? sum(dt) : ''));
    console.log(`built word-game/index.html (game ${html.length} chars, locked${dt ? ', with private decks' : ''})`);
  }
}
