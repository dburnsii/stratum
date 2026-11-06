"""Helpers for testing an app backend the way Stratum's proxy calls it
(apps/<id>/tests/test_<id>_backend.py): load its server.py, sign requests."""
import asyncio
import hashlib
import hmac
import importlib.util
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sdk"))
from stratum_backend import Stratum  # noqa: E402


def load(app_id):
    spec = importlib.util.spec_from_file_location(f"{app_id}_backend", ROOT / "apps" / app_id / "backend" / "server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def signed(app_id, secret, method, path, user="player1", name=""):
    ts = str(int(time.time() * 1000))
    msg = "\n".join([app_id, user, name, ts, method, path]).encode()
    return {"X-Stratum-App": app_id, "X-Stratum-User": user, "X-Stratum-Name": name, "X-Stratum-Time": ts,
            "X-Stratum-Signature": hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()}


class FakeBroadcast(Stratum):
    def __init__(self, app_id):
        super().__init__(app_id, "s3cret", "http://unused")
        self.sent = []

    async def broadcast(self, channel, msg):
        self.sent.append((channel, msg))
        return 1


