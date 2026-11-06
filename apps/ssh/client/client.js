// SSH terminal panes (Stratum app). Each instance is one terminal whose SSH
// session runs on the ssh backend; we long-poll the screen (style runs +
// cursor), draw it into a canvas texture and stream keys back through the
// live keyboard (ctx.keyboard: Quest virtual keyboard / phone keyboard).
// Tap the screen to type, tap the title bar to connect. The stand below is
// the grab handle. Drag the screen (finger, trigger/pinch drag, or the
// two-finger hand scroll) to scroll back through history; ✂ Select, then
// tap two spots (or one line) and 📋 Copy (the Stratum clipboard, shared by
// your devices); 📋 Paste sends it in (bracketed paste when the program
// asks for it).
const PANE_W = 0.62;          // meters at scale 1
const LIFT = 0.07;
const BAR_H = 0.04;
const CELL_W = 12, CELL_H = 24, FONT_PX = 20;   // canvas px per cell
const FONT = `${FONT_PX}px ui-monospace, "DejaVu Sans Mono", Menlo, Consolas, monospace`;
const LINE_PX = 20;           // swipe units per line of scroll
const CHIPS = [['Esc', { key: 'Escape' }], ['Tab', { key: 'Tab' }], ['Ctrl', { mod: 'ctrl' }], ['^C', { key: 'Ctrl+C' }],
  ['↑', { key: 'ArrowUp' }], ['↓', { key: 'ArrowDown' }], ['←', { key: 'ArrowLeft' }], ['→', { key: 'ArrowRight' }], ['Paste', { key: 'Paste' }]];

const THEMES = {
  dark: { fg: '#d8dee9', bg: '#0f1216', cursor: '#7aa2ff' },
  green: { fg: '#7dff9a', bg: '#06100a', cursor: '#7dff9a' },
  light: { fg: '#1d232b', bg: '#f4f1ea', cursor: '#2f5cd6' },
};
// xterm-ish palette for pyte's color names (256 / true colors arrive as hex).
const PALETTE = {
  black: '#1c1f24', red: '#e06c75', green: '#98c379', brown: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d8dee9',
  brightblack: '#5c6370', brightred: '#ff7a85', brightgreen: '#b5e890', brightbrown: '#ffd68a', brightblue: '#82c4ff', brightmagenta: '#dd99f0', bfightmagenta: '#dd99f0', brightcyan: '#7fd5df', brightwhite: '#ffffff',
};

let THREE;
let hosts = [];               // saved hosts (this user's, most recently used first)
let lastCtx = null;           // the pane last used: saved hosts connect here (if it's free)
window.__ssh = new Map();     // test hook: instance id → ctx

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const t = (ctx.term = { seq: -1, alive: true, snap: null, keys: [], scroll: 0, sel: null, note: '' });
    [t.cols, t.rows] = sizeOf(ctx);
    t.info = await ctx.backend.get(`/panes/${ctx.instance.id}?cols=${t.cols}&rows=${t.rows}`);
    build(ctx);
    drawBar(ctx);
    poll(ctx);
    ctx.keyboard?.onSummon(() => openKeyboard(ctx));
    ctx.settings?.onChange?.(() => { resize(ctx); draw(ctx); drawBar(ctx); });
    setActions(ctx);
    window.__ssh.set(ctx.instance.id, ctx);
    lastCtx ??= ctx;
    loadHosts();
    // Reconnect where it was, if this pane remembers a host and isn't connected.
    if (t.info.state === 'idle' && ctx.instance.config?.target) connect(ctx, ctx.instance.config.target);
  },

  // Holding still on the page is reading / selecting, not moving: only the
  // pole and base (handles) pick it up. "Pick up" in its tools works too.
  grab(ctx, e) { if (e.how === 'hold' && !e.handle) e.preventDefault(); },

  select(ctx, hit) {
    const t = ctx.term;
    lastCtx = ctx;
    if (hit.object === t.bar) return connect(ctx);
    if (hit.object !== t.screen) return;
    if (t.sel && hit.uv) return pickCell(ctx, hit.uv);
    openKeyboard(ctx);
  },

  // Drag = scroll history (finger down / hand down shows older lines).
  swipe(ctx, s) {
    const t = ctx.term;
    t.swipeBase ??= t.scroll;
    setScroll(ctx, t.swipeBase + Math.round(s.dy / LINE_PX));
    if (s.phase === 'end') t.swipeBase = null;
  },

  async stop(ctx, { removed } = {}) {
    const t = ctx.term;
    if (!t) return;
    t.alive = false;
    t.req?.abort();
    clearTimeout(t.scrollTimer);
    t.kb?.close();
    if (removed) ctx.backend.fetch(`/panes/${ctx.instance.id}`, { method: 'DELETE' }).catch(() => {});
    window.__ssh.delete(ctx.instance.id);
    if (lastCtx === ctx) lastCtx = [...window.__ssh.values()][0] ?? null;
  },
};

