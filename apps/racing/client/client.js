// Mini Cars (Stratum app): RC cars on a track, one car per player.
//
// Each player's car is simulated on their own device (Rapier's ray-cast
// vehicle: wheels, suspension, grip), so driving has no network delay; it
// streams its pose to the others (ctx.channel), who see it as a solid
// (kinematic) car they can bump into. A race is an event everyone gets: a
// shared start time (server clock), 3 laps, finish times shared.
//
// Frame: the instance frame, y up, meters; the track lies on y = 0. The car's
// forward is +x (Rapier's vehicle default).
//
// Physics runs SIM× bigger with SIM× gravity (same motion in time, drawn at
// 1/SIM) and a SIM_MASS chassis (forces scaled to match): Rapier's ray-cast
// vehicle grips sideways by amounts that don't scale with size or weight, so
// a real 16 cm / 0.3 kg car turned 1° where its geometry says 139°; at metre
// size and 100 kg it steers true.
import { mergeStatic } from '/js/apps/kit/lod.js';

const LAPS = 3;
const STEP = 1 / 120;
const SIM = 6;                                   // physics units per meter
const SIM_MASS = 100;                            // kg of the simulated chassis
const sv = (x, y, z) => ({ x: x * SIM, y: y * SIM, z: z * SIM });
const SEND_MS = 50;
const STALE_MS = 3000;
const JUMP_M = 0.1;                               // another car moved further than this between messages: it jumped
const TRACK_W = 0.3;
const WALL_H = 0.035, WALL_T = 0.012;
const N = 120;                                   // centreline points
const CAR_K = 0.65;                              // car size (1 = the first, 15 cm long): smaller leaves more room on the 30 cm road
const CAR = { hx: 0.075 * CAR_K, hy: 0.016 * CAR_K, hz: 0.04 * CAR_K, wheelR: 0.019 * CAR_K, rest: 0.016 * CAR_K, mass: 0.32 };
const ENGINE = 0.55, BRAKE = 0.012, REVERSE = 0.45, MAX_STEER = 0.55, VMAX = 2.6;
const COAST = 0.25;                              // share of full braking when off the throttle
const STEER_RATE = 6;                            // rad/s the wheels turn toward the input
const COLORS = [0xe03131, 0x1c7ed6, 0x2f9e44, 0xf08c00, 0x9c36b5, 0x0ca678];
const NEAR_M = 3.0;                              // presses anywhere count while you're this close (phone)
// The hand wheel only for someone at the track (not in the next room): your
// head within this far of the track's edge to take it, and to keep it.
const AT_TRACK = { take: 1.5, keep: 2.5, below: 0.6, above: 2.4 };   // m (heights: head above the track)
// Hands: hold both like a steering wheel and one appears between them.
const GRIP = { in: 0.13, out: 0.155 };           // fingertips → wrist (m): curled round a wheel (open hand ≈ 0.18)
const WHEEL_SEP = [0.18, 0.85];                  // m between the hands
const WHEEL_REACH = [0.05, 0.9];                 // m in front of your head (to take it; once held, anywhere)
const KEEP_REF_MS = 2500;                        // retaken this soon after a tracking drop: same neutral spot (else a push becomes the new neutral)
const ENGAGE_MS = 250, LET_GO_MS = 400;          // hold the pose this long to take the wheel; tracking gaps shorter than this keep it
// Pedals: how far (m) the wheel is pulled toward you / pushed away from where you took it.
const PEDAL = { dead: 0.02, gas: 0.13, brake: 0.04, reverse: 0.12 };
const LOCK_RAD = 0.7;                            // wheel turned this far = full lock
const HINT_KEY = 'stratum.cars.controllerHint';
const RESET_R = 0.022;                           // the reset button (m); a fingertip this close presses it
const WEDGED_MS = 2000, OFF_TRACK_MS = 1200;     // stuck pushing / off the road this long: back on the track

