#!/usr/bin/env python3
"""Read hand recordings (client/js/handrec.js → data/handrec/) for gesture training.

    .venv/bin/python tools/handrec.py                 # summary: sessions, hand time, labels seen
    .venv/bin/python tools/handrec.py --events SESSION   # one session's labels (log lines, XR events)

    from handrec import load_session, sessions
    s = load_session("data/handrec", session_id)
    s["t"]      (n,)            float64 ms, epoch (Date.now clock)
    s["head"]   (n, 7)          float32 position m, quaternion xyzw
    s["tracked"](n, 2)          bool    left, right
    s["joints"] (n, 2, 25, 3)   float32 m, world (refSpace) frame
    s["wrist_q"](n, 2, 4)       float32 xyzw
    s["events"] [dict]          ts (epoch ms), kind ('log' | 'xr' | ...), ...
    s["meta"]   [dict]          each chunk's header without events
    windows(s)  [dict]          the labelled windows, bad takes (redone / cancelled) left out
"""
import argparse
import gzip
import json
import struct
import sys
from collections import Counter
from pathlib import Path

import numpy as np

JOINTS = 25
PER_HAND = JOINTS * 3 + 4


def read_chunk(path):
    raw = Path(path).read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    (hlen,) = struct.unpack_from("<I", raw, 0)
    header = json.loads(raw[4:4 + hlen])
    if header.get("format") != "stratum-handrec" or header.get("version") != 1:
        raise ValueError(f"{path}: unknown format {header.get('format')} v{header.get('version')}")
    n, off = header["frames"], 4 + hlen
    def take(dtype, count):
        nonlocal off
        a = np.frombuffer(raw, dtype=dtype, count=count, offset=off)
        off += a.nbytes
        return a
    t = take("<f4", n)
    head = take("<f4", n * 7).reshape(n, 7)
    flags = take("u1", n)
    hands = take("<i2", n * 2 * PER_HAND).reshape(n, 2, PER_HAND)
    joints = hands[:, :, :JOINTS * 3].reshape(n, 2, JOINTS, 3).astype(np.float32) / header["posScale"] + head[:, None, None, :3]
    tracked = np.stack([(flags & 1) > 0, (flags & 2) > 0], axis=1)
    joints[~tracked] = np.nan
    return header, {
        "t": header["t0Epoch"] + t.astype(np.float64),
        "head": head.copy(),
        "tracked": tracked,
        "joints": joints,
        "wrist_q": hands[:, :, JOINTS * 3:].astype(np.float32) / 32767,
    }


def chunk_paths(root, session):
    return sorted(Path(root).glob(f"*/{session}/*.hrec*"), key=lambda p: int(p.name.split(".")[0]))


def sessions(root):
    """{session: [chunk paths]} for everything recorded."""
    out = {}
    for p in sorted(Path(root).glob("*/*/*.hrec*")):
        if p.suffix == ".tmp":
            continue
        out.setdefault(p.parent.name, []).append(p)
    return out


def load_session(root, session):
    metas, parts, events = [], [], []
    for p in chunk_paths(root, session):
        h, a = read_chunk(p)
        events += h.pop("events", [])
        metas.append(h)
        parts.append(a)
    if not parts:
        raise FileNotFoundError(f"no chunks for {session} under {root}")
    s = {k: np.concatenate([a[k] for a in parts]) for k in parts[0]}
    s["events"] = sorted(events, key=lambda e: e.get("ts", 0))
    s["meta"] = metas
    return s


