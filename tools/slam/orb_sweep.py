"""How much does ORB-SLAM3 gain from more frames / better depth? Sweep a TUM
RGB-D sequence (with ground truth) over frame rate, image size and depth
quality, run stratum-orbslam3 on each, score against ground truth.

  python orb_sweep.py <tum sequence dir> <work dir> [--jobs 4]

Variants: rgbd640 (TUM as is), rgbd320 (our 320 px grayscale), ar320 (320 px
+ AR-like depth: 160×120, ±2 % + 1 cm noise, 10 % holes), mono320 (no depth;
scale from a similarity fit, as device poses would give it).
Scores: share of the sequence in ORB-SLAM3's final map, maps started
(tracking lost → a new map), ATE (cm, after alignment).
"""
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

FPS = [30, 10, 5, 2, 1, 0.5]
VARIANTS = ["rgbd640", "rgbd320", "ar320", "mono320"]
K = dict(fx=517.306408, fy=516.469215, cx=318.643040, cy=255.313989, k1=0.262383, k2=-0.953104, p1=-0.005358, p2=0.002628, k3=1.163314)


def read_list(p):
    return [(float(l.split()[0]), l.split()[1]) for l in open(p) if l.strip() and not l.startswith("#")]


def pairs(seq):
    rgb, dep = read_list(seq / "rgb.txt"), read_list(seq / "depth.txt")
    dt = np.array([d[0] for d in dep])
    out = []
    for t, p in rgb:
        j = int(np.argmin(np.abs(dt - t)))
        if abs(dt[j] - t) < 0.02:
            out.append((t, p, dep[j][1]))
    return out


