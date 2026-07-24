"""polymarket_bets — Polymarket Gamma API, read-only market odds."""
import json

import httpx
from mcp.server.fastmcp import FastMCP


def _outcomes(m: dict) -> dict:
    try:  # gamma returns JSON-encoded strings for these two fields
        names = json.loads(m.get("outcomes") or "[]")
        prices = [float(p) for p in json.loads(m.get("outcomePrices") or "[]")]
        return dict(zip(names, prices))
    except (ValueError, TypeError):
        return {}


async def polymarket_bets(query: str | None = None, limit: int = 5) -> dict:
    limit = max(1, min(10, limit))
    async with httpx.AsyncClient(timeout=10) as http:
        res = await http.get("https://gamma-api.polymarket.com/markets", params={
            "closed": "false", "order": "volume", "ascending": "false", "limit": 100})
    if res.status_code != 200:
        return {"error": f"polymarket API error {res.status_code}"}
    rows = []
    for m in res.json():
        if query and query.lower() not in (m.get("question") or "").lower():
            continue
        rows.append({"question": m.get("question"), "outcomes": _outcomes(m),
                     "volume_usd": float(m.get("volume") or 0), "ends": m.get("endDate"),
                     "url": f"https://polymarket.com/market/{m.get('slug')}"})
        if len(rows) >= limit:
            break
    return {"markets": rows}


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "Look up Polymarket prediction-market odds (read-only; prices are probabilities "
        "0-1). Use when the user asks about betting odds, prediction markets, or the "
        "likelihood of events. Example: polymarket_bets(query='election', limit=3). "
        "Top markets by volume when query omitted."
    ))(polymarket_bets)
