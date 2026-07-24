"""Clippy MCP server — streamable HTTP, stateless, no auth (cluster-internal only)."""
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse

mcp = FastMCP("clippy-tools", stateless_http=True)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def create_app() -> Starlette:
    # tool modules register here (Tasks 2-6 append imports)
    from clippy_mcp.tools import register_all

    register_all(mcp)
    return mcp.streamable_http_app()


app = create_app()
