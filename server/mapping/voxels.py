"""Sparse occupancy voxels: what is solid, what is empty, and since when.

Each observed voxel keeps a log-odds of being occupied, how many times it was
hit, when it was first/last seen, and its layer (what kind of thing it is
part of). Depth rays carve: every voxel a ray passes through gets evidence of
being empty, so things that are gone fade out of the map by being seen
through, not by being missed. Occupied evidence also decays with time unless
re-seen, at a rate set by the layer (walls ~never, clutter in days).

Keys pack (i, j, k) voxel indices into one int64; arrays stay sorted by key.
"""
import numpy as np

VOXEL = 0.04
OFF = 1 << 20
MASK = (1 << 21) - 1
HIT = 0.85
LO_MIN, LO_MAX = -1.5, 2.0
OCC = 0.5               # log-odds above this (and ≥ MIN_HITS hits): occupied
MIN_HITS = 2
FREE = -0.35            # log-odds below this: known empty
MAX_RAYS = 6000         # rays carved per keyframe
GRAZE = 0.03            # m: ...and "close" is this near its surface (mean hit)

CLUTTER, FURNITURE, STRUCTURE, UNSORTED = 0, 1, 2, 3   # UNSORTED: seen since the last plane pass
# Seeing through a voxel: how much that counts, by layer. Seeing through
# something should take effect fast (2 snapshots from fully solid, LO_MAX 2.0
# → 0.0 < OCC); walls and floors a little slower (3), so a passing hand or one
# noisy frame can't punch holes in them. Unsorted voxels (no surface
# direction known yet, so skimming rays can't be told apart) go slowly.
MISS = {CLUTTER: 1.0, FURNITURE: 1.0, STRUCTURE: 0.6, UNSORTED: 0.4}
GRAZE_SIN = 0.34        # rays within ~20° of a voxel's surface, passing close to it, only skim it
FIELDS = ("keys", "lo", "hits", "seen", "first", "layer", "mean", "minlo", "normal")
HALF_LIFE_S = {CLUTTER: 3 * 86400.0, FURNITURE: 30 * 86400.0, STRUCTURE: float("inf"), UNSORTED: 3 * 86400.0}


def pack(ijk):
    ijk = np.asarray(ijk, dtype=np.int64) + OFF
    return (ijk[:, 0] << 42) | (ijk[:, 1] << 21) | ijk[:, 2]


def unpack(keys):
    keys = np.asarray(keys, dtype=np.int64)
    return np.stack([(keys >> 42) & MASK, (keys >> 21) & MASK, keys & MASK], axis=1) - OFF


def keys_of(pts):
    return pack(np.floor(np.asarray(pts) / VOXEL).astype(np.int64))


def centers(keys):
    return (unpack(keys) + 0.5) * VOXEL


