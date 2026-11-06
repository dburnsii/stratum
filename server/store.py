"""SQLite persistence. Every query the server makes lives here, so moving to
Postgres later is a one-file change (DESIGN.md §7, §9)."""
import json
import secrets
import sqlite3
import time
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('rev', 0);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,              -- user id, or 'system'
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared', 'public', 'app')),
  app_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS layer_members (
  layer_id TEXT NOT NULL REFERENCES layers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  PRIMARY KEY (layer_id, user_id)
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  geo TEXT,                            -- JSON {lat, lon, alt, heading, accuracy}, optional
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  pose TEXT NOT NULL,                  -- JSON pose of the anchor in the Space frame
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS anchor_bindings (
  anchor_id TEXT NOT NULL REFERENCES anchors(id),
  device_id TEXT NOT NULL,
  handle TEXT NOT NULL,                -- Quest persistent anchor handle (device-local)
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (anchor_id, device_id)
);

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  layer_id TEXT NOT NULL REFERENCES layers(id),
  pose TEXT NOT NULL,
  components TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_space_rev ON objects (space_id, rev);

-- Printed fiducials. A tag id names at most one of a user's Spaces, so
-- seeing tag N tells a device which Space it is in and where.
CREATE TABLE IF NOT EXISTS markers (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  family TEXT NOT NULL DEFAULT 'tag36h11',
  tag INTEGER NOT NULL,
  size REAL NOT NULL,                  -- black-square edge, meters
  pose TEXT NOT NULL,                  -- JSON pose of the marker in the Space frame
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, family, tag)
);

-- Content-addressed uploads (sha256). Bytes live on disk under data/assets;
-- user_assets is each user's library (same bytes uploaded twice = one row).
CREATE TABLE IF NOT EXISTS assets (
  hash TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('model', 'image', 'video')),
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Apps (DESIGN.md §6): which apps a user has turned on, and small per-user
-- app state (best scores, settings).
CREATE TABLE IF NOT EXISTS app_installs (
  user_id TEXT NOT NULL REFERENCES users(id),
  app_id TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id)
);
CREATE TABLE IF NOT EXISTS app_state (
  user_id TEXT NOT NULL REFERENCES users(id),
  app_id TEXT NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, app_id, k)
);

