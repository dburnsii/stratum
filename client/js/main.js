// Stratum main app: sign in, library/uploads, AR session, placement. DESIGN.md §8.
//
// Phones (Chrome/ARCore): camera-access → AprilTags align Spaces; tap places
// the selected item on the surface under the screen-center reticle; tapping
// an object selects it (resize / rotate / delete in the overlay).
// Quest: anchors align Spaces; trigger places at the controller; grip deletes.
import * as THREE from 'three';
import { api, Live } from './api.js';
import { World } from './world.js';
import { measureFile } from './assets.js';
import { deviceId, yawFacing, matrixToPose } from './util.js';
import { telemetry } from './telemetry.js';
import { XRCameraFeed } from './vision/camera.js';
import { TagTracker } from './vision/tags.js';
import { AppRuntime } from './apps/runtime.js';
import { Menu } from './ui/menu.js';
import { PhoneMenu } from './ui/phonemenu.js';
import { Keyboard } from './ui/keyboard.js';
import { TagMarks } from './ui/tagmarks.js';
import { QuestCameraFeed } from './vision/questcam.js';
import { Calibration } from './vision/calibrate.js';
import { Lighting } from './lighting.js';
import { HandView } from './ui/hands.js';
import { Occlusion } from './occlusion.js';
import { Presence } from './presence.js';
import { RoomMap } from './roommap.js';
import { Mapper, grayFromRGBA } from './mapping/mapper.js';
import { MapView } from './mapping/mapview.js';
import { withRawGL, chooseXRLayerPath } from './gl.js';
import { drawCost } from './apps/perf.js';
import { HandRecorder } from './handrec.js';
import { LabelPad } from './ui/labelpad.js';
import { MoveBox } from './ui/movebox.js';
import { HandGestures, Revelio, boundsOf, ghostOf } from './ui/revelio.js';
import { unlock as unlockSound } from './ui/sound.js';
import { HAND_RAY, handRay } from './input/handray.js';
import { FrameMeter } from './apps/perf.js';
import { FpsHud } from './ui/fpshud.js';
import { SlowdownProbe } from './perfprobe.js';

// ?emulate=phone|quest3 → fake WebXR device for desktop testing (tests/).
const EMULATED = new URLSearchParams(location.search).has('emulate');
if (EMULATED) await import('./emulate.js');

const VERSION = 'main v96';
telemetry.setVersion(VERSION);
const $ = (id) => document.getElementById(id);
const device = deviceId();
// Hand recording for gesture training (js/handrec.js): Quest, off until switched on in Settings
// (or by gesture labelling); the gesture trainer page always records.
const handRecWanted = () => localStorage.getItem('stratum.handrec') === '1';
const handRec = new HandRecorder({ version: VERSION, device,
  context: () => ({ apps: runtime ? [...runtime.running.values()].filter((i) => i.started).map((i) => i.app.id) : [], menu: !!quest?.menu?.open, space: currentSpace()?.name }) });
addEventListener('visibilitychange', () => { if (document.hidden && handRec.recording) handRec.cut(); });
// Gesture labelling mode (ui/labelpad.js): the core gestures don't act; a pad of big buttons
// marks "the next 4 s are this gesture" in the hand recording. Settings, or the pad's Done.
const labelMode = () => localStorage.getItem('stratum.labelMode') === '1';
let labelPad = null;
function setLabelMode(on) {
  localStorage.setItem('stratum.labelMode', on ? '1' : '0');
  if (on && !handRecWanted()) localStorage.setItem('stratum.handrec', '1');   // labels need the recording
  handRec.enabled = handRecWanted();
  if (on && session && IS_QUEST && !handRec.session) handRec.start();
  labelPad?.setVisible(on && !!session && IS_QUEST);
  telemetry.info('gesture labelling', { on });
  renderMenu();
}   // (headset off / page away: keep what's there)
const IS_QUEST = /OculusBrowser|Quest/i.test(navigator.userAgent);
const PHONE_SPAWN_DIST = 0.4;

// ---- log ------------------------------------------------------------------------

const lines = [];
function log(msg) {
  console.log('[stratum]', msg);
  telemetry[/^error/.test(msg) ? 'error' : 'info'](msg);
  lines.push(msg);
  $('status').textContent = lines.slice(-8).join('\n');
}

// ---- settings ---------------------------------------------------------------------

const tagSizeMm = () => Number(localStorage.getItem('stratum.tagMm')) || 100;
const occlusionWanted = () => localStorage.getItem('stratum.occlusion') === '1';   // off unless chosen
// New things go in the Space's shared layer (everyone in the Space sees them) unless turned off.
const placeShared = () => localStorage.getItem('stratum.placeShared') !== '0';

// ---- scene ------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
scene.add(camera);
// The fps meter (Settings → FPS meter): head-locked, frame rate + 10 s graph by app (ui/fpshud.js).
const fpsHud = new FpsHud(scene, { device: IS_QUEST ? 'quest' : 'phone' });
labelPad = new LabelPad(scene, { onLabel: (ev) => { handRec.event('label', ev); telemetry.info('gesture label', ev); } });
labelPad.onDone = () => setLabelMode(false);
fpsHud.setVisible(localStorage.getItem('stratum.fpsHud') === '1');

// Find the slowdown (Settings → Performance, perfprobe.js): the frame rate with one thing off at a time.
const probeOff = new Set();   // loop steps the probe has turned off ('camera', 'map')
function probeSteps() {
  const keep = {};
  const steps = [
    { key: 'base', label: 'As it is' },
    { key: 'camera', label: 'Headset camera off', off: () => probeOff.add('camera'), on: () => probeOff.delete('camera') },
    { key: 'map', label: 'Room mapping off', off: () => probeOff.add('map'), on: () => probeOff.delete('map') },
    { key: 'occlusion', label: 'Occlusion off', off: () => { keep.occ = occlusion.enabled; occlusion.enabled = false; }, on: () => { occlusion.enabled = keep.occ; } },
    { key: 'hands', label: 'Hands not drawn', off: () => { keep.hands = quest?.hands?.visible; quest?.hands?.setVisible(false); }, on: () => quest?.hands?.setVisible(keep.hands ?? showHands()) },
    { key: 'fps', label: 'FPS meter off', off: () => { keep.fps = fpsHud.visible; fpsHud.setVisible(false); }, on: () => fpsHud.setVisible(keep.fps) },
    { key: 'apps', label: 'Apps paused and hidden', off: () => runtime.setPaused(true), on: () => runtime.setPaused(false) },
  ];
  const rates = session?.supportedFrameRates ? [...session.supportedFrameRates] : [];
  if (rates.includes(72) && session.frameRate && session.frameRate !== 72 && session.updateTargetFrameRate) {
    steps.push({ key: '72hz', label: '72 Hz instead of ' + Math.round(session.frameRate),
      off: () => { keep.rate = session.frameRate; session.updateTargetFrameRate(72).catch(() => {}); },
      on: () => { if (keep.rate) session?.updateTargetFrameRate(keep.rate).catch(() => {}); } });
  }
  const offs = steps.filter((x) => x.off);
  steps.push({ key: 'all', label: 'All of those off', off: () => offs.forEach((x) => x.off()), on: () => [...offs].reverse().forEach((x) => x.on()) });
  return steps;
}
let probe = new SlowdownProbe([]);
function startProbe() {
  if (probe.running || !session) return;
  runtime.probing = true;
  probe = new SlowdownProbe(probeSteps(), { ...(window.__probeMs ?? {}),   // (tests: shorter steps)
    onChange: () => renderMenu(),
    onDone: (results) => {
      runtime.probing = false;
      const base = results[0]?.fps ?? 0;
      const costs = runtime.frameCosts();
      telemetry.info('slowdown probe', { target: Math.round(session?.frameRate || 72), results,
        apps: costs.length, tris: costs.reduce((t, a) => t + (a.tris ?? 0), 0), camera: !!questFeed, map: Mapper.wanted, occlusion: occlusion.enabled });
      log('slowdown test: ' + results.map((r) => `${r.label} ${Math.round(r.fps)}${r.key === 'base' ? '' : ` (${r.fps - base >= 0 ? '+' : ''}${Math.round(r.fps - base)})`}`).join(' · '));
      renderMenu();
    },
  });
  probe.start(performance.now());
}
function cancelProbe() { probe.cancel(); runtime.probing = false; renderMenu(); }
// Standard lights; replaced by the room's own light where the browser can
// estimate it (lighting.js: Chrome on Android), back when it can't.
const hemi = new THREE.HemisphereLight(0xffffff, 0x555566, 2.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(1, 3, 2);
scene.add(sun);
const lighting = new Lighting(scene, { fallback: [hemi, sun] });

// Where a placement would land: a small blue dot on the surface.
const RETICLE_COLOR = 0x3d9bff;
const CURSOR_GEO = new THREE.CircleGeometry(0.0035, 20), CURSOR_RING = new THREE.RingGeometry(0.0035, 0.0052, 24);   // at 1 m

// The object at a point (world): the point within 3 cm of its bounds (in its own
// frame); the smallest such, if several (a cup on a table). Its id, or null.
function objectAt(p) {
  let best = null;
  for (const e of world.objects.values()) {
    const root = e.built?.root;
    if (!root?.visible || !world.shown(e.data)) continue;
    const box = boundsOf(root);
    if (!box || box.isEmpty()) continue;
    const scale = root.getWorldScale(new THREE.Vector3()).x || 1;
    if (!box.clone().expandByScalar(0.03 / scale).containsPoint(root.worldToLocal(p.clone()))) continue;
    const size = box.getSize(new THREE.Vector3()), vol = size.x * size.y * size.z * scale ** 3;
    if (!best || vol < best.vol) best = { id: e.data.id, vol };
  }
  return best?.id ?? null;
}

// Where a press along this ray would land: an app taking presses anywhere says
// (runtime.aimPoint: e.g. a play-area corner); else the nearest virtual thing or
// mapped room surface it meets. World point or null.
function cursorAt(ray) {
  const app = runtime?.aimPoint(ray);
  if (app) return app;
  raycaster.set(ray.origin, ray.dir);
  const hit = pickHits()[0];
  const map = roomMap.raycast(ray);
  if (hit && (!map || hit.distance <= map.distance)) return hit.point.clone();
  return map?.point ?? null;
}
const reticle = new THREE.Mesh(
  new THREE.CircleGeometry(0.007, 20).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: RETICLE_COLOR }));
reticle.userData.isReticle = true;
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const occlusion = new Occlusion(renderer, scene);

// Occlusion on/off. Turning it on mid-session only works if the session got
// depth sensing (requested at Enter AR when the setting is on).
function setOcclusion(on) {
  localStorage.setItem('stratum.occlusion', on ? '1' : '0');
  occlusion.enabled = on;
  if (on && session && !occlusion.available) log('occlusion needs depth sensing: exit and re-enter AR');
  $('occlusion').checked = on;
  if (runtime) renderMenu();
}

const moveBox = new MoveBox(scene);   // the frame around what's being picked up / moved
const revelio = new Revelio(scene);   // glows for what you've hidden; shoo to hide (DESIGN.md §8.7)

// ---- app state --------------------------------------------------------------------

let world, me, personalLayer, library = [], runtime = null, presence = null, roomMap = null, mapper = null, mapView = null;
const mapReset = { armedAt: 0 };   // "reset the map" needs a second tap within a few seconds
const spaceGone = { id: null, armedAt: 0 };   // deleting / leaving a space too
const tagMarks = new TagMarks(scene);   // glowing brackets on printed tags in view (ui/tagmarks.js)
let lastViewer = null;          // { position, quaternion } world, updated per frame
let tracker = null, feed = null, hitSource = null, session = null, quest = null;
// Quest: the headset camera (getUserMedia) for tags, and its calibration (DESIGN.md §3.9).
let questFeed = null, calibration = null;
const questCamWanted = () => IS_QUEST && localStorage.getItem('stratum.questcamOn') !== '0';
const questCam = { note: '', state: 'off' };   // shown in the Quest menu
let selectedId = null;
// Placement is opt-in: tapping a palette item *arms* it for one placement.
// With nothing armed, taps never create objects (they select or do nothing).
let armed = null;

const randomColor = () => `#${new THREE.Color().setHSL(Math.random(), 0.75, 0.55).getHexString()}`;
const BUILTIN = [
  { key: 'cube', label: '■ Cube', components: () => ({ mesh: { primitive: 'box', size: [0.1, 0.1, 0.1] }, material: { color: randomColor() } }) },
  { key: 'ball', label: '● Ball', components: () => ({ mesh: { primitive: 'sphere', size: [0.08, 0.08, 0.08] }, material: { color: randomColor() } }) },
  { key: 'keyboard', label: '⌨ Keyboard', components: () => ({ keyboard: { layout: 'simple' } }) },
  { key: 'turntable', label: '◎ Turntable', components: () => ({ turntable: { radius: 0.12, items: [], current: null } }) },
  { key: 'spinner', label: '◆ Spinner', components: () => ({ mesh: { primitive: 'box', size: [0.08, 0.08, 0.08] }, material: { color: randomColor() }, animation: { kind: 'spin', rpm: 10, startedAt: world.live.now() } }) },
];
function paletteItems() {
  const icon = { model: '🧩', image: '🖼', video: '🎞' };
  // One tile per app, or one per variant (e.g. plant species), each with its config.
  const appItems = (runtime?.enabledApps() ?? []).filter((a) => a.placeable).flatMap((a) => (a.variants?.length
    ? a.variants.map((v) => ({ key: `app:${a.id}:${v.key}`, label: `${v.icon} ${v.name}`, layer: a.layer,
      mount: v.mount ?? a.mount, components: () => ({ app: { app: a.id, config: { ...v.config } } }) }))
    : [{ key: `app:${a.id}`, label: `${a.icon} ${a.name}`, layer: a.layer, mount: a.mount, components: () => ({ app: { app: a.id, config: {} } }) }]));
  return [...BUILTIN, ...appItems, ...library.map((a) => ({
    key: a.hash, label: `${icon[a.kind] ?? ''} ${a.name}`.slice(0, 28),
    // Pictures and videos hang flat on a wall when you aim at one (centered on the aim point).
    ...(a.kind !== 'model' && { mount: 'wall', mountOffsetY: 0.15 / (a.width && a.height ? a.width / a.height : 1) }),
    components: () => a.kind === 'model' ? { model: { asset: a.hash } }
      : a.kind === 'image' ? { image: { asset: a.hash, aspect: a.width && a.height ? a.width / a.height : null } }
      : { video: { asset: a.hash, aspect: a.width && a.height ? a.width / a.height : null, startedAt: world.live.now() } },
  }))];
}

window.__app = {
  get world() { return world; }, get tracker() { return tracker; }, get runtime() { return runtime; }, lines,
  get selectedId() { return selectedId; }, moveBox, revelio, turntable: { step: (id, d) => stepTurntable(id, d), put: (tt, id) => putOnTurntable(tt, id), off: (tt, id) => takeOffTurntable(tt, id), drop: (id) => afterDrop(id), items: (id) => ttVisible(world.objects.get(id)), swipe: (g) => sendSwipe(g) }, castRevelio: (o) => castRevelio(o), revealObject: (id) => revealObject(id), shooObject: (id) => shooObject(id), myHidden: () => myHidden().map((e) => e.data.id), get menu() { return menuProvider; }, get touch() { return touch; }, get armed() { return armed; }, get presence() { return presence; }, get roomMap() { return roomMap; }, get mapper() { return mapper; }, get mapView() { return mapView; },
  arm: (k) => arm(k),
  setPalette: (k) => arm(k),   // (old name)
};

// ---- boot / 2D page ---------------------------------------------------------------

// How long the start page took, and where (telemetry 'load timing', ms from navigation start):
// server answer, first paint (the loading screen), page parsed, ready (signed in, Spaces read).
function logLoadTiming() {
  try {
    const n = performance.getEntriesByType('navigation')[0], paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]));
    const res = performance.getEntriesByType('resource'), js = res.filter((r) => /\.m?js(\?|$)/.test(r.name));
    telemetry.info('load timing', { ttfb: Math.round(n?.responseStart ?? 0), firstPaint: paint['first-contentful-paint'] ?? paint['first-paint'] ?? null,
      parsed: Math.round(n?.domInteractive ?? 0), ready: Math.round(performance.now()), modules: js.length,
      kb: Math.round(res.reduce((t, r) => t + (r.transferSize || 0), 0) / 1024), slowest: js.sort((a, b) => b.duration - a.duration).slice(0, 3).map((r) => [r.name.replace(location.origin, ''), Math.round(r.duration)]) });
  } catch { /* timing is a nice-to-have */ }
}

async function boot() {
  window.__boot?.('Signing in…', 0.62);
  $('login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.login(new FormData(e.target).get('name').trim());   // (sets the cookie: a new name replaces the old one)
      location.reload();
    } catch (err) {
      $('login-error').textContent = err.message;
    }
  };
  try {
    me = await api.me();
  } catch {
    window.__bootDone?.();
    $('login').hidden = false;
    return;
  }
  $('who').textContent = me.user.name;
  // Change user: the sign-in form again (Cancel goes back).
  $('switch-user').onclick = () => {
    $('ready').hidden = true;
    $('login').hidden = false;
    $('login-cancel').hidden = false;
    $('login').elements.name.value = '';
    $('login').elements.name.focus();
  };
  $('login-cancel').onclick = () => { $('login').hidden = true; $('login-cancel').hidden = true; $('ready').hidden = false; };
  $('ready').hidden = false;
  personalLayer = me.layers.find((l) => l.kind === 'personal')?.id;
  $('tag-mm').value = tagSizeMm();
  $('occlusion').checked = occlusionWanted();
  $('occlusion').onchange = () => setOcclusion($('occlusion').checked);
  $('tag-mm').onchange = () => localStorage.setItem('stratum.tagMm', String(Number($('tag-mm').value) || 100));
  $('join').onsubmit = (e) => { e.preventDefault(); const c = $('join-code').value.trim(); if (c) joinSpace(c).then(() => { $('join-code').value = ''; }); };
  $('upload').onchange = (e) => uploadFiles([...e.target.files]).finally(() => { e.target.value = ''; });
  const library = refreshLibrary().catch((err) => log(`error: library: ${err.message}`));   // the page's list: not needed to start
  window.__boot?.('Loading apps…', 0.7);

  const live = new Live({
    obj: (o) => world.apply(o),
    subbed: (spaces) => world.resync(spaces).catch((err) => log(`error: sync failed: ${err.message}`)),
  });
  world = new World(scene, live, device, log);
  world.steady = localStorage.getItem('stratum.steady') === '1';   // hold spaces still (setting)
  world.hiddenObjects = loadIds('stratum.hiddenObjects');           // shooed away / revealed, on this device
  world.revealedObjects = loadIds('stratum.revealedObjects');
  presence = new Presence(world, live, { kind: IS_QUEST ? 'quest' : 'phone' });
  roomMap = new RoomMap(world, log, device);
  mapper = new Mapper({ world, renderer, device, log, quest: IS_QUEST });
  mapView = new MapView(world, log);
  live.handlers.surfaces = (m) => roomMap.load(m.space).then(() => renderMenu()).catch(() => {});
  live.handlers.map = (m) => { if (m.reset) mapView.clear(m.space); mapView.changed(m.space); mapper.noteChanges(m.space, m.changes); };
  live.handlers.move = (m) => world.remoteMove(m.id, m.pose, touch.drag?.id);
  live.handlers.members = () => world.refreshSpaces().then(() => roomMap.loadAll()).then(() => { renderSpacesList(); renderMenu(); }).catch(() => {});
  runtime = new AppRuntime({
    world, live, log,
    viewer: () => lastViewer,
    surface: () => (reticle.visible ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix) : null),
    onChange: () => renderMenu(),
    prompt: (label, value, opts) => askText(label, value, opts),
    keyboard: { open: (opts) => openKeyboard(opts) },
    clipboard,
    device: IS_QUEST ? 'quest' : 'phone',
    carry: (id) => carry(id),
    hands: () => quest?.hands ?? null,
    controls: () => quest?.controls() ?? null,
    surfaces: (spaceId) => roomMap.surfaces(spaceId),
    openPanel: (appId) => openAppPage(appId),
    renderer,
  });
  await runtime.load();
  window.__boot?.('Finding your spaces…', 0.8);
  await world.load();
  window.__boot?.('Loading room maps…', 0.9);
  await roomMap.loadAll();
  await library;
  if (localStorage.getItem('stratum.showMap') === '1') { roomMap.setVisible(true); mapView.setVisible(true); }
  for (const id of hiddenLayerIds()) setLayerShown(id, false, { restore: true });   // layers (and apps) you hid stay hidden
  renderAppsList();
  renderSpacesList();
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) await joinSpace(joinCode);
  log(`${VERSION} · ${world.spaces.size} space(s) · ${IS_QUEST ? 'Quest' : 'phone/other'}`);

  window.__bootDone?.();
  logLoadTiming();
  const supported = await navigator.xr?.isSessionSupported('immersive-ar');
  if (!supported) {
    $('enter').disabled = true;
    log('immersive-ar not supported here. Open this page on an ARCore phone (Chrome) or a Quest.');
    return;
  }
  $('enter').onclick = () => {
    unlockSound();   // a real click: audio may play from here on (key clicks)
    if (session || $('enter').disabled) return;   // one session at a time (a double tap used to start a second)
    $('enter').disabled = true;
    enterAR().catch((err) => {
      // A slow camera prompt can use up the tap that AR needs: the camera is on now, so a second tap works.
      if (questFeed && /gesture|activation|NotAllowed|Security/i.test(`${err.name} ${err.message}`)) log('headset camera is on: tap Enter AR again');
      else log(`error: enter AR failed: ${err.message}`);
    }).finally(() => { $('enter').disabled = false; });
  };
}

