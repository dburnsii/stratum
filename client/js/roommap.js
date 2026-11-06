// Room map: a Space's real surfaces (walls, floor, tables, counters, couches,
// doors, windows...), stored in the Space frame so every device and every
// member shares one map. DESIGN.md §3.8, §3.10.
//
// What this device sees goes up as *observations*; the server merges every
// source and every user (plus the planes its voxel map finds) into one
// surface set per Space and pushes {"t": "surfaces"}; that merged set is what
// this module draws, raycasts and hands to apps. All of it runs in the
// background (no buttons): while a saved Space is lined up,
//   phone  the reticle's hit poses (y = normal) cluster into growing planes
//   quest  the headset's own room scan (Space Setup planes) is re-sent
//          whenever it changes
//
//   const map = new RoomMap(world, log, device);
//   await map.load(spaceId) · map.setVisible(on) · map.raycast(ray, kinds)
//   phone: map.sample(hitMatrixWorld, floorY) every frame (when map.mapping)
//   Quest: map.autoImport(frame, refSpace, now) every frame
import * as THREE from 'three';
import { api } from './api.js';
import { matrixToPose, poseToMatrix, uuid7 } from './util.js';

const SAMPLE_MS = 80;                 // phone: one sample per this while mapping
const MERGE_ANGLE = Math.cos(THREE.MathUtils.degToRad(12));
const MERGE_DIST = 0.04;              // m off the plane still counts as on it
const REACH = { wall: 3, floor: Infinity, ceiling: Infinity, table: 0.25, counter: 0.4, couch: 0.3, shelf: 0.2 };   // m beyond a surface's edge that still joins it (one floor per height)
const PAD = 0.04;                     // grow outlines a little past the samples
const MIN_SAMPLES = 6;                // before a phone surface is saved
const WALL_HEIGHT = 2.4;
const SAVE_MS = 1200;
const IMPORT_EVERY_MS = 4000;          // Quest: look for room scan changes this often
export const COLORS = { wall: 0x4c8dff, floor: 0x3ddc84, ceiling: 0x9a8cff, table: 0xffa94d, counter: 0xff8f3d, desk: 0xffb86b,
  couch: 0xe599f7, bed: 0xcc5de8, shelf: 0xffd43b, storage: 0xfab005, screen: 0x15aabf, art: 0x63e6be, door: 0xff6b6b,
  window: 0x66d9e8, other: 0xadb5bd };

export class RoomMap {
  constructor(world, log, device = null) {
    this.world = world;
    this.log = log;
    this.device = device;
    this.bySpace = new Map();   // space id -> Map(surface id -> entry {data, local (Matrix4), inv, view}): the merged map
    this.mine = new Map();      // space id -> Map(id -> entry {data, local, inv, rect, samples, dirty}): this phone's sweep observations
    this.visible = false;
    this.mapping = false;       // phone: sample hits in the background
    this.lastSample = 0;
    this.saveTimer = null;
    this.planeIds = new WeakMap();   // Quest: XRPlane -> observation id (stable within a session)
    this.imported = new Map();       // Quest: space id -> signature of the scan last sent
    this.lastImport = 0;
    this.importing = false;
  }

  // ---- load / save -------------------------------------------------------------

