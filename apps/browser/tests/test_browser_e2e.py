"""Browser panes end to end: emulated phone → Stratum → browser backend
(real Chromium) → local test page."""
import json

import pytest

from playwright.sync_api import Page

import math

from test_main import TAG_A, login, open_ar, create_space, tap, place, pointer, touch, objects_on_server, wait_until
from test_apps_e2e import enable, place_app


def panes(page):
    return page.evaluate("[...window.__browser.keys()]")


def wait_frame(page, pane_id):
    page.wait_for_function(f"window.__browser.get('{pane_id}')?.browser.tex.image?.width === 1280", timeout=15000)


def start(page, live_server, tags=(TAG_A,)):
    login(page, live_server)
    enable(page, live_server, "browser")
    open_ar(page, live_server, list(tags))
    if tags:
        create_space(page)
    place_app(page, "browser")
    page.wait_for_function("window.__browser?.size === 1", timeout=15000)
    pid = panes(page)[0]
    wait_frame(page, pid)
    return pid


def test_pane_streams_page_and_tap_clicks_it(page: Page, live_server):
    pid = start(page, live_server)
    assert page.evaluate(f"window.__browser.get('{pid}').browser.info.title") == "Test Home"
    # Pane floats 0.4 m ahead at eye height; its top half is the page's button.
    tap(page, pitch=43)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.title === 'Clicked'", timeout=8000)
    assert "Address" in page.evaluate("document.getElementById('ov-appbar').textContent")


def test_swipe_on_pane_scrolls_it(page: Page, live_server):
    pid = start(page, live_server)
    pt = page.evaluate(f"window.__app.screenPoint('{pid}')")
    page.evaluate(f"""() => {{
      const el = document.getElementById('overlay');
      const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {{ clientX: x, clientY: y, bubbles: true }}));
      ev('pointerdown', {pt['x']}, {pt['y']}); ev('pointermove', {pt['x']}, {pt['y'] - 60}); ev('pointermove', {pt['x']}, {pt['y'] - 160});
      ev('pointerup', {pt['x']}, {pt['y'] - 160});
    }}""")
    wait_until(page, f"""fetch('/apps/browser/api/panes/{pid}').then(r => r.json()).then(i => i.title.startsWith('Scrolled'))""", timeout=8000)


def test_two_panes_drag_one_delete_one(page: Page, live_server):
    first = start(page, live_server)
    place(page, "app:browser", pitch=-12)                  # second pane, lower down
    page.wait_for_function("window.__browser.size === 2", timeout=15000)
    second = next(p for p in panes(page) if p != first)
    wait_frame(page, second)

    # Drag the second pane (hold, then move), then delete it.
    before = page.evaluate(f"window.__app.world.objects.get('{second}').data.pose.p")
    b = part_world(page, second, "base")
    touch(page, ("start", {"at": b}), ("wait", 750), ("move", {"at": [b[0] + 0.2, b[1], b[2]]}), ("wait", 300), ("end",), ("wait", 800))
    after = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == second)["pose"]["p"]
    assert after[0] > before[0] + 0.05, (before, after)        # moved right, and saved
    assert page.evaluate("window.__app.selectedId") == second

    # Delete it: the page closes on the backend, the other pane keeps going.
    page.evaluate("document.querySelector('#ov-context [data-act=delete]').click()")
    page.wait_for_function("window.__browser.size === 1", timeout=5000)
    still = page.request.get(f"{live_server}/apps/browser/api/panes/{first}")
    assert still.ok
    assert first in panes(page)


def test_browser_in_temporary_space(page: Page, live_server):
    pid = start(page, live_server, tags=())
    assert page.evaluate(f"window.__browser.get('{pid}').instance.temporary") is True



def test_tap_clicks_and_selects_and_selected_pane_still_scrolls(page: Page, live_server):
    pid = start(page, live_server)
    tap(page, pitch=43)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.title === 'Clicked'", timeout=8000)
    assert page.evaluate("window.__app.selectedId") == pid          # tap also selected the pane
    pose0 = page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p")
    pt = page.evaluate(f"window.__app.screenPoint('{pid}')")
    x, y = pt["x"], pt["y"]
    pointer(page, ("down", x, y), ("move", x, y - 60), ("move", x, y - 160), ("up", x, y - 160))   # quick swipe
    wait_until(page, f"fetch('/apps/browser/api/panes/{pid}').then(r => r.json()).then(i => i.title.startsWith('Scrolled'))", timeout=8000)
    assert page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p") == pose0   # scrolled, not dragged


def part_world(page, pid, part):
    """World position of a pane part ('base', 'bar', 'screen')."""
    return page.evaluate(f"""async () => {{ const THREE = await import('three');
      const m = window.__browser.get('{pid}').browser.{part}; m.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).toArray(); }}""")


def head(page):
    return page.evaluate("[window.__xrDevice.position.x, window.__xrDevice.position.y, window.__xrDevice.position.z]")


