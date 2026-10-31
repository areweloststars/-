// 이야기 서버(server/story-worker/worker.mjs): 가짜 AI로 문지기(열쇠·사이트·크기·칸)와 답 읽기를 시험해요.
// 서버는 단어 글자만 받아요. 사진(data: 주소, 큰 파일, 다른 칸)은 거절해야 해요.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'story-worker', 'worker.mjs')).href).then(m => m.default);
const WORDS = [['lantern', '등불', 'n'], ['borrow', '빌리다', 'v'], ['brave', '용감한', 'a'], ['whisper', '속삭이다', 'v'], ['harvest', '수확', 'n'], ['encourage', '격려하다', 'v']];
const STORY = '제목: 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.\n가운데 줄이에요.\n끝 줄이에요.\n그림:\nlantern: a lantern';
// JSON 꼴 답 (5번): 서버가 뜻 말 자리에 {영어|뜻 말}을 넣고 그림을 이야기 차례로 놓아요
const JSTORY = {
  title: '등불 축제', plan: '한 줄.',
  lines: [
    { text: '마을에 축제가 열렸어요.', word: '', meaning: '' },
    { text: '소녀는 이웃에게 등불을 빌렸어요.', word: 'borrow', meaning: '빌렸어요.' },
    { text: '바람 속에서도 등불은 꺼지지 않았어요.', word: 'LANTERN', meaning: '등불' },
    { text: '친구가 {brave|용감한} 얼굴로 웃었어요.', word: 'brave', meaning: '용감한' },
    { text: '소녀는 작게 속삭였어요.', word: 'whisper', meaning: '속삭이다' }
  ],
  pictures: [{ word: 'lantern', scene: 'a paper lantern glowing' }, { word: 'borrow', scene: 'a girl borrowing a lantern' }, { word: 'brave', scene: 'a brave friend' }]
};
const JTEXT = ['제목: 등불 축제', '줄거리: 한 줄.', '이야기:', '마을에 축제가 열렸어요.', '소녀는 이웃에게 등불을 {borrow|빌렸어요}.',
  '바람 속에서도 {lantern|등불}은 꺼지지 않았어요.', '친구가 {brave|용감한} 얼굴로 웃었어요.', '소녀는 작게 속삭였어요.',
  '그림:', 'borrow: a girl borrowing a lantern', 'lantern: a paper lantern glowing', 'brave: a brave friend'].join('\n');
