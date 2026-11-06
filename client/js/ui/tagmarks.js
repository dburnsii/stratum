// Seen-tag marks: a quiet sign that a printed tag is being read.
//
// Four thin glowing corner brackets lie on the paper, just outside the
// tag's edge, plus a soft ring that ripples out from the center every
// couple of seconds. Brackets snap in when a tag is first seen (from a
// little larger), breathe very slightly while it's seen, and fade when it's
// lost. Blue: the tag belongs to one of your Spaces. Amber: a new tag (it
// could become a Space). Normal (not additive) blending: tags sit on white
// paper, where a glow would vanish. Poses are smoothed so camera jitter doesn't
// show.
//
//   const marks = new TagMarks(scene);
//   marks.update(tracker, now, dt, (id) => world.spaceForTag(id))   every frame
import * as THREE from 'three';

const SEEN_MS = 700;          // a sighting this recent counts as "in view"
const FADE_IN = 0.12, FADE_OUT = 0.25, FOLLOW = 0.07;   // time constants (s)
const MARGIN = 1.18;          // brackets sit this far out (× half the tag size)
const ARM = 0.32;             // bracket arm length (× half size)
const WIDTH = 0.045;          // bracket line width (× half size)
const RIPPLE_S = 2.4;         // seconds between ripples
const KNOWN = new THREE.Color(0x4f86ff), NEW = new THREE.Color(0xffa928);

const approach = (cur, target, dt, tau) => target + (cur - target) * Math.exp(-dt / tau);

// Corner brackets in the tag plane (XZ, y = normal), unit half-size.
function bracketGeometry() {
  const quads = [];
  const quad = (x0, z0, x1, z1) => quads.push([x0, z0, x1, z1]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * MARGIN, z = sz * MARGIN, w = WIDTH;
    quad(x, z, x - sx * ARM, z + sz * w);   // along x
    quad(x + sx * w, z, x, z - sz * ARM);   // along z
  }
  const pos = [], idx = [];
  for (const [x0, z0, x1, z1] of quads) {
    const i = pos.length / 3;
    pos.push(Math.min(x0, x1), 0, Math.min(z0, z1), Math.max(x0, x1), 0, Math.min(z0, z1), Math.max(x0, x1), 0, Math.max(z0, z1), Math.min(x0, x1), 0, Math.max(z0, z1));
    idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const BRACKETS = bracketGeometry();
const RING = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2);
const glow = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });

export class TagMarks {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.marks = new Map();   // tag id → mark
  }

  update(tracker, now, dt, spaceFor = () => null) {
    if (!tracker) return;
    for (const tag of tracker.tags.values()) {
      const seen = now - tag.lastSeen < SEEN_MS;
      let m = this.marks.get(tag.id);
      if (!m && !seen) continue;
      if (!m) m = this.add(tag);
      m.seen = seen;
      const size = tracker.sizeFor(tag.id) / 2;
      // Follow the latest full pose, smoothed.
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
      tag.raw.decompose(p, q, new THREE.Vector3());
      if (m.fresh) { m.pos.copy(p); m.quat.copy(q); m.fresh = false; }
      const k = 1 - Math.exp(-dt / FOLLOW);
      m.pos.lerp(p, k);
      m.quat.slerp(q, k);
      m.root.position.copy(m.pos);
      m.root.quaternion.copy(m.quat);
      m.root.scale.setScalar(size);
      // Appear / fade, snap in, breathe, ripple.
      m.alpha = approach(m.alpha, seen ? 1 : 0, dt, seen ? FADE_IN : FADE_OUT);
      m.snap = approach(m.snap, 1, dt, 0.09);
      m.t += dt;
      const breathe = 1 + 0.025 * Math.sin(m.t * 2.2);
      m.brackets.scale.setScalar((1 + 0.35 * (1 - m.snap)) * breathe);
      const color = spaceFor(tag.id) ? KNOWN : NEW;
      m.brackets.material.color.lerp(color, 1 - Math.exp(-dt / 0.2));
      m.ring.material.color.copy(m.brackets.material.color);
      m.brackets.material.opacity = 0.9 * m.alpha;
      const r = (m.t % RIPPLE_S) / RIPPLE_S;                   // 0 → 1 per ripple
      m.ring.scale.setScalar(0.25 + 1.25 * Math.sqrt(r));
      m.ring.material.opacity = 0.5 * m.alpha * (1 - r) * Math.min(1, r * 6);
      m.root.visible = m.alpha > 0.01;
      if (!seen && m.alpha < 0.01) this.remove(tag.id);
    }
    for (const id of [...this.marks.keys()]) if (!tracker.tags.has(id)) this.remove(id);
  }

  add(tag) {
    const root = new THREE.Group();
    const lift = new THREE.Group();
    lift.position.y = 0.04;   // a hair off the paper (× half size)
    const brackets = new THREE.Mesh(BRACKETS, glow(NEW));
    const ring = new THREE.Mesh(RING, glow(NEW));
    for (const o of [brackets, ring]) { o.renderOrder = 900; o.frustumCulled = false; }
    lift.add(brackets, ring);
    root.add(lift);
    this.group.add(root);
    const m = { root, brackets, ring, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), alpha: 0, snap: 0, t: Math.random() * RIPPLE_S, fresh: true, seen: true };
    this.marks.set(tag.id, m);
    return m;
  }

  remove(id) {
    const m = this.marks.get(id);
    if (!m) return;
    m.root.removeFromParent();
    m.brackets.material.dispose();
    m.ring.material.dispose();
    this.marks.delete(id);
  }

  dispose() {
    for (const id of [...this.marks.keys()]) this.remove(id);
    this.group.removeFromParent();
  }
}
