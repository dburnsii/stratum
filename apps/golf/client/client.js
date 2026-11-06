// Mini Golf (Stratum app). Course data + leaderboard come from the golf
// backend (through ctx.backend); the ball is simulated with Rapier.
// Course frame = instance frame: x right, y up, z toward the player, meters.
//
// Shared play, physics follows the player (ctx.sync lease, DESIGN.md §6.7):
// at rest the ball just sits where the shared resting state says. Whoever
// putts (swipe, tap, or reaches in with a hand on the Quest) claims the
// simulation and runs it on their own device, so a hand-swing hits with no
// network delay; everyone else watches their stream. When the ball stops,
// its spot (and strokes) becomes the new resting state and the lease is
// free. Whoever sinks it posts the score; the next hole is an event.
//
// Score: every stroke is counted for whoever hit it (ctx.player), on a
// scorecard everyone in the room shares; the leaderboard gets a score when
// one player played the whole hole. The "Next hole" button by the course
// (tap / pinch it, or poke it with a finger) moves everyone on.
//
// Moving obstacles (windmills, sliders) run off the shared clock, so they
// are in the same place on every device.
//
// Quest: your hand is the club: every finger bone and the palm, tested along
// the path they moved each frame (kit/handsweep.js), so a fast swing can't
// pass the little ball between frames. The hit is ours, not a physics
// contact: the ball takes (1 + HAND_E) × the struck part's speed along the
// contact normal. Or pinch on the green and drag, like a swipe.
import { HandSweep } from '/js/apps/kit/handsweep.js';

const BALL_R = 0.009;
const HOLE_R = 0.016;
const SINK_SPEED = 0.35;        // m/s: slower than this over the hole drops in
const REST_SPEED = 0.01;
const HIT_SPEED = 0.04;         // a resting ball moving faster than this was hit (a stroke)
const MIN_SHOT = 0.12, MAX_SHOT = 1.6;   // m/s
const STEP = 1 / 120;
const STREAM_MS = 66;
const FOLLOW_S = 0.06;          // watchers ease toward the stream
const REACH_M = 0.4;            // a hand this close to the ball claims the simulation (early: the first touch must be ours)
const HAND_E = 0.45;            // bounce off a hand: ball speed = (1 + e) × hand speed into it
const HAND_HIT_MS = 120;        // one hit per touch (the hand stays in contact a few frames)
const ATTEMPT_M = 0.06;         // a hand moving this close to the ball is an attempt (logged)
const LET_GO_MS = 900;          // ball at rest, hands away this long: settle and free the lease
const MAX_HAND_HIT = 2.2;       // m/s: a wild swing is capped
const POKE_M = 0.03;            // fingertip this close to the Next button presses it
const POST_BOUNCE = 0.9;

