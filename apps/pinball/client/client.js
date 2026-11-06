// Pinball (Stratum app). A classic machine (painted cabinet, chrome legs and
// rails, lit backbox with score reels, inserts, chimes) simulated with Rapier,
// shared by everyone in the space like an arcade cabinet: physics follows the
// player (ctx.sync lease, DESIGN.md §6.7). Whoever presses first plays; their
// device runs the physics (flippers with no network delay) and streams the
// ball, flippers, lamps and score; everyone else watches. Game over (or a game
// left idle) frees the machine and puts the score on the shared high-score
// board. Your own best is also kept per user.
//
// Rules (on the apron cards):
//   top lanes A-B-C: 50 + bonus; all three → advance the bonus multiplier (2×, 3×, 5×)
//   flippers move the lit lanes (lane change)
//   drop targets: 250 + bonus each; all three → 2500 and light the spinner
//   (spinner already lit → light EXTRA BALL at the saucer)
//   spinner: 10 a turn, 100 when lit · pop bumpers 100 · slingshots 10
//   saucer: 1000 + 2 bonus, collects the extra ball when lit
//   bonus: 1000 × multiplier per step, counted at the end of each ball
//   ball save for the first seconds of each ball · match at game over
//
// Table frame: x right, z toward the player, y up off the playfield, meters.
// The playfield group is tilted (far end up); physics runs in the flat
// table frame with gravity tilted to match, so the ball rolls toward you.
//
// Controls (ctx press, DESIGN.md §6):
//   Quest hands: the real machine's parts. Pinch the plunger knob (point at
//     it, or pinch it directly) and pull it toward you, let go to launch
//     (how far = how hard). Poke the red buttons on the cabinet sides (or
//     pinch / point at them) for the flippers. Everywhere else on the machine
//     is the host's: pinch-hold moves it.
//   Quest controllers: triggers flip from anywhere near the table; the
//     plunger as above, or any trigger held while the ball is in the lane.
//   Phone: left / right half of the screen; in the lane, hold and let go.
import { mergeStatic } from '/js/apps/kit/lod.js';

const W = 0.36, L = 0.62;                 // playfield width, length
const X0 = -W / 2, X1 = W / 2, Z0 = -L / 2, Z1 = L / 2;
const TILT = THREE_DEG(6.5);
const BALL_R = 0.0105;
const WALL_H = 0.035, WALL_T = 0.01;
const LANE_X = X1 - 0.042;                // shooter lane wall (lane is right of it)
const PLUNGER_Z = Z1 - 0.035;
// Tips at rest leave a ~2.7 cm gap (the ball is 2.1 cm): a ball dead center drains, like a real machine.
const FLIP = { len: 0.06, w: 0.016, pivotX: 0.076, pivotZ: Z1 - 0.1, rest: THREE_DEG(-28), up: THREE_DEG(26), speed: 28 };
const BUMPERS = [[-0.06, -0.15], [0.05, -0.17], [-0.005, -0.08]];
const BUMPER_COLORS = [0xff922b, 0x4dabf7, 0x69db7c];
const BUMPER_R = 0.022, BUMPER_KICK = 1.0, BUMPER_POINTS = 100;
const SLING_POINTS = 10, SLING_KICK = 0.7, LANE_POINTS = 500;
const LANES_X = [-0.06, 0, 0.06], LANES_Z = Z0 + 0.08;
const ORBIT_X = X0 + 0.045;               // left orbit lane (the spinner's), from the left wall to here
const SPIN_Z = -0.13;
const DROPS = { x: 0.126, z: [-0.035, -0.008, 0.019], hz: 0.012, hx: 0.004 };
const SAUCER = { x: -0.1, z: 0.0, r: 0.013, hold: 1200 };
const BONUS_MAX = 10, MULTS = [1, 2, 3, 5];
const BALL_SAVE_MS = 6000;
const BALLS = 3;
const LAUNCH_MIN = 1.3, LAUNCH_MAX = 2.4, CHARGE_MS = 900;
const STEP = 1 / 240;
const NEAR_M = 2.5;                       // presses anywhere count while you're this close
const STREAM_MS = 33;
const IDLE_MS = 30000;                    // a game nobody touches this long gives the machine back
const FOLLOW_S = 0.03;
const TOP_N = 5;
const PANEL_MS = 100;
const PULL_M = 0.06;                      // pulling the plunger knob this far = full power
const KNOB_REACH = 0.045, BUTTON_REACH = 0.02;   // a pinch this close takes the knob; a fingertip this close presses a button
// Flex to flip: a hand resting by a side button (palm within FLEX_REACH)
// curls its fingers in = that button held. Two distinct moves, so a held
// flip stays held: curl in (smoothed straightness below FLEX_IN) to press;
// to let go, straighten clearly (above FLEX_OUT) for FLEX_OUT_MS, or take
// the hand away (beyond FLEX_KEEP_REACH, or out of tracking for FLEX_LOST_MS).
// Straightness 1 = straight out, ≤ 0 curled into the palm.
const FLEX_REACH = 0.12, FLEX_KEEP_REACH = 0.22, FLEX_IN = 0.45, FLEX_OUT = 0.75;
const FLEX_OUT_MS = 120, FLEX_LOST_MS = 250, FLEX_SMOOTH_S = 0.05;
const BUTTON_R = 0.011;                     // score glass redraws at most this often
// Cabinet (drawn only; physics is the playfield).
const PF_Y = 0.1;                         // playfield front edge above the cabinet bottom
const LEGS = { short: 0.035, tall: 0.33 };
const CAB = { side: 0.014, front: Z1 + 0.025, back: Z0 - 0.025 };

function THREE_DEG(d) { return d * Math.PI / 180; }

