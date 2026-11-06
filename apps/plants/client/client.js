// Plants (Stratum app): realistic potted plants, grown procedurally. Each
// plant's life (growth, soil moisture, health) runs on the plants backend;
// we draw it from those numbers plus a seed (the instance id), so every
// device sees the same plant. Watering goes through the backend, which
// tells everyone in the plant's channel.
//
// Instance frame: origin at the pot's floor center, y up, meters. The whole
// plant is a grab handle (drag it anywhere); tap selects it, and the
// context bar shows 💧 Water / ⏩ Time-lapse / Replant.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let THREE;
const POLL_MS = 60_000;
const LAPSE_S = 6;                 // time-lapse: seedling → full size

const POTS = {   // bottom radius, top radius, height (m)
  succulent: { rb: 0.038, rt: 0.05, h: 0.058 },
  snake: { rb: 0.052, rt: 0.066, h: 0.105 },
  pothos: { rb: 0.048, rt: 0.064, h: 0.082 },
};

export default {
  // A grown, healthy plant of each species (the platform's place chooser).
  preview(T, variant) {
    THREE = T;
    const species = POTS[variant] ? variant : 'succulent';
    const ctx = { instance: { id: `preview-${species}` }, plant: { data: { species, planted: 0 }, root: new THREE.Group() } };
    buildPot(ctx);
    buildPlant(ctx, { g: 0.85, wilt: 0, dead: false });
    return ctx.plant.root;
  },

  async start(ctx) {
    THREE = ctx.THREE;
    const p = (ctx.plant = { data: null, built: null, lapse: null, drops: [], wet: 0 });
    ctx.channel(ctx.instance.id, (msg) => onMessage(ctx, msg));
    await refresh(ctx);
    p.root = ctx.spawn(new THREE.Group());
    buildPot(ctx);
    p.poll = setInterval(() => refresh(ctx).catch(() => {}), POLL_MS);
    (window.__plants ??= new Map()).set(ctx.instance.id, ctx);   // test hook
  },

  frame(ctx, dt) {
    const p = ctx.plant;
    if (!p.root || !p.data) return;
    const secs = ctx.now() / 1000;
    let g = p.data.growth;
    if (p.lapse) {                                   // replay the growth so far, fast
      p.lapse.t += dt;
      const u = Math.min(1, p.lapse.t / (Number(ctx.settings?.get('lapse')) || LAPSE_S));
      g = THREE.MathUtils.lerp(0.02, p.lapse.to, u * u * (3 - 2 * u));
      if (u >= 1) p.lapse = null;
    }
    const look = appearance(p.data, g);
    const key = `${p.data.species}|${look.g.toFixed(p.lapse ? 2 : 3)}|${look.wilt.toFixed(2)}|${p.data.alive}`;
    if (key !== p.builtKey && (!p.lapse || secs - (p.lastBuild ?? 0) > 1 / 15)) {
      p.builtKey = key;
      p.lastBuild = secs;
      buildPlant(ctx, look);
    }
    if (p.built) {   // a breath of air
      p.built.rotation.z = Math.sin(secs * 0.7 + p.phase) * 0.012 * (1 - look.wilt);
      p.built.rotation.x = Math.sin(secs * 0.53 + p.phase * 2) * 0.008 * (1 - look.wilt);
    }
    // Soil darkens when wet (eased).
    const wetTarget = THREE.MathUtils.clamp(p.data.moisture / 0.8, 0, 1);
    p.wet += (wetTarget - p.wet) * Math.min(1, dt * 2);
    p.soil.material.color.setScalar(THREE.MathUtils.lerp(1, 0.5, p.wet));
    p.soil.material.roughness = THREE.MathUtils.lerp(1, 0.55, p.wet);
    updateDrops(ctx, dt);
    updateStatus(ctx);
  },

  async stop(ctx) {
    clearInterval(ctx.plant?.poll);
    window.__plants?.delete(ctx.instance.id);
  },
};

// ---- backend ------------------------------------------------------------------------

