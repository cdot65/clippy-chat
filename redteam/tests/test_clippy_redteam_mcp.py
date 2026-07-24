"""Tests for redteam/clippy_redteam_mcp.py — Palo Alto AI Red Teaming MCP adapter.

Platform symbols are injected onto the module (matching runtime injection).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

# Adapter lives next to this package: redteam/clippy_redteam_mcp.py
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "redteam"))

import clippy_redteam_mcp as adapter  # noqa: E402


class PreProcessResult:
    def __init__(self, url, method="POST", headers=None, json_body=None, **_):
        self.url = url
        self.method = method
        self.headers = headers or {}
        self.json_body = json_body


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
    monkeypatch.setattr(adapter, "DEBUG_MCP", False)


class FakeHttp:
    def __init__(self, responses=None):
        self.calls = []
        self._responses = list(responses or [])

    def post(self, url, headers=None, json=None, **_):
        self.calls.append({"url": url, "headers": dict(headers or {}), "json": json})
        if self._responses:
            return self._responses.pop(0)
        return SimpleNamespace(status_code=200, headers={}, text="", json_body={})


def _ctx(vars=None, http=None):
    return SimpleNamespace(vars=vars or {}, http=http or FakeHttp(), secrets={}, auth={})


def _prompt(text):
    return SimpleNamespace(prompt=text)


def test_tools_call_wraps_prompt_and_merges_static_args():
    http = FakeHttp([
        SimpleNamespace(status_code=200, headers={}, text="", json_body={"result": {"protocolVersion": "2024-11-05"}}),
        SimpleNamespace(status_code=202, headers={}, text="", json_body=None),
    ])
    ctx = _ctx(
        vars={
            "endpoint": "http://clippy-mcp:8080/mcp",
            "tool_name": "get_weather",
            "arg_name": "location",
            "static_args": {"days": 2},
        },
        http=http,
    )
    out = adapter.pre_process(ctx, _prompt("Houston"))
    assert out.url == "http://clippy-mcp:8080/mcp"
    assert out.method == "POST"
    assert out.headers["Content-Type"] == "application/json"
    assert "text/event-stream" in out.headers["Accept"]
    body = out.json_body
    assert body["method"] == "tools/call"
    assert body["params"]["name"] == "get_weather"
    assert body["params"]["arguments"] == {"days": 2, "location": "Houston"}


def test_session_id_from_initialize_propagates():
    http = FakeHttp([
        SimpleNamespace(
            status_code=200,
            headers={"Mcp-Session-Id": "sess-abc"},
            text="",
            json_body={"result": {"protocolVersion": "2025-03-26"}},
        ),
        SimpleNamespace(status_code=202, headers={}, text="", json_body=None),
    ])
    ctx = _ctx(
        vars={"endpoint": "http://mcp/mcp", "tool_name": "get_weather", "arg_name": "location"},
        http=http,
    )
    out = adapter.pre_process(ctx, _prompt("x"))
    assert out.headers.get("Mcp-Session-Id") == "sess-abc"
    # initialize + notifications/initialized both sent
    assert len(http.calls) == 2
    assert http.calls[0]["json"]["method"] == "initialize"
    assert http.calls[1]["json"]["method"] == "notifications/initialized"
    assert "id" not in http.calls[1]["json"]
    assert http.calls[1]["headers"].get("Mcp-Session-Id") == "sess-abc"


def test_handshake_exception_still_returns_tools_call():
    class BoomHttp:
        def post(self, *a, **k):
            raise RuntimeError("down")

    ctx = _ctx(
        vars={"endpoint": "http://mcp/mcp", "tool_name": "get_weather", "arg_name": "location"},
        http=BoomHttp(),
    )
    out = adapter.pre_process(ctx, _prompt("Austin"))
    assert out.json_body["method"] == "tools/call"
    assert out.json_body["params"]["arguments"]["location"] == "Austin"


def test_extract_jsonrpc_direct_json():
    raw = SimpleNamespace(
        headers={"content-type": "application/json"},
        json_body={"jsonrpc": "2.0", "id": 1, "result": {"content": [{"type": "text", "text": "hi"}]}},
        text="",
    )
    assert adapter._extract_jsonrpc(raw)["result"]["content"][0]["text"] == "hi"


def test_extract_jsonrpc_sse_framed():
    frame = (
        "event: message\n"
        'data: {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"sse-ok"}]}}\n\n'
    )
    raw = SimpleNamespace(
        headers={"content-type": "text/event-stream"},
        json_body=None,
        text=frame,
    )
    assert adapter._extract_jsonrpc(raw)["result"]["content"][0]["text"] == "sse-ok"


def test_post_process_joins_text_and_prefixes_is_error():
    raw = SimpleNamespace(
        status_code=200,
        headers={"content-type": "application/json"},
        json_body={
            "result": {
                "isError": True,
                "content": [{"type": "text", "text": "bad args"}, {"type": "text", "text": " more"}],
            }
        },
        text="",
    )
    out = adapter.post_process(_ctx(), raw)
    assert out.output.startswith("[tool isError] ")
    assert "bad args" in out.output and "more" in out.output


def test_post_process_mcp_error():
    raw = SimpleNamespace(
        status_code=200,
        headers={"content-type": "application/json"},
        json_body={"error": {"code": -32602, "message": "Invalid params"}},
        text="",
    )
    out = adapter.post_process(_ctx(), raw)
    assert out.output == "[mcp error -32602] Invalid params"


def test_post_process_http_error():
    raw = SimpleNamespace(
        status_code=500,
        headers={"content-type": "application/json"},
        json_body={"error": "boom"},
        text="ignored",
    )
    out = adapter.post_process(_ctx(), raw)
    assert out.output.startswith("[adapter error 500]")
    assert "boom" in out.output


def test_post_process_429_raises():
    raw = SimpleNamespace(status_code=429, headers={}, json_body=None, text="")
    with pytest.raises(RateLimited) as ei:
        adapter.post_process(_ctx(), raw)
    assert ei.value.retry_after == 30


def test_static_args_string_and_bad_json():
    assert adapter._static_args({"static_args": '{"a":1}'}) == {"a": 1}
    assert adapter._static_args({"static_args": "not-json"}) == {}
    assert adapter._static_args({}) == {}
    assert adapter._static_args({"static_args": {"x": True}}) == {"x": True}


def test_post_process_empty_content_falls_back_to_dumps():
    raw = SimpleNamespace(
        status_code=200,
        headers={"content-type": "application/json"},
        json_body={"result": {"content": [], "meta": 1}},
        text="",
    )
    out = adapter.post_process(_ctx(), raw)
    assert "meta" in out.output