let THREE, R;

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    R = await ctx.physics();
    const me = ctx.player();
    const c = (ctx.cars = {
      me, color: COLORS[hash(me.id) % COLORS.length], acc: 0, others: new Map(), held: { left: false, right: false },
      lap: 0, lapStart: null, last: null, best: Number(await ctx.state.get('best').catch(() => 0)) || null,
      race: null, results: [], steer: 0, pressedAt: -1e9, override: null,
    });
    c.clock = ctx.sim({ step: STEP, maxSteps: 6, idleMs: 1500 });
    buildWorld(ctx);
    buildCar(ctx);
    buildPanel(ctx);
    buildResetButton(ctx);
    buildWheel(ctx);
    c.chan = ctx.channel('cars', (m, from) => onMsg(ctx, m, from));
    resetCar(ctx);
    ctx.actions([
      { label: '🏁 Start race', run: () => startRace(ctx) },
      { label: '↺ Back on track', run: () => resetCar(ctx, true) },
    ]);
    updateStatus(ctx);
    window.__cars = { ctx, drive: (throttle, steer) => { c.override = throttle == null ? null : { throttle, steer }; },
      place: (i) => placeAt(ctx, i), input: () => c.input, wheel: () => c.wheel, lapNow: () => finishLap(ctx), pos: (b) => pos(b ?? c.body), speed: () => c.vc.currentVehicleSpeed() / SIM,
      // Test autopilot: steer at a point a little way along the centreline.
      autopilot: (on, throttle = 0.6) => { clearInterval(c.auto); if (!on) { c.override = null; return; }
        c.auto = setInterval(() => {
          const t = pos(c.body), q = c.body.rotation();
          const target = c.line[((c.at ?? 0) + 6) % N];
          const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
          const want = Math.atan2(-(target.y - t.z), target.x - t.x), have = Math.atan2(-fwd.z, fwd.x);
          const err = Math.atan2(Math.sin(want - have), Math.cos(want - have));
          c.override = { throttle, steer: THREE.MathUtils.clamp(err * 2.5, -1, 1) };
        }, 30); } };   // test hook
  },

  frame(ctx, dt) {
    const c = ctx.cars;
    if (!c?.world) return;
    const input = (c.input = readInput(ctx));
    // Physics only while something's happening: driving, racing, the wheel held, my car moving, another car close.
    const busy = Math.abs(input.throttle) > 0.02 || Math.abs(input.steer) > 0.02 || !!c.wheel?.on || !!c.race || carMoving(c) || otherNear(c);
    c.clock.tick(dt, (k, n) => {
      driveStep(ctx, input);
      moveOthers(ctx, (n - k) * STEP);
      c.vc.updateVehicle(STEP);
      c.world.step();
    }, { busy });
    if (c.clock.asleep) moveOthers(ctx, 0, true);   // (asleep: the others' cars still drive past, drawn where they are)
    drawCar(c);
    for (const o of c.others.values()) { solidify(c, o); drawOther(o); }
    progress(ctx);
    rescueIfStuck(ctx, input);
    pokeReset(ctx);
    send(ctx);
    drawWheel(ctx);
    if (c.race?.countdown || hintFor(ctx) !== c.hint) updateStatus(ctx);
  },

  // Phone: tap left / right half to steer; both to brake; any tap gets it going.
  press(ctx, e) {
    const c = ctx.cars;
    if (!c?.world) return false;
    if (partOf(e.hit?.object) === 'reset') { if (e.phase === 'down') pressReset(ctx); return true; }
    c.held[e.side === 'left' ? 'left' : 'right'] = e.phase === 'down';
    if (e.phase === 'down') c.pressedAt = performance.now();
    return true;
  },
  globalPress(ctx) {
    const v = ctx.viewer();
    return ctx.device === 'phone' && !!ctx.cars?.world && !!v && ctx.toLocal(v.position.clone()).length() < NEAR_M;
  },
  // Holding still on the track is driving, not moving the game: move it by its edge (the base).
  grab(ctx, e) { if (!e.handle) e.preventDefault(); },

  async stop(ctx) {
    ctx.cars?.world?.free();
    if (window.__cars?.ctx === ctx) delete window.__cars;
  },
};

const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

// ---- track ----------------------------------------------------------------------------------

function centreline() {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // A loop with a sweeping S along one side; ends open enough for the
    // car's turning circle (≈ 0.17 m at full lock).
    const x = 0.64 * Math.cos(a);
    const z = 0.42 * Math.sin(a) + 0.08 * Math.sin(3 * a) * (Math.sin(a) > 0 ? 1 : 0.3);
    pts.push(new THREE.Vector2(x, z));
  }
  return pts;
}

function buildWorld(ctx) {
  const c = ctx.cars;
  const w = (c.world = new R.World({ x: 0, y: -9.81 * SIM, z: 0 }));
  w.timestep = STEP;
  const group = (c.group = new THREE.Group());
  ctx.spawn(group);
  const line = (c.line = centreline());
  const nrm = line.map((p, i) => {
    const a = line[(i + N - 1) % N], b = line[(i + 1) % N];
    const t = new THREE.Vector2().subVectors(b, a).normalize();
    return new THREE.Vector2(-t.y, t.x);
  });
  c.normals = nrm;
  // Ground (the table / floor under it), road ribbon, curbs.
  const min = new THREE.Vector2(Infinity, Infinity), max = new THREE.Vector2(-Infinity, -Infinity);
  for (const p of line) { min.min(p); max.max(p); }
  min.subScalar(TRACK_W); max.addScalar(TRACK_W);
  c.bounds = { min: min.clone(), max: max.clone() };
  const gsize = new THREE.Vector2().subVectors(max, min), gc = new THREE.Vector2().addVectors(min, max).multiplyScalar(0.5);
  const ground = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(gc.x * SIM, -0.01 * SIM, gc.y * SIM));
  w.createCollider(R.ColliderDesc.cuboid((gsize.x / 2 + 0.5) * SIM, 0.01 * SIM, (gsize.y / 2 + 0.5) * SIM).setFriction(1.0), ground);
  const base = new THREE.Mesh(new THREE.BoxGeometry(gsize.x, 0.004, gsize.y), new THREE.MeshStandardMaterial({ color: 0x2b8a3e, roughness: 0.95 }));
  base.position.set(gc.x, 0.002, gc.y);
  base.userData.handle = true;   // grab the grass to move the track
  group.add(base);
  const road = [], idx = [];
  for (let i = 0; i < N; i++) {
    const p = line[i], n = nrm[i];
    road.push(p.x + n.x * TRACK_W / 2, 0.0045, p.y + n.y * TRACK_W / 2, p.x - n.x * TRACK_W / 2, 0.0045, p.y - n.y * TRACK_W / 2);
    const j = (i + 1) % N;
    idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(road, 3));
  rg.setIndex(idx);
  rg.computeVertexNormals();
  const roadMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x3d4148, roughness: 0.85, side: THREE.DoubleSide }));
  roadMesh.userData.handle = true;
  group.add(roadMesh);
  // Start line.
  const s0 = line[0], sn = nrm[0];
  const start = new THREE.Mesh(new THREE.PlaneGeometry(0.03, TRACK_W).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  start.position.set(s0.x, 0.005, s0.y);
  start.rotation.y = -Math.atan2(sn.y, sn.x) + Math.PI / 2;
  start.userData.handle = true;
  group.add(start);
  // Barriers both sides (red / white blocks), as fixed boxes.
  const wallMat = [new THREE.MeshStandardMaterial({ color: 0xe03131 }), new THREE.MeshStandardMaterial({ color: 0xf1f3f5 })];
  for (const side of [1, -1]) {
    const off = side * (TRACK_W / 2 + WALL_T / 2);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = new THREE.Vector2().copy(line[i]).addScaledVector(nrm[i], off), b = new THREE.Vector2().copy(line[j]).addScaledVector(nrm[j], off);
      const len = a.distanceTo(b) + WALL_T * 0.6, mid = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, WALL_T), wallMat[(i >> 1) % 2]);
      mesh.position.set(mid.x, WALL_H / 2, mid.y);
      mesh.rotation.y = -ang;
      mesh.userData.handle = true;
      group.add(mesh);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      const body = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(mid.x * SIM, WALL_H / 2 * SIM, mid.y * SIM).setRotation(q));
      w.createCollider(R.ColliderDesc.cuboid(len / 2 * SIM, WALL_H / 2 * SIM, WALL_T / 2 * SIM).setRestitution(0.3).setFriction(0.2), body);
    }
  }
  mergeStatic(group, { data: true });   // 240 barrier blocks → 2 draw calls
}

