"""App platform on the server: registry, toggles, signed proxy, broadcasts,
channels, state, static files."""
import hashlib
import hmac
import json
import sys
import uuid
from pathlib import Path

import pytest
from aiohttp import web

from server import make_app

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sdk"))
from stratum_backend import Stratum  # noqa: E402

SECRET = "golf-test-secret"


@pytest.fixture
async def fake_backend(aiohttp_server):
    """Records what the proxy sends; verifies like a real backend would."""
    seen = []
    verifier = Stratum("golf", SECRET, "http://unused")

    async def handler(request):
        if request.path == "/echo-ws":   # a WebSocket: says who it is, then echoes
            player = verifier.verify(request)
            if not player:
                return web.Response(status=401)
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_str(json.dumps({"player": player["user"], "path": request.path_qs}))
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    await ws.send_str("echo:" + msg.data)
                elif msg.type == web.WSMsgType.BINARY:
                    await ws.send_bytes(msg.data[::-1])
            return ws
        seen.append({"path": request.path_qs, "method": request.method, "headers": dict(request.headers),
                     "body": await request.text(), "player": verifier.verify(request)})
        if request.path == "/boom":
            return web.Response(status=500, text="kaboom")
        if request.path == "/big":   # several network chunks
            return web.Response(body=bytes(range(256)) * 1200, content_type="image/jpeg", headers={"X-App-Seq": "7", "X-Secret": "no"})
        return web.json_response({"ok": True, "echo": request.path_qs})
    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handler)
    server = await aiohttp_server(app)
    server.seen = seen
    return server


@pytest.fixture
async def server(aiohttp_server, tmp_path, fake_backend, monkeypatch):
    monkeypatch.setenv("STRATUM_APP_SECRET_GOLF", SECRET)
    monkeypatch.setenv("STRATUM_APP_BACKEND_GOLF", str(fake_backend.make_url("")))
    monkeypatch.setenv("STRATUM_APP_SECRET_FISHTANK", "fish-secret")
    monkeypatch.setenv("STRATUM_APP_BACKEND_FISHTANK", "http://127.0.0.1:9")   # nothing listens
    return await aiohttp_server(make_app(str(tmp_path / "t.db"), tmp_path / "tel", tmp_path / "assets", ROOT / "apps"))


async def login(aiohttp_client, server, name=None):
    c = await aiohttp_client(server)
    r = await c.post("/api/login", json={"name": name or "u" + uuid.uuid4().hex[:8]})
    assert r.status == 200
    return c