const sys = c => c.input.messages ? c.input.messages[0].content : c.input.instructions;
const usr = c => c.input.messages ? c.input.messages[1].content : c.input.input;

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
    req({ words: WORDS, model: 'gpt-4o' }),
    req({ words: WORDS, model: '@cf/x/y<script>' }),
    req({ words: WORDS, effort: 'xhigh' }),
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
  // 굵은 제목을 따로 한 줄에 쓰고 줄마다 번호를 붙인 답도 앱이 읽는 꼴로
  assert.equal(w._.clean('**제목**  \n등불 축제  \n\n**줄거리:** 한 줄.\n\n**이야기**\n1. 첫 줄이에요.\n2. 끝 줄이에요.\n\n### 그림\n- lantern: a lantern'),
    '제목: 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.\n끝 줄이에요.\n그림:\nlantern: a lantern');
  // gpt-oss가 생각 글을 답에 섞으면 마지막 '제목' 줄부터만
  const clean = '제목: 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.';
  assert.equal(w._.clean('analysis: We need 제목: 14자 이하.\n제목 rules...\nassistantfinal**제목:** 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.'), clean);
  assert.equal(w._.clean('analysis: plan the story\n제목: (생각 중)\n...\n제목: 등불 축제\n줄거리: 한 줄.\n이야기:\n첫 줄이에요.'), clean);
  // 망가진 답('!!!!…')이면 한 번 더 물어요
  let n = 0;
  const e0 = fakeEnv(() => (++n === 1 ? { response: '!'.repeat(200) } : { response: STORY }));
  assert.equal((await (await w.fetch(req({ words: WORDS }), e0.env)).json()).text, STORY);
  assert.equal(n, 2);
  assert.equal((await w.fetch(req({ words: WORDS, effort: 'max' }), e0.env)).status, 400);
  // 빈 답이면 답의 꼴만 돌려줘요 (단어·답 글은 넣지 않아요), 답이 있으면 쓴 토큰 수도
  const e4 = fakeEnv({ choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'x'.repeat(50) } }], usage: { prompt_tokens: 2100, completion_tokens: 4000 } });
  const r4 = await w.fetch(req({ words: WORDS, model: '@cf/qwen/qwen3.8-27b' }), e4.env);
  assert.equal(r4.status, 502);
  const j4 = await r4.json();
  assert.deepEqual(j4.shape, { keys: ['choices', 'usage'], finish: 'length', content: 'object', reasoning: 50, usage: { in: 2100, out: 4000 } });
  assert.doesNotMatch(JSON.stringify(j4), /lantern|등불/);
  assert.equal(e4.calls[0].input.reasoning_effort, 'low');
  const e5 = fakeEnv({ response: STORY, usage: { prompt_tokens: 2000, completion_tokens: 900 } });
  const j5 = await (await w.fetch(req({ words: WORDS }), e5.env)).json();
  assert.deepEqual([j5.tries, j5.usage], [1, { in: 2000, out: 900 }]);
  assert.equal(e5.calls[0].input.reasoning.effort, 'low');
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
  const ex = w._.EXAMPLE_TEXT;
  assert.ok(w._.RULES.endsWith('답:\n' + ex));
  const words = [['shepherd', '양치기', 'n'], ['bored', '심심한', 'a'], ['shout', '외치다', 'v'], ['villager', '마을 사람', 'n'], ['believe', '믿다', 'v'], ['regret', '후회하다', 'v']];
  const p = bootPage();
  try {
    const r = check(p, words, parse(ex), true);
    assert.deepEqual(r.why, []);
  } finally { p.close(); }
});

