"""Little Plane (apps/plane): a toy taildragger flown by a flat hand (tilt,
roll, turn; thumb = throttle), with a slow flight model, wheels, landings and
crashes, and everyone's planes shared."""
import math

from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

P = "window.__plane"
S = "window.__plane.state()"


def start(page: Page, live_server):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    login(page, live_server)
    enable(page, live_server, "plane")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "plane")
    page.wait_for_function(f"{P}?.ctx.plane?.body", timeout=15000)
    page.evaluate(f"{P}.ctx.plane.acc = -1e9")   # (the frame loop stops stepping: tests step by hand)
    return errors


def fly(page, seconds, every=0.25):
    out = []
    for _ in range(int(seconds / every)):
        page.evaluate(f"{P}.step({int(every * 240)})")
        out.append(page.evaluate(S))
    return out


# A synthetic hand held out flat: window.__fh = { side, pitch, roll, yaw (from where you look), thumb (rad from
# the fingers), palmUp, curl, look (watch the plane: default; false = look straight ahead, -z), dx (wrist nudge, m) }.
HAND = """async () => { const THREE = await import('three'); const ctx = window.__plane.ctx;
  window.__fh = { side: 'right', pitch: 0, roll: 0, yaw: 0, thumb: 0.2, palmUp: false, curl: false, on: true, look: true, dx: 0 };
  const eye = new THREE.Vector3(0, 0.6, 0.9);
  const view = () => { const q = new THREE.Quaternion();
    const at = window.__fh.look === 'runway' ? new THREE.Vector3() : ctx.plane.body.p;
    if (window.__fh.look) q.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, at, new THREE.Vector3(0, 1, 0)));
    return { position: eye.clone(), quaternion: q }; };
  ctx.viewer = view;
  ctx.hands = () => { const h = window.__fh; if (!h.on) return null;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(view().quaternion), head = Math.atan2(look.x, -look.z), yaw = h.yaw + head;
    const f = new THREE.Vector3(Math.sin(yaw) * Math.cos(h.pitch), Math.sin(h.pitch), -Math.cos(yaw) * Math.cos(h.pitch));
    const r0 = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw)), u0 = r0.clone().cross(f);
    let r = r0.clone().multiplyScalar(Math.cos(h.roll)).addScaledVector(u0, -Math.sin(h.roll));
    if (h.palmUp) r.negate();
    const s = h.side === 'right' ? -1 : 1, W = eye.clone().add(new THREE.Vector3((h.side === 'right' ? 0.15 : -0.15) + h.dx, -0.3, -0.3));
    const at = (fw, lat) => W.clone().addScaledVector(f, fw).addScaledVector(r, s * lat);
    const j = Array.from({ length: 25 }, () => W.clone());
    const len = h.curl ? 0.25 : 1;
    [[5, 0.03, 0.02, 0.09, 0.022, 0.08], [10, 0.03, 0.0, 0.092, 0.0, 0.09], [15, 0.03, -0.012, 0.088, -0.012, 0.085], [20, 0.03, -0.025, 0.08, -0.03, 0.065]]
      .forEach(([i, mf, ml, kf, kl, fl]) => { j[i] = at(mf, ml); j[i + 1] = at(kf, kl); for (let k = 1; k <= 3; k++) j[i + 1 + k] = at(kf + fl * len * k / 3, kl); });
    j[1] = at(0.02, 0.025); j[2] = at(0.045, 0.04);
    const td = f.clone().multiplyScalar(Math.cos(h.thumb)).addScaledVector(r, s * Math.sin(h.thumb));
    j[3] = j[2].clone().addScaledVector(td, 0.03); j[4] = j[2].clone().addScaledVector(td, 0.06);
    const hand = { joints: j, scale: 1, pinch: j[4].distanceTo(j[9]), palm: { position: W.clone(), quaternion: new THREE.Quaternion() } };
    return h.side === 'right' ? { left: null, right: hand } : { left: hand, right: null }; }; }"""


