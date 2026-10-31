# 이야기 서버 (Cloudflare Worker + Workers AI)

게임이 단어 6~8개로 이야기를 만들 때, 휴대폰 안 작은 AI(Gemma 4 E2B) 대신 서버의 큰 AI에게 부탁하는 작은 프로그램이에요.
2026-10-31 사용자가 Cloudflare로 정했어요. 먼저 시험 30편으로 이야기를 잘 잇는지 재고(기준 27편), 괜찮으면 게임에 붙여요.

## 무엇이 서버로 가나요

- **가는 것**: 단어 글자뿐이에요. 영어, 뜻, 품사 (예: `["lantern","등불","n"]`).
- **안 가는 것**: 사진이에요. 단어 사진은 지금처럼 휴대폰 안에서 읽고, 그 밖의 사진(사용자 사진·화면 캡처 등)은 절대 보내지 않아요.
  서버도 단어 글자가 아닌 것은 받지 않아요. JSON이 아니거나, 2KB보다 크거나, `words`·`model` 밖의 칸이 있거나,
  영어·뜻에 글자가 아닌 것이 섞이면 AI에게 묻기 전에 거절해요 (`app/tests/server.test.cjs`가 시험해요).
- 서버는 받은 단어를 적거나 저장하지 않아요. 만든 이야기는 휴대폰에 저장돼서, 놀 때는 인터넷이 없어도 돼요.

## 돈

Cloudflare **무료 요금제**로 써요. Workers AI는 하루 10,000 Neuron까지 무료이고 한국 시간 오전 9시에 다시 채워져요.
무료 요금제에서는 넘으면 그날만 오류(429)로 멈춰요. 유료 요금제(Workers Paid)로 바꾸지 않으면 돈이 나가지 않아요.
**이 프로젝트는 돈이 드는 것을 쓰지 않아요 (2026-10-31 사용자가 정함)**: Workers Paid로 바꾸지 않고, 결제가 필요한 API(Claude API 등)도 쓰지 않아요.

## 올리는 법 (사용자가 한 번)

1. <https://dash.cloudflare.com/sign-up>에서 가입해요 (무료).
2. 왼쪽 메뉴 **Workers & Pages**(또는 Compute → Workers) → **Create** → **Hello World**로 시작 → 이름 `wg-story` → **Deploy**.
3. **Edit code**를 눌러 원래 코드를 모두 지우고, 이 폴더의 `worker.mjs` 전체를 붙여 넣고 **Deploy**.
   휴대폰에서는 GitHub의 Raw 화면에서 전체 선택·복사하면 돼요.
4. Worker의 **Settings → Bindings → Add → Workers AI**, 이름(Variable name)은 `AI`.
5. **Settings → Variables and Secrets → Add**, 종류 **Secret**, 이름 `WG_TOKEN`, 값은 Claude가 준 열쇠.
   (지금은 시험용 열쇠예요. 게임에 붙일 때는 사이트 열쇠에서 만든 값으로 바꿔요.)
6. 위쪽에 보이는 주소(`https://wg-story.<계정 이름>.workers.dev`)를 Claude에게 알려 줘요.

선택: `WG_MODEL`(Text)로 기본 모델을 바꿔요. 요청에 `model`을 넣으면 `@cf/회사/이름` 꼴의 Workers AI 모델은 코드를 고치지 않고 시험할 수 있어요.
쓸 모델만 잠그려면 `WG_MODELS`(쉼표로 나눈 목록)를 넣어요.

## 묻는 법 (주소)

- `POST /story` `{words, model?, effort?, format?, plan?, drafts?, editor?, editorEffort?}`
  - `format`: `text`(AI가 앱 꼴 글을 바로 씀) 또는 `json`(AI는 칸만 채우고 `{영어|뜻}` 표시와 줄 꼴은 서버가 만듦 — 굵은 제목·번호·표시 실수가 없어져요)
  - `plan: true`: 먼저 뼈대(비튼 동화·주인공·문제·해결·단어마다 사건)를 짜고 그대로 써요 (두 번 물어요)
  - `drafts: 2~3`, `editor`: 작가 모델이 초안을 여러 편 쓰고, 편집자 모델이 가장 잘 이어지는 것을 골라 다듬어요
- `POST /fix` `{words, story, problems, model?, effort?, format?}`: 앱 점검기가 찾은 문제(`problems`)가 있는 곳만 고쳐요.
  이야기 글·점검기 글도 글자만 받아요 (6천 자·40줄까지, `data:` 주소 등은 거절).
