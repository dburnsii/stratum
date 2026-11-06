// Gesture trainer (/train; DESIGN.md §0 "Gesture trainer"). Two modes, picked
// on the page or in the headset (the strip's Mode button goes back to the choice):
// Train records labelled takes; Test runs the live detectors (ui/revelio.js
// HandGestures) on 5 tries of each and scores them (labels source 'test', with
// result 'hit' | 'miss' | 'wrong' | 'false' | 'pass').
//
// Train: asks for each
// gesture REPS times, right hand only (gestures are mirrored), with the thing
// it acts on in view. Each take: a count of 3, then GO windows, one per
// stage (shoo: select, then throw or cancel). Hands + head are recorded
// (js/handrec.js) and every stage window is a label in that recording:
//   { kind: 'label', source: 'trainer', gesture, stage, side, rep, step, phase: 'start' | 'end' | 'discard' | 'abort' }
// Between takes: Redo last (discards it), Pause, Skip (poke, or aim + pinch).
if (new URLSearchParams(location.search).has('emulate')) await import('./emulate.js');
import * as THREE from 'three';
import { chooseXRLayerPath } from './gl.js';
import { HandView } from './ui/hands.js';
import { HAND_RAY, handRay } from './input/handray.js';
import { HandRecorder } from './handrec.js';
import { HandGestures } from './ui/revelio.js';
import { beep, unlock } from './ui/sound.js';
import { telemetry } from './telemetry.js';
import { deviceId } from './util.js';

const VERSION = 'trainer v1';
telemetry.setVersion(VERSION);
export const REPS = 5;
const COUNT_MS = 700, REST_MS = 1200, INTRO_MS = 2500;
const INDEX_TIP = 9;

// Steps: each a gesture, done REPS times; a take is its stages one after another.
export const STEPS = [
  { id: 'revelio', title: '✨ Revelio', target: null, stages: [{ stage: 'cast', text: 'Open hand, palm away: slide it to the right', ms: 2500 }] },
  { id: 'shoo', title: '💨 Shoo the cube', target: 'cube', reach: 'cube', stages: [
    { stage: 'select', text: 'Fingertips together ON the cube, hold', ms: 2000 },
    { stage: 'throw', text: 'Now open while turning clockwise', ms: 1800 }] },
  { id: 'shoo-cancel', gesture: 'shoo', title: '💨 Shoo, then cancel', target: 'cube', reach: 'cube', stages: [
    { stage: 'select', text: 'Fingertips together ON the cube, hold', ms: 2000 },
    { stage: 'cancel', text: 'Open your fingers without turning', ms: 1800 }] },
  { id: 'back', title: '👌 Bring back the glow', target: 'glow', reach: 'aim', stages: [
    { stage: 'select', text: 'Aim at the glow: fingertips together', ms: 2000 },
    { stage: 'spread', text: 'Spread them open', ms: 1500 }] },
  { id: 'flip', title: '🪩 Pinball flip', target: 'button', reach: 'button', stages: [
    { stage: 'press', text: 'Hand by the red button: curl your fingers in, hold', ms: 2000 },
    { stage: 'release', text: 'Straighten them', ms: 1200 }] },
  { id: 'keyboard', title: '⌨️ Keyboard', side: 'both', target: null, stages: [{ stage: 'summon', text: 'Both index fingers point down, hold', ms: 2500 }] },
  { id: 'menu', title: '🖐 Palm menu (left hand)', side: 'left', target: null, stages: [
    { stage: 'open', text: 'Turn your LEFT palm to face you', ms: 1800 },
    { stage: 'close', text: 'Turn it away again', ms: 1500 }] },
  { id: 'none', title: '🚫 Nothing', target: 'cube', stages: [{ stage: 'none', text: 'Move your hand around naturally: no gesture', ms: 4000 }] },
];

