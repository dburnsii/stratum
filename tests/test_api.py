"""Server API: auth cookie, spaces, objects, ACL, live push, tombstones."""
import json
import uuid

import pytest

from server import make_app

IDENT = {"p": [0, 0, 0], "q": [0, 0, 0, 1]}


def uid():
    return str(uuid.uuid4())


@pytest.fixture
async def server(aiohttp_server, tmp_path):
    return await aiohttp_server(make_app(str(tmp_path / "t.db"), tmp_path / "telemetry", tmp_path / "assets"))


async def login(aiohttp_client, server, name):
    c = await aiohttp_client(server)
    r = await c.post("/api/login", json={"name": name})
    assert r.status == 200
    me = await (await c.get("/api/me")).json()
    personal = next(l["id"] for l in me["layers"] if l["kind"] == "personal")
    return c, personal


async def make_space(c, device=None):
    sid, aid, device = uid(), uid(), device or uid()
    r = await c.post("/api/spaces", json={
        "id": sid, "name": "Kitchen", "device": device,
        "anchor": {"id": aid, "pose": IDENT, "handle": "h-1"}})
    assert r.status == 200
    return sid, aid, device


async def test_requires_login(aiohttp_client, server):
    c = await aiohttp_client(server)
    assert (await c.get("/api/me")).status == 401


