// Background map capture (DESIGN.md §3.10): while a saved Space is lined
// up, take a depth snapshot now and then and send it to the server, which
// fuses everyone's snapshots into one map of the Space. On the Quest, also
// send the headset's room mesh (Space Setup) once.
//
// When: after you've moved (25 cm) or turned (12°) since the last snapshot,
// once you're steady (sharp, well-timed depth); otherwise every 3 s (1.5 s
// while the map is noticing changes here), so a cup picked up while you
// watch is gone from the map within seconds. Never more than one in flight.
// Pixel work happens in js/mapping/map-worker.js (phone CPU depth) or as one
// tiny GPU draw + async readback (Quest, js/mapping/depthgpu.js).
//
// Corrections: the server aligns each AR session to the map and answers with
// a correction; World applies it, so content sits where the map (everyone's
// view of the room) says it should.
//
//   const mapper = new Mapper({ world, renderer, device, log, quest: IS_QUEST });
//   requestSession({ ...Mapper.sessionInit(IS_QUEST) })     (merged with occlusion's)
//   mapper.start(session) · mapper.update(frame, refSpace, viewerPose, now) · mapper.stop()
import * as THREE from 'three';
import { GpuDepthReader } from './depthgpu.js';
import { telemetry } from '../telemetry.js';
import { uuid7 } from '../util.js';

const MIN_GAP_MS = 700;
const IDLE_MS = 3000;              // standing still: a fresh look this often (things change while you watch)
const IMAGE_EVERY_MS = 1000;      // phones: make a grayscale copy at most this often
const IMAGE_MAX_AGE_MS = 1500;    // a camera image this recent goes with the depth (it carries its own pose)
const IDLE_CHANGING_MS = 1500;     // ...this often while the map is noticing changes here
const CHANGING_FOR_MS = 20000;
const MOVED_M = 0.25;
const TURNED_DEG = 12;
const STEADY_DEG_S = 35;
const STEADY_M_S = 0.6;
const NEAR_SPACE_M = 10;           // only map near a Space's origin
const MESH_EVERY_MS = 5000;
const MESH_MAX_POINTS = 40000;
const HAND_JOINTS = ['wrist', 'thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip',
  'index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal', 'pinky-finger-phalanx-proximal',
  'thumb-phalanx-proximal', 'middle-finger-metacarpal'];

export class Mapper {
  static get wanted() { return localStorage.getItem('stratum.mapOn') !== '0'; }

  // Session features for mapping: depth (+ the room mesh on the Quest).
  // Phones prefer CPU depth (no readback); the Quest only has GPU depth.
  static sessionInit(quest) {
    if (!Mapper.wanted) return {};
    return {
      optionalFeatures: ['depth-sensing', ...(quest ? ['mesh-detection'] : [])],
      depthSensing: {
        usagePreference: quest ? ['gpu-optimized', 'cpu-optimized'] : ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32', 'unsigned-short'],
      },
    };
  }

  constructor({ world, renderer, device, log, quest }) {
    Object.assign(this, { world, renderer, device, log, quest });
    this.session = null;
    this.worker = null;
    this.gpu = null;
    this.stats = { sent: 0, failed: 0, meshes: 0, corrections: 0, lastError: '', gpuReads: 0 };
    this.state = 'off';
    this.last = null;          // { pos, fwd, at } of the last snapshot
    this.prev = null;          // last frame's head, for speed
    this.inFlight = 0;
    this.seq = 0;
    this.sentMeshes = new Set();
    this.lastMesh = 0;
    this.changedAt = new Map();   // space id → when the map last reported a change there
  }

  // The server noticed something appear or go ({"t": "map"} push): look more often for a while.
  noteChanges(spaceId, changes) {
    if (changes?.length) this.changedAt.set(spaceId, performance.now());
  }

  get note() {
    if (!Mapper.wanted) return 'Off';
    if (!this.session) return 'Builds a shared map while you look around';
    if (this.state === 'no-depth') return `No depth here: mapping surfaces only${this.stats.meshes ? ' + room mesh' : ''}`;
    if (this.state === 'no-space') return 'Waiting for a saved space (look at a tag)';
    if (this.stats.lastError && this.stats.failed > this.stats.sent) return `Not sending: ${this.stats.lastError}`;
    return `On · ${this.stats.sent} snapshot${this.stats.sent === 1 ? '' : 's'}${this.stats.corrections ? ' · lined up to the map' : ''}`;
  }

