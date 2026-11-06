"""Terminal scrollback + copy/paste, the Stratum clipboard, and the Quest
scroll inputs: trigger drag on content and the two-finger hand scroll."""
import json
import time

from playwright.sync_api import Page

from test_main import login, wait_until
from test_quest import open_quest, aim
from test_apps_e2e import enable
from test_ssh import api, wait_screen, authorize, sshd  # noqa: F401 (fixture)
from test_keyboard import KB, hands

TERM = "window.__ssh.get(window.__pid).term"


def test_clipboard_is_per_user_and_bounded(page: Page, live_server, browser):
    login(page, live_server)
    assert page.request.get(f"{live_server}/api/clipboard").json()["text"] == ""
    r = page.request.put(f"{live_server}/api/clipboard", data=json.dumps({"text": "hello"}), headers={"content-type": "application/json"})
    assert r.ok and r.json()["at"] > 0
    assert page.request.get(f"{live_server}/api/clipboard").json()["text"] == "hello"
    big = page.request.put(f"{live_server}/api/clipboard", data=json.dumps({"text": "x" * 70000}), headers={"content-type": "application/json"})
    assert big.status == 400
    other = browser.new_page()
    login(other, live_server)
    assert other.request.get(f"{live_server}/api/clipboard").json()["text"] == ""      # someone else's is empty
    other.close()


