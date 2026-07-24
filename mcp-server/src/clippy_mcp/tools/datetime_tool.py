"""get_current_datetime — current date/time; the model has no reliable clock."""
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mcp.server.fastmcp import FastMCP


async def get_current_datetime(timezone: str = "America/Chicago") -> dict:
    try:
        now = datetime.now(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        return {"error": f"unknown IANA timezone: {timezone!r}"}
    return {
        "date": now.date().isoformat(),
        "time": now.strftime("%H:%M"),
        "weekday": now.strftime("%A"),
        "timezone": timezone,
        "utc_offset": now.strftime("%z"),
    }


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "Get the current date and time (IANA timezone, default America/Chicago). "
        "Your training data is stale — you do NOT know today's date. ALWAYS call this "
        "first before any question involving 'today', 'yesterday', 'this week', or "
        "before passing a date to another tool like get_mlb_scores or get_daily_news. "
        "Example: get_current_datetime() -> {'date':'2026-07-24','weekday':'Friday',...}."
    ))(get_current_datetime)
