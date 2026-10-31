// 그림 스토리 단어 미션 — 이야기 서버 (Cloudflare Worker + Workers AI)
//
// 하는 일: 앱이 보낸 영어 단어와 뜻으로 큰 AI(Workers AI 공개 모델)가 이야기 한 편을 써서 글로 돌려줘요.
// 앱은 받은 글을 휴대폰 안 점검기로 확인하고, 안 되면 지금처럼 휴대폰 안 방식으로 만들어요.
//
// 지키는 것 (2026-10-31 사용자가 정함)
// - 서버로 오는 것은 단어 글자(영어·뜻·품사)뿐이에요. 사진(단어 사진도, 그 밖의 사진도)은 받지 않아요:
//   JSON이 아니거나, 2KB보다 크거나, 정해진 칸(words, model, effort) 밖의 칸이 있거나, 단어 글자가 아닌 것이 섞이면 거절해요.
// - 받은 단어는 적지(로그) 않고 저장하지도 않아요. 답을 돌려주면 끝이에요.
// - 열쇠(WG_TOKEN)가 맞는 요청만 받아요. 열쇠는 Cloudflare의 비밀 값(Secret)에 두고, 저장소에는 넣지 않아요.
//
// 설정 (Cloudflare 대시보드 → 이 Worker → Settings)
// - Bindings: Workers AI → 이름 AI
// - Variables and Secrets: WG_TOKEN (Secret, 꼭), WG_MODEL (쓸 모델, 없으면 아래 MODELS의 첫째),
//   WG_EFFORT (생각 깊이 none·low·medium·high, 없으면 gpt-oss는 low, 나머지는 none),
//   WG_MODELS (쉼표로 쓸 모델만 잠글 때. 없으면 '@cf/회사/이름' 꼴의 Workers AI 모델은 모두 시험할 수 있어요)
// 쓰는 법은 server/story-worker/README.md를 봐요.

// 무료 요금제에서 쓸 수 있는 글 모델 (2026-10-31 Cloudflare 문서·요금표). 괄호는 이야기 한 편(입력 2천·출력 1천 토큰쯤)에 드는 Neuron 어림.
// 하루 무료 10,000 Neuron → gemma·glm은 200편쯤, gpt-oss는 60편쯤, nemotron·llama는 40편쯤, qwen은 20편쯤.
const MODELS = [
  '@cf/openai/gpt-oss-120b',          // 생각 low (130)
  '@cf/google/gemma-4-26b-a4b-it',    // 생각 끔 (45) — 휴대폰 게임 AI(Gemma 4 E2B)의 큰 형
  '@cf/zai-org/glm-4.7-flash',        // 생각 끔 (50)
  '@cf/nvidia/nemotron-3-120b-a12b',  // 생각 끔 (230)
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // 생각 없음 (260)
  '@cf/qwen/qwen3.8-27b',             // 생각 low (400~, 기본은 xhigh라 빈 답이 왔어요)
  '@cf/openai/gpt-oss-20b'
];
// deepseek-v4는 무료 요금제에서 못 써요 (문서·5035 오류). WG_MODELS가 없으면 이 꼴의 다른 모델도 시험할 수 있어요
// (무료 요금제는 한도를 넘으면 그날 멈출 뿐 돈이 나가지 않아요. Workers Paid로 바꾸면 WG_MODELS로 잠가요)
const MODEL_ID = /^@cf\/[a-z0-9._-]{1,40}\/[a-z0-9._-]{1,80}$/;
const EFFORTS = ['none', 'low', 'medium', 'high'];
const ORIGINS = ['https://areweloststars.github.io'];
const MAX_BODY = 2048;

// 앱 점검기(check.cjs, 게임의 aiLineWhy·aiMark)와 같은 규칙을 사람 말로 적었어요.
// 보기 이야기는 일반 사전 낱말로 Claude가 새로 쓴 모범 이야기예요 (시험 단어 아님).
const RULES = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 작가예요.
영어 단어와 뜻을 받으면, 단어를 모두 넣은 짧은 이야기 한 편과 그림 설명을 써요.

