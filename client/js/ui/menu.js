// The Quest menu (DESIGN.md §8.3): pages of widgets on a glass panel, a
// floating tab bar under it, on the left palm or put down in the room.
//
//   const menu = new Menu(scene, provider);    // provider: { data(), …actions } (main.js)
//   menu.toggle(on) · menu.open · menu.mode ('hand' | 'held' | 'placed')
//   menu.update(attach, head, pointerRay, tips)   every frame
//   menu.hit(ray) → { widget } | { grab } | { panel } | null · menu.press(ray)
//   menu.grab(pose) / carry(pose) / release() · menu.go(page, params) · menu.find(label)
//
// Layout: panel-local meters, x right, y up; origin at the panel's bottom
// center (so it grows upward and the tab bar under it stays put).
import * as THREE from 'three';
import { MM, WidgetLayer, approach } from './kit.js';

const W = 240 * MM, PAD = 10 * MM, INNER = W - 2 * PAD;
const HEADER_H = 21 * MM, ROW_H = 21 * MM, GAP = 4 * MM, SECTION_H = 7 * MM;
const TAB_W = 172 * MM, TAB_H = 26 * MM, TAB_GAP = 7 * MM, TAB_Z = 12 * MM;
const PALM_LIFT = 50 * MM, PALM_FORWARD = 30 * MM;
const PALM_TILT = 30 * Math.PI / 180;   // on the palm: tipped up off the hand (pivot: its bottom edge), not flat on it
const POKE_NEAR = 60 * MM, POKE_PRESS = 4 * MM, POKE_RELEASE = 15 * MM, POKE_SIDE = 8 * MM;
const WINDOW_SCALE = 1.8, WINDOW_DIST = 0.6;
const DATA_MS = 250;
// Place chooser (apps with variants): a panel floating in front of the menu,
// one card per variant with a live 3D preview hovering over it.
const MODAL_Z = 22 * MM, CARD_W = 68 * MM, CARD_H = 76 * MM, CARD_GAP = 4 * MM, PREVIEW_SIZE = 36 * MM;
const TABS = [['home', 'home', 'Home'], ['apps', 'apps', 'Apps'], ['layers', 'layers', 'Layers'], ['space', 'space', 'Space'], ['help', 'hand', 'Gestures'], ['settings', 'gear', 'Settings']];

export class Menu {
  constructor(scene, provider) {
    this.p = provider;
    this.group = new THREE.Group();           // placement (hand / held / placed)
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.body = new THREE.Group();            // open/close animation + window scale
    this.group.add(this.body);
    scene.add(this.group);
    this.chrome = new WidgetLayer(this.body, { order: 1000 });   // glass panel
    this.pageGroup = new THREE.Group();
    this.body.add(this.pageGroup);
    this.page = new WidgetLayer(this.pageGroup, { order: 1002 });
    this.old = null;                          // the page sliding out
    this.tabs = new WidgetLayer(this.body, { order: 1010 });
    this.modalLayer = new WidgetLayer(this.body, { order: 1014 });
    this.modalLayer.alpha = 0;
    this.modal = null;                          // { item, previews: Map(variantKey → holder) }
    this.previewGroup = new THREE.Group();
    this.body.add(this.previewGroup);
    this.cursor = new THREE.Mesh(new THREE.CircleGeometry(3.5 * MM, 20),
      new THREE.MeshBasicMaterial({ color: 0x5b8cff, depthTest: false, transparent: true }));
    this.cursor.renderOrder = 1020;
    this.cursor.visible = false;
    this.body.add(this.cursor);
    this.nav = { tab: 'home', stack: [{ page: 'home' }] };
    this.mode = 'hand';
    this.windowed = false;
    this.openT = 0; this.openTarget = 0;
    this.scale = 1;
    this.height = 120 * MM;
    this.pokes = new Map();
    this.lastData = 0;
    this.dirty = true;
    this.state = {};                           // per-page UI state (page numbers, filters)
    this.last = performance.now();
  }

  get open() { return this.group.visible && this.openTarget === 1; }

  toggle(on = !this.open) {
    this.openTarget = on ? 1 : 0;
    if (!on) this.closeChooser();
    if (on) { this.group.visible = true; this.dirty = true; }
    else { this.mode = 'hand'; this.windowed = false; this.carryOffset = null; }
  }

  invalidate() { this.dirty = true; }

  // ---- navigation ------------------------------------------------------------------------

  // ---- place chooser ------------------------------------------------------------------------

  choose(item) {
    this.closeChooser();
    this.modal = { item, previews: new Map(), t: 0 };
    this.dirty = true;
    for (const v of item.variants) {
      this.p.preview?.(item.app, v.variant).then((obj) => {
        if (!obj || this.modal?.item !== item) return;
        // Fit it in a PREVIEW_SIZE box, centered; draw it over the menu's widgets.
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        obj.position.sub(c);
        const holder = new THREE.Group();
        const spin = new THREE.Group();
        spin.add(obj);
        holder.add(spin);
        holder.scale.setScalar(PREVIEW_SIZE / Math.max(size.x, size.y, size.z, 1e-3));
        obj.traverse((n) => {
          if (!n.material) return;
          n.material = [].concat(n.material).map((m) => { const mm = m.clone(); mm.transparent = true; return mm; });
          if (n.material.length === 1) n.material = n.material[0];
          n.renderOrder = 1018;
        });
        holder.userData.spin = spin;
        this.modal.previews.set(v.key, holder);
        this.previewGroup.add(holder);
        this.dirty = true;
      }).catch(() => {});
    }
  }

