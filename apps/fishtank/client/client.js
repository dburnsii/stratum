// Fish Tank (Stratum app). The fish live on the fishtank backend: it tracks
// hunger, and hands out swim plans (closed paths + start time). We animate
// them locally from the shared clock; feeding goes through the backend, which
// tells everyone in the tank's channel. Fish never die: a starving fish is
// pale and listless until someone feeds it.
//
// Everything here is procedural: the fish (body from a species profile, a
// painted skin, fins from outlines, a swimming wave in the vertex shader),
// the aquascape (sand dune, stones, driftwood, swaying plants, an anemone),
// and the water (caustics on everything below, light shafts, bubbles, a
// rippling surface, glass with silicone edges). Decor is seeded from the
// instance id, so every device sees the same tank.
//
// Tank frame = instance frame: origin at the tank floor center, y up, meters.
import { lod, mergeStatic } from '/js/apps/kit/lod.js';

let THREE, merge;

const SCHOOL_M = 0.02;            // school members swim this far off the shared path
const FAR_M = 1.4;                // plants farther than this from your eyes draw their light version (LOD)

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    ({ mergeGeometries: merge } = await import('three/addons/utils/BufferGeometryUtils.js'));
    const t = (ctx.tank = { fish: new Map(), kinds: new Map(), food: [], size: [0.6, 0.36, 0.3], time: { value: 0 } });
    t.channel = ctx.channel(tankId(ctx), (msg) => onMessage(ctx, msg));   // the backend broadcasts on the tank id
    await refresh(ctx);
    buildTank(ctx);
    t.poll = setInterval(() => refresh(ctx).catch(() => {}), 60_000);   // hunger drifts; resync now and then
    ctx.actions([
      { label: '🍤 Feed', run: () => feed(ctx, 0, 0) },
      { label: '＋ Fish', run: () => ctx.backend.post(`/tanks/${tankId(ctx)}/fish`, {}).then(() => refresh(ctx)).catch((e) => ctx.log(e.message)) },
    ]);
    window.__fish = { ctx };   // test hook
  },

  frame(ctx, dt) {
    const t = ctx.tank;
    if (!t?.water) return;
    dt = Math.min(dt, 0.1);
    const now = ctx.now(), secs = performance.now() / 1000;
    t.time.value = secs;
    for (const f of t.fish.values()) swim(t, f, now, secs, dt);
    drawFish(t);
    // Bubbles rise, wobble, and start over at the stone.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [i, b] of t.bubbles.list.entries()) {
      b.y += b.v * dt;
      if (b.y > t.waterY - 0.004) Object.assign(b, newBubble(t, true));
      const grow = 1 + (b.y / t.waterY) * 0.4;
      p.set(b.x + Math.sin(secs * b.f + b.ph) * 0.003, b.y, b.z + Math.cos(secs * b.f * 0.8 + b.ph) * 0.003);
      s.setScalar(b.r * grow);
      t.bubbles.mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    t.bubbles.mesh.instanceMatrix.needsUpdate = true;
    // The surface ripples (its normal map drifts two ways).
    t.surface.material.normalMap.offset.set(secs * 0.012, secs * 0.007);
    for (const r of t.rays) r.material.uniforms.uTime.value = secs;
    // Food sinks to the sand; fish that reach a pellet eat it.
    for (const pellet of t.food) {
      const floor = sandHeight(t, pellet.position.x, pellet.position.z) + 0.003;
      if (pellet.userData.age > 0) pellet.position.y = Math.max(floor, pellet.position.y - dt * 0.025);
      pellet.position.x += Math.sin(secs * 2 + pellet.userData.ph) * dt * 0.002;
      pellet.userData.age += dt;
      for (const f of t.fish.values()) if (f.mesh.position.distanceTo(pellet.position) < f.data.length * 0.45) pellet.userData.age = 99;
      pellet.visible = pellet.userData.age < 20;
    }
    t.food = t.food.filter((pl) => {
      if (pl.visible) return true;
      pl.removeFromParent();
      return false;
    });
    updateStatus(ctx);
  },

  // Tap the water: drop food where you tapped.
  select(ctx, hit) {
    const p = hit.point;
    feed(ctx, p.x, p.z);
  },

  // Revelio's stand-in while hidden (the real tank is thousands of moving parts):
  // the glass, the sand, and a few fish shapes.
  revealMesh(ctx) {
    const t = ctx.tank, [w, h, d] = t.size, g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
    box.position.y = h / 2;
    const sand = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.04, d * 0.98));
    sand.position.y = 0.02;
    g.add(box, sand);
    const fish = new THREE.ConeGeometry(0.012, 0.05, 8).rotateZ(-Math.PI / 2);
    [...t.fish.values()].slice(0, 8).forEach((f) => {
      const m = new THREE.Mesh(fish);
      if (f.mesh) m.position.copy(ctx.toLocal(f.mesh.getWorldPosition(new THREE.Vector3())));
      g.add(m);
    });
    return g;
  },

  async stop(ctx) {
    clearInterval(ctx.tank?.poll);
    if (window.__fish?.ctx === ctx) delete window.__fish;
  },
};

const tankId = (ctx) => ctx.instance.id;

async function refresh(ctx) {
  // Tanks in a temporary space are flagged so the backend can expire them.
  const data = await ctx.backend.get(`/tanks/${tankId(ctx)}${ctx.instance.temporary ? '?temp=1' : ''}`);
  const t = ctx.tank;
  t.size = data.size;
  t.hungerHours = data.hungerHours;
  const seen = new Set();
  for (const f of data.fish) {
    seen.add(f.id);
    const cur = t.fish.get(f.id);
    if (cur) { cur.data = f; setPlan(cur, f.plan); styleFish(cur); } else if (t.root) addFish(ctx, f); else (t.pending ??= []).push(f);
  }
  for (const [id, f] of t.fish) if (!seen.has(id)) removeFish(t, f);
}

function onMessage(ctx, msg) {
  const t = ctx.tank;
  if (msg.type === 'fed') {
    dropFood(ctx, msg.food.x, msg.food.z);
    for (const u of msg.fish) {
      const f = t.fish.get(u.id);
      if (f) { f.data.hunger = u.hunger; setPlan(f, u.plan); styleFish(f); }
    }
  } else if (msg.type === 'restocked' || msg.type === 'plans' || msg.type === 'died') {
    refresh(ctx).catch(() => {});
  }
}

async function feed(ctx, x, z) {
  try {
    await ctx.backend.post(`/tanks/${tankId(ctx)}/feed`, { x, z });   // the broadcast animates it for everyone
  } catch (err) {
    ctx.log(`feeding failed: ${err.message}`);
  }
}

// ---- swimming ------------------------------------------------------------------------

function swim(t, f, now, secs, dt) {
  const { curve, plan } = f;
  const lag = (f.data.slot ?? 0) * 0.004;
  const u = ((((now - plan.t0) / (plan.period * 1000) - lag) % 1) + 1) % 1;
  const p = curve.getPointAt(u, f.tmpP), tan = curve.getTangentAt(u, f.tmpT);
  p.add(f.offset);
  p.y += Math.sin(secs * 0.7 + f.phase) * 0.004;
  const hungry = f.data.hunger > 0.85;
  if (hungry) p.y -= 0.012;                     // listless, a little low in the water
  f.mesh.position.copy(p);
  const yaw = Math.atan2(-tan.z, tan.x), pitch = Math.asin(THREE.MathUtils.clamp(tan.y, -0.6, 0.6)) * 0.6;
  const dy = wrap(yaw - f.yaw);
  const k = Math.min(1, dt * 4);
  f.yaw += dy * k;
  f.pitch += (pitch - f.pitch) * k;
  f.roll += (THREE.MathUtils.clamp(-dy * 2, -0.45, 0.45) - f.roll) * k;
  f.mesh.rotation.set(f.roll, f.yaw, f.pitch);
  const speed = f.length / (plan.period);       // m/s along the loop
  const beat = (hungry ? 5 : 8) + speed * 160 + Math.abs(dy) * 20;
  f.swim += dt * beat;
  f.amp = hungry ? 0.04 : 0.07;   // (of its length)
}

function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

