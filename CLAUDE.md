# Stratum

World-locked AR layers for Quest 3/3S and ARCore phones (WebXR).

- Read `DESIGN.md` first. §0 is current status; keep it updated at the end of a session.
- Server is Python (aiohttp + SQLite). Default to Python for server work.
- Client is plain JS ES modules + vendored Three.js r170 via import map. No bundler, no npm.
- All SQL lives in `server/store.py`; all fan-out in `server/hub.py`. Keep it that way (scaling path, DESIGN.md §9).
- ACL checks are server-side only. Never trust the client for visibility.
- Runs in Docker on boot: `docker compose up -d --build` (container `stratum`, restart unless-stopped). Client edits are live; server edits need `docker compose restart`. Stop it before using `./run.sh`, which wants the same port.
- Tests: async tests are ordered before Playwright ones (conftest hook; sync Playwright holds an event loop). Session fixtures start real golf/fishtank/browser backends and a local test site.
- Tests: `./test.sh` (pytest: API tests + headless Chromium with Meta's IWER emulating a Quest 3; see DESIGN.md §11). Add a test with every feature; pages expose state on `window.__probe`-style hooks and accept `?emulate=quest3`.
- Telemetry: client errors/log lines + server exceptions land in `data/telemetry/YYYY-MM-DD.jsonl` (UTC). Read with `.venv/bin/python server/telemetry.py [-n 200] [--level error]`. Check it first when the user reports a device bug. Pages import `js/telemetry.js`; use `telemetry.info/warn/error`.
- Raw WebGL calls behind three.js must go through a `withRawGL()`-style wrapper that restores `renderer.getRenderTarget()` after `resetState()`; otherwise XR output silently goes to the page canvas (Chrome Android uses the WebXR Layers path).
- Main app (`/`, `js/main.js`): phone-first; Spaces aligned by printed AprilTags (`js/vision/`), one root Group per Space in `js/world.js`; objects built from components in `js/assets.js`. Uploads are content-addressed in `data/assets/`.
- XR input handlers (select/squeeze events): use `e.frame.getPose()` only; `getViewerPose()` throws on event frames in Chrome. Keep the viewer pose from the animation loop instead.
- Emulator caveats: IWER 2.5 `getOffsetReferenceSpace` needs a raw matrix (see `emulate.js`); `?emulate=phone` is mono, ipd 0, with a fake tag camera (`window.__fakeCamera`) and fake taps (`window.__tapScreen({pitchDeg})`).
- Living world map (DESIGN.md §3.10): server engine in `server/mapping/` (numpy/scipy, runs in a spawned worker process; voxels + keyframes in `data/map/<space>/`); client capture in `client/js/mapping/`. `surfaces` = merged result, `surface_obs` = inputs. Emulator fakes room depth via `window.__fakeRoom` (planes, boxes, meshes).
- Apps: `apps/<id>/` is self-contained so it can be its own repo (git submodule): `manifest.json`, `client/`, optional `backend/` (Dockerfile; gets `sdk/stratum_backend.py` via the `sdk` build context) + `compose.yml`. Core must not name app ids; app-specific help goes in the manifest (`gestures`). Runtime + `ctx` in `client/js/apps/runtime.js`; server side in `server/apps.py` + app routes in `server.py`. Tests start real backends via `tests/conftest.py`.
- Setup: `./setup.sh` (tools/setup.py, stdlib) writes `.env` (from `.env.example`), `app-secrets.env` (STRATUM_APP_SECRET_<ID>), `compose.apps.yml` (includes each app's compose.yml) and the cert. All gitignored. HA token only in `.env`, passed to the home backend only, never in code or logs. `docker compose up -d --build` runs stratum + every included backend; new env vars need `docker compose up -d` (restart doesn't reread compose). Without Docker (`./run.sh`) app backends aren't running, so app API calls return 502/503.
- Before publishing anything: `python3 tools/check_private.py` (fails if a value from .env / app-secrets.env, or a listed private pattern, is in a file git would publish).
- Dev without Docker: `./run.sh` (HTTPS :8930, mkcert cert) or `./run.sh --http` (:8000).
