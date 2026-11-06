// Quest headset camera worker (DESIGN.md §3.9): holds the newest camera
// frame and, only when asked, turns it into a brightness image at full
// resolution and finds tags in it. Keeps all pixel work off the main
// (render) thread.
//
// in:  { type: 'track', track }            the camera track itself (best: frames never touch the main thread)
//      { type: 'frame', frame, at }         a VideoFrame / ImageBitmap from the main thread (fallbacks)
//      { type: 'grab', seq }                process the newest frame
// out: { type: 'ready', path } · { type: 'result', seq, markers, width, height, at, ms, path } · { type: 'error', message }
//   at: when the frame arrived, epoch ms (performance.timeOrigin + now: same clock in both threads)
importScripts('/vendor/js-aruco2/cv.js', '/vendor/js-aruco2/aruco.js', '/vendor/js-aruco2/dictionaries/apriltag_36h11.js');

// The detector converts RGBA to gray first; we already have gray.
const rgbToGray = CV.grayscale;
CV.grayscale = (src, dst) => {
  if (!src.gray) return rgbToGray(src, dst);
  dst.data = src.gray; dst.width = src.width; dst.height = src.height;
  return dst;
};
const detector = new AR.Detector({ dictionaryName: 'APRILTAG_36h11', maxHammingDistance: 3 });

let latest = null;          // { frame (VideoFrame | ImageBitmap), at }
let path = 'none';
let canvas = null, g = null;
const now = () => performance.timeOrigin + performance.now();

function keep(frame, at) {
  latest?.frame.close?.();
  latest = { frame, at };
}

async function readTrack(track) {
  const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
  path = 'worker-track';
  postMessage({ type: 'ready', path });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    keep(value, now());      // newest only; older frames closed right away (no pixel copies)
  }
}

// Brightness (luma) of a frame, full resolution. YUV frames: the Y plane is
// it (no conversion). RGB frames: weighted sum. Anything else: draw it.
// Grayscale image → at most maxW wide (box filter).
function shrink(img, maxW) {
  const k = Math.max(1, Math.ceil(img.width / maxW));
  const w = Math.floor(img.width / k), h = Math.floor(img.height / k);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) { const r = (y * k + dy) * img.width + x * k; for (let dx = 0; dx < k; dx++) s += img.gray[r + dx]; }
      out[y * w + x] = s / (k * k);
    }
  }
  return { gray: out, w, h };
}

async function grayOf(frame) {
  const w = frame.displayWidth ?? frame.width, h = frame.displayHeight ?? frame.height;
  const fmt = frame.format;
  if (fmt && /^(I4|NV12)/.test(fmt)) {
    const buf = new Uint8Array(frame.allocationSize());
    const layout = await frame.copyTo(buf);
    const { offset, stride } = layout[0];
    if (stride === w) return { gray: buf.subarray(offset, offset + w * h), width: w, height: h };
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(buf.subarray(offset + y * stride, offset + y * stride + w), y * w);
    return { gray: out, width: w, height: h };
  }
  if (fmt && /^(RGB|BGR)/.test(fmt)) {
    const buf = new Uint8Array(frame.allocationSize());
    const layout = await frame.copyTo(buf);
    const { offset, stride } = layout[0];
    const bgr = fmt.startsWith('BGR');
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let i = offset + y * stride, j = y * w;
      for (let x = 0; x < w; x++, i += 4) out[j++] = bgr ? (buf[i + 2] * 77 + buf[i + 1] * 150 + buf[i] * 29) >> 8 : (buf[i] * 77 + buf[i + 1] * 150 + buf[i + 2] * 29) >> 8;
    }
    return { gray: out, width: w, height: h };
  }
  canvas ??= new OffscreenCanvas(w, h);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; g = null; }
  g ??= canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(frame, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < out.length; i += 4) out[j++] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return { gray: out, width: w, height: h };
}

onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'track') {
      readTrack(msg.track).catch((err) => postMessage({ type: 'error', message: `track: ${err.message}` }));
    } else if (msg.type === 'frame') {
      path = msg.path ?? 'main-frames';
      keep(msg.frame, msg.at ?? now());
    } else if (msg.type === 'grab') {
      const f = latest;
      if (!f) return postMessage({ type: 'result', seq: msg.seq, markers: [], width: 0, height: 0, at: now(), ms: 0, path, empty: true });
      const t0 = performance.now();
      const img = await grayOf(f.frame);
      const markers = detector.detect(img).map((m) => ({ id: m.id, hamming: m.hammingDistance, corners: m.corners.map((c) => [c.x, c.y]) }));
      const small = shrink(img, 320);   // for the map's visual SLAM experiments
      postMessage({ type: 'result', seq: msg.seq, markers, width: img.width, height: img.height, at: f.at, ms: performance.now() - t0, path, small },
        [small.gray.buffer]);
    }
  } catch (err) {
    postMessage({ type: 'error', message: err.message, seq: msg.seq });
  }
};
