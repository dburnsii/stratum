"""/raytest: a bare page to tune the hand ray (targets to pinch, sliders that
change the ray live, stats, Save to telemetry)."""
import math

from playwright.sync_api import Page

R = "window.__raytest"


def open_raytest(page: Page, base: str):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/raytest?emulate=quest3")
    page.wait_for_function("!document.getElementById('enter').disabled", timeout=10000)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.click("#enter")
    page.wait_for_function(f"{R}?.rays.right.ray && {R}.targets[0].group.position.y > 0", timeout=10000)
    return errors


def aim_hand_at(page, world):
    """Turn the right hand so its ray points at a world point (solve with the ray's own direction)."""
    page.evaluate("""async (to) => { const THREE = await import('three'); const d = window.__xrDevice.hands.right, rt = window.__raytest;
      for (let k = 0; k < 6; k++) {
        await new Promise((r) => setTimeout(r, 120));
        const ray = rt.rays.right.ray; if (!ray) continue;
        const want = new THREE.Vector3(...to).sub(ray.origin).normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(ray.dir.clone().normalize(), want);
        const q = turn.multiply(new THREE.Quaternion(d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w));
        d.quaternion.set(q.x, q.y, q.z, q.w);
      } }""", world)
    page.wait_for_timeout(400)


def pinch(page):
    page.evaluate("window.__xrDevice.hands.right.updatePinchValue(1)")
    page.wait_for_timeout(200)
    page.evaluate("window.__xrDevice.hands.right.updatePinchValue(0)")
    page.wait_for_timeout(150)


def test_the_ray_follows_the_sliders(page: Page, live_server):
    errors = open_raytest(page, live_server)
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.2, -0.35)")
    page.wait_for_timeout(300)
    angle = """(() => { const rt = window.__raytest, h = window.__app ? null : null; const r = rt.rays.right.ray;
      return r.dir.toArray(); })()"""
    before = page.evaluate(angle)
    for v in (0.0, math.pi / 2):                                          # straight out of the palm, then along the fingers
        page.evaluate(f"(() => {{ const rt = {R}; rt.params.tilt = {v}; rt.params.smooth = 0; rt.drawPanel(); }})()")
        page.wait_for_timeout(300)
        d = page.evaluate(angle)
        assert sum(a * b for a, b in zip(before, d)) < 0.9, (before, d)    # changed live
    page.evaluate(f"{R}.pressButton('defaults')")
    assert abs(page.evaluate(f"{R}.params.tilt") - 0.9948) < 1e-3                # (57°, the main app's)
    assert not errors, errors


def test_pinching_a_target_counts_a_hit_and_a_miss_says_how_far(page: Page, live_server):
    errors = open_raytest(page, live_server)
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.2, -0.35)")
    page.evaluate(f"{R}.params.smooth = 0")
    t2 = page.evaluate(f"{R}.targets[1].group.getWorldPosition(new ({R}.targets[1].group.position.constructor)()).toArray()")
    aim_hand_at(page, t2)
    assert page.evaluate(f"{R}.rays.right.hit?.target?.n") == 2
    pinch(page)
    assert page.evaluate(f"{R}.stats.hits") == 1 and page.evaluate(f"{R}.stats.perTarget[2].hits") == 1
    aim_hand_at(page, [t2[0] + 0.12, t2[1], t2[2]])                         # a little to the right of it: a miss
    pinch(page)
    s = page.evaluate(f"{R}.stats")
    assert s["misses"] == 1 and 1 < s["missDeg"][0] < 15, s
    assert len(s["jolts"]) == 2
    assert not errors, errors


def test_pinch_drag_a_slider_and_save(page: Page, live_server):
    errors = open_raytest(page, live_server)
    page.evaluate("window.__xrDevice.hands.right.position.set(0.15, 1.2, -0.35)")
    page.evaluate(f"{R}.params.smooth = 0")
    at = lambda x, i: page.evaluate(f"{R}.panel.localToWorld(new ({R}.panel.position.constructor)({x}, {R}.sliderY({i}), 0)).toArray()")
    aim_hand_at(page, at(0.15, 0))                                         # the angle slider, right end
    page.evaluate("window.__xrDevice.hands.right.updatePinchValue(1)")
    page.wait_for_timeout(200)
    hi = page.evaluate(f"{R}.params.tilt")
    assert hi > 1.2, hi                                                    # ~78°
    aim_hand_at(page, at(-0.15, 0))                                        # slide left while pinching
    lo = page.evaluate(f"{R}.params.tilt")
    page.evaluate("window.__xrDevice.hands.right.updatePinchValue(0)")
    assert lo < 0.4, lo
    page.evaluate(f"{R}.pressButton('save')")
    assert abs(page.evaluate("JSON.parse(localStorage.getItem('stratum.raytest')).tilt") - lo) < 1e-6
    assert not errors, errors
