// Headset camera calibration from one printed tag (DESIGN.md §3.9).
//
// The tag stays put while you move your head around it. Each detection gives
// the tag's 4 corners in the image at the frame's time. One model explains
// all of them: camera lens (f, cx, cy), where the camera sits on the headset
// (head → camera, 6 numbers), where the tag is in the room (6 numbers), and
// how late frames arrive (latency, searched coarse → fine). Levenberg–
// Marquardt on the corner reprojection error, numeric Jacobian.
//
//   const cal = new Calibration(feed, sizeM);
//   cal.add(capture, markers)   // from the tag tracker (raw corners + capture)
//   cal.progress → { views, needed, spreadDeg }
//   await cal.solve() → { f, cx, cy, extrinsic, latencyMs, rmsPx, width, height } (throws if it can't)
import * as THREE from 'three';

const NEED_VIEWS = 30;
const NEED_SPREAD_DEG = 12;       // head turned at least this much across the views
const MAX_VIEWS = 60;

export class Calibration {
  constructor(feed, sizeM) {
    this.feed = feed;
    this.size = sizeM;
    this.views = [];               // { id, corners, t, width, height, q (head orientation, for spread) }
    this.tagId = null;
  }

  get progress() {
    return { views: this.views.length, needed: NEED_VIEWS, spreadDeg: spreadDeg(this.views), neededSpread: NEED_SPREAD_DEG };
  }

  get ready() { const p = this.progress; return p.views >= NEED_VIEWS && p.spreadDeg >= NEED_SPREAD_DEG; }

  add(cap, markers) {
    if (!cap?.raw || !markers?.length) return;
    const m = this.tagId == null ? markers[0] : markers.find((x) => x.id === this.tagId);
    if (!m) return;
    this.tagId = m.id;
    const head = this.feed.headAt(cap.raw.frameTime);
    if (!head) return;
    const q = new THREE.Quaternion().setFromRotationMatrix(head);
    // Keep views that add something: a different angle or position than the last one.
    const last = this.views.at(-1);
    if (last && q.angleTo(last.q) < 0.5 * Math.PI / 180 && new THREE.Vector3().setFromMatrixPosition(head).distanceTo(last.p) < 0.01) return;
    this.views.push({ id: m.id, corners: m.corners.map((c) => [c[0], c[1]]), t: cap.raw.frameTime, width: cap.width, height: cap.height,
      hasCaptureTime: cap.raw.hasCaptureTime, q, p: new THREE.Vector3().setFromMatrixPosition(head) });
    if (this.views.length > MAX_VIEWS) this.views.splice(1 + Math.floor(Math.random() * (this.views.length - 2)), 1);   // thin, keep the spread
  }

  async solve() {
    if (this.views.length < 8) throw new Error('not enough views of the tag');
    const { width, height } = this.views[0];
    const range = this.views[0].hasCaptureTime ? [-40, 120] : [0, 200];
    let best = null;
    for (let L = range[0]; L <= range[1]; L += 20) {                     // coarse latency search
      const r = this.fit(L, null, 12);
      if (r && (!best || r.rms < best.rms)) best = { ...r, L };
      await yieldToFrame();
    }
    if (!best) throw new Error('could not fit the views');
    for (const L of [best.L - 10, best.L - 5, best.L + 5, best.L + 10]) {   // fine
      const r = this.fit(L, best.p, 15);
      if (r && r.rms < best.rms) best = { ...r, L };
      await yieldToFrame();
    }
    let final = this.fit(best.L, best.p, 40);
    if (final && final.rms <= best.rms) Object.assign(best, final);
    // Drop views that disagree with the rest (a blurred frame, a mistimed
    // one mid-turn), then fit again on the ones that agree.
    for (let round = 0; round < 2; round++) {
      const errs = this.viewErrors(best.L, best.p);
      const med = [...errs].sort((a, b) => a - b)[Math.floor(errs.length / 2)];
      const keep = errs.map((e) => e <= Math.max(3 * med, 2.5));
      if (keep.every(Boolean) || keep.filter(Boolean).length < 20) break;
      this.views = this.views.filter((_, i) => keep[i]);
      for (const L of [best.L - 10, best.L, best.L + 10]) {
        const r = this.fit(L, best.p, 25);
        if (r && (L === best.L - 10 || r.rms < best.rms)) best = { ...r, L };
      }
      await yieldToFrame();
    }
    const [f, cx, cy, ...rest] = best.p;
    const extrinsic = poseOf(rest.slice(0, 6)).toArray();
    const tagWorld = poseOf(rest.slice(6, 12));
    return { width, height, f, cx, cy, extrinsic, latencyMs: best.L, rmsPx: best.rms, views: this.views.length, spreadDeg: this.progress.spreadDeg,
      tagWorld: tagWorld.toArray() };
  }

