# Writing a Stratum app

An app is one folder, `apps/<id>/`, that can live in its own git repo and be
plugged in as a submodule. Core code never names app ids; everything about
an app is in its folder.

```
apps/<id>/
  manifest.json        required: what it is and what it may use
  client/client.js     required: the module the headset/phone runs (only client/ is served)
  backend/             optional: a server-side service (its own container)
    Dockerfile
    server.py
  compose.yml          with backend/: how Docker runs it
  tests/               optional: pytest files, run by ./test.sh with everything else
```

Start from a small one: `notes` (client only), `fishtank` (with a backend).

## manifest.json

```json
{
  "id": "mygame",
  "name": "My Game",
  "icon": "🎲",
  "description": "One or two lines for the Apps page.",
  "entry": "client.js",
  "category": "Games",
  "color": "#2f9e44",
  "permissions": ["state", "channel"],
  "backend": "http://mygame:8010",
  "requiresEnv": ["MYGAME_API_KEY"],
  "settings": [{ "key": "board", "type": "toggle", "label": "Scores", "default": true }],
  "gestures": [{ "icon": "🎲", "name": "My Game", "how": "Pinch a die to roll it", "more": "Longer help for the Gestures tab." }]
}
```

| Field | |
|---|---|
| `id` | Lowercase, `a-z0-9-`, same as the folder name |
| `permissions` | `state` (per-user saved values), `channel` (live messages), `backend` (calls through Stratum's proxy), `identity` (the backend learns usernames, not just pseudonyms), `physics` (Rapier) |
| `backend` | URL of the backend inside Docker's network (the compose service name) |
| `requiresEnv` | `.env` settings the backend can't run without; `./setup.sh` leaves the backend out until they're set |
| `mount` | `"wall"` / `"surface"` to hang on walls or lie on tables |
| `variants` | Several Place tiles for one app, each with its own `config` |
| `settings` | Per-user options shown on the app's menu page (`toggle`, `choice`, `number`, `text`) |
| `gestures` | Rows for the Gestures tab (shown while the app is on) |

## client/client.js

```js
export default {
  async start(ctx) {
    const box = new ctx.THREE.Mesh(new ctx.THREE.BoxGeometry(0.1, 0.1, 0.1), new ctx.THREE.MeshStandardMaterial());
    ctx.spawn(box);                       // in the instance's frame: meters, y up
  },
  frame(ctx, dt) {},                      // every XR frame
  select(ctx, hit) {},                    // tapped / pinched
  async stop(ctx) {},
};
```

For streams (video, live state), `ctx.backend.socket(path)` opens a
WebSocket to the backend through Stratum, signed like requests (the browser
app streams its picture and sound this way).

Everything an app may touch is on `ctx`; the full list (hooks like `press`,
`grab`, `swipe`, `revealMesh`; `ctx.sync`, `ctx.state`, `ctx.channel`,
`ctx.hands()`, `ctx.physics()`, …) is the comment at the top of
[`client/js/apps/runtime.js`](../client/js/apps/runtime.js), with the design
in DESIGN.md §6. Shared helpers apps can import: `/js/apps/kit/*.js`
(hands as physics bodies, a swept-hand club, a posable hand mesh). Three.js is
`import * as THREE from 'three'` (or `ctx.THREE`).

## Your app's page: `ctx.panel`

Every app has a page in the hand menu (Quest) and the phone's sheet. Put
your controls there instead of floating boards out of reach, and get
full-size ones (not the small action chips):

```js
ctx.panel({
  title: 'Set the ceiling', sub: '3 corners',
  open: true,                                    // bring the menu up on this page now
  blocks: [
    { kind: 'text', text: 'Pinch each corner in order.' },
    { kind: 'stepper', label: 'Ceiling height', value: '240 cm', dec: () => …, inc: () => … },
    { kind: 'buttons', items: [{ label: 'Undo', icon: 'back', run }, { label: 'Done', icon: 'check', tone: 'go', run }] },
    { kind: 'choice', label: 'Theme', value: 'stars', options: [{ id: 'stars', label: 'Starry night', emoji: '🌌' }], pick: (id) => … },
    { kind: 'toggle', label: 'Sound', on: true, run }, { kind: 'row', label: 'Saved', sub: '3', run }, { kind: 'section', label: 'More' },
  ],
});
```

Call it again with the new state whenever something changes (values,
disabled buttons); `ctx.panel(null)` removes it. Tones: `primary`, `go`,
`danger`. Icons: the menu's (`back`, `check`, `close`, `plus`, `minus`,
`sun`, `gear`…) or an emoji. Sky's ceiling setup is the example.

**The cursor dot.** The end of the pointing ray shows where a press would
land: the nearest virtual thing or mapped surface. An app taking presses
anywhere (`globalPress`) can say exactly: `aim(ctx, ray)` → a local point
(e.g. `area.aim(ray)` from the play-area kit: where the corner would go).

## Performance

The headset has a tight frame budget (11–14 ms for everything), shared by
every app that's open. Keep headroom:

