// Components → Three.js objects (DESIGN.md §4). Unknown components are
// ignored, so old clients still render what they understand.
//
//   const built = await buildObject(obj, { now })   // { root, inner, update(dt), dispose() }
//
// Supported:
//   mesh:      { primitive: 'box' | 'sphere', size: [x, y, z] }
//   material:  { color }
//   model:     { asset: '<sha256>' }                      glTF binary, animations loop
//   image:     { asset, aspect }                          a picture, 0.3 m wide
//   video:     { asset, aspect, startedAt }               muted looping screen, 0.4 m wide
//   animation: { kind: 'spin', rpm, startedAt }           time-based, same on every client
//
// Model, image and video content is normalized so the object's *pose* (incl.
// scale) is the only thing that varies per placement: models are recentered
// to sit on their origin, and scaled to MODEL_SIZE at scale 1.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const MODEL_SIZE = 0.2;   // meters, longest side at scale 1
const IMAGE_WIDTH = 0.3;
const VIDEO_WIDTH = 0.4;

export const assetUrl = (hash) => `/assets/${hash}`;

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const gltfCache = new Map();      // hash -> Promise<{ scene, animations, fit }>
const textureCache = new Map();   // hash -> Promise<Texture>

function loadModel(hash) {
  if (!gltfCache.has(hash)) {
    gltfCache.set(hash, gltfLoader.loadAsync(assetUrl(hash)).then((gltf) => {
      // Normalize once per asset: bottom-center at the origin, longest side 1.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const longest = Math.max(size.x, size.y, size.z) || 1;
      const center = box.getCenter(new THREE.Vector3());
      return { scene: gltf.scene, animations: gltf.animations, fit: { scale: 1 / longest, offset: new THREE.Vector3(-center.x, -box.min.y, -center.z) } };
    }).catch((err) => { gltfCache.delete(hash); throw err; }));
  }
  return gltfCache.get(hash);
}

function loadTexture(hash) {
  if (!textureCache.has(hash)) {
    textureCache.set(hash, textureLoader.loadAsync(assetUrl(hash)).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }).catch((err) => { textureCache.delete(hash); throw err; }));
  }
  return textureCache.get(hash);
}