// Test mode: one try window each; `expect` is the detector event that counts as recognized
// ('cancel': a spread with no shoo by the end; null: nothing may fire at all).
export const TEST_STEPS = [
  { id: 'revelio', title: '✨ Revelio', expect: 'cast', target: null, stages: [{ stage: 'try', text: 'Do a Revelio: open hand, palm away, slide it right', ms: 5000 }] },
  { id: 'shoo', title: '💨 Shoo the cube', expect: 'shoo', target: 'cube', reach: 'cube', stages: [{ stage: 'try', text: 'Fingertips together on it, then open while turning clockwise', ms: 5000 }] },
  { id: 'shoo-cancel', gesture: 'shoo', title: '💨 Pick, then cancel', expect: 'cancel', target: 'cube', reach: 'cube', stages: [{ stage: 'try', text: 'Fingertips together on it, then open WITHOUT turning', ms: 5000 }] },
  { id: 'back', title: '👌 Bring back the glow', expect: 'spread', target: 'glow', reach: 'aim', stages: [{ stage: 'try', text: 'Aim at the glow: fingertips together, then spread', ms: 5000 }] },
  { id: 'none', title: '🚫 Nothing', expect: null, target: 'cube', stages: [{ stage: 'try', text: 'Move naturally: reach, wave, point, grab. Nothing should fire', ms: 10000 }] },
];

// ---- scene --------------------------------------------------------------------------------------------

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
const stage = new THREE.Group();   // panel + targets, laid out where you stood when it started
scene.add(stage);

const PANEL_W = 0.5, PANEL_H = 0.3;
const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: Math.round(1024 * PANEL_H / PANEL_W) });
const tex = new THREE.CanvasTexture(canvas);
tex.colorSpace = THREE.SRGBColorSpace;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
stage.add(panel);
// Redo / Pause / Skip: a strip within reach, low on your left (the panel is too far to poke).
const CTRL_W = 0.3, CTRL_H = 0.065;
const ctrlCanvas = Object.assign(document.createElement('canvas'), { width: 1200, height: Math.round(1200 * CTRL_H / CTRL_W) });
const ctrlTex = new THREE.CanvasTexture(ctrlCanvas);
ctrlTex.colorSpace = THREE.SRGBColorSpace;
const controls = new THREE.Mesh(new THREE.PlaneGeometry(CTRL_W, CTRL_H), new THREE.MeshBasicMaterial({ map: ctrlTex, transparent: true }));
stage.add(controls);
const RUN_BUTTONS = [   // (canvas px)
  { id: 'redo', label: '↺ Redo', x: 10, w: 285, color: '#e8590c' },
  { id: 'pause', label: '⏸ Pause', x: 305, w: 285, color: '#1c7ed6' },
  { id: 'skip', label: '⏭ Skip', x: 600, w: 285, color: '#495057' },
  { id: 'mode', label: '⇄ Mode', x: 895, w: 295, color: '#862e9c' },
];
const CHOOSE_BUTTONS = [
  { id: 'train', label: '🎯 Train', x: 10, w: 585, color: '#2b8a3e' },
  { id: 'test', label: '🧪 Test', x: 605, w: 585, color: '#1971c2' },
];
const buttons = () => (run.mode === 'choose' ? CHOOSE_BUTTONS : RUN_BUTTONS);
const BTN_Y = 10, BTN_H = ctrlCanvas.height - 20;
const REACH_CUBE_M = 0.09, REACH_BUTTON_M = 0.12, REACH_HOLD_MS = 250;

// Hand rays (the main app's, js/input/handray.js): a beam + dot while one points at the buttons; a pinch presses.
const rays = Object.fromEntries(['left', 'right'].map((side) => {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd43b, depthTest: false }));
  line.matrixAutoUpdate = false;
  line.visible = dot.visible = false;
  dot.renderOrder = 10;
  scene.add(line, dot);
  return [side, { line, dot, ray: null, t: 0, on: null }];
}));

const cube = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0x4dabf7, roughness: 0.5, transparent: true }));
const button = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 24).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc92a2a, emissive: 0x000000 }));
stage.add(cube, button);
const home = { cube: new THREE.Vector3(), button: new THREE.Vector3() };