-- Invite codes: anyone holding one joins the Space (and its shared layer)
-- until it expires. DESIGN.md §5.1.
CREATE TABLE IF NOT EXISTS space_invites (
  code TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Room map: a Space's real surfaces, in the Space frame. pose = the
-- plane's frame (local +Y = surface normal); polygon = its outline in that
-- frame's XZ plane. DESIGN.md §3.8.
CREATE TABLE IF NOT EXISTS surfaces (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  kind TEXT NOT NULL,
  pose TEXT NOT NULL,
  polygon TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'phone' (swept samples) | 'quest' (Space Setup planes)
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS surfaces_space ON surfaces (space_id);

-- Living world map (DESIGN.md §3.10). `surfaces` above holds the merged
-- result; these are its inputs and the voxel map's bookkeeping (the voxels
-- and keyframe blobs themselves live in data/map/<space>/).
-- surface_obs: one source's view of one surface (a Quest scan plane, a phone
-- sweep, a plane the map found); canonical_id = the merged surface it fed.
CREATE TABLE IF NOT EXISTS surface_obs (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES spaces(id),
  kind TEXT NOT NULL,
  pose TEXT NOT NULL,
  polygon TEXT NOT NULL,
  source TEXT NOT NULL,                -- 'quest' | 'phone' | 'map'
  device TEXT,
  weight REAL,
  canonical_id TEXT,
  created_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  retired_at INTEGER                   -- the map saw empty space where it was
);
CREATE INDEX IF NOT EXISTS surface_obs_space ON surface_obs (space_id);
CREATE TABLE IF NOT EXISTS map_keyframes (
  id TEXT PRIMARY KEY,                 -- time-sortable, server-made
  space_id TEXT NOT NULL REFERENCES spaces(id),
  kind TEXT NOT NULL,                  -- 'depth' | 'points'
  session TEXT NOT NULL,
  device TEXT,
  created_by TEXT NOT NULL,
  quality REAL,
  pos TEXT,                            -- camera position [x, y, z] (Space frame), for pruning
  mkey TEXT,                           -- point sets: what they are (dedupe)
  bytes INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS map_keyframes_space ON map_keyframes (space_id, id);
CREATE TABLE IF NOT EXISTS map_sessions (
  space_id TEXT NOT NULL REFERENCES spaces(id),
  id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  device TEXT,
  correction TEXT,                     -- pose: this session's alignment fix
  accepted INTEGER NOT NULL DEFAULT 0,
  keyframes INTEGER NOT NULL DEFAULT 0,
  rms REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, id)
);
CREATE TABLE IF NOT EXISTS map_meta (
  space_id TEXT PRIMARY KEY REFERENCES spaces(id),
  version INTEGER NOT NULL DEFAULT 0,
  stats TEXT,
  changes TEXT,                        -- recent change events (JSON list)
  since_rebuild INTEGER NOT NULL DEFAULT 0,
  rebuilt_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_assets (
  user_id TEXT NOT NULL REFERENCES users(id),
  hash TEXT NOT NULL REFERENCES assets(hash),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, hash)
);
"""

EDIT_ROLES = ("editor", "admin")
INVITE_TTL_MS = 24 * 3600 * 1000
INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"   # no 0/O, 1/I/L: easy to read aloud
# M0 placeholder until real auth: every signed-in user may edit the public
# "World" layer. Flip to False once identities mean something.
PUBLIC_LAYER_OPEN_EDIT = True


def now_ms():
    return int(time.time() * 1000)


def new_id():
    # Server-side ids (users, layers). Object/space/anchor ids come from the client.
    return str(uuid.uuid4())


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SCHEMA)
        self._migrate()
        self.public_layer_id = self._ensure_public_layer()

    def _migrate(self):
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(layers)")}
        if "space_id" not in cols:   # shared layer of a Space (kind 'shared')
            self.db.execute("ALTER TABLE layers ADD COLUMN space_id TEXT")
            self.db.execute("CREATE INDEX IF NOT EXISTS layers_space ON layers (space_id)")
        cols = {r["name"] for r in self.db.execute("PRAGMA table_info(surfaces)")}
        if "sources" not in cols:   # surfaces became the merged map (§3.10): old rows are its first observations
            for col in ("sources TEXT", "evidence REAL", "users INTEGER", "first_seen INTEGER", "last_seen INTEGER"):
                self.db.execute(f"ALTER TABLE surfaces ADD COLUMN {col}")
            self.db.execute(
                """INSERT OR IGNORE INTO surface_obs (id, space_id, kind, pose, polygon, source, canonical_id, created_by, updated_at)
                   SELECT id, space_id, kind, pose, polygon, source, id, created_by, updated_at FROM surfaces""")
            self.db.execute("UPDATE surfaces SET sources = json_array(source), evidence = 1, users = 1, "
                            "first_seen = updated_at, last_seen = updated_at")

    def _ensure_public_layer(self):
        row = self.db.execute(
            "SELECT id FROM layers WHERE kind='public' AND owner_id='system' AND name='World'"
        ).fetchone()
        if row:
            return row["id"]
        lid = new_id()
        self.db.execute(
            "INSERT INTO layers (id, name, owner_id, kind, created_at) VALUES (?, 'World', 'system', 'public', ?)",
            (lid, now_ms()),
        )
        return lid

    def _bump_rev(self):
        self.db.execute("UPDATE meta SET v = v + 1 WHERE k='rev'")
        return self.db.execute("SELECT v FROM meta WHERE k='rev'").fetchone()["v"]

    def current_rev(self):
        return self.db.execute("SELECT v FROM meta WHERE k='rev'").fetchone()["v"]

    # ---- users -----------------------------------------------------------

    def login(self, name):
        """Get or create a user by name. New users get a personal layer."""
        row = self.db.execute("SELECT * FROM users WHERE name=?", (name,)).fetchone()
        if row:
            return dict(row)
        uid, lid, t = new_id(), new_id(), now_ms()
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)", (uid, name, t))
            self.db.execute(
                "INSERT INTO layers (id, name, owner_id, kind, created_at) VALUES (?, ?, ?, 'personal', ?)",
                (lid, f"{name} (private)", uid, t),
            )
            self.db.execute(
                "INSERT INTO layer_members (layer_id, user_id, role) VALUES (?, ?, 'admin')", (lid, uid)
            )
        return {"id": uid, "name": name, "created_at": t}

    def get_user(self, uid):
        row = self.db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return dict(row) if row else None

    # ---- layers / ACL ----------------------------------------------------

    def visible_layers(self, uid):
        """Every layer the user can view, with their effective role."""
        rows = self.db.execute(
            """SELECT l.id, l.name, l.kind, l.owner_id, l.app_id, l.space_id, m.role
               FROM layers l
               LEFT JOIN layer_members m ON m.layer_id = l.id AND m.user_id = ?
               WHERE l.kind = 'public' OR m.user_id IS NOT NULL
               ORDER BY l.kind, l.name""",
            (uid,),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            if d["role"] is None:  # public layer, not a member
                d["role"] = "editor" if PUBLIC_LAYER_OPEN_EDIT else "viewer"
            out.append(d)
        return out

    def layer_role(self, uid, layer_id):
        for layer in self.visible_layers(uid):
            if layer["id"] == layer_id:
                return layer["role"]
        return None

    def can_edit_layer(self, uid, layer_id):
        return self.layer_role(uid, layer_id) in EDIT_ROLES

    # ---- spaces / anchors ------------------------------------------------

    def is_space_member(self, uid, space_id):
        return self.db.execute(
            "SELECT 1 FROM space_members WHERE space_id=? AND user_id=?", (space_id, uid)
        ).fetchone() is not None

    def spaces_for(self, uid, device_id):
        spaces = self.db.execute(
            """SELECT s.* FROM spaces s JOIN space_members m ON m.space_id = s.id
               WHERE m.user_id = ? ORDER BY s.created_at""",
            (uid,),
        ).fetchall()
        out = []
        for s in spaces:
            anchors = self.db.execute(
                """SELECT a.id, a.pose, b.handle FROM anchors a
                   LEFT JOIN anchor_bindings b ON b.anchor_id = a.id AND b.device_id = ?
                   WHERE a.space_id = ? ORDER BY a.created_at""",
                (device_id, s["id"]),
            ).fetchall()
            markers = self.db.execute(
                "SELECT family, tag, size, pose FROM markers WHERE space_id = ? ORDER BY created_at", (s["id"],)
            ).fetchall()
            members = self.db.execute(
                """SELECT u.id, u.name FROM space_members m JOIN users u ON u.id = m.user_id
                   WHERE m.space_id = ? ORDER BY u.name""", (s["id"],)).fetchall()
            out.append({
                "id": s["id"],
                "name": s["name"],
                "owner": s["owner_id"] == uid,
                "sharedLayer": self.space_layer(s["id"]),
                "members": [m["name"] for m in members],
                "geo": json.loads(s["geo"]) if s["geo"] else None,
                "anchors": [{"id": a["id"], "pose": json.loads(a["pose"]), "handle": a["handle"]} for a in anchors],
                "markers": [{"family": m["family"], "tag": m["tag"], "size": m["size"], "pose": json.loads(m["pose"])}
                            for m in markers],
            })
        return out

    def create_space(self, uid, space_id, name, anchor=None, device_id=None, marker=None):
        t = now_ms()
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute(
                "INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)",
                (space_id, name, uid, t),
            )
            self.db.execute("INSERT INTO space_members (space_id, user_id) VALUES (?, ?)", (space_id, uid))
            self._insert_space_layer(space_id, name, uid, t)
            if anchor:
                self._insert_anchor(uid, space_id, anchor, device_id, t)
            if marker:
                self._insert_marker(uid, space_id, marker, t)

    # ---- sharing: a Space's shared layer, invites, joining ----------------
    #
    # Every Space has one shared layer (kind 'shared', space_id set) whose
    # members are exactly the Space's members, as editors. Objects in it are
    # visible to everyone in the Space; personal/app layers stay private.

    def _insert_space_layer(self, space_id, name, owner, t):
        lid = new_id()
        self.db.execute(
            "INSERT INTO layers (id, name, owner_id, kind, space_id, created_at) VALUES (?, ?, ?, 'shared', ?, ?)",
            (lid, f"{name} (shared)", owner, space_id, t))
        self.db.execute(
            """INSERT OR IGNORE INTO layer_members (layer_id, user_id, role)
               SELECT ?, user_id, CASE WHEN user_id = ? THEN 'admin' ELSE 'editor' END
               FROM space_members WHERE space_id = ?""", (lid, owner, space_id))
        return lid

    def space_layer(self, space_id):
        """The Space's shared layer id (created for Spaces made before sharing existed)."""
        row = self.db.execute("SELECT id FROM layers WHERE kind = 'shared' AND space_id = ?", (space_id,)).fetchone()
        if row:
            return row["id"]
        s = self.db.execute("SELECT name, owner_id FROM spaces WHERE id = ?", (space_id,)).fetchone()
        with self.db:
            self.db.execute("BEGIN")
            return self._insert_space_layer(space_id, s["name"], s["owner_id"], now_ms())

    def layer_space(self, layer_id):
        """The Space a shared layer belongs to (None: not a Space's shared layer)."""
        row = self.db.execute("SELECT space_id FROM layers WHERE id = ? AND kind = 'shared'", (layer_id,)).fetchone()
        return row["space_id"] if row else None

    def create_invite(self, uid, space_id):
        t = now_ms()
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(6))
        self.db.execute(
            "INSERT INTO space_invites (code, space_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
            (code, space_id, uid, t, t + INVITE_TTL_MS))
        return {"code": code, "expires": t + INVITE_TTL_MS}

    def invite_space(self, code):
        row = self.db.execute("SELECT space_id, expires_at FROM space_invites WHERE code = ?",
                              (code.upper().strip(),)).fetchone()
        return row["space_id"] if row and row["expires_at"] > now_ms() else None

    def join_conflicts(self, uid, space_id):
        """Tags of this Space that one of the user's other Spaces already uses
        (a tag must name one Space per user)."""
        rows = self.db.execute(
            """SELECT m.tag, s.name FROM markers m
               JOIN markers mine ON mine.family = m.family AND mine.tag = m.tag AND mine.space_id != m.space_id
               JOIN space_members sm ON sm.space_id = mine.space_id AND sm.user_id = ?
               JOIN spaces s ON s.id = mine.space_id
               WHERE m.space_id = ?""", (uid, space_id)).fetchall()
        return [{"tag": r["tag"], "space": r["name"]} for r in rows]

    def join_space(self, uid, space_id):
        lid = self.space_layer(space_id)
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute("INSERT OR IGNORE INTO space_members (space_id, user_id) VALUES (?, ?)", (space_id, uid))
            self.db.execute("INSERT OR IGNORE INTO layer_members (layer_id, user_id, role) VALUES (?, ?, 'editor')",
                            (lid, uid))

    def leave_space(self, uid, space_id):
        lid = self.space_layer(space_id)
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute("DELETE FROM space_members WHERE space_id = ? AND user_id = ?", (space_id, uid))
            self.db.execute("DELETE FROM layer_members WHERE layer_id = ? AND user_id = ?", (lid, uid))

    def delete_space(self, space_id):
        """Remove a Space and everything in it: objects (its own and its shared
        layer's), anchors + device bindings, tags, room map, invites,
        members, and the shared layer. Admin/owner use."""
        lid = self.space_layer(space_id)
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute("DELETE FROM anchor_bindings WHERE anchor_id IN (SELECT id FROM anchors WHERE space_id = ?)", (space_id,))
            for table in ("anchors", "markers", "surfaces", "surface_obs", "map_keyframes", "map_sessions", "map_meta",
                          "space_invites", "space_members"):
                self.db.execute(f"DELETE FROM {table} WHERE space_id = ?", (space_id,))
            self.db.execute("DELETE FROM objects WHERE space_id = ? OR layer_id = ?", (space_id, lid))
            if lid:
                self.db.execute("DELETE FROM layer_members WHERE layer_id = ?", (lid,))
                self.db.execute("DELETE FROM layers WHERE id = ?", (lid,))
            self.db.execute("DELETE FROM spaces WHERE id = ?", (space_id,))

    def space_owner(self, space_id):
        row = self.db.execute("SELECT owner_id FROM spaces WHERE id = ?", (space_id,)).fetchone()
        return row["owner_id"] if row else None

    # ---- room map (merged surfaces) and its observations -------------------

    @staticmethod
    def _surface(r):
        return {"id": r["id"], "space": r["space_id"], "kind": r["kind"], "pose": json.loads(r["pose"]),
                "polygon": json.loads(r["polygon"]), "source": r["source"], "updated": r["updated_at"],
                "sources": json.loads(r["sources"]) if r["sources"] else [r["source"]],
                "evidence": r["evidence"] or 1, "users": r["users"] or 1,
                "first": r["first_seen"] or r["updated_at"], "last": r["last_seen"] or r["updated_at"]}

    def surfaces(self, space_id):
        rows = self.db.execute("SELECT * FROM surfaces WHERE space_id = ? ORDER BY updated_at", (space_id,)).fetchall()
        return [self._surface(r) for r in rows]

    def replace_canonical(self, space_id, merged):
        """The merged surface set (§3.10) and which observations fed each.
        Returns True if anything changed."""
        prev = self.surfaces(space_id)
        before = {s["id"]: (s["kind"], json.dumps(s["pose"]), json.dumps(s["polygon"]), s["sources"]) for s in prev}
        updated = {s["id"]: s["updated"] for s in prev}
        after = {m["id"]: (m["kind"], json.dumps(m["pose"]), json.dumps(m["polygon"]), m["sources"]) for m in merged}
        if before == after:
            return False
        t = now_ms()
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute("DELETE FROM surfaces WHERE space_id = ?", (space_id,))
            for m in merged:
                old = before.get(m["id"])
                self.db.execute(
                    """INSERT INTO surfaces (id, space_id, kind, pose, polygon, source, created_by, updated_at,
                                             sources, evidence, users, first_seen, last_seen)
                       VALUES (?, ?, ?, ?, ?, ?, 'map', ?, ?, ?, ?, ?, ?)""",
                    (m["id"], space_id, m["kind"], json.dumps(m["pose"]), json.dumps(m["polygon"]), m["source"],
                     t if old != after[m["id"]] else updated[m["id"]],
                     json.dumps(m["sources"]), m["evidence"], m["users"], m["first"], m["last"]))
                self.db.executemany("UPDATE surface_obs SET canonical_id = ? WHERE id = ?", [(m["id"], o) for o in m["members"]])
        return True

    def surface_obs(self, space_id):
        rows = self.db.execute("SELECT * FROM surface_obs WHERE space_id = ? AND retired_at IS NULL", (space_id,)).fetchall()
        return [{"id": r["id"], "kind": r["kind"], "pose": json.loads(r["pose"]), "polygon": json.loads(r["polygon"]),
                 "source": r["source"], "device": r["device"], "weight": r["weight"], "canonical": r["canonical_id"],
                 "user": r["created_by"], "updated": r["updated_at"]} for r in rows]

    def count_surface_obs(self, space_id):
        return self.db.execute("SELECT COUNT(*) FROM surface_obs WHERE space_id = ?", (space_id,)).fetchone()[0]

    def put_surface_obs(self, uid, space_id, s):
        """Upsert one observation. False if the id belongs to another Space or user."""
        row = self.db.execute("SELECT space_id, created_by FROM surface_obs WHERE id = ?", (s["id"],)).fetchone()
        if row and (row["space_id"] != space_id or row["created_by"] != uid):
            return False
        self.db.execute(
            """INSERT INTO surface_obs (id, space_id, kind, pose, polygon, source, device, weight, created_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, pose = excluded.pose, polygon = excluded.polygon,
                 source = excluded.source, weight = excluded.weight, updated_at = excluded.updated_at, retired_at = NULL""",
            (s["id"], space_id, s["kind"], json.dumps(s["pose"]), json.dumps(s["polygon"]), s["source"], s.get("device"),
             s.get("weight"), uid, now_ms()))
        return True

    def replace_surface_obs(self, uid, space_id, source, observations, device=None):
        """All of one user's (device's) observations from one source at once:
        a Quest re-import, or the planes the map found ('map', uid 'map')."""
        t = now_ms()
        with self.db:
            self.db.execute("BEGIN")
            old = {r["id"]: r["canonical_id"] for r in self.db.execute(
                "SELECT id, canonical_id FROM surface_obs WHERE space_id = ? AND source = ? AND created_by = ? AND COALESCE(device, '') = ?",
                (space_id, source, uid, device or ""))}
            self.db.execute("DELETE FROM surface_obs WHERE space_id = ? AND source = ? AND created_by = ? AND COALESCE(device, '') = ?",
                            (space_id, source, uid, device or ""))
            for s in observations:
                self.db.execute(
                    """INSERT OR REPLACE INTO surface_obs (id, space_id, kind, pose, polygon, source, device, weight, canonical_id,
                                                           created_by, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (s["id"], space_id, s["kind"], json.dumps(s["pose"]), json.dumps(s["polygon"]), source, device,
                     s.get("weight"), s.get("canonical") or old.get(s["id"]), uid, t))

    def retire_surface_obs(self, space_id, canonical_ids):
        """The map saw these surfaces gone: their device observations stop
        counting (a fresh scan or sweep brings them back)."""
        t = now_ms()
        self.db.executemany("UPDATE surface_obs SET retired_at = ? WHERE space_id = ? AND canonical_id = ? AND source != 'map'",
                            [(t, space_id, c) for c in canonical_ids])

    def delete_surfaces(self, space_id, surface_id=None):
        with self.db:
            self.db.execute("BEGIN")
            if surface_id:
                self.db.execute("DELETE FROM surfaces WHERE space_id = ? AND id = ?", (space_id, surface_id))
                self.db.execute("DELETE FROM surface_obs WHERE space_id = ? AND (canonical_id = ? OR id = ?)", (space_id, surface_id, surface_id))
            else:
                self.db.execute("DELETE FROM surfaces WHERE space_id = ?", (space_id,))
                self.db.execute("DELETE FROM surface_obs WHERE space_id = ?", (space_id,))

    # ---- map keyframes, sessions, meta (§3.10) ----------------------------------

    def add_keyframe(self, uid, space_id, k):
        self.db.execute(
            """INSERT INTO map_keyframes (id, space_id, kind, session, device, created_by, quality, pos, mkey, bytes, at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (k["id"], space_id, k["kind"], k["session"], k.get("device"), uid, k.get("quality"),
             json.dumps(k.get("pos")) if k.get("pos") else None, k.get("mkey"), k["bytes"], k["at"]))

    def keyframes(self, space_id):
        rows = self.db.execute("SELECT * FROM map_keyframes WHERE space_id = ? ORDER BY id", (space_id,)).fetchall()
        return [{"id": r["id"], "kind": r["kind"], "session": r["session"], "device": r["device"], "user": r["created_by"],
                 "quality": r["quality"], "pos": json.loads(r["pos"]) if r["pos"] else None, "mkey": r["mkey"],
                 "bytes": r["bytes"], "at": r["at"]} for r in rows]

    def keyframe_count(self, space_id):
        return self.db.execute("SELECT COUNT(*) FROM map_keyframes WHERE space_id = ?", (space_id,)).fetchone()[0]

    def has_point_set(self, space_id, mkey):
        return self.db.execute("SELECT 1 FROM map_keyframes WHERE space_id = ? AND mkey = ?", (space_id, mkey)).fetchone() is not None

    def delete_keyframes(self, space_id, ids):
        self.db.executemany("DELETE FROM map_keyframes WHERE space_id = ? AND id = ?", [(space_id, i) for i in ids])

    def map_session(self, space_id, session):
        r = self.db.execute("SELECT * FROM map_sessions WHERE space_id = ? AND id = ?", (space_id, session)).fetchone()
        if not r:
            return None
        return {"id": r["id"], "user": r["created_by"], "device": r["device"], "pose": json.loads(r["correction"]) if r["correction"] else None,
                "accepted": r["accepted"], "keyframes": r["keyframes"], "rms": r["rms"]}

    def claim_map_session(self, uid, space_id, session, device):
        """A session belongs to whoever sent its first keyframe. False if someone else's."""
        r = self.db.execute("SELECT created_by FROM map_sessions WHERE space_id = ? AND id = ?", (space_id, session)).fetchone()
        if r:
            return r["created_by"] == uid
        self.db.execute("INSERT INTO map_sessions (space_id, id, created_by, device, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (space_id, session, uid, device, now_ms()))
        return True

    def put_map_sessions(self, space_id, sessions):
        t = now_ms()
        self.db.executemany(
            "UPDATE map_sessions SET correction = ?, accepted = ?, keyframes = ?, rms = ?, updated_at = ? WHERE space_id = ? AND id = ?",
            [(json.dumps(s["pose"]), s["n"], s["kf"], s["rms"], t, space_id, sid) for sid, s in sessions.items()])

    def map_meta(self, space_id):
        r = self.db.execute("SELECT * FROM map_meta WHERE space_id = ?", (space_id,)).fetchone()
        if not r:
            return {"version": 0, "stats": None, "changes": [], "since_rebuild": 0, "rebuilt_at": None}
        return {"version": r["version"], "stats": json.loads(r["stats"]) if r["stats"] else None,
                "changes": json.loads(r["changes"]) if r["changes"] else [], "since_rebuild": r["since_rebuild"],
                "rebuilt_at": r["rebuilt_at"]}

    def put_map_meta(self, space_id, version=None, stats=None, changes=None, added=0, rebuilt=False):
        cur = self.map_meta(space_id)
        ch = (changes + cur["changes"])[:50] if changes else cur["changes"]
        self.db.execute(
            """INSERT INTO map_meta (space_id, version, stats, changes, since_rebuild, rebuilt_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(space_id) DO UPDATE SET version = excluded.version, stats = excluded.stats, changes = excluded.changes,
                 since_rebuild = excluded.since_rebuild, rebuilt_at = excluded.rebuilt_at, updated_at = excluded.updated_at""",
            (space_id, version if version is not None else cur["version"], json.dumps(stats if stats is not None else cur["stats"]),
             json.dumps(ch), 0 if rebuilt else cur["since_rebuild"] + added, now_ms() if rebuilt else cur["rebuilt_at"], now_ms()))

    def clear_map(self, space_id):
        """Everything the map knows about a Space (not its objects or tags)."""
        with self.db:
            self.db.execute("BEGIN")
            for table in ("surfaces", "surface_obs", "map_keyframes", "map_sessions", "map_meta"):
                self.db.execute(f"DELETE FROM {table} WHERE space_id = ?", (space_id,))

    def marker_space(self, uid, family, tag):
        """Which of this user's Spaces already uses this tag, if any."""
        row = self.db.execute(
            """SELECT m.space_id FROM markers m JOIN space_members sm ON sm.space_id = m.space_id
               WHERE sm.user_id = ? AND m.family = ? AND m.tag = ?""",
            (uid, family, tag),
        ).fetchone()
        return row["space_id"] if row else None

    def add_marker(self, uid, space_id, marker):
        with self.db:
            self.db.execute("BEGIN")
            self._insert_marker(uid, space_id, marker, now_ms())

    def _insert_marker(self, uid, space_id, m, t):
        self.db.execute(
            """INSERT INTO markers (space_id, family, tag, size, pose, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (space_id, m["family"], m["tag"], m["size"], json.dumps(m["pose"]), uid, t),
        )

    def add_anchor(self, uid, space_id, anchor, device_id):
        with self.db:
            self.db.execute("BEGIN")
            self._insert_anchor(uid, space_id, anchor, device_id, now_ms())

    def _insert_anchor(self, uid, space_id, anchor, device_id, t):
        self.db.execute(
            "INSERT INTO anchors (id, space_id, pose, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
            (anchor["id"], space_id, json.dumps(anchor["pose"]), uid, t),
        )
        if anchor.get("handle"):
            self.db.execute(
                """INSERT OR REPLACE INTO anchor_bindings (anchor_id, device_id, handle, user_id, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (anchor["id"], device_id, anchor["handle"], uid, t),
            )

    def anchor_space(self, anchor_id):
        row = self.db.execute("SELECT space_id FROM anchors WHERE id=?", (anchor_id,)).fetchone()
        return row["space_id"] if row else None

    def drop_binding(self, anchor_id, device_id):
        self.db.execute("DELETE FROM anchor_bindings WHERE anchor_id=? AND device_id=?", (anchor_id, device_id))

    # ---- objects ---------------------------------------------------------

    @staticmethod
    def _obj(row):
        return {
            "id": row["id"],
            "space": row["space_id"],
            "layer": row["layer_id"],
            "pose": json.loads(row["pose"]),
            "components": json.loads(row["components"]),
            "rev": row["rev"],
            "deleted": bool(row["deleted"]),
        }

    def get_object(self, oid):
        row = self.db.execute("SELECT * FROM objects WHERE id=?", (oid,)).fetchone()
        return self._obj(row) if row else None

    def objects_since(self, uid, space_id, since):
        """Objects in a space newer than `since`, limited to layers the user can view.
        Tombstones are included only for deltas (since > 0)."""
        layer_ids = [layer["id"] for layer in self.visible_layers(uid)]
        if not layer_ids:
            return []
        marks = ",".join("?" * len(layer_ids))
        rows = self.db.execute(
            f"""SELECT * FROM objects
                WHERE space_id = ? AND rev > ? AND layer_id IN ({marks})
                  AND (deleted = 0 OR ? > 0)
                ORDER BY rev""",
            (space_id, since, *layer_ids, since),
        ).fetchall()
        return [self._obj(r) for r in rows]

    def put_object(self, uid, oid, space_id, layer_id, pose, components):
        with self.db:
            self.db.execute("BEGIN")
            rev = self._bump_rev()
            self.db.execute(
                """INSERT INTO objects (id, space_id, layer_id, pose, components, rev, deleted, created_by, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     space_id=excluded.space_id, layer_id=excluded.layer_id, pose=excluded.pose,
                     components=excluded.components, rev=excluded.rev, deleted=0, updated_at=excluded.updated_at""",
                (oid, space_id, layer_id, json.dumps(pose), json.dumps(components), rev, uid, now_ms()),
            )
        return self.get_object(oid)

    # ---- apps ------------------------------------------------------------

    def app_installs(self, uid):
        rows = self.db.execute("SELECT app_id, enabled FROM app_installs WHERE user_id = ?", (uid,)).fetchall()
        return {r["app_id"]: bool(r["enabled"]) for r in rows}

    def app_enabled(self, uid, app_id):
        return self.app_installs(uid).get(app_id, False)

    def set_app_enabled(self, uid, app_id, enabled):
        self.db.execute(
            """INSERT INTO app_installs (user_id, app_id, enabled, updated_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id, app_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at""",
            (uid, app_id, int(enabled), now_ms()),
        )

    def app_layer(self, uid, app_id):
        """The user's private layer for an app's content (instances + objects
        the app persists). Created on first use. Sharing = adding members."""
        row = self.db.execute(
            """SELECT l.id FROM layers l JOIN layer_members m ON m.layer_id = l.id AND m.user_id = ?
               WHERE l.kind = 'app' AND l.app_id = ? AND l.owner_id = ?""",
            (uid, app_id, uid),
        ).fetchone()
        if row:
            return row["id"]
        lid = new_id()
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute(
                "INSERT INTO layers (id, name, owner_id, kind, app_id, created_at) VALUES (?, ?, ?, 'app', ?, ?)",
                (lid, f"{app_id} (private)", uid, app_id, now_ms()),
            )
            self.db.execute("INSERT INTO layer_members (layer_id, user_id, role) VALUES (?, ?, 'admin')", (lid, uid))
        return lid

    def get_app_state(self, uid, app_id, key):
        row = self.db.execute(
            "SELECT v FROM app_state WHERE user_id = ? AND app_id = ? AND k = ?", (uid, app_id, key)
        ).fetchone()
        return json.loads(row["v"]) if row else None

    def put_app_state(self, uid, app_id, key, value):
        self.db.execute(
            """INSERT INTO app_state (user_id, app_id, k, v, updated_at) VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, app_id, k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at""",
            (uid, app_id, key, json.dumps(value), now_ms()),
        )

    # ---- assets ----------------------------------------------------------

    def add_asset(self, uid, a, name):
        t = now_ms()
        with self.db:
            self.db.execute("BEGIN")
            self.db.execute(
                """INSERT OR IGNORE INTO assets (hash, mime, kind, size, width, height, uploaded_by, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (a["hash"], a["mime"], a["kind"], a["size"], a.get("width"), a.get("height"), uid, t),
            )
            self.db.execute(
                "INSERT OR REPLACE INTO user_assets (user_id, hash, name, created_at) VALUES (?, ?, ?, ?)",
                (uid, a["hash"], name, t),
            )
        return self.asset_for(uid, a["hash"])

    def asset_for(self, uid, h):
        row = self.db.execute(
            """SELECT a.*, ua.name FROM assets a LEFT JOIN user_assets ua ON ua.hash = a.hash AND ua.user_id = ?
               WHERE a.hash = ?""",
            (uid, h),
        ).fetchone()
        return self._asset(row) if row else None

    def get_asset(self, h):
        row = self.db.execute("SELECT * FROM assets WHERE hash = ?", (h,)).fetchone()
        return dict(row) if row else None

    def assets_for(self, uid):
        rows = self.db.execute(
            """SELECT a.*, ua.name FROM user_assets ua JOIN assets a ON a.hash = ua.hash
               WHERE ua.user_id = ? ORDER BY ua.created_at DESC""",
            (uid,),
        ).fetchall()
        return [self._asset(r) for r in rows]

    @staticmethod
    def _asset(r):
        return {"hash": r["hash"], "mime": r["mime"], "kind": r["kind"], "size": r["size"],
                "width": r["width"], "height": r["height"], "name": r["name"]}

    def delete_object(self, oid):
        with self.db:
            self.db.execute("BEGIN")
            rev = self._bump_rev()
            self.db.execute(
                "UPDATE objects SET deleted=1, rev=?, updated_at=? WHERE id=?", (rev, now_ms(), oid)
            )
        return self.get_object(oid)