def windows(session):
    """The labelled windows of a loaded session (trainer and labelling pad), bad takes dropped:
    [{gesture, stage, side, source, step, rep, take, t0, t1 (epoch ms), how}]. A trainer take
    the user redid ('discard') is left out, with every stage of it; so is a pad window that was
    cancelled. Use the frames with t0 <= t <= t1."""
    out, open_ = [], {}
    labels = [e for e in session["events"] if e.get("kind") == "label"]
    bad = {e.get("take") for e in labels if e.get("phase") == "discard" and e.get("take") is not None}
    bad_old = {(e.get("step"), e.get("rep")) for e in labels if e.get("phase") == "discard" and e.get("take") is None}
    for e in labels:
        key = (e.get("source"), e.get("step") or e.get("gesture"), e.get("stage"), e.get("side"), e.get("take", e.get("rep")))
        if e.get("phase") == "start":
            open_[key] = e
        elif e.get("phase") == "end" and key in open_:
            s = open_.pop(key)
            if e.get("how") in ("cancelled",):
                continue
            out.append({"gesture": e.get("gesture"), "stage": e.get("stage"), "side": e.get("side"), "source": e.get("source", "pad"),
                        "step": e.get("step"), "rep": e.get("rep"), "take": e.get("take"), "t0": s["ts"], "t1": e["ts"], "how": e.get("how")})
    if bad_old:   # (sessions before take ids: a discard named step + rep, so the last such window before it is the bad one)
        for d in [e for e in labels if e.get("phase") == "discard" and e.get("take") is None]:
            hits = [w for w in out if (w["step"], w["rep"]) == (d.get("step"), d.get("rep")) and w["t1"] <= d["ts"] and not w.get("_bad")]
            if hits:
                last_t0 = max(w["t0"] for w in hits if w["stage"] == hits[0]["stage"]) if hits else None
                take_ws = [w for w in hits if w["t0"] >= (last_t0 or 0) - 10000 and w["t1"] <= d["ts"]]
                # the bad take is the latest run of this step + rep's stages before the discard
                latest_start = max(w["t0"] for w in take_ws)
                first_stage = [w for w in take_ws if w["t0"] <= latest_start]
                cut = max(w["t0"] for w in first_stage if w["stage"] == take_ws[0]["stage"])
                for w in take_ws:
                    if w["t0"] >= cut:
                        w["_bad"] = True
    return [{k: v for k, v in w.items() if k != "_bad"} for w in out if w.get("take") not in bad and not w.get("_bad")]


def label_of(e):
    k = e.get("kind")
    if k == "log":
        return e.get("msg")
    if k == "label":   # (trainer / labelling pad: gesture[.stage] side phase)
        return f"label:{e.get('gesture')}{'.' + e['stage'] if e.get('stage') else ''}:{e.get('side')}:{e.get('phase')}"
    return f"{k}:{e.get('type', '')}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent / "data" / "handrec"))
    ap.add_argument("--events", metavar="SESSION", help="print one session's labels")
    args = ap.parse_args()
    if args.events:
        s = load_session(args.root, args.events)
        for e in s["events"]:
            print(e.get("ts"), label_of(e), json.dumps(e.get("data") or {k: v for k, v in e.items() if k not in ("ts", "kind", "msg", "level")})[:160])
        return
    all_s = sessions(args.root)
    if not all_s:
        print(f"no recordings under {args.root}")
        return
    total_frames, total_bytes, labels = 0, 0, Counter()
    for sid, paths in all_s.items():
        frames, span, ev = 0, 0.0, Counter()
        for p in paths:
            try:
                h, a = read_chunk(p)
            except (ValueError, OSError) as err:
                print(f"  skip {p}: {err}", file=sys.stderr)
                continue
            frames += h["frames"]
            span += (a["t"][-1] - a["t"][0]) / 1000 if h["frames"] > 1 else 0
            ev.update(label_of(e) for e in h.get("events", []))
            total_bytes += p.stat().st_size
        total_frames += frames
        labels.update(ev)
        print(f"{sid}  {len(paths)} chunks  {frames} frames  ~{span / 60:.1f} min with hands  {sum(ev.values())} events")
    print(f"\n{len(all_s)} sessions · {total_frames} frames · {total_bytes / 1e6:.1f} MB")
    print("labels seen:", ", ".join(f"{k} ×{v}" for k, v in labels.most_common(25)))


if __name__ == "__main__":
    main()
