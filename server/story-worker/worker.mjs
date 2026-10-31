// 그림 스토리 단어 미션 — 이야기 서버 (Cloudflare Worker + Workers AI)
//
// 하는 일: 앱이 보낸 영어 단어와 뜻으로 큰 AI(Workers AI 공개 모델)가 이야기 한 편을 써서 글로 돌려줘요.
// 앱은 받은 글을 휴대폰 안 점검기로 확인하고, 틀린 곳이 있으면 /fix로 그곳만 고쳐 달라고 해요.
// 그래도 안 되면 지금처럼 휴대폰 안 방식으로 만들어요.
//
// 지키는 것 (2026-10-31 사용자가 정함)
// - 돈이 드는 것은 쓰지 않아요: Cloudflare 무료 요금제만 써요 (Workers Paid로 바꾸지 않아요). 하루 무료 한도를 넘으면 그날은 멈출 뿐이에요.
// - 서버로 오는 것은 글자뿐이에요: /story는 단어(영어·뜻·품사), /fix는 단어와 이 서버가 쓴 이야기 글·점검기 글.
//   사진(단어 사진도, 그 밖의 사진도)은 받지 않아요: JSON이 아니거나, 크거나, 정해진 칸 밖의 칸이 있거나,
//   글자가 아닌 것(data: 주소 등)이 섞이면 AI에게 묻기 전에 거절해요.
// - 받은 글은 적지(로그) 않고 저장하지도 않아요. 답을 돌려주면 끝이에요.
// - 열쇠(WG_TOKEN)가 맞는 요청만 받아요. 열쇠는 Cloudflare의 비밀 값(Secret)에 두고, 저장소에는 넣지 않아요.
//
// 주소
// - POST /story {words, model?, effort?, format?, plan?, drafts?, editor?, editorEffort?}
//   format 'text': AI가 앱 꼴 글을 바로 써요 / 'json': AI는 칸(제목·문장·단어·뜻 말·그림)만 채우고, {영어|뜻} 표시와 줄 꼴은 서버가 만들어요
//   plan true: 먼저 뼈대(비튼 동화·주인공·문제·해결·단어마다 사건)를 짜고 그 뼈대대로 써요 (두 번 물어요)
//   drafts 2~3: 작가 모델이 초안을 여러 편 쓰고, editor 모델이 가장 잘 이어지는 것을 골라 다듬어요
// - POST /fix {words, story, problems, model?, effort?, format?}: 점검기가 찾은 문제가 있는 곳만 고쳐요
// 답: {text(앱 꼴: 제목·줄거리·이야기·그림), model, effort, format, ms, steps:[{step, model, ms, in, out}], plan?, drafts?}
//
// 설정 (Cloudflare 대시보드 → 이 Worker → Settings)
// - Bindings: Workers AI → 이름 AI
// - Variables and Secrets: WG_TOKEN (Secret, 꼭), WG_MODEL (쓸 모델, 없으면 아래 MODELS의 첫째),
//   WG_EFFORT (생각 깊이 none·low·medium·high, 없으면 nemotron·gpt-oss·qwen은 low, 나머지는 none),
//   WG_MODELS (쉼표로 쓸 모델만 잠글 때. 없으면 '@cf/회사/이름' 꼴의 Workers AI 모델은 모두 시험할 수 있어요)
// 쓰는 법은 server/story-worker/README.md를 봐요.

// 무료 요금제에서 쓸 수 있는 글 모델 (2026-10-31 Cloudflare 문서·요금표). 괄호는 이야기 한 편(입력 2천·출력 1천 토큰쯤)에 드는 Neuron 어림.
// 하루 무료 10,000 Neuron → gemma·glm은 200편쯤, gpt-oss는 60편쯤, nemotron·llama는 40편쯤, qwen은 20편쯤.
// 2026-10-31 사용자가 Playground로 직접 읽고 Nemotron 3 120B를 골랐어요 ("유일하게 이야기가 이어져요") → 기본 모델.
// Playground는 Nemotron의 생각을 켠 채로 썼어요 → 서버도 생각을 켜요 (기본 low, effort medium이면 Playground와 같은 보통 생각)
const MODELS = [
  '@cf/nvidia/nemotron-3-120b-a12b',  // 생각 low (340) — 기본
  '@cf/openai/gpt-oss-120b',          // 생각 low (130)
  '@cf/google/gemma-4-26b-a4b-it',    // 생각 끔 (45) — 꼴은 잘 지키지만 사용자 판정: 이야기가 안 이어져요
  '@cf/zai-org/glm-4.7-flash',        // 생각 끔 (50)
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // 생각 없음 (260)
  '@cf/qwen/qwen3.8-27b',             // 생각 low (400~, 기본은 xhigh라 빈 답이 왔어요)
  '@cf/openai/gpt-oss-20b'
];
// deepseek-v4는 무료 요금제에서 못 써요 (문서·5035 오류). WG_MODELS가 없으면 이 꼴의 다른 모델도 시험할 수 있어요
// (무료 요금제는 한도를 넘으면 그날 멈출 뿐 돈이 나가지 않아요)
const MODEL_ID = /^@cf\/[a-z0-9._-]{1,40}\/[a-z0-9._-]{1,80}$/;
const EFFORTS = ['none', 'low', 'medium', 'high'];
const FORMATS = ['text', 'json'];
const ORIGINS = ['https://areweloststars.github.io'];
const MAX_BODY = { '/story': 2048, '/fix': 16384 };
const MAX_OUT = 4000;
const VERSION = 6;

