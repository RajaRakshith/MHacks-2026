#!/usr/bin/env bash
# Deposit money into the demo Nessie account.
# Usage: ./scripts/topup.sh AMOUNT "CAPTION"
#    or: pnpm topup -- 2000 "Payroll"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AMOUNT="${1:-}"
CAPTION="${2:-}"

if [[ ! "$AMOUNT" =~ ^[1-9][0-9]*$ ]] || [[ -z "$CAPTION" ]]; then
  echo "Usage: $0 AMOUNT \"CAPTION\"" >&2
  echo "Example: $0 2000 \"Payroll\"" >&2
  exit 1
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env" >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*([A-Z0-9_]+)=(.*)$ ]] || continue
  key="${BASH_REMATCH[1]}"
  val="${BASH_REMATCH[2]}"
  val="${val%$'\r'}"
  if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
  if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
  case "$key" in
    NESSIE_API_KEY|NESSIE_ACCOUNT_ID|NESSIE_BASE_URL) printf -v "$key" '%s' "$val" ;;
  esac
done < "$ROOT/.env"

: "${NESSIE_API_KEY:?NESSIE_API_KEY is not set in .env}"
: "${NESSIE_ACCOUNT_ID:?NESSIE_ACCOUNT_ID is not set in .env}"
NESSIE_BASE_URL="${NESSIE_BASE_URL:-https://prod-api.nessieisreal.com}"
NESSIE_BASE_URL="${NESSIE_BASE_URL%/}"

DATE="$(date +%Y-%m-%d)"
BODY="$(printf '{"medium":"balance","status":"completed","transaction_date":"%s","amount":%s,"description":%s}' \
  "$DATE" "$AMOUNT" "$(printf '%s' "$CAPTION" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

STATUS="$(curl -sS -o "$TMP" -w '%{http_code}' \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  --data "$BODY" \
  "${NESSIE_BASE_URL}/accounts/${NESSIE_ACCOUNT_ID}/deposits?key=${NESSIE_API_KEY}")"

if [[ "$STATUS" != "201" && "$STATUS" != "200" ]]; then
  echo "Nessie deposit failed (${STATUS})" >&2
  python3 -c 'import sys; print(sys.stdin.read()[:300])' < "$TMP" >&2
  exit 1
fi

echo "Deposited \$${AMOUNT} — ${CAPTION}"

REFRESH_URL="${WORKER_REFRESH_URL:-http://127.0.0.1:8788/refresh}"
if curl -sS -m 4 -o /dev/null -w '%{http_code}' -X POST "$REFRESH_URL" | grep -Eq '^(204|200)$'; then
  echo "Dashboard snapshot updated. Reload the app if it does not move right away."
else
  echo "Could not reach the worker at ${REFRESH_URL}." >&2
  echo "Start it with pnpm worker:dev (or pnpm dev), then run this again or wait ~15s." >&2
  exit 2
fi
