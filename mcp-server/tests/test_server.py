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
        # streamable HTTP endpoint answers (406 without proper Accept headers is fine —
        # proves the mount exists; 404 would mean it doesn't)
        res = client.post("/mcp", json={})
        assert res.status_code != 404