// ---- 규칙 글 ----
// 앱 점검기(check.cjs, 게임의 aiLineWhy·aiMark)와 같은 규칙을 사람 말로 적었어요.
// 뜻 말 보기는 점검기로 맞음·틀림을 확인한 낱말이고, 시험 단어가 아니에요 (재기가 부풀지 않게).
const WRITER = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 작가예요.
영어 단어와 뜻을 받으면, 단어를 모두 넣은 짧은 이야기 한 편과 그림 설명을 써요.`;

const STORY_RULES = `가장 중요한 것: 앞뒤가 이어지는 이야기
- 쓰기 전에 단어들이 한 이야기에 모일 수 있는 주인공·장소·문제를 먼저 정해요. 단어 차례는 이야기에 맞게 바꿔요.
- 줄과 줄은 까닭과 결과로 이어져요. 다음 줄은 앞 줄 때문에 일어나요. 앞에서 말하지 않은 인물·물건·사건이 갑자기 나오지 않아요.
- 단어 뜻이 그 문장에 자연스럽게 맞아야 해요. 뜻을 억지로 끼우지 않아요 (나쁜 예: 자전거를 용서했어요, 선생님께 참석했어요).
- 명작 동화·전래 동화·신화 가운데 하나를 골라 비틀거나 웃긴 상황으로 바꿔요. 밝고 건전하게, 기억에 남게 써요.
- 보기가 있으면 꼴만 보여 주는 거예요. 보기의 인물·장소·줄거리(양치기·늑대)는 쓰지 말고 새 이야기를 써요.

제목: 14자 이하 한국어 (영어·기호 없이). 줄거리: 한 문장, 80자 이하.
이야기
- 한 줄에 한 문장, '-어요' 말투, 40자 안쪽으로 짧게. 줄 수는 요청에 적힌 대로.
- 첫 줄은 주인공과 장소를 소개하고, 끝 줄은 이야기를 마무리해요. 첫 줄과 끝 줄에는 단어를 넣지 않아요.
- 단어마다 딱 한 번, 한 줄에 단어 하나만 넣어요. 단어 없는 이음 줄은 첫 줄·끝 줄 말고 2개까지 넣을 수 있어요 (까닭·결과를 넣을 자리).
- 단어의 뜻을 나타내는 말(뜻 말)은 받은 뜻 낱말을 그대로 두고 끝(어미)만 바꿔요. 줄이거나, 사이에 말을 끼우거나, '-받다'·'-되다'·'-어지다' 꼴로 바꾸지 않아요.
  맞는 뜻 말: 칭찬하다 → 칭찬했어요 / 잠들다 → 잠들었어요 / 욕심 많은 → 욕심 많은 / 현장 학습 → 현장 학습 / 부수다 → 부쉈어요
  틀린 뜻 말: 칭찬(을 받았어요) / 잠이 들었어요 / 욕심이 많았어요 / 학습 / 부서졌어요
- 움직임 말이 문장 끝에 오면 '-어요' 꼴로 써요 (빌렸어요). 사전 꼴(빌리다)로 두지 않아요.
- 받은 뜻과 다른 뜻으로 쓰지 않아요. 단어의 뜻을 다른 줄에 또 쓰지 않아요. 같은 줄이나 같은 시작을 되풀이하지 않아요.
그림 설명
- 단어마다 하나씩, 이야기에 나온 차례로. 반드시 영어로만 써요 (한글을 쓰지 않아요). 그림 AI가 영어만 읽어요.
- 그 단어 줄의 장면을 그려서 그림만 봐도 단어 뜻이 떠오르게. 영어 낱말 8~35개, 장면 하나.
- 같은 인물은 줄마다 같은 말로 (예: the shepherd boy). 글자·간판·말풍선·종이에 쓴 글은 그리지 않아요 (says, written, sign, label 같은 말을 쓰지 않아요). 다치는 장면·무기·무서운 것은 넣지 않아요.`;

const FORMAT = {
  text: `답 꼴 (앱이 이 꼴 그대로 읽어요. 굵은 글씨(**)·번호·글머리표·다른 설명은 쓰지 않아요. '제목:'과 '줄거리:'는 같은 줄에 바로 이어 써요)
