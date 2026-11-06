"""Gesture trainer (/train, js/trainer.js): each gesture 5 times, right hand,
a count of 3 then a GO window per stage (shoo: select, then throw / cancel);
every stage window is a label in the hand recording. Redo / Pause / Skip only
between takes. The tests drive its clock (tick(t)) so takes run instantly."""
import importlib.util
from pathlib import Path

from playwright.sync_api import Page

from test_main import login

_spec = importlib.util.spec_from_file_location("handrec_reader", Path(__file__).resolve().parent.parent / "tools" / "handrec.py")
reader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reader)

T = "window.__trainer"


def open_trainer(page: Page, base: str):
    login(page, base)
    page.goto(f"{base}/train?emulate=quest3")
    page.wait_for_function("window.__trainer && !document.getElementById('enter').disabled", timeout=10000)
    page.click("#enter")
    page.wait_for_function(f"{T}.run.mode === 'intro'", timeout=10000)
    page.evaluate(f"window.__clock = {T}.run.t0; {T}.forceReach = true")   # (no real hands: the reach is taken as done; tested on its own below)


def advance(page: Page, ms, step=50):
    """Run the trainer's clock forward ms (in steps, like frames)."""
    page.evaluate(f"""(ms) => {{ for (let t = 0; t < ms; t += {step}) {{ window.__clock += {step}; {T}.tick(window.__clock); }} }}""", ms)


def take(page: Page):
    """One whole take: whatever is left of intro / rest, the count, every stage."""
    page.evaluate(f"""() => {{ const r = {T}.run, start = r.count;
      for (let i = 0; i < 4000 && r.count === start && r.mode !== 'done'; i++) {{ window.__clock += 50; {T}.tick(window.__clock); }} }}""")


def labels(page: Page):
    return page.evaluate(f"{T}.rec.events.filter((e) => e.kind === 'label').map((e) => [e.step, e.stage, e.side, e.rep, e.phase])")


def test_each_gesture_is_asked_5_times_and_every_window_is_a_label(page: Page, live_server, handrec_dir):
    open_trainer(page, live_server)
    assert page.evaluate(f"{T}.run.mode") == "intro" and page.evaluate(f"{T}.STEPS[0].id") == "revelio"
    for _ in range(5):
        take(page)
    got = labels(page)
    assert got == [x for r in range(1, 6) for x in (["revelio", "cast", "right", r, "start"], ["revelio", "cast", "right", r, "end"])], got
    assert page.evaluate(f"[{T}.run.i, {T}.run.mode]") == [1, "intro"]                 # on to shoo
    sid = page.evaluate(f"{T}.rec.session")
    page.evaluate(f"{T}.rec.cut()")
    page.wait_for_function(f"{T}.rec.stats.chunks >= 1", timeout=8000)
    s = reader.load_session(handrec_dir, sid)                                          # saved with the recording
    assert sum(1 for e in s["events"] if e.get("kind") == "label" and e.get("source") == "trainer") == 10


def test_shoo_is_two_stages_select_then_throw_and_cancel_has_its_own_step(page: Page, live_server):
    open_trainer(page, live_server)
    page.evaluate(f"{T}.press('skip')")                                                # past Revelio
    take(page)
    assert labels(page) == [["shoo", "select", "right", 1, "ready"], ["shoo", "select", "right", 1, "start"], ["shoo", "select", "right", 1, "end"],
                            ["shoo", "throw", "right", 1, "start"], ["shoo", "throw", "right", 1, "end"]]
    assert page.evaluate(f"{T}.cube.visible")                                           # the thing to shoo is there
    page.evaluate(f"{T}.press('skip')")
    take(page)
    assert [l[1] for l in labels(page)[-5:]] == ["select", "select", "select", "cancel", "cancel"]   # (ready, start, end; start, end)
    assert page.evaluate(f"{T}.rec.events.filter((e) => e.kind === 'label').at(-1).gesture") == "shoo"


