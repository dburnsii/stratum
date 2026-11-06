"""Fuse a Space's keyframes with poses from different sources and score the maps.

  python compare.py <space id> <work dir> name=poses.txt ... [--ours] [--raw]

poses.txt lines: keyframe id + 12 numbers (3×4 camera→Space, row-major), e.g.
RTAB-Map's rtabmap_poses.txt or ORB-SLAM3's after import. --raw: devices' own
poses; --ours: the map engine's own rebuild (segment corrections).
Prints a table and renders <work>/<name>.png (top-down, a slice, heights).
"""
import json
import shutil
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from mapping import engine, keyframe, planes, voxels  # noqa: E402
from mapping.geometry import apply, from_js, inverse  # noqa: E402


def items_of(space):
    c = sqlite3.connect(ROOT / "data/stratum.db")
    return [{"id": i, "kind": k, "session": s, "at": a, "quality": q or 1.0} for i, k, s, a, q in
            c.execute("SELECT id, kind, session, at, quality FROM map_keyframes WHERE space_id = ? AND kind = 'depth' ORDER BY at", (space,))]


def workdir(work, name, space):
    d = Path(work) / name / space
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    (d / "kf").symlink_to(ROOT / "data/map" / space / "kf")
    return d


def fuse_with(space, work, name, poses):
    """poses: {keyframe id: 4×4 camera→Space} (others are left out)."""
    d = workdir(work, name, space)
    st = engine.state(str(d))
    now = time.time()
    used = 0
    for it in items_of(space):
        if it["id"] not in poses:
            continue
        h, origin, pts, _ = engine._load(str(d), it)
        T = poses[it["id"]] @ inverse(from_js(h["pose"]))     # correction for this keyframe
        engine._integrate(st, it, h, origin, pts, T, now)
        used += 1
    st.save(force=True)
    return d, used


def ours(space, work):
    d = workdir(work, "ours", space)
    r = engine.rebuild(str(d), items_of(space))
    return d, r["stats"]["keyframes"]


def score(d):
    e = engine.extract(str(d), [])
    st = engine.state(str(d))
    occ = st.vox.occupied(time.time())
    P = st.vox.mean[occ].astype(np.float64)
    n = st.vox.normal[occ].astype(np.float64)
    fy = e["floorY"]
    fl = P[(np.abs(P[:, 1] - fy) < 0.15) & (np.abs(n[:, 1]) > 0.85)][:, 1]
    walls = [p for p in e["planes"] if p["kind"] == "wall"]
    wall_err = []
    for p in walls:
        from mapping.geometry import pose_to_matrix
        m = pose_to_matrix(p["pose"])
        loc = apply(inverse(m), P)
        near = (np.abs(loc[:, 1]) < 0.2) & planes.in_poly(np.array(p["polygon"]), loc[:, [0, 2]])
        if near.sum() > 50:
            wall_err.append(np.percentile(np.abs(loc[near, 1]), 80))
    kinds = {}
    for p in e["planes"]:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    return {"voxels": int(len(occ)), "floor_cm": round(float(np.std(fl)) * 100, 2) if len(fl) else None,
            "wall80_cm": round(float(np.median(wall_err)) * 100, 2) if wall_err else None,
            "walls": len(walls), "wall_m2": round(sum(p["area"] for p in walls), 1), "surfaces": len(e["planes"]), "kinds": kinds}, e, P


def render(d, name, e, P, out):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mapping.geometry import pose_to_matrix
    fig, axs = plt.subplots(1, 2, figsize=(20, 9), gridspec_kw={"width_ratios": [1, 1.4]})
    o = np.argsort(P[:, 1])
    lo, hi = np.percentile(P[:, 1], [0.5, 99.5])
    axs[0].scatter(P[o, 0], P[o, 2], c=P[o, 1], s=0.3, cmap="viridis", vmin=lo, vmax=hi)
    for p in e["planes"]:
        m = pose_to_matrix(p["pose"])
        poly = np.array(p["polygon"])
        w = apply(m, np.c_[poly[:, 0], np.zeros(len(poly)), poly[:, 1]])
        col = {"wall": "#1971c2", "floor": "#2f9e44", "ceiling": "#868e96"}.get(p["kind"], "#e8590c")
        axs[0].plot(np.r_[w[:, 0], w[:1, 0]], np.r_[w[:, 2], w[:1, 2]], color=col, lw=1.2)
    axs[0].set_aspect("equal"); axs[0].invert_yaxis(); axs[0].set_title(f"{name}: top-down ({len(P)} voxels, {len(e['planes'])} surfaces)")
    sl = P[np.abs(P[:, 2] - 1.0) < 0.06]
    axs[1].scatter(sl[:, 0], sl[:, 1], s=1, c="k"); axs[1].set_aspect("equal"); axs[1].set_title(f"{name}: slice z = 1.0 ± 6 cm")
    fig.savefig(out, dpi=70, bbox_inches="tight")
    plt.close(fig)


def load_poses(path):
    out = {}
    for line in open(path):
        v = line.split()
        if len(v) < 13:
            continue
        m = np.eye(4)
        m[:3, :4] = np.array(v[1:13], float).reshape(3, 4)
        out[v[0]] = m
    return out


if __name__ == "__main__":
    space, work = sys.argv[1], sys.argv[2]
    runs = []
    for a in sys.argv[3:]:
        if a == "--raw":
            raw = {}
            for it in items_of(space):
                h, _ = keyframe.parse((ROOT / "data/map" / space / "kf" / f"{it['id']}.bin").read_bytes())
                raw[it["id"]] = from_js(h["pose"])
            runs.append(("raw", *fuse_with(space, work, "raw", raw)))
        elif a == "--ours":
            runs.append(("ours", *ours(space, work)))
        else:
            name, path = a.split("=", 1)
            runs.append((name, *fuse_with(space, work, name, load_poses(path))))
    print(f"{'poses':10s} {'kf used':>8s} {'voxels':>8s} {'floor σ cm':>11s} {'wall p80 cm':>12s} {'walls':>6s} {'wall m²':>8s} {'surfaces':>9s}  kinds")
    for name, d, used in runs:
        s, e, P = score(d)
        render(d, name, e, P, Path(work) / f"{name}.png")
        print(f"{name:10s} {used:8d} {s['voxels']:8d} {s['floor_cm']!s:>11s} {s['wall80_cm']!s:>12s} {s['walls']:6d} {s['wall_m2']:8.1f} {s['surfaces']:9d}  {s['kinds']}")