제목: 제목
줄거리: 줄거리
이야기:
한 줄에 한 문장씩. 뜻 말은 {영어|뜻 말}로 감싸요 (예: 소년은 크게 {shout|외쳤어요}.)
그림:
단어마다 한 줄씩 → 영어 단어: 영어 그림 설명`,
  json: `답 꼴: JSON 하나만 써요 (다른 말이나 \`\`\` 표시는 쓰지 않아요).
{"title": "제목", "plan": "줄거리", "lines": [{"text": "문장", "word": "이 줄의 영어 단어 또는 빈 글", "meaning": "문장 속 뜻 말을 쓴 그대로 또는 빈 글"}], "pictures": [{"word": "영어 단어", "scene": "영어 그림 설명"}]}
- lines는 이야기 줄 차례대로. text에는 { } | 표시를 쓰지 않아요. 앱이 meaning 자리에 표시를 넣어요.
- meaning은 text 안에 글자 그대로 있어야 해요 (예: text "소년은 크게 외쳤어요." → word "shout", meaning "외쳤어요").
- 첫 줄·끝 줄·이음 줄은 word와 meaning을 빈 글("")로 둬요.`
};

// 보기 이야기 (일반 사전 낱말로 Claude가 새로 쓴 모범 이야기, 시험 단어 아님). 앱 꼴과 JSON 꼴 둘 다 여기서 만들어요
const EXAMPLE = {
  words: [['shepherd', '양치기'], ['bored', '심심한'], ['shout', '외치다'], ['villager', '마을 사람'], ['believe', '믿다'], ['regret', '후회하다']],
  title: '거짓말쟁이 양치기의 반성',
  plan: '심심해서 늑대가 왔다고 장난친 양치기 소년이 아무도 믿어 주지 않자 크게 뉘우쳐요.',
  lines: [
    ['언덕 위에서 한 소년이 날마다 양을 돌봤어요.'],
    ['그 양치기 소년은 하루 종일 할 일이 없었어요.', 'shepherd', '양치기'],
    ['너무 심심한 소년은 장난을 치기로 했어요.', 'bored', '심심한'],
    ['소년은 늑대가 나타났다고 크게 외쳤어요.', 'shout', '외쳤어요'],
    ['헐레벌떡 달려온 마을 사람들은 속은 걸 알고 화를 냈어요.', 'villager', '마을 사람'],
    ['진짜 늑대가 나타난 날, 아무도 소년의 말을 믿어 주지 않았어요.', 'believe', '믿어'],
    ['양들이 흩어진 뒤 소년은 자기 장난을 크게 후회했어요.', 'regret', '후회했어요'],
    ['그 뒤로 소년은 장난 대신 피리를 불며 양들과 놀았어요.']
  ],
  pictures: [
    ['shepherd', 'a young shepherd boy with a wooden staff watching fluffy sheep on a green hill'],
    ['bored', 'the shepherd boy lying on the grass with his chin on his hands, yawning and bored'],
    ['shout', 'the shepherd boy standing on a rock, cupping his hands around his mouth and shouting loudly'],
    ['villager', 'a group of farmers with rakes running up the hill, then looking annoyed at the laughing boy'],
    ['believe', 'a gray wolf near the sheep while the farmers in the village below turn away, not listening to the shepherd boy'],
    ['regret', 'the shepherd boy sitting alone on the hill with his head down, his sheep scattered far away']
  ]
};
const exampleJSON = () => ({
  title: EXAMPLE.title, plan: EXAMPLE.plan,
  lines: EXAMPLE.lines.map(([text, word = '', meaning = '']) => ({ text, word, meaning })),
  pictures: EXAMPLE.pictures.map(([word, scene]) => ({ word, scene }))
});
const EXAMPLE_TEXT = storyText(exampleJSON(), EXAMPLE.words);
const EXAMPLE_SHOW = {
  text: EXAMPLE_TEXT,
  json: '{"title": ' + JSON.stringify(EXAMPLE.title) + ', "plan": ' + JSON.stringify(EXAMPLE.plan) + ',\n "lines": [\n' +
    exampleJSON().lines.map(l => '  ' + JSON.stringify(l)).join(',\n') + '\n ],\n "pictures": [\n' +
    exampleJSON().pictures.map(p => '  ' + JSON.stringify(p)).join(',\n') + '\n ]}'
};
const wordList = words => words.map(([en, ko]) => `${en} - ${ko}`).join('\n');
const linesNote = words => `단어 ${words.length}개 → 이야기 ${words.length + 2}~${words.length + 4}줄`;
const writerSystem = format => `${WRITER}

${STORY_RULES}

${FORMAT[format]}

보기 (단어 6개 → 이야기 8줄)
요청:
${wordList(EXAMPLE.words)}
답:
${EXAMPLE_SHOW[format]}`;
const RULES = writerSystem('text'); // 앱 꼴로 바로 쓰는 규칙 글 (PLAYGROUND.md에도 써요)