function layout(head) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion).setY(0).normalize();
  const yaw = Math.atan2(-fwd.x, -fwd.z);
  stage.position.copy(head.position).setY(0);
  stage.rotation.set(0, yaw, 0);
  const eye = head.position.y;
  panel.position.set(0, eye + 0.02, -0.75);
  controls.position.set(-0.2, eye - 0.38, -0.38);
  stage.updateMatrixWorld(true);
  controls.lookAt(stage.localToWorld(new THREE.Vector3(0, eye, 0)));   // tilted up to face you
  home.cube.set(0.1, eye - 0.3, -0.42);
  home.button.set(0.2, eye - 0.55, -0.25);   // by your right side, low: where a pinball cabinet's button is
  cube.position.copy(home.cube);
  button.position.copy(home.button);
}

// ---- the session ----------------------------------------------------------------------------------------

const rec = new HandRecorder({ version: VERSION, device: deviceId(), context: () => ({ page: 'trainer', step: cur()?.id ?? null, rep: run.rep }) });
const run = { i: 0, rep: 0, mode: 'idle', k: 0, t0: 0, until: 0, paused: null, done: [], count: 0, kind: 'train', score: {} };
let steps = STEPS;
const cur = () => steps[run.i];
const sideOf = (s) => s.side ?? 'right';

function label(phase, extra = {}) {
  const s = cur(), st = s.stages[run.k];
  rec.event('label', { source: run.kind === 'test' ? 'test' : 'trainer', gesture: s.gesture ?? s.id, stage: st?.stage ?? null, side: sideOf(s), rep: run.rep + 1, take: run.take, step: s.id, phase, ...extra });
}

function setMode(mode, now, ms = 0) { Object.assign(run, { mode, t0: now, until: now + ms }); draw(now); }

// kind: 'train' | 'test'; null: the choice (Train / Test buttons).
export function begin(now = performance.now(), kind = 'train') {
  if (!kind) { setMode('choose', now); return; }
  steps = kind === 'test' ? TEST_STEPS : STEPS;
  Object.assign(run, { kind, i: 0, rep: 0, k: 0, done: [], count: 0, score: {}, result: null });
  telemetry.info('trainer start', { kind, steps: steps.length, reps: REPS });
  setMode('intro', now, INTRO_MS);
  react('start', null);
}

function tick(now) {
  if (run.mode === 'idle' || run.mode === 'paused' || run.mode === 'done' || run.mode === 'choose') return;
  if (run.mode === 'reach') {
    if (!reached()) { run.reachSince = 0; return; }
    run.reachSince ||= now;
    if (now - run.reachSince >= REACH_HOLD_MS) { label('ready', { waitedMs: Math.round(now - run.t0) }); run.reachSince = 0; startStage(now); }
    return;
  }
  if (run.mode === 'count') {
    const n = 3 - Math.floor((now - run.t0) / COUNT_MS);
    if (n !== run.shown) { run.shown = n; if (n > 0) beep(660, 90); draw(now); }
  } else if (run.mode === 'go' && now - (run.drawnAt ?? 0) > 100) draw(now);
  if (now < run.until) return;
  if (run.mode === 'intro' || run.mode === 'rest') {
    run.k = 0; run.shown = null;
    run.take = (run.take ?? 0) + 1;   // (unique in the session: a redo is a new take; a discard names the bad one)
    setMode('count', now, COUNT_MS * 3);
  } else if (run.mode === 'count') {
    if (cur().reach) setMode('reach', now, Infinity);   // the hand gets to the thing first: the reach isn't part of the take
    else startStage(now);
  } else if (run.mode === 'go') {
    if (run.kind === 'test') { endTry(now, verdict(true)); return; }
    label('end');
    if (++run.k < cur().stages.length) { startStage(now); return; }
    finishTake(now);
  }
}

// ---- test mode: the detectors on each try ----

