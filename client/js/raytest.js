// /raytest: a bare page for tuning the hand ray (DESIGN.md §0). Quest AR with
// hands, nothing else loaded: numbered targets to aim at and pinch, a panel of
// sliders that change the ray live (tilt from the palm, start point, distance
// off the palm, smoothing), stats (hits, how far misses were, how much the ray
// jumps as you pinch), and Save (telemetry + this device) so the chosen values
// can go into js/input/handray.js.
if (new URLSearchParams(location.search).has('emulate')) await import('./emulate.js');
import * as THREE from 'three';
import { chooseXRLayerPath } from './gl.js';
import { HandView } from './ui/hands.js';
import { HAND_RAY, handRay } from './input/handray.js';
import { telemetry } from './telemetry.js';

const SAVE_KEY = 'stratum.raytest';
const DEG = Math.PI / 180;
const JOLT_MS = 150;              // pinch jolt: how far the ray turned over this long before the pinch registered
const POKE_M = 0.015;             // a fingertip this close to the panel pokes it

// The sliders: what they change, their range, how they show.
const SLIDERS = [
  { key: 'tilt', label: 'Angle from the palm', min: 0, max: 90 * DEG, show: (v) => `${Math.round(v / DEG)}°`, hint: '0° straight out of the palm · 90° along the fingers' },
  { key: 'start', label: 'Starts at', min: 0, max: 1, show: (v) => (v < 0.05 ? 'palm' : v > 0.95 ? 'knuckle' : `${Math.round(v * 100)}% to knuckle`), hint: 'palm centre ↔ index knuckle' },
  { key: 'out', label: 'Off the palm', min: 0, max: 0.05, show: (v) => `${(v * 100).toFixed(1)} cm`, hint: 'how far out it starts' },
  { key: 'smooth', label: 'Smoothing', min: 0, max: 0.9, show: (v) => (v < 0.02 ? 'off' : `${Math.round(v * 100)}%`), hint: 'steadier ↔ quicker' },
];
const DEFAULTS = { tilt: HAND_RAY.tilt, start: HAND_RAY.start, out: HAND_RAY.out, smooth: 1 - HAND_RAY.smoothDir };

const params = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SAVE_KEY) ?? '{}') };
const stats = { hits: 0, misses: 0, missDeg: [], jolts: [], perTarget: {} };

// ---- scene -------------------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
scene.add(camera, new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 3, 2);
scene.add(sun);
const hands = new HandView(scene);
const stage = new THREE.Group();   // targets + panel, laid out around where you stood when it started
scene.add(stage);

function canvasPlane(w, h, px = 1024) {
  const canvas = Object.assign(document.createElement('canvas'), { width: px, height: Math.round((px * h) / w) });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return { mesh, draw(fn) { const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); fn(g, canvas.width, canvas.height); tex.needsUpdate = true; } };
}

