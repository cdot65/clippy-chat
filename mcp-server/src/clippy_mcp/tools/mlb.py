"""get_mlb_scores — free MLB Stats API (statsapi.mlb.com), no key."""
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from mcp.server.fastmcp import FastMCP


async def get_mlb_scores(date: str | None = None, team: str | None = None) -> dict:
    day = date or datetime.now(ZoneInfo("America/Chicago")).date().isoformat()
    async with httpx.AsyncClient(timeout=10) as http:
        res = await http.get("https://statsapi.mlb.com/api/v1/schedule",
                             params={"sportId": 1, "date": day})
    if res.status_code != 200:
        return {"error": f"MLB API error {res.status_code}"}
    dates = res.json().get("dates", [])
    games = dates[0].get("games", []) if dates else []
    rows = []
    for g in games:
        away, home = g["teams"]["away"], g["teams"]["home"]
        row = {"away": away["team"]["name"], "away_score": away.get("score"),
               "home": home["team"]["name"], "home_score": home.get("score"),
               "status": g.get("status", {}).get("detailedState")}
        if team and team.lower() not in (row["away"] + row["home"]).lower():
            continue
        rows.append(row)
    return {"date": day, "games": rows}


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "Get MLB baseball scores/schedule for a date (YYYY-MM-DD, default today), "
        "optionally filtered by team name substring. Use for questions about baseball "
        "games, scores, or who won. Example: get_mlb_scores(team='Astros')."
    ))(get_mlb_scores)
