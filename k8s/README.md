# Kubernetes manifests (Talos / Argo CD)

Raw manifests for the `clippy` namespace. Reconciled by the Argo CD Application
`clippy-chat` in [`cdot65/talos-cluster`](https://github.com/cdot65/talos-cluster)
(`gitops/apps/clippy-chat.yaml`), sourced from `git.cdot.io/cdot.io/clippy-chat`
(GitHub push-mirror at `cdot65/clippy-chat`).

| File | Contents |
|------|----------|
| `00-namespace.yaml` | `clippy` namespace |
| `10-postgres.yaml` | Postgres StatefulSet + Service |
| `11-postgres-longhorn-pvc.yaml` | 10Gi Longhorn PostgreSQL claim |
| `15-secrets.yaml` | OnePasswordItem → application, MCP, and MCP OAuth client Secrets |
| `20-app.yaml` | App Deployment + Service |
| `30-middleware.yaml` | Traefik rate-limit + HTTPS redirect |
| `40-certificate.yaml` | cert-manager Certificate (`clippy.cdot.io`) |
| `50-ingressroute.yaml` | Traefik IngressRoutes |
| `60-mcp.yaml` | MCP Deployment + ClusterIP Service (no Ingress) |

## Secrets

Vaults: **AI Security Academy** and scoped **Truffles** client credentials. Both
are reachable by the Connect operator. Field labels must match Secret keys 1:1:

| 1P item | Secret | Required fields |
|---------|--------|-----------------|
| `Talos - Clippy Postgres` | `clippy-postgres` | `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` |
| `Talos - Clippy App` | `clippy-app` | `DATABASE_URL`, `KC_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VLLM_API_KEY` |
| `Talos - Clippy MCP` | `clippy-mcp-secrets` | `BRAVE_API_KEY`, `SCM_CLIENT_ID`, `SCM_CLIENT_SECRET`, `SCM_TSG_ID` |
| `Truffles - Keycloak clippy-mcp-client` | `clippy-mcp-client` | `MCP_TOKEN_URL`, `MCP_CLIENT_ID`, `MCP_CLIENT_SECRET` |

Bootstrap / refresh from the live namespace (preserves current values):

```bash
./scripts/sync-clippy-secrets-to-1password.sh
```

Still out-of-band (not in this directory):

- `harbor-pull-secret` — `kubernetes.io/dockerconfigjson` for `registry.cdot.io` (robot
  `robot$clippy+pull`), applied via `talos-cluster/clippy-chat/create-harbor-pull-secret.sh`
- `clippy-tls` — owned by cert-manager

## PostgreSQL storage migration

Issue [`#11`](https://github.com/cdot65/clippy-chat/issues/11) tracks moving PostgreSQL from
the talos1-local `clippy-postgres-data-clippy-postgres-0` claim to Longhorn. The migration is
split into separately reviewed changes:

1. Stage the empty `clippy-postgres-data-longhorn` target. It is intentionally unconsumed;
   PostgreSQL remains on the `local-path` volume claim template.
2. Switch the immutable StatefulSet storage shape only after Argo is paused, the application
   writers are stopped, and a PostgreSQL-native backup has been restored and validated.

See [`postgres-storage-migration.md`](postgres-storage-migration.md). The desired Stage 2 manifest
uses the explicit Longhorn claim and exact bare-metal affinity. It cannot update the live
StatefulSet in place: do not merge or apply it outside the authorized runbook window.

Add `clippy` to the Connect operator `watchNamespace` list in
`talos-cluster/onepassword/values.yaml` (merge into live helm values before
upgrade — see that file's header).

## Images

| Workload | Image |
|----------|-------|
| clippy-chat (+ migrate init) | `registry.cdot.io/clippy/clippy-chat:sha-fe3b2a2…@sha256:3b9104b…` |
| clippy-mcp | `registry.cdot.io/clippy/clippy-mcp:sha-fe3b2a2…@sha256:4b57c11…` |

## Do not hand-apply on Talos

Prefer Argo sync. For a one-off local dry-run against a kube context:

```bash
kubectl diff -f k8s/
```
