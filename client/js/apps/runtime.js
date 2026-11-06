// App runtime (DESIGN.md §6). Loads enabled apps, starts one module instance
// per app *instance* placed in the world (an object with components.app),
// and gives each a `ctx`, the only thing apps touch:
//
//   export default {
//     async start(ctx) {},            // instance in view and app turned on
//     frame(ctx, dt) {},              // every XR frame while running
//     aim(ctx, ray) {},               // optional, with globalPress: where a press along this (local)
//                                     // ray would land (local point, or null): the cursor dot shows it
//     debug(ctx) {},                  // optional: a small object of what it's doing (steps, bodies…),
//                                     // logged with a long frame() (over 30 ms); keep it cheap
//     select(ctx, hit) {},            // user tapped this app's content
//     swipe(ctx, gesture) {},         // drag to scroll, phases 'move' | 'end'; gesture.dx/dy
//                                     // are cumulative screen-px-like units (down = +).
//                                     // Phones: finger drag. Quest: trigger/pinch drag on
//                                     // the content, or the two-finger hand scroll (source:
//                                     // 'touch' | 'ray' | 'hand'). Goes to the app whose content
//                                     // it started on; otherwise to apps whose globalSwipe(ctx) is true.
//     press(ctx, e) {},               // a finger / pinch / trigger going down and up right away
//                                     // (games: flippers, buttons). e.phase 'down' | 'up', e.side
//                                     // 'left' | 'right' (phone: which half of the screen; Quest:
//                                     // which hand), e.source, e.object / e.point (what it pressed, or
//                                     // null), e.ray() (the input's ray now, local: pull things along
//                                     // while held). Goes to the
//                                     // app whose content it started on, else to apps whose
//                                     // globalPress(ctx, { source, side }) is true. Return false to pass it on.
//                                     // A taken press is not also a tap / hold for the host.
//     grab(ctx, e) {},                // the user is about to pick this instance up with the
//                                     // default gesture (e.how: 'hold' = phone long-press or
//                                     // Quest pinch/trigger held still, 'grip' = controller
//                                     // grip; e.handle: on a userData.handle part; e.source:
//                                     // 'touch' | 'hand' | 'controller'; e.point local).
//                                     // e.preventDefault() keeps the gesture for the app, like a
//                                     // DOM default action; move it your own way with ctx.move().
//     moveTiming: { delay, duration }, // optional (or a function (ctx, { handle, source, object })):
//                                     // how long a hold takes to pick this up. delay = ms with
//                                     // nothing shown, duration = ms the move box takes to fill;
//                                     // defaults 500 + 800 (handles 250 + 450). Quick-to-move
//                                     // things go shorter; things you hold to play go longer.
//     revealMesh(ctx) {},             // optional: a light stand-in (Object3D, instance frame)
//                                     // Revelio draws, frozen and in one color, while this is
//                                     // hidden; else it copies what the app draws (heavy apps:
//                                     // give one; parts with userData.noReveal are skipped)
//     async stop(ctx, { removed }) {}, // app turned off, AR exited, or (removed: true)
//                                     // the instance was deleted
//   };
//
// ctx: app, instance { id, config, space, temporary, fresh (this device just placed it) }, root (Group in the instance's
// frame: y up, meters), THREE, now(), viewer(), toLocal(v), toLocalDir(v),
// surface() (latest hit-test point, local), status(text), actions([...]),
// log(msg), telemetry(event, data) (diagnostics: telemetry only), backend.get/post(path), backend.fetch(path, init) → Response,
// backend.socket(path) → WebSocket (binary: ArrayBuffer; closed on stop),
// channel(name, onMsg) → { send }, state.get/set, physics() → RAPIER
// (initialized), spawn(obj3d), prompt(label, value) → Promise<string|null>
// (one-shot text entry), keyboard.open({ label, kind, secret, onKey, onClose })
// → { close(), open } / keyboard.close() / keyboard.onSummon(fn) (live typing:
// each key arrives right away as { text } or { key }; see ui/keyboard.js;
// onSummon: the user asked for a keyboard (gesture) while this instance was
// the one last touched), menu(section) (a list on the app's menu page),
// panel({ title, sub, blocks, open }) (the app's own UI on its menu page: big buttons,
// steppers, toggles, choices; see ui/menu.js appPanel), renderer (three's, for one-off baking),
// clipboard.write(text) / read() → text (the
// Stratum clipboard, shared by your devices, plus the system clipboard
// where allowed), me() → this connection's id,
// settings.get(key) / settings.onChange(fn) (per-user, from the manifest's
// "settings" schema; edited on the app's menu page),
// sync({ onState, onEvent, onHost }) → shared state room (see makeSync),
// move() (pick this instance up: it follows the phone's aim / the Quest
// pointer until the next tap or pinch, then saves; e.g. a "Move" menu item).
import * as THREE from 'three';
import { api } from '../api.js';
import { telemetry } from '../telemetry.js';
import { SimClock } from './kit/simclock.js';
import { Watchdog, drawCost } from './perf.js';

// Hold-to-move (ms): a wait with nothing shown, then the box fills in.
export const MOVE_TIMING = { body: { delay: 500, duration: 800 }, handle: { delay: 250, duration: 450 },
  // Phones: the finger is already on the glass (no stray pinches), so shorter.
  touchBody: { delay: 200, duration: 500 }, touchHandle: { delay: 100, duration: 350 } };
const FRAME_BUDGET_MS = 4;          // per app per frame, averaged; warn above
const COST_EVERY_MS = 1000;         // how often each instance's draw cost (triangles, draw calls) is counted
const PERF_LOG_MS = 15_000;         // a performance summary to telemetry this often (while frames are reported)
const SLOW_FRAME_MS = 20;            // an app frame() longer than this is remembered for 2 s (perf.js: freezes)
const START_GRACE_MS = 1500;
const APP_LONG_MS = 30, APP_LONG_LOG_MS = 2000;   // an app frame() over this is logged (≤ once per 2 s per instance, with a count)         // (a new instance's first frames may do one-off setup)
const MANY_DRAWS = 60;               // an instance drawing with more draw calls than this gets a hint (telemetry)
const NO_LOD_TRIS = 60_000;         // an instance drawing more than this with no LOD gets a hint (telemetry, the performance page)
const PERF_ALLOW_KEY = 'stratum.perfAllow';
const LEASE_STALE_MS = 3000;       // a simulating device quiet this long has dropped (ctx.sync lease)
const MAX_ERRORS = 5;               // frame errors before an instance is stopped
const LOOSE_ERRORS = 5, LOOSE_WINDOW_MS = 10_000;   // other errors (hooks, callbacks, timers) within this long before it's stopped

