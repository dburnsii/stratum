"""Fish tank backend: the tank simulation runs here, all the time, whether
or not anyone is looking. Fish get hungry (a starving fish is sluggish and
pale, but fish never die). Clients never
stream fish positions: they get *swim plans* (a looping path + start time)
and animate locally from the shared clock (DESIGN.md §6.5).

Tank ids are the app instance ids, created on first look. Tank frame:
meters, origin at the tank's floor center, y up, size `SIZE`.
"""
import argparse
import asyncio
import json
import math
import os
import random
import time
from pathlib import Path

from aiohttp import web

from stratum_backend import Stratum

SIZE = (0.6, 0.36, 0.3)           # w (x), h (y), d (z)
MARGIN = 0.035
WATER_Y = SIZE[1] - 0.025         # the surface
HUNGER_HOURS = float(os.environ.get("FISH_HUNGER_HOURS", 8))   # full → starving
TIME_SCALE = float(os.environ.get("FISH_TIME_SCALE", 1))       # tests speed time up
TICK_S = float(os.environ.get("FISH_TICK_S", 5))
PLAN_S = 45                       # how long one swim loop takes (before speed)
TEMP_TTL_MS = int(float(os.environ.get("FISH_TEMP_TTL_S", 3600)) * 1000)   # unseen temporary tanks expire
NAMES = ["Bubbles", "Finn", "Coral", "Nemo", "Dory", "Goldie", "Splash", "Pebble", "Ziggy", "Mango"]
COLORS = ["#ff8c1a", "#ffd23f", "#3ec1d3", "#ff5d73", "#a06cd5", "#7bd389"]
MAX_FISH = 30
# Species: body length range (m), where in the water they like to be (fraction
# of the water depth), how fast they swim (loop period factor; lower = faster),
# and how many come together (a school shares one plan).
SPECIES = {
    "clown":      {"length": (0.04, 0.05), "band": (0.15, 0.6), "pace": 1.0, "school": 1, "color": "#ff7b1c"},
    "bluetang":   {"length": (0.06, 0.075), "band": (0.3, 0.85), "pace": 0.8, "school": 1, "color": "#2f6fe0"},
    "yellowtang": {"length": (0.055, 0.065), "band": (0.3, 0.85), "pace": 0.85, "school": 1, "color": "#ffd60a"},
    "angel":      {"length": (0.05, 0.06), "band": (0.35, 0.8), "pace": 1.3, "school": 1, "color": "#d9dde3"},
    "betta":      {"length": (0.045, 0.055), "band": (0.6, 0.92), "pace": 1.5, "school": 1, "color": "#c1121f"},
    "goldfish":   {"length": (0.05, 0.065), "band": (0.2, 0.7), "pace": 1.1, "school": 1, "color": "#ff9f1c"},
    "guppy":      {"length": (0.025, 0.032), "band": (0.5, 0.9), "pace": 0.9, "school": 1, "color": "#ff5d73"},
    "discus":     {"length": (0.055, 0.065), "band": (0.3, 0.7), "pace": 1.4, "school": 1, "color": "#e85d04"},
    "mandarin":   {"length": (0.035, 0.042), "band": (0.05, 0.25), "pace": 1.6, "school": 1, "color": "#3a86ff"},
    "neon":       {"length": (0.02, 0.025), "band": (0.3, 0.75), "pace": 0.7, "school": 6, "color": "#4cc9f0"},
}
STARTER = ["neon", "clown", "clown", "bluetang", "yellowtang", "angel", "betta", "goldfish", "guppy", "guppy", "discus", "mandarin"]


def now_ms():
    return int(time.time() * 1000)


FLOOR_Y = 0.05                    # above the sand and decor
SCHOOL_M = 0.025                  # school members swim this far off the shared path (client side)


def rand_point(rng, species=None, margin=MARGIN):
    w, h, d = SIZE
    lo, hi = SPECIES.get(species, {}).get("band", (0.0, 1.0))
    top = WATER_Y - margin
    y0 = FLOOR_Y + (top - FLOOR_Y) * lo
    y1 = FLOOR_Y + (top - FLOOR_Y) * hi
    return [round(rng.uniform(-w / 2 + margin, w / 2 - margin), 3),
            round(rng.uniform(y0, y1), 3),
            round(rng.uniform(-d / 2 + margin, d / 2 - margin), 3)]


