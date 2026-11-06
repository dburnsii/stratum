"""Sharing a Space: invites, joining, the shared layer, live push across
users, presence relay. DESIGN.md §5.1."""
import time

from test_api import IDENT, login, make_space, server, uid  # noqa: F401  (server is a fixture)


async def spaces(c, device=None):
    return (await (await c.get(f"/api/spaces?device={device or uid()}")).json())["spaces"]


async def invite_and_join(owner, guest, sid):
    code = (await (await owner.post(f"/api/spaces/{sid}/invite")).json())["code"]
    assert len(code) == 6
    r = await guest.post("/api/join", json={"code": code.lower()})   # codes are case-insensitive
    assert r.status == 200 and (await r.json())["space"] == sid
    return code


async def put(c, sid, layer, oid=None, pose=IDENT):
    oid = oid or uid()
    r = await c.put(f"/api/objects/{oid}", json={"space": sid, "layer": layer, "pose": pose, "components": {"mesh": {"primitive": "box"}}})
    assert r.status == 200, await r.text()
    return oid


async def test_every_space_has_a_shared_layer_listed_with_members(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    [s] = await spaces(alice)
    assert s["owner"] and s["members"] == ["alice"] and s["sharedLayer"]
    me = await (await alice.get("/api/me")).json()
    assert any(l["id"] == s["sharedLayer"] and l["kind"] == "shared" and l["role"] == "admin" for l in me["layers"])


async def test_joined_member_sees_shared_objects_but_not_private_ones(aiohttp_client, server):
    alice, alice_personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    shared = (await spaces(alice))[0]["sharedLayer"]
    shared_obj = await put(alice, sid, shared)
    private_obj = await put(alice, sid, alice_personal)

    eve, _ = await login(aiohttp_client, server, "eve")
    assert (await eve.get(f"/api/objects?space={sid}")).status == 403   # not a member yet
    await invite_and_join(alice, eve, sid)
    [s] = await spaces(eve)
    assert s["id"] == sid and not s["owner"] and s["members"] == ["alice", "eve"] and s["sharedLayer"] == shared
    seen = {o["id"] for o in (await (await eve.get(f"/api/objects?space={sid}")).json())["objects"]}
    assert seen == {shared_obj}                                          # never alice's private cube
    # Members can edit shared things, not each other's private ones.
    await put(eve, sid, shared, oid=shared_obj, pose={"p": [1, 0, 0], "q": [0, 0, 0, 1]})
    r = await eve.put(f"/api/objects/{private_obj}", json={"space": sid, "layer": shared, "pose": IDENT, "components": {}})
    assert r.status == 403


async def test_shared_changes_push_live_to_other_members_and_unsharing_hides(aiohttp_client, server):
    alice, alice_personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    shared = (await spaces(alice))[0]["sharedLayer"]
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    ws = await eve.ws_connect("/ws")
    assert (await ws.receive_json())["t"] == "hello"
    await ws.send_json({"t": "sub", "spaces": [sid]})
    assert (await ws.receive_json())["spaces"] == [sid]

    oid = await put(alice, sid, shared)
    assert (await ws.receive_json(timeout=2))["object"]["id"] == oid
    await put(alice, sid, alice_personal, oid=oid)                         # alice makes it private again
    gone = (await ws.receive_json(timeout=2))["object"]
    assert gone["id"] == oid and gone["deleted"]                         # eve sees it leave
    await ws.close()


async def test_presence_relays_to_other_people_in_the_space(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    wd, we = await alice.ws_connect("/ws"), await eve.ws_connect("/ws")
    for ws in (wd, we):
        await ws.receive_json()
        await ws.send_json({"t": "sub", "spaces": [sid]})
        await ws.receive_json()
    await wd.send_json({"t": "pose", "space": sid, "p": [1, 1.6, 0], "q": [0, 0, 0, 1]})
    await wd.send_json({"t": "pose", "space": uid(), "p": [1, 1.6, 0], "q": [0, 0, 0, 1]})   # not subscribed: ignored
    msg = await we.receive_json(timeout=2)
    assert msg["t"] == "pose" and msg["name"] == "alice" and msg["p"] == [1, 1.6, 0]
    await wd.close()
    assert (await we.receive_json(timeout=2))["t"] == "gone"
    await we.close()


async def test_bad_or_expired_codes_and_tag_conflicts(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid = uid()
    marker = {"tag": 3, "size": 0.1, "pose": IDENT}
    assert (await alice.post("/api/spaces", json={"id": sid, "name": "Den", "marker": marker})).status == 200
    eve, _ = await login(aiohttp_client, server, "eve")
    assert (await eve.post("/api/join", json={"code": "NOPE42"})).status == 404
    # eve already uses tag 3 for her own space: joining alice's would make tag 3 ambiguous.
    assert (await eve.post("/api/spaces", json={"id": uid(), "name": "Mine", "marker": marker})).status == 200
    code = (await (await alice.post(f"/api/spaces/{sid}/invite")).json())["code"]
    r = await eve.post("/api/join", json={"code": code})
    assert r.status == 409 and "tag 3" in (await r.json())["error"]
    # Expired.
    st = server.app["store"]
    st.db.execute("UPDATE space_invites SET expires_at = ? WHERE code = ?", (int(time.time() * 1000) - 1, code))
    frank, _ = await login(aiohttp_client, server, "frank")
    assert (await frank.post("/api/join", json={"code": code})).status == 404
    # Only members can invite; owners can't leave, members can.
    assert (await frank.post(f"/api/spaces/{sid}/invite")).status == 403
    assert (await alice.post(f"/api/spaces/{sid}/leave")).status == 400


async def test_member_can_leave_and_loses_access(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    assert (await eve.post(f"/api/spaces/{sid}/leave")).status == 204
    assert (await eve.get(f"/api/objects?space={sid}")).status == 403
    assert (await spaces(eve)) == []


async def ws_in(c, sid=None):
    ws = await c.ws_connect("/ws")
    hello = await ws.receive_json()
    if sid:
        await ws.send_json({"t": "sub", "spaces": [sid]})
        assert (await ws.receive_json())["t"] == "subbed"
    return ws, hello["you"]


async def next_of(ws, t):
    while True:
        m = await ws.receive_json(timeout=2)
        if m["t"] == t:
            return m


async def test_app_rooms_elect_a_host_and_hand_over_when_it_leaves(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    eve, _ = await login(aiohttp_client, server, "eve")
    for c in (alice, eve):
        assert (await c.put("/api/apps/golf", json={"enabled": True})).status == 200
    room = [{"app": "golf", "channel": "sync-x"}]
    wd, alice_id = await ws_in(alice)
    await wd.send_json({"t": "appsub", "channels": room})
    h = await next_of(wd, "host")
    assert h["host"] == alice_id and h["peers"] == 1
    we, eve_id = await ws_in(eve)
    await we.send_json({"t": "appsub", "channels": room})
    for ws in (wd, we):                                  # both told: alice hosts, 2 in the room
        h = await next_of(ws, "host")
        assert h["host"] == alice_id and h["peers"] == 2
    await wd.close()                                     # host leaves → eve takes over
    h = await next_of(we, "host")
    assert h["host"] == eve_id and h["peers"] == 1
    await we.close()


async def test_live_moves_reach_only_people_who_can_see_the_object(aiohttp_client, server):
    alice, alice_personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    shared = (await spaces(alice))[0]["sharedLayer"]
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    wd, _ = await ws_in(alice, sid)
    we, _ = await ws_in(eve, sid)
    pose = {"p": [0.5, 0, 0], "q": [0, 0, 0, 1], "s": [1, 1, 1]}
    await wd.send_json({"t": "move", "id": "private-1", "space": sid, "layer": alice_personal, "pose": pose})
    await wd.send_json({"t": "move", "id": "shared-1", "space": sid, "layer": shared, "pose": pose})
    m = await next_of(we, "move")
    assert m["id"] == "shared-1" and m["pose"]["p"] == [0.5, 0, 0]   # the private one never arrived first
    await wd.close()
    await we.close()


async def test_the_owner_deletes_a_space_for_everyone_others_cannot(aiohttp_client, server):
    alice, alice_personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    shared = (await spaces(alice))[0]["sharedLayer"]
    await put(alice, sid, shared)
    await put(alice, sid, alice_personal)
    eve, _ = await login(aiohttp_client, server, "eve")
    await invite_and_join(alice, eve, sid)
    ws, _ = await ws_in(eve, sid)
    assert (await eve.delete(f"/api/spaces/{sid}")).status == 403                 # not hers: she can only leave
    assert (await alice.delete(f"/api/spaces/{uid()}")).status == 404
    assert (await alice.delete(f"/api/spaces/{sid}")).status == 204
    assert (await next_of(ws, "members"))["space"] == sid                         # her devices hear it and re-read
    assert await spaces(alice) == [] and await spaces(eve) == []
    assert (await alice.get(f"/api/objects?space={sid}")).status == 403            # its things went with it
    me = await (await alice.get("/api/me")).json()
    assert not any(l["id"] == shared for l in me["layers"])                       # and its shared layer
    assert (await alice.get(f"/api/spaces/{sid}/surfaces")).status == 403


async def test_a_space_shared_layer_only_holds_that_space_s_things(aiohttp_client, server):
    """Deleting a Space deletes its shared layer's objects: one saved in another
    Space on that layer would go too, so it's refused (a move must switch layers)."""
    alice, _ = await login(aiohttp_client, server, "alice")
    a, _, _ = await make_space(alice)
    b, _, _ = await make_space(alice)
    ls = {s["id"]: s["sharedLayer"] for s in await spaces(alice)}
    oid = await put(alice, a, ls[a])
    r = await alice.put(f"/api/objects/{oid}", json={"space": b, "layer": ls[a], "pose": IDENT, "components": {"mesh": {"primitive": "box"}}})
    assert r.status == 400 and "another space" in await r.text()
    await put(alice, b, ls[b], oid)                                                 # moved properly: B's layer
    assert (await alice.delete(f"/api/spaces/{a}")).status == 204
    objs = (await (await alice.get(f"/api/objects?space={b}")).json())["objects"]
    assert [o["id"] for o in objs if not o["deleted"]] == [oid]                  # survived A's deletion
