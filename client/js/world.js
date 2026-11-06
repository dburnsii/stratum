// Spaces, alignment and objects → Three.js scene graph. DESIGN.md §3, §4.
//
// Each Space has ONE root Group whose matrix is the Space origin in the
// device's current world (T_world←space). Objects are children of their
// Space's root with their Space-frame pose as local transform, so a better
// alignment moves everything in the Space at once.
//
// Alignment sources (§3.4, §3.6):
//   anchors  tracked by the device itself:   T = anchorPose × inv(anchorInSpace)
//   markers  printed tags seen by a camera:  T = tagPose × inv(markerInSpace)
// Anchors win: the device tracks them far more steadily than any tag
// reading. Tag sightings don't move a Space one by one; they're averaged
// into one steady estimate (js/tagfix.js). Once that settles, an anchor is
// dropped at it (saved on the Quest, session-only on phones) and takes over;
// from then on tags only check it, and re-anchor if they firmly disagree.
// The shared map's correction (§3.10) applies on top. Changes are blended,
// not snapped, unless they are large.
import * as THREE from 'three';
import { api } from './api.js';
import { telemetry } from './telemetry.js';
import { buildObject } from './assets.js';
import { poseToMatrix, matrixToPose, uuid7 } from './util.js';
import { TagFix, sightingWeight } from './tagfix.js';

const LOCATE_MAX_MS = 10000;   // anchor restore can take this long before placing is allowed anyway
const LOCATE_GRACE_MS = 6000;  // after restoring: wait this long for saved Spaces to be seen
const PERSISTENT_ANCHOR_LIMIT = 8;   // Quest Browser: per site (DESIGN.md §3.2)
const TAG_FRESH_MS = 2000;           // a tag sighting this recent can align
const SNAP_M = 0.25;                 // corrections bigger than this snap
const EPOCH_M = 0.03, EPOCH_RAD = THREE.MathUtils.degToRad(1);   // a target jump this big starts a new map piece
const GLIDE_M = 0.01, GLIDE_RAD = THREE.MathUtils.degToRad(0.3);   // further from the target than this: still gliding
// Steady mode (a setting, for sitting still): an aligned Space stays put; it
// only moves when tags / anchors disagree with where it is by this much, for
// this long (the headset relocalizing, a bad first estimate), then glides
// there and holds again.
const STEADY_M = 0.3, STEADY_RAD = THREE.MathUtils.degToRad(6), STEADY_MS = 2500;   // about a foot
const BLEND_S = 0.25;                // time constant for small corrections
const LEARN_MIN_SEEN = 8;            // sightings before a new tag joins a Space
const FINDABLE_BONUS_M = 8;          // spaceNear: a tagged Space wins over a headset-only one this much nearer
const REMOTE_SMOOTH_S = 0.08;        // someone else dragging: ease toward their latest pose
const REMOTE_HOLD_MS = 1500;         // their stream stops: hold, then settle on the saved pose
const REANCHOR_M = 0.05;             // settled tags this far from the anchor...
const REANCHOR_DEG = 2;
const REANCHOR_AFTER_MS = 3000;      // ...for this long: the anchor was wrong, make a new one
const CORRECTION_AGREE_M = 0.015;    // map corrections: two in a row this close before one is applied
const CORRECTION_MIN_M = 0.01;       // ...and only if it moves things at least this much
const CORRECTION_MIN_DEG = 0.3;
const IDENTITY = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };

export class World {
  constructor(scene, live, device, log) {
    this.scene = scene;
    this.live = live;
    this.device = device;
    this.log = log;
    this.spaces = new Map();    // id -> Space
    this.objects = new Map();   // id -> { data, built, pending }
    this.tracker = null;        // TagTracker, set by the app on phones
    this.restoring = 0;
    this.learning = new Set();  // tag ids being registered
    this.hiddenLayers = new Set();   // layers turned off (e.g. a disabled app)
    this.hiddenApps = new Set();     // app ids turned off: their instances hide in any layer (shared too)
    this.mutedApps = new Set();      // app ids you hid (Layers): on, but not shown on this device
    // Per-object exceptions on this device (Revelio, DESIGN.md §8.7): shooed
    // away (hidden though its layer shows), revealed (shown though its layer
    // or app is hidden). Cleared for a layer when that layer is toggled.
    this.hiddenObjects = new Set();
    this.revealedObjects = new Set();
    // Turntables (DESIGN.md §8.8): item id → turntable id. Only a turntable's
    // current item is drawn (and its app runs); the rest wait in their slots.
    this.slots = new Map();
  }

  // The turntable holding this object, if any (its entry).
  slotOwner(id) {
    const t = this.slots.get(id);
    return t ? this.objects.get(t) ?? null : null;
  }

  // In a turntable but not its current item: not drawn, its app doesn't run.
  slotHidden(id) {
    const t = this.slotOwner(id);
    return !!t && t.data.components?.turntable?.current !== id;
  }

