"""A headset-only Space (anchors, no tag) can't be found by phones: its things
can move into the tagged Space lined up with it, staying where they are in the
room (world.mergeOffer / moveAll); new things prefer the tagged one."""
import json
import uuid

from playwright.sync_api import Page

from test_main import TAG_A, create_space, login, open_ar, place

# A client-side, headset-only Space at x+1 m turned 90°, with one box in it 0.5 m along its x.
FAKE = """async (layer) => {
  const THREE = await import('three');
  const w = window.__app.world, id = crypto.randomUUID(), oid = crypto.randomUUID();
  const s = w.addSpace({ id, name: 'Headset only', sharedLayer: 'its-shared-layer' });
  s.root.matrix.compose(new THREE.Vector3(1, 0, -1), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1));
  s.aligned = true; s.root.visible = true; s.root.updateMatrixWorld(true);
  w.apply({ id: oid, space: id, layer: 'its-shared-layer', rev: 1, pose: { p: [0.5, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] }, components: { mesh: { primitive: 'box' } } });
  return { id, oid }; }"""

WORLD_POS = """async (oid) => { const THREE = await import('three');
  const e = window.__app.world.objects.get(oid), s = window.__app.world.spaces.get(e.data.space);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...e.data.pose.p), new THREE.Quaternion(...e.data.pose.q), new THREE.Vector3(1, 1, 1));
  return new THREE.Vector3().setFromMatrixPosition(s.root.matrix.clone().multiply(m)).toArray(); }"""


def setup(page: Page, live_server):
    login(page, live_server)
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place(page)
    page.wait_for_function("[...window.__app.world.objects.values()].some(e => e.data.rev)", timeout=8000)
    layer = page.evaluate("[...window.__app.world.objects.values()][0].data.layer")
    tag_space = page.evaluate("[...window.__app.world.spaces.values()].find(s => s.markers.size).id")
    return layer, tag_space


def test_things_in_a_tagless_space_move_into_the_tagged_one_in_place(page: Page, live_server):
    layer, tag_space = setup(page, live_server)
    fake = page.evaluate(FAKE, layer)
    before = page.evaluate(WORLD_POS, fake["oid"])
    merge = page.evaluate("window.__app.menu.data().merge")
    assert merge and merge["from"] == "Headset only" and merge["things"] == 1, merge
    page.evaluate("window.__app.menu.mergeSpaces()")
    page.wait_for_function(f"window.__app.world.objects.get('{fake['oid']}')?.data.space === '{tag_space}' && window.__app.world.objects.get('{fake['oid']}').data.rev", timeout=8000)
    after = page.evaluate(WORLD_POS, fake["oid"])
    assert all(abs(a - b) < 1e-3 for a, b in zip(before, after)), (before, after)
    objs = page.request.get(f"{live_server}/api/objects?space={tag_space}").json()["objects"]
    assert any(o["id"] == fake["oid"] for o in objs)               # saved: phones get it
    shared = page.evaluate(f"window.__app.world.spaces.get('{tag_space}').sharedLayer")
    assert [o["layer"] for o in objs if o["id"] == fake["oid"]] == [shared]   # on the tagged Space's shared layer (deleting the old one can't take it)
    assert page.evaluate("window.__app.menu.data().merge") is None   # nothing left to move
    assert any("moved 1 of 1" in l for l in page.evaluate("window.__app.lines"))


def test_new_things_prefer_the_tagged_space_over_a_nearer_headset_only_one(page: Page, live_server):
    layer, tag_space = setup(page, live_server)
    fake = page.evaluate(FAKE, layer)
    near_fake = page.evaluate(f"""async () => {{ const THREE = await import('three'); const w = window.__app.world;
      return w.spaceNear(new THREE.Vector3(1, 0, -1)).id; }}""")
    assert near_fake == tag_space
    far = page.evaluate("""async () => { const THREE = await import('three'); const w = window.__app.world;
      const s = w.spaces.get(%s); s.root.matrix.setPosition(30, 0, 0); return w.spaceNear(new THREE.Vector3(30, 0, 0)).id; }""" % json.dumps(fake["id"]))
    assert far == fake["id"]                                        # much nearer still wins
