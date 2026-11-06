"""Living world map (DESIGN.md §3.10): fusing depth keyframes into voxels,
finding surfaces, noticing changes, aligning sessions to the map, merging
across users; and its API. Uses a synthetic room (tests/maproom.py)."""
import math
import time

import numpy as np
import pytest

from maproom import Box, Room, tour
from mapping import engine, geometry, keyframe, planes, voxels
from mapping.service import contradicted
from test_api import login, make_space, server, uid  # noqa: F401
from test_sharing import invite_and_join, next_of, ws_in


class Space:
    """A map directory fed like the service feeds it."""
    def __init__(self, tmp_path):
        self.dir = tmp_path / "space"
        (self.dir / "kf").mkdir(parents=True)
        self.n = 0

    def items(self, room, cams, session, offset=None, at=None):
        out = []
        for p, look in cams:
            h, depth = room.keyframe(p, look, session=session, offset=offset, at=at)
            kid = f"k{self.n:05d}"
            self.n += 1
            (self.dir / "kf" / f"{kid}.bin").write_bytes(keyframe.encode(h, depth))
            out.append({"id": kid, "kind": "depth", "session": session, "at": h["at"], "quality": 1.0})
        return out

    def fuse(self, items, now_s=None):
        return engine.fuse(str(self.dir), items, now_s)


def by_kind(found):
    out = {}
    for p in found:
        out.setdefault(p["kind"], []).append(p)
    return out


def height(p):
    return geometry.pose_to_matrix(p["pose"])[1, 3]


def test_keyframe_round_trip_and_validation():
    room = Room()
    h, depth = room.keyframe([0, 1.5, 0], [0, 0.8, -2])
    h2, d2 = keyframe.parse(keyframe.encode(h, depth))
    assert h2["session"] == h["session"] and (d2 == depth).all()
    origin, pts, _ = keyframe.unproject(h2, d2)
    assert np.allclose(origin, [0, 1.5, 0])
    assert abs(np.percentile(pts[:, 1], 1)) < 0.02                  # floor at 0
    for bad in (b"nope", keyframe.encode({**h, "w": 999}, depth), keyframe.encode({**h, "source": "x"}, depth),
                keyframe.encode({**h, "pose": [0] * 15}, depth), keyframe.encode(h, depth[:-1])):
        with pytest.raises(keyframe.BadKeyframe):
            keyframe.parse(bad)


def test_masks_the_users_own_body_and_hands():
    room = Room()
    h, depth = room.keyframe([0, 1.5, 0], [0, 0, -0.3])               # looking at your feet
    _, pts, _ = keyframe.unproject(h, depth)
    near = np.hypot(pts[:, 0], pts[:, 2]) < 0.3
    assert not (near & (pts[:, 1] < 1.2)).any()
    h, depth = room.keyframe([0, 1.5, 0], [0, 0.8, -2])
    _, before, _ = keyframe.unproject(h, depth)
    _, after, _ = keyframe.unproject({**h, "hands": [[0, 0.02, -2.3]]}, depth)
    assert len(after) < len(before) and np.min(np.linalg.norm(after - [0, 0.02, -2.3], axis=1)) > 0.11


def test_fuses_a_room_into_surfaces(tmp_path):
    sp, room = Space(tmp_path), Room()
    r = sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    assert r["stats"]["occupied"] > 10000 and r["stats"]["keyframes"] == 40
    e = engine.extract(str(sp.dir))
    k = by_kind(e["planes"])
    assert abs(max(k["floor"], key=lambda p: p["area"])["area"] - 16) < 4   # most of the 4 × 5 m floor
    assert abs(height(max(k["floor"], key=lambda p: p["area"]))) < 0.01
    assert any(abs(height(p) - 0.75) < 0.015 for p in k["table"])
    assert any(abs(height(p) - 0.92) < 0.015 for p in k["counter"])
    assert any(abs(height(p) - 0.45) < 0.015 for p in k["couch"])
    walls = [geometry.pose_to_matrix(p["pose"]) for p in k["wall"]]
    for x, z in ((2, 0), (-2, 0), (0, 2.5), (0, -2.5)):              # all four walls, facing in
        assert any(abs(m[0, 3] * abs(x) / 2 - x) < 0.02 if x else abs(m[2, 3] - z) < 0.02 for m in walls), (x, z)
        n = next(m[:3, 1] for m in walls if (abs(m[0, 3] - x) < 0.05 if x else abs(m[2, 3] - z) < 0.05))
        assert np.dot(n, [-np.sign(x), 0, -np.sign(z)]) > 0.99
    # Voxel layers follow: walls/floor are structure, furniture tops furniture.
    st = engine.stats_of(engine.state(str(sp.dir)), time.time())
    assert st["layers"]["structure"] > 5000 and st["layers"]["furniture"] > 1000