// Every frame of a try: the detector sees both hands; the right hand's events decide (any hand's, for "nothing").
function detect(now) {
  if (run.kind !== 'test' || run.mode !== 'go') return;
  const gaze = lastHead ? new THREE.Vector3(0, 0, -1).applyQuaternion(lastHead.quaternion) : null;
  for (const side of ['left', 'right']) {
    const joints = hands.tracked[side] ? hands.hands[side].pos : null;
    for (const ev of run.det.update(side, joints, lastHead?.position ?? null, now, gaze)) seen(ev, now);
  }
}

// A detector event during a try (also from tests: __trainer.seen).
function seen(ev, now = performance.now()) {
  if (run.kind !== 'test' || run.mode !== 'go') return;
  rec.event('detector', { ...ev, test: cur().id, take: run.take });
  if (ev.type === 'near') { run.near = ev.why; return; }
  run.events.push(ev);
  const v = verdict(false);
  if (v) endTry(now, v);
}

// The try's result: { result, why }; at the end of the window (final) or as soon as it's certain.
function verdict(final) {
  const e = cur().expect, ev = run.events, right = ev.filter((x) => x.side === 'right');
  const has = (t, list = right) => list.some((x) => x.type === t);
  if (e === null) return has('cast', ev) || has('shoo', ev) ? { result: 'false', why: ev.find((x) => x.type === 'cast' || x.type === 'shoo').type } : final ? { result: 'pass' } : null;
  if (e === 'cancel') {
    if (has('shoo')) return { result: 'wrong', why: 'shoo (it threw)' };
    return final ? (has('spread') ? { result: 'hit' } : { result: 'miss', why: has('gather') ? 'picked, never opened' : 'never picked' }) : null;
  }
  if (has(e)) return { result: 'hit' };
  if (e === 'spread' && has('shoo')) return { result: 'wrong', why: 'shoo' };
  if (!final) return null;
  const why = e === 'cast' ? (run.near ?? 'no slide seen') : has('gather') ? (e === 'shoo' ? 'picked, no turn seen' : 'picked, no spread seen') : 'fingertips never together';
  return { result: 'miss', why };
}

function endTry(now, v) {
  const ms = Math.round(now - run.t0);
  label('end', { result: v.result, why: v.why ?? null, ms });
  const sc = (run.score[cur().id] ??= { ok: 0, n: 0 });
  sc.n++;
  if (v.result === 'hit' || v.result === 'pass') sc.ok++;
  run.result = { ...v, ms };
  telemetry.info('trainer test', { step: cur().id, ...v, ms });
  beep(v.result === 'hit' || v.result === 'pass' ? 988 : 220, 220);
  finishTake(now, true);
}

// The right hand at the cube (fingertips' middle), aiming at the glow, or by the button.
function reached() {
  if (window.__trainer?.forceReach) return true;   // (tests)
  const h = hands.hands.right;
  if (!hands.tracked.right || !h) return false;
  const kind = cur().reach;
  if (kind === 'button') return h.pos[0].clone().lerp(h.pos[10], 0.5).distanceTo(button.getWorldPosition(new THREE.Vector3())) < REACH_BUTTON_M;
  const c = cube.getWorldPosition(new THREE.Vector3());
  const tips = [4, 9, 14, 19, 24].reduce((v, i) => v.add(h.pos[i]), new THREE.Vector3()).multiplyScalar(0.2);
  if (tips.distanceTo(c) < REACH_CUBE_M) return true;
  if (kind !== 'aim' || !rays.right.ray) return false;
  const r = rays.right.ray, along = c.clone().sub(r.origin).dot(r.dir);
  return along > 0 && r.origin.clone().addScaledVector(r.dir, along).distanceTo(c) < 0.08;   // pointing at it
}

function startStage(now) {
  const st = cur().stages[run.k];
  if (run.kind === 'test') Object.assign(run, { det: new HandGestures(), events: [], near: null, result: null });
  label('start', { ms: st.ms });
  beep(run.k ? 1318 : 1046, 140);
  setMode('go', now, st.ms);
  react('start', st.stage);
}

