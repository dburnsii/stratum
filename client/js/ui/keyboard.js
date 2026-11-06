// The Quest keyboard (DESIGN.md §8.5): a floating, tilted keyboard you type
// on with both index fingertips (or pinch / trigger keys from a distance).
// Opens in front of you, a little below eye level, like a keyboard on a
// desk; grab its frame to move it and it remembers where you like it.
//
//   const kb = new Keyboard(scene);
//   kb.ask(label, value, { url, secret, capitalize, onInput, placeholder }) → Promise<string | null>   (null: cancelled)
//   kb.openLive({ label, kind, secret, onKey, onClose }) → { close(), open }   (live typing:
//     every key goes straight to onKey as { text } or { key: 'Enter' | 'Backspace' | 'Tab' | … };
//     stays up until the app or ✕ closes it; onClose(reason: 'user' | 'app' | 'replaced');
//     chips: [[label, { key } | { text } | { mod: 'ctrl' }]] replaces the chip row (Ctrl is
//     sticky: the next letter goes as { key: 'Ctrl+C' }))
//   kb.update(head, pointerRay, tips) every frame (head: { position, quaternion })
//   kb.hit(ray) → { widget } | { grab } | null · kb.press(ray, src) · kb.grab/carry/release(pose)
//   kb.type(text) (tests) · kb.find(label) · kb.worldOf(widget)
//   kb.setLayout('simple' | 'full')   simple: phone-style letters / 123; full: a
//     desk keyboard (Esc, Tab, Ctrl, arrows, Home/End, Del) plus a number pad
//   new Keyboard(scene, { fixed: true })   lives at a placed spot (kb.setPose(matrix)
//     each frame): always showing; with nothing to type into, keys go to
//     kb.onIdleKey(ev) (main.js asks the last-used app to open typing)
//   kb.handoff(other)   move the current typing session to another keyboard
//
// Keys press on contact from the front (≤ 4 mm), re-arm after pulling back
// 12 mm; backspace repeats while held. Each tip gets its own state, so two
// fingers can type at once. Clicks are a short synthesized tick.
import * as THREE from 'three';
import { keyClick } from './sound.js';
import { MM, WidgetLayer, approach } from './kit.js';

const PITCH = 24 * MM, KEY = 21.5 * MM, PAD = 9 * MM;
const COLS = 10, W = COLS * PITCH + 2 * PAD - (PITCH - KEY);
const FIELD_H = 26 * MM, CHIP_H = 13 * MM;
const POKE_NEAR = 50 * MM, POKE_PRESS = 4 * MM, POKE_RELEASE = 12 * MM, POKE_SIDE = 6 * MM;
const REPEAT_DELAY = 450, REPEAT_EVERY = 70;
const DEFAULT_POSE = { right: 0, up: -0.3, fwd: 0.4, tilt: 0.75 };   // m in the head's yaw frame; tilt rad back from vertical
const POSE_KEY = 'stratum.keyboardPose';
const URL_CHIPS = ['https://', 'www.', '.com', '.org', '.net', '/'];
const NAV_CHIPS = [['Esc', 'Escape'], ['Tab', 'Tab'], ['←', 'ArrowLeft'], ['→', 'ArrowRight'], ['↑', 'ArrowUp'], ['↓', 'ArrowDown']];

// Rows: [label, width in keys, kind?]. Kinds: shift, back, mode, space, go,
// ctrl, gap (empty space), 'key:<Name>' (a named key: Escape, Tab, ArrowUp…).
const LETTERS = [
  [...'qwertyuiop'].map((c) => [c, 1]),
  [...'asdfghjkl'].map((c) => [c, 1]),
  [['⇧', 1.5, 'shift'], ...[...'zxcvbnm'].map((c) => [c, 1]), ['⌫', 1.5, 'back']],
  [['123', 1.5, 'mode'], [',', 1], [' ', 5, 'space'], ['.', 1], ['go', 1.5, 'go']],
];
const SYMBOLS = [
  [...'1234567890'].map((c) => [c, 1]),
  [...'-/:;()&@"%'].map((c) => [c, 1]),
  [...'=+*?!\'_#'].map((c) => [c, 1]).concat([['⌫', 2, 'back']]),
  [['ABC', 1.5, 'mode'], [',', 1], [' ', 5, 'space'], ['.', 1], ['go', 1.5, 'go']],
];

