import pytest
from starlette.testclient import TestClient

from clippy_mcp.server import create_app, mcp


@pytest.fixture(autouse=True)
def _reset_mcp_session_manager():
    # StreamableHTTPSessionManager.run() is once-per-instance; tests call create_app() repeatedly.
    mcp._session_manager = None


def test_healthz():
    with TestClient(create_app()) as client:
        res = client.get("/healthz")
        assert res.status_code == 200
        assert res.text == "ok"

def test_mcp_mount_exists():
    with TestClient(create_app()) as client:
        res = client.post("/mcp", json={})
        assert res.status_code == 401


def test_ci_server_requires_the_fixture_bearer():
    from authenticated_server import CI_MCP_TOKEN, app

    with TestClient(app) as client:
        denied = client.post("/mcp", headers={"authorization": "Bearer wrong"}, json={})
        allowed = client.post(
            "/mcp",
            headers={"authorization": f"Bearer {CI_MCP_TOKEN}"},
            json={},
        )

    assert denied.status_code == 401
    assert allowed.status_code != 401
