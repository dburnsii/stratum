"""Sky (apps/sky): the ceiling as a window. Its shape comes from the room map
or from pinched corners (play-area kit); themes are portal shaders, with
vines / bubbles in the room."""
from playwright.sync_api import Page

from test_apps_e2e import enable
from test_main import TAG_A, create_space, login, open_ar
from test_turntable import put

S = "window.__sky"


def start(page: Page, live_server, before=""):
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    login(page, live_server)
    enable(page, live_server, "sky")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.evaluate("window.__app.runtime.load()")
    if before:
        page.evaluate(before)
    oid = put(page, 0, -0.5, {"app": {"app": "sky", "config": {}}})
    page.wait_for_function(f"{S}?.ctx.sky", timeout=15000)
    return oid, errors


def corner_dirs(height=2.4, eye=1.6, pts=((-1.5, -2), (1.5, -2), (2, 1.5), (-1, 2))):
    return [[x, height - eye, z] for x, z in pts]


def test_without_a_map_you_pinch_the_ceiling_corners(page: Page, live_server):
    oid, errors = start(page, live_server)
    assert page.evaluate(f"!!{S}.ctx.sky.setup")                          # no ceiling known: setup
    assert page.evaluate(f"{S}.ctx.sky.setup.height") == 2.4
    for d in corner_dirs():
        assert page.evaluate(f"{S}.add([0, 1.6, 0], {d})")
    assert not page.evaluate(f"{S}.add([0, 1.6, 0], [-1.5, 0.8, -2])")    # the first corner again (closing the loop): not a corner
    assert page.evaluate(f"{S}.done()")
    c = page.evaluate(f"{S}.ctx.sky.cfg")
    assert c["from"] == "hand" and len(c["corners"]) == 4 and abs(c["height"] - 2.4) < 1e-6
    assert abs(c["corners"][0][0] + 1.5) < 0.01 and abs(c["corners"][0][1] + 2) < 0.01   # where the ray met the ceiling
    page.wait_for_function(f"window.__app.world.objects.get('{oid}').data.components.app.config.corners?.length === 4", timeout=5000)   # saved: shared
    assert page.evaluate(f"!!{S}.ctx.sky.mesh && !{S}.ctx.sky.setup")
    page.wait_for_timeout(300)
    assert not [e for e in errors if "Shader" in e or "WebGL" in e], errors


def test_a_crossing_outline_is_refused(page: Page, live_server):
    start(page, live_server)
    for d in corner_dirs(pts=((-1, -1), (1, 1), (1, -1))):
        page.evaluate(f"{S}.add([0, 1.6, 0], {d})")
    assert not page.evaluate(f"{S}.add([0, 1.6, 0], {corner_dirs(pts=((-1, 1),))[0]})")   # would cross (-1,-1)→(1,1)
    assert page.evaluate(f"{S}.ctx.sky.area.corners.length") == 3


MAP_CEILING = """window.__app.runtime.surfacesOf = () => [{ id: 'c1', kind: 'ceiling',
  polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], pose: { p: [0, 2.55, -0.5], q: [1, 0, 0, 0] } }];"""


def test_the_room_maps_ceiling_is_used(page: Page, live_server):
    start(page, live_server, before=MAP_CEILING)
    c = page.evaluate(f"{S}.ctx.sky.cfg")
    assert c["from"] == "map" and not page.evaluate(f"!!{S}.ctx.sky.setup")
    assert abs(c["height"] - 2.55) < 0.02, c["height"]
    xs = sorted(round(p[0], 1) for p in c["corners"])
    assert xs[0] == -2 and xs[-1] == 2


