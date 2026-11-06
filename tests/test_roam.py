"""Roam past the boundary (Quest): an 'unbounded' reference space when the
headset grants it, else the usual local-floor; a Settings switch turns it off."""
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest, open_menu, press, aim


ROAM_ON = "if (!sessionStorage.getItem('seeded')) { localStorage.setItem('stratum.unbounded', '1'); sessionStorage.setItem('seeded', '1'); }"


def test_roaming_is_off_by_default(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    assert not page.evaluate("window.__app.roam.active")


def test_unbounded_space_when_granted_and_placing_still_works(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(ROAM_ON)
    open_quest(page, live_server)
    assert page.evaluate("window.__app.roam.active")
    assert page.evaluate("window.__app.menuData().settings.roamNote").startswith("On")
    # Everything still works in that space: arm a cube, trigger, it lands where aimed.
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.3, 0.9, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    pos = page.evaluate("""async () => { const THREE = await import('three');
      const e = [...window.__app.world.objects.values()][0]; e.built.root.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(e.built.root.matrixWorld).toArray(); }""")
    c = page.evaluate("[window.__xrDevice.controllers.right.position.x, window.__xrDevice.controllers.right.position.y, window.__xrDevice.controllers.right.position.z]")
    d = [p - q for p, q in zip(pos, c)]
    assert 0.4 < sum(x * x for x in d) ** 0.5 < 0.8, (pos, c)              # 60 cm along the ray, in the same frame


def test_switch_off_uses_the_boundary_space_next_time(page: Page, live_server):
    login(page, live_server)
    page.add_init_script("if (!sessionStorage.getItem('seeded')) { localStorage.setItem('stratum.unbounded', '0'); sessionStorage.setItem('seeded', '1'); }")
    open_quest(page, live_server)
    assert not page.evaluate("window.__app.roam.active")
    open_menu(page)
    page.evaluate("window.__app.questMenu().go('settings')")
    page.wait_for_function("window.__app?.questMenu().find('Roam past the boundary')", timeout=3000)
    assert page.evaluate("window.__app.questMenu().find('Roam past the boundary').props.toggle") is False
    page.evaluate("window.__app.questMenu().find('Roam past the boundary').run()")
    assert page.evaluate("localStorage.getItem('stratum.unbounded')") == "1"
    page.wait_for_function("window.__app?.menuData().settings.roamNote === 'Exit and re-enter AR to apply'", timeout=2000)


def test_an_unseen_saved_space_does_not_block_placing_forever(page: Page, live_server):
    """A saved Space whose anchor never shows up (another room) only holds
    placing for a few seconds."""
    login(page, live_server)
    open_quest(page, live_server)
    # The rule (world.locating) on a world of its own: one saved space whose anchor was restored but never tracked.
    # (On the live world the frame loop would update or clear a fake anchor between steps.)
    LOC = """(st) => { const w = window.__app.world, get = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(w), 'locating').get;
      const now = performance.now(), fake = { restoring: st.restoring, resolveStarted: now - st.started, resolvedAt: st.resolved == null ? 0 : now - st.resolved,
        spaces: new Map([['s', { anchors: new Map([['a', { xr: {}, tracked: false }]]) }]]) };
      return get.call(fake); }"""
    assert page.evaluate(LOC, {"restoring": 0, "started": 0, "resolved": 0})          # just restored, not seen yet: hold placing
    assert not page.evaluate(LOC, {"restoring": 0, "started": 0, "resolved": 7000})   # 7 s later, never seen: stop holding
    assert not page.evaluate(LOC, {"restoring": 1, "started": 11000, "resolved": None})   # a restore that hangs: 10 s max
    assert page.evaluate(LOC, {"restoring": 1, "started": 2000, "resolved": None})        # (one still going: hold)


def test_anchor_refused_still_places_and_turns_roaming_off(page: Page, live_server):
    """Quest Browser refused every anchor while roaming: the item still
    appears (temporary Space) and roaming is off for next time."""
    login(page, live_server)
    page.add_init_script(ROAM_ON)
    open_quest(page, live_server)
    assert page.evaluate("window.__app.roam.active")
    page.evaluate("""() => { const f = Object.getPrototypeOf(window.__xrSession).constructor;
      window.XRFrame.prototype.createAnchor = () => Promise.reject(new Error('Anchor creation failed.')); }""")
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.3, 0.9, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built)", timeout=8000)
    assert page.evaluate("[...window.__app.world.spaces.values()].some(s => s.temporary)")
    assert page.evaluate("localStorage.getItem('stratum.unbounded')") == "0"
    assert "Turned off" in page.evaluate("window.__app.menuData().settings.roamNote")
