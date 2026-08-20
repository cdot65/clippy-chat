# clippy-mcp

In-namespace MCP tool server (streamable HTTP) for clippy-chat. Run `uv sync`, then `uv run uvicorn clippy_mcp.server:app --port 8080`. Tests: `uv run pytest`. Design spec: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`.

All MCP requests require a scoped OAuth bearer token. AIRS forwards the original external
identity; the internal Clippy app sends its own machine token directly. The server independently
verifies the Keycloak signature, issuer, Clippy audience,
`clippy-mcp-client` authorized party, `mcp.invoke` scope, and Portkey workspace.
`/healthz` remains unauthenticated for Kubernetes probes.

The Clippy chat app mints short-lived `clippy-mcp-client` credentials and sends
them to this internal service. Prisma AIRS red-team adapters use the same
client-credentials identity through their platform OAuth2 configuration.

External callers use AIRS with `x-portkey-api-key` plus
`X-Auth-Token: Bearer <identity JWT>`. AIRS forwards the validated identity as the upstream
`Authorization` bearer; this server verifies it again. Full contract, architecture, E2E curls,
and production evidence: [`docs-site/docs/security/`](../docs-site/docs/security/overview.mdx).

Cluster images must be **linux/amd64** (Talos). The Dockerfile pins `--platform=linux/amd64`; when building from Apple Silicon also pass the flag:

```bash
docker build --platform linux/amd64 -t registry.cdot.io/clippy/clippy-mcp:sha-$GIT_SHA .
```
