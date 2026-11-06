"""Real Chrome for browser panes: one Chrome per player, in a window on its
own virtual display (Xvfb), with a persistent profile. Not test automation:
Chrome is started normally and driven over its DevTools port (local to this
container, cdp.py), so pages see an ordinary desktop Chrome
(navigator.webdriver is false, real plugins, WebGL via SwiftShader), and
sites like Amazon trust it.

Each pane is one Chrome window parked in its own slot on the display (no
overlap), its tabs are that window's tabs, and pop-ups (window.open) become
tabs of the pane that opened them (their windows are moved onto the slot).
stream.py captures the active tab's content area from the display.
"""
import asyncio
import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

import cdp

W = int(os.environ.get("BROWSER_W", 1280))
H = int(os.environ.get("BROWSER_H", 800))
# The display is a common 4K screen (sites read screen.width/height): six
# pane windows in a 3 × 2 grid, and a strip below for the parked startup window.
COLS, ROWS = 3, 2
SLOT_W, SLOT_H = W, H + 160                     # 160: room for Chrome's toolbar (~87 px; pop-ups ~35)
DISPLAY_W, DISPLAY_H = max(3840, COLS * SLOT_W), max(2160, ROWS * SLOT_H + 200)
MAX_TABS = 12                                   # per pane
HISTORY_MAX = 2000

CHROME_FLAGS = [
    "--no-first-run", "--no-default-browser-check", "--password-store=basic",
    # Containers can't give Chrome its sandbox (user namespaces); --test-type hides the warning bar.
    "--no-sandbox", "--test-type",
    # Every pane is on screen to us even when windows are "covered": keep them all rendering.
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",   # WebGL without a GPU (sites expect it)
    "--disable-features=Translate,MediaRouter,DialMediaRouteProvider,GlobalMediaControls",
    "--hide-crash-restore-bubble", "--deny-permission-prompts", "--lang=en-US",
]
PREFS = {   # first run: no bubbles over the page that we can't show
    "credentials_enable_service": False,
    "profile": {"password_manager_enabled": False, "default_content_setting_values": {
        "notifications": 2, "geolocation": 2, "media_stream_camera": 2, "media_stream_mic": 2}},
    "translate": {"enabled": False}, "autofill": {"profile_enabled": False, "credit_card_enabled": False},
    "download": {"prompt_for_download": False, "default_directory": "/tmp"},
    "browser": {"has_seen_welcome_page": True},
}
# Is a text field focused (so the client can bring up a keyboard)? Looks
# through shadow roots; 'frame' = focus is in an iframe (ask its session).
FOCUS_JS = """(() => {
  let e = document.activeElement;
  while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement;
  if (!e || e === document.body) return null;
  const tag = e.tagName, type = (e.getAttribute('type') || 'text').toLowerCase();
  const text = ['text', 'search', 'email', 'url', 'tel', 'password', 'number'];
  const role = (e.getAttribute('role') || '').toLowerCase();
  const ok = e.isContentEditable || tag === 'TEXTAREA' || (tag === 'INPUT' && text.includes(type)) || role === 'textbox' || role === 'searchbox';
  if (!ok || e.readOnly || e.disabled) return tag === 'IFRAME' ? 'frame' : null;
  const label = e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('title') || e.getAttribute('name') || '';
  return { kind: e.isContentEditable ? 'rich' : tag === 'TEXTAREA' ? 'multiline' : type, label: label.slice(0, 80) };
})()"""


def chrome_binary():
    return os.environ.get("BROWSER_CHROME") or shutil.which("google-chrome") or shutil.which("chromium") or "google-chrome"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def stop(proc):
    proc.terminate()
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        proc.kill()


