"""Gesture labelling mode (ui/labelpad.js): the core gestures stop acting and
a pad of big buttons floats low on your left; a press opens a 4 s window
recorded as a definite label in the hand recording (js/handrec.js)."""
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest

PAD = "window.__app.labelPad"

# A ray from 20 cm in front of a button straight at it, or a fingertip at its face (z: m in front of the pad).
BUTTON_AT = """async ([gesture, side, z]) => { const THREE = await import('three'); const pad = window.__app.labelPad;
  pad.group.updateMatrixWorld(true);
  const b = pad.buttons.find((b) => b.label.id === gesture && b.side === side);
  const local = new THREE.Vector3(b.x + b.w / 2, -(b.y + b.h / 2), z);
  return local.applyMatrix4(pad.mesh.matrixWorld).toArray(); }"""


def start(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function("window.__app.hands().tracked.left && window.__app.hands().tracked.right", timeout=5000)
    page.evaluate("window.__app.menu.setSetting('labelMode', true)")
    page.wait_for_function(f"{PAD}.visible && {PAD}.placed", timeout=5000)


def labels(page: Page):
    return page.evaluate("window.__app.handRec.events.filter((e) => e.kind === 'label').map((e) => [e.gesture, e.side, e.phase, e.how ?? null])")


def press_by_ray(page: Page, gesture, side):
    front, at = page.evaluate(BUTTON_AT, [gesture, side, 0.2]), page.evaluate(BUTTON_AT, [gesture, side, 0])
    return page.evaluate("""async ([a, b]) => { const THREE = await import('three');
      const o = new THREE.Vector3(...a), d = new THREE.Vector3(...b).sub(o).normalize();
      return window.__app.labelPad.pick({ origin: o, dir: d }); }""", [front, at])


def test_label_mode_shows_the_pad_low_on_the_left_and_turns_recording_on(page: Page, live_server):
    start(page, live_server)
    assert page.evaluate("window.__app.handRec.recording")
    pad, head = page.evaluate("[window.__app.labelPad.group.position.toArray(), window.__app.viewerPose().position.toArray()]")
    assert head[1] - pad[1] > 0.3                                        # well below the eyes
    assert pad[0] < head[0] - 0.15                                       # on the left (the emulated head looks down −z)
    assert page.evaluate("window.__app.menu.data().settings.labelMode") is True


def test_a_press_opens_a_4_s_window_recorded_as_a_label(page: Page, live_server):
    start(page, live_server)
    assert press_by_ray(page, "revelio", "right")
    assert labels(page) == [["revelio", "right", "start", None]]
    assert page.evaluate(f"{PAD}.active.label") == "revelio"
    page.evaluate(f"{PAD}.update({PAD}.active.until + 1, null)")        # (update without a viewer does nothing)
    page.evaluate(f"() => {{ const p = {PAD}; p.finish(p.active.until + 1); }}")
    assert labels(page)[-1] == ["revelio", "right", "end", "done"]
    assert page.evaluate(f"{PAD}.counts['revelio:right']") == 1         # counted on the button
    page.evaluate(f"{PAD}.lastPress = -1e9")
    press_by_ray(page, "shoo", "left")
    page.evaluate(f"{PAD}.lastPress = -1e9")
    press_by_ray(page, "shoo", "left")                                   # the same one again: cancelled, not counted
    assert labels(page)[-2:] == [["shoo", "left", "start", None], ["shoo", "left", "end", "cancelled"]]
    assert page.evaluate(f"{PAD}.active") is None and not page.evaluate(f"{PAD}.counts['shoo:left']")


def test_a_fingertip_poke_presses_a_button(page: Page, live_server):
    start(page, live_server)
    out, face = page.evaluate(BUTTON_AT, ["none", "left", 0.03]), page.evaluate(BUTTON_AT, ["none", "left", 0.0])
    page.evaluate(f"""async ([a, b]) => {{ const THREE = await import('three'); const pad = {PAD}, v = window.__app.viewerPose();
      pad.update(performance.now(), v, [{{ id: 'right', pos: new THREE.Vector3(...a) }}]);
      pad.update(performance.now(), v, [{{ id: 'right', pos: new THREE.Vector3(...b) }}]); }}""", [out, face])
    assert labels(page) == [["none", "left", "start", None]]


def test_gestures_only_log_what_they_saw_and_done_ends_the_mode(page: Page, live_server):
    start(page, live_server)
    page.evaluate("window.__app.quest().onGesture({ type: 'cast', side: 'right', cm: 20, ms: 300 }, performance.now())")
    assert page.evaluate("window.__app.revelio.active") is False         # nothing cast
    dets = page.evaluate("window.__app.handRec.events.filter((e) => e.kind === 'detector').map((e) => e.type)")
    assert dets == ["cast"]
    page.evaluate(f"{PAD}.press({PAD}.done)")
    assert page.evaluate(f"{PAD}.visible") is False and page.evaluate("localStorage.getItem('stratum.labelMode')") == "0"
