"""Coarse alignment: get a piece of the map (a segment of one AR session)
roughly onto the rest, from up to ~1.5 m and ~25° off, so ICP (which only
converges from a few cm) can finish the job. Gravity-locked, 4 DOF.

  floor height  → the vertical offset (both sides see the floor)
  yaw           → the dominant wall direction (rooms are mostly square:
                  angles folded into 90°), compared within ±YAW_RANGE
  x/z           → along each of the two wall axes, a 1-D profile of where
                  walls are; cross-correlating the profiles gives the shift
                  (walls are sharp peaks, so the answer is unambiguous)

This is the geometric half of what RTAB-Map / ORB-SLAM3 do for loop
closure (they find the candidate visually first; here the Space's tags and
anchors already put a segment in the right neighbourhood).
"""
import math

import numpy as np
from scipy.ndimage import binary_dilation

from .geometry import rot_y
from .planes import normals

CELL = 0.05                 # m, top-down grid
MAX_SHIFT = 1.5             # m searched each way
YAW_RANGE = math.radians(45)     # tags can be badly off (a 30–45° session was seen)
YAW_STEP = math.radians(1.0)
BAND = (0.25, 1.9)          # m above the floor: walls and furniture sides, not floor / ceiling
MIN_CELLS = 60              # occupied grid cells a side needs to be worth aligning


def floor_y(pts):
    """Height of the floor: the strongest peak among the lowest points (or None)."""
    if len(pts) < 200:
        return None
    y = pts[:, 1]
    lo = np.percentile(y, 0.5)
    low = y[y < lo + 0.6]                       # the floor is at the bottom of what's seen
    if len(low) < 100:
        return None
    h, e = np.histogram(low, bins=np.arange(lo - 0.02, lo + 0.62, 0.02))
    i = int(np.argmax(h))
    if h[i] < max(40, 0.004 * len(pts)):        # no clear floor in view
        return None
    sel = np.abs(low - (e[i] + 0.01)) < 0.04
    return float(np.median(low[sel]))


def _band(pts, fy):
    if fy is None:
        return pts
    y = pts[:, 1] - fy
    return pts[(y > BAND[0]) & (y < BAND[1])]


def _grid(xz, origin, shape):
    """Top-down cells that hold real structure: dense enough to be a wall or
    a furniture side, not a scatter of stray depth samples."""
    ij = np.floor((xz - origin) / CELL).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 1] >= 0) & (ij[:, 0] < shape[0]) & (ij[:, 1] < shape[1])
    g = np.zeros(shape, np.float32)
    np.add.at(g, (ij[ok, 0], ij[ok, 1]), 1.0)
    nz = g[g > 0]
    if not len(nz):
        return g > 0
    return g >= max(3.0, float(np.percentile(nz, 60)))


def coarse(src, ref, src_floor=None, ref_floor=None):
    """src, ref: N×3 points (Space frame). → (T 4×4 mapping src onto ref, score
    0..1 (fraction of src structure that lands on ref structure), margin
    (best vs the best clearly different answer)), or (None, 0, 0)."""
    src_floor = floor_y(src) if src_floor is None else src_floor
    ref_floor = floor_y(ref) if ref_floor is None else ref_floor
    # Wall points only (vertical surfaces): sparse, sharp lines; a band full of
    # furniture tops and stray samples makes every placement look good.
    wa, _ = _walls(src, src_floor)
    wb, _ = _walls(ref, ref_floor)
    if wa is None or wb is None:
        return None, 0.0, 0.0
    a, b = wa[:, [0, 2]], wb[:, [0, 2]]
    pivot = a.mean(axis=0)
    span = np.ptp(a, axis=0).max() / 2 + MAX_SHIFT
    origin = pivot - span
    n = int(math.ceil(2 * span / CELL))
    R = binary_dilation(_grid(b, origin, (n, n)))   # one cell of slack
    if R.sum() < MIN_CELLS:
        return None, 0.0, 0.0
    FR = np.fft.rfft2(R.astype(np.float32), s=(2 * n, 2 * n))
    best = (-1, 0, 0, 0)
    results = []
    yaws = np.arange(-YAW_RANGE, YAW_RANGE + 1e-9, YAW_STEP)
    for yaw in yaws:
        c, s = math.cos(yaw), math.sin(yaw)
        rel = a - pivot
        # rot_y(yaw) on (x, z): x' = c x + s z, z' = -s x + c z
        rot = np.c_[c * rel[:, 0] + s * rel[:, 1], -s * rel[:, 0] + c * rel[:, 1]] + pivot
        S = _grid(rot, origin, (n, n))
        cnt = S.sum()
        if cnt < MIN_CELLS:
            continue
        FS = np.fft.rfft2(S[::-1, ::-1].astype(np.float32), s=(2 * n, 2 * n))
        corr = np.fft.irfft2(FR * FS, s=(2 * n, 2 * n))
        i, j = np.unravel_index(int(np.argmax(corr)), corr.shape)
        score = corr[i, j] / cnt
        di, dj = i - (n - 1), j - (n - 1)
        results.append((score, yaw, di, dj))
        if score > best[0]:
            best = (score, yaw, di, dj)
    if best[0] <= 0:
        return None, 0.0, 0.0
    score, yaw, di, dj = best
    if abs(di) * CELL > MAX_SHIFT or abs(dj) * CELL > MAX_SHIFT:
        return None, 0.0, 0.0
    # Margin: the best answer that's clearly a different one (> 6° or > 25 cm away).
    others = [r[0] for r in results if abs(r[1] - yaw) > math.radians(6) or math.hypot(r[2] - di, r[3] - dj) * CELL > 0.25]
    margin = score - (max(others) if others else 0.0)
    T = rot_y(yaw)
    T[:3, 3] = [pivot[0], 0, pivot[1]]
    T[:3, 3] -= T[:3, :3] @ np.array([pivot[0], 0, pivot[1]])
    T[0, 3] += di * CELL
    T[2, 3] += dj * CELL
    if src_floor is not None and ref_floor is not None:
        T[1, 3] = ref_floor - src_floor
    return T, float(score), float(margin)


