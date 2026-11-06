// Where a Space is, from many noisy tag sightings (DESIGN.md §3.6).
//
// Within one AR session the device's own tracking is far steadier than any
// single tag reading (a few cm of jitter, the odd flipped pose), so the
// Space doesn't chase sightings: each one is a measurement of one fixed
// thing, the Space origin in this session's world. Keep a window of them,
// weight each by how trustworthy it is (near, seen face-on, head still),
// drop outliers around the weighted median, average the rest. "Settled" once
// the average is sure to a few mm (individual readings scatter more; the
// average of many doesn't): that's when an anchor can take over.
//
//   const fix = new TagFix();
//   fix.add(worldFromSpace, weight, now) → true if it was used
//   fix.estimate (Matrix4, gravity-aligned) · fix.settled · fix.spread (m, readings) · fix.error (m, the average) · fix.inliers
import * as THREE from 'three';

const WINDOW = 150;              // sightings kept (about 15 s of a tag in view on a phone)
const MIN_SETTLED = 12;          // agreeing sightings before "settled"
const SETTLED_ERROR_M = 0.004;   // ...and how sure their average is (spread / √n)
const MAX_SPREAD_M = 0.05;       // readings more scattered than this never settle (bad view, bad calibration)
const OUTLIER_M = 0.06;          // further than this from the median (or 3 MADs): ignored
const OUTLIER_DEG = 4;
const MAX_TURN_DEG_S = 40;        // sightings taken faster than this are dropped
const MAX_MOVE_MPS = 0.35;

const yawOf = (m) => { const x = new THREE.Vector3().setFromMatrixColumn(m, 0); return Math.atan2(-x.z, x.x); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function weightedMedian(values, weights) {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const half = weights.reduce((a, b) => a + b, 0) / 2;
  let acc = 0;
  for (const i of idx) { acc += weights[i]; if (acc >= half) return values[i]; }
  return values[idx[idx.length - 1]];
}

// How much to trust one sighting: distance (m) to the tag, the cosine
// between the view ray and the tag's face, head turn (°/s) and move (m/s)
// speed when the photo was taken. Fast enough that a few ms of timing error
// means cm of error: not used at all (0).
export function sightingWeight(distance, facing, turnDegS = 0, moveMps = 0) {
  if (turnDegS > MAX_TURN_DEG_S || moveMps > MAX_MOVE_MPS) return 0;
  const d = 1 / Math.max(0.3, distance) ** 2;
  const a = Math.max(0.05, facing) ** 2;
  const m = 1 / (1 + (turnDegS / 15) ** 2 + (moveMps / 0.1) ** 2);
  return d * a * m;
}

export class TagFix {
  constructor() {
    this.samples = [];        // { p: Vector3, yaw, w, at }
    this.estimate = null;
    this.settled = false;
    this.spread = Infinity;
    this.error = Infinity;
    this.inliers = 0;
    this.lastAt = -Infinity;
  }

  add(m, w, now = performance.now()) {
    if (!(w > 0)) return false;
    this.samples.push({ p: new THREE.Vector3().setFromMatrixPosition(m), yaw: yawOf(m), w, at: now });
    if (this.samples.length > WINDOW) this.samples.shift();
    this.lastAt = now;
    this.solve();
    return true;
  }

  solve() {
    const s = this.samples, w = s.map((x) => x.w);
    const med = new THREE.Vector3(weightedMedian(s.map((x) => x.p.x), w), weightedMedian(s.map((x) => x.p.y), w), weightedMedian(s.map((x) => x.p.z), w));
    const yaw0 = s[s.length - 1].yaw;
    const yawMed = wrap(yaw0 + weightedMedian(s.map((x) => wrap(x.yaw - yaw0)), w));
    const dist = s.map((x) => x.p.distanceTo(med));
    const mad = weightedMedian(dist, w);
    const cut = Math.min(OUTLIER_M, Math.max(0.01, 3 * mad));
    const pos = new THREE.Vector3();
    let wsum = 0, sin = 0, cos = 0, n = 0;
    for (let i = 0; i < s.length; i++) {
      if (dist[i] > cut || Math.abs(wrap(s[i].yaw - yawMed)) > THREE.MathUtils.degToRad(OUTLIER_DEG)) continue;
      pos.addScaledVector(s[i].p, s[i].w);
      sin += Math.sin(s[i].yaw) * s[i].w;
      cos += Math.cos(s[i].yaw) * s[i].w;
      wsum += s[i].w;
      n++;
    }
    if (!n) return;
    pos.divideScalar(wsum);
    let sq = 0, w2 = 0;
    for (let i = 0; i < s.length; i++) if (dist[i] <= cut) { sq += s[i].w * s[i].p.distanceToSquared(pos); w2 += s[i].w * s[i].w; }
    this.spread = Math.sqrt(sq / wsum);
    const nEff = (wsum * wsum) / w2;                     // weighted sample count
    this.error = this.spread / Math.sqrt(nEff);
    this.inliers = n;
    this.estimate = new THREE.Matrix4().makeRotationY(Math.atan2(sin, cos)).setPosition(pos);
    this.settled = n >= MIN_SETTLED && this.error <= SETTLED_ERROR_M && this.spread <= MAX_SPREAD_M;
  }

  // Forget (e.g. the world frame jumped): start again from new sightings.
  reset() {
    this.samples = [];
    this.estimate = null;
    this.settled = false;
    this.spread = Infinity;
    this.inliers = 0;
  }
}
