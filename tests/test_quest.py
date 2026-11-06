"""Quest flow on an emulated Quest 3: hand menu on the left controller (Y),
right-hand ray presses buttons, trigger places only when armed, grip carries."""
import json
import math

from playwright.sync_api import Page

from test_main import login, objects_on_server


def open_quest(page: Page, base: str):
    page.goto(f"{base}/?emulate=quest3")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.questMenu()", timeout=10000)
    # Hands in front of the body, as when holding controllers.
    page.evaluate("""() => { const d = window.__xrDevice;
      d.controllers.left.position.set(-0.15, 1.3, -0.3); d.controllers.right.position.set(0.15, 1.3, -0.3); }""")
    page.wait_for_timeout(200)


def press(page: Page, hand: str, button: str, hold_ms=120):
    page.evaluate(f"window.__xrDevice.controllers['{hand}'].updateButtonValue('{button}', 1)")
    page.wait_for_timeout(hold_ms)
    page.evaluate(f"window.__xrDevice.controllers['{hand}'].updateButtonValue('{button}', 0)")
    page.wait_for_timeout(150)


def aim(page: Page, hand: str, at):
    page.evaluate(f"""async () => {{ const THREE = await import('three');
      const c = window.__xrDevice.controllers['{hand}'];
      const d = new THREE.Vector3(...{json.dumps(at)}).sub(new THREE.Vector3(c.position.x, c.position.y, c.position.z)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), d);
      c.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(120)


def menu_button(page: Page, label_start: str):
    """World position of a menu control whose label starts with label_start."""
    return page.evaluate(f"""(() => {{ const m = window.__app.questMenu(); const w = m.find({json.dumps(label_start)});
      return w ? m.worldOf(w).toArray() : null; }})()""")


def open_menu(page: Page):
    press(page, "left", "y-button")
    page.wait_for_function("window.__app?.questMenu().open", timeout=3000)
    page.wait_for_timeout(200)   # laid out + attached


def click_menu(page: Page, label_start: str):
    """Point the right controller at a menu control and pull the trigger."""
    page.wait_for_function(f"window.__app?.questMenu().find({json.dumps(label_start)})", timeout=3000)
    page.wait_for_timeout(250)   # let it settle (widgets glide into place)
    aim(page, "right", menu_button(page, label_start))
    press(page, "right", "trigger")


def test_y_toggles_menu_attached_to_left_hand(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    assert not page.evaluate("window.__app.questMenu().open")
    open_menu(page)
    pos = page.evaluate("(() => { const m = window.__app.questMenu(); m.group.updateMatrixWorld(true); return [m.group.matrixWorld.elements[12], m.group.matrixWorld.elements[13], m.group.matrixWorld.elements[14]]; })()")
    left = page.evaluate("(() => { const c = window.__xrDevice.controllers.left.position; return [c.x, c.y, c.z]; })()")
    assert math.dist(pos, left) < 0.35, (pos, left)
    page.evaluate("window.__xrDevice.controllers.left.position.x -= 0.2")    # it follows the hand
    page.wait_for_timeout(250)
    pos2 = page.evaluate("(() => { const m = window.__app.questMenu(); return m.group.matrixWorld.elements[12]; })()")
    assert pos2 < pos[0] - 0.15
    press(page, "left", "y-button")
    page.wait_for_function("!window.__app?.questMenu().open", timeout=3000)


def test_menu_arms_trigger_places_once_and_never_otherwise(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")                        # unarmed, empty space
    page.wait_for_timeout(300)
    assert page.evaluate("window.__app.world.objects.size") == 0
    open_menu(page)
    click_menu(page, "Cube")
    page.wait_for_function("window.__app?.armed === 'cube'", timeout=3000)
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("window.__app?.world.objects.size === 1", timeout=8000)
    assert page.evaluate("window.__app.armed") is None
    press(page, "right", "trigger")                        # disarmed: nothing new
    page.wait_for_timeout(400)
    assert page.evaluate("window.__app.world.objects.size") == 1


def test_select_then_delete_from_menu(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    center = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = window.__app.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")
    aim(page, "right", center)
    press(page, "right", "trigger")
    page.wait_for_function(f"window.__app?.selectedId === '{oid}'", timeout=3000)
    click_menu(page, "Delete")
    page.wait_for_function("window.__app?.world.objects.size === 0", timeout=3000)


def test_grip_carries_object(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    before = page.evaluate(f"window.__app.world.objects.get('{oid}').data.pose.p")
    center = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = window.__app.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")
    aim(page, "right", center)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('squeeze', 1)")
    page.wait_for_timeout(200)
    page.evaluate("window.__xrDevice.controllers.right.position.x += 0.25")   # carry it right
    page.wait_for_timeout(300)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('squeeze', 0)")
    page.wait_for_timeout(800)
    after = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]["p"]
    assert abs((after[0] - before[0]) - 0.25) < 0.04, (before, after)


def test_reticle_is_a_small_blue_dot(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    r = page.evaluate("""async () => {
      const scene = window.__app.world.scene;
      const dot = scene.children.find(o => o.userData.isReticle);
      return { color: dot.material.color.getHex(), type: dot.geometry.type, radius: dot.geometry.parameters.radius };
    }""")
    assert r == {"color": 0x3D9BFF, "type": "CircleGeometry", "radius": 0.007}


def _placed_cube(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    before = page.evaluate(f"window.__app.world.objects.get('{oid}').data.pose.p")
    center = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = window.__app.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")
    return oid, before, center


OUTLINE = "window.__app.moveBox.state === 'drag'"


def _hold_and_carry(page: Page, outline=None):
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(250)
    if outline is not None:
        outline.append(page.evaluate(OUTLINE))                         # pinched, not picked up yet: no outline
        page.wait_for_timeout(200)
        outline.append(page.evaluate("window.__app.moveBox.state"))   # still under the delay: nothing
        page.wait_for_timeout(200)
        outline.append(page.evaluate("[window.__app.moveBox.state, window.__app.moveBox.progress > 0]"))   # the hold box fills
    page.wait_for_timeout(1400 if outline is None else 1050)                                       # held still: picked up (hands have no grip)
    if outline is not None:
        outline.append(page.evaluate(OUTLINE))                         # moving: outline
    page.evaluate("window.__xrDevice.controllers.right.position.x += 0.25")
    page.wait_for_timeout(300)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_timeout(800)


def test_pinch_held_still_carries_object(page: Page, live_server):
    oid, before, center = _placed_cube(page, live_server)
    aim(page, "right", center)
    outline = []
    _hold_and_carry(page, outline)
    outline.append(page.evaluate(OUTLINE))                             # put down: gone
    assert outline == [False, None, ["hold", True], True, False], outline
    after = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]["p"]
    assert abs((after[0] - before[0]) - 0.25) < 0.04, (before, after)


def test_app_can_veto_the_default_move(page: Page, live_server):
    """Like preventDefault: an app's grab(ctx, e) keeps the gesture."""
    oid, before, center = _placed_cube(page, live_server)
    page.evaluate("window.__app.runtime.mayMove = () => false")
    aim(page, "right", center)
    _hold_and_carry(page)
    after = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]["p"]
    assert math.dist(after, before) < 0.01, (before, after)
    r = page.evaluate("""async () => { const THREE = await import('three');
      const rt = window.__app.runtime; delete rt.mayMove;
      const seen = [];
      const inst = { started: true, app: { id: 't' }, ctx: { toLocal: (v) => v },
        module: { grab: (ctx, e) => { seen.push([e.how, e.handle]); if (!e.handle) e.preventDefault(); } } };
      rt.running.set('fake', inst);
      const g = new THREE.Group(); g.userData.appInstance = 'fake';
      const page = new THREE.Mesh(); const pole = new THREE.Mesh(); pole.userData.handle = true; g.add(page, pole);
      const p = new THREE.Vector3();
      const out = { page: rt.mayMove({ object: page, point: p }, 'hold', 'hand'), pole: rt.mayMove({ object: pole, point: p }, 'hold', 'hand'), seen };
      rt.running.delete('fake'); return out; }""")
    assert r == {"page": False, "pole": True, "seen": [["hold", False], ["hold", True]]}, r


