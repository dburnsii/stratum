// Wall & Desk things that aren't paper: clocks, calendars, a thermometer and
// a weather forecast. Same frame as notes (face = XY plane, +Z out of the
// wall or table). Each kind: build(ctx) → { group, update(now), tap(hit),
// actions(), status(), menuLine(), dispose() }. Config lives in the instance
// config (shared): { kind, tz, place: { name, lat, lon }, days: { 'YYYY-MM-DD': text } }.
//
// Weather: Open-Meteo (free, no key; fetched by the device), one request per
// place and unit every 10 minutes, shared by every widget showing it.
let THREE;

export const WIDGETS = ['clock', 'digital', 'calendar', 'today', 'thermometer', 'weather'];
export const isWidget = (kind) => WIDGETS.includes(kind);
const FONT = '-apple-system, "Segoe UI", system-ui, Roboto, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const ZONES = [null, 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'];
const zoneName = (tz) => (tz ? tz.split('/').pop().replace(/_/g, ' ') : 'Local');
const WEATHER_MS = 10 * 60 * 1000;
export const WEATHER_API = { geo: 'https://geocoding-api.open-meteo.com/v1/search', forecast: 'https://api.open-meteo.com/v1/forecast' };

// ---- time --------------------------------------------------------------------------------------

const formats = new Map();   // time zone → formatter (making one is slow: not every frame)
function parts(ms, tz) {
  let f = formats.get(tz ?? '');
  if (!f) formats.set(tz ?? '', (f = new Intl.DateTimeFormat('en-US', { timeZone: tz ?? undefined, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short', hourCycle: 'h23' })));
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, ms: ms % 1000, wd: o.weekday };
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const h12 = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle?.startsWith('h1');

// ---- weather ----------------------------------------------------------------------------------

const cache = new Map();   // "lat,lon,unit" → { at, data, promise }
const keyOf = (place, unit) => `${place.lat.toFixed(3)},${place.lon.toFixed(3)},${unit}`;
// The fresh reading already in hand, if any (so a second widget shows it at once).
export function weatherNow(place, unit) {
  const hit = place && cache.get(keyOf(place, unit));
  return hit?.data && Date.now() - hit.at < WEATHER_MS ? hit.data : null;
}

export function weatherFor(place, unit) {
  const key = keyOf(place, unit);
  const hit = cache.get(key);
  if (hit && (hit.promise || Date.now() - hit.at < WEATHER_MS)) return hit.promise ?? Promise.resolve(hit.data);
  const q = new URLSearchParams({
    latitude: place.lat, longitude: place.lon, timezone: 'auto', forecast_days: '6',
    temperature_unit: unit === 'c' ? 'celsius' : 'fahrenheit', wind_speed_unit: unit === 'c' ? 'kmh' : 'mph',
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const promise = fetch(`${WEATHER_API.forecast}?${q}`).then((r) => { if (!r.ok) throw new Error(`weather ${r.status}`); return r.json(); })
    .then((data) => { cache.set(key, { at: Date.now(), data }); return data; })
    .catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { promise });
  return promise;
}

export async function findPlace(name) {
  const r = await fetch(`${WEATHER_API.geo}?${new URLSearchParams({ name, count: '1', language: 'en' })}`);
  const p = (await r.json()).results?.[0];
  return p ? { name: p.name, region: p.admin1 ?? p.country ?? '', lat: p.latitude, lon: p.longitude } : null;
}

// WMO weather codes → [emoji, words] (night: moon instead of sun).
function sky(code, day = 1) {
  const sun = day ? '☀️' : '🌙';
  if (code === 0) return [sun, day ? 'Sunny' : 'Clear'];
  if (code <= 2) return [day ? '🌤️' : '🌙', 'Partly cloudy'];
  if (code === 3) return ['☁️', 'Cloudy'];
  if (code <= 48) return ['🌫️', 'Fog'];
  if (code <= 57) return ['🌦️', 'Drizzle'];
  if (code <= 67) return ['🌧️', 'Rain'];
  if (code <= 77) return ['🌨️', 'Snow'];
  if (code <= 82) return ['🌧️', 'Showers'];
  if (code <= 86) return ['🌨️', 'Snow showers'];
  return ['⛈️', 'Thunderstorm'];
}

// ---- shared bits -------------------------------------------------------------------------------

function canvasFace(w, h, pxPerM = 2400) {
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(w * pxPerM), height: Math.round(h * pxPerM) });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, tex, g: canvas.getContext('2d') };
}

// A framed panel: the frame is the handle (hold it to move the thing); the face takes taps.
function framed(w, h, { depth = 0.012, color = 0x2b2f38, rim = 0.008, faceZ } = {}) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + rim * 2, h + rim * 2, depth), new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 }));
  frame.position.z = depth / 2;
  frame.userData.handle = true;
  const f = canvasFace(w, h);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: f.tex, roughness: 0.7 }));
  face.position.z = faceZ ?? depth + 0.0006;
  group.add(frame, face);
  return { group, face, frame, ...f };
}

