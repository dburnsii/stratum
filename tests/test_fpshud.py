"""FPS meter (ui/fpshud.js): a head-locked panel with the frame rate and a 10 s
graph stacked by app (in view: its own layer; out of view: one muted layer).
Settings → FPS meter turns it on, and it stays on."""
from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar
from test_map_e2e import open_settings_row
from test_roommap_e2e import look

HUD = "window.__app.fpsHud"
# The panel in the camera's frame (m): it should sit at its head-locked spot whichever way you look.
IN_CAMERA = f"""async () => {{ const THREE = await import('three'); const h = {HUD};
  const cam = window.__app.renderer.xr.getCamera(); cam.updateMatrixWorld();
  const p = h.mesh.getWorldPosition(new THREE.Vector3()).applyMatrix4(cam.matrixWorld.clone().invert());
  return [p.x, p.y, p.z].map(x => +x.toFixed(3)); }}"""
LAST_SECOND = f"""(() => {{ const s = {HUD}.series().slice(-10).filter(Boolean), sum = (f) => s.reduce((t, c) => t + f(c), 0) / s.length;
  return {{ cols: s.length, drawn: sum(c => c.draw.get("towers") ?? 0), towers: sum(c => c.apps.get("towers") ?? 0), out: sum(c => c.out), gap: sum(c => c.gap) }}; }})()"""


def test_fps_meter_follows_your_head_and_splits_the_frame_by_app(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "towers")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    assert not page.evaluate(f"{HUD}.visible")                                  # off unless chosen
    open_settings_row(page, "FPS meter")
    page.wait_for_function(f"{HUD}.visible")
    assert page.evaluate("localStorage.getItem('stratum.fpsHud')") == "1"
    page.click("#ov-fab")                                                         # (close the sheet)
    place_app(page, "towers")
    page.wait_for_function("window.__td?.ctx.td", timeout=15000)
    page.wait_for_function(f"{HUD}.series().length >= 25", timeout=8000)         # 100 ms columns filling
    r = page.evaluate(LAST_SECOND)
    assert r["towers"] > 0 and r["out"] == 0 and r["gap"] > 0, r                  # placed in front of you: its own layer
    assert page.evaluate(f"{HUD}.names.get('towers').icon")                       # (the legend has it)
    near = page.evaluate(IN_CAMERA)
    look(page, 0, 180)                                                            # turn around
    page.wait_for_timeout(1500)
    r = page.evaluate(LAST_SECOND)
    assert r["out"] > 0 and r["towers"] == 0, r                                   # behind you: the muted layer
    far = page.evaluate(IN_CAMERA)
    assert all(abs(a - b) < 0.01 for a, b in zip(near, far)), (near, far)        # head-locked
    assert near[2] < -0.2, near                                                   # in front of your eyes
    # Something is drawn on it.
    assert page.evaluate(f"(() => {{ const c = {HUD}.canvas, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n; }})()") > 10_000

    # Off, and remembered.
    open_settings_row(page, "FPS meter")
    page.wait_for_function(f"!{HUD}.visible")
    open_settings_row(page, "FPS meter")
    page.reload()
    page.wait_for_function("window.__app?.fpsHud", timeout=10000)
    assert page.evaluate(f"{HUD}.visible")