def test_pick_up_from_tools_follows_the_pointer_until_pinch(page: Page, live_server):
    oid, before, center = _placed_cube(page, live_server)
    page.evaluate(f"window.__app.runtime.carry('{oid}')")
    page.evaluate("window.__xrDevice.controllers.right.quaternion.set(0, -0.0998, 0, 0.995)")   # turn the ray ~11.5° right
    page.wait_for_timeout(400)
    press(page, "right", "trigger")                                    # put it down
    page.wait_for_timeout(800)
    after = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]["p"]
    assert math.dist(after, before) > 0.1, (before, after)


def test_second_hand_joins_to_scale_and_turn(page: Page, live_server):
    """Grab with one hand, pinch with the other: apart = bigger, around = turned."""
    oid, before, center = _placed_cube(page, live_server)
    q0 = page.evaluate(f"window.__app.world.objects.get('{oid}').data.pose.q")
    aim(page, "right", center)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('squeeze', 1)")   # grip: moving now
    page.wait_for_timeout(200)
    page.evaluate("window.__xrDevice.controllers.left.updateButtonValue('trigger', 1)")    # the other hand joins
    page.wait_for_timeout(150)
    assert page.evaluate("window.__app.moveBox.state") == "two"
    # Left hand from 0.3 m beside the right to 0.6 m in front of it: twice as far, a quarter turn.
    page.evaluate("const c = window.__xrDevice.controllers.left; c.position.set(0.15, 1.3, -0.9)")
    page.wait_for_timeout(300)
    page.evaluate("window.__xrDevice.controllers.left.updateButtonValue('trigger', 0)")    # back to one hand
    page.wait_for_timeout(200)
    assert page.evaluate("window.__app.moveBox.state") == "drag"
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('squeeze', 0)")
    page.wait_for_timeout(800)
    pose = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]
    assert all(abs(v - 2) < 0.15 for v in pose["s"]), pose
    turn = page.evaluate(f"""async () => {{ const THREE = await import('three');
      const a = new THREE.Quaternion(...{q0}), b = new THREE.Quaternion(...{json.dumps(pose['q'])});
      return THREE.MathUtils.radToDeg(a.angleTo(b)); }}""")
    assert abs(turn - 90) < 12, turn


