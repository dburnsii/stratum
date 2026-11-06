"""Live typing: the Quest keyboard streams keys to an app (ctx.keyboard), a
browser pane brings it up when a text field gets focus (and drops it when
focus leaves), the hands-pointing-down gesture summons it, and the phone
streams edits from the system keyboard."""
import json

from playwright.sync_api import Page

from test_main import login, open_ar, create_space, TAG_A, wait_until
from test_quest import open_quest, press, aim
from test_apps_e2e import enable
from test_keyboard import KB, poke, hands

LOG_KEYS = "window.__keys = []; window.__closed = null;"
OPTS = "{ label: 'Terminal', onKey: (e) => window.__keys.push(e), onClose: (r) => { window.__closed = r; } }"


def keys(page: Page):
    return page.evaluate("window.__keys")


def test_quest_live_mode_streams_each_key(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    hands(page)
    page.evaluate(f"{LOG_KEYS} window.__kb = window.__app.openKeyboard({OPTS})")
    page.wait_for_function(f"{KB}.open && {KB}.find('q')", timeout=3000)
    page.wait_for_timeout(350)
    poke(page, "l")
    poke(page, "s")
    assert keys(page) == [{"text": "l"}, {"text": "s"}]                # each key right away, not at Done
    poke(page, "⌫")
    poke(page, "Enter")
    poke(page, "Tab")                                                 # chip row: Esc / Tab / arrows
    assert keys(page)[2:] == [{"key": "Backspace"}, {"key": "Enter"}, {"key": "Tab"}]
    assert page.evaluate(f"{KB}.open")                                # Enter doesn't close it
    page.evaluate("window.__kb.close()")                              # the app closes it
    page.wait_for_function("window.__closed === 'app'", timeout=2000)
    page.wait_for_function(f"!{KB}.group.visible", timeout=3000)


def set_hand(page: Page, side: str, pos, euler):
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const h = window.__xrDevice.hands['{side}'];
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...{json.dumps(euler)}));
      h.position.set(...{json.dumps(pos)}); h.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(60)


def point_down(page: Page, side: str, pos):
    """Rotate a hand so its index finger points as straight down as possible."""
    best = None
    for ax in range(-180, 180, 30):
        for az in (0, 1.57, -1.57, 3.14):
            e = [ax * 3.14159 / 180, 0, az]
            set_hand(page, side, pos, e)
            y = page.evaluate(f"window.__app.hands().indexDir('{side}').y")
            if best is None or y < best[0]:
                best = (y, e)
    set_hand(page, side, pos, best[1])
    return best[0]


def test_both_index_fingers_down_summons_the_keyboard(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    hands(page)
    page.wait_for_timeout(300)
    assert not page.evaluate(f"{KB}.open")
    assert point_down(page, "left", [-0.15, 1.25, -0.4]) < -0.8
    assert point_down(page, "right", [0.15, 1.25, -0.4]) < -0.8
    page.wait_for_function(f"{KB}.open", timeout=3000)                # held ~1.2 s
    assert page.evaluate(f"{KB}.req.live")
    assert "Nothing to type into" in page.evaluate(f"{KB}.req.label")  # no app touched yet
    # Hands hanging at your sides (pointing down, but not out in front): nothing.
    page.evaluate(f"{KB}.close(null)")
    page.wait_for_function(f"!{KB}.group.visible", timeout=3000)
    point_down(page, "left", [-0.25, 0.9, -0.02])
    point_down(page, "right", [0.25, 0.9, -0.02])
    page.wait_for_timeout(1800)
    assert not page.evaluate(f"{KB}.open")


def pane_point(page: Page, pid: str, v: float):
    """World point on the pane's screen, v from the bottom (0) to the top (1)."""
    return page.evaluate(f"""async () => {{ const THREE = await import('three');
      const s = window.__browser.get('{pid}').browser.screen; s.updateWorldMatrix(true, false);
      return s.localToWorld(new THREE.Vector3(0, (({v}) - 0.5) * s.geometry.parameters.height, 0)).toArray(); }}""")


def info(page: Page, pid: str):
    return page.evaluate(f"fetch('/apps/browser/api/panes/{pid}').then(r => r.json())")


def test_browser_field_focus_opens_live_keyboard_on_quest(page: Page, live_server, test_site):
    login(page, live_server)
    page.add_init_script("window.__browserLive = true")   # (the live Chrome, not the demo pictures)
    enable(page, live_server, "browser")
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('browser')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:browser')")
    aim(page, "right", [0.15, 1.0, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("window.__browser?.size === 1", timeout=15000)
    pid = page.evaluate("[...window.__browser.keys()][0]")
    page.evaluate(f"""fetch('/apps/browser/api/panes/{pid}/input', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{ type: 'goto', url: '{test_site}/form.html' }}) }})""")
    wait_until(page, f"fetch('/apps/browser/api/panes/{pid}').then(r => r.json()).then(i => i.title === 'Form')", timeout=10000)
    assert info(page, pid)["focus"] is None

    aim(page, "right", pane_point(page, pid, 0.8))                   # the search field (top half)
    press(page, "right", "trigger")
    page.wait_for_function(f"{KB}.open && {KB}.req.live", timeout=5000)
    assert page.evaluate(f"{KB}.req.label") == "Search the site"
    assert page.evaluate(f"{KB}.req.url")                             # search field: Go key + URL chips
    page.evaluate(f"{KB}.type('hi')")
    wait_until(page, f"fetch('/apps/browser/api/panes/{pid}').then(r => r.json()).then(i => i.title === 'Q:hi')", timeout=5000)
    page.evaluate(f"{KB}.input(['go', 1.5, 'go'])")                   # Enter: submits, the field loses focus…
    wait_until(page, f"fetch('/apps/browser/api/panes/{pid}').then(r => r.json()).then(i => i.title === 'Sent:hi')", timeout=5000)
    page.wait_for_function(f"!{KB}.open", timeout=5000)               # …and the keyboard goes away

    aim(page, "right", pane_point(page, pid, 0.2))                   # the plain part: no keyboard
    press(page, "right", "trigger")
    page.wait_for_timeout(800)
    assert not page.evaluate(f"{KB}.open")
    # The gesture now goes to this pane (last touched): a manual keyboard.
    assert page.evaluate(f"window.__app.runtime.summonKeyboard(null)")
    page.wait_for_function(f"{KB}.open && {KB}.req.label.startsWith('Typing into')", timeout=3000)


def test_phone_live_typing_streams_edits(page: Page, live_server):
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.evaluate(f"{LOG_KEYS} window.__kb = window.__app.openKeyboard({OPTS})")
    page.wait_for_selector("#ov-ask:not([hidden])")
    assert page.evaluate("document.activeElement.id") == "ov-ask-input"
    page.keyboard.type("ab")
    page.keyboard.press("Backspace")
    page.keyboard.press("Enter")
    page.click("#ov-ask-chips [data-key=Tab]")
    assert keys(page) == [{"text": "a"}, {"text": "b"}, {"key": "Backspace"}, {"key": "Enter"}, {"key": "Tab"}]
    assert page.evaluate("document.activeElement.id") == "ov-ask-input"   # chip kept the keyboard up
    page.click("#ov-ask-ok")                                              # Done
    page.wait_for_function("window.__closed === 'user'", timeout=2000)
    assert not page.is_visible("#ov-ask")
