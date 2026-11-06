// Marker pose from 4 image corners (planar homography → R, t), and the frame
// conversions around it. Pure math, no GL.
//
// Conventions
//   image:     pixels, origin top-left, x right, y down
//   CV camera: x right, y down, z forward
//   GL camera: x right, y up, z backward (WebXR view space)
//   Tag frame (ours): origin at tag center, x → tag's right edge,
//     y → out of the paper (toward the viewer), z → tag's bottom edge.
//     A tag lying flat on a table, read upright, has y = up.
import * as THREE from 'three';

// Intrinsics for an XRView-aligned camera image (raw-camera-access explainer).
export function intrinsicsFromProjection(p, width, height) {
  return {
    fx: (p[0] * width) / 2,
    fy: (p[5] * height) / 2,
    cx: ((1 - p[8]) * width) / 2,
    cy: ((1 + p[9]) * height) / 2,
  };
}

// 3x3 homography H (row-major, 9 numbers) with H·[X, Y, 1] ~ [u, v, 1],
// from exactly 4 correspondences (DLT with h33 = 1, Gaussian elimination).
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solve(A, b);
  return h && [...h, 1];
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// Tag-to-camera transform in CV camera coordinates, as a THREE.Matrix4.
// corners: image points in detector order (clockwise from the tag's
// top-left: TL, TR, BR, BL). size: black-square edge in meters.
export function tagPoseCV(corners, size, K) {
  const s = size / 2;
  // Tag plane in CV tag coords (x right, y down, z into the paper).
  const obj = [[-s, -s], [s, -s], [s, s], [-s, s]];
  const H = homography(obj, corners);
  if (!H) return null;
  // M = K⁻¹ H, columns m1, m2, m3.
  const col = (j) => new THREE.Vector3(
    (H[j] - K.cx * H[6 + j]) / K.fx,
    (H[3 + j] - K.cy * H[6 + j]) / K.fy,
    H[6 + j]);
  const m1 = col(0), m2 = col(1), m3 = col(2);
  let lambda = 2 / (m1.length() + m2.length());
  if (m3.z * lambda < 0) lambda = -lambda;   // tag must be in front of the camera
  const r1 = m1.multiplyScalar(lambda), r2 = m2.multiplyScalar(lambda), t = m3.multiplyScalar(lambda);
  // Re-orthonormalize (noise makes r1, r2 slightly non-orthogonal):
  // split the error evenly between them.
  const a = r1.clone().normalize(), c = r2.clone().normalize();
  const bisect = a.clone().add(c).normalize(), perp = a.clone().sub(c).normalize();
  const x = bisect.clone().add(perp).normalize(), y = bisect.clone().sub(perp).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(t);
}

// CV tag frame → our tag frame (y out of paper, z toward bottom edge):
// ours.x = cv.x, ours.y = -cv.z, ours.z = cv.y.
const OURS_TO_CV_TAG = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1);
// CV camera → GL camera: flip y and z.
const CV_TO_GL_CAM = new THREE.Matrix4().makeScale(1, -1, -1);

// Tag pose in world, given the camera's world transform (XRView.transform)
// at the moment the image was captured.
export function tagPoseWorld(tagCV, cameraWorld) {
  return new THREE.Matrix4()
    .multiplyMatrices(cameraWorld, CV_TO_GL_CAM)
    .multiply(tagCV)
    .multiply(OURS_TO_CV_TAG);
}

// Keep position + yaw only (gravity is known; tilt is the noisiest part of a
// single-camera pose). Returns { matrix, mount }:
//   flat tag (table/floor, normal mostly up): yaw from the tag's x axis, so
//     the frame's x follows the tag's right edge.
//   wall tag (normal mostly horizontal): the tag's in-plane rotation says
//     nothing about yaw, so yaw makes the frame's +z point out of the wall.
export function gravityAligned(m) {
  const pos = new THREE.Vector3().setFromMatrixPosition(m);
  const n = new THREE.Vector3().setFromMatrixColumn(m, 1);   // tag normal
  let yaw, mount;
  if (Math.abs(n.y) > 0.7) {
    const x = new THREE.Vector3().setFromMatrixColumn(m, 0);
    yaw = Math.atan2(-x.z, x.x);
    mount = 'flat';
  } else {
    yaw = Math.atan2(n.x, n.z);
    mount = 'wall';
  }
  return { matrix: new THREE.Matrix4().makeRotationY(yaw).setPosition(pos), mount };
}
