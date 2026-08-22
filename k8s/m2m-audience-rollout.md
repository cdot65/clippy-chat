# Arming the `clippy-api` audience gate

Tracking: Task 14 (audience-mapper design), closing the "`aud` intentionally unchecked" gap in
`src/lib/auth/bearer.ts`.

This is an operator-run, two-part change: a **Keycloak** change and then a **manifest** change,
in that order. Review commands first; run them from the repository root in one Bash shell. Never
paste a client secret or an encoded token into argv, a file, or an artifact.

## What the code does now

`verifyBearer` enforces `aud` **only** when `M2M_AUDIENCE` is set:

| `M2M_AUDIENCE` | `jwtVerify` options | Effect |
| --- | --- | --- |
| unset (current prod) | `requiredClaims: ['sub','scope']` | audience unchecked; one `console.warn` per process |
| set | `audience: <value>`, `requiredClaims: ['sub','scope','aud']` | token must carry the audience; missing `aud` is a 401 |

The gate is off by default so the realm and the app can change in either order. Arming it against a
value the caller does not carry 401s **every** machine caller, including the red-team adapter, and
there is no "warn on mismatch" mode.

## What the realm actually emits

Measured 2026-08-22, not assumed — earlier revisions of this runbook wrongly claimed Keycloak mints
no useful `aud` at all:

| Client | Scope | `aud` today | Shape |
| --- | --- | --- | --- |
| `clippy-m2m` (chat API) | `clippy-api` | `stack-clippy` | bare string |
| `clippy-mcp-client` (MCP) | `mcp.invoke` | `clippy`, `stack-clippy` | array |

`truffles` issues a **per-stack** audience (`stack-clippy`) and, for MCP, a **per-service** one
(`clippy`). So the chat API path already has an audience — it just doesn't have a per-service one.

## Choosing the value

| Option | Value | Keycloak work | Strength |
| --- | --- | --- | --- |
| A | `stack-clippy` | none — enforces today | Rejects any realm token outside the Clippy stack |
| B | `clippy-api` | one audience mapper on `clippy-m2m` | Also rejects other Clippy-stack tokens; `aud` and `scope` fail independently |

**B is recommended**: it completes the per-service pattern `clippy-mcp-client` already follows. Under
A, an MCP token clears the audience check (it also carries `stack-clippy`) and is stopped only by the
scope gate — one lock instead of two.

## 1. Confirm the caller set

Only `clippy-m2m` has ever authenticated to `/api/chat` — every `is_service_account` row in the app
database is that client. That proves who *has* called, not who *could*, so still enumerate clients
that can obtain the `clippy-api` scope before arming.

```bash
kubectl -n clippy exec clippy-postgres-0 -- sh -c \
  'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" \
   -c "select username, keycloak_sub, updated_at::date from user_profiles where is_service_account"'
```

```bash
set -euo pipefail
umask 077

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"
artifact_dir="$(dirname "${repo_root}")/clippy-m2m-audience-${run_id}"
test ! -e "${artifact_dir}"
mkdir -m 0700 "${artifact_dir}"

kubectl config current-context > "${artifact_dir}/kube-context"
kubectl -n clippy get deployment clippy-chat -o json > "${artifact_dir}/app.before.json"
jq -e '[.spec.template.spec.containers[]
  | select(.name == "app")
  | .env[]
  | select(.name == "M2M_AUDIENCE")] | length == 0' "${artifact_dir}/app.before.json"
```

Then, in the `truffles` realm, list every enabled client whose service account can obtain the
`clippy-api` scope, and record the client IDs (not secrets) in `${artifact_dir}/callers.txt`. The
red-team adapter (`redteam/clippy_redteam_adapter.py`) is one of them; treat any other service
account hitting `/api/chat` as in scope.

## 2. Add the audience mapper, then prove the claim is live

**Option A skips this step** — `stack-clippy` is already minted. Go straight to step 3.

For option B: on each client from step 1, add an `oidc-audience-mapper` to its *dedicated* client
scope — included custom audience `clippy-api`, add-to-access-token on, ID token and userinfo off
(this is `client_credentials`). The result should be `aud: ["clippy-api", "stack-clippy"]`, matching
the shape `clippy-mcp-client` already has.

This is additive: the app is not checking `aud` yet, so tokens minted before and after are both
accepted. Nothing breaks here — which is the point of doing it first.

