"""Stratum server: REST for cold data, WebSocket for push. See DESIGN.md §7.

    python server.py            # https://0.0.0.0:8930 (mkcert cert if available, else self-signed)
    python server.py --http     # http://0.0.0.0:8000 (for tailscale serve / adb reverse)
"""
import argparse
import asyncio
import hashlib
import hmac
import json
import math
import posixpath
import re
import shutil
import socket
import ssl
import subprocess
import time
import traceback
import uuid
from pathlib import Path

from aiohttp import ClientSession, ClientTimeout, ClientWSTimeout, WSMsgType, web
from yarl import URL

import apps as appsmod
import handrec
from hub import Conn, Hub
from mapping import keyframe, planes
from mapping.service import MapService
from store import Store, now_ms
from telemetry import Telemetry

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "client"
DATA = ROOT / "data"
COOKIE = "stratum_user"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,32}$")

routes = web.RouteTableDef()


# ---- helpers ---------------------------------------------------------------

HTTP_ERRORS = {400: web.HTTPBadRequest, 401: web.HTTPUnauthorized,
               403: web.HTTPForbidden, 404: web.HTTPNotFound,
               409: web.HTTPConflict, 413: lambda text: web.HTTPRequestEntityTooLarge(0, 0, text=text), 429: web.HTTPTooManyRequests,
               507: web.HTTPInsufficientStorage}


def bad(msg, status=400):
    raise HTTP_ERRORS[status](text=msg)


def store(request) -> Store:
    return request.app["store"]


def current_user(request):
    """Cookie identity. No real auth yet (DESIGN.md §1): the cookie holds the
    user id, and permission checks downstream are real."""
    uid = request.cookies.get(COOKIE)
    user = store(request).get_user(uid) if uid else None
    if not user:
        bad("not signed in", 401)
    return user


def check_uuid(value, what):
    if not isinstance(value, str) or not UUID_RE.match(value):
        bad(f"bad {what}")
    return value


def check_pose(pose):
    try:
        p, q = pose["p"], pose["q"]
        s = pose.get("s", [1, 1, 1])
        ok = len(p) == 3 and len(q) == 4 and len(s) == 3 and all(
            isinstance(v, (int, float)) for v in (*p, *q, *s))
    except (KeyError, TypeError):
        ok = False
    if not ok:
        bad("bad pose")
    return {"p": p, "q": q, "s": s}


# ---- auth ------------------------------------------------------------------