// ---- sharing spaces (DESIGN.md §5.1) ------------------------------------------------

function renderSpacesList() {
  const ul = $('spaces');
  const saved = [...world.spaces.values()].filter((s) => !s.temporary);
  $('spaces-empty').hidden = saved.length > 0;
  ul.replaceChildren(...saved.map((s) => {
    const code = el('b', { className: 'code' });
    const share = el('button', { textContent: 'Invite', className: 'small', onclick: () => invite(s).then((c) => { code.textContent = c ? ` ${c.code}` : ''; }) });
    const armed = spaceGone.id === s.id && performance.now() - spaceGone.armedAt < 5000;
    const gone = el('button', { textContent: armed ? 'Tap again' : s.owner ? 'Delete' : 'Leave', className: 'small danger', onclick: () => removeSpace(s.id) });
    return el('li', {}, el('span', { textContent: `${s.name} · ${s.members.join(', ')}` }), ' ', share, ' ', gone, code);
  }));
}

// A short code (valid 24 h) others type in, or a link that joins on open.
async function invite(space) {
  try {
    const c = await api.invite(space.id);
    c.link = `${location.origin}/?join=${c.code}`;
    log(`invite to "${space.name}": code ${c.code} or ${c.link}`);
    navigator.clipboard?.writeText(c.link).catch(() => {});
    return c;
  } catch (err) {
    log(`error: invite failed: ${err.message}`);
    return null;
  }
}

async function joinSpace(code) {
  try {
    const { space } = await api.join(code);
    if (new URLSearchParams(location.search).has('join')) history.replaceState(null, '', location.pathname + location.search.replace(/[?&]join=[^&]*/, '').replace(/^&/, '?'));
    await world.refreshSpaces();
    await roomMap.loadAll();
    const s = world.spaces.get(space);
    log(`joined "${s?.name ?? 'space'}" (${s?.members.join(', ')})`);
  } catch (err) {
    const msg = err.message.match(/"error": "([^"]+)"/)?.[1] ?? err.message;
    log(`error: could not join: ${msg}`);
  }
  renderSpacesList();
  renderMenu();
}

// The Space the user is in right now (aligned, saved), for the menu.
function currentSpace() {
  const aligned = [...world.spaces.values()].filter((s) => s.aligned && !s.temporary);
  if (!aligned.length) return null;
  const at = lastViewer?.position;
  return at ? aligned.sort((a, b) => dist(a, at) - dist(b, at))[0] : aligned[0];
}
const dist = (s, p) => new THREE.Vector3().setFromMatrixPosition(s.root.matrix).distanceTo(p);

// Where new things go: the Space's shared layer, or private (apps: their app layer).
function layerFor(space, item) {
  if (!space.temporary && placeShared() && space.sharedLayer) return space.sharedLayer;
  return item.layer ?? personalLayer;
}
function privateLayerFor(entry) {
  const app = entry.data.components?.app?.app;
  return (app && runtime.apps.get(app)?.layer) || personalLayer;
}

// ---- apps (2D page list + AR overlay chips and app bar) -------------------------

function renderAppsList() {
  const ul = $('apps');
  ul.innerHTML = '';
  for (const a of runtime.apps.values()) {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: a.enabled });
    box.dataset.app = a.id;
    box.onchange = () => runtime.setEnabled(a.id, box.checked).then(() => { renderAppsList(); renderMenu(); })
      .catch((err) => log(`error: ${err.message}`));
    label.append(box, ` ${a.icon} ${a.name}`);
    const desc = Object.assign(document.createElement('span'), { className: 'hint', textContent: ` · ${a.description}` });
    li.append(label, desc);
    ul.appendChild(li);
  }
}

// The phone overlay (index.html): a menu button bottom center opens a sheet
// (place / running apps / app toggles / session); above the button, a
// context bar shows what you can do right now (selection tools, app actions).
const el = (tag, { dataset, ...props } = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); Object.assign(n.dataset, dataset); n.append(...kids); return n; };
const splitLabel = (label) => { const m = label.trim().match(/^(\S+)\s+(.*)$/); return m && !/^[\w]/.test(m[1]) ? [m[1], m[2]] : ['', label.trim()]; };
const runSafe = (fn) => { try { fn(); } catch (err) { log(`error: ${err.message}`); } };

// Rebuild a container only when its structure changes, so a button under a
// finger isn't replaced mid-tap by a status update; labels update in place.
function patch(box, groups, build) {
  const key = JSON.stringify(groups, (k, v) => (k === 'text' || typeof v === 'function' ? undefined : v));
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren(...groups.flatMap(build));
  }
  box.querySelectorAll('[data-text]').forEach((n, i) => { const g = groups.filter((x) => x.text !== undefined)[i]; if (g && n.textContent !== g.text) n.textContent = g.text; });
}

// The sheet itself is ui/phonemenu.js (same pages and data as the Quest menu).
let phoneMenu = null;
const sheet = () => (phoneMenu ??= new PhoneMenu($('ov-sheet'), $('ov-scrim'), phoneProvider));
function setSheet(open) {
  sheet().setOpen(open);
  $('ov-overlay').classList.toggle('sheet-open', open);
}
const sheetOpen = () => !!phoneMenu?.isOpen;

function renderMenu() {
  quest?.menu.invalidate();
  renderFab();
  renderRevelioBtn();
  renderContext();
  if (runtime && world && !IS_QUEST) sheet().render();
}

// Menu button: the layers icon, or a "placing" pill while an item is armed
// (tap it to cancel).
function renderFab() {
  const fab = $('ov-fab');
  const item = armed && paletteItems().find((i) => i.key === armed);
  const key = item ? `armed:${armed}` : 'menu';
  if (fab.dataset.key === key) return;
  fab.dataset.key = key;
  fab.classList.toggle('placing', !!item);
  fab.setAttribute('aria-label', item ? 'Cancel placing' : 'Menu');
  fab.replaceChildren(...(item
    ? [el('span', { className: 'what', textContent: `${item.label.trim()}` }), el('span', { className: 'x', textContent: '✕' })]
    : [el('span', { className: 'strata' }, el('i'), el('i'), el('i'))]));
}
// Phones: a Revelio button beside the menu button (one tap: glows show where
// your hidden things are; tap a glow to bring it back). The badge counts them.
function renderRevelioBtn() {
  const b = $('ov-revelio');
  if (!b || !world) return;
  const n = session ? myHidden().length : 0;
  const key = `${n}`;
  if (b.dataset.key === key) return;
  b.dataset.key = key;
  b.classList.toggle('some', n > 0);
  b.setAttribute('aria-label', n ? `Revelio: ${n} hidden` : 'Revelio');
  b.replaceChildren(el('span', { className: 'wand', textContent: '✨' }), ...(n ? [el('span', { className: 'n', textContent: `${n}` })] : []));
}
const viewCheckAt = { session: null, ticks: 0 };   // phones: one 'view check' 3 s after a saved Space lines up
setInterval(() => {
  if (!session || IS_QUEST) return;
  renderRevelioBtn();
  if (viewCheckAt.session === session) return;
  const aligned = [...world.spaces.values()].some((s) => s.aligned && !s.temporary);
  viewCheckAt.ticks = aligned ? viewCheckAt.ticks + 1 : 0;
  if (viewCheckAt.ticks >= 3) { Object.assign(viewCheckAt, { session, ticks: 0 }); viewCheck('aligned'); }
}, 1000);
$('ov-revelio').onclick = () => {
  navigator.vibrate?.(8);
  if (revelio.active) { revelio.clear(); return; }
  castRevelio({ how: 'button' });
};
$('ov-fab').onclick = () => {
  navigator.vibrate?.(8);
  if (armed) return arm(null);
  setSheet(!sheetOpen());
};
$('ov-scrim').onclick = () => setSheet(false);

// Context bar: the selected object's tools (+ its app's actions), else the
// actions of running apps.
const EDIT_BUTTONS = [
  { act: 'carry', label: '✥', title: 'Pick up (tap to put down)' }, { act: 'move', label: '⤓', title: 'Move to the dot' }, { act: 'smaller', label: '−' }, { act: 'bigger', label: '+' },
  { act: 'rotate', label: '⟳' }, { act: 'delete', label: '🗑', cls: 'danger' }, { act: 'done', label: '✕' },
];
function renderContext() {
  const groups = [];
  const running = runtime?.uiState() ?? [];
  if (selectedId) {
    const e = world.objects.get(selectedId);
    const inst = running.find((r) => r.instance === selectedId);
    const appId = e?.data.components?.app?.app;
    const name = appId ? `${runtime.apps.get(appId)?.icon ?? ''} ${inst?.status || runtime.apps.get(appId)?.name || 'App'}` : 'Selected';
    const shareable = !world.isTemporary(e?.data.space);
    groups.push({ id: 'sel', text: name, edits: true, share: shareable ? world.isShared(selectedId) : null,
      acts: [...(inst?.actions ?? []), ...keyboardActions(selectedId)].map((a) => a.label), actions: [...(inst?.actions ?? []), ...keyboardActions(selectedId)] });
  } else if (!armed) {
    for (const { app, status, actions, instance } of running) {
      if (actions.length) groups.push({ id: instance, text: `${app.icon} ${status || app.name}`, acts: actions.map((a) => a.label), actions });
    }
  }
  patch($('ov-context'), groups, (g, i) => [
    ...(i ? [el('span', { className: 'sep' })] : []),
    el('span', { className: 'label', dataset: { text: '' } }),
    ...g.actions.map((a) => el('button', { className: `ibtn${/^\W\S?$/u.test(a.label) ? '' : ' text'}`, textContent: a.label, onclick: () => runSafe(a.run) })),
    ...(g.share != null ? [el('button', { className: `ibtn text${g.share ? ' shared' : ''}`, textContent: g.share ? '👥 Shared' : '🔒 Private',
      title: g.share ? 'Visible to everyone in this space: tap to make private' : 'Only you: tap to share with this space', dataset: { act: 'share' } })] : []),
    ...(g.edits ? EDIT_BUTTONS.map((b) => el('button', { className: `ibtn ${b.cls ?? ''}`, textContent: b.label, title: b.title ?? b.act, dataset: { act: b.act } })) : []),
  ]);
}
$('ov-context').addEventListener('click', (e) => { const act = e.target.closest('[data-act]')?.dataset.act; if (act) editSelected(act); });

async function refreshLibrary() {
  library = (await api.assets()).assets;
  const ul = $('library');
  ul.innerHTML = '';
  for (const a of library) {
    const li = document.createElement('li');
    li.textContent = `${a.kind} · ${a.name} · ${(a.size / 1024).toFixed(0)} KB`;
    ul.appendChild(li);
  }
  $('library-empty').hidden = library.length > 0;
 
}