let THREE, R;

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    R = await ctx.physics();
    const g = (ctx.golf = {
      courses: (await ctx.backend.get('/courses')).courses,
      index: Math.max(0, (await ctx.state.get('hole').catch(() => 0)) ?? 0),
      strokes: 0, sunk: false, acc: 0, aim: null, board: [], card: {},   // card: player id → { n: name, h: { hole index: strokes } }
    });
    g.index %= g.courses.length;
    g.room = ctx.sync({
      onEvent: (e, by) => onEvent(ctx, e, by),
      onLease: (holder, mine) => { if (!mine) g.moving = !!holder; updateStatus(ctx); },
      onStream: (d) => { g.last = d; g.strokes = d.st; g.moving = true; },
      onRest: (d) => adoptRest(ctx, d),
      onHost: () => updateStatus(ctx),
    });
    buildPanel(ctx);
    ctx.settings?.onChange((key) => { if (key === 'board') g.panel.mesh.visible = ctx.settings.get('board') !== false; });
    g.panel.mesh.visible = ctx.settings?.get('board') !== false;
    await loadHole(ctx);
    window.__golf = { ctx, shoot: (vx, vz) => shoot(ctx, vx, vz), next: () => nextHole(ctx), go: (i) => g.room.event({ type: 'hole', index: i }), place: (x, z) => { g.room.claim(); placeBall(g, [x, z]); } };   // test hook
  },

  frame(ctx, dt) {
    const g = ctx.golf;
    if (!g?.world || g.loading) return;
    const hands = ctx.hands();
    moveObstacles(ctx, 0, 0);   // draw (the simulating device also moves their bodies per substep)
    pokeNext(ctx, hands);
    const p0 = g.ball.translation();
    const ballAt = new THREE.Vector3(p0.x, p0.y, p0.z);
    g.club.frame(hands, dt);
    trackAttempt(ctx, ballAt);
    // A hand reaching for the ball takes the simulation (if nobody else has it).
    if (!g.room.mine && hands && !g.sunk && g.club.near(ballAt) < REACH_M * (hands.left ?? hands.right).scale) {
      if (g.room.claim()) startSim(g);
    }
    if (!g.room.mine) return followFrame(g, dt);
    simulate(ctx, dt, hands);
  },

  // Swipe up the screen = putt away from you; longer/faster swipe = harder.
  swipe(ctx, s) {
    const g = ctx.golf;
    if (!g?.world || g.sunk || g.moving) return false;
    const v = ctx.viewer();
    if (!v) return false;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.quaternion).setY(0).normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion).setY(0).normalize();
    const dir = right.multiplyScalar(s.dx).add(fwd.multiplyScalar(-s.dy));
    const len = dir.length() / Math.min(s.w, s.h);
    if (len < 0.02) return true;
    dir.normalize();
    const speed = THREE.MathUtils.clamp(len * 2.2, MIN_SHOT, MAX_SHOT);
    if (s.phase === 'move') return showAim(g, dir, speed), true;
    hideAim(g);
    shoot(ctx, dir.x * speed, dir.z * speed);
    return true;
  },
  // Swipes anywhere on screen putt (unless they start on another app's content).
  globalSwipe: (ctx) => !!ctx.golf?.world && !ctx.golf.sunk && !ctx.golf.moving,

  // Tap the ball (or Quest trigger on it): medium putt along the tap ray.
  select(ctx, hit) {
    const g = ctx.golf;
    if (hit.object?.userData.golfNext) return nextHole(ctx);
    if (!g?.world || hit.object !== g.ballMesh || g.moving || g.sunk) return;
    const d = new THREE.Vector3(hit.ray.dir.x, 0, hit.ray.dir.z).normalize().multiplyScalar(0.5);
    shoot(ctx, d.x, d.z);
  },

  async stop(ctx) {
    const g = ctx.golf;
    clearTimeout(g?.nextTimer);
    if (g?.room?.mine) g.room.settle(restState(g));   // don't strand the ball mid-roll
    g?.world?.free();
    if (window.__golf?.ctx === ctx) delete window.__golf;
  },
};

// ---- simulation (only on the device holding the lease) ------------------------------

function startSim(g) {
  const r = g.room.rest?.d;
  if (r && r.i === g.index) placeBall(g, r.rest, r.p);
  g.acc = 0;
  g.quietSince = 0;
}

