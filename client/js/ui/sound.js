// Interface sounds (DESIGN.md §8). Browsers keep audio off until a user
// gesture; a fingertip poke in XR isn't one, so unlock() is called on the
// Enter AR click (and XR select events) and keys can click after that.
let ctx = null, noise = null;

export function unlock() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { ctx = null; }
}

// A key click: a short filtered noise snap (the switch) over a soft low tap
// (the keycap bottoming out). kind: null = letter, 'space' / 'back' / … = a
// bigger key (lower), 'go' = Enter (brighter).
export function keyClick(kind = null) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  const big = kind && kind !== 'go';
  const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = noise;
  bp.type = 'bandpass';
  bp.frequency.value = kind === 'go' ? 4200 : big ? 1800 : 3200 + Math.random() * 400;
  bp.Q.value = 1.2;
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
  const o = ctx.createOscillator(), og = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(big ? 140 : 210, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.05);
  og.gain.setValueAtTime(big ? 0.22 : 0.14, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  o.connect(og).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.07);
}

// A short tone (labelling pad: high = go, low = done).
export function beep(freq = 880, ms = 120, gain = 0.18) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + ms / 1000 + 0.02);
}