function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
const disposeAll = (group) => group.traverse((n) => { n.geometry?.dispose(); [].concat(n.material ?? []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });

// ---- the kinds --------------------------------------------------------------------------------

const KINDS = {
  // A round wall clock: white face, numbers, ticks, black hands, a red sweep second hand.
  clock(ctx, cfg) {
    const R = 0.13, group = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R + 0.012, 0.035, 64, 1, true).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
    rim.position.z = 0.0175;
    const back = new THREE.Mesh(new THREE.CircleGeometry(R + 0.012, 64), new THREE.MeshStandardMaterial({ color: 0x23262d }));
    back.position.z = 0.001;
    for (const m of [rim, back]) m.userData.handle = true;
    const f = canvasFace(R * 2, R * 2, 4000);
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ map: f.tex, roughness: 0.6 }));
    face.position.z = 0.012;
    const glass = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.3, depthWrite: false }));
    glass.position.z = 0.03;
    glass.raycast = () => {};
    const hand = (len, wid, color, z, tail = 0.15) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(wid, len * (1 + tail), 0.002).translate(0, len * (1 - tail) / 2, 0), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
      m.position.z = z;
      m.raycast = () => {};
      return m;
    };
    const hh = hand(R * 0.52, 0.009, 0x15171c, 0.016), mh = hand(R * 0.78, 0.006, 0x15171c, 0.019), sh = hand(R * 0.86, 0.0022, 0xd6332f, 0.022, 0.22);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd6332f }));
    hub.position.z = 0.023;
    group.add(back, rim, face, hh, mh, sh, hub, glass);
    const drawFace = () => {
      const g = f.g, W = f.canvas.width, c = W / 2;
      g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, W, W);
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
        g.strokeStyle = '#1d2026'; g.lineWidth = big ? W * 0.012 : W * 0.004;
        g.beginPath(); g.moveTo(c + Math.sin(a) * c * (big ? 0.84 : 0.9), c - Math.cos(a) * c * (big ? 0.84 : 0.9)); g.lineTo(c + Math.sin(a) * c * 0.96, c - Math.cos(a) * c * 0.96); g.stroke();
      }
      g.fillStyle = '#1d2026'; g.font = `600 ${W * 0.1}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 1; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillText(String(i), c + Math.sin(a) * c * 0.7, c - Math.cos(a) * c * 0.7); }
      g.fillStyle = '#8a8f99'; g.font = `500 ${W * 0.045}px ${FONT}`;
      g.fillText(cfg.tz ? zoneName(cfg.tz) : '', c, c + c * 0.36);
      f.tex.needsUpdate = true;
    };
    drawFace();
    return {
      group, face,
      update(now) {
        const t = parts(now, cfg.tz), sec = t.s + t.ms / 1000;
        sh.rotation.z = -(sec / 60) * Math.PI * 2;
        mh.rotation.z = -((t.mi + sec / 60) / 60) * Math.PI * 2;
        hh.rotation.z = -(((t.h % 12) + t.mi / 60) / 12) * Math.PI * 2;
      },
      redraw: drawFace,
      status: (now) => { const t = parts(now, cfg.tz); return `${zoneName(cfg.tz)} ${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`; },
    };
  },

  // A small desk clock: big digits, the date under them.
  digital(ctx, cfg) {
    const w = 0.16, h = 0.075;
    const p = framed(w, h, { depth: 0.04, color: 0x17191e, rim: 0.006 });
    p.frame.position.y = 0;
    let shown = '';
    return {
      group: p.group, face: p.face,
      update(now) {
        const t = parts(now, cfg.tz), twelve = h12();
        const hr = twelve ? ((t.h + 11) % 12) + 1 : t.h;
        const key = `${hr}:${t.mi}:${t.s % 2}:${t.d}`;
        if (key === shown) return;
        shown = key;
        const g = p.g, W = p.canvas.width, H = p.canvas.height;
        g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#ff6b3d'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
        g.shadowColor = 'rgba(255,107,61,0.6)'; g.shadowBlur = H * 0.06;
        g.font = `700 ${H * 0.56}px ${FONT}`;
        const colon = t.s % 2 ? ' ' : ':';
        g.fillText(`${twelve ? hr : String(hr).padStart(2, '0')}${colon}${String(t.mi).padStart(2, '0')}`, W * (twelve ? 0.46 : 0.5), H * 0.64);
        g.shadowBlur = 0;
        if (twelve) { g.font = `600 ${H * 0.14}px ${FONT}`; g.fillText(t.h < 12 ? 'AM' : 'PM', W * 0.88, H * 0.34); }
        g.fillStyle = '#9aa0ab'; g.font = `500 ${H * 0.13}px ${FONT}`;
        g.fillText(`${t.wd} ${MONTHS[t.mo - 1].slice(0, 3)} ${t.d}${cfg.tz ? ` · ${zoneName(cfg.tz)}` : ''}`, W / 2, H * 0.88);
        p.tex.needsUpdate = true;
      },
      status: (now) => { const t = parts(now, cfg.tz); return `${zoneName(cfg.tz)} ${String(t.h).padStart(2, '0')}:${String(t.mi).padStart(2, '0')}`; },
    };
  },

  // A wall calendar: the month, today circled; tap a day to write on it.
  calendar(ctx, cfg) {
    const w = 0.3, h = 0.34;
    const p = framed(w, h, { depth: 0.004, color: 0xd9d4c7, rim: 0.004 });
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.012, 0.008), new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.5 }));
    hanger.position.set(0, h / 2 + 0.008, 0.006);
    hanger.userData.handle = true;
    p.group.add(hanger);
    const st = { offset: 0, day: null, grid: null };
    const draw = (now) => {
      const t = parts(now, cfg.tz);
      const m0 = new Date(Date.UTC(t.y, t.mo - 1 + st.offset, 1));
      const y = m0.getUTCFullYear(), mo = m0.getUTCMonth() + 1, first = m0.getUTCDay(), n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const g = p.g, W = p.canvas.width, H = p.canvas.height;
      g.fillStyle = '#fffdf7'; g.fillRect(0, 0, W, H);
      // A picture strip on top: a gradient by season.
      const season = [['#89c2ff', '#e7f1ff'], ['#9ad48a', '#f0fae8'], ['#ffcf6b', '#fff6dd'], ['#ff9f5b', '#ffe9d6']][Math.floor((mo % 12) / 3)];
      const sg = g.createLinearGradient(0, 0, 0, H * 0.3); sg.addColorStop(0, season[0]); sg.addColorStop(1, season[1]);
      g.fillStyle = sg; g.fillRect(0, 0, W, H * 0.3);
      g.fillStyle = '#1f2430'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      g.font = `700 ${H * 0.085}px ${SERIF}`; g.fillText(MONTHS[mo - 1], W * 0.06, H * 0.2);
      g.font = `500 ${H * 0.05}px ${FONT}`; g.fillStyle = '#4b5263'; g.fillText(String(y), W * 0.06, H * 0.27);
      const top = H * 0.34, cw = W / 7, ch = (H - top - H * 0.02) / 7;
      g.textAlign = 'center'; g.font = `600 ${ch * 0.32}px ${FONT}`; g.fillStyle = '#8a8f99';
      DAYS.forEach((d, i) => g.fillText(d.slice(0, 2), cw * (i + 0.5), top + ch * 0.55));
      st.grid = { top: top + ch * 0.8, cw, ch, first, n, y, mo };
      for (let d = 1; d <= n; d++) {
        const cell = first + d - 1, cx = cw * ((cell % 7) + 0.5), cy = top + ch * 0.8 + ch * (Math.floor(cell / 7) + 0.5);
        const isToday = st.offset === 0 && d === t.d, note = cfg.days?.[iso(y, mo, d)];
        if (isToday) { g.fillStyle = '#e03131'; g.beginPath(); g.arc(cx, cy - ch * 0.08, ch * 0.36, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = isToday ? '#fff' : cell % 7 === 0 ? '#c92a2a' : '#1f2430';
        g.font = `${isToday ? 700 : 500} ${ch * 0.38}px ${FONT}`;
        g.fillText(String(d), cx, cy);
        if (note) {
          g.fillStyle = '#1c7ed6'; g.font = `500 ${ch * 0.2}px ${FONT}`;
          g.fillText(note.length > 9 ? `${note.slice(0, 8)}…` : note, cx, cy + ch * 0.34, cw * 0.95);
        }
      }
      g.strokeStyle = 'rgba(0,0,0,0.08)'; g.lineWidth = 2;
      for (let r = 0; r <= 6; r++) { g.beginPath(); g.moveTo(0, top + ch * 0.8 + ch * r); g.lineTo(W, top + ch * 0.8 + ch * r); g.stroke(); }
      p.tex.needsUpdate = true;
      st.day = `${t.y}-${t.mo}-${t.d}:${st.offset}:${JSON.stringify(cfg.days ?? {})}`;
    };
    return {
      group: p.group, face: p.face,
      update(now) { const t = parts(now, cfg.tz); if (st.day !== `${t.y}-${t.mo}-${t.d}:${st.offset}:${JSON.stringify(cfg.days ?? {})}`) draw(now); },
      // Tap a day: write on it (empty clears it). The header: nothing.
      async tap(hit, api) {
        const gr = st.grid;
        if (!hit.uv || !gr) return;
        const x = hit.uv.x * p.canvas.width, y = (1 - hit.uv.y) * p.canvas.height;
        const row = Math.floor((y - gr.top) / gr.ch), col = Math.floor(x / gr.cw), d = row * 7 + col - gr.first + 1;
        if (row < 0 || d < 1 || d > gr.n) return;
        const key = iso(gr.y, gr.mo, d);
        const text = await api.prompt(`${MONTHS[gr.mo - 1]} ${d}`, cfg.days?.[key] ?? '');
        if (text == null) return;
        const days = { ...(cfg.days ?? {}) };
        if (text.trim()) days[key] = text.trim().slice(0, 60); else delete days[key];
        api.save({ days });
      },
      actions: (api) => [
        { label: '◀ Month', run: () => { st.offset--; st.day = null; } },
        { label: 'Month ▶', run: () => { st.offset++; st.day = null; } },
        ...(st.offset ? [{ label: 'Today', run: () => { st.offset = 0; st.day = null; } }] : []),
      ],
      status: (now) => { const t = parts(now, cfg.tz); return `${t.wd} ${MONTHS[t.mo - 1]} ${t.d}`; },
      upcoming: (now) => {
        const t = parts(now, cfg.tz), today = iso(t.y, t.mo, t.d);
        return Object.entries(cfg.days ?? {}).filter(([k]) => k >= today).sort()[0] ?? null;
      },
    };
  },

  // A tear-off desk calendar: weekday, the big date, the month.
  today(ctx, cfg) {
    const w = 0.1, h = 0.12;
    const p = framed(w, h, { depth: 0.03, color: 0x3a3f4a, rim: 0.005 });
    let shown = '';
    return {
      group: p.group, face: p.face,
      update(now) {
        const t = parts(now, cfg.tz), key = `${t.y}-${t.mo}-${t.d}`;
        if (key === shown) return;
        shown = key;
        const g = p.g, W = p.canvas.width, H = p.canvas.height;
        g.fillStyle = '#fffdf8'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#e03131'; g.fillRect(0, 0, W, H * 0.22);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `700 ${H * 0.12}px ${FONT}`; g.fillText(MONTHS[t.mo - 1].toUpperCase(), W / 2, H * 0.115);
        g.fillStyle = '#1f2430'; g.font = `700 ${H * 0.46}px ${SERIF}`; g.fillText(String(t.d), W / 2, H * 0.56);
        g.fillStyle = '#6b7280'; g.font = `500 ${H * 0.1}px ${FONT}`;
        g.fillText(DAYS[new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay()], W / 2, H * 0.86);
        p.tex.needsUpdate = true;
      },
      status: (now) => { const t = parts(now, cfg.tz); return `${t.wd} ${MONTHS[t.mo - 1]} ${t.d}`; },
    };
  },

  // An outdoor thermometer: a board with a scale, a glass tube, red liquid.
  thermometer(ctx, cfg, api) {
    const w = 0.07, h = 0.3, tubeH = h * 0.72, unit = api.unit();
    const [lo, hi] = unit === 'c' ? [-30, 50] : [-20, 120];
    const p = framed(w, h, { depth: 0.008, color: 0x9c6b3f, rim: 0.005 });
    const tubeY0 = -tubeH / 2 + h * 0.02;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, tubeH, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.05 }));
    glass.position.set(0, tubeY0 + tubeH / 2, 0.016);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.009, 20, 14), new THREE.MeshStandardMaterial({ color: 0xe03131, roughness: 0.3 }));
    bulb.position.set(0, tubeY0 - 0.004, 0.016);
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 1, 12).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xe03131, roughness: 0.3 }));
    liquid.position.set(0, tubeY0, 0.016);
    liquid.scale.y = 0.001;
    for (const m of [glass, bulb, liquid]) m.raycast = () => {};
    p.group.add(glass, bulb, liquid);
    const st = { value: null, target: null, place: null, err: '' };
    const draw = () => {
      const g = p.g, W = p.canvas.width, H = p.canvas.height;
      g.fillStyle = '#f4efe4'; g.fillRect(0, 0, W, H);
      const y0 = H * (0.5 - (tubeY0 / h)), y1 = H * (0.5 - (tubeY0 + tubeH) / h);
      g.strokeStyle = '#3b3f48'; g.fillStyle = '#3b3f48'; g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let v = lo; v <= hi; v += unit === 'c' ? 5 : 10) {
        const yy = y0 + (y1 - y0) * ((v - lo) / (hi - lo));
        g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.62, yy); g.lineTo(W * 0.74, yy); g.stroke();
        g.font = `600 ${W * 0.13}px ${FONT}`; g.fillText(String(v), W * 0.95, yy);
      }
      g.textAlign = 'center';
      g.font = `700 ${W * 0.16}px ${FONT}`; g.fillText(unit === 'c' ? '°C' : '°F', W * 0.5, H * 0.045);
      g.font = `700 ${W * 0.2}px ${FONT}`; g.fillStyle = '#c92a2a';
      g.fillText(st.value == null ? '—' : `${Math.round(st.value)}°`, W * 0.25, H * 0.045);
      g.fillStyle = '#6b7280'; g.font = `500 ${W * 0.1}px ${FONT}`;
      g.fillText(st.err || (cfg.place?.name ?? 'Tap: set the place'), W / 2, H * 0.975, W * 0.95);
      p.tex.needsUpdate = true;
    };
    const fetchNow = () => {
      if (!cfg.place) { st.err = ''; draw(); return; }
      weatherFor(cfg.place, unit).then((d) => { st.target = d.current.temperature_2m; st.err = ''; if (st.value == null) st.value = st.target; draw(); })
        .catch(() => { st.err = 'No weather right now'; draw(); });
    };
    const ready = weatherNow(cfg.place, unit);
    if (ready) { st.target = st.value = ready.current.temperature_2m; draw(); } else fetchNow();
    st.timer = setInterval(fetchNow, WEATHER_MS);
    return {
      group: p.group, face: p.face,
      update() {
        if (st.target == null) return;
        st.value += (st.target - st.value) * 0.05;   // the liquid creeps to the reading
        const k = Math.max(0, Math.min(1, (st.value - lo) / (hi - lo)));
        liquid.scale.y = Math.max(0.001, k * tubeH);
      },
      tap: () => (cfg.place ? null : api.choosePlace()),   // (to change it: 📍 in its menu)
      refetch: fetchNow,
      status: () => (st.target == null ? 'Thermometer' : `${Math.round(st.target)}° outside${cfg.place ? ` · ${cfg.place.name}` : ''}`),
      reading: () => st.target,
      dispose: () => clearInterval(st.timer),
    };
  },

  // A forecast panel: now (big), then the next five days.
  weather(ctx, cfg, api) {
    const w = 0.34, h = 0.2, unit = api.unit();
    const p = framed(w, h, { depth: 0.01, color: 0x1c2333, rim: 0.006 });
    const st = { data: null, err: '' };
    const draw = () => {
      const g = p.g, W = p.canvas.width, H = p.canvas.height, d = st.data;
      const day = d?.current?.is_day ?? 1;
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, day ? '#4a90d9' : '#1b2448'); bg.addColorStop(1, day ? '#9cc9f5' : '#3b4a7a');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.textBaseline = 'middle';
      if (!cfg.place || !d) {
        g.textAlign = 'center'; g.font = `600 ${H * 0.1}px ${FONT}`;
        g.fillText(!cfg.place ? 'Tap to set the place' : st.err || 'Getting the weather…', W / 2, H / 2);
        p.tex.needsUpdate = true;
        return;
      }
      const [icon, words] = sky(d.current.weather_code, day);
      g.textAlign = 'left';
      g.font = `${H * 0.28}px ${FONT}`; g.fillText(icon, W * 0.04, H * 0.27);
      g.font = `700 ${H * 0.26}px ${FONT}`; g.fillText(`${Math.round(d.current.temperature_2m)}°`, W * 0.24, H * 0.27);
      g.font = `600 ${H * 0.085}px ${FONT}`;
      g.fillText(cfg.place.name, W * 0.52, H * 0.17, W * 0.45);
      g.font = `500 ${H * 0.07}px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(`${words} · feels ${Math.round(d.current.apparent_temperature)}°`, W * 0.52, H * 0.28, W * 0.45);
      g.fillText(`H ${Math.round(d.daily.temperature_2m_max[0])}°  L ${Math.round(d.daily.temperature_2m_min[0])}°  · 💧${d.daily.precipitation_probability_max[0] ?? 0}%`, W * 0.52, H * 0.38, W * 0.45);
      // Next five days.
      const n = Math.min(5, d.daily.time.length - 1), cw = W / n;
      g.fillStyle = 'rgba(0,0,0,0.18)'; rr(g, W * 0.02, H * 0.5, W * 0.96, H * 0.46, H * 0.05); g.fill();
      g.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const k = i + 1, x = cw * (i + 0.5);
        const wd = DAYS[new Date(`${d.daily.time[k]}T12:00:00Z`).getUTCDay()].slice(0, 3);
        g.fillStyle = '#fff'; g.font = `600 ${H * 0.065}px ${FONT}`; g.fillText(wd, x, H * 0.58);
        g.font = `${H * 0.13}px ${FONT}`; g.fillText(sky(d.daily.weather_code[k])[0], x, H * 0.71);
        g.font = `600 ${H * 0.065}px ${FONT}`; g.fillText(`${Math.round(d.daily.temperature_2m_max[k])}°`, x, H * 0.83);
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `500 ${H * 0.055}px ${FONT}`; g.fillText(`${Math.round(d.daily.temperature_2m_min[k])}°`, x, H * 0.91);
      }
      p.tex.needsUpdate = true;
    };
    const fetchNow = () => {
      if (!cfg.place) { draw(); return; }
      weatherFor(cfg.place, unit).then((d) => { st.data = d; st.err = ''; draw(); }).catch(() => { st.err = 'No weather right now'; draw(); });
    };
    st.data = weatherNow(cfg.place, unit);
    draw();
    if (!st.data) fetchNow();
    st.timer = setInterval(fetchNow, WEATHER_MS);
    return {
      group: p.group, face: p.face,
      update() {},
      tap: () => (cfg.place ? null : api.choosePlace()),   // (to change it: 📍 in its menu)
      refetch: fetchNow,
      status: () => (st.data ? `${sky(st.data.current.weather_code, st.data.current.is_day)[0]} ${Math.round(st.data.current.temperature_2m)}° ${cfg.place.name}` : 'Weather'),
      data: () => st.data,
      dispose: () => clearInterval(st.timer),
    };
  },
};

