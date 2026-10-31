#!/bin/bash
# 이야기 서버 재기 차례 (2026-10-31~). 열쇠·주소는 환경 변수로만 (저장소에 넣지 않아요):
#   WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> bash tools/finetune/v3/server-rounds.sh <차례>
# 차례: prelim(예선) · ways(길 견주기) · final(본선, 길은 WAY로: 예 WAY="--model=@cf/google/gemma-4-26b-a4b-it --plan")
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
  final) # 본선: 사용자가 고른 길로 30편 (+ 주제 묶음 30편, 하루 한도를 보며 나눠서)
    [ -z "$WAY" ] && { echo 'WAY="--model=... --plan" 처럼 길을 주세요'; exit 2; }
    run final $WAY --format=json --fix=2 --tries=3
    run final-regroup $WAY --format=json --fix=2 --tries=3 --regroup ;;
  *) echo "차례: prelim · ways · final"; exit 2 ;;
esac
echo DONE
