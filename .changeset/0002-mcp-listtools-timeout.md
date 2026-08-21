---
"clippy-chat": patch
---

Stop silently dropping MCP tools from a chat turn when the AI gateway's tool-listing path is cold.
The first `tools/list` after the gateway's route cache expires measured 10.6s against a 10s bound,
so the request timed out and the turn ran with no tools at all. `listTools` now has its own 25s
budget, separate from the connect handshake.
