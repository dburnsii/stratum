"""Play-area kit (js/apps/kit/playarea.js): any polygon, and the helpers games
use to fit themselves to it."""
from playwright.sync_api import Page

from test_main import login


def test_helpers_fit_a_concave_shape(page: Page, live_server):
    login(page, live_server)
    page.goto(live_server + "/")
    r = page.evaluate("""async () => { const k = await import('/js/apps/kit/playarea.js');
      const L = [[0, 0], [1, 0], [1, 0.4], [0.4, 0.4], [0.4, 1], [0, 1]];          // an L, 1 m × 1 m
      const cells = k.cellsInside(L, 0.1);
      return { inL: k.pointIn(L, 0.2, 0.8), outL: k.pointIn(L, 0.8, 0.8), area: k.area(L), cells: cells.length,
        allIn: cells.every(c => k.pointIn(L, c.x, c.z)), crossing: k.selfCrossing([[0, 0], [1, 1], [1, 0], [0, 1]]),
        ok: k.selfCrossing(L), hit: k.planeHit({ origin: { x: 0, y: 1.6, z: 0 }, dir: { x: 0.5, y: 0.8, z: 0 } }, 2.4),
        away: k.planeHit({ origin: { x: 0, y: 1.6, z: 0 }, dir: { x: 0, y: -1, z: 0 } }, 2.4) }; }""")
    assert r["inL"] and not r["outL"]
    assert abs(r["area"] - 0.64) < 1e-9
    assert r["cells"] == 64 and r["allIn"]                              # 10×4 + 4×6 cells of 10 cm
    assert r["crossing"] and not r["ok"]
    assert abs(r["hit"][0] - 0.5) < 1e-9 and r["away"] is None
