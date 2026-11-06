"""Real-world lighting: where the browser estimates the room's light
(WebXR light-estimation, faked here), virtual things are lit by it; when
estimates stop, or the switch is off, or the device can't, standard lights."""
from playwright.sync_api import Page

from test_main import login, open_ar, TAG_A
from test_quest import open_quest

FAKE = """window.__emulateHooks = { onSession(session) {
  session.requestLightProbe = async () => ({ probeSpace: null });
  window.__light = { on: true, dir: { x: -0.8, y: 0.6, z: 0 }, rgb: { x: 3.0, y: 2.4, z: 1.5 } };
  window.XRFrame.prototype.getLightEstimate = function () {
    const l = window.__light; if (!l.on) return null;
    const sh = new Float32Array(27); sh[0] = 0.9; sh[1] = 0.8; sh[2] = 0.6;
    return { primaryLightDirection: l.dir, primaryLightIntensity: l.rgb, sphericalHarmonicsCoefficients: sh };
  };
} };"""
L = "window.__app.lighting"


def test_lit_like_the_room_then_falls_back(page: Page, live_server):
    login(page, live_server)
    page.add_init_script(FAKE)
    open_ar(page, live_server, [TAG_A])
    page.wait_for_function(f"{L}.mode === 'room'", timeout=5000)
    assert page.evaluate(f"{L}.fallback.every(l => !l.visible)")                  # standard lights off
    page.wait_for_timeout(1500)                                                    # (smoothed)
    d = page.evaluate(f"{L}.sun.position.clone().normalize().toArray()")
    assert d[0] < -0.7 and d[1] > 0.5, d                                           # light from where the room's comes from
    c = page.evaluate(f"{L}.sun.color.toArray()")
    assert c[0] > c[2] + 0.3, c                                                    # warm, like the room
    assert page.evaluate(f"{L}.sun.intensity") > 2.5
    assert page.evaluate(f"{L}.probe.sh.coefficients[0].x") > 0.8                 # ambient from the estimate
    assert "lit like your room" in page.evaluate("window.__app.menuData().settings.roomLightNote")
    # Estimates stop: back to the standard lights.
    page.evaluate("window.__light.on = false")
    page.wait_for_function(f"{L}.mode === 'standard' && {L}.fallback.every(l => l.visible)", timeout=4000)
    # They come back: room light again. The switch turns it off.
    page.evaluate("window.__light.on = true")
    page.wait_for_function(f"{L}.mode === 'room'", timeout=3000)
    page.evaluate("window.__app.questMenu?.(); window.__app.phoneMenu()?.p?.setSetting('roomLight', false)")
    page.wait_for_function(f"{L}.mode === 'standard'", timeout=2000)
    assert page.evaluate("localStorage.getItem('stratum.roomLight')") == "0"


def test_standard_lights_where_not_supported(page: Page, live_server):
    login(page, live_server)
    open_quest(page, live_server)
    page.wait_for_function(f"{L}.note !== ''", timeout=5000)
    assert page.evaluate(f"{L}.mode") == "standard"
    assert page.evaluate(f"{L}.fallback.every(l => l.visible)")
    assert "standard lighting" in page.evaluate(f"{L}.note")
