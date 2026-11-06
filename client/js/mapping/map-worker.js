// Map uploads, off the main thread (DESIGN.md §3.10): turns a depth
// snapshot into millimeters, packs it (server/mapping/keyframe.py format),
// gzips and posts it. Also posts Quest room-mesh point sets.
//
// in:  { type: 'depth', seq, space, header, depth: { kind: 'cpu' | 'gpu', data, w, h, rawToMeters, near, far } }
//      { type: 'points', seq, space, header, points: Float32Array (x, y, z …) }
// out: { type: 'sent', seq, kind, space, res } · { type: 'failed', seq, kind, space, status, message }

const enc = new TextEncoder();

function pack(magic, header, payload) {
  const hb = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(8 + hb.length + payload.byteLength);
  out.set(enc.encode(magic), 0);
  new DataView(out.buffer).setUint32(4, hb.length, true);
  out.set(hb, 8);
  out.set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength), 8 + hb.length);
  return out;
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Depth → uint16 millimeters (0 = unknown), rows as given.
function millimeters(d) {
  const n = d.w * d.h, out = new Uint16Array(n), src = d.data;
  if (d.kind === 'gpu') {
    // Window depth in the eye's projection (near/far from the depth info).
    const near = d.near || 0.1, far = d.far;
    const finite = Number.isFinite(far) && far > near;
    for (let i = 0; i < n; i++) {
      const w = src[i];
      if (!(w > 0 && w < 0.99999)) continue;
      const ndc = 2 * w - 1;
      const z = finite ? (2 * near * far) / (far + near - ndc * (far - near)) : (2 * near) / (1 - ndc);
      out[i] = z > 0 && z < 60 ? Math.round(z * 1000) : 0;
    }
  } else {
    const k = (d.rawToMeters || 0.001) * 1000;
    for (let i = 0; i < n; i++) { const mm = src[i] * k; out[i] = mm > 0 && mm < 65535 ? Math.round(mm) : 0; }
  }
  return out;
}

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', body, credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' } });
  const text = await r.text();
  if (!r.ok) { const e = new Error(text.slice(0, 200)); e.status = r.status; throw e; }
  return JSON.parse(text);
}

let chain = Promise.resolve();
onmessage = ({ data: msg }) => {
  chain = chain.then(async () => {
    try {
      let res;
      if (msg.type === 'depth') {
        const mm = millimeters(msg.depth);
        let payload = mm;
        if (msg.gray && msg.header.img) {   // depth, then the grayscale image
          payload = new Uint8Array(mm.byteLength + msg.gray.length);
          payload.set(new Uint8Array(mm.buffer, mm.byteOffset, mm.byteLength), 0);
          payload.set(msg.gray, mm.byteLength);
        }
        const body = await gzip(pack('SKF1', { ...msg.header, v: 1, w: msg.depth.w, h: msg.depth.h }, payload));
        res = await post(`/api/spaces/${msg.space}/map/keyframes`, body);
      } else if (msg.type === 'points') {
        const body = await gzip(pack('SPT1', { ...msg.header, v: 1 }, msg.points));
        res = await post(`/api/spaces/${msg.space}/map/points`, body);
      } else return;
      postMessage({ type: 'sent', seq: msg.seq, kind: msg.type, space: msg.space, res });
    } catch (err) {
      postMessage({ type: 'failed', seq: msg.seq, kind: msg.type, space: msg.space, status: err.status ?? 0, message: err.message });
    }
  });
};
