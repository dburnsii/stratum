// Browser panes (Stratum app): a real Chrome on the server, one window per
// pane (apps/browser/backend). Each pane streams its page over a WebSocket:
// H.264 (or VP8, or JPEG) decoded with WebCodecs into a texture, and the
// page's sound (Opus) played from where the pane is. On top: real tabs and
// an address bar with suggestions, drawn here. Input (taps, scrolls, keys)
// goes back on the socket. Pane frame = instance frame: the window stands
// upright above the instance's puck, facing +z; the stand + base below it is
// the only grab handle that moves it.
const PANE_W = 0.64;          // meters at scale 1 (resize with − / +)
const LIFT = 0.07;            // window bottom above the puck
const TABS_H = 0.032, TOOL_H = 0.036, CHROME_H = TABS_H + TOOL_H;   // tab strip + toolbar
const PX = 2048 / PANE_W;     // chrome canvas px per meter
const SCROLL_GAIN = 2.5;      // page px per screen px of swipe
const FLING = { decay: 0.9, min: 2 };   // after a swipe: scroll keeps going, slowing per 1/60 s
const SUGGEST_ROWS = 6, ROW_H = 0.03;
const H264 = 'avc1.42E028';
const HEADER = 10;            // binary message: kind, flags, timestamp (µs, u64)
// Demo (for now): no live Chrome. The pane shows still pictures of a couple of
// sites (tabs switch them), so you can see what's in store without the server
// streaming video (that cost the headset frames). The backend is untouched:
// set DEMO = false for the real browser.
const DEMO = !window.__browserLive;   // (tests of the live browser set window.__browserLive)
const DEMO_PAGES = [
  { id: 'google', title: 'Google', url: 'https://www.google.com/', img: 'demo/google.jpg' },
  { id: 'example', title: 'Example', url: 'https://example.com/', img: 'demo/example.jpg' },
];

let THREE;
let focused = null;           // ctx of the pane last touched: its buttons show in the overlay
window.__browser = new Map(); // test hook: instance id → ctx

export default {
  async start(ctx) {
    THREE = ctx.THREE;
    const b = (ctx.browser = { alive: true, info: null, regions: [], edit: null, suggest: [], frames: 0, pendingScroll: 0, demo: DEMO });
    if (b.demo) b.info = demoInfo(0);
    else b.info = await ctx.backend.get(`/panes/${ctx.instance.id}`);
    build(ctx);
    drawChrome(ctx);
    if (b.demo) showDemoPage(ctx, 0);
    else connect(ctx);
    focus(ctx);
    ctx.keyboard?.onSummon(() => openKeyboard(ctx, false));   // keyboard gesture while this pane was last touched
    window.__browser.set(ctx.instance.id, ctx);
  },

  // Holding still on the page is reading / selecting, not moving: only the
  // pole and base (handles) pick it up. "Pick up" in its tools works too.
  grab(ctx, e) { if (e.how === 'hold' && !e.handle) e.preventDefault(); },

  select(ctx, hit) {
    const b = ctx.browser;
    focus(ctx);
    unlockAudio(ctx);
    if (hit.object === b.chrome && hit.uv) return chromeTap(ctx, hit.uv.x * 2048, (1 - hit.uv.y) * b.chromeCanvas.height);
    if (hit.object === b.list && hit.uv) return suggestionTap(ctx, Math.floor((1 - hit.uv.y) * SUGGEST_ROWS));
    if (hit.object === b.screen && hit.uv) {
      if (b.edit) endEdit(ctx);
      b.focusKey = null;
      stopFling(b);
      send(ctx, { type: 'click', x: hit.uv.x, y: 1 - hit.uv.y });
    }
  },

  // Swipes that start on this pane scroll it (finger up = page moves up), and keep gliding after.
  swipe(ctx, s) {
    const b = ctx.browser;
    focus(ctx);
    stopFling(b);
    const delta = s.dy - (b.lastDy ?? 0), dx = s.dx - (b.lastDx ?? 0);
    const now = performance.now();
    b.vel = delta / Math.max(1, now - (b.lastSwipeAt ?? now - 16)) * 16;   // px per 1/60 s
    b.lastSwipeAt = now;
    b.lastDy = s.phase === 'end' ? 0 : s.dy;
    b.lastDx = s.phase === 'end' ? 0 : s.dx;
    scrollBy(ctx, -dx * SCROLL_GAIN * 0.5, -delta * SCROLL_GAIN);
    if (s.phase === 'end' && Math.abs(b.vel) > FLING.min) b.fling = -b.vel * SCROLL_GAIN;
  },

  frame(ctx, dt) {
    const b = ctx.browser;
    if (b.fling) {
      scrollBy(ctx, 0, b.fling * dt * 60);
      b.fling *= FLING.decay ** (dt * 60);
      if (Math.abs(b.fling) < FLING.min) b.fling = 0;
    }
    placeAudio(ctx);
  },

  // removed: the pane was deleted (not just turned off / AR exited) → close
  // its window on the server now instead of waiting for the idle timeout.
  async stop(ctx, { removed } = {}) {
    const b = ctx.browser;
    if (!b) return;
    if (removed && !b.demo) ctx.backend.fetch(`/panes/${ctx.instance.id}`, { method: 'DELETE' }).catch(() => {});
    b.alive = false;
    clearTimeout(b.scrollTimer);
    clearTimeout(b.retry);
    b.ws?.close();
    try { b.decoder?.close(); } catch { /* closed */ }
    try { b.audioDecoder?.close(); } catch { /* closed */ }
    b.audio?.ctx.close();
    b.bitmap?.close();
    if (focused === ctx) focused = null;
    window.__browser.delete(ctx.instance.id);
  },
};