function simulate(ctx, dt, hands) {
  const g = ctx.golf;
  g.acc = Math.min(g.acc + dt, 0.1);
  const n = Math.floor(g.acc / STEP);
  if (!g.sunk) handHit(ctx);
  for (let k = 1; k <= n; k++) {
    moveObstacles(ctx, (n - k) * STEP, k);
    g.world.step();
    const v = g.ball.linvel(), sp = Math.hypot(v.x, v.z);
    if (sp > MAX_HAND_HIT) g.ball.setLinvel({ x: v.x / sp * MAX_HAND_HIT, y: v.y, z: v.z / sp * MAX_HAND_HIT }, true);
  }
  g.acc -= n * STEP;
  const p = g.ball.translation(), v = g.ball.linvel();
  g.ballMesh.position.set(p.x, p.y, p.z);
  const r = g.ball.rotation();
  g.ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
  const speed = Math.hypot(v.x, v.y, v.z);
  if (g.sunk) return;
  if (!g.moving && speed > HIT_SPEED) {   // hit by a hand (putts count themselves)
    g.moving = true;
    addStroke(ctx);
  }
  const toHole = Math.hypot(p.x - g.course.hole[0], p.z - g.course.hole[1]);
  if (toHole < HOLE_R && speed < SINK_SPEED && p.y < BALL_R * 2) return sink(ctx);
  if (p.y < -0.08) {   // off the table
    addStroke(ctx);
    placeBall(g, g.lastRest);
    ctx.log('out of bounds: +1 stroke');
  }
  if (speed < REST_SPEED && g.moving) {
    g.moving = false;
    g.lastRest = [p.x, p.z];
    g.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    g.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  const t = performance.now();
  const handNear = hands && g.club.near(new THREE.Vector3(p.x, p.y, p.z)) < REACH_M * (hands.left ?? hands.right).scale;
  if (!g.moving && !handNear) {
    g.quietSince ||= t;
    if (t - g.quietSince > (hands ? LET_GO_MS : 0)) { g.room.settle(restState(g)); updateStatus(ctx); return; }
  } else g.quietSince = 0;
  if (t - (g.sentAt ?? 0) >= STREAM_MS) {
    g.sentAt = t;
    const n4 = (x) => Math.round(x * 10000) / 10000;
    g.room.stream({ i: g.index, st: g.strokes, p: [n4(p.x), n4(p.y), n4(p.z)], q: [r.x, r.y, r.z, r.w].map(n4) });
  }
  updateStatus(ctx);
}

// The hand struck the ball this frame: bounce it off the part that hit,
// with that part's speed (a resting ball can't be "pushed through").
function handHit(ctx) {
  const g = ctx.golf, now = performance.now();
  if (now - (g.handHitAt ?? 0) < HAND_HIT_MS) return;
  const t = g.ball.translation(), center = new THREE.Vector3(t.x, t.y, t.z);
  const c = g.club.contact(center, BALL_R);
  if (!c) return;
  const n = new THREE.Vector3(c.normal.x, 0, c.normal.z);   // the ball rolls on the green: horizontal only
  if (n.lengthSq() < 0.04) return;                          // pressed from straight above: no shot
  n.normalize();
  const v = g.ball.linvel(), vb = new THREE.Vector3(v.x, 0, v.z);
  const into = c.velocity.dot(n), along = vb.dot(n);          // both in the course frame
  if (into <= along + 0.02) return;                         // not moving into it (resting a hand by it)
  const out = vb.addScaledVector(n, (1 + HAND_E) * (into - along));
  if (out.length() > MAX_HAND_HIT) out.setLength(MAX_HAND_HIT);
  g.ball.setLinvel({ x: out.x, y: 0, z: out.z }, true);
  g.ball.setAngvel({ x: out.z / BALL_R, y: 0, z: -out.x / BALL_R }, true);
  g.handHitAt = now;
  if (g.attempt) g.attempt.hit = true;
}

// Diagnostics: each time a moving hand comes near the ball, one telemetry
// line (closest approach, peak hand speed, hit or not, tracking jumps, fps).
function trackAttempt(ctx, ball) {
  const g = ctx.golf, now = performance.now();
  const d = g.club.near(ball) / g.club.scale, sp = g.club.speed();
  if (!g.attempt) {
    if (d < ATTEMPT_M && sp > 0.25 && !g.sunk) g.attempt = { t0: now, close: d, speed: sp, hit: false, jumps0: g.club.jumps, frames: 0, mine: g.room.mine };
    return;
  }
  const a = g.attempt;
  a.close = Math.min(a.close, d);
  a.speed = Math.max(a.speed, sp);
  a.frames++;
  if (d < ATTEMPT_M * 1.6 && now - a.t0 < 600) return;
  ctx.telemetry?.('golf attempt', { hit: a.hit, closeCm: +(a.close * 100).toFixed(1), speed: +a.speed.toFixed(2),
    jumps: g.club.jumps - a.jumps0, fps: Math.round(a.frames / Math.max(0.001, (now - a.t0) / 1000)), mine: a.mine });
  g.attempt = null;
}

function restState(g) {
  const p = g.ball.translation();
  return { i: g.index, st: g.strokes, sunk: g.sunk, rest: g.lastRest, p: [p.x, p.y, p.z], card: g.card };
}

// One stroke, for whoever is playing on this device.
function addStroke(ctx) {
  const g = ctx.golf, me = ctx.player();
  g.strokes++;
  g.lastPutter = ctx.me();
  const row = (g.card[me.id] ??= { n: me.name, h: {} });
  row.n = me.name;
  row.h[g.index] = (row.h[g.index] ?? 0) + 1;
  drawPanel(ctx);
}

// Everyone: the ball came to rest somewhere (someone else's shot, or a newcomer catching up).
function adoptRest(ctx, d) {
  const g = ctx.golf;
  if (!g?.world) return;
  if (d.i !== g.index) {   // they're on another hole
    if (g.loading) return;
    g.index = d.i;
    ctx.state.set('hole', g.index).catch(() => {});
    loadHole(ctx).then(() => adoptRest(ctx, d));
    return;
  }
  g.strokes = d.st;
  g.sunk = !!d.sunk;
  if (d.card) { g.card = d.card; drawPanel(ctx); }
  g.moving = false;
  g.lastRest = d.rest;
  g.last = { p: d.p, q: [0, 0, 0, 1] };
  placeBall(g, d.rest, d.p);
  updateStatus(ctx);
}

// ---- holes -----------------------------------------------------------------------

async function loadHole(ctx) {
  const g = ctx.golf;
  const id = g.courses[g.index].id;
  g.loading = true;
  g.course = await ctx.backend.get(`/courses/${id}`).finally(() => { g.loading = false; });
  g.world?.free();
  g.group?.removeFromParent();
  g.group = new THREE.Group();
  ctx.spawn(g.group);
  const c = g.course;
  const [x0, z0, x1, z1] = c.bounds;

  // Physics world in course units.
  g.world = new R.World({ x: 0, y: -9.81, z: 0 });
  g.world.timestep = STEP;
  const fixed = (x, y, z, hx, hy, hz, friction = 0.8, restitution = 0.2) => {
    const body = g.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
    g.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(restitution), body);
  };
  fixed((x0 + x1) / 2, -0.005, (z0 + z1) / 2, (x1 - x0) / 2, 0.005, (z1 - z0) / 2, 0.9, 0.1);   // green

  // Green.
  const green = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.006, z1 - z0),
    new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 0.95 }));
  green.position.set((x0 + x1) / 2, -0.003, (z0 + z1) / 2);
  g.group.add(green);

  // Walls (segments → thin boxes) and blocks.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf1e3c6, roughness: 0.6 });
  const h = c.wallHeight, t = 0.008;
  for (const [ax, az, bx, bz] of c.walls) {
    const len = Math.hypot(bx - ax, bz - az) + t;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, ang = Math.atan2(bz - az, bx - ax);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), wallMat);
    mesh.position.set(mx, h / 2, mz);
    mesh.rotation.y = -ang;
    g.group.add(mesh);
    const body = g.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(mx, h / 2, mz)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang)));
    g.world.createCollider(R.ColliderDesc.cuboid(len / 2, h / 2, t / 2).setRestitution(0.6).setFriction(0.2), body);
  }
  for (const b of c.blocks) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: 0xd9480f }));
    mesh.position.set(b.x, b.h / 2, b.z);
    g.group.add(mesh);
    fixed(b.x, b.h / 2, b.z, b.w / 2, b.h / 2, b.d / 2, 0.3, 0.5);
  }

  // Moving obstacles + bumpers.
  g.movers = [];
  const red = new THREE.MeshStandardMaterial({ color: 0xd9480f, roughness: 0.5 });
  for (const sp of c.spinners) {   // windmill: two crossed blades turning about z
    const hub = new THREE.Group();
    hub.position.set(sp.x, sp.y, sp.z);
    for (const a of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(sp.len, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.5 }));
      blade.rotation.z = a;
      hub.add(blade);
    }
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.05, sp.y + 0.02, 0.03), red);
    house.position.set(sp.x, (sp.y + 0.02) / 2 + 0.025, sp.z - 0.03);
    g.group.add(hub, house);
    const body = g.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(sp.x, sp.y, sp.z));
    for (const a of [0, Math.PI / 2]) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      g.world.createCollider(R.ColliderDesc.cuboid(sp.len / 2, 0.006, 0.006).setRotation(q).setRestitution(0.5), body);
    }
    g.movers.push({ body, mesh: hub, at: (t) => ({ p: [sp.x, sp.y, sp.z], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -2 * Math.PI * t / sp.period) }) });
  }
  for (const sl of c.sliders) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sl.w, sl.h, sl.d), new THREE.MeshStandardMaterial({ color: 0x4dabf7, roughness: 0.4 }));
    g.group.add(mesh);
    const body = g.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(sl.x, sl.h / 2, sl.z));
    g.world.createCollider(R.ColliderDesc.cuboid(sl.w / 2, sl.h / 2, sl.d / 2).setRestitution(0.6).setFriction(0.2), body);
    const off = (t) => sl.range * Math.sin(2 * Math.PI * t / sl.period + (sl.phase ?? 0));
    g.movers.push({ body, mesh, at: (t) => ({ p: sl.axis === 'z' ? [sl.x, sl.h / 2, sl.z + off(t)] : [sl.x + off(t), sl.h / 2, sl.z], q: new THREE.Quaternion() }) });
  }
  for (const po of c.posts) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(po.r, po.r, c.wallHeight, 20),
      new THREE.MeshStandardMaterial({ color: 0xfab005, emissive: 0x5c3d00, roughness: 0.35 }));
    mesh.position.set(po.x, c.wallHeight / 2, po.z);
    g.group.add(mesh);
    const body = g.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(po.x, c.wallHeight / 2, po.z));
    g.world.createCollider(R.ColliderDesc.cylinder(c.wallHeight / 2, po.r).setRestitution(POST_BOUNCE).setFriction(0.1), body);
  }
  moveObstacles(ctx, 0, 0, true);

  // The Next hole button, by the near right corner.
  buildNextButton(ctx);

  // Hole + flag.
  const cup = new THREE.Mesh(new THREE.CircleGeometry(HOLE_R, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0b0b0b }));
  cup.position.set(c.hole[0], 0.0006, c.hole[1]);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 0.09), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  pole.position.set(c.hole[0], 0.045, c.hole[1]);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.018), new THREE.MeshStandardMaterial({ color: 0xff3b30, side: THREE.DoubleSide }));
  flag.position.set(c.hole[0] + 0.015, 0.08, c.hole[1]);
  g.group.add(cup, pole, flag);

  // Tee marker + ball.
  const tee = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9be29b }));
  tee.position.set(c.tee[0], 0.0005, c.tee[1]);
  g.group.add(tee);
  g.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  g.group.add(g.ballMesh);
  g.ball = g.world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.9).setAngularDamping(1.5));
  g.world.createCollider(R.ColliderDesc.ball(BALL_R).setDensity(1100).setFriction(0.6).setRestitution(0.35), g.ball);
  placeBall(g, c.tee);
  g.ballMesh.position.set(c.tee[0], BALL_R, c.tee[1]);
  g.club ??= new HandSweep(THREE);
  g.last = null;
  g.followed = false;
  g.lastRest = c.tee;
  g.strokes = 0;
  g.sunk = false;
  g.moving = false;
  g.board = (await ctx.backend.get(`/leaderboard/${c.id}`).catch(() => ({ leaderboard: [] }))).leaderboard;
  drawPanel(ctx);
  ctx.actions([
    { label: '↺ Reset', run: () => resetBall(ctx) },
    { label: '⏭ Next hole', run: () => g.room.event({ type: 'hole', index: (g.index + 1) % g.courses.length }) },
  ]);
  // A new hole starts at the tee (a resting state from another hole doesn't apply).
  if (g.room.rest?.d?.i !== g.index) g.room.rest = { rev: g.room.rest?.rev ?? 0, d: restState(g) };
  updateStatus(ctx);
}