  // A turntable's object arrived / changed / went: re-index its items and
  // redraw the ones whose visibility changed.
  indexTurntable(id, tt) {
    const touched = new Set();
    for (const [item, owner] of this.slots) if (owner === id) { this.slots.delete(item); touched.add(item); }
    for (const item of tt?.items ?? []) { this.slots.set(item, id); touched.add(item); }
    for (const item of touched) this.refreshShown(item);
  }

  setObjectHidden(id, hidden) {
    if (hidden) { this.hiddenObjects.add(id); this.revealedObjects.delete(id); } else this.hiddenObjects.delete(id);
    this.refreshShown(id);
  }

  setObjectRevealed(id, on) {
    if (on) { this.revealedObjects.add(id); this.hiddenObjects.delete(id); } else this.revealedObjects.delete(id);
    this.refreshShown(id);
  }

  // Bring one hidden thing back on this device, whatever hid it (not a turned-off app).
  revealObject(id) {
    const e = this.objects.get(id);
    this.hiddenObjects.delete(id);
    if (e && !this.shown(e.data)) this.revealedObjects.add(id);
    this.refreshShown(id);
  }

  refreshShown(id) {
    const e = this.objects.get(id);
    if (e?.built) e.built.root.visible = this.shown(e.data);
  }

  // Show/hide every object in a layer (apps toggle their layer).
  setLayerVisible(layer, visible) {
    if (visible) this.hiddenLayers.delete(layer); else this.hiddenLayers.add(layer);
    for (const e of this.objects.values()) if (e.data.layer === layer && e.built) e.built.root.visible = this.shown(e.data);
  }

  setAppVisible(app, visible) {
    if (visible) this.hiddenApps.delete(app); else this.hiddenApps.add(app);
    for (const e of this.objects.values()) if (e.data.components?.app?.app === app && e.built) e.built.root.visible = this.shown(e.data);
  }

  setAppMuted(app, muted) {
    if (muted) this.mutedApps.add(app); else this.mutedApps.delete(app);
    for (const e of this.objects.values()) if (e.data.components?.app?.app === app && e.built) e.built.root.visible = this.shown(e.data);
  }

  shown(o) { return !this.slotHidden(o.id) && this.shownHere(o); }

  // Shown on this device, turntables aside (would it show if it were the current item?).
  shownHere(o) {
    const app = o.components?.app?.app;
    if (this.hiddenApps.has(app) || this.hiddenObjects.has(o.id)) return false;
    if (this.revealedObjects.has(o.id)) return true;
    return !this.hiddenLayers.has(o.layer) && !this.mutedApps.has(app);
  }

  // ---- loading & sync ----------------------------------------------------

  async load() {
    await this.refreshSpaces();
  }

  // (Re)read my Spaces: new ones (e.g. just joined) are added, members and
  // sharing info refresh, ones I left go away.
  async refreshSpaces() {
    const { spaces } = await api.spaces(this.device);
    const ids = new Set(spaces.map((s) => s.id));
    for (const s of spaces) {
      const cur = this.spaces.get(s.id);
      if (!cur) this.addSpace(s);
      else Object.assign(cur, { name: s.name, owner: s.owner, sharedLayer: s.sharedLayer, members: s.members ?? [] });
    }
    for (const [id, s] of [...this.spaces]) {
      if (s.temporary || ids.has(id)) continue;
      for (const [oid, e] of [...this.objects]) if (e.data.space === id) this.detach(oid);
      s.root.removeFromParent();
      this.spaces.delete(id);
    }
    this.live.subscribe(this.serverSpaceIds());
  }

  serverSpaceIds() {
    return [...this.spaces.values()].filter((s) => !s.temporary).map((s) => s.id);
  }

  addSpace(s) {
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.visible = false;   // until aligned
    this.scene.add(root);
    const space = {
      id: s.id, name: s.name, rev: 0, root, aligned: false, alignedBy: null, lastAligned: 0, temporary: !!s.temporary,
      owner: s.owner ?? true, sharedLayer: s.sharedLayer ?? null, members: s.members ?? [],
      anchors: new Map(), markers: new Map(),
      fix: null, seenAt: new Map(), lastTagSeen: -Infinity, correction: null, corrPending: null,
    };
    for (const a of s.anchors ?? []) this.addAnchor(space, a.id, a.pose, a.handle);
    for (const m of s.markers ?? []) this.addMarker(space, m);
    this.spaces.set(s.id, space);
    return space;
  }

  addAnchor(space, id, pose, handle) {
    const inSpace = poseToMatrix(pose);
    const a = { id, space, handle, inSpace, inverse: inSpace.clone().invert(), xr: null, tracked: false };
    space.anchors.set(id, a);
    return a;
  }

  addMarker(space, m) {
    const inSpace = poseToMatrix(m.pose);
    space.markers.set(m.tag, { tag: m.tag, size: m.size, inSpace, inverse: inSpace.clone().invert() });
  }

  // Space (if any) that a tag id belongs to.
  spaceForTag(tag) {
    for (const s of this.spaces.values()) if (s.markers.has(tag)) return s;
    return null;
  }

