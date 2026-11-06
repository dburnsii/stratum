// Quest camera test (/questcam): does the Quest Browser give a page the
// passthrough camera (getUserMedia, "Headset cameras" permission) and does
// it keep coming during an immersive-ar session? If so, can the tag
// detector read printed tags in it? Everything is reported to telemetry
// (questcam: …) so it can be read from the server.
//
// In AR: a panel 0.8 m ahead shows the camera image, live stats and what
// the detector found; a square marks where a found tag would be, using a
// guessed camera (HFOV_GUESS, camera at the head) — how far off it lands is
// the first calibration clue.
import * as THREE from 'three';
import { telemetry } from './telemetry.js';
import { tagPoseCV, tagPoseWorld } from './vision/pose.js';

const HFOV_GUESS = 70 * Math.PI / 180;
const DETECT_EVERY_MS = 150, DETECT_LONG_SIDE = 960;
const TAG_M = (Number(localStorage.getItem('stratum.tagMm')) || 100) / 1000;
const $ = (id) => document.getElementById(id);
const lines = [];
const log = (msg, data) => { lines.push(msg); $('log').textContent = lines.slice(-40).join('\n'); telemetry.info(`questcam: ${msg}`, data); };

let stream = null, track = null;
const video = $('video');

// ---- 1. the camera -----------------------------------------------------------------------

async function listCameras() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  return devs.map((d, i) => ({ id: d.deviceId, label: d.label || `camera ${i + 1}` }));
}

async function openCamera(deviceId) {
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } } });
  track = stream.getVideoTracks()[0];
  video.srcObject = stream;
  await video.play();
  const settings = track.getSettings();
  const caps = track.getCapabilities?.() ?? {};
  log(`camera "${track.label}" ${settings.width}×${settings.height} @ ${settings.frameRate} fps`, {
    label: track.label, settings, caps: { width: caps.width, height: caps.height, frameRate: caps.frameRate, facingMode: caps.facingMode } });
}

$('cam').onclick = async () => {
  try {
    log(`browser: ${navigator.userAgent}`);
    log(`mediaDevices: ${!!navigator.mediaDevices?.getUserMedia}`);
    await openCamera();
    const cams = await listCameras();
    log(`${cams.length} camera(s): ${cams.map((c) => c.label).join(' | ')}`, { cams: cams.map((c) => c.label) });
    $('dev').replaceChildren(...cams.map((c) => Object.assign(document.createElement('option'), { value: c.id, textContent: c.label, selected: c.label === track.label })));
    $('dev').hidden = cams.length < 2;
    $('enter').disabled = false;
    measure2D();
  } catch (err) {
    log(`camera failed: ${err.name}: ${err.message}`, { name: err.name });
  }
};
$('dev').onchange = () => openCamera($('dev').value).catch((err) => log(`switch failed: ${err.message}`));

function measure2D() {
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 3000) video.requestVideoFrameCallback(tick); else log(`2D page: ${(n / 3).toFixed(1)} camera frames/s`); };
  video.requestVideoFrameCallback?.(tick);
}

// ---- 2. AR ------------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.domElement.className = 'xr';
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));

const panel = new THREE.Group();
const vtex = new THREE.VideoTexture(video);
vtex.colorSpace = THREE.SRGBColorSpace;
const view = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.36), new THREE.MeshBasicMaterial({ map: vtex }));
view.position.y = 0.1;
const statsCanvas = Object.assign(document.createElement('canvas'), { width: 1024, height: 300 });
const statsTex = new THREE.CanvasTexture(statsCanvas);
statsTex.colorSpace = THREE.SRGBColorSpace;
const stats = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48 * 300 / 1024), new THREE.MeshBasicMaterial({ map: statsTex, transparent: true }));
stats.position.y = -0.15;
const boxes = new THREE.Group();   // detected corners drawn over the camera image
view.add(boxes);
panel.add(view, stats);
scene.add(panel);
// Where a found tag would be (guessed camera): a green square outline.
const guess = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x * TAG_M / 2, 0, z * TAG_M / 2))),
  new THREE.LineBasicMaterial({ color: 0x3ddc97 }));
guess.matrixAutoUpdate = false;
guess.visible = false;
scene.add(guess);

const worker = new Worker('/js/vision/tag-worker.js');
const grab = document.createElement('canvas');
const g2 = grab.getContext('2d', { willReadFrequently: true });
const s = { frames: 0, lastTime: -1, detections: 0, submitted: 0, pending: null, lastDetect: 0, seq: 0, tags: [], samples: 0, t0: 0, lastReport: 0, workerMs: 0 };
let head = null;   // latest viewer pose (world matrix)

