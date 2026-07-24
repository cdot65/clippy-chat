from clippy_mcp.tools.datetime_tool import get_current_datetime


async def test_default_timezone_central():
    out = await get_current_datetime()
    assert out["timezone"] == "America/Chicago"
    assert len(out["date"]) == 10 and out["date"][4] == "-"
    assert out["weekday"] in ("Monday", "Tuesday", "Wednesday", "Thursday",
                              "Friday", "Saturday", "Sunday")
    assert ":" in out["time"]


async def test_explicit_timezone():
    out = await get_current_datetime(timezone="Europe/Paris")
    assert out["timezone"] == "Europe/Paris"


async def test_unknown_timezone_errors():
    out = await get_current_datetime(timezone="Mars/Olympus_Mons")
    assert "error" in out
