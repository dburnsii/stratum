"""Quest virtual keyboard: fingertip typing (both hands, from the front only,
backspace repeat), controller ray + URL chips, live search in the menu, and
carrying it (it remembers where you put it)."""
import json

from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest, open_menu, press, aim, click_menu

KB = "window.__app.keyboard()"


def ask(page: Page, label: str, value: str = "", opts=None):
    page.evaluate(f"window.__answer = undefined; void window.__app.askText({json.dumps(label)}, {json.dumps(value)}, {json.dumps(opts or {})}).then((v) => {{ window.__answer = v; }})")
    page.wait_for_function(f"{KB}.open && {KB}.find('q')", timeout=3000)
    page.wait_for_timeout(350)   # opened and settled


def answer(page: Page):
    page.wait_for_function("window.__answer !== undefined", timeout=3000)
    return page.evaluate("window.__answer")


def key_point(page: Page, label: str, offset: float = 0.0):
    """World point offset meters in front of a key's face."""
    return page.evaluate(f"""(() => {{ const k = {KB}; const w = k.find({json.dumps(label)});
      return k.worldOf(w).addScaledVector(k.normal(), {offset}).toArray(); }})()""")


def tip_to(page: Page, label: str, offset: float, hand: str = "right"):
    """Move a tracked hand so its index tip sits offset meters in front of a key."""
    for _ in range(2):   # the tip lands exactly after one frame
        page.evaluate(f"""() => {{ const t = {json.dumps(key_point(page, label, offset))};
          const tip = window.__app.hands().joint('{hand}', 9); const h = window.__xrDevice.hands['{hand}'].position;
          h.set(h.x + t[0] - tip.x, h.y + t[1] - tip.y, h.z + t[2] - tip.z); }}""")
        page.wait_for_timeout(90)


def poke(page: Page, label: str, hand: str = "right"):
    tip_to(page, label, 0.03, hand)
    tip_to(page, label, -0.003, hand)
    if page.evaluate(f"{KB}.open"):
        tip_to(page, label, 0.03, hand)                               # pull back (re-arms)


def look_at_keyboard(page: Page):
    """Put the headset 30 cm straight in front of the keyboard (close-up screenshots)."""
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const k = {KB};
      const c = new THREE.Vector3().setFromMatrixPosition(k.group.matrix), n = k.normal();
      const eye = c.clone().addScaledVector(n, 0.3);
      const m = new THREE.Matrix4().lookAt(eye, c, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const d = window.__xrDevice; d.position.set(eye.x, eye.y, eye.z); d.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(300)


def hands(page: Page):
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function("window.__app?.hands().tracked.left && window.__app?.hands().tracked.right", timeout=5000)


def test_type_with_fingertips(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    hands(page)
    ask(page, "Note", opts={"capitalize": True})
    assert page.evaluate(f"{KB}.shift") == "once"                    # sentences start capitalized (opt-in)
    poke(page, "h")
    poke(page, "i", hand="left")                                      # either index finger types
    assert page.evaluate(f"{KB}.req.value") == "Hi"
    # Hover without touching: highlighted, nothing typed.
    tip_to(page, "o", 0.02)
    assert page.evaluate(f"{KB}.find('o').hover") == 1
    assert page.evaluate(f"{KB}.req.value") == "Hi"
    # From behind the keyboard: never presses.
    tip_to(page, "o", 0.2)                                            # away first
    tip_to(page, "o", -0.03)
    tip_to(page, "o", -0.003)
    assert page.evaluate(f"{KB}.req.value") == "Hi"
    # Backspace held: repeats.
    page.evaluate(f"{KB}.type(' there friend')")
    tip_to(page, "⌫", 0.03)
    tip_to(page, "⌫", -0.003)
    page.wait_for_timeout(900)
    tip_to(page, "⌫", 0.03)
    left = page.evaluate(f"{KB}.req.value")
    assert len(left) < len("Hi there friend") - 2, left
    page.screenshot(path="test-results/keyboard-hands.png")
    poke(page, "Done")
    assert answer(page) == left
    page.wait_for_function(f"!{KB}.group.visible", timeout=3000)


def test_controller_ray_and_url_chips(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    ask(page, "Go to")
    assert page.evaluate(f"{KB}.req.url") and page.evaluate(f"{KB}.shift") == "off"
    for label in ("e", "x", ".com"):
        aim(page, "right", key_point(page, label))
        press(page, "right", "trigger")
    assert page.evaluate(f"{KB}.req.value") == "ex.com"
    aim(page, "right", key_point(page, "123"))                      # symbols layer
    press(page, "right", "trigger")
    page.wait_for_function(f"{KB}.find('7')", timeout=2000)
    page.wait_for_timeout(250)
    aim(page, "right", key_point(page, "@"))
    press(page, "right", "trigger")
    look_at_keyboard(page)
    page.screenshot(path="test-results/keyboard-url.png")
    aim(page, "right", key_point(page, "Go"))
    press(page, "right", "trigger")
    assert answer(page) == "ex.com@"


def test_menu_search_filters_live(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Apps")
    page.wait_for_function("window.__app?.questMenu().find('app:browser') && window.__app?.questMenu().find('app:golf')", timeout=3000)
    click_menu(page, "Search")
    page.wait_for_function(f"{KB}.open", timeout=3000)
    page.evaluate(f"{KB}.type('plan')")                              # filters as you type
    page.wait_for_function("window.__app?.questMenu().find('app:plants') && !window.__app?.questMenu().find('app:golf')", timeout=3000)
    page.evaluate(f"{KB}.close(null)")                                # cancel: back to everything
    page.wait_for_function("window.__app?.questMenu().find('app:golf')", timeout=3000)


def test_carry_the_keyboard_and_it_remembers(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    ask(page, "Note")
    frame = page.evaluate(f"""(() => {{ const k = {KB};
      return k.worldOf({{ tx: 0, ty: -k.height / 2 + 0.004, tz: 0 }}).toArray(); }})()""")   # bottom edge: frame, not a key
    aim(page, "right", frame)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_function(f"{KB}.held", timeout=2000)
    before = page.evaluate(f"{KB}.group.matrix.elements[12]")
    page.evaluate("window.__xrDevice.controllers.right.position.set(0.35, 1.3, -0.3)")
    page.wait_for_timeout(250)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function(f"!{KB}.held", timeout=2000)
    after = page.evaluate(f"{KB}.group.matrix.elements[12]")
    assert after - before > 0.1, (before, after)
    assert page.evaluate(f"{KB}.req.value") == ""                    # moving it typed nothing
    assert page.evaluate("localStorage.getItem('stratum.keyboardPose')")
    page.evaluate(f"{KB}.close(null)")
    page.wait_for_function(f"!{KB}.group.visible", timeout=3000)
    ask(page, "Again")                                                # reopens where you left it
    page.wait_for_timeout(100)
    assert abs(page.evaluate(f"{KB}.group.matrix.elements[12]") - after) < 0.01
