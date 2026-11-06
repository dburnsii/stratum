// Little Plane (Stratum app): a toy taildragger and its runway. Placed on a
// table or the floor; you fly it around the room. Everyone flies their own
// plane; the others' planes are drawn from their broadcasts.
//
// Flying (Quest hands): one hand held out flat, palm down, is the plane.
// Tilt (fingers up / down) = elevator, roll = ailerons, turn (left / right of
// where you're looking) = rudder, all relative to how you held it when you
// took it. The thumb is the throttle: tucked along the fingers = full, stuck
// straight out = off (and the brakes on the ground). Controllers: sticks +
// triggers. Phone: an autopilot circuit.
//
// Flight model (instance frame, meters): a rigid body with toy gravity (so
// it flies slowly), lift / drag / side force from angle of attack and
// sideslip, thrust falling off with speed, aerodynamic moments as angular
// accelerations (control + weathervane stability + damping), wheels as
// spring-dampers with rolling / braking / side friction. Fixed steps of 1/240 s.
// The ground: the runway, plus the room map's level surfaces (tables, the
// floor); anything else in the map (walls, …) or a non-wheel touching the
// ground is a crash, and it comes back to the runway.
import { buildPlane, SCHEMES } from './model.js';
import { pointIn } from '/js/apps/kit/playarea.js';

let THREE;
const LEN = 0.24;                 // m, nose to tail
const STEP = 1 / 240;
const G = 2.6;                    // toy gravity (m/s²): everything flies ~4× slower than at real scale
const VREF = 0.72;                // m/s: level at the trim angle of attack
const A0 = 0.045;                 // trim angle of attack (rad)
const CL0 = 0.3, CLA = 5.0, A_STALL = 0.25;
const CLREF = CL0 + CLA * A0;
const CD0 = 0.05, KI = 0.07;
const THRUST = 0.55 * G, V_PROP = 2.1;
const M = { elev: 18, alpha: 95, dq: 9, ail: 26, dp: 10, dihedral: 18, level: 10, rud: 12, beta: 45, dr: 6 };   // angular accelerations (rad/s²) and dampings (1/s)
const INV_I = { x: 1 / 0.0036, y: 1 / 0.006, z: 1 / 0.004 };   // contact torques → angular acceleration (pitch, yaw, roll axes)
const WHEEL = { k: 240, c: 11, roll: 0.03, brake: 0.7, side: 0.9 };
const CRASH_VS = 1.1;             // m/s down at touchdown: too hard
const RUNWAY = { len: 1.0, wide: 0.17 };
const SPAWN_X = -0.28;
const SEND_MS = 66;
const HAND = {
  open: 0.15,                     // m: mean fingertip → wrist above this = a flat hand
  fist: 0.125,
  engageMs: 3000, loseMs: 450,   // taking the plane: looking at it, the flat hand held still this long
  respawnS: 0.4,                  // after a crash: a flat hand while looking at the runway this long brings it back
  neutralPitch: 0.25,             // rad: "level" is where the hand was when it took the plane, within this (room to dive)
  lookDeg: 30,                    // "looking at it": the plane within this of where your head points
  stillM: 0.03, stillRad: 0.2,    // held still: the wrist within 3 cm, pitch / roll within ~11° (else the count restarts)
  dead: 0.06, full: 0.5,          // rad: no input within dead, full deflection at full
  yawFull: 0.55,
  thumbFull: 0.42, thumbOff: 1.05,   // rad between thumb and fingers: full throttle / off
};

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const pl = (ctx.plane = {
      others: new Map(), acc: 0, sentAt: 0, input: { elev: 0, ail: 0, rud: 0, thr: 0, brake: 1 }, hand: { on: false, since: 0, lost: 0, side: null },
      thrSmooth: 0, auto: false, fx: [], status: '', crashT: 0, wheelDist: 0, lastGround: true, airborneAt: 0, clock: 0,
    });
    pl.me = ctx.player();
    pl.scheme = loadScheme(pl.me.id);
    pl.group = new THREE.Group();
    ctx.spawn(pl.group);
    buildRunway(ctx);
    pl.plane = buildPlane(THREE, { length: LEN, scheme: SCHEMES[pl.scheme] });
    pl.group.add(pl.plane.group);
    pl.shadow = makeShadow(pl.plane.dims.span);
    pl.group.add(pl.shadow);
    pl.floorGuess = floorGuess(ctx);
    refreshSurfaces(ctx);
    reset(ctx);
    pl.chan = ctx.channel('plane', (m) => onMsg(ctx, m));
    pl.chan.send({ k: 'hello', id: pl.me.id });
    buildHud(ctx);
    setActions(ctx);
    pl.audio = engineSound(ctx);
    window.__plane = {   // test hook
      ctx, state: () => snapshot(pl), step: (n) => { for (let i = 0; i < n; i++) tick(ctx, STEP); },
      reset: () => reset(ctx), autopilot: (on) => { pl.auto = on; }, set: (o) => Object.assign(pl.body, o),
      input: () => ({ ...pl.input }), hand: () => ({ ...pl.hand, neutral: pl.hand.neutral && { ...pl.hand.neutral } }),
      groundAt: (x, y, z) => groundAt(ctx, new THREE.Vector3(x, y, z)), override: (i) => { pl.override = i; },
      surfaces: () => refreshSurfaces(ctx), freeze: (on) => { pl.frozen = on; },
    };
  },

  frame(ctx, dt) {
    const pl = ctx.plane;
    if (!pl) return;
    const now = performance.now();
    if (now - (pl.surfAt ?? 0) > 2000) refreshSurfaces(ctx);
    pl.acc = Math.min(pl.acc + dt, 0.1);
    while (pl.acc >= STEP) { tick(ctx, STEP); pl.acc -= STEP; }
    drawPlane(ctx, dt);
    drawOthers(ctx, dt);
    drawFx(ctx, dt);
    drawHud(ctx);
    pl.windsock && swayWindsock(pl, now);
    pl.audio?.tick(ctx, pl);
    if (now - pl.sentAt > SEND_MS) { pl.sentAt = now; send(ctx); }
  },

  // Phone: a tap on the runway starts / stops the autopilot circuit.
  press(ctx, e) {
    const pl = ctx.plane;
    if (!pl || e.phase !== 'down') return false;
    pl.audio?.unlock();
    if (ctx.device !== 'phone') return false;
    pl.auto = !pl.auto;
    if (pl.auto && !pl.body.ground) reset(ctx);
    return true;
  },
  select(ctx) { ctx.plane?.audio?.unlock(); },

  revealMesh(ctx) { return ctx.plane?.runwayGhost?.() ?? null; },

  async stop(ctx) {
    const pl = ctx.plane;
    if (!pl) return;
    pl.chan?.send({ k: 'bye', id: pl.me.id });
    pl.audio?.close();
    pl.plane.dispose();
    for (const o of pl.others.values()) o.model.dispose();
    if (window.__plane?.ctx === ctx) delete window.__plane;
  },
};