def angle_deg(a, b, origin):
    da = [x - o for x, o in zip(a, origin)]
    db = [x - o for x, o in zip(b, origin)]
    dot = sum(x * y for x, y in zip(da, db)) / (math.hypot(*da) * math.hypot(*db))
    return math.degrees(math.acos(max(-1, min(1, dot))))


def test_quick_touches_on_the_page_never_move_the_pane(page: Page, live_server):
    """Only a still hold picks a pane up: a touch that moves first is the
    page's (scroll), and a tap is a click."""
    pid = start(page, live_server)
    pose0 = page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p")
    scr = part_world(page, pid, "screen")
    pointer(page, ("down", 206, 300))
    touch(page, ("start", {"at": scr}), ("wait", 100))
    pointer(page, ("move", 206, 340), ("move", 206, 400, 800))                            # finger moves first: a swipe
    touch(page, ("move", {"at": [scr[0] + 0.2, scr[1], scr[2]]}), ("wait", 300), ("end",), ("wait", 400))
    pointer(page, ("up", 206, 400))
    assert page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p") == pose0   # moved on the page: no drag
    page.evaluate(f"window.__tapScreen({{ at: {part_world(page, pid, 'bar')} }})")         # title bar tap → URL box
    page.wait_for_function("!document.getElementById('ov-ask').hidden", timeout=3000)


def test_grabbed_point_stays_on_the_finger_ray(page: Page, live_server):
    """Regression: the pane jumped on grab (wrong grab point / screen-pixel
    rays) and a pointercancel dropped it at the top of the screen."""
    pid = start(page, live_server)
    b0 = part_world(page, pid, "base")
    h = head(page)
    d0 = math.dist(b0, h)
    aim = [b0[0] + 0.15, b0[1] + 0.05, b0[2]]
    touch(page, ("start", {"at": b0}), ("wait", 750), ("move", {"at": aim}), ("wait", 400))
    b1 = part_world(page, pid, "base")
    assert angle_deg(b1, aim, h) < 1.5 and abs(math.dist(b1, h) - d0) < 0.01, (b0, b1, aim)
    # A DOM pointercancel at (0, 0) mid-drag must not move it.
    pointer(page, ("down", 600, 400), ("cancel", 0, 0, 300))
    b2 = part_world(page, pid, "base")
    assert math.dist(b1, b2) < 0.005, (b1, b2)
    touch(page, ("end",), ("wait", 300))


def test_held_object_follows_the_phone(page: Page, live_server):
    """Holding a pane (by its base) and moving the phone carries it, finger
    still. Temporary space: the fake camera's tag moves with the fake phone,
    which would drag a tag-aligned Space along too."""
    pid = start(page, live_server, tags=())
    before = page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p")
    touch(page, ("start", {"at": part_world(page, pid, "base")}), ("wait", 750))    # hold: picked up
    page.evaluate("window.__xrDevice.position.x += 0.3")          # walk 30 cm to the right
    touch(page, ("wait", 400), ("end",), ("wait", 300))
    after = page.evaluate(f"window.__app.world.objects.get('{pid}').data.pose.p")   # temporary: kept locally
    assert abs((after[0] - before[0]) - 0.3) < 0.03, (before, after)


# ---- the real-browser parts: video, tabs, address bar, sound ------------------------------

