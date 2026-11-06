// M1a probe: passthrough AR + "can we see camera frames inside immersive-ar?"
//
// Quest Browser: rejects WebXR camera-access, so try plain getUserMedia.
// Android Chrome (ARCore): WebXR camera-access gives pose-aligned frames.
//
// Placement is one "place intent" with platform-specific sources:
//   Quest controller → at the grip.  Grip button brings the panel back.
//   Phone tap        → on the surface under the screen-center reticle
//                      (hit-test), or 40 cm ahead if no surface is found.
import * as THREE from 'three';
import { telemetry } from './telemetry.js';
import { withRawGL, chooseXRLayerPath } from './gl.js';
import { XRCameraFeed } from './vision/camera.js';
import { TagTracker } from './vision/tags.js';

// ?emulate=quest3 → fake WebXR device for desktop testing (tests/).
if (new URLSearchParams(location.search).has('emulate')) await import('./emulate.js');

const $ = (id) => document.getElementById(id);
// Bump on every change: shown on the page and in AR, so a stale cached copy
// on a device is obvious instead of looking like a bug.
const PROBE_VERSION = 'probe v9';
telemetry.setVersion(PROBE_VERSION);
const SPIN_RAD_PER_SEC = 0.5;
const PHONE_SPAWN_DIST = 0.4;
const CUBE_SIZE = 0.1;
const IS_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
// Printed tag size: black-square edge, from /tags (?tag=<mm>, default 100).
const TAG_SIZE = (Number(new URLSearchParams(location.search).get('tag')) || 100) / 1000;

// ---- log: 2D page + in-AR panel -------------------------------------------

const lines = [];
const status = { xrFps: 0, camFps: 0, cam: 'not started' };
// Whole-session totals, logged on exit so pasted logs include frame rates.
const totals = { start: 0, xrFrames: 0, camFrames: 0, hitFrames: 0, hitHits: 0 };
// Everything logged here is shown on the page/panel AND sent to telemetry.
// `remote: false` for messages telemetry already captured (errors).
function log(msg, { remote = true } = {}) {
  console.log('[probe]', msg);
  if (remote) telemetry[/^(error|FAILED)/.test(msg) ? 'error' : 'info'](msg);
  lines.push(msg);
  $('log').textContent = lines.join('\n');
  panel.dirty = true;
}

// Phone DOM overlay mirrors the panel's header lines.
function drawOverlay() {
  $('ov-status').textContent =
    `XR ${status.xrFps} fps · camera ${status.camFps} fps\ncamera: ${status.cam}\n${lines.slice(-4).join('\n')}`;
}

// ---- scene ---------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2);
scene.add(sun);

// Status panel: text on the left, live camera preview on the right.
const panel = (() => {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 640 });
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const text = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  text.position.x = -0.34;
  group.add(text);

  const preview = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  preview.position.x = 0.21;
  group.add(preview);

  return {
    group, dirty: true,
    setTexture(map, aspect) {
      preview.material.dispose();
      preview.material = new THREE.MeshBasicMaterial({ map });
      preview.scale.set((0.3 * aspect) / 0.4, 1, 1);
    },
    draw() {
      if (!this.dirty) return;
      this.dirty = false;
      ctx.fillStyle = 'rgba(12,14,20,0.82)';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, 36);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 40px system-ui, sans-serif';
      ctx.fillText(`XR ${status.xrFps} fps · camera ${status.camFps} fps`, 36, 66);
      ctx.font = '30px system-ui, sans-serif';
      ctx.fillStyle = '#9fd0ff';
      ctx.fillText(`camera: ${status.cam}`, 36, 116, canvas.width - 72);
      ctx.fillStyle = '#c9ced9';
      ctx.font = '26px ui-monospace, monospace';
      lines.slice(-14).forEach((l, i) => ctx.fillText(l, 36, 168 + i * 32, canvas.width - 72));
      tex.needsUpdate = true;
      drawOverlay();
    },
    // Put the panel ~1.2 m in front of the viewer, upright, facing them.
    placeInFront(viewerPose) {
      const { position: p, orientation: o } = viewerPose.transform;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w));
      fwd.y = 0;
      fwd.normalize();
      group.position.set(p.x + fwd.x * 1.2, p.y - 0.15, p.z + fwd.z * 1.2);
      group.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
      group.visible = true;
    },
  };
})();

