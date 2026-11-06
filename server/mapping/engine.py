"""The map work itself. Runs in a separate process (server/mapping/service.py
hands jobs over): fusing is CPU heavy and must never stall the server.

Per Space, on disk under <map dir>/<space id>/:
  kf/<id>.bin   keyframes and point sets as uploaded (the map's raw memory)
  state.npz     the fused voxel map + meta (sessions, cameras, floor, version)

RTAB-Map's ideas, in our terms: keyframes are the graph's nodes; Spaces
(tags, anchors) are its loop closures; each AR session gets one rigid
correction (its link to the map), found by ICP against everything seen
before; `rebuild` re-registers every session in order of quality and
re-fuses all keyframes (graph re-optimization), so early mistakes don't
stick. Working memory is the voxel map; long-term memory is the keyframes.
"""
import json
import math
import os
import time
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

from . import icp, keyframe, planes, voxels
from .geometry import apply, blend, from_js, inverse, matrix_to_pose, pose_to_matrix, to_js

SAVE_EVERY_S = 5
TREE_REFRESH = 0.1          # rebuild the ICP target after this much map growth
ICP_MIN_MAP = 1500          # occupied voxels before observations are aligned to the map
ICP_SAMPLE = 1500
ICP_ACCEPT = {"inliers": 250, "ratio": 0.45, "rms": 0.03, "move": 0.15, "turn": math.radians(5)}
CHANGE_MIN = 6              # voxels in a change worth telling apps about
CHANGE_SETTLE_S = 120       # a region must have been seen this long ago for "appeared" to mean new
MAX_CAMS = 400
SURFACE_K = 24              # neighbours for surface normals (fused surfaces are 2–3 voxels thick)
ON_SURFACE = 0.05           # m: voxels this close to a found surface belong to it

_spaces = {}


class SpaceState:
    def __init__(self, d):
        self.dir = Path(d)
        self.vox = voxels.VoxelMap()
        self.meta = {"version": 0, "sessions": {}, "cams": [], "floors": [], "keyframes": 0, "rebuilt": 0}
        self.tree = None
        self.tree_size = 0
        self.saved = 0.0
        f = self.dir / "state.npz"
        if f.exists():
            with np.load(f, allow_pickle=False) as z:
                self.vox = voxels.VoxelMap.from_arrays(z)
                self.meta.update(json.loads(str(z["meta"])))

    def save(self, force=False):
        if not force and time.time() - self.saved < SAVE_EVERY_S:
            return
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / "state.tmp.npz"
        np.savez(tmp, meta=np.array(json.dumps(self.meta)), **self.vox.arrays())
        os.replace(tmp, self.dir / "state.npz")
        self.saved = time.time()

    # ---- sessions (one rigid correction each) ---------------------------------

    def correction(self, sid):
        s = self.meta["sessions"].get(sid)
        return from_js(s["T"]) if s else np.eye(4)

    def set_correction(self, sid, T, accepted, rms=None):
        s = self.meta["sessions"].setdefault(sid, {"T": to_js(np.eye(4)), "n": 0, "kf": 0, "rms": None})
        s["T"] = to_js(T)
        s["n"] += int(accepted)
        if rms is not None:
            s["rms"] = round(rms, 4)

    # ---- ICP target --------------------------------------------------------------

    def target(self, now):
        occ = self.vox.occupied(now)
        if len(occ) < ICP_MIN_MAP:
            return None
        if self.tree is None or abs(len(occ) - self.tree_size) > TREE_REFRESH * self.tree_size:
            pts = self.vox.mean[occ].astype(np.float64)
            nrm, flat = planes.normals(pts)
            keep = flat < 0.12
            self.tree = (cKDTree(pts[keep]), pts[keep], nrm[keep])
            self.tree_size = len(occ)
        return self.tree

    def register(self, pts, T0, now, origin=None):
        """Best correction for these (uncorrected) points, starting at T0.
        → (T, accepted, stats)."""
        tgt = self.target(now)
        if tgt is None or len(pts) < 300:
            return T0, False, None
        if origin is not None:   # near points are the most precise
            near = np.linalg.norm(pts - origin, axis=1) < 3.0
            if near.sum() >= 300:
                pts = pts[near]
        if len(pts) > ICP_SAMPLE:
            pts = pts[np.linspace(0, len(pts) - 1, ICP_SAMPLE).astype(int)]
        tree, tp, tn = tgt
        T, st = icp.align(pts, tree, tp, tn, init=T0)
        delta = T @ inverse(T0)
        move = float(np.linalg.norm(delta[:3, 3]))
        turn = abs(math.atan2(-delta[2, 0], delta[0, 0]))
        a = ICP_ACCEPT
        ok = (st["inliers"] >= a["inliers"] and st["ratio"] >= a["ratio"] and st["rms"] <= a["rms"]
              and move <= a["move"] and turn <= a["turn"])
        return (T if ok else T0), ok, st


