"""Living world map end to end (DESIGN.md §3.10): an emulated phone and an
emulated Quest look around a fake room; their depth snapshots (phone: CPU
depth with a real phone's rotated depth buffer; Quest: GPU depth read back)
reach the server, which builds surfaces from them; the Quest's room scan and
room mesh go up on their own; "Show the map" draws what the map holds."""
import json
import math
import time
from pathlib import Path

from playwright.sync_api import Page

from test_main import TAG_A, create_space, login, set_camera
from test_quest import aim, open_quest, press

SHOTS = Path(__file__).parent.parent / "test-results"

# IWER global space: floor y = 0, the device at about (0, 1.6, 0) looking down -z.
ROOM = {
    "planes": [
        {"label": "floor", "center": [0, 0, -1], "normal": [0, 1, 0], "size": [5, 5]},
        {"label": "wall", "center": [0, 1.3, -2.2], "normal": [0, 0, 1], "size": [5, 2.6]},
        {"label": "wall", "center": [-1.8, 1.3, -1], "normal": [1, 0, 0], "size": [5, 2.6]},
    ],
    "boxes": [{"center": [0.9, 0.46, -1.8], "size": [1.4, 0.92, 0.6]}],      # a counter against the far wall
}
# A real phone's depth buffer is rotated against the view (telemetry, Android Chrome).
PHONE_UV = [0, -0.792, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0.896, 0, 1]