def fh(page, **kw):
    page.evaluate("(o) => Object.assign(window.__fh, o)", kw)


def test_the_plane_model_has_its_moving_parts(page: Page, live_server):
    errors = start(page, live_server)
    m = page.evaluate(f"""(() => {{ const p = {P}.ctx.plane.plane; let tris = 0, meshes = 0;
      p.group.traverse(n => {{ if (n.isMesh) {{ meshes++; const g = n.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (n.isInstancedMesh ? n.count : 1); }} }});
      const before = [p.parts.aileronR.rotation.x, p.parts.elevator.rotation.x, p.parts.rudder.rotation.y];
      p.set({{ ail: 1, elev: 1, rud: 1, rpm: 1, dt: 0.1 }});
      return {{ tris, meshes, span: p.dims.span, len: p.dims.length, before, after: [p.parts.aileronR.rotation.x, p.parts.aileronL.rotation.x, p.parts.elevator.rotation.x, p.parts.rudder.rotation.y],
        blur: p.parts.blur.material.opacity, wheels: p.parts.wheels.length, lights: !!(p.parts.navL && p.parts.navR && p.parts.beacon) }}; }})()""")
    assert 0.3 < m["span"] < 0.45 and m["len"] == 0.24, m
    assert m["wheels"] == 2 and m["lights"], m
    assert all(abs(x) < 0.1 for x in m["before"]), m
    ar, al, el, ru = m["after"]
    assert ar < -0.3 and al > 0.3 and el < -0.3 and ru > 0.3, m          # right aileron up, left down; elevator up; rudder right
    assert m["blur"] > 0.5                                                 # a spinning prop is a blur disc
    assert 2000 < m["tris"] < 80000, m                                     # detailed, still light
    assert not errors, errors


def test_it_sits_still_then_takes_off_with_full_power(page: Page, live_server):
    start(page, live_server)
    s0 = page.evaluate(S)
    assert s0["ground"] and s0["contacts"] == 3                            # mains + tailwheel, nose up
    assert 0.15 < s0["pitch"] < 0.3, s0["pitch"]
    s = fly(page, 3)[-1]
    assert s["contacts"] == 3 and abs(s["p"][0] - s0["p"][0]) < 0.01 and not s["crashed"], s   # brakes on, engine off: parked
    page.evaluate(f"{P}.override({{ thr: 1, elev: 0, ail: 0, rud: 0, brake: 0 }})")
    path = fly(page, 3, 0.1)
    lift = next(x for x in path if not x["ground"])
    assert lift["p"][0] < 0.45, lift["p"]                                  # off the ground before the runway ends
    assert path[-1]["p"][1] > 0.15 and not path[-1]["crashed"], path[-1]  # climbing away
    assert 0.6 < path[-1]["speed"] < 1.2, path[-1]["speed"]                # slow: fine indoors


def test_the_autopilot_flies_a_steady_circuit(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"{P}.autopilot(true)")
    path = fly(page, 30, 0.5)
    late = path[20:]
    assert not any(x["crashed"] for x in path)
    assert all(0.55 < x["p"][1] < 0.85 for x in late), [round(x["p"][1], 2) for x in late]
    assert all(0.55 < x["speed"] < 1.05 for x in late), [round(x["speed"], 2) for x in late]
    xs, zs = [x["p"][0] for x in late], [x["p"][2] for x in late]
    assert max(xs) - min(xs) > 1.2 and max(zs) - min(zs) > 1.2            # round and round, about 2 m across
    assert max(abs(v) for v in xs + zs) < 2.5