function setActions(ctx) {
  const pl = ctx.plane;
  ctx.actions([
    { label: pl.auto ? '✋ Autopilot off' : '🛫 Autopilot circuit', run: () => { pl.auto = !pl.auto; if (pl.auto && !pl.body.ground) reset(ctx); setActions(ctx); } },
    { label: '↺ Back to the runway', run: () => reset(ctx) },
    { label: `🎨 Paint: ${SCHEMES[(pl.scheme + 1) % SCHEMES.length].name}`, run: () => repaint(ctx, (pl.scheme + 1) % SCHEMES.length) },
  ]);
}

// ---- paint (per player, remembered on this device) -------------------------------------------------

const SCHEME_KEY = 'stratum.plane.scheme';
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function loadScheme(id) {
  try { const v = localStorage.getItem(SCHEME_KEY); if (v != null && SCHEMES[+v]) return +v; } catch {}
  return hash(id) % SCHEMES.length;
}
function repaint(ctx, i) {
  const pl = ctx.plane;
  pl.scheme = i;
  try { localStorage.setItem(SCHEME_KEY, String(i)); } catch {}
  const old = pl.plane;
  pl.plane = buildPlane(THREE, { length: LEN, scheme: SCHEMES[i] });
  pl.group.add(pl.plane.group);
  old.group.removeFromParent();
  old.dispose();
  setActions(ctx);
}

// ---- the world it flies in ------------------------------------------------------------------------

// Level surfaces are ground (whichever way the map's plane faces: some come
// facing down), except ceilings; everything else in the room map is something to hit.
function refreshSurfaces(ctx) {
  const pl = ctx.plane, up = new THREE.Vector3();
  pl.surfAt = performance.now();
  pl.grounds = []; pl.walls = [];
  for (const s of ctx.surfaces?.() ?? []) {
    if (!s.polygon?.length) continue;
    up.setFromMatrixColumn(s.matrix, 1).normalize();
    const inv = s.matrix.clone().invert();
    const level = Math.abs(up.y) > 0.9;
    const entry = { kind: s.kind, poly: s.polygon, inv, flip: level && up.y < 0 ? -1 : 1, y: new THREE.Vector3().setFromMatrixPosition(s.matrix).y };
    if (level && s.kind !== 'ceiling') pl.grounds.push(entry);
    else pl.walls.push(entry);
  }
  return { grounds: pl.grounds.length, walls: pl.walls.length };
}

// Without a room map the floor is a guess: eyes ≥ 1.3 m over the runway = it's on
// the floor; lower = it's on a table, and the floor is about 1.6 m under your eyes.
function floorGuess(ctx) {
  const h = ctx.viewer()?.position.y;
  return h == null || h >= 1.3 ? 0 : Math.min(-0.4, h - 1.6);
}

const onRunway = (p, m = 0.1) => Math.abs(p.x) <= RUNWAY.len / 2 + m && Math.abs(p.z) <= RUNWAY.wide / 2 + 0.25;   // (the apron: the wings overhang)

// The highest ground under p that isn't above it.
function groundAt(ctx, p) {
  const pl = ctx.plane, lp = new THREE.Vector3();
  let best = onRunway(p) && p.y > -0.03 ? 0 : -Infinity;
  for (const s of pl.grounds) {
    lp.copy(p).applyMatrix4(s.inv);
    const above = lp.y * s.flip;   // (height above it, world up)
    if (above > -0.03 && pointIn(s.poly, lp.x, lp.z)) best = Math.max(best, p.y - above);
  }
  if (best === -Infinity) best = pl.grounds.some((s) => s.kind === 'floor') ? -Infinity : pl.floorGuess;
  return best;
}

// Did p go into a wall (or under a shelf…)? → the surface's kind, or null.
function hitWall(ctx, p) {
  const lp = new THREE.Vector3();
  for (const s of ctx.plane.walls) {
    lp.copy(p).applyMatrix4(s.inv);
    if (lp.y < 0.004 && lp.y > -0.08 && pointIn(s.poly, lp.x, lp.z)) return s.kind;
  }
  return null;
}

// ---- the body ------------------------------------------------------------------------------------------

function restPitch(dims) {
  const m = dims.mains[0], t = dims.tail;
  return Math.atan2(t.y - m.y, t.z - m.z);   // nose up, mains and tailwheel all down
}

function reset(ctx) {
  const pl = ctx.plane, d = pl.plane.dims;
  const slot = slotOf(ctx), th = restPitch(d);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(th, -Math.PI / 2, 0, 'YXZ'));
  const lowest = d.mains[0].clone().applyQuaternion(q).y;
  pl.body = {
    p: new THREE.Vector3(SPAWN_X + slot.x, -lowest + 0.002, slot.z), v: new THREE.Vector3(), q, w: new THREE.Vector3(),
    ground: true, contacts: 3, speed: 0,
  };
  pl.restH = pl.body.p.y;
  pl.crashT = 0;
  pl.down = false;
  pl.thrSmooth = 0;
  Object.assign(pl.input, { thr: 0, brake: 1, elev: 0, ail: 0, rud: 0 });   // (a respawn never flies off on the throttle it crashed with)
  pl.thrLever = 0;
  pl.lastGround = true;
  pl.why = null;
  pl.plane.group.visible = true;
}

// Where my plane waits on the runway: the others' planes take turns beside it.
function slotOf(ctx) {
  const pl = ctx.plane, ids = [pl.me.id, ...pl.others.keys()].sort(), i = Math.max(0, ids.indexOf(pl.me.id));
  return { x: Math.floor(i / 2) * 0.16, z: i % 2 ? -0.045 : i ? 0.045 : 0 };
}