def state(space_dir):
    st = _spaces.get(str(space_dir))
    if st is None:
        st = _spaces[str(space_dir)] = SpaceState(space_dir)
    return st


def _load(space_dir, item):
    body = (Path(space_dir) / "kf" / f"{item['id']}.bin").read_bytes()
    if item["kind"] == "points":
        h, pts = keyframe.parse_points(body)
        return h, None, pts, None
    h, depth = keyframe.parse(body)
    origin, pts, _ = keyframe.unproject(h, depth)
    return h, origin, pts, depth


def _integrate(st, item, h, origin, pts, T, now_s, weight=None):
    at = int(item.get("at", now_s * 1000) // 1000)
    pts_c = apply(T, pts)
    if origin is not None:
        oc = apply(T, origin[None])[0]
        app, gone = st.vox.integrate(oc, pts_c, at, weight=float(h.get("quality", 1.0)) * (1.0 if weight is None else weight))
        st.meta["cams"] = (st.meta["cams"] + [[round(float(v), 3) for v in oc]])[-MAX_CAMS:]
        if h.get("floorY") is not None:
            st.meta["floors"] = (st.meta["floors"] + [round(float(h["floorY"]) + float(T[1, 3]), 3)])[-MAX_CAMS:]
    else:
        app, gone = st.vox.integrate(None, pts_c, at, weight=0.8 * (1.0 if weight is None else weight), carve=False)
    st.meta["keyframes"] += 1
    return app, gone


def fuse(space_dir, items, now_s=None):
    """New keyframes/point sets → map. items: [{id, kind: 'depth'|'points', session, at}].
    → {version, sessions {sid: {pose, n, rms}}, changes [...], stats}"""
    now_s = now_s or time.time()
    st = state(space_dir)
    appeared, gone, touched = [], [], set()
    for item in items:
        try:
            h, origin, pts, _ = _load(space_dir, item)
        except (OSError, keyframe.BadKeyframe):
            continue
        sid = item["session"]
        C0 = st.correction(sid)
        T, ok, stats = st.register(pts, C0, now_s, origin)
        if ok:   # follow, smoothed: one keyframe shouldn't swing the whole session
            k = 1.0 if item["kind"] == "points" else 0.4
            T = blend(C0, T, k)
        st.set_correction(sid, T, ok, stats["rms"] if ok else None)
        st.meta["sessions"][sid]["kf"] += 1
        a, g = _integrate(st, item, h, origin, pts, T, now_s)
        appeared.append(a)
        gone.append(g)
        touched.add(sid)
    st.meta["version"] += 1
    changes = _changes(st, np.concatenate(appeared) if appeared else np.zeros(0, np.int64),
                       np.concatenate(gone) if gone else np.zeros(0, np.int64), now_s)
    st.save()
    return {"version": st.meta["version"], "sessions": {sid: _session_out(st, sid) for sid in touched},
            "changes": changes, "stats": stats_of(st, now_s)}


def _session_out(st, sid):
    s = st.meta["sessions"][sid]
    return {"pose": matrix_to_pose(from_js(s["T"])), "n": s["n"], "kf": s["kf"], "rms": s["rms"]}


def _changes(st, app, gone, now_s):
    out = []
    if len(app):
        idx = st.vox._index(np.unique(app))
        app = np.unique(app)[(idx >= 0) & (now_s - st.vox.first[np.maximum(idx, 0)] > CHANGE_SETTLE_S)]
    for kind, keys in (("appeared", app), ("gone", gone)):
        keys = np.unique(keys)[:20000]
        if len(keys) < CHANGE_MIN:
            continue
        ijk = voxels.unpack(keys)
        pairs = cKDTree(ijk).query_pairs(1.8, output_type="ndarray")
        n = len(keys)
        g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)) if len(pairs) else coo_matrix((n, n))
        _, labels = connected_components(g, directed=False)
        for lab in np.unique(labels):
            members = keys[labels == lab]
            if len(members) < CHANGE_MIN:
                continue
            c = voxels.centers(members)
            lo, hi = c.min(axis=0) - voxels.VOXEL / 2, c.max(axis=0) + voxels.VOXEL / 2
            if (hi - lo).min() < 1.5 * voxels.VOXEL:
                continue   # a one-voxel sheet: a surface flickering between voxels, not a thing
            out.append({"type": kind, "center": [round(float(v), 3) for v in (lo + hi) / 2],
                        "size": [round(float(v), 3) for v in hi - lo], "voxels": int(len(members)), "at": int(now_s * 1000)})
    out.sort(key=lambda e: -e["voxels"])
    return out[:20]


