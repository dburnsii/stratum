"""Deleting a space from the menu (Space tab → Your spaces): two taps; it goes
with everything in it, here and on the server."""
from playwright.sync_api import Page

from test_main import TAG_A, create_space, login, open_ar
from test_turntable import cube


def test_delete_a_space_from_the_menu_with_two_taps(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    cube(page, 0.1)
    page.click("#ov-fab")
    page.click("#ov-sheet [data-tab=space]")
    row = f"#ov-sheet [data-row='sp-{sid}']"
    page.wait_for_selector(row, timeout=3000)
    assert "Delete" in page.text_content(row)                                     # (it's mine: delete, not leave)
    page.click(row)
    page.wait_for_selector(f"{row}:has-text('Tap again')", timeout=3000)           # the first tap only arms it
    assert page.evaluate(f"window.__app.world.spaces.has('{sid}')")
    page.click(row)
    page.wait_for_function(f"!window.__app.world.spaces.has('{sid}')", timeout=5000)
    assert page.evaluate(f"![...window.__app.world.objects.values()].some(e => e.data.space === '{sid}')")   # its things went with it
    left = page.request.get(f"{live_server}/api/spaces?device={page.evaluate('window.__app.world.device')}").json()["spaces"]
    assert not any(s["id"] == sid for s in left), left


def test_the_hand_menu_lists_spaces_with_a_bin(page: Page, live_server):
    from test_quest import aim, click_menu, open_menu, open_quest, press
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")                                               # (placing makes a space here)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary)", timeout=8000)
    s = page.evaluate("(() => { const s = [...window.__app.world.spaces.values()].find(s => !s.temporary); return { id: s.id, name: s.name }; })()")
    M = "window.__app.questMenu()"
    page.evaluate(f"{M}.toggle(true); {M}.go('space')")
    bin_ = f"{M}.find('Delete {s['name']}')"
    page.wait_for_function(bin_, timeout=3000)
    page.evaluate(f"{bin_}.run()")
    page.wait_for_function(f"{M}.find('Delete {s['name']}') && [...{M}.page.widgets.values()].some(w => w.props?.label?.startsWith('Tap the bin again'))", timeout=3000)
    page.evaluate(f"{bin_}.run()")
    page.wait_for_function(f"!window.__app.world.spaces.has('{s['id']}')", timeout=5000)
