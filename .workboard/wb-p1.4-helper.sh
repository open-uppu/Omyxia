#!/bin/bash
# Workboard RPC helper for omyxia v2.0.0 P1.4 (GET /api/admin/tenants)
set -euo pipefail

CARD_ID="30b59dce-3cc3-4f3c-ad77-623580dfadd5"
# Token is rotated on every re-dispatch; the helper accepts an override.
# The default below is the latest claim token observed at run time.
TOKEN="${TOKEN:-${WB_P14_TOKEN:-fb0280c2-8406-48df-a8cf-9dc4697d52c1}}"
GATEWAY="http://127.0.0.1:18789"
AUTH_TOKEN="8f5708e73dc677c1b357122e21eb8042e556c79efa2d66cd"

call_tool() {
  local name="$1"
  local args_json="$2"
  curl -s -m 15 -X POST "$GATEWAY/tools/invoke" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $AUTH_TOKEN" \
    -d "{\"name\":\"$name\",\"args\":$args_json}" | head -c 4000
  echo
}

jq_str() {
  python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'
}

case "${1:-}" in
  hb|heartbeat)
    shift
    note="${1:-heartbeat}"
    call_tool "workboard_heartbeat" "{\"id\":\"$CARD_ID\",\"token\":\"$TOKEN\",\"note\":$(printf '%s' "$note" | jq_str)}"
    ;;
  complete)
    shift
    summary="${1:-completed}"
    proof="${2:-proof}"
    call_tool "workboard_complete" "{\"id\":\"$CARD_ID\",\"token\":\"$TOKEN\",\"summary\":$(printf '%s' "$summary" | jq_str),\"proof\":$(printf '%s' "$proof" | jq_str)}"
    ;;
  block)
    shift
    reason="${1:-blocked}"
    call_tool "workboard_block" "{\"id\":\"$CARD_ID\",\"token\":\"$TOKEN\",\"reason\":$(printf '%s' "$reason" | jq_str)}"
    ;;
  *)
    echo "Usage: $0 {heartbeat|complete|block} <...>" >&2
    exit 2
    ;;
esac