  closeChooser() {
    if (!this.modal) return;
    for (const h of this.modal.previews.values()) {
      h.removeFromParent();
      h.traverse((n) => { n.geometry?.dispose(); [].concat(n.material ?? []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    }
    this.modal = null;
    this.dirty = true;
  }

  buildChooser() {
    const m = this.modal;
    if (!m) { this.modalLayer.render([]); return; }
    const vs = m.item.variants;
    const cols = Math.min(3, vs.length), rows = Math.ceil(vs.length / cols);
    const w = cols * CARD_W + (cols - 1) * CARD_GAP + 2 * PAD;
    const head = 22 * MM, foot = 18 * MM;
    const h = head + rows * CARD_H + (rows - 1) * CARD_GAP + foot + PAD;
    const cy = Math.max(h / 2, this.height / 2);                     // centered on the menu, never below its bottom
    const top = cy + h / 2;
    const specs = [
      { key: 'm-glass', kind: 'glass', x: 0, y: cy, z: MODAL_Z - 1 * MM, w, h, props: { radius: 16 * MM } },
      { key: 'm-head', kind: 'header', x: 0, y: top - PAD - (head - 6 * MM) / 2, z: MODAL_Z, w: w - 2 * PAD, h: head - 6 * MM,
        props: { title: `Place ${m.item.name}`, sub: 'Pick one, then point at where it goes', emoji: m.item.emoji } },
    ];
    vs.forEach((v, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = -w / 2 + PAD + CARD_W / 2 + c * (CARD_W + CARD_GAP);
      const y = top - head - CARD_H / 2 - r * (CARD_H + CARD_GAP);
      specs.push({ key: `m-${v.key}`, kind: 'variant', x, y, z: MODAL_Z, w: CARD_W, h: CARD_H, lift: 2 * MM,
        props: { label: v.name, description: v.description, emoji: v.emoji, hasPreview: m.previews.has(v.key), id: v.key },
        run: () => { this.p.arm(v.key); this.closeChooser(); } });
      const holder = m.previews.get(v.key);
      if (holder) holder.position.set(x, y + CARD_H / 2 - CARD_H * 0.56 * 0.5, MODAL_Z + PREVIEW_SIZE * 0.6);
    });
    specs.push({ key: 'm-cancel', kind: 'chip', x: 0, y: cy - h / 2 + PAD / 2 + foot / 2, z: MODAL_Z, w: 40 * MM, h: 12 * MM,
      props: { label: 'Cancel' }, run: () => this.closeChooser() });
    m.box = { w, h, cy };
    this.modalLayer.render(specs);
  }

  go(page, params = {}) {
    this.closeChooser();
    const tab = TABS.find((t) => t[0] === page);
    if (tab) this.nav = { tab: page, stack: [{ page }] };
    else this.nav.stack.push({ page, params });
    this.transition(tab ? 0 : 1);
  }

  back() {
    if (this.modal) return this.closeChooser();
    if (this.nav.stack.length > 1) { this.nav.stack.pop(); this.transition(-1); }
  }

  // Slide the old page out (2 cm) and the new one in.
  transition(dir) {
    this.old?.dispose();
    this.old = this.page;
    this.old.slide = { dir: -dir, x: 0 };
    this.page = new WidgetLayer(this.pageGroup, { order: 1002 });
    this.page.group.position.x = dir * 20 * MM;
    this.page.alpha = dir ? 0 : 1;
    this.dirty = true;
  }

  // ---- per frame ------------------------------------------------------------------------------

  update(attach, head, pointerRay, tips = []) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.group.visible) return;
    this.head = head;
    // Open / close.
    this.openT = approach(this.openT, this.openTarget, dt, this.openTarget ? 0.055 : 0.035);
    if (!this.openTarget && this.openT < 0.02) { this.group.visible = false; this.openT = 0; return; }
    const s = (0.92 + 0.08 * this.openT) * this.scale * (this.windowed ? WINDOW_SCALE : 1);
    this.body.scale.setScalar(s);
    this.chrome.alpha = this.tabs.alpha = this.openT;
    // Content.
    if (this.dirty || now - this.lastData > DATA_MS) this.build(now);
    this.page.alpha = approach(this.page.alpha, this.openT * (this.modal ? 0.25 : 1), dt, 0.05);
    this.modalLayer.alpha = approach(this.modalLayer.alpha, this.modal ? this.openT : 0, dt, 0.05);
    if (this.modal) {
      this.modal.t += dt;
      let i = 0;
      for (const h of this.modal.previews.values()) {
        h.userData.spin.rotation.y = Math.sin(this.modal.t * 0.8 + i++) * 0.6;   // a slow sway, so you see depth
        h.traverse((n) => { if (n.material) [].concat(n.material).forEach((mm) => { mm.opacity = this.modalLayer.alpha; }); });
      }
    }
    this.page.group.position.x = approach(this.page.group.position.x, 0, dt, 0.045);
    if (this.old) {
      this.old.alpha = approach(this.old.alpha, 0, dt, 0.035);
      this.old.group.position.x = approach(this.old.group.position.x, this.old.slide.dir * 20 * MM, dt, 0.045);
      if (this.old.alpha < 0.02) { this.old.dispose(); this.old = null; }
    }
    // Placement.
    if (this.mode === 'hand' && attach) this.followHand(attach);
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
    // Input: a fingertip near the panel wins over the ray.
    const target = this.poke(tips) ?? (pointerRay ? this.pickRay(pointerRay, true)?.widget : null);
    if (!tips.length && !pointerRay) this.cursor.visible = false;
    this.page.setHover(target);
    this.tabs.setHover(target);
    this.modalLayer.setHover(target);
    this.modalLayer.update(dt);
    this.chrome.update(dt);
    this.page.update(dt);
    this.old?.update(dt);
    this.tabs.update(dt);
  }

  followHand({ matrix, palm }) {
    const s = this.body.scale.x;
    const below = (TAB_GAP + TAB_H) * s;      // the tab bar sits nearest the hand
    if (palm) {
      const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
      matrix.extractBasis(x, y, z);
      const pos = new THREE.Vector3().setFromMatrixPosition(matrix).addScaledVector(z, PALM_LIFT).addScaledVector(y, PALM_FORWARD + below);
      this.group.matrix.makeBasis(x, y, z).setPosition(pos).multiply(new THREE.Matrix4().makeRotationX(PALM_TILT));
    } else if (this.head) {
      const pos = new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(0, 0.04 + below, 0));
      this.group.matrix.lookAt(this.head, pos, new THREE.Vector3(0, 1, 0)).setPosition(pos);
    }
  }

  // ---- building pages -----------------------------------------------------------------------

  build(now) {
    this.dirty = false;
    this.lastData = now;
    const d = this.p.data();
    const top = this.nav.stack.at(-1);
    const L = new Layout();
    const builder = PAGES[top.page] ?? PAGES.home;
    this.header(L, top, d);
    builder.call(this, L, d, top.params ?? {});
    const H = L.y + PAD;
    this.height = H;
    this.page.render(L.specs.map((sp) => ({ ...sp, y: H - sp.y })));
    this.chrome.render([{ key: 'glass', kind: 'glass', x: 0, y: H / 2, w: W, h: H, props: {} }]);
    this.buildChooser();
    // Tab bar: a floating pill under the panel.
    const ty = -(TAB_GAP + TAB_H / 2);
    const step = (TAB_W - 2 * 8 * MM) / TABS.length;
    this.tabs.render([
      { key: 'bar', kind: 'glass', x: 0, y: ty, z: TAB_Z, w: TAB_W, h: TAB_H, props: { radius: TAB_H / 2 } },
      ...TABS.map(([id, icon, label], i) => ({
        key: `tab-${id}`, kind: 'icon', x: -TAB_W / 2 + 8 * MM + step * (i + 0.5), y: ty, z: TAB_Z + 1 * MM, w: 19 * MM, h: 19 * MM,
        props: { icon, on: this.nav.tab === id, ghost: this.nav.tab !== id, label, id: `tab:${id}` },
        run: () => this.go(id),
      })),
    ]);
  }

  header(L, top, d) {
    const depth = this.nav.stack.length;
    const title = top.params?.title ?? PAGE_TITLES[top.page]?.(d, top.params) ?? 'Stratum';
    const sub = PAGE_SUBS[top.page]?.(d, top.params) ?? '';
    const emoji = top.page === 'app' ? d.apps.find((a) => a.id === top.params.app)?.icon : null;
    const iconW = 15 * MM;
    const searchable = SEARCH[top.page];
    L.at(0, HEADER_H, { key: 'header', kind: 'header', w: INNER, props: { title, sub, back: depth > 1, emoji, reserve: iconW * (searchable ? 3 : 2) + 6 * MM } });
    if (searchable) {
      L.place({ key: 'search', kind: 'icon', x: INNER / 2 - iconW * 2.5 - 4 * MM, y: L.y - HEADER_H / 2, w: iconW, h: iconW,
        props: { icon: 'search', label: 'Search', on: !!this.query(top.page) }, run: () => this.search(top.page, searchable) });
    }
    if (depth > 1) L.place({ key: 'back', kind: 'icon', x: -INNER / 2 + iconW / 2, y: L.y - HEADER_H / 2, w: iconW, h: iconW, props: { icon: 'back', label: 'Back' }, run: () => this.back() });
    L.place({ key: 'win', kind: 'icon', x: INNER / 2 - iconW * 1.5 - 2 * MM, y: L.y - HEADER_H / 2, w: iconW, h: iconW,
      props: { icon: this.mode === 'hand' ? 'expand' : 'palm', label: this.mode === 'hand' ? 'Pop out' : 'Back to hand' },
      run: () => (this.mode === 'hand' ? this.popOut() : this.toHand()) });
    L.place({ key: 'close', kind: 'icon', x: INNER / 2 - iconW / 2, y: L.y - HEADER_H / 2, w: iconW, h: iconW, props: { icon: 'close', label: 'Close' }, run: () => this.toggle(false) });
    L.gap(3 * MM);
  }

  // ---- search (the keyboard filters live as you type) ------------------------------------------

  query(page) { return this.state.q?.[page] ?? ''; }

  setQuery(page, v) {
    this.state.q = { ...this.state.q, [page]: v };
    this.state.appsPage = 0; this.state.layersPage = 0;
    for (const k of Object.keys(this.state)) if (k.startsWith('cat:') && !k.endsWith(':f')) this.state[k] = 0;
    this.dirty = true;
  }

  search(page, label) {
    const before = this.query(page);
    this.p.search?.(label, before, (v) => this.setQuery(page, v))?.then((v) => { if (v == null) this.setQuery(page, before); });
  }

  // ---- placement modes -----------------------------------------------------------------------

