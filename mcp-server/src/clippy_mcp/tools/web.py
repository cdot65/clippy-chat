"""web_search — Brave Web Search API (X-Subscription-Token from BRAVE_API_KEY)."""
import os

import httpx
from mcp.server.fastmcp import FastMCP


async def web_search(query: str, count: int = 5) -> dict:
    key = os.environ.get("BRAVE_API_KEY")
    if not key:
        return {"error": "web search unavailable: BRAVE_API_KEY not configured"}
    count = max(1, min(10, count))
    async with httpx.AsyncClient(timeout=10) as http:
        res = await http.get(
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": query, "count": count},
            headers={"X-Subscription-Token": key, "Accept": "application/json"},
        )
    if res.status_code != 200:
        return {"error": f"web search API error {res.status_code}: {res.text[:200]}"}
    web = (res.json().get("web") or {}).get("results", [])
    return {"query": query, "results": [
        {"title": r.get("title"), "url": r.get("url"),
         "description": r.get("description"),
         "source": (r.get("meta_url") or {}).get("hostname")}
        for r in web[:count]]}


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "General web search for any query. Use when the user asks to find, look up, "
        "or search the web for information on any topic. "
        "Example: web_search(query='latest CVE advisories', count=5)."
    ))(web_search)