async function uploadFiles(files) {
  for (const file of files) {
    try {
      log(`uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);
      const dims = await measureFile(file).catch(() => ({}));
      const a = await api.upload(file, dims);
      log(`uploaded ${a.name} → ${a.kind} ${a.hash.slice(0, 8)}`);
    } catch (err) {
      log(`error: ${err.message}`);
    }
  }
  await refreshLibrary();
}

// ---- AR overlay (phones) -----------------------------------------------------------

// Text entry for apps (URLs, typing into a browser pane, settings, search).
// Quest: the virtual keyboard (ui/keyboard.js). Phone: the system keyboard
// with this box docked at the top (the keyboard takes the bottom half), with quick-insert
// chips for URLs; the dock and sheet hide while typing.
// Clipboard for apps (ctx.clipboard): the Stratum clipboard (per user, on
// the server, so a copy in the headset pastes on the phone) plus the
// system clipboard where the browser lets us. Reading prefers a fresh copy
// made on another device, else the system clipboard, else the server one.
let clipWroteAt = 0;
const CLIP_FRESH_MS = 10 * 60 * 1000;
const clipboard = {
  async write(text) {
    clipWroteAt = Date.now();
    navigator.clipboard?.writeText(text).catch(() => {});
    await api.setClipboard(text);
  },
  async read() {
    const srv = await api.clipboard().catch(() => ({ text: '', at: 0 }));
    if (srv.at > clipWroteAt + 1000 && Date.now() - srv.at < CLIP_FRESH_MS) return srv.text;   // copied elsewhere just now
    const sys = await Promise.race([navigator.clipboard?.readText?.().catch(() => null), new Promise((r) => setTimeout(() => r(null), 1500))]);
    return sys || srv.text;
  },
};
window.__app.clipboard = clipboard;   // test hook
window.__app.fpsHud = fpsHud;          // test hooks
window.__app.renderer = renderer;
window.__app.probe = () => probe;

let pendingAsk = null;
const URL_CHIPS = ['https://', 'www.', '.com', '/', '.org'];
function askText(label, value = '', opts = {}) {
  const isUrl = /go to|url|address/i.test(label);
  if (quest) return quest.typingKeyboard().ask(label, value, { url: isUrl, ...opts });   // Quest: a placed keyboard you're at, else the floating one
  if (IS_QUEST || !session) return Promise.resolve(null);
  pendingAsk?.resolve(null);
  endLive('replaced');
  setSheet(false);
  const input = $('ov-ask-input');
  $('ov-ask-label').textContent = label;
  input.value = value;
  input.type = opts.secret ? 'password' : isUrl ? 'url' : 'text';
  input.enterKeyHint = isUrl ? 'go' : 'send';
  $('ov-ask-ok').textContent = isUrl ? 'Go' : 'Send';
  $('ov-ask-chips').replaceChildren(
    ...(isUrl ? URL_CHIPS : []).map((t) => el('button', { type: 'button', textContent: t, dataset: { insert: t } })),
    el('button', { type: 'button', textContent: 'Clear', dataset: { insert: '' } }),
    el('button', { type: 'button', id: 'ov-ask-cancel', textContent: 'Cancel' }));
  $('ov-ask').hidden = false;
  $('ov-overlay').classList.add('asking');
  input.focus();
  input.select();   // typing replaces the old URL; a chip or arrow keeps it
  return new Promise((resolve) => { pendingAsk = { resolve }; });
}
function hideAsk() {
  $('ov-ask').hidden = true;
  $('ov-overlay').classList.remove('asking');
  $('ov-ask-input').blur();
}
function finishAsk(value) {
  hideAsk();
  pendingAsk?.resolve(value);
  pendingAsk = null;
}

// Live typing for apps (ctx.keyboard.open): Quest → the virtual keyboard in
// live mode; phone → the same box, but every edit goes to the app right
// away. Phone edits are diffed against the previous text, so autocorrect
// and swipe typing arrive as backspaces + text.
let liveAsk = null;   // { opts, prev, handle }
const NAV_CHIPS = [['Tab', 'Tab'], ['Esc', 'Escape'], ['←', 'ArrowLeft'], ['→', 'ArrowRight'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown']];
function openKeyboard(opts = {}) {
  if (quest) return quest.typingKeyboard().openLive(opts);
  if (IS_QUEST || !session) return { close() {}, open: false };
  if (pendingAsk) finishAsk(null);
  endLive('replaced');
  setSheet(false);
  const input = $('ov-ask-input');
  $('ov-ask-label').textContent = opts.label ?? 'Typing';
  input.value = '';
  input.type = opts.secret ? 'password' : 'text';
  input.enterKeyHint = opts.kind === 'search' ? 'search' : opts.kind === 'url' ? 'go' : 'enter';
  $('ov-ask-ok').textContent = 'Done';
  const chips = opts.chips ?? NAV_CHIPS.map(([t, key]) => [t, { key }]);
  $('ov-ask-chips').replaceChildren(...chips.map(([t, ev]) => el('button', { type: 'button', textContent: t,
    dataset: ev.mod ? { mod: ev.mod } : ev.key ? { key: ev.key } : { text: ev.text ?? '' } })));
  $('ov-ask').hidden = false;
  $('ov-overlay').classList.add('asking');
  input.focus();
  const handle = { close: () => { if (liveAsk?.handle === handle) endLive('app'); }, get open() { return liveAsk?.handle === handle; } };
  liveAsk = { opts, prev: '', handle, ctrl: false };
  return handle;
}
function endLive(reason) {
  const l = liveAsk;
  if (!l) return;
  liveAsk = null;
  hideAsk();
  try { l.opts.onClose?.(reason); } catch (err) { log(`error: ${err.message}`); }
}
function setCtrl(on) {
  liveAsk.ctrl = on;
  $('ov-ask-chips').querySelector('[data-mod=ctrl]')?.classList.toggle('on', on);
}
const liveKey = (ev) => { try { liveAsk?.opts.onKey?.(ev); } catch (err) { log(`error: ${err.message}`); } };
$('ov-ask-input').addEventListener('input', (e) => {
  if (!liveAsk) return;
  const cur = e.target.value, prev = liveAsk.prev;
  let i = 0;
  while (i < cur.length && i < prev.length && cur[i] === prev[i]) i++;
  for (let n = prev.length - i; n > 0; n--) liveKey({ key: 'Backspace' });
  const added = cur.slice(i);
  if (liveAsk.ctrl && added.length === 1 && /[a-z]/i.test(added)) {   // sticky Ctrl: this letter is a control key
    setCtrl(false);
    liveKey({ key: `Ctrl+${added.toUpperCase()}` });
    e.target.value = liveAsk.prev = prev;
    return;
  }
  if (added) liveKey({ text: added });
  liveAsk.prev = cur;
});
$('ov-ask-input').addEventListener('keydown', (e) => {
  if (!liveAsk) return;
  if (e.key === 'Enter') { e.preventDefault(); liveKey({ key: 'Enter' }); e.target.value = liveAsk.prev = ''; }
  else if (e.key === 'Backspace' && !e.target.value) liveKey({ key: 'Backspace' });   // nothing local left to delete
});
$('ov-ask').onsubmit = (e) => {
  e.preventDefault();
  if (liveAsk) return endLive('user');   // Done
  finishAsk($('ov-ask-input').value);
};
// Chips: pointerdown + preventDefault keeps the input focused (keyboard stays up).
$('ov-ask-chips').addEventListener('pointerdown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
$('ov-ask-chips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'ov-ask-cancel') return finishAsk(null);
  if (b.dataset.mod === 'ctrl' && liveAsk) return setCtrl(!liveAsk.ctrl);
  if (b.dataset.key) return liveKey({ key: b.dataset.key });
  if (b.dataset.text && liveAsk) return liveKey({ text: b.dataset.text });
  const input = $('ov-ask-input');
  if (b.dataset.insert === '') input.value = '';
  else input.setRangeText(b.dataset.insert, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
  input.focus();
});
// Keyboard height (where the browser reports it): lifts the dock above it.
window.visualViewport?.addEventListener('resize', () => {
  const vv = window.visualViewport;
  $('overlay').style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
});

function arm(key) {
  armed = key;
  if (key) { select(null); setSheet(false); }   // armed: the next tap on the world places it
 
  renderMenu();
  updateOverlay.last = 0;   // refresh the status line now
}

function select(id) {
  if (id !== selectedId && id && sheetOpen()) setSheet(false);
  selectedId = id;
  renderMenu();
}

const EDITS = {
  // Move to the surface under the reticle (keeps rotation/scale).
  move: (m, entry) => {
    const at = aimPoint();
    if (!at) return log('find a surface first, then ⤓');
    const space = world.spaces.get(entry.data.space);
    m.setPosition(at.clone().applyMatrix4(space.root.matrix.clone().invert()));
  },
  smaller: (m) => m.multiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8)),
  bigger: (m) => m.multiply(new THREE.Matrix4().makeScale(1.25, 1.25, 1.25)),
  rotate: (m) => m.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 6)),
};
// A real (Bluetooth) keyboard on the Quest: keys go to whatever is being
// typed into (pop-up or placed keyboard), else wake the app you last used.
// Whether Quest Browser delivers key events during immersive AR isn't
// known yet: the first one is logged.
const HW_KEYS = new Set(['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
  'Delete', 'Insert', 'PageUp', 'PageDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);
function hardwareKey(e) {
  if (e.key.length === 1) {
    if (e.ctrlKey && /[a-z@[\]^_\\]/i.test(e.key)) return { key: `Ctrl+${e.key.toUpperCase()}` };
    if (e.altKey) return { key: `Alt+${e.key}` };
    return { text: e.key };
  }
  if (!HW_KEYS.has(e.key)) return null;   // Shift, Meta, CapsLock… on their own
  if (e.key === 'Tab' && e.shiftKey) return { key: 'Shift+Tab' };
  return { key: e.altKey ? `Alt+${e.key}` : e.key };
}
document.addEventListener('keydown', (e) => {
  if (!quest || /^(INPUT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
  const ev = hardwareKey(e);
  if (!ev) return;
  e.preventDefault();
  if (!hardwareKey.logged) { hardwareKey.logged = true; telemetry.info('hardware keyboard key', { key: e.key, inXR: !!session }); }
  let kb = quest.busyKeyboard();
  if (!kb) {
    if (!runtime.summonKeyboard(selectedId)) return;
    kb = quest.busyKeyboard();
    if (!kb) return;
  }
  kb.hardware(ev);
});

// A placed keyboard's own tools: which layout it has.
function keyboardActions(id) {
  const e = world.objects.get(id);
  const kb = e?.data.components?.keyboard;
  if (!kb) return [];
  const set = (layout) => world.setComponents(id, { ...e.data.components, keyboard: { ...kb, layout } }).then(() => renderMenu());
  return [
    { label: kb.layout === 'full' ? 'Simple keys' : '✓ Simple keys', run: () => set('simple') },
    { label: kb.layout === 'full' ? '✓ Full + number pad' : 'Full + number pad', run: () => set('full') },
  ];
}

function editSelected(act) {
  if (!selectedId) return;
  if (act === 'done') return select(null);
  if (act === 'carry') return carry(selectedId);
  if (act === 'delete') { const owner = world.slotOwner(selectedId); if (owner) takeOffTurntable(owner.data.id, selectedId); world.remove(selectedId); return select(null); }
  if (act === 'share') {
    const entry = world.objects.get(selectedId);
    const space = entry && world.spaces.get(entry.data.space);
    if (!space?.sharedLayer) return;
    return world.setLayer(selectedId, world.isShared(selectedId) ? privateLayerFor(entry) : space.sharedLayer).then(() => renderMenu());
  }
  const entry = world.objects.get(selectedId);
  world.edit(selectedId, (m) => EDITS[act](m, entry));
}

// Where "move here" puts things: phone = surface under the screen-center
// dot; Quest = the right controller's dot (or its ray's end).
function aimPoint() {
  if (quest) return quest.aimPoint();
  return reticle.visible ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix) : null;
}
// Taps on overlay controls (.ui) must not also become XR selects.
$('overlay').addEventListener('beforexrselect', (e) => { if (e.target.closest?.('.ui')) e.preventDefault(); });

let pendingTag = null;   // unclaimed tag currently in view
$('ov-create').onclick = async () => {
  const tag = pendingTag;
  if (!tag) return;
  $('ov-create').disabled = true;
  try {
    await world.createSpaceAtTag(tag, `Space ${new Date().toLocaleDateString()} · tag ${tag.id}`);
  } catch (err) {
    log(`error: ${err.message}`);
  } finally {
    $('ov-create').disabled = false;
  }
};

function updateOverlay(now) {
  if (now - (updateOverlay.last ?? 0) < 250) return;
  updateOverlay.last = now;
  $('ov-status-text').textContent = statusText(now);
  $('ov-prompt').hidden = !pendingTag;
}

function statusText(now = performance.now()) {
  const aligned = [...world.spaces.values()].filter((s) => s.aligned && !s.temporary);
  const temp = [...world.spaces.values()].find((s) => s.temporary);
  let text;
  pendingTag = null;
  if (tracker) {
    const visible = [...tracker.tags.values()].filter((t) => now - t.lastSeen < 700);
    pendingTag = visible.find((t) => !world.spaceForTag(t.id) && !aligned.length) ?? null;
    if (aligned.length) text = `In ${aligned.map((s) => `"${s.name}"`).join(', ')}`;
    else if (pendingTag) text = `Tag ${pendingTag.id} isn't part of a space yet`;
    else if (temp) text = 'Temporary space: clears when you exit (a printed tag keeps things)';
    else text = 'No tag in view: tap a surface to use a temporary space';
  } else if (!IS_QUEST) {
    text = aligned.length ? `In ${aligned.map((s) => `"${s.name}"`).join(', ')}` : 'No camera access: tags unavailable';
  } else {
    text = aligned.length ? 'Aligned' : 'Y opens the menu · pick an item, then trigger on a surface';
  }
  const armedItem = armed && paletteItems().find((i) => i.key === armed);
  if (armedItem) text = IS_QUEST ? `Trigger where to put ${armedItem.label.trim()}` : `Tap a surface to put ${armedItem.label.trim()} there`;
  else if (aligned.length && !reticle.visible && !IS_QUEST) text += ' · find a surface';
  return text;
}

// ---- XR session -------------------------------------------------------------------

// Roam past the boundary (Quest, experimental): ask for an 'unbounded'
// reference space and use it when granted; otherwise the usual
// 'local-floor' (boundary-bound). Quest Browser may need chrome://flags →
// WebXR Experiments. Takes effect when entering AR.
// Off by default: on the Quest Browser (Oct 2026) anchors can't be created
// or deleted in an unbounded session, so saved Spaces don't work there.
const roamWanted = () => IS_QUEST && localStorage.getItem('stratum.unbounded') === '1';
const roam = { active: false, note: '' };

async function enterAR() {
  // Quest: ask for the headset camera first (its prompt can't show inside AR).
  if (questCamWanted() && !questFeed) {
    questFeed = await QuestCameraFeed.open().catch((err) => {
      questCam.state = 'off';
      questCam.note = `Not available: ${err.name === 'NotAllowedError' ? 'allow Headset cameras for this site' : err.message}`;
      log(`headset camera unavailable (${err.message}): tags won't be seen on the Quest`);
      return null;
    });
    if (questFeed) {
      telemetry.info('headset camera', { label: questFeed.label, size: questFeed.size, calibrated: questFeed.calibrated, path: questFeed.path });
      questCam.statsTimer ??= setInterval(() => { if (session && questFeed) telemetry.info('headset camera stats', { ...questFeed.stats, workerMs: +questFeed.stats.workerMs.toFixed(1) }); }, 60000);
    }
  }
  const optionalFeatures = IS_QUEST
    ? ['hit-test', 'anchors', 'plane-detection', 'hand-tracking', ...(roamWanted() ? ['unbounded'] : [])]
    : ['camera-access', 'dom-overlay', 'hit-test', 'anchors'];   // phones: a session anchor holds a Space once its tags agree
  const occ = Occlusion.sessionInit(occlusionWanted());   // depth if occlusion is on...
  const mapInit = Mapper.sessionInit(IS_QUEST);           // ...or the map is being built (its preference wins: CPU depth on phones)
  const depthSensing = mapInit.depthSensing ?? occ.depthSensing;
  session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local-floor'],
    optionalFeatures: [...new Set([...optionalFeatures, ...(occ.optionalFeatures ?? []), ...(mapInit.optionalFeatures ?? []), ...lighting.features])],
    ...(depthSensing && { depthSensing }),
    ...(!IS_QUEST && { domOverlay: { root: $('overlay') } }),
  });
  const xrPath = chooseXRLayerPath(session);
  telemetry.info('xr layer path', { path: xrPath });
  await renderer.xr.setSession(session);
  const features = session.enabledFeatures ?? [];
  roam.active = false;
  roam.forcedOff = false;
  if (roamWanted()) {
    try {
      if (session.enabledFeatures && !features.includes('unbounded')) throw new Error('not granted');
      renderer.xr.setReferenceSpace(await session.requestReferenceSpace('unbounded'));
      world.altSpace = await session.requestReferenceSpace('local-floor').catch(() => null);   // anchors may only resolve against it
      roam.active = true;
      roam.note = 'On: walk past your boundary';
    } catch (err) {
      roam.note = 'Not available here: try chrome://flags → WebXR Experiments';
      log(`unbounded space unavailable (${err.message}): staying inside the boundary`);
    }
  } else {
    roam.note = IS_QUEST ? 'Off. Experimental: saved spaces may not work while roaming' : '';
  }
  const refSpace = renderer.xr.getReferenceSpace();
  telemetry.info('reference space', { unbounded: roam.active, wanted: roamWanted() });
  setTimeout(() => { if (session) telemetry.info('anchors after 8 s', { unbounded: roam.active, ...world.anchorReport() }); }, 8000);
  log(`session: ${session.environmentBlendMode} · ${features.join(', ')}`);
  lighting.start(session).then((mode) => {
    telemetry.info('lighting', { mode, note: lighting.note });
    if (mode === 'room') log('lighting: matching the room');
    renderMenu();
  });
  const occStatus = occlusion.start(session);
  occlusion.enabled = occlusionWanted();
  if (occlusionWanted()) log(`occlusion: ${occStatus}`);
 
  select(null);

  // Hit-test from the screen center (phones) or per controller (Quest), set
  // up in the background: never block input/rendering on optional features.
  if (features.includes('hit-test') && !IS_QUEST) {
    session.requestReferenceSpace('viewer')
      .then((viewer) => session.requestHitTestSource({ space: viewer }))
      .then((h) => { hitSource = h; })
      .catch((err) => log(`hit-test unavailable: ${err.message}`));
  }
  if (features.includes('camera-access')) {
    feed = new XRCameraFeed(renderer, session);
    tracker = new TagTracker({
      sizeFor: (id) => {
        const space = world.spaceForTag(id);
        return space?.markers.get(id).size ?? tagSizeMm() / 1000;
      },
      onFirstSeen: (t) => log(`tag ${t.id} seen${world.spaceForTag(t.id) ? ` (${world.spaceForTag(t.id).name})` : ''}`),
    });
    world.tracker = tracker;
  } else if (!IS_QUEST) {
    log('camera-access not granted: tags unavailable');
  } else if (questFeed) {
    tracker = new TagTracker({
      sizeFor: (id) => world.spaceForTag(id)?.markers.get(id).size ?? tagSizeMm() / 1000,
      onFirstSeen: (t) => log(`tag ${t.id} seen${world.spaceForTag(t.id) ? ` (${world.spaceForTag(t.id).name})` : ''}`),
    });
    tracker.onMarkers = (cap, markers) => { if (calibration) { calibration.add(cap, markers); calibrationStep(); } };
    questFeed.onResult = (cap, markers) => {   // found in the camera worker
      if (cap.small && mapper) mapper.noteImage({ ...cap.small, fx: cap.K.fx * cap.small.scale, fy: cap.K.fy * cap.small.scale,
        cx: cap.K.cx * cap.small.scale, cy: cap.K.cy * cap.small.scale, cameraWorld: cap.cameraWorld.clone(), time: cap.time });
      tracker?.addResult(cap, markers);
    };
    // Uncalibrated, tag poses are rough guesses: show the tags, but don't let
    // them place or align Spaces (they'd sit visibly off from the phone's).
    world.tracker = questFeed.calibrated ? tracker : null;
    questCam.state = questFeed.calibrated ? 'calibrated' : 'uncalibrated';
    questCam.note = questFeed.calibrated ? `Calibrated (${questFeed.calib.rmsPx.toFixed(1)} px)` : 'Not calibrated: tag positions are rough';
  }

  quest = IS_QUEST ? new QuestInput(session, refSpace) : null;
  mapper.start(session);
  roomMap.mapping = !IS_QUEST && Mapper.wanted;   // phones: surface hits feed the map in the background
  session.addEventListener('select', (e) => { if (!IS_QUEST) phoneSelect(e, refSpace); });
  if (!IS_QUEST) {
    session.addEventListener('selectstart', (e) => phoneTouchStart(e, refSpace));
    session.addEventListener('selectend', (e) => phoneTouchEnd(e));
  }
  if (!IS_QUEST && new URLSearchParams(location.search).has('emulate')) $('overlay').classList.add('emulated');   // no dom-overlay in the emulator
  renderMenu();
  if (IS_QUEST && handRecWanted()) { handRec.start(); telemetry.info('hand recording', { on: true }); }
  labelPad.setVisible(IS_QUEST && labelMode());
  session.addEventListener('end', () => {
    labelPad.setVisible(false);
    handRec.stop();
    renderer.setAnimationLoop(null);
    quest?.dispose();
    quest = null;
    hitSource?.cancel();
    hitSource = null;
    occlusion.stop();
    lighting.stop();
    mapper.stop();
    roomMap.mapping = false;
    tracker?.dispose();
    world.tracker = tracker = feed = null;
    calibration = null;
    reticle.visible = false;
    for (const s of world.spaces.values()) { s.aligned = false; s.root.visible = false; }
    world.endSession();
    if (probe.running) cancelProbe();   // (everything back on)
    session = null;
    world.clearTemporary();   // runtime.update() stops apps whose instance vanished
    runtime.update(0);
    setSheet(false);
    finishAsk(null);
    presence.clear();
    log('session ended');
  });

  let last = performance.now();
  let lastWorkMs = 0, lastFrameAt = performance.now();   // our work last frame (the fps meter draws before this frame's is known)
  const meter = new FrameMeter();   // the headset's frame rate and our work per frame → the apps watchdog (apps/perf.js)
  // Every step is guarded (guard / renderSafe): an error in one (often an app's)
  // must not end the frame, and an escape here would end the XR loop for good
  // (three.js asks for the next frame only after this returns).
  renderer.setAnimationLoop((t, frame) => { try { xrStep(t, frame); } catch (err) { loopError('frame', err); } });
  function xrStep(t, frame) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (frame) {
      if (hitSource) {
        const pose = frame.getHitTestResults(hitSource)[0]?.getPose(refSpace);
        reticle.visible = !!pose;
        if (pose) reticle.matrix.fromArray(pose.transform.matrix);
        if (pose && roomMap.mapping && roomMap.sample(reticle.matrix, 0)) updateOverlay.last = 0;   // local-floor: y 0 = floor
      }
      guard('input', () => quest?.update(frame));
      const vp = frame.getViewerPose(refSpace);
      let head = null;
      if (vp) {
        const { position: p, orientation: o } = vp.transform;
        const prev = lastViewer;
        lastViewer = { position: new THREE.Vector3(p.x, p.y, p.z), quaternion: new THREE.Quaternion(o.x, o.y, o.z, o.w) };
        const turnDegS = prev && dt > 0 ? THREE.MathUtils.radToDeg(prev.quaternion.angleTo(lastViewer.quaternion)) / dt : 0;
        head = { position: lastViewer.position, turnDegS };
        if (!probeOff.has('camera')) questFeed?.head(now, new THREE.Matrix4().fromArray(vp.transform.matrix));   // the camera's frames are matched to these
      }
      if (handRec.recording) guard('hand rec', () => handRec.frame(now, quest?.hands, lastViewer));
      guard('world', () => world.update(frame, refSpace, dt, head));
      if (Mapper.wanted && !probeOff.has('map')) guard('map', () => {   // the living map (DESIGN.md §3.10): depth snapshots, the headset's room scan
        mapper.update(frame, refSpace, vp, now);
        if (IS_QUEST) roomMap.autoImport(frame, refSpace, now);
      });
      guard('tags', () => tagMarks.update(tracker, now, dt, (id) => world.spaceForTag(id)));
      guard('apps', () => runtime.update(dt));
      guard('presence', () => presence.update(now, dt, lastViewer));
    }
    if (frame) guard('touch', () => touchFrame(frame, refSpace));
    guard('move box', () => {
    if (selectedId && !world.objects.get(selectedId)?.built) select(null);
    // The move box shows only while something is being picked up or moved (not on select).
    const moving = touch.drag && world.objects.get(touch.drag.id)?.built?.root;
    const h = !moving && (quest?.hold ?? touch.holding);
    const holding = h && world.objects.get(h.id)?.built?.root;
    if (moving) moveBox.show(moving, touch.two ? 'two' : 'drag');
    else if (holding) {
      const k = (performance.now() - h.t0 - h.delay) / (h.ms - h.delay);   // the delay is just a pinch: nothing yet
      if (k > 0) moveBox.show(holding, 'hold', Math.min(1, k)); else moveBox.hide();
    } else moveBox.hide();
    moveBox.update();
    });
    guard('revelio', () => revelio.update(performance.now(), quest ? quest.rays() : []));
    guard('turntables', () => updateTurntables(performance.now()));
    if (!IS_QUEST) guard('overlay', () => updateOverlay(now));
    if (frame) guard('occlusion', () => occlusion.update(frame, refSpace));
    if (frame) guard('lighting', () => lighting.update(frame));
    if (frame) guard('fps meter', () => fpsHud.update(now, { workMs: lastWorkMs, target: session?.frameRate || 72, viewer: lastViewer, apps: runtime.frameCosts() }));
    const tr = performance.now();
    renderSafe();
    frameParts.set('render', performance.now() - tr);
    if (frame && pixelSamples.length) guard('pixels', () => samplePixels(frame));
    if (frame && feed && !probeOff.has('camera')) guard('camera', () => {   // after render: raw GL work + capture
      const cap = feed.update(frame, refSpace, { wantCapture: tracker.idle });
      if (cap) {
        if (mapper?.wantsImage(cap.time)) {   // the map keeps a small grayscale copy (visual SLAM experiments), ≤ 1/s
          const g = grayFromRGBA(new Uint8Array(cap.data), cap.width, cap.height);
          mapper.noteImage({ gray: g.gray, w: g.w, h: g.h, fx: cap.K.fx * g.scale, fy: cap.K.fy * g.scale, cx: cap.K.cx * g.scale, cy: cap.K.cy * g.scale,
            cameraWorld: cap.cameraWorld, time: cap.time });
        }
        tracker.submit(cap);
      }
    });
    if (questFeed && tracker && !probeOff.has('camera')) guard('camera', () => questFeed.tick(now, questCameraContext(now)));   // Quest: maybe look for tags now (worker)
    lastWorkMs = performance.now() - now;
    // (Emulated: the desktop's frame rate says nothing about a headset's, so the watchdog leaves it alone.)
    if (frame) guard('perf', () => runtime.noteFrame({ ...meter.tick(now, lastWorkMs, session?.frameRate || 72), emulated: EMULATED }));
    if (frame) noteLongFrame(now, lastWorkMs, now - lastFrameAt, 1000 / (session?.frameRate || 72));
    if (frame && probe.running) guard('probe', () => probe.tick(now, lastWorkMs));
    lastFrameAt = now;
  }

  if (IS_QUEST) world.resolve(session);
}

// ---- phone input -------------------------------------------------------------------

// The hand ray's shape (tilt from the palm, start point, smoothing): js/input/handray.js (tune it at /raytest).
const raycaster = new THREE.Raycaster();
raycaster.camera = camera;   // sprites (labels, health bars) need one to be hit-tested; without it three.js throws every frame

// ---- crash isolation (DESIGN.md §6.1): an app's error stops that app, not the page ----

const loopErrs = new Map();   // step → { n, at }: unattributed errors, logged at most every 5 s per step
function loopError(where, err) {
  const appId = runtime?.appFromError(err);
  if (appId) return void runtime.crash(appId, err, where);
  const e = loopErrs.get(where) ?? { n: 0, at: 0 };
  e.n++;
  if (performance.now() - e.at > 5000) {
    telemetry.error(`frame step '${where}' failed (${e.n}×): ${err?.message ?? err}`, { stack: err?.stack });
    e.at = performance.now(); e.n = 0;
  }
  loopErrs.set(where, e);
}
// Each guarded step is timed (a few timer reads a frame): a long frame is logged with where its time went.
const frameParts = new Map();
function guard(where, fn) {
  const t = performance.now();
  try { fn(); } catch (err) { loopError(where, err); }
  frameParts.set(where, (frameParts.get(where) ?? 0) + performance.now() - t);
}

