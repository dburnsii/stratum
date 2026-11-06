// Wall & Desk (Stratum app; id 'notes'): sticky notes, index cards and labels,
// plus clocks, calendars, a thermometer and a weather forecast (widgets.js),
// on any surface. Everything lives in the instance config ({ kind, color,
// text, done } for paper), so it's saved with the object and shared with
// everyone who can see it.
//
// Instance frame: the note's face is the XY plane, +Z out of the surface
// it's stuck to (the platform's 'surface' mount lays it on walls or flat on
// tables). Tap it to write; grab the push pin (its handle) to move it; the
// menu lists the notes here.
import { ZONES, LABELS, buildWidget, findPlace, isWidget, previewWidget, zoneName } from './widgets.js';

let THREE;

const KINDS = {
  sticky: { w: 0.076, h: 0.076, pad: 0.07, lines: 7 },
  card: { w: 0.127, h: 0.076, pad: 0.06, lines: 6, ruled: true },
  label: { w: 0.1, h: 0.03, pad: 0.08, lines: 1 },
};
const COLORS = { yellow: '#ffe56b', pink: '#ff9fc6', blue: '#93d4ff', green: '#a8eea0', orange: '#ffbd76', white: '#f7f5ef' };
const COLOR_ORDER = Object.keys(COLORS);
const HAND = '"Segoe Print", "Bradley Hand", "Noteworthy", "Comic Neue", "Dancing Script", cursive';
const PRINT = '-apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const PX_PER_M = 6000;
const notes = new Set();      // running notes (for the menu list)

