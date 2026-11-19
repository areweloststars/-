// 이야기 서버로 만들기 (10-server-make.js): 묶음 후보 모으기 → 사람이 고르기 → 고른 묶음만 이야기. 서버는 가짜 fetch로 흉내 내요.
const test = require('node:test');
const assert = require('node:assert');
const { bootPage } = require('./page.cjs');

const WORDS = [['mix', '섞다'], ['taste', '맛보다'], ['serve', '대접하다'], ['borrow', '빌리다'], ['repair', '수리하다'], ['protect', '보호하다'], ['quiet', '조용한'], ['solve', '풀다'], ['journey', '여행'], ['honest', '정직한']];
const sse = (content, reasoning) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: content || '', reasoning: reasoning || '' } }] }) + '\n\ndata: ' + JSON.stringify({ usage: { neurons: 100 } }) + '\n\ndata: [DONE]\n';
const KITCHEN = ['민지는 부엌에서 간식을 만들기로 했어요.', '민지는 밀가루와 우유를 그릇에 넣고 섞었어요.', '그래서 숟가락으로 반죽을 조금 맛보았어요.', '부엌은 아주 조용한 곳이었어요.', '민지는 친구에게 간식을 대접했어요.', '둘은 맛있게 먹었어요.'];
const GROUPS = JSON.stringify({ groups: [
  { scene: '아이가 부엌에서 간식을 만든다.', title: '간식 만들기', story: KITCHEN, words: [{ word: 'mix', event: KITCHEN[1] }, { word: 'taste', event: KITCHEN[2] }, { word: 'serve', event: KITCHEN[4] }, { word: 'quiet', event: KITCHEN[3] }] },
  { scene: '아이가 빌린 책을 고친다.', title: '찢어진 책', story: ['준이는 도서관에 갔어요.', '준이는 책을 한 권 빌렸어요.', '그런데 책이 찢어져서 테이프로 수리했어요.', '준이는 책을 비닐로 싸서 보호했어요.', '그리고 과자를 조금 맛보았어요.', '책은 다시 깨끗해졌어요.'], words: ['borrow', 'repair', 'protect', 'taste'].map(word => ({ word })) },
  { scene: '세 단어뿐인 묶음', title: '셋', story: ['가', '나', '다', '라'], words: [{ word: 'solve' }, { word: 'journey' }, { word: 'honest' }] },
  { scene: '이야기에 단어가 빠진 묶음', title: '빠짐', story: ['하나는 길을 떠났어요.', '하나는 문제를 풀었어요.', '하나는 여행을 했어요.', '하나는 집에 왔어요.', '끝났어요.'], words: ['solve', 'journey', 'honest', 'borrow'].map(word => ({ word })) },
  { scene: '외국어가 섞인 묶음', title: '섞임', story: ['준이는 길을 떠났어요.', '준이는 문제를 풀었어요.', '그래서 여행을 했어요.', '준이는 정직한 아이였어요.', '준이는 책을 빌렸어요.', '준이는 sorriso 지었어요.'], words: ['solve', 'journey', 'honest', 'borrow'].map(word => ({ word })) },
  { scene: '모르는 단어가 든 묶음', words: [{ word: 'zebra', event: '얼룩말' }, { word: 'solve', event: '푼다' }] }
], leftover: ['journey'] });

// 가짜 서버: calls에 받은 요청을 적고, plan(차례대로)의 답을 줘요
function fakeServer(p, plan) {
  const calls = [];
  p.window.fetch = async (url, opt) => {
    const body = JSON.parse(opt.body), step = plan[Math.min(calls.length, plan.length - 1)];
    calls.push({ url: String(url), auth: opt.headers.authorization, body });
    if (step.status) return { ok: false, status: step.status, headers: { get: () => 'application/json' }, json: async () => ({ error: 'x' }), text: async () => '' };
    return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, text: async () => sse(step.content, step.reasoning), json: async () => ({}) };
  };
  return calls;
}
function setup(plan) {
  const p = bootPage();
  p.run(`localStorage.setItem('wg-srv', JSON.stringify({ api: 'https://srv.example.test', token: 'test-token-1234' }))`);
  const calls = fakeServer(p, plan);
  p.run(`openMake(); MK.rows = ${JSON.stringify(WORDS.map(([en, ko]) => ({ en, ko, pos: 'x' })))}; MK.name = '시험'; MK.step = 'review'; renderMake();`);
  return { p, calls };
}
const wait = async (p, cond, ms = 4000) => { for (let t = 0; t < ms; t += 20) { if (p.run(cond)) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('기다리다 끝남: ' + cond); };

test('서버 주소·열쇠: https 주소만 받고 이 기기에만 저장해요', () => {
  const p = bootPage();
  assert.ok(p.run(`svSave('http://a.example.test', 'abcdefgh1234')`));
  assert.ok(p.run(`svSave('https://a.example.test', 'short')`));
  assert.strictEqual(p.run(`svSave('a.example.test/', 'abcdefgh1234')`), '');
  assert.deepStrictEqual(p.json(`svConf()`), { api: 'https://a.example.test', token: 'abcdefgh1234' });
  p.close();
});

test('이야기 후보: 3번 물어 모으고, 4~5개짜리·단어가 모두 이야기에 든 것만 후보로 (같은 묶음은 한 번만)', async () => {
  const { p, calls } = setup([{ content: GROUPS }]);
  p.run(`svCollect(SV_ROUNDS)`);
  await wait(p, `MK.step === 'srvpick'`);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every(c => c.url === 'https://srv.example.test/group' && c.auth === 'Bearer test-token-1234'));
  assert.deepStrictEqual(Object.keys(calls[0].body).sort(), ['effort', 'size', 'story', 'stream', 'words']);
  assert.strictEqual(calls[0].body.story, true);
  assert.strictEqual(calls[0].body.size, 4);
  assert.strictEqual(calls[0].body.words.length, 10);
  assert.strictEqual(p.json(`SRV.cands.length`), 2);
  assert.strictEqual(p.document.querySelectorAll('#make .svcand').length, 2);
  // 후보 카드에 이야기 전체가 보이고, 단어 자리에 표시가 있어요
  const card = p.document.querySelector('#make .svcand[data-i="0"]');
  assert.strictEqual(card.querySelectorAll('.svstory > span').length, 6);
  assert.deepStrictEqual([...card.querySelectorAll('.svmark small')].map(x => x.textContent).sort(), ['mix', 'quiet', 'serve', 'taste']);
  assert.ok(card.textContent.includes('둘은 맛있게 먹었어요.'));
  // 첫 묶음을 고르면 단어(taste)가 겹치는 둘째 묶음은 고를 수 없어요
  p.document.querySelector('#make .svcand[data-i="0"]').click();
  assert.ok(p.document.querySelector('#make .svcand[data-i="1"]').disabled);
  assert.ok(!p.document.querySelector('#make [data-mk="svmake"]').disabled);
  assert.deepStrictEqual(p.errors, []);
  p.close();
});