// ---- camera probe -----------------------------------------------------------

let stream = null, video = null;

async function probeCamera(where) {
  stopCamera();
  log(`-- camera probe (${where}) --`);
  if (!navigator.mediaDevices?.getUserMedia) {
    status.cam = 'no getUserMedia in this browser';
    return log(status.cam);
  }
  try {
    // Open any camera first: device labels stay empty until permission is granted.
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    cams.forEach((c, i) => log(`cam ${i}: "${c.label || '(no label)'}"`));

    // Prefer an outward-facing passthrough camera.
    const back = cams.find((c) => /back|rear|environment/i.test(c.label));
    const current = stream.getVideoTracks()[0].getSettings().deviceId;
    if (back && back.deviceId !== current) {
      stream.getTracks().forEach((t) => t.stop());
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: back.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } },
      });
    }

    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    status.cam = `"${track.label}" ${s.width}x${s.height} @${s.frameRate ?? '?'}`;
    log(`using ${status.cam}`);

    video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: stream });
    await video.play();
    const vt = new THREE.VideoTexture(video);
    vt.colorSpace = THREE.SRGBColorSpace;
    panel.setTexture(vt, video.videoWidth / video.videoHeight || 4 / 3);
    countCameraFrames(video);
    track.addEventListener('ended', () => log('camera track ended'));
  } catch (err) {
    status.cam = `FAILED: ${err.name}: ${err.message}`;
    log(status.cam);
  }
}

function countCameraFrames(v) {
  if (!v.requestVideoFrameCallback) return log('no requestVideoFrameCallback: camera fps unknown');
  let n = 0, t0 = performance.now();
  const tick = () => {
    if (v !== video) return;   // camera was restarted/stopped
    n++;
    totals.camFrames++;
    const now = performance.now();
    if (now - t0 >= 1000) {
      status.camFps = Math.round((n * 1000) / (now - t0));
      n = 0;
      t0 = now;
      panel.dirty = true;
    }
    v.requestVideoFrameCallback(tick);
  };
  v.requestVideoFrameCallback(tick);
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = video = null;
  status.camFps = 0;
}

// ---- WebXR camera-access (Android Chrome) + AprilTags ---------------------------

let feed = null, tracker = null;
const tagViews = new Map();   // tag id -> { outline, marker }
const camCount = { frames: 0, t0: 0 };

function startXRCamera(session) {
  feed = new XRCameraFeed(renderer, session, { preview: true });
  status.cam = 'WebXR camera-access enabled, waiting for frames';
  log(status.cam);
  feed.onFirstFrame = ({ width, height, capW, capH, K }) => {
    panel.setTexture(feed.previewTexture, width / height);
    status.cam = `WebXR camera-access ${width}x${height}`;
    const f = (v) => v.toFixed(1);
    log(`${status.cam}  fx=${f(K.fx)} fy=${f(K.fy)} cx=${f(K.cx)} cy=${f(K.cy)} · tags at ${capW}x${capH}, ${TAG_SIZE * 1000} mm`);
  };
  tracker = new TagTracker({
    sizeFor: () => TAG_SIZE,
    onFirstSeen: (tag) => {
      const p = new THREE.Vector3().setFromMatrixPosition(tag.pose);
      log(`tag ${tag.id} found at (${p.toArray().map((v) => v.toFixed(2)).join(', ')}) · ${p.distanceTo(camera.position).toFixed(2)} m away`);
    },
  });
  window.__probe.tracker = tracker;
}

function updateCamera(frame, refSpace, now) {
  if (!feed) return;
  const cap = feed.update(frame, refSpace, { wantCapture: tracker.idle });
  if (cap) tracker.submit(cap);
  totals.camFrames = feed.stats.frames;
  if (now - camCount.t0 >= 1000) {
    status.camFps = Math.round(((feed.stats.frames - camCount.frames) * 1000) / (now - camCount.t0));
    camCount.frames = feed.stats.frames;
    camCount.t0 = now;
    panel.dirty = true;
  }
}