  start(session) {
    this.stop();
    if (!Mapper.wanted) return;
    this.session = session;
    this.sessionId = uuid7();
    this.depth = session.enabledFeatures?.includes('depth-sensing') ? session.depthUsage : null;
    this.gpu = this.depth === 'gpu-optimized' ? new GpuDepthReader(this.renderer) : null;
    this.state = this.depth ? 'waiting' : 'no-depth';
    this.last = this.prev = null;
    this.inFlight = 0;
    this.sentMeshes.clear();
    if (!this.worker) {
      this.worker = new Worker('/js/mapping/map-worker.js');
      this.worker.onmessage = (e) => this.onWorker(e.data);
    }
    telemetry.info('map capture', { depth: this.depth, format: session.depthDataFormat ?? null,
      mesh: !!session.enabledFeatures?.includes('mesh-detection') });
    this.statsTimer ??= setInterval(() => { if (this.session) telemetry.info('map capture stats', { ...this.stats, state: this.state }); }, 60000);
  }

  stop() {
    this.gpu?.dispose();
    this.gpu = null;
    this.session = null;
    this.state = 'off';
  }

  onWorker(m) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (m.type === 'sent') {
      if (m.kind === 'points') { this.stats.meshes++; return; }
      this.stats.sent++;
      if (m.res?.correction) this.applyCorrection(m.space, m.res.correction);
    } else if (m.type === 'failed') {
      this.stats.failed++;
      this.stats.lastError = m.status === 429 ? 'too fast' : m.status ? `${m.status}` : m.message;
      if (this.stats.failed === 1 || this.stats.failed % 50 === 0) this.log(`map upload failed (${m.status}): ${m.message}`);
    }
  }

  applyCorrection(spaceId, c) {
    const space = this.world.spaces.get(spaceId);
    if (!space) return;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...c.pose.p), new THREE.Quaternion(...c.pose.q), new THREE.Vector3(1, 1, 1));
    if (this.world.setCorrection(space, m)) this.stats.corrections++;
  }

  // The Space to map from here: aligned, saved, its origin near.
  spaceFor(head) {
    let best = null, bestD = NEAR_SPACE_M;
    for (const s of this.world.spaces.values()) {
      if (!s.aligned || s.temporary) continue;
      const d = new THREE.Vector3().setFromMatrixPosition(s.root.matrix).distanceTo(head);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  // How sure we are where the Space is: anchors (the device holds it) >
  // settled tag sightings > a few tag sightings.
  quality(space) {
    if (space.alignedBy?.includes('anchor')) return 1;
    if (space.fix?.settled) return 0.9;
    return space.fix ? Math.max(0.3, Math.min(0.8, space.fix.inliers / 15)) : 0.3;
  }

  update(frame, refSpace, viewerPose, now = performance.now()) {
    if (!this.session || !frame || !viewerPose) return;
    const done = this.gpu?.poll();
    if (done) this.send(done.meta, { kind: 'gpu', data: done.data, w: done.w, h: done.h, near: done.meta.near, far: done.meta.far });
    const head = new THREE.Matrix4().fromArray(viewerPose.transform.matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(head);
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(head);
    let speed = Infinity, turn = Infinity;
    if (this.prev) {
      const dt = Math.max(1e-3, (now - this.prev.at) / 1000);
      speed = pos.distanceTo(this.prev.pos) / dt;
      turn = THREE.MathUtils.radToDeg(fwd.angleTo(this.prev.fwd)) / dt;
    }
    this.prev = { pos, fwd, at: now };
    const space = this.spaceFor(pos);
    if (!space) { if (this.state !== 'no-depth') this.state = 'no-space'; return; }
    if (this.quest) this.meshes(frame, refSpace, space, now);
    if (!this.depth) return;
    this.state = 'mapping';
    if (space.gliding) return;   // the Space is moving onto a new alignment: wait until it's there
    if (this.inFlight || this.gpu?.busy) return;
    if (this.last && now - this.last.at < MIN_GAP_MS) return;
    const moved = !this.last || pos.distanceTo(this.last.pos) >= MOVED_M ||
      THREE.MathUtils.radToDeg(fwd.angleTo(this.last.fwd)) >= TURNED_DEG;
    const steady = turn < STEADY_DEG_S && speed < STEADY_M_S;
    const idle = now - (this.changedAt.get(space.id) ?? -Infinity) < CHANGING_FOR_MS ? IDLE_CHANGING_MS : IDLE_MS;
    if (!(moved && steady) && !(this.last && now - this.last.at >= idle && steady)) return;
    if (this.capture(frame, refSpace, viewerPose.views[0], space, now)) this.last = { pos, fwd, at: now };
  }

  // Space frame as this device saw it before any map correction (the server corrects).
  rawFromWorld(space) {
    return space.root.matrix.clone().multiply(space.correction ?? new THREE.Matrix4()).invert();
  }

  header(frame, refSpace, view, space, now) {
    const raw = this.rawFromWorld(space);
    const pose = raw.clone().multiply(new THREE.Matrix4().fromArray(view.transform.matrix));
    const p = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(view.transform.matrix));
    const floor = new THREE.Vector3(p.x, 0, p.z).applyMatrix4(raw);   // local-floor: y 0 = floor
    return {
      session: this.sessionId, device: this.device, source: this.quest ? 'quest-depth' : 'phone-depth',
      proj: Array.from(view.projectionMatrix), pose: pose.toArray(), floorY: floor.y, epoch: space.alignEpoch ?? 0,
      quality: this.quality(space), hands: this.hands(frame, refSpace, raw), at: Date.now(),
    };
  }

  // Tracked hands and held controllers (in depth they'd look like clutter).
  hands(frame, refSpace, raw) {
    const out = [];
    for (const src of this.session.inputSources ?? []) {
      if (src.hand && frame.getJointPose) {
        for (const name of HAND_JOINTS) {
          const j = src.hand.get(name);
          const jp = j && frame.getJointPose(j, refSpace);
          if (jp) out.push(new THREE.Vector3(jp.transform.position.x, jp.transform.position.y, jp.transform.position.z).applyMatrix4(raw).toArray().map((v) => +v.toFixed(3)));
        }
      } else if (src.gripSpace) {
        const gp = frame.getPose(src.gripSpace, refSpace);
        if (gp) out.push(new THREE.Vector3(gp.transform.position.x, gp.transform.position.y, gp.transform.position.z).applyMatrix4(raw).toArray().map((v) => +v.toFixed(3)));
      }
    }
    return out.slice(0, 64);
  }

  // The latest camera image (phone: the AR camera; Quest: the headset camera),
  // sent along with the next depth snapshot if it's fresh: visual SLAM
  // experiments (tools/slam). img: { gray, w, h, fx, fy, cx, cy, cameraWorld (Matrix4, ref space), time }.
  noteImage(img) {
    if (!Mapper.images) return;
    this.image = img;
    this.imageAt = img.time;
  }

  static get images() { return localStorage.getItem('stratum.mapImages') !== '0'; }

  // Worth making an image now? Only while mapping, and at most ~1/s: making
  // one costs main-thread pixel work on phones (the v34 lesson: no per-frame
  // pixel work on the render thread).
  wantsImage(now = performance.now()) {
    return Mapper.images && this.state === 'mapping' && now - (this.imageAt ?? -Infinity) >= IMAGE_EVERY_MS;
  }

  attachImage(header, space, now) {
    const im = this.image;
    if (!im || Math.abs(now - im.time) > IMAGE_MAX_AGE_MS) return;
    this.image = null;
    const pose = this.rawFromWorld(space).multiply(im.cameraWorld);
    header.img = { w: im.w, h: im.h, fx: im.fx, fy: im.fy, cx: im.cx, cy: im.cy, pose: pose.toArray(), dt: Math.round(now - im.time) };
    header._gray = im.gray;
    this.stats.images = (this.stats.images ?? 0) + 1;
  }

  capture(frame, refSpace, view, space, now) {
    if (!view) return false;
    try {
      const header = this.header(frame, refSpace, view, space, now);
      this.attachImage(header, space, now);
      if (this.depth === 'cpu-optimized') {
        const info = frame.getDepthInformation(view);
        if (!info) return false;
        header.ndc = ndcFromDepthUV(info.normDepthBufferFromNormView?.matrix);
        const fmt = this.session.depthDataFormat;
        const data = fmt === 'float32' ? new Float32Array(info.data.slice(0)) : new Uint16Array(info.data.slice(0));
        this.send({ ...header, space: space.id }, { kind: 'cpu', data, w: info.width, h: info.height, rawToMeters: info.rawValueToMeters });
        return true;
      }
      const binding = this.renderer.xr.getBinding?.() ?? (this.binding ??= new XRWebGLBinding(this.session, this.renderer.getContext()));
      const info = binding.getDepthInformation(view);
      if (!info?.texture) return false;
      header.ndc = [2, 0, -1, 0, 2, -1];   // GPU depth: rows bottom-up, same frame as the eye's view
      if (!this.gpuLogged) {
        this.gpuLogged = true;
        telemetry.info('map depth (gpu)', { w: info.width, h: info.height, near: info.depthNear, far: info.depthFar,
          type: info.textureType, layer: info.imageIndex ?? null, uv: Array.from(info.normDepthBufferFromNormView?.matrix ?? []).map((v) => +v.toFixed(3)) });
      }
      return this.gpu.request(info, { ...header, space: space.id, near: info.depthNear, far: info.depthFar });
    } catch (err) {
      this.stats.lastError = err.message;
      return false;
    }
  }

  send(meta, depth) {
    const { space, near, far, _gray: gray, ...header } = meta;
    this.inFlight++;
    const moved = [depth.data.buffer];
    if (gray) moved.push(gray.buffer);
    this.worker.postMessage({ type: 'depth', seq: ++this.seq, space, header, depth, gray }, moved);
  }

  // Quest: the headset's room mesh (Space Setup), once per mesh.
  meshes(frame, refSpace, space, now) {
    if (now - this.lastMesh < MESH_EVERY_MS || !frame.detectedMeshes?.size) return;
    this.lastMesh = now;
    const raw = this.rawFromWorld(space);
    for (const mesh of frame.detectedMeshes) {
      const v = mesh.vertices;
      if (!v?.length) continue;
      let sig = 0;
      for (let i = 0; i < Math.min(v.length, 90); i++) sig += v[i] * (i + 1);
      const key = `${this.device}:${mesh.semanticLabel ?? 'mesh'}:${v.length}:${sig.toFixed(2)}`;
      if (this.sentMeshes.has(key)) continue;
      const pose = frame.getPose(mesh.meshSpace, refSpace);
      if (!pose) continue;
      this.sentMeshes.add(key);
      const m = raw.clone().multiply(new THREE.Matrix4().fromArray(pose.transform.matrix));
      const n = v.length / 3, step = Math.max(1, Math.ceil(n / MESH_MAX_POINTS));
      const out = new Float32Array(Math.ceil(n / step) * 3);
      const p = new THREE.Vector3();
      for (let i = 0, j = 0; i < n; i += step, j += 3) {
        p.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).applyMatrix4(m);
        out[j] = p.x; out[j + 1] = p.y; out[j + 2] = p.z;
      }
      this.inFlight++;
      this.worker.postMessage({ type: 'points', seq: ++this.seq, space: space.id,
        header: { session: this.sessionId, device: this.device, source: 'quest-mesh', key, label: mesh.semanticLabel ?? null },
        points: out }, [out.buffer]);
    }
  }
}

