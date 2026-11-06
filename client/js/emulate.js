// Dev/test only. Loaded when a page has ?emulate=<device>: installs Meta's
// IWER WebXR emulator so the app runs in any desktop browser. Exposes, for
// tests to drive:
//   window.__xrDevice   the emulated device (move controllers, press buttons)
//   window.__xrSession  the active XRSession
//   window.__tapScreen  fake a phone screen tap (IWER has no screen input)
// ?emulate=phone also fakes WebXR camera-access (Android Chrome's camera path:
// view.camera + XRWebGLBinding.getCameraImage), so the GPU camera-copy and
// tag-vision code run in tests. The fake camera shows what
// window.__fakeCamera describes (change it any time):
//   { tags: [{ id, x, y, px, rot }], flipY: true }
//   x, y: tag center in camera pixels (top-left origin); px: black-square
//   edge in pixels; rot: clockwise degrees. flipY: upload GL-style (row 0 =
//   image bottom, what real devices appear to do); false = the other way.
// Tests may set window.__emulateHooks = { onSession(session) {...} } (via an
// init script) to tamper with a session before the app sees it.
// Real devices never load this.
import { XRDevice, metaQuest3 } from '/vendor/iwer/iwer.module.js';

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const CONFIGS = {
  quest3: metaQuest3,
  // Phone: Quest 3 runtime with an Android Chrome identity, so the app takes
  // its phone code paths. Taps come from __tapScreen, not the controllers.
  phone: { ...metaQuest3, name: 'Android phone (emulated)', userAgent: ANDROID_UA },
};
const name = new URLSearchParams(location.search).get('emulate');
const config = CONFIGS[name];
if (!config) throw new Error(`unknown ?emulate=${name}; try: ${Object.keys(CONFIGS).join(', ')}`);

const device = new XRDevice(config);
if (name === 'phone') {   // phones have one view, at the camera (no eye offset)
  device.stereoEnabled = false;
  device.ipd = 0;
}
device.installRuntime({ forceInstall: true });
window.__xrDevice = device;

