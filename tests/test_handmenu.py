"""Quest hand menu: grows without stretching (new texture per size), shows
a cursor, can be carried, rotated and put down (and brought back), and sits
on the palm with tracked hands. Plus: re-entering AR with saved anchors
doesn't break the frame loop."""
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest, open_menu, press, aim, menu_button
from test_hands import CANDIDATES, set_left

MENU = "window.__app.questMenu()"


def header_point(page: Page):
    """World point on the menu's top bar (the grab area, between title and buttons)."""
    return page.evaluate(f"(() => {{ const m = {MENU}; return m.worldAt(0.02, m.height - 0.006).toArray(); }})()")


def test_menu_grows_with_content_and_shows_a_cursor(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    page.wait_for_timeout(300)
    h0 = page.evaluate(f"{MENU}.height")
    # Selecting something adds its card and tools: the panel grows (upward; the tab bar stays put).
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.3, 0.8, -0.8])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    c = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = window.__app.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")
    aim(page, "right", c)
    press(page, "right", "trigger")
    page.wait_for_function("window.__app?.selectedId", timeout=3000)
    page.wait_for_function(f"{MENU}.height > {h0} + 0.02 && {MENU}.find('Delete')", timeout=3000)
    # Every widget's texture matches its canvas (no stretched leftovers).
    assert page.evaluate(f"[...{MENU}.page.widgets.values()].every(w => w.tex.image === w.canvas && w.face.material.map === w.tex)")
    # Cursor: pointing at the menu shows the dot.
    aim(page, "right", header_point(page))
    page.wait_for_timeout(150)
    assert page.evaluate(f"{MENU}.cursor.visible")


def test_carry_rotate_put_down_and_back_to_hand(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    aim(page, "right", header_point(page))
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")   # hold
    page.wait_for_function(f"{MENU}.mode === 'held'", timeout=2000)
    start = page.evaluate(f"[{MENU}.group.matrix.elements[12], {MENU}.group.matrix.elements[14]]")
    page.evaluate("""() => { const c = window.__xrDevice.controllers.right; c.position.set(0.45, 1.3, -0.5);
      const q = c.quaternion; const s = Math.sin(0.4), co = Math.cos(0.4); q.set(0, s, 0, co); }""")   # move + turn
    page.wait_for_timeout(300)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function(f"{MENU}.mode === 'placed'", timeout=2000)
    placed = page.evaluate(f"[{MENU}.group.matrix.elements[12], {MENU}.group.matrix.elements[14]]")
    assert abs(placed[0] - start[0]) > 0.1, (start, placed)
    # Put down: moving the left hand no longer moves it; the palm gesture leaves it alone.
    page.evaluate("window.__xrDevice.controllers.left.position.set(-0.5, 1.0, -0.2)")
    page.wait_for_timeout(250)
    assert page.evaluate(f"[{MENU}.group.matrix.elements[12], {MENU}.group.matrix.elements[14]]") == placed
    # "Back to hand" (top bar) returns it to the hand.
    page.wait_for_function(f"{MENU}.find('Back to hand')", timeout=2000)
    page.wait_for_timeout(250)
    aim(page, "right", menu_button(page, "Back to hand"))
    press(page, "right", "trigger")
    page.wait_for_function(f"{MENU}.mode === 'hand'", timeout=2000)


def test_menu_sits_on_the_palm_and_turns_with_it(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function("window.__app?.hands().tracked.left", timeout=5000)
    page.evaluate("window.__xrDevice.hands.left.position.set(-0.15, 1.35, -0.3)")
    best = max((set_left(page, q), q) for q in CANDIDATES)
    set_left(page, best[1])
    page.wait_for_function(f"{MENU}.open", timeout=3000)
    page.wait_for_timeout(200)
    dot, lean = page.evaluate(f"""async () => {{ const THREE = await import('three'); const m = {MENU};
      const y = new THREE.Vector3(), z = new THREE.Vector3(); m.group.matrix.extractBasis(new THREE.Vector3(), y, z);
      const palm = window.__app.hands().hands.left.palm; return [z.dot(palm), y.dot(palm)]; }}""")
    assert 0.8 < dot < 0.92, dot                            # faces where the palm faces, tipped up ~30°
    assert 0.4 < lean < 0.6, lean                           # its top leans up off the palm (sin 30° = 0.5)


def test_reentering_ar_with_saved_anchors_keeps_running(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.2, 0.8, -0.8])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.anchors.size)", timeout=8000)
    page.evaluate("window.__xrSession.end()")
    page.wait_for_function("window.__app?.lines.includes('session ended')", timeout=5000)
    page.click("#enter")
    page.click("#enter", force=True)                         # a double tap must not start a second session
    page.wait_for_function("window.__app?.questMenu()", timeout=10000)
    page.wait_for_timeout(800)
    errors = page.evaluate("window.__app.lines.filter(l => l.startsWith('error'))")
    assert errors == [], errors