function placeBall(g, [x, z], at = null) {
  g.ball.setTranslation(at ? { x: at[0], y: Math.max(at[1], BALL_R + 0.0005), z: at[2] } : { x, y: BALL_R + 0.0005, z }, true);
  g.ballMesh.position.set(at ? at[0] : x, at ? Math.max(at[1], BALL_R) : BALL_R, at ? at[2] : z);
  g.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  g.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  g.moving = false;
}

// A putt: take the simulation and hit the ball right here.
function shoot(ctx, vx, vz) {
  const g = ctx.golf;
  if (!g?.world || g.sunk || g.moving || g.loading) return;
  if (!g.room.mine) {
    if (!g.room.claim()) return ctx.log('someone else is playing the ball');
    startSim(g);
  }
  g.ball.setLinvel({ x: clampShot(vx), y: 0, z: clampShot(vz) }, true);
  g.moving = true;
  addStroke(ctx);
  updateStatus(ctx);
}

function resetBall(ctx) {
  const g = ctx.golf;
  if (g.sunk || !g.room.claim()) return;
  startSim(g);
  placeBall(g, g.lastRest);
}

function onEvent(ctx, e, by) {
  const g = ctx.golf;
  if (!g?.world) return;
  if (e.type === 'sunk') {
    announceSunk(ctx, e, by);
  } else if (e.type === 'hole') {
    clearTimeout(g.nextTimer);
    if (e.index === g.index && !g.sunk) return;
    if (e.index % g.courses.length === 0) g.card = {};   // back to hole 1: a new round
    g.index = e.index % g.courses.length;
    ctx.state.set('hole', g.index).catch(() => {});
    loadHole(ctx);
  }
}

