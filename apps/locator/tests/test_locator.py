"""Find It (apps/locator): a dictionary of where things are. Marked spots live
in the instance config (shared); the list is pinned to the menu's Home; finding
one shows an arrow in front of you and a marker on the spot."""
import math

from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar
from test_quest import open_quest, aim, press, open_menu, click_menu

F = "window.__find"


def start(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "locator")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "locator")
    page.wait_for_function(f"{F}?.ctx.find", timeout=15000)


def viewer_at(page, x, y, z, yaw=0.0):
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const ctx = {F}.ctx;
      ctx.viewer = () => ({{ position: new THREE.Vector3({x}, {y}, {z}), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), {yaw}) }}); }}""")


def test_mark_things_and_the_list_is_a_sorted_dictionary_on_home(page: Page, live_server):
    start(page, live_server)
    for name, p in [("Spare keys", [1, 0.4, -1]), ("batteries", [-1, 0.9, 0.5]), ("HDMI cable", [0.5, 0.2, 2])]:
        page.evaluate(f"{F}.mark({name!r}, {p})")
    oid = page.evaluate(f"{F}.ctx.instance.id")
    page.wait_for_function(f"window.__app.world.objects.get('{oid}').data.components.app.config.items?.length === 3", timeout=5000)   # saved, shared
    sec = page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'locator').menu")
    assert sec["pin"] and [i["label"] for i in sec["items"]] == ["batteries", "HDMI cable", "Spare keys"], sec   # A–Z, any case
    assert [i["emoji"] for i in sec["items"]] == ["🔋", "🔌", "🔑"]
    page.evaluate(f"{F}.mark('spare KEYS', [2, 0.5, 0])")                    # the same name again: moved, not added
    items = page.evaluate(f"{F}.items()")
    assert len(items) == 3 and next(i for i in items if i["name"] == "Spare keys")["p"] == [2, 0.5, 0]
    page.click("#ov-fab")                                                     # phone menu Home: the pinned list
    page.wait_for_selector("#ov-sheet .group :text('batteries')", timeout=3000)
    assert page.is_visible("#ov-sheet :text('Mark where something is')")


def test_mark_by_pointing_at_the_room(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"""(() => {{ const THREE = {F}.ctx.THREE;
      {F}.ctx.surfaces = () => [{{ id: 's', kind: 'shelf', polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]], matrix: new THREE.Matrix4().makeTranslation(0.5, 1.1, -1.5) }}]; }})()""")
    page.evaluate(f"{F}.startMark('Passport')")
    assert page.evaluate(f"{F}.state().marking.name") == "Passport"
    took = page.evaluate(f"""(() => {{ const ctx = {F}.ctx, THREE = ctx.THREE;
      const mod = [...window.__app.runtime.running.values()].find(i => i.app.id === 'locator').module;
      const o = new THREE.Vector3(0.5, 1.6, 0), d = new THREE.Vector3(0, 1.1, -1.5).sub(new THREE.Vector3(0, 1.6, 0)).normalize();
      return mod.press(ctx, {{ phase: 'down', side: 'right', source: 'hand', object: null, point: null, ray: () => ({{ origin: o, dir: d }}) }}); }})()""")
    assert took
    it = page.evaluate(f"{F}.items()")[0]
    assert it["name"] == "Passport" and it["emoji"] == "📄"
    assert abs(it["p"][1] - 1.1) < 0.005 and abs(it["p"][2] + 1.5) < 0.01 and abs(it["p"][0] - 0.5) < 0.01, it   # on the shelf, where the ray met it
    assert page.evaluate(f"{F}.state().marking") is None


def test_finding_points_an_arrow_at_it_and_says_found_when_you_get_there(page: Page, live_server):
    start(page, live_server)
    viewer_at(page, 0, 1.6, 0)
    iid = page.evaluate(f"{F}.mark('Tape measure', [2, 0.3, -2])")
    page.evaluate(f"{F}.find('{iid}')")
    page.wait_for_timeout(600)
    s = page.evaluate(f"{F}.state()")
    assert s["arrow"] and s["marker"] and s["markerPos"] == [2, 0.3, -2]
    ax, ay, az = s["arrowPos"]
    assert abs(ax) < 0.05 and abs(ay - (1.6 - 0.22)) < 0.03 and abs(az + 0.45) < 0.05, s["arrowPos"]   # in front of you, a little low
    want = [2 - ax, 0.3 - ay, -2 - az]
    n = math.sqrt(sum(c * c for c in want))
    dot = sum(a * b / n for a, b in zip(s["arrowDir"], want))
    assert dot > 0.99, (s["arrowDir"], want)
    q = page.evaluate(f"{F}.ctx.find.arrow.quaternion.toArray()")              # the arrow mesh itself turned that way
    fwd = page.evaluate(f"new {F}.ctx.THREE.Vector3(0, 0, -1).applyQuaternion(new {F}.ctx.THREE.Quaternion(...{q})).toArray()")
    assert sum(a * b / n for a, b in zip(fwd, want)) > 0.97, fwd
    assert page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'locator').menu.items[0].sub") == "Finding…"
    viewer_at(page, 1.8, 1.6, -1.8)                                           # walk up to it
    page.wait_for_function(f"{F}.state().target?.found", timeout=3000)
    page.wait_for_function(f"!{F}.state().target && !{F}.state().arrow", timeout=10000)   # then it tidies up


def test_trash_forgets_one(page: Page, live_server):
    start(page, live_server)
    a = page.evaluate(f"{F}.mark('Gift wrap', [1, 0, 0])")
    page.evaluate(f"{F}.mark('Stamps', [0, 0, 1])")
    page.evaluate(f"{F}.find('{a}')")
    page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'locator').menu.items[0].remove()")   # Gift wrap (A–Z first)
    assert [i["name"] for i in page.evaluate(f"{F}.items()")] == ["Stamps"]
    assert page.evaluate(f"{F}.state().target") is None                       # stopped finding what's gone


def test_quest_hand_menu_home_has_the_list_one_tap_from_finding(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "locator")
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('app:locator')")
    aim(page, "right", [0.0, 0.8, -0.6])
    press(page, "right", "trigger")
    page.wait_for_function(f"{F}?.ctx.find", timeout=10000)
    iid = page.evaluate(f"{F}.mark('Allen keys', [0.3, 0.2, -1])")
    open_menu(page)
    assert page.evaluate("window.__app.questMenu().nav.stack.at(-1).page") == 'home'   # on Home: no app page to open
    click_menu(page, "Allen keys")
    page.wait_for_function(f"{F}.state().target?.id === '{iid}' && {F}.state().arrow", timeout=3000)
