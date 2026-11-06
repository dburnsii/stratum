// Tower Defense (Stratum app): a tabletop board with a random winding road;
// waves walk it from the portal to the castle, towers beside it shoot them.
//
// Shared: one device (ctx.sync host) runs the game; it applies everyone's
// events (build / upgrade / sell / wave / new map) and streams snapshots
// (~10 Hz while a wave is on); the others draw them, carrying enemies forward
// along the road between snapshots. A lone device is its own host.
//
// The play area: placing it asks for the board's shape (pinch its corners on
// the table or floor: any outline, play-area kit), kept in the instance
// config. The game lays itself out in it: square cells wholly inside the
// outline, sized to the area (bigger areas, bigger cells), and a road
// through them from a seed (a random maze over every other cell, portal and
// castle on far-apart edges, as long as the road share the game picks for
// that seed). Corners + seed = the board, so every device builds the same one.
//
// Frame: the instance frame, y up, meters; the board lies on y = 0. The
// board itself is built in board units (a cell = CELL) and scaled by k.
import { PlayArea, cellsInside, area as polyArea, pointIn } from '/js/apps/kit/playarea.js';

const CELL = 0.04;               // board units (m when k = 1)
const TARGET_CELLS = 200;        // bigger areas get bigger cells, not more of them
const MAX_K = 4;                 // (16 cm cells on the floor)
const MIN_CELLS = 40;
const ROAD_SHARE = [0.26, 0.38]; // of the cells; the seed picks within it
const CLASSIC = [[-0.3405, -0.2205], [0.3405, -0.2205], [0.3405, 0.2205], [-0.3405, 0.2205]];   // 17 × 11 (the board before play areas)
const RIM = { t: 0.015, h: 0.022 };
const STEP = 1 / 30;             // host simulation step (s)
const SNAP_MS = 100;
const START = { gold: 160, lives: 20 };
const EARLY_BONUS = 15;          // gold for calling a wave while one is still on
const SELL_BACK = 0.7;
const FLY_Y = 0.07;
const BTN = 0.034;               // picker button size (m)
const POKE_R = 0.012;            // fingertip this far inside a button's edge presses it

// Classic towers. range in cells, dmg per hit, rate shots / s; per level:
// dmg × 1.6, range and rate + 12 %.
const TOWERS = {
  arrow: { name: 'Arrow', icon: '🏹', cost: 50, range: 2.6, dmg: 7, rate: 2.2, air: true, color: 0x9c6b3c, about: 'Quick shots, hits flyers' },
  cannon: { name: 'Cannon', icon: '💣', cost: 90, range: 2.4, dmg: 20, rate: 0.7, splash: 1.1, air: false, color: 0x5c5f66, about: 'Splash damage, ground only' },
  frost: { name: 'Frost', icon: '❄️', cost: 70, range: 2.2, dmg: 3, rate: 1.0, slow: 0.5, slowS: 1.8, air: true, color: 0x74c0fc, about: 'Slows everything near it' },
  sniper: { name: 'Sniper', icon: '🎯', cost: 120, range: 5.5, dmg: 60, rate: 0.4, air: true, strongest: true, color: 0x495057, about: 'Long range, picks the toughest' },
  tesla: { name: 'Tesla', icon: '⚡', cost: 110, range: 2.3, dmg: 13, rate: 1.1, chain: 3, air: true, color: 0xd9480f, about: 'Lightning jumps between enemies' },
};
const TYPES = Object.keys(TOWERS);
const MAX_LVL = 3;

// Enemies: speed in cells / s, hp at wave 1 (× 1.13 per wave), armor taken off each hit.
const ENEMIES = {
  grunt: { name: 'Grunts', speed: 1.0, hp: 30, reward: 5, color: 0xe03131, size: 0.011 },
  runner: { name: 'Runners', speed: 1.9, hp: 18, reward: 6, color: 0xfab005, size: 0.008 },
  tank: { name: 'Tanks', speed: 0.6, hp: 120, armor: 3, reward: 12, color: 0x868e96, size: 0.015 },
  flyer: { name: 'Flyers', speed: 1.2, hp: 35, reward: 8, fly: true, color: 0x9c36b5, size: 0.01 },
  swarm: { name: 'Swarm', speed: 1.4, hp: 10, reward: 2, color: 0x66a80f, size: 0.006 },
  boss: { name: 'Boss', speed: 0.45, hp: 900, armor: 5, reward: 100, lives: 10, color: 0x5f0f40, size: 0.022 },
};
const EN_TYPES = Object.keys(ENEMIES);

let THREE;

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const t = (ctx.td = { enemies: new Map(), fx: [], buttons: [], acc: 0, snapAt: 0, sel: null, towerMeshes: [], dirty: true, tipsIn: new Set(), g: null, L: null });
    t.room = ctx.sync({
      onState: (s) => adopt(ctx, s),
      onEvent: (e) => { if (t.room.isHost && t.g) apply(ctx, e); },
      onHost: (isHost) => { if (isHost) t.dirty = true; updateHud(ctx); },
    });
    const saved = await ctx.state.get(saveKey(ctx)).catch(() => null);
    t.group = new THREE.Group();
    ctx.spawn(t.group);
    buildHud(ctx);
    buildWaveButton(ctx);
    t.picker = new THREE.Group();
    t.group.add(t.picker);
    setActions(ctx);
    window.__td = {   // test hook
      ctx, build: (c, r, type) => t.room.event({ t: 'build', c, r, type }), wave: () => t.room.event({ t: 'wave' }),
      game: () => t.g, step: (n) => { for (let i = 0; i < n; i++) simulate(ctx); }, buildable: () => buildableCells(t),
      upgrade: (i) => t.room.event({ t: 'up', i }), sell: (i) => t.room.event({ t: 'sell', i }), select: (c, r) => select(ctx, c, r),
      cellCenter: (c, r) => cellPos(t.L, c, r, 0.018).multiplyScalar(t.L.k).toArray(),
      add: (o, d) => addCorner(ctx, { origin: new THREE.Vector3(...o), dir: new THREE.Vector3(...d).normalize() }),
      done: () => finishSetup(ctx), classic: () => finishSetup(ctx, CLASSIC), setup: () => beginSetup(ctx),
      shot: (shot) => fxShot(ctx, shot), fx: (dt) => drawFx(ctx, dt), fxLeft: () => t.fx.length,
      layout: (corners) => { const L = makeLayout(corners); return { k: L.k, cells: L.cells.length, road: makeRoad(L, 1)?.cells.length ?? 0 }; },
    };
    // Boards from before play areas had no corners: they're the classic 17 × 11.
    const corners = ctx.instance.config?.corners ?? (saved ? CLASSIC : null);
    if (corners) useArea(ctx, corners, saved); else beginSetup(ctx);
  },

  frame(ctx, dt) {
    const t = ctx.td;
    if (!t) return;
    facePlayer(ctx, t.setupPanel);
    if (t.setup || !t.g) { pokeButtons(ctx); return; }
    if (t.room.isHost) {
      t.acc = Math.min(t.acc + dt, 0.25);
      while (t.acc >= STEP) { simulate(ctx); t.acc -= STEP; }
      const now = performance.now();
      if ((t.g.active && now - t.snapAt > SNAP_MS) || t.dirty) { t.snapAt = now; t.dirty = false; broadcast(ctx); }
    } else {
      for (const e of t.g.enemies) e.d += speedOf(e) * dt;   // carried forward between snapshots
    }
    drawEnemies(ctx, dt);
    drawFx(ctx, dt);
    facePlayer(ctx, t.picker);
    facePlayer(ctx, t.panel);
    pokeButtons(ctx);
  },

  // While setting the area, any pinch / tap (not on the panel) is a corner.
  globalPress(ctx) { return !!ctx.td?.setup; },
  aim(ctx, ray) { return ctx.td?.setup && ctx.td.area ? ctx.td.area.aim(ray) : null; },   // (the cursor dot: where the corner would go)
  // Taps / pinches / triggers: buttons, then squares of the board.
  press(ctx, e) {
    const t = ctx.td;
    if (!t) return false;
    if (e.phase !== 'down') return !!(t.g || t.setup);
    const b = buttonOf(e.object);
    if (b) { pressButton(ctx, b); return true; }
    if (t.setup) { const ray = e.ray?.(); if (ray) addCorner(ctx, ray); return true; }
    if (!t.g || !e.point) return false;
    const L = t.L, c = Math.floor((e.point.x / L.k - L.x0) / CELL), r = Math.floor((e.point.z / L.k - L.z0) / CELL);
    if (!L.inside.has(key(c, r))) return false;   // the margin and the rim: the host's (move the board)
    select(ctx, c, r);
    return true;
  },
  // Holding still anywhere on it moves it (a tap plays it): not on its buttons /
  // the picker, not while setting the area. A picker that the press opened closes.
  grab(ctx, e) {
    const t = ctx.td;
    if (!t) return;
    if (t.setup || buttonOf(e.object)) { e.preventDefault(); return; }
    if (t.sel) { t.sel = null; refreshPicker(ctx, true); }
  },

  async stop(ctx) {
    const t = ctx.td;
    if (t?.room?.isHost && t.g) save(ctx);
    t?.area?.dispose();
    if (window.__td?.ctx === ctx) delete window.__td;
  },
};