function finishTake(now, quiet = false) {
  if (!quiet) beep(523, 150);
  run.count++;
  run.done.push({ step: cur().id, rep: run.rep + 1, take: run.take, result: run.kind === 'test' ? run.result?.result : null });
  telemetry.info('trainer take', { step: cur().id, rep: run.rep + 1 });
  react('end', cur().stages.at(-1).stage);
  if (++run.rep >= REPS) nextStep(now); else setMode('rest', now, REST_MS);
}

function nextStep(now) {
  run.rep = 0;
  if (++run.i >= steps.length) { run.i = steps.length - 1; telemetry.info('trainer done', { kind: run.kind, takes: run.count, ...(run.kind === 'test' && { score: run.score }) }); setMode('done', now); beep(784, 300); return; }
  setMode('intro', now, INTRO_MS);
}

// Between takes only (a pinch mid-gesture mustn't press anything).
export function press(id, now = performance.now()) {
  if (run.mode === 'go') return false;
  if (run.mode === 'choose') {
    if (id !== 'train' && id !== 'test') return false;
    begin(now, id);
  } else if (id === 'mode') {
    telemetry.info('trainer mode', { from: run.kind, at: cur()?.id });
    begin(now, null);
  } else if (id === 'redo') {
    const last = run.done.pop();
    if (!last) return false;
    if (steps[run.i].id !== last.step) { run.i = steps.findIndex((s) => s.id === last.step); }
    run.rep = last.rep - 1;
    run.count--;
    if (last.result) { const sc = run.score[last.step]; sc.n--; if (last.result === 'hit' || last.result === 'pass') sc.ok--; }
    rec.event('label', { source: run.kind === 'test' ? 'test' : 'trainer', step: last.step, gesture: steps[run.i].gesture ?? last.step, stage: null, side: sideOf(steps[run.i]), rep: last.rep, take: last.take, phase: 'discard' });
    telemetry.info('trainer redo', last);
    setMode('rest', now, REST_MS);
  } else if (id === 'pause') {
    if (run.mode === 'paused') { setMode(run.paused ?? 'rest', now, REST_MS); run.paused = null; }
    else if (run.mode !== 'done') { run.paused = run.mode === 'count' ? 'rest' : run.mode; setMode('paused', now); }
  } else if (id === 'skip') {
    if (run.mode === 'done') return false;
    telemetry.info('trainer skip', { step: cur().id, at: run.rep });
    nextStep(now);
  } else return false;
  beep(880, 60);
  return true;
}

// What the targets do: the cube flies off when thrown, glows to be brought back, the button lights.
function react(when, st) {
  const s = cur();
  if (!s) return;
  cube.visible = s.target === 'cube' || s.target === 'glow';
  button.visible = s.target === 'button';
  cube.material.emissive?.setHex(s.target === 'glow' ? 0x5f3dc4 : 0x000000);
  if (when === 'end' && st === 'throw') { run.fly = performance.now(); }
  if (when === 'start' && st === 'press') button.material.emissive.setHex(0x662222);
  if (when === 'start' && st === 'release') button.material.emissive.setHex(0x000000);
}

function animate(now) {
  const fly = run.fly ? (now - run.fly) / 900 : 1;
  if (fly < 1) {
    cube.position.copy(home.cube).add(new THREE.Vector3(fly * 0.6, fly * 0.25, -fly * 0.3));
    cube.material.opacity = 1 - fly;
  } else { cube.position.copy(home.cube); cube.material.opacity = 1; run.fly = 0; }
  if (run.mode === 'choose') cube.visible = button.visible = false;
  if (cur()?.target === 'glow') cube.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(now / 200);
}

// ---- the panel ---------------------------------------------------------------------------------------------

