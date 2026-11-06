// Revelio: see what you've hidden on this device, bring one thing back, or
// shoo a visible thing away (DESIGN.md §8.7).
//
//   cast     open hand, palm facing away from you, slid sideways at an easy
//            pace (right hand to the right, left hand to the left), like
//            wiping a window. A band rings out from you; each hidden thing it
//            passes flashes, then glows faintly for a while (its frozen shape).
//   select   aim at a glow (the cursor sits on it) and bring the fingertips
//            together (or pinch): it glows brighter.
//   reveal   spread the fingers: that one thing shows again (an exception on
//            this device; its layer stays hidden).
//   shoo     all fingertips together on a visible thing, then open the hand
//            while turning it (right hand clockwise / left counter-clockwise):
//            hide that thing on this device.
//
//   const gestures = new HandGestures();   gestures.update(side, joints, head, now) → [{ type, side, … }]
//   const rev = new Revelio(scene);        rev.cast(origin, [{ id, root, box }], now)
//   each frame: rev.update(now, rays)      rays: [{ side, origin, dir }]
//   rev.pick(ray) → { id, point, distance } | null
import * as THREE from 'three';

// ---- hand shapes and gestures ------------------------------------------------------------------

// The cast (user, 2026-10-25): a slide, not a turn. Earlier turn casts were
// too eager (55°), then too hard (80°).
const SLIDE_M = 0.15;           // slide this far sideways…
const SLIDE_WINDOW_MS = 900;    // …within this long (so ≥ ~0.17 m/s: not a drift)
const SLIDE_MIN_MS = 150;       // and not in a flash
const SLIDE_MAX_SPEED = 1.6;    // m/s at any moment: faster is a swat, not a slide
const SLIDE_STRAIGHT = 0.7;     // up / down + toward / away ≤ this × the sideways part
const PALM_AWAY = 0.35;         // palm normal · (head → hand): facing away from you
const VIEW_DEG = 45;            // the hand within this of where you're looking
const CAST_MAX_DEG = 150;       // (shoo) more than this in one go is tracking flipping the hand
const SHOO_DEG = 55;            // from gathering to open: turned at least this far
const SHOO_HOLD_MS = 300;       // fingertips held together at least this long first
const AFTER_GATHER_MS = 900;    // a gather opening into spread / shoo within this long
const CAST_COOLDOWN_MS = 2500;
const NEAR_M = 0.08;            // slid this far but not a cast: logged (for tuning)
export const BUNCH_IN = 0.035, BUNCH_OUT = 0.05;   // all five fingertips within this of their middle (m); out: let go (user-tuned 2026-10-28, was 2.2 / 4)
const PINCH_IN = 0.018, PINCH_OUT = 0.03;   // thumb–index tips (m)
const OPEN_STRAIGHT = 0.75;     // each finger's straightness (1 = straight)
const OPEN_THUMB = 0.05;        // thumb tip this far from the index tip (m)
const MIN_REACH = 0.25;         // hand this far from the head (held out, not at your side or face)
const TIPS = [4, 9, 14, 19, 24];