function sizeOf(ctx) {
  const [c, r] = String(ctx.settings?.get('size') ?? '80x24').split('x').map(Number);
  return [c || 80, r || 24];
}

// ---- scene ------------------------------------------------------------------------------

function build(ctx) {
  const t = ctx.term;
  const g = new THREE.Group();
  t.canvas = Object.assign(document.createElement('canvas'), { width: t.cols * CELL_W, height: t.rows * CELL_H });
  t.tex = new THREE.CanvasTexture(t.canvas);
  t.tex.colorSpace = THREE.SRGBColorSpace;
  t.tex.anisotropy = 4;
  const h = PANE_W * (t.canvas.height / t.canvas.width);
  t.screen = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W, h), new THREE.MeshBasicMaterial({ map: t.tex }));
  t.screen.position.y = LIFT + h / 2;
  t.bezel = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W + 0.012, h + BAR_H + 0.012), new THREE.MeshBasicMaterial({ color: 0x0b0d10 }));
  t.bezel.position.set(0, LIFT + (h + BAR_H) / 2, -0.002);
  t.barCanvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 66 });
  t.barTex = new THREE.CanvasTexture(t.barCanvas);
  t.barTex.colorSpace = THREE.SRGBColorSpace;
  t.bar = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W, BAR_H), new THREE.MeshBasicMaterial({ map: t.barTex }));
  t.bar.position.y = LIFT + h + BAR_H / 2;
  const standMat = new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, LIFT), standMat);
  pole.position.y = LIFT / 2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, 0.05), standMat);
  base.position.y = 0.007;
  for (const m of [pole, base]) m.userData.handle = true;
  g.add(t.bezel, t.screen, t.bar, pole, base);
  t.group = g;
  ctx.spawn(g);
  draw(ctx);
}

// Size setting changed: a new canvas/texture size (GPU storage is fixed per texture) and a resized pty.
function resize(ctx) {
  const t = ctx.term;
  const [cols, rows] = sizeOf(ctx);
  if (cols === t.cols && rows === t.rows) return;
  t.cols = cols; t.rows = rows;
  t.group.removeFromParent();
  t.group.traverse((n) => { n.geometry?.dispose(); n.material?.map?.dispose(); n.material?.dispose(); });
  build(ctx);
  drawBar(ctx);
  ctx.backend.post(`/panes/${ctx.instance.id}/resize`, { cols, rows }).catch((err) => ctx.log(`resize failed: ${err.message}`));
}

const STATE_TEXT = { idle: 'Not connected · tap here to connect', connecting: 'Connecting…', password: 'Needs a password',
  connected: '', closed: 'Disconnected · tap here to reconnect', error: '' };