const ask = (words, plan) => `요청 (${linesNote(words)}):
${wordList(words)}${plan ? `
이야기 뼈대 (이 뼈대대로 써요. 단어 차례도 뼈대대로):
${JSON.stringify(plan, null, 1)}` : ''}
답:`;

// 뼈대 짜기 (8번): 문장은 쓰지 않고 줄거리의 까닭·결과만 정해요
const PLANNER = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 이야기 설계자예요.
영어 단어와 뜻으로 이야기 한 편의 뼈대만 짜요 (문장은 쓰지 않아요).
- 명작 동화·전래 동화·신화 하나를 골라 비틀거나 웃긴 상황으로 바꿔요. 어느 이야기를 비트는지 source에 적어요. 양치기와 늑대 이야기는 쓰지 않아요.
- 주인공 한 명(hero: 이름과 특징), 장소(place), 주인공이 겪는 문제(problem), 해결(solution)을 정해요.
- beats: 단어마다 사건 하나를 이야기 차례대로 적어요. 앞 사건이 다음 사건의 까닭이 되게 이어요. 갑자기 나오는 인물·물건이 없게 해요.
- 단어 뜻(받은 뜻)이 그 사건에 자연스럽게 맞아야 해요. 뜻을 억지로 끼우지 않아요.
- 첫 사건 앞에는 주인공 소개, 마지막 사건 뒤에는 마무리가 온다고 생각하고 짜요.
답 꼴: JSON 하나만 써요 (다른 말이나 \`\`\` 표시는 쓰지 않아요).
{"source": "비튼 이야기", "hero": "주인공", "place": "장소", "problem": "문제", "solution": "해결", "beats": [{"word": "영어 단어", "event": "그 단어가 나오는 사건 한 문장 (한국어)"}]}`;
const planAsk = words => `요청 (${linesNote(words)}):
${wordList(words)}
답:`;

// 작가 + 편집자 (7번): 초안 여러 편 가운데 가장 잘 이어지는 것을 골라 다듬어요
const EDITOR = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 편집자예요.
같은 단어로 쓴 이야기 초안 여러 편을 받아요.
1. 줄과 줄이 까닭과 결과로 가장 잘 이어지고, 단어 뜻이 자연스럽고, 가장 재미있는 초안 하나를 골라요.
2. 고른 초안을 아래 규칙에 맞게 다듬어요. 앞뒤가 안 맞는 줄, 억지로 끼운 뜻, 규칙에 어긋난 곳을 고쳐요. 다른 초안의 좋은 줄을 가져와도 돼요.
3. 다듬은 이야기 한 편만 답해요.`;
const editAsk = (words, drafts) => `요청 (${linesNote(words)}):
${wordList(words)}

${drafts.map((d, i) => `초안 ${i + 1}:\n${d}`).join('\n\n')}

다듬은 이야기 한 편 (답 꼴대로):`;

// 고쳐 쓰기 (6번): 앱 점검기가 찾은 문제만 고쳐요
const FIXER = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 편집자예요.
이야기 한 편과, 앱 점검기가 찾은 문제 목록을 받아요.
- 문제가 있는 곳만 고쳐요. 문제없는 줄은 글자 하나도 바꾸지 않아요.
- "'X'은(는) Y의 뜻이 아니에요": 그 줄의 뜻 말을 Y의 낱말 그대로 두고 끝만 바꾼 꼴로 고치고, 문장도 그에 맞게 고쳐요.
- "단어: 이야기에 0번": 그 단어가 들어간 줄을 흐름에 맞는 자리에 더하거나, 이음 줄을 그 단어 줄로 바꿔요. 2번이면 하나만 남겨요.
- 줄 수가 틀리면 이음 줄을 더하거나 빼요. 첫 줄·끝 줄에 단어가 있으면 그 단어를 다른 줄로 옮겨요.
- 그림 설명이 없거나 한글이 섞였으면 영어 그림 설명을 새로 써요.
- 고친 이야기 전체를 답해요.`;
const fixAsk = (words, story, problems) => `요청 (${linesNote(words)}):
${wordList(words)}

고칠 이야기:
${story}

점검기가 찾은 문제:
${problems.map(p => '- ' + p).join('\n')}

고친 이야기 전체 (답 꼴대로):`;
const roleSystem = (role, format) => `${role}

${STORY_RULES}

${FORMAT[format]}`;

// JSON 꼴 (5번). strict로 칸을 정해 두면 굵은 제목·번호·표시 실수가 없어져요
const STORY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    plan: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, word: { type: 'string' }, meaning: { type: 'string' } }, required: ['text', 'word', 'meaning'], additionalProperties: false } },
    pictures: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, scene: { type: 'string' } }, required: ['word', 'scene'], additionalProperties: false } }
  },
  required: ['title', 'plan', 'lines', 'pictures'],
  additionalProperties: false
};
const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    source: { type: 'string' }, hero: { type: 'string' }, place: { type: 'string' }, problem: { type: 'string' }, solution: { type: 'string' },
    beats: { type: 'array', items: { type: 'object', properties: { word: { type: 'string' }, event: { type: 'string' } }, required: ['word', 'event'], additionalProperties: false } }
  },
  required: ['source', 'hero', 'place', 'problem', 'solution', 'beats'],
  additionalProperties: false
};