// Each tag gets an outline at its raw (latest, full 6-DoF) pose and a gold
// cube sitting on its smoothed, gravity-aligned pose: the outline shows what
// the camera sees, the cube shows what we'd anchor content to.
function updateTagViews(now) {
  if (!tracker) return;
  for (const tag of tracker.tags.values()) {
    let v = tagViews.get(tag.id);
    if (!v) {
      const s = TAG_SIZE / 2;
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-s, 0, -s), new THREE.Vector3(s, 0, -s),
          new THREE.Vector3(s, 0, s), new THREE.Vector3(-s, 0, s)]),
        new THREE.LineBasicMaterial({ color: 0x33ff88 }));
      const marker = new THREE.Group();
      const cube = new THREE.Mesh(new THREE.BoxGeometry(TAG_SIZE * 0.5, TAG_SIZE * 0.5, TAG_SIZE * 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 0.3, roughness: 0.35 }));
      cube.position.y = TAG_SIZE * 0.25;
      const axes = new THREE.AxesHelper(TAG_SIZE * 0.8);
      marker.add(cube, axes);
      for (const o of [outline, marker]) { o.matrixAutoUpdate = false; scene.add(o); }
      v = { outline, marker };
      tagViews.set(tag.id, v);
    }
    v.outline.matrix.copy(tag.raw);
    v.marker.matrix.copy(tag.pose);
    v.outline.material.color.setHex(now - tag.lastSeen < 500 ? 0x33ff88 : 0x557766);   // dim when not seen
  }
}

function stopXRCamera() {
  if (tracker) {
    const st = tracker.stats, n = Math.max(1, st.submitted);
    log(`summary: tags ${st.withTags}/${st.submitted} captures had a tag · detect avg ${(st.workerMs / n).toFixed(0)} ms · readback avg ${(feed.stats.readMs / Math.max(1, feed.stats.captures)).toFixed(1)} ms · image ${st.flipped === null ? 'n/a' : st.flipped ? 'flipped' : 'upright'}`);
    for (const tag of tracker.tags.values()) log(`summary: tag ${tag.id} seen ${tag.seen}×`);
    tracker.dispose();
  }
  for (const v of tagViews.values()) { v.outline.removeFromParent(); v.marker.removeFromParent(); }
  tagViews.clear();
  feed = tracker = null;
}

// ---- cubes ------------------------------------------------------------------

const cubes = [];
window.__probe = { cubes, status, lines };   // read by tests/
const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);

// Screen-center reticle for phones: shows where a tap will place a cube.
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.04, 0.055, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff }));
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