def test_a_flat_hand_takes_the_plane_and_its_angles_are_the_controls(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"{P}.freeze(true)")                                    # parked: just the controls
    page.evaluate(HAND)
    fh(page, palmUp=True)
    fly(page, 1)
    assert page.evaluate(f"{P}.hand().on") is False                       # palm up: not flying
    fh(page, palmUp=False, curl=True)
    fly(page, 1)
    assert page.evaluate(f"{P}.hand().on") is False                       # a fist: not flying
    fh(page, curl=False, pitch=0.15, thumb=0.2, look=False)                # flat, but looking away from the plane
    fly(page, 4)
    assert page.evaluate(f"{P}.hand().on") is False
    assert "Look at the plane" in page.evaluate(f"{P}.ctx.plane.hud.sig")
    fh(page, look=True)                                                    # looking at it, flat (a little nose-up), thumb tucked
    fly(page, 2)
    assert page.evaluate(f"{P}.hand().on") is False                       # 2 s: not yet
    assert "Hold still" in page.evaluate(f"{P}.ctx.plane.hud.sig")
    fh(page, dx=0.06)                                                      # the hand moved: the count starts over
    fly(page, 2)
    assert page.evaluate(f"{P}.hand().on") is False
    fly(page, 1.5)                                                         # held still 3 s (fly() runs whole 0.25 s chunks)
    h = page.evaluate(f"{P}.hand()")
    assert h["on"] and h["side"] == "right" and abs(h["neutral"]["pitch"] - 0.15) < 0.02, h
    i = page.evaluate(f"{P}.input()")
    assert i["thr"] > 0.9 and abs(i["elev"]) < 0.05 and abs(i["ail"]) < 0.05 and i["brake"] == 0, i
    fh(page, pitch=0.15 + 0.35)                                            # fingers up: climb
    fly(page, 0.25)
    assert page.evaluate(f"{P}.input().elev") > 0.4
    fh(page, pitch=0.15 - 0.35)                                            # down: dive
    fly(page, 0.25)
    assert page.evaluate(f"{P}.input().elev") < -0.4
    fh(page, pitch=0.15, roll=0.35)                                        # roll right
    fly(page, 0.25)
    assert page.evaluate(f"{P}.input().ail") > 0.4
    fh(page, roll=-0.35)
    fly(page, 0.25)
    assert page.evaluate(f"{P}.input().ail") < -0.4
    fh(page, roll=0, yaw=0.4)                                              # turned: no rudder any more (three controls)
    fly(page, 0.25)
    assert abs(page.evaluate(f"{P}.input().rud")) < 0.05
    fh(page, yaw=0, roll=0.35)                                             # on the ground, rolling the hand steers (the tailwheel)
    fly(page, 0.25)
    assert abs(page.evaluate(f"{P}.input().rud")) > 0.2
    fh(page, roll=0)
    fh(page, yaw=0, thumb=0.7)                                             # thumb halfway out: some power
    fly(page, 0.5)
    t = page.evaluate(f"{P}.input().thr")
    assert 0.2 < t < 0.8, t
    fh(page, thumb=1.4)                                                    # stuck out: engine off, brakes
    fly(page, 0.75)
    i = page.evaluate(f"{P}.input()")
    assert i["thr"] == 0 and i["brake"] == 1, i
    fh(page, on=False)                                                     # hand gone: let go
    fly(page, 0.75)
    assert page.evaluate(f"{P}.hand().on") is False


def test_bank_with_the_hand_to_turn(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"{P}.set({{ p: new {P}.ctx.THREE.Vector3(0, 0.7, 0), v: new {P}.ctx.THREE.Vector3(0.75, 0, 0), ground: false }})")
    page.evaluate(HAND)
    fh(page, thumb=0.45)
    fly(page, 3.3)                                                         # (watching it, hand still: it's yours after 3 s)
    assert page.evaluate(f"{P}.hand().on")
    y0 = page.evaluate(S)["yaw"]
    fh(page, roll=0.45)                                                    # bank right
    path = fly(page, 2, 0.25)
    assert -0.75 < path[-1]["roll"] < -0.4, path[-1]["roll"]               # leans as far as the hand (easy flying; Euler roll: left +)
    turned = (path[-1]["yaw"] - y0 + math.pi) % (2 * math.pi) - math.pi
    assert turned < -0.4, (y0, path[-1]["yaw"])                            # heading swung right (yaw: left +)
    fh(page, roll=0)
    path = fly(page, 1.5, 0.25)
    assert abs(path[-1]["roll"]) < 0.1, path[-1]["roll"]                   # hand level: wings level
    assert not path[-1]["crashed"]


