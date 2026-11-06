"""Browser backend, the real container (conftest builds and runs it): real
Chrome on a virtual display, driven over DevTools, streaming over a
WebSocket. Called the way Stratum's proxy calls it (signed requests).
Each test is its own player, so its own Chrome."""
import asyncio
import json
import uuid

import aiohttp
import av
import pytest

from backend_kit import signed

BROWSER_TIMEOUT = 20


class Player:
    def __init__(self, backends):
        self.base = f"http://127.0.0.1:{backends['apps']['browser']['port']}"
        self.secret = backends["secrets"]["browser"]
        self.site = backends["test_site"]
        self.user = f"t-{uuid.uuid4().hex[:10]}"
        self.http = aiohttp.ClientSession()

    def pane(self, name):
        return f"{name}-{self.user}"

    def h(self, method, path, user=None):
        return signed("browser", self.secret, method, path, user or self.user)

    async def get(self, path, user=None):
        async with self.http.get(self.base + path, headers=self.h("GET", path, user)) as r:
            return r.status, (await r.json() if r.content_type == "application/json" else await r.text())

    async def post(self, path, body):
        async with self.http.post(self.base + path, json=body, headers=self.h("POST", path)) as r:
            return r.status, (await r.json() if r.content_type == "application/json" else await r.text())

    async def stream(self, pane, codec="jpeg", audio=0):
        path = f"/panes/{pane}/stream?codec={codec}&audio={audio}"
        return Stream(await self.http.ws_connect(self.base + path, headers=self.h("GET", path)))

    async def until(self, pane, pred, timeout=BROWSER_TIMEOUT):
        for _ in range(int(timeout / 0.2)):
            _, info = await self.get(f"/panes/{pane}")
            if pred(info):
                return info
            await asyncio.sleep(0.2)
        raise AssertionError(f"timed out; last info: {info}")


class Stream:
    """Collects what a pane's socket sends: JSON messages and binary chunks by kind."""
    def __init__(self, ws):
        self.ws, self.texts, self.chunks = ws, [], {1: [], 2: [], 3: []}
        self.task = asyncio.create_task(self.read())

    async def read(self):
        async for m in self.ws:
            if m.type == aiohttp.WSMsgType.TEXT:
                self.texts.append(json.loads(m.data))
            elif m.type == aiohttp.WSMsgType.BINARY:
                self.chunks[m.data[0]].append(m.data)

    def info(self):
        return [t for t in self.texts if t.get("t") == "info"][-1]

    async def send(self, ev):
        await self.ws.send_str(json.dumps(ev))

    async def close(self):
        await self.ws.close()
        self.task.cancel()


@pytest.fixture
async def player(app_backends):
    p = Player(app_backends)
    yield p
    await p.http.close()


async def test_a_pane_opens_its_home_page_as_a_real_chrome_tab(player):
    status, info = await player.get(f"/panes/{player.pane('p1')}")
    assert status == 200 and info["title"] == "Test Home" and (info["width"], info["height"]) == (1280, 800)
    assert [t["title"] for t in info["tabs"]] == ["Test Home"] and info["tabs"][0]["active"]
    await player.post(f"/panes/{player.pane('p1')}/input", {"type": "goto", "url": player.site + "/fp.html"})
    info = await player.until(player.pane('p1'), lambda i: i["title"].startswith("webdriver"))
    assert info["title"] == "webdriver=false tz=America/New_York screen=3840", info["title"]   # what sites see: an ordinary desktop Chrome


