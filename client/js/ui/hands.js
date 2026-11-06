// Tracked hands (Quest): draw them and read simple poses. DESIGN.md §8.1.
//
// In passthrough you already see your real hands, so the overlay is light: a
// skinned hand mesh (the standard WebXR generic hand, vendored in
// /vendor/hands) driven by the 25 tracked joints, drawn as translucent glass
// with a glowing rim, over everything (a depth pre-pass so it still hides its
// own far side). Until the model loads (or if it can't), joint dots and thin
// bones (one InstancedMesh each) stand in.
//
//   const hands = new HandView(scene);
//   hands.update(frame, refSpace, session.inputSources, headPosition)
//   hands.tracked → { left, right }; hands.palmFacing('left') → -1…1
//   hands.wrist('left') → Matrix4 | null (a palm frame for attaching UI)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { telemetry } from '../telemetry.js';

const JOINTS = 25;
// Bones: wrist → each metacarpal, then down each finger (joint order per the WebXR spec).
const BONES = [];
for (const base of [1, 5, 10, 15, 20]) {
  BONES.push([0, base]);
  const len = base === 1 ? 3 : 4;
  for (let j = 0; j < len; j++) BONES.push([base + j, base + j + 1]);
}
const TIPS = new Set([4, 9, 14, 19, 24]);
const COLOR = 0x8fd0ff;
// WebXR joint order (XRHand iteration order); the model's bones carry these names.
const JOINT_NAMES = ['wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((j) => `${f}-finger-${j}`))];
const MODEL_URL = (side) => `/vendor/hands/${side}.glb`;
const SIZE_CHAIN = [0, 10, 11, 12, 13, 14];   // wrist → middle finger tip: how big a hand is
const handLength = (pts) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);

