"""Plants backend: every plant's life runs here, whether or not anyone is
looking. Soil dries out; dry plants lose health and wilt, healthy plants
grow toward maturity over days; dead plants stay dead until replanted.

State advances lazily (on read/write, from elapsed time), so there's no
tick loop except a cleanup of expired temporary plants. Plant ids are the
app instance ids, created on first look. DESIGN.md §6.5.
"""
import argparse
import asyncio
import json
import os
import time
from pathlib import Path

from aiohttp import web

from stratum_backend import Stratum

TIME_SCALE = float(os.environ.get("PLANTS_TIME_SCALE", 1))      # tests / demos speed time up
TEMP_TTL_MS = int(float(os.environ.get("PLANTS_TEMP_TTL_S", 3600)) * 1000)
WATER_AMOUNT = 0.6                # one watering adds this much moisture (cap 1.2 = soggy)

# Per species: days to full size, hours for wet soil (1.0) to dry out, hours
# a bone-dry plant survives, and the moisture below which it's thirsty.
SPECIES = {
    "succulent": {"name": "Succulent", "grow_days": 28, "dry_hours": 240, "wilt_hours": 240, "thirsty": 0.05},
    "snake": {"name": "Snake plant", "grow_days": 35, "dry_hours": 168, "wilt_hours": 168, "thirsty": 0.1},
    "pothos": {"name": "Pothos", "grow_days": 21, "dry_hours": 96, "wilt_hours": 72, "thirsty": 0.2},
}
SEEDLING = 0.15                   # growth when planted: a small nursery plant


def now_ms():
    return int(time.time() * 1000)


def stage(growth):
    return "seedling" if growth < 0.15 else "young" if growth < 0.5 else "mature" if growth < 0.95 else "full grown"


def advance(p, t=None):
    """Bring a plant up to time t (ms), integrating in small steps so drying,
    wilting and growth interact the way they would have."""
    t = t or now_ms()
    sp = SPECIES[p["species"]]
    hours = max(0.0, (t - p["updated"]) / 3_600_000 * TIME_SCALE)
    p["updated"] = t
    step = 1.0
    while hours > 0 and p["alive"]:
        h = min(step, hours)
        hours -= h
        p["moisture"] = max(0.0, p["moisture"] - h / sp["dry_hours"])
        dry = p["moisture"] <= 0
        soggy = p["moisture"] > 1.0
        if dry:
            p["health"] -= h / sp["wilt_hours"]
        elif soggy:
            p["health"] -= h / (sp["wilt_hours"] * 4)        # overwatering hurts, slowly
        elif p["moisture"] >= sp["thirsty"]:
            p["health"] = min(1.0, p["health"] + h / 24)      # recovers within a day
        if not dry and p["health"] > 0.3:
            p["growth"] = min(1.0, p["growth"] + h / (sp["grow_days"] * 24) * p["health"])
        if p["health"] <= 0:
            p["health"], p["alive"], p["died"] = 0.0, False, t
    for k in ("moisture", "health", "growth"):
        p[k] = round(p[k], 5)
    return p


def new_plant(pid, species, temporary=False):
    t = now_ms()
    return {"id": pid, "species": species, "planted": t, "updated": t, "growth": SEEDLING, "moisture": 0.8,
            "health": 1.0, "alive": True, "waterings": 0, "lastWatered": t, "temporary": temporary}


class Garden:
    def __init__(self, path, stratum):
        self.path = Path(path)
        self.stratum = stratum
        self.plants = json.loads(self.path.read_text()) if self.path.exists() else {}

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.plants))
        tmp.replace(self.path)

    def get(self, pid, species=None, temporary=False):
        if pid not in self.plants:
            self.plants[pid] = new_plant(pid, species if species in SPECIES else "pothos", temporary)
        p = advance(self.plants[pid])
        p["lastSeen"] = now_ms()
        self.save()
        return p

    def view(self, p):
        sp = SPECIES[p["species"]]
        return {**p, "name": sp["name"], "stage": stage(p["growth"]), "thirsty": p["alive"] and p["moisture"] < sp["thirsty"],
                "serverTime": now_ms(), "timeScale": TIME_SCALE,
                "dryHours": sp["dry_hours"], "growDays": sp["grow_days"]}

    async def water(self, pid, by):
        p = self.get(pid)
        if p["alive"]:
            p["moisture"] = round(min(1.2, p["moisture"] + WATER_AMOUNT), 5)
            p["waterings"] += 1
            p["lastWatered"] = now_ms()
        self.save()
        v = self.view(p)
        await self.stratum.broadcast(pid, {"type": "watered", "by": by, "plant": v})
        return v

    async def replant(self, pid, species):
        old = self.plants.get(pid)
        species = species if species in SPECIES else (old or {}).get("species", "pothos")
        self.plants[pid] = new_plant(pid, species, (old or {}).get("temporary", False))
        self.save()
        v = self.view(self.plants[pid])
        await self.stratum.broadcast(pid, {"type": "replanted", "plant": v})
        return v

    def expire(self):
        t = now_ms()
        gone = [k for k, v in self.plants.items() if v.get("temporary") and t - v.get("lastSeen", 0) > TEMP_TTL_MS]
        for k in gone:
            del self.plants[k]
        if gone:
            self.save()
        return gone


def make_app(state_path, stratum, cleanup_s=300):
    garden = Garden(state_path, stratum)
    routes = web.RouteTableDef()

    def plant_id(request):
        pid = request.match_info["id"]
        if not (1 <= len(pid) <= 64) or not all(c.isalnum() or c in "-_" for c in pid):
            raise web.HTTPBadRequest(text="bad plant id")
        return pid

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True, "plants": len(garden.plants)})

    @routes.get("/species")
    async def species(request):
        return web.json_response({k: {"name": v["name"]} for k, v in SPECIES.items()})

    @routes.get("/plants/{id}")
    async def get_plant(request):
        q = request.query
        return web.json_response(garden.view(garden.get(plant_id(request), q.get("species"), q.get("temp") == "1")))

    @routes.post("/plants/{id}/water")
    async def water(request):
        return web.json_response(await garden.water(plant_id(request), request["player"]["user"]))

    @routes.post("/plants/{id}/replant")
    async def replant(request):
        body = await request.json() if request.can_read_body else {}
        return web.json_response(await garden.replant(plant_id(request), (body or {}).get("species")))

    async def cleanup(app):
        async def loop():
            while True:
                await asyncio.sleep(cleanup_s)
                try:
                    garden.expire()
                except Exception as exc:
                    print("cleanup failed:", exc)
        task = asyncio.create_task(loop())
        yield
        task.cancel()
        await stratum.close()

    app = web.Application(middlewares=[stratum.middleware])
    app["garden"] = garden
    app.add_routes(routes)
    app.cleanup_ctx.append(cleanup)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8004)))
    ap.add_argument("--state", default=os.environ.get("PLANTS_STATE", "/data/plants.json"))
    args = ap.parse_args()
    Path(args.state).parent.mkdir(parents=True, exist_ok=True)
    web.run_app(make_app(args.state, Stratum.from_env("plants")), host="0.0.0.0", port=args.port)