// Depth pixel (s, t in 0..1, rows top-down as delivered) → view NDC (x, y):
// the inverse of normDepthBufferFromNormView (normalized view coords: top-left origin).
export function ndcFromDepthUV(matrix) {
  const M = new THREE.Matrix4();
  if (matrix) M.fromArray(matrix);
  const i = M.clone().invert().elements;
  // u = i0·s + i4·t + i12; v = i1·s + i5·t + i13; ndc.x = 2u − 1; ndc.y = 1 − 2v
  return [2 * i[0], 2 * i[4], 2 * i[12] - 1, -2 * i[1], -2 * i[5], 1 - 2 * i[13]];
}

// RGBA pixels → grayscale, at most maxW wide (box filter). → { gray, w, h, scale }
export function grayFromRGBA(data, w, h, maxW = 320) {
  const k = Math.max(1, Math.ceil(w / maxW));
  const ow = Math.floor(w / k), oh = Math.floor(h / k);
  const out = new Uint8Array(ow * oh);
  const px = new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let sum = 0;
      for (let dy = 0; dy < k; dy++) {
        let i = ((y * k + dy) * w + x * k) * 4;
        for (let dx = 0; dx < k; dx++, i += 4) sum += px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29;
      }
      out[y * ow + x] = sum / (256 * k * k);
    }
  }
  return { gray: out, w: ow, h: oh, scale: 1 / k };
}