function setPlan(f, plan) {
  f.plan = plan;
  f.curve = new THREE.CatmullRomCurve3(plan.points.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
  f.length = f.curve.getLength();
}

// Hungry fish fade toward grey.
function styleFish(f) {
  const k = Math.max(0, f.data.hunger - 0.6) * 0.9;
  f.tint.setScalar(1).lerp(new THREE.Color(0x9aa0a8), k);
}

// ---- fish ----------------------------------------------------------------------------

// Body profile (h, w: height and width / length; k: where it's deepest; ped:
// tail-stalk thickness; belly), fins (outlines in body lengths), skin painter
// and fin colors per species.
const SPECIES = {
  clown: {
    h: 0.42, w: 0.26, k: 0.8, ped: 0.32, belly: 1.0, iri: 0, eye: 0.06, iris: '#ff9f1c',
    tail: ['round', 0.3], dorsal: [0.22, 0.85, 0.17, 0.5, 0.02, 0.6], anal: [0.55, 0.86, 0.15, 0.6, 0.03, 0.6], pec: 0.17,
    skin: paintClown, fins: { all: ['#ff7b1c', '#ff9a3c'], edge: '#111111', alpha: 0.95 },
  },
  bluetang: {
    h: 0.62, w: 0.2, k: 0.62, ped: 0.22, belly: 1.0, snout: 0.35, iri: 0.15, eye: 0.055, iris: '#1b1b1b',
    tail: ['lyre', 0.32], dorsal: [0.12, 0.94, 0.12, 0.5, 0.0, 0.6], anal: [0.32, 0.94, 0.11, 0.6, 0.0, 0.6], pec: 0.16,
    skin: paintBlueTang, fins: { all: ['#1d4ed8', '#2563eb'], caudal: ['#ffd60a', '#ffe14d'], pec: ['#ffd60a', '#ffe680'], edge: '#0a0a0a', alpha: 0.95 },
  },
  yellowtang: {
    h: 0.8, w: 0.18, k: 0.58, ped: 0.2, belly: 1.0, snout: 0.6, iri: 0.05, eye: 0.05, iris: '#222222',
    tail: ['truncate', 0.26], dorsal: [0.1, 0.92, 0.3, 0.42, 0.02, 0.5], anal: [0.28, 0.92, 0.27, 0.5, 0.02, 0.5], pec: 0.15,
    skin: paintYellowTang, fins: { all: ['#ffd60a', '#ffe14d'], alpha: 0.92 },
  },
  angel: {
    h: 0.82, w: 0.14, k: 0.58, ped: 0.22, belly: 1.0, snout: 0.4, iri: 0.35, eye: 0.06, iris: '#d00000',
    tail: ['lyre', 0.48], dorsal: [0.2, 0.7, 0.75, 0.62, 0.28, 0.08], anal: [0.42, 0.76, 0.8, 0.66, 0.28, 0.08], pec: 0.14, pelvic: 0.7,
    skin: paintAngel, fins: { all: ['#d9dde3', '#f1f3f5'], edge: '#222222', alpha: 0.7 },
  },
  betta: {
    h: 0.3, w: 0.22, k: 0.82, ped: 0.42, belly: 1.0, iri: 0.9, eye: 0.06, iris: '#111111',
    tail: ['veil', 0.8], dorsal: [0.45, 0.88, 0.34, 0.75, 0.12, 0.95], anal: [0.3, 0.92, 0.5, 0.75, 0.14, 0.98], pec: 0.2,
    skin: paintBetta, fins: { all: ['#9d0208', '#3a0ca3'], rays: 'rgba(255,90,90,0.5)', alpha: 0.85 },
  },
  goldfish: {
    h: 0.56, w: 0.44, k: 0.72, ped: 0.32, belly: 1.15, iri: 0.25, eye: 0.075, iris: '#2b2b2b',
    tail: ['veil', 0.55], dorsal: [0.3, 0.7, 0.24, 0.4, 0.04, 0.35], anal: [0.72, 0.88, 0.15, 0.7, 0.04, 0.5], pec: 0.18,
    skin: paintGoldfish, fins: { all: ['#ff8800', '#ffd166'], alpha: 0.7 },
  },
  guppy: {
    h: 0.28, w: 0.2, k: 0.78, ped: 0.4, belly: 1.1, iri: 0.5, eye: 0.08, iris: '#222222',
    tail: ['fan', 0.75], dorsal: [0.55, 0.78, 0.16, 0.72, 0.05, 0.5], anal: [0.62, 0.8, 0.08, 0.7, 0.03, 0.4], pec: 0.14,
    skin: paintGuppy, fins: { all: ['#9aa5a0', '#c9d1cc'], caudal: ['#ff5d2a', '#3a86ff'], dorsal: ['#ff7b54', '#ffb4a2'], spots: '#111111', alpha: 0.85 },
  },
  discus: {
    h: 0.92, w: 0.16, k: 0.52, ped: 0.18, belly: 1.0, iri: 0.3, eye: 0.055, iris: '#e5383b',
    tail: ['fan', 0.22], dorsal: [0.06, 0.96, 0.1, 0.55, 0.0, 0.6], anal: [0.2, 0.96, 0.1, 0.6, 0.0, 0.6], pec: 0.13,
    skin: paintDiscus, fins: { all: ['#e85d04', '#4cc9f0'], edge: '#4cc9f0', alpha: 0.85 },
  },
  mandarin: {
    h: 0.36, w: 0.32, k: 0.7, ped: 0.36, belly: 1.0, iri: 0.3, eye: 0.075, iris: '#f77f00',
    tail: ['round', 0.3], dorsal: [0.28, 0.8, 0.38, 0.32, 0.04, 0.4], anal: [0.55, 0.88, 0.2, 0.7, 0.03, 0.6], pec: 0.2,
    skin: paintMandarin, fins: { all: ['#f77f00', '#0077b6'], rays: 'rgba(0,180,216,0.8)', alpha: 0.9 },
  },
  neon: {
    h: 0.25, w: 0.17, k: 0.78, ped: 0.36, belly: 1.0, iri: 0.6, eye: 0.085, iris: '#9ad1ff',
    tail: ['fork', 0.32], dorsal: [0.45, 0.6, 0.13, 0.5, 0.03, 0.3], anal: [0.6, 0.78, 0.1, 0.6, 0.02, 0.3], pec: 0.12,
    skin: paintNeon, fins: { all: ['#cfd8dc', '#ffffff'], alpha: 0.35 },
  },
};

function addFish(ctx, data) {
  const t = ctx.tank;
  const kind = data.species in SPECIES ? data.species : 'clown';
  const L = data.length;
  // Each fish is an invisible placeholder the swimming moves; its kind draws all of them
  // at once (instanced: 3 draw calls a kind, not 3 a fish). drawFish() copies them over each frame.
  const mesh = new THREE.Object3D();
  mesh.rotation.order = 'YZX';
  mesh.scale.setScalar(L);
  mesh.position.set(0, t.size[1] - 0.05, 0);
  const seed = hashString(data.id);
  const r = mulberry(seed);
  const offset = data.school ? new THREE.Vector3((r() - 0.5) * 2, (r() - 0.5) * 1.2, (r() - 0.5) * 2).multiplyScalar(SCHOOL_M) : new THREE.Vector3();
  const f = { data, kind, mesh, swim: Math.random() * 6, amp: 0.07, tint: new THREE.Color(1, 1, 1), phase: r() * 6, offset, yaw: 0, pitch: 0, roll: 0,
    tmpP: new THREE.Vector3(), tmpT: new THREE.Vector3() };
  setPlan(f, data.plan);
  styleFish(f);
  t.fish.set(data.id, f);
  t.root.add(mesh);
  const k = kindOf(t, kind);
  k.list.push(f);
  sizeKind(t, k);
}

function removeFish(t, f) {
  f.mesh.removeFromParent();
  t.fish.delete(f.data.id);
  const k = t.kinds.get(f.kind);
  if (k) { k.list.splice(k.list.indexOf(f), 1); sizeKind(t, k); }
}

// A kind of fish in this tank: its materials, geometry (its own copies: the
// per-fish swim attribute lives on them) and instanced meshes.
function kindOf(t, kind) {
  let k = t.kinds.get(kind);
  if (k) return k;
  const sp = SPECIES[kind], looks = fishLooks(kind), g = looks.geometry;
  // Plain lit materials (the Quest pays for every clearcoat / iridescence pixel); the reflections give the sheen.
  const body = new THREE.MeshStandardMaterial({ map: looks.skin, roughness: 0.38, metalness: 0.06, envMap: t.env, envMapIntensity: 1.1 + sp.iri * 0.8 });
  const fins = new THREE.MeshStandardMaterial({ map: looks.fins, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.5, envMap: t.env, envMapIntensity: 0.8 });
  const eyes = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, envMap: t.env, envMapIntensity: 1.4 });
  bend(body, t); bend(fins, t, true); bend(eyes, t);
  k = { kind, list: [], cap: 0, meshes: null, mats: { body, fins, eyes }, geos: { body: g.body.clone(), fins: g.fins.clone(), eyes: g.eyes.clone() } };
  t.kinds.set(kind, k);
  return k;
}

