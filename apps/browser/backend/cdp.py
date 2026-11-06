"""A small Chrome DevTools Protocol client: what the browser backend needs
from Chrome's control port, nothing more. One WebSocket to the browser;
tabs and their iframes are flat sessions on it (Target.attachToTarget
flatten). Pages can't see it: nothing is injected, no automation flags.

    browser = await Browser.connect("http://127.0.0.1:9222")
    await browser.send("Target.createTarget", {"url": "about:blank", "newWindow": True})
    page = await browser.attach(target_id)      # → Session
    await page.send("Page.navigate", {"url": url})
    page.on("Page.loadEventFired", handler)
"""
import asyncio
import itertools
import json

from aiohttp import ClientSession, WSMsgType


class CDPError(Exception):
    pass


class Session:
    def __init__(self, browser, session_id, target_id=None):
        self.browser, self.id, self.target = browser, session_id, target_id
        self.handlers = {}
        self.closed = False

    def on(self, method, fn):
        self.handlers.setdefault(method, []).append(fn)

    async def send(self, method, params=None):
        return await self.browser._call(method, params or {}, self.id)

    def _event(self, method, params):
        for fn in self.handlers.get(method, []):
            try:
                r = fn(params)
                if asyncio.iscoroutine(r):
                    asyncio.create_task(r)
            except Exception:
                pass


class Browser(Session):
    def __init__(self):
        super().__init__(self, None)
        self.ids = itertools.count(1)
        self.waiting = {}
        self.sessions = {}

    @classmethod
    async def connect(cls, http_url):
        self = cls()
        self.http = ClientSession()
        try:
            async with self.http.get(http_url.rstrip("/") + "/json/version") as r:
                ws_url = (await r.json())["webSocketDebuggerUrl"]
            self.ws = await self.http.ws_connect(ws_url, max_msg_size=64 * 1024 * 1024)
        except BaseException:
            await self.http.close()
            raise
        self.reader = asyncio.create_task(self._read())
        return self

    async def close(self):
        self.reader.cancel()
        await self.ws.close()
        await self.http.close()

    async def _call(self, method, params, session_id):
        if self.ws.closed:
            raise CDPError("browser connection closed")
        mid = next(self.ids)
        fut = asyncio.get_running_loop().create_future()
        self.waiting[mid] = fut
        msg = {"id": mid, "method": method, "params": params}
        if session_id:
            msg["sessionId"] = session_id
        await self.ws.send_str(json.dumps(msg))
        return await asyncio.wait_for(fut, 30)

    async def _read(self):
        try:
            async for msg in self.ws:
                if msg.type != WSMsgType.TEXT:
                    continue
                m = json.loads(msg.data)
                if "id" in m:
                    fut = self.waiting.pop(m["id"], None)
                    if fut and not fut.done():
                        if "error" in m:
                            fut.set_exception(CDPError(m["error"].get("message", "CDP error")))
                        else:
                            fut.set_result(m.get("result", {}))
                    continue
                method, params = m.get("method"), m.get("params", {})
                if method == "Target.detachedFromTarget":
                    s = self.sessions.pop(params.get("sessionId"), None)
                    if s:
                        s.closed = True
                target = self.sessions.get(m.get("sessionId")) if m.get("sessionId") else self
                if target:
                    target._event(method, params)
                if method == "Target.attachedToTarget" and m.get("sessionId"):   # an iframe of a tab (auto-attach)
                    parent = self.sessions.get(m["sessionId"])
                    child = Session(self, params["sessionId"], params["targetInfo"]["targetId"])
                    self.sessions[child.id] = child
                    if parent:
                        parent._event("child", {"session": child, "info": params["targetInfo"]})
        finally:
            for fut in self.waiting.values():
                if not fut.done():
                    fut.set_exception(CDPError("browser connection closed"))

    async def attach(self, target_id):
        sid = (await self.send("Target.attachToTarget", {"targetId": target_id, "flatten": True}))["sessionId"]
        s = Session(self, sid, target_id)
        self.sessions[sid] = s
        return s


