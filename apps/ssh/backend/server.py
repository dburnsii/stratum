"""SSH terminal backend: real SSH sessions for terminal panes.

Each pane (app instance id) is one terminal: an SSH session (asyncssh) fed
into a VT100/xterm emulator (pyte). Clients long-poll the screen (cells as
style runs, plus the cursor) and send keys back. Reached only through
Stratum's proxy, which signs the player.

Auth: each Stratum user gets their own SSH key, made here on first use
(public half shown in an idle pane: add it to ~/.ssh/authorized_keys), or a
password typed at connect time (used once, never stored). Host keys are
trusted on first use and pinned per user; a changed key refuses to connect
until you Forget the host.

Who may use it: Stratum usernames in SSH_USERS (comma-separated; "*" =
anyone signed in). Sign-in is username-only today, so this is a LAN-trust
setup (DESIGN.md §6.7).
"""
import argparse
import asyncio
import json
import os
import re
import time
from pathlib import Path

import asyncssh
import pyte
from aiohttp import web

from stratum_backend import Stratum

SCREEN_WAIT_S = 8                                   # < Stratum's 10 s proxy timeout
IDLE_S = float(os.environ.get("SSH_IDLE_S", 4 * 3600))       # connected, nobody looking: hang up after
IDLE_CLOSED_S = float(os.environ.get("SSH_IDLE_CLOSED_S", 600))
CONNECT_TIMEOUT_S = 12
MAX_PANES = int(os.environ.get("SSH_MAX_PANES", 8))           # per user
TARGET_RE = re.compile(r"^(?:([A-Za-z0-9._-]{1,32})@)?([A-Za-z0-9.-]{1,253}|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$")
MAX_SAVED = 30                                                # saved hosts per user
HISTORY = int(os.environ.get("SSH_HISTORY", 5000))            # scrollback lines per terminal
KEYS = {"Enter": "\r", "Backspace": "\x7f", "Tab": "\t", "Escape": "\x1b",
        "ArrowUp": "\x1b[A", "ArrowDown": "\x1b[B", "ArrowRight": "\x1b[C", "ArrowLeft": "\x1b[D",
        "Home": "\x1b[H", "End": "\x1b[F", "Delete": "\x1b[3~", "PageUp": "\x1b[5~", "PageDown": "\x1b[6~", "Space": " ",
        "Insert": "\x1b[2~", "Shift+Tab": "\x1b[Z",
        "F1": "\x1bOP", "F2": "\x1bOQ", "F3": "\x1bOR", "F4": "\x1bOS", "F5": "\x1b[15~", "F6": "\x1b[17~",
        "F7": "\x1b[18~", "F8": "\x1b[19~", "F9": "\x1b[20~", "F10": "\x1b[21~", "F11": "\x1b[23~", "F12": "\x1b[24~"}


CSI_FINAL = {"ArrowUp": "A", "ArrowDown": "B", "ArrowRight": "C", "ArrowLeft": "D", "Home": "H", "End": "F"}


def key_bytes(key):
    if (key or "").startswith("Alt+") and len(key) > 4:   # Alt / Meta: ESC, then the key
        rest = key[4:]
        if rest in CSI_FINAL:   # arrows / Home / End: xterm's modifier form (3 = Alt)
            return f"\x1b[1;3{CSI_FINAL[rest]}".encode()
        return b"\x1b" + (rest.encode() if len(rest) == 1 else key_bytes(rest))
    if key in KEYS:
        return KEYS[key].encode()
    m = re.fullmatch(r"Ctrl\+([A-Za-z@\[\\\]^_])", key or "")
    if m:
        return bytes([ord(m.group(1).upper()) & 0x1F])
    raise web.HTTPBadRequest(text="unsupported key")


def parse_target(text, default_user=""):
    m = TARGET_RE.match((text or "").strip())
    if not m:
        raise web.HTTPBadRequest(text="target must look like user@host or user@host:port")
    user, host, port = m.group(1) or default_user, m.group(2).strip("[]"), int(m.group(3) or 22)
    if not user:
        raise web.HTTPBadRequest(text="which user? write it as user@host")
    if not 1 <= port <= 65535:
        raise web.HTTPBadRequest(text="bad port")
    return user, host, port


