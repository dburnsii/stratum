// Optional occlusion: real things in front of virtual ones hide them, using
// WebXR depth sensing. DESIGN.md §8.
//
//   Quest (gpu-optimized, texture-array per eye): three.js's built-in depth
//     mesh handles it; we only switch it on/off.
//   Phones (Chrome/ARCore: a single 2D depth map, gpu- or cpu-optimized):
//     our own pass. A full-screen layer, drawn before everything else, writes
//     the real world's depth into the depth buffer (color untouched), so
//     virtual fragments behind real surfaces fail the depth test.
//
//   const occ = new Occlusion(renderer, scene);
//   requestSession(mode, { ...init, ...Occlusion.sessionInit(wanted) })
//   occ.start(session); each frame BEFORE render: occ.update(frame, refSpace)
import * as THREE from 'three';
import { telemetry } from './telemetry.js';

const VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Depth map → depth buffer. uv: normalized view coords (top-left origin).
const FRAG = /* glsl */`
uniform sampler2D depthMap;
uniform mat4 uvTransform;         // normDepthBufferFromNormView
uniform float rawToMeters;
uniform int packing;              // 0: luminance-alpha (2×8 bit), 1: one float/uint channel
uniform vec4 viewport;            // x, y, w, h of this view in the framebuffer
uniform mat4 proj;                // camera projection
void main() {
  vec2 uv = (gl_FragCoord.xy - viewport.xy) / viewport.zw;
  uv.y = 1.0 - uv.y;                                            // GL bottom-left → top-left
  vec2 duv = (uvTransform * vec4(uv, 0.0, 1.0)).xy;
  vec4 t = texture2D(depthMap, duv);
  float raw = packing == 0 ? dot(t.ra, vec2(255.0, 256.0 * 255.0)) : t.r;
  float meters = raw * rawToMeters;
  if (meters <= 0.0) { gl_FragDepth = 1.0; return; }            // unknown: occlude nothing
  float z = -meters;                                            // view space looks down -z
  float clipZ = proj[2][2] * z + proj[3][2];
  float clipW = proj[2][3] * z + proj[3][3];
  gl_FragDepth = clamp((clipZ / clipW) * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(0.0);
}`;

export class Occlusion {
  // Session options. Depth is only requested when the user wants occlusion.
  static sessionInit(wanted) {
    if (!wanted) return {};
    return {
      optionalFeatures: ['depth-sensing'],
      depthSensing: {
        usagePreference: ['gpu-optimized', 'cpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32', 'unsigned-short'],
      },
    };
  }

  constructor(renderer, scene) {
    this.renderer = renderer;
    this.enabled = false;
    this.session = null;
    this.status = 'off';
    this.depthTex = new THREE.Texture();            // GPU path: wraps the browser's texture
    this.cpuTex = null;                             // CPU path: our upload
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        depthMap: { value: this.depthTex }, uvTransform: { value: new THREE.Matrix4() },
        rawToMeters: { value: 0.001 }, packing: { value: 0 },
        viewport: { value: new THREE.Vector4(0, 0, 1, 1) }, proj: { value: new THREE.Matrix4() },
      },
      // Depth writes need the depth test ON (GL drops writes when it's off);
      // ALWAYS lets every fragment through.
      colorWrite: false, depthWrite: true, depthTest: true, depthFunc: THREE.AlwaysDepth,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));   // one big triangle
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1e9;                   // before every other opaque object
    this.mesh.visible = false;
    scene.add(this.mesh);
    // three's own (Quest) depth mesh: only when we say so.
    const builtin = renderer.xr.getDepthSensingMesh.bind(renderer.xr);
    renderer.xr.getDepthSensingMesh = () => (this.enabled && this.useBuiltin ? builtin() : null);
  }

  get available() { return !!this.session?.enabledFeatures?.includes('depth-sensing'); }

  start(session) {
    this.session = session;
    this.binding = null;
    this.useBuiltin = false;
    this.logged = false;
    this.mode = this.available ? session.depthUsage : null;
    this.format = this.available ? session.depthDataFormat : null;
    this.status = this.available ? `${this.mode}, ${this.format}` : 'unavailable';
    return this.status;
  }

  stop() {
    this.session = null;
    this.mesh.visible = false;
  }

  update(frame, refSpace) {
    this.mesh.visible = false;
    if (!this.enabled || !this.available || !frame) return;
    const pose = frame.getViewerPose(refSpace);
    const view = pose?.views[0];
    const cam = this.renderer.xr.getCamera().cameras[0];
    if (!view || !cam) return;
    let info = null;
    try {
      if (this.mode === 'gpu-optimized') {
        this.binding ??= new XRWebGLBinding(this.session, this.renderer.getContext());
        info = this.binding.getDepthInformation(view);
        this.logFirst(info);
        if (info?.textureType === 'texture-array') { this.useBuiltin = true; return; }   // Quest: three draws it
        if (!info?.texture) return;
        this.renderer.properties.get(this.depthTex).__webglTexture = info.texture;
        this.material.uniforms.depthMap.value = this.depthTex;
        this.material.uniforms.packing.value = this.format === 'luminance-alpha' ? 0 : 1;
      } else {
        info = frame.getDepthInformation(view);
        this.logFirst(info);
        if (!info) return;
        this.uploadCpu(info);
      }
    } catch (err) {
      this.status = `error: ${err.message}`;
      return;
    }
    const u = this.material.uniforms;
    u.uvTransform.value.fromArray(info.normDepthBufferFromNormView.matrix);
    u.rawToMeters.value = this.mode === 'gpu-optimized' ? info.rawValueToMeters : 1;
    u.proj.value.copy(cam.projectionMatrix);
    const vp = cam.viewport;
    u.viewport.value.set(vp.x, vp.y, vp.z, vp.w);
    this.mesh.visible = true;
  }

  // Once per session: what the device actually delivers (verifies the path
  // on real hardware from telemetry).
  logFirst(info) {
    if (this.logged || !info) return;
    this.logged = true;
    telemetry.info('depth frame', { usage: this.mode, format: this.format, w: info.width, h: info.height,
      rawToMeters: info.rawValueToMeters, textureType: info.textureType ?? null,
      uvTransform: Array.from(info.normDepthBufferFromNormView?.matrix ?? []).map((v) => +v.toFixed(3)) });
  }

  // CPU depth → a small float texture in meters (one channel).
  uploadCpu(info) {
    const { width: w, height: h } = info;
    if (!this.cpuTex || this.cpuTex.image.width !== w || this.cpuTex.image.height !== h) {
      this.cpuTex?.dispose();
      this.cpuTex = new THREE.DataTexture(new Float32Array(w * h), w, h, THREE.RedFormat, THREE.FloatType);
      this.cpuTex.minFilter = this.cpuTex.magFilter = THREE.NearestFilter;
      this.cpuTex.flipY = false;   // row 0 = top, like normalized depth buffer coords
    }
    const out = this.cpuTex.image.data;
    const src = this.format === 'float32' ? new Float32Array(info.data) : new Uint16Array(info.data);
    const k = info.rawValueToMeters;
    for (let i = 0; i < out.length; i++) out[i] = src[i] * k;
    this.cpuTex.needsUpdate = true;
    this.material.uniforms.depthMap.value = this.cpuTex;
    this.material.uniforms.packing.value = 1;
  }
}
