"""Home backend: Stratum ↔ Home Assistant. The HA token lives only here
(env HA_TOKEN); devices talk to Stratum, never to HA. DESIGN.md §6.5.

One WebSocket to HA (reconnecting): registries (areas, devices, entities)
for the picker, a live state cache from `state_changed` events, and
service calls. State changes of entities someone is looking at ("watched":
fetched via /states in the last WATCH_S) are broadcast to the Stratum
channel `e-<entity_id>`.

Who may use it: Stratum usernames in HOME_USERS (comma-separated; the app
has the `identity` permission so requests carry the name). Stratum
sign-in is username-only for now, so this keeps honest people out, not
attackers on the LAN.
"""
import argparse
import asyncio
import json
import os
import time

from aiohttp import ClientSession, WSMsgType, web

from stratum_backend import Stratum

# What the app shows and what it may do, per domain.
ACTIONS = {
    "light": {"toggle", "turn_on", "turn_off"},
    "switch": {"toggle", "turn_on", "turn_off"},
    "fan": {"toggle", "turn_on", "turn_off"},
    "input_boolean": {"toggle", "turn_on", "turn_off"},
    "scene": {"turn_on"},
    "script": {"turn_on"},
    "button": {"press"},
    "media_player": {"media_play_pause"},
    "sensor": set(),
    "binary_sensor": set(),
    "climate": set(),
}
ATTRS = ("friendly_name", "unit_of_measurement", "device_class", "brightness", "rgb_color", "color_mode",
         "current_temperature", "temperature", "target_temp_low", "target_temp_high", "media_title", "icon")
WATCH_S = 600


def now():
    return time.time()


def slim(state):
    if not state:
        return None
    a = state.get("attributes", {})
    return {"id": state["entity_id"], "state": state["state"], "attrs": {k: a[k] for k in ATTRS if k in a}}


class HA:
    """One reconnecting WebSocket session with Home Assistant."""

    def __init__(self, url, token, on_change):
        self.url = url.rstrip("/")
        self.token = token
        self.on_change = on_change
        self.states, self.entities, self.devices, self.areas = {}, {}, {}, {}
        self.ws = None
        self.pending = {}
        self.next_id = 1
        self.ready = asyncio.Event()
        self.task = None

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task   # closes the WebSocket cleanly
            except (asyncio.CancelledError, Exception):
                pass

    async def run(self):
        backoff = 1
        while True:
            try:
                async with ClientSession() as http:
                    async with http.ws_connect(f"{self.url}/api/websocket", heartbeat=30) as ws:
                        await self.session(ws)
                        backoff = 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print("home assistant connection:", exc)
            self.ready.clear()
            self.ws = None
            for f in self.pending.values():
                if not f.done():
                    f.set_exception(ConnectionError("home assistant disconnected"))
            self.pending.clear()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    async def session(self, ws):
        assert (await ws.receive_json())["type"] == "auth_required"
        await ws.send_json({"type": "auth", "access_token": self.token})
        if (await ws.receive_json())["type"] != "auth_ok":
            raise PermissionError("home assistant rejected the token")
        self.ws = ws
        reader = asyncio.create_task(self.read(ws))
        try:
            areas, devices, entities, states = await asyncio.gather(
                self.cmd({"type": "config/area_registry/list"}), self.cmd({"type": "config/device_registry/list"}),
                self.cmd({"type": "config/entity_registry/list"}), self.cmd({"type": "get_states"}))
            self.areas = {a["area_id"]: a["name"] for a in areas}
            self.devices = {d["id"]: d for d in devices}
            self.entities = {e["entity_id"]: e for e in entities}
            self.states = {s["entity_id"]: s for s in states}
            await self.cmd({"type": "subscribe_events", "event_type": "state_changed"})
            self.ready.set()
            print(f"home assistant: {len(self.states)} entities")
            await reader
        finally:
            reader.cancel()

    async def read(self, ws):
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            m = json.loads(msg.data)
            if m.get("type") == "event":
                data = m["event"].get("data", {})
                new = data.get("new_state")
                if new:
                    self.states[new["entity_id"]] = new
                else:
                    self.states.pop(data.get("entity_id"), None)
                await self.on_change(data.get("entity_id"), new)
            elif m.get("type") == "result" and m.get("id") in self.pending:
                f = self.pending.pop(m["id"])
                if m.get("success"):
                    f.set_result(m.get("result"))
                else:
                    f.set_exception(RuntimeError(m.get("error", {}).get("message", "home assistant error")))

    async def cmd(self, payload, timeout=10):
        if not self.ws:
            raise ConnectionError("not connected to home assistant")
        i = self.next_id
        self.next_id += 1
        f = asyncio.get_running_loop().create_future()
        self.pending[i] = f
        await self.ws.send_json({"id": i, **payload})
        return await asyncio.wait_for(f, timeout)

    def listing(self):
        """Controllable/readable entities, for the picker: no hidden,
        disabled, diagnostic or config entities; grouped by area."""
        out = []
        for eid, s in self.states.items():
            domain = eid.split(".", 1)[0]
            if domain not in ACTIONS:
                continue
            reg = self.entities.get(eid, {})
            if reg.get("entity_category") or reg.get("hidden_by") or reg.get("disabled_by"):
                continue
            area_id = reg.get("area_id") or self.devices.get(reg.get("device_id"), {}).get("area_id")
            out.append({**slim(s), "domain": domain, "area": self.areas.get(area_id, ""),
                        "name": s.get("attributes", {}).get("friendly_name") or eid, "actions": sorted(ACTIONS[domain])})
        return sorted(out, key=lambda e: (e["area"] == "", e["area"], e["state"] == "unavailable", e["name"].lower()))


