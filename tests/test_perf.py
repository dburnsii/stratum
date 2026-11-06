"""Performance (js/apps/perf.js + runtime): each app's cost, the headset's frame,
and the watchdog that slows down, then stops, an app that hogs it."""
from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

WD = """async (steps) => { const { Watchdog } = await import('/js/apps/perf.js');
  const w = new Watchdog(); const out = [];
  for (const [t, frame, apps] of steps) for (const a of w.update(t, frame, apps)) out.push([t, a.id, a.act]);
  return out; }"""
BAD = {"fps": 50, "workMs": 15, "budgetMs": 13.9, "target": 72}
OK = {"fps": 72, "workMs": 6, "budgetMs": 13.9, "target": 72}


def test_watchdog_slows_down_then_stops_a_hungry_app_and_lets_a_calm_one_go(page: Page, live_server):
    page.goto(live_server + "/")
    hog = lambda ms, allowed=False: {"id": "hog", "ms": ms, "tris": 1000, "allowed": allowed}
    calm = {"id": "calm", "ms": 0.5, "tris": 1000}
    steps = [[t, BAD, [hog(7), calm]] for t in range(0, 7000, 100)]
    acts = page.evaluate(WD, steps)
    assert [a[1:] for a in acts] == [["hog", "throttle"], ["hog", "stop"]], acts   # the quiet one is left alone
    assert 750 <= acts[0][0] < 950 and 3250 <= acts[1][0] < 3450, acts           # 0.75 s to slow it down, 2.5 s more to stop it
    # Busy but the headset keeps up (headroom): nothing happens.
    assert page.evaluate(WD, [[t, OK, [hog(7)]] for t in range(0, 8000, 100)]) == []
    # Allowed: never touched.
    assert page.evaluate(WD, [[t, BAD, [hog(7, True)]] for t in range(0, 8000, 100)]) == []
    # Slowed down, then it calms (and the frame recovers) for 5 s: full speed again.
    steps = [[t, BAD, [hog(7)]] for t in range(0, 2000, 100)] + [[t, OK, [hog(0.4)]] for t in range(2000, 8000, 100)]
    assert [a[1:] for a in page.evaluate(WD, steps)] == [["hog", "throttle"], ["hog", "unthrottle"]]


def test_watchdog_notices_a_sudden_jump_and_a_scene_full_of_triangles(page: Page, live_server):
    page.goto(live_server + "/")
    usual = [[t, OK, [{"id": "a", "ms": 0.8, "tris": 1000}]] for t in range(0, 3000, 100)]
    jump = [[t, BAD, [{"id": "a", "ms": 2.6, "tris": 1000}]] for t in range(3000, 5000, 100)]   # 3× its usual… not enough alone
    assert page.evaluate(WD, usual + jump) == []
    jump = [[t, BAD, [{"id": "a", "ms": 3.4, "tris": 1000}]] for t in range(3000, 5000, 100)]   # over 4× its usual (and 3 ms)
    assert [a[1:] for a in page.evaluate(WD, usual + jump)] == [["a", "throttle"]]
    heavy = [[t, BAD, [{"id": "big", "ms": 0.5, "tris": 900_000}, {"id": "small", "ms": 0.5, "tris": 20_000}]] for t in range(0, 2000, 100)]
    assert [a[1:] for a in page.evaluate(WD, heavy)] == [["big", "throttle"]]


def start_app(page, live_server, app, hook):
    login(page, live_server)
    enable(page, live_server, app)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, app)
    page.wait_for_function(hook, timeout=15000)


INST = "[...window.__app.runtime.running.values()].find(i => i.app.id === '{app}')"