// ---- the app side ------------------------------------------------------------------------------

export const LABELS = { clock: ['🕰️', 'Wall clock'], digital: ['⏰', 'Desk clock'], calendar: ['📅', 'Calendar'], today: ['📆', 'Day calendar'], thermometer: ['🌡️', 'Thermometer'], weather: ['⛅', 'Weather'] };

// api: { save(patch), prompt(label, value), unit(), choosePlace(), log(msg) }
export function buildWidget(T, ctx, cfg, api) {
  THREE = T;
  const w = KINDS[cfg.kind](ctx, cfg, api);
  const dispose = w.dispose;
  w.dispose = () => { dispose?.(); disposeAll(w.group); };
  return w;
}

// A sample for the place chooser (fixed time and weather).
export function previewWidget(T, kind) {
  THREE = T;
  const sample = { current: { temperature_2m: 68, apparent_temperature: 66, weather_code: 2, is_day: 1 },
    daily: { time: ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'], weather_code: [2, 0, 3, 61, 1, 0],
      temperature_2m_max: [71, 74, 66, 58, 63, 69], temperature_2m_min: [52, 55, 50, 46, 44, 50], precipitation_probability_max: [10, 0, 20, 80, 10, 0] } };
  const place = { name: 'Your town', lat: 0, lon: 0 };
  cache.set('0.000,0.000,f', { at: Date.now() + 1e12, data: sample });
  const cfg = { kind, place: kind === 'thermometer' || kind === 'weather' ? place : undefined };
  const api = { save() {}, prompt: async () => null, unit: () => 'f', choosePlace() {}, log() {} };
  const w = KINDS[kind]({}, cfg, api);
  const at = Date.UTC(2026, 9, 25, 14, 10, 30);
  w.update(at);
  setTimeout(() => { w.update(at); w.dispose?.(); }, 0);
  return w.group;
}

export { ZONES, zoneName };
