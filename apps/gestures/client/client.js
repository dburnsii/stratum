// Gesture Studio (Stratum app): see a perfect example of a hand gesture, see
// live what the headset reads from your hand, record your own (saved), and
// replay them with a ✓ / ✗ for whether the detector catches them.
//
// The detectors are the real ones (js/ui/revelio.js HandGestures, pinball's
// flex rule), fed with your hand in this instance's frame (ctx.hands /
// ctx.viewer), so what passes here passes in the world. Recordings: one hand,
// 2.5 s at 24 Hz, packed as Int16 mm (head, gaze ×1000, 25 joints), one
// ctx.state key each (`s:<gesture>:<id>`, ≤ 16 KB) plus an index per gesture
// (`samples:<gesture>`): they're there to tune the detectors from.
const REC_S = 2.5, REC_HZ = 24, COUNTDOWN_S = 3, MAX_SAMPLES = 12;
const PANEL = { w: 0.48, h: 0.27, y: 0.43, z: -0.12 };   // above the example hand
const DEMO_AT = [0, 0.13, 0.05];            // where the example hand performs (instance frame)
const EXAMPLE = 0x63e6be, MINE = 0xffc078;
const BTN_H = 0.034;
const FLEX = { in: 0.45, out: 0.65 };       // pinball's flip (apps/pinball FLEX_IN / FLEX_OUT)

let THREE, rv, HandPuppet;

// ---- example hands -----------------------------------------------------------------------------------
// A right hand in its own frame: wrist at (0, -0.06, 0), fingers up (+y),
// index toward +x, palm toward +z. curl 0..1 (fist), bunch 0..1 (all five
// fingertips together).
const XS = [0.03, 0.01, -0.01, -0.03];
const OPEN_F = [[-0.04, 0], [0.03, 0], [0.07, 0], [0.095, 0], [0.115, 0]];
const FIST_F = [[-0.04, 0], [0.03, 0], [0.04, 0.02], [0.02, 0.03], [0, 0.03]];
const BUNCH_F = [[-0.04, 0], [0.03, 0], [0.06, 0.015], [0.075, 0.03], [0.08, 0.04]];
const THUMB_OPEN = [[0.025, -0.045, 0], [0.045, -0.025, 0], [0.06, 0, 0], [0.07, 0.02, 0]];
const THUMB_IN = [[0.025, -0.045, 0], [0.035, -0.015, 0.02], [0.025, 0.03, 0.035], [0.006, 0.076, 0.04]];
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };

function handJoints({ curl = 0, bunch = 0 } = {}) {
  const j = [new THREE.Vector3(0, -0.06, 0)];
  THUMB_OPEN.forEach((p, k) => { const q = THUMB_IN[k], b = Math.max(bunch, curl * 0.5); j.push(new THREE.Vector3(lerp(p[0], q[0], b), lerp(p[1], q[1], b), lerp(p[2], q[2], b))); });
  XS.forEach((x, f) => {
    for (let k = 0; k < 5; k++) {
      let y = lerp(OPEN_F[k][0], FIST_F[k][0], curl), z = lerp(OPEN_F[k][1], FIST_F[k][1], curl);
      y = lerp(y, BUNCH_F[k][0], bunch); z = lerp(z, BUNCH_F[k][1], bunch);
      let px = x * (1 - 0.7 * bunch);
      if (k === 4) { px = lerp(px, (f - 1.5) * 0.004, bunch); y = lerp(y, 0.08, bunch); z = lerp(z, 0.04 + (f % 2) * 0.004, bunch); }
      j.push(new THREE.Vector3(px, y, z));
    }
  });
  return j;
}

const place = (j, pos, quat) => j.map((p) => p.applyQuaternion(quat).add(pos));
const Q = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));