let THREE, R;

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    R = await ctx.physics();
    const clock = ctx.sim({ step: STEP, maxSteps: 12, idleMs: 800 });
    const p = (ctx.pinball = { clock,
      score: 0, balls: BALLS, best: Number(await ctx.state.get('best').catch(() => 0)) || 0,
      acc: 0, held: { left: false, right: false }, angle: { left: FLIP.rest, right: FLIP.rest },
      charging: null, inLane: true, over: false, cool: new Map(), kicked: [], slung: [], lastPress: 0,
      show: freshShow(), saveUntil: 0, saveArmed: false, counting: false,
      spin: { a: 0, w: 0 }, saucer: { until: 0, free: 0 }, match: null,
      legs: (await ctx.state.get('legs').catch(() => null)) === 'tall' ? 'tall' : 'short',
      flipIn: { left: false, right: false },                        // phone halves / controller triggers
      btn: { left: { ray: false, poke: false }, right: { ray: false, poke: false } },   // the cabinet buttons
      pull: null, pinched: { left: false, right: false }, flex: { left: false, right: false }, flexSt: {}, flexOutAt: {}, flexLostAt: {},
    });
    build(ctx);
    resetBall(p);
    p.top = [];
    p.over = true;   // nobody's playing until someone presses
    p.room = ctx.sync({
      onLease: (holder, mine) => { if (!mine && !holder) p.watching = null; updateStatus(ctx); drawPanel(ctx); },
      onStream: (d) => {
        if (p.watching && d.s > p.watching.s) chimeFor(d.s - p.watching.s);
        p.watching = d;
      },
      onRest: (d) => { p.top = d.top ?? []; p.last = d.last ?? null; p.watching = null; updateStatus(ctx); drawPanel(ctx); },
    });
    p.room.seed({ top: [] });
    updateStatus(ctx);
    drawPanel(ctx);
    setActions(ctx);
    window.__pinball = { ctx, press: (side, phase) => this.press(ctx, { side, phase }), launch: (f) => launch(ctx, f),
      place: (x, z, vx = 0, vz = 0) => placeBall(p, x, z, vx, vz),
      step: (n = 1) => { for (let i = 0; i < n; i++) step(ctx); } };   // test hooks
  },

  frame(ctx, dt) {
    const p = ctx.pinball;
    if (!p?.world) return;
    const now = performance.now();
    if (p.panelDirty && now - (p.panelAt ?? 0) >= PANEL_MS) paintPanel(ctx);
    touchParts(ctx);
    if (!p.room.mine) return watch(ctx, dt);
    if (now - p.lastPress > IDLE_MS && p.inLane && !p.charging && !p.counting) return endGame(ctx, 'idle');
    // Physics only while the ball's in play or someone's at the controls (a ball waiting in the lane sleeps).
    const bv = p.ball.linvel();
    const busy = !p.inLane || Math.hypot(bv.x, bv.z) > 0.003 || !!p.charging || !!p.pull || p.held.left || p.held.right || !!p.counting
      || p.angle.left !== FLIP.rest || p.angle.right !== FLIP.rest || Math.abs(p.spin.w) > 1e-3 || now < p.saucer.until;
    p.clock.tick(dt, () => step(ctx), { busy });
    const t = p.ball.translation();
    p.ballMesh.position.set(t.x, t.y, t.z);
    const pull = p.pull ? p.pull.amt : p.charging ? Math.min(1, (now - p.charging) / CHARGE_MS) : 0;
    const view = { f: [p.angle.left, p.angle.right], pl: pull, w: liveShow(p), sp: p.spin.a, h: [p.held.left, p.held.right] };
    paint(ctx, dt, view);
    if (now - (p.sentAt ?? 0) >= STREAM_MS) {
      p.sentAt = now;
      const r = (x) => Math.round(x * 1e4) / 1e4;
      p.room.stream({ b: [r(t.x), r(t.y), r(t.z)], f: view.f.map(r), pl: r(pull), s: p.score, n: p.balls, h: view.h,
        k: p.kicked.splice(0), sk: p.slung.splice(0), w: view.w, sp: r(p.spin.a), who: ctx.player().name });
    }
  },

  press(ctx, e) {
    const p = ctx.pinball;
    if (!p?.world) return false;
    const down = e.phase === 'down';
    const part = e.object ? partOf(e.object) : null;
    const hand = e.side === 'left' ? 'left' : 'right';   // which input (one per hand / screen half)
    // Up: whatever this input's down started.
    if (!down) {
      if (p.pull?.by === 'ray' && p.pull.side === hand) releasePull(ctx);
      for (const b of ['left', 'right']) if (p.btn[b].ray === hand) p.btn[b].ray = false;
      p.flipIn[hand] = false;
      if (p.charging) launch(ctx, Math.min(1, (performance.now() - p.charging) / CHARGE_MS));
      syncHeld(p);
      return true;
    }
    wakeAudio();
    // Hands play the machine's own parts; anywhere else is the host's (move it).
    if (e.source === 'hand' && !part) return false;
    if (!begin(ctx)) return true;
    if (part === 'plunger') {
      const r = e.ray?.();
      p.pull = { by: 'ray', side: hand, ray: e.ray, z0: r?.origin.z ?? 0, amt: 0 };
      return true;
    }
    if (part === 'left' || part === 'right') {
      p.btn[part].ray = hand;
      syncHeld(p);
      return true;
    }
    if (p.inLane) {   // phone / controller anywhere: hold to pull, let go to launch
      if (!p.charging && !p.counting) p.charging = performance.now();
      return true;
    }
    p.flipIn[hand] = true;
    syncHeld(p);
    return true;
  },
  // Phone taps and controller triggers near the table flip (not only on it);
  // hands use the machine's buttons.
  globalPress(ctx, g) {
    const p = ctx.pinball, v = ctx.viewer();
    if (!p?.world || !v || g?.source === 'hand') return false;
    if (p.room.holder && !p.room.mine) return false;   // someone else's game: your taps stay yours
    return ctx.toLocal(v.position.clone()).length() < NEAR_M;
  },
  // Only the plunger and the flipper buttons keep a hold for the game (and
  // nothing moves while you're holding them); the rest of the machine moves
  // like anything else.
  grab(ctx, e) {
    const p = ctx.pinball;
    if (partOf(e.object) || p?.pull || p?.btn.left.poke || p?.btn.right.poke) e.preventDefault();
  },

  async stop(ctx) {
    if (ctx.pinball?.room?.mine) endGame(ctx, 'left');
    ctx.pinball?.world?.free();
    if (ctx.pinball) ctx.pinball.world = null;
    if (window.__pinball?.ctx === ctx) delete window.__pinball;
  },
};

function setActions(ctx) {
  const p = ctx.pinball;
  ctx.actions([
    { label: '↺ New game', run: () => { if (p.room.mine || p.room.claim()) newGame(ctx); } },
    { label: p.legs === 'tall' ? '▾ Short legs (table)' : '▴ Tall legs (floor)', run: () => {
      p.legs = p.legs === 'tall' ? 'short' : 'tall';
      setLegs(p);
      ctx.state.set('legs', p.legs).catch(() => {});
      setActions(ctx);
    } },
  ]);
}

// ---- the machine's parts: plunger + flipper buttons ------------------------------

// 'plunger' | 'left' | 'right' | null for something hit on the machine.
function partOf(node) {
  for (let n = node; n; n = n.parent) if (n.userData?.part) return n.userData.part;
  return null;
}

// Start (or join) a game if the machine is free; false if someone else is playing.
function begin(ctx) {
  const p = ctx.pinball;
  if (!p.room.mine) {
    if (!p.room.claim()) { ctx.log(`${p.watching?.who ?? 'someone'} is playing`); return false; }
    newGame(ctx);
  }
  p.lastPress = performance.now();
  p.clock.wake();
  return true;
}

// The flippers follow every input that holds them; a new press changes lanes.
function syncHeld(p) {
  for (const side of ['left', 'right']) {
    const on = !!(p.flipIn[side] || p.btn[side].ray || p.btn[side].poke);
    if (on && !p.held[side]) { thunk(); laneChange(p, side); }
    p.held[side] = on;
  }
}

function releasePull(ctx) {
  const p = ctx.pinball, amt = p.pull?.amt ?? 0;
  p.pull = null;
  if (p.room.mine && p.inLane && amt > 0.05) launch(ctx, amt);   // let go of a pulled plunger: the spring fires
}

function localPos(ctx, obj) {
  obj.updateWorldMatrix(true, false);
  return ctx.toLocal(obj.getWorldPosition(new THREE.Vector3()));
}

// Every frame: hands on the plunger (pinch it, pull toward you) and fingers
// on the buttons (poke), plus a pointed-at plunger being pulled.
// Mean straightness of the four fingers (1 straight out, ≤ 0 curled into the palm).
function fingerStraightness(j) {
  let sum = 0;
  for (let f = 0; f < 4; f++) {
    const b = 5 + f * 5;
    sum += j[b + 1].clone().sub(j[b]).normalize().dot(j[b + 4].clone().sub(j[b + 1]).normalize());
  }
  return sum / 4;
}

function touchParts(ctx) {
  const p = ctx.pinball, hands = ctx.hands?.();
  if (p.pull?.by === 'ray') {
    const r = p.pull.ray?.();
    if (r) p.pull.amt = THREE.MathUtils.clamp((r.origin.z - p.pull.z0) / PULL_M, 0, 1);
  }
  const knob = localPos(ctx, p.knobGrip), buttons = { left: localPos(ctx, p.buttons.left), right: localPos(ctx, p.buttons.right) };
  const poke = { left: false, right: false };
  for (const side of ['left', 'right']) {
    const h = hands?.[side];
    const was = p.pinched[side];
    const pinched = h ? h.pinch < (was ? 0.04 : 0.022) : false;
    p.pinched[side] = pinched;
    const now = performance.now();
    if (!h) {   // lost: a held flip survives a short tracking gap
      if (p.flex[side] && now - (p.flexLostAt[side] ??= now) < FLEX_LOST_MS) poke[p.flex[side]] = true;
      else { p.flex[side] = false; p.flexSt[side] = null; }
      if (p.pull?.by === 'hand' && p.pull.side === side) releasePull(ctx);
      continue;
    }
    p.flexLostAt[side] = null;
    const pt = h.joints[4].clone().add(h.joints[9]).multiplyScalar(0.5);
    if (pinched && !was && !p.pull && pt.distanceTo(knob) < KNOB_REACH && begin(ctx)) p.pull = { by: 'hand', side, z0: pt.z, amt: 0 };
    if (p.pull?.by === 'hand' && p.pull.side === side) {
      if (pinched) p.pull.amt = THREE.MathUtils.clamp((pt.z - p.pull.z0) / PULL_M, 0, 1);
      else releasePull(ctx);
    }
    // Flex: the hand by a button (whichever is nearer), fingers curled in.
    const palm = h.joints[0].clone().add(h.joints[10]).multiplyScalar(0.5);
    const near = ['left', 'right'].map((b) => [b, palm.distanceTo(buttons[b])]).sort((x, y) => x[1] - y[1])[0];
    const raw = fingerStraightness(h.joints), flexed = p.flex[side];
    const dt = Math.min(0.1, (now - (p.flexStAt?.[side] ?? now)) / 1000);
    (p.flexStAt ??= {})[side] = now;
    const st = p.flexSt[side] == null ? raw : p.flexSt[side] + (raw - p.flexSt[side]) * Math.min(1, dt / FLEX_SMOOTH_S);   // (tracking jitter while curled)
    p.flexSt[side] = st;
    const atKnob = pinched && pt.distanceTo(knob) < KNOB_REACH * 1.5;   // reaching for the plunger isn't a flip
    if (!flexed) {
      p.flex[side] = near[1] < FLEX_REACH && !p.pull && !atKnob && st < FLEX_IN ? near[0] : false;
    } else if (near[1] > FLEX_KEEP_REACH || p.pull) {
      p.flex[side] = false;   // taken away
    } else if (st > FLEX_OUT) {
      p.flexOutAt[side] ??= now;
      if (now - p.flexOutAt[side] >= FLEX_OUT_MS) p.flex[side] = false;   // straightened, and meant it
    } else p.flexOutAt[side] = null;
    if (!p.flex[side]) p.flexOutAt[side] = null;
    if (p.flex[side]) poke[p.flex[side]] = true;
    if (p.flex[side] && !flexed && performance.now() - (p.flexLogged ?? 0) > 5000) {
      p.flexLogged = performance.now();
      ctx.telemetry?.('pinball flex', { side, button: p.flex[side], straight: +st.toFixed(2), cm: Math.round(near[1] / h.scale * 100) });
    }
    for (const b of ['left', 'right']) {
      const tips = [h.joints[9], h.joints[4], h.joints[14]];
      if (tips.some((t) => t.distanceTo(buttons[b]) < BUTTON_R + BUTTON_REACH * 0.5) || (pinched && pt.distanceTo(buttons[b]) < BUTTON_REACH + BUTTON_R)) poke[b] = true;
    }
  }
  for (const b of ['left', 'right']) {
    if (poke[b] && !p.btn[b].poke && !begin(ctx)) continue;
    p.btn[b].poke = poke[b];
  }
  if (poke.left || poke.right || p.pull) p.lastPress = performance.now();
  syncHeld(p);
}

