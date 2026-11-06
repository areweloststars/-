#!/bin/bash
# 이야기 서버 재기 차례 (2026-10-31~). 열쇠·주소는 환경 변수로만 (저장소에 넣지 않아요):
#   WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> bash tools/finetune/v3/server-rounds.sh <차례>
# 차례: prelim(예선) · ways(길 견주기) · ways2(7판: 생각 보통 흘려 받기·표시 없이 쓰기) · ways3(주제 묶음) · ways4(쉬운 이야기) · group(묶음 짜기, 11판) · final(본선, 길은 WAY로: 예 WAY="--model=@cf/google/gemma-4-26b-a4b-it --plan")
# 하루 무료 한도(10,000 Neuron)가 다 차면 그 차례에서 멈춰요 (한국 시간 오전 9시에 다시 채워져요). 결과: tools/story-lab/srv-*.txt
cd "$(dirname "$0")/../../.."
export NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-/root/.ccr/ca-bundle.crt} NODE_NO_WARNINGS=1
G=@cf/google/gemma-4-26b-a4b-it N=@cf/nvidia/nemotron-3-120b-a12b O=@cf/openai/gpt-oss-120b
run() { name=$1; shift; node tools/finetune/v3/eval-server.cjs "$name" "$@" > /dev/null 2>&1; tail -2 "tools/story-lab/srv-$name.txt" | head -1; if grep -q "하루 무료 한도" "tools/story-lab/srv-$name.txt"; then echo "STOP: 하루 무료 한도"; exit 0; fi; }
case "$1" in
  prelim) # 어려운 묶음 6·8 × 2편, JSON + 고쳐 쓰기 2번 (2026-10-31에 했어요)
    P="--format=json --fix=2 --sets=6,8 --tries=2"
    run pre-gemma --model=$G $P; run pre-glm --model=@cf/zai-org/glm-4.7-flash $P; run pre-nemotron-off --model=$N --effort=none $P
    run pre-gptoss --model=$O --effort=low $P; run pre-llama --model=@cf/meta/llama-3.3-70b-instruct-fp8-fast $P; run pre-nemotron-low --model=$N --effort=low $P ;;
  ways) # 길 견주기 (2026-11-01~): 이야기 모델은 사용자가 고른 Nemotron 3 120B. 묶음 2·4·6·8·10 × 1편, 고쳐 쓰기 2번
    # 한 편에 340~600 Neuron이라 하루 한도 안에서 5편씩. 생각 보통(medium, Playground와 같음)은 서버 6판(글자 한도 12000)부터.
    P="--model=$N --fix=2 --tries=1 --sets=2,4,6,8,10"
    V=$(curl -s "${WG_STORY%/}/" | sed -n 's/.*"v":\([0-9]*\).*/\1/p')
    run way-nem-low-text --effort=low --format=text $P
    if [ "${V:-0}" -ge 6 ]; then run way-nem-med-text --effort=medium --format=text $P; else echo "서버가 6판이 아니라 생각 보통(medium)은 건너뛰어요 (답이 잘릴 수 있어요)"; fi
    run way-nem-low-json --effort=low --format=json $P
    run way-nem-low-plan --effort=low --format=json --plan $P ;;
  ways2) # 7판 길 견주기 (2026-11-04~): 사용자가 가리고 견주며 '모두 별로'가 많았어요 → 두 가지를 바꿔 봐요
    # - 표시 없이 쓰기(plain): {영어|뜻} 표시를 쓰라고 하면 Nemotron이 문장을 깨뜨려요. 표시는 앱이 붙여요 (Playground에서 표시 없이 쓴 글은 자연스러웠어요)
    # - 생각 보통(medium, Playground와 같음)은 흘려 받기로: 한 번에 받으면 2분쯤에 끊겨요(3046)
    # 이어짐을 견주는 차례라 고쳐 쓰기 없이 처음 쓴 글로
    V=$(curl -s "${WG_STORY%/}/" | sed -n 's/.*"v":\([0-9]*\).*/\1/p')
    [ "${V:-0}" -ge 7 ] || { echo "서버가 7판이 아니에요 (지금 ${V:-?}판) → 대시보드에 7판 worker.mjs를 붙여 넣어야 해요"; exit 2; }
    P="--model=$N --fix=${FIX:-0} --tries=1 --sets=${SETS:-2,4,6,8,10}"
    # 2026-11-04 사용자 판정: "생각 low는 별로" → 생각 보통만 견줘요 (보통 한 편 900 Neuron쯤 → 두 길 × 5편이 하루 한도 안)
    run way2-nem-med-plain --effort=medium --format=plain --stream $P
    run way2-nem-med-text --effort=medium --format=text --stream $P ;;
  ways3) # 주제 묶음 (2026-11-05~): 사용자가 '좋아'라고 한 한 편(묶음 10)만 단어가 한 장면에 모이는 묶음(요리)이었어요 (11-03 low 견주기에서도 묶음 10을 골랐어요)
    # → 같은 시험 단어를 장면이 비슷한 것끼리 다시 묶어(regroup-prompts.json, Claude가 손으로 묶음) 생각 보통·표시 없이 써 봐요.
    #   주제 묶음 3(요리)은 묶음 10과 단어가 같아서 빼요 (9편, 8천 Neuron쯤)
    V=$(curl -s "${WG_STORY%/}/" | sed -n 's/.*"v":\([0-9]*\).*/\1/p')
    [ "${V:-0}" -ge 7 ] || { echo "서버가 7판이 아니에요 (지금 ${V:-?}판)"; exit 2; }
    # 11-05 오전 9시(붐빔)에는 9편 가운데 8편이 생각 중 120초에서 끊겼어요 → 서버 8판이면 끊긴 생각을 메모로 보내 다시 써요(--rescue)
    R=""; [ "${V:-0}" -ge 8 ] && R="--rescue"
    run ${NAME:-way3-nem-med-plain-regroup} --model=$N --effort=medium --format=plain --stream $R --fix=${FIX:-0} --tries=1 --regroup --sets=${SETS:-1,2,4,5,6,7,8,9,10} ;;
  ways4) # 쉬운 이야기 (2026-11-07~): 사용자가 고름 — 생각 보통 12편 가운데 좋아 2편(요리·사고와 구조)은 둘 다
    # 한 인물이 한 가지 일을 차례로 겪는 단순한 이야기였어요 → 서버 10판 style simple.
    # 견주기 2에서 '별로'였던 묶음 2·4·6·8(같은 단어로 나아졌는지)과 아주 추상적인 묶음 7, 생각 보통·plain·흘려 받기·생각 메모로 다시 쓰기
    V=$(curl -s "${WG_STORY%/}/" | sed -n 's/.*"v":\([0-9]*\).*/\1/p')
    [ "${V:-0}" -ge 10 ] || { echo "서버가 10판이 아니에요 (지금 ${V:-?}판) → 대시보드에 10판 worker.mjs를 붙여 넣어야 해요"; exit 2; }
    run ${NAME:-way4-nem-med-plain-simple} --model=$N --effort=medium --format=plain --stream --rescue --style=simple --fix=${FIX:-0} --tries=1 --sets=${SETS:-2,4,6,8,7} ;;
  group) # 묶음 짜기 (2026-11-07~, 서버 11판 /group). 사용자: "뉴런은 단어들을 한 장면에 어울리는 묶음으로 모으는 것에 집중, 보여 주는 이야기는 2개뿐이어도 좋아"
    # 단어장 A = 시험 묶음 1~5 (30개), B = 6~10 (31개). 묶기 + 다시 따지기(생각 보통, 흘려 받기, 끊기면 메모로) + 첫 묶음으로 이야기 1편씩
    V=$(curl -s "${WG_STORY%/}/" | sed -n 's/.*"v":\([0-9]*\).*/\1/p')
    [ "${V:-0}" -ge 11 ] || { echo "서버가 11판이 아니에요 (지금 ${V:-?}판) → 대시보드에 11판 worker.mjs를 붙여 넣어야 해요"; exit 2; }
    g() { name=$1; shift; node tools/finetune/v3/eval-group.cjs "$name" "$@" > /dev/null 2>&1; tail -1 "tools/story-lab/grp-$name.txt"; if grep -q "하루 무료 한도" "tools/story-lab/grp-$name.txt"; then echo "STOP: 하루 무료 한도"; exit 0; fi; }
    g ${NAME:-group}-a --sets=1,2,3,4,5 --effort=medium --review --stories=1
    g ${NAME:-group}-b --sets=6,7,8,9,10 --effort=medium --review --stories=1 ;;
  final) # 본선: 사용자가 고른 길로 30편 (+ 주제 묶음 30편, 하루 한도를 보며 나눠서)
    [ -z "$WAY" ] && { echo 'WAY="--model=... --plan" 처럼 길을 주세요'; exit 2; }
    run final $WAY --format=json --fix=2 --tries=3
    run final-regroup $WAY --format=json --fix=2 --tries=3 --regroup ;;
  *) echo "차례: prelim · ways · ways2 · ways3 · ways4 · group · final"; exit 2 ;;
esac
echo DONE
