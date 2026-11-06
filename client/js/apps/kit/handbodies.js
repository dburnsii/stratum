// Your tracked hands as Rapier bodies, so app physics can be touched with
// them (golf: a flat hand or a finger is the club; Jenga: poke a block).
// Kinematic bodies: Rapier derives their speed from how they move, so a
// fast swing hits hard and a gentle nudge nudges. DESIGN.md §6.7.
//
//   import { HandBodies } from '/js/apps/kit/handbodies.js';
//   const hb = new HandBodies(R, world, THREE, { palm: true, tips: [4, 9, 14, 19, 24] });
//   each frame:   hb.frame(ctx.hands());               // where the hands are now
//   each substep: hb.step(k / n); world.step();        // glide there over the frame's substeps
//   hb.near(point) → closest distance (local units) of any hand part, Infinity if none
//   hb.owns(collider) → true if a collider is part of a hand
//   hb.free()
const FAR = { x: 0, y: -100, z: 0 };
const JUMP_M = 0.25;        // farther than this in one frame: tracking jumped, teleport (no hit)

export class HandBodies {
  constructor(R, world, THREE, { palm = true, tips = [4, 9, 14, 19, 24], tipR = 0.009, palmSize = [0.085, 0.1, 0.022], friction = 0.6, restitution = 0.3 } = {}) {
    this.R = R; this.world = world; this.THREE = THREE;
    this.parts = { left: [], right: [] };   // { body, collider, kind: 'palm' | joint index, from, to }
    this.handles = new Set();
    this.scale = 1;
    for (const side of ['left', 'right']) {
      if (palm) this.parts[side].push(this.add('palm', R.ColliderDesc.cuboid(palmSize[0] / 2, palmSize[1] / 2, palmSize[2] / 2), friction, restitution));
      for (const j of tips) this.parts[side].push(this.add(j, R.ColliderDesc.ball(tipR), friction, restitution));
    }
    this.sizes = { palmSize, tipR };
  }

  add(kind, desc, friction, restitution) {
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(FAR.x, FAR.y, FAR.z));
    const collider = this.world.createCollider(desc.setFriction(friction).setRestitution(restitution), body);
    this.handles.add(collider.handle);
    return { body, collider, kind, from: null, to: null, shown: false };
  }

  // hands = ctx.hands() (or null). Rescales colliders if the instance was resized.
  frame(hands) {
    const T = this.THREE;
    const scale = hands?.left?.scale ?? hands?.right?.scale ?? this.scale;
    if (Math.abs(scale - this.scale) > 1e-3) this.rescale(scale);
    for (const side of ['left', 'right']) {
      const h = hands?.[side];
      for (const part of this.parts[side]) {
        const to = !h ? null : part.kind === 'palm'
          ? { p: h.palm.position.clone(), q: h.palm.quaternion.clone() }
          : { p: h.joints[part.kind].clone(), q: new T.Quaternion() };
        const jumped = !to || !part.to || part.to.p.distanceTo(to.p) > JUMP_M * this.scale;
        part.from = jumped ? to : part.to;
        part.to = to;
        if (!to) { part.body.setTranslation(FAR, true); part.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
        else if (jumped) { part.body.setTranslation(to.p, true); part.body.setRotation(to.q, true); }   // appeared: no hit
      }
    }
  }

  // Before each physics substep: k = how far through this frame (0..1].
  step(k) {
    for (const side of ['left', 'right']) {
      for (const part of this.parts[side]) {
        if (!part.to || !part.from) continue;
        const p = part.from.p.clone().lerp(part.to.p, k), q = part.from.q.clone().slerp(part.to.q, k);
        part.body.setNextKinematicTranslation(p);
        part.body.setNextKinematicRotation(q);
      }
    }
  }

  rescale(scale) {
    const { palmSize, tipR } = this.sizes;
    for (const side of ['left', 'right']) {
      for (const part of this.parts[side]) {
        if (part.kind === 'palm') part.collider.setHalfExtents({ x: palmSize[0] / 2 * scale, y: palmSize[1] / 2 * scale, z: palmSize[2] / 2 * scale });
        else part.collider.setRadius(tipR * scale);
      }
    }
    this.scale = scale;
  }

  near(point) {
    let best = Infinity;
    for (const side of ['left', 'right']) for (const part of this.parts[side]) if (part.to) best = Math.min(best, part.to.p.distanceTo(point));
    return best;
  }

  owns(collider) { return this.handles.has(collider?.handle ?? collider); }

  free() {
    for (const side of ['left', 'right']) for (const part of this.parts[side]) { try { this.world.removeRigidBody(part.body); } catch { /* world freed */ } }
    this.parts = { left: [], right: [] };
  }
}