def test_soft_landings_roll_hard_ones_crash_and_it_comes_back(page: Page, live_server):
    start(page, live_server)
    V = f"{P}.ctx.THREE.Vector3"
    land = f"""(vs) => {{ const b = {P}.ctx.plane.body; b.p.set(-0.2, 0.08, 0); b.v.set(0.6, -vs, 0); b.ground = false; {P}.ctx.plane.airborneAt = -10; }}"""
    page.evaluate(f"{P}.override({{ thr: 0, elev: 0.3, ail: 0, rud: 0, brake: 0 }})")
    page.evaluate(land, 0.25)
    path = fly(page, 1.5, 0.1)
    assert any(x["ground"] for x in path) and not any(x["crashed"] for x in path), path[-1]
    page.evaluate(f"{P}.override({{ thr: 0, elev: 0.3, ail: 0, rud: 0, brake: 1 }})")
    page.evaluate(land, 1.6)
    path = fly(page, 0.5, 0.05)
    hit = next(x for x in path if x["crashed"])
    assert hit["why"] == "landed too hard", hit
    after = fly(page, 2.5)[-1]
    assert not after["crashed"] and after["ground"] and abs(after["p"][0] + 0.28) < 0.02, after   # back at the start of the runway
    void = V


def test_walls_crash_it_and_tables_are_ground(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"""(() => {{ const THREE = {P}.ctx.THREE, ctx = {P}.ctx;
      const wall = new THREE.Matrix4().compose(new THREE.Vector3(1.2, 0.5, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(1, 1, 1));
      const table = new THREE.Matrix4().makeTranslation(0, 0.3, -1.2);
      ctx.surfaces = () => [{{ id: 'w', kind: 'wall', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], matrix: wall }},
                            {{ id: 't', kind: 'table', polygon: [[-0.4, -0.3], [0.4, -0.3], [0.4, 0.3], [-0.4, 0.3]], matrix: table }}];
      return {P}.surfaces(); }})()""")
    assert abs(page.evaluate(f"{P}.groundAt(0, 0.5, -1.2)") - 0.3) < 1e-6   # over the table: its top is the ground
    assert page.evaluate(f"{P}.groundAt(0, 0.2, -1.2)") < 0.3              # under it: it isn't
    page.evaluate(f"{P}.override({{ thr: 0.6, elev: 0, ail: 0, rud: 0, brake: 0 }})")
    page.evaluate(f"(() => {{ const b = {P}.ctx.plane.body; b.p.set(0.3, 0.5, 0); b.v.set(0.8, 0, 0); b.ground = false; }})()")
    path = fly(page, 2, 0.1)
    hit = next((x for x in path if x["crashed"]), None)
    assert hit and hit["why"] == "hit the wall" and hit["p"][0] < 1.25, hit


def test_others_see_my_plane(page: Page, browser, live_server):
    from test_main import place
    from test_sharing_e2e import two_people
    eve, ctx2, sid = two_people(page, browser, live_server)
    for p in (page, eve):
        p.evaluate("window.__app.runtime.setEnabled('plane', true)")
    place(page, "app:plane")
    for p in (page, eve):
        p.wait_for_function(f"{P}?.ctx.plane?.body", timeout=15000)
    page.evaluate(f"{P}.autopilot(true)")
    eve.wait_for_function(f"{P}.ctx.plane.others.size === 1", timeout=8000)
    page.wait_for_function(f"{P}.state().p[1] > 0.2", timeout=15000)       # (page flies in real time)
    page.wait_for_timeout(500)
    mine = page.evaluate(S)["p"]
    theirs = eve.evaluate(f"[...{P}.ctx.plane.others.values()][0].tp.toArray()")
    assert max(abs(a - b) for a, b in zip(mine, theirs)) < 0.4, (mine, theirs)   # eve sees it where it is (within a send or two)
    assert eve.evaluate(f"{P}.ctx.plane.body.ground")                      # and eve's own is still parked
    ctx2.close()


