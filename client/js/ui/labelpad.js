// Gesture labelling pad (Quest; DESIGN.md §0 "Gesture labelling").
//
// In labelling mode the core gestures don't act; instead this pad of big
// buttons floats low on your left. Press one (poke it, or aim and pinch /
// trigger) a moment before doing that gesture: a LABEL_MS window opens
// (beep, countdown), and its start and end go into the hand recording
// (js/handrec.js) as definite labels: { kind: 'label', gesture, side, phase }.
// "Nothing" marks a deliberate non-gesture (a hard negative).
//
//   const pad = new LabelPad(scene, { onLabel(ev) {...} });
//   pad.setVisible(on) · each frame: pad.update(now, viewer, tips) · pad.pick(ray) → press · pad.dispose()
import * as THREE from 'three';
import { beep } from './sound.js';

export const LABEL_MS = 4000;
export const LABELS = [
  { id: 'revelio', name: '✨ Revelio', color: '#7048e8' },
  { id: 'shoo', name: '💨 Shoo', color: '#1c7ed6' },
  { id: 'back', name: '👌 Bring back', color: '#0ca678' },
  { id: 'flip', name: '🪩 Pinball flip', color: '#e8590c' },
  { id: 'menu', name: '🖐 Palm menu', color: '#ae3ec9' },
  { id: 'keyboard', name: '⌨️ Keyboard', color: '#5c940d', both: true },
  { id: 'none', name: '🚫 Nothing', color: '#495057' },
];

const W = 0.24, ROW = 0.042, GAP = 0.006, HEAD_H = 0.05;   // m
const PX = 2400;                                            // canvas px per m
const OFFSET = new THREE.Vector3(-0.27, -0.4, -0.38);       // from the eyes (turned with your heading): low on your left
const FOLLOW_RAD = THREE.MathUtils.degToRad(40), FOLLOW_M = 0.45;
const POKE_IN = 0.004, POKE_ARM = 0.02, PRESS_GAP_MS = 600;
const COUNTS_KEY = 'stratum.labelCounts';