// Room for every fish of the kind (instanced meshes, rebuilt bigger when it runs out).
function sizeKind(t, k) {
  const n = k.list.length;
  if (k.meshes && n <= k.cap) { for (const m of Object.values(k.meshes)) m.count = n; return; }
  if (k.meshes) for (const m of Object.values(k.meshes)) { m.removeFromParent(); m.dispose(); }
  k.cap = Math.max(4, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
  k.swimAttr = new THREE.InstancedBufferAttribute(new Float32Array(k.cap * 2), 2);   // [wave phase, amplitude] per fish
  k.swimAttr.setUsage(THREE.DynamicDrawUsage);
  const meshes = {};
  for (const part of ['body', 'fins', 'eyes']) {
    k.geos[part].setAttribute('iSwim', k.swimAttr);
    const m = new THREE.InstancedMesh(k.geos[part], k.mats[part], k.cap);
    m.frustumCulled = false;   // (they swim: the instances' bounds go stale)
    m.raycast = () => {};
    m.count = n;
    meshes[part] = m;
  }
  meshes.fins.renderOrder = 1;
  meshes.fins.instanceMatrix = meshes.eyes.instanceMatrix = meshes.body.instanceMatrix;   // one set of matrices, uploaded once
  meshes.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  meshes.body.setColorAt(0, new THREE.Color(1, 1, 1));   // (hungry fish fade toward grey: per-fish colour)
  k.meshes = meshes;
  for (const m of Object.values(meshes)) t.root.add(m);
}

// Each frame: the placeholders' poses and swim waves into the instances.
function drawFish(t) {
  for (const k of t.kinds.values()) {
    if (!k.meshes) continue;
    const { body } = k.meshes, sw = k.swimAttr.array;
    k.list.forEach((f, i) => {
      f.mesh.updateMatrix();
      body.setMatrixAt(i, f.mesh.matrix);
      body.setColorAt(i, f.tint);
      sw[i * 2] = f.swim; sw[i * 2 + 1] = f.amp;
    });
    body.instanceMatrix.needsUpdate = true;
    body.instanceColor.needsUpdate = true;
    k.swimAttr.needsUpdate = true;
  }
}

// The swimming wave: a traveling bend along the body, stronger toward the
// tail (s = 0 at the nose, 1 at the tail stalk; the tail fin is past 1).
// Fins with aFlap (pectorals) also paddle. Geometry is in body lengths.
function bend(mat, t, flap = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = t.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; attribute vec2 iSwim;
${flap ? 'attribute float aFlap;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float uSwim = iSwim.x;   // (per fish: its wave's phase, its amplitude in body lengths)
  float s = clamp(0.5 - transformed.x, 0.0, 1.5);
  float a = iSwim.y;
  transformed.z += a * ((0.1 + s * s) * sin(uSwim - s * 4.5) - 0.1 * sin(uSwim));
  transformed.x -= a * 0.15 * s * s * (1.0 - cos(uSwim * 2.0 - s * 9.0));
  ${flap ? 'transformed.z += aFlap * 0.5 * sin(uTime * 6.0 + uSwim * 0.25); transformed.y += abs(aFlap) * 0.15 * cos(uTime * 6.0 + uSwim * 0.25);' : ''}
}`);
  };
  mat.customProgramCacheKey = () => (flap ? 'fish-flap-i' : 'fish-bend-i');
}

// Built once per species (geometry + textures are shared by every fish of the kind).
const LOOKS = new Map();
function fishLooks(kind) {
  if (!LOOKS.has(kind)) {
    const sp = SPECIES[kind];
    const skin = canvasTex(paintSkin(sp));
    const fins = canvasTex(paintFins(sp));
    LOOKS.set(kind, { skin, fins, geometry: fishGeometry(sp) });
  }
  return LOOKS.get(kind);
}

// Unit fish (length 1): nose at x = +0.5, tail stalk at x = -0.5.
function fishGeometry(sp) {
  const f = (t) => {
    let b = Math.pow(Math.sin(Math.PI * Math.min(Math.pow(t, sp.k), 0.999)), 0.75);
    if (sp.snout && t < 0.2) b *= Math.pow(t / 0.2, sp.snout);   // a pointed face
    const stalk = sp.ped * THREE.MathUtils.smoothstep(t, 0.55, 1.0);
    return Math.max(b, stalk, 0.02);
  };
  const H = sp.h, Wd = sp.w;
  const xAt = (t) => 0.5 - t;
  const yc = (t) => -0.04 * H * f(t);
  const top = (t) => yc(t) + (H / 2) * f(t);
  const bot = (t) => yc(t) - (H / 2) * f(t) * sp.belly;
  const halfW = (t) => (Wd / 2) * f(t) * (1 - 0.35 * t);

  // Body: elliptical rings along x; uv u = nose→tail, v = back→belly (both sides alike).
  // N rings × M around: 32 × 24 up close, 12 × 10 far away (LOD).
  const makeBody = (N, M) => {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    for (let j = 0; j <= M; j++) {
      const th = (j / M) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const ry = c > 0 ? (H / 2) * f(t) : (H / 2) * f(t) * sp.belly;
      pos.push(xAt(t), yc(t) + c * ry, s * halfW(t));
      uv.push(t, (1 - c) / 2);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  // Caps: the nose tip and the tail stalk.
  const nose = pos.length / 3;
  pos.push(0.5 + 0.004, yc(0), 0); uv.push(0, 0.5);
  for (let j = 0; j < M; j++) idx.push(nose, j, j + 1);
  const tail = pos.length / 3;
  pos.push(xAt(1) - 0.002, yc(1), 0); uv.push(1, 0.5);
  for (let j = 0; j < M; j++) { const a = N * (M + 1) + j; idx.push(tail, a + 1, a); }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  body.setIndex(idx);
  body.computeVertexNormals();
  return body;
  };
  const body = makeBody(22, 14);   // (one level for all: drawn instanced)

  // Fins: outlines in the body's side plane; each gets a quarter of the fin texture.
  const parts = [];
  const finGeo = (shape, quad, flapFrom = null) => {
    const g = new THREE.ShapeGeometry(shape, 12);
    g.computeBoundingBox();
    const bb = g.boundingBox, p = g.attributes.position, uvs = [], flap = [];
    for (let i = 0; i < p.count; i++) {
      const un = (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x || 1), vn = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y || 1);
      uvs.push(quad[0] * 0.5 + 0.01 + un * 0.48, quad[1] * 0.5 + 0.01 + vn * 0.48);
      flap.push(flapFrom ? Math.hypot(p.getX(i) - flapFrom[0], p.getY(i) - flapFrom[1]) : 0);
    }
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1));
    return g;
  };
  // Caudal.
  const [kind, c] = sp.tail;
  const tx = xAt(1) + 0.01, r = Math.max(0.02, (H / 2) * sp.ped * 0.9), ty = yc(1);
  const tailShape = new THREE.Shape();
  tailShape.moveTo(tx, ty + r);
  if (kind === 'fork' || kind === 'lyre') {
    const tip = kind === 'lyre' ? 1.25 : 1;
    tailShape.quadraticCurveTo(tx - c * 0.5, ty + r + c * 0.35, tx - c * tip, ty + c * 0.95);
    tailShape.quadraticCurveTo(tx - c * 0.7, ty + c * 0.35, tx - c * 0.55, ty);
    tailShape.quadraticCurveTo(tx - c * 0.7, ty - c * 0.35, tx - c * tip, ty - c * 0.95);
    tailShape.quadraticCurveTo(tx - c * 0.5, ty - r - c * 0.35, tx, ty - r);
  } else if (kind === 'veil') {
    tailShape.quadraticCurveTo(tx - c * 0.3, ty + c * 0.75, tx - c * 0.85, ty + c * 0.6);
    tailShape.quadraticCurveTo(tx - c * 1.15, ty + c * 0.1, tx - c * 1.0, ty - c * 0.35);
    tailShape.quadraticCurveTo(tx - c * 0.9, ty - c * 0.85, tx - c * 0.55, ty - c * 0.8);
    tailShape.quadraticCurveTo(tx - c * 0.25, ty - c * 0.6, tx, ty - r);
  } else if (kind === 'fan') {
    tailShape.quadraticCurveTo(tx - c * 0.4, ty + c * 0.7, tx - c * 1.0, ty + c * 0.55);
    tailShape.quadraticCurveTo(tx - c * 1.1, ty, tx - c * 1.0, ty - c * 0.55);
    tailShape.quadraticCurveTo(tx - c * 0.4, ty - c * 0.7, tx, ty - r);
  } else {   // round / truncate
    const sq = kind === 'truncate' ? 0.85 : 1.15;
    tailShape.quadraticCurveTo(tx - c * 0.45, ty + c * 0.6, tx - c * 0.9, ty + c * 0.45);
    tailShape.quadraticCurveTo(tx - c * sq, ty, tx - c * 0.9, ty - c * 0.45);
    tailShape.quadraticCurveTo(tx - c * 0.45, ty - c * 0.6, tx, ty - r);
  }
  tailShape.lineTo(tx, ty + r);
  parts.push(finGeo(tailShape, [0, 1]));
  // Dorsal / anal: [from t, to t, height, peak t, sweep back, trailing height fraction].
  const median = ([t0, t1, h, tp, sweep, endK], up, quad) => {
    const edge = up ? top : bot, sgn = up ? 1 : -1;
    const sh = new THREE.Shape();
    const inset = (t) => edge(t) - sgn * (H / 2) * f(t) * 0.25;
    sh.moveTo(xAt(t0), inset(t0));
    const peak = [xAt(tp) - sweep, edge(tp) + sgn * h];
    sh.quadraticCurveTo(xAt(t0) * 0.55 + peak[0] * 0.45, edge(t0) + sgn * h * 0.8, peak[0], peak[1]);
    const end = [xAt(t1) - sweep * 0.3, edge(t1) + sgn * h * endK];
    sh.quadraticCurveTo(end[0] + 0.02, peak[1] - sgn * h * 0.1, end[0], end[1]);
    sh.lineTo(xAt(t1), inset(t1));
    for (let k = 7; k >= 0; k--) { const tt = t0 + (t1 - t0) * (k / 8); sh.lineTo(xAt(tt), inset(tt)); }
    return finGeo(sh, quad);
  };
  parts.push(median(sp.dorsal, true, [1, 1]));
  parts.push(median(sp.anal, false, [0, 0]));
  // Angelfish: long trailing pelvic threads.
  if (sp.pelvic) {
    const t0 = 0.3, x0 = xAt(t0), y0 = bot(t0) + 0.01, ln = sp.pelvic;
    const sh = new THREE.Shape();
    sh.moveTo(x0, y0);
    sh.quadraticCurveTo(x0 - ln * 0.2, y0 - ln * 0.5, x0 - ln * 0.45, y0 - ln * 0.95);
    sh.quadraticCurveTo(x0 - ln * 0.22, y0 - ln * 0.45, x0 - 0.03, y0);
    parts.push(finGeo(sh, [0, 0]));
  }
  // Pectorals: a paddle on each side, angled out from the body.
  const pt = 0.26, pl = sp.pec;
  for (const side of [1, -1]) {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0.012);
    sh.quadraticCurveTo(-pl * 0.6, pl * 0.45, -pl, pl * 0.12);
    sh.quadraticCurveTo(-pl * 0.7, -pl * 0.2, 0, -0.012);
    const g = finGeo(sh, [1, 0], [0, 0]);
    const fl = g.attributes.aFlap;
    for (let i = 0; i < fl.count; i++) fl.setX(i, fl.getX(i) * side);
    g.rotateX(side * 0.35).rotateY(side * 0.55);
    g.translate(xAt(pt), yc(pt) - (H / 2) * f(pt) * 0.25, side * halfW(pt) * 0.85);
    parts.push(g);
  }
  const fins = merge(parts.map((g) => { g.deleteAttribute('normal'); return g; }));
  fins.computeVertexNormals();

  // Eyes: iris + pupil with a glint, both sides.
  const eyes = [], te = 0.11, er = sp.eye;
  for (const side of [1, -1]) {
    const ex = xAt(te), ey = yc(te) + (H / 2) * f(te) * 0.28, ez = side * halfW(te) * 0.8;
    const iris = new THREE.SphereGeometry(er, 10, 7).translate(ex, ey, ez);
    const pupil = new THREE.SphereGeometry(er * 0.62, 8, 6).translate(ex + er * 0.05, ey, ez + side * er * 0.48);
    eyes.push(colored(iris, sp.iris), colored(pupil, '#050505'));
  }
  return { body, fins, eyes: merge(eyes) };
}

function colored(g, hex) {
  const c = new THREE.Color(hex).convertSRGBToLinear(), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}

// ---- skins (canvas: x = nose→tail, y = back→belly) ------------------------------------

const SKIN_W = 512, SKIN_H = 256;

function paintSkin(sp) {
  const c = Object.assign(document.createElement('canvas'), { width: SKIN_W, height: SKIN_H });
  const g = c.getContext('2d');
  sp.skin(g, SKIN_W, SKIN_H);
  // Scales: rows of soft arcs.
  g.globalCompositeOperation = 'soft-light';
  for (let y = 0; y < SKIN_H + 12; y += 11) {
    for (let x = (y / 11) % 2 ? 7 : 0; x < SKIN_W; x += 14) {
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, 7, Math.PI * 0.15, Math.PI * 0.85); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.beginPath(); g.arc(x, y + 1.5, 7, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
    }
  }
  g.globalCompositeOperation = 'source-over';
  // Countershading: darker back, paler belly.
  const cs = g.createLinearGradient(0, 0, 0, SKIN_H);
  cs.addColorStop(0, 'rgba(0,0,0,0.28)'); cs.addColorStop(0.45, 'rgba(0,0,0,0)'); cs.addColorStop(0.8, 'rgba(255,255,255,0.08)'); cs.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.fillStyle = cs;
  g.fillRect(0, 0, SKIN_W, SKIN_H);
  // Gill cover line.
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3;
  g.beginPath(); g.ellipse(SKIN_W * 0.12, SKIN_H * 0.5, SKIN_W * 0.08, SKIN_H * 0.42, 0, -Math.PI / 2.4, Math.PI / 2.4); g.stroke();
  // Mouth: a dark lip at the nose.
  g.fillStyle = 'rgba(20,10,10,0.5)';
  g.fillRect(0, SKIN_H * 0.42, 6, SKIN_H * 0.16);
  return c;
}

function grad(g, W, H, top, mid, bottom) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, top); gr.addColorStop(0.5, mid); gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

function paintClown(g, W, H) {
  grad(g, W, H, '#e8590c', '#ff7b1c', '#ffa94d');
  for (const [u, w] of [[0.17, 0.07], [0.48, 0.09], [0.86, 0.05]]) {
    g.fillStyle = '#111';
    g.beginPath(); g.ellipse(u * W, H / 2, w * W / 2 + 7, H * 0.62, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fbfbf5';
    g.beginPath(); g.ellipse(u * W, H / 2, w * W / 2, H * 0.6, 0, 0, Math.PI * 2); g.fill();
  }
}

function paintBlueTang(g, W, H) {
  grad(g, W, H, '#1e3a8a', '#1d4ed8', '#3b82f6');
  g.fillStyle = '#0b0b14';
  g.beginPath();
  g.moveTo(0.12 * W, 0.32 * H);
  g.bezierCurveTo(0.35 * W, 0.08 * H, 0.75 * W, 0.12 * H, 0.9 * W, 0.4 * H);
  g.bezierCurveTo(0.8 * W, 0.55 * H, 0.65 * W, 0.62 * H, 0.52 * W, 0.6 * H);
  g.bezierCurveTo(0.62 * W, 0.45 * H, 0.66 * W, 0.32 * H, 0.5 * W, 0.3 * H);
  g.bezierCurveTo(0.35 * W, 0.32 * H, 0.3 * W, 0.5 * H, 0.12 * W, 0.45 * H);
  g.fill();
  g.fillStyle = '#ffd60a';
  g.beginPath(); g.moveTo(0.9 * W, 0.2 * H); g.lineTo(W, 0.25 * H); g.lineTo(W, 0.75 * H); g.lineTo(0.9 * W, 0.8 * H); g.fill();
}

function paintYellowTang(g, W, H) {
  grad(g, W, H, '#f4c20d', '#ffd60a', '#ffe566');
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(0.9 * W, 0.5 * H, 9, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(0, 0.4 * H, 10, 0.2 * H);
}

function paintAngel(g, W, H) {
  grad(g, W, H, '#c9a227', '#e5e7eb', '#f8f9fa');
  g.fillStyle = 'rgba(15,15,20,0.9)';
  for (const [u, w] of [[0.11, 0.035], [0.36, 0.06], [0.62, 0.045]]) g.fillRect((u - w / 2) * W, 0, w * W, H);
  g.fillStyle = 'rgba(15,15,20,0.35)';
  g.fillRect(0.82 * W, 0, 0.03 * W, H);
}

function paintBetta(g, W, H) {
  grad(g, W, H, '#6a040f', '#9d0208', '#d00000');
  const r = mulberry(7);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(${60 + r() * 40},${100 + r() * 80},255,${0.25 + r() * 0.3})`;
    g.beginPath(); g.ellipse(r() * W, r() * H * 0.8, 5 + r() * 6, 3 + r() * 3, 0, 0, Math.PI * 2); g.fill();
  }
}