let rapierPromise = null;
function loadRapier() {
  rapierPromise ??= import('/vendor/rapier/rapier.mjs').then(async (m) => {
    const R = m.default ?? m;
    await R.init();
    return R;
  });
  return rapierPromise;
}

export class AppRuntime {
  constructor({ world, live, log, viewer, surface, onChange, prompt, surfaces, keyboard, clipboard, carry, hands, controls, openPanel, renderer, device = 'phone' }) {
    this.openPanel = openPanel ?? null;           // (appId) → the menu up on that app's page (ctx.panel({ open }))
    this.renderer = renderer ?? null;             // (ctx.renderer: baking textures once, e.g. a skybox)
    this.controlsOf = controls ?? (() => null);   // () → { left, right } Quest controllers / hands (gamepad values)
    this.handsOf = hands ?? (() => null);       // () → HandView (Quest tracked hands) or null
    this.device = device;
    this.carry = carry ?? (() => {});           // (instance id) → host picks it up (ctx.move)                        // 'quest' | 'phone' (ctx.device)
    this.clipboard = clipboard ?? { write: async () => {}, read: async () => '' };
    this.keyboard = keyboard ?? null;            // { open(opts) → handle } (main.js: Quest keyboard / phone box)
    this.touched = null;                         // instance last tapped / swiped (keyboard summons go there)
    this.surfacesOf = surfaces ?? (() => []);   // room map (DESIGN.md §3.8)
    this.prompt = prompt ?? (async () => null);   // (label, value) => Promise<string|null>
    this.world = world;
    this.live = live;
    this.log = log;
    this.viewer = viewer;       // () => { position, quaternion } in world, or null
    this.surface = surface;     // () => Vector3 world point of the reticle, or null
    this.onChange = onChange;   // UI refresh (status/actions changed)
    this.apps = new Map();      // id -> info from /api/apps
    this.modules = new Map();   // id -> Promise<module>
    this.running = new Map();   // instance object id -> Instance
    this.failed = new Map();    // instance id -> { count, until }: back off restarts after failures
    this.crashed = new Map();   // app id -> { message, where, at }: stopped after a crash, restarting with backoff
    this.loose = new Map();     // app id -> recent error times (callbacks, timers, promises)
    this.channelHandlers = new Map();   // "app|channel" -> Set<fn>
    // Performance (perf.js): the watchdog, the headset's frame, apps you've allowed to be slow.
    this.watchdog = new Watchdog();
    this.frameNo = 0;
    this.frame = null;
    this.perfLogAt = performance.now();
    try { this.perfAllow = new Set(JSON.parse(localStorage.getItem(PERF_ALLOW_KEY) ?? '[]')); } catch { this.perfAllow = new Set(); }
    this.joined = new Set();    // app channel keys the server confirmed ("app:<app>:<channel>")
    live.handlers.appsubbed = (m) => { this.joined = new Set(m.channels); };
    this.hosts = new Map();   // "app|channel" -> { host, peers } (server-announced)
    live.handlers.host = (m) => {
      const key = `${m.app}|${m.channel}`;
      this.hosts.set(key, { host: m.host, peers: m.peers });
      for (const fn of this.hostHandlers.get(key) ?? []) {
        try { fn(); } catch (err) { this.report(m.app, err); }
      }
    };
    this.hostHandlers = new Map();
    live.handlers.app = (m) => {
      for (const fn of this.channelHandlers.get(`${m.app}|${m.channel}`) ?? []) {
        try { fn(m.msg, m.from); } catch (err) { this.report(m.app, err); }
      }
    };
  }

  async load() {
    const { apps } = await api.apps();
    this.apps = new Map(apps.map((a) => [a.id, a]));
    for (const a of apps) {
      if (a.layer) this.world.setLayerVisible(a.layer, a.enabled);
      this.world.setAppVisible(a.id, a.enabled);   // instances in shared layers too
    }
  }

  enabledApps() { return [...this.apps.values()].filter((a) => a.enabled); }

  async setEnabled(id, enabled) {
    const info = await api.setApp(id, enabled);
    const prev = this.apps.get(id);
    this.apps.set(id, { ...prev, ...info });
    const layer = info.layer ?? prev?.layer;
    if (layer) this.world.setLayerVisible(layer, enabled);
    this.world.setAppVisible(id, enabled);
    if (!enabled) for (const inst of [...this.running.values()]) if (inst.app.id === id) await this.stopInstance(inst);
    if (enabled && info.layer) {
      // First enable creates the app layer; existing objects may be in it.
      this.world.setLayerVisible(info.layer, true);
      await this.world.resync();
    }
    this.log(`${info.name} ${enabled ? 'on' : 'off'}`);
    this.onChange?.();
  }

  // An app setting changed (menu): save, then tell its running instances.
  async setSetting(appId, key, value) {
    const a = this.apps.get(appId);
    if (!a) return;
    const { values } = await api.setAppSettings(appId, { [key]: value });
    a.settingsValues = values;
    for (const inst of this.running.values()) {
      if (inst.app.id !== appId || !inst.started) continue;
      for (const fn of inst.settingsHandlers) { try { fn(key, value); } catch (err) { this.report(appId, err); } }
    }
    this.onChange?.();
  }

  // ---- lifecycle -------------------------------------------------------------

