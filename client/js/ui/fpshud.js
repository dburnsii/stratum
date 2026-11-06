// FPS meter: a small head-locked panel (Settings → FPS meter) with the frame
// rate and a graph of the last 10 s (DESIGN.md §0 performance).
//
//   const hud = new FpsHud(scene);
//   hud.setVisible(on);
//   each XR frame, after the work and before render:
//     hud.update(now, { workMs, target, viewer, apps: runtime.frameCosts() });
//
// The graph is frame time, stacked, one column per 100 ms: each app in view
// in its own color (solid: what its frame() took, logic and physics; lighter
// on top: its share of the frame time lost past the target, by its share of
// what's drawn, triangles and draw calls), apps out of view (one muted
// layer), the rest of Stratum's work, then drawing and waiting up to the time
// the frame really took. The axis is in fps: the top of the stack above the
// target line is frame rate lost. (GPU time per app isn't measurable here:
// the lighter band is an estimate.)
import * as THREE from 'three';
import { drawCost } from '../apps/perf.js';

const COLS = 100, COL_MS = 100;              // 10 s of 100 ms columns
const W = 512, H = 236;                      // canvas px
const GRAPH = { x: 10, y: 66, w: 452, h: 160 };
const SIZE = 0.13;                           // panel width (m)
const REDRAW_MS = 200;
const IN_VIEW_COS = Math.cos(THREE.MathUtils.degToRad(55));
const SCENE_EVERY_MS = 1000;                 // how often the whole scene's draw cost is counted
const weight = (c) => (c?.tris ?? 0) / 1000 + (c?.draws ?? 0);   // ~1 draw call ≈ 1k triangles
const OUT_OF_VIEW = '#5c6680', STRATUM = '#3a4152', DRAWING = 'rgba(120,130,150,0.22)';

// Where the panel sits in front of your eyes (head frame, m): a little up and left of centre (Quest: ~10° left, ~7° up), out of the hands' way.
const SPOT = {
  quest: new THREE.Vector3(-0.1, 0.065, -0.55),
  phone: new THREE.Vector3(-0.045, 0.13, -0.42),
};

