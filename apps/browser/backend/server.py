"""Browser backend: real web pages for AR panes, in a real Chrome.

WebXR can't render web pages into 3D, so Chrome runs here: one per player,
on its own virtual display, with a persistent profile (chrome.py). Each pane
is a Chrome window with real tabs. A pane's WebSocket streams its picture
(H.264 / VP8 / JPEG) and sound (Opus), plus live state: tabs, URL, title,
back/forward, and which text field has focus (so the headset's keyboard can
come up by itself). Input (pointer, wheel, keys, text, navigation, tabs)
arrives on the socket or as POST /input. stream.py does the encoding.

Reached only through Stratum's proxy, which signs the player (an app
pseudonym): a player only ever sees their own Chrome.
Security note: pages load from this server's network, LAN included.
"""
import argparse
import asyncio
import json
import os
import re
import time
import urllib.parse

from aiohttp import WSMsgType, web

import cdp
import chrome
from chrome import Chromes
from stratum_backend import Stratum
from stream import AudioStream, VideoStream

HOME = os.environ.get("BROWSER_HOME", "https://www.google.com/")
SEARCH = os.environ.get("BROWSER_SEARCH", "https://www.google.com/search?q=")
MAX_PANES = min(chrome.COLS * chrome.ROWS, int(os.environ.get("BROWSER_MAX_PANES", 99)))   # open at once, per player (slots on their display)
IDLE_CLOSE_S = float(os.environ.get("BROWSER_IDLE_S", 300))   # close panes nobody watches
SESSION_IDLE_S = 600                          # and a player's Chrome once they have no panes
POLL_S = 0.2                                  # focused field + page size, while someone watches
KEY_RE = re.compile(r"^((Control|Alt|Shift|Meta)\+){0,3}([A-Za-z0-9]|F\d{1,2}|Enter|Backspace|Tab|Escape|Arrow(Up|Down|Left|Right)|"
                    r"Page(Up|Down)|Home|End|Delete|Insert|Space|[-=\[\];',./`\\])$")


def normalize_url(text):
    """What the user typed → a URL. Plain words become a search."""
    text = (text or "").strip()
    if not text:
        return HOME
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", text):
        scheme = text.split(":", 1)[0].lower()
        if scheme not in ("http", "https"):
            raise web.HTTPBadRequest(text="only http(s) pages")
        return text
    if " " in text or "." not in text and not text.startswith("localhost"):
        return SEARCH + urllib.parse.quote(text)
    return "https://" + text


