"""Mini golf backend: course definitions + leaderboard.

Reached only through Stratum's proxy (/apps/golf/api/...), which signs who
the player is. Courses are tabletop scale, meters, in the course frame:
x right, y up, z toward the player (the tee is at +z, the hole at -z).
"""
import argparse
import os
import sqlite3
import time
from pathlib import Path

from aiohttp import web

from stratum_backend import Stratum

WALL_H = 0.025


def border(x0, z0, x1, z1):
    return [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]


COURSES = {
    1: {"name": "Straight Shot", "par": 2, "bounds": [-0.12, -0.3, 0.12, 0.3],
        "tee": [0, 0.24], "hole": [0, -0.22], "walls": border(-0.12, -0.3, 0.12, 0.3), "blocks": []},
    2: {"name": "Dogleg", "par": 3, "bounds": [-0.3, -0.3, 0.3, 0.3],
        "tee": [-0.2, 0.22], "hole": [0.2, -0.2],
        "walls": border(-0.3, -0.3, 0.3, 0.3) + [[-0.3, 0.0, 0.12, 0.0]], "blocks": []},
    3: {"name": "Bumpers", "par": 3, "bounds": [-0.15, -0.35, 0.15, 0.35],
        "tee": [0, 0.3], "hole": [0, -0.29], "walls": border(-0.15, -0.35, 0.15, 0.35),
        "blocks": [{"x": -0.06, "z": 0.08, "w": 0.09, "d": 0.03, "h": 0.03},
                   {"x": 0.06, "z": -0.1, "w": 0.09, "d": 0.03, "h": 0.03}]},
    # Moving parts are timed off the shared clock (ms since epoch) so every
    # device sees them in the same place: spinners are windmill blades in
    # the x-y plane turning about a hub at (x, y, z); sliders move along an
    # axis, x/z + range * sin(2π t / period + phase). Posts are round bouncy
    # bumpers.
    4: {"name": "Windmill", "par": 3, "bounds": [-0.14, -0.35, 0.14, 0.35],
        "tee": [0, 0.29], "hole": [0, -0.27],
        "walls": border(-0.14, -0.35, 0.14, 0.35) + [[-0.14, -0.1, -0.035, -0.1], [0.035, -0.1, 0.14, -0.1]],
        "blocks": [], "spinners": [{"x": 0, "z": -0.1, "y": 0.088, "len": 0.17, "period": 4.0}]},
    5: {"name": "Rush Hour", "par": 3, "bounds": [-0.16, -0.4, 0.16, 0.4],
        "tee": [0, 0.34], "hole": [0, -0.33], "walls": border(-0.16, -0.4, 0.16, 0.4), "blocks": [],
        "sliders": [{"x": 0, "z": 0.12, "w": 0.09, "d": 0.03, "h": 0.025, "axis": "x", "range": 0.075, "period": 3.0, "phase": 0},
                    {"x": 0, "z": -0.02, "w": 0.06, "d": 0.03, "h": 0.025, "axis": "x", "range": 0.09, "period": 1.9, "phase": 1.5},
                    {"x": 0, "z": -0.16, "w": 0.09, "d": 0.03, "h": 0.025, "axis": "x", "range": 0.075, "period": 2.6, "phase": 3.0}]},
    6: {"name": "Pachinko", "par": 4, "bounds": [-0.2, -0.35, 0.2, 0.35],
        "tee": [-0.14, 0.29], "hole": [0.13, -0.28],
        "walls": border(-0.2, -0.35, 0.2, 0.35) + [[-0.2, -0.06, -0.06, -0.16], [0.2, 0.12, 0.07, 0.2]],
        "blocks": [],
        "posts": [{"x": x, "z": z, "r": 0.012} for z, row in ((0.1, (-0.12, -0.04, 0.04)), (0.0, (-0.08, 0.0, 0.08, 0.15)),
                                                            (-0.1, (-0.03, 0.05, 0.13)), (-0.2, (0.02, 0.09)))
                  for x in row]},
}
for cid, c in COURSES.items():
    c["id"] = cid
    c["wallHeight"] = WALL_H
    for k in ("spinners", "sliders", "posts"):
        c.setdefault(k, [])


def make_app(db_path, stratum):
    db = sqlite3.connect(db_path, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("""CREATE TABLE IF NOT EXISTS scores (
        player TEXT NOT NULL, name TEXT NOT NULL, course INTEGER NOT NULL,
        strokes INTEGER NOT NULL, at INTEGER NOT NULL)""")
    routes = web.RouteTableDef()

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True})

    @routes.get("/courses")
    async def courses(request):
        return web.json_response({"courses": [{"id": c["id"], "name": c["name"], "par": c["par"]} for c in COURSES.values()]})

    @routes.get("/courses/{id}")
    async def course(request):
        c = COURSES.get(int(request.match_info["id"]) if request.match_info["id"].isdigit() else -1)
        if not c:
            raise web.HTTPNotFound(text="no such course")
        return web.json_response(c)

    @routes.post("/scores")
    async def post_score(request):
        body = await request.json()
        course, strokes = body.get("course"), body.get("strokes")
        if course not in COURSES or not isinstance(strokes, int) or not 1 <= strokes <= 50:
            raise web.HTTPBadRequest(text="need course id and strokes 1-50")
        p = request["player"]
        db.execute("INSERT INTO scores VALUES (?, ?, ?, ?, ?)", (p["user"], p["name"], course, strokes, int(time.time() * 1000)))
        return web.json_response({"ok": True, "leaderboard": leaderboard(course, p["user"])})

    @routes.get("/leaderboard/{course}")
    async def get_board(request):
        course = int(request.match_info["course"]) if request.match_info["course"].isdigit() else -1
        if course not in COURSES:
            raise web.HTTPNotFound(text="no such course")
        return web.json_response({"leaderboard": leaderboard(course, request["player"]["user"])})

    def leaderboard(course, me):
        rows = db.execute("""SELECT player, MAX(name) AS name, MIN(strokes) AS best, COUNT(*) AS rounds
                             FROM scores WHERE course = ? GROUP BY player ORDER BY best, MIN(at) LIMIT 10""", (course,)).fetchall()
        return [{"player": (r["name"] or f"player {r['player'][:4]}"), "best": r["best"], "rounds": r["rounds"],
                 "me": r["player"] == me} for r in rows]

    app = web.Application(middlewares=[stratum.middleware])
    app.add_routes(routes)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8001)))
    ap.add_argument("--db", default=os.environ.get("GOLF_DB", "/data/golf.db"))
    args = ap.parse_args()
    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    web.run_app(make_app(args.db, Stratum.from_env("golf")), host="0.0.0.0", port=args.port)
