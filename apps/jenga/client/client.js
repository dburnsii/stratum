// Jenga (Stratum app). 54 real-size blocks, shared with everyone in the
// space. DESIGN.md §6.7.
//
// Physics follows the player (ctx.sync lease): at rest there is no physics
// anywhere; every device draws the shared resting poses. Whoever reaches in
// (a hand near the tower, or a press on a block) claims the simulation: their
// device builds the Rapier world from the resting poses (already settled,
// so the tower doesn't sag or drift; bodies start awake: Rapier bodies
// created asleep miss their contacts and fall through each other), and their touch acts with no network
// delay. Others watch the stream of moving blocks. When everything is still
// again, the poses become the new resting state and the lease is free.
//
// Frame: the instance frame, y up, meters; the tower stands on its board at
// the origin.
import { HandBodies } from '/js/apps/kit/handbodies.js';

const BL = 0.075, BH = 0.015, BW = 0.025;     // block length, height, width
const LEVELS = 18;
const GAP = 0.0002;                           // between levels, so nothing starts squeezed
const BOARD_H = 0.008;
const STEP = 1 / 120;
const STREAM_MS = 66;
const REACH_M = 0.14;                         // a hand this close to the tower claims the simulation
const STILL_SPEED = 0.004;                    // m/s: slower counts as still
const SETTLE_MS = 700;                        // all still (and hands away) this long: settle
const FALL_DROP = BH * 0.8;                   // a block this much lower than it started has fallen
const FALLEN_TO_LOSE = 2;                     // that many fallen blocks (not the one you moved): collapsed
const PULL_S = 0.05;                          // spring time constant pulling a held block to the hand / ray
const PULL_MAX = 0.6;                         // m/s
const FOLLOW_S = 0.05;

let THREE, R;

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    R = await ctx.physics();
    const j = (ctx.jenga = { acc: 0, held: null, quietSince: 0, moves: 0, over: false, stream: null });
    build(ctx);
    const saved = await ctx.state.get(`tower-${ctx.instance.id}`).catch(() => null);
    j.room = ctx.sync({
      onLease: () => updateStatus(ctx),
      onStream: (d) => { j.stream = d; },
      onRest: (d) => adopt(ctx, d),
    });
    j.room.seed(saved?.d ?? settledTower(ctx), saved?.rev ?? 0);
    adopt(ctx, j.room.rest.d, false);
    ctx.actions([{ label: '↺ Rebuild', run: () => rebuild(ctx) }]);
    window.__jenga = { ctx, claim: () => claim(ctx), simulate: (s) => simulateFor(ctx, s), rebuild: () => rebuild(ctx),
      grab: (i, target) => grabBlock(ctx, i, () => ({ origin: target.clone(), dir: new THREE.Vector3(0, 0, -1) }), 0),
      drop: () => drop(ctx) };   // test hook
  },

  frame(ctx, dt) {
    const j = ctx.jenga;
    if (!j?.meshes) return;
    const hands = ctx.hands();
    if (j.world) j.club.frame(hands);
    if (!j.room.mine && hands && !j.over && nearTower(j, hands)) claim(ctx);
    if (j.room.mine && j.world) return simulate(ctx, dt, hands);
    watch(j, dt);
  },

  press(ctx, e) {
    const j = ctx.jenga;
    if (!j?.meshes) return false;
    if (e.phase === 'up') { drop(ctx); return true; }
    const i = j.meshes.indexOf(e.object);
    if (i < 0 || j.over) return false;
    const ray = e.ray();
    if (!ray) return false;
    if (!claim(ctx)) { ctx.log('someone else is touching the tower'); return true; }
    grabBlock(ctx, i, e.ray, e.point ? ray.origin.distanceTo(e.point) : 0.3);
    return true;
  },
  // With a long frame in the log (runtime): what the simulation was doing.
  debug(ctx) {
    const j = ctx.jenga;
    if (!j) return null;
    const awake = j.bodies && j.world ? j.bodies.filter((b) => !b.isSleeping()).length : 0;
    return { mine: !!j.room?.mine, simulating: !!j.world, steps: j.lastSteps ?? 0, stepsMs: +(j.lastStepsMs ?? 0).toFixed(1),
      awake, held: j.held?.i ?? null, over: j.over, moves: j.moves, session: j.sess && sessionSummary(j) };
  },

  // Holding still on a block is pulling it, not moving the game: move it by the board.
  grab(ctx, e) { if (!e.handle) e.preventDefault(); },

  async stop(ctx) {
    const j = ctx.jenga;
    if (j?.room?.mine) settle(ctx);
    j?.world?.free();
    if (window.__jenga?.ctx === ctx) delete window.__jenga;
  },
};

