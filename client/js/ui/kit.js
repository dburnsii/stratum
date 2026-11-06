// UI kit for in-world panels (DESIGN.md §8.3). No image assets: every
// widget is a plane with a canvas-drawn face (crisp text, real gradients,
// anti-aliased corners) plus a hover/press overlay, so widgets can float,
// lift toward a finger and animate independently.
//
//   const layer = new WidgetLayer(parentGroup, { order: 1002 });
//   layer.render([{ key, kind, x, y, w, h, z, props, run }])   // keyed: reuses, updates, animates, removes
//   layer.update(dt) every frame; layer.pick(x, y) → widget (panel-local meters)
//
// Kinds (see DRAW): glass, row, tile, chip, icon, primary, header, section,
// dots, text, card, value. Units: meters (MM = 0.001). Canvas: PPM px/m.
import * as THREE from 'three';

export const MM = 0.001;
export const PPM = 4200;                       // canvas pixels per meter (4.2 px/mm)
export const ACCENT = '#5b8cff';
export const FONT = '-apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const px = (m) => Math.max(2, Math.round(m * PPM));

// ---- motion -----------------------------------------------------------------------------

// Exponential approach: frame-rate independent, interruptible, no overshoot.
export function approach(cur, target, dt, tau) {
  return target + (cur - target) * Math.exp(-dt / Math.max(1e-4, tau));
}
export const easeOut = (t) => 1 - (1 - t) ** 3;

// ---- icons (own line set on a 24-unit grid, stroked) -----------------------------------------

export const ICONS = {
  home: 'M4 11 12 4l8 7M6 10v10h12V10',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  layers: 'M12 3 3 8l9 5 9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5',
  space: 'M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7zM3.5 7l8.5 4.5L20.5 7M12 11.5v10',
  gear: null,   // drawn in code
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  close: 'M6 6l12 12M18 6 6 18',
  expand: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7',
  palm: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  eye: 'M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12zM12 9.2a2.8 2.8 0 1 0 0.01 0',
  eyeOff: 'M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12zM3 3l18 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  rotate: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.2h-4.2',
  trash: 'M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13',
  people: 'M9 11a3 3 0 1 0 0.01 0M3 20c0-3.2 2.7-5 6-5s6 1.8 6 5M17 10.5a2.5 2.5 0 1 0 0.01 0M16.5 14.6c2.7.2 4.5 1.9 4.5 4.4',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  carry: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  moveHere: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  map: 'M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3zM9 3.5v14M15 6.5v14',
  mail: 'M3.5 6h17v12h-17zM3.5 7l8.5 6 8.5-6',
  power: 'M12 3v8M7 6.2a7.5 7.5 0 1 0 10 0',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6.5 7S5 18.5 4.5 15l-1-3.5a1.4 1.4 0 0 1 2.5-1.2L8 13',
  half: 'M12 3a9 9 0 1 0 0.01 0zM12 3v18',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  sun: 'M12 8a4 4 0 1 0 0.01 0M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  join: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H8',
  place: 'M12 3v12M8 11l4 4 4-4M5 21h14',
  info: 'M12 3a9 9 0 1 0 0.01 0zM12 11v6M12 7.5v.5',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0.01 0M15.3 15.3 20 20',
  shift: 'M12 4 4 12.5h4.5V20h7v-7.5H20z',
  backspace: 'M9 5h11v14H9l-6-7zM12 9.5l5 5M17 9.5l-5 5',
  enter: 'M19 5v6.5a2 2 0 0 1-2 2H6M10 9.5l-4 4 4 4',
  keyboard: 'M3 6.5h18v11H3zM6.5 9.5h1M10 9.5h1M13.5 9.5h1M17 9.5h.5M6.5 12.5h1M10 12.5h1M13.5 12.5h1M17 12.5h.5M8 15h8',
};

