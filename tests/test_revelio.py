"""Revelio (js/ui/revelio.js, DESIGN.md §8.7): an open hand turned quickly
(right clockwise / left counter-clockwise, as you see it) casts a band that
lights up what *I've* hidden on this device; aim + fingertips together
selects one, spreading shows it again (a per-object exception). Fingertips
together on a visible thing, then opening while turning = shoo (hide it here)."""
from playwright.sync_api import Page

from test_main import TAG_A, create_space, login, open_ar, place, tap
from test_quest import aim, click_menu, open_menu, open_quest, press

# A synthetic right/left hand in front of a head at (0, 1.6, 0): 25 WebXR
# joints, held up like "stop" (fingers +y, index toward +x for the right
# hand), turned `deg` about the eye → hand line (+ = clockwise as seen).
HAND = """(THREE, { side = 'right', deg = 0, shape = 'open', at = [0.1, 1.45, -0.45], face = 'me', r = null } = {}) => {
  const head = new THREE.Vector3(0, 1.6, 0), c = new THREE.Vector3(...at);
  const s = side === 'right' ? 1 : -1, xs = [0.03, 0.01, -0.01, -0.03].map((x) => x * s);
  const j = [new THREE.Vector3(0, -0.06, 0)];
  // thumb: out to the side, tip well away from the index
  for (const [x, y] of [[0.025, -0.045], [0.045, -0.025], [0.06, 0], [0.07, 0.02]]) j.push(new THREE.Vector3(x * s, y, 0));
  for (const x of xs) {
    if (shape === 'open') for (const y of [-0.04, 0.03, 0.07, 0.095, 0.115]) j.push(new THREE.Vector3(x, y, 0));
    else if (shape === 'fist') for (const [y, z] of [[-0.04, 0], [0.03, 0], [0.04, 0.02], [0.02, 0.03], [0.0, 0.03]]) j.push(new THREE.Vector3(x, y, z));
    else for (const [y, z] of [[-0.04, 0], [0.03, 0], [0.06, 0.015], [0.075, 0.03], [0.08, 0.04]]) j.push(new THREE.Vector3(x * 0.3, y, z));
  }
  if (shape === 'bunch') { for (const i of [4, 9, 14, 19, 24]) j[i].set((i % 3 - 1) * 0.006, 0.08, 0.04 + (i % 2) * 0.006); }
  if (shape === 'bunch' && r != null) [4, 9, 14, 19, 24].forEach((i, k) => j[i].set(r * Math.cos(k * 2 * Math.PI / 5), 0.08 + r * Math.sin(k * 2 * Math.PI / 5), 0.04));   // each tip r from their middle
  const v = c.clone().sub(head).normalize(), q = new THREE.Quaternion().setFromAxisAngle(v, deg * Math.PI / 180);
  if (face === 'away') q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));   // palm away from you
  return { joints: j.map((p) => p.applyQuaternion(q).add(c)), head };
}"""

RUN = """async (steps) => {
  const THREE = await import('three');
  const { HandGestures } = await import('/js/ui/revelio.js');
  const hand = (""" + HAND + """);
  const g = new HandGestures(), events = [], gaze = new THREE.Vector3(0, 0, -1);
  for (const [t, side, opts] of steps) {
    const h = opts ? hand(THREE, { side, ...opts }) : null;
    for (const e of g.update(side, h?.joints ?? null, h?.head ?? null, t, gaze)) events.push(e.type);
  }
  return events; }"""


def turn(side, start, end, ms, shape="open", t0=0.0, fps=72, hold=250, after=250, at=None):
    """Held still `hold` ms, turned start → end over `ms`, held `after` ms."""
    n, f = max(2, int(ms / 1000 * fps)), 1000 / fps
    o = {"shape": shape, **({"at": at} if at else {})}
    pre = [[t0 + i * f, side, {**o, "deg": start}] for i in range(int(hold / f))]
    t1 = t0 + hold
    mid = [[t1 + i * ms / (n - 1), side, {**o, "deg": start + (end - start) * i / (n - 1)}] for i in range(n)]
    post = [[t1 + ms + (i + 1) * f, side, {**o, "deg": end}] for i in range(int(after / f))]
    return pre + mid + post


