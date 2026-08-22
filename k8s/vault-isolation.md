# Clippy secret vault isolation

Clippy Chat and AI Security Academy are **separate stacks** — ships in the night. They coexist under
the one `truffles` Keycloak realm, distinguished by the `stack-clippy` audience, but nothing for
Clippy belongs in an Academy vault, namespace, or Keycloak stack.

This file replaces `mcp-client-secret-migration.md`, which implemented the opposite policy.

## Ownership

| Secret | Vault | Item |
| --- | --- | --- |
| `clippy-postgres` | **Clippy Chat** | `Talos - Clippy Postgres` |
| `clippy-app` | **Clippy Chat** | `Talos - Clippy App` |
| `clippy-mcp-secrets` | **Clippy Chat** | `Talos - Clippy MCP` |
| `clippy-mcp-client` | **Truffles** (realm-scoped, not Academy) | `Truffles - Keycloak clippy-mcp-client` |
| `clippy-inference-client` | **Truffles** (realm-scoped, not Academy) | `Truffles - Keycloak clippy-inference-client` |

Clippy Chat vault UUID: `gphlxcldfinqyzo6jn7sa674sa`.

## What Forgejo #22 got wrong

[#22](https://git.cdot.io/cdot.io/clippy-chat/issues/22) tracked moving `clippy-mcp-client` *into*
**AI Security Academy - Runtime**, and the handoff carried it as the last open approval blocker. It
required exactly the cross-stack coupling this boundary forbids, so it is **closed as invalid**.

The real drift ran the other way: `clippy-postgres`, `clippy-app`, and `clippy-mcp-secrets` — the
database credentials, session secret, admin password, and MCP tool API keys — were sourced from the
shared **AI Security Academy** vault. Nothing tracked that. Corrected 2026-08-22.

## The trap: `itemPath` is not a one-line edit

`clippy-app` is consumed with `envFrom: secretRef`, and the `clippy-mcp-client` `secretKeyRef`s are
non-optional by design so MCP fails loudly rather than degrading. If the Connect server cannot
resolve a vault, the Secret never materialises and **every `clippy-chat` pod enters
`CreateContainerConfigError` on its next roll — taking `clippy-postgres` with it.** The whole app,
not just the component whose secret moved.

## Procedure for moving a secret to a new vault

### 1. Grant the Connect server access to the target vault

The operator runs in Connect mode. `OP_CONNECT_TOKEN` is a JWT whose `1password.com/vts` claim is a
vault allowlist; it cannot be edited, only reissued. 1Password *service accounts* (`ops_…`) are a
separate mechanism and grant the operator nothing.

Grant the Connect server integration access to the vault, issue a new token covering every required
vault, update `onepassword-token` durably through `talos-cluster/onepassword` (a hand-patched Secret
is reverted on the next Argo sync), then restart both deployments so `connect-sync` pulls it.

Verify against the **running server**, not the decoded token — effective access is
token scope ∩ server vault access:

```bash
kubectl -n onepassword-system port-forward deploy/onepassword-connect 18080:8080 &
TOKEN=$(kubectl -n onepassword-system get secret onepassword-token -o jsonpath='{.data.token}' | base64 -d)
curl -s -H "Authorization: Bearer ${TOKEN}" http://127.0.0.1:18080/v1/vaults | jq -r '.[].name'
```

Grant **read-only** access unless something genuinely writes. The operator only reads.

### 2. Copy the items, digest-verified

Read from the source account and write to the target through a stdin JSON template, so values reach
neither argv nor disk. Compare per-field `sha256` digests on both sides — digests of a secret are
safe to record, values are not.

### 3. Canary the full operator path

Vault access proven at the Connect API is not the same as the operator writing a Secret. Test the
whole chain with a throwaway item before moving anything load-bearing:

```bash
kubectl -n clippy apply -f - <<'YAML'
apiVersion: onepassword.com/v1
kind: OnePasswordItem
metadata: { name: clippy-chat-canary, namespace: clippy }
spec: { itemPath: "vaults/Clippy Chat/items/Canary - Connect Access" }
YAML
kubectl -n clippy get secret clippy-chat-canary -o jsonpath='{.data.CANARY}' | base64 -d
kubectl -n clippy delete onepassworditem clippy-chat-canary
kubectl -n clippy delete secret clippy-chat-canary --ignore-not-found
```

### 4. Flip `itemPath`, then verify reconciliation

Merge the `k8s/15-secrets.yaml` change, let Argo sync, then confirm every Secret still carries its
expected keys and that field digests are unchanged from step 2. Only then remove the originals from
the old vault.

**Migration and rotation belong in different windows.** Move with identical values first; change
values later. Combined, a denial is ambiguous between "wrong vault" and "wrong credential".

## Rollback

Revert the `itemPath` commit and let Argo sync — the old vault still holds the items until step 4's
cleanup. After the originals are deleted, rollback means restoring from 1Password item history, not
reverting a commit.
