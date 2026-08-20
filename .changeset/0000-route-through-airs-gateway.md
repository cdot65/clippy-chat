---
"clippy-chat": patch
---

Restore production inference by routing it through the Prisma AIRS gateway. The previous target `vllm-qwen36.vllm.svc.cluster.local` no longer resolved, so every chat turn failed DNS resolution before a request was sent. Inference and MCP now egress through AIRS and speak its header contract (`x-portkey-api-key`, plus `X-Auth-Token` for MCP identity) via the new `VLLM_AUTH_MODE` / `MCP_AUTH_MODE` switches, which default to `direct` so dev and CI are unaffected.