  // RMS corner error (px) of each view under parameters p, latency L.
  viewErrors(L, p) {
    const { width, height } = this.views[0];
    const heads = this.views.map((v) => this.feed.headAt(v.t - L));
    const r = residuals(p, this.views, heads, this.size, width, height);
    return this.views.map((_, i) => Math.sqrt(r.slice(i * 8, i * 8 + 8).reduce((a, b) => a + b * b, 0) / 4));
  }

  // Fit everything except latency L. p0: start (else guessed). → { p, rms }
  fit(L, p0, iterations) {
    const { width, height } = this.views[0];
    const heads = this.views.map((v) => this.feed.headAt(v.t - L));
    if (heads.some((h) => !h)) return null;
    let p = p0 ? [...p0] : this.guess(heads, width, height);
    if (!p) return null;
    const res = (q) => residuals(q, this.views, heads, this.size, width, height);
    let r = res(p), cost = sq(r), lambda = 1e-3;
    const eps = [0.5, 0.5, 0.5, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4];
    for (let it = 0; it < iterations; it++) {
      const n = p.length, m = r.length;
      const J = Array.from({ length: n }, (_, j) => {
        const a = [...p], b = [...p];
        a[j] += eps[j]; b[j] -= eps[j];
        const ra = res(a), rb = res(b);
        return ra.map((x, i) => (x - rb[i]) / (2 * eps[j]));
      });
      const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => { let s = 0; for (let k = 0; k < m; k++) s += J[i][k] * J[j][k]; return s; }));
      const g = Array.from({ length: n }, (_, i) => { let s = 0; for (let k = 0; k < m; k++) s += J[i][k] * r[k]; return s; });
      let improved = false;
      for (let tries = 0; tries < 6 && !improved; tries++) {
        const Al = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v)));
        const step = solveLinear(Al, g.map((v) => -v));
        if (!step) { lambda *= 10; continue; }
        const q = p.map((v, i) => v + step[i]);
        const rq = res(q), cq = sq(rq);
        if (cq < cost) { p = q; r = rq; cost = cq; lambda = Math.max(1e-7, lambda / 3); improved = true; }
        else lambda *= 8;
      }
      if (!improved) break;
    }
    const corners = this.views.length * 4;
    return { p, rms: Math.sqrt(sqReproj(r, corners) / corners) };
  }

  // Start: default lens, camera at the eyes, tag where the first view says.
  guess(heads, width, height) {
    const f = width / (2 * Math.tan(36 * Math.PI / 180));
    const v = this.views[0];
    const s = this.size / 2, K = { fx: f, fy: f, cx: width / 2, cy: height / 2 };
    // Tag pose in camera (homography), then into the world through the head.
    const H = homographyFrom([[-s, -s], [s, -s], [s, s], [-s, s]], v.corners);
    if (!H) return null;
    const cv = tagFromH(H, K);
    if (!cv) return null;
    const world = heads[0].clone().multiply(CV_TO_GL).multiply(cv).multiply(OURS_TO_CV);
    return [f, width / 2, height / 2, 0, 0, 0, 0, 0, 0, ...paramsOf(world)];
  }
}