def stats_of(st, now_s):
    occ = st.vox.occupied(now_s)
    layers = np.bincount(st.vox.layer[occ], minlength=4) if len(occ) else np.zeros(4, int)
    return {"voxels": int(len(st.vox)), "occupied": int(len(occ)), "keyframes": st.meta["keyframes"],
            "sessions": len(st.meta["sessions"]), "version": st.meta["version"],
            "layers": {"clutter": int(layers[0]), "furniture": int(layers[1]), "structure": int(layers[2]), "unsorted": int(layers[3])}}


def floor_y(st, now_s=None):
    """The floor's height, from the map itself: the biggest horizontal
    surface low down (below where the cameras were). Devices' own floor
    heights are only a fallback: they're in each device's frame and were
    seen 1.3 m off (a Quest roaming reports its floor relative to where the
    session began)."""
    f = st.meta.get("floors") or []
    reported = float(np.median(f)) if f else None
    occ = st.vox.occupied(now_s or time.time())
    if len(occ) < 500:
        return reported
    P = st.vox.mean[occ].astype(np.float64)
    n = st.vox.normal[occ].astype(np.float64)
    if np.median(np.linalg.norm(n, axis=1)) < 0.5:   # normals not worked out yet (fresh rebuild)
        n, _ = planes.normals(P)
    up = np.abs(n[:, 1]) > 0.85
    y = P[up, 1]
    cams = np.array(st.meta.get("cams") or [])
    if len(cams):
        y = y[y < np.median(cams[:, 1]) - 0.8]   # well below eye level
    if len(y) < 100:
        return reported
    h, e = np.histogram(y, bins=np.arange(y.min() - 0.02, y.min() + 1.2, 0.02))
    big = np.nonzero(h >= 0.25 * h.max())[0]
    i = big[0] + int(np.argmax(h[big[0]:big[0] + 15]))   # the lowest big level, its peak (within 30 cm)
    sel = np.abs(y - (e[i] + 0.01)) < 0.03
    return float(np.median(y[sel]))