// ---- scene -------------------------------------------------------------------------

function build(ctx) {
  const b = ctx.browser;
  const h = PANE_W * (b.info.height / b.info.width);
  b.pageH = h;
  const g = new THREE.Group();
  b.tex = new THREE.Texture();
  b.tex.colorSpace = THREE.SRGBColorSpace;
  b.tex.flipY = false;                 // bitmaps are made flipped (see show())
  b.tex.generateMipmaps = false;
  b.tex.minFilter = THREE.LinearFilter;
  b.screen = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W, h), new THREE.MeshBasicMaterial({ color: 0x1a1d24 }));
  b.screen.position.y = LIFT + h / 2;
  const bezel = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W + 0.012, h + CHROME_H + 0.012), new THREE.MeshBasicMaterial({ color: 0x0b0d12 }));
  bezel.position.set(0, LIFT + (h + CHROME_H) / 2, -0.002);
  b.bezel = bezel;
  b.chromeCanvas = Object.assign(document.createElement('canvas'), { width: 2048, height: Math.round(CHROME_H * PX) });
  b.chromeTex = new THREE.CanvasTexture(b.chromeCanvas);
  b.chromeTex.colorSpace = THREE.SRGBColorSpace;
  b.chrome = new THREE.Mesh(new THREE.PlaneGeometry(PANE_W, CHROME_H), new THREE.MeshBasicMaterial({ map: b.chromeTex }));
  b.chrome.position.y = LIFT + h + CHROME_H / 2;
  b.bar = b.chrome;   // (older tests and hooks call it the bar)
  // Address suggestions: a list just in front of the top of the page while editing.
  b.listCanvas = Object.assign(document.createElement('canvas'), { width: 1400, height: Math.round(SUGGEST_ROWS * ROW_H * PX) });
  b.listTex = new THREE.CanvasTexture(b.listCanvas);
  b.listTex.colorSpace = THREE.SRGBColorSpace;
  const listW = 1400 / PX;
  b.list = new THREE.Mesh(new THREE.PlaneGeometry(listW, SUGGEST_ROWS * ROW_H), new THREE.MeshBasicMaterial({ map: b.listTex }));
  b.list.position.set(-PANE_W / 2 + 0.11 + listW / 2, LIFT + h - SUGGEST_ROWS * ROW_H / 2, 0.003);
  showList(b, false);
  // Stand + base: the grab handle (drag it to move the pane).
  const standMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, LIFT), standMat);
  pole.position.y = LIFT / 2;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.014, 0.05), standMat);
  base.position.y = 0.007;
  for (const m of [pole, base]) m.userData.handle = true;
  b.base = base;
  g.add(bezel, b.screen, b.chrome, b.list, pole, base);
  ctx.spawn(g);
}

