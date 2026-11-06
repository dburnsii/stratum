"""The map, server side: takes uploads, queues work for the map process,
stores results, tells clients (DESIGN.md §3.10).

  svc = MapService(store, hub, root)          app["map"]
  await svc.add_keyframe(uid, space, body)    → {ok, id, correction, version}
  await svc.add_points(uid, space, body)      Quest room mesh
  await svc.observations_changed(space)       re-merge surfaces
  await svc.export(space) · rebuild(space) · reset(space) · close()

One worker process does all fusing (spawned on first use). Per Space, jobs
run one at a time, newest uploads batched together; plane extraction is
debounced after fusing. SQL stays in store.py; pushes go through the hub.
"""
import asyncio
import base64
import logging
import math
import multiprocessing
import shutil
import time
import uuid
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from . import engine, keyframe, planes

log = logging.getLogger("stratum.map")

BATCH = 8
EXTRACT_AFTER_S = 3.0
EXTRACT_MIN_GAP_S = 8.0
REBUILD_EVERY = 400           # new keyframes between automatic rebuilds
REBUILD_STRAY_KF = 40         # ...or sooner, once a session the live ICP can't place has this many
REBUILD_STRAY_GAP_S = 300
MAX_KEYFRAMES = 3000          # per Space; beyond: thin out redundant old ones
RATE_PER_S = 3                # keyframes per user per Space
CONTRADICTED = (0.3, 0.75)    # a surface the map saw empty: ≥ 30% of it seen empty, and ≥ 75% of what's decided


def _kf_id():
    return f"{int(time.time() * 1000):013d}-{uuid.uuid4().hex[:8]}"


