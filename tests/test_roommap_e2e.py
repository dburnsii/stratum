"""Room map end to end: an emulated phone maps a (fake) room in the
background just by looking around, a picture hangs flat on the mapped wall,
a reload still has the map; a Quest's room scan goes up on its own.
DESIGN.md §3.8, §3.10."""
import json
import math
from pathlib import Path

from playwright.sync_api import Page

from test_main import PNG, TAG_A, login, open_ar, create_space, set_camera, tap, wait_until
from test_quest import open_quest, aim, press

# IWER global space: floor y = 0, the device at about (0, 1.6, 0) looking down -z.
ROOM = {"planes": [
    {"label": "wall", "center": [0, 1.3, -3], "normal": [0, 0, 1], "size": [4, 2.6]},
    {"label": "floor", "center": [0, 0, -1.5], "normal": [0, 1, 0], "size": [4, 3]},
    {"label": "table", "center": [0, 0.75, -0.8], "normal": [0, 1, 0], "size": [0.8, 0.6]},
]}


def look(page: Page, pitch=0.0, yaw=0.0):
    """Turn the phone (pitch down < 0), then let a few samples land."""
    page.evaluate(f"""async () => {{ const THREE = await import('three');
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler({math.radians(pitch)}, {math.radians(yaw)}, 0, 'YXZ'));
      window.__xrDevice.quaternion.set(q.x, q.y, q.z, q.w); }}""")
    page.wait_for_timeout(700)


def sheet_row(page: Page, text: str):
    page.click("#ov-fab") if not page.evaluate("window.__app.sheetOpen()") else None
    page.click("#ov-sheet [data-tab=space]")
    page.click(f"#ov-sheet .rowbtn:has-text('{text}')")


def test_phone_sweep_maps_walls_floor_table_and_pictures_hang_on_the_wall(page: Page, live_server, tmp_path):
    login(page, live_server)
    (tmp_path / "dot.png").write_bytes(PNG)
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)};")
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.set_input_files("#upload", [str(tmp_path / "dot.png")])
    page.wait_for_function("document.querySelectorAll('#library li').length === 1", timeout=8000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => s.aligned && !s.temporary)", timeout=10000)
    set_camera(page, [])   # the tag drops out of view; the space stays where it was
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")

    assert page.evaluate("window.__app.roomMap.mapping")      # on by default, no button
    for yaw in (-15, 0, 15):
        look(page, 0, yaw)                                   # the far wall
    look(page, -47)                                          # the table
    look(page, -50, 8)
    look(page, -38, 25)                                      # the floor beside it
    look(page, -38, -25)
    kinds = page.evaluate(f"window.__app.roomMap.mine.get('{sid}') && [...window.__app.roomMap.mine.get('{sid}').values()].map(e => e.data.kind)")
    assert {"wall", "table", "floor"} <= set(kinds), kinds
    page.evaluate("window.__app.roomMap.save()")
    wait_until(page, f"""fetch('/api/spaces/{sid}/surfaces').then(r => r.json())
      .then(j => ['wall', 'table', 'floor'].every(k => j.surfaces.some(s => s.kind === k && s.sources.includes('phone'))))""", timeout=8000)
    page.evaluate(f"window.__app.roomMap.load('{sid}')")
    page.wait_for_function(f"window.__app?.roomMap.surfaces('{sid}').some(s => s.kind === 'wall')", timeout=5000)
    c = page.evaluate(f"window.__app.roomMap.count('{sid}')")
    assert c["floor"] == 1, c                                # one floor, however far apart the samples
    page.evaluate("window.__app.roomMap.setVisible(true)")
    look(page, -30, 10)
    page.screenshot(path=str(Path(__file__).parent.parent / "test-results" / "roommap-mapping.png"))
    wall = page.evaluate(f"window.__app.roomMap.surfaces('{sid}').filter(s => s.kind === 'wall').map(s => s.polygon)")
    assert any(max(p[1] for p in w) - min(p[1] for p in w) > 2.0 for w in wall)   # walls run floor to ceiling

    # Hang the picture: aim at the wall and tap. It lands flat on the wall, facing the room.
    page.click("#ov-scrim", position={"x": 200, "y": 120}) if page.is_visible("#ov-scrim") else None
    look(page, 0, 0)
    img = page.request.get(f"{live_server}/api/assets").json()["assets"][0]["hash"]
    page.evaluate(f"window.__app.arm('{img}')")
    tap(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.components.image && e.data.rev)", timeout=8000)
    pos, fwd = page.evaluate("""async () => { const THREE = await import('three');
      const e = [...window.__app.world.objects.values()].find(e => e.data.components.image);
      e.built.root.updateWorldMatrix(true, false);
      const m = e.built.root.matrixWorld;
      return [new THREE.Vector3().setFromMatrixPosition(m).toArray(), new THREE.Vector3(0, 0, 1).transformDirection(m).toArray()]; }""")
    assert abs(pos[2] - (-3 + 0.004)) < 0.03, pos            # on the wall plane
    assert fwd[2] > 0.99, fwd                                # facing out of the wall, toward the room

    # Another session (fresh page) loads the saved map.
    page.reload()
    page.wait_for_function(f"window.__app?.roomMap?.surfaces('{sid}').length >= 3", timeout=10000)


def test_quest_imports_its_room_scan(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)};")
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('cube')")                # first placement makes the Space
    aim(page, "right", [0, 0.75, -0.8])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.sharedLayer)", timeout=8000)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    # No button: the scan goes up by itself once the Space exists.
    wait_until(page, f"""fetch('/api/spaces/{sid}/surfaces').then(r => r.json())
      .then(j => ['wall', 'table', 'floor'].every(k => j.surfaces.some(s => s.kind === k && s.sources.includes('quest'))))""", timeout=10000)
    page.evaluate(f"window.__app.roomMap.load('{sid}')")
    page.wait_for_function(f"window.__app?.roomMap.surfaces('{sid}').some(s => s.kind === 'wall')", timeout=5000)
    got = page.request.get(f"{live_server}/api/spaces/{sid}/surfaces").json()["surfaces"]
    assert {("floor", "quest"), ("table", "quest"), ("wall", "quest")} <= {(s["kind"], s["source"]) for s in got}
    hit = page.evaluate("""async () => { const THREE = await import('three');
      const h = window.__app.roomMap.raycast({ origin: new THREE.Vector3(0, 1.6, 0), dir: new THREE.Vector3(0, 0, -1) });
      return h && [h.surface.kind, h.point.z]; }""")
    assert hit[0] == "wall" and abs(hit[1] + 3) < 0.01
