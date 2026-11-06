"""Keyframes: one depth snapshot from a device, in the Space frame.

Wire format (little-endian; the whole body may be gzipped):
  b'SKF1' · uint32 header length · header (JSON, UTF-8) · uint16 depth [h][w] in mm (0 = unknown)

Header:
  v        1
  session  this AR session (client uuid): its alignment gets one correction
  device   client device id
  source   'phone-depth' | 'quest-depth'
  w, h     depth size (≤ 320 × 320)
  ndc      [a, b, c, d, e, f]: depth pixel center (s, t) in 0..1 (column, row
           as stored) → view NDC: x = a·s + b·t + c, y = d·s + e·t + f
  proj     view projection matrix (16, column-major)
  pose     camera (view) pose in the Space frame, uncorrected (16, column-major)
  floorY   the device's floor height in the Space frame (optional)
  quality  0..1, how sure the device is of its alignment to the Space
  hands    [[x, y, z], ...] tracked hand joints in the Space frame (masked out)
  at       capture time, epoch ms

Points masks: too near/far, the user's own body (a column under the camera)
and hands. Depth noise grows with distance, so far points are not trusted.
"""
import gzip
import json
import math
import struct
import zlib

import numpy as np

from .geometry import apply, from_js

MAGIC = b"SKF1"
MAX_SIDE = 320
MAX_BYTES = 1 << 20
SOURCES = {"phone-depth", "quest-depth"}
RANGE = {"phone-depth": (0.25, 3.5), "quest-depth": (0.45, 4.0)}   # m: Quest sees its own hands up close
BODY_R = 0.32          # m around the camera, below it: the user's own body
BODY_DROP = 0.25       # m below the camera before the body column starts
HAND_R = 0.12          # m around each hand joint


class BadKeyframe(ValueError):
    pass


MAX_IMAGE = 640


def _finite(a, n):
    return isinstance(a, list) and len(a) == n and all(isinstance(v, (int, float)) and math.isfinite(v) for v in a)


def decompress(body, limit=MAX_BYTES):
    if body[:2] != b"\x1f\x8b":
        return body
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    out = d.decompress(body, limit + 1)
    if len(out) > limit or d.unconsumed_tail:
        raise BadKeyframe("keyframe too big")
    return out


