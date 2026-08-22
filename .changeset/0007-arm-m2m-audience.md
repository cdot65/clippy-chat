---
"clippy-chat": patch
---

Armed the machine-bearer audience gate in production: `M2M_AUDIENCE=stack-clippy`. `verifyBearer`
now requires `aud` on `/api/chat` bearer tokens and rejects anything not carrying the Clippy stack
audience, so a correctly scoped `clippy-api` token minted elsewhere in the realm no longer
authenticates. No image change — the gate shipped disarmed and this only sets the variable.
