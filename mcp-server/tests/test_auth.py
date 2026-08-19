import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from clippy_mcp.auth import (
    BearerAuthMiddleware,
    ForwardedJWTConfig,
    ForwardedTokenVerifier,
    InvalidForwardedToken,
)

ISSUER = "https://auth.dev.cdot.io/realms/truffles"
WORKSPACE = "ws-produc-985697"


@pytest.fixture
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def config():
    return ForwardedJWTConfig(
        issuer=ISSUER,
        audience="clippy",
        authorized_party="clippy-mcp-client",
        required_scope="mcp.invoke",
        workspace=WORKSPACE,
    )


def token(signing_key, **overrides):
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": "clippy",
        "azp": "clippy-mcp-client",
        "sub": "service-account-clippy-mcp-client",
        "scope": "mcp.invoke",
        "portkey_workspace": WORKSPACE,
        "iat": now,
        "exp": now + 300,
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="RS256", headers={"kid": "test"})


class StaticJWKClient:
    def __init__(self, key):
        self.key = key

    def get_signing_key_from_jwt(self, _token):
        return SimpleNamespace(key=self.key)


@pytest.mark.asyncio
async def test_verifier_accepts_exact_clippy_claims(signing_key, config):
    verifier = ForwardedTokenVerifier(
        config,
        jwk_client=StaticJWKClient(signing_key.public_key()),
    )

    claims = await verifier.verify(token(signing_key))

    assert claims["azp"] == "clippy-mcp-client"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://auth.dev.cdot.io/realms/agent-mesh"},
        {"aud": "agent-gateway"},
        {"azp": "ag-560d2489a782793f222c1024973143db"},
        {"scope": "profile email"},
        {"portkey_workspace": "ws-wrong"},
        {"exp": 1},
    ],
)
async def test_verifier_rejects_wrong_claims(signing_key, config, overrides):
    verifier = ForwardedTokenVerifier(
        config,
        jwk_client=StaticJWKClient(signing_key.public_key()),
    )

    with pytest.raises(InvalidForwardedToken):
        await verifier.verify(token(signing_key, **overrides))


@pytest.mark.asyncio
async def test_verifier_rejects_wrong_signature(signing_key, config):
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    verifier = ForwardedTokenVerifier(
        config,
        jwk_client=StaticJWKClient(other_key.public_key()),
    )

    with pytest.raises(InvalidForwardedToken):
        await verifier.verify(token(signing_key))


class AllowingVerifier:
    async def verify(self, _token):
        return {"sub": "allowed"}


class RejectingVerifier:
    async def verify(self, _token):
        raise InvalidForwardedToken("rejected")


def protected_app(verifier):
    inner = Starlette(
        routes=[
            Route("/healthz", lambda _: PlainTextResponse("ok")),
            Route("/mcp", lambda _: PlainTextResponse("mcp"), methods=["POST"]),
        ]
    )
    return BearerAuthMiddleware(inner, verifier=verifier, excluded_paths={"/healthz"})


def test_health_bypasses_bearer_auth():
    with TestClient(protected_app(RejectingVerifier())) as client:
        response = client.get("/healthz")

    assert response.status_code == 200


def test_protected_route_requires_single_bearer_header():
    with TestClient(protected_app(AllowingVerifier())) as client:
        missing = client.post("/mcp")
        malformed = client.post("/mcp", headers={"authorization": "token"})
        duplicate = client.post(
            "/mcp",
            headers=[
                ("authorization", "Bearer first"),
                ("authorization", "Bearer second"),
            ],
        )

    assert missing.status_code == 401
    assert malformed.status_code == 401
    assert duplicate.status_code == 401


def test_protected_route_rejects_invalid_forwarded_token():
    with TestClient(protected_app(RejectingVerifier())) as client:
        response = client.post("/mcp", headers={"authorization": "Bearer invalid"})

    assert response.status_code == 401


def test_protected_route_accepts_valid_forwarded_token():
    with TestClient(protected_app(AllowingVerifier())) as client:
        response = client.post("/mcp", headers={"authorization": "Bearer valid"})

    assert response.status_code == 200
