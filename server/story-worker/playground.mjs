// PLAYGROUND.md 만들기: Cloudflare Playground(무료 체험 화면)에 붙여 넣을 규칙 글과 시험 단어 (1번: 사용자가 직접 써 보기)
//   node server/story-worker/playground.mjs          → PLAYGROUND.md 다시 쓰기
//   node server/story-worker/playground.mjs --check  → 규칙 글이 바뀌었는데 PLAYGROUND.md를 안 고쳤으면 실패
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import worker from './worker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { TEST_SETS } = createRequire(import.meta.url)('../../tools/finetune/v3/check.cjs');
const { RULES, ask } = worker._;
const MODELS = [
  ['Gemma 4 26B', '@cf/google/gemma-4-26b-a4b-it'],
  ['Nemotron 3 120B', '@cf/nvidia/nemotron-3-120b-a12b'],
  ['GLM-4.7-Flash', '@cf/zai-org/glm-4.7-flash'],
  ['gpt-oss-120b', '@cf/openai/gpt-oss-120b'],
  ['Llama 3.3 70B', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']
];
const SETS = [
  [8, '어려운 묶음: 서로 관계없는 단어'],
  [6, '어려운 묶음: 서로 관계없는 단어'],
  [10, '쉬운 묶음: 주제가 같은 단어 (요리)']
];
const block = s => '```text\n' + s + '\n```';

export function playground() {
  return `# Cloudflare Playground에서 직접 써 보기

이야기 서버가 쓰는 규칙 글과 시험 단어예요. Cloudflare의 무료 체험 화면(Playground)에 붙여 넣어 모델마다 이야기를 직접 읽어 봐요.
가입·설정이 필요 없고, 우리 계정의 하루 무료 한도도 쓰지 않아요.
이 파일은 \`node server/story-worker/playground.mjs\`로 만들어요. 규칙 글을 고치면 같이 다시 만들어요 (\`npm test\`가 확인해요).

## 한 모델씩 써 보기 (Model mode)

1. 아래 주소 하나를 새 탭에서 열어요. 그 모델을 고른 채로 열려요.
${MODELS.map(([name, id]) => `   - ${name}: https://playground.ai.cloudflare.com/models?model=${id}`).join('\n')}
2. 오른쪽 칸 **Parameters → Instructions** 글상자를 눌러, 원래 들어 있는 영어 글을 모두 지워요 (Ctrl+A → Delete).
3. 이 파일의 **규칙 글** 상자 오른쪽 위 복사 단추를 누르고, Instructions 글상자에 붙여 넣어요 (Ctrl+V).
4. 이 파일의 **단어** 상자 하나를 복사해서 화면 아래 "Ask anything..." 칸에 붙여 넣고, ↑ 단추를 눌러요.
5. 다른 모델은 다른 주소를 새 탭에서 열고 2~4를 되풀이해요. 같은 단어를 여러 모델에 보내면 견주기 쉬워요.

## 두 모델 나란히 써 보기 (Compare mode)

1. https://playground.ai.cloudflare.com/compare?modelA=@cf/google/gemma-4-26b-a4b-it&modelB=@cf/nvidia/nemotron-3-120b-a12b 를 열어요.
   B 칸이 다른 모델(GLM-4.7 Flash 등)로 열리면, B 칸 오른쪽 위 설정 단추 → Model에서 Provider와 Model을 바꿔요.
2. A 칸 오른쪽 위 설정 단추 → **Parameters → Instructions**에 규칙 글을 붙여 넣어요. B 칸도 똑같이 해요.
3. 화면 아래 "Ask anything..." 칸에 단어를 붙여 넣고 ↑ 단추를 누르면, 두 모델이 같은 단어로 나란히 써요.

## 읽어 볼 것

- 줄과 줄이 까닭과 결과로 이어지는지 (갑자기 나오는 인물·사건이 없는지)
- 단어 뜻이 문장에 자연스럽게 맞는지
- 재미있는지 (동화를 비틀거나 웃긴 상황인지)
- 그림 설명이 영어로, 단어 뜻이 떠오르게 쓰였는지

마음에 드는 모델·이야기가 있으면 Claude에게 알려 줘요 (화면을 찍어 보내도 돼요).
Playground에서는 모델의 생각(추론)이 켜져 있어요 (Nemotron은 보통 생각). 이야기 서버는 Nemotron·gpt-oss·Qwen은 생각을 얕게(low) 켜고,
나머지는 꺼서 써요. Playground와 같게 하려면 서버에 effort medium을 줘요. 그래서 이야기가 조금 다를 수 있어요.

## 규칙 글 (Instructions 칸)

${block(RULES)}

## 단어 (Ask anything 칸)

${SETS.map(([n, note]) => `### 묶음 ${n} — ${note}\n\n${block(ask(TEST_SETS[n - 1]))}`).join('\n\n')}
`;
}

const file = path.join(here, 'PLAYGROUND.md');
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = playground();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== now) { console.error('PLAYGROUND.md가 규칙 글과 달라요. node server/story-worker/playground.mjs 로 다시 만들어요'); process.exit(1); }
  } else fs.writeFileSync(file, now);
}
