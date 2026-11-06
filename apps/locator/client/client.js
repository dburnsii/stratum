// Find It (Stratum app): a dictionary of where things are. Mark a spot with a
// name; later pick the name from the list (pinned to the menu's Home) and an
// arrow in front of you points the way while a marker glows on the spot.
//
// One instance per space (a little pin stand, placed anywhere) holds that
// space's list in its config, shared with everyone in the space:
//   { items: [{ id, name, emoji, p: [x, y, z] (instance frame), at }] }
// Marking a name that's already there moves it.
import { pointIn } from '/js/apps/kit/playarea.js';

let THREE;
const FOUND_M = 0.55;            // this close (head to the spot, level distance): found
const FOUND_HOLD_MS = 6000;      // the marker stays this long after found
const FIND_MAX_MS = 4 * 60e3;
const ARROW = { ahead: 0.45, below: 0.22, size: 0.09 };
const MARK_REACH = 0.8;          // m along the ray when nothing is hit

// Names → an emoji (first match), so the list reads at a glance.
const EMOJI = [
  [/key/, '🔑'], [/batter/, '🔋'], [/charg|cable|cord|hdmi|usb|adapter/, '🔌'], [/remote/, '📺'], [/glass|spectacle/, '👓'],
  [/wallet|purse/, '👛'], [/passport|document|paper|tax|receipt/, '📄'], [/med|pill|vitamin|bandage|first aid/, '💊'],
  [/tool|screw|drill|wrench|hammer|allen|hex/, '🔧'], [/tape/, '🩹'], [/scissor/, '✂️'], [/pen|pencil|marker/, '🖊️'],
  [/headphone|earbud|airpod/, '🎧'], [/phone/, '📱'], [/laptop|computer/, '💻'], [/camera/, '📷'], [/light|bulb|torch|flashlight/, '🔦'],
  [/gift|present/, '🎁'], [/book/, '📚'], [/game|controller/, '🎮'], [/sock|cloth|shirt|jacket|coat/, '🧦'], [/shoe|boot/, '👟'],
  [/umbrella/, '☂️'], [/bag|backpack/, '🎒'], [/dog|cat|pet|leash/, '🐾'], [/spice|food|snack|coffee|tea/, '🥫'],
  [/filament|print/, '🧵'], [/candle|match|lighter/, '🕯️'], [/stamp|envelope|mail/, '✉️'], [/sewing|needle|thread/, '🪡'],
];
const emojiFor = (name) => EMOJI.find(([re]) => re.test(name.toLowerCase()))?.[1] ?? '📦';

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const f = (ctx.find = { items: (ctx.instance.config?.items ?? []).map((it) => ({ ...it })), target: null, marking: null, pins: new Map(), menuAt: 0, menuSig: '' });
    f.group = new THREE.Group();
    ctx.spawn(f.group);
    buildStand(ctx);
    f.marker = buildMarker();
    f.marker.visible = false;
    f.group.add(f.marker);
    f.arrow = buildArrow();
    f.arrow.visible = false;
    f.group.add(f.arrow);
    setMenu(ctx);
    setActions(ctx);
    window.__find = {   // test hook
      ctx, items: () => f.items.map((it) => ({ ...it })), mark: (name, p) => saveItem(ctx, name, p), find: (id) => find(ctx, id),
      startMark: (name) => startMark(ctx, name), state: () => ({ target: f.target && { ...f.target }, marking: f.marking && { ...f.marking },
        arrow: f.arrow.visible, marker: f.marker.visible, arrowDir: f.arrowDir?.toArray(), arrowPos: f.arrow.position.toArray(), markerPos: f.marker.position.toArray() }),
    };
  },

  frame(ctx, dt) {
    const f = ctx.find;
    if (!f) return;
    const now = performance.now(), v = ctx.viewer();
    if (f.target) guide(ctx, f, v, now, dt);
    drawPins(ctx, f, now);
    if (now - f.menuAt > 2000) { f.menuAt = now; setMenu(ctx); }   // (distances in the list)
  },

  // While marking, any pinch / tap is the spot.
  globalPress(ctx) { return !!ctx.find?.marking; },
  press(ctx, e) {
    const f = ctx.find;
    if (!f?.marking) return false;
    if (e.phase !== 'down') return true;
    const p = spotOf(ctx, e);
    if (p) { saveItem(ctx, f.marking.name, p); f.marking = null; ctx.status(''); setActions(ctx); }
    return true;
  },

  async stop(ctx) {
    if (window.__find?.ctx === ctx) delete window.__find;
  },
};

