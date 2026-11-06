// "Show the map": what the shared map believes is solid, drawn as small
// squares at each occupied voxel, colored by layer (structure blue,
// furniture orange, clutter pink, not sorted yet grey), fainter where it's less sure. The merged
// surfaces are drawn by RoomMap alongside. DESIGN.md §3.10.
//
//   const view = new MapView(world, log);
//   view.setVisible(on) · view.changed(spaceId) (on a {"t": "map"} push)
import * as THREE from 'three';
import { api } from '../api.js';

const REFRESH_MS = 4000;
const LAYER_COLORS = [new THREE.Color(0xff6ec7), new THREE.Color(0xffa94d), new THREE.Color(0x5c9dff), new THREE.Color(0xb0b8c4)];   // clutter, furniture, structure, unsorted

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class MapView {
  constructor(world, log) {
    this.world = world;
    this.log = log;
    this.visible = false;
    this.views = new Map();      // space id → { points, version, loading, last }
    this.material = new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, sizeAttenuation: true });
  }

  setVisible(on) {
    this.visible = on;
    if (on) for (const s of this.world.spaces.values()) if (!s.temporary) this.load(s.id);
    for (const v of this.views.values()) if (v.points) v.points.visible = on;
  }

  changed(spaceId) {
    if (!this.visible) return;
    const v = this.views.get(spaceId);
    const wait = v ? REFRESH_MS - (performance.now() - v.last) : 0;
    clearTimeout(v?.timer);
    if (wait > 0) { if (v) v.timer = setTimeout(() => this.load(spaceId), wait); return; }
    this.load(spaceId);
  }

  count(spaceId) { return this.views.get(spaceId)?.count ?? 0; }

  async load(spaceId) {
    const space = this.world.spaces.get(spaceId);
    if (!space || space.temporary) return;
    const v = this.views.get(spaceId) ?? { points: null, version: -1, loading: false, last: 0, count: 0 };
    this.views.set(spaceId, v);
    if (v.loading) return;
    v.loading = true;
    v.last = performance.now();
    try {
      const m = await api.map(spaceId, 60000);
      v.stats = m.stats;
      if (m.version === v.version && v.points) return;
      v.version = m.version;
      const ijk = new Int16Array(b64(m.ijk).buffer), layer = b64(m.layer), conf = b64(m.conf);
      const n = m.count, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 3; k++) pos[i * 3 + k] = (ijk[i * 3 + k] + 0.5) * m.voxel;
        const c = LAYER_COLORS[layer[i]] ?? LAYER_COLORS[0], a = 0.45 + 0.55 * (conf[i] / 255);
        col[i * 3] = c.r * a; col[i * 3 + 1] = c.g * a; col[i * 3 + 2] = c.b * a;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (v.points) { v.points.geometry.dispose(); v.points.removeFromParent(); }
      v.points = new THREE.Points(geo, this.material);
      v.points.frustumCulled = false;
      v.points.renderOrder = 5;
      v.points.visible = this.visible;
      v.count = n;
      space.root.add(v.points);
    } catch (err) {
      this.log(`error: map view: ${err.message}`);
    } finally {
      v.loading = false;
    }
  }

  clear(spaceId) {
    const v = this.views.get(spaceId);
    if (v?.points) { v.points.geometry.dispose(); v.points.removeFromParent(); }
    this.views.delete(spaceId);
  }
}
