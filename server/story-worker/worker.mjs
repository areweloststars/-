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
// - POST /story {words, model?, effort?, format?, plan?, drafts?, editor?, editorEffort?, stream?, notes?, style?}
//   style (10판): 'twist'(기본, 명작 비틀기) · 'simple'(한 인물이 한 가지 일을 차례로 겪는 쉬운 이야기, 2026-11-06 사용자가 고름)
//   scene (11판): /group이 짠 그 묶음의 장면과 단어마다 일어나는 일(글자). 이 장면 안에서 그 일들이 차례로 이어지게 써요
// - POST /group {words(6~40개), model?, effort?, stream?, notes?, draft?} (11판): 단어장 전체를 6개씩, 한 장면에 어울리는 묶음으로 나눠요.
//   2026-11-06 사용자가 정함: "뉴런은 단어들을 한 장면에 어울리는 묶음으로 모으는 것에 집중" (좋아를 받은 2편은 단어가 처음부터 한 장면에 모이는 묶음이었어요).
//   draft: 앞서 받은 묶음(JSON 글)을 따져 보고 어울리지 않는 단어를 바꿔요 (두 번째 생각). 답 text는 JSON 글 {"groups":[{scene, words:[{word, event}]}]}
//   format 'text': AI가 앱 꼴 글을 바로 써요 / 'json': AI는 칸(제목·문장·단어·뜻 말·그림)만 채우고, {영어|뜻} 표시와 줄 꼴은 서버가 만들어요
//          'plain' (7판): 앱 꼴이지만 {영어|뜻} 표시 없이 자연스러운 문장으로만 써요. 표시는 앱이 뜻 말을 찾아 붙여요
//   plan true: 먼저 뼈대(비튼 동화·주인공·문제·해결·단어마다 사건)를 짜고 그 뼈대대로 써요 (두 번 물어요)
//   drafts 2~3: 작가 모델이 초안을 여러 편 쓰고, editor 모델이 가장 잘 이어지는 것을 골라 다듬어요
//   stream true (7판): AI 답을 받는 대로 그대로 흘려 보내요 (text/event-stream). 생각 보통(medium)은 답이 길어
//          한 번에 받으면 2분쯤에 끊겨요(3046) → 흘려 받으면 끊기지 않아요. text·plain 꼴의 한 번 쓰기에만 돼요
//          (8판: 흘려 받아도 Workers AI는 120초에서 끊어요. 붐비는 때(2026-11-05 오전 9시)는 생각 보통이 120초 안에 끝나지 않았어요)
//   notes (8판): 끊긴 흘려 받기에서 모은 AI의 생각 글(이 서버의 AI가 쓴 글). 앱이 생각 끔(effort none)으로 다시 물을 때 보내면
//          그 생각대로 이야기를 빨리 써요 (생각을 처음부터 다시 하지 않아서 120초 안에 끝나요). text·plain 꼴의 한 번 쓰기에만, 2만 자까지
// - POST /fix {words, story, problems, model?, effort?, format?, stream?, style?}: 점검기가 찾은 문제가 있는 곳만 고쳐요
// 답: {text(앱 꼴: 제목·줄거리·이야기·그림), model, effort, format, ms, steps:[{step, model, ms, in, out}], plan?, drafts?}
//   stream이면 AI의 흘려 받기 글 그대로 (data: {choices:[{delta:{content, reasoning_content}}]} … data: [DONE]).
//   앱이 content만 모아 읽어요 (생각 글 reasoning_content는 버려요)
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
const FORMATS = ['text', 'json', 'plain'];
const ORIGINS = ['https://areweloststars.github.io'];
const MAX_BODY = { '/story': 65536, '/fix': 16384, '/group': 65536 }; // 생각 메모(notes)·묶음 초안(draft)·장면(scene)이 있을 때만 크게
const WORDS_ONLY = { '/story': 2048, '/group': 6144 }; // 그것들이 없으면 단어 글자뿐이라 작아요 (/group은 단어 40개까지)
const MAX_OUT = 4000;
const VERSION = 11;