def slide(side, dx, ms, face="away", shape="open", y=1.45, x0=None, fps=72, hold=200, after=200):
    """Held still `hold` ms, slid dx meters sideways over `ms`, held `after` ms."""
    x0 = (0.05 if side == "right" else -0.05) if x0 is None else x0
    n, f = max(2, int(ms / 1000 * fps)), 1000 / fps
    at = lambda x: {"shape": shape, "face": face, "at": [x, y, -0.45]}   # noqa: E731
    pre = [[i * f, side, at(x0)] for i in range(int(hold / f))]
    mid = [[hold + i * ms / (n - 1), side, at(x0 + dx * i / (n - 1))] for i in range(n)]
    post = [[hold + ms + (i + 1) * f, side, at(x0 + dx)] for i in range(int(after / f))]
    return pre + mid + post


def page_ready(page: Page, live_server):
    login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)


def test_cast_is_an_open_hand_palm_away_sliding_sideways(page: Page, live_server):
    page_ready(page, live_server)
    ev = lambda steps: page.evaluate(RUN, steps)   # noqa: E731
    assert "cast" in ev(slide("right", 0.25, 500))                # right hand slides right, palm away
    assert "cast" in ev(slide("left", -0.25, 500))                # left hand slides left
    assert "cast" in ev(slide("right", 0.2, 800))                 # an easy pace counts
    assert "cast" not in ev(slide("right", -0.25, 500))           # the wrong way
    assert "cast" not in ev(slide("right", 0.25, 500, face="me")) # palm toward you
    assert "cast" not in ev(slide("right", 0.25, 60))             # a swat, not a slide
    assert "cast" not in ev(slide("right", 0.15, 2500))           # a drift
    assert "cast" not in ev(slide("right", 0.25, 500, shape="fist"))   # not an open hand
    assert "cast" not in ev(slide("right", 0.25, 500, y=0.9))     # down by your side, out of view
    assert "cast" not in ev(slide("right", 0.08, 400))            # too short


def test_fingertips_together_then_open_and_turn_is_a_shoo(page: Page, live_server):
    page_ready(page, live_server)
    bunch = [[t, "right", {"deg": 0, "shape": "bunch"}] for t in range(0, 400, 14)]
    shoo = page.evaluate(RUN, bunch + turn("right", 0, 70, 250, t0=410, hold=0))
    assert "gather" in shoo and "shoo" in shoo, shoo
    assert "cast" not in shoo, shoo                                # (the same turn mustn't also cast)
    spread = page.evaluate(RUN, bunch + [[410 + t, "right", {"deg": 0}] for t in range(0, 300, 14)])
    assert "spread" in spread and "shoo" not in spread, spread
    quick = page.evaluate(RUN, bunch[:8] + turn("right", 0, 70, 250, t0=120, hold=0))
    assert "shoo" not in quick, quick                              # fingertips barely touched: not deliberate