function paintGoldfish(g, W, H) {
  grad(g, W, H, '#e85d04', '#ff8800', '#ffd166');
  g.fillStyle = 'rgba(255,240,200,0.25)';
  g.fillRect(0, 0.6 * H, W, 0.4 * H);
}

function paintGuppy(g, W, H) {
  grad(g, W, H, '#6b7d76', '#9aa5a0', '#dfe6e2');
  const gr = g.createLinearGradient(0.45 * W, 0, W, 0);
  gr.addColorStop(0, 'rgba(255,93,42,0)'); gr.addColorStop(0.4, 'rgba(255,93,42,0.85)'); gr.addColorStop(1, 'rgba(58,134,255,0.9)');
  g.fillStyle = gr;
  g.fillRect(0.45 * W, 0, 0.55 * W, H);
  const r = mulberry(11);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 3 ? '#111' : '#00b4d8';
    g.beginPath(); g.arc((0.55 + r() * 0.42) * W, (0.2 + r() * 0.6) * H, 5 + r() * 7, 0, Math.PI * 2); g.fill();
  }
}

function paintDiscus(g, W, H) {
  grad(g, W, H, '#c1121f', '#e85d04', '#f48c06');
  g.strokeStyle = '#4cc9f0'; g.lineWidth = 6;
  for (let k = 1; k < 10; k++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 8) g.lineTo(x, k * H / 10 + Math.sin(x * 0.045 + k * 1.7) * 6);
    g.stroke();
  }
  g.fillStyle = 'rgba(60,10,0,0.25)';
  for (const u of [0.15, 0.3, 0.45, 0.6, 0.75]) g.fillRect(u * W, 0, 12, H);
}