가장 중요한 것: 앞뒤가 이어지는 이야기
- 쓰기 전에 단어들이 한 이야기에 모일 수 있는 주인공·장소·문제를 먼저 정해요. 단어 차례는 이야기에 맞게 바꿔요.
- 줄과 줄은 까닭과 결과로 이어져요. 다음 줄은 앞 줄 때문에 일어나요. 앞에서 말하지 않은 인물·물건·사건이 갑자기 나오지 않아요.
- 단어 뜻이 그 문장에 자연스럽게 맞아야 해요. 뜻을 억지로 끼우지 않아요 (나쁜 예: 자전거를 용서했어요, 선생님께 참석했어요).
- 명작 동화·전래 동화·신화 가운데 하나를 골라 비틀거나 웃긴 상황으로 바꿔요. 밝고 건전하게, 기억에 남게 써요.
- 아래 보기는 꼴만 보여 줘요. 보기의 인물·장소·줄거리(양치기·늑대)는 쓰지 말고 새 이야기를 써요.

꼴 (앱이 이 꼴 그대로 읽어요. 굵은 글씨(**)·번호·글머리표·다른 설명은 쓰지 않아요. '제목:'과 '줄거리:'는 같은 줄에 바로 이어 써요)
제목: 14자 이하 한국어 (영어·기호 없이)
줄거리: 한 문장, 80자 이하
이야기:
- 한 줄에 한 문장, '-어요' 말투, 40자 안쪽으로 짧게. 줄 수는 요청에 적힌 대로.
- 첫 줄은 주인공과 장소를 소개하고, 끝 줄은 이야기를 마무리해요. 첫 줄과 끝 줄에는 단어를 넣지 않아요.
- 단어마다 딱 한 번, 한 줄에 표시는 하나만 {영어|뜻}으로 넣어요 (한 줄에 단어 둘을 넣지 않아요). 영어는 받은 그대로, 뜻은 받은 뜻을 문장에 맞는 꼴로 바꿔요.
  예: {shout|외쳤어요}, {bored|심심한}, {villager|마을 사람}들은, {believe|믿어} 주지 않았어요
- 표시 안의 뜻은 받은 뜻 낱말을 그대로 두고 끝(어미)만 바꿔요. 줄이거나, 사이에 말을 끼우거나, '-받다'·'-되다'·'-어지다' 꼴로 바꾸지 않아요.
  맞음: {praise|칭찬했어요}, {fall asleep|잠들었어요}, {greedy|욕심 많은} 여우, {field trip|현장 학습}을, 접시를 {break|부쉈어요}
  틀림: {praise|칭찬}을 받았어요, {fall asleep|잠이 들었어요}, {greedy|욕심이 많았어요}, {field trip|학습}을, 접시가 {break|부서졌어요}
- 움직임 말이 문장 끝에 오면 '-어요' 꼴로 써요: {borrow|빌렸어요}. 사전 꼴({borrow|빌리다})로 두지 않아요.
- 받은 뜻과 다른 뜻으로 쓰지 않아요. 단어의 뜻을 표시 밖(다른 줄)에 또 쓰지 않아요. 같은 줄이나 같은 시작을 되풀이하지 않아요.
- 단어 없는 이음 줄은 첫 줄·끝 줄 말고 2개까지 넣을 수 있어요 (까닭·결과를 넣을 자리).
그림:
- 단어마다 한 줄씩, 이야기에 나온 차례로: 영어 단어: 영어 그림 설명
- 그림 설명은 반드시 영어로만 써요 (한글을 쓰지 않아요). 그림 AI가 영어만 읽어요.
- 그 단어 줄의 장면을 그려서 그림만 봐도 단어 뜻이 떠오르게. 영어 낱말 8~35개, 장면 하나.
- 같은 인물은 줄마다 같은 말로 (예: the shepherd boy). 글자·간판·말풍선·종이에 쓴 글은 그리지 않아요 (says, written, sign, label 같은 말을 쓰지 않아요). 다치는 장면·무기·무서운 것은 넣지 않아요.

