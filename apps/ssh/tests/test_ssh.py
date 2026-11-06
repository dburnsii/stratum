"""SSH terminal app: through Stratum's proxy to the ssh backend to a fake
SSH server (tests/fake_sshd.py). Key auth with the per-user key, password
fallback, keys and escape sequences, screen colors; then on an emulated
Quest: connect from the title bar and type with the live keyboard."""
import json
import time

import pytest
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest, press, aim
from test_apps_e2e import enable
from test_keyboard import KB, look_at_keyboard


@pytest.fixture
def sshd(app_backends):
    return app_backends["sshd"], app_backends["authorized"]


def api(page: Page, base: str, method: str, path: str, body=None):
    r = page.request.fetch(f"{base}/apps/ssh/api{path}", method=method,
                           data=json.dumps(body) if body is not None else None,
                           headers={"content-type": "application/json"} if body is not None else {})
    assert r.ok, (path, r.status, r.text())
    return r.json() if r.status != 204 else None


def screen_text(page: Page, base: str, pid: str):
    s = api(page, base, "GET", f"/panes/{pid}/screen?after=-1")
    return s, "\n".join("".join(run[0] for run in line) for line in s["lines"])


def wait_screen(page: Page, base: str, pid: str, needle: str, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        s, text = screen_text(page, base, pid)
        if needle in text:
            return s, text
        time.sleep(0.1)
    raise AssertionError(f"{needle!r} never showed up:\n{text}")


def authorize(page: Page, base: str, authorized):
    key = api(page, base, "GET", "/key")["publicKey"]
    assert key.startswith("ssh-ed25519 ")
    with open(authorized, "a") as f:
        f.write(key + "\n")
    return key


def test_key_auth_typing_keys_and_colors(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    key = authorize(page, live_server, authorized)
    api(page, live_server, "GET", "/panes/t1?cols=80&rows=24")
    _, text = screen_text(page, live_server, "t1")
    assert "Not connected" in text and key.split()[1][:40] in text.replace("\n", "")   # the key to authorize, on screen
    info = api(page, live_server, "POST", "/panes/t1/connect", {"target": f"tester@{host}"})
    assert info["state"] == "connected", info
    wait_screen(page, live_server, "t1", "fake shell for tester (xterm-256color 80x24)")
    api(page, live_server, "POST", "/panes/t1/input", {"text": "echo hi there"})
    api(page, live_server, "POST", "/panes/t1/input", {"key": "Enter"})
    wait_screen(page, live_server, "t1", "\nhi there")
    api(page, live_server, "POST", "/panes/t1/input", {"key": "ArrowUp"})          # escape sequences reach the shell
    wait_screen(page, live_server, "t1", "$ echo hi there\nhi there\n$ echo hi there")
    api(page, live_server, "POST", "/panes/t1/input", {"key": "Ctrl+C"})
    wait_screen(page, live_server, "t1", "^C")
    api(page, live_server, "POST", "/panes/t1/input", {"text": "color\r"})
    s, _ = wait_screen(page, live_server, "t1", "red plain")
    runs = next(line for line in s["lines"] if any(r[0] == "red" for r in line))
    assert next(r for r in runs if r[0] == "red")[1:] == ["red", "default", 1]  # red, bold
    assert s["cursor"] and s["state"] == "connected"
    api(page, live_server, "POST", "/panes/t1/input", {"text": "exit\r"})
    end = time.time() + 5
    while api(page, live_server, "GET", "/panes/t1")["state"] != "closed":
        assert time.time() < end
        time.sleep(0.1)
    r = page.request.post(f"{live_server}/apps/ssh/api/panes/t1/input", data=json.dumps({"key": "Enter"}),
                          headers={"content-type": "application/json"})
    assert r.status == 409                                                          # not connected


def test_password_fallback_and_bad_targets(page: Page, live_server, sshd):
    host, _ = sshd
    login(page, live_server)                                                        # a new user: key not authorized
    enable(page, live_server, "ssh")
    assert api(page, live_server, "POST", "/panes/t2/connect", {"target": f"tester@{host}"})["state"] == "password"
    assert api(page, live_server, "POST", "/panes/t2/connect", {"target": f"tester@{host}", "password": "nope"})["state"] == "error"
    assert api(page, live_server, "POST", "/panes/t2/connect", {"target": f"tester@{host}", "password": "secret"})["state"] == "connected"
    for bad in ("", "no user host", "tester@host;rm", "tester@h:99999"):
        r = page.request.post(f"{live_server}/apps/ssh/api/panes/t3/connect", data=json.dumps({"target": bad}),
                              headers={"content-type": "application/json"})
        assert r.status == 400, bad
    api(page, live_server, "POST", "/forget", {"target": f"tester@{host}"})


def test_others_cannot_use_my_terminal(page: Page, live_server, sshd, browser):
    login(page, live_server)
    enable(page, live_server, "ssh")
    api(page, live_server, "GET", "/panes/mine1")
    other = browser.new_page()
    login(other, live_server)
    enable(other, live_server, "ssh")
    r = other.request.get(f"{live_server}/apps/ssh/api/panes/mine1/screen?after=-1")
    assert r.status == 403
    other.close()


def test_quest_connect_from_title_bar_and_type_live(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('ssh')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:ssh')")
    aim(page, "right", [0.1, 1.0, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("window.__ssh?.size === 1 && [...window.__ssh.values()][0].term.snap", timeout=10000)
    pid = page.evaluate("[...window.__ssh.keys()][0]")
    bar = page.evaluate(f"""async () => {{ const THREE = await import('three'); const b = window.__ssh.get('{pid}').term.bar;
      b.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).toArray(); }}""")
    aim(page, "right", bar)                                                          # title bar: connect prompt
    press(page, "right", "trigger")
    page.wait_for_function(f"{KB}.open && {KB}.req.label.startsWith('Connect to')", timeout=3000)
    page.evaluate(f"{KB}.type('tester@{host}'); {KB}.input(['go', 1.5, 'go'])")
    page.wait_for_function(f"{KB}.open && {KB}.req.live", timeout=8000)              # connected: live keyboard up
    assert page.evaluate(f"window.__ssh.get('{pid}').term.info.state") == "connected"
    assert page.evaluate(f"window.__ssh.get('{pid}').term.kb.open")             # the app's handle sees it open
    assert page.evaluate(f"{KB}.find('Ctrl')") and page.evaluate(f"{KB}.find('^C')")
    page.evaluate(f"{KB}.type('echo yo'); {KB}.input(['go', 1.5, 'go'])")
    page.wait_for_function(f"""window.__ssh.get('{pid}').term.snap.lines.some(l => l.map(r => r[0]).join('').trim() === 'yo')""", timeout=5000)
    # Sticky Ctrl: Ctrl, then c → ^C.
    page.evaluate(f"{KB}.find('Ctrl').run(); {KB}.type('c')")
    page.wait_for_function(f"""window.__ssh.get('{pid}').term.snap.lines.some(l => l.map(r => r[0]).join('').includes('^C'))""", timeout=5000)
    page.evaluate(f"{KB}.type('color'); {KB}.input(['go', 1.5, 'go'])")
    page.wait_for_function(f"""window.__ssh.get('{pid}').term.snap.lines.some(l => l.map(r => r[0]).join('').includes('red plain'))""", timeout=5000)
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const t = window.__ssh.get('{pid}').term;
      t.screen.updateWorldMatrix(true, false); const c = new THREE.Vector3().setFromMatrixPosition(t.screen.matrixWorld);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(t.screen.matrixWorld); const eye = c.clone().addScaledVector(n, 0.55);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, c, new THREE.Vector3(0, 1, 0)));
      const d = window.__xrDevice; d.position.set(eye.x, eye.y, eye.z); d.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(300)
    page.screenshot(path="test-results/ssh-pane.png")
    look_at_keyboard(page)
    page.screenshot(path="test-results/ssh-keyboard.png")


def test_saved_hosts_api(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    assert api(page, live_server, "GET", "/hosts")["hosts"] == []
    api(page, live_server, "POST", "/hosts", {"target": "me@box.lan"})
    api(page, live_server, "POST", "/panes/h1/connect", {"target": f"tester@{host}"})      # connecting saves it, first
    got = [h["target"] for h in api(page, live_server, "GET", "/hosts")["hosts"]]
    assert got == [f"tester@{host}", "me@box.lan"]
    r = page.request.post(f"{live_server}/apps/ssh/api/hosts", data=json.dumps({"target": "bad host"}), headers={"content-type": "application/json"})
    assert r.status == 400
    r = page.request.delete(f"{live_server}/apps/ssh/api/hosts?target=me@box.lan")
    assert [h["target"] for h in r.json()["hosts"]] == [f"tester@{host}"]


def test_saved_hosts_in_the_quest_menu(page: Page, live_server, sshd):
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    api(page, live_server, "POST", "/hosts", {"target": f"tester@{host}"})
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('ssh')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:ssh')")
    aim(page, "right", [0.1, 1.0, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("window.__ssh?.size === 1", timeout=10000)
    pid = page.evaluate("[...window.__ssh.keys()][0]")
    from test_quest import open_menu, click_menu
    open_menu(page)
    page.evaluate("window.__app.questMenu().go('app', { app: 'ssh' })")
    page.wait_for_function(f"window.__app?.questMenu().find('tester@{host}')", timeout=5000)
    assert page.evaluate("window.__app.questMenu().find('Add host…')")
    click_menu(page, f"tester@{host}")                                                   # tap a saved host: this pane connects
    page.wait_for_function(f"window.__ssh.get('{pid}').term.info.state === 'connected'", timeout=8000)
    page.wait_for_function(f"window.__app?.questMenu().find('tester@{host}')?.props.sub?.includes('connected')", timeout=5000)
    page.evaluate(f"{KB}.close(null)")                                                  # (its keyboard came up in front)
    page.wait_for_function(f"!{KB}.group.visible", timeout=3000)
    click_menu(page, f"Remove tester@{host}")                                           # trash: gone from the list
    page.wait_for_function(f"!window.__app?.questMenu().find('tester@{host}')", timeout=5000)
    assert api(page, live_server, "GET", "/hosts")["hosts"] == []


def test_saved_hosts_in_the_phone_menu(page: Page, live_server, sshd):
    from test_main import open_ar, create_space, TAG_A
    from test_apps_e2e import place_app
    host, authorized = sshd
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    api(page, live_server, "POST", "/hosts", {"target": "me@box.lan"})
    api(page, live_server, "POST", "/hosts", {"target": f"tester@{host}"})
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "ssh")
    page.wait_for_function("window.__ssh?.size === 1", timeout=10000)
    page.click("#ov-fab")
    page.click("#ov-sheet [data-tab=apps]")
    page.click("#ov-sheet .tile[data-key='app:ssh']")
    page.wait_for_selector(f"#ov-sheet [data-row='am-tester@{host}']")
    assert page.is_visible("#ov-sheet [data-row='am-me@box.lan']")
    page.wait_for_timeout(300)
    page.screenshot(path="test-results/overlay-sheet-ssh.png")
    page.click("#ov-sheet [data-rm='me@box.lan']")                                      # trash: removed, sheet stays
    page.wait_for_selector("#ov-sheet [data-row='am-me@box.lan']", state="detached")
    assert page.evaluate("window.__app.sheetOpen()")
    page.click(f"#ov-sheet [data-row='am-tester@{host}']")                              # tap: connects, sheet closes
    page.wait_for_function("[...window.__ssh.values()][0].term.info.state === 'connected'", timeout=8000)
    assert not page.evaluate("window.__app.sheetOpen()")


def test_terminal_keys_reach_the_shell(page: Page, live_server, sshd):
    """F-keys, Shift+Tab, Insert, PgUp and Alt (ESC + key) as real sequences."""
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    api(page, live_server, "GET", "/panes/k1?cols=80&rows=24")
    api(page, live_server, "POST", "/panes/k1/connect", {"target": f"tester@{host}"})
    wait_screen(page, live_server, "k1", "fake shell")
    for key in ("F1", "F5", "F12", "Shift+Tab", "Insert", "PageUp", "Alt+b", "Alt+ArrowLeft"):
        api(page, live_server, "POST", "/panes/k1/input", {"key": key})
    _, text = wait_screen(page, live_server, "k1", "<esc:[1;3D>")
    for want in ("<esc:OP>", "<esc:[15~>", "<esc:[24~>", "<esc:[Z>", "<esc:[2~>", "<esc:[5~>", "<alt:b>"):
        assert want in text, (want, text)


def test_quest_terminal_on_a_placed_full_keyboard(page: Page, live_server, sshd):
    """Placed full keyboard: no duplicate chips, F-keys / Alt from its keys,
    a Bluetooth keyboard types in too, and the pane says it's the one typing."""
    from test_placed_keyboard import PK, hands, tip_to
    host, authorized = sshd
    login(page, live_server)
    enable(page, live_server, "ssh")
    authorize(page, live_server, authorized)
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('ssh')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:ssh')")
    aim(page, "right", [0.1, 1.0, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("window.__ssh?.size === 1 && [...window.__ssh.values()][0].term.snap", timeout=10000)
    pid = page.evaluate("[...window.__ssh.keys()][0]")
    page.evaluate("window.__app.arm('keyboard')")
    aim(page, "right", [0.0, 0.8, -0.6])
    press(page, "right", "trigger")
    page.wait_for_function(f"{PK} && {PK}.find('q')", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.values()].find(e => e.data.components.keyboard).data.id")
    page.evaluate(f"""() => {{ const e = window.__app.world.objects.get('{oid}');
      return window.__app.world.setComponents('{oid}', {{ ...e.data.components, keyboard: {{ layout: 'full' }} }}); }}""")
    page.wait_for_function(f"{PK}.find('F5')", timeout=5000)
    hands(page)
    tip_to(page, PK, "g", 0.05)                                                  # at the placed keyboard
    api(page, live_server, "POST", f"/panes/{pid}/connect", {"target": f"tester@{host}"})
    T = f"window.__ssh.get('{pid}').term"
    page.wait_for_function(f"{T}.info.state === 'connected'", timeout=8000)
    page.evaluate(f"window.__app.runtime.select({{ object: {T}.screen, point: new (window.__app.world.scene.position.constructor)(), uv: null }}, {{ origin: new (window.__app.world.scene.position.constructor)(), dir: new (window.__app.world.scene.position.constructor)(0, 0, -1) }})")
    page.wait_for_function(f"{PK}.busy && {T}.kb?.open", timeout=3000)            # typing lands on the placed one
    page.wait_for_function(f"[...{PK}.keys.widgets.keys()].some(k => k.startsWith('chip-'))", timeout=3000)   # rebuilt (next frame)
    chips = page.evaluate(f"[...{PK}.keys.widgets.keys()].filter(k => k.startsWith('chip-'))")
    assert sorted(chips) == ["chip-Paste", "chip-^C"], chips                     # the rest are real keys on this board
    page.evaluate(f"{PK}.find('F5').run(); {PK}.find('Alt').run(); {PK}.type('b')")
    wait_screen(page, live_server, pid, "<alt:b>")
    _, text = screen_text(page, live_server, pid)
    assert "<esc:[15~>" in text
    # A Bluetooth keyboard: real key events type into the same pane.
    page.evaluate("""() => { for (const key of ['e', 'c', 'h', 'o', ' ', 'h', 'w', 'Enter'])
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); }""")
    wait_screen(page, live_server, pid, "\nhw")
    page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))")
    wait_screen(page, live_server, pid, "^C")
    assert page.evaluate(f"{T}.kb.open")                                          # bar shows ⌨ typing here