test('끊기면 이어 생각하기: 생각 글을 메모로 보내고, 끝내 생각 끔이면 생각 칸의 글을 답으로', async () => {
  const { p, calls } = setup([{ content: '', reasoning: '부엌 묶음을 생각하는 중' }, { content: '', reasoning: '더 생각' }, { content: '', reasoning: '또 생각' }, { content: '', reasoning: GROUPS }]);
  p.run(`svCollect(1)`);
  await wait(p, `MK.step === 'srvpick'`);
  assert.strictEqual(calls.length, 4);
  assert.ok(!('notes' in calls[0].body));
  assert.ok(calls[1].body.notes.includes('부엌 묶음을 생각하는 중') && calls[1].body.effort === 'medium');
  assert.strictEqual(calls[3].body.effort, 'none');
  assert.strictEqual(p.json(`SRV.cands.length`), 2);
  p.close();
});

test('고른 이야기가 그대로 에피소드로: 서버를 더 부르지 않고, 고르지 않은 단어는 이야기 없이 넣어요', async () => {
  const { p, calls } = setup([{ content: GROUPS }]);
  p.run(`svCollect(SV_ROUNDS)`);
  await wait(p, `MK.step === 'srvpick'`);
  p.document.querySelector('#make .svcand[data-i="0"]').click();
  p.document.querySelector('#make [data-mk="svmake"]').click();
  await wait(p, `MK.step === 'done'`);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every(c => c.url.endsWith('/group')));
  const d = p.json(`MK.deck`);
  assert.strictEqual(Object.keys(d.words).length, 10);
  assert.strictEqual(d.scenes[0].title, '간식 만들기');
  assert.deepStrictEqual(d.scenes[0].words.slice().sort(), ['mix', 'quiet', 'serve', 'taste']);
  assert.deepStrictEqual(d.scenes[0].lines.map(l => l.replace(/\{[^|]+\|([^}]+)\}/g, '$1')), KITCHEN);
  for (const en of ['mix', 'taste', 'serve', 'quiet']) assert.ok(d.scenes[0].lines.some(l => l.includes('{' + en + '|')), en);
  // 나머지 6단어는 이야기 없는 단어 미션
  assert.deepStrictEqual(d.scenes.slice(1).flatMap(s => s.words).sort(), ['borrow', 'honest', 'journey', 'protect', 'repair', 'solve']);
  assert.ok(d.scenes[1].title.startsWith('단어 미션'));
  assert.deepStrictEqual(p.errors, []);
  p.close();
});

test('하루 한도(429): 후보를 못 받았으면 확인 화면으로, 받은 후보가 있으면 그것으로 고르게 해요', async () => {
  const a = setup([{ status: 429 }]);
  a.p.run(`svCollect(SV_ROUNDS)`);
  await wait(a.p, `MK.step === 'review'`);
  assert.strictEqual(a.calls.length, 1);
  assert.ok(a.p.run(`MK.err`).includes('무료 한도'));
  a.p.close();
  const b = setup([{ content: GROUPS }, { status: 429 }]);
  b.p.run(`svCollect(SV_ROUNDS)`);
  await wait(b.p, `MK.step === 'srvpick'`);
  assert.strictEqual(b.calls.length, 2);
  assert.strictEqual(b.p.json(`SRV.cands.length`), 2);
  assert.ok(b.p.run(`SRV.note`).includes('무료 한도'));
  b.p.close();
});
