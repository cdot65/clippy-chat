"""Clippy MCP server — streamable HTTP, stateless, no auth (cluster-internal only)."""
from mcp.server.fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import PlainTextResponse

mcp = FastMCP("clippy-tools", stateless_http=True)


@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(_: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def create_app():
    # tool modules register here (Tasks 2-6 append imports)
    from clippy_mcp.tools import register_all

    register_all(mcp)
    # StreamableHTTPSessionManager.run() is once-per-instance; tests call create_app() repeatedly.
    mcp._session_manager = None
    return mcp.streamable_http_app()


app = create_app()
