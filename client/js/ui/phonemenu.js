// The phone menu (DESIGN.md §8.4): the Quest menu's pages (same data, same
// actions) as a bottom sheet in the AR overlay. Tabs at the bottom (thumb
// reach), a header with back/title, search where lists get long, and a
// grab handle: drag up for a taller sheet, down to close.
//
//   const menu = new PhoneMenu($('ov-sheet'), $('ov-scrim'), provider);
//   menu.setOpen(true|false) · menu.isOpen · menu.render() (cheap; skips if nothing changed)
//   menu.go(page, params) · menu.back() · menu.tab(name)
//
// Re-rendering never happens under a finger or while a field has focus
// (it's deferred until the touch ends), so taps and typing aren't lost.
import { ICONS } from './kit.js';
import { previewImage } from './preview.js';

const TABS = [['home', 'home', 'Home'], ['apps', 'apps', 'Apps'], ['layers', 'layers', 'Layers'], ['space', 'space', 'Space'], ['settings', 'gear', 'Settings']];
const SEARCH = { apps: 'Search apps', catalog: 'Search items', layers: 'Search layers' };
const HOME_AFTER_MS = 60000;   // reopening after a while starts on Home again

const SVG = 'http://www.w3.org/2000/svg';
const GEAR = 'M12 8.8a3.2 3.2 0 1 0 0.01 0M12 5a7 7 0 1 0 0.01 0' +
  Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return `M${12 + c * 7} ${12 + s * 7}L${12 + c * 9.6} ${12 + s * 9.6}`; }).join('');

export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', name === 'gear' ? GEAR : ICONS[name] ?? ICONS.info);
  svg.append(path);
  return svg;
}

