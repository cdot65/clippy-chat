# Kubernetes manifests (Talos / Argo CD)

Raw manifests for the `clippy` namespace. Reconciled by the Argo CD Application
`clippy-chat` in [`cdot65/talos-cluster`](https://github.com/cdot65/talos-cluster)
(`gitops/apps/clippy-chat.yaml`).

| File | Contents |
|------|----------|
| `00-namespace.yaml` | `clippy` namespace |
| `10-postgres.yaml` | Postgres StatefulSet + Service |
| `11-postgres-longhorn-pvc.yaml` | Empty 10Gi Longhorn migration target |
| `15-secrets.yaml` | OnePasswordItem → `clippy-postgres`, `clippy-app`, `clippy-mcp-secrets` |
| `20-app.yaml` | App Deployment + Service |
| `30-middleware.yaml` | Traefik rate-limit + HTTPS redirect |
| `40-certificate.yaml` | cert-manager Certificate (`clippy.cdot.io`) |
| `50-ingressroute.yaml` | Traefik IngressRoutes |
| `60-mcp.yaml` | MCP Deployment + ClusterIP Service (no Ingress) |

## Secrets

Vault: **AI Security Academy** (Connect operator reachability). Field labels must
match Secret keys 1:1:

| 1P item | Secret | Required fields |
|---------|--------|-----------------|
| `Talos - Clippy Postgres` | `clippy-postgres` | `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD` |
| `Talos - Clippy App` | `clippy-app` | `DATABASE_URL`, `KC_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `VLLM_API_KEY` |
| `Talos - Clippy MCP` | `clippy-mcp-secrets` | `BRAVE_API_KEY`, `SCM_CLIENT_ID`, `SCM_CLIENT_SECRET`, `SCM_TSG_ID` |

Bootstrap / refresh from the live namespace (preserves current values):

```bash
./scripts/sync-clippy-secrets-to-1password.sh
```

Still out-of-band (not in this directory):

- `ghcr-secret` — `kubernetes.io/dockerconfigjson` for `ghcr.io/cdot65`
- `clippy-tls` — owned by cert-manager

## PostgreSQL storage migration

Issue [`#11`](https://github.com/cdot65/clippy-chat/issues/11) tracks moving PostgreSQL from
the talos1-local `clippy-postgres-data-clippy-postgres-0` claim to Longhorn. The migration is
split into separately reviewed changes:

1. Stage the empty `clippy-postgres-data-longhorn` target. It is intentionally unconsumed;
   PostgreSQL remains on the `local-path` volume claim template.
2. Switch the immutable StatefulSet storage shape only after Argo is paused, the application
   writers are stopped, and a PostgreSQL-native backup has been restored and validated.

See [`postgres-storage-migration.md`](postgres-storage-migration.md). Stage 1 is additive only;
do not copy data, delete the StatefulSet, or switch a consumer from this change.

Add `clippy` to the Connect operator `watchNamespace` list in
`talos-cluster/onepassword/values.yaml` (merge into live helm values before
upgrade — see that file's header).

## Images

| Workload | Image |
|----------|-------|
| clippy-chat (+ migrate init) | `ghcr.io/cdot65/clippy-chat:latest` |
| clippy-mcp | `ghcr.io/cdot65/clippy-mcp:latest` |

## Do not hand-apply on Talos

Prefer Argo sync. For a one-off local dry-run against a kube context:

```bash
kubectl diff -f k8s/
```
