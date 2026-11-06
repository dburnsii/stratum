"""Pinball (apps/pinball): Rapier table, flippers on presses (phone screen
halves / Quest hands), plunger launch, drain → next ball → game over."""
from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar


def start(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "pinball")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "pinball")
    page.wait_for_function("window.__pinball?.ctx.pinball?.world", timeout=15000)


P = "window.__pinball.ctx.pinball"


def frames(page: Page, n: int):
    """Wait for n more app frames (the emulator draws a few a second on a busy machine)."""
    f0 = page.evaluate("window.__app.runtime.frameNo")
    page.wait_for_function(f"window.__app.runtime.frameNo >= {f0 + n}", timeout=10000)


def sim_until(page: Page, cond: str, seconds: float):
    """Step the table's physics ourselves until cond (JS) holds, up to `seconds` of game
    time: the headless emulator draws a few frames a second, and at 12 steps a frame
    the game runs in slow motion there (wall-clock waits then fail on a slow machine)."""
    ok = page.evaluate(f"""() => {{ for (let i = 0; i < {int(seconds * 240)}; i += 8) {{ if ({cond}) return true; window.__pinball.step(8); }} return !!({cond}); }}""")
    assert ok, f"not within {seconds} s of play: {cond}"


def test_plunger_launches_the_ball_into_play(page: Page, live_server):
    start(page, live_server)
    assert page.evaluate(f"{P}.inLane")
    page.evaluate("window.__pinball.press('right', 'down')")
    page.wait_for_timeout(700)
    page.evaluate("window.__pinball.press('right', 'up')")      # let go: launch
    page.wait_for_function(f"!{P}.inLane", timeout=4000)
    t = page.evaluate(f"{P}.ball.translation()")
    assert t["x"] < 0.16, t                                       # turned out of the shooter lane


def playing(page: Page):
    page.evaluate("window.__pinball.press('right', 'down'); window.__pinball.press('right', 'up')")   # a game starts (weak launch)
    page.wait_for_function(f"{P}.room.mine && !{P}.over", timeout=3000)


