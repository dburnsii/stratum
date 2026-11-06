"""Optional occlusion on an emulated phone with fake CPU depth sensing
(window.__fakeDepth meters everywhere). Checks the pixels actually drawn."""
import json

from playwright.sync_api import Page

from test_main import login, place


def open_phone(page: Page, base: str, occlusion: bool, depth: float):
    page.add_init_script(f"localStorage.setItem('stratum.occlusion', '{'1' if occlusion else '0'}'); window.__fakeDepth = {depth};"
                         "window.__fakeCamera = { tags: [] };")
    page.goto(f"{base}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__xrSession && window.__app?.tracker", timeout=10000)


def cube_pixel(page: Page):
    """Place a cube 0.4 m ahead (front face at 0.35 m) and read its pixel."""
    if page.evaluate("window.__app.world.objects.size") == 0:
        place(page)
        page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built)", timeout=5000)
        page.wait_for_timeout(200)
    c = page.evaluate("""async () => { const THREE = await import('three');
      const r = [...window.__app.world.objects.values()][0].built.root; r.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }""")
    return page.evaluate(f"window.__app.samplePixel({json.dumps(c)})")


def test_off_by_default_requests_no_depth(page: Page, live_server):
    """Occlusion off (default) and room mapping off: no depth asked for.
    (Mapping, on by default, asks for depth itself: tests/test_map_e2e.py.)"""
    login(page, live_server)
    page.add_init_script("localStorage.setItem('stratum.mapOn', '0')")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__xrSession", timeout=10000)
    assert "depth-sensing" not in page.evaluate("window.__xrSession.enabledFeatures")
    assert not page.evaluate("document.getElementById('occlusion').checked")
    assert cube_pixel(page)[3] == 255                              # visible


def test_real_surface_in_front_hides_the_cube(page: Page, live_server):
    login(page, live_server)
    open_phone(page, live_server, occlusion=True, depth=0.3)       # a "wall" 30 cm away
    assert "depth-sensing" in page.evaluate("window.__xrSession.enabledFeatures")
    assert any(l.startswith("occlusion: cpu-optimized") for l in page.evaluate("window.__app.lines"))
    assert cube_pixel(page)[3] == 0                                # hidden behind it
    page.evaluate("window.__fakeDepth = 0.6")                      # the real thing is now behind the cube
    page.wait_for_timeout(100)
    assert cube_pixel(page)[3] == 255
    page.evaluate("window.__fakeDepth = 0.3")
    page.wait_for_timeout(100)
    assert cube_pixel(page)[3] == 0
    page.evaluate("""() => { document.getElementById('ov-fab').click();               // ◐ switch in Settings: occlusion off, live
      document.querySelector('#ov-sheet [data-tab=settings]').click();
      document.querySelector('#ov-sheet [data-row=occlusion]').click(); }""")
    page.wait_for_timeout(100)
    assert cube_pixel(page)[3] == 255
    assert page.evaluate("localStorage.getItem('stratum.occlusion')") == "0"


def test_unknown_depth_occludes_nothing(page: Page, live_server):
    login(page, live_server)
    open_phone(page, live_server, occlusion=True, depth=0)
    assert cube_pixel(page)[3] == 255


def test_quest_builtin_depth_mesh_only_when_enabled(page: Page, live_server):
    """Quest uses three's own depth mesh; it must stay off unless enabled."""
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.occlusion", timeout=10000)
    off = page.evaluate("""() => { const o = window.__app.occlusion; o.useBuiltin = true; o.enabled = false;
        return o.renderer.xr.getDepthSensingMesh() === null; }""")
    assert off
