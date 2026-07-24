from mcp.server.fastmcp import FastMCP

_registered = False


def register_all(mcp: FastMCP) -> None:
    global _registered
    if _registered:  # create_app() may run twice (module import + tests)
        return
    _registered = True
    from clippy_mcp.tools import datetime_tool, mlb, news, polymarket, scm, weather

    datetime_tool.register(mcp)
    weather.register(mcp)
    news.register(mcp)
    mlb.register(mcp)
    polymarket.register(mcp)
    scm.register(mcp)
