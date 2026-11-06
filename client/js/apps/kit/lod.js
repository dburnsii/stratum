// Level of detail for apps (DESIGN.md §0 performance). The headset has a
// tight budget: draw less of what's far away, and draw static things in as
// few draw calls as possible. three.js picks LOD levels every render from the
// camera's distance (with hysteresis, so a level doesn't flicker at its edge),
// and the performance page counts only the level showing.
//
//   import { lod, hideBeyond, mergeStatic } from '/js/apps/kit/lod.js';
//   group.add(lod([[detailed, 0], [simple, 1.5], [tiny, 4]]));      // meters from your eyes, nearest first
//   hideBeyond([bolts, decals, treads], 2.5);                       // small parts vanish past 2.5 m (stay in place)
//   mergeStatic(track, { data: true });                             // its meshes merged per material: a few draw calls
import * as THREE from 'three';
import { mergeGeometries } from '/vendor/utils/BufferGeometryUtils.js';

export function lod(levels, { hysteresis = 0.1 } = {}) {
  const l = new THREE.LOD();
  for (const [object, distance] of levels) l.addLevel(object, distance, hysteresis);
  return l;
}

// Hide these objects beyond `distance` m: each moves into an LOD in its old
// parent (same transform), with nothing as the far level.
export function hideBeyond(objects, distance, { hysteresis = 0.15 } = {}) {
  const out = [];
  for (const o of objects) {
    const parent = o.parent;
    if (!parent) continue;
    const l = new THREE.LOD();
    l.name = `lod:${o.name || o.type}`;
    l.position.copy(o.position); l.quaternion.copy(o.quaternion); l.scale.copy(o.scale);
    o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1);
    parent.add(l);
    l.addLevel(o, 0, hysteresis);
    l.addLevel(new THREE.Object3D(), distance, hysteresis);
    out.push(l);
  }
  return out;
}

// Merge a group's plain static meshes (not instanced, not skinned, no
// userData the app relies on: handles, buttons, picks…) into one mesh per
// material. The group keeps its own transform; merged meshes aren't
// raycastable unless `pickable`. With `data`, meshes with userData merge too,
// those with the same userData together (e.g. all the `handle` parts), and
// the merged mesh keeps it (and is raycastable). → the number of draw calls saved.
export function mergeStatic(group, { pickable = false, data = false, keep = () => false } = {}) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const byMat = new Map();
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || keep(o)) return;
    const hasData = Object.keys(o.userData).length > 0;
    if ((hasData && !data) || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    let dataKey = '';
    if (hasData) try { dataKey = JSON.stringify(o.userData); } catch { return; }
    if (!o.visible || o.children.length) return;
    for (let a = o.parent; a && a !== group; a = a.parent) if (a.isLOD || !a.visible) return;   // (LOD levels switch on their own)
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    const key = `${o.material.uuid} ${o.renderOrder} ${dataKey}`;
    if (!byMat.has(key)) byMat.set(key, { material: o.material, geos: [], parts: [], order: o.renderOrder, userData: hasData ? o.userData : null });
    const e = byMat.get(key);
    e.geos.push(g.index ? g.toNonIndexed() : g);
    e.parts.push(o);
  });
  let saved = 0;
  for (const { material, geos, parts, order, userData } of byMat.values()) {
    if (geos.length < 2) { geos.forEach((g) => g.dispose()); continue; }
    // (every part needs the same attributes to merge)
    const names = Object.keys(geos[0].attributes);
    if (!geos.every((g) => Object.keys(g.attributes).length === names.length && names.every((n) => g.attributes[n]))) { geos.forEach((g) => g.dispose()); continue; }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.renderOrder = order;
    m.castShadow = parts[0].castShadow; m.receiveShadow = parts[0].receiveShadow;
    m.name = 'merged';
    if (userData) m.userData = { ...userData };
    else if (!pickable) m.raycast = () => {};
    group.add(m);
    for (const o of parts) o.removeFromParent();
    saved += parts.length - 1;
  }
  return saved;
}