export default {
  preview(T, variant) {
    THREE = T;
    if (isWidget(variant)) return previewWidget(T, variant);
    const kind = KINDS[variant] ? variant : 'sticky';
    const cfg = { kind, color: kind === 'sticky' ? 'yellow' : 'white',
      text: { sticky: 'Water the plants', card: 'Pancakes\n2 eggs · 1 cup milk\n1 cup flour', label: 'Spices' }[kind] };
    return buildNote(cfg, 7, true).group;
  },

  async start(ctx) {
    THREE = ctx.THREE;
    if (isWidget(ctx.instance.config?.kind)) return startWidget(ctx);
    const cfg = { kind: 'sticky', color: 'yellow', text: '', done: false, ...(ctx.instance.config ?? {}) };
    const seed = [...ctx.instance.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    ctx.note = { cfg, seed, ...buildNote(cfg, seed, ctx.settings?.get('hand') !== false) };
    ctx.spawn(ctx.note.group);
    ctx.settings?.onChange((k) => { if (k === 'hand') redraw(ctx); });
    setActions(ctx);
    notes.add(ctx);
    publishMenu();
    window.__notes = notes;   // test hook
    if (ctx.instance.fresh && !cfg.text) edit(ctx);   // you just stuck it here: write on it
  },

  frame(ctx) {
    const w = ctx.widget;
    if (!w) return;
    const now = ctx.now();
    w.update(now);
    if (now - (ctx.widgetStatusAt ?? 0) > 1000) { ctx.widgetStatusAt = now; ctx.status(w.status?.(now) ?? ''); }
  },

  select(ctx, hit) {
    if (ctx.widget) { if (hit.object === ctx.widget.face) ctx.widget.tap?.(hit, widgetApi(ctx)); return; }
    edit(ctx);
  },

  stop(ctx) {
    notes.delete(ctx);
    if (ctx.widget) { ctx.widget.dispose(); publishMenu(); return; }
    ctx.note?.group.traverse((n) => { n.geometry?.dispose(); n.material?.map?.dispose(); n.material?.dispose(); });
    publishMenu();
  },
};

// ---- actions ------------------------------------------------------------------------------

function setActions(ctx) {
  const c = ctx.note.cfg;
  ctx.actions([
    { label: '✏️ Write', run: () => edit(ctx) },
    { label: '🎨 Color', run: () => save(ctx, { color: COLOR_ORDER[(COLOR_ORDER.indexOf(c.color) + 1) % COLOR_ORDER.length] }) },
    ...(c.kind !== 'label' ? [{ label: c.done ? '↺ Not done' : '✓ Done', run: () => save(ctx, { done: !c.done }) }] : []),
  ]);
  ctx.status(c.text ? `${c.done ? '✓ ' : ''}${oneLine(c.text, 28)}` : 'Empty note');
}

async function edit(ctx) {
  const c = ctx.note.cfg;
  const label = c.kind === 'label' ? 'Label' : c.kind === 'card' ? 'Index card' : 'Note';
  const text = await ctx.prompt(label, c.text ?? '', { capitalize: true });
  if (text != null && text !== c.text) save(ctx, { text: text.slice(0, 400) });
}

function save(ctx, patch) {
  Object.assign(ctx.note.cfg, patch);
  ctx.setConfig({ ...ctx.instance.config, ...ctx.note.cfg });   // saved + shared (others' copies restart with it)
  redraw(ctx);
  setActions(ctx);
  publishMenu();
}

function redraw(ctx) {
  const n = ctx.note;
  drawFace(n.canvas, n.cfg, ctx.settings?.get('hand') !== false);
  n.tex.needsUpdate = true;
}

const oneLine = (t, n) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// The menu page: every note here, tap one to write on it.
function publishMenu() {
  const all = [...notes];
  const section = {
    title: 'Here',
    empty: 'Place a note, a clock, a calendar or the weather',
    items: all.map((ctx, i) => {
      if (ctx.widget) {
        const [emoji, name] = LABELS[ctx.widgetCfg.kind];
        return { id: ctx.instance.id, emoji, label: ctx.widget.status?.(ctx.now()) || name, sub: name, run: () => ctx.widget.tap?.({ uv: null }, widgetApi(ctx)) };
      }
      const c = ctx.note.cfg;
      return { id: ctx.instance.id, emoji: c.done ? '✅' : { sticky: '🟨', card: '🗒', label: '🏷' }[c.kind] ?? '📝',
        label: c.text ? oneLine(c.text, 40) : `Empty ${c.kind === 'card' ? 'card' : c.kind === 'label' ? 'label' : 'note'} ${i + 1}`,
        sub: [c.kind === 'card' ? 'Index card' : c.kind === 'label' ? 'Label' : 'Sticky note', c.color, c.done ? 'done' : null].filter(Boolean).join(' · '),
        run: () => edit(ctx) };
    }),
  };
  for (const ctx of all) ctx.menu(section);
}

// ---- the note ------------------------------------------------------------------------------

// Paper with a slight curl at the bottom and a small random tilt (a stuck
// note is never perfectly square), a soft shadow under it, the face drawn
// on a canvas.
function buildNote(cfg, seed, hand) {
  const k = KINDS[cfg.kind] ?? KINDS.sticky;
  const rnd = (i) => (((seed * (i + 1) * 2654435761) >>> 0) % 1000) / 1000;
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.z = (rnd(1) - 0.5) * (cfg.kind === 'label' ? 0.03 : 0.09);
  group.add(tilt);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(k.w * PX_PER_M); canvas.height = Math.round(k.h * PX_PER_M);
  drawFace(canvas, cfg, hand);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(k.w, k.h, 8, 8);
  const curl = cfg.kind === 'label' ? 0 : 0.006 + rnd(2) * 0.004;   // bottom edge lifts off the surface
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, (-pos.getY(i) / k.h) + 0.15) / 0.65;           // 0 near the top … 1 at the bottom
    pos.setZ(i, 0.0012 + curl * t * t);
  }
  geo.computeVertexNormals();
  const paper = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, side: THREE.DoubleSide }));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(k.w * 1.12, k.h * 1.18), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false }));
  shadow.position.set(0.0015, -0.002, 0.0003);
  tilt.add(shadow, paper, pin(k, cfg.color));
  return { group, canvas, tex, paper };
}