// ---- tower ------------------------------------------------------------------------------

// Poses: [x, y, z, qx, qy, qz, qw] per block. Even levels run along x, odd along z.
function freshTower() {
  const b = [];
  const along = new THREE.Quaternion(), across = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (let k = 0; k < LEVELS; k++) {
    const y = BOARD_H + BH / 2 + k * (BH + GAP), q = k % 2 ? across : along;
    for (const o of [-BW, 0, BW]) b.push(k % 2 ? [o, y, 0, q.x, q.y, q.z, q.w] : [0, y, o, q.x, q.y, q.z, q.w]);
  }
  return { b: b.map(quant), moves: 0, over: false };
}

// A fresh tower, already settled under its own weight (contacts compress a
// few mm over 18 levels): saved like that, a claim starts from true rest.
function settledTower(ctx) {
  const j = ctx.jenga;
  const keep = { rest: j.rest, world: j.world, bodies: j.bodies, club: j.club, startY: j.startY, moved: j.moved, topBefore: j.topBefore };
  j.rest = freshTower();
  j.world = null;
  startWorld(ctx);
  for (const b of j.bodies) b.wakeUp();
  for (let i = 0; i < 3 / STEP; i++) j.world.step();
  const d = { b: j.bodies.map((b) => quant(pose(b))), moves: 0, over: false };
  j.world.free();
  Object.assign(j, keep);
  return d;
}

const quant = (a) => a.map((v) => Math.round(v * 1e5) / 1e5);

function build(ctx) {
  const j = ctx.jenga;
  const group = new THREE.Group();
  ctx.spawn(group);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.16, BOARD_H, 0.16), new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8 }));
  board.position.y = BOARD_H / 2;
  board.userData.handle = true;
  group.add(board);
  const geo = new THREE.BoxGeometry(BL, BH, BW);
  j.meshes = [];
  for (let i = 0; i < LEVELS * 3; i++) {
    const tone = 0.82 + 0.18 * Math.abs(Math.sin(i * 12.9898) % 1);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0xe0b77c).multiplyScalar(tone), roughness: 0.75 }));
    group.add(m);
    j.meshes.push(m);
  }
}

function setMeshes(j, poses) {
  poses.forEach((p, i) => { j.meshes[i].position.set(p[0], p[1], p[2]); j.meshes[i].quaternion.set(p[3], p[4], p[5], p[6]); });
}

// The shared resting state (ours, someone else's, or a newcomer catching up).
function adopt(ctx, d, save = true) {
  const j = ctx.jenga;
  j.rest = d;
  j.moves = d.moves ?? 0;
  j.over = !!d.over;
  j.stream = null;
  setMeshes(j, d.b);
  if (save) ctx.state.set(`tower-${ctx.instance.id}`, j.room.rest).catch(() => {});
  updateStatus(ctx);
}

function nearTower(j, hands) {
  const scale = (hands.left ?? hands.right).scale;
  const top = BOARD_H + LEVELS * (BH + GAP) + 0.03;
  for (const h of [hands.left, hands.right]) {
    if (!h) continue;
    for (const k of [4, 9, 14]) {
      const p = h.joints[k];
      if (p.y > -0.02 && p.y < top + REACH_M * scale && Math.hypot(p.x, p.z) < BL / 2 + REACH_M * scale) return true;
    }
  }
  return false;
}

// ---- simulation (only on the device holding the lease) ------------------------------

function claim(ctx) {
  const j = ctx.jenga;
  if (j.room.mine && j.world) return true;
  if (!j.room.claim()) return false;
  startWorld(ctx);
  return true;
}