// ---- lamps & rules state --------------------------------------------------------------

// What the lamps show: lanes lit, drop targets down, bonus, multiplier step,
// shoot-again (extra ball earned), extra ball lit at the saucer, spinner lit.
function freshShow() { return { l: [false, false, false], d: [false, false, false], bo: 0, m: 0, sh: false, xb: false, spl: false }; }

// The show plus what's derived from timers: ball save, saucer holding, attract mode.
function liveShow(p) {
  const now = performance.now();
  return { ...p.show, sv: now < p.saveUntil, sa: now < p.saucer.until, at: p.over };
}

function laneChange(p, side) {
  if (p.over) return;
  const l = p.show.l;
  p.show.l = side === 'left' ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]];
}

function addBonus(p, n) { p.show.bo = Math.min(BONUS_MAX, p.show.bo + n); }

// ---- table ---------------------------------------------------------------------------

function build(ctx) {
  const p = ctx.pinball;
  p.world = new R.World({ x: 0, y: -9.81 * Math.cos(TILT), z: 9.81 * Math.sin(TILT) });
  p.world.timestep = STEP;
  const lift = Math.sin(TILT) * L;
  p.chrome = new THREE.MeshMatcapMaterial({ matcap: chromeMatcap() });

  // Cabinet: legs, the painted body you grab to move it, the tilted playfield in it.
  const cabinet = new THREE.Group();
  ctx.spawn(cabinet);
  p.cabinet = cabinet;
  const body = (p.body = new THREE.Group());
  cabinet.add(body);
  buildCabinet(ctx, body, lift);
  buildLegs(p, cabinet);
  setLegs(p);

  const field = (p.field = new THREE.Group());
  field.position.set(0, PF_Y + lift / 2, 0);
  field.rotation.x = TILT;
  body.add(field);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.006, L), new THREE.MeshStandardMaterial({ color: 0x15153a, roughness: 0.6 }));
  floor.position.y = -0.003;
  field.add(floor);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: canvasTex(paintPlayfield()), roughness: 0.45 }));
  art.position.y = 0.0002;
  field.add(art);
  fixedBox(p, 0, -0.005, 0, W / 2, 0.005, L / 2, 0.2, 0.2);
  fixedBox(p, 0, WALL_H + 0.005, 0, W / 2, 0.005, L / 2, 0, 0);        // the glass: keeps the ball down
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xbfd7ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.3, depthWrite: false }));
  glass.position.y = WALL_H + 0.006;
  field.add(glass);

  buildInserts(p, field);

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c2e12, roughness: 0.7 });
  const guideMat = new THREE.MeshStandardMaterial({ color: 0xdfe4ee, metalness: 0.7, roughness: 0.3 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0xe03131, roughness: 0.8 });
  p.slings = [];
  const statics = new Set();   // plain walls and posts: merged below (a few draw calls instead of ~50)
  const wall = (ax, az, bx, bz, mat = guideMat, rest = 0.45, tag = null, h = WALL_H) => {
    const len = Math.hypot(bx - ax, bz - az) + WALL_T;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, ang = Math.atan2(bz - az, bx - ax);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, h, WALL_T), mat);
    mesh.position.set(mx, h / 2, mz);
    mesh.rotation.y = -ang;
    field.add(mesh);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    const body = p.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(mx, WALL_H / 2, mz).setRotation(q));
    const col = p.world.createCollider(R.ColliderDesc.cuboid(len / 2, WALL_H / 2, WALL_T / 2).setRestitution(rest).setFriction(0.1), body);
    if (tag) p.slings.push({ col, ax, az, bx, bz, mesh });
    else statics.add(mesh);
    return col;
  };
  const post = (x, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, WALL_H + 0.004, 10), guideMat);
    m.position.set(x, (WALL_H + 0.004) / 2, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0058, 0.0022, 6, 16).rotateX(Math.PI / 2), rubberMat);
    ring.position.set(x, WALL_H * 0.4, z);
    field.add(m, ring);
    statics.add(m).add(ring);
  };
  // Outer walls (wood, like the cabinet), angled top corners.
  wall(X0, Z1, X0, Z0 + 0.06, woodMat);
  wall(X1, Z1, X1, Z0 + 0.08, woodMat);
  wall(X0 + 0.06, Z0, X1 - 0.08, Z0, woodMat);
  wall(X0, Z0 + 0.06, X0 + 0.06, Z0, guideMat);
  wall(X1 - 0.08, Z0, X1, Z0 + 0.08, guideMat, 0.6);                   // top-right: turns the launched ball left
  // Shooter lane wall, then a plunger stop.
  wall(LANE_X, Z1, LANE_X, Z0 + 0.17);
  wall(LANE_X, Z1 - 0.005, X1, Z1 - 0.005);
  // Left orbit (the spinner's lane).
  wall(ORBIT_X, -0.04, ORBIT_X, Z0 + 0.075);
  post(ORBIT_X, -0.04);
  // Top rollover lane guides.
  // (Short: they end well above the bumpers, so no ball-sized pocket between.)
  for (const x of [-0.09, -0.03, 0.03, 0.09]) { wall(x, Z0 + 0.06, x, Z0 + 0.082, guideMat, 0.45, null, WALL_H * 0.6); post(x, Z0 + 0.082); }
  // Inlanes guiding to the flippers.
  const fz = FLIP.pivotZ;
  // The guides end just above each flipper's base, so a ball rolls straight on
  // (ending beside it left a notch between guide and flipper that held the ball).
  const inL = [X0, fz - 0.09, -FLIP.pivotX - 0.003, fz - 0.013], inR = [LANE_X, fz - 0.09, FLIP.pivotX + 0.003, fz - 0.013];
  wall(...inL);
  wall(...inR);
  // Slingshots above the flippers: they kick and score. A rubber band with a plastic cap.
  const slingMat = new THREE.MeshStandardMaterial({ color: 0xf1f3f5, emissive: 0xff2244, emissiveIntensity: 0, roughness: 0.6 });
  // The inlane (between a slingshot and its guide) stays wider than the ball
  // (≥ 3.7 cm between wall centers) all the way down to the flipper: a channel
  // that narrows below that wedges the ball.
  const slingL = [-0.12, fz - 0.13, -0.09, fz - 0.07], slingR = [0.105, fz - 0.13, 0.073, fz - 0.075];
  wall(...slingL, slingMat.clone(), 0.95, 'sling');
  wall(...slingR, slingMat.clone(), 0.95, 'sling');
  for (const [ax, az, bx, bz] of [slingL, slingR]) {
    post(ax, az); post(bx, bz);
    const cap = triangle([ax, az], [bx, bz], [ax, bz - 0.005], 0xffffff, 0.75);
    cap.position.y = WALL_H + 0.001;
    field.add(cap);
    post(ax, bz - 0.005);
  }
  post(-FLIP.pivotX - 0.003, fz - 0.013);
  post(FLIP.pivotX + 0.003, fz - 0.013);
  mergeStatic(field, { keep: (o) => !statics.has(o) });

  // Pop bumpers: skirt, colored body, lit cap.
  p.bumpers = BUMPERS.map(([x, z]) => {
    const body = p.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, WALL_H / 2, z));
    p.world.createCollider(R.ColliderDesc.cylinder(WALL_H / 2, BUMPER_R).setRestitution(0.8), body);
    return { x, z };
  });
  p.bumperMeshes = BUMPERS.map(([x, z], i) => {
    const c = BUMPER_COLORS[i];
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_R * 1.3, BUMPER_R * 1.3, 0.003, 28), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
    skirt.position.y = WALL_H * 0.35;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_R * 0.8, BUMPER_R * 0.85, WALL_H * 0.8, 24), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    stem.position.y = WALL_H * 0.4;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_R * 1.02, BUMPER_R * 1.02, 0.004, 28, 1, true), p.chrome);
    ring.position.y = WALL_H * 0.55;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(BUMPER_R, BUMPER_R * 1.05, 0.008, 28),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: c, emissiveIntensity: 0.15, roughness: 0.3 }));
    cap.position.y = WALL_H * 0.85;
    const star = new THREE.Mesh(new THREE.CircleGeometry(BUMPER_R * 0.55, 5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: c }));
    star.position.y = WALL_H * 0.85 + 0.0042;
    g.add(skirt, stem, ring, cap, star);
    field.add(g);
    return cap;
  });
  p.bumperMeshes.forEach((m) => { m.material.userData.base = 0.15; });

  // Drop targets: a bank on the right; hit one and it drops into the playfield.
  const dropMat = new THREE.MeshStandardMaterial({ color: 0xffd43b, roughness: 0.4 });
  p.drops = DROPS.z.map((z) => {
    const body = p.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(DROPS.x, WALL_H / 2, z));
    const col = p.world.createCollider(R.ColliderDesc.cuboid(DROPS.hx, WALL_H / 2, DROPS.hz).setRestitution(0.3), body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(DROPS.hx * 2, WALL_H * 0.7, DROPS.hz * 2 - 0.002), dropMat);
    mesh.position.set(DROPS.x, WALL_H * 0.35, z);
    field.add(mesh);
    return { z, col, mesh };
  });
  const dropFrame = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, DROPS.hz * 6 + 0.01), guideMat);
  dropFrame.position.set(DROPS.x + 0.006, 0.002, DROPS.z[1]);
  field.add(dropFrame);

  // Spinner in the left orbit: a flat blade on a wire, spun by the ball passing under.
  const spinner = (p.spinnerMesh = new THREE.Group());
  spinner.position.set((X0 + ORBIT_X) / 2, WALL_H * 0.75, SPIN_Z);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(ORBIT_X - X0 - 0.012, 0.02, 0.0015), new THREE.MeshStandardMaterial({ color: 0xffe066, metalness: 0.5, roughness: 0.3 }));
  blade.position.y = -0.008;
  spinner.add(blade);
  field.add(spinner);
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, ORBIT_X - X0, 6).rotateZ(Math.PI / 2), p.chrome);
  wire.position.set((X0 + ORBIT_X) / 2, WALL_H * 0.75, SPIN_Z);
  field.add(wire);

  // Kickout saucer: a chrome cup.
  const cup = new THREE.Mesh(new THREE.TorusGeometry(SAUCER.r, 0.0025, 8, 24).rotateX(Math.PI / 2), p.chrome);
  cup.position.set(SAUCER.x, 0.002, SAUCER.z);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(SAUCER.r, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  hole.position.set(SAUCER.x, 0.0008, SAUCER.z);
  field.add(cup, hole);

  // Flippers: kinematic bodies turning about their pivots; white bats with red rubber.
  p.flip = {};
  p.flipMesh = {};
  const batMat = new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.3 });
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? -1 : 1;
    const body = p.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(sx * FLIP.pivotX, WALL_H / 2, fz));
    p.world.createCollider(R.ColliderDesc.cuboid(FLIP.len / 2, WALL_H / 2.2, FLIP.w / 2)
      .setTranslation(-sx * FLIP.len / 2, 0, 0).setRestitution(0.3).setFriction(0.4), body);
    p.flip[side] = body;
    const pivot = new THREE.Group();
    pivot.position.set(sx * FLIP.pivotX, 0, fz);
    const bat = new THREE.Mesh(flipperGeometry(-sx, 0.0085, 0.0045, WALL_H * 0.7), batMat);
    bat.position.y = WALL_H * 0.15;
    const rubber = new THREE.Mesh(flipperGeometry(-sx, 0.0095, 0.0055, WALL_H * 0.22), rubberMat);
    rubber.position.y = WALL_H * 0.4;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, WALL_H * 0.9, 10), p.chrome);
    pin.position.y = WALL_H * 0.45;
    pivot.add(bat, rubber, pin);
    field.add(pivot);
    p.flipMesh[side] = pivot;
    setFlip(p, side, FLIP.rest);
  }

  // Plunger tip in the lane.
  p.plungerMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 16).rotateX(Math.PI / 2), p.chrome);
  p.plungerMesh.position.set((LANE_X + X1) / 2, BALL_R, PLUNGER_Z + 0.012);
  field.add(p.plungerMesh);

  // Apron with the instruction cards; the ball drains under it.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(LANE_X - X0, 0.004, 0.05), new THREE.MeshStandardMaterial({ color: 0x2b2d42, metalness: 0.3, roughness: 0.5 }));
  apron.position.set((X0 + LANE_X) / 2, WALL_H * 0.75, Z1 - 0.022);
  field.add(apron);
  const cards = canvasTex(paintCards());
  const card = new THREE.Mesh(new THREE.PlaneGeometry(LANE_X - X0 - 0.02, 0.038).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: cards }));
  card.position.set((X0 + LANE_X) / 2, WALL_H * 0.75 + 0.0025, Z1 - 0.022);
  field.add(card);

  // Ball: chrome.
  p.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), p.chrome);
  field.add(p.ballMesh);
  p.ball = p.world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.2));
  p.ballCol = p.world.createCollider(R.ColliderDesc.ball(BALL_R).setDensity(7800).setFriction(0.15).setRestitution(0.4), p.ball);

  buildBackbox(ctx, body, lift);
}

