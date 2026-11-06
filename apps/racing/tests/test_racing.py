"""Mini Cars (apps/racing): Rapier ray-cast vehicle drives, steers, stays on
its wheels against the barriers, counts laps; a second player's car shows up
solid on my track; a race starts for both from one shared start time."""
from playwright.sync_api import Browser, Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

C = "window.__cars.ctx.cars"


def start(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "racing")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "racing")
    page.wait_for_function("window.__cars?.ctx.cars?.world", timeout=15000)


def pos(page):
    return page.evaluate(f"window.__cars.pos()")


def test_car_drives_forward_and_steers(page: Page, live_server):
    start(page, live_server)
    page.wait_for_timeout(500)                                                    # settles on its wheels
    p0 = pos(page)
    assert abs(p0["y"] - 0.04) < 0.03, p0
    page.evaluate("window.__cars.drive(0.8, 0)")
    page.wait_for_function("window.__cars.speed() > 0.5", timeout=4000)          # it goes forward (+x is forward; slow frames: give it time)
    p1 = pos(page)
    page.evaluate("window.__cars.drive(0, 0)")
    yaw0 = page.evaluate(f"{C}.body.rotation()")
    page.evaluate("window.__cars.place(0); window.__cars.drive(0.6, 1)")           # full left lock
    page.wait_for_function(f"Math.abs({C}.body.rotation().y - {yaw0['y']}) > 0.15", timeout=3000)   # turned (slow frames: give it time)
    page.evaluate("window.__cars.drive(0, 0)")
    up = page.evaluate(f"""(() => {{ const q = {C}.body.rotation(); return 1 - 2 * (q.x * q.x + q.z * q.z); }})()""")
    assert up > 0.9, up                                                           # still on its wheels


def test_autopilot_laps_count(page: Page, live_server):
    """The track is drivable all the way round, and laps are counted."""
    start(page, live_server)
    page.evaluate("window.__cars.autopilot(true, 0.6)")
    page.wait_for_function(f"{C}.lap >= 1", timeout=45000)
    page.evaluate("window.__cars.autopilot(false)")
    assert page.evaluate(f"{C}.last") > 1.0
    assert "best" in page.evaluate("document.getElementById('ov-appbar').textContent")
    best = page.request.get(f"{live_server}/api/apps/racing/state/best").json()["value"]
    assert best and best > 1.0


def test_two_players_see_each_other_and_race(page: Page, browser: Browser, live_server):
    from test_sharing_e2e import two_people
    from test_main import place
    eve, ctx2, sid = two_people(page, browser, live_server)
    for p in (page, eve):
        p.evaluate("window.__app.runtime.setEnabled('racing', true)")
    place(page, "app:racing")
    for p in (page, eve):
        p.wait_for_function("window.__cars?.ctx.cars?.world", timeout=15000)
        p.wait_for_function(f"{C}.others.size === 1", timeout=8000)             # each sees the other's car
    # Eve drives: her car moves on my screen too.
    page.wait_for_timeout(1000)                                                   # both settled in their own grid slots
    eve.bring_to_front()                                                          # a background tab gets no frames: no physics
    mine0 = pos(eve)
    eve.evaluate("window.__cars.drive(0.8, 0)")
    eve.wait_for_function(f"""(() => {{ const p = window.__cars.pos({C}.body);
      return Math.abs(p.x - {mine0['x']}) + Math.abs(p.z - {mine0['z']}) > 0.15; }})()""", timeout=5000)   # slow frames: give it time
    eve.evaluate("window.__cars.drive(0, 0)")
    mine1 = pos(eve)
    for _ in range(40):                                                           # coasted to a stop (slow frames: slow motion)
        eve.wait_for_timeout(250)
        p = pos(eve)
        if abs(p["x"] - mine1["x"]) + abs(p["z"] - mine1["z"]) < 0.002:
            break
        mine1 = p
    assert abs(mine1["x"] - mine0["x"]) + abs(mine1["z"] - mine0["z"]) > 0.1, (mine0, mine1)   # she drove
    seen = None
    for _ in range(40):                                                           # her last messages arrive
        seen = page.evaluate(f"window.__cars.pos([...{C}.others.values()][0].body)")
        if abs(seen["x"] - mine1["x"]) + abs(seen["z"] - mine1["z"]) < 0.03:
            break
        page.wait_for_timeout(100)
    assert abs(seen["x"] - mine1["x"]) + abs(seen["z"] - mine1["z"]) < 0.03, (seen, mine1)     # and I see her there
    # I start a race: both get the same start time and are frozen until then.
    page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'racing').actions[0].run()")
    eve.wait_for_function(f"{C}.race", timeout=3000)
    eve.bring_to_front()
    a = page.evaluate(f"{C}.race.start"); b = eve.evaluate(f"{C}.race.start")
    assert a == b
    eve.wait_for_timeout(400)                                                     # settled on the grid
    eve.evaluate(f"{C}.race.start = window.__cars.ctx.now() + 4000")               # (a slow machine may have used up the red lights by now)
    at0 = pos(eve)
    eve.evaluate("window.__cars.drive(1, 0)")
    eve.wait_for_timeout(600)
    at1 = pos(eve)
    assert abs(at1["x"] - at0["x"]) + abs(at1["z"] - at0["z"]) < 0.02, (at0, at1)  # lights still red: full throttle, no go
    eve.evaluate("window.__cars.drive(0, 0)")
    # Two different grid slots.
    pa, pb = pos(page), pos(eve)
    assert abs(pa["x"] - pb["x"]) + abs(pa["z"] - pb["z"]) > 0.05, (pa, pb)
    ctx2.close()


