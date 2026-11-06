// Hand recording for gesture training (DESIGN.md §0, "Hand recording").
//
// While hands are tracked (Quest), every frame's two hands and head go into
// a 10 s chunk, gzipped and uploaded to /api/handrec; the server keeps them
// in data/handrec/. Everything else that happens alongside (every telemetry
// line: gesture detections and near-misses, shoo, Gesture Studio prompts,
// pinball flexes, drags, ...) and the browser's own select / squeeze events
// ride along in the same chunk as possible labels. Labelling is done later,
// offline (tools/handrec.py reads chunks into numpy).
//
//   const rec = new HandRecorder({ version, device, context: () => ({ apps }) });
//   rec.start(session) · each frame: rec.frame(now, hands, viewer) · rec.event(kind, data) · rec.stop()
//
// Chunk = gzip( u32 header length · header JSON · arrays ), arrays back to back:
//   t      Float32[n]          ms since header.t0Perf
//   head   Float32[n × 7]      position (m), quaternion xyzw (refSpace)
//   flags  Uint8[n]            bit 0 left hand tracked, bit 1 right
//   hands  Int16[n × 2 × 79]   per hand (left, right): 25 joints × xyz relative
//                              to the head in 0.1 mm, then the wrist
//                              quaternion xyzw × 32767 (zeros if not tracked)
// Frames with neither hand tracked aren't stored (t shows the gaps).
// Joints are WebXR XRHand order (wrist, thumb ×4, index ×5, middle ×5, ring ×5, little ×5).
import { telemetry } from './telemetry.js';

export const FORMAT = 'stratum-handrec', FORMAT_VERSION = 1;
const JOINTS = 25, PER_HAND = JOINTS * 3 + 4;
const CHUNK_MS = 10000, MAX_FRAMES = 1500;   // (10 s at up to 150 Hz)
const POS_SCALE = 10000;                      // 0.1 mm per unit: ±3.27 m around the head
const MAX_QUEUED = 12;                        // chunks kept while uploads fail (then the oldest go)

const rnd = (v, k = 1e4) => Math.round(v * k) / k;

export class HandRecorder {
  constructor({ version = '', device = '', context = () => ({}), url = '/api/handrec', post = null } = {}) {
    Object.assign(this, { version, device, context, url });
    this.post = post ?? ((q, body) => fetch(`${url}?${q}`, { method: 'POST', body, headers: { 'content-type': 'application/octet-stream', 'x-device': this.device }, credentials: 'same-origin' }));
    this.enabled = true;
    this.session = null;
    this.t = new Float32Array(MAX_FRAMES);
    this.head = new Float32Array(MAX_FRAMES * 7);
    this.flags = new Uint8Array(MAX_FRAMES);
    this.hands = new Int16Array(MAX_FRAMES * 2 * PER_HAND);
    this.queue = [];
    this.stats = { chunks: 0, frames: 0, bytes: 0, failed: 0, lastError: '' };
    this.unlisten = telemetry.listen((e) => { if (this.session && e.msg !== 'hand recording' && e.msg !== 'gesture label') this.events.push({ ts: e.t, kind: 'log', level: e.level, msg: e.msg, ...(e.data !== undefined && { data: e.data }) }); });
  }

  get recording() { return !!this.session && this.enabled; }

  start() {
    this.session = crypto.randomUUID();
    this.seq = 0;
    this.begin(performance.now());
  }

  stop() {
    if (!this.session) return;
    this.cut();
    this.session = null;
  }

  begin(now) {
    this.t0Perf = now;
    this.t0Epoch = Date.now();
    this.n = 0;
    this.events = [];
    this.radii = { left: null, right: null };
  }

  // A labelled moment from the app itself (an XR input event, a gesture, ...).
  event(kind, data) {
    if (this.recording) this.events.push({ ts: Date.now(), kind, ...data });
  }