// ---- fake room (opt-in: set window.__fakeRoom in an init script) ---------------
// Real surfaces for hit-test (phones: the reticle lands on them) and plane
// detection (Quest: Space Setup planes with semantic labels):
//   window.__fakeRoom = { planes: [{ label: 'wall', center: [x, y, z], normal: [x, y, z], size: [w, h] }],
//                         boxes: [{ center: [x, y, z], size: [w, h, d] }],      (solid things: depth only)
//                         meshes: [{ label, vertices: [x, y, z, ...], indices: [...] }] }   (Quest room mesh)
// Coordinates are IWER's global space (floor at y = 0, the device starts at
// about (0, 1.6, 0) looking down -z). Implements the few members IWER calls
// on its synthetic-environment module, depth included (CPU and GPU, both
// from ray casting this room; window.__fakeRoom can change at any time).
class FakeRoom {
  constructor() {
    this.environmentCanvas = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });
    this.environmentCanvas.style.display = 'none';
    this.trackedMeshes = new Set((window.__fakeRoom.meshes ?? []).map((m) => ({
      transform: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
      vertices: new Float32Array(m.vertices), indices: new Uint32Array(m.indices ?? []), semanticLabel: m.label ?? 'global mesh' })));
    this.trackedPlanes = new Set(window.__fakeRoom.planes.map(planeFrom));
  }
  render() {}
  // viewMatrix: world → view; returns meters, row 0 = top (IWER flips it for GPU depth).
  computeDepthBuffer(viewMatrix, projectionMatrix) {
    const inv = invertRigid(viewMatrix);
    return fakeDepth(inv, projectionMatrix);
  }
  // ray: 4x4 (column-major) whose -z is the ray. Returns hit poses (y = normal), nearest first.
  computeHitTestResults(ray) {
    const o = [ray[12], ray[13], ray[14]], d = [-ray[8], -ray[9], -ray[10]];
    const hits = [];
    for (const pl of this.trackedPlanes) {
      const m = pl.transform.matrix, n = [m[4], m[5], m[6]], c = [m[12], m[13], m[14]];
      const den = dot(n, d);
      if (Math.abs(den) < 1e-6) continue;
      const t = dot(n, sub(c, o)) / den;
      if (t <= 0) continue;
      const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
      const rel = sub(p, c);
      const lx = dot(rel, [m[0], m[1], m[2]]), lz = dot(rel, [m[8], m[9], m[10]]);
      if (Math.abs(lx) > pl.half[0] || Math.abs(lz) > pl.half[1]) continue;
      const hit = new Float32Array(m);
      hit[12] = p[0]; hit[13] = p[1]; hit[14] = p[2];
      hits.push({ t, hit });
    }
    return hits.sort((a, b) => a.t - b.t).map((h) => h.hit);
  }
}
// Depth of the fake room from a camera (cam: view → world, column-major;
// proj: projection). Small (64×64 or 96×54): every pixel is a ray cast.
// uvInv (optional, column-major): normalized view coords from depth-buffer
// coords, i.e. the inverse of normDepthBufferFromNormView (phones rotate).
function fakeDepth(cam, proj, w = 96, h = 54, uvInv = null) {
  if (Math.abs(proj[5] / proj[0] - 1) < 0.3) { w = 128; h = 128; }   // square-ish eye (Quest)
  const room = window.__fakeRoom ?? { planes: [] };
  const planes = room.planes.map(planeFrom);
  const boxes = (room.boxes ?? []).map((b) => ({ lo: b.center.map((c, i) => c - b.size[i] / 2), hi: b.center.map((c, i) => c + b.size[i] / 2) }));
  const o = [cam[12], cam[13], cam[14]];
  const out = new Float32Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    let u = (c + 0.5) / w, v = (r + 0.5) / h;
    if (uvInv) [u, v] = [uvInv[0] * u + uvInv[4] * v + uvInv[12], uvInv[1] * u + uvInv[5] * v + uvInv[13]];
    const nx = 2 * u - 1, ny = 1 - 2 * v;
    const dc = [(nx + proj[8]) / proj[0], (ny + proj[9]) / proj[5], -1];          // view space, z = -1
    const d = [cam[0] * dc[0] + cam[4] * dc[1] + cam[8] * dc[2], cam[1] * dc[0] + cam[5] * dc[1] + cam[9] * dc[2],
               cam[2] * dc[0] + cam[6] * dc[1] + cam[10] * dc[2]];
    let best = Infinity;   // t along d (|d.z_view| = 1) = depth along the view axis
    for (const pl of planes) {
      const m = pl.transform.matrix, n = [m[4], m[5], m[6]], ctr = [m[12], m[13], m[14]];
      const den = dot(n, d);
      if (Math.abs(den) < 1e-9) continue;
      const t = dot(n, sub(ctr, o)) / den;
      if (t <= 0.01 || t >= best) continue;
      const rel = sub([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], ctr);
      if (Math.abs(dot(rel, [m[0], m[1], m[2]])) > pl.half[0] || Math.abs(dot(rel, [m[8], m[9], m[10]])) > pl.half[1]) continue;
      best = t;
    }
    for (const b of boxes) {
      let tn = -Infinity, tf = Infinity;
      for (let k = 0; k < 3; k++) {
        const iv = 1 / (Math.abs(d[k]) < 1e-12 ? 1e-12 : d[k]);
        const t1 = (b.lo[k] - o[k]) * iv, t2 = (b.hi[k] - o[k]) * iv;
        tn = Math.max(tn, Math.min(t1, t2)); tf = Math.min(tf, Math.max(t1, t2));
      }
      if (tn <= tf && tn > 0.01 && tn < best) best = tn;
    }
    out[r * w + c] = Number.isFinite(best) && best < 8 ? best : 0;
  }
  return { data: out.buffer, width: w, height: h, rawValueToMeters: 1 };
}
window.__fakeDepthOf = fakeDepth;

function invertRigid(m) {   // column-major rigid 4x4
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];   // transpose of rotation, column-major
  const t = [m[12], m[13], m[14]];
  return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0,
    -(r[0] * t[0] + r[3] * t[1] + r[6] * t[2]), -(r[1] * t[0] + r[4] * t[1] + r[7] * t[2]), -(r[2] * t[0] + r[5] * t[1] + r[8] * t[2]), 1];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
function planeFrom({ label, center, normal, size }) {
  const y = norm(normal);
  const x = Math.abs(y[1]) > 0.9 ? [1, 0, 0] : norm(cross([0, 1, 0], y));
  const z = cross(x, y);
  const matrix = new Float32Array([...x, 0, ...y, 0, ...z, 0, ...center, 1]);
  const [hw, hd] = [size[0] / 2, size[1] / 2];
  const polygon = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([px, pz]) => new DOMPointReadOnly(px, 0, pz, 1));
  return { transform: { matrix }, polygon, semanticLabel: label, half: [hw, hd] };
}
if (window.__fakeRoom) device.installSEM(FakeRoom);