// Each example: the right hand's joints at loop time t (0..1), in the instance frame.
const DEMOS = {
  // Palm away, slide right at an easy pace.
  revelio: (t) => {
    const x = lerp(-0.1, 0.12, smooth(0.25, 0.55, t));
    return place(handJoints(), new THREE.Vector3(DEMO_AT[0] + x, DEMO_AT[1], DEMO_AT[2]), Q(0, Math.PI, 0));
  },
  // Fingertips together, hold, then open while turning clockwise (as you see it).
  shoo: (t) => {
    const b = smooth(0.08, 0.25, t) * (1 - smooth(0.5, 0.66, t)), turn = 1.3 * smooth(0.5, 0.68, t);   // (palm away: +z here is clockwise as you see it)
    return place(handJoints({ bunch: b }), new THREE.Vector3(DEMO_AT[0] + 0.05 * smooth(0.5, 0.68, t), DEMO_AT[1], DEMO_AT[2]), Q(0, Math.PI, turn));
  },
  // Fingertips together (select), then spread (reveal).
  back: (t) => {
    const b = smooth(0.1, 0.28, t) * (1 - smooth(0.5, 0.58, t));
    return place(handJoints({ bunch: b }), new THREE.Vector3(...DEMO_AT), Q(-0.35, Math.PI, 0));
  },
  // Hanging by the cabinet's side, palm in; curl to flip, straighten to let go (twice).
  flip: (t) => {
    const c = 0.9 * (smooth(0.15, 0.22, t) * (1 - smooth(0.4, 0.47, t)) + smooth(0.6, 0.67, t) * (1 - smooth(0.85, 0.92, t)));
    return place(handJoints({ curl: c }), new THREE.Vector3(DEMO_AT[0], DEMO_AT[1] + 0.06, DEMO_AT[2]), Q(0, -Math.PI / 2, Math.PI));
  },
};

const GESTURES = [
  { id: 'revelio', name: '✨ Revelio', loop: 2.6, steps: ['Open your hand, palm facing away', 'Slide it sideways, an easy pace', 'Right hand → right · left hand ← left'] },
  { id: 'shoo', name: '💨 Shoo', loop: 2.6, steps: ['All five fingertips together, on the thing', 'Hold a moment', 'Open while turning (right: clockwise)'] },
  { id: 'back', name: '👌 Bring back', loop: 2.2, steps: ['Aim at a glow: fingertips together (or pinch)', 'Then spread them open'] },
  { id: 'flip', name: '🪩 Pinball flip', loop: 2.6, steps: ['Hand hanging by the red button', 'Curl your fingers in: flip', 'Straighten them: let go'] },
];

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    rv = await import('/js/ui/revelio.js');
    ({ HandPuppet } = await import('/js/apps/kit/handpuppet.js'));
    const s = (ctx.studio = {
      g: GESTURES[0], side: 'right', mode: 'example', t0: performance.now(), buttons: [], tipsIn: new Set(),
      det: new rv.HandGestures(), flash: 0, count: 0, rec: null, samples: [], cache: new Map(), hist: [], flexed: false, meters: [],
    });
    s.group = new THREE.Group();
    ctx.spawn(s.group);
    s.puppets = { right: new HandPuppet(THREE, 'right', { color: EXAMPLE }), left: new HandPuppet(THREE, 'left', { color: EXAMPLE }) };
    for (const p of Object.values(s.puppets)) s.group.add(p.group);
    buildPanel(ctx);
    await loadSamples(ctx);
    redraw(ctx);
    window.__studio = { ctx, pick: (id) => pick(ctx, id), record: () => startRecording(ctx), samples: () => s.samples, decode, detect: (g, sample) => detect(g, sample), demo: (id, t, side) => demoJoints(id, t, side), play: () => setMode(ctx, 'mine') };   // test hook
  },

  frame(ctx) {
    const s = ctx.studio;
    if (!s) return;
    const now = performance.now();
    animatePuppet(ctx, now);
    const hands = ctx.hands(), v = ctx.viewer();
    const h = hands?.[s.side], head = v?.position ?? null, gaze = v ? new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion) : null;
    live(ctx, h, head, gaze, now);
    if (s.rec) recordFrame(ctx, h, head, gaze, now);
    pokeButtons(ctx, hands);
    if (now - (s.drawnAt ?? 0) > 100) { s.drawnAt = now; redraw(ctx); }
  },

  press(ctx, e) {
    if (e.phase !== 'down') return true;
    const b = buttonOf(e.object);
    if (b) { pressButton(b); return true; }
    return false;
  },
  grab(ctx, e) { if (!e.handle) e.preventDefault(); },

  async stop(ctx) { if (window.__studio?.ctx === ctx) delete window.__studio; },
};

