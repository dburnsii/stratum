"""home backend, called the way Stratum's proxy calls it."""
import asyncio

import pytest
from backend_kit import FakeBroadcast, signed, load


@pytest.fixture
async def home(aiohttp_client, aiohttp_server):
    import fake_ha
    ha_app = fake_ha.make_app()
    ha_srv = await aiohttp_server(ha_app)
    mod = load("home")
    st = FakeBroadcast("home")
    client = await aiohttp_client(mod.make_app(st, str(ha_srv.make_url("")), fake_ha.TOKEN, {"alice"}))
    client.st, client.ha_app, client.mod = st, ha_app, mod
    await asyncio.wait_for(client.server.app["ha"].ready.wait(), 5)
    yield client
    await client.close()   # before the fake HA server, or its shutdown waits on our open WebSocket


def hh(method, path, name="alice"):
    return signed("home", "s3cret", method, path, "p1", name)


async def test_home_lists_usable_entities_by_area_without_diagnostics_or_locks(home):
    r = await home.get("/entities", headers=hh("GET", "/entities"))
    ents = (await r.json())["entities"]
    ids = [e["id"] for e in ents]
    assert "button.kitchen_ping" not in ids and "lock.front_door" not in ids   # diagnostic; not an allowed domain
    k = next(e for e in ents if e["id"] == "light.kitchen")
    assert k["area"] == "Kitchen" and k["name"] == "Kitchen Lights" and "toggle" in k["actions"]   # area via its device
    assert next(e for e in ents if e["id"] == "sensor.living_temp")["attrs"]["unit_of_measurement"] == "°C"


async def test_home_only_for_allowed_users_and_allowed_actions(home):
    r = await home.get("/entities", headers=hh("GET", "/entities", name="mallory"))
    assert r.status == 403 and "HOME_USERS" in await r.text()
    bad = await home.post("/call", json={"entity": "sensor.living_temp", "action": "toggle"}, headers=hh("POST", "/call"))
    assert bad.status == 400
    bad = await home.post("/call", json={"entity": "lock.front_door", "action": "unlock"}, headers=hh("POST", "/call"))
    assert bad.status == 400
    assert home.ha_app["calls"] == []


async def test_home_toggle_calls_ha_and_watched_changes_broadcast(home):
    path = "/states?ids=light.kitchen"
    s = (await (await home.get(path, headers=hh("GET", path))).json())["states"]["light.kitchen"]
    assert s["state"] == "off"                                         # fetching it also watches it
    r = await home.post("/call", json={"entity": "light.kitchen", "action": "toggle"}, headers=hh("POST", "/call"))
    assert r.status == 200
    assert home.ha_app["calls"] == [("light", "toggle", "light.kitchen", {})]
    for _ in range(50):
        if home.st.sent:
            break
        await asyncio.sleep(0.02)
    channel, msg = home.st.sent[-1]
    assert channel == "e-light.kitchen" and msg["entity"]["state"] == "on"
    # An unwatched entity changing (someone flips it at the wall) isn't broadcast.
    home.ha_app["states"]["switch.fan_plug"]["state"] = "off"
    await home.ha_app["emit"]("switch.fan_plug")
    await asyncio.sleep(0.1)
    assert all(c != "e-switch.fan_plug" for c, _ in home.st.sent)
    # Brightness steps are clamped and passed through.
    await home.post("/call", json={"entity": "light.kitchen", "action": "turn_on", "brightness_step_pct": 500}, headers=hh("POST", "/call"))
    assert home.ha_app["calls"][-1] == ("light", "turn_on", "light.kitchen", {"brightness_step_pct": 100})
