"""Hands as physics (js/apps/kit/handbodies.js): a palm swept through a
ball hits it harder the faster it moves; a hand appearing on top of it
doesn't fling it (tracking jumps teleport)."""
from playwright.sync_api import Page

from test_main import login

SWEEP = """async (speed) => {
  const THREE = await import('three');
  const m = await import('/vendor/rapier/rapier.mjs'); const R = m.default ?? m; await R.init();
  const { HandBodies } = await import('/js/apps/kit/handbodies.js');
  const world = new R.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1 / 120;
  const g = world.createRigidBody(R.RigidBodyDesc.fixed()); world.createCollider(R.ColliderDesc.cuboid(1, 0.005, 1), g);
  const ball = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0.0095, 0).setCcdEnabled(true));
  world.createCollider(R.ColliderDesc.ball(0.009).setDensity(1100).setRestitution(0.35), ball);
  const hb = new HandBodies(R, world, THREE, { tips: [] });
  // A flat vertical hand (palm facing -z), moving -z through the ball, 72 Hz frames.
  const q = new THREE.Quaternion();
  const hands = (z) => ({ left: null, right: { joints: [], scale: 1, pinch: 0.1, palm: { position: new THREE.Vector3(0, 0.05, z), quaternion: q } } });
  let z = 0.12, best = 0;
  for (let f = 0; f < 72; f++) {
    hb.frame(hands(z));
    for (let k = 1; k <= 2; k++) { hb.step(k / 2); world.step(); }
    const v = ball.linvel(); best = Math.max(best, Math.hypot(v.x, v.z));
    z -= speed / 72;
    if (z < -0.15) break;
  }
  return best; }"""


def test_faster_swing_hits_harder(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    slow, fast = page.evaluate(SWEEP, 0.3), page.evaluate(SWEEP, 1.2)
    assert slow > 0.2 and fast > slow * 2, (slow, fast)


def test_hand_appearing_on_the_ball_does_not_fling_it(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    v = page.evaluate(SWEEP.replace("let z = 0.12", "let z = 0.0"), 0.0)   # appears right where the ball is, holds still
    assert v < 0.5, v
