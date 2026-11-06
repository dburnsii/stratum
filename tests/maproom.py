"""A synthetic room for map tests: ray-cast depth keyframes like a device
would send. Space frame = room frame (gravity-aligned, floor at y = 0).

  room = Room()                       4 × 5 × 2.5 m, table, counter, couch
  room.boxes.append(Box(...))         e.g. a cup on the counter
  hdr, depth = room.keyframe(cam_pos, look_at, session=...)
"""
import math
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from mapping.geometry import to_js  # noqa: E402


class Box:
    def __init__(self, lo, hi, name=""):
        self.lo, self.hi, self.name = np.array(lo, float), np.array(hi, float), name


class Room:
    def __init__(self, size=(4.0, 2.5, 5.0)):
        self.size = np.array(size)
        w, h, d = size
        self.inside = Box([-w / 2, 0, -d / 2], [w / 2, h, d / 2])
        self.boxes = [
            Box([-0.6, 0.72, -0.9], [0.6, 0.75, -0.1], "table top"),
            Box([-0.05, 0, -0.55], [0.05, 0.72, -0.45], "table leg"),
            Box([-w / 2, 0, 0.6], [-w / 2 + 0.6, 0.92, 2.4], "counter"),
            Box([w / 2 - 0.9, 0, 0.4], [w / 2, 0.45, 2.4], "couch seat"),
            Box([w / 2 - 0.2, 0.45, 0.4], [w / 2, 0.85, 2.4], "couch back"),
        ]

    def cast(self, o, d):
        """Nearest hit distance per ray (o: (3,), d: (N, 3) unit)."""
        inv = 1.0 / np.where(np.abs(d) < 1e-12, 1e-12, d)
        # Inside the room box: exit distance.
        t1 = (self.inside.lo - o) * inv
        t2 = (self.inside.hi - o) * inv
        best = np.min(np.maximum(t1, t2), axis=1)
        for b in self.boxes:
            t1 = (b.lo - o) * inv
            t2 = (b.hi - o) * inv
            tn = np.max(np.minimum(t1, t2), axis=1)
            tf = np.min(np.maximum(t1, t2), axis=1)
            hit = (tn <= tf) & (tn > 0)
            best = np.where(hit & (tn < best), tn, best)
        return best

    def keyframe(self, pos, look, session="s-0000-test", w=160, h=90, hfov=70.0, offset=None, quality=1.0,
                 at=None, source="phone-depth", noise=0.0, rng=None):
        """Depth keyframe from a camera at pos looking at look. offset: a
        rigid 4×4 error in this device's idea of the Space frame (its raw
        poses are offset @ true pose)."""
        pos, look = np.array(pos, float), np.array(look, float)
        f = -(look - pos)
        f /= np.linalg.norm(f)                       # camera +Z (looks down -Z)
        x = np.cross([0, 1, 0], f)
        x /= np.linalg.norm(x)
        y = np.cross(f, x)
        cam = np.eye(4)
        cam[:3, 0], cam[:3, 1], cam[:3, 2], cam[:3, 3] = x, y, f, pos
        P = perspective(hfov, w / h)
        s = (np.arange(w) + 0.5) / w
        t = (np.arange(h) + 0.5) / h
        S, T = np.meshgrid(s, t)
        nx, ny = 2 * S - 1, 1 - 2 * T                 # row 0 = top
        dirs_cam = np.stack([nx / P[0, 0], ny / P[1, 1], -np.ones_like(nx)], axis=-1).reshape(-1, 3)
        dirs = dirs_cam @ cam[:3, :3].T
        lens = np.linalg.norm(dirs, axis=1)
        dist = self.cast(pos, dirs / lens[:, None])
        z = dist / lens                               # along the view axis
        if noise:
            rng = rng or np.random.default_rng(0)
            z = z + rng.normal(0, noise * z * z, z.shape)
        depth = np.clip(np.round(z * 1000), 0, 65535).astype(np.uint16).reshape(h, w)
        raw = (offset if offset is not None else np.eye(4)) @ cam
        hdr = {"v": 1, "session": session, "device": "dev-test", "source": source, "w": w, "h": h,
               "ndc": [2, 0, -1, 0, -2, 1], "proj": to_js(P), "pose": to_js(raw), "floorY": float(raw[1, 3] - pos[1]),
               "quality": quality, "hands": [], "at": at or int(time.time() * 1000)}
        return hdr, depth


def perspective(hfov_deg, aspect, near=0.1, far=20.0):
    fx = 1 / math.tan(math.radians(hfov_deg) / 2)
    P = np.zeros((4, 4))
    P[0, 0], P[1, 1] = fx, fx * aspect
    P[2, 2], P[2, 3] = -(far + near) / (far - near), -2 * far * near / (far - near)
    P[3, 2] = -1
    return P


def tour(n=36, height=1.5):
    """Walk a loop through the room, looking around: outward at walls and
    furniture (level and down) and across the room."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        p = [0.8 * math.cos(a), height, 1.2 * math.sin(a)]
        look = a + (0 if i % 2 else math.pi * 0.75)
        drop = (0.2, 0.9, 1.5)[i % 3]
        out.append((p, [p[0] + 2 * math.cos(look), height - drop, p[2] + 2 * math.sin(look)]))
    return out