function setActions(ctx) {
  const t = ctx.td;
  ctx.actions([
    { label: '▶ Next wave', run: () => t.g && t.room.event({ t: 'wave' }) },
    { label: '🗺 New map', run: () => t.g && t.room.event({ t: 'new', seed: randomSeed() }) },
    { label: '↺ Restart this map', run: () => t.g && t.room.event({ t: 'new', seed: t.g.seed }) },
    { label: '📐 Change the play area', run: () => beginSetup(ctx) },
  ]);
}

// ---- the play area ------------------------------------------------------------------------------

const key = (c, r) => c * 1000 + r;
const unkey = (k) => [Math.floor(k / 1000), k % 1000];

function areaSig(corners) {   // FNV-1a over the corners in mm
  let h = 0x811c9dc5;
  for (const ch of corners.map(([x, z]) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`).join(';')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}

// The cells of an outline (corners in meters): k = meters per board unit.
function makeLayout(corners) {
  const k = Math.min(MAX_K, Math.max(1, Math.sqrt(polyArea(corners) / TARGET_CELLS) / CELL));
  const poly = corners.map(([x, z]) => [x / k, z / k]);
  const cells = cellsInside(poly, CELL);
  return { corners, k, poly, cells, inside: new Set(cells.map(({ c, r }) => key(c, r))),
    x0: Math.min(...poly.map((p) => p[0])), z0: Math.min(...poly.map((p) => p[1])), sig: areaSig(corners) };
}

const cellPos = (L, c, r, y = 0) => new THREE.Vector3(L.x0 + (c + 0.5) * CELL, y, L.z0 + (r + 0.5) * CELL);
const panelScale = (L) => 1 + (L.k - 1) * 0.5;

// Start the game on an outline: the saved board if it was this outline's, else a new game.
function useArea(ctx, corners, saved = null) {
  const t = ctx.td, L = makeLayout(corners);
  if (!makeRoad(L, 1)) { beginSetup(ctx); ctx.log('That play area is too small for a road: set a bigger one'); return; }
  const old = t.g;
  t.L = L;
  t.g = saved && savedFits(saved, L) ? fromSave(saved, L) : newGame(old?.seed ?? saved?.seed ?? randomSeed(), L);
  if (old) t.g.best = Math.max(t.g.best, old.best);
  t.sel = null;
  t.dirty = true;
  buildBoard(ctx);
  refreshPicker(ctx, true);
  updateHud(ctx);
  if (t.room.isHost) save(ctx);
}

function beginSetup(ctx) {
  const t = ctx.td;
  endSetup(ctx);
  t.setup = { had: !!t.L };
  t.area = new PlayArea(THREE, { y: 0.003, color: 0x8ce99a });
  t.group.add(t.area.group);
  t.sel = null;
  refreshPicker(ctx, true);
  for (const o of [t.board, t.panel]) if (o) o.visible = false;
  buildSetupPanel(ctx);
  ctx.status('🏰 Pinch the corners of the play area');
}

function addCorner(ctx, ray) {
  const t = ctx.td;
  if (!t.setup || t.area.corners.length >= 32) return false;
  const ok = t.area.add(ray);
  drawSetupPanel(ctx);
  return ok;
}

// What the outline in progress would make: null (not an outline yet), or { cells, ok }.
function setupCheck(corners) {
  if (corners.length < 3) return null;
  const L = makeLayout(corners);
  return { cells: L.cells.length, ok: L.cells.length >= MIN_CELLS && !!makeRoad(L, 1) };
}

function finishSetup(ctx, preset = null) {
  const t = ctx.td;
  if (!t.setup) return false;
  if (!preset && !t.area.valid) return false;
  const corners = (preset ?? t.area.corners).map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]);
  if (!setupCheck(corners)?.ok) return false;
  endSetup(ctx);
  ctx.setConfig({ ...(ctx.instance.config ?? {}), corners });   // shared: the others restart on it (the host with a new game)
  useArea(ctx, corners);
  return true;
}

function endSetup(ctx) {
  const t = ctx.td;
  t.setup = null;
  t.area?.dispose();
  t.area = null;
  if (t.setupPanel) {
    for (const m of t.setupPanel.children) { const b = m.userData.btn; if (b) t.buttons.splice(t.buttons.indexOf(b), 1); }
    t.setupPanel.removeFromParent();
    t.setupPanel = null;
  }
  for (const o of [t.board, t.panel]) if (o) o.visible = true;
  ctx.status('');
}

const SETUP = { w: 0.3, h: 0.17, y: 0.2 };

function buildSetupPanel(ctx) {
  const t = ctx.td, g = (t.setupPanel = new THREE.Group());
  g.position.set(0, SETUP.y, 0);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(SETUP.w, SETUP.h), new THREE.MeshBasicMaterial({ color: 0x14210f, transparent: true, opacity: 0.92 }));
  back.raycast = () => {};
  g.add(back);
  const canvas = Object.assign(document.createElement('canvas'), { width: 1024, height: Math.round(1024 * 0.1 / (SETUP.w - 0.02)) });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const text = new THREE.Mesh(new THREE.PlaneGeometry(SETUP.w - 0.02, 0.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  text.position.set(0, 0.03, 0.001);
  text.raycast = () => {};
  g.add(text);
  t.setupText = { canvas, tex };
  const defs = [
    ['↶', '#495057', () => { t.area.undo(); drawSetupPanel(ctx); }],
    ['✓', '#2b8a3e', () => { if (!finishSetup(ctx)) ctx.log('Pinch at least 3 corners around a big enough area'); }],
    ['▭', '#1971c2', () => finishSetup(ctx, CLASSIC)],
  ];
  if (t.setup.had) defs.push(['✕', '#c92a2a', () => { endSetup(ctx); ctx.status(''); }]);
  const bw = 0.06, gap = 0.008;
  defs.forEach(([label, color, run], i) => {
    const b = makeButton(ctx, bw, 0.04, (c, w, h) => {
      roundRect(c, w, h, color, 'rgba(255,255,255,0.6)');
      c.fillStyle = '#fff'; c.font = `700 ${h * 0.55}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, w / 2, h * 0.55);
    }, run);
    b.mesh.position.set((i - (defs.length - 1) / 2) * (bw + gap), -0.052, 0.002);
    g.add(b.mesh);
  });
  t.group.add(g);
  facePlayer(ctx, g);
  drawSetupPanel(ctx);
}