function buildCabinet(ctx, body, lift) {
  const p = ctx.pinball;
  const top = (z) => PF_Y + lift * (Z1 - z) / L + WALL_H + 0.012;     // the cabinet's top edge follows the glass
  const sideTex = canvasTex(paintCabinetSide());
  const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.55 });
  const paint = new THREE.MeshStandardMaterial({ color: 0x7a1010, roughness: 0.55 });
  const zf = CAB.front, zb = CAB.back, len = zf - zb;
  // Sides: trapezoids (taller at the back), the stenciled art.
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, top(zf)), new THREE.Vector2(0, top(zb)),
  ]);
  for (const sx of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: CAB.side, bevelEnabled: false });
    // Caps get uv = shape coords: map them to 0..1 so the art fills each side
    // (mirrored on the right, which is seen from the other side).
    const uv = geo.attributes.uv, hMax = top(zb);
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i) / len; uv.setXY(i, sx > 0 ? 1 - u : u, uv.getY(i) / hMax); }
    geo.rotateY(-Math.PI / 2);     // shape x → +z, extrusion → -x
    const m = new THREE.Mesh(geo, [sideMat, paint]);
    m.position.set(sx < 0 ? -W / 2 - 0.001 : W / 2 + 0.001 + CAB.side, 0, zb);
    body.add(m);   // not a handle: you aim at the sides and front while playing
  }
  const front = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, top(zf), 0.012), paint);
  front.position.set(0, top(zf) / 2, zf - 0.006);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, top(zb), 0.012), paint);
  back.position.set(0, top(zb) / 2, zb + 0.006);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(W + 0.002, 0.01, len), paint);
  bottom.position.set(0, 0.005, (zf + zb) / 2);
  body.add(front);
  for (const m of [back, bottom]) { m.userData.handle = true; body.add(m); }
  // Chrome: lockdown bar across the front, side rails along the top edges.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * CAB.side + 0.01, 0.008, 0.026), p.chrome);
  bar.position.set(0, top(zf) + 0.004, zf - 0.008);
  body.add(bar);
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(CAB.side + 0.006, 0.006, len), p.chrome);
    rail.position.set(sx * (W / 2 + CAB.side / 2 + 0.001), (top(zf) + top(zb)) / 2 + 0.003, (zf + zb) / 2);
    rail.rotation.x = Math.atan2(top(zb) - top(zf), len);
    body.add(rail);
  }
  // Coin door.
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.004), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }));
  door.position.set(0, PF_Y * 0.45, zf + 0.002);
  body.add(door);
  for (const x of [-0.022, 0.022]) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.003), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2b2b, emissiveIntensity: 0.9 }));
    slot.position.set(x, PF_Y * 0.45 + 0.012, zf + 0.004);
    body.add(slot);
  }
  // Plunger knob on the front; flipper buttons on the sides.
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 10).rotateX(Math.PI / 2), p.chrome);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 18, 14), new THREE.MeshStandardMaterial({ color: 0xfff3bf, roughness: 0.3 }));
  p.knob = new THREE.Group();
  p.knob.add(rod, knob);
  p.knob.userData.part = 'plunger';
  p.knobGrip = knob;
  // A larger invisible grip around the knob: easy to point at.
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  grip.position.z = 0.028;
  p.knob.add(grip);
  rod.position.z = 0.012;
  knob.position.z = 0.028;
  p.knob.position.set((LANE_X + X1) / 2, PF_Y - 0.02, zf);
  body.add(p.knob);
  p.buttons = {};
  for (const [side, sx] of [['left', -1], ['right', 1]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(BUTTON_R, BUTTON_R, 0.012, 20).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe03131, roughness: 0.35, emissive: 0x550000 }));
    b.position.set(sx * (W / 2 + CAB.side + 0.007), PF_Y - 0.015, zf - 0.05);
    b.userData.part = side;
    b.userData.out = b.position.x;
    body.add(b);
    p.buttons[side] = b;
  }
}