// ---- 규칙 글 ----
// 앱 점검기(check.cjs, 게임의 aiLineWhy·aiMark)와 같은 규칙을 사람 말로 적었어요.
// 뜻 말 보기는 점검기로 맞음·틀림을 확인한 낱말이고, 시험 단어가 아니에요 (재기가 부풀지 않게).
const WRITER = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 작가예요.
영어 단어와 뜻을 받으면, 단어를 모두 넣은 짧은 이야기 한 편과 그림 설명을 써요.`;

// 이야기 꼴 (10판): 'twist' = 지금까지 쓴 꼴(명작 비틀기) · 'simple' = 쉬운 이야기
// 2026-11-06 사용자가 'simple'을 골랐어요: 생각 보통 12편 가운데 좋아 2편(요리·사고와 구조)은 둘 다 동화 비틀기가 아니라
// 한 인물이 한 가지 일을 차례로 겪는 단순한 이야기였어요. 나쁜 예·좋은 예는 시험 단어가 아닌 낱말로 써요 (재기가 부풀지 않게)
const STYLES = ['twist', 'simple'];
const STORY_HEAD = {
  twist: `가장 중요한 것: 앞뒤가 이어지는 이야기
- 쓰기 전에 단어들이 한 이야기에 모일 수 있는 주인공·장소·문제를 먼저 정해요. 단어 차례는 이야기에 맞게 바꿔요.
- 줄과 줄은 까닭과 결과로 이어져요. 다음 줄은 앞 줄 때문에 일어나요. 앞에서 말하지 않은 인물·물건·사건이 갑자기 나오지 않아요.
- 단어 뜻이 그 문장에 자연스럽게 맞아야 해요. 뜻을 억지로 끼우지 않아요 (나쁜 예: 자전거를 용서했어요, 선생님께 참석했어요).
- 명작 동화·전래 동화·신화 가운데 하나를 골라 비틀거나 웃긴 상황으로 바꿔요. 밝고 건전하게, 기억에 남게 써요.
- 보기가 있으면 꼴만 보여 주는 거예요. 보기의 인물·장소·줄거리(양치기·늑대)는 쓰지 말고 새 이야기를 써요.`,
  simple: `가장 중요한 것: 앞뒤가 이어지는 쉬운 이야기
- 주인공 한 명이 한 곳에서 한 가지 일을 차례로 겪는 이야기를 써요 (예: 씨앗을 심어 꽃을 피우기, 길 잃은 강아지를 집에 데려다주기).
- 쓰기 전에 단어마다 그 뜻 그대로 일어나는 구체적인 일(움직임·장면)을 정하고, 일어나는 차례대로 놓아요. 단어 차례는 이야기에 맞게 바꿔요.
- 다음 줄은 앞 줄 바로 다음에 일어나는 일이에요 (시간 차례, 까닭과 결과). 앞에서 말하지 않은 인물·물건·사건이 갑자기 나오지 않아요.
- 동화를 비틀거나 반전을 넣지 않아요. 복잡한 줄거리보다, 누구나 그림처럼 떠올릴 수 있는 쉬운 장면이 좋아요.
- 단어 뜻이 그 문장에 자연스럽게 맞아야 해요. 그 뜻으로 그 문장을 우리말로 자연스럽게 말할 수 없으면 장면을 바꿔요
  (나쁜 예: 부지런한 의자에 앉았어요 / 망원경으로 수프 맛을 봤어요 / 아기가 아빠를 업어 주었어요).
- 앞뒤가 어긋나지 않게 해요 (나쁜 예: 배가 몹시 고픈 곰이 꿀을 강물에 던졌어요).
- 밝고 건전하게 써요.
- 보기가 있으면 꼴만 보여 주는 거예요. 보기의 인물·장소·줄거리(케이크 만들기)는 쓰지 말고 새 이야기를 써요.`
};
const STORY_BODY = `제목: 14자 이하 한국어 (영어·기호 없이). 줄거리: 한 문장, 80자 이하.
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
const storyRules = (style = 'twist') => `${STORY_HEAD[style]}

${STORY_BODY}`;
const STORY_RULES = storyRules('twist');