// ---- 받은 요청 확인: 글자만 ----
const EN = /^[A-Za-z][A-Za-z '’.-]{0,39}$/;
const KO = /^[^{}|<>\n\r\t]{1,30}$/;
const POS = /^[a-z]{0,6}$/;
const TEXT_BAD = /data:|base64|<\s*(img|svg|script|iframe|object)|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i;
const KEYS = {
  '/story': ['words', 'model', 'effort', 'format', 'plan', 'drafts', 'editor', 'editorEffort'],
  '/fix': ['words', 'story', 'problems', 'model', 'effort', 'format']
};
function readWordList(ws) {
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
  return { words };
}
function readBody(path, body, allowModel) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { err: 'JSON 객체가 아니에요' };
  for (const k of Object.keys(body)) if (!KEYS[path].includes(k)) return { err: `받지 않는 칸: ${k.slice(0, 20)}` };
  const got = readWordList(body.words);
  if (got.err) return got;
  const out = { words: got.words };
  for (const k of ['model', 'editor']) {
    if (body[k] == null) continue;
    if (typeof body[k] !== 'string' || !allowModel(body[k])) return { err: '쓸 수 없는 모델이에요' };
    out[k] = body[k];
  }
  for (const k of ['effort', 'editorEffort']) {
    if (body[k] == null) continue;
    if (!EFFORTS.includes(body[k])) return { err: '생각 깊이는 none·low·medium·high예요' };
    out[k] = body[k];
  }
  if (body.format != null && !FORMATS.includes(body.format)) return { err: '꼴은 text·json이에요' };
  out.format = body.format || 'text';
  if (body.plan != null && typeof body.plan !== 'boolean') return { err: 'plan은 true·false예요' };
  out.plan = body.plan === true;
  if (body.drafts != null && !(Number.isInteger(body.drafts) && body.drafts >= 1 && body.drafts <= 3)) return { err: '초안은 1~3편이에요' };
  out.drafts = body.drafts || 1;
  if (path === '/fix') {
    const s = body.story, ps = body.problems;
    if (typeof s !== 'string' || s.length < 20 || s.length > 6000 || TEXT_BAD.test(s)) return { err: '고칠 이야기는 글자(6천 자까지)만 받아요' };
    if (!Array.isArray(ps) || ps.length < 1 || ps.length > 40 || ps.some(p => typeof p !== 'string' || !p.trim() || p.length > 200 || TEXT_BAD.test(p))) return { err: '문제 목록은 글자 40줄까지만 받아요' };
    out.story = s.trim();
    out.problems = ps.map(p => p.trim());
  }
  return out;
}
// 예전 이름 (시험이 써요): /story 요청 확인
const readWords = (body, allowModel) => readBody('/story', body, allowModel);