async def test_registry_lists_apps_off_by_default(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    apps = {a["id"]: a for a in (await (await c.get("/api/apps")).json())["apps"]}
    assert {"golf", "fishtank"} <= set(apps)
    assert apps["golf"]["enabled"] is False and apps["golf"]["layer"] is None
    assert apps["golf"]["entry"] == "/apps/golf/client.js" and "physics" in apps["golf"]["permissions"]


async def test_toggle_creates_private_app_layer(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    on = await (await c.put("/api/apps/golf", json={"enabled": True})).json()
    assert on["enabled"] and on["layer"]
    me = await (await c.get("/api/me")).json()
    layer = next(l for l in me["layers"] if l["id"] == on["layer"])
    assert (layer["kind"], layer["role"]) == ("app", "admin")
    again = await (await c.put("/api/apps/golf", json={"enabled": True})).json()
    assert again["layer"] == on["layer"]                        # stable
    assert (await c.put("/api/apps/nope", json={"enabled": True})).status == 404


async def test_proxy_requires_app_on_and_signs_pseudonymous_identity(aiohttp_client, server, fake_backend):
    a = await login(aiohttp_client, server, "alice")
    assert (await a.get("/apps/golf/api/courses")).status == 403   # off
    await a.put("/api/apps/golf", json={"enabled": True})
    r = await a.post("/apps/golf/api/scores?x=1", json={"strokes": 3})
    assert r.status == 200 and (await r.json())["echo"] == "/scores?x=1"
    req = fake_backend.seen[-1]
    assert req["player"] is not None, "signature must verify"
    assert req["headers"]["X-Stratum-Name"] == ""                  # golf has no 'identity' permission
    assert req["body"] == json.dumps({"strokes": 3})
    assert "Cookie" not in req["headers"]                          # never forward the session
    b = await login(aiohttp_client, server, "bob")
    await b.put("/api/apps/golf", json={"enabled": True})
    await b.get("/apps/golf/api/courses")
    await a.get("/apps/golf/api/courses")
    ids = [s["player"]["user"] for s in fake_backend.seen[-2:]]
    assert ids[0] != ids[1] and ids[1] == req["player"]["user"]   # per-user, stable


async def test_tampered_signature_is_rejected_by_sdk():
    s = Stratum("golf", SECRET, "http://unused")

    class Req:
        method, path_qs = "GET", "/courses"
        headers = {"X-Stratum-App": "golf", "X-Stratum-User": "abc", "X-Stratum-Name": "",
                   "X-Stratum-Time": "0", "X-Stratum-Signature": "00"}
    assert s.verify(Req) is None


async def test_proxy_passes_backend_errors_and_reports_down(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    await c.put("/api/apps/golf", json={"enabled": True})
    assert (await c.get("/apps/golf/api/boom")).status == 500
    await c.put("/api/apps/fishtank", json={"enabled": True})
    r = await c.get("/apps/fishtank/api/tanks/x")
    assert r.status == 502 and "unavailable" in await r.text()


async def recv(ws):
    """Next message, skipping app-room host announcements."""
    while True:
        m = await ws.receive_json(timeout=2)
        if m.get("t") != "host":
            return m


async def test_broadcast_reaches_channel_members_only(aiohttp_client, server):
    member = await login(aiohttp_client, server)
    await member.put("/api/apps/golf", json={"enabled": True})
    ws = await member.ws_connect("/ws")
    await ws.receive_json()                                          # hello
    await ws.send_json({"t": "appsub", "channels": [{"app": "golf", "channel": "course-1"}]})
    assert (await ws.receive_json())["channels"] == ["app:golf:course-1"]

    off = await login(aiohttp_client, server)                         # app off → can't join
    ws2 = await off.ws_connect("/ws")
    await ws2.receive_json()
    await ws2.send_json({"t": "appsub", "channels": [{"app": "golf", "channel": "course-1"}]})
    assert (await ws2.receive_json())["channels"] == []

    anon = await aiohttp_client(server)
    bad = await anon.post("/api/apps/golf/broadcast", json={"channel": "course-1", "msg": 1},
                          headers={"Authorization": "Bearer wrong"})
    assert bad.status == 401
    ok = await anon.post("/api/apps/golf/broadcast", json={"channel": "course-1", "msg": {"type": "sunk"}},
                         headers={"Authorization": f"Bearer {SECRET}"})
    assert (await ok.json())["delivered"] == 1
    msg = await recv(ws)
    assert msg == {"t": "app", "app": "golf", "channel": "course-1", "msg": {"type": "sunk"}, "from": "backend"}
    await ws.close()
    await ws2.close()


async def test_clients_relay_in_channel_with_pseudonym(aiohttp_client, server):
    socks = []
    for _ in range(2):
        c = await login(aiohttp_client, server)
        await c.put("/api/apps/golf", json={"enabled": True})
        ws = await c.ws_connect("/ws")
        await ws.receive_json()
        await ws.send_json({"t": "appsub", "channels": [{"app": "golf", "channel": "c"}]})
        await ws.receive_json()
        socks.append(ws)
    await socks[0].send_json({"t": "app", "app": "golf", "channel": "c", "msg": {"type": "shot"}})
    got = await recv(socks[1])
    assert got["msg"] == {"type": "shot"} and len(got["from"]) == 16
    for ws in socks:
        await ws.close()


async def test_app_state_needs_permission(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    await c.put("/api/apps/golf", json={"enabled": True})
    assert (await (await c.get("/api/apps/golf/state/hole")).json())["value"] is None
    assert (await c.put("/api/apps/golf/state/hole", json={"value": 2})).status == 200
    assert (await (await c.get("/api/apps/golf/state/hole")).json())["value"] == 2
    await c.put("/api/apps/fishtank", json={"enabled": True})
    assert (await c.get("/api/apps/fishtank/state/x")).status == 403   # no 'state' permission
    assert (await c.put("/api/apps/golf/state/big", data=json.dumps({"value": "x" * 20000}))).status == 400


async def test_app_static_serves_client_dir_only(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    assert (await c.get("/apps/golf/client.js")).status == 200
    assert (await c.get("/apps/golf/manifest.json")).status == 404
    assert (await c.get("/apps/golf/%2e%2e/backend/server.py")).status == 404



async def test_proxy_returns_large_bodies_whole_and_app_headers_only(aiohttp_client, server):
    """Regression: content.read(n) returned only the first chunk, truncating
    browser frames ('source image could not be decoded')."""
    c = await login(aiohttp_client, server)
    await c.put("/api/apps/golf", json={"enabled": True})
    r = await c.get("/apps/golf/api/big")
    body = await r.read()
    assert len(body) == 256 * 1200 and body == bytes(range(256)) * 1200
    assert r.headers["X-App-Seq"] == "7" and "X-Secret" not in r.headers


async def test_app_settings_follow_the_manifest_schema(aiohttp_client, server):
    c = await login(aiohttp_client, server)
    r = await c.put("/api/apps/plants/settings", json={"lapse": 10})
    assert r.status == 200 and (await r.json())["values"] == {"lapse": 10}
    assert (await c.put("/api/apps/plants/settings", json={"lapse": 7})).status == 400        # not an option
    assert (await c.put("/api/apps/plants/settings", json={"bogus": 1})).status == 400        # not in the schema
    assert (await c.put("/api/apps/golf/settings", json={"board": "yes"})).status == 400      # toggles are booleans
    apps = {a["id"]: a for a in (await (await c.get("/api/apps")).json())["apps"]}
    assert apps["plants"]["settingsValues"] == {"lapse": 10}
    assert apps["plants"]["settings"][0]["key"] == "lapse" and apps["plants"]["category"] == "Decor"



async def test_encoded_queries_are_signed_as_sent(aiohttp_client, server, fake_backend):
    """The signature covers the path as the backend sees it (still %-encoded)."""
    a = await login(aiohttp_client, server)
    await a.put("/api/apps/golf", json={"enabled": True})
    for qs in ("q=Page%20Tw", "target=me%40box.lan"):
        r = await a.get(f"/apps/golf/api/suggest?{qs}")
        assert r.status == 200, qs                                            # (the test client may re-quote %40 itself)
        assert fake_backend.seen[-1]["player"] is not None, qs              # the signature held
    assert fake_backend.seen[-1]["player"] is not None


async def test_app_sockets_are_proxied_signed_and_both_ways(aiohttp_client, server):
    a = await login(aiohttp_client, server)
    assert (await a.get("/apps/golf/socket/echo-ws")).status == 403            # app off
    await a.put("/api/apps/golf", json={"enabled": True})
    ws = await a.ws_connect("/apps/golf/socket/echo-ws?room=a%20b")
    hello = json.loads((await ws.receive()).data)
    assert hello["player"] and hello["path"] == "/echo-ws?room=a%20b"         # signed identity reached it
    await ws.send_str("hi")
    assert (await ws.receive()).data == "echo:hi"
    await ws.send_bytes(b"\x01\x02\x03")
    assert (await ws.receive()).data == b"\x03\x02\x01"                       # binary too
    await ws.close()
    other = await login(aiohttp_client, server)
    assert (await other.get("/apps/golf/socket/echo-ws")).status == 403        # someone without the app
