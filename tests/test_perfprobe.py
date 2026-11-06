"""Find the slowdown (perfprobe.js): Settings → Performance runs the frame rate
with one thing off at a time (camera, mapping, occlusion, hands, FPS meter,
apps), shows the results, logs them, and puts everything back."""
from playwright.sync_api import Page

from test_main import login
from test_probe import wait_for_rows
from test_quest import open_quest

MENU = "window.__app.questMenu()"
PROBE = "window.__app.probe()"


def test_slowdown_test_measures_each_step_and_puts_everything_back(page: Page, live_server, telemetry_dir):
    page.add_init_script("localStorage.setItem('stratum.fpsHud', '1'); window.__probeMs = { settleMs: 200, measureMs: 600 };")
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate(f"{MENU}.toggle(true); {MENU}.go('perf')")
    page.wait_for_function(f"{MENU}.find('Find the slowdown')", timeout=3000)
    page.evaluate(f"{MENU}.find('Find the slowdown').run()")
    page.wait_for_function(f"{PROBE}.running", timeout=2000)
    assert page.evaluate("window.__app.runtime.probing")                     # (no watchdog verdicts meanwhile)
    # Mid-test, the step's thing is off: e.g. the FPS meter.
    page.wait_for_function(f"{PROBE}.state.label === 'FPS meter off'", timeout=10000)
    assert not page.evaluate("window.__app.fpsHud.visible")
    page.wait_for_function(f"{PROBE}.state.label === 'Apps paused and hidden'", timeout=10000)
    assert page.evaluate("window.__app.runtime.paused")
    page.wait_for_function(f"!{PROBE}.running", timeout=15000)
    r = page.evaluate(f"{PROBE}.results")
    keys = [x["key"] for x in r]
    assert keys[0] == "base" and keys[-1] == "all", keys
    assert {"camera", "map", "occlusion", "hands", "fps", "apps"} <= set(keys), keys
    assert all(x["fps"] > 0 and x["frames"] > 0 and x["gapMs"] > 0 for x in r), r
    # Everything back on.
    assert page.evaluate("window.__app.fpsHud.visible") and not page.evaluate("window.__app.runtime.paused")
    assert not page.evaluate("window.__app.runtime.probing")
    # Shown in the menu, and logged.
    page.wait_for_function(f"{MENU}.find('Headset camera off') && {MENU}.find('Run again')", timeout=3000)   # (starting it opened the results page)
    page.evaluate(f"{MENU}.go('perf')")
    page.wait_for_function(f"{MENU}.find('Last test')", timeout=3000)
    [row] = wait_for_rows(telemetry_dir, lambda x: x["msg"] == "slowdown probe")[-1:]
    assert [x["key"] for x in row["data"]["results"]] == keys
