"""Hands as a swept club (js/apps/kit/handsweep.js): every finger bone and the
palm, tested along the path moved since the last frame, so a fast swing at
the headset's frame rate can't pass a 9 mm golf ball between frames."""
from playwright.sync_api import Page

from test_main import login

# A flat, vertical hand (palm facing ±x, fingers hanging to the green) with
# its fingers spread along z; joints in WebXR order.
HAND = """(THREE, x, z, y0 = 0.004) => {
  const j = [new THREE.Vector3(x, 0.14, z)];
  [-2, -1, 0, 1, 2].forEach((f, fi) => {
    const n = fi === 0 ? 4 : 5;
    for (let k = 0; k < n; k++) j.push(new THREE.Vector3(x, 0.11 - (0.11 - y0) * (k + 1) / n, z + f * 0.017));
  });
  return { joints: j, scale: 1, pinch: 0.1, palm: { position: new THREE.Vector3(x, 0.09, z), quaternion: new THREE.Quaternion() } };
}"""

SWING = """async ({ speed, fps, trials }) => {
  const THREE = await import('three');
  const { HandSweep } = await import('/js/apps/kit/handsweep.js');
  const hand = (""" + HAND + """);
  const ball = new THREE.Vector3(0, 0.009, 0), R = 0.009;
  let swept = 0, naive = 0, n = 0;
  for (let i = 0; i < trials; i++) {
    const phase = i / trials, dz = ((i * 7) % 13 - 6) / 6 * 0.03;     // where frames fall, and how far off-center
    const club = new HandSweep(THREE);
    let hit = null, touched = false;
    for (let f = 0; f < 40 && !hit; f++) {
      const x = -0.35 + (f + phase) * speed / fps;
      if (x > 0.45) break;
      const h = hand(THREE, x, dz);
      club.frame({ left: null, right: h }, 1 / fps);
      hit = club.contact(ball, R);
      touched ||= club.near(ball) < R + 0.009;                       // what a per-frame check would see
    }
    n++;
    if (hit && hit.normal.x > 0.5 && Math.abs(hit.velocity.x - speed) < 0.2) swept++;
    if (touched) naive++;
  }
  return { swept: swept / n, naive: naive / n }; }"""


def test_fast_swings_at_low_frame_rate_all_hit(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    r = page.evaluate(SWING, {"speed": 3.0, "fps": 30, "trials": 60})
    assert r["swept"] >= 0.95, r                 # the gate (DESIGN.md plan: ≥ 95%)
    assert r["naive"] < 0.8, r                   # what the old per-frame contact missed


def test_a_hand_appearing_on_the_ball_is_not_a_swing(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    v = page.evaluate("""async () => { const THREE = await import('three');
      const { HandSweep } = await import('/js/apps/kit/handsweep.js'); const hand = (""" + HAND + """);
      const club = new HandSweep(THREE);
      club.frame({ left: null, right: hand(THREE, 0.005, 0) }, 1 / 72);      // first seen right on the ball
      const c = club.contact(new THREE.Vector3(0, 0.009, 0), 0.009);
      return c ? c.velocity.length() : 0; }""")
    assert v < 0.01, v


def test_golf_a_quick_hand_swing_putts_the_ball(page: Page, live_server):
    """End to end in the golf app: a hand swept through the ball at 1 m/s with
    tracking updating at 30 Hz hits it (+x, about (1 + e) × hand speed) and
    counts a stroke; the attempt is logged."""
    from test_apps_e2e import start_golf
    start_golf(page, live_server)
    G = "window.__golf.ctx.golf"
    b = page.evaluate(f"(() => {{ const t = {G}.ball.translation(); return [t.x, t.z]; }})()")
    page.evaluate("""async ([bx, bz]) => { const THREE = await import('three'); const hand = (""" + HAND + """);
      const ctx = window.__golf.ctx, t0 = performance.now();
      let cur = hand(THREE, bx - 0.3, bz);
      window.__swing = setInterval(() => { const x = bx - 0.3 + Math.min(0.6, (performance.now() - t0) / 1000 * 1.0); cur = hand(THREE, x, bz); }, 33);
      window.__seen = []; const tel = ctx.telemetry; ctx.telemetry = (e, d) => { window.__seen.push([e, d]); tel?.(e, d); };
      ctx.hands = () => ({ left: null, right: cur }); }""", b)
    page.wait_for_function(f"{G}.strokes === 1", timeout=4000)
    v = page.evaluate(f"(() => {{ const v = {G}.ball.linvel(); return [v.x, v.z]; }})()")
    page.wait_for_function("window.__seen.some(([e]) => e === 'golf attempt')", timeout=3000)
    attempt = page.evaluate("window.__seen.find(([e]) => e === 'golf attempt')[1]")
    page.evaluate("clearInterval(window.__swing); window.__golf.ctx.hands = () => null")
    assert v[0] > 0.6 and abs(v[1]) < 0.3, v
    assert attempt["hit"] is True and attempt["closeCm"] < 2 and attempt["speed"] > 0.5, attempt