// ---- the list --------------------------------------------------------------------------------------

function setMenu(ctx) {
  const f = ctx.find, v = ctx.viewer();
  const dist = (it) => (v ? Math.hypot(it.p[0] - v.position.x, it.p[2] - v.position.z) : null);
  const sorted = [...f.items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const items = sorted.map((it) => {
    const d = dist(it);
    return { id: it.id, emoji: it.emoji, label: it.name, sub: f.target?.id === it.id ? (f.target.found ? 'Found ✓' : 'Finding…') : d == null ? '' : `${d < 1 ? `${Math.round(d * 100)} cm` : `${d.toFixed(1)} m`} away`,
      run: () => find(ctx, it.id), remove: () => removeItem(ctx, it.id) };
  });
  const sig = JSON.stringify(items.map((i) => [i.id, i.label, i.sub])) + (f.marking ? 'm' : '');
  if (sig === f.menuSig) return;
  f.menuSig = sig;
  ctx.menu({ pin: true, title: '📍 Find', items, empty: 'Nothing marked yet', add: { label: f.marking ? `Pinch where the ${f.marking.name} is…` : 'Mark where something is', run: () => startMark(ctx) } });
}

function setActions(ctx) {
  const f = ctx.find;
  ctx.actions([
    { label: '＋ Mark where something is', run: () => startMark(ctx) },
    ...(f.target ? [{ label: '✕ Stop finding', run: () => stopFinding(ctx) }] : []),
    ...(f.marking ? [{ label: '✕ Cancel marking', run: () => { f.marking = null; ctx.status(''); setActions(ctx); setMenu(ctx); } }] : []),
  ]);
}

async function startMark(ctx, given = null) {
  const f = ctx.find;
  const name = (given ?? (await ctx.prompt('What are you marking? (e.g. spare keys)', '')))?.trim();
  if (!name) return;
  f.marking = { name: name.slice(0, 40) };
  ctx.status(`📍 Pinch where the ${f.marking.name} is`);
  setActions(ctx);
  setMenu(ctx);
}

function saveItem(ctx, name, p) {
  const f = ctx.find, clean = name.trim().slice(0, 40), same = f.items.find((it) => it.name.toLowerCase() === clean.toLowerCase());
  const pos = (Array.isArray(p) ? p : p.toArray()).map((x) => Math.round(x * 1000) / 1000);
  if (same) Object.assign(same, { p: pos, at: Date.now() });   // marking a name again moves it
  else f.items.push({ id: Math.random().toString(36).slice(2, 10), name: clean, emoji: emojiFor(clean), p: pos, at: Date.now() });
  persist(ctx);
  ctx.log(`📍 ${clean} marked`);
  return (same ?? f.items.at(-1)).id;
}

function removeItem(ctx, id) {
  const f = ctx.find;
  f.items = f.items.filter((it) => it.id !== id);
  if (f.target?.id === id) stopFinding(ctx);
  persist(ctx);
}

function persist(ctx) {
  const f = ctx.find;
  ctx.setConfig({ ...(ctx.instance.config ?? {}), items: f.items });   // shared with the space (others restart onto it)
  f.menuSig = '';
  setMenu(ctx);
}

// Where a press points: a virtual thing it hit, else the room map along its ray, else the surface under the reticle, else a little way out.
function spotOf(ctx, e) {
  if (e.point) return e.point.clone();
  const ray = e.ray?.();
  if (ray) {
    const hit = roomHit(ctx, ray);
    if (hit) return hit;
  }
  const s = ctx.surface?.();
  if (s) return s;
  return ray ? ray.origin.clone().addScaledVector(ray.dir, MARK_REACH) : null;
}

// The nearest room-map surface along a ray (instance frame), or null.
function roomHit(ctx, ray) {
  let best = null, bestD = Infinity;
  const o = new THREE.Vector3(), e = new THREE.Vector3();
  for (const s of ctx.surfaces?.() ?? []) {
    if (!s.polygon?.length) continue;
    const inv = s.matrix.clone().invert();
    o.copy(ray.origin).applyMatrix4(inv);
    e.copy(ray.origin).add(ray.dir).applyMatrix4(inv).sub(o);   // the direction in the surface's frame
    if (Math.abs(e.y) < 1e-6) continue;
    const t = -o.y / e.y;
    if (t <= 0) continue;
    const x = o.x + e.x * t, z = o.z + e.z * t;
    if (!pointIn(s.polygon, x, z)) continue;
    const hit = new THREE.Vector3(x, 0, z).applyMatrix4(s.matrix), d = hit.distanceTo(ray.origin);
    if (d > 0.05 && d < bestD) { bestD = d; best = hit; }
  }
  return best;
}

// ---- finding ---------------------------------------------------------------------------------------------

function find(ctx, id) {
  const f = ctx.find, it = f.items.find((x) => x.id === id);
  if (!it) return;
  f.target = { id, name: it.name, p: it.p, since: performance.now(), found: false, foundAt: 0 };
  setLabel(f.marker, `${it.emoji} ${it.name}`);
  f.marker.position.set(...it.p);
  f.marker.visible = true;
  f.arrow.visible = true;
  f.arrowReady = false;
  ctx.status(`📍 Finding ${it.name}`);
  setActions(ctx);
  f.menuSig = '';
  setMenu(ctx);
}

function stopFinding(ctx) {
  const f = ctx.find;
  f.target = null;
  f.marker.visible = false;
  f.arrow.visible = false;
  ctx.status('');
  setActions(ctx);
  f.menuSig = '';
  setMenu(ctx);
}

function guide(ctx, f, v, now, dt) {
  const t = f.target, spot = new THREE.Vector3(...t.p);
  // The marker: a bobbing pin over the spot, a ripple ring on it, a beam up from it.
  const k = (now - t.since) / 1000;
  f.marker.userData.pin.position.y = 0.12 + Math.sin(k * 3) * 0.015;
  f.marker.userData.pin.rotation.y = k * 1.5;
  const ripple = (k % 1.4) / 1.4;
  f.marker.userData.ring.scale.setScalar(0.4 + ripple * 1.6);
  f.marker.userData.ring.material.opacity = 0.8 * (1 - ripple);
  f.marker.userData.beam.material.opacity = t.found ? 0.15 : 0.35 + Math.sin(k * 4) * 0.1;
  if (!v) return;
  const eyeWorld = f.group.localToWorld(v.position.clone());   // (lookAt takes world points)
  f.marker.userData.label.lookAt(eyeWorld);
  // The arrow: in front of you, a little low, pointing at the spot.
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const want = v.position.clone().addScaledVector(fwd, ARROW.ahead).add(new THREE.Vector3(0, -ARROW.below, 0));
  if (!f.arrowReady) { f.arrow.position.copy(want); f.arrowReady = true; }
  f.arrow.position.lerp(want, 1 - Math.exp(-dt / 0.12));
  const dir = spot.clone().sub(f.arrow.position);
  const dist = Math.hypot(spot.x - v.position.x, spot.z - v.position.z);
  if (dir.lengthSq() > 1e-6) {
    dir.normalize();
    f.arrowDir = dir.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    f.arrow.quaternion.slerp(q, 1 - Math.exp(-dt / 0.08));
  }
  // Colour by distance: orange far, green close; the distance under it.
  const near = Math.max(0, Math.min(1, 1 - dist / 4));
  f.arrow.userData.mat.color.setHSL(0.07 + near * 0.26, 0.9, 0.55);
  f.arrow.userData.mat.emissive.setHSL(0.07 + near * 0.26, 0.9, 0.25);
  const text = t.found ? 'Found ✓' : dist < 1 ? `${Math.round(dist * 100)} cm` : `${dist.toFixed(1)} m`;
  if (f.arrow.userData.text !== text) { f.arrow.userData.text = text; setLabel(f.arrow, `${text}`, true); }
  // The distance hangs under the arrow (not turning with it), facing you.
  const lbl = f.arrow.userData.label;
  lbl.position.set(0, -ARROW.size * 0.8, 0).applyQuaternion(f.arrow.quaternion.clone().invert());
  lbl.lookAt(eyeWorld);
  if (!t.found && dist < FOUND_M) { t.found = true; t.foundAt = now; chime(); ctx.status(`📍 ${t.name}: found`); f.menuSig = ''; setMenu(ctx); }
  if (t.found) f.arrow.scale.setScalar(Math.max(0.01, 1 - (now - t.foundAt) / 800));
  else f.arrow.scale.setScalar(1);
  if ((t.found && now - t.foundAt > FOUND_HOLD_MS) || now - t.since > FIND_MAX_MS) stopFinding(ctx);
}

// Always-on pins (setting), dim; the one being found is the marker.
function drawPins(ctx, f, now) {
  const want = ctx.settings.get('pins') ? f.items.filter((it) => it.id !== f.target?.id) : [];
  const seen = new Set();
  for (const it of want) {
    seen.add(it.id);
    let pin = f.pins.get(it.id);
    if (!pin) { pin = smallPin(); f.group.add(pin); f.pins.set(it.id, pin); }
    pin.position.set(...it.p);
    pin.children[0].position.y = 0.05 + Math.sin(now / 600 + it.p[0] * 7) * 0.006;
  }
  for (const [id, pin] of f.pins) if (!seen.has(id)) { pin.removeFromParent(); f.pins.delete(id); }
}

// ---- meshes ------------------------------------------------------------------------------------------

const noPick = (o) => { o.traverse((n) => { n.raycast = () => {}; }); return o; };
const over = (m, order = 990) => { m.depthTest = false; m.depthWrite = false; m.transparent = true; return order; };

// The stand you place: a round base with a big pin in it (the handle).
function buildStand(ctx) {
  const f = ctx.find, g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.01, 32), new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.6 }));
  base.position.y = 0.005;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.018, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe8590c, roughness: 0.35, emissive: 0x7a2e06, emissiveIntensity: 0.3 }));
  head.position.y = 0.06;
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.045, 16).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: 0xced4da, metalness: 0.8, roughness: 0.25 }));
  needle.position.y = 0.032;
  for (const m of [base, head, needle]) m.userData.handle = true;
  g.add(base, head, needle);
  f.group.add(g);
}