// Same aspect as the emulated view (1280x720), as on a real phone.
const FAKE_CAMERA = { width: 640, height: 360 };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.appendChild(s);
  });
}

// Draw the fake camera image: white background plus AprilTags.
let arucoLoaded = null;   // one shared load: concurrent redraws must not race it
async function fakeCameraCanvas(spec) {
  arucoLoaded ??= (async () => {
    for (const f of ['cv.js', 'aruco.js', 'dictionaries/apriltag_36h11.js']) await loadScript(`/vendor/js-aruco2/${f}`);
  })();
  await arucoLoaded;
  const dict = new window.AR.Dictionary('APRILTAG_36h11');
  const canvas = Object.assign(document.createElement('canvas'), FAKE_CAMERA);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const t of spec.tags ?? []) {
    const code = dict.codeList[t.id];
    const cell = t.px / 8;                 // black square = 8 cells
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(((t.rot ?? 0) * Math.PI) / 180);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-5 * cell, -5 * cell, 10 * cell, 10 * cell);   // quiet zone
    ctx.fillStyle = '#000';
    ctx.fillRect(-4 * cell, -4 * cell, 8 * cell, 8 * cell);
    ctx.fillStyle = '#fff';
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
      if (code[y * 6 + x] === '1') ctx.fillRect((x - 3) * cell, (y - 3) * cell, cell, cell);
    }
    ctx.restore();
  }
  return canvas;
}

if (name === 'phone') {
  Object.defineProperty(window.XRView.prototype, 'camera', { get: () => FAKE_CAMERA, configurable: true });
  const Binding = window.XRWebGLBinding;
  window.XRWebGLBinding = class extends Binding {
    constructor(session, gl) {
      super(session, gl);
      this.gl = gl;
    }
    getCameraImage() {
      const gl = this.gl;
      if (!this.tex) {   // (first call: also inside withRawGL)
        this.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FAKE_CAMERA.width, FAKE_CAMERA.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);
      }
      // Redraw when the description changes. Drawing is async; the GL upload
      // happens here, synchronously, because callers wrap this in
      // withRawGL() (GL calls from a stray callback would desync three).
      const spec = window.__fakeCamera ?? {};
      const key = JSON.stringify(spec);
      if (key !== this.drawnKey && this.drawingKey !== key) {
        this.drawingKey = key;
        fakeCameraCanvas(spec).then((canvas) => { this.ready = { key, canvas, flipY: spec.flipY !== false }; });
      }
      if (this.ready) {
        const { key: k, canvas, flipY } = this.ready;
        this.ready = null;
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        this.drawnKey = k;
        window.__fakeCameraReady = k;
      }
      return this.tex;
    }
  };
}