def test_quest_right_trigger_drives(page: Page, live_server):
    from test_quest import open_quest, aim, press
    login(page, live_server)
    enable(page, live_server, "racing")
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('racing')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:racing')")
    aim(page, "right", [0.0, 0.0, -1.2])
    press(page, "right", "trigger")
    page.wait_for_function("window.__cars?.ctx.cars?.world", timeout=15000)
    page.wait_for_timeout(500)
    assert page.evaluate("window.__app.runtime.running.size") >= 1
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(450)                                                    # (not long enough to reach the first bend)
    v = page.evaluate("window.__cars.speed()")
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    assert v > 0.3, v


# Two curled hands (fingertips 4 cm from the wrist) gripping a wheel 36 cm
# wide, 40 cm in front of a viewer looking down -z; `pull` moves both toward
# the viewer (m), `tilt` raises the right hand / lowers the left (m).
WHEEL = """async () => { const THREE = await import('three'); const ctx = window.__cars.ctx;
  const hand = (x, y, z) => { const j = Array.from({ length: 25 }, () => new THREE.Vector3(x, y + 0.04, z)); j[0] = new THREE.Vector3(x, y, z);
    return { joints: j, scale: 1, pinch: 0.05, palm: { position: j[0].clone(), quaternion: new THREE.Quaternion() } }; };
  window.__grip = { pull: 0, tilt: 0, at: [0, 0] };   // at: where you stand, moved from the track's edge (m)
  ctx.viewer = () => ({ position: new THREE.Vector3(window.__grip.at[0], 0.5, 0.9 + window.__grip.at[1]), quaternion: new THREE.Quaternion() });
  ctx.hands = () => { const { pull, tilt, at } = window.__grip, z = 0.5 + pull + at[1];
    return { left: hand(-0.18 + at[0], 0.3 - tilt, z), right: hand(0.18 + at[0], 0.3 + tilt, z) }; }; }"""


def test_hands_on_the_wheel_pull_to_go_push_to_reverse(page: Page, live_server):
    """Hands held like a wheel bring one up between them; pulling it toward
    you is gas, pushing partway brakes (never reverses), all the way reverses;
    raising the right hand steers left."""
    start(page, live_server)
    page.evaluate(WHEEL)
    page.wait_for_function(f"{C}.wheel.on && {C}.wheel.mesh.visible", timeout=3000)
    assert page.evaluate(f"{C}.input.throttle") == 0                   # where you took it: coasting
    page.evaluate("window.__grip.pull = 0.1")
    page.wait_for_function("window.__cars.speed() > 0.3", timeout=3000)
    i = page.evaluate(f"{C}.input")
    assert 0.6 < i["throttle"] <= 1 and page.evaluate(f"{C}.wheel.gear") == "D", i
    page.evaluate("window.__grip.tilt = 0.08")
    page.wait_for_timeout(100)
    assert page.evaluate(f"{C}.input.steer") > 0.5
    page.evaluate("window.__grip.tilt = 0; window.__grip.pull = -0.07")   # push partway: brake to a stop, stay stopped
    page.wait_for_function("Math.abs(window.__cars.speed()) < 0.05", timeout=4000)
    page.wait_for_timeout(500)
    assert page.evaluate(f"{C}.wheel.gear") == "B" and page.evaluate("window.__cars.speed()") > -0.05
    page.evaluate("window.__grip.pull = -0.16")                          # all the way: reverse
    page.wait_for_function("window.__cars.speed() < -0.1", timeout=3000)
    assert page.evaluate(f"{C}.wheel.gear") == "R"