  // Called on every "subbed" from the server (connect and reconnect).
  async resync(spaceIds = this.serverSpaceIds()) {
    for (const id of spaceIds) {
      const space = this.spaces.get(id);
      if (!space || space.temporary) continue;   // temporary spaces live only on this device
      const { rev, objects } = await api.objects(id, space.rev);
      for (const o of objects) this.apply(o);
      space.rev = Math.max(space.rev, rev);
    }
  }

  // Upsert/delete from the server or locally. Builds are async (assets load),
  // so a newer revision arriving mid-build wins.
  apply(o) {
    const cur = this.objects.get(o.id);
    if (cur && cur.data.rev != null && o.rev != null && cur.data.rev > o.rev) return;
    if (o.deleted) return this.detach(o.id);
    if (o.components?.turntable || cur?.data.components?.turntable) queueMicrotask(() => this.indexTurntable(o.id, this.objects.get(o.id)?.data.components?.turntable));
    if (cur?.built && sameContent(cur.data, o)) {   // pose/rev change only: no rebuild
      cur.data = o;
      if (o.rev != null && Number.isInteger(o.rev)) cur.remote = null;   // a saved pose ends a live drag
      this.attach(cur);
      return;
    }
    const entry = { data: o, built: cur?.built ?? null, token: Symbol('build') };
    this.objects.set(o.id, entry);
    buildObject(o, { now: () => this.live.now() }).then((built) => {
      if (this.objects.get(o.id) !== entry || entry.token === null) return built.dispose();   // superseded
      entry.built?.root.removeFromParent();
      entry.built?.dispose();
      entry.built = built;
      this.attach(entry);
    }).catch((err) => this.log(`error: could not build ${o.id.slice(0, 8)}: ${err.message}`));
  }

  detach(id) {
    const e = this.objects.get(id);
    if (!e) return;
    e.token = null;
    e.built?.root.removeFromParent();
    e.built?.dispose();
    this.objects.delete(id);
    if (e.data.components?.turntable) this.indexTurntable(id, null);   // its items stand on their own again
  }

  attach(entry) {
    const space = this.spaces.get(entry.data.space);
    if (!space || !entry.built) return;
    poseToMatrix(entry.data.pose, entry.built.root.matrix);
    entry.built.root.matrixWorldNeedsUpdate = true;
    entry.built.root.visible = this.shown(entry.data);
    if (entry.built.root.parent !== space.root) space.root.add(entry.built.root);
  }

  // Someone else is dragging this object: follow their live pose (hot, not
  // saved; their PUT on release is the truth).
  remoteMove(id, pose, localDragId) {
    const e = this.objects.get(id);
    if (!e?.built || id === localDragId) return;
    const m = poseToMatrix(pose);
    const target = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
    m.decompose(target.p, target.q, target.s);
    e.remote = { target, at: performance.now() };
  }

  // ---- anchors (Quest) -----------------------------------------------------

  async resolve(session) {
    this.resolveStarted = performance.now();
    this.resolvedAt = 0;
    try { await this.restoreAll(session); } finally { this.resolvedAt = performance.now(); }
  }

  async restoreAll(session) {
    if (!session.restorePersistentAnchor) return;
    await this.pruneHeadsetAnchors(session);
    const known = session.persistentAnchors ? new Set(session.persistentAnchors) : null;
    for (const space of this.spaces.values()) {
      for (const a of space.anchors.values()) {
        if (!a.handle) continue;
        if (known && !known.has(a.handle)) { await this.dropBinding(a); continue; }
        this.restoring++;
        try {
          a.xr = await session.restorePersistentAnchor(a.handle);
        } catch (err) {
          console.warn('restore failed', a.id, err);
          await this.dropBinding(a);
        } finally {
          this.restoring--;
        }
      }
    }
  }

  // The Quest Browser keeps at most PERSISTENT_ANCHOR_LIMIT saved anchors per
  // site, and they outlive the Spaces that made them (deleted Spaces, failed
  // restores). Delete the ones no Space here uses, so new Spaces can save.
  // (Every Stratum account on this headset shares the site's anchors; the
  // ones in use are those bound to this device in Spaces you can see.)
  async pruneHeadsetAnchors(session) {
    const saved = [...(session.persistentAnchors ?? [])];
    const used = new Set([...this.spaces.values()].flatMap((s) => [...s.anchors.values()].map((a) => a.handle).filter(Boolean)));
    const stale = saved.filter((h) => !used.has(h));
    let deleted = 0;
    for (const h of stale) {
      try { await session.deletePersistentAnchor?.(h); deleted++; } catch (err) { console.warn('could not delete anchor', h, err); }
    }
    telemetry.info('headset anchors', { saved: saved.length, inUse: saved.length - stale.length, deleted, limit: PERSISTENT_ANCHOR_LIMIT });
  }

  // AR session over: its anchors are dead (the next session restores them again).
  endSession() {
    this.altSpace = null;
    for (const s of this.spaces.values()) {
      for (const a of [...s.anchors.values()]) {
        if (a.sessionOnly) s.anchors.delete(a.id);
        a.xr = null; a.tracked = false;
      }
      // Belong to one AR session: its world frame, its alignment error.
      s.correction = s.corrPending = null;
      s.fix = null;
      s.seenAt.clear();
      s.anchoring = s.anchorFailed = false;
      s.disagreeSince = 0;
    }
  }

