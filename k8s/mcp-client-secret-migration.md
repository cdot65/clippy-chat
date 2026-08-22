# `clippy-mcp-client` — Truffles to AI Security Academy - Runtime

Tracking: [clippy-chat#22](https://git.cdot.io/cdot.io/clippy-chat/issues/22). This is the last
open item on the [AI Gateway MCP security handoff](../docs-site/docs/security/overview.mdx)
acceptance list. Request authorization is already production-proven; only the **source of the
secret** is out of policy.

This is an operator-run cutover with a **hard failure mode** — read the next section before
running anything. Never paste a client secret into argv, a manifest, an artifact, or a ticket.

## Why this cannot be a one-line `itemPath` edit

`k8s/20-app.yaml` consumes `clippy-mcp-client` through three **non-optional** `secretKeyRef`s
(`MCP_TOKEN_URL`, `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET`). Unlike the inference client, they carry no
`optional: true`, deliberately: MCP must fail loudly, not degrade. So if the new `itemPath` does not
reconcile — wrong vault name, item not created yet, Connect operator token without access to the
Runtime vault — the Secret disappears and every `clippy-chat` pod enters
`CreateContainerConfigError` on its next roll. The whole app goes down, not just MCP.

Step 1 exists to prove reconciliation *before* anything load-bearing points at the new vault.

## Ownership contract

| | Current (deployed) | Approved end state |
| --- | --- | --- |
| 1P item | `vaults/Truffles/items/Truffles - Keycloak clippy-mcp-client` | `vaults/AI Security Academy - Runtime/items/Talos - Keycloak clippy-mcp-client` |
| Secret | `clippy-mcp-client` (unchanged) | `clippy-mcp-client` (unchanged) |
| Fields | `MCP_TOKEN_URL`, `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET` | identical, 1:1 with Secret keys |

**Migration is not rotation.** Move ownership with the *current* values first, prove the whole E2E
matrix, and only then rotate inside the Runtime item using the existing rotation procedure in
`docs-site/docs/security/operations.mdx`. Doing both at once merges two failure domains and makes a
denial ambiguous — vault access or bad credential?

## 1. Prove the Connect operator can read the Runtime vault

Do this with a throwaway item, not with the real credential.

```bash
set -euo pipefail
umask 077

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"
artifact_dir="$(dirname "${repo_root}")/clippy-mcp-secret-${run_id}"
test ! -e "${artifact_dir}"
mkdir -m 0700 "${artifact_dir}"

kubectl config current-context > "${artifact_dir}/kube-context"
kubectl -n clippy get secret clippy-mcp-client -o json > "${artifact_dir}/secret.before.json"
jq -e '[.data | keys[]] | sort ==
  ["MCP_CLIENT_ID","MCP_CLIENT_SECRET","MCP_TOKEN_URL"]' "${artifact_dir}/secret.before.json"
```

Create an item named `Canary - Connect Access` in **AI Security Academy - Runtime** with one field
`CANARY=ok`, then:

```bash
kubectl -n clippy apply -f - <<'YAML'
apiVersion: onepassword.com/v1
kind: OnePasswordItem
metadata:
  name: clippy-runtime-canary
  namespace: clippy
spec:
  itemPath: vaults/AI Security Academy - Runtime/items/Canary - Connect Access
YAML

# expect the Secret to appear within the operator's poll interval
for _ in $(seq 1 24); do
  kubectl -n clippy get secret clippy-runtime-canary >/dev/null 2>&1 && break
  sleep 5
done
kubectl -n clippy get secret clippy-runtime-canary -o jsonpath='{.data.CANARY}' | base64 -d

kubectl -n clippy delete onepassworditem clippy-runtime-canary
kubectl -n clippy delete secret clippy-runtime-canary --ignore-not-found
```

If the canary Secret never appears, **stop**. The operator's Connect token does not have the
Runtime vault in scope; fix that in `talos-cluster/onepassword/` first. Nothing below is safe until
this step passes, and delete the canary item from 1Password once it has.

## 2. Create the real item with the current values

Populate `Talos - Keycloak clippy-mcp-client` in **AI Security Academy - Runtime** with the three
fields, labels matching the Secret keys exactly. Source the values from the Truffles item or from
the live Secret — never from a log, a screenshot, or this repository.

Reading the live values back to confirm parity is a legitimate step, but the output is the
credential itself: pipe it to a length/fingerprint check rather than to a terminal.

```bash
for key in MCP_TOKEN_URL MCP_CLIENT_ID MCP_CLIENT_SECRET; do
  printf '%s sha256=%s\n' "${key}" \
    "$(kubectl -n clippy get secret clippy-mcp-client -o jsonpath="{.data.${key}}" |
       base64 -d | sha256sum | cut -c1-16)"
done | tee "${artifact_dir}/fields.before.txt"
```

After the migration, the same three digests must come back identical. Digests of a secret are safe
to keep in the artifact directory; the values are not.

## 3. Flip the itemPath

In `k8s/15-secrets.yaml`, change the `clippy-mcp-client` OnePasswordItem:

```yaml
  itemPath: vaults/AI Security Academy - Runtime/items/Talos - Keycloak clippy-mcp-client
```

**In the same commit**, update `mcp-server/tests/test_manifest.py` —
`test_chat_uses_secret_backed_mcp_client_credentials` asserts the literal string
`vaults/Truffles/items/Truffles - Keycloak clippy-mcp-client`, so the flip fails CI without it.
That job gates `build-and-push`, so leaving it stale stops *all* image publishing while the other
checks stay green.

Open the PR on Forgejo against `main`, let CI pass, merge, and let Argo sync. Then confirm the
Secret was re-reconciled from the new source with byte-identical values:

```bash
kubectl -n clippy get onepassworditem clippy-mcp-client -o jsonpath='{.spec.itemPath}{"\n"}'
kubectl -n clippy get secret clippy-mcp-client -o json > "${artifact_dir}/secret.after.json"
jq -e '[.data | keys[]] | sort ==
  ["MCP_CLIENT_ID","MCP_CLIENT_SECRET","MCP_TOKEN_URL"]' "${artifact_dir}/secret.after.json"

for key in MCP_TOKEN_URL MCP_CLIENT_ID MCP_CLIENT_SECRET; do
  printf '%s sha256=%s\n' "${key}" \
    "$(kubectl -n clippy get secret clippy-mcp-client -o jsonpath="{.data.${key}}" |
       base64 -d | sha256sum | cut -c1-16)"
done | tee "${artifact_dir}/fields.after.txt"

diff -u "${artifact_dir}/fields.before.txt" "${artifact_dir}/fields.after.txt"
```

## 4. Prove the credential still works end to end

A projected Secret is not proof; the token endpoint and both MCP paths are.

```bash
kubectl -n clippy rollout restart deployment/clippy-chat
kubectl -n clippy rollout status deployment/clippy-chat --timeout=300s
kubectl -n clippy get deployment clippy-chat -o jsonpath='{.status.readyReplicas}{"\n"}'  # 2

kubectl -n clippy logs deployment/clippy-chat --since=5m |
  grep -E 'MCP token request failed|invalid MCP token response' && exit 1 || true
```

Then run the full positive/negative matrix from
`docs-site/docs/security/e2e-testing.mdx` — AIRS `initialize`, `tools/list` with exact tool-name
parity, the safe `get_current_datetime` call, the direct in-cluster path, and every cross-stack
denial. Record the results as new evidence dated to the cutover; the handoff's acceptance criteria
require the matrix to be repeated after the secret boundary changes, not merely after it works
once.

## 5. Retire the old source, then rotate

1. Confirm the E2E matrix passed and evidence is filed.
2. Remove `Truffles - Keycloak clippy-mcp-client` from the Truffles vault (or restrict it to
   break-glass), so there is exactly one source of truth.
3. Rotate the client secret **in the Runtime item only**, following the credential-rotation
   procedure in `docs-site/docs/security/operations.mdx`. Already-issued JWTs stay valid until
   expiry — account for the 3600s lifetime and the AIRS validation cache.
4. Update the drift warnings: `k8s/README.md`, `docs-site/docs/security/operations.mdx`, and the
   handoff acceptance checkbox. Close Forgejo #22.

## Rollback

Revert the step-3 commit and let Argo sync; the OnePasswordItem points back at the Truffles item
and the Secret re-reconciles with the same values. This is clean **only while step 5 has not run** —
once the Truffles item is deleted or the secret is rotated, rollback means restoring the item from
1Password history, not reverting a commit. Do not start step 5 in the same maintenance window as
step 3.
