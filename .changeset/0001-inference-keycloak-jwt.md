---
"clippy-chat": minor
---

Authenticate gateway inference with a Keycloak machine identity instead of a static API key.
In `INFERENCE_AUTH_MODE=gateway`, Clippy now mints a `client_credentials` token from the
`INFERENCE_CLIENT_*` client and sends it as `x-portkey-api-key`, matching how MCP calls already
authenticate. The inference and MCP identities stay on separate Keycloak clients so neither
token can call the other's route. A static `INFERENCE_API_KEY` still works as a fallback and
remains the credential for `direct` mode.