// The tab strip and toolbar: drawn on one canvas; regions say what each part does.
function drawChrome(ctx) {
  const b = ctx.browser, c = b.chromeCanvas.getContext('2d'), W = 2048, tabsH = Math.round(TABS_H * PX), toolH = c.canvas.height - tabsH;
  const info = b.info ?? {}, regions = (b.regions = []);
  c.clearRect(0, 0, W, c.canvas.height);
  c.fillStyle = '#0f1218';
  c.fillRect(0, 0, W, tabsH);
  // Tabs.
  const tabs = info.tabs ?? [];
  const plusW = 90, tabW = Math.min(420, (W - plusW - 16) / Math.max(1, tabs.length));
  tabs.forEach((t, i) => {
    const x = 8 + i * tabW;
    c.fillStyle = t.active ? '#262c38' : '#171b23';
    roundRect(c, x + 3, 8, tabW - 6, tabsH - 8, 14, true);
    c.fillStyle = t.active ? '#fff' : '#aab1c0';
    c.font = '500 40px system-ui, sans-serif';
    c.fillText(`${t.loading ? '◌ ' : ''}${t.title || hostOf(t.url) || 'New tab'}`, x + 26, tabsH / 2 + 18, tabW - 110);
    regions.push({ x0: x, x1: x + tabW - 70, y0: 0, y1: tabsH, run: () => send(ctx, { type: 'tab', tab: t.id }) });
    c.fillStyle = '#8a92a3';
    c.font = '44px system-ui, sans-serif';
    c.fillText('✕', x + tabW - 58, tabsH / 2 + 16);
    regions.push({ x0: x + tabW - 70, x1: x + tabW, y0: 0, y1: tabsH, run: () => send(ctx, { type: 'closetab', tab: t.id }) });
  });
  const px = 8 + tabs.length * tabW;
  c.fillStyle = '#c7cdd9';
  c.font = '56px system-ui, sans-serif';
  c.fillText('+', px + 26, tabsH / 2 + 20);
  regions.push({ x0: px, x1: px + plusW, y0: 0, y1: tabsH, run: () => { send(ctx, { type: 'newtab' }); setTimeout(() => beginEdit(ctx, ''), 300); } });
  // Toolbar: ◀ ▶ ⟳ [ address ] ⌂
  const y0 = tabsH;
  c.fillStyle = '#262c38';
  c.fillRect(0, y0, W, toolH);
  const btn = (x, label, on, run) => {
    c.fillStyle = on ? '#e6e9f0' : '#5d6475';
    c.font = '60px system-ui, sans-serif';
    c.fillText(label, x + 18, y0 + toolH / 2 + 22);
    regions.push({ x0: x, x1: x + 100, y0, y1: y0 + toolH, run: on ? run : () => {} });
  };
  btn(10, '◀', info.back, () => send(ctx, { type: 'back' }));
  btn(110, '▶', info.forward, () => send(ctx, { type: 'forward' }));
  btn(210, info.loading ? '✕' : '⟳', true, () => send(ctx, { type: info.loading ? 'stop' : 'reload' }));
  const ax = 330, aw = W - ax - 130;
  c.fillStyle = b.edit ? '#0f1218' : '#171b23';
  roundRect(c, ax, y0 + 12, aw, toolH - 24, (toolH - 24) / 2, true);
  if (b.edit) { c.strokeStyle = '#5b8def'; c.lineWidth = 4; roundRect(c, ax, y0 + 12, aw, toolH - 24, (toolH - 24) / 2, false); }
  c.font = '44px system-ui, sans-serif';
  const ty = y0 + toolH / 2 + 16;
  if (b.edit) {
    c.fillStyle = '#fff';
    const text = b.edit.text, shown = fitEnd(c, text, aw - 80);
    c.fillText(shown, ax + 40, ty);
    c.fillStyle = '#5b8def';
    c.fillRect(ax + 42 + c.measureText(shown).width, y0 + 32, 4, toolH - 64);   // caret
  } else {
    const url = info.url ?? '';
    const secure = url.startsWith('https://');
    const host = hostOf(url), rest = url.replace(/^https?:\/\/[^/]+/, '');
    c.fillStyle = '#9aa1b2';
    c.fillText(secure ? '🔒' : 'ⓘ', ax + 28, ty);
    c.fillStyle = '#fff';
    c.fillText(host || url, ax + 96, ty, aw - 140);
    c.fillStyle = '#8a92a3';
    const hw = c.measureText(host || url).width;
    if (host && hw < aw - 200) c.fillText(rest, ax + 96 + hw, ty, aw - 140 - hw);
  }
  regions.push({ x0: ax, x1: ax + aw, y0, y1: y0 + toolH, run: () => beginEdit(ctx, b.info?.url ?? '') });
  btn(W - 120, '⌂', true, () => {
    const home = ctx.settings?.get('home');
    send(ctx, home ? { type: 'goto', url: home } : { type: 'goto', url: '' });
  });
  b.chromeTex.needsUpdate = true;
}