def make_app(stratum, ha_url, ha_token, users):
    watched = {}   # entity id -> last time someone fetched it

    async def on_change(entity_id, new):
        if entity_id and watched.get(entity_id, 0) > now() - WATCH_S:
            await stratum.broadcast(f"e-{entity_id}", {"type": "state", "entity": slim(new) or {"id": entity_id, "state": "unavailable", "attrs": {}}})

    ha = HA(ha_url, ha_token, on_change)
    routes = web.RouteTableDef()

    @web.middleware
    async def allowed(request, handler):
        if request.path != "/health":
            name = request.get("player", {}).get("name", "")
            if name not in users and "*" not in users:   # "*": anyone (dev/tests only)
                raise web.HTTPForbidden(text=f"'{name or 'unknown'}' may not use Home: add it to HOME_USERS on the server")
        return await handler(request)

    async def ready():
        try:
            await asyncio.wait_for(ha.ready.wait(), 5)
        except asyncio.TimeoutError:
            raise web.HTTPServiceUnavailable(text="Home Assistant is not connected")

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True, "connected": ha.ready.is_set(), "entities": len(ha.states)})

    @routes.get("/entities")
    async def entities(request):
        await ready()
        return web.json_response({"entities": ha.listing()})

    @routes.get("/states")
    async def states(request):
        await ready()
        ids = [i for i in request.query.get("ids", "").split(",") if i][:50]
        t = now()
        for i in ids:
            watched[i] = t
        return web.json_response({"states": {i: slim(ha.states.get(i)) for i in ids}})

    @routes.post("/call")
    async def call(request):
        await ready()
        body = await request.json()
        entity, action = str(body.get("entity", "")), str(body.get("action", ""))
        domain = entity.split(".", 1)[0]
        if entity not in ha.states or action not in ACTIONS.get(domain, set()):
            raise web.HTTPBadRequest(text=f"can't {action} {entity}")
        data = {}
        if domain == "light" and action == "turn_on" and isinstance(body.get("brightness_step_pct"), (int, float)):
            data["brightness_step_pct"] = max(-100, min(100, int(body["brightness_step_pct"])))
        try:
            await ha.cmd({"type": "call_service", "domain": domain, "service": action,
                          "service_data": data, "target": {"entity_id": entity}})
        except Exception as exc:
            raise web.HTTPBadGateway(text=f"home assistant: {exc}")
        watched[entity] = now()
        return web.json_response({"ok": True})

    async def lifecycle(app):
        ha.start()
        yield
        await ha.stop()
        await stratum.close()

    app = web.Application(middlewares=[stratum.middleware, allowed])
    app["ha"] = ha
    app.add_routes(routes)
    app.cleanup_ctx.append(lifecycle)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8005)))
    args = ap.parse_args()
    token = os.environ.get("HA_TOKEN") or exit("HA_TOKEN is not set")
    users = {u.strip() for u in os.environ.get("HOME_USERS", "").split(",") if u.strip()}
    web.run_app(make_app(Stratum.from_env("home"), os.environ.get("HA_URL", "http://localhost:8123"), token, users),
                host="0.0.0.0", port=args.port)
