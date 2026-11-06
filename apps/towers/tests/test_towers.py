"""Tower Defense (apps/towers): the player sets the play area (any outline,
pinched corners), the game lays out cells inside it and a random winding road
from a seed; classic towers (arrow, cannon, frost, sniper, tesla) built beside
it, waves sent with a button; one device (the sync host) runs the game, others
follow."""
from playwright.sync_api import Browser, Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

T = "window.__td"
G = "window.__td.game()"


def start(page: Page, live_server, classic=True):
    login(page, live_server)
    enable(page, live_server, "towers")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "towers")
    page.wait_for_function("window.__td?.ctx.td", timeout=15000)
    if classic:
        assert page.evaluate(f"{T}.classic()")                             # ▭ on the setup panel
        page.wait_for_function("window.__td?.ctx.td?.board", timeout=15000)


def point_in(poly, x, z):
    inside = False
    for i in range(len(poly)):
        (xi, zi), (xj, zj) = poly[i], poly[i - 1]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
    return inside


def check_road(cells):
    assert all(abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1 for a, b in zip(cells, cells[1:]))   # connected
    assert len({tuple(c) for c in cells}) == len(cells)                                       # never crosses itself
    return sum(1 for a, b, c in zip(cells, cells[1:], cells[2:]) if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]))


def near_road(page, n=3, skip=0):
    """Buildable squares right beside the start of the road (where every enemy passes)."""
    return page.evaluate(f"""(() => {{ const g = {G}, road = g.road, free = new Set({T}.buildable().map(([c, r]) => c * 1000 + r)), out = [];
      for (const [c, r] of road.cells.slice({skip})) for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {{
        const k = (c + dc) * 1000 + r + dr; if (free.has(k) && !out.some(([a, b]) => a * 1000 + b === k)) out.push([c + dc, r + dr]); }}
      return out.slice(0, {n}); }})()""")


def test_the_road_is_long_winding_and_connected(page: Page, live_server):
    start(page, live_server)
    assert page.evaluate(f"{G}.L.cells.length") == 17 * 11                # the classic board
    cells = page.evaluate(f"{G}.road.cells")
    assert 0.26 * 187 - 2 <= len(cells) <= 0.38 * 187 + 2, len(cells)     # the road share the seed picked
    edge = lambda c: c[0] in (0, 16) or c[1] in (0, 10)
    assert edge(cells[0]) and edge(cells[-1])                             # portal and castle at the rim
    assert abs(cells[0][0] - cells[-1][0]) + abs(cells[0][1] - cells[-1][1]) >= 8   # far apart
    turns = check_road(cells)
    assert turns >= 8, turns


def test_towers_beside_the_road_clear_the_first_wave(page: Page, live_server):
    start(page, live_server)
    spots = near_road(page, 3, skip=4)
    for c, r in spots:
        page.evaluate(f"{T}.build({c}, {r}, 'arrow')")
    g = page.evaluate(f"({{ gold: {G}.gold, n: {G}.towers.length }})")
    assert g == {"gold": 160 - 3 * 50, "n": 3}, g
    assert page.evaluate("window.__td.ctx.td.towerMeshes.length") == 3
    page.evaluate(f"{T}.wave()")
    assert page.evaluate(f"{G}.active") is True
    for _ in range(60):                                                   # fast-forward: 60 × 1 s of game time
        page.evaluate(f"{T}.step(30)")
        if not page.evaluate(f"{G}.active"):
            break
    g = page.evaluate(f"({{ active: {G}.active, lives: {G}.lives, gold: {G}.gold, wave: {G}.wave }})")
    assert not g["active"] and g["wave"] == 1, g
    assert g["lives"] == 20, g                                            # nobody got through
    assert g["gold"] == 10 + 6 * 5 + 25, g                                # 6 grunts × 5 + the clear bonus (20 + 5 × wave)


