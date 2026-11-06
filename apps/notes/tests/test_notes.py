"""Notes: stick a note on a wall and a label flat on a table (fake room),
write on it with the phone's typing box (opens by itself for whoever placed
it), recolor, mark done; it's saved in the object for everyone."""
import json
from pathlib import Path

from playwright.sync_api import Page

from test_main import TAG_A, login, create_space, set_camera, tap
from test_roommap_e2e import ROOM, look
from test_apps_e2e import enable

SHOTS = Path(__file__).resolve().parents[3] / "test-results"


def note_of(page: Page, kind: str):
    return f"[...window.__notes].find(c => c.note?.cfg.kind === '{kind}')"


def normal(page: Page, kind: str):
    """World direction of the note's face (+Z of its instance frame)."""
    return page.evaluate(f"""async () => {{ const THREE = await import('three'); const c = {note_of(page, kind)};
      c.note.group.updateWorldMatrix(true, false);
      return new THREE.Vector3(0, 0, 1).transformDirection(c.note.group.matrixWorld).toArray(); }}""")


def saved(page: Page, kind: str):
    return page.evaluate(f"""(() => {{ const c = {note_of(page, kind)}; const e = window.__app.world.objects.get(c.instance.id);
      return e.data.components.app.config; }})()""")


def write(page: Page, text: str):
    page.wait_for_selector("#ov-ask:not([hidden])", timeout=5000)
    page.fill("#ov-ask-input", text)
    page.click("#ov-ask-ok")


def test_stick_write_recolor_and_check_off(page: Page, live_server):
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    enable(page, live_server, "notes")
    page.add_init_script(f"window.__fakeRoom = {json.dumps(ROOM)};")
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => s.aligned && !s.temporary)", timeout=10000)
    set_camera(page, [])
    page.wait_for_function("window.__app?.runtime.apps.get('notes')?.enabled", timeout=5000)

    # A sticky note on the wall: it opens the typing box by itself (you just placed it).
    look(page, 0, 0)
    page.evaluate("window.__app.arm('app:notes:sticky')")
    tap(page)
    page.wait_for_function("window.__notes?.size === 1", timeout=8000)
    write(page, "Call the plumber")
    page.wait_for_function(f"{note_of(page, 'sticky')}.note.cfg.text === 'Call the plumber'", timeout=3000)
    n = normal(page, "sticky")
    assert abs(n[1]) < 0.2 and n[2] > 0.9, n                                    # flat on the wall, facing the room
    page.wait_for_function(f"(() => {{ const c = {note_of(page, 'sticky')}; return window.__app?.world.objects.get(c.instance.id).data.components.app.config.text === 'Call the plumber'; }})()", timeout=3000)

    # A label flat on the table.
    look(page, -47)
    page.evaluate("window.__app.arm('app:notes:label')")
    tap(page)
    page.wait_for_function("window.__notes?.size === 2", timeout=8000)
    write(page, "Spices")
    page.wait_for_function(f"{note_of(page, 'label')}.note.cfg.text === 'Spices'", timeout=3000)
    n = normal(page, "label")
    assert n[1] > 0.95, n                                                       # lying on the table, face up

    # Recolor + done (the note's buttons), saved in the object.
    page.evaluate(f"{note_of(page, 'sticky')}.ctx ?? 0")
    acts = lambda kind: f"window.__app.runtime.uiState().find(u => u.instance === {note_of(page, kind)}.instance.id).actions"
    page.evaluate(f"{acts('sticky')}.find(a => a.label.includes('Color')).run()")
    page.evaluate(f"{acts('sticky')}.find(a => a.label.includes('Done')).run()")
    page.wait_for_function(f"(() => {{ const c = {note_of(page, 'sticky')}; const s = c && window.__app?.world.objects.get(c.instance.id).data.components.app.config; return !!s && s.done === true && s.color === 'pink'; }})()", timeout=3000)
    # The menu lists the notes here.
    sec = page.evaluate("window.__app.menuData().apps.find(a => a.id === 'notes').menu")
    assert sec["title"] == "Here" and {i["label"] for i in sec["items"]} == {"Call the plumber", "Spices"}

    page.evaluate("window.__xrDevice.position.z = -2.6; window.__xrDevice.position.y = 1.35")   # walk up to the wall
    look(page, 12, 0)                                                           # (the aim dot off the note)
    page.screenshot(path=str(SHOTS / "notes-wall.png"))


def test_note_previews_in_the_chooser(page: Page, live_server):
    from test_main import open_ar
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    enable(page, live_server, "notes")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("window.__app?.runtime.apps.get('notes')?.enabled", timeout=5000)
    page.click("#ov-fab")
    page.click("#ov-sheet .sect .link:has-text('All')")
    page.click("#ov-sheet .tile[data-key='choose:notes']")
    page.wait_for_function("document.querySelectorAll('#ov-chooser .vcard .pv img').length === 9", timeout=8000)
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "notes-chooser.png"))