// Start grid: slot i, behind the line, two abreast.
function slotPose(ctx, i) {
  const c = ctx.cars;
  const back = 2 + 3 * Math.floor(i / 2);
  const k = (N - back) % N;
  const p = c.line[k], n = c.normals[k];
  const next = c.line[(k + 1) % N];
  const lateral = (i % 2 ? -1 : 1) * TRACK_W * 0.22;
  const pos = new THREE.Vector3(p.x + n.x * lateral, CAR.wheelR + CAR.rest + CAR.hy + 0.01, p.y + n.y * lateral);
  const yaw = -Math.atan2(next.y - p.y, next.x - p.x);   // +x forward along the track
  return { pos, yaw };
}

// ---- my car --------------------------------------------------------------------------------

function carMesh(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.hx * 2, CAR.hy * 2, CAR.hz * 2), paint);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR.hx * 0.9, CAR.hy * 1.4, CAR.hz * 1.6), new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.2, metalness: 0.5 }));
  cabin.position.set(-CAR.hx * 0.15, CAR.hy * 1.6, 0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.012 * CAR_K, 0.004 * CAR_K, CAR.hz * 2.1), paint);
  wing.position.set(-CAR.hx * 0.95, CAR.hy * 2.2, 0);
  g.add(body, cabin, wing);
  g.wheels = [];
  const tire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  for (const [x, z] of wheelSpots()) {
    const holder = new THREE.Group();
    const w = new THREE.Mesh(new THREE.CylinderGeometry(CAR.wheelR, CAR.wheelR, 0.014 * CAR_K, 16).rotateX(Math.PI / 2), tire);
    holder.add(w);
    holder.position.set(x, -CAR.hy, z);
    g.add(holder);
    g.wheels.push({ holder, w });
  }
  return g;
}

const wheelSpots = () => [[CAR.hx * 0.68, CAR.hz], [CAR.hx * 0.68, -CAR.hz], [-CAR.hx * 0.68, CAR.hz], [-CAR.hx * 0.68, -CAR.hz]];

function buildCar(ctx) {
  const c = ctx.cars;
  const vol = 8 * CAR.hx * CAR.hy * CAR.hz * SIM ** 3;
  c.massK = SIM_MASS / CAR.mass;                 // forces: real car's × this
  // Never asleep in Rapier: the vehicle controller's forces don't wake a sleeping
  // chassis (a car still for a moment, e.g. after a rescue, stayed frozen with
  // throttle on). The SimClock is what idles a parked car.
  c.body = c.world.createRigidBody(R.RigidBodyDesc.dynamic().setLinearDamping(0.3).setAngularDamping(0.8).setCcdEnabled(true).setCanSleep(false));
  c.world.createCollider(R.ColliderDesc.cuboid(CAR.hx * SIM, CAR.hy * SIM, CAR.hz * SIM).setDensity(SIM_MASS / vol).setFriction(0.4).setRestitution(0.2), c.body);
  c.vc = c.world.createVehicleController(c.body);
  wheelSpots().forEach(([x, z], i) => {
    c.vc.addWheel(sv(x, -CAR.hy * 0.5, z), { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, CAR.rest * SIM, CAR.wheelR * SIM);
    // Static sag ≈ g / (4 k) of travel (Bullet-style: suspension force ∝ chassis mass).
    c.vc.setWheelSuspensionStiffness(i, 9.81 * SIM / (4 * 0.004 * SIM));
    c.vc.setWheelSuspensionCompression(i, 6);
    c.vc.setWheelSuspensionRelaxation(i, 8);
    c.vc.setWheelMaxSuspensionTravel(i, 0.015 * SIM);
    c.vc.setWheelMaxSuspensionForce(i, 1e5);
    c.vc.setWheelFrictionSlip(i, 1.6);
    c.vc.setWheelSideFrictionStiffness(i, 1.0);
  });
  c.mesh = carMesh(c.color);
  c.group.add(c.mesh);
}

function placeAt(ctx, slot) {
  const c = ctx.cars;
  c.clock?.wake();   // (it has to settle onto its wheels)
  const { pos, yaw } = slotPose(ctx, slot);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  c.body.setTranslation(sv(pos.x, pos.y, pos.z), true);
  c.body.setRotation(q, true);
  c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  c.at = (N - 2 - 3 * Math.floor(slot / 2)) % N;
  c.seen = new Set();
}

function mySlot(ctx) {
  const c = ctx.cars;
  const ids = [c.me.id, ...c.others.keys()].sort();
  return Math.max(0, ids.indexOf(c.me.id));
}

function resetCar(ctx, keepLap = false) {
  const c = ctx.cars;
  c.clock?.wake();
  if (keepLap && c.at != null) {   // back on the track where it left it
    const p = c.line[c.at], next = c.line[(c.at + 1) % N];
    c.body.setTranslation(sv(p.x, 0.06, p.y), true);
    c.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(next.y - p.y, next.x - p.x)), true);
    c.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    c.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return;
  }
  placeAt(ctx, mySlot(ctx));
  c.lap = 0;
  c.lapStart = null;
}