function drawBar(ctx) {
  const t = ctx.term;
  const c = t.barCanvas.getContext('2d');
  const s = t.info?.state ?? 'idle';
  const typing = s === 'connected' && t.kb?.open;   // keys (any keyboard) go to this pane
  c.fillStyle = s === 'connected' ? (typing ? '#24324f' : '#1b2a22') : '#1a1d24';
  c.fillRect(0, 0, t.barCanvas.width, t.barCanvas.height);
  if (typing) { c.fillStyle = '#5b8cff'; c.fillRect(0, t.barCanvas.height - 5, t.barCanvas.width, 5); }   // the one you're typing into
  c.fillStyle = s === 'connected' ? '#5fd38d' : s === 'error' ? '#ff7b72' : '#8a91a2';
  c.beginPath(); c.arc(28, 33, 9, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#fff';
  c.font = '600 28px system-ui, sans-serif';
  const name = t.info?.target || 'Terminal';
  c.fillText(`${typing ? '⌨ ' : ''}${name}${t.info?.title ? ` — ${t.info.title}` : ''}`, 52, 30, t.barCanvas.width - 70);
  c.fillStyle = '#9aa1b2';
  c.font = '21px system-ui, sans-serif';
  const hint = t.note || (t.sel ? (t.sel.a ? 'Tap another spot to extend · 📋 Copy' : 'Tap where the text starts (or a line)')
    : t.scroll ? 'Scrolled back · type or ⤓ to return' : typing ? 'Typing here · drag to scroll' : 'Tap the screen to type · drag to scroll');
  c.fillText(t.info?.message && s !== 'connected' ? t.info.message : STATE_TEXT[s] || hint, 52, 56, t.barCanvas.width - 70);
  t.barTex.needsUpdate = true;
  ctx.status(s === 'connected' ? `🖥 ${name}` : `🖥 ${STATE_TEXT[s] ? STATE_TEXT[s].split(' · ')[0] : t.info?.message || name}`);
}

const color = (name, fallback) => (name === 'default' || !name ? fallback : /^[0-9a-f]{6}$/i.test(name) ? `#${name}` : PALETTE[name] ?? fallback);

function draw(ctx) {
  const t = ctx.term;
  const theme = THEMES[ctx.settings?.get('theme')] ?? THEMES.dark;
  const g = t.canvas.getContext('2d');
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, t.canvas.width, t.canvas.height);
  const snap = t.snap;
  if (snap) {
    g.font = FONT;
    g.textBaseline = 'middle';
    snap.lines.forEach((runs, y) => {
      let x = 0;
      for (const [text, fg, bg, flags] of runs) {
        let f = color(fg, theme.fg), b = color(bg, null);
        if (flags & 4) [f, b] = [b ?? theme.bg, f];
        const w = [...text].length;
        if (b) { g.fillStyle = b; g.fillRect(x * CELL_W, y * CELL_H, w * CELL_W, CELL_H); }
        if (text.trim()) {
          g.fillStyle = f;
          g.font = flags & 1 ? `bold ${FONT}` : FONT;
          // One cell per character (fillText's own spacing drifts with fallback glyphs).
          [...text].forEach((ch, i) => { if (ch !== ' ') g.fillText(ch, (x + i) * CELL_W, y * CELL_H + CELL_H / 2 + 1, CELL_W * 1.6); });
          if (flags & 2) g.fillRect(x * CELL_W, (y + 1) * CELL_H - 3, w * CELL_W, 2);
        }
        x += w;
      }
    });
    if (t.sel?.a) {   // selection highlight (absolute lines → visible rows)
      const [[l0, c0], [l1, c1]] = [t.sel.a, t.sel.b ?? t.sel.a].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const whole = !t.sel.b;
      g.fillStyle = 'rgba(91,140,255,0.38)';
      for (let y = 0; y < snap.rows; y++) {
        const n = snap.top + y;
        if (n < l0 || n > l1) continue;
        const x0 = whole || n !== l0 ? 0 : c0, x1 = whole || n !== l1 ? snap.cols - 1 : c1;
        g.fillRect(x0 * CELL_W, y * CELL_H, (x1 - x0 + 1) * CELL_W, CELL_H);
      }
    }
    if (snap.scroll) {   // scrolled back: say so (top right)
      const label = `↑ ${snap.scroll} of ${snap.maxScroll} lines back`;
      g.font = `600 ${FONT_PX - 2}px system-ui, sans-serif`;
      const w = g.measureText(label).width + 24;
      g.fillStyle = 'rgba(91,140,255,0.9)';
      g.beginPath(); g.roundRect(t.canvas.width - w - 10, 8, w, CELL_H + 6, 10); g.fill();
      g.fillStyle = '#fff';
      g.fillText(label, t.canvas.width - w + 2, 8 + (CELL_H + 6) / 2);
    }
    if (snap.cursor && snap.state === 'connected') {
      const [cx, cy] = snap.cursor;
      g.globalAlpha = t.kb?.open ? 0.75 : 0.35;
      g.fillStyle = theme.cursor;
      g.fillRect(cx * CELL_W, cy * CELL_H + 2, CELL_W, CELL_H - 4);
      g.globalAlpha = 1;
    }
  }
  t.tex.needsUpdate = true;
}