def test_letting_go_before_the_box_closes_cancels(page: Page, live_server):
    oid, before, center = _placed_cube(page, live_server)
    aim(page, "right", center)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(1000)
    assert page.evaluate("window.__app.moveBox.state") == "hold"
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")    # changed my mind
    page.wait_for_timeout(500)
    assert page.evaluate("window.__app.moveBox.state") is None and not page.evaluate("window.__app.touch.drag")


def test_apps_set_their_own_move_timing(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    r = page.evaluate("""() => { const rt = window.__app.runtime;
      const node = { userData: {}, parent: null }, inst = { started: true, app: { id: 't' }, ctx: {}, module: {} };
      rt.ownerOf = () => ({ inst, handle: false });
      const d = rt.moveTiming({ object: node }, 'hand');
      inst.module.moveTiming = { delay: 0, duration: 200 };
      const quick = rt.moveTiming({ object: node }, 'hand');
      inst.module.moveTiming = (ctx, e) => ({ delay: e.source === 'hand' ? 9999 : 100 });
      const fn = rt.moveTiming({ object: node }, 'hand');
      delete rt.ownerOf;
      return { d, quick, fn }; }""")
    assert r == {"d": {"delay": 500, "duration": 800}, "quick": {"delay": 0, "duration": 200}, "fn": {"delay": 3000, "duration": 800}}, r


def test_gestures_tab_lists_how_to_and_opens_details(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Gestures")
    page.wait_for_function("window.__app.questMenu().find('Open this menu')", timeout=3000)
    assert not page.evaluate("window.__app.questMenu().find('In apps')")   # no apps on: no app gestures
    page.evaluate("window.__app.runtime.setEnabled('racing', true)")       # their help comes from the manifest
    page.wait_for_function("window.__app.questMenu().find('In apps')", timeout=3000)
    for topic, first in (("Hidden", "Revelio"), ("In apps", "Mini Cars"), ("Move", "Pick something up")):
        click_menu(page, topic)
        page.wait_for_function(f"window.__app.questMenu().find({json.dumps(first)})", timeout=3000)
    click_menu(page, "Pick something up")
    page.wait_for_function("window.__app.questMenu().nav.stack.at(-1).page === 'gesture'", timeout=3000)
    assert page.evaluate("window.__app.questMenu().nav.stack.at(-1).params.more").startswith("After half a second")