async function refresh(ctx) {
  const species = ctx.instance.config?.species ?? '';
  const q = new URLSearchParams({ ...(species && { species }), ...(ctx.instance.temporary && { temp: '1' }) });
  setData(ctx, await ctx.backend.get(`/plants/${ctx.instance.id}?${q}`));
}

function setData(ctx, data) {
  const p = ctx.plant;
  const replanted = p.data && data.planted !== p.data.planted;
  p.data = data;
  if (p.root && (replanted || p.potSpecies !== data.species)) buildPot(ctx);
  setActions(ctx);
}

function setActions(ctx) {
  const d = ctx.plant.data;
  ctx.actions([
    ...(d.alive ? [{ label: '💧 Water', run: () => water(ctx) }] : []),
    { label: '⏩ Time-lapse', run: () => { ctx.plant.lapse = { t: 0, to: ctx.plant.data.growth }; } },
    { label: d.alive ? '↺ Replant' : '🌱 Replant', run: () => ctx.backend.post(`/plants/${ctx.instance.id}/replant`).then((v) => setData(ctx, v)) },
  ]);
}

async function water(ctx) {
  try {
    setData(ctx, await ctx.backend.post(`/plants/${ctx.instance.id}/water`));   // the broadcast pours it for everyone
  } catch (err) {
    ctx.log(`watering failed: ${err.message}`);
  }
}

function onMessage(ctx, msg) {
  if (msg.type === 'watered') { pour(ctx); setData(ctx, msg.plant); }
  else if (msg.type === 'replanted') setData(ctx, msg.plant);
}

function updateStatus(ctx) {
  const d = ctx.plant.data;
  const state = !d.alive ? 'dead' : d.health < 0.5 ? 'wilting' : d.thirsty ? 'thirsty' : d.moisture > 1 ? 'soggy' : d.stage;
  ctx.status(`${d.name} · ${state} · soil ${Math.round(Math.min(1, d.moisture) * 100)}% wet`);
}

// Growth/health → what to draw. wilt: 0 fresh … 1 collapsed.
function appearance(d, g) {
  const thirst = d.alive && d.thirsty ? 0.2 : 0;
  return { g, wilt: d.alive ? Math.max(thirst, Math.min(1, (1 - d.health) * 1.2)) : 1, dead: !d.alive };
}

// ---- pot, soil, shadow ------------------------------------------------------------

function buildPot(ctx) {
  const p = ctx.plant;
  p.pot?.removeFromParent();
  const species = p.data.species;
  const { rb, rt, h } = POTS[species];
  const pot = (p.pot = new THREE.Group());
  p.potSpecies = species;
  const lip = 0.006, rimH = 0.014, wall = 0.005;
  const profile = [[0, 0], [rb - 0.002, 0], [rb, 0.003], [rt, h - rimH], [rt + lip, h - rimH], [rt + lip, h - 0.002], [rt + lip - 0.002, h],
    [rt - wall, h], [rt - wall, h - rimH], [rb - wall, wall + 0.004], [0, wall + 0.004]].map(([x, y]) => new THREE.Vector2(x, y));
  const terracotta = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), new THREE.MeshStandardMaterial({ map: textures().terracotta, roughness: 0.93 }));
  const soilY = h - 0.016;
  p.soil = new THREE.Mesh(new THREE.CircleGeometry(rt - wall - 0.0005 - (rt - rb) * (0.016 / h), 40).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: textures().soil, roughness: 1 }));
  p.soil.position.y = soilY;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(rb * 4.4, rb * 4.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: textures().shadow, transparent: true, depthWrite: false }));
  shadow.position.y = 0.0015;
  shadow.renderOrder = -1;
  pot.add(terracotta, p.soil, shadow);
  for (const m of [terracotta, p.soil]) m.userData.handle = true;   // grab the pot anywhere to move it
  p.root.add(pot);
  p.soilY = soilY;
  p.seed = hashString(ctx.instance.id + p.data.planted);
  p.phase = (p.seed % 1000) / 160;
  p.builtKey = null;   // rebuild the plant on the new soil
}

// ---- the plant ---------------------------------------------------------------------

