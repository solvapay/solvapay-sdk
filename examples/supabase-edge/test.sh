#!/usr/bin/env bash
# Smoke-test the deployed supabase-edge functions.
set -euo pipefail

[ -f .env ] && { set -a; source .env; set +a; }

PROJECT_REF=$(jq -r '.ref' supabase/.temp/linked-project.json)
BASE_URL="https://${PROJECT_REF}.supabase.co/functions/v1"
PRODUCT_REF="${SOLVAPAY_PRODUCT_REF:?SOLVAPAY_PRODUCT_REF not set in .env}"

# Supabase anon key — needed to pass the edge runtime's JWT gate.
# Set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env (same name as checkout-demo).
SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:?NEXT_PUBLIC_SUPABASE_ANON_KEY not set in .env}"

ok=0; fail=0

check() {
  local name="$1" url="$2"
  local status
  status=$(curl -s -o /tmp/sp_resp.json -w "%{http_code}" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" "$url" 2>/dev/null || echo "000")
  if [ "$status" = "200" ]; then
    echo "✓  $name"
    ok=$((ok+1))
  else
    echo "✗  $name  [HTTP $status]"
    echo "   $(cat /tmp/sp_resp.json | tr -d '\n' | cut -c1-120)"
    fail=$((fail+1))
  fi
}

echo "Project : $PROJECT_REF"
echo "Product : $PRODUCT_REF"
echo "Base URL: $BASE_URL"
echo

check "get-product" "${BASE_URL}/get-product?productRef=${PRODUCT_REF}"
check "list-plans"  "${BASE_URL}/list-plans?productRef=${PRODUCT_REF}"

echo
echo "${ok} passed, ${fail} failed"
[ "$fail" -eq 0 ]