  popOut() {
    // A larger window, put down in front of you (facing you).
    const head = this.head ?? new THREE.Vector3(0, 1.5, 0);
    const cur = new THREE.Vector3().setFromMatrixPosition(this.group.matrix);
    const dir = cur.clone().sub(head).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const pos = head.clone().addScaledVector(dir, WINDOW_DIST).setY(head.y - 0.25);
    this.group.matrix.lookAt(head.clone().setY(pos.y), pos, new THREE.Vector3(0, 1, 0));
    this.group.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI)).setPosition(pos);
    this.mode = 'placed';
    this.windowed = true;
    this.dirty = true;
  }

  toHand() { this.mode = 'hand'; this.windowed = false; this.dirty = true; }

  grab(pose) {
    this.before = { mode: this.mode, at: new THREE.Vector3().setFromMatrixPosition(this.group.matrix) };
    this.mode = 'held';
    this.carryOffset = pose.clone().invert().multiply(this.group.matrix);
    this.dirty = true;
  }

  carry(pose) {
    if (this.mode !== 'held' || !this.carryOffset) return;
    this.group.matrix.copy(pose).multiply(this.carryOffset);
    this.group.matrixWorldNeedsUpdate = true;
  }

  release() {
    const moved = this.before && new THREE.Vector3().setFromMatrixPosition(this.group.matrix).distanceTo(this.before.at) > 0.015;
    if (this.mode === 'held') this.mode = moved || !this.before ? 'placed' : this.before.mode;
    this.before = null;
    this.carryOffset = null;
    this.dirty = true;
  }

  // ---- input --------------------------------------------------------------------------------

  // Body-local point → the widget there (tab bar first: it floats in front).
  pickAt(x, y) {
    if (this.modal) return this.modalLayer.pick(x, y);   // the chooser is on top: nothing behind it
    const t = this.tabs.pick(x, y);
    if (t) return t;
    return this.page.pick(x - this.page.group.position.x, y);
  }

  pickRay(ray, moveCursor = false) {
    if (!this.open) return null;
    const inv = this.body.matrixWorld.clone().invert();
    const o = ray.origin.clone().applyMatrix4(inv);
    const d = ray.origin.clone().add(ray.dir).applyMatrix4(inv).sub(o);
    if (Math.abs(d.z) < 1e-6) return null;
    // Where the ray crosses a layer's plane (the tab bar floats in front of the panel).
    const at = (z) => { const t = (z - o.z) / d.z; return t > 0 ? o.clone().addScaledVector(d, t) : null; };
    if (this.modal?.box) {   // the chooser floats in front and takes every ray that reaches the menu
      const q = at(MODAL_Z);
      const b = this.modal.box;
      const onModal = q && Math.abs(q.x) <= b.w / 2 && Math.abs(q.y - b.cy) <= b.h / 2;
      if (moveCursor) { this.cursor.visible = !!onModal; if (onModal) this.cursor.position.set(q.x, q.y, MODAL_Z + 3 * MM); }
      if (onModal) { const w = this.modalLayer.pick(q.x, q.y); return w ? { widget: w } : { panel: true }; }
      const p0 = at(0);
      return p0 && Math.abs(p0.x) <= W / 2 && p0.y >= 0 && p0.y <= this.height ? { panel: true } : null;
    }
    const pt = at(TAB_Z + 1 * MM);
    const onTabs = pt && Math.abs(pt.x) <= TAB_W / 2 && pt.y <= -TAB_GAP && pt.y >= -(TAB_GAP + TAB_H);
    const pp = at(0);
    const onPanel = pp && Math.abs(pp.x) <= W / 2 && pp.y >= 0 && pp.y <= this.height;
    const p = onTabs ? pt : pp;
    if (moveCursor) {
      this.cursor.visible = !!(onPanel || onTabs);
      if (p) this.cursor.position.set(p.x, p.y, onTabs ? TAB_Z + 2 * MM : 6 * MM);
    }
    if (onTabs) { const w = this.tabs.pick(pt.x, pt.y); return w ? { widget: w } : { panel: true }; }
    if (!onPanel) return null;
    // Raised widgets (e.g. a row's trash button) are tested at their own
    // depth first: at a steep angle the ray crosses them away from where it
    // crosses the panel.
    const px = this.page.group.position.x;
    let widget = null;
    for (const z of [...new Set([...this.page.widgets.values()].map((w) => w.tz).filter((z) => z > 0))].sort((a, b) => b - a)) {
      const q = at(z);
      widget = q && [...this.page.widgets.values()].find((w) => w.run && w.tz === z && w.contains(q.x - px, q.y));
      if (widget) break;
    }
    widget ??= this.page.pick(pp.x - px, pp.y);
    if (widget) return { widget };
    if (pp.y > this.height - HEADER_H - PAD) return { grab: true };
    return { panel: true };
  }

  hit(ray) { return this.pickRay(ray); }

  // Returns true if the ray was on the menu (pressed something or not).
  press(ray) {
    const h = this.pickRay(ray);
    if (!h) return false;
    if (h.widget) this.activate(h.widget);
    return true;
  }

  activate(w) {
    if (!w?.run) return;
    w.flash = 1;
    try { w.run(); } catch (err) { console.error(err); }
    this.dirty = true;
  }

  // Fingertips: hover within 6 cm, press on contact (≤ 4 mm from the
  // widget's face, from the side approached), re-arm after pulling back.
  poke(tips) {
    const inv = this.body.matrixWorld.clone().invert();
    let target = null, nearest = Infinity;
    const seen = new Set();
    for (const { id, p } of tips) {
      if (!p) continue;
      seen.add(id);
      const l = p.clone().applyMatrix4(inv);
      const st = this.pokes.get(id) ?? { side: 0, pressed: false };
      this.pokes.set(id, st);
      const w = this.pickAt(l.x, l.y);
      const face = w ? w.tz : 0;
      const z = l.z - face;
      const mb = this.modal?.box;
      const inside = mb ? Math.abs(l.x) <= mb.w / 2 && Math.abs(l.y - mb.cy) <= mb.h / 2
        : (Math.abs(l.x) <= W / 2 && l.y >= -(TAB_GAP + TAB_H) && l.y <= this.height);
      if (!inside || Math.abs(z) > POKE_NEAR / this.body.scale.x) { st.side = 0; st.pressed = false; continue; }
      if (!st.pressed && Math.abs(z) > POKE_SIDE) st.side = Math.sign(z);
      if (!st.side) continue;
      const dist = z * st.side;
      if (Math.abs(dist) < nearest) {
        nearest = Math.abs(dist);
        target = w;
        this.cursor.visible = true;
        this.cursor.position.set(l.x, l.y, face + 2 * MM * st.side);
      }
      if (w) w.pressed = dist < POKE_RELEASE;
      if (!st.pressed && dist <= POKE_PRESS) { st.pressed = true; this.activate(w); }
      else if (st.pressed && dist > POKE_RELEASE) st.pressed = false;
    }
    for (const id of [...this.pokes.keys()]) if (!seen.has(id)) this.pokes.delete(id);
    return target;
  }

  // ---- test helpers --------------------------------------------------------------------------

  find(label) { return this.modal ? this.modalLayer.find(label) : this.tabs.find(label) ?? this.page.find(label); }

  worldOf(w) {
    this.group.updateMatrixWorld(true);
    const own = (layer) => layer.widgets.get(w.key) === w;
    const layerX = own(this.tabs) || own(this.modalLayer) ? 0 : this.page.group.position.x;
    return new THREE.Vector3(w.tx + layerX, w.ty, w.tz).applyMatrix4(this.body.matrixWorld);   // on its face (rays at any angle land on it)
  }

  // World point at panel-local (x, y) on the panel face (tests, tools).
  worldAt(x, y, z = 1 * MM) {
    this.group.updateMatrixWorld(true);
    return new THREE.Vector3(x, y, z).applyMatrix4(this.body.matrixWorld);
  }

  labels() { return [...this.page.widgets.values(), ...this.tabs.widgets.values(), ...this.modalLayer.widgets.values()].filter((w) => w.run).map((w) => w.props.label ?? w.props.title ?? w.key); }
}

