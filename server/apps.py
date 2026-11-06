"""Apps: registry, backend proxy with signed identity, live channels, state.
DESIGN.md §6.

An app lives in apps/<id>/:
    manifest.json   id, name, icon, description, entry, permissions, backend
    client/         ES modules served at /apps/<id>/  (entry is relative to it)
    backend/        optional service (its own container); see sdk/ (stratum_backend.py)

Backend config comes from the environment so secrets never sit in the repo:
    STRATUM_APP_SECRET_<ID>    shared secret (signs proxied requests, authorizes broadcasts)
    STRATUM_APP_BACKEND_<ID>   overrides manifest.backend (e.g. for tests)
"""
import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
PERMISSIONS = {"backend", "channel", "state", "identity", "physics"}
SETTING_TYPES = {"toggle", "choice", "number", "text"}
PROXY_MAX_BODY = 1024 * 1024
PROXY_TIMEOUT_S = 10
SOCKET_MAX_IN = 64 * 1024          # client → backend message (input, keys)
SOCKET_MAX_OUT = 4 * 1024 * 1024   # backend → client message (e.g. a video keyframe)
SOCKETS_PER_USER = 16              # open app sockets per (user, app)
RATE_PER_S, RATE_BURST = 60, 120   # per user and app (streams go over sockets, not requests)


def env_key(app_id):
    return app_id.upper().replace("-", "_")


class App:
    def __init__(self, directory, manifest):
        self.dir = directory
        self.id = manifest["id"]
        self.manifest = manifest
        self.permissions = set(manifest.get("permissions", []))
        self.backend = os.environ.get(f"STRATUM_APP_BACKEND_{env_key(self.id)}") or manifest.get("backend")
        self.secret = os.environ.get(f"STRATUM_APP_SECRET_{env_key(self.id)}", "").encode() or None

    def public(self):
        m = self.manifest
        return {
            "id": self.id, "name": m["name"], "icon": m.get("icon", ""), "description": m.get("description", ""),
            "entry": f"/apps/{self.id}/{m['entry']}", "permissions": sorted(self.permissions),
            "placeable": m.get("placeable", True), "hasBackend": bool(self.backend),
            "mount": m.get("mount"),
            "ownHandle": bool(m.get("ownHandle")),   # the app marks its own grab handle; no default puck
            "category": m.get("category", ""), "color": m.get("color", ""),
            # Per-user settings the menu shows on the app's page (DESIGN.md §8.3).
            "gestures": m.get("gestures", []),   # help rows for the Gestures tab
            "settings": m.get("settings", []),   # "wall": hangs flat on a wall when aimed at one (room map / vertical hit)
            # Optional: several Place tiles for one app, each with its own config.
            "variants": [{"key": v["key"], "icon": v.get("icon", m.get("icon", "")), "name": v["name"],
                          "description": v.get("description", ""),
                          "config": v.get("config", {}), "mount": v.get("mount")} for v in m.get("variants", [])],
        }


class Registry:
    def __init__(self, apps_dir):
        self.dir = Path(apps_dir)
        self.apps = {}
        for manifest_path in sorted(self.dir.glob("*/manifest.json")):
            m = json.loads(manifest_path.read_text())
            if not ID_RE.match(m.get("id", "")) or m["id"] != manifest_path.parent.name:
                raise ValueError(f"{manifest_path}: id must match its folder and {ID_RE.pattern}")
            unknown = set(m.get("permissions", [])) - PERMISSIONS
            if unknown:
                raise ValueError(f"{manifest_path}: unknown permissions {sorted(unknown)}")
            for st in m.get("settings", []):
                if st.get("type") not in SETTING_TYPES or not st.get("key") or not st.get("label"):
                    raise ValueError(f"{manifest_path}: settings need key, label and a type in {sorted(SETTING_TYPES)}")
            if not (manifest_path.parent / "client" / m["entry"]).exists():
                raise ValueError(f"{manifest_path}: entry {m['entry']} not found in client/")
            self.apps[m["id"]] = App(manifest_path.parent, m)

    def get(self, app_id):
        return self.apps.get(app_id)


def check_setting(schema, key, value):
    """Validate one setting value against the app's manifest schema → the
    value to store, or raise ValueError."""
    s = next((x for x in schema if x["key"] == key), None)
    if not s:
        raise ValueError(f"no setting {key!r}")
    t = s["type"]
    if t == "toggle" and isinstance(value, bool):
        return value
    if t == "choice" and value in [o[0] for o in s.get("options", [])]:
        return value
    if t == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
        if s.get("min") is not None and value < s["min"] or s.get("max") is not None and value > s["max"]:
            raise ValueError(f"{key} must be {s.get('min')}..{s.get('max')}")
        return value
    if t == "text" and isinstance(value, str) and len(value) <= s.get("maxLength", 500):
        return value
    raise ValueError(f"bad value for {key}")


def pseudonym(server_secret, app_id, user_id):
    """Stable per-(app, user) id: backends can keep scores without learning
    who you are. Apps with the 'identity' permission also get the name."""
    return hmac.new(server_secret, f"{app_id}:{user_id}".encode(), hashlib.sha256).hexdigest()[:16]


def sign(secret, app_id, user, name, ts, method, path_qs):
    msg = "\n".join([app_id, user, name, str(ts), method, path_qs]).encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


class RateLimiter:
    """Token bucket per key, in memory (per process; fine for one server)."""

    def __init__(self, rate=RATE_PER_S, burst=RATE_BURST):
        self.rate, self.burst, self.buckets = rate, burst, {}

    def allow(self, key):
        now = time.monotonic()
        tokens, last = self.buckets.get(key, (self.burst, now))
        tokens = min(self.burst, tokens + (now - last) * self.rate)
        if tokens < 1:
            self.buckets[key] = (tokens, now)
            return False
        self.buckets[key] = (tokens - 1, now)
        return True


def server_secret(data_dir):
    """Secret for pseudonyms. STRATUM_SECRET, else a generated file in data/."""
    env = os.environ.get("STRATUM_SECRET")
    if env:
        return env.encode()
    path = Path(data_dir) / "server.key"
    if not path.exists():
        path.write_text(os.urandom(32).hex())
        path.chmod(0o600)
    return path.read_text().strip().encode()