def margin_for(species, length=0.05):
    m = MARGIN + length * 0.4
    return m + (SCHOOL_M if SPECIES.get(species, {}).get("school", 1) > 1 else 0)


def new_plan(rng, start=None, toward=None, species=None, length=0.05):
    """A closed loop of waypoints. `toward` puts a stop near a food point."""
    m = margin_for(species, length)
    pts = [start or rand_point(rng, species, m)]
    if toward:
        pts.append([toward[0] + rng.uniform(-0.02, 0.02), WATER_Y - 0.04, toward[1] + rng.uniform(-0.02, 0.02)])
        pts.append([toward[0], 0.07, toward[1]])
    pts += [rand_point(rng, species, m) for _ in range(4 - len(pts) + 2)]
    pace = SPECIES.get(species, {}).get("pace", 1.0)
    return {"t0": now_ms(), "period": round(PLAN_S * pace * rng.uniform(0.8, 1.3), 1), "points": pts}


def new_fish(rng, i, species=None):
    """One fish, or for schooling species a list of them sharing one plan."""
    species = species or rng.choice(list(SPECIES))
    sp = SPECIES[species]
    length = round(rng.uniform(*sp["length"]), 3)
    plan = new_plan(rng, species=species, length=length)
    school = f"s{rng.randrange(1 << 30):x}" if sp["school"] > 1 else None
    out = []
    for k in range(sp["school"]):
        out.append({"id": f"f{i + k}-{rng.randrange(1 << 30):x}", "name": rng.choice(NAMES), "species": species,
                    "color": sp["color"], "length": round(length * rng.uniform(0.92, 1.08), 3),
                    "hunger": round(rng.uniform(0.1, 0.4), 3), "alive": True, "born": now_ms(), "plan": plan,
                    **({"school": school, "slot": k} if school else {})})
    return out


def migrate(rng, tank):
    """Older tanks: everyone's alive again, fish get a species, the new kinds move in."""
    if tank.get("v", 1) >= 2:
        return False
    for f in tank["fish"]:
        f["alive"] = True
        f.pop("died", None)
        f["hunger"] = min(f.get("hunger", 0.5), 0.8)
        if not f.get("species"):
            f["species"] = rng.choice([k for k, v in SPECIES.items() if v["school"] == 1])
            f["plan"] = new_plan(rng, species=f["species"], length=f["length"])
    have = {f["species"] for f in tank["fish"]}
    for sp in dict.fromkeys(STARTER):
        if sp not in have and len(tank["fish"]) < MAX_FISH:
            tank["fish"] += new_fish(rng, len(tank["fish"]), sp)
    tank["v"] = 2
    return True