def test_notices_a_cup_appear_and_go(tmp_path):
    sp, room = Space(tmp_path), Room()
    t0 = time.time() - 3600
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001", at=int(t0 * 1000)), now_s=t0)
    engine.extract(str(sp.dir), now_s=t0)                              # walls/floor/counter get their layers
    room.boxes.append(Box([-1.75, 0.92, 1.4], [-1.67, 1.02, 1.48], "cup"))
    look = [([-0.6, 1.5, 1.4 + dz], [-1.7, 0.95, 1.44]) for dz in (-0.4, -0.2, 0, 0.2, 0.4)]
    r = sp.fuse(sp.items(room, look, "sess-b-00000002"))
    assert len(r["changes"]) == 1
    c = r["changes"][0]
    assert c["type"] == "appeared" and np.allclose(c["center"], [-1.71, 0.97, 1.44], atol=0.04)
    engine.extract(str(sp.dir))
    # Picked up: gone by the second snapshot, from where you stand, without moving.
    room.boxes.pop()
    changes = []
    for _ in range(2):
        changes += sp.fuse(sp.items(room, [look[2]], "sess-b-00000002"))["changes"]
    assert [c["type"] for c in changes] == ["gone"]
    assert np.allclose(changes[0]["center"], [-1.71, 0.97, 1.44], atol=0.05)
    # The counter under it is still there.
    e = engine.extract(str(sp.dir))
    assert any(p["kind"] == "counter" and abs(height(p) - 0.92) < 0.015 for p in e["planes"])


def test_moved_furniture_clears_fast_walls_hold(tmp_path):
    """A table carried away: gone from the map within 2 snapshots of looking
    at where it was. A wall needs more than one bad frame."""
    sp, room = Space(tmp_path), Room()
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    engine.extract(str(sp.dir))
    st = engine.state(str(sp.dir))
    top = voxels.keys_of(np.array([[0.0, 0.74, -0.5], [0.3, 0.74, -0.3]]))
    assert len(np.intersect1d(st.vox.keys[st.vox.occupied(time.time())], top)) == 2
    room.boxes = [b for b in room.boxes if not b.name.startswith("table")]
    view = [([0, 1.5, 0.6], [0, 0.0, -1.2])]
    for _ in range(2):
        sp.fuse(sp.items(room, view, "sess-b-00000002"))
    assert len(np.intersect1d(st.vox.keys[st.vox.occupied(time.time())], top)) == 0
    wall = voxels.keys_of(np.array([[1.99, 1.2, 0.0]]))
    idx = st.vox._index(wall)[0]
    assert st.vox.layer[idx] == voxels.STRUCTURE
    lo = st.vox.lo[idx]
    st.vox.integrate(np.array([0.0, 1.2, 0.0]), np.array([[2.5, 1.2, 0.0]]), int(time.time()))   # one frame "through" the wall
    idx = st.vox._index(wall)[0]                                       # (inserts shift positions)
    assert st.vox.occupied_mask(np.array([idx]))[0] and st.vox.lo[idx] < lo


def test_first_mapping_is_not_reported_as_changes(tmp_path):
    sp, room = Space(tmp_path), Room()
    r = sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    assert r["changes"] == []


