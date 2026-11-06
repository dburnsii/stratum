// The move box: a bold frame around an object while it's being picked up
// and moved (DESIGN.md §8.4). Oriented with the object (not a world-axis
// box), drawn over everything so it's never hidden inside what it outlines.
//
//   hold   pinch held on an object (progress 0..1, after the app's delay):
//          a dot appears at each corner and swells (exponentially: slow, then
//          fast), then lines shoot out of every corner and meet halfway
//          along each edge. The box closing is the pickup; letting go
//          before that cancels it.
//   drag   picked up: thick, bright, with corner knobs; pops in
//   two    a second hand joined (rotate / scale): amber
import * as THREE from 'three';

const COLORS = { hold: 0x7fc4ff, drag: 0x3d9bff, two: 0xffb02e };
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const THICK = { hold: 0.0018, drag: 0.004, two: 0.005 };   // m
const KNOB = 0.009;
const DOTS = 0.4;           // of the hold: the corner dots grow; the rest, the edges join
const expo = (p) => (Math.pow(2, 8 * p) - 1) / 255;      // 0..1, slow then fast (the dots)
const easeIn = (p) => p * p * (1.6 - 0.6 * p);          // gentler: the edges reach each other steadily
const POP_S = 0.18;

export class MoveBox {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 999;
    this.mat = new THREE.MeshBasicMaterial({ color: COLORS.drag, transparent: true, depthTest: false, depthWrite: false });
    // Each edge is two halves, one from each corner (they meet in the middle while holding).
    this.edges = [...EDGES, ...EDGES].map(() => new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1, true), this.mat));
    this.knobs = Array.from({ length: 8 }, () => new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), this.mat));
    for (const m of [...this.edges, ...this.knobs]) { m.renderOrder = 999; this.group.add(m); }
    scene.add(this.group);
    this.state = null;
    this.target = null;
    this.local = null;
    this.popAt = 0;
  }

  // Show it on `root` in `state` ('hold' with progress, 'drag', 'two'); null hides.
  show(root, state, progress = 1) {
    if (!root || !state) return this.hide();
    if (root !== this.target) { this.target = root; this.local = localBox(root); }
    if (!this.local) return this.hide();
    if (state !== this.state && state !== 'hold') this.popAt = performance.now();
    this.state = state;
    this.progress = progress;
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
    this.state = null;
    this.target = null;
  }

  // Every frame (after the object moved): follow it.
  update() {
    if (!this.group.visible || !this.target) return;
    const root = this.target, b = this.local;
    root.updateWorldMatrix(true, false);
    const pad = 0.006;
    const c = [];
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      p.applyMatrix4(root.matrixWorld);
      c.push(p);
    }
    const mid = c.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / 8);
    for (const p of c) p.add(p.clone().sub(mid).setLength(pad));   // a little outside the object
    const hold = this.state === 'hold', p = this.progress;
    const dots = hold ? expo(Math.min(1, p / DOTS)) : 1;
    const join = hold ? easeIn(Math.max(0, (p - DOTS) / (1 - DOTS))) : 1;
    const pop = hold ? 1 : 1 + 1.2 * Math.max(0, 1 - (performance.now() - this.popAt) / 1000 / POP_S);
    const thick = hold ? THICK.hold + (THICK.drag - THICK.hold) * join * 0.6 : THICK[this.state] * pop;
    this.mat.color.setHex(COLORS[this.state]);
    this.mat.opacity = hold ? 0.45 + 0.5 * join : 0.95;
    const up = new THREE.Vector3(0, 1, 0);
    EDGES.forEach(([a, b], i) => {
      const d = c[b].clone().sub(c[a]), len = d.length(), dir = d.clone().normalize();
      for (const [m, from, sign] of [[this.edges[i], c[a], 1], [this.edges[i + 12], c[b], -1]]) {
        const l = (len / 2) * join;
        m.visible = l > 1e-4;
        m.position.copy(from).addScaledVector(dir, sign * l / 2);
        m.quaternion.setFromUnitVectors(up, dir);
        m.scale.set(thick, l, thick);
      }
    });
    const knob = hold ? 0.007 * Math.max(0.03, dots) * (1 - 0.35 * join) : KNOB * 0.5 * pop;   // dots swell, then settle as the edges join
    this.knobs.forEach((m, i) => { m.position.copy(c[i]); m.scale.setScalar(knob); });
  }
}

// The object's bounding box in its own frame (so the frame turns with it).
function localBox(root) {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert(), box = new THREE.Box3(), tmp = new THREE.Box3();
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    let bb;
    if (o.isInstancedMesh) { o.computeBoundingBox(); bb = o.boundingBox; } else { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); bb = o.geometry.boundingBox; }
    if (!bb || bb.isEmpty()) return;
    tmp.copy(bb).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if ([tmp.min.x, tmp.max.x].every(Number.isFinite)) box.union(tmp);
  });
  return box.isEmpty() ? null : box;
}
