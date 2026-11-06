"""Home app end to end against a fake Home Assistant: hang a control on a
(fake) wall, pick a light in the in-world picker, toggle it, see changes
made elsewhere, keep the choice after a reload."""
import json
from pathlib import Path

from playwright.sync_api import Page

from test_main import TAG_A, login, create_space, set_camera, place, wait_until
from test_roommap_e2e import ROOM, look
from test_apps_e2e import enable

HOME = "[...window.__home.values()][0]"


def tap_picker_row(page: Page, entity: str):
    """Tap the picker row showing `entity` (turning pages until it shows)."""
    for _ in range(10):
        at = page.evaluate(f"""async () => {{ const THREE = await import('three');
          const p = {HOME}.home.picker; const i = p.rows.findIndex(e => e.id === '{entity}');
          if (i < 0) return null;
          const W = p.canvas.width, H = p.canvas.height, w = p.mesh.geometry.parameters.width, h = p.mesh.geometry.parameters.height;
          const y = 112 + i * 62 + 27;
          p.mesh.updateWorldMatrix(true, false);
          return new THREE.Vector3(0, (0.5 - y / H) * h, 0).applyMatrix4(p.mesh.matrixWorld).toArray(); }}""")
        if at:
            page.evaluate(f"window.__tapScreen({{ at: {json.dumps(at)} }})")
            return
        page.evaluate(f"{HOME}.home.picker && (() => {{ const a = window.__app.runtime.uiState().find(u => u.app.id === 'home').actions.find(a => a.label === '▶'); a.run(); }})()")
    raise AssertionError(f"{entity} not in the picker")


def test_hang_a_light_switch_pick_and_toggle(page: Page, live_server, app_backends):
    ha = app_backends["ha"]
    login(page, live_server)
    enable(page, live_server, "home")
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)};")
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => s.aligned && !s.temporary)", timeout=10000)
    set_camera(page, [])
    look(page, 0, 0)

    place(page, "app:home:switch")                            # a switch: aim at the wall, tap: hangs there
    page.wait_for_function(f"window.__home?.size === 1 && {HOME}.home.picker?.rows?.length > 0", timeout=10000)
    inst = page.evaluate("[...window.__app.world.objects.values()].find(e => e.data.components.app).data")
    puck_visible = page.evaluate(f"""(() => {{ let v = null; window.__app.world.objects.get('{inst['id']}').built.root
      .traverse(n => {{ if (n.userData.puck) v = n.visible; }}); return v; }})()""")
    assert puck_visible is False                              # no platform puck (Home draws its own handle)…
    rows = page.evaluate(f"{HOME}.home.picker.all.map(e => e.id)")
    assert "lock.front_door" not in rows and "button.kitchen_ping" not in rows

    shots = Path(__file__).resolve().parents[3] / "test-results"
    shots.mkdir(exist_ok=True)
    page.evaluate("window.__xrDevice.position.z = -2.55; window.__xrDevice.position.y = 1.35")   # walk up to the wall
    page.wait_for_timeout(300)
    page.screenshot(path=str(shots / "home-picker.png"))
    tap_picker_row(page, "light.kitchen")
    page.wait_for_function(f"{HOME}.home.entity === 'light.kitchen' && {HOME}.home.control", timeout=5000)
    assert page.evaluate(f"{HOME}.home.handle.parent") is None   # …and on phones not even that: hold the control to move it
    wait_until(page, f"""fetch('/api/objects?space={inst['space']}').then(r => r.json())
      .then(j => j.objects.some(o => o.components.app?.config?.entity === 'light.kitchen'))""", timeout=5000)   # saved

    # Tap the switch: Home Assistant gets a toggle; the light shows on.
    plate = page.evaluate(f"""async () => {{ const THREE = await import('three'); const c = {HOME}.home.control;
      c.updateWorldMatrix(true, true); return new THREE.Vector3(0, 0, 0.008).applyMatrix4(c.matrixWorld).toArray(); }}""")
    page.evaluate(f"window.__tapScreen({{ at: {json.dumps(plate)} }})")
    page.wait_for_function(f"{HOME}.home.data.state === 'on'", timeout=5000)
    calls = page.request.get(f"{ha}/test/calls").json()["calls"]
    assert ["light", "toggle", "light.kitchen", {}] in calls
    page.wait_for_function(f"{HOME}.home.led.material.emissiveIntensity > 1", timeout=3000)
    page.evaluate("window.__xrDevice.position.z = -2.75")
    page.wait_for_timeout(300)
    page.screenshot(path=str(shots / "home-switch-on.png"))

    # Someone switches it off at the wall: the control follows.
    page.request.post(f"{ha}/test/state", data=json.dumps({"entity_id": "light.kitchen", "state": "off"}), headers={"content-type": "application/json"})
    page.wait_for_function(f"{HOME}.home.data.state === 'off'", timeout=5000)

    # Reload: still bound to the kitchen light, no picker.
    page.reload()
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    set_camera(page, [TAG_A])
    page.click("#enter")
    page.wait_for_function(f"window.__home?.size === 1 && {HOME}.home.entity === 'light.kitchen' && {HOME}.home.control", timeout=15000)


