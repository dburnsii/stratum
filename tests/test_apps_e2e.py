"""Apps end to end on an emulated phone, against the real golf and fishtank
backends (started by conftest)."""
import json

from playwright.sync_api import Page

from test_main import TAG_A, login, open_ar, create_space, tap, place, pointer


def enable(page: Page, base: str, app: str):
    r = page.request.put(f"{base}/api/apps/{app}", data=json.dumps({"enabled": True}), headers={"content-type": "application/json"})
    assert r.ok
    return r.json()["layer"]


def place_app(page: Page, app: str, pitch=0):
    page.wait_for_function(f"window.__app?.runtime.apps.get('{app}')?.enabled", timeout=5000)
    place(page, f"app:{app}", pitch)


def appbar(page: Page):
    return page.evaluate("document.getElementById('ov-appbar').textContent")


# ---- golf -------------------------------------------------------------------------

def start_golf(page, live_server):
    login(page, live_server)
    layer = enable(page, live_server, "golf")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "golf")
    page.wait_for_function("window.__golf?.ctx.golf?.world", timeout=15000)   # Rapier loaded, hole built
    return layer


def test_golf_instance_goes_in_the_shared_layer_and_shows_status(page: Page, live_server):
    layer = start_golf(page, live_server)
    inst = page.evaluate("[...window.__app.world.objects.values()].find(e => e.data.components.app).data")
    shared = page.evaluate(f"window.__app.world.spaces.get('{inst['space']}').sharedLayer")
    assert inst["layer"] == shared and inst["components"]["app"]["app"] == "golf"   # default: shared with the space
    # "Share new things" off → the app's private layer.
    page.evaluate("localStorage.setItem('stratum.placeShared', '0')")
    place_app(page, "golf", pitch=-20)
    page.wait_for_function("[...window.__app.world.objects.values()].filter(e => e.data.components.app && e.data.rev).length === 2", timeout=5000)
    layers = page.evaluate("[...window.__app.world.objects.values()].filter(e => e.data.components.app).map(e => e.data.layer)")
    assert sorted(layers) == sorted([shared, layer])
    page.wait_for_function("document.getElementById('ov-appbar').textContent.includes('Straight Shot')", timeout=5000)
    assert "Reset" in appbar(page) and "Next hole" in appbar(page)


def test_golf_putt_sinks_and_posts_score(page: Page, live_server):
    start_golf(page, live_server)
    page.evaluate("window.__golf.place(0, -0.14); window.__golf.shoot(0, -0.35)")
    page.wait_for_function("window.__golf.ctx.golf.sunk", timeout=8000)
    page.wait_for_function("window.__golf.ctx.golf.board.some(r => r.me && r.best === 1)", timeout=5000)
    assert "Hole in one" in appbar(page)
    page.wait_for_timeout(2500)
    assert page.evaluate("window.__golf.ctx.golf.course.id") == 1                   # no automatic next hole...
    card = page.evaluate("window.__golf.ctx.golf.card")
    assert [r["h"]["0"] for r in card.values()] == [1]                              # ...my stroke on the card
    page.evaluate("window.__golf.next()")                                           # ...the Next hole button
    page.wait_for_function("window.__golf.ctx.golf.course.id === 2", timeout=8000)