const clampShot = (v) => THREE.MathUtils.clamp(Number(v) || 0, -MAX_SHOT, MAX_SHOT);

// Host only: the ball dropped in.
function sink(ctx) {
  const g = ctx.golf;
  g.sunk = true;
  g.moving = false;
  g.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  g.ball.setTranslation({ x: g.course.hole[0], y: -0.03, z: g.course.hole[1] }, true);
  g.ball.setBodyType(R.RigidBodyType.Fixed, true);
  g.room.settle(restState(g));
  g.room.event({ type: 'sunk', strokes: g.strokes, putter: g.lastPutter ?? ctx.me(), hole: g.index, card: g.card });
  // No automatic next hole: anyone presses the Next button when the room's ready.
}

// Everyone: show the result. The leaderboard gets it when one player played
// the whole hole (theirs alone); shared holes stay on the room's scorecard.
async function announceSunk(ctx, e) {
  const g = ctx.golf;
  if (e.hole !== g.index) return;
  g.sunk = true;
  if (e.card) g.card = e.card;
  drawPanel(ctx);
  const { par } = g.course;
  const word = e.strokes === 1 ? 'Hole in one!' : e.strokes < par ? 'Birdie!' : e.strokes === par ? 'Par' : `+${e.strokes - par}`;
  ctx.status(`${g.course.name}: ${word} (${e.strokes}) · press Next hole ▶`);
  const players = Object.entries(g.card).filter(([, r]) => r.h[g.index]);
  if (e.putter !== ctx.me() || players.length !== 1 || players[0][0] !== ctx.player().id) return;
  try {
    g.board = (await ctx.backend.post('/scores', { course: g.course.id, strokes: e.strokes })).leaderboard;
    drawPanel(ctx);
  } catch (err) {
    ctx.log(`could not save score: ${err.message}`);
  }
}

