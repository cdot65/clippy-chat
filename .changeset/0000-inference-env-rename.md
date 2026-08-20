---
"clippy-chat": patch
---

Renamed `VLLM_*` environment variables (`VLLM_BASE_URL`, `VLLM_MODEL`, `VLLM_API_KEY`,
`VLLM_AUTH_MODE`) to `INFERENCE_*` to reflect that inference now routes through the Prisma
AIRS gateway rather than vLLM directly. Deployments setting the old `VLLM_*` names must switch
to `INFERENCE_*` on upgrade.