  async load(spaceId) {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.temporary) return;
    const { surfaces } = await api.surfaces(spaceId);
    for (const e of this.bySpace.get(spaceId)?.values() ?? []) this.dropView(e);
    this.bySpace.set(spaceId, new Map(surfaces.map((s) => [s.id, this.entry(s)])));
    this.refreshViews();
  }

  async loadAll() {
    await Promise.all([...this.world.spaces.values()].filter((s) => !s.temporary).map((s) => this.load(s.id).catch(() => {})));
  }

  entry(s) {
    const local = poseToMatrix(s.pose);
    return { data: s, local, inv: local.clone().invert(), view: null };
  }

  surfaces(spaceId) { return [...(this.bySpace.get(spaceId)?.values() ?? [])].map((e) => e.data); }

  count(spaceId) {
    const out = {};
    for (const s of this.surfaces(spaceId)) out[s.kind] = (out[s.kind] ?? 0) + 1;
    return out;
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), SAVE_MS);
  }

  async save() {
    for (const [sid, map] of this.mine) {
      for (const e of map.values()) {
        if (!e.dirty || e.samples < MIN_SAMPLES) continue;
        e.dirty = false;
        try {
          await api.putSurface(sid, e.data);
        } catch (err) {
          e.dirty = true;
          this.log(`error: room map save failed: ${err.message}`);
        }
      }
    }
  }

  // Forget this Space's whole map (surfaces, voxels, keyframes) for everyone.
  async clear(spaceId) {
    await api.resetMap(spaceId);
    for (const e of this.bySpace.get(spaceId)?.values() ?? []) this.dropView(e);
    this.bySpace.set(spaceId, new Map());
    this.mine.set(spaceId, new Map());
    this.imported.delete(spaceId);
  }

  // ---- phone: sweep (in the background) ----------------------------------------------

  // hit: the reticle's world matrix (y = normal); floorY: world floor height.
  sample(hit, floorY = 0, now = performance.now()) {
    if (!this.mapping || !hit || now - this.lastSample < SAMPLE_MS) return null;
    this.lastSample = now;
    const pos = new THREE.Vector3().setFromMatrixPosition(hit);
    const nrm = new THREE.Vector3().setFromMatrixColumn(hit, 1).normalize();
    const space = this.world.spaceNear(pos);
    if (!space) return null;
    const kind = classify(nrm, pos.y - floorY);
    if (!kind) return null;
    // To the Space frame.
    const toSpace = space.root.matrix.clone().invert();
    const p = pos.clone().applyMatrix4(toSpace);
    const n = nrm.clone().transformDirection(toSpace);
    const map = this.mine.get(space.id) ?? new Map();
    this.mine.set(space.id, map);
    let best = null, bestD = Infinity;
    for (const e of map.values()) {
      if (e.data.kind !== kind) continue;
      const en = new THREE.Vector3().setFromMatrixColumn(e.local, 1);
      if (en.dot(n) < MERGE_ANGLE) continue;
      const lp = p.clone().applyMatrix4(e.inv);
      if (Math.abs(lp.y) > MERGE_DIST) continue;
      const out = outside(e.rect, lp.x, lp.z);
      if (out < (REACH[kind] ?? 0.3) && out < bestD) { best = e; bestD = out; }
    }
    if (best) {
      const lp = p.clone().applyMatrix4(best.inv);
      grow(best.rect, lp.x, lp.z);
      best.samples++;
      this.setOutline(best);
    } else {
      best = this.newSurface(space, kind, p, n, floorY);
      map.set(best.data.id, best);
    }
    best.dirty = true;
    this.scheduleSave();
    return best.data;
  }

  newSurface(space, kind, p, n, floorY) {
    const y = n.clone().normalize();
    const x = Math.abs(y.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(y).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    const local = new THREE.Matrix4().makeBasis(x, y, z).setPosition(p);
    const e = { data: { id: uuid7(), space: space.id, kind, source: 'phone' }, local, inv: local.clone().invert(), samples: 1, dirty: true,
      rect: [-PAD, PAD, -PAD, PAD] };
    if (kind === 'wall') {
      // Walls run floor to ~ceiling: give the outline that height now.
      const floorInSpace = new THREE.Vector3(0, floorY, 0).applyMatrix4(space.root.matrix.clone().invert()).y;
      const zFloor = new THREE.Vector3(p.x, floorInSpace, p.z).applyMatrix4(e.inv).z;
      const zTop = new THREE.Vector3(p.x, floorInSpace + WALL_HEIGHT, p.z).applyMatrix4(e.inv).z;
      e.rect[2] = Math.min(zFloor, zTop);
      e.rect[3] = Math.max(zFloor, zTop);
    }
    this.setOutline(e);
    return e;
  }

  setOutline(e) {
    const [x0, x1, z0, z1] = e.rect;
    e.data.pose = matrixToPose(e.local);
    e.data.polygon = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([a, b]) => [round(a), round(b)]);
    e.data.weight = Math.min(3, Math.round((e.samples / 10) * 10) / 10 + 0.3);
  }

  // ---- Quest: the headset's room scan, re-sent when it changes ---------------------------

  autoImport(frame, refSpace, now = performance.now()) {
    if (this.importing || now - this.lastImport < IMPORT_EVERY_MS) return;
    const planes = frame?.detectedPlanes;
    if (!planes?.size) return;
    this.lastImport = now;
    this.importing = true;
    this.importPlanes(frame, refSpace, { onlyChanged: true })
      .catch((err) => this.log(`error: room scan import failed: ${err.message}`))
      .finally(() => { this.importing = false; });
  }

  // Returns how many planes were sent (0: no scan, nothing aligned, or unchanged).
  async importPlanes(frame, refSpace, { onlyChanged = false } = {}) {
    const planes = frame?.detectedPlanes;
    if (!planes?.size) return 0;
    const bySpace = new Map();
    for (const plane of planes) {
      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (!pose) continue;
      const world = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const space = this.world.spaceNear(new THREE.Vector3().setFromMatrixPosition(world));
      if (!space) continue;
      if (!this.planeIds.has(plane)) this.planeIds.set(plane, uuid7());
      const local = space.root.matrix.clone().invert().multiply(world);
      const kind = labelKind(plane.semanticLabel, plane.orientation, local);
      const polygon = plane.polygon.map((pt) => [round(pt.x), round(pt.z)]);
      if (polygon.length < 3) continue;
      const list = bySpace.get(space.id) ?? { surfaces: [], changed: 0 };
      list.surfaces.push({ id: this.planeIds.get(plane), kind, pose: matrixToPose(local), polygon: polygon.slice(0, 64), source: 'quest' });
      list.changed = Math.max(list.changed, plane.lastChangedTime ?? 0);
      bySpace.set(space.id, list);
    }
    let n = 0;
    for (const [sid, { surfaces, changed }] of bySpace) {
      // Unchanged scan (same planes, none moved): don't resend. Small drift in
      // where the Space is lined up doesn't count; a re-scan does.
      const sig = `${surfaces.length}:${surfaces.map((s) => s.id).sort().join(',')}:${Math.round(changed)}`;
      if (onlyChanged && this.imported.get(sid) === sig) continue;
      await api.replaceSurfaces(sid, 'quest', surfaces, this.device);
      this.imported.set(sid, sig);
      n += surfaces.length;
    }
    return n;
  }

  // ---- queries -------------------------------------------------------------------------

  // Nearest mapped surface along a world ray: { surface, point, normal } (world).
  raycast(ray, kinds = null, maxDist = 6) {
    let best = null;
    const plane = new THREE.Plane(), hit = new THREE.Vector3(), r = new THREE.Ray(ray.origin, ray.dir);
    for (const [sid, map] of this.bySpace) {
      const space = this.world.spaces.get(sid);
      if (!space?.aligned) continue;
      for (const e of map.values()) {
        if (kinds && !kinds.includes(e.data.kind)) continue;
        const w = space.root.matrix.clone().multiply(e.local);
        const n = new THREE.Vector3().setFromMatrixColumn(w, 1).normalize();
        plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3().setFromMatrixPosition(w));
        if (!r.intersectPlane(plane, hit)) continue;
        const d = hit.distanceTo(ray.origin);
        if (d > maxDist || (best && d >= best.distance)) continue;
        const lp = hit.clone().applyMatrix4(w.clone().invert());
        if (!inPolygon(e.data.polygon, lp.x, lp.z)) continue;
        best = { surface: e.data, point: hit.clone(), normal: n.dot(ray.dir) > 0 ? n.negate() : n, distance: d };
      }
    }
    return best;
  }

  // ---- drawing -----------------------------------------------------------------------

  setVisible(on) {
    this.visible = on;
    this.refreshViews();
  }

  refreshViews() {
    const show = this.visible;
    for (const [sid, map] of this.bySpace) {
      const space = this.world.spaces.get(sid);
      for (const e of map.values()) {
        if (!show || !space) { if (e.view) e.view.visible = false; continue; }
        if (!e.view) e.view = this.makeView(e, space);
        e.view.visible = true;
      }
    }
  }

  makeView(e, space) {
    const shape = new THREE.Shape(e.data.polygon.map(([x, z]) => new THREE.Vector2(x, -z)));
    const color = COLORS[e.data.kind] ?? COLORS.other;
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
    const pts = e.data.polygon.map(([x, z]) => new THREE.Vector3(x, 0.002, z));
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const g = new THREE.Group();
    g.add(fill, edge);
    g.matrixAutoUpdate = false;
    g.matrix.copy(e.local);
    g.userData.surface = e.data.id;
    space.root.add(g);
    return g;
  }

  dropView(e) {
    if (!e.view) return;
    e.view.removeFromParent();
    e.view.traverse((n) => { n.geometry?.dispose(); n.material?.dispose(); });
    e.view = null;
  }
}

