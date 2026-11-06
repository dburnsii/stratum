"""App panels (ctx.panel): an app's own UI on its page in the hand menu, with
full-size controls (big buttons, steppers, choices), not tiny chips."""
from playwright.sync_api import Page

from test_main import login
from test_quest import open_quest

MENU = "window.__app.questMenu()"
FAKE = """() => { const rt = window.__app.runtime, ui = rt.uiState.bind(rt); window.__hits = [];
  const hit = (x) => () => window.__hits.push(x);
  const panel = { title: 'Set the ceiling', sub: '2 corners', blocks: [
    { kind: 'text', text: 'Pinch each corner.' },
    { kind: 'stepper', label: 'Ceiling height', value: '240 cm', dec: hit('dec'), inc: hit('inc') },
    { kind: 'buttons', items: [{ label: 'Undo', icon: 'back', run: hit('undo') }, { label: 'Done', icon: 'check', tone: 'go', run: hit('done') }, { label: 'Cancel', icon: 'close', tone: 'danger', run: hit('cancel') }] },
    { kind: 'choice', label: 'Theme', value: 'b', cols: 2, options: [{ id: 'a', label: 'Stars', emoji: '🌌' }, { id: 'b', label: 'Jungle', emoji: '🌴' }], pick: (id) => window.__hits.push('pick:' + id) },
  ] };
  const sky = rt.apps.get('sky'); sky.enabled = true;
  rt.uiState = () => [...ui(), { app: sky, status: '', actions: [{ label: 'tiny', run: hit('tiny') }], instance: 'fake', menu: null, panel }]; }"""


def test_an_app_panel_draws_full_size_controls_in_the_hand_menu(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.evaluate(FAKE)
    page.evaluate(f"{MENU}.toggle(true); {MENU}.go('apps'); {MENU}.go('app', {{ app: 'sky' }})")
    page.wait_for_function(f"{MENU}.find('Done') && {MENU}.find('Jungle')", timeout=5000)
    done = page.evaluate(f"(() => {{ const w = {MENU}.find('Done'); return {{ kind: w.kind ?? w.spec?.kind, w: w.w, h: w.h }}; }})()")
    assert done["h"] >= 0.02 and done["w"] >= 0.05, done                          # ≥ 2 cm tall, ≥ 5 cm wide (chips are 1.1 cm)
    assert not page.evaluate(f"{MENU}.find('tiny')")                             # (its little action chips give way to the panel)
    for label, want in [("Done", "done"), ("Undo", "undo"), ("Jungle", "pick:b"), ("Stars", "pick:a")]:
        page.evaluate(f"{MENU}.find('{label}').run()")
        assert page.evaluate("window.__hits.at(-1)") == want, label
    assert page.evaluate(f"[...{MENU}.page.widgets.values()].some(w => w.props?.label === '240 cm')")   # the stepper's value
    for key, want in [("ap-sky-1-dec", "dec"), ("ap-sky-1-inc", "inc")]:            # and its − / +
        page.evaluate(f"{MENU}.find('{key}').run()")
        assert page.evaluate("window.__hits.at(-1)") == want, key