// The hand's shape from its 25 joints (world, meters) and where the head is.
export function handShape(j, head, side = 'right') {
  const straight = [0, 1, 2, 3].map((f) => {
    const b = 5 + f * 5;
    const a = new THREE.Vector3().subVectors(j[b + 1], j[b]).normalize();
    const t = new THREE.Vector3().subVectors(j[b + 4], j[b + 1]).normalize();
    return a.dot(t);
  });
  const mid = TIPS.reduce((s, i) => s.add(j[i]), new THREE.Vector3()).multiplyScalar(1 / 5);
  const bunch = Math.max(...TIPS.map((i) => j[i].distanceTo(mid)));
  const pinch = j[4].distanceTo(j[9]);
  const center = j[0].clone().add(j[10]).multiplyScalar(0.5);
  // Roll: the knuckle line's angle around the line from your eyes to the
  // hand (+ = clockwise as you see it), so it works pointing ahead (a
  // twist) or held up like "stop" (a dial).
  const v = center.clone().sub(head);
  const reach = v.length();
  v.normalize();
  const up = Math.abs(v.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  up.addScaledVector(v, -up.dot(v)).normalize();
  const a = new THREE.Vector3().subVectors(j[5], j[20]);
  a.addScaledVector(v, -a.dot(v));
  const roll = Math.atan2(v.dot(new THREE.Vector3().crossVectors(up, a)), up.dot(a));
  const open = straight.every((s) => s > OPEN_STRAIGHT) && pinch > OPEN_THUMB;
  // Palm normal (out of the palm; the hands mirror), and how much it faces away from you.
  const along = new THREE.Vector3().subVectors(j[10], j[0]).normalize();
  const normal = new THREE.Vector3().crossVectors(along, new THREE.Vector3().subVectors(j[5], j[20])).normalize();
  if (side === 'right') normal.negate();
  const away = normal.dot(v);
  return { open, straight, bunch, pinch, center, reach, roll, mid, normal, away };
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const DEG = Math.PI / 180;

export class HandGestures {
  constructor() {
    this.s = {};
  }

  // One hand's joints this frame (or null: not tracked). Returns events:
  //   { type: 'cast', side, cm, ms }      { type: 'gather', side, kind: 'bunch' | 'pinch' }
  //   { type: 'spread', side }  { type: 'shoo', side, deg }  { type: 'release', side }
  //   { type: 'near', side, cm, why }  (a slide that fell short, for tuning)
  // gaze: unit vector where the head looks (world); without it the view check is skipped.
  update(side, joints, head, now, gaze = null) {
    const st = (this.s[side] ??= { phi: 0, roll: null, hist: [], gather: null, after: null, coolUntil: 0, best: 0 });
    const out = [];
    if (!joints || !head) {
      if (st.gather || st.after) out.push({ type: 'release', side });
      Object.assign(st, { roll: null, hist: [], gather: null, after: null, best: 0 });
      return out;
    }
    const h = handShape(joints, head, side);
    st.phi += st.roll == null ? 0 : wrap(h.roll - st.roll);   // unwrapped turn
    st.roll = h.roll;
    st.shape = h;
    const dir = side === 'left' ? -1 : 1;
    const view = gaze ? Math.acos(THREE.MathUtils.clamp(h.center.clone().sub(head).normalize().dot(gaze), -1, 1)) / DEG : 0;
    const inView = view < VIEW_DEG;

    // Gather (all fingertips together, or a pinch) → spread / shoo / release.
    if (st.gather) {
      if (st.gather.kind === 'pinch' && h.bunch < BUNCH_IN) {   // the pinch closed into all five: now it can shoo
        Object.assign(st.gather, { kind: 'bunch', t: now, phi0: st.phi, inView });
        out.push({ type: 'gather', side, kind: 'bunch' });
      }
      const still = st.gather.kind === 'bunch' ? h.bunch < BUNCH_OUT : h.pinch < PINCH_OUT;
      if (!still) {
        const g = st.gather;
        st.after = { phi0: g.phi0, t: now, kind: g.kind, spread: false, canShoo: g.kind === 'bunch' && g.inView && now - g.t >= SHOO_HOLD_MS };
        st.gather = null;
        st.coolUntil = Math.max(st.coolUntil, now + 1000);
      }
    } else if (h.bunch < BUNCH_IN || h.pinch < PINCH_IN) {
      const kind = h.bunch < BUNCH_IN ? 'bunch' : 'pinch';
      if (st.after) out.push({ type: 'release', side });
      st.gather = { kind, phi0: st.phi, t: now, inView };
      st.after = null;
      out.push({ type: 'gather', side, kind });
    }
    if (st.after) {
      const turned = (st.phi - st.after.phi0) * dir / DEG;
      if (h.open && !st.after.spread) { st.after.spread = true; out.push({ type: 'spread', side }); }
      if (h.open && st.after.canShoo && turned >= SHOO_DEG && turned <= CAST_MAX_DEG) {
        out.push({ type: 'shoo', side, deg: Math.round(turned) });
        st.after = null;
        st.coolUntil = now + CAST_COOLDOWN_MS;
      } else if (now - st.after.t > AFTER_GATHER_MS) {
        out.push({ type: 'release', side });
        st.after = null;
      }
    }

    // Cast: open, palm away, in view, then a steady slide sideways.
    const ready = h.open && h.away >= PALM_AWAY && h.reach >= MIN_REACH && inView && !st.gather && gaze;
    if (!ready) {
      if (st.best >= NEAR_M) out.push({ type: 'near', side, cm: Math.round(st.best * 100), why: !h.open ? 'not open' : h.away < PALM_AWAY ? 'palm not away' : !inView ? 'not in view' : 'other' });
      Object.assign(st, { hist: [], best: 0 });
      return out;
    }
    const right = new THREE.Vector3().crossVectors(gaze, new THREE.Vector3(0, 1, 0)).normalize();
    const prev = st.hist.at(-1);
    st.hist.push({ t: now, p: h.center.clone() });
    while (st.hist.length && now - st.hist[0].t > SLIDE_WINDOW_MS) st.hist.shift();
    if (prev && now > prev.t && h.center.distanceTo(prev.p) / ((now - prev.t) / 1000) > SLIDE_MAX_SPEED) {   // a swat
      st.hist = [{ t: now, p: h.center.clone() }];
      return out;
    }
    let slid = 0, ok = null;
    for (const q of st.hist) {
      const d = h.center.clone().sub(q.p), side_ = d.dot(right) * dir, off = d.clone().addScaledVector(right, -d.dot(right)).length();
      if (side_ > slid && off <= SLIDE_STRAIGHT * Math.max(side_, 0.01)) slid = side_;
      if (side_ >= SLIDE_M && off <= SLIDE_STRAIGHT * side_ && now - q.t >= SLIDE_MIN_MS) { ok = { cm: Math.round(side_ * 100), ms: Math.round(now - q.t) }; break; }
    }
    if (ok && now >= st.coolUntil) {
      out.push({ type: 'cast', side, cm: ok.cm, ms: ok.ms, view: Math.round(view), away: +h.away.toFixed(2), reach: Math.round(h.reach * 100) });
      st.coolUntil = now + CAST_COOLDOWN_MS;
      Object.assign(st, { hist: [], best: 0 });
    } else if (slid >= NEAR_M) st.best = Math.max(st.best, slid);
    else if (st.best >= NEAR_M && slid < 0.02) { out.push({ type: 'near', side, cm: Math.round(st.best * 100), why: 'short' }); st.best = 0; }   // slid partway, then stopped
    return out;
  }
}

// ---- the band, glows, cursor ------------------------------------------------------------------

const COLOR = 0xb197fc, BRIGHT = 0xe5dbff, SHOO = 0xffc078;
const BAND_SPEED = 3.5;          // m/s
const BAND_MAX = 7;              // m
const BAND_H = 0.22;
const GLOW_MS = 6000;            // each glow stays this long after the cast (time to find and pick one)…
const FADE_MS = 1500;            // …then fades away
const HOLD_MS = 3000;            // aiming at / picking one keeps that one (only) this long more…
const MAX_MS = 20000;            // …but never past this after the cast
const FLASH_MS = 700;
const MIN_PICK = 0.06;           // m: small things are easier to aim at
const PICK_MARGIN = 0.015;       // m around each glow that still counts as on it

export class Revelio {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.items = new Map();      // id → { id, root, box, mesh, fill, edges, flashAt, dist }
    this.until = 0;
    this.selected = null;        // { id, side }
    this.hover = {};             // side → id
    this.fx = [];
    // Band: an open cylinder, bright in the middle of its height.
    const c = Object.assign(document.createElement('canvas'), { width: 4, height: 64 });
    const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
    this.band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
      new THREE.MeshBasicMaterial({ color: COLOR, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.band.renderOrder = -1;  // under solid virtual things, over the room
    this.band.visible = false;
    this.band.frustumCulled = false;
    scene.add(this.band);
    this.cursor = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: BRIGHT, depthTest: false, depthWrite: false, transparent: true }));
    this.cursor.renderOrder = 996;
    this.cursor.visible = false;
    scene.add(this.cursor);
    this.unitEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
  }

  get active() { return performance.now() < this.until; }

  // items: [{ id, root, box (Box3 in root's frame), ghost? (ghostOf: its
  // shapes, frozen) }]; origin: the head (world). With a ghost the glow is the
  // thing's own silhouette, one flat color; without, a box.
  cast(origin, items, now = performance.now()) {
    this.clear();
    this.origin = origin.clone();
    this.castAt = now;
    this.until = now + GLOW_MS + FADE_MS;
    this.endBy = now + MAX_MS;
    this.band.visible = true;
    for (const it of items) {
      const p = it.ghost ? this.ghostMarker(it.ghost, it.box) : this.marker(it.box, COLOR);
      p.mesh.visible = false;
      this.group.add(p.mesh);
      it.root.updateWorldMatrix(true, false);
      const at = it.box.getCenter(new THREE.Vector3()).applyMatrix4(it.root.matrixWorld);
      this.items.set(it.id, { ...it, ...p, flashAt: null, until: this.until, dist: Math.hypot(at.x - origin.x, at.z - origin.z) });
    }
  }

  // A box outline + faint fill sized to `box` (a unit box, scaled).
  marker(box, color) {
    const fill = new THREE.Mesh(this.unitBox, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    const edges = new THREE.LineSegments(this.unitEdges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    fill.renderOrder = 990; edges.renderOrder = 991;
    fill.raycast = edges.raycast = () => {};
    const mesh = new THREE.Group();
    mesh.add(fill, edges);
    mesh.matrixAutoUpdate = false;
    mesh.userData.size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
    mesh.userData.center = box.getCenter(new THREE.Vector3());
    return { mesh, fill, edges };
  }

  // The thing's own shapes (ghostOf), in one color: shaded so the shape
  // reads, drawn over everything but only its nearest surface (a depth
  // pre-pass, like the hands), so it isn't a muddle of inside faces.
  ghostMarker(ghost, box) {
    const fillMat = new THREE.MeshLambertMaterial({ color: COLOR, emissive: COLOR, emissiveIntensity: 0.4, transparent: true, opacity: 0, depthWrite: false, depthFunc: THREE.LessEqualDepth });
    const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthFunc: THREE.AlwaysDepth });
    const mesh = new THREE.Group();
    mesh.matrixAutoUpdate = false;
    for (const part of ghost.children) {
      for (const [mat, order] of [[depthMat, 988], [fillMat, 990]]) {
        const m = part.isInstancedMesh ? new THREE.InstancedMesh(part.geometry, mat, part.count) : new THREE.Mesh(part.geometry, mat);
        if (part.isInstancedMesh) m.instanceMatrix.copy(part.instanceMatrix);
        m.matrixAutoUpdate = false;
        m.matrix.copy(part.matrix);
        m.renderOrder = order;
        m.frustumCulled = false;
        m.raycast = () => {};
        mesh.add(m);
      }
    }
    mesh.userData.ghost = true;
    mesh.userData.size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.01, 0.01, 0.01));
    mesh.userData.center = box.getCenter(new THREE.Vector3());
    return { mesh, fill: { material: fillMat }, edges: { material: depthMat } };
  }

  // The marker's matrix: a box is a scaled unit box; a ghost sits in the
  // thing's own frame (grown about its middle).
  placeMarker(mesh, root, grow = 1) {
    root.updateWorldMatrix(true, false);
    const c = mesh.userData.center;
    if (mesh.userData.ghost) {
      mesh.matrix.copy(root.matrixWorld);
      if (grow !== 1) mesh.matrix.multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z)).multiply(new THREE.Matrix4().makeScale(grow, grow, grow)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    } else mesh.matrix.copy(root.matrixWorld).multiply(new THREE.Matrix4().compose(c, new THREE.Quaternion(), mesh.userData.size.clone().multiplyScalar(grow)));
    mesh.matrixWorldNeedsUpdate = true;
  }

  // How bright a marker is (0..1; selected = the bright color).
  setLevel(m, level, sel = false) {
    if (m.mesh.userData.ghost) {
      m.fill.material.opacity = Math.min(0.85, 0.15 + 0.6 * level);
      m.fill.material.emissive.setHex(sel ? BRIGHT : COLOR);
      m.fill.material.emissiveIntensity = 0.25 + 0.75 * level;
    } else {
      m.edges.material.color.setHex(sel ? BRIGHT : COLOR);
      m.edges.material.opacity = level;
      m.fill.material.opacity = 0.18 * level;
    }
  }

  // Ghosts share the thing's geometry: only their materials are theirs to free.
  dropMarker(m) { m.mesh.removeFromParent(); m.fill.material.dispose(); m.edges.material.dispose(); }

  clear() {
    for (const it of this.items.values()) this.dropMarker(it);
    this.items.clear();
    this.selected = null;
    this.hover = {};
    this.until = 0;
    this.band.visible = false;
    this.cursor.visible = false;
  }

  select(id, side) { this.selected = id ? { id, side } : null; if (id) this.keepAlive(id); }
  // Aimed at / picked: that glow stays a little longer (the others go on time).
  keepAlive(id, now = performance.now()) {
    const it = this.items.get(id);
    if (!it || now >= it.until) return;
    it.until = Math.min(this.endBy, Math.max(it.until, now + HOLD_MS + FADE_MS));
    this.until = Math.max(this.until, it.until);
  }

  // The nearest glow along a ray (world) that the band has reached.
  pick(ray, now = performance.now()) {
    if (now >= this.until) return null;
    let best = null;
    const inv = new THREE.Matrix4(), hit = new THREE.Vector3();
    const unit = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
    for (const it of this.items.values()) {
      if (it.flashAt == null || now >= it.until) continue;   // not reached yet / gone
      it.root.updateWorldMatrix(true, false);
      // Into the bounding box's unit frame, a little bigger than the thing
      // (PICK_MARGIN each side, at least MIN_PICK across): easy to aim at.
      const size = it.mesh.userData.size, grow = (v) => Math.max(v + 2 * PICK_MARGIN, MIN_PICK) / v;
      const m = it.root.matrixWorld.clone().multiply(new THREE.Matrix4().compose(it.mesh.userData.center, new THREE.Quaternion(), new THREE.Vector3(size.x * grow(size.x), size.y * grow(size.y), size.z * grow(size.z))));
      inv.copy(m).invert();
      const o = ray.origin.clone().applyMatrix4(inv);
      const d = ray.origin.clone().add(ray.dir).applyMatrix4(inv).sub(o).normalize();
      if (!new THREE.Ray(o, d).intersectBox(unit, hit)) continue;
      const point = hit.clone().applyMatrix4(m);
      const distance = point.distanceTo(ray.origin);
      if (!best || distance < best.distance) best = { id: it.id, point, distance };
    }
    return best;
  }

  // The thing that was shown again: a bright flash outward, then gone.
  revealed(id, now = performance.now()) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    if (this.selected?.id === id) this.selected = null;
    this.fx.push({ ...it, t0: now, ms: 450, kind: 'reveal' });
    for (const o of this.items.values()) o.until = Math.min(o.until, now + FADE_MS);   // found it: the rest fade now
  }

  // Shoo: an outline on what you're about to hide (null clears), then a puff.
  arm(root, box) {
    this.disarm();
    if (!root || !box) return;
    const p = this.marker(box, SHOO);
    p.edges.material.opacity = 0.7;
    p.fill.material.opacity = 0.05;
    this.armed = { ...p, root };
    this.scene.add(p.mesh);
    this.placeMarker(p.mesh, root);
  }

  disarm() { if (this.armed) { this.dropMarker(this.armed); this.armed = null; } }

  poof(root, box) {
    const p = this.marker(box, SHOO);
    this.scene.add(p.mesh);
    root.updateWorldMatrix(true, false);
    this.fx.push({ ...p, root, t0: performance.now(), ms: 450, kind: 'poof', matrix: root.matrixWorld.clone() });
  }

  update(now = performance.now(), rays = []) {
    // Effects run whether or not a cast is on.
    this.fx = this.fx.filter((f) => {
      const k = Math.min(1, (now - f.t0) / f.ms);
      if (f.kind === 'reveal') {
        f.mesh.visible = true;
        this.placeMarker(f.mesh, f.root, 1 + 0.25 * k);
        if (f.mesh.userData.ghost) { f.fill.material.opacity = 0.85 * (1 - k); f.fill.material.emissive.setHex(BRIGHT); }
        else { f.fill.material.opacity = 0.35 * (1 - k); f.edges.material.opacity = 1 - k; }
      } else {
        const s = f.mesh.userData.size.clone().multiplyScalar(1 - 0.85 * k);
        f.mesh.matrix.copy(f.matrix).multiply(new THREE.Matrix4().compose(f.mesh.userData.center, new THREE.Quaternion(), s));
        f.mesh.matrixWorldNeedsUpdate = true;
        f.fill.material.opacity = 0.25 * (1 - k);
        f.edges.material.opacity = 0.9 * (1 - k);
      }
      if (k >= 1) this.dropMarker(f);
      return k < 1;
    });
    if (this.armed) this.placeMarker(this.armed.mesh, this.armed.root);
    if (!this.band.visible && !this.items.size) { this.cursor.visible = false; return; }
    if (now >= this.until) { this.clear(); return; }
    const t = (now - this.castAt) / 1000, r = Math.min(BAND_MAX, BAND_SPEED * t);
    // The band: rings out from you at chest height, fading as it goes.
    this.band.visible = r < BAND_MAX;
    this.band.position.set(this.origin.x, this.origin.y - 0.35, this.origin.z);
    this.band.scale.set(Math.max(0.05, r), BAND_H, Math.max(0.05, r));
    this.band.material.opacity = 0.55 * (1 - r / BAND_MAX);
    for (const it of this.items.values()) if (it.flashAt == null && r >= it.dist) it.flashAt = now;
    // Hover: what each ray points at; the cursor on the nearest one.
    this.hover = {};
    let cursor = null;
    for (const ray of rays) {
      const p = this.pick(ray, now);
      if (!p) continue;
      this.hover[ray.side] = p.id;
      if (!cursor || p.distance < cursor.distance) cursor = p;
    }
    if (cursor) this.keepAlive(cursor.id, now);
    this.cursor.visible = !!cursor;
    if (cursor) this.cursor.position.copy(cursor.point);
    const hovered = new Set(Object.values(this.hover));
    let last = 0;
    for (const it of this.items.values()) {
      last = Math.max(last, it.until);
      if (it.flashAt == null || now >= it.until) {   // not reached yet, or its time is up
        it.mesh.visible = false;
        if (this.selected?.id === it.id) this.selected = null;
        continue;
      }
      const fade = Math.min(1, (it.until - now) / FADE_MS);
      it.mesh.visible = true;
      this.placeMarker(it.mesh, it.root);
      const flash = Math.max(0, 1 - (now - it.flashAt) / FLASH_MS);
      const sel = this.selected?.id === it.id, hov = hovered.has(it.id);
      const pulse = sel ? 0.85 + 0.15 * Math.sin(now / 90) : 1;
      const level = Math.max(flash, sel ? 1 : hov ? 0.7 : 0.4) * pulse * fade;
      this.setLevel(it, level, sel);
    }
    this.until = last;   // the last glow going ends the cast
  }
}

