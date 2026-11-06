"""AprilTag pipeline: pose math, then full detection through the emulated
phone camera (fake camera image with real 36h11 tags drawn on it)."""
import math

import pytest
from playwright.sync_api import Page

TAG = 0.1   # probe default tag size (m)


def open_page(page: Page, base: str, url="/probe"):
    page.goto(base + url)
    page.wait_for_function("window.__probe")


# ---- pose math (pure JS, run in the page) ------------------------------------

POSE_MATH = """async ({ cases }) => {
  const THREE = await import('three');
  const P = await import('/js/vision/pose.js');
  const K = { fx: 600, fy: 600, cx: 320, cy: 240 };
  const s = 0.05;
  const obj = [[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]];
  return cases.map(({ rx, ry, rz, t }) => {
    const truth = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(...t);
    const corners = obj.map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(truth);
      return [K.fx * p.x / p.z + K.cx, K.fy * p.y / p.z + K.cy];
    });
    const est = P.tagPoseCV(corners, 2 * s, K);
    const d = (a, b) => Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
    return d(est, truth);
  });
}"""


def test_pose_from_corners_recovers_known_poses(page: Page, live_server):
    open_page(page, live_server)
    cases = [
        {"rx": 0, "ry": 0, "rz": 0, "t": [0, 0, 0.5]},
        {"rx": 0.5, "ry": -0.3, "rz": 1.2, "t": [0.1, -0.05, 0.8]},
        {"rx": -0.9, "ry": 0.2, "rz": -2.5, "t": [-0.2, 0.1, 1.5]},
    ]
    errors = page.evaluate(POSE_MATH, {"cases": cases})
    assert max(errors) < 1e-6, errors


def test_gravity_alignment_flat_vs_wall(page: Page, live_server):
    open_page(page, live_server)
    r = page.evaluate("""async () => {
      const THREE = await import('three');
      const P = await import('/js/vision/pose.js');
      const yaw = (m) => { const x = new THREE.Vector3().setFromMatrixColumn(m, 0); return Math.atan2(-x.z, x.x); };
      // Flat tag on a table, rotated 30° about up, slightly tilted (noise).
      const flat = new THREE.Matrix4().makeRotationY(0.5236).multiply(new THREE.Matrix4().makeRotationX(0.05));
      // Wall tag facing +x (normal = +x), rotated 40° in its own plane.
      const wall = new THREE.Matrix4().makeRotationZ(-Math.PI / 2).multiply(new THREE.Matrix4().makeRotationY(0.7));
      const f = P.gravityAligned(flat), w = P.gravityAligned(wall);
      return { flat: [f.mount, yaw(f.matrix)], wall: [w.mount, new THREE.Vector3(0, 0, 1).applyMatrix4(new THREE.Matrix4().extractRotation(w.matrix)).toArray()] };
    }""")
    assert r["flat"][0] == "flat" and abs(r["flat"][1] - 0.5236) < 1e-3
    assert r["wall"][0] == "wall"
    assert [round(v, 3) for v in r["wall"][1]] == [1, 0, 0]   # frame z points out of the wall


# ---- full pipeline through the emulated phone camera -------------------------

def enter_with_camera(page: Page, base: str, spec: dict):
    page.add_init_script(f"window.__fakeCamera = {spec!r};".replace("True", "true").replace("False", "false"))
    page.goto(f"{base}/probe?emulate=phone")
    page.click("#enter")
    page.wait_for_function("window.__probe.tracker", timeout=10000)


def tag_state(page: Page, tag_id: int):
    return page.evaluate(f"""() => {{
      const t = window.__probe.tracker.tags.get({tag_id});
      if (!t) return null;
      const col = (m, i) => [m.elements[i * 4], m.elements[i * 4 + 1], m.elements[i * 4 + 2]];
      const K = window.__probe.tracker.last.K;
      return {{ pos: col(t.pose, 3), rawX: col(t.raw, 0), rawY: col(t.raw, 1), mount: t.mount, seen: t.seen,
               fx: K.fx, head: [window.__xrDevice.position.x, window.__xrDevice.position.y, window.__xrDevice.position.z],
               flipped: window.__probe.tracker.last.flipped }};
    }}""")


def wait_tag(page: Page, tag_id: int, seen=3):
    page.wait_for_function(f"window.__probe.tracker.tags.get({tag_id})?.seen >= {seen}", timeout=10000)
    return tag_state(page, tag_id)


def expected_ahead(st, px):
    d = st["fx"] * TAG / px   # pinhole: pixel width = fx * size / depth
    return [st["head"][0], st["head"][1], st["head"][2] - d]


def dist(a, b):
    return math.dist(a, b)


@pytest.mark.parametrize("flip_y", [True, False], ids=["gl-upright", "upside-down-texture"])
def test_tag_straight_ahead_is_located_in_world(page: Page, live_server, flip_y):
    px = 120
    enter_with_camera(page, live_server, {"tags": [{"id": 0, "x": 320, "y": 180, "px": px}], "flipY": flip_y})
    st = wait_tag(page, 0)
    exp = expected_ahead(st, px)
    assert dist(st["pos"], exp) < 0.02, (st, exp)
    assert st["mount"] == "wall"                              # facing the camera
    assert st["rawY"][2] > 0.95, st                           # normal points back at the viewer
    assert st["flipped"] is (not flip_y)                      # fallback used only when needed


def test_in_plane_rotation_and_corner_order(page: Page, live_server):
    enter_with_camera(page, live_server, {"tags": [{"id": 0, "x": 320, "y": 180, "px": 120, "rot": 30}]})
    st = wait_tag(page, 0)
    # Clockwise on screen = rotation about the view axis (+z toward viewer) by -30°.
    exp_x = [math.cos(math.radians(30)), -math.sin(math.radians(30)), 0]
    assert dist(st["rawX"], exp_x) < 0.05, st


def test_two_tags_tracked_separately(page: Page, live_server):
    enter_with_camera(page, live_server, {"tags": [{"id": 1, "x": 200, "y": 180, "px": 90}, {"id": 2, "x": 450, "y": 180, "px": 90}]})
    a, b = wait_tag(page, 1), wait_tag(page, 2)
    assert b["pos"][0] - a["pos"][0] > 0.1    # tag 2 is to the right of tag 1
    lines = page.evaluate("window.__probe.lines")
    assert any(l.startswith("tag 1 found") for l in lines) and any(l.startswith("tag 2 found") for l in lines)


def test_no_tag_no_detection(page: Page, live_server):
    enter_with_camera(page, live_server, {"tags": []})
    page.wait_for_function("window.__probe.tracker.stats.submitted >= 5", timeout=10000)
    assert page.evaluate("window.__probe.tracker.tags.size") == 0
