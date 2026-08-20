---
"clippy-chat": patch
---

Keep chat working when vLLM rejects the tool-calling payload: the turn now retries once without tools instead of failing, oversized MCP tool results are capped before being fed back to the model, and the SSE error carries an `upstream_<status>` code with the upstream body logged server-side.