// A frozen copy of what an object draws, for its glow: its meshes (and
// instanced meshes) with their geometry shared, not copied, placed in
// `frame`'s coordinates (default: the object itself). No materials (Revelio
// gives them one color). null if it draws nothing or is too heavy (more than
// maxTris triangles: the box is used instead). Parts marked
// userData.noReveal are left out.
// Does a material actually show anything? (Apps keep invisible helpers:
// grab spheres, hit planes, shadow catchers, depth-only masks.)
const draws = (m) => [].concat(m ?? []).some((x) => x && x.visible !== false && x.colorWrite !== false && !x.isShadowMaterial && !(x.transparent && x.opacity < 0.02));

export function ghostOf(source, frame = source, maxTris = 150000) {
  source.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const inv = frame.matrixWorld.clone().invert(), parts = [];
  let tris = 0;
  const visit = (o) => {
    if ((o !== source && !o.visible) || o.userData?.noReveal) return;
    if (o.isMesh && o.geometry?.attributes?.position && draws(o.material)) {
      const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
      parts.push(o);
    }
    for (const c of o.children) visit(c);
  };
  visit(source);
  if (!parts.length || tris > maxTris) return null;
  const ghost = new THREE.Group();
  for (const o of parts) {
    const m = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, undefined, o.count) : new THREE.Mesh(o.geometry);
    if (o.isInstancedMesh) m.instanceMatrix.copy(o.instanceMatrix);
    m.matrixAutoUpdate = false;
    m.matrix.multiplyMatrices(inv, o.matrixWorld);
    ghost.add(m);
  }
  ghost.userData.tris = tris;
  return ghost;
}

// An object's bounding box in its own frame, from what it draws (even while
// hidden: its own visibility is ignored, its parts' isn't). null if empty.
export function boundsOf(root) {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert(), box = new THREE.Box3(), tmp = new THREE.Box3();
  const visit = (o) => {
    if (o !== root && !o.visible) return;
    if ((o.isMesh || o.isLine || o.isPoints) && o.geometry) {
      let bb;
      if (o.isInstancedMesh) { o.computeBoundingBox(); bb = o.boundingBox; } else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
      if (bb && !bb.isEmpty()) {
        tmp.copy(bb).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if ([tmp.min.x, tmp.max.x, tmp.min.y, tmp.max.y].every(Number.isFinite)) box.union(tmp);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return box.isEmpty() ? null : box;
}
