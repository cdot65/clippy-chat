# clippy-mcp

In-namespace MCP tool server (streamable HTTP) for clippy-chat. Run `uv sync`, then `uv run uvicorn clippy_mcp.server:app --port 8080`. Tests: `uv run pytest`. Design spec: `docs/superpowers/specs/2026-07-24-mcp-server-design.md`.

Cluster images must be **linux/amd64** (Talos). The Dockerfile pins `--platform=linux/amd64`; when building from Apple Silicon also pass the flag:

```bash
docker build --platform linux/amd64 -t registry.cdot.io/clippy/clippy-mcp:latest .
```