// Throttle (-1..1, negative = brake / reverse) and steer (-1..1, positive = left).
function readInput(ctx) {
  const c = ctx.cars;
  const red = c.race && ctx.now() < c.race.start;   // waiting for the lights
  const wheel = handWheel(ctx);   // (also updates the drawn wheel)
  if (c.override) return red ? { ...c.override, throttle: 0 } : c.override;
  const ctl = ctx.controls();
  const controllers = !!ctl && !ctl.left?.hand && !ctl.right?.hand;
  let throttle = 0, steer = 0, brakeOnly = false;
  if (wheel) ({ throttle, steer, brakeOnly } = wheel);
  else if (controllers) {
    const l = ctl.left, r = ctl.right;
    throttle = (r?.trigger ?? 0) - (l?.trigger ?? 0);
    const stick = (r?.stick?.[0] ?? 0) || (l?.stick?.[0] ?? 0);
    steer = -stick;
    if (Math.abs(throttle) > 0.3 && !c.hintDone) { c.hintDone = true; try { localStorage.setItem(HINT_KEY, '1'); } catch {} }
  } else if (ctx.device === 'quest' || ctx.hands()) {
    // Tracked hands not holding the wheel: let go = coast.
  } else {
    const going = performance.now() - c.pressedAt < 8000;
    const both = c.held.left && c.held.right;
    throttle = both ? -0.6 : going ? 0.7 : 0;
    steer = both ? 0 : c.held.left ? 1 : c.held.right ? -1 : 0;
  }
  if (red) throttle = 0;
  return { throttle, steer, brakeOnly };
}

// ---- hands: the wheel ---------------------------------------------------------------------------

// How curled a hand is: mean fingertip → wrist distance (m).
const curl = (h) => [9, 14, 19].reduce((s, i) => s + h.joints[i].distanceTo(h.joints[0]), 0) / 3 / h.scale;
// Where the rim passes through a hand: across the curled fingers.
const gripPoint = (h) => h.joints[0].clone().lerp(h.joints[11], 0.7);

// Both hands held like a wheel (curled, apart, in front of you) for ENGAGE_MS
// takes it; the pose lost for LET_GO_MS lets go. While held: steer = the
// wheel's turn (the tilt of the line between the hands), pedals = how far the
// wheel moved toward you / away from where you took it. Returns the input or null.
// Is the player at the track: standing or sitting by it, on its floor?
function atTrack(c, v, holding) {
  const b = c.bounds, p = v?.position;
  if (!b || !p) return false;
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x), dz = Math.max(b.min.y - p.z, 0, p.z - b.max.y);
  return Math.hypot(dx, dz) < (holding ? AT_TRACK.keep : AT_TRACK.take) && p.y > -AT_TRACK.below && p.y < AT_TRACK.above;
}