const v3 = () => new THREE.Vector3();
const wrecked = (pl) => pl.crashT > 0 || !!pl.down;   // tumbling, or waiting to be brought back

// One step of the simulation (its own clock, so tests can run it fast).
function tick(ctx, dt) {
  const pl = ctx.plane;
  pl.clock += dt;
  readInput(ctx, dt);
  if (pl.frozen) return;   // (tests of the controls alone)
  if (wrecked(pl)) crashing(ctx, dt); else physics(ctx, dt);
}

function physics(ctx, dt) {
  const pl = ctx.plane, b = pl.body, d = pl.plane.dims, inp = pl.input;
  if (wrecked(pl)) return;
  const qi = b.q.clone().invert();
  const fwd = v3().set(0, 0, -1).applyQuaternion(b.q), up = v3().set(0, 1, 0).applyQuaternion(b.q), right = v3().set(1, 0, 0).applyQuaternion(b.q);
  const vb = b.v.clone().applyQuaternion(qi);
  const V = b.v.length();
  const F = v3().set(0, -G, 0);
  const acc = v3();   // angular acceleration, body axes (x pitch up, y yaw left, z roll left)
  // Air.
  const alpha = V > 0.05 ? Math.atan2(-vb.y, -vb.z) : 0, beta = V > 0.05 ? Math.atan2(vb.x, -vb.z) : 0;
  const qd = G * (V / VREF) ** 2, eff = Math.min(1.6, (V / VREF) ** 2);
  let cl = Math.abs(alpha) < A_STALL ? CL0 + CLA * alpha : Math.sign(alpha) * (CL0 + CLA * A_STALL) * 0.5;
  if (Math.abs(alpha) > Math.PI / 2) cl = 0;
  if (V > 0.02) {
    const vh = b.v.clone().divideScalar(V);
    const liftDir = up.clone().addScaledVector(vh, -up.dot(vh));
    if (liftDir.lengthSq() > 1e-6) F.addScaledVector(liftDir.normalize(), (qd * cl) / CLREF);
    F.addScaledVector(vh, (-qd * (CD0 + KI * cl * cl)) / CLREF);
    const sideDir = right.clone().addScaledVector(vh, -right.dot(vh));
    if (sideDir.lengthSq() > 1e-6) F.addScaledVector(sideDir.normalize(), (-qd * 1.4 * Math.sin(beta)) / CLREF);
  }
  const vFwd = Math.max(0, -vb.z);
  F.addScaledVector(fwd, inp.thr * THRUST * Math.max(0, 1 - vFwd / V_PROP));
  // Moments.
  let elev = inp.elev;
  if (pl.assist && alpha > A_STALL * 0.8 && elev > 0) elev *= Math.max(0, 1 - (alpha - A_STALL * 0.8) / (A_STALL * 0.2));   // no stalls
  const prop = 0.25 * inp.thr;   // propwash: the tail works a little even when slow
  const effT = eff + prop;
  acc.x += effT * M.elev * elev - eff * M.alpha * (alpha - A0) - M.dq * b.w.x;
  acc.y += -effT * M.rud * inp.rud - eff * M.beta * beta - M.dr * b.w.y;
  const bank = Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1));   // right wing down = +
  acc.z += -eff * M.ail * inp.ail + eff * M.dihedral * beta - M.dp * b.w.z + (pl.levelWings ? eff * M.level * bank : 0);
  // Wheels.
  const lever = v3(), wWorld = b.w.clone().applyQuaternion(b.q), torque = v3();
  let contacts = 0, vsDown = 0;
  const wheels = [[d.mains[0], true], [d.mains[1], true], [d.tail, false]];
  for (const [rb, main] of wheels) {
    lever.copy(rb).applyQuaternion(b.q);
    const P = lever.clone().add(b.p), h = groundAt(ctx, P), pen = h - P.y;
    if (!(pen > 0)) continue;
    contacts++;
    const vp = b.v.clone().add(wWorld.clone().cross(lever));
    vsDown = Math.max(vsDown, -vp.y);
    const N = Math.max(0, WHEEL.k * pen - WHEEL.c * vp.y);
    const f = v3().set(0, N, 0);
    // Rolling direction: the plane's heading (the tailwheel turned with the rudder).
    let roll = v3().set(fwd.x, 0, fwd.z);
    if (roll.lengthSq() < 1e-6) roll.set(0, 0, -1);
    roll.normalize();
    if (!main) roll.applyAxisAngle(new THREE.Vector3(0, 1, 0), -inp.rud * 0.5);
    const side = v3().set(-roll.z, 0, roll.x);
    const vl = vp.dot(roll), vs = vp.dot(side);
    const mu = WHEEL.roll + (main ? inp.brake * WHEEL.brake : 0);
    f.addScaledVector(roll, -THREE.MathUtils.clamp(vl * 40, -mu * N, mu * N));
    f.addScaledVector(side, -THREE.MathUtils.clamp(vs * 60, -WHEEL.side * N, WHEEL.side * N));
    F.add(f);
    torque.add(lever.clone().cross(f));
  }
  const tb = torque.applyQuaternion(qi);
  acc.x += tb.x * INV_I.x; acc.y += tb.y * INV_I.y; acc.z += tb.z * INV_I.z;
  // Integrate (semi-implicit).
  b.v.addScaledVector(F, dt);
  b.p.addScaledVector(b.v, dt);
  b.w.addScaledVector(acc, dt);
  const wl = b.w.length();
  if (wl > 1e-9) b.q.multiply(new THREE.Quaternion().setFromAxisAngle(b.w.clone().divideScalar(wl), wl * dt)).normalize();
  b.speed = V;
  b.alpha = alpha;
  const was = b.ground;
  b.ground = contacts > 0;
  b.contacts = contacts;
  if (b.ground) pl.wheelDist += vFwd * dt;
  // Touchdown / takeoff, crashes.
  if (b.ground && !was && pl.clock - pl.airborneAt > 0.3) {
    ctx.telemetry?.('plane landing', { vs: +vsDown.toFixed(2), speed: +V.toFixed(2) });
    if (vsDown > CRASH_VS) return crash(ctx, 'landed too hard');
  }
  if (!b.ground && was) pl.airborneAt = pl.clock;
  const P = v3();
  for (const rb of d.hard) {
    P.copy(rb).applyQuaternion(b.q).add(b.p);
    if (groundAt(ctx, P) - P.y > 0.004) return crash(ctx, 'hit the ground');
    const wall = hitWall(ctx, P);
    if (wall) return crash(ctx, `hit the ${wall}`);
  }
  if (b.p.length() > 12 || b.p.y < pl.floorGuess - 3) return crash(ctx, 'lost');
}

