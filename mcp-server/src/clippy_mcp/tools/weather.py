"""get_weather — Open-Meteo geocoding + forecast (no key)."""
import httpx
from mcp.server.fastmcp import FastMCP

WMO = {0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast",
       45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
       61: "light rain", 63: "rain", 65: "heavy rain", 71: "light snow", 73: "snow",
       75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent showers",
       95: "thunderstorm", 96: "thunderstorm w/ hail", 99: "thunderstorm w/ hail"}


def _desc(code: int | None) -> str:
    return WMO.get(code or -1, f"code {code}")


async def get_weather(location: str, days: int = 1) -> dict:
    """Current conditions + daily forecast for a city/place name.

    Args:
        location: City or place, e.g. "Houston" or "Paris, France".
        days: Forecast days 1-7 (default 1).

    Returns dict: {location, current:{temperature_c, feels_like_c, humidity_pct,
    conditions, wind_kmh}, daily:[{date, high_c, low_c, precip_chance_pct, conditions}]}
    or {error} when the place is unknown.
    """
    days = max(1, min(7, days))
    async with httpx.AsyncClient(timeout=10) as http:
        geo_res = await http.get("https://geocoding-api.open-meteo.com/v1/search",
                                 params={"name": location, "count": 1})
        if geo_res.status_code != 200:
            return {"error": f"weather API error {geo_res.status_code}"}
        hits = geo_res.json().get("results") or []
        if not hits:
            return {"error": f"unknown location: {location!r}"}
        g = hits[0]
        fc_res = await http.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": g["latitude"], "longitude": g["longitude"],
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
            "forecast_days": days, "timezone": "auto",
        })
        if fc_res.status_code != 200:
            return {"error": f"weather API error {fc_res.status_code}"}
        fc = fc_res.json()
    cur, d = fc.get("current", {}), fc.get("daily", {})
    place = ", ".join(x for x in (g.get("name"), g.get("admin1"), g.get("country")) if x)
    return {
        "location": place,
        "current": {"temperature_c": cur.get("temperature_2m"),
                    "feels_like_c": cur.get("apparent_temperature"),
                    "humidity_pct": cur.get("relative_humidity_2m"),
                    "conditions": _desc(cur.get("weather_code")),
                    "wind_kmh": cur.get("wind_speed_10m")},
        "daily": [{"date": t, "high_c": hi, "low_c": lo, "precip_chance_pct": p,
                   "conditions": _desc(c)}
                  for t, hi, lo, p, c in zip(d.get("time", []), d.get("temperature_2m_max", []),
                                             d.get("temperature_2m_min", []),
                                             d.get("precipitation_probability_max", []),
                                             d.get("weather_code", []))],
    }


def register(mcp: FastMCP) -> None:
    mcp.tool(description=(
        "Get current weather and a 1-7 day forecast for any city or place name. "
        "Use whenever the user asks about weather, temperature, rain, or forecasts. "
        "Example: get_weather(location='Houston', days=3). Metric units (°C, km/h)."
    ))(get_weather)
