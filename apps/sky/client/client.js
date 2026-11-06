// Sky (Stratum app): the roof is gone. Placed on the floor. The ceiling's
// shape comes from the room map (the biggest ceiling it found) or from the
// player (play-area kit: pinch each corner, raise / lower the height, on the
// app's page in the hand menu). Instance frame: y up from the floor.
// Config (shared): { theme, corners: [[x, z]…], height, bright, from }.
//
// Seen through the opening, in 3D (DESIGN.md §0 v88):
//   - the far sky: each theme's sky drawn once into a cube texture (a
//     skybox, infinitely far: only the direction counts), which the
//     opening's polygon looks up per pixel (cheap: one texture read);
//   - the cut edge: walls a roof's depth deep rising from the outline;
//   - a few real things up there, per theme: clouds, aurora curtains,
//     overhanging leaves, the sea's surface and a school of fish.
// They're only visible through the opening: each sky pixel checks that its
// line of sight passes the ceiling inside the outline, else it's dropped.
// All sky parts draw first, far to near, without depth testing (occlusion's
// real-ceiling depth would hide everything above it); the room's virtual
// things draw over them as usual. Themes add things in the room too: vines
// hang from the jungle, bubbles rise to the sea.
import { PlayArea } from '/js/apps/kit/playarea.js';

let THREE;
const THEMES = [
  { id: 'stars', label: 'Starry night', emoji: '🌌' },
  { id: 'aurora', label: 'Northern lights', emoji: '🌠' },
  { id: 'jungle', label: 'Jungle', emoji: '🌴' },
  { id: 'ocean', label: 'Under the sea', emoji: '🐠' },
];
const DEFAULT_H = 2.4;          // m above the floor when nothing better is known
const ROOF_T = 0.3;             // m: how deep the cut edge is
const MAX_CORNERS = 32;         // (shader uniform array)
const STEP_H = 0.05;            // height − / +
const BRIGHT = [0.35, 0.55, 0.75, 1];
const SKY_RES = 512;            // skybox face size (px)
// Draw order of the sky parts (all before the room's things; far to near).
const ORDER = { sky: -40, surface: -36, aurora: -34, clouds: -33, leaves: -31, fish: -30, walls: -28 };

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const cfg = { theme: 'stars', bright: 0.75, ...(ctx.instance.config ?? {}) };
    const s = (ctx.sky = { cfg, t0: performance.now(), shoot: null, nextShoot: performance.now() + 4000, extras: null, audio: null, parts: [] });
    s.floorY = floorY(ctx);
    if (!cfg.corners) {
      const c = ceilingFromMap(ctx);
      if (c) Object.assign(cfg, c, { from: 'map' });
    }
    if (cfg.corners) build(ctx); else beginSetup(ctx);
    setActions(ctx);
    window.__sky = { ctx, add: (o, d) => addCorner(ctx, { origin: new THREE.Vector3(...o), dir: new THREE.Vector3(...d).normalize() }), done: () => finishSetup(ctx), themes: THEMES.map((t) => t.id), setTheme: (id) => setTheme(ctx, id) };
  },

  frame(ctx, dt) {
    const s = ctx.sky;
    const now = performance.now(), t = (now - s.t0) / 1000;
    const v = ctx.viewer();
    if (s.u) {
      s.u.uTime.value = t;
      if (v) {
        s.u.uCam.value.copy(v.position);
        s.u.uRight.value.set(1, 0, 0).applyQuaternion(v.quaternion);
        s.u.uUp.value.set(0, 1, 0).applyQuaternion(v.quaternion);
      }
      shootingStars(s, now);
      for (const p of s.parts) p.update?.(t, dt);
    }
    s.extras?.update(t, dt);
    if (s.audio) s.audio.tick(now);
  },

  // While setting the ceiling, any pinch / tap is a corner.
  globalPress(ctx) { return !!ctx.sky?.setup; },
  aim(ctx, ray) { return ctx.sky?.setup && ctx.sky.area ? ctx.sky.area.aim(ray) : null; },   // (the cursor dot: where the corner would go)
  press(ctx, e) {
    const s = ctx.sky;
    if (e.phase !== 'down') return !!s.setup;
    unlockAudio(ctx);
    if (!s.setup) return false;
    const ray = e.ray?.();
    if (ray) addCorner(ctx, ray);
    return true;
  },
  select(ctx) { unlockAudio(ctx); },
  grab(ctx, e) { if (ctx.sky?.setup) e.preventDefault(); },

  revealMesh() { return null; },

  debug(ctx) { const s = ctx.sky; return s && { theme: s.cfg.theme, setup: !!s.setup, corners: s.cfg.corners?.length ?? 0, parts: s.parts.map((p) => p.name) }; },

  async stop(ctx) {
    const s = ctx.sky;
    s?.audio?.close();
    s?.area?.dispose();
    if (s) teardown(ctx);
    s?.skyTex?.dispose();
    if (window.__sky?.ctx === ctx) delete window.__sky;
  },
};

// ---- where the ceiling is -----------------------------------------------------------------

function floorY(ctx) {
  const floors = (ctx.surfaces?.() ?? []).filter((x) => x.kind === 'floor');
  if (!floors.length) return 0;
  const y = new THREE.Vector3().setFromMatrixPosition(floors[0].matrix).y;
  return Math.abs(y) < 0.6 ? y : 0;   // (a floor far from where Sky stands isn't this room's)
}