def test_tap_a_square_build_upgrade_and_sell(page: Page, live_server):
    """Through the app's press handler, as a tap / pinch would: square → picker → tower button."""
    start(page, live_server)
    (c, r) = near_road(page, 1)[0]
    press = """async ([c, r, label]) => { const THREE = await import('three'); const ctx = window.__td.ctx, t = ctx.td;
      const mod = [...window.__app.runtime.running.values()].find(i => i.app.id === 'towers').module;
      let object = null, point = null;
      if (label != null) object = t.picker.children.find(m => m.userData.btn && t.buttons.indexOf(m.userData.btn) >= 0 && m.userData.label === label) ?? null;
      if (!object) point = new THREE.Vector3(...window.__td.cellCenter(c, r));
      return mod.press(ctx, { phase: 'down', side: 'right', source: 'touch', object, point, ray: () => null }); }"""
    # Label the picker buttons so the test can find them.
    label = """(() => { const t = window.__td.ctx.td; t.picker.children.forEach((m, i) => { m.userData.label = i; }); return t.picker.children.length; })()"""
    assert page.evaluate(press, [c, r, None])
    n = page.evaluate(label)
    assert n == 6, n                                                       # 5 towers + the title
    page.evaluate(press, [c, r, 1])                                        # 💣 cannon (second)
    page.wait_for_function(f"{G}.towers.length === 1", timeout=2000)
    assert page.evaluate(f"{G}.towers[0].type") == "cannon" and page.evaluate(f"{G}.gold") == 70
    assert page.evaluate(label) == 4                                       # now: upgrade, sell, close + title
    page.evaluate(f"{G}.gold = 500")
    page.wait_for_timeout(100)                                             # (the picker redraws for the new gold)
    page.evaluate(label)
    page.evaluate(press, [c, r, 0])                                        # ⬆️ upgrade
    page.wait_for_function(f"{G}.towers[0].lvl === 2", timeout=2000)
    gold = page.evaluate(f"{G}.gold")
    assert gold == 500 - 72, gold                                          # 90 × 0.8 × 1
    page.wait_for_timeout(100)
    page.evaluate(label)
    page.evaluate(press, [c, r, 1])                                        # 💰 sell: 70 % of 162 spent
    page.wait_for_function(f"{G}.towers.length === 0", timeout=2000)
    assert page.evaluate(f"{G}.gold") == gold + round(162 * 0.7)


def test_an_undefended_board_loses_then_the_button_starts_over(page: Page, live_server):
    start(page, live_server)
    seed = page.evaluate(f"{G}.seed")
    for _ in range(6):
        page.evaluate(f"{T}.wave()")                                       # call waves early, nothing to stop them
    for _ in range(120):
        page.evaluate(f"{T}.step(30)")
        if page.evaluate(f"{G}.over"):
            break
    assert page.evaluate(f"{G}.over") and page.evaluate(f"{G}.lives") == 0
    page.evaluate(f"{T}.wave()")                                           # the button: a new game on the same map
    g = page.evaluate(f"({{ over: {G}.over, lives: {G}.lives, wave: {G}.wave, seed: {G}.seed }})")
    assert g == {"over": False, "lives": 20, "wave": 0, "seed": seed}, g


def test_new_map_makes_a_different_road(page: Page, live_server):
    start(page, live_server)
    page.evaluate(f"window.__road0 = JSON.stringify({G}.road.cells)")
    page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'towers').actions[1].run()")   # 🗺 New map
    page.wait_for_function(f"{G}.road?.cells && JSON.stringify({G}.road.cells) !== window.__road0", timeout=3000)
    assert page.evaluate("window.__td.ctx.td.boardSeed") == page.evaluate(f"{G}.seed")   # the board was rebuilt for it


def test_a_second_player_sees_the_same_board_and_can_build(page: Page, browser: Browser, live_server):
    from test_main import place
    from test_sharing_e2e import two_people
    eve, ctx2, sid = two_people(page, browser, live_server)
    for p in (page, eve):
        p.evaluate("window.__app.runtime.setEnabled('towers', true)")
    place(page, "app:towers")
    for p in (page, eve):
        p.wait_for_function("window.__td?.ctx.td?.setup", timeout=15000)   # a new board: both see the area setup
    page.evaluate(f"{T}.classic()")                                        # one sets it; the other restarts onto it
    for p in (page, eve):
        p.wait_for_function("window.__td?.ctx.td?.board && !window.__td.ctx.td.setup", timeout=15000)
    page.wait_for_timeout(800)                                             # the room settles on one host
    host = page if page.evaluate("window.__td.ctx.td.room.isHost") else eve
    guest = eve if host is page else page
    guest.wait_for_function(f"{G}.seed === {host.evaluate(f'{G}.seed')}", timeout=5000)   # same road
    (c, r) = near_road(guest, 1)[0]
    guest.evaluate(f"{T}.build({c}, {r}, 'frost')")                        # the guest asks; the host builds
    host.wait_for_function(f"{G}.towers.some(w => w.c === {c} && w.r === {r} && w.type === 'frost')", timeout=5000)
    guest.wait_for_function(f"window.__td.ctx.td.towerMeshes.length === 1", timeout=5000)
    guest.evaluate(f"{T}.wave()")
    host.bring_to_front()
    guest.wait_for_function(f"{G}.enemies.length > 0", timeout=8000)      # the host's enemies walk on the guest's board
    ctx2.close()