function draw(now = performance.now()) {
  run.drawnAt = now;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height, s = cur();
  const go = run.mode === 'go', st = s.stages[run.k], test = run.kind === 'test';
  g.clearRect(0, 0, W, H);
  if (run.mode === 'choose') {
    g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fillStyle = 'rgba(18,20,28,0.94)'; g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'top'; g.font = '800 72px system-ui, sans-serif';
    g.fillText('Train or test?', 32, 40);
    g.font = '600 30px system-ui, sans-serif';
    wrap(g, '🎯 Train: record labelled takes of each gesture, 5 each, for a gesture model.', 32, 150, W - 64, 40);
    wrap(g, '🧪 Test: try each gesture 5 times and see whether today\'s detectors catch it, how fast, and why not.', 32, 250, W - 64, 40);
    g.font = '500 24px system-ui, sans-serif'; g.fillStyle = '#868e96';
    g.fillText('Pick on the buttons low on your left (poke, or aim and pinch)', 32, H - 64);
    tex.needsUpdate = true;
    drawControls();
    return;
  }
  const tone = run.mode === 'rest' && test && run.result ? (run.result.result === 'hit' || run.result.result === 'pass' ? '#2b8a3e' : '#c92a2a') : null;
  g.beginPath(); g.roundRect(0, 0, W, H, 28); g.fillStyle = tone ?? (go ? (test ? '#1864ab' : '#2b8a3e') : 'rgba(18,20,28,0.94)'); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'top';
  g.font = '600 30px system-ui, sans-serif';
  g.fillText(run.mode === 'done' ? 'All done' : `${s.title} · ${Math.min(run.rep + 1, REPS)} / ${REPS}${s.side === 'left' ? '' : s.side === 'both' ? ' · both hands' : ' · right hand'}`, 32, 26);
  g.font = '500 22px system-ui, sans-serif'; g.fillStyle = '#adb5bd';
  g.fillText(`${test ? '🧪 Test' : '🎯 Train'} · step ${run.i + 1} of ${steps.length} · ${run.count} ${test ? 'tries' : 'takes'}`, 32, 66);
  g.fillStyle = '#fff';
  let big = '', small = '';
  if (run.mode === 'intro') { big = s.title; small = s.stages.map((x, i) => `${i + 1}. ${x.text}`).join('   '); }
  else if (run.mode === 'count') { big = `${Math.max(1, run.shown ?? 3)}`; small = s.reach ? `${REACH_TEXT[s.reach]}, then: ${s.stages[0].text}` : `Get ready: ${s.stages[0].text}`; }
  else if (run.mode === 'reach') { big = REACH_TEXT[s.reach]; small = 'GO starts once you\'re there'; }
  else if (go) { big = s.stages.length > 1 ? `${st.stage.toUpperCase()}` : 'GO'; small = st.text; }
  else if (run.mode === 'rest' && test && run.result) {
    const ok = run.result.result === 'hit' || run.result.result === 'pass';
    big = ok ? (run.result.result === 'pass' ? '✓ Nothing fired' : `✓ Caught · ${(run.result.ms / 1000).toFixed(1)} s`) : run.result.result === 'false' ? `✗ ${run.result.why} fired` : `✗ ${run.result.result === 'wrong' ? 'Wrong' : 'Missed'}`;
    small = ok ? 'Next try in a moment' : `${run.result.why ?? ''} · Redo if the try itself was off`;
  }
  else if (run.mode === 'rest') { big = 'Good'; small = 'Next take in a moment · Redo last if that one was off'; }
  else if (run.mode === 'paused') { big = 'Paused'; small = 'Pause again to go on'; }
  else if (run.mode === 'done' && test) { big = 'Score'; small = steps.map((x) => `${x.title}: ${run.score[x.id]?.ok ?? 0} / ${run.score[x.id]?.n ?? 0}`).join('   ·   '); }
  else if (run.mode === 'done') { big = `${run.count} takes recorded`; small = 'Thanks! Exit, Redo last, or Mode to test'; }
  g.font = `800 ${big.length > 14 ? 54 : 96}px system-ui, sans-serif`;
  g.fillText(big, 32, 110);
  g.font = '600 28px system-ui, sans-serif';
  wrap(g, small, 32, 230, W - 64, 36);
  if (go) {   // time left in this stage
    const k = Math.min(1, (now - run.t0) / (run.until - run.t0));
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(32, H - 60, W - 64, 12);
    g.fillStyle = '#ffd43b'; g.fillRect(32, H - 60, (W - 64) * (1 - k), 12);
  } else {
    g.font = '500 24px system-ui, sans-serif'; g.fillStyle = '#868e96';
    g.fillText('Redo · Pause · Skip · Mode: the buttons low on your left (poke, or aim and pinch)', 32, H - 64);
  }
  tex.needsUpdate = true;
  drawControls();
}