function demoJoints(id, t, side) {
  const j = DEMOS[id](t);
  if (side === 'left') for (const p of j) p.x = 2 * DEMO_AT[0] - p.x;   // the mirror image: a left hand doing it the left way
  return j;
}

// ---- the example / replay hand --------------------------------------------------------------------------

function animatePuppet(ctx, now) {
  const s = ctx.studio;
  const p = s.puppets[s.mode === 'mine' ? s.playing?.side ?? s.side : s.side];
  for (const q of Object.values(s.puppets)) if (q !== p) q.visible = false;
  if (s.mode === 'example') {
    const t = ((now - s.t0) / 1000 / s.g.loop) % 1;
    p.setColor(EXAMPLE);
    p.pose(demoJoints(s.g.id, t, s.side));
    p.visible = true;
  } else if (s.playing) {
    const f = s.playing.frames, i = Math.floor(((now - s.t0) / 1000) * REC_HZ) % (f.length + REC_HZ / 2);   // a short pause between loops
    p.setColor(MINE);
    p.visible = i < f.length;
    if (p.visible) p.pose(f[i].joints);
  } else p.visible = false;
}

// ---- live: what the headset reads from your hand --------------------------------------------------------

function live(ctx, h, head, gaze, now) {
  const s = ctx.studio, g = s.g.id;
  const joints = h?.joints ?? null;
  const events = s.det.update(s.side, joints, head, now, gaze);
  let hit = false;
  for (const e of events) {
    if (e.type === 'gather') s.gathered = true;
    if ((g === 'revelio' && e.type === 'cast') || (g === 'shoo' && e.type === 'shoo') || (g === 'back' && e.type === 'spread' && s.gathered)) hit = true;
    if (e.type === 'spread' || e.type === 'release') s.gathered = false;
  }
  if (!joints || !head) { s.meters = [['No hand seen', `show your ${s.side} hand`, null]]; return; }
  const sh = rv.handShape(joints, head, s.side);
  const view = gaze ? Math.round(Math.acos(Math.max(-1, Math.min(1, sh.center.clone().sub(head).normalize().dot(gaze)))) * 180 / Math.PI) : 0;
  const mark = (ok) => (ok ? '✓' : '✗');
  if (g === 'revelio') {
    // Sideways travel in the last 0.9 s (toward your hand's side).
    s.hist.push({ t: now, p: sh.center.clone() });
    while (s.hist.length && now - s.hist[0].t > 900) s.hist.shift();
    const right = gaze ? new THREE.Vector3().crossVectors(gaze, new THREE.Vector3(0, 1, 0)).normalize() : new THREE.Vector3(1, 0, 0);
    const dir = s.side === 'left' ? -1 : 1;
    const slid = Math.max(0, ...s.hist.map((q) => sh.center.clone().sub(q.p).dot(right) * dir));
    const prev = s.hist.at(-2), speed = prev ? sh.center.distanceTo(prev.p) / Math.max(1e-3, (now - prev.t) / 1000) : 0;
    s.meters = [['Open hand', mark(sh.open), sh.open], ['Palm away', `${sh.away.toFixed(2)} (≥ 0.35)`, sh.away >= 0.35], ['In view', `${view}° (≤ 45°)`, view <= 45],
      ['Slid sideways', `${Math.round(slid * 100)} cm (15)`, slid >= 0.15], ['Speed', `${speed.toFixed(2)} m/s (≤ 1.6)`, speed <= 1.6]];
  } else if (g === 'shoo' || g === 'back') {
    const st = s.det.s[s.side];
    const held = st?.gather ? now - st.gather.t : 0;
    const turned = st?.after ? Math.round((st.phi - st.after.phi0) * (s.side === 'left' ? -1 : 1) * 180 / Math.PI) : 0;
    s.meters = [['Fingertips together', `${(sh.bunch * 100).toFixed(1)} cm (≤ ${(rv.BUNCH_IN ?? 0.035) * 100})`, sh.bunch <= (rv.BUNCH_IN ?? 0.035)], ['Pinch', `${(sh.pinch * 100).toFixed(1)} cm (≤ 1.8)`, sh.pinch <= 0.018],
      ...(g === 'shoo' ? [['Held', `${Math.round(held)} ms (300)`, held >= 300], ['Turn after opening', `${turned}° (55)`, turned >= 55]] : []), ['Open', mark(sh.open), sh.open]];
  } else if (g === 'flip') {
    const st = fingerStraightness(joints);
    const was = s.flexed;
    s.flexed = was ? st < FLEX.out : st < FLEX.in;
    if (s.flexed && !was) hit = true;
    s.meters = [['Finger straightness', `${st.toFixed(2)} (flip < 0.45, let go > 0.65)`, s.flexed], ['Flipper', s.flexed ? 'UP' : 'down', s.flexed]];
  }
  if (hit) { s.flash = now; s.count++; ctx.telemetry?.('studio detected', { gesture: g, side: s.side }); }
}

