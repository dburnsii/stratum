"""Steady Spaces from noisy tags (DESIGN.md §3.6): sightings are averaged,
not chased; once they agree an anchor takes over; tags that firmly disagree
with the anchor make a new one."""
import json
import math

from playwright.sync_api import Page

from test_main import TAG_A, create_space, login, open_ar

ROOT_POS = """async () => { const THREE = await import('three');
  const s = [...window.__app.world.spaces.values()].find(s => !s.temporary);
  return new THREE.Vector3().setFromMatrixPosition(s.root.matrix).toArray(); }"""
TAG_POS = """async () => { const THREE = await import('three');
  return new THREE.Vector3().setFromMatrixPosition(window.__app.tracker.tags.get(0).pose).toArray(); }"""
JITTER = """(spec) => { clearInterval(window.__jitter); let k = 0;
  window.__jitter = setInterval(() => { k++;
    const r = (n) => (Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1;   // repeatable noise in -1..1
    window.__fakeCamera = { tags: [{ ...spec, x: spec.x + 12 * r(1), y: spec.y + 12 * r(2), px: spec.px + 6 * r(3) }] }; }, 50); }"""


def spread(points):
    c = [sum(p[i] for p in points) / len(points) for i in range(3)]
    return max(math.dist(p, c) for p in points)


