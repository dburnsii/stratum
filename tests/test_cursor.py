"""The cursor dot: the end of the pointing ray shows where a press would land
(a virtual thing it meets; an app's own point while it takes presses anywhere,
e.g. a play-area corner on its level)."""
from playwright.sync_api import Page

from test_main import login
from test_quest import aim, click_menu, open_menu, open_quest, press


def test_the_cursor_dot_sits_where_the_ray_meets_things(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    box = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = window.__app.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(r); return [b.min.toArray(), b.max.toArray(), b.getCenter(new THREE.Vector3()).toArray()]; }}""")
    aim(page, "right", box[2])
    page.wait_for_function("window.__app.cursor()", timeout=3000)
    c = page.evaluate("window.__app.cursor()")
    lo, hi = box[0], box[1]
    assert all(lo[i] - 0.01 <= c[i] <= hi[i] + 0.01 for i in range(3)), (c, box)   # on the cube's surface
    aim(page, "right", [3, 3.5, -0.5])                                            # at nothing (up, away)
    page.wait_for_function("!window.__app.cursor()", timeout=3000)