function fingerStraightness(j) {
  let sum = 0;
  for (let f = 0; f < 4; f++) {
    const b = 5 + f * 5;
    sum += j[b + 1].clone().sub(j[b]).normalize().dot(j[b + 4].clone().sub(j[b + 1]).normalize());
  }
  return sum / 4;
}

// Would the detector catch this recording? (Replays it through a fresh detector.)
function detect(gid, sample) {
  const det = new rv.HandGestures();
  let gathered = false, flexed = false, ok = false;
  for (const f of sample.frames) {
    if (gid === 'flip') {
      const st = fingerStraightness(f.joints), was = flexed;
      flexed = was ? st < FLEX.out : st < FLEX.in;
      if (flexed && !was) ok = true;
      continue;
    }
    for (const e of det.update(sample.side, f.joints, f.head, f.t, f.gaze)) {
      if (e.type === 'gather') gathered = true;
      if ((gid === 'revelio' && e.type === 'cast') || (gid === 'shoo' && e.type === 'shoo') || (gid === 'back' && e.type === 'spread' && gathered)) ok = true;
      if (e.type === 'spread' || e.type === 'release') gathered = false;
    }
  }
  return ok;
}

// ---- recording ------------------------------------------------------------------------------------------------

function startRecording(ctx) {
  const s = ctx.studio;
  if (s.rec) return;
  s.rec = { t0: performance.now() + COUNTDOWN_S * 1000, frames: [], next: 0, ticks: 0 };
}

function recordFrame(ctx, h, head, gaze, now) {
  const s = ctx.studio, r = s.rec;
  if (now < r.t0 || now < r.next) return;
  r.next = now + 1000 / REC_HZ;
  r.ticks++;
  if (h && head && gaze) r.frames.push({ t: now - r.t0, head: head.clone(), gaze: gaze.clone(), joints: h.joints.map((p) => p.clone()) });
  if (now - r.t0 >= REC_S * 1000) finishRecording(ctx);
}