function chromeTap(ctx, x, y) {
  const r = ctx.browser.regions.find((g) => x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y1);
  r?.run();
}

const hostOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.host.replace(/^www\./, '') : ''; } catch { return ''; } };

function fitEnd(c, text, w) {   // the end of the text that fits (you see what you're typing)
  if (c.measureText(text).width <= w) return text;
  let s = text;
  while (s.length && c.measureText(`…${s}`).width > w) s = s.slice(1);
  return `…${s}`;
}

function roundRect(c, x, y, w, h, r, fill) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  if (fill) c.fill(); else c.stroke();
}

// ---- address bar -------------------------------------------------------------------
// Tap it: the URL is selected for replacing (typing replaces it, Backspace
// clears it, ← → keep it to edit), suggestions from your history show over
// the page, Enter goes (words become a search), a suggestion goes there.

function beginEdit(ctx, url) {
  const b = ctx.browser;
  if (b.demo) return demoNote(ctx);
  if (!ctx.keyboard) {   // phone: the text box
    ctx.prompt('Go to', url).then((v) => { if (v != null) send(ctx, { type: 'goto', url: v }); });
    return;
  }
  b.edit = { text: url, fresh: true };
  b.kbAuto = false;
  ctx.keyboard.open({
    label: 'Address', kind: 'url',
    onKey: (ev) => editKey(ctx, ev),
    onClose: () => { if (b.edit) endEdit(ctx, false); },
  });
  drawChrome(ctx);
  refreshSuggestions(ctx);
}

function editKey(ctx, ev) {
  const e = ctx.browser.edit;
  if (!e) return;
  if (ev.text) e.text = (e.fresh ? '' : e.text) + ev.text;
  else if (ev.key === 'Backspace') e.text = e.fresh ? '' : e.text.slice(0, -1);
  else if (ev.key === 'Enter') return go(ctx, e.text);
  else if (ev.key === 'Escape') return endEdit(ctx);
  e.fresh = false;
  drawChrome(ctx);
  refreshSuggestions(ctx);
}

function go(ctx, text) {
  endEdit(ctx);
  send(ctx, { type: 'goto', url: text });
}

function endEdit(ctx, closeKeyboard = true) {
  const b = ctx.browser;
  b.edit = null;
  b.suggest = [];
  showList(b, false);
  if (closeKeyboard) ctx.keyboard?.close();
  drawChrome(ctx);
}