const REACH_TEXT = { cube: 'Hand to the cube', aim: 'Aim at the glow', button: 'Hand by the red button' };

function drawControls() {
  const g = ctrlCanvas.getContext('2d'), go = run.mode === 'go';
  g.clearRect(0, 0, ctrlCanvas.width, ctrlCanvas.height);
  for (const b of buttons()) {
    const off = go || (b.id === 'redo' && !run.done.length);
    g.beginPath(); g.roundRect(b.x, BTN_Y, b.w, BTN_H, 24);
    g.fillStyle = off ? '#343a40' : b.color; g.fill();
    g.fillStyle = off ? '#868e96' : '#fff'; g.font = '700 64px system-ui, sans-serif'; g.textBaseline = 'middle';
    g.fillText(b.id === 'pause' && run.mode === 'paused' ? '▶ Go on' : b.label, b.x + 28, BTN_Y + BTN_H / 2);
    g.textBaseline = 'top';
    if (['left', 'right'].some((sd) => rays[sd].on === b.id) && !off) { g.lineWidth = 10; g.strokeStyle = '#ffd43b'; g.beginPath(); g.roundRect(b.x + 5, BTN_Y + 5, b.w - 10, BTN_H - 10, 18); g.stroke(); }
  }
  ctrlTex.needsUpdate = true;
}

function wrap(g, text, x, y, w, lh) {
  let line = '';
  for (const word of text.split(' ')) {
    if (g.measureText(line + word).width > w && line) { g.fillText(line, x, y); y += lh; line = ''; }
    line += `${word} `;
  }
  g.fillText(line, x, y);
}

// A point on the button strip (world) → its button, if any.
function buttonAt(p) {
  const l = controls.worldToLocal(p.clone());
  const px = (l.x / CTRL_W + 0.5) * ctrlCanvas.width, py = (0.5 - l.y / CTRL_H) * ctrlCanvas.height;
  if (py < BTN_Y || py > BTN_Y + BTN_H) return null;
  return buttons().find((b) => px >= b.x && px <= b.x + b.w) ?? null;
}

const pokes = new Map();
function pokeButtons(now) {
  for (const side of ['left', 'right']) {
    if (!hands.tracked[side]) { pokes.delete(side); continue; }
    const tip = hands.hands[side].pos[INDEX_TIP], z = controls.worldToLocal(tip.clone()).z;
    const st = pokes.get(side) ?? { armed: false };
    if (z > 0.02) st.armed = true;
    else if (st.armed && z < 0.004) { st.armed = false; const b = buttonAt(tip); if (b) press(b.id, now); }
    pokes.set(side, st);
  }
}