@routes.post("/api/login")
async def login(request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not NAME_RE.match(name):
        bad("name must be 1-32 chars: letters, digits, _ . -")
    user = store(request).login(name)
    resp = web.json_response({"user": user})
    resp.set_cookie(COOKIE, user["id"], max_age=365 * 86400, httponly=True,
                    samesite="Lax", secure=request.secure)
    return resp


@routes.post("/api/telemetry")
async def telemetry(request):
    # No sign-in required: the probe page has none, and errors from a
    # signed-out page are exactly the ones we need. User attached if known.
    if request.content_length and request.content_length > 512 * 1024:
        bad("too large")
    try:
        body = json.loads(await request.text())
    except ValueError:
        bad("bad json")
    if not isinstance(body, dict):
        bad("bad body")
    uid = request.cookies.get(COOKIE)
    user = store(request).get_user(uid) if uid else None
    n = request.app["telemetry"].from_client(body, user, request.remote)
    return web.json_response({"stored": n})


@routes.get("/api/me")
async def me(request):
    user = current_user(request)
    return web.json_response({"user": user, "layers": store(request).visible_layers(user["id"])})


# ---- spaces / anchors ------------------------------------------------------

@routes.get("/api/spaces")
async def list_spaces(request):
    user = current_user(request)
    device = check_uuid(request.query.get("device"), "device")
    return web.json_response({"spaces": store(request).spaces_for(user["id"], device)})


def parse_anchor(a):
    if not isinstance(a, dict):
        bad("bad anchor")
    handle = a.get("handle")
    if handle is not None and (not isinstance(handle, str) or len(handle) > 128):
        bad("bad handle")
    return {"id": check_uuid(a.get("id"), "anchor id"), "pose": check_pose(a.get("pose")), "handle": handle}


def parse_marker(m):
    if not isinstance(m, dict):
        bad("bad marker")
    family = m.get("family", "tag36h11")
    tag, size = m.get("tag"), m.get("size")
    if family != "tag36h11" or not isinstance(tag, int) or not 0 <= tag < 587:
        bad("marker must be a tag36h11 id 0-586")
    if not isinstance(size, (int, float)) or not 0.01 <= size <= 2:
        bad("marker size must be 0.01-2 m")
    return {"family": family, "tag": tag, "size": float(size), "pose": check_pose(m.get("pose"))}


def check_marker_free(st, uid, marker):
    other = st.marker_space(uid, marker["family"], marker["tag"])
    if other:
        raise web.HTTPConflict(text=json.dumps({"error": "tag already used", "space": other}),
                               content_type="application/json")


@routes.post("/api/spaces")
async def create_space(request):
    """A Space needs at least one way to find it again: a printed marker
    (phones, any device with a camera) and/or a device anchor (Quest)."""
    user = current_user(request)
    body = await request.json()
    sid = check_uuid(body.get("id"), "space id")
    name = str(body.get("name", "Space"))[:64]
    anchor = parse_anchor(body["anchor"]) if body.get("anchor") else None
    marker = parse_marker(body["marker"]) if body.get("marker") else None
    if not anchor and not marker:
        bad("space needs an anchor or a marker")
    device = check_uuid(body.get("device"), "device") if anchor else None
    st = store(request)
    if marker:
        check_marker_free(st, user["id"], marker)
    st.create_space(user["id"], sid, name, anchor, device, marker)
    return web.json_response({"ok": True})


# ---- sharing (DESIGN.md §5.1) ----------------------------------------------

@routes.post("/api/spaces/{id}/invite")
async def invite(request):
    """Any member can invite: returns a short code (valid 24 h, reusable)."""
    user = current_user(request)
    sid = check_uuid(request.match_info["id"], "space id")
    st = store(request)
    if not st.is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    return web.json_response(st.create_invite(user["id"], sid))


@routes.post("/api/join")
async def join(request):
    user = current_user(request)
    code = str((await request.json()).get("code", ""))[:16]
    st = store(request)
    sid = st.invite_space(code)
    if not sid:
        bad("that code is wrong or expired", 404)
    conflicts = st.join_conflicts(user["id"], sid)
    if conflicts and not st.is_space_member(user["id"], sid):
        c = conflicts[0]
        raise web.HTTPConflict(text=json.dumps({"error": f"tag {c['tag']} is already your space \"{c['space']}\"",
                                                "conflicts": conflicts}), content_type="application/json")
    st.join_space(user["id"], sid)
    request.app["hub"].publish_space(sid, {"t": "members", "space": sid})
    return web.json_response({"space": sid})


@routes.post("/api/spaces/{id}/leave")
async def leave(request):
    user = current_user(request)
    sid = check_uuid(request.match_info["id"], "space id")
    st = store(request)
    if st.space_owner(sid) == user["id"]:
        bad("the owner can't leave their own space")
    st.leave_space(user["id"], sid)
    request.app["hub"].publish_space(sid, {"t": "members", "space": sid})
    return web.Response(status=204)


@routes.delete("/api/spaces/{id}")
async def delete_space(request):
    """The owner deletes a Space for everyone: its things, anchors, tags, room
    map, invites and members (store.delete_space). Members' devices hear
    'members' and drop it. Others can only leave it."""
    user = current_user(request)
    sid = check_uuid(request.match_info["id"], "space id")
    st = store(request)
    owner = st.space_owner(sid)
    if owner is None:
        bad("no such space", 404)
    if owner != user["id"]:
        bad("only the space's owner can delete it (you can leave it)", 403)
    await request.app["map"].reset(sid)   # (the map engine's files and state for it)
    st.delete_space(sid)
    request.app["hub"].publish_space(sid, {"t": "members", "space": sid})
    return web.Response(status=204)


# ---- room map (DESIGN.md §3.8) and living world map (§3.10) -------------------
# Clients send observations (a Quest's scan planes, a phone's sweep); the
# server merges every source and user into one surface set per Space. Depth
# keyframes and room meshes feed the voxel map (server/mapping/), which finds
# surfaces of its own and notices things appear and disappear.

SURFACE_KINDS = set(planes.KINDS)
MAX_SURFACE_OBS = 400


def parse_surface(s):
    if not isinstance(s, dict):
        bad("bad surface")
    kind, poly = s.get("kind"), s.get("polygon")
    if kind not in SURFACE_KINDS:
        bad(f"surface kind must be one of {sorted(SURFACE_KINDS)}")
    if not isinstance(poly, list) or not 3 <= len(poly) <= 64 or not all(_vec(p, 2) for p in poly):
        bad("polygon must be 3-64 [x, z] points")
    w = s.get("weight")
    return {"id": check_uuid(s.get("id"), "surface id"), "kind": kind, "pose": check_pose(s.get("pose")),
            "polygon": [[round(x, 4), round(z, 4)] for x, z in poly], "source": str(s.get("source", "phone"))[:16],
            "weight": min(10.0, max(0.1, float(w))) if isinstance(w, (int, float)) and math.isfinite(w) else None}


def member_space(request, user):
    sid = check_uuid(request.match_info["id"], "space id")
    if not store(request).is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    return sid


@routes.get("/api/spaces/{id}/surfaces")
async def list_surfaces(request):
    sid = member_space(request, current_user(request))
    return web.json_response({"surfaces": store(request).surfaces(sid)})


@routes.put("/api/spaces/{id}/surfaces/{sid2}")
async def put_surface(request):
    user = current_user(request)
    sid = member_space(request, user)
    s = parse_surface({**(await request.json()), "id": request.match_info["sid2"]})
    st = store(request)
    if st.count_surface_obs(sid) >= MAX_SURFACE_OBS:
        bad(f"room map is full ({MAX_SURFACE_OBS} observations)", 409)
    if not st.put_surface_obs(user["id"], sid, s):
        bad("that surface belongs to another space or user", 409)
    await request.app["map"].observations_changed(sid)
    return web.json_response({"ok": True})


@routes.post("/api/spaces/{id}/surfaces/replace")
async def replace_surfaces(request):
    user = current_user(request)
    sid = member_space(request, user)
    body = await request.json()
    source = str(body.get("source", ""))[:16]
    items = body.get("surfaces")
    if not source or source == "map" or not isinstance(items, list) or len(items) > 200:
        bad("need source and up to 200 surfaces")
    device = str(body["device"])[:64] if body.get("device") else None
    store(request).replace_surface_obs(user["id"], sid, source, [parse_surface(s) for s in items], device)
    await request.app["map"].observations_changed(sid)
    return web.json_response({"ok": True})


@routes.delete("/api/spaces/{id}/surfaces")
async def clear_surfaces(request):
    sid = member_space(request, current_user(request))
    store(request).delete_surfaces(sid, request.query.get("id"))
    request.app["hub"].publish_space(sid, {"t": "surfaces", "space": sid})
    return web.Response(status=204)


async def _map_upload(request, fn):
    user = current_user(request)
    sid = member_space(request, user)
    body = await request.read()
    if len(body) > keyframe.MAX_BYTES:
        bad("too big")
    try:
        return web.json_response(await fn(user["id"], sid, body))
    except keyframe.BadKeyframe as err:
        bad(str(err))
    except PermissionError as err:
        bad(str(err), 409)
    except OverflowError as err:
        bad(str(err), 429)


@routes.post("/api/spaces/{id}/map/keyframes")
async def map_keyframe(request):
    return await _map_upload(request, request.app["map"].add_keyframe)


@routes.post("/api/spaces/{id}/map/points")
async def map_points(request):
    return await _map_upload(request, request.app["map"].add_points)


@routes.get("/api/spaces/{id}/map")
async def map_export(request):
    sid = member_space(request, current_user(request))
    limit = min(120000, max(100, int(request.query.get("limit", 60000)))) if request.query.get("limit", "").isdigit() else 60000
    return web.json_response(await request.app["map"].export(sid, limit))


@routes.get("/api/spaces/{id}/map/info")
async def map_info(request):
    sid = member_space(request, current_user(request))
    return web.json_response(await request.app["map"].info(sid))


@routes.post("/api/spaces/{id}/map/rebuild")
async def map_rebuild(request):
    sid = member_space(request, current_user(request))
    return web.json_response(await request.app["map"].rebuild(sid))


@routes.delete("/api/spaces/{id}/map")
async def map_reset(request):
    sid = member_space(request, current_user(request))
    await request.app["map"].reset(sid)
    return web.Response(status=204)


@routes.post("/api/markers")
async def add_marker(request):
    """Register another marker in an existing Space (seen together with a
    marker the Space already knows)."""
    user = current_user(request)
    body = await request.json()
    sid = check_uuid(body.get("space"), "space id")
    st = store(request)
    if not st.is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    marker = parse_marker(body.get("marker"))
    check_marker_free(st, user["id"], marker)
    st.add_marker(user["id"], sid, marker)
    return web.json_response({"ok": True})


@routes.post("/api/anchors")
async def add_anchor(request):
    user = current_user(request)
    body = await request.json()
    sid = check_uuid(body.get("space"), "space id")
    device = check_uuid(body.get("device"), "device")
    if not store(request).is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    store(request).add_anchor(user["id"], sid, parse_anchor(body.get("anchor")), device)
    return web.json_response({"ok": True})


@routes.delete("/api/anchors/{id}/binding")
async def drop_binding(request):
    user = current_user(request)
    aid = check_uuid(request.match_info["id"], "anchor id")
    device = check_uuid(request.query.get("device"), "device")
    sid = store(request).anchor_space(aid)
    if not sid or not store(request).is_space_member(user["id"], sid):
        bad("no such anchor", 404)
    store(request).drop_binding(aid, device)
    return web.Response(status=204)


# ---- objects ---------------------------------------------------------------

@routes.get("/api/objects")
async def list_objects(request):
    user = current_user(request)
    sid = check_uuid(request.query.get("space"), "space id")
    since = int(request.query.get("since", "0"))
    st = store(request)
    if not st.is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    # Read rev first: anything written after this shows up in the next delta.
    rev = st.current_rev()
    return web.json_response({"rev": rev, "objects": st.objects_since(user["id"], sid, since)})


@routes.put("/api/objects/{id}")
async def put_object(request):
    user = current_user(request)
    oid = check_uuid(request.match_info["id"], "object id")
    body = await request.json()
    sid = check_uuid(body.get("space"), "space id")
    lid = check_uuid(body.get("layer"), "layer id")
    pose = check_pose(body.get("pose"))
    components = body.get("components") or {}
    if not isinstance(components, dict):
        bad("components must be an object")
    st = store(request)
    if not st.is_space_member(user["id"], sid):
        bad("not a member of that space", 403)
    if not st.can_edit_layer(user["id"], lid):
        bad("no edit access to that layer", 403)
    owner_space = st.layer_space(lid)
    if owner_space and owner_space != sid:   # (deleting that Space would take the object with it)
        bad("that layer is another space's shared layer")
    existing = st.get_object(oid)
    if existing and not existing["deleted"] and not st.can_edit_layer(user["id"], existing["layer"]):
        bad("no edit access to the object's current layer", 403)
    obj = st.put_object(user["id"], oid, sid, lid, pose, components)
    if existing and (existing["space"] != sid or existing["layer"] != lid):  # moved: old viewers see it leave
        request.app["hub"].publish(existing["space"], existing["layer"],
                                   {"t": "obj", "object": {**existing, "deleted": True, "rev": obj["rev"]}})
    request.app["hub"].publish(sid, lid, {"t": "obj", "object": obj})
    return web.json_response({"object": obj})


# ---- hand recordings (gesture training data; server/handrec.py) -------------

@routes.post("/api/handrec")
async def post_handrec(request):
    user = current_user(request)
    session = check_uuid(request.query.get("session"), "session")
    try:
        seq = int(request.query.get("seq", ""))
    except ValueError:
        bad("bad seq")
    if not 0 <= seq < 100000:
        bad("bad seq")
    gz = request.query.get("gz") == "1"
    if request.content_length and request.content_length > handrec.MAX_CHUNK_BYTES:
        bad("too big", 413)
    body = await request.read()
    if not body or len(body) > handrec.MAX_CHUNK_BYTES:
        bad("too big" if body else "empty", 413 if body else 400)
    if gz and not body.startswith(handrec.GZIP_MAGIC):
        bad("not gzip")
    try:
        request.app["handrec"].save(user["id"], request.headers.get("x-device", ""), session, seq, body, gz)
    except handrec.Full as err:
        bad(str(err), 507)
    return web.Response(status=204)


@routes.delete("/api/objects/{id}")
async def delete_object(request):
    user = current_user(request)
    oid = check_uuid(request.match_info["id"], "object id")
    st = store(request)
    existing = st.get_object(oid)
    if not existing or existing["deleted"] or not st.is_space_member(user["id"], existing["space"]):
        bad("no such object", 404)
    if not st.can_edit_layer(user["id"], existing["layer"]):
        bad("no edit access to that layer", 403)
    obj = st.delete_object(oid)
    request.app["hub"].publish(obj["space"], obj["layer"], {"t": "obj", "object": obj})
    return web.Response(status=204)


# ---- websocket -------------------------------------------------------------

def _vec(v, n):
    return isinstance(v, list) and len(v) == n and all(isinstance(x, (int, float)) and abs(x) < 1e4 for x in v)


@routes.get("/ws")
async def websocket(request):
    user = current_user(request)
    st, hub = store(request), request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    conn = Conn(ws, user)
    conn.send({"t": "hello", "serverTime": now_ms(), "user": user, "you": conn.id})
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = msg.json()
            except ValueError:
                continue
            if data.get("t") == "appsub":
                # [{app, channel}] → join rooms for apps this user has turned on.
                keys = set()
                for c in data.get("channels", [])[:32]:
                    app = request.app["registry"].get(str(c.get("app")))
                    if app and "channel" in app.permissions and st.app_enabled(user["id"], app.id):
                        keys.add(f"app:{app.id}:{str(c.get('channel'))[:80]}")
                conn.send({"t": "appsubbed", "channels": sorted(keys)})
                hub.join_channels(conn, keys)   # then "host" announcements
            elif data.get("t") == "app":
                # Client → others in the room (hot, not persisted, droppable).
                key = f"app:{data.get('app')}:{str(data.get('channel'))[:80]}"
                if key in conn.channels:
                    hub.publish_channel(key, {"t": "app", "app": data.get("app"), "channel": data.get("channel"),
                                              "msg": data.get("msg"), "from": appsmod.pseudonym(
                                                  request.app["server_secret"], str(data.get("app")), user["id"])},
                                        exclude=conn)
            if data.get("t") == "ping":
                # Client watchdog: a quiet socket can be dead without closing
                # (Quest Browser after the headset sleeps or AR pauses it).
                conn.send({"t": "pong"})
                continue
            if data.get("t") == "sub":
                wanted = {s for s in data.get("spaces", []) if isinstance(s, str)}
                spaces = {s for s in wanted if st.is_space_member(user["id"], s)}
                # Layer set is captured here; a client re-subs after layer
                # membership changes (M1: server pushes a "resub" hint).
                layers = {layer["id"] for layer in st.visible_layers(user["id"])}
                hub.subscribe(conn, spaces, layers)
                conn.send({"t": "subbed", "spaces": sorted(spaces)})
            elif data.get("t") == "move":
                # Live drag: an object's pose while it's being moved (hot; the
                # saved PUT on release is the truth). Only to people who can
                # see the object's layer.
                sid, lid = data.get("space"), data.get("layer")
                pose = data.get("pose")
                if sid in conn.spaces and lid in conn.layers and isinstance(pose, dict) \
                        and _vec(pose.get("p"), 3) and _vec(pose.get("q"), 4) and _vec(pose.get("s", [1, 1, 1]), 3):
                    hub.publish(sid, lid, {"t": "move", "id": str(data.get("id"))[:64], "space": sid,
                                           "pose": {k: pose[k] for k in ("p", "q", "s") if k in pose}, "from": conn.id},
                                exclude=conn, droppable=True)
            elif data.get("t") == "pose":
                # Presence: where this person is in a Space (hot, droppable).
                sid = data.get("space")
                p, q = data.get("p"), data.get("q")
                if sid in conn.spaces and _vec(p, 3) and _vec(q, 4):
                    hub.publish_space(sid, {"t": "pose", "space": sid, "from": conn.id, "name": user["name"],
                                            "p": p, "q": q, "device": str(data.get("device", ""))[:16]},
                                      exclude=conn, droppable=True)
            # M3: "state" (hot relay) and ownership leases go here.
    finally:
        hub.drop_presence(conn)
        hub.drop(conn)
    return ws


# ---- static ----------------------------------------------------------------

IMPORT_RE = re.compile(r"""^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]""", re.M)


def preload_links():
    """<link rel=modulepreload> for every module main.js loads statically (its
    import graph): the browser fetches / revalidates them all at once instead
    of discovering them one import level at a time."""
    seen, todo = [], ["/js/main.js"]
    while todo:
        url = todo.pop()
        if url in seen:
            continue
        path = CLIENT / url.lstrip("/")
        if not path.is_file():
            continue
        seen.append(url)
        for m in IMPORT_RE.finditer(path.read_text(errors="replace")):
            spec = m.group(1) or m.group(2)
            if spec == "three":
                todo.append("/vendor/three.module.js")
            elif spec.startswith("three/addons/"):
                todo.append("/vendor/" + spec[len("three/addons/"):])
            elif spec.startswith("."):
                todo.append(posixpath.normpath(posixpath.join(posixpath.dirname(url), spec)))
            elif spec.startswith("/"):
                todo.append(spec)
    return "\n".join(f'<link rel="modulepreload" href="{u}">' for u in seen)


@routes.get("/")
async def index(request):
    html = (CLIENT / "index.html").read_text()
    return web.Response(text=html.replace("<!--modulepreload-->", preload_links()), content_type="text/html")


# ---- assets ------------------------------------------------------------------

ASSET_MAX_BYTES = 100 * 1024 * 1024
HASH_RE = re.compile(r"^[0-9a-f]{64}$")


def sniff(head):
    """(mime, kind) from the first bytes. Never trust the client's type."""
    if head[:4] == b"glTF":
        return "model/gltf-binary", "model"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png", "image"
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "image"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", "image"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif", "image"
    if head[4:8] == b"ftyp":
        return "video/mp4", "video"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm", "video"
    return None, None


@routes.post("/api/assets")
async def upload_asset(request):
    """Raw body upload. ?name=<file name>&w=&h= (pixel size, measured by the
    client for images/video). Stored once per content hash."""
    user = current_user(request)
    if request.content_length and request.content_length > ASSET_MAX_BYTES:
        bad(f"max {ASSET_MAX_BYTES // 1024 // 1024} MB")
    assets_dir = request.app["assets_dir"]
    tmp = assets_dir / f".upload-{new_upload_id()}"
    digest, size, head = hashlib.sha256(), 0, b""
    try:
        with tmp.open("wb") as f:
            async for chunk in request.content.iter_chunked(1 << 16):
                size += len(chunk)
                if size > ASSET_MAX_BYTES:
                    bad(f"max {ASSET_MAX_BYTES // 1024 // 1024} MB")
                if len(head) < 64:
                    head += chunk[:64 - len(head)]
                digest.update(chunk)
                f.write(chunk)
        if not size:
            bad("empty upload")
        mime, kind = sniff(head)
        if not mime:
            bad("unsupported file: use .glb, png/jpg/webp/gif, or mp4/webm")
        h = digest.hexdigest()
        final = asset_path(assets_dir, h)
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            tmp.unlink()
        else:
            tmp.rename(final)
    finally:
        if tmp.exists():
            tmp.unlink()

    def dim(key):
        try:
            v = int(request.query.get(key, ""))
            return v if 0 < v < 100000 else None
        except ValueError:
            return None
    name = request.query.get("name", "")[:120] or f"{kind}-{h[:8]}"
    asset = store(request).add_asset(user["id"], {"hash": h, "mime": mime, "kind": kind, "size": size,
                                                  "width": dim("w"), "height": dim("h")}, name)
    return web.json_response({"asset": asset})


@routes.get("/api/assets")
async def list_assets(request):
    user = current_user(request)
    return web.json_response({"assets": store(request).assets_for(user["id"])})


@routes.get("/assets/{hash}")
async def get_asset(request):
    # Any signed-in user may fetch by hash: objects in shared layers point at
    # assets other people uploaded. (Asset ACLs: later, DESIGN.md §5.)
    current_user(request)
    h = request.match_info["hash"]
    if not HASH_RE.match(h):
        bad("no such asset", 404)
    meta = store(request).get_asset(h)
    path = asset_path(request.app["assets_dir"], h)
    if not meta or not path.exists():
        bad("no such asset", 404)
    resp = web.FileResponse(path, headers={
        "Content-Type": meta["mime"],
        "Cache-Control": "private, max-age=31536000, immutable",   # content-addressed
    })
    return resp


def asset_path(assets_dir, h):
    return assets_dir / h[:2] / h


def new_upload_id():
    return uuid.uuid4().hex


# ---- apps (DESIGN.md §6) ---------------------------------------------------------

def registry(request) -> appsmod.Registry:
    return request.app["registry"]


def app_or_404(request):
    app = registry(request).get(request.match_info["app"])
    if not app:
        bad("no such app", 404)
    return app


def require_enabled(request, user, app, permission=None):
    if not store(request).app_enabled(user["id"], app.id):
        bad(f"{app.id} is turned off", 403)
    if permission and permission not in app.permissions:
        bad(f"{app.id} lacks the '{permission}' permission", 403)


@routes.get("/api/apps")
async def list_apps(request):
    user = current_user(request)
    st = store(request)
    installs = st.app_installs(user["id"])
    out = []
    for app in registry(request).apps.values():
        enabled = installs.get(app.id, False)
        out.append({**app.public(), "enabled": enabled,
                    "layer": st.app_layer(user["id"], app.id) if enabled else None,
                    "settingsValues": st.get_app_state(user["id"], app.id, SETTINGS_KEY) or {}})
    return web.json_response({"apps": out})


@routes.put("/api/apps/{app}")
async def toggle_app(request):
    user = current_user(request)
    app = app_or_404(request)
    body = await request.json()
    if not isinstance(body.get("enabled"), bool):
        bad("enabled must be true/false")
    st = store(request)
    st.set_app_enabled(user["id"], app.id, body["enabled"])
    return web.json_response({**app.public(), "enabled": body["enabled"],
                              "layer": st.app_layer(user["id"], app.id) if body["enabled"] else None})


@routes.get("/api/apps/{app}/state/{key}")
async def get_app_state(request):
    user = current_user(request)
    app = app_or_404(request)
    require_enabled(request, user, app, "state")
    value = store(request).get_app_state(user["id"], app.id, request.match_info["key"][:64])
    return web.json_response({"value": value})


@routes.put("/api/apps/{app}/state/{key}")
async def put_app_state(request):
    user = current_user(request)
    app = app_or_404(request)
    require_enabled(request, user, app, "state")
    raw = await request.text()
    if len(raw) > 16 * 1024:
        bad("state values are limited to 16 KB")
    try:
        value = json.loads(raw)["value"]
    except (ValueError, KeyError, TypeError):
        bad('body must be {"value": ...}')
    store(request).put_app_state(user["id"], app.id, request.match_info["key"][:64], value)
    return web.json_response({"ok": True})


# Per-user app settings (manifest schema; the menu edits them). Stored in
# app_state under a platform key; no 'state' permission or enable needed.
SETTINGS_KEY = "__settings"


@routes.put("/api/apps/{app}/settings")
async def put_app_settings(request):
    user = current_user(request)
    app = app_or_404(request)
    body = await request.json()
    if not isinstance(body, dict) or len(body) > 50:
        bad("body must be {key: value}")
    st = store(request)
    values = st.get_app_state(user["id"], app.id, SETTINGS_KEY) or {}
    for k, v in body.items():
        try:
            values[k] = appsmod.check_setting(app.manifest.get("settings", []), k, v)
        except ValueError as exc:
            bad(str(exc))
    st.put_app_state(user["id"], app.id, SETTINGS_KEY, values)
    return web.json_response({"values": values})


# Stratum clipboard: one per user, shared by all their devices (copy in the
# headset, paste on the phone). Apps reach it through ctx.clipboard.
CLIPBOARD_MAX = 64 * 1024


@routes.get("/api/clipboard")
async def get_clipboard(request):
    user = current_user(request)
    return web.json_response(store(request).get_app_state(user["id"], "__platform", "clipboard") or {"text": "", "at": 0})


@routes.put("/api/clipboard")
async def put_clipboard(request):
    user = current_user(request)
    body = await request.json()
    text = body.get("text") if isinstance(body, dict) else None
    if not isinstance(text, str) or len(text.encode()) > CLIPBOARD_MAX:
        bad(f"text must be a string of at most {CLIPBOARD_MAX // 1024} KB")
    value = {"text": text, "at": int(time.time() * 1000)}
    store(request).put_app_state(user["id"], "__platform", "clipboard", value)
    return web.json_response(value)


def backend_path(request, kind):
    """The backend's path + query exactly as sent (still %-encoded), and sent on
    as is (URL(..., encoded=True): no re-quoting %40 → @): what we sign is what
    the backend sees (request.path_qs there)."""
    prefix = f"/apps/{request.match_info['app']}/{kind}"
    raw = request.raw_path
    if not raw.startswith(prefix + "/"):
        bad("bad path")
    return raw[len(prefix):]


@routes.route("*", "/apps/{app}/api/{tail:.*}")
async def app_proxy(request):
    """Client → app backend, through us. We attach who's calling (an app-
    scoped pseudonym, plus the username if the app has 'identity'), sign it
    with the app's secret, and enforce on/off, permissions, rate and size."""
    user = current_user(request)
    app = app_or_404(request)
    require_enabled(request, user, app, "backend")
    if not app.backend or not app.secret:
        _unavailable(app)
    if not request.app["limiter"].allow((user["id"], app.id)):
        raise web.HTTPTooManyRequests(text="slow down")
    if request.content_length and request.content_length > appsmod.PROXY_MAX_BODY:
        bad("request too large")
    body = await request.read()
    if len(body) > appsmod.PROXY_MAX_BODY:
        bad("request too large")
    path_qs = backend_path(request, "api")
    who = appsmod.pseudonym(request.app["server_secret"], app.id, user["id"])
    name = user["name"] if "identity" in app.permissions else ""
    ts = str(now_ms())
    headers = {
        "X-Stratum-App": app.id, "X-Stratum-User": who, "X-Stratum-Name": name, "X-Stratum-Time": ts,
        "X-Stratum-Signature": appsmod.sign(app.secret, app.id, who, name, ts, request.method, path_qs),
    }
    for h in ("Content-Type", "Accept"):
        if h in request.headers:
            headers[h] = request.headers[h]
    try:
        async with request.app["http"].request(request.method, URL(app.backend.rstrip("/") + path_qs, encoded=True),
                                               data=body or None, headers=headers, allow_redirects=False) as r:
            # Read the whole body (content.read(n) returns whatever has arrived,
            # which truncated large JPEG frames), capped at PROXY_MAX_BODY.
            chunks, size = [], 0
            async for chunk in r.content.iter_chunked(1 << 16):
                size += len(chunk)
                if size > appsmod.PROXY_MAX_BODY:
                    raise web.HTTPBadGateway(text="backend response too large")
                chunks.append(chunk)
            data = b"".join(chunks)
            # Apps may return their own metadata headers (X-App-*), e.g. a frame number.
            passthrough = {k: v for k, v in r.headers.items() if k.lower().startswith("x-app-")}
            return web.Response(status=r.status, body=data, headers=passthrough,
                                content_type=r.content_type or "application/octet-stream")
    except web.HTTPException:
        raise
    except Exception as exc:   # backend down, timeout, DNS
        raise web.HTTPBadGateway(text=f"{app.id} backend unavailable: {type(exc).__name__}")


@routes.get("/apps/{app}/socket/{tail:.*}")
async def app_socket(request):
    """Client ↔ app backend WebSocket, through us: the same checks and signed
    identity as app_proxy (signed as a GET of the path), then messages are
    pumped both ways until either side closes. For streams (video, audio,
    live state) that a request per message can't carry."""
    user = current_user(request)
    app = app_or_404(request)
    require_enabled(request, user, app, "backend")
    if not app.backend or not app.secret:
        _unavailable(app)
    if not request.app["limiter"].allow((user["id"], app.id)):
        raise web.HTTPTooManyRequests(text="slow down")
    open_ = request.app["sockets"]
    key = (user["id"], app.id)
    if open_.get(key, 0) >= appsmod.SOCKETS_PER_USER:
        raise web.HTTPTooManyRequests(text="too many open sockets")
    path_qs = backend_path(request, "socket")
    who = appsmod.pseudonym(request.app["server_secret"], app.id, user["id"])
    name = user["name"] if "identity" in app.permissions else ""
    ts = str(now_ms())
    headers = {
        "X-Stratum-App": app.id, "X-Stratum-User": who, "X-Stratum-Name": name, "X-Stratum-Time": ts,
        "X-Stratum-Signature": appsmod.sign(app.secret, app.id, who, name, ts, "GET", path_qs),
    }
    try:
        upstream = await request.app["http"].ws_connect(URL(app.backend.rstrip("/") + path_qs, encoded=True), headers=headers,
                                                         max_msg_size=appsmod.SOCKET_MAX_OUT, heartbeat=20,
                                                         timeout=ClientWSTimeout(ws_receive=None, ws_close=5))
    except Exception as exc:
        raise web.HTTPBadGateway(text=f"{app.id} backend unavailable: {type(exc).__name__}")
    ws = web.WebSocketResponse(max_msg_size=appsmod.SOCKET_MAX_IN, heartbeat=20)
    await ws.prepare(request)
    open_[key] = open_.get(key, 0) + 1

    async def pump(src, dst):
        async for msg in src:
            if dst.closed:
                break
            if msg.type == WSMsgType.TEXT:
                await dst.send_str(msg.data)
            elif msg.type == WSMsgType.BINARY:
                await dst.send_bytes(msg.data)
            else:
                break
    try:
        tasks = [asyncio.create_task(pump(ws, upstream)), asyncio.create_task(pump(upstream, ws))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in tasks:
            t.cancel()
    finally:
        open_[key] -= 1
        await upstream.close()
        await ws.close()
    return ws


def _unavailable(app):
    raise web.HTTPServiceUnavailable(text=f"{app.id} backend is not configured")


@routes.post("/api/apps/{app}/broadcast")
async def app_broadcast(request):
    """App backend → everyone in a channel (e.g. "fish were fed"). Auth: the
    app's secret as a bearer token. Body: {"channel": str, "msg": any}."""
    app = app_or_404(request)
    token = request.headers.get("Authorization", "").removeprefix("Bearer ").encode()
    if not app.secret or not hmac_compare(token, app.secret):
        bad("bad app credentials", 401)
    body = await request.json()
    channel = str(body.get("channel", ""))[:80]
    if not channel:
        bad("channel required")
    n = request.app["hub"].publish_channel(f"app:{app.id}:{channel}",
                                           {"t": "app", "app": app.id, "channel": channel, "msg": body.get("msg"), "from": "backend"})
    return web.json_response({"delivered": n})


def hmac_compare(a, b):
    return hmac.compare_digest(a, b)


@routes.get("/apps/{app}/{path:.+}")
async def app_static(request):
    app = app_or_404(request)
    root = (app.dir / "client").resolve()
    target = (root / request.match_info["path"]).resolve()
    if root not in target.parents or not target.is_file():
        bad("not found", 404)
    return web.FileResponse(target)


@routes.get("/tags")
async def tags(request):
    return web.FileResponse(CLIENT / "tags.html")


@routes.get("/questcam")
async def questcam(request):
    return web.FileResponse(CLIENT / "questcam.html")


@routes.get("/train")
async def trainer(request):
    return web.FileResponse(CLIENT / "trainer.html")   # gesture trainer: labelled takes for the hand recording


@routes.get("/raytest")
async def raytest(request):
    return web.FileResponse(CLIENT / "raytest.html")   # hand-ray tuning (DESIGN.md §0)


@routes.get("/probe")
async def probe(request):
    return web.FileResponse(CLIENT / "probe.html")


@web.middleware
async def record_errors(request, handler):
    # Unhandled server exceptions → telemetry, then the normal 500.
    try:
        return await handler(request)
    except web.HTTPException:
        raise
    except Exception as exc:
        request.app["telemetry"].server_error(request, exc, traceback.format_exc())
        raise


@web.middleware
async def no_cache(request, handler):
    # Quest Browser caches aggressively; during development always revalidate.
    resp = await handler(request)
    if request.path.startswith("/vendor/"):
        resp.headers["Cache-Control"] = "public, max-age=86400"   # third-party code: changes only with a deliberate update
    elif not request.path.startswith(("/ws", "/assets/")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def lan_names():
    names = ["localhost", "127.0.0.1", socket.gethostname()]
    try:
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True).stdout
        names += out.split()
    except OSError:
        pass
    return names


def ensure_cert():
    """Normally ./setup.sh made one already. Prefer mkcert: once its root CA
    is installed on the headset/phone there's no cert warning. Fall back to
    a self-signed cert you click through once."""
    cert, key = DATA / "cert.pem", DATA / "key.pem"
    if not cert.exists() and shutil.which("mkcert"):
        subprocess.run(["mkcert", "-cert-file", str(cert), "-key-file", str(key), *lan_names()],
                       check=True, capture_output=True)
    if not cert.exists():
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
             "-keyout", str(key), "-out", str(cert), "-subj", "/CN=stratum-dev"],
            check=True, capture_output=True)
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(cert, key)
    return ctx


