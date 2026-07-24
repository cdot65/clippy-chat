"""get_daily_news — Brave News API (X-Subscription-Token from BRAVE_API_KEY)."""
import os

import httpx
from mcp.server.fastmcp import FastMCP


async def get_daily_news(topic: str = "top news today", count: int = 5) -> dict:
    key = os.environ.get("BRAVE_API_KEY")
    if not key:
        return {"error": "news unavailable: BRAVE_API_KEY not configured"}
    count = max(1, min(10, count))
    async with httpx.AsyncClient(timeout=10) as http:
        res = await http.get(
            "https://api.search.brave.com/res/v1/news/search",
            params={"q": topic, "count": count, "freshness": "pd"},
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
        )
    if res.status_code != 200:
        return {"error": f"news API error {res.status_code}"}
    return {"topic": topic, "articles": [
        {"title": a.get("title"), "url": a.get("url"),
         "source": (a.get("meta_url") or {}).get("hostname"),
         "summary": a.get("description"), "age": a.get("age")}
        for a in res.json().get("results", [])[:count]]}


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "Get today's news headlines on any topic. Use when the user asks what's "
        "happening, current events, or news about a subject. "
        "Example: get_daily_news(topic='AI security', count=5). Default topic is general top news."
    ))(get_daily_news)
