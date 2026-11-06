// Quest depth (GPU-only: a texture array, one layer per eye) → numbers the
// map worker can use, without stalling the frame. DESIGN.md §3.10.
//
// One small draw samples the depth texture into a 160×160 float target, then
// readPixels goes into a pixel-pack buffer guarded by a fence; a later frame
// collects it once the GPU is done (no glFinish, no wait). Values are window
// depth (0..1) in the eye's projection with the depth near/far; the worker
// turns them into meters. Row 0 = bottom (GL order).
//
//   const gpu = new GpuDepthReader(renderer);
//   gpu.request(depthInfo, meta)    inside the XR frame that produced depthInfo
//   gpu.poll() → { data: Float32Array (w·h), w, h, meta } | null    every frame
import { withRawGL } from '../gl.js';

const SIZE = 160;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const frag = (array, packed) => `#version 300 es
precision highp float;
precision highp ${array ? 'sampler2DArray' : 'sampler2D'};
uniform ${array ? 'sampler2DArray' : 'sampler2D'} depthTex;
uniform int layer;
uniform vec2 size;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / size;
  float d = ${array ? 'texture(depthTex, vec3(uv, float(layer))).r' : 'texture(depthTex, uv).r'};
  ${packed
    ? `vec4 enc = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * clamp(d, 0.0, 0.99999994));
  enc -= enc.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  outColor = enc;`
    : 'outColor = vec4(d, 0.0, 0.0, 1.0);'}
}`;

export class GpuDepthReader {
  constructor(renderer) {
    this.renderer = renderer;
    this.gl = null;
    this.pending = null;      // { pbo, sync, meta, frames }
    this.error = null;
    this.reads = 0;
  }

  get busy() { return !!this.pending; }

  setup(gl) {
    if (this.gl === gl) return;
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');
    this.programs = {};
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.float) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, SIZE, SIZE);
    else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, SIZE, SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    this.vao = gl.createVertexArray();
  }

  program(gl, array) {
    const key = array ? 'array' : 'flat';
    if (this.programs[key]) return this.programs[key];
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`depth shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag(array, !this.float)));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`depth program: ${gl.getProgramInfoLog(p)}`);
    this.programs[key] = { p, tex: gl.getUniformLocation(p, 'depthTex'), layer: gl.getUniformLocation(p, 'layer'), size: gl.getUniformLocation(p, 'size') };
    return this.programs[key];
  }

  // Start reading this frame's depth. Returns false if busy or unusable.
  request(info, meta) {
    if (this.pending || !info?.texture) return false;
    const array = info.textureType !== 'texture';
    try {
      withRawGL(this.renderer, (gl) => {
        this.setup(gl);
        const prog = this.program(gl, array);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, SIZE, SIZE);
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE);
        gl.colorMask(true, true, true, true);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0);
        const target = array ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
        gl.bindTexture(target, info.texture);
        gl.uniform1i(prog.tex, 0);
        gl.uniform1i(prog.layer, info.imageIndex ?? 0);
        gl.uniform2f(prog.size, SIZE, SIZE);
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
        const pbo = gl.createBuffer();
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
        const bytes = SIZE * SIZE * 4 * (this.float ? 4 : 1);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, this.float ? gl.FLOAT : gl.UNSIGNED_BYTE, 0);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        this.pending = { pbo, sync, meta, frames: 0, bytes };
      });
      return true;
    } catch (err) {
      this.error = err.message;
      return false;
    }
  }

  // The finished read, if the GPU is done with it.
  poll() {
    const p = this.pending;
    if (!p) return null;
    p.frames++;
    let out = null;
    withRawGL(this.renderer, (gl) => {
      const st = gl.clientWaitSync(p.sync, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED && p.frames < 30) return;
      gl.deleteSync(p.sync);
      this.pending = null;
      if (st === gl.WAIT_FAILED || st === gl.TIMEOUT_EXPIRED) { gl.deleteBuffer(p.pbo); return; }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.pbo);
      const raw = this.float ? new Float32Array(SIZE * SIZE * 4) : new Uint8Array(SIZE * SIZE * 4);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(p.pbo);
      const data = new Float32Array(SIZE * SIZE);
      if (this.float) for (let i = 0; i < data.length; i++) data[i] = raw[i * 4];
      else for (let i = 0; i < data.length; i++) {
        const j = i * 4;
        data[i] = raw[j] / 255 + raw[j + 1] / 65025 + raw[j + 2] / 16581375 + raw[j + 3] / 4228250625;
      }
      this.reads++;
      out = { data, w: SIZE, h: SIZE, meta: p.meta };
    });
    return out;
  }

  dispose() {
    if (!this.gl) return;
    withRawGL(this.renderer, (gl) => {
      if (this.pending) { gl.deleteSync(this.pending.sync); gl.deleteBuffer(this.pending.pbo); }
      gl.deleteTexture(this.tex);
      gl.deleteFramebuffer(this.fbo);
      gl.deleteVertexArray(this.vao);
      for (const p of Object.values(this.programs)) gl.deleteProgram(p.p);
    });
    this.pending = null;
    this.gl = null;
  }
}
