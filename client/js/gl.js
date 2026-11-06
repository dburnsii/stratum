// Raw WebGL behind three.js's back.
//
// resetState() is required after touching GL state directly, but it also
// forgets the current render target, which during XR is the view three set
// up for this frame. Forgetting it sends all XR drawing to the hidden page
// canvas (Chrome Android, WebXR Layers path). Always go through this.
export function withRawGL(renderer, fn) {
  const target = renderer.getRenderTarget();
  try {
    return fn(renderer.getContext());
  } finally {
    renderer.resetState();
    renderer.setRenderTarget(target);
  }
}

// Android Chrome 156 shows nothing drawn through a WebXR projection layer
// (the probe reads 0,0,0,0 back, glError 1282; Chrome 155 was fine), and
// three.js takes that path whenever session.renderState.layers exists. Hide
// it on Android so three uses the classic XRWebGLLayer (baseLayer) path.
// Call before renderer.xr.setSession(session). Opt back in with ?xrlayers=1
// or localStorage stratum.xrLayers = '1'. Returns the path chosen.
export function chooseXRLayerPath(session) {
  const android = /Android/i.test(navigator.userAgent) && !/OculusBrowser|Quest/i.test(navigator.userAgent);
  const wantLayers = new URLSearchParams(location.search).get('xrlayers') === '1' || localStorage.getItem('stratum.xrLayers') === '1';
  const proto = Object.getPrototypeOf(session);
  const desc = Object.getOwnPropertyDescriptor(proto, 'renderState') ?? Object.getOwnPropertyDescriptor(XRSession.prototype, 'renderState');
  const has = desc?.get ? desc.get.call(session)?.layers !== undefined : session.renderState?.layers !== undefined;
  if (!android || wantLayers || !has || !desc?.get) return has ? 'layers' : 'baseLayer';
  Object.defineProperty(session, 'renderState', {
    configurable: true,
    get() {
      const rs = desc.get.call(this);
      return new Proxy(rs, { get: (t, k) => (k === 'layers' ? undefined : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) });
    },
  });
  return 'baseLayer (forced)';
}
