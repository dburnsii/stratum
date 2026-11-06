"""Main app on an emulated phone: tag → Space → place → persists → edit →
uploads. The fake camera (window.__fakeCamera) shows printed tags."""
import json
import time
import math
import uuid

from playwright.sync_api import Page

from glb import make_glb

def make_png(w, h):
    """Valid RGBA PNG, w×h, all orange."""
    import struct, zlib
    def chunk(t, data):
        return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    raw = b"".join(b"\0" + b"\xff\x88\x00\xff" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PNG = make_png(4, 2)


def wait_until(page: Page, expr: str, timeout=10000, poll=150):
    """Like page.wait_for_function, but for expressions that return a Promise
    (e.g. fetch(...).then(...)): wait_for_function treats any Promise as true
    at once; page.evaluate awaits it."""
    end = time.time() + timeout / 1000
    while True:
        if page.evaluate(expr):
            return
        if time.time() > end:
            raise AssertionError(f"timed out waiting for: {expr[:160]}")
        page.wait_for_timeout(poll)


def login(page: Page, base: str):
    name = "u" + uuid.uuid4().hex[:8]
    r = page.request.post(f"{base}/api/login", data=json.dumps({"name": name}), headers={"content-type": "application/json"})
    assert r.ok
    return name


def open_ar(page: Page, base: str, tags):
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': tags})};")
    page.goto(f"{base}/?emulate=phone")
    page.wait_for_function("window.__app?.world && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)


def set_camera(page: Page, tags):
    page.evaluate(f"window.__fakeCamera = {json.dumps({'tags': tags})}")


def tap(page: Page, pitch=0):
    page.evaluate(f"window.__tapScreen({{ pitchDeg: {pitch} }})")


def place(page: Page, key="cube", pitch=0):
    """Arm a palette item, then tap: placement is opt-in (one per arm)."""
    page.evaluate(f"window.__app.arm('{key}')")
    tap(page, pitch)


def aligned(page: Page):
    """A saved (non-temporary) Space is aligned."""
    page.wait_for_function("[...window.__app.world.spaces.values()].some(s => s.aligned && !s.temporary)", timeout=10000)


def create_space(page: Page):
    page.wait_for_function("!document.getElementById('ov-prompt').hidden", timeout=10000)
    page.evaluate("document.getElementById('ov-create').click()")
    aligned(page)


def objects_on_server(page: Page, base: str):
    spaces = page.request.get(f"{base}/api/spaces?device={uuid.uuid4()}").json()["spaces"]
    out = []
    for s in spaces:
        out += page.request.get(f"{base}/api/objects?space={s['id']}").json()["objects"]
    return spaces, out


def local_to_tag(page: Page, obj_id: str, tag: int):
    """Object position expressed in the tag's (smoothed) frame."""
    return page.evaluate(f"""async () => {{
      const THREE = await import('three');
      const w = window.__app.world;
      const root = w.objects.get('{obj_id}').built.root;
      root.updateMatrixWorld(true);
      const tag = window.__app.tracker.tags.get({tag});
      const p = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
      return p.applyMatrix4(tag.pose.clone().invert()).toArray();
    }}""")


TAG_A = {"id": 0, "x": 320, "y": 180, "px": 60}


def test_new_tag_offers_space_and_tap_places_persisted_object(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("window.__app?.lines.some(l => l.startsWith('placed '))", timeout=5000)
    spaces, objs = objects_on_server(page, live_server)
    assert len(spaces) == 1 and spaces[0]["markers"][0]["tag"] == 0
    assert len(objs) == 1 and objs[0]["components"]["mesh"]["primitive"] == "box"


def test_object_stays_put_relative_to_tag_across_sessions(page: Page, live_server, context):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    before = local_to_tag(page, oid, 0)

    # New session: the same tag appears somewhere else (as if the phone's
    # world origin differs this time). The object must follow the tag.
    page2 = context.new_page()
    open_ar(page2, live_server, [{"id": 0, "x": 250, "y": 140, "px": 80, "rot": 15}])
    aligned(page2)
    page2.wait_for_function(f"window.__app?.world.objects.get('{oid}')?.built", timeout=8000)
    page2.wait_for_timeout(1500)   # let smoothing settle
    after = local_to_tag(page2, oid, 0)
    assert math.dist(before, after) < 0.02, (before, after)


def test_tap_object_to_select_resize_delete(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    tap(page, pitch=7)                                         # aim at the cube's middle
    page.wait_for_function("window.__app?.selectedId", timeout=3000)
    oid = page.evaluate("window.__app.selectedId")
    page.evaluate("document.querySelector('#ov-context [data-act=bigger]').click()")
    page.wait_for_timeout(500)
    _, objs = objects_on_server(page, live_server)
    assert abs(objs[0]["pose"]["s"][0] - 1.25) < 1e-3
    page.evaluate("document.querySelector('#ov-context [data-act=delete]').click()")
    page.wait_for_timeout(500)
    _, objs = objects_on_server(page, live_server)
    assert objs == [] and not page.evaluate(f"window.__app.world.objects.has('{oid}')")


def test_upload_model_and_image_then_place_model(page: Page, live_server, tmp_path):
    login(page, live_server)
    (tmp_path / "fish.glb").write_bytes(make_glb(animated=True))
    (tmp_path / "dot.png").write_bytes(PNG)
    page.add_init_script(f"window.__fakeCamera = {json.dumps({'tags': [TAG_A]})};")
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function("window.__app?.world", timeout=10000)
    page.set_input_files("#upload", [str(tmp_path / "fish.glb"), str(tmp_path / "dot.png")])
    page.wait_for_function("document.querySelectorAll('#library li').length === 2", timeout=8000)
    lib = page.request.get(f"{live_server}/api/assets").json()["assets"]
    fish = next(a for a in lib if a["kind"] == "model")
    img = next(a for a in lib if a["kind"] == "image")
    assert (img["width"], img["height"]) == (4, 2)            # measured client-side
    page.click("#enter")
    page.wait_for_function("window.__app?.tracker", timeout=10000)
    create_space(page)
    page.evaluate(f"window.__app.setPalette('{fish['hash']}')")
    tap(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.components.model)", timeout=8000)
    size = page.evaluate("""async () => {
      const THREE = await import('three');
      const e = [...window.__app.world.objects.values()].find(e => e.data.components.model);
      return new THREE.Box3().setFromObject(e.built.root).getSize(new THREE.Vector3()).toArray(); }""")
    assert abs(max(size) - 0.2) < 0.01, size                  # normalized to 20 cm
    _, objs = objects_on_server(page, live_server)
    assert objs[0]["components"] == {"model": {"asset": fish["hash"]}}


def test_second_tag_is_learned_into_the_space(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    set_camera(page, [TAG_A, {"id": 3, "x": 480, "y": 180, "px": 60}])
    page.wait_for_function("window.__app?.lines.some(l => l.startsWith('tag 3 added'))", timeout=12000)
    spaces, _ = objects_on_server(page, live_server)
    assert sorted(m["tag"] for m in spaces[0]["markers"]) == [0, 3]
    m3 = next(m for m in spaces[0]["markers"] if m["tag"] == 3)
    assert m3["pose"]["p"][0] > 0.05                          # to the right of tag 0


def test_no_tag_uses_temporary_space_local_only_and_cleared_on_exit(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [])
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built)", timeout=5000)
    st = page.evaluate("""() => { const w = window.__app.world; const s = [...w.spaces.values()].find(s => s.temporary);
        return { temp: !!s, aligned: s?.aligned, inTemp: [...w.objects.values()].every(e => e.data.space === s.id) }; }""")
    assert st == {"temp": True, "aligned": True, "inTemp": True}
    page.wait_for_function("document.getElementById('ov-status').textContent.startsWith('Temporary space')", timeout=3000)
    spaces, objs = objects_on_server(page, live_server)
    assert spaces == [] and objs == []                         # nothing left the device
    tap(page, pitch=7)                                         # select + edit works locally too
    page.wait_for_function("window.__app?.selectedId", timeout=3000)
    page.evaluate("document.querySelector('#ov-context [data-act=bigger]').click()")
    page.wait_for_function("[...window.__app.world.objects.values()][0].data.pose.s[0] > 1.2", timeout=3000)
    page.evaluate("window.__xrSession.end()")
    page.wait_for_function("window.__app?.world.objects.size === 0 && ![...window.__app.world.spaces.values()].some(s => s.temporary)", timeout=5000)


def test_tag_still_offered_and_wins_over_temporary_space(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [])
    place(page)                                                # temporary item
    page.wait_for_function("window.__app?.world.objects.size === 1", timeout=5000)
    set_camera(page, [TAG_A])
    create_space(page)                                         # prompt still appears
    place(page, "ball", pitch=-10)                             # miss the temp cube, place a ball
    page.wait_for_function("window.__app?.lines.some(l => l.startsWith('placed ● Ball'))", timeout=5000)
    _, objs = objects_on_server(page, live_server)
    assert [o["components"]["mesh"]["primitive"] for o in objs] == ["sphere"]   # saved in the tag space



# ---- selection / placement rules (prefer never creating by accident) --------------

def pointer(page, *events):
    """Dispatch pointer events on the overlay root: ("down"|"move"|"up", x, y[, wait_ms])."""
    for ev in events:
        kind, x, y = ev[:3]
        page.evaluate(f"""document.getElementById('overlay').dispatchEvent(new PointerEvent('pointer{kind}', {{ clientX: {x}, clientY: {y}, bubbles: true }}))""")
        if len(ev) > 3:
            page.wait_for_timeout(ev[3])


def test_unarmed_taps_never_create_and_arming_is_one_shot(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [])
    tap(page)
    tap(page, pitch=-15)
    page.wait_for_timeout(400)
    assert page.evaluate("window.__app.world.objects.size") == 0
    place(page)
    page.wait_for_function("window.__app?.world.objects.size === 1", timeout=5000)
    assert page.evaluate("window.__app.armed") is None          # disarmed after one
    tap(page, pitch=-15)                                        # empty space again
    page.wait_for_timeout(400)
    assert page.evaluate("window.__app.world.objects.size") == 1


def center_of(page, oid):
    return page.evaluate(f"""async () => {{ const THREE = await import('three');
      const r = window.__app.world.objects.get('{oid}').built.root; r.updateWorldMatrix(true, true);
      return new THREE.Box3().setFromObject(r).getCenter(new THREE.Vector3()).toArray(); }}""")


def touch(page, *steps):
    """XR touch script: ("start", aim) | ("move", aim) | ("end",) | ("cancel",) | ("wait", ms)."""
    for st in steps:
        if st[0] == "wait":
            page.wait_for_timeout(st[1])
        elif st[0] in ("start", "move"):
            page.evaluate(f"window.__touch.{st[0]}({json.dumps(st[1])})")
        else:
            page.evaluate(f"window.__touch.{st[0]}()")


def test_long_press_drags_unselected_object_quick_touch_does_not(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    pose0 = page.evaluate(f"window.__app.world.objects.get('{oid}').data.pose.p")
    c = center_of(page, oid)
    right = [c[0] + 0.12, c[1], c[2]]
    touch(page, ("start", {"at": c}), ("move", {"at": right}), ("wait", 100), ("end",), ("wait", 400))   # quick: no drag
    assert page.evaluate(f"window.__app.world.objects.get('{oid}').data.pose.p") == pose0
    page.evaluate("window.__app.arm(null)")
    touch(page, ("start", {"at": c}), ("wait", 750), ("move", {"at": right}), ("wait", 300), ("end",), ("wait", 600))   # hold, then drag
    p1 = next(o for o in objects_on_server(page, live_server)[1] if o["id"] == oid)["pose"]["p"]
    assert p1[0] > pose0[0] + 0.05, (pose0, p1)
    assert page.evaluate("window.__app.world.objects.size") == 1    # moved, nothing new created


def test_no_long_press_menu_over_ar(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [])
    prevented = page.evaluate("""() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.getElementById('overlay').dispatchEvent(e); return e.defaultPrevented; }""")
    assert prevented


def test_seen_tags_get_a_glowing_mark(page: Page, live_server):
    """A tag in view gets corner brackets + ripple on the paper: warm for a
    new tag, blue once it belongs to a Space; they fade when it's gone."""
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    page.wait_for_function("window.__app?.tagMarks?.marks.get(0)?.alpha > 0.9", timeout=10000)
    color = lambda: page.evaluate("window.__app.tagMarks.marks.get(0).brackets.material.color.getHexString()")
    assert color().startswith("ff"), color()                                     # amber: not a Space yet
    page.wait_for_timeout(400)
    page.screenshot(path="test-results/tagmark-new.png")
    create_space(page)
    page.wait_for_function("window.__app?.tagMarks.marks.get(0).brackets.material.color.b > 0.95", timeout=5000)   # blue: part of a Space
    s = page.evaluate("window.__app.tagMarks.marks.get(0).ring.scale.x")
    page.wait_for_timeout(500)
    assert page.evaluate("window.__app.tagMarks.marks.get(0).ring.scale.x") != s              # it moves
    page.screenshot(path="test-results/tagmark-space.png")
    set_camera(page, [])
    page.wait_for_function("!window.__app?.tagMarks.marks.has(0)", timeout=5000)    # out of view: fades away


def test_hold_ring_fills_then_picks_up(page: Page, live_server):
    """Phones: holding an object shows a filling ring under the finger; when
    it's picked up the ring pops (and the object is being dragged)."""
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=5000)
    oid = page.evaluate("[...window.__app.world.objects.keys()][0]")
    pt = page.evaluate(f"window.__app.screenPoint('{oid}')")
    c = center_of(page, oid)
    pointer(page, ("down", pt["x"], pt["y"]))
    touch(page, ("start", {"at": c}), ("wait", 200))
    assert page.evaluate("document.getElementById('ov-hold').classList.contains('filling')")
    touch(page, ("wait", 600))
    assert page.evaluate("window.__app.selectedId") == oid                                   # picked up
    assert page.evaluate("document.getElementById('ov-hold').classList.contains('picked')")
    touch(page, ("end",))
    pointer(page, ("up", pt["x"], pt["y"], 400))
    assert page.evaluate("document.getElementById('ov-hold').hidden")


def test_loading_screen_preloads_modules_then_goes_away(page: Page, live_server):
    """A refresh: every module main.js needs is listed up front (fetched in
    parallel), vendor code is cacheable, and the loading screen clears."""
    login(page, live_server)
    page.goto(live_server)
    links = page.evaluate("[...document.querySelectorAll('link[rel=modulepreload]')].map(l => l.getAttribute('href'))")
    assert "/js/main.js" in links and "/vendor/three.module.js" in links and "/js/world.js" in links
    assert not any("emulate" in l or "worker" in l for l in links)
    page.wait_for_function("!document.getElementById('boot')", timeout=10000)
    assert not page.locator("#ready").is_hidden()
    cc = page.request.get(f"{live_server}/vendor/three.module.js").headers["cache-control"]
    assert "max-age" in cc, cc


def test_android_draws_through_the_classic_xr_layer(page: Page, live_server):
    """Chrome 156 on Android shows nothing drawn into a WebXR projection layer:
    phones hide `renderState.layers` from three.js so it uses XRWebGLLayer."""
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.built && e.data.rev)", timeout=8000)
    rs = page.evaluate("({ layers: window.__xrSession.renderState.layers, base: !!window.__xrSession.renderState.baseLayer })")
    assert rs == {"layers": None, "base": True}, rs
    xyz = page.evaluate("[...window.__app.world.objects.values()][0].built.root.getWorldPosition(new (window.__app.world.objects.values().next().value.built.root.position.constructor)()).toArray()")
    px = page.evaluate(f"window.__app.samplePixel({json.dumps(xyz)})")
    assert px[3] > 0 and sum(px[:3]) > 0, px                         # the cube is in the picture


def test_change_user_signs_in_as_someone_else(page: Page, live_server):
    first = login(page, live_server)
    page.goto(f"{live_server}/?emulate=phone")
    page.wait_for_function(f"document.getElementById('who').textContent === '{first}'", timeout=10000)
    page.click("#switch-user")
    assert page.is_visible("#login") and not page.is_visible("#ready")
    page.click("#login-cancel")                                       # changed my mind
    assert page.is_visible("#ready") and page.is_hidden("#login")
    page.click("#switch-user")
    other = "u" + uuid.uuid4().hex[:8]
    page.fill("#login input[name=name]", other)
    page.click("#login button:not([type=button])")
    page.wait_for_function(f"document.getElementById('who')?.textContent === '{other}'", timeout=10000)