// Full layout: a desk keyboard, with a number pad to its right.
const FULL = [
  [['Esc', 1, 'key:Escape'], ['', 0.25, 'gap'], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 1, `key:F${i + 1}`]), ['', 0.25, 'gap'], ['PgUp', 1, 'key:PageUp'], ['PgDn', 1, 'key:PageDown']],
  [...[...'`1234567890-='].map((c) => [c, 1]), ['⌫', 2.5, 'back']],
  [['Tab', 1.5, 'key:Tab'], ...[...'qwertyuiop[]'].map((c) => [c, 1]), ['\\', 2]],
  [['Ctrl', 1.75, 'ctrl'], ...[...'asdfghjkl;\''].map((c) => [c, 1]), ['⏎', 2.75, 'go']],
  [['⇧', 2.25, 'shift'], ...[...'zxcvbnm,./'].map((c) => [c, 1]), ['↑', 1, 'key:ArrowUp'], ['Del', 2.25, 'key:Delete']],
  [['Alt', 1.5, 'alt'], ['Home', 1.5, 'key:Home'], [' ', 8, 'space'], ['End', 1.5, 'key:End'], ['←', 1, 'key:ArrowLeft'], ['↓', 1, 'key:ArrowDown'], ['→', 1, 'key:ArrowRight']],
];
const NUMPAD = [
  [['Ins', 1, 'key:Insert'], ['Del', 1, 'key:Delete'], ['Home', 1, 'key:Home'], ['End', 1, 'key:End']],
  [...'789/'].map((c) => [c, 1]),
  [...'456*'].map((c) => [c, 1]),
  [...'123-'].map((c) => [c, 1]),
  [...'0.=+'].map((c) => [c, 1]),
  [['⏎', 4, 'go']],
];
// On the full layout, an app's chips for keys it already has are left out.
const FULL_HAS = new Set(['Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'PageUp', 'PageDown']);
const NUMPAD_GAP = 0.6;   // keys of space between the main block and the pad
const SHIFTED = Object.fromEntries([...'`~1!2@3#4$5%6^7&8*9(0)-_=+[{]}\\|;:\'",<.>/?'].reduce((a, c, i, all) => (i % 2 ? a : [...a, [c, all[i + 1]]]), []));
const units = (row) => row.reduce((n, k) => n + k[1], 0);
const widthOf = (u) => u * PITCH - (PITCH - KEY) + 2 * PAD;

export class Keyboard {
  constructor(scene, { fixed = false } = {}) {
    this.fixed = fixed;                        // lives at a placed spot (setPose), always showing
    this.layout = 'simple';
    this.w = W;
    this.onIdleKey = null;
    this.group = new THREE.Group();            // placement
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.body = new THREE.Group();             // open/close animation
    this.group.add(this.body);
    scene.add(this.group);
    this.chrome = new WidgetLayer(this.body, { order: 1030 });
    this.keys = new WidgetLayer(this.body, { order: 1032 });
    this.cursors = ['left', 'right', 'ray'].map(() => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(3 * MM, 20), new THREE.MeshBasicMaterial({ color: 0x5b8cff, depthTest: false, transparent: true }));
      m.renderOrder = 1040;
      m.visible = false;
      this.body.add(m);
      return m;
    });
    this.openT = 0; this.openTarget = 0;
    this.pokes = new Map();
    this.req = null;                           // { label, value, url, onInput, resolve }
    this.layer = 'letters';
    this.shift = 'off';                        // off | once | lock
    this.lastShift = 0;
    this.dirty = true;
    this.last = performance.now();
    this.height = 0;
  }

  get open() { return this.openTarget === 1 && !!this.req; }
  // Something real is being typed into (not the idle state of a placed keyboard).
  get busy() { return !!this.req && !this.req.idle; }

  setLayout(name) {
    const l = name === 'full' ? 'full' : 'simple';
    if (l === this.layout) return;
    this.layout = l;
    this.layer = 'letters';
    this.dirty = true;
  }

  // Placed keyboards: where it is this frame.
  setPose(m) {
    this.group.matrix.copy(m);
    this.group.matrixWorldNeedsUpdate = true;
    if (!this.req) this.idle();
  }

  // A placed keyboard with nothing to type into still shows its keys.
  idle() {
    this.begin({ live: true, idle: true, label: 'Keyboard', value: '', placeholder: 'Type: it goes to what you last used', onKey: (ev) => this.onIdleKey?.(ev) }, true);
  }

  // Move the current typing session to another keyboard (no close / reopen).
  handoff(other) {
    const r = this.req;
    if (!r || r.idle) return false;
    this.req = null;
    this.pokes.clear();
    if (this.fixed) this.idle(); else this.openTarget = 0;
    if (other.req) other.end(other.req, null, 'replaced');
    other.req = r;
    other.layer = 'letters'; other.shift = 'off'; other.ctrl = false;
    other.openTarget = 1;
    other.group.visible = true;
    other.dirty = true;
    return true;
  }

  ask(label, value = '', opts = {}) {
    return new Promise((resolve) => {
      this.begin({ label, value: String(value ?? ''), url: !!opts.url, secret: !!opts.secret, capitalize: !!opts.capitalize, onInput: opts.onInput ?? null, placeholder: opts.placeholder ?? '', resolve });
      this.shift = opts.capitalize && !this.req.url && !this.req.value ? 'once' : 'off';   // sentence start (opt-in: hosts, codes, searches don't want it)
    });
  }

  // Live typing for an app (a browser field, a terminal). Re-opening while
  // it's already up just retargets it (no close/open flicker).
  openLive({ label = 'Typing', kind = 'text', secret = false, chips = null, onKey, onClose } = {}) {
    const wasUp = this.req && this.openTarget === 1;
    this.begin({ live: true, label, kind, value: '', url: kind === 'url' || kind === 'search', secret, chips, onKey, onClose,
      placeholder: 'Keys go straight in' }, wasUp);
    const req = this.req, kb = this;
    return { close: () => { if (kb.req === req) kb.close(null, 'app'); }, get open() { return kb.req === req; } };
  }

  begin(req, keepPlace = false) {
    if (this.req) this.end(this.req, null, 'replaced');
    if (this.fixed) keepPlace = true;
    this.req = req;
    this.layer = 'letters';
    this.shift = 'off';
    this.ctrl = false;
    this.alt = false;
    this.openTarget = 1;
    if (!keepPlace) this.placeAtHead = !this.group.visible;   // already showing: stay put
    this.group.visible = true;
    this.dirty = true;
  }

  close(result, reason = 'user') {
    const r = this.req;
    this.req = null;
    this.openTarget = 0;
    this.pokes.clear();
    if (r) this.end(r, result, reason);
    if (this.fixed && !this.req) this.idle();   // a placed keyboard stays where it is
  }

  end(r, result, reason) {
    if (r.idle) return;
    if (r.live) { try { r.onClose?.(reason); } catch (err) { console.error(err); } } else r.resolve(result);
  }

  // Live mode: a key to the app, and a short echo in the field.
  send(ev) {
    const r = this.req;
    if (ev.mod === 'ctrl') { this.ctrl = !this.ctrl; this.dirty = true; return; }
    if (this.ctrl && ev.text?.length === 1 && /[a-z@[\]^_\\]/i.test(ev.text)) {
      this.ctrl = false;
      ev = { key: `Ctrl+${ev.text.toUpperCase()}` };
    }
    if (this.alt && (ev.text?.length === 1 || ev.key)) {   // Alt (Meta): the next key with it, e.g. Alt+b
      this.alt = false;
      ev = { key: `Alt+${ev.text ?? ev.key}` };
    }
    try { r.onKey?.(ev); } catch (err) { console.error(err); }
    if (ev.text) r.value = (r.value + ev.text).slice(-200);
    else if (ev.key === 'Backspace') r.value = r.value.slice(0, -1);
    else if (ev.key === 'Enter') r.value = '';
    else if (ev.key?.startsWith('Ctrl+')) r.value = (r.value + `^${ev.key.slice(5)}`).slice(-200);
    this.dirty = true;
  }

  // A key from a real keyboard: { text } or { key } (Enter, Backspace, Ctrl+C, …).
  hardware(ev) {
    const r = this.req;
    if (!r) return;
    if (r.live) return this.send(ev);
    if (ev.key === 'Enter') return this.close(r.value);
    if (ev.key === 'Escape') return this.close(null);
    if (ev.key === 'Backspace') return this.edit(r.value.slice(0, -1));
    if (ev.text) this.edit(r.value + ev.text);
  }

  // ---- typing --------------------------------------------------------------------------------

  input(k) {
    const r = this.req;
    if (!r) return;
    const [label, , kind] = k;
    if (kind === 'gap') return;
    if (kind === 'key:Tab' && this.shift !== 'off') { if (r.live) this.send({ key: 'Shift+Tab' }); if (this.shift === 'once') this.shift = 'off'; return; }
    if (kind?.startsWith('key:')) { if (r.live) this.send({ key: kind.slice(4) }); return; }
    if (kind === 'ctrl') { if (r.live) this.send({ mod: 'ctrl' }); return; }
    if (kind === 'alt') { if (r.live) { this.alt = !this.alt; this.dirty = true; } return; }
    if (r.live && (kind === 'go' || kind === 'back')) return this.send({ key: kind === 'go' ? 'Enter' : 'Backspace' });
    if (kind === 'go') return this.close(r.value);
    if (kind === 'shift') {
      const now = performance.now();
      this.shift = this.shift === 'off' ? (now - this.lastShift < 350 ? 'lock' : 'once') : this.shift === 'once' && now - this.lastShift < 350 ? 'lock' : 'off';
      this.lastShift = now;
    } else if (kind === 'mode') {
      this.layer = this.layer === 'letters' ? 'symbols' : 'letters';
    } else if (kind === 'back') {
      this.edit(r.value.slice(0, -1));
    } else {
      const ch = this.capOf(label, kind);
      if (r.live) this.send({ text: ch });
      else this.edit(r.value + ch);
      if (this.shift === 'once') this.shift = 'off';
      if (r.capitalize && ch === ' ' && /[.!?] $/.test(r.value)) this.shift = 'once';
    }
    this.dirty = true;
  }

  edit(value) {
    this.req.value = value;
    this.req.onInput?.(value);
    this.dirty = true;
  }

  capOf(label, kind) {
    if (kind || this.layer !== 'letters' || this.shift === 'off') return label;
    return this.layout === 'full' && SHIFTED[label] ? SHIFTED[label] : label.toUpperCase();
  }

  type(text) { for (const ch of text) this.input([ch, 1, ch === ' ' ? 'space' : null]); }

  // ---- layout ---------------------------------------------------------------------------------

  build() {
    this.dirty = false;
    const r = this.req;
    if (!r) return;
    const full = this.layout === 'full';
    const blocks = full
      ? [{ rows: FULL, u: units(FULL[0]) }, { rows: NUMPAD, u: units(NUMPAD[0]) }]
      : [{ rows: this.layer === 'letters' ? LETTERS : SYMBOLS, u: COLS }];
    const totalU = blocks.reduce((n, b) => n + b.u, 0) + (full ? NUMPAD_GAP : 0);
    const W = (this.w = full ? widthOf(totalU) : widthOf(COLS));
    const specs = [];
    let y = PAD;                               // top-down; flipped below
    const fw = W - 2 * PAD - KEY - 4 * MM;
    specs.push({ key: 'field', kind: 'field', x: -W / 2 + PAD + fw / 2, y: y + FIELD_H / 2, w: fw, h: FIELD_H,
      props: { label: r.label, value: r.value, caret: this.caretOn, placeholder: r.placeholder, secret: !!r.secret } });
    specs.push({ key: 'close', kind: 'icon', x: W / 2 - PAD - KEY / 2, y: y + FIELD_H / 2, w: KEY, h: KEY, props: { icon: 'close', label: r.live ? 'Close keyboard' : 'Cancel' }, run: () => this.close(null) });
    y += FIELD_H + 5 * MM;
    // Chip row: URL bits for addresses; Esc / Tab / arrows while typing live elsewhere.
    const appChips = r.chips && full ? r.chips.filter(([, ev]) => !(FULL_HAS.has(ev.key) || ev.mod === 'ctrl')) : r.chips;
    const chips = appChips ? appChips.map(([c, ev]) => [c, () => this.send(ev), ev.mod === 'ctrl' && this.ctrl])
      : r.url ? URL_CHIPS.map((c) => [c, () => (r.live ? this.send({ text: c }) : this.edit(r.value + c))])
      : r.live && !full ? NAV_CHIPS.map(([c, key]) => [c, () => this.send({ key })]) : [];   // full has its own Esc / Tab / arrows
    if (chips.length) {
      const cw = (W - 2 * PAD - (chips.length - 1) * 3 * MM) / chips.length;
      chips.forEach(([c, run, on], i) => specs.push({ key: `chip-${c}`, kind: 'chip', x: -W / 2 + PAD + cw / 2 + i * (cw + 3 * MM), y: y + CHIP_H / 2, w: cw, h: CHIP_H,
        props: { label: c, on: !!on }, run }));
      y += CHIP_H + 4 * MM;
    }
    const gap = PITCH - KEY;
    const y0 = y;
    let left = -(totalU * PITCH - gap) / 2;
    for (const [bi, block] of blocks.entries()) {
    y = y0;
    for (const [ri, row] of block.rows.entries()) {
      let x = full ? left : -(units(row) * PITCH - gap) / 2;
      for (const k of row) {
        const [label, n, kind] = k;
        if (kind === 'gap') { x += n * PITCH; continue; }   // space between key groups
        const w = n * PITCH - gap;
        const cap = this.capOf(label, kind);
        const props = kind === 'shift' ? { icon: 'shift', label: 'Shift', tone: this.shift === 'off' ? 'mod' : 'on', lock: this.shift === 'lock' }
          : kind === 'back' ? { icon: 'backspace', label: 'Backspace', tone: 'mod' }
          : kind === 'go' ? (r.url ? { label: 'Go', tone: 'go' } : { icon: 'enter', label: r.live ? 'Enter' : 'Done', tone: 'go' })
          : kind === 'space' ? { label: r.url ? 'space' : '', tone: 'char', id: 'space' }
          : kind === 'mode' ? { label, tone: 'mod' }
          : kind === 'ctrl' ? { label, tone: this.ctrl ? 'on' : 'mod' }
          : kind === 'alt' ? { label, tone: this.alt ? 'on' : 'mod' }
          : kind?.startsWith('key:') ? { label, tone: 'mod' }
          : { label: cap, tone: 'char' };
        specs.push({ key: `k-${bi}-${ri}-${kind ?? label}`, kind: 'key', x: x + w / 2, y: y + KEY / 2, w, h: KEY, lift: 2 * MM, props, run: () => this.input(k), keyDef: k });
        x += n * PITCH;
      }
      y += PITCH;
    }
    left += (block.u + NUMPAD_GAP) * PITCH;
    }
    const H = y - gap + PAD;
    this.height = H;
    for (const s of specs) s.y = H / 2 - s.y;  // centered on the group origin
    this.keys.render(specs);
    for (const s of specs) { const w = this.keys.widgets.get(s.key); if (w) w.keyDef = s.keyDef ?? null; }
    this.chrome.render([{ key: 'glass', kind: 'glass', x: 0, y: 0, w: W, h: H, props: { radius: 14 * MM } }]);
  }

  // ---- placement --------------------------------------------------------------------------------

  // The head's yaw frame (x right, y up, z back): where "in front of you" is.
  static yawFrame(head) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion).setY(0);
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const back = fwd.clone().negate();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    return new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), back).setPosition(head.position);
  }

  placeFor(head) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POSE_KEY) || 'null'); } catch { /* default */ }
    const frame = Keyboard.yawFrame(head);
    if (saved?.m?.length === 16) {
      this.group.matrix.multiplyMatrices(frame, new THREE.Matrix4().fromArray(saved.m));
    } else {
      const p = DEFAULT_POSE;
      const local = new THREE.Matrix4().makeRotationX(-p.tilt).setPosition(p.right, p.up, -p.fwd);
      this.group.matrix.multiplyMatrices(frame, local);
    }
    this.group.matrixWorldNeedsUpdate = true;
  }

  grab(pose, head) {
    this.held = { offset: pose.clone().invert().multiply(this.group.matrix), head };
  }

  carry(pose) {
    if (!this.held) return;
    this.group.matrix.copy(pose).multiply(this.held.offset);
    this.group.matrixWorldNeedsUpdate = true;
  }

  // Remember the spot relative to where you were facing.
  release(head) {
    if (!this.held) return;
    const h = head ?? this.held.head;
    this.held = null;
    if (!h) return;
    const local = Keyboard.yawFrame(h).invert().multiply(this.group.matrix);
    localStorage.setItem(POSE_KEY, JSON.stringify({ m: local.toArray() }));
  }

  // ---- per frame ------------------------------------------------------------------------------

  update(head, pointerRay, tips = []) {
    const W = this.w;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.group.visible) return;
    if (this.placeAtHead && head) { this.placeFor(head); this.placeAtHead = false; }
    this.openT = approach(this.openT, this.openTarget, dt, this.openTarget ? 0.05 : 0.03);
    if (!this.openTarget && this.openT < 0.02) {
      this.group.visible = false;
      this.openT = 0;
      this.keys.render([]);
      return;
    }
    this.body.scale.setScalar(0.94 + 0.06 * this.openT);
    this.body.position.y = (1 - this.openT) * -12 * MM;
    this.chrome.alpha = this.keys.alpha = this.openT;
    const caret = this.req ? Math.floor(now / 530) % 2 === 0 : false;
    if (caret !== this.caretOn) { this.caretOn = caret; this.dirty = true; }
    if (this.dirty && this.req) this.build();
    this.group.updateMatrixWorld(true);
    // Input: fingertips first, then the pointing ray.
    const hovered = new Set();
    for (const c of this.cursors) c.visible = false;
    if (this.req) {
      this.poke(tips, hovered, now);
      if (pointerRay && !hovered.size) {
        const h = this.pickRay(pointerRay, this.cursors[2]);
        if (h?.widget) hovered.add(h.widget);
      }
    }
    for (const w of this.keys.widgets.values()) w.hover = hovered.has(w) ? 1 : 0;
    this.chrome.update(dt);
    this.keys.update(dt);
  }

  poke(tips, hovered, now) {
    const W = this.w;
    const inv = this.body.matrixWorld.clone().invert();
    const seen = new Set();
    for (const { id, p } of tips) {
      if (!p) continue;
      seen.add(id);
      const l = p.clone().applyMatrix4(inv);
      const st = this.pokes.get(id) ?? { front: false, pressed: null, at: 0, rep: 0 };
      this.pokes.set(id, st);
      const inside = Math.abs(l.x) <= W / 2 && Math.abs(l.y) <= this.height / 2;
      if (!inside || l.z > POKE_NEAR || l.z < -POKE_NEAR) { st.front = false; st.pressed = null; continue; }
      if (!st.pressed && l.z > POKE_SIDE) st.front = true;       // only presses that come from the front
      if (!st.front) continue;
      const w = this.keys.pick(l.x, l.y);
      const dist = l.z - (w ? w.tz : 0);
      const cur = this.cursors[id === 'left' ? 0 : 1];
      cur.visible = true;
      cur.position.set(l.x, l.y, (w?.tz ?? 0) + 3 * MM);
      if (w) { hovered.add(w); w.pressed = dist < POKE_RELEASE; }
      if (!st.pressed && w && dist <= POKE_PRESS) {
        st.pressed = w; st.at = now; st.rep = 0;
        this.activate(w);
      } else if (st.pressed && dist > POKE_RELEASE) {
        st.pressed.pressed = false;
        st.pressed = null;
      } else if (st.pressed && st.pressed === w && w.keyDef?.[2] === 'back' && now - st.at > REPEAT_DELAY + st.rep * REPEAT_EVERY) {
        st.rep++;
        this.activate(w);                                          // backspace held: repeat
      }
    }
    for (const id of [...this.pokes.keys()]) if (!seen.has(id)) this.pokes.delete(id);
  }

  activate(w, src) {
    if (!w?.run) return;
    w.flash = 1;
    tick(w.keyDef?.[2]);
    try { src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.25, 14); } catch { /* no haptics */ }
    try { w.run(); } catch (err) { console.error(err); }
    this.dirty = true;
  }

  pickRay(ray, cursor = null) {
    if (!this.open) return null;
    const W = this.w;
    const inv = this.body.matrixWorld.clone().invert();
    const o = ray.origin.clone().applyMatrix4(inv);
    const d = ray.origin.clone().add(ray.dir).applyMatrix4(inv).sub(o);
    if (Math.abs(d.z) < 1e-6) return null;
    const t = (0 - o.z) / d.z;
    if (t <= 0) return null;
    const p = o.addScaledVector(d, t);
    if (Math.abs(p.x) > W / 2 || Math.abs(p.y) > this.height / 2) return null;
    if (cursor) { cursor.visible = true; cursor.position.set(p.x, p.y, 4 * MM); }
    const widget = this.keys.pick(p.x, p.y);
    return widget ? { widget } : this.fixed ? { frame: true } : { grab: true };   // placed: move it as an object
  }

  hit(ray) { return this.pickRay(ray); }

  press(ray, src) {
    const h = this.pickRay(ray);
    if (!h) return false;
    if (h.widget) this.activate(h.widget, src);
    return true;
  }

  // ---- tests ----------------------------------------------------------------------------------

  find(label) {
    for (const w of this.keys.widgets.values()) {
      const p = w.props ?? {};
      if (w.run && (p.label === label || p.id === label || w.keyDef?.[0] === label)) return w;
    }
    return null;
  }

  worldOf(w) {
    this.group.updateMatrixWorld(true);
    return new THREE.Vector3(w.tx, w.ty, w.tz).applyMatrix4(this.body.matrixWorld);
  }

  normal() {
    const z = new THREE.Vector3();
    this.group.matrix.extractBasis(new THREE.Vector3(), new THREE.Vector3(), z);
    return z;
  }

  dispose() {
    const r = this.req;
    this.req = null;
    if (r) this.end(r, null, 'exit');   // prompts resolve null; live typing gets its onClose
    this.group.removeFromParent();
  }
}

// A soft key tick (no haptics on bare hands). Lower for modifiers, brighter for Go.
function tick(kind) { keyClick(kind); }
