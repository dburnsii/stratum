// Quest headset camera for tag tracking (DESIGN.md §3.9). The Quest Browser
// rejects WebXR camera-access but gives pages the passthrough camera through
// getUserMedia (the "Headset cameras" site permission), and keeps it running
// during immersive-ar. Nothing says where that camera is, what its lens is,
// or exactly when a frame was taken: a calibration supplies all three
// (vision/calibrate.js).
//
// Pixels never touch the main (render) thread when the browser allows it:
// a worker (questcam-worker.js) holds the newest frame and, only when asked,
// reads tags from its full-resolution brightness. Ways to get frames there,
// best first: the camera track itself, transferred to the worker; frames
// from a main-thread MediaStreamTrackProcessor, handed over without copying;
// a GPU-side ImageBitmap of a <video>. And frames are only processed when
// they're worth it (schedule()): after you've looked somewhere new, when a
// known tag should be in view, while calibrating, else about once a second
// (less once everything is lined up), preferring moments the head is steady.
//
//   const feed = await QuestCameraFeed.open();     // on the 2D page (it may prompt)
//   feed.onResult = (cap, markers) => tracker.addResult(cap, markers);
//   feed.head(now, viewerMatrix)                   // every XR frame
//   feed.tick(now, { calibrating, searching, known: [{ id, pos }], lastSeen: (id) => ms })
import * as THREE from 'three';

const STORE = 'stratum.questcam';            // calibration (localStorage, per headset)
const PREF_LABEL = 'stratum.questcamLabel';  // the camera to use (a calibration belongs to it)
const HEAD_KEEP_MS = 20000;                  // head poses kept (calibration looks back)
const DEFAULT_HFOV = 72 * Math.PI / 180;
const DEFAULT_LATENCY_MS = 60;
// Schedule (ms between processed frames).
const EVERY = { calibrating: 120, expected: 250, searching: 500, idle: 1000, settled: 3000, minGap: 150 };
const LOOKED_AWAY_DEG = 20, MOVED_M = 0.5;   // this much since the last frame: a new view, look now
const STEADY_DEG_S = 40, BLUR_DEG_S = 80;    // prefer frames when turning slower than this; wait out faster turns
const SETTLED_AFTER_MS = 20000;              // nothing new this long, everything aligned: slow down