  // The living map (DESIGN.md §3.10) says this session's view of the Space
  // is slightly off: correction maps the Space frame as this device sees it
  // onto the frame everyone's map agrees on. Applied right away (it's small)
  // and to every later alignment. Returns false if it barely changed.
  setCorrection(space, correction) {
    // One reading isn't enough: wait for the next to agree, then apply their average.
    const prev = space.corrPending;
    space.corrPending = correction.clone();
    if (!prev) return false;
    const pa = new THREE.Vector3().setFromMatrixPosition(prev), pb = new THREE.Vector3().setFromMatrixPosition(correction);
    if (pa.distanceTo(pb) > CORRECTION_AGREE_M) return false;
    const qa = new THREE.Quaternion().setFromRotationMatrix(prev), qb = new THREE.Quaternion().setFromRotationMatrix(correction);
    const avg = new THREE.Matrix4().compose(pa.clone().lerp(pb, 0.5), qa.clone().slerp(qb, 0.5), new THREE.Vector3(1, 1, 1));
    const old = space.correction ?? new THREE.Matrix4();
    const d = old.clone().invert().multiply(avg);
    const move = new THREE.Vector3().setFromMatrixPosition(d).length();
    const turn = new THREE.Quaternion().setFromRotationMatrix(d).angleTo(new THREE.Quaternion());
    if (move < CORRECTION_MIN_M && turn < THREE.MathUtils.degToRad(CORRECTION_MIN_DEG)) return false;
    if (move > 0.2) return false;   // not a small fix: ignore
    if (space.aligned) {
      space.root.matrix.multiply(old).multiply(avg.clone().invert());
      space.root.matrixWorldNeedsUpdate = true;
    }
    space.correction = avg;
    this.log(`"${space.name}" lined up to the shared map (${(move * 100).toFixed(1)} cm, ${THREE.MathUtils.radToDeg(turn).toFixed(2)}°)`);
    return true;
  }

  async dropBinding(a) {
    a.handle = null;
    await api.dropBinding(a.id, this.device).catch(() => {});
  }

  // True while saved anchors are still being restored or haven't been seen
  // yet (placing then could create a duplicate Space). Only for a few
  // seconds: a Space in another room is never seen, and must not block
  // placing forever.
  get locating() {
    const now = performance.now();
    if (this.restoring) return now - (this.resolveStarted ?? now) < LOCATE_MAX_MS;
    if (!this.resolvedAt || now - this.resolvedAt > LOCATE_GRACE_MS) return false;
    for (const s of this.spaces.values())
      for (const a of s.anchors.values()) if (a.xr && !a.tracked) return true;
    return false;
  }

  // Anchor status (telemetry, a few seconds into a session).
  anchorReport() {
    const all = [...this.spaces.values()].flatMap((s) => [...s.anchors.values()]);
    return { anchors: all.length, restored: all.filter((a) => a.xr).length, tracked: all.filter((a) => a.tracked).length,
      viaLocalFloor: all.filter((a) => a.viaAlt).length, restoring: this.restoring };
  }

  // ---- alignment -------------------------------------------------------------

  // head: { position (Vector3), turnDegS } of the viewer this frame (weights tag sightings).
  update(frame, refSpace, dt, head = null) {
    const now = performance.now();
    for (const space of this.spaces.values()) {
      const anchored = [];
      for (const a of space.anchors.values()) {
        let m = null;
        try {
          const pose = a.xr && frame && frame.getPose(a.xr.anchorSpace, refSpace);
          if (pose) m = new THREE.Matrix4().fromArray(pose.transform.matrix);
          else if (a.xr && frame && this.altSpace) {
            // Roaming (unbounded space): the browser may only locate anchors
            // relative to local-floor; convert through that space.
            const pa = frame.getPose(a.xr.anchorSpace, this.altSpace), pl = frame.getPose(this.altSpace, refSpace);
            if (pa && pl) { m = new THREE.Matrix4().fromArray(pl.transform.matrix).multiply(new THREE.Matrix4().fromArray(pa.transform.matrix)); a.viaAlt = true; }
          }
        } catch {   // an anchor from an earlier session: never let it stop the frame
          a.xr = null;
        }
        if (!m) continue;
        a.tracked = true;
        anchored.push({ m: m.multiply(a.inverse), by: 'anchor' });
      }
      if (this.tracker) this.sightings(space, head, now);
      let targets = anchored;
      if (anchored.length) {
        if (space.fix?.settled) this.checkAnchor(space, anchored[0].m, frame, refSpace, now);
      } else if (space.fix?.estimate) {
        targets = [{ m: space.fix.estimate.clone(), by: `tags (${space.fix.inliers} sightings)` }];
        if (space.fix.settled && frame) this.anchorSpace(space, frame, refSpace);
      }
      if (targets.length && space.correction) {
        const inv = space.correction.clone().invert();
        for (const t of targets) t.m.multiply(inv);
      }
      if (targets.length) this.align(space, targets, dt, now);
    }
    if (this.tracker) this.learnMarkers(now);
    const k = 1 - Math.exp(-dt / REMOTE_SMOOTH_S);
    for (const e of this.objects.values()) {
      if (e.remote && e.built) {
        if (now - e.remote.at > REMOTE_HOLD_MS) { e.remote = null; this.attach(e); }
        else {
          const root = e.built.root, cur = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
          root.matrix.decompose(cur.p, cur.q, cur.s);
          root.matrix.compose(cur.p.lerp(e.remote.target.p, k), cur.q.slerp(e.remote.target.q, k), cur.s.lerp(e.remote.target.s, k));
          root.matrixWorldNeedsUpdate = true;
        }
      }
      e.built?.update(dt);
    }
  }