async function finishRecording(ctx) {
  const s = ctx.studio, r = s.rec;
  s.rec = null;
  // No hand: it wasn't there for most of it (not: few frames, a slow headset still records).
  if (r.frames.length < Math.max(6, r.ticks * 0.4)) { s.note = 'No hand seen: try again'; return; }
  const sample = { side: s.side, frames: r.frames };
  const ok = detect(s.g.id, sample);
  const id = Date.now().toString(36);
  const key = `s:${s.g.id}:${id}`;
  await ctx.state.set(key, encode(sample)).catch((err) => { s.note = `Couldn't save: ${err.message}`; });
  s.samples.push({ key, side: s.side, ok, at: Date.now() });
  while (s.samples.length > MAX_SAMPLES) { const old = s.samples.shift(); ctx.state.set(old.key, null).catch(() => {}); }
  await ctx.state.set(`samples:${s.g.id}`, s.samples).catch(() => {});
  s.cache.set(key, sample);
  s.note = ok ? 'Saved ✓ the detector catches it' : 'Saved ✗ the detector misses it (good to know: that\'s what tuning is for)';
  ctx.telemetry?.('studio sample', { gesture: s.g.id, side: s.side, ok, frames: r.frames.length });
  playLast(ctx);
}

function encode({ side, frames }) {
  const a = new Int16Array(frames.length * 81), mm = (v) => Math.max(-32767, Math.min(32767, Math.round(v * 1000)));
  frames.forEach((f, i) => {
    const o = i * 81;
    [f.head.x, f.head.y, f.head.z, f.gaze.x, f.gaze.y, f.gaze.z].forEach((v, k) => { a[o + k] = mm(v); });
    f.joints.forEach((p, k) => { a[o + 6 + k * 3] = mm(p.x); a[o + 7 + k * 3] = mm(p.y); a[o + 8 + k * 3] = mm(p.z); });
  });
  let bin = '';
  const bytes = new Uint8Array(a.buffer);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return { v: 1, side, hz: REC_HZ, t: frames.map((f) => Math.round(f.t)), data: btoa(bin) };
}

function decode(enc) {
  const bin = atob(enc.data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const a = new Int16Array(bytes.buffer), n = a.length / 81, V = (o) => new THREE.Vector3(a[o] / 1000, a[o + 1] / 1000, a[o + 2] / 1000);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const o = i * 81;
    frames.push({ t: enc.t?.[i] ?? (i * 1000) / (enc.hz ?? REC_HZ), head: V(o), gaze: V(o + 3).normalize(), joints: Array.from({ length: 25 }, (_, k) => V(o + 6 + k * 3)) });
  }
  return { side: enc.side, frames };
}

async function loadSamples(ctx) {
  const s = ctx.studio;
  s.samples = (await ctx.state.get(`samples:${s.g.id}`).catch(() => null)) ?? [];
}

async function playLast(ctx) {
  const s = ctx.studio, last = s.samples.at(-1);
  if (!last) { s.note = 'Nothing recorded yet for this one'; return; }
  let sample = s.cache.get(last.key);
  if (!sample) {
    const enc = await ctx.state.get(last.key).catch(() => null);
    if (!enc) { s.note = 'That recording is gone'; return; }
    sample = decode(enc);
    s.cache.set(last.key, sample);
  }
  s.playing = sample;
  setMode(ctx, 'mine');
}

function setMode(ctx, mode) {
  const s = ctx.studio;
  s.mode = mode;
  s.t0 = performance.now();
}

async function deleteLast(ctx) {
  const s = ctx.studio, last = s.samples.pop();
  if (!last) return;
  ctx.state.set(last.key, null).catch(() => {});
  await ctx.state.set(`samples:${s.g.id}`, s.samples).catch(() => {});
  s.cache.delete(last.key);
  if (s.mode === 'mine') setMode(ctx, 'example');
  s.note = 'Deleted the last one';
}

async function pick(ctx, id) {
  const s = ctx.studio;
  s.g = GESTURES.find((g) => g.id === id) ?? s.g;
  s.det = new rv.HandGestures();
  s.hist = []; s.count = 0; s.note = ''; s.playing = null;
  ctx.telemetry?.('studio practising', { gesture: s.g.id, side: s.side });   // (a label for the hand recording: what you're about to do)
  setMode(ctx, 'example');
  await loadSamples(ctx);
  redraw(ctx);
}