function crash(ctx, why) {
  const pl = ctx.plane, b = pl.body;
  pl.crashT = 1.8;
  pl.why = why;
  Object.assign(pl.hand, { on: false, side: null, since: 0, lost: 0, ref: null, left: null });   // the hand lets go of the wreck
  pl.input.thr = 0;
  b.spin = new THREE.Vector3((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 12);
  for (let i = 0; i < 10; i++) puff(ctx, b.p, 0.04 + Math.random() * 0.05, i < 3 ? 0xffa94d : 0x868e96);
  ctx.telemetry?.('plane crash', { why, speed: +b.v.length().toFixed(2), y: +b.p.y.toFixed(2) });
  pl.chan?.send({ k: 'crash', id: pl.me.id, p: b.p.toArray().map(r3) });
  pl.audio?.bonk();
}

// After a crash: tumble to the ground; then it waits there until you want it back
// (a flat hand while you look at the runway; without tracked hands: by itself).
function crashing(ctx, dt) {
  const pl = ctx.plane, b = pl.body;
  pl.crashT = Math.max(0, pl.crashT - dt);
  const g = groundAt(ctx, b.p);
  if (b.p.y > g + 0.03) {
    b.v.y -= G * dt;
    b.v.multiplyScalar(0.97);
    b.p.addScaledVector(b.v, dt);
    b.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt))).normalize();
  } else b.v.set(0, 0, 0);
  if (Math.random() < dt * (pl.crashT > 0 ? 8 : 1.5)) puff(ctx, b.p, 0.03, 0x495057);
  if (pl.crashT > 0) return;
  pl.down = true;
  if (respawnWanted(ctx, dt)) { reset(ctx); ctx.telemetry?.('plane respawn', {}); }
}

// Back to the runway? Quest: on purpose, while you look at the runway: a hand
// held flat for a moment, or a controller's trigger (hands out of view mean
// nothing). Phone: after the tumble, by itself.
function respawnWanted(ctx, dt) {
  const pl = ctx.plane, hands = ctx.hands?.(), view = ctx.viewer();
  if (ctx.device !== 'quest') return true;
  const ctl = ctx.controls?.();
  const trigger = !!ctl && [ctl.left, ctl.right].some((c) => c && !c.hand && (c.trigger ?? 0) > 0.5);
  const flat = trigger || ['right', 'left'].some((side) => {
    const h = hands?.[side];
    if (!h || !view) return false;
    const a = handAngles(h, side, view);
    return openness(h) > HAND.open && a.up.y > 0.35 && h.joints[0].distanceTo(view.position) > 0.18;
  });
  const look = view && v3().set(0, 0, -1).applyQuaternion(view.quaternion).angleTo(v3().subVectors(v3(), view.position)) < THREE.MathUtils.degToRad(HAND.lookDeg);   // (the runway: the instance's origin)
  pl.respawnHold = flat && look ? (pl.respawnHold ?? 0) + dt : 0;
  return pl.respawnHold > HAND.respawnS;
}

const r3 = (x) => Math.round(x * 1000) / 1000;
function snapshot(pl) {
  const b = pl.body, e = new THREE.Euler().setFromQuaternion(b.q, 'YXZ');
  return { p: b.p.toArray(), v: b.v.toArray(), speed: b.speed, ground: b.ground, contacts: b.contacts, pitch: e.x, yaw: e.y, roll: e.z,
    alpha: b.alpha ?? 0, crashed: wrecked(pl), down: !!pl.down, why: pl.why, input: { ...pl.input }, auto: pl.auto, hand: pl.hand.on };
}

// ---- input ------------------------------------------------------------------------------------------------

function readInput(ctx, dt) {
  const pl = ctx.plane, inp = pl.input, assist = ctx.settings.get('assist') !== false;
  pl.assist = assist;
  if (wrecked(pl)) { handControl(ctx); Object.assign(inp, { thr: 0, brake: 1, elev: 0, ail: 0, rud: 0 }); return; }   // (a wreck takes no input)
  pl.levelWings = false;
  let src = null;
  const hand = handControl(ctx);
  if (pl.override) src = { ...pl.override };
  else if (hand) {
    src = hand;
    pl.auto = false;
    // Easy flying: the hand's roll is the bank to hold (the plane leans as far as your hand); else it's the ailerons.
    if (assist && !pl.body.ground) src.ail = bankHold(pl.body, hand.bank);
  }
  else {
    const ctl = ctx.controls?.();
    const controllers = !!ctl && (ctl.left || ctl.right) && !ctl.left?.hand && !ctl.right?.hand;
    if (controllers) {
      const l = ctl.left, r = ctl.right, dz = (x) => (Math.abs(x) < 0.08 ? 0 : x);
      const sticks = Math.abs(dz(r?.stick?.[0] ?? 0)) + Math.abs(dz(r?.stick?.[1] ?? 0)) + Math.abs(dz(l?.stick?.[0] ?? 0)) + (r?.trigger ?? 0) + (l?.trigger ?? 0);
      if (sticks > 0.05) pl.auto = false;
      pl.thrLever = THREE.MathUtils.clamp((pl.thrLever ?? 0) + (r?.trigger ?? 0) * dt * 0.9 - (l?.trigger ?? 0) * dt * 0.9, 0, 1);
      if (!pl.auto) src = { elev: dz(r?.stick?.[1] ?? 0), ail: dz(r?.stick?.[0] ?? 0), rud: dz(l?.stick?.[0] ?? 0), thr: pl.thrLever, brake: (l?.trigger ?? 0) > 0.3 ? 1 : 0 };
    }
  }
  if (!src && pl.auto) src = autopilot(ctx);
  if (!src) {   // hands off: keeps the throttle; easy flying levels the wings and holds the height
    src = { elev: 0, ail: 0, rud: 0, thr: inp.thr, brake: inp.thr < 0.02 ? 1 : 0 };
    if (assist && !pl.body.ground) { src = { ...src, ...holdLevel(ctx) }; pl.levelWings = true; }
  } else pl.holdY = null;
  const k = 1 - Math.exp(-dt / 0.08);
  for (const key of ['elev', 'ail', 'rud']) inp[key] += (THREE.MathUtils.clamp(src[key] ?? 0, -1, 1) - inp[key]) * k;
  inp.thr += (THREE.MathUtils.clamp(src.thr ?? 0, 0, 1) - inp.thr) * (1 - Math.exp(-dt / 0.15));
  inp.brake = src.brake ?? 0;
  if (inp.thr < 0.004) inp.thr = 0;
}