def test_new_holes_have_moving_obstacles_in_step_everywhere(page: Page, live_server):
    start_golf(page, live_server)
    names = page.evaluate("window.__golf.ctx.golf.courses.map(c => c.name)")
    assert names[3:] == ["Windmill", "Rush Hour", "Pachinko"], names
    page.evaluate("window.__golf.go(3)")
    page.wait_for_function("window.__golf.ctx.golf.course?.id === 4 && !window.__golf.ctx.golf.loading", timeout=8000)
    a = page.evaluate("window.__golf.ctx.golf.movers[0].mesh.quaternion.toArray()")
    page.wait_for_timeout(500)
    b = page.evaluate("window.__golf.ctx.golf.movers[0].mesh.quaternion.toArray()")
    assert a != b                                                                    # the windmill turns
    # Its pose comes from the shared clock: same answer from the formula.
    same = page.evaluate("""() => { const g = window.__golf.ctx.golf, m = g.movers[0];
      const q = m.at(window.__golf.ctx.now() / 1000).q; return m.mesh.quaternion.angleTo(q) < 0.15; }""")
    assert same
    # A blade blocks the gap now and then: a putt straight up the middle bounces back at least once in a few tries.
    page.evaluate("window.__golf.go(4)")
    page.wait_for_function("window.__golf.ctx.golf.course?.id === 5 && !window.__golf.ctx.golf.loading", timeout=8000)
    assert len(page.evaluate("window.__golf.ctx.golf.movers.map(m => 1)")) == 3      # three sliders
    page.evaluate("window.__golf.go(5)")
    page.wait_for_function("window.__golf.ctx.golf.course?.id === 6 && !window.__golf.ctx.golf.loading", timeout=8000)
    page.evaluate("window.__golf.place(-0.03, 0.2); window.__golf.shoot(0, -0.9)")    # into the bumpers, a little off-center
    page.wait_for_function("!window.__golf.ctx.golf.moving", timeout=15000)
    end = page.evaluate("window.__golf.ctx.golf.ball.translation()")
    assert abs(end["x"] + 0.03) > 0.01, end                                           # knocked off its line


def test_golf_ball_rolls_stops_and_counts_strokes(page: Page, live_server):
    start_golf(page, live_server)
    start = page.evaluate("window.__golf.ctx.golf.ball.translation()")
    page.evaluate("window.__golf.shoot(0.0, -0.4)")
    page.wait_for_function("!window.__golf.ctx.golf.moving", timeout=10000)
    end = page.evaluate("window.__golf.ctx.golf.ball.translation()")
    assert end["z"] < start["z"] - 0.1 and abs(end["y"] - 0.009) < 0.003   # rolled forward, on the green
    assert page.evaluate("window.__golf.ctx.golf.strokes") == 1


def test_golf_swipe_putts_and_does_not_place_objects(page: Page, live_server):
    start_golf(page, live_server)
    n_objects = page.evaluate("window.__app.world.objects.size")
    page.evaluate("""() => {
      const el = document.getElementById('overlay');
      const ev = (type, x, y) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
      ev('pointerdown', 200, 500); ev('pointermove', 200, 420); ev('pointermove', 200, 300); ev('pointerup', 200, 300);
    }""")
    page.evaluate("window.__tapScreen()")   # the same touch's XR select must be ignored
    page.wait_for_function("window.__golf.ctx.golf.strokes === 1", timeout=3000)
    page.wait_for_timeout(300)
    assert page.evaluate("window.__app.world.objects.size") == n_objects


def test_turning_golf_off_stops_it_and_hides_its_layer(page: Page, live_server):
    start_golf(page, live_server)
    page.evaluate("window.__app.runtime.setEnabled('golf', false)")
    page.wait_for_function("!window.__golf && window.__app?.runtime.running.size === 0", timeout=5000)
    hidden = page.evaluate("[...window.__app.world.objects.values()].filter(e => e.data.components.app).every(e => !e.built.root.visible)")
    assert hidden and page.evaluate("window.__app.world.pickables().length") == 0
    page.evaluate("window.__app.runtime.setEnabled('golf', true)")
    page.wait_for_function("window.__golf?.ctx.golf?.world", timeout=15000)


# ---- fish tank ----------------------------------------------------------------------

