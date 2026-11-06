"""fishtank backend, called the way Stratum's proxy calls it."""
import pytest
from backend_kit import FakeBroadcast, signed, load


@pytest.fixture
async def fish(aiohttp_client, tmp_path):
    mod = load("fishtank")
    st = FakeBroadcast("fishtank")
    client = await aiohttp_client(mod.make_app(str(tmp_path / "f.json"), st, tick_s=3600))
    client.mod, client.st = mod, st
    client.tanks = client.server.app["tanks"]
    return client


def fh(method, path, user="p1"):
    return signed("fishtank", "s3cret", method, path, user)


async def test_tank_is_created_with_fish_and_plans(fish):
    t = await (await fish.get("/tanks/tank-1", headers=fh("GET", "/tanks/tank-1"))).json()
    n = sum(fish.mod.SPECIES[s]["school"] for s in fish.mod.STARTER)
    assert len(t["fish"]) == n and all(f["alive"] for f in t["fish"])
    assert len({f["species"] for f in t["fish"]}) == len(set(fish.mod.STARTER))     # a mix of kinds
    neons = [f for f in t["fish"] if f["species"] == "neon"]
    assert len(neons) == 6 and len({f["school"] for f in neons}) == 1 and all(f["plan"] == neons[0]["plan"] for f in neons)
    for f in t["fish"]:
        assert len(f["plan"]["points"]) >= 4 and f["plan"]["period"] > 0
        w, h, d = t["size"]
        for x, y, z in f["plan"]["points"]:
            assert abs(x) < w / 2 and 0 < y < h and abs(z) < d / 2   # stays inside the glass


async def test_hunger_rises_unwatched_but_fish_never_die(fish):
    await fish.get("/tanks/t", headers=fh("GET", "/tanks/t"))
    tank = fish.tanks.tanks["t"]
    tank["lastTick"] -= int(fish.mod.HUNGER_HOURS * 3_600_000 * 0.5)    # half a starvation period passes
    await fish.tanks.tick()
    assert all(0.5 <= f["hunger"] < 1 for f in tank["fish"])
    tank["lastTick"] -= int(fish.mod.HUNGER_HOURS * 3_600_000 * 5)      # and then a long time
    await fish.tanks.tick()
    assert all(f["alive"] and f["hunger"] == 1.0 for f in tank["fish"])   # starving, still swimming


async def test_old_tanks_revive_their_dead_and_get_new_kinds(fish):
    fish.tanks.tanks["old"] = {"id": "old", "created": 0, "food": [], "lastTick": fish.mod.now_ms(), "fish": [
        {"id": "a", "name": "Finn", "color": "#ff8c1a", "length": 0.05, "hunger": 1.0, "alive": False, "died": 1, "born": 0,
         "plan": {"t0": 0, "period": 40, "points": [[0, 0.1, 0]] * 4}}]}
    t = await (await fish.get("/tanks/old", headers=fh("GET", "/tanks/old"))).json()
    a = next(f for f in t["fish"] if f["id"] == "a")
    assert a["alive"] and "died" not in a and a["species"] in fish.mod.SPECIES and a["hunger"] <= 0.8
    assert {"neon", "betta", "mandarin"} <= {f["species"] for f in t["fish"]}


async def test_feeding_lowers_hunger_redirects_fish_and_broadcasts(fish):
    await fish.get("/tanks/t", headers=fh("GET", "/tanks/t"))
    before = {f["id"]: f["hunger"] for f in fish.tanks.tanks["t"]["fish"]}
    r = await fish.post("/tanks/t/feed", json={"x": 0.05, "z": 0.0}, headers=fh("POST", "/tanks/t/feed"))
    assert (await r.json())["fed"] == len(before)
    channel, msg = fish.st.sent[-1]
    assert channel == "t" and msg["type"] == "fed" and msg["food"]["x"] == 0.05
    for f in fish.tanks.tanks["t"]["fish"]:
        assert f["hunger"] == max(0, round(before[f["id"]] - 0.5, 4))
        assert any(abs(p[0] - 0.05) < 0.03 and p[1] < 0.1 for p in f["plan"]["points"])   # swims down to the food
    bad = await fish.post("/tanks/t/feed", json={"x": "nope"}, headers=fh("POST", "/tanks/t/feed"))
    assert bad.status == 400


async def test_add_fish_and_state_survives_restart(fish, aiohttp_client, tmp_path):
    await fish.get("/tanks/t", headers=fh("GET", "/tanks/t"))
    n = len(fish.tanks.tanks["t"]["fish"])
    t = await (await fish.post("/tanks/t/fish", json={"species": "betta"}, headers=fh("POST", "/tanks/t/fish"))).json()
    assert len(t["fish"]) == n + 1 and t["fish"][-1]["species"] == "betta"
    t = await (await fish.post("/tanks/t/fish", json={"species": "neon"}, headers=fh("POST", "/tanks/t/fish"))).json()
    assert len(t["fish"]) == n + 7                                    # a whole school
    bad = await fish.post("/tanks/t/fish", json={"species": "shark"}, headers=fh("POST", "/tanks/t/fish"))
    assert bad.status == 400
    again = fish.mod.Tanks(str(tmp_path / "f.json"), fish.st)          # a restart reloads the file
    assert [f["id"] for f in again.tanks["t"]["fish"]] == [f["id"] for f in t["fish"]]


async def test_temporary_tanks_expire_when_unseen(fish):
    await fish.get("/tanks/keep", headers=fh("GET", "/tanks/keep"))
    await fish.get("/tanks/tmp?temp=1", headers=fh("GET", "/tanks/tmp?temp=1"))
    fish.tanks.tanks["tmp"]["lastSeen"] -= fish.mod.TEMP_TTL_MS + 1000
    fish.tanks.tanks["keep"]["lastSeen"] -= fish.mod.TEMP_TTL_MS + 1000
    await fish.tanks.tick()
    assert "tmp" not in fish.tanks.tanks and "keep" in fish.tanks.tanks
