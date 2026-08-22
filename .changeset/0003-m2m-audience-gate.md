---
"clippy-chat": patch
---

Machine bearer tokens can now be checked against an expected audience. `verifyBearer` previously
validated only the issuer, RS256 signature, and `clippy-api` scope, so a correctly scoped token
minted for any other audience in the same realm authenticated to the chat API. Setting the new
`M2M_AUDIENCE` adds `aud` to the required claims and rejects tokens that do not carry it.

The check is off unless `M2M_AUDIENCE` is set, and production ships it unset: Keycloak mints no
useful `aud` on a `client_credentials` token until the calling client's dedicated scope carries an
audience mapper, so enforcing it before the realm change would `401` every machine caller,
including the red-team adapter. The app logs one `M2M_AUDIENCE unset` warning per process while the
gap is open. Rollout order — mapper, prove the claim, then arm the variable — is in
`k8s/m2m-audience-rollout.md`.