function paintMandarin(g, W, H) {
  grad(g, W, H, '#005f73', '#0077b6', '#0a9396');
  const r = mulberry(3);
  g.strokeStyle = '#f77f00'; g.lineWidth = 9; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    let x = r() * W, y = r() * H;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 70; y += (r() - 0.5) * 50; g.quadraticCurveTo(x + 20, y - 15, x, y); }
    g.stroke();
  }
  g.strokeStyle = '#94d2bd'; g.lineWidth = 2;
  for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(r() * W, r() * H, 8 + r() * 10, 0, Math.PI * 1.5); g.stroke(); }
}

function paintNeon(g, W, H) {
  grad(g, W, H, '#5c6650', '#a7b0a0', '#e9ecef');
  const red = g.createLinearGradient(0.42 * W, 0, 0.98 * W, 0);
  red.addColorStop(0, 'rgba(255,30,60,0)'); red.addColorStop(0.15, 'rgba(255,30,60,0.95)'); red.addColorStop(1, 'rgba(255,30,60,0.9)');
  g.fillStyle = red;
  g.fillRect(0.42 * W, 0.5 * H, 0.56 * W, 0.36 * H);
  const blue = g.createLinearGradient(0, 0.33 * H, 0, 0.5 * H);
  blue.addColorStop(0, 'rgba(0,229,255,0)'); blue.addColorStop(0.3, '#00e5ff'); blue.addColorStop(0.7, '#3a86ff'); blue.addColorStop(1, 'rgba(58,134,255,0)');
  g.fillStyle = blue;
  g.fillRect(0.08 * W, 0.33 * H, 0.76 * W, 0.17 * H);
}