# ---- input: key names → what Input.dispatchKeyEvent wants (US layout) ------------------

MODIFIERS = {"Alt": 1, "Control": 2, "Meta": 4, "Shift": 8}
NAMED = {   # key → (code, keyCode, text)
    "Enter": ("Enter", 13, "\r"), "Backspace": ("Backspace", 8, ""), "Tab": ("Tab", 9, ""), "Escape": ("Escape", 27, ""),
    "ArrowUp": ("ArrowUp", 38, ""), "ArrowDown": ("ArrowDown", 40, ""), "ArrowLeft": ("ArrowLeft", 37, ""), "ArrowRight": ("ArrowRight", 39, ""),
    "PageUp": ("PageUp", 33, ""), "PageDown": ("PageDown", 34, ""), "Home": ("Home", 36, ""), "End": ("End", 35, ""),
    "Delete": ("Delete", 46, ""), "Insert": ("Insert", 45, ""), "Space": ("Space", 32, " "),
    **{f"F{i}": (f"F{i}", 111 + i, "") for i in range(1, 13)},
}
PUNCT = {"-": ("Minus", 189), "=": ("Equal", 187), "[": ("BracketLeft", 219), "]": ("BracketRight", 221), ";": ("Semicolon", 186),
         "'": ("Quote", 222), ",": ("Comma", 188), ".": ("Period", 190), "/": ("Slash", 191), "`": ("Backquote", 192), "\\": ("Backslash", 220)}


def key_event(key):
    """'Control+a' / 'Enter' / 'x' → (modifier names, params for the key)."""
    *mods, k = key.split("+") if key != "+" else ["+"]
    bits = sum(MODIFIERS[m] for m in mods)
    if k in NAMED:
        code, kc, text = NAMED[k]
        name = " " if k == "Space" else k
    elif len(k) == 1 and k.isalpha():
        code, kc, text, name = f"Key{k.upper()}", ord(k.upper()), k, k
    elif len(k) == 1 and k.isdigit():
        code, kc, text, name = f"Digit{k}", ord(k), k, k
    elif k in PUNCT:
        (code, kc), text, name = PUNCT[k], k, k
    else:
        raise ValueError(f"unknown key {key}")
    if bits & (MODIFIERS["Control"] | MODIFIERS["Alt"] | MODIFIERS["Meta"]):
        text = ""   # a shortcut, not typing
    return mods, {"key": name, "code": code, "windowsVirtualKeyCode": kc, "nativeVirtualKeyCode": kc, "modifiers": bits,
                  **({"text": text, "unmodifiedText": text} if text else {})}


async def press(session, key):
    mods, params = key_event(key)
    bits = 0
    for m in mods:   # modifiers down, the key, modifiers up (like a person)
        bits |= MODIFIERS[m]
        code = {"Control": "ControlLeft", "Shift": "ShiftLeft", "Alt": "AltLeft", "Meta": "MetaLeft"}[m]
        await session.send("Input.dispatchKeyEvent", {"type": "rawKeyDown", "key": m, "code": code, "modifiers": bits})
    await session.send("Input.dispatchKeyEvent", {**params, "type": "keyDown" if "text" in params else "rawKeyDown"})
    await session.send("Input.dispatchKeyEvent", {**{k: v for k, v in params.items() if k not in ("text", "unmodifiedText")}, "type": "keyUp"})
    for m in reversed(mods):
        bits &= ~MODIFIERS[m]
        code = {"Control": "ControlLeft", "Shift": "ShiftLeft", "Alt": "AltLeft", "Meta": "MetaLeft"}[m]
        await session.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": m, "code": code, "modifiers": bits})


BUTTONS = {"left": 1, "right": 2, "middle": 4}


async def mouse(session, kind, x, y, button="left", count=1, dx=0, dy=0):
    if kind == "wheel":
        await session.send("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "deltaX": dx, "deltaY": dy})
    elif kind == "move":
        await session.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    else:   # pressed / released
        await session.send("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": button,
                                                        "buttons": BUTTONS[button] if kind == "mousePressed" else 0, "clickCount": count})