// ---- layout helper (top-down cursor; y grows downward until build flips it) --------------------

class Layout {
  constructor() { this.y = PAD; this.specs = []; }
  gap(h) { this.y += h; }
  // Full-width block of height h at the cursor.
  at(x, h, spec) {
    this.specs.push({ x, y: this.y + h / 2, w: spec.w ?? INNER, h, ...spec });
    this.y += h;
  }
  place(spec) { this.specs.push(spec); }   // absolute (y top-down, center)
  section(key, label, right) { this.at(0, SECTION_H, { key, kind: 'section', props: { label, right } }); this.gap(1.5 * MM); }
  row(key, props, run) { this.at(0, ROW_H, { key, kind: 'row', props, run }); this.gap(2.5 * MM); }
  // Equal columns of widgets.
  grid(items, cols, h, gap = GAP) {
    const w = (INNER - gap * (cols - 1)) / cols;
    items.forEach((it, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      this.specs.push({ ...it, x: -INNER / 2 + w / 2 + c * (w + gap), y: this.y + r * (h + gap) + h / 2, w, h });
    });
    this.y += Math.ceil(items.length / cols) * (h + gap);
  }
  // Pills that wrap (chips).
  chips(items, h = 11 * MM) {
    let x = -INNER / 2, rowY = this.y;
    for (const it of items) {
      const w = Math.min(INNER, 10 * MM + it.props.label.length * 2.7 * MM);
      if (x + w > INNER / 2 + 1e-6) { x = -INNER / 2; rowY += h + 3 * MM; }
      this.specs.push({ kind: 'chip', ...it, x: x + w / 2, y: rowY + h / 2, w, h });
      x += w + 3 * MM;
    }
    this.y = rowY + h + 4 * MM;
  }
}

// ---- pages --------------------------------------------------------------------------------------

const PAGE_TITLES = {
  home: (d) => d.space?.name ?? 'Stratum',
  apps: () => 'Apps',
  layers: () => 'Layers',
  space: (d) => d.space?.name ?? 'Space',
  settings: () => 'Settings',
  help: () => 'Gestures',
  app: (d, p) => d.apps.find((a) => a.id === p.app)?.name ?? 'App',
  catalog: (d, p) => (p.app ? `${d.apps.find((a) => a.id === p.app)?.name ?? ''} catalog` : 'Place'),
  perf: () => 'Performance',
  probe: () => 'Slowdown test',
};
const PAGE_SUBS = {
  home: (d) => (d.armed ? d.status : d.space ? `${d.space.here ? `${d.space.here + 1} people here` : d.space.members.length > 1 ? `Shared with ${d.space.members.length - 1}` : 'Only you'}${d.space.placeShared ? ' · new things shared' : ''}` : d.status),
  apps: (d) => `${d.apps.length} available · ${d.apps.filter((a) => a.enabled).length} on`,
  layers: (d) => `${d.layers.filter((l) => l.visible).length} of ${d.layers.length} visible`,
  space: (d) => (d.space ? `${d.space.members.length} ${d.space.members.length === 1 ? 'member' : 'members'}${d.space.here ? ` · ${d.space.here} here now` : ''}` : 'No saved space here'),
  settings: () => 'How to do things with your hands',
  gesture: (d, p) => p.cat,
  app: (d, p) => { const a = d.apps.find((x) => x.id === p.app); return a ? (a.crashed?.slow && !a.running ? 'Stopped: too slow' : a.crashed && !a.running ? 'Crashed · restarting' : a.running ? `${a.running} here · ${a.status || 'running'}` : a.enabled ? 'On' : 'Off') : ''; },
  catalog: (d, p) => `${catalogItems(d, p).length} items`,
  perf: (d) => frameLine(d.perf?.frame),
  probe: (d) => (d.perf?.probe?.running ? `Testing ${d.perf.probe.step} of ${d.perf.probe.of}…` : 'fps with one thing off at a time'),
};

// "Biggest: Room mapping off +31 fps"
export function probeLine(results) {
  const base = results[0]?.fps ?? 0, rest = results.filter((x) => x.key !== 'base' && x.key !== 'all');
  const best = [...rest].sort((a, b) => b.fps - a.fps)[0];
  return best ? `Biggest: ${best.label} ${best.fps - base >= 0 ? '+' : ''}${Math.round(best.fps - base)} fps (from ${Math.round(base)})` : `${Math.round(base)} fps`;
}

// "72 fps of 72 · 6.1 of 13.9 ms · 3 dropped"
export function frameLine(f) {
  if (!f) return 'Measured in AR';
  return `${Math.round(f.fps)} fps of ${f.target} · ${f.workMs.toFixed(1)} of ${f.budgetMs.toFixed(1)} ms · ${f.dropped} dropped`;
}

// One app's cost, in words: "1.2 ms · physics asleep · 45k triangles · no LOD"
export function costLine(a) {
  const tris = a.tris >= 1000 ? `${Math.round(a.tris / 1000)}k` : `${a.tris}`;
  return [`${a.ms.toFixed(1)} ms`, a.sims ? (a.asleep ? 'physics asleep' : `physics ${a.physMs.toFixed(1)} ms`) : null, `${tris} triangles`,
    a.noLod ? 'no LOD' : a.lods ? 'LOD' : null, a.throttled ? 'slowed down' : null, a.allowed ? 'allowed' : null].filter(Boolean).join(' · ');
}

// The full catalog: one tile per app with variants (it opens the chooser);
// an app's own catalog lists its variants directly.
function catalogItems(d, p) {
  return p.app ? d.placeables.filter((it) => it.app === p.app) : d.places;
}

function paged(menu, key, items, per) {
  const pages = Math.max(1, Math.ceil(items.length / per));
  const i = Math.min(menu.state[key] ?? 0, pages - 1);
  menu.state[key] = i;
  return { slice: items.slice(i * per, i * per + per), page: i, pages };
}

function pager(menu, L, key, { page, pages }) {
  if (pages < 2) return;
  const y = L.y + 6 * MM;
  L.place({ key: `${key}-prev`, kind: 'icon', x: -INNER / 2 + 7 * MM, y, w: 13 * MM, h: 13 * MM, props: { icon: 'back', label: 'Previous page' }, run: () => { menu.state[key] = (page - 1 + pages) % pages; menu.dirty = true; } });
  L.place({ key: `${key}-dots`, kind: 'dots', x: 0, y, w: 60 * MM, h: 4 * MM, props: { count: pages, index: page } });
  L.place({ key: `${key}-next`, kind: 'icon', x: INNER / 2 - 7 * MM, y, w: 13 * MM, h: 13 * MM, props: { icon: 'next', label: 'Next page' }, run: () => { menu.state[key] = (page + 1) % pages; menu.dirty = true; } });
  L.gap(14 * MM);
}

const SEARCH = { apps: 'Search apps', catalog: 'Search items', layers: 'Search layers' };
const matches = (q, ...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q.trim().toLowerCase()));

// The active search as a chip (tap to clear).
function queryChip(menu, L, page) {
  const q = menu.query(page);
  if (q) L.chips([{ key: 'q-chip', props: { label: `“${q}”  ✕`, on: true }, run: () => menu.setQuery(page, '') }]);
  return q;
}

// A Place tile: arms the item, or (an app with variants) opens the chooser.
function placeRun(menu, it, armed) {
  return it.chooser ? () => menu.choose(it) : () => menu.p.arm(it.key === armed ? null : it.key);
}

const tileOf = (it, armed, run) => ({ key: `tile-${it.key}`, kind: 'tile', props: { emoji: it.emoji, icon: it.icon, label: it.name, color: it.color, on: it.key === armed, id: it.key }, run });