worker.onmessage = ({ data }) => {
  const cap = s.pending;
  s.pending = null;
  if (!cap || cap.seq !== data.seq) return;
  s.workerMs = data.ms;
  s.tags = data.markers.map((m) => ({ id: m.id, corners: m.corners }));
  drawBoxes(cap, data.markers);
  if (!data.markers.length) return;
  s.detections++;
  const m = data.markers[0];
  const K = { fx: cap.width / (2 * Math.tan(HFOV_GUESS / 2)), fy: cap.width / (2 * Math.tan(HFOV_GUESS / 2)), cx: cap.width / 2, cy: data.flipped ? cap.height / 2 : cap.height / 2 };
  const cv = tagPoseCV(m.corners, TAG_M, K);
  if (cv && cap.head) {
    guess.matrix.copy(tagPoseWorld(cv, cap.head));
    guess.matrixWorldNeedsUpdate = true;
    guess.visible = true;
  }
  // Raw samples for calibrating the camera later: corners + head pose at capture.
  if (s.samples < 40 && cap.head) {
    s.samples++;
    telemetry.info('questcam: sample', { id: m.id, corners: m.corners.map((c) => c.map((v) => +v.toFixed(1))), size: [cap.width, cap.height], flipped: data.flipped,
      head: cap.head.elements.map((v) => +v.toFixed(4)), ageMs: Math.round(cap.ageMs) });
  }
};

function drawBoxes(cap, markers) {
  boxes.clear();
  for (const m of markers) {
    const pts = m.corners.map(([x, y]) => new THREE.Vector3((x / cap.width - 0.5) * 0.48, (0.5 - y / cap.height) * 0.36, 0.002));
    boxes.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x3ddc97 })));
  }
}

function capture(now) {
  if (s.pending || now - s.lastDetect < DETECT_EVERY_MS || !video.videoWidth) return;
  s.lastDetect = now;
  const k = DETECT_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight);
  grab.width = Math.round(video.videoWidth * k); grab.height = Math.round(video.videoHeight * k);
  g2.drawImage(video, 0, 0, grab.width, grab.height);
  const img = g2.getImageData(0, 0, grab.width, grab.height);
  s.pending = { seq: ++s.seq, width: grab.width, height: grab.height, head: head?.clone() ?? null, ageMs: 0 };
  s.submitted++;
  worker.postMessage({ seq: s.seq, width: grab.width, height: grab.height, data: img.data.buffer }, [img.data.buffer]);
}

function drawStats(now) {
  const g = statsCanvas.getContext('2d');
  g.clearRect(0, 0, 1024, 300);
  g.fillStyle = 'rgba(12,14,20,0.85)'; g.beginPath(); g.roundRect(0, 0, 1024, 300, 28); g.fill();
  const secs = (now - s.t0) / 1000;
  const fps = secs > 0 ? s.frames / secs : 0;
  g.fillStyle = '#fff'; g.font = '600 40px system-ui';
  g.fillText(`camera frames in AR: ${s.frames} (${fps.toFixed(1)}/s)`, 30, 60);
  g.font = '32px system-ui'; g.fillStyle = '#c9cfdb';
  g.fillText(`${video.videoWidth}×${video.videoHeight} · "${track?.label ?? '?'}"`.slice(0, 60), 30, 115);
  g.fillText(`detector: ${s.submitted} runs, ${s.detections} with tags, ${s.workerMs | 0} ms`, 30, 170);
  g.fillStyle = s.tags.length ? '#3ddc97' : '#8a91a2';
  g.fillText(s.tags.length ? `seeing tag ${s.tags.map((t) => t.id).join(', ')}` : 'no tag in view', 30, 225);
  g.fillStyle = '#8a91a2'; g.font = '26px system-ui';
  g.fillText('green square = guessed tag position (uncalibrated)', 30, 275);
  statsTex.needsUpdate = true;
}

$('enter').onclick = async () => {
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    await renderer.xr.setSession(session);
    s.t0 = performance.now(); s.frames = 0;
    log('AR started', { videoPlaying: !video.paused, readyState: video.readyState });
    session.addEventListener('end', () => log(`AR ended: ${s.frames} camera frames, ${s.detections} detections`, { frames: s.frames, detections: s.detections, secs: (performance.now() - s.t0) / 1000 }));
    let placed = false;
    renderer.setAnimationLoop((t, frame) => {
      const now = performance.now();
      const pose = frame?.getViewerPose(renderer.xr.getReferenceSpace());
      if (pose) {
        head = new THREE.Matrix4().fromArray(pose.transform.matrix);
        if (!placed) {   // the panel: 0.8 m ahead, a little below eye level, facing you
          placed = true;
          const p = new THREE.Vector3().setFromMatrixPosition(head), q = new THREE.Quaternion().setFromRotationMatrix(head);
          const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q).setY(0).normalize();
          panel.position.copy(p).addScaledVector(fwd, 0.8).add(new THREE.Vector3(0, -0.15, 0));
          panel.lookAt(p.clone().setY(panel.position.y));
        }
      }
      if (video.currentTime !== s.lastTime) { s.lastTime = video.currentTime; s.frames++; capture(now); }
      if (now - s.lastReport > 3000) {
        s.lastReport = now;
        drawStats(now);
        telemetry.info('questcam: in AR', { frames: s.frames, fps: +(s.frames / ((now - s.t0) / 1000)).toFixed(1), size: [video.videoWidth, video.videoHeight],
          paused: video.paused, detections: s.detections, runs: s.submitted, tags: s.tags.map((x) => x.id), workerMs: s.workerMs });
      }
      renderer.render(scene, camera);
    });
  } catch (err) {
    log(`AR failed: ${err.message}`);
  }
};