// The biggest ceiling in the room map, as instance-frame corners + height.
function ceilingFromMap(ctx) {
  let best = null;
  for (const c of (ctx.surfaces?.() ?? []).filter((x) => x.kind === 'ceiling' && x.polygon?.length >= 3)) {
    const pts = c.polygon.map(([x, z]) => new THREE.Vector3(x, 0, z).applyMatrix4(c.matrix));
    const corners = pts.map((p) => [p.x, p.z]);
    const a = Math.abs(corners.reduce((acc, p, i) => { const q = corners[(i + 1) % corners.length]; return acc + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    if (!best || a > best.a) best = { a, corners, height: pts.reduce((acc, p) => acc + p.y, 0) / pts.length };
  }
  if (!best || best.a < 1) return null;
  return { corners: simplify(best.corners).slice(0, MAX_CORNERS), height: best.height };
}

// Drop corners that barely bend the outline (map polygons are dense).
function simplify(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 0.004 || poly.length <= 4) out.push(b);
  }
  return out.length >= 3 ? out : poly;
}

// ---- setting the ceiling (its controls on the app's page in the hand menu) ------------------

function beginSetup(ctx) {
  const s = ctx.sky;
  teardown(ctx);
  s.setup = { height: s.cfg.height ?? s.floorY + DEFAULT_H };
  s.area = new PlayArea(THREE, { y: s.setup.height, color: 0xb197fc });
  ctx.spawn(s.area.group);
  showPanel(ctx, true);
  ctx.status('Pinch the ceiling corners');
}

function addCorner(ctx, ray) {
  const s = ctx.sky;
  if (!s.setup || s.area.corners.length >= MAX_CORNERS) return false;
  const ok = s.area.add(ray);
  showPanel(ctx);
  return ok;
}

function finishSetup(ctx) {
  const s = ctx.sky;
  if (!s.setup || !s.area.valid) return false;
  Object.assign(s.cfg, { corners: s.area.corners, height: s.setup.height, from: 'hand' });
  ctx.setConfig({ ...s.cfg });
  endSetup(ctx);
  build(ctx);
  return true;
}

function cancelSetup(ctx) {
  const s = ctx.sky;
  endSetup(ctx);
  if (s.cfg.corners) build(ctx);
  else ctx.status('No ceiling yet: Set the ceiling on its page');
}

function endSetup(ctx) {
  const s = ctx.sky;
  s.setup = null;
  s.area?.dispose();
  s.area = null;
  ctx.status('');
  showPanel(ctx);
}

function nudge(ctx, dy) {
  const s = ctx.sky;
  s.setup.height = Math.max(s.floorY + 1.5, Math.min(s.floorY + 6, s.setup.height + dy));
  s.area.setY(s.setup.height);
  showPanel(ctx);
}

// The app's page (ctx.panel): setting the ceiling, or the theme and brightness.
function showPanel(ctx, open = false) {
  const s = ctx.sky;
  if (s.setup) {
    const n = s.area.corners.length, cm = Math.round((s.setup.height - s.floorY) * 100);
    const crossing = n >= 3 && !s.area.valid;
    ctx.panel({
      title: 'Set the ceiling', sub: `${n} corner${n === 1 ? '' : 's'}`, open,
      blocks: [
        { kind: 'text', text: crossing ? 'The outline crosses itself: undo the last corner.'
          : n < 3 ? 'Raise or lower the outline until it sits on the ceiling, then pinch each corner in order.' : 'Pinch more corners, or Done.', color: crossing ? '#ff8787' : undefined },
        { kind: 'stepper', label: 'Ceiling height', value: `${cm} cm`, dec: () => nudge(ctx, -STEP_H), inc: () => nudge(ctx, STEP_H) },
        { kind: 'buttons', items: [
          { label: 'Undo', icon: 'back', disabled: !n, run: () => { s.area.undo(); showPanel(ctx); } },
          { label: 'Done', icon: 'check', tone: 'go', disabled: !s.area.valid, run: () => { if (!finishSetup(ctx)) ctx.log('Pinch at least 3 corners (an outline that doesn\'t cross itself)'); } },
          { label: 'Cancel', icon: 'close', tone: 'danger', run: () => cancelSetup(ctx) },
        ] },
      ],
    });
    return;
  }
  const pct = Math.round(s.cfg.bright * 100);
  const k = BRIGHT.findIndex((b) => b >= s.cfg.bright - 0.01);
  ctx.panel({
    title: 'Sky', sub: THEMES.find((t) => t.id === s.cfg.theme)?.label ?? '', open,
    blocks: [
      { kind: 'choice', label: 'Theme', value: s.cfg.theme, cols: 2, options: THEMES.map((t) => ({ id: t.id, label: t.label, emoji: t.emoji })), pick: (id) => setTheme(ctx, id) },
      { kind: 'stepper', label: 'Brightness', value: `${pct} %`, dec: k > 0 ? () => setBright(ctx, BRIGHT[k - 1]) : null, inc: k < BRIGHT.length - 1 ? () => setBright(ctx, BRIGHT[k + 1]) : null },
      { kind: 'buttons', items: [{ label: 'Set the ceiling', emoji: '📐', run: () => beginSetup(ctx) }] },
    ],
  });
}

function setTheme(ctx, id) {
  const s = ctx.sky;
  s.cfg.theme = id;
  ctx.setConfig({ ...s.cfg });
  if (s.cfg.corners && !s.setup) build(ctx);
  setActions(ctx);
}

function setBright(ctx, b) {
  const s = ctx.sky;
  s.cfg.bright = b;
  if (s.u) s.u.uBright.value = b;
  ctx.setConfig({ ...s.cfg });
  showPanel(ctx);
}

// Phones' overlay bar (the hand menu shows the page instead).
function setActions(ctx) {
  const s = ctx.sky;
  const i = THEMES.findIndex((t) => t.id === s.cfg.theme);
  const next = THEMES[(i + 1) % THEMES.length];
  ctx.actions([
    { label: `Next: ${next.emoji} ${next.label}`, run: () => setTheme(ctx, next.id) },
    { label: '📐 Set the ceiling', run: () => beginSetup(ctx) },
  ]);
  showPanel(ctx);
}

// ---- the sky --------------------------------------------------------------------------------

function teardown(ctx) {
  const s = ctx.sky;
  for (const p of s.parts) p.dispose();
  s.parts = [];
  s.mesh = null;
  s.u = null;
  s.extras?.dispose();
  s.extras = null;
}

function build(ctx) {
  const s = ctx.sky, cfg = s.cfg;
  teardown(ctx);
  const corners = cfg.corners.slice(0, MAX_CORNERS), H = cfg.height;
  s.skyTex?.dispose();
  s.skyTex = bakeSky(ctx, cfg.theme);
  // Shared by every sky part (one object each: updating it updates them all).
  s.u = {
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3(0, 1.6, 0) }, uRight: { value: new THREE.Vector3(1, 0, 0) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
    uH: { value: H }, uPoly: { value: Array.from({ length: MAX_CORNERS }, (_, i) => new THREE.Vector2(...(corners[i] ?? corners[0]))) }, uN: { value: corners.length },
    uBright: { value: cfg.bright }, uSky: { value: s.skyTex?.texture ?? null },
    uShootA: { value: new THREE.Vector3(0, 1, 0) }, uShootB: { value: new THREE.Vector3(0, 1, 0) }, uShootT: { value: -1 },
  };
  const add = (name, mesh, order, update = null, extra = []) => {
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.raycast = () => {};        // taps go through (it's the ceiling)
    mesh.userData.noReveal = true;
    ctx.spawn(mesh);
    s.parts.push({ name, mesh, update, dispose: () => { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); extra.forEach((x) => x.dispose()); } });
    return mesh;
  };
  // The opening: the far sky through it.
  const shape = new THREE.Shape(corners.map(([x, z]) => new THREE.Vector2(x, -z)));
  const hole = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, H, 0), skyMaterial(s.u, HOLE_VERT, HOLE_FRAG));
  s.mesh = add('sky', hole, ORDER.sky);
  s.mat = hole.material;
  add('walls', walls(corners, H), ORDER.walls);
  // A few real things up there.
  const c = centroid(corners);
  for (const p of PARTS[cfg.theme]?.(s.u, c, H) ?? []) add(p.name, p.mesh, ORDER[p.order ?? p.name], p.update, p.extra);
  s.extras = EXTRAS[cfg.theme]?.(ctx, corners, H, s.floorY) ?? null;
  s.audio?.setTheme(cfg.theme);
  ctx.status(THEMES.find((t) => t.id === cfg.theme)?.label ?? '');
  showPanel(ctx);
}