function h(tag, props = {}, ...kids) {
  const { dataset, class: cls, on, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  if (cls) n.className = cls;
  if (dataset) Object.assign(n.dataset, dataset);
  for (const [ev, fn] of Object.entries(on ?? {})) n.addEventListener(ev, fn);
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
}

// App/item badge: an emoji on a tinted rounded square, or a line icon.
function badge({ emoji, icon: ic, color }, size = '') {
  const b = h('span', { class: `badge ${size}` }, emoji ? h('span', { class: 'em', textContent: emoji }) : icon(ic ?? 'info'));
  if (color) b.style.setProperty('--tint', color);
  return b;
}

export class PhoneMenu {
  constructor(root, scrim, provider) {
    this.root = root;
    this.scrim = scrim;
    this.p = provider;
    this.stack = [{ page: 'home' }];
    this.query = {};
    this.filter = {};
    this.isOpen = false;
    this.closedAt = 0;
    this.holding = false;
    this.pending = false;
    this.tall = false;

    this.titleEl = h('div', { class: 'title' });
    this.subEl = h('div', { class: 'sub' });
    this.backBtn = h('button', { class: 'hbtn back', 'aria-label': 'Back', on: { click: () => this.back() } }, icon('back'));
    this.searchInput = h('input', { type: 'search', placeholder: 'Search', autocomplete: 'off', spellcheck: false, enterKeyHint: 'search',
      on: { input: () => { this.query[this.top.page] = this.searchInput.value; this.render(true); }, keydown: (e) => { if (e.key === 'Enter') this.searchInput.blur(); } } });
    this.searchEl = h('label', { class: 'search' }, icon('search'), this.searchInput);
    this.body = h('div', { class: 'body' });
    this.pageEl = h('div', { class: 'page' });
    this.body.append(this.pageEl);
    this.indicator = h('span', { class: 'ind' });
    this.tabsEl = h('nav', { class: 'tabs' }, this.indicator, ...TABS.map(([name, ic, label]) =>
      h('button', { dataset: { tab: name }, 'aria-label': label, on: { click: () => this.tab(name) } }, icon(ic), h('span', { textContent: label }))));
    this.grab = h('div', { class: 'grab', 'aria-hidden': 'true' }, h('i'));
    this.head = h('div', { class: 'head' }, this.backBtn, h('div', { class: 'titles' }, this.titleEl, this.subEl));
    root.replaceChildren(this.grab, this.head, this.searchEl, this.body, this.tabsEl);

    // Hold re-renders while a finger is down on the sheet.
    root.addEventListener('pointerdown', () => { this.holding = true; });
    const up = () => { if (!this.holding) return; this.holding = false; if (this.pending) setTimeout(() => this.render(), 0); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    root.addEventListener('focusout', () => setTimeout(() => { if (this.pending) this.render(); }, 0));
    this.dragging();
  }

  get top() { return this.stack.at(-1); }

  setOpen(open) {
    if (!open) this.closeChooser();
    if (open === this.isOpen) return;
    this.isOpen = open;
    if (open) {
      if (performance.now() - this.closedAt > HOME_AFTER_MS) this.stack = [{ page: 'home' }];
      this.root.getAnimations().forEach((a) => a.cancel());
      this.root.hidden = this.scrim.hidden = false;
      this.root.style.transform = '';
      this.render(true);
      this.root.animate([{ transform: 'translateY(48px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 340, easing: 'cubic-bezier(.2,.95,.3,1.12)' });
      this.scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
    } else {
      this.closedAt = performance.now();
      document.activeElement?.blur?.();
      const from = this.root.style.transform || 'none';
      this.root.animate([{ transform: from, opacity: 1 }, { transform: 'translateY(40px) scale(.98)', opacity: 0 }],
        { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' }).finished.then(() => {
        if (this.isOpen) return;
        this.root.hidden = true;
        this.root.style.transform = '';
        this.setTall(false);
      }, () => {});
      this.scrim.hidden = true;
    }
  }

  setTall(on) {
    this.tall = on;
    this.root.classList.toggle('tall', on);
  }

  // ---- navigation -----------------------------------------------------------------------------

  tab(name) {
    const from = TABS.findIndex(([t]) => t === this.stack[0].page);
    const to = TABS.findIndex(([t]) => t === name);
    if (this.stack.length === 1 && from === to) { this.body.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    this.stack = [{ page: name }];
    this.show(to >= from ? 1 : -1);
  }

  go(page, params = {}) {
    this.stack.push({ page, ...params });
    this.show(1);
  }

  back() {
    if (this.stack.length > 1) this.stack.pop();
    this.show(-1);
  }

  // New page in with a short slide from the side it came from.
  show(dir) {
    this.body.scrollTop = 0;
    this.render(true, true);
    if (!this.isOpen) return;
    const dx = 28 * dir;
    this.pageEl.animate([{ transform: `translateX(${dx}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
    this.head.querySelector('.titles').animate([{ transform: `translateX(${dx / 2}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
  }

  // ---- render ---------------------------------------------------------------------------------

  render(force = false, now = false) {
    const typing = document.activeElement?.matches?.('input, select, textarea') && document.activeElement !== this.searchInput && this.root.contains(document.activeElement);
    if (!now && (this.holding || typing)) {
      this.pending = true;
      return;
    }
    if (!force && !this.isOpen && this.top.page !== 'home') return;   // closed: only Home stays live (its rows are read by tests and hooks)
    this.pending = false;
    const d = this.p.data();
    const top = this.top;
    const root = this.stack[0].page;

    this.backBtn.hidden = this.stack.length < 2;
    setText(this.titleEl, TITLES[top.page]?.(d, top) ?? 'Stratum');
    setText(this.subEl, SUBS[top.page]?.(d, top) ?? '');
    const hint = SEARCH[top.page];
    this.searchEl.hidden = !hint;
    if (hint) {
      this.searchInput.placeholder = hint;
      if (document.activeElement !== this.searchInput) this.searchInput.value = this.query[top.page] ?? '';
    }
    this.tabsEl.querySelectorAll('[data-tab]').forEach((b, i) => {
      const on = b.dataset.tab === root;
      b.classList.toggle('on', on);
      if (on) this.indicator.style.transform = `translateX(${i * 100}%)`;
    });

    // Same markup = same state: keep the old nodes (no flicker, :active stays).
    const fresh = h('div', { class: 'page' }, ...(PAGES[top.page] ?? PAGES.home).call(this, d, top));
    if (fresh.innerHTML !== this.pageEl.innerHTML) this.pageEl.replaceChildren(...fresh.childNodes);
  }

  // ---- place chooser (apps with variants) -------------------------------------------------
  // A card per variant with a rendered preview; picking one arms it (the
  // sheet closes, tap a surface to place). The app asks for details after.
  choose(item) {
    this.closeChooser();
    const close = () => this.closeChooser();
    const cards = item.variants.map((v) => {
      const img = h('div', { class: 'pv' }, h('span', { class: 'em', textContent: v.emoji ?? item.emoji }));
      previewImage(`${item.app}:${v.variant}`, () => this.p.preview(item.app, v.variant)).then((url) => {
        if (url) img.replaceChildren(h('img', { src: url, alt: '' }));
      });
      return h('button', { class: 'vcard', dataset: { variant: v.key }, on: { click: () => { close(); this.p.arm(v.key); } } },
        img, h('span', { class: 't', textContent: v.name }), h('span', { class: 'd', textContent: v.description }));
    });
    this.modalEl = h('div', { id: 'ov-chooser', class: 'ui' },
      h('div', { class: 'scrim', on: { click: close } }),
      h('div', { class: 'box', role: 'dialog', 'aria-label': `Place ${item.name}` },
        h('div', { class: 'top' }, badge({ emoji: item.emoji, color: item.color }), h('div', { class: 'nm' },
          h('span', { class: 't', textContent: `Place ${item.name}` }), h('span', { class: 'sub', textContent: 'Pick one, then tap where it goes' })),
        h('button', { class: 'hbtn', 'aria-label': 'Cancel', on: { click: close } }, icon('close'))),
        h('div', { class: 'cards' }, ...cards)));
    this.root.parentElement.append(this.modalEl);
    this.modalEl.querySelector('.box').animate([{ transform: 'translateY(24px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 300, easing: 'cubic-bezier(.2,.95,.3,1.12)' });
    this.modalEl.querySelector('.scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }

  closeChooser() {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  // Queue a fresh render (after a toggle etc.; the provider's data changed).
  refresh() { setTimeout(() => this.render(true), 0); }

  // ---- drag (grab handle + header) ----------------------------------------------------------

  dragging() {
    let start = null;
    const zone = [this.grab, this.head];
    const down = (e) => {
      if (e.target.closest('button')) return;
      start = { y: e.clientY, t: performance.now(), h: this.root.getBoundingClientRect().height };
      e.currentTarget.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
    };
    const move = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y;
      if (dy > 0) { this.root.style.transform = `translateY(${dy}px)`; this.root.style.height = ''; }
      else { this.root.style.transform = ''; this.root.style.height = `${start.h - dy}px`; }
    };
    const up = (e) => {
      if (!start) return;
      const dy = e.clientY - start.y, v = dy / Math.max(1, performance.now() - start.t);
      start = null;
      this.root.classList.remove('dragging');
      this.root.style.height = '';
      if (dy > 110 || v > 0.6) {
        if (this.tall && dy < 260) { this.setTall(false); this.settle(); return; }
        this.p.close();
        return;
      }
      if (dy < -50 || v < -0.5) this.setTall(true);
      else if (dy > 40) this.setTall(false);
      this.settle();
    };
    for (const z of zone) {
      z.addEventListener('pointerdown', down);
      z.addEventListener('pointermove', move);
      z.addEventListener('pointerup', up);
      z.addEventListener('pointercancel', up);
    }
  }

  settle() {
    const from = this.root.style.transform;
    this.root.style.transform = '';
    if (from) this.root.animate([{ transform: from }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.9,.3,1.1)' });
  }
}

function setText(n, t) { if (n.textContent !== t) n.textContent = t; }

// ---- building blocks ---------------------------------------------------------------------------

function section(title, right) {
  return h('div', { class: 'sect' }, h('span', { textContent: title }), right ?? null);
}

function link(text, run) {
  return h('button', { class: 'link', textContent: text, on: { click: run } });
}

// A list row. Right side: a switch (toggle), a value, or a chevron.
function row({ key, emoji, icon: ic, color, title, sub, toggle, value, chevron, danger, id, run, extra }) {
  const on = toggle === true;
  return h(run ? 'button' : 'div', { class: `rowbtn${on ? ' on' : ''}${danger ? ' danger' : ''}${run ? '' : ' static'}`, id, dataset: key ? { row: key } : undefined, on: run ? { click: run } : undefined },
    (emoji || ic) ? badge({ emoji, icon: ic, color }) : null,
    h('span', { class: 'nm' }, h('span', { class: 't', textContent: title }), sub ? h('span', { class: 'sub', textContent: sub }) : null),
    extra ?? null,
    value != null ? h('span', { class: 'val', textContent: value }) : null,
    toggle != null ? h('span', { class: 'switch' }) : null,
    chevron ? h('span', { class: 'chev' }, icon('next')) : null);
}

function group(...rows) { return h('div', { class: 'group' }, ...rows); }

function tile(it, armed, run, extra = {}) {
  return h('button', { class: `tile${it.key === armed ? ' on' : ''}${extra.dim ? ' dim' : ''}`, dataset: { key: it.key }, on: { click: run } },
    badge({ emoji: it.emoji, icon: it.icon ?? 'place', color: it.color }, 'lg'),
    h('span', { class: 'nm', textContent: it.name }),
    extra.badge ? h('span', { class: `dot ${extra.badge}` }) : null);
}

function chips(list, current, set) {
  return h('div', { class: 'chips' }, ...list.map((c) => h('button', { class: `chip${c === current ? ' on' : ''}`, textContent: c, on: { click: () => set(c) } })));
}

function empty(text) { return h('div', { class: 'empty', textContent: text }); }

const matches = (q, ...fields) => !q || fields.some((f) => String(f ?? '').toLowerCase().includes(q.trim().toLowerCase()));

// ---- pages -------------------------------------------------------------------------------------

const TITLES = {
  home: (d) => d.space?.name ?? 'Stratum',
  apps: () => 'Apps',
  layers: () => 'Layers',
  space: (d) => d.space?.name ?? 'Space',
  settings: () => 'Settings',
  app: (d, p) => d.apps.find((a) => a.id === p.app)?.name ?? 'App',
  catalog: (d, p) => (p.app ? d.apps.find((a) => a.id === p.app)?.name ?? 'Catalog' : 'Place'),
};
const SUBS = {
  home: (d) => (d.armed ? d.status : d.space ? `${d.space.here ? `${d.space.here + 1} people here` : d.space.members.length > 1 ? `Shared with ${d.space.members.length - 1}` : 'Only you'}${d.space.placeShared ? ' · new things shared' : ''}` : d.status),
  apps: (d) => `${d.apps.length} available · ${d.apps.filter((a) => a.enabled).length} on`,
  layers: (d) => `${d.layers.filter((l) => l.visible).length} of ${d.layers.length} visible`,
  space: (d) => (d.space ? `${d.space.members.length} ${d.space.members.length === 1 ? 'member' : 'members'}${d.space.here ? ` · ${d.space.here} here now` : ''}` : 'No saved space here'),
  settings: (d) => (d.user ? `Signed in as ${d.user}` : d.version),
  app: (d, p) => { const a = d.apps.find((x) => x.id === p.app); return a ? [a.category, a.crashed && !a.running ? 'Crashed · restarting' : a.running ? `${a.running} here` : a.enabled ? 'On' : 'Off'].filter(Boolean).join(' · ') : ''; },
  catalog: (d, p) => `${d.placeables.filter((it) => !p.app || it.app === p.app).length} items`,
};

const PAGES = {
  home(d) {
    const p = this.p;
    const arm = (it) => () => p.arm(it.key === d.armed ? null : it.key);
    const ordered = [...d.recent, ...d.places.filter((x) => !d.recent.includes(x))];
    const out = [
      section('Place', link('All', () => this.go('catalog', {}))),
      h('div', { id: 'ov-palette', class: 'strip' }, ...ordered.slice(0, 12).map((it) => tile(it, d.armed, it.chooser ? () => this.choose(it) : arm(it)))),
    ];
    for (const a of d.apps.filter((x) => x.enabled && x.menu?.pin)) out.push(...appMenu(this, a));   // apps' pinned lists
    const ui = d.runningUi ?? [];
    out.push(h('div', { id: 'ov-sheet-apps', hidden: !ui.length }, section('Running here'),
      h('div', { id: 'ov-appbar' }, ...ui.map((r) => h('div', { class: 'approw' },
        h('div', { class: 'ahead', role: 'button', on: { click: () => this.go('app', { app: r.app }) } },
          badge({ emoji: r.icon, color: r.color }), h('span', { class: 'label', textContent: r.status || r.name }), h('span', { class: 'chev' }, icon('next'))),
        r.actions.length ? h('div', { class: 'acts' }, ...r.actions.map((a) => h('button', { textContent: a.label, on: { click: () => p.run(a) } }))) : null)))));
    if (!ui.length) out.push(empty(d.armed ? 'Tap a surface to place it' : 'Pick something above, then tap a surface to place it'));
    if (d.space) {
      out.push(section('Space'), group(row({ key: 'space', icon: 'space', title: d.space.name, sub: d.space.members.length > 1 ? d.space.members.join(', ') : 'Only you so far', chevron: true, run: () => this.tab('space') })));
    }
    return out;
  },

  apps(d) {
    const q = this.query.apps;
    const cats = ['All', 'On', ...[...new Set(d.apps.map((a) => a.category).filter(Boolean))].sort()];
    const f = this.filter.apps ?? 'All';
    const list = d.apps.filter((a) => (f === 'All' || (f === 'On' ? a.enabled : a.category === f)) && matches(q, a.name, a.description, a.category))
      .sort((a, b) => (b.running - a.running) || (b.enabled - a.enabled) || a.name.localeCompare(b.name));
    return [
      chips(cats, f, (c) => { this.filter.apps = c; this.render(true); }),
      list.length ? h('div', { class: 'grid' }, ...list.map((a) => tile({ key: `app:${a.id}`, emoji: a.icon, color: a.color, name: a.name }, null,
        () => this.go('app', { app: a.id }), { badge: a.running ? 'running' : a.enabled ? 'on' : null, dim: !a.enabled }))) : empty(q ? `Nothing matches “${q}”` : 'No apps here'),
    ];
  },

  app(d, params) {
    const p = this.p;
    const a = d.apps.find((x) => x.id === params.app);
    if (!a) return [empty('This app is gone')];
    const out = [
      h('div', { class: 'hero' }, badge({ emoji: a.icon, color: a.color }, 'xl'), h('p', { textContent: a.description ?? '' })),
      ...(a.crashed?.slow && !a.running ? [group(row({ key: 'slow', emoji: '🐢', title: 'Stopped: it slowed everything down', sub: a.crashed.message }),
        row({ key: 'slow-run', icon: 'power', title: 'Run anyway', sub: 'Don\'t slow down or stop it on this device', run: () => { p.allowSlow(a.id); this.refresh(); } }))]
        : a.crashed && !a.running ? [group(row({ key: 'crashed', emoji: '⚠️', title: 'Crashed: stopped, restarting soon', sub: a.crashed.message }))] : []),
      group(row({ key: 'enabled', icon: 'power', title: a.enabled ? 'On' : 'Off', sub: a.enabled ? 'Shows and runs in your spaces' : 'Hidden and stopped', toggle: a.enabled,
        run: () => { p.toggleApp(a.id); this.refresh(); } })),
    ];
    if (a.enabled) {
      if (a.panel) out.push(...appPanel(this, a));   // the app's own UI (ctx.panel)
      if (a.menu) out.push(...appMenu(this, a));   // the app's own list (ctx.menu), e.g. saved hosts: first, it's what the app is about
      const items = d.placeables.filter((it) => it.app === a.id);
      if (items.length) {
        out.push(section('Place', items.length > 6 ? link(`All ${items.length}`, () => this.go('catalog', { app: a.id })) : null),
          h('div', { class: 'grid' }, ...items.slice(0, 6).map((it) => tile(it, d.armed, () => p.arm(it.key === d.armed ? null : it.key)))));
      }
      if (a.instances.length) {
        out.push(section('Here', h('span', { class: 'count', textContent: a.instances.length })),
          group(...a.instances.map((inst, i) => row({ key: `inst-${inst.id}`, emoji: a.icon, color: a.color, title: inst.label ?? `${a.name} ${i + 1}`, sub: inst.status || 'Tap to select', chevron: true,
            run: () => { p.selectObject(inst.id); p.close(); } }))));
      }
      if (a.actions.length && !a.panel) {
        out.push(section('Actions'), h('div', { class: 'acts wide' }, ...a.actions.map((x) => h('button', { textContent: x.label, on: { click: () => { p.run(x); this.refresh(); } } }))));
      }
      if (a.settings.length) out.push(section('Settings'), group(...a.settings.map((s) => settingRow(this, a, s))));
    } else {
      out.push(empty('Turn it on to place it and see it in your spaces.'));
    }
    out.push(section('About'), h('p', { class: 'about dim', textContent: [a.category, a.permissions.length ? `Uses ${a.permissions.join(', ')}` : 'No special permissions'].filter(Boolean).join(' · ') }));
    return out;
  },

  catalog(d, params) {
    const p = this.p;
    const q = this.query.catalog;
    const key = params.app ?? '*';
    const all = params.app ? d.placeables.filter((it) => it.app === params.app) : d.places;
    const cats = ['All', ...new Set(all.map((it) => it.category).filter(Boolean))];
    const f = this.filter[`cat:${key}`] ?? 'All';
    const list = all.filter((it) => (f === 'All' || it.category === f) && matches(q, it.name, it.category));
    return [
      cats.length > 2 ? chips(cats, f, (c) => { this.filter[`cat:${key}`] = c; this.render(true); }) : null,
      list.length ? h('div', { class: 'grid' }, ...list.map((it) => tile(it, d.armed, it.chooser ? () => this.choose(it) : () => p.arm(it.key === d.armed ? null : it.key)))) : empty(q ? `Nothing matches “${q}”` : 'Nothing to place yet'),
    ].filter(Boolean);
  },

  layers(d) {
    const p = this.p;
    const q = this.query.layers;
    const out = [];
    // Revelio (DESIGN.md §8.7): show what's hidden (tap a glow to bring it back), choose which layers it shows, undo shoos.
    const hid = d.hidden ?? { here: 0, shooed: 0 }, mode = !!this.revealMode;
    out.push(group(
      row({ key: 'revelio', emoji: '✨', title: 'Reveal hidden things', sub: hid.here ? `${hid.here} hidden here · tap a glow to show it` : 'Nothing hidden here', run: () => { p.castRevelio(); p.close?.(); } }),
      row({ key: 'reveal-mode', icon: 'layers', title: 'Choose what Revelio shows', toggle: mode, run: () => { this.revealMode = !mode; this.refresh(); } }),
      hid.shooed ? row({ key: 'shooed', icon: 'eye', title: `Show ${hid.shooed} shooed ${hid.shooed === 1 ? 'thing' : 'things'}`, run: () => { p.showShooed(); this.refresh(); } }) : null,
    ));
    for (const [g, label] of [['space', 'Spaces'], ['personal', 'Mine'], ['app', 'Apps'], ['public', 'Public']]) {
      const ls = d.layers.filter((l) => l.group === g && matches(q, l.name));
      if (!ls.length) continue;
      out.push(section(label), group(...ls.map((l) => mode
        ? row({ key: `layer-${l.id}`, emoji: l.emoji, icon: l.emoji ? null : 'layers', title: l.name, sub: l.revealable ? 'Revelio can show it' : 'Revelio skips it',
          toggle: l.revealable, run: () => { p.setRevealable(l.id, !l.revealable); this.refresh(); } })
        : row({ key: `layer-${l.id}`, emoji: l.emoji, icon: l.emoji ? null : 'layers', title: l.name,
          sub: `${l.count} ${l.count === 1 ? 'thing' : 'things'}`, toggle: l.visible, run: () => { p.setLayerVisible(l.id, !l.visible); this.refresh(); } }))));
    }
    if (!out.length) out.push(empty(q ? `Nothing matches “${q}”` : 'No layers yet'));
    if (d.layers.some((l) => !l.visible)) out.push(group(row({ key: 'show-all', icon: 'eye', title: 'Show everything', run: () => { p.showAllLayers(); this.refresh(); } })));
    return out;
  },

  space(d) {
    const p = this.p;
    const s = d.space;
    const join = row({ key: 'join', icon: 'join', title: 'Join with a code', chevron: true, run: () => p.join() });
    if (!s) return [empty('Look at a printed tag to open its space, or tap a surface to start a temporary one.'), group(join), ...spaceList(this, d)];
    const invite = h('button', { class: 'rowbtn', id: 'ov-invite', dataset: { row: 'invite' }, on: { click: () => p.invite() } },
      badge({ icon: 'mail' }),
      h('span', { class: 'nm' }, h('span', { class: 't' }, s.inviteCode ? ['Invite code ', h('b', { class: 'code', textContent: s.inviteCode })] : 'Invite someone'),
        h('span', { class: 'sub', textContent: s.inviteCode ? 'Valid 24 h · link copied' : 'Get a code to share' })));
    return [
      section('People'),
      group(
        row({ key: 'members', icon: 'people', title: s.members.length > 1 ? s.members.join(', ') : 'Only you so far', sub: s.here ? `${s.here} here now` : 'Members' }),
        invite,
        row({ key: 'share-new', icon: 'people', title: 'Share new things', sub: 'Everyone in this space sees what you place', toggle: s.placeShared, run: () => { p.setPlaceShared(!s.placeShared); this.refresh(); } }),
        join),
      section('Room map', h('span', { class: 'count', textContent: s.mapSummary || 'Builds itself as you look around' })),
      group(
        row({ key: 'show-map', icon: 'layers', title: 'Show the map', toggle: s.showMap, run: () => { p.setShowMap(!s.showMap); this.refresh(); } }),
        row({ key: 'clear-map', icon: 'trash', title: s.resetArmed ? 'Tap again to reset' : "Reset this room's map", sub: 'For everyone in this space', danger: true, run: () => { p.clearMap(); this.refresh(); } })),
      ...spaceList(this, d),
    ];
  },

  settings(d) {
    const p = this.p;
    const s = d.settings;
    return [
      group(
        row({ key: 'occlusion', icon: 'half', title: 'Occlusion', sub: s.occlusionNote, toggle: s.occlusion, run: () => { p.setSetting('occlusion', !s.occlusion); this.refresh(); } }),
        row({ key: 'room-light', icon: 'sun', title: "Match the room's light", sub: s.roomLightNote, toggle: s.roomLight, run: () => { p.setSetting('roomLight', !s.roomLight); this.refresh(); } }),
        row({ key: 'steady', icon: 'sliders', title: 'Hold spaces still', sub: 'For sitting: only move a space if it is clearly off', toggle: s.steady, run: () => { p.setSetting('steady', !s.steady); this.refresh(); } }),
        row({ key: 'fps-hud', icon: 'eye', title: 'FPS meter', sub: 'Always in view: frame rate and what each app costs', toggle: s.fpsHud, run: () => { p.setSetting('fpsHud', !s.fpsHud); this.refresh(); } }),
        row({ key: 'map-on', icon: 'map', title: 'Map the room', sub: s.mapNote, toggle: s.map, run: () => { p.setSetting('map', !s.map); this.refresh(); } }),
        row({ key: 'show-map2', icon: 'layers', title: 'Show the map', sub: 'Surfaces and what the map sees as solid', toggle: s.showMap, run: () => { p.setShowMap(!s.showMap); this.refresh(); } })),
      group(row({ key: 'exit', icon: 'exit', title: 'Exit AR', danger: true, run: () => p.exit() })),
      h('p', { class: 'about dim center', textContent: `Stratum ${d.version}` }),
    ];
  },
};

// One app setting (manifest schema) with a native-feeling control.
function settingRow(menu, a, s) {
  const p = menu.p;
  const v = a.values[s.key] ?? s.default;
  const save = (x) => { p.setAppSetting(a.id, s.key, x); menu.refresh(); };
  const key = `set-${s.key}`;
  if (s.type === 'toggle') return row({ key, title: s.label, sub: s.help, toggle: !!v, run: () => save(!v) });
  let control;
  if (s.type === 'choice' && s.options.length <= 4) {
    control = h('div', { class: 'seg' }, ...s.options.map(([ov, label]) => h('button', { class: ov === v ? 'on' : '', textContent: label, on: { click: () => save(ov) } })));
  } else if (s.type === 'choice') {
    control = h('select', { on: { change: (e) => save(s.options[e.target.selectedIndex][0]) } }, ...s.options.map(([ov, label]) => h('option', { textContent: label, selected: ov === v })));
  } else if (s.type === 'number') {
    const step = s.step ?? 1;
    control = h('div', { class: 'stepper' },
      h('button', { 'aria-label': `${s.label} −`, on: { click: () => save(Math.max(s.min ?? -Infinity, +(v - step).toFixed(4))) } }, icon('minus')),
      h('span', { textContent: `${v}${s.unit ?? ''}` }),
      h('button', { 'aria-label': `${s.label} +`, on: { click: () => save(Math.min(s.max ?? Infinity, +(v + step).toFixed(4))) } }, icon('plus')));
  } else {
    control = h('input', { type: 'text', value: v ?? '', placeholder: s.placeholder ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'done',
      on: { change: (e) => save(e.target.value), keydown: (e) => { if (e.key === 'Enter') e.target.blur(); }, focus: (e) => setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300) } });
  }
  return h('div', { class: `setting ${s.type}`, dataset: { row: key } },
    h('span', { class: 'nm' }, h('span', { class: 't', textContent: s.label }), s.help ? h('span', { class: 'sub', textContent: s.help }) : null), control);
}

// An app's own section (ctx.menu): its rows (trash button optional) and an "add" row.
// Every saved Space: tap to delete it (yours: for everyone) or leave it; two taps.
function spaceList(menu, d) {
  const list = d.spaces ?? [];
  const merge = d.merge ? [group(row({ key: 'sp-merge', icon: 'join', title: `Move ${d.merge.things} ${d.merge.things === 1 ? 'thing' : 'things'} into "${d.merge.to}"`,
    sub: `From "${d.merge.from}" (no tag: phones can't find it). Same spots in the room.`, run: () => { menu.p.mergeSpaces(); menu.refresh(); } }))] : [];
  if (!list.length) return merge;
  return [...merge, section('Your spaces', h('span', { class: 'count', textContent: list.length })),
    group(...list.map((s) => row({ key: `sp-${s.id}`, icon: s.owner ? 'trash' : 'exit', danger: true,
      title: s.armed ? `Tap again to ${s.owner ? 'delete' : 'leave'} "${s.name}"` : `${s.owner ? 'Delete' : 'Leave'} "${s.name}"`,
      sub: s.armed ? (s.owner ? 'Removes it and everything in it, for everyone' : 'It stays for the others') : `${s.here ? 'Here · ' : ''}${s.owner ? 'Yours' : 'Shared with you'} · ${s.things} ${s.things === 1 ? 'thing' : 'things'}`,
      run: () => { menu.p.removeSpace(s.id); menu.refresh(); } })))];
}

// An app's own UI (ctx.panel; blocks as in ui/menu.js appPanel).
function appPanel(menu, a) {
  const sp = a.panel, out = [];
  const go = (fn) => () => { fn?.(); menu.refresh(); };
  const btn = (it, i) => h('button', { class: `${it.on ? 'on' : ''}${it.tone ? ` ${it.tone}` : ''}`, disabled: !!it.disabled, dataset: { pad: `${i}` },
    textContent: [it.emoji, it.label].filter(Boolean).join(' ') || (it.icon === 'plus' ? '+' : it.icon === 'minus' ? '−' : '•'), on: { click: go(it.run) } });
  if (sp.title || sp.sub) out.push(section(sp.title ?? '', sp.sub ? h('span', { class: 'count', textContent: sp.sub }) : null));
  for (const b of sp.blocks ?? []) {
    if (b.kind === 'section') out.push(section(b.label ?? ''));
    else if (b.kind === 'text') out.push(h('p', { class: 'about', textContent: b.text ?? '' }));
    else if (b.kind === 'buttons') out.push(h('div', { class: 'acts wide pads' }, ...(b.items ?? []).map(btn)));
    else if (b.kind === 'stepper') out.push(group(row({ key: `st-${b.label}`, title: b.label ?? '', value: String(b.value ?? ''),
      extra: h('span', { class: 'steps' }, btn({ icon: 'minus', run: b.dec, disabled: !b.dec }, 0), btn({ icon: 'plus', run: b.inc, disabled: !b.inc }, 1)) })));
    else if (b.kind === 'toggle') out.push(group(row({ key: `tg-${b.label}`, title: b.label, sub: b.sub, toggle: !!b.on, run: go(b.run) })));
    else if (b.kind === 'choice') {
      if (b.label) out.push(section(b.label));
      out.push(h('div', { class: 'acts wide pads' }, ...(b.options ?? []).map((o, i) => btn({ label: o.label, emoji: o.emoji, on: o.id === b.value, run: () => b.pick?.(o.id) }, i))));
    } else if (b.kind === 'row') out.push(group(row({ key: `rw-${b.label}`, emoji: b.emoji, title: b.label, sub: b.sub, value: b.value, chevron: !!b.chevron, run: b.run ? go(b.run) : undefined })));
  }
  return out;
}

function appMenu(menu, a) {
  const p = menu.p, sec = a.menu, items = sec.items ?? [];
  return [section(sec.title ?? 'More', items.length > 5 ? h('span', { class: 'count', textContent: items.length }) : null),
    group(
      ...items.map((it) => row({ key: `am-${it.id ?? it.label}`, emoji: it.emoji, icon: it.emoji ? null : it.icon ?? 'next', title: it.label, sub: it.sub,
        run: () => { p.run(it); p.close(); },
        extra: it.remove ? h('span', { class: 'rm', role: 'button', 'aria-label': `Remove ${it.label}`, dataset: { rm: it.id ?? it.label },
          on: { click: (e) => { e.stopPropagation(); p.run({ run: it.remove }); menu.refresh(); } } }, icon('trash')) : null })),
      !items.length && sec.empty ? h('div', { class: 'empty', textContent: sec.empty }) : null,
      sec.add ? row({ key: `am-add-${a.id}`, icon: 'plus', title: sec.add.label, run: () => p.run(sec.add) }) : null)];
}
