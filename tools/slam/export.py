"""Export a Space's stored depth keyframes as a sequence the SLAM runners read.

  .venv/bin/python tools/slam/export.py <space id> <out dir> [--images]

out/frames.txt: id session stamp (3×4 camera→Space pose, row-major) pts/<id>.bin [img/<id>.png fx fy cx cy]
out/pts/<id>.bin: float32 xyz in the frame of that pose
The poses are each device's own (uncorrected) idea of where it was in the Space.
--zup: poses are gravity-aligned "base" frames in a z-up world (heading
only, at the camera; what planar SLAM wants), points in that base frame;
out/zup.txt keeps id + original camera pose for converting results back.
"""
import sqlite3
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from mapping import keyframe  # noqa: E402
from mapping.geometry import apply, from_js, inverse  # noqa: E402

MAX_PTS = 6000


ZUP = np.array([[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]], float)   # Space (y up) → z up


def base_of(cam_zup):
    """Gravity-aligned frame at the camera: heading of its view direction."""
    fwd = -cam_zup[:3, 2]                         # GL camera looks down -Z
    yaw = np.arctan2(fwd[1], fwd[0])
    b = np.eye(4)
    b[:2, :2] = [[np.cos(yaw), -np.sin(yaw)], [np.sin(yaw), np.cos(yaw)]]
    b[:3, 3] = cam_zup[:3, 3]
    return b


def export(space, out, db=ROOT / "data/stratum.db", maps=ROOT / "data/map", zup=False):
    out = Path(out)
    (out / "pts").mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(db)
    rows = c.execute("SELECT id, session, at FROM map_keyframes WHERE space_id = ? AND kind = 'depth' ORDER BY at", (space,)).fetchall()
    n = 0
    zf = open(out / "zup.txt", "w") if zup else None
    with open(out / "frames.txt", "w") as f:
        for kid, session, at in rows:
            p = Path(maps) / space / "kf" / f"{kid}.bin"
            if not p.exists():
                continue
            try:
                h, depth = keyframe.parse(p.read_bytes())
            except keyframe.BadKeyframe:
                continue
            origin, pts, _ = keyframe.unproject(h, depth)
            if len(pts) < 200:
                continue
            if len(pts) > MAX_PTS:
                pts = pts[np.linspace(0, len(pts) - 1, MAX_PTS).astype(int)]
            cam = from_js(h["pose"])                       # camera → Space
            extra = ""
            if zup:
                cz = ZUP @ cam
                base = base_of(cz)
                local = apply(inverse(base), apply(ZUP, pts)).astype(np.float32)
                zf.write(f"{kid} " + " ".join(f"{v:.6f}" for v in cam[:3, :4].reshape(-1)) + " " + " ".join(f"{v:.6f}" for v in base[:3, :4].reshape(-1)) + "\n")
                if h.get("image") is not None:   # camera image + registered depth (visual loop closures)
                    from tum import register_depth, _png, GL_TO_CV
                    (out / "img").mkdir(exist_ok=True)
                    im = h["img"]
                    _png(out / "img" / f"{kid}.png", np.asarray(h["image"], np.uint8))
                    _png(out / "img" / f"{kid}.d.png", register_depth(h, depth))
                    local = inverse(base) @ ZUP @ from_js(im["pose"]) @ GL_TO_CV   # base → optical camera
                    extra = f" img/{kid}.png img/{kid}.d.png {im['fx']:.4f} {im['fy']:.4f} {im['cx']:.4f} {im['cy']:.4f} " + \
                        " ".join(f"{x:.6f}" for x in local[:3, :4].reshape(-1))
                cam = base
            else:
                local = apply(inverse(cam), pts).astype(np.float32)
            local.tofile(out / "pts" / f"{kid}.bin")
            m = cam[:3, :4].reshape(-1)
            seg = f"{session}#{h.get('epoch', 0)}"
            f.write(f"{kid} {seg} {at / 1000:.3f} " + " ".join(f"{v:.6f}" for v in m) + f" pts/{kid}.bin" + (extra if zup else "") + "\n")
            n += 1
    return n


def from_zup(out, result, dest):
    """A z-up SLAM result (id + 3×4 base pose) → camera→Space poses (compare.py input)."""
    orig = {}
    for line in open(Path(out) / "zup.txt"):
        v = line.split()
        cam, base = np.eye(4), np.eye(4)
        cam[:3, :4] = np.array(v[1:13], float).reshape(3, 4)
        base[:3, :4] = np.array(v[13:25], float).reshape(3, 4)
        orig[v[0]] = (cam, base)
    with open(dest, "w") as f:
        for line in open(result):
            v = line.split()
            if v[0] not in orig:
                continue
            b = np.eye(4)
            b[:3, :4] = np.array(v[1:13], float).reshape(3, 4)
            cam, base = orig[v[0]]
            C = inverse(ZUP) @ (b @ inverse(base)) @ ZUP          # correction, back in the Space frame
            new = C @ cam
            f.write(v[0] + " " + " ".join(f"{x:.6f}" for x in new[:3, :4].reshape(-1)) + "\n")


if __name__ == "__main__":
    if sys.argv[1] == "from-zup":
        from_zup(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        print(export(sys.argv[1], sys.argv[2], zup="--zup" in sys.argv), "frames")
