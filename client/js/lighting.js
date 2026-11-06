// Real-world lighting (WebXR Lighting Estimation, Chrome on Android): light
// virtual things the way the room lights them. The browser estimates the
// main light's direction and color, plus the ambient light around it as
// spherical harmonics; we drive a directional light and a THREE.LightProbe
// from those, smoothed so they don't flicker. Where it isn't available (the
// Quest, other browsers) or it's turned off, the standard lights stay.
//
//   const lighting = new Lighting(scene, { fallback: [hemi, sun] });
//   requestSession({ optionalFeatures: [...lighting.features] })
//   await lighting.start(session)  → 'room' | 'standard' (+ why)
//   lighting.update(frame)          every frame · lighting.stop()
import * as THREE from 'three';

const SMOOTH_S = 0.35;          // time constant for following the estimate
const STALE_MS = 2000;          // no estimate this long: back to the standard lights

export class Lighting {
  constructor(scene, { fallback = [] } = {}) {
    this.fallback = fallback;   // the standard lights: shown whenever estimation isn't
    this.sun = new THREE.DirectionalLight(0xffffff, 0);
    this.sun.position.set(0, 1, 0);
    this.probe = new THREE.LightProbe();
    this.probe.intensity = 0;
    scene.add(this.sun, this.sun.target, this.probe);
    this.xrProbe = null;
    this.active = false;
    this.mode = 'standard';
    this.note = '';
    this.lastEstimate = 0;
    this.last = performance.now();
    this.target = { dir: new THREE.Vector3(0, 1, 0), color: new THREE.Color(1, 1, 1), intensity: 0, sh: new Float32Array(27) };
  }

  get features() { return this.wanted ? ['light-estimation'] : []; }
  get wanted() { return localStorage.getItem('stratum.roomLight') !== '0'; }

  async start(session) {
    this.stop();
    this.session = session;
    if (!this.wanted) return this.use('standard', 'Off: standard lighting');
    if (!session.requestLightProbe) return this.use('standard', 'Not supported on this device: standard lighting');
    try {   // (throws when the session wasn't granted light-estimation)
      this.xrProbe = await session.requestLightProbe();
      this.lastEstimate = performance.now();
      return this.use('room', 'On: lit like your room');
    } catch (err) {
      return this.use('standard', /support|feature|enabled/i.test(err.message) ? 'Not supported on this device: standard lighting' : `Unavailable (${err.message}): standard lighting`);
    }
  }

  use(mode, note) {
    this.mode = mode;
    this.note = note;
    this.active = mode === 'room';
    for (const l of this.fallback) l.visible = !this.active;
    return mode;
  }

  stop() {
    this.xrProbe = null;
    this.session = null;
    this.sun.intensity = 0;
    this.probe.intensity = 0;
    this.use('standard', this.wanted ? '' : 'Off: standard lighting');
  }

  update(frame) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.xrProbe || !frame?.getLightEstimate) return;
    let est = null;
    try { est = frame.getLightEstimate(this.xrProbe); } catch { /* not this frame */ }
    if (est) {
      this.lastEstimate = now;
      const d = est.primaryLightDirection, c = est.primaryLightIntensity;
      if (d) this.target.dir.set(d.x, d.y, d.z).normalize();
      if (c) {
        const peak = Math.max(c.x, c.y, c.z, 1e-6);
        this.target.color.setRGB(c.x / peak, c.y / peak, c.z / peak);
        this.target.intensity = peak;
      }
      if (est.sphericalHarmonicsCoefficients) this.target.sh.set(est.sphericalHarmonicsCoefficients);
      if (!this.active) this.use('room', 'On: lit like your room');
    } else if (this.active && now - this.lastEstimate > STALE_MS) {
      this.use('standard', 'Lost the room estimate: standard lighting');
    }
    if (!this.active) { this.sun.intensity = 0; this.probe.intensity = 0; return; }
    // Follow the estimate smoothly (direction, color, intensity, ambient).
    const k = 1 - Math.exp(-dt / SMOOTH_S);
    const pos = this.sun.position.clone().normalize().lerp(this.target.dir, k).normalize();
    this.sun.position.copy(pos);
    this.sun.color.lerp(this.target.color, k);
    this.sun.intensity += (this.target.intensity - this.sun.intensity) * k;
    const sh = this.probe.sh.coefficients;
    for (let i = 0; i < 9; i++) {
      sh[i].x += (this.target.sh[i * 3] - sh[i].x) * k;
      sh[i].y += (this.target.sh[i * 3 + 1] - sh[i].y) * k;
      sh[i].z += (this.target.sh[i * 3 + 2] - sh[i].z) * k;
    }
    this.probe.intensity = 1;
  }
}