// Moving obstacles at shared time (now - back seconds). k = substep (0: draw
// only); first: put them there outright (no sweep from the last spot).
function moveObstacles(ctx, back, k, first = false) {
  const g = ctx.golf;
  if (!g.movers?.length) return;
  const t = ctx.now() / 1000 - back;
  for (const m of g.movers) {
    const { p, q } = m.at(t);
    if (first) { m.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true); m.body.setRotation(q, true); }
    else if (k) { m.body.setNextKinematicTranslation({ x: p[0], y: p[1], z: p[2] }); m.body.setNextKinematicRotation(q); }
    if (!k || first) { m.mesh.position.set(...p); m.mesh.quaternion.copy(q); }
  }
}

// ---- next hole button --------------------------------------------------------------

function buildNextButton(ctx) {
  const g = ctx.golf, [, , x1, z1] = g.course.bounds;
  const btn = new THREE.Group();
  btn.position.set(x1 + 0.06, 0, z1 - 0.04);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 0.6 }));
  post.position.y = 0.025;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 24), new THREE.MeshStandardMaterial({ color: 0x40c057, emissive: 0x0b3d17, roughness: 0.4 }));
  cap.position.y = 0.055;
  const canvas = Object.assign(document.createElement('canvas'), { width: 256, height: 96 });
  const c2 = canvas.getContext('2d');
  c2.fillStyle = 'rgba(10,14,20,0.85)'; c2.beginPath(); c2.roundRect(0, 0, 256, 96, 20); c2.fill();
  c2.fillStyle = '#fff'; c2.font = '600 40px system-ui, sans-serif'; c2.textAlign = 'center';
  c2.fillText('Next hole ▶', 128, 62);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.03), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  label.position.y = 0.085;
  for (const m of [post, cap, label]) m.userData.golfNext = true;
  btn.add(post, cap, label);
  g.group.add(btn);
  g.next = { btn, cap, label, pressedAt: 0 };
}

