"""Hand recording for gesture training (client/js/handrec.js, server/handrec.py,
tools/handrec.py): the Quest records both hands + head every frame in 10 s
chunks with everything logged alongside as possible labels; the server keeps
them under data/handrec/ up to a cap."""
import gzip
import importlib.util
import json
import struct
import uuid
from pathlib import Path

import numpy as np
import pytest
from playwright.sync_api import Page

from server import make_app
from test_main import login as page_login
from test_quest import open_quest

_spec = importlib.util.spec_from_file_location("handrec_reader", Path(__file__).resolve().parent.parent / "tools" / "handrec.py")
reader = importlib.util.module_from_spec(_spec)   # tools/handrec.py (server/handrec.py has the same name)
_spec.loader.exec_module(reader)


def chunk(frames=3, events=()):
    """A tiny valid chunk (format v1) with hands 0.3 m in front of the head."""
    header = {"format": "stratum-handrec", "version": 1, "session": "s", "seq": 0, "t0Epoch": 1000, "frames": frames,
              "joints": 25, "posScale": 10000, "events": list(events)}
    hj = json.dumps(header).encode()
    t = np.arange(frames, dtype="<f4") * 14
    head = np.tile(np.array([0, 1.6, 0, 0, 0, 0, 1], "<f4"), (frames, 1))
    flags = np.full(frames, 3, "u1")
    hands = np.zeros((frames, 2, 79), "<i2")
    hands[:, :, 2:75:3] = -3000                                        # z −0.3 m relative to the head
    return gzip.compress(struct.pack("<I", len(hj)) + hj + t.tobytes() + head.tobytes() + flags.tobytes() + hands.tobytes())


@pytest.fixture
async def server(aiohttp_server, tmp_path):
    return await aiohttp_server(make_app(str(tmp_path / "t.db"), tmp_path / "tel", tmp_path / "assets",
                                         handrec_dir=tmp_path / "handrec", handrec_cap=200_000))


async def test_chunks_are_kept_as_sent_and_indexed(aiohttp_client, server, tmp_path):
    c = await aiohttp_client(server)
    sid = str(uuid.uuid4())
    assert (await c.post(f"/api/handrec?session={sid}&seq=0&gz=1", data=chunk())).status == 401   # signed in only
    await c.post("/api/login", json={"name": "alice"})
    body = chunk(events=[{"ts": 1010, "kind": "log", "msg": "revelio cast"}])
    r = await c.post(f"/api/handrec?session={sid}&seq=0&gz=1", data=body, headers={"x-device": "quest-1"})
    assert r.status == 204, await r.text()
    [p] = list((tmp_path / "handrec").glob(f"*/{sid}/00000.hrec.gz"))
    assert p.read_bytes() == body
    idx = [json.loads(l) for l in (tmp_path / "handrec" / "index.jsonl").read_text().splitlines()]
    assert idx[0]["session"] == sid and idx[0]["device"] == "quest-1" and idx[0]["bytes"] == len(body)
    s = reader.load_session(tmp_path / "handrec", sid)                  # tools/handrec.py reads it back
    assert s["joints"].shape == (3, 2, 25, 3) and s["tracked"].all()
    assert np.allclose(s["joints"][:, :, :, 2], -0.3) and np.allclose(s["joints"][:, :, :, 1], 1.6)
    assert s["events"][0]["msg"] == "revelio cast" and s["t"][1] == 1014


async def test_bad_uploads_are_refused_and_it_stops_at_the_cap(aiohttp_client, server):
    c = await aiohttp_client(server)
    await c.post("/api/login", json={"name": "alice"})
    sid = str(uuid.uuid4())
    assert (await c.post("/api/handrec?session=nope&seq=0&gz=1", data=chunk())).status == 400
    assert (await c.post(f"/api/handrec?session={sid}&seq=-1&gz=1", data=chunk())).status == 400
    assert (await c.post(f"/api/handrec?session={sid}&seq=0&gz=1", data=b"plain")).status == 400   # says gzip, isn't
    big = bytes(150_000)
    assert (await c.post(f"/api/handrec?session={sid}&seq=1&gz=0", data=big)).status == 204
    assert (await c.post(f"/api/handrec?session={sid}&seq=2&gz=0", data=big)).status == 507        # over the 200 kB cap


def test_quest_records_hands_head_and_labels_while_in_ar(page: Page, live_server, handrec_dir):
    page_login(page, live_server)
    page.add_init_script("localStorage.setItem('stratum.handrec', '1')")   # (off by default: switched on in Settings)
    open_quest(page, live_server)
    page.evaluate("window.__xrDevice.primaryInputMode = 'hand'")
    page.wait_for_function("window.__app.hands().tracked.left && window.__app.hands().tracked.right", timeout=5000)
    page.evaluate("() => { const d = window.__xrDevice; d.hands.left.position.set(-0.15, 1.35, -0.3); d.hands.right.position.set(0.15, 1.35, -0.3); }")
    assert page.evaluate("window.__app.handRec.recording")
    page.wait_for_function("window.__app.handRec.n > 10", timeout=8000)
    page.evaluate("window.__telemetry.info('test label', { gesture: 'shoo' })")      # every log line rides along
    page.evaluate("window.__app.handRec.event('xr', { type: 'selectstart', side: 'right', hand: true })")
    sid = page.evaluate("window.__app.handRec.session")
    page.evaluate("window.__app.handRec.cut()")
    page.wait_for_function("window.__app.handRec.stats.chunks >= 1", timeout=8000)
    s = reader.load_session(handrec_dir, sid)
    assert len(s["t"]) > 10 and s["tracked"].all()
    left = np.nanmean(s["joints"][:, 0, 0], axis=0)                      # the left wrist, about where the hand is
    assert abs(left[0] + 0.15) < 0.15 and abs(left[1] - 1.35) < 0.15 and abs(left[2] + 0.3) < 0.15, left
    assert np.allclose(np.linalg.norm(s["wrist_q"][:, 0], axis=1), 1, atol=0.01)
    labels = [reader.label_of(e) for e in s["events"]]
    assert "test label" in labels and "xr:selectstart" in labels, labels
    assert s["meta"][0]["context"]["apps"] == [] and s["meta"][0]["radii"]["left"]


def test_recording_is_off_until_switched_on_in_settings(page: Page, live_server):
    page_login(page, live_server)
    open_quest(page, live_server)
    assert page.evaluate("window.__app.menu.data().settings.handRec.on") is False
    assert page.evaluate("window.__app.handRec.recording") is False
    page.evaluate("window.__app.menu.setSetting('handRec', true)")
    page.wait_for_function("window.__app.handRec.recording", timeout=5000)
    assert page.evaluate("localStorage.getItem('stratum.handrec')") == "1"
    page.evaluate("window.__app.menu.setSetting('handRec', false)")
    assert page.evaluate("window.__app.handRec.recording") is False
    assert page.evaluate("localStorage.getItem('stratum.handrec')") == "0"
