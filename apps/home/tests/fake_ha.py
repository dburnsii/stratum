"""A tiny Home Assistant stand-in: the WebSocket API subset the home
backend uses (auth, registries, get_states, subscribe_events, call_service).
Run standalone for e2e tests: python fake_ha.py --port N"""
import argparse
import asyncio
import copy
import json

from aiohttp import WSMsgType, web

TOKEN = "test-token"
AREAS = [{"area_id": "living", "name": "Living Room"}, {"area_id": "kitchen", "name": "Kitchen"}]
DEVICES = [{"id": "dev-1", "area_id": "kitchen"}]
ENTITIES = [
    {"entity_id": "light.kitchen", "device_id": "dev-1", "area_id": None},
    {"entity_id": "switch.fan_plug", "area_id": "living"},
    {"entity_id": "sensor.living_temp", "area_id": "living"},
    {"entity_id": "scene.movie", "area_id": "living"},
    {"entity_id": "button.kitchen_ping", "device_id": "dev-1", "entity_category": "diagnostic"},
    {"entity_id": "lock.front_door", "area_id": "living"},
]
STATES = {
    "light.kitchen": {"state": "off", "attributes": {"friendly_name": "Kitchen Lights", "brightness": None}},
    "switch.fan_plug": {"state": "on", "attributes": {"friendly_name": "Fan Plug"}},
    "sensor.living_temp": {"state": "21.53", "attributes": {"friendly_name": "Living Temp", "unit_of_measurement": "°C"}},
    "scene.movie": {"state": "unknown", "attributes": {"friendly_name": "Movie Time"}},
    "button.kitchen_ping": {"state": "unknown", "attributes": {"friendly_name": "Kitchen Ping"}},
    "lock.front_door": {"state": "locked", "attributes": {"friendly_name": "Front Door"}},
}


def make_app():
    states = {k: {"entity_id": k, **copy.deepcopy(v)} for k, v in STATES.items()}
    subs = []          # (ws, subscription id)
    calls = []         # service calls received, for assertions

    async def emit(entity_id):
        for ws, sid in list(subs):
            try:
                await ws.send_json({"id": sid, "type": "event", "event": {"event_type": "state_changed",
                                    "data": {"entity_id": entity_id, "new_state": states[entity_id]}}})
            except ConnectionResetError:
                subs.remove((ws, sid))

    async def websocket(request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_json({"type": "auth_required"})
        auth = await ws.receive_json()
        if auth.get("access_token") != TOKEN:
            await ws.send_json({"type": "auth_invalid"})
            return ws
        await ws.send_json({"type": "auth_ok"})
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            m = json.loads(msg.data)
            i, t = m.get("id"), m.get("type")
            result = None
            if t == "config/area_registry/list":
                result = AREAS
            elif t == "config/device_registry/list":
                result = DEVICES
            elif t == "config/entity_registry/list":
                result = ENTITIES
            elif t == "get_states":
                result = list(states.values())
            elif t == "subscribe_events":
                subs.append((ws, i))
            elif t == "call_service":
                eid = m["target"]["entity_id"]
                calls.append((m["domain"], m["service"], eid, m.get("service_data", {})))
                s = states[eid]
                if m["service"] == "toggle":
                    s["state"] = "off" if s["state"] == "on" else "on"
                elif m["service"] in ("turn_on", "turn_off") and m["domain"] in ("light", "switch"):
                    s["state"] = m["service"][5:]
                await ws.send_json({"id": i, "type": "result", "success": True, "result": None})
                await emit(eid)
                continue
            await ws.send_json({"id": i, "type": "result", "success": True, "result": result})
        return ws

    async def set_state(request):   # test control: change a state from "outside" (someone flips a real switch)
        body = await request.json()
        states[body["entity_id"]]["state"] = body["state"]
        await emit(body["entity_id"])
        return web.json_response({"ok": True})

    async def get_calls(request):
        return web.json_response({"calls": calls})

    app = web.Application()
    app["calls"], app["states"], app["emit"] = calls, states, emit
    app.router.add_get("/api/websocket", websocket)
    app.router.add_post("/test/state", set_state)
    app.router.add_get("/test/calls", get_calls)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    web.run_app(make_app(), host="127.0.0.1", port=ap.parse_args().port)