export class HandView {
  constructor(scene) {
    this.visible = true;
    this.hands = {};
    for (const side of ['left', 'right']) {
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8),
        new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }), JOINTS);
      const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6),
        new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false }), BONES.length);
      for (const m of [joints, bones]) {
        m.frustumCulled = false;
        m.visible = false;
        m.renderOrder = 1100;   // over everything (keyboards, menus, the move box): your hands are always in front
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
      }
      this.hands[side] = {
        joints, bones, tracked: false,
        poses: new Float32Array(JOINTS * 16), radii: new Float32Array(JOINTS),
        pos: Array.from({ length: JOINTS }, () => new THREE.Vector3()),
        palm: new THREE.Vector3(), wrist: new THREE.Matrix4(), facing: -1,
        model: null, bonesByJoint: null, skin: null,
      };
      this.loadModel(scene, side);
    }
  }

  // The skinned hand: two meshes on one skeleton. The first only writes depth
  // (always, so the hand is in front of everything); the second draws the
  // glass where that depth is the hand's own nearest surface.
  loadModel(scene, side) {
    new GLTFLoader().load(MODEL_URL(side), (gltf) => {
      const root = gltf.scene;
      let mesh = null;
      root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
      if (!mesh) return;
      const bones = JOINT_NAMES.map((n) => root.getObjectByName(n));
      if (bones.some((b) => !b)) return;
      root.updateMatrixWorld(true);
      // The model's own hand length (bind pose), to size it to yours (see pose()).
      const bind = mesh.skeleton.bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()));
      const at = (name) => bind[mesh.skeleton.bones.findIndex((b) => b.name === name)];
      const rest = handLength(SIZE_CHAIN.map((i) => at(JOINT_NAMES[i])));
      // Bones are posed straight from world-space joint poses: hang them off an identity root.
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      const armature = bones[0].parent;
      armature.position.set(0, 0, 0); armature.quaternion.identity(); armature.scale.set(1, 1, 1);
      const h = this.hands[side];
      const glass = new THREE.MeshStandardMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.28, roughness: 0.35, metalness: 0,
        depthWrite: false, depthFunc: THREE.LessEqualDepth });
      glass.onBeforeCompile = (sh) => {
        sh.uniforms.uRim = h.rim = { value: new THREE.Color(COLOR) };
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
totalEmissiveRadiance += uRim * (0.25 + 1.4 * fres);
diffuseColor.a = clamp(diffuseColor.a + fres * 0.55, 0.0, 0.9);`);
      };
      glass.customProgramCacheKey = () => 'hand-glass';
      mesh.material = glass;
      mesh.renderOrder = 1100;
      const depth = new THREE.SkinnedMesh(mesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, depthFunc: THREE.AlwaysDepth }));
      depth.bind(mesh.skeleton, mesh.bindMatrix);
      depth.renderOrder = 1099;
      mesh.parent.add(depth);
      for (const m of [mesh, depth]) m.frustumCulled = false;
      root.visible = false;
      scene.add(root);
      Object.assign(h, { model: root, bonesByJoint: bones, skin: mesh, rest: rest > 0.05 ? rest : null });
      this.setVisible(this.visible);
    }, undefined, () => { /* no model: the dots and bones stay */ });
  }

  get tracked() { return { left: this.hands.left.tracked, right: this.hands.right.tracked }; }

  setVisible(on) {
    this.visible = on;
    for (const h of Object.values(this.hands)) this.show(h);
  }

  update(frame, refSpace, sources, head) {
    const seen = { left: false, right: false };
    for (const src of sources) {
      if (!src.hand || !this.hands[src.handedness]) continue;
      const h = this.hands[src.handedness];
      if (!readJoints(frame, src.hand, refSpace, h)) continue;
      seen[src.handedness] = true;
      this.draw(h);
      this.measure(h, src.handedness, head);
    }
    for (const [side, h] of Object.entries(this.hands)) {
      h.tracked = seen[side];
      this.show(h);
      if (!h.tracked) h.facing = -1;
    }
  }

  show(h) {
    const on = this.visible && h.tracked;
    if (h.model) h.model.visible = on;
    h.joints.visible = h.bones.visible = on && !h.model;   // the dots only until the mesh is in
  }

  // Each bone takes its joint's pose (position + orientation, world space),
  // scaled by your hand's size vs the model's (wrist → middle fingertip,
  // smoothed): joints pin the lengths, this makes the fingers and palm as
  // thick as yours.
  pose(h) {
    const m = new THREE.Matrix4();
    const len = handLength(SIZE_CHAIN.map((i) => h.pos[i]));
    if (h.rest && len > 0.08 && len < 0.3) h.size = h.size ? h.size + (len - h.size) * 0.05 : len;
    const k = h.rest && h.size ? Math.min(1.5, Math.max(0.6, h.size / h.rest)) : 1;
    if (h.rest && h.size && !h.sizeLogged && (h.sizeFrames = (h.sizeFrames ?? 0) + 1) > 120) {
      h.sizeLogged = true;
      telemetry.info('hand size', { cm: +(h.size * 100).toFixed(1), model: +(h.rest * 100).toFixed(1), scale: +k.toFixed(2) });
    }
    h.scale = k;
    h.bonesByJoint.forEach((b, i) => {
      m.fromArray(h.poses, i * 16);
      m.decompose(b.position, b.quaternion, b.scale);
      b.scale.setScalar(k);
    });
    h.model.updateMatrixWorld(true);
  }

  draw(h) {
    if (h.model) this.pose(h);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < JOINTS; i++) {
      const r = TIPS.has(i) ? 0.0055 : Math.max(0.003, Math.min(0.006, (h.radii[i] || 0.008) * 0.45));
      h.joints.setMatrixAt(i, m.compose(h.pos[i], q.identity(), s.setScalar(r)));
    }
    BONES.forEach(([a, b], i) => {
      const pa = h.pos[a], pb = h.pos[b];
      const dir = new THREE.Vector3().subVectors(pb, pa);
      const len = dir.length();
      q.setFromUnitVectors(up, len > 1e-6 ? dir.divideScalar(len) : up);
      h.bones.setMatrixAt(i, m.compose(new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5), q, s.set(0.0018, len, 0.0018)));
    });
    h.joints.instanceMatrix.needsUpdate = true;
    h.bones.instanceMatrix.needsUpdate = true;
  }

  // Palm frame and how much the palm faces the head (1 = straight at it).
  measure(h, side, head) {
    const wrist = h.pos[0], index = h.pos[5], pinky = h.pos[20], middle = h.pos[10];
    const across = new THREE.Vector3().subVectors(index, pinky);
    const along = new THREE.Vector3().subVectors(middle, wrist).normalize();
    // Palm normal (out of the palm side): left and right hands mirror.
    const n = new THREE.Vector3().crossVectors(along, across).normalize();
    if (side === 'right') n.negate();
    h.palm.copy(n);
    const center = new THREE.Vector3().addVectors(wrist, middle).multiplyScalar(0.5);
    h.facing = head ? n.dot(new THREE.Vector3().subVectors(head, center).normalize()) : -1;
    const x = new THREE.Vector3().crossVectors(along, n).normalize();
    h.wrist.makeBasis(x, along, n).setPosition(center);
  }

  palmFacing(side) { return this.hands[side].facing; }
  wrist(side) { return this.hands[side].tracked ? this.hands[side].wrist : null; }
  joint(side, i) { return this.hands[side].tracked ? this.hands[side].pos[i] : null; }
  // How straight a finger is: 1 = straight out, ≤ 0 = curled into the palm.
  // finger: 0 index, 1 middle, 2 ring, 3 pinky.
  straightness(side, finger) {
    const h = this.hands[side];
    if (!h.tracked) return 0;
    const b = 5 + finger * 5;   // metacarpal joint
    const a = new THREE.Vector3().subVectors(h.pos[b + 1], h.pos[b]).normalize();
    const t = new THREE.Vector3().subVectors(h.pos[b + 4], h.pos[b + 1]).normalize();
    return a.dot(t);
  }

  // Index + middle out, ring + pinky curled (the two-finger scroll pose).
  twoFingers(side, held = false) {
    const out = held ? 0.55 : 0.8, curled = held ? 0.55 : 0.35;
    return this.straightness(side, 0) > out && this.straightness(side, 1) > out
      && this.straightness(side, 2) < curled && this.straightness(side, 3) < curled;
  }

  // Tint a hand's dots (feedback while a gesture is active).
  tint(side, color = null) {
    const h = this.hands[side];
    h.joints.material.color.set(color ?? COLOR);
    h.bones.material.color.set(color ?? COLOR);
    h.rim?.value.set(color ?? COLOR);
  }

  // Where the index finger points (knuckle → tip), unit vector, or null.
  indexDir(side) {
    const h = this.hands[side];
    return h.tracked ? new THREE.Vector3().subVectors(h.pos[9], h.pos[6]).normalize() : null;
  }

  dispose() {
    for (const h of Object.values(this.hands)) {
      for (const m of [h.joints, h.bones]) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); }
      h.model?.removeFromParent();
    }
  }
}

function readJoints(frame, hand, refSpace, h) {
  const spaces = Array.from(hand.values());
  if (spaces.length < JOINTS) return false;
  let ok = false;
  if (frame.fillPoses && frame.fillJointRadii) {
    ok = frame.fillPoses(spaces, refSpace, h.poses) && frame.fillJointRadii(spaces, h.radii);
  } else {
    ok = true;
    for (let i = 0; i < JOINTS; i++) {
      const p = frame.getJointPose?.(spaces[i], refSpace);
      if (!p) { ok = false; break; }
      h.poses.set(p.transform.matrix, i * 16);
      h.radii[i] = p.radius;
    }
  }
  if (!ok) return false;
  for (let i = 0; i < JOINTS; i++) h.pos[i].set(h.poses[i * 16 + 12], h.poses[i * 16 + 13], h.poses[i * 16 + 14]);
  return true;
}