function startWorld(ctx) {
  const j = ctx.jenga;
  j.world?.free();
  const w = (j.world = new R.World({ x: 0, y: -9.81, z: 0 }));
  w.timestep = STEP;
  w.numSolverIterations = 8;
  w.integrationParameters.contact_natural_frequency = 240;   // stiff contacts: a default 18-level stack squashes ~4 cm
  const floor = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.05, 0));
  w.createCollider(R.ColliderDesc.cuboid(2, 0.05, 2).setFriction(0.6), floor);   // the table it stands on
  const board = w.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, BOARD_H / 2, 0));
  w.createCollider(R.ColliderDesc.cuboid(0.08, BOARD_H / 2, 0.08).setFriction(0.6), board);
  j.bodies = j.rest.b.map((p) => {
    const body = w.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p[0], p[1], p[2])
      .setRotation({ x: p[3], y: p[4], z: p[5], w: p[6] }).setSleeping(false).setLinearDamping(0.05).setAngularDamping(0.3));
    w.createCollider(R.ColliderDesc.cuboid(BL / 2, BH / 2, BW / 2).setDensity(650).setFriction(0.45).setRestitution(0), body);
    return body;
  });
  j.club = new HandBodies(R, w, THREE, { palm: false, tips: [4, 9, 14], tipR: 0.008 });
  j.startY = j.rest.b.map((p) => p[1]);
  j.topBefore = Math.max(...j.startY);
  j.moved = new Set();   // blocks the player handled (exempt from "fell")
  j.acc = 0;
  j.quietSince = 0;
  j.sess = { t0: performance.now(), frames: 0, steps: 0, ms: 0, maxMs: 0, maxSteps: 0, slow: 0, maxStepMs: 0 };   // (logged at settle)
}

// One touch of the tower, for the log: how hard the physics worked.
function sessionSummary(j) {
  const s = j.sess;
  return { s: +((performance.now() - s.t0) / 1000).toFixed(1), frames: s.frames, steps: s.steps, msPerFrame: +(s.ms / Math.max(1, s.frames)).toFixed(2),
    maxFrameMs: +s.maxMs.toFixed(1), maxStepMs: +s.maxStepMs.toFixed(2), maxSteps: s.maxSteps, framesOver11ms: s.slow };
}

// Hold block i: it's pulled toward a point on the input's ray (at the grab distance).
function grabBlock(ctx, i, ray, dist) {
  const j = ctx.jenga;
  const body = j.bodies[i];
  const r = ray();
  if (!r) return;
  const t = body.translation();
  const center = new THREE.Vector3(t.x, t.y, t.z);
  const grabAt = r.origin.clone().addScaledVector(r.dir, dist);
  j.held = { i, ray, dist, offset: center.sub(grabAt) };
  j.moved.add(i);
  body.wakeUp();
}

function drop(ctx) {
  const j = ctx.jenga;
  if (!j.held) return;
  j.bodies?.[j.held.i]?.wakeUp();
  j.held = null;
}

function simulate(ctx, dt, hands) {
  const j = ctx.jenga;
  j.acc = Math.min(j.acc + dt, 0.05);
  const n = Math.floor(j.acc / STEP);
  const t0 = performance.now();
  for (let k = 1; k <= n; k++) { pull(j); j.club.step(k / n); j.world.step(); }
  j.acc -= n * STEP;
  const ms = performance.now() - t0;
  j.lastSteps = n; j.lastStepsMs = ms;
  if (j.sess) {
    const s = j.sess;
    s.frames++; s.steps += n; s.ms += ms; s.maxMs = Math.max(s.maxMs, ms); s.maxSteps = Math.max(s.maxSteps, n);
    if (n) s.maxStepMs = Math.max(s.maxStepMs, ms / n);
    if (ms > 11) s.slow++;
  }
  const poses = j.bodies.map(pose);
  setMeshes(j, poses);
  const now = performance.now();
  if (!j.over && fallen(j, poses) >= FALLEN_TO_LOSE) {
    j.over = true;
    j.held = null;
    ctx.log(`the tower fell after ${j.moves} moves`);
  }
  // Settle once everything's still and nobody's touching.
  const still = j.bodies.every((b) => b.isSleeping() || speed(b) < STILL_SPEED);
  const touching = j.held || (hands && nearTower(j, hands));
  if (still && !touching) {
    j.quietSince ||= now;
    if (now - j.quietSince > SETTLE_MS) return settle(ctx);
  } else j.quietSince = 0;
  if (now - (j.sentAt ?? 0) >= STREAM_MS) {
    j.sentAt = now;
    const a = [];
    j.bodies.forEach((b, i) => { if (!b.isSleeping()) a.push([i, ...quant(poses[i])]); });
    if (a.length) j.room.stream({ a });
  }
  updateStatus(ctx);
}

