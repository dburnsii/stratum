// Home (Stratum app): Home Assistant controls you hang on your walls. Each
// instance controls one HA entity, chosen once from an in-world picker and
// saved in the instance config (shared with everyone who sees it). All HA
// traffic goes through the home backend, which holds the token.
//
// Variants (manifest): switch / button / display. The kind is chosen before
// placing (config.kind); the picker then only offers devices of that kind.
//
// Instance frame: wall-mounted, origin at the aim point, +Z out of the wall,
// y up, meters. The little tab under the plate is the grab handle (drag it to
// move); tapping the plate operates the device.
//
//   switch-like (light, switch, fan, input_boolean)  rocker + status light, tap toggles
//   push (scene, script, button)                     round button, tap activates
//   readout (sensor, binary_sensor, climate)         value + unit
//   media_player                                     readout, tap = play/pause
let THREE;

const POLL_MS = 240_000;            // re-fetch (and keep the backend's watch alive)
const PAGE = 8;                     // picker rows per page
const KIND = {
  light: 'switch', switch: 'switch', fan: 'switch', input_boolean: 'switch',
  scene: 'push', script: 'push', button: 'push',
  sensor: 'readout', binary_sensor: 'readout', climate: 'readout', media_player: 'readout',
};

const KIND_TITLE = { switch: 'Choose a light or switch', push: 'Choose a scene or button', readout: 'Choose a sensor or display' };

export default {
  // What each variant looks like (the platform shows it in the place chooser).
  preview(T, variant) {
    THREE = T;
    const h = { root: new THREE.Group() };
    const ctx = { home: h };
    const kind = { switch: 'switch', button: 'push', display: 'readout' }[variant] ?? 'switch';
    h.kind = kind;
    ({ switch: buildSwitch, push: buildPush, readout: buildReadout })[kind](ctx);
    if (kind === 'switch') {
      h.paddle.rotation.x = -0.14;
      const c = new THREE.Color(0xffc46b);
      h.led.material.color.copy(c); h.led.material.emissive.copy(c); h.led.material.emissiveIntensity = 1.4;
    } else if (kind === 'readout') {
      h.entity = 'sensor.preview';
      drawScreen(h, { state: '21.5', attrs: { unit_of_measurement: '°C' } });
    }
    return h.root;
  },

  async start(ctx) {
    THREE = ctx.THREE;
    ctx.home = { root: ctx.spawn(new THREE.Group()), entity: ctx.instance.config?.entity ?? null };
    (window.__home ??= new Map()).set(ctx.instance.id, ctx);   // test hook
    buildHandle(ctx);
    if (ctx.home.entity) await showControl(ctx);
    else await showPicker(ctx);
  },

  frame(ctx, dt) {
    const h = ctx.home;
    if (h.press > 0) {   // push-button travel
      h.press = Math.max(0, h.press - dt * 4);
      if (h.cap) h.cap.position.z = h.capZ - 0.004 * Math.sin(Math.min(1, h.press) * Math.PI);
    }
  },

  select(ctx, hit) {
    const h = ctx.home;
    if (h.picker) return pickerTap(ctx, hit.uv);
    if (h.entity && h.data) operate(ctx);
  },

  async stop(ctx) {
    clearInterval(ctx.home?.poll);
    window.__home?.delete(ctx.instance.id);
  },
};

// ---- picker ---------------------------------------------------------------------------

async function showPicker(ctx) {
  const h = ctx.home;
  clearControl(h);
  let list = [];
  try {
    list = (await ctx.backend.get('/entities')).entities;
  } catch (err) {
    return showMessage(ctx, errorText(err));
  }
  const kind = ctx.instance.config?.kind ?? null;   // chosen before placing: only devices of that kind
  h.picker = { all: kind ? list.filter((e) => (KIND[e.domain] ?? 'readout') === kind) : list, kind, filter: '', showAll: false, page: 0 };
  ctx.status('Home: choose a device');
  ctx.actions([
    { label: '🔍 Filter', run: async () => { const f = await ctx.prompt('Filter devices', h.picker?.filter ?? ''); if (f != null && h.picker) { h.picker.filter = f; h.picker.page = 0; drawPicker(ctx); } } },
    { label: '◀', run: () => turnPage(ctx, -1) },
    { label: '▶', run: () => turnPage(ctx, 1) },
  ]);
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 680 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22 * 680 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  mesh.position.z = 0.003;
  h.picker.canvas = canvas; h.picker.tex = tex; h.picker.mesh = mesh;
  h.root.add(mesh);
  h.handle.position.y = -0.17;   // grab tab under the panel
  drawPicker(ctx);
}