class VoxelMap:
    def __init__(self):
        self.keys = np.zeros(0, np.int64)
        self.lo = np.zeros(0, np.float32)
        self.hits = np.zeros(0, np.uint16)
        self.seen = np.zeros(0, np.int64)     # last observed (epoch s)
        self.first = np.zeros(0, np.int64)
        self.layer = np.zeros(0, np.uint8)
        self.mean = np.zeros((0, 3), np.float32)   # where in the voxel the surface really is (mean hit)
        self.minlo = np.zeros(0, np.float32)       # lowest log-odds ever: was it ever seen empty?
        self.normal = np.zeros((0, 3), np.float16) # surface direction (from the plane pass; 0 = not known)

    def __len__(self):
        return len(self.keys)

    # ---- persistence ---------------------------------------------------------

    def arrays(self):
        return {"keys": self.keys, "lo": self.lo, "hits": self.hits, "seen": self.seen, "first": self.first, "layer": self.layer,
                "mean": self.mean, "minlo": self.minlo, "normal": self.normal}

    @classmethod
    def from_arrays(cls, a):
        m = cls()
        for k in FIELDS:
            if k in a:   # (older maps lack newer fields: start them empty-handed)
                setattr(m, k, np.asarray(a[k]).astype(getattr(m, k).dtype))
        n = len(m.keys)
        if len(m.normal) != n:
            m.normal = np.zeros((n, 3), np.float16)
        if len(m.minlo) != n:
            m.minlo = np.zeros(n, np.float32)
        return m

    # ---- observing -------------------------------------------------------------

    def _index(self, k):
        """Positions of keys k (sorted unique) in self.keys; -1 where absent."""
        pos = np.searchsorted(self.keys, k)
        found = pos < len(self.keys)
        found[found] = self.keys[pos[found]] == k[found]
        return np.where(found, pos, -1)

    def _insert(self, k, now):
        """Add absent sorted keys k (unknown state)."""
        if not len(k):
            return
        pos = np.searchsorted(self.keys, k)
        self.keys = np.insert(self.keys, pos, k)
        self.lo = np.insert(self.lo, pos, np.zeros(len(k), np.float32))
        self.hits = np.insert(self.hits, pos, np.zeros(len(k), np.uint16))
        self.seen = np.insert(self.seen, pos, np.full(len(k), now, np.int64))
        self.first = np.insert(self.first, pos, np.full(len(k), now, np.int64))
        self.layer = np.insert(self.layer, pos, np.full(len(k), UNSORTED, np.uint8))
        self.normal = np.insert(self.normal, pos, np.zeros((len(k), 3), np.float16), axis=0)
        self.mean = np.insert(self.mean, pos, centers(k).astype(np.float32), axis=0)
        self.minlo = np.insert(self.minlo, pos, np.zeros(len(k), np.float32))

    def occupied_mask(self, idx=None):
        lo = self.lo if idx is None else self.lo[idx]
        hits = self.hits if idx is None else self.hits[idx]
        return (lo > OCC) & (hits >= MIN_HITS)

    def integrate(self, origin, pts, now, weight=1.0, carve=True):
        """One observation: hits at pts, empty space along rays from origin
        (if carve). Returns (appeared keys, gone keys): voxels that became
        solid where there was known empty space, or were solid and are now
        seen through."""
        if not len(pts):
            return np.zeros(0, np.int64), np.zeros(0, np.int64)
        all_keys = keys_of(pts)
        hit_keys, inv = np.unique(all_keys, return_inverse=True)
        free_keys = np.zeros(0, np.int64)
        if carve and origin is not None:
            fk, dirs = self._ray_keys(origin, pts)
            free_keys = np.setdiff1d(fk, hit_keys, assume_unique=True)
            free_keys = free_keys[~self._grazed(np.asarray(origin, dtype=np.float64), free_keys, fk, dirs)]
        touched = np.union1d(hit_keys, free_keys)
        self._insert(touched[self._index(touched) < 0], now)
        idx = self._index(touched)
        before = self.occupied_mask(idx)
        is_hit = np.isin(touched, hit_keys, assume_unique=True)
        miss = np.array([MISS[CLUTTER], MISS[FURNITURE], MISS[STRUCTURE], MISS[UNSORTED]], np.float32)[self.layer[idx]]
        delta = np.where(is_hit, HIT, -miss).astype(np.float32) * weight
        self.lo[idx] = np.clip(self.lo[idx] + delta, LO_MIN, LO_MAX)
        h = idx[is_hit]
        # Mean hit position: this observation's mean, blended in by hit count.
        sums = np.zeros((len(hit_keys), 3))
        np.add.at(sums, inv, pts)
        obs_mean = sums / np.bincount(inv, minlength=len(hit_keys))[:, None]
        hi = self._index(hit_keys)
        k = 1.0 / (np.minimum(self.hits[hi], 30).astype(np.float64) + 1.0)
        self.mean[hi] = (self.mean[hi] + (obs_mean - self.mean[hi]) * k[:, None]).astype(np.float32)
        self.hits[h] = np.minimum(self.hits[h].astype(np.int32) + 1, 65535).astype(np.uint16)
        self.seen[idx] = now
        self.minlo[idx] = np.minimum(self.minlo[idx], self.lo[idx])
        after = self.occupied_mask(idx)
        # Appeared: solid now where it was once seen empty (not just seen again).
        # Gone: was solid with real evidence, now seen through.
        appeared = ~before & after & (self.minlo[idx] < FREE)
        gone = before & ~after & (self.hits[idx] >= 3)
        return touched[appeared], touched[gone]

    @staticmethod
    def _ray_keys(origin, pts):
        """Voxels the rays origin → pts pass through, stopping short of the
        surface (more margin far away, where depth is noisier). → (sorted
        unique keys, per key: the unit direction of one ray through it)."""
        empty = (np.zeros(0, np.int64), np.zeros((0, 3)))
        if len(pts) > MAX_RAYS:
            pts = pts[np.linspace(0, len(pts) - 1, MAX_RAYS).astype(int)]
        d = pts - origin
        length = np.linalg.norm(d, axis=1)
        ok = length > 1e-6
        d, length = d[ok] / length[ok, None], length[ok]
        margin = 1.5 * VOXEL + 0.012 * length * length
        n = np.maximum(0, np.floor((length - margin) / VOXEL)).astype(np.int64)
        total = int(n.sum())
        if not total:
            return empty
        ray = np.repeat(np.arange(len(n)), n)
        start = np.repeat(np.cumsum(n) - n, n)
        step = np.arange(total) - start
        t = (step + 0.5) * VOXEL
        samples = origin + d[ray] * t[:, None]
        keys, first = np.unique(keys_of(samples), return_index=True)
        return keys, d[ray[first]]

    def _grazed(self, origin, free_keys, all_keys, dirs):
        """Free voxels a ray only skimmed: it ran nearly along the voxel's
        surface, close to it. Those don't count as seen through (a ray
        skimming a table top says nothing about the table); a ray crossing
        where a cup was does."""
        out = np.zeros(len(free_keys), dtype=bool)
        if not len(free_keys) or not len(self.keys):
            return out
        idx = self._index(free_keys)
        has = idx >= 0
        has[has] = np.abs(self.normal[idx[has]]).sum(axis=1) > 0
        if not has.any():
            return out
        di = dirs[np.searchsorted(all_keys, free_keys[has])]
        n = self.normal[idx[has]].astype(np.float64)
        along = np.abs(np.einsum("ij,ij->i", di, n)) < GRAZE_SIN
        rel = self.mean[idx[has]] - origin
        near = np.linalg.norm(np.cross(rel, di), axis=1) < GRAZE
        out[has] = along & near
        return out

    # ---- reading -----------------------------------------------------------------

    def effective_lo(self, now):
        """Log-odds with time decay of occupied evidence (by layer)."""
        lo = self.lo.astype(np.float64)
        pos = lo > 0
        if pos.any():
            age = np.maximum(0, now - self.seen[pos]).astype(np.float64)
            hl = np.array([HALF_LIFE_S[k] for k in (CLUTTER, FURNITURE, STRUCTURE, UNSORTED)])[self.layer[pos]]
            lo[pos] *= np.power(0.5, age / hl)
        return lo

    def occupied(self, now):
        """Indices of occupied voxels now (decay applied)."""
        return np.nonzero((self.effective_lo(now) > OCC) & (self.hits >= MIN_HITS))[0]

    def state_at(self, pts, now):
        """Per point: 1 occupied, -1 known empty, 0 unknown; plus last-seen time."""
        k = keys_of(pts)
        idx = self._index(k)
        out = np.zeros(len(k), np.int8)
        seen = np.zeros(len(k), np.int64)
        have = idx >= 0
        if have.any():
            lo = self.effective_lo(now)[idx[have]]
            occ = (lo > OCC) & (self.hits[idx[have]] >= MIN_HITS)
            out[have] = np.where(occ, 1, np.where(lo < FREE, -1, 0))
            seen[have] = self.seen[idx[have]]
        return out, seen

    def set_layers(self, keys, layer):
        idx = self._index(np.unique(keys))
        idx = idx[idx >= 0]
        cur = self.layer[idx]
        self.layer[idx] = np.where(cur == UNSORTED, layer, np.maximum(cur, layer))   # structure beats furniture beats clutter

    def compact(self, now):
        """Drop voxels that carry almost no information."""
        weak = (np.abs(self.lo) < 0.05) & (self.hits == 0)
        if weak.any():
            keep = ~weak
            for k in FIELDS:
                setattr(self, k, getattr(self, k)[keep])