function drawSetupPanel(ctx) {
  const t = ctx.td;
  if (!t.setup || !t.setupText) return;
  const { canvas, tex } = t.setupText, c = canvas.getContext('2d'), n = t.area.corners.length, check = setupCheck(t.area.corners);
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#fff'; c.font = '700 52px system-ui, sans-serif'; c.textBaseline = 'middle';
  c.fillText('Set the play area', 20, 48);
  c.font = '36px system-ui, sans-serif'; c.fillStyle = '#b2f2bb';
  c.fillText(n < 3 ? `Pinch each corner on the table or floor (${n} so far)` : `${n} corners · ${check.cells} squares: more corners, or ✓`, 20, 122);
  const bad = n >= 3 && (!t.area.valid ? 'The outline crosses itself: ↶ undo' : !check.ok ? 'Too small for a road: make it bigger' : '');
  c.fillStyle = bad ? '#ff8787' : '#868e96';
  c.fillText(bad || 'Any shape. ▭ = the classic board.', 20, 186);
  tex.needsUpdate = true;
}

// ---- the road ---------------------------------------------------------------------------------

function rng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const randomSeed = () => (Math.random() * 2 ** 31) | 0;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The road through a layout: a random maze (spanning tree by randomized
// depth-first search) over every other cell both ways, so there's a grass
// row between lanes; the route through the tree between two nodes at the
// outline that are far apart, the one closest to the road share this seed
// picks. → { cells: [[c, r]…] (portal end first), d0, d1 (outward at each
// end) }, or null if the area can't hold a road.
function makeRoad(L, seed) {
  const R = rng(seed), inside = (c, r) => L.inside.has(key(c, r));
  // Nodes: the parity with the biggest connected set.
  let nodes = [];
  for (const pc of [0, 1]) for (const pr of [0, 1]) {
    const set = new Set(L.cells.filter(({ c, r }) => c % 2 === pc && r % 2 === pr).map(({ c, r }) => key(c, r)));
    const seen = new Set();
    for (const k0 of set) {
      if (seen.has(k0)) continue;
      const comp = [k0];
      seen.add(k0);
      for (let i = 0; i < comp.length; i++) {
        const [c, r] = unkey(comp[i]);
        for (const [dc, dr] of DIRS) { const n = key(c + 2 * dc, r + 2 * dr); if (set.has(n) && !seen.has(n) && inside(c + dc, r + dr)) { seen.add(n); comp.push(n); } }
      }
      if (comp.length > nodes.length) nodes = comp;
    }
  }
  if (nodes.length < 4) return null;
  nodes.sort((a, b) => a - b);   // (same order on every device)
  const nodeSet = new Set(nodes);
  const link = (k0) => { const [c, r] = unkey(k0); return DIRS.map(([dc, dr]) => key(c + 2 * dc, r + 2 * dr)).filter((n, i) => nodeSet.has(n) && inside(c + DIRS[i][0], r + DIRS[i][1])); };
  // Ends: nodes at the outline (the next cell out, or the one after, isn't in).
  const ends = [];
  for (const k0 of nodes) {
    const [c, r] = unkey(k0);
    for (const d of DIRS) {
      if (!inside(c + d[0], r + d[1])) { ends.push({ k: k0, d, ext: [] }); break; }
      if (!inside(c + 2 * d[0], r + 2 * d[1])) { ends.push({ k: k0, d, ext: [[c + d[0], r + d[1]]] }); break; }
    }
  }
  if (ends.length < 2) return null;
  let span = 0;
  for (const a of L.poly) for (const b of L.poly) span = Math.max(span, Math.hypot(a[0] - b[0], a[1] - b[1]));
  const far = (a, b) => { const [ac, ar] = unkey(a.k), [bc, br] = unkey(b.k); return Math.hypot(ac - bc, ar - br) * CELL >= 0.45 * span; };
  const target = Math.round(L.cells.length * (ROAD_SHARE[0] + R() * (ROAD_SHARE[1] - ROAD_SHARE[0])));
  let best = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    // A spanning tree.
    const adj = new Map(nodes.map((n) => [n, []])), seen = new Set(), stack = [nodes[Math.floor(R() * nodes.length)]];
    seen.add(stack[0]);
    while (stack.length) {
      const cur = stack.at(-1), next = link(cur).filter((n) => !seen.has(n));
      if (!next.length) { stack.pop(); continue; }
      const n = next[Math.floor(R() * next.length)];
      seen.add(n); adj.get(cur).push(n); adj.get(n).push(cur); stack.push(n);
    }
    // Routes between far-apart ends (from a sample of them).
    const from = [...ends].sort(() => R() - 0.5).slice(0, 12);
    for (const a of from) {
      const prev = new Map([[a.k, null]]), dist = new Map([[a.k, 0]]), q = [a.k];
      for (let i = 0; i < q.length; i++) for (const n of adj.get(q[i])) if (!prev.has(n)) { prev.set(n, q[i]); dist.set(n, dist.get(q[i]) + 1); q.push(n); }
      for (const b of ends) {
        if (b.k === a.k || !dist.has(b.k) || !far(a, b)) continue;
        const len = 2 * dist.get(b.k) + 1 + a.ext.length + b.ext.length, score = Math.abs(len - target);
        if (best && score >= best.score) continue;
        const path = [];
        for (let k0 = b.k; k0 != null; k0 = prev.get(k0)) path.unshift(k0);
        best = { score, a, b, path };
      }
    }
    if (best?.score === 0) break;
  }
  if (!best) return null;
  const cells = [...best.a.ext];
  best.path.forEach((k0, i) => {
    const [c, r] = unkey(k0);
    if (i) { const [pc, pr] = unkey(best.path[i - 1]); cells.push([(pc + c) / 2, (pr + r) / 2]); }
    cells.push([c, r]);
  });
  cells.push(...best.b.ext);
  return { cells, d0: best.a.d, d1: best.b.d };
}

function roadOf(g) {
  if (g.road?.seed === g.seed && g.road.L === g.L) return g.road;
  const L = g.L, made = makeRoad(L, g.seed), cells = made.cells;
  const pts = cells.map(([c, r]) => cellPos(L, c, r));
  // Start just off the board, end just past it (on the rim).
  pts.unshift(pts[0].clone().add(new THREE.Vector3(made.d0[0] * CELL, 0, made.d0[1] * CELL)));
  pts.push(pts.at(-1).clone().add(new THREE.Vector3(made.d1[0] * CELL, 0, made.d1[1] * CELL)));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const onRoad = new Set(cells.map(([c, r]) => key(c, r)));
  g.road = { seed: g.seed, L, cells, pts, cum, len: cum.at(-1), onRoad, d0: made.d0, d1: made.d1, fly: [pts[0], pts.at(-1)], flyLen: pts[0].distanceTo(pts.at(-1)) };
  return g.road;
}

// Where an enemy is: d along the road (flyers: along the straight line), board units.
function enemyPos(g, e, out = new THREE.Vector3()) {
  const road = roadOf(g);
  if (ENEMIES[e.type].fly) return out.lerpVectors(road.fly[0], road.fly[1], Math.min(1, e.d / road.flyLen)).setY(FLY_Y);
  const d = Math.min(e.d, road.len);
  let i = 1;
  while (i < road.cum.length - 1 && road.cum[i] < d) i++;
  const a = road.pts[i - 1], b = road.pts[i], k = (d - road.cum[i - 1]) / Math.max(1e-6, road.cum[i] - road.cum[i - 1]);
  return out.lerpVectors(a, b, THREE.MathUtils.clamp(k, 0, 1));
}

const routeLen = (g, e) => (ENEMIES[e.type].fly ? roadOf(g).flyLen : roadOf(g).len);