// Hands off with easy flying: wings level, nose to hold the height it had.
function holdLevel(ctx) {
  const pl = ctx.plane, b = pl.body;
  if (pl.holdY == null) pl.holdY = b.p.y;
  return { elev: pitchFor(b, THREE.MathUtils.clamp((pl.holdY - b.p.y) * 1.2, -0.2, 0.2)) };   // (the wings: M.level in physics)
}

// Ailerons to hold a bank (rad, right +).
function bankHold(b, want) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(b.q), bank = Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1));
  return THREE.MathUtils.clamp((want - bank) * 2.5 + b.w.z * 0.35, -1, 1);
}

// Elevator to fly a climb angle γ (rad): nose at γ + trim, damped, a little more in a bank.
function pitchFor(b, gamma) {
  const e = new THREE.Euler().setFromQuaternion(b.q, 'YXZ');
  return THREE.MathUtils.clamp((gamma + A0 - e.x) * 2.5 - b.w.x * 0.25 + Math.abs(e.z) * 0.35, -0.8, 0.8);
}

const handFrame = (h, side) => {
  const j = h.joints, f = j[11].clone().sub(j[0]).normalize();
  let r = j[6].clone().sub(j[21]);   // little → index knuckle: toward the thumb side
  if (side === 'right') r.negate();  // (palm down, the right hand's thumb is on its left)
  r.addScaledVector(f, -r.dot(f)).normalize();
  const up = r.clone().cross(f);      // out of the back of the hand
  return { f, r, up };
};
const openness = (h) => [9, 14, 19].reduce((s, i) => s + h.joints[i].distanceTo(h.joints[0]), 0) / 3 / (h.scale ?? 1);

// The hand's attitude: pitch (fingers up +), roll (right side down +), heading (right +, from where you look), thumb angle.
function handAngles(h, side, view) {
  const { f, r, up } = handFrame(h, side);
  const pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
  const roll = Math.asin(THREE.MathUtils.clamp(-r.y, -1, 1));
  const look = v3().set(0, 0, -1).applyQuaternion(view.quaternion);
  const head = Math.atan2(look.x, -look.z), heading = Math.atan2(f.x, -f.z);
  let yaw = heading - head;
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const j = h.joints, thumb = j[4].clone().sub(j[2]);
  thumb.addScaledVector(up, -thumb.dot(up));
  const thumbA = thumb.lengthSq() > 1e-8 ? thumb.normalize().angleTo(f) : 0;
  return { pitch, roll, yaw, thumbA, up, f };
}

// A hand out flat (open, palm down, in front of you), while you look at the
// plane, held still for 3 s takes it (no take-off by a hand that just passes
// by); its attitude then is neutral. Returns the controls, or null.
function handControl(ctx) {
  const pl = ctx.plane, H = pl.hand, hands = ctx.hands?.(), view = ctx.viewer(), now = pl.clock * 1000;
  if (wrecked(pl)) { H.since = 0; H.left = null; H.ref = null; return null; }   // (not the wreck: it comes back first)
  const want = ctx.settings.get('hand') ?? 'either';
  const sides = want === 'either' ? (H.side ? [H.side, H.side === 'right' ? 'left' : 'right'] : ['right', 'left']) : [want];
  let use = null;
  for (const side of sides) {
    const h = hands?.[side];
    if (!h || !view) continue;
    const a = handAngles(h, side, view), open = openness(h), out = h.joints[0].distanceTo(view.position);
    const flat = open > HAND.open && a.up.y > 0.35 && out > 0.18;
    if (H.on && side === H.side) {
      const fine = open > HAND.fist && a.up.y > 0.1;
      if (fine) { H.lost = 0; use = { side, a }; } else if (!H.lost) H.lost = now;
      break;
    }
    if (!H.on && flat) { use = { side, a }; break; }
  }
  if (H.on) {
    if (!use && !H.lost) H.lost = now;
    if (H.lost && now - H.lost > HAND.loseMs) { H.on = false; H.side = null; H.since = 0; H.lost = 0; ctx.telemetry?.('plane hand off', {}); }
  } else if (use) {
    const wrist = hands[use.side].joints[0], a = use.a;
    H.looking = lookingAt(ctx, view);
    const moved = H.ref && (wrist.distanceTo(H.ref.p) > HAND.stillM || Math.abs(a.pitch - H.ref.pitch) > HAND.stillRad || Math.abs(a.roll - H.ref.roll) > HAND.stillRad);
    if (!H.looking || !H.since || H.cand !== use.side || moved) {   // (re)start the count from here
      H.since = H.looking ? now : 0; H.cand = use.side;
      H.ref = { p: wrist.clone(), pitch: a.pitch, roll: a.roll };
      if (moved) H.restarts = (H.restarts ?? 0) + 1;
    }
    H.left = H.since ? Math.max(0, HAND.engageMs - (now - H.since)) : null;
    if (H.since && now - H.since > HAND.engageMs) {
      const a = use.a;
      H.on = true; H.side = use.side; H.lost = 0;
      H.neutral = { pitch: THREE.MathUtils.clamp(a.pitch, -HAND.neutralPitch, HAND.neutralPitch), roll: THREE.MathUtils.clamp(a.roll, -0.35, 0.35), yaw: 0 };
      ctx.telemetry?.('plane hand on', { side: use.side, pitch: +a.pitch.toFixed(2), roll: +a.roll.toFixed(2), yaw: +a.yaw.toFixed(2), thumb: +a.thumbA.toFixed(2), restarts: H.restarts ?? 0 });
      H.restarts = 0; H.left = null; H.ref = null;
    }
  } else { H.since = 0; H.left = null; H.ref = null; H.looking = false; }
  if (!H.on || !use) return null;
  const n = H.neutral, a = use.a;
  const shape = (x, full) => { const s = Math.sign(x), m = Math.max(0, Math.abs(x) - HAND.dead) / (full - HAND.dead); return s * Math.min(1, m) ** 1.4; };
  const thr = THREE.MathUtils.clamp((HAND.thumbOff - a.thumbA) / (HAND.thumbOff - HAND.thumbFull), 0, 1);
  H.thumb = a.thumbA;
  const dRoll = a.roll - n.roll, bank = Math.abs(dRoll) < HAND.dead ? 0 : THREE.MathUtils.clamp((dRoll - Math.sign(dRoll) * HAND.dead) * 1.5, -0.8, 0.8);
  // Three controls: throttle (thumb), elevator (tilt), roll (bank; on the ground it steers the tailwheel). No rudder.
  const ail = shape(dRoll, HAND.full);
  return { elev: shape(a.pitch - n.pitch, HAND.full), ail, bank, rud: pl.body.ground ? -ail * 0.8 : 0, thr, brake: thr < 0.05 ? 1 : 0 };
}