def extract(space_dir, canonical=(), now_s=None):
    """Surfaces from the voxel map (as 'map' observations), voxel layers, and
    which known surfaces the map now contradicts (seen empty where they were).
    → {planes [...], contradicted {id: {free, occ}}, floorY, stats}"""
    now_s = now_s or time.time()
    st = state(space_dir)
    occ = st.vox.occupied(now_s)
    out_planes = []
    if len(occ) >= 50:
        pts = st.vox.mean[occ].astype(np.float64)
        nrm, flat = planes.normals(pts, k=SURFACE_K)   # wide enough to see a 2–3 voxel thick wall as flat
        found = planes.extract(pts, nrm, flat, floor_y(st), np.array(st.meta["cams"]) if st.meta["cams"] else None)
        st.vox.layer[st.vox.layer == voxels.UNSORTED] = voxels.CLUTTER
        st.vox.layer[occ] = voxels.CLUTTER
        st.vox.normal[occ] = nrm.astype(np.float16)
        for p in found:
            # Everything on the surface (not just the voxels whose normals agreed) is part of it.
            layer = voxels.STRUCTURE if p["kind"] in ("wall", "floor", "ceiling") else voxels.FURNITURE
            loc = apply(inverse(p["pose"]), pts)
            on = (np.abs(loc[:, 1]) < ON_SURFACE) & planes.in_poly(p["polygon"], loc[:, [0, 2]])
            on[p["members"]] = True
            st.vox.set_layers(st.vox.keys[occ[on]], layer)
            out_planes.append({"kind": p["kind"], "pose": matrix_to_pose(p["pose"]),
                               "polygon": [[float(a), float(b)] for a, b in p["polygon"]],
                               "weight": round(min(8.0, p["points"] / 40), 2), "points": p["points"], "area": round(p["area"], 3)})
    contradicted = {}
    for s in canonical:
        if planes.family(pose_to_matrix(s["pose"])[:3, 1]) != "up" or s["kind"] == "floor":
            continue
        m = pose_to_matrix(s["pose"])
        poly = np.asarray(s["polygon"])
        lo, hi = poly.min(axis=0), poly.max(axis=0)
        gx, gz = np.meshgrid(np.arange(lo[0], hi[0], 0.05), np.arange(lo[1], hi[1], 0.05))
        g = np.column_stack([gx.ravel(), gz.ravel()])
        g = g[planes.in_poly(poly, g)][:400]
        if len(g) < 4:
            continue
        p3 = apply(m, np.column_stack([g[:, 0], np.full(len(g), -0.02), g[:, 1]]))   # just inside the surface
        state_, seen = st.vox.state_at(p3, now_s)
        newer = seen * 1000 > s.get("last", 0)
        free = float(((state_ == -1) & newer).mean())
        occf = float((state_ == 1).mean())
        contradicted[s["id"]] = {"free": round(free, 3), "occ": round(occf, 3)}
    superseded = _superseded(st, canonical, now_s)
    st.save()
    return {"planes": out_planes, "contradicted": contradicted, "superseded": superseded, "floorY": floor_y(st), "stats": stats_of(st, now_s)}


def _superseded(st, canonical, now_s):
    """Phone-only surfaces (old swept samples: a few taps, often at the wrong
    height) where the depth map has looked and found no surface at that
    height: the map's own surfaces stand for that spot now."""
    out = []
    fy = floor_y(st, now_s)
    for s in canonical:
        if set(s.get("sources") or [s.get("source")]) != {"phone"}:
            continue
        m = pose_to_matrix(s["pose"])
        y = float(m[1, 3])
        if fy is not None and (y < fy - 0.15 or (s["kind"] == "floor" and abs(y - fy) > 0.1)
                               or (s["kind"] == "ceiling" and y < fy + 2.0)):
            out.append(s["id"])   # under the floor, a floor that isn't, a ceiling at head height
            continue
        poly = np.asarray(s["polygon"])
        lo, hi = poly.min(axis=0), poly.max(axis=0)
        gx, gz = np.meshgrid(np.arange(lo[0], hi[0], 0.08), np.arange(lo[1], hi[1], 0.08))
        g = np.column_stack([gx.ravel(), gz.ravel()])
        g = g[planes.in_poly(poly, g)][:200]
        if len(g) < 4:
            continue
        on = apply(m, np.column_stack([g[:, 0], np.zeros(len(g)), g[:, 1]]))
        here, _ = st.vox.state_at(on, now_s)
        n = m[:3, 1]
        near = np.concatenate([apply(m, np.column_stack([g[:, 0], np.full(len(g), d), g[:, 1]])) for d in (-0.4, -0.2, 0.2, 0.4)])
        around, _ = st.vox.state_at(near, now_s)
        looked = float((np.concatenate([here, around]) != 0).mean())
        supported = float((here == 1).mean())
        if looked >= 0.4 and supported < 0.3:
            out.append(s["id"])
    return out