function nextHole(ctx) {
  const g = ctx.golf;
  if (!g?.course || g.loading) return;
  const now = performance.now();
  if (now - (g.next?.pressedAt ?? 0) < 1200) return;   // one press, one hole
  g.next.pressedAt = now;
  g.next.cap.position.y = 0.05;
  setTimeout(() => { if (g.next) g.next.cap.position.y = 0.055; }, 200);
  g.room.event({ type: 'hole', index: (g.index + 1) % g.courses.length });
}

// A fingertip pushing the button's cap presses it.
function pokeNext(ctx, hands) {
  const g = ctx.golf;
  if (!g.next) return;
  const v = ctx.viewer();
  if (v) g.next.label.lookAt(v.position);   // the sign turns to whoever's looking
  if (!hands) return glowNext(g);
  const cap = g.next.cap.getWorldPosition(new THREE.Vector3());
  const local = ctx.toLocal(cap);
  for (const h of [hands.left, hands.right]) {
    if (h && h.joints[9].distanceTo(local) < POKE_M * h.scale) return nextHole(ctx);
  }
  glowNext(g);
}

// The cap pulses once the hole's done (time to move on).
function glowNext(g) {
  g.next.cap.material.emissiveIntensity = g.sunk ? 1.5 + Math.sin(performance.now() / 150) : 1;
}