  // New tag sightings of this Space's markers → its TagFix.
  sightings(space, head, now) {
    for (const tag of this.tracker.tags.values()) {
      const marker = space.markers.get(tag.id);
      if (!marker || now - tag.lastSeen > TAG_FRESH_MS) continue;
      if (tag.lastSeen <= (space.seenAt.get(tag.id) ?? -Infinity)) continue;   // nothing new
      space.seenAt.set(tag.id, tag.lastSeen);
      let w = 1;
      if (head?.position) {
        const p = new THREE.Vector3().setFromMatrixPosition(tag.pose);
        const n = new THREE.Vector3().setFromMatrixColumn(tag.pose, 1).normalize();   // tag face normal
        const toHead = head.position.clone().sub(p);
        const d = toHead.length();
        // Speed when the photo was taken (Quest camera) beats speed now.
        const turn = tag.motion ? tag.motion.deg : head.turnDegS ?? 0;
        w = sightingWeight(d, Math.abs(n.dot(toHead.divideScalar(d || 1))), turn, tag.motion?.mps ?? 0);
      }
      space.fix ??= new TagFix();
      // Each sighting on its own: the tracker's smoothed pose would let one
      // bad (moving) sighting leak into the next several.
      if (space.fix.add((tag.last ?? tag.pose).clone().multiply(marker.inverse), w, now)) space.lastTagSeen = now;
    }
  }

  // Tags have settled on where this Space is: drop an anchor there so the
  // device itself holds it (saved on the Quest; this session only on phones).
  // Must run inside an XR frame callback.
  anchorSpace(space, frame, refSpace) {
    if (space.temporary || space.anchoring || space.anchorFailed || !frame.createAnchor) return;
    if ([...space.anchors.values()].some((a) => a.xr)) return;
    space.anchoring = true;
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    space.fix.estimate.decompose(p, q, new THREE.Vector3());
    const { spread, inliers } = space.fix;
    this.createAnchor(frame, refSpace, p, q).then(async (xr) => {
      let handle = null;
      const used = frame.session.persistentAnchors?.length ?? 0;
      if (xr.requestPersistentHandle && used < PERSISTENT_ANCHOR_LIMIT) handle = await xr.requestPersistentHandle().catch(() => null);
      const id = uuid7();
      const a = this.addAnchor(space, id, IDENTITY, handle);
      a.xr = xr;
      a.sessionOnly = !handle;
      a.fromTags = true;
      if (handle) await api.addAnchor({ space: space.id, device: this.device, anchor: { id, pose: IDENTITY, handle } });
      space.disagreeSince = 0;
      telemetry.info('space anchored from tags', { space: space.id, saved: !!handle, spreadCm: +(spread * 100).toFixed(2), sightings: inliers });
      this.log(`"${space.name}" anchored where its tags agree (±${(spread * 100).toFixed(1)} cm, ${inliers} sightings${handle ? ', saved' : ''})`);
    }).catch((err) => {
      space.anchorFailed = true;   // keep using the tag estimate
      this.log(`could not anchor "${space.name}": ${err.message}`);
    }).finally(() => { space.anchoring = false; });
  }

  // Anchored, and the tags have settled somewhere else, for a while: the
  // anchor was made from a bad estimate (or the headset's map shifted).
  // Drop this device's anchor; a new one is made where the tags agree.
  checkAnchor(space, anchorM, frame, refSpace, now) {
    const est = space.fix.estimate;
    const d = new THREE.Vector3().setFromMatrixPosition(est).distanceTo(new THREE.Vector3().setFromMatrixPosition(anchorM));
    const qa = new THREE.Quaternion().setFromRotationMatrix(est), qb = new THREE.Quaternion().setFromRotationMatrix(anchorM);
    const turn = THREE.MathUtils.radToDeg(qa.angleTo(qb));
    if (d < REANCHOR_M && turn < REANCHOR_DEG) { space.disagreeSince = 0; return; }
    space.disagreeSince ||= now;
    if (now - space.disagreeSince < REANCHOR_AFTER_MS || space.anchoring) return;
    telemetry.info('space re-anchored', { space: space.id, offCm: +(d * 100).toFixed(1), offDeg: +turn.toFixed(2) });
    this.log(`"${space.name}": its tags say the anchor is ${(d * 100).toFixed(1)} cm off: re-anchoring`);
    for (const a of [...space.anchors.values()]) {
      if (!a.xr) continue;
      try { a.xr.delete?.(); } catch { /* gone already */ }
      if (a.handle) {
        frame.session.deletePersistentAnchor?.(a.handle).catch(() => {});
        this.dropBinding(a);
      }
      space.anchors.delete(a.id);
    }
    space.disagreeSince = 0;
    this.anchorSpace(space, frame, refSpace);
  }