function handWheel(ctx) {
  const c = ctx.cars, w = c.wheel, now = performance.now();
  const h = ctx.hands(), v = ctx.viewer();
  let pose = null;
  const here = atTrack(c, v, w.on);
  if (!here && v) w.why = { away: true };
  if (h?.left && h?.right && v && here) {
    const s = h.right.scale, L = gripPoint(h.left), Rh = gripPoint(h.right);
    const across = Rh.clone().sub(L), mid = L.clone().add(Rh).multiplyScalar(0.5);
    const toMid = mid.clone().sub(v.position).setY(0);
    const sep = across.length() / s, reach = toMid.length() / s, limit = w.on ? GRIP.out : GRIP.in;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.quaternion);
    const curled = curl(h.left) < limit && curl(h.right) < limit;
    // Taking it: apart like on a wheel, in front of you, right hand on the right.
    // Holding it: just curled and not far apart (pulling it to your chest or
    // pushing it all the way out must not drop it).
    const held = w.on ? curled && sep < 1.0
      : curled && sep > WHEEL_SEP[0] && sep < WHEEL_SEP[1] && reach > WHEEL_REACH[0] && reach < WHEEL_REACH[1] && across.dot(right) > 0;
    if (held) pose = { across, mid, toMid, s, sep, reach };
    else if (w.on && !w.lost) w.why = { curlL: +curl(h.left).toFixed(3), curlR: +curl(h.right).toFixed(3), sep: +sep.toFixed(2) };
  }
  if (!pose) {
    w.since = null;
    if (!h?.left || !h?.right) w.why = { tracked: [!!h?.left, !!h?.right] };
    if (w.on && now - (w.lost ??= now) > LET_GO_MS) {
      w.on = false; w.input = null; w.droppedAt = now;
      ctx.telemetry?.('cars wheel dropped', w.why ?? {});
    }
    return w.on ? w.input && { ...w.input, throttle: 0 } : null;   // a tracking gap: keep steering, coast
  }
  w.lost = null;
  if (!w.on) {
    if (now - (w.since ??= now) < ENGAGE_MS) return null;
    w.on = true;
    w.shownAt = now;
    const again = w.dir && now - (w.droppedAt ?? -1e9) < KEEP_REF_MS;   // a tracking drop, not a new grip: keep neutral
    if (!again) {
      w.dir = pose.toMid.clone().setY(0).normalize();             // toward the wheel, level
      w.ref = pose.toMid.dot(w.dir) / pose.s;
    }
    ctx.telemetry?.('cars wheel', { sepCm: Math.round(pose.sep * 100), reachCm: Math.round(pose.reach * 100), again });
  }
  // Steering: the hand line's tilt, seen from the driver's seat.
  const a = pose.across, side = a.clone().sub(w.dir.clone().multiplyScalar(a.dot(w.dir))).setY(0).length();
  const turn = Math.atan2(a.y, side);                         // right hand up = turn left (+)
  const pull = w.ref - pose.toMid.dot(w.dir) / pose.s;        // m toward you (+) / away (−)
  let throttle = 0, brakeOnly = false, gear = 'N';
  if (pull > PEDAL.dead) { throttle = Math.min(1, (pull - PEDAL.dead) / (PEDAL.gas - PEDAL.dead)); gear = 'D'; }
  else if (-pull > PEDAL.reverse) { throttle = -1; gear = 'R'; }
  else if (-pull > PEDAL.brake) { throttle = -(0.3 + 0.7 * (-pull - PEDAL.brake) / (PEDAL.reverse - PEDAL.brake)); brakeOnly = true; gear = 'B'; }
  w.pose = pose;
  w.turn = turn;
  w.pull = pull;
  w.gear = gear;
  w.input = { throttle, steer: THREE.MathUtils.clamp(turn / LOCK_RAD, -1, 1), brakeOnly };
  return w.input;
}

function buildWheel(ctx) {
  const c = ctx.cars;
  const g = new THREE.Group();
  g.visible = false;
  const rubber = new THREE.MeshStandardMaterial({ color: 0x24272e, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.92 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.8, transparent: true, opacity: 0.92 });
  const mark = new THREE.MeshBasicMaterial({ color: 0xff922b, transparent: true, opacity: 0.95 });
  // Unit wheel (radius 1, in its xy plane, facing +z), scaled to the hands each frame.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.055, 10, 48), rubber);
  const top = new THREE.Mesh(new THREE.TorusGeometry(1, 0.062, 10, 6, 0.22).rotateZ(Math.PI / 2 - 0.11), mark);   // 12 o'clock stripe
  g.add(rim, top);
  for (const ang of [0, Math.PI, -Math.PI / 2]) {                           // spokes: 3, 9 and 6 o'clock
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.07, 0.03), metal);
    spoke.position.set(Math.cos(ang) * 0.62, Math.sin(ang) * 0.62, -0.02);
    spoke.rotation.z = ang;
    g.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 32).rotateX(Math.PI / 2), metal);
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.28, 40), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  face.position.z = 0.045;
  g.add(hub, face);
  g.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });   // not something to point at or move
  c.group.add(g);
  c.wheel = { on: false, since: null, lost: null, input: null, mesh: g, gauge: { canvas, tex, at: 0 }, mats: [rubber, metal, mark] };
}

function drawWheel(ctx) {
  const c = ctx.cars, w = c.wheel, g = w.mesh;
  g.visible = w.on && !!w.pose;
  if (!g.visible) return;
  const now = performance.now(), p = w.pose;
  // Basis: x along the hands, z back toward you, y up the wheel.
  const x = p.across.clone().normalize();
  const z = w.dir.clone().negate();
  z.addScaledVector(x, -z.dot(x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  g.position.copy(p.mid);
  const pop = Math.min(1, (now - w.shownAt) / 150);
  g.scale.setScalar((p.sep * p.s / 2) * (0.6 + 0.4 * pop));
  const fade = w.lost ? 0.35 : 0.92;
  for (const m of w.mats) m.opacity = fade;
  if (now - w.gauge.at > 66) { w.gauge.at = now; drawGauge(c); }
}

// The hub: speed arc + needle, the pedal you're on (green gas / red brake), gear letter.
function drawGauge(c) {
  const { canvas, tex } = c.wheel.gauge, g = canvas.getContext('2d'), w = c.wheel;
  const speed = c.vc.currentVehicleSpeed() / SIM;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#14171d';
  g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  g.lineWidth = 14; g.lineCap = 'round';
  g.strokeStyle = '#2c313a';
  g.beginPath(); g.arc(128, 128, 100, a0, a0 + span); g.stroke();
  const f = Math.min(1, Math.abs(speed) / VMAX);
  g.strokeStyle = speed < -0.05 ? '#ffa94d' : '#4dabf7';
  if (f > 0.01) { g.beginPath(); g.arc(128, 128, 100, a0, a0 + span * f); g.stroke(); }
  // Pedal: inner ring.
  const t = w.input?.throttle ?? 0;
  g.lineWidth = 8;
  g.strokeStyle = t > 0 ? '#51cf66' : '#ff6b6b';
  if (Math.abs(t) > 0.01) { g.beginPath(); g.arc(128, 128, 80, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.abs(t)); g.stroke(); }
  g.fillStyle = { D: '#51cf66', R: '#ffa94d', B: '#ff6b6b', N: '#adb5bd' }[w.gear] ?? '#adb5bd';
  g.font = '800 92px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(w.gear ?? 'N', 128, 120);
  g.fillStyle = '#e9ecef';
  g.font = '600 30px system-ui, sans-serif';
  g.fillText(`${Math.abs(speed).toFixed(1)} m/s`, 128, 196);
  tex.needsUpdate = true;
}

// One line of help on the panel until you've got going.
function hintFor(ctx) {
  const c = ctx.cars;
  if (ctx.device !== 'quest') return null;
  const ctl = ctx.controls();
  if (ctl && !ctl.left?.hand && !ctl.right?.hand) {
    if (c.hintDone ??= (() => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } })()) return null;
    return 'Right trigger: gas · left trigger: brake, hold to reverse · stick: steer';
  }
  if (c.wheel.on) return null;
  return 'Hold both hands like a wheel · pull = gas · push = brake · push all the way = reverse';
}

