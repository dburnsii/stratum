"""Camera probe page in a real (headless) Chromium with an emulated Quest 3.

IWER (Meta's WebXR emulator, client/vendor/iwer) stands in for the headset;
tests move its controllers and press buttons through window.__xrDevice and
read app state from window.__probe.
"""
import pytest
from playwright.sync_api import Page, expect


def enter_ar(page: Page, base: str):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/probe?emulate=quest3")
    page.click("#enter")
    page.wait_for_function("window.__probe.lines.some(l => l.startsWith('session:'))", timeout=10000)
    return errors


def set_controller(page: Page, hand: str, x: float, y: float, z: float):
    page.evaluate(f"window.__xrDevice.controllers['{hand}'].position.set({x}, {y}, {z})")


def press(page: Page, hand: str, button: str):
    """Press and release, letting a few frames pass so the runtime sees both."""
    page.evaluate(f"window.__xrDevice.controllers['{hand}'].updateButtonValue('{button}', 1)")
    page.wait_for_timeout(150)
    page.evaluate(f"window.__xrDevice.controllers['{hand}'].updateButtonValue('{button}', 0)")
    page.wait_for_timeout(150)


def cubes(page: Page):
    return page.evaluate("""window.__probe.cubes.map(c => ({
        p: c.position.toArray(), rotY: c.rotation.y, color: c.material.color.getHexString() }))""")


def test_enters_passthrough_ar(page: Page, live_server):
    errors = enter_ar(page, live_server)
    session = next(l for l in page.evaluate("window.__probe.lines") if l.startswith("session:"))
    assert "alpha-blend" in session          # passthrough, not opaque VR
    assert errors == []


@pytest.mark.parametrize("hand", ["left", "right"])
def test_trigger_spawns_cube_at_controller(page: Page, live_server, hand):
    enter_ar(page, live_server)
    set_controller(page, hand, 0.3, 1.2, -0.4)
    page.wait_for_timeout(100)
    press(page, hand, "trigger")
    [cube] = cubes(page)
    # Spawns at the grip, which sits a few cm from the controller origin.
    dist = sum((a - b) ** 2 for a, b in zip(cube["p"], [0.3, 1.2, -0.4])) ** 0.5
    assert dist < 0.1, cube


def test_each_trigger_adds_a_cube_with_its_own_color(page: Page, live_server):
    enter_ar(page, live_server)
    for hand in ["left", "right", "left", "right"]:
        press(page, hand, "trigger")
    cs = cubes(page)
    assert len(cs) == 4
    assert len({c["color"] for c in cs}) > 1   # random colors (4 identical: ~0 odds)


def test_cube_spins_slowly_in_place(page: Page, live_server):
    enter_ar(page, live_server)
    press(page, "right", "trigger")
    before = cubes(page)[0]
    page.wait_for_timeout(1000)
    after = cubes(page)[0]
    turned = after["rotY"] - before["rotY"]
    assert 0.2 < turned < 1.5               # ~0.5 rad/s: visibly slow
    assert after["p"] == before["p"]        # in place


def test_camera_opens_inside_ar(page: Page, live_server):
    """Uses Chromium's fake camera; on the Quest this is the real question."""
    enter_ar(page, live_server)
    page.wait_for_function("window.__probe.status.camFps > 0", timeout=10000)
    assert not page.evaluate("window.__probe.status.cam").startswith("FAILED")


def test_android_overlay_box_does_not_swallow_scene_taps(page: Page, live_server):
    """Regression: cancelling beforexrselect on the fullscreen overlay root
    blocked every tap on Android. Only the bottom box may cancel."""
    page.goto(f"{live_server}/probe")
    root_cancels = page.evaluate("""() => {
        const e = new Event('beforexrselect', { cancelable: true, bubbles: true });
        document.getElementById('overlay').dispatchEvent(e);
        return e.defaultPrevented; }""")
    box_cancels = page.evaluate("""() => {
        const e = new Event('beforexrselect', { cancelable: true, bubbles: true });
        document.getElementById('ov-panel').dispatchEvent(e);
        return e.defaultPrevented; }""")
    assert (root_cancels, box_cancels) == (False, True)


def enter_ar_phone(page: Page, base: str):
    page.goto(f"{base}/probe?emulate=phone")
    page.click("#enter")
    page.wait_for_function("window.__probe.lines.some(l => l.startsWith('session:'))", timeout=10000)


def test_phone_requests_phone_features(page: Page, live_server):
    enter_ar_phone(page, live_server)
    assert page.evaluate("window.__xrDevice.userAgent ?? navigator.userAgent").find("Android") >= 0
    # The emulator can't grant camera-access/hit-test, but the app must not
    # take the Quest path (controllers, no hit-test) on a phone.
    assert not any("Quest Browser" in l for l in page.evaluate("window.__probe.lines"))


