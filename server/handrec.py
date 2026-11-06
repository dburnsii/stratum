"""Hand recordings for gesture training (client/js/handrec.js writes them).

Each upload is one ~10 s chunk, kept as sent (gzip) in
    <dir>/<YYYY-MM-DD UTC>/<session>/<seq 00000>.hrec.gz
with one line per chunk in <dir>/index.jsonl (when, who, which device,
session, seq, bytes). Storage stops at a cap (default 20 GB): uploads then
get 507 and the client stops sending. Read chunks with tools/handrec.py.
"""
import json
import os
import time
from pathlib import Path

MAX_CHUNK_BYTES = 4 * 1024 * 1024
DEFAULT_CAP_BYTES = int(float(os.environ.get("STRATUM_HANDREC_CAP_GB", "20")) * 1e9)
GZIP_MAGIC = b"\x1f\x8b"


class Full(Exception):
    pass


class HandRecordings:
    def __init__(self, root, cap_bytes=DEFAULT_CAP_BYTES):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.cap = cap_bytes
        self.used = sum(p.stat().st_size for p in self.root.rglob("*.hrec*"))

    def save(self, user_id, device, session, seq, body, gz):
        if self.used + len(body) > self.cap:
            raise Full(f"hand recordings are full ({self.used / 1e9:.1f} GB)")
        day = time.strftime("%Y-%m-%d", time.gmtime())
        folder = self.root / day / session
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{seq:05d}.hrec{'.gz' if gz else ''}"
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_bytes(body)
        tmp.replace(path)
        self.used += len(body)
        with open(self.root / "index.jsonl", "a") as f:
            f.write(json.dumps({"ts": int(time.time() * 1000), "user": user_id, "device": device, "session": session,
                                "seq": seq, "bytes": len(body), "path": str(path.relative_to(self.root))}) + "\n")
        return path

    def summary(self):
        return {"bytes": self.used, "cap": self.cap}
