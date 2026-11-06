"""plants backend, called the way Stratum's proxy calls it."""
import pytest
from backend_kit import FakeBroadcast, signed, load


@pytest.fixture
async def plants(aiohttp_client, tmp_path):
    mod = load("plants")
    st = FakeBroadcast("plants")
    client = await aiohttp_client(mod.make_app(str(tmp_path / "p.json"), st, cleanup_s=3600))
    client.mod, client.st = mod, st
    client.garden = client.server.app["garden"]
    return client


def ph(method, path, user="p1"):
    return signed("plants", "s3cret", method, path, user)


async def get_plant(plants, pid, qs=""):
    path = f"/plants/{pid}{qs}"
    return await (await plants.get(path, headers=ph("GET", path))).json()


def hours_pass(plants, pid, hours):
    plants.garden.plants[pid]["updated"] -= int(hours * 3_600_000)


async def test_plant_is_created_with_the_requested_species(plants):
    p = await get_plant(plants, "pl-1", "?species=snake")
    assert p["species"] == "snake" and p["name"] == "Snake plant" and p["alive"]
    assert p["growth"] == plants.mod.SEEDLING and p["stage"] == "young"
    assert (await get_plant(plants, "pl-2", "?species=bogus"))["species"] == "pothos"   # unknown → default
    assert (await get_plant(plants, "pl-1", "?species=pothos"))["species"] == "snake"   # species is fixed once planted


async def test_watered_plants_grow_and_dry_plants_wilt_then_die(plants):
    await get_plant(plants, "p", "?species=pothos")
    sp = plants.mod.SPECIES["pothos"]
    hours_pass(plants, "p", 24)                                           # a day, soil still wet: grows
    p = await get_plant(plants, "p")
    assert p["growth"] > plants.mod.SEEDLING and p["health"] == 1 and p["moisture"] < 0.8
    hours_pass(plants, "p", sp["dry_hours"])                              # dried out, then dry for a while
    p = await get_plant(plants, "p")
    assert p["moisture"] == 0 and p["health"] < 1 and p["thirsty"]
    grown = p["growth"]
    hours_pass(plants, "p", sp["wilt_hours"])                             # bone dry too long: dead
    p = await get_plant(plants, "p")
    assert not p["alive"] and p["health"] == 0 and p["growth"] == grown  # no growth while dry


async def test_watering_adds_moisture_broadcasts_and_cannot_revive(plants):
    await get_plant(plants, "p", "?species=succulent")
    r = await plants.post("/plants/p/water", headers=ph("POST", "/plants/p/water"))
    p = await r.json()
    assert p["moisture"] > 1.0 and p["waterings"] == 1                    # 0.8 + 0.6: soggy
    assert plants.st.sent[-1][0] == "p" and plants.st.sent[-1][1]["type"] == "watered"
    plants.garden.plants["p"].update(alive=False, health=0)
    p = await (await plants.post("/plants/p/water", headers=ph("POST", "/plants/p/water"))).json()
    assert not p["alive"] and p["waterings"] == 1
    p = await (await plants.post("/plants/p/replant", json={}, headers=ph("POST", "/plants/p/replant"))).json()
    assert p["alive"] and p["species"] == "succulent" and p["growth"] == plants.mod.SEEDLING
    assert plants.st.sent[-1][1]["type"] == "replanted"


async def test_temporary_plants_expire_when_unseen(plants):
    await get_plant(plants, "t", "?temp=1")
    await get_plant(plants, "keep")
    for p in plants.garden.plants.values():
        p["lastSeen"] -= plants.mod.TEMP_TTL_MS + 1000
    assert plants.garden.expire() == ["t"] and "keep" in plants.garden.plants


async def test_plant_requests_must_be_signed(plants):
    r = await plants.get("/plants/x")
    assert r.status == 401
    r = await plants.get("/plants/bad id!", headers=ph("GET", "/plants/bad id!"))
    assert r.status in (400, 401)
