"""Stratum keyframes with camera images ↔ a TUM RGB-D sequence (ORB-SLAM3).

  python tum.py export <space id> <out dir> [--device quest|phone]
      out/rgb/<t>.png (gray), out/depth/<t>.png (uint16, 5000 per m: depth
      re-projected into the camera image), associations.txt, camera.yaml,
      stratum.txt (t, keyframe id, camera→Space pose of the image)
  python tum.py import <out dir> <trajectory.txt> <poses.txt>
      ORB-SLAM3's trajectory (its own frame) → camera→Space poses per
      keyframe (compare.py input): the trajectory is fitted onto the
      devices' own poses (4-DOF, robust), then the image→depth offset applied.

ORB-SLAM3 needs one camera model per run: export one device kind at a time.
It also crashes on portrait images (taller than wide): those are turned 90°
on export (intrinsics too) and the turn is undone on import.
"""
import sqlite3
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from mapping import keyframe  # noqa: E402
from mapping.geometry import apply, from_js, inverse, rot_y  # noqa: E402

DEPTH_SCALE = 5000.0
GL_TO_CV = np.diag([1.0, -1.0, -1.0, 1.0])
# Image turned 90° counter-clockwise: a point p' in the turned camera (OpenCV) is M p' in the original.
TURN = np.array([[0, -1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], float)   # camera frames: OpenGL (y up, z back) ↔ OpenCV (y down, z forward)


def _png(path, a):
    import zlib, struct
    h, w = a.shape
    bit = 16 if a.dtype == np.uint16 else 8
    raw = b"".join(b"\0" + (a[y].astype(">u2").tobytes() if bit == 16 else a[y].tobytes()) for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", w, h, bit, 0, 0, 0, 0)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def register_depth(h, depth):
    """A keyframe's depth, re-projected into its camera image (uint16, DEPTH_SCALE per m, 0 = none)."""
    im = h["img"]
    origin, pts, _ = keyframe.unproject(h, depth)
    cam = from_js(im["pose"])
    pc = apply(GL_TO_CV @ inverse(cam), pts)                     # → OpenCV camera frame
    z = pc[:, 2]
    ok = z > 0.2
    u = np.round(im["fx"] * pc[ok, 0] / z[ok] + im["cx"]).astype(int)
    v = np.round(im["fy"] * pc[ok, 1] / z[ok] + im["cy"]).astype(int)
    zz = z[ok]
    inside = (u >= 0) & (v >= 0) & (u < im["w"]) & (v < im["h"])
    D = np.full((im["h"], im["w"]), np.inf)
    np.minimum.at(D, (v[inside], u[inside]), zz[inside])
    for _ in range(2):   # depth is coarser than the image: fill small gaps from the nearest neighbours
        pad = np.pad(D, 1, constant_values=np.inf)
        nb = np.min([pad[1 + dy:1 + dy + D.shape[0], 1 + dx:1 + dx + D.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)], axis=0)
        D = np.where(np.isinf(D), nb, D)
    return np.where(np.isinf(D), 0, np.clip(D * DEPTH_SCALE, 0, 65535)).astype(np.uint16)


def export(space, out, device=None):
    out = Path(out)
    for d in ("rgb", "depth"):
        (out / d).mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(ROOT / "data/stratum.db")
    rows = c.execute("SELECT id, at FROM map_keyframes WHERE space_id = ? AND kind = 'depth' ORDER BY at", (space,)).fetchall()
    K = None
    turned = False
    n = 0
    with open(out / "associations.txt", "w") as assoc, open(out / "stratum.txt", "w") as meta:
        for kid, at in rows:
            p = ROOT / "data/map" / space / "kf" / f"{kid}.bin"
            try:
                h, depth = keyframe.parse(p.read_bytes())
            except (OSError, keyframe.BadKeyframe):
                continue
            img = h.get("image")
            if img is None or (device and not h["source"].startswith(device)):
                continue
            im = h["img"]
            k = (im["w"], im["h"], round(im["fx"], 1), round(im["fy"], 1))
            if K is None:
                K = (im, k)
                turned = im["h"] > im["w"]
            elif k != K[1]:
                continue   # a different camera model: ORB-SLAM3 wants one per run
            cam = from_js(im["pose"])                                   # image camera → Space (GL)
            D16 = register_depth(h, depth)
            gray = np.asarray(img, np.uint8)
            if turned:   # portrait → landscape (ORB-SLAM3 crashes on portrait)
                gray, D16 = np.rot90(gray), np.rot90(D16)
            t = f"{at / 1000:.6f}"
            _png(out / "rgb" / f"{t}.png", np.ascontiguousarray(gray))
            _png(out / "depth" / f"{t}.png", np.ascontiguousarray(D16))
            assoc.write(f"{t} rgb/{t}.png {t} depth/{t}.png\n")
            dpose = from_js(h["pose"])                                  # the depth camera (what compare.py corrects)
            meta.write(f"{t} {kid} " + " ".join(f"{x:.6f}" for x in cam[:3, :4].reshape(-1)) + " "
                       + " ".join(f"{x:.6f}" for x in dpose[:3, :4].reshape(-1)) + "\n")
            n += 1
    if K:
        im = dict(K[0])
        if turned:   # np.rot90: new (u', v') = (v, w - 1 - u)
            im = {**im, "w": im["h"], "h": im["w"], "fx": im["fy"], "fy": im["fx"], "cx": im["cy"], "cy": im["w"] - 1 - im["cx"]}
        (out / "turned").write_text("1" if turned else "0")
        (out / "camera.yaml").write_text(f"""%YAML:1.0
File.version: "1.0"
Camera.type: "PinHole"
Camera1.fx: {im['fx']:.4f}
Camera1.fy: {im['fy']:.4f}
Camera1.cx: {im['cx']:.4f}
Camera1.cy: {im['cy']:.4f}
Camera1.k1: 0.0
Camera1.k2: 0.0
Camera1.p1: 0.0
Camera1.p2: 0.0
Camera.width: {im['w']}
Camera.height: {im['h']}
Camera.fps: 2
Camera.RGB: 0
Stereo.ThDepth: 40.0
Stereo.b: 0.07
RGBD.DepthMapFactor: {DEPTH_SCALE}
ORBextractor.nFeatures: 1000
ORBextractor.scaleFactor: 1.2
ORBextractor.nLevels: 8
ORBextractor.iniThFAST: 12
ORBextractor.minThFAST: 5
Viewer.KeyFrameSize: 0.05
Viewer.KeyFrameLineWidth: 1.0
Viewer.GraphLineWidth: 0.9
Viewer.PointSize: 2.0
Viewer.CameraSize: 0.08
Viewer.CameraLineWidth: 3.0
Viewer.ViewpointX: 0.0
Viewer.ViewpointY: -0.7
Viewer.ViewpointZ: -1.8
Viewer.ViewpointF: 500.0
""")
    return n


def _quat_to_m(t, q):
    x, y, z, w = q
    m = np.eye(4)
    m[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                 [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                 [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    m[:3, 3] = t
    return m


def fit4(src, dst):
    """Yaw + translation taking src points onto dst (least squares), robust (2 rounds)."""
    keep = np.ones(len(src), bool)
    for _ in range(2):
        a, b = src[keep], dst[keep]
        ca, cb = a.mean(0), b.mean(0)
        A, B = a - ca, b - cb
        s = np.sum(A[:, 2] * B[:, 0] - A[:, 0] * B[:, 2])
        cth = np.sum(A[:, 0] * B[:, 0] + A[:, 2] * B[:, 2])
        yaw = np.arctan2(s, cth)
        T = rot_y(yaw)
        T[:3, 3] = cb - T[:3, :3] @ ca
        err = np.linalg.norm(apply(T, src) - dst, axis=1)
        keep = err < max(0.15, np.percentile(err, 70))
    return T, float(np.median(err))


def import_(out, traj, dest):
    out = Path(out)
    meta = {}
    for line in open(out / "stratum.txt"):
        v = line.split()
        m, dm = np.eye(4), np.eye(4)
        m[:3, :4] = np.array(v[2:14], float).reshape(3, 4)
        dm[:3, :4] = np.array(v[14:26], float).reshape(3, 4)
        meta[f"{float(v[0]):.6f}"] = (v[1], m, dm)
    turned = (out / "turned").exists() and (out / "turned").read_text().strip() == "1"
    orb = {}
    for line in open(traj):
        v = line.split()
        if len(v) < 8:
            continue
        m = _quat_to_m(np.array(v[1:4], float), np.array(v[4:8], float))     # turned cam (CV) → ORB world
        if turned:
            m = m @ inverse(TURN)
        orb[f"{float(v[0]):.6f}"] = m @ GL_TO_CV                              # cam (GL) → ORB world
    common = [t for t in orb if t in meta]
    # ORB-SLAM3's world is the first camera's (OpenCV) frame; gravity isn't known to it.
    # Fit rotation fully (Kabsch) on camera positions, then refine as gravity-aligned.
    P = np.array([orb[t][:3, 3] for t in common])
    Q = np.array([meta[t][1][:3, 3] for t in common])
    cp, cq = P.mean(0), Q.mean(0)
    U, _, Vt = np.linalg.svd((P - cp).T @ (Q - cq))
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    W = np.eye(4)
    W[:3, :3] = R
    W[:3, 3] = cq - R @ cp
    F, med = fit4(apply(W, P), Q)
    W = F @ W
    with open(dest, "w") as f:
        for t in common:
            kid, cam_img, cam_depth = meta[t]
            new_depth = (W @ orb[t]) @ inverse(cam_img) @ cam_depth   # the image's correction, applied to its depth
            f.write(kid + " " + " ".join(f"{x:.6f}" for x in new_depth[:3, :4].reshape(-1)) + "\n")
    return len(common), len(meta), med


if __name__ == "__main__":
    if sys.argv[1] == "export":
        dev = sys.argv[sys.argv.index("--device") + 1] if "--device" in sys.argv else None
        print(export(sys.argv[2], sys.argv[3], dev), "frames with images")
    else:
        print("tracked %d of %d frames; fit median error %.3f m" % import_(sys.argv[2], sys.argv[3], sys.argv[4]))
