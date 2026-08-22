---
"clippy-chat": patch
---

Corrected the audience-gate documentation, which asserted Keycloak mints no useful `aud` on a
`client_credentials` token. It does: `clippy-m2m` carries the bare string `stack-clippy` and
`clippy-mcp-client` carries `["clippy", "stack-clippy"]`. `M2M_AUDIENCE` can therefore enforce
today with `stack-clippy` and no realm change, or with `clippy-api` after one audience mapper.
Adds test coverage for the bare-string `aud` shape production actually emits, and documents the
silent CI publishing failure in the published operations guide.