function driveStep(ctx, input) {
  const c = ctx.cars;
  const speed = c.vc.currentVehicleSpeed() / SIM;   // m/s of the drawn car
  const target = input.steer * MAX_STEER * (1 - 0.5 * Math.min(1, Math.abs(speed) / VMAX));   // less lock at speed
  c.steer += THREE.MathUtils.clamp(target - c.steer, -STEER_RATE * STEP, STEER_RATE * STEP);
  c.vc.setWheelSteering(0, c.steer);
  c.vc.setWheelSteering(1, c.steer);
  if (Math.abs(input.throttle) > 0.05) c.moved = true;
  let force = 0, brake = 0;
  if (Math.abs(input.throttle) <= 0.02) brake = BRAKE * COAST;   // off the throttle: motor drag slows it, like a real RC car
  if (input.throttle > 0.02) force = ENGINE * input.throttle * Math.max(0, 1 - Math.max(0, speed) / VMAX);
  else if (input.throttle < -0.02) {
    if (speed > 0.15 || input.brakeOnly) brake = BRAKE * -input.throttle;
    else force = -REVERSE * ENGINE * -input.throttle;   // stopped: reverse
  }
  for (const i of [2, 3]) c.vc.setWheelEngineForce(i, force * SIM * c.massK);   // rear-wheel drive
  for (let i = 0; i < 4; i++) c.vc.setWheelBrake(i, brake * SIM * c.massK);
}

const pos = (body) => { const t = body.translation(); return { x: t.x / SIM, y: t.y / SIM, z: t.z / SIM }; };

function drawCar(c) {
  const t = pos(c.body), q = c.body.rotation();
  c.mesh.position.set(t.x, t.y, t.z);
  c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  c.mesh.wheels.forEach((wh, i) => {
    wh.holder.rotation.y = i < 2 ? c.steer : 0;
    wh.w.rotation.z = -c.vc.wheelRotation(i);
    const len = c.vc.wheelSuspensionLength(i);
    if (len != null) wh.holder.position.y = -CAR.hy * 0.5 - len / SIM;
  });
}

// ---- laps -----------------------------------------------------------------------------------

