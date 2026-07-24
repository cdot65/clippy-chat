import respx
from httpx import Response

from clippy_mcp.tools.weather import get_weather

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FC = "https://api.open-meteo.com/v1/forecast"

@respx.mock
async def test_get_weather_happy():
    respx.get(GEO).mock(return_value=Response(200, json={
        "results": [{"name": "Houston", "latitude": 29.76, "longitude": -95.36,
                     "admin1": "Texas", "country": "United States"}]}))
    respx.get(FC).mock(return_value=Response(200, json={
        "current": {"temperature_2m": 31.2, "apparent_temperature": 36.0,
                    "relative_humidity_2m": 70, "weather_code": 1, "wind_speed_10m": 12.0},
        "daily": {"time": ["2026-07-24"], "temperature_2m_max": [35.1],
                  "temperature_2m_min": [26.0], "precipitation_probability_max": [20],
                  "weather_code": [1]}}))
    out = await get_weather("Houston")
    assert out["location"] == "Houston, Texas, United States"
    assert out["current"]["temperature_c"] == 31.2
    assert len(out["daily"]) == 1

@respx.mock
async def test_get_weather_unknown_location():
    respx.get(GEO).mock(return_value=Response(200, json={}))
    out = await get_weather("Xyzzyville")
    assert "error" in out


@respx.mock
async def test_get_weather_geocode_http_error():
    respx.get(GEO).mock(return_value=Response(503))
    out = await get_weather("Houston")
    assert out == {"error": "weather API error 503"}


@respx.mock
async def test_get_weather_forecast_http_error():
    respx.get(GEO).mock(return_value=Response(200, json={
        "results": [{"name": "Houston", "latitude": 29.76, "longitude": -95.36}]}))
    respx.get(FC).mock(return_value=Response(500))
    out = await get_weather("Houston")
    assert out == {"error": "weather API error 500"}