function buildableCells(t) {
  if (!t.g) return [];
  const road = roadOf(t.g), used = new Set(t.g.towers.map((w) => key(w.c, w.r)));
  return t.g.L.cells.filter(({ c, r }) => !road.onRoad.has(key(c, r)) && !used.has(key(c, r))).map(({ c, r }) => [c, r]);
}

// ---- the game (host) -------------------------------------------------------------------------

// (L: the layout, not sent or saved: every device makes it from the corners.)
function newGame(seed, L) {
  return { seed, L, gold: START.gold, lives: START.lives, wave: 0, towers: [], enemies: [], queue: [], waveT: 0, active: false, over: false, nextId: 1, best: 0, shots: [] };
}

const saveKey = (ctx) => `board:${ctx.instance.id}`;

// A save is this board's if it was made on the same outline (saves from before play areas: the classic board).
const savedFits = (s, L) => (s.v === 2 ? s.ar === L.sig : s.v === 1 && L.sig === areaSig(CLASSIC));

function fromSave(s, L) {
  const g = { ...newGame(s.seed, L), gold: s.gold, lives: s.lives, wave: s.wave, best: s.best ?? 0, over: !!s.over };
  const road = roadOf(g);
  g.towers = (s.towers ?? []).map(([c, r, type, lvl, spent]) => ({ c, r, type, lvl, spent, cool: 0 }))
    .filter((w) => L.inside.has(key(w.c, w.r)) && !road.onRoad.has(key(w.c, w.r)));
  return g;
}

function save(ctx) {
  const g = ctx.td.g;
  ctx.state.set(saveKey(ctx), { v: 2, ar: g.L.sig, seed: g.seed, gold: g.gold, lives: g.lives, wave: g.wave, best: g.best, over: g.over,
    towers: g.towers.map((w) => [w.c, w.r, w.type, w.lvl, w.spent]) }).catch(() => {});
}

function stats(w) {
  const s = TOWERS[w.type], k = w.lvl - 1;
  return { ...s, dmg: s.dmg * 1.6 ** k, range: s.range * (1 + 0.12 * k), rate: s.rate * (1 + 0.12 * k), chain: (s.chain ?? 0) + k, slow: s.slow ? Math.min(0.7, s.slow + 0.08 * k) : 0 };
}
const upgradeCost = (w) => Math.round(TOWERS[w.type].cost * 0.8 * w.lvl);
const hpScale = (n) => 1.13 ** (n - 1);

// What wave n sends: groups of one kind each, spaced out.
function waveOf(n) {
  const out = [];
  let at = 0;
  const add = (type, count, gap) => { for (let i = 0; i < count; i++) { out.push({ type, at }); at += gap; } at += 1.2; };
  if (n % 10 === 0) { add('grunt', 4 + n / 2, 0.7); add('boss', 1 + Math.floor(n / 30), 2); }
  else if (n % 5 === 0) add('flyer', 6 + n, 0.6);
  else if (n % 7 === 0) add('swarm', 16 + 2 * n, 0.22);
  else {
    add('grunt', 5 + n, 0.8);
    if (n >= 3) add('runner', 3 + Math.floor(n * 0.8), 0.45);
    if (n >= 4) add('tank', 1 + Math.floor(n / 3), 1.6);
    if (n >= 8 && n % 2 === 0) add('flyer', Math.floor(n / 2), 0.7);
  }
  return out;
}

const waveText = (n) => [...new Set(waveOf(n).map((s) => s.type))].map((k) => ENEMIES[k].name).join(' + ');

function apply(ctx, e) {
  const t = ctx.td, g = t.g;
  if (e.t === 'new') { t.g = newGame(e.seed ?? randomSeed(), g.L); t.g.best = g.best; return afterChange(ctx, true); }
  if (g.over && e.t !== 'wave') return;
  if (e.t === 'build') {
    const s = TOWERS[e.type], at = key(e.c, e.r);
    if (!s || !g.L.inside.has(at) || roadOf(g).onRoad.has(at) || g.towers.some((w) => key(w.c, w.r) === at) || g.gold < s.cost) return;
    g.gold -= s.cost;
    g.towers.push({ c: e.c, r: e.r, type: e.type, lvl: 1, spent: s.cost, cool: 0 });
  } else if (e.t === 'up') {
    const w = g.towers[e.i];
    if (!w || w.lvl >= MAX_LVL || g.gold < upgradeCost(w)) return;
    g.gold -= upgradeCost(w);
    w.spent += upgradeCost(w);
    w.lvl++;
  } else if (e.t === 'sell') {
    const w = g.towers[e.i];
    if (!w) return;
    g.gold += Math.round(w.spent * SELL_BACK);
    g.towers.splice(e.i, 1);
  } else if (e.t === 'wave') {
    if (g.over) { t.g = newGame(g.seed, g.L); t.g.best = g.best; return afterChange(ctx, true); }
    if (g.active) g.gold += EARLY_BONUS;
    g.wave++;
    const offset = g.active ? Math.max(g.waveT, ...g.queue.map((q) => q.at)) + 1 : 0;
    if (!g.active) g.waveT = 0;
    for (const q of waveOf(g.wave)) g.queue.push({ type: q.type, at: q.at + offset, n: g.wave });
    g.active = true;
    ctx.telemetry?.('towers wave', { wave: g.wave, towers: g.towers.length, gold: g.gold, lives: g.lives });
  }
  afterChange(ctx, !g.active);
}

function afterChange(ctx, persist) {
  const t = ctx.td;
  t.dirty = true;
  if (t.boardSeed !== t.g.seed) { t.sel = null; buildBoard(ctx); }
  syncTowers(ctx);
  refreshPicker(ctx);
  updateHud(ctx);
  if (persist && t.room.isHost) save(ctx);
}

const speedOf = (e) => ENEMIES[e.type].speed * CELL * (e.slow ? 0.5 : 1);

