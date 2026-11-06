import * as THREE from 'three';

// UUIDv7: time-ordered, generated client-side so objects can be created
// optimistically (DESIGN.md §4).
export function uuid7() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ms = Date.now();
  for (let i = 5; i >= 0; i--) { b[i] = ms % 256; ms = Math.floor(ms / 256); }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Stable per-browser device id. Anchor bindings are keyed by it, because
// Quest persistent anchors only exist on the device that made them.
export function deviceId() {
  let id = localStorage.getItem('stratum.device');
  if (!id) {
    id = uuid7();
    localStorage.setItem('stratum.device', id);
  }
  return id;
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

export function poseToMatrix(pose, m = new THREE.Matrix4()) {
  _p.fromArray(pose.p);
  _q.fromArray(pose.q);
  _s.fromArray(pose.s ?? [1, 1, 1]);
  return m.compose(_p, _q, _s);
}

export function matrixToPose(m) {
  m.decompose(_p, _q, _s);
  const r = (v, d) => Math.round(v * d) / d;
  return {
    p: _p.toArray().map((v) => r(v, 1e4)),   // 0.1 mm
    q: _q.normalize().toArray().map((v) => r(v, 1e6)),
    s: _s.toArray().map((v) => r(v, 1e4)),
  };
}

// Gravity-aligned rotation that faces `from` toward `to` around Y only.
// Space frames and placed objects stay upright regardless of surface tilt.
export function yawFacing(from, to, out = new THREE.Quaternion()) {
  const yaw = Math.atan2(to.x - from.x, to.z - from.z);
  return out.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}