const FORMAT = {
  text: `답 꼴 (앱이 이 꼴 그대로 읽어요. 굵은 글씨(**)·번호·글머리표·다른 설명은 쓰지 않아요. '제목:'과 '줄거리:'는 같은 줄에 바로 이어 써요)
제목: 제목
줄거리: 줄거리
이야기:
한 줄에 한 문장씩. 뜻 말은 {영어|뜻 말}로 감싸요 (예: 소년은 크게 {shout|외쳤어요}.)
그림:
단어마다 한 줄씩 → 영어 단어: 영어 그림 설명`,
  // 7판: 표시를 쓰라고 하면 Nemotron이 '{permit|허락했어요} 주셨어요'처럼 문장을 깨뜨렸어요 (2026-11-04 사용자 가리고 견주기).
  // Playground에서 표시 없이 쓴 글은 자연스러웠어요 → 표시는 앱이 붙여요 (뜻 말을 받은 낱말 그대로 쓰면 앱이 찾아요)
  plain: `답 꼴 (앱이 이 꼴 그대로 읽어요. 굵은 글씨(**)·번호·글머리표·다른 설명은 쓰지 않아요. '제목:'과 '줄거리:'는 같은 줄에 바로 이어 써요)
제목: 제목
줄거리: 줄거리
이야기:
한 줄에 한 문장씩, 자연스러운 한국어 문장으로만 써요. { } | 같은 표시는 쓰지 않아요.
앱이 줄마다 뜻 말을 찾아 단어 표시를 붙여요. 그래서 뜻 말은 받은 뜻 낱말 그대로 두고 끝만 바꿔요 (예: 소년은 크게 외쳤어요.)
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
// 쉬운 이야기 보기 (10판, 일반 사전 낱말로 Claude가 새로 쓴 모범 이야기, 시험 단어 아님): 한 인물이 한 가지 일을 차례로
const EXAMPLE_SIMPLE = {
  words: [['apron', '앞치마'], ['flour', '밀가루'], ['oven', '오븐'], ['careful', '조심스러운'], ['decorate', '장식하다'], ['surprise', '깜짝 놀라게 하다']],
  title: '할머니를 위한 케이크',
  plan: '할머니 생신날 지우가 혼자 케이크를 만들어 할머니를 깜짝 놀라게 해요.',
  lines: [
    ['할머니 생신날 아침, 지우는 혼자 부엌에 들어갔어요.'],
    ['지우는 엄마의 앞치마를 허리에 단단히 둘렀어요.', 'apron', '앞치마'],
    ['그릇에 밀가루와 달걀을 넣고 힘껏 저었어요.', 'flour', '밀가루'],
    ['반죽을 틀에 담아 따뜻한 오븐에 넣었어요.', 'oven', '오븐'],
    ['다 구워지자 조심스러운 손길로 케이크를 꺼냈어요.', 'careful', '조심스러운'],
    ['식은 케이크를 딸기와 초로 예쁘게 장식했어요.', 'decorate', '장식했어요'],
    ['지우는 케이크를 들고 나가 할머니를 깜짝 놀라게 했어요.', 'surprise', '깜짝 놀라게 했어요'],
    ['할머니는 지우를 꼭 안아 주며 활짝 웃으셨어요.']
  ],
  pictures: [
    ['apron', 'a young girl tying a big yellow apron around her waist in a bright kitchen'],
    ['flour', 'the young girl stirring white flour and eggs in a large bowl with a wooden spoon'],
    ['oven', 'the young girl sliding a round cake pan into a warm glowing oven'],
    ['careful', 'the young girl in oven mitts slowly and carefully lifting a hot golden cake out of the oven'],
    ['decorate', 'the young girl placing red strawberries and small candles on top of a round cake'],
    ['surprise', 'an old grandmother gasping with joy as the young girl walks in holding a cake with lit candles']
  ]
};
const EXAMPLES = { twist: EXAMPLE, simple: EXAMPLE_SIMPLE };
const exampleJSON = (ex = EXAMPLE) => ({
  title: ex.title, plan: ex.plan,
  lines: ex.lines.map(([text, word = '', meaning = '']) => ({ text, word, meaning })),
  pictures: ex.pictures.map(([word, scene]) => ({ word, scene }))
});
const exampleText = ex => storyText(exampleJSON(ex), ex.words);
const EXAMPLE_TEXT = exampleText(EXAMPLE);
const EXAMPLE_SIMPLE_TEXT = exampleText(EXAMPLE_SIMPLE);
// 표시를 떼요: {영어|뜻 말} → 뜻 말 (plain 꼴 보기, plain 꼴로 고쳐 쓸 이야기)
const untag = t => String(t).replace(/\{[^{}|]+\|([^{}|]+)\}/g, '$1');
const exampleShow = (ex, format) => (format === 'json'
  ? '{"title": ' + JSON.stringify(ex.title) + ', "plan": ' + JSON.stringify(ex.plan) + ',\n "lines": [\n' +
    exampleJSON(ex).lines.map(l => '  ' + JSON.stringify(l)).join(',\n') + '\n ],\n "pictures": [\n' +
    exampleJSON(ex).pictures.map(p => '  ' + JSON.stringify(p)).join(',\n') + '\n ]}'
  : format === 'plain' ? untag(exampleText(ex)) : exampleText(ex));
const wordList = words => words.map(([en, ko]) => `${en} - ${ko}`).join('\n');
const linesNote = words => `단어 ${words.length}개 → 이야기 ${words.length + 2}~${words.length + 4}줄`;
const writerSystem = (format, style = 'twist') => `${WRITER}

${storyRules(style)}

${FORMAT[format]}

보기 (단어 6개 → 이야기 8줄)
요청:
${wordList(EXAMPLES[style].words)}
답:
${exampleShow(EXAMPLES[style], format)}`;
const RULES = writerSystem('text'); // 앱 꼴로 바로 쓰는 규칙 글 (PLAYGROUND.md에도 써요)

const ask = (words, plan, notes, scene) => `요청 (${linesNote(words)}):
${wordList(words)}${plan ? `
이야기 뼈대 (이 뼈대대로 써요. 단어 차례도 뼈대대로):
${JSON.stringify(plan, null, 1)}` : ''}${scene ? `
이 묶음의 장면과 단어마다 일어나는 일이에요. 이 장면 안에서, 이 일들이 차례로 이어지게 써요 (문장은 규칙에 맞게 새로 다듬어요):
<장면>
${scene}
</장면>` : ''}${notes ? `
이야기를 짜며 적어 둔 생각 메모예요 (중간에 끊겼을 수 있어요). 메모에서 고른 이야기·인물·단어 차례를 따라, 규칙과 답 꼴대로 이야기 한 편을 써요:
<메모>
${notes}
</메모>` : ''}
답:`;

// 묶음 짜기 (11판, /group): 단어장을 6개씩, 한 장면에서 받은 뜻 그대로 자연스럽게 쓰이는 묶음으로 나눠요.
// 2026-11-06 사용자: 좋아를 받은 2편(요리·사고와 구조)은 단어가 처음부터 한 장면에 모이는 묶음 → 묶는 데 AI를 많이 써요
const GROUPER = `너는 한국 어린이가 영어 단어를 외우는 그림 이야기 게임의 기획자예요.
단어장(영어 단어와 받은 뜻)을 받으면 단어를 6개씩 묶어요. 묶음 하나가 이야기 한 편이 돼요.

가장 중요한 것: 한 묶음의 단어 6개가 모두 한 장면(한 주인공, 한 곳, 한 가지 일)에서 받은 뜻 그대로 자연스럽게 쓰여야 해요.
- 먼저 단어마다 받은 뜻이 그대로, 자연스럽게 쓰이는 장면을 여러 개 떠올려요. 뜻이 좁은 단어는 그 뜻이 꼭 맞는 장면에만 넣어요.
- 같은 장면에 자연스럽게 모이는 단어끼리 묶어요. 묶음마다 장면(scene)을 한 문장으로 적어요: 누가, 어디서, 무슨 일을 하는지.
- 단어마다 그 장면에서 일어나는 일(event)을 한 문장으로 적어요. 받은 뜻 낱말을 그대로 넣은(끝만 바꾼) 자연스러운 한국어 문장이에요.
- event를 차례대로 읽으면 앞 일 때문에 다음 일이 일어나는 줄거리가 되게 차례를 정해요.
- 그 장면에서 자연스러운 문장을 만들 수 없는 단어는 다른 묶음에 넣어요. 억지로 끼운 단어가 하나도 없게 해요.
- 모든 단어를 한 번씩만 써요. 단어 수가 6으로 나누어떨어지지 않으면 묶음 하나만 5개나 7개로 해요.
답 꼴: JSON 하나만 써요 (다른 말이나 \`\`\` 표시는 쓰지 않아요).
{"groups": [{"scene": "장면 한 문장", "words": [{"word": "영어 단어", "event": "그 단어가 받은 뜻 그대로 쓰인 한 문장"}]}]}`;
const groupAsk = (words, draft, notes) => `요청 (단어 ${words.length}개 → 6개씩 묶음 ${Math.max(1, Math.round(words.length / 6))}개):
${wordList(words)}${draft ? `
묶음 초안이에요. 묶음마다 단어 6개가 한 장면에서 받은 뜻 그대로 자연스럽게 쓰이는지 하나씩 따져 봐요.
어울리지 않거나 event 문장이 억지스러운 단어는 더 잘 어울리는 묶음의 단어와 바꾸고, 장면과 event를 다시 써요. 고친 묶음 전체를 답 꼴대로 답해요:
<초안>
${draft}
</초안>` : ''}${notes ? `
묶음을 짜며 적어 둔 생각 메모예요 (중간에 끊겼을 수 있어요). 메모대로, 답 꼴에 맞춰 답해요:
<메모>
${notes}
</메모>` : ''}
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
const roleSystem = (role, format, style = 'twist') => `${role}

${storyRules(style)}

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
// 띄어쓰기 없이 길게 이어진 영문·숫자 (base64로 바꾼 사진 같은 것): 생각 글에는 이런 덩어리가 없어요
const BLOB = /[A-Za-z0-9+/=_-]{160,}/;
const MAX_NOTES = 20000;
const KEYS = {
  '/story': ['words', 'model', 'effort', 'format', 'plan', 'drafts', 'editor', 'editorEffort', 'stream', 'notes', 'style', 'scene'],
  '/fix': ['words', 'story', 'problems', 'model', 'effort', 'format', 'stream', 'style'],
  '/group': ['words', 'model', 'effort', 'stream', 'notes', 'draft']
};
const MAX_SCENE = 3000;
function readWordList(ws, min = 3, max = 10) {
  if (!Array.isArray(ws) || ws.length < min || ws.length > max) return { err: `단어는 ${min}~${max}개예요` };
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
  const got = path === '/group' ? readWordList(body.words, 6, 40) : readWordList(body.words);
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
  if (body.format != null && !FORMATS.includes(body.format)) return { err: '꼴은 text·json·plain이에요' };
  out.format = body.format || 'text';
  if (body.style != null && !STYLES.includes(body.style)) return { err: '이야기 꼴(style)은 twist·simple이에요' };
  out.style = body.style || 'twist';
  if (body.plan != null && typeof body.plan !== 'boolean') return { err: 'plan은 true·false예요' };
  out.plan = body.plan === true;
  if (body.drafts != null && !(Number.isInteger(body.drafts) && body.drafts >= 1 && body.drafts <= 3)) return { err: '초안은 1~3편이에요' };
  out.drafts = body.drafts || 1;
  if (body.stream != null && typeof body.stream !== 'boolean') return { err: 'stream은 true·false예요' };
  out.stream = body.stream === true;
  // 흘려 받기는 AI에게 한 번 묻고 답 글을 그대로 넘겨요 → 서버가 답을 고쳐 만들어야 하는 길(JSON 꼴·뼈대·초안·편집자)은 안 돼요
  if (out.stream && (out.format === 'json' || out.plan || out.drafts > 1 || out.editor)) return { err: '흘려 받기(stream)는 text·plain 꼴의 한 번 쓰기에만 돼요' };
  if (body.notes != null) {
    const n = body.notes;
    if (typeof n !== 'string' || !n.trim() || n.length > MAX_NOTES || TEXT_BAD.test(n) || BLOB.test(n)) return { err: '생각 메모는 글자(2만 자까지)만 받아요' };
    if (out.format === 'json' || out.plan || out.drafts > 1 || out.editor) return { err: '생각 메모(notes)는 text·plain 꼴의 한 번 쓰기에만 돼요' };
    out.notes = n.trim();
  }
  // 글자만 받는 칸: 묶음 초안(draft, /group)·장면(scene, /story). 둘 다 이 서버의 AI가 쓴 글이에요
  for (const [k, max] of [['draft', MAX_NOTES], ['scene', MAX_SCENE]]) {
    if (body[k] == null) continue;
    const t = body[k];
    if (typeof t !== 'string' || !t.trim() || t.length > max || TEXT_BAD.test(t) || BLOB.test(t)) return { err: `${k}는 글자(${max}자까지)만 받아요` };
    if (k === 'scene' && (out.format === 'json' || out.plan || out.drafts > 1 || out.editor)) return { err: '장면(scene)은 text·plain 꼴의 한 번 쓰기에만 돼요' };
    out[k] = t.trim();
  }
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
  // Nemotron 생각 끔: 9판부터 force_nonempty_content (문서: 답 글이 비지 않게). 8판에서 생각 메모로 다시 쓸 때 2번 다
  // 짧은 생각 글만 쓰고 답 글 없이 끝났어요 (2026-11-06)
  if (/nemotron/i.test(model)) return { chat_template_kwargs: effort === 'none' ? { enable_thinking: false, force_nonempty_content: true } : { enable_thinking: true, low_effort: effort === 'low' } };
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
async function writeStory(env, steps, model, effort, format, words, plan, name = 'write', notes = null, style = 'twist', scene = null) {
  const system = writerSystem(format, style), user = ask(words, plan, notes, scene), schema = format === 'json' ? STORY_SCHEMA : null;
  let got = await step(env, steps, name, model, system, user, effort, format, words, schema);
  if (broken(got.text)) got = await step(env, steps, name + '-again', model, system, user, effort, format, words, schema);
  return got;
}
const validPlan = j => (j && typeof j === 'object' && Array.isArray(j.beats) && j.beats.length ? j : null);

async function story(env, q) {
  const steps = [], out = { model: q.model, effort: q.effort, format: q.format, style: q.style, steps };
  let plan = null;
  if (q.plan) {
    const p = await step(env, steps, 'plan', q.model, PLANNER, planAsk(q.words), q.effort, q.format, q.words, PLAN_SCHEMA);
    plan = validPlan(p.json);
    out.plan = plan;
  }
  if (q.drafts > 1 || q.editor) {
    const editor = q.editor || q.model, editorEffort = q.editorEffort || defaultEffort(editor);
    const drafts = await Promise.all(Array.from({ length: q.drafts }, (_, i) => writeStory(env, steps, q.model, q.effort, q.format, q.words, plan, 'draft' + (i + 1), null, q.style)));
    const good = drafts.map(d => d.text).filter(t => !broken(t));
    out.drafts = good;
    out.editor = editor;
    if (!good.length) return { ...out, text: '', shape: drafts[0] && drafts[0].shape };
    const schema = q.format === 'json' ? STORY_SCHEMA : null;
    const e = await step(env, steps, 'edit', editor, roleSystem(EDITOR, q.format, q.style), editAsk(q.words, good), editorEffort, q.format, q.words, schema);
    out.edited = !broken(e.text);
    return { ...out, text: out.edited ? e.text : good[0], shape: e.shape };
  }
  const w = await writeStory(env, steps, q.model, q.effort, q.format, q.words, plan, 'write', q.notes, q.style, q.scene);
  return { ...out, text: w.text, shape: w.shape };
}
// plain 꼴은 표시 없는 글로 고쳐 써요: 앱이 표시를 붙인 이야기를 보내도 표시를 떼고 넘겨요
const fixStory = q => (q.format === 'plain' ? untag(q.story) : q.story);
async function fix(env, q) {
  const steps = [], schema = q.format === 'json' ? STORY_SCHEMA : null, system = roleSystem(FIXER, q.format, q.style), user = fixAsk(q.words, fixStory(q), q.problems);
  let got = await step(env, steps, 'fix', q.model, system, user, q.effort, q.format, q.words, schema);
  if (broken(got.text)) got = await step(env, steps, 'fix-again', q.model, system, user, q.effort, q.format, q.words, schema);
  return { model: q.model, effort: q.effort, format: q.format, text: got.text, shape: got.shape, steps };
}
// 흘려 받기 (7판): 묻는 글은 한 번 쓰기(/story)·고쳐 쓰기(/fix)와 같아요. 쓴 토큰은 마지막 조각에 와요 (include_usage).
// 서버는 받은 조각을 그대로 넘기기만 해요 → CPU를 거의 안 쓰고, AI를 기다리는 시간은 무료 요금제 CPU 한도(10ms)에 들지 않아요
// 묶음 짜기 (11판): 한 번 묻고 JSON 글을 그대로 돌려줘요 (앱·재기 도구가 읽고 확인해요)
async function group(env, q) {
  const steps = [], { r, ms } = await callAI(env, q.model, GROUPER, groupAsk(q.words, q.draft, q.notes), q.effort, null);
  const u = usageOf(r);
  steps.push({ step: q.draft ? 'review' : 'group', model: q.model, effort: q.effort, ms, in: u.in, out: u.out });
  return { model: q.model, effort: q.effort, text: unthink(textOf(r)).trim(), shape: shapeOf(r), steps };
}
function streamInput(path, q) {
  const [system, user] = path === '/fix' ? [roleSystem(FIXER, q.format, q.style), fixAsk(q.words, fixStory(q), q.problems)]
    : path === '/group' ? [GROUPER, groupAsk(q.words, q.draft, q.notes)]
    : [writerSystem(q.format, q.style), ask(q.words, null, q.notes, q.scene)];
  return {
    messages: msgs(system, user), max_tokens: maxOut(q.effort), temperature: 0.7, ...thinking(q.model, q.effort),
    stream: true, ...(OPENAI_STYLE.test(q.model) ? { stream_options: { include_usage: true } } : {})
  };
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
  const raw = await req.text(), bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_BODY[path]) return reply(req, 413, { error: '요청이 너무 커요 (글자만 보내요)' });
  let body;
  try { body = JSON.parse(raw); } catch { return reply(req, 400, { error: 'JSON이 아니에요' }); }
  if (WORDS_ONLY[path] && bytes > WORDS_ONLY[path] && !(body && ['notes', 'draft', 'scene'].some(k => typeof body[k] === 'string'))) return reply(req, 413, { error: '요청이 너무 커요 (글자만 보내요)' });
  const locked = String(env.WG_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  const q = readBody(path, body, m => (locked.length ? locked.includes(m) : MODEL_ID.test(m)));
  if (q.err) return reply(req, 400, { error: q.err });
  q.model = q.model || env.WG_MODEL || (locked.length ? locked : MODELS)[0];
  q.effort = q.effort || (EFFORTS.includes(env.WG_EFFORT) ? env.WG_EFFORT : defaultEffort(q.model));
  // 단어는 적지 않고, 오류 종류만 돌려줘요 (하루 무료 한도를 넘으면 여기로 와요)
  const aiError = e => { const msg = String((e && e.message) || e).slice(0, 600); return reply(req, isLimit(msg) ? 429 : 502, { error: 'AI 오류: ' + msg, model: q.model }); };
  if (q.stream) {
    if (isOss(q.model)) return reply(req, 400, { error: '흘려 받기(stream)는 gpt-oss에서 안 돼요' });
    try {
      const s = await env.AI.run(q.model, streamInput(path, q));
      if (!s || typeof s.getReader !== 'function') return reply(req, 502, { error: 'AI가 흘려 받기 답을 주지 않았어요', model: q.model, shape: shapeOf(s) });
      return new Response(s, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', ...cors(req) } });
    } catch (e) { return aiError(e); }
  }
  const t0 = Date.now();
  try {
    const res = path === '/fix' ? await fix(env, q) : path === '/group' ? await group(env, q) : await story(env, q);
    const { shape, ...rest } = res;
    const usage = (res.steps || []).reduce((a, s) => ({ in: a.in + (s.in || 0), out: a.out + (s.out || 0) }), { in: 0, out: 0 });
    if (!res.text) return reply(req, 502, { error: 'AI가 빈 답을 줬어요', ...rest, shape });
    return reply(req, 200, { ...rest, ms: Date.now() - t0, tries: (res.steps || []).filter(s => /^(write|fix)/.test(s.step)).length, usage });
  } catch (e) { return aiError(e); }
}

// _ 는 시험(app/tests/server.test.cjs)·PLAYGROUND.md 만들기용이에요
export default {
  fetch: handle,
  _: { RULES, ask, readWords, readBody, textOf, clean, shapeOf, thinking, parseJSON, storyText, broken, untag, streamInput, MAX_NOTES, STYLES, GROUPER, groupAsk, storyRules, EXAMPLE_SIMPLE_TEXT, writerSystem, roleSystem, EDITOR, FIXER, PLANNER, EXAMPLE_TEXT, STORY_SCHEMA, PLAN_SCHEMA, MODELS, ORIGINS, VERSION }
};