// The Gestures tab: a cheat sheet, by topic. Each row opens the details.
// Keep in step with the code (DESIGN.md §8.3 / §8.7); controllers noted where they differ.
const GESTURES = [
  ['Basics', [
    ['🖐', 'Open this menu', 'Turn your left palm toward your face', 'Hold it there a moment. Turn the palm away to close it again. Controllers: the Y button. To move the menu, pinch and hold its top bar, then let go where you want it.'],
    ['👆', 'Press a button', 'Poke it with an index fingertip, or aim and pinch', 'Your right index finger pokes the menu (the left one too, once the menu is off that hand). From farther away, aim the ray and pinch. Controllers: the trigger.'],
    ['⌨️', 'Bring up the keyboard', 'Both hands out, index fingers pointing down', 'Hold the pose about a second. It types into what you touched last: a browser pane or a text field. Keys click when pressed.'],
    ['✌️', 'Scroll', 'Index + middle out, others curled, move the hand', 'Scrolls whatever those two fingers point at (else the app you touched last). You can also pinch on a page and drag the ray.'],
  ]],
  ['Move', [
    ['🤏', 'Pick something up', 'Pinch and hold still until the box closes', 'After half a second, dots appear at the corners and the edges grow toward each other. When the box closes, it moves with your hand; let go to put it down. Let go before it closes to cancel. Edges and bases pick up faster; some apps set their own timing. Controllers: the grip grabs at once.'],
    ['🙌', 'Resize and turn', 'While moving it, pinch with your other hand too', 'The box turns amber. Move your hands apart or together to resize; turn them to rotate. Let go with the second hand to carry on with one.'],
    ['📍', 'Place something', 'Pick it in the menu, then pinch a surface', 'One pinch places one. Pinching empty space without picking anything never creates things.'],
    ['◎', 'Turntable', 'Drop things on it; swipe or poke ‹ › to change', 'Place a ◎ Turntable (Place menu), then pick things up and let go over it: each goes in a slot and shows on top. Only one shows at a time. Poke or pinch the ‹ › arrows, or pinch-drag sideways on it, to step through; everyone in the space sees the same one. Carry the one on top away to take it out. Apps waiting in a slot pause.'],
  ]],
  ['Hidden', [
    ['✨', 'Revelio: see hidden things', 'Open hand, palm away, slide it sideways', 'Hold a hand up in front of you, open, palm facing away (like wiping a window), and slide it sideways about a hand\'s width at an easy pace: right hand to the right, left hand to the left. A band rings out and everything you hid on this headset glows for a few seconds (the one you aim at stays while you do); bring one back and the rest fade. Or: Layers → ✨ Reveal hidden.'],
    ['👌', 'Bring one thing back', 'Aim at a glow, fingertips together, then spread', 'Fingertips together (or a pinch) on a glow selects it: it glows brighter. Spread your fingers and that one thing shows again; the rest of its layer stays hidden until you next toggle the layer. Controllers: the trigger on a glow.'],
    ['💨', 'Shoo: hide one thing', 'Fingertips together on it a moment, then open and turn', 'Aim at it with all five fingertips together and hold a moment, then open your hand while turning it well over 45° (right hand clockwise, left counter-clockwise), like flicking it away. It hides on this headset only. Get it back with Revelio, or Layers → Show shooed.'],
  ]],
];

// Apps add theirs from their manifests ("gestures": [{icon, name, how, more}]).
function gestureGroups(d) {
  const mine = (d.apps ?? []).filter((a) => a.enabled).flatMap((a) => (a.gestures ?? []).map((g) => [g.icon ?? a.icon, g.name ?? a.name, g.how, g.more ?? g.how]));
  return mine.length ? [...GESTURES, ['In apps', mine]] : GESTURES;
}