function spawnCube(position) {
  const color = new THREE.Color().setHSL(Math.random(), 0.75, 0.55);
  const cube = new THREE.Mesh(cubeGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  cube.position.copy(position);
  cube.rotation.y = Math.random() * Math.PI * 2;
  scene.add(cube);
  cubes.push(cube);
}

// ---- XR session -------------------------------------------------------------

async function enterAR() {
  // Quest rejects camera-access, so only ask for it elsewhere.
  const optionalFeatures = IS_QUEST
    ? ['hand-tracking']
    : ['camera-access', 'dom-overlay', 'hit-test'];
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local-floor'],
    optionalFeatures,
    ...(!IS_QUEST && { domOverlay: { root: $('overlay') } }),
  });
  const xrPath = chooseXRLayerPath(session);
  telemetry.info('xr layer path', { path: xrPath });
  await renderer.xr.setSession(session);
  const refSpace = renderer.xr.getReferenceSpace();
  log(`session: ${session.environmentBlendMode ?? '?'} blend, features: ${(session.enabledFeatures ?? ['?']).join(', ')}`);

  // Phones: hit-test straight out of the screen center, every frame. Set up
  // in the background: input and rendering must never wait on an optional
  // feature (a hung request here once meant no taps and no panel).
  let hitSource = null;
  if (session.enabledFeatures?.includes('hit-test')) {
    log('hit-test: requesting');
    session.requestReferenceSpace('viewer')
      .then((viewer) => session.requestHitTestSource({ space: viewer }))
      .then((h) => { hitSource = h; log('hit-test: ready, point at a surface'); })
      .catch((err) => log(`hit-test unavailable: ${err.message}`));
  } else {
    log('hit-test: not granted, taps place 40 cm ahead');
  }

  session.addEventListener('selectstart', (e) => {
    if (!e.inputSource.gripSpace) log(`tap (${e.inputSource.targetRayMode})`);
  });
  session.addEventListener('select', (e) => {
    const where = placeIntent(e, refSpace);
    if (!where) return log(`select (${e.inputSource.targetRayMode}): no pose`);
    spawnCube(where.position);
    log(`cube #${cubes.length} ${where.how}`);
  });
  session.addEventListener('squeeze', () => { placePanelNext = true; });   // event frames can't getViewerPose
  $('ov-panel').onclick = () => { placePanelNext = true; };
  $('ov-exit').onclick = () => session.end();
  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    stopCamera();
    stopXRCamera();
    hitSource?.cancel();
    reticle.visible = false;
    const secs = (performance.now() - totals.start) / 1000;
    const rate = (n) => (n / secs).toFixed(1);
    log(`summary: ${secs.toFixed(1)}s · XR avg ${rate(totals.xrFrames)} fps · camera avg ${rate(totals.camFrames)} fps (${totals.camFrames} frames)`);
    if (totals.hitFrames) log(`summary: hit-test had a surface in ${totals.hitHits}/${totals.hitFrames} frames`);
    log('session ended');
  });

  let placed = false; placePanelNext = false;
  Object.assign(totals, { start: performance.now(), xrFrames: 0, camFrames: 0, hitFrames: 0, hitHits: 0 });
  renderChecks.done = 0;
  renderChecks.last = 0;
  let frames = 0, t0 = performance.now(), last = performance.now();
  renderer.setAnimationLoop((t, frame) => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    frames++;
    totals.xrFrames++;
    if (now - t0 >= 1000) {
      status.xrFps = Math.round((frames * 1000) / (now - t0));
      frames = 0;
      t0 = now;
      panel.dirty = true;
    }
    if (frame && (!placed || placePanelNext)) {
      const vp = frame.getViewerPose(refSpace);
      if (vp) { panel.placeInFront(vp); placed = true; placePanelNext = false; }
    }
    if (frame && hitSource) {
      const results = frame.getHitTestResults(hitSource);
      const pose = results[0]?.getPose(refSpace);
      totals.hitFrames++;
      if (results.length) totals.hitHits++;
      if (results.length && !pose) log('hit-test: result but no pose in local-floor');
      if (pose && !reticle.visible && !status.surfaceSeen) { status.surfaceSeen = true; log('hit-test: surface found'); }
      reticle.visible = !!pose;
      if (pose) reticle.matrix.fromArray(pose.transform.matrix);
    }
    for (const c of cubes) c.rotation.y += SPIN_RAD_PER_SEC * dt;
    panel.draw();
    if (frame && renderer.getRenderTarget() === null && !status.targetLost) {
      status.targetLost = true;   // three always sets one in XR; null = we broke it
      log('error: XR render target lost before render: nothing will be visible');
    }
    renderer.render(scene, camera);
    if (frame) updateCamera(frame, refSpace, now);   // after render: GL work + capture
    updateTagViews(now);
    if (frame) renderCheck(frame, now);
  });

  // The actual question: can we see camera frames while immersive-ar runs?
  if (session.enabledFeatures?.includes('camera-access')) startXRCamera(session);
  else probeCamera('inside immersive-ar');
}

