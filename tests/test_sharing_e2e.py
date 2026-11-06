"""Two people, two emulated phones, one shared Space: invite → join →
shared objects show up live, private ones don't, sharing toggles, and each
sees the other's avatar."""
import json

from playwright.sync_api import Browser, Page

from test_main import TAG_A, login, open_ar, create_space, place, tap


def objects(page: Page):
    return page.evaluate("[...window.__app.world.objects.values()].map(e => ({ id: e.data.id, layer: e.data.layer, built: !!e.built }))")


def test_two_people_share_a_space(page: Page, browser: Browser, live_server):
    # Alice makes a space and invites.
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.sharedLayer)", timeout=5000)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    code = page.request.post(f"{live_server}/api/spaces/{sid}/invite").json()["code"]

    # Eve (another user, own browser profile) opens the invite link.
    ctx2 = browser.new_context(ignore_https_errors=True)
    eve = ctx2.new_page()
    name = login(eve, live_server)
    eve.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    eve.goto(f"{live_server}/?emulate=phone&join={code}")
    eve.wait_for_function(f"window.__app?.world?.spaces.get('{sid}')?.members.length === 2", timeout=10000)
    assert "join=" not in eve.url                                   # link cleaned up after joining
    eve.click("#enter")
    eve.wait_for_function(f"window.__app?.world.spaces.get('{sid}').aligned", timeout=10000)
    page.wait_for_function(f"window.__app?.world.spaces.get('{sid}').members.includes('{name}')", timeout=5000)   # alice's menu updates live

    # Shared by default: Eve sees Alice's cube appear.
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.data.rev)", timeout=5000)
    cube = objects(page)[0]["id"]
    eve.wait_for_function(f"window.__app?.world.objects.get('{cube}')?.built", timeout=5000)

    # Alice makes it private from the context bar: it disappears for Eve.
    tap(page, pitch=7)
    page.wait_for_function("window.__app?.selectedId", timeout=3000)
    page.wait_for_function("document.querySelector('#ov-context [data-act=share]')?.textContent.includes('Shared')", timeout=3000)
    page.click("#ov-context [data-act=share]")
    eve.wait_for_function(f"!window.__app?.world.objects.has('{cube}')", timeout=5000)
    page.wait_for_function("document.querySelector('#ov-context [data-act=share]')?.textContent.includes('Private')", timeout=3000)

    # Presence: each sees the other.
    eve.wait_for_function("window.__app?.presence.count === 1", timeout=5000)
    page.wait_for_function("window.__app?.presence.count === 1", timeout=5000)
    alice = page.evaluate("document.getElementById('who').textContent")
    eve.wait_for_function(f"JSON.stringify(window.__app?.presence.names()) === JSON.stringify(['{alice}'])", timeout=3000)
    ctx2.close()
    page.wait_for_function("window.__app?.presence.count === 0", timeout=8000)   # gone when Eve leaves


def two_people(page: Page, browser: Browser, live_server):
    """Alice and Eve in one shared space, both in AR at TAG_A."""
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => !s.temporary && s.sharedLayer)", timeout=5000)
    sid = page.evaluate("[...window.__app.world.spaces.values()].find(s => !s.temporary).id")
    code = page.request.post(f"{live_server}/api/spaces/{sid}/invite").json()["code"]
    ctx2 = browser.new_context(ignore_https_errors=True, permissions=["camera"])
    eve = ctx2.new_page()
    login(eve, live_server)
    eve.request.post(f"{live_server}/api/join", data=json.dumps({"code": code}), headers={"content-type": "application/json"})
    open_ar(eve, live_server, [TAG_A])
    eve.wait_for_function(f"window.__app?.world.spaces.get('{sid}')?.aligned", timeout=10000)
    return eve, ctx2, sid


def test_drags_stream_live_to_others(page: Page, browser: Browser, live_server):
    from test_main import touch, center_of
    eve, ctx2, sid = two_people(page, browser, live_server)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    eve.wait_for_function(f"window.__app?.world.objects.get('{oid}')?.built", timeout=5000)
    seen0 = center_of(eve, oid)
    c = center_of(page, oid)
    touch(page, ("start", {"at": c}), ("wait", 750), ("move", {"at": [c[0] + 0.15, c[1], c[2]]}), ("wait", 500))
    # Still held (not saved yet), and Eve already sees it over there.
    assert page.evaluate("window.__app.selectedId") == oid
    eve.wait_for_function(f"""(() => {{ const r = window.__app?.world.objects.get('{oid}').built.root;
      r.updateWorldMatrix(true, false);
      return Math.hypot(r.matrixWorld.elements[12] - {seen0[0]}, r.matrixWorld.elements[14] - {seen0[2]}) > 0.08; }})()""", timeout=3000)
    saved_before = eve.evaluate(f"window.__app.world.objects.get('{oid}').data.rev")
    touch(page, ("end",))
    eve.wait_for_function(f"window.__app?.world.objects.get('{oid}').data.rev > {saved_before}", timeout=5000)   # then the save
    ctx2.close()


