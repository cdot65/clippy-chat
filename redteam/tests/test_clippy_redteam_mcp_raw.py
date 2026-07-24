"""Tests for redteam/clippy_redteam_mcp_raw.py — raw JSON-RPC fuzzing adapter.

Platform symbols are injected onto the module (matching runtime injection).
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import clippy_redteam_mcp_raw as adapter  # path set up in conftest.py


class PreProcessResult:
    def __init__(self, url, method="POST", headers=None, json_body=None, body=None, **_):
        self.url = url
        self.method = method
        self.headers = headers or {}
        self.json_body = json_body
        self.body = body


class PostProcessResult:
    def __init__(self, output, **_):
        self.output = output


class RateLimited(Exception):
    def __init__(self, retry_after=None):
        self.retry_after = retry_after


def raise_rate_limited(retry_after=30):
    raise RateLimited(retry_after=retry_after)


@pytest.fixture(autouse=True)
def _inject_platform(monkeypatch):
    monkeypatch.setattr(adapter, "PreProcessResult", PreProcessResult, raising=False)
    monkeypatch.setattr(adapter, "PostProcessResult", PostProcessResult, raising=False)
    monkeypatch.setattr(adapter, "raise_rate_limited", raise_rate_limited, raising=False)


def _ctx(endpoint="http://mcp/mcp"):
    return SimpleNamespace(vars={"endpoint": endpoint}, http=None, secrets={}, auth={})


def _prompt(text):
    return SimpleNamespace(prompt=text)


def test_valid_json_prompt_forwarded_verbatim_as_body():
    body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
    out = adapter.pre_process(_ctx(), _prompt(body))
    assert out.method == "POST"
    assert out.headers["Content-Type"] == "application/json"
    assert "text/event-stream" in out.headers["Accept"]
    # platform serializes `body`, not `json_body` — send the prompt byte-for-byte
    assert out.body == body
    assert out.json_body is None


def test_malformed_prompt_sent_verbatim_as_body():
    junk = '{"jsonrpc":"2.0", broken'
    out = adapter.pre_process(_ctx(), _prompt(junk))
    assert out.body == junk
    assert out.json_body is None


def test_post_process_returns_full_result_envelope():
    raw = SimpleNamespace(
        status_code=200,
        headers={"content-type": "application/json"},
        json_body={"jsonrpc": "2.0", "id": 1, "result": {"tools": [{"name": "get_weather"}]}},
        text="",
    )
    out = adapter.post_process(_ctx(), raw)
    assert '"result"' in out.output and "get_weather" in out.output


def test_post_process_returns_full_error_envelope_with_code():
    raw = SimpleNamespace(
        status_code=200,
        headers={"content-type": "application/json"},
        json_body={"jsonrpc": "2.0", "id": 1, "error": {"code": -32601, "message": "Method not found"}},
        text="",
    )
    out = adapter.post_process(_ctx(), raw)
    assert "-32601" in out.output and "Method not found" in out.output


def test_post_process_sse_framed():
    frame = 'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    raw = SimpleNamespace(status_code=200, headers={"content-type": "text/event-stream"},
                          json_body=None, text=frame)
    out = adapter.post_process(_ctx(), raw)
    assert '"ok"' in out.output


def test_post_process_http_error_prefixes_status():
    raw = SimpleNamespace(status_code=400, headers={"content-type": "text/plain"},
                          json_body=None, text="Bad Request: not JSON-RPC")
    out = adapter.post_process(_ctx(), raw)
    assert out.output.startswith("[HTTP 400]")
    assert "Bad Request" in out.output


def test_post_process_unparseable_body_returns_raw_with_status():
    raw = SimpleNamespace(status_code=200, headers={"content-type": "text/html"},
                          json_body=None, text="<html>nope</html>")
    out = adapter.post_process(_ctx(), raw)
    assert "[HTTP 200]" in out.output and "nope" in out.output


def test_post_process_429_raises():
    raw = SimpleNamespace(status_code=429, headers={}, json_body=None, text="")
    with pytest.raises(RateLimited) as ei:
        adapter.post_process(_ctx(), raw)
    assert ei.value.retry_after == 30
