"""Authorization for bearer identities forwarded by the AIRS MCP gateway."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

import anyio
import jwt
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class InvalidForwardedToken(Exception):
    """The forwarded identity is absent, invalid, or unauthorized for Clippy."""


@dataclass(frozen=True)
class ForwardedJWTConfig:
    issuer: str
    audience: str
    authorized_party: str
    required_scope: str
    workspace: str

    @property
    def jwks_uri(self) -> str:
        return f"{self.issuer.rstrip('/')}/protocol/openid-connect/certs"

    @classmethod
    def from_env(cls) -> ForwardedJWTConfig:
        names = {
            "issuer": "MCP_OIDC_ISSUER",
            "audience": "MCP_OIDC_AUDIENCE",
            "authorized_party": "MCP_OIDC_AUTHORIZED_PARTY",
            "required_scope": "MCP_OIDC_REQUIRED_SCOPE",
            "workspace": "MCP_OIDC_WORKSPACE",
        }
        values = {field: os.environ.get(name, "").strip() for field, name in names.items()}
        missing = [names[field] for field, value in values.items() if not value]
        if missing:
            raise InvalidForwardedToken("forwarded identity configuration is incomplete")
        return cls(**values)


class TokenVerifier(Protocol):
    async def verify(self, token: str) -> dict[str, Any]: ...


class ForwardedTokenVerifier:
    def __init__(self, config: ForwardedJWTConfig, jwk_client: Any | None = None):
        self.config = config
        self.jwk_client = jwk_client or jwt.PyJWKClient(
            config.jwks_uri,
            cache_keys=True,
            cache_jwk_set=True,
            lifespan=300,
            timeout=5,
        )

    async def verify(self, token: str) -> dict[str, Any]:
        try:
            return await anyio.to_thread.run_sync(self._verify_sync, token)
        except InvalidForwardedToken:
            raise
        except (jwt.PyJWTError, OSError, TypeError, ValueError) as error:
            raise InvalidForwardedToken("invalid forwarded token") from error

    def _verify_sync(self, token: str) -> dict[str, Any]:
        signing_key = self.jwk_client.get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            audience=self.config.audience,
            issuer=self.config.issuer,
            options={
                "require": [
                    "exp",
                    "iat",
                    "sub",
                    "aud",
                    "azp",
                    "scope",
                    "portkey_workspace",
                ]
            },
        )
        if claims["azp"] != self.config.authorized_party:
            raise InvalidForwardedToken("invalid authorized party")
        if claims["portkey_workspace"] != self.config.workspace:
            raise InvalidForwardedToken("invalid workspace")
        scope = claims["scope"]
        if not isinstance(scope, str) or self.config.required_scope not in scope.split():
            raise InvalidForwardedToken("missing required scope")
        return claims


class LazyForwardedTokenVerifier:
    def __init__(self):
        self.verifier: ForwardedTokenVerifier | None = None

    async def verify(self, token: str) -> dict[str, Any]:
        if self.verifier is None:
            self.verifier = ForwardedTokenVerifier(ForwardedJWTConfig.from_env())
        return await self.verifier.verify(token)


class BearerAuthMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        verifier: TokenVerifier | None = None,
        excluded_paths: set[str] | frozenset[str] = frozenset(),
    ):
        self.app = app
        self.verifier = verifier or LazyForwardedTokenVerifier()
        self.excluded_paths = frozenset(excluded_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") in self.excluded_paths:
            await self.app(scope, receive, send)
            return

        values = [
            value.decode("latin-1")
            for name, value in scope.get("headers", [])
            if name.lower() == b"authorization"
        ]
        if len(values) != 1:
            await self._unauthorized(scope, receive, send)
            return

        scheme, separator, token = values[0].partition(" ")
        if (
            not separator
            or scheme.lower() != "bearer"
            or not token
            or any(character.isspace() for character in token)
        ):
            await self._unauthorized(scope, receive, send)
            return

        try:
            await self.verifier.verify(token)
        except InvalidForwardedToken:
            await self._unauthorized(scope, receive, send)
            return
        await self.app(scope, receive, send)

    @staticmethod
    async def _unauthorized(scope: Scope, receive: Receive, send: Send) -> None:
        response = JSONResponse(
            {"error": "unauthorized"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
        await response(scope, receive, send)
