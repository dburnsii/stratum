"""Wall & Desk widgets (apps/notes/client/widgets.js): clocks, calendars, a
thermometer and the weather. Open-Meteo is answered by the test (no internet)."""
import json
from pathlib import Path

from playwright.sync_api import Page

from test_apps_e2e import enable
from test_main import TAG_A, create_space, login, open_ar
from test_turntable import put

SHOTS = Path(__file__).resolve().parents[3] / "test-results"
FORECAST = {"current": {"temperature_2m": 68.4, "apparent_temperature": 66.1, "weather_code": 2, "is_day": 1, "relative_humidity_2m": 50, "wind_speed_10m": 6},
            "daily": {"time": ["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"], "weather_code": [2, 0, 3, 61, 1, 0],
                      "temperature_2m_max": [71, 74, 66, 58, 63, 69], "temperature_2m_min": [52, 55, 50, 46, 44, 50], "precipitation_probability_max": [10, 0, 20, 80, 10, 0]}}
PLACE = {"results": [{"name": "Pittsburgh", "admin1": "Pennsylvania", "latitude": 40.44, "longitude": -79.99}]}


def start(page: Page, live_server):
    seen = []

    def weather(route):
        seen.append(route.request.url)
        body = PLACE if "geocoding" in route.request.url else FORECAST
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body), headers={"access-control-allow-origin": "*"})
    page.route("**/*open-meteo.com/**", weather)
    login(page, live_server)
    enable(page, live_server, "notes")
    open_ar(page, live_server, [TAG_A])
    create_space(page)
    page.evaluate("window.__app.runtime.load()")
    return seen


def widget(page, kind, x=0.0, config=None):
    oid = put(page, x, -0.6, {"app": {"app": "notes", "config": {"kind": kind, **(config or {})}}})
    page.wait_for_function(f"[...(window.__notes ?? [])].some(c => c.instance.id === '{oid}' && c.widget)", timeout=10000)
    return oid, f"[...window.__notes].find(c => c.instance.id === '{oid}')"


def test_wall_clock_hands_tell_the_time_and_the_zone_changes(page: Page, live_server):
    start(page, live_server)
    _, c = widget(page, "clock")
    r = page.evaluate(f"""(() => {{ const ctx = {c}, now = ctx.now(), g = ctx.widget.group;
      const hands = g.children.filter(o => o.isMesh && o.geometry.type === 'BoxGeometry');
      const p = new Intl.DateTimeFormat('en-US', {{ hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }}).formatToParts(new Date(now));
      const h = +p.find(x => x.type === 'hour').value, m = +p.find(x => x.type === 'minute').value;
      return {{ hour: -hands[0].rotation.z / (2 * Math.PI) * 12, want: (h % 12) + m / 60 }}; }})()""")
    assert abs(r["hour"] - r["want"]) < 0.05, r
    acts = page.evaluate(f"{c}.widget && window.__app.runtime.uiState().find(u => u.instance === {c}.instance.id).actions.map(a => a.label)")
    assert acts[0].startswith("🌍")
    page.evaluate(f"window.__app.runtime.uiState().find(u => u.instance === {c}.instance.id).actions[0].run()")   # → New York
    page.wait_for_function(f"{c}.widgetCfg.tz === 'America/New_York'", timeout=3000)
    page.wait_for_function(f"(() => {{ const c = {c}; return window.__app.world.objects.get(c.instance.id).data.components.app.config.tz === 'America/New_York'; }})()", timeout=3000)   # shared


def test_desk_and_day_calendar_show_today(page: Page, live_server):
    start(page, live_server)
    _, d = widget(page, "digital")
    _, t = widget(page, "today", 0.3)
    page.wait_for_timeout(1200)
    want = page.evaluate("new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'long', day: 'numeric' }).format(new Date())")
    st = page.evaluate(f"{t}.widget.status({t}.now())")
    assert st.split(" ")[0] == want.split(",")[0]
    assert ":" in page.evaluate(f"{d}.widget.status({d}.now())")


def test_calendar_days_take_notes(page: Page, live_server):
    start(page, live_server)
    oid, c = widget(page, "calendar")
    page.evaluate("window.__app.runtime.prompt = async () => 'Dentist'")
    # The 15th: the grid knows where each day is; tap its cell.
    page.evaluate(f"""async () => {{ const THREE = await import('three'); const ctx = {c}, w = ctx.widget;
      const now = ctx.now(); w.update(now);
      const mod = [...window.__app.runtime.running.values()].find(i => i.id === ctx.instance.id).module;
      const cv = w.face.material.map.image, d = new Date(now), first = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
      const W = cv.width, H = cv.height, top = H * 0.34, cw = W / 7, ch = (H - top - H * 0.02) / 7, cell = first + 14;
      const x = cw * ((cell % 7) + 0.5), y = top + ch * 0.8 + ch * (Math.floor(cell / 7) + 0.5);
      mod.select(ctx, {{ object: w.face, uv: new THREE.Vector2(x / W, 1 - y / H), point: new THREE.Vector3() }}); }}""")
    page.wait_for_function(f"Object.values(window.__app.world.objects.get('{oid}').data.components.app.config.days ?? {{}}).includes('Dentist')", timeout=5000)
    day = page.evaluate(f"Object.keys(window.__app.world.objects.get('{oid}').data.components.app.config.days)[0]")
    assert day.endswith("-15"), day


def test_thermometer_and_weather_after_choosing_the_place(page: Page, live_server):
    seen = start(page, live_server)
    _, th = widget(page, "thermometer")
    _, we = widget(page, "weather", 0.4)
    page.evaluate("window.__app.runtime.prompt = async () => 'Pittsburgh'")
    page.evaluate(f"[...window.__app.runtime.running.values()].find(i => i.id === {th}.instance.id).module.select({th}, {{ object: {th}.widget.face, uv: null }})")
    page.wait_for_function(f"{th}.widgetCfg.place?.name === 'Pittsburgh'", timeout=5000)
    page.wait_for_function(f"{th}.widget.reading() === 68.4", timeout=5000)
    page.wait_for_timeout(1500)                                              # the liquid creeps up
    assert page.evaluate(f"{th}.widget.status()") == "68° outside · Pittsburgh"
    # The weather panel: its own place (tap → Pittsburgh), the same request shared.
    page.evaluate(f"[...window.__app.runtime.running.values()].find(i => i.id === {we}.instance.id).module.select({we}, {{ object: {we}.widget.face, uv: null }})")
    page.wait_for_function(f"{we}.widget.data()?.daily", timeout=5000)
    assert page.evaluate(f"{we}.widget.status()") == "🌤️ 68° Pittsburgh"
    forecast = [u for u in seen if "forecast" in u]
    assert forecast and "temperature_unit=fahrenheit" in forecast[0] and "latitude=40.44" in forecast[0]
    assert len(forecast) == 1                                                # cached: one request for both


def test_widget_previews_in_the_chooser(page: Page, live_server):
    start(page, live_server)
    page.click("#ov-fab")
    page.click("#ov-sheet .sect .link:has-text('All')")
    page.click("#ov-sheet .tile[data-key='choose:notes']")
    page.wait_for_function("document.querySelectorAll('#ov-chooser .vcard .pv img').length === 9", timeout=10000)
    page.evaluate("document.querySelector('#ov-chooser .vcard:last-child').scrollIntoView()")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / "notes-chooser-widgets.png"))
