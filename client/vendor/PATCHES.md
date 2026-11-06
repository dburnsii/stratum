# Local patches to vendored libraries

## three.module.js (r170)
- `WebXRManager.onAnimationFrame`, depth sensing: only call
  `glBinding.getDepthInformation()` when a GL binding exists (WebXR Layers
  path) and the session's `depthUsage` is `gpu-optimized`. Unpatched, a
  session with `depth-sensing` on the XRWebGLLayer path (`glBinding` null)
  or with CPU depth throws every frame and stops rendering. Search for
  `STRATUM PATCH`. Re-apply (or drop, if fixed upstream) when upgrading.
