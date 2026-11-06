// Play areas (DESIGN.md §6.7 "Play areas"): the player defines a game's
// space by pinching its corners on a flat level (a table, the floor, the
// ceiling): any polygon, concave is fine, not self-crossing. The outline
// and fill draw as corners go in. Apps keep the corners in their instance
// config; the helpers below fit a game to the shape.
//
//   import { PlayArea, pointIn, cellsInside } from '/js/apps/kit/playarea.js';
//   const a = new PlayArea(THREE, { y: 2.4, color: 0x9a8cff });
//   ctx.root.add(a.group);                 // instance frame (y up, meters)
//   a.add(rayLocal) → true if a corner went in (ray: { origin, dir } local)
//   a.undo(); a.setY(2.5); a.corners → [[x, z], …]; a.valid; a.dispose()
const MIN_GAP = 0.05;      // m between corners (a double pinch isn't two)

// Where a ray meets the level y (forward only), or null.
export function planeHit(ray, y) {
  const dy = ray.dir.y;
  if (Math.abs(dy) < 1e-4) return null;
  const t = (y - ray.origin.y) / dy;
  if (t <= 0) return null;
  return [ray.origin.x + ray.dir.x * t, ray.origin.z + ray.dir.z * t];
}

export function pointIn(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

function crosses(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

// Would closing the polygon (or adding p) make edges cross?
export function selfCrossing(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (crosses(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Distance from (x, z) to the outline.
export function edgeDistance(poly, x, z) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}

// Grid cells of `size` wholly inside the polygon (their 4 corners and centre in,
// and no edge crossing them): [{ c, r, x, z }] with x, z the cell centre.
export function cellsInside(poly, size) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs);
  const cols = Math.floor((Math.max(...xs) - x0) / size), rows = Math.floor((Math.max(...zs) - z0) / size);
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * size, z = z0 + (r + 0.5) * size, h = size / 2, e = h * 0.98;   // (a cell may touch the outline)
      const pts = [[x, z], [x - e, z - e], [x + e, z - e], [x + e, z + e], [x - e, z + e]];
      if (pts.every(([px, pz]) => pointIn(poly, px, pz)) && edgeDistance(poly, x, z) >= e) out.push({ c, r, x, z });
    }
  }
  return out;
}

export class PlayArea {
  constructor(THREE, { y = 0, color = 0x5b8def, minCorners = 3, corners = [] } = {}) {
    this.T = THREE;
    this.y = y;
    this.minCorners = minCorners;
    this.corners = corners.map((p) => [...p]);
    this.group = new THREE.Group();
    this.dotGeo = new THREE.SphereGeometry(1, 16, 10);
    this.dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
    this.lineMat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
    this.fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false });
    this.group.renderOrder = 960;
    this.draw();
  }

  get valid() { return this.corners.length >= this.minCorners && !selfCrossing(this.corners) && area(this.corners) > 0.01; }

  // Where a corner would go along this ray (the cursor dot), or null.
  aim(ray) {
    const p = planeHit(ray, this.y);
    return p ? new this.T.Vector3(p[0], this.y, p[1]) : null;
  }

  // A corner where the ray meets the level; refused if too close to another
  // corner or if it would make the outline cross itself.
  add(ray) {
    const p = planeHit(ray, this.y);
    if (!p) return false;
    if (this.corners.some((c) => Math.hypot(p[0] - c[0], p[1] - c[1]) < MIN_GAP)) return false;   // (pinching the first one again isn't a corner)
    const next = [...this.corners, p];
    if (next.length >= 4 && selfCrossing(next)) return false;
    this.corners = next;
    this.draw();
    return true;
  }

  undo() { this.corners.pop(); this.draw(); }
  clear() { this.corners = []; this.draw(); }
  setY(y) { this.y = y; this.draw(); }

  draw() {
    const T = this.T, g = this.group;
    for (const o of [...g.children]) { g.remove(o); if (o.geometry !== this.dotGeo) o.geometry?.dispose(); }
    const r = Math.max(0.012, Math.abs(this.y) * 0.012);   // bigger dots far away (the ceiling)
    for (const [x, z] of this.corners) {
      const d = new T.Mesh(this.dotGeo, this.dotMat);
      d.position.set(x, this.y, z);
      d.scale.setScalar(r);
      d.renderOrder = 962;
      d.raycast = () => {};
      g.add(d);
    }
    if (this.corners.length >= 2) {
      const pts = this.corners.map(([x, z]) => new T.Vector3(x, this.y, z));
      const line = new (this.corners.length >= 3 ? T.LineLoop : T.Line)(new T.BufferGeometry().setFromPoints(pts), this.lineMat);
      line.renderOrder = 961;
      line.raycast = () => {};
      g.add(line);
    }
    if (this.corners.length >= 3 && !selfCrossing(this.corners)) {
      const shape = new T.Shape(this.corners.map(([x, z]) => new T.Vector2(x, -z)));
      const fill = new T.Mesh(new T.ShapeGeometry(shape).rotateX(-Math.PI / 2), this.fillMat);
      fill.position.y = this.y;
      fill.renderOrder = 960;
      fill.raycast = () => {};
      g.add(fill);
    }
  }

  dispose() {
    this.group.removeFromParent();
    for (const o of this.group.children) if (o.geometry !== this.dotGeo) o.geometry?.dispose();
    this.dotGeo.dispose();
    for (const m of [this.dotMat, this.lineMat, this.fillMat]) m.dispose();
  }
}