// Is the plane within HAND.lookDeg of where the head points? (Instance frame.)
function lookingAt(ctx, view) {
  const pl = ctx.plane, at = pl.body.p;
  const to = v3().subVectors(at, view.position);
  if (to.lengthSq() < 1e-6) return true;
  const look = v3().set(0, 0, -1).applyQuaternion(view.quaternion);
  return look.angleTo(to) < THREE.MathUtils.degToRad(HAND.lookDeg);
}

// A circuit around the runway: take off, climb to ~0.7 m, a left-hand circle
// beside the runway, round and round. (Phone, demo, tests.)
function autopilot(ctx) {
  const pl = ctx.plane, b = pl.body, cruise = 0.7;
  if (b.ground) return { thr: 1, elev: b.speed > VREF * 0.95 ? 0.5 : -0.1, ail: 0, rud: 0, brake: 0 };
  const up = new THREE.Vector3(0, 1, 0), R = 0.9, c = new THREE.Vector3(0.2, 0, -R);
  const out = b.p.clone().sub(c).setY(0), dist = out.length() || 1e-3;
  out.divideScalar(dist);
  const tangent = up.clone().cross(out);   // the centre on the left
  const d = tangent.addScaledVector(out, -THREE.MathUtils.clamp((dist - R) * 1.5, -0.8, 0.8)).normalize();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(b.q).setY(0).normalize();
  const err = Math.atan2(f.clone().cross(d).y, f.dot(d));   // + = turn left
  const bankWant = THREE.MathUtils.clamp(-0.22 - err * 1.0, -0.55, 0.55);
  return {
    thr: THREE.MathUtils.clamp(0.55 + (cruise - b.p.y) * 0.8 + (VREF - b.speed) * 1.5, 0.15, 1),
    elev: pitchFor(b, THREE.MathUtils.clamp((cruise - b.p.y) * 0.8, -0.15, 0.22)),
    ail: bankHold(b, bankWant),
    rud: 0, brake: 0,
  };
}

// ---- drawing ------------------------------------------------------------------------------------------------

function drawPlane(ctx, dt) {
  const pl = ctx.plane, b = pl.body, m = pl.plane;
  m.group.position.copy(b.p);
  m.group.quaternion.copy(b.q);
  m.set({ ail: pl.input.ail, elev: pl.input.elev, rud: pl.input.rud, rpm: wrecked(pl) ? 0 : pl.input.thr > 0 ? 0.12 + pl.input.thr * 0.88 : 0, wheel: pl.wheelDist, dt });
  placeShadow(ctx, pl.shadow, b.p);
  ctx.status(pl.down ? '💥 Look at the runway, hand flat to bring it back' : pl.crashT > 0 ? `💥 ${pl.why}` : pl.hand.on ? `✈️ ${pl.hand.side} hand · ${Math.round(pl.input.thr * 100)} %` : pl.auto ? '✈️ Autopilot' : `✈️ ${handHint(pl.hand)}`);
}

// Before the hand has the plane: what it's waiting for.
function handHint(H) {
  if (H.left != null) return `Hold still… ${Math.ceil(H.left / 1000)}`;
  if (H.cand && !H.looking && H.ref) return 'Look at the plane';
  return 'Look at it, hold a hand out flat';
}

function makeShadow(span) {
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.9, span * 0.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.renderOrder = 1;
  m.raycast = () => {};
  return m;
}

// The shadow on whatever is under the plane, fainter and wider the higher it flies.
function placeShadow(ctx, sh, p) {
  const g = groundAt(ctx, p);
  if (!Number.isFinite(g)) { sh.visible = false; return; }
  const h = Math.max(0, p.y - g);
  sh.visible = h < 3;
  sh.position.set(p.x, g + 0.002, p.z);
  sh.scale.setScalar(1 + h * 0.6);
  sh.material.opacity = Math.max(0.15, 1 - h * 0.6);
}

function puff(ctx, at, size, color) {
  const pl = ctx.plane;
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
  m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.06, Math.random() * 0.04, (Math.random() - 0.5) * 0.06));
  m.raycast = () => {};
  pl.group.add(m);
  pl.fx.push({ m, age: 0, life: 0.6 + Math.random() * 0.5, size, rise: 0.05 + Math.random() * 0.1 });
}

function drawFx(ctx, dt) {
  const pl = ctx.plane;
  pl.fx = pl.fx.filter((f) => {
    f.age += dt;
    const k = f.age / f.life;
    f.m.scale.setScalar(f.size * (0.4 + k));
    f.m.position.y += f.rise * dt;
    f.m.material.opacity = 0.7 * (1 - k);
    if (k >= 1) { f.m.removeFromParent(); f.m.geometry.dispose(); f.m.material.dispose(); }
    return k < 1;
  });
}