def test_fishtank_renders_server_fish_and_feeding_reaches_other_devices(page: Page, live_server, context):
    login(page, live_server)
    enable(page, live_server, "fishtank")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "fishtank")
    page.wait_for_function("window.__fish?.ctx.tank?.fish.size >= 12", timeout=10000)
    page.wait_for_function("/\\d+ fish · 10 kinds/.test(document.getElementById('ov-appbar').textContent)", timeout=5000)

    # Fish move along their plans.
    a = page.evaluate("[...window.__fish.ctx.tank.fish.values()][0].mesh.position.toArray()")
    page.wait_for_timeout(600)
    b = page.evaluate("[...window.__fish.ctx.tank.fish.values()][0].mesh.position.toArray()")
    assert a != b

    # A second device (same user) sees the same tank and gets the feeding broadcast.
    other = context.new_page()
    open_ar(other, live_server, [TAG_A])
    other.wait_for_function("window.__fish?.ctx.tank?.fish.size >= 12", timeout=15000)
    tank = page.evaluate("window.__fish.ctx.instance.id")
    other.wait_for_function(f"window.__app?.runtime.joined.has('app:fishtank:{tank}')", timeout=5000)   # in the channel
    hunger_before = page.evaluate("Math.max(...[...window.__fish.ctx.tank.fish.values()].map(f => f.data.hunger))")
    page.evaluate("document.querySelector('#ov-appbar button').click()")   # 🍤 Feed
    other.wait_for_function("window.__fish.ctx.tank.food.length > 0", timeout=5000)
    page.wait_for_function(f"Math.max(...[...window.__fish.ctx.tank.fish.values()].map(f => f.data.hunger)) < {hunger_before}", timeout=5000)


def test_golf_works_in_a_temporary_space(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "golf")
    open_ar(page, live_server, [])
    place_app(page, "golf")
    page.wait_for_function("window.__golf?.ctx.golf?.world", timeout=15000)
    assert page.evaluate("window.__golf.ctx.instance.temporary") is True
    page.evaluate("window.__golf.shoot(0, -0.3)")
    page.wait_for_function("window.__golf.ctx.golf.strokes === 1", timeout=3000)
    page.evaluate("window.__xrSession.end()")
    page.wait_for_function("!window.__golf", timeout=5000)        # app stopped with the space


def test_toggling_apps_in_temporary_space_logs_no_errors(page: Page, live_server):
    """Regression: re-enabling an app resynced the temporary space from the
    server (400 bad space id)."""
    login(page, live_server)
    enable(page, live_server, "golf")
    open_ar(page, live_server, [])
    place(page)                                                # creates the temporary space
    page.wait_for_function("window.__app?.world.objects.size === 1", timeout=5000)
    page.evaluate("window.__app.runtime.setEnabled('golf', false).then(() => window.__app.runtime.setEnabled('golf', true))")
    page.wait_for_function("window.__app?.lines.some(l => l === 'Mini Golf on')", timeout=5000)
    page.wait_for_timeout(500)
    assert not [l for l in page.evaluate("window.__app.lines") if l.startswith("error")]



def test_failing_app_backs_off_instead_of_restarting_every_frame(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "golf")
    open_ar(page, live_server, [])
    page.evaluate("""window.__starts = 0; window.__app.runtime.modules.set('golf', Promise.resolve({ default: {
        start() { window.__starts++; throw new Error('boom'); } } }))""")
    place_app(page, "golf")
    page.wait_for_function("window.__starts >= 1", timeout=5000)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.__starts") == 1                 # next retry is 2 s later, not next frame


# ---- plants ----------------------------------------------------------------------

