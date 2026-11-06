// Find the slowdown (Settings → Performance): turn things off one at a time
// and measure the frame rate each way, so we know what's eating the headset
// (DESIGN.md §0). Each step: settle, then measure frames; then it's put back.
//
//   const probe = new SlowdownProbe(steps, { onChange, onDone });
//   steps: [{ key, label, off?() , on?() }]   (no off: as it is, the baseline)
//   probe.start(now); every XR frame: probe.tick(now, workMs); probe.cancel()
//   probe.state → { running, step, of, label, results: [{ key, label, fps, gapMs, p95Ms, workMs }] }

export const PROBE = { settleMs: 1500, measureMs: 4000 };

export class SlowdownProbe {
  constructor(steps, { onChange = () => {}, onDone = () => {}, settleMs = PROBE.settleMs, measureMs = PROBE.measureMs } = {}) {
    Object.assign(this, { steps, onChange, onDone, settleMs, measureMs });
    this.running = false;
    this.results = [];
  }

  get state() {
    const s = this.steps[this.i];
    return { running: this.running, step: (this.i ?? 0) + 1, of: this.steps.length, label: this.running ? s?.label : null, results: this.results };
  }

  start(now) {
    this.running = true;
    this.results = [];
    this.i = -1;
    this.next(now);
  }

  next(now) {
    this.steps[this.i]?.on?.();
    this.i++;
    if (this.i >= this.steps.length) { this.running = false; this.onChange(); this.onDone(this.results); return; }
    try { this.steps[this.i].off?.(); } catch (err) { console.warn('slowdown probe:', err); }
    this.t0 = now;
    this.gaps = [];
    this.work = [];
    this.last = 0;
    this.onChange();
  }

  tick(now, workMs) {
    if (!this.running) return;
    const since = now - this.t0;
    if (since >= this.settleMs) {
      if (this.last) { this.gaps.push(now - this.last); this.work.push(workMs); }
      this.last = now;
    }
    if (since < this.settleMs + this.measureMs) return;
    const g = this.gaps, n = g.length, total = g.reduce((a, b) => a + b, 0);
    const sorted = [...g].sort((a, b) => a - b);
    const s = this.steps[this.i];
    this.results.push({ key: s.key, label: s.label, fps: n && total ? +(n * 1000 / total).toFixed(1) : 0, frames: n,
      gapMs: n ? +(total / n).toFixed(1) : null, p95Ms: n ? +sorted[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(1) : null,
      workMs: n ? +(this.work.reduce((a, b) => a + b, 0) / n).toFixed(1) : null });
    this.next(now);
  }

  cancel() {
    if (!this.running) return;
    this.steps[this.i]?.on?.();
    this.running = false;
    this.onChange();
  }
}
