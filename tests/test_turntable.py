"""Turntable (DESIGN.md §8.8): a placed stand holding things in slots, one
shown at a time; stepping (arrows, swipes) changes the current one for
everyone; things you can't see are skipped; apps waiting in a slot stop."""
from playwright.sync_api import Browser, Page

from test_main import TAG_A, create_space, login, open_ar, place

TT = "window.__app.turntable"


def objects_of(page, pred):
    return page.evaluate(f"[...window.__app.world.objects.values()].filter(e => e.built && ({pred})).map(e => e.data.id)")


PUT = """async ([x, z, components]) => { const THREE = await import('three'); const w = window.__app.world;
  const space = [...w.spaces.values()].find(s => s.aligned && !s.temporary);
  const m = space.root.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, z));
  return (await w.place(space, m, space.sharedLayer, components))?.id; }"""


def put(page, x, z, components):
    oid = page.evaluate(PUT, [x, z, components])
    page.wait_for_function(f"window.__app.world.objects.get('{oid}')?.built && window.__app.world.objects.get('{oid}').data.rev", timeout=8000)
    return oid


def cube(page, x):
    return put(page, x, -0.5, {"mesh": {"primitive": "box", "size": [0.1, 0.1, 0.1]}, "material": {"color": "#ff8800"}})


def turntable(page):
    return put(page, 0, -0.6, {"turntable": {"radius": 0.12, "items": [], "current": None}})


def setup(page: Page, live_server, cubes=2):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    tt = turntable(page)
    return tt, [cube(page, 0.3 + 0.2 * i) for i in range(cubes)]


def shown(page, oid):
    return page.evaluate(f"window.__app.world.objects.get('{oid}').built.root.visible")


def test_one_thing_shows_at_a_time_and_steps_through(page: Page, live_server):
    tt, (a, b) = setup(page, live_server)
    page.evaluate(f"{TT}.put('{tt}', '{a}'); {TT}.put('{tt}', '{b}')")
    page.wait_for_function(f"window.__app.world.objects.get('{tt}').data.components.turntable.current === '{b}' && window.__app.world.objects.get('{tt}').data.rev", timeout=5000)
    page.wait_for_timeout(100)
    assert shown(page, b) and not shown(page, a)                         # the last one put on shows
    # It stands on the turntable (not where it was placed).
    d = page.evaluate(f"""(() => {{ const w = window.__app.world, p = (id) => {{ const r = w.objects.get(id).built.root; r.updateWorldMatrix(true, false); return r.matrixWorld.elements.slice(12, 15); }};
      const t = p('{tt}'), c = p('{b}'); return Math.hypot(t[0] - c[0], t[2] - c[2]); }})()""")
    assert d < 0.01, d
    page.evaluate(f"{TT}.step('{tt}', 1)")
    page.wait_for_function(f"window.__app.world.objects.get('{a}').built.root.visible", timeout=3000)
    assert not shown(page, b)
    page.evaluate(f"{TT}.step('{tt}', 1)")                                # wraps around
    page.wait_for_function(f"window.__app.world.objects.get('{b}').built.root.visible", timeout=3000)
    assert page.evaluate(f"{TT}.items('{tt}')") == [a, b]


def test_drop_on_to_add_drag_off_to_take_out(page: Page, live_server):
    tt, (a,) = setup(page, live_server, cubes=1)
    move_to = """([id, to]) => { const w = window.__app.world, r = w.objects.get(id).built.root, t = w.objects.get(to).built.root;
      t.updateWorldMatrix(true, false); const m = t.matrix.clone(); m.elements[13] += 0.15; r.matrix.copy(m); r.matrixWorldNeedsUpdate = true; r.updateWorldMatrix(true, false);
      window.__app.turntable.drop(id); }"""
    page.evaluate(move_to, [a, tt])                                        # held 15 cm over it, let go
    page.wait_for_function(f"window.__app.world.slotOwner('{a}')?.data.id === '{tt}'", timeout=3000)
    page.wait_for_function(f"window.__app.world.objects.get('{tt}').data.rev > 1", timeout=3000)   # (saved)
    page.evaluate(f"""(() => {{ const r = window.__app.world.objects.get('{a}').built.root; r.matrix.elements[12] += 0.6; r.matrixWorldNeedsUpdate = true; r.updateWorldMatrix(true, false);
      {TT}.drop('{a}'); }})()""")                                          # carried away, let go (one go: no frame re-seats it between)
    page.wait_for_function(f"!window.__app.world.slotOwner('{a}')", timeout=3000)
    assert shown(page, a)