def test_scrollback_and_selected_text_api(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    assert api(page, live_server, "POST", "/panes/s1/connect", {"target": f"tester@{host}"})["state"] == "connected"
    api(page, live_server, "POST", "/panes/s1/input", {"text": "seq 60\r"})
    s, _ = wait_screen(page, live_server, "s1", "\n60\n")
    assert s["maxScroll"] >= 37 and s["scroll"] == 0
    back = api(page, live_server, "GET", "/panes/s1/screen?after=-1&scroll=30")
    assert back["scroll"] == 30 and back["top"] == s["top"] - 30 and back["cursor"] is None
    rows = ["".join(r[0] for r in line) for line in back["lines"]]
    first = int(next(x for x in rows if x.strip().isdigit()))
    assert first < 30, rows                                                            # older lines are showing
    clamp = api(page, live_server, "GET", "/panes/s1/screen?after=-1&scroll=99999")
    assert clamp["scroll"] == clamp["maxScroll"]
    # Text of a range: absolute lines (stable while scrolled).
    n = back["top"] + rows.index(str(first))
    got = api(page, live_server, "GET", f"/panes/s1/text?from={n}:0&to={n + 2}:9")["text"]
    assert got == f"{first}\n{first + 1}\n{first + 2}"
    # Paste: newlines become Enter.
    api(page, live_server, "POST", "/panes/s1/input", {"paste": "echo pasted\n"})
    wait_screen(page, live_server, "s1", "\npasted")


def open_terminal(page: Page, live_server, host):
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('ssh')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:ssh')")
    aim(page, "right", [0.0, 1.0, -0.9])
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(120)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function("window.__ssh?.size === 1 && [...window.__ssh.values()][0].term.snap", timeout=10000)
    page.evaluate("window.__pid = [...window.__ssh.keys()][0]")
    pid = page.evaluate("window.__pid")
    page.evaluate(f"""fetch('/apps/ssh/api/panes/{pid}/connect', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{ target: 'tester@{host}' }}) }})""")
    page.wait_for_function(f"{TERM}.info.state === 'connected'", timeout=8000)
    page.evaluate(f"""fetch('/apps/ssh/api/panes/{pid}/input', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{ text: 'seq 80\\r' }}) }})""")
    page.wait_for_function(f"{TERM}.maxScroll > 50", timeout=8000)
    return pid


def screen_point(page: Page, u: float, v: float):
    """World point on the terminal screen at uv (0..1, v up)."""
    return page.evaluate(f"""async () => {{ const THREE = await import('three'); const s = {TERM}.screen; s.updateWorldMatrix(true, false);
      const p = s.geometry.parameters; return s.localToWorld(new THREE.Vector3(({u} - 0.5) * p.width, ({v} - 0.5) * p.height, 0)).toArray(); }}""")


def action(page: Page, label: str):
    page.evaluate(f"window.__app.runtime.uiState().find(u => u.instance === window.__pid).actions.find(a => a.label.includes({json.dumps(label)})).run()")


def test_trigger_drag_scrolls_and_copy_paste_on_quest(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    open_terminal(page, live_server, host)
    # Trigger held on the screen, ray moved down: the view scrolls back; no click (no keyboard).
    aim(page, "right", screen_point(page, 0.5, 0.6))
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(100)
    for v in (0.5, 0.4, 0.3, 0.2):
        aim(page, "right", screen_point(page, 0.5, v))
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function(f"{TERM}.scroll > 5", timeout=3000)
    page.wait_for_timeout(300)
    assert not page.evaluate(f"{KB}.open")
    assert page.evaluate(f"{TERM}.snap.scroll") == page.evaluate(f"{TERM}.scroll")      # the server sent that view
    page.screenshot(path="test-results/ssh-scrolled.png")
    # Select a line by tapping it, Copy: it's on the Stratum clipboard.
    action(page, "Select")
    rows = page.evaluate(f"{TERM}.snap.lines.map(l => l.map(r => r[0]).join(''))")
    row = next(i for i, x in enumerate(rows) if x.strip().isdigit())
    v = 1 - (row + 0.5) / len(rows)
    aim(page, "right", screen_point(page, 0.05, v))
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(100)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function(f"{TERM}.sel?.a", timeout=2000)
    action(page, "Copy")
    wait_until(page, f"fetch('/api/clipboard').then(r => r.json()).then(c => c.text === {json.dumps(rows[row].strip())})", timeout=3000)
    # Paste from the clipboard (made on "another device"): typed in, view back at the bottom.
    page.request.put(f"{live_server}/api/clipboard", data=json.dumps({"text": "echo from-phone"}), headers={"content-type": "application/json"})
    action(page, "Paste")
    page.wait_for_function(f"{TERM}.scroll === 0 && {TERM}.snap.lines.some(l => l.map(r => r[0]).join('').includes('echo from-phone'))", timeout=4000)


def make_two_finger_pose(page: Page, side: str):
    """IWER has point/pinch poses; build index + middle out from 'point'."""
    page.evaluate(f"""async () => {{ const m = await import('/vendor/iwer/iwer.module.js'); const hand = window.__xrDevice.hands['{side}'];
      const poses = hand[m.P_HAND_INPUT].poses; const src = poses.point.jointTransforms;
      const jt = JSON.parse(JSON.stringify(src));
      const parts = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
      const off = [0, 1, 2].map((i) => src['middle-finger-metacarpal'].offsetMatrix[12 + i] - src['index-finger-metacarpal'].offsetMatrix[12 + i]);
      for (const p of parts) {{
        const mtx = [...src['index-finger-' + p].offsetMatrix];
        for (let i = 0; i < 3; i++) mtx[12 + i] += off[i];
        jt['middle-finger-' + p] = {{ ...jt['middle-finger-' + p], offsetMatrix: mtx }};
      }}
      poses.two = {{ ...poses.point, jointTransforms: jt }};
      hand.poseId = 'two'; }}""")


def test_two_finger_hand_scroll(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    open_terminal(page, live_server, host)
    page.evaluate(f"window.__app.runtime.touched = window.__app.runtime.running.get(window.__pid)")   # as if just tapped
    hands(page)
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.3, -0.35)")
    page.wait_for_timeout(200)
    assert not page.evaluate("window.__app.hands().twoFingers('right')")
    make_two_finger_pose(page, "right")
    page.wait_for_function("window.__app?.hands().twoFingers('right')", timeout=2000)
    page.wait_for_timeout(300)                                                          # held: scroll mode on
    for i in range(1, 7):                                                               # hand moves down 12 cm
        page.evaluate(f"window.__xrDevice.hands.right.position.set(0.15, {1.3 - 0.02 * i}, -0.35)")
        page.wait_for_timeout(60)
    page.wait_for_function(f"{TERM}.scroll > 8", timeout=3000)
    page.evaluate("window.__xrDevice.hands.right.poseId = 'default'")                   # let go
    page.wait_for_timeout(400)
    s = page.evaluate(f"{TERM}.scroll")
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.5, -0.35)")       # open hand moving: nothing
    page.wait_for_timeout(300)
    assert page.evaluate(f"{TERM}.scroll") == s