// Did anything we drew actually reach the screen? Reads back a few pixels of
// the XR framebuffer right after rendering: the panel starts dead ahead, so
// the center pixel should be its dark background, not transparent (0 alpha).
// A few samples per session, logged to telemetry. Also samples where the
// newest cube projects, if it is on screen.
const renderChecks = { done: 0, last: 0, max: 6, everyMs: 1500 };
function renderCheck(frame, now) {
  if (renderChecks.done >= renderChecks.max || now - renderChecks.last < renderChecks.everyMs) return;
  renderChecks.last = now;
  renderChecks.done++;
  // Two drawing paths: the classic XRWebGLLayer (Quest, emulator) or the
  // WebXR Layers API (Chrome Android), where three renders into a render
  // target backed by the projection layer's texture.
  const layer = frame.session.renderState.baseLayer;
  const target = renderer.getRenderTarget();
  if (!layer && !target) return log('render check: no baseLayer and no render target');
  const W = layer ? layer.framebufferWidth : target.width;
  const H = layer ? layer.framebufferHeight : target.height;
  const xrCamera = renderer.xr.getCamera();
  const at = (x, y) => {
    const px = new Uint8Array(4);
    const cx = Math.max(0, Math.min(W - 1, Math.round(x))), cy = Math.max(0, Math.min(H - 1, Math.round(y)));
    if (layer) renderer.getContext().readPixels(cx, cy, 1, 1, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, px);
    else renderer.readRenderTargetPixels(target, cx, cy, 1, 1, px);
    return [...px].join(',');
  };
  withRawGL(renderer, (gl) => {
  try {
    if (layer) gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    // First view only (phones have one; on Quest this is the left eye). Use
    // its own viewport: views aren't always equal splits (emulators report a
    // zero-width second view for phones).
    const cam = xrCamera.cameras[0] ?? xrCamera;
    const vp = cam.viewport ?? { x: 0, y: 0, z: W, w: H };
    const px = (nx, ny) => at(vp.x + ((nx + 1) / 2) * vp.z, vp.y + ((ny + 1) / 2) * vp.w);
    const parts = [`center ${px(0, 0)}`];
    const last = cubes[cubes.length - 1];
    if (last) {
      const ndc = last.position.clone().project(cam);
      if (Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z <= 1) {
        parts.push(`cube#${cubes.length} ${px(ndc.x, ndc.y)}`);
      } else {
        parts.push(`cube#${cubes.length} off-screen`);
      }
    }
    const err = gl.getError();
    log(`render check: ${layer ? 'baseLayer' : 'layers'} ${W}x${H} ${parts.join(' · ')}${err ? ` · glError ${err}` : ''} · scene ${scene.children.length} objs`);
  } catch (e) {
    log(`render check failed: ${e.message}`);
  }
  });
}

// Where a select should place something, for any input type.
function placeIntent(e, refSpace) {
  const src = e.inputSource;
  if (src.gripSpace) {   // tracked controller: right where it is
    const p = e.frame.getPose(src.gripSpace, refSpace)?.transform.position;
    return p && { position: new THREE.Vector3(p.x, p.y, p.z), how: `at ${src.handedness} controller` };
  }
  if (src.targetRayMode === 'screen' && reticle.visible) {   // phone, surface found
    const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    position.y += CUBE_SIZE / 2;   // sit on the surface, not half inside it
    return { position, how: 'on surface' };
  }
  const pose = e.frame.getPose(src.targetRaySpace, refSpace);   // no surface / hand pinch
  if (!pose) return null;
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(m);
  return {
    position: new THREE.Vector3().setFromMatrixPosition(m).addScaledVector(dir, PHONE_SPAWN_DIST),
    how: `${PHONE_SPAWN_DIST * 100} cm ahead (no surface)`,
  };
}

// ---- boot -------------------------------------------------------------------

// Surface script errors on the panel/overlay: on a phone there's no console.
// (telemetry.js already reports these with stacks; this just shows them.)
window.addEventListener('error', (e) => log(`error: ${e.message}`, { remote: false }));
window.addEventListener('unhandledrejection', (e) => log(`error: ${e.reason?.message ?? e.reason}`, { remote: false }));

let placePanelNext = false;
// Taps on the overlay box must not also fire an XR select (spawning a cube).
// Only the box: the browser stretches the overlay *root* over the whole
// screen, so cancelling there would swallow every tap.
$('ov-box').addEventListener('beforexrselect', (e) => e.preventDefault());
$('version').textContent = PROBE_VERSION;
log(PROBE_VERSION);
log(`device: ${IS_QUEST ? 'Quest Browser' : navigator.userAgent.match(/\(([^)]+)\)/)?.[1] ?? 'unknown'}`);

$('cam2d').onclick = () => probeCamera('2D page');
$('enter').onclick = () => enterAR().catch((err) => log(`enter AR failed: ${err.name}: ${err.message}`));
navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
  if (!ok) {
    $('enter').disabled = true;
    log('immersive-ar not supported here. Open this page in Quest Browser.');
  }
}) ?? log('No WebXR in this browser.');

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;   // XR owns the size; three warns otherwise
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