class Screen(pyte.HistoryScreen):
    """pyte's history screen, counting every line that scrolls off the top so
    lines get stable absolute numbers (selection survives scrolling)."""
    def __init__(self, cols, rows):
        super().__init__(cols, rows, history=HISTORY, ratio=0.5)
        self.pushed = 0

    def index(self):
        top, bottom = self.margins or pyte.screens.Margins(0, self.lines - 1)
        if self.cursor.y == bottom and top == 0:
            self.pushed += 1
        super().index()


def row_runs(row, cols):
    runs, cur = [], None
    for x in range(cols):
        c = row[x]
        style = (c.fg, c.bg, (1 if c.bold else 0) | (2 if c.underscore else 0) | (4 if c.reverse else 0))
        if cur and cur[1:] == list(style):
            cur[0] += c.data or " "
        else:
            cur = [c.data or " ", *style]
            runs.append(cur)
    if len(runs) == 1 and runs[0][1:] == ["default", "default", 0]:
        runs[0][0] = runs[0][0].rstrip()   # plain line: no trailing blanks
    return runs


def row_text(row, cols):
    return "".join((row[x].data or " ") for x in range(cols)).rstrip()


class Term:
    def __init__(self, pane_id, owner, cols, rows):
        self.id, self.owner = pane_id, owner
        self.cols, self.rows = cols, rows
        self.screen = Screen(cols, rows)
        self.screen.write_process_input = self.reply   # device status / attribute queries
        self.stream = pyte.ByteStream(self.screen)
        self.conn = self.chan = None
        self.state, self.message, self.target = "idle", "", ""
        self.seq = 0
        self.changed = asyncio.Condition()
        self.used = time.monotonic()

    def reply(self, data):
        if self.chan:
            self.chan.write(data.encode() if isinstance(data, str) else data)

    async def bump(self):
        async with self.changed:
            self.seq += 1
            self.changed.notify_all()

    async def feed(self, data):
        self.stream.feed(data)
        await self.bump()

    async def say(self, text):
        """Write a local (not remote) message into the terminal."""
        await self.feed(text.replace("\n", "\r\n").encode())

    async def set_state(self, state, message=""):
        self.state, self.message = state, message
        await self.bump()

    # Lines by absolute number: history (oldest first), then the screen.
    def first_line(self):
        return self.screen.pushed - len(self.screen.history.top)

    def line(self, n):
        hist = self.screen.history.top
        i = n - self.first_line()
        if 0 <= i < len(hist):
            return hist[i]
        y = n - self.screen.pushed
        return self.screen.buffer[y] if 0 <= y < self.rows else None

    def snapshot(self, scroll=0):
        """The view `scroll` lines up from the bottom (0 = live screen)."""
        scroll = max(0, min(int(scroll), len(self.screen.history.top)))
        top = self.screen.pushed - scroll
        lines = [row_runs(self.line(top + y), self.cols) for y in range(self.rows)]
        c = self.screen.cursor
        return {"seq": self.seq, "cols": self.cols, "rows": self.rows, "lines": lines,
                "top": top, "scroll": scroll, "maxScroll": len(self.screen.history.top),
                "cursor": None if c.hidden or scroll else [c.x, c.y], **self.info()}

    def text(self, a, b):
        """Text from (line, col) a to b inclusive, absolute lines, any order."""
        (l0, c0), (l1, c1) = sorted([a, b])
        l0 = max(l0, self.first_line())
        out = []
        for n in range(l0, l1 + 1):
            row = self.line(n)
            if row is None:
                continue
            text = row_text(row, self.cols)
            start = c0 if n == l0 else 0
            end = c1 + 1 if n == l1 else len(text)
            out.append(text[start:end])
        return "\n".join(out)

    def paste(self, text):
        data = re.sub(r"\r?\n", "\r", text)
        if (2004 << 5) in self.screen.mode:   # the program asked for bracketed paste
            data = f"\x1b[200~{data}\x1b[201~"
        return data.encode()

    def info(self):
        return {"id": self.id, "state": self.state, "message": self.message, "target": self.target,
                "title": self.screen.title or ""}


