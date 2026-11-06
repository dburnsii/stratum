"""Jenga (apps/jenga): a real-size tower that stands still, a block pulled
out leaves it standing, a shove knocks it over; the resting state is shared
and saved; physics only runs on the device touching it (lease)."""
from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

J = "window.__jenga.ctx.jenga"


def start(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "jenga")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "jenga")
    page.wait_for_function(f"window.__jenga?.ctx.jenga?.meshes", timeout=15000)


def test_tower_rests_without_physics_and_stands_still_when_simulated(page: Page, live_server):
    start(page, live_server)
    assert page.evaluate(f"{J}.world") is None                              # at rest: no physics running
    assert page.evaluate(f"{J}.meshes.length") == 54
    r = page.evaluate("window.__jenga.simulate(10)")                         # every block awake, 10 s
    assert r["drift"] < 0.001 and r["fallen"] == 0, r


def _pull(page: Page, i: int, axis: str, total: float, steps=60):
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const j = window.__jenga.ctx.jenga;
      window.__jenga.claim(); const t = j.bodies[{i}].translation();
      window.__target = new THREE.Vector3(t.x, t.y, t.z);
      window.__jenga.grab({i}, {{ clone: () => window.__target.clone() }}); }}""")
    for _ in range(steps):
        page.evaluate(f"window.__target.{axis} += {total / steps}; window.__jenga.simulate(1 / 30)")
    page.evaluate("window.__jenga.drop()")
    return page.evaluate("window.__jenga.simulate(2)")


def test_pulling_a_middle_block_out_leaves_it_standing_then_it_settles(page: Page, live_server):
    start(page, live_server)
    r = _pull(page, 8 * 3 + 1, "x", 0.12)                                    # level 8 runs along x: slide the middle one out
    assert r["fallen"] == 0, r
    out = page.evaluate(f"{J}.bodies[25].translation()")
    assert out["x"] > 0.06, out                                              # it's out
    page.wait_for_function(f"{J}.world === null && {J}.room.rest.rev >= 1", timeout=8000)   # still: settled, physics off
    assert not page.evaluate(f"{J}.over")
    saved = page.request.get(f"{live_server}/api/apps/jenga/state/" + "tower-" + page.evaluate("window.__jenga.ctx.instance.id")).json()["value"]
    assert saved["rev"] >= 1 and abs(saved["d"]["b"][25][0] - out["x"]) < 0.01


def test_shoving_the_top_knocks_it_over(page: Page, live_server):
    start(page, live_server)
    r = _pull(page, 13 * 3 + 1, "x", 0.25, steps=20)                         # yank a high block sideways, fast
    for _ in range(3):
        r = page.evaluate("window.__jenga.simulate(1)")
    page.wait_for_function(f"{J}.over || {J}.world === null", timeout=8000)
    over = page.evaluate(f"{J}.over")
    if not over:                                                             # still standing: shove the top level
        r = _pull(page, 17 * 3 + 1, "z", 0.2, steps=10)
        page.wait_for_function(f"{J}.over", timeout=8000)
    assert "fell" in page.evaluate("document.getElementById('ov-appbar').textContent")
    page.evaluate("window.__jenga.rebuild()")
    assert not page.evaluate(f"{J}.over") and page.evaluate(f"{J}.world") is None