function labelPlane(w = 0.22, h = 0.055) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: Math.round(512 * h / w) });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = over(mat, 995);
  mesh.userData.canvas = canvas;
  mesh.userData.tex = tex;
  return mesh;
}

function setLabel(holder, text, small = false) {
  const m = holder.userData.label, c = m.userData.canvas, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.font = `700 ${small ? 64 : 58}px system-ui, sans-serif`;
  const w = Math.min(c.width - 8, g.measureText(text).width + 56);
  g.beginPath(); g.roundRect((c.width - w) / 2, 6, w, c.height - 12, (c.height - 12) / 2);
  g.fillStyle = 'rgba(12,14,20,0.85)'; g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 3, c.width - 40);
  m.userData.tex.needsUpdate = true;
}

// The marker on the spot: pin, ripple ring, beam of light, name; drawn over everything (it may be in a drawer).
function buildMarker() {
  const g = new THREE.Group();
  const pin = new THREE.Group();
  const headMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a }), needleMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), headMat);
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.08, 16).rotateX(Math.PI), needleMat);
  needle.position.y = -0.05;
  head.renderOrder = over(headMat, 993); needle.renderOrder = over(needleMat, 992);
  headMat.opacity = 0.95; needleMat.opacity = 0.9;
  pin.add(head, needle);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffa94d, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 48).rotateX(-Math.PI / 2), ringMat);
  ring.renderOrder = over(ringMat, 991);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe8cc, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.012, 1.6, 12, 1, true).translate(0, 0.8, 0), beamMat);
  beam.renderOrder = over(beamMat, 990);
  const label = labelPlane(0.32, 0.08);
  label.position.y = 0.25;
  g.add(pin, ring, beam, label);
  g.userData = { pin, ring, beam, label };
  return noPick(g);
}

