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

## 하는 법

1. 모델 하나를 열어요.
${MODELS.map(([name, id]) => `   - ${name}: https://playground.ai.cloudflare.com/?model=${id}`).join('\n')}
2. System(시스템) 칸에 아래 **규칙 글**을 붙여 넣어요. 글상자 오른쪽 위의 복사 단추를 누르면 한 번에 복사돼요.
3. 메시지 칸에 아래 **단어** 가운데 하나를 붙여 넣고 보내요. 같은 단어를 여러 모델에 보내면 견주기 쉬워요.
4. 읽어 볼 것
   - 줄과 줄이 까닭과 결과로 이어지는지 (갑자기 나오는 인물·사건이 없는지)
   - 단어 뜻이 문장에 자연스럽게 맞는지
   - 재미있는지 (동화를 비틀거나 웃긴 상황인지)
   - 그림 설명이 영어로, 단어 뜻이 떠오르게 쓰였는지
5. 마음에 드는 모델·이야기가 있으면 Claude에게 알려 줘요.

Playground에서는 모델의 생각(추론)이 켜져 있을 수 있어요. 이야기 서버는 생각을 꺼서 써요 (gpt-oss·Qwen은 얕게).
그래서 Playground가 조금 더 느리고, 이야기가 조금 다를 수 있어요.

## 규칙 글 (System 칸)

${block(RULES)}

## 단어 (메시지 칸)

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
