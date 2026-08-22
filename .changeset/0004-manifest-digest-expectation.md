---
"clippy-chat": patch
---

Fixed the CI image-pin test, which still expected the pre-AIRS `clippy-chat` digest after the
manifest was re-pinned to the Keycloak inference build. The `mcp` job has failed on `main` since
2026-08-21, and because `build-and-push` needs it, no container image has published since — while
every other check stayed green.