const PAGES = {
  home(L, d) {
    const p = this.p;
    if (d.tag && !d.space) {   // a printed tag in view that isn't a Space yet
      if (d.camera && d.camera.state !== 'calibrated') {
        L.row('tag-create', { icon: 'sliders', label: d.camera.state === 'calibrating' ? 'Calibrating the camera…' : `Tag ${d.tag.id} seen: calibrate the camera`,
          sub: d.camera.state === 'calibrating' ? d.camera.note : 'Once, so tags line up exactly with phones', active: true }, () => p.calibrate());
      } else {
        L.row('tag-create', { icon: 'space', label: `Create a space at tag ${d.tag.id}`, sub: 'Phones and headsets that see this tag share it', active: true, chevron: true }, () => p.createAtTag());
      }
    }
    if (d.selection) {
      const s = d.selection;
      L.at(0, 22 * MM, { key: 'sel', kind: 'card', props: { emoji: s.emoji, title: s.name, sub: s.sub } });
      L.gap(3 * MM);
      const tools = [
        ['carry', 'carry', 'Pick up'], ['moveHere', 'move', 'Move here'], ['minus', 'smaller', 'Smaller'], ['plus', 'bigger', 'Bigger'], ['rotate', 'rotate', 'Rotate'],
        ...(s.shareable ? [[s.shared ? 'people' : 'lock', 'share', s.shared ? 'Shared' : 'Private']] : []),
        ['trash', 'delete', 'Delete'], ['close', 'done', 'Done'],
      ];
      L.grid(tools.map(([icon, act, label]) => ({ key: `tool-${act}`, kind: 'icon', props: { icon, label, danger: act === 'delete', on: act === 'share' && s.shared }, run: () => p.edit(act) })), tools.length, 17 * MM, 2 * MM);
      if (s.actions.length) { L.chips(s.actions.map((a, i) => ({ key: `act-${i}-${a.label}`, props: { label: a.label }, run: a.run }))); }
      L.gap(1 * MM);
    }
    // Apps the watchdog stopped for slowing everything down: say so, one tap to the app's page (Run anyway).
    for (const a of d.apps.filter((x) => x.crashed?.slow && !x.running)) L.row(`slow-${a.id}`, { emoji: '🐢', label: `${a.name} was stopped: too slow`, sub: a.crashed.message, chevron: true }, () => this.go('app', { app: a.id }));
    // Apps' pinned lists (ctx.menu({ pin: true, … })), e.g. a dictionary of things to find: one tap away.
    for (const a of d.apps.filter((x) => x.enabled && x.menu?.pin)) appSection(this, L, a, 3);
    L.section('place-h', 'Place', d.armed ? 'Pinch a surface' : '');
    const recent = d.recent.slice(0, 3);
    L.grid([
      ...recent.map((it) => tileOf(it, d.armed, () => p.arm(it.key === d.armed ? null : it.key))),
      { key: 'tile-more', kind: 'tile', props: { icon: 'apps', label: 'All', color: '#3b4252', id: 'more' }, run: () => this.go('catalog', {}) },
    ], 4, 40 * MM, 3 * MM);
    const running = d.running;
    if (running.length) {
      L.section('run-h', 'Running here', running.length > 3 ? `${running.length}` : '');
      for (const r of running.slice(0, 3)) L.row(`run-${r.app}`, { emoji: r.icon, label: r.name, sub: r.status || 'Running', chevron: true }, () => this.go('app', { app: r.app }));
    } else if (!d.selection) {
      L.at(0, 9 * MM, { key: 'hint', kind: 'text', props: { label: 'Pinch an item, then pinch a surface to place it' } });
    }
  },

  apps(L, d) {
    const q = queryChip(this, L, 'apps');
    const cats = ['All', 'On', ...[...new Set(d.apps.map((a) => a.category).filter(Boolean))].sort()];
    const f = this.state.appFilter ?? 'All';
    L.chips(cats.slice(0, 7).map((c) => ({ key: `cat-${c}`, props: { label: c, on: c === f }, run: () => { this.state.appFilter = c; this.state.appsPage = 0; this.dirty = true; } })));
    const list = d.apps.filter((a) => (f === 'All' || (f === 'On' ? a.enabled : a.category === f)) && matches(q, a.name, a.category, a.description))
      .sort((a, b) => (b.running - a.running) || (b.enabled - a.enabled) || a.name.localeCompare(b.name));
    const pg = paged(this, 'appsPage', list, 9);
    L.grid(pg.slice.map((a) => ({ key: `app-${a.id}`, kind: 'tile', props: { emoji: a.icon, label: a.name, color: a.color, badge: a.running ? 'running' : a.enabled ? 'on' : null, dim: !a.enabled, id: `app:${a.id}` }, run: () => this.go('app', { app: a.id }) })), 3, 44 * MM, 3 * MM);
    pager(this, L, 'appsPage', pg);
  },

  app(L, d, params) {
    const a = d.apps.find((x) => x.id === params.app);
    if (!a) return;
    const p = this.p;
    if (a.crashed?.slow && !a.running) {   // the watchdog stopped it (perf.js)
      L.row('slow', { emoji: '🐢', label: 'Stopped: it slowed everything down', sub: a.crashed.message }, () => {});
      L.row('slow-run', { icon: 'power', label: 'Run anyway', sub: 'Don\'t slow down or stop it on this headset' }, () => p.allowSlow(a.id));
    } else if (a.crashed && !a.running) L.row('crashed', { emoji: '⚠️', label: 'Crashed: stopped, restarting soon', sub: a.crashed.message }, () => {});
    if (a.perfAllowed) L.row('slow-allowed', { icon: 'power', label: 'Allowed to be slow', sub: 'Tap to let the watchdog slow it down again', toggle: true }, () => p.disallowSlow(a.id));
    L.row('enabled', { icon: 'power', label: a.enabled ? 'On' : 'Off', sub: a.enabled ? 'Shows and runs in your spaces' : 'Hidden and stopped', toggle: a.enabled }, () => p.toggleApp(a.id));
    if (a.enabled) {
      if (a.panel) appPanel(this, L, a);    // the app's own UI first (ctx.panel): it's what the app is about
      if (a.menu) appSection(this, L, a);
      const items = d.placeables.filter((it) => it.app === a.id);
      if (items.length) {
        L.section('ap-place', 'Place', items.length > 6 ? `${items.length}` : '');
        L.grid(items.slice(0, items.length > 6 ? 5 : 6).map((it) => tileOf(it, d.armed, () => p.arm(it.key === d.armed ? null : it.key))), 3, 40 * MM, 3 * MM);
        if (items.length > 6) L.row('ap-browse', { icon: 'apps', label: `Browse all ${items.length}`, chevron: true }, () => this.go('catalog', { app: a.id }));
      }
      if (a.instances.length) {
        L.section('ap-here', 'Here', `${a.instances.length}`);
        a.instances.slice(0, 3).forEach((inst, i) => L.row(`inst-${inst.id}`, { emoji: a.icon, label: inst.label ?? `${a.name} ${i + 1}`, sub: inst.status || 'Tap to select', chevron: true }, () => { p.selectObject(inst.id); this.go('home'); }));
      }
      if (a.actions.length && !a.panel) {   // (an app with a panel has its controls there)
        L.section('ap-act', 'Actions');
        L.chips(a.actions.map((x, i) => ({ key: `aa-${i}-${x.label}`, props: { label: x.label }, run: x.run })));
      }
      if (a.settings.length) {
        L.section('ap-set', 'Settings');
        for (const s of a.settings) settingRow(this, L, a, s);
      }
    }
    L.section('ap-about', 'About');
    L.at(0, 14 * MM, { key: 'ap-desc', kind: 'text', props: { label: wrap(a.description, 52).slice(0, 2).join('\n') } });
    if (a.permissions.length) L.at(0, 7 * MM, { key: 'ap-perm', kind: 'text', props: { label: `Uses: ${a.permissions.join(', ')}`, color: '#6b7385' } });
  },

  catalog(L, d, params) {
    const p = this.p;
    const q = queryChip(this, L, 'catalog');
    const all = catalogItems(d, params).filter((it) => matches(q, it.name, it.category));
    const cats = ['All', ...new Set(all.map((it) => it.category).filter(Boolean))];
    const key = `cat:${params.app ?? '*'}`;
    const f = this.state[`${key}:f`] ?? 'All';
    L.chips(cats.slice(0, 7).map((c) => ({ key: `cc-${c}`, props: { label: c, on: c === f }, run: () => { this.state[`${key}:f`] = c; this.state[key] = 0; this.dirty = true; } })));
    const pg = paged(this, key, all.filter((it) => f === 'All' || it.category === f), 6);
    L.grid(pg.slice.map((it) => tileOf(it, d.armed, placeRun(this, it, d.armed))), 3, 42 * MM, 3 * MM);
    pager(this, L, key, pg);
  },

  help(L, d) {
    const groups = gestureGroups(d);
    const cat = this.state.helpCat ?? groups[0][0];
    L.chips(groups.map(([c]) => ({ key: `gc-${c}`, props: { label: c, on: c === cat }, run: () => { this.state.helpCat = c; this.dirty = true; } })));
    const list = groups.find(([c]) => c === cat)?.[1] ?? [];
    for (const [emoji, label, sub, more] of list) L.row(`g-${label}`, { emoji, label, sub, chevron: true }, () => this.go('gesture', { title: label, cat, more }));
  },

  gesture(L, d, p) {
    const lines = wrap(p.more, 40);
    L.at(0, lines.length * 8.5 * MM, { key: 'g-more', kind: 'text', props: { label: lines.join('\n'), color: '#d5dbe7' } });
  },

  layers(L, d) {
    const p = this.p;
    const q = queryChip(this, L, 'layers');
    const groups = [['space', 'Spaces'], ['personal', 'Mine'], ['app', 'Apps'], ['public', 'Public']];
    const rows = [];
    for (const [g, label] of groups) {
      const ls = d.layers.filter((l) => l.group === g && matches(q, l.name));
      if (!ls.length) continue;
      rows.push({ section: label, key: `lg-${g}` });
      for (const l of ls) rows.push(l);
    }
    // Revelio (DESIGN.md §8.7): cast from here too (controllers), choose which layers it shows, undo shoos.
    const hid = d.hidden ?? { here: 0, shooed: 0 }, mode = !!this.state.revealMode;
    L.chips([
      { key: 'revelio', props: { label: `✨ Reveal hidden${hid.here ? ` (${hid.here})` : ''}`, on: false }, run: () => { p.castRevelio(); this.dirty = true; } },
      { key: 'reveal-mode', props: { label: 'Revealable…', on: mode }, run: () => { this.state.revealMode = !mode; this.dirty = true; } },
      ...(hid.shooed ? [{ key: 'shooed', props: { label: `Show ${hid.shooed} shooed`, on: false }, run: () => { p.showShooed(); this.dirty = true; } }] : []),
    ]);
    const pg = paged(this, 'layersPage', rows, 6);
    for (const r of pg.slice) {
      if (r.section) L.section(r.key, r.section);
      else if (mode) L.row(`layer-${r.id}`, { emoji: r.emoji, icon: r.emoji ? null : 'layers', label: r.name, sub: r.revealable ? 'Revelio can show it' : 'Revelio skips it', toggle: r.revealable }, () => { p.setRevealable(r.id, !r.revealable); this.dirty = true; });
      else L.row(`layer-${r.id}`, { emoji: r.emoji, icon: r.emoji ? null : r.visible ? 'eye' : 'eyeOff', label: r.name, sub: `${r.count} ${r.count === 1 ? 'thing' : 'things'}`, toggle: r.visible }, () => p.setLayerVisible(r.id, !r.visible));
    }
    pager(this, L, 'layersPage', pg);
    if (d.layers.some((l) => !l.visible)) L.row('show-all', { icon: 'eye', label: 'Show everything' }, () => p.showAllLayers());
  },

  space(L, d) {
    const p = this.p;
    const s = d.space;
    if (!s) {
      if (d.tag) L.row('tag-create2', { icon: 'space', label: `Create a space at tag ${d.tag.id}`, sub: 'Shared by every device that sees the tag', active: true }, () => p.createAtTag());
      L.at(0, 18 * MM, { key: 'nospace', kind: 'text', props: { label: 'Place something to make a space here,\nor look at a printed tag.' } });
      L.row('join', { icon: 'join', label: 'Join with a code', chevron: true }, () => p.join());
      spaceList(this, L, d);
      return;
    }
    L.row('members', { icon: 'people', label: s.members.join(', '), sub: s.here ? `${s.here} here now` : 'Members' });
    L.row('invite', { icon: 'mail', label: 'Invite someone', value: s.inviteCode ?? null, sub: s.inviteCode ? 'Code valid 24 h' : null }, () => p.invite());
    L.row('share-new', { icon: 'people', label: 'Share new things', sub: 'Everyone in this space sees them', toggle: s.placeShared }, () => p.setPlaceShared(!s.placeShared));
    L.row('join', { icon: 'join', label: 'Join with a code', chevron: true }, () => p.join());
    L.section('room-h', 'Room map', s.mapSummary || 'Builds itself as you look around');
    L.row('show-map', { icon: 'layers', label: 'Show the map', toggle: s.showMap }, () => p.setShowMap(!s.showMap));
    L.row('clear-map', { icon: 'trash', label: s.resetArmed ? 'Tap again to reset' : 'Reset this room\'s map', sub: 'For everyone in this space', danger: true }, () => p.clearMap());
    spaceList(this, L, d);
  },

  // What each running app costs (perf.js), costliest first; the watchdog's stops; tap one for its page.
  perf(L, d) {
    const r = d.perf;
    if (!r) return;
    const pr = r.probe;
    if (pr?.running) L.row('pf-probe', { icon: 'sliders', label: `Testing ${pr.step} of ${pr.of}: ${pr.label}`, sub: 'Tap to stop (everything comes back on)', active: true }, () => this.p.cancelProbe());
    else if (r.inXR) L.row('pf-probe', { icon: 'sliders', label: 'Find the slowdown', sub: 'About a minute: close the menu, look where it was slow', chevron: true }, () => { this.p.startProbe(); this.go('probe'); });
    if (pr?.results?.length && !pr.running) L.row('pf-probe-res', { icon: 'sliders', label: 'Last test', sub: probeLine(pr.results), chevron: true }, () => this.go('probe'));
    if (r.overloaded) L.at(0, 8 * MM, { key: 'pf-over', kind: 'text', props: { label: 'Under load: hungry apps get slowed down', color: '#ffa94d' } });
    for (const s of r.stopped) L.row(`pf-stop-${s.app}`, { emoji: '🐢', label: `${d.apps.find((a) => a.id === s.app)?.name ?? s.app}: stopped`, sub: s.message, chevron: true }, () => this.go('app', { app: s.app }));
    const pg = paged(this, 'perfPage', r.apps, 6);
    pg.slice.forEach((a) => L.row(`pf-${a.instance}`, { emoji: a.icon, label: a.name, sub: costLine(a), chevron: true }, () => this.go('app', { app: a.app })));
    pager(this, L, 'perfPage', pg);
    if (!r.apps.length) L.at(0, 8 * MM, { key: 'pf-none', kind: 'text', props: { label: 'No apps running here' } });
  },

  // The slowdown test's results: fps with each thing off, against "as it is".
  probe(L, d) {
    const pr = d.perf?.probe;
    if (!pr) return;
    if (pr.running) L.row('pb-run', { icon: 'sliders', label: `Testing: ${pr.label}`, sub: `${pr.step} of ${pr.of} · tap to stop`, active: true }, () => this.p.cancelProbe());
    const base = pr.results[0]?.fps;
    for (const x of pr.results) {
      const gain = base != null && x.key !== 'base' ? x.fps - base : null;
      L.row(`pb-${x.key}`, { icon: 'sliders', label: x.label, value: `${Math.round(x.fps)} fps`,
        sub: `${gain == null ? 'baseline' : `${gain >= 0 ? '+' : ''}${Math.round(gain)} fps`} · ${x.gapMs} ms a frame (worst 5 %: ${x.p95Ms}) · our work ${x.workMs} ms` }, () => {});
    }
    if (!pr.running && !pr.results.length) L.at(0, 8 * MM, { key: 'pb-none', kind: 'text', props: { label: 'Not run yet' } });
    if (!pr.running && d.perf.inXR) L.row('pb-again', { icon: 'sliders', label: pr.results.length ? 'Run again' : 'Run it', chevron: true }, () => this.p.startProbe());
  },

  settings(L, d) {
    const p = this.p;
    const s = d.settings;
    L.row('hands', { icon: 'hand', label: 'Show hands', sub: 'Outline over your tracked hands', toggle: s.hands }, () => p.setSetting('hands', !s.hands));
    L.row('occlusion', { icon: 'half', label: 'Occlusion', sub: s.occlusionNote, toggle: s.occlusion }, () => p.setSetting('occlusion', !s.occlusion));
    L.row('room-light', { icon: 'sun', label: 'Match the room\'s light', sub: s.roomLightNote, toggle: s.roomLight }, () => p.setSetting('roomLight', !s.roomLight));
    L.row('roam', { icon: 'map', label: 'Roam past the boundary', sub: s.roamNote, toggle: s.roam }, () => p.setSetting('roam', !s.roam));
    L.row('map-on', { icon: 'map', label: 'Map the room', sub: s.mapNote, toggle: s.map }, () => p.setSetting('map', !s.map));
    L.row('show-map2', { icon: 'layers', label: 'Show the map', sub: 'Surfaces and what the map sees as solid', toggle: s.showMap }, () => p.setShowMap(!s.showMap));
    if (d.camera) {   // the headset camera: sees printed tags (DESIGN.md §3.9)
      const c = d.camera;
      L.section('cam-h', 'Headset camera');
      L.row('cam', { icon: 'eye', label: 'See printed tags', sub: c.note, toggle: c.on }, () => p.setCamera(!c.on));
      if (c.live) {
        L.row('cam-cal', { icon: 'sliders', label: c.state === 'calibrating' ? 'Cancel calibration' : 'Calibrate with a tag',
          sub: c.state === 'calibrating' ? 'Look at one tag, move your head slowly' : 'Hold still in front of a tag ~50 cm away', active: c.state === 'calibrating' }, () => p.calibrate());
        if (c.state === 'calibrated') L.row('cam-forget', { icon: 'trash', label: 'Forget calibration', danger: true }, () => p.forgetCalibration());
      }
    }
    L.row('steady', { icon: 'sliders', label: 'Hold spaces still', sub: 'For sitting: only move a space if it is clearly off',
      value: s.steady ? 'On' : 'Off' }, () => p.setSetting('steady', !s.steady));
    L.row('kb-layout', { icon: 'sliders', label: 'Keyboard', sub: 'Pop-up keyboard layout (placed keyboards: in their tools)',
      value: s.kbLayout === 'full' ? 'Full + number pad' : 'Simple' }, () => p.setSetting('kbLayout', s.kbLayout === 'full' ? 'simple' : 'full'));
    L.row('menu-size', { icon: 'sliders', label: 'Menu size', value: { 0.85: 'Small', 1: 'Medium', 1.2: 'Large' }[s.menuScale] ?? 'Medium' }, () => p.setSetting('menuScale', s.menuScale === 0.85 ? 1 : s.menuScale === 1 ? 1.2 : 0.85));
    L.row('fps-hud', { icon: 'eye', label: 'FPS meter', sub: 'Always in view: frame rate and what each app costs', toggle: s.fpsHud }, () => p.setSetting('fpsHud', !s.fpsHud));
    const hr = s.handRec;
    L.row('label-mode', { icon: 'hand', label: 'Gesture labelling', sub: s.labelMode ? 'On: gestures off, label pad on your left' : 'Gestures off; tap a big button, then do the gesture', toggle: !!s.labelMode }, () => p.setSetting('labelMode', !s.labelMode));
    if (hr) L.row('hand-rec', { icon: 'hand', label: 'Record hand motion', sub: hr.full ? 'Storage full on the server' : hr.live ? `For gesture training · ${hr.mb} MB sent${hr.failed ? ` · ${hr.failed} failed` : ''}` : 'For gesture training: hands + head, uploaded', toggle: hr.on }, () => p.setSetting('handRec', !hr.on));
    L.row('perf', { icon: 'sliders', label: 'Performance', sub: frameLine(d.perf?.frame), chevron: true }, () => this.go('perf'));
    L.row('exit', { icon: 'exit', label: 'Exit AR', danger: true }, () => p.exit());
    L.at(0, 8 * MM, { key: 'ver', kind: 'text', props: { label: d.version, color: '#6b7385' } });
  },
};