function simulate(ctx) {
  const t = ctx.td, g = t.g;
  if (!g.active) return;
  g.waveT += STEP;
  // Spawn.
  while (g.queue.length && g.queue[0].at <= g.waveT) {
    const q = g.queue.shift(), s = ENEMIES[q.type], hp = Math.round(s.hp * hpScale(q.n));
    g.enemies.push({ id: g.nextId++, type: q.type, d: 0, hp, max: hp, slowUntil: 0, slow: false });
    updateHud(ctx);
  }
  // Move; through the castle gate costs lives.
  for (const e of g.enemies) {
    e.slow = g.waveT < e.slowUntil;
    e.d += speedOf(e) * STEP;
    if (e.d >= routeLen(g, e)) { e.gone = true; g.lives -= ENEMIES[e.type].lives ?? 1; }
  }
  // Towers.
  const pos = new Map(g.enemies.filter((e) => !e.gone).map((e) => [e.id, enemyPos(g, e)]));
  g.towers.forEach((w, i) => {
    w.cool -= STEP;
    if (w.cool > 0) return;
    const s = stats(w), at = cellPos(g.L, w.c, w.r), reach = s.range * CELL;
    const inRange = g.enemies.filter((e) => !e.gone && e.hp > 0 && (s.air || !ENEMIES[e.type].fly) && flat(pos.get(e.id), at) <= reach);
    if (!inRange.length) return;
    w.cool = 1 / s.rate;
    const hit = (e, dmg) => { e.hp -= Math.max(1, dmg - (ENEMIES[e.type].armor ?? 0)); };
    const shot = { i, k: w.type, p: [] };
    if (s.slow) {   // frost: a pulse on everything in range
      for (const e of inRange) { hit(e, s.dmg); e.slowUntil = g.waveT + s.slowS; shot.p.push(pos.get(e.id)); }
    } else {
      inRange.sort(s.strongest ? (a, b) => b.hp - a.hp : (a, b) => b.d / routeLen(g, b) - a.d / routeLen(g, a));   // sniper: toughest; others: first in line
      const first = inRange[0];
      shot.p.push(pos.get(first.id));
      if (s.splash) {
        const p0 = pos.get(first.id);
        for (const e of g.enemies) if (!e.gone && !ENEMIES[e.type].fly && flat(pos.get(e.id) ?? p0, p0) <= s.splash * CELL) hit(e, s.dmg);
      } else if (s.chain) {
        let cur = first, left = s.chain, dmg = s.dmg;
        const done = new Set();
        while (cur && left-- > 0) {
          hit(cur, dmg); done.add(cur.id);
          if (cur !== first) shot.p.push(pos.get(cur.id));
          const from = pos.get(cur.id);
          cur = g.enemies.filter((e) => !e.gone && e.hp > 0 && !done.has(e.id) && flat(pos.get(e.id), from) <= 1.6 * CELL)
            .sort((a, b) => flat(pos.get(a.id), from) - flat(pos.get(b.id), from))[0];
          dmg *= 0.8;
        }
      } else hit(first, s.dmg);
    }
    g.shots.push(shot);
    fxShot(ctx, shot);
  });
  // The fallen.
  for (const e of g.enemies) if (e.hp <= 0 && !e.gone) { e.gone = true; g.gold += ENEMIES[e.type].reward; t.dirty = true; }
  const before = g.enemies.length;
  g.enemies = g.enemies.filter((e) => !e.gone);
  if (g.enemies.length !== before) updateHud(ctx);
  if (g.lives <= 0) {
    g.lives = 0; g.over = true; g.active = false; g.enemies = []; g.queue = [];
    g.best = Math.max(g.best, g.wave - 1);
    ctx.telemetry?.('towers over', { wave: g.wave, towers: g.towers.length });
    return afterChange(ctx, true);
  }
  if (!g.queue.length && !g.enemies.length) {   // wave cleared
    g.active = false;
    g.gold += 20 + 5 * g.wave;
    g.best = Math.max(g.best, g.wave);
    afterChange(ctx, true);
  }
}

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---- sharing --------------------------------------------------------------------------------------

function broadcast(ctx) {
  const t = ctx.td, g = t.g;
  const r = (x) => Math.round(x * 1000) / 1000;
  t.room.state({
    s: g.seed, ar: g.L.sig, g: g.gold, l: g.lives, w: g.wave, a: g.active, o: g.over, b: g.best, q: g.queue.length,
    t: g.towers.map((w) => [w.c, w.r, TYPES.indexOf(w.type), w.lvl, w.spent]),
    e: g.enemies.map((e) => [e.id, EN_TYPES.indexOf(e.type), r(e.d), Math.round((100 * e.hp) / e.max), e.slow ? 1 : 0]),
    x: g.shots.splice(0).map((s) => [TYPES.indexOf(s.k), s.i, ...s.p.flatMap((p) => [r(p.x), r(p.y), r(p.z)])]),
  });
}

function adopt(ctx, s) {
  const t = ctx.td;
  if (!t.L || t.setup || s.ar !== t.L.sig) return;   // (another outline: the config change restarts us onto it)
  const g = t.g?.seed === s.s ? t.g : newGame(s.s, t.L);
  Object.assign(g, { seed: s.s, gold: s.g, lives: s.l, wave: s.w, active: s.a, over: s.o, best: s.b, queue: Array(s.q ?? 0).fill(null) });
  g.towers = s.t.map(([c, r, k, lvl, spent]) => ({ c, r, type: TYPES[k], lvl, spent, cool: 0 }));
  g.enemies = s.e.map(([id, k, d, pct, slow]) => ({ id, type: EN_TYPES[k], d, hp: pct, max: 100, slow: !!slow }));
  const seedChanged = t.g !== g || t.boardSeed !== g.seed;
  t.g = g;
  if (seedChanged) buildBoard(ctx);
  for (const [k, i, ...xyz] of s.x ?? []) {
    const p = [];
    for (let j = 0; j + 2 < xyz.length; j += 3) p.push(new THREE.Vector3(xyz[j], xyz[j + 1], xyz[j + 2]));
    fxShot(ctx, { k: TYPES[k], i, p });
  }
  syncTowers(ctx);
  refreshPicker(ctx);
  updateHud(ctx);
}

// ---- board ----------------------------------------------------------------------------------------