  align(space, targets, dt, now) {
    // Fuse: mean position, circular-mean yaw (all sources are gravity-aligned).
    const pos = new THREE.Vector3(), tmp = new THREE.Vector3();
    let sin = 0, cos = 0;
    for (const t of targets) {
      pos.add(tmp.setFromMatrixPosition(t.m));
      const x = tmp.setFromMatrixColumn(t.m, 0);
      const yaw = Math.atan2(-x.z, x.x);
      sin += Math.sin(yaw);
      cos += Math.cos(yaw);
    }
    pos.divideScalar(targets.length);
    const target = new THREE.Matrix4().makeRotationY(Math.atan2(sin, cos)).setPosition(pos);

    const root = space.root;
    const cur = new THREE.Vector3().setFromMatrixPosition(root.matrix);
    if (this.steady && space.aligned && this.holdStill(space, cur, pos, Math.atan2(sin, cos), now)) return;
    // Where the Space is jumped (a new anchor, tags taking over, a snap): the
    // map treats what came before and after as separate pieces (epoch).
    const last = space.alignTarget;
    if (!last || last.distanceTo(pos) > EPOCH_M || Math.abs(Math.atan2(Math.sin(space.alignYaw - Math.atan2(sin, cos)), Math.cos(space.alignYaw - Math.atan2(sin, cos)))) > EPOCH_RAD) {
      space.alignEpoch = (space.alignEpoch ?? -1) + 1;
    }
    space.alignTarget = pos.clone();
    space.alignYaw = Math.atan2(sin, cos);
    if (!space.aligned || cur.distanceTo(pos) > SNAP_M) {
      root.matrix.copy(target);
      if (!space.aligned) this.log(`aligned "${space.name}" by ${targets.map((t) => t.by).join(' + ')}`);
    } else {
      // Exponential blend: position lerp, rotation slerp.
      const k = 1 - Math.exp(-dt / BLEND_S);
      const q0 = new THREE.Quaternion().setFromRotationMatrix(root.matrix);
      const q1 = new THREE.Quaternion().setFromRotationMatrix(target);
      root.matrix.compose(cur.lerp(pos, k), q0.slerp(q1, k), new THREE.Vector3(1, 1, 1));
    }
    root.matrixWorldNeedsUpdate = true;
    // Still gliding onto the target: depth taken now would land between two places.
    const q = new THREE.Quaternion().setFromRotationMatrix(root.matrix), qt = new THREE.Quaternion().setFromRotationMatrix(target);
    space.gliding = new THREE.Vector3().setFromMatrixPosition(root.matrix).distanceTo(pos) > GLIDE_M || q.angleTo(qt) > GLIDE_RAD;
    root.visible = true;
    space.aligned = true;
    space.alignedBy = targets.map((t) => t.by).join(' + ');
    space.lastAligned = now;
  }