// The app's own section (ctx.menu): rows, paged; an optional trash button
// per row and an "add" row at the end.
// An app's own UI (ctx.panel): full-size controls, laid out from its blocks.
//   { kind: 'section', label } · { kind: 'text', text }
//   { kind: 'buttons', items: [{ label, emoji | icon, tone: 'primary' | 'go' | 'danger', on, disabled, run }], cols }
//   { kind: 'stepper', label, value, dec, inc } · { kind: 'toggle', label, sub, on, run }
//   { kind: 'choice', label, options: [{ id, label, emoji }], value, pick(id), cols } · { kind: 'row', label, sub, emoji, run }
const PAD_H = 24 * MM;
function appPanel(menu, L, a) {
  const sp = a.panel, key = `ap-${a.id}`;
  if (sp.title || sp.sub) L.section(`${key}-t`, sp.title ?? '', sp.sub ?? '');
  (sp.blocks ?? []).forEach((b, bi) => {
    const k = `${key}-${bi}`;
    if (b.kind === 'section') L.section(k, b.label ?? '', b.right ?? '');
    else if (b.kind === 'text') {
      const lines = wrap(String(b.text ?? ''), 50).slice(0, b.lines ?? 4);
      L.at(0, lines.length * 6.5 * MM, { key: k, kind: 'text', props: { label: lines.join('\n'), color: b.color } });
      L.gap(2 * MM);
    } else if (b.kind === 'buttons') {
      const items = b.items ?? [];
      const cols = b.cols ?? Math.min(4, Math.max(1, items.length));
      L.grid(items.map((it, i) => ({ key: `${k}-${i}-${it.label ?? it.emoji ?? ''}`, kind: 'pad',
        props: { label: it.label, emoji: it.emoji, icon: it.icon, tone: it.tone, on: it.on, disabled: it.disabled }, run: it.disabled ? () => {} : it.run })), cols, b.h ?? PAD_H, 3 * MM);
    } else if (b.kind === 'stepper') {
      if (b.label) L.section(`${k}-l`, b.label, b.right ?? '');
      L.grid([
        { key: `${k}-dec`, kind: 'pad', props: { icon: 'minus', disabled: !b.dec }, run: b.dec ?? (() => {}) },
        { key: `${k}-v`, kind: 'value', props: { label: String(b.value ?? '') } },
        { key: `${k}-inc`, kind: 'pad', props: { icon: 'plus', disabled: !b.inc }, run: b.inc ?? (() => {}) },
      ], 3, 20 * MM, 3 * MM);
    } else if (b.kind === 'toggle') L.row(k, { label: b.label, sub: b.sub, toggle: !!b.on }, b.run);
    else if (b.kind === 'choice') {
      if (b.label) L.section(`${k}-l`, b.label);
      const opts = b.options ?? [];
      const cols = b.cols ?? (opts.length <= 4 ? opts.length : 3);
      L.grid(opts.map((o) => ({ key: `${k}-${o.id}`, kind: 'pad', props: { label: o.label, emoji: o.emoji, icon: o.icon, on: o.id === b.value },
        run: () => b.pick?.(o.id) })), Math.max(1, cols), b.h ?? PAD_H, 3 * MM);
    } else if (b.kind === 'row') L.row(k, { emoji: b.emoji, icon: b.emoji ? null : b.icon ?? null, label: b.label, sub: b.sub, chevron: !!b.chevron, value: b.value }, b.run ?? (() => {}));
  });
  L.gap(2 * MM);
}

