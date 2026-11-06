// The airplane: a little high-wing taildragger in the spirit of a Piper Cub
// (fabric-yellow, black lightning stripe, balloon tires, a wooden prop),
// built from code. Moving parts: ailerons, elevator, rudder, propeller
// (blades, then a blur disc as it spins up), wheels, tailwheel (steers with
// the rudder), navigation lights and a blinking beacon.
//
//   const p = buildPlane(THREE, { length: 0.24, scheme: SCHEMES[0] });
//   scene.add(p.group);            // frame: forward −Z, up +Y, right +X; origin = centre of gravity
//   p.set({ ail, elev, rud, rpm, wheel, dt, lights });   // −1..1 controls; rpm 0..1; wheel = ground distance rolled (m)
//   p.dims → sizes in meters: contact points (mains, tail), wingtips, nose, …
//   buildPlane(THREE, { detailM: 2.5 })   // beyond this (m from your eyes) small parts go and the tires get simpler
//
// Modelled with the fuselage 1 unit long (nose at z −0.5), then scaled.

export const SCHEMES = [
  { id: 'cub', name: 'Cub yellow', paint: '#f4c430', stripe: '#141414', trim: '#141414', tire: '#1d1d1f', reg: 'N4STR' },
  { id: 'red', name: 'Barn red', paint: '#c92a2a', stripe: '#f8f9fa', trim: '#f8f9fa', tire: '#1d1d1f', reg: 'N7RED' },
  { id: 'sky', name: 'Sky blue', paint: '#4dabf7', stripe: '#ffffff', trim: '#1c3d5a', tire: '#1d1d1f', reg: 'N2SKY' },
  { id: 'green', name: 'Forest', paint: '#2f9e44', stripe: '#ffe066', trim: '#ffe066', tire: '#1d1d1f', reg: 'N9GRN' },
  { id: 'white', name: 'Polar', paint: '#f1f3f5', stripe: '#e8590c', trim: '#e8590c', tire: '#1d1d1f', reg: 'N1ICE' },
];

const SPAN = 0.785;          // half span
const CHORD = 0.235;
const WING_LE = -0.23;       // z of the leading edge
const WING_Y = 0.122;        // underside of the wing at the root
const DIHEDRAL = 0.018;      // rad
const AIL = [0.42, 0.9, 0.75];   // aileron: span from / to (of the half span), hinge (of the chord)
const PROP_R = 0.135;
const PROP_Z = -0.535;
const MAIN = { x: 0.105, y: -0.152, z: -0.272, r: 0.058, w: 0.044 };
const TAIL = { y: -0.018, z: 0.47, r: 0.016 };
const CG = [0, 0.03, WING_LE + CHORD * 0.27];

// ---- shapes ---------------------------------------------------------------------------------

// Monotone cubic through points [[t, v]…] (no overshoot: the outline stays where it's put).
function curve(pts) {
  const n = pts.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
  }
  return (t) => {
    let i = 0;
    while (i < n - 2 && t > pts[i + 1][0]) i++;
    const [t0, v0] = pts[i], [t1, v1] = pts[i + 1], h = t1 - t0, s = Math.min(1, Math.max(0, (t - t0) / h));
    const s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m[i + 1];
  };
}

// Fuselage outline along t (0 nose … 1 tail): top, bottom, half width.
const TOP = curve([[0, 0.036], [0.02, 0.056], [0.06, 0.072], [0.12, 0.081], [0.2, 0.086], [0.235, 0.088], [0.27, 0.122], [0.5, 0.122], [0.56, 0.113], [0.7, 0.095], [0.85, 0.079], [1, 0.066]]);
const BOT = curve([[0, -0.034], [0.02, -0.052], [0.06, -0.066], [0.12, -0.073], [0.25, -0.076], [0.45, -0.074], [0.6, -0.056], [0.75, -0.026], [0.9, 0.012], [1, 0.036]]);
const HW = curve([[0, 0.034], [0.02, 0.046], [0.06, 0.053], [0.12, 0.057], [0.25, 0.058], [0.45, 0.056], [0.6, 0.048], [0.75, 0.036], [0.9, 0.022], [1, 0.012]]);
const ROUND = curve([[0, 2.2], [0.1, 3.0], [0.6, 3.2], [1, 2.6]]);   // superellipse exponent: round nose, boxy cabin

// Where the fuselage surface is at (t, θ); θ 0 = right side, π/2 = top.
function fuseAt(t, th, out = [0, 0, 0]) {
  const n = ROUND(t), c = Math.cos(th), s = Math.sin(th);
  const top = TOP(t), bot = BOT(t), yc = (top + bot) / 2, hh = (top - bot) / 2;
  out[0] = HW(t) * Math.sign(c) * Math.abs(c) ** (2 / n);
  out[1] = yc + hh * Math.sign(s) * Math.abs(s) ** (2 / n);
  out[2] = -0.5 + t;
  return out;
}
// The angle where the side reaches a height fraction f (−1 bottom … 1 top of the side).
const sideAngle = (t, f) => Math.asin(Math.sign(f) * Math.min(1, Math.abs(f) ** (ROUND(t) / 2)));

