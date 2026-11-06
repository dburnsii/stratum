// A hand mesh you pose from 25 joint positions (WebXR order), for apps that
// show hands that aren't yours: gesture examples, replays. Same model as your
// own hands (/vendor/hands); joint orientations are worked out from the
// positions (−Z along each bone toward the tip, −Y out of the palm, like
// WebXR joint spaces), sized like your hands (hand length vs the model's).
//
//   import { HandPuppet } from '/js/apps/kit/handpuppet.js';
//   const p = new HandPuppet(THREE, 'right', { color: 0x63e6be });
//   ctx.root.add(p.group);   // poses are in the parent's frame
//   p.pose(joints);          // [25 Vector3]; p.visible = false hides it
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const JOINT_NAMES = ['wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map((j) => `${f}-finger-${j}`))];
const SIZE_CHAIN = [0, 10, 11, 12, 13, 14];
const handLength = (pts) => pts.reduce((s, p, i) => (i ? s + p.distanceTo(pts[i - 1]) : 0), 0);
// The joint each joint's bone points at (tips: away from the one before).
const CHILD = [10, 2, 3, 4, -3, 6, 7, 8, 9, -8, 11, 12, 13, 14, -13, 16, 17, 18, 19, -18, 21, 22, 23, 24, -23];

export class HandPuppet {
  constructor(THREE, side, { color = 0x63e6be, opacity = 0.55 } = {}) {
    this.T = THREE;
    this.side = side;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, transparent: true, opacity, roughness: 0.4 });
    this.ready = new Promise((resolve) => {
      new GLTFLoader().load(`/vendor/hands/${side}.glb`, (gltf) => {
        const root = gltf.scene;
        let mesh = null;
        root.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
        const bones = JOINT_NAMES.map((n) => root.getObjectByName(n));
        if (!mesh || bones.some((b) => !b)) return resolve(false);
        root.updateMatrixWorld(true);
        const bind = mesh.skeleton.bones.map((b, i) => new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert()));
        this.rest = handLength(SIZE_CHAIN.map((i) => bind[mesh.skeleton.bones.findIndex((b) => b.name === JOINT_NAMES[i])]));
        root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
        const arm = bones[0].parent;
        arm.position.set(0, 0, 0); arm.quaternion.identity(); arm.scale.set(1, 1, 1);
        mesh.material = this.mat;
        mesh.frustumCulled = false;
        mesh.raycast = () => {};
        this.bones = bones;
        this.group.add(root);
        resolve(true);
      }, undefined, () => resolve(false));
    });
  }

  set visible(on) { this.group.visible = on; }
  get visible() { return this.group.visible; }
  setColor(c) { this.mat.color.setHex(c); this.mat.emissive.setHex(c); }

  // Joints in the parent's frame (meters).
  pose(j) {
    if (!this.bones || !j) return;
    const T = this.T;
    const across = new T.Vector3().subVectors(j[5], j[20]), along = new T.Vector3().subVectors(j[10], j[0]).normalize();
    const palm = new T.Vector3().crossVectors(along, across).normalize();   // out of the palm (the hands mirror)
    if (this.side === 'right') palm.negate();
    const size = handLength(SIZE_CHAIN.map((i) => j[i]));
    const k = this.rest ? Math.min(1.5, Math.max(0.6, size / this.rest)) : 1;
    const m = new T.Matrix4(), x = new T.Vector3(), y = new T.Vector3(), z = new T.Vector3();
    this.bones.forEach((b, i) => {
      const c = CHILD[i];
      z.subVectors(j[i], c >= 0 ? j[c] : j[-c]);           // +Z: from the tip back to the joint
      if (c < 0) z.negate();                                // tips: the bone before's direction
      z.normalize();
      y.copy(palm).negate().addScaledVector(z, palm.dot(z)).normalize();   // −Y out of the palm
      x.crossVectors(y, z).normalize();
      m.makeBasis(x, y, z).setPosition(j[i]);
      m.decompose(b.position, b.quaternion, b.scale);
      b.scale.setScalar(k);
    });
    this.group.children[0]?.updateMatrixWorld(true);
  }
}