  // Steady mode: true = keep the Space where it is this frame (small
  // corrections ignored); false = it's far off for long enough: move it.
  holdStill(space, cur, pos, yaw, now) {
    const q = new THREE.Quaternion().setFromRotationMatrix(space.root.matrix);
    const curYaw = Math.atan2(-2 * (q.x * q.z - q.w * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
    const off = cur.distanceTo(pos), turn = Math.abs(Math.atan2(Math.sin(yaw - curYaw), Math.cos(yaw - curYaw)));
    if (space.settling) {   // moving to the new place: until it's there
      if (off < GLIDE_M && turn < GLIDE_RAD) space.settling = false;
      return false;
    }
    if (off < STEADY_M && turn < STEADY_RAD) { space.offSince = 0; space.gliding = false; space.lastAligned = now; return true; }
    space.offSince ||= now;
    if (now - space.offSince < STEADY_MS) { space.gliding = false; space.lastAligned = now; return true; }
    space.offSince = 0;
    space.settling = true;
    telemetry.info('steady space moved', { space: space.id, offCm: +(off * 100).toFixed(1), offDeg: +THREE.MathUtils.radToDeg(turn).toFixed(1) });
    this.log(`"${space.name}" was ${(off * 100).toFixed(0)} cm / ${THREE.MathUtils.radToDeg(turn).toFixed(0)}° off: moving it`);
    return false;
  }

  // A tag that isn't in any Space, seen steadily while a Space is aligned by
  // another tag → register it in that Space (so it can align it too).
  learnMarkers(now) {
    for (const tag of this.tracker.tags.values()) {
      if (this.spaceForTag(tag.id) || this.learning.has(tag.id)) continue;
      if (tag.seen < LEARN_MIN_SEEN || now - tag.lastSeen > 500) continue;
      const space = [...this.spaces.values()].find((s) => s.aligned && now - s.lastTagSeen < 500);
      if (!space) continue;
      this.learning.add(tag.id);
      const inSpace = space.root.matrix.clone().invert().multiply(tag.pose);
      const marker = { tag: tag.id, size: this.tracker.sizeFor(tag.id), pose: matrixToPose(inSpace) };
      api.addMarker(space.id, marker).then(() => {
        this.addMarker(space, marker);
        this.log(`tag ${tag.id} added to "${space.name}"`);
      }).catch((err) => this.log(`could not add tag ${tag.id}: ${err.message}`))
        .finally(() => this.learning.delete(tag.id));
    }
  }

  // ---- creating spaces -------------------------------------------------------

  // Phones: a tag nobody has claimed becomes the origin of a new Space.
  async createSpaceAtTag(tag, name) {
    const identity = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    const sid = uuid7();
    const marker = { tag: tag.id, size: this.tracker.sizeFor(tag.id), pose: identity };
    await api.createSpace({ id: sid, name, marker });
    const space = this.addSpace({ id: sid, name, markers: [marker] });
    await this.refreshSpaces();   // picks up its shared layer
    this.log(`created "${name}" at tag ${tag.id}`);
    return space;
  }

  // Quest: an anchor at a surface point becomes the origin of a new Space.
  // Must be called synchronously inside an XR event/frame callback.
  async createSpaceAtAnchor(frame, refSpace, position, quaternion, name) {
    const xr = await this.createAnchor(frame, refSpace, position, quaternion);
    let handle = null;
    const used = frame.session.persistentAnchors?.length ?? 0;
    if (xr.requestPersistentHandle && used < PERSISTENT_ANCHOR_LIMIT) handle = await xr.requestPersistentHandle();
    else this.log('anchor is session-only (no persistence or no free slots)');
    const identity = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    const sid = uuid7(), aid = uuid7();
    await api.createSpace({ id: sid, name, device: this.device, anchor: { id: aid, pose: identity, handle } });
    const space = this.addSpace({ id: sid, name, anchors: [] });
    const a = this.addAnchor(space, aid, identity, handle);
    a.xr = xr;
    space.root.matrix.compose(position, quaternion, new THREE.Vector3(1, 1, 1));
    space.aligned = true;
    space.root.visible = true;
    await this.refreshSpaces();   // picks up its shared layer
    this.log(`created "${name}"`);
    return space;
  }

  // An anchor at a pose in refSpace. While roaming (unbounded space) the
  // Quest Browser may refuse anchors there: then try local-floor (the pose
  // converted into it). Throws if neither works.
  async createAnchor(frame, refSpace, position, quaternion) {
    const at = (p, q) => new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
    try {
      return await frame.createAnchor(at(position, quaternion), refSpace);
    } catch (err) {
      const rel = this.altSpace && frame.getPose(refSpace, this.altSpace);   // refSpace → local-floor
      if (!rel) throw err;
      const m = new THREE.Matrix4().fromArray(rel.transform.matrix).multiply(new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)));
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      m.decompose(p, q, new THREE.Vector3());
      const xr = await frame.createAnchor(at(p, q), this.altSpace);
      telemetry.info('anchor made via local-floor', { first: err.message });
      return xr;
    }
  }

  // ---- temporary space (no tag, no anchor) ------------------------------------
  //
  // Lets placement work before any tag is printed. Its origin is this AR
  // session's own world origin, nothing in it is sent to the server, and it
  // is cleared when the session ends (or the page reloads).

  temporarySpace() {
    for (const s of this.spaces.values()) if (s.temporary) return s;
    const space = this.addSpace({ id: `temp-${uuid7()}`, name: 'Temporary', temporary: true });
    space.aligned = true;
    space.alignedBy = 'session';
    space.root.visible = true;
    this.log('temporary space: items clear when you exit AR');
    return space;
  }

  clearTemporary() {
    for (const s of [...this.spaces.values()]) {
      if (!s.temporary) continue;
      for (const [id, e] of [...this.objects]) if (e.data.space === s.id) this.detach(id);
      s.root.removeFromParent();
      this.spaces.delete(s.id);
    }
  }