// The grab handle: a push pin near the top (a tab for labels).
function pin(k, color) {
  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 20, 14), new THREE.MeshStandardMaterial({ color: color === 'pink' ? 0x2f6fe0 : 0xe0453a, roughness: 0.35 }));
  head.scale.z = 0.8;
  head.position.z = 0.0065;
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0006, 0.006, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc0c4cc, metalness: 0.8, roughness: 0.3 }));
  needle.position.z = 0.003;
  // A bigger invisible target around it, so it's easy to grab.
  const grab = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  grab.position.z = 0.006;
  g.add(head, needle, grab);
  g.position.y = k.h / 2 - Math.min(0.009, k.h * 0.3);
  if (k.h < 0.04) { g.position.set(-k.w / 2 + 0.008, 0, 0); g.scale.setScalar(0.8); }   // labels: pinned at the left end
  g.traverse((n) => { n.userData.handle = true; });
  return g;
}

let shadowCache = null;
function shadowTex() {
  if (shadowCache) return shadowCache;
  const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.32)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  shadowCache = new THREE.CanvasTexture(c);
  return shadowCache;
}

function drawFace(canvas, cfg, hand) {
  const k = KINDS[cfg.kind] ?? KINDS.sticky;
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  const base = COLORS[cfg.color] ?? COLORS.yellow;
  // Paper: its color, a touch darker toward the bottom, faint fibers.
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, base); grad.addColorStop(1, shade(base, -0.08));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  if (cfg.kind === 'sticky') { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, 0, W, H * 0.14); }   // the glue strip
  if (k.ruled) {   // index card: a red header line and blue rules
    g.strokeStyle = 'rgba(220,60,60,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, H * 0.24); g.lineTo(W, H * 0.24); g.stroke();
    g.strokeStyle = 'rgba(70,130,220,0.35)'; g.lineWidth = 2;
    for (let y = H * 0.24 + H * 0.13; y < H - 4; y += H * 0.13) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  const pad = W * k.pad;
  const text = String(cfg.text ?? '').trim();
  const ink = cfg.done ? 'rgba(40,44,52,0.45)' : '#2a2e36';
  if (!text) {
    g.fillStyle = 'rgba(40,44,52,0.35)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${Math.round(H * (cfg.kind === 'label' ? 0.4 : 0.11))}px ${hand ? HAND : PRINT}`;
    g.fillText('Tap to write', W / 2, H / 2);
    return;
  }
  // Largest size where the wrapped text fits (cards: one line per rule).
  const font = (px) => `${hand ? 500 : 560} ${px}px ${hand ? HAND : PRINT}`;
  // (Index cards: no taller than the ruled line spacing.)
  let size = Math.round(H * (cfg.kind === 'label' ? 0.55 : k.ruled ? 0.1 : 0.2)), lines = [];
  const top = k.ruled ? H * 0.06 : pad, maxW = W - 2 * pad, maxH = H - top - pad * 0.7;
  for (; size >= 14; size -= 2) {
    g.font = font(size);
    lines = wrap(g, text, maxW);
    if ((k.ruled || lines.length * size * 1.18 <= maxH) && lines.length <= k.lines) break;
  }
  g.fillStyle = ink; g.textBaseline = 'alphabetic';
  g.textAlign = cfg.kind === 'label' ? 'center' : 'left';
  const lineH = k.ruled ? H * 0.13 : size * 1.18;
  let y = k.ruled ? H * 0.2 : (cfg.kind === 'label' ? (H + size * 0.7) / 2 : top + size);
  lines.slice(0, k.lines).forEach((l, i) => {
    const x = cfg.kind === 'label' ? W / 2 : pad;
    g.fillText(l, x, y);
    if (cfg.done) {   // struck through
      const w = g.measureText(l).width, x0 = cfg.kind === 'label' ? x - w / 2 : x;
      g.strokeStyle = 'rgba(40,44,52,0.6)'; g.lineWidth = Math.max(2, size * 0.07);
      g.beginPath(); g.moveTo(x0 - 2, y - size * 0.32); g.lineTo(x0 + w + 2, y - size * 0.36); g.stroke();
    }
    y += i === 0 && k.ruled ? H * 0.17 : lineH;
  });
  if (cfg.done) {   // a check mark in the corner
    g.strokeStyle = '#2f9e5a'; g.lineWidth = Math.max(4, H * 0.025); g.lineCap = 'round';
    const s = H * 0.12, cx = W - pad - s, cy = H - pad - s * 0.4;
    g.beginPath(); g.moveTo(cx - s * 0.5, cy); g.lineTo(cx - s * 0.1, cy + s * 0.4); g.lineTo(cx + s * 0.6, cy - s * 0.5); g.stroke();
  }
}