// ---- backend --------------------------------------------------------------------------------

async function poll(ctx) {
  const t = ctx.term;
  let failures = 0;
  while (t.alive) {
    try {
      t.req = new AbortController();
      const after = t.force ? -1 : t.seq;
      t.force = false;
      const r = await ctx.backend.fetch(`/panes/${ctx.instance.id}/screen?after=${after}&scroll=${t.scroll}&cols=${t.cols}&rows=${t.rows}`, { signal: t.req.signal });
      if (r.status === 204) continue;
      if (!r.ok) throw new Error(`screen ${r.status}: ${(await r.text()).slice(0, 120)}`);
      const snap = await r.json();
      if (!t.alive) break;
      t.seq = snap.seq;
      t.snap = snap;
      t.info = snap;
      t.maxScroll = snap.maxScroll;
      if (snap.state !== t.wasState) { if (snap.state === 'connected') loadHosts(); else publishMenu(); }   // a connect saves the host
      t.wasState = snap.state;
      if (snap.scroll !== t.scroll) t.scroll = snap.scroll;   // clamped by the server
      draw(ctx);
      drawBar(ctx);
      failures = 0;
    } catch (err) {
      if (!t.alive) break;
      if (err.name === 'AbortError') continue;   // scrolled: ask again for the new view
      if (++failures === 3) ctx.log(`screen failing: ${err.message}`);
      await new Promise((res) => setTimeout(res, Math.min(5000, 500 * failures)));
    }
  }
}

async function post(ctx, what, body = {}) {
  try {
    const info = await ctx.backend.post(`/panes/${ctx.instance.id}/${what}`, body);
    if (info?.state) { ctx.term.info = { ...ctx.term.info, ...info }; drawBar(ctx); }
    return info;
  } catch (err) {
    ctx.log(`${what} failed: ${err.message}`);
    return null;
  }
}

async function connect(ctx, preset, byHand = !preset) {
  const t = ctx.term;
  lastCtx = ctx;
  const target = preset ?? await ctx.prompt('Connect to (user@host)', t.info?.target || ctx.instance.config?.target || ctx.settings?.get('host') || '');
  if (!target) return;
  t.lastTarget = target;
  if (ctx.instance.config?.target !== target) ctx.setConfig({ ...(ctx.instance.config ?? {}), target });
  const info = await post(ctx, 'connect', { target });
  if (!byHand) return;                    // reconnecting by itself: don't pop up prompts
  if (info?.state === 'password') return askPassword(ctx);
  if (info?.state === 'connected') openKeyboard(ctx);   // asked by hand: ready to type
}

async function askPassword(ctx) {
  const t = ctx.term;
  const pw = await ctx.prompt(`Password for ${t.info?.target ?? 'host'}`, '', { secret: true });
  if (!pw) return;
  const info = await post(ctx, 'connect', { target: t.lastTarget ?? t.info.target, password: pw });
  if (info?.state === 'connected') openKeyboard(ctx);
}