function pull(j) {
  const h = j.held;
  if (!h) return;
  const r = h.ray();
  if (!r) return;
  const body = j.bodies[h.i];
  const t = body.translation();
  const want = r.origin.clone().addScaledVector(r.dir, h.dist).add(h.offset);
  const v = want.sub(new THREE.Vector3(t.x, t.y, t.z)).divideScalar(PULL_S);
  if (v.length() > PULL_MAX) v.setLength(PULL_MAX);
  body.setLinvel(v, true);
  const w = body.angvel();
  body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);   // keep it from spinning in the hand
}

const pose = (b) => { const t = b.translation(), q = b.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w]; };
const speed = (b) => { const v = b.linvel(); return Math.hypot(v.x, v.y, v.z); };

function fallen(j, poses) {
  let n = 0;
  poses.forEach((p, i) => { if (!j.moved.has(i) && j.startY[i] - p[1] > FALL_DROP) n++; });
  return n;
}

function settle(ctx) {
  const j = ctx.jenga;
  if (!j.world) return;
  const poses = j.bodies.map((b) => quant(pose(b)));
  // A handled block that ended up on top of the tower is a move.
  if (!j.over) for (const i of j.moved) if (poses[i][1] > j.topBefore + BH * 0.5) j.moves++;
  const d = { b: poses, moves: j.moves, over: j.over };
  if (j.sess?.frames) ctx.telemetry?.('jenga session', { ...sessionSummary(j), moves: j.moves, over: j.over });
  j.sess = null;
  j.world.free();
  j.world = null;
  j.held = null;
  j.room.settle(d);
  adopt(ctx, d);
}

function rebuild(ctx) {
  const j = ctx.jenga;
  if (!claim(ctx)) return ctx.log('someone else is touching the tower');
  j.rest = settledTower(ctx);
  j.over = false;
  j.moves = 0;
  startWorld(ctx);
  settle(ctx);
}

// Test hook: run the simulation now for s seconds (as the lease holder).
function simulateFor(ctx, s) {
  const j = ctx.jenga;
  if (!claim(ctx)) return null;
  for (const b of j.bodies) b.wakeUp();
  for (let t = 0; t < s; t += STEP) { pull(j); j.world.step(); }
  const poses = j.bodies.map(pose);
  setMeshes(j, poses);
  return { drift: Math.max(...poses.map((p, i) => Math.hypot(p[0] - j.rest.b[i][0], p[1] - j.rest.b[i][1], p[2] - j.rest.b[i][2]))), fallen: fallen(j, poses) };
}

// ---- watching ---------------------------------------------------------------------------

function watch(j, dt) {
  const s = j.stream;
  if (!s || !j.room.holder) return;
  const k = 1 - Math.exp(-dt / FOLLOW_S);
  for (const [i, x, y, z, qx, qy, qz, qw] of s.a) {
    const m = j.meshes[i];
    m.position.lerp(new THREE.Vector3(x, y, z), k);
    m.quaternion.slerp(new THREE.Quaternion(qx, qy, qz, qw), k);
  }
}

function updateStatus(ctx) {
  const j = ctx.jenga;
  const who = j.room.holder && !j.room.mine ? ' · someone is playing' : '';
  ctx.status(j.over ? `The tower fell! ${j.moves} moves · ↺ Rebuild to play again` : `Jenga · ${j.moves} moves${who}`);
}
