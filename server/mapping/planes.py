"""Surfaces: flat planes found in the voxel map, and the merge of every
source (Quest room scans, phone sweeps, voxel planes; any user, any device)
into one set of surfaces per Space.

A surface is {kind, pose (plane frame: local +Y = normal), polygon ([x, z]
outline in the plane frame)}, the same shape as DESIGN.md §3.8. The Space
frame is gravity-aligned (+Y up), so floors/tables are exactly horizontal
and walls exactly vertical.
"""
import math
import uuid

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

from .geometry import UP, apply, inverse, matrix_to_pose, plane_frame, pose_to_matrix
from .voxels import VOXEL

KINDS = ("wall", "floor", "ceiling", "table", "counter", "desk", "couch", "bed", "shelf", "storage",
         "screen", "art", "door", "window", "other")
# Which kinds describe the same physical thing well enough to merge.
OWN_CLASS = {"door", "window", "screen", "art"}       # on walls, but not walls
SOURCE_PRIORITY = {"quest": 3, "quest-mesh": 2, "map": 1, "phone": 1}
SOURCE_WEIGHT = {"quest": 5.0, "quest-mesh": 3.0, "phone": 1.0}
MAX_POLY = 32


# ---- normals ----------------------------------------------------------------

def normals(pts, k=10):
    """Per-point unit normals (PCA of the k nearest neighbours) and flatness
    (smallest eigenvalue share: ~0 on a plane)."""
    n = len(pts)
    if n < 4:
        return np.tile(UP, (n, 1)), np.ones(n)
    k = min(k, n)
    tree = cKDTree(pts)
    _, idx = tree.query(pts, k=k)
    nb = pts[idx] - pts[idx].mean(axis=1, keepdims=True)
    cov = np.einsum("nki,nkj->nij", nb, nb) / k
    w, v = np.linalg.eigh(cov)
    nrm = v[:, :, 0]
    flat = w[:, 0] / np.maximum(w.sum(axis=1), 1e-12)
    return nrm, flat


# ---- polygons -----------------------------------------------------------------

def _cross2(a, b):
    return a[0] * b[1] - a[1] * b[0]


def hull(points2d):
    """Convex hull (monotone chain), counter-clockwise."""
    p = np.unique(np.round(np.asarray(points2d, dtype=np.float64), 4), axis=0)
    if len(p) < 3:
        return p
    p = p[np.lexsort((p[:, 1], p[:, 0]))]

    def half(points):
        out = []
        for q in points:
            while len(out) >= 2 and _cross2(out[-1] - out[-2], q - out[-2]) <= 0:
                out.pop()
            out.append(q)
        return out
    lower, upper = half(p), half(p[::-1])
    return np.array(lower[:-1] + upper[:-1])


def simplify(poly, max_pts=MAX_POLY):
    """Drop the vertices that change the outline least until ≤ max_pts."""
    poly = [np.asarray(q) for q in poly]
    while len(poly) > max_pts:
        areas = [abs(_cross2(poly[i] - poly[i - 1], poly[(i + 1) % len(poly)] - poly[i - 1])) for i in range(len(poly))]
        poly.pop(int(np.argmin(areas)))
    return np.array(poly)