  update(dt) {
    // Start instances that are present, aligned and whose app is on.
    for (const e of this.world.objects.values()) {
      const spec = e.data.components?.app;
      if (!spec || !e.built || this.running.has(e.data.id)) continue;
      const fail = this.failed.get(e.data.id);
      if (fail && performance.now() < fail.until) continue;   // never retry every frame
      const app = this.apps.get(spec.app);
      const space = this.world.spaces.get(e.data.space);
      if (!app?.enabled || !space?.aligned || e.data.rev == null) continue;   // wait for the server copy
      if (this.world.slotHidden?.(e.data.id)) continue;                        // waiting in a turntable slot
      this.startInstance(app, e);
    }
    // Stop instances whose object went away.
    for (const inst of [...this.running.values()]) {
      const e = this.world.objects.get(inst.id);
      if (!e) { this.stopInstance(inst, { removed: true }); continue; }
      if (!e.built || this.world.slotHidden?.(inst.id)) { this.stopInstance(inst); continue; }   // (swiped off a turntable: stops)
      // Config changed elsewhere (another device chose a different device to control): restart with it.
      const cfg = JSON.stringify(e.data.components.app.config ?? {});
      if (cfg !== JSON.stringify(inst.config ?? {}) && !inst.sentConfigs?.includes(cfg)) { this.stopInstance(inst); continue; }
      if (e.built.root !== inst.parent) this.reparent(inst, e.built.root);   // rebuilt (e.g. edited)
    }
    // Frame.
    this.frameNo++;
    const now = performance.now();
    if (this.paused) return;   // (the slowdown test: apps paused and hidden)
    for (const inst of this.running.values()) {
      if (!inst.started) continue;
      if (now - (inst.perf.costAt ?? 0) > COST_EVERY_MS) {
        inst.perf.costAt = now;
        Object.assign(inst.perf, drawCost(inst.root));
        const sphere = new THREE.Box3().setFromObject(inst.root).getBoundingSphere(new THREE.Sphere());   // (where it is: the fps meter's "in view")
        inst.perf.center = sphere.isEmpty() ? null : sphere.center;
        inst.perf.radius = sphere.isEmpty() ? 0 : sphere.radius;
        if (inst.perf.tris > NO_LOD_TRIS && !inst.perf.lods && !inst.perf.warnedLod) {   // a hint for the app's author (once)
          inst.perf.warnedLod = true;
          console.info(`[${inst.app.id}] draws ${Math.round(inst.perf.tris / 1000)}k triangles with no LOD: see apps/README.md "Performance"`);
          telemetry.warn('perf no lod', { app: inst.app.id, tris: inst.perf.tris, draws: inst.perf.draws });
        }
        if (inst.perf.draws > MANY_DRAWS && !inst.perf.warnedDraws) {   // each draw call costs CPU on the headset (and per eye)
          inst.perf.warnedDraws = true;
          console.info(`[${inst.app.id}] ${inst.perf.draws} draw calls: share materials, instance repeated things, merge static parts (apps/README.md "Performance")`);
          telemetry.warn('perf many draws', { app: inst.app.id, draws: inst.perf.draws, tris: inst.perf.tris });
        }
      }
      if (!inst.module.frame) continue;
      // Throttled by the watchdog: frame() every `throttle` frames, with the time that passed.
      inst.pendingDt = (inst.pendingDt ?? 0) + dt;
      if (inst.throttle > 1 && (this.frameNo + inst.phase) % inst.throttle) continue;
      const t0 = performance.now();
      try {
        inst.module.frame(inst.ctx, inst.pendingDt);
      } catch (err) {
        if (++inst.errors >= MAX_ERRORS) { this.crash(inst, err, 'frame'); continue; }
      }
      inst.pendingDt = 0;
      const raw = performance.now() - t0;
      const ms = raw / (inst.throttle || 1);   // (per frame: a throttled app's cost is spread over its frames)
      inst.perf.lastMs = ms;
      if (raw > SLOW_FRAME_MS && t0 - (inst.startedAt ?? 0) > START_GRACE_MS) {   // long frames, kept a moment (the watchdog's freeze rule; not its first moments: setting up)
        const slow = (inst.perf.slow ??= []);
        slow.push([t0, raw]);
        while (slow.length && t0 - slow[0][0] > 2000) slow.shift();
        if (raw > APP_LONG_MS) this.logLong(inst, raw, t0);
      }
      inst.avgMs = inst.avgMs * 0.95 + ms * 0.05;
      inst.perf.peak = Math.max(ms, (inst.perf.peak ?? 0) * 0.995);
      if (inst.avgMs > FRAME_BUDGET_MS && !inst.warnedBudget) {
        inst.warnedBudget = true;
        telemetry.warn(`app ${inst.app.id} over frame budget: ${inst.avgMs.toFixed(1)} ms`);
      }
    }
  }

  startInstance(app, entry) {
    const inst = {
      id: entry.data.id, app, config: entry.data.components.app.config ?? {}, space: entry.data.space,
      root: new THREE.Group(), parent: null, module: null, ctx: null, started: false, errors: 0, avgMs: 0, sims: [],
      perf: {}, throttle: 1, phase: Math.floor(Math.random() * 2),
      status: '', actions: [], channels: [], listeners: [], settingsHandlers: [],
    };
    inst.root.userData.appInstance = inst.id;
    this.running.set(inst.id, inst);
    this.reparent(inst, entry.built.root);
    // The device that just placed it: the app may open an editor (ctx.instance.fresh).
    const f = this.expectFresh;
    inst.fresh = !!(f && f.app === app.id && performance.now() - f.at < 4000);
    if (inst.fresh) this.expectFresh = null;
    inst.ctx = this.makeCtx(inst);
    this.modules.set(app.id, this.modules.get(app.id) ?? import(app.entry));
    this.modules.get(app.id).then(async (mod) => {
      if (this.running.get(inst.id) !== inst) return;   // stopped meanwhile
      inst.module = mod.default ?? mod;
      try {
        await inst.module.start?.(inst.ctx);
        this.failed.delete(inst.id);
        this.crashed.delete(app.id);
        inst.started = true;
        inst.startedAt = performance.now();
        this.onChange?.();   // status/actions set during start() can show now
        telemetry.info(`app ${app.id} started`, { instance: inst.id });
      } catch (err) {
        this.crash(inst, err, 'start');
      }
    }).catch((err) => { this.modules.delete(app.id); this.crash(inst, err, 'load'); });
  }

  // An app's stand-in for Revelio: { object, parent } (add object to parent to
  // place it in the instance frame), or null if the app has none.
  revealMesh(id) {
    const inst = this.running.get(id);
    if (!inst?.started || !inst.module.revealMesh) return null;
    try {
      const object = inst.module.revealMesh(inst.ctx);
      return object ? { object, parent: inst.root } : null;
    } catch (err) { this.report(inst.app.id, err); return null; }
  }

  // Retry a failed instance after 2 s, 4 s, 8 s … (max 60 s).
  backoff(id) {
    const count = (this.failed.get(id)?.count ?? 0) + 1;
    this.failed.set(id, { count, until: performance.now() + Math.min(60_000, 1000 * 2 ** count) });
  }

  reparent(inst, parent) {
    inst.root.removeFromParent();
    parent.add(inst.root);
    inst.parent = parent;
    if (inst.app.ownHandle) parent.traverse((n) => { if (n.userData.puck) n.visible = false; });   // the app draws its own
  }