def test_a_hog_is_slowed_then_stopped_and_run_anyway_brings_it_back(page: Page, live_server):
    start_app(page, live_server, "towers", "window.__td?.ctx.td")
    inst = INST.format(app="towers")
    page.evaluate(f"(() => {{ const i = {inst}, f = i.module.frame; i.module = {{ ...i.module, frame(ctx, dt) {{ const t = performance.now(); while (performance.now() - t < 8); return f.call(this, ctx, dt); }} }}; }})()")
    # The headset falls behind (the emulator's frames are reported as slow): feed the watchdog.
    page.evaluate("""() => { window.__slow = setInterval(() => window.__app.runtime.noteFrame({ fps: 45, workMs: 20, budgetMs: 13.9, target: 72, dropped: 9 }), 50); }""")
    page.wait_for_function(f"{inst}?.throttle === 2", timeout=6000)
    r = page.evaluate("window.__app.runtime.perfReport()")
    hog = next(a for a in r["apps"] if a["app"] == "towers")
    assert hog["throttled"] and hog["ms"] > 2.5, hog
    page.wait_for_function("window.__app.runtime.crashed.get('towers')?.slow", timeout=9000)
    assert page.evaluate(f"!{inst}")                                       # stopped
    page.evaluate("clearInterval(window.__slow)")
    page.wait_for_timeout(2500)
    assert page.evaluate(f"!{inst}")                                       # and it stays stopped (no restart by itself)
    page.click("#ov-fab")                                                  # the phone menu, Apps → Tower Defense: it says so, Run anyway
    page.click("#ov-sheet [data-tab=apps]")
    page.click("#ov-sheet .tile[data-key='app:towers']")
    page.wait_for_selector("#ov-sheet :text('Stopped: it slowed everything down')", timeout=3000)
    page.click("#ov-sheet :text('Run anyway')")
    page.wait_for_function(f"{inst}?.started", timeout=8000)
    assert page.evaluate("window.__app.runtime.perfAllow.has('towers')")


def test_parked_cars_and_a_waiting_pinball_dont_run_physics(page: Page, live_server):
    start_app(page, live_server, "racing", "window.__cars?.ctx.cars?.world")
    clock = "window.__cars.ctx.cars.clock"
    page.wait_for_function(f"{clock}.asleep", timeout=6000)                # parked: asleep
    steps = page.evaluate(f"{clock}.steps")
    page.wait_for_timeout(800)
    assert page.evaluate(f"{clock}.steps") == steps                        # not one step
    page.evaluate("window.__cars.drive(0.8, 0)")                           # driving wakes it
    page.wait_for_function(f"!{clock}.asleep && {clock}.steps > {steps} + 20", timeout=3000)
    page.wait_for_function("window.__cars.speed() > 0.2", timeout=3000)
    page.evaluate("window.__cars.drive(null)")
    page.wait_for_function(f"{clock}.asleep", timeout=12000)               # coasts to a stop, then sleeps again
    r = page.evaluate("window.__app.runtime.perfReport()")
    car = next(a for a in r["apps"] if a["app"] == "racing")
    assert car["sims"] == 1 and car["asleep"] and car["tris"] > 1000, car


def test_a_pinball_waiting_in_the_lane_sleeps(page: Page, live_server):
    start_app(page, live_server, "pinball", "window.__pinball?.ctx.pinball?.world")
    P = "window.__pinball.ctx.pinball"
    page.evaluate("window.__pinball.ctx.pinball.room.claim()")            # (as the player's device)
    page.wait_for_function(f"{P}.clock.asleep", timeout=10000)            # the ball sits in the plunger lane: no physics (slow frames: give it time)
    steps = page.evaluate(f"{P}.clock.steps")
    page.wait_for_timeout(600)
    assert page.evaluate(f"{P}.clock.steps") == steps
    page.evaluate(f"(() => {{ const p = {P}; p.inLane = false; window.__pinball.place(0, 0.2); }})()")   # a ball in play: awake
    page.wait_for_function(f"!{P}.clock.asleep && {P}.clock.steps > {steps} + 50", timeout=3000)