// Fin atlas: four quarters (caudal top-left, dorsal top-right, anal bottom-left,
// pectorals bottom-right in uv space), each a gradient with rays and an edge.
function paintFins(sp) {
  const S = 512, c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const g = c.getContext('2d');
  const f = sp.fins;
  const quads = { caudal: [0, 0], dorsal: [1, 0], anal: [0, 1], pec: [1, 1] };   // canvas quarters (x, y from the top)
  for (const [name, [qx, qy]] of Object.entries(quads)) {
    const [c0, c1] = f[name] ?? f.all;
    const x = qx * S / 2, y = qy * S / 2, w = S / 2, h = S / 2;
    const gr = g.createLinearGradient(x, y, x + w, y + h);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.globalAlpha = f.alpha;
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    g.globalAlpha = 1;
    // Rays: fine lines fanning across the quarter.
    g.strokeStyle = f.rays ?? 'rgba(255,255,255,0.14)';
    g.lineWidth = 5;
    for (let k = 0; k <= 7; k++) {
      g.beginPath();
      g.moveTo(x + w * 0.95, y + h / 2);
      g.lineTo(x, y + (k / 7) * h);
      g.stroke();
    }
    if (f.spots && name === 'caudal') {
      const r = mulberry(5);
      g.fillStyle = f.spots;
      for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(x + r() * w, y + r() * h, 4 + r() * 6, 0, Math.PI * 2); g.fill(); }
    }
    // A darker or brighter rim at the outer edge (every side: the shape decides which shows).
    if (f.edge) {
      g.strokeStyle = f.edge; g.lineWidth = 14;
      g.strokeRect(x + 7, y + 7, w - 14, h - 14);
    }
    // Fade toward the fin's edge.
    const fade = g.createRadialGradient(x + w / 2, y + h / 2, w * 0.2, x + w / 2, y + h / 2, w * 0.75);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = fade;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

// ---- the tank ------------------------------------------------------------------------

function buildTank(ctx) {
  const t = ctx.tank;
  const [w, h, d] = t.size;
  const root = (t.root = new THREE.Group());
  ctx.spawn(root);
  const rng = mulberry(hashString(ctx.instance.id));
  t.env = envMap();
  t.waterY = h - 0.025;
  t.sand = dune(rng, w, d);

  // Glass: faint reflective panes, greenish silicone edges, black rims top and bottom.
  // (Unlit + a reflection: see-through layers over the whole tank are paid per pixel, several times over.)
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w + 0.006, h, d + 0.006), new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.07, envMap: t.env, reflectivity: 0.6, depthWrite: false }));
  glass.position.y = h / 2;
  glass.renderOrder = 4;
  root.add(glass);
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8fd3c1, transparent: true, opacity: 0.55, roughness: 0.2, envMap: t.env });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.006, h, 0.006), edgeMat);
    e.position.set(sx * (w / 2 + 0.001), h / 2, sz * (d / 2 + 0.001));
    root.add(e);
  }
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.45, metalness: 0.3, envMap: t.env });
  const frame = (y, hh) => {
    for (const [sx, sz, lx, lz] of [[0, 1, w + 0.016, 0.008], [0, -1, w + 0.016, 0.008], [1, 0, 0.008, d + 0.016], [-1, 0, 0.008, d + 0.016]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(lx, hh, lz), rimMat);
      b.position.set(sx * (w / 2 + 0.004), y, sz * (d / 2 + 0.004));
      root.add(b);
    }
  };
  frame(0.012, 0.024);
  frame(h - 0.006, 0.012);
  // LED light bar across the top, with a glowing underside.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.008, 0.04), rimMat);
  bar.position.set(0, h + 0.004, 0);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.025).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe6f7ff }));
  led.position.set(0, h - 0.0005, 0);
  root.add(bar, led);

  // Backdrop: deep blue fading to teal, with soft silhouettes of distant plants.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(paintBackdrop(rng)) }));
  back.position.set(0, h / 2, -d / 2 + 0.001);
  root.add(back);

  // Sand: a dune rising toward the back, layered sides, pebbles.
  const sandTex = canvasTex(paintSand(rng));
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
  sandTex.repeat.set(3, 1.5);
  const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95, envMap: t.env, envMapIntensity: 0.6 });
  water(sandMat, t, { caustics: 0.55 });
  const dunes = new THREE.Mesh(t.sand.geometry, sandMat);
  root.add(dunes);
  const sideTex = canvasTex(paintSandSide(rng));
  const sides = new THREE.Mesh(t.sand.skirt, new THREE.MeshStandardMaterial({ map: sideTex, roughness: 1, envMap: t.env, envMapIntensity: 0.5 }));
  root.add(sides);
  root.add(pebbles(t, rng, w, d));

  // Hardscape: stones and driftwood.
  const stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMap: t.env, envMapIntensity: 0.7 });
  water(stoneMat, t, { caustics: 0.45 });
  for (let i = 0; i < 5; i++) {
    const x = (rng() - 0.5) * (w - 0.12), z = -d / 2 + 0.05 + rng() * d * 0.45;
    const r = 0.025 + rng() * 0.035;
    const s = new THREE.Mesh(stone(rng, r), stoneMat);
    s.position.set(x, sandHeight(t, x, z) - r * 0.25, z);
    s.rotation.y = rng() * 6;
    root.add(s);
  }
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMap: t.env, envMapIntensity: 0.6 });
  water(woodMat, t, { caustics: 0.4 });
  root.add(new THREE.Mesh(driftwood(t, rng, w, d), woodMat));
  // Moss balls.
  const mossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMap: t.env, envMapIntensity: 0.6 });
  water(mossMat, t, { caustics: 0.3 });
  for (let i = 0; i < 2; i++) {
    const x = (rng() - 0.5) * (w - 0.1), z = d / 2 - 0.05 - rng() * 0.05;
    const m = new THREE.Mesh(moss(rng, 0.013 + rng() * 0.006), mossMat);
    m.position.set(x, sandHeight(t, x, z) + 0.011, z);
    root.add(m);
  }

  // Plants (and the anemone): one mesh, swaying in the vertex shader.
  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.65, envMap: t.env, envMapIntensity: 0.8 });
  water(plantMat, t, { caustics: 0.3, sway: 0.02 });
  const greens = plants(t, rng, w, d);
  root.add(lod([[new THREE.Mesh(greens.near, plantMat), 0], [new THREE.Mesh(greens.far, plantMat), FAR_M]]));

  // Water: the volume (the tap target) and the rippling surface.
  t.water = new THREE.Mesh(new THREE.BoxGeometry(w - 0.002, t.waterY - 0.012, d - 0.002),
    new THREE.MeshBasicMaterial({ color: 0x2a9fd0, transparent: true, opacity: 0.1, depthWrite: false }));
  t.water.position.y = 0.012 + (t.waterY - 0.012) / 2;
  t.water.renderOrder = 2;
  root.add(t.water);
  const nrm = canvasTex(rippleNormals(rng));
  nrm.colorSpace = THREE.NoColorSpace;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(3, 1.5);
  t.surface = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.002, d - 0.002).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({
    color: 0xbfefff, transparent: true, opacity: 0.32, roughness: 0.04, normalMap: nrm, normalScale: new THREE.Vector2(0.6, 0.6),
    envMap: t.env, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false }));
  t.surface.position.y = t.waterY;
  t.surface.renderOrder = 3;
  root.add(t.surface);

  // Light shafts from the bar, and an air stone's stream of bubbles.
  t.rays = [];
  for (let i = 0; i < 4; i++) {   // (each is a full-height additive layer: fill rate)
    const rw = 0.04 + rng() * 0.05, rh = t.waterY - 0.02;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSeed: { value: rng() * 10 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uSeed;
        void main() {
          float side = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
          float fall = pow(vUv.y, 1.6);
          float flicker = 0.55 + 0.45 * sin(uTime * 0.6 + uSeed) * sin(uTime * 0.37 + uSeed * 2.0);
          gl_FragColor = vec4(vec3(0.75, 0.93, 1.0), side * fall * flicker * 0.16);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const ray = new THREE.Mesh(new THREE.PlaneGeometry(rw, rh), mat);
    ray.position.set((rng() - 0.5) * (w - 0.1), 0.02 + rh / 2, (rng() - 0.5) * (d - 0.1));
    ray.rotation.set(0, rng() * Math.PI, (rng() - 0.5) * 0.3);
    ray.renderOrder = 5;
    t.rays.push(ray);
    root.add(ray);
  }
  const stoneX = w / 2 - 0.05, stoneZ = -d / 2 + 0.045;
  const airstone = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 1 }));
  airstone.position.set(stoneX, sandHeight(t, stoneX, stoneZ) + 0.004, stoneZ);
  root.add(airstone);
  t.bubbles = { x: stoneX, z: stoneZ, y0: airstone.position.y + 0.006, list: [] };
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, envMap: t.env, reflectivity: 0.9, depthWrite: false });
  t.bubbles.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 5), bubbleMat, 48);
  t.bubbles.mesh.frustumCulled = false;
  t.bubbles.mesh.renderOrder = 1;
  for (let i = 0; i < 48; i++) t.bubbles.list.push(newBubble(t, false));
  root.add(t.bubbles.mesh);

  // The static parts (rims, edges, stones, moss…) drawn a few at a time: one draw call per material.
  const live = new Set([t.water, t.surface, ...t.rays]);
  mergeStatic(root, { keep: (o) => live.has(o) });

  for (const f of t.pending ?? []) addFish(ctx, f);
  t.pending = null;
}

function newBubble(t, fromStone) {
  const b = t.bubbles;
  return { x: b.x + (Math.random() - 0.5) * 0.006, z: b.z + (Math.random() - 0.5) * 0.006,
    y: fromStone ? b.y0 : b.y0 + Math.random() * (t.waterY - b.y0), v: 0.07 + Math.random() * 0.06,
    r: 0.0012 + Math.random() * 0.0028, f: 3 + Math.random() * 4, ph: Math.random() * 6 };
}

// Underwater shading for decor: caustics dancing over the surface and
// (optionally) a sway, stronger up the plant (aSway) and offset per leaf (aSeed).
// Caustics: the light network from the rippling surface. The pattern (tileable,
// period 1) is computed once into a texture; two copies drifting different ways,
// the dimmer of the two, make it move: 2 texture reads a pixel instead of ~40 sines.
const CAUSTIC = `
uniform sampler2D uCausTex;
float caustic(vec2 p, float t) {
  float a = texture2D(uCausTex, p + vec2(t * 0.045, t * 0.026)).r;
  float b = texture2D(uCausTex, p * 0.83 + vec2(0.37 - t * 0.031, 0.61 + t * 0.039)).r;
  return min(a, b) * 1.5;
}`;

let causticTexture = null;
function causticTex() {
  if (causticTexture) return causticTexture;
  const N = 128, data = new Uint8Array(N * N * 4), tt = 7.3;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const qx = (x / N) * 6.28318 - 250, qy = (y / N) * 6.28318 - 250;
    let ix = qx, iy = qy, c = 1;
    for (let n = 0; n < 3; n++) {
      const t = tt * (1 - 3.5 / (n + 1));
      const nx = qx + Math.cos(t - ix) + Math.sin(t + iy), ny = qy + Math.sin(t - iy) + Math.cos(t + ix);
      ix = nx; iy = ny;
      c += 1 / Math.hypot(qx / (Math.sin(ix + t) / 0.005), qy / (Math.cos(iy + t) / 0.005));
    }
    c = 1.17 - Math.pow(c / 3, 1.4);
    const v = Math.min(1, Math.max(0, Math.pow(Math.abs(c), 8)));
    data.set([v * 255, v * 255, v * 255, 255], (y * N + x) * 4);
  }
  causticTexture = new THREE.DataTexture(data, N, N);
  causticTexture.wrapS = causticTexture.wrapT = THREE.RepeatWrapping;
  causticTexture.magFilter = THREE.LinearFilter;
  causticTexture.minFilter = THREE.LinearMipmapLinearFilter;
  causticTexture.generateMipmaps = true;
  causticTexture.needsUpdate = true;
  return causticTexture;
}

