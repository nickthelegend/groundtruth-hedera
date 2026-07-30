#!/usr/bin/env bash
# smoke-e2e.sh — Smoke test the live GroundTruth deployment
# Usage: GROUNDTRUTH_URL=https://your-app.vercel.app bash scripts/smoke-e2e.sh

set -euo pipefail

BASE="${GROUNDTRUTH_URL:-http://localhost:3000}"
PASS=0
FAIL=0

green() { echo -e "\033[32m✓ $1\033[0m"; }
red()   { echo -e "\033[31m✗ $1\033[0m"; }

check() {
  local label="$1"
  local condition="$2"
  if eval "$condition"; then
    green "$label"
    ((PASS++)) || true
  else
    red "$label"
    ((FAIL++)) || true
  fi
}

echo "🔍 Smoke testing $BASE"
echo ""

# 1. Home page returns 200
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
check "Home page returns 200" '[ "$STATUS" = "200" ]'

# 2. POST /api/v1/human-do without payment returns 402
RESP=$(curl -s -o /tmp/gt_402.json -w "%{http_code}" -X POST "$BASE/api/v1/human-do" \
  -H "Content-Type: application/json" \
  -d '{"intent":"test","budget_usdt":"2.00"}')
check "human-do without payment returns 402" '[ "$RESP" = "402" ]'

# 3. 402 response contains x402Version
check "402 response has x402Version field" 'grep -q "x402Version" /tmp/gt_402.json'

# 4. MCP endpoint responds to tools/list
MCP_RESP=$(curl -s -X POST "$BASE/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
check "MCP tools/list returns ground_truth_info" 'echo "$MCP_RESP" | grep -q "ground_truth_info"'
check "MCP tools/list returns human_do" 'echo "$MCP_RESP" | grep -q "human_do"'
check "MCP tools/list returns task_status" 'echo "$MCP_RESP" | grep -q "task_status"'

# 5. Tasks feed returns JSON array
TASKS_RESP=$(curl -s "$BASE/api/tasks")
check "Tasks feed returns JSON array" 'echo "$TASKS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d, list)" 2>/dev/null'

# 6. Pulse endpoint returns stats shape
PULSE_RESP=$(curl -s "$BASE/api/pulse")
check "Pulse returns total_tasks field" 'echo "$PULSE_RESP" | grep -q "total_tasks"'
check "Pulse returns verified_tasks field" 'echo "$PULSE_RESP" | grep -q "verified_tasks"'

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