function buildLegs(p, cabinet) {
  p.legMeshes = [];
  for (const sx of [-1, 1]) for (const z of [CAB.front - 0.03, CAB.back + 0.03]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 1, 12), p.chrome);
    leg.position.set(sx * (W / 2 + 0.002), 0, z);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.03), p.chrome);
    plate.userData.leg = leg;
    leg.userData.handle = true;
    cabinet.add(leg, plate);
    p.legMeshes.push({ leg, plate });
  }
}

function setLegs(p) {
  const h = LEGS[p.legs];
  p.body.position.y = h;
  for (const { leg, plate } of p.legMeshes) {
    leg.scale.y = h;
    leg.position.y = h / 2;
    plate.position.set(leg.position.x, h - 0.003, leg.position.z);
  }
}

function buildBackbox(ctx, body, lift) {
  const p = ctx.pinball;
  const backTop = PF_Y + lift + WALL_H + 0.012;
  const bw = W + 2 * CAB.side + 0.01, bh = 0.3, bd = 0.07;
  const y0 = backTop + 0.03;
  const zc = CAB.back + bd / 2 - 0.005;
  const wood = new THREE.MeshStandardMaterial({ map: canvasTex(paintCabinetSide()), roughness: 0.55 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), wood);
  box.position.set(0, y0 + bh / 2, zc);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.7, 0.035, bd * 0.8), new THREE.MeshStandardMaterial({ color: 0x7a1010, roughness: 0.55 }));
  neck.position.set(0, backTop + 0.015, zc);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.004, 0.008, bd + 0.004), p.chrome);
  trim.position.set(0, y0 + bh, zc);
  for (const m of [box, neck]) { m.userData.handle = true; body.add(m); }
  body.add(trim);
  // Backglass: title art on top (painted once), score reels + lamps below (redrawn).
  const gw = W, artH = 0.12, scoreH = 0.15, zf = zc + bd / 2 + 0.001;
  const art = new THREE.Mesh(new THREE.PlaneGeometry(gw, artH), new THREE.MeshBasicMaterial({ map: canvasTex(paintBackglassArt()) }));
  art.position.set(0, y0 + bh - 0.012 - artH / 2, zf);
  const canvas = Object.assign(document.createElement('canvas'), { width: 576, height: 240 });
  const tex = canvasTex(canvas);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, scoreH), new THREE.MeshBasicMaterial({ map: tex }));
  glass.position.set(0, y0 + 0.012 + scoreH / 2, zf);
  art.userData.handle = glass.userData.handle = true;
  body.add(art, glass);
  p.panel = { canvas, tex };
}

// Inserts: colored lamps set into the playfield (dim when off, glowing when lit).
function buildInserts(p, field) {
  const ins = (x, z, r, color, sides = 24, rot = 0) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, sides).rotateZ(rot).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.35), emissive: color, emissiveIntensity: 0.06, roughness: 0.3 }));
    m.position.set(x, 0.0006, z);
    field.add(m);
    (p.inserts ??= []).push(m);
    return m;
  };
  p.lamps = LANES_X.map((x) => ins(x, LANES_Z, 0.009, 0xffb000));
  p.ladder = [];
  for (let k = 0; k < BONUS_MAX; k++) p.ladder.push(ins(k < 5 ? -0.014 : 0.014, 0.055 + (k % 5) * 0.019, 0.0065, 0xffd43b));
  p.multLamps = [-0.03, 0, 0.03].map((x) => ins(x, 0.025, 0.009, 0xff6b6b, 3, Math.PI / 2));
  p.shootLamp = ins(0, 0.168, 0.011, 0xff4d4d);
  p.xbLamp = ins(SAUCER.x + 0.03, SAUCER.z + 0.022, 0.008, 0xff922b, 3, -Math.PI / 4);
  p.dropLamps = DROPS.z.map((z) => ins(DROPS.x - 0.025, z, 0.006, 0x74c0fc, 3, Math.PI));
  p.spinLamp = ins((X0 + ORBIT_X) / 2, SPIN_Z + 0.06, 0.008, 0x63e6be, 3, 0);
}

function fixedBox(p, x, y, z, hx, hy, hz, friction, restitution) {
  const body = p.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z));
  p.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(restitution), body);
}

// A tapered flipper bat: round at the pivot (origin), round tip `dir`·len along x.
function flipperGeometry(dir, r0, r1, h) {
  const s = new THREE.Shape(), len = FLIP.len - r1;
  const a = Math.asin((r0 - r1) / len);
  s.absarc(0, 0, r0, Math.PI / 2 + a, 3 * Math.PI / 2 - a, false);
  s.absarc(len, 0, r1, -Math.PI / 2 - a, Math.PI / 2 + a, false);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2);          // shape y → z, extrusion → -y
  g.translate(0, h, 0);
  if (dir < 0) {   // mirrored: flip each triangle's winding so the faces still point out (else it lights dark)
    g.scale(-1, 1, 1);
    const pos = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i += 3) for (const a of [pos, n, uv]) {
      if (!a) continue;
      for (let k = 0; k < a.itemSize; k++) { const t = a.array[(i + 1) * a.itemSize + k]; a.array[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k]; a.array[(i + 2) * a.itemSize + k] = t; }
    }
    g.computeVertexNormals();
  }
  return g;
}

function triangle(a, b, c, color, opacity) {
  const s = new THREE.Shape([new THREE.Vector2(a[0], -a[1]), new THREE.Vector2(b[0], -b[1]), new THREE.Vector2(c[0], -c[1])]);
  const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, transparent: opacity < 1, opacity, roughness: 0.3, side: THREE.DoubleSide }));
}

// Flipper angle a: 0 = pointing straight in (toward the middle); positive = up the table.
function flipYaw(side, a) { return side === 'left' ? a : -a; }

function setFlip(p, side, a, next = false) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), flipYaw(side, a));
  const rot = { x: q.x, y: q.y, z: q.z, w: q.w };
  if (next) p.flip[side].setNextKinematicRotation(rot); else p.flip[side].setRotation(rot, true);
}

// ---- play ----------------------------------------------------------------------------