def test_every_theme_draws_and_adds_its_things(page: Page, live_server):
    _, errors = start(page, live_server, before=MAP_CEILING)
    for theme in page.evaluate(f"{S}.themes"):
        page.evaluate(f"window.__app.runtime.uiState().find(u => u.app.id === 'sky').panel.blocks.find(b => b.kind === 'choice').pick('{theme}')")   # (on its page: the theme choice)
        page.wait_for_function(f"{S}.ctx.sky.cfg.theme === '{theme}' && {S}.ctx.sky.mat", timeout=3000)
        parts = page.evaluate(f"{S}.ctx.sky.parts.map(p => p.name)")
        assert "sky" in parts and "walls" in parts and len(parts) >= 3, parts          # the opening, its cut edge, and real things up there
        assert page.evaluate(f"!!{S}.ctx.sky.skyTex?.texture")                         # the far sky, baked once
        f0 = page.evaluate("window.__app.frames()")
        page.wait_for_function(f"window.__app.frames() > {f0} + 3", timeout=5000)   # it compiled and rendered
        assert page.evaluate(f"{S}.ctx.sky.mat.uniforms.uTime.value") > 0
    assert not [e for e in errors if "Shader" in e or "WebGL" in e or "glsl" in e.lower()], errors[:3]
    # The jungle hangs vines into the room; the sea's bubbles rise.
    page.evaluate(f"{S}.setTheme('ocean')")
    page.wait_for_function(f"{S}.ctx.sky.extras", timeout=3000)
    y0 = page.evaluate("(() => { const m = new (window.__sky.ctx.THREE.Matrix4)(); const mesh = window.__sky.ctx.root.children.flatMap(c => [c, ...c.children]).find(o => o.isInstancedMesh); mesh.getMatrixAt(0, m); return m.elements[13]; })()")
    page.wait_for_timeout(400)
    y1 = page.evaluate("(() => { const m = new (window.__sky.ctx.THREE.Matrix4)(); const mesh = window.__sky.ctx.root.children.flatMap(c => [c, ...c.children]).find(o => o.isInstancedMesh); mesh.getMatrixAt(0, m); return m.elements[13]; })()")
    assert y1 != y0


def test_the_cursor_dot_shows_where_the_corner_would_go(page: Page, live_server):
    """Sky setting its ceiling: the dot is where the corner would go, on the ceiling's level."""
    start(page, live_server)
    assert page.evaluate(f"!!{S}.ctx.sky.setup")
    p = page.evaluate(f"""async () => {{ const THREE = await import('three'); const root = {S}.ctx.root ?? window.__app.runtime.running.get({S}.ctx.instance.id).root;
      const o = root.localToWorld(new THREE.Vector3(0, 1.6, 0)), d = root.localToWorld(new THREE.Vector3(1, 2.4, -1.5)).sub(o).normalize();
      const w = window.__app.runtime.aimPoint({{ origin: o, dir: d }}); return w && root.worldToLocal(w.clone()).toArray(); }}""")
    assert p and abs(p[1] - 2.4) < 0.01 and abs(p[0] - 1) < 0.01 and abs(p[2] + 1.5) < 0.01, p   # the corner's spot on the ceiling
    page.evaluate(f"{S}.ctx.sky.setup = null")                                    # not taking presses: no say
    assert page.evaluate(f"""async () => {{ const THREE = await import('three'); return window.__app.runtime.aimPoint({{ origin: new THREE.Vector3(0, 1.6, 0), dir: new THREE.Vector3(0, 1, 0) }}); }}""") is None


def test_setting_the_ceiling_lives_on_its_page_in_the_menu(page: Page, live_server):
    """No floating board out of reach: the controls are the app's page (ctx.panel), opened for you."""
    start(page, live_server)
    P = "window.__app.runtime.uiState().find(u => u.app.id === 'sky').panel"
    assert page.evaluate(f"{P}.title") == "Set the ceiling"
    page.wait_for_function("window.__app.sheetOpen()", timeout=3000)                # it brought the menu up (phone: the sheet) on its page
    step = f"{P}.blocks.find(b => b.kind === 'stepper')"
    assert page.evaluate(f"{step}.value") == "240 cm"
    page.evaluate(f"{step}.inc()")
    assert abs(page.evaluate(f"{S}.ctx.sky.setup.height") - 2.45) < 1e-6 and page.evaluate(f"{step}.value") == "245 cm"
    page.evaluate(f"{step}.dec()")
    btn = lambda label: f"{P}.blocks.find(b => b.kind === 'buttons').items.find(i => i.label === '{label}')"
    assert page.evaluate(f"{btn('Done')}.disabled") and page.evaluate(f"{btn('Undo')}.disabled")
    for d in corner_dirs():
        page.evaluate(f"{S}.add([0, 1.6, 0], {d})")
    assert not page.evaluate(f"{btn('Done')}.disabled")
    page.evaluate(f"{btn('Done')}.run()")
    page.wait_for_function(f"!{S}.ctx.sky.setup && {S}.ctx.sky.mesh", timeout=3000)
    assert page.evaluate(f"{P}.title") == "Sky"                                    # now: theme, brightness, set the ceiling
    assert [o["id"] for o in page.evaluate(f"{P}.blocks.find(b => b.kind === 'choice').options")] == page.evaluate(f"{S}.themes")