class MapService:
    def __init__(self, store, hub, root):
        self.store, self.hub, self.root = store, hub, Path(root)
        self.pool = None
        self.pending = {}           # space → [items]
        self.running = set()
        self.extract_at = {}        # space → when extraction is due
        self.extracted = {}         # space → last extraction time
        self.rebuilt_at = {}        # space → last rebuild (monotonic)
        self.timers = {}
        self.rate = {}              # (uid, space) → [recent upload times]
        self.tasks = set()
        self.rate_per_s = RATE_PER_S

    def dir(self, space_id):
        return self.root / space_id

    def _executor(self):
        if self.pool is None:
            self.pool = ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn"))
        return self.pool

    async def _job(self, fn, *args):
        return await asyncio.get_running_loop().run_in_executor(self._executor(), fn, *args)

    def _limited(self, uid, space_id):
        now = time.monotonic()
        recent = [t for t in self.rate.get((uid, space_id), []) if now - t < 1.0]
        if len(recent) >= self.rate_per_s:
            return True
        self.rate[(uid, space_id)] = recent + [now]
        return False

    # ---- uploads ------------------------------------------------------------------

    def _save(self, space_id, kid, body):
        d = self.dir(space_id) / "kf"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{kid}.bin").write_bytes(body)

    async def add_keyframe(self, uid, space_id, body):
        """Raises keyframe.BadKeyframe (400), PermissionError (409), OverflowError (429)."""
        h, _ = keyframe.parse(body)
        if self._limited(uid, space_id):
            raise OverflowError("too many keyframes: slow down")
        if not self.store.claim_map_session(uid, space_id, h["session"], h.get("device")):
            raise PermissionError("that session belongs to someone else")
        now = int(time.time() * 1000)
        at = h.get("at") if isinstance(h.get("at"), (int, float)) and abs(h["at"] - now) < 86400000 else now
        kid = _kf_id()
        self._save(space_id, kid, body)
        pose = h["pose"]
        self.store.add_keyframe(uid, space_id, {"id": kid, "kind": "depth", "session": h["session"], "device": h.get("device"),
                                                "quality": h["quality"], "pos": [round(pose[12], 3), round(pose[13], 3), round(pose[14], 3)],
                                                "bytes": len(body), "at": int(at)})
        self._enqueue(space_id, {"id": kid, "kind": "depth", "session": h["session"], "at": int(at), "quality": h["quality"]})
        sess = self.store.map_session(space_id, h["session"])
        return {"ok": True, "id": kid, "version": self.store.map_meta(space_id)["version"],
                "correction": _correction(sess)}

    async def add_points(self, uid, space_id, body):
        h, pts = keyframe.parse_points(body)
        if not self.store.claim_map_session(uid, space_id, h["session"], h.get("device")):
            raise PermissionError("that session belongs to someone else")
        mkey = f"{uid}:{h['key']}"
        if self.store.has_point_set(space_id, mkey):
            return {"ok": True, "duplicate": True}
        kid = _kf_id()
        self._save(space_id, kid, body)
        now = int(time.time() * 1000)
        self.store.add_keyframe(uid, space_id, {"id": kid, "kind": "points", "session": h["session"], "device": h.get("device"),
                                                "quality": 1.0, "mkey": mkey, "bytes": len(body), "at": now})
        self._enqueue(space_id, {"id": kid, "kind": "points", "session": h["session"], "at": now, "quality": 1.0})
        return {"ok": True, "id": kid, "points": len(pts)}

    # ---- work ----------------------------------------------------------------------

    def _enqueue(self, space_id, item):
        self.pending.setdefault(space_id, []).append(item)
        self._kick(space_id)

    def _kick(self, space_id):
        if space_id in self.running:
            return
        self.running.add(space_id)
        t = asyncio.get_running_loop().create_task(self._run(space_id))
        self.tasks.add(t)
        t.add_done_callback(self.tasks.discard)

    async def _run(self, space_id):
        try:
            while True:
                due = self.extract_at.get(space_id)
                if due is not None and time.monotonic() >= due:   # before more fusing: a steady stream mustn't starve it
                    self.extract_at.pop(space_id, None)
                    await self._extract(space_id)
                    continue
                items = self.pending.get(space_id) or []
                if items:
                    batch, self.pending[space_id] = items[:BATCH], items[BATCH:]
                    await self._fuse(space_id, batch)
                    continue
                break
        except Exception:   # never let one Space's failure stop the others
            log.exception("map job failed for %s", space_id)
        finally:
            self.running.discard(space_id)
            if self.pending.get(space_id):
                self._kick(space_id)

    async def _fuse(self, space_id, batch):
        r = await self._job(engine.fuse, str(self.dir(space_id)), batch)
        if not self.store.space_owner(space_id):
            return   # deleted meanwhile
        self.store.put_map_sessions(space_id, r["sessions"])
        self.store.put_map_meta(space_id, version=r["version"], stats=r["stats"], changes=r["changes"], added=len(batch))
        self.hub.publish_space(space_id, {"t": "map", "space": space_id, "version": r["version"], "changes": r["changes"],
                                          "stats": r["stats"]}, droppable=True)
        self._schedule_extract(space_id)
        meta = self.store.map_meta(space_id)
        # A session the live ICP couldn't place (too far off: tags misread, a
        # different anchor) gets the full coarse alignment once it has enough.
        stray = any(s["n"] == 0 and s["kf"] >= REBUILD_STRAY_KF for s in r["sessions"].values())
        recent = time.monotonic() - self.rebuilt_at.get(space_id, -1e9) < REBUILD_STRAY_GAP_S
        if meta["since_rebuild"] >= REBUILD_EVERY or (stray and meta["since_rebuild"] >= REBUILD_STRAY_KF and not recent):
            await self._prune(space_id)
            await self.rebuild(space_id, inline=True)

    def _schedule_extract(self, space_id):
        if space_id in self.extract_at:
            return   # already due: more snapshots mustn't push it back (they'd starve it)
        last = self.extracted.get(space_id, 0)
        due = max(time.monotonic() + EXTRACT_AFTER_S, last + EXTRACT_MIN_GAP_S)
        self.extract_at[space_id] = due
        old = self.timers.pop(space_id, None)
        if old:
            old.cancel()
        self.timers[space_id] = asyncio.get_running_loop().call_at(
            asyncio.get_running_loop().time() + (due - time.monotonic()) + 0.05, self._kick, space_id)

    async def _extract(self, space_id):
        self.extracted[space_id] = time.monotonic()
        r = await self._job(engine.extract, str(self.dir(space_id)), self.store.surfaces(space_id))
        if not self.store.space_owner(space_id):
            return
        gone = [sid for sid, c in r["contradicted"].items() if contradicted(c)] + r.get("superseded", [])
        if gone:
            self.store.retire_surface_obs(space_id, gone)
        obs = [{**p, "id": str(uuid.uuid4())} for p in r["planes"]]
        self.store.replace_surface_obs("map", space_id, "map", obs)
        await self.merge(space_id)

    async def merge(self, space_id):
        obs = self.store.surface_obs(space_id)
        previous = self.store.surfaces(space_id)
        merged = await asyncio.to_thread(planes.merge, obs, previous)
        if self.store.replace_canonical(space_id, merged):
            self.hub.publish_space(space_id, {"t": "surfaces", "space": space_id})

    async def observations_changed(self, space_id):
        await self.merge(space_id)

    async def _prune(self, space_id):
        """Keep the newest keyframes; drop old ones that a newer one already covers."""
        kfs = self.store.keyframes(space_id)
        extra = len(kfs) - MAX_KEYFRAMES
        if extra <= 0:
            return
        newer = [k for k in kfs[len(kfs) // 2:] if k["pos"]]
        drop = []
        for k in kfs[: len(kfs) // 2]:
            if len(drop) >= extra:
                break
            if k["kind"] == "points" or not k["pos"]:
                continue
            if any(math.dist(k["pos"], n["pos"]) < 0.3 for n in newer):
                drop.append(k["id"])
        if len(drop) < extra:   # still too many: oldest depth keyframes go
            rest = [k["id"] for k in kfs if k["kind"] == "depth" and k["id"] not in set(drop)]
            drop += rest[: extra - len(drop)]
        self.store.delete_keyframes(space_id, drop)
        for kid in drop:
            (self.dir(space_id) / "kf" / f"{kid}.bin").unlink(missing_ok=True)

    # ---- requests -------------------------------------------------------------------

    async def export(self, space_id, limit=60000):
        if not (self.dir(space_id) / "state.npz").exists() and not self.store.keyframe_count(space_id):
            meta = self.store.map_meta(space_id)
            return {"voxel": 0.04, "count": 0, "ijk": "", "layer": "", "conf": "", "version": meta["version"],
                    "stats": meta["stats"], "changes": meta["changes"]}
        r = await self._job(engine.export, str(self.dir(space_id)), limit)
        meta = self.store.map_meta(space_id)
        return {**r, "ijk": base64.b64encode(r["ijk"]).decode(), "layer": base64.b64encode(r["layer"]).decode(),
                "conf": base64.b64encode(r["conf"]).decode(), "changes": meta["changes"][:20]}

    async def rebuild(self, space_id, inline=False):
        """Re-register every session and re-fuse every keyframe."""
        self.rebuilt_at[space_id] = time.monotonic()
        items = [{"id": k["id"], "kind": k["kind"], "session": k["session"], "at": k["at"], "quality": k["quality"] or 1.0}
                 for k in self.store.keyframes(space_id)]
        if not items:
            return {"ok": True, "keyframes": 0}
        r = await self._job(engine.rebuild, str(self.dir(space_id)), items)
        self.store.put_map_sessions(space_id, r["sessions"])
        self.store.put_map_meta(space_id, version=r["version"], stats=r["stats"], rebuilt=True)
        self.hub.publish_space(space_id, {"t": "map", "space": space_id, "version": r["version"], "changes": [],
                                          "stats": r["stats"], "rebuilt": True}, droppable=True)
        if inline:
            self.extract_at[space_id] = time.monotonic()
        else:
            self.extract_at.pop(space_id, None)
            self._schedule_extract(space_id)
        return {"ok": True, "keyframes": len(items), "version": r["version"]}

    async def reset(self, space_id):
        self.pending.pop(space_id, None)
        self.extract_at.pop(space_id, None)
        while space_id in self.running:
            await asyncio.sleep(0.05)
        if self.pool is not None:
            await self._job(engine.reset, str(self.dir(space_id)))
        shutil.rmtree(self.dir(space_id), ignore_errors=True)
        self.store.clear_map(space_id)
        self.hub.publish_space(space_id, {"t": "surfaces", "space": space_id})
        self.hub.publish_space(space_id, {"t": "map", "space": space_id, "version": 0, "changes": [], "stats": None, "reset": True})

    async def info(self, space_id):
        meta = self.store.map_meta(space_id)
        return {"version": meta["version"], "stats": meta["stats"], "changes": meta["changes"][:20],
                "keyframes": self.store.keyframe_count(space_id), "rebuiltAt": meta["rebuilt_at"]}

    async def idle(self):
        """For tests: wait until no work is queued, running or due."""
        while self.running or any(self.pending.values()) or self.extract_at:
            if self.extract_at and not self.running:
                for sid in list(self.extract_at):
                    self.extract_at[sid] = 0
                    self._kick(sid)
            await asyncio.sleep(0.05)

    async def close(self):
        for t in self.timers.values():
            t.cancel()
        if self.pool is not None:
            try:
                await self._job(engine.flush)
            except Exception:
                log.exception("map flush failed")
            self.pool.shutdown(wait=True, cancel_futures=True)
            self.pool = None


def contradicted(c):
    cover, share = CONTRADICTED
    return c["free"] >= cover and c["free"] / max(c["free"] + c["occ"], 1e-9) >= share


def _correction(sess):
    """A session's correction, once the map has agreed on it a few times."""
    if not sess or not sess["pose"] or sess["accepted"] < 2:
        return None
    return {"pose": sess["pose"], "n": sess["accepted"], "rms": sess["rms"]}