// Targets: discs at different heights and distances (dx, dy from your eyes, dz ahead), radius r.
const TARGET_SPOTS = [
  { n: 1, at: [-0.45, -0.1, -0.8], r: 0.05 }, { n: 2, at: [0, -0.1, -0.8], r: 0.05 }, { n: 3, at: [0.45, -0.1, -0.8], r: 0.05 },
  { n: 4, at: [-0.35, 0.25, -1.3], r: 0.06 }, { n: 5, at: [0.35, 0.25, -1.3], r: 0.06 },
  { n: 6, at: [-0.7, -0.75, -0.9], r: 0.05 }, { n: 7, at: [0.7, -0.75, -0.9], r: 0.05 },
  { n: 8, at: [0, 0.1, -2.4], r: 0.07 },
];
const targets = TARGET_SPOTS.map((s) => {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(s.r, 40), new THREE.MeshBasicMaterial({ color: 0x364fc7, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(s.r, s.r * 1.12, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  const label = canvasPlane(s.r * 1.3, s.r * 1.3, 256);
  label.draw((c, w, h) => { c.fillStyle = '#fff'; c.font = `800 ${h * 0.62}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(s.n), w / 2, h * 0.55); });
  label.mesh.position.z = 0.001;
  g.add(disc, ring, label.mesh);
  stage.add(g);
  stats.perTarget[s.n] = { hits: 0, misses: 0 };
  return { ...s, group: g, disc, ring, flash: 0, hover: false };
});

// The panel: a desk below your eyes, tilted toward you; sliders + buttons + stats.
const PANEL = { w: 0.5, h: 0.42, at: [0, -0.48, -0.42], tilt: -50 * DEG };
const panel = new THREE.Group();
const back = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), new THREE.MeshBasicMaterial({ color: 0x14171f, transparent: true, opacity: 0.92 }));
panel.add(back);
const face = canvasPlane(PANEL.w, PANEL.h, 1400);
face.mesh.position.z = 0.0015;
panel.add(face.mesh);
stage.add(panel);
// Panel layout (panel-local meters, origin at the centre, +y up the panel).
const TRACK = { x0: -0.2, x1: 0.2, h: 0.03 };
const sliderY = (i) => 0.15 - i * 0.07;
const BUTTONS = [
  { id: 'save', label: 'Save', color: '#2f9e44', x: -0.16 }, { id: 'reset', label: 'Reset stats', color: '#495057', x: 0 },
  { id: 'defaults', label: 'Defaults', color: '#c92a2a', x: 0.16 },
];
const BTN = { y: -0.15, w: 0.13, h: 0.045 };

function drawPanel(flashId = null) {
  face.draw((c, W, H) => {
    const px = (x) => ((x + PANEL.w / 2) / PANEL.w) * W, py = (y) => ((PANEL.h / 2 - y) / PANEL.h) * H, s = W / PANEL.w;
    c.textBaseline = 'middle';
    SLIDERS.forEach((sl, i) => {
      const y = sliderY(i), v = params[sl.key], k = (v - sl.min) / (sl.max - sl.min);
      c.fillStyle = '#e9ecef'; c.font = `600 ${0.017 * s}px system-ui, sans-serif`; c.textAlign = 'left';
      c.fillText(sl.label, px(TRACK.x0), py(y + 0.022));
      c.textAlign = 'right'; c.fillStyle = '#ffd43b'; c.fillText(sl.show(v), px(TRACK.x1), py(y + 0.022));
      c.fillStyle = '#343a40'; c.beginPath(); c.roundRect(px(TRACK.x0), py(y + 0.005), (TRACK.x1 - TRACK.x0) * s, 0.01 * s, 0.005 * s); c.fill();
      c.fillStyle = '#4c6ef5'; c.beginPath(); c.roundRect(px(TRACK.x0), py(y + 0.005), k * (TRACK.x1 - TRACK.x0) * s, 0.01 * s, 0.005 * s); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(px(TRACK.x0 + k * (TRACK.x1 - TRACK.x0)), py(y), 0.012 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#868e96'; c.font = `${0.012 * s}px system-ui, sans-serif`; c.textAlign = 'left';
      c.fillText(sl.hint, px(TRACK.x0), py(y - 0.02));
    });
    for (const b of BUTTONS) {
      c.fillStyle = flashId === b.id ? '#fff' : b.color; c.beginPath();
      c.roundRect(px(b.x - BTN.w / 2), py(BTN.y + BTN.h / 2), BTN.w * s, BTN.h * s, 0.01 * s); c.fill();
      c.fillStyle = flashId === b.id ? '#000' : '#fff'; c.font = `700 ${0.016 * s}px system-ui, sans-serif`; c.textAlign = 'center';
      c.fillText(b.label, px(b.x), py(BTN.y));
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    c.fillStyle = '#ced4da'; c.font = `${0.013 * s}px system-ui, sans-serif`; c.textAlign = 'left';
    c.fillText(`Hits ${stats.hits} · misses ${stats.misses}${stats.missDeg.length ? ` (off by ${avg(stats.missDeg).toFixed(1)}° on average)` : ''} · pinch jolt ${avg(stats.jolts).toFixed(1)}°`, px(-0.23), py(-0.193));
  });
}

// ---- layout: around you, where you stood when it started --------------------------------------------

function layout(head) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
  stage.position.set(head.position.x, 0, head.position.z);
  stage.rotation.y = Math.atan2(-fwd.x, -fwd.z);
  const eyeY = head.position.y;
  for (const t of targets) {
    t.group.position.set(t.at[0], eyeY + t.at[1], t.at[2]);
    t.group.lookAt(stage.localToWorld(new THREE.Vector3(0, eyeY, 0)));
  }
  panel.position.set(PANEL.at[0], eyeY + PANEL.at[1], PANEL.at[2]);
  panel.rotation.x = PANEL.tilt;
  stage.updateMatrixWorld(true);
}

// ---- rays ------------------------------------------------------------------------------------------

const rays = {};
for (const side of ['left', 'right']) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: side === 'right' ? 0x74c0fc : 0xb197fc, transparent: true, opacity: 0.9 }));
  line.matrixAutoUpdate = false;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 1200;
  scene.add(line, dot);
  rays[side] = { line, dot, ray: null, history: [], held: null };
}

const raycaster = new THREE.Raycaster();
function aimHit(ray) {
  raycaster.set(ray.origin, ray.dir);
  const pick = [...targets.map((t) => t.disc), back];
  const hit = raycaster.intersectObjects(pick, false)[0];
  if (!hit) return null;
  if (hit.object === back) return { kind: 'panel', point: hit.point, local: panel.worldToLocal(hit.point.clone()) };
  return { kind: 'target', target: targets.find((t) => t.disc === hit.object), point: hit.point };
}

function updateRays(now) {
  for (const side of ['left', 'right']) {
    const r = rays[side], h = hands.hands[side];
    if (!h.tracked) { r.ray = null; r.line.visible = r.dot.visible = false; continue; }
    const use = r.heldParams ?? params;   // (dragging a slider with this ray: it keeps the shape it had, or it would chase itself)
    const raw = handRay(h.pos, h.palm, use), k = 1 - use.smooth;
    if (r.ray && now - r.t < 200) { r.ray.dir.lerp(raw.dir, k).normalize(); r.ray.origin.lerp(raw.origin, Math.min(1, k + 0.15)); }
    else r.ray = { origin: raw.origin, dir: raw.dir };
    r.t = now;
    r.history.push({ t: now, dir: r.ray.dir.clone() });
    while (r.history.length && now - r.history[0].t > 600) r.history.shift();
    r.hit = aimHit(r.ray);
    const len = r.hit ? r.hit.point.distanceTo(r.ray.origin) : 3;
    r.line.matrix.lookAt(r.ray.origin, r.ray.origin.clone().add(r.ray.dir), new THREE.Vector3(0, 1, 0)).setPosition(r.ray.origin);
    r.line.matrix.scale(new THREE.Vector3(1, 1, len));
    r.line.matrixWorldNeedsUpdate = true;
    r.line.visible = true;
    r.dot.visible = !!r.hit;
    if (r.hit) r.dot.position.copy(r.hit.point);
  }
  for (const t of targets) t.hover = ['left', 'right'].some((s) => rays[s].hit?.target === t);
}

// ---- input: pinches (the headset's select events) and fingertip pokes ------------------------------

function setFromPanel(key, local) {
  const sl = SLIDERS.find((s) => s.key === key), k = THREE.MathUtils.clamp((local.x - TRACK.x0) / (TRACK.x1 - TRACK.x0), 0, 1);
  params[key] = sl.min + k * (sl.max - sl.min);
  drawPanel();
}

// What's under a panel-local point: a slider (by key) or a button.
function panelPart(local) {
  for (let i = 0; i < SLIDERS.length; i++) if (Math.abs(local.y - sliderY(i)) < TRACK.h / 2 + 0.008 && local.x > TRACK.x0 - 0.02 && local.x < TRACK.x1 + 0.02) return { slider: SLIDERS[i].key };
  for (const b of BUTTONS) if (Math.abs(local.x - b.x) < BTN.w / 2 && Math.abs(local.y - BTN.y) < BTN.h / 2) return { button: b.id };
  return null;
}

function pressButton(id) {
  if (id === 'save') save();
  else if (id === 'reset') { Object.assign(stats, { hits: 0, misses: 0, missDeg: [], jolts: [] }); for (const k in stats.perTarget) stats.perTarget[k] = { hits: 0, misses: 0 }; }
  else if (id === 'defaults') Object.assign(params, DEFAULTS);
  drawPanel(id);
  setTimeout(() => drawPanel(), 180);
}

function save() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(params));
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
  telemetry.info('raytest saved', {
    tiltDeg: +(params.tilt / DEG).toFixed(1), start: +params.start.toFixed(2), outCm: +(params.out * 100).toFixed(1), smooth: +params.smooth.toFixed(2),
    hits: stats.hits, misses: stats.misses, missDeg: avg(stats.missDeg), joltDeg: avg(stats.jolts), perTarget: stats.perTarget,
  });
}

function onPinch(side, now) {
  const r = rays[side];
  if (!r.ray) return;
  // How far the ray swung while the fingers came together (the pinch registers at the end of it).
  const before = r.history.find((h) => now - h.t <= JOLT_MS + 20) ?? r.history[0];
  if (before) stats.jolts.push(before.dir.angleTo(r.ray.dir) / DEG);
  const hit = r.hit;
  if (hit?.kind === 'panel') {
    const part = panelPart(hit.local);
    if (part?.slider) { r.held = part.slider; r.heldParams = { ...params }; setFromPanel(part.slider, hit.local); }
    else if (part?.button) pressButton(part.button);
    return;
  }
  if (hit?.kind === 'target') {
    stats.hits++; stats.perTarget[hit.target.n].hits++;
    hit.target.flash = now;
  } else {
    // A miss: which target did you mean (the nearest by angle), and by how much.
    let best = null;
    for (const t of targets) {
      const to = t.group.getWorldPosition(new THREE.Vector3()).sub(r.ray.origin);
      const a = to.angleTo(r.ray.dir) / DEG - Math.atan(t.r / to.length()) / DEG;
      if (!best || a < best.a) best = { t, a };
    }
    if (best && best.a < 20) { stats.misses++; stats.perTarget[best.t.n].misses++; stats.missDeg.push(Math.max(0, best.a)); best.t.missAt = now; }
  }
  drawPanel();
}

function onRelease(side) { rays[side].held = null; rays[side].heldParams = null; }

// Fingertips poke the panel: a slider follows the fingertip, a button presses once.
const pokes = { left: null, right: null };
function updatePokes() {
  for (const side of ['left', 'right']) {
    const h = hands.hands[side];
    if (!h.tracked) { pokes[side] = null; continue; }
    const local = panel.worldToLocal(h.pos[9].clone());
    const on = local.z < POKE_M && local.z > -0.04 && Math.abs(local.x) < PANEL.w / 2 && Math.abs(local.y) < PANEL.h / 2;
    if (!on) { pokes[side] = null; continue; }
    const part = panelPart(local);
    if (part?.slider) setFromPanel(part.slider, local);
    else if (part?.button && pokes[side] !== part.button) pressButton(part.button);
    pokes[side] = part?.button ?? part?.slider ?? 'panel';
  }
  // A pinch held on a slider drags it along with the ray.
  for (const side of ['left', 'right']) {
    const r = rays[side];
    if (r.held && r.hit?.kind === 'panel') setFromPanel(r.held, r.hit.local);
  }
}

function drawTargets(now) {
  for (const t of targets) {
    const flash = Math.max(0, 1 - (now - t.flash) / 400), miss = Math.max(0, 1 - (now - (t.missAt ?? -1e9)) / 400);
    t.disc.material.color.setHex(flash > 0 ? 0x2f9e44 : miss > 0 ? 0xc92a2a : t.hover ? 0x5c7cfa : 0x364fc7);
    t.group.scale.setScalar(1 + flash * 0.15 + (t.hover ? 0.05 : 0));
  }
}

// ---- session --------------------------------------------------------------------------------------

let laidOut = false;
renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  if (frame) {
    const ref = renderer.xr.getReferenceSpace(), session = renderer.xr.getSession();
    const viewer = frame.getViewerPose(ref);
    const head = viewer && { position: new THREE.Vector3().copy(viewer.transform.position), quaternion: new THREE.Quaternion().copy(viewer.transform.orientation) };
    if (head && !laidOut) { layout(head); laidOut = true; drawPanel(); }
    hands.update(frame, ref, session.inputSources, head?.position);
    updateRays(now);
    updatePokes();
    drawTargets(now);
  }
  renderer.render(scene, camera);
});

const enter = document.getElementById('enter'), note = document.getElementById('note');
const supported = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false);
enter.disabled = !supported;
enter.textContent = supported ? 'Start' : 'Needs a headset (WebXR AR)';
if (!supported) note.textContent = 'Open this page in the Quest browser.';
enter.addEventListener('click', async () => {
  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
  const xrPath = chooseXRLayerPath(session);
  telemetry.info('xr layer path', { path: xrPath });
  await renderer.xr.setSession(session);
  laidOut = false;
  session.addEventListener('selectstart', (e) => { if (e.inputSource.hand) onPinch(e.inputSource.handedness, performance.now()); });
  session.addEventListener('selectend', (e) => { if (e.inputSource.hand) onRelease(e.inputSource.handedness); });
  session.addEventListener('end', () => { save(); });
  telemetry.info('raytest start', { ...params });
});

window.__raytest = { params, stats, targets, rays, panel, sliderY, TRACK, BTN, BUTTONS, setFromPanel, pressButton, drawPanel, onPinch };   // test hook