// Every saved Space, each with a trash button: delete it (yours: for everyone)
// or leave it (shared with you). Two taps.
function spaceList(menu, L, d) {
  const list = d.spaces ?? [];
  if (d.merge) L.row('sp-merge', { icon: 'join', label: `Move ${d.merge.things} ${d.merge.things === 1 ? 'thing' : 'things'} into "${d.merge.to}"`, sub: `From "${d.merge.from}" (no tag: phones can't find it). Same spots in the room.`, active: true }, () => menu.p.mergeSpaces());
  if (!list.length) return;
  L.section('sp-list', 'Your spaces', `${list.length}`);
  const pg = paged(menu, 'spaces', list, 5);
  for (const s of pg.slice) {
    const k = `sp-${s.id}`;
    const what = s.owner ? 'Delete' : 'Leave';
    L.row(k, { icon: 'space', label: s.armed ? `Tap the bin again to ${what.toLowerCase()} it` : s.name,
      sub: s.armed ? (s.owner ? 'Removes it and everything in it, for everyone' : 'It stays for the others') : `${s.here ? 'Here · ' : ''}${s.owner ? 'Yours' : 'Shared with you'} · ${s.things} ${s.things === 1 ? 'thing' : 'things'}`,
      reserve: true, danger: s.armed }, () => {});
    const y = L.y - 2.5 * MM - ROW_H / 2;
    L.place({ key: `${k}-rm`, kind: 'icon', x: INNER / 2 - 9 * MM, y, w: 14 * MM, h: 14 * MM, z: 1 * MM, props: { icon: s.owner ? 'trash' : 'exit', label: `${what} ${s.name}`, danger: true }, run: () => menu.p.removeSpace(s.id) });
  }
  pager(menu, L, 'spaces', pg);
}

function appSection(menu, L, a, size = 5) {
  const sec = a.menu;
  const items = sec.items ?? [];
  const key = `am:${a.id}:${size}`;
  L.section(`am-h-${a.id}`, sec.title ?? 'More', items.length > size ? `${items.length}` : '');
  if (!items.length && sec.empty) L.at(0, 8 * MM, { key: 'am-empty', kind: 'text', props: { label: sec.empty } });
  const pg = paged(menu, key, items, size);
  pg.slice.forEach((it, i) => {
    const k = `am-${it.id ?? it.label}`;
    L.row(k, { emoji: it.emoji, icon: it.emoji ? null : it.icon ?? 'next', label: it.label, sub: it.sub, reserve: !!it.remove }, it.run);
    if (it.remove) {
      const y = L.y - 2.5 * MM - ROW_H / 2;
      L.place({ key: `${k}-rm`, kind: 'icon', x: INNER / 2 - 9 * MM, y, w: 14 * MM, h: 14 * MM, z: 1 * MM, props: { icon: 'trash', label: `Remove ${it.label}`, danger: true }, run: it.remove });
    }
  });
  pager(menu, L, key, pg);
  if (sec.add) L.row(`am-add-${a.id}`, { icon: 'plus', label: sec.add.label }, sec.add.run);
}

// One app setting (declared in the manifest) as a row.
function settingRow(menu, L, app, s) {
  const p = menu.p;
  const v = app.values[s.key] ?? s.default;
  const key = `set-${s.key}`;
  if (s.type === 'toggle') return L.row(key, { label: s.label, sub: s.help, toggle: !!v }, () => p.setAppSetting(app.id, s.key, !v));
  if (s.type === 'choice') {
    const opts = s.options;
    const i = Math.max(0, opts.findIndex((o) => o[0] === v));
    return L.row(key, { label: s.label, sub: s.help, value: opts[i]?.[1] ?? String(v) }, () => p.setAppSetting(app.id, s.key, opts[(i + 1) % opts.length][0]));
  }
  if (s.type === 'number') {
    L.row(key, { label: s.label, sub: `${v}${s.unit ?? ''}` });
    const y = L.y - 2.5 * MM - ROW_H / 2;   // − + on the row's right
    L.place({ key: `${key}-minus`, kind: 'icon', x: INNER / 2 - 26 * MM, y, w: 14 * MM, h: 14 * MM, props: { icon: 'minus', label: `${s.label} −` }, run: () => p.setAppSetting(app.id, s.key, Math.max(s.min ?? -Infinity, +(v - (s.step ?? 1)).toFixed(4))) });
    L.place({ key: `${key}-plus`, kind: 'icon', x: INNER / 2 - 8 * MM, y, w: 14 * MM, h: 14 * MM, props: { icon: 'plus', label: `${s.label} +` }, run: () => p.setAppSetting(app.id, s.key, Math.min(s.max ?? Infinity, +(v + (s.step ?? 1)).toFixed(4))) });
    return;
  }
  if (s.type === 'text') return L.row(key, { label: s.label, sub: String(v || s.placeholder || ''), chevron: true }, () => p.editAppText(app.id, s));
}

function wrap(text, n) {
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/)) {
    if ((line + ' ' + word).trim().length > n) { out.push(line.trim()); line = word; } else line += ` ${word}`;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}