function inOutline(poly, x, z) {
  let k = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k;
  }
  return k;
}

const centroid = (pts) => pts.reduce((a, [x, z]) => [a[0] + x / pts.length, a[1] + z / pts.length], [0, 0]);

// Sky parts: no depth test (drawn first, far to near), blended by hand.
function skyMaterial(u, vertexShader, fragmentShader, extra = {}, blend = 'normal') {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, ...extra }, vertexShader, fragmentShader,
    depthTest: false, depthWrite: false, transparent: false,   // (the opaque list, in renderOrder: before the room's things)
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    side: THREE.DoubleSide,
  });
}

// The cut edge: walls ROOF_T deep up from the outline, their inside faces.
function walls(corners, H) {
  const pos = [], uv = [];
  const n = corners.length;
  for (let i = 0; i < n; i++) {
    let a = corners[i], b = corners[(i + 1) % n];
    // Its front (a → b → b-top winds to a normal ∝ (−dz, 0, dx)) must face inside the outline.
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
    const mid = [(a[0] + b[0]) / 2 - (dz / len) * 0.01, (a[1] + b[1]) / 2 + (dx / len) * 0.01];
    if (!inOutline(corners, mid[0], mid[1])) [a, b] = [b, a];
    const quad = [[a, 0], [b, 0], [b, 1], [a, 0], [b, 1], [a, 1]];
    for (const [p, k] of quad) { pos.push(p[0], H + k * ROOF_T, p[1]); uv.push(i, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv;
      void main() {
        float k = vUv.y, face = 0.82 + 0.18 * fract(vUv.x * 0.37);          // a little difference between faces
        vec3 col = mix(vec3(0.16, 0.15, 0.15), vec3(0.42, 0.4, 0.38), k) * face; // lit from the open sky above
        col += smoothstep(0.92, 1.0, k) * 0.18;                              // the top edge catches the light
        col *= 1.0 - smoothstep(0.08, 0.0, k) * 0.35;                        // where it meets the ceiling
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false, side: THREE.FrontSide,
  });
  return new THREE.Mesh(g, m);
}

// The far sky: the theme's sky drawn once into a cube texture.
function bakeSky(ctx, theme) {
  const renderer = ctx.renderer;
  if (!renderer) return null;
  const rt = new THREE.WebGLCubeRenderTarget(SKY_RES, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    vertexShader: `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: NOISE + NIGHT + `varying vec3 vDir;\n` + (FAR[theme] ?? FAR.stars),
    side: THREE.BackSide, depthWrite: false,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), mat);
  scene.add(ball);
  try { new THREE.CubeCamera(0.1, 50, rt).update(renderer, scene); }
  catch (err) { ctx.log(`sky: ${err.message}`); }
  ball.geometry.dispose();
  mat.dispose();
  return rt;
}

function shootingStars(s, now) {
  const u = s.u;
  if (s.cfg.theme !== 'stars' && s.cfg.theme !== 'aurora') return;
  if (!s.shoot && now > s.nextShoot) {
    const a = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random() * 0.4, Math.random() - 0.5).normalize();
    const b = a.clone().add(new THREE.Vector3(Math.random() - 0.5, -0.25, Math.random() - 0.5).multiplyScalar(0.5)).normalize();
    s.shoot = { t0: now, ms: 700 + Math.random() * 500 };
    u.uShootA.value.copy(a);
    u.uShootB.value.copy(b);
  }
  if (s.shoot) {
    const k = (now - s.shoot.t0) / s.shoot.ms;
    u.uShootT.value = k;
    if (k > 1.3) { s.shoot = null; u.uShootT.value = -1; s.nextShoot = now + 6000 + Math.random() * 14000; }
  }
}

// ---- shaders ---------------------------------------------------------------------------------
// Positions are in the instance frame (the parts are spawned at its origin);
// uCam is the eye in the same frame.

const NOISE = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
`;

const NIGHT = /* glsl */`
float starLayer(vec3 d, float scale, float size, float seed) {
  vec3 q = d * scale, cell = floor(q);
  vec3 h = hash33(cell + seed);
  float dist = length(q - (cell + 0.2 + 0.6 * h));
  return step(0.55, h.x) * smoothstep(size, 0.0, dist) * (0.4 + 0.6 * h.z);
}
vec3 nightSky(vec3 d, float milky) {
  vec3 s = rotX(d, 0.35);
  vec3 col = mix(vec3(0.012, 0.016, 0.045), vec3(0.035, 0.045, 0.1), pow(1.0 - max(d.y, 0.0), 2.0));
  vec3 n = normalize(vec3(0.35, 0.25, 0.9));
  vec3 e1 = normalize(cross(n, vec3(0.0, 1.0, 0.0))), e2 = cross(n, e1);
  float b = dot(s, n);
  vec2 bp = vec2(atan(dot(s, e2), dot(s, e1)) * 3.0, b * 6.0);
  float band = exp(-b * b * 18.0) * milky;
  float clump = fbm(bp * 3.0), dust = fbm(bp * 7.0 + 3.0);
  col += band * (0.5 * clump + 0.3) * vec3(0.5, 0.58, 0.9) * 0.45;
  col += exp(-b * b * 60.0) * milky * clump * clump * vec3(1.0, 0.78, 0.55) * 0.45;
  col *= 1.0 - band * smoothstep(0.45, 0.7, dust) * 0.7;
  float st = starLayer(s, 40.0, 0.09, 3.0) * 3.0 + starLayer(s, 70.0, 0.13, 1.0) * 2.0 + starLayer(s, 150.0, 0.16, 7.0) * 1.2 + starLayer(s, 260.0, 0.2, 13.0) * (0.6 + band);
  vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash13(floor(s * 70.0)));
  return col + st * tint;
}
`;

// Baked once into the skybox (vDir: the direction).
const FAR = {
  stars: `void main() { gl_FragColor = vec4(nightSky(normalize(vDir), 1.0), 1.0); }`,
  aurora: `void main() { vec3 d = normalize(vDir); vec3 col = nightSky(d, 0.35) * 0.7; col += vec3(0.05, 0.25, 0.12) * pow(1.0 - abs(d.y), 6.0) * 0.5; gl_FragColor = vec4(col, 1.0); }`,
  jungle: `void main() {
    vec3 d = normalize(vDir), sun = normalize(vec3(0.35, 0.9, 0.2));
    float sd = max(dot(d, sun), 0.0), up = max(d.y, 0.0);
    vec3 col = mix(vec3(0.72, 0.86, 0.95), vec3(0.28, 0.55, 0.9), pow(up, 0.6));
    vec2 p = d.xz / max(d.y, 0.08);
    float cl = smoothstep(0.5, 0.85, fbm(p * 0.6));
    col = mix(col, vec3(1.0), cl * 0.75 * smoothstep(0.0, 0.25, up));
    col += pow(sd, 8.0) * vec3(1.0, 0.92, 0.7) * 0.5 + smoothstep(0.9993, 0.9997, sd) * 2.0;
    gl_FragColor = vec4(col, 1.0); }`,
  ocean: `void main() {
    vec3 d = normalize(vDir); float up = pow(clamp(d.y, 0.0, 1.0), 3.0);
    vec3 col = mix(vec3(0.0, 0.06, 0.16), vec3(0.05, 0.4, 0.55), up);
    col += vec3(0.4, 0.75, 0.8) * smoothstep(0.55, 1.0, fbm(vec2(atan(d.x, d.z) * 10.0, d.y * 2.0))) * (0.1 + 0.2 * up);
    gl_FragColor = vec4(col, 1.0); }`,
};

// Only through the opening: the line of sight to p crosses the ceiling inside the outline.
const CLIP = /* glsl */`
uniform vec3 uCam; uniform float uH; uniform vec2 uPoly[${MAX_CORNERS}]; uniform int uN;
bool throughHole(vec3 p) {
  if (uCam.y >= uH - 0.01) return true;     // (up at the ceiling or above: it's all open)
  vec3 d = p - uCam;
  if (d.y <= 1e-4) return false;
  vec2 q = uCam.xz + d.xz * ((uH - uCam.y) / d.y);
  bool inside = false;
  for (int i = 0; i < ${MAX_CORNERS}; i++) {
    if (i >= uN) break;
    vec2 a = uPoly[i], b = uPoly[i + 1 < uN ? i + 1 : 0];
    if ((a.y > q.y) != (b.y > q.y) && q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
`;

const HOLE_VERT = `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const HOLE_FRAG = /* glsl */`
uniform vec3 uCam, uShootA, uShootB; uniform float uBright, uShootT; uniform samplerCube uSky;
varying vec3 vPos;
void main() {
  vec3 d = normalize(vPos - uCam);
  vec3 col = textureCube(uSky, d).rgb;
  if (uShootT >= 0.0) {   // a shooting star
    float k = clamp(uShootT, 0.0, 1.0);
    vec3 head = normalize(mix(uShootA, uShootB, k)), tail = normalize(mix(uShootA, uShootB, max(0.0, k - 0.3)));
    vec3 ba = head - tail, pa = d - tail;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    col += smoothstep(0.004, 0.0, length(pa - ba * h)) * h * (1.0 - smoothstep(1.0, 1.3, uShootT)) * vec3(1.0, 0.95, 0.85) * 2.0;
  }
  gl_FragColor = vec4(col * uBright, 1.0);
}`;

// Billboards (clouds, fish): instances at iPos.xyz, iPos.w across, facing you.
const BILLBOARD_VERT = /* glsl */`
attribute vec4 iPos; attribute vec2 iSeed;
uniform vec3 uRight, uUp; uniform float uTime, uDrift, uSpan;
varying vec3 vP; varying vec2 vUv; varying vec2 vSeed;
void main() {
  vec3 c = iPos.xyz;
  c.x = mod(c.x + uTime * uDrift * (0.6 + 0.4 * iSeed.x) + uSpan, 2.0 * uSpan) - uSpan;   // drifting by, wrapping round
  vP = c + (uRight * position.x + uUp * position.y) * iPos.w;
  vUv = uv; vSeed = iSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.0);
}`;

function instanced(base, n, fill) {
  const g = new THREE.InstancedBufferGeometry().copy(base);
  const pos = new Float32Array(n * 4), seed = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) fill(i, pos, seed);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 4));
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 2));
  g.instanceCount = n;
  base.dispose();
  return g;
}

let rnd = 1;
const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);

function cloudTex() {
  const cv = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), g = cv.getContext('2d');
  rnd = 7;
  for (let k = 0; k < 9; k++) {
    const x = 30 + rand() * 68, y = 44 + rand() * 40, r = 18 + rand() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv);
  return t;
}

// Clouds n of them, alt [lo, hi] m above the ceiling, spread ±span, tint, alpha.
function clouds(u, c, H, { n = 16, lo = 25, hi = 60, span = 70, tint = [1, 1, 1], alpha = 0.7, drift = 0.6 } = {}) {
  rnd = 11;
  const g = instanced(new THREE.PlaneGeometry(1, 0.6), n, (i, pos, seed) => {
    pos.set([c[0] + (rand() - 0.5) * 2 * span, H + lo + rand() * (hi - lo), c[1] + (rand() - 0.5) * 2 * span, 14 + rand() * 22], i * 4);
    seed.set([rand(), rand()], i * 2);
  });
  const tex = cloudTex();
  const m = skyMaterial(u, BILLBOARD_VERT, CLIP + `
    uniform sampler2D uTex; uniform vec3 uTint; uniform float uAlpha, uBright; varying vec3 vP; varying vec2 vUv; varying vec2 vSeed;
    void main() {
      if (!throughHole(vP)) discard;
      float a = texture2D(uTex, vUv).a * uAlpha;
      if (a < 0.01) discard;
      gl_FragColor = vec4(uTint * (0.85 + 0.15 * vSeed.y) * uBright, a);
    }`, { uTex: { value: tex }, uTint: { value: new THREE.Vector3(...tint) }, uAlpha: { value: alpha }, uDrift: { value: drift }, uSpan: { value: span } });
  return { name: 'clouds', mesh: new THREE.Mesh(g, m), extra: [tex] };
}

// Northern lights: curtains far off, folding slowly (additive).
function aurora(u, c, H) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    rnd = 31 + k;
    const R = 15 + k * 6, a0 = k * 2.1 + rand() * 0.6, sweep = 2.3 + rand() * 0.6, base = 14 + rand() * 5, tall = 14 + rand() * 6;   // (round the sky, overhead-ish: they show through the opening)
    const N = 96, pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + (i / N) * sweep, x = c[0] + Math.cos(a) * R, z = c[1] + Math.sin(a) * R;
      pos.push(x, H + base, z, x, H + base + tall, z);
      uv.push(i / N, 0, i / N, 1);
      if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = skyMaterial(u, `
      uniform float uTime, uSeed; varying vec3 vP; varying vec2 vUv;
      void main() {
        vec3 p = position;
        float w = sin(uv.x * 9.0 + uTime * 0.12 + uSeed) * 4.0 + sin(uv.x * 23.0 - uTime * 0.2 + uSeed * 2.0) * 1.5;
        p.x += w * 0.7; p.z += w * 0.7;
        vP = p; vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`, CLIP + `
      uniform float uTime, uSeed, uBright; varying vec3 vP; varying vec2 vUv;
      void main() {
        if (!throughHole(vP)) discard;
        float y = vUv.y;
        float rays = 0.55 + 0.45 * sin(vUv.x * 380.0 + sin(vUv.x * 40.0 + uTime * 0.3) * 6.0 + uSeed);
        float body = smoothstep(0.0, 0.12, y) * pow(1.0 - y, 1.6);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float flick = 0.7 + 0.3 * sin(uTime * 0.5 + vUv.x * 12.0 + uSeed);
        vec3 col = mix(vec3(0.15, 1.0, 0.5), vec3(0.7, 0.3, 1.0), smoothstep(0.45, 1.0, y));
        gl_FragColor = vec4(col * body * edge * rays * flick * 0.85 * uBright, 1.0);
      }`, { uSeed: { value: rand() * 10 } }, 'add');
    parts.push({ name: `aurora${k}`, order: 'aurora', mesh: new THREE.Mesh(g, m) });
  }
  return parts;
}

function leafTex() {
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 }), g = cv.getContext('2d');
  rnd = 5;
  for (let k = 0; k < 14; k++) {
    const x = 50 + rand() * 156, y = 50 + rand() * 156, a = rand() * 6.28, l = 40 + rand() * 46;
    g.save(); g.translate(x, y); g.rotate(a);
    const sh = 0.55 + rand() * 0.45;
    g.fillStyle = `rgb(${Math.round(40 * sh)},${Math.round(120 * sh + 40)},${Math.round(30 * sh)})`;
    g.beginPath(); g.ellipse(0, 0, l, l * 0.32, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(20,60,15,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(-l, 0); g.lineTo(l, 0); g.stroke();
    g.restore();
  }
  return new THREE.CanvasTexture(cv);
}

// The jungle: leaf clusters overhanging the opening from all round, and higher up.
function leaves(u, c, H) {
  const n = 50;
  rnd = 17;
  const g = instanced(new THREE.PlaneGeometry(1, 1), n, (i, pos, seed) => {
    const a = rand() * 6.28, r = 2.2 + rand() * 6 + (i % 3 === 0 ? 5 : 0);   // round the edge, not over the middle
    pos.set([c[0] + Math.cos(a) * r, H + 0.4 + rand() * 5.5 + r * 0.25, c[1] + Math.sin(a) * r, 1.0 + rand() * 1.8], i * 4);
    seed.set([rand(), rand()], i * 2);
  });
  const tex = leafTex();
  const m = skyMaterial(u, `
    attribute vec4 iPos; attribute vec2 iSeed; uniform float uTime; varying vec3 vP; varying vec2 vUv; varying vec2 vSeed;
    void main() {
      float yaw = iSeed.x * 6.283, tilt = 0.25 + iSeed.y * 0.5 + sin(uTime * 0.6 + iSeed.x * 20.0) * 0.05;
      vec3 ax = vec3(cos(yaw), 0.0, sin(yaw)), side = vec3(-sin(yaw), 0.0, cos(yaw));
      vec3 ay = normalize(side * cos(tilt) + vec3(0.0, sin(tilt), 0.0));
      vP = iPos.xyz + (ax * position.x + ay * position.y) * iPos.w;
      vUv = uv; vSeed = iSeed;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.0);
    }`, CLIP + `
    uniform sampler2D uTex; uniform float uBright; varying vec3 vP; varying vec2 vUv; varying vec2 vSeed;
    void main() {
      if (!throughHole(vP)) discard;
      vec4 t = texture2D(uTex, vUv);
      if (t.a < 0.5) discard;
      vec3 col = t.rgb * (0.55 + 0.45 * vSeed.y) + vec3(0.12, 0.16, 0.02) * vSeed.x;   // some catch the sun
      gl_FragColor = vec4(col * uBright, 1.0);
    }`, { uTex: { value: tex } });
  return { name: 'leaves', mesh: new THREE.Mesh(g, m), extra: [tex] };
}

// Under the sea: the surface far above, waving, bright where you look straight up.
function surface(u, c, H) {
  const g = new THREE.PlaneGeometry(160, 160).rotateX(Math.PI / 2).translate(c[0], H + 5, c[1]);
  const m = skyMaterial(u, `varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, CLIP + `
    uniform float uTime, uBright; varying vec3 vP;
    void main() {
      if (!throughHole(vP)) discard;
      vec3 d = normalize(vP - uCam);
      vec2 p = vP.xz;
      float w = 0.5 * sin(p.x * 0.9 + uTime * 0.8) * sin(p.y * 0.7 - uTime * 0.6) + 0.3 * sin(p.x * 2.3 - p.y * 1.7 + uTime * 1.3)
              + 0.2 * sin(p.x * 5.1 + p.y * 3.7 - uTime * 2.1);
      float up = pow(clamp(d.y, 0.0, 1.0), 3.0);
      vec3 col = mix(vec3(0.03, 0.22, 0.34), vec3(0.45, 0.8, 0.88), up * (0.75 + 0.25 * w));
      col += smoothstep(0.55, 0.95, w) * 0.08 * (0.4 + up);   // glints on the crests
      float haze = 1.0 - exp(-length(vP - uCam) * 0.03);
      gl_FragColor = vec4(col * uBright, 1.0 - haze * 0.8);
    }`);
  return { name: 'surface', mesh: new THREE.Mesh(g, m) };
}

// A school of fish circling up there (silhouettes against the light).
function fish(u, c, H) {
  const n = 40;
  rnd = 23;
  const g = instanced(new THREE.PlaneGeometry(1, 0.5), n, (i, pos, seed) => {
    const school = i % 2;
    pos.set([3 + school * 2.5 + rand() * 1.2, H + 1.6 + school * 1.5 + rand() * 0.8, rand() * 6.28, 0.25 + rand() * 0.2], i * 4);   // radius, height, angle, size
    seed.set([rand(), school], i * 2);
  });
  const m = skyMaterial(u, `
    attribute vec4 iPos; attribute vec2 iSeed; uniform vec3 uRight, uUp, uC; uniform float uTime; varying vec3 vP; varying vec2 vUv; varying float vDir;
    void main() {
      float a = iPos.z + uTime * (iSeed.y > 0.5 ? -0.09 : 0.12);
      vec3 at = vec3(uC.x + cos(a) * iPos.x, iPos.y + sin(uTime + iSeed.x * 9.0) * 0.1, uC.z + sin(a) * iPos.x);
      vec3 heading = vec3(-sin(a), 0.0, cos(a)) * (iSeed.y > 0.5 ? -1.0 : 1.0);
      vDir = sign(dot(heading, uRight) + 1e-4);
      vP = at + (uRight * position.x + uUp * position.y) * iPos.w;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(vP, 1.0);
    }`, CLIP + `
    uniform float uTime, uBright; varying vec3 vP; varying vec2 vUv; varying float vDir;
    void main() {
      if (!throughHole(vP)) discard;
      vec2 q = vUv - 0.5; q.x *= vDir;
      q.y += sin(uTime * 6.0 + q.x * 10.0) * 0.02;
      float body = smoothstep(0.24, 0.2, length(q * vec2(1.0, 2.2)));
      float tail = step(0.0, -q.x - 0.18) * smoothstep(0.1, 0.0, abs(q.y) - (-q.x - 0.18) * 0.9) * step(-q.x, 0.36);
      float a = max(body, tail);
      if (a < 0.05) discard;
      gl_FragColor = vec4(vec3(0.02, 0.08, 0.12) * uBright, a * 0.8);
    }`, { uC: { value: new THREE.Vector3(c[0], 0, c[1]) } });
  return { name: 'fish', mesh: new THREE.Mesh(g, m) };
}

// Per theme: the real things up there.
const PARTS = {
  stars: (u, c, H) => [clouds(u, c, H, { n: 10, lo: 40, hi: 80, tint: [0.12, 0.14, 0.22], alpha: 0.55, drift: 0.4 })],
  aurora: (u, c, H) => [...aurora(u, c, H), clouds(u, c, H, { n: 6, lo: 50, hi: 90, tint: [0.08, 0.1, 0.16], alpha: 0.5, drift: 0.3 })],
  jungle: (u, c, H) => [clouds(u, c, H, { n: 14, lo: 35, hi: 70, tint: [1, 1, 1], alpha: 0.8 }), leaves(u, c, H)],
  ocean: (u, c, H) => [surface(u, c, H), fish(u, c, H)],
};

// ---- things in the room ------------------------------------------------------------------------

// Points inside the outline (for vines and bubbles).
function scatter(corners, n, seed) {
  const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  let r = seed;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const inside = (x, z) => {
    let k = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const [xi, zi] = corners[i], [xj, zj] = corners[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k;
    }
    return k;
  };
  const out = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries++) {
    const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
    if (inside(x, z)) out.push([x, z, rnd()]);
  }
  return out;
}

