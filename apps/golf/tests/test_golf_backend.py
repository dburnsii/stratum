"""golf backend, called the way Stratum's proxy calls it."""
import pytest
from backend_kit import Stratum, signed, load


@pytest.fixture
async def golf(aiohttp_client, tmp_path):
    mod = load("golf")
    return await aiohttp_client(mod.make_app(str(tmp_path / "g.db"), Stratum("golf", "s3cret", "http://unused")))


async def test_golf_rejects_unsigned(golf):
    assert (await golf.get("/courses")).status == 401
    assert (await golf.get("/health")).status == 200


async def test_golf_courses_and_leaderboard(golf):
    h = lambda m, p, u="p1": signed("golf", "s3cret", m, p, u)
    courses = (await (await golf.get("/courses", headers=h("GET", "/courses"))).json())["courses"]
    assert [c["id"] for c in courses] == [1, 2, 3, 4, 5, 6]
    c1 = await (await golf.get("/courses/1", headers=h("GET", "/courses/1"))).json()
    assert c1["tee"] and c1["hole"] and len(c1["walls"]) >= 4
    for user, strokes in [("p1", 4), ("p1", 2), ("p2", 3)]:
        r = await golf.post("/scores", json={"course": 1, "strokes": strokes}, headers=h("POST", "/scores", user))
        assert r.status == 200
    board = (await (await golf.get("/leaderboard/1", headers=h("GET", "/leaderboard/1"))).json())["leaderboard"]
    assert [(r["best"], r["rounds"], r["me"]) for r in board] == [(2, 2, True), (3, 1, False)]
    bad = await golf.post("/scores", json={"course": 9, "strokes": 2}, headers=h("POST", "/scores"))
    assert bad.status == 400
