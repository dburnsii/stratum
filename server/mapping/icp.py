"""Align new observations to the map: point-to-plane ICP, gravity-locked
(yaw + translation, 4 degrees of freedom; every device knows "up" well).

Degenerate views (only a floor in sight: sliding along it changes nothing)
are handled by only moving along directions the view actually pins down.
"""
import math

import numpy as np

from .geometry import apply, rot_y


def _step(pivot, dtheta, dt):
    """Rotate about a vertical axis through pivot, then translate."""
    m = rot_y(dtheta)
    m[:3, 3] = pivot - m[:3, :3] @ pivot + dt
    return m


def align(src, tree, tpts, tnrm, init=None, iters=15, max_d=(0.20, 0.10, 0.06, 0.04)):
    """src (N×3) → transform T (4×4) so that T·src lies on the map.
    Returns (T, stats {inliers, ratio, rms, dims (constrained directions)})."""
    T = np.eye(4) if init is None else init.copy()
    pivot = apply(T, src).mean(axis=0)
    stats = {"inliers": 0, "ratio": 0.0, "rms": math.inf, "dims": 0}
    for it in range(iters):
        md = max_d[min(it * len(max_d) // iters, len(max_d) - 1)]
        s = apply(T, src)
        d, idx = tree.query(s, distance_upper_bound=md)
        ok = np.isfinite(d)
        if ok.sum() < 30:
            return T, stats
        p, q, n = s[ok], tpts[idx[ok]], tnrm[idx[ok]]
        r = np.einsum("ij,ij->i", n, p - q)
        pr = p - pivot
        J = np.column_stack([n[:, 0] * pr[:, 2] - n[:, 2] * pr[:, 0], n[:, 0], n[:, 1], n[:, 2]])
        w = np.minimum(1.0, 0.015 / np.maximum(np.abs(r), 1e-9))           # Huber
        H = J.T @ (J * w[:, None])
        g = J.T @ (w * r)
        lam, V = np.linalg.eigh(H)
        good = lam > max(lam.max() * 2e-3, 1e-6 * len(r))
        x = -(V[:, good] @ ((V[:, good].T @ g) / lam[good]))
        T = _step(pivot, x[0], x[1:]) @ T
        stats = {"inliers": int(ok.sum()), "ratio": float(ok.mean()), "rms": float(np.sqrt(np.mean(r * r))), "dims": int(good.sum())}
        if abs(x[0]) < 1e-5 and np.linalg.norm(x[1:]) < 2e-4:
            break
    s = apply(T, src)
    d, idx = tree.query(s, distance_upper_bound=max_d[-1])
    ok = np.isfinite(d)
    r = np.einsum("ij,ij->i", tnrm[idx[ok]], s[ok] - tpts[idx[ok]]) if ok.any() else np.zeros(0)
    stats.update(inliers=int(ok.sum()), ratio=float(ok.mean()), rms=float(np.sqrt(np.mean(r * r))) if ok.any() else math.inf)
    return T, stats
