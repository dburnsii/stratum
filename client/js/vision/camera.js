// WebXR camera-access feed (Chrome Android): per-frame preview texture plus
// low-rate, downscaled CPU captures for computer vision.
//
//   const feed = new XRCameraFeed(renderer, session, { preview: true });
//   // inside the XR frame callback, AFTER renderer.render():
//   const cap = feed.update(frame, refSpace, { wantCapture: tracker.idle });
//   if (cap) tracker.submit(cap);
//
// The camera image is a GPU texture valid only during the frame, so it is
// blitted into textures we own: full size for the preview, scaled (and
// flipped so row 0 = top, as vision code expects) for captures.
import * as THREE from 'three';
import { withRawGL } from '../gl.js';
import { intrinsicsFromProjection } from './pose.js';

export class XRCameraFeed {
  constructor(renderer, session, { preview = false, captureLongSide = 960, captureEveryMs = 200 } = {}) {
    this.renderer = renderer;
    const gl = (this.gl = renderer.getContext());
    this.binding = new XRWebGLBinding(session, gl);
    this.readFb = gl.createFramebuffer();
    this.wantPreview = preview;
    this.captureLongSide = captureLongSide;
    this.captureEveryMs = captureEveryMs;
    this.previewRT = null;     // THREE.WebGLRenderTarget, camera size
    this.captureRT = null;     // scaled
    this.size = null;          // camera image { width, height }
    this.lastCapture = 0;
    this.seq = 0;
    this.stats = { frames: 0, captures: 0, readMs: 0 };
    this.onFirstFrame = null;  // (info) => void
  }

  get previewTexture() { return this.previewRT?.texture ?? null; }

  update(frame, refSpace, { wantCapture = false } = {}) {
    const view = frame.getViewerPose(refSpace)?.views.find((v) => v.camera);
    if (!view) return null;
    const { width: w, height: h } = view.camera;
    if (!this.size) this.init(w, h, view);
    this.stats.frames++;

    const now = performance.now();
    const capture = wantCapture && now - this.lastCapture >= this.captureEveryMs;
    let result = null;
    withRawGL(this.renderer, (gl) => {
      // Inside withRawGL: implementations may touch GL state to produce it.
      const camTex = this.binding.getCameraImage(view.camera);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, camTex, 0);
      if (this.previewRT) {
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb(this.previewRT));
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      if (capture) result = this.capture(gl, w, h, view);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    });
    return result;
  }

  init(w, h, view) {
    this.size = { width: w, height: h };
    const scale = Math.min(1, this.captureLongSide / Math.max(w, h));
    this.capW = Math.round(w * scale);
    this.capH = Math.round(h * scale);
    if (this.wantPreview) {
      this.previewRT = new THREE.WebGLRenderTarget(w, h);
      this.previewRT.texture.colorSpace = THREE.SRGBColorSpace;
      this.renderer.initRenderTarget(this.previewRT);
    }
    this.captureRT = new THREE.WebGLRenderTarget(this.capW, this.capH);
    this.renderer.initRenderTarget(this.captureRT);
    this.pixels = new Uint8Array(this.capW * this.capH * 4);
    this.onFirstFrame?.({ width: w, height: h, capW: this.capW, capH: this.capH,
      K: intrinsicsFromProjection(view.projectionMatrix, w, h) });
  }

  fb(rt) { return this.renderer.properties.get(rt).__webglFramebuffer; }

  capture(gl, w, h, view) {
    const t0 = performance.now();
    const { capW, capH } = this;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fb(this.captureRT));
    // dst y reversed: GL row 0 is the image bottom; vision wants row 0 = top.
    gl.blitFramebuffer(0, 0, w, h, 0, capH, capW, 0, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fb(this.captureRT));
    gl.readPixels(0, 0, capW, capH, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFb);
    this.lastCapture = performance.now();
    this.stats.captures++;
    this.stats.readMs += this.lastCapture - t0;
    return {
      seq: ++this.seq,
      width: capW,
      height: capH,
      data: this.pixels.slice().buffer,   // copy: the worker takes ownership
      K: intrinsicsFromProjection(view.projectionMatrix, capW, capH),
      cameraWorld: new THREE.Matrix4().fromArray(view.transform.matrix),
      time: this.lastCapture,
    };
  }
}