function shown(p) {
  const f = p.filter.trim().toLowerCase();
  return p.all.filter((e) => (p.showAll || e.state !== 'unavailable') && (!f || `${e.name} ${e.area} ${e.id}`.toLowerCase().includes(f)));
}

function turnPage(ctx, d) {
  const p = ctx.home.picker;
  if (!p) return;
  const pages = Math.max(1, Math.ceil(shown(p).length / PAGE));
  p.page = (p.page + d + pages) % pages;
  drawPicker(ctx);
}

const ROW_Y0 = 112, ROW_H = 62, FOOT_Y = 620;

function drawPicker(ctx) {
  const p = ctx.home.picker;
  const g = p.canvas.getContext('2d'), W = p.canvas.width, H = p.canvas.height;
  const items = shown(p);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  p.rows = items.slice(p.page * PAGE, p.page * PAGE + PAGE);
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(14,16,22,0.92)';
  g.beginPath(); g.roundRect(0, 0, W, H, 30); g.fill();
  g.fillStyle = '#fff'; g.font = '600 34px system-ui, sans-serif';
  g.fillText(KIND_TITLE[p.kind] ?? 'Choose a device', 26, 52);
  g.fillStyle = '#8a91a2'; g.font = '22px system-ui, sans-serif';
  g.fillText(`${items.length} ${p.filter ? `matching "${p.filter}"` : 'devices'} · page ${p.page + 1}/${pages}`, 26, 86);
  let lastArea = null;
  p.rows.forEach((e, i) => {
    const y = ROW_Y0 + i * ROW_H;
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.beginPath(); g.roundRect(16, y, W - 32, ROW_H - 8, 14); g.fill();
    g.fillStyle = e.state === 'unavailable' ? '#6b7280' : '#fff';
    g.font = '24px system-ui, sans-serif';
    g.fillText(`${icon(e)} ${e.name}`.slice(0, 34), 30, y + 26);
    g.fillStyle = '#8a91a2'; g.font = '18px system-ui, sans-serif';
    g.fillText(`${e.area !== lastArea && e.area ? `${e.area} · ` : ''}${valueText(e)}`.slice(0, 48), 30, y + 47);
    lastArea = e.area;
  });
  // Footer: ◀ · show unavailable · ▶
  const btn = (x, w, text, on = false) => {
    g.fillStyle = on ? '#3d6af2' : 'rgba(255,255,255,0.1)';
    g.beginPath(); g.roundRect(x, FOOT_Y, w, 46, 23); g.fill();
    g.fillStyle = '#fff'; g.font = '22px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(text, x + w / 2, FOOT_Y + 31); g.textAlign = 'left';
  };
  btn(16, 90, '◀'); btn(122, W - 244, p.showAll ? 'Showing all' : 'Hide unavailable', p.showAll); btn(W - 106, 90, '▶');
  p.tex.needsUpdate = true;
}

async function pickerTap(ctx, uv) {
  const p = ctx.home.picker;
  if (!p || !uv) return;
  const x = uv.x * p.canvas.width, y = (1 - uv.y) * p.canvas.height;
  if (y >= FOOT_Y) {
    if (x < 110) turnPage(ctx, -1);
    else if (x > p.canvas.width - 110) turnPage(ctx, 1);
    else { p.showAll = !p.showAll; p.page = 0; drawPicker(ctx); }
    return;
  }
  const i = Math.floor((y - ROW_Y0) / ROW_H);
  const e = p.rows?.[i];
  if (!e || y < ROW_Y0) return;
  ctx.setConfig({ ...ctx.instance.config, entity: e.id });
  ctx.home.entity = e.id;
  ctx.home.data = e;
  await showControl(ctx);
}