PROFILE_BIN = 0.02          # m


def _walls(pts, fy):
    """Points on vertical surfaces in the band, with their horizontal normal angle."""
    b = _band(pts, fy)
    if len(b) > 40000:
        b = b[np.linspace(0, len(b) - 1, 40000).astype(int)]
    if len(b) < 200:
        return None, None
    n, flat = normals(b)
    keep = (np.abs(n[:, 1]) < 0.3) & (flat < 0.1)
    if keep.sum() < 150:
        return None, None
    return b[keep], np.arctan2(n[keep, 2], n[keep, 0])


def _direction(ang):
    """Dominant wall direction, folded into [-45°, 45°) (4-fold symmetric mean)."""
    z = np.exp(4j * ang).mean()
    return float(np.angle(z) / 4), float(abs(z))


def _profile(x, lo, n):
    h, _ = np.histogram(x, bins=n, range=(lo, lo + n * PROFILE_BIN))
    h = np.convolve(h.astype(float), [0.25, 0.5, 0.25], mode="same")
    return h / (np.linalg.norm(h) + 1e-9)


def _shift1d(a, b):
    """Best shift s (m) so that a + s lines up with b; (s, peak, second peak)."""
    lo = min(a.min(), b.min()) - MAX_SHIFT
    n = int(math.ceil((max(a.max(), b.max()) - lo + MAX_SHIFT) / PROFILE_BIN))
    pa, pb = _profile(a, lo, n), _profile(b, lo, n)
    c = np.correlate(pb, pa, mode="full")       # index k ↔ shift (k - (n - 1)) bins
    lags = (np.arange(len(c)) - (n - 1)) * PROFILE_BIN
    ok = np.abs(lags) <= MAX_SHIFT
    c, lags = c[ok], lags[ok]
    i = int(np.argmax(c))
    far = np.abs(lags - lags[i]) > 0.12
    return float(lags[i]), float(c[i]), float(c[far].max() if far.any() else 0.0)


def coarse_walls(src, ref, src_floor=None, ref_floor=None):
    """Like coarse(), for rooms with walls: → (T, score, margin) or (None, 0, 0).
    score = how well the wall profiles agree (0..1); margin = best minus the
    next clearly different shift, worst of the two axes."""
    src_floor = floor_y(src) if src_floor is None else src_floor
    ref_floor = floor_y(ref) if ref_floor is None else ref_floor
    a, aa = _walls(src, src_floor)
    b, ba = _walls(ref, ref_floor)
    if a is None or b is None:
        return None, 0.0, 0.0
    da, ca = _direction(aa)
    db, cb = _direction(ba)
    if ca < 0.25 or cb < 0.25:                  # no clear wall directions (round room, clutter only)
        return None, 0.0, 0.0
    yaw = (db - da + math.pi / 4) % (math.pi / 2) - math.pi / 4
    if abs(yaw) > YAW_RANGE:
        return None, 0.0, 0.0
    # Rotate src by yaw about its centroid (rot_y convention: x' = c x + s z, z' = -s x + c z).
    c, s = math.cos(yaw), math.sin(yaw)
    piv = a[:, [0, 2]].mean(axis=0)
    rel = a[:, [0, 2]] - piv
    ar = np.c_[c * rel[:, 0] + s * rel[:, 1], -s * rel[:, 0] + c * rel[:, 1]] + piv
    aang = aa + yaw * -1                        # normal angles rotate with the points (atan2(z, x) frame)
    br = b[:, [0, 2]]
    shift = np.zeros(2)
    score, margin = 1.0, 1.0
    for k, axis in enumerate((db, db + math.pi / 2)):
        u = np.array([math.cos(axis), math.sin(axis)])          # wall normal direction, (x, z)
        sa = np.abs(np.cos(aang - axis)) > 0.9                   # walls facing along this axis
        sb = np.abs(np.cos(ba - axis)) > 0.9
        if sa.sum() < 60 or sb.sum() < 60:                       # this axis isn't pinned down: leave it
            continue
        d, peak, second = _shift1d(ar[sa] @ u, br[sb] @ u)
        shift += d * u
        score = min(score, peak)
        margin = min(margin, peak - second)
    T = rot_y(yaw)
    p3 = np.array([piv[0], 0.0, piv[1]])
    T[:3, 3] = p3 - T[:3, :3] @ p3 + np.array([shift[0], 0.0, shift[1]])
    if src_floor is not None and ref_floor is not None:
        T[1, 3] = ref_floor - src_floor
    return T, float(score), float(margin)