def export(space_dir, limit=60000, now_s=None):
    """Occupied voxels for drawing: int16 voxel indices, layer, confidence."""
    now_s = now_s or time.time()
    st = state(space_dir)
    occ = st.vox.occupied(now_s)
    if len(occ) > limit:
        occ = occ[np.linspace(0, len(occ) - 1, limit).astype(int)]
    ijk = voxels.unpack(st.vox.keys[occ]).astype("<i2")
    lo = st.vox.effective_lo(now_s)[occ]
    conf = np.clip((lo - voxels.OCC) / (voxels.LO_MAX - voxels.OCC) * 255, 0, 255).astype(np.uint8)
    return {"voxel": voxels.VOXEL, "count": int(len(occ)), "ijk": ijk.tobytes(), "layer": st.vox.layer[occ].tobytes(),
            "conf": conf.tobytes(), "version": st.meta["version"], "stats": stats_of(st, now_s)}


CHUNK_KF = 40               # rebuild aligns sessions in pieces this long (drift and slips within a session)
SEG_SAMPLE = 400            # points kept per keyframe for alignment
FOOTPRINT_CELL = 0.25       # m: top-down cells of the area already mapped
NEW_AREA_OVERLAP = 0.15     # less of a piece inside it than this: a new area, kept as placed
UNVERIFIED_WEIGHT = 0.0     # pieces that couldn't be aligned stay out of the map (misplaced walls are worse than gaps)


def _segments(loaded):
    """Loaded keyframes → pieces aligned as one: by session and alignment
    epoch (the client bumps it when the Space jumps), then at most CHUNK_KF."""
    segs = {}
    for rec in loaded:
        it, h = rec[0], rec[1]
        key = f"{it['session']}#{h.get('epoch', 0)}"
        segs.setdefault(key, []).append(rec)
    out = []
    for key, recs in segs.items():
        for c in range(0, len(recs), CHUNK_KF):
            out.append((f"{key}#{c // CHUNK_KF}", recs[c:c + CHUNK_KF]))
    return out


def _sample(pts, n=SEG_SAMPLE):
    return pts if len(pts) <= n else pts[np.linspace(0, len(pts) - 1, n).astype(int)]


def _accept(margin, st):
    """A coarse + ICP answer good enough to trust."""
    if st is None or st["rms"] > 0.025:
        return False
    return (margin >= 0.05 and st["ratio"] >= 0.4) or st["ratio"] >= 0.55


def align_segments(segs, prior=None):
    """Pieces → correction per piece: the biggest is the reference; each other
    piece is aligned onto everything accepted so far (coarse, then ICP), with
    a second pass for those that only overlap pieces accepted later.
    → {key: (T, verified, stats)}"""
    from . import align
    prior = prior or {}
    pts = {k: np.concatenate([_sample(r[3]) for r in recs]) for k, recs in segs}
    order = sorted(pts, key=lambda k: -len(pts[k]))
    if not order:
        return {}
    first = order[0]
    out = {first: (prior.get(first, np.eye(4)), True, None)}
    ref = [apply(out[first][0], pts[first])]
    todo = order[1:]
    for _pass in range(5):   # until nothing new lines up (later pieces can bridge to earlier ones)
        left = []
        for k in todo:
            if len(pts[k]) < 1500:   # too little to align on its own: follow its session's neighbour
                left.append(k)
                continue
            R = np.concatenate(ref)
            if len(R) > 300000:
                R = R[np.linspace(0, len(R) - 1, 300000).astype(int)]
            T0 = prior.get(k, np.eye(4))
            src = apply(T0, pts[k])
            T, score, margin = align.coarse(src, R)
            ok, st = False, None
            if T is not None:
                nrm, flat = planes.normals(R[::2])
                keep = flat < 0.12
                rp = R[::2][keep]
                T2, st = icp.align(src[::2], cKDTree(rp), rp, nrm[keep], init=T)
                ok = _accept(margin, st)
            if ok:
                out[k] = (T2 @ T0, True, {**st, "score": score, "margin": margin})
                ref.append(apply(out[k][0], pts[k]))
            else:
                left.append(k)
        if len(left) == len(todo):
            break
        todo = left
    # The rest. A piece that hardly overlaps what's mapped is somewhere new (the
    # next room): nothing to check it against, so it goes where its tags /
    # anchors (or its session's verified pieces) put it. A piece that overlaps
    # but wouldn't line up is left out.
    R = np.concatenate(ref)
    mapped = set(map(tuple, np.floor(R[:, [0, 2]] / FOOTPRINT_CELL).astype(np.int64)))   # the area seen so far, from above
    for k in todo:
        sess = k.rsplit("#", 2)[0]
        near = [v for kk, v in out.items() if kk.rsplit("#", 2)[0] == sess and v[1]]
        T = near[0][0] if near else prior.get(k, np.eye(4))
        cells = np.floor(apply(T, pts[k][::4])[:, [0, 2]] / FOOTPRINT_CELL).astype(np.int64)
        overlap = float(np.mean([tuple(c) in mapped for c in cells])) if len(cells) else 1.0
        out[k] = (T, "new" if overlap < NEW_AREA_OVERLAP else False, {"overlap": overlap})
    return out