  // The aligned Space closest to a world point (content goes there). Real
  // (saved) Spaces win over the temporary one, and one with a tag (phones can
  // find it) wins over a headset-only one unless it's much farther.
  spaceNear(worldPos) {
    let best = null, bestD = Infinity;
    for (const s of this.spaces.values()) {
      if (!s.aligned || s.temporary) continue;
      const d = new THREE.Vector3().setFromMatrixPosition(s.root.matrix).distanceTo(worldPos) - (this.findable(s) ? FINDABLE_BONUS_M : 0);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  isTemporary(spaceId) { return !!this.spaces.get(spaceId)?.temporary; }

  // A space other devices can line up to: it has a printed tag (phones need
  // one; anchors are this headset's own).
  findable(space) { return space.markers.size > 0; }

  // A space only this headset can find (anchors, no tag) that is aligned
  // here at the same time as a tagged one, with things in it: they can move
  // over (same spot in the room), so phones see them too. null if none.
  mergeOffer() {
    const aligned = [...this.spaces.values()].filter((s) => s.aligned && !s.temporary && s.owner);
    const tagged = aligned.filter((s) => this.findable(s));
    if (!tagged.length) return null;
    for (const from of aligned) {
      if (this.findable(from)) continue;
      const things = [...this.objects.values()].filter((e) => e.data.space === from.id).length;
      if (!things) continue;
      const at = new THREE.Vector3().setFromMatrixPosition(from.root.matrix);
      const to = tagged.reduce((a, b) => (new THREE.Vector3().setFromMatrixPosition(a.root.matrix).distanceTo(at)
        <= new THREE.Vector3().setFromMatrixPosition(b.root.matrix).distanceTo(at) ? a : b));
      return { from, to, things };
    }
    return null;
  }

  // Move every object of one Space into another, keeping where it is in the
  // room (both must be aligned here). Returns how many moved.
  async moveAll(fromId, toId) {
    const from = this.spaces.get(fromId), to = this.spaces.get(toId);
    if (!from?.aligned || !to?.aligned || from === to || to.temporary) return 0;
    const into = to.root.matrix.clone().invert().multiply(from.root.matrix);
    let n = 0;
    for (const e of [...this.objects.values()]) {
      if (e.data.space !== fromId) continue;
      // Shared with the old Space → shared with the new one (a Space's shared layer goes with it when it's deleted).
      const layer = e.data.layer === from.sharedLayer ? to.sharedLayer ?? e.data.layer : e.data.layer;
      const o = { ...e.data, space: toId, layer, pose: matrixToPose(into.clone().multiply(poseToMatrix(e.data.pose))) };
      this.apply({ ...o, rev: null });
      try {
        this.apply((await api.putObject(o)).object);
        n++;
      } catch (err) {
        this.apply(e.data);
        this.log(`error: move failed: ${err.message}`);
      }
    }
    return n;
  }

  // ---- editing objects ---------------------------------------------------------

  async place(space, worldMatrix, layer, components) {
    const local = space.root.matrix.clone().invert().multiply(worldMatrix);
    const o = { id: uuid7(), space: space.id, layer, pose: matrixToPose(local), components };
    if (space.temporary) {   // local only: never leaves this device
      const local1 = { ...o, rev: 1 };
      this.apply(local1);
      return local1;
    }
    this.apply(o);   // optimistic; the server echo (with rev) replaces it
    try {
      const { object } = await api.putObject(o);
      this.apply(object);
      return object;
    } catch (err) {
      this.detach(o.id);
      this.log(`error: place failed: ${err.message}`);
      return null;
    }
  }

  // Change an object's pose (scale/rotate/move) and save it.
  async edit(id, fn) {
    const e = this.objects.get(id);
    if (!e) return;
    const m = poseToMatrix(e.data.pose);
    fn(m);
    const o = { ...e.data, pose: matrixToPose(m) };
    if (this.isTemporary(o.space)) return this.apply({ ...o, rev: (o.rev ?? 0) + 1 });
    this.apply({ ...o, rev: null });
    try {
      this.apply((await api.putObject(o)).object);
    } catch (err) {
      this.log(`error: save failed: ${err.message}`);
    }
  }

  // Move an object to another layer (share with the Space / make private).
  async setLayer(id, layer) {
    const e = this.objects.get(id);
    if (!e || e.data.layer === layer || this.isTemporary(e.data.space)) return;
    const o = { ...e.data, layer };
    this.apply({ ...o, rev: null });
    try {
      this.apply((await api.putObject(o)).object);
    } catch (err) {
      this.apply(e.data);
      this.log(`error: sharing failed: ${err.message}`);
    }
  }

  // Replace an object's components (e.g. an app instance saving its config).
  async setComponents(id, components) {
    const e = this.objects.get(id);
    if (!e) return;
    const o = { ...e.data, components };
    if (this.isTemporary(o.space)) return this.apply({ ...o, rev: (o.rev ?? 0) + 1 });
    this.apply({ ...o, rev: null });
    try {
      this.apply((await api.putObject(o)).object);
    } catch (err) {
      this.apply(e.data);
      this.log(`error: save failed: ${err.message}`);
    }
  }

  isShared(id) {
    const e = this.objects.get(id);
    return !!e && e.data.layer === this.spaces.get(e.data.space)?.sharedLayer;
  }

  async remove(id) {
    const e = this.objects.get(id);
    if (!e) return;
    this.detach(id);
    if (this.isTemporary(e.data.space)) return;
    try {
      await api.deleteObject(id);
    } catch (err) {
      this.apply(e.data);
      this.log(`error: delete failed: ${err.message}`);
    }
  }

  pickables() {
    return [...this.objects.values()].filter((e) => e.built?.root.visible && e.built.root.parent?.visible).map((e) => e.built.root);
  }

  objectIdFor(node) {
    while (node && !node.userData.objectId) node = node.parent;
    return node?.userData.objectId ?? null;
  }
}

// Same thing to draw? (A turntable's items / current one aren't part of its
// look: changing them must not rebuild it.)
function sameContent(a, b) {
  const look = (c) => JSON.stringify(c?.turntable ? { ...c, turntable: { radius: c.turntable.radius } } : c);
  return a.space === b.space && a.layer === b.layer && look(a.components) === look(b.components);
}
