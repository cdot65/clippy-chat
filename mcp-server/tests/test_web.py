import respx
from httpx import Response

from clippy_mcp.tools.web import web_search

URL = "https://api.search.brave.com/res/v1/web/search"


@respx.mock
async def test_web_search_happy(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "test-key")
    route = respx.get(URL).mock(return_value=Response(200, json={"web": {"results": [
        {"title": "Result A", "url": "https://ex.com/a", "description": "desc A",
         "meta_url": {"hostname": "ex.com"}}]}}))
    out = await web_search(query="cve advisories", count=1)
    assert route.calls[0].request.headers["X-Subscription-Token"] == "test-key"
    assert out["query"] == "cve advisories"
    assert out["results"][0]["title"] == "Result A"
    assert out["results"][0]["source"] == "ex.com"


async def test_web_search_missing_key(monkeypatch):
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    out = await web_search(query="x")
    assert "error" in out


@respx.mock
async def test_web_search_api_error(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "test-key")
    respx.get(URL).mock(return_value=Response(422, text="bad token"))
    out = await web_search(query="x")
    assert "web search API error 422" in out["error"]