def test_aligns_a_misaligned_session_to_the_map(tmp_path):
    """Another device's idea of the Space is 6 cm and 2° off (tag noise):
    the map pulls it back, and says so (its correction)."""
    sp, room = Space(tmp_path), Room()
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    off = geometry.yaw_transform(math.radians(2.0), [0.06, 0.0, -0.04])
    r = sp.fuse(sp.items(room, tour(20), "sess-b-00000002", offset=off))
    s = r["sessions"]["sess-b-00000002"]
    assert s["n"] >= 15 and s["rms"] < 0.01
    err = geometry.pose_to_matrix(s["pose"]) @ off
    assert np.linalg.norm(err[:3, 3]) < 0.01 and abs(math.degrees(geometry.yaw_of(err))) < 0.3
    # The map didn't smear: the far wall is still one thin plane.
    e = engine.extract(str(sp.dir))
    walls = [p for p in e["planes"] if p["kind"] == "wall" and abs(geometry.pose_to_matrix(p["pose"])[0, 3] - 2) < 0.1]
    assert walls and all(abs(geometry.pose_to_matrix(p["pose"])[0, 3] - 1.995) < 0.02 for p in walls)


def test_degenerate_view_only_moves_what_it_can_see(tmp_path):
    """Looking only at the floor pins height, not sliding along it."""
    sp, room = Space(tmp_path), Room()
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    off = geometry.yaw_transform(0, [0.05, 0.03, 0.0])
    floor_only = [([0, 1.5, 0.2 * i - 0.4], [0.01, 0, 0.2 * i - 0.39]) for i in range(5)]
    r = sp.fuse(sp.items(room, floor_only, "sess-c-00000003", offset=off))
    T = geometry.pose_to_matrix(r["sessions"]["sess-c-00000003"]["pose"])
    assert abs(T[1, 3] + 0.03) < 0.01            # height fixed
    assert abs(T[0, 3]) < 0.01                   # no made-up slide


def test_rebuild_reregisters_sessions(tmp_path):
    sp, room = Space(tmp_path), Room()
    items = sp.items(room, tour(40), "sess-a-00000001")
    off = geometry.yaw_transform(math.radians(1.5), [-0.05, 0.0, 0.05])
    items += sp.items(room, tour(16), "sess-b-00000002", offset=off)
    r = engine.rebuild(str(sp.dir), items)
    err = geometry.pose_to_matrix(r["sessions"]["sess-b-00000002"]["pose"]) @ off
    assert np.linalg.norm(err[:3, 3]) < 0.01
    assert r["stats"]["keyframes"] == 56


def test_clutter_fades_with_time_walls_dont(tmp_path):
    vm = voxels.VoxelMap()
    pts = np.array([[0.01, 0.01, 0.01], [1.01, 0.01, 0.01]])
    for _ in range(3):
        vm.integrate(None, pts, 0, carve=False)
    vm.set_layers(voxels.keys_of(pts[1:]), voxels.STRUCTURE)
    assert len(vm.occupied(0)) == 2
    week = 7 * 86400
    occ = vm.occupied(week)
    assert len(occ) == 1 and vm.layer[occ[0]] == voxels.STRUCTURE


def test_contradicted_furniture_is_flagged(tmp_path):
    """A table the headset's scan still has, but the map now sees through."""
    sp, room = Space(tmp_path), Room()
    t0 = time.time() - 600
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001", at=int(t0 * 1000)), now_s=t0)
    room.boxes = [b for b in room.boxes if not b.name.startswith("table")]
    sp.fuse(sp.items(room, tour(40), "sess-b-00000002"))
    table = {"id": "t1", "kind": "table", "last": int(t0 * 1000),
             "pose": {"p": [0, 0.75, -0.5], "q": [0, 0, 0, 1]}, "polygon": [[-0.6, -0.4], [0.6, -0.4], [0.6, 0.4], [-0.6, 0.4]]}
    e = engine.extract(str(sp.dir), [table])
    assert contradicted(e["contradicted"]["t1"])
    still = {**table, "id": "t2", "pose": {"p": [-1.7, 0.92, 1.5], "q": [0, 0, 0, 1]}, "kind": "counter"}   # the counter is still there
    assert not contradicted(engine.extract(str(sp.dir), [still])["contradicted"]["t2"])


