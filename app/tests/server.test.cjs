// 이야기 서버(server/story-worker/worker.mjs): 가짜 AI로 문지기(열쇠·사이트·크기·칸)와 답 읽기를 시험해요.
// 서버는 단어 글자만 받아요. 사진(data: 주소, 큰 파일, 다른 칸)은 거절해야 해요.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'story-worker', 'worker.mjs')).href).then(m => m.default);
const WORDS = [['lantern', '등불', 'n'], ['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['whisper', '속삭이다', 'v'], ['harvest', '수확', 'n'], ['encourage', '격려하다', 'v']];
const STORY = '제목: 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.\n끝 줄이에요.\n그림:\nlantern: a lantern';

function fakeEnv(answer = { response: STORY }, extra = {}) {
  const calls = [];
  return { calls, env: { WG_TOKEN: 'test-token-123', AI: { run: async (model, input) => { calls.push({ model, input }); return typeof answer === 'function' ? answer(model, input) : answer; } }, ...extra } };
}
const req = (body, { token = 'test-token-123', origin, type = 'application/json', method = 'POST', url = 'https://s.example/story' } = {}) => {
  const headers = { 'content-type': type };
  if (token) headers.authorization = 'Bearer ' + token;
  if (origin) headers.origin = origin;
  return new Request(url, { method, headers, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
};

test('story server: a right request gets the story text, words are sent to the AI with the rules', async () => {
  const w = await load(), { env, calls } = fakeEnv();
  const r = await w.fetch(req({ words: WORDS }), env);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.text, STORY);
  assert.equal(j.model, w._.MODELS[0]);
  assert.equal(calls.length, 1);
  const sent = JSON.stringify(calls[0].input);
  assert.match(sent, /lantern - 등불/);
  assert.match(sent, /이야기 8~10줄/);
});

test('story server: wrong or missing key, other sites, and unset server are refused', async () => {
  const w = await load(), { env, calls } = fakeEnv();
  assert.equal((await w.fetch(req({ words: WORDS }, { token: 'nope' }), env)).status, 401);
  assert.equal((await w.fetch(req({ words: WORDS }, { token: '' }), env)).status, 401);
  assert.equal((await w.fetch(req({ words: WORDS }, { origin: 'https://evil.example' }), env)).status, 403);
  const ok = await w.fetch(req({ words: WORDS }, { origin: 'https://areweloststars.github.io' }), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://areweloststars.github.io');
  const pre = await w.fetch(new Request('https://s.example/story', { method: 'OPTIONS', headers: { origin: 'https://areweloststars.github.io' } }), env);
  assert.equal(pre.status, 204);
  assert.equal((await w.fetch(req({ words: WORDS }), { AI: env.AI })).status, 503);
  assert.equal(calls.length, 1);
});

test('story server: photos and anything that is not word text are refused before the AI', async () => {
  const w = await load(), { env, calls } = fakeEnv();
  const png = 'data:image/png;base64,' + 'A'.repeat(3000);
  const bad = [
    req({ words: WORDS, photo: 'x' }),
    req({ words: WORDS, image: png }),
    req({ words: [...WORDS.slice(0, 5), ['img', png]] }),
    req({ words: [...WORDS.slice(0, 5), ['data:image/png;base64,AAAA', '그림']] }),
    req({ words: [...WORDS.slice(0, 5), [{ en: 'cat', ko: '고양이', image: 'x' }]] }),
    req({ words: [...WORDS.slice(0, 5), { en: 'cat', ko: '고양이', image: 'x' }] }),
    req({ words: [...WORDS.slice(0, 5), ['cat', '{고양이|x}']] }),
    req({ words: WORDS.slice(0, 2) }),
    req({ words: [...WORDS, ...WORDS] }),
    req({ words: [...WORDS.slice(0, 5), ['lantern', '랜턴']] }),
    req({ words: WORDS, model: '@cf/someone/else' }),
    req('not json'),
    req([1, 2, 3]),
    req(JSON.stringify({ words: WORDS }), { type: 'image/png' }),
    req(JSON.stringify({ words: WORDS }), { type: 'multipart/form-data; boundary=x' })
  ];
  for (const b of bad) assert.ok([400, 413, 415].includes((await w.fetch(b, env)).status));
  assert.equal(calls.length, 0);
  const big = await w.fetch(req(JSON.stringify({ words: WORDS, pad: ' '.repeat(5000) })), env);
  assert.equal(big.status, 413);
});

test('story server: other paths and methods', async () => {
  const w = await load(), { env } = fakeEnv();
  assert.equal((await w.fetch(new Request('https://s.example/'), env)).status, 200);
  assert.equal((await w.fetch(new Request('https://s.example/nope'), env)).status, 404);
  assert.equal((await w.fetch(new Request('https://s.example/story'), env)).status, 405);
});

test('story server: reads chat, responses and thinking answers; picks a listed model', async () => {
  const w = await load(), t = w._.textOf;
  assert.equal(t({ response: 'a' }), 'a');
  assert.equal(t({ choices: [{ message: { content: 'b' } }] }), 'b');
  assert.equal(t({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'think' }] }, { type: 'message', content: [{ type: 'output_text', text: 'c' }] }] }), 'c');
  assert.equal(w._.clean('<think>hmm</think>\n제목: x'), '제목: x');
  // gpt-oss는 Responses 꼴로 묻고, 안 되면 채팅 꼴로 다시
  const { env, calls } = fakeEnv((model, input) => { if (input.input) throw new Error('bad input'); return { response: STORY }; });
  const r = await w.fetch(req({ words: WORDS, model: '@cf/openai/gpt-oss-20b' }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map(c => Object.keys(c.input)[0]), ['instructions', 'messages']);
  // WG_MODELS로 목록을 바꾸면 그 목록만
  const e2 = fakeEnv(undefined, { WG_MODELS: '@cf/a/one, @cf/b/two', WG_MODEL: '@cf/b/two' });
  const r2 = await w.fetch(req({ words: WORDS }), e2.env);
  assert.equal((await r2.json()).model, '@cf/b/two');
  assert.equal((await w.fetch(req({ words: WORDS, model: '@cf/openai/gpt-oss-120b' }), e2.env)).status, 400);
  // 하루 한도를 넘으면 429
  const e3 = fakeEnv(() => { throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); });
  assert.equal((await w.fetch(req({ words: WORDS }), e3.env)).status, 429);
});

test('story server: the example story in the rules passes the app checker', async () => {
  const w = await load();
  const { parse, check, bootPage } = require('../../tools/finetune/v3/check.cjs');
  const ex = w._.RULES.split('답:\n')[1];
  const words = [['shepherd', '양치기', 'n'], ['bored', '심심한', 'a'], ['shout', '외치다', 'v'], ['villager', '마을 사람', 'n'], ['believe', '믿다', 'v'], ['regret', '후회하다', 'v']];
  const p = bootPage();
  try {
    const r = check(p, words, parse(ex), true);
    assert.deepEqual(r.why, []);
  } finally { p.close(); }
});