// ---- watching someone else's shot ----------------------------------------------------

function followFrame(g, dt) {
  const st = g.last;
  if (!st) return;
  const k = 1 - Math.exp(-dt / FOLLOW_S);
  g.ballMesh.position.lerp(new THREE.Vector3(...st.p), k);
  g.ballMesh.quaternion.slerp(new THREE.Quaternion(...st.q), k);
}

function updateStatus(ctx) {
  const g = ctx.golf;
  if (g.sunk || !g.course) return;
  const others = g.room.holder && !g.room.mine ? ' · someone is putting' : g.room.peers > 1 ? ` · ${g.room.peers} playing` : '';
  ctx.status(`${g.course.name} · par ${g.course.par} · strokes ${g.strokes}${others}`);
}

// ---- aim line + leaderboard panel ------------------------------------------------

function showAim(g, dir, speed) {
  if (!g.aimLine) {
    g.aimLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xffffff }));
    g.group.add(g.aimLine);
  }
  const p = g.ball.translation();
  const len = 0.03 + (speed / MAX_SHOT) * 0.15;
  g.aimLine.geometry.setFromPoints([new THREE.Vector3(p.x, BALL_R, p.z), new THREE.Vector3(p.x + dir.x * len, BALL_R, p.z + dir.z * len)]);
  g.aimLine.material.color.setHSL(0.33 - (speed / MAX_SHOT) * 0.33, 1, 0.55);
  g.aimLine.visible = true;
}

function hideAim(g) { if (g.aimLine) g.aimLine.visible = false; }

function buildPanel(ctx) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 320 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  ctx.golf.panel = { canvas, tex, mesh };
  ctx.spawn(mesh);
}

function drawPanel(ctx) {
  const g = ctx.golf;
  if (!g.panel || !g.course) return;
  const { canvas, tex, mesh } = g.panel;
  const c = g.course;
  mesh.position.set(0, 0.12, c.bounds[1] - 0.02);   // behind the far end, facing the player
  const g2 = canvas.getContext('2d');
  g2.clearRect(0, 0, canvas.width, canvas.height);
  g2.fillStyle = 'rgba(10,14,20,0.82)';
  g2.beginPath(); g2.roundRect(0, 0, canvas.width, canvas.height, 28); g2.fill();
  g2.fillStyle = '#fff';
  g2.font = '600 32px system-ui, sans-serif';
  g2.fillText(`⛳ ${g.index + 1}/${g.courses.length} ${c.name} · par ${c.par}`, 24, 46);
  // Scorecard: this hole · round total, per player.
  const rows = Object.entries(g.card).map(([id, r]) => ({ me: id === ctx.player().id, n: r.n,
    hole: r.h[g.index] ?? 0, total: Object.values(r.h).reduce((a, b) => a + b, 0) })).sort((a, b) => a.total - b.total);
  g2.font = '24px system-ui, sans-serif';
  g2.fillStyle = '#9aa1b2';
  g2.fillText('Player', 24, 84); g2.fillText('hole', 330, 84); g2.fillText('round', 410, 84);
  if (!rows.length) g2.fillText('No strokes yet: tee off!', 24, 120);
  rows.slice(0, 4).forEach((r, i) => {
    g2.fillStyle = r.me ? '#ffd23f' : '#e9ecef';
    g2.fillText(`${r.n}${r.me ? ' (you)' : ''}`.slice(0, 22), 24, 120 + i * 32);
    g2.fillText(String(r.hole), 340, 120 + i * 32);
    g2.fillText(String(r.total), 425, 120 + i * 32);
  });
  // Best ever on this hole.
  const best = g.board[0];
  g2.fillStyle = '#9aa1b2';
  g2.fillText(best ? `Best: ${best.player} · ${best.best}` : 'Best: nobody yet', 24, canvas.height - 22);
  tex.needsUpdate = true;
}