def test_merge_is_stable_and_prefers_scans():
    wall = {"kind": "wall", "pose": {"p": [0, 1.2, -2], "q": [0.7071068, 0, 0, 0.7071068]}, "polygon": [[-1, -1], [1, -1], [1, 1], [-1, 1]]}
    obs = [{**wall, "id": "a", "source": "map", "weight": 4, "updated": 1},
           {**wall, "id": "b", "source": "quest", "updated": 2, "pose": {**wall["pose"], "p": [0.5, 1.2, -2.02]}},
           {"id": "c", "kind": "floor", "source": "map", "updated": 1, "pose": {"p": [0, 0, 0], "q": [0, 0, 0, 1]},
            "polygon": [[-1, -1], [1, -1], [1, 1], [-1, 1]]},
           {"id": "d", "kind": "floor", "source": "map", "updated": 1, "pose": {"p": [3, 0.01, 0], "q": [0, 0, 0, 1]},
            "polygon": [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]}]
    m1 = planes.merge(obs)
    assert sorted(s["kind"] for s in m1) == ["floor", "wall"]          # one floor per height, however patchy
    wall1 = next(s for s in m1 if s["kind"] == "wall")
    assert wall1["source"] == "quest" and wall1["sources"] == ["map", "quest"]
    # Next time the map's own planes have new ids: the merged ids stay.
    again = [{**o, "id": o["id"] + "2", "canonical": None} for o in obs]
    m2 = planes.merge(again, previous=m1)
    assert {s["id"] for s in m2} == {s["id"] for s in m1}


# ---- API ----------------------------------------------------------------------------------

async def upload(client, sid, room, cams, session, offset=None):
    out = []
    for p, look in cams:
        h, depth = room.keyframe(p, look, session=session, offset=offset)
        r = await client.post(f"/api/spaces/{sid}/map/keyframes", data=keyframe.encode(h, depth))
        assert r.status == 200, await r.text()
        out.append(await r.json())
    return out


async def test_map_api_builds_shared_surfaces(aiohttp_client, server):
    server.app["map"].rate_per_s = 1000
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    eve, _ = await login(aiohttp_client, server, "eve")
    assert (await eve.post(f"/api/spaces/{sid}/map/keyframes", data=b"x")).status == 403
    assert (await alice.post(f"/api/spaces/{sid}/map/keyframes", data=b"garbage")).status == 400
    await invite_and_join(alice, eve, sid)
    we, _ = await ws_in(eve, sid)
    room = Room()
    await upload(alice, sid, room, tour(30), "sess-alice-0001")
    await server.app["map"].idle()
    assert (await next_of(we, "map"))["space"] == sid                 # members hear about map updates
    assert (await (await eve.get(f"/api/spaces/{sid}/map/info")).json())["stats"]["occupied"] > 1000
    kinds = {s["kind"] for s in (await (await eve.get(f"/api/spaces/{sid}/surfaces")).json())["surfaces"]}
    assert {"floor", "wall", "table", "counter", "couch"} <= kinds
    exp = await (await eve.get(f"/api/spaces/{sid}/map")).json()
    assert exp["count"] > 1000 and exp["voxel"] == 0.04 and len(exp["ijk"]) > 100
    # Eve's phone is a bit off: after a few keyframes her uploads come back with a correction.
    off = geometry.yaw_transform(math.radians(1.0), [0.04, 0, 0.03])
    first = await upload(eve, sid, room, tour(6), "sess-eve-0002", offset=off)
    await server.app["map"].idle()
    later = await upload(eve, sid, room, tour(2), "sess-eve-0002", offset=off)
    assert first[0]["correction"] is None and later[-1]["correction"]["n"] >= 2
    err = geometry.pose_to_matrix(later[-1]["correction"]["pose"]) @ off
    assert np.linalg.norm(err[:3, 3]) < 0.015
    # Someone else can't post into Eve's session.
    h, depth = room.keyframe([0, 1.5, 0], [0, 0.8, -2], session="sess-eve-0002")
    assert (await alice.post(f"/api/spaces/{sid}/map/keyframes", data=keyframe.encode(h, depth))).status == 409
    info = await (await alice.get(f"/api/spaces/{sid}/map/info")).json()
    assert info["keyframes"] == 38
    # Rebuild, then reset.
    assert (await (await alice.post(f"/api/spaces/{sid}/map/rebuild")).json())["keyframes"] == 38
    assert (await alice.delete(f"/api/spaces/{sid}/map")).status == 204
    assert (await (await alice.get(f"/api/spaces/{sid}/map")).json())["count"] == 0
    assert (await (await alice.get(f"/api/spaces/{sid}/surfaces")).json())["surfaces"] == []
    await we.close()