function updateRays(now) {
  let changed = false;
  for (const side of ['left', 'right']) {
    const r = rays[side], h = hands.hands[side];
    if (!hands.tracked[side] || !h?.palm) { r.ray = null; r.line.visible = r.dot.visible = false; if (r.on) { r.on = null; changed = true; } continue; }
    const raw = handRay(h.pos, h.palm, HAND_RAY);
    if (r.ray && now - r.t < 200) { r.ray.dir.lerp(raw.dir, HAND_RAY.smoothDir).normalize(); r.ray.origin.lerp(raw.origin, HAND_RAY.smoothOrigin); }
    else r.ray = { origin: raw.origin, dir: raw.dir };
    r.t = now;
    const hit = new THREE.Raycaster(r.ray.origin, r.ray.dir, 0, 2).intersectObject(controls)[0];
    const b = hit ? buttonAt(hit.point) : null;
    r.line.visible = r.dot.visible = !!hit;
    if (hit) {
      r.dot.position.copy(hit.point);
      r.line.matrix.lookAt(r.ray.origin, hit.point, new THREE.Vector3(0, 1, 0)).setPosition(r.ray.origin);
      r.line.matrix.scale(new THREE.Vector3(1, 1, hit.distance));
      r.line.matrixWorldNeedsUpdate = true;
    }
    if ((b?.id ?? null) !== r.on) { r.on = b?.id ?? null; changed = true; }
  }
  if (changed) drawControls();
}

// ---- XR ----------------------------------------------------------------------------------------------------

let laidOut = false, lastHead = null;
renderer.setAnimationLoop((time, frame) => {
  const now = performance.now();
  if (frame) {
    const ref = renderer.xr.getReferenceSpace(), session = renderer.xr.getSession();
    const vp = frame.getViewerPose(ref);
    const head = vp && { position: new THREE.Vector3().copy(vp.transform.position), quaternion: new THREE.Quaternion().copy(vp.transform.orientation) };
    if (head) lastHead = head;
    if (head && !laidOut) { layout(head); laidOut = true; begin(now, startKind); }
    hands.update(frame, ref, session.inputSources, head?.position);
    if (head) rec.frame(now, hands, head);
    updateRays(now);
    pokeButtons(now);
    detect(now);
    tick(now);
    animate(now);
  }
  renderer.render(scene, camera);
});

let startKind = null;   // the page's button: 'train' / 'test'; null: choose in the headset
const enter = document.getElementById('enter'), enterTest = document.getElementById('enter-test'), note = document.getElementById('note');
const supported = await navigator.xr?.isSessionSupported('immersive-ar').catch(() => false);
enter.disabled = enterTest.disabled = !supported;
enter.textContent = supported ? '🎯 Train' : 'Needs a headset (WebXR AR)';
enterTest.textContent = '🧪 Test';
enterTest.hidden = !supported;
if (!supported) note.textContent = 'Open this page in the Quest browser.';
enter.addEventListener('click', () => start('train'));
enterTest.addEventListener('click', () => start('test'));
async function start(kind) {
  startKind = kind;
  unlock();
  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
  telemetry.info('xr layer path', { path: chooseXRLayerPath(session) });
  await renderer.xr.setSession(session);
  laidOut = false;
  rec.start();
  session.addEventListener('selectstart', (e) => {
    unlock();
    rec.event('xr', { type: 'selectstart', side: e.inputSource.handedness, hand: !!e.inputSource.hand });
    if (e.inputSource.hand) {   // a pinch: the button under this hand's beam
      const on = rays[e.inputSource.handedness]?.on;
      if (on) press(on);
      return;
    }
    const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());   // a controller: its own ray
    if (!pose) return;
    const o = new THREE.Vector3().copy(pose.transform.position), d = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion().copy(pose.transform.orientation));
    const hit = new THREE.Raycaster(o, d).intersectObject(controls)[0];
    const b = hit && buttonAt(hit.point);
    if (b) press(b.id);
  });
  for (const type of ['selectend', 'squeezestart', 'squeezeend']) session.addEventListener(type, (e) => rec.event('xr', { type, side: e.inputSource.handedness, hand: !!e.inputSource.hand }));
  session.addEventListener('end', () => { rec.stop(); telemetry.info('trainer end', { kind: run.kind, takes: run.count, step: cur()?.id }); run.mode = 'idle'; });
}

window.__trainer = { run, rec, press, begin, tick: (now) => tick(now), seen: (ev, now) => seen(ev, now), STEPS, TEST_STEPS, REPS, cube, panel, controls, rays, buttonAt, forceReach: false, get head() { return lastHead; } };   // test hook
