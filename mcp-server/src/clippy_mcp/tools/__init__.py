from mcp.server.fastmcp import FastMCP

_registered = False


def register_all(mcp: FastMCP) -> None:
    global _registered
    if _registered:  # create_app() may run twice (module import + tests)
        return
    _registered = True
    # Tasks 2-6 add: from clippy_mcp.tools import weather; weather.register(mcp)
