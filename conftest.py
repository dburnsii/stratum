"""Shared fixtures.

- `live_server`: the real server.py as a subprocess (plain HTTP on localhost,
  which browsers treat as a secure context), with a throwaway database.
- Browser launch args: software WebGL (headless has no GPU) and a fake camera
  that auto-grants permission, so the camera probe path runs too.
"""
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT / "tests"))   # shared helpers (test_main, test_apps_e2e, …) for apps/*/tests too


def free_port():
    """A port for a test server, below the kernel's ephemeral range
    (32768+): outgoing connections draw from that range, and when something
    churns through it (seen: a monitoring agent hammering a local nginx, ~470
    connections/s) a port that was free a moment ago gets taken."""
    import random
    for _ in range(500):
        port = random.randint(20000, 32000)
        try:
            with socket.socket() as t:
                t.bind(("0.0.0.0", port))
            return port
        except OSError:
            continue
    raise RuntimeError("no free port")


@pytest.fixture(scope="session")
def telemetry_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("telemetry")


def wait_port(proc, port, what):
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.2).close()
            return
        except OSError:
            if proc.poll() is not None:
                raise RuntimeError(f"{what} died:\n" + proc.stdout.read().decode())
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError(f"{what} did not start")


def stop(proc):
    proc.terminate()
    try:
        proc.wait(8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(5)


APP_SECRETS = {"golf": "test-golf-secret", "fishtank": "test-fish-secret", "browser": "test-browser-secret", "plants": "test-plants-secret",
               "home": "test-home-secret", "ssh": "test-ssh-secret"}

TEST_PAGE = """<!doctype html><title>Test Home</title>
<body style="margin:0;font:40px sans-serif">
<button id="b" style="position:fixed;left:0;top:0;width:100%;height:50%;font-size:60px"
        onclick="document.title='Clicked'">Click me</button>
<div style="height:6000px;background:linear-gradient(#fff,#08f)"></div>
<script>addEventListener('scroll', () => { document.title = 'Scrolled ' + Math.round(scrollY); });</script>"""


# Top half: a search field (title echoes it; Enter submits and leaves the field). Bottom: plain page.
FORM_PAGE = """<!doctype html><title>Form</title><body style="margin:0;font:40px sans-serif">
<form onsubmit="event.preventDefault(); document.title = 'Sent:' + q.value; q.blur();">
<input id="q" type="search" placeholder="Search the site" oninput="document.title = 'Q:' + this.value"
       style="position:fixed;left:0;top:0;width:100%;height:50%;font-size:60px;box-sizing:border-box"></form>
<div style="position:fixed;left:0;top:50%;width:100%;height:50%;background:#ddd">plain</div>"""


# For the browser app: pop-ups, new tabs, what pages can see, sound.
EXTRA_PAGES = {
    "links.html": """<title>Links</title><body style="margin:0;font:40px sans-serif">
<button id="pop" style="position:fixed;left:0;top:0;width:50%;height:50%" onclick="window.open('two.html', 'p', 'width=500,height=600')">pop-up</button>
<a id="tab" href="two.html" target="_blank" style="position:fixed;left:50%;top:0;width:50%;height:50%;display:block">new tab</a>""",
    "fp.html": "<title>fp</title><script>document.title = 'webdriver=' + navigator.webdriver + ' tz=' + Intl.DateTimeFormat().resolvedOptions().timeZone + ' screen=' + screen.width</script>",
    "tone.html": """<title>Tone</title><button style="position:fixed;inset:0;width:100%;height:100%"
onclick="const a = new AudioContext(), o = a.createOscillator(); o.connect(a.destination); o.start(); document.title = 'Playing'">play</button>""",
}


def docker_ok():
    import shutil
    return bool(shutil.which("docker")) and subprocess.run(["docker", "info"], capture_output=True).returncode == 0


def browser_container(port, data, env):
    """The browser app's backend is real Chrome on a virtual display: test the
    container itself (built from apps/browser/backend; cached after the first
    build). Host networking, so it reaches the test site and we reach it."""
    import os
    image = "stratum-browser:test"
    subprocess.run(["docker", "build", "-q", "-t", image, "--build-context", f"sdk={ROOT / 'sdk'}", str(ROOT / "apps" / "browser" / "backend")],
                   check=True, capture_output=True)
    data.mkdir(parents=True, exist_ok=True)
    name = f"stratum-browser-test-{port}"
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    args = ["docker", "run", "--rm", "--name", name, "--network", "host", "--shm-size", "2g", "-u", f"{os.getuid()}:{os.getgid()}",
            "-v", f"{data}:/data", "-e", f"PORT={port}", "-e", "HOME=/tmp", "-e", "TZ=America/New_York"]
    for k, v in env.items():
        args += ["-e", f"{k}={v}"]
    proc = subprocess.Popen([*args, image], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    proc.container = name
    return proc


@pytest.fixture(scope="session")
def test_site(tmp_path_factory):
    """A tiny local website for the remote browser to load (no internet)."""
    root = tmp_path_factory.mktemp("site")
    (root / "index.html").write_text(TEST_PAGE)
    (root / "two.html").write_text("<title>Page Two</title><h1>two</h1>")
    (root / "form.html").write_text(FORM_PAGE)
    for name, html in EXTRA_PAGES.items():
        (root / name).write_text(html)
    port = free_port()
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=root,
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    wait_port(proc, port, "test site")
    yield f"http://127.0.0.1:{port}"
    proc.terminate()


@pytest.fixture(scope="session")
def app_backends(tmp_path_factory, test_site):
    """The bundled apps' real backends (those installed). Yields {app: (port, env_for_stratum)}
    and a setter for the Stratum URL they broadcast to."""
    import os
    stratum_port = free_port()
    procs, out = [], {}
    data = tmp_path_factory.mktemp("appdata")
    ha_port, sshd_port = free_port(), free_port()
    authorized = data / "authorized_keys"
    # Stand-ins for what some apps talk to: Home Assistant (home), an SSH server (ssh).
    for script, port, extra, what in [
            (ROOT / "apps" / "home" / "tests" / "fake_ha.py", ha_port, [], "fake home assistant"),
            (ROOT / "apps" / "ssh" / "tests" / "fake_sshd.py", sshd_port,
             ["--authorized", str(authorized), "--hostkey", str(data / "sshd_host_key")], "fake sshd")]:
        if script.exists():
            proc = subprocess.Popen([sys.executable, str(script), "--port", str(port), *extra],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            procs.append(proc)
            wait_port(proc, port, what)
    for app_id, args in [("golf", ["--db", str(data / "golf.db")]),
                         ("fishtank", ["--state", str(data / "fish.json")]),
                         ("browser", ["--data", str(data / "browser")]),
                         ("plants", ["--state", str(data / "plants.json")]),
                         ("home", []),
                         ("ssh", ["--data", str(data / "ssh")])]:
        if not (ROOT / "apps" / app_id / "backend").exists():   # app not installed: its tests aren't either
            continue
        if app_id == "browser" and not docker_ok():   # its tests skip (apps/browser/tests/conftest.py)
            continue
        port = free_port()
        env = {**os.environ, "PYTHONPATH": str(ROOT / "sdk"), "STRATUM_APP_SECRET": APP_SECRETS[app_id],
               "STRATUM_URL": f"http://127.0.0.1:{stratum_port}", "FISH_TICK_S": "0.5",
               "BROWSER_HOME": test_site + "/index.html",
               "HA_URL": f"http://127.0.0.1:{ha_port}", "HA_TOKEN": "test-token", "HOME_USERS": "*", "SSH_USERS": "*"}
        if app_id == "browser":
            proc = browser_container(port, data / "browser", {
                "STRATUM_APP_SECRET": APP_SECRETS[app_id], "STRATUM_URL": env["STRATUM_URL"], "BROWSER_HOME": env["BROWSER_HOME"],
                "BROWSER_SEARCH": test_site + "/two.html?q=", "BROWSER_MAX_PANES": "3"})
        else:
            proc = subprocess.Popen([sys.executable, "server.py", "--port", str(port), *args],
                                    cwd=ROOT / "apps" / app_id / "backend", env=env,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        procs.append(proc)
        wait_port(proc, port, f"{app_id} backend")
        key = app_id.upper()
        out[app_id] = {"port": port, "env": {f"STRATUM_APP_SECRET_{key}": APP_SECRETS[app_id],
                                             f"STRATUM_APP_BACKEND_{key}": f"http://127.0.0.1:{port}"}}
    yield {"apps": out, "stratum_port": stratum_port, "secrets": APP_SECRETS, "test_site": test_site, "ha": f"http://127.0.0.1:{ha_port}",
           "sshd": f"127.0.0.1:{sshd_port}", "authorized": authorized}
    for p in procs:
        stop(p)
        if getattr(p, "container", None):
            subprocess.run(["docker", "rm", "-f", p.container], capture_output=True)


@pytest.fixture(scope="session")
def handrec_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("handrec")


@pytest.fixture(scope="session")
def live_server(tmp_path_factory, telemetry_dir, app_backends, handrec_dir):
    import os
    port = app_backends["stratum_port"]
    db = tmp_path_factory.mktemp("db") / "test.db"
    env = dict(os.environ)
    for a in app_backends["apps"].values():
        env.update(a["env"])
    proc = subprocess.Popen(
        [sys.executable, "server.py", "--http", "--port", str(port), "--db", str(db),
         "--telemetry-dir", str(telemetry_dir),
         "--assets-dir", str(tmp_path_factory.mktemp("assets")), "--handrec-dir", str(handrec_dir)],
        cwd=ROOT / "server", env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    wait_port(proc, port, "stratum")
    yield f"http://localhost:{port}"
    stop(proc)


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    return {
        **browser_type_launch_args,
        "args": [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
        ],
    }


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "permissions": ["camera"]}


def pytest_collection_modifyitems(items):
    """Run async (pytest-asyncio) tests before any Playwright test: the sync
    Playwright API keeps an event loop running for the rest of the session,
    and asyncio can't start a second one inside it."""
    sync = {"page", "browser", "context", "playwright"}
    items.sort(key=lambda item: bool(sync & set(getattr(item, "fixturenames", ()))))