class Session(asyncssh.SSHClientSession):
    def __init__(self, term):
        self.term = term

    def data_received(self, data, datatype):
        asyncio.get_running_loop().create_task(self.term.feed(data))

    def connection_lost(self, exc):
        t = self.term
        asyncio.get_running_loop().create_task(self.closed(t, exc))

    async def closed(self, t, exc):
        if t.state == "connected":
            t.chan = None
            await t.say(f"\n[connection to {t.target} closed{': ' + str(exc) if exc else ''}]\n")
            await t.set_state("closed", "Disconnected")


class Terminals:
    def __init__(self, data_dir, users):
        self.data = Path(data_dir)
        for d in ("keys", "known_hosts", "hosts"):
            (self.data / d).mkdir(parents=True, exist_ok=True)
        self.users = users
        self.terms = {}

    def check_user(self, player):
        name = player.get("name", "")
        if "*" not in self.users and name not in self.users:
            raise web.HTTPForbidden(text=f"'{name or 'unknown'}' may not use SSH: add it to SSH_USERS on the server")
        return name or player["user"]

    # ---- per-user key + pinned host keys ----

    def key_for(self, owner):
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", owner)
        path = self.data / "keys" / f"{safe}.key"
        if not path.exists():
            key = asyncssh.generate_private_key("ssh-ed25519", comment=f"stratum-{safe}")
            key.write_private_key(str(path))
            os.chmod(path, 0o600)
        return asyncssh.read_private_key(str(path))

    def public_key(self, owner):
        return self.key_for(owner).export_public_key("openssh").decode().strip()

    def hosts_path(self, owner):
        return self.data / "known_hosts" / f"{re.sub(r'[^A-Za-z0-9_.-]', '_', owner)}.json"

    def known(self, owner):
        p = self.hosts_path(owner)
        return json.loads(p.read_text()) if p.exists() else {}

    def pin(self, owner, hostport, key):
        hosts = self.known(owner)
        hosts[hostport] = key
        self.hosts_path(owner).write_text(json.dumps(hosts, indent=1))

    def forget(self, owner, hostport):
        hosts = self.known(owner)
        hosts.pop(hostport, None)
        self.hosts_path(owner).write_text(json.dumps(hosts, indent=1))

    # ---- saved hosts (most recently used first) ----

    def saved_path(self, owner):
        return self.data / "hosts" / f"{re.sub(r'[^A-Za-z0-9_.-]', '_', owner)}.json"

    def saved(self, owner):
        p = self.saved_path(owner)
        return json.loads(p.read_text()) if p.exists() else []

    def save_host(self, owner, target, name=None):
        user, host, port = parse_target(target)
        target = f"{user}@{host}" + (f":{port}" if port != 22 else "")
        hosts = self.saved(owner)
        old = next((h for h in hosts if h["target"] == target), {})
        hosts = [h for h in hosts if h["target"] != target]
        hosts.insert(0, {"target": target, "name": (name if name is not None else old.get("name", ""))[:40], "used": int(time.time() * 1000)})
        self.saved_path(owner).write_text(json.dumps(hosts[:MAX_SAVED], indent=1))
        return hosts[:MAX_SAVED]

    def remove_host(self, owner, target):
        hosts = [h for h in self.saved(owner) if h["target"] != target]
        self.saved_path(owner).write_text(json.dumps(hosts, indent=1))
        return hosts

    # ---- terminals ----

    async def term(self, pane_id, owner, cols=80, rows=24, create=True):
        t = self.terms.get(pane_id)
        if t:
            if t.owner != owner:
                raise web.HTTPForbidden(text="not your terminal")
            t.used = time.monotonic()
            return t
        if not create:
            raise web.HTTPNotFound(text="no such terminal")
        mine = [x for x in self.terms.values() if x.owner == owner]
        if len(mine) >= MAX_PANES:
            idle = sorted((x for x in mine if x.state != "connected"), key=lambda x: x.used)
            if not idle:
                raise web.HTTPTooManyRequests(text=f"at most {MAX_PANES} terminals")
            await self.drop(idle[0].id)
        t = Term(pane_id, owner, cols, rows)
        self.terms[pane_id] = t
        await t.say(f"Not connected. Tap the title bar to connect (user@host).\n\n"
                    f"Your key (add it to ~/.ssh/authorized_keys on the host,\nor connect with a password):\n\n"
                    f"{self.public_key(owner)}\n")
        return t

    async def connect(self, t, target, password=None):
        user, host, port = parse_target(target)
        hostport = f"{host}:{port}"
        if t.conn:
            t.conn.close()
            t.conn = t.chan = None
        t.target = f"{user}@{host}" + (f":{port}" if port != 22 else "")
        await t.set_state("connecting", f"Connecting to {t.target}…")
        pinned = self.known(t.owner).get(hostport)
        known_hosts = ([asyncssh.import_public_key(pinned)], [], []) if pinned else None
        try:
            conn = await asyncio.wait_for(asyncssh.connect(
                host, port, username=user, client_keys=[self.key_for(t.owner)], password=password or None,
                known_hosts=known_hosts, agent_path=None, config=[], preferred_auth="publickey,keyboard-interactive,password"
                if password else "publickey"), CONNECT_TIMEOUT_S)
        except asyncssh.PermissionDenied:
            await t.set_state("password" if not password else "error",
                              f"Password for {t.target}" if not password else "Wrong password (or the key isn't authorized)")
            return
        except asyncssh.HostKeyNotVerifiable:
            await t.say(f"\n[{hostport}'s host key changed since you first connected. If that's expected,\n"
                        f" use Forget host, then connect again.]\n")
            await t.set_state("error", "Host key changed")
            return
        except (OSError, asyncio.TimeoutError, asyncssh.Error) as exc:
            await t.set_state("error", f"Couldn't connect: {str(exc) or type(exc).__name__}"[:200])
            return
        if not pinned:   # trust on first use
            self.pin(t.owner, hostport, conn.get_server_host_key().export_public_key("openssh").decode().strip())
        try:
            chan, _ = await conn.create_session(lambda: Session(t), term_type="xterm-256color",
                                                term_size=(t.cols, t.rows), encoding=None)
        except asyncssh.Error as exc:
            conn.close()
            await t.set_state("error", f"No shell: {exc}"[:200])
            return
        t.conn, t.chan = conn, chan
        self.save_host(t.owner, t.target)   # connected once: it's a saved host now
        t.screen.reset()
        await t.set_state("connected", t.target)

    async def drop(self, pane_id):
        t = self.terms.pop(pane_id, None)
        if t and t.conn:
            t.conn.close()

    async def reap(self):
        now = time.monotonic()
        for pid, t in list(self.terms.items()):
            if now - t.used > (IDLE_S if t.state == "connected" else IDLE_CLOSED_S):
                await self.drop(pid)

    async def close(self):
        for pid in list(self.terms):
            await self.drop(pid)