// ---- AI 답 읽기 ----
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
const usageOf = r => (shapeOf(r).usage || { in: undefined, out: undefined });
// 생각 글을 떼요: <think>…</think>, gpt-oss가 섞는 analysis…assistantfinal
const unthink = t => {
  let s = String(t || '');
  const fin = s.lastIndexOf('assistantfinal');
  if (fin >= 0) s = s.slice(fin + 'assistantfinal'.length);
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '');
};
// 앱 꼴 글을 앱이 읽는 꼴로 고쳐요: '**제목**' 다음 줄에 제목을 쓴 것 → '제목: …', 번호·글머리표·굵은 글씨 떼기,
// 생각 글이 섞이면 마지막 '제목' 줄부터만
function clean(t) {
  let ls = unthink(t).split('\n').map(l => l.replace(/\*\*|__/g, '').replace(/^\s*#{1,6}\s*/, '').replace(/^\s*(?:\d+[.)]|[-*•])\s+/, '').trim());
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
  return out.join('\n').trim();
}
// JSON 답 읽기: 예전 Workers AI 꼴(llama 등)은 response가 이미 객체로 와요. 글이면 ```·생각 글을 떼고 { … }만
function parseJSON(t) {
  const s = unthink(t), a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  const body = s.slice(a, b + 1);
  for (const c of [body, body.replace(/,\s*([}\]])/g, '$1')]) { try { return JSON.parse(c); } catch { /* 다음 */ } }
  return null;
}
function jsonFrom(r) {
  const o = r && r.response;
  if (o && typeof o === 'object' && !Array.isArray(o) && !o.choices && !o.output && !('response' in o)) return o;
  return parseJSON(textOf(r));
}
function oneLine(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
// JSON 이야기 → 앱 꼴 글. 뜻 말(meaning)이 문장에 그대로 있으면 그 자리에 {영어|뜻 말}을 넣어요.
// 없으면 표시 없이 두고 → 앱 점검기가 "단어 0번"으로 잡아 /fix로 고쳐요
function tagLine(l, idx) {
  if (typeof l === 'string') return oneLine(l);
  if (!l || typeof l !== 'object') return '';
  let text = oneLine(l.text);
  if (!text) return '';
  if (/\{[^{}|]+\|[^{}|]+\}/.test(text)) return text; // 모델이 표시를 직접 넣었으면 그대로
  text = text.replace(/[{}|]/g, '');
  const en = idx.get(oneLine(l.word).toLowerCase()), m = oneLine(l.meaning).replace(/[.,!?。]+$/, '');
  if (!en || !m) return text;
  const i = text.indexOf(m);
  return i < 0 ? text : text.slice(0, i) + `{${en}|${m}}` + text.slice(i + m.length);
}
function storyText(j, words) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.lines) || !j.lines.length) return '';
  const idx = new Map(words.map(([en]) => [en.toLowerCase(), en]));
  const lines = j.lines.map(l => tagLine(l, idx)).filter(Boolean);
  const order = [];
  for (const l of lines) for (const m of l.matchAll(/\{([^{}|]+)\|/g)) if (!order.includes(m[1].toLowerCase())) order.push(m[1].toLowerCase());
  let pics = Array.isArray(j.pictures) ? j.pictures : j.pictures && typeof j.pictures === 'object' ? Object.entries(j.pictures).map(([word, scene]) => ({ word, scene })) : [];
  pics = pics.filter(p => p && oneLine(p.word) && oneLine(p.scene));
  const rank = p => { const k = order.indexOf(oneLine(p.word).toLowerCase()); return k < 0 ? 99 : k; };
  pics = pics.map((p, i) => [rank(p), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
  return ['제목: ' + oneLine(j.title), '줄거리: ' + oneLine(j.plan), '이야기:', ...lines, '그림:', ...pics.map(p => `${oneLine(p.word)}: ${oneLine(p.scene)}`)].join('\n');
}
// 망가진 답: 비었거나, 이야기가 거의 없거나, 같은 글자만 되풀이 (gpt-oss가 가끔 '!!!!…'를 줘요)
function broken(t) {
  if (!t || /(.)\1{30,}/.test(t)) return true;
  const m = t.match(/이야기\s*[:：]([\s\S]*?)(?:\n그림\s*[:：]|$)/);
  return !m || m[1].split('\n').filter(l => l.trim()).length < 3;
}

// ---- AI에게 묻기 ----
// 생각 깊이: 생각하는 모델은 생각에 글자 한도를 다 쓰면 답이 잘리거나 비어요 (2026-10-31 재 봄:
// gpt-oss medium은 생각 글이 새고 3/10, qwen3.8은 기본 xhigh라 빈 답). 모델마다 문서에 적힌 방법으로 정해요.
const isOss = m => /gpt-oss/i.test(m);
const defaultEffort = m => (isOss(m) || /qwen3|nemotron/i.test(m) ? 'low' : 'none');
// 생각을 보통 이상으로 켜면 생각 글이 길어져요 → 답이 잘리지 않게 글자 한도를 넉넉히 (Nemotron 문서 보기도 16000)
const maxOut = effort => (effort === 'medium' || effort === 'high' ? 12000 : MAX_OUT);
function thinking(model, effort) {
  if (/qwen3/i.test(model)) return { reasoning_effort: effort === 'none' ? 'low' : effort === 'high' ? 'xhigh' : effort };
  if (/nemotron/i.test(model)) return { chat_template_kwargs: effort === 'none' ? { enable_thinking: false } : { enable_thinking: true, low_effort: effort === 'low' } };
  if (/gemma-4|glm-4|glm-5/i.test(model)) return { chat_template_kwargs: { enable_thinking: effort !== 'none' } };
  return {};
}
// JSON 꼴 칸 (문서의 response_format): 새 모델은 OpenAI 꼴 {name, schema, strict}, 예전 모델(llama·gpt-oss)은 json_schema에 바로 schema
const OPENAI_STYLE = /gemma-4|glm-|nemotron|qwen3|kimi|deepseek-v4/i;
const formatOf = (model, schema) => (OPENAI_STYLE.test(model)
  ? { type: 'json_schema', json_schema: { name: 'answer', schema, strict: true } }
  : { type: 'json_schema', json_schema: schema });
const isLimit = msg => /limit|quota|neuron|429|capacity|4006/i.test(msg);
const msgs = (system, user) => [{ role: 'system', content: system }, { role: 'user', content: user }];
// 한 번 묻기. gpt-oss는 Responses 꼴(생각 깊이를 정할 수 있어요)을 먼저, 안 되면 채팅 꼴로.
// JSON 칸을 정한 요청이 오류면 칸 없이 다시 물어요 (규칙 글에 JSON 꼴이 적혀 있어요). 하루 한도 오류면 더 묻지 않아요
async function callAI(env, model, system, user, effort, schema) {
  const tries = [];
  if (isOss(model)) {
    tries.push(() => env.AI.run(model, { instructions: system, input: user, reasoning: { effort: effort === 'none' ? 'low' : effort }, max_output_tokens: maxOut(effort) }));
    tries.push(() => env.AI.run(model, { messages: msgs(system, user), max_tokens: maxOut(effort), temperature: 0.7, ...(schema ? { response_format: formatOf(model, schema) } : {}) }));
  } else {
    const base = { messages: msgs(system, user), max_tokens: maxOut(effort), temperature: 0.7, ...thinking(model, effort) };
    if (schema) tries.push(() => env.AI.run(model, { ...base, response_format: formatOf(model, schema) }));
    tries.push(() => env.AI.run(model, base));
  }
  const errs = [], t0 = Date.now();
  for (const f of tries) {
    try { return { r: await f(), ms: Date.now() - t0 }; } catch (e) {
      errs.push(String((e && e.message) || e).slice(0, 260));
      if (isLimit(errs[errs.length - 1])) break;
    }
  }
  throw new Error(errs.join(' / 다른 꼴: '));
}
// 한 단계 (쓰기·뼈대·편집·고치기). 답 글을 앱 꼴로 바꾸고, 쓴 토큰을 적어요
async function step(env, steps, name, model, system, user, effort, format, words, schema) {
  const { r, ms } = await callAI(env, model, system, user, effort, schema);
  const u = usageOf(r), shape = shapeOf(r);
  let text = '', json = null;
  if (schema === PLAN_SCHEMA) json = jsonFrom(r);
  else if (format === 'json') { json = jsonFrom(r); text = storyText(json, words); }
  else text = clean(textOf(r));
  steps.push({ step: name, model, effort, ms, in: u.in, out: u.out });
  return { text, json, shape };
}
// 쓰기: 망가진 답이면 한 번 더 물어요
async function writeStory(env, steps, model, effort, format, words, plan, name = 'write') {
  const system = writerSystem(format), user = ask(words, plan), schema = format === 'json' ? STORY_SCHEMA : null;
  let got = await step(env, steps, name, model, system, user, effort, format, words, schema);
  if (broken(got.text)) got = await step(env, steps, name + '-again', model, system, user, effort, format, words, schema);
  return got;
}
const validPlan = j => (j && typeof j === 'object' && Array.isArray(j.beats) && j.beats.length ? j : null);

async function story(env, q) {
  const steps = [], out = { model: q.model, effort: q.effort, format: q.format, steps };
  let plan = null;
  if (q.plan) {
    const p = await step(env, steps, 'plan', q.model, PLANNER, planAsk(q.words), q.effort, q.format, q.words, PLAN_SCHEMA);
    plan = validPlan(p.json);
    out.plan = plan;
  }
  if (q.drafts > 1 || q.editor) {
    const editor = q.editor || q.model, editorEffort = q.editorEffort || defaultEffort(editor);
    const drafts = await Promise.all(Array.from({ length: q.drafts }, (_, i) => writeStory(env, steps, q.model, q.effort, q.format, q.words, plan, 'draft' + (i + 1))));
    const good = drafts.map(d => d.text).filter(t => !broken(t));
    out.drafts = good;
    out.editor = editor;
    if (!good.length) return { ...out, text: '', shape: drafts[0] && drafts[0].shape };
    const schema = q.format === 'json' ? STORY_SCHEMA : null;
    const e = await step(env, steps, 'edit', editor, roleSystem(EDITOR, q.format), editAsk(q.words, good), editorEffort, q.format, q.words, schema);
    out.edited = !broken(e.text);
    return { ...out, text: out.edited ? e.text : good[0], shape: e.shape };
  }
  const w = await writeStory(env, steps, q.model, q.effort, q.format, q.words, plan);
  return { ...out, text: w.text, shape: w.shape };
}
async function fix(env, q) {
  const steps = [], schema = q.format === 'json' ? STORY_SCHEMA : null;
  let got = await step(env, steps, 'fix', q.model, roleSystem(FIXER, q.format), fixAsk(q.words, q.story, q.problems), q.effort, q.format, q.words, schema);
  if (broken(got.text)) got = await step(env, steps, 'fix-again', q.model, roleSystem(FIXER, q.format), fixAsk(q.words, q.story, q.problems), q.effort, q.format, q.words, schema);
  return { model: q.model, effort: q.effort, format: q.format, text: got.text, shape: got.shape, steps };
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
  const url = new URL(req.url), path = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: cors(req)['access-control-allow-origin'] ? 204 : 403, headers: cors(req) });
  if (req.headers.get('origin') && !cors(req)['access-control-allow-origin']) return reply(req, 403, { error: '허락하지 않은 사이트예요' });
  if (path === '/' && req.method === 'GET') return reply(req, 200, { ok: true, v: VERSION });
  if (!KEYS[path]) return reply(req, 404, { error: '없는 주소예요' });
  if (req.method !== 'POST') return reply(req, 405, { error: 'POST만 받아요' });
  if (!env.WG_TOKEN || !env.AI) return reply(req, 503, { error: '서버 설정이 끝나지 않았어요 (WG_TOKEN, AI 연결)' });
  const auth = req.headers.get('authorization') || '';
  if (!same(auth.replace(/^Bearer\s+/i, ''), env.WG_TOKEN)) return reply(req, 401, { error: '열쇠가 맞지 않아요' });
  if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return reply(req, 415, { error: 'JSON 글만 받아요 (사진은 받지 않아요)' });
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY[path]) return reply(req, 413, { error: '요청이 너무 커요 (글자만 보내요)' });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY[path]) return reply(req, 413, { error: '요청이 너무 커요 (글자만 보내요)' });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(req, 400, { error: 'JSON이 아니에요' }); }
  const locked = String(env.WG_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const q = readBody(path, body, m => (locked.length ? locked.includes(m) : MODEL_ID.test(m)));
  if (q.err) return reply(req, 400, { error: q.err });
  q.model = q.model || env.WG_MODEL || (locked.length ? locked : MODELS)[0];
  q.effort = q.effort || (EFFORTS.includes(env.WG_EFFORT) ? env.WG_EFFORT : defaultEffort(q.model));
  const t0 = Date.now();
  try {
    const res = path === '/fix' ? await fix(env, q) : await story(env, q);
    const { shape, ...rest } = res;
    const usage = (res.steps || []).reduce((a, s) => ({ in: a.in + (s.in || 0), out: a.out + (s.out || 0) }), { in: 0, out: 0 });
    if (!res.text) return reply(req, 502, { error: 'AI가 빈 답을 줬어요', ...rest, shape });
    return reply(req, 200, { ...rest, ms: Date.now() - t0, tries: (res.steps || []).filter(s => /^(write|fix)/.test(s.step)).length, usage });
  } catch (e) {
    // 단어는 적지 않고, 오류 종류만 돌려줘요 (하루 무료 한도를 넘으면 여기로 와요)
    const msg = String((e && e.message) || e).slice(0, 600);
    return reply(req, isLimit(msg) ? 429 : 502, { error: 'AI 오류: ' + msg, model: q.model });
  }
}

// _ 는 시험(app/tests/server.test.cjs)·PLAYGROUND.md 만들기용이에요
export default {
  fetch: handle,
  _: { RULES, ask, readWords, readBody, textOf, clean, shapeOf, thinking, parseJSON, storyText, broken, writerSystem, roleSystem, EDITOR, FIXER, PLANNER, EXAMPLE_TEXT, STORY_SCHEMA, PLAN_SCHEMA, MODELS, ORIGINS }
};
