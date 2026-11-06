"""Quest hand tracking (emulated): hands are drawn where the tracked joints
are, the left palm toward the face opens the menu (and turning it away
closes it), and the overlay can be hidden."""
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest

HANDS = "window.__app.hands()"

# Left-hand orientations to try (quaternion x, y, z, w): the emulated rest pose's
# palm direction isn't documented, so find one facing the head and one facing away.
CANDIDATES = [[0, 0, 0, 1], [0, 0, 1, 0], [0.7071, 0, 0, 0.7071], [-0.7071, 0, 0, 0.7071], [0, 0.7071, 0, 0.7071],
              [0, -0.7071, 0, 0.7071], [0, 0, 0.7071, 0.7071], [0, 0, -0.7071, 0.7071], [0, 1, 0, 0], [1, 0, 0, 0]]


def set_left(page: Page, q):
    page.evaluate(f"window.__xrDevice.hands.left.quaternion.set({q[0]}, {q[1]}, {q[2]}, {q[3]})")
    page.wait_for_timeout(120)
    return page.evaluate(f"{HANDS}.palmFacing('left')")


def test_hands_are_tracked_drawn_and_palm_up_opens_the_menu(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function(f"{HANDS}.tracked.left && {HANDS}.tracked.right", timeout=5000)
    page.evaluate("""() => { const d = window.__xrDevice;
      d.hands.left.position.set(-0.15, 1.35, -0.3); d.hands.right.position.set(0.15, 1.35, -0.3); }""")
    page.wait_for_timeout(200)
    # Drawn: the hand mesh (the dots stand in only until it loads), its wrist bone on the tracked wrist.
    page.wait_for_function(f"{HANDS}.hands.left.model && {HANDS}.hands.right.model", timeout=8000)
    near = page.evaluate(f"""async () => {{ const THREE = await import('three'); const h = {HANDS}.hands.left;
      const m = new THREE.Matrix4(); h.joints.getMatrixAt(0, m);
      const bone = h.bonesByJoint[0].getWorldPosition(new THREE.Vector3());
      return [h.model.visible, h.joints.visible, new THREE.Vector3().setFromMatrixPosition(m).distanceTo(new THREE.Vector3(-0.15, 1.35, -0.3)),
        bone.distanceTo(h.pos[0])]; }}""")
    assert near[0] and not near[1] and near[2] < 0.25 and near[3] < 0.002, near
    # Palm toward the face → menu opens; away → closes.
    facings = [(set_left(page, q), q) for q in CANDIDATES]
    toward = max(facings)
    away = min(facings)
    assert toward[0] > 0.6 and away[0] < 0, facings
    set_left(page, toward[1])
    page.wait_for_function("window.__app?.questMenu().open", timeout=3000)
    set_left(page, away[1])
    page.wait_for_function("!window.__app?.questMenu().open", timeout=3000)
    # Hanging down by your side (at a pinball machine): a palm that faces you doesn't open it.
    page.evaluate("window.__xrDevice.hands.left.position.set(-0.25, 0.85, -0.2)")
    page.wait_for_timeout(100)
    page.evaluate(f"window.__xrDevice.hands.left.quaternion.set({toward[1][0]}, {toward[1][1]}, {toward[1][2]}, {toward[1][3]})")
    page.wait_for_timeout(120)
    hang = max((set_left(page, q), q) for q in CANDIDATES)                # the palm as toward the face as it gets down there
    assert hang[0] > 0.6, hang
    page.wait_for_timeout(600)
    assert not page.evaluate("window.__app.questMenu().open")
    page.evaluate("window.__xrDevice.hands.left.position.set(-0.15, 1.35, -0.3)")   # raised again: it opens
    set_left(page, toward[1])
    page.wait_for_function("window.__app?.questMenu().open", timeout=3000)
    set_left(page, away[1])
    page.wait_for_function("!window.__app?.questMenu().open", timeout=3000)
    # Hide the overlay.
    page.evaluate("window.__app.questMenu().toggle(true); window.__app.questMenu().go('settings')")
    page.wait_for_function("window.__app?.questMenu().find('Show hands')", timeout=3000)
    page.evaluate("window.__app.questMenu().find('Show hands').run()")
    page.wait_for_timeout(150)
    assert not page.evaluate(f"{HANDS}.hands.left.joints.visible || {HANDS}.hands.left.model.visible")
    assert page.evaluate("localStorage.getItem('stratum.hands')") == "0"


def test_the_hand_mesh_is_sized_to_your_hand(page: Page, live_server):
    """Joints pin the bone positions; the bones are also scaled by your hand's
    length (wrist → middle tip) over the model's, so fingers are as thick as yours."""
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function(f"{HANDS}.hands.right.model && {HANDS}.tracked.right", timeout=8000)
    page.wait_for_timeout(1500)                                            # the size estimate settles
    r = page.evaluate(f"""(() => {{ const h = {HANDS}.hands.right; return {{ rest: h.rest, size: h.size, scale: h.scale, bone: h.bonesByJoint[11].scale.x }}; }})()""")
    assert 0.12 < r["rest"] < 0.26, r                                      # the model's hand, in meters
    assert 0.6 <= r["scale"] <= 1.5 and abs(r["scale"] - r["size"] / r["rest"]) < 0.02 and abs(r["bone"] - r["scale"]) < 1e-6, r


def test_hand_rays_come_from_the_hand_and_turn_with_it(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function(f"{HANDS}.tracked.right", timeout=5000)
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.2, -0.35)")
    page.wait_for_function("window.__app.aimRays().right?.hand", timeout=3000)
    page.wait_for_timeout(300)                                           # (smoothing settles)
    r = page.evaluate(f"""async () => {{ const THREE = await import('three'); const ray = window.__app.aimRays().right, h = {HANDS}.hands.right;
      const o = new THREE.Vector3(...ray.origin), d = new THREE.Vector3(...ray.dir);
      const centre = new THREE.Vector3().addVectors(h.pos[0], h.pos[11]).multiplyScalar(0.5);
      const along = new THREE.Vector3().subVectors(h.pos[11], h.pos[0]); along.addScaledVector(h.palm, -along.dot(h.palm)).normalize();
      const want = centre.clone().lerp(h.pos[6], 0.61).addScaledVector(h.palm, 0.043);   // the spot picked on /raytest
      return {{ fromSpot: o.distanceTo(want), fromPalm: o.distanceTo(centre), outOfPalm: d.dot(h.palm), towardFingers: d.dot(along) }}; }}""")
    assert r["fromSpot"] < 0.01 and r["fromPalm"] < 0.09, r               # starts just off the palm, toward the index knuckle
    assert 0.47 < r["outOfPalm"] < 0.62 and 0.78 < r["towardFingers"] < 0.9, r   # about 57° from the palm's normal (picked on /raytest)
    before = page.evaluate("window.__app.aimRays().right.dir")
    page.evaluate("window.__xrDevice.hands.right.quaternion.set(0.7071, 0, 0, 0.7071)")   # tip the hand fingers-up, not the head
    page.wait_for_timeout(500)
    after = page.evaluate("window.__app.aimRays().right.dir")
    assert sum(a * b for a, b in zip(before, after)) < 0.5, (before, after)   # the ray turned with it