@pytest.mark.parametrize("codec,kind,magic", [("h264", 1, b"\x00\x00\x00\x01"), ("vp8", 1, None), ("jpeg", 3, b"\xff\xd8")])
async def test_the_stream_sends_config_state_and_pictures(player, codec, kind, magic):
    await player.get(f"/panes/{player.pane('s1')}")
    s = await player.stream(player.pane('s1'), codec)
    await asyncio.sleep(2.5)
    await s.close()
    assert s.texts[0]["t"] == "config" and s.texts[0]["width"] == 1280
    assert s.texts[0]["codec"] == {"h264": "avc1.42E028", "vp8": "vp8", "jpeg": "jpeg"}[codec]
    assert s.info()["title"] == "Test Home"
    pics = s.chunks[kind]
    assert pics, "no pictures"
    assert pics[0][1] == 1                                        # starts with a key frame
    if magic:
        assert pics[0][10:14] == magic or pics[0][10:12] == magic[:2]
    if codec != "jpeg":
        assert len(pics) > 30                                     # ~30 fps, even for a still page
        assert sum(1 for p in pics if p[1]) <= 3                  # key frames only every 2 s
        if codec == "h264":                                       # and it is the page: white under the button
            dec = av.CodecContext.create("h264", "r")
            frame = next(f for p in pics[:3] for f in dec.decode(av.Packet(p[10:])))
            g = frame.reformat(format="gray").planes[0]
            assert bytes(g)[700 * g.line_size + 600] > 150       # the blue-white gradient, not Chrome's dark toolbar


async def test_click_scroll_type_keys_and_history(player):
    await player.get(f"/panes/{player.pane('c1')}")
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "click", "x": 0.5, "y": 0.2})
    await player.until(player.pane('c1'), lambda i: i["title"] == "Clicked")
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "scroll", "dy": 900})
    await player.until(player.pane('c1'), lambda i: i["title"].startswith("Scrolled"))
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "goto", "url": player.site + "/form.html"})
    await player.until(player.pane('c1'), lambda i: i["title"] == "Form")
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "click", "x": 0.5, "y": 0.2})
    await player.until(player.pane('c1'), lambda i: i["focus"] == {"kind": "search", "label": "Search the site"})   # → the headset's keyboard comes up
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "type", "text": "hello"})
    await player.until(player.pane('c1'), lambda i: i["title"] == "Q:hello")
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "key", "key": "Control+a"})
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "key", "key": "Backspace"})
    await player.post(f"/panes/{player.pane('c1')}/input", {"type": "type", "text": "x"})
    await player.until(player.pane('c1'), lambda i: i["title"] == "Q:x")      # select-all + delete worked
    _, info = await player.post(f"/panes/{player.pane('c1')}/input", {"type": "key", "key": "Enter"})
    info = await player.until(player.pane('c1'), lambda i: i["title"] == "Sent:x" and i["focus"] is None)   # submitted, field left: keyboard can go
    _, info = await player.post(f"/panes/{player.pane('c1')}/input", {"type": "back"})
    await player.until(player.pane('c1'), lambda i: i["title"].startswith(("Test Home", "Clicked", "Scrolled")) and i["forward"])


async def test_url_rules_and_unknown_input(player):
    await player.get(f"/panes/{player.pane('u1')}")
    _, info = await player.post(f"/panes/{player.pane('u1')}/input", {"type": "goto", "url": "cats and dogs"})   # words: a search
    await player.until(player.pane('u1'), lambda i: "two.html?q=cats%20and%20dogs" in i["url"])
    status, _ = await player.post(f"/panes/{player.pane('u1')}/input", {"type": "goto", "url": "file:///etc/passwd"})
    assert status == 400
    status, _ = await player.post(f"/panes/{player.pane('u1')}/input", {"type": "key", "key": "F13"})
    assert status == 400
    status, _ = await player.post(f"/panes/{player.pane('u1')}/input", {"type": "warp"})
    assert status == 400


async def test_tabs_new_switch_close_pop_ups_and_new_tab_links(player):
    await player.get(f"/panes/{player.pane('t1')}")
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "goto", "url": player.site + "/links.html"})
    await player.until(player.pane('t1'), lambda i: i["title"] == "Links")
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "click", "x": 0.75, "y": 0.2})                # target=_blank: a new tab, shown
    info = await player.until(player.pane('t1'), lambda i: len(i["tabs"]) == 2 and i["title"] == "Page Two")
    links = info["tabs"][0]["id"]
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "tab", "tab": links})
    await player.until(player.pane('t1'), lambda i: i["title"] == "Links")
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "click", "x": 0.25, "y": 0.2})                # window.open pop-up: a tab of this pane
    info = await player.until(player.pane('t1'), lambda i: len(i["tabs"]) == 3 and i["title"] == "Page Two")
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "newtab", "url": player.site + "/form.html"})
    info = await player.until(player.pane('t1'), lambda i: len(i["tabs"]) == 4 and i["title"] == "Form")
    form = next(t["id"] for t in info["tabs"] if t["active"])
    await player.post(f"/panes/{player.pane('t1')}/input", {"type": "closetab", "tab": form})
    info = await player.until(player.pane('t1'), lambda i: len(i["tabs"]) == 3)
    assert form not in [t["id"] for t in info["tabs"]]