// NACA 4-digit section: camber m at p, thickness tk (chord 1). → upper / lower y at x.
function naca(m, p, tk) {
  const yt = (x) => 5 * tk * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < p ? (m / (p * p)) * (2 * p * x - x * x) : (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * x - x * x));
  return { up: (x) => yc(x) + yt(x), lo: (x) => yc(x) - yt(x), camber: yc, half: yt };
}
const WING_FOIL = naca(0.04, 0.4, 0.12);

// A closed section loop for chord fractions [x0, x1] (x0 > 0: a rounded nose,
// as on an aileron; x1 < 1: a flat hinge face). [[x, y]…], same count for any range.
function foilLoop(foil, x0, x1, n = 22) {
  const xs = [];
  for (let i = 0; i <= n; i++) { const k = i / n; xs.push(x0 + (x1 - x0) * (x0 > 0 ? k : 0.5 - 0.5 * Math.cos(Math.PI * k))); }
  const loop = [];
  for (let i = n; i >= 0; i--) loop.push([xs[i], foil.up(xs[i])]);   // upper, aft → fore
  if (x0 > 0) {   // rounded nose between upper and lower at x0
    const yc = (foil.up(x0) + foil.lo(x0)) / 2, r = (foil.up(x0) - foil.lo(x0)) / 2;
    for (let k = 1; k < 6; k++) { const a = Math.PI / 2 + (Math.PI * k) / 6; loop.push([x0 + Math.cos(a) * r, yc + Math.sin(a) * r]); }
  }
  for (let i = x0 > 0 ? 0 : 1; i <= n; i++) loop.push([xs[i], foil.lo(xs[i])]);   // lower, fore → aft
  return loop;
}

// ---- geometry helpers -----------------------------------------------------------------------------

function indexed(THREE, pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Rings of points (each the same count, closed loops) → a skin, plus caps at both ends.
function skin(THREE, rings, { capStart = true, capEnd = true, uvOf = null } = {}) {
  const pos = [], uv = [], idx = [], m = rings[0].length;
  rings.forEach((ring, i) => ring.forEach((p, j) => { pos.push(...p); uv.push(...(uvOf ? uvOf(i, j) : [i / (rings.length - 1), j / m])); }));
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = (i + 1) * m + j, d = (i + 1) * m + ((j + 1) % m);
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ring, flip) => {
    const base = pos.length / 3, cx = ring.reduce((s, p) => s + p[0], 0) / m, cy = ring.reduce((s, p) => s + p[1], 0) / m, cz = ring.reduce((s, p) => s + p[2], 0) / m;
    pos.push(cx, cy, cz); uv.push(0, 0);
    ring.forEach((p) => { pos.push(...p); uv.push(0, 0); });
    for (let j = 0; j < m; j++) { const a = base + 1 + j, b = base + 1 + ((j + 1) % m); if (flip) idx.push(base, b, a); else idx.push(base, a, b); }
  };
  if (capStart) cap(rings[0], false);
  if (capEnd) cap(rings.at(-1), true);
  return indexed(THREE, pos, uv, idx);
}

