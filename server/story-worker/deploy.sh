#!/usr/bin/env bash
# 이야기 서버(worker.mjs)를 Cloudflare에 바로 올려요 (대시보드에 붙여 넣지 않고). 2026-11-17 사용자가 API 토큰을 만들어 줬어요.
# - 토큰: 클라우드 세션에서는 네트워크 프록시가 api.cloudflare.com 요청에 넣어 줘요 (값은 어디에도 적지 않아요).
#   다른 곳에서는 CF_API_TOKEN 환경 변수로 줘요. 저장소에 적지 않아요.
# - 계정 id는 그때그때 API로 알아내고 화면·파일에 적지 않아요. 서버 열쇠(WG_TOKEN)와 AI 연결은 그대로 둬요 (keep_bindings).
# 쓰기: bash server/story-worker/deploy.sh   → 끝에 올린 판 번호(GET /의 v)를 보여 줘요 (WG_STORY=<서버 주소>가 있으면)
set -euo pipefail
cd "$(dirname "$0")"
NAME=${WORKER_NAME:-wg-story}
API=https://api.cloudflare.com/client/v4
AUTH="Authorization: Bearer ${CF_API_TOKEN:-proxy-injected}"
ACC=$(curl -sS --max-time 30 -H "$AUTH" "$API/accounts" | python3 -c "import sys,json;r=json.load(sys.stdin).get('result') or [];print(r[0]['id'] if len(r)==1 else '')")
[ -n "$ACC" ] || { echo "계정을 찾지 못했어요 (토큰을 확인해 주세요)"; exit 1; }
COMPAT=$(curl -sS --max-time 30 -H "$AUTH" "$API/accounts/$ACC/workers/scripts/$NAME/settings" | python3 -c "import sys,json;print((json.load(sys.stdin).get('result') or {}).get('compatibility_date') or '2026-10-31')")
META=$(python3 -c "import json,sys;print(json.dumps({'main_module':'worker.mjs','compatibility_date':sys.argv[1],'bindings':[{'type':'ai','name':'AI'}],'keep_bindings':['secret_text'],'observability':{'enabled':True,'head_sampling_rate':1}}))" "$COMPAT")
curl -sS --max-time 60 -X PUT -H "$AUTH" "$API/accounts/$ACC/workers/scripts/$NAME" \
  -F "metadata=$META;type=application/json" \
  -F "worker.mjs=@worker.mjs;type=application/javascript+module" \
  | python3 -c "import sys,json;j=json.load(sys.stdin);r=j.get('result') or {};print('올림:', j.get('success'), r.get('modified_on',''), j.get('errors') or '')"
if [ -n "${WG_STORY:-}" ]; then sleep 3; echo "지금 서버: $(curl -sS --max-time 20 "${WG_STORY%/}/")"; fi