function buildBoard(ctx) {
  const t = ctx.td, g = t.g, L = g.L, road = roadOf(g);
  t.boardSeed = g.seed;
  t.board?.removeFromParent();
  const b = (t.board = new THREE.Group());
  b.scale.setScalar(L.k);
  t.group.add(b);
  // A tray the shape of the play area: a meadow base and a wooden rim along
  // the outline (both handles: hold them to move the board).
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
  const shape = new THREE.Shape(L.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false }).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4f6b2a, roughness: 0.95 }));
  base.userData.handle = true;
  b.add(base);
  const n = L.poly.length, out = [];   // each edge's outward normal
  for (let i = 0; i < n; i++) {
    const [ax, az] = L.poly[i], [bx, bz] = L.poly[(i + 1) % n], len = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / len, nz = -(bx - ax) / len;
    if (pointIn(L.poly, (ax + bx) / 2 + nx * 0.002, (az + bz) / 2 + nz * 0.002)) { nx = -nx; nz = -nz; }
    out.push([nx, nz]);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(len, RIM.h, RIM.t), wood);
    rim.position.set((ax + bx) / 2 + nx * RIM.t / 2, RIM.h / 2, (az + bz) / 2 + nz * RIM.t / 2);
    rim.rotation.y = Math.atan2(-(bz - az), bx - ax);
    rim.userData.handle = true;
    b.add(rim);
  }
  const postGeo = new THREE.CylinderGeometry(RIM.t * 0.62, RIM.t * 0.62, RIM.h + 0.004, 14);
  L.poly.forEach(([x, z], i) => {   // corner posts close the joints
    const [n1x, n1z] = out[(i + n - 1) % n], [n2x, n2z] = out[i], l = Math.hypot(n1x + n2x, n1z + n2z) || 1;
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(x + ((n1x + n2x) / l) * RIM.t / 2, (RIM.h + 0.004) / 2, z + ((n1z + n2z) / l) * RIM.t / 2);
    post.userData.handle = true;
    b.add(post);
  });
  // Tiles: grass (buildable, a little raised) and the road (sandy, lower).
  const R = rng(g.seed ^ 0x5bd1e995);
  const grassCells = [], roadCells = road.cells;
  for (const { c, r } of L.cells) if (!road.onRoad.has(key(c, r))) grassCells.push([c, r]);
  const tile = (cells, h, y, color, vary) => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(CELL * 0.97, h, CELL * 0.97), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), cells.length);
    const mat = new THREE.Matrix4(), col = new THREE.Color();
    cells.forEach(([c, r], i) => {
      m.setMatrixAt(i, mat.makeTranslation(cellPos(L, c, r, y)));
      m.setColorAt(i, col.set(color).offsetHSL(0, 0, (R() - 0.5) * vary));
    });
    b.add(m);
    return m;
  };
  t.grass = tile(grassCells, 0.008, 0.014, 0x5c940d, 0.08);
  t.roadMesh = tile(roadCells, 0.004, 0.012, 0xc9a66b, 0.05);
  // A few pebbles along the road's edges.
  const pebble = new THREE.InstancedMesh(new THREE.SphereGeometry(0.003, 6, 4), new THREE.MeshStandardMaterial({ color: 0x8d8173, roughness: 1 }), 60);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 60; i++) {
    const [c, r] = roadCells[Math.floor(R() * roadCells.length)];
    const [pc, pr] = [c, r].map((v) => Math.round(v)), along = road.cells.find(([x, y]) => Math.abs(x - pc) + Math.abs(y - pr) === 1);
    const side = along && along[0] !== pc ? [0, 1] : [1, 0];   // beside the road, not across it
    const p = cellPos(L, c, r, 0.015).add(new THREE.Vector3(side[0] * (R() > 0.5 ? 1 : -1) * CELL * 0.45 + side[1] * (R() - 0.5) * CELL * 0.9, 0, side[1] * (R() > 0.5 ? 1 : -1) * CELL * 0.45 + side[0] * (R() - 0.5) * CELL * 0.9));
    pebble.setMatrixAt(i, m4.compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 0.6, 1).multiplyScalar(0.6 + R())));
  }
  b.add(pebble);
  // Portal (start) and castle (end).
  const portal = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 8, 24), new THREE.MeshStandardMaterial({ color: 0x9c36b5, emissive: 0x6741d9, emissiveIntensity: 0.8 }));
  portal.position.copy(road.pts[0]).setY(0.03);
  portal.rotation.y = Math.atan2(road.d0[0], road.d0[1]);   // the ring faces along the road
  b.add(portal);
  t.portal = portal;
  const castle = new THREE.Group(), stone = new THREE.MeshStandardMaterial({ color: 0xadb5bd, roughness: 0.8 });
  const keep = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.04), stone);
  keep.position.y = 0.0175;
  castle.add(keep);
  for (const z of [-0.02, 0.02]) {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.05, 10), stone);
    tw.position.set(0, 0.025, z);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.014, 10), new THREE.MeshStandardMaterial({ color: 0x1c7ed6 }));
    roof.position.set(0, 0.057, z);
    castle.add(tw, roof);
  }
  castle.position.copy(road.pts.at(-1)).setY(0.01);
  castle.rotation.y = Math.atan2(road.d1[0], road.d1[1]) + Math.PI / 2;   // its gate on the road
  b.add(castle);
  // The HUD and wave button: over the castle, a little out from the board.
  const ps = panelScale(L), c1 = road.pts.at(-1);
  t.panel.position.set(c1.x * L.k + road.d1[0] * 0.05 * ps, 0.13 * ps, c1.z * L.k + road.d1[1] * 0.05 * ps);
  t.panel.scale.setScalar(ps);
  // Selection square.
  t.selMesh = new THREE.Mesh(new THREE.RingGeometry(CELL * 0.42, CELL * 0.5, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  t.selMesh.visible = false;
  b.add(t.selMesh);
  t.rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
  t.rangeRing.visible = false;
  b.add(t.rangeRing);
  for (const m of t.towerMeshes) m.removeFromParent();
  t.towerMeshes = [];
  for (const e of t.enemies.values()) e.mesh.removeFromParent();
  t.enemies.clear();
  syncTowers(ctx);
}

// ---- towers (meshes) ------------------------------------------------------------------------------

function towerMesh(type, lvl) {
  const s = TOWERS[type], g = new THREE.Group();
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.008, 12), mat(0x868e96));
  base.position.y = 0.022;
  g.add(base);
  const head = new THREE.Group();
  g.head = head;
  if (type === 'arrow') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.03, 8), mat(s.color));
    body.position.y = 0.041;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.014, 8), mat(0xa61e4d));
    roof.position.y = 0.063;
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.003, 0.003), mat(0x5c3d1e));
    bow.position.set(0, 0.052, 0.01);
    g.add(body, roof);
    head.add(bow);
  } else if (type === 'cannon') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.016, 10), mat(0x6c757d));
    body.position.y = 0.034;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.022, 10).rotateX(Math.PI / 2), mat(0x212529, { metalness: 0.6 }));
    barrel.position.set(0, 0.046, 0.008);
    g.add(body);
    head.add(barrel);
  } else if (type === 'frost') {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.022, 8), mat(0xdee2e6));
    pillar.position.y = 0.037;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.01), mat(s.color, { emissive: 0x339af0, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }));
    crystal.position.y = 0.062;
    g.add(pillar);
    head.add(crystal);
    g.spin = crystal;
  } else if (type === 'sniper') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.01, 0.05, 8), mat(s.color));
    body.position.y = 0.051;
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.01), mat(0x343a40));
    scope.position.y = 0.079;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.03, 6).rotateX(Math.PI / 2), mat(0x212529, { metalness: 0.7 }));
    barrel.position.set(0, 0.079, 0.016);
    g.add(body);
    head.add(scope, barrel);
  } else {   // tesla
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.03, 10), mat(0xb87333, { metalness: 0.7, roughness: 0.3 }));
    coil.position.y = 0.041;
    for (let k = 0; k < 4; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0015, 6, 16).rotateX(Math.PI / 2), mat(0xb87333, { metalness: 0.8, roughness: 0.3 }));
      ring.position.y = 0.03 + k * 0.007;
      g.add(ring);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), mat(0xffd8a8, { emissive: 0xff922b, emissiveIntensity: 0.9 }));
    ball.position.y = 0.062;
    g.add(coil, ball);
  }
  g.add(head);
  // Level pips: gold dots on the base.
  for (let k = 0; k < lvl; k++) {
    const pip = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 8, 6), mat(0xfcc419, { emissive: 0xf59f00, emissiveIntensity: 0.6 }));
    const a = Math.PI / 2 + (k - (lvl - 1) / 2) * 0.5;
    pip.position.set(Math.cos(a) * 0.015, 0.026, Math.sin(a) * 0.015);
    g.add(pip);
  }
  g.scale.setScalar(1 + 0.08 * (lvl - 1));
  return g;
}

function syncTowers(ctx) {
  const t = ctx.td;
  if (!t.board) return;
  const want = t.g.towers;
  want.forEach((w, i) => {
    const sig = `${w.c},${w.r},${w.type},${w.lvl}`;
    if (t.towerMeshes[i]?.userData.sig === sig) return;
    t.towerMeshes[i]?.removeFromParent();
    const m = towerMesh(w.type, w.lvl);
    m.userData.sig = sig;
    m.position.copy(cellPos(t.L, w.c, w.r));
    t.board.add(m);
    t.towerMeshes[i] = m;
  });
  for (const m of t.towerMeshes.splice(want.length)) m.removeFromParent();
}

// ---- enemies (meshes) -----------------------------------------------------------------------------

function enemyMesh(type) {
  const s = ENEMIES[type], g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5 });
  if (type === 'tank') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(s.size * 1.6, s.size, s.size * 1.2), mat);
    body.position.y = s.size * 0.5;
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(s.size * 0.4, s.size * 0.45, s.size * 0.4, 10), mat);
    turret.position.y = s.size * 1.15;
    g.add(body, turret);
  } else if (type === 'flyer') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(s.size * 0.6, 10, 8), mat);
    const wings = new THREE.Mesh(new THREE.BoxGeometry(s.size * 0.5, s.size * 0.08, s.size * 2.6), new THREE.MeshStandardMaterial({ color: 0xd0bfff, transparent: true, opacity: 0.8 }));
    g.add(body, wings);
    g.wings = wings;
  } else if (type === 'boss') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(s.size * 0.7, 14, 10), mat);
    body.position.y = s.size * 0.8;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(s.size * 0.35, s.size * 0.4, s.size * 0.3, 6, 1, true), new THREE.MeshStandardMaterial({ color: 0xfcc419, metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }));
    crown.position.y = s.size * 1.55;
    g.add(body, crown);
  } else {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(s.size * 0.45, s.size * 0.6, 4, 8), mat);
    body.position.y = s.size * 0.75;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(s.size * 0.16, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    eye.position.set(s.size * 0.42, s.size * 1.0, 0);
    g.add(body, eye);
  }
  // Health bar (always faces you).
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x212529, depthWrite: false }));
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x51cf66, depthWrite: false }));
  for (const sp of [bg, fg]) { sp.raycast = () => {}; sp.center.set(0, 0.5); sp.scale.set(0.02, 0.003, 1); sp.position.set(-0.01, s.size * 2 + 0.006, 0); }
  fg.position.z += 0.0002;
  g.add(bg, fg);
  g.bar = fg;
  return g;
}

