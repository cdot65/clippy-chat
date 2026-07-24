import json
import respx
from httpx import Response
from clippy_mcp.tools.polymarket import polymarket_bets

URL = "https://gamma-api.polymarket.com/markets"
MKT = {"question": "Will X happen by 2027?", "outcomes": '["Yes","No"]',
       "outcomePrices": '["0.62","0.38"]', "volume": "1234567.0",
       "endDate": "2027-01-01T00:00:00Z", "slug": "will-x-happen"}

@respx.mock
async def test_bets_query_filter():
    respx.get(URL).mock(return_value=Response(200, json=[
        MKT, {**MKT, "question": "Astros win World Series?", "slug": "astros"}]))
    out = await polymarket_bets(query="astros", limit=5)
    assert len(out["markets"]) == 1
    m = out["markets"][0]
    assert m["question"].startswith("Astros")
    assert m["outcomes"] == {"Yes": 0.62, "No": 0.38}