test('story server: thinking is set per model as the Cloudflare docs say, and other @cf models can be tried', async () => {
  const w = await load(), t = w._.thinking;
  assert.deepEqual(t('@cf/google/gemma-4-26b-a4b-it', 'none'), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(t('@cf/zai-org/glm-4.7-flash', 'none'), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(t('@cf/nvidia/nemotron-3-120b-a12b', 'none'), { chat_template_kwargs: { enable_thinking: false } });
  assert.deepEqual(t('@cf/nvidia/nemotron-3-120b-a12b', 'low'), { chat_template_kwargs: { enable_thinking: true, low_effort: true } });
  assert.deepEqual(t('@cf/qwen/qwen3.8-27b', 'none'), { reasoning_effort: 'low' });
  assert.deepEqual(t('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'none'), {});
  const { env, calls } = fakeEnv();
  const j = await (await w.fetch(req({ words: WORDS, model: '@cf/google/gemma-4-26b-a4b-it' }), env)).json();
  assert.equal(j.effort, 'none');
  assert.deepEqual(calls[0].input.chat_template_kwargs, { enable_thinking: false });
  assert.equal(calls[0].input.messages[0].role, 'system');
  // 목록 밖 '@cf/회사/이름' 모델도 시험할 수 있어요 (WG_MODELS로 잠그면 못 써요)
  assert.equal((await w.fetch(req({ words: WORDS, model: '@cf/new-co/new-model-1' }), env)).status, 200);
  // 채팅 꼴만 묻는 모델은 오류가 나면 다른 꼴로 다시 묻지 않고 오류를 돌려줘요
  const e2 = fakeEnv(() => { throw new Error('5006: bad input'); });
  const r2 = await w.fetch(req({ words: WORDS, model: '@cf/zai-org/glm-4.7-flash' }), e2.env);
  assert.equal(r2.status, 502);
  assert.equal(e2.calls.length, 1);
});

test('story server: JSON answers (5) become app text, with the response_format each model family wants', async () => {
  const w = await load();
  assert.equal(w._.storyText(JSTORY, WORDS), JTEXT);
  assert.deepEqual(w._.parseJSON('<think>x</think>```json\n{"a": [1, 2,], }\n```'), { a: [1, 2] });
  assert.equal(w._.parseJSON('no json here'), null);
  // 새 모델(gemma): OpenAI 꼴 {name, schema, strict}, 답은 글(JSON)로
  const g = fakeEnv({ choices: [{ message: { content: '```json\n' + JSON.stringify(JSTORY) + '\n```' } }] });
  const jg = await (await w.fetch(req({ words: WORDS, model: '@cf/google/gemma-4-26b-a4b-it', format: 'json' }), g.env)).json();
  assert.equal(jg.text, JTEXT);
  assert.equal(jg.format, 'json');
  assert.deepEqual(g.calls[0].input.response_format, { type: 'json_schema', json_schema: { name: 'answer', schema: w._.STORY_SCHEMA, strict: true } });
  assert.match(sys(g.calls[0]), /"lines"/);
  // 예전 모델(llama): json_schema에 바로 schema, 답은 이미 객체로 와요
  const l = fakeEnv({ response: JSTORY });
  const jl = await (await w.fetch(req({ words: WORDS, model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', format: 'json' }), l.env)).json();
  assert.equal(jl.text, JTEXT);
  assert.deepEqual(l.calls[0].input.response_format, { type: 'json_schema', json_schema: w._.STORY_SCHEMA });
  // JSON 칸을 정한 요청이 오류면 칸 없이 다시 물어요
  const f = fakeEnv((m, input) => { if (input.response_format) throw new Error('5006: response_format not supported'); return { choices: [{ message: { content: JSON.stringify(JSTORY) } }] }; });
  const jf = await (await w.fetch(req({ words: WORDS, model: '@cf/zai-org/glm-4.7-flash', format: 'json' }), f.env)).json();
  assert.equal(jf.text, JTEXT);
  assert.deepEqual(f.calls.map(c => !!c.input.response_format), [true, false]);
  // gpt-oss는 Responses 꼴로 묻고 (JSON 칸 없이, 규칙 글에 JSON 꼴), 글에서 JSON을 꺼내요
  const o = fakeEnv({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'analysis… assistantfinal' + JSON.stringify(JSTORY) }] }] });
  const jo = await (await w.fetch(req({ words: WORDS, format: 'json' }), o.env)).json();
  assert.equal(jo.text, JTEXT);
  assert.equal(o.calls[0].input.response_format, undefined);
  assert.match(o.calls[0].input.instructions, /"lines"/);
  // 꼴 칸 확인
  for (const bad of [{ format: 'xml' }, { plan: 'yes' }, { drafts: 5 }, { drafts: 0 }, { editor: 'gpt-4o' }, { editorEffort: 'max' }, { story: 'x'.repeat(30) }]) {
    assert.equal((await w.fetch(req({ words: WORDS, ...bad }), g.env)).status, 400);
  }
});

test('story server: plan first (8) — the writer gets the skeleton', async () => {
  const w = await load();
  const PLAN = { source: '토끼와 거북이', hero: '느림보 거북 토토', place: '숲속 운동장', problem: '등불이 꺼짐', solution: '친구들과 함께', beats: [{ word: 'borrow', event: '토토가 등불을 빌려요' }] };
  const { env, calls } = fakeEnv((m, input) => (/이야기 설계자/.test(sys({ input })) ? { response: PLAN } : { choices: [{ message: { content: JSON.stringify(JSTORY) } }] }));
  const j = await (await w.fetch(req({ words: WORDS, model: '@cf/google/gemma-4-26b-a4b-it', format: 'json', plan: true }), env)).json();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input.response_format.json_schema.schema, w._.PLAN_SCHEMA);
  assert.match(usr(calls[1]), /이야기 뼈대/);
  assert.match(usr(calls[1]), /느림보 거북 토토/);
  assert.equal(j.plan.hero, '느림보 거북 토토');
  assert.equal(j.text, JTEXT);
  assert.deepEqual(j.steps.map(s => s.step), ['plan', 'write']);
});

test('story server: writer + editor (7) — drafts from one model, the editor model picks and polishes', async () => {
  const w = await load();
  const E = '@cf/nvidia/nemotron-3-120b-a12b', G = '@cf/google/gemma-4-26b-a4b-it';
  const edited = { ...JSTORY, title: '다듬은 등불 축제' };
  const { env, calls } = fakeEnv((m, input) => ({ choices: [{ message: { content: JSON.stringify(m === E ? edited : JSTORY) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  const j = await (await w.fetch(req({ words: WORDS, model: G, format: 'json', drafts: 3, editor: E }), env)).json();
  assert.deepEqual(calls.map(c => c.model), [G, G, G, E]);
  const ed = calls[3];
  assert.match(sys(ed), /편집자/);
  assert.match(usr(ed), /초안 3:/);
  assert.deepEqual(ed.input.chat_template_kwargs, { enable_thinking: false });
  assert.equal(j.drafts.length, 3);
  assert.equal(j.editor, E);
  assert.equal(j.edited, true);
  assert.match(j.text, /^제목: 다듬은 등불 축제/);
  assert.deepEqual(j.usage, { in: 400, out: 200 });
  // 편집자 답이 망가지면 첫 초안을 돌려줘요
  const b = fakeEnv((m) => ({ choices: [{ message: { content: m === E ? '!'.repeat(100) : JSON.stringify(JSTORY) } }] }));
  const jb = await (await w.fetch(req({ words: WORDS, model: G, format: 'json', drafts: 2, editor: E }), b.env)).json();
  assert.equal(jb.edited, false);
  assert.equal(jb.text, JTEXT);
});

test('story server: /fix (6) gets only text — the story and the checker problems — and returns the fixed story', async () => {
  const w = await load();
  const url = 'https://s.example/fix', problems = ["6줄: '허락'은(는) 허락하다의 뜻이 아니에요", 'solve: 이야기에 0번 (한 번이어야 해요)'];
  const { env, calls } = fakeEnv({ choices: [{ message: { content: JSON.stringify(JSTORY) } }] });
  const r = await w.fetch(req({ words: WORDS, story: JTEXT, problems, model: '@cf/google/gemma-4-26b-a4b-it', format: 'json' }, { url }), env);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.text, JTEXT);
  assert.match(sys(calls[0]), /점검기가 찾은 문제 목록/);
  assert.match(usr(calls[0]), /허락하다의 뜻이 아니에요/);
  assert.match(usr(calls[0]), /고칠 이야기:\n제목: 등불 축제/);
  assert.deepEqual(j.steps.map(s => s.step), ['fix']);
  const bad = [
    { words: WORDS, story: JTEXT + '\ndata:image/png;base64,AAAA', problems },
    { words: WORDS, story: JTEXT, problems: 'x' },
    { words: WORDS, story: JTEXT, problems: [] },
    { words: WORDS, story: JTEXT, problems, photo: 'x' },
    { words: WORDS, story: 'short', problems },
    { words: WORDS, story: JTEXT, problems: ['<img src=x>'] }
  ];
  for (const b of bad) assert.equal((await w.fetch(req(b, { url }), env)).status, 400);
  assert.equal((await w.fetch(req(JSON.stringify({ words: WORDS, story: JTEXT, problems, pad: 'x'.repeat(17000) }), { url }), env)).status, 413);
  assert.equal(calls.length, 1);
});

test('story server: PLAYGROUND.md (1) has the same rules as the server', async () => {
  const fs = require('node:fs');
  const { playground } = await import(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'story-worker', 'playground.mjs')).href);
  const file = path.join(__dirname, '..', '..', 'server', 'story-worker', 'PLAYGROUND.md');
  assert.equal(fs.readFileSync(file, 'utf8'), playground(), 'PLAYGROUND.md가 규칙 글과 달라요. node server/story-worker/playground.mjs 로 다시 만들어요');
});