function drawEnemies(ctx, dt) {
  const t = ctx.td, g = t.g, seen = new Set(), p = new THREE.Vector3(), ahead = new THREE.Vector3();
  for (const e of g.enemies) {
    seen.add(e.id);
    let v = t.enemies.get(e.id);
    if (!v) { v = { mesh: enemyMesh(e.type) }; t.board.add(v.mesh); t.enemies.set(e.id, v); }
    enemyPos(g, e, p);
    enemyPos(g, { ...e, d: e.d + 0.004 }, ahead);
    const bob = ENEMIES[e.type].fly ? Math.sin(performance.now() / 180 + e.id) * 0.004 : Math.abs(Math.sin(performance.now() / 120 + e.id)) * 0.002;
    v.mesh.position.set(p.x, p.y + 0.016 + bob, p.z);
    if (ahead.distanceToSquared(p) > 1e-10) v.mesh.rotation.y = Math.atan2(-(ahead.z - p.z), ahead.x - p.x);
    if (v.mesh.wings) v.mesh.wings.rotation.x = Math.sin(performance.now() / 50) * 0.4;
    const frac = THREE.MathUtils.clamp(e.hp / e.max, 0, 1);
    v.mesh.bar.scale.x = 0.02 * frac;
    v.mesh.bar.material.color.setHex(e.slow ? 0x74c0fc : frac > 0.5 ? 0x51cf66 : frac > 0.25 ? 0xfcc419 : 0xff6b6b);
  }
  for (const [id, v] of t.enemies) if (!seen.has(id)) { v.mesh.removeFromParent(); t.enemies.delete(id); fxPop(ctx, v.mesh.position); }
  t.portal.rotation.x += dt * 2;
  for (const m of t.towerMeshes) if (m.spin) m.spin.rotation.y += dt * 1.5;
}

// ---- effects ------------------------------------------------------------------------------------------

function fxShot(ctx, shot) {
  const t = ctx.td, w = t.g.towers[shot.i], tm = t.towerMeshes[shot.i];
  if (!w || !shot.p.length) return;
  const from = cellPos(t.L, w.c, w.r, shot.k === 'sniper' ? 0.08 : 0.05), to = shot.p[0].clone().setY(shot.p[0].y + 0.012);
  if (tm?.head) tm.head.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  if (shot.k === 'frost') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xa5d8ff, transparent: true, opacity: 0.7, depthWrite: false }));
    ring.position.copy(cellPos(t.L, w.c, w.r, 0.02));
    ring.scale.setScalar(0.01);   // (unit geometry: never shown at 1 m)
    t.board.add(ring);
    t.fx.push({ mesh: ring, age: 0, life: 0.45, kind: 'ring', r: stats(w).range * CELL });
  } else if (shot.k === 'tesla' || shot.k === 'sniper') {
    const pts = [from];
    for (const p of shot.p) {
      const a = pts.at(-1), b = p.clone().setY(p.y + 0.012);
      if (shot.k === 'tesla') for (let k = 1; k < 4; k++) pts.push(a.clone().lerp(b, k / 4).add(new THREE.Vector3((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.008)));
      pts.push(b);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: shot.k === 'tesla' ? 0xffe066 : 0xffffff, transparent: true }));
    t.board.add(line);
    t.fx.push({ mesh: line, age: 0, life: shot.k === 'tesla' ? 0.15 : 0.1, kind: 'flash' });
  } else {   // arrow / cannon: a projectile flying over
    const ball = new THREE.Mesh(new THREE.SphereGeometry(shot.k === 'cannon' ? 0.004 : 0.0022, 8, 6), new THREE.MeshBasicMaterial({ color: shot.k === 'cannon' ? 0x212529 : 0xffe8a1 }));
    ball.position.copy(from);
    t.board.add(ball);
    t.fx.push({ mesh: ball, age: 0, life: shot.k === 'cannon' ? 0.3 : 0.15, kind: 'shot', from, to, arc: shot.k === 'cannon' ? 0.03 : 0.005, boom: shot.k === 'cannon' });
  }
}

function fxPop(ctx, at) {
  const t = ctx.td;
  const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
  puff.position.copy(at);
  puff.scale.setScalar(0.4 * 0.012);
  t.board.add(puff);
  t.fx.push({ mesh: puff, age: 0, life: 0.25, kind: 'puff', r: 0.012 });
}

function drawFx(ctx, dt) {
  const t = ctx.td, born = [];   // (effects started here join after the sweep: pushed into t.fx they'd be lost, stuck in the scene)
  t.fx = t.fx.filter((f) => {
    f.age += dt;
    const k = Math.min(1, f.age / f.life);
    if (f.kind === 'ring') { f.mesh.scale.setScalar(Math.max(0.01, f.r * k)); f.mesh.material.opacity = 0.7 * (1 - k); }
    else if (f.kind === 'flash') f.mesh.material.opacity = 1 - k;
    else if (f.kind === 'puff') { f.mesh.scale.setScalar(f.r * (0.4 + k)); f.mesh.material.opacity = 0.7 * (1 - k); }
    else if (f.kind === 'shot') {
      f.mesh.position.lerpVectors(f.from, f.to, k);
      f.mesh.position.y += Math.sin(k * Math.PI) * f.arc;
      if (k >= 1 && f.boom) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff922b, transparent: true, opacity: 0.8, depthWrite: false }));
        b.position.copy(f.to);
        t.board.add(b);
        b.scale.setScalar(0.4 * TOWERS.cannon.splash * CELL);
        born.push({ mesh: b, age: 0, life: 0.3, kind: 'puff', r: TOWERS.cannon.splash * CELL });
      }
    }
    if (k >= 1) { f.mesh.removeFromParent(); f.mesh.geometry?.dispose(); f.mesh.material?.dispose(); }
    return k < 1;
  });
  t.fx.push(...born);
}

// ---- buttons, picker, HUD -------------------------------------------------------------------------------

// A flat button with canvas art; draw(g, w, h) paints it. Poke it, pinch it, tap it.
function makeButton(ctx, w, h, draw, run) {
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(256 * w / h), height: 256 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const b = { mesh, w, h, run, enabled: true, redraw: (...args) => { const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); draw(g, canvas.width, canvas.height, ...args); tex.needsUpdate = true; } };
  mesh.userData.btn = b;
  b.redraw();
  ctx.td.buttons.push(b);
  return b;
}

const buttonOf = (node) => { for (let n = node; n; n = n.parent) if (n.userData?.btn) return n.userData.btn; return null; };

function pressButton(ctx, b) {
  const now = performance.now();
  if (!b.enabled || !b.mesh.visible || now - (b.at ?? -1e9) < 350) return;
  b.at = now;
  b.mesh.scale.setScalar(0.88);
  setTimeout(() => b.mesh.scale.setScalar(1), 120);
  b.run();
}

function roundRect(g, w, h, fill, stroke) {
  g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, Math.min(w, h) * 0.2);
  g.fillStyle = fill; g.fill();
  if (stroke) { g.lineWidth = 6; g.strokeStyle = stroke; g.stroke(); }
}