function nearestIndex(c, x, z) {
  let best = c.at ?? 0, bd = Infinity;
  const from = c.at ?? 0;
  for (let d = -12; d <= 12; d++) {   // search near where it was
    const i = (from + d + N) % N;
    const p = c.line[i];
    const dd = (p.x - x) ** 2 + (p.y - z) ** 2;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

function progress(ctx) {
  const c = ctx.cars;
  const t = pos(c.body);
  const prev = c.at ?? 0;
  const i = nearestIndex(c, t.x, t.z);
  c.at = i;
  c.seen.add(Math.floor(i / (N / 4)));                        // checkpoints: each quarter of the track
  if (prev > N * 0.75 && i < N * 0.25) {                     // crossed the line, forward
    if (c.lapStart != null && c.seen.size >= 4) finishLap(ctx);
    else if (c.lapStart == null && (!c.race || ctx.now() >= c.race.start)) c.lapStart = ctx.now();
    c.seen = new Set();
  }
}

function finishLap(ctx) {
  const c = ctx.cars;
  const now = ctx.now();
  if (c.lapStart != null) {
    c.last = (now - c.lapStart) / 1000;
    if (!c.best || c.last < c.best) {
      c.best = c.last;
      ctx.state.set('best', c.best).catch(() => {});
    }
    c.lap++;
  }
  c.lapStart = now;
  if (c.race && !c.race.done && c.lap >= LAPS) {
    c.race.done = true;
    const time = (now - c.race.start) / 1000;
    c.chan.send({ k: 'finish', id: c.me.id, name: c.me.name, time, race: c.race.id });
    addResult(ctx, { id: c.me.id, name: c.me.name, time });
  }
  updateStatus(ctx);
}

function rescueIfStuck(ctx, input) {
  const c = ctx.cars, now = performance.now();
  const t = pos(c.body);
  // Pushing against something and not moving, or off the road: put it back.
  const speed = Math.abs(c.vc.currentVehicleSpeed() / SIM);
  const pushing = Math.abs(input?.throttle ?? 0) > 0.3 && speed < 0.04;
  c.wedgedSince = pushing ? c.wedgedSince ?? now : null;
  const p = c.line[c.at ?? 0], off = Math.hypot(p.x - t.x, p.y - t.z) > TRACK_W / 2 + 0.08;
  c.offSince = off ? c.offSince ?? now : null;
  if ((c.wedgedSince && now - c.wedgedSince > WEDGED_MS) || (c.offSince && now - c.offSince > OFF_TRACK_MS)) {
    ctx.telemetry?.('cars reset', { how: c.offSince ? 'off track' : 'wedged' });
    c.wedgedSince = c.offSince = null;
    return resetCar(ctx, true);
  }
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(c.body.rotation()));
  if (t.y < -0.3 || up.y < 0.3) {
    c.stuckSince ??= performance.now();
    if (performance.now() - c.stuckSince > 1500 || t.y < -0.3) { resetCar(ctx, true); c.stuckSince = null; }
  } else c.stuckSince = null;
}

// ---- other players ---------------------------------------------------------------------------

function onMsg(ctx, m, from) {
  const c = ctx.cars;
  if (!m || m.id === c.me.id) return;
  if (m.k === 'car') {
    let o = c.others.get(m.id);
    if (!o) {
      const body = c.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(m.p[0] * SIM, m.p[1] * SIM, m.p[2] * SIM));
      // A ghost until it's clear of my car: appearing inside it would launch mine.
      const collider = c.world.createCollider(R.ColliderDesc.cuboid(CAR.hx * SIM, (CAR.hy + CAR.wheelR * 0.6) * SIM, CAR.hz * SIM).setSensor(true), body);
      const mesh = carMesh(m.color);
      c.group.add(mesh);
      o = { body, collider, mesh, name: m.name };
      c.others.set(m.id, o);
      if (!c.moved) resetCar(ctx);   // not driven yet: take my own grid slot now that there's company
      updateStatus(ctx);
    }
    // A jump (they reset, re-slotted, got put back on the track): teleport the
    // copy, a ghost again until it's clear; sliding it there would shove my car.
    if (o.m && Math.hypot(m.p[0] - o.m.p[0], m.p[2] - o.m.p[2]) > JUMP_M) {
      o.body.setTranslation(sv(m.p[0], m.p[1], m.p[2]), true);
      o.collider.setSensor(true);
    }
    o.m = m;
    o.at = performance.now();
  } else if (m.k === 'race') {
    beginRace(ctx, m);
  } else if (m.k === 'finish' && c.race?.id === m.race) {
    addResult(ctx, m);
  }
}

// Remote cars: where their last message says, carried forward by their speed (kinematic: they push you).
// Moving = it actually went somewhere since last frame (a parked car's suspension reports speed but goes nowhere).
function carMoving(c) {
  const t = pos(c.body), q = c.body.rotation(), last = c.lastPose;
  c.lastPose = { x: t.x, y: t.y, z: t.z, q: [q.x, q.y, q.z, q.w] };
  if (!last) return true;
  const turned = 1 - Math.abs(last.q[0] * q.x + last.q[1] * q.y + last.q[2] * q.z + last.q[3] * q.w);
  return Math.hypot(t.x - last.x, t.y - last.y, t.z - last.z) > 0.0004 || turned > 1e-6;
}
const otherNear = (c) => { const a = pos(c.body); for (const o of c.others.values()) { const b = pos(o.body); if (Math.hypot(a.x - b.x, a.z - b.z) < 0.5) return true; } return false; };   // (pos: meters)

// The others' cars: kinematic bodies moved to where their last message says (carried forward by its speed).
// place: set them there at once (no physics step coming).
function moveOthers(ctx, back, place = false) {
  const c = ctx.cars;
  const now = performance.now();
  for (const [id, o] of c.others) {
    if (now - o.at > STALE_MS) {
      c.world.removeRigidBody(o.body);
      o.mesh.removeFromParent();
      c.others.delete(id);
      updateStatus(ctx);
      continue;
    }
    const age = Math.min(0.2, (now - o.at) / 1000 - back);
    const at = sv(o.m.p[0] + o.m.v[0] * age, o.m.p[1] + o.m.v[1] * age, o.m.p[2] + o.m.v[2] * age), q = { x: o.m.q[0], y: o.m.q[1], z: o.m.q[2], w: o.m.q[3] };
    if (place) { o.body.setTranslation(at, true); o.body.setRotation(q, true); }
    else { o.body.setNextKinematicTranslation(at); o.body.setNextKinematicRotation(q); }
  }
}

// Solid once it's more than a car length away from mine.
function solidify(c, o) {
  if (!o.collider.isSensor()) return;
  const a = pos(c.body), b = pos(o.body);
  if (Math.hypot(a.x - b.x, a.z - b.z) > CAR.hx * 2.4) o.collider.setSensor(false);
}

function drawOther(o) {
  const t = pos(o.body), q = o.body.rotation();
  o.mesh.position.set(t.x, t.y, t.z);
  o.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  o.mesh.wheels.forEach((wh, i) => { wh.holder.rotation.y = i < 2 ? o.m.s ?? 0 : 0; });
}

function send(ctx) {
  const c = ctx.cars;
  const now = performance.now();
  if (now - (c.sentAt ?? 0) < SEND_MS) return;
  c.sentAt = now;
  const t = pos(c.body), q = c.body.rotation(), v0 = c.body.linvel(), v = { x: v0.x / SIM, y: v0.y / SIM, z: v0.z / SIM };
  const r = (x) => Math.round(x * 1e4) / 1e4;
  c.chan.send({ k: 'car', id: c.me.id, name: c.me.name, color: c.color, p: [t.x, t.y, t.z].map(r), q: [q.x, q.y, q.z, q.w].map(r),
    v: [v.x, v.y, v.z].map(r), s: r(c.steer), lap: c.lap });
}