async def test_new_user_gets_personal_and_public_layers(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    me = await (await c.get("/api/me")).json()
    assert sorted((l["kind"], l["role"]) for l in me["layers"]) == [("personal", "admin"), ("public", "editor")]


async def test_space_lists_this_devices_binding_only(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    sid, aid, device = await make_space(c)
    mine = (await (await c.get(f"/api/spaces?device={device}")).json())["spaces"]
    other = (await (await c.get(f"/api/spaces?device={uid()}")).json())["spaces"]
    assert mine[0]["anchors"][0]["handle"] == "h-1"
    assert other[0]["anchors"][0]["handle"] is None


async def test_object_put_push_delete_tombstone(aiohttp_client, server):
    c, personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(c)
    ws = await c.ws_connect("/ws")
    assert (await ws.receive_json())["t"] == "hello"
    await ws.send_json({"t": "sub", "spaces": [sid]})
    assert (await ws.receive_json())["spaces"] == [sid]

    oid = uid()
    r = await c.put(f"/api/objects/{oid}", json={
        "space": sid, "layer": personal, "pose": {"p": [1, 0.8, 0], "q": [0, 0, 0, 1]},
        "components": {"mesh": {"primitive": "box"}}})
    assert r.status == 200
    pushed = (await ws.receive_json(timeout=2))["object"]
    assert pushed["id"] == oid and not pushed["deleted"]

    assert (await c.delete(f"/api/objects/{oid}")).status == 204
    assert (await ws.receive_json(timeout=2))["object"]["deleted"] is True

    full = (await (await c.get(f"/api/objects?space={sid}")).json())["objects"]
    delta = (await (await c.get(f"/api/objects?space={sid}&since={pushed['rev']}")).json())["objects"]
    assert full == []                                   # full sync skips tombstones
    assert [o["deleted"] for o in delta] == [True]      # delta sync includes them
    await ws.close()


async def test_other_user_cannot_see_or_touch(aiohttp_client, server):
    alice, personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    oid = uid()
    await alice.put(f"/api/objects/{oid}", json={"space": sid, "layer": personal, "pose": IDENT, "components": {}})

    eve, eve_personal = await login(aiohttp_client, server, "eve")
    assert (await eve.get(f"/api/objects?space={sid}")).status == 403
    assert (await eve.delete(f"/api/objects/{oid}")).status == 404
    r = await eve.put(f"/api/objects/{uid()}", json={"space": sid, "layer": eve_personal, "pose": IDENT, "components": {}})
    assert r.status == 403


async def test_rejects_bad_input(aiohttp_client, server):
    c, personal = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(c)
    bad_pose = await c.put(f"/api/objects/{uid()}", json={"space": sid, "layer": personal, "pose": {"p": [1]}})
    bad_id = await c.put("/api/objects/not-a-uuid", json={"space": sid, "layer": personal, "pose": IDENT})
    bad_name = await c.post("/api/login", json={"name": "no spaces allowed"})
    assert (bad_pose.status, bad_id.status, bad_name.status) == (400, 400, 400)


def read_telemetry(server):
    d = server.app["telemetry"].dir
    return [json.loads(l) for f in sorted(d.glob("*.jsonl")) for l in f.read_text().splitlines()]


async def test_telemetry_needs_no_login_and_tags_user_when_known(aiohttp_client, server):
    anon = await aiohttp_client(server)
    r = await anon.post("/api/telemetry", json={"ctx": {"page": "/probe", "version": "v9"},
                                                "events": [{"t": 1, "level": "error", "msg": "boom", "data": {"x": 1}}]})
    assert (await r.json())["stored"] == 1
    alice, _ = await login(aiohttp_client, server, "alice")
    await alice.post("/api/telemetry", json={"events": [{"msg": "hi", "level": "nonsense"}]})
    rows = read_telemetry(server)
    assert [(r["level"], r["msg"], r["user"], r.get("ver")) for r in rows] == [
        ("error", "boom", None, "v9"), ("info", "hi", "alice", "")]
    assert rows[0]["data"] == {"x": 1} and rows[0]["page"] == "/probe"


async def test_telemetry_caps_and_rejects_garbage(aiohttp_client, server):
    c = await aiohttp_client(server)
    r = await c.post("/api/telemetry", json={"events": [{"msg": "x"}] * 500})
    assert (await r.json())["stored"] == 200                    # per-post cap
    await c.post("/api/telemetry", json={"events": [{"msg": "y" * 5000}]})
    assert len(read_telemetry(server)[-1]["msg"]) == 2000       # message cap
    huge = await c.post("/api/telemetry", json={"events": [{"msg": "z" * 1000}] * 600})
    assert huge.status in (400, 413)                            # body size cap
    assert (await c.post("/api/telemetry", data="not json")).status == 400
    assert (await c.post("/api/telemetry", json=[1, 2])).status == 400


async def test_server_exceptions_are_recorded(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    def explode(_uid):
        raise RuntimeError("db on fire")
    server.app["store"].get_user = explode
    assert (await c.get("/api/me")).status == 500
    [row] = [r for r in read_telemetry(server) if r["src"] == "server"]
    assert row["msg"] == "RuntimeError: db on fire" and "Traceback" in row["data"]["trace"]


# ---- markers -------------------------------------------------------------------

MARKER = {"tag": 0, "size": 0.1, "pose": IDENT}


async def test_space_from_marker_and_lookup(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    sid = uid()
    r = await c.post("/api/spaces", json={"id": sid, "name": "Table", "marker": MARKER})
    assert r.status == 200
    spaces = (await (await c.get(f"/api/spaces?device={uid()}")).json())["spaces"]
    assert spaces[0]["markers"] == [{"family": "tag36h11", "tag": 0, "size": 0.1,
                                     "pose": {"p": [0, 0, 0], "q": [0, 0, 0, 1], "s": [1, 1, 1]}}]
    # Second marker in the same space, at a known offset.
    r = await c.post("/api/markers", json={"space": sid, "marker": {"tag": 1, "size": 0.1,
                                                                    "pose": {"p": [0.5, 0, 0], "q": [0, 0, 0, 1]}}})
    assert r.status == 200
    spaces = (await (await c.get(f"/api/spaces?device={uid()}")).json())["spaces"]
    assert [m["tag"] for m in spaces[0]["markers"]] == [0, 1]


async def test_tag_names_one_space_per_user(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    first = uid()
    await alice.post("/api/spaces", json={"id": first, "name": "A", "marker": MARKER})
    r = await alice.post("/api/spaces", json={"id": uid(), "name": "B", "marker": MARKER})
    assert r.status == 409 and (await r.json())["space"] == first
    eve, _ = await login(aiohttp_client, server, "eve")          # other users have their own tag namespace
    assert (await eve.post("/api/spaces", json={"id": uid(), "name": "E", "marker": MARKER})).status == 200


async def test_space_needs_anchor_or_marker_and_valid_marker(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    assert (await c.post("/api/spaces", json={"id": uid(), "name": "X"})).status == 400
    for bad_marker in [{"tag": 9999, "size": 0.1, "pose": IDENT}, {"tag": 1, "size": 5, "pose": IDENT},
                       {"tag": "0", "size": 0.1, "pose": IDENT}]:
        r = await c.post("/api/spaces", json={"id": uid(), "name": "X", "marker": bad_marker})
        assert r.status == 400, bad_marker


async def test_markers_only_in_my_spaces(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid = uid()
    await alice.post("/api/spaces", json={"id": sid, "name": "A", "marker": MARKER})
    eve, _ = await login(aiohttp_client, server, "eve")
    r = await eve.post("/api/markers", json={"space": sid, "marker": {**MARKER, "tag": 5}})
    assert r.status == 403


# ---- assets --------------------------------------------------------------------

PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d4e1ab0000000049454e44ae426082")
GLB = b"glTF" + (2).to_bytes(4, "little") + (12).to_bytes(4, "little")


async def test_upload_dedupes_sniffs_and_serves(aiohttp_client, server):
    import hashlib
    c, _ = await login(aiohttp_client, server, "alice")
    r = await c.post("/api/assets?name=dot.png&w=1&h=1", data=PNG)
    a = (await r.json())["asset"]
    assert a["hash"] == hashlib.sha256(PNG).hexdigest()
    assert (a["kind"], a["mime"], a["width"], a["name"]) == ("image", "image/png", 1, "dot.png")
    again = (await (await c.post("/api/assets?name=copy.png", data=PNG)).json())["asset"]
    assert again["hash"] == a["hash"]                                # same bytes, one asset
    files = [p for p in server.app["assets_dir"].rglob("*") if p.is_file()]
    assert len(files) == 1
    got = await c.get(f"/assets/{a['hash']}")
    assert got.headers["Content-Type"] == "image/png" and "immutable" in got.headers["Cache-Control"]
    assert await got.read() == PNG
    model = (await (await c.post("/api/assets?name=ball.glb", data=GLB)).json())["asset"]
    assert model["kind"] == "model"
    lib = (await (await c.get("/api/assets")).json())["assets"]
    assert {x["name"] for x in lib} == {"copy.png", "ball.glb"}      # latest name wins in my library


async def test_upload_rejects_unknown_and_needs_login(aiohttp_client, server):
    c, _ = await login(aiohttp_client, server, "alice")
    assert (await c.post("/api/assets?name=x.exe", data=b"MZ\x90\x00 not allowed")).status == 400
    assert (await c.post("/api/assets", data=b"")).status == 400
    anon = await aiohttp_client(server)
    assert (await anon.post("/api/assets", data=PNG)).status == 401
    assert (await anon.get("/assets/" + "0" * 64)).status == 401
    assert (await c.get("/assets/" + "0" * 64)).status == 404
    assert (await c.get("/assets/../../etc/passwd")).status in (400, 404)
    leftovers = [p for p in server.app["assets_dir"].rglob(".upload-*")]
    assert leftovers == []