function water(mat, t, { caustics = 0, sway = 0 }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = t.time;
    sh.uniforms.uCaus = { value: caustics };
    sh.uniforms.uCausTex = { value: causticTex() };
    sh.uniforms.uSway = { value: sway };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uSway; varying vec3 vCw;
${sway ? 'attribute float aSway; attribute float aSeed;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
${sway ? `transformed.x += sin(uTime * 0.9 + aSeed * 6.28 + transformed.y * 9.0) * uSway * aSway;
transformed.z += cos(uTime * 0.7 + aSeed * 4.0 + transformed.y * 7.0) * uSway * 0.7 * aSway;` : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 cw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cw = instanceMatrix * cw;
#endif
  vCw = (modelMatrix * cw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uCaus; varying vec3 vCw;
${CAUSTIC}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.6, 0.85, 1.0) * uCaus * caustic(vCw.xz * 7.0 + vCw.y * 2.0, uTime * 0.55) * diffuseColor.rgb;`);
  };
  mat.customProgramCacheKey = () => `water-${sway ? 'sway' : 'still'}`;
}

// The sand: a heightfield, higher at the back, flat at the glass.
function dune(rng, w, d) {
  const nx = 48, nz = 24, base = 0.014;
  const ph = [rng() * 6, rng() * 6, rng() * 6];
  const height = (x, z) => {
    const u = x / w + 0.5, v = z / d + 0.5;   // v: 0 back, 1 front
    const edge = Math.min(1, Math.min(u, 1 - u, v, 1 - v) * 10);
    const slope = 0.03 * Math.pow(1 - v, 1.4);
    const ripple = 0.003 * Math.sin(x * 60 + ph[0]) * Math.sin(z * 45 + ph[1]) + 0.004 * Math.sin(x * 14 + z * 9 + ph[2]);
    return base + edge * (slope + ripple + 0.003);
  };
  const g = new THREE.PlaneGeometry(w - 0.002, d - 0.002, nx, nz).rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  // Sides: the sand as seen through the glass, from the bottom up to the dune's edge.
  const sides = [];
  for (const [ax, az, bx, bz] of [[-w / 2, d / 2, w / 2, d / 2], [w / 2, -d / 2, -w / 2, -d / 2], [-w / 2, -d / 2, -w / 2, d / 2], [w / 2, d / 2, w / 2, -d / 2]]) {
    const s = new THREE.PlaneGeometry(1, 1, 24, 1);
    const sp = s.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const k = sp.getX(i) + 0.5, up = sp.getY(i) > 0;
      const x = ax + (bx - ax) * k, z = az + (bz - az) * k;
      sp.setXYZ(i, x * 0.999, up ? height(x * 0.99, z * 0.99) : 0.001, z * 0.999);
    }
    s.computeVertexNormals();
    sides.push(s);
  }
  return { geometry: g, skirt: merge(sides), height };
}

function sandHeight(t, x, z) { return t.sand.height(x, z); }

function pebbles(t, rng, w, d) {
  const n = 110, m = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.7, envMap: t.env, envMapIntensity: 0.7 }), n);
  water(m.material, t, { caustics: 0.4 });
  const palette = ['#d8cfc4', '#a69080', '#7d6e63', '#f1ece4', '#b5835a', '#5c5552'];
  const mat = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const front = rng() < 0.6;
    const x = (rng() - 0.5) * (w - 0.02), z = front ? d / 2 - 0.01 - rng() * 0.08 : (rng() - 0.5) * (d - 0.02);
    const s = 0.002 + rng() * 0.004;
    q.setFromEuler(e.set(rng() * 3, rng() * 3, rng() * 3));
    mat.compose(new THREE.Vector3(x, sandHeight(t, x, z) + s * 0.3, z), q, new THREE.Vector3(s * 1.3, s * 0.7, s));
    m.setMatrixAt(i, mat);
    m.setColorAt(i, new THREE.Color(palette[Math.floor(rng() * palette.length)]));
  }
  return m;
}

function noise3(rng) {
  const k = Array.from({ length: 9 }, () => [rng() * 6, 1 + rng() * 3, rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1]);
  return (x, y, z) => k.reduce((s, [ph, f, a, b, c], i) => s + Math.sin((a * x + b * y + c * z) * f * (1 + i * 0.6) + ph) / (1 + i * 0.7), 0);
}

// A weathered stone: a displaced sphere, flattened, darker in the cracks.
function stone(rng, r) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const n = noise3(rng), p = g.attributes.position, col = [];
  const tint = new THREE.Color().setHSL(0.08 + rng() * 0.5, 0.06 + rng() * 0.08, 0.38 + rng() * 0.12);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = n(v.x * 1.5, v.y * 1.5, v.z * 1.5);
    const facet = Math.round(k * 2) / 2;
    v.multiplyScalar(1 + 0.12 * k + 0.05 * facet);
    v.set(v.x * r * (1.1 + rng() * 0.02), v.y * r * 0.75, v.z * r * 0.95);
    p.setXYZ(i, v.x, v.y, v.z);
    const c = tint.clone().multiplyScalar(0.75 + 0.18 * k);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function moss(rng, r) {
  const g = new THREE.IcosahedronGeometry(r, 3), p = g.attributes.position, col = [], v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).multiplyScalar(1 + (rng() - 0.5) * 0.18);
    p.setXYZ(i, v.x, v.y, v.z);
    const c = new THREE.Color().setHSL(0.27 + rng() * 0.04, 0.6, 0.16 + rng() * 0.1);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Driftwood: a tapering branch with two forks, bark-dark in the grooves.
function driftwood(t, rng, w, d) {
  const parts = [];
  const branch = (pts, r0, segs) => {
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, segs, r0, 9, false);
    const p = g.attributes.position, col = [], c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      curve.getPointAt(i / segs, c);
      const k = 1 - 0.75 * (i / segs);
      for (let j = 0; j <= 9; j++) {
        const idx = i * 10 + j;
        v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k * (0.9 + 0.2 * Math.sin(j * 2.1 + i * 0.7))).add(c);
        p.setXYZ(idx, v.x, v.y, v.z);
        const groove = 0.5 + 0.5 * Math.sin(j * 3.0 + i * 0.4);
        const col0 = new THREE.Color('#6b4f3a').lerp(new THREE.Color('#2e2118'), groove * 0.6);
        col.push(col0.r, col0.g, col0.b);
      }
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    parts.push(g);
    return curve;
  };
  const x0 = (rng() < 0.5 ? -1 : 1) * (w * 0.18 + rng() * w * 0.1), z0 = -d * 0.15;
  const y0 = sandHeight(t, x0, z0);
  const dir = -Math.sign(x0);
  const main = branch([
    new THREE.Vector3(x0, y0 - 0.005, z0), new THREE.Vector3(x0 + dir * 0.05, y0 + 0.04, z0 - 0.02),
    new THREE.Vector3(x0 + dir * 0.09, y0 + 0.11, z0 - 0.04), new THREE.Vector3(x0 + dir * 0.1, y0 + 0.2, z0 - 0.05),
  ], 0.011, 24);
  for (const [at, dx, dy] of [[0.45, -0.06, 0.08], [0.7, 0.05, 0.07]]) {
    const s = main.getPointAt(at);
    branch([s, new THREE.Vector3(s.x + dir * dx * 0.5, s.y + dy * 0.6, s.z + 0.01), new THREE.Vector3(s.x + dir * dx, s.y + dy, s.z + 0.02)], 0.0055, 10);
  }
  return merge(parts);
}

// All the plants as one swaying mesh: vallisneria ribbons along the back,
// sword-plant rosettes, red stem plants, and an anemone for the clownfish.
function plants(t, rng, w, d) {
  const pos = [], col = [], sway = [], seed = [], idx = [], idxFar = [];   // far: every 3rd row of the same vertices
  const vert = (x, y, z, c, s, sd) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); sway.push(s); seed.push(sd); return pos.length / 3 - 1; };
  const top = t.waterY - 0.015;
  // A ribbon: points up a curve, a strip across; `across` = 3 gives a folded midrib.
  const ribbon = (base, height, lean, width, twist, c0, c1, swayK, across = 2, arch = 0) => {
    const n = 12, sd = rng(), rows = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const up = Math.min(height * s * (1 - arch * s * s * 0.5), top - base.y);
      const cx = base.x + lean.x * s * s * height, cz = base.z + lean.z * s * s * height;
      const a = twist * s + lean.a;
      const wd = width * (s < 0.85 ? 1 - 0.3 * s : (1 - s) / 0.15 * 0.75) * (s < 0.08 ? 0.5 + s * 6 : 1);
      const c = c0.clone().lerp(c1, s);
      const row = [];
      for (let k = 0; k < across; k++) {
        const o = across === 2 ? k - 0.5 : (k - 1) * 0.5;
        const mid = across === 3 && k === 1;
        row.push(vert(cx + Math.cos(a) * wd * o, base.y + up + (mid ? width * 0.15 : 0), cz + Math.sin(a) * wd * o,
          mid ? c.clone().multiplyScalar(1.25) : c, Math.pow(s, 1.5) * swayK, sd));
      }
      rows.push(row);
    }
    for (const [list, step] of [[idx, 1], [idxFar, 3]]) for (let i = 0; i < n; i += step) for (let k = 0; k < across - 1; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + step][k], e = rows[i + step][k + 1];
      list.push(a, b, c, b, e, c);
    }
  };
  const green = (l = 0.3) => new THREE.Color().setHSL(0.27 + rng() * 0.08, 0.55 + rng() * 0.2, l + rng() * 0.08);
  // Vallisneria: tall ribbons in clumps along the back.
  for (let cl = 0; cl < 6; cl++) {
    const cx = (cl / 5 - 0.5) * (w - 0.06) + (rng() - 0.5) * 0.04, cz = -d / 2 + 0.02 + rng() * 0.04;
    for (let i = 0; i < 6; i++) {
      const x = cx + (rng() - 0.5) * 0.035, z = cz + (rng() - 0.5) * 0.02;
      ribbon({ x, y: sandHeight(t, x, z) - 0.002, z }, 0.18 + rng() * 0.16, { x: (rng() - 0.5) * 0.3, z: rng() * 0.15, a: rng() * 6 },
        0.007, (rng() - 0.5) * 3, green(0.16), green(0.42), 1.2);
    }
  }
  // Sword plants: rosettes of arching leaves.
  for (let r = 0; r < 2; r++) {
    const bx = (r ? 1 : -1) * (w * 0.25 + rng() * 0.05), bz = -d * 0.05 + rng() * 0.05;
    const by = sandHeight(t, bx, bz);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng() * 0.3, len = 0.06 + rng() * 0.05;
      const out = 0.35 + rng() * 0.3;
      ribbon({ x: bx, y: by, z: bz }, len * 1.4, { x: Math.cos(a) * out, z: Math.sin(a) * out, a: a + Math.PI / 2 },
        0.016, 0.2, green(0.2), green(0.38), 0.6, 3, 0.6);
    }
  }
  // Red stem plants: stems with paired leaves, red at the tips.
  for (let cl = 0; cl < 2; cl++) {
    const cx = (rng() - 0.5) * w * 0.5, cz = -d * 0.25 + rng() * 0.05;
    for (let s = 0; s < 6; s++) {
      const x = cx + (rng() - 0.5) * 0.04, z = cz + (rng() - 0.5) * 0.03, y0 = sandHeight(t, x, z), hgt = 0.1 + rng() * 0.1;
      const lean = { x: (rng() - 0.5) * 0.15, z: (rng() - 0.5) * 0.15 };
      ribbon({ x, y: y0, z }, hgt, { ...lean, a: 0 }, 0.002, 0, new THREE.Color('#4d6b2f'), new THREE.Color('#9c3a2e'), 1);
      for (let k = 1; k < 9; k++) {
        const s0 = k / 9, ly = y0 + hgt * s0;
        if (ly > top) break;
        const lx = x + lean.x * s0 * s0 * hgt, lz = z + lean.z * s0 * s0 * hgt;
        const c0 = new THREE.Color('#5a8f3a').lerp(new THREE.Color('#d1495b'), s0), c1 = c0.clone().multiplyScalar(1.2);
        for (const side of [0, Math.PI]) {
          const a = k * 1.3 + side;
          ribbon({ x: lx, y: ly, z: lz }, 0.016, { x: Math.cos(a) * 1.2, z: Math.sin(a) * 1.2, a: a + Math.PI / 2 }, 0.009, 0, c0, c1, Math.pow(s0, 1.5), 3, 1.4);
        }
      }
    }
  }
  // Anemone: a column and a crown of tentacles.
  const ax = -w * 0.08 + rng() * w * 0.16, az = d * 0.1, ay = sandHeight(t, ax, az);
  for (let i = 0; i < 70; i++) {
    const a = rng() * Math.PI * 2, rr = 0.004 + rng() * 0.018;
    const x = ax + Math.cos(a) * rr, z = az + Math.sin(a) * rr;
    ribbon({ x, y: ay + 0.012, z }, 0.03 + rng() * 0.02, { x: Math.cos(a) * 0.9, z: Math.sin(a) * 0.9, a: a + Math.PI / 2 },
      0.003, 0, new THREE.Color('#e5989b'), new THREE.Color('#f8edeb'), 2.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const gFar = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) gFar.setAttribute(k, a);
  gFar.setIndex(idxFar);
  // The anemone's column (not swaying).
  const column = new THREE.CylinderGeometry(0.016, 0.02, 0.014, 18, 1, true).translate(ax, ay + 0.006, az);
  const cc = [], cn = column.attributes.position.count;
  for (let i = 0; i < cn; i++) cc.push(...new THREE.Color('#b5838d').toArray());
  column.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
  column.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(cn), 1));
  column.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(cn), 1));
  column.deleteAttribute('uv');
  return { near: merge([g, column]), far: merge([gFar, column.clone()]) };
}

function dropFood(ctx, x, z) {
  const t = ctx.tank;
  const mat = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.8 });
  for (let i = 0; i < 8; i++) {
    const pellet = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 6, 4), mat);
    pellet.position.set(x + (Math.random() - 0.5) * 0.03, t.waterY - 0.002, z + (Math.random() - 0.5) * 0.03);
    pellet.userData.age = -i * 0.15;
    pellet.userData.ph = Math.random() * 6;
    t.food.push(pellet);
    t.root.add(pellet);
  }
}

function updateStatus(ctx) {
  const fish = [...ctx.tank.fish.values()].map((f) => f.data);
  const hungriest = [...fish].sort((a, b) => b.hunger - a.hunger)[0];
  const kinds = new Set(fish.map((f) => f.species)).size;
  const mood = !hungriest ? '' : hungriest.hunger > 0.85 ? ` · ${hungriest.name} is starving` : hungriest.hunger > 0.6 ? ` · ${hungriest.name} is hungry` : ' · all fed';
  ctx.status(`${fish.length} fish · ${kinds} kinds${mood}`);
}

// ---- textures ------------------------------------------------------------------------

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A soft room for reflections: a bright light bar overhead, blue-grey walls, a dark floor.
function envMap() {
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, '#f2f8ff'); gr.addColorStop(0.3, '#9db4c8'); gr.addColorStop(0.55, '#4b5b6b'); gr.addColorStop(1, '#1b1f24');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(40, 6, 176, 10);
  g.fillStyle = 'rgba(255,240,220,0.5)';
  g.fillRect(0, 40, 30, 30); g.fillRect(150, 44, 26, 22);
  const t = canvasTex(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function paintBackdrop(rng) {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 320 });
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 320);
  gr.addColorStop(0, '#0a3a5c'); gr.addColorStop(0.6, '#0c5e73'); gr.addColorStop(1, '#16807a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 320);
  g.strokeStyle = 'rgba(10,40,40,0.5)';
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const x = rng() * 512, hgt = 80 + rng() * 200;
    g.lineWidth = 3 + rng() * 6;
    g.beginPath(); g.moveTo(x, 320); g.quadraticCurveTo(x + (rng() - 0.5) * 60, 320 - hgt / 2, x + (rng() - 0.5) * 80, 320 - hgt); g.stroke();
  }
  const glow = g.createRadialGradient(256, 0, 10, 256, 0, 300);
  glow.addColorStop(0, 'rgba(180,240,255,0.35)'); glow.addColorStop(1, 'rgba(180,240,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 512, 320);
  return c;
}

function paintSand(rng) {
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const g = c.getContext('2d');
  g.fillStyle = '#d9c7a0';
  g.fillRect(0, 0, 256, 256);
  const cols = ['#efe3c8', '#c4ad82', '#a8916a', '#f8f1e3', '#8c7b63'];
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = cols[Math.floor(rng() * cols.length)];
    g.fillRect(rng() * 256, rng() * 256, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
  return c;
}

function paintSandSide(rng) {
  const c = Object.assign(document.createElement('canvas'), { width: 512, height: 64 });
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#d9c7a0'); gr.addColorStop(0.5, '#b89f74'); gr.addColorStop(1, '#6d5a40');
  g.fillStyle = gr;
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,250,235,0.5)' : 'rgba(60,45,30,0.4)';
    g.fillRect(rng() * 512, rng() * 64, 1 + rng() * 2, 1 + rng() * 2);
  }
  return c;
}

// Normal map for the water surface: overlapping soft waves.
function rippleNormals(rng) {
  const S = 128, c = Object.assign(document.createElement('canvas'), { width: S, height: S });
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  const waves = Array.from({ length: 6 }, () => [Math.round(1 + rng() * 4), Math.round(1 + rng() * 4) * (rng() < 0.5 ? -1 : 1), rng() * 6, 0.5 + rng()]);
  const hgt = (x, y) => waves.reduce((s, [a, b, ph, amp]) => s + amp * Math.sin((a * x + b * y) * Math.PI * 2 / S + ph), 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1);
    const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
    const i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Deterministic decoration per tank (same plants on every device).
function hashString(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