// A frame whose own work took over LONG_FRAME_MS, or that came over 3 frames
// late (drawing / the system), is logged with its breakdown: at most once per
// LONG_LOG_MS, with how many there were since.
const LONG_FRAME_MS = 40, LONG_LOG_MS = 2000;
const longFrames = { at: 0, count: 0, worst: 0 };
function noteLongFrame(now, workMs, gapMs, budgetMs) {
  const long = workMs > LONG_FRAME_MS || (gapMs > budgetMs * 3 && gapMs < 1000);   // (a gap over 1 s: a pause, the headset off)
  if (long) { longFrames.count++; longFrames.worst = Math.max(longFrames.worst, workMs); }
  if (long && now - longFrames.at > LONG_LOG_MS) {
    const parts = Object.fromEntries([...frameParts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, +v.toFixed(1)]));
    const apps = runtime.frameCosts().filter((a) => a.ms > 0.5).sort((a, b) => b.ms - a.ms).slice(0, 4).map((a) => ({ app: a.id, ms: +a.ms.toFixed(1), tris: a.tris, draws: a.draws }));
    telemetry.warn('long frame', { workMs: +workMs.toFixed(1), gapMs: +gapMs.toFixed(1), parts, apps, since: longFrames.count, worstMs: +longFrames.worst.toFixed(1),
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : undefined });
    longFrames.at = now; longFrames.count = 0; longFrames.worst = 0;
  }
  frameParts.clear();
}

// A render that throws (an app's object) drops the whole picture, so find whose:
// by the stack if it says; else, if it keeps failing, stop the newest app first.
let renderFails = 0;
function renderSafe() {
  try {
    renderer.render(scene, camera);
    renderFails = 0;
  } catch (err) {
    const appId = runtime?.appFromError(err);
    const suspect = !appId && ++renderFails >= 2 ? runtime?.suspect() : null;
    if (appId) runtime.crash(appId, err, 'render');
    else if (suspect) { renderFails = 0; runtime.crash(suspect, err, 'render (suspected)'); }
    else loopError('render', err);
  }
}

// Errors that escape anywhere (timers, callbacks, promises): an app's count toward stopping it.
addEventListener('error', (e) => runtime?.looseError(e.error));
addEventListener('unhandledrejection', (e) => runtime?.looseError(e.reason));

// raycaster.intersectObjects(world.pickables(), true), except that an object
// whose raycast throws (an app's odd object) is skipped and its app stopped,
// instead of the error ending the frame for everything.
function pickHits() {
  const hits = [], bad = [];
  const visit = (o) => {
    let deeper = true;
    if (o.layers.test(raycaster.layers)) {
      try {
        if (o.raycast(raycaster, hits) === false) deeper = false;
      } catch (err) {
        deeper = false;
        const { inst } = runtime?.ownerOf(o) ?? {};
        if (inst) { bad.push(inst.root); runtime.crash(inst, err, 'hit test'); } else { o.raycast = () => {}; loopError('hit test', err); }
      }
    }
    if (deeper) for (const c of o.children) visit(c);
  };
  for (const o of world.pickables()) visit(o);
  const under = (obj, root) => { for (let n = obj; n; n = n.parent) if (n === root) return true; return false; };
  return (bad.length ? hits.filter((h) => !bad.some((r) => under(h.object, r))) : hits).sort((a, b) => a.distance - b.distance);
}

function rayFrom(pose) {
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
  return { origin: new THREE.Vector3().setFromMatrixPosition(m), dir: new THREE.Vector3(0, 0, -1).transformDirection(m) };
}

function phoneSelect(e, refSpace) {
  if (touch.carrying) return touchRelease();   // put down what "Move" picked up
  if (touch.consumed) return;   // that touch was a drag or a swipe, not a tap
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, refSpace);
  if (!pose) return;
  const { origin, dir } = rayFrom(pose);
  const glow = revelio.pick({ origin, dir });   // Revelio is showing hidden things: a tap on one brings it back
  if (glow) return void revealObject(glow.id);

  // 1. Tapped an app's content → the app handles it; any other object → select it.
  raycaster.set(origin, dir);
  const hit = pickHits()[0];
  if (hit) {
    const id = world.objectIdFor(hit.object);
    if (ttArrow(hit.object)) return void stepTurntable(id, ttArrow(hit.object));   // a turntable's ‹ ›
    const tookIt = runtime.select(hit, { origin, dir });   // e.g. click on a browser pane
    if (!tookIt || id !== selectedId) select(id);           // and show its edit tools
    return;
  }
  if (!armed) return select(null);   // empty space + nothing armed: never create

  // 2. Armed: place it on the surface (or ahead), once. Wall items hang flat on a wall.
  const item = paletteItems().find((i) => i.key === armed);
  const mount = mountFor(item, { origin, dir }, reticle.visible ? reticle.matrix : null, lastViewer?.position ?? origin);
  if (mount) return placeItem(world.spaceNear(mount.pos) ?? world.temporarySpace(), mount.pos, mount.quat);
  const pos = reticle.visible
    ? new THREE.Vector3().setFromMatrixPosition(reticle.matrix)
    : origin.clone().addScaledVector(dir, PHONE_SPAWN_DIST);
  // A saved (tag) Space if one is aligned, else this session's temporary one.
  const space = world.spaceNear(pos) ?? world.temporarySpace();
  // Not e.frame.getViewerPose(): only animation frames allow it (Chrome
  // throws on input-event frames). Use the pose from the last drawn frame.
  const head = lastViewer?.position ?? origin;
  placeItem(space, pos, yawFacing(pos, head));
}

// Touch gestures (phones). Two event streams describe the same touch:
//   XR transient input ('screen' source, selectstart → select → selectend):
//     its targetRaySpace is the exact ray under the finger, every frame.
//     Drags use it, so the held point can't drift from the finger.
//   DOM pointer events on the overlay root: pixel deltas for app swipes
//     (pane scrolling, golf putts).
// Rules (phones): a tap is always a tap (an app's content gets it; other
// objects get selected). Press and hold (runtime.moveTiming, finger still; a ring
// fills under the finger) picks anything up to move it. Moving the finger
// before that is a swipe (pane scrolling, golf putts). A touch that became a
// drag or a swipe does not also count as a tap.
const touch = { src: null, hit: null, drag: null, timer: null, consumed: false, lastRay: null, carrying: false };

// "Move" (object tools, or an app's ctx.move()): pick it up without a
// gesture. It rides on the aim (phone: screen-center dot; Quest: the pointer
// ray) at its current distance until the next tap / pinch puts it down.
function carry(id) {
  const root = world.objects.get(id)?.built?.root;
  if (!root || !lastViewer) return;
  if (touch.drag) touchRelease();
  const src = quest?.pointer() ?? null;
  const ray = src ? quest.sources.get(src)?.ray : null;
  if (quest && !ray) return;
  root.updateWorldMatrix(true, false);
  const point = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  Object.assign(touch, { src, hit: null, consumed: true, carrying: true, lastRay: ray });
  startDrag(id, { point, distance: Math.max(0.4, point.distanceTo(ray?.origin ?? lastViewer.position)) });
  log(quest ? 'Carrying it: pinch to put it down' : 'Carrying it: tap to put it down');
}

function isHandle(node) {
  for (let n = node; n; n = n.parent) if (n.userData?.handle) return true;
  return false;
}

function phoneTouchStart(e, refSpace) {
  if (e.inputSource.targetRayMode !== 'screen' || touch.carrying) return;   // carrying: this tap puts it down
  clearTimeout(touch.timer);
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, refSpace);
  Object.assign(touch, { src: e.inputSource, hit: null, drag: null, consumed: false, lastRay: pose && rayFrom(pose) });
  if (!touch.lastRay) return;
  if (revelio.pick(touch.lastRay)) return;   // on a glow: the tap reveals it (phoneSelect), nothing else
  raycaster.set(touch.lastRay.origin, touch.lastRay.dir);
  const hit = pickHits()[0];
  touch.hit = hit ?? null;
  // Games take presses (flippers) before anything else: not a tap, not a hold.
  const view = lastViewer && touch.lastRay.dir.clone().applyQuaternion(lastViewer.quaternion.clone().invert());
  if (runtime.press({ phase: 'down', id: e.inputSource, hit: hit ?? null, side: view && view.x < 0 ? 'left' : 'right', source: 'touch', ray: () => touch.lastRay })) {
    touch.consumed = true;
    touch.pressed = true;
    return;
  }
  const id = hit && world.objectIdFor(hit.object);
  if (!id) return;
  // A tap always taps (apps get it: toggle the switch, click the page). Only a
  // hold with the finger still picks the object up; moving first is a swipe.
  const { delay, duration } = runtime.moveTiming(hit, 'touch');
  touch.holding = { id, t0: performance.now(), delay, ms: delay + duration };
  const fill = $('ov-hold').querySelector('.fill');
  if (fill) fill.style.animationDuration = `${delay + duration}ms`;
  touch.timer = setTimeout(() => {
    touch.holding = null;
    if (touch.src === e.inputSource && !swipe.active && runtime.mayMove(hit, 'hold', 'touch')) startDrag(id, hit);
  }, delay + duration);
}

// The hold-to-move ring under the finger: fills over the hold time, pops
// when the object is picked up. holdRing(x, y) start · holdRing(null) cancel ·
// holdRing('picked') done.
function holdRing(x, y) {
  const ring = $('ov-hold');
  if (x === 'picked') { ring.classList.remove('filling'); ring.classList.add('picked'); setTimeout(() => { ring.hidden = true; ring.classList.remove('picked'); }, 260); return; }
  if (x == null) { if (!ring.classList.contains('picked')) ring.hidden = true; ring.classList.remove('filling'); return; }
  ring.style.left = `${x}px`; ring.style.top = `${y}px`;
  ring.hidden = false;
  ring.classList.remove('filling', 'picked');
  void ring.offsetWidth;   // restart the animation
  ring.classList.add('filling');
}

function startDrag(id, hit) {
  // Remember WHERE on the object it was grabbed (object-local), so that
  // point stays under the finger.
  const root = world.objects.get(id)?.built?.root;
  if (!root) return;
  root.updateWorldMatrix(true, false);
  const grabLocal = hit.point.clone().applyMatrix4(root.matrixWorld.clone().invert());
  touch.drag = { id, dist: hit.distance, grabLocal };
  touch.consumed = true;   // not a tap
  holdRing('picked');
  if (id !== selectedId) select(id);
  navigator.vibrate?.(15);
  pulse(touch.src, 0.8, 60);
  telemetry.info('drag start', { id: id.slice(0, 8), dist: +hit.distance.toFixed(3) });
}

// Every frame while held: follow the touch's own XR ray.
function touchFrame(frame, refSpace) {
  if (touch.pressed && touch.src) {   // an app's press: keep its ray current (e.ray())
    const pose = frame.getPose(touch.src.targetRaySpace, refSpace);
    if (pose) touch.lastRay = rayFrom(pose);
  }
  if (!touch.drag) return;
  if (!touch.src) {   // carried from a menu on a phone: follows the screen-center dot
    if (!touch.carrying || !lastViewer) return;
    touch.lastRay = { origin: lastViewer.position.clone(), dir: new THREE.Vector3(0, 0, -1).applyQuaternion(lastViewer.quaternion) };
    return dragUpdate(touch.lastRay, false);
  }
  const pose = frame.getPose(touch.src.targetRaySpace, refSpace);
  if (!pose) return;
  touch.lastRay = rayFrom(pose);
  dragUpdate(touch.lastRay, false);
}

function phoneTouchEnd(e) {
  if (e.inputSource !== touch.src) return;
  if (touch.pressed) { touch.pressed = false; runtime.press({ phase: 'up', id: e.inputSource }); }
  touchRelease();
}

function touchRelease() {
  clearTimeout(touch.timer);
  touch.holding = null;
  if (touch.drag) {
    dragUpdate(touch.lastRay, true);
    telemetry.info('drag end', { id: touch.drag.id.slice(0, 8) });
    afterDrop(touch.drag.id);   // onto a turntable / off one
  }
  touch.src = touch.drag = touch.hit = touch.two = null;
  touch.carrying = false;
  // `select` (the tap) already fired before selectend; clear the flag for the next touch.
  setTimeout(() => { if (!touch.src) touch.consumed = false; }, 0);
}

// Carry the dragged object: the grabbed point sits on the touch ray at its
// grab distance, so it follows the finger and the phone (turn or walk while
// holding). It turns to face the viewer. Saved once, on release.
function dragUpdate(ray, save) {
  const d = touch.drag;
  const e = d && world.objects.get(d.id);
  if (!e || !ray || !lastViewer) return;
  const space = world.spaces.get(e.data.space);
  let worldM;
  if (touch.two) worldM = twoHandMatrix(ray);
  if (!worldM) {
    const target = ray.origin.clone().addScaledVector(ray.dir, d.dist);   // where the grab point goes
    const quat = yawFacing(target, lastViewer.position);
    if (d.turn) quat.multiply(d.turn);                                    // a two-hand turn sticks
    const scale = new THREE.Vector3().fromArray(e.data.pose.s ?? [1, 1, 1]);
    const pos = target.clone().sub(d.grabLocal.clone().multiply(scale).applyQuaternion(quat));
    worldM = new THREE.Matrix4().compose(pos, quat, scale);
  }
  const local = space.root.matrix.clone().invert().multiply(worldM);
  if (save) return world.edit(e.data.id, (m) => m.copy(local));
  const pose = matrixToPose(local);
  world.apply({ ...e.data, pose, rev: (e.data.rev ?? 0) + 0.001 });   // preview, not saved
  // Others see it move live (~15 Hz); the save on release is what sticks.
  const now = performance.now();
  if (!space.temporary && now - (d.sentAt ?? 0) > 66) {
    d.sentAt = now;
    world.live.send({ t: 'move', id: e.data.id, space: space.id, layer: e.data.layer, pose });
  }
}

// Two hands (Quest): while one hand moves something, the other pinches (or
// grips) anywhere to join. Both hands then hold it: moving them apart / together
// scales it about their midpoint, turning the pair turns it (about vertical,
// so it stays upright), and moving both carries it. Letting go of the second
// hand goes back to one-hand moving from where it is; letting go of the first
// puts it down.
const SCALE_MIN = 0.05, SCALE_MAX = 20;
const handPoint = (src) => quest?.sources.get(src)?.ray?.origin?.clone() ?? null;
const pairYaw = (v) => Math.atan2(-v.z, v.x);

function startTwoHand(src) {
  const e = touch.drag && world.objects.get(touch.drag.id);
  const root = e?.built?.root;
  const a = handPoint(touch.src), b = handPoint(src);
  if (!root || !a || !b || a.distanceTo(b) < 0.03) return false;
  root.updateWorldMatrix(true, false);
  touch.two = { src, a0: a, b0: b, mid0: a.clone().add(b).multiplyScalar(0.5), M0: root.matrixWorld.clone(),
    s0: new THREE.Vector3().fromArray(e.data.pose.s ?? [1, 1, 1]) };
  navigator.vibrate?.(10);
  pulse(src);
  telemetry.info('two-hand start', { id: touch.drag.id.slice(0, 8) });
  return true;
}

function twoHandMatrix() {
  const t = touch.two, a = handPoint(touch.src), b = handPoint(t.src);
  if (!a || !b) return null;
  const v0 = t.b0.clone().sub(t.a0), v = b.clone().sub(a);
  const smax = Math.max(t.s0.x, t.s0.y, t.s0.z), smin = Math.min(t.s0.x, t.s0.y, t.s0.z);
  const k = THREE.MathUtils.clamp(v.length() / Math.max(v0.length(), 0.01), SCALE_MIN / smin, SCALE_MAX / smax);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const turn = new THREE.Matrix4().makeRotationY(pairYaw(v) - pairYaw(v0));
  return new THREE.Matrix4().makeTranslation(mid.x, mid.y, mid.z).multiply(turn)
    .multiply(new THREE.Matrix4().makeScale(k, k, k))
    .multiply(new THREE.Matrix4().makeTranslation(-t.mid0.x, -t.mid0.y, -t.mid0.z)).multiply(t.M0);
}

// The second hand let go: keep holding it with the first, from where it is now.
function endTwoHand() {
  const d = touch.drag, root = d && world.objects.get(d.id)?.built?.root, ray = touch.lastRay;
  touch.two = null;
  if (!root || !ray || !lastViewer) return;
  root.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  root.matrixWorld.decompose(pos, quat, scl);
  d.dist = Math.max(0.2, pos.distanceTo(ray.origin));
  const target = ray.origin.clone().addScaledVector(ray.dir, d.dist);
  d.grabLocal = target.clone().applyMatrix4(root.matrixWorld.clone().invert());
  d.turn = yawFacing(target, lastViewer.position).invert().multiply(quat);
}

function pulse(src, k = 0.6, ms = 40) {
  try { src?.gamepad?.hapticActuators?.[0]?.pulse?.(k, ms); } catch { /* no haptics */ }
}

// DOM side: swipes for apps, long-press cancel when the finger moves first.
const swipe = { down: null, last: null, active: false };

function screenRay(x, y) {
  const cam = renderer.xr.getCamera().cameras[0];
  if (!cam) return null;
  raycaster.setFromCamera(new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
  return raycaster.ray;
}

function screenHit(x, y) {
  if (!screenRay(x, y)) return null;
  return pickHits()[0] ?? null;
}

// No browser long-press menu / text selection over the AR view: they cancel
// the touch after ~1 s (which used to drop held objects).
$('overlay').addEventListener('contextmenu', (e) => e.preventDefault());

$('overlay').addEventListener('pointerdown', (e) => {
  if (e.target.closest?.('.ui') || !renderer.xr.isPresenting) return;
  swipe.down = { x: e.clientX, y: e.clientY, t: performance.now(), hit: screenHit(e.clientX, e.clientY) };
  if (swipe.down.hit) holdRing(e.clientX, e.clientY);
  swipe.last = { x: e.clientX, y: e.clientY };
  swipe.active = false;
});
$('overlay').addEventListener('pointermove', (e) => {
  if (!swipe.down) return;
  swipe.last = { x: e.clientX, y: e.clientY };
  const dx = e.clientX - swipe.down.x, dy = e.clientY - swipe.down.y;
  if (!touch.drag && Math.hypot(dx, dy) > 12) { clearTimeout(touch.timer); touch.holding = null; holdRing(null); }   // moved first: a swipe, not a hold
  if (touch.drag) return;                                                   // a drag owns this touch
  if (!swipe.active && Math.hypot(dx, dy) > 18 && wantsSwipes(swipe.down.hit)) swipe.active = true;
  if (!swipe.active) return;
  touch.consumed = true;
  sendSwipe({ phase: 'move', dx, dy, w: innerWidth, h: innerHeight, ms: performance.now() - swipe.down.t, hit: swipe.down.hit, source: 'touch' });
});
function endSwipe(e) {
  holdRing(null);
  if (!swipe.down) return;
  if (e.type === 'pointercancel') telemetry.info('pointercancel', { drag: !!touch.drag });
  if (swipe.active) {
    // pointercancel carries no useful position: use the last real one.
    const at = e.type === 'pointercancel' ? swipe.last : { x: e.clientX, y: e.clientY };
    sendSwipe({ phase: 'end', dx: at.x - swipe.down.x, dy: at.y - swipe.down.y, w: innerWidth, h: innerHeight, ms: performance.now() - swipe.down.t, hit: swipe.down.hit, source: 'touch' });
    touch.consumed = true;
  }
  swipe.down = null;
  swipe.active = false;
}
$('overlay').addEventListener('pointerup', endSwipe);
$('overlay').addEventListener('pointercancel', endSwipe);

window.__app.screenPointOf = (xyz) => {   // test helper: screen position of a world point
  const cam = renderer.xr.getCamera().cameras[0];
  const c = new THREE.Vector3(...xyz).project(cam);
  return { x: ((c.x + 1) / 2) * innerWidth, y: ((1 - c.y) / 2) * innerHeight };
};
window.__app.screenPoint = (id) => {   // test helper: where an object appears on screen
  const root = world.objects.get(id)?.built?.root;
  const cam = renderer.xr.getCamera().cameras[0];
  if (!root || !cam) return null;
  const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()).project(cam);
  return { x: ((c.x + 1) / 2) * innerWidth, y: ((1 - c.y) / 2) * innerHeight };
};

function placeItem(space, pos, quat) {
  // Phones: the armed item, once. Quest (no palette UI yet): a cube.
  const item = paletteItems().find((i) => i.key === armed) ?? BUILTIN[0];
  if (armed) arm(null);
  noteRecent(item.key);
  const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  const layer = layerFor(space, item);
  const comps = item.components();
  if (comps.app) runtime.expectFresh = { app: comps.app.app, at: performance.now() };   // its app instance: "you just placed this"
  world.place(space, m, layer, comps).then((o) => {
    if (o) log(`placed ${item.label.trim()} in "${space.name}"${layer === space.sharedLayer ? ' (shared)' : ''}`);
  });
}