// The other side: mirrored in x, winding flipped so it still faces out.
function mirrorX(THREE, geo) {
  const g = geo.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  if (g.index) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {   // (extrusions aren't indexed: swap the 2nd and 3rd vertex of every triangle)
    for (const a of Object.values(g.attributes)) {
      const n = a.itemSize, arr = a.array;
      for (let v = 0; v < a.count; v += 3) for (let k = 0; k < n; k++) { const i1 = (v + 1) * n + k, i2 = (v + 2) * n + k, t = arr[i1]; arr[i1] = arr[i2]; arr[i2] = t; }
      a.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
  return g;
}

function noRaycast(o) { o.traverse((n) => { n.raycast = () => {}; }); return o; }

// ---- textures -------------------------------------------------------------------------------------

function canvasTex(THREE, w, h, draw, srgb = true) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The fuselage skin: u = t (nose → tail), v = (θ + π/2) / 2π (bottom, right side, top, left side, bottom).
// Side coordinates (s along, f height −1…1 on the side) map to the canvas per
// side, so text reads properly on both.
function fuselageTextures(THREE, scheme) {
  const W = 2048, H = 1024;
  const vOf = (t, f, side) => { const a = sideAngle(t, f) / (Math.PI / 2); return side > 0 ? 0.25 + 0.25 * a : 0.75 - 0.25 * a; };
  const P = (t, f, side) => [t * W, (1 - vOf(t, f, side)) * H];
  const poly = (g, side, pts) => { g.beginPath(); pts.forEach(([t, f], i) => { const [x, y] = P(t, f, side); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath(); };
  // Side height fraction of a physical height y at t.
  const fOf = (t, y) => { const top = TOP(t), bot = BOT(t); return ((y - (top + bot) / 2) / ((top - bot) / 2)); };
  const window = (g, side, t0, t1, y0, y1, steps = 8) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) { const t = t0 + ((t1 - t0) * i) / steps; pts.push([t, fOf(t, y1)]); }
    for (let i = steps; i >= 0; i--) { const t = t0 + ((t1 - t0) * i) / steps; pts.push([t, fOf(t, y0)]); }
    poly(g, side, pts);
  };
  const stripePts = () => {   // the lightning stripe: from the nose, a zig, then tapering to the tail
    const up = [], lo = [];
    const band = [[0.0, 0.2, -0.12], [0.18, 0.2, -0.2], [0.262, 0.17, -0.24], [0.3, -0.12, -0.5], [0.322, 0.24, -0.18], [0.5, 0.2, -0.16], [0.75, 0.13, -0.08], [0.99, 0.05, -0.02]];
    for (const [t, a, b] of band) { up.push([t, a]); lo.push([t, b]); }
    return [...up, ...lo.reverse()];
  };
  const map = canvasTex(THREE, W, H, (g) => {
    g.fillStyle = scheme.paint; g.fillRect(0, 0, W, H);
    // Fabric: faint stringers and a little shading toward the belly.
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0.10)'); grad.addColorStop(0.25, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.06)'); grad.addColorStop(0.75, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.10)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(0,0,0,0.05)'; g.lineWidth = 3;
    for (let i = 1; i < 24; i++) { g.beginPath(); g.moveTo(0.27 * W, (i / 24) * H); g.lineTo(W, (i / 24) * H); g.stroke(); }
    for (const side of [1, -1]) {
      // Lightning stripe.
      g.fillStyle = scheme.stripe;
      const s = stripePts();
      poly(g, side, s);
      g.fill();
      // Cowling seam and panel lines.
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4;
      for (const t of [0.12, 0.235]) { g.beginPath(); const a = P(t, -0.98, side), b = P(t, 0.98, side); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
      // Windows: door + rear, dark glass with a frame.
      for (const [t0, t1] of [[0.275, 0.39], [0.4, 0.49]]) {
        window(g, side, t0, t1, 0.03, 0.112);
        g.fillStyle = '#16222c'; g.fill();
        g.lineWidth = 7; g.strokeStyle = scheme.trim; g.stroke();
        // A sky reflection across the glass.
        window(g, side, t0 + 0.012, t1 - 0.04, 0.085, 0.104, 4);
        g.fillStyle = 'rgba(180,210,235,0.35)'; g.fill();
      }
      // Door outline and handle.
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 3;
      window(g, side, 0.27, 0.395, -0.06, 0.118);
      g.stroke();
      const hdl = P(0.38, fOf(0.38, 0.0), side);
      g.fillStyle = '#adb5bd'; g.fillRect(hdl[0] - 10, hdl[1] - 4, 20, 8);
      // Registration on the rear fuselage.
      const t0 = 0.6, f0 = fOf(0.62, 0.052);
      const [x0, y0] = P(t0, f0, side);
      g.save();
      g.translate(x0, y0);
      // Right side: reading toward the nose (canvas −x), up = canvas up. Left: toward the tail, up = canvas down.
      if (side > 0) g.scale(-1, 1); else g.scale(1, -1);
      g.fillStyle = scheme.trim;
      g.font = '700 74px "Arial Narrow", system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.textAlign = side > 0 ? 'right' : 'left';
      g.fillText(scheme.reg, side > 0 ? 0 : 0, 0);
      g.restore();
    }
    // Windshield (top front of the cabin) and skylight over the cabin.
    g.fillStyle = '#16222c';
    g.beginPath();
    const yOf = (th) => (1 - (th + Math.PI / 2) / (Math.PI * 2)) * H;
    g.rect(0.236 * W, yOf(Math.PI - 0.55), 0.034 * W, yOf(0.55) - yOf(Math.PI - 0.55));
    g.fill();
    g.fillStyle = 'rgba(180,210,235,0.3)';
    g.fillRect(0.24 * W, yOf(Math.PI / 2 + 0.5), 0.012 * W, yOf(Math.PI / 2 - 0.5) - yOf(Math.PI / 2 + 0.5));
    // Exhaust stain on the belly behind the stack.
    const st = g.createLinearGradient(0.1 * W, 0, 0.45 * W, 0);
    st.addColorStop(0, 'rgba(40,30,20,0.35)'); st.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = st; g.fillRect(0.1 * W, H * 0.94, 0.35 * W, H * 0.06); g.fillRect(0.1 * W, 0, 0.35 * W, H * 0.04);
  });
  // Roughness: glass is smooth, paint satin.
  const rough = canvasTex(THREE, W / 4, H / 4, (g, w, h) => {
    g.fillStyle = 'rgb(150,150,150)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgb(20,20,20)';
    g.scale(0.25, 0.25);
    for (const side of [1, -1]) for (const [t0, t1] of [[0.275, 0.39], [0.4, 0.49]]) { window(g, side, t0, t1, 0.03, 0.112); g.fill(); }
    const yOf = (th) => (1 - (th + Math.PI / 2) / (Math.PI * 2)) * H;
    g.fillRect(0.236 * W, yOf(Math.PI - 0.55), 0.034 * W, yOf(0.55) - yOf(Math.PI - 0.55));
  }, false);
  return { map, rough };
}

function wingTexture(THREE, scheme) {
  return canvasTex(THREE, 1024, 256, (g, w, h) => {
    g.fillStyle = scheme.paint; g.fillRect(0, 0, w, h);
    // Ribs under the fabric (u = span), and the spar line.
    for (let i = 0; i <= 16; i++) {
      const x = (i / 16) * w;
      const gr = g.createLinearGradient(x - 8, 0, x + 8, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.09)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - 8, 0, 16, h);
    }
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, h * 0.2, w, h * 0.06);
  });
}