def _cube_in_space(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    return page.evaluate("[...window.__app.world.objects.keys()][0]")


ROOT = "window.__app.world.objects.get('{}').built.root"


def test_shoo_hides_it_here_and_a_tap_on_its_glow_brings_it_back(page: Page, live_server):
    oid = _cube_in_space(page, live_server)
    assert page.evaluate("window.__app.shooObject(" + repr(oid) + ")")
    assert page.evaluate(f"{ROOT.format(oid)}.visible") is False
    assert oid in page.evaluate("JSON.parse(localStorage.getItem('stratum.hiddenObjects'))")    # remembered on this device
    assert page.evaluate("window.__app.menu.data().hidden") == {"here": 1, "shooed": 1}
    assert page.evaluate("window.__app.menu.castRevelio()") == 1
    page.wait_for_function(f"window.__app.revelio.items.get('{oid}')?.flashAt != null", timeout=3000)   # the band reached it
    assert page.evaluate(f"window.__app.revelio.items.get('{oid}').mesh.visible") is True
    tap(page, 0)                                                   # the same spot it was placed at
    page.wait_for_function(f"{ROOT.format(oid)}.visible", timeout=3000)
    assert page.evaluate("window.__app.world.hiddenObjects.size") == 0
    assert page.evaluate("window.__app.selectedId") is None        # the tap revealed it, nothing else


def test_reveal_one_thing_from_a_hidden_layer_until_the_layer_is_toggled(page: Page, live_server):
    oid = _cube_in_space(page, live_server)
    layer = page.evaluate(f"window.__app.world.objects.get('{oid}').data.layer")
    page.evaluate(f"window.__app.menu.setLayerVisible('{layer}', false)")
    assert page.evaluate("window.__app.myHidden()") == [oid]
    page.evaluate(f"window.__app.menu.setRevealable('{layer}', false)")   # this layer is never revealed
    assert page.evaluate("window.__app.myHidden()") == []
    page.evaluate(f"window.__app.menu.setRevealable('{layer}', true)")
    assert page.evaluate(f"window.__app.revealObject('{oid}')")
    assert page.evaluate(f"{ROOT.format(oid)}.visible") is True    # shown, though its layer is still off
    assert page.evaluate(f"window.__app.world.hiddenLayers.has('{layer}')") is True
    page.evaluate(f"window.__app.menu.setLayerVisible('{layer}', true); window.__app.menu.setLayerVisible('{layer}', false)")
    assert page.evaluate(f"{ROOT.format(oid)}.visible") is False   # toggling the layer ended the exception


def test_quest_trigger_on_a_glow_reveals_it(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    open_menu(page)
    click_menu(page, "Cube")
    aim(page, "right", [0.3, 1.0, -1.0])
    press(page, "right", "trigger")
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    center = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = {ROOT.format(oid)};
      r.updateWorldMatrix(true, true); return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")
    page.evaluate(f"window.__app.shooObject('{oid}')")
    page.evaluate("window.__app.menu.castRevelio()")
    page.wait_for_function(f"window.__app.revelio.items.get('{oid}')?.flashAt != null", timeout=3000)
    aim(page, "right", center)
    page.wait_for_function("window.__app.revelio.cursor.visible", timeout=2000)   # the cursor sits on the glow
    press(page, "right", "trigger")
    page.wait_for_function(f"{ROOT.format(oid)}.visible", timeout=3000)
    assert page.evaluate("window.__app.selectedId") is None
    assert len(page.evaluate("[...window.__app.world.objects.keys()]")) == 1      # (and nothing new was placed)


def test_glows_are_the_things_own_shape_and_apps_can_give_a_lighter_one(page: Page, live_server):
    """The glow is a frozen copy of the object's meshes (geometry shared, one
    color), not a box; an app's revealMesh stand-in is used instead when it has one."""
    oid = _cube_in_space(page, live_server)
    page.evaluate(f"window.__app.shooObject('{oid}')")
    page.evaluate("window.__app.menu.castRevelio()")
    page.wait_for_function(f"window.__app.revelio.items.get('{oid}')?.flashAt != null", timeout=3000)
    r = page.evaluate(f"""(() => {{ const it = window.__app.revelio.items.get('{oid}'), root = window.__app.world.objects.get('{oid}').built.root;
      const real = []; root.traverse(o => {{ if (o.isMesh) real.push(o.geometry); }});
      const ghost = it.mesh.children.filter(m => m.isMesh);
      return {{ ghost: !!it.mesh.userData.ghost, parts: ghost.length, shared: ghost.every(m => real.includes(m.geometry)),
        oneColor: new Set(ghost.filter(m => m.material.colorWrite !== false).map(m => m.material.uuid)).size, textured: ghost.some(m => m.material.map) }}; }})()""")
    assert r["ghost"] and r["parts"] >= 2 and r["shared"] and r["oneColor"] == 1 and not r["textured"], r


def test_fishtank_uses_its_light_stand_in(page: Page, live_server):
    from test_apps_e2e import enable, place_app
    login(page, live_server)
    enable(page, live_server, "fishtank")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "fishtank")
    page.wait_for_function("window.__fish?.ctx.tank?.water", timeout=10000)
    iid = page.evaluate("window.__fish.ctx.instance.id")
    page.evaluate(f"window.__app.shooObject('{iid}')")
    page.evaluate("window.__app.menu.castRevelio()")
    page.wait_for_function(f"window.__app.revelio.items.get('{iid}')?.mesh.userData.ghost", timeout=3000)
    parts = page.evaluate(f"window.__app.revelio.items.get('{iid}').mesh.children.length / 2")
    assert 2 <= parts <= 10, parts                                 # box + sand + ≤ 8 fish, not the whole aquarium


GLOWS = """async (steps) => { const THREE = await import('three'); const { Revelio } = await import('/js/ui/revelio.js');
  const scene = new THREE.Scene(), r = new Revelio(scene), box = new THREE.Box3(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 0.2, 0.1));
  const thing = (x) => { const g = new THREE.Group(); g.position.set(x, 1, -1); scene.add(g); g.updateWorldMatrix(true, true); return g; };
  r.cast(new THREE.Vector3(0, 1.6, 0), [{ id: 'a', root: thing(-0.5), box }, { id: 'b', root: thing(0.5), box }], 0);
  const atA = { side: 'right', origin: new THREE.Vector3(0, 1.6, 0), dir: new THREE.Vector3(-0.5, -0.5, -1).normalize() };
  const out = [];
  for (const [t, aim, reveal] of steps) {
    if (reveal) r.revealed(reveal, t);
    r.update(t, aim ? [atA] : []);
    out.push({ t, a: !!r.items.get('a')?.mesh.visible, b: !!r.items.get('b')?.mesh.visible, active: t < r.until });
  }
  return out; }"""


def test_glows_last_a_few_seconds_and_aiming_holds_only_that_one(page: Page, live_server):
    page.goto(live_server + "/")
    # Nothing aimed at: both glow, then both go (6 s + 1.5 s fade).
    r = page.evaluate(GLOWS, [[3000, False, None], [7000, False, None], [7600, False, None]])
    assert r[0]["a"] and r[0]["b"] and r[1]["a"] and r[1]["b"]
    assert not r[2]["a"] and not r[2]["b"] and not r[2]["active"]
    # Aiming at a: a stays while you aim, b goes on time; never past 20 s.
    steps = [[t, True, None] for t in range(1000, 26000, 500)]
    r = {s["t"]: s for s in page.evaluate(GLOWS, steps)}
    assert r[9000]["a"] and not r[9000]["b"]
    assert r[19000]["a"] and not r[21500]["a"] and not r[21500]["active"]
    # Bringing one back: the others fade right away.
    r = page.evaluate(GLOWS, [[2000, False, None], [2100, False, "a"], [3700, False, None]])
    assert r[1]["b"] and not r[2]["b"] and not r[2]["active"]


def test_shoo_takes_the_thing_the_fingertips_are_on_wherever_the_ray_points(page: Page, live_server):
    """Fingertips together anywhere on an object pick it (not the ray's aim)."""
    oid = _cube_in_space(page, live_server)
    box = page.evaluate(f"""async () => {{ const THREE = await import('three'); const r = {ROOT.format(oid)};
      r.updateWorldMatrix(true, true); const b = new THREE.Box3().setFromObject(r); return [b.min.toArray(), b.max.toArray(), b.getCenter(new THREE.Vector3()).toArray()]; }}""")
    lo, hi, c = box
    assert page.evaluate(f"window.__app.objectAt({c})") == oid                       # in it
    assert page.evaluate(f"window.__app.objectAt({[hi[0] + 0.02, c[1], c[2]]})") == oid   # just off a face (2 cm)
    assert page.evaluate(f"window.__app.objectAt({[lo[0], hi[1], lo[2]]})") == oid         # a corner
    assert page.evaluate(f"window.__app.objectAt({[hi[0] + 0.1, c[1], c[2]]})") is None   # 10 cm away: nothing


def test_phone_revelio_button_counts_hidden_things_and_casts(page: Page, live_server):
    oid = _cube_in_space(page, live_server)
    assert page.is_visible("#ov-revelio")
    assert page.evaluate("window.__app.shooObject(" + repr(oid) + ")")
    page.wait_for_function("document.querySelector('#ov-revelio .n')?.textContent === '1'", timeout=3000)
    page.click("#ov-revelio")
    page.wait_for_function(f"window.__app.revelio.items.get('{oid}')?.flashAt != null", timeout=3000)
    page.click("#ov-revelio")                                       # again: the glows go
    assert page.evaluate("window.__app.revelio.active") is False


def test_phone_logs_where_things_are_after_lining_up(page: Page, live_server):
    page.add_init_script("""window.__checks = []; const spy = () => { const t = window.__telemetry; if (!t) return setTimeout(spy, 50);
      const info = t.info.bind(t); t.info = (msg, data) => { if (msg === 'view check') window.__checks.push(data); return info(msg, data); }; }; spy();""")
    _cube_in_space(page, live_server)
    page.wait_for_function("window.__checks.length >= 1", timeout=8000)    # by itself, 3 s after lining up
    page.click("#ov-revelio")
    page.wait_for_function("window.__checks.length >= 2", timeout=3000)    # and on each Revelio tap
    c = page.evaluate("window.__checks.at(-1)")
    assert c["why"] == "revelio button" and c["spaces"][0]["visible"] is True, c
    t = c["things"][0]
    assert t["built"] and t["vis"] and t["tris"] > 0 and t["m"] < 2 and t["off"] < 60, t


def test_fingertips_count_as_together_within_3_5_cm(page: Page, live_server):
    page_ready(page, live_server)
    near = page.evaluate(RUN, [[t, "right", {"deg": 0, "shape": "bunch", "r": 0.032}] for t in range(0, 400, 14)])
    far = page.evaluate(RUN, [[t, "right", {"deg": 0, "shape": "bunch", "r": 0.038}] for t in range(0, 400, 14)])
    assert "gather" in near, near
    assert "gather" not in far, far