def tap_part(page, pid, part, u, v):
    """A tap on part ('screen' / 'chrome' / 'list') at uv (0..1, v up), through the app's select()."""
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const ctx = window.__browser.get('{pid}');
      const mod = [...window.__app.runtime.running.values()].find(i => i.id === '{pid}').module;
      mod.select(ctx, {{ object: ctx.browser.{part}, uv: new THREE.Vector2({u}, {v}), point: new THREE.Vector3() }}); }}""")


def chrome_uv(page, pid, label):
    """uv of a tab-strip / toolbar region: 'plus', 'address', 'tab:<n>', 'close:<n>'."""
    return page.evaluate(f"""(() => {{ const b = window.__browser.get('{pid}').browser, H = b.chromeCanvas.height, tabs = b.info.tabs.length;
      const r = b.regions, pick = {{ plus: r[2 * tabs], address: r.find(g => g.x0 === 330) }};
      const m = '{label}'.match(/^(tab|close):(\\d+)$/); const g = m ? r[2 * +m[2] + (m[1] === 'close' ? 1 : 0)] : pick['{label}'];
      return [(g.x0 + g.x1) / 2 / 2048, 1 - (g.y0 + g.y1) / 2 / H]; }})()""")


def info_of(page, pid):
    return page.evaluate(f"window.__browser.get('{pid}').browser.info")


def test_the_pane_plays_video_not_snapshots(page: Page, live_server):
    pid = start(page, live_server)
    codec = page.evaluate(f"window.__browser.get('{pid}').browser.codec")
    assert codec in ("h264", "vp8"), codec                                  # WebCodecs decodes the stream
    f0 = page.evaluate(f"window.__browser.get('{pid}').browser.frames")
    page.wait_for_function(f"window.__browser.get('{pid}').browser.frames > {f0} + 10", timeout=8000)   # a steady stream


def test_tabs_new_switch_close(page: Page, live_server):
    pid = start(page, live_server)
    u, v = chrome_uv(page, pid, "plus")
    tap_part(page, pid, "chrome", u, v)                                     # ＋: a new tab (home page), shown
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.tabs.length === 2", timeout=8000)
    assert info_of(page, pid)["tabs"][1]["active"]
    u, v = chrome_uv(page, pid, "tab:0")
    tap_part(page, pid, "chrome", u, v)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.tabs[0].active", timeout=8000)
    u, v = chrome_uv(page, pid, "close:1")
    tap_part(page, pid, "chrome", u, v)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.tabs.length === 1", timeout=8000)


def test_address_bar_types_live_suggests_and_goes(page: Page, live_server, test_site):
    from test_quest import open_quest
    login(page, live_server)
    enable(page, live_server, "browser")
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('browser')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:browser')")
    from test_quest import aim, press
    aim(page, "right", [0.15, 1.0, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function("window.__browser?.size === 1", timeout=15000)
    pid = panes(page)[0]
    wait_frame(page, pid)
    KB = "window.__app.keyboard()"
    u, v = chrome_uv(page, pid, "address")
    tap_part(page, pid, "chrome", u, v)                                     # the address bar: edit mode, live keyboard
    page.wait_for_function(f"window.__browser.get('{pid}').browser.edit && {KB}.open && {KB}.req.live", timeout=5000)
    assert page.evaluate(f"{KB}.req.label") == "Address"
    page.evaluate(f"{KB}.type('{test_site}/two.html')")                    # typing replaces the selected URL
    page.wait_for_function(f"window.__browser.get('{pid}').browser.edit.text === '{test_site}/two.html'", timeout=3000)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.suggest[0]?.typed", timeout=3000)
    page.evaluate(f"{KB}.input(['go', 1.5, 'go'])")                         # Enter: go there
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.title === 'Page Two'", timeout=8000)
    assert not page.evaluate(f"window.__browser.get('{pid}').browser.edit")
    # Again: words make a search; history suggests the page by its title.
    tap_part(page, pid, "chrome", u, v)
    page.wait_for_function(f"window.__browser.get('{pid}').browser.edit", timeout=3000)
    page.evaluate(f"{KB}.type('Page Tw')")
    page.wait_for_function(f"window.__browser.get('{pid}').browser.suggest.length >= 2 && window.__browser.get('{pid}').browser.list.visible", timeout=5000)
    s = page.evaluate(f"window.__browser.get('{pid}').browser.suggest")
    assert s[0]["typed"] and s[0]["title"] == "Search for “Page Tw”" and s[1]["url"].endswith("/two.html")
    tap_part(page, pid, "list", 0.5, 1 - 1.5 / 6)                           # the second row: the page from history
    page.wait_for_function(f"!window.__browser.get('{pid}').browser.edit && !window.__browser.get('{pid}').browser.list.visible", timeout=3000)
    tap_part(page, pid, "chrome", u, v)
    page.evaluate(f"{KB}.type('cats')")
    page.evaluate(f"{KB}.input(['go', 1.5, 'go'])")
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.url.includes('q=cats')", timeout=8000)   # a search


def test_sound_reaches_the_pane(page: Page, live_server, test_site):
    pid = start(page, live_server)
    page.evaluate(f"""fetch('/apps/browser/api/panes/{pid}/input', {{ method: 'POST', headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{ type: 'goto', url: '{test_site}/tone.html' }}) }})""")
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.title === 'Tone'", timeout=8000)
    tap_part(page, pid, "screen", 0.5, 0.5)                                 # a tap: plays the tone, and the sound comes to this pane
    page.wait_for_function(f"window.__browser.get('{pid}').browser.info.title === 'Playing'", timeout=8000)
    page.wait_for_function(f"(window.__browser.get('{pid}').browser.audioPackets ?? 0) > 20", timeout=8000)


@pytest.mark.demo
def test_demo_shows_pictures_and_tabs_switch_them_without_the_server(page: Page, live_server):
    """For now the client shows still pictures (Google, Netflix): no pane on the server, no stream."""
    asked = []
    page.on("request", lambda r: "/apps/browser/api/" in r.url and asked.append(r.url))
    login(page, live_server)
    enable(page, live_server, "browser")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "browser")
    page.wait_for_function("window.__browser?.size === 1", timeout=15000)
    pid = panes(page)[0]
    B = f"window.__browser.get('{pid}').browser"
    wait_frame(page, pid)                                                           # the Google picture, 1280 wide
    assert page.evaluate(f"{B}.demo") and page.evaluate(f"{B}.demoPage") == "google"
    assert [t["title"] for t in page.evaluate(f"{B}.info.tabs")] == ["Google", "Example"]
    page.evaluate(f"{B}.regions.find(r => r.y0 === 0 && 600 >= r.x0 && 600 < r.x1).run()")   # tap the second tab
    page.wait_for_function(f"{B}.demoPage === 'example' && {B}.info.url.includes('example.com')", timeout=5000)
    assert not page.evaluate(f"{B}.ws")                                              # no stream
    assert asked == [], asked                                                        # and nothing asked of the server