// ---- the plane ----------------------------------------------------------------------------------------

export function buildPlane(THREE, { length = 0.24, scheme = SCHEMES[0], detailM = 2.5 } = {}) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.position.set(-CG[0], -CG[1], -CG[2]);
  group.add(body);
  group.scale.setScalar(length);
  const parts = {};
  const details = [];   // small parts hidden when far (after the build, below)
  const { map, rough } = fuselageTextures(THREE, scheme);
  const paint = new THREE.MeshStandardMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0.05 });
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(THREE, scheme), roughness: 0.55, metalness: 0.02 });
  const plain = new THREE.MeshStandardMaterial({ color: scheme.paint, roughness: 0.5, metalness: 0.02 });
  const trim = new THREE.MeshStandardMaterial({ color: scheme.trim, roughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.6, metalness: 0.4 });
  const rubber = new THREE.MeshStandardMaterial({ color: scheme.tire, roughness: 0.92 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.32, metalness: 0.05 });
  parts.materials = [paint, wingMat, plain, trim, metal, dark, rubber, wood];

  // Fuselage: superellipse rings along a lofted outline.
  {
    const NT = 72, NR = 48, rings = [], ts = [];
    for (let i = 0; i < NT; i++) { const k = i / (NT - 1); ts.push(k < 0.3 ? 0.3 * (k / 0.3) ** 1.6 : k); }
    for (const t of ts) {
      const ring = [];
      for (let j = 0; j <= NR; j++) ring.push(fuseAt(t, -Math.PI / 2 + (j / NR) * Math.PI * 2, [0, 0, 0]));
      rings.push(ring);
    }
    // (NR + 1 points per ring: a seam with its own UVs at the belly.)
    const pos = [], uv = [], idx = [], m = NR + 1;
    rings.forEach((ring, i) => ring.forEach((p, j) => { pos.push(...p); uv.push(ts[i], j / NR); }));
    for (let i = 0; i < NT - 1; i++) for (let j = 0; j < NR; j++) {
      const a = i * m + j, b = a + 1, c = a + m, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const fus = new THREE.Mesh(indexed(THREE, pos, uv, idx), paint);
    body.add(fus);
    // Tail cap.
    const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), paint);
    tail.position.set(0, (TOP(1) + BOT(1)) / 2, 0.5);
    tail.scale.set(HW(1), (TOP(1) - BOT(1)) / 2, 0.01);
    body.add(tail);
    // Cowl front: a dark face with two air inlets, a polished nose ring.
    const face = new THREE.Mesh(new THREE.CircleGeometry(1, 32), dark);
    face.position.set(0, (TOP(0) + BOT(0)) / 2, -0.5005);
    face.scale.set(HW(0) * 0.98, (TOP(0) - BOT(0)) / 2 * 0.98, 1);
    face.rotation.y = Math.PI;
    body.add(face);
    for (const s of [1, -1]) {
      const inlet = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      inlet.position.set(s * 0.02, 0.012, -0.5015);
      inlet.rotation.y = Math.PI;
      inlet.scale.set(1, 0.7, 1);
      body.add(inlet);
    }
  }

  // Engine cylinder heads poking out of the cowl (4, finned), exhaust stack.
  {
    const prof = [];
    for (let i = 0; i <= 12; i++) { const y = i * 0.0022; prof.push(new THREE.Vector2(i % 2 ? 0.0125 : 0.0095, y)); }
    prof.push(new THREE.Vector2(0.006, 12 * 0.0022 + 0.002), new THREE.Vector2(0, 12 * 0.0022 + 0.002));
    prof.unshift(new THREE.Vector2(0, 0));
    const cyl = new THREE.LatheGeometry(prof, 18);
    for (const s of [1, -1]) for (const t of [0.07, 0.115]) {
      const c = new THREE.Mesh(cyl, metal);
      const p = fuseAt(t, s > 0 ? 0.15 : Math.PI - 0.15);
      c.position.set(p[0] - s * 0.004, p[1], p[2]);
      c.rotation.z = -s * Math.PI / 2;
      body.add(c);
      details.push(c);
    }
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.05, 10), metal);
    stack.position.set(0.012, BOT(0.13) - 0.006, -0.36);
    stack.rotation.x = Math.PI / 2 - 0.25;
    body.add(stack);
    details.push(stack);
  }

  // Wing: a cambered section, ailerons cut out of the outer panels, rounded tips.
  {
    const roundFrom = 0.93;
    const k = (s) => (s < roundFrom ? 1 : Math.sqrt(Math.max(0.03, 1 - ((s - roundFrom) / (1 - roundFrom)) ** 2)));
    const station = (s, loop) => {
      const kk = k(s), c = CHORD * kk, le = WING_LE + 0.42 * CHORD * (1 - kk);
      const x = s * SPAN, y = WING_Y + Math.sin(DIHEDRAL) * x;
      return loop.map(([cx, cy]) => [x, y + cy * c, le + cx * c]);
    };
    const panel = (s0, s1, x0, x1, n) => {
      const loop = foilLoop(WING_FOIL, x0, x1), rings = [];
      for (let i = 0; i <= n; i++) rings.push(station(s0 + ((s1 - s0) * i) / n, loop));
      return skin(THREE, rings, { uvOf: (i, j) => [s0 + ((s1 - s0) * i) / n, j / loop.length] });
    };
    const right = [panel(0, AIL[0], 0, 1, 4), panel(AIL[0], AIL[1], 0, AIL[2], 6), panel(AIL[1], 1, 0, 1, 10)];
    for (const g of right) { body.add(new THREE.Mesh(g, wingMat)); body.add(new THREE.Mesh(mirrorX(THREE, g), wingMat)); }
    // Ailerons on hinges (pivot at the hinge line, mid-span of the aileron).
    const hingeY = (s) => WING_Y + Math.sin(DIHEDRAL) * s * SPAN + WING_FOIL.camber(AIL[2]) * CHORD;
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      const sMid = (AIL[0] + AIL[1]) / 2;
      pivot.position.set(side * sMid * SPAN, hingeY(sMid), WING_LE + AIL[2] * CHORD);
      pivot.rotation.z = side * DIHEDRAL;
      let g = panel(AIL[0] + 0.004, AIL[1] - 0.004, AIL[2] + 0.006, 1, 4);
      if (side < 0) g = mirrorX(THREE, g);
      g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-side * DIHEDRAL));
      pivot.add(new THREE.Mesh(g, wingMat));
      body.add(pivot);
      parts[side > 0 ? 'aileronR' : 'aileronL'] = pivot;
    }
    // Struts: a V from the lower fuselage to the front and rear spars.
    const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
    strutGeo.applyMatrix4(new THREE.Matrix4().makeScale(0.0035, 1, 0.007));
    const strut = (a, b) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = new THREE.Mesh(strutGeo, plain);
      m.position.copy(A).lerp(B, 0.5);
      m.scale.y = A.distanceTo(B);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      body.add(m);
    };
    for (const s of [1, -1]) {
      const root = [s * (HW(0.33) - 0.004), BOT(0.33) + 0.012, -0.17];
      const sx = 0.56 * SPAN, y = WING_Y + Math.sin(DIHEDRAL) * sx - 0.002;
      strut(root, [s * sx, y, WING_LE + 0.22 * CHORD]);
      strut(root, [s * sx, y, WING_LE + 0.68 * CHORD]);
      strut([s * 0.35 * SPAN, root[1] + (y - root[1]) * 0.62, WING_LE + 0.25 * CHORD], [s * 0.35 * SPAN, y, WING_LE + 0.3 * CHORD]);   // jury strut
    }
  }

  // Tail: stabilizer + elevator, fin + rudder (rounded plates).
  {
    const ext = (shape, thick) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: 0.0035, bevelSize: 0.003, bevelSegments: 3, curveSegments: 14 });
      return g;
    };
    const flat = (g, y) => g.rotateX(Math.PI / 2).translate(0, y + 0.0025, 0);   // shape (x, z) lying flat at y
    const stabY = 0.05, hinge = 0.415;
    const stab = new THREE.Shape();
    stab.moveTo(0, 0.33); stab.lineTo(0.19, 0.336); stab.quadraticCurveTo(0.236, 0.345, 0.236, hinge - 0.002); stab.lineTo(0, hinge - 0.002); stab.closePath();
    const sg = flat(ext(stab, 0.005), stabY);
    body.add(new THREE.Mesh(sg, plain), new THREE.Mesh(mirrorX(THREE, sg), plain));
    const elev = new THREE.Shape();
    elev.moveTo(0.012, 0.003); elev.lineTo(0.236, 0.003); elev.quadraticCurveTo(0.238, 0.07, 0.17, 0.077); elev.lineTo(0.04, 0.074); elev.quadraticCurveTo(0.012, 0.07, 0.012, 0.045); elev.closePath();
    const eg = flat(ext(elev, 0.004), 0);
    const ep = new THREE.Group();
    ep.position.set(0, stabY, hinge);
    ep.add(new THREE.Mesh(eg, plain), new THREE.Mesh(mirrorX(THREE, eg), plain));
    body.add(ep);
    parts.elevator = ep;
    const up = (g) => g.rotateY(-Math.PI / 2).translate(0.003, 0, 0);   // shape (z, y) standing up
    const fin = new THREE.Shape();
    fin.moveTo(0.27, 0.078); fin.quadraticCurveTo(0.365, 0.09, 0.388, 0.198); fin.quadraticCurveTo(0.398, 0.213, 0.42, 0.213); fin.lineTo(0.42, 0.06); fin.lineTo(0.3, 0.068); fin.closePath();
    body.add(new THREE.Mesh(up(ext(fin, 0.006)), plain));
    const rud = new THREE.Shape();
    rud.moveTo(0.003, 0.213); rud.quadraticCurveTo(0.07, 0.216, 0.092, 0.16); rud.lineTo(0.104, 0.065); rud.quadraticCurveTo(0.106, 0.03, 0.072, 0.024); rud.lineTo(0.003, 0.03); rud.closePath();
    const rp = new THREE.Group();
    rp.position.set(0, 0, 0.42);
    const rm = new THREE.Mesh(up(ext(rud, 0.006)), plain);
    rp.add(rm);
    // Tail light on the rudder's trailing edge.
    body.add(rp);
    parts.rudder = rp;
    // Stripe on the rudder: the trim colour.
    const band = new THREE.Shape();
    band.moveTo(0.004, 0.16); band.lineTo(0.088, 0.165); band.lineTo(0.093, 0.15); band.lineTo(0.004, 0.145); band.closePath();
    rp.add(new THREE.Mesh(new THREE.ExtrudeGeometry(band, { depth: 0.0135, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.00675, 0, 0), trim));
  }

  // Landing gear: V legs to balloon tires; a sprung tailwheel that steers.
  {
    const leg = (a, b, r = 0.0045) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), plain);
      m.position.copy(A).lerp(B, 0.5);
      m.scale.y = A.distanceTo(B);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      body.add(m);
    };
    parts.wheels = [];
    const tireGeo = new THREE.TorusGeometry(MAIN.r - MAIN.w / 2, MAIN.w / 2, 18, 40).rotateY(Math.PI / 2);
    const tireFar = new THREE.TorusGeometry(MAIN.r - MAIN.w / 2, MAIN.w / 2, 8, 16).rotateY(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(MAIN.r * 0.42, MAIN.r * 0.42, MAIN.w * 0.9, 24).rotateZ(Math.PI / 2);
    const capGeo = new THREE.SphereGeometry(MAIN.r * 0.2, 12, 8).scale(0.5, 1, 1);
    for (const s of [1, -1]) {
      const axle = [s * MAIN.x, MAIN.y, MAIN.z];
      leg([s * 0.035, BOT(0.2) + 0.006, -0.315], [s * (MAIN.x - 0.025), MAIN.y, MAIN.z]);
      leg([s * 0.035, BOT(0.33) + 0.006, -0.19], [s * (MAIN.x - 0.025), MAIN.y, MAIN.z]);
      leg([s * 0.012, BOT(0.27) + 0.002, -0.25], [s * (MAIN.x - 0.025), MAIN.y + 0.01, MAIN.z], 0.004);   // the shock strut
      const w = new THREE.Group();
      w.position.set(...axle);
      const tire = new THREE.LOD();
      tire.addLevel(new THREE.Mesh(tireGeo, rubber), 0, 0.15);
      tire.addLevel(new THREE.Mesh(tireFar, rubber), detailM, 0.15);
      w.add(tire, new THREE.Mesh(hubGeo, metal));
      const cap = new THREE.Mesh(capGeo, metal);
      cap.position.x = s * MAIN.w * 0.45;
      w.add(cap);
      details.push(cap);
      // Tread blocks so you can see it roll.
      const tread = new THREE.InstancedMesh(new THREE.BoxGeometry(MAIN.w * 0.7, 0.004, 0.006), rubber, 18);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
        tread.setMatrixAt(i, m4.compose(new THREE.Vector3(0, Math.cos(a) * MAIN.r * 0.985, Math.sin(a) * MAIN.r * 0.985), q, new THREE.Vector3(1, 1, 1)));
      }
      w.add(tread);
      details.push(tread);
      body.add(w);
      parts.wheels.push(w);
    }
    leg([-MAIN.x + 0.025, MAIN.y, MAIN.z], [MAIN.x - 0.025, MAIN.y, MAIN.z], 0.004);   // axle
    // Tailwheel on a leaf spring.
    const tw = new THREE.Group();
    tw.position.set(0, BOT(0.95), 0.45);
    const spring = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, 0.05), dark);
    const dz = TAIL.z - 0.45, dy = TAIL.y + TAIL.r * 0.2 - BOT(0.95);
    spring.position.set(0, dy / 2, dz / 2);
    spring.rotation.x = Math.atan2(-dy, dz);
    spring.scale.z = Math.hypot(dy, dz) / 0.05;
    tw.add(spring);
    const fork = new THREE.Group();
    fork.position.set(0, dy, dz);
    const twheel = new THREE.Mesh(new THREE.TorusGeometry(TAIL.r * 0.62, TAIL.r * 0.38, 10, 20).rotateY(Math.PI / 2), rubber);
    twheel.position.y = TAIL.y - (BOT(0.95) + dy);
    fork.add(twheel);
    tw.add(fork);
    body.add(tw);
    parts.tailwheel = fork;
    parts.tailRoll = twheel;
  }

  // Propeller: two twisted wooden blades on a hub, a spinner, and a blur disc for speed.
  {
    const prop = new THREE.Group();
    prop.position.set(0, (TOP(0) + BOT(0)) / 2, PROP_Z);
    const blade = new THREE.Shape();
    blade.moveTo(0.015, -0.011);
    blade.bezierCurveTo(0.05, -0.016, 0.1, -0.015, 0.125, -0.009);
    blade.quadraticCurveTo(PROP_R + 0.003, -0.002, PROP_R, 0.004);
    blade.bezierCurveTo(0.11, 0.012, 0.05, 0.015, 0.015, 0.009);
    blade.closePath();
    const bg = new THREE.ExtrudeGeometry(blade, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 16 });
    bg.translate(0, 0, -0.0015);
    // Twist: steep at the root, flat at the tip (rotate each point about the blade's long axis).
    const p = bg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const r = Math.max(0.015, p.getX(i)), a = Math.atan(0.035 / r) * 0.9;
      const y = p.getY(i), z = p.getZ(i);
      p.setY(i, y * Math.cos(a) - z * Math.sin(a));
      p.setZ(i, y * Math.sin(a) + z * Math.cos(a));
    }
    bg.computeVertexNormals();
    const blades = new THREE.Group();
    const tipGeo = new THREE.BoxGeometry(0.011, 0.02, 0.0066), tipMat = new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.4 });
    parts.tipMat = tipMat;
    for (const a of [0, Math.PI]) {
      const b = new THREE.Mesh(bg, wood);
      b.rotation.z = a;
      blades.add(b);
      // Tip paint.
      const arm = new THREE.Group(), tip = new THREE.Mesh(tipGeo, tipMat);
      arm.rotation.z = a;
      tip.position.x = PROP_R - 0.008;
      tip.rotation.x = Math.atan(0.035 / (PROP_R - 0.008)) * 0.9;   // the blade's twist there
      arm.add(tip);
      blades.add(arm);
    }
    prop.add(blades);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.018, 18).rotateX(Math.PI / 2), metal);
    hub.position.z = 0.004;
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.03, 24).rotateX(-Math.PI / 2), metal);
    spinner.position.z = -0.018;
    prop.add(hub, spinner);
    const blurTex = canvasTex(THREE, 256, 256, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, w * 0.08, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(120,80,40,0.0)'); gr.addColorStop(0.3, 'rgba(120,80,40,0.35)'); gr.addColorStop(0.88, 'rgba(150,110,70,0.28)'); gr.addColorStop(0.93, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    const blur = new THREE.Mesh(new THREE.CircleGeometry(PROP_R + 0.004, 48), new THREE.MeshBasicMaterial({ map: blurTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
    blur.renderOrder = 2;
    prop.add(blur);
    body.add(prop);
    parts.prop = prop; parts.blades = blades; parts.blur = blur;
  }

  // Lights: red left tip, green right tip, white tail, a red beacon on the wing.
  {
    const glowTex = canvasTex(THREE, 64, 64, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    const light = (color, pos, size) => {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2 }));
      bulb.position.set(...pos);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(size);
      bulb.add(glow);
      body.add(bulb);
      return { bulb, glow };
    };
    const tipY = WING_Y + Math.sin(DIHEDRAL) * SPAN + 0.008;
    parts.navL = light(0xff3b30, [-SPAN - 0.004, tipY, WING_LE + 0.42 * CHORD], 0.05);
    parts.navR = light(0x34c759, [SPAN + 0.004, tipY, WING_LE + 0.42 * CHORD], 0.05);
    parts.tailLight = light(0xffffff, [0, 0.05, 0.523], 0.04);
    parts.beacon = light(0xff2a1a, [0, WING_Y + 0.03, WING_LE + 0.45 * CHORD], 0.09);
  }

  // Far away: the small parts go (each into an LOD with nothing as its far level).
  if (Number.isFinite(detailM)) for (const o of details) {
    const l = new THREE.LOD();
    l.position.copy(o.position); l.quaternion.copy(o.quaternion); l.scale.copy(o.scale);
    o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
    o.parent.add(l);
    l.addLevel(o, 0, 0.15);
    l.addLevel(new THREE.Object3D(), detailM, 0.15);
  }

  noRaycast(group);
  group.traverse((n) => { if (n.isMesh) { n.castShadow = true; } });

  // Sizes in meters (plane frame, origin at the CG).
  const S = length, at = (x, y, z) => new THREE.Vector3((x - CG[0]) * S, (y - CG[1]) * S, (z - CG[2]) * S);
  const dims = {
    length: S, span: 2 * SPAN * S,
    mains: [at(MAIN.x, MAIN.y - MAIN.r, MAIN.z), at(-MAIN.x, MAIN.y - MAIN.r, MAIN.z)],
    tail: at(0, TAIL.y - TAIL.r, TAIL.z),
    wheelR: MAIN.r * S,
    // Points that mustn't touch anything (they crash): nose, wingtips, tail top, prop tips (down).
    hard: [at(0, 0, -0.55), at(SPAN, WING_Y + SPAN * DIHEDRAL, WING_LE + 0.4 * CHORD), at(-SPAN, WING_Y + SPAN * DIHEDRAL, WING_LE + 0.4 * CHORD),
      at(0, 0.215, 0.43), at(0, (TOP(0) + BOT(0)) / 2 - PROP_R, PROP_Z), at(0.2, 0.05, 0.45), at(-0.2, 0.05, 0.45)],
    radius: SPAN * S * 1.02,
  };

  let beaconT = 0, propA = 0;
  function set({ ail = 0, elev = 0, rud = 0, rpm = 0, wheel = 0, dt = 0, lights = true } = {}) {
    const AMAX = 0.42, EMAX = 0.45, RMAX = 0.5;
    // Right aileron up for a right roll; left down. (rotation.x > 0 lowers the trailing edge.)
    parts.aileronR.rotation.x = -ail * AMAX;
    parts.aileronL.rotation.x = ail * AMAX;
    parts.elevator.rotation.x = -elev * EMAX;   // up elevator: trailing edge up
    parts.rudder.rotation.y = rud * RMAX;       // right rudder: trailing edge to the right
    parts.tailwheel.rotation.y = rud * RMAX * 0.6;
    // Prop: blades to ~ 60 rev/s look, the blur disc fades in above a slow tick-over.
    propA += dt * (rpm > 0.01 ? 18 + rpm * 70 : 0);   // rad / s (a stopped engine: a stopped prop)
    parts.prop.rotation.z = propA;
    const blurK = Math.min(1, Math.max(0, (rpm - 0.08) / 0.3));
    parts.blur.material.opacity = blurK * 0.85;
    parts.blades.visible = blurK < 0.95;
    for (const w of parts.wheels) w.rotation.x = -wheel / (MAIN.r * S);
    parts.tailRoll.rotation.x = -wheel / (TAIL.r * S * 0.6);
    beaconT += dt;
    const on = lights && beaconT % 1.1 < 0.12;
    parts.beacon.glow.visible = on;
    parts.beacon.bulb.material.emissiveIntensity = on ? 2.5 : 0.25;
    const strobe = lights && (beaconT + 0.5) % 1.3 < 0.06;
    parts.tailLight.glow.scale.setScalar(strobe ? 0.12 : 0.04);
    for (const l of [parts.navL, parts.navR, parts.tailLight]) l.glow.visible = lights;
  }
  set();

  function dispose() {
    group.traverse((n) => { if (n.geometry) n.geometry.dispose(); });
    for (const m of [...parts.materials, parts.tipMat]) { m.map?.dispose(); m.roughnessMap?.dispose(); m.dispose(); }
    parts.blur.material.map.dispose();
  }

  return { group, parts, dims, set, dispose };
}