class Tanks:
    def __init__(self, path, stratum):
        self.path = Path(path)
        self.stratum = stratum
        self.tanks = json.loads(self.path.read_text()) if self.path.exists() else {}
        self.rng = random.Random()

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.tanks))
        tmp.replace(self.path)

    def get(self, tank_id, temporary=False):
        if tank_id not in self.tanks:
            fish = []
            for sp in STARTER:
                fish += new_fish(self.rng, len(fish), sp)
            self.tanks[tank_id] = {"id": tank_id, "created": now_ms(), "fish": fish, "v": 2,
                                   "food": [], "lastTick": now_ms(), "temporary": temporary}
            self.save()
        elif migrate(self.rng, self.tanks[tank_id]):
            self.save()
        self.tanks[tank_id]["lastSeen"] = now_ms()
        return self.tanks[tank_id]

    def view(self, tank):
        return {**tank, "size": SIZE, "serverTime": now_ms(), "hungerHours": HUNGER_HOURS / TIME_SCALE}

    async def tick(self):
        """Advance every tank: hunger rises (to starving, never past), plans refresh."""
        t = now_ms()
        changed = []
        for tid in [k for k, v in self.tanks.items() if v.get("temporary") and t - v.get("lastSeen", 0) > TEMP_TTL_MS]:
            del self.tanks[tid]   # a temporary space's tank nobody has looked at in a while
        for tank in self.tanks.values():
            dt_h = (t - tank["lastTick"]) / 3_600_000 * TIME_SCALE
            tank["lastTick"] = t
            migrate(self.rng, tank)
            schools = {}
            for f in tank["fish"]:
                f["hunger"] = round(min(1.0, f["hunger"] + dt_h / HUNGER_HOURS), 4)
                if t - f["plan"]["t0"] > f["plan"]["period"] * 1000 * 3:   # swim somewhere new now and then
                    key = f.get("school") or f["id"]
                    if key not in schools:
                        schools[key] = new_plan(self.rng, species=f.get("species"), length=f["length"])
                    f["plan"] = schools[key]
            tank["food"] = [x for x in tank["food"] if t - x["t"] < 20_000]
            if schools:
                changed.append((tank["id"], {"type": "plans"}))
        if self.tanks:
            self.save()
        for tank_id, msg in changed:
            await self.stratum.broadcast(tank_id, msg)

    async def feed(self, tank_id, x, z, by):
        tank = self.get(tank_id)
        w, _, d = SIZE
        x = max(-w / 2 + MARGIN, min(w / 2 - MARGIN, x))
        z = max(-d / 2 + MARGIN, min(d / 2 - MARGIN, z))
        food = {"x": round(x, 3), "z": round(z, 3), "t": now_ms(), "by": by}
        tank["food"].append(food)
        fed, schools = [], {}
        for f in tank["fish"]:
            f["hunger"] = round(max(0.0, f["hunger"] - 0.5), 4)
            key = f.get("school") or f["id"]
            if key not in schools:
                schools[key] = new_plan(self.rng, toward=(x, z), species=f.get("species"), length=f["length"])
            f["plan"] = schools[key]
            fed.append({"id": f["id"], "hunger": f["hunger"], "plan": f["plan"]})
        self.save()
        await self.stratum.broadcast(tank_id, {"type": "fed", "food": food, "fish": fed})
        return fed

    async def add(self, tank_id, species=None):
        """A new fish (or a school) of `species` (random if None), up to MAX_FISH."""
        tank = self.get(tank_id)
        if species is not None and species not in SPECIES:
            raise web.HTTPBadRequest(text="unknown species")
        new = new_fish(self.rng, len(tank["fish"]), species)
        tank["fish"] += new[:max(0, MAX_FISH - len(tank["fish"]))]
        self.save()
        await self.stratum.broadcast(tank_id, {"type": "restocked"})
        return tank


def make_app(state_path, stratum, tick_s=TICK_S):
    tanks = Tanks(state_path, stratum)
    routes = web.RouteTableDef()

    def tank_id(request):
        tid = request.match_info["id"]
        if not (1 <= len(tid) <= 64) or not all(c.isalnum() or c in "-_" for c in tid):
            raise web.HTTPBadRequest(text="bad tank id")
        return tid

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True, "tanks": len(tanks.tanks)})

    @routes.get("/tanks/{id}")
    async def get_tank(request):
        return web.json_response(tanks.view(tanks.get(tank_id(request), temporary=request.query.get("temp") == "1")))

    @routes.post("/tanks/{id}/feed")
    async def feed(request):
        body = await request.json()
        x, z = body.get("x", 0), body.get("z", 0)
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, z)):
            raise web.HTTPBadRequest(text="x, z must be numbers")
        fed = await tanks.feed(tank_id(request), float(x), float(z), request["player"]["user"])
        return web.json_response({"fed": len(fed)})

    @routes.post("/tanks/{id}/fish")
    async def add_fish(request):
        body = await request.json() if request.can_read_body else {}
        return web.json_response(tanks.view(await tanks.add(tank_id(request), body.get("species"))))

    @routes.post("/tanks/{id}/restock")   # older clients: a random new fish
    async def restock(request):
        return web.json_response(tanks.view(await tanks.add(tank_id(request))))

    async def sim(app):
        async def loop():
            while True:
                await asyncio.sleep(tick_s)
                try:
                    await tanks.tick()
                except Exception as exc:   # keep the sim alive
                    print("tick failed:", exc)
        task = asyncio.create_task(loop())
        yield
        task.cancel()
        await stratum.close()

    app = web.Application(middlewares=[stratum.middleware])
    app["tanks"] = tanks
    app.add_routes(routes)
    app.cleanup_ctx.append(sim)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8002)))
    ap.add_argument("--state", default=os.environ.get("FISH_STATE", "/data/fishtank.json"))
    args = ap.parse_args()
    Path(args.state).parent.mkdir(parents=True, exist_ok=True)
    web.run_app(make_app(args.state, Stratum.from_env("fishtank")), host="0.0.0.0", port=args.port)