async def test_suggestions_come_from_history(player):
    await player.get(f"/panes/{player.pane('h1')}")
    await player.post(f"/panes/{player.pane('h1')}/input", {"type": "goto", "url": player.site + "/two.html"})
    await player.until(player.pane('h1'), lambda i: i["title"] == "Page Two" and not i["loading"])
    await asyncio.sleep(0.3)
    _, r = await player.get(f"/panes/{player.pane('h1')}/suggest?q=two")
    assert r["items"] and r["items"][0]["url"].endswith("/two.html") and r["items"][0]["title"] == "Page Two"
    _, r = await player.get(f"/panes/{player.pane('h1')}/suggest?q=Page%20Tw")   # by title too
    assert r["items"]


async def test_sound_streams_as_opus(player):
    _, health = await player.get("/health")
    assert health["audio"] is True
    await player.get(f"/panes/{player.pane('a1')}")
    await player.post(f"/panes/{player.pane('a1')}/input", {"type": "goto", "url": player.site + "/tone.html"})
    await player.until(player.pane('a1'), lambda i: i["title"] == "Tone")
    s = await player.stream(player.pane('a1'), "jpeg", audio=1)
    await asyncio.sleep(1)
    await player.post(f"/panes/{player.pane('a1')}/input", {"type": "click", "x": 0.5, "y": 0.5})
    await player.until(player.pane('a1'), lambda i: i["title"] == "Playing")
    await asyncio.sleep(1.5)
    await s.close()
    packets = s.chunks[2]
    assert len(packets) > 40                                       # 20 ms each
    dec, peak = av.CodecContext.create("libopus", "r"), 0.0
    import array
    for p in packets[-25:]:
        for f in dec.decode(av.Packet(p[10:])):
            s16 = f.format.name.startswith("s16")
            a = array.array("h" if s16 else "f", bytes(f.planes[0])[: f.samples * (2 if s16 else 4)])
            peak = max(peak, max(abs(x) for x in a) / (32768 if s16 else 1))
    assert peak > 0.5, peak                                        # the tone, not silence


async def test_panes_are_per_player_capped_and_reopen_with_their_tabs(player):
    await player.get(f"/panes/{player.pane('r1')}")
    await player.post(f"/panes/{player.pane('r1')}/input", {"type": "newtab", "url": player.site + "/two.html"})
    await player.until(player.pane('r1'), lambda i: len(i["tabs"]) == 2 and i["title"] == "Page Two")
    status, _ = await player.get(f"/panes/{player.pane('r1')}", user="intruder")    # someone else's pane
    assert status == 403
    await player.get(f"/panes/{player.pane('r2')}")
    await player.get(f"/panes/{player.pane('r3')}")                                  # BROWSER_MAX_PANES = 3 in tests
    status, _ = await player.get(f"/panes/{player.pane('r4')}")                      # at the cap: the idle one used longest ago (r1) closes
    assert status == 200
    await player.get(f"/panes/{player.pane('r1')}")                               # r1 comes back (the idle r2 makes room) with both tabs
    info = await player.until(player.pane('r1'), lambda i: [t["url"].rsplit("/", 1)[-1] for t in i["tabs"]] == ["index.html", "two.html"])
    assert info["tabs"][1]["active"]
    async with player.http.delete(player.base + f"/panes/{player.pane('r2')}", headers=player.h("DELETE", f"/panes/{player.pane('r2')}")) as r:
        assert r.status == 204
