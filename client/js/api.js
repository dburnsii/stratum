// REST (cold data) + WebSocket (push). DESIGN.md §7.

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

export const api = {
  login: (name) => call('POST', '/api/login', { name }),
  me: () => call('GET', '/api/me'),
  spaces: (device) => call('GET', `/api/spaces?device=${device}`),
  createSpace: (body) => call('POST', '/api/spaces', body),
  addAnchor: (body) => call('POST', '/api/anchors', body),
  dropBinding: (anchorId, device) => call('DELETE', `/api/anchors/${anchorId}/binding?device=${device}`),
  objects: (space, since = 0) => call('GET', `/api/objects?space=${space}&since=${since}`),
  putObject: (o) => call('PUT', `/api/objects/${o.id}`, o),
  deleteObject: (id) => call('DELETE', `/api/objects/${id}`),
  addMarker: (space, marker) => call('POST', '/api/markers', { space, marker }),
  invite: (space) => call('POST', `/api/spaces/${space}/invite`),
  join: (code) => call('POST', '/api/join', { code }),
  leave: (space) => call('POST', `/api/spaces/${space}/leave`),
  deleteSpace: (space) => call('DELETE', `/api/spaces/${space}`),   // (its owner: for everyone)
  surfaces: (space) => call('GET', `/api/spaces/${space}/surfaces`),
  putSurface: (space, s) => call('PUT', `/api/spaces/${space}/surfaces/${s.id}`, s),
  replaceSurfaces: (space, source, surfaces, device) => call('POST', `/api/spaces/${space}/surfaces/replace`, { source, surfaces, device }),
  clearSurfaces: (space) => call('DELETE', `/api/spaces/${space}/surfaces`),
  // Living world map (DESIGN.md §3.10). Keyframes/point sets are posted by js/mapping/map-worker.js.
  map: (space, limit = 60000) => call('GET', `/api/spaces/${space}/map?limit=${limit}`),
  mapInfo: (space) => call('GET', `/api/spaces/${space}/map/info`),
  rebuildMap: (space) => call('POST', `/api/spaces/${space}/map/rebuild`),
  resetMap: (space) => call('DELETE', `/api/spaces/${space}/map`),
  assets: () => call('GET', '/api/assets'),
  apps: () => call('GET', '/api/apps'),
  setApp: (id, enabled) => call('PUT', `/api/apps/${id}`, { enabled }),
  setAppSettings: (id, values) => call('PUT', `/api/apps/${id}/settings`, values),
  clipboard: () => call('GET', '/api/clipboard'),
  setClipboard: (text) => call('PUT', '/api/clipboard', { text }),
  appState: (id, key) => call('GET', `/api/apps/${id}/state/${encodeURIComponent(key)}`),
  setAppState: (id, key, value) => call('PUT', `/api/apps/${id}/state/${encodeURIComponent(key)}`, { value }),
  async upload(file, { w, h } = {}) {
    const q = new URLSearchParams({ name: file.name, ...(w && { w }), ...(h && { h }) });
    const r = await fetch(`/api/assets?${q}`, { method: 'POST', body: file, credentials: 'same-origin' });
    if (!r.ok) throw new Error(`upload ${file.name} → ${r.status} ${await r.text()}`);
    return (await r.json()).asset;
  },
};

// WebSocket with reconnect. After every (re)subscribe the server replies
// "subbed" and the caller resyncs over REST with since=rev, so nothing pushed
// while disconnected is lost.
const PING_MS = 10000;
const DEAD_MS = 25000;

export class Live {
  constructor(handlers) {
    this.handlers = handlers;     // { obj(object), subbed(spaces), app(msg) }
    this.spaces = [];
    this.appChannels = [];        // [{ app, channel }]
    this.clockOffset = 0;         // serverTime - Date.now()
    this.backoff = 500;
    this.id = null;               // this connection's id (server-assigned; app room hosts, presence)
    this.heardAt = 0;             // last message from the server (watchdog)
    this.connect();
    // A socket can die without closing (Quest Browser after sleep or an AR
    // pause): ping, and if nothing comes back, reconnect (which resyncs).
    setInterval(() => this.watch(), PING_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.watch(true); });
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.backoff = 500;
      this.heardAt = performance.now();
      this.send({ t: 'sub', spaces: this.spaces });
      if (this.appChannels.length) this.send({ t: 'appsub', channels: this.appChannels });
    };
    ws.onmessage = (e) => {
      this.heardAt = performance.now();
      const msg = JSON.parse(e.data);
      if (msg.t === 'pong') return;
      if (msg.t === 'hello') { this.clockOffset = msg.serverTime - Date.now(); this.id = msg.you; this.user = msg.user; }
      else if (msg.t === 'obj') this.handlers.obj?.(msg.object);
      else if (msg.t === 'subbed') this.handlers.subbed?.(msg.spaces);
      else this.handlers[msg.t]?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;   // replaced by the watchdog
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10000);
    };
  }

  watch(woke = false) {
    const ws = this.ws;
    if (ws.readyState !== WebSocket.OPEN) return;
    if (performance.now() - this.heardAt > DEAD_MS || (woke && performance.now() - this.heardAt > PING_MS)) {
      this.reconnect();
      return;
    }
    this.send({ t: 'ping' });
  }

  reconnect() {
    const old = this.ws;
    import('./telemetry.js').then(({ telemetry }) => telemetry.info('live socket silent: reconnecting', { silentMs: Math.round(performance.now() - this.heardAt) })).catch(() => {});
    this.connect();
    try { old.close(); } catch { /* already gone */ }
  }

  send(msg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(spaces) {
    this.spaces = spaces;
    this.send({ t: 'sub', spaces });
  }

  // App channels (DESIGN.md §6): the full set to be in; resent on reconnect.
  setAppChannels(channels) {
    this.appChannels = channels;
    this.send({ t: 'appsub', channels });
  }

  sendApp(app, channel, msg) {
    this.send({ t: 'app', app, channel, msg });
  }

  now() {
    return Date.now() + this.clockOffset;
  }
}