  async stopInstance(inst, { removed = false } = {}) {
    if (this.running.get(inst.id) !== inst) return;
    this.running.delete(inst.id);
    try { if (inst.started) await inst.module.stop?.(inst.ctx, { removed }); } catch (err) { this.report(inst.app.id, err); }
    for (const ch of inst.channels) this.leaveChannel(inst, ch);
    for (const off of inst.listeners) off();
    inst.kb?.close();
    if (this.touched === inst) this.touched = null;
    inst.root.removeFromParent();
    try {
      inst.root.traverse((n) => { n.geometry?.dispose?.(); [].concat(n.material ?? []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    } catch (err) { this.report(inst.app.id, err); }
    this.onChange?.();
  }

  report(appId, err) {
    this.log(`error: app ${appId}: ${err?.message ?? err}`);
    telemetry.error(`app ${appId}: ${err?.message ?? err}`, { stack: err?.stack });
    this.tally(appId, err);
  }

  // ---- crash isolation ------------------------------------------------------------
  // One app's error must not take down the page, the XR loop or other apps.
  // Hooks are called in try/catch; main.js also guards each step of the frame
  // loop, hit tests and rendering, and sends what it catches here.

  // Which app an error came from, by its stack (app code is served from /apps/<id>/).
  appFromError(err) {
    const m = String(err?.stack ?? '').match(/\/apps\/([a-z][a-z0-9-]*)\//);
    return m && this.apps.has(m[1]) ? m[1] : null;
  }

  // Stop it (an instance, or every instance of an app id), hide it, and say so;
  // it restarts later with backoff (2 s, 4 s … 60 s).
  crash(target, err, where) {
    const appId = typeof target === 'string' ? target : target.app.id;
    const insts = typeof target === 'string' ? [...this.running.values()].filter((i) => i.app.id === appId) : [target];
    const message = String(err?.message ?? err).slice(0, 140);
    this.log(`error: app ${appId} crashed (${where}): ${message}`);
    telemetry.error(`app ${appId} crashed (${where}): ${message}`, { stack: err?.stack, instances: insts.map((i) => i.id) });
    this.crashed.set(appId, { message, where, at: Date.now() });
    for (const inst of insts) {
      inst.root.visible = false;
      this.backoff(inst.id);
      this.stopInstance(inst);
    }
    this.onChange?.();
  }

  // ---- performance (perf.js) ---------------------------------------------------------

  // Each XR frame, from the host: { fps, workMs, budgetMs, target, dropped }. Runs the watchdog.
  // The slowdown test (perfprobe.js): every app's frame() skipped and its things hidden, or back.
  setPaused(on) {
    this.paused = !!on;
    for (const i of this.running.values()) {
      if (on) { i.hiddenByPause = i.root.visible; i.root.visible = false; }
      else if (i.hiddenByPause !== undefined) { i.root.visible = i.hiddenByPause; delete i.hiddenByPause; }
    }
  }

  noteFrame(frame) {
    this.frame = frame;
    if (this.probing) return;   // (the slowdown test turns things off on purpose: no verdicts meanwhile)
    if (frame.emulated) return;   // (a desktop emulator's frames: no verdicts; tests feed frames themselves)
    const now = performance.now();
    const insts = [...this.running.values()].filter((i) => i.started);
    const acts = this.watchdog.update(now, frame, insts.map((i) => ({ id: i.id, ms: i.avgMs, tris: i.perf.tris ?? 0, allowed: this.perfAllow.has(i.app.id), slow: i.perf.slow })));
    for (const a of acts) {
      const inst = this.running.get(a.id);
      if (!inst) continue;
      if (a.act === 'throttle') this.throttle(inst, 2, a.why);
      else if (a.act === 'unthrottle') this.throttle(inst, 1, a.why);
      else if (a.act === 'stop') this.slowStop(inst, a.why, a.freeze);
    }
    if (now - this.perfLogAt > PERF_LOG_MS) {
      this.perfLogAt = now;
      const top = this.perfReport().apps.slice(0, 5).map((a) => ({ app: a.app, ms: +a.ms.toFixed(2), peak: +(a.peak ?? 0).toFixed(1), phys: +a.physMs.toFixed(2), tris: a.tris, draws: a.draws, throttled: a.throttled }));
      telemetry.info('perf', { fps: +frame.fps.toFixed(1), target: frame.target, workMs: +frame.workMs.toFixed(2), dropped: frame.dropped, apps: top });
    }
  }

  // Run an instance's frame() every `every` frames (1 = always); its physics clocks step at most one frame's worth per call.
  throttle(inst, every, why = '') {
    if (inst.throttle === every) return;
    inst.throttle = every;
    for (const c of inst.sims) c.limit = every > 1 ? Math.max(1, Math.ceil(1 / ((this.frame?.target ?? 72) * c.step))) : Infinity;
    telemetry.warn(every > 1 ? `app ${inst.app.id} throttled: ${why}` : `app ${inst.app.id} back to full speed`, { instance: inst.id, ...this.costOf(inst) });
    this.onChange?.();
  }

  // Stopped for hogging the headset: shown in the menu (⚠️ … Run anyway), not restarted by itself.
  slowStop(inst, why, freeze = false) {
    const appId = inst.app.id, message = freeze ? `${why[0].toUpperCase()}${why.slice(1)}: stopped` : `Slowed things down (${why}): stopped`;
    telemetry.warn(`app ${appId} stopped: slowed things down (${why})`, { instance: inst.id, ...this.costOf(inst), frame: this.frame });
    this.log(`${appId}: ${message}`);
    this.crashed.set(appId, { message, where: 'slow', slow: true, at: Date.now() });
    this.failed.set(inst.id, { count: 0, until: Infinity, slow: true });
    inst.root.visible = false;
    this.stopInstance(inst);
    this.onChange?.();
  }

  // "Run anyway": never throttle / stop this app on this device, and start it again.
  allowSlow(appId) {
    this.perfAllow.add(appId);
    try { localStorage.setItem(PERF_ALLOW_KEY, JSON.stringify([...this.perfAllow])); } catch {}
    this.crashed.delete(appId);
    for (const [id, f] of this.failed) if (f.slow) this.failed.delete(id);
    for (const i of this.running.values()) if (i.app.id === appId) this.throttle(i, 1);
    this.onChange?.();
  }

  disallowSlow(appId) {
    this.perfAllow.delete(appId);
    try { localStorage.setItem(PERF_ALLOW_KEY, JSON.stringify([...this.perfAllow])); } catch {}
    this.onChange?.();
  }

  costOf(inst) {
    const physMs = inst.sims.reduce((s, c) => s + c.ms, 0);
    return { ms: inst.avgMs, peak: inst.perf.peak ?? 0, physMs, tris: inst.perf.tris ?? 0, draws: inst.perf.draws ?? 0, lods: inst.perf.lods ?? 0,
      sims: inst.sims.length, asleep: inst.sims.length > 0 && inst.sims.every((c) => c.asleep) };
  }

  // For the menu / tests: the frame, and each running instance's cost, costliest first.
  // An app frame() that took long: what it was doing (its sims; its own debug(ctx) state, if it has one).
  logLong(inst, ms, now) {
    const l = (inst.perf.long ??= { at: 0, count: 0, worst: 0 });
    l.count++; l.worst = Math.max(l.worst, ms);
    if (now - l.at < APP_LONG_LOG_MS) return;
    let state;
    try { state = inst.module.debug?.(inst.ctx); } catch (err) { state = { error: String(err?.message ?? err) }; }
    telemetry.warn(`app ${inst.app.id} long frame`, { ms: +ms.toFixed(1), since: l.count, worstMs: +l.worst.toFixed(1), avgMs: +inst.avgMs.toFixed(2),
      throttle: inst.throttle, sims: inst.sims.map((c) => ({ steps: c.lastSteps, stepMs: +c.ms.toFixed(2), asleep: c.asleep, limit: Number.isFinite(c.limit) ? c.limit : null })),
      tris: inst.perf.tris, draws: inst.perf.draws, state });
    l.at = now; l.count = 0; l.worst = 0;
  }

  // Where a press along this ray (world) would land, if an app taking presses
  // anywhere says (its aim(ctx, localRay) hook: e.g. the play-area kit's corner
  // on its level). World point or null. (The cursor dot.)
  aimPoint(ray) {
    for (const i of this.running.values()) {
      if (!i.started || !i.module.aim || !i.module.press) continue;
      try {
        if (!i.module.globalPress?.(i.ctx, {})) continue;
        const local = { origin: i.ctx.toLocal(ray.origin.clone()), dir: i.ctx.toLocalDir(ray.dir.clone()) };
        const p = i.module.aim(i.ctx, local);
        if (p) return i.root.localToWorld(p.clone());
      } catch { /* (an app's aim: never the frame's problem) */ }
    }
    return null;
  }

  // This frame's cost per running instance (the fps meter): ms of frame() (a
  // throttled app's spread over its frames), and where it is (world, ~1 s old).
  frameCosts() {
    const out = [];
    for (const i of this.running.values()) {
      if (!i.started) continue;
      out.push({ id: i.app.id, name: i.app.name, icon: i.app.icon, color: i.app.color, ms: i.module.frame ? i.perf.lastMs ?? 0 : 0, tris: i.perf.tris ?? 0, draws: i.perf.draws ?? 0, center: i.perf.center ?? null, radius: i.perf.radius ?? 0 });
    }
    return out;
  }

  perfReport() {
    const apps = [...this.running.values()].filter((i) => i.started).map((i) => ({
      app: i.app.id, name: i.app.name, icon: i.app.icon, instance: i.id, ...this.costOf(i),
      throttled: i.throttle > 1, allowed: this.perfAllow.has(i.app.id),
      noLod: (i.perf.tris ?? 0) > NO_LOD_TRIS && !(i.perf.lods > 0),
    })).sort((a, b) => b.ms - a.ms);
    const stopped = [...this.crashed.entries()].filter(([, c]) => c.slow).map(([app, c]) => ({ app, message: c.message }));
    return { frame: this.frame, apps, stopped, overloaded: !!this.watchdog.overloaded };
  }

  // An error that escaped (timer, callback, promise). → true if it was an app's.
  looseError(err) {
    const appId = this.appFromError(err);
    if (!appId) return false;
    this.tally(appId, err);
    return true;
  }

  // Caught errors in hooks/callbacks count too: a few within 10 s and it's a crash.
  tally(appId, err) {
    const now = performance.now();
    const times = (this.loose.get(appId) ?? []).filter((t) => now - t < LOOSE_WINDOW_MS);
    times.push(now);
    this.loose.set(appId, times);
    if (times.length >= LOOSE_ERRORS) { this.loose.delete(appId); this.crash(appId, err, 'callback'); }
  }

  // The instance to stop first when something unattributable breaks every frame: the newest.
  suspect() {
    let best = null;
    for (const i of this.running.values()) if (i.started && (!best || i.startedAt > best.startedAt)) best = i;
    return best;
  }

  // ---- input ----------------------------------------------------------------------

  // The user asked for a keyboard (Quest gesture): the selected instance if
  // it takes typing, else the one last touched. → true if an app took it.
  summonKeyboard(selectedId) {
    const takes = (i) => i?.started && i.summon;
    const inst = [this.running.get(selectedId), this.touched].find(takes);
    if (!inst) return false;
    try { inst.summon(); } catch (err) { this.report(inst.app.id, err); }
    return true;
  }

  // A sample of one of an app's variants (for the place chooser): the app's
  // optional preview(THREE, variantKey) → Object3D. null if it has none.
  async preview(appId, variantKey) {
    const app = this.apps.get(appId);
    if (!app) return null;
    if (!this.modules.has(appId)) this.modules.set(appId, import(app.entry));
    try {
      const m = await this.modules.get(appId);
      const mod = m.default ?? m;
      return mod.preview ? mod.preview(THREE, variantKey) : null;
    } catch (err) {
      this.report(appId, err);
      return null;
    }
  }

  // Which running instance (if any) owns this scene node, and is it the handle?
  ownerOf(node) {
    let handle = false;
    for (let n = node; n; n = n.parent) {
      if (n.userData?.handle) handle = true;
      if (n.userData?.appInstance) return { inst: this.running.get(n.userData.appInstance), handle };
    }
    return { inst: null, handle };
  }

  // A tap/trigger hit something. Returns true if an app took it.
  select(hit, ray) {
    const { inst, handle } = this.ownerOf(hit.object);
    if (!inst || handle || !inst.started || !inst.module.select) return false;
    this.touched = inst;
    const call = () => inst.module.select(inst.ctx, {
      object: hit.object, point: inst.ctx.toLocal(hit.point.clone()), uv: hit.uv?.clone() ?? null,
      ray: { origin: inst.ctx.toLocal(ray.origin.clone()), dir: inst.ctx.toLocalDir(ray.dir.clone()) },
    });
    try { call(); } catch (err) { this.report(inst.app.id, err); }
    return true;
  }

  // How long a hold on what was hit takes to pick it up (DESIGN.md §8.4):
  // nothing shows for `delay` ms (so a plain pinch never flickers a box),
  // then the move box draws itself in over `duration` ms; let go before it
  // closes and nothing moves. Apps set it with a moveTiming object, or a
  // function (ctx, { handle, source, object }) → { delay, duration }.
  moveTiming(hit, source) {
    const { inst, handle } = this.ownerOf(hit.object);
    const t0 = source === 'touch' ? (handle ? MOVE_TIMING.touchHandle : MOVE_TIMING.touchBody) : handle ? MOVE_TIMING.handle : MOVE_TIMING.body;
    const base = { ...t0 };
    const m = inst?.started && inst.module.moveTiming;
    if (!m) return base;
    let t = m;
    if (typeof m === 'function') {
      try { t = m(inst.ctx, { handle, source, object: hit.object }); } catch (err) { this.report(inst.app.id, err); t = null; }
    }
    const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return { delay: clamp(t?.delay, 0, 3000, base.delay), duration: clamp(t?.duration, 150, 5000, base.duration) };
  }

  // The host is about to move what was hit with its default gesture. The
  // owning app's grab(ctx, e) may e.preventDefault(). True = go ahead.
  mayMove(hit, how, source) {
    const { inst, handle } = this.ownerOf(hit.object);
    if (!inst?.started || !inst.module.grab) return true;
    let prevented = false;
    const e = { how, source, handle, object: hit.object, point: inst.ctx.toLocal(hit.point.clone()), preventDefault() { prevented = true; } };
    try { inst.module.grab(inst.ctx, e); } catch (err) { this.report(inst.app.id, err); }
    return !prevented;
  }

  // A press going down or up (DESIGN.md §6). gesture: { phase, id (the
  // input source), hit, side, source }. 'up' goes to whoever took 'down'.
  // Returns true if an app took it.
  press(gesture) {
    this.pressed ??= new Map();   // input source → instances that took its 'down'
    let targets;
    if (gesture.phase === 'up') {
      const down = this.pressed.get(gesture.id);
      this.pressed.delete(gesture.id);
      if (!down) return false;
      targets = down.took;
      gesture = { ...down.gesture, phase: 'up', hit: null };   // same side / source as its 'down'
    } else {
      const own = gesture.hit && this.ownerOf(gesture.hit.object);
      if (own?.handle) return false;   // handles belong to the host (select it, move it)
      const mine = own?.inst && !own.handle && own.inst.started && own.inst.module.press ? [own.inst] : null;
      targets = mine ?? [...this.running.values()].filter((i) => i.started && i.module.press && i.module.globalPress?.(i.ctx, { source: gesture.source, side: gesture.side }));
    }
    const took = [];
    for (const inst of targets) {
      const ray = gesture.ray;
      const e = { phase: gesture.phase, side: gesture.side, source: gesture.source,
        object: gesture.hit?.object ?? null, point: gesture.hit ? inst.ctx.toLocal(gesture.hit.point.clone()) : null,
        // This input's ray right now, in the instance frame (follow it while held), or null.
        ray: () => { const r = ray?.(); return r ? { origin: inst.ctx.toLocal(r.origin.clone()), dir: inst.ctx.toLocalDir(r.dir.clone()) } : null; } };
      try { if (inst.module.press(inst.ctx, e) !== false) took.push(inst); } catch (err) { this.report(inst.app.id, err); }
    }
    if (gesture.phase === 'down' && took.length) { this.pressed.set(gesture.id, { took, gesture }); this.touched = took[0]; }
    return took.length > 0;
  }

  // Screen swipe (phones). gesture.hit = what the finger first touched (or
  // null). Returns true if an app took it.
  swipe(gesture) {
    const target = gesture.target && this.running.get(gesture.target);
    const targets = target?.started && target.module.swipe ? [target] : this.swipeTargets(gesture.hit);
    if (targets.length === 1) this.touched = targets[0];
    for (const inst of targets) {
      try { inst.module.swipe(inst.ctx, gesture); } catch (err) { this.report(inst.app.id, err); }
    }
    return targets.length > 0;
  }

  swipeTargets(hit) {
    const own = hit && this.ownerOf(hit.object);
    if (own?.inst && !own.handle && own.inst.started && own.inst.module.swipe) return [own.inst];
    return [...this.running.values()].filter((i) => i.started && i.module.swipe && i.module.globalSwipe?.(i.ctx));
  }

  wantsSwipes(hit) { return this.swipeTargets(hit).length > 0; }

  // Status lines + action buttons of running apps (for the overlay).
  uiState() {
    return [...this.running.values()].filter((i) => i.started).map((i) => ({
      app: i.app, status: i.status, actions: i.actions, instance: i.id, menu: i.menu ?? null, panel: i.panel ?? null,
    }));
  }

  // ---- ctx ------------------------------------------------------------------------

  makeCtx(inst) {
    const rt = this;
    const app = inst.app;
    const base = `/apps/${app.id}/api`;
    const inv = new THREE.Matrix4();
    const localMatrix = () => { inst.root.updateWorldMatrix(true, false); return inv.copy(inst.root.matrixWorld).invert(); };
    async function backend(method, path, body) {
      const r = await fetch(base + path, {
        method, credentials: 'same-origin',
        headers: body !== undefined ? { 'content-type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(`${app.id} ${method} ${path} → ${r.status} ${await r.text()}`);
      return r.json();
    }
    return {
      app: { id: app.id, name: app.name },
      instance: { id: inst.id, config: inst.config, space: inst.space, temporary: rt.world.isTemporary(inst.space), fresh: inst.fresh },
      root: inst.root,
      device: rt.device,   // 'quest' (hands / controllers) | 'phone' (touch: tap to use, hold to move)
      THREE,
      get renderer() { return rt.renderer; },
      now: () => rt.live.now(),
      log: (msg) => rt.log(`${app.id}: ${msg}`),
      // Quiet diagnostics: to telemetry only (not the on-screen log).
      telemetry: (event, data) => telemetry.info(`app ${app.id}: ${event}`, data),
      move: () => rt.carry(inst.id),
      // Quest controllers and tracked hands, as values (null on phones):
      // { left, right } each null or { trigger 0..1 (a hand: pinch), squeeze 0..1,
      // stick [x, y] (-1..1, right / down +), hand (true: a tracked hand, no stick) }.
      controls: () => rt.controlsOf(),
      // Who is playing on this device: { id (stable user id), name }.
      player: () => ({ id: rt.live.user?.id ?? rt.live.id ?? 'me', name: rt.live.user?.name ?? 'me' }),
      // Tracked hands in this instance's frame (Quest; null elsewhere or untracked):
      // { left, right } each null or { joints: [25 Vector3] (WebXR order: 0 wrist,
      // 4 thumb tip, 9 index tip, 14 middle tip, 19 ring tip, 24 pinky tip),
      // palm: { position, quaternion } (x across, y toward the fingers, z out of
      // the palm), pinch (thumb–index tip distance, local units), scale (local
      // units per meter: sizes of real things, e.g. a 1 cm fingertip = 0.01 * scale) }.
      hands() {
        const hv = rt.handsOf();
        if (!hv) return null;
        const m = localMatrix(), scale = new THREE.Vector3().setFromMatrixScale(m).x;
        const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
        const out = { left: null, right: null };
        for (const side of ['left', 'right']) {
          if (!hv.hands[side]?.tracked) continue;
          const joints = hv.hands[side].pos.map((p) => p.clone().applyMatrix4(m));
          const w = hv.wrist(side);
          const position = new THREE.Vector3().setFromMatrixPosition(w).applyMatrix4(m);
          const quaternion = rot.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(w));
          out[side] = { joints, palm: { position, quaternion }, pinch: joints[4].distanceTo(joints[9]), scale };
        }
        return out.left || out.right ? out : null;
      },
      status(text) { if (inst.status !== text) { inst.status = text; rt.onChange?.(); } },
      actions(list) { inst.actions = list; rt.onChange?.(); },
      // A section on the app's page in the menu (Quest + phone), e.g. saved
      // hosts: { title, items: [{ label, sub, emoji, run, remove }], add: { label, run } }.
      // null removes it. remove (optional) shows a trash button on the item.
      menu(section) { inst.menu = section; rt.onChange?.(); },   // section.pin: also on the menu's Home tab
      // The app's own UI on its menu page (hand menu and phone): full-size controls from blocks
      // (ui/menu.js appPanel); null clears it. spec.open: bring the menu up on that page now.
      panel(spec) { inst.panel = spec ?? null; rt.onChange?.(); if (spec?.open) rt.openPanel?.(inst.app.id); },
      viewer() {
        const v = rt.viewer();
        if (!v) return null;
        const m = localMatrix();
        const position = v.position.clone().applyMatrix4(m);
        const rot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
        return { position, quaternion: rot.multiply(v.quaternion.clone()) };
      },
      toLocal: (v) => v.applyMatrix4(localMatrix()),
      toLocalDir: (v) => v.transformDirection(localMatrix()),
      surface() { const p = rt.surface(); return p ? p.clone().applyMatrix4(localMatrix()) : null; },
      spawn(obj) { inst.root.add(obj); return obj; },
      physics: () => {
        if (!app.permissions.includes('physics')) throw new Error(`${app.id} lacks the 'physics' permission`);
        return loadRapier();
      },
      backend: {
        get: (path) => backend('GET', path),
        post: (path, body = {}) => backend('POST', path, body),
        fetch: (path, init = {}) => fetch(base + path, { credentials: 'same-origin', ...init }),
        // A WebSocket to the backend (through Stratum, signed like requests); closed when the instance stops.
        socket: (path) => {
          const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/apps/${app.id}/socket${path}`);
          ws.binaryType = 'arraybuffer';
          inst.listeners.push(() => ws.close());
          return ws;
        },
      },
      clipboard: { write: (text) => rt.clipboard.write(String(text)), read: () => rt.clipboard.read() },
      prompt: (label, value = '', opts = {}) => rt.prompt(label, value, opts),   // opts: { secret }
      keyboard: {
        open(opts = {}) {
          if (!rt.keyboard) return { close() {}, open: false };
          inst.kb?.close();
          const h = rt.keyboard.open({ ...opts, label: opts.label ?? app.name,
            onKey: (ev) => { try { opts.onKey?.(ev); } catch (err) { rt.report(app.id, err); } },
            onClose: (why) => { if (inst.kb === h) inst.kb = null; try { opts.onClose?.(why); } catch (err) { rt.report(app.id, err); } } });
          inst.kb = h;
          rt.touched = inst;
          return h;
        },
        close() { inst.kb?.close(); inst.kb = null; },
        get isOpen() { return !!inst.kb?.open; },
        onSummon(fn) { inst.summon = fn; },
      },
      me: () => rt.live.id,
      settings: {
        get(key) {
          const a = rt.apps.get(app.id);
          const v = a?.settingsValues?.[key];
          return v !== undefined ? v : a?.settings?.find((s) => s.key === key)?.default;
        },
        onChange(fn) { inst.settingsHandlers.push(fn); },
      },
      // Save this instance's config (e.g. which device a switch controls):
      // stored with the object, shared with everyone who sees it.
      setConfig(config) {
        config = JSON.parse(JSON.stringify(config ?? {}));   // (a copy: later edits to the app's own objects aren't saves)
        inst.config = config;
        this.instance.config = config;
        // The server echoes each save back; an echo of an older one of ours (saves in quick succession) isn't a change from elsewhere.
        inst.sentConfigs = [...(inst.sentConfigs ?? []), JSON.stringify(config)].slice(-8);
        const e = rt.world.objects.get(inst.id);
        if (e) rt.world.setComponents(inst.id, { ...e.data.components, app: { ...e.data.components.app, config } });
      },
      // The room map of this instance's Space, in the instance frame:
      // [{ id, kind, matrix (plane frame, +Y = normal), polygon [[x, z]…] }].
      surfaces() {
        const space = rt.world.spaces.get(inst.space);
        if (!space) return [];
        const toLocal = localMatrix().clone().multiply(space.root.matrix);
        return rt.surfacesOf(inst.space).map((s) => ({ id: s.id, kind: s.kind, polygon: s.polygon,
          matrix: toLocal.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...s.pose.p), new THREE.Quaternion(...s.pose.q), new THREE.Vector3(1, 1, 1))) }));
      },
      sync: (handlers) => rt.makeSync(inst, handlers),
      // Fixed-step physics that sleeps when nothing's happening (kit/simclock.js); its time counts as this app's physics.
      sim: (opts) => { const c = new SimClock(opts); inst.sims.push(c); return c; },
      channel(name, onMsg) {
        rt.joinChannel(inst, name, onMsg);
        return { send: (msg) => rt.live.sendApp(app.id, name, msg) };
      },
      state: {
        get: async (key) => (await api.appState(app.id, key)).value,
        set: (key, value) => api.setAppState(app.id, key, value),
      },
    };
  }

  // Shared state for one app instance, for everyone who has it running:
  //
  //   const room = ctx.sync({
  //     onState(state, from) {},   // the host's latest snapshot (not called on the host)
  //     onEvent(event, from) {},   // any member's event, the sender's own included
  //     onHost(isHost, peers) {},  // host or room size changed
  //   });
  //   room.isHost   true on exactly one device (until the server says otherwise,
  //                 a lone device assumes it is: single player never waits)
  //   room.peers    devices in the room
  //   room.state(s) host: broadcast a snapshot (keep it small; send on change
  //                 and when peers grows, so newcomers catch up)
  //   room.event(e) anyone: e.g. "putt (vx, vz)"; the host applies it
  //
  // The host runs the simulation; others render its snapshots. If the host
  // leaves, the server promotes the next member, which carries on from the
  // last snapshot it received.
  //
  // Physics that follows the player (DESIGN.md §6.7): instead of a fixed
  // host, whoever is touching the thing runs the simulation locally (no
  // network between their hand and the physics) and the others watch.
  //   room.claim()     → true if this device now simulates (false: someone
  //                     else is; their lease lapses after LEASE_STALE_MS quiet)
  //   room.mine        this device holds the lease
  //   room.holder      connection id of the simulating device, or null
  //   room.stream(d)   holder: live poses for the watchers (onStream)
  //   room.settle(d)   holder: everything's at rest; d becomes the shared
  //                     resting state (onRest everywhere, rev + 1) and the lease is free
  //   room.rest        { rev, d } latest resting state (newcomers ask for it)
  //   room.seed(d)     a starting rest if nobody has one yet (rev 0)
  //   onLease(holder, mine) · onStream(d, by) · onRest(d, by)
  // Claim races: the earlier claim (server clock) wins; the other yields.
  makeSync(inst, { onState, onEvent, onHost, onLease, onStream, onRest } = {}) {
    const name = `sync-${inst.id}`;
    const key = `${inst.app.id}|${name}`;
    const rt = this;
    const lease = { holder: null, ts: 0, heard: 0 };
    const me = () => rt.live.id ?? 'me';
    const send = (msg) => rt.live.sendApp(inst.app.id, name, { ...msg, by: me() });
    const setHolder = (h) => { if (lease.holder === h) return; lease.holder = h; try { onLease?.(h, h === me()); } catch (err) { rt.report(inst.app.id, err); } };
    const room = {
      isHost: true, peers: 1, rest: null,
      get holder() {
        if (lease.holder && lease.holder !== me() && performance.now() - lease.heard > LEASE_STALE_MS) setHolder(null);
        return lease.holder;
      },
      get mine() { return lease.holder === me(); },
      claim() {
        const h = room.holder;
        if (h && h !== me()) return false;
        if (h === me()) return true;
        lease.ts = rt.live.now();
        setHolder(me());
        send({ k: 'c', ts: lease.ts });
        return true;
      },
      stream(d) { if (room.mine) send({ k: 'p', d }); },
      settle(d) {
        if (!room.mine) return;
        room.rest = { rev: (room.rest?.rev ?? 0) + 1, d };
        send({ k: 'r', rev: room.rest.rev, d });
        setHolder(null);
      },
      seed(d, rev = 0) { if (!room.rest || room.rest.rev < rev) room.rest = { rev, d }; },
      state(s) { if (room.isHost) rt.live.sendApp(inst.app.id, name, { k: 's', d: s, by: rt.live.id }); },
      event(e) {
        rt.live.sendApp(inst.app.id, name, { k: 'e', d: e, by: rt.live.id });
        onEvent?.(e, rt.live.id);
      },
    };
    const hostChanged = () => {
      const h = rt.hosts.get(key);
      if (!h) return;
      const was = [room.isHost, room.peers];
      room.isHost = h.host === rt.live.id;
      room.peers = h.peers;
      if (was[0] !== room.isHost || was[1] !== room.peers) onHost?.(room.isHost, room.peers);
    };
    if (!this.hostHandlers.has(key)) this.hostHandlers.set(key, new Set());
    this.hostHandlers.get(key).add(hostChanged);
    inst.listeners.push(() => this.hostHandlers.get(key)?.delete(hostChanged));
    this.joinChannel(inst, name, (msg) => {   // `by` = sender's connection id (compare with ctx.me())
      if (msg?.k === 's') { if (!room.isHost) onState?.(msg.d, msg.by); }
      else if (msg?.k === 'e') onEvent?.(msg.d, msg.by);
      else if (msg?.k === 'c') {
        // Someone claimed. If we hold it and claimed first, keep it (they yield on ours).
        if (room.mine && (lease.ts < msg.ts || (lease.ts === msg.ts && me() < msg.by))) return;
        lease.ts = msg.ts;
        lease.heard = performance.now();
        setHolder(msg.by);
      } else if (msg?.k === 'p') {
        if (room.mine) return;
        lease.heard = performance.now();
        if (!lease.holder) setHolder(msg.by);
        if (msg.by === lease.holder) onStream?.(msg.d, msg.by);
      } else if (msg?.k === 'r') {
        if (lease.holder === msg.by) setHolder(null);
        if (room.rest && room.rest.rev >= msg.rev) return;
        room.rest = { rev: msg.rev, d: msg.d };
        onRest?.(msg.d, msg.by);
      } else if (msg?.k === 'q') {
        if (room.rest && (room.mine || !lease.holder)) send({ k: 'r', rev: room.rest.rev, d: room.rest.d });
      }
    });
    if (onRest) {   // newcomer: ask for the resting state (again once the room is joined)
      send({ k: 'q' });
      const t = setTimeout(() => send({ k: 'q' }), 1200);
      inst.listeners.push(() => clearTimeout(t));
    }
    return room;
  }

  joinChannel(inst, name, fn) {
    const key = `${inst.app.id}|${name}`;
    if (!this.channelHandlers.has(key)) this.channelHandlers.set(key, new Set());
    this.channelHandlers.get(key).add(fn);
    inst.channels.push({ name, fn });
    this.syncChannels();
  }

  leaveChannel(inst, { name, fn }) {
    this.channelHandlers.get(`${inst.app.id}|${name}`)?.delete(fn);
    this.syncChannels();
  }

  syncChannels() {
    const list = [];
    for (const [key, fns] of this.channelHandlers) {
      if (!fns.size) continue;
      const [app, channel] = key.split('|');
      list.push({ app, channel });
    }
    this.live.setAppChannels(list);
  }
}
