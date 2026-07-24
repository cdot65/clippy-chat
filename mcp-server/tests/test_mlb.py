import respx
from httpx import Response

from clippy_mcp.tools.mlb import get_mlb_scores

URL = "https://statsapi.mlb.com/api/v1/schedule"
GAME = {"status": {"detailedState": "Final"},
        "teams": {"away": {"team": {"name": "Houston Astros"}, "score": 5},
                  "home": {"team": {"name": "Texas Rangers"}, "score": 3}},
        "gameDate": "2026-07-23T00:05:00Z"}

@respx.mock
async def test_scores_with_team_filter():
    respx.get(URL).mock(return_value=Response(200, json={
        "dates": [{"date": "2026-07-23", "games": [GAME,
            {**GAME, "teams": {"away": {"team": {"name": "New York Mets"}, "score": 1},
                               "home": {"team": {"name": "Atlanta Braves"}, "score": 2}}}]}]}))
    out = await get_mlb_scores(date="2026-07-23", team="astros")
    assert len(out["games"]) == 1
    assert out["games"][0]["away"] == "Houston Astros"

@respx.mock
async def test_scores_no_games():
    respx.get(URL).mock(return_value=Response(200, json={"dates": []}))
    out = await get_mlb_scores(date="2026-01-01")
    assert out["games"] == []