def test_buttons_work_only_between_takes_redo_pause_and_skip(page: Page, live_server):
    open_trainer(page, live_server)
    advance(page, 2500 + 2100 + 100)                                                     # intro, count: now in GO
    assert page.evaluate(f"{T}.run.mode") == "go"
    assert page.evaluate(f"{T}.press('skip')") is False                                 # mid-gesture: nothing
    take(page)
    take(page)
    assert page.evaluate(f"{T}.run.count") == 2
    assert page.evaluate(f"{T}.press('redo')")                                          # take 2 was off: again
    assert page.evaluate(f"[{T}.run.count, {T}.run.rep]") == [1, 1]
    assert labels(page)[-1] == ["revelio", None, "right", 2, "discard"]
    assert page.evaluate(f"{T}.press('pause')") and page.evaluate(f"{T}.run.mode") == "paused"
    advance(page, 5000)
    assert page.evaluate(f"{T}.run.mode") == "paused"                                   # stays paused
    page.evaluate(f"{T}.press('pause')")
    take(page)
    assert page.evaluate(f"{T}.run.count") == 2 and labels(page)[-1][3] == 2           # take 2 again


def test_the_buttons_are_within_reach_low_on_the_left_and_found_where_drawn(page: Page, live_server):
    open_trainer(page, live_server)
    ids = page.evaluate(f"""async () => {{ const THREE = await import('three'); const p = {T}.controls; p.updateWorldMatrix(true, false);
      const at = (u, v) => {T}.buttonAt(p.localToWorld(new THREE.Vector3((u - 0.5) * 0.3, (0.5 - v) * 0.065, 0)))?.id ?? null;
      return [at(0.12, 0.5), at(0.37, 0.5), at(0.62, 0.5), at(0.87, 0.5), at(0.5, 0.02)]; }}""")
    assert ids == ["redo", "pause", "skip", "mode", None]
    c, head = page.evaluate(f"[{T}.controls.getWorldPosition({T}.controls.position.clone()).toArray(), {T}.head.position.toArray()]")
    dist = sum((a - b) ** 2 for a, b in zip(c, head)) ** 0.5
    assert dist < 0.6 and head[1] - c[1] > 0.25, (c, head)                             # an arm's reach, below the eyes


def test_a_pinch_presses_the_button_under_the_hand_beam(page: Page, live_server):
    open_trainer(page, live_server)
    take(page)
    page.evaluate(f"{T}.rays.right.on = 'redo'")                                       # (the beam is on Redo)
    page.evaluate("""() => window.__xrSession.dispatchEvent(Object.assign(new Event('selectstart'),
      { inputSource: { handedness: 'right', hand: {} }, frame: null }))""")
    assert page.evaluate(f"{T}.run.count") == 0 and labels(page)[-1][4] == "discard"


def test_takes_on_a_thing_wait_for_the_hand_to_get_there(page: Page, live_server):
    open_trainer(page, live_server)
    page.evaluate(f"{T}.press('skip')")                                                # to shoo
    page.evaluate(f"{T}.forceReach = false")
    advance(page, 2500 + 2100 + 100)
    assert page.evaluate(f"{T}.run.mode") == "reach"                                     # counted, waiting for the hand
    advance(page, 5000)
    assert page.evaluate(f"{T}.run.mode") == "reach" and labels(page) == []             # nothing labelled while reaching
    page.evaluate(f"{T}.forceReach = true")
    advance(page, 400)
    assert page.evaluate(f"{T}.run.mode") == "go"
    assert [l[4] for l in labels(page)] == ["ready", "start"]


def test_the_start_page_links_the_trainer(page: Page, live_server):
    login(page, live_server)
    page.goto(live_server)
    page.click("text=Gesture trainer")
    page.wait_for_url("**/train")
    assert "Gesture trainer" in page.text_content("h1")


def test_a_redone_take_is_a_new_take_and_the_bad_one_drops_out(page: Page, live_server, handrec_dir):
    open_trainer(page, live_server)
    take(page)
    take(page)
    page.evaluate(f"{T}.press('redo')")
    take(page)
    takes = page.evaluate(f"{T}.rec.events.filter((e) => e.kind === 'label' && e.phase === 'start').map((e) => [e.rep, e.take])")
    assert takes == [[1, 1], [2, 2], [2, 3]], takes                                    # rep 2 twice, as takes 2 and 3
    sid = page.evaluate(f"{T}.rec.session")
    page.evaluate(f"{T}.rec.cut()")
    page.wait_for_function(f"{T}.rec.stats.chunks >= 1", timeout=8000)
    w = reader.windows(reader.load_session(handrec_dir, sid))
    assert [(x["rep"], x["take"]) for x in w] == [(1, 1), (2, 3)]                      # the redone take 2 left out


def open_test(page: Page, base: str):
    login(page, base)
    page.goto(f"{base}/train?emulate=quest3")
    page.wait_for_function("window.__trainer && !document.getElementById('enter-test').disabled", timeout=10000)
    page.click("#enter-test")
    page.wait_for_function(f"{T}.run.mode === 'intro' && {T}.run.kind === 'test'", timeout=10000)
    page.evaluate(f"window.__clock = {T}.run.t0; {T}.forceReach = true")