export async function buildObject(o, { now = () => Date.now() } = {}) {
  const c = o.components ?? {};
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.userData.objectId = o.id;
  const inner = new THREE.Group();   // animation (spin) rotates this, never the pose
  root.add(inner);
  const updaters = [], disposers = [];

  if (c.app) {
    // An app instance. The app draws its own content (ctx.root, added by the
    // runtime); we only add a small puck so the instance itself can be
    // selected to move/rotate/resize/delete it.
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 28),
      new THREE.MeshStandardMaterial({ color: 0x9aa1b2, transparent: true, opacity: 0.7 }));
    puck.position.y = 0.004;
    puck.userData.handle = true;
    puck.userData.puck = true;   // apps with their own handle ("ownHandle") hide it
    inner.add(puck);
    root.userData.app = c.app;
  } else if (c.turntable) {
    // A turntable (DESIGN.md §8.8): a round stand; things dropped on it wait
    // in slots, one shown on top at a time (main.js places it, the arrows
    // and swipes step through). Hold the base to move it.
    const R = c.turntable.radius ?? 0.12;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.006, R + 0.012, 0.016, 48), new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.5, metalness: 0.3 }));
    base.position.y = 0.008;
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.006, 48), new THREE.MeshStandardMaterial({ color: 0x495057, roughness: 0.35, metalness: 0.6 }));
    platter.position.y = 0.019;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.96, 0.0025, 8, 64).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7fc4ff, emissive: 0x1c7ed6, emissiveIntensity: 0.6 }));
    ring.position.y = 0.0225;
    for (const m of [base, platter, ring]) { m.userData.handle = true; inner.add(m); }
    platter.userData.ttPlatter = true;
    // Arrows on the front edge (+z): previous / next.
    const tri = new THREE.Shape([new THREE.Vector2(0, 0.011), new THREE.Vector2(-0.011, -0.008), new THREE.Vector2(0.011, -0.008)]);
    const arrowGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.006, bevelEnabled: false }).rotateX(-Math.PI / 2);
    for (const dir of [-1, 1]) {
      const a = new THREE.Mesh(arrowGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7fc4ff, emissiveIntensity: 0.35, roughness: 0.4 }));
      a.rotation.y = dir < 0 ? Math.PI / 2 : -Math.PI / 2;   // pointing left / right
      a.position.set(dir * R * 0.55, 0.012, R + 0.02);
      a.userData.ttArrow = dir;
      inner.add(a);
    }
    root.userData.turntable = true;
  } else if (c.keyboard) {
    // A keyboard that lives here (DESIGN.md §8.5): just its base; the keys
    // are a fixed Keyboard that main.js lays on top (Quest). Grab the rim to move it.
    const [w, d] = c.keyboard.layout === 'full' ? [0.55, 0.19] : [0.3, 0.18];
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), new THREE.MeshStandardMaterial({ color: 0x1c2230, roughness: 0.55, metalness: 0.2 }));
    base.position.y = 0.006;
    inner.add(base);
    root.userData.keyboard = true;
  } else if (c.model?.asset) {
    const { scene, animations, fit } = await loadModel(c.model.asset);
    const model = SkeletonUtils.clone(scene);
    const holder = new THREE.Group();
    holder.scale.setScalar(fit.scale * MODEL_SIZE);
    model.position.copy(fit.offset);
    holder.add(model);
    inner.add(holder);
    if (animations.length) {
      const mixer = new THREE.AnimationMixer(model);
      for (const clip of animations) mixer.clipAction(clip).play();
      updaters.push((dt) => mixer.update(dt));
    }
  } else if (c.image?.asset) {
    const tex = await loadTexture(c.image.asset);
    const aspect = c.image.aspect || tex.image.width / tex.image.height || 1;
    inner.add(picture(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), IMAGE_WIDTH, aspect));
  } else if (c.video?.asset) {
    const video = Object.assign(document.createElement('video'), {
      src: assetUrl(c.video.asset), muted: true, loop: true, playsInline: true, crossOrigin: 'use-credentials',
    });
    // Time-based sync: every client shows the same moment of the video.
    video.addEventListener('loadedmetadata', () => {
      if (c.video.startedAt && video.duration) video.currentTime = ((now() - c.video.startedAt) / 1000) % video.duration;
    }, { once: true });
    video.play().catch(() => {});   // muted autoplay; retried on the next user gesture by the app
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    inner.add(picture(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }), VIDEO_WIDTH, c.video.aspect || 16 / 9));
    root.userData.video = video;
    disposers.push(() => { video.pause(); video.removeAttribute('src'); video.load(); });
  } else {
    const m = c.mesh ?? {};
    const size = m.size ?? [0.1, 0.1, 0.1];
    const geo = m.primitive === 'sphere'
      ? new THREE.SphereGeometry(size[0] / 2, 24, 16)
      : new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: c.material?.color ?? '#ffffff', roughness: 0.45 }));
    mesh.position.y = size[1] / 2;   // rest on the surface
    inner.add(mesh);
  }

  const anim = c.animation;
  if (anim?.kind === 'spin') {
    updaters.push(() => { inner.rotation.y = ((now() - anim.startedAt) / 60000) * anim.rpm * Math.PI * 2; });
  }

  return {
    root, inner,
    update(dt) { for (const u of updaters) u(dt); },
    dispose() {
      for (const d of disposers) d();
      root.traverse((n) => {
        if (n.isMesh && !n.isSkinnedMesh && n.geometry && !c.model) n.geometry.dispose();   // model geometry is shared via the cache
        if (n.isMesh && n.material && !c.model) [].concat(n.material).forEach((mat) => mat.dispose());
      });
    },
  };
}

// Upright picture standing on its bottom edge, facing +z.
function picture(material, width, aspect) {
  const h = width / aspect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), material);
  mesh.position.y = h / 2;
  return mesh;
}

// Measure an image/video file before upload (stored with the asset, so
// placing it doesn't need to load it first).
export async function measureFile(file) {
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file);
    const size = { w: bmp.width, h: bmp.height };
    bmp.close();
    return size;
  }
  if (file.type.startsWith('video/')) {
    const v = Object.assign(document.createElement('video'), { preload: 'metadata', muted: true, src: URL.createObjectURL(file) });
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    URL.revokeObjectURL(v.src);
    return { w: v.videoWidth, h: v.videoHeight };
  }
  return {};
}
