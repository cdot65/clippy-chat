#!/usr/bin/env bash
# Copy live clippy namespace Secret keys into Clippy Chat 1Password items
# used by k8s/15-secrets.yaml. Creates items if missing; updates fields if present.
#
# Prerequisites: op CLI signed in (desktop app integration), kubectl context = talos.
# Does NOT print secret values.
set -euo pipefail

VAULT="Clippy Chat"
NS=clippy

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need op
need kubectl
need python3

secret_keys() {
  local name=$1
  kubectl get secret -n "$NS" "$name" -o json | python3 -c '
import json,sys
d=json.load(sys.stdin).get("data") or {}
print("\n".join(sorted(d.keys())))
'
}

secret_value() {
  local name=$1 key=$2
  kubectl get secret -n "$NS" "$name" -o jsonpath="{.data.$key}" | base64 -d
}

upsert_item() {
  local title=$1 secret=$2
  shift 2
  local -a keys=("$@")
  local -a fields=()
  local k
  for k in "${keys[@]}"; do
    fields+=("${k}[text]=$(secret_value "$secret" "$k")")
  done

  if op item get "$title" --vault "$VAULT" >/dev/null 2>&1; then
    echo "updating: $title ← secret/$secret"
    op item edit "$title" --vault "$VAULT" "${fields[@]}" >/dev/null
  else
    echo "creating: $title ← secret/$secret"
    op item create --category Secure\ Note --title "$title" --vault "$VAULT" "${fields[@]}" >/dev/null
  fi
}

echo "reading live secrets in ns/$NS …"
upsert_item "Talos - Clippy Postgres" clippy-postgres \
  POSTGRES_USER POSTGRES_DB POSTGRES_PASSWORD

upsert_item "Talos - Clippy App" clippy-app \
  DATABASE_URL KC_CLIENT_SECRET SESSION_SECRET ADMIN_USERNAME ADMIN_PASSWORD VLLM_API_KEY

upsert_item "Talos - Clippy MCP" clippy-mcp-secrets \
  BRAVE_API_KEY SCM_CLIENT_ID SCM_CLIENT_SECRET SCM_TSG_ID

echo "done. Ensure operator watchNamespace includes 'clippy', then apply/sync OnePasswordItems."