function refreshSuggestions(ctx) {
  const b = ctx.browser;
  clearTimeout(b.suggestTimer);
  b.suggestTimer = setTimeout(async () => {
    const q = b.edit?.fresh ? '' : b.edit?.text ?? '';
    let items = [];
    if (q.trim()) {
      try { items = (await ctx.backend.get(`/panes/${ctx.instance.id}/suggest?q=${encodeURIComponent(q)}`)).items; } catch { /* none */ }
      const looksLikeUrl = !/\s/.test(q) && /\./.test(q);
      const typed = { url: q, title: looksLikeUrl ? `Go to ${q}` : `Search for “${q}”`, typed: true };
      items = [typed, ...items.filter((i) => i.url !== q)].slice(0, SUGGEST_ROWS);
    }
    if (!b.edit) return;
    b.suggest = items;
    drawSuggestions(ctx);
  }, 120);
}

function drawSuggestions(ctx) {
  const b = ctx.browser, c = b.listCanvas.getContext('2d'), rowPx = c.canvas.height / SUGGEST_ROWS;
  showList(b, b.suggest.length > 0);
  c.fillStyle = '#171b23';
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
  b.suggest.forEach((s, i) => {
    const y = i * rowPx;
    if (i) { c.fillStyle = '#262c38'; c.fillRect(24, y, c.canvas.width - 48, 2); }
    c.fillStyle = '#fff';
    c.font = '500 40px system-ui, sans-serif';
    c.fillText(`${s.typed ? '🔎' : '🕘'}  ${s.title || s.url}`, 28, y + rowPx * 0.45, c.canvas.width - 56);
    if (!s.typed) {
      c.fillStyle = '#8a92a3';
      c.font = '30px system-ui, sans-serif';
      c.fillText(s.url, 96, y + rowPx * 0.82, c.canvas.width - 130);
    }
  });
  b.listTex.needsUpdate = true;
}

// Hidden objects still catch rays: the list only takes taps while it shows.
function showList(b, on) {
  b.list.visible = on;
  b.list.raycast = on ? THREE.Mesh.prototype.raycast : () => {};
}

function suggestionTap(ctx, row) {
  const s = ctx.browser.suggest[row];
  if (s) go(ctx, s.url);
}

// ---- the stream --------------------------------------------------------------------

async function pickCodec(ctx) {
  if (ctx.settings?.get('fps') === 'saver' || typeof VideoDecoder === 'undefined') return 'jpeg';
  const base = { codedWidth: ctx.browser.info.width, codedHeight: ctx.browser.info.height, optimizeForLatency: true };
  for (const [name, codec] of [['h264', H264], ['vp8', 'vp8']]) {
    try { if ((await VideoDecoder.isConfigSupported({ ...base, codec })).supported) return name; } catch { /* next */ }
  }
  return 'jpeg';
}

async function connect(ctx) {
  const b = ctx.browser;
  if (!b.alive) return;
  b.codec = await pickCodec(ctx);
  const audio = typeof AudioDecoder !== 'undefined' ? 1 : 0;
  const ws = (b.ws = ctx.backend.socket(`/panes/${ctx.instance.id}/stream?codec=${b.codec}&audio=${audio}`));
  ws.onmessage = (m) => (typeof m.data === 'string' ? onText(ctx, JSON.parse(m.data)) : onBinary(ctx, m.data));
  ws.onopen = () => { b.failures = 0; };
  ws.onclose = () => {
    if (!b.alive) return;
    b.failures = (b.failures ?? 0) + 1;
    if (b.failures === 3) ctx.log('stream keeps dropping; retrying');
    b.retry = setTimeout(() => connect(ctx), Math.min(5000, 500 * b.failures));
  };
}