def rebuild(space_dir, items, now_s=None):
    """Re-align every piece of every session (coarse + ICP, biggest first)
    and re-fuse everything from the stored keyframes (graph
    re-optimization): early mistakes and tag misalignments don't stick.
    items: every stored keyframe/point set, oldest first."""
    now_s = now_s or time.time()
    st = state(space_dir)
    prior_sessions = st.meta.get("sessions", {})
    loaded = []
    for it in items:
        try:
            loaded.append((it, *_load(space_dir, it)[:3]))
        except (OSError, keyframe.BadKeyframe):
            pass
    segs = _segments(loaded)
    prior = {k: from_js(st.meta.get("segments", {}).get(k, {}).get("T", to_js(np.eye(4)))) for k, _ in segs}
    corr = align_segments(segs, prior)
    st.vox = voxels.VoxelMap()
    st.tree = None
    st.meta.update(sessions={}, segments={}, cams=[], floors=[], keyframes=0)
    for k, recs in sorted(segs, key=lambda kv: kv[1][0][0].get("at", 0)):
        T, ok, stats = corr[k]
        new_area = ok == "new"
        ok = ok is True
        st.meta["segments"][k] = {"T": to_js(T), "verified": ok, "newArea": new_area, "kf": len(recs),
                                  "rms": round(stats["rms"], 4) if stats and "rms" in stats else None,
                                  "margin": round(stats["margin"], 3) if stats and "margin" in stats else None,
                                  "overlap": round(stats["overlap"], 3) if stats and "overlap" in stats else None}
        sid = recs[0][0]["session"]
        st.set_correction(sid, T, ok, stats.get("rms") if stats else None)   # the session's latest piece
        if ok:
            st.meta["sessions"][sid]["n"] += 1   # coarse + ICP agreeing counts double: clients may apply it
        st.meta["sessions"][sid]["kf"] += len(recs)
        if not ok and not new_area and not UNVERIFIED_WEIGHT:
            continue
        for it, h, origin, pts in recs:
            _integrate(st, it, h, origin, pts, T, now_s, weight=None if ok or new_area else UNVERIFIED_WEIGHT)
    st.meta["version"] += 1
    st.meta["rebuilt"] = int(now_s)
    st.vox.compact(now_s)
    st.save(force=True)
    seg = st.meta["segments"]
    return {"version": st.meta["version"], "sessions": {sid: _session_out(st, sid) for sid in st.meta["sessions"]},
            "segments": {"total": len(seg), "verified": sum(1 for v in seg.values() if v["verified"]),
                         "newArea": sum(1 for v in seg.values() if v.get("newArea"))},
            "stats": stats_of(st, now_s)}


def flush(space_dir=None):
    for d, st in list(_spaces.items()):
        if space_dir is None or d == str(space_dir):
            st.save(force=True)
    return True


def reset(space_dir):
    _spaces.pop(str(space_dir), None)
    f = Path(space_dir) / "state.npz"
    if f.exists():
        f.unlink()
    return True


def info(space_dir, now_s=None):
    st = state(space_dir)
    return {"stats": stats_of(st, now_s or time.time()), "floorY": floor_y(st),
            "sessions": {sid: _session_out(st, sid) for sid in st.meta["sessions"]}}
