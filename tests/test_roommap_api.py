"""Room map API: a Space's surfaces, members only, live push. DESIGN.md §3.8."""
from test_api import IDENT, login, make_space, server, uid  # noqa: F401
from test_sharing import invite_and_join, ws_in, next_of

RECT = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
WALL = {"p": [0, 1.2, -2], "q": [0.7071068, 0, 0, 0.7071068], "s": [1, 1, 1]}    # local +Y → +Z: facing the room
TABLE = {"p": [0, 0.75, -1], "q": [0, 0, 0, 1], "s": [1, 1, 1]}


def surface(kind="wall", **kw):
    return {"kind": kind, "pose": WALL if kind == "wall" else TABLE, "polygon": RECT, "source": "phone", **kw}


async def surfaces_of(client, sid):
    return (await (await client.get(f"/api/spaces/{sid}/surfaces")).json())["surfaces"]


async def test_surfaces_upsert_list_and_clear(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    a, b = uid(), uid()
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{a}", json=surface("wall"))).status == 200
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{b}", json=surface("table"))).status == 200
    got = await surfaces_of(alice, sid)
    assert sorted(s["kind"] for s in got) == ["table", "wall"]
    wall_id = next(s["id"] for s in got if s["kind"] == "wall")
    wider = [[-1, -0.5], [1, -0.5], [1, 0.5], [-1, 0.5]]
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{a}", json=surface("wall", polygon=wider))).status == 200   # update
    got = await surfaces_of(alice, sid)
    wall = next(s for s in got if s["kind"] == "wall")
    assert wall["id"] == wall_id                                    # same surface, refined
    xs = [p[0] for p in wall["polygon"]]
    assert max(xs) - min(xs) > 1.9
    table_id = next(s["id"] for s in got if s["kind"] == "table")
    assert (await alice.delete(f"/api/spaces/{sid}/surfaces?id={table_id}")).status == 204
    assert [s["kind"] for s in await surfaces_of(alice, sid)] == ["wall"]
    assert (await alice.delete(f"/api/spaces/{sid}/surfaces")).status == 204
    assert await surfaces_of(alice, sid) == []


async def test_replace_by_source_keeps_other_sources(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface("table"))

    def wall_at(x):
        return {**surface("wall", id=uid(), source="quest"), "pose": {**WALL, "p": [x, 1.2, -2]}}
    for n in (3, 2):   # a second Quest import replaces the first
        r = await alice.post(f"/api/spaces/{sid}/surfaces/replace",
                            json={"source": "quest", "surfaces": [wall_at(3 * i) for i in range(n)]})
        assert r.status == 200
    got = await surfaces_of(alice, sid)
    assert sorted((s["source"], s["kind"]) for s in got) == [("phone", "table"), ("quest", "wall"), ("quest", "wall")]


async def test_observations_merge_across_users(aiohttp_client, server):
    """Two people see the same wall and table: one surface each, both credited;
    the headset's room scan names the table (a couch, here) over a phone's guess."""
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface("wall"))
    await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface("table"))
    nudged_wall = {**WALL, "p": [0.6, 1.2, -1.98]}                  # 2 cm off, overlapping
    nudged_top = {**TABLE, "p": [0.3, 0.77, -1]}
    r = await eve.post(f"/api/spaces/{sid}/surfaces/replace", json={"source": "quest", "device": "eves-quest", "surfaces": [
        {"id": uid(), "kind": "wall", "pose": nudged_wall, "polygon": RECT, "source": "quest"},
        {"id": uid(), "kind": "couch", "pose": nudged_top, "polygon": RECT, "source": "quest"}]})
    assert r.status == 200
    got = await surfaces_of(alice, sid)
    assert sorted(s["kind"] for s in got) == ["couch", "wall"]
    for s in got:
        assert s["sources"] == ["phone", "quest"] and s["users"] == 2
    wall = next(s for s in got if s["kind"] == "wall")
    xs = [p[0] for p in wall["polygon"]]
    assert max(xs) - min(xs) > 1.5                                   # both outlines
    assert -2.0 < wall["pose"]["p"][2] < -1.98                       # weighted toward the scan


async def test_members_only_validation_and_push(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    eve, _ = await login(aiohttp_client, server, "eve")
    assert (await eve.get(f"/api/spaces/{sid}/surfaces")).status == 403
    assert (await eve.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface())).status == 403
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface("lava"))).status == 400
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface(polygon=[[0, 0]]))).status == 400
    await invite_and_join(alice, eve, sid)
    we, _ = await ws_in(eve, sid)
    assert (await alice.put(f"/api/spaces/{sid}/surfaces/{uid()}", json=surface())).status == 200
    assert (await next_of(we, "surfaces"))["space"] == sid          # members refetch the map
    await we.close()
    # An observation id can't hop between spaces, or be taken over by someone else.
    other, _, _ = await make_space(alice)
    s_id = uid()
    await alice.put(f"/api/spaces/{sid}/surfaces/{s_id}", json=surface())
    assert (await alice.put(f"/api/spaces/{other}/surfaces/{s_id}", json=surface())).status == 409
    assert (await eve.put(f"/api/spaces/{sid}/surfaces/{s_id}", json=surface())).status == 409
