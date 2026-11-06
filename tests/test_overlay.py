"""Phone AR overlay: menu button, sheet, context bar, keyboard-safe typing.
Screenshots land in test-results/overlay-*.png for a visual check."""
from pathlib import Path

from playwright.sync_api import Page

from test_main import TAG_A, login, open_ar, create_space, place, tap

SHOTS = Path(__file__).parent.parent / "test-results"


def shot(page: Page, name: str):
    SHOTS.mkdir(exist_ok=True)
    page.wait_for_timeout(300)   # animations
    page.screenshot(path=str(SHOTS / f"overlay-{name}.png"))


def start(page: Page, live_server):
    page.set_viewport_size({"width": 412, "height": 860})
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("document.getElementById('ov-status-text').textContent.startsWith('In ')", timeout=10000)


def visible(page: Page, sel: str):
    return page.is_visible(sel)


def test_menu_button_opens_sheet_and_arming_closes_it(page: Page, live_server):
    start(page, live_server)
    shot(page, "1-idle")
    assert visible(page, "#ov-fab") and not visible(page, "#ov-sheet")
    page.click("#ov-fab")
    assert visible(page, "#ov-sheet") and visible(page, "#ov-palette .tile[data-key=cube]")
    shot(page, "2-sheet")
    page.click("#ov-sheet [data-tab=space]")                           # Space tab: invite shows a 6-letter code
    page.click("#ov-invite")
    page.wait_for_selector("#ov-invite .code")
    assert len(page.text_content("#ov-invite .code")) == 6
    page.click("#ov-sheet [data-tab=home]")
    page.click("#ov-palette .tile[data-key=cube]")                     # arm: sheet closes, button becomes "placing"
    page.wait_for_selector("#ov-sheet", state="hidden")
    assert page.evaluate("window.__app.armed") == "cube"
    assert "Cube" in page.text_content("#ov-fab")
    shot(page, "3-armed")
    page.click("#ov-fab")                                              # tap the pill: cancel
    assert page.evaluate("window.__app.armed") is None
    page.click("#ov-fab")
    page.click("#ov-scrim", position={"x": 200, "y": 120})            # tap outside: close
    page.wait_for_selector("#ov-sheet", state="hidden")


def test_selection_shows_tools_in_the_context_bar(page: Page, live_server):
    start(page, live_server)
    place(page, "cube")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    tap(page, pitch=7)                                                 # the cube's middle: select
    page.wait_for_function("window.__app?.selectedId", timeout=3000)
    assert visible(page, "#ov-context [data-act=bigger]")
    shot(page, "4-selected")
    page.click("#ov-context [data-act=done]")
    assert page.evaluate("window.__app.selectedId") is None
    assert not visible(page, "#ov-context [data-act=bigger]")


def test_typing_box_docks_at_the_top_and_chips_insert(page: Page, live_server):
    start(page, live_server)
    page.evaluate("void window.__app.runtime.prompt('Go to', 'example').then((v) => { window.__ask = v; })")
    page.wait_for_selector("#ov-ask:not([hidden])")
    box = page.locator("#ov-ask").bounding_box()
    assert box["y"] < 860 / 3, box                                     # top third: clear of the keyboard
    assert not visible(page, "#ov-fab")                                # dock hides while typing
    page.keyboard.press("End")
    page.click("#ov-ask-chips >> text=.com")
    assert page.evaluate("document.activeElement.id") == "ov-ask-input"   # chip kept the keyboard up
    shot(page, "5-typing")
    page.click("#ov-ask-ok")
    page.wait_for_function("window.__ask !== undefined", timeout=2000)
    assert page.evaluate("window.__ask") == "example.com"
    assert visible(page, "#ov-fab")


def test_sheet_pages_search_app_settings_and_drag(page: Page, live_server):
    """Menu v2 on the phone: tabs, search, an app page with its settings,
    the catalog, and drag up (taller) / down (close)."""
    start(page, live_server)
    page.click("#ov-fab")
    shot(page, "sheet-home")
    page.click("#ov-sheet [data-tab=apps]")
    tiles = page.evaluate("[...document.querySelectorAll('#ov-sheet .grid .tile')].map(t => t.dataset.key)")
    assert {"app:plants", "app:golf", "app:browser"} <= set(tiles), tiles
    shot(page, "sheet-apps")
    page.fill("#ov-sheet .search input", "plant")                       # search narrows the grid
    page.wait_for_function("document.querySelectorAll('#ov-sheet .grid .tile').length === 1")
    page.click("#ov-sheet .tile[data-key='app:plants']")               # app page
    page.wait_for_selector("#ov-sheet .hero")
    assert page.text_content("#ov-sheet .title") == "Plants"
    if "on" not in page.get_attribute("#ov-sheet [data-row=enabled]", "class").split():
        page.click("#ov-sheet [data-row=enabled]")
        page.wait_for_selector("#ov-sheet [data-row=set-lapse]")
    page.click("#ov-sheet [data-row=set-lapse] .seg button:has-text('10 s')")   # a choice setting: segmented control
    page.wait_for_function("window.__app?.runtime.apps.get('plants').settingsValues?.lapse === 10", timeout=3000)
    page.wait_for_selector("#ov-sheet [data-row=set-lapse] .seg button.on:has-text('10 s')")
    shot(page, "sheet-app")
    page.click("#ov-sheet .hbtn.back")                                 # back to Apps, search kept
    page.wait_for_function("document.querySelector('#ov-sheet .title').textContent === 'Apps'")
    assert page.input_value("#ov-sheet .search input") == "plant"
    page.click("#ov-sheet [data-tab=home]")
    page.click("#ov-sheet .sect .link:has-text('All')")                # the full catalog
    page.wait_for_function("document.querySelector('#ov-sheet .title').textContent === 'Place'")
    assert page.is_visible("#ov-sheet .grid .tile[data-key=cube]")
    shot(page, "sheet-catalog")
    for tab in ("layers", "space", "settings"):
        page.click(f"#ov-sheet [data-tab={tab}]")
        shot(page, f"sheet-{tab}")

    # Drag the handle up: taller. Down: shorter, then closed.
    def drag(dy):
        g = page.locator("#ov-sheet .grab").bounding_box()
        x, y = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x, y + dy / 2, steps=4)
        page.mouse.move(x, y + dy, steps=4)
        page.wait_for_timeout(250)                                   # slow drag: distance decides, not speed
        page.mouse.up()
        page.wait_for_timeout(400)
    h0 = page.locator("#ov-sheet").bounding_box()["height"]
    drag(-160)
    assert page.locator("#ov-sheet").bounding_box()["height"] > h0 + 100
    shot(page, "sheet-tall")
    drag(150)
    assert abs(page.locator("#ov-sheet").bounding_box()["height"] - h0) < 4
    drag(180)
    page.wait_for_selector("#ov-sheet", state="hidden")
    assert not page.evaluate("window.__app.sheetOpen()")
    assert "sheet-open" not in page.get_attribute("#ov-overlay", "class")