// ---- Quest input ---------------------------------------------------------------------
//   Hands (tracked): drawn as a light joint/bone overlay; pinch = trigger
//   (the browser sends select); left palm toward your face opens the menu.
//   Y (left)        open/close the hand menu (the ≡ button is reserved by the browser)
//   trigger         press a menu button · select an object (apps get the click) ·
//                   place the armed item · on empty space: deselect (never creates)
//   grip (hold)     grab and carry what the ray touches, saved on release
const PLACED_REACH = 0.3;          // m: index tip this close to a placed keyboard = you're reaching for it
const PLACED_STANDING = 0.9;       // m: head this close when typing starts: use the placed keyboard
// A placed keyboard lies on its base, keys facing up, tilted a little toward you.
const PLACED_KB_POSE = new THREE.Matrix4().makeTranslation(0, 0.016, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.17));
const HOLD_WOBBLE = THREE.MathUtils.degToRad(2.5);   // more ray movement than this: not a hold
const MENU_BUTTON = 5;          // xr-standard: left Y
const QUEST_AHEAD = 0.6;        // m along the ray when no surface is hit
const PALM_OPEN = 0.6, PALM_CLOSE = 0.15;   // palm-to-face facing (cos) to open / close the menu
const PALM_OPEN_MS = 250, PALM_CLOSE_MS = 450;
const PALM_MAX_DROP = 0.55, PALM_VIEW_RAD = 0.9;    // the hand within 55 cm below the eyes and ~50° of where you look
const showHands = () => localStorage.getItem('stratum.hands') !== '0';
const INDEX_TIP = 9;
// Keyboard gesture: both index fingers pointing down (cos to straight down),
// hands out in front of you (not hanging at your sides), held this long.
const SUMMON_DOWN = 0.65, SUMMON_FORWARD = 0.18, SUMMON_MS = 1200;
// Scrolling on the Quest (DESIGN.md §8.7): drag app content with the trigger
// / a pinch, or hold index + middle out (ring + pinky curled) and move the
// hand. Hand travel → swipe units like a phone finger's screen px.
const SCROLL_PX_PER_M = 3000, SCROLL_START_M = 0.012, TWO_FINGER_MS = 150, TWO_FINGER_LOST_MS = 150;
const SCROLL_TINT = 0x5bffb0;           // WebXR hand joint: index-finger-tip

class QuestInput {
  constructor(session, refSpace) {
    this.session = session;
    this.refSpace = refSpace;
    this.sources = new Map();   // XRInputSource -> { hitSource, reticle, hit, ray, line, menuWas }
    this.menu = new Menu(scene, menuProvider);
    this.menu.scale = menuScale();
    this.hands = new HandView(scene);
    this.hands.setVisible(showHands());
    this.keyboard = new Keyboard(scene);
    this.keyboard.setLayout(localStorage.getItem('stratum.kbLayout') ?? 'simple');
    this.placed = new Map();   // object id → Keyboard({ fixed }): keyboards placed in a Space
    this.palm = { since: 0, by: false };   // palm-up timing; by: the menu was opened by the palm
    this.gestures = new HandGestures();    // Revelio / shoo (DESIGN.md §8.7)
    this.shoo = {};                        // side → { id } armed by fingertips together on a visible thing
    this.swallow = new Map();              // input source → until (ms): its pinch belongs to a gesture, not a click / hold
    this.loggedButtons = false;
    this.on = {
      inputsourceschange: (e) => { e.removed.forEach((s) => this.remove(s)); e.added.forEach((s) => this.add(s)); },
      select: (e) => this.select(e),
      squeezestart: (e) => { if (!this.joinMove(e)) this.grab(e); },
      squeezeend: (e) => { if (this.leaveMove(e)) return; if (!this.dropMenu(e.inputSource) && e.inputSource === touch.src) touchRelease(); },
      // Pinch/trigger held on the menu's top bar carries it (release puts it down).
      selectstart: (e) => { unlockSound(); if (this.padDown(e)) return; if (this.revelioDown(e)) return; if (this.joinMove(e)) return; if (!this.grabMenu(e, false) && !this.press(e, 'down')) { this.startHold(e); this.startRayScroll(e); } },
      selectend: (e) => {
        if (this.leaveMove(e)) return;
        this.dropMenu(e.inputSource);
        if (this.press(e, 'up')) return;
        if (this.hold?.src === e.inputSource) this.hold = null;
        if (this.swallowed(e.inputSource)) { this.swallow.set(e.inputSource, performance.now() + 400); this.endRayScroll(e.inputSource); return; }
        if (touch.drag && !touch.carrying && touch.src === e.inputSource) {   // end of a hold-to-move
          this.lastDropAt = { src: e.inputSource, t: performance.now() };   // (if select comes after: not a click)
          return void touchRelease();
        }
        this.endRayScroll(e.inputSource);
      },
    };
    for (const [type, fn] of Object.entries(this.on)) session.addEventListener(type, fn);
    for (const type of ['selectstart', 'selectend', 'squeezestart', 'squeezeend'])   // (labels for the hand recording: the system pinch / grab)
      session.addEventListener(type, (e) => handRec.event('xr', { type, side: e.inputSource.handedness, hand: !!e.inputSource.hand }));
    for (const s of session.inputSources) this.add(s);
  }

