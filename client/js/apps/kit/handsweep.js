// Your tracked hands as a swept club: every finger bone and the palm are
// capsules, and contact is tested along the path each moved since the last
// frame, so a fast swing can't skip past a small ball between frames (hand
// tracking runs at the frame rate; a 3 m/s swing moves ~4 cm a frame, more
// than a golf ball is wide). The app applies the hit itself, from the speed
// of the part that struck. DESIGN.md §6.7.
//
//   import { HandSweep } from '/js/apps/kit/handsweep.js';
//   const club = new HandSweep(THREE);
//   each frame:  club.frame(ctx.hands(), dt);
//                const c = club.contact(center, radius);   // null, or { point, normal, velocity, side }
//                club.near(point) → closest distance of any hand part (Infinity if none)
const MAX_SAMPLES = 64;        // positions tested along a frame's motion: enough that no step is wider than half a contact
const JUMP_M = 0.35;           // the wrist farther than this from last frame: tracking jumped (no swing; a 6 m/s swing at 24 fps is 25 cm)
const FINGER_R = 0.009, PALM_R = 0.013;

// Bones (WebXR joint indices): each finger from its first knuckle to the tip,
// the thumb from its base, and the palm as a fan from the wrist plus the
// knuckle line.
const BONES = [];
for (const [a, n] of [[1, 3], [6, 3], [11, 3], [16, 3], [21, 3]]) for (let k = 0; k < n; k++) BONES.push([a + k, a + k + 1, FINGER_R]);
for (const k of [6, 11, 16, 21]) BONES.push([0, k, PALM_R]);
BONES.push([6, 21, PALM_R], [1, 6, PALM_R]);

export class HandSweep {
  constructor(THREE) {
    this.T = THREE;
    this.prev = { left: null, right: null };
    this.cur = { left: null, right: null };
    this.dt = 1 / 72;
    this.scale = 1;
    this.jumps = 0;
  }

  // hands = ctx.hands() (instance frame) or null; dt = seconds since last frame.
  frame(hands, dt) {
    this.dt = Math.max(1e-3, dt || this.dt);
    this.scale = hands?.left?.scale ?? hands?.right?.scale ?? this.scale;
    for (const side of ['left', 'right']) {
      const j = hands?.[side]?.joints ?? null;
      const before = this.cur[side];
      this.cur[side] = j ? j.map((p) => p.clone()) : null;
      // A big jump (tracking lost and found) isn't a swing: start over from here.
      const jumped = before && j && before[0].distanceTo(j[0]) > JUMP_M * this.scale;
      if (jumped) this.jumps++;
      this.prev[side] = !j ? null : before && !jumped ? before : this.cur[side];
    }
  }

  near(point) {
    let best = Infinity;
    for (const side of ['left', 'right']) {
      const j = this.cur[side];
      if (!j) continue;
      for (const [a, b] of BONES) best = Math.min(best, segDist(this.T, point, j[a], j[b]).d);
    }
    return best;
  }

  // First contact between a sphere (center, radius; not moving this frame)
  // and the hand's motion this frame: where, the outward normal (hand →
  // sphere), and that part's velocity.
  contact(center, radius) {
    const T = this.T, a = new T.Vector3(), b = new T.Vector3(), pa = new T.Vector3(), pb = new T.Vector3();
    let found = null;
    for (const side of ['left', 'right']) {
      const cur = this.cur[side], prev = this.prev[side];
      if (!cur || !prev) continue;
      // Cheap reject: the hand's wrist both frames far away.
      if (Math.min(cur[0].distanceTo(center), prev[0].distanceTo(center)) > 0.35 * this.scale) continue;
      // Steps no wider than half the contact distance, so the first touch is
      // found on the near side of the ball (a 5 m/s swing at 30 fps moves 17 cm a frame).
      let travel = 0;
      for (let i = 0; i < cur.length; i++) travel = Math.max(travel, cur[i].distanceTo(prev[i]));
      const steps = Math.min(MAX_SAMPLES, Math.max(4, Math.ceil(travel / (0.5 * (radius + FINGER_R * this.scale)))));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        let best = null;
        for (const [ia, ib, r] of BONES) {
          a.lerpVectors(prev[ia], cur[ia], t);
          b.lerpVectors(prev[ib], cur[ib], t);
          const q = segDist(T, center, a, b);
          const reach = radius + r * this.scale;
          if (q.d < reach && (!best || q.d - reach < best.gap)) best = { gap: q.d - reach, u: q.u, ia, ib, point: q.point.clone() };
        }
        if (!best) continue;
        // The struck point's velocity: the same spot on that bone, last frame → now.
        pa.lerpVectors(prev[best.ia], prev[best.ib], best.u);
        pb.lerpVectors(cur[best.ia], cur[best.ib], best.u);
        const velocity = pb.clone().sub(pa).divideScalar(this.dt);
        const normal = center.clone().sub(best.point);
        if (normal.lengthSq() < 1e-12) normal.copy(velocity);
        normal.normalize();
        found = { point: best.point, normal, velocity, side, t };
        break;
      }
      if (found) break;
    }
    return found;
  }

  // Fastest-moving joint of either hand this frame (m/s), for logging attempts.
  speed() {
    let best = 0;
    for (const side of ['left', 'right']) {
      const c = this.cur[side], p = this.prev[side];
      if (!c || !p) continue;
      for (let i = 0; i < c.length; i++) best = Math.max(best, c[i].distanceTo(p[i]) / this.dt);
    }
    return best / this.scale;
  }
}

function segDist(T, p, a, b) {
  const ab = b.clone().sub(a), l2 = ab.lengthSq();
  const u = l2 > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / l2)) : 0;
  const point = a.clone().addScaledVector(ab, u);
  return { d: point.distanceTo(p), u, point };
}