function onText(ctx, m) {
  const b = ctx.browser;
  if (m.t === 'info') {
    b.info = m;
    drawChrome(ctx);
    syncKeyboard(ctx);
  } else if (m.t === 'config' && m.codec !== 'jpeg') {
    try { b.decoder?.close(); } catch { /* closed */ }
    b.waitKey = true;
    b.decoder = new VideoDecoder({
      output: (frame) => show(ctx, frame),
      error: (err) => { ctx.log(`video: ${err.message}`); b.decoder = null; b.waitKey = true; askKey(ctx); onText(ctx, m); },
    });
    b.decoder.configure({ codec: m.codec, codedWidth: m.width, codedHeight: m.height, optimizeForLatency: true });
  } else if (m.t === 'error') {
    ctx.log(m.message);
  }
}

function onBinary(ctx, buf) {
  const b = ctx.browser;
  const v = new DataView(buf), kind = v.getUint8(0), key = v.getUint8(1) === 1, ts = Number(v.getBigUint64(2));
  const data = new Uint8Array(buf, HEADER);
  if (kind === 1 && b.decoder) {
    if (b.waitKey && !key) return;
    b.waitKey = false;
    if (b.decoder.decodeQueueSize > 8) { b.waitKey = true; askKey(ctx); return; }   // falling behind: skip to a key frame
    try { b.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data })); } catch { b.waitKey = true; askKey(ctx); }
  } else if (kind === 3) {
    createImageBitmap(new Blob([data], { type: 'image/jpeg' }), { imageOrientation: 'flipY' }).then((bmp) => setBitmap(ctx, bmp)).catch(() => {});
  } else if (kind === 2) {
    b.audioPackets = (b.audioPackets ?? 0) + 1;
    playAudio(ctx, data, ts);
  }
}

function askKey(ctx) {
  const b = ctx.browser;
  if (b.ws?.readyState === 1 && performance.now() - (b.askedKey ?? 0) > 500) { b.askedKey = performance.now(); b.ws.send(JSON.stringify({ t: 'key-frame' })); }
}

// Newest frame only: while one is being turned into a bitmap, later ones replace the waiting one.
function show(ctx, frame) {
  const b = ctx.browser;
  if (b.converting) { b.nextFrame?.close(); b.nextFrame = frame; return; }
  b.converting = true;
  createImageBitmap(frame, { imageOrientation: 'flipY' }).then((bmp) => setBitmap(ctx, bmp)).catch(() => {}).finally(() => {
    frame.close();
    b.converting = false;
    const next = b.nextFrame;
    b.nextFrame = null;
    if (next && b.alive) show(ctx, next);
  });
}

function setBitmap(ctx, bmp) {
  const b = ctx.browser;
  if (!b.alive) { bmp.close(); return; }
  const old = b.bitmap;
  b.bitmap = bmp;
  b.tex.image = bmp;
  b.tex.needsUpdate = true;
  b.frames++;
  if (!b.screen.material.map) {
    b.screen.material.dispose();
    b.screen.material = new THREE.MeshBasicMaterial({ map: b.tex });
  }
  if (old) requestAnimationFrame(() => old.close());   // after the upload that used it
}

// ---- demo ---------------------------------------------------------------------------

function demoInfo(active) {
  return { width: 1280, height: 800, url: DEMO_PAGES[active].url, title: DEMO_PAGES[active].title, back: false, forward: false, loading: false,
    tabs: DEMO_PAGES.map((p, i) => ({ id: p.id, title: p.title, url: p.url, active: i === active })), focus: null };
}

async function showDemoPage(ctx, i) {
  const b = ctx.browser;
  b.info = demoInfo(i);
  b.demoPage = DEMO_PAGES[i].id;
  drawChrome(ctx);
  try {
    const blob = await (await fetch(new URL(DEMO_PAGES[i].img, import.meta.url))).blob();
    setBitmap(ctx, await createImageBitmap(blob, { imageOrientation: 'flipY' }));
  } catch (err) { ctx.log(`demo page: ${err.message}`); }
}