def test_tapping_through_enemies_does_not_crash(page: Page, live_server):
    """Health bars are sprites: hit-testing them without a camera threw every frame (the viewer died)."""
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start(page, live_server)
    page.evaluate(f"{T}.wave()")
    for _ in range(6):
        page.evaluate(f"{T}.step(30)")
    page.wait_for_function(f"{G}.enemies.length > 0 && window.__td.ctx.td.enemies.size > 0", timeout=5000)
    for pitch in (-40, -30, -20):
        page.evaluate(f"window.__tapScreen({{ pitchDeg: {pitch} }})")
    page.wait_for_timeout(300)
    assert not errors, errors


L_SHAPE = [(-0.4, -0.3), (0.4, -0.3), (0.4, 0), (0, 0), (0, 0.3), (-0.4, 0.3)]


def pinch_corners(page, pts):
    for x, z in pts:
        page.evaluate(f"{T}.add([{x}, 0.4, {z}], [0, -1, 0])")             # straight down onto the table


def test_a_new_board_asks_for_its_play_area_and_fits_any_shape(page: Page, live_server):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    start(page, live_server, classic=False)
    assert page.evaluate("!!window.__td.ctx.td.setup && !window.__td.ctx.td.board")
    pinch_corners(page, L_SHAPE)
    assert page.evaluate(f"{T}.done()")
    page.wait_for_function("window.__td.ctx.td.board && !window.__td.ctx.td.setup", timeout=5000)
    oid = page.evaluate("window.__td.ctx.instance.id")
    page.wait_for_function(f"window.__app.world.objects.get('{oid}').data.components.app.config.corners?.length === 6", timeout=5000)   # shared
    L = page.evaluate(f"(() => {{ const L = {G}.L; return {{ k: L.k, x0: L.x0, z0: L.z0, cells: L.cells.map(c => [c.c, c.r]) }}; }})()")
    k, cell = L["k"], 0.04
    center = lambda c, r: ((L["x0"] + (c + 0.5) * cell) * k, (L["z0"] + (r + 0.5) * cell) * k)
    for c, r in L["cells"]:                                               # every square is inside the L, none in its notch
        x, z = center(c, r)
        assert point_in(L_SHAPE, x, z) and not (x > 0 and z > 0), (c, r, x, z)
    assert len(L["cells"]) > 150
    cells = page.evaluate(f"{G}.road.cells")
    inside = {tuple(c) for c in L["cells"]}
    assert all(tuple(c) in inside for c in cells)
    check_road(cells)
    n = len(L["cells"])
    assert 0.26 * n - 2 <= len(cells) <= 0.38 * n + 2, (len(cells), n)
    near_rim = lambda c: any((c[0] + dc, c[1] + dr) not in inside for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)))
    assert near_rim(cells[0]) and near_rim(cells[-1])                     # portal and castle on the outline
    (c, r) = near_road(page, 1)[0]                                        # and it plays
    page.evaluate(f"{T}.build({c}, {r}, 'arrow')")
    page.wait_for_function(f"{G}.towers.length === 1", timeout=2000)
    page.evaluate(f"{T}.wave()")
    page.evaluate(f"{T}.step(90)")
    page.wait_for_function(f"{G}.enemies.length > 0", timeout=2000)
    page.wait_for_timeout(200)
    assert not errors, errors


def test_too_small_areas_are_refused(page: Page, live_server):
    start(page, live_server, classic=False)
    pinch_corners(page, [(-0.1, -0.1), (0.1, -0.1), (0, 0.1)])            # a coaster: no room for a road
    assert not page.evaluate(f"{T}.done()")
    assert page.evaluate("!!window.__td.ctx.td.setup")