def test_golf_physics_follows_the_player(page: Page, browser: Browser, live_server):
    """No fixed host: whoever putts simulates on their own device (lease),
    the other watches the stream; at rest the spot is shared, the lease is free."""
    eve, ctx2, sid = two_people(page, browser, live_server)
    page.evaluate("window.__app.runtime.setEnabled('golf', true)")
    eve.evaluate("window.__app.runtime.setEnabled('golf', true)")
    place(page, "app:golf")
    G = "window.__golf.ctx.golf"
    for p in (page, eve):
        p.wait_for_function("window.__golf?.ctx.golf?.world", timeout=15000)
        p.wait_for_function(f"{G}.room.peers === 2", timeout=5000)
    # Eve putts: her device simulates, mine watches.
    z0 = page.evaluate(f"{G}.ballMesh.position.z")
    eve.evaluate("window.__golf.shoot(0, -0.4)")
    assert eve.evaluate(f"{G}.room.mine")
    page.wait_for_function(f"{G}.room.holder && !{G}.room.mine", timeout=3000)
    page.wait_for_function(f"{G}.ballMesh.position.z < {z0} - 0.05", timeout=5000)
    page.wait_for_function(f"{G}.room.rest?.rev >= 1 && !{G}.room.holder && {G}.strokes === 1", timeout=15000)   # settled + shared
    rest = eve.evaluate(f"{G}.ball.translation()")
    mine = page.evaluate(f"{G}.ballMesh.position")
    assert abs(rest["z"] - mine["z"]) < 0.003, (rest, mine)
    # My turn: I take the lease and play on from where her ball stopped.
    page.evaluate("window.__golf.shoot(0, -0.2)")
    assert page.evaluate(f"{G}.room.mine")
    start = page.evaluate(f"{G}.ball.translation()")
    assert abs(start["z"] - rest["z"]) < 0.02, (start, rest)
    eve.wait_for_function(f"{G}.strokes === 2", timeout=5000)
    # Eve can't putt while I simulate.
    eve.evaluate("window.__golf.shoot(0.3, 0)")
    assert not eve.evaluate(f"{G}.room.mine")
    # One scorecard, a row per player: a stroke each.
    page.wait_for_function(f"!{G}.room.holder && {G}.room.rest.rev >= 2", timeout=15000)
    eve.wait_for_function(f"Object.keys({G}.card).length === 2", timeout=5000)
    card = eve.evaluate(f"{G}.card")
    assert sorted(r["h"]["0"] for r in card.values()) == [1, 1], card
    ctx2.close()


def test_jenga_tower_is_shared_and_only_the_toucher_simulates(page: Page, browser: Browser, live_server):
    eve, ctx2, sid = two_people(page, browser, live_server)
    for p in (page, eve):
        p.evaluate("window.__app.runtime.setEnabled('jenga', true)")
    place(page, "app:jenga")
    J = "window.__jenga.ctx.jenga"
    for p in (page, eve):
        p.wait_for_function("window.__jenga?.ctx.jenga?.meshes", timeout=15000)
        p.wait_for_function(f"{J}.room.peers === 2", timeout=5000)
    assert page.evaluate(f"{J}.world") is None and eve.evaluate(f"{J}.world") is None   # at rest: nobody simulates
    # Eve slides the middle block of level 8 out; only her device runs physics.
    eve.evaluate(f"""async () => {{ const THREE = await import('three'); const j = {J};
      window.__jenga.claim(); const t = j.bodies[25].translation();
      window.__target = new THREE.Vector3(t.x, t.y, t.z);
      window.__jenga.grab(25, {{ clone: () => window.__target.clone() }}); }}""")
    page.wait_for_function(f"{J}.room.holder && !{J}.room.mine", timeout=3000)
    for _ in range(30):
        eve.evaluate("window.__target.x += 0.004")
        eve.wait_for_timeout(33)
    assert page.evaluate(f"{J}.world") is None
    page.wait_for_function(f"{J}.meshes[25].position.x > 0.05", timeout=5000)          # watching her stream
    eve.evaluate("window.__jenga.drop()")
    page.wait_for_function(f"{J}.room.rest?.rev >= 1 && !{J}.room.holder", timeout=10000)
    a = eve.evaluate(f"{J}.room.rest.d.b[25]")
    b = page.evaluate(f"{J}.meshes[25].position.toArray()")
    assert all(abs(a[k] - b[k]) < 0.002 for k in range(3)), (a, b)
    ctx2.close()


def test_pinball_is_one_machine_the_player_simulates(page: Page, browser: Browser, live_server):
    eve, ctx2, sid = two_people(page, browser, live_server)
    for p in (page, eve):
        p.evaluate("window.__app.runtime.setEnabled('pinball', true)")
    place(page, "app:pinball")
    P = "window.__pinball.ctx.pinball"
    for p in (page, eve):
        p.wait_for_function("window.__pinball?.ctx.pinball?.world", timeout=15000)
        p.wait_for_function(f"{P}.room.peers === 2", timeout=10000)
    # Eve starts a game: her device plays, mine watches her ball.
    eve.evaluate("window.__pinball.press('right', 'down')")
    eve.wait_for_timeout(600)
    eve.evaluate("window.__pinball.press('right', 'up')")
    page.wait_for_function(f"{P}.room.holder && !{P}.room.mine && {P}.watching", timeout=3000)
    page.wait_for_function(f"{P}.ballMesh.position.z < 0", timeout=10000)                # her launch, on my screen (slow frames: slow motion)
    # My press doesn't steal the machine.
    page.evaluate("window.__pinball.press('left', 'down'); window.__pinball.press('left', 'up')")
    assert not page.evaluate(f"{P}.room.mine")
    # Her game ends: her score is on my board, the machine is free.
    eve.evaluate(f"{P}.score = 777; {P}.balls = 1; {P}.saveUntil = 0; {P}.inLane = false; window.__pinball.place(0, 0.3, 0, 1)")
    page.wait_for_function(f"{P}.top.some(t => t.s === 777) && !{P}.room.holder", timeout=8000)
    ctx2.close()