// ---- races ------------------------------------------------------------------------------------

function startRace(ctx) {
  const m = { k: 'race', id: `${ctx.cars.me.id}-${Date.now()}`, start: ctx.now() + 4000, laps: LAPS, by: ctx.cars.me.name };
  ctx.cars.chan.send(m);
  beginRace(ctx, m);
}

function beginRace(ctx, m) {
  const c = ctx.cars;
  c.moved = false;
  c.race = { id: m.id, start: m.start, countdown: true, done: false };
  c.results = [];
  resetCar(ctx);
  c.lapStart = null;
  updateStatus(ctx);
}

function addResult(ctx, r) {
  const c = ctx.cars;
  if (c.results.some((x) => x.id === r.id)) return;
  c.results.push({ id: r.id, name: r.name, time: r.time });
  c.results.sort((a, b) => a.time - b.time);
  updateStatus(ctx);
}

// ---- panel + status ------------------------------------------------------------------------------

// A big round reset button beside the panel: poke it, pinch it, tap it, or use the menu.
function buildResetButton(ctx) {
  const c = ctx.cars;
  const g = new THREE.Group();
  const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const x = canvas.getContext('2d');
  x.fillStyle = '#f08c00'; x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = '800 74px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('↺', 64, 70);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.CircleGeometry(RESET_R, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(RESET_R * 1.1, RESET_R * 1.15, 0.01, 32).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.5 }));
  face.position.z = 0.0052;
  for (const m of [face, rim]) m.userData.part = 'reset';
  g.add(rim, face);
  g.position.set(0.23, 0.16, -0.62);
  c.group.add(g);
  c.resetBtn = g;
}

const partOf = (node) => { for (let n = node; n; n = n.parent) if (n.userData?.part) return n.userData.part; return null; };

function pressReset(ctx) {
  const c = ctx.cars, now = performance.now();
  if (now - (c.resetAt ?? -1e9) < 800) return;
  c.resetAt = now;
  c.resetBtn.scale.setScalar(0.85);
  setTimeout(() => c.resetBtn.scale.setScalar(1), 150);
  resetCar(ctx, true);
  ctx.telemetry?.('cars reset', { how: 'button' });
}

// A fingertip on the reset button presses it.
function pokeReset(ctx) {
  const c = ctx.cars, h = ctx.hands?.();
  if (!h || !c.resetBtn) return;
  const at = c.resetBtn.getWorldPosition(new THREE.Vector3());
  ctx.toLocal(at);
  for (const side of ['left', 'right']) {
    const tip = h[side]?.joints[9];
    if (tip && tip.distanceTo(at) < (RESET_R + 0.012) * h[side].scale) return pressReset(ctx);
  }
}

function buildPanel(ctx) {
  const c = ctx.cars;
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 300 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36 * 300 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  mesh.position.set(0, 0.16, -0.62);
  mesh.userData.handle = true;
  c.group.add(mesh);
  c.panel = { canvas, tex };
}

const fmt = (s) => (s == null ? '–' : `${s.toFixed(2)} s`);

function updateStatus(ctx) {
  const c = ctx.cars;
  const now = ctx.now();
  let line;
  if (c.race && now < c.race.start) {
    const n = Math.ceil((c.race.start - now) / 1000);
    line = n > 3 ? 'Race: get ready' : `Race: ${n}…`;
  } else if (c.race && !c.race.done) {
    if (c.race.countdown) { c.race.countdown = false; }
    line = `Race · lap ${Math.min(c.lap + 1, LAPS)}/${LAPS}`;
  } else if (c.race?.done) line = `Finished · ${c.results.findIndex((r) => r.id === c.me.id) + 1} of ${c.results.length}`;
  else line = `Practice · lap ${c.lap} · last ${fmt(c.last)}`;
  ctx.status(`🏎 ${line} · best ${fmt(c.best)}${c.others.size ? ` · ${c.others.size + 1} cars` : ''}`);
  const g = c.panel.canvas.getContext('2d');
  c.hint = hintFor(ctx);
  g.clearRect(0, 0, 512, 300);
  g.fillStyle = 'rgba(12,14,20,0.85)';
  g.beginPath(); g.roundRect(0, 0, 512, 300, 24); g.fill();
  g.fillStyle = '#fff';
  g.font = '700 34px system-ui, sans-serif';
  g.fillText(line, 24, 50);
  g.font = '24px system-ui, sans-serif';
  g.fillStyle = '#c9ced8';
  g.fillText(`last ${fmt(c.last)} · best ${fmt(c.best)}`, 24, 90);
  c.results.slice(0, 4).forEach((r, i) => {
    g.fillStyle = r.id === c.me.id ? '#ffd43b' : '#e9ecef';
    g.fillText(`${i + 1}. ${r.name}`.slice(0, 24), 24, 130 + i * 30);
    g.fillText(fmt(r.time), 380, 130 + i * 30);
  });
  if (c.hint) {
    g.fillStyle = '#ffd43b';
    g.font = '600 19px system-ui, sans-serif';
    const words = c.hint.split(' · ');
    const half = Math.ceil(words.length / 2);
    g.fillText(words.slice(0, half).join(' · '), 24, 256);
    g.fillText(words.slice(half).join(' · '), 24, 282);
  }
  c.panel.tex.needsUpdate = true;
}