export function drawIcon(g, name, x, y, size, color, width = 2) {
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (name === 'gear') {
    g.beginPath(); g.arc(12, 12, 3.2, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(12, 12, 7, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath(); g.moveTo(12 + Math.cos(a) * 7, 12 + Math.sin(a) * 7); g.lineTo(12 + Math.cos(a) * 9.6, 12 + Math.sin(a) * 9.6); g.stroke();
    }
  } else if (ICONS[name]) {
    g.stroke(new Path2D(ICONS[name]));
  }
  g.restore();
}

// ---- drawing helpers -----------------------------------------------------------------------

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)); }

function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function text(g, str, x, y, { size, weight = 500, color = '#eef1f6', align = 'left', maxW = 1e9, base = 'middle' }) {
  g.font = `${weight} ${size}px ${FONT}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillText(fitText(g, String(str ?? ''), maxW), x, y);
}

function wrapText(g, str, maxW) {
  const out = [];
  let line = '';
  for (const word of String(str).split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function switchShape(g, x, y, w, h, k) {   // k: 0 off … 1 on (animated)
  const on = new THREE.Color('#3a3f4c').lerp(new THREE.Color(ACCENT), k);
  g.fillStyle = `#${on.getHexString()}`;
  rr(g, x, y, w, h, h / 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(x + h / 2 + (w - h) * k, y + h / 2, h / 2 - h * 0.11, 0, Math.PI * 2); g.fill();
}

const DIM = '#9aa3b5', FAINT = '#6b7385';

// Face painters: (g, W, H, props, state) with W/H in canvas px; state.k = animated value (toggles).
const DRAW = {
  // The panel: graphite glass with a soft rim light along the top edge.
  glass(g, W, H, p) {
    const r = px(p.radius ?? 24 * MM);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(44,48,60,0.88)');
    grad.addColorStop(1, 'rgba(20,22,29,0.92)');
    g.fillStyle = grad; rr(g, 1, 1, W - 2, H - 2, r); g.fill();
    const rim = g.createLinearGradient(0, 0, 0, H * 0.5);
    rim.addColorStop(0, 'rgba(255,255,255,0.22)'); rim.addColorStop(1, 'rgba(255,255,255,0.02)');
    g.strokeStyle = rim; g.lineWidth = Math.max(2, W / 400); rr(g, 2, 2, W - 4, H - 4, r - 1); g.stroke();
  },
  // A full-width list row: icon, label (+ sub), accessory (switch / chevron / value).
  row(g, W, H, p, s) {
    rr(g, 0, 0, W, H, H * 0.32);
    g.fillStyle = p.active ? 'rgba(91,140,255,0.22)' : 'rgba(255,255,255,0.055)'; g.fill();
    const pad = H * 0.32;
    let x = pad;
    if (p.emoji) { text(g, p.emoji, x + H * 0.27, H / 2, { size: H * 0.46, align: 'center' }); x += H * 0.62; }
    else if (p.icon) { drawIcon(g, p.icon, x, H / 2 - H * 0.22, H * 0.44, p.danger ? '#ff8a80' : '#dfe5f1', 2.1); x += H * 0.62; }
    const right = p.toggle !== undefined ? H * 1.25 : p.value != null ? Math.min(W * 0.36, H * 2.6) : p.chevron ? H * 0.5 : p.reserve ? H * 0.9 : 0;
    const maxW = W - x - pad - right;
    if (p.sub) {
      text(g, p.label, x, H * 0.37, { size: H * 0.27, weight: 560, maxW, color: p.danger ? '#ff8a80' : '#eef1f6' });
      text(g, p.sub, x, H * 0.68, { size: H * 0.2, color: DIM, maxW });
    } else {
      text(g, p.label, x, H / 2, { size: H * 0.29, weight: 540, maxW, color: p.danger ? '#ff8a80' : p.disabled ? FAINT : '#eef1f6' });
    }
    if (p.toggle !== undefined) switchShape(g, W - pad - H * 0.9, H * 0.3, H * 0.9, H * 0.4, s.k ?? (p.toggle ? 1 : 0));
    else if (p.value != null) text(g, p.value, W - pad, H / 2, { size: H * 0.25, color: DIM, align: 'right', maxW: right });
    else if (p.chevron) drawIcon(g, 'next', W - pad - H * 0.3, H / 2 - H * 0.15, H * 0.3, FAINT, 2.4);
  },
  // App / catalog tile: emoji in a colored squircle + name (+ badge dot).
  tile(g, W, H, p) {
    const sq = Math.min(W * 0.62, H * 0.6);
    const x = (W - sq) / 2, y = H * 0.06;
    const c = new THREE.Color(p.color ?? '#4c5566');
    const top = c.clone().offsetHSL(0, 0, 0.08), bot = c.clone().offsetHSL(0, 0, -0.08);
    const grad = g.createLinearGradient(0, y, 0, y + sq);
    grad.addColorStop(0, `#${top.getHexString()}`); grad.addColorStop(1, `#${bot.getHexString()}`);
    g.fillStyle = grad; rr(g, x, y, sq, sq, sq * 0.28); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; rr(g, x + 1, y + 1, sq - 2, sq - 2, sq * 0.28); g.stroke();
    if (p.emoji) text(g, p.emoji, W / 2, y + sq / 2 + sq * 0.03, { size: sq * 0.52, align: 'center' });
    else if (p.icon) drawIcon(g, p.icon, x + sq * 0.25, y + sq * 0.25, sq * 0.5, '#fff', 2.2);
    text(g, p.label, W / 2, y + sq + H * 0.15, { size: H * 0.13, weight: 540, align: 'center', maxW: W - 4, color: p.dim ? DIM : '#eef1f6' });
    if (p.badge) { g.fillStyle = p.badge === 'running' ? '#51cf66' : ACCENT; g.beginPath(); g.arc(x + sq - sq * 0.06, y + sq * 0.06, sq * 0.1, 0, Math.PI * 2); g.fill(); }
    if (p.on) { g.strokeStyle = ACCENT; g.lineWidth = Math.max(3, W / 60); rr(g, x - 3, y - 3, sq + 6, sq + 6, sq * 0.3); g.stroke(); }
  },
  // Pill chip (filters, choices).
  chip(g, W, H, p) {
    rr(g, 0, 0, W, H, H / 2);
    g.fillStyle = p.on ? ACCENT : 'rgba(255,255,255,0.08)'; g.fill();
    text(g, p.label, W / 2, H / 2, { size: H * 0.42, weight: p.on ? 600 : 520, align: 'center', color: p.on ? '#fff' : '#d6dbe6', maxW: W - H * 0.6 });
  },
  // Round icon button (tools, header actions).
  icon(g, W, H, p) {
    const r = Math.min(W, H) / 2;
    g.beginPath(); g.arc(W / 2, H / 2, r - 1, 0, Math.PI * 2);
    g.fillStyle = p.on ? ACCENT : p.danger ? 'rgba(255,107,107,0.18)' : p.ghost ? 'rgba(255,255,255,0.0)' : 'rgba(255,255,255,0.09)'; g.fill();
    drawIcon(g, p.icon, W / 2 - r * 0.5, H / 2 - r * 0.5, r, p.danger ? '#ff8a80' : p.disabled ? FAINT : '#eef1f6', 2.2);
  },
  // A big app button (app panels): emoji / icon over its label, or the label alone.
  // tone: 'primary' (accent), 'danger', 'go' (green), plain; on: chosen (choices).
  pad(g, W, H, p) {
    const r = Math.min(H, W) * 0.26;
    rr(g, 0, 0, W, H, r);
    const tones = { primary: ['#6c98ff', '#4a78f0'], danger: ['#f0645c', '#d64541'], go: ['#4fc36a', '#2f9e44'] };
    const t = tones[p.tone];
    if (t) { const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, t[0]); grad.addColorStop(1, t[1]); g.fillStyle = grad; }
    else g.fillStyle = p.on ? 'rgba(91,140,255,0.3)' : p.disabled ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.085)';
    g.fill();
    if (p.on) { g.strokeStyle = ACCENT; g.lineWidth = Math.max(3, H * 0.035); rr(g, 2, 2, W - 4, H - 4, r); g.stroke(); }
    const color = p.disabled ? FAINT : '#fff';
    const glyph = p.emoji || p.icon;
    if (glyph && p.label) {
      if (p.emoji) text(g, p.emoji, W / 2, H * 0.38, { size: H * 0.34, align: 'center' });
      else drawIcon(g, p.icon, W / 2 - H * 0.16, H * 0.22, H * 0.32, color, 2.4);
      text(g, p.label, W / 2, H * 0.76, { size: H * 0.19, weight: 600, align: 'center', color, maxW: W - H * 0.2 });
    } else if (glyph) {
      if (p.emoji) text(g, p.emoji, W / 2, H / 2, { size: H * 0.46, align: 'center' });
      else drawIcon(g, p.icon, W / 2 - H * 0.22, H * 0.28, H * 0.44, color, 2.6);
    } else text(g, p.label, W / 2, H / 2, { size: H * 0.27, weight: 620, align: 'center', color, maxW: W - H * 0.3 });
  },
  // Filled accent pill button.
  primary(g, W, H, p) {
    rr(g, 0, 0, W, H, H / 2);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#6c98ff'); grad.addColorStop(1, '#4a78f0');
    g.fillStyle = p.danger ? '#e5534b' : grad; g.fill();
    let x = W / 2;
    if (p.icon) { drawIcon(g, p.icon, W / 2 - H * 0.2 - g.measureText(p.label).width / 2 - H * 0.35, H * 0.3, H * 0.4, '#fff', 2.4); x += H * 0.25; }
    text(g, p.label, x, H / 2, { size: H * 0.36, weight: 620, align: 'center', color: '#fff', maxW: W - H });
  },
  // Page header: title (+ subtitle); the empty part is the grab bar.
  header(g, W, H, p) {
    g.fillStyle = 'rgba(255,255,255,0.22)'; rr(g, W / 2 - H * 0.35, H * 0.08, H * 0.7, H * 0.06, H * 0.03); g.fill();   // grab handle
    const x = p.back ? H * 0.9 : H * 0.12;
    if (p.emoji) text(g, p.emoji, x + H * 0.26, H * 0.58, { size: H * 0.42, align: 'center' });
    const tx = x + (p.emoji ? H * 0.62 : 0);
    const maxW = W - tx - (p.reserve ?? 0);
    if (p.sub) {
      text(g, p.title, tx, H * 0.5, { size: H * 0.33, weight: 700, maxW });
      text(g, p.sub, tx, H * 0.82, { size: H * 0.2, color: DIM, maxW });
    } else {
      text(g, p.title, tx, H * 0.6, { size: H * 0.36, weight: 700, maxW });
    }
  },
  section(g, W, H, p) {
    text(g, p.label.toUpperCase(), 2, H * 0.6, { size: H * 0.5, weight: 650, color: '#7d8597', maxW: W - (p.right ? W * 0.4 : 0) });
    if (p.right) text(g, p.right, W - 2, H * 0.6, { size: H * 0.5, color: '#7d8597', align: 'right' });
  },
  dots(g, W, H, p) {
    const n = p.count, gap = H * 1.2, r = H * 0.28;
    const x0 = W / 2 - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i === p.index ? '#eef1f6' : 'rgba(255,255,255,0.25)';
      g.beginPath(); g.arc(x0 + i * gap, H / 2, i === p.index ? r * 1.2 : r, 0, Math.PI * 2); g.fill();
    }
  },
  text(g, W, H, p) {
    const lines = String(p.label).split('\n');
    lines.forEach((l, i) => text(g, l, p.align === 'center' ? W / 2 : 2, (i + 0.5) * (H / lines.length), { size: (H / lines.length) * 0.72, color: p.color ?? DIM, align: p.align ?? 'left', maxW: W - 4 }));
  },
  // A grouped card (selection, status): emoji/icon, title, sub.
  card(g, W, H, p) {
    rr(g, 0, 0, W, H, px(10 * MM));
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(91,140,255,0.16)'); grad.addColorStop(1, 'rgba(255,255,255,0.05)');
    g.fillStyle = p.plain ? 'rgba(255,255,255,0.055)' : grad; g.fill();
    const s = px(8 * MM);
    let x = s * 0.9;
    if (p.emoji) { text(g, p.emoji, x + s * 0.55, px(11 * MM), { size: s * 1.05, align: 'center' }); x += s * 1.4; }
    text(g, p.title, x, px(8.5 * MM), { size: px(5.6 * MM), weight: 640, maxW: W - x - s });
    if (p.sub) text(g, p.sub, x, px(15 * MM), { size: px(4.2 * MM), color: DIM, maxW: W - x - s });
  },
  // Place-chooser card: a lit "stage" on top (the 3D preview floats over it),
  // then the name and a short description.
  variant(g, W, H, p) {
    const r = px(9 * MM);
    rr(g, 0, 0, W, H, r);
    g.fillStyle = p.on ? 'rgba(91,140,255,0.22)' : 'rgba(255,255,255,0.06)'; g.fill();
    const stageH = H * 0.56;
    const glow = g.createRadialGradient(W / 2, stageH * 0.62, 0, W / 2, stageH * 0.62, W * 0.55);
    glow.addColorStop(0, 'rgba(255,255,255,0.16)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); rr(g, 0, 0, W, stageH, r); g.clip(); g.fillStyle = glow; g.fillRect(0, 0, W, stageH); g.restore();
    if (p.emoji && !p.hasPreview) text(g, p.emoji, W / 2, stageH * 0.55, { size: stageH * 0.42, align: 'center' });
    const pad = W * 0.08;
    text(g, p.label, pad, stageH + H * 0.09, { size: H * 0.085, weight: 650, maxW: W - 2 * pad });
    const size = H * 0.06;
    g.font = `400 ${size}px ${FONT}`;
    const lines = wrapText(g, p.description ?? '', W - 2 * pad).slice(0, 3);
    lines.forEach((l, i) => text(g, l, pad, stageH + H * 0.19 + i * size * 1.3, { size, color: DIM, maxW: W - 2 * pad }));
  },
  // Keyboard key: a soft keycap. tone: 'char' | 'mod' (shift, 123, ⌫) | 'go' (accent) | 'on' (shift held).
  key(g, W, H, p) {
    const r = Math.min(W, H) * 0.22;
    const grad = g.createLinearGradient(0, 0, 0, H);
    if (p.tone === 'go') { grad.addColorStop(0, '#6c98ff'); grad.addColorStop(1, '#4a78f0'); }
    else if (p.tone === 'on') { grad.addColorStop(0, '#f2f4f8'); grad.addColorStop(1, '#d9dde6'); }
    else if (p.tone === 'mod') { grad.addColorStop(0, 'rgba(255,255,255,0.10)'); grad.addColorStop(1, 'rgba(255,255,255,0.06)'); }
    else { grad.addColorStop(0, 'rgba(255,255,255,0.20)'); grad.addColorStop(1, 'rgba(255,255,255,0.13)'); }
    g.fillStyle = grad; rr(g, 1, 1, W - 2, H - 2, r); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; rr(g, 2, 2, W - 4, H - 4, r - 1); g.stroke();
    const color = p.tone === 'on' ? '#15171d' : '#f4f6fa';
    if (p.icon) {
      const s = H * 0.42;
      drawIcon(g, p.icon, W / 2 - s / 2, H / 2 - s / 2, s, color, 2.3);
      if (p.lock) { g.fillStyle = color; g.fillRect(W / 2 - s * 0.3, H / 2 + s * 0.62, s * 0.6, H * 0.035); }
    } else {
      const big = String(p.label).length === 1;
      text(g, p.label, W / 2, H * 0.53, { size: H * (big ? 0.46 : 0.3), weight: big ? 450 : 600, align: 'center', color, maxW: W - H * 0.2 });
    }
  },
  // Text field: small label, the text (its tail when long) and a caret.
  field(g, W, H, p) {
    rr(g, 0, 0, W, H, H * 0.3);
    g.fillStyle = 'rgba(0,0,0,0.32)'; g.fill();
    g.strokeStyle = 'rgba(91,140,255,0.55)'; g.lineWidth = 3; rr(g, 1.5, 1.5, W - 3, H - 3, H * 0.3 - 1); g.stroke();
    const pad = H * 0.32;
    text(g, p.label, pad, H * 0.28, { size: H * 0.19, weight: 600, color: DIM, maxW: W - 2 * pad });
    const size = H * 0.34, y = H * 0.66, maxW = W - 2 * pad - size * 0.3;
    g.font = `450 ${size}px ${FONT}`;
    let t = p.secret ? '•'.repeat(p.value.length) : String(p.value ?? '');
    let shown = t;
    if (g.measureText(shown).width > maxW) { while (shown.length > 1 && g.measureText(`…${shown}`).width > maxW) shown = shown.slice(1); shown = `…${shown}`; }
    if (!t && p.placeholder) text(g, p.placeholder, pad, y, { size, weight: 400, color: FAINT, maxW });
    else text(g, shown, pad, y, { size, weight: 450, maxW: maxW + 4 });
    if (p.caret) {
      const x = pad + (t ? g.measureText(shown).width : 0) + size * 0.06;
      g.fillStyle = ACCENT; g.fillRect(x, y - size * 0.55, Math.max(2, size * 0.07), size * 1.1);
    }
  },
  // Stepper value display (− value + handled as separate icon widgets).
  value(g, W, H, p) {
    rr(g, 0, 0, W, H, H / 2); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill();
    text(g, p.label, W / 2, H / 2, { size: H * 0.4, weight: 600, align: 'center', maxW: W - 8 });
  },
};