function step(ctx) {
  const p = ctx.pinball;
  for (const side of ['left', 'right']) {
    const target = p.held[side] ? FLIP.up : FLIP.rest;
    const a = p.angle[side], d = target - a, max = FLIP.speed * STEP;
    p.angle[side] = a + Math.sign(d) * Math.min(Math.abs(d), max);
    setFlip(p, side, p.angle[side], true);
  }
  const prev = p.ball.translation();
  p.world.step();
  const t = p.ball.translation(), v = p.ball.linvel();
  const now = performance.now();
  const playing = !p.over;
  // Pop bumpers kick the ball away and score.
  p.bumpers.forEach((b, i) => {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    if (d > BUMPER_R + BALL_R + 0.002 || now - (p.cool.get(`b${i}`) ?? 0) < 120) return;
    p.cool.set(`b${i}`, now);
    const s = Math.max(BUMPER_KICK, Math.hypot(v.x, v.z));
    p.ball.setLinvel({ x: dx / d * s, y: 0, z: dz / d * s }, true);
    p.bumperMeshes[i].material.emissiveIntensity = 1.6;
    p.kicked.push(i);
    if (playing) addScore(ctx, BUMPER_POINTS);
  });
  // Slingshots kick the ball off and score.
  p.slings.forEach((s, i) => {
    if (now - (p.cool.get(`s${i}`) ?? 0) < 200) return;
    if (segDist(t.x, t.z, s.ax, s.az, s.bx, s.bz) >= BALL_R + WALL_T / 2 + 0.002) return;
    p.cool.set(`s${i}`, now);
    let nx = -(s.bz - s.az), nz = s.bx - s.ax;
    const n = Math.hypot(nx, nz);
    nx /= n; nz /= n;
    if (nx * -Math.sign(s.ax) < 0) { nx = -nx; nz = -nz; }   // away from the band, into the table
    p.ball.setLinvel({ x: v.x + nx * SLING_KICK, y: 0, z: v.z + nz * SLING_KICK }, true);
    s.mesh.material.emissiveIntensity = 1.2;
    p.slung.push(i);
    if (playing) addScore(ctx, SLING_POINTS);
  });
  if (!playing) return outOfPlay(ctx, t, v);
  // Top lanes: light all three to advance the multiplier.
  if (!p.inLane && Math.abs(t.z - LANES_Z) < 0.015) {
    const i = LANES_X.findIndex((x) => Math.abs(t.x - x) < 0.015);
    if (i >= 0 && !p.show.l[i] && now - (p.cool.get(`l${i}`) ?? 0) > 300) {
      p.cool.set(`l${i}`, now);
      p.show.l[i] = true;
      addBonus(p, 1);
      addScore(ctx, 50);
      if (p.show.l.every(Boolean)) {
        addScore(ctx, LANE_POINTS);
        p.show.m = Math.min(MULTS.length - 1, p.show.m + 1);
        ctx.log(`bonus ${MULTS[p.show.m]}×`);
        setTimeout(() => { p.show.l = [false, false, false]; }, 600);
      }
    }
  }
  // Drop targets: down they go; all three light the spinner (then the extra ball).
  p.drops.forEach((dt, i) => {
    if (p.show.d[i]) return;
    const hit = Math.abs(t.z - dt.z) < DROPS.hz + BALL_R * 0.5 && t.x < DROPS.x && DROPS.x - t.x < DROPS.hx + BALL_R + 0.004;
    if (!hit) return;
    p.show.d[i] = true;
    dt.col.setEnabled(false);
    addBonus(p, 1);
    addScore(ctx, 250);
    if (p.show.d.every(Boolean)) {
      addScore(ctx, 2500);
      if (p.show.spl && !p.show.sh) { p.show.xb = true; ctx.log('extra ball is lit'); } else p.show.spl = true;
      setTimeout(() => resetDrops(p), 1000);
    }
  });
  // Spinner: the ball passing under it spins it; every half turn scores.
  if (t.x < ORBIT_X && (prev.z - SPIN_Z) * (t.z - SPIN_Z) <= 0 && prev.z !== t.z) p.spin.w += Math.abs(v.z) * 60;
  if (p.spin.w > 0.5) {
    const before = Math.floor(p.spin.a / Math.PI);
    p.spin.a += p.spin.w * STEP;
    p.spin.w *= 1 - 1.5 * STEP;
    if (Math.floor(p.spin.a / Math.PI) > before) addScore(ctx, p.show.spl ? 100 : 10);
  } else p.spin.w = 0;
  // Saucer: holds the ball, scores, then kicks it out toward the flippers.
  if (now < p.saucer.until) {
    p.ball.setTranslation({ x: SAUCER.x, y: BALL_R + 0.0005, z: SAUCER.z }, true);
    p.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  } else if (p.saucer.until) {
    p.saucer.until = 0;
    p.saucer.free = now + 500;
    roll(p, 0.8, 0.55);
    thunk(0.3);
  } else if (now > p.saucer.free && Math.hypot(t.x - SAUCER.x, t.z - SAUCER.z) < SAUCER.r && Math.hypot(v.x, v.z) < 1.0) {
    p.saucer.until = now + SAUCER.hold;
    addBonus(p, 2);
    addScore(ctx, 1000);
    if (p.show.xb) { p.show.xb = false; p.show.sh = true; knock(); ctx.log('extra ball!'); }
  }
  outOfPlay(ctx, t, v);
}

// The shooter lane and the drain.
function outOfPlay(ctx, t, v) {
  const p = ctx.pinball;
  if (p.inLane && (t.x < LANE_X - BALL_R || t.z < Z0 + 0.15)) {
    p.inLane = false;
    if (p.saveArmed && !p.over) { p.saveArmed = false; p.saveUntil = performance.now() + BALL_SAVE_MS; }
  }
  if (!p.inLane && t.x > LANE_X && t.z > Z0 + 0.2 && Math.hypot(v.x, v.z) < 0.05) p.inLane = true;
  if (t.z > Z1 + 0.02 || t.y < -0.05 || t.y > WALL_H + 0.05) drain(ctx);
}

function resetDrops(p) {
  if (!p.world) return;
  p.show.d = [false, false, false];
  for (const d of p.drops) d.col.setEnabled(true);
}

function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, k = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - k * vx, pz - az - k * vz);
}

function placeBall(p, x, z, vx = 0, vz = 0) {
  p.ball.setTranslation({ x, y: BALL_R + 0.0005, z }, true);
  roll(p, vx, vz);
}

// Set the ball moving already rolling (not sliding): friction would
// otherwise eat a third of the speed turning slide into spin.
function roll(p, vx, vz) {
  p.clock?.wake();   // (the ball's about to move: the physics has to be running)
  p.ball.setLinvel({ x: vx, y: 0, z: vz }, true);
  p.ball.setAngvel({ x: vz / BALL_R, y: 0, z: -vx / BALL_R }, true);
}

function resetBall(p) {
  placeBall(p, (LANE_X + X1) / 2, PLUNGER_Z - BALL_R - 0.002);
  p.inLane = true;
  p.charging = null;
  p.saucer.until = 0;
}

function launch(ctx, f) {
  const p = ctx.pinball;
  p.charging = null;
  if (!p.inLane || p.over || p.counting) return;
  roll(p, 0, -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * f));
  thunk(0.25);
}

function drain(ctx) {
  const p = ctx.pinball;
  p.held = { left: false, right: false };
  if (p.over) return resetBall(p);
  if (performance.now() < p.saveUntil) {   // ball save: this one doesn't count
    p.saveUntil = 0;
    resetBall(p);
    knock();
    ctx.log('ball saved');
    return;
  }
  resetBall(p);
  p.counting = true;
  countBonus(ctx, () => {
    p.counting = false;
    const extra = p.show.sh;
    Object.assign(p.show, { bo: 0, m: 0, sh: false, l: [false, false, false] });
    if (extra) ctx.log('shoot again');
    else if (p.balls > 1) p.balls--;
    else return endGame(ctx, 'over');
    p.saveArmed = true;
    updateStatus(ctx);
    drawPanel(ctx);
  });
}

// End of ball: the bonus counts down into the score, a chime a step.
function countBonus(ctx, done) {
  const p = ctx.pinball;
  if (!p.world) return;
  if (p.show.bo <= 0) return done();
  p.show.bo--;
  addScore(ctx, 1000 * MULTS[p.show.m]);
  setTimeout(() => countBonus(ctx, done), 140);
}

// Game over (or abandoned): match, your best, the shared board, and the machine is free.
function endGame(ctx, why) {
  const p = ctx.pinball;
  p.over = true;
  p.counting = false;
  p.held = { left: false, right: false };
  p.saveUntil = 0;
  resetBall(p);
  if (why === 'over' && p.score > 0) {
    const m = Math.floor(Math.random() * 10) * 10;
    p.match = { n: m, won: (p.score % 100) === m };
    if (p.match.won) { knock(); ctx.log('match! free game'); }
  }
  if (p.score > p.best) {
    p.best = p.score;
    ctx.state.set('best', p.best).catch(() => {});
    ctx.log(`new best: ${p.best}`);
  }
  const me = ctx.player().name;
  if (p.score > 0) p.top = [...p.top, { n: me, s: p.score }].sort((a, b) => b.s - a.s).slice(0, TOP_N);
  p.last = { n: me, s: p.score, why, match: p.match };
  p.room.settle({ top: p.top, last: p.last });
  updateStatus(ctx);
  drawPanel(ctx);
}

function newGame(ctx) {
  const p = ctx.pinball;
  Object.assign(p, { score: 0, balls: BALLS, over: false, lastPress: performance.now(), kicked: [], slung: [],
    show: freshShow(), saveArmed: true, saveUntil: 0, counting: false, match: null });
  resetDrops(p);
  resetBall(p);
  updateStatus(ctx);
  drawPanel(ctx);
}

function addScore(ctx, n) {
  ctx.pinball.score += n;
  chimeFor(n);
  updateStatus(ctx);
  drawPanel(ctx);
}

// Draw the machine from a view (yours, or the player's stream).
function paint(ctx, dt, v) {
  const p = ctx.pinball, now = performance.now();
  p.flipMesh.left.rotation.y = flipYaw('left', v.f[0]);
  p.flipMesh.right.rotation.y = flipYaw('right', v.f[1]);
  p.plungerMesh.position.z = PLUNGER_Z + 0.012 + v.pl * 0.025;
  p.knob.position.z = CAB.front + v.pl * PULL_M;   // the knob comes out with the hand
  for (const [i, side] of [[0, 'left'], [1, 'right']]) {
    const b = p.buttons[side];
    b.position.x = b.userData.out - Math.sign(b.userData.out) * (v.h?.[i] ? 0.004 : 0);
  }
  p.spinnerMesh.rotation.x = v.sp;
  const w = v.w;
  w.d.forEach((down, i) => {
    const m = p.drops[i].mesh, y = down ? -WALL_H * 0.4 : WALL_H * 0.35;
    m.position.y += (y - m.position.y) * Math.min(1, dt * 20);
  });
  for (const b of p.bumperMeshes) b.material.emissiveIntensity = Math.max(0.15, b.material.emissiveIntensity - dt * 4);
  for (const s of p.slings) s.mesh.material.emissiveIntensity = Math.max(0, s.mesh.material.emissiveIntensity - dt * 5);
  const blink = Math.floor(now / 250) % 2 === 0;
  const set = (m, on) => { m.material.emissiveIntensity = on ? 1.4 : 0.06; };
  if (w.at) {   // attract mode: the lamps chase
    const k = Math.floor(now / 90);
    p.inserts.forEach((m, i) => set(m, (i + k) % 6 === 0 || (i * 7 + k) % 11 === 0));
    return;
  }
  p.lamps.forEach((m, i) => set(m, w.l[i]));
  p.ladder.forEach((m, k) => set(m, w.bo > k));
  p.multLamps.forEach((m, k) => set(m, w.m > k));
  set(p.shootLamp, w.sh || (w.sv && blink));
  set(p.xbLamp, w.xb && blink);
  p.dropLamps.forEach((m, i) => set(m, w.d[i]));
  set(p.spinLamp, w.spl);
}