def test_tagfix_averages_noise_and_ignores_outliers(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    r = page.evaluate("""async () => {
      const THREE = await import('three');
      const { TagFix } = await import('/js/tagfix.js');
      const fix = new TagFix();
      let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
      const truth = new THREE.Vector3(1, 0.5, -2), yaw = 0.3;
      const settledAt = [];
      for (let i = 0; i < 200; i++) {
        const bad = i % 10 === 7;                               // 10% wild readings (a flipped pose)
        const p = truth.clone().add(new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(bad ? 0.5 : 0.04));
        const m = new THREE.Matrix4().makeRotationY(yaw + (bad ? 0.3 : rnd() * 0.02)).setPosition(p);
        fix.add(m, bad ? 3 : 1, i * 100);                        // even with a high weight
        if (fix.settled && !settledAt.length) settledAt.push(i);
      }
      const e = fix.estimate, x = new THREE.Vector3().setFromMatrixColumn(e, 0);
      return { err: new THREE.Vector3().setFromMatrixPosition(e).distanceTo(truth), yawErr: Math.abs(Math.atan2(-x.z, x.x) - yaw) * 180 / Math.PI,
               settled: fix.settled, settledAt: settledAt[0], spread: fix.spread };
    }""")
    assert r["err"] < 0.008 and r["yawErr"] < 0.5, r
    assert r["settled"] and r["settledAt"] < 60, r


def test_space_holds_still_while_tag_readings_jitter_then_anchors(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.evaluate(JITTER, TAG_A)
    page.wait_for_function("""[...window.__app.world.spaces.values()].some(s => !s.temporary
      && [...s.anchors.values()].some(a => a.fromTags && a.tracked))""", timeout=20000)
    assert page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).alignedBy") == "anchor"
    page.wait_for_timeout(1000)                       # the glide onto the new anchor finishes
    tags, roots = [], []
    for _ in range(25):
        tags.append(page.evaluate(TAG_POS))
        roots.append(page.evaluate(ROOT_POS))
        page.wait_for_timeout(80)
    noisy, still = spread(tags), spread(roots)
    assert noisy > 0.004, noisy                       # the readings really are noisy...
    assert still < 0.001 and still < noisy / 5, (still, noisy)   # ...the Space isn't
    page.evaluate("clearInterval(window.__jitter)")


def test_tags_that_firmly_disagree_make_a_new_anchor(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("""[...window.__app.world.spaces.values()].some(s => !s.temporary
      && [...s.anchors.values()].some(a => a.fromTags && a.tracked))""", timeout=20000)
    first = page.evaluate("[...[...window.__app.world.spaces.values()].find(s => !s.temporary).anchors.keys()]")
    before = page.evaluate(ROOT_POS)
    moved = {**TAG_A, "x": TAG_A["x"] + 45}             # the tag now reads ~7 cm to the side, every time
    page.evaluate(f"window.__fakeCamera = {json.dumps({'tags': [moved]})}")
    page.wait_for_function(f"""(() => {{ const s = [...window.__app.world.spaces.values()].find(s => !s.temporary);
      return [...s.anchors.values()].some(a => a.tracked && !{json.dumps(first)}.includes(a.id)); }})()""", timeout=30000)
    page.wait_for_timeout(800)
    after = page.evaluate(ROOT_POS)
    assert math.dist(before, after) > 0.05, (before, after)
    assert any("re-anchoring" in l for l in page.evaluate("window.__app.lines"))


def test_sightings_taken_while_moving_count_little_or_not_at_all(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    w = page.evaluate("""async () => {
      const { sightingWeight } = await import('/js/tagfix.js');
      return { still: sightingWeight(1, 1), turning: sightingWeight(1, 1, 20), walking: sightingWeight(1, 1, 0, 0.2),
               whipping: sightingWeight(1, 1, 90), striding: sightingWeight(1, 1, 0, 0.6) }; }""")
    assert w["still"] > 0
    assert w["turning"] < w["still"] / 2 and w["walking"] < w["still"] / 4
    assert w["whipping"] == 0 and w["striding"] == 0


def test_live_socket_reconnects_when_it_goes_quiet(page: Page, live_server):
    """A socket that dies without closing (Quest Browser after sleep) is
    noticed by the ping watchdog, replaced, and the Space resynced."""
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world?.live?.ws?.readyState === 1", timeout=10000)
    page.evaluate("""() => { const live = window.__app.world.live;
      window.__oldWs = live.ws; live.ws.onmessage = null; live.heardAt -= 60000; live.watch(); }""")
    page.wait_for_function("window.__app?.world.live.ws !== window.__oldWs && window.__app?.world.live.ws.readyState === 1", timeout=10000)
    assert page.evaluate("window.__oldWs.readyState") >= 2      # the dead one is closed, not left dangling


def test_hold_spaces_still_ignores_small_corrections_but_not_big_ones(page, live_server):
    """Steady mode (setting): a 5 cm correction doesn't move the Space; 30 cm
    held for a few seconds does."""
    from test_main import TAG_A, create_space, login, open_ar
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    r = page.evaluate("""async () => { const THREE = await import('three'); const w = window.__app.world;
      const sp = [...w.spaces.values()].find((s) => s.aligned);
      w.update = () => {};                                   // only our corrections, not the live tags
      const start = new THREE.Vector3().setFromMatrixPosition(sp.root.matrix);
      const at = (dx) => [{ m: sp.root.matrix.clone().setPosition(start.clone().add(new THREE.Vector3(dx, 0, 0))), by: 'test' }];
      w.steady = true;
      let t = performance.now();
      for (let i = 0; i < 100; i++) w.align(sp, at(0.05), 0.05, t += 50);         // 5 s of a small correction
      const small = new THREE.Vector3().setFromMatrixPosition(sp.root.matrix).distanceTo(start);
      for (let i = 0; i < 30; i++) w.align(sp, at(0.3), 0.05, t += 50);           // 1.5 s far off: still held
      const early = new THREE.Vector3().setFromMatrixPosition(sp.root.matrix).distanceTo(start);
      for (let i = 0; i < 200; i++) w.align(sp, at(0.3), 0.05, t += 50);          // longer: it moves there
      const late = new THREE.Vector3().setFromMatrixPosition(sp.root.matrix).distanceTo(start);
      w.steady = false;
      return { small, early, late }; }""")
    assert r["small"] < 1e-6 and r["early"] < 1e-6 and abs(r["late"] - 0.3) < 0.01, r