def yaml(path, scale, mono):
    k = {key: (v * scale if key in ("fx", "fy", "cx", "cy") else v) for key, v in K.items()}
    w, h = int(640 * scale), int(480 * scale)
    path.write_text(f"""%YAML:1.0
File.version: "1.0"
Camera.type: "PinHole"
Camera1.fx: {k['fx']}
Camera1.fy: {k['fy']}
Camera1.cx: {k['cx']}
Camera1.cy: {k['cy']}
Camera1.k1: {k['k1']}
Camera1.k2: {k['k2']}
Camera1.p1: {k['p1']}
Camera1.p2: {k['p2']}
Camera1.k3: {k['k3']}
Camera.width: {w}
Camera.height: {h}
Camera.fps: 30
Camera.RGB: 1
Stereo.ThDepth: 40.0
Stereo.b: 0.07
RGBD.DepthMapFactor: 5000.0
ORBextractor.nFeatures: {1000 if scale == 1 else 800}
ORBextractor.scaleFactor: 1.2
ORBextractor.nLevels: {8 if scale == 1 else 6}
ORBextractor.iniThFAST: 20
ORBextractor.minThFAST: 7
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


def ar_depth(d, rng):
    """TUM depth (uint16, 5000/m) → coarse, noisy, holey, like phone/headset AR depth."""
    z = d.astype(np.float64) / 5000.0
    small = z[2::4, 2::4]                                    # 160×120
    noisy = small * (1 + rng.normal(0, 0.02, small.shape)) + rng.normal(0, 0.01, small.shape)
    noisy[(small == 0) | (rng.random(small.shape) < 0.10)] = 0
    big = np.repeat(np.repeat(noisy, 4, axis=0), 4, axis=1)[: d.shape[0], : d.shape[1]]
    return np.clip(big * 5000, 0, 65535).astype(np.uint16)


def make(seq, out, fps, variant):
    if out.exists():
        shutil.rmtree(out)
    (out / "rgb").mkdir(parents=True)
    scale = 1.0 if variant == "rgbd640" else 0.5
    mono = variant == "mono320"
    if not mono:
        (out / "depth").mkdir()
    rng = np.random.default_rng(0)
    pr = pairs(seq)
    keep, last = [], -1e9
    for t, rp, dp in pr:
        if t - last >= 1.0 / fps - 1e-3:
            keep.append((t, rp, dp))
            last = t
    lines = []
    for t, rp, dp in keep:
        im = Image.open(seq / rp)
        if scale != 1:
            im = im.convert("L").resize((320, 240), Image.BILINEAR).convert("RGB")   # our gray, as 3 channels
        im.save(out / rp)
        if not mono:
            d = np.array(Image.open(seq / dp))
            if variant == "ar320":
                d = ar_depth(d, rng)
            if scale != 1:
                d = d[1::2, 1::2]
            Image.fromarray(d.astype(np.uint16)).save(out / dp.replace("depth/", "depth/"))
        lines.append((t, rp, dp))
    if mono:
        (out / "rgb.txt").write_text("".join(f"{t:.6f} {rp}\n" for t, rp, _ in lines))
    else:
        (out / "associations.txt").write_text("".join(f"{t:.6f} {rp} {t:.6f} {dp}\n" for t, rp, dp in lines))
    yaml(out / "camera.yaml", scale, mono)
    return len(lines)


def run(out, mono):
    cmd = ["docker", "run", "--rm", "-v", f"{out}:/data/seq"]
    if mono:
        cmd += ["--entrypoint", "sh", "stratum-orbslam3", "-c",
                "cd /data/seq && /opt/ORB_SLAM3/Examples/Monocular/mono_tum /opt/ORB_SLAM3/Vocabulary/ORBvoc.txt camera.yaml . && mv KeyFrameTrajectory.txt orbslam3_keyframes.txt"]
    else:
        cmd += ["stratum-orbslam3"]
    try:
        log = subprocess.run(cmd, capture_output=True, text=True, timeout=1800).stdout
    except subprocess.TimeoutExpired:
        log = "timeout"
    (out / "log.txt").write_text(log)
    return log


def ate(traj, gt, sim3):
    est = np.array([[float(x) for x in l.split()[:4]] for l in open(traj) if l.strip()])
    if len(est) < 3:
        return None, 0
    P, Q = [], []
    for t, x, y, z in est:
        i = int(np.argmin(np.abs(gt[:, 0] - t)))
        if abs(gt[i, 0] - t) < 0.02:
            P.append([x, y, z]); Q.append(gt[i, 1:4])
    P, Q = np.array(P), np.array(Q)
    if len(P) < 3:
        return None, 0
    cp, cq = P.mean(0), Q.mean(0)
    A, B = P - cp, Q - cq
    U, S, Vt = np.linalg.svd(A.T @ B)
    D = np.diag([1, 1, np.sign(np.linalg.det(Vt.T @ U.T))])
    R = Vt.T @ D @ U.T
    s = (S * np.diag(D)).sum() / (A ** 2).sum() if sim3 else 1.0
    err = np.linalg.norm(s * A @ R.T - B, axis=1)
    return float(np.sqrt((err ** 2).mean()) * 100), len(P)


def main():
    seq, work = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 4
    gt = np.array([[float(x) for x in l.split()[:4]] for l in open(seq / "groundtruth.txt") if not l.startswith("#")])
    span = gt[-1, 0] - gt[0, 0]
    tasks = [(fps, v) for v in VARIANTS for fps in FPS]

    def one(task):
        fps, v = task
        out = work / seq.name / f"{v}-{fps}fps"
        n = make(seq, out, fps, v)
        log = run(out, v == "mono320")
        traj = out / ("orbslam3_keyframes.txt" if v == "mono320" else "orbslam3_camera.txt")
        maps = len(re.findall(r"Creation of new map|New Map created", log))
        if not traj.exists():
            return (v, fps, n, maps, None, 0.0)
        e, m = ate(traj, gt, sim3=(v == "mono320"))
        times = [float(l.split()[0]) for l in open(traj) if l.strip()]
        cover = (max(times) - min(times)) / span if len(times) > 1 else 0.0
        return (v, fps, n, maps, e, cover)

    with ThreadPoolExecutor(jobs) as ex:
        res = list(ex.map(one, tasks))
    print(f"\n{seq.name}  ({span:.0f} s, ground truth {len(gt)} poses)")
    print(f"{'variant':9s} {'fps':>5s} {'frames':>7s} {'maps':>5s} {'in final map':>13s} {'ATE cm':>8s}")
    for v, fps, n, maps, e, cover in res:
        print(f"{v:9s} {fps:5g} {n:7d} {maps:5d} {cover * 100:12.0f}% {('%.1f' % e) if e is not None else 'lost':>8s}")


if __name__ == "__main__":
    main()