def test_choose_switch_button_or_display_before_placing_on_quest(page: Page, live_server):
    """Quest: the Home tile opens a chooser (three cards, each with a 3D
    preview); picking Display arms it; after placing, the picker only offers
    displays (sensors)."""
    from test_quest import open_quest, open_menu, click_menu, aim, press
    login(page, live_server)
    enable(page, live_server, "home")
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('home')?.enabled", timeout=5000)
    open_menu(page)
    page.evaluate("window.__app.questMenu().go('catalog', {})")
    click_menu(page, "choose:home")
    m = "window.__app.questMenu()"
    page.wait_for_function(f"{m}.modal && {m}.modal.previews.size === 3", timeout=8000)          # live 3D previews
    assert page.evaluate(f"{m}.labels().filter(l => ['Switch', 'Button', 'Display'].includes(l)).length") == 3
    assert page.evaluate(f"[...{m}.modal.previews.values()].every(h => h.visible && h.children.length)")
    page.wait_for_timeout(400)
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const m = {m}; m.group.updateMatrixWorld(true);
      const c = new THREE.Vector3(0, m.modal.box.cy, 0.022).applyMatrix4(m.body.matrixWorld);
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m.body.matrixWorld); const eye = c.clone().addScaledVector(n, 0.42);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, c, new THREE.Vector3(0, 1, 0)));
      const d = window.__xrDevice; d.position.set(eye.x, eye.y, eye.z); d.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(500)
    page.screenshot(path=str(Path(__file__).resolve().parents[3] / "test-results" / "home-chooser-quest.png"))
    click_menu(page, "Display")
    page.wait_for_function("window.__app?.armed === 'app:home:display' && !window.__app?.questMenu().modal", timeout=3000)
    # Hang it (no wall in the emulator: it goes 60 cm along the ray) and check the picker's choices.
    aim(page, "right", [0.3, 1.2, -1.2])
    press(page, "right", "trigger")
    page.wait_for_function(f"window.__home?.size === 1 && {HOME}.home.picker?.rows", timeout=10000)
    kinds = page.evaluate(f"[...new Set({HOME}.home.picker.all.map(e => e.domain))]")
    assert kinds and set(kinds) <= {"sensor", "binary_sensor", "climate", "media_player"}, kinds


def test_phone_chooser_cards_with_previews(page: Page, live_server):
    from test_main import open_ar
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    enable(page, live_server, "home")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("window.__app?.runtime.apps.get('home')?.enabled", timeout=5000)
    page.click("#ov-fab")
    page.click("#ov-sheet .sect .link:has-text('All')")
    page.click("#ov-sheet .tile[data-key='choose:home']")
    page.wait_for_function("document.querySelectorAll('#ov-chooser .vcard .pv img').length === 3", timeout=8000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(Path(__file__).resolve().parents[3] / "test-results" / "home-chooser-phone.png"))
    page.click("#ov-chooser .vcard[data-variant='app:home:button']")
    assert page.evaluate("window.__app.armed") == "app:home:button"
    assert not page.is_visible("#ov-chooser") and not page.evaluate("window.__app.sheetOpen()")