  add(src) {
    if (src.targetRayMode !== 'tracked-pointer' || this.sources.has(src)) return;
    const r = reticle.clone();
    r.material = reticle.material.clone();
    scene.add(r);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: RETICLE_COLOR, transparent: true, opacity: 0.55 }));
    line.matrixAutoUpdate = false;
    scene.add(line);
    // The cursor dot: where a press along the ray would land (drawn over everything).
    const dot = new THREE.Mesh(CURSOR_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }));
    dot.add(new THREE.Mesh(CURSOR_RING, new THREE.MeshBasicMaterial({ color: 0x1b2a4a, depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 })));
    dot.renderOrder = 9990; dot.children[0].renderOrder = 9989;
    dot.raycast = () => {}; dot.children[0].raycast = () => {};
    dot.visible = false;
    scene.add(dot);
    const entry = { hitSource: null, reticle: r, hit: null, ray: null, line, dot, cursor: null, menuWas: false };
    this.sources.set(src, entry);
    // Hands aim along the hand (handRays), so hit-test along the wrist's −Z (the same line, from the wrist).
    const want = (space) => this.session.requestHitTestSource?.({ space }).then((h) => { entry.hitSource = h; });
    const wrist = src.hand?.get?.('wrist');
    (wrist ? want(wrist).catch(() => want(src.targetRaySpace)) : want(src.targetRaySpace))?.catch(() => {});
  }

  remove(src) {
    const e = this.sources.get(src);
    if (!e) return;
    e.hitSource?.cancel();
    e.reticle.removeFromParent();
    e.line.removeFromParent();
    e.dot.removeFromParent();
    this.sources.delete(src);
  }

  dispose() {
    for (const s of [...this.sources.keys()]) this.remove(s);
    for (const [type, fn] of Object.entries(this.on)) this.session.removeEventListener(type, fn);
    this.menu.group.removeFromParent();
    this.hands.dispose();
    this.keyboard.dispose();
    for (const kb of this.placed.values()) kb.dispose();
  }

  left() { return [...this.sources.keys()].find((s) => s.handedness === 'left'); }
  pointer() {   // the hand that points: right, else whichever isn't holding the menu
    const all = [...this.sources.keys()];
    return all.find((s) => s.handedness === 'right') ?? all.find((s) => !(this.menu.open && s.handedness === 'left')) ?? null;
  }

  update(frame) {
    let leftGrip = null;
    for (const [src, e] of this.sources) {
      const pose = e.hitSource && frame.getHitTestResults(e.hitSource)[0]?.getPose(this.refSpace);
      e.hit = pose ? new THREE.Matrix4().fromArray(pose.transform.matrix) : null;
      const rp = frame.getPose(src.targetRaySpace, this.refSpace);
      e.ray = rp ? rayFrom(rp) : null;
      e.pose = rp ? new THREE.Matrix4().fromArray(rp.transform.matrix) : null;
      if (src.handedness === 'left' && src.gripSpace) {
        const g = frame.getPose(src.gripSpace, this.refSpace);
        if (g) leftGrip = new THREE.Matrix4().fromArray(g.transform.matrix);
      }
      // Menu toggle on the left Y button (edge-triggered).
      const pads = src.gamepad?.buttons ?? [];
      if (src.handedness === 'left') {
        const down = !!pads[MENU_BUTTON]?.pressed;
        if (down && !e.menuWas) { this.menu.toggle(); this.palm.by = false; }
        e.menuWas = down;
      }
      if (!this.loggedButtons && pads.length > 7) {   // in case the browser exposes more (e.g. ≡)
        this.loggedButtons = true;
        telemetry.info('controller buttons', { hand: src.handedness, count: pads.length, profiles: src.profiles });
      }
    }
    // Hands: draw, then the palm-up menu gesture (left hand).
    this.hands.update(frame, this.refSpace, this.session.inputSources, lastViewer?.position);
    this.handRays();
    this.frameNo = (this.frameNo ?? 0) + 1;
    if (!this.loggedHands && (this.hands.tracked.left || this.hands.tracked.right)) {
      this.loggedHands = true;
      telemetry.info('hands tracked', { ...this.hands.tracked, sources: [...this.session.inputSources].map((s) => `${s.handedness}:${s.hand ? 'hand' : 'controller'}`) });
    }
    const labelling = labelPad.visible;   // (labelling mode: gestures are what you're recording, not commands)
    if (!labelling) this.palmMenu(performance.now());
    if (!labelling) this.summonGesture(performance.now());
    this.checkHold(performance.now());
    this.updateRayScroll();
    if (!labelling) this.twoFingerScroll(performance.now());
    this.revelioGestures(performance.now());
    if (labelling) {
      const tips = ['left', 'right'].filter((sd) => this.hands.tracked[sd]).map((sd) => ({ id: sd, pos: this.hands.hands[sd].pos[INDEX_TIP] }));
      labelPad.update(performance.now(), lastViewer, tips);
    }
    // The menu rides on the left palm (tracked hand) or above the left controller.
    const attach = this.hands.tracked.left ? { matrix: this.hands.wrist('left'), palm: true } : leftGrip ? { matrix: leftGrip, palm: false } : null;
    if (this.menuHold) {
      const held = this.sources.get(this.menuHold.src);
      if (held?.pose) this.menuHold.target.carry(held.pose); else this.dropMenu(this.menuHold.src);
    }
    const ptr = this.pointer();
    for (const [src, e] of this.sources) {
      const isPtr = src === ptr;
      e.reticle.visible = !!e.hit && isPtr;
      if (e.hit) e.reticle.matrix.copy(e.hit);
      e.line.visible = !!e.ray && (isPtr || !this.menu.open);
      e.dot.visible = false;
      if (e.ray) {
        const onUi = isPtr && ((this.menu.open && this.menu.hit(e.ray)) || this.kbHit(e.ray));
        if (isPtr && !onUi) {
          // (every other frame: a ray against everything isn't free)
          if (!e.cursorAt || this.frameNo % 2 === 0) e.cursor = cursorAt(e.ray);
          e.cursorAt = true;
          if (e.cursor) {
            const d = e.cursor.distanceTo(e.ray.origin);
            e.dot.position.copy(e.cursor);
            e.dot.quaternion.copy(lastViewer?.quaternion ?? e.dot.quaternion);
            e.dot.scale.setScalar(Math.max(0.6, Math.min(4, d)));   // about the same size at any distance
            e.dot.visible = true;
          }
        }
        const len = onUi ? 0.25 : isPtr && e.cursor ? e.cursor.distanceTo(e.ray.origin) : e.hit ? e.ray.origin.distanceTo(new THREE.Vector3().setFromMatrixPosition(e.hit)) : 1.5;
        e.line.matrix.lookAt(e.ray.origin, e.ray.origin.clone().add(e.ray.dir), new THREE.Vector3(0, 1, 0)).setPosition(e.ray.origin);
        e.line.matrix.scale(new THREE.Vector3(1, 1, len));
        e.line.matrixWorldNeedsUpdate = true;
      }
    }
    // Index fingertips poke the menu: the right one always, the left one once the menu is off that hand.
    const tips = [];
    if (this.hands.tracked.right) tips.push({ id: 'right', p: this.hands.joint('right', INDEX_TIP) });
    if (this.hands.tracked.left && this.menu.mode !== 'hand') tips.push({ id: 'left', p: this.hands.joint('left', INDEX_TIP) });
    this.menu.update(attach, lastViewer?.position, ptr && this.sources.get(ptr)?.ray, tips);
    // The keyboard takes both index tips (it's never on a hand).
    const kbTips = ['left', 'right'].filter((h) => this.hands.tracked[h]).map((h) => ({ id: h, p: this.hands.joint(h, INDEX_TIP) }));
    this.keyboard.update(lastViewer, ptr && this.sources.get(ptr)?.ray, kbTips);
    this.updatePlaced(ptr && this.sources.get(ptr)?.ray, kbTips);
  }

  // ---- hand rays -------------------------------------------------------------------------
  // A tracked hand's ray comes from the hand itself (input/handray.js): out of the
  // palm, leaning toward the fingers (HAND_RAY.tilt), from the palm's centre, so it turns with the palm. The system's hand ray starts
  // near your shoulder / eyes and follows the head, which reads as coming from you.
  // Smoothed a little (tracking jitters). Controllers keep their own ray.
  handRays() {
    for (const [src, e] of this.sources) {
      const side = src.handedness;
      if (!src.hand || !this.hands.tracked[side]) { e.aim = null; continue; }
      const palm = this.hands.hands[side].palm;
      const { origin, dir, along } = handRay(this.hands.hands[side].pos, palm);
      if (e.aim && performance.now() - e.aim.t < 200) {
        e.aim.dir.lerp(dir, HAND_RAY.smoothDir).normalize();
        e.aim.origin.lerp(origin, HAND_RAY.smoothOrigin);
        e.aim.t = performance.now();
      } else e.aim = { dir, origin, t: performance.now() };
      const z = e.aim.dir.clone().negate(), y = along.clone();   // (−Z along the ray, +Y toward the fingers)
      y.addScaledVector(z, -y.dot(z)).normalize();
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(e.aim.origin);
      e.pose = m;
      e.ray = { origin: e.aim.origin.clone(), dir: e.aim.dir.clone() };
    }
  }

  // The pose an input aims with: a tracked hand's own ray (above), else targetRaySpace.
  aimPose(src, frame) {
    const e = this.sources.get(src);
    if (e?.aim && e.pose) return { transform: { matrix: e.pose.elements } };
    return frame.getPose(src.targetRaySpace, this.refSpace);
  }

  // ---- Revelio / shoo (DESIGN.md §8.7) ---------------------------------------------------

  rays() {
    const out = [];
    for (const [src, e] of this.sources) if (e.ray && (src.handedness === 'left' || src.handedness === 'right')) out.push({ side: src.handedness, origin: e.ray.origin, dir: e.ray.dir });
    return out;
  }

  handSource(side) { return [...this.sources.keys()].find((s) => s.handedness === side && s.hand) ?? null; }
  swallowed(src) { return (this.swallow.get(src) ?? 0) > performance.now(); }

  // This input's pinch / trigger is a gesture's now: no click, hold or scroll from it.
  claim(src) {
    if (!src) return;
    this.swallow.set(src, Infinity);
    if (this.hold?.src === src) this.hold = null;
    if (this.rayScroll?.src === src) this.rayScroll = null;
    if (this.pendingClick?.src === src) { this.pendingClick = null; clearTimeout(this.pendingTimer); }
  }

  // Pinch / trigger down while glows show: on a glow, it's Revelio's (hands
  // select it, spreading reveals; a controller's trigger reveals at once).
  // Aim + pinch / trigger on the labelling pad: its button (nothing else gets the press).
  padDown(e) {
    if (!labelPad.visible) return false;
    const ray = this.sources.get(e.inputSource)?.ray;
    if (!ray || !labelPad.pick(ray)) return false;
    this.claim(e.inputSource);
    return true;
  }

  revelioDown(e) {
    const src = e.inputSource;
    if (this.swallowed(src)) return true;
    if (!revelio.active) return false;
    const ray = this.sources.get(src)?.ray;
    const glow = ray && revelio.pick(ray);
    if (!glow) return false;
    this.claim(src);
    if (src.hand) revelio.select(glow.id, src.handedness);
    else revealObject(glow.id);
    return true;
  }

  revelioGestures(now) {
    const head = lastViewer?.position ?? null;
    const gaze = lastViewer ? new THREE.Vector3(0, 0, -1).applyQuaternion(lastViewer.quaternion) : null;
    for (const side of ['left', 'right']) {
      const joints = this.hands.tracked[side] ? this.hands.hands[side].pos : null;
      for (const ev of this.gestures.update(side, joints, head, now, gaze)) this.onGesture(ev, now);
    }
  }

  // The object the five fingertips are together on (objectAt their middle).
  atFingertips(side) {
    const pos = this.hands.hands[side]?.pos;
    if (!this.hands.tracked[side] || !pos) return null;
    const c = new THREE.Vector3();
    for (const i of [4, 9, 14, 19, 24]) c.add(pos[i]);
    return objectAt(c.multiplyScalar(0.2));
  }

  onGesture(ev, now) {
    if (labelPad.visible) { handRec.event('detector', { ...ev }); return; }   // labelling: what the detector saw, nothing done
    const side = ev.side, src = this.handSource(side), ray = src && this.sources.get(src)?.ray;
    if (ev.type === 'cast') castRevelio({ side, how: 'slide', detail: { cm: ev.cm, ms: ev.ms, view: ev.view, away: ev.away, reach: ev.reach } });
    else if (ev.type === 'near') {
      if (now - (this.nearLogged ?? 0) > 2000) { this.nearLogged = now; telemetry.info('revelio near', { side, cm: ev.cm, why: ev.why }); }
    } else if (ev.type === 'gather') {
      const glow = ray && revelio.pick(ray);
      if (glow) { this.claim(src); revelio.select(glow.id, side); return; }
      if (ev.kind !== 'bunch' || this.shoo[side] || touch.drag) return;
      // The thing the fingertips came together on (or in): anywhere on it, not where the ray points.
      let id = this.atFingertips(side);
      if (!id && ray) {
        raycaster.set(ray.origin, ray.dir);
        const hit = pickHits()[0];
        id = hit && world.objectIdFor(hit.object);
      }
      const root = id && world.objects.get(id)?.built?.root;
      if (!root) return;
      this.claim(src);
      this.shoo[side] = { id };
      revelio.arm(root, boundsOf(root));
    } else if (ev.type === 'spread') {
      if (revelio.selected?.side === side) revealObject(revelio.selected.id);
    } else if (ev.type === 'shoo') {
      const t = this.shoo[side];
      this.shoo[side] = null;
      revelio.disarm();
      if (t) shooObject(t.id);
      if (src) this.swallow.set(src, now + 400);
    } else if (ev.type === 'release') {
      if (this.shoo[side]) { this.shoo[side] = null; revelio.disarm(); }
      if (src && this.swallow.get(src) === Infinity) this.swallow.set(src, now + 400);
    }
  }

  // Left palm toward the face for a moment opens the menu; turning it away
  // closes it again (only if the palm opened it; Y-button menus stay).
  // Held up where you're looking at it, not hanging by your side (at a pinball
  // machine, a hanging palm can face you too).
  handRaised(side) {
    const w = this.hands.wrist(side);
    if (!w || !lastViewer) return false;
    const at = new THREE.Vector3().setFromMatrixPosition(w), head = lastViewer.position;
    if (head.y - at.y > PALM_MAX_DROP) return false;
    const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(lastViewer.quaternion);
    return gaze.angleTo(at.clone().sub(head)) < PALM_VIEW_RAD;
  }

  palmMenu(now) {
    if (this.menu.mode !== 'hand') { this.palm.since = 0; return; }   // carried or put down: the palm leaves it alone
    const facing = this.hands.tracked.left ? this.hands.palmFacing('left') : -1;
    const want = this.handRaised('left') && (this.menu.open ? facing > PALM_CLOSE : facing > PALM_OPEN);
    if (want === this.menu.open) { this.palm.since = 0; return; }
    if (!this.palm.since) this.palm.since = now;
    if (!this.menu.open && now - this.palm.since > PALM_OPEN_MS) {
      this.menu.toggle(true);
      this.palm = { since: 0, by: true };
    } else if (this.menu.open && this.palm.by && now - this.palm.since > PALM_CLOSE_MS) {
      this.menu.toggle(false);
      this.palm = { since: 0, by: false };
    }
  }

  clickHit(hit, ray) {
    const id = world.objectIdFor(hit.object);
    if (ttArrow(hit.object)) return void stepTurntable(id, ttArrow(hit.object));   // a turntable's ‹ ›
    const tookIt = runtime.select(hit, ray);
    if (!tookIt || id !== selectedId) select(id);
  }

  // On content that scrolls, a tap is a click only if the trigger / pinch
  // didn't drag. Browsers order select vs selectend differently (the spec:
  // select first; IWER: select before selectstart), so decide at whichever
  // comes last.
  deferClick(src, hit, ray) {
    const end = this.lastEnd?.src === src && performance.now() - this.lastEnd.t < 400 ? this.lastEnd : null;
    if (end) { if (!end.moved) this.clickHit(hit, ray); return; }   // selectend already came
    this.pendingClick = { src, hit, ray };
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {   // no drag ever started (e.g. a quick tap the browser didn't bracket)
      const p = this.pendingClick;
      if (p && !this.rayScroll) { this.pendingClick = null; this.clickHit(p.hit, p.ray); }
    }, 800);
  }

  // ---- scrolling ------------------------------------------------------------------------

  // Swipe units from a world-space hand/ray movement (head right / world up).
  swipeDelta(delta) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(lastViewer?.quaternion ?? new THREE.Quaternion()).setY(0).normalize();
    return { dx: delta.dot(right) * SCROLL_PX_PER_M, dy: -delta.y * SCROLL_PX_PER_M };   // hand up = finger up on a phone
  }

  // Trigger / pinch held on app content that scrolls: moving the ray drags it.
  startRayScroll(e) {
    const rp = this.aimPose(e.inputSource, e.frame);
    if (!rp) return;
    const ray = rayFrom(rp);
    if (this.kbHit(ray) || (this.menu.open && this.menu.hit(ray))) return;
    raycaster.set(ray.origin, ray.dir);
    const hit = pickHits()[0];
    if (!hit || !wantsSwipes(hit)) return;
    this.rayScroll = { src: e.inputSource, hit, dist: hit.distance, p0: hit.point.clone(), moved: false, t0: performance.now() };
  }

  updateRayScroll() {
    const s = this.rayScroll;
    const ray = s && this.sources.get(s.src)?.ray;
    if (!ray) return;
    const delta = ray.origin.clone().addScaledVector(ray.dir, s.dist).sub(s.p0);
    if (!s.moved && delta.length() < Math.max(SCROLL_START_M, s.dist * 0.03)) return;   // ~1.7°: a click's wobble isn't a drag
    s.moved = true;
    s.last = this.swipeDelta(delta);
    sendSwipe({ phase: 'move', ...s.last, ms: performance.now() - s.t0, hit: s.hit, source: 'ray' });
  }

  endRayScroll(src) {
    const s = this.rayScroll;
    if (!s || s.src !== src) return;
    this.rayScroll = null;
    this.lastEnd = { src, t: performance.now(), moved: s.moved };
    const p = this.pendingClick;
    if (p?.src === src) { this.pendingClick = null; clearTimeout(this.pendingTimer); if (!s.moved) this.clickHit(p.hit, p.ray); }
    if (s.moved) sendSwipe({ phase: 'end', ...(s.last ?? { dx: 0, dy: 0 }), ms: performance.now() - s.t0, hit: s.hit, source: 'ray' });
  }

  // Two-finger scroll: index + middle out, the rest curled, then move the
  // hand. Aims like the fingers point (else the app last touched).
  twoFingerScroll(now) {
    this.two ??= {};
    for (const side of ['left', 'right']) {
      const st = this.two[side] ??= { since: 0, lost: 0, active: null };
      const pose = this.hands.tracked[side] && this.hands.twoFingers(side, !!st.active);
      const at = pose && this.hands.joint(side, INDEX_TIP).clone().add(this.hands.joint(side, 14)).multiplyScalar(0.5);
      if (!st.active) {
        if (!pose) { st.since = 0; continue; }
        st.since ||= now;
        if (now - st.since < TWO_FINGER_MS) continue;
        // Start: what the two fingers point at.
        const dir = this.hands.indexDir(side).add(new THREE.Vector3().subVectors(this.hands.joint(side, 14), this.hands.joint(side, 11)).normalize()).normalize();
        raycaster.set(at, dir);
        const hit = pickHits()[0] ?? null;
        const target = hit && runtime.wantsSwipes(hit) ? null : runtime.touched?.id ?? null;
        st.active = { p0: at.clone(), hit: target ? null : hit, target, t0: now, last: { dx: 0, dy: 0 } };
        this.hands.tint(side, SCROLL_TINT);
        telemetry.info('two-finger scroll', { side, target: hit ? 'pointed' : target ? 'last touched' : 'none' });
        continue;
      }
      if (!pose) {
        st.lost ||= now;
        if (now - st.lost < TWO_FINGER_LOST_MS) continue;
        sendSwipe({ phase: 'end', ...st.active.last, ms: now - st.active.t0, hit: st.active.hit, target: st.active.target, source: 'hand' });
        st.active = null; st.since = 0; st.lost = 0;
        this.hands.tint(side, null);
        continue;
      }
      st.lost = 0;
      st.active.last = this.swipeDelta(at.clone().sub(st.active.p0));
      sendSwipe({ phase: 'move', ...st.active.last, ms: now - st.active.t0, hit: st.active.hit, target: st.active.target, source: 'hand' });
    }
  }

  // Both hands held out with index fingers pointing down ("ready to type")
  // for a moment: bring up the keyboard for the app last touched (or the
  // selected one). Fires once per pose; ignored while the keyboard is up.
  typingPose() {
    const head = lastViewer;
    if (!head || !this.hands.tracked.left || !this.hands.tracked.right) return false;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion).setY(0).normalize();
    return ['left', 'right'].every((side) => {
      const dir = this.hands.indexDir(side), tip = this.hands.joint(side, INDEX_TIP);
      const rel = tip.clone().sub(head.position);
      return dir.y < -SUMMON_DOWN && rel.dot(fwd) > SUMMON_FORWARD && rel.y < -0.1 && rel.y > -0.8;
    });
  }

  summonGesture(now) {
    const pose = !this.keyboard.open && !this.atPlaced && this.typingPose();   // at a placed keyboard, fingers down is typing
    if (!pose) { this.summon = null; return; }
    this.summon ??= { since: now, fired: false };
    if (this.summon.fired || now - this.summon.since < SUMMON_MS) return;
    this.summon.fired = true;
    telemetry.info('keyboard gesture');
    if (!runtime.summonKeyboard(selectedId)) {
      this.keyboard.openLive({ label: 'Nothing to type into yet: tap a browser pane or a text field first', onKey: () => {} });
    }
  }

  // ---- placed keyboards (objects with components.keyboard) ---------------------------------

  // Keep a fixed Keyboard on each placed one; hand typing over when you reach for it.
  updatePlaced(ray, tips) {
    const seen = new Set();
    for (const [id, e] of world.objects) {
      const c = e.data.components?.keyboard;
      const root = e.built?.root;
      if (!c || !root || !root.visible || !root.parent) continue;
      seen.add(id);
      let kb = this.placed.get(id);
      if (!kb) {
        kb = new Keyboard(scene, { fixed: true });
        kb.onIdleKey = (ev) => this.idleKey(kb, ev);
        this.placed.set(id, kb);
      }
      kb.setLayout(c.layout);
      root.updateWorldMatrix(true, false);
      kb.setPose(root.matrixWorld.clone().multiply(PLACED_KB_POSE));
      kb.update(lastViewer, ray, tips);
    }
    for (const [id, kb] of this.placed) if (!seen.has(id)) { kb.close(null, 'app'); kb.dispose(); this.placed.delete(id); }
    // Reaching for a placed keyboard: the floating one isn't needed (its typing moves over).
    const near = this.nearPlaced(tips, ray);
    this.atPlaced = !!near;
    if (near && this.keyboard.busy && this.keyboard.handoff(near)) telemetry.info('typing moved to a placed keyboard');
  }

  // A placed keyboard your fingertips are close to (or your pointer is on).
  nearPlaced(tips = [], ray = null, reach = PLACED_REACH) {
    let best = null, bestD = reach;
    for (const kb of this.placed.values()) {
      const c = new THREE.Vector3().setFromMatrixPosition(kb.group.matrix);
      for (const t of tips) { const d = t.p ? t.p.distanceTo(c) : Infinity; if (d < bestD) { best = kb; bestD = d; } }
      if (!best && ray && kb.hit(ray)?.widget) best = kb;
    }
    return best;
  }

  // Where typing should go: a placed keyboard you're at (hands near, or standing at it), else the floating one.
  typingKeyboard() {
    const tips = ['left', 'right'].filter((h) => this.hands.tracked[h]).map((h) => ({ id: h, p: this.hands.joint(h, INDEX_TIP) }));
    const head = lastViewer?.position;
    let kb = this.nearPlaced(tips);
    if (!kb && head) {
      for (const k of this.placed.values()) if (new THREE.Vector3().setFromMatrixPosition(k.group.matrix).distanceTo(head) < PLACED_STANDING) kb = k;
    }
    if (kb && this.keyboard.busy) this.keyboard.handoff(kb);
    return kb ?? this.keyboard;
  }

  // A key on a placed keyboard with nothing to type into: ask the app you
  // last used (or have selected) to open typing, then send the key there.
  idleKey(kb, ev) {
    if (!runtime.summonKeyboard(selectedId)) return log('Tap a browser pane, a terminal or a text field first, then type');
    if (kb.busy) kb.send(ev);
  }

  // Controller / hand gamepad values for apps (ctx.controls).
  controls() {
    const out = { left: null, right: null };
    for (const src of this.session.inputSources) {
      const g = src.gamepad, side = src.handedness;
      if (!g || (side !== 'left' && side !== 'right')) continue;
      const b = (i) => g.buttons[i]?.value ?? 0;
      const ax = g.axes.length >= 4 ? [g.axes[2], g.axes[3]] : g.axes.length >= 2 ? [g.axes[0], g.axes[1]] : [0, 0];
      out[side] = { trigger: b(0), squeeze: b(1), stick: ax.map((v) => (Math.abs(v) < 0.08 ? 0 : v)), hand: !!src.hand };
    }
    return out.left || out.right ? out : null;
  }

  busyKeyboard() { return [this.keyboard, ...this.placed.values()].find((k) => k.busy) ?? null; }

  kbHit(ray) {
    return this.keyboard.hit(ray) ?? [...this.placed.values()].map((kb) => kb.hit(ray)).find((h) => h?.widget) ?? null;
  }

  kbPress(ray, src) {
    if (this.keyboard.press(ray, src)) return true;
    for (const kb of this.placed.values()) if (kb.hit(ray)?.widget) return kb.press(ray, src);
    return false;
  }

  // Start carrying the menu: pinch/trigger on its top bar (bySqueeze: grip anywhere on it).
  // The keyboard's frame (not its keys) carries it the same way.
  grabMenu(e, bySqueeze) {
    if (this.menuHold) return false;
    const rp = this.aimPose(e.inputSource, e.frame);
    if (!rp) return false;
    const ray = rayFrom(rp), pose = new THREE.Matrix4().fromArray(rp.transform.matrix);
    const kb = this.keyboard.hit(ray);
    if (kb && (bySqueeze || kb.grab)) {
      this.menuHold = { src: e.inputSource, target: this.keyboard };
      this.keyboard.grab(pose, lastViewer);
      return true;
    }
    if (kb || !this.menu.open) return false;
    const hit = this.menu.hit(ray);
    if (!hit || (!bySqueeze && !hit.grab)) return false;
    this.menuHold = { src: e.inputSource, target: this.menu };
    this.menu.grab(pose);
    return true;
  }

  dropMenu(src) {
    if (!this.menuHold || this.menuHold.src !== src) return false;
    const { target } = this.menuHold;
    this.menuHold = null;
    target.release(lastViewer);
    return true;
  }

  // Surface dot of the pointing hand, else its ray's end.
  aimPoint() {
    const e = this.sources.get(this.pointer());
    if (e?.hit) return new THREE.Vector3().setFromMatrixPosition(e.hit);
    if (e?.ray) return e.ray.origin.clone().addScaledVector(e.ray.dir, QUEST_AHEAD);
    return null;
  }

  select(e) {
    const src = e.inputSource;
    if (this.swallowed(src)) return;                              // a Revelio / shoo gesture's pinch
    if (touch.carrying) return void touchRelease();               // "Move": this pinch puts it down
    if (touch.drag && touch.src === src) return;                  // the release of a hold-to-move, not a click
    if (this.joinedBy === src || (touch.two && touch.two.src === src)) return;   // the second hand of a two-hand move
    if (this.pressing?.has(src) || (this.pressEnded?.src === src && performance.now() - this.pressEnded.t < 300)) return;   // an app's press
    if (this.lastDropAt?.src === src && performance.now() - this.lastDropAt.t < 300) return;
    const rp = this.aimPose(src, e.frame);
    if (!rp) return;
    const ray = rayFrom(rp);
    if (this.kbPress(ray, src)) return;                     // keyboards, then menu: never fall through
    if (this.menu.press(ray)) return;
    raycaster.set(ray.origin, ray.dir);
    const hit = pickHits()[0];
    if (hit && wantsSwipes(hit)) return this.deferClick(src, hit, ray);   // could still become a drag-scroll
    if (hit) return this.clickHit(hit, ray);
    if (!armed) return select(null);                       // empty space, nothing armed: never create
    const entry = this.sources.get(src);
    const item = paletteItems().find((i) => i.key === armed);
    const head = lastViewer?.position ?? new THREE.Vector3();   // no getViewerPose on event frames
    const mount = mountFor(item, ray, entry?.hit ?? null, head);
    const pos = mount?.pos ?? (entry?.hit ? new THREE.Vector3().setFromMatrixPosition(entry.hit) : ray.origin.clone().addScaledVector(ray.dir, QUEST_AHEAD));
    if (world.locating) return log('still locating saved spaces…');
    const yaw = mount?.quat ?? yawFacing(pos, head);
    const space = world.spaceNear(pos);
    if (space) return placeItem(space, pos, yaw);
    world.createSpaceAtAnchor(e.frame, this.refSpace, pos, yaw, `Space ${new Date().toLocaleString()}`)
      .then((s) => placeItem(s, pos, yaw))
      .catch((err) => {
        // No anchor, no saved Space: still put the thing where it was asked for
        // (in this session's temporary Space) and say why it won't be saved.
        log(`error: create space failed: ${err.message}`);
        placeItem(world.temporarySpace(), pos, yaw);
        if (roam.active) {
          localStorage.setItem('stratum.unbounded', '0');
          roam.note = "Turned off: this headset can't save spaces while roaming. Re-enter AR";
          roam.forcedOff = true;
          log('roaming turned off for next time: saved spaces need anchors, which this headset refuses while roaming');
        }
      });
  }

  // Grip: grab whatever the ray touches (any part, apps included: the grip
  // isn't used for clicking) and carry it until the grip is released.
  grab(e) {
    const src = e.inputSource;
    const rp = this.aimPose(src, e.frame);
    if (!rp) return;
    const ray = rayFrom(rp);
    if (this.keyboard.hit(ray) || this.menu.hit(ray)) return void this.grabMenu(e, true);   // grip on the menu / keyboard carries it
    raycaster.set(ray.origin, ray.dir);
    const hit = pickHits()[0];
    const id = hit && world.objectIdFor(hit.object);
    if (!id || !runtime.mayMove(hit, 'grip', src.hand ? 'hand' : 'controller')) return;
    Object.assign(touch, { src, hit, drag: null, consumed: false, lastRay: ray });
    startDrag(id, hit);
  }

  // Pinch / trigger down/up for apps that take presses (runtime.press).
  press(e, phase) {
    const src = e.inputSource;
    this.pressing ??= new Set();
    if (phase === 'up') {
      if (!this.pressing.delete(src)) return false;
      runtime.press({ phase, id: src });
      this.pressEnded = { src, t: performance.now() };
      return true;
    }
    const rp = this.aimPose(src, e.frame);
    if (!rp) return false;
    const ray = rayFrom(rp);
    if (this.kbHit(ray) || (this.menu.open && this.menu.hit(ray))) return false;
    raycaster.set(ray.origin, ray.dir);
    const hit = pickHits()[0] ?? null;
    if (!runtime.press({ phase, id: src, hit, side: src.handedness === 'left' ? 'left' : 'right', source: src.hand ? 'hand' : 'controller', ray: () => this.sources.get(src)?.ray ?? null })) return false;
    this.pressing.add(src);
    return true;
  }

  // The other hand pinching while one moves something: both hands hold it.
  joinMove(e) {
    const src = e.inputSource;
    if (!touch.drag || touch.carrying || touch.two || !touch.src || src === touch.src || !this.sources.has(src)) return false;
    if (!startTwoHand(src)) return false;
    this.joinedBy = src;
    return true;
  }

  leaveMove(e) {
    if (this.joinedBy !== e.inputSource) return false;
    this.joinedBy = null;
    this.lastDropAt = { src: e.inputSource, t: performance.now() };   // its select after this isn't a click
    if (touch.two?.src === e.inputSource) endTwoHand();
    return true;
  }

  // Pinch / trigger held still on an object picks it up (hands have no grip
  // button), like a long-press on the phone. Handles pick up sooner. Moving
  // the ray first makes it a scroll or an aim instead. Apps can veto (grab).
  startHold(e) {
    if (touch.drag) return;
    const src = e.inputSource;
    const rp = this.aimPose(src, e.frame);
    if (!rp) return;
    const ray = rayFrom(rp);
    if (this.kbHit(ray) || (this.menu.open && this.menu.hit(ray))) return;
    raycaster.set(ray.origin, ray.dir);
    const hit = pickHits()[0];
    const id = hit && world.objectIdFor(hit.object);
    if (!id) return;
    const { delay, duration } = runtime.moveTiming(hit, src.hand ? 'hand' : 'controller');   // apps may set their own
    this.hold = { src, hit, id, t0: performance.now(), dir0: ray.dir.clone(), delay, ms: delay + duration };
  }

  checkHold(now) {
    const h = this.hold;
    if (!h) return;
    const ray = this.sources.get(h.src)?.ray;
    if (!ray || this.rayScroll?.moved || ray.dir.angleTo(h.dir0) > HOLD_WOBBLE) { this.hold = null; return; }
    if (now - h.t0 < h.ms) return;
    this.hold = null;
    if (!runtime.mayMove(h.hit, 'hold', h.src.hand ? 'hand' : 'controller')) return;
    this.rayScroll = null;   // it's a move now, not a scroll or a click
    this.pendingClick = null;
    clearTimeout(this.pendingTimer);
    Object.assign(touch, { src: h.src, hit: h.hit, drag: null, consumed: false, lastRay: ray });
    startDrag(h.id, h.hit);
  }
}

// ---- room map (DESIGN.md §3.8) --------------------------------------------------

const KIND_NAMES = { wall: ['wall', 'walls'], floor: ['floor', 'floors'], ceiling: ['ceiling', 'ceilings'], table: ['table', 'tables'],
  counter: ['counter', 'counters'], desk: ['desk', 'desks'], couch: ['couch', 'couches'], bed: ['bed', 'beds'], shelf: ['shelf', 'shelves'],
  storage: ['cabinet', 'cabinets'], screen: ['screen', 'screens'], art: ['picture', 'pictures'], door: ['door', 'doors'],
  window: ['window', 'windows'], other: ['other surface', 'other surfaces'] };

