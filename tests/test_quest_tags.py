"""Quest tags (DESIGN.md §3.9): the headset camera (getUserMedia; a fake one
with KNOWN lens / placement / latency here) feeds the tag tracker; a
calibration from one tag recovers the camera; then tags land where they
really are, and a Space can be created at one."""
import json
import math

from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest

TAG = {"id": 0, "size": 0.1, "p": [0.0, 1.3, -0.6], "normal": [0, 0, 1]}
CAM = {"width": 1280, "height": 960, "hfovDeg": 68, "cxOffset": 14,
       "extrinsic": {"p": [0.03, -0.025, -0.06], "euler": [-0.17, 0.03, 0.0]}, "latencyMs": 60, "tags": [TAG]}
QC = "window.__app.questCamera()"


def look_from(page: Page, eye, aim_off=(0.0, 0.0)):
    """Put the head at eye, looking at the tag (plus an offset, so the tag
    lands in different parts of the image)."""
    page.evaluate(f"""async () => {{ const THREE = await import('three');
      const eye = new THREE.Vector3(...{json.dumps(list(eye))}), t = new THREE.Vector3(...{json.dumps(TAG['p'])});
      t.x += {aim_off[0]}; t.y += {aim_off[1]};
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, t, new THREE.Vector3(0, 1, 0)));
      const d = window.__xrDevice; d.position.x = eye.x; d.position.y = eye.y; d.position.z = eye.z; d.quaternion.set(q.x, q.y, q.z, q.w); }}""")


def test_calibrate_from_one_tag_then_tags_land_where_they_are(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(f"window.__fakeQuestCamera = {json.dumps(CAM)};")
    open_quest(page, live_server)
    look_from(page, (0.0, 1.45, 0.25))
    page.wait_for_function(f"{QC}.feed && {QC}.tracker?.tags.has(0)", timeout=10000)   # the camera sees the tag in AR
    assert page.evaluate(f"{QC}.state.state") == "uncalibrated"
    assert page.evaluate("window.__app.menuData().tag?.id") == 0                       # offered…
    assert page.evaluate("window.__app.world.tracker") is None                         # …but rough until calibrated: no aligning by it

    page.evaluate("window.__app.questMenu().p.calibrate()")
    assert page.evaluate(f"{QC}.state.state") == "calibrating"
    # Move around the tag: left/right, up/down, closer/farther, aiming at different parts of it.
    for i in range(70):
        a = i / 70 * 2 * math.pi
        eye = (0.28 * math.sin(a), 1.45 + 0.15 * math.sin(2 * a), 0.25 + 0.12 * math.cos(a))
        look_from(page, eye, (0.12 * math.cos(3 * a), 0.08 * math.sin(5 * a)))
        page.wait_for_timeout(110)
        if page.evaluate(f"{QC}.state.state") != "calibrating" or page.evaluate(f"{QC}.calibration?.solving"):
            break
    page.wait_for_function(f"{QC}.state.state !== 'calibrating'", timeout=30000)
    assert page.evaluate(f"{QC}.state.state") == "calibrated", page.evaluate(f"{QC}.state.note")

    got = page.evaluate(f"{QC}.feed.calib")
    truth = page.evaluate("window.__fakeQuestCameraTruth")
    assert abs(got["f"] - truth["f"]) / truth["f"] < 0.03, (got["f"], truth["f"])
    assert abs(got["latencyMs"] - truth["latencyMs"]) <= 25, (got["latencyMs"], truth["latencyMs"])
    t_err = math.dist(got["extrinsic"][12:15], truth["extrinsic"][12:15])
    assert t_err < 0.025, (got["extrinsic"][12:15], truth["extrinsic"][12:15])
    r_err = page.evaluate(f"""async () => {{ const THREE = await import('three');
      const a = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray({json.dumps(got['extrinsic'])}));
      const b = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().fromArray({json.dumps(truth['extrinsic'])}));
      return a.angleTo(b) * 180 / Math.PI; }}""")
    assert r_err < 1.5, r_err

    assert page.evaluate("window.__app.world.tracker !== null")                        # now tags can place / align Spaces
    # With the calibration, the tag is found where it really is.
    look_from(page, (0.15, 1.5, 0.2))
    page.wait_for_function(f"{QC}.tracker.tags.get(0)?.seen > 5", timeout=8000)
    page.wait_for_timeout(600)
    p = page.evaluate(f"""async () => {{ const THREE = await import('three');
      return new THREE.Vector3().setFromMatrixPosition({QC}.tracker.tags.get(0).pose).toArray(); }}""")
    assert math.dist(p, TAG["p"]) < 0.02, p

    # And a Space can be made at it (the shared kind: any device that sees the tag).
    page.evaluate("window.__app.questMenu().p.createAtTag()")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.markers?.has(0) && s.aligned)", timeout=8000)
    # Once its sightings agree, the headset holds it with a saved anchor; tags then only check it.
    page.wait_for_function("""[...window.__app.world.spaces.values()].some(s => s.markers?.has(0)
      && [...s.anchors.values()].some(a => a.fromTags && a.handle && a.tracked) && s.alignedBy === 'anchor')""", timeout=20000)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => s.markers?.has(0)).id")
    device = page.evaluate("window.__app.world.device")
    spaces = page.request.get(f"{live_server}/api/spaces?device={device}").json()["spaces"]
    assert any(a.get("handle") for s in spaces if s["id"] == sid for a in s["anchors"])   # bound to this headset for next time