// ---- fake Quest headset camera (opt-in: window.__fakeQuestCamera) ---------------
// The Quest gives pages its passthrough camera through getUserMedia, with no
// calibration. This fake renders printed tags placed in the room through a
// camera with KNOWN settings, from where the head was latencyMs ago, so tests
// can check the calibration recovers them:
//   { width, height, hfovDeg, cxOffset, extrinsic: { p: [x, y, z], euler: [x, y, z] } (head → camera, view frame),
//     latencyMs, tags: [{ id, size (black square, m), p: [x, y, z], normal: [x, y, z] }] }
if (name === 'quest3') {
  const heads = [];
  setInterval(() => {
    heads.push({ t: performance.now(), p: { x: device.position.x, y: device.position.y, z: device.position.z },
      q: { x: device.quaternion.x, y: device.quaternion.y, z: device.quaternion.z, w: device.quaternion.w } });
    while (heads.length > 600) heads.shift();
  }, 5);
  const headAt = (t) => { for (let i = heads.length - 1; i >= 0; i--) if (heads[i].t <= t) return heads[i]; return heads[0]; };
  const realEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
  const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.enumerateDevices = async () => (window.__fakeQuestCamera ? [{ kind: 'videoinput', label: 'camera 2, facing back', deviceId: 'fake' }] : realEnumerate());
  navigator.mediaDevices.getUserMedia = async (c) => {
    const spec = window.__fakeQuestCamera;
    if (!spec) return realGetUserMedia(c);   // no fake asked for: the browser's own (tests may use Chromium's fake device)
    const THREE = await import('three');
    await (arucoLoaded ??= (async () => { for (const f of ['cv.js', 'aruco.js', 'dictionaries/apriltag_36h11.js']) await loadScript(`/vendor/js-aruco2/${f}`); })());
    const dict = new window.AR.Dictionary('APRILTAG_36h11');
    const canvas = Object.assign(document.createElement('canvas'), { width: spec.width ?? 1280, height: spec.height ?? 960 });
    const g = canvas.getContext('2d');
    const f = canvas.width / (2 * Math.tan(((spec.hfovDeg ?? 70) * Math.PI) / 360));
    const ex = spec.extrinsic ?? { p: [0, 0, 0], euler: [0, 0, 0] };
    const E = new THREE.Matrix4().compose(new THREE.Vector3(...ex.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...ex.euler)), new THREE.Vector3(1, 1, 1));
    const draw = () => {
      const h = headAt(performance.now() - (spec.latencyMs ?? 0));
      if (!h) return;
      const cam = new THREE.Matrix4().compose(new THREE.Vector3(h.p.x, h.p.y, h.p.z), new THREE.Quaternion(h.q.x, h.q.y, h.q.z, h.q.w), new THREE.Vector3(1, 1, 1)).multiply(E);
      const inv = cam.clone().invert();
      const proj = (w) => { const c = w.clone().applyMatrix4(inv); const z = -c.z; return z > 0.02 ? [f * c.x / z + canvas.width / 2 + (spec.cxOffset ?? 0), f * -c.y / z + canvas.height / 2] : null; };
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (const t of spec.tags ?? []) {
        const n = new THREE.Vector3(...t.normal).normalize();
        const X = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(n).normalize();
        const Z = new THREE.Vector3().crossVectors(X, n);
        const c0 = new THREE.Vector3(...t.p), cell = t.size / 8;
        const at = (cx, cy) => c0.clone().addScaledVector(X, cx * cell).addScaledVector(Z, cy * cell);
        const quad = (x0, y0, x1, y1, color) => {
          const pts = [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)].map(proj);
          if (pts.some((q) => !q)) return;
          g.fillStyle = color; g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(u, v) : g.moveTo(u, v))); g.closePath(); g.fill();
        };
        quad(-5, -5, 5, 5, '#fff'); quad(-4, -4, 4, 4, '#000');
        const code = dict.codeList[t.id];
        for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (code[y * 6 + x] === '1') quad(x - 3, y - 3, x - 2, y - 2, '#fff');
      }
    };
    draw();
    setInterval(draw, 33);
    window.__fakeQuestCameraTruth = { f, cx: canvas.width / 2 + (spec.cxOffset ?? 0), cy: canvas.height / 2, extrinsic: E.toArray(), latencyMs: spec.latencyMs ?? 0 };
    return canvas.captureStream(30);
  };
}

const requestSession = navigator.xr.requestSession.bind(navigator.xr);
navigator.xr.requestSession = async (...args) => {
  const session = (window.__xrSession = await requestSession(...args));
  if (name === 'phone') {
    // Fake phone sensors: camera-access (see FAKE_CAMERA) and CPU depth
    // sensing returning window.__fakeDepth meters everywhere (0 = unknown).
    const extra = ['camera-access', 'depth-sensing'].filter((f) => args[1]?.optionalFeatures?.includes(f));
    const features = [...session.enabledFeatures, ...extra];
    Object.defineProperty(session, 'enabledFeatures', { get: () => features });
    if (extra.includes('depth-sensing')) {
      Object.defineProperty(session, 'depthUsage', { get: () => 'cpu-optimized' });
      Object.defineProperty(session, 'depthDataFormat', { get: () => 'float32' });
      window.XRFrame.prototype.getDepthInformation = function (view) {
        if (window.__fakeRoom && view) {   // the fake room, as a phone's depth would see it
          const M = window.__fakeDepthTransform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          const det = M[0] * M[5] - M[4] * M[1];   // 2D affine inverse (depth buffer → view)
          const inv = [M[5] / det, -M[1] / det, 0, 0, -M[4] / det, M[0] / det, 0, 0, 0, 0, 1, 0,
            (M[4] * M[13] - M[5] * M[12]) / det, (M[1] * M[12] - M[0] * M[13]) / det, 0, 1];
          const d = fakeDepth(Array.from(view.transform.matrix), Array.from(view.projectionMatrix), 96, 54, inv);
          return { width: d.width, height: d.height, rawValueToMeters: 1, data: d.data,
                   normDepthBufferFromNormView: { matrix: new Float32Array(M) } };
        }
        const w = 16, h = 9;
        return { width: w, height: h, rawValueToMeters: 1, data: new Float32Array(w * h).fill(window.__fakeDepth ?? 0).buffer,
                 normDepthBufferFromNormView: { matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) } };
      };
    }
  }
  if (name !== 'phone' && window.XRWebGLBinding?.prototype.getDepthInformation && !window.XRWebGLBinding.__farFixed) {
    // IWER writes GPU depth as 1 − near/z (an infinite far plane) but reports
    // the render far plane; report what it actually encodes.
    const get = window.XRWebGLBinding.prototype.getDepthInformation;
    window.XRWebGLBinding.prototype.getDepthInformation = function (...a) {
      const info = get.apply(this, a);
      if (info) try { Object.defineProperty(info, 'depthFar', { value: Infinity, configurable: true }); } catch { /* keep it */ }
      return info;
    };
    window.XRWebGLBinding.__farFixed = true;
  }
  window.__emulateHooks?.onSession?.(session);
  return session;
};

