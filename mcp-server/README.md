# clippy-mcp

In-namespace MCP tool server (streamable HTTP) for clippy-chat. Run `uv sync`, then `uv run uvicorn clippy_mcp.server:app --port 8080`. Tests: `uv run pytest`. Design spec: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`.

All MCP requests require the original OAuth bearer token forwarded by AIRS. The
server independently verifies the Keycloak signature, issuer, Clippy audience,
`clippy-mcp-client` authorized party, `mcp.invoke` scope, and Portkey workspace.
`/healthz` remains unauthenticated for Kubernetes probes.

The Clippy chat app mints short-lived `clippy-mcp-client` credentials and sends
them to this internal service. Prisma AIRS red-team adapters use the same
client-credentials identity through their platform OAuth2 configuration.

Cluster images must be **linux/amd64** (Talos). The Dockerfile pins `--platform=linux/amd64`; when building from Apple Silicon also pass the flag:

```bash
docker build --platform linux/amd64 -t registry.cdot.io/clippy/clippy-mcp:latest .
```