function buildPlant(ctx, look) {
  const p = ctx.plant;
  if (p.built) { p.built.removeFromParent(); p.built.traverse((n) => n.geometry?.dispose()); }
  const rng = mulberry(p.seed);   // same plant every rebuild; growth only changes sizes
  const group = (p.built = new THREE.Group());
  group.position.y = p.soilY;
  const parts = { succulent, snake, pothos }[p.data.species](rng, look, POTS[p.data.species]);
  for (const { geos, material } of parts) {
    if (!geos.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.userData.handle = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  p.root.add(group);
}

// Echeveria-style rosette: thick spoon leaves on the golden angle, outer
// ones older, bigger and flatter; powdery blue-green with blushing tips.
function succulent(rng, { g, wilt, dead }) {
  const geos = [];
  const n = Math.round(9 + g * 40);
  const S = 0.32 + 0.68 * g;
  const base = new THREE.Color(0x7aab9c), tip = new THREE.Color(0xd07f8e), inner = new THREE.Color(0x9cc792);
  const dry = new THREE.Color(0x9c8455), deadC = new THREE.Color(0x6e5a3e);
  for (let k = 0; k < n; k++) {
    const rel = n > 1 ? k / (n - 1) : 1;                         // 0 outer/old … 1 inner/new
    const L = S * (0.016 + 0.034 * Math.pow(1 - rel, 0.75)) * (0.92 + rng() * 0.16);
    const az = k * 2.39996 + rng() * 0.05;
    const outerWilt = wilt * (1 - rel * 0.7);                    // outer leaves go first
    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(12, 78, Math.pow(rel, 0.8))) - outerWilt * 0.5;
    const col = (t) => {
      const c = base.clone().lerp(inner, rel * 0.6).lerp(tip, Math.pow(t, 3) * 0.75 * (1 - rel * 0.5));
      if (dead) return c.lerp(deadC, 0.85);
      return c.lerp(dry, outerWilt * 0.8);
    };
    const geo = leafGeometry({
      length: L, width: L * 0.58, thickness: L * (0.2 + 0.08 * rel) * (1 - outerWilt * 0.65),
      shape: (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.68)), 0.75) * (1 - Math.pow(t, 10) * 0.4),
      curve: 0.45 - outerWilt * 1.4, fold: 0.12, color: col, segL: 9, segW: 5,
    });
    place(geo, outwardBasis(az, elev, 0), new THREE.Vector3(Math.sin(az), 0, Math.cos(az)).multiplyScalar(S * 0.004 * (1 - rel)).setY(0.002 + rel * 0.004 * S));
    geos.push(geo);
  }
  return [{ geos, material: materials().succulent }];
}

// Sansevieria: upright sword leaves with dark wavy bands and yellow margins.
function snake(rng, { g, wilt, dead }) {
  const geos = [];
  const n = Math.round(3 + g * 8);
  const yellowed = new THREE.Color(0xb59a52), deadC = new THREE.Color(0x8a7046);
  for (let k = 0; k < n; k++) {
    const young = k / Math.max(1, n);                            // later leaves are newer, shorter
    const L = (0.07 + 0.36 * g) * (0.7 + rng() * 0.3) * (1 - young * 0.4);
    const W = (0.022 + 0.022 * g) * (0.85 + rng() * 0.3);
    const az = rng() * Math.PI * 2;
    const r = 0.004 + rng() * 0.018 * (0.4 + g);
    const lean = THREE.MathUtils.degToRad(4 + rng() * 10) + wilt * 0.7 * (0.6 + rng() * 0.4);
    const tint = dead ? deadC.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.1) : new THREE.Color(1, 1, 1).lerp(yellowed, wilt * 0.7);
    const geo = leafGeometry({
      length: L, width: W, thickness: 0.003, fold: 0.55 + wilt * 0.5, twist: (rng() - 0.5) * 1.6,
      shape: (t) => Math.min(1, 0.6 + t * 5) * (t > 0.5 ? Math.pow(Math.cos(((t - 0.5) / 0.5) * Math.PI / 2), 0.8) : 1),
      curve: (rng() - 0.5) * 0.3 - wilt * 0.9, color: () => tint, segL: 14, segW: 3, uvRepeat: L / 0.12,
    });
    place(geo, outwardBasis(az, Math.PI / 2 - lean, rng() * Math.PI), new THREE.Vector3(Math.sin(az) * r, 0, Math.cos(az) * r));
    geos.push(geo);
  }
  return [{ geos, material: dead ? materials().dry : materials().snake }];
}

