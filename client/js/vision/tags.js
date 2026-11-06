// Tag tracking: captures → worker detection → world poses → smoothing.
//
//   const tracker = new TagTracker({ sizeFor: (id) => 0.1 });
//   if (tracker.idle) tracker.submit(capture);
//   tracker.tags.get(0)  // { pose, raw, lastSeen, seen, firstSeen }
//
// `pose` is gravity-aligned (position + yaw) and smoothed over recent
// sightings; `raw` is the latest full 6-DoF pose (for drawing the outline).
import * as THREE from 'three';
import { tagPoseCV, tagPoseWorld, gravityAligned } from './pose.js';

const WINDOW_MS = 1500;      // sightings older than this don't count
const MAX_SIGHTINGS = 12;
const OUTLIER_M = 0.05;      // drop sightings this far from the mean

export class TagTracker {
  constructor({ sizeFor = () => 0.1, onFirstSeen = null } = {}) {
    this.sizeFor = sizeFor;
    this.onFirstSeen = onFirstSeen;
    this.tags = new Map();
    this.worker = new Worker('/js/vision/tag-worker.js');
    this.pending = null;      // capture awaiting a result
    this.stats = { submitted: 0, withTags: 0, workerMs: 0, flipped: null };
    this.worker.onmessage = (e) => this.onResult(e.data);
    this.worker.onerror = (e) => console.error('tag worker:', e.message);
  }

  get idle() { return this.pending === null; }

  submit(cap) {
    this.pending = cap;
    this.stats.submitted++;
    const { seq, width, height, data } = cap;
    this.worker.postMessage({ seq, width, height, data }, [data]);
  }

  onResult({ seq, markers, flipped, ms }) {
    const cap = this.pending;
    this.pending = null;
    if (!cap || cap.seq !== seq) return;
    this.stats.workerMs += ms;
    this.addResult(cap, markers, flipped);
  }

  // Markers found elsewhere (the Quest camera's own worker) for a capture
  // ({ width, height, K, cameraWorld, time }).
  addResult(cap, markers, flipped = false) {
    if (!flipped) this.onMarkers?.(cap, markers);   // raw corners (Quest camera calibration)
    if (!markers.length) return;
    this.stats.withTags++;
    this.stats.flipped = flipped;
    // Corners come from the image that decoded; mirror intrinsics to match.
    const K = flipped ? { ...cap.K, cy: cap.height - cap.K.cy } : cap.K;
    this.last = { K, width: cap.width, height: cap.height, flipped };
    for (const m of markers) {
      const cv = tagPoseCV(m.corners, this.sizeFor(m.id), K);
      if (cv) this.addSighting(m.id, tagPoseWorld(cv, cap.cameraWorld), cap.time, m, cap.motion);
    }
  }

  // motion: { deg, mps } of the head when the photo was taken, if known.
  addSighting(id, world, time, marker, motion = null) {
    let tag = this.tags.get(id);
    const isNew = !tag;
    if (!tag) {
      tag = { id, sightings: [], pose: new THREE.Matrix4(), raw: new THREE.Matrix4(), seen: 0, firstSeen: time, lastSeen: 0 };
      this.tags.set(id, tag);
    }
    tag.raw.copy(world);
    tag.lastSeen = time;
    tag.seen++;
    tag.corners = marker.corners;
    const g = gravityAligned(world);
    tag.mount = g.mount;
    tag.last = g.matrix;      // this sighting alone (gravity-aligned)
    tag.motion = motion;
    tag.sightings.push({ time, pos: new THREE.Vector3().setFromMatrixPosition(g.matrix), yaw: yawOf(g.matrix) });
    tag.sightings = tag.sightings.filter((s) => time - s.time <= WINDOW_MS).slice(-MAX_SIGHTINGS);
    smooth(tag);
    if (isNew) this.onFirstSeen?.(tag);
  }

  dispose() { this.worker.terminate(); }
}

function yawOf(m) {   // m is a pure Y rotation (+ translation)
  const x = new THREE.Vector3().setFromMatrixColumn(m, 0);
  return Math.atan2(-x.z, x.x);
}

// Mean position with one round of outlier rejection; circular mean of yaw.
function smooth(tag) {
  const mean = (list) => list.reduce((a, s) => a.add(s.pos), new THREE.Vector3()).divideScalar(list.length);
  let use = tag.sightings;
  const m0 = mean(use);
  const kept = use.filter((s) => s.pos.distanceTo(m0) <= OUTLIER_M);
  if (kept.length) use = kept;
  const pos = mean(use);
  const yaw = Math.atan2(
    use.reduce((a, s) => a + Math.sin(s.yaw), 0),
    use.reduce((a, s) => a + Math.cos(s.yaw), 0));
  tag.pose.makeRotationY(yaw).setPosition(pos);
}
