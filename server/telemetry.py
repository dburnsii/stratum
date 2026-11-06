"""Client + server telemetry: errors and log lines, appended to daily JSONL
files (data/telemetry/YYYY-MM-DD.jsonl, UTC dates) so they can be read straight off
disk:

    tail -f data/telemetry/$(date -u +%F).jsonl
    python server/telemetry.py            # last 50 events, readable
    python server/telemetry.py -n 200 --level error

Ops data, not world data, so it lives outside store.py/SQLite on purpose.
"""
import argparse
import datetime
import json
import time
from pathlib import Path

RETENTION_DAYS = 14
MAX_EVENTS_PER_POST = 200
MAX_MSG = 2000
MAX_DATA = 8000
LEVELS = ("debug", "info", "warn", "error")


def utc_today():
    return datetime.datetime.now(datetime.timezone.utc).date()


class Telemetry:
    def __init__(self, directory):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._prune()

    def _prune(self):
        cutoff = utc_today() - datetime.timedelta(days=RETENTION_DAYS)
        for f in self.dir.glob("*.jsonl"):
            try:
                if datetime.date.fromisoformat(f.stem) < cutoff:
                    f.unlink()
            except ValueError:
                pass

    def write(self, events):
        path = self.dir / f"{utc_today().isoformat()}.jsonl"
        with path.open("a") as f:
            for e in events:
                f.write(json.dumps(e, separators=(",", ":")) + "\n")

    def from_client(self, body, user, remote):
        """Validate + normalize a client batch. Returns the number stored."""
        ctx = body.get("ctx") if isinstance(body.get("ctx"), dict) else {}
        events = body.get("events")
        if not isinstance(events, list):
            return 0
        now = int(time.time() * 1000)
        out = []
        for e in events[:MAX_EVENTS_PER_POST]:
            if not isinstance(e, dict):
                continue
            level = e.get("level") if e.get("level") in LEVELS else "info"
            data = e.get("data")
            data_s = json.dumps(data) if data is not None else None
            out.append({
                "ts": now,
                "ct": e.get("t") if isinstance(e.get("t"), (int, float)) else None,   # client clock
                "src": "client",
                "level": level,
                "msg": str(e.get("msg", ""))[:MAX_MSG],
                **({"data": data if len(data_s) <= MAX_DATA else data_s[:MAX_DATA]} if data_s else {}),
                "page": str(ctx.get("page", ""))[:200],
                "ver": str(ctx.get("version", ""))[:50],
                "load": str(ctx.get("load", ""))[:40],      # one id per page load
                "device": str(ctx.get("device", ""))[:40],
                "ua": str(ctx.get("ua", ""))[:300],
                "user": user["name"] if user else None,
                "ip": remote,
            })
        if out:
            self.write(out)
        return len(out)

    def server_error(self, request, exc, tb):
        self.write([{
            "ts": int(time.time() * 1000), "src": "server", "level": "error",
            "msg": f"{type(exc).__name__}: {exc}", "data": {"trace": tb[-MAX_DATA:]},
            "page": f"{request.method} {request.path_qs}"[:200], "ip": request.remote,
        }])


def main():
    """Pretty-print recent events."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", type=int, default=50, help="how many recent events")
    ap.add_argument("--level", choices=LEVELS, help="minimum level")
    ap.add_argument("--dir", default=str(Path(__file__).resolve().parent.parent / "data" / "telemetry"))
    args = ap.parse_args()
    files = sorted(Path(args.dir).glob("*.jsonl"))[-2:]   # today + yesterday is plenty
    rows = [json.loads(line) for f in files for line in f.read_text().splitlines() if line]
    if args.level:
        rows = [r for r in rows if LEVELS.index(r["level"]) >= LEVELS.index(args.level)]
    for r in rows[-args.n:]:
        t = datetime.datetime.fromtimestamp(r["ts"] / 1000).strftime("%m-%d %H:%M:%S")
        who = f'{r.get("device", "")[:8]} {r.get("ver", "")}'.strip() if r["src"] == "client" else "server"
        print(f'{t} {r["level"]:5} [{who}] {r.get("page", "")}: {r["msg"]}')
        if r.get("data"):
            print(f'      {json.dumps(r["data"])[:500]}')


if __name__ == "__main__":
    main()