async function forgetHost(ctx) {
  const target = ctx.term.info?.target || ctx.instance.config?.target;
  if (!target) return;
  try { await ctx.backend.post('/forget', { target }); ctx.log(`forgot ${target}'s host key`); } catch (err) { ctx.log(`forget failed: ${err.message}`); }
}

// ---- saved hosts (a section on the Terminal page of the menu) ----------------------------

async function loadHosts() {
  const any = [...window.__ssh.values()][0];
  if (!any) return;
  try { hosts = (await any.backend.get('/hosts')).hosts; } catch { return; }
  publishMenu();
}

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  return s < 90 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

function publishMenu() {
  const live = new Set([...window.__ssh.values()].filter((c) => c.term.info?.state === 'connected').map((c) => c.term.info.target));
  const section = {
    title: 'Saved hosts',
    empty: 'Hosts you connect to are saved here',
    items: hosts.map((h) => ({
      id: h.target, emoji: '🖥', label: h.name || h.target,
      sub: [h.name ? h.target : null, live.has(h.target) ? 'connected' : `used ${ago(h.used)}`].filter(Boolean).join(' · '),
      run: () => connectSaved(h.target),
      remove: () => removeHost(h.target),
    })),
    add: { label: 'Add host…', run: () => addHost() },
  };
  for (const c of window.__ssh.values()) c.menu(section);
}

// Which pane a saved host opens in: the last one used if it's free, else any
// free pane, else the last one (its session is replaced).
function paneForHost() {
  const all = [...window.__ssh.values()];
  const free = (c) => c && c.term.info?.state !== 'connected' && c.term.info?.state !== 'connecting';
  return free(lastCtx) ? lastCtx : all.find(free) ?? lastCtx ?? all[0];
}

async function connectSaved(target) {
  const ctx = paneForHost();
  if (!ctx) return;
  const was = ctx.term.info?.state === 'connected' ? ctx.term.info.target : null;
  lastCtx = ctx;
  await connect(ctx, target, true);
  if (was && was !== target) flash(ctx, `Switched from ${was}`);
}

async function addHost() {
  const ctx = lastCtx ?? [...window.__ssh.values()][0];
  if (!ctx) return;
  const target = await ctx.prompt('Add host (user@host)', '');
  if (!target) return;
  try { hosts = (await ctx.backend.post('/hosts', { target })).hosts; publishMenu(); } catch (err) { ctx.log(`couldn't save ${target}: ${err.message}`); }
}

async function removeHost(target) {
  const ctx = [...window.__ssh.values()][0];
  if (!ctx) return;
  try { hosts = (await ctx.backend.fetch(`/hosts?target=${encodeURIComponent(target)}`, { method: 'DELETE' }).then((r) => r.json())).hosts; publishMenu(); } catch (err) { ctx.log(`couldn't remove ${target}: ${err.message}`); }
}

// ---- scroll, select, copy, paste ------------------------------------------------------------

// At most ~15 view changes a second; each one re-asks the server at once.
function setScroll(ctx, n) {
  const t = ctx.term;
  n = Math.max(0, Math.min(t.maxScroll ?? 0, n));
  if (n === t.scroll && !t.scrollTimer) return;
  t.wantScroll = n;
  if (t.scrollTimer) return;
  t.scrollTimer = setTimeout(() => {
    t.scrollTimer = null;
    if (t.wantScroll === t.scroll) return;
    t.scroll = t.wantScroll;
    t.force = true;
    t.req?.abort();
    setActions(ctx);
  }, 66);
}

function setActions(ctx) {
  const t = ctx.term;
  if (t.sel) {
    ctx.actions([
      { label: '📋 Copy', run: () => copy(ctx) },
      { label: '✕ Cancel', run: () => { t.sel = null; setActions(ctx); draw(ctx); drawBar(ctx); } },
    ]);
    return;
  }
  ctx.actions([
    { label: '🔌 Connect', run: () => connect(ctx) },
    { label: '⌨ Keys', run: () => openKeyboard(ctx) },
    ...(t.scroll ? [{ label: '⤓ Bottom', run: () => setScroll(ctx, 0) }] : []),
    { label: '✂ Select', run: () => { t.sel = { a: null, b: null }; setActions(ctx); drawBar(ctx); } },
    { label: '📋 Paste', run: () => paste(ctx) },
    { label: '^C', run: () => queueKey(ctx, { key: 'Ctrl+C' }) },
    { label: '⏏ Disconnect', run: () => post(ctx, 'disconnect') },
    { label: '🔑 Forget host', run: () => forgetHost(ctx) },
  ]);
}