// ---- model ------------------------------------------------------------------------------

const CV_TO_GL = new THREE.Matrix4().makeScale(1, -1, -1);
const OURS_TO_CV = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const PRIOR = 2;   // weak pulls (px-equivalent) keeping an ill-posed fit sensible

function poseOf(a) {
  const r = new THREE.Vector3(a[0], a[1], a[2]);
  const ang = r.length();
  const q = ang > 1e-12 ? new THREE.Quaternion().setFromAxisAngle(r.clone().divideScalar(ang), ang) : new THREE.Quaternion();
  return new THREE.Matrix4().compose(new THREE.Vector3(a[3], a[4], a[5]), q, new THREE.Vector3(1, 1, 1));
}

function paramsOf(m) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion();
  m.decompose(p, q, new THREE.Vector3());
  q.normalize();
  const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
  const s = Math.sqrt(Math.max(1e-12, 1 - q.w * q.w)) * Math.sign(q.w || 1);
  return [q.x / s * ang, q.y / s * ang, q.z / s * ang, p.x, p.y, p.z];
}

// Corner reprojection residuals (2 per corner) + weak priors.
function residuals(p, views, heads, size, width, height) {
  const [f, cx, cy] = p;
  const E = poseOf(p.slice(3, 9)), T = poseOf(p.slice(9, 15));
  const s = size / 2;
  const local = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(T));
  const out = [];
  const inv = new THREE.Matrix4(), c = new THREE.Vector3();
  views.forEach((v, i) => {
    inv.multiplyMatrices(heads[i], E).invert();
    for (let k = 0; k < 4; k++) {
      c.copy(local[k]).applyMatrix4(inv);
      const x = c.x, y = -c.y, z = -c.z;
      if (z < 0.05) { out.push(1e3, 1e3); continue; }
      out.push(f * x / z + cx - v.corners[k][0], f * y / z + cy - v.corners[k][1]);
    }
  });
  // Priors: principal point near the center; the camera within a few cm of the eyes.
  out.push(PRIOR * (cx - width / 2) / (0.1 * width), PRIOR * (cy - height / 2) / (0.1 * height));
  out.push(...p.slice(6, 9).map((t) => PRIOR * t / 0.1));
  return out;
}

const sq = (r) => r.reduce((a, b) => a + b * b, 0);
const sqReproj = (r, corners) => r.slice(0, corners * 2).reduce((a, b) => a + b * b, 0);

function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function spreadDeg(views) {
  let max = 0;
  for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) max = Math.max(max, views[i].q.angleTo(views[j].q));
  return max * 180 / Math.PI;
}

const yieldToFrame = () => new Promise((r) => setTimeout(r, 0));

// (Same math as vision/pose.js, kept local so this module stands alone.)
function homographyFrom(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solveLinear(A, b);
  return h ? [...h, 1] : null;
}

function tagFromH(H, K) {
  const col = (j) => new THREE.Vector3((H[j] - K.cx * H[6 + j]) / K.fx, (H[3 + j] - K.cy * H[6 + j]) / K.fy, H[6 + j]);
  const m1 = col(0), m2 = col(1), m3 = col(2);
  let lambda = 2 / (m1.length() + m2.length());
  if (m3.z * lambda < 0) lambda = -lambda;
  const r1 = m1.multiplyScalar(lambda), r2 = m2.multiplyScalar(lambda), t = m3.multiplyScalar(lambda);
  const a = r1.clone().normalize(), c = r2.clone().normalize();
  const bis = a.clone().add(c).normalize(), perp = a.clone().sub(c).normalize();
  const x = bis.clone().add(perp).normalize(), y = bis.clone().sub(perp).normalize();
  return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)).setPosition(t);
}
