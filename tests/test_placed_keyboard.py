"""A keyboard that lives at a spot (⌨ Keyboard object): typing goes to it
when your hands are at it (the pop-up keyboard never shows), typing already
on the pop-up moves over when you reach for it, keys typed with nothing open
go to the last-used app, and its layout is simple or full + number pad."""
import json

from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest, press, aim
from test_keyboard import hands

PK = "window.__app.placedKeyboard()"
FK = "window.__app.keyboard()"


def key_point(page, kb, label, offset):
    return page.evaluate(f"""(() => {{ const k = {kb}; const w = k.find({json.dumps(label)});
      return k.worldOf(w).addScaledVector(k.normal(), {offset}).toArray(); }})()""")


def tip_to(page, kb, label, offset, hand="right"):
    target = key_point(page, kb, label, offset)                                 # once: the key may be gone after it's pressed
    for _ in range(2):
        page.evaluate(f"""() => {{ const t = {json.dumps(target)};
          const tip = window.__app.hands().joint('{hand}', 9); const h = window.__xrDevice.hands['{hand}'].position;
          h.set(h.x + t[0] - tip.x, h.y + t[1] - tip.y, h.z + t[2] - tip.z); }}""")
        page.wait_for_timeout(90)


def poke(page, kb, label, hand="right"):
    tip_to(page, kb, label, 0.03, hand)
    tip_to(page, kb, label, -0.003, hand)
    if page.evaluate(f"!!{kb}.find({json.dumps(label)})"):
        tip_to(page, kb, label, 0.03, hand)                                    # pull back (re-arms)


def hands_away(page):
    page.evaluate("""() => { const d = window.__xrDevice; d.hands.left.position.set(-0.3, 0.9, 0.2); d.hands.right.position.set(0.3, 0.9, 0.2); }""")
    page.wait_for_timeout(200)


def place_keyboard(page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("window.__app.arm('keyboard')")
    aim(page, "right", [0.0, 0.8, -0.6])
    press(page, "right", "trigger")
    page.wait_for_function(f"{PK} && {PK}.find('q')", timeout=8000)          # keys showing, nothing typed into
    assert not page.evaluate(f"{PK}.busy")
    hands(page)


def test_typing_goes_to_the_placed_keyboard_when_youre_at_it(page: Page, live_server):
    place_keyboard(page, live_server)
    tip_to(page, PK, "g", 0.05)                                                # hand over the keyboard
    page.evaluate("window.__answer = undefined; void window.__app.askText('Name', '').then((v) => { window.__answer = v; })")
    page.wait_for_function(f"{PK}.busy", timeout=3000)
    assert not page.evaluate(f"{FK}.open")                                     # no pop-up
    for k in "hi":
        poke(page, PK, k)
    poke(page, PK, "Done")
    page.wait_for_function("window.__answer !== undefined", timeout=3000)
    assert page.evaluate("window.__answer") == "hi"
    assert page.evaluate(f"{PK}.find('q') && !{PK}.busy")                      # still there, idle again


def test_reaching_for_it_moves_typing_off_the_popup(page: Page, live_server):
    place_keyboard(page, live_server)
    hands_away(page)
    page.evaluate("""window.__keys = []; window.__kbClosed = null; window.__h = window.__app.openKeyboard({ label: 'Terminal',
      onKey: (e) => window.__keys.push(e), onClose: (r) => { window.__kbClosed = r; } })""")
    page.wait_for_function(f"{FK}.open", timeout=3000)                         # away from it: the pop-up
    tip_to(page, PK, "x", 0.05)                                                # reach for the placed one
    page.wait_for_function(f"!{FK}.open && {PK}.busy", timeout=3000)
    poke(page, PK, "x")
    assert page.evaluate("window.__keys") == [{"text": "x"}]
    assert page.evaluate("window.__kbClosed") is None                         # moved, not closed


def test_full_layout_has_named_keys_and_a_number_pad(page: Page, live_server):
    place_keyboard(page, live_server)
    oid = page.evaluate("[...window.__app.world.objects.values()].find(e => e.data.components.keyboard).data.id")
    page.evaluate(f"""() => {{ const e = window.__app.world.objects.get('{oid}');
      return window.__app.world.setComponents('{oid}', {{ ...e.data.components, keyboard: {{ layout: 'full' }} }}); }}""")
    page.wait_for_function(f"{PK}.find('Esc') && {PK}.find('Home')", timeout=5000)
    tip_to(page, PK, "g", 0.05)
    page.evaluate("window.__keys = []; window.__app.openKeyboard({ label: 'Terminal', onKey: (e) => window.__keys.push(e) })")
    page.wait_for_function(f"{PK}.busy", timeout=3000)                         # standing at it: it takes the typing
    for k in ("Esc", "7", "Ctrl", "c", "←"):
        poke(page, PK, k)
    assert page.evaluate("window.__keys") == [{"key": "Escape"}, {"text": "7"}, {"key": "Ctrl+C"}, {"key": "ArrowLeft"}]
    w = page.evaluate(f"{PK}.w")
    assert 0.45 < w < 0.6, w                                                   # desk-keyboard wide


def test_popup_layout_setting(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate("localStorage.setItem('stratum.kbLayout', 'full')")
    page.evaluate("window.__app.keyboard().setLayout('full'); window.__app.openKeyboard({ label: 'x', onKey: () => {} })")
    page.wait_for_function(f"{FK}.open && {FK}.find('Tab') && {FK}.find('9')", timeout=3000)