// ---- panel ------------------------------------------------------------------------------------------------------

function makeButton(ctx, w, h, draw, run) {
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(200 * w / h), height: 200 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const b = { mesh, w, h, run, redraw: () => { const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); draw(g, canvas.width, canvas.height); tex.needsUpdate = true; } };
  mesh.userData.btn = b;
  b.redraw();
  ctx.studio.buttons.push(b);
  return b;
}
const buttonOf = (node) => { for (let n = node; n; n = n.parent) if (n.userData?.btn) return n.userData.btn; return null; };
function pressButton(b) {
  const now = performance.now();
  if (now - (b.at ?? -1e9) < 400) return;
  b.at = now;
  b.mesh.scale.setScalar(0.9);
  setTimeout(() => b.mesh.scale.setScalar(1), 120);
  b.run();
}

function pill(g, w, h, fill, label, on = false) {
  g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, h * 0.3);
  g.fillStyle = fill; g.fill();
  if (on) { g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke(); }
  g.fillStyle = '#fff'; g.font = `700 ${h * 0.4}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, w / 2, h * 0.54);
}

function buildPanel(ctx) {
  const s = ctx.studio;
  // A stand (the handle: hold it to move the studio) and the board.
  const stand = new THREE.Mesh(new THREE.BoxGeometry(PANEL.w, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.6 }));
  stand.position.set(0, 0.006, PANEL.z + 0.02);
  stand.userData.handle = true;
  s.group.add(stand);
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 576 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.w, PANEL.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  board.position.set(0, PANEL.y, PANEL.z);
  board.userData.handle = true;
  s.group.add(board);
  s.board = { canvas, tex };
  // Gesture tabs along the top.
  const tw = (PANEL.w - 0.02) / GESTURES.length - 0.006;
  s.tabs = GESTURES.map((g, i) => {
    const b = makeButton(ctx, tw, BTN_H, (c, w, h) => pill(c, w, h, s.g.id === g.id ? '#0ca678' : '#343a40', g.name, s.g.id === g.id), () => pick(ctx, g.id));
    b.mesh.position.set(-PANEL.w / 2 + 0.01 + tw / 2 + i * (tw + 0.006) + 0.003, PANEL.y + PANEL.h / 2 - BTN_H / 2 - 0.008, PANEL.z + 0.003);
    s.group.add(b.mesh);
    return b;
  });
  // Actions along the bottom.
  const acts = [
    ['rec', () => (s.rec ? (s.rec.t0 > performance.now() ? `⏳ ${Math.ceil((s.rec.t0 - performance.now()) / 1000)}` : '● Recording') : '● Record'), '#c92a2a', () => startRecording(ctx)],
    ['mine', () => (s.mode === 'mine' ? '▶ Playing mine' : '▶ Play mine'), '#e8590c', () => (s.mode === 'mine' ? setMode(ctx, 'example') : playLast(ctx))],
    ['example', () => '✋ Example', '#0b7285', () => setMode(ctx, 'example')],
    ['del', () => '🗑 Last', '#495057', () => deleteLast(ctx)],
    ['side', () => (s.side === 'right' ? 'Right hand' : 'Left hand'), '#5f3dc4', () => { s.side = s.side === 'right' ? 'left' : 'right'; s.det = new rv.HandGestures(); s.hist = []; ctx.telemetry?.('studio practising', { gesture: s.g.id, side: s.side }); setMode(ctx, 'example'); }],
  ];
  const aw = (PANEL.w - 0.02) / acts.length - 0.006;
  s.acts = acts.map(([key, label, color, run], i) => {
    const b = makeButton(ctx, aw, BTN_H, (c, w, h) => pill(c, w, h, color, label()), run);
    b.key = key;
    b.mesh.position.set(-PANEL.w / 2 + 0.01 + aw / 2 + i * (aw + 0.006) + 0.003, PANEL.y - PANEL.h / 2 + BTN_H / 2 + 0.008, PANEL.z + 0.003);
    s.group.add(b.mesh);
    return b;
  });
}

function redraw(ctx) {
  const s = ctx.studio, c = s.board.canvas.getContext('2d'), now = performance.now();
  c.clearRect(0, 0, 1024, 576);
  c.beginPath(); c.roundRect(0, 0, 1024, 576, 36); c.fillStyle = 'rgba(12,14,20,0.9)'; c.fill();
  c.textBaseline = 'middle'; c.textAlign = 'left';
  // Left: how to do it.
  c.fillStyle = '#fff'; c.font = '700 40px system-ui, sans-serif';
  c.fillText(s.g.name, 36, 128);
  c.font = '28px system-ui, sans-serif'; c.fillStyle = '#c9d1e0';
  s.g.steps.forEach((t, i) => c.fillText(`${i + 1}. ${t}`.slice(0, 40), 36, 180 + i * 40));
  c.fillStyle = s.mode === 'mine' ? '#ffc078' : '#63e6be'; c.font = '600 24px system-ui, sans-serif';
  c.fillText(s.mode === 'mine' ? 'Playing your last recording' : 'Teal hand: the perfect example', 36, 320);
  // Samples.
  c.fillStyle = '#e9ecef'; c.font = '600 26px system-ui, sans-serif';
  c.fillText(`Yours: ${s.samples.length ? s.samples.map((x) => (x.ok ? '✓' : '✗')).join(' ') : 'none yet'}`.slice(0, 44), 36, 380);
  if (s.note) { c.fillStyle = '#adb5bd'; c.font = '22px system-ui, sans-serif'; c.fillText(s.note.slice(0, 58), 36, 420); }
  // Right: live meters.
  c.fillStyle = '#fff'; c.font = '700 30px system-ui, sans-serif';
  c.fillText(`Live · ${s.side} hand`, 560, 128);
  s.meters.forEach(([k, v, ok], i) => {
    c.fillStyle = ok == null ? '#adb5bd' : ok ? '#51cf66' : '#ff8787';
    c.font = '600 24px system-ui, sans-serif'; c.fillText(k, 560, 168 + i * 46);
    c.fillStyle = '#e9ecef'; c.font = '21px system-ui, sans-serif'; c.fillText(String(v).slice(0, 40), 560, 190 + i * 46);
  });
  if (now - s.flash < 1200) {
    c.fillStyle = 'rgba(81,207,102,0.95)'; c.beginPath(); c.roundRect(560, 400, 420, 70, 20); c.fill();
    c.fillStyle = '#fff'; c.font = '800 36px system-ui, sans-serif'; c.fillText(`✓ Detected! (${s.count})`, 590, 436);
  } else if (s.count) { c.fillStyle = '#adb5bd'; c.font = '24px system-ui, sans-serif'; c.fillText(`Caught ${s.count}× this session`, 560, 436); }
  s.board.tex.needsUpdate = true;
  for (const b of [...s.tabs, ...s.acts]) b.redraw();
}

function pokeButtons(ctx, hands) {
  const s = ctx.studio;
  if (!hands) { s.tipsIn.clear(); return; }
  const now = new Set();
  for (const side of ['left', 'right']) {
    const tip = hands[side]?.joints[9];
    if (!tip) continue;
    s.buttons.forEach((b, i) => {
      const at = ctx.toLocal(b.mesh.getWorldPosition(new THREE.Vector3()));
      const d = tip.clone().sub(at);
      if (Math.abs(d.x) < b.w / 2 && Math.abs(d.y) < b.h / 2 && Math.abs(d.z) < 0.015) {
        const key = `${side}|${i}`;
        now.add(key);
        if (!s.tipsIn.has(key)) pressButton(b);
      }
    });
  }
  s.tipsIn = now;
}