def test_a_floor_sized_area_scales_the_board(page: Page, live_server):
    start(page, live_server, classic=False)
    pinch_corners(page, [(-1.2, -0.9), (1.2, -0.9), (1.2, 0.9), (-1.2, 0.9)])
    assert page.evaluate(f"{T}.done()")
    page.wait_for_function("window.__td.ctx.td.board", timeout=5000)
    g = page.evaluate(f"({{ k: {G}.L.k, n: {G}.L.cells.length, scale: window.__td.ctx.td.board.scale.x, road: {G}.road.cells.length }})")
    assert 2.5 < g["k"] < 4 and abs(g["scale"] - g["k"]) < 1e-9, g      # bigger squares, not thousands of them
    assert 150 <= g["n"] <= 230 and g["road"] > 40, g
    (c, r) = near_road(page, 1)[0]
    page.evaluate(f"{T}.select({c}, {r})")
    assert page.evaluate("window.__td.ctx.td.picker.children.length") == 6


def test_change_the_play_area_starts_over_on_the_new_one(page: Page, live_server):
    start(page, live_server)
    (c, r) = near_road(page, 1)[0]
    page.evaluate(f"{T}.build({c}, {r}, 'arrow')")
    page.wait_for_function(f"{G}.towers.length === 1", timeout=2000)
    page.evaluate("window.__app.runtime.uiState().find(u => u.app.id === 'towers').actions[3].run()")   # 📐 Change the play area
    assert page.evaluate("!!window.__td.ctx.td.setup && !window.__td.ctx.td.board.visible")
    pinch_corners(page, L_SHAPE)
    assert page.evaluate(f"{T}.done()")
    g = page.evaluate(f"({{ n: {G}.L.cells.length, towers: {G}.towers.length, gold: {G}.gold }})")
    assert g["n"] != 187 and g["towers"] == 0 and g["gold"] == 160, g


def test_holding_anywhere_on_the_board_moves_it_but_not_on_its_buttons(page: Page, live_server):
    start(page, live_server)
    r = page.evaluate("""(() => { const ctx = window.__td.ctx, t = ctx.td, mod = [...window.__app.runtime.running.values()].find(i => i.app.id === 'towers').module;
      const isBtn = (o) => { for (let n = o; n; n = n.parent) if (n.userData?.btn) return true; return false; };
      const meshes = []; t.group.traverse(o => { if (o.isMesh) meshes.push(o); });
      const plain = meshes.find(o => !isBtn(o) && !o.userData.handle), btn = meshes.find(isBtn);
      const tryGrab = (o) => { let no = false; mod.grab(ctx, { object: o, handle: !!o.userData.handle, how: 'hold', preventDefault: () => { no = true; } }); return no; };
      return { board: tryGrab(plain), button: btn ? tryGrab(btn) : null }; })()""")
    assert r["board"] is False, r                                            # the board itself: it moves
    assert r["button"] is True, r                                            # a button: it's pressed, not moved


def test_a_cannon_blast_grows_fades_and_goes(page: Page, live_server):
    start(page, live_server)
    c, r = near_road(page, 1)[0]
    page.evaluate(f"{T}.build({c}, {r}, 'cannon')")
    page.wait_for_function("window.__td.ctx.td.towerMeshes.length === 1", timeout=5000)
    page.evaluate("window.__td.ctx.td.fx.length = 0")
    page.evaluate("""() => { const t = window.__td.ctx.td, b = t.board;
      window.__kids = b.children.length;
      const p = b.children[0].position.clone(); p.x += 0.05;
      window.__td.shot({ k: 'cannon', i: 0, p: [p] }); }""")
    big = page.evaluate("""() => { const t = window.__td.ctx.td; let big = 0;
      for (let i = 0; i < 60; i++) { window.__td.fx(1 / 60);
        for (const f of t.fx) if (f.kind === 'puff') big = Math.max(big, f.mesh.scale.x); }
      return big; }""")
    assert 0 < big < 0.2, big                                           # the blast showed, splash-sized (never the 1 m unit sphere)
    assert page.evaluate(f"{T}.fxLeft()") == 0
    assert page.evaluate("window.__td.ctx.td.board.children.length === window.__kids")   # nothing left behind