// ---- fake touches (IWER has no screen input) ---------------------------------
// A touch is a transient 'screen' input source whose ray starts at the viewer.
// Aim with { pitchDeg, yawDeg } (relative to looking straight ahead) or
// { at: [x, y, z] } (a world point). Events fire inside an animation frame,
// but with an *input-event frame* that, like Chrome's, refuses
// getViewerPose().
//   await __touch.start(aim); await __touch.move(aim); await __touch.end()
//   __touch.cancel()   (selectend without select, e.g. the system took it)
//   __tapScreen(aim)   (start + end in one frame)

function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
const qconj = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
function qrotate(q, v) {
  const r = qmul(qmul(q, { ...v, w: 0 }), qconj(q));
  return { x: r.x, y: r.y, z: r.z };
}

// Rotation (viewer-local) that turns the viewer's -z toward the aim.
function aimQuat({ pitchDeg = 0, yawDeg = 0, at = null } = {}) {
  if (at) {
    const p = device.position, q = device.quaternion;
    const d = qrotate(qconj({ x: q.x, y: q.y, z: q.z, w: q.w }), { x: at[0] - p.x, y: at[1] - p.y, z: at[2] - p.z });
    const len = Math.hypot(d.x, d.y, d.z);
    yawDeg = (Math.atan2(-d.x, -d.z) * 180) / Math.PI;
    pitchDeg = (Math.asin(d.y / len) * 180) / Math.PI;
  }
  const y = (yawDeg * Math.PI) / 360, x = (pitchDeg * Math.PI) / 360;
  return qmul({ x: 0, y: Math.sin(y), z: 0, w: Math.cos(y) }, { x: Math.sin(x), y: 0, z: 0, w: Math.cos(x) });
}

async function aimedSpace(aim) {
  const viewer = await window.__xrSession.requestReferenceSpace('viewer');
  const q = aimQuat(aim);
  // IWER 2.5 bug: getOffsetReferenceSpace stores its argument as a raw
  // matrix, so pass the transform's matrix (the spec takes the transform).
  return viewer.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: 0, z: 0 }, q).matrix);
}

function inFrame(fn) {
  const session = window.__xrSession;
  return new Promise((resolve) => session.requestAnimationFrame((t, frame) => {
    const eventFrame = {
      session, getPose: (space, base) => frame.getPose(space, base),
      getViewerPose() { throw new DOMException("Failed to execute 'getViewerPose' on 'XRFrame': This method can only be called on XRFrame objects passed to XRSession.requestAnimationFrame callbacks.", 'InvalidStateError'); },
    };
    const fire = (type, inputSource) => session.dispatchEvent(Object.assign(new Event(type), { frame: eventFrame, inputSource }));
    fn(fire);
    resolve();
  }));
}

let current = null;
window.__touch = {
  async start(aim) {
    const source = { targetRayMode: 'screen', handedness: 'none', gripSpace: undefined, profiles: ['generic-touchscreen'],
      targetRaySpace: await aimedSpace(aim) };
    current = source;
    await inFrame((fire) => fire('selectstart', source));
  },
  async move(aim) {
    if (current) current.targetRaySpace = await aimedSpace(aim);   // the finger moved
  },
  async end() {
    const source = current;
    current = null;
    if (source) await inFrame((fire) => { fire('select', source); fire('selectend', source); });
  },
  async cancel() {
    const source = current;
    current = null;
    if (source) await inFrame((fire) => fire('selectend', source));
  },
};

window.__tapScreen = async (aim = {}) => {
  const source = { targetRayMode: 'screen', handedness: 'none', gripSpace: undefined, profiles: ['generic-touchscreen'],
    targetRaySpace: await aimedSpace(aim) };
  await inFrame((fire) => { fire('selectstart', source); fire('select', source); fire('selectend', source); });
};