The credentials for the probe below are in the cluster already, so no secret needs to be handled by
hand:

```bash
cid=$(kubectl -n keycloak get secret kc-client-clippy-m2m -o jsonpath='{.data.client-id}' | base64 -d)
csec=$(kubectl -n keycloak get secret kc-client-clippy-m2m -o jsonpath='{.data.client-secret}' | base64 -d)
```

Prove it, without ever printing the token. The form body goes over stdin, and only selected claims
reach the artifact directory — no encoded JWT, matching the safe-logging rules in
`docs-site/docs/security/operations.mdx`.

```bash
# `aud` lives in the JWT payload segment: base64url, unpadded. Restore the
# standard alphabet and the padding before decoding.
b64url_decode() {
  local data="${1//-/+}"; data="${data//_//}"
  case $(( ${#data} % 4 )) in
    2) data="${data}==" ;;
    3) data="${data}=" ;;
  esac
  printf '%s' "${data}" | base64 -d
}

token_url="$(kubectl -n clippy get secret clippy-mcp-client \
  -o jsonpath='{.data.MCP_TOKEN_URL}' | base64 -d)"   # same realm token endpoint

# Credentials for the caller under test come from its own 1Password item. Read
# them into this shell without echoing and without putting them in argv.
read -r  -p 'client_id: '     probe_id
read -rs -p 'client_secret: ' probe_secret; echo

mint_token() {   # form body over stdin; nothing sensitive in argv
  printf 'grant_type=client_credentials&client_id=%s&client_secret=%s&scope=clippy-api' \
    "${probe_id}" "${probe_secret}" |
    curl --fail --silent --show-error "${token_url}" --data-binary @- |
    jq -r .access_token
}

probe_token="$(mint_token)"

b64url_decode "$(printf '%s' "${probe_token}" | cut -d. -f2)" |
  jq '{aud, azp, scope}' | tee "${artifact_dir}/claims-${probe_id}.json"

jq -e '(.aud | if type == "array" then . else [.] end) | index("clippy-api")' \
  "${artifact_dir}/claims-${probe_id}.json"
```

Repeat for every caller in `callers.txt`. **Do not continue until every one of them passes.**

## 3. Arm the gate

Uncomment the `M2M_AUDIENCE` block in `k8s/20-app.yaml`:

```yaml
            - name: M2M_AUDIENCE
              value: "clippy-api"
```

Open the PR against `main` on Forgejo, let CI pass, merge, and let Argo sync. Confirm the rollout
and that the process warning is gone:

```bash
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
kubectl -n clippy logs deployment/clippy-chat --since=5m |
  grep -c 'M2M_AUDIENCE unset' || true   # expect 0
```

## 4. Prove positive and negative

Same shell as step 2, so `mint_token` and the credentials are still in scope. The bearer reaches
curl through a config file on stdin rather than argv:

```bash
chat_probe() {   # $1 = bearer token; prints the HTTP status
  # `data` already implies POST; adding `request` only makes curl warn.
  printf '%s\n' \
    'url = "https://clippy.cdot.io/api/chat"' \
    "header = \"Authorization: Bearer $1\"" \
    'header = "content-type: application/json"' \
    "data = \"{\\\"conversationId\\\":\\\"$(uuidgen | tr 'A-Z' 'a-z')\\\",\\\"message\\\":\\\"audience probe\\\"}\"" \
    'output = "/dev/null"' \
    'write-out = "%{http_code}\n"' \
    'silent' |
    curl --config -
}

# positive: a mapped caller still reaches the chat API. Re-mint first — a
# step-2 token predates the rollout and may already have expired.
probe_token="$(mint_token)"
chat_probe "${probe_token}"   # expect 200

unset probe_secret probe_token
```

Negative: mint a `clippy-api` token from a client that has **no** audience mapper and repeat the
call — expect `401`, and `bearer auth failed` in the app log with a jose `aud` claim error. That
denial is the whole point of the change; capture it in the artifact directory as the evidence for
the handoff's acceptance criteria.

Also re-run the red-team adapter's smoke path end to end. A green adapter is the real acceptance
signal, since it is the highest-volume `clippy-api` caller.

## Rollback

Comment the `M2M_AUDIENCE` block back out, merge, and let Argo sync. The check is off again as
soon as the pods roll — no token, mapper, or secret changes are needed, because step 2 is additive
and safe to leave in place. Leave the mappers alone unless the realm change itself is the problem.