class Display:
    """An Xvfb screen for one player's windows. Numbers already in use (here,
    or on the host when the container shares its network) are skipped."""
    tried = 20

    async def start(self):
        for _ in range(60):
            n = Display.tried
            Display.tried = 20 + (Display.tried - 19) % 180
            if Path(f"/tmp/.X11-unix/X{n}").exists() or Path(f"/tmp/.X{n}-lock").exists():
                continue
            self.num, self.name = n, f":{n}"
            self.proc = subprocess.Popen(["Xvfb", self.name, "-screen", "0", f"{DISPLAY_W}x{DISPLAY_H}x24", "-nolisten", "tcp", "-noreset"],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(100):
                if self.proc.poll() is not None:
                    break                      # taken: the next number
                if Path(f"/tmp/.X11-unix/X{n}").exists():
                    return self
                await asyncio.sleep(0.05)
            if self.proc.poll() is None:
                stop(self.proc)
        raise RuntimeError("no X display would start")

    def close(self):
        stop(self.proc)


class Audio:
    """One PulseAudio daemon for the container; a null sink per player (Chrome
    plays into it, stream.py records its monitor). Absent pulseaudio: no sound."""
    RUNTIME = "/tmp/stratum-pulse"

    def __init__(self):
        self.ok = bool(shutil.which("pulseaudio") and shutil.which("pactl") and shutil.which("parec"))
        self.env = dict(os.environ, PULSE_RUNTIME_PATH=self.RUNTIME, HOME=os.environ.get("HOME", "/tmp"))
        self.proc = None
        self.next = 0

    async def start(self):
        if not self.ok:
            return
        Path(self.RUNTIME).mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen(["pulseaudio", "--daemonize=no", "--exit-idle-time=-1", "--disallow-exit", "--disable-shm=yes"],
                                     env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            if subprocess.run(["pactl", "info"], env=self.env, capture_output=True).returncode == 0:
                # Idle sinks get suspended, and a suspended sink's monitor records nothing (not even
                # silence): keep them running so the sound is one steady stream.
                subprocess.run(["pactl", "unload-module", "module-suspend-on-idle"], env=self.env, capture_output=True)
                return
            await asyncio.sleep(0.1)
        self.ok = False

    def sink(self):
        if not self.ok:
            return None
        self.next += 1
        name = f"stratum{self.next}"
        subprocess.run(["pactl", "load-module", "module-null-sink", f"sink_name={name}", "rate=48000", "channels=2",
                        f"sink_properties=device.description={name}"],
                       env=self.env, capture_output=True)
        return name

    def close(self):
        if self.proc:
            stop(self.proc)


class Tab:
    def __init__(self, session, target, window, url, popup=False):
        self.s, self.target, self.window, self.popup = session, target, window, popup
        self.id = target[:12]
        self.title, self.url, self.loading = "", url, False
        self.ui = 0          # Chrome's toolbar height in this window (the page starts below it)
        self.frames = []     # sessions of its out-of-process iframes (focus may be in one)
        self.frame_id = None

    async def eval(self, expr, session=None):
        r = await (session or self.s).send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        if "exceptionDetails" in r:
            raise cdp.CDPError(r["exceptionDetails"].get("text", "evaluate failed"))
        return r["result"].get("value")


class Pane:
    def __init__(self, pane_id, slot):
        self.id, self.slot = pane_id, slot
        self.tabs, self.active = [], None
        self.used = time.monotonic()
        self.sockets = set()
        self.focus = None
        self.placing = False
        self.history = {"back": False, "forward": False}
        self.saved = {}
        self.changed = asyncio.Event()   # tabs / title / url / focus changed: tell the sockets

    def origin(self):
        return (self.slot % COLS) * SLOT_W, (self.slot // COLS) * SLOT_H

    def rect(self):
        """Where the active tab's page is on the display: (x, y, w, h)."""
        x, y = self.origin()
        return x, y + (self.active.ui if self.active else 0), W, H

    def info(self):
        a = self.active
        return {"id": self.id, "width": W, "height": H, "url": a.url if a else "", "title": a.title if a else "",
                "loading": a.loading if a else False, "focus": self.focus, **self.history,
                "tabs": [{"id": t.id, "title": t.title, "url": t.url, "active": t is a, "loading": t.loading} for t in self.tabs]}


class Session:
    """One player's Chrome: display, profile, panes."""
    def __init__(self, owner, data, audio, home):
        self.owner, self.data, self.audio, self.home = owner, Path(data), audio, home
        self.profile = self.data / "profiles" / owner
        self.panes = {}
        self.tabs = {}              # target id → Tab
        self.pending = {}           # target id → (pane, future) for tabs we asked for
        self.history_path = self.data / "history" / f"{owner}.json"
        self.history = json.loads(self.history_path.read_text()) if self.history_path.exists() else []
        self.used = time.monotonic()
        self.audio_socket = None    # the one socket that gets this player's sound (the pane touched last)
        self.audio_stream = None
        self.on_saved = lambda pane: None

    async def start(self):
        self.display = await Display().start()
        self.sink = self.audio.sink()
        first = not (self.profile / "Default").exists()
        (self.profile / "Default").mkdir(parents=True, exist_ok=True)
        if first:
            (self.profile / "Default" / "Preferences").write_text(json.dumps(PREFS))
        # A Chrome left from a crash would take this profile (a new one hands off to it and exits).
        subprocess.run(["pkill", "-f", f"--user-data-dir={self.profile}( |$)"], capture_output=True)
        for lock in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
            (self.profile / lock).unlink(missing_ok=True)
        env = dict(self.audio.env, DISPLAY=self.display.name)
        if self.sink:
            env["PULSE_SINK"] = self.sink
        # A fixed port, chosen here: with --remote-debugging-port=0 Chrome reports navigator.webdriver = true.
        port = free_port()
        self.proc = subprocess.Popen([chrome_binary(), f"--user-data-dir={self.profile}", f"--remote-debugging-port={port}",
                                      "--remote-debugging-address=127.0.0.1", *CHROME_FLAGS,
                                      f"--window-position=0,{ROWS * SLOT_H}", "--window-size=400,200", "about:blank"],
                                     env=env, stdout=subprocess.DEVNULL, stderr=open(self.profile / "chrome.log", "wb"))
        for _ in range(300):
            if self.proc.poll() is not None:
                raise RuntimeError("Chrome exited (see chrome.log in its profile)")
            try:
                self.browser = await cdp.Browser.connect(f"http://127.0.0.1:{port}")
                break
            except OSError:
                await asyncio.sleep(0.05)
        else:
            raise RuntimeError("Chrome's DevTools port never opened")
        self.browser.on("Target.targetCreated", self.created)
        self.browser.on("Target.targetInfoChanged", self.info_changed)
        self.browser.on("Target.targetDestroyed", lambda p: self.destroyed(p["targetId"]))
        await self.browser.send("Target.setDiscoverTargets", {"discover": True})
        await self.import_old_profile()

    async def import_old_profile(self):
        """Profiles from the old headless backend were Playwright storage states: bring their cookies over once."""
        old = self.data / "profiles" / f"{self.owner}.json"
        if old.exists():
            try:
                cookies = json.loads(old.read_text()).get("cookies", [])
                await self.browser.send("Storage.setCookies", {"cookies": [
                    {k: c[k] for k in ("name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite") if k in c}
                    for c in cookies]})
            except Exception:
                pass
            old.rename(old.with_suffix(".imported"))

    async def close(self):
        if self.audio_stream:
            self.audio_stream.close()
        try:
            await self.browser.send("Browser.close")
        except Exception:
            pass
        try:
            await self.browser.close()
        except Exception:
            pass
        stop(self.proc)
        self.display.close()

    # ---- tabs ------------------------------------------------------------------------

    def created(self, p):
        info = p["targetInfo"]
        if info["type"] == "page":
            asyncio.create_task(self.adopt(info))

    def info_changed(self, p):
        info = p["targetInfo"]
        tab = self.tabs.get(info["targetId"])
        if not tab or (info.get("title") == tab.title and info.get("url") == tab.url):
            return
        nav = info.get("url") != tab.url
        tab.title, tab.url = info.get("title", ""), info.get("url", "")
        pane = self.pane_of(tab)
        if pane:
            if nav:
                self.remember(pane)
            pane.changed.set()

    def destroyed(self, target):
        tab = self.tabs.pop(target, None)
        pane = tab and self.pane_of(tab)
        if pane:
            asyncio.create_task(self.closed(pane, tab))

    def pane_of(self, tab):
        return next((p for p in self.panes.values() if tab in p.tabs), None)

    async def place(self, pane, tab):
        """Put the tab's window on the pane's slot, sized so the page is exactly W×H."""
        x, y = pane.origin()
        ui = tab.ui or (87 if not tab.popup else 35)
        for _ in range(4):
            try:
                await self.browser.send("Browser.setWindowBounds", {"windowId": tab.window, "bounds": {"windowState": "normal"}})
                await self.browser.send("Browser.setWindowBounds", {"windowId": tab.window, "bounds": {"left": x, "top": y, "width": W, "height": H + ui}})
                await asyncio.sleep(0.15)   # the page learns its new size a moment later
                m = await tab.eval("[outerWidth, outerHeight, innerWidth, innerHeight]")
            except Exception:
                break
            ui = m[1] - m[3]
            if m[3] == H and m[2] == W:
                break
        for t in pane.tabs:   # tabs of one window share its toolbar
            if t.window == tab.window:
                t.ui = ui
        tab.ui = ui

    async def open_tab(self, pane, url):
        if len(pane.tabs) >= MAX_TABS:
            await self.close_tab(pane, pane.tabs[0])
        if pane.active:   # new tabs open in the window that was active last
            await self.browser.send("Target.activateTarget", {"targetId": pane.active.target})
        fut = asyncio.get_running_loop().create_future()
        target = (await self.browser.send("Target.createTarget", {"url": "about:blank", "newWindow": not pane.tabs}))["targetId"]
        self.pending[target] = (pane, fut)
        tab = await asyncio.wait_for(fut, 10)
        await self.navigate(tab, url)
        return tab

    async def adopt(self, info):
        """Every new page: one we opened (pending), a link opened in a new tab
        (same window as a pane's), or a pop-up window (its opener's pane)."""
        target = info["targetId"]
        for _ in range(20):   # open_tab registers its own a moment after createTarget returns
            if target in self.pending:
                break
            await asyncio.sleep(0.01)
        try:
            window = (await self.browser.send("Browser.getWindowForTarget", {"targetId": target}))["windowId"]
        except Exception:
            return
        mine = self.pending.pop(target, None)
        pane = mine[0] if mine else next((p for p in self.panes.values() if any(t.window == window for t in p.tabs)), None)
        popup = False
        if not pane and info.get("openerId"):
            opener = self.tabs.get(info["openerId"])
            pane = opener and self.pane_of(opener)
            popup = pane is not None
        if not pane:   # the startup window, or an orphan
            return
        try:
            s = await self.browser.attach(target)
            tab = Tab(s, target, window, info.get("url", ""), popup)
            tab.title = info.get("title", "")
            await self.watch(pane, tab)
        except Exception as exc:
            if mine and not mine[1].done():
                mine[1].set_exception(exc)
            return
        self.tabs[target] = tab
        pane.tabs.append(tab)
        await self.refresh(tab)   # (its title may have changed before it was ours)
        if popup or len(pane.tabs) == 1:
            await self.place(pane, tab)          # a new window: onto the pane's slot
        else:
            tab.ui = next(t.ui for t in pane.tabs if t.window == tab.window)   # a tab in the pane's window
        await self.activate(pane, tab)
        if mine and not mine[1].done():
            mine[1].set_result(tab)

    async def watch(self, pane, tab):
        s = tab.s

        def loading(on):
            def handler(p):
                if p.get("frameId") == tab.frame_id:
                    tab.loading = on
                    pane.changed.set()
                    if not on:
                        asyncio.create_task(self.loaded(tab))
            return handler
        s.on("Page.frameStartedLoading", loading(True))
        s.on("Page.frameStoppedLoading", loading(False))
        s.on("Page.javascriptDialogOpening", lambda p: s.send("Page.handleJavaScriptDialog", {"accept": False}))
        s.on("child", lambda p: tab.frames.append(p["session"]) if p["info"]["type"] == "iframe" else None)
        await s.send("Page.enable")
        tab.frame_id = (await s.send("Page.getFrameTree"))["frameTree"]["frame"]["id"]
        await s.send("Target.setAutoAttach", {"autoAttach": True, "waitForDebuggerOnStart": False, "flatten": True})

    async def closed(self, pane, tab):
        if tab not in pane.tabs:
            return
        i = pane.tabs.index(tab)
        pane.tabs.remove(tab)
        if pane.active is tab:
            pane.active = None
            if pane.tabs:
                await self.activate(pane, pane.tabs[min(i, len(pane.tabs) - 1)])
        if not pane.tabs and pane.id in self.panes:   # never empty: a fresh tab
            await self.open_tab(pane, self.home)
        self.remember(pane)
        pane.changed.set()

    async def close_tab(self, pane, tab):
        if len(pane.tabs) == 1:   # the last tab: start over rather than close the window
            await self.navigate(tab, self.home)
            return
        self.tabs.pop(tab.target, None)
        try:
            await self.browser.send("Target.closeTarget", {"targetId": tab.target})
        except Exception:
            pass
        await self.closed(pane, tab)

    async def activate(self, pane, tab):
        pane.active = tab
        try:
            await self.browser.send("Target.activateTarget", {"targetId": tab.target})
        except Exception:
            pass
        pane.focus = None
        pane.changed.set()

    async def navigate(self, tab, url):
        tab.loading = True
        try:
            error = (await tab.s.send("Page.navigate", {"url": url})).get("errorText")
        except Exception as exc:
            error = str(exc)
        if error:   # show the error in the pane instead of failing the request
            html = (f"<title>Couldn't load</title><body style='font:24px system-ui;padding:40px;background:#111;color:#eee'>"
                    f"<h2>Couldn't load</h2><p>{_esc(url)}</p><p style='color:#f88'>{_esc(error[:300])}</p></body>")
            try:
                await tab.s.send("Page.setDocumentContent", {"frameId": tab.frame_id, "html": html})
            except Exception:
                pass
            tab.loading = False

    async def go_history(self, tab, step):
        h = await tab.s.send("Page.getNavigationHistory")
        i = h["currentIndex"] + step
        if 0 <= i < len(h["entries"]):
            await tab.s.send("Page.navigateToHistoryEntry", {"entryId": h["entries"][i]["id"]})

    # ---- panes -----------------------------------------------------------------------

    async def open_pane(self, pane_id, saved):
        used = {p.slot for p in self.panes.values()}
        slot = next(s for s in range(COLS * ROWS) if s not in used)
        pane = Pane(pane_id, slot)
        self.panes[pane_id] = pane
        saved = saved or {}
        urls = saved.get("tabs") or ([saved["url"]] if saved.get("url") else [self.home])   # (old panes saved one URL)
        for url in urls[:MAX_TABS]:
            await self.open_tab(pane, url)
        active = saved.get("active", 0)
        if 0 <= active < len(pane.tabs):
            await self.activate(pane, pane.tabs[active])
        return pane

    async def close_pane(self, pane):
        self.panes.pop(pane.id, None)
        for tab in list(pane.tabs):
            self.tabs.pop(tab.target, None)
            try:
                await self.browser.send("Target.closeTarget", {"targetId": tab.target})
            except Exception:
                pass

    def remember(self, pane):
        pane.saved = {"tabs": [t.url for t in pane.tabs if t.url and t.url != "about:blank"],
                      "active": pane.tabs.index(pane.active) if pane.active in pane.tabs else 0}
        self.on_saved(pane)

    async def refresh(self, tab):
        try:
            info = (await self.browser.send("Target.getTargetInfo", {"targetId": tab.target}))["targetInfo"]
        except Exception:
            return
        self.info_changed({"targetInfo": info})

    async def loaded(self, tab):
        await self.refresh(tab)
        try:   # the page's own title (Chrome's target info can lag behind it)
            title = await tab.eval("document.title")
            if title and title != tab.title:
                tab.title = title
                pane = self.pane_of(tab)
                if pane:
                    pane.changed.set()
        except Exception:
            pass
        await self.visited(tab)

    # ---- history (address bar suggestions) -------------------------------------------

    async def visited(self, tab):
        url = tab.url
        if not url.startswith(("http://", "https://")):
            return
        hit = next((h for h in self.history if h["url"] == url), None)
        if hit:
            hit.update(title=tab.title or hit["title"], visits=hit["visits"] + 1, last=time.time())
        else:
            self.history.append({"url": url, "title": tab.title, "visits": 1, "last": time.time()})
            if len(self.history) > HISTORY_MAX:
                self.history.sort(key=lambda h: (h["visits"], h["last"]))
                del self.history[: len(self.history) - HISTORY_MAX]
        self.history_path.parent.mkdir(parents=True, exist_ok=True)
        self.history_path.write_text(json.dumps(self.history))

    def suggest(self, q, n=6):
        q = q.strip().lower()
        if not q:
            return []

        def score(h):
            url = h["url"].lower().split("://", 1)[-1].removeprefix("www.")
            title = (h["title"] or "").lower()
            if not (url.startswith(q) or q in url or q in title):
                return None
            return (url.startswith(q), h["visits"], h["last"])
        hits = [(s, h) for h in self.history if (s := score(h))]
        hits.sort(key=lambda x: x[0], reverse=True)
        return [{"url": h["url"], "title": h["title"]} for _, h in hits[:n]]

    # ---- live state (focus, size, back/forward) --------------------------------------

    async def poll(self, pane):
        tab = pane.active
        if not tab:
            return
        try:
            focus, size, title = await tab.eval(f"[{FOCUS_JS}, [innerWidth, innerHeight], document.title]")
        except Exception:
            return
        if title and title != tab.title:   # (Chrome doesn't announce title changes made by scripts)
            tab.title = title
            pane.changed.set()
        if focus == "frame":   # in an out-of-process iframe: ask the frames' sessions
            focus = None
            for fs in list(tab.frames):
                if fs.closed:
                    tab.frames.remove(fs)
                    continue
                try:
                    r = await tab.eval(FOCUS_JS, fs)
                except Exception:
                    continue
                if isinstance(r, dict):
                    focus = r
                    break
        focus = focus if isinstance(focus, dict) else None
        if size != [W, H] and not pane.placing:   # a bar came or went (or a pop-up resized itself): fit it again
            pane.placing = True
            try:
                await self.place(pane, tab)
            finally:
                pane.placing = False
            pane.changed.set()
        if focus != pane.focus:
            pane.focus = focus
            pane.changed.set()

    async def nav_state(self, pane):
        tab = pane.active
        if not tab:
            return
        try:
            h = await tab.s.send("Page.getNavigationHistory")
        except Exception:
            return
        state = {"back": h["currentIndex"] > 0, "forward": h["currentIndex"] < len(h["entries"]) - 1}
        if state != pane.history:
            pane.history = state
            pane.changed.set()


def _esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Chromes:
    """All players' sessions, plus the shared audio daemon."""
    def __init__(self, data_dir, home):
        self.data = Path(data_dir)
        (self.data / "profiles").mkdir(parents=True, exist_ok=True)
        self.home = home
        self.audio = Audio()
        self.sessions = {}
        self.lock = asyncio.Lock()
        self.saved_path = self.data / "panes.json"
        self.saved = json.loads(self.saved_path.read_text()) if self.saved_path.exists() else {}

    async def start(self):
        await self.audio.start()

    async def close(self):
        for s in list(self.sessions.values()):
            await s.close()
        self.audio.close()

    def save(self, owner, pane):
        self.saved[pane.id] = {"owner": owner, **pane.saved}
        self.saved_path.write_text(json.dumps(self.saved))

    async def session(self, owner):
        if owner not in self.sessions:
            s = Session(owner, self.data, self.audio, self.home)
            s.on_saved = lambda pane: self.save(owner, pane)
            await s.start()
            self.sessions[owner] = s
        s = self.sessions[owner]
        s.used = time.monotonic()
        return s