- **Physics only while something's happening.** Get a clock from the
  runtime and let it sleep: `const clock = ctx.sim({ step: 1 / 120, idleMs: 1200 })`,
  then in `frame()` `clock.tick(dt, () => world.step(), { busy: ballMoving })`;
  call `clock.wake()` on a press, a hand close by, a network event. Asleep,
  nothing steps (Mini Cars parked, pinball's ball in the lane).
  [`kit/simclock.js`](../client/js/apps/kit/simclock.js).
- **Level of detail.** From [`kit/lod.js`](../client/js/apps/kit/lod.js):
  `lod([[detailed, 0], [simple, 1.5]])` (meters from your eyes),
  `hideBeyond([bolts, treads], 2.5)` for small parts, and
  `mergeStatic(group)` to draw static parts in one draw call per material
  (`{ data: true }` merges parts with the same userData, e.g. all the
  `handle` walls). An instance drawing over 60k triangles with no LOD gets a
  `perf no lod` hint in telemetry.
- **Say what you were doing.** A `frame()` over 30 ms is logged (`app <id> long
  frame`, at most every 2 s, with its sim clocks' steps); add `debug(ctx)` to the
  module to put your own state in that log (bodies awake, steps run, who holds
  what). It's only called then.
- **What the Quest pays for** (measured on the fish tank: hiding it took the
  headset from 61 to 84 fps, though its `frame()` was under 2 ms; the cost was
  drawing it). Roughly in order:
  1. *Draw calls*: each mesh is one (per eye); 100 is a lot. One material per
     kind of thing, `InstancedMesh` for repeated things (the tank's fish: 3
     per species, per-fish data as instanced attributes), `mergeStatic` for
     the rest. Over 60 gets a `perf many draws` hint.
  2. *Pixel cost*: `MeshPhysicalMaterial` features (clearcoat, iridescence,
     transmission, sheen) on every pixel; `MeshStandardMaterial` with an
     envMap looks nearly as good. Loops of sin / cos in a fragment shader:
     bake the pattern into a texture once (the tank's caustics).
  3. *Overdraw*: see-through layers that cover a lot of the view (glass,
     water, light shafts) are shaded once each; keep few, unlit
     (`MeshBasicMaterial` + envMap) where you can.
  4. Triangles matter least, below ~100k for everything; use LOD past that.
  Measure on the headset: Settings → Performance → Find the slowdown.
- **See what it costs.** Settings → Performance: each app's ms a frame,
  physics ms, triangles and draw calls, the headset's fps and dropped frames;
  `perf` in telemetry every minute.

The watchdog: while the headset falls behind and one app is the cause (its
`frame()` over 2.5 ms or 20 % of the budget, a sudden 4× jump, or most of the
scene's triangles), it's slowed down (frame() every other frame, physics at
half speed), and stopped with a warning if it's still hungry 5 s later. The
user can run it anyway, and allow it to be slow.

## backend/

Any HTTP service. Requests reach it only through Stratum's proxy, signed
with a per-app secret and carrying a stable per-app pseudonym for the user.
In Python, `stratum_backend.py` (from [`sdk/`](../sdk)) checks the signature
and can broadcast to the app's live channels:

```python
from aiohttp import web
from stratum_backend import Stratum

stratum = Stratum.from_env("mygame")        # STRATUM_APP_SECRET, STRATUM_URL
app = web.Application(middlewares=[stratum.middleware])
```

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir aiohttp==3.14.4
COPY --from=sdk stratum_backend.py ./
COPY server.py ./
CMD ["python", "server.py"]
```

## compose.yml

```yaml
services:
  mygame:
    build:
      context: ./backend
      additional_contexts: { sdk: ../../sdk }
    image: stratum-mygame:latest
    container_name: stratum-mygame
    restart: unless-stopped
    user: "${STRATUM_UID:-1000}:${STRATUM_GID:-1000}"
    environment:
      STRATUM_APP_SECRET: ${STRATUM_APP_SECRET_MYGAME}   # made by ./setup.sh
      STRATUM_URL: https://stratum:8930
      MYGAME_API_KEY: ${MYGAME_API_KEY}                  # your settings: the repo's .env
    volumes:
      - ../../data/apps/mygame:/data
```

Paths are relative to the app folder. Don't publish ports: devices reach the
backend through Stratum. Then:

```bash
./setup.sh && docker compose up -d --build
```

Setup gives the app its secret (`app-secrets.env`), adds it to
`compose.apps.yml` and makes `data/apps/<id>/`.

## tests/

Plain pytest files. The repo's `conftest.py` and `tests/` helpers are on the
path: `live_server`, `page` (Playwright, with `?emulate=quest3` for an
emulated headset), `from test_main import login, open_ar, create_space`,
`from test_apps_e2e import enable, place_app`, and `backend_kit` for calling
a backend the way the proxy does. File names must be unique across the repo
(`test_<id>_….py`). Bundled backends are started for the end-to-end tests by
`conftest.py`'s `app_backends`.
