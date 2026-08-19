"""CI-only MCP app with a deterministic bearer verifier."""

from clippy_mcp.auth import InvalidForwardedToken
from clippy_mcp.server import create_app

CI_MCP_TOKEN = "ci-mcp-token"


class CIStaticVerifier:
    async def verify(self, token: str) -> dict[str, str]:
        if token != CI_MCP_TOKEN:
            raise InvalidForwardedToken("invalid CI token")
        return {"sub": "ci-mcp-client"}


app = create_app(CIStaticVerifier())