def test_plants_variants_grow_from_server_state_and_watering_reaches_other_devices(page: Page, live_server, context):
    login(page, live_server)
    enable(page, live_server, "plants")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("window.__app?.runtime.apps.get('plants')?.enabled", timeout=5000)
    tiles = page.evaluate("[...document.querySelectorAll('#ov-palette .tile')].map(t => t.dataset.key)")
    assert "choose:plants" in tiles and "app:plants:snake" not in tiles   # one Place tile for the app: it opens the chooser
    page.click("#ov-fab")
    page.click("#ov-palette .tile[data-key='choose:plants']")
    page.wait_for_selector("#ov-chooser .vcard[data-variant='app:plants:snake'] img", timeout=8000)   # a rendered preview per species
    assert page.evaluate("document.querySelectorAll('#ov-chooser .vcard').length") == 3
    page.click("#ov-chooser .vcard[data-variant='app:plants:snake']")
    assert page.evaluate("window.__app.armed") == "app:plants:snake" and not page.is_visible("#ov-chooser")
    tap(page)
    page.wait_for_function("window.__plants?.size === 1 && [...window.__plants.values()][0].plant.built", timeout=10000)
    pid = page.evaluate("[...window.__plants.keys()][0]")
    plant = f"window.__plants.get('{pid}').plant"
    assert page.evaluate(f"{plant}.data.species") == "snake"
    assert page.evaluate(f"{plant}.built.children.length") >= 1                      # leaves were built
    page.wait_for_function("document.getElementById('ov-appbar').textContent.includes('Snake plant')", timeout=5000)

    # Time-lapse replays growth, then settles back on the server's state.
    page.evaluate("[...document.querySelectorAll('#ov-appbar button')].find(b => b.textContent.includes('Time-lapse')).click()")
    page.wait_for_function(f"{plant}.lapse && {plant}.lapse.t > 0.5", timeout=3000)

    # A second device sees the same plant and the watering.
    other = context.new_page()
    open_ar(other, live_server, [TAG_A])
    other.wait_for_function(f"window.__plants?.get('{pid}')?.plant.built", timeout=15000)
    other.wait_for_function(f"window.__app?.runtime.joined.has('app:plants:{pid}')", timeout=5000)
    before = page.evaluate(f"{plant}.data.moisture")
    page.evaluate("[...document.querySelectorAll('#ov-appbar button')].find(b => b.textContent.includes('Water')).click()")
    other.wait_for_function(f"window.__plants.get('{pid}').plant.data.moisture > {before} && window.__plants.get('{pid}').plant.drops.length > 0", timeout=5000)


def test_fishtank_draws_its_fish_by_kind_within_a_budget(page: Page, live_server):
    """The headset paid for drawing the tank (61 → 84 fps hidden): fish are
    instanced per kind, materials are plain, static parts merged."""
    login(page, live_server)
    enable(page, live_server, "fishtank")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "fishtank")
    page.wait_for_function("window.__fish?.ctx.tank?.fish.size >= 12", timeout=10000)
    r = page.evaluate("""async () => { const { drawCost } = await import('/js/apps/perf.js'); const t = window.__fish.ctx.tank;
      const kinds = [...t.kinds.values()], physical = []; t.root.traverse(o => { if (o.material?.isMeshPhysicalMaterial) physical.push(o.material.type); });
      return { cost: drawCost(t.root), kinds: kinds.length, fish: t.fish.size, drawn: kinds.reduce((n, k) => n + k.meshes.body.count, 0), physical: physical.length }; }""")
    assert r["drawn"] == r["fish"], r                                   # every fish drawn, by its kind
    assert r["cost"]["draws"] <= 3 * r["kinds"] + 25, r                 # 3 a kind + the tank (was ~90)
    assert r["physical"] == 0, r                                        # no clearcoat / iridescence / transmission pixels
    # They still swim: the instances move.
    m0 = page.evaluate("[...window.__fish.ctx.tank.kinds.values()][0].meshes.body.instanceMatrix.array.slice(12, 15)")
    page.wait_for_timeout(500)
    m1 = page.evaluate("[...window.__fish.ctx.tank.kinds.values()][0].meshes.body.instanceMatrix.array.slice(12, 15)")
    assert m0 != m1


def test_hiding_an_app_in_layers_hides_its_things_in_a_shared_space(page: Page, live_server):
    """The bug: the app's Layers toggle only hid the app's own layer, but
    things placed in a Space live in its shared layer, so nothing hid."""
    login(page, live_server)
    enable(page, live_server, "fishtank")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "fishtank")
    page.wait_for_function("window.__fish?.ctx.tank?.water", timeout=10000)
    row = page.evaluate("window.__app.menu.data().layers.find(l => l.group === 'app' && l.name === 'Fish Tank')")
    assert row and row["count"] == 1, row
    root = "window.__app.world.objects.get(window.__fish.ctx.instance.id).built.root"
    page.evaluate(f"window.__app.menu.setLayerVisible('{row['id']}', false)")
    assert page.evaluate(f"{root}.visible") is False
    page.evaluate(f"window.__app.menu.setLayerVisible('{row['id']}', true)")
    assert page.evaluate(f"{root}.visible") is True