// ---- the control ------------------------------------------------------------------------

async function showControl(ctx) {
  const h = ctx.home;
  clearControl(h);
  if (h.channelFor !== h.entity) {   // live updates for this entity (the backend broadcasts on e-<entity id>)
    ctx.channel(`e-${h.entity}`, (msg) => { if (msg.type === 'state' && msg.entity) setState(ctx, msg.entity); });
    h.channelFor = h.entity;
  }
  try {
    const { states } = await ctx.backend.get(`/states?ids=${encodeURIComponent(h.entity)}`);
    h.data = { ...(h.data ?? {}), ...(states[h.entity] ?? { id: h.entity, state: 'unavailable', attrs: {} }) };
  } catch (err) {
    return showMessage(ctx, errorText(err));
  }
  h.poll = setInterval(() => ctx.backend.get(`/states?ids=${encodeURIComponent(h.entity)}`)
    .then(({ states }) => states[h.entity] && setState(ctx, states[h.entity])).catch(() => {}), POLL_MS);
  const domain = h.entity.split('.')[0];
  h.kind = KIND[domain] ?? 'readout';
  ({ switch: buildSwitch, push: buildPush, readout: buildReadout })[h.kind](ctx);
  buildLabel(ctx);
  ctx.actions([
    ...(domain === 'light' ? [{ label: '☀−', run: () => call(ctx, 'turn_on', { brightness_step_pct: -20 }) }, { label: '☀+', run: () => call(ctx, 'turn_on', { brightness_step_pct: 20 }) }] : []),
    { label: '⇄ Change device', run: () => { ctx.setConfig({ ...ctx.instance.config, entity: null }); h.entity = null; h.data = null; showPicker(ctx); } },
  ]);
  render(ctx);
}

function clearControl(h) {
  clearInterval(h.poll);
  h.poll = null;
  for (const k of ['control', 'label', 'message']) { h[k]?.removeFromParent(); h[k] = null; }
  if (h.picker) { h.picker.mesh.removeFromParent(); h.picker = null; }
  h.cap = null;
}

function setState(ctx, s) {
  const h = ctx.home;
  if (!h.data || s.id !== h.entity) return;
  h.data = { ...h.data, ...s };
  render(ctx);
}

async function operate(ctx) {
  const h = ctx.home;
  const domain = h.entity.split('.')[0];
  if (h.data.state === 'unavailable') return ctx.log(`${h.data.attrs?.friendly_name ?? h.entity} is unavailable`);
  if (h.kind === 'switch') {
    const before = h.data.state;
    h.data = { ...h.data, state: before === 'on' ? 'off' : 'on' };   // optimistic; the broadcast confirms
    render(ctx);
    if (!(await call(ctx, 'toggle'))) { h.data = { ...h.data, state: before }; render(ctx); }
  } else if (h.kind === 'push') {
    h.press = 1;
    call(ctx, domain === 'button' ? 'press' : 'turn_on');
  } else if (domain === 'media_player') {
    call(ctx, 'media_play_pause');
  }
}

async function call(ctx, action, extra = {}) {
  try {
    await ctx.backend.post('/call', { entity: ctx.home.entity, action, ...extra });
    return true;
  } catch (err) {
    ctx.log(errorText(err));
    return false;
  }
}

// ---- visuals ----------------------------------------------------------------------------

function plateGeometry(w, hgt, depth = 0.006, r = 0.008) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -hgt / 2);
  s.lineTo(w / 2 - r, -hgt / 2); s.quadraticCurveTo(w / 2, -hgt / 2, w / 2, -hgt / 2 + r);
  s.lineTo(w / 2, hgt / 2 - r); s.quadraticCurveTo(w / 2, hgt / 2, w / 2 - r, hgt / 2);
  s.lineTo(-w / 2 + r, hgt / 2); s.quadraticCurveTo(-w / 2, hgt / 2, -w / 2, hgt / 2 - r);
  s.lineTo(-w / 2, -hgt / 2 + r); s.quadraticCurveTo(-w / 2, -hgt / 2, -w / 2 + r, -hgt / 2);
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 3, curveSegments: 6 });
}

