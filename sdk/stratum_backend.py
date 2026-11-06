"""Helpers for Stratum app backends (aiohttp). Copied into each backend image.

Every request from a player arrives through Stratum's proxy, signed:
    X-Stratum-App, X-Stratum-User (app-scoped pseudonym), X-Stratum-Name
    (username, only with the 'identity' permission), X-Stratum-Time (ms),
    X-Stratum-Signature = HMAC-SHA256(secret, app\\nuser\\nname\\ntime\\nmethod\\npath?query)

    from stratum_backend import Stratum
    stratum = Stratum.from_env("golf")       # STRATUM_APP_SECRET, STRATUM_URL
    app = web.Application(middlewares=[stratum.middleware])
    ...
    async def handler(request):
        player = request["player"]           # {"user": "7f3a…", "name": ""}
        await stratum.broadcast("tank-1", {"type": "fed"})
"""
import hashlib
import hmac
import os
import time

from aiohttp import ClientSession, ClientTimeout, web

MAX_SKEW_MS = 60_000


class Stratum:
    def __init__(self, app_id, secret, url):
        self.app_id = app_id
        self.secret = secret.encode()
        self.url = url.rstrip("/")
        self._http = None

    @classmethod
    def from_env(cls, app_id):
        secret = os.environ.get("STRATUM_APP_SECRET")
        if not secret:
            raise SystemExit("STRATUM_APP_SECRET is not set")
        return cls(app_id, secret, os.environ.get("STRATUM_URL", "http://stratum:8930"))

    def verify(self, request):
        h = request.headers
        try:
            app, user, name, ts = h["X-Stratum-App"], h["X-Stratum-User"], h.get("X-Stratum-Name", ""), h["X-Stratum-Time"]
            sig = h["X-Stratum-Signature"]
        except KeyError:
            return None
        if app != self.app_id or abs(time.time() * 1000 - int(ts)) > MAX_SKEW_MS:
            return None
        msg = "\n".join([app, user, name, ts, request.method, request.path_qs]).encode()
        if not hmac.compare_digest(sig, hmac.new(self.secret, msg, hashlib.sha256).hexdigest()):
            return None
        return {"user": user, "name": name}

    @web.middleware
    async def middleware(self, request, handler):
        if request.path == "/health":
            return await handler(request)
        player = self.verify(request)
        if not player:
            raise web.HTTPUnauthorized(text="requests must come through Stratum")
        request["player"] = player
        return await handler(request)

    async def broadcast(self, channel, msg):
        """Push to every player in an app channel (they joined via ctx.channel)."""
        if self._http is None:
            self._http = ClientSession(timeout=ClientTimeout(total=5), connector=None)
        try:
            async with self._http.post(f"{self.url}/api/apps/{self.app_id}/broadcast",
                                       json={"channel": channel, "msg": msg},
                                       headers={"Authorization": f"Bearer {self.secret.decode()}"},
                                       ssl=False) as r:
                return (await r.json()).get("delivered", 0) if r.status == 200 else 0
        except Exception:
            return 0   # players re-sync on their next fetch; never crash the sim

    async def close(self):
        if self._http:
            await self._http.close()
