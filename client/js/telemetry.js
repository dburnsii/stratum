// Errors and log lines → POST /api/telemetry, batched, so problems on a phone
// or headset show up on the server (data/telemetry/*.jsonl). No imports on
// purpose: this must keep working when everything else fails to load.
//
//   import { telemetry } from './telemetry.js';
//   telemetry.setVersion('probe v5');
//   telemetry.info('placed cube', { n: 3 });   // also .warn / .error
//
// Uncaught errors, unhandled rejections, console.error/warn are captured
// automatically once this module has loaded.

const ENDPOINT = '/api/telemetry';
const MAX_QUEUE = 1000;
const BATCH = 200;
const FLUSH_MS = 2000;

const ctx = {
  page: location.pathname + location.search,
  version: '',
  load: crypto.randomUUID?.() ?? String(Math.random()).slice(2),
  device: localStorage.getItem('stratum.device') ?? '',
  ua: navigator.userAgent,
};
const queue = [];
let timer = null;
let sending = false;

const listeners = new Set();   // (the hand recorder keeps every log line as a possible label)
function event(level, msg, data) {
  const e = { t: Date.now(), level, msg: String(msg), ...(data !== undefined && { data: safe(data) }) };
  queue.push(e);
  for (const fn of listeners) { try { fn(e); } catch { /* never let a listener break logging */ } }
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);   // drop oldest
  schedule(level === 'error' ? 0 : FLUSH_MS);
}

// Data must survive JSON.stringify (no cycles, no DOM nodes, no BigInt).
function safe(data) {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return String(data);
  }
}

function schedule(ms) {
  if (timer !== null && ms > 0) return;
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

async function flush() {
  timer = null;
  if (sending || !queue.length) return;
  sending = true;
  const events = queue.splice(0, BATCH);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST', keepalive: true, credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ctx, events }),
    });
    if (!r.ok) throw new Error(r.status);
  } catch {
    queue.unshift(...events);   // retry later; never console.* here (it loops)
    if (queue.length > MAX_QUEUE) queue.length = MAX_QUEUE;
    sending = false;
    return schedule(10000);
  }
  sending = false;
  if (queue.length) schedule(0);
}

// Page going away (tab closed, app switched): last-chance send.
function beacon() {
  if (!queue.length) return;
  const body = new Blob([JSON.stringify({ ctx, events: queue.splice(0, BATCH) })], { type: 'application/json' });
  navigator.sendBeacon?.(ENDPOINT, body);
}
addEventListener('pagehide', beacon);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beacon(); });

addEventListener('error', (e) => event('error', e.message || 'error', {
  file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack,
}));
addEventListener('unhandledrejection', (e) => event('error', `unhandled rejection: ${e.reason?.message ?? e.reason}`, {
  stack: e.reason?.stack,
}));
for (const level of ['error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    orig(...args);
    event(level, args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(safe(a)))).join(' '),
      args.find((a) => a instanceof Error)?.stack && { stack: args.find((a) => a instanceof Error).stack });
  };
}

export const telemetry = {
  setVersion(v) { ctx.version = v; },
  setDevice(d) { ctx.device = d; },
  debug: (msg, data) => event('debug', msg, data),
  info: (msg, data) => event('info', msg, data),
  warn: (msg, data) => event('warn', msg, data),
  error: (msg, data) => event('error', msg, data),
  flush,
  listen(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
window.__telemetry = telemetry;
event('info', 'page load', { screen: [screen.width, screen.height, devicePixelRatio], xr: !!navigator.xr });