def make_app(data_dir, stratum):
    chromes = Chromes(data_dir, HOME)
    routes = web.RouteTableDef()

    def pid(request):
        p = request.match_info["id"]
        if not (1 <= len(p) <= 64) or not all(c.isalnum() or c in "-_" for c in p):
            raise web.HTTPBadRequest(text="bad pane id")
        return p

    async def pane_for(request):
        """(session, pane) for this player, opening the pane (at its saved tabs) if needed."""
        owner, pane_id = request["player"]["user"], pid(request)
        saved = chromes.saved.get(pane_id)
        if saved and saved["owner"] != owner:
            raise web.HTTPForbidden(text="not your pane")
        for s in chromes.sessions.values():
            if s.owner != owner and pane_id in s.panes:
                raise web.HTTPForbidden(text="not your pane")
        async with chromes.lock:
            s = await chromes.session(owner)
            pane = s.panes.get(pane_id)
            if not pane:
                if len(s.panes) >= MAX_PANES:
                    idle = sorted((p for p in s.panes.values() if not p.sockets), key=lambda p: p.used)
                    if not idle:
                        raise web.HTTPTooManyRequests(text=f"at most {MAX_PANES} open panes")
                    await s.close_pane(idle[0])   # reopens at its tabs when looked at again
                pane = await s.open_pane(pane_id, saved)
        pane.used = s.used = time.monotonic()
        return s, pane

    async def handle(s, pane, ev):
        """One input event (from the socket or POST /input)."""
        kind, tab = ev.get("type"), pane.active
        x = min(1.0, max(0.0, float(ev.get("x", 0.5)))) * chrome.W
        y = min(1.0, max(0.0, float(ev.get("y", 0.5)))) * chrome.H
        button = ev.get("button") if ev.get("button") in ("left", "right", "middle") else "left"
        if kind not in ("newtab", "tab", "closetab") and not tab:
            return
        page = tab.s if tab else None
        if kind == "click":
            n = max(1, min(3, int(ev.get("count", 1))))
            await cdp.mouse(page, "move", x, y)
            await cdp.mouse(page, "mousePressed", x, y, button, n)
            await cdp.mouse(page, "mouseReleased", x, y, button, n)
        elif kind == "move":
            await cdp.mouse(page, "move", x, y)
        elif kind in ("down", "up"):
            await cdp.mouse(page, "move", x, y)
            await cdp.mouse(page, "mousePressed" if kind == "down" else "mouseReleased", x, y, button)
        elif kind == "scroll":
            await cdp.mouse(page, "wheel", x, y, dx=float(ev.get("dx", 0)), dy=float(ev.get("dy", 0)))
        elif kind == "type":
            await page.send("Input.insertText", {"text": str(ev.get("text", ""))[:2000]})
        elif kind == "key":
            key = str(ev.get("key", ""))
            try:
                if not KEY_RE.match(key):
                    raise ValueError(key)
                cdp.key_event(key)
            except (ValueError, KeyError):
                raise web.HTTPBadRequest(text="unsupported key")
            await cdp.press(page, key)
        elif kind == "goto":
            await s.navigate(tab, normalize_url(ev.get("url")))
        elif kind in ("back", "forward"):
            await s.go_history(tab, -1 if kind == "back" else 1)
        elif kind == "reload":
            await page.send("Page.reload")
        elif kind == "stop":
            await page.send("Page.stopLoading")
        elif kind == "newtab":
            await s.open_tab(pane, normalize_url(ev.get("url")) if ev.get("url") else HOME)
        elif kind in ("closetab", "tab"):
            t = next((t for t in pane.tabs if t.id == ev.get("tab")), None)
            if not t:
                raise web.HTTPBadRequest(text="no such tab")
            if kind == "tab":
                await s.activate(pane, t)
            else:
                await s.close_tab(pane, t)
        else:
            raise web.HTTPBadRequest(text="unknown input type")
        pane.used = time.monotonic()
        if kind in ("click", "down", "key", "type", "goto", "back", "forward", "tab", "newtab", "closetab"):
            await asyncio.sleep(0.05)   # (the page reacts: focus moves, a field opens)
            await s.poll(pane)
            await s.nav_state(pane)

    async def live(s, pane):
        """While anyone watches: keep title / focus / back-forward fresh and push changes."""
        n = 0
        while pane.sockets:
            await s.poll(pane)
            if n % 5 == 0:
                await s.nav_state(pane)
            n += 1
            if pane.changed.is_set():
                pane.changed.clear()
                msg = json.dumps({"t": "info", **pane.info()})
                for sock in list(pane.sockets):
                    sock.video.retarget(pane.rect())
                    if not sock.ws.closed:
                        await sock.ws.send_str(msg)
            try:
                await asyncio.wait_for(pane.changed.wait(), POLL_S)
            except asyncio.TimeoutError:
                pass

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True, "players": len(chromes.sessions), "audio": chromes.audio.ok,
                                  "panes": sum(len(s.panes) for s in chromes.sessions.values())})

    @routes.get("/panes/{id}")
    async def open_pane(request):
        s, pane = await pane_for(request)
        await s.poll(pane)
        return web.json_response(pane.info())

    @routes.post("/panes/{id}/input")
    async def input_(request):
        s, pane = await pane_for(request)
        await handle(s, pane, await request.json())
        return web.json_response(pane.info())

    @routes.get("/panes/{id}/suggest")
    async def suggest(request):
        s, pane = await pane_for(request)
        return web.json_response({"items": s.suggest(request.query.get("q", ""))})

    @routes.get("/panes/{id}/stream")
    async def stream(request):
        """WebSocket: picture + sound + live state out, input in.
        ?codec=h264|vp8|jpeg (what the client can decode), &audio=1."""
        s, pane = await pane_for(request)
        codec = request.query.get("codec", "jpeg")
        if codec not in ("h264", "vp8", "jpeg"):
            raise web.HTTPBadRequest(text="codec: h264, vp8 or jpeg")
        ws = web.WebSocketResponse(max_msg_size=64 * 1024, heartbeat=20)
        await ws.prepare(request)
        sock = Sock(ws)
        sock.video = VideoStream(s.display.name, pane.rect(), codec, sock.push)
        await ws.send_str(json.dumps(sock.video.config()))
        await ws.send_str(json.dumps({"t": "info", **pane.info()}))
        pane.sockets.add(sock)
        if len(pane.sockets) == 1:
            asyncio.create_task(live(s, pane))
        if request.query.get("audio") == "1" and s.sink:
            take_audio(s, sock)
        sender = asyncio.create_task(sock.drain())
        try:
            async for msg in ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                try:
                    ev = json.loads(msg.data)
                except ValueError:
                    continue
                if ev.get("t") == "key-frame":
                    sock.video.key()
                    continue
                if ev.get("t") == "audio":   # this pane was touched: its device plays the sound
                    take_audio(s, sock)
                    continue
                try:
                    await handle(s, pane, ev)
                except web.HTTPException as exc:
                    await ws.send_str(json.dumps({"t": "error", "message": exc.text}))
                except Exception as exc:
                    await ws.send_str(json.dumps({"t": "error", "message": str(exc).splitlines()[0][:200]}))
        finally:
            pane.sockets.discard(sock)
            sock.video.close()
            sender.cancel()
            if s.audio_socket is sock:
                s.audio_socket = None   # (the recorder keeps running for the session: sound starts at once next time)
            pane.used = time.monotonic()
        return ws

    def take_audio(s, sock):
        if not s.sink or sock.ws.closed:
            return
        s.audio_socket = sock
        if not s.audio_stream:
            s.audio_stream = AudioStream(chromes.audio.env, s.sink, lambda data: s.audio_socket and s.audio_socket.push(data))

    @routes.delete("/panes/{id}")
    async def close(request):
        s, pane = await pane_for(request)   # (ownership check)
        await s.close_pane(pane)
        chromes.saved.pop(pane.id, None)
        chromes.saved_path.write_text(json.dumps(chromes.saved))
        return web.Response(status=204)

    async def reap():
        now = time.monotonic()
        for owner, s in list(chromes.sessions.items()):
            for pane in list(s.panes.values()):
                if not pane.sockets and now - pane.used > IDLE_CLOSE_S:
                    await s.close_pane(pane)
            if not s.panes and now - s.used > SESSION_IDLE_S:
                chromes.sessions.pop(owner, None)
                await s.close()

    async def lifecycle(app):
        await chromes.start()

        async def reaper():
            while True:
                await asyncio.sleep(30)
                try:
                    await reap()
                except Exception:
                    pass
        task = asyncio.create_task(reaper())
        yield
        task.cancel()
        await chromes.close()

    app = web.Application(middlewares=[stratum.middleware])
    app["chromes"] = chromes
    app.add_routes(routes)
    app.cleanup_ctx.append(lifecycle)
    return app


class Sock:
    """One client's stream: a queue the encoder fills and a task drains.
    A client that falls behind skips to the next key frame (no growing lag)."""
    MAX_QUEUE = 45

    def __init__(self, ws):
        self.ws, self.q = ws, asyncio.Queue()
        self.video = None

    def push(self, data):
        if self.q.qsize() > self.MAX_QUEUE:
            while not self.q.empty():
                self.q.get_nowait()
            if self.video:
                self.video.key()
        self.q.put_nowait(data)

    async def drain(self):
        while True:
            data = await self.q.get()
            if self.ws.closed:
                return
            await self.ws.send_bytes(data)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8003)))
    ap.add_argument("--data", default=os.environ.get("BROWSER_DATA", "/data"))
    args = ap.parse_args()
    web.run_app(make_app(args.data, Stratum.from_env("browser")), host="0.0.0.0", port=args.port)