// Tabs switch the picture; everything else just says it's a demo.
function demoInput(ctx, ev) {
  if (ev.type === 'tab') { const i = DEMO_PAGES.findIndex((p) => p.id === ev.tab); if (i >= 0) showDemoPage(ctx, i); return; }
  if (ev.type === 'scroll') return;
  demoNote(ctx);
}

function demoNote(ctx) {
  const b = ctx.browser, now = performance.now();
  if (now - (b.notedAt ?? 0) < 3000) return;
  b.notedAt = now;
  ctx.log('Demo browser: just pictures for now (tap a tab to switch)');
  ctx.status?.('Demo: tap a tab to switch');
}

// ---- sound -------------------------------------------------------------------------
// The server sends this player's sound to one pane at a time (the one touched
// last); it plays from that pane's position.

function audioOf(ctx) {
  const b = ctx.browser;
  if (b.audio) return b.audio;
  const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  const panner = new PannerNode(ac, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: 0.6 });
  panner.connect(ac.destination);
  b.audio = { ctx: ac, panner, next: 0 };
  b.audioDecoder = new AudioDecoder({
    output: (data) => schedule(ctx, data),
    error: () => { b.audioDecoder = null; },
  });
  b.audioDecoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
  return b.audio;
}

function unlockAudio(ctx) {
  const b = ctx.browser;
  if (typeof AudioDecoder === 'undefined') return;
  audioOf(ctx).ctx.resume?.();
  if (b.ws?.readyState === 1) b.ws.send(JSON.stringify({ t: 'audio' }));   // the sound comes here now
}

function playAudio(ctx, data, ts) {
  const b = ctx.browser;
  const a = audioOf(ctx);
  if (!b.audioDecoder || a.ctx.state !== 'running') return;
  try { b.audioDecoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, data })); } catch { /* skip */ }
}

function schedule(ctx, data) {
  const a = ctx.browser.audio;
  const buf = a.ctx.createBuffer(data.numberOfChannels, data.numberOfFrames, data.sampleRate);
  for (let ch = 0; ch < data.numberOfChannels; ch++) {
    const out = new Float32Array(data.numberOfFrames);
    data.copyTo(out, { planeIndex: ch, format: 'f32-planar' });
    buf.copyToChannel(out, ch);
  }
  data.close();
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(a.panner);
  const now = a.ctx.currentTime;
  if (a.next < now + 0.02 || a.next > now + 0.4) a.next = now + 0.08;   // (re)start with a small cushion; never drift far behind
  src.start(a.next);
  a.next += buf.duration;
}

function placeAudio(ctx) {
  const a = ctx.browser.audio, v = ctx.viewer();
  if (!a || !v) return;
  // Listener at your head, the sound at the screen (both in the pane's frame).
  const l = a.ctx.listener, t = a.ctx.currentTime + 0.05;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quaternion);
  if (l.positionX) {
    l.positionX.linearRampToValueAtTime(v.position.x, t); l.positionY.linearRampToValueAtTime(v.position.y, t); l.positionZ.linearRampToValueAtTime(v.position.z, t);
    l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
    l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
  }
  a.panner.positionY.value = LIFT + ctx.browser.pageH / 2;
}

// ---- input -------------------------------------------------------------------------

function send(ctx, ev) {
  const b = ctx.browser;
  if (b.demo) return demoInput(ctx, ev);
  if (b.ws?.readyState === 1) { b.ws.send(JSON.stringify(ev)); return; }
  ctx.backend.post(`/panes/${ctx.instance.id}/input`, ev).then((info) => { b.info = info; drawChrome(ctx); syncKeyboard(ctx); })
    .catch((err) => ctx.log(`${ev.type} failed: ${err.message}`));
}