def to_go(page: Page):
    page.evaluate(f"""() => {{ const r = {T}.run; for (let i = 0; i < 4000 && r.mode !== 'go'; i++) {{ window.__clock += 50; {T}.tick(window.__clock); }} }}""")


def results(page: Page):
    return page.evaluate(f"{T}.rec.events.filter((e) => e.kind === 'label' && e.phase === 'end').map((e) => [e.step, e.result, e.why])")


def test_mode_goes_back_to_the_choice_and_test_can_be_picked_there(page: Page, live_server):
    open_trainer(page, live_server)
    take(page)
    assert page.evaluate(f"{T}.press('mode')") and page.evaluate(f"{T}.run.mode") == "choose"
    assert page.evaluate(f"{T}.press('skip')") is False                                 # only Train / Test there
    ids = page.evaluate(f"""async () => {{ const THREE = await import('three'); const p = {T}.controls; p.updateWorldMatrix(true, false);
      return [0.25, 0.75].map((u) => {T}.buttonAt(p.localToWorld(new THREE.Vector3((u - 0.5) * 0.3, 0, 0)))?.id); }}""")
    assert ids == ["train", "test"]
    page.evaluate(f"{T}.press('test')")
    assert page.evaluate(f"[{T}.run.kind, {T}.run.mode, {T}.run.i, {T}.run.count]") == ["test", "intro", 0, 0]


def test_test_mode_scores_what_the_detectors_catch(page: Page, live_server):
    open_test(page, live_server)
    to_go(page)                                                                          # Revelio try 1: caught
    page.evaluate(f"{T}.seen({{ type: 'cast', side: 'right', cm: 18, ms: 300 }}, window.__clock + 800)")
    assert page.evaluate(f"[{T}.run.mode, {T}.run.result.result, {T}.run.result.ms]") == ["rest", "hit", 800]
    to_go(page)                                                                          # try 2: a near miss, then time runs out
    page.evaluate(f"{T}.seen({{ type: 'near', side: 'right', cm: 9, why: 'palm not away' }}, window.__clock)")
    advance(page, 5100)
    assert results(page)[-1] == ["revelio", "miss", "palm not away"]
    page.evaluate(f"{T}.press('skip')")                                                  # to shoo
    to_go(page)
    page.evaluate(f"{T}.seen({{ type: 'gather', side: 'right', kind: 'bunch' }}, window.__clock); {T}.seen({{ type: 'shoo', side: 'right', deg: 70 }}, window.__clock + 900)")
    assert results(page)[-1] == ["shoo", "hit", None]
    page.evaluate(f"{T}.press('skip')")                                                  # pick, then cancel
    to_go(page)
    page.evaluate(f"{T}.seen({{ type: 'gather', side: 'right' }}, window.__clock); {T}.seen({{ type: 'spread', side: 'right' }}, window.__clock + 500)")
    assert page.evaluate(f"{T}.run.mode") == "go"                                        # a cancel is only sure at the end
    advance(page, 5100)
    assert results(page)[-1] == ["shoo-cancel", "hit", None]
    to_go(page)
    page.evaluate(f"{T}.seen({{ type: 'gather', side: 'right' }}, window.__clock); {T}.seen({{ type: 'shoo', side: 'right', deg: 60 }}, window.__clock + 500)")
    assert results(page)[-1] == ["shoo-cancel", "wrong", "shoo (it threw)"]
    page.evaluate(f"{T}.press('skip')"); page.evaluate(f"{T}.press('skip')")             # to "nothing"
    to_go(page)
    page.evaluate(f"{T}.seen({{ type: 'cast', side: 'left', cm: 16, ms: 400 }}, window.__clock + 3000)")
    assert results(page)[-1] == ["none", "false", "cast"]                                # a false alarm, either hand
    to_go(page)
    advance(page, 10100)
    assert results(page)[-1] == ["none", "pass", None]
    score = page.evaluate(f"{T}.run.score")
    assert score == {"revelio": {"ok": 1, "n": 2}, "shoo": {"ok": 1, "n": 1}, "shoo-cancel": {"ok": 1, "n": 2}, "none": {"ok": 1, "n": 2}}, score
    assert page.evaluate(f"{T}.rec.events.filter((e) => e.kind === 'label' && e.phase === 'end').every((e) => e.source === 'test')")