// Golden pothos: vines that rise, spill over the rim and trail down the
// pot, with heart-shaped, variegated, glossy leaves; tips are new growth.
function pothos(rng, { g, wilt, dead }, pot) {
  const leaves = [], stems = [];
  const vines = 3 + Math.floor(rng() * 2) + (g > 0.6 ? 1 : 0);
  const fresh = new THREE.Color(0xc8e07a), yellowed = new THREE.Color(0xc9b25a), deadC = new THREE.Color(0x8d6b3e);
  for (let v = 0; v < vines; v++) {
    const az = (v / vines) * Math.PI * 2 + rng() * 0.8;
    const dir = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    const rim = pot.rt + 0.012;
    const wander = () => side.clone().multiplyScalar((rng() - 0.5) * 0.05);
    const pts = [
      dir.clone().multiplyScalar(0.006 + rng() * 0.012),
      dir.clone().multiplyScalar(0.02).setY(0.035 + rng() * 0.02),
      dir.clone().multiplyScalar(rim - 0.004).setY(0.03),
      dir.clone().multiplyScalar(rim + 0.012).add(wander()).setY(-0.03),
      dir.clone().multiplyScalar(rim + 0.03).add(wander()).setY(-0.16),
      dir.clone().multiplyScalar(rim + 0.05).add(wander()).setY(-0.34),
      dir.clone().multiplyScalar(rim + 0.06).add(wander()).setY(-0.55),
      dir.clone().multiplyScalar(rim + 0.065).add(wander()).setY(-0.8),
    ];
    // Whatever the pot stands on stops the fall: the vine spreads across it.
    const floor = -(pot.h - 0.016) + 0.003;
    for (const q of pts) {
      if (q.y >= floor) continue;
      const below = floor - q.y;
      q.y = floor;
      q.addScaledVector(dir, below * 0.85).addScaledVector(side, (rng() - 0.5) * below * 0.5);
    }
    const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const total = path.getLength();
    const len = Math.min(total, (0.035 + g * 0.5) * (0.55 + rng() * 0.45));
    const u1 = len / total;
    const sub = new THREE.CatmullRomCurve3(Array.from({ length: 24 }, (_, i) => path.getPointAt((i / 23) * u1)), false, 'centripetal');
    stems.push(new THREE.TubeGeometry(sub, Math.max(6, Math.round(len * 90)), 0.0009 + 0.0008 * g, 5, false));
    // Leaves at nodes; alternate sides.
    const nodes = Math.max(2, Math.floor(len / 0.032));
    for (let i = 0; i < nodes; i++) {
      const s = (i + 1) / nodes;                                 // the last leaf sits at the tip
      const at = sub.getPointAt(Math.min(1, s));
      const tan = sub.getTangentAt(Math.min(1, s));
      const fromTip = (nodes - 1 - i);
      const size = Math.max(0.017, (0.022 + 0.034 * g) * (0.75 + rng() * 0.35) * (fromTip === 0 ? 0.55 : fromTip === 1 ? 0.8 : 1));
      const flip = i % 2 ? 1 : -1;
      const out = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0));
      if (out.lengthSq() < 1e-4) out.copy(side);
      out.normalize().multiplyScalar(flip).add(dir.clone().multiplyScalar(0.8)).normalize();
      const onFloor = at.y < floor + 0.012;                       // lying on the table: leaves lie flat
      const rising = at.y > 0.015 && tan.y > 0.2;                 // young shoot still climbing: leaves held up
      const droop = onFloor ? -0.08 : rising ? -0.35 + wilt * 0.9 : 0.25 + wilt * 0.9 + rng() * 0.2;
      const extend = out.clone().multiplyScalar(Math.cos(droop)).add(new THREE.Vector3(0, -Math.sin(droop), 0)).normalize();
      const face = new THREE.Vector3(0, 1, 0).add(dir.clone().multiplyScalar(0.7)).normalize();
      const newness = fromTip === 0 ? 0.7 : fromTip === 1 ? 0.35 : 0;
      const tint = dead ? deadC.clone().offsetHSL((rng() - 0.5) * 0.04, 0, (rng() - 0.5) * 0.1)
        : new THREE.Color(1, 1, 1).lerp(fresh, newness).lerp(yellowed, wilt * 0.65);
      const geo = leafGeometry({
        length: size, width: size * 0.78, fold: 0.18 + wilt * 0.4, curve: -0.35 - wilt * 0.8,
        shape: (t) => (0.42 + 0.58 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.7)) * (1 - Math.pow(t, 3)) + (t < 0.12 ? (0.12 - t) * 2.5 : 0),
        color: () => tint, segL: 10, segW: 4, notch: true,
      });
      place(geo, basis(extend, onFloor ? new THREE.Vector3(0, 1, 0) : face), at.clone().addScaledVector(out, 0.004).setY(Math.max(at.y, floor + 0.004)));
      leaves.push(geo);
    }
  }
  const m = materials();   // dead: plain brown (a tint can only darken the green texture)
  return [{ geos: stems, material: dead ? m.stemDry : m.stem }, { geos: leaves, material: dead ? m.dry : m.pothos }];
}