// Someone else is playing: draw their stream.
function watch(ctx, dt) {
  const p = ctx.pinball, d = p.watching;
  if (!d) return paint(ctx, dt, { f: [FLIP.rest, FLIP.rest], pl: 0, w: { ...freshShow(), at: true }, sp: p.spinnerMesh.rotation.x });
  const k = 1 - Math.exp(-dt / FOLLOW_S);
  p.ballMesh.position.lerp(new THREE.Vector3(...d.b), k);
  for (const i of d.k ?? []) p.bumperMeshes[i].material.emissiveIntensity = 1.6;
  for (const i of d.sk ?? []) p.slings[i].mesh.material.emissiveIntensity = 1.2;
  d.k = [];
  d.sk = [];
  paint(ctx, dt, { f: d.f, pl: d.pl, h: d.h, w: d.w ?? { ...freshShow(), at: false }, sp: d.sp ?? 0 });
  if (d.s !== p.shown?.s || d.n !== p.shown?.n || d.w?.sh !== p.shown?.sh) { p.shown = { s: d.s, n: d.n, sh: d.w?.sh }; updateStatus(ctx); drawPanel(ctx); }
}

function updateStatus(ctx) {
  const p = ctx.pinball;
  const d = p.watching;
  if (d && p.room.holder && !p.room.mine) return ctx.status(`${d.who} is playing · ${d.s} · ball ${BALLS - d.n + 1}/${BALLS}`);
  if (!p.room.mine) return ctx.status(p.last ? `Game over: ${p.last.n} scored ${p.last.s} · press to play` : 'Pinball · press to play');
  ctx.status(`Ball ${BALLS - p.balls + 1}/${BALLS} · ${p.score}`);
}

// ---- backglass, playfield and cabinet art (canvas) ------------------------------------

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Marks the score glass for a redraw; frame() paints it at most every PANEL_MS.
function drawPanel(ctx) { ctx.pinball.panelDirty = true; }

function paintPanel(ctx) {
  const p = ctx.pinball;
  p.panelDirty = false;
  p.panelAt = performance.now();
  const { canvas, tex } = p.panel;
  const g = canvas.getContext('2d'), Wc = canvas.width, Hc = canvas.height;
  const d = p.room?.holder && !p.room.mine ? p.watching : null;
  const playing = p.room?.mine && !p.over;
  const score = d ? d.s : playing ? p.score : p.last?.s ?? 0;
  const ballNo = d ? BALLS - d.n + 1 : playing ? BALLS - p.balls + 1 : 0;
  const shoot = d ? d.w?.sh : playing && p.show.sh;
  const over = !d && !playing;
  const match = over ? p.last?.match : null;
  g.fillStyle = '#0b0618';
  g.fillRect(0, 0, Wc, Hc);
  g.strokeStyle = '#f5c542'; g.lineWidth = 4;
  g.strokeRect(4, 4, Wc - 8, Hc - 8);
  // Score reels: six drums in a window.
  const rx = 24, ry = 18, dw = 50, dh = 74;
  g.fillStyle = '#000';
  g.fillRect(rx - 8, ry - 6, dw * 6 + 16, dh + 12);
  const digits = String(score % 1e6).padStart(6, ' ');
  for (let i = 0; i < 6; i++) {
    const x = rx + i * dw;
    const drum = g.createLinearGradient(0, ry, 0, ry + dh);
    drum.addColorStop(0, '#555'); drum.addColorStop(0.25, '#f1efe6'); drum.addColorStop(0.75, '#f1efe6'); drum.addColorStop(1, '#555');
    g.fillStyle = drum;
    g.fillRect(x + 2, ry, dw - 4, dh);
    g.fillStyle = '#111';
    g.font = '700 54px Georgia, serif';
    g.textAlign = 'center';
    g.fillText(digits[i] === ' ' ? '0' : digits[i], x + dw / 2, ry + dh / 2 + 19);
  }
  g.textAlign = 'left';
  g.fillStyle = '#c5b8ff';
  g.font = '20px system-ui, sans-serif';
  g.fillText(d ? `${d.who} is playing` : playing ? 'you' : p.last ? `last: ${p.last.n}` : 'press to play', rx, ry + dh + 30);
  // Lit boxes: ball in play, shoot again, game over, match.
  const box = (x, y, w, h, text, on, color) => {
    g.fillStyle = on ? color : '#1d1530';
    g.fillRect(x, y, w, h);
    g.fillStyle = on ? '#1a0b00' : '#3b3155';
    g.font = '700 17px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(text, x + w / 2, y + h / 2 + 6);
    g.textAlign = 'left';
  };
  const by = 150;
  g.fillStyle = '#9b8fd6'; g.font = '600 14px system-ui, sans-serif';
  g.fillText('BALL IN PLAY', rx, by - 6);
  for (let b = 1; b <= BALLS; b++) box(rx + (b - 1) * 40, by, 34, 30, String(b), ballNo === b, '#ffd43b');
  box(rx + 130, by, 120, 30, 'SHOOT AGAIN', !!shoot, '#ff6b6b');
  box(rx, by + 40, 120, 30, 'GAME OVER', over, '#ff922b');
  box(rx + 130, by + 40, 120, 30, match ? `MATCH ${String(match.n).padStart(2, '0')}` : 'MATCH', !!match?.won, '#69db7c');
  // Shared high scores (this machine).
  const hx = 360;
  g.fillStyle = '#ffd43b';
  g.font = '600 20px system-ui, sans-serif';
  g.fillText('HIGH SCORES', hx, 40);
  g.font = '18px system-ui, sans-serif';
  const top = p.top ?? [];
  if (!top.length) { g.fillStyle = '#9b8fd6'; g.fillText('none yet', hx, 70); }
  top.slice(0, TOP_N).forEach((t, k) => {
    g.fillStyle = '#e9e4ff';
    g.fillText(`${k + 1}. ${t.n}`.slice(0, 13), hx, 70 + k * 26);
    g.textAlign = 'right'; g.fillText(String(t.s), Wc - 20, 70 + k * 26); g.textAlign = 'left';
  });
  g.fillStyle = '#9b8fd6';
  g.fillText(`your best ${p.best}`, hx, 218);
  tex.needsUpdate = true;
}

function paintBackglassArt() {
  const c = Object.assign(document.createElement('canvas'), { width: 768, height: 256 });
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 256);
  bg.addColorStop(0, '#2a0b5e'); bg.addColorStop(1, '#0f0628');
  g.fillStyle = bg;
  g.fillRect(0, 0, 768, 256);
  // Starburst behind the title.
  g.save();
  g.translate(384, 150);
  for (let i = 0; i < 32; i++) {
    g.rotate(Math.PI / 16);
    g.fillStyle = i % 2 ? 'rgba(255,170,40,0.22)' : 'rgba(255,60,120,0.16)';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(520, -50); g.lineTo(520, 50); g.fill();
  }
  g.restore();
  // Stars.
  for (let i = 0; i < 40; i++) star(g, (i * 197) % 768, (i * 89) % 256, 2 + (i % 4), i % 3 ? '#fff3bf' : '#ffd43b');
  // Title: chunky italic with an outline and a drop shadow.
  g.font = 'italic 900 118px Georgia, serif';
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.fillStyle = '#000'; g.fillText('STRATUM', 390, 158);
  g.lineWidth = 12; g.strokeStyle = '#c92a2a'; g.strokeText('STRATUM', 384, 150);
  const gold = g.createLinearGradient(0, 60, 0, 160);
  gold.addColorStop(0, '#fff3bf'); gold.addColorStop(0.5, '#fcc419'); gold.addColorStop(1, '#e8590c');
  g.fillStyle = gold; g.fillText('STRATUM', 384, 150);
  g.font = 'italic 700 34px Georgia, serif';
  g.fillStyle = '#ffe8f0';
  g.fillText('★  P I N B A L L  ★', 384, 212);
  g.font = '600 16px system-ui, sans-serif';
  g.fillStyle = '#b197fc';
  g.fillText('1 TO 4 CAN WATCH · ONE PLAYS AT A TIME', 384, 242);
  g.strokeStyle = '#f5c542'; g.lineWidth = 6;
  g.strokeRect(3, 3, 762, 250);
  return c;
}

