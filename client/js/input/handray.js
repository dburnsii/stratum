// The hand ray (Quest hands): shared by the main app (main.js handRays) and the
// ray tuning page (/raytest), so what you tune there is what you get.
//
//   const { origin, dir, along } = handRay(pos, palm, HAND_RAY);
//   pos: the 25 joint positions (WebXR order), palm: the palm normal (out of the palm side)
//
// The ray leans `tilt` rad from the palm's normal toward the fingers (0 = straight
// out of the palm, π/2 = along the fingers) and starts `start` of the way from the
// palm's centre (wrist ↔ middle knuckle) to the index knuckle, `out` m off the palm.
import * as THREE from 'three';

// Picked on /raytest (2026-10-27: 57°, 61 % toward the index knuckle, 4.3 cm out, 10 % smoothing; 58 hits / 8 misses).
// smoothDir / smoothOrigin: how far each frame moves to the new ray (1 = no smoothing); the page's smoothing s → 1 − s, origin 1 − s + 0.15.
export const HAND_RAY = { tilt: 57 * Math.PI / 180, start: 0.61, out: 0.043, smoothDir: 0.9, smoothOrigin: 1 };

export function handRay(pos, palm, { tilt, start, out } = HAND_RAY) {
  const along = new THREE.Vector3().subVectors(pos[11], pos[0]);
  along.addScaledVector(palm, -along.dot(palm)).normalize();   // (in the palm's plane: the lean is exactly the tilt)
  const dir = palm.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(along, Math.sin(tilt)).normalize();
  const centre = new THREE.Vector3().addVectors(pos[0], pos[11]).multiplyScalar(0.5);
  const origin = centre.lerp(pos[6], start).addScaledVector(palm, out);
  return { origin, dir, along };
}