def test_a_hand_tilted_down_when_it_takes_the_plane_can_still_dive(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"{P}.freeze(true)")
    page.evaluate(HAND)
    fh(page, pitch=-0.41, thumb=0.2)                                       # (as in the log: taken with the fingers well down)
    fly(page, 3.5)
    h = page.evaluate(f"{P}.hand()")
    assert h["on"] and abs(h["neutral"]["pitch"] + 0.25) < 0.01, h          # "level" kept within ±0.25 rad
    fh(page, pitch=-0.25 - 0.35)
    fly(page, 0.25)
    assert page.evaluate(f"{P}.input().elev") < -0.4                       # a dive is in reach


def test_after_a_crash_it_waits_for_a_flat_hand_looking_at_the_runway(page: Page, live_server):
    start(page, live_server)
    page.evaluate(HAND)
    page.evaluate(f"{P}.ctx.device = 'quest'")                            # (a headset: bringing it back is on purpose)
    fh(page, on=False)
    page.evaluate(f"""(() => {{ const THREE = {P}.ctx.THREE, ctx = {P}.ctx;
      const wall = new THREE.Matrix4().compose(new THREE.Vector3(1.2, 0.5, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), new THREE.Vector3(1, 1, 1));
      ctx.surfaces = () => [{{ id: 'w', kind: 'wall', polygon: [[-2, -2], [2, -2], [2, 2], [-2, 2]], matrix: wall }}];
      {P}.surfaces(); {P}.override({{ thr: 0.8, elev: 0, ail: 0, rud: 0, brake: 0 }});
      const b = ctx.plane.body; b.p.set(0.3, 0.5, 0); b.v.set(0.8, 0, 0); b.ground = false; }})()""")   # flown into a wall, under power
    fly(page, 2)
    assert page.evaluate(S)["crashed"]
    page.evaluate(f"{P}.override(null)")
    fly(page, 3)
    s = page.evaluate(S)
    assert s["crashed"] and s["down"], s                                   # hands out of view: the wreck waits (no respawn loop)
    assert page.evaluate(f"{P}.input().thr") == 0
    fh(page, on=True, look=False)                                          # flat, but looking straight ahead
    fly(page, 2)
    assert page.evaluate(S)["crashed"]
    fh(page, look="runway")                                                # flat, looking at the runway: back
    fly(page, 1)
    s = page.evaluate(S)
    assert not s["crashed"] and s["ground"] and abs(s["p"][0] + 0.28) < 0.02, s
    assert page.evaluate(f"{P}.hand().on") is False                        # (taking it is still look + 3 s still)
    fly(page, 2)
    assert page.evaluate(S)["ground"] and abs(page.evaluate(S)["p"][0] + 0.28) < 0.02   # and it doesn't fly off on old throttle


def test_a_floor_mapped_facing_down_is_ground_not_a_wall(page: Page, live_server):
    """The log: parked on the runway, it 'hit the floor' every respawn (the map's floor plane faced down)."""
    start(page, live_server)
    page.evaluate(f"""(() => {{ const THREE = {P}.ctx.THREE, ctx = {P}.ctx;
      const floor = new THREE.Matrix4().compose(new THREE.Vector3(0, 0.01, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI), new THREE.Vector3(1, 1, 1));
      ctx.surfaces = () => [{{ id: 'f', kind: 'floor', polygon: [[-3, -3], [3, -3], [3, 3], [-3, 3]], matrix: floor }}];
      return {P}.surfaces(); }})()""")
    path = fly(page, 2, 0.25)
    assert not any(x["crashed"] for x in path), path[-1]
    assert abs(page.evaluate(f"{P}.groundAt(1.5, 0.5, 1.5)") - 0.01) < 1e-3   # its top is the ground there

