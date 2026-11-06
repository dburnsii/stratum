// AprilTag 36h11 detection off the main thread (classic worker: js-aruco2
// is a classic script with globals).
//
// in:  { seq, width, height, data: ArrayBuffer (RGBA, row 0 = top) }
// out: { seq, markers: [{ id, corners: [[x, y] ×4], hamming }], flipped, ms }
//
// Camera texture orientation differs between platforms/browsers, and a
// vertically flipped image is a *mirrored* tag, which never decodes. So when
// nothing is found, also try the flipped image; once a flip works, keep it.
// A real tag only decodes in the true (unmirrored) image, so corners are
// reported in the coordinates of whichever image decoded; `flipped` tells
// the caller to mirror its intrinsics (cy → height - cy) to match.
importScripts('/vendor/js-aruco2/cv.js', '/vendor/js-aruco2/aruco.js', '/vendor/js-aruco2/dictionaries/apriltag_36h11.js');

const detector = new AR.Detector({ dictionaryName: 'APRILTAG_36h11', maxHammingDistance: 3 });
let preferFlip = false;

function flipRows(src, width, height) {
  const out = new Uint8ClampedArray(src.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) out.set(src.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  return out;
}

function detect(data, width, height, flip) {
  const img = { width, height, data: flip ? flipRows(data, width, height) : data };
  return detector.detect(img).map((m) => ({
    id: m.id,
    hamming: m.hammingDistance,
    corners: m.corners.map((c) => [c.x, c.y]),
  }));
}

onmessage = ({ data: msg }) => {
  const t0 = performance.now();
  const data = new Uint8ClampedArray(msg.data);
  let flipped = preferFlip;
  let markers = detect(data, msg.width, msg.height, flipped);
  if (!markers.length) {
    flipped = !flipped;
    markers = detect(data, msg.width, msg.height, flipped);
    if (markers.length) preferFlip = flipped;
  }
  postMessage({ seq: msg.seq, markers, flipped: markers.length ? flipped : null, ms: performance.now() - t0 });
};
