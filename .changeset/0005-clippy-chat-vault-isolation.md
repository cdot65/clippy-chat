---
"clippy-chat": patch
---

Isolated Clippy's secrets from the AI Security Academy vault. `clippy-postgres`, `clippy-app`, and
`clippy-mcp-secrets` — database credentials, session secret, admin password, and MCP tool API keys —
were sourced from the shared **AI Security Academy** vault and now reconcile from a dedicated
**Clippy Chat** vault. Keycloak client credentials stay in the realm-scoped **Truffles** vault.

Forgejo #22, which tracked moving `clippy-mcp-client` *into* AI Security Academy - Runtime and was
carried as the last open approval blocker, is closed as invalid: it required exactly the cross-stack
coupling this boundary forbids. Docs, runbook, sync script, and contract tests updated to match.
