// 이야기 서버로 만들기 (10-server-make.js): 묶음 후보 모으기 → 사람이 고르기 → 고른 묶음만 이야기. 서버는 가짜 fetch로 흉내 내요.
const test = require('node:test');
const assert = require('node:assert');
const { bootPage } = require('./page.cjs');

const WORDS = [['mix', '섞다'], ['taste', '맛보다'], ['serve', '대접하다'], ['borrow', '빌리다'], ['repair', '수리하다'], ['protect', '보호하다'], ['quiet', '조용한'], ['solve', '풀다'], ['journey', '여행'], ['honest', '정직한']];
const sse = (content, reasoning) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: content || '', reasoning: reasoning || '' } }] }) + '\n\ndata: ' + JSON.stringify({ usage: { neurons: 100 } }) + '\n\ndata: [DONE]\n';
const GROUPS = JSON.stringify({ groups: [
  { scene: '아이가 부엌에서 간식을 만든다.', words: [{ word: 'mix', event: '아이가 반죽을 섞는다.' }, { word: 'taste', event: '아이가 맛본다.' }, { word: 'serve', event: '아이가 친구에게 대접한다.' }, { word: 'quiet', event: '부엌이 조용하다.' }] },
  { scene: '아이가 빌린 책을 고친다.', words: [{ word: 'borrow', event: '책을 빌린다.' }, { word: 'repair', event: '책을 수리한다.' }, { word: 'protect', event: '책을 보호한다.' }, { word: 'taste', event: '과자를 맛본다.' }] },
  { scene: '세 단어뿐인 묶음', words: [{ word: 'solve', event: '문제를 푼다.' }, { word: 'journey', event: '여행을 간다.' }, { word: 'honest', event: '정직하게 말한다.' }] },
  { scene: '모르는 단어가 든 묶음', words: [{ word: 'zebra', event: '얼룩말' }, { word: 'solve', event: '푼다' }] }
], leftover: ['journey'] });
const STORY = ['제목: 간식 만들기', '줄거리: 아이가 간식을 만들어요.', '이야기:', '민지는 부엌에서 간식을 만들기로 했어요.', '민지는 밀가루와 우유를 그릇에 넣고 섞었어요.', '민지는 숟가락으로 반죽을 조금 맛보았어요.', '부엌은 아주 조용한 곳이었어요.', '민지는 친구에게 간식을 대접했어요.', '둘은 맛있게 먹었어요.', '그림:', 'mix: 그릇에 반죽을 섞는 아이', 'taste: 숟가락으로 맛보는 아이', '조용한: 조용한 부엌', 'serve: 접시를 건네는 아이'].join('\n');

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

test('묶음 후보: 3번 물어 모으고, 4~5개짜리·이 단어장 단어만 후보로 (같은 묶음은 한 번만)', async () => {
  const { p, calls } = setup([{ content: GROUPS }]);
  p.run(`svCollect(SV_ROUNDS)`);
  await wait(p, `MK.step === 'srvpick'`);
  assert.strictEqual(calls.length, 3);
  assert.ok(calls.every(c => c.url === 'https://srv.example.test/group' && c.auth === 'Bearer test-token-1234'));
  assert.deepStrictEqual(Object.keys(calls[0].body).sort(), ['effort', 'size', 'stream', 'words']);
  assert.strictEqual(calls[0].body.size, 4);
  assert.strictEqual(calls[0].body.words.length, 10);
  assert.strictEqual(p.json(`SRV.cands.length`), 2);
  assert.strictEqual(p.document.querySelectorAll('#make .svcand').length, 2);
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

test('고른 묶음만 이야기로: 표시를 붙이고, 고르지 않은 단어는 이야기 없이 넣어요', async () => {
  const { p, calls } = setup([{ content: GROUPS }, { content: GROUPS }, { content: GROUPS }, { content: STORY }]);
  p.run(`svCollect(SV_ROUNDS)`);
  await wait(p, `MK.step === 'srvpick'`);
  p.document.querySelector('#make .svcand[data-i="0"]').click();
  p.document.querySelector('#make [data-mk="svmake"]').click();
  await wait(p, `MK.step === 'done'`);
  const st = calls[3];
  assert.strictEqual(st.url, 'https://srv.example.test/story');
  assert.deepStrictEqual(Object.keys(st.body).sort(), ['effort', 'format', 'scene', 'stream', 'words']);
  assert.deepStrictEqual(st.body.words.map(w => w[0]), ['mix', 'taste', 'serve', 'quiet']);
  assert.ok(st.body.scene.startsWith('장면: 아이가 부엌에서 간식을 만든다.'));
  const d = p.json(`MK.deck`);
  assert.strictEqual(Object.keys(d.words).length, 10);
  assert.strictEqual(d.scenes[0].title, '간식 만들기');
  assert.deepStrictEqual(d.scenes[0].words.slice().sort(), ['mix', 'quiet', 'serve', 'taste']);
  for (const en of ['mix', 'taste', 'serve', 'quiet']) assert.ok(d.scenes[0].lines.some(l => l.includes('{' + en + '|')), en);
  assert.ok(!d.scenes[0].lines.some(l => l.includes('잊지 말아야')));
  assert.strictEqual(d.words.mix.pic, '그릇에 반죽을 섞는 아이');
  assert.strictEqual(d.words.quiet.pic, '조용한 부엌');
  // 나머지 6단어는 이야기 없는 단어 미션
  assert.deepStrictEqual(d.scenes.slice(1).flatMap(s => s.words).sort(), ['borrow', 'honest', 'journey', 'protect', 'repair', 'solve']);
  assert.ok(d.scenes[1].title.startsWith('단어 미션'));
  assert.deepStrictEqual(p.errors, []);
  p.close();
});

test('하루 한도(429): 후보를 못 받았으면 확인 화면으로, 이야기 쓰다 걸리면 이야기 없이 넣고 알려요', async () => {
  const a = setup([{ status: 429 }]);
  a.p.run(`svCollect(SV_ROUNDS)`);
  await wait(a.p, `MK.step === 'review'`);
  assert.strictEqual(a.calls.length, 1);
  assert.ok(a.p.run(`MK.err`).includes('무료 한도'));
  a.p.close();
  const b = setup([{ content: GROUPS }, { status: 429 }]);
  b.p.run(`svCollect(1)`);
  await wait(b.p, `MK.step === 'srvpick'`);
  b.p.run(`SRV.picked.add(0); svMake()`);
  await wait(b.p, `MK.step === 'done'`);
  const d = b.p.json(`MK.deck`);
  assert.strictEqual(Object.keys(d.words).length, 10);
  assert.ok(d.scenes.every(s => s.title.startsWith('단어 미션')));
  assert.ok(b.p.run(`MK.aiNote`).includes('무료 한도'));
  b.p.close();
});