def test_phone_tap_spawns_cube_ahead_when_no_surface(page: Page, live_server):
    enter_ar_phone(page, live_server)
    page.evaluate("window.__tapScreen()")
    page.wait_for_function("window.__probe.cubes.length === 1", timeout=3000)
    [cube] = cubes(page)
    head = page.evaluate("[window.__xrDevice.position.x, window.__xrDevice.position.y, window.__xrDevice.position.z]")
    expected = [head[0], head[1], head[2] - 0.4]   # emulated phone faces -Z
    dist = sum((a - b) ** 2 for a, b in zip(cube["p"], expected)) ** 0.5
    assert dist < 0.05, (cube, expected)
    lines = page.evaluate("window.__probe.lines")
    assert "tap (screen)" in lines and any(l.startswith("cube #1 ") for l in lines)


def test_phone_taps_keep_adding_cubes(page: Page, live_server):
    enter_ar_phone(page, live_server)
    for _ in range(3):
        page.evaluate("window.__tapScreen()")
    page.wait_for_function("window.__probe.cubes.length === 3", timeout=3000)


def test_session_starts_even_if_hit_test_never_resolves(page: Page, live_server):
    """Regression: awaiting requestHitTestSource before wiring input/render
    meant a hung request left the phone with camera only: no taps, no panel."""
    page.add_init_script("""window.__emulateHooks = { onSession(s) {
        s.requestHitTestSource = () => new Promise(() => {});   // never resolves
    } };""")
    enter_ar_phone(page, live_server)
    page.wait_for_function("window.__probe.lines.includes('hit-test: requesting')", timeout=3000)
    page.evaluate("window.__tapScreen()")
    page.wait_for_function("window.__probe.cubes.length === 1", timeout=3000)
    page.wait_for_function("window.__probe.status.xrFps > 0", timeout=3000)


def telemetry_rows(directory):
    import json
    return [json.loads(l) for f in sorted(directory.glob("*.jsonl")) for l in f.read_text().splitlines()]


def wait_for_rows(directory, pred, timeout=8.0):
    import time
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = [r for r in telemetry_rows(directory) if pred(r)]
        if rows:
            return rows
        time.sleep(0.2)
    raise AssertionError("telemetry never arrived")


def test_page_errors_reach_the_server(page: Page, live_server, telemetry_dir):
    page.goto(f"{live_server}/probe")
    load = page.evaluate("window.__telemetry && true")
    assert load
    page.evaluate("setTimeout(() => { throw new Error('telemetry canary ' + 42) })")
    [row] = wait_for_rows(telemetry_dir, lambda r: "telemetry canary 42" in r["msg"])
    assert row["level"] == "error" and row["ver"].startswith("probe v")
    assert "telemetry canary" in row["data"]["stack"]


def test_probe_log_lines_reach_the_server(page: Page, live_server, telemetry_dir):
    enter_ar(page, live_server)
    page.evaluate("window.__telemetry.flush()")
    rows = wait_for_rows(telemetry_dir, lambda r: r["msg"].startswith("session: "))
    assert rows[-1]["page"] == "/probe?emulate=quest3"


def test_render_check_sees_drawn_pixels(page: Page, live_server):
    """The on-device render check must actually detect drawn content:
    the panel starts dead ahead, so the center pixel is opaque."""
    enter_ar_phone(page, live_server)
    page.evaluate("window.__tapScreen()")
    page.wait_for_function("window.__probe.lines.filter(l => l.startsWith('render check:')).length >= 2", timeout=8000)
    checks = [l for l in page.evaluate("window.__probe.lines") if l.startswith("render check:")]
    center = checks[-1].split("center ")[1].split(" ")[0]
    assert int(center.split(",")[3]) > 0, checks
    assert "cube#1 " in checks[-1] and "off-screen" not in checks[-1], checks


def test_phone_camera_access_path_keeps_drawing_visible(page: Page, live_server):
    """Regression (probe v5/v6 on Android): the camera-access GPU copy reset
    three's state, dropping the XR render target, so cubes/panel drew into
    the hidden page canvas. With emulated camera-access the copy runs every
    frame; drawn pixels must still reach the XR view."""
    enter_ar_phone(page, live_server)
    page.wait_for_function("window.__probe.lines.some(l => l.startsWith('WebXR camera-access 640x360'))", timeout=5000)
    page.evaluate("window.__tapScreen()")
    page.wait_for_function("window.__probe.lines.filter(l => l.startsWith('render check:')).length >= 2", timeout=8000)
    lines = page.evaluate("window.__probe.lines")
    assert not any("render target lost" in l for l in lines), lines
    check = [l for l in lines if l.startswith("render check:")][-1]
    cube_px = check.split("cube#1 ")[1].split(" ")[0]
    assert int(cube_px.split(",")[3]) > 0, check
    assert page.evaluate("window.__probe.status.camFps") > 0