def test_lod_kit_hides_far_parts_and_merges_static_ones(page: Page, live_server):
    page.goto(live_server + "/")
    r = page.evaluate("""async () => { const THREE = await import('three'); const { lod, hideBeyond, mergeStatic } = await import('/js/apps/kit/lod.js');
      const { drawCost } = await import('/js/apps/perf.js');
      const g = new THREE.Group(), m = new THREE.MeshBasicMaterial(), box = () => new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const walls = [...Array(10)].map((_, i) => { const w = new THREE.Mesh(box(), m); w.position.x = i * 0.2; w.userData.handle = true; g.add(w); return w; });
      const plain = [...Array(5)].map((_, i) => { const p = new THREE.Mesh(box(), m); p.position.z = i * 0.2; g.add(p); return p; });
      const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 12), m); g.add(bolt);
      const out = { before: drawCost(g).draws };
      hideBeyond([bolt], 2);
      out.saved = mergeStatic(g, { data: true });
      out.after = drawCost(g).draws;
      out.handles = g.children.filter(c => c.userData.handle).length;
      const cam = new THREE.PerspectiveCamera(); const look = (d) => { cam.position.set(0, 0, d); cam.updateMatrixWorld(); g.updateMatrixWorld(true); g.traverse(o => o.isLOD && o.update(cam)); return drawCost(g); };
      out.near = look(0.5).draws; out.far = look(5).draws;
      const hit = new THREE.Raycaster(new THREE.Vector3(0.4, 0, 2), new THREE.Vector3(0, 0, -1)).intersectObject(g, true)[0];
      out.hitHandle = !!hit?.object.userData.handle;
      return out; }""")
    assert r["before"] == 16 and r["saved"] == 13, r            # 10 handle walls → 1, 5 plain → 1 (not the bolt: it has its LOD)
    assert r["handles"] == 1 and r["hitHandle"], r             # still a grab handle, still raycastable
    assert r["near"] == 3 and r["far"] == 2, r                 # the bolt goes past 2 m



def test_watchdog_stops_a_freezing_app_at_once_and_blames_the_right_one(page: Page, live_server):
    page.goto(live_server + "/")
    froze = lambda t, n: [[t - 50 - 200 * k, 110 + k] for k in range(n)]           # its long frames (raw ms), the last second
    # Three frames over 40 ms within a second: stopped now, no slowing down first, even while the headset says it's keeping up.
    acts = page.evaluate(WD, [[1000, OK, [{"id": "jenga", "ms": 9, "tris": 700, "slow": froze(1000, 3)}, {"id": "calm", "ms": 0.4, "tris": 1000}]]])
    assert [a[1:] for a in acts] == [["jenga", "stop"]], acts
    # Two in a second (a hiccup) or three spread over 3 s: not a freeze.
    assert page.evaluate(WD, [[1000, OK, [{"id": "a", "ms": 2, "tris": 700, "slow": froze(1000, 2)}]]]) == []
    assert page.evaluate(WD, [[3000, OK, [{"id": "a", "ms": 2, "tris": 700, "slow": [[0, 110], [1400, 110], [2900, 110]]}]]]) == []
    # Several hungry at once: only the hungriest is slowed down and stopped (the others were slow because of it).
    steps = [[t, BAD, [{"id": "jenga", "ms": 17, "tris": 700}, {"id": "golf", "ms": 6.7, "tris": 900}, {"id": "gestures", "ms": 8.1, "tris": 2000}]] for t in range(0, 3600, 100)]
    assert [a[1:] for a in page.evaluate(WD, steps)] == [["jenga", "throttle"], ["jenga", "stop"]]
    # The frame's work is mostly something else (126 ms, an app at 2.6): not that app's fault.
    big = {"fps": 13, "workMs": 126, "budgetMs": 11.1, "target": 90}
    assert page.evaluate(WD, [[t, big, [{"id": "pinball", "ms": 2.6, "tris": 8000}]] for t in range(0, 8000, 100)]) == []


