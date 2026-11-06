"""Gesture Studio (apps/gestures): perfect examples the real detectors catch,
live meters, recordings saved (packed, ≤ 16 KB each) and replayed with a ✓ / ✗."""
from playwright.sync_api import Page

from test_apps_e2e import enable, place_app
from test_main import TAG_A, create_space, login, open_ar

S = "window.__studio"


def start(page: Page, live_server):
    login(page, live_server)
    enable(page, live_server, "gestures")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    place_app(page, "gestures")
    page.wait_for_function("window.__studio?.ctx.studio?.board", timeout=15000)


# The example, as frames a viewer standing in front of the studio would see.
DEMO = """([id, side, loops]) => { const THREE = window.__studio.ctx.THREE; const frames = [];
  const head = new THREE.Vector3(0, 0.45, 0.5), loop = { revelio: 2.6, shoo: 2.6, back: 2.2, flip: 2.6 }[id];
  for (let i = 0; i < loops * loop * 72; i++) { const t = i / 72 * 1000, j = window.__studio.demo(id, (t / 1000 / loop) % 1, side);
    const c = j[0].clone().add(j[10]).multiplyScalar(0.5), gaze = c.clone().sub(head).normalize();
    frames.push({ t, head, gaze, joints: j }); }
  return { side, frames }; }"""


def test_every_perfect_example_passes_its_detector(page: Page, live_server):
    start(page, live_server)
    for gid in ("revelio", "shoo", "back", "flip"):
        for side in ("right", "left"):
            ok = page.evaluate(f"(() => {{ const s = ({DEMO})(['{gid}', '{side}', 1]); return window.__studio.detect('{gid}', s); }})()")
            assert ok, (gid, side)
    # …and another gesture's example doesn't pass for Revelio (it's specific).
    assert not page.evaluate(f"(() => window.__studio.detect('revelio', ({DEMO})(['flip', 'right', 1])))()")


def test_record_saves_a_packed_sample_and_replays_it(page: Page, live_server):
    start(page, live_server)
    # Stand-in for your hand: the Revelio example, played live into ctx.hands().
    page.evaluate("""(() => { const st = window.__studio, ctx = st.ctx, THREE = ctx.THREE, t0 = performance.now();
      ctx.viewer = () => ({ position: new THREE.Vector3(0, 0.45, 0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -0.32, -0.45).normalize()) });
      ctx.hands = () => ({ left: null, right: { joints: st.demo('revelio', ((performance.now() - t0) / 2600) % 1, 'right'), scale: 1, pinch: 0.1 } }); })()""")
    page.wait_for_function("window.__studio.ctx.studio.count >= 1", timeout=8000)            # live: caught
    page.evaluate(f"{S}.record()")
    page.wait_for_function(f"{S}.samples().length === 1", timeout=20000)                      # 3 s countdown + 2.5 s (+ slow frames)
    sample = page.evaluate(f"{S}.samples()[0]")
    assert sample["side"] == "right" and sample["ok"] is True, sample
    enc = page.evaluate(f"(async () => {{ const r = await fetch('/api/apps/gestures/state/' + encodeURIComponent('{sample['key']}')); return await r.json(); }})()")
    raw = len(str(enc))
    assert raw < 16 * 1024, raw
    n = page.evaluate(f"(async () => {{ const r = await fetch('/api/apps/gestures/state/' + encodeURIComponent('{sample['key']}')); return window.__studio.decode((await r.json()).value).frames.length; }})()")
    assert 6 <= n <= 62, n                                                                   # 2.5 s at ≤ 24 Hz (fewer when the emulator is slow)
    page.evaluate(f"{S}.play()")
    page.wait_for_function("window.__studio.ctx.studio.puppets.right.group.visible && window.__studio.ctx.studio.mode === 'mine'", timeout=3000)