async def test_map_rate_limit_and_points(aiohttp_client, server):
    alice, _ = await login(aiohttp_client, server, "alice")
    sid, _, _ = await make_space(alice)
    room = Room()
    h, depth = room.keyframe([0, 1.5, 0], [0, 0.8, -2], session="sess-alice-0009")
    codes = [(await alice.post(f"/api/spaces/{sid}/map/keyframes", data=keyframe.encode(h, depth))).status for _ in range(5)]
    assert codes.count(200) == 3 and codes.count(429) == 2
    pts = np.random.default_rng(1).uniform([-2, 0, -2.5], [2, 0.001, 2.5], (5000, 3))
    body = keyframe.encode_points({"v": 1, "session": "sess-alice-0009", "device": "q", "source": "quest-mesh", "key": "floor:5000"}, pts)
    r = await (await alice.post(f"/api/spaces/{sid}/map/points", data=body)).json()
    assert r["ok"] and r["points"] == 5000
    r = await (await alice.post(f"/api/spaces/{sid}/map/points", data=body)).json()
    assert r["duplicate"]                                             # same mesh again: ignored
    await server.app["map"].idle()


# ---- whole-session alignment, floor, ceiling, old phone surfaces (v47) ----------------

def test_rebuild_places_a_session_that_was_far_off(tmp_path):
    """Tags misread: a whole session 40 cm and 12° off (beyond ICP's reach).
    The coarse wall alignment + ICP in rebuild brings it back; the far wall
    stays one thin plane."""
    sp, room = Space(tmp_path), Room()
    items = sp.items(room, tour(40), "sess-a-00000001")
    off = geometry.yaw_transform(math.radians(12), [0.30, 0.0, -0.25])
    items += sp.items(room, tour(30), "sess-b-00000002", offset=off)
    r = engine.rebuild(str(sp.dir), items)
    assert r["segments"]["verified"] == r["segments"]["total"]
    err = geometry.pose_to_matrix(r["sessions"]["sess-b-00000002"]["pose"]) @ off
    assert np.linalg.norm(err[:3, 3]) < 0.02 and abs(math.degrees(geometry.yaw_of(err))) < 0.5, err
    e = engine.extract(str(sp.dir))
    walls = [p for p in e["planes"] if p["kind"] == "wall" and abs(geometry.pose_to_matrix(p["pose"])[0, 3] - 2) < 0.3]
    assert walls and all(abs(geometry.pose_to_matrix(p["pose"])[0, 3] - 1.995) < 0.03 for p in walls), walls


def test_a_session_that_overlaps_but_wont_line_up_stays_out(tmp_path):
    """A piece sitting on top of mapped space that matches nothing there (a
    misread tag dropping another room's scan here) doesn't smear the map."""
    sp, room = Space(tmp_path), Room()
    items = sp.items(room, tour(40), "sess-a-00000001")
    other = Room(size=(2.2, 2.5, 2.2))
    other.boxes = [Box([-1.1, 0, -0.3], [-0.5, 1.6, 0.3], "tall cabinet")]
    items += sp.items(other, tour(12), "sess-x-00000009", offset=geometry.yaw_transform(math.radians(30), [0.3, 0, 0.2]))
    r = engine.rebuild(str(sp.dir), items)
    assert r["segments"]["verified"] == 1 and r["segments"]["newArea"] == 0, r["segments"]
    e = engine.extract(str(sp.dir))
    walls = [p for p in e["planes"] if p["kind"] == "wall"]
    xs = [abs(geometry.pose_to_matrix(p["pose"])[0, 3]) for p in walls]
    assert walls and not [x for x in xs if 0.6 < x < 1.6], xs        # no walls of the small room inside the big one