// Shared rounded geometry for overlays.
const geoCache = new Map();
function roundedGeo(w, h, r) {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${r.toFixed(4)}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ShapeGeometry(s, 6);
  geoCache.set(key, geo);
  return geo;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);

// ---- widgets -------------------------------------------------------------------------------

export class Widget {
  constructor(spec, order) {
    this.key = spec.key;
    this.kind = spec.kind;
    this.canvas = document.createElement('canvas');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.face = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.face.renderOrder = order;
    this.overlay = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.overlay.renderOrder = order + 1;
    this.group = new THREE.Group();
    this.group.add(this.face, this.overlay);
    this.x = spec.x; this.y = spec.y; this.z = spec.z ?? 0;
    this.lift = 0; this.hover = 0; this.flash = 0;
    this.alpha = 0; this.alphaTarget = 1;          // fade in on creation
    this.state = { k: spec.props?.toggle ? 1 : 0 };
    this.set(spec, true);
    this.group.position.set(this.x, this.y, this.z);
  }

  set(spec, first = false) {
    this.run = spec.run ?? null;
    this.tx = spec.x; this.ty = spec.y; this.tz = spec.z ?? 0;
    this.hoverLift = spec.lift ?? (spec.run ? 3 * MM : 0);
    const sizeChanged = spec.w !== this.w || spec.h !== this.h;
    const propsKey = JSON.stringify(spec.props ?? {});
    if (!first && !sizeChanged && propsKey === this.propsKey && spec.kind === this.kind) return;
    this.kind = spec.kind;
    this.w = spec.w; this.h = spec.h;
    this.props = spec.props ?? {};
    this.propsKey = propsKey;
    if (sizeChanged || first) {
      const W = px(this.w), H = px(this.h);
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W; this.canvas.height = H;
        this.tex.dispose();   // GPU storage is sized once: a new size needs a new texture
        this.tex = new THREE.CanvasTexture(this.canvas);
        this.tex.colorSpace = THREE.SRGBColorSpace;
        this.tex.anisotropy = 4;
        this.face.material.map = this.tex;
        this.face.material.needsUpdate = true;
      }
      this.face.scale.set(this.w, this.h, 1);
      const r = this.kind === 'key' ? Math.min(this.w, this.h) * 0.22 : this.kind === 'variant' ? 9 * MM : this.kind === 'chip' || this.kind === 'primary' || this.kind === 'value' ? this.h / 2
        : this.kind === 'icon' ? Math.min(this.w, this.h) / 2 : this.kind === 'row' ? this.h * 0.32 : this.kind === 'tile' ? 10 * MM : 8 * MM;
      this.overlay.geometry = roundedGeo(this.w, this.h, r);
    }
    this.redraw();
  }

  redraw() {
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    DRAW[this.kind]?.(g, this.canvas.width, this.canvas.height, this.props, this.state);
    this.tex.needsUpdate = true;
  }

  // Per frame: glide to layout position, lift toward a hovering finger, fade, flash, animate toggles.
  update(dt, alphaScale) {
    this.x = approach(this.x, this.tx, dt, 0.05);
    this.y = approach(this.y, this.ty, dt, 0.05);
    this.lift = approach(this.lift, this.hover > 0 ? this.hoverLift * (this.pressed ? 0.2 : 1) : 0, dt, 0.03);
    this.z = approach(this.z, this.tz, dt, 0.05);
    this.group.position.set(this.x, this.y, this.z + this.lift);
    this.alpha = approach(this.alpha, this.alphaTarget, dt, 0.05);
    this.flash = approach(this.flash, 0, dt, 0.09);
    this.face.material.opacity = this.alpha * alphaScale;
    this.overlay.material.color.set(this.flash > 0.02 ? ACCENT : '#ffffff');
    this.overlay.material.opacity = Math.max(this.hover * 0.11, this.flash * 0.45) * this.alpha * alphaScale;
    if (this.props.toggle !== undefined) {
      const k = approach(this.state.k, this.props.toggle ? 1 : 0, dt, 0.04);
      if (Math.abs(k - this.state.k) > 0.002) { this.state.k = k; this.redraw(); }
    }
  }

  contains(x, y) { return Math.abs(x - this.tx) <= this.w / 2 && Math.abs(y - this.ty) <= this.h / 2; }

  dispose() {
    this.group.removeFromParent();
    this.tex.dispose();
    this.face.material.dispose();
    this.overlay.material.dispose();
  }
}