const lighter = (hex) => { const c = new THREE.Color(hex); c.lerp(new THREE.Color('#ffffff'), 0.45); return `#${c.getHexString()}`; };
const hashColor = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 65% 58%)`; };

export class FpsHud {
  constructor(scene, { device = 'quest' } = {}) {
    this.scene = scene;
    this.sceneAt = 0;
    this.sceneWeight = 0;
    this.canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE * H / W), mat);
    this.mesh.renderOrder = 10_000;
    this.mesh.raycast = () => {};
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = 'fps meter';
    scene.add(this.mesh);
    this.spot = SPOT[device] ?? SPOT.quest;
    this.cols = [];          // { gap, work, apps: Map(id → ms), out } per column
    this.cur = null;         // the column being filled
    this.last = 0;
    this.drawnAt = 0;
    this.names = new Map();  // app id → { name, icon, color }
  }

  get visible() { return this.mesh.visible; }
  setVisible(on) {
    this.mesh.visible = !!on;
    if (!on) { this.cols = []; this.cur = null; this.last = 0; }
  }

  // apps: [{ id, name, icon, color, ms (this frame), tris, draws, center (Vector3 | null), radius }]
  update(now, { workMs = 0, target = 72, viewer = null, apps = [] } = {}) {
    if (!this.mesh.visible) return;
    const gap = this.last ? now - this.last : 0;
    this.last = now;
    if (viewer) this.follow(viewer);
    if (!gap || gap > 500) return;   // (the first frame, or a pause: not a slow frame)
    this.target = target;
    if (now - this.sceneAt > SCENE_EVERY_MS) { this.sceneAt = now; this.sceneWeight = weight(drawCost(this.scene)); }
    const fwd = viewer && new THREE.Vector3(0, 0, -1).applyQuaternion(viewer.quaternion);
    // Columns by the clock: a stall leaves empty columns (a gap in the graph), not a squeezed one.
    const slot = Math.floor(now / COL_MS);
    if (!this.cur || slot !== this.cur.slot) {
      if (this.cur) {
        this.cols.push(this.cur);
        for (let k = this.cur.slot + 1; k < slot && k < this.cur.slot + COLS; k++) this.cols.push({ slot: k, n: 0 });
        this.cols.splice(0, Math.max(0, this.cols.length - COLS));
      }
      this.cur = { slot, n: 0, gap: 0, work: 0, apps: new Map(), draw: new Map(), out: 0 };
    }
    const c = this.cur;
    c.n++; c.gap += gap; c.work += workMs;
    const lost = Math.max(0, gap - 1000 / target);   // frame time past the target
    const seen = [];
    let outWeight = 0;
    for (const a of apps) {
      if (!this.names.has(a.id)) this.names.set(a.id, { name: a.name, icon: a.icon, color: a.color || hashColor(a.id) });
      if (!viewer || !a.center || inView(viewer.position, fwd, a.center, a.radius ?? 0)) { seen.push(a); c.apps.set(a.id, (c.apps.get(a.id) ?? 0) + a.ms); }
      else { c.out += a.ms; outWeight += weight(a); }   // (out of view: mostly culled, not drawn)
    }
    const drawn = this.sceneWeight - outWeight;
    if (lost > 0 && drawn > 0) for (const a of seen) c.draw.set(a.id, (c.draw.get(a.id) ?? 0) + lost * Math.min(1, weight(a) / drawn));
    if (now - this.drawnAt > REDRAW_MS) { this.drawnAt = now; this.draw(); }
  }

  follow(v) {
    this.mesh.position.copy(this.spot).applyQuaternion(v.quaternion).add(v.position);
    this.mesh.quaternion.copy(v.quaternion);
  }

  // Columns as averages per frame (ms).
  series() {
    const all = this.cur?.n ? [...this.cols, this.cur] : this.cols;
    const per = (m, n) => new Map([...m].map(([k, v]) => [k, v / n]));
    return all.map((c) => c.n ? { gap: c.gap / c.n, work: c.work / c.n, out: c.out / c.n, apps: per(c.apps, c.n), draw: per(c.draw, c.n) } : null);
  }

  draw() {
    const g = this.g, s = this.series(), target = this.target ?? 72, budget = 1000 / target;
    const top = budget * 2;   // the graph's top: half the frame rate
    g.clearRect(0, 0, W, H);
    round(g, 0, 0, W, H, 18); g.fillStyle = 'rgba(14,16,22,0.78)'; g.fill();
    // Headline: fps now (the last second), the target, the costliest app in view.
    const recent = s.slice(-10).filter(Boolean), gapNow = recent.length ? recent.reduce((t, c) => t + c.gap, 0) / recent.length : budget;
    const fps = 1000 / gapNow, ok = fps >= target * 0.9;
    g.textBaseline = 'alphabetic';
    g.font = '700 46px system-ui, sans-serif'; g.fillStyle = ok ? '#8ce99a' : fps >= target * 0.7 ? '#ffd43b' : '#ff6b6b';
    g.fillText(String(Math.round(fps)), 16, 50);
    const fw = g.measureText(String(Math.round(fps))).width;
    g.font = '500 22px system-ui, sans-serif'; g.fillStyle = '#adb5bd';
    g.fillText(`fps / ${Math.round(target)}  ·  ${gapNow.toFixed(1)} ms`, 24 + fw, 48);
    // Legend: the apps in view, costliest first (last second).
    const tot = new Map();
    for (const c of recent) for (const m of [c.apps, c.draw]) for (const [k, v] of m) tot.set(k, (tot.get(k) ?? 0) + v / recent.length);
    const legend = [...tot].sort((a, b) => b[1] - a[1]).slice(0, 2);
    let lx = W - 14;
    g.textAlign = 'right'; g.font = '500 19px system-ui, sans-serif';
    for (const [id, ms] of legend.reverse()) {
      const n = this.names.get(id), label = `${n?.icon ?? ''} ${ms.toFixed(1)} ms`;
      g.fillStyle = '#dee2e6'; g.fillText(label, lx, 46);
      lx -= g.measureText(label).width + 8;
      g.fillStyle = n?.color ?? '#888'; g.fillRect(lx - 12, 32, 12, 12);
      lx -= 22;
    }
    g.textAlign = 'left';
    // Graph: stacked columns, newest at the right.
    const { x, y, w, h } = GRAPH, cw = w / COLS, Y = (ms) => y + h - Math.min(1, ms / top) * h;
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(x, y, w, h);
    const order = [...this.names.keys()];
    s.forEach((c, i) => {
      if (!c) return;   // (no frames then)
      const cx = x + w - (s.length - i) * cw;
      let base = 0;
      const layer = (ms, color) => { if (ms <= 0) return; g.fillStyle = color; g.fillRect(cx, Y(base + ms), cw + 0.5, Y(base) - Y(base + ms)); base += ms; };
      let drawMs = 0;
      for (const id of order) {
        const n = this.names.get(id), d = c.draw.get(id) ?? 0;
        layer(c.apps.get(id) ?? 0, n.color);
        layer(d, n.light ??= lighter(n.color));
        drawMs += d;
      }
      layer(c.out, OUT_OF_VIEW);
      const cpuMs = base - drawMs;
      layer(Math.max(0, c.work - cpuMs), STRATUM);
      layer(Math.max(0, c.gap - base - Math.max(0, c.work - cpuMs)), DRAWING);
      // The frame's top edge: red where it took longer than the target.
      g.fillStyle = c.gap > budget * 1.1 ? '#ff6b6b' : '#e9ecef';
      g.fillRect(cx, Y(c.gap) - 1, cw + 0.5, 2);
    });
    // Axis: the target frame rate, two thirds of it, half of it.
    g.font = '500 16px system-ui, sans-serif';
    for (const [k, dash] of [[1, true], [1.5, true]]) {
      const yy = Y(budget * k);
      g.strokeStyle = k === 1 ? 'rgba(140,233,154,0.7)' : 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5;
      g.setLineDash(dash ? [6, 5] : []); g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke();
      g.fillStyle = '#adb5bd'; g.fillText(String(Math.round(target / k)), x + w + 6, yy + 5);
    }
    g.setLineDash([]);
    g.fillStyle = '#adb5bd'; g.fillText(String(Math.round(target / 2)), x + w + 6, y + 12);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose();
  }
}

function inView(eye, fwd, center, radius) {
  const d = new THREE.Vector3().subVectors(center, eye), len = d.length();
  if (len <= radius) return true;   // (you're in it)
  // In front within ~55° of where you look, allowing for its size.
  const ang = Math.acos(THREE.MathUtils.clamp(d.dot(fwd) / len, -1, 1)) - Math.asin(Math.min(1, radius / len));
  return Math.cos(Math.max(0, ang)) >= IN_VIEW_COS;
}

function round(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