// ---- geometry helpers ----------------------------------------------------------------

// A leaf along +Y (base at the origin), width along X, face toward +Z.
//   shape(t) half-width factor 0..1 along the length (t 0 base … 1 tip)
//   curve    bend along the length (rad, + toward the face)
//   fold     V-fold across the midrib (rad); twist (rad, base → tip)
//   thickness 0 = a single double-sided sheet; > 0 = a closed, puffy leaf
//   color(t) vertex color along the length; notch: heart-shaped base
function leafGeometry({ length, width, shape, curve = 0, fold = 0, twist = 0, thickness = 0, color, segL = 10, segW = 4, uvRepeat = 1, notch = false }) {
  const cols = segW * 2 + 1, rows = segL + 1;
  const sides = thickness > 0 ? [1, -1] : [1];
  const pos = [], uv = [], colr = [], idx = [];
  // Midline (bent in the Y-Z plane).
  const mid = [], tang = [];
  let y = 0, z = 0;
  for (let i = 0; i < rows; i++) {
    const t = i / segL;
    const th = curve * t;
    mid.push([y, z]);
    tang.push(th);
    y += Math.cos(th) * (length / segL);
    z += Math.sin(th) * (length / segL);
  }
  for (const sgn of sides) {
    const start = pos.length / 3;
    for (let i = 0; i < rows; i++) {
      const t = i / segL;
      const hw = Math.max(0, shape(t)) * width / 2;
      const th = tang[i], tw = twist * t;
      const c = color(t);
      for (let j = 0; j < cols; j++) {
        const a = j / segW - 1;                                   // -1 … 1 across
        let x = a * hw;
        let n = Math.abs(a) * hw * Math.tan(fold);                // V-fold: edges rise toward the face
        if (thickness > 0) n += sgn * (thickness / 2) * Math.sqrt(Math.max(0, 1 - a * a)) * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05));
        const bz = notch && t < 0.1 ? Math.abs(a) * (0.1 - t) * length * 0.6 : 0;   // heart lobes reach back
        // twist about the midline, then place in the bent frame
        const xr = x * Math.cos(tw) - n * Math.sin(tw), nr = x * Math.sin(tw) + n * Math.cos(tw);
        pos.push(xr, mid[i][0] - Math.sin(th) * nr - bz * Math.cos(th), mid[i][1] + Math.cos(th) * nr - bz * Math.sin(th));
        uv.push((a + 1) / 2, t * uvRepeat);
        colr.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < segL; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = start + i * cols + j, b = a + 1, c2 = a + cols, d = c2 + 1;
        if (sgn > 0) idx.push(a, b, d, a, d, c2); else idx.push(a, d, b, a, c2, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Leaf frame from where it extends (local +Y) and where its face points (+Z).
function basis(extend, face) {
  const Y = extend.clone().normalize();
  const Z = face.clone().sub(Y.clone().multiplyScalar(face.dot(Y))).normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  return new THREE.Matrix4().makeBasis(X, Y, Z);
}

// A leaf pointing outward at azimuth az, raised elev above horizontal,
// face up/inward, rolled by roll about its own axis.
function outwardBasis(az, elev, roll) {
  const out = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
  const extend = out.clone().multiplyScalar(Math.cos(elev)).setY(Math.sin(elev));
  const face = new THREE.Vector3(0, 1, 0).sub(extend.clone().multiplyScalar(extend.y)).normalize();
  const m = basis(extend, face.lengthSq() > 1e-6 ? face : out.clone().negate());
  return roll ? m.multiply(new THREE.Matrix4().makeRotationY(roll)) : m;
}

function place(geo, rot, at) {
  geo.applyMatrix4(rot.clone().setPosition(at));
}

// ---- watering ------------------------------------------------------------------------

function pour(ctx) {
  const p = ctx.plant;
  const { rt } = POTS[p.data.species];
  for (let i = 0; i < 40; i++) {
    const d = new THREE.Mesh(dropGeo(), materials().water);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (rt - 0.012);
    d.position.set(Math.cos(a) * r, p.soilY + 0.16 + Math.random() * 0.08, Math.sin(a) * r);
    d.userData.v = -0.2 - Math.random() * 0.3;
    d.userData.delay = i * 0.02;
    d.visible = false;
    p.root.add(d);
    p.drops.push(d);
  }
}

function updateDrops(ctx, dt) {
  const p = ctx.plant;
  p.drops = p.drops.filter((d) => {
    if ((d.userData.delay -= dt) > 0) return true;
    d.visible = true;
    d.userData.v -= 9.8 * dt * 0.5;
    d.position.y += d.userData.v * dt;
    if (d.position.y > p.soilY) return true;
    d.removeFromParent();
    return false;
  });
}

// ---- materials & textures (shared by every plant) -----------------------------------

let mats = null, texs = null, drop = null;
const dropGeo = () => (drop ??= new THREE.SphereGeometry(0.0022, 6, 4).scale(1, 1.6, 1));

function materials() {
  if (mats) return mats;
  const t = textures();
  mats = {
    succulent: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, sheen: 0.8, sheenColor: 0xe4eef2, sheenRoughness: 0.55, map: t.speckle }),
    snake: new THREE.MeshStandardMaterial({ map: t.snake, vertexColors: true, roughness: 0.4, side: THREE.DoubleSide }),
    pothos: new THREE.MeshPhysicalMaterial({ map: t.pothos, vertexColors: true, roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.35, side: THREE.DoubleSide }),
    stem: new THREE.MeshStandardMaterial({ color: 0x6f8c3c, roughness: 0.6 }),
    stemDry: new THREE.MeshStandardMaterial({ color: 0x7d6843, roughness: 0.85 }),
    dry: new THREE.MeshStandardMaterial({ map: t.speckle, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    water: new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, roughness: 0.05, transparent: true, opacity: 0.55 }),
  };
  return mats;
}

function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function noise(g, w, h, rng, n, size, colors, alpha = 1) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = alpha * (0.3 + rng() * 0.7);
    g.fillStyle = colors[Math.floor(rng() * colors.length)];
    const s = size * (0.4 + rng());
    g.fillRect(rng() * w, rng() * h, s, s);
  }
  g.globalAlpha = 1;
}