def make_app(data_dir, stratum, users):
    T = Terminals(data_dir, users)
    routes = web.RouteTableDef()

    def pid(request):
        p = request.match_info["id"]
        if not (1 <= len(p) <= 64) or not all(c.isalnum() or c in "-_" for c in p):
            raise web.HTTPBadRequest(text="bad pane id")
        return p

    def size(q):
        try:
            return min(200, max(20, int(q.get("cols", 80)))), min(80, max(8, int(q.get("rows", 24))))
        except ValueError:
            raise web.HTTPBadRequest(text="bad size")

    async def term_of(request, create=False):
        return await T.term(pid(request), T.check_user(request["player"]), *size(request.query), create=create)

    @routes.get("/health")
    async def health(request):
        return web.json_response({"ok": True, "terminals": len(T.terms)})

    @routes.get("/key")
    async def key(request):
        return web.json_response({"publicKey": T.public_key(T.check_user(request["player"]))})

    @routes.get("/hosts")
    async def hosts(request):
        return web.json_response({"hosts": T.saved(T.check_user(request["player"]))})

    @routes.post("/hosts")
    async def add_host(request):
        body = await request.json()
        return web.json_response({"hosts": T.save_host(T.check_user(request["player"]), str(body.get("target", "")), body.get("name"))})

    @routes.delete("/hosts")
    async def remove_host(request):
        return web.json_response({"hosts": T.remove_host(T.check_user(request["player"]), request.query.get("target", ""))})

    @routes.get("/panes/{id}")
    async def open_term(request):
        return web.json_response((await term_of(request, create=True)).info())

    @routes.get("/panes/{id}/screen")
    async def screen(request):
        """Long poll: the screen once it is newer than ?after=."""
        t = await term_of(request, create=True)
        after = int(request.query.get("after", "-1") or -1)
        async with t.changed:
            try:
                await asyncio.wait_for(t.changed.wait_for(lambda: t.seq > after), SCREEN_WAIT_S)
            except asyncio.TimeoutError:
                return web.Response(status=204)
        t.used = time.monotonic()
        return web.json_response(t.snapshot(request.query.get("scroll", 0) or 0))

    @routes.post("/panes/{id}/connect")
    async def connect(request):
        t = await term_of(request, create=True)
        body = await request.json()
        await T.connect(t, str(body.get("target", "")), body.get("password") or None)
        return web.json_response(t.info())

    @routes.post("/panes/{id}/input")
    async def input_(request):
        t = await term_of(request)
        ev = await request.json()
        if "paste" in ev:
            data = t.paste(str(ev["paste"])[:65536])
        else:
            data = str(ev["text"]).encode()[:4096] if "text" in ev else key_bytes(ev.get("key"))
        if not t.chan:
            raise web.HTTPConflict(text="not connected")
        t.chan.write(data)
        return web.json_response({"ok": True})

    @routes.get("/panes/{id}/text")
    async def text(request):
        """Selected text: ?from=line:col&to=line:col (absolute lines, see snapshot.top)."""
        t = await term_of(request)
        try:
            a, b = (tuple(int(v) for v in request.query[k].split(":")) for k in ("from", "to"))
        except (KeyError, ValueError):
            raise web.HTTPBadRequest(text="from/to must be line:col")
        return web.json_response({"text": t.text(a, b)[:65536]})

    @routes.post("/panes/{id}/resize")
    async def resize(request):
        t = await term_of(request)
        body = await request.json()
        cols, rows = size(body)
        if (cols, rows) != (t.cols, t.rows):
            t.cols, t.rows = cols, rows
            t.screen.resize(rows, cols)
            if t.chan:
                t.chan.change_terminal_size(cols, rows)
            await t.bump()
        return web.json_response(t.info())

    @routes.post("/panes/{id}/disconnect")
    async def disconnect(request):
        t = await term_of(request)
        if t.conn:
            t.conn.close()
            t.conn = t.chan = None
            await t.say("\n[disconnected]\n")
        await t.set_state("closed", "Disconnected")
        return web.json_response(t.info())

    @routes.post("/forget")
    async def forget(request):
        owner = T.check_user(request["player"])
        user, host, port = parse_target((await request.json()).get("target", ""), default_user="x")
        T.forget(owner, f"{host}:{port}")
        return web.json_response({"ok": True})

    @routes.delete("/panes/{id}")
    async def close(request):
        await term_of(request)   # ownership check
        await T.drop(pid(request))
        return web.Response(status=204)

    async def lifecycle(app):
        async def reaper():
            while True:
                await asyncio.sleep(30)
                await T.reap()
        task = asyncio.create_task(reaper())
        yield
        task.cancel()
        await T.close()

    app = web.Application(middlewares=[stratum.middleware])
    app["terminals"] = T
    app.add_routes(routes)
    app.cleanup_ctx.append(lifecycle)
    return app


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8006)))
    ap.add_argument("--data", default=os.environ.get("SSH_DATA", "/data"))
    args = ap.parse_args()
    users = {u.strip() for u in os.environ.get("SSH_USERS", "").split(",") if u.strip()}
    web.run_app(make_app(args.data, Stratum.from_env("ssh"), users), host="0.0.0.0", port=args.port)
