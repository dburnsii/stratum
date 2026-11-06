// Small still renders of 3D objects (place-chooser cards on the phone).
// One offscreen renderer, made on first use; images cached by key.
//
//   const url = await previewImage('home:switch', () => runtime.preview('home', 'switch'));
import * as THREE from 'three';

const SIZE = 256;
const cache = new Map();
let r = null;

export function previewImage(key, make) {
  if (!cache.has(key)) cache.set(key, render(make).catch(() => null));
  return cache.get(key);
}

async function render(make) {
  const obj = await make();
  if (!obj) return null;
  if (!r) {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, canvas: document.createElement('canvas') });
    r.setPixelRatio(1);
    r.setSize(SIZE, SIZE, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 2, 3);
  scene.add(sun, obj);
  // Frame it: a three-quarter view from the front, a little above.
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.PerspectiveCamera(30, 1, size / 100, size * 10);
  cam.position.copy(c).add(new THREE.Vector3(0.45, 0.35, 1).normalize().multiplyScalar(size * 1.75));
  cam.lookAt(c);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  obj.traverse((n) => { n.geometry?.dispose(); [].concat(n.material ?? []).forEach((m) => m.dispose()); });
  return url;
}