const plateMat = () => new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 });

function buildSwitch(ctx) {
  const h = ctx.home;
  const g = (h.control = new THREE.Group());
  g.add(new THREE.Mesh(plateGeometry(0.07, 0.11), plateMat()));
  const paddle = new THREE.Mesh(plateGeometry(0.034, 0.058, 0.008, 0.005), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }));
  paddle.position.set(0, -0.004, 0.006);
  h.paddle = paddle;
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 20), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x000000 }));
  led.position.set(0, 0.04, 0.0081);
  h.led = led;
  g.add(paddle, led);
  h.root.add(g);
}

function buildPush(ctx) {
  const h = ctx.home;
  const g = (h.control = new THREE.Group());
  g.add(new THREE.Mesh(plateGeometry(0.08, 0.08), plateMat()));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.0215, 0.025, 40), new THREE.MeshStandardMaterial({ color: 0x3d6af2, emissive: 0x3d6af2, emissiveIntensity: 0.6 }));
  ring.position.z = 0.0076;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  h.capZ = 0.011;
  cap.position.z = h.capZ;
  h.cap = cap;
  h.led = ring;
  g.add(ring, cap);
  h.root.add(g);
}

function buildReadout(ctx) {
  const h = ctx.home;
  const g = (h.control = new THREE.Group());
  g.add(new THREE.Mesh(plateGeometry(0.11, 0.07), new THREE.MeshStandardMaterial({ color: 0x1b1e26, roughness: 0.3 })));
  const canvas = Object.assign(document.createElement('canvas'), { width: 440, height: 280 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.104, 0.064), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  screen.position.z = 0.0078;
  h.screen = { canvas, tex };
  g.add(screen);
  h.root.add(g);
}

function buildLabel(ctx) {
  const h = ctx.home;
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 96 });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14 * 96 / 512), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  const below = h.kind === 'switch' ? 0.055 : h.kind === 'push' ? 0.04 : 0.035;
  label.position.set(0, -below - 0.016, 0.002);
  h.labelTex = { canvas, tex };
  h.label = label;
  label.visible = ctx.settings?.get('labels') !== false;
  if (!h.labelsHooked) { h.labelsHooked = true; ctx.settings?.onChange((k) => { if (k === 'labels' && h.label) h.label.visible = ctx.settings.get('labels') !== false; }); }
  h.root.add(label);
  h.handle.position.y = -below - 0.04;
}

// The grab handle: a small tab under the control.
function buildHandle(ctx) {
  const h = ctx.home;
  const tab = new THREE.Mesh(new THREE.CapsuleGeometry(0.005, 0.03, 4, 12).rotateZ(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x9aa1b2, roughness: 0.5, transparent: true, opacity: 0.8 }));
  tab.position.set(0, -0.08, 0.004);
  tab.userData.handle = true;
  h.handle = tab;
  if (ctx.device !== 'phone') h.root.add(tab);   // phones: hold the control itself to move it
}

function render(ctx) {
  const h = ctx.home;
  const d = h.data;
  if (!d || !h.control) return;
  const off = d.state === 'unavailable';
  const on = d.state === 'on' || d.state === 'playing';
  if (h.kind === 'switch') {
    h.paddle.rotation.x = on ? -0.14 : 0.14;
    const c = on ? lightColor(d) : new THREE.Color(0x2a2d33);
    h.led.material.color.copy(c);
    h.led.material.emissive.copy(on ? c : new THREE.Color(0));
    h.led.material.emissiveIntensity = on ? 1.4 : 0;
  } else if (h.kind === 'push') {
    h.led.material.emissive.set(off ? 0x444444 : 0x3d6af2);
  } else {
    drawScreen(h, d);
  }
  h.control.traverse((n) => { if (n.material?.opacity !== undefined && n !== h.led) { n.material.transparent = off; n.material.opacity = off ? 0.55 : 1; } });
  drawLabel(h, d);
  ctx.status(`${d.attrs?.friendly_name ?? d.name ?? h.entity}: ${valueText(d)}`);
}

