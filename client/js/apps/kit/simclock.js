// SimClock: fixed-step physics that sleeps when nothing's happening
// (DESIGN.md §0 performance). Get one from the runtime, so its cost shows in
// the performance page and the watchdog can slow it down:
//
//   const clock = ctx.sim({ step: 1 / 120, idleMs: 1200 });
//   frame(ctx, dt) {
//     if (someoneActing) clock.wake();                 // a press, a hand close, a network event…
//     clock.tick(dt, (k, n) => world.step(), { busy: ballMoving });   // busy: must keep running (things in motion)
//     if (clock.asleep) …                              // nothing stepped: skip the physics-side work too
//   }
//
// Asleep = no steps at all (and no accumulated time: waking doesn't replay the
// pause). It falls asleep once it hasn't been woken for idleMs and the last
// tick wasn't busy. `limit` (set by the watchdog) caps steps per tick: under
// load the simulation runs slow-motion rather than costing more per frame.

export class SimClock {
  constructor({ step = 1 / 120, maxSteps = 6, idleMs = 1200, now = () => performance.now() } = {}) {
    Object.assign(this, { step, maxSteps, idleMs, now });
    this.acc = 0;
    this.asleep = false;
    this.lastWake = now();
    this.limit = Infinity;   // steps per tick (the watchdog throttles with this)
    this.ms = 0;             // physics time per tick (smoothed)
    this.steps = 0;          // total steps run
    this.wakes = 0;
  }

  wake() {
    this.lastWake = this.now();
    if (this.asleep) { this.asleep = false; this.acc = 0; this.wakes++; }
  }

  // Run the steps due for dt (seconds); stepFn(k, n) for k = 1…n. Returns n.
  tick(dt, stepFn, { busy = false } = {}) {
    if (busy) this.wake();
    if (this.asleep) { this.lastSteps = 0; return 0; }
    if (this.now() - this.lastWake > this.idleMs) { this.asleep = true; this.acc = 0; this.ms *= 0.9; return 0; }
    this.acc = Math.min(this.acc + dt, this.step * this.maxSteps);
    const n = Math.min(Math.floor(this.acc / this.step), this.limit);
    const t0 = performance.now();
    for (let k = 1; k <= n; k++) stepFn(k, n);
    this.acc -= n * this.step;
    if (n === this.limit) this.acc = Math.min(this.acc, this.step);   // (throttled: drop the backlog, don't build one)
    this.ms = this.ms * 0.9 + (performance.now() - t0) * 0.1;
    this.steps += n;
    this.lastSteps = n;
    return n;
  }
}