def test_index_finger_pokes_menu_buttons(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function("window.__app?.hands().tracked.left && window.__app?.hands().tracked.right", timeout=5000)
    page.evaluate("window.__xrDevice.hands.left.position.set(-0.15, 1.35, -0.3)")
    best = max((set_left(page, q), q) for q in CANDIDATES)
    set_left(page, best[1])                                   # palm up: menu on the left hand
    page.wait_for_function(f"{MENU}.open", timeout=3000)
    page.wait_for_timeout(200)

    page.evaluate(f"{MENU}.go('settings')")
    page.wait_for_function(f"{MENU}.find('Show hands')", timeout=3000)
    page.wait_for_timeout(300)

    def tip_to(offset_m):
        """Move the right hand so its index tip sits offset_m in front of the 'Show hands' row."""
        page.evaluate(f"""async () => {{ const THREE = await import('three'); const m = {MENU};
          const target = m.worldOf(m.find('Show hands'));
          const z = new THREE.Vector3(); m.group.matrix.extractBasis(new THREE.Vector3(), new THREE.Vector3(), z);
          target.addScaledVector(z, {offset_m} - 0.001);
          const tip = window.__app.hands().joint('right', 9);
          const h = window.__xrDevice.hands.right.position;
          h.set(h.x + target.x - tip.x, h.y + target.y - tip.y, h.z + target.z - tip.z); }}""")
        page.wait_for_timeout(120)

    tip_to(0.03)                                              # hovering 3 cm in front: nothing pressed yet
    tip_to(0.03)                                              # (again: the tip lands exactly after one frame)
    assert page.evaluate("localStorage.getItem('stratum.hands')") is None
    assert page.evaluate(f"{MENU}.find('Show hands').hover") == 1
    tip_to(-0.003)                                            # touch the panel: press
    page.wait_for_function("localStorage.getItem('stratum.hands') === '0'", timeout=2000)
    tip_to(-0.001)                                            # still touching: no repeat
    page.wait_for_timeout(150)
    assert page.evaluate("localStorage.getItem('stratum.hands')") == "0"
    tip_to(0.03)                                              # pull back, then press again: toggles back
    tip_to(-0.003)
    page.wait_for_function("localStorage.getItem('stratum.hands') === '1'", timeout=2000)


def test_navigate_tabs_and_change_an_app_setting(page: Page, live_server):
    login(page, live_server)
    page.request.put(f"{live_server}/api/apps/plants", data='{"enabled": true}', headers={"content-type": "application/json"})
    open_quest(page, live_server)
    open_menu(page)
    from test_quest import click_menu
    click_menu(page, "Apps")
    page.wait_for_function(f"{MENU}.nav.tab === 'apps' && {MENU}.find('app:plants')", timeout=3000)
    click_menu(page, "app:plants")
    page.wait_for_function(f"{MENU}.find('Time-lapse length')", timeout=3000)
    assert page.evaluate(f"{MENU}.find('Time-lapse length').props.value") == "6 s"
    click_menu(page, "Time-lapse length")                    # tap cycles the choice
    page.wait_for_function(f"{MENU}.find('Time-lapse length')?.props.value === '10 s'", timeout=3000)
    saved = page.request.get(f"{live_server}/api/apps").json()["apps"]
    assert next(a for a in saved if a["id"] == "plants")["settingsValues"] == {"lapse": 10}
    click_menu(page, "Back")                                  # one step back: the apps grid
    page.wait_for_function(f"{MENU}.find('app:plants') && !{MENU}.find('Time-lapse length')", timeout=3000)


def test_unused_headset_anchors_are_deleted_on_entering(page: Page, live_server):
    """The Quest Browser keeps 8 saved anchors per site: ones no Space uses
    (a deleted Space's) are cleaned up when AR starts, and in-use ones stay."""
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('cube')")
    aim(page, "right", [0.2, 0.8, -0.8])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && [...s.anchors.values()].some(a => a.handle))", timeout=8000)
    used = page.evaluate("[...window.__app.world.spaces.values()].flatMap(s => [...s.anchors.values()].map(a => a.handle)).filter(Boolean)")
    # A leftover saved anchor nobody uses (e.g. from a Space deleted on the server).
    page.evaluate("""async () => { const s = window.__xrSession; const ref = await s.requestReferenceSpace('local-floor');
      await new Promise((done) => s.requestAnimationFrame(async (t, f) => {
        const a = await f.createAnchor(new XRRigidTransform({ x: 1, y: 1, z: -1 }), ref); window.__stale = await a.requestPersistentHandle(); done(); })); }""")
    stale = page.evaluate("window.__stale")
    assert stale in page.evaluate("[...window.__xrSession.persistentAnchors]")
    page.evaluate("window.__xrSession.end()")
    page.wait_for_function("window.__app?.lines.includes('session ended')", timeout=5000)
    page.click("#enter")
    page.wait_for_function("window.__app?.questMenu() && window.__xrSession", timeout=10000)
    page.wait_for_function(f"![...window.__xrSession.persistentAnchors].includes('{stale}')", timeout=5000)
    left = page.evaluate("[...window.__xrSession.persistentAnchors]")
    assert set(used) <= set(left), (used, left)
