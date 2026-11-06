"""Crash isolation (DESIGN.md §6.1): an app whose code or objects throw is
stopped and hidden; the frame loop, rendering, hit tests and other apps keep
going; it restarts later with backoff; the menu says it crashed."""
from playwright.sync_api import Page

from test_apps_e2e import enable
from test_main import TAG_A, create_space, login, open_ar
from test_turntable import put

RT = "window.__app.runtime"


def inst_of(app):
    return f"[...{RT}.running.values()].find(i => i.app.id === '{app}' && i.started)"


def start(page: Page, live_server):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    login(page, live_server)
    for a in ("notes", "towers"):
        enable(page, live_server, a)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.evaluate(f"{RT}.load()")
    put(page, 0.4, -0.6, {"app": {"app": "towers", "config": {}}})
    page.wait_for_function(f"{inst_of('towers')}", timeout=15000)
    put(page, -0.3, -0.5, {"app": {"app": "notes", "config": {"kind": "sticky", "text": "hi"}}})   # started last: the newest
    page.wait_for_function(f"{inst_of('notes')}", timeout=15000)
    return errors


def frames_continue(page):
    f0 = page.evaluate("window.__app.frames()")
    page.wait_for_function(f"window.__app.frames() > {f0} + 5", timeout=5000)


def test_an_object_that_breaks_hit_tests_stops_only_its_app(page: Page, live_server):
    errors = start(page, live_server)
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const m = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5));
      m.raycast = () => {{ throw new Error('bad raycast'); }}; {inst_of('notes')}.root.add(m); }}""")
    page.evaluate("window.__tapScreen({ pitchDeg: -20 })")                 # the tap hit-tests everything
    page.wait_for_function(f"{RT}.crashed.get('notes')?.where === 'hit test'", timeout=3000)
    assert not page.evaluate(f"!!{inst_of('notes')}")
    assert page.evaluate(f"!!{inst_of('towers')}")                          # the other app runs on
    frames_continue(page)
    assert not errors, errors


def test_a_render_that_throws_stops_the_newest_app_and_rendering_goes_on(page: Page, live_server):
    errors = start(page, live_server)
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
      m.frustumCulled = false; m.onBeforeRender = () => {{ throw new Error('bad render'); }}; {inst_of('notes')}.root.add(m); }}""")
    page.wait_for_function(f"{RT}.crashed.get('notes')?.where?.startsWith('render')", timeout=5000)
    assert page.evaluate(f"!!{inst_of('towers')}")
    frames_continue(page)
    assert not errors, errors


def test_repeated_errors_from_an_apps_callbacks_stop_it_then_it_restarts(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"""() => {{ for (let i = 0; i < 5; i++) {{ const e = new Error('timer blew up');
      e.stack = 'Error: timer blew up\\n    at tick (https://x/apps/notes/client/client.js:10:5)'; {RT}.looseError(e); }} }}""")
    page.wait_for_function(f"{RT}.crashed.get('notes')?.where === 'callback'", timeout=3000)
    assert page.evaluate(f"!!{inst_of('towers')}")
    page.wait_for_function(f"{inst_of('notes')} && !{RT}.crashed.has('notes')", timeout=8000)   # backoff 2 s, then back