export class QuestCameraFeed {
  // Ask for the camera (the 2D page: the prompt can't show inside AR).
  static async open() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no getUserMedia');
    const want = localStorage.getItem(PREF_LABEL);
    const constraints = (deviceId) => ({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }),
      width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } } });
    let stream = await navigator.mediaDevices.getUserMedia(constraints());
    // Same camera every time (a calibration belongs to one camera).
    if (want && stream.getVideoTracks()[0].label !== want) {
      const dev = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.label === want);
      if (dev) { stream.getTracks().forEach((t) => t.stop()); stream = await navigator.mediaDevices.getUserMedia(constraints(dev.deviceId)); }
    }
    const feed = new QuestCameraFeed(stream);
    await feed.ready;
    localStorage.setItem(PREF_LABEL, feed.label);
    return feed;
  }

  constructor(stream) {
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.label = this.track.label;
    const s = this.track.getSettings?.() ?? {};
    this.width = s.width ?? 1280; this.height = s.height ?? 960;
    this.heads = [];          // [{ t, m }] newest last (main-thread performance.now)
    this.calib = loadCalibration(this.label);
    this.onResult = null;     // (capture, markers) → void
    this.inFlight = null;     // { seq, at }
    this.seq = 0;
    this.last = { at: 0, q: null, p: null };   // last processed frame: when, head pose
    this.lastNew = performance.now();          // last time something new was seen
    this.stats = { grabs: 0, workerMs: 0, path: 'starting', reason: {} };
    this.worker = new Worker('/js/vision/questcam-worker.js');
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.ready = this.connect();
  }

  get size() { return { width: this.width, height: this.height }; }
  get calibrated() { return !!this.calib?.solved; }
  get path() { return this.stats.path; }

  // Best way to get frames to the worker that this browser allows.
  async connect() {
    const forced = window.__questcamPath;   // tests
    if (!forced || forced === 'worker-track') {
      try {
        const t = this.track.clone();
        const ok = new Promise((res) => { this.onPathReady = res; setTimeout(() => res(false), 1500); });
        this.worker.postMessage({ type: 'track', track: t }, [t]);
        if (await ok) return this.setPath('worker-track');
      } catch { /* not transferable here */ }
    }
    if ((!forced || forced === 'main-frames') && typeof MediaStreamTrackProcessor !== 'undefined') {
      this.reader = new MediaStreamTrackProcessor({ track: this.track, maxBufferSize: 1 }).readable.getReader();
      this.pump();
      return this.setPath('main-frames');
    }
    this.video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: this.stream });
    await this.video.play();
    return this.setPath('video-bitmap');
  }

  setPath(p) { this.stats.path = p; return p; }

  // main-frames: keep only the newest VideoFrame (no pixels copied here).
  async pump() {
    for (;;) {
      const { value, done } = await this.reader.read().catch(() => ({ done: true }));
      if (done) break;
      this.newest?.frame.close();
      this.newest = { frame: value, at: performance.timeOrigin + performance.now() };
    }
  }

  stop() {
    this.stream.getTracks().forEach((t) => t.stop());
    this.newest?.frame.close();
    this.worker.terminate();
  }

  // Viewer pose of an XR frame (main-thread performance.now).
  head(t, m) {
    this.heads.push({ t, m: m.clone() });
    while (this.heads.length > 2 && this.heads[0].t < t - HEAD_KEEP_MS) this.heads.shift();
  }

  // Head pose at time t (interpolated; clamped to what's kept).
  headAt(t) {
    const h = this.heads;
    if (!h.length) return null;
    if (t <= h[0].t) return h[0].m.clone();
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1], b = h[i], k = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 1;
        const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), s = new THREE.Vector3();
        a.m.decompose(pa, qa, s); b.m.decompose(pb, qb, s);
        return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), new THREE.Vector3(1, 1, 1));
      }
    }
    return h.at(-1).m.clone();
  }

  // How fast the head is turning (deg/s) and moving (m/s), over the ~100 ms
  // before time t (default: now).
  motion(t = Infinity) {
    const h = this.heads;
    if (h.length < 2) return { deg: 0, mps: 0 };
    let j = h.length - 1;
    while (j > 1 && h[j - 1].t >= t) j--;
    const b = h[j];
    let a = h[j - 1];
    for (let i = j - 1; i >= 0 && b.t - h[i].t < 100; i--) a = h[i];
    const dt = Math.max(1, b.t - a.t) / 1000;
    const qa = new THREE.Quaternion().setFromRotationMatrix(a.m), qb = new THREE.Quaternion().setFromRotationMatrix(b.m);
    const pa = new THREE.Vector3().setFromMatrixPosition(a.m), pb = new THREE.Vector3().setFromMatrixPosition(b.m);
    return { deg: (qa.angleTo(qb) * 180 / Math.PI) / dt, mps: pa.distanceTo(pb) / dt };
  }

  // Decide whether to process the newest frame now, and ask the worker if so.
  tick(now, ctx = {}) {
    if (this.inFlight || this.stats.path === 'starting' || !this.heads.length) return;
    const reason = this.schedule(now, ctx);
    if (reason) this.grab(now, reason);
  }

  schedule(now, { calibrating = false, searching = false, known = [], lastSeen = () => Infinity, aligned = false } = {}) {
    const since = now - this.last.at;
    if (since < EVERY.minGap) return null;
    const m = this.motion();
    const head = this.heads.at(-1).m;
    const q = new THREE.Quaternion().setFromRotationMatrix(head), p = new THREE.Vector3().setFromMatrixPosition(head);
    const turned = this.last.q ? q.angleTo(this.last.q) * 180 / Math.PI : 180;
    const moved = this.last.p ? p.distanceTo(this.last.p) : Infinity;
    const steady = m.deg < STEADY_DEG_S;
    const blurry = m.deg > BLUR_DEG_S && since < 3 * EVERY.idle;   // turning fast: wait for a sharp, well-timed frame
    if (calibrating) return since >= EVERY.calibrating && !blurry ? 'calibrating' : null;
    if (blurry) return null;
    if ((turned > LOOKED_AWAY_DEG || moved > MOVED_M) && steady) return 'new view';
    const expected = known.some((t) => now - lastSeen(t.id) > 2000 && this.inView(t.pos, head));
    if (expected && since >= EVERY.expected) return 'tag expected';
    if (searching && since >= EVERY.searching) return 'searching';
    const settled = aligned && now - this.lastNew > SETTLED_AFTER_MS;
    if (since >= (settled ? EVERY.settled : EVERY.idle)) return settled ? 'settled' : 'idle';
    return null;
  }

  // Would a world point be in the camera image (with some margin), 0.2–5 m away?
  inView(pos, head) {
    const c = this.calib ?? defaultCalibration(this.width, this.height);
    const cam = head.clone().multiply(new THREE.Matrix4().fromArray(c.extrinsic)).invert();
    const v = pos.clone().applyMatrix4(cam);
    const z = -v.z;
    if (z < 0.2 || z > 5) return false;
    const u = c.f * v.x / z + c.cx, w = c.f * -v.y / z + c.cy;
    return u > c.width * 0.08 && u < c.width * 0.92 && w > c.height * 0.08 && w < c.height * 0.92;
  }

  async grab(now, reason) {
    const seq = ++this.seq;
    this.inFlight = { seq, at: now };
    const head = this.heads.at(-1).m;
    this.last = { at: now, q: new THREE.Quaternion().setFromRotationMatrix(head), p: new THREE.Vector3().setFromMatrixPosition(head) };
    this.stats.reason[reason] = (this.stats.reason[reason] ?? 0) + 1;
    try {
      if (this.stats.path === 'main-frames') {
        const n = this.newest;
        this.newest = null;
        if (n) this.worker.postMessage({ type: 'frame', frame: n.frame, at: n.at, path: 'main-frames' }, [n.frame]);
      } else if (this.stats.path === 'video-bitmap' && this.video?.videoWidth) {
        const at = performance.timeOrigin + performance.now();
        const bmp = await createImageBitmap(this.video);   // GPU-side, async: no readback here
        this.worker.postMessage({ type: 'frame', frame: bmp, at, path: 'video-bitmap' }, [bmp]);
      }
      this.worker.postMessage({ type: 'grab', seq });
    } catch (err) {
      this.inFlight = null;
      console.warn('headset camera grab failed', err);
    }
  }

  onWorker(msg) {
    if (msg.type === 'ready') return this.onPathReady?.(true);
    if (msg.type === 'error') {
      if (/track/.test(msg.message)) return this.onPathReady?.(false);
      console.warn('headset camera worker:', msg.message);
      if (this.inFlight?.seq === msg.seq) this.inFlight = null;
      return;
    }
    if (msg.type !== 'result' || this.inFlight?.seq !== msg.seq) return;
    this.inFlight = null;
    if (msg.empty || !msg.width) return;
    this.stats.grabs++;
    this.stats.workerMs = this.stats.workerMs * 0.8 + msg.ms * 0.2;
    if (msg.width !== this.width || msg.height !== this.height) { this.width = msg.width; this.height = msg.height; }
    const cap = this.captureFor(msg);
    if (!cap) return;
    if (msg.small) cap.small = { gray: msg.small.gray, w: msg.small.w, h: msg.small.h, scale: msg.small.w / msg.width };
    if (msg.markers.length) this.noteSeen(msg.markers);
    this.onResult?.(cap, msg.markers);
  }

  // A worker result → a TagTracker capture: camera pose at the frame's time, lens.
  captureFor({ at, width, height, seq }) {
    const frameTime = at - performance.timeOrigin;   // this thread's clock
    const c = this.calib ?? defaultCalibration(width, height);
    const time = frameTime - (c.latencyMs ?? DEFAULT_LATENCY_MS);   // when the light hit the sensor
    const head = this.headAt(time);
    if (!head) return null;
    const sx = width / c.width, sy = height / c.height;
    return {
      seq, width, height, time,
      K: { fx: c.f * sx, fy: c.f * sy, cx: c.cx * sx, cy: c.cy * sy },
      cameraWorld: head.multiply(new THREE.Matrix4().fromArray(c.extrinsic)),
      // Head speed around the moment of the photo: the timing above is a
      // calibrated guess, so a moving head means a misplaced tag.
      motion: this.motion(time + 50),
      raw: { frameTime, hasCaptureTime: false },
    };
  }

  noteSeen(markers) {
    this.seen ??= new Set();
    for (const m of markers) if (!this.seen.has(m.id)) { this.seen.add(m.id); this.lastNew = performance.now(); }
  }

  setCalibration(c) {
    this.calib = { ...c, label: this.label, solved: true };
    localStorage.setItem(STORE, JSON.stringify(this.calib));
  }

  clearCalibration() {
    this.calib = null;
    localStorage.removeItem(STORE);
  }
}

// A reasonable guess before calibration: lens from a typical field of view,
// camera at the eyes, looking where you look.
export function defaultCalibration(width, height) {
  const f = width / (2 * Math.tan(DEFAULT_HFOV / 2));
  return { width, height, f, cx: width / 2, cy: height / 2, extrinsic: new THREE.Matrix4().toArray(), latencyMs: null, solved: false };
}

function loadCalibration(label) {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) || 'null');
    return c && c.label === label ? c : null;
  } catch { return null; }
}