function mapSummary(space) {
  const c = roomMap.count(space.id);
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${KIND_NAMES[k]?.[n === 1 ? 0 : 1] ?? k}`).join(' · ');
}

function mapNote() {
  const space = currentSpace();
  const n = space ? Object.values(roomMap.count(space.id)).reduce((a, b) => a + b, 0) : 0;
  const note = mapper.note;
  return n && Mapper.wanted ? `${note} · ${n} surface${n === 1 ? '' : 's'}` : note;
}

function setMapOn(on) {
  localStorage.setItem('stratum.mapOn', on ? '1' : '0');
  if (!on) { mapper.stop(); roomMap.mapping = false; }
  else if (session) { mapper.start(session); roomMap.mapping = !IS_QUEST; }
  log(on ? 'mapping this room in the background' : 'room mapping off');
  renderMenu();
}

function setShowMap(on) {
  localStorage.setItem('stratum.showMap', on ? '1' : '0');
  roomMap.setVisible(on);
  mapView.setVisible(on);
  renderMenu();
}

// Quest camera calibration (DESIGN.md §3.9): look at one printed tag and
// move your head slowly; once there are enough different views, solve.
function startCalibration() {
  if (!questFeed || !tracker) return log('calibration needs the headset camera: allow Headset cameras, then re-enter AR');
  calibration = new Calibration(questFeed, tagSizeMm() / 1000);
  questCam.state = 'calibrating';
  calibrationStep();
  log('calibrating: look at a printed tag and slowly move your head side to side and up and down');
}

function calibrationStep() {
  const c = calibration;
  if (!c || c.solving) return;
  const p = c.progress;
  questCam.note = `Calibrating: ${Math.min(p.views, p.needed)}/${p.needed} views · turn ${Math.round(Math.min(p.spreadDeg, p.neededSpread))}/${p.neededSpread}°`;
  quest?.menu.invalidate();
  if (!c.ready) return;
  c.solving = true;
  questCam.note = 'Calibrating: working it out…';
  c.solve().then((r) => {
    if (calibration !== c) return;
    calibration = null;
    if (r.rmsPx > 4) throw new Error(`views didn't agree (${r.rmsPx.toFixed(1)} px): try again, moving slower`);
    questFeed.setCalibration(r);
    tracker.tags.clear();   // sightings so far used the old guess
    world.tracker = tracker;   // now tags can place and align Spaces
    questCam.state = 'calibrated';
    questCam.note = `Calibrated (${r.rmsPx.toFixed(1)} px)`;
    log(`headset camera calibrated: ${r.rmsPx.toFixed(2)} px · f ${r.f.toFixed(0)} · ${r.latencyMs} ms late · ${r.views} views`);
    telemetry.info('headset camera calibrated', { rmsPx: +r.rmsPx.toFixed(2), f: +r.f.toFixed(1), cx: +r.cx.toFixed(1), cy: +r.cy.toFixed(1),
      latencyMs: r.latencyMs, extrinsic: r.extrinsic.map((v) => +v.toFixed(4)), size: [r.width, r.height], views: r.views, spreadDeg: Math.round(r.spreadDeg) });
  }).catch((err) => {
    if (calibration === c) calibration = null;
    questCam.state = questFeed?.calibrated ? 'calibrated' : 'uncalibrated';
    questCam.note = `Calibration failed: ${err.message}`;
    log(`error: calibration failed: ${err.message}`);
  }).finally(() => quest?.menu.invalidate());
}

// What the headset camera scheduler needs to know (vision/questcam.js).
function questCameraContext(now) {
  const aligned = [...world.spaces.values()].some((s) => s.aligned && !s.temporary);
  const known = [];
  for (const s of world.spaces.values()) {
    if (!s.aligned || !s.markers) continue;
    for (const [id, m] of s.markers) known.push({ id, pos: new THREE.Vector3().setFromMatrixPosition(s.root.matrix.clone().multiply(m.inSpace)) });
  }
  for (const t of tracker.tags.values()) if (!known.some((k) => k.id === t.id)) known.push({ id: t.id, pos: new THREE.Vector3().setFromMatrixPosition(t.pose) });
  return { calibrating: !!calibration, searching: !aligned, aligned, known, lastSeen: (id) => tracker.tags.get(id)?.lastSeen ?? -Infinity };
}

async function createSpaceAtTagNow() {
  const tag = pendingTag;
  if (!tag) return log('no new tag in view');
  if (questFeed && !questFeed.calibrated) return startCalibration();   // its position would be a guess
  try { await world.createSpaceAtTag(tag, `Space ${new Date().toLocaleDateString()} · tag ${tag.id}`); } catch (err) { log(`error: ${err.message}`); }
  renderMenu();
}

// Delete a Space (its owner: for everyone, with everything in it) or leave it
// (shared with you): two taps, the first only arms it.
async function removeSpace(id) {
  const s = world.spaces.get(id);
  if (!s || s.temporary) return;
  if (spaceGone.id !== id || performance.now() - spaceGone.armedAt > 5000) {
    Object.assign(spaceGone, { id, armedAt: performance.now() });
    log(s.owner ? `tap again to delete "${s.name}" and everything in it, for everyone` : `tap again to leave "${s.name}"`);
    renderMenu();
    renderSpacesList();
    setTimeout(() => { renderMenu(); renderSpacesList(); }, 5100);   // (the armed row goes back)
    return;
  }
  Object.assign(spaceGone, { id: null, armedAt: 0 });
  try {
    if (s.owner) await api.deleteSpace(id); else await api.leave(id);
    telemetry.info(s.owner ? 'space deleted' : 'space left', { space: id });
    log(`"${s.name}": ${s.owner ? 'deleted' : 'left'}`);
    if (selectedId && world.objects.get(selectedId)?.data.space === id) select(null);
    mapView.clear(id);
    await world.refreshSpaces();   // (gone from the list: its things and anchors go with it)
    if (session) world.pruneHeadsetAnchors(session).catch(() => {});   // the headset's saved anchors for it, freed
  } catch (err) { log(`error: ${err.message}`); }
  renderSpacesList();
  renderMenu();
}

// Move the things of a headset-only Space (no tag) into the tagged one
// aligned here with it, so phones see them too (world.mergeOffer).
async function mergeSpaces() {
  const m = world.mergeOffer();
  if (!m) return log('nothing to move: needs a tagged space and a tagless one lined up here');
  const n = await world.moveAll(m.from.id, m.to.id);
  telemetry.info('spaces merged', { from: m.from.id, to: m.to.id, moved: n, of: m.things });
  log(`moved ${n} of ${m.things} into "${m.to.name}"${n === m.things ? `: "${m.from.name}" is empty now (delete it below)` : ''}`);
  renderSpacesList();
  renderMenu();
}

// Reset a Space's map for everyone: two taps (the first only arms it).
async function clearMap(space) {
  if (performance.now() - mapReset.armedAt > 5000) {
    mapReset.armedAt = performance.now();
    log("tap again to reset this room's map for everyone in the space");
    renderMenu();
    return;
  }
  mapReset.armedAt = 0;
  await roomMap.clear(space.id).catch((err) => log(`error: ${err.message}`));
  mapView.clear(space.id);
  log(`"${space.name}": map reset`);
  renderMenu();
}

// Wall items: where to hang them. A mapped wall along the ray, or the
// surface hit itself when it's vertical, whichever is nearer.
// → { pos, quat } facing out of the wall, or null.
//
// mountFor: the item's mount rule → { pos, quat } or null (then: upright,
// facing you, at the hit point / ahead). 'wall': hangs on a wall.
// 'surface' (notes): flat on whatever you aim at: a wall, or lying on a
// table / the floor with its top edge away from you (readable from here).
function mountFor(item, ray, hitMatrix, head) {
  if (item?.mount !== 'wall' && item?.mount !== 'surface') return null;
  const wall = wallMount(ray, hitMatrix, item);
  if (wall || item.mount === 'wall' || !hitMatrix) return wall;
  const n = new THREE.Vector3().setFromMatrixColumn(hitMatrix, 1).normalize();
  if (n.y < 0.7) return null;
  const pos = new THREE.Vector3().setFromMatrixPosition(hitMatrix).addScaledVector(n, 0.002);
  return { pos, quat: yawFacing(pos, head).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)) };
}

function wallMount(ray, hitMatrix, item) {
  const cands = [];
  const mapped = roomMap.raycast(ray, ['wall', 'door', 'window']);
  if (mapped) cands.push({ point: mapped.point, normal: mapped.normal });
  if (hitMatrix) {
    const n = new THREE.Vector3().setFromMatrixColumn(hitMatrix, 1).normalize();
    if (Math.abs(n.y) < 0.3) cands.push({ point: new THREE.Vector3().setFromMatrixPosition(hitMatrix), normal: n.dot(ray.dir) > 0 ? n.negate() : n });
  }
  if (!cands.length) return null;
  const best = cands.sort((a, b) => a.point.distanceTo(ray.origin) - b.point.distanceTo(ray.origin))[0];
  const normal = best.normal.setY(0).normalize();
  const pos = best.point.clone().addScaledVector(normal, 0.004);
  pos.y -= item.mountOffsetY ?? 0;
  return { pos, quat: yawFacing(pos, pos.clone().add(normal)) };
}

// The Quest hand menu's content (same actions as the phone overlay).
const questInvite = { code: null };   // last invite code (both menus show it)
const menuScale = () => Number(localStorage.getItem('stratum.menuScale')) || 1;
const recentKeys = () => { try { return JSON.parse(localStorage.getItem('stratum.recent') || '[]'); } catch { return []; } };
function noteRecent(key) {
  localStorage.setItem('stratum.recent', JSON.stringify([key, ...recentKeys().filter((k) => k !== key)].slice(0, 8)));
}

// What the Quest menu shows (DESIGN.md §8.3): a snapshot, rebuilt a few
// times a second while it's open; widgets only redraw what changed.
function placeableInfo(item) {
  const [emoji, name] = splitLabel(item.label);
  const app = item.key.startsWith('app:') ? runtime.apps.get(item.key.split(':')[1]) : null;
  return {
    key: item.key, name, emoji: emoji || null, app: app?.id ?? null,
    color: app?.color || (BUILTIN.some((b) => b.key === item.key) ? '#4a5262' : '#3d4558'),
    category: app ? app.name : BUILTIN.some((b) => b.key === item.key) ? 'Shapes' : 'Uploads',
  };
}

// An app asked for its page (ctx.panel({ open: true })): the hand menu (Quest) / the sheet (phone) up on it.
function openAppPage(appId) {
  if (quest) {
    const m = quest.menu, top = m.nav.stack[m.nav.stack.length - 1];
    if (!(top?.page === 'app' && top.params?.app === appId)) { m.go('apps'); m.go('app', { app: appId }); }
    m.toggle(true);
    m.invalidate();
  } else if (phoneMenu) {
    setSheet(true);
    phoneMenu.go?.('app', { app: appId });
  }
  renderMenu();
}

function menuData() {
  const space = currentSpace();
  const placeables = paletteItems().map(placeableInfo);
  const byKey = new Map(placeables.map((p) => [p.key, p]));
  const recent = [...recentKeys().map((k) => byKey.get(k)).filter(Boolean), ...placeables].filter((p, i, a) => a.indexOf(p) === i).slice(0, 3);
  // Apps with variants place through a chooser: one tile per app (pick the
  // kind, see what it looks like, then place; the app asks for details after).
  const choosers = [...runtime.apps.values()].filter((a) => a.enabled && a.placeable && (a.variants?.length ?? 0) > 1).map((a) => ({
    key: `choose:${a.id}`, chooser: true, app: a.id, name: a.name, emoji: a.icon, color: a.color || '#3d4558', category: a.category ?? a.name,
    variants: a.variants.map((v) => ({ key: `app:${a.id}:${v.key}`, variant: v.key, name: v.name, emoji: v.icon, description: v.description ?? '' })),
  }));
  const chosen = new Set(choosers.map((c) => c.app));
  const places = [...placeables.filter((p) => !chosen.has(p.app)), ...choosers];
  const ui = runtime.uiState();
  // Selection card.
  let selection = null;
  if (selectedId) {
    const e = world.objects.get(selectedId);
    const appId = e?.data.components?.app?.app;
    const app = appId && runtime.apps.get(appId);
    const inst = ui.find((u) => u.instance === selectedId);
    const kind = e?.data.components;
    selection = {
      emoji: app?.icon ?? (kind?.model ? '🧩' : kind?.image ? '🖼' : kind?.video ? '🎞' : kind?.keyboard ? '⌨' : '■'),
      name: app ? (inst?.status || app.name) : kind?.model ? 'Model' : kind?.image ? 'Picture' : kind?.video ? 'Video' : kind?.keyboard ? 'Keyboard' : 'Object',
      sub: world.isTemporary(e?.data.space) ? 'Temporary' : world.isShared(selectedId) ? 'Shared with this space' : 'Only you',
      shareable: !world.isTemporary(e?.data.space), shared: world.isShared(selectedId),
      actions: [...(inst?.actions ?? []), ...keyboardActions(selectedId)],
    };
  }
  const running = [];
  for (const u of ui) if (!running.some((r) => r.app === u.app.id)) running.push({ app: u.app.id, icon: u.app.icon, name: u.app.name, status: u.status });
  const apps = [...runtime.apps.values()].map((a) => {
    const mine = ui.filter((u) => u.app.id === a.id);
    const instances = [...world.objects.values()].filter((e) => e.data.components?.app?.app === a.id && world.spaces.get(e.data.space)?.aligned)
      .map((e) => ({ id: e.data.id, status: ui.find((u) => u.instance === e.data.id)?.status ?? '' }));
    return {
      id: a.id, name: a.name, icon: a.icon, color: a.color, category: a.category, enabled: !!a.enabled,
      running: mine.length, instances, actions: mine.find((u) => u.actions.length)?.actions ?? [],
      // The app's own menu section: from the instance last touched, else any running one.
      menu: (mine.find((u) => u.instance === runtime.touched?.id && u.menu) ?? mine.find((u) => u.menu))?.menu ?? null,
      panel: (mine.find((u) => u.instance === runtime.touched?.id && u.panel) ?? mine.find((u) => u.panel))?.panel ?? null,   // its own UI (ctx.panel)
      settings: a.settings ?? [], values: a.settingsValues ?? {}, description: a.description, permissions: a.permissions ?? [],
      gestures: a.gestures ?? [],
      crashed: runtime.crashed.get(a.id) ?? null,   // stopped after a crash (restarting with backoff), or by the watchdog (slow: until Run anyway)
      perfAllowed: runtime.perfAllow.has(a.id),
    };
  });
  // Layers: spaces' shared layers, mine, apps, public.
  const counts = new Map();
  for (const e of world.objects.values()) counts.set(e.data.layer, (counts.get(e.data.layer) ?? 0) + 1);
  const appCounts = new Map();
  for (const e of world.objects.values()) { const a = e.data.components?.app?.app; if (a) appCounts.set(a, (appCounts.get(a) ?? 0) + 1); }
  const unrevealable = loadIds('stratum.unrevealable');
  const layer = (id, name, group, emoji = null) => ({ id, name, group, emoji, visible: !world.hiddenLayers.has(id), revealable: !unrevealable.has(id),
    count: group === 'app' ? appCounts.get(appForLayer(id)) ?? 0 : counts.get(id) ?? 0 });
  const layers = [
    ...[...world.spaces.values()].filter((s) => s.sharedLayer).map((s) => layer(s.sharedLayer, s.name, 'space')),
    ...me.layers.filter((l) => l.kind === 'personal').map((l) => layer(l.id, 'Private things', 'personal')),
    ...apps.filter((a) => runtime.apps.get(a.id)?.layer).map((a) => layer(runtime.apps.get(a.id).layer, a.name, 'app', a.icon)),
    ...me.layers.filter((l) => l.kind === 'public').map((l) => layer(l.id, l.name, 'public')),
  ];
  return {
    version: VERSION, status: statusText(), armed, placeables, places, recent, running, apps, layers, selection, perf: { ...runtime.perfReport(), probe: probe.state, inXR: !!session },
    hidden: { here: myHidden().length, shooed: [...world.hiddenObjects].filter((id) => world.objects.has(id)).length },
    space: space && { name: space.name, members: space.members, here: presence.count, inviteCode: questInvite.code,
      placeShared: placeShared(), mapSummary: mapSummary(space), showMap: roomMap.visible,
      resetArmed: performance.now() - mapReset.armedAt < 5000 },
    // Every saved Space (Space tab: delete / leave).
    spaces: [...world.spaces.values()].filter((s) => !s.temporary).map((s) => ({ id: s.id, name: s.name, owner: !!s.owner, here: s === space,
      members: s.members.length, things: [...world.objects.values()].filter((e) => e.data.space === s.id).length,
      armed: spaceGone.id === s.id && performance.now() - spaceGone.armedAt < 5000 })),
    merge: (() => { const m = world.mergeOffer(); return m && { from: m.from.name, to: m.to.name, things: m.things }; })(),
    tag: pendingTag ? { id: pendingTag.id } : null,
    camera: IS_QUEST ? { on: questCamWanted(), live: !!questFeed, state: questCam.state, note: questCam.note || (questCamWanted() ? 'Turns on when you enter AR' : 'Off') } : null,
    settings: { hands: showHands(), fpsHud: fpsHud.visible, labelMode: labelMode(), handRec: { on: handRecWanted(), live: handRec.recording, mb: +(handRec.stats.bytes / 1e6).toFixed(1), chunks: handRec.stats.chunks, failed: handRec.stats.failed, full: !!handRec.full }, occlusion: occlusion.enabled, menuScale: menuScale(), roam: roamWanted(), roamActive: roam.active,
      roamNote: roam.forcedOff ? roam.note : roamWanted() === roam.active || !session ? roam.note || 'Experimental: saved spaces may not work' : 'Exit and re-enter AR to apply',
      occlusionNote: occlusion.available || !session ? 'Real things hide virtual ones' : 'Exit and re-enter AR to use',
      roomLight: lighting.wanted, roomLightNote: lighting.note || 'Light things like your room, where supported',
      map: Mapper.wanted, mapNote: mapNote(), showMap: roomMap.visible, kbLayout: localStorage.getItem('stratum.kbLayout') ?? 'simple', steady: !!world?.steady },
  };
}

// ---- turntables (DESIGN.md §8.8) ---------------------------------------------------------------
// A turntable holds things in slots; only the current one is drawn, standing
// on it (and its app runs). The current one is shared: stepping changes it for
// everyone (it's saved on the turntable). Things you can't see (others'
// private layers, layers you hid) are skipped when stepping.

const TT_TOP = 0.0225;           // m above the turntable's origin: where its item stands
const TT_DROP_UP = 0.45;         // dropped this far above it (or on it), within its radius: goes in
const TT_SWIPE_PX = 60;          // a swipe this long steps
const TT_SPIN = 0.35;            // rad / s: things (not apps) turn slowly on show
const TT_SWAP_MS = 380;
const TT_POKE_M = 0.02;
const tt = { floor: new WeakMap(), preview: new Map(), swap: new Map(), last: new Map(), dir: new Map(), labels: new Map(), tipsIn: new Set() };

const ttState = (e) => e?.data.components?.turntable ?? null;
const ttArrow = (node) => { for (let n = node; n; n = n.parent) if (n.userData?.ttArrow) return n.userData.ttArrow; return 0; };

// The slots I can see, in order.
function ttVisible(e) {
  return (ttState(e)?.items ?? []).filter((id) => { const it = world.objects.get(id); return it && world.shownHere(it.data); });
}

function setTurntable(id, patch) {
  const e = world.objects.get(id);
  if (!e) return;
  world.setComponents(id, { ...e.data.components, turntable: { ...ttState(e), ...patch } });
}

function stepTurntable(id, dir) {
  const e = world.objects.get(id), items = ttVisible(e);
  if (!items.length) return;
  const i = items.indexOf(ttState(e).current);
  const next = i < 0 ? items[dir > 0 ? 0 : items.length - 1] : items[(i + dir + items.length) % items.length];
  if (next === ttState(e).current) return;
  tt.dir.set(id, dir);
  setTurntable(id, { current: next });
  telemetry.info('turntable step', { dir, of: items.length });
}

function putOnTurntable(id, item) {
  const e = world.objects.get(id), st = ttState(e);
  if (!st || item === id) return;
  tt.dir.set(id, 1);
  setTurntable(id, { items: [...st.items.filter((x) => x !== item), item], current: item });
  telemetry.info('turntable add', { n: st.items.length + 1 });
}

function takeOffTurntable(id, item) {
  const e = world.objects.get(id), st = ttState(e);
  if (!st) return;
  const items = st.items.filter((x) => x !== item);
  const vis = ttVisible(e).filter((x) => x !== item);
  setTurntable(id, { items, current: st.current === item ? vis.at(-1) ?? null : st.current });
  telemetry.info('turntable remove', { n: items.length });
}