def test_swipe_on_the_turntable_steps_it(page: Page, live_server):
    tt, (a, b) = setup(page, live_server)
    page.evaluate(f"{TT}.put('{tt}', '{a}'); {TT}.put('{tt}', '{b}')")
    page.wait_for_function(f"window.__app.world.objects.get('{tt}').data.components.turntable.current === '{b}'", timeout=3000)
    hit = f"{{ object: window.__app.world.objects.get('{tt}').built.root.children[0].children[1], point: null }}"
    page.evaluate(f"window.__app.turntable.swipe({{ phase: 'move', dx: -40, dy: 0, hit: {hit} }})")
    page.evaluate(f"window.__app.turntable.swipe({{ phase: 'end', dx: -120, dy: 0, hit: {hit} }})")   # left: next
    page.wait_for_function(f"window.__app.world.objects.get('{tt}').data.components.turntable.current === '{a}'", timeout=3000)


def test_apps_waiting_in_a_slot_stop(page: Page, live_server):
    from test_apps_e2e import enable
    tt, (a,) = setup(page, live_server, cubes=1)
    enable(page, live_server, "racing")
    page.evaluate("window.__app.runtime.load()")
    car = put(page, -0.8, -0.8, {"app": {"app": "racing", "config": {}}})
    page.wait_for_function("window.__cars?.ctx.cars?.world", timeout=15000)
    page.evaluate(f"{TT}.put('{tt}', '{car}'); {TT}.put('{tt}', '{a}')")   # the cube on top: the track waits
    page.wait_for_function(f"!window.__app.runtime.running.has('{car}')", timeout=5000)
    page.evaluate(f"{TT}.step('{tt}', -1)")                               # back to the track: it runs again
    page.wait_for_function(f"window.__app.runtime.running.has('{car}')", timeout=15000)


def test_the_current_one_is_shared_and_private_things_are_skipped(page: Page, browser: Browser, live_server):
    from test_sharing_e2e import two_people
    eve, ctx2, sid = two_people(page, browser, live_server)
    tt = turntable(page)
    a, b, c = [cube(page, 0.3 + 0.2 * i) for i in range(3)]
    # c is mine alone (private layer): Eve can't see it.
    personal = page.evaluate("(async () => (await (await fetch('/api/me')).json()).layers.find(l => l.kind === 'personal').id)()")
    page.evaluate(f"window.__app.world.setLayer('{c}', '{personal}')")
    page.wait_for_function(f"window.__app.world.objects.get('{c}').data.layer === '{personal}' && window.__app.world.objects.get('{c}').data.rev", timeout=5000)
    for x in (a, b, c):
        page.evaluate(f"{TT}.put('{tt}', '{x}')")
        page.wait_for_timeout(300)
    eve.wait_for_function(f"window.__app.world.objects.get('{tt}')?.data.components.turntable.items.length === 3", timeout=5000)
    assert eve.evaluate(f"{TT}.items('{tt}')") == [a, b]                   # Eve's slots: c skipped
    page.evaluate(f"{TT}.step('{tt}', 1)")                                 # I step: c → a, for both of us
    eve.wait_for_function(f"window.__app.world.objects.get('{tt}').data.components.turntable.current === '{a}'", timeout=5000)
    eve.wait_for_function(f"window.__app.world.objects.get('{a}').built.root.visible", timeout=3000)
    assert not eve.evaluate(f"window.__app.world.objects.get('{b}').built.root.visible")
    eve.evaluate(f"{TT}.step('{tt}', 1)")                                  # Eve steps: a → b (c skipped for her)
    page.wait_for_function(f"window.__app.world.objects.get('{tt}').data.components.turntable.current === '{b}'", timeout=5000)
    ctx2.close()