// The arrow that points the way: a fat 3D arrow (along −Z) with the distance under it.
function buildArrow() {
  const g = new THREE.Group(), s = ARROW.size;
  const mat = new THREE.MeshStandardMaterial({ color: 0xff8c1a, emissive: 0x803d00, emissiveIntensity: 1, roughness: 0.4, metalness: 0.1 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.14, s * 0.14, s * 0.7, 16).rotateX(Math.PI / 2), mat);
  shaft.position.z = s * 0.2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(s * 0.32, s * 0.5, 24).rotateX(-Math.PI / 2), mat);
  tip.position.z = -s * 0.4;
  const pointer = new THREE.Group();
  pointer.add(shaft, tip);
  g.add(pointer);
  const label = labelPlane(0.13, 0.04);
  // (the label hangs under the arrow, not turning with it)
  g.add(label);
  g.userData = { mat, label, pointer };
  return noPick(g);
}

function smallPin() {
  const g = new THREE.Group();
  const headMat = new THREE.MeshBasicMaterial({ color: 0xff922b, opacity: 0.7 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), headMat);
  head.renderOrder = over(headMat, 989);
  headMat.opacity = 0.7;
  g.add(head);
  return noPick(g);
}

let audio = null;
function chime() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.12]]) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5);
      o.connect(g); g.connect(audio.destination); o.start(t + d); o.stop(t + d + 0.55);
    }
  } catch {}
}