// After a drop: onto a turntable (in the same space, over it) → it goes in
// and shows; off its turntable → it comes out.
function afterDrop(id) {
  const e = world.objects.get(id);
  if (!e?.built || ttState(e)) return;
  const owner = world.slotOwner(id);
  e.built.root.updateWorldMatrix(true, false);
  const at = new THREE.Vector3().setFromMatrixPosition(e.built.root.matrixWorld);
  let onto = null;
  for (const t of world.objects.values()) {
    if (!ttState(t) || !t.built || t.data.space !== e.data.space) continue;
    t.built.root.updateWorldMatrix(true, false);
    const p = at.clone().applyMatrix4(t.built.root.matrixWorld.clone().invert());
    const R = (ttState(t).radius ?? 0.12) * 1.15;
    if (Math.hypot(p.x, p.z) <= R && p.y > -0.05 && p.y < TT_DROP_UP) { onto = t; break; }
  }
  if (owner && owner !== onto) takeOffTurntable(owner.data.id, id);
  if (onto && onto !== owner) putOnTurntable(onto.data.id, id);
}

// Swipes on a turntable (or the thing on it, unless that's an app that
// scrolls) step it: left = next. While swiping, the thing turns with you.
function turntableFor(hit) {
  if (!hit) return null;
  const id = world.objectIdFor(hit.object), e = id && world.objects.get(id);
  if (ttState(e)) return e;
  return (id && !runtime?.wantsSwipes(hit) && world.slotOwner(id)) || null;
}
const wantsSwipes = (hit) => !!runtime?.wantsSwipes(hit) || !!turntableFor(hit);
function sendSwipe(g) {
  const t = !g.target && !runtime.wantsSwipes(g.hit) && turntableFor(g.hit);
  if (!t) return runtime.swipe(g);
  const id = t.data.id;
  if (g.phase === 'move') tt.preview.set(id, (g.dx ?? 0) * 0.004);
  else { tt.preview.delete(id); if (Math.abs(g.dx ?? 0) > TT_SWIPE_PX) stepTurntable(id, g.dx > 0 ? -1 : 1); }
  return true;
}

// Every frame: stand each turntable's current thing on it (turning slowly,
// spinning in when it changes), its label, fingertip pokes on the arrows.
function updateTurntables(now) {
  const tips = quest ? ['left', 'right'].map((h) => quest.hands.joint(h, INDEX_TIP)).filter(Boolean) : [];
  const tipsIn = new Set();
  for (const e of world.objects.values()) {
    const st = ttState(e);
    if (!st || !e.built) continue;
    const id = e.data.id, root = e.built.root;
    if (tt.last.get(id) !== st.current) {   // changed (here or by someone else): spin it in
      tt.swap.set(id, { t0: now, dir: tt.dir.get(id) ?? 1 });
      tt.dir.delete(id);
      tt.last.set(id, st.current);
    }
    const cur = st.current && world.objects.get(st.current);
    if (cur?.built && cur.data.space === e.data.space && touch.drag?.id !== cur.data.id && world.shownHere(cur.data)) {
      const isApp = !!cur.data.components?.app;
      const spin = isApp ? 0 : TT_SPIN * now / 1000;
      const sw = tt.swap.get(id), k = sw ? Math.min(1, (now - sw.t0) / TT_SWAP_MS) : 1;
      if (k >= 1) tt.swap.delete(id);
      const ease = 1 - (1 - k) ** 3;
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      root.matrix.decompose(p, q, sc);
      const yaw = spin + (tt.preview.get(id) ?? 0) + (sw ? sw.dir * (1 - ease) * Math.PI * 0.6 : 0);
      const turn = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));   // facing the turntable's front
      const itemS = new THREE.Vector3().fromArray(cur.data.pose.s ?? [1, 1, 1]).multiplyScalar(0.55 + 0.45 * ease);
      // Its bottom rests on the platter (things are often centered on their origin).
      if (!tt.floor.has(cur.built.root)) tt.floor.set(cur.built.root, Math.max(0, -(boundsOf(cur.built.root)?.min.y ?? 0)));
      const lift = tt.floor.get(cur.built.root) * itemS.y;
      const top = new THREE.Vector3(0, TT_TOP * sc.y + lift, 0).applyQuaternion(q).add(p);
      cur.built.root.matrix.compose(top, turn, itemS);
      cur.built.root.matrixWorldNeedsUpdate = true;
    }
    ttLabel(e, st);
    // Fingertips on the arrows.
    if (tips.length) root.traverse((n) => {
      if (!n.userData?.ttArrow) return;
      const at = n.getWorldPosition(new THREE.Vector3());
      if (!tips.some((t) => t.distanceTo(at) < TT_POKE_M)) return;
      const key = `${id}|${n.userData.ttArrow}`;
      tipsIn.add(key);
      if (!tt.tipsIn.has(key)) stepTurntable(id, n.userData.ttArrow);
    });
  }
  tt.tipsIn = tipsIn;
}

// "2 / 5" on the turntable's front edge (or what to do when it's empty).
function ttLabel(e, st) {
  const root = e.built.root, items = ttVisible(e);
  const i = items.indexOf(st.current);
  const text = !st.items.length ? 'Drop things here' : !items.length ? 'Nothing you can see' : i < 0 ? `${items.length} here` : `${i + 1} / ${items.length}`;
  let l = tt.labels.get(e.data.id);
  if (!l || l.mesh.parent !== root.children[0]) {
    const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.0175), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    const R = st.radius ?? 0.12;
    mesh.position.set(0, 0.0125, R + 0.0135);
    mesh.rotation.x = -Math.PI / 2.6;
    mesh.userData.handle = true;
    root.children[0].add(mesh);
    l = { mesh, canvas, tex, text: null };
    tt.labels.set(e.data.id, l);
  }
  if (l.text === text) return;
  l.text = text;
  const g = l.canvas.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#e9ecef'; g.font = '700 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  l.tex.needsUpdate = true;
}

// ---- Revelio (DESIGN.md §8.7) ------------------------------------------------------------------

function loadIds(key) { try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); } }
function saveIds(key, set) { localStorage.setItem(key, JSON.stringify([...set].slice(-500))); }
function saveExceptions() { saveIds('stratum.hiddenObjects', world.hiddenObjects); saveIds('stratum.revealedObjects', world.revealedObjects); }

// What I've hidden here (my layer / app toggles on this device, or shooed),
// in aligned spaces, skipping layers marked not revealable. Turned-off apps
// aren't hidden, they're off.
function myHidden() {
  const layers = new Set(hiddenLayerIds()), off = loadIds('stratum.unrevealable');
  return [...world.objects.values()].filter((e) => {
    const d = e.data, app = d.components?.app?.app;
    if (!e.built || !world.spaces.get(d.space)?.aligned || world.shown(d) || world.hiddenApps.has(app)) return false;
    const appLayer = app ? runtime.apps.get(app)?.layer : null;
    if (off.has(d.layer) || (appLayer && off.has(appLayer))) return false;
    return world.hiddenObjects.has(d.id) || layers.has(d.layer) || (app && world.mutedApps.has(app));
  });
}

const DEFAULT_BOX = () => new THREE.Box3(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 0.2, 0.1));

// Where everything is from here (telemetry 'view check'): per object, its
// spot in its Space and from the camera (m, degrees off the view centre),
// whether it and its parents are visible, and the camera / tags in Space
// terms. For "the list has it but I can't see it".
function viewCheck(why) {
  if (!lastViewer || !world) return;
  const cam = lastViewer.position, fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(lastViewer.quaternion);
  const r2 = (v) => v.toArray().map((x) => +x.toFixed(2));
  const spaces = [...world.spaces.values()].filter((s) => s.aligned).map((s) => {
    const inv = s.root.matrix.clone().invert();
    return { name: s.name, by: s.alignedBy, visible: s.root.visible, cam: r2(cam.clone().applyMatrix4(inv)), camFwd: r2(fwd.clone().transformDirection(inv)) };
  });
  const things = [];
  for (const e of world.objects.values()) {
    const s = world.spaces.get(e.data.space);
    if (!s?.aligned) continue;
    let vis = !!e.built;
    for (let o = e.built?.root; o; o = o.parent) if (!o.visible) vis = false;
    const p = e.built ? e.built.root.getWorldPosition(new THREE.Vector3()) : null;
    const to = p && p.clone().sub(cam);
    things.push({ app: e.data.components?.app?.app ?? Object.keys(e.data.components ?? {})[0], built: !!e.built, vis,
      at: e.data.pose.p.map((x) => +x.toFixed(2)), m: to && +to.length().toFixed(2), off: to && Math.round(THREE.MathUtils.radToDeg(to.angleTo(fwd))),
      ...(e.built ? drawCost(e.built.root) : {}) });
  }
  const tags = [...(tracker?.tags?.values?.() ?? [])].map((t) => ({ id: t.id, m: t.pose ? +new THREE.Vector3().setFromMatrixPosition(t.pose).distanceTo(cam).toFixed(2) : null }));
  const info = renderer.info.render, xr = renderer.xr;
  const out = { calls: info.calls, tris: info.triangles, target: !!renderer.getRenderTarget(), baseLayer: !!session?.renderState.baseLayer,
    layers: session?.renderState.layers?.length ?? 0, autoClear: renderer.autoClear, sceneBg: !!scene.background, overrideMat: !!scene.overrideMaterial };
  telemetry.info('view check', { why, spaces, things, tags, out });
  // What actually got drawn there: the framebuffer's pixel at each thing and the tag (next frame).
  const spots = [...world.objects.values()].filter((e) => e.built && world.spaces.get(e.data.space)?.aligned).slice(0, 4)
    .map((e) => ({ app: e.data.components?.app?.app, xyz: e.built.root.getWorldPosition(new THREE.Vector3()).toArray() }));
  for (const t of tracker?.tags?.values?.() ?? []) if (t.pose) spots.push({ app: `tag ${t.id}`, xyz: new THREE.Vector3().setFromMatrixPosition(t.pose).toArray() });
  if (spots.length && xr.isPresenting) Promise.all(spots.map((sp) => window.__app.samplePixel(sp.xyz))).then((px) =>
    telemetry.info('view pixels', { why, at: spots.map((sp, i) => ({ what: sp.app, rgba: px[i] })) }));
}

function castRevelio({ how = 'gesture', side = null, detail = null } = {}) {
  viewCheck(`revelio ${how}`);
  const origin = lastViewer?.position ?? new THREE.Vector3(0, 1.5, 0);
  const items = myHidden().map((e) => ({ id: e.data.id, root: e.built.root, box: boundsOf(e.built.root) ?? DEFAULT_BOX(), ghost: ghostFor(e) }));
  revelio.cast(origin, items);
  telemetry.info('revelio cast', { how, side, ...detail, hidden: items.length });
  if (!items.length) log('Revelio: nothing hidden here');
  return items.length;
}

// The frozen shape an object's glow takes: the app's own light stand-in if it
// has one, else a copy of what it draws (null: too heavy / nothing: a box).
function ghostFor(e) {
  const ph = runtime.revealMesh(e.data.id);
  if (ph) {
    ph.parent.add(ph.object);
    const g = ghostOf(ph.object, e.built.root);
    ph.object.removeFromParent();
    if (g) return g;
  }
  return ghostOf(e.built.root);
}

function revealObject(id) {
  if (!world.objects.get(id)) return false;
  revelio.revealed(id);
  world.revealObject(id);
  saveExceptions();
  telemetry.info('revelio reveal', { id: id.slice(0, 8) });
  renderMenu();
  return true;
}

function shooObject(id) {
  const e = world.objects.get(id);
  if (!e?.built || !world.shown(e.data)) return false;
  revelio.poof(e.built.root, boundsOf(e.built.root) ?? DEFAULT_BOX());
  if (selectedId === id) select(null);
  world.setObjectHidden(id, true);
  saveExceptions();
  telemetry.info('shoo', { id: id.slice(0, 8) });
  log('Hidden here. Turn an open hand to see hidden things again');
  renderMenu();
  return true;
}

const hiddenLayerIds = () => { try { return JSON.parse(localStorage.getItem('stratum.hiddenLayers') || '[]'); } catch { return []; } };
// An app's row in Layers hides the app's things wherever they are (placed in a
// Space they're in its shared layer, not the app's own), not just its layer.
const appForLayer = (id) => [...(runtime?.apps.values() ?? [])].find((a) => a.layer === id)?.id ?? null;
function setLayerShown(id, on, { restore = false } = {}) {
  world.setLayerVisible(id, on);
  const app = appForLayer(id);
  if (app) world.setAppMuted(app, !on);
  // Toggling a layer ends the per-object exceptions in it (revealed / shooed things follow the layer again).
  for (const e of restore ? [] : world.objects.values()) {
    const d = e.data;
    if (d.layer !== id && !(app && d.components?.app?.app === app)) continue;
    world.hiddenObjects.delete(d.id);
    world.revealedObjects.delete(d.id);
    world.refreshShown(d.id);
  }
  saveExceptions();
  const hidden = new Set(hiddenLayerIds());
  if (on) hidden.delete(id); else hidden.add(id);
  localStorage.setItem('stratum.hiddenLayers', JSON.stringify([...hidden]));
}

const menuProvider = {
  data: menuData,
  arm: (key) => arm(key),
  preview: (app, variant) => runtime.preview(app, variant),
  edit: (act) => editSelected(act),
  selectObject: (id) => select(id),
  toggleApp: (id) => runtime.setEnabled(id, !runtime.apps.get(id)?.enabled).then(() => { renderAppsList(); renderMenu(); }),
  startProbe: () => startProbe(),
  cancelProbe: () => cancelProbe(),
  allowSlow: (id) => { runtime.allowSlow(id); renderMenu(); },      // "Run anyway" after the watchdog stopped it
  disallowSlow: (id) => { runtime.disallowSlow(id); renderMenu(); },
  setLayerVisible: (id, on) => setLayerShown(id, on),
  showAllLayers: () => {
    for (const id of [...world.hiddenLayers]) setLayerShown(id, true);
    for (const id of [...world.hiddenObjects]) world.setObjectHidden(id, false);
    saveExceptions();
  },
  showShooed: () => { for (const id of [...world.hiddenObjects]) world.setObjectHidden(id, false); saveExceptions(); },
  castRevelio: () => castRevelio({ how: 'menu' }),
  setRevealable: (id, on) => { const off = loadIds('stratum.unrevealable'); if (on) off.delete(id); else off.add(id); saveIds('stratum.unrevealable', off); },
  invite: () => { const s = currentSpace(); if (s) invite(s).then((c) => { questInvite.code = c?.code ?? null; renderMenu(); }); },
  setPlaceShared: (on) => localStorage.setItem('stratum.placeShared', on ? '1' : '0'),
  setShowMap: (on) => setShowMap(on),
  clearMap: () => { const s = currentSpace(); if (s) clearMap(s); },
  removeSpace: (id) => removeSpace(id),
  mergeSpaces: () => mergeSpaces(),
  setSetting(key, value) {
    if (key === 'hands') { localStorage.setItem('stratum.hands', value ? '1' : '0'); quest?.hands.setVisible(value); }
    if (key === 'occlusion') setOcclusion(value);
    if (key === 'labelMode') setLabelMode(value);
    if (key === 'handRec') {
      localStorage.setItem('stratum.handrec', value ? '1' : '0');
      handRec.enabled = value;
      if (value && session && IS_QUEST && !handRec.session) handRec.start();
      telemetry.info('hand recording', { on: value });
    }
    if (key === 'fpsHud') { localStorage.setItem('stratum.fpsHud', value ? '1' : '0'); fpsHud.setVisible(value); }
    if (key === 'roam') localStorage.setItem('stratum.unbounded', value ? '1' : '0');
    if (key === 'map') setMapOn(value);
    if (key === 'steady') {
      localStorage.setItem('stratum.steady', value ? '1' : '0');
      if (world) world.steady = value;
      log(value ? 'holding spaces still: they only move if they\'re clearly off' : 'spaces follow every tag / anchor correction');
    }
    if (key === 'kbLayout') { localStorage.setItem('stratum.kbLayout', value); quest?.keyboard.setLayout(value); }
    if (key === 'roomLight') {
      localStorage.setItem('stratum.roomLight', value ? '1' : '0');
      if (!value) lighting.use('standard', 'Off: standard lighting');
      else if (session) lighting.start(session);
    }
    if (key === 'menuScale') { localStorage.setItem('stratum.menuScale', String(value)); if (quest) quest.menu.scale = value; }
  },
  exit: () => session?.end(),
  join: async () => { const code = await askText('Join code', ''); if (code) joinSpace(code); },
  createAtTag: () => createSpaceAtTagNow(),
  calibrate: () => (calibration ? (calibration = null, questCam.state = questFeed?.calibrated ? 'calibrated' : 'uncalibrated', questCam.note = 'Calibration cancelled') : startCalibration()),
  setCamera: (on) => { localStorage.setItem('stratum.questcamOn', on ? '1' : '0'); questCam.note = on ? 'Re-enter AR to turn it on' : 'Off (re-enter AR)'; },
  forgetCalibration: () => { questFeed?.clearCalibration(); tracker?.tags.clear(); world.tracker = null; questCam.state = questFeed ? 'uncalibrated' : 'off'; questCam.note = 'Not calibrated: tag positions are rough'; },
  search: (label, value, onInput) => askText(label, value, { onInput, placeholder: 'Type to filter' }),
  setAppSetting: (app, key, value) => runtime.setSetting(app, key, value).catch((err) => log(`error: ${err.message}`)),
  editAppText: async (app, s) => {
    const v = await askText(s.label, runtime.apps.get(app)?.settingsValues?.[s.key] ?? '');
    if (v == null) return;
    runtime.setSetting(app, s.key, v).catch((err) => log(`error: ${err.message}`));
  },
};

// The phone sheet: the same data and actions, plus what only the phone has
// (typing a join code, per-instance app rows).
const phoneProvider = {
  ...menuProvider,
  data() {
    const d = menuData();
    d.user = me?.user?.name ?? null;
    d.runningUi = runtime.uiState().map((u) => ({ app: u.app.id, icon: u.app.icon, color: u.app.color, name: u.app.name, status: u.status, actions: u.actions }));
    return d;
  },
  run: (a) => runSafe(a.run),
  close: () => setSheet(false),
};

window.__app.questMenu = () => quest?.menu ?? null;   // test hook
window.__app.menuData = () => menuData();
window.__app.sheetOpen = () => sheetOpen();
window.__app.phoneMenu = () => phoneMenu;   // test hook
window.__app.hands = () => quest?.hands ?? null;       // test hook
window.__app.quest = () => quest;                      // test hook
window.__app.viewerPose = () => lastViewer;            // test hook
window.__app.frames = () => renderer.info.render.frame;   // test hook: rendered frames
window.__app.objectAt = (xyz) => objectAt(new THREE.Vector3(...xyz));   // test hook
window.__app.cursor = () => { for (const [src, e] of quest?.sources ?? []) if (src === quest.pointer() && e.dot.visible) return e.dot.position.toArray(); return null; };   // test hook
window.__app.aimRays = () => Object.fromEntries([...(quest?.sources ?? [])].filter(([, e]) => e.ray).map(([s, e]) => [s.handedness, { origin: e.ray.origin.toArray(), dir: e.ray.dir.toArray(), hand: !!e.aim }]));   // test hook
window.__app.keyboard = () => quest?.keyboard ?? null; // test hook
window.__app.placedKeyboard = () => (quest ? [...quest.placed.values()][0] ?? null : null);   // test hook
window.__app.roam = roam;
window.__app.lighting = lighting;
window.__app.questCamera = () => ({ feed: questFeed, calibration, tracker, state: questCam });
window.__app.tagMarks = tagMarks;
window.__app.askText = (label, value, opts) => askText(label, value, opts);
window.__app.openKeyboard = (opts) => openKeyboard(opts);

// Test hook: colour of the pixel where a world point lands, read right
// after the next frame is drawn (checks what is actually visible).
const pixelSamples = [];
window.__app.samplePixel = (xyz) => new Promise((resolve) => pixelSamples.push({ xyz, resolve }));
window.__app.occlusion = occlusion;
window.__app.handRec = handRec;
window.__app.labelPad = labelPad;
function samplePixels(frame) {
  const cam = renderer.xr.getCamera().cameras[0];
  const layer = frame.session.renderState.baseLayer;
  const target = renderer.getRenderTarget();
  withRawGL(renderer, (gl) => {
    for (const { xyz, resolve } of pixelSamples.splice(0)) {
      const p = new THREE.Vector3(...xyz).project(cam);
      const vp = cam.viewport;
      const x = Math.round(vp.x + ((p.x + 1) / 2) * vp.z), y = Math.round(vp.y + ((p.y + 1) / 2) * vp.w);
      const px = new Uint8Array(4);
      if (layer) { gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      else if (target) renderer.readRenderTargetPixels(target, x, y, 1, 1, px);
      resolve([...px]);
    }
  });
}

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

boot().catch((err) => log(`error: ${err.message}`));