// A tap in select mode: first = start, later taps = end (absolute line, column).
function pickCell(ctx, uv) {
  const t = ctx.term, snap = t.snap;
  if (!snap) return;
  const col = Math.min(snap.cols - 1, Math.max(0, Math.floor(uv.x * snap.cols)));
  const row = Math.min(snap.rows - 1, Math.max(0, Math.floor((1 - uv.y) * snap.rows)));
  const at = [snap.top + row, col];
  if (!t.sel.a) t.sel.a = at; else t.sel.b = at;
  draw(ctx);
  drawBar(ctx);
}

async function copy(ctx) {
  const t = ctx.term;
  const { a, b } = t.sel ?? {};
  if (!a) return flash(ctx, 'Tap the text to copy first');
  const from = b ? a : [a[0], 0], to = b ?? [a[0], 9999];    // one tap: the whole line
  try {
    const { text } = await ctx.backend.get(`/panes/${ctx.instance.id}/text?from=${from.join(':')}&to=${to.join(':')}`);
    await ctx.clipboard.write(text);
    t.sel = null;
    setActions(ctx);
    draw(ctx);
    flash(ctx, `Copied ${text.length} characters`);
  } catch (err) {
    flash(ctx, `Copy failed: ${err.message}`);
  }
}

async function paste(ctx) {
  const t = ctx.term;
  if (t.info?.state !== 'connected') return flash(ctx, 'Connect first');
  const text = await ctx.clipboard.read().catch(() => '');
  if (!text) return flash(ctx, 'The clipboard is empty');
  if (t.scroll) setScroll(ctx, 0);
  try { await ctx.backend.post(`/panes/${ctx.instance.id}/input`, { paste: text }); } catch (err) { flash(ctx, `Paste failed: ${err.message}`); }
}

function flash(ctx, text) {
  const t = ctx.term;
  t.note = text;
  drawBar(ctx);
  clearTimeout(t.noteTimer);
  t.noteTimer = setTimeout(() => { t.note = ''; drawBar(ctx); }, 2500);
}

// ---- keys -----------------------------------------------------------------------------------

function openKeyboard(ctx) {
  const t = ctx.term;
  if (!ctx.keyboard) return;
  if (t.info?.state !== 'connected') return connect(ctx);
  t.kb = ctx.keyboard.open({
    label: `${t.info.target} — keys go straight in`, kind: 'text', chips: CHIPS,
    onKey: (ev) => queueKey(ctx, ev),
    onClose: () => { t.kb = null; drawBar(ctx); draw(ctx); },
  });
  drawBar(ctx);
  draw(ctx);
}

// In order, one request at a time (consecutive text merged).
function queueKey(ctx, ev) {
  const t = ctx.term;
  if (ev.key === 'Paste') return paste(ctx);
  if (t.scroll) setScroll(ctx, 0);            // typing goes back to the live screen
  const last = t.keys.at(-1);
  if (ev.text != null && last?.text != null) last.text += ev.text;
  else t.keys.push(ev.text != null ? { text: ev.text } : { key: ev.key });
  if (!t.pumping) pump(ctx);
}

async function pump(ctx) {
  const t = ctx.term;
  t.pumping = true;
  while (t.keys.length && t.alive) {
    try { await ctx.backend.post(`/panes/${ctx.instance.id}/input`, t.keys.shift()); } catch (err) { ctx.log(`key failed: ${err.message}`); t.keys = []; }
  }
  t.pumping = false;
}
