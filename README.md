# Stratum

A shared AR "living world" for your home, in the browser. Things you place stay
where you put them, for everyone in the space: notes on the fridge, a fish tank
on the shelf, light switches on the wall, a mini golf course on the table.

- **Quest 3 / 3S** (Quest Browser, hand tracking first) and **ARCore Android
  phones** (Chrome). Pure WebXR: no app store, no install.
- **Self-hosted**: one small Python server on a computer on your network.
  Your rooms, objects and room scans stay on it.
- **Printed markers** (AprilTags) line up every device in the same space;
  headsets also build a room map as you look around.
- **Apps** are plug-in folders (`apps/<id>/`): a manifest, client code, and
  optionally a backend container. They can live in their own repos.

## Setup

Do these in order. Part 1 is once, on the computer that runs Stratum; part 2
is once per headset or phone.

### Part 1: the computer

You need a Linux or macOS machine on the same network as your devices.

1. **Install** Docker (with Compose v2.24 or newer) and Python 3. Optional but
   recommended: [mkcert](https://github.com/FiloSottile/mkcert), then run
   `mkcert -install` once. With it, phones can trust the certificate; without
   it, each browser shows a warning once.
2. **Get the code:**
   ```bash
   git clone <this repo> stratum && cd stratum
   ```
3. **Run setup:** `./setup.sh`. It makes `.env` (your settings), app secrets,
   `data/` and the HTTPS certificate, and prints the address to open. Safe to re-run.
4. **Optional settings:** open `.env` to turn on the apps that need something
   from you (see [Settings](#settings)), e.g. a Home Assistant token for 🏠 Home.
   If you changed anything, run `./setup.sh` again.
5. **Start it:** `docker compose up -d --build`. From now on it starts on boot.

### Part 2: each headset or phone

Quest 3 / 3S: Quest Browser, hands or controllers. Android: Chrome on an ARCore phone.

1. **Open** the address setup printed: `https://<this-computer's-LAN-IP>:8930`.
2. **Trust the certificate.** Without mkcert, or on a Quest: tap *Advanced → Proceed* once.
   With mkcert on Android: copy `$(mkcert -CAROOT)/rootCA.pem` to the phone,
   then *Settings → Security → Encryption & credentials → Install a certificate
   → CA certificate*, and reload.
3. **Sign in** with any name.
4. **Print a marker:** tap *Print tags* on the start page, print one, and put it
   somewhere flat (a fridge, a wall, a desk).
5. **Look at it** in AR: the menu offers **Create a space at tag N**. Place
   things from the menu. On Quest, turn your left palm toward your face to open
   it; its **Gestures** tab lists every gesture. Turn apps on under **Apps**.

Everyone who sees the same tag shares that space. Invite others from **Space →
Invite someone** (a code that lasts 24 h).

## Settings

Everything lives in `.env` (made from [`.env.example`](.env.example)). After
editing it, run `./setup.sh && docker compose up -d --build`.

| Setting | What it does |
|---|---|
| `STRATUM_PORT` | Port on this machine (default 8930) |
| `STRATUM_APPS_OFF` | App backends not to run, e.g. `browser,ssh` |
| `HA_TOKEN`, `HA_URL`, `HOME_USERS` | 🏠 Home: Home Assistant long-lived token (stays on the server; devices never see it), where HA is, who may use it. No token = the Home backend is left out |
| `SSH_USERS` | 🖥 Terminal: who may open SSH terminals. Empty = nobody |

Generated, never commit (all gitignored): `.env`, `app-secrets.env`,
`compose.apps.yml`, `data/` (database, uploads, room maps, certificate,
telemetry, hand recordings).

### Privacy and security

Sign-in is **name only**: Stratum trusts your local network. Don't expose the
port to the internet. If you need it away from home, put it behind a VPN
(e.g. Tailscale, see [HTTPS](#https-other-ways)). Visibility between people (private vs shared
spaces and layers) is enforced on the server.

**Hand recording:** on a Quest, Stratum records hand and head motion while you're
in AR and uploads it to *your* server (`data/handrec/`, capped at 20 GB), as
training data for better gesture detection. It never leaves your server. Turn
it off per device in **Settings → Record hand motion**. The **Gesture trainer**
(linked from the start page) records labelled takes and tests how well
gestures are detected.

### HTTPS (other ways)

WebXR only runs on HTTPS. `./setup.sh` makes a certificate in `data/`:

- **With mkcert** it's signed by mkcert's local CA. Install that CA
  (`$(mkcert -CAROOT)/rootCA.pem`) on each phone or headset that supports
  user CAs, and there's no warning. On Android: Settings → Security →
  Encryption & credentials → Install a certificate → CA certificate.
- **Without mkcert** it's self-signed: the browser warns once per device; proceed.
- **Tailscale** instead: `./run.sh --http` then `tailscale serve --bg 8000`
  gives a real certificate at `https://<machine>.<tailnet>.ts.net`.
- **USB** (dev): `./run.sh --http`, `adb reverse tcp:8000 tcp:8000`, open
  `http://localhost:8000`.

If your LAN IP changes, delete `data/cert.pem` and re-run `./setup.sh`.

## Apps

| App | | Backend |
|---|---|---|
| 🌐 Browser | Web pages as panes in the room (Chromium on the server) | yes |
| 🐠 Fish Tank | Fish that get hungry even when you're away | yes |
| 🖐 Gesture Studio | See and practice hand gestures; record your own | |
| ⛳ Mini Golf | Tabletop golf; your hand is the club | yes |
| 🏠 Home | Home Assistant switches and displays on your walls | yes (needs `HA_TOKEN`) |
| 🧱 Jenga | A real-size shared block tower | |
| 📌 Wall & Desk | Sticky notes, clocks, calendars, a thermometer and the weather | |
| 📍 Find It | Mark where things are ("spare keys") and find them again | |
| ✈️ Little Plane | A little taildragger and its runway: fly it around the room | |
| 🕹 Pinball | One shared machine, high scores | |
| 🪴 Plants | Plants that grow over real days | yes |
| 🏎 Mini Cars | RC cars on your table; steer with an imaginary wheel | |
| 🌌 Sky | Turn the ceiling into a starry night, northern lights and more | |
| 🖥 Terminal | SSH terminals (needs `SSH_USERS`) | yes |
| 🏰 Tower Defense | Random winding path, classic towers, waves | |

**Add an app:** put its folder in `apps/<id>/` (copy it, or `git submodule add
<repo url> apps/<id>` for one kept in its own repo), then
`./setup.sh && docker compose up -d --build`.

**Remove one:** delete `apps/<id>/`, then the same two commands. To keep the code but not run its backend, list it in `STRATUM_APPS_OFF`.

**Write one:** see [apps/README.md](apps/README.md).

## Development

```bash
./run.sh            # core server without Docker (app backends not running), HTTPS :8930
./test.sh           # pytest: API tests + headless Chromium with an emulated Quest 3 (IWER)
./test.sh -k golf   # a subset
python3 tools/check_private.py   # before publishing: finds your .env values / private strings in files git would push
```

Stop the Docker container before `./run.sh` (same port). Client code is plain
ES modules (no build step) and is live-mounted into the container: reload the
page to see edits; server edits need `docker compose restart stratum`.

[DESIGN.md](DESIGN.md) is the full design: world locking, the object model,
visibility, the app runtime (§6), the client (§8) and dev setup (§11).
Its §0 is a running development log.

## License

[MIT](LICENSE). Third-party code in `client/vendor/` keeps its own licenses
([THIRD_PARTY.md](client/vendor/THIRD_PARTY.md)).
