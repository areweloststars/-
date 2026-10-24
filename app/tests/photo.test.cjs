// 사진 읽기 점검: 단어 목록을 찍거나 캡처한 흔한 모양으로 직접 만든 합성 사진(일반 사전 낱말 + 직접 쓴 뜻, photo-looks.cjs)을
// 진짜 브라우저에서 게임의 사진 읽기로 읽고, 모양마다 맞은 단어 수가 기준 아래로 떨어지지 않는지 봐요.
// 다크 모드 채팅 답, 어두운 책상 위 기운 두 단 목록, 옆으로 찍은 칸 표, 아이콘 옆 단어 + 아랫줄 뜻, 품사 칸이 있는 표.
// 모든 모양: node app/tests/photo-looks.cjs --all. Playwright가 없는 컴퓨터에서는 건너뛰어요
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, seal } = require('../build.cjs');
const { FORMATS, runLooks } = require('./photo-looks.cjs');

let pw = null;
for (const p of ['playwright', path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'playwright')]) { try { pw = require(p); break; } catch (e) { } }
const exe = (() => { try { return pw && pw.chromium.executablePath(); } catch (e) { return ''; } })();
const skip = !pw ? 'Playwright가 없어요' : !(exe && fs.existsSync(exe)) ? 'Playwright Chromium이 없어요' : false;

test('photo reading: look-alike word-list photos and screenshots keep enough words right', { skip, timeout: 600000 }, async t => {
  const k = crypto.randomBytes(32);
  const res = await runLooks(pw, FORMATS.filter(f => f.quick), { locked: seal(build(), k), key: k.toString('base64url'), log: m => t.diagnostic(m) });
  const by = Object.fromEntries(res.map(r => [r.id, r]));
  for (const r of res) assert.ok(r.ok >= r.min, `${r.id}: ${r.ok}/${r.n} (기준 ${r.min}) 틀림: ${r.miss.join(' | ')}`);
  const row = (id, en) => (by[id].rows.find(x => x.en.toLowerCase() === en) || {}).ko || '';
  // 뜻 첫 글자 동·명·부·형을 품사 표시로 지우지 않음 ('부정직한'이 '정직한'이 되면 반대 뜻)
  assert.equal(row('chat-dark-share', 'subsidiary'), '부수적인, 자회사');
  assert.equal(row('photo-table-sideways', 'east'), '동쪽');
  assert.match(row('photo-table-sideways', 'kitchen'), /^부/);
  assert.match(row('photo-table-sideways', 'awful'), /^형편\s?없는/);
  // 단어 옆 아이콘을 뜻으로 읽지 않고 아랫줄 뜻을, 품사 칸('noun')이 아니라 뜻 칸을
  assert.equal(row('shot-icons-below', 'decide'), '결정하다');
  assert.equal(row('shot-icons-below', 'danger'), '위험');
  assert.equal(row('pc-table-pos', 'danger'), '위험');
  // '단어 — 뜻'의 줄표는 뜻에 넣지 않고, 휴대폰 화면 글자(입력 칸·상태 표시줄)는 단어 줄이 아님
  for (const r of res) for (const x of r.rows) assert.doesNotMatch(x.ko, /^[-–—ㅡ]/, `${r.id}: ${x.en} → ${x.ko}`);
  assert.ok(!by['chat-dark-share'].rows.some(x => /chatgpt|skt|답변하기/i.test(x.en + ' ' + x.ko)), JSON.stringify(by['chat-dark-share'].rows));
  assert.deepEqual(res.errors, []);
});