function textures() {
  if (texs) return texs;
  const rng = mulberry(7);
  texs = {
    // Terracotta: warm, uneven, darker toward the base, with a faint glaze line at the rim.
    terracotta: canvasTex(512, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#9a5a3c'); grad.addColorStop(0.5, '#b8704a'); grad.addColorStop(1, '#c47d55');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      noise(g, w, h, rng, 9000, 2, ['#a5603f', '#cf8a60', '#8e4f33', '#d79b74'], 0.35);
      noise(g, w, h, rng, 120, 9, ['#e3b08c', '#7f4529'], 0.12);
    }),
    // Potting soil: dark crumbs with a few white perlite specks.
    soil: canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#4a3527'; g.fillRect(0, 0, w, h);
      noise(g, w, h, rng, 6000, 3, ['#3a291e', '#5c4433', '#2c1f17', '#6b5240'], 0.8);
      noise(g, w, h, rng, 60, 3.5, ['#e8e4dc', '#cfc9bf'], 0.9);
    }),
    // Soft contact shadow under the pot.
    shadow: canvasTex(128, 128, (g, w) => {
      const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.5)'); grad.addColorStop(0.45, 'rgba(0,0,0,0.32)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, w, w);
    }, { srgb: false }),
    // Sansevieria leaf (u across, v along; repeats along the length).
    snake: canvasTex(128, 512, (g, w, h) => {
      g.fillStyle = '#2c4a2b'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 10 + rng() * 14) {             // wavy pale bands
        g.strokeStyle = rng() < 0.5 ? 'rgba(150,180,135,0.55)' : 'rgba(120,150,110,0.4)';
        g.lineWidth = 2 + rng() * 4;
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.09 + y) * 4 + (rng() - 0.5) * 2);
        g.stroke();
      }
      noise(g, w, h, rng, 1500, 2, ['#1f3a20', '#3a5a36'], 0.4);
      const edge = g.createLinearGradient(0, 0, w, 0);            // yellow margins (Laurentii)
      edge.addColorStop(0, '#d8c35a'); edge.addColorStop(0.08, '#cbb653'); edge.addColorStop(0.12, 'rgba(203,182,83,0)');
      edge.addColorStop(0.88, 'rgba(203,182,83,0)'); edge.addColorStop(0.92, '#cbb653'); edge.addColorStop(1, '#d8c35a');
      g.fillStyle = edge; g.fillRect(0, 0, w, h);
    }, { repeat: true }),
    // Golden pothos leaf: green with cream-yellow streaks fanning from the base, pale midrib.
    pothos: canvasTex(256, 256, (g, w, h) => {
      const base = g.createLinearGradient(0, 0, w, 0);
      base.addColorStop(0, '#2b5f22'); base.addColorStop(0.5, '#33702a'); base.addColorStop(1, '#2b5f22');
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      noise(g, w, h, rng, 1200, 3, ['#28591f', '#3a7a2f'], 0.4);
      for (let i = 0; i < 26; i++) {
        const side = rng() < 0.5 ? -1 : 1, spread = rng();
        g.strokeStyle = `rgba(${200 + rng() * 30},${200 + rng() * 25},${120 + rng() * 40},${0.12 + rng() * 0.3})`;
        g.lineWidth = 0.8 + rng() * 2.5;
        g.beginPath();
        g.moveTo(w / 2, rng() * h * 0.3);
        g.quadraticCurveTo(w / 2 + side * spread * w * 0.25, h * (0.3 + rng() * 0.3), w / 2 + side * spread * w * 0.48, h * (0.4 + rng() * 0.55));
        g.stroke();
      }
      g.strokeStyle = 'rgba(190,215,140,0.8)'; g.lineWidth = 3;   // midrib
      g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
      g.strokeStyle = 'rgba(25,60,20,0.35)'; g.lineWidth = 1.5;   // side veins
      for (let y = 0.12; y < 0.9; y += 0.11) for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(w / 2, h * y); g.quadraticCurveTo(w / 2 + s * w * 0.2, h * (y + 0.04), w / 2 + s * w * 0.45, h * (y + 0.16)); g.stroke();
      }
    }),
    // Faint mottling so smooth leaves don't look like plastic.
    speckle: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      noise(g, w, h, rng, 2500, 2, ['#e8ece6', '#f6f8f4', '#dfe5dc'], 0.6);
    }, { repeat: true }),
  };
  return texs;
}

// Deterministic per plant (same plant on every device).
function hashString(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