def test_floor_comes_from_the_map_not_the_devices(tmp_path):
    """Devices' floorY can be way off (a roaming Quest reports it relative to
    where it started): the floor is the map's biggest low surface; the
    ceiling faces down and is called a ceiling, not a counter."""
    sp, room = Space(tmp_path), Room()
    items = sp.items(room, tour(40), "sess-a-00000001")
    for it in items:   # rewrite floorY like the bad device did
        body = (sp.dir / "kf" / f"{it['id']}.bin").read_bytes()
        h, d = keyframe.parse(body)
        h["floorY"] = 1.3
        (sp.dir / "kf" / f"{it['id']}.bin").write_bytes(keyframe.encode(h, d))
    look_up = [([0.5 * i - 1, 1.2, 0.5], [0.5 * i - 1, 2.5, 0.0]) for i in range(5)]
    items += sp.items(room, look_up, "sess-a-00000001")
    sp.fuse(items)
    e = engine.extract(str(sp.dir))
    assert abs(e["floorY"]) < 0.03, e["floorY"]
    k = by_kind(e["planes"])
    assert "ceiling" in k and not [p for p in e["planes"] if p["kind"] in ("counter", "table", "shelf") and height(p) > 2.0]
    floors = [p for p in e["planes"] if p["kind"] == "floor"]
    assert len(floors) == 1, floors


def test_old_phone_surfaces_the_map_disagrees_with_are_superseded(tmp_path):
    sp, room = Space(tmp_path), Room()
    sp.fuse(sp.items(room, tour(40), "sess-a-00000001"))
    pose = lambda y: {"p": [0.0, y, 0.5], "q": [0, 0, 0, 1], "s": [1, 1, 1]}
    sq = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]
    canonical = [
        {"id": "below", "kind": "floor", "pose": pose(-0.9), "polygon": sq, "sources": ["phone"]},       # under the floor
        {"id": "air", "kind": "table", "pose": pose(1.2), "polygon": sq, "sources": ["phone"]},         # mid-air, seen empty
        {"id": "real", "kind": "table", "pose": {"p": [0.0, 0.75, -0.5], "q": [0, 0, 0, 1], "s": [1, 1, 1]}, "polygon": sq, "sources": ["phone"]},
        {"id": "scan", "kind": "table", "pose": pose(1.2), "polygon": sq, "sources": ["quest"]},        # not a phone sweep: left alone
    ]
    e = engine.extract(str(sp.dir), canonical)
    assert set(e["superseded"]) == {"below", "air"}, e["superseded"]


def test_a_stepped_ceiling_keeps_its_levels(tmp_path):
    """Rooms aren't one flat ceiling: a dropped section stays its own ceiling."""
    sp, room = Space(tmp_path), Room()
    room.boxes.append(Box([-2.0, 2.2, -2.5], [2.0, 2.5, -1.0], "dropped ceiling"))   # 30 cm lower over one end
    look_up = [([0.5 * i - 1, 1.2, z], [0.5 * i - 1, 2.5, z - 0.4]) for i in range(5) for z in (-1.6, 0.0, 1.5)]
    sp.fuse(sp.items(room, tour(30) + look_up, "sess-a-00000001"))
    ceilings = sorted(height(p) for p in engine.extract(str(sp.dir))["planes"] if p["kind"] == "ceiling")
    assert len(ceilings) >= 2 and abs(ceilings[0] - 2.2) < 0.04 and abs(ceilings[-1] - 2.5) < 0.04, ceilings


def test_a_session_in_the_next_room_is_kept_where_its_tags_put_it(tmp_path):
    """No overlap means nothing to check it against: it's new, not wrong."""
    sp, room = Space(tmp_path), Room()
    items = sp.items(room, tour(40), "sess-a-00000001")
    nxt = Room(size=(3.0, 2.5, 3.0))
    shift = geometry.yaw_transform(0, [5.0, 0, 0])            # the room next door (its own frame → 5 m over)
    items += sp.items(nxt, tour(16), "sess-n-00000003", offset=shift)   # its tags put it 5 m over
    r = engine.rebuild(str(sp.dir), items)
    assert r["segments"]["newArea"] >= 1, r["segments"]
    e = engine.extract(str(sp.dir))
    assert [p for p in e["planes"] if geometry.pose_to_matrix(p["pose"])[0, 3] > 3.4], "the next room's surfaces are in the map"