function wrap(g, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

// ---- clocks, calendars, thermometer, weather (widgets.js) ---------------------------------------

function startWidget(ctx) {
  ctx.widgetCfg = { ...(ctx.instance.config ?? {}) };
  ctx.widget = buildWidget(THREE, ctx, ctx.widgetCfg, widgetApi(ctx));
  ctx.spawn(ctx.widget.group);
  ctx.widget.update(ctx.now());
  widgetActions(ctx);
  notes.add(ctx);
  publishMenu();
  window.__notes = notes;
  // Weather things with no place yet: your home city (Settings), if you set one.
  const city = ctx.settings?.get('city');
  if (needsPlace(ctx) && !ctx.widgetCfg.place && city) setPlace(ctx, city);
}

const needsPlace = (ctx) => ['thermometer', 'weather'].includes(ctx.widgetCfg.kind);

function widgetApi(ctx) {
  return {
    save: (patch) => saveWidget(ctx, patch),
    prompt: (label, value) => ctx.prompt(label, value, { capitalize: true }),
    unit: () => { const u = ctx.settings?.get('units'); return u === 'c' || u === 'f' ? u : (/^en-(US|LR)|^my/.test(navigator.language) ? 'f' : 'c'); },
    choosePlace: async () => { const name = await ctx.prompt('City or town', ctx.widgetCfg.place?.name ?? ctx.settings?.get('city') ?? ''); if (name) setPlace(ctx, name); },
    log: (m) => ctx.log(m),
  };
}

async function setPlace(ctx, name) {
  try {
    const place = await findPlace(name);
    if (!place) { ctx.log(`couldn't find "${name}"`); return; }
    saveWidget(ctx, { place });
  } catch (err) { ctx.log(`couldn't look up "${name}": ${err.message}`); }
}

// Save + rebuild (the config is shared; other devices' copies restart with it).
function saveWidget(ctx, patch) {
  Object.assign(ctx.widgetCfg, patch);
  ctx.setConfig({ ...ctx.widgetCfg });
  ctx.widget.dispose();
  ctx.widget.group.removeFromParent();
  ctx.widget = buildWidget(THREE, ctx, ctx.widgetCfg, widgetApi(ctx));
  ctx.spawn(ctx.widget.group);
  ctx.widget.update(ctx.now());
  widgetActions(ctx);
  publishMenu();
}

function widgetActions(ctx) {
  const c = ctx.widgetCfg, w = ctx.widget, api = widgetApi(ctx);
  const acts = [];
  if (['clock', 'digital', 'calendar', 'today'].includes(c.kind)) {
    const i = ZONES.indexOf(c.tz ?? null), next = ZONES[(i + 1) % ZONES.length];
    acts.push({ label: `🌍 ${zoneName(next)}`, run: () => saveWidget(ctx, { tz: next }) });
  }
  if (needsPlace(ctx)) acts.push({ label: c.place ? `📍 ${c.place.name}` : '📍 Set the place', run: () => api.choosePlace() }, { label: '⟳ Refresh', run: () => w.refetch?.() });
  for (const a of w.actions?.(api) ?? []) acts.push({ label: a.label, run: () => { a.run(); widgetActions(ctx); } });
  ctx.actions(acts);
}