def test_flipper_hits_the_ball_up_the_table(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(-0.035, 0.205)")   # resting on the left flipper
    page.wait_for_timeout(150)
    page.evaluate("window.__pinball.press('left', 'down')")
    page.wait_for_timeout(60)
    v = page.evaluate(f"{P}.ball.linvel()")
    page.evaluate("window.__pinball.press('left', 'up')")
    assert v["z"] < -0.6, v                                        # away from the player, fast


def test_bumper_kicks_and_scores(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(-0.06, -0.08, 0, -0.8)")   # rolling at the left bumper
    page.wait_for_function(f"{P}.score >= 100", timeout=3000)


def test_three_drains_end_the_game_and_save_the_best(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.score = 1234; {P}.saveUntil = 0")
    for n in range(3):
        page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.3, 0, 1)")
        sim_until(page, f"{P}.inLane || {P}.over", 3)
        page.wait_for_function(f"!{P}.counting", timeout=4000)
    assert page.evaluate(f"{P}.over")
    page.wait_for_timeout(300)
    best = page.request.get(f"{live_server}/api/apps/pinball/state/best").json()["value"]
    assert best == 1234
    assert "Game over" in page.evaluate("document.getElementById('ov-appbar').textContent")
    assert page.evaluate(f"{P}.top[0].s") == 1234 and not page.evaluate(f"{P}.room.holder")   # on the shared board; machine free


def test_screen_halves_flip_and_taps_are_not_selects(page: Page, live_server):
    """Through the host: a phone touch near the table goes to the game's
    press (left half = left flipper), not to tap-select."""
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.1)")   # in play
    r = page.evaluate("""() => { const rt = window.__app.runtime, src = {};
      const a = rt.press({ phase: 'down', id: src, hit: null, side: 'left', source: 'touch' });
      const held = window.__pinball.ctx.pinball.held.left;
      rt.press({ phase: 'up', id: src });
      return { a, held, after: window.__pinball.ctx.pinball.held.left }; }""")
    assert r == {"a": True, "held": True, "after": False}, r


def test_drop_targets_drop_and_light_the_spinner(page: Page, live_server):
    start(page, live_server)
    playing(page)
    for i, z in enumerate((-0.035, -0.008, 0.019)):
        page.evaluate(f"{P}.inLane = false; window.__pinball.place(0.08, {z}, 1.2, 0)")   # rolling right, into the bank
        page.wait_for_function(f"{P}.show.d[{i}] || {P}.show.spl", timeout=2000)
    assert page.evaluate(f"{P}.show.spl")                                 # all three: spinner lit
    assert page.evaluate(f"{P}.show.bo") >= 3
    page.wait_for_function(f"!{P}.show.d.some(Boolean)", timeout=3000)   # the bank resets


def test_spinner_scores_more_when_lit(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; {P}.score = 0; window.__pinball.place(-0.158, -0.06, 0, -1.5)")   # up the left orbit
    sim_until(page, f"{P}.score >= 30", 3)
    page.evaluate("window.__pinball.step(360)")                                     # 1.5 s of play
    unlit = page.evaluate(f"{P}.score")
    page.evaluate(f"{P}.show.spl = true; {P}.score = 0; {P}.spin.w = 0; window.__pinball.place(-0.158, -0.06, 0, -1.5)")
    page.evaluate("window.__pinball.step(360)")
    assert page.evaluate(f"{P}.score") > unlit * 3, unlit


def test_saucer_holds_kicks_out_and_collects_the_extra_ball(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.show.xb = true; {P}.inLane = false; window.__pinball.place(-0.1, -0.012, 0, 0.3)")
    page.wait_for_function(f"{P}.saucer.until > 0", timeout=2000)
    assert page.evaluate(f"{P}.show.sh") and not page.evaluate(f"{P}.show.xb")
    page.wait_for_function(f"{P}.saucer.until === 0 && Math.hypot({P}.ball.translation().x + 0.1, {P}.ball.translation().z) > 0.05", timeout=3000)
    # The extra ball: draining doesn't use up a ball.
    page.evaluate(f"{P}.saveUntil = 0; {P}.inLane = false; window.__pinball.place(0, 0.3, 0, 1)")
    page.wait_for_function(f"{P}.inLane && !{P}.counting", timeout=3000)
    assert page.evaluate(f"{P}.balls") == 3 and not page.evaluate(f"{P}.show.sh")


def test_ball_save_then_bonus_counts_into_the_score(page: Page, live_server):
    start(page, live_server)
    playing(page)
    sim_until(page, f"{P}.saveUntil > performance.now()", 3)                        # the launched ball left the lane: ball save on
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.3, 0, 1)")       # drains during ball save
    sim_until(page, f"{P}.inLane", 2)
    assert page.evaluate(f"{P}.balls") == 3
    page.evaluate(f"{P}.score = 0; {P}.show.bo = 3; {P}.show.m = 2; {P}.inLane = false; window.__pinball.place(0, 0.3, 0, 1)")
    sim_until(page, f"{P}.inLane", 2)
    page.wait_for_function(f"{P}.balls === 2 && !{P}.counting", timeout=4000)        # (the bonus counts on the clock)
    assert page.evaluate(f"{P}.score") == 3 * 1000 * 3                 # 3 steps at 3×


def test_flippers_change_the_lit_lane(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; {P}.show.l = [true, false, false]; window.__pinball.place(0, 0.1)")
    page.evaluate("window.__pinball.press('right', 'down'); window.__pinball.press('right', 'up')")
    assert page.evaluate(f"{P}.show.l") == [False, True, False]


def test_quest_holding_on_the_cabinet_pulls_the_plunger_not_a_move(page: Page, live_server):
    """The bug: the cabinet sides / front were move handles, so holding the
    plunger while aiming at them picked the machine up."""
    from test_quest import open_quest, aim, press
    login(page, live_server)
    enable(page, live_server, "pinball")
    open_quest(page, live_server)
    page.wait_for_function("window.__app?.runtime.apps.get('pinball')?.enabled", timeout=5000)
    page.evaluate("window.__app.arm('app:pinball')")
    aim(page, "right", [0.0, -0.6, -0.9])
    press(page, "right", "trigger")
    page.wait_for_function(f"{P}?.world", timeout=15000)
    page.evaluate("window.__app.arm(null)")
    page.wait_for_timeout(300)
    front = page.evaluate(f"(() => {{ const k = {P}.knob; k.updateWorldMatrix(true, false); const v = k.getWorldPosition(k.position.clone()); v.y += 0.03; v.x -= 0.1; return v.toArray(); }})()")
    aim(page, "right", front)
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 1)")
    page.wait_for_timeout(1800)                                          # longer than any move hold
    assert page.evaluate(f"!!{P}.charging") and not page.evaluate("window.__app.touch.drag")
    assert page.evaluate("window.__app.moveBox.state") is None
    page.evaluate("window.__xrDevice.controllers.right.updateButtonValue('trigger', 0)")
    page.wait_for_function(f"!{P}.inLane", timeout=3000)                # launched


def _fake_hand(page, side, at, pinch):
    """Stand-in for ctx.hands(): one hand with its index tip / thumb at `at` (local)."""
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const c = window.__pinball.ctx;
      const at = new THREE.Vector3(...{list(at)}), j = Array.from({{ length: 25 }}, () => new THREE.Vector3(5, 5, 5));
      j[9] = at.clone(); j[4] = at.clone().add(new THREE.Vector3({0.005 if pinch else 0.06}, 0, 0)); j[14] = new THREE.Vector3(5, 5, 5);
      const h = {{ joints: j, pinch: j[4].distanceTo(j[9]) }};
      c.hands = () => ({{ left: null, right: null, ['{side}']: h }}); }}""")
    frames(page, 2)   # (hands are read in frame(): let it see this one)


def _local(page, expr):
    return page.evaluate(f"(() => {{ const c = window.__pinball.ctx, o = {expr}; o.updateWorldMatrix(true, false); return c.toLocal(o.getWorldPosition(o.position.clone())).toArray(); }})()")


def test_pinch_the_plunger_knob_and_pull_to_launch(page: Page, live_server):
    start(page, live_server)
    knob = _local(page, f"{P}.knobGrip")
    _fake_hand(page, "right", knob, pinch=True)                           # pinch on the knob: a game starts, it's held
    assert page.evaluate(f"{P}.pull?.by") == "hand" and page.evaluate(f"{P}.room.mine")
    _fake_hand(page, "right", [knob[0], knob[1], knob[2] + 0.05], pinch=True)   # pull it 5 cm toward you
    assert page.evaluate(f"{P}.pull.amt") > 0.75
    _fake_hand(page, "right", [knob[0], knob[1], knob[2] + 0.05], pinch=False)  # let go: launched
    sim_until(page, f"!{P}.inLane", 3)


def test_poke_the_cabinet_buttons_to_flip(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.1)")
    btn = _local(page, f"{P}.buttons.left")
    _fake_hand(page, "left", btn, pinch=False)
    assert page.evaluate(f"{P}.held.left") and not page.evaluate(f"{P}.held.right")
    _fake_hand(page, "left", [btn[0], btn[1], btn[2] + 0.08], pinch=False)   # straight back (sideways left the thumb 2.0 cm away: still a press)
    assert not page.evaluate(f"{P}.held.left")


def test_hands_on_the_rest_of_the_machine_move_it(page: Page, live_server):
    """A hand pinch on the glass isn't the game's (the host's hold moves the
    machine); on the knob or a button it is, and nothing moves."""
    start(page, live_server)
    r = page.evaluate(f"""(() => {{ const p = {P}, m = window.__pinball.ctx.pinball, mod = [...window.__app.runtime.running.values()].find(i => i.app.id === 'pinball').module;
      const ctx = window.__pinball.ctx, glass = p.field.children.find(o => o.isMesh);
      const took = mod.press(ctx, {{ phase: 'down', side: 'right', source: 'hand', object: glass, ray: () => null }});
      const grab = (object) => {{ let no = false; mod.grab(ctx, {{ object, preventDefault() {{ no = true; }} }}); return no; }};
      return {{ took, glass: grab(glass), knob: grab(p.knobGrip), button: grab(p.buttons.left) }}; }})()""")
    assert r == {"took": False, "glass": False, "knob": True, "button": True}, r


def test_layout_a_centered_ball_drains_and_inlanes_flow(page: Page, live_server):
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.saveUntil = 0; {P}.balls = 3")
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.2)")               # dead center, flippers down
    sim_until(page, f"{P}.inLane", 4)                                                  # it went between them, back in the lane
    page.wait_for_function(f"{P}.balls === 2", timeout=4000)                           # (after the bonus count)
    for x in (-0.15, 0.12):                                                            # each inlane, from the top
        page.evaluate(f"{P}.inLane = false; window.__pinball.place({x}, 0.09)")
        sim_until(page, f"{P}.ball.translation().z > 0.2 || {P}.inLane", 4)            # reached the flipper


def _hanging_hand(page, side, btn, flexed, n=2):
    """A hand hanging by the cabinet's side, fingers down (straight) or curled in toward the machine
    (flexed: True / False, or how far curled, 0..1)."""
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const c = window.__pinball.ctx;
      const s = {'-1' if side == 'left' else '1'}, w = new THREE.Vector3(...{list(btn)}).add(new THREE.Vector3(s * 0.05, 0.08, 0));
      const j = [w.clone()];
      for (let k = 0; k < 4; k++) j.push(w.clone().add(new THREE.Vector3(-s * 0.02, -0.03 - k * 0.02, 0.03)));   // thumb
      for (const z of [0.02, 0.007, -0.007, -0.02]) {{
        const meta = w.clone().add(new THREE.Vector3(0, -0.01, z)), prox = w.clone().add(new THREE.Vector3(0, -0.08, z));
        const curl = {float(flexed)}, down = prox.clone().add(new THREE.Vector3(0, -0.07, 0)), inward = prox.clone().add(new THREE.Vector3(-s * 0.045, -0.01, 0));
        const tip = down.clone().lerp(inward, curl);
        j.push(meta, prox, prox.clone().lerp(tip, 0.4), prox.clone().lerp(tip, 0.75), tip);
      }}
      const h = {{ joints: j, pinch: j[4].distanceTo(j[9]), scale: 1 }};
      c.hands = () => ({{ left: null, right: null, ['{side}']: h }}); }}""")
    frames(page, n)   # (hands are read in frame(): let it see this one)