보기 (단어 6개 → 이야기 8줄)
요청:
shepherd - 양치기
bored - 심심한
shout - 외치다
villager - 마을 사람
believe - 믿다
regret - 후회하다
답:
제목: 거짓말쟁이 양치기의 반성
줄거리: 심심해서 늑대가 왔다고 장난친 양치기 소년이 아무도 믿어 주지 않자 크게 뉘우쳐요.
이야기:
언덕 위에서 한 소년이 날마다 양을 돌봤어요.
그 {shepherd|양치기} 소년은 하루 종일 할 일이 없었어요.
너무 {bored|심심한} 소년은 장난을 치기로 했어요.
소년은 늑대가 나타났다고 크게 {shout|외쳤어요}.
헐레벌떡 달려온 {villager|마을 사람}들은 속은 걸 알고 화를 냈어요.
진짜 늑대가 나타난 날, 아무도 소년의 말을 {believe|믿어} 주지 않았어요.
양들이 흩어진 뒤 소년은 자기 장난을 크게 {regret|후회했어요}.
그 뒤로 소년은 장난 대신 피리를 불며 양들과 놀았어요.
그림:
shepherd: a young shepherd boy with a wooden staff watching fluffy sheep on a green hill
bored: the shepherd boy lying on the grass with his chin on his hands, yawning and bored
shout: the shepherd boy standing on a rock, cupping his hands around his mouth and shouting loudly
villager: a group of farmers with rakes running up the hill, then looking annoyed at the laughing boy
believe: a gray wolf near the sheep while the farmers in the village below turn away, not listening to the shepherd boy
regret: the shepherd boy sitting alone on the hill with his head down, his sheep scattered far away`;

const ask = words => `요청 (단어 ${words.length}개 → 이야기 ${words.length + 2}~${words.length + 4}줄):
${words.map(([en, ko]) => `${en} - ${ko}`).join('\n')}
답:`;

// ---- 받은 요청 확인: 단어 글자만 ----
const EN = /^[A-Za-z][A-Za-z '’.-]{0,39}$/;
const KO = /^[^{}|<>\n\r\t]{1,30}$/;
const POS = /^[a-z]{0,6}$/;
function readWords(body, allowModel) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { err: 'JSON 객체가 아니에요' };
  for (const k of Object.keys(body)) if (!['words', 'model', 'effort'].includes(k)) return { err: `받지 않는 칸: ${k.slice(0, 20)}` };
  const ws = body.words;
  if (!Array.isArray(ws) || ws.length < 3 || ws.length > 10) return { err: '단어는 3~10개예요' };
  const words = [];
  for (const w of ws) {
    const [en, ko, pos = ''] = Array.isArray(w) ? w : w && typeof w === 'object' ? [w.en, w.ko, w.pos] : [];
    if (Array.isArray(w) && w.length > 3) return { err: '단어 꼴이 틀려요' };
    if (!Array.isArray(w) && w && Object.keys(w).some(k => !['en', 'ko', 'pos'].includes(k))) return { err: '단어 꼴이 틀려요' };
    if (typeof en !== 'string' || typeof ko !== 'string' || typeof pos !== 'string') return { err: '단어 꼴이 틀려요' };
    const e = en.trim(), o = ko.trim();
    if (!EN.test(e) || !KO.test(o) || !POS.test(pos)) return { err: '단어 글자가 아닌 것이 있어요' };
    words.push([e, o, pos]);
  }
  if (new Set(words.map(w => w[0].toLowerCase())).size !== words.length) return { err: '같은 단어가 두 번 있어요' };
  const model = body.model == null ? null : body.model;
  if (model != null && (typeof model !== 'string' || !allowModel(model))) return { err: '쓸 수 없는 모델이에요' };
  const effort = body.effort == null ? null : body.effort;
  if (effort != null && !EFFORTS.includes(effort)) return { err: '생각 깊이는 none·low·medium·high예요' };
  return { words, model, effort };
}

// ---- AI에게 묻기 ----
// gpt-oss는 Responses 꼴(instructions·input), 나머지는 채팅 꼴(messages)로 물어요. 답도 여러 꼴을 다 읽어요.
function textOf(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return textOf(r.response);
  const c = r.choices && r.choices[0];
  if (c) return (c.message && typeof c.message.content === 'string' ? c.message.content : c.text) || '';
  if (typeof r.output_text === 'string') return r.output_text;
  if (Array.isArray(r.output)) {
    return r.output.filter(o => o && o.type === 'message')
      .flatMap(o => (Array.isArray(o.content) ? o.content : []))
      .filter(c => c && typeof c.text === 'string' && c.type !== 'reasoning_text').map(c => c.text).join('');
  }
  return '';
}
// 답의 꼴만 적어요 (오류를 찾을 때). 받은 단어나 답 글은 넣지 않아요
function shapeOf(r) {
  if (r == null || typeof r !== 'object') return { type: typeof r };
  const c = r.choices && r.choices[0], m = c && c.message, u = r.usage || (r.response && r.response.usage);
  return {
    keys: Object.keys(r).slice(0, 10),
    finish: c ? c.finish_reason : r.status,
    content: m ? typeof m.content : undefined,
    reasoning: m ? String(m.reasoning_content || m.reasoning || '').length : undefined,
    output: Array.isArray(r.output) ? r.output.map(o => o && o.type).slice(0, 6) : undefined,
    usage: u ? { in: u.prompt_tokens ?? u.input_tokens, out: u.completion_tokens ?? u.output_tokens } : undefined
  };
}
// 생각하는 모델의 생각 부분은 떼고, 앱이 읽는 꼴로 고쳐요:
// '**제목**' 다음 줄에 제목을 쓴 것 → '제목: …', 줄 앞 번호·글머리표·굵은 글씨 떼기,
// gpt-oss가 생각 글(analysis…assistantfinal)을 답에 섞으면 마지막 '제목' 줄부터만
function clean(t) {
  let s = String(t || '');
  const fin = s.lastIndexOf('assistantfinal');
  if (fin >= 0) s = s.slice(fin + 'assistantfinal'.length);
  let ls = s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '')
    .split('\n').map(l => l.replace(/\*\*|__/g, '').replace(/^\s*#{1,6}\s*/, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim());
  const top = ls.map(l => /^제목(\s*[:：]|\s*$)/.test(l)).lastIndexOf(true);
  if (top > 0) ls = ls.slice(top);
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], m = l.match(/^(제목|줄거리|이야기|그림)\s*[:：]?\s*(.*)$/);
    if (!m) { if (l) out.push(l); continue; }
    let v = m[2].trim();
    if (!v && (m[1] === '제목' || m[1] === '줄거리')) { while (i + 1 < ls.length && !ls[i + 1]) i++; if (i + 1 < ls.length) v = ls[++i]; }
    out.push(`${m[1]}: ${v}`.trim());
  }
  return out.join('\n').replace(/^(이야기|그림):$/gm, '$1:').trim();
}
// 같은 글자만 되풀이하는 망가진 답 (gpt-oss가 가끔 '!!!!…'를 줘요)
const broken = t => !t || !/이야기\s*[:：]/.test(t) || /(.)\1{30,}/.test(t);

// 생각 깊이: 생각하는 모델은 생각에 글자 한도를 다 쓰면 답이 잘리거나 비어요 (2026-10-31 재 봄:
// gpt-oss medium은 생각 글이 새고 3/10, qwen3.8은 기본 xhigh라 빈 답). 모델마다 문서에 적힌 방법으로 정해요.
const isOss = m => /gpt-oss/i.test(m);
const defaultEffort = m => (isOss(m) || /qwen3/i.test(m) ? 'low' : 'none');
function thinking(model, effort) {
  if (/qwen3/i.test(model)) return { reasoning_effort: effort === 'none' ? 'low' : effort === 'high' ? 'xhigh' : effort };
  if (/nemotron/i.test(model)) return { chat_template_kwargs: effort === 'none' ? { enable_thinking: false } : { enable_thinking: true, low_effort: effort === 'low' } };
  if (/gemma-4|glm-4|glm-5/i.test(model)) return { chat_template_kwargs: { enable_thinking: effort !== 'none' } };
  return {};
}
async function write(env, model, words, effort) {
  const user = ask(words), maxTokens = 4000;
  const asChat = () => env.AI.run(model, {
    messages: [{ role: 'system', content: RULES }, { role: 'user', content: user }],
    max_tokens: maxTokens, temperature: 0.7, ...thinking(model, effort)
  });
  const asResponses = () => env.AI.run(model, { instructions: RULES, input: user, reasoning: { effort: effort === 'none' ? 'low' : effort }, max_output_tokens: maxTokens });
  // gpt-oss는 Responses 꼴로 묻고, 안 되면 채팅 꼴로 다시. 나머지는 채팅 꼴만
  const first = isOss(model) ? asResponses : asChat, second = isOss(model) ? asChat : null;
  const once = async () => {
    let r;
    try { r = await first(); } catch (e1) {
      if (!second) throw e1;
      try { r = await second(); } catch (e2) {
        throw new Error(String((e1 && e1.message) || e1).slice(0, 300) + ' / 다른 꼴: ' + String((e2 && e2.message) || e2).slice(0, 120));
      }
    }
    return { text: clean(textOf(r)), shape: shapeOf(r) };
  };
  let got = await once(), tries = 1;
  if (broken(got.text)) { got = await once(); tries = 2; }
  return { ...got, tries };
}

// ---- 문지기 ----
function cors(req) {
  const o = req.headers.get('origin');
  if (!o || !ORIGINS.includes(o)) return {};
  return { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400', vary: 'origin' };
}
const reply = (req, status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(req) } });

function same(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ (y[i] || 0);
  return d === 0;
}

async function handle(req, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: cors(req)['access-control-allow-origin'] ? 204 : 403, headers: cors(req) });
  if (req.headers.get('origin') && !cors(req)['access-control-allow-origin']) return reply(req, 403, { error: '허락하지 않은 사이트예요' });
  if (url.pathname === '/' && req.method === 'GET') return reply(req, 200, { ok: true });
  if (url.pathname !== '/story') return reply(req, 404, { error: '없는 주소예요' });
  if (req.method !== 'POST') return reply(req, 405, { error: 'POST만 받아요' });
  if (!env.WG_TOKEN || !env.AI) return reply(req, 503, { error: '서버 설정이 끝나지 않았어요 (WG_TOKEN, AI 연결)' });
  const auth = req.headers.get('authorization') || '';
  if (!same(auth.replace(/^Bearer\s+/i, ''), env.WG_TOKEN)) return reply(req, 401, { error: '열쇠가 맞지 않아요' });
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return reply(req, 415, { error: 'JSON 글만 받아요 (사진은 받지 않아요)' });
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return reply(req, 413, { error: '요청이 너무 커요 (단어 글자만 보내요)' });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return reply(req, 413, { error: '요청이 너무 커요 (단어 글자만 보내요)' });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(req, 400, { error: 'JSON이 아니에요' }); }
  const locked = String(env.WG_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const got = readWords(body, m => (locked.length ? locked.includes(m) : MODEL_ID.test(m)));
  if (got.err) return reply(req, 400, { error: got.err });
  const model = got.model || env.WG_MODEL || (locked.length ? locked : MODELS)[0];
  const t0 = Date.now();
  try {
    const effort = got.effort || (EFFORTS.includes(env.WG_EFFORT) ? env.WG_EFFORT : defaultEffort(model));
    const { text, shape, tries } = await write(env, model, got.words, effort);
    if (!text) return reply(req, 502, { error: 'AI가 빈 답을 줬어요', model, shape });
    return reply(req, 200, { text, model, effort, ms: Date.now() - t0, tries, usage: shape.usage });
  } catch (e) {
    // 단어는 적지 않고, 오류 종류만 돌려줘요 (하루 무료 한도를 넘으면 여기로 와요)
    const msg = String((e && e.message) || e).slice(0, 450);
    return reply(req, /limit|quota|neuron|429|capacity/i.test(msg) ? 429 : 502, { error: 'AI 오류: ' + msg, model });
  }
}

// _ 는 시험(app/tests/server.test.cjs)용이에요
export default { fetch: handle, _: { RULES, ask, readWords, textOf, clean, shapeOf, thinking, MODELS, ORIGINS } };