// A keyed set of widgets inside one group (a page, the tab bar).
export class WidgetLayer {
  constructor(parent, { order = 1002 } = {}) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.order = order;
    this.widgets = new Map();
    this.leaving = [];
    this.alpha = 1;
  }

  render(specs) {
    const seen = new Set();
    specs.forEach((spec, i) => {
      seen.add(spec.key);
      let w = this.widgets.get(spec.key);
      if (!w) {
        w = new Widget(spec, this.order + (spec.kind === 'glass' ? -2 : 0));
        w.alpha = 0;
        w.delay = i * 0.012;   // a slight stagger when a page appears
        this.widgets.set(spec.key, w);
        this.group.add(w.group);
      } else {
        w.set(spec);
      }
    });
    for (const [k, w] of this.widgets) {
      if (seen.has(k)) continue;
      this.widgets.delete(k);
      w.alphaTarget = 0;
      w.run = null;
      this.leaving.push(w);
    }
  }

  update(dt) {
    for (const w of this.widgets.values()) {
      if (w.delay > 0) { w.delay -= dt; continue; }
      w.update(dt, this.alpha);
    }
    this.leaving = this.leaving.filter((w) => {
      w.update(dt, this.alpha);
      if (w.alpha > 0.02) return true;
      w.dispose();
      return false;
    });
  }

  // Topmost interactive widget at a layer-local point.
  pick(x, y) {
    let best = null;
    for (const w of this.widgets.values()) if (w.run && w.contains(x, y) && (!best || w.tz >= best.tz)) best = w;
    return best;
  }

  setHover(target) {
    for (const w of this.widgets.values()) w.hover = w === target ? 1 : 0;
  }

  find(labelStart) {
    for (const w of this.widgets.values()) {
      const p = w.props ?? {};
      const label = p.label ?? p.title ?? '';
      if (w.run && (label.startsWith(labelStart) || w.key === labelStart || p.id === labelStart)) return w;
    }
    return null;
  }

  dispose() {
    for (const w of [...this.widgets.values(), ...this.leaving]) w.dispose();
    this.widgets.clear();
    this.group.removeFromParent();
  }
}
