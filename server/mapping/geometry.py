"""Poses and rigid transforms. Matrices are numpy 4x4 (M @ [x, y, z, 1]);
the client sends three.js column-major arrays (from_js / to_js)."""
import math

import numpy as np

UP = np.array([0.0, 1.0, 0.0])


def from_js(a):
    return np.asarray(a, dtype=np.float64).reshape(4, 4).T


def to_js(m):
    return [round(float(v), 6) for v in np.asarray(m).T.reshape(-1)]


def pose_to_matrix(pose):
    """{p, q (x, y, z, w), s} → 4x4 (scale ignored: surfaces and cameras are rigid)."""
    x, y, z, w = pose["q"]
    n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / n, y / n, z / n, w / n
    m = np.eye(4)
    m[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                 [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                 [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
    m[:3, 3] = pose["p"]
    return m


def matrix_to_pose(m):
    r = np.asarray(m)[:3, :3]
    t = r[0, 0] + r[1, 1] + r[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        w, x, y, z = 0.25 * s, (r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = math.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        w, x, y, z = (r[2, 1] - r[1, 2]) / s, 0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s
    elif r[1, 1] > r[2, 2]:
        s = math.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        w, x, y, z = (r[0, 2] - r[2, 0]) / s, (r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s
    else:
        s = math.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        w, x, y, z = (r[1, 0] - r[0, 1]) / s, (r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s
    p = np.asarray(m)[:3, 3]
    return {"p": [round(float(v), 5) for v in p], "q": [round(float(v), 6) for v in (x, y, z, w)], "s": [1, 1, 1]}


def apply(m, pts):
    pts = np.asarray(pts, dtype=np.float64)
    return pts @ m[:3, :3].T + m[:3, 3]


def rot_y(yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    m = np.eye(4)
    m[:3, :3] = [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return m


def yaw_of(m):
    """Heading of a gravity-aligned transform (same convention as world.js)."""
    return math.atan2(-m[2, 0], m[0, 0])


def yaw_transform(yaw, t):
    m = rot_y(yaw)
    m[:3, 3] = t
    return m


def gravity_only(m):
    """Closest transform that keeps up as up (yaw + translation)."""
    return yaw_transform(yaw_of(m), np.asarray(m)[:3, 3])


def blend(a, b, k):
    """Move transform a toward b by k (yaw + translation; both gravity-aligned)."""
    ya, yb = yaw_of(a), yaw_of(b)
    dy = math.atan2(math.sin(yb - ya), math.cos(yb - ya))
    return yaw_transform(ya + dy * k, a[:3, 3] + (b[:3, 3] - a[:3, 3]) * k)


def plane_frame(normal, origin, xhint=None):
    """Surface frame: local +Y = normal, X along xhint (or horizontal), Z = X × Y."""
    y = np.asarray(normal, dtype=np.float64)
    y = y / np.linalg.norm(y)
    if xhint is None:
        xhint = np.array([1.0, 0, 0]) if abs(y[1]) > 0.9 else np.cross(UP, y)
    x = np.asarray(xhint, dtype=np.float64) - np.dot(xhint, y) * y
    x /= np.linalg.norm(x)
    z = np.cross(x, y)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = x, y, z, origin
    return m


def inverse(m):
    r = m[:3, :3].T
    out = np.eye(4)
    out[:3, :3] = r
    out[:3, 3] = -r @ m[:3, 3]
    return out