  // hands: ui/hands.js HandView (tracked[side], hands[side].poses / radii); viewer: { position, quaternion }.
  frame(now, hands, viewer) {
    if (!this.recording || !viewer) return;
    if (now - this.t0Perf > CHUNK_MS || this.n >= MAX_FRAMES) this.cut(now);
    const L = !!hands?.tracked.left, R = !!hands?.tracked.right;
    if (!L && !R) return;
    const i = this.n++, hp = viewer.position, hq = viewer.quaternion;
    this.t[i] = now - this.t0Perf;
    this.head.set([hp.x, hp.y, hp.z, hq.x, hq.y, hq.z, hq.w], i * 7);
    this.flags[i] = (L ? 1 : 0) | (R ? 2 : 0);
    ['left', 'right'].forEach((side, k) => {
      const o = (i * 2 + k) * PER_HAND, h = hands.hands[side];
      if (!(k ? R : L) || !h) { this.hands.fill(0, o, o + PER_HAND); return; }
      const m = h.poses;
      for (let j = 0; j < JOINTS; j++) {
        this.hands[o + j * 3] = clamp16((m[j * 16 + 12] - hp.x) * POS_SCALE);
        this.hands[o + j * 3 + 1] = clamp16((m[j * 16 + 13] - hp.y) * POS_SCALE);
        this.hands[o + j * 3 + 2] = clamp16((m[j * 16 + 14] - hp.z) * POS_SCALE);
      }
      const q = quatOf(m);   // the wrist's orientation (joint 0)
      for (let c = 0; c < 4; c++) this.hands[o + JOINTS * 3 + c] = Math.round(q[c] * 32767);
      if (!this.radii[side] && h.radii) this.radii[side] = Array.from(h.radii, (r) => rnd(r));
    });
  }

  // End the chunk: package and upload it (async), start the next.
  cut(now = performance.now()) {
    const n = this.n, events = this.events;
    if (n || events.length) {
      const header = {
        format: FORMAT, version: FORMAT_VERSION, session: this.session, seq: this.seq++, device: this.device, app: this.version,
        ua: navigator.userAgent, t0Epoch: this.t0Epoch, t0Perf: rnd(this.t0Perf, 1e3), frames: n, joints: JOINTS, posScale: POS_SCALE,
        layout: ['t:f32', 'head:f32x7', 'flags:u8', `hands:i16x2x${PER_HAND}`], radii: this.radii, context: safeContext(this.context), events,
      };
      const parts = [this.t.slice(0, n), this.head.slice(0, n * 7), this.flags.slice(0, n), this.hands.slice(0, n * 2 * PER_HAND)];
      this.stats.frames += n;
      this.send(header, parts).catch(() => {});
    }
    this.begin(now);
  }

  async send(header, parts) {
    const json = new TextEncoder().encode(JSON.stringify(header));
    const len = new Uint32Array([json.length]);
    const raw = new Blob([len, json, ...parts]);
    const body = typeof CompressionStream === 'function'
      ? await new Response(raw.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
      : await raw.arrayBuffer();
    this.queue.push({ q: `session=${header.session}&seq=${header.seq}&gz=${typeof CompressionStream === 'function' ? 1 : 0}`, body });
    if (this.queue.length > MAX_QUEUED) this.queue.splice(0, this.queue.length - MAX_QUEUED);
    await this.drain();
  }

  async drain() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length) {
        const c = this.queue[0];
        const r = await this.post(c.q, c.body);
        if (!r.ok) {
          this.stats.failed++;
          this.stats.lastError = `${r.status}`;
          if (r.status === 507 || r.status === 413) { this.queue.shift(); this.full = r.status === 507; continue; }   // (full / too big: drop it)
          break;   // retry with the next chunk
        }
        this.queue.shift();
        this.stats.chunks++;
        this.stats.bytes += c.body.byteLength;
      }
    } catch (err) {
      this.stats.failed++;
      this.stats.lastError = err.message;
    } finally {
      this.sending = false;
    }
  }
}

function clamp16(v) { return v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v); }

function safeContext(fn) {
  try { return JSON.parse(JSON.stringify(fn() ?? {})); } catch { return {}; }
}

// Quaternion (xyzw) of a column-major 4×4 matrix's rotation (joint 0).
function quatOf(m) {
  const m11 = m[0], m12 = m[4], m13 = m[8], m21 = m[1], m22 = m[5], m23 = m[9], m31 = m[2], m32 = m[6], m33 = m[10];
  const tr = m11 + m22 + m33;
  let x, y, z, w;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); w = 0.25 / s; x = (m32 - m23) * s; y = (m13 - m31) * s; z = (m21 - m12) * s; }
  else if (m11 > m22 && m11 > m33) { const s = 2 * Math.sqrt(1 + m11 - m22 - m33); w = (m32 - m23) / s; x = 0.25 * s; y = (m12 + m21) / s; z = (m13 + m31) / s; }
  else if (m22 > m33) { const s = 2 * Math.sqrt(1 + m22 - m11 - m33); w = (m13 - m31) / s; x = (m12 + m21) / s; y = 0.25 * s; z = (m23 + m32) / s; }
  else { const s = 2 * Math.sqrt(1 + m33 - m11 - m22); w = (m21 - m12) / s; x = (m13 + m31) / s; y = (m23 + m32) / s; z = 0.25 * s; }
  return [x, y, z, w];
}