def parse(body):
    """bytes → (header, depth uint16 [h, w]). Raises BadKeyframe."""
    body = decompress(body)
    if len(body) < 8 or body[:4] != MAGIC:
        raise BadKeyframe("not a keyframe")
    (n,) = struct.unpack_from("<I", body, 4)
    if n > 16384 or 8 + n > len(body):
        raise BadKeyframe("bad header")
    try:
        h = json.loads(body[8:8 + n].decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BadKeyframe("bad header")
    if not isinstance(h, dict) or h.get("v") != 1:
        raise BadKeyframe("unsupported keyframe version")
    w, ht = h.get("w"), h.get("h")
    if not (isinstance(w, int) and isinstance(ht, int) and 4 <= w <= MAX_SIDE and 4 <= ht <= MAX_SIDE):
        raise BadKeyframe("bad size")
    if h.get("source") not in SOURCES:
        raise BadKeyframe(f"source must be one of {sorted(SOURCES)}")
    if not (_finite(h.get("ndc"), 6) and _finite(h.get("proj"), 16) and _finite(h.get("pose"), 16)):
        raise BadKeyframe("bad camera")
    if not isinstance(h.get("session"), str) or not 8 <= len(h["session"]) <= 64:
        raise BadKeyframe("bad session")
    hands = h.get("hands") or []
    if not isinstance(hands, list) or len(hands) > 64 or not all(_finite(p, 3) for p in hands):
        raise BadKeyframe("bad hands")
    q = h.get("quality", 1)
    h["quality"] = min(1.0, max(0.05, float(q))) if isinstance(q, (int, float)) and math.isfinite(q) else 1.0
    if h.get("floorY") is not None and not (isinstance(h["floorY"], (int, float)) and math.isfinite(h["floorY"])):
        raise BadKeyframe("bad floorY")
    data = body[8 + n:]
    img = h.get("img")
    extra = 0
    if img is not None:   # optional grayscale camera image after the depth (visual SLAM experiments)
        iw, ih = img.get("w") if isinstance(img, dict) else None, img.get("h") if isinstance(img, dict) else None
        if not (isinstance(iw, int) and isinstance(ih, int) and 16 <= iw <= MAX_IMAGE and 16 <= ih <= MAX_IMAGE
                and _finite([img.get(k) for k in ("fx", "fy", "cx", "cy")], 4) and _finite(img.get("pose"), 16)):
            raise BadKeyframe("bad image")
        extra = iw * ih
    if len(data) != w * ht * 2 + extra:
        raise BadKeyframe("depth size mismatch")
    depth = np.frombuffer(data[:w * ht * 2], dtype="<u2").reshape(ht, w)
    if extra:
        h["image"] = np.frombuffer(data[w * ht * 2:], dtype=np.uint8).reshape(img["h"], img["w"])
    return h, depth


def encode(header, depth, compress=True):
    """For tests and tools: the inverse of parse."""
    hb = json.dumps(header).encode()
    body = MAGIC + struct.pack("<I", len(hb)) + hb + np.asarray(depth, dtype="<u2").tobytes()
    return gzip.compress(body) if compress else body


def unproject(header, depth):
    """→ (camera origin (3,), points (N, 3), distances (N,)) in the Space frame,
    masked (range, body, hands)."""
    ht, w = depth.shape
    a, b, c, d, e, f = header["ndc"]
    p = header["proj"]
    pose = from_js(header["pose"])
    rows, cols = np.mgrid[0:ht, 0:w]
    s = (cols.ravel() + 0.5) / w
    t = (rows.ravel() + 0.5) / ht
    z = depth.ravel().astype(np.float64) / 1000.0
    near, far = RANGE[header["source"]]
    ok = (z >= near) & (z <= far)
    s, t, z = s[ok], t[ok], z[ok]
    nx, ny = a * s + b * t + c, d * s + e * t + f
    x = (nx + p[8]) * z / p[0]
    y = (ny + p[9]) * z / p[5]
    cam = np.stack([x, y, -z], axis=1)
    pts = apply(pose, cam)
    origin = pose[:3, 3].copy()
    keep = np.ones(len(pts), dtype=bool)
    # The user's own body: a column under the camera.
    dxz = np.hypot(pts[:, 0] - origin[0], pts[:, 2] - origin[2])
    keep &= ~((dxz < BODY_R) & (pts[:, 1] < origin[1] - BODY_DROP))
    hands = np.asarray(header.get("hands") or [], dtype=np.float64).reshape(-1, 3)
    for j in hands:
        keep &= np.sum((pts - j) ** 2, axis=1) > HAND_R * HAND_R
    pts = pts[keep]
    dist = np.linalg.norm(pts - origin, axis=1)
    return origin, pts, dist


# ---- point sets (Quest room mesh) ---------------------------------------------------
# b'SPT1' · uint32 header length · header JSON {v, session, device, source:
# 'quest-mesh', key, label} · float32 [n][3] points in the Space frame
# (uncorrected). No camera: these add solid evidence but carve nothing.

PTS_MAGIC = b"SPT1"
MAX_POINTS = 60000


def parse_points(body):
    body = decompress(body)
    if len(body) < 8 or body[:4] != PTS_MAGIC:
        raise BadKeyframe("not a point set")
    (n,) = struct.unpack_from("<I", body, 4)
    if n > 4096 or 8 + n > len(body):
        raise BadKeyframe("bad header")
    try:
        h = json.loads(body[8:8 + n].decode())
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BadKeyframe("bad header")
    if not isinstance(h, dict) or h.get("v") != 1 or h.get("source") != "quest-mesh":
        raise BadKeyframe("unsupported point set")
    if not isinstance(h.get("session"), str) or not 8 <= len(h["session"]) <= 64:
        raise BadKeyframe("bad session")
    if not isinstance(h.get("key"), str) or not 1 <= len(h["key"]) <= 200:
        raise BadKeyframe("bad key")
    data = body[8 + n:]
    if len(data) % 12 or len(data) // 12 > MAX_POINTS:
        raise BadKeyframe("bad points")
    pts = np.frombuffer(data, dtype="<f4").reshape(-1, 3).astype(np.float64)
    if not np.isfinite(pts).all() or (np.abs(pts) > 1000).any():
        raise BadKeyframe("bad points")
    return h, pts


def encode_points(header, pts, compress=True):
    hb = json.dumps(header).encode()
    body = PTS_MAGIC + struct.pack("<I", len(hb)) + hb + np.asarray(pts, dtype="<f4").tobytes()
    return gzip.compress(body) if compress else body
