"""The browser app's tests need its container (real Chrome): without Docker they skip."""
import pytest


@pytest.fixture(autouse=True)
def _needs_browser_backend(request):
    if "app_backends" in request.fixturenames or "live_server" in request.fixturenames:
        backends = request.getfixturevalue("app_backends")
        if "browser" not in backends["apps"]:
            pytest.skip("browser backend needs Docker")


@pytest.fixture(autouse=True)
def _live_browser(request):
    """These tests are about the live Chrome: the client's demo mode (still pictures) off."""
    if "page" in request.fixturenames and not request.node.get_closest_marker("demo"):
        request.getfixturevalue("page").add_init_script("window.__browserLive = true")
