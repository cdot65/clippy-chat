from mcp.server.fastmcp import FastMCP

_registered = False


def register_all(mcp: FastMCP) -> None:
    global _registered
    if _registered:  # create_app() may run twice (module import + tests)
        return
    _registered = True
    from clippy_mcp.tools import mlb, news, polymarket, scm, weather

    weather.register(mcp)
    news.register(mcp)
    mlb.register(mcp)
    polymarket.register(mcp)
    scm.register(mcp)
