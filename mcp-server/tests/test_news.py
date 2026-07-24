import respx
from httpx import Response

from clippy_mcp.tools.news import get_daily_news

URL = "https://api.search.brave.com/res/v1/news/search"

@respx.mock
async def test_news_happy(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "test-key")
    route = respx.get(URL).mock(return_value=Response(200, json={"results": [
        {"title": "Big story", "url": "https://ex.com/a", "description": "desc",
         "age": "2 hours ago", "meta_url": {"hostname": "ex.com"}}]}))
    out = await get_daily_news(topic="tech", count=1)
    assert route.calls[0].request.headers["X-Subscription-Token"] == "test-key"
    assert out["articles"][0]["title"] == "Big story"

async def test_news_missing_key(monkeypatch):
    monkeypatch.delenv("BRAVE_API_KEY", raising=False)
    out = await get_daily_news()
    assert "error" in out