const EXTRAS = {
  // Vines hanging from the canopy into the room, swaying a little.
  jungle(ctx, corners, h) {
    const g = new THREE.Group();
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x2f5d1e, roughness: 0.8 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8f2a, roughness: 0.6, side: THREE.DoubleSide });
    const leafGeo = new THREE.SphereGeometry(1, 8, 4).scale(0.03, 0.004, 0.015);
    const vines = [];
    for (const [x, z, k] of scatter(corners, 14, 77)) {
      const len = 0.25 + k * 0.6;
      const pts = Array.from({ length: 6 }, (_, i) => new THREE.Vector3(Math.sin(i + k * 9) * 0.03, -len * (i / 5), Math.cos(i * 1.3 + k * 5) * 0.03));
      const vine = new THREE.Group();
      vine.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.005, 5), vineMat));
      for (let i = 1; i < 8; i++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        const p = pts[Math.min(5, Math.round(i * 5 / 7))];
        leaf.position.set(p.x + (i % 2 ? 0.02 : -0.02), -len * (i / 8), p.z);
        leaf.rotation.set(0.4, i * 1.7, i % 2 ? 0.6 : -0.6);
        vine.add(leaf);
      }
      vine.position.set(x, h - 0.01, z);
      vine.userData.phase = k * 10;
      vines.push(vine);
      g.add(vine);
    }
    g.traverse((o) => { o.raycast = () => {}; o.userData.noReveal = true; });
    ctx.spawn(g);
    return {
      update(t) { for (const v of vines) { v.rotation.z = Math.sin(t * 0.6 + v.userData.phase) * 0.06; v.rotation.x = Math.cos(t * 0.45 + v.userData.phase) * 0.04; } },
      dispose() { g.removeFromParent(); vineMat.dispose(); leafMat.dispose(); leafGeo.dispose(); g.traverse((o) => o.geometry?.dispose?.()); },
    };
  },

  // Bubbles rising from the floor to the surface, wobbling.
  ocean(ctx, corners, h, floor) {
    const n = 60;
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc5f6fa, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.raycast = () => {};
    mesh.userData.noReveal = true;
    mesh.frustumCulled = false;
    const bubbles = scatter(corners, n, 991).map(([x, z, k]) => ({ x, z, k, y: floor + k * (h - floor), r: 0.004 + k * 0.01, v: 0.12 + k * 0.15 }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    ctx.spawn(mesh);
    return {
      update(t, dt) {
        bubbles.forEach((b, i) => {
          b.y += b.v * dt;
          if (b.y > h) b.y = floor + 0.05;
          pos.set(b.x + Math.sin(t * 2 + b.k * 30) * 0.02, b.y, b.z + Math.cos(t * 1.7 + b.k * 20) * 0.02);
          sc.setScalar(b.r);
          mesh.setMatrixAt(i, m.compose(pos, q, sc));
        });
        mesh.count = bubbles.length;
        mesh.instanceMatrix.needsUpdate = true;
      },
      dispose() { mesh.removeFromParent(); geo.dispose(); mat.dispose(); },
    };
  },
};

// ---- sound -----------------------------------------------------------------------------------
// Made on the spot (no files): crickets at night, birds in the jungle, a deep hush under the sea.

function unlockAudio(ctx) {
  const s = ctx.sky;
  if (ctx.settings?.get('sound') === false) return;
  if (!s.audio) s.audio = makeAudio(s.cfg.theme);
  s.audio.ac.resume?.();
}

function makeAudio(theme) {
  const ac = new AudioContext();
  const out = ac.createGain();
  out.gain.value = 0.25;
  out.connect(ac.destination);
  let bed = null, next = 0, current = theme;
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  function startBed() {
    bed?.stop();
    bed = null;
    if (current !== 'ocean') return;
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 280;
    const g = ac.createGain();
    g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(out);
    src.start();
    bed = src;
  }
  function chirp(f0, f1, at, dur, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.02);
  }
  function crickets(at) {
    const f = 4300 + Math.random() * 500;
    for (let k = 0; k < 3; k++) for (let p = 0; p < 4; p++) chirp(f, f * 0.98, at + k * 0.18 + p * 0.025, 0.02, 0.05);
  }
  function bird(at) {
    const kind = Math.random();
    if (kind < 0.5) for (let k = 0; k < 2 + Math.floor(Math.random() * 4); k++) chirp(2500 + Math.random() * 2000, 1800 + Math.random() * 3000, at + k * 0.13, 0.09, 0.12);
    else if (kind < 0.8) { chirp(1200, 2600, at, 0.25, 0.1); chirp(2600, 900, at + 0.3, 0.35, 0.08); }
    else for (let k = 0; k < 3; k++) chirp(700, 450, at + k * 0.28, 0.2, 0.1);   // a low whoop
  }
  function bubble(at) { chirp(400 + Math.random() * 500, 1200 + Math.random() * 800, at, 0.06, 0.05); }
  startBed();
  return {
    ac,
    setTheme(t) { current = t; startBed(); },
    tick(now) {
      if (ac.state !== 'running' || now < next) return;
      const at = ac.currentTime + 0.05;
      if (current === 'stars' || current === 'aurora') { crickets(at); next = now + 900 + Math.random() * 1800; }
      else if (current === 'jungle') { bird(at); next = now + 1500 + Math.random() * 5000; }
      else if (current === 'ocean') { if (Math.random() < 0.6) bubble(at); next = now + 2000 + Math.random() * 4000; }
    },
    close() { bed?.stop(); ac.close(); },
  };
}