function star(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.fill();
}

// The playfield painting: canvas y = table z (far end at the top), x = table x.
function paintPlayfield() {
  const Wc = 512, Hc = Math.round(512 * L / W);
  const c = Object.assign(document.createElement('canvas'), { width: Wc, height: Hc });
  const g = c.getContext('2d');
  const px = (x) => (x - X0) / W * Wc, pz = (z) => (z - Z0) / L * Hc, ps = (m) => m / W * Wc;
  const bg = g.createLinearGradient(0, 0, 0, Hc);
  bg.addColorStop(0, '#3b0f6e'); bg.addColorStop(0.5, '#16206b'); bg.addColorStop(1, '#0b3a5a');
  g.fillStyle = bg;
  g.fillRect(0, 0, Wc, Hc);
  // Starburst under the bumpers.
  g.save();
  g.translate(px(-0.005), pz(-0.13));
  for (let i = 0; i < 24; i++) {
    g.rotate(Math.PI / 12);
    g.fillStyle = i % 2 ? 'rgba(255,212,59,0.18)' : 'rgba(255,90,150,0.12)';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(ps(0.3), -ps(0.035)); g.lineTo(ps(0.3), ps(0.035)); g.fill();
  }
  g.restore();
  for (let i = 0; i < 60; i++) star(g, (i * 131) % Wc, (i * 277) % Hc, 2 + (i % 3), 'rgba(255,243,191,0.6)');
  // Painted rings around the bumpers, lane letters, labels.
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3;
  for (const [x, z] of BUMPERS) { g.beginPath(); g.arc(px(x), pz(z), ps(BUMPER_R * 1.6), 0, Math.PI * 2); g.stroke(); }
  g.textAlign = 'center';
  g.fillStyle = '#fff3bf';
  g.font = `900 ${ps(0.016)}px Georgia, serif`;
  ['A', 'B', 'C'].forEach((ch, i) => g.fillText(ch, px(LANES_X[i]), pz(LANES_Z + 0.03)));
  const label = (text, x, z, size = 0.0085, color = '#ffffff', rot = 0) => {
    g.save(); g.translate(px(x), pz(z)); g.rotate(rot);
    g.fillStyle = color; g.font = `800 ${ps(size)}px system-ui, sans-serif`;
    g.fillText(text, 0, 0); g.restore();
  };
  label('BONUS', 0, 0.048, 0.008, '#ffd43b');
  for (let k = 0; k < BONUS_MAX; k++) label(String((k + 1)), (k < 5 ? -0.014 : 0.014) + (k < 5 ? -0.016 : 0.016), 0.058 + (k % 5) * 0.019, 0.0065, '#fff3bf');
  ['2×', '3×', '5×'].forEach((t, i) => label(t, -0.03 + i * 0.03, 0.045 - 0.031, 0.008, '#ffc9c9'));
  label('SHOOT AGAIN', 0, 0.19, 0.0085, '#ffc9c9');
  label('EXTRA BALL', SAUCER.x + 0.03, SAUCER.z + 0.042, 0.007, '#ffd8a8');
  label('1000', SAUCER.x, SAUCER.z - 0.02, 0.008, '#ffffff');
  label('SPINNER', (X0 + ORBIT_X) / 2, SPIN_Z + 0.085, 0.0065, '#c3fae8');
  label('TARGETS', DROPS.x - 0.025, DROPS.z[0] - 0.02, 0.0065, '#d0ebff');
  label('LIGHT SPINNER', DROPS.x - 0.038, DROPS.z[1], 0.0055, '#d0ebff', -Math.PI / 2);
  // Shooter lane arrow and stripes.
  g.fillStyle = 'rgba(255,212,59,0.6)';
  for (let i = 0; i < 4; i++) {
    const z = Z1 - 0.09 - i * 0.05, x = (LANE_X + X1) / 2;
    g.beginPath(); g.moveTo(px(x), pz(z - 0.018)); g.lineTo(px(x + 0.012), pz(z)); g.lineTo(px(x - 0.012), pz(z)); g.fill();
  }
  // Inlane stripes.
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
  const fz = FLIP.pivotZ;
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(px(sx * 0.15), pz(fz - 0.07)); g.lineTo(px(sx * 0.085), pz(fz - 0.015)); g.stroke();
  }
  return c;
}

function paintCards() {
  const c = Object.assign(document.createElement('canvas'), { width: 640, height: 76 });
  const g = c.getContext('2d');
  g.fillStyle = '#2b2d42';
  g.fillRect(0, 0, 640, 76);
  const card = (x, lines) => {
    g.fillStyle = '#fff9db';
    g.fillRect(x, 6, 200, 64);
    g.fillStyle = '#212529';
    g.textAlign = 'center';
    lines.forEach((t, i) => { g.font = i ? '11px Georgia, serif' : '700 13px Georgia, serif'; g.fillText(t, x + 100, 22 + i * 14); });
  };
  card(14, ['3 BALLS PER GAME', 'LANES A-B-C ADVANCE BONUS ×', 'FLIPPERS CHANGE LIT LANE', 'BALL SAVE AT START OF BALL']);
  g.fillStyle = '#ffd43b'; g.font = 'italic 900 26px Georgia, serif'; g.textAlign = 'center';
  g.fillText('STRATUM', 320, 46);
  card(426, ['TARGETS LIGHT SPINNER', 'AGAIN: LIGHT EXTRA BALL', 'SAUCER 1000 · COLLECTS', 'MATCH AT GAME OVER']);
  return c;
}

function paintCabinetSide() {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 192 });
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 512, 192);
  bg.addColorStop(0, '#8f1414'); bg.addColorStop(1, '#3d0707');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 192);
  // Stenciled flames along the bottom and scattered stars: classic cabinet art.
  g.fillStyle = '#ffb000';
  g.beginPath(); g.moveTo(0, 192);
  for (let x = 0; x <= 512; x += 32) g.quadraticCurveTo(x + 8, 120 - (x % 64 ? 10 : 40), x + 16, 192 - 30);
  g.lineTo(512, 192); g.fill();
  for (let i = 0; i < 18; i++) star(g, (i * 113) % 512, 20 + (i * 47) % 110, 6 + (i % 3) * 3, i % 2 ? '#ffd43b' : '#fff3bf');
  g.font = 'italic 900 52px Georgia, serif';
  g.textAlign = 'center';
  g.lineWidth = 6; g.strokeStyle = '#1a0000'; g.strokeText('STRATUM', 256, 110);
  g.fillStyle = '#ffd43b'; g.fillText('STRATUM', 256, 110);
  return c;
}

// A chrome matcap: bright sky on top, a dark horizon band, warm floor below.
function chromeMatcap() {
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.42, '#aab4c8'); grad.addColorStop(0.5, '#2b2f3a');
  grad.addColorStop(0.62, '#6b5d52'); grad.addColorStop(1, '#d8c8b0');
  g.fillStyle = grad;
  g.beginPath(); g.arc(64, 64, 64, 0, Math.PI * 2); g.fill();
  const hi = g.createRadialGradient(44, 36, 2, 44, 36, 28);
  hi.addColorStop(0, 'rgba(255,255,255,1)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi;
  g.fillRect(0, 0, 128, 128);
  return canvasTex(c);
}

// ---- sound: electromechanical chimes, flipper coils, the knocker -----------------------

let audio = null;
function wakeAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { audio = null; }
}

function ready() { return audio && audio.state === 'running' ? audio : null; }

// A struck chime bar: a few inharmonic partials, ringing down.
function chime(freq, vol = 0.09, dur = 1.1) {
  const a = ready();
  if (!a) return;
  const t = a.currentTime, out = a.createGain();
  out.gain.setValueAtTime(vol, t);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out.connect(a.destination);
  for (const [m, gain] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
    const o = a.createOscillator(), og = a.createGain();
    o.frequency.value = freq * m;
    og.gain.value = gain;
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + dur);
  }
}

// Classic three-chime box: 10s ring high, 100s middle, 1000s low.
function chimeFor(n) {
  if (n >= 1000) chime(392);
  else if (n >= 100) chime(523);
  else if (n > 0) chime(784, 0.06, 0.7);
}

function thump(freq, vol, dur) {
  const a = ready();
  if (!a) return;
  const t = a.currentTime, o = a.createOscillator(), gn = a.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(a.destination);
  o.start(t);
  o.stop(t + dur);
}

function thunk(vol = 0.18) { thump(140, vol, 0.08); }      // a flipper coil
function knock() { thump(70, 0.35, 0.18); }                 // the knocker: replay / extra ball