COUNT_READBACKS = """(() => { const orig = CanvasRenderingContext2D.prototype.getImageData; window.__readbacks = 0;
  CanvasRenderingContext2D.prototype.getImageData = function (...a) { if (window.__xrSession) window.__readbacks++; return orig.apply(this, a); }; })()"""


def start_seeing(page: Page, live_server, path=None):
    login(page, live_server)
    page.add_init_script(f"window.__fakeQuestCamera = {json.dumps(CAM)};")
    if path:
        page.add_init_script(f"window.__questcamPath = '{path}';")
    page.add_init_script(COUNT_READBACKS)
    open_quest(page, live_server)
    look_from(page, (0.0, 1.45, 0.25))
    page.wait_for_function(f"{QC}.feed && {QC}.tracker?.tags.has(0)", timeout=10000)


def test_each_frame_path_reads_tags_without_main_thread_readback(page: Page, live_server, browser):
    start_seeing(page, live_server)
    best = page.evaluate(f"{QC}.feed.path")
    assert best in ("worker-track", "main-frames"), best                    # pixels never on the main thread
    assert page.evaluate("window.__readbacks") == 0
    for path in ("main-frames", "video-bitmap"):
        other = browser.new_page()
        start_seeing(other, live_server, path)
        assert other.evaluate(f"{QC}.feed.path") == path
        assert other.evaluate("window.__readbacks") == 0, path              # (video-bitmap: the worker reads it)
        other.close()


def test_frames_are_processed_when_worth_it(page: Page, live_server):
    start_seeing(page, live_server)
    stats = lambda: page.evaluate(f"({{ ...{QC}.feed.stats.reason, grabs: {QC}.feed.stats.grabs }})")
    page.wait_for_timeout(1500)
    a = stats()
    page.wait_for_timeout(3000)                                             # holding still, nothing new
    b = stats()
    assert 2 <= b["grabs"] - a["grabs"] <= 7, (a, b)                       # about once a second (or twice: searching)
    # Turn away 30° and stop: a frame right away ("new view").
    page.evaluate("""() => { const q = window.__xrDevice.quaternion; const s = Math.sin(0.26), c = Math.cos(0.26);
      const x = q.x, y = q.y, z = q.z, w = q.w; q.set(w * 0 + x * c + y * 0 - z * s, w * s + y * c + z * 0 - x * 0, w * 0 + z * c + x * s - y * 0, w * c - y * s - x * 0 - z * 0); }""")
    page.wait_for_timeout(400)
    assert stats().get("new view", 0) > a.get("new view", 0)
    # Calibrating: many frames.
    page.evaluate("window.__app.questMenu().p.calibrate()")
    c0 = stats()["grabs"]
    page.wait_for_timeout(1500)
    assert stats()["grabs"] - c0 >= 6