def test_the_wheel_is_only_for_someone_at_the_track(page: Page, live_server):
    """Hands like a wheel in the next room don't bring it up; walking away drops it."""
    start(page, live_server)
    page.evaluate(WHEEL)
    page.evaluate("window.__grip.at = [0, 5]")                              # 5 m past the track: another room
    page.wait_for_timeout(700)
    assert page.evaluate(f"{C}.wheel.on") is False and page.evaluate(f"{C}.wheel.mesh.visible") is False
    page.evaluate("window.__grip.at = [0, 0]")                              # back at the track
    page.wait_for_function(f"{C}.wheel.on", timeout=3000)
    page.evaluate("window.__grip.at = [0, 1.8]")                            # a step back while driving: still yours
    page.wait_for_timeout(600)
    assert page.evaluate(f"{C}.wheel.on") is True
    page.evaluate("window.__grip.at = [0, 4]")                              # walked off: it lets go
    page.wait_for_function(f"!{C}.wheel.on", timeout=3000)


def test_open_hands_dont_take_the_wheel(page: Page, live_server):
    start(page, live_server)
    page.evaluate(WHEEL)
    page.evaluate("""(() => { const ctx = window.__cars.ctx, h = ctx.hands;
      ctx.hands = () => { const o = h(); for (const s of ['left', 'right']) for (const i of [9, 14, 19]) o[s].joints[i].y += 0.15; return o; }; })()""")
    page.wait_for_timeout(600)
    assert page.evaluate(f"{C}.wheel.on") is False
    assert page.evaluate(f"{C}.wheel.mesh.visible") is False


def test_poking_the_reset_button_puts_the_car_back_on_track(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"{C}.body.setTranslation({{ x: 0, y: 0.5, z: 0 }}, true)")          # somewhere off the road (the infield)
    at = page.evaluate(f"""(() => {{ const c = {C}, p = c.resetBtn.getWorldPosition(c.resetBtn.position.clone()); return window.__cars.ctx.toLocal(p).toArray(); }})()""")
    page.evaluate("""async (at) => { const THREE = await import('three'); const ctx = window.__cars.ctx;
      const j = Array.from({ length: 25 }, () => new THREE.Vector3(9, 9, 9)); j[9] = new THREE.Vector3(...at);
      ctx.hands = () => ({ left: null, right: { joints: j, scale: 1, pinch: 0.1, palm: { position: j[0], quaternion: new THREE.Quaternion() } } }); }""", at)
    page.wait_for_function(f"{C}.resetAt", timeout=2000)
    page.evaluate("window.__cars.ctx.hands = () => null")
    p = pos(page)
    assert abs(p["y"]) < 0.1 and (p["x"] ** 2 + p["z"] ** 2) ** 0.5 > 0.3, p             # on the track again


def test_stuck_against_a_wall_comes_back_by_itself(page: Page, live_server):
    start(page, live_server)
    page.evaluate("window.__cars.drive(-1, 0)")                                          # backs into the barrier behind the grid
    page.wait_for_function(f"{C}.wedgedSince != null", timeout=8000)   # (it scrapes along the barrier first)
    page.wait_for_function(f"{C}.wedgedSince == null", timeout=4000)                     # rescued
    # …and it drives again (it used to sit frozen: Rapier had put the chassis to sleep).
    page.wait_for_timeout(1500)
    p0 = pos(page)
    page.wait_for_function(f"(() => {{ const t = {C}.body.translation(); return Math.hypot(t.x / 6 - {p0['x']}, t.z / 6 - {p0['z']}) > 0.03; }})()", timeout=4000)
    page.evaluate("window.__cars.drive(null)")


def test_wheel_dropped_briefly_keeps_its_neutral_spot(page: Page, live_server):
    """A tracking drop while pushed out (reverse) must not make the pushed
    spot the new neutral (the bug: reverse never engaged on the headset)."""
    start(page, live_server)
    page.evaluate(WHEEL)
    page.wait_for_function(f"{C}.wheel.on", timeout=3000)
    page.evaluate("window.__grip.pull = -0.16")
    page.wait_for_function(f"{C}.wheel.gear === 'R'", timeout=2000)
    page.evaluate("(() => { const ctx = window.__cars.ctx, h = ctx.hands; window.__h = h; ctx.hands = () => null; })()")
    page.wait_for_function(f"!{C}.wheel.on", timeout=2000)
    page.evaluate("window.__cars.ctx.hands = window.__h")
    page.wait_for_function(f"{C}.wheel.on", timeout=2000)
    page.wait_for_timeout(100)
    assert page.evaluate(f"{C}.wheel.gear") == "R"