def make_app(db_path, telemetry_dir=None, assets_dir=None, apps_dir=None, map_dir=None, handrec_dir=None, handrec_cap=None):
    app = web.Application(middlewares=[no_cache, record_errors], client_max_size=ASSET_MAX_BYTES + 1024)
    app["registry"] = appsmod.Registry(apps_dir or ROOT / "apps")
    app["server_secret"] = appsmod.server_secret(Path(db_path).parent)
    app["limiter"] = appsmod.RateLimiter()
    app["sockets"] = {}   # (user, app) → open app sockets

    async def http_session(app):
        app["http"] = ClientSession(timeout=ClientTimeout(total=appsmod.PROXY_TIMEOUT_S))
        yield
        await app["http"].close()
    app.cleanup_ctx.append(http_session)
    app["assets_dir"] = Path(assets_dir or DATA / "assets")
    app["assets_dir"].mkdir(parents=True, exist_ok=True)
    app["store"] = Store(db_path)
    app["telemetry"] = Telemetry(telemetry_dir or DATA / "telemetry")
    app["hub"] = Hub()
    app["handrec"] = handrec.HandRecordings(Path(handrec_dir) if handrec_dir else Path(db_path).parent / "handrec",
                                            **({"cap_bytes": handrec_cap} if handrec_cap else {}))
    app["map"] = MapService(app["store"], app["hub"], Path(map_dir) if map_dir else Path(db_path).parent / "map")

    async def close_map(app):
        await app["map"].close()
    app.on_cleanup.append(close_map)
    app.add_routes(routes)
    app.router.add_static("/js", CLIENT / "js")
    app.router.add_static("/vendor", CLIENT / "vendor")
    return app


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", action="store_true", help="plain HTTP (put TLS in front yourself)")
    ap.add_argument("--port", type=int)
    ap.add_argument("--db", default=str(DATA / "stratum.db"))
    ap.add_argument("--telemetry-dir", default=str(DATA / "telemetry"))
    ap.add_argument("--assets-dir", default=str(DATA / "assets"))
    ap.add_argument("--apps-dir", default=str(ROOT / "apps"))
    ap.add_argument("--handrec-dir", default=None, help="hand recordings (default: next to the db)")
    args = ap.parse_args()
    DATA.mkdir(exist_ok=True)
    port = args.port or (8000 if args.http else 8930)
    ssl_ctx = None if args.http else ensure_cert()
    web.run_app(make_app(args.db, args.telemetry_dir, args.assets_dir, args.apps_dir, handrec_dir=args.handrec_dir), host="0.0.0.0", port=port, ssl_context=ssl_ctx,
               shutdown_timeout=3)   # don't wait on open long-polls (browser frames)


if __name__ == "__main__":
    main()
