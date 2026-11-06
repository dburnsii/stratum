// Performance: what each app costs, how the headset is keeping up, and a
// watchdog for apps that suddenly hog it (DESIGN.md §0 performance).
//
//   drawCost(root) → { tris, draws, lods }   what an instance's visible meshes draw (LOD-aware)
//   new FrameMeter() .tick(now, workMs, targetHz) → { fps, workMs, budgetMs, dropped, target }
//   new Watchdog(opts) .update(now, frame, apps) → [{ id, act: 'throttle' | 'unthrottle' | 'stop', why }]
//
// Freezes first: an app whose frame() takes over max(40 ms, 3 frame budgets)
// three times within a second is stopped right away (no slowing down first,
// whatever the frame rate says: that's the headset freezing).
//
// Otherwise the watchdog wants headroom: the frame's own work under ~85 % of
// the budget and the frame rate at ~90 % of the headset's. While it isn't, an
// app that costs a lot (its frame() above max(2.5 ms, 20 % of the budget) and
// at least 15 % of the frame's work, or
// a jump to 4× its usual) or draws most of the scene (> 300k triangles and
// over half of everything) is first throttled (its frame() every other frame,
// its physics at half speed) after 0.75 s; still hungry 2.5 s later, it's
// stopped and you're told. Only the hungriest app is acted on at a time (one
// app stalling makes the others look slow too). Apps you've allowed are left
// alone. A throttled app that calms down for 5 s gets its full rate back.

export function drawCost(root) {
  let tris = 0, draws = 0, lods = 0;
  const visit = (o) => {
    if (!o.visible) return;
    if (o.isLOD) lods++;
    if ((o.isMesh || o.isLine || o.isPoints) && o.geometry) {
      const g = o.geometry, n = g.index ? g.index.count : g.attributes.position?.count ?? 0;
      const copies = o.isInstancedMesh ? o.count : 1;
      if (o.isMesh) tris += (n / 3) * copies;
      draws++;
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return { tris: Math.round(tris), draws, lods };
}

export class FrameMeter {
  constructor() { this.last = 0; this.fps = 0; this.workMs = 0; this.dropped = 0; this.frames = 0; this.target = 72; }
  tick(now, workMs, targetHz = 72) {
    this.target = targetHz;
    const budget = 1000 / targetHz;
    if (this.last) {
      const gap = now - this.last;
      if (gap < 500) {   // (a pause, e.g. the headset off: not a slow frame)
        this.fps = this.fps ? this.fps * 0.95 + (1000 / gap) * 0.05 : 1000 / gap;
        if (gap > budget * 1.5) this.dropped += Math.round(gap / budget) - 1;
      }
    }
    this.last = now;
    this.frames++;
    this.workMs = this.workMs * 0.95 + workMs * 0.05;
    return { fps: this.fps, workMs: this.workMs, budgetMs: budget, dropped: this.dropped, target: targetHz };
  }
}

export const WATCHDOG = { minMs: 2.5, share: 0.2, jump: 4, jumpMs: 3, tris: 300_000, trisShare: 0.5, throttleAfterMs: 750, stopAfterMs: 2500, calmMs: 5000, fpsOk: 0.9, workOk: 0.85, workShare: 0.15,
  freezeMs: 40, freezeBudgets: 3, freezeCount: 3, freezeWindowMs: 1000 };

export class Watchdog {
  constructor(opts = {}) { this.o = { ...WATCHDOG, ...opts }; this.apps = new Map(); this.overSince = 0; }

  // frame: { fps, workMs, budgetMs, target }; apps: [{ id, ms (per frame, smoothed), tris, allowed, slow: [[t, ms], …] (its long frames, raw) }].
  update(now, frame, apps) {
    const o = this.o, out = [];
    const overloaded = (frame.fps > 0 && frame.fps < frame.target * o.fpsOk) || frame.workMs > frame.budgetMs * o.workOk;
    this.overloaded = overloaded;
    const sceneTris = apps.reduce((s, a) => s + (a.tris ?? 0), 0);
    const freezeMs = Math.max(o.freezeMs, frame.budgetMs * o.freezeBudgets);
    const seen = [];
    for (const a of apps) {
      const st = this.apps.get(a.id) ?? { level: 0, since: 0, at: 0, calm: 0, base: a.ms };
      this.apps.set(a.id, st);
      if (st.level === 2) continue;
      const cpu = a.ms > Math.max(o.minMs, frame.budgetMs * o.share) && a.ms >= (frame.workMs ?? 0) * o.workShare;   // (and a real part of the frame: not when something else is the problem)
      const jumped = a.ms > o.jumpMs && a.ms > st.base * o.jump;
      const gpu = (a.tris ?? 0) > o.tris && a.tris > sceneTris * o.trisShare;
      const hungry = cpu || jumped || gpu;
      if (!hungry) st.base = st.base * 0.99 + a.ms * 0.01;   // its usual cost (not learned while hungry)
      st.why = cpu ? `${a.ms.toFixed(1)} ms a frame` : jumped ? `jumped to ${a.ms.toFixed(1)} ms a frame (usually ${st.base.toFixed(1)})` : gpu ? `${Math.round(a.tris / 1000)}k triangles` : '';
      if (a.allowed) continue;
      // Freezing the headset: stopped now.
      const frozen = (a.slow ?? []).filter(([t, ms]) => now - t <= o.freezeWindowMs && ms > freezeMs);
      if (frozen.length >= o.freezeCount) {
        st.level = 2;
        out.push({ id: a.id, act: 'stop', why: `froze the headset: ${Math.round(Math.max(...frozen.map((f) => f[1])))} ms frames`, freeze: true });
        continue;
      }
      seen.push({ a, st, hungry, score: gpu && !cpu && !jumped ? a.tris / 1e5 : a.ms });
    }
    // Only the hungriest one moves toward slowing down / stopping; the rest wait their turn.
    const worst = seen.filter((x) => x.hungry).sort((x, y) => y.score - x.score)[0];
    for (const { a, st, hungry } of seen) {
      if (overloaded && hungry && worst && worst.a !== a) { st.since = 0; continue; }
      if (overloaded && hungry) {
        st.calm = 0;
        st.since ||= now;
        if (st.level === 0 && now - st.since >= o.throttleAfterMs) { st.level = 1; st.at = now; out.push({ id: a.id, act: 'throttle', why: st.why }); }
        else if (st.level === 1 && now - st.at >= o.stopAfterMs) { st.level = 2; out.push({ id: a.id, act: 'stop', why: st.why }); }
      } else {
        st.since = 0;
        if (st.level === 1) {
          st.calm ||= now;
          if (now - st.calm >= o.calmMs) { st.level = 0; st.calm = 0; out.push({ id: a.id, act: 'unthrottle', why: '' }); }
        }
      }
    }
    for (const id of this.apps.keys()) if (!apps.some((a) => a.id === id)) this.apps.delete(id);   // (stopped / gone)
    return out;
  }
}