function lightColor(d) {
  const rgb = d.attrs?.rgb_color;
  const c = rgb ? new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : new THREE.Color(0xffc46b);
  if (d.attrs?.brightness != null) c.multiplyScalar(0.35 + 0.65 * (d.attrs.brightness / 255));
  return c;
}

function drawScreen(h, d) {
  const { canvas, tex } = h.screen;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const a = d.attrs ?? {};
  let big = d.state, small = a.unit_of_measurement ?? '';
  if (h.entity.startsWith('climate.')) { big = a.current_temperature != null ? `${a.current_temperature}°` : d.state; small = d.state; }
  else if (h.entity.startsWith('media_player.')) { big = d.state === 'playing' ? '▶' : d.state === 'paused' ? '❚❚' : '■'; small = a.media_title ?? d.state; }
  else if (h.entity.startsWith('binary_sensor.')) { big = d.state === 'on' ? '●' : '○'; small = a.device_class ?? ''; }
  else if (!Number.isNaN(Number(big)) && big !== '') big = String(Math.round(Number(big) * 10) / 10);
  g.fillStyle = d.state === 'unavailable' ? '#6b7280' : '#eaf2ff';
  g.font = '600 120px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(big).slice(0, 7), canvas.width / 2, 120, canvas.width - 30);
  g.fillStyle = '#8fa2c2'; g.font = '40px system-ui, sans-serif';
  g.fillText(String(small).slice(0, 24), canvas.width / 2, 225, canvas.width - 30);
  tex.needsUpdate = true;
}

function drawLabel(h, d) {
  const { canvas, tex } = h.labelTex;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = 'rgba(12,14,20,0.72)';
  g.beginPath(); g.roundRect(4, 8, canvas.width - 8, 80, 40); g.fill();
  g.fillStyle = '#fff'; g.font = '600 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${d.attrs?.friendly_name ?? d.name ?? h.entity}`.slice(0, 26), canvas.width / 2, 48, canvas.width - 40);
  tex.needsUpdate = true;
}

function showMessage(ctx, text) {
  const h = ctx.home;
  clearControl(h);
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 200 });
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(14,16,22,0.9)'; g.beginPath(); g.roundRect(0, 0, 512, 200, 26); g.fill();
  g.fillStyle = '#ffb4a8'; g.font = '26px system-ui, sans-serif';
  const words = text.split(' ');
  let line = '', y = 50;
  for (const w of words) {
    if (g.measureText(`${line} ${w}`).width > 460) { g.fillText(line, 26, y); line = w; y += 36; } else line = line ? `${line} ${w}` : w;
  }
  g.fillText(line, 26, y);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  h.message = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.078), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  h.root.add(h.message);
  ctx.status(`Home: ${text}`);
  ctx.actions([{ label: '↻ Retry', run: () => (h.entity ? showControl(ctx) : showPicker(ctx)) }]);
}

// ---- text helpers ------------------------------------------------------------------------

function icon(e) {
  const d = e.domain ?? e.id.split('.')[0];
  return { light: '💡', switch: '🔌', fan: '🌀', input_boolean: '◉', scene: '🎬', script: '📜', button: '🔘', sensor: '📈', binary_sensor: '◎', climate: '🌡', media_player: '🎵' }[d] ?? '•';
}

function valueText(e) {
  const u = e.attrs?.unit_of_measurement;
  if (e.id?.startsWith('climate.') && e.attrs?.current_temperature != null) return `${e.attrs.current_temperature}° · ${e.state}`;
  return u ? `${e.state} ${u}` : e.state;
}

function errorText(err) {
  const m = String(err?.message ?? err);
  if (m.includes('→ 403')) return m.split('→ 403 ')[1] ?? 'not allowed to use Home';
  if (m.includes('→ 503') || m.includes('→ 502')) return 'Home Assistant is not reachable right now';
  return m.slice(0, 160);
}