def area(poly):
    p = np.asarray(poly)
    if len(p) < 3:
        return 0.0
    x, y = p[:, 0], p[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def in_poly(poly, pts):
    pts = np.asarray(pts)
    inside = np.zeros(len(pts), dtype=bool)
    p = np.asarray(poly)
    j = len(p) - 1
    for i in range(len(p)):
        xi, zi = p[i]
        xj, zj = p[j]
        cond = (zi > pts[:, 1]) != (zj > pts[:, 1])
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (xj - xi) * (pts[:, 1] - zi) / (zj - zi) + xi
        inside ^= cond & (pts[:, 0] < xint)
        j = i
    return inside


def _seg_dist(pts, a, b):
    ab = b - a
    t = np.clip(((pts - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(pts - (a + t[:, None] * ab), axis=1)


def poly_distance(pa, pb):
    """0 if two outlines overlap, else the gap between them."""
    pa, pb = np.asarray(pa), np.asarray(pb)
    if in_poly(pb, pa).any() or in_poly(pa, pb).any():
        return 0.0
    d = math.inf
    for P, Q in ((pa, pb), (pb, pa)):
        for i in range(len(Q)):
            d = min(d, float(_seg_dist(P, Q[i - 1], Q[i]).min()))
    return d


def min_area_rect_axis(poly):
    """Direction (2D unit) of the minimum-area bounding rectangle's long side."""
    p = np.asarray(poly)
    best, axis = math.inf, np.array([1.0, 0.0])
    for i in range(len(p)):
        e = p[i] - p[i - 1]
        L = np.linalg.norm(e)
        if L < 1e-9:
            continue
        u = e / L
        v = np.array([-u[1], u[0]])
        a, b = p @ u, p @ v
        ar = (a.max() - a.min()) * (b.max() - b.min())
        if ar < best - 1e-9:
            best = ar
            axis = u if (a.max() - a.min()) >= (b.max() - b.min()) else v
    return axis


# ---- kinds ----------------------------------------------------------------------

def kind_for_height(rel, area_m2):
    """A horizontal, upward surface by its height above the floor (m)."""
    if rel < 0.12:
        return "floor"
    if rel < 0.3:
        return "other"
    if rel < 0.62:
        if area_m2 >= 2.2 and rel >= 0.4:
            return "bed"
        return "couch" if area_m2 >= 0.5 else "table"   # small and low: a coffee/side table
    if rel < 0.84:
        return "table"
    if rel < 1.05:
        return "counter"
    if rel < 1.9:
        return "shelf"
    return "other"


def family(normal):
    ny = normal[1]
    return "up" if ny > 0.7 else "down" if ny < -0.7 else "v"


def merge_class(kind, normal):
    f = family(normal)
    if f == "v" and kind in OWN_CLASS:
        return kind
    return f


# ---- extraction from voxels ------------------------------------------------------------

def _peaks(values, bin_w, min_count, sep, circular=False, lo=None, hi=None):
    if not len(values):
        return []
    lo = values.min() if lo is None else lo
    hi = values.max() if hi is None else hi
    nb = max(1, int(math.ceil((hi - lo) / bin_w)) + 1)
    hist = np.bincount(np.clip(((values - lo) / bin_w).astype(int), 0, nb - 1), minlength=nb).astype(float)
    sm = np.convolve(np.concatenate([hist[-1:], hist, hist[:1]]) if circular else np.pad(hist, 1), [1, 2, 1], "valid") / 4 * 2
    order = np.argsort(-sm)
    out = []
    for i in order:
        if sm[i] < min_count:
            break
        c = lo + (i + 0.5) * bin_w
        if all((min(abs(c - o), (hi - lo) - abs(c - o)) if circular else abs(c - o)) >= sep for o in out):
            out.append(c)
    return out


def _components(coords2d, min_cells):
    """Cells (2D voxel coords) → connected groups (lists of indices into coords2d)."""
    if not len(coords2d):
        return []
    mn = coords2d.min(axis=0)
    c = coords2d - mn
    grid = np.zeros(c.max(axis=0) + 3, dtype=bool)
    grid[c[:, 0] + 1, c[:, 1] + 1] = True
    closed = ndimage.binary_closing(grid, structure=np.ones((3, 3)), iterations=1) | grid
    lab, n = ndimage.label(closed, structure=np.ones((3, 3)))
    ids = lab[c[:, 0] + 1, c[:, 1] + 1]
    out = []
    for i in range(1, n + 1):
        members = np.nonzero(ids == i)[0]
        if len(members) >= min_cells:
            out.append(members)
    return out


def extract(pts, nrm, flat, floor_y=None, cameras=None):
    """Planes in occupied voxel centers. → list of observations
    {kind, pose (4x4), polygon (n×2), points (count), area, members (indices)}."""
    out = []
    if len(pts) < 50:
        return out
    good = flat < 0.08
    cameras = np.asarray(cameras if cameras is not None and len(cameras) else [pts.mean(axis=0)])
    cam_top = float(cameras[:, 1].max())
    cam_mean = cameras.mean(axis=0)

    # Horizontal surfaces.
    hmask = good & (np.abs(nrm[:, 1]) > 0.85)
    hidx = np.nonzero(hmask)[0]
    horiz = []
    for hgt in _peaks(pts[hidx, 1], 0.02, 30, 0.06):
        sel = hidx[np.abs(pts[hidx, 1] - hgt) < 0.035]
        cells = np.floor(pts[sel][:, [0, 2]] / VOXEL).astype(np.int64)
        for comp in _components(cells, 20):
            members = sel[comp]
            y = float(np.median(pts[members, 1]))
            xz = pts[members][:, [0, 2]]
            corners = np.concatenate([xz + [dx, dz] for dx in (-VOXEL / 2, VOXEL / 2) for dz in (-VOXEL / 2, VOXEL / 2)])
            horiz.append((y, members, hull(corners), len(members) * VOXEL * VOXEL))
    if floor_y is None:
        big = [h for h in horiz if h[3] >= 1.0]
        floor_y = min((h[0] for h in big), default=min((h[0] for h in horiz), default=float(pts[:, 1].min())))
    horiz = _merge_levels(pts, horiz, floor_y, cam_top)
    for y, members, poly, ar in horiz:
        rel = y - floor_y
        down = rel > 1.9 and y > cam_top + 0.2
        kind = "ceiling" if down else kind_for_height(rel, ar)
        normal = np.array([0.0, -1.0, 0.0]) if down else UP.copy()
        axis = min_area_rect_axis(poly)
        center = np.array([poly[:, 0].mean(), y, poly[:, 1].mean()])
        m = plane_frame(normal, center, np.array([axis[0], 0.0, axis[1]]))
        local = _to_local(m, np.column_stack([poly[:, 0], np.full(len(poly), y), poly[:, 1]]))
        out.append({"kind": kind, "pose": m, "polygon": simplify(local), "points": len(members), "area": ar, "members": members})

    # Vertical surfaces: pieces per direction and plane, then pieces of one wall joined.
    vmask = good & (np.abs(nrm[:, 1]) < 0.25)
    vidx = np.nonzero(vmask)[0]
    ang = np.mod(np.arctan2(nrm[vidx, 2], nrm[vidx, 0]), math.pi)
    pieces = []
    for a0 in _peaks(ang, math.radians(2), 40, math.radians(10), circular=True, lo=0.0, hi=math.pi):
        dang = np.abs(np.mod(ang - a0 + math.pi / 2, math.pi) - math.pi / 2)
        sel = vidx[dang < math.radians(7)]
        d = np.array([math.cos(a0), 0.0, math.sin(a0)])
        t = np.cross(UP, d)
        off = pts[sel] @ d
        for o0 in _peaks(off, 0.02, 30, 0.08):
            sub = sel[np.abs(off - o0) < 0.035]
            uv = np.column_stack([pts[sub] @ t, pts[sub, 1]])
            cells = np.floor(uv / VOXEL).astype(np.int64)
            for comp in _components(cells, 25):
                u, yv = uv[comp, 0], uv[comp, 1]
                pieces.append({"a0": float(a0), "d": d, "t": t, "o": float(np.median(pts[sub[comp]] @ d)), "members": sub[comp],
                               "u0": u.min() - VOXEL / 2, "u1": u.max() + VOXEL / 2, "y0": yv.min() - VOXEL / 2, "y1": yv.max() + VOXEL / 2})
    for f in _join_vertical(pieces):
        u0, u1, y0, y1, d, t, o, members = f["u0"], f["u1"], f["y0"], f["y1"], f["d"], f["t"], f["o"], f["members"]
        if (u1 - u0) < 0.25 or (y1 - y0) < 0.25:
            continue
        normal = d if np.dot(cam_mean - d * o, d) >= 0 else -d    # faces the room (where cameras were)
        kind = _vertical_kind(u0, u1, y0, y1, floor_y, d * o, t, horiz)
        base = d * o
        corners = [base + t * uu + UP * (yy - base[1]) for uu, yy in ((u0, y0), (u1, y0), (u1, y1), (u0, y1))]
        center = np.mean(corners, axis=0)
        m = plane_frame(normal, center)
        local = _to_local(m, np.array(corners))
        out.append({"kind": kind, "pose": m, "polygon": local, "points": len(members),
                    "area": (u1 - u0) * (y1 - y0), "members": members})
    return out


MIN_FLAT_M2 = 0.08          # smaller horizontal bits (that aren't floor) are noise
FLOOR_BAND = 0.07           # m: patches this close to the floor height are the floor
CEILING_BAND = 0.04          # m: ceiling pieces this close in height are one level


def _union(pts, parts):
    members = np.concatenate([m for _, m, _, _ in parts])
    xz = pts[members][:, [0, 2]]
    corners = np.concatenate([xz + [dx, dz] for dx in (-VOXEL / 2, VOXEL / 2) for dz in (-VOXEL / 2, VOXEL / 2)])
    y = float(np.median(pts[members, 1]))
    return (y, members, hull(corners), sum(p[3] for p in parts))


def _merge_levels(pts, horiz, floor_y, cam_top):
    """One floor (everything at floor height, however patchy: the floor is
    seen in pieces between furniture), one ceiling per level and area, and
    no specks."""
    floor = [h for h in horiz if abs(h[0] - floor_y) < FLOOR_BAND]
    rest = [h for h in horiz if abs(h[0] - floor_y) >= FLOOR_BAND]
    ceil = [h for h in rest if h[0] - floor_y > 1.9 and h[0] > cam_top + 0.2]
    out = [h for h in rest if h not in ceil and h[3] >= MIN_FLAT_M2]
    if floor:
        out.append(_union(pts, floor))
    # Ceilings: one per level (rooms have dropped sections, soffits, beams):
    # pieces at the same height (± CEILING_BAND) join, other levels stay apart.
    levels = []
    for c in sorted(ceil, key=lambda c: -c[3]):
        for lv in levels:
            if abs(lv[0][0] - c[0]) < CEILING_BAND and min(poly_distance(o[2], c[2]) for o in lv) < 0.5:
                lv.append(c)
                break
        else:
            levels.append([c])
    for lv in levels:
        u = _union(pts, lv)
        if u[3] >= MIN_FLAT_M2:
            out.append(u)
    return out


WALL_JOIN_GAP = 0.4         # m along the wall between pieces of one wall
WALL_JOIN_OFF = 0.06        # m between their planes


def _join_vertical(found):
    """Pieces of one wall (split by furniture in front, doors, unseen bits)
    → one: same direction, same plane, small gaps. found: [{a0, o, u0, u1, y0, y1, members, d, t}]"""
    found = sorted(found, key=lambda f: (round(f["a0"], 2), f["o"], f["u0"]))
    out = []
    for f in found:
        for g in out:
            if abs(math.remainder(f["a0"] - g["a0"], math.pi)) < math.radians(7) and abs(f["o"] - g["o"]) < WALL_JOIN_OFF \
                    and max(g["u0"] - f["u1"], f["u0"] - g["u1"], 0) < WALL_JOIN_GAP \
                    and max(g["y0"] - f["y1"], f["y0"] - g["y1"], 0) < WALL_JOIN_GAP:
                n = len(g["members"]) + len(f["members"])
                g["o"] = (g["o"] * len(g["members"]) + f["o"] * len(f["members"])) / n
                g["u0"], g["u1"] = min(g["u0"], f["u0"]), max(g["u1"], f["u1"])
                g["y0"], g["y1"] = min(g["y0"], f["y0"]), max(g["y1"], f["y1"])
                g["members"] = np.concatenate([g["members"], f["members"]])
                break
        else:
            out.append(dict(f))
    return out


def _vertical_kind(u0, u1, y0, y1, floor_y, base, t, horiz):
    """A wall reaches high, or runs wide from the floor without being the
    front of something whose top is a horizontal surface right above it."""
    if (y1 - y0) >= 1.2 and y1 - floor_y >= 1.6:
        return "wall"
    if (u1 - u0) < 1.0 or y0 - floor_y > 0.15:
        return "other"
    top = np.array([base + t * uu + UP * (y1 - base[1]) for uu in np.linspace(u0, u1, 7)])[:, [0, 2]]
    for y, _, poly, _ in horiz:
        if abs(y - y1) < 0.08 and y - floor_y > 0.2:
            from_edge = [poly_distance(poly, q[None]) for q in top]
            if np.median(from_edge) < 0.1:
                return "other"   # e.g. a counter's or couch's front
    return "wall"


def _to_local(m, pts3):
    loc = apply(inverse(m), pts3)
    return np.round(loc[:, [0, 2]], 4)


# ---- merging every source ----------------------------------------------------------------

class _Obs:
    def __init__(self, o):
        self.o = o
        self.m = pose_to_matrix(o["pose"])
        self.n = self.m[:3, 1] / np.linalg.norm(self.m[:3, 1])
        poly = np.asarray(o["polygon"], dtype=np.float64)
        self.pts = apply(self.m, np.column_stack([poly[:, 0], np.zeros(len(poly)), poly[:, 1]]))
        self.cls = merge_class(o["kind"], self.n)
        self.w = float(o.get("weight") or SOURCE_WEIGHT.get(o.get("source"), 1.0))
        self.prio = SOURCE_PRIORITY.get(o.get("source"), 1)


class _Cluster:
    def __init__(self, ob):
        self.members = [ob]
        self.cls = ob.cls
        self.nsum = ob.n * ob.w
        self.wsum = ob.w
        self.allpts = ob.pts
        self.hull2d = hull(ob.pts[:, [0, 2]])

    @property
    def normal(self):
        n = self.nsum / np.linalg.norm(self.nsum)
        if self.cls in ("up", "down"):
            return np.array([0.0, 1.0 if self.cls == "up" else -1.0, 0.0])
        n = np.array([n[0], 0.0, n[2]])
        return n / np.linalg.norm(n)

    @property
    def offset(self):
        n = self.normal
        return sum(float(n @ m.pts.mean(axis=0)) * m.w for m in self.members) / self.wsum

    def accepts(self, ob):
        if ob.cls != self.cls:
            return False
        n = self.normal
        if float(n @ ob.n) < math.cos(math.radians(12)):
            return False
        horizontal = self.cls in ("up", "down")
        if abs(float(n @ ob.pts.mean(axis=0)) - self.offset) > (0.04 if horizontal else 0.06):
            return False
        if horizontal:
            if ob.o["kind"] in ("floor", "ceiling") and any(m.o["kind"] == ob.o["kind"] for m in self.members):
                return True    # one floor (ceiling) per height, however patchy
            return poly_distance(self.hull2d, ob.pts[:, [0, 2]]) < 0.10
        t = np.cross(UP, n)
        mine = self.allpts
        mu, ou = mine @ t, ob.pts @ t
        gap_u = max(mu.min() - ou.max(), ou.min() - mu.max(), 0.0)
        gap_y = max(mine[:, 1].min() - ob.pts[:, 1].max(), ob.pts[:, 1].min() - mine[:, 1].max(), 0.0)
        return gap_u < 0.3 and gap_y < 0.3

    def add(self, ob):
        self.members.append(ob)
        self.nsum = self.nsum + ob.n * ob.w
        self.wsum += ob.w
        self.allpts = np.concatenate([self.allpts, ob.pts])
        self.hull2d = hull(self.allpts[:, [0, 2]])

    def surface(self):
        n = self.normal
        d = self.offset
        pts = np.concatenate([m.pts for m in self.members])
        pts = pts - np.outer(pts @ n - d, n)            # onto the merged plane
        lead = max(self.members, key=lambda m: (m.prio, m.w))
        kind = lead.o["kind"]
        if self.cls in ("up", "down"):
            poly2 = simplify(hull(pts[:, [0, 2]]))
            axis = min_area_rect_axis(poly2)
            center = np.array([poly2[:, 0].mean(), d * n[1], poly2[:, 1].mean()])
            m = plane_frame(n, center, np.array([axis[0], 0.0, axis[1]]))
            local = _to_local(m, np.column_stack([poly2[:, 0], np.full(len(poly2), center[1]), poly2[:, 1]]))
        else:
            t = np.cross(UP, n)
            u, y = pts @ t, pts[:, 1]
            base = n * d
            corners = [base + t * uu + UP * (yy - base[1]) for uu, yy in
                       ((u.min(), y.min()), (u.max(), y.min()), (u.max(), y.max()), (u.min(), y.max()))]
            m = plane_frame(n, np.mean(corners, axis=0))
            local = _to_local(m, np.array(corners))
        sources = sorted({mb.o.get("source", "phone") for mb in self.members})
        users = sorted({mb.o.get("user") for mb in self.members if mb.o.get("user")})
        return {
            "kind": kind, "pose": matrix_to_pose(m), "polygon": [[float(a), float(b)] for a, b in local],
            "source": lead.o.get("source", "phone"), "sources": sources, "users": len(users),
            "evidence": round(self.wsum, 2),
            "first": min(mb.o.get("updated", 0) for mb in self.members),
            "last": max(mb.o.get("updated", 0) for mb in self.members),
            "members": [mb.o["id"] for mb in self.members],
            "prev": [mb.o.get("canonical") for mb in self.members if mb.o.get("canonical")],
        }


def merge(observations, previous=()):
    """Observations (any source/user) → merged surfaces. Each keeps the id
    most of its members had before, else the id of a previous surface in the
    same place (so ids stay stable as the map refines).
    observation: {id, kind, pose, polygon, source, weight?, user?, updated, canonical?}"""
    obs = [_Obs(o) for o in observations if len(o.get("polygon") or []) >= 3]
    obs.sort(key=lambda ob: (-ob.prio, -ob.w))
    clusters = []
    for ob in obs:
        for c in clusters:
            if c.accepts(ob):
                c.add(ob)
                break
        else:
            clusters.append(_Cluster(ob))
    out = [(c, c.surface()) for c in clusters]
    out.sort(key=lambda cs: -cs[1]["evidence"])
    prev = [(p["id"], _Obs({**p, "source": p.get("source", "map")})) for p in previous if len(p.get("polygon") or []) >= 3]
    taken = set()
    for c, s in out:
        votes = {}
        for p in s.pop("prev"):
            votes[p] = votes.get(p, 0) + 1
        sid = next((p for p, _ in sorted(votes.items(), key=lambda kv: -kv[1]) if p not in taken), None)
        if sid is None:
            sid = next((pid for pid, pob in prev if pid not in taken and c.accepts(pob)), None)
        s["id"] = sid or str(uuid.uuid4())
        taken.add(s["id"])
    return [s for _, s in out]