// ---- the runway --------------------------------------------------------------------------------------------

function buildRunway(ctx) {
  const pl = ctx.plane, g = new THREE.Group();
  const W = 2048, H = Math.round((2048 * RUNWAY.wide) / RUNWAY.len);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d');
  x.fillStyle = '#3b3d42'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  x.fillStyle = '#f1f3f5';
  x.fillRect(0, H * 0.06, W, H * 0.025); x.fillRect(0, H * 0.915, W, H * 0.025);   // edge lines
  for (let i = 0; i < 14; i++) x.fillRect(W * 0.2 + i * W * 0.045, H * 0.485, W * 0.025, H * 0.03);   // centreline
  for (const end of [0, 1]) {   // threshold bars, numbers, touchdown marks
    x.save();
    if (end) { x.translate(W, H); x.rotate(Math.PI); }
    for (let i = 0; i < 6; i++) { x.fillRect(W * 0.015, H * (0.16 + i * 0.12), W * 0.05, H * 0.07); }
    x.save(); x.translate(W * 0.11, H / 2); x.rotate(-Math.PI / 2);   // (read from the approach)
    x.font = `800 ${H * 0.4}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(end ? '27' : '09', 0, 0); x.restore();
    for (const s of [0.28, 0.72]) x.fillRect(W * 0.2, H * s - H * 0.04, W * 0.06, H * 0.08);
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY.len, 0.004, RUNWAY.wide), [
    new THREE.MeshStandardMaterial({ color: 0x2b2d31 }), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }),
    new THREE.MeshStandardMaterial({ color: 0x2b2d31 }), new THREE.MeshStandardMaterial({ color: 0x2b2d31 }),
  ]);
  slab.position.y = 0.002 - 0.004;   // its top is the ground (y = 0)
  slab.userData.handle = true;
  g.add(slab);
  // Edge lights.
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0028, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff3bf, emissive: 0xffe066, emissiveIntensity: 1.4 }), 22);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 11; i++) for (const s of [-1, 1]) lights.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4.makeTranslation(-RUNWAY.len / 2 + 0.02 + (i * (RUNWAY.len - 0.04)) / 10, 0.003, s * (RUNWAY.wide / 2 + 0.008)));
  lights.raycast = () => {};
  g.add(lights);
  // Windsock on a pole beside the runway.
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xdee2e6, metalness: 0.6, roughness: 0.3 }));
  pole.position.set(RUNWAY.len * 0.3, 0.06, -RUNWAY.wide / 2 - 0.07);
  g.add(pole);
  const sock = new THREE.Group();
  sock.position.set(RUNWAY.len * 0.3, 0.115, -RUNWAY.wide / 2 - 0.07);
  const stripes = Object.assign(document.createElement('canvas'), { width: 128, height: 16 }), sx = stripes.getContext('2d');
  for (let i = 0; i < 5; i++) { sx.fillStyle = i % 2 ? '#f8f9fa' : '#fd7e14'; sx.fillRect(i * 25.6, 0, 25.6, 16); }
  const stex = new THREE.CanvasTexture(stripes);
  stex.colorSpace = THREE.SRGBColorSpace;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.009, 0.05, 14, 1, true).rotateZ(Math.PI / 2).translate(0.025, 0, 0), new THREE.MeshStandardMaterial({ map: stex, side: THREE.DoubleSide, roughness: 0.8 }));
  // (the cylinder's UV runs around it; turn the stripes to run along it)
  stex.rotation = Math.PI / 2; stex.center.set(0.5, 0.5);
  sock.add(cone);
  g.add(sock);
  pl.windsock = sock;
  g.traverse((n) => { if (n !== slab) n.raycast = () => {}; });
  pl.group.add(g);
  pl.runway = g;
  pl.runwayGhost = () => new THREE.Mesh(new THREE.BoxGeometry(RUNWAY.len, 0.01, RUNWAY.wide));
}

function swayWindsock(pl, now) {
  pl.windsock.rotation.y = 0.5 + Math.sin(now / 1700) * 0.25 + Math.sin(now / 430) * 0.05;
  pl.windsock.rotation.z = -0.15 + Math.sin(now / 900) * 0.08;
}

// ---- HUD -----------------------------------------------------------------------------------------------------

function buildHud(ctx) {
  const pl = ctx.plane;
  const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 200 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.0625), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  mesh.position.set(RUNWAY.len / 2 + 0.08, 0.09, 0);
  mesh.raycast = () => {};
  pl.group.add(mesh);
  pl.hud = { canvas, tex, mesh };
}

function drawHud(ctx) {
  const pl = ctx.plane, h = pl.hud, v = ctx.viewer();
  if (!h) return;
  if (v) h.mesh.rotation.y = Math.atan2(v.position.x - h.mesh.position.x, v.position.z - h.mesh.position.z);
  const b = pl.body, alt = Math.max(0, b.p.y - Math.max(groundAt(ctx, b.p), -5) - pl.restH);   // (wheels above the ground)
  const line2 = pl.down ? 'Look at the runway, hand flat: back' : pl.crashT > 0 ? `💥 ${pl.why}` : pl.hand.on ? (b.ground && pl.input.thr < 0.05 ? 'Thumb in for power' : 'Flying') : pl.auto ? 'Autopilot circuit' : handHint(pl.hand);
  const sig = `${Math.round(b.speed * 20)}|${Math.round(alt * 50)}|${Math.round(pl.input.thr * 20)}|${line2}|${b.ground}`;
  if (sig === h.sig) return;
  h.sig = sig;
  const c = h.canvas.getContext('2d');
  c.clearRect(0, 0, 640, 200);
  c.beginPath(); c.roundRect(4, 4, 632, 192, 30); c.fillStyle = 'rgba(12,14,20,0.82)'; c.fill();
  c.fillStyle = '#fff'; c.font = '700 50px system-ui, sans-serif'; c.textBaseline = 'middle';
  c.fillText(`${b.speed.toFixed(1)} m/s   ⬆ ${alt.toFixed(2)} m`, 26, 60);
  // Throttle bar.
  c.fillStyle = '#343a40'; c.fillRect(470, 30, 140, 30);
  c.fillStyle = pl.input.thr > 0 ? '#ffd43b' : '#868e96'; c.fillRect(470, 30, 140 * pl.input.thr, 30);
  c.font = '600 22px system-ui, sans-serif'; c.fillStyle = '#ced4da'; c.fillText(pl.input.thr > 0 ? 'POWER' : b.ground ? 'BRAKES' : 'OFF', 470, 82);
  c.font = '34px system-ui, sans-serif'; c.fillStyle = '#ced4da';
  c.fillText(line2, 26, 148);
  h.tex.needsUpdate = true;
}

// ---- sharing: everyone's planes ------------------------------------------------------------------------------

function send(ctx) {
  const pl = ctx.plane, b = pl.body, i = pl.input;
  pl.chan.send({ k: 'p', id: pl.me.id, s: pl.scheme, p: b.p.toArray().map(r3), q: b.q.toArray().map(r3), c: [i.ail, i.elev, i.rud, i.thr].map((x) => Math.round(x * 100) / 100), x: wrecked(pl) ? 1 : 0 });
}

function onMsg(ctx, m) {
  const pl = ctx.plane;
  if (!m || m.id === pl.me.id) return;
  if (m.k === 'bye') { const o = pl.others.get(m.id); if (o) { o.model.group.removeFromParent(); o.shadow.removeFromParent(); o.model.dispose(); pl.others.delete(m.id); } return; }
  if (m.k === 'crash') { if (Array.isArray(m.p)) for (let i = 0; i < 6; i++) puff(ctx, new THREE.Vector3(...m.p), 0.05, 0x868e96); return; }
  if (m.k !== 'p' || !Array.isArray(m.p) || !Array.isArray(m.q)) return;
  let o = pl.others.get(m.id);
  if (!o || o.scheme !== m.s) {
    if (o) { o.model.group.removeFromParent(); o.shadow.removeFromParent(); o.model.dispose(); }
    const model = buildPlane(THREE, { length: LEN, scheme: SCHEMES[m.s] ?? SCHEMES[0] });
    o = { model, scheme: m.s, shadow: makeShadow(model.dims.span), p: new THREE.Vector3(...m.p), q: new THREE.Quaternion(...m.q), wheel: 0 };
    pl.group.add(model.group, o.shadow);
    pl.others.set(m.id, o);
  }
  o.tp = new THREE.Vector3(...m.p);
  o.tq = new THREE.Quaternion(...m.q);
  o.c = m.c ?? [0, 0, 0, 0];
  o.crashed = !!m.x;
  o.at = performance.now();
}

function drawOthers(ctx, dt) {
  const pl = ctx.plane, now = performance.now();
  for (const [id, o] of pl.others) {
    if (now - o.at > 3000) { o.model.group.removeFromParent(); o.shadow.removeFromParent(); o.model.dispose(); pl.others.delete(id); continue; }
    const k = 1 - Math.exp(-dt / 0.07);
    o.p.lerp(o.tp, k);
    o.q.slerp(o.tq, k);
    o.model.group.position.copy(o.p);
    o.model.group.quaternion.copy(o.q);
    const [ail, elev, rud, thr] = o.c;
    o.model.set({ ail, elev, rud, rpm: thr > 0 ? 0.12 + thr * 0.88 : 0, dt });
    placeShadow(ctx, o.shadow, o.p);
  }
}

// ---- sound: a little buzzing engine, where the plane is ------------------------------------------------------

function engineSound(ctx) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ac = null, nodes = null;
  const make = () => {
    ac = new AC();
    const out = ac.createGain(); out.gain.value = 0;
    const pan = ac.createPanner();
    Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 0.5, rolloffFactor: 1.2 });
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.7;
    const a = ac.createOscillator(); a.type = 'sawtooth';
    const b = ac.createOscillator(); b.type = 'square';
    const bg = ac.createGain(); bg.gain.value = 0.35;
    a.connect(lp); b.connect(bg); bg.connect(lp);
    lp.connect(out); out.connect(pan); pan.connect(ac.destination);
    a.start(); b.start();
    nodes = { out, pan, lp, a, b };
  };
  return {
    unlock() { try { if (!ac) make(); if (ac.state !== 'running') ac.resume(); } catch {} },
    tick(c, pl) {
      if (!ac) { try { make(); } catch { return; } }
      if (ac.state !== 'running') return;
      const on = c.settings.get('sound') !== false && !wrecked(pl) && pl.input.thr > 0;
      const t = ac.currentTime, thr = pl.input.thr, p = pl.body.p, v = c.viewer();
      const f = 70 + thr * 150 + pl.body.speed * 20;
      nodes.a.frequency.setTargetAtTime(f, t, 0.05);
      nodes.b.frequency.setTargetAtTime(f * 0.5 * 1.01, t, 0.05);
      nodes.lp.frequency.setTargetAtTime(500 + thr * 1500, t, 0.05);
      nodes.out.gain.setTargetAtTime(on ? 0.05 + thr * 0.1 : 0, t, 0.08);
      nodes.pan.positionX.setTargetAtTime(p.x, t, 0.03); nodes.pan.positionY.setTargetAtTime(p.y, t, 0.03); nodes.pan.positionZ.setTargetAtTime(p.z, t, 0.03);
      if (v) {
        const L = ac.listener, fw = v3().set(0, 0, -1).applyQuaternion(v.quaternion), up = v3().set(0, 1, 0).applyQuaternion(v.quaternion);
        if (L.positionX) {
          L.positionX.setTargetAtTime(v.position.x, t, 0.03); L.positionY.setTargetAtTime(v.position.y, t, 0.03); L.positionZ.setTargetAtTime(v.position.z, t, 0.03);
          L.forwardX.setTargetAtTime(fw.x, t, 0.03); L.forwardY.setTargetAtTime(fw.y, t, 0.03); L.forwardZ.setTargetAtTime(fw.z, t, 0.03);
          L.upX.setTargetAtTime(up.x, t, 0.03); L.upY.setTargetAtTime(up.y, t, 0.03); L.upZ.setTargetAtTime(up.z, t, 0.03);
        }
      }
    },
    bonk() {
      if (!ac || ac.state !== 'running') return;
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.3);
      g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(nodes.pan); o.start(t); o.stop(t + 0.45);
    },
    close() { try { ac?.close(); } catch {} },
  };
}
