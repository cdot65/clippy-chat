---
"clippy-chat": patch
---

Moved the Keycloak client credentials out of the shared `Truffles` realm vault into the dedicated
`Clippy Chat` vault, completing the stack isolation. `clippy-mcp-client` and
`clippy-inference-client` now reconcile from `Talos - Keycloak clippy-*` items in `Clippy Chat`.

`test_manifest` no longer asserts the Truffles path; it now fails if **any** `itemPath` in
`15-secrets.yaml` points outside the Clippy Chat vault, so this cannot regress silently.