function scrollBy(ctx, dx, dy) {
  const b = ctx.browser;
  b.pendingScroll += dy;
  b.pendingScrollX = (b.pendingScrollX ?? 0) + dx;
  if (b.scrollTimer) return;
  b.scrollTimer = setTimeout(() => {   // batch: at most ~30 scroll messages a second
    b.scrollTimer = null;
    const y = b.pendingScroll, x = b.pendingScrollX;
    b.pendingScroll = 0;
    b.pendingScrollX = 0;
    if (Math.abs(y) >= 1 || Math.abs(x) >= 1) send(ctx, { type: 'scroll', dx: Math.abs(x) >= 1 ? x : 0, dy: y, x: 0.5, y: 0.5 });
  }, 33);
}

function stopFling(b) { b.fling = 0; }

// ---- focus + overlay buttons -------------------------------------------------------

function focus(ctx) {
  if (focused === ctx) return;
  const prev = focused;
  focused = ctx;
  if (prev?.browser) { prev.actions([]); prev.status(''); }
  if (ctx.browser.demo) {
    ctx.actions(DEMO_PAGES.map((p, i) => ({ label: `${i ? '🎬' : '🔍'} ${p.title}`, run: () => showDemoPage(ctx, i) })));
    ctx.status('Browser demo: pictures only');
    return;
  }
  ctx.actions([
    { label: '＋ Tab', run: () => { send(ctx, { type: 'newtab' }); setTimeout(() => beginEdit(ctx, ''), 300); } },
    { label: '🔗 Address', run: () => beginEdit(ctx, ctx.browser.info?.url ?? '') },
    { label: '⌨ Type', run: () => typeText(ctx) },
  ]);
  ctx.status('Browser');
}

// ---- live keyboard -------------------------------------------------------------------
// A text field gets focus on the page (the backend pushes info.focus) → the
// keyboard comes up, and each key goes straight into the page; focus leaves →
// it goes away again (if it came up by itself). ✕ dismisses it until focus
// moves to another field (or you tap the page again).

function syncKeyboard(ctx) {
  const b = ctx.browser;
  if (!ctx.keyboard || !b.alive || b.edit) return;
  const f = b.info.focus;
  const key = f ? `${b.info.url}|${f.kind}|${f.label}` : null;
  if (key === b.focusKey) return;
  b.focusKey = key;
  if (f && focused === ctx) openKeyboard(ctx, true);
  else if (!f && b.kbAuto) ctx.keyboard.close();
}

function openKeyboard(ctx, auto) {
  const b = ctx.browser;
  if (b.demo) return demoNote(ctx);
  const f = b.info.focus;
  b.kbAuto = auto;
  ctx.keyboard.open({
    label: f ? (f.label || (f.kind === 'search' ? 'Search' : 'Text field')) : `Typing into ${b.info.title || 'the page'}`,
    kind: f?.kind === 'search' || f?.kind === 'url' ? f.kind : 'text',
    secret: f?.kind === 'password',
    onKey: (ev) => queueKey(ctx, ev),
    onClose: () => { b.kbAuto = false; },
  });
}

// The keyboard's names → Chrome's ("Ctrl+C" → "Control+c").
function keyName(k) {
  return k.replace(/^Ctrl\+(.)$/, (_, c) => `Control+${c.toLowerCase()}`).replace(/^Ctrl\+/, 'Control+');
}

// Keys go out in order (consecutive text merged).
function queueKey(ctx, ev) {
  const b = ctx.browser;
  b.keys ??= [];
  const last = b.keys.at(-1);
  if (ev.text && last?.type === 'type') last.text += ev.text;
  else b.keys.push(ev.text != null ? { type: 'type', text: ev.text } : { type: 'key', key: keyName(ev.key) });
  if (!b.pumping) { b.pumping = true; queueMicrotask(() => { while (b.keys.length && b.alive) send(ctx, b.keys.shift()); b.pumping = false; }); }
}

async function typeText(ctx) {
  if (ctx.browser.demo) return demoNote(ctx);
  if (ctx.keyboard) return openKeyboard(ctx, false);
  const text = await ctx.prompt('Type', '');
  if (text) send(ctx, { type: 'type', text });
}