function buildWaveButton(ctx) {
  const t = ctx.td;
  const b = makeButton(ctx, 0.09, 0.034, (g, w, h) => {
    const s = t.g ?? newGame(0, null), label = s.over ? '↺ New game' : s.active ? `⏩ Wave ${s.wave + 1}  +${EARLY_BONUS}` : `▶ Wave ${s.wave + 1}`;
    roundRect(g, w, h, s.over ? '#c92a2a' : s.active ? '#e8590c' : '#2f9e44', 'rgba(255,255,255,0.6)');
    g.fillStyle = '#fff'; g.font = `800 ${h * 0.42}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h * 0.53);
  }, () => t.g && t.room.event({ t: 'wave' }));
  b.mesh.position.set(0, -0.06, 0);
  t.panel.add(b.mesh);
  t.waveBtn = b;
}

function buildHud(ctx) {
  const t = ctx.td;
  const canvas = Object.assign(document.createElement('canvas'), { width: 768, height: 160 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.075), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  mesh.userData.handle = true;
  // The HUD and the wave button float over the castle, facing you.
  t.panel = new THREE.Group();
  t.panel.add(mesh);
  t.group.add(t.panel);
  t.hud = { canvas, tex, mesh };
}

function updateHud(ctx) {
  const t = ctx.td, g = t.g;
  if (!t.hud || !g) return;
  const sig = `${g.gold}|${g.lives}|${g.wave}|${g.active}|${g.over}|${g.enemies.length}|${g.queue.length}|${g.best}`;
  if (sig === t.hudSig) return;
  t.hudSig = sig;
  const c = t.hud.canvas.getContext('2d');
  c.clearRect(0, 0, 768, 160);
  roundRect(c, 768, 160, 'rgba(12,14,20,0.85)');
  c.fillStyle = '#fff'; c.font = '700 46px system-ui, sans-serif'; c.textBaseline = 'middle';
  c.fillText(`🪙 ${g.gold}    ❤️ ${g.lives}    🌊 ${g.wave}`, 28, 52);
  c.font = '30px system-ui, sans-serif'; c.fillStyle = '#c9ced8';
  const line = g.over ? `Game over at wave ${g.wave} · best ${g.best}` : g.active ? `Wave ${g.wave}: ${g.enemies.length + g.queue.length} left · next: ${waveText(g.wave + 1)}` : `Next: ${waveText(g.wave + 1)} · best wave ${g.best}`;
  c.fillText(line.slice(0, 48), 28, 118);
  t.hud.tex.needsUpdate = true;
  t.waveBtn?.redraw();
  ctx.status(`🏰 ${g.over ? 'Game over' : `Wave ${g.wave}`} · ❤️ ${g.lives} · 🪙 ${g.gold}`);
  refreshPicker(ctx);
}

// Tap / pinch a square: the build menu (grass) or the tower's menu; again to close.
function select(ctx, c, r) {
  const t = ctx.td, road = roadOf(t.g);
  if (!t.L.inside.has(key(c, r)) || road.onRoad.has(key(c, r)) || (t.sel && t.sel.c === c && t.sel.r === r)) t.sel = null;
  else t.sel = { c, r };
  refreshPicker(ctx, true);
}

function refreshPicker(ctx, force = false) {
  const t = ctx.td;
  if (!t.picker || !t.selMesh) return;
  const sel = t.g ? t.sel : null, ti = sel ? t.g.towers.findIndex((w) => w.c === sel.c && w.r === sel.r) : -1;
  const sig = sel ? `${sel.c},${sel.r},${ti},${ti >= 0 ? t.g.towers[ti].lvl : 0},${t.g.gold},${t.g.over}` : '';
  if (!force && sig === t.pickSig) return;
  t.pickSig = sig;
  for (const b of t.picker.children.map((m) => m.userData.btn).filter(Boolean)) t.buttons.splice(t.buttons.indexOf(b), 1);
  t.picker.clear();
  t.selMesh.visible = !!sel;
  t.rangeRing.visible = false;
  if (!sel) return;
  t.selMesh.position.copy(cellPos(t.L, sel.c, sel.r, 0.0195));
  t.picker.position.copy(cellPos(t.L, sel.c, sel.r, 0.11)).multiplyScalar(t.L.k);
  t.picker.scale.setScalar(panelScale(t.L));
  const items = [];
  const card = (title, sub, color, enabled, run) => items.push(makeButton(ctx, BTN, BTN * 1.15, (g, w, h) => {
    roundRect(g, w, h, enabled ? color : '#495057', 'rgba(255,255,255,0.7)');
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${h * 0.36}px system-ui, sans-serif`; g.fillText(title, w / 2, h * 0.38);
    g.fillStyle = enabled ? '#fff' : '#adb5bd'; g.font = `700 ${h * 0.2}px system-ui, sans-serif`; g.fillText(sub, w / 2, h * 0.78);
  }, run));
  if (ti < 0) {
    for (const k of TYPES) {
      const s = TOWERS[k];
      card(s.icon, `${s.cost}`, '#364fc7', t.g.gold >= s.cost && !t.g.over, () => { t.room.event({ t: 'build', c: sel.c, r: sel.r, type: k }); });
    }
  } else {
    const w = t.g.towers[ti];
    const up = w.lvl < MAX_LVL ? upgradeCost(w) : null;
    card('⬆️', up == null ? 'MAX' : `${up}`, '#2b8a3e', up != null && t.g.gold >= up, () => t.room.event({ t: 'up', i: ti }));
    card('💰', `+${Math.round(w.spent * SELL_BACK)}`, '#c92a2a', true, () => { t.room.event({ t: 'sell', i: ti }); t.sel = null; refreshPicker(ctx, true); });
    card('✕', 'close', '#495057', true, () => { t.sel = null; refreshPicker(ctx, true); });
    t.rangeRing.visible = true;
    t.rangeRing.position.copy(cellPos(t.L, w.c, w.r, 0.02));
    t.rangeRing.scale.setScalar(stats(w).range * CELL);
  }
  items.forEach((b, i) => { b.enabled = true; b.mesh.position.x = (i - (items.length - 1) / 2) * (BTN + 0.006); t.picker.add(b.mesh); });
  // (Greyed ones still take the press, as no-ops, so it doesn't fall through to the board.)
  const name = ti < 0 ? 'Build' : `${TOWERS[t.g.towers[ti].type].name} · level ${t.g.towers[ti].lvl}`;
  const label = makeButton(ctx, BTN * 4, BTN * 0.42, (g, w, h) => {
    roundRect(g, w, h, 'rgba(12,14,20,0.8)');
    g.fillStyle = '#fff'; g.font = `600 ${h * 0.36}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ti < 0 ? `${name}: 🏹 arrow 💣 cannon ❄️ frost 🎯 sniper ⚡ tesla` : `${name} · ${TOWERS[t.g.towers[ti].type].about}`, w / 2, h * 0.55);
  }, () => {});
  label.mesh.position.y = BTN * 0.9;
  t.picker.add(label.mesh);
}

// Floating panels (the picker, the HUD, setup) turn to face you.
function facePlayer(ctx, o) {
  const v = ctx.viewer();
  if (!v || !o?.children.length) return;
  o.rotation.y = Math.atan2(v.position.x - o.position.x, v.position.z - o.position.z);
}

// Fingertips press buttons they move into.
function pokeButtons(ctx) {
  const t = ctx.td, hands = ctx.hands?.();
  if (!hands) { t.tipsIn.clear(); return; }
  const now = new Set();
  for (const side of ['left', 'right']) {
    const h = hands[side];
    if (!h) continue;
    const tip = h.joints[9];
    for (const b of t.buttons) {
      if (!b.mesh.visible || !b.mesh.parent) continue;
      b.mesh.updateWorldMatrix(true, false);
      const local = ctx.toLocal(b.mesh.getWorldPosition(new THREE.Vector3()));
      const reach = (Math.max(b.w, b.h) / 2 + POKE_R * 0.5) * (b.mesh.parent?.scale.x ?? 1);
      if (tip.distanceTo(local) < reach * (h.scale ?? 1)) {
        const key = `${side}|${t.buttons.indexOf(b)}`;
        now.add(key);
        if (!t.tipsIn.has(key)) pressButton(ctx, b);
      }
    }
  }
  t.tipsIn = now;
}