// ---- helpers --------------------------------------------------------------------------

const round = (v) => Math.round(v * 1000) / 1000;

// What a hit is, from its normal and height above the floor (same height
// bands as the server's voxel planes, server/mapping/planes.py).
function classify(n, height) {
  if (n.y > 0.85) {
    if (height < 0.12) return 'floor';
    if (height < 0.3) return 'other';
    if (height < 0.62) return 'couch';
    if (height < 0.84) return 'table';
    if (height < 1.05) return 'counter';
    return 'shelf';
  }
  if (n.y < -0.85) return 'ceiling';
  if (Math.abs(n.y) < 0.3) return 'wall';
  return null;   // slanted: skip
}

// Quest Space Setup labels → our kinds.
const LABELS = { wall: 'wall', floor: 'floor', ceiling: 'ceiling', table: 'table', desk: 'desk', couch: 'couch', bed: 'bed',
  shelf: 'shelf', storage: 'storage', screen: 'screen', 'wall art': 'art', door: 'door', 'door frame': 'door',
  window: 'window', 'window frame': 'window', counter: 'counter' };

function labelKind(label, orientation, local) {
  const k = LABELS[(label ?? '').toLowerCase()];
  if (k) return k;
  const up = new THREE.Vector3().setFromMatrixColumn(local, 1);
  if (orientation === 'vertical' || Math.abs(up.y) < 0.3) return 'wall';
  return 'other';
}

function grow(rect, x, z) {
  rect[0] = Math.min(rect[0], x - PAD); rect[1] = Math.max(rect[1], x + PAD);
  rect[2] = Math.min(rect[2], z - PAD); rect[3] = Math.max(rect[3], z + PAD);
}

// How far (m) a point is outside a rect (0 = inside).
function outside([x0, x1, z0, z1], x, z) {
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