- 답: `{text, model, effort, format, ms, steps:[{step, model, ms, in, out}], usage, plan?, drafts?, editor?, edited?}` — `text`는 앱 꼴(제목·줄거리·이야기·그림).

## 쓰는 모델: Nemotron 3 120B (2026-10-31 사용자가 고름)

사용자가 Playground로 직접 읽고 "유일하게 이야기가 이어진다"며 골랐어요. 서버의 기본 모델이에요 (생각 low, effort medium이면 Playground와 같은 보통 생각).
한 편에 무료 한도 340쯤(하루 30편쯤)이라, 시험은 하루에 조금씩 해요. 게임에서는 단어 30개 한 쪽이 5편이라 하루 쓰기에 넉넉해요.
문장 속 단어에 `{영어|뜻}` 표시를 잘 안 붙여요 → 앱이 `aiMark`로 표시를 붙여요 (`tools/finetune/v3/check.cjs`의 `retag`).

## 무료로 쓸 수 있는 모델 (2026-10-31 Cloudflare 문서·요금표)

| 모델 | 생각 | 한 편 Neuron 어림 | 하루 무료로 |
|---|---|---|---|
| `@cf/openai/gpt-oss-120b` | low | 130 | 60편쯤 |
| `@cf/google/gemma-4-26b-a4b-it` | 끔 | 45 | 200편쯤 |
| `@cf/zai-org/glm-4.7-flash` | 끔 | 50 | 200편쯤 |
| `@cf/nvidia/nemotron-3-120b-a12b` | 끔 | 230 | 40편쯤 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 없음 | 260 | 40편쯤 |
| `@cf/qwen/qwen3.8-27b` | low | 400~ | 20편쯤 |

- 한 편 = 입력 2천·출력 1천 토큰쯤으로 어림했어요. 서버 답의 `usage`로 실제 토큰 수를 봐요.
- 생각하는 모델은 생각에 글자 한도를 다 쓰면 답이 잘리거나 비어요. 그래서 서버가 모델마다 문서에 적힌 방법으로 생각 깊이를 정해요
  (gpt-oss `reasoning.effort`, qwen `reasoning_effort`(기본 xhigh라 꼭 low로), nemotron·gemma·glm `chat_template_kwargs.enable_thinking`).
  요청의 `effort`(none·low·medium·high)로 바꿀 수 있어요.
- DeepSeek V4·GLM-5·Kimi는 무료 요금제에서 못 쓰거나 비싸요.

## 재기 (Claude가)

```sh
WG_STORY=https://wg-story.<계정>.workers.dev WG_TOKEN=<열쇠> WG_MODEL=@cf/openai/gpt-oss-120b \
  node tools/finetune/v3/eval.cjs cf-gptoss120 [--regroup]
```

- 시험 단어 10묶음 × 3번 = 30편을 서버에 보내고, 앱과 같은 점검기(`check.cjs`)로 형식을 봐요. 이어짐·뜻은 읽고 판정해요.
- 결과는 `tools/story-lab/`에 써요 (저장소에 넣지 않아요).
- 클라우드 세션에서 재려면 세션 네트워크 설정에 `workers.dev`를 더하고, Node `fetch`가 프록시를 거치게
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`를 앞에 붙여요.
- 모델을 견줄 때는 `--tries=1`(묶음마다 1편, 10편)로 하루 무료 한도를 아껴요.
- 새 길(JSON·고쳐 쓰기·뼈대·작가+편집자)은 `tools/finetune/v3/eval-server.cjs`로 재요. 점검기로 보고 틀리면 `/fix`로 고치고, 모델별 Neuron을 세요:
  `node tools/finetune/v3/eval-server.cjs gemma-json --model=@cf/google/gemma-4-26b-a4b-it --format=json --fix=2 --sets=6,8 --tries=2`
- 사람 눈으로 견주기: `PLAYGROUND.md`(Cloudflare 무료 체험 화면에 붙여 넣을 규칙 글·단어).

## 게임에 붙일 때 (재기 결과가 좋으면, 사용자에게 물은 뒤)

- 열쇠: 앱이 사이트 열쇠로 `HMAC-SHA256(사이트 열쇠, "wg-story-server-v1")`를 만들어 보내고, 같은 값을 `WG_TOKEN`에 넣어요.
  사이트 열쇠 자체는 휴대폰 밖으로 나가지 않아요. 열쇠 없는 체험판(`play.html`)은 서버를 쓰지 않아요.
- 앱은 서버 답을 휴대폰 안 점검기로 확인하고, 틀리거나 인터넷이 없거나 하루 한도가 넘으면 지금 방식(휴대폰 안)으로 만들어요.
