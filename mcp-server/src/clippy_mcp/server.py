"""Clippy MCP server — streamable HTTP with forwarded OAuth authorization."""
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.requests import Request
from starlette.responses import PlainTextResponse

from clippy_mcp.auth import BearerAuthMiddleware, TokenVerifier

# host=0.0.0.0 disables FastMCP's localhost-only DNS-rebinding allowlist.
# ClusterIP-only + no Ingress: disable host checks so k8s Service DNS Host headers work.
mcp = FastMCP(
    "clippy-tools",
    host="0.0.0.0",
    stateless_http=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def create_app(verifier: TokenVerifier | None = None) -> BearerAuthMiddleware:
    # tool modules register here (Tasks 2-6 append imports)
    from clippy_mcp.tools import register_all

    register_all(mcp)
    return BearerAuthMiddleware(
        mcp.streamable_http_app(),
        verifier=verifier,
        excluded_paths={"/healthz"},
    )


app = create_app()