def turn(page: Page, pitch=0.0, yaw=0.0, wait=900):
    page.evaluate(f"""async () => {{ const THREE = await import('three');
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler({math.radians(pitch)}, {math.radians(yaw)}, 0, 'YXZ'));
      window.__xrDevice.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(wait)


def world_surfaces(page: Page, sid: str):
    """The merged surfaces this page has, in world (IWER) coordinates."""
    return page.evaluate(f"""async () => {{ const THREE = await import('three');
      const space = window.__app.world.spaces.get('{sid}');
      return window.__app.roomMap.surfaces('{sid}').map((s) => {{
        const m = space.root.matrix.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...s.pose.p),
          new THREE.Quaternion(...s.pose.q), new THREE.Vector3(1, 1, 1)));
        const p = new THREE.Vector3().setFromMatrixPosition(m), n = new THREE.Vector3().setFromMatrixColumn(m, 1);
        return {{ kind: s.kind, sources: s.sources, p: p.toArray(), n: n.toArray() }}; }}); }}""")


def wait_for(fn, timeout=40, what=""):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(0.5)
    raise AssertionError(f"timed out: {what}")


def open_settings_row(page: Page, text: str):
    if not page.evaluate("window.__app.sheetOpen()"):
        page.click("#ov-fab")
    page.click("#ov-sheet [data-tab=settings]")
    page.click(f"#ov-sheet .rowbtn:has-text('{text}')")


def test_phone_depth_builds_the_shared_map(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)}; window.__fakeDepthTransform = {json.dumps(PHONE_UV)};")
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    set_camera(page, [])   # the fake tag would turn with the phone; out of view, the Space stays put
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    assert page.evaluate("window.__app.mapper.depth") == "cpu-optimized"     # phones: CPU depth, no readback
    for pitch, yaw in ((-20, 0), (-35, -20), (-35, 20), (-50, 0), (-15, 35), (-25, 55), (-45, 40), (-20, -35), (-40, -60), (-10, 0)):
        turn(page, pitch, yaw)
    sent = page.evaluate("window.__app.mapper.stats.sent")
    assert sent >= 6, page.evaluate("window.__app.mapper.stats")
    assert page.evaluate("window.__app.mapper.stats.images") >= 1                   # camera images ride along (visual SLAM)

    def surfaces():
        page.evaluate(f"window.__app.roomMap.load('{sid}')")
        page.wait_for_timeout(200)
        got = world_surfaces(page, sid)
        kinds = {s["kind"] for s in got if "map" in s["sources"]}
        return got if {"floor", "wall", "counter"} <= kinds else None
    got = wait_for(surfaces, what="floor, wall and counter from depth")
    floor = next(s for s in got if s["kind"] == "floor" and "map" in s["sources"])
    assert abs(floor["p"][1]) < 0.04, floor                                   # depth landed where the room is
    counter = next(s for s in got if s["kind"] == "counter")
    assert abs(counter["p"][1] - 0.92) < 0.04, counter
    far = [s for s in got if s["kind"] == "wall" and s["n"][2] > 0.9]
    assert far and abs(far[0]["p"][2] + 2.2) < 0.05, far

    # Settings → Show the map: voxels drawn in the Space.
    open_settings_row(page, "Show the map")
    page.wait_for_function(f"window.__app?.mapView.count('{sid}') > 300", timeout=10000)
    page.click("#ov-scrim", position={"x": 200, "y": 120})
    turn(page, -30, 10, wait=400)
    page.screenshot(path=str(SHOTS / "map-phone.png"))
    assert "snapshot" in page.evaluate("window.__app.menuData().settings.mapNote")


def test_quest_gpu_depth_room_scan_and_mesh_go_up_on_their_own(page: Page, live_server):
    login(page, live_server)
    grid = [[x * 0.25 - 2, 0.0, z * 0.25 - 3] for x in range(17) for z in range(17)]   # the room mesh: just a floor, here
    room = {**ROOM, "meshes": [{"label": "global mesh", "vertices": [v for p in grid for v in p], "indices": []}]}
    page.add_init_script(f"window.__fakeRoom = {json.dumps(room)};")
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('cube')")                # first placement makes the Space
    aim(page, "right", [0.3, 0, -1.2])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.sharedLayer)", timeout=8000)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    assert page.evaluate("window.__app.mapper.depth") == "gpu-optimized"
    for pitch, yaw in ((-25, 0), (-40, 20), (-40, -20), (-15, 40), (-30, 60), (-55, 0), (-20, -45), (-10, 0)):
        turn(page, pitch, yaw)
    st = page.evaluate("window.__app.mapper.stats")
    assert st["sent"] >= 5 and st["meshes"] >= 1, st
    assert page.evaluate("window.__app.mapper.gpu.reads") >= 5

    def scan_and_map():
        page.evaluate(f"window.__app.roomMap.load('{sid}')")
        page.wait_for_timeout(200)
        got = world_surfaces(page, sid)
        quest = {s["kind"] for s in got if "quest" in s["sources"]}            # Space Setup planes, no button
        mapped = {s["kind"] for s in got if "map" in s["sources"]}
        return got if {"floor", "wall"} <= quest and "counter" in mapped else None
    got = wait_for(scan_and_map, what="room scan + depth surfaces")
    floor = [s for s in got if s["kind"] == "floor"]
    assert len(floor) == 1 and set(floor[0]["sources"]) >= {"quest", "map"}, floor     # one floor, both sources
    counter = next(s for s in got if s["kind"] == "counter")
    assert abs(counter["p"][1] - 0.92) < 0.05, counter
    info = page.request.get(f"{live_server}/api/spaces/{sid}/map/info").json()
    assert info["keyframes"] >= st["sent"] + 1                                  # + the mesh point set
    page.evaluate("window.__app.menuData()")                                    # settings data builds
    page.evaluate("window.__app.mapView.setVisible(true); window.__app.roomMap.setVisible(true)")
    page.wait_for_function(f"window.__app?.mapView.count('{sid}') > 300", timeout=10000)
    turn(page, -30, 15, wait=500)
    page.screenshot(path=str(SHOTS / "map-quest.png"))


def test_map_off_sends_nothing(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)}; localStorage.setItem('stratum.mapOn', '0');")
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.3, 0, -1.2])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.sharedLayer)", timeout=8000)
    for pitch, yaw in ((-25, 0), (-40, 30)):
        turn(page, pitch, yaw)
    assert page.evaluate("window.__app.mapper.stats.sent") == 0
    assert "depth-sensing" not in page.evaluate("window.__xrSession.enabledFeatures")


def test_phone_makes_camera_images_at_most_once_a_second(page: Page, live_server):
    """Grayscale copies cost main-thread work on phones: only when the map wants one."""
    login(page, live_server)
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)};")
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    page.evaluate("""() => { const m = window.__app.mapper; window.__imgs = 0;
      const orig = m.noteImage.bind(m); m.noteImage = (img) => { window.__imgs++; orig(img); }; }""")
    t0 = time.time()
    page.wait_for_timeout(4000)
    n = page.evaluate("window.__imgs")
    caps = page.evaluate("window.__app.tracker.stats.submitted")
    assert 1 <= n <= (time.time() - t0) + 1, (n, caps)                   # ≤ ~1/s
    assert caps > n                                                      # tag captures happen more often than images