def test_an_app_freezing_the_headset_is_stopped_within_a_second_or_so(page: Page, live_server):
    start_app(page, live_server, "towers", "window.__td?.ctx.td")
    inst = INST.format(app="towers")
    page.wait_for_function(f"performance.now() - {inst}.startedAt > 1600", timeout=5000)   # (past its first moments)
    page.evaluate(f"(() => {{ const i = {inst}, f = i.module.frame; i.module = {{ ...i.module, frame(ctx, dt) {{ const t = performance.now(); while (performance.now() - t < 110); return f.call(this, ctx, dt); }} }}; }})()")
    page.evaluate("""() => { window.__t0 = performance.now(); window.__ok = setInterval(() => window.__app.runtime.noteFrame({ fps: 90, workMs: 5, budgetMs: 11.1, target: 90, dropped: 0 }), 50); }""")
    page.wait_for_function("window.__app.runtime.crashed.get('towers')?.slow", timeout=6000)
    took = page.evaluate("performance.now() - window.__t0")
    page.evaluate("clearInterval(window.__ok)")
    assert took < 2500, took                                                       # (3 frames of 110 ms in the emulator: a few of its slow frames)
    msg = page.evaluate("window.__app.runtime.crashed.get('towers').message")
    assert msg.startswith("Froze the headset") and "ms frames" in msg, msg
    assert page.evaluate(f"!{inst}")


def test_long_frames_are_logged_with_what_the_app_was_doing(page: Page, live_server, telemetry_dir):
    from test_probe import wait_for_rows
    start_app(page, live_server, "jenga", "window.__jenga?.ctx.jenga?.meshes")
    inst = INST.format(app="jenga")
    page.wait_for_function(f"performance.now() - {inst}.startedAt > 1600", timeout=5000)
    page.evaluate("""async () => { const THREE = await import('three'); const j = window.__jenga.ctx.jenga; window.__jenga.claim();
      const t = j.bodies[53].translation(), at = new THREE.Vector3(t.x, t.y, t.z); window.__jenga.grab(53, { clone: () => at.clone() }); }""")   # holding the top block: the physics runs here
    page.wait_for_function("window.__jenga.ctx.jenga.sess?.frames > 3", timeout=8000)
    # A few 33 ms frames (long, not a freeze): logged with its sims and its own debug() state.
    page.evaluate(f"(() => {{ const i = {inst}, f = i.module.frame; let n = 0; i.module = {{ ...i.module, frame(ctx, dt) {{ if (n++ < 2) {{ const t = performance.now(); while (performance.now() - t < 33); }} return f.call(this, ctx, dt); }} }}; }})()")
    [row] = wait_for_rows(telemetry_dir, lambda r: r["msg"] == "app jenga long frame")[-1:]
    d = row["data"]
    assert d["ms"] > 30 and d["state"]["simulating"] and d["state"]["mine"] and "steps" in d["state"], d
    # Let go, all still: it settles, and the session's summary is logged.
    page.evaluate("window.__jenga.drop()")
    [row] = wait_for_rows(telemetry_dir, lambda r: r["msg"].endswith("jenga session"), timeout=12)[-1:]
    s = row["data"]
    assert s["frames"] > 3 and s["steps"] > 0 and s["maxStepMs"] > 0 and "framesOver11ms" in s, s
    # A frame whose own work is long: logged with where its time went.
    page.evaluate("""() => { const r = window.__app.runtime, u = r.update.bind(r); let n = 0;
      r.update = (dt) => { if (n++ < 30) { const t = performance.now(); while (performance.now() - t < 60); } return u(dt); }; }""")
    [row] = wait_for_rows(telemetry_dir, lambda r: r["msg"] == "long frame" and r["data"]["parts"].get("apps", 0) > 50)[-1:]
    assert row["data"]["workMs"] > 50, row
