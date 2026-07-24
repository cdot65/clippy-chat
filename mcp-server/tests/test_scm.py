from unittest.mock import MagicMock

import pytest

import clippy_mcp.tools.scm as scm_mod
from clippy_mcp.tools.scm import scm_config


class FakeModel:
    def __init__(self, d): self._d = d
    def model_dump(self, **kw): return self._d


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("SCM_CLIENT_ID", "id")
    monkeypatch.setenv("SCM_CLIENT_SECRET", "sec")
    monkeypatch.setenv("SCM_TSG_ID", "123")
    fake = MagicMock()
    monkeypatch.setattr(scm_mod, "_client", lambda: fake)
    return fake


async def test_list_addresses(client):
    client.address.list.return_value = [FakeModel({"name": "web1", "ip_netmask": "10.0.0.1/32"})]
    out = await scm_config("address", "list", {"folder": "Texas"})
    client.address.list.assert_called_once_with(folder="Texas")
    assert out["items"][0]["name"] == "web1"


async def test_create_requires_payload(client):
    out = await scm_config("address", "create", None)
    assert "error" in out


async def test_delete_requires_id(client):
    out = await scm_config("tag", "delete", {"folder": "Texas"})
    assert "error" in out


async def test_unknown_resource(client):
    out = await scm_config("nat_rule", "list", {"folder": "Texas"})
    assert "error" in out and "resource" in out["error"]


async def test_no_push_action_exists(client):
    for verb in ("push", "commit", "candidate_push"):
        out = await scm_config("address", verb, {})
        assert "error" in out


async def test_missing_creds(monkeypatch):
    for k in ("SCM_CLIENT_ID", "SCM_CLIENT_SECRET", "SCM_TSG_ID"):
        monkeypatch.delenv(k, raising=False)
    scm_mod._cached_client = None
    out = await scm_config("address", "list", {"folder": "Texas"})
    assert "error" in out