def test_hand_by_a_button_flexing_its_fingers_flips(page: Page, live_server):
    """At the machine with a hand hanging by a side button: curling the fingers
    in holds that flipper; straightening lets go; far from the button, nothing."""
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.1)")
    for side in ("left", "right"):
        btn = _local(page, f"{P}.buttons.{side}")
        _hanging_hand(page, side, btn, flexed=False)
        assert not page.evaluate(f"{P}.held.{side}")
        _hanging_hand(page, side, btn, flexed=True)
        assert page.evaluate(f"{P}.held.{side}"), side
        _hanging_hand(page, side, btn, flexed=False)
        page.wait_for_timeout(200)                                                       # straightened and kept straight: let go
        frames(page, 2)
        assert not page.evaluate(f"{P}.held.{side}")
        _hanging_hand(page, side, [btn[0] + (-0.25 if side == "left" else 0.25), btn[1], btn[2]], flexed=True)
        assert not page.evaluate(f"{P}.held.{side}")


def test_a_held_flip_stays_held_until_you_clearly_straighten(page: Page, live_server):
    """Curl in to press; only a clear straightening, held a moment, lets go:
    half-relaxed fingers, a one-frame tracking blip and the palm drifting a
    little don't (flicker)."""
    start(page, live_server)
    playing(page)
    page.evaluate(f"{P}.inLane = false; window.__pinball.place(0, 0.1)")
    btn = _local(page, f"{P}.buttons.left")
    _hanging_hand(page, "left", btn, flexed=True)
    assert page.evaluate(f"{P}.held.left")
    _hanging_hand(page, "left", btn, flexed=0.72, n=6)                                   # relaxed some: still held
    st = page.evaluate(f"{P}.flexSt.left")
    assert 0.45 < st < 0.75, st                                                          # (between press and let go)
    assert page.evaluate(f"{P}.held.left")
    _hanging_hand(page, "left", btn, flexed=False, n=1)                                  # a one-frame straight blip...
    _hanging_hand(page, "left", btn, flexed=True, n=3)                                   # ...then curled again
    assert page.evaluate(f"{P}.held.left")
    drift = [btn[0] - 0.07, btn[1], btn[2]]                                              # the palm drifts out past 12 cm
    _hanging_hand(page, "left", drift, flexed=True, n=3)
    assert page.evaluate(f"{P}.held.left")
    page.evaluate("window.__pinball.ctx.hands = () => ({ left: null, right: null })")   # tracking drops for a moment
    frames(page, 1)
    gap, held = page.evaluate(f"[performance.now() - {P}.flexLostAt.left, {P}.held.left]")
    assert held or gap >= 250, gap                                                       # (a slow emulator frame may already be past the 250 ms)
    page.wait_for_timeout(300)
    frames(page, 2)
    assert not page.evaluate(f"{P}.held.left")                                           # gone for good: let go