export class LabelPad {
  constructor(scene, { onLabel = () => {} } = {}) {
    this.onLabel = onLabel;
    this.buttons = [];
    let y = HEAD_H + GAP;
    for (const l of LABELS) {
      if (l.both) this.buttons.push({ label: l, side: 'both', x: 0, y, w: W, h: ROW });
      else for (const [k, side] of ['left', 'right'].entries()) this.buttons.push({ label: l, side, x: k * (W / 2 + GAP / 2), y, w: W / 2 - GAP / 2, h: ROW });
      y += ROW + GAP;
    }
    this.done = { label: { id: 'done', name: '✕ Done labelling', color: '#c92a2a' }, side: null, x: 0, y, w: W, h: ROW * 0.8 };
    this.buttons.push(this.done);
    this.H = y + this.done.h;
    this.canvas = Object.assign(document.createElement('canvas'), { width: Math.round(W * PX), height: Math.round(this.H * PX) });
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, this.H).translate(W / 2, -this.H / 2, 0),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 9000;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.mesh.position.set(-W / 2, this.H / 2, 0);   // centered on the group
    this.group.visible = false;
    scene.add(this.group);
    this.counts = (() => { try { return JSON.parse(localStorage.getItem(COUNTS_KEY)) ?? {}; } catch { return {}; } })();
    this.active = null;     // { label, side, until }
    this.hover = null;
    this.lastPress = -Infinity;
    this.tipState = new Map();
    this.placed = false;
    this.onDone = null;
    this.draw();
  }

  get visible() { return this.group.visible; }

  setVisible(on) {
    this.group.visible = on;
    this.placed = false;
    if (!on && this.active) this.finish();
  }

  // viewer: { position, quaternion }; tips: [{ id, pos: Vector3 }] (index fingertips).
  update(now, viewer, tips = []) {
    if (!this.group.visible || !viewer) return;
    this.follow(viewer);
    this.group.updateMatrixWorld(true);
    const inv = this.mesh.matrixWorld.clone().invert();
    let hover = null;
    for (const t of tips) {
      const p = t.pos.clone().applyMatrix4(inv), b = this.at(p.x, p.y);
      const st = this.tipState.get(t.id) ?? { armed: false };
      if (b && Math.abs(p.z) < 0.04) hover = b;
      if (p.z > POKE_ARM || !b) st.armed = p.z > POKE_ARM;
      else if (st.armed && p.z < POKE_IN) { st.armed = false; this.press(b, now); }
      this.tipState.set(t.id, st);
    }
    if (this.active && now >= this.active.until) this.finish(now);
    if (hover !== this.hover || (this.active && now - (this.drawnAt ?? 0) > 100)) { this.hover = hover; this.draw(now); }   // (the countdown: 10 redraws a second)
  }

  // A ray (aim + pinch / trigger): the button it points at, pressed. True if it hit the pad.
  pick(ray, now = performance.now()) {
    if (!this.group.visible) return false;
    this.group.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(ray.origin, ray.dir).intersectObject(this.mesh)[0];
    if (!hit) return false;
    const p = hit.point.clone().applyMatrix4(this.mesh.matrixWorld.clone().invert()), b = this.at(p.x, p.y);
    if (b) this.press(b, now);
    return true;
  }

  // Local mesh coords (x right from the left edge, y down from the top, as negatives) → button.
  at(x, y) {
    const v = -y;
    return this.buttons.find((b) => x >= b.x && x <= b.x + b.w && v >= b.y && v <= b.y + b.h) ?? null;
  }

  press(b, now = performance.now()) {
    if (now - this.lastPress < PRESS_GAP_MS) return;
    this.lastPress = now;
    if (b === this.done) { this.onDone?.(); return; }
    if (this.active) this.finish(now, this.active.label === b.label.id && this.active.side === b.side ? 'cancelled' : 'cut');
    if (this.active === null && this.justCancelled === b) { this.justCancelled = null; return; }
    this.active = { label: b.label.id, side: b.side, start: now, until: now + LABEL_MS, button: b };
    this.onLabel({ gesture: b.label.id, side: b.side, phase: 'start', windowMs: LABEL_MS });
    beep(1046, 140);
    this.draw(now);
  }

  finish(now = performance.now(), how = 'done') {
    const a = this.active;
    if (!a) return;
    this.active = null;
    this.onLabel({ gesture: a.label, side: a.side, phase: 'end', how, ms: Math.round(now - a.start) });
    if (how === 'done') {
      const k = `${a.label}:${a.side}`;
      this.counts[k] = (this.counts[k] ?? 0) + 1;
      try { localStorage.setItem(COUNTS_KEY, JSON.stringify(this.counts)); } catch { /* full: counts are only a display */ }
      beep(523, 160);
    }
    if (how === 'cancelled') this.justCancelled = a.button;
    this.draw(now);
  }

  // Body-locked: in front-left of you, low; moves only when you've turned or walked away from it.
  follow(viewer) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(viewer.quaternion).setY(0);
    if (fwd.lengthSq() < 1e-6) return;
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const target = OFFSET.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(viewer.position);
    const off = this.placed ? Math.abs(Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw))) : Infinity;
    if (!this.placed || off > FOLLOW_RAD || this.group.position.distanceTo(target) > FOLLOW_M) {
      this.placed = true;
      this.yaw = yaw;
      this.group.position.copy(target);
      this.group.lookAt(viewer.position);   // faces your eyes (tilted up to them)
    }
  }

  draw(now = performance.now()) {
    this.drawnAt = now;
    const g = this.canvas.getContext('2d'), k = PX;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const rr = (x, y, w, h, r, fill) => { g.beginPath(); g.roundRect(x * k, y * k, w * k, h * k, r * k); g.fillStyle = fill; g.fill(); };
    // Header: what's happening.
    const a = this.active;
    rr(0, 0, W, HEAD_H, 0.008, a ? '#e03131' : 'rgba(20,22,30,0.92)');
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.font = `700 ${0.016 * k}px system-ui, sans-serif`;
    if (a) {
      const left = Math.max(0, a.until - now) / 1000, name = LABELS.find((l) => l.id === a.label)?.name ?? a.label;
      g.fillText(`● ${name}${a.side === 'both' ? '' : ` · ${a.side}`}: go`, 0.01 * k, HEAD_H * 0.38 * k);
      g.font = `600 ${0.011 * k}px system-ui, sans-serif`;
      g.fillText(`${left.toFixed(1)} s · tap it again to cancel`, 0.01 * k, HEAD_H * 0.78 * k);
      rr(0, HEAD_H - 0.004, W * (1 - left * 1000 / LABEL_MS), 0.004, 0.002, '#ffd43b');
    } else {
      g.fillText('Tap a gesture, then do it', 0.01 * k, HEAD_H * 0.38 * k);
      g.font = `500 ${0.011 * k}px system-ui, sans-serif`;
      const n = Object.values(this.counts).reduce((s, v) => s + v, 0);
      g.fillText(`Gestures are off · ${n} labelled`, 0.01 * k, HEAD_H * 0.78 * k);
    }
    for (const b of this.buttons) {
      const on = a && a.button === b, hov = this.hover === b;
      rr(b.x, b.y, b.w, b.h, 0.007, on ? '#ffd43b' : b.label.color);
      if (hov && !on) rr(b.x, b.y, b.w, b.h, 0.007, 'rgba(255,255,255,0.25)');
      g.fillStyle = on ? '#1a1b1e' : '#fff';
      g.font = `700 ${0.0125 * k}px system-ui, sans-serif`;
      const side = b.side === 'left' ? 'L' : b.side === 'right' ? 'R' : '';
      g.fillText(`${side ? `${side} ` : ''}${b.label.name}`, (b.x + 0.008) * k, (b.y + b.h / 2) * k);
      const c = b.side ? this.counts[`${b.label.id}:${b.side}`] : null;
      if (c) { g.font = `600 ${0.01 * k}px system-ui, sans-serif`; g.textAlign = 'right'; g.fillText(`${c}`, (b.x + b.w - 0.007) * k, (b.y + b.h / 2) * k); g.textAlign = 'left'; }
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.tex.dispose();
  }
}
