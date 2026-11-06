# Stratum — design spec

Layers of persistent, world-locked content over the real world. Passthrough
is primary: you are mostly in your room / yard / street, and the "metaverse"
is whatever layers you choose to see on top of it.

Target devices (both first-class, see §8.1): **Android phone** (Chrome +
ARCore, the day-to-day test device) and **Meta Quest 3S** (Quest Browser).
Both via WebXR `immersive-ar`.
Server: Python (aiohttp). Client: plain JS ES modules + Three.js via import
map, no build step.

Living document. Sections marked **Open** are deliberately unresolved.

---

## 0. Where we are

**Done v78–v80 (was next up for 2026-10-26): performance.** (user: lots of lag with many
objects loaded; physics seems to run all the time on Jenga, maybe pinball.)
Checked: golf, jenga, pinball and racing each `world.step()` every frame,
touched or not. In order:
1. *Physics only when something's happening*: a sim sleeps when every body
   is at rest and nobody's near / touching it (hand or controller within
   reach, a pinch, a ball in play, a car with throttle); it wakes on a
   touch, a press, a network event, or a hand coming close. Rapier sleeping
   for the bodies, plus skipping `step()` entirely while asleep; a shared
   helper in the app kit (`kit/simclock.js`-style: wake(), idle checks,
   fixed-step accumulator) so every physics app does it the same way. Apps
   that really need to run (a race on, a pinball in play) say so.
2. *LOD*: core support (`THREE.LOD`-style levels per object by distance /
   screen size, with hysteresis) used by our heavy apps (towers, plane,
   golf course, fish tank, plants…), and encouraged by the tooling: the app
   authoring guide (apps/README.md) and a dev warning for an instance that
   draws lots of triangles with no LOD.
3. *Performance measurements*: per-app frame cost (its `frame()` time, draw
   calls / triangles of its subtree, physics step time), the headset's
   frame time / dropped frames, in a dev overlay and telemetry.
4. *Watchdog for hungry apps*: aim for a decent headroom under the
   headset's frame budget; when the frame rate drops and one app's cost
   jumped, first throttle it (run its `frame()` / physics every other frame,
   drop its LOD), and if it stays hungry, stop it and warn (menu row like
   the crashed one: "Slowed things down: stopped"; telemetry with the
   numbers). Settings: thresholds, and an "always allow" per app.

**2026-10-09: user goals, in order:** (1) AprilTags on the phone, (2) object
persistence aligned by tags, (3) uploads, then a **tabletop mini golf demo**
plus decorative plants/fish.

**Saved objects + uploads (main v2), 2026-10-09:** the main page (`/`) is
now phone-first. Spaces are found by printed tags: `markers` table (a tag
id names at most one of a user's Spaces; 409 otherwise), `POST /api/spaces`
takes `marker` and/or `anchor`, `POST /api/markers` adds a tag to a Space.
`world.js` rewritten: one root Group per Space = T_world←space, fused each
frame from fresh tag sightings (tag pose × inv(marker-in-space)) and Quest
anchors; small corrections blend (0.25 s), >25 cm snap. Unknown tag + no
aligned Space → overlay "Create space here"; an unknown tag seen steadily
while a Space is aligned by another tag is registered into it
automatically. Phone: tap places the palette item on the reticle surface
(or 40 cm ahead), tap an object to select → −/+/⟳/🗑. Quest: trigger
places (anchor-based Space if none), grip deletes.
Uploads: `POST /api/assets` (raw body, ≤100 MB, sha256-addressed under
`data/assets/ab/<hash>`, type sniffed from magic bytes: .glb, png/jpg/
webp/gif, mp4/webm; image/video size measured client-side), `GET
/api/assets` = my library, `GET /assets/<hash>` immutable-cached.
`assets.js` builds objects from components: primitives, `model` (glTF,
normalized to 20 cm at scale 1, sits on its base, animations loop,
SkeletonUtils clone), `image` (0.3 m picture), `video` (0.4 m muted looping
screen, time-synced via `startedAt`), `spin`. Tests: `tests/test_main.py`
(tag → Space → place → persists across sessions relative to the tag →
select/resize/delete → upload + place model → second tag learned).
43 tests passing. Not yet run on the phone.
Next: tabletop mini golf demo (+ plants/fish as decoration).

**main v9 optional occlusion, 2026-10-10:** `client/js/occlusion.js`. Off
by default; setting = main-page checkbox, phone overlay chip "◐", Quest
menu Session toggle (live on/off; turning it on mid-session needs a
session that got depth, i.e. re-enter AR). Depth sensing is only requested
when the setting is on (`usagePreference` gpu → cpu, formats luminance-
alpha / float32 / unsigned-short). Quest (gpu, texture-array): three's
built-in depth mesh, gated by us. Phones (2D depth, gpu or cpu): our pass,
a full-screen triangle drawn first (renderOrder −1e9, color off, depth
ALWAYS) that writes real-world depth (meters → NDC via the view
projection), so virtual fragments behind real ones fail the depth test.
**three r170 patched** (vendor/PATCHES.md): its depth code threw every
frame without a GL binding or with CPU depth. Telemetry logs the first
real "depth frame" (format/size/scale/uvTransform) to verify devices.
Emulator: phone fakes CPU depth = `window.__fakeDepth` m everywhere.
`tests/test_occlusion.py` reads drawn pixels: cube hidden behind a 0.3 m
"wall", visible with the wall at 0.6 m or unknown depth, and after
switching occlusion off. 96 tests. Unverified on real devices.

**main v10 phone overlay redesign, 2026-10-10:** user verdict on v9 menu:
"kinda trash". Tags confirmed working on the phone; occlusion did NOT
occlude on the phone (debug later; check the "depth frame" telemetry
line). New overlay (`index.html` + `renderMenu()` in main.js): status pill
top center (holds "Create space here" for a new tag); round menu button
bottom center (three-layer icon) opens a sheet: Running apps (status +
actions) / Place tiles / Apps switches / Session (occlusion, exit AR).
Arming a tile closes the sheet and turns the button into a green
"placing" pill (tap = cancel). Context bar above the button: selection
tools (⤓ − + ⟳ 🗑 ✕, plus the selected app's actions) or, with nothing
selected, running apps' actions. Typing (`ctx.prompt`) docks at the TOP
(keyboard covers the bottom), hides the dock, has chips (https:// www.
.com / .org, Clear, Cancel) that keep focus via pointerdown
preventDefault; form is `novalidate` (type=url blocked "example.com").
`--kb` from visualViewport lifts the dock if the keyboard is reported.
Only `.ui` elements block XR select. Rebuilds are keyed (`patch()`) so a
status tick can't replace a button mid-tap. Emulator: `#overlay.emulated`
shows the overlay above IWER's canvas; `tests/test_overlay.py` (3 tests)
writes screenshots to `test-results/overlay-*.png`.

**plants v1, 2026-10-11:** new app `apps/plants` (+ `stratum-plants`
container, `PLANTS_SECRET` in `.env`, port 8004) and manifest variants
(`server/apps.py` public → `paletteItems()`); details in §6.5. Look was
tuned from headless renders (succulent, snake, pothos at several growth /
wilt / dead states). Not yet seen on a device. 105 tests passing.

**main v11 shared state v1, 2026-10-11:** Spaces can be shared by invite
code / link; each Space has a shared layer (default target for new
things); 👥/🔒 toggle per object; app instances in shared layers; live
presence avatars. Details §5.1. DB migration adds `layers.space_id`
(backup `data/stratum.db.bak-*`). Existing objects stayed private. Tests:
`tests/test_sharing.py` (API, 6), `tests/test_sharing_e2e.py` (two users,
two emulated phones). 112 passing. Not yet tried on two real devices.

**main v12 live sync, 2026-10-11:** app room hosts + `ctx.sync` (§6.4),
live drag streaming (§5.1), golf converted to one shared game (§6.5).
Tests: host election + move relay (API), two-person e2e for live drags
and shared golf (host-agnostic: whoever joins the room first hosts).
116 passing. Not yet tried on two real devices. Backlog additions:
breakout (Quest), tabletop tower defense.

**main v13 room map, 2026-10-11:** §3.8. Next: Home Assistant app (wall
switches/buttons via the room map); needs the HA URL + a long-lived token
in `.env`. Golf v2 (turn-based putter authority + Quest putter) is in the
backlog. 121 passing.

**home v1, 2026-10-11:** Home Assistant app live (§6.5); connected to the
a real HA instance. Real sign-in is now a prerequisite for both SSH and wider Home use.
125 passing.

**main v14 hands, 2026-10-11:** direction change: Quest is hands first
(backlog: gestures, finger-gun at real switches/lights via device
anchors, point → knob/slider/color wheel; see §6.7). Built now:
`client/js/ui/hands.js` draws tracked hands (25 joint dots + bones,
InstancedMesh, light blue, translucent: passthrough already shows the
real hands) from WebXR `inputSource.hand` (`fillPoses`/`getJointPose`);
pinch = select (browser-provided); **left palm toward the face opens the
hand menu** (facing > 0.6 for 250 ms; closes below 0.15 for 450 ms, only
if the palm opened it); "✋ Show hands" toggle; telemetry `hands tracked`
once per session (which hands, hand vs controller sources) to verify the
device. Emulated via IWER `primaryInputMode = 'hand'` (`tests/test_hands.py`).
Not yet tried on the Quest.

**main v15 hand menu fixes, 2026-10-11** (user report: menu stretched
tall, cursor/presses stopped working; wanted to rotate and put it down):
- Root cause of "stretched, then dead": the menu canvas grew (e.g. a
  Selected section appeared) but three.js allocates a texture's GPU
  storage once, so the old texture kept its size; now a new texture per
  canvas size. No telemetry trace (GL errors aren't exceptions).
- Telemetry showed a second bug: after exit + re-enter AR, anchors still
  held the old session's XRSpace → `getPose` threw "sessions do not match"
  in `World.update` every frame. Now `world.endSession()` clears them and
  the per-anchor `getPose` is guarded. `session` is reset on end and a
  double tap of Enter AR no longer starts a second session.
- Menu modes (`ui/handmenu.js`): `hand` (tracked hands: on the palm,
  turning with it; controllers: above, facing you), `held` (pinch/trigger
  the top bar or grip the panel: follows that hand, rotation included),
  `placed` (let go after moving > 1.5 cm; ↩ returns it to the hand, ✕ or Y
  closes; the palm gesture ignores a carried/placed menu). Blue cursor dot
  on the panel where you point. Tests: `tests/test_handmenu.py`.

**main v16 poke, 2026-10-11:** index fingertips press menu buttons
directly (`HandMenu.poke`): the right index tip always, the left one when
the menu isn't on the left hand. Within 6 cm of the panel the tip hovers
the button under it (cursor dot follows the tip, overrides the ray); at
≤ 4 mm (from the side it approached; through is fine) it presses once and
the button flashes; pulling back 1.5 cm re-arms. Pinch-at-a-distance
still works. Next natural step: the same poke for in-world app content
(Home switches, browser panes).

**main v34 headset camera off the main thread, 2026-10-13:** device
report: big frame-rate drop with Quest tags (cause: a full 1280×960
drawImage + getImageData on the render thread ~8×/s). Now
`vision/questcam-worker.js` holds the newest frame and does all pixel work
at full resolution (brightness only: the Y plane of YUV frames, else a
weighted sum / OffscreenCanvas). Frame paths, best first: the camera track
transferred to the worker (MediaStreamTrackProcessor there); main-thread
MediaStreamTrackProcessor handing VideoFrames over without copying
(headless Chromium picks this); ImageBitmap of a <video> (GPU-side). The
camera stays on but frames are only *processed* when worth it
(`QuestCameraFeed.schedule`): after looking ≥ 20° away / moving ≥ 0.5 m,
once the head is steady (< 40°/s; waits out turns > 80°/s); a known tag
expected in view but unseen 2 s → 4 Hz; searching (nothing aligned) →
2 Hz; calibrating → ~8 Hz; else 1 Hz; aligned and nothing new for 20 s →
every 3 s. Telemetry `headset camera stats` (path, grabs by reason,
worker ms) every minute. Tests: no main-thread getImageData during AR on
any path; the schedule.

**main v35 living world map, 2026-10-13** (§3.10; user: one RTAB-Map-style
map per Space that refines over time, merged across devices and users;
apps reacting (phase 3) and mesh products (phase 4) deferred):
- **Decision: not RTAB-Map itself.** Its core is visual odometry + visual
  loop closure on registered RGB-D; our devices already track well, tags/
  anchors are our loop closures, and web depth isn't registered to RGB.
  Built its ideas instead in `server/mapping/` (numpy + scipy): keyframes =
  graph nodes (stored raw, `data/map/<space>/kf/`), one rigid correction per
  AR session found by gravity-locked point-to-plane ICP against the map,
  `rebuild` = re-register every session best-first and re-fuse (graph
  re-optimization; automatic every 400 keyframes), keyframe cap 3000 with
  redundant-pose pruning. Raw keyframes keep RTAB-Map possible later.
- **Voxels** (4 cm, log-odds, ray carving, mean hit position per voxel for
  cm-accurate planes, layers structure/furniture/clutter with decay
  ∞/30 d/3 d). Change events (appeared = solid where once seen empty; gone =
  seen through; one-voxel sheets ignored) pushed as `{"t": "map", changes}`
  and kept in `map_meta`; a synthetic cup on a counter is found within 1 cm.
- **Surfaces = merge of observations** (`surface_obs`: Quest scan per
  user+device, phone sweeps, the map's own planes) into `surfaces`; ids stay
  stable (member votes, else geometric match); Quest labels win kinds; one
  floor per height; furniture the map sees through gets its device
  observations retired. New kinds: counter, desk, couch, bed, storage,
  screen, art.
- **Client** (`js/mapping/`): background capture (moved 25 cm / turned 12°
  and steady, else every 8 s), phone CPU depth → worker (`map-worker.js`:
  mm, gzip, POST); Quest GPU depth → one tiny draw + PBO/fence readback
  (`depthgpu.js`, no stall); Quest room mesh sent once; hands/controllers
  and the user's body column masked. Room scan import + phone sweep now run
  by themselves (buttons gone). Corrections from the server applied in
  `World.setCorrection` (per session, ≤ 20 cm). Settings: "Map the room"
  (on by default; requests depth + mesh-detection) and "Show the map"
  (voxels by layer + surfaces); Space page: "Reset this room's map" (two
  taps, for everyone).
- **Emulator:** fake room depth (CPU + GPU via IWER's SEM), boxes, meshes,
  rotated phone depth buffer (`__fakeDepthTransform`).
- Tests: `test_map.py` (engine + API), `test_map_e2e.py` (phone, Quest,
  off). 189 passing. **Unverified on devices:** Quest GPU depth format
  (near/far, row order, logged as `map depth (gpu)`), phone depth range,
  real-world noise. Telemetry: `map capture`, `map capture stats` (1/min).


**main v36 seeing through clears fast, 2026-10-13** (user: picking a cup
up should clear it right away; seeing through what should be a surface
should take effect quickly):
- See-through counts by layer: clutter/furniture −1.0 (gone in 2
  snapshots from fully solid), walls/floor −0.6 (3), unsorted voxels (no
  plane pass yet) −0.4. Rays that only *skim* a surface (within ~20° of it
  and 3 cm of its recorded hits; voxels now store their surface normal from
  the plane pass) don't count, so table tops aren't eroded by grazing views.
- Snapshots every 3 s when standing still (1.5 s for 20 s after the map
  reports a change), so a picked-up cup clears in ~3–5 s while you watch.
  The 3-day clutter fade only applies to places nobody looks at again.
- Fix: steady uploads starved the plane pass (each snapshot pushed it back);
  now it runs on schedule.
- Test fix (affected 9 waits in 5 files): `page.wait_for_function` with a
  `fetch(...)` expression returns at once (a Promise is truthy), so those
  waits never waited; now `wait_until()` (tests/test_main.py) polls.
- ARCore depth is metric (meters, same scale as tracking); no scaling. 190 passing.


**Publishing prep, main v96, 2026-11-05.** (user: credential + personal-info sweep before the first commit; monorepo; test user alice; drop the Netflix screenshot; a linear README; hand recording off by default.) Sweep: 250 publishable files, nothing from .env / app-secrets.env / .private-patterns, no other emails, private IPs, hosts, home paths or key-shaped strings. Test login `dave` → `alice` (7 test files). `apps/browser/client/demo/netflix.jpg` → `example.jpg` (an example.com-style page; tab "Example"). Monorepo kept: apps' tests import core test helpers and their clients import `/js/apps/kit/*`, so standalone isn't possible yet; `git subtree split -P apps/<id>` extracts one later. README: Setup as Part 1 (the computer, 5 steps: install → clone → ./setup.sh → optional .env → compose up) and Part 2 (each device, 5 steps), Settings, Privacy and security (hand recording), all 15 apps; setup.py's pointers fixed ("README → Setup, part 2"). **Hand recording is now off by default** (`stratum.handrec === '1'`); on via Settings → Record hand motion or by turning on gesture labelling; the trainer page always records. Tests: test_handrec (off until switched on).

**trainer: Train / Test modes, 2026-10-30.** (user: the page jumps straight into training; I want a choice: test mode and train mode.) The page has 🎯 Train and 🧪 Test buttons (each starts the headset in that mode); in the headset the strip's ⇄ Mode button (4th, beside Redo / Pause / Skip) goes back to "Train or test?" with Train / Test on the strip. *Test*: `TEST_STEPS` × 5 tries, right hand: Revelio (expects a `cast`), Shoo the cube (`shoo`), Pick then cancel (a `spread` and no `shoo` by the end), Bring back the glow (`spread`; a `shoo` is wrong), Nothing (10 s of natural movement: a `cast` or `shoo` from either hand is a false alarm). Each try's GO window (5 s) runs a fresh `HandGestures` on both hands each frame (gaze from the head); the verdict comes as soon as it's certain or at the window's end: hit / miss (why: the detector's last near-miss reason, or picked-but-no-turn, fingertips never together, ...) / wrong / false / pass, shown red or green with the time to detection, high or low beep. Labels `source: 'test'` with result, why, ms; every detector event goes into the recording (`kind: 'detector'`, test step, take). Done: score per step. Redo takes a try (and its score) back. Tests: test_trainer (Mode → choice → Test; caught with time, miss with the near reason, shoo hit, cancel only sure at the end, a throw is wrong, false alarm from the left hand, a quiet "nothing" passes; score).

**Trainer session 2 + clean windows, 2026-10-30.** Second session (reach fix live): 65 good windows + 3 redone shoo takes, 89 fps, ≥ 99 % tracked; select windows' wrist travel 38–45 cm → 1–6 cm (median reach wait 1.2 s). Labels now carry `take` (unique per session; a redo is a new take; `discard` names the bad take). `tools/handrec.py windows(session)` → the labelled windows with redone / cancelled takes dropped (older sessions without take ids: the latest run of that step + rep before the discard). Both trainer sessions give 5 clean takes of each of the 13 step-stages. Test: test_trainer (redo → takes 2 and 3 for rep 2; windows() keeps 1 and 3).

**trainer v1 fixes, 2026-10-30.** (user: fix the reach; the buttons in XR don't work, couldn't redo.) First session: 40 takes, 65 labelled windows, 90 fps, ~100 % tracked; but the select windows held ~40 cm of wrist travel (still reaching), and the 10 pinches after "All done" pressed nothing: the panel is 75 cm out (no poking) and pinches used the system target ray with nothing drawn. Now: Redo / Pause / Skip on a 30 × 6.5 cm strip 38 cm ahead, 38 cm below the eyes, 20 cm left, facing you; aimed with the main app's hand ray (`handray.js`, HAND_RAY) with a beam + dot while on the strip and the button outlined; a hand pinch presses the button under that hand's beam (controllers: their target ray). Reach: shoo / shoo-cancel wait (mode 'reach', "Hand to the cube") until the right fingertips' middle is within 9 cm of the cube, bring back until the right beam points at it (or the hand's there), pinball until the palm is within 12 cm of the button, held 250 ms; then a `phase: 'ready'` label (waitedMs) and GO. `tools/handrec.py label_of` names labels (gesture.stage:side:phase). Tests: test_trainer (strip within reach and found where drawn; a pinch presses the button under the beam; takes wait for the hand, nothing labelled meanwhile).

**main v95 gesture trainer page + light first paint, 2026-10-29.** (user: a gesture trainer page linked from the main page, prompting each gesture with the object in view; shoo in 2 steps (select, then the shoo) so cancel can be trained too; right hand only (mirrored); 5 of each per session. And: the loading page takes forever to show; a super light first page, then the load.) *Trainer*: `/train` (`trainer.html`, `js/trainer.js`; linked "Gesture trainer" on the start page). Panel 75 cm ahead at eye height; cube 42 cm ahead, 30 cm below the eyes; red "pinball" button low on the right. Steps × 5 takes: Revelio (cast), Shoo (select → throw), Shoo then cancel (select → cancel), Bring back (select → spread, the cube glowing), Pinball flip (press → release), Keyboard (both hands), Palm menu (left: open → close), Nothing (4 s natural movement: negatives). A take: intro 2.5 s (first take of a step), count 3-2-1 (0.7 s each, beeps), then each stage's GO window (green panel, big stage name, bar; high beep), a low beep, 1.2 s rest. Every stage window → `{ kind: 'label', source: 'trainer', gesture, stage, side, rep, step, phase: 'start' | 'end' }` in the hand recording (HandRecorder, context page / step / rep); Redo last → `phase: 'discard'` and the take again; Pause; Skip. Buttons (poke, or aim + pinch) only between takes. *First paint*: the head now holds only the loading screen's CSS + the import map; the loading screen is the first thing in the body (first 3.5 kB); the app's CSS, telemetry.js and the 44 modulepreloads come after it, so nothing heavy is asked for before it's on screen. Telemetry 'load timing' at ready (ttfb, firstPaint, parsed, ready, modules, kB, slowest 3) to find the Quest's delay (desktop throttled 4× CPU / 20 Mbit: first paint 0.11 s, ready 1.1 s; the Quest's logs had the app ready ~0.6 s after its first script ran, so the wait is before that). Tests: test_trainer (5 takes → 10 labels saved; shoo stages; cancel step; buttons only between takes, redo / pause; panel buttons where drawn; start page link).

**Pinball flex holds steady, 2026-10-29.** (user: the flippers flicker: they engage but let go too quickly; there should be a distinct move to press and to let go, so holding is easier.) Press: smoothed (50 ms) finger straightness < 0.45 with the palm within 12 cm of a button (as before). Let go only by: straightening clearly (> 0.75, was 0.65) for 120 ms, moving the hand away (> 22 cm; curling no longer drops it by shifting the palm point past 12 cm), or tracking lost for 250 ms (a short gap keeps it held). Test: test_pinball (half-relaxed 0.64 stays held, a one-frame straight blip, the palm drifting to ~14 cm, a short tracking gap; gone 300 ms lets go).

**main v94 gesture labelling mode, 2026-10-29.** (user: a mode with all gestures off and very easy, very visible buttons: press one a second before doing the gesture, so the recording gets definite labels.) Settings → "Gesture labelling" (localStorage `stratum.labelMode`; turns hand recording on). `ui/labelpad.js` (`LabelPad`): a 24 × 43 cm pad of big colour buttons, body-locked low on your left (38 cm out, 40 cm below the eyes, 27 cm left; it re-places only when you turn > 40° or walk 45 cm, so it stays put while you gesture), drawn on top. Rows: Revelio, Shoo, Bring back, Pinball flip, Palm menu (L / R each), Keyboard (both hands), Nothing (L / R: a deliberate non-gesture, a hard negative), Done labelling. Press by poking (index tip through the face) or aim + pinch / trigger (`padDown`, before anything else gets the press). A press opens a 4 s window (`LABEL_MS`): high beep, red header with countdown; the end: low beep, the button's count (localStorage `stratum.labelCounts`) goes up; the same button again cancels, another one cuts it short. Both ends go into the hand recording as `{ kind: 'label', gesture, side, phase: 'start' | 'end', how: 'done' | 'cancelled' | 'cut' }` (+ telemetry "gesture label"). While labelling, palm menu, keyboard summon and two-finger scroll don't run; Revelio / shoo / bring-back detectors still run but only log `{ kind: 'detector', ... }` into the recording (what the rules would have done, for comparison). App controls (pinball flex, plane, cars) keep working. Tests: test_labelpad (pad low left, recording on; ray press → 4 s label, count, cancel; poke press; gestures only logged; Done ends the mode).

**main v93 hand recording for gesture training, 2026-10-29.** (user: record positives and negatives through normal use, label later; the data is valuable.) `js/handrec.js` (`HandRecorder`), Quest only, on by default (Settings → "Record hand motion", localStorage `stratum.handrec`): every XR frame with a hand tracked stores both hands' 25 joints (relative to the head, int16 at 0.1 mm), each wrist's quaternion, head pose and tracked flags, copied from `hands.js`'s `fillPoses` matrices (no extra joint reads). 10 s chunks, gzipped (CompressionStream), POST `/api/handrec?session&seq&gz` (12 kept and retried on failure). Each chunk also carries possible labels: every telemetry line (new `telemetry.listen`: revelio cast / near / shoo / reveal, Gesture Studio "studio practising" (new) / "studio detected" / "studio sample", pinball flex, drags, golf attempts, ...), the browser's select / squeeze events per hand (system pinch / grab), and context (running apps, menu open, Space), hand radii. Server `server/handrec.py`: kept as sent in `data/handrec/<UTC day>/<session>/<seq>.hrec.gz` + `index.jsonl`; cap 20 GB (`STRATUM_HANDREC_CAP_GB`), then 507 and the client stops. `--handrec-dir`. Reader `tools/handrec.py`: summary, `--events SESSION`, `load_session()` → numpy (t, head, tracked, joints (n,2,25,3) m world, wrist_q, events, meta). About 25 kB/s raw before gzip while hands are in view. Tests: test_handrec (upload, index, read back, refusals, cap; emulated Quest records, uploads, labels; switch off).

**Shoo fingertips threshold 3.5 cm, 2026-10-28.** (user.) `revelio.js BUNCH_IN` 2.2 → 3.5 cm (each of the five tips within that of their middle), `BUNCH_OUT` 4 → 5 cm (still together until then); exported, and Gesture Studio's meter reads it (was a hard-coded 2.2). Test: test_revelio (3.2 cm gathers, 3.8 cm doesn't).

**Change user, 2026-10-28.** (user: add a change user button.) Start page: "Change user" beside "Signed in as" shows the sign-in form again (Cancel goes back); signing in sets the cookie, so a new name replaces the old one (no logout endpoint needed). Per-device settings (hidden things, tag size) stay with the device. Test: test_main.

**Merge incident + fix, 2026-10-28.** The tagless Quest space's 13 things were moved server-side into the tag-3 Space (user OK'd; transform from registering the two Spaces' voxel maps: yaw 77.3°, t (-0.50, -0.60, 0.44), wall items within ~1-2 cm), but kept the old Space's *shared layer*; the user then deleted the empty Space, and `store.delete_space` deletes `objects WHERE space_id = ? OR layer_id = <its shared layer>`, so all 13 went (Revelio then had "nothing hidden": the shooed ones were among them). Restored from `data/stratum.db.bak-20261028-merge` via PUT into the tag-3 Space on its shared layer (17 things there now). Fixes: `world.moveAll` swaps the source's shared layer for the target's; the server refuses an object in one Space on another Space's shared layer (`store.layer_space`; 400 "another space's shared layer"). Tests: test_sharing (refused; moved properly it survives the old Space's deletion), test_space_merge (layer swapped).

**main v92 phones draw 3D again (Chrome 156 WebXR layers), 2026-10-28.** (user: on Android nothing shows, not even the tag brackets; the Camera probe's cubes don't either.) The phone's 'view check' (new in v91: per object its distance / angle from the camera, visibility, draw cost; plus draw calls and the framebuffer's pixel at each thing, logged 3 s after lining up and on each ✨ tap) had the plants 1.7 m away, 8° off centre, visible: placement was right, the picture was empty. probe v8 on Chrome 156: "render check: layers 1080x2424 center 0,0,0,0 · glError 1282". Chrome went 155 → 156 since the phone last drew (v55, Oct 18), and three.js r170 draws into a projection layer (`XRWebGLBinding.createProjectionLayer`) whenever `session.renderState.layers` exists. `gl.js chooseXRLayerPath(session)`, called before `renderer.xr.setSession` (main, probe, raytest), hides `renderState.layers` on Android (not Quest) so three takes the classic XRWebGLLayer (baseLayer) path; `?xrlayers=1` or localStorage `stratum.xrLayers = '1'` opts back in; telemetry 'xr layer path'. Camera-access still makes its own XRWebGLBinding (unaffected); depth stays cpu-optimized (the r170 patch keeps `getDepthInformation` off the baseLayer path). Test: test_main (emulated phone: layers hidden, baseLayer set, the cube's pixel drawn). To confirm on the phone: probe v9's render check should say "baseLayer" with a non-zero cube pixel. Full suite at v91: 350 / 351; the miss was test_browser_backend's vp8 stream at 18 / 30 pictures under machine load (passes alone).

**main v91 phones see the Quest's things, Revelio button on phones, 2026-10-28.** (user: on Android the list knows what should be there but nothing is visible; add an easy Revelio button on Android.) Cause, from the log and the DB: the Quest had put 13 of 16 things into "Space 10/28/2026, 10:00:58 AM", a Space made by placing before the tag-3 Space was lined up (anchors only, no tag), so phones can never align it; only the browser and 2 plants were in the tag-3 Space (the emulated phone draws those fine). Fixes: `world.spaceNear` gives a tagged Space an 8 m head start (`FINDABLE_BONUS_M`) over a headset-only one, so new things go where phones can find them; `world.mergeOffer()` / `moveAll(from, to)` + a "Move N things into <tagged space>" row (Space page, both menus) when a tagless Space with things is aligned here together with a tagged one: each object keeps its spot in the room (pose re-expressed in the target Space, saved via putObject; the server already publishes the move). Phones: ✨ button bottom right (`#ov-revelio`) casts Revelio (again: clears it), badge = how many of your hidden things are here (refreshed each second in AR). Tests: test_space_merge (moves in place and saves; nothing left to offer; tagged wins unless much farther), test_revelio (button badge, cast, clear). *Tower Defense*: a cannon blast stayed forever as a 1 m sphere round the board (user report): it was pushed onto `t.fx` inside the `t.fx.filter` sweep, so the new array lost it and it was never scaled, faded or removed; now effects born in the sweep join after it, and every unit-geometry effect starts at its small size (no one-frame 1 m flash). Test: test_towers (blast is splash-sized, gone after 1 s, nothing left on the board).

**main v90 shoo where your fingers are, grab Tower Defense anywhere, plane fixes, 2026-10-28.** (user: fingertips together anywhere on an object should work for shoo; many spots on Tower Defense are hard to grab and move; the plane never pitched down; drop the rudder: speed, elevator, roll only; after a crash it keeps respawning: only on a flat hand while looking at the runway.) *Shoo*: the target is the object the five fingertips' middle is on or in (`objectAt`: within 3 cm of its bounds in its own frame, the smallest if several), the ray pick only as a fallback (the palm ray points off while the fingers are bunched). *Tower Defense*: holding still anywhere on it moves it (was: only the rim / posts / HUD), except its buttons / the picker and while setting the area; an open picker closes when the move starts. *Plane*, from the log (v88: 120 crashes; 11 in a row "hit the floor" at 0.01 m/s right after respawning): a mapped floor whose plane faced down was sorted as a wall, so the parked plane was inside it; now every level surface but a ceiling is ground (`flip` for down-facing frames), ceilings and the rest are walls. And a respawn kept the throttle it crashed with (hands off keeps the throttle): reset zeroes the input; a wreck takes no input. Crash → the hand lets go, the wreck tumbles and then waits (`pl.down`; HUD "Look at the runway, hand flat: back") until, on the Quest, a flat hand (or a controller trigger) while you look at the runway (the instance origin within 30°) for 0.4 s (hands out of view mean nothing); phones: by itself. Taking it again is still look + 3 s still. Pitch: "level" at takeover is clamped to ±0.25 rad (was ±0.45: taken with the fingers 0.41 rad down, a dive needed the wrist far past that). No rudder from the hand (yaw ignored); on the ground the roll steers the tailwheel. Controllers keep their stick rudder. Tests: test_revelio (objectAt: in, 2 cm off a face, a corner; 10 cm away: none), test_towers (board grab allowed, buttons not), test_plane (no rudder, roll steers on the ground; taken 0.41 down can still dive; the wreck waits with hands out of view, not for a flat hand looking away, comes back looking at the runway without old throttle; a down-facing floor is ground).

**main v89 delete spaces, 2026-10-27.** (user: add the option to delete spaces.) Server `DELETE /api/spaces/{id}`: the owner only (403 for members: they leave, `POST …/leave`; 404 unknown): the map engine's reset for it (files + state), then `store.delete_space` (objects of the space and its shared layer, anchors + bindings, tags, surfaces / observations, keyframes, map sessions / meta, invites, members, the shared layer), then `members` to the space (every member's devices re-read their spaces and drop it: `world.refreshSpaces`). Client: `api.deleteSpace`; host `removeSpace(id)`: two taps within 5 s (the first arms: "Tap again…"), owner → delete, else → leave; then refresh, the headset's saved anchors pruned (`pruneHeadsetAnchors`), telemetry `space deleted` / `space left`. Menus: Space tab → *Your spaces* (every saved space, also when you're in none): hand menu rows with a bin (owner) / exit (shared) button, paged 5; phone rows "Delete / Leave \"name\""; the page before AR: a Delete / Leave button per space. Apps' own backend data for instances in it (e.g. a fish tank's tank) isn't touched. Tests: test_sharing (owner deletes for everyone, member can't, members hear it, things / layer / map gone), test_space_delete (phone sheet two taps; hand-menu bin).

**main v88 3D sky, cursor dot, app pages, 2026-10-27.** (user: the sky shouldn't be flat: as if there's no roof, a skybox far out, not much detail; a dot at the end of the cursor to see where a point goes (everywhere); Sky's drawing board is too far to reach, fold it into the hand menu; apps need a real UI in the hand menu, not tiny buttons, some may live only there.) *Cursor dot* (main.js `cursorAt`, Quest pointer, every other frame): an app taking presses anywhere answers `aim(ctx, localRay)` (runtime `aimPoint`; play-area kit `area.aim(ray)` → the corner's spot; Sky and Tower Defense use it), else the nearest of the virtual pick hit and `roomMap.raycast`; a white dot with a dark ring over everything, ~constant size, and the ray ends there (the old line ended at the system hit test, cast from the wrist, not the palm ray). Test hook `__app.cursor()`. *App pages*: `ctx.panel({ title, sub, open, blocks })` (runtime; `uiState().panel`; menu data picks the touched instance's) drawn on the app's page above everything else (hand menu `appPanel`: section, text, buttons (new kit widget `pad`, 24 mm, emoji / icon + label, tones primary / go / danger, on, disabled), stepper (− value +, 20 mm), toggle, choice (pads, the chosen one outlined), row; the small action chips hide when there's a panel); phone sheet `appPanel` (a grid of big buttons, steps); `open: true` → host `openAppPage` (hand menu: Apps → the app, opened; phone: the sheet on it). `ctx.renderer` for one-off baking. apps/README "Your app's page". *Sky v2* (rewritten drawing; setup + themes on its page): the far sky per theme baked once into a 512² cube texture (`bakeSky`: CubeCamera on a sphere with the old night-sky / new day-sky / sea shaders) that the opening's polygon reads by view direction (one texture read a pixel; the old portal shaders ran noise loops on every pixel); a 30 cm cut edge (inside faces of walls up from the outline, lit from above); real 3D things, only through the opening (each fragment checks its line of sight crosses the ceiling inside the outline, `CLIP`): drifting clouds (instanced billboards, 25–90 m up), aurora curtains (3 additive ribbons ~15–27 m out, folding), jungle leaf clusters overhanging the edge (50, swaying) + white clouds, the sea's surface 5 m up (waves, Snell brightness, haze) + a school of fish circling; all drawn first in renderOrder far → near with no depth test (Quest occlusion's real-ceiling depth would hide anything above it), so the room's things draw over them. Vines / bubbles in the room as before. Tests: test_cursor (on a cube; nothing → no dot), test_sky (parts + baked sky per theme; setup page: stepper, Undo / Done disabled until valid, done → theme page; the corner's aim point), test_apppanel (pads ≥ 2 cm, chips hidden, every control runs).

**main v87 the plane waits for you, 2026-10-27.** (user: the plane shouldn't take off unless I'm looking at it and hold my hand steady for 3 seconds.) `handControl`: a flat hand takes the plane only while you look at it (`lookingAt`: the plane within 30° of where the head points, `HAND.lookDeg`) and after it has been held still 3 s (`engageMs` 3000, was 350): the wrist within 3 cm and pitch / roll within 0.2 rad of where the count started, else it starts over (`restarts` in the `plane hand on` telemetry). Looking away also restarts it. HUD / status: "Look at it, hold a hand out flat" → "Look at the plane" → "Hold still… 3 / 2 / 1". Manifest help updated. Once flying, looking away is fine. Tests: test_plane (flat but looking away: not taken; 2 s: not yet; moved: starts over; still 3 s: taken; the synthetic viewer watches the plane, the hand's turn is from the look).

**main v86 browser demo, watchdog off in the emulator, 2026-10-27.** (user: for demo purposes stop pulling video for the browser; keep the backend; a screenshot of Google and maybe Netflix so you see what's in store.) `apps/browser/client`: `DEMO` (on unless `window.__browserLive`): no `/panes` request, no socket, no decoding; the pane shows still pictures (`client/demo/google.jpg`, `example.jpg` (was a Netflix screenshot; swapped for an example.com-style page before publishing, 2026-11-05), 1280 × 800, taken 2026-10-27 with headless Chromium) as two tabs (tap a tab or the menu actions 🔍 Google / 🎬 Netflix); address bar, keys, page taps say "Demo browser: just pictures for now". The backend and the live path are unchanged (DEMO = false brings them back); its tests run live (`apps/browser/tests/conftest.py` sets `window.__browserLive`; test_live_keyboard too), plus test_demo_shows_pictures… (no server requests, no stream). *Why it mattered*: Browser v2 (2026-10-25) streams the real Chrome as video: each frame decoded, made a bitmap and uploaded to the GPU (up to 30 / s) inside the render, so neither the app's frame() time nor the watchdog saw it; it ran in the slow v83 session. *Watchdog vs the emulator*: the desktop emulator's few frames a second read as a permanently overloaded headset, and since v82's stricter rules it stopped apps mid-test (shared pinball, gestures): main passes `emulated` with each frame and the runtime makes no verdicts on those (tests feed frames to `noteFrame` themselves). Gestures: "No hand seen" = the hand missing for most of the take (< 6 frames or < 40 % of ticks), not few frames (a slow device still records). test_roam's unseen-space test was flaky (1 in ~7): its fake anchor had no anchor space, so the frame loop's anchor update threw on it and cleared it between the test's steps; fixed 2026-10-28 by checking the `locating` rule on its own data (10 / 10).

**main v85 fish tank made cheap to draw, 2026-10-27.** (user ran Find the slowdown with only the fish tank, 13:34 UTC: as it is 61 fps of 90, our work 11 ms; apps paused + hidden 84 fps, 5.6 ms; camera / mapping / occlusion / hands / meter 0–3 fps each; 72 Hz didn't help: 61. Its frame() was < 2 ms: the cost was drawing it. User: do the fix; every app will need this; the Quest isn't powerful.) *Fish* drawn by kind: one `InstancedMesh` each for body, fins, eyes per kind (`kindOf` / `sizeKind` / `drawFish`; one instance-matrix attribute shared by the three; per-fish `iSwim` [wave phase, amplitude] as an instanced attribute in the bend shader; hunger grey as instance colour); each fish keeps an invisible `Object3D` placeholder the swimming moves (revelio stand-in, tests); one body level (22 × 14, eyes 10 × 7 / 8 × 6, no LOD); MeshStandard (no clearcoat / iridescence), envMap intensity up with the species' iridescence. *Tank*: glass, water volume, bubbles unlit MeshBasic + envMap; surface MeshStandard (was Physical); 4 light shafts (was 6); caustics baked once into a 128² tileable texture (`causticTex`, the old formula) read twice drifting (min) instead of ~40 trig a pixel; static parts merged (`mergeStatic`, keeping water / surface / shafts). Emulator: draws 89 → 50 (10 kinds × 3 + 20), tris near 70k → 46k (from 3 m 24k → 38k: no fish LOD now; triangles aren't the Quest's problem here). *Tooling*: `perf many draws` hint (> 60 draw calls, once per instance); apps/README "What the Quest pays for" (draw calls, physical-material pixels / shader loops, overdraw, then triangles). Test: test_apps_e2e fishtank budget (every fish drawn by kind, draws ≤ 3 a kind + 25, no physical materials, instances move). To check on the headset: Find the slowdown again.

**main v84 Find the slowdown, 2026-10-27.** (user: still slow without Jenga; what's going haywire?) v83's logs (12:47–12:50 UTC): our work ~10 ms a frame but frames 45–50 ms apart (~20 fps of 90), then frames 1–10 s apart with every step slow at random (map 1014 ms, input 640, perf 193): the GPU / system saturated, not an app (apps ~95k tris, ~250 draws, < 2 ms CPU together); the watchdog then stopped gestures, golf, fishtank one by one for "jumps" (bystanders; fixing that is the next step, not done). Every logged session has the headset camera, mapping and occlusion on, so the logs can't say which costs what. So: Settings → Performance → *Find the slowdown* (`js/perfprobe.js` `SlowdownProbe`, steps from main.js `probeSteps()`): 1.5 s settle + 4 s measuring each: as it is; headset camera off (skips questFeed head / tick, phone feed); room mapping off (the `map` step); occlusion off; hands not drawn; FPS meter off; apps paused and hidden (`runtime.setPaused`); 72 Hz instead of 90 (if offered); all of those off. Each step puts its thing back; the watchdog makes no verdicts meanwhile (`runtime.probing`); leaving AR cancels it. Results page (fps, gain vs as it is, mean / 95th-percentile frame ms, our work) + "Last test" on Performance with the biggest gain; telemetry `slowdown probe` { target, results, apps, tris, camera, map, occlusion }. Depth sensing itself keeps running with occlusion off (it's a session feature). Test: test_perfprobe.

**main v83 more performance logs, FPS meter nearer the centre, 2026-10-27.** (user: log a lot more, as long as it doesn't eat CPU; the meter a bit more into the centre of view.) *Whole frames* (main.js): every `guard()` step and the render are timed (two timer reads each); a frame whose work is > 40 ms, or that came > 3 budgets late (< 1 s), logs `long frame` { workMs, gapMs, parts: the 8 biggest steps, apps: costliest this frame (ms, tris, draws), since: how many since the last log, worstMs, heapMb } at most every 2 s. *Apps* (runtime): a frame() > 30 ms (after its first 1.5 s) logs `app <id> long frame` { ms, since, worstMs, avgMs, throttle, sims: steps / stepMs / asleep / limit, tris, draws, state: the module's optional `debug(ctx)` } at most every 2 s per instance (apps/README.md "Say what you were doing"). `perf` summary every 15 s (was 60), with each app's peak and draws. *Jenga*: `debug` (mine, simulating, steps and their ms last frame, awake bodies, held, moves, the session so far) and `jenga session` at each settle (seconds, frames, steps, ms per frame, worst frame and step, most steps in a frame, frames over 11 ms). Suspect for its 100 ms frames, to confirm with these: its own accumulator (up to 6 steps a frame of 54 stiff-contact blocks, 8 solver iterations) spirals when a frame runs long, and isn't on a SimClock, so the watchdog's throttle can't cap it. *FPS meter*: Quest spot (−0.10, 0.065, −0.55) (was −0.15, 0.10). Tests: test_perf (an app's long frame logged with Jenga's state; the session summary; a long whole frame logged with its parts).

**main v82 stricter watchdog, 2026-10-27.** (user: Jenga looked like 100+ ms a frame; an app that jumps that high should be stopped very quickly.) Telemetry 11:26 UTC: Jenga averaged 17.5 ms (the 0.95 average hides 100 ms frames), throttled then stopped ~6 s later, and gestures + golf were stopped the same second (slow because Jenga stalled everything); at 11:16 pinball was stopped at 2.6 ms while the frame's work was 126 ms (not its fault). Now (perf.js `Watchdog`): *freeze* = 3 frame() calls over max(40 ms, 3 budgets) within 1 s → stopped at once, no throttle step, whatever the fps says ("Froze the headset: 112 ms frames: stopped"); the runtime keeps each instance's raw frames over 20 ms for 2 s (`perf.slow`), not in its first 1.5 s; *hungry* also needs ≥ 15 % of the frame's work; throttle after 0.75 s (was 1.5), stop 2.5 s later (was 5); only the hungriest app advances at a time. Tests: test_perf (freeze now / hiccups not; worst first; not blamed for others' work; a 110 ms-a-frame hog stopped in < 2.5 s in the emulator).

**main v81 your hand ray, 2026-10-27.** (user picked one on /raytest: telemetry `raytest saved` 11:24 UTC.) `HAND_RAY` = tilt 57° from the palm's normal toward the fingers, starting 61 % of the way from the palm's centre to the index knuckle, 4.3 cm off the palm, smoothing 10 % (smoothDir 0.9, smoothOrigin 1, the page's mapping); was 50°, palm centre, 2 cm, 0.35 / 0.5. Their round with it: 58 hits / 8 misses, misses 2.0° off, pinch jolt 1.3°; target 6 (low, at the side) 0 / 2. Tests: test_hands (starts at that spot, ~57°), test_raytest (Defaults = these).

**Flaky tests fixed, 2026-10-27.** Cause: the headless emulator draws a few frames a second on this machine (another simulation running on it keeps the load around 30 on 16 cores), and sims cap their steps per frame, so physics runs in slow motion there; tests that waited on wall-clock time failed. Pinball tests now step the table themselves (`sim_until(page, cond, seconds)` via `__pinball.step`; fixed spans as `step(360)`) and wait for real frames after a fake hand moves (`frames(page, n)`, `runtime.frameNo`); Mini Cars tests wait on conditions (speed past 0.5; the car's position holding still, then my screen showing her there; the red lights pushed 4 s out locally once both have the same start). Full suite 330 / 330.

**main v80 FPS meter, 2026-10-26.** Settings → FPS meter (hand menu and phone; `stratum.fpsHud`, off by default): a head-locked panel (`js/ui/fpshud.js`; upper left, 0.55 m out on Quest, placed from this frame's viewer pose before render so it doesn't lag) with fps now (last second, green / yellow / red vs the headset's rate), the two costliest apps in view, and a 10 s graph of 100 ms columns by the clock (a stall leaves a gap). Each column stacks frame time: per app in view its frame() ms (solid, its manifest color) and, lighter on top, its estimated share of the time lost past the target (lost × its share of what's drawn: tris/1000 + draw calls, the scene counted each second; GPU time per app isn't measurable), apps out of view (one muted layer), the rest of Stratum's work, drawing / waiting; the top edge red where a frame ran long; axis in fps (target, ⅔, ½). In view = within ~55° of where you look, by the instance's bounding sphere (runtime, each second). `runtime.frameCosts()` gives this frame's per-instance ms, tris, draws, center. Test: test_fpshud.

**main v78–v79 performance, 2026-10-26.** *Physics sleeps*: `ctx.sim(opts)` → `SimClock` (`js/apps/kit/simclock.js`: fixed steps, asleep after idleMs without wake() or busy, `limit` for throttling, ms per tick). Mini Cars (asleep once the car hasn't moved, measured by its pose: the suspension reports speed while parked; wakes on input, the wheel, a race, another car within 0.5 m; others' cars placed directly while asleep) and pinball (asleep with the ball waiting in the lane; roll() wakes it) use it. Golf / Jenga were already lease-only (checked: Jenga settles and frees its world). *Measurements* (`js/apps/perf.js`): `drawCost` (LOD-aware tris / draws), `FrameMeter` (fps, our work per frame, dropped frames vs `session.frameRate`) fed from main's XR loop to `runtime.noteFrame`; per instance ms (per-frame, throttle-adjusted), peak, physics ms, asleep; `runtime.perfReport()`; telemetry `perf` every 60 s. Menu: Settings → Performance (frame line, apps costliest first: ms · physics · triangles · LOD / no LOD · slowed down). *Watchdog*: overloaded = fps < 90 % or work > 85 % of the budget; hungry = > max(2.5 ms, 20 % budget), or a jump to 4× its usual (> 3 ms), or > 300k tris and over half the scene; throttle after 1.5 s (frame() every other frame, sims capped at a frame's steps), stop after 5 s more (🐢 row on Home and the app page, Run anyway = allowed on this device, `stratum.perfAllow`); calm 5 s → full speed. Tests: test_perf (watchdog rules; a forced 8 ms hog throttled then stopped, stays stopped, Run anyway from the phone menu; parked car / waiting pinball step nothing, wake on use). *LOD*: `js/apps/kit/lod.js` (`lod(levels)`, `hideBeyond(objects, m)`, `mergeStatic(group)`); fish tank fish use it (light body + fins past 1.4 m; ~17 fish at ~2.6k tris each). Measured (emulator): fish tank 73k tris / 89 draws, plane 25k / 65, Mini Cars 3.6k / 253 draws, pinball 8k / 131. *v79*: plane far details (cylinder heads, stack, tread, hub caps hidden and 8×16 tires past 2.5 m: 23.7k → 18.3k tris, 59 → 50 draws); `mergeStatic` skips LOD levels and with `{ data: true }` merges parts with the same userData (keeps it, stays raycastable): Mini Cars' 240 barrier blocks → 2 (253 → 15 draws), pinball's plain walls and posts (131 → 94); fish tank plants get a far level (every 3rd ribbon row, same vertices) and bubbles 8×5: from 3 m 73k → 24k tris (near 70k); a `perf no lod` telemetry warning once per instance over 60k tris without LOD, and apps/README.md "Performance" (sim clocks, LOD kit, the watchdog); Wall & Desk clocks made a new `Intl.DateTimeFormat` every frame (0.39 ms each): cached per zone. Plants (2.5–6.6k tris, ≤ 5 draws) and Wall & Desk (a clock: 436 tris, 8 draws) are light; they hadn't started in the measuring test because it placed them like a single-item app (variants / wall mount), not a bug. Mini Cars' wedge test waited 5 s for a car that first scrapes along the barrier ~5 s (flaky with or without the merge): 8 s. Fixed: after a rescue the car could sit frozen with throttle on (Rapier had put the chassis to sleep, and the vehicle controller's forces don't wake it; its stale speed kept it from counting as wedged again): the chassis can't sleep now (the SimClock idles a parked car); the wedge test checks it drives again (caught the bug 2 of 5 runs without the fix, 5 of 5 pass with it).

**main v77 hand-ray tuning page, 2026-10-26.** (user: a separate, super simple page with buttons to test and sliders for the angle.) `/raytest` (`client/raytest.html` + `js/raytest.js`; server route), Quest AR with hands, no Space or apps loaded. Laid out where you stand at start: 8 numbered target discs (3 at eye −10 cm 0.8 m out, 2 higher at 1.3 m, 2 low at the sides, 1 small far at 2.4 m), facing you; a desk-height panel tilted 50° toward you with sliders (angle from the palm 0–90°, start palm centre ↔ index knuckle, off the palm 0–5 cm, smoothing 0–90 %) and buttons Save / Reset stats / Defaults; poke with a fingertip (within 1.5 cm) or pinch on a slider and slide along it (while dragging, that hand's ray keeps the shape it had: otherwise the angle slider chases itself). Both hands' rays drawn (right blue, left purple) with a dot where they hit. Pinch = the headset's selectstart: on a target = hit (green flash); elsewhere = a miss against the nearest target by angle (red flash, degrees off); every pinch logs the *pinch jolt* (how far the ray turned over the 150 ms before the pinch registered). Stats line on the panel. Save: localStorage `stratum.raytest` (the page starts from it) + telemetry `raytest saved` { tiltDeg, start, outCm, smooth, hits, misses, missDeg, joltDeg, perTarget } (also on leaving AR). The ray math is shared: `js/input/handray.js` (`HAND_RAY` defaults + `handRay(pos, palm, params)`), used by main.js `handRays()` too, so saved values go straight into `HAND_RAY`. Tests: test_raytest (sliders change the ray live, Defaults; pinch a target = hit, beside it = a miss with degrees + jolts; pinch-drag a slider, Save stores it).

**main v76 hand ray out of the palm, 2026-10-25.** (user: the hand beam should be close to perpendicular to the palm.) `handRays()`: the ray now starts 2 cm out from the palm's centre (wrist ↔ middle knuckle) and points along the palm normal, leaning `HAND_RAY_TILT` toward the fingers (first 0.3 rad / 17°; user: somewhere in the middle → 0.87 rad / 50°, halfway between straight out of the palm and along the fingers) (the finger direction is taken in the palm's plane, so the lean is exact); was: from the index knuckle along wrist → knuckles + 0.12 rad lift (`HAND_RAY_LIFT` gone). `e.pose`: −Z along the ray, +Y toward the fingers. Smoothing unchanged. Test: test_hands (starts at the palm, ~50° from its normal; tipping the hand fingers-up swings the ray).

**main v75 Find It + pinned app lists, 2026-10-25.** (user: a locator app with a dictionary in the hand menu, an arrow to the object and a marker where it is.) *Find It* (`apps/locator`, id locator, Tools, client only): a little pin stand placed once per space; config `{ items: [{ id, name, emoji, p (instance frame), at }] }` (shared). Mark: ＋ Mark where something is → prompt for the name → the next pinch / tap is the spot (a virtual thing it hits, else the room map along the ray, else the reticle's surface, else 0.8 m out); a name already there moves (case-insensitive); emoji from the name (keys 🔑, batteries 🔋, cables 🔌, … else 📦). The list: `ctx.menu({ pin: true, title: '📍 Find', … })`, A–Z, each row's sub = distance (refreshed every 2 s) or Finding… / Found ✓, trash = forget. Find: a marker on the spot drawn over everything (it may be in a drawer): bobbing pin, ripple ring, a 1.6 m beam, the name facing you; a 3D arrow 45 cm ahead of you, 22 cm low, pointing straight at the spot (orange far → green near) with the distance under it; within 55 cm (level) = found (chime), gone 6 s later (or after 4 min, or ✕ Stop finding). Setting Always show pins (dim pins on every spot). *Core*: an app's `ctx.menu` section with `pin: true` also shows on the Home tab (Quest hand menu: 3 rows + pager + its add row; phone sheet: all rows), so a list is one tap away. `setConfig` copies the config and remembers its last 8 saves: the server's echo of an older one of ours (saves in quick succession) no longer counts as "changed elsewhere" (it restarted the instance). Tests: test_locator (A–Z dictionary pinned + emoji + re-mark moves + phone Home shows it; mark by pointing at a mapped shelf; the arrow sits ahead / low and points at the spot, found when you walk up, then tidies away; trash forgets and stops finding; Quest: hand menu Home → tap the item → the arrow). Plan written: §6.7 3D printer (Prusa MINI).

**Little Plane app, 2026-10-25.** (user: a little airplane, a flat hand as the controls, thumb as the throttle, slow for indoors; the plane the one asset, so a good model.) `apps/plane` (id plane, mount surface, permission channel, client only). *Model* (`client/model.js`, `buildPlane(THREE, { length, scheme })`, 0.24 m long, 0.38 m span, ~24k triangles): a Cub-like high-wing taildragger made in code: fuselage lofted from monotone-cubic top / bottom / width outlines with superellipse sections (round cowl, boxy cabin), a canvas skin mapped per side (lightning stripe, registration reading properly on both sides, framed windows + windshield as smooth glass via a roughness map, door, panel lines, exhaust stain); NACA 4412 wing with fabric ribs, rounded tips, dihedral, ailerons cut out on hinges; V struts + jury struts; stabilizer / elevator, fin / rudder as bevelled extrusions on hinges; balloon tires with tread, V gear legs, sprung steering tailwheel; finned cylinder heads, exhaust stack; twisted wooden prop with painted tips + a blur disc that fades in with rpm; nav lights (red / green / white strobe) and a blinking beacon. 5 paint schemes (`SCHEMES`; per player by id hash, 🎨 Paint cycles, remembered per device). Nothing raycastable. *Flight model* (instance frame, fixed 1/240 s steps on its own clock): rigid body, toy gravity 2.6 m/s², lift from angle of attack (CL0 0.3 + 5α, stall at 0.25 rad → half), induced + parasite drag, side force from sideslip, thrust falling off to 2.1 m/s; moments as angular accelerations (control × dynamic pressure + propwash, pitch / weathervane stability, dihedral, damping); trims at 0.72 m/s, cruises ~0.8, lifts off ~0.35 m down the runway at full power. Wheels: spring-dampers at the mains + tailwheel (rests 13° nose up), rolling / brake / side friction, tailwheel steers with the rudder. *Ground* = the runway (y 0) + the room map's level surfaces (normal up; a table's top only from above), else a guess (eyes ≥ 1.3 m over the runway: runway on the floor; else floor ≈ 1.6 m under the eyes). *Crashes*: a non-wheel point (nose, wingtips, fin, prop tip, stabilizer tips) into the ground, any other mapped surface (walls…), touchdown faster than 1.1 m/s down, or lost (> 12 m) → tumble + smoke, 1.8 s, back on the runway. *Hands* (`handControl`): open hand (mean tip→wrist > 15 cm), back of the hand up, ≥ 18 cm from the eyes, for 350 ms takes the plane (setting Flying hand: either / right / left); neutral = the hand's pitch / roll / heading then (heading relative to where you look); tilt = elevator, roll = ailerons, turn = rudder (dead 0.06 rad, full 0.5, yaw 0.55); thumb angle to the fingers: ≤ 0.42 rad full power, ≥ 1.05 off (brakes on the ground); let go after 450 ms of fist / palm up / lost. *Easy flying* (setting, default on): the hand's roll is a bank to hold (×1.5, ≤ 0.8 rad), no stalls (elevator eased near the stall angle), hands off = wings level + hold height (throttle stays). Controllers: right stick pitch / roll, left stick rudder, triggers throttle up / down, left trigger brakes. Phone: tap = autopilot circuit (takeoff, 0.7 m, left circle of 0.9 m beside the runway); also a menu action. *Runway*: 1 × 0.17 m slab (handle) with edge lines, centreline, thresholds, 09 / 27, touchdown marks, edge lights, a swaying windsock; HUD over the far end (speed, height above the wheels' rest, throttle bar, status). Blob shadow on the ground below (wider and fainter with height). Engine sound: saw + square through a lowpass into an HRTF panner at the plane (listener = your head), pitch / brightness / level with throttle; a bonk on crashes. Sharing: channel `plane`, 15 Hz `{ p, q, controls, scheme, crashed }`, others drawn smoothed (control surfaces and prop too), gone after 3 s quiet; slots on the runway by player id. Telemetry: plane hand on (angles, thumb) / off, landing (vs, speed), crash (why). Tests: test_plane (model parts + surfaces move the right way + triangle budget; parked with brakes, full-power takeoff before the runway ends, slow climb; autopilot circuit holds 0.55–0.85 m and speed; synthetic flat hand: palm up / fist ignored, engage + neutral, each angle → its control, thumb → throttle / off + brakes, let go; bank with the hand turns and levels; soft landing rolls, hard one crashes and respawns; a mapped wall crashes it, a table top is ground only from above; a second player sees the plane where it is).

**main v74 Tower Defense v2: any-shape play areas, 2026-10-25.** (user: define the play space, not square, the game picks the layout and density.) A new board asks for its area: play-area kit at the table (y 0.003), pinch corners (globalPress while setting up; rays straight from the hand / tap), panel ↶ ✓ ▭ (classic 17 × 11) ✕ (only when changing), live "n corners · m squares" and "too small" / "crosses itself". Corners (mm) → instance config (shared; others restart onto it). *Layout* (`makeLayout`): k = √(area / 200) / 4 cm, clamped 1–4 (bigger areas get bigger cells, ~200 of them: 16 cm on the floor), the board built in board units and scaled by k (picker / HUD by 1 + (k−1)/2); cells = `cellsInside` (wholly inside). *Road* (`makeRoad(L, seed)`): nodes every other cell (the parity with the biggest connected set), randomized-DFS spanning tree, ends = nodes at the outline (next cell or the one after is out), pairs ≥ 0.45 × the outline's span apart, the route closest to the seed's road share (26–38 % of cells), 24 trees × 12 starts; null if it can't fit (refused at setup). Portal and castle just off the outline, facing along the road. *Tray*: meadow base extruded from the outline, wooden rim per edge (outward normal) + corner posts (handles). HUD + wave button float over the castle facing you. Saves v2 carry the outline's hash (`ar`); v1 saves = the classic board (towers on the new road dropped); snapshots carry `ar` (a guest on another outline ignores them until it restarts). Menu: 📐 Change the play area (new game on the new outline). Tests: test_towers (classic road share / ends / turns; L shape: every cell inside, none in the notch, road inside + connected, ends at the outline, plays; too small refused; floor area → k ≈ 3, ~200 cells, tap select; change area resets; second player restarts onto the shared area).

**main v73 Mini Cars wheel only at the track, 2026-10-25.** (user: the wheel came up in another room.) `atTrack(c, v, holding)`: the head (instance frame) within 1.5 m of the track's ground rectangle (`c.bounds`) to take the wheel, 2.5 m to keep it, and 0.6 m below to 2.4 m above the track (same floor); otherwise no wheel (and a held one lets go after the usual 400 ms). Test: test_racing (wheel hands 5 m away: nothing; back at the track: it comes up; 1.8 m: kept; 4 m: dropped).

**main v72 Revelio glows time out, 2026-10-25.** (user: the ghosts should show a few seconds, long enough to find and pick one, then go.) Bug: any ray resting on any glow extended the whole cast (`keepAlive`), and since v67 both hand rays always point somewhere, so glows could stay for good. Now each glow has its own `until`: 6 s after the cast + 1.5 s fade (`GLOW_MS`, `FADE_MS`); aiming at / picking one extends only that one by 3 s (`HOLD_MS`), never past 20 s after the cast (`MAX_MS`); bringing one back fades the rest at once; the cast ends with its last glow. `pick` / `revealed` take `now` (tests drive time). Gestures tab text updated. Test: test_revelio (both go on time; aiming holds only the aimed one, capped; a reveal fades the others).

**main v71 Wall & Desk, 2026-10-25.** Notes renamed **Wall & Desk** 📌 (id stays `notes`: placed notes and the app layer carry over) and grew six kinds (`apps/notes/client/widgets.js`; paper kinds unchanged): 🕰️ wall clock (3D rim, glass, box hands rotated per frame from `ctx.now()`, red sweep second hand), ⏰ desk clock (glowing digits, 12/24 h by locale, the date), 📅 calendar (month grid, today circled, season strip; tap a day → prompt → `config.days['YYYY-MM-DD']`, shown in the cell; ◀ ▶ / Today actions are per viewer), 📆 day calendar (tear-off), 🌡️ thermometer (board + scale, glass tube, liquid creeps to the reading), ⛅ weather (now: sky, temp, feels-like, high/low, rain chance; next 5 days). All take a time zone (`config.tz`, 🌍 cycles 9 zones). Weather: Open-Meteo from the device (no key), `config.place` = geocoded `{ name, region, lat, lon }` (📍, or tap when unset, or the per-user *Home city* setting), units by setting (auto: °F for en-US), one request per place + unit per 10 min shared by every widget (`weatherNow` serves a second widget at once). Frames / rims / hangers are the handles; faces take taps. Chooser previews render a fixed time and sample weather. Tests: test_widgets (clock hands vs the time, zone change shared, desk / day calendar, a calendar day note saved, thermometer + weather from a stubbed Open-Meteo with one shared request, chooser previews); test_notes updated (9 kinds, "Here" list).

**main v70 Sky + play areas, 2026-10-25.** *Play-area kit* (`js/apps/kit/playarea.js`): `PlayArea` (pinch corners on a level y: ray → plane; refuses a corner within 5 cm of another or one that makes the outline cross; dots, outline, fill; undo / setY) + helpers `planeHit`, `pointIn`, `area`, `selfCrossing`, `edgeDistance`, `cellsInside(poly, size)` (cells wholly inside, touching the outline allowed): what Tower Defense v2 and the factory will use (plans in §6.7). *Sky* (`apps/sky`, Ambience, client only): placed on the floor; the ceiling = the room map's biggest ceiling (simplified, ≤ 32 corners) or, without one, setup: a panel (▲ ▼ height in 5 cm steps, ↶, ✓, ✕) and any pinch / tap elsewhere is a corner (`globalPress` while setting up). Config shared: `{ theme, corners, height, bright, from: 'map'|'hand' }`. The ceiling polygon is one ShaderMaterial mesh (renderOrder −5, no raycast, soft 12 cm edge from the outline distance in the shader); each fragment follows the view ray (camera in the instance frame) into the theme: 🌌 stars (turning sky, Milky Way around its band axis with dust lanes and a warm core, 4 star layers twinkling, shooting stars every 6–20 s), 🌠 aurora (12 ribbon layers, green → purple with height, fine rays, dim stars), 🌴 jungle (4 parallax layers of swaying leaves, dappled light, sun + shafts; 14 vines hang into the room and sway), 🐠 sea (the surface from below: Snell's-window brightness, caustics, waves, haze, light rays, a school of fish; 60 bubbles rise from the floor). Sound made on the spot (WebAudio, setting Sound): crickets, birds (chirps, two-tone calls, a low whoop), a hushed sea with bubble blips. Menu: theme list; actions Next theme, Brightness, Set the ceiling. Tests: test_sky (setup by hand + saved, crossing refused, map ceiling used, every theme compiles and renders, bubbles move), test_playarea (helpers on an L shape).

**Browser v2: a real Chrome, 2026-10-25.** (user: Amazon didn't trust the old browser, and it felt clunky; wanted tabs, a real address bar.) *Backend* (`apps/browser/backend`, its container): one Google Chrome per player (Debian Chromium on ARM), headed on its own Xvfb display (3840×2160, a common size), persistent profile in `data/apps/browser/profiles/<pseudonym>/` (old Playwright storage states: cookies imported once), the player's timezone (`TZ`, setup.sh writes it). Driven over DevTools by our own small client (`cdp.py`: one socket, flat sessions per tab + auto-attached iframes; no Playwright), nothing injected. Gotcha: `--remote-debugging-port=0` makes Chrome report `navigator.webdriver = true`; a fixed free port doesn't. Verified: webdriver false, Amazon search and Google search load (they didn't before). *Panes* = Chrome windows in a 3 × 2 grid of slots (6 per player; `BROWSER_MAX_PANES`); a pane's tabs are its window's tabs; `target=_blank` tabs land in the same window, `window.open` pop-ups become tabs of the opener's pane (window moved onto the slot); each window is sized so the page is exactly 1280×800 (toolbar measured, re-fit when bars come and go). Title/URL from target events + polling (Chrome doesn't announce script title changes). *Stream* (`GET /panes/<id>/stream`, a WebSocket via the new core app-socket proxy): `config` + `info` JSON (tabs, URL, title, loading, back/forward, focused field), binary `[kind, flags, µs u64, payload]`: 1 = H.264 (libx264 ultrafast/zerolatency, baseline, key every 2 s) or VP8, 3 = JPEG (≤ 10 fps, on change), 2 = Opus 20 ms; capture = PyAV x11grab of the active tab's rectangle at 30 fps; a lagging socket skips to the next key frame. Sound: one PulseAudio, a null sink per player (suspend-on-idle unloaded: a suspended monitor records nothing), one recorder per player, sent to the socket touched last. Input on the socket (or POST /input): click, down/up/move, scroll, type, key (any key + Control/Alt/Shift/Meta), goto, back, forward, reload, stop, newtab, tab, closetab. History per player → `GET /panes/<id>/suggest?q=`. *Client*: WebCodecs (H.264, else VP8, else JPEG; setting Picture → Snapshots forces JPEG) into the pane texture; Opus via AudioDecoder into an HRTF PannerNode at the screen (listener = your head); a 3D tab strip (tabs, ✕, ＋) and toolbar (◀ ▶ ⟳/✕, address, ⌂) drawn on one canvas with hit regions; the address bar edits live on the keyboard (typing replaces the URL; suggestions: "Search for …" / "Go to …" + history, tap one); swipes scroll and keep gliding (fling); the keyboard comes up by itself when a field focuses (iframes included). *Core*: `GET /apps/<id>/socket/<path>` WebSocket proxy (same checks + signature as app_proxy; ≤ 16 per user/app; 64 KB in, 4 MB out) and `ctx.backend.socket(path)`; both proxies now sign the raw (%-encoded) path (a `q=a%20b` query used to fail the signature). *Tests* run the real container (conftest builds `stratum-browser:test`, host networking; skipped without Docker): backend (fingerprint, H.264/VP8/JPEG streams, input, keys, tabs/pop-ups, suggestions, Opus tone, cap + reopen), e2e (video codec, tabs, address bar, sound), core (socket proxy, encoded queries). Not done: hover (no pointer ray in ctx), GPU (SwiftShader WebGL; the host's GPU could be passed in), WebRTC.

**main v68 crash isolation, 2026-10-25.** (user: one app crashing shouldn't take everything down.) Cause class: Tower Defense's sprite threw inside core hit-testing every frame, and an exception in the XR frame callback ends the loop for good (three.js requests the next frame only after the callback returns). Now: *the frame loop* runs `xrStep` in try/catch and each step in `guard(name, fn)` (input, world, map, tags, apps, presence, touch, move box, revelio, turntables, overlay, occlusion, lighting, pixels, camera), so one failing step doesn't skip the render; unattributed errors are logged at most every 5 s per step. *Hit tests* use `pickHits()` (a per-node, try/catch version of `intersectObjects(world.pickables(), true)`): a throwing object's app instance is crashed and its hits dropped. *Rendering* (`renderSafe`): an error naming `/apps/<id>/` in its stack crashes that app; otherwise, failing 2 frames running, the newest started instance (`runtime.suspect()`), one at a time until it renders. *Escaped errors* (window `error` / `unhandledrejection`) attributed by stack, and caught hook/callback errors (`report`), count per app: 5 within 10 s (`LOOSE_ERRORS`) = crash. `runtime.crash(inst | appId, err, where)`: hides, stops (dispose guarded), backs off (2 s … 60 s, existing), telemetry `app <id> crashed (<where>)`, `runtime.crashed` → menus show "Crashed · restarting" + a ⚠️ row with the message; cleared on the next successful start. Limits: same page and thread, so an app's infinite loop or a WebGL context loss still stalls everything (the Worker sandbox, §6.6, is the real fix). Tests: test_crash (hit test, render, callback errors → restart).

**main v67 hand rays, palm menu, small cars, towers crash, 2026-10-25.** *Hand rays come from the hand* (user: the ray seemed to come from their eyes): `QuestInput.handRays()` replaces a tracked hand's targetRaySpace ray with one from the index knuckle (joint 6) along wrist → knuckles (6 + 11), tilted 0.12 rad away from the palm (`HAND_RAY_LIFT`), smoothed (`HAND_RAY_SMOOTH` dir 0.35 / origin 0.5 per frame); `e.pose` gets the matching basis (−Z along the ray, −Y out of the palm). Event handlers use `aimPose(src, frame)` (the hand's cached ray, else targetRaySpace). Hit-test sources for hands use the wrist joint space (falls back to targetRaySpace). Controllers unchanged. *Palm menu only with the hand raised* (`handRaised`: wrist ≤ 55 cm below the eyes and within ~50° of the gaze), so a hand hanging at the pinball machine doesn't open it. *Mini Cars* 65 % size (`CAR_K`; same mass/forces). *Tower Defense crashed the viewer*: its health bars are `THREE.Sprite`s, and Sprite.raycast throws without `raycaster.camera`, every frame; main's raycaster now has the camera and the bars aren't pickable. Keyboard `dispose()` on XR exit closed live-typing sessions with `resolve` (not a function): now `end()`. Tests: test_hands (ray from the knuckle, turns with the hand; hanging palm doesn't open the menu), test_towers (tapping through enemies: no page errors; fails without the fix).

**Publish prep, 2026-10-25.** *Apps are pluggable folders* (each can be its own repo / git submodule): `apps/<id>/` holds manifest, client, optional `backend/` + `compose.yml` (build context = its backend; `sdk/` moved to the repo root and reaches backends as the `sdk` additional build context) and `tests/`. Core names no app ids: the Gestures tab's "In apps" rows come from manifest `gestures` (shown for enabled apps). *Setup*: `./setup.sh` (`tools/setup.py`, stdlib) makes `.env` from `.env.example`, `app-secrets.env` (`STRATUM_APP_SECRET_<ID>`; reuses old `<ID>_SECRET` values), `compose.apps.yml` (`include:` of every app compose.yml; manifest `requiresEnv` / `STRATUM_APPS_OFF` leave some out), `data/apps/<id>/`, and the cert (mkcert, else openssl with LAN SANs); `.env` sets `COMPOSE_FILE` so plain `docker compose up -d --build` runs both. The stratum container gets only `app-secrets.env`; HA_TOKEN goes to the home backend alone. *Tests*: `conftest.py` at the root (fixtures for `tests/` and `apps/*/tests/`), app tests moved into their apps, `tests/backend_kit.py` (load + sign) replaces `test_app_backends.py` (split per app); backends/fakes of absent apps are skipped. *Privacy*: `tools/check_private.py` fails if any `.env` / app-secrets value or a `.private-patterns` regex (gitignored) is in a file git would publish, and warns about a non-noreply commit email. README.md, apps/README.md (authoring), LICENSE (MIT), client/vendor/THIRD_PARTY.md.

**main v65 Revelio slide, Gesture Studio, sized hands, 2026-10-25.** *Revelio cast is now a slide* (user: the turn wasn't sensitive enough and wasn't the motion they meant): open hand, palm facing away (palm normal · head→hand ≥ 0.35), in view (≤ 45°), ≥ 25 cm out, slid sideways ≥ 15 cm (right hand → right, left ← left, along the gaze's right axis) within 0.9 s and ≥ 150 ms, off-axis ≤ 0.7 × sideways, never faster than 1.6 m/s at any moment (a swat); 2.5 s cooldown; near-misses logged with `why`. Shoo unchanged (bunch → open + turn). `handShape(j, head, side)` adds `normal` / `away`. *Gesture Studio* (`apps/gestures`, Tools): tabs Revelio / Shoo / Bring back / Pinball flip; a teal `HandPuppet` (new kit `js/apps/kit/handpuppet.js`: the same glb posed from 25 positions, orientations derived WebXR-style, sized by hand length) loops a synthetic perfect example (`DEMOS`, mirrored for the left hand); live meters from your hand (the real detector, HandGestures, fed in the instance frame); ● Record (3 s countdown, 2.5 s at 24 Hz, one hand, Int16 mm base64 ≈ 10 KB per `ctx.state` key `s:<gesture>:<id>`, index `samples:<gesture>`, ≤ 12) with ✓/✗ from replaying through a fresh detector; ▶ Play mine (amber). Tuning: pull samples from `app_state` (app `gestures`) and replay them in tests. *Hands sized to yours*: `ui/hands.js` scales each bone by your hand length (wrist → middle tip, smoothed) over the model's (bind pose), 0.6–1.5 (telemetry 'hand size'). Tests: test_revelio (slide cases), test_gestures (every example passes its detector both hands; record → packed < 16 KB → replay), test_hands (sizing).

**main v64 Turntable (plan step 3 done), 2026-10-24.** See §8.8. All four steps of the 2026-10-21 plan are now built (1 golf, 2 cars, 3 turntable, 4 Revelio).

**main v63 Revelio ghosts, 2026-10-24.** Glows are the hidden thing's own shape, not a box: at cast, `ghostOf(root)` copies its meshes / instanced meshes (geometry shared, not copied; parts that don't draw — invisible, colorWrite off, shadow, transparent < 0.02, or `userData.noReveal` — skipped) frozen in the object's frame; Revelio gives them one material (Lambert, lavender, emissive = level; selected = bright) behind a depth pre-pass (depthFunc Always, then LessEqual: only the nearest surface, over everything, like the hands). Over 150k triangles → the box. Apps may give a light stand-in: module `revealMesh(ctx)` → Object3D in the instance frame (`runtime.revealMesh(id)`); the fish tank does (glass box, sand, ≤ 8 fish cones). Picking still uses the bounding box (+1.5 cm). Tests: test_revelio (ghost = the object's geometry, one untextured material; fish tank uses its stand-in).

**Tower Defense app, 2026-10-24.** `apps/towers` (id towers, mount surface, client only). Board 17 × 11 cells of 4 cm on a wooden tray (rim + HUD = handles). Road from a seed: randomized-DFS maze on the odd cells (8 × 5 nodes), the tree's route left edge → right edge, longest of 60 tries (~57 cells, many turns; one grass cell between lanes, so towers fit everywhere). Towers (`TOWERS`): arrow 50 (fast, air), cannon 90 (splash, ground), frost 70 (slows all in range), sniper 120 (5.5 cells, toughest first), tesla 110 (chains); 3 levels (dmg × 1.6, range / rate + 12 %; upgrade 0.8 × cost × level; sell 70 %). Enemies (`ENEMIES`): grunt, runner, tank (armor), flyer (straight line, cannon can't hit), swarm, boss (every 10th wave, 10 lives); hp × 1.13 per wave; `waveOf(n)` mixes (flyers every 5th, swarm every 7th). Start 160 gold / 20 lives; clear bonus 20 + 5n; calling a wave early +15. Sharing: ctx.sync host simulates (1/30 s) and applies events (build / up / sell / wave / new), snapshots 10 Hz while a wave is on (enemies as [id, type, d, hp %, slow], shots with hit points for effects); guests extrapolate along the road. Host saves the board (`ctx.state` `board:<instance>`) between waves. Input: `press` (tap / pinch / trigger) on a square → picker above it (faces you; poke or pinch its buttons); ▶ Wave button (poke / pinch / tap) + menu actions (Next wave, New map, Restart). Tests: test_towers (road shape, first wave cleared by 3 arrows, picker build / upgrade / sell, loss → button restarts, new map, second player builds and sees the host's enemies).

**main v62 tuning from use, 2026-10-24.** Telemetry-driven. *Revelio was too sensitive* (136 casts / 15 min at 55°/500 ms; many both hands at once; some 150–196° = tracking flips): now ≥ 80° in 450 ms, hand open ≥ 150 ms before, within 35° of your gaze, ≥ 25 cm out, confirmed 120 ms with the other hand not also turning ≥ 40°, > 150° ignored, 3 s cooldown, open = straightness > 0.75. *Shoo*: bunch ≤ 2.2 cm held ≥ 300 ms in view, then ≥ 55°. Telemetry adds view°/reach, near-miss `both`. *Mini Cars reverse*: the wheel kept dropping (4 takes in 9 s, reach only 12–17 cm, and holding required reach ≥ 12 cm so pulling for gas dropped it) and each retake re-zeroed neutral, so a full push became neutral. Now: once held, only curl + sep < 1 m; a retake within 2.5 s keeps the neutral; drops logged with why ('cars wheel dropped'). Reverse force 0.3 → 0.45. *Reset*: orange ↺ button by the panel (poke / pinch / tap), auto back-on-track when pushing without moving for 2 s or off the road 1.2 s ('cars reset'). *Pinball flex to flip*: a hand whose palm is within 12 cm of a side button curls its fingers (mean straightness < 0.45, release > 0.65) = that button held (not while pinching the knob; 'pinball flex' telemetry). Gestures tab text updated. Tests: test_revelio (60°, out of view, flip, both hands, quick shoo), test_racing (reset poke, wedged, wheel retake), test_pinball flex.

**main v61 Gestures tab, 2026-10-23.** The Quest hand menu has a 6th tab, Gestures (hand icon; tab bar 172 mm): a cheat sheet by topic (chips Basics / Move / Hidden / In apps; "In apps" because menu `find()` checks tabs first and "Apps" is a tab), each row → a detail page (`gesture`, wrapped text). Content lives in `GESTURES` in `ui/menu.js`: keep it in step when a gesture changes. Test: test_quest `test_gestures_tab_lists_how_to_and_opens_details`.

**main v60 Revelio + shoo (plan step 4, done before Turntable), 2026-10-23.** See §8.7. Tests: test_revelio (gesture cases from synthetic joints: right/left direction, too slow, fist; shoo vs spread; phone tap on a glow; layer exception cleared by toggling; Revealable off; Quest trigger on a glow). Not yet tried on a headset: the open-hand / bunch thresholds and the 55° turn are guesses; 'revelio near' / 'revelio cast' / 'shoo' telemetry will show real numbers.

**main v59 Mini Cars wheel (plan step 2 done), 2026-10-23.** Hands: both curled (mean fingertip→wrist < 13 cm, let go > 15.5), 18–85 cm apart, 12–90 cm in front of the head, right hand on the right, held 250 ms → a wheel appears through the grips (rim radius = half the hand gap, x along the hands, facing you; orange 12 o'clock stripe; not raycastable); tracking gaps < 400 ms keep it (dim, coasting). Steer = hand-line tilt / 0.7 rad. Pedals = level distance toward the wheel vs where you took it: pull > 2 cm = gas (full at 13), push 4–12 cm = brake only (`brakeOnly`: never reverses), > 12 cm = reverse. Hub gauge: speed arc, pedal ring, gear D/B/R/N (≤15/s). Pinch-gas for hands removed (a fist reads as a pinch). Panel hint line on Quest: hands (until you take the wheel) / controllers (until first throttle; `stratum.cars.controllerHint`). Telemetry 'cars wheel' on each take. Tests: 2 in test_racing (fake hands + viewer).

**main v58 golf hits (plan step 1 done), 2026-10-21.** `js/apps/kit/handsweep.js` (`HandSweep`): every finger bone + a palm fan as capsules (finger 9 mm, palm 13 mm), contact tested along the path moved since the last frame in steps ≤ half the contact distance (adaptive, ≤ 64); returns point, normal, that part's velocity. Golf drops HandBodies (Rapier kinematic contacts) for it: `handHit` sets the ball to v + (1+0.45)(v_hand·n − v_ball·n)n (horizontal, ≤ 2.2 m/s, one hit per 120 ms); claim reach 0.4 m. Measured (fake flat hand, ±3 cm off-center): old per-frame contact caught 35% of 3 m/s swings at 30 fps and 22% at 5 m/s; the sweep 100% up to 5 m/s at 30 fps (JUMP_M 0.35 m: faster than ~8 m/s at 24 fps reads as a tracking jump). `ctx.telemetry(event, data)` (new: telemetry only); golf logs each attempt ('golf attempt': hit, closeCm, speed, jumps, fps, mine). Jenga still on HandBodies.

**Plan agreed 2026-10-21 (not built yet), in order:**
1. *Golf hits* (~75% missed): log attempts (closest approach, hand speed, contact, tracking jumps, frame time); swept hit test per hand part between frames with our own response (ball speed from hand speed) instead of relying on kinematic↔dynamic contacts; club = whole flat hand + finger capsules; claim the lease from farther. Gate: scripted fast swings at low fps ≥ 95% hit.
2. ~~*Mini Cars hands*~~ (done v59): a steering wheel appears between the hands in the wheel pose and turns with them; speed by pull/push relative to where you took the wheel: toward you = gas (analog), away partway = brake, fully away = reverse; gauge on the hub; first-drive hint for controllers.
3. ~~*Turntable*~~ (was Showcase; done v64, §8.8): a placed spot holding several things in slots, one drawn at a time, swiped through (phone swipe, Quest pinch-swipe / arrows); the current item is SHARED (a swipe changes it for everyone); items keep their own layers/ACL (invisible layers are skipped); apps in hidden slots stop.
4. ~~*Revelio*~~ (done v60, before Turntable; §8.7) (only MY hidden things: layers / apps hidden on this device): objects store their bounds so hidden ones get cheap glowing placeholders; gesture = open hand turned ~60° clockwise (right) / counter-clockwise (left) fast → a band expands from you, placeholders flash as it passes then glow faintly ~10 s; all fingertips together on a glow (cursor stays) = select (brighter), spread = reveal THAT OBJECT ONLY (a per-object exception; cleared when its layer is next toggled). Same family for hiding: fingertips together on a visible object, then the 'shoo' (fingers open while the hand turns right) = hide that object (per-object, mine). Per-layer 'Revealable' setting.

**main v57 pinball fixes, 2026-10-18.** Layout (found with a fast-forward drop sweep, `__pinball.step`): flippers pivotX 0.076 / len 0.06 so the tips leave ~2.7 cm (ball 2.1) and a centered ball drains; slingshot lower ends moved so each inlane stays ≥ 3.8 cm between wall centers to the flipper; inlane guides end just above the flipper base (a notch there held the ball); top lane guides shortened (pocket above the right bumper). Mirrored flipper geometry gets its winding flipped (the right bat lit dark). Controls: hands play the machine's parts only: pinch the plunger knob (ray or direct pinch within 4.5 cm) and pull toward you (6 cm = full), poke / pinch / point at the red side buttons; anything else on the machine is the host's (pinch-hold moves it; `grab` prevents only on parts or while a part is held). Controllers: triggers flip from anywhere near (`globalPress(ctx, {source, side})`, new arg); phone unchanged. Inputs are matched down→up by side.

**main v56 mesh hands, 2026-10-18.** `ui/hands.js` draws the WebXR generic hand (skinned glTF, vendored `client/vendor/hands/{left,right}.glb` from @webxr-input-profiles/assets 1.0) with bones set from the 25 joint poses (bones are flat under the armature, root/armature forced to identity). Glass look: MeshStandard, fresnel rim in emissive + alpha (`hand-glass`, `tint()` sets the rim). Over everything without seeing its own far side: a depth pre-pass mesh on the same skeleton (`depthFunc Always`, renderOrder 1099) then the glass (`LessEqual`, 1100). Joint dots/bones remain only until the model loads (or if it fails). Tests: `free_port()` now picks 20000–32000 (a monitoring agent probing a local nginx at ~470 conn/s filled the ephemeral range with TIME-WAIT and backends couldn't bind).

**main v55, 2026-10-17.** Key clicks: `ui/sound.js` (filtered-noise snap + low tap; `unlock()` on the Enter AR click and XR selectstart, since fingertip pokes aren't user gestures and left the AudioContext suspended). App rows in Layers now hide the app's things anywhere (`world.mutedApps` / `setAppMuted`, persisted with the hidden layers): instances placed in a Space live in its shared layer, so hiding the app layer did nothing. Row count = instances.

**main v54 loading, 2026-10-17.** Loading screen inline in index.html (`#boot`: logo, bar, step text; `window.__boot(text, frac)` / `__bootDone()` / `__bootFail()`; bar = module files arriving (PerformanceObserver) to 60%, then main.js steps; load errors and a 20 s stall show Retry). Server injects `<link rel=modulepreload>` for main.js's static import graph (`preload_links()`, after the import map) so revalidation is parallel, and `/vendor/` is `max-age=86400`. Library list loads in parallel with startup. Hands draw over everything (depthTest off, renderOrder 1100). Steady threshold raised to 30 cm / 6°.

**Hold spaces still, 2026-10-17.** Setting (Quest + phone menus, `stratum.steady`, `world.steady`): an aligned Space ignores tag / anchor corrections under 12 cm / 4°; bigger, held 2.5 s → it glides there (`settling`) and holds again (`World.holdStill`, telemetry 'steady space moved'). Phones keep a quicker hold-to-move (`MOVE_TIMING.touch*`: 200+500, handles 100+350).

**main v53 hold-to-move timing, 2026-10-17.** `runtime.moveTiming(hit, source)` → `{delay, duration}` (defaults `MOVE_TIMING`: body 500+800 ms, handles 250+450; apps: `moveTiming` object or fn(ctx, {handle, source, object}), clamped delay 0–3000, duration 150–5000). Quest and phone holds both use it. Move box 'hold': nothing during delay; corner dots swell exponentially (first 40%), then edges grow from both corners and meet mid-edge; closing = pickup; release before = cancel. Pinball: cabinet sides/front no longer handles (backbox, back, bottom, legs are), `moveTiming {400, 900}` — fixes Quest plunger holds moving the machine.

**main v52 moves, 2026-10-17.** Quest hold-to-move is slower (HOLD_MS 1000, handles 500). `ui/movebox.js` replaces the BoxHelper: an object-oriented frame drawn over everything (depthTest off) — 'hold' (after 30% of the hold, edges grow from the corners, faint→firm), 'drag' (thick blue, corner knobs, pops in; controller haptic pulse), 'two' (amber). Two-hand move, any object: while one hand drags, the other pinch/grip joins (`QuestInput.joinMove/leaveMove`, `startTwoHand`, `twoHandMatrix`): uniform scale by hand distance (abs. 0.05–20), yaw by the hands' turn, about their midpoint; second hand off → back to one-hand from the current pose (`d.turn` keeps the yaw), first hand off → saved. Tests: hold box + two-hand scale/turn in test_quest.

**Fish tank v2, 2026-10-17.** Fish never die: backend hunger caps at 1 (starving = pale, low, slow tail); `migrate()` revives dead fish in old tanks, gives them a species and adds the missing kinds (tank `v: 2`). Tank 0.6×0.36×0.3 m. 10 species (`SPECIES` in backend: length, depth band, pace, school size; client: body profile, fins, skin painter). Neon tetras school (6 share one plan; client offsets). `POST /tanks/{id}/fish {species?}` adds one (or a school), max 30; `/restock` = random add. Client is fully procedural: ring-profile bodies with canvas skins (scales, countershading), merged fin outlines with a 4-quarter fin atlas, eyes; swimming = traveling-wave bend in the vertex shader (`bend()`, pectorals paddle via aFlap). Aquascape seeded by instance id: sand dune heightfield + skirt, pebbles (instanced), stones, driftwood, moss, one merged swaying plant mesh (vallisneria, swords, red stems, anemone), caustics injected into decor materials (`water()`), light shafts, bubbles (instanced), rippling surface (scrolled normal map), glass with silicone edges, LED bar, canvas equirect env map for reflections. Fish eat pellets they reach.

**Pinball: classic machine, 2026-10-16.** `apps/pinball/client/client.js` rewritten look + rules (physics core, lease sharing and test hooks unchanged). Cabinet: painted trapezoid sides (canvas art), chrome lockdown bar/rails/legs (matcap), coin door, plunger knob, side flipper buttons, backbox (static title art + 576×240 score glass with reels and BALL IN PLAY / SHOOT AGAIN / GAME OVER / MATCH, redrawn ≤10/s via `panelDirty`). Legs action: short (table) / tall (floor), per-user `state.legs`. Playfield: painted canvas, inserts (lanes, bonus ladder 1-10, 2×/3×/5×, shoot again, extra ball, targets, spinner), attract-mode lamp chase. Rules: lanes A-B-C + lane change → multiplier; 3 drop targets (colliders disabled when down) → spinner lit, again → extra ball lit; left-orbit spinner; kickout saucer (holds 1.2 s, collects extra ball); slings kick; bonus counted ×mult at drain (`countBonus`, 140 ms/step); ball save 6 s from first leaving the lane; match at game over. Lamp state `p.show` streams as `w`. WebAudio chimes (10/100/1000), coil thunks, knocker. Tests: 5 new in test_pinball (tests set `saveUntil = 0` before draining).

**main v51 Mini Cars, 2026-10-16.** `apps/racing` (manifest id racing, "Mini
Cars", mount surface): Rapier ray-cast vehicle, RWD, 16 cm cars on a 1.3 ×
0.9 m loop with an S, barriers, start line, quarter checkpoints, 3-lap
races from one shared start time (server clock), best lap per user.
Each player simulates their own car and streams it (ctx.channel, 20 Hz);
others' cars are kinematic copies, ghosts (sensor) until clear of mine and
again after any > 10 cm jump (sliding a kinematic copy to a re-slotted
grid spot shoved cars off the track). Rapier lesson: the ray-cast vehicle's
side grip doesn't scale with size or mass — a real 16 cm / 0.3 kg car
turned 1° where geometry says 139° — so physics runs 6× bigger, 6× gravity,
100 kg chassis (forces scaled), drawn at 1/6: same motion, steers true.
New `ctx.controls()` (Quest gamepad values per hand: trigger, squeeze,
stick, hand). Controls: Quest right trigger gas / left brake-reverse /
stick steer; hands = hold like a wheel (palm line tilt) + pinch; phone =
tap to go, left / right half steers, both brake. Off-throttle motor drag.

**main v49–50, 2026-10-16.** Phone camera images: grayscale copy only when
the mapper wants one (≤ 1/s, `mapper.wantsImage`; v34 rule: no per-frame
pixel work on the render thread). Ceilings: one per level and area (± 4 cm,
pieces ≤ 50 cm apart), so stepped / dropped ceilings keep their levels
(user's room: 2.0 / 2.2 / 2.3 m). Rebuild: a piece that barely lies inside
the already-mapped footprint (< 15 % of its points, 25 cm cells) is a new
area and is kept as placed (was dropped: no overlap ⇒ never verifiable);
overlapping pieces that won't align stay out. ORB-SLAM3 findings
(tools/slam/orb_sweep.py on TUM fr1/desk + fr1/room): needs ≥ 10 fps
(≤ 2 fps: lost; 5 fps unreliable); at 10 fps image-only (scale from
device poses) beat RGB-D with AR-like depth (fr1/room 2.4 cm vs a 152 cm
failure); 320 px gray costs some accuracy vs 640 px. On the user's phone
recording (~1 image/s, 51 images): RGB-D tracked 2 frames, mono 0;
ORB-SLAM3 crashes on portrait images (exporter turns them). RTAB-Map with
images: 0 visual loop closures (only one session has images). Measured AR
depth (user's data): ~3 cm noise per keyframe, ~4 cm offset between
keyframes, Quest at every range. Next: Quest dense capture (10 fps gray
in the camera worker) for ORB-SLAM3 / visual RTAB-Map; images on every
session so visual loop closures have something to match.

**main v48 SLAM experiments, 2026-10-15** (`tools/slam/`, offline, see its
README). RTAB-Map 0.24 (stratum-rtabmap: keyframes as 3-D scans, device
poses as odometry, proximity ICP loop closures, graph optimization) and
ORB-SLAM3 (stratum-orbslam3, headless RGB-D; validated on TUM fr1/xyz:
1.04 cm ATE). compare.py re-fuses a Space with each pose source and scores
it. On the real map (881 depth keyframes, no images): raw devices wall p80
5.31 cm / floor σ 4.68; ours (v47 rebuild) 4.81 / 4.95 using 489 kf;
RTAB-Map 6-DOF with free inter-session links diverged (sessions 10–45 m
off); RTAB-Map 3-DOF (Force3DoF, z-up base frames, 1 m inter-session
covariance) 4.18 / 5.25 using all 881 kf, 260 loop links, but can't fix
per-session height (two ceilings) and keeps some doubled walls. Client now
attaches a ≤ 320 px grayscale camera image (+ its own pose, intrinsics) to
depth keyframes (`stratum.mapImages`, default on) so ORB-SLAM3 / visual
RTAB-Map can run on new recordings. Next: record with images, run both.

**main v47 map fidelity, 2026-10-15** (review of the user's real map:
9 sessions disagreed by 30–50 cm / up to ~45°; only 1 got an ICP
correction because ICP searches 20 cm and accepts ≤ 15 cm; reported floorY
was 1.3 m off (roaming Quest), so the ceiling became counters/tables).
(1) `mapping/align.py`: gravity-locked coarse alignment (yaw sweep ±45°,
FFT cross-correlation of top-down wall-point grids, floor-height offset),
then ICP. `engine.rebuild` now aligns pieces (session × client alignment
epoch × ≤ 40 keyframes), biggest first, repeated passes; accepted only
with a clear margin / ICP agreement; unverified pieces stay out of the map.
Service rebuilds early when a session the live ICP can't place reaches 40
keyframes (≥ 5 min apart). Client: keyframes carry `epoch` (bumped when
the Space's alignment target jumps ≥ 3 cm / 1°) and capture pauses while
the Space glides. (2) Floor from the map (biggest low horizontal level,
below the cameras), not devices; ceiling = above eye level, faces down.
(3) One floor, one main ceiling, wall pieces in one plane joined
(≤ 7°, 6 cm, 40 cm gaps); surface normals over 24 neighbours (fused walls
are 2–3 voxels thick); horizontal specks < 0.08 m² dropped. (4) Phone-only
surfaces superseded where the map looked and found nothing at that height
(and phone floors/ceilings at impossible heights). Real map: 107 → 34
surfaces (1 big floor at −1.63, ceiling 2.24 m up, 12 walls); 13 of 27
pieces verified. Next: visual place recognition for the pieces geometry
can't place (see the review notes in the session summary).

**main v46 SSH polish, 2026-10-15.** Full keyboard layout gained an
F1–F12 + PgUp/PgDn row, Alt (sticky, `Alt+<key>`), Shift+Tab, and an
Ins/Del/Home/End row on the pad; on the full layout an app's chips that
duplicate real keys are dropped (SSH keeps ^C + Paste). SSH backend sends
F-keys (xterm), Insert, Shift+Tab (`ESC[Z`), Alt+char as ESC+char and
Alt+arrows/Home/End as `ESC[1;3X`. Bluetooth keyboards: document keydown →
the busy keyboard's `hardware(ev)` (or summon the last-used app first);
Ctrl/Alt combos mapped; first key logged as `hardware keyboard key` (does
Quest Browser deliver keys in immersive AR? unverified). The pane being
typed into shows ⌨ + a blue underline on its bar.

**main v45 placed keyboard, 2026-10-15.** New built-in object ⌨ Keyboard
(`components.keyboard.layout` simple | full; base slab in assets.js). On
the Quest each one gets a fixed `Keyboard` (`{ fixed: true }`, posed on
its base every frame, always showing; idle keys → `runtime.summonKeyboard`
then the key). Routing: `quest.typingKeyboard()` picks a placed keyboard
when an index tip is within 30 cm or your head is within 90 cm, else the
pop-up; a busy pop-up hands its session over (`kb.handoff`, no close) when
you reach for a placed one; the typing gesture is ignored at a placed
keyboard. Layouts: simple (as before) and full (Esc/Tab/Ctrl/Del/Home/End/
arrows, shifted symbols, number pad); pop-up default in Settings →
Keyboard; placed ones in their tools. Next: SSH polish on top of it.

**main v43–44 golf holes + shared pinball, 2026-10-15.** Golf: holes 4–6
(Windmill: crossed blades about z sweeping a gate; Rush Hour: 3 sliders;
Pachinko: 13 bouncy posts + angled walls). Moving parts are kinematic,
posed from the shared clock (`ctx.now()`) so every device agrees; the
simulating device moves them per substep. No auto-advance: a physical
"Next hole ▶" button by the course (tap / pinch / fingertip poke; 1.2 s
debounce) sends the hole event. Scorecard per player (`ctx.player()` →
stable user id + name) shared in the rest state; round resets at hole 1;
leaderboard only gets solo holes. Pinball moved onto the lease: one
machine per space, first press claims + starts the game (and pulls the
plunger), 30 Hz stream (ball, flippers, plunger, kicks, lamps, score);
game over or 30 s idle settles a shared top-5 board. Needed the `channel`
permission for ctx.sync (without it the room never forms). Known flake:
`two_people` setup in test_sharing_e2e under full-suite load.

**main v42 Jenga + physics follows the player, 2026-10-14.** `ctx.sync`
gained a transferable simulation lease (claim / stream / settle / rest /
seed; earlier claim by server clock wins; 3 s quiet = lapsed; newcomers ask
for the rest state). Golf moved onto it (no fixed host: whoever putts or
reaches in simulates locally; strokes + spot shared at rest). `ctx.hands()`
(joints, palm frame, pinch, scale in the instance frame) and
`js/apps/kit/handbodies.js` (hands as kinematic Rapier bodies, interpolated
per substep so swing speed carries; tracking jumps teleport). Golf: hand =
club. `apps/jenga`: 54 real-size blocks, no physics at rest; claim on press
or hand near; spring-pull along the input ray (`press` e.ray()), fingertip
pokes; collapse = 2+ untouched blocks dropped; moves = handled blocks
ending on top; rest saved per user. Rapier lessons: stacks need
`integrationParameters.contact_natural_frequency` ≈ 240 (default sags
~4 cm over 18 levels) and a pre-settled rest; bodies created asleep ignore
contacts (tower falls through itself), so start awake. Not tried on
device: hand-club feel, finger pokes, pinch-pull.

**main v41 pinball + press hook, 2026-10-14.** `apps/pinball` (client
only; Rapier at 240 Hz in the flat table frame, gravity tilted 6.5°;
kinematic flippers, pop bumpers, slingshots, 3 top lanes, plunger; 3 balls;
best score in per-user app state). New platform hook `press(ctx, e)` (down
/ up right away, e.side left/right = phone screen half or Quest hand) +
`globalPress(ctx)`; a taken press is not a tap / hold / click for the host;
handles never route to apps. Balls are launched already rolling (a sliding
start lost a third of the speed to spin). Jenga plan: §6.7.

**main v39 app-driven moving, 2026-10-14** (device report: couldn't move
objects on the Quest with hands; grip was the only way). Moving is a host
default that apps can veto, like a DOM default action. Default gestures:
phone long-press; Quest pinch/trigger held still 550 ms (250 ms on a
`userData.handle` part; ray movement > 2.5° makes it a scroll/aim
instead); controller grip. Before starting, `runtime.mayMove` calls the
app's `grab(ctx, e)` ({ how: hold|grip, handle, source, point,
preventDefault() }). `ctx.move()` and the new "Pick up" object tool carry
the object on the aim until the next tap/pinch. Browser + SSH veto holds on
their page (pole/base still move). v40: the blue outline shows only while
something is being moved, not on select (also stops the NaN BoxHelper
errors from empty objects). Next: the fixed-place keyboard.

**main v38 live sync + motion-aware tags, 2026-10-14** (device report:
objects moved on the phone only showed on the Quest after re-entering;
tags read while moving landed far off). (1) Live socket watchdog
(`api.js` Live): ping every 10 s, server answers `pong`; nothing heard
for 25 s (or > 10 s on returning to the page) → new socket, which resyncs.
Telemetry `live socket silent: reconnecting` confirms the cause on device.
(2) Quest camera captures carry head speed at the photo's time
(`questcam.motion(t)`); `sightingWeight` uses it (turn and move), drops
sightings over 40 °/s or 0.35 m/s, and TagFix now gets each raw sighting
(`tag.last`), not the tracker's smoothed pose. Next: the fixed-place
keyboard (user request; prereq for SSH).

**main v37 steady tags + anchors, 2026-10-13** (device report: tag
location noisy and inconsistent on the Quest; telemetry showed map
corrections jumping 0.7–5.7 cm every 3–5 s, chasing tag jitter):
- Tag sightings no longer move a Space one by one. `js/tagfix.js` averages
  them (window 150; weight = near² × face-on² × head still; outliers > 3 MAD
  / 6 cm / 4° around the weighted median dropped). Settled when the
  *average* is sure to 4 mm (spread / √n_eff) with ≥ 12 sightings.
- Settled → an anchor at that spot holds the Space (`World.anchorSpace`):
  saved + bound to the device on the Quest (one per Space, not per tag:
  8-anchor limit), session-only on phones (`anchors` feature now
  requested). Anchors win over tags; tags only check: settled tags ≥ 5 cm /
  2° off the anchor for 3 s → drop this device's anchor, re-anchor
  (telemetry `space anchored from tags`, `space re-anchored`).
- Map corrections apply only when two in a row agree (1.5 cm) and the
  change is ≥ 1 cm / 0.3° (`World.setCorrection`).
- Tests: `test_tagfix.py` (averaging, stillness under jitter + anchor,
  re-anchor), Quest calibrated-tag test now expects a saved anchor. Test
  helpers: page-load waits use `window.__app?.world` (a race made them
  throw). 193 passing.


**main v33 room lighting, 2026-10-12:** `client/js/lighting.js`: WebXR
light-estimation (requested optionally everywhere; Chrome on Android
supports it) drives a directional light (the room's main light: direction,
color, intensity) and a THREE.LightProbe (ambient spherical harmonics),
smoothed (0.35 s); the standard hemisphere + sun lights hide while it's
active and come back when estimates stop for 2 s, when it's switched off
(Settings → "Match the room's light", `stratum.roomLight`), or where it
isn't supported (Quest: standard lighting). Telemetry `lighting {mode}`.
Not yet: the reflection cube map (shiny surfaces reflecting the room).
Google's Geospatial API (Earth anchors) is native-only (ARCore SDKs), not
WebXR, and is VPS/Street View based (best outdoors): see §12.

**main v32 Quest sees tags, 2026-10-12:** device test (/probe on the
Quest): getUserMedia works during immersive-ar, ~25 fps (3 cameras:
"camera 0, facing front", "camera 1/2, facing back"; 640×480 asked).
Integrated (§3.9): `vision/questcam.js` (QuestCameraFeed: asks on the 2D
page at Enter AR, same camera every time, head-pose history, captures →
TagTracker with K + cameraWorld from the calibration),
`vision/calibrate.js` (one tag, head moving: LM over lens f/cx/cy, head →
camera pose, tag pose; latency searched coarse → fine; outlier views
dropped; weak priors). Quest menu: Settings → Headset camera (see printed
tags, Calibrate with a tag, Forget calibration); Home/Space offer
"Create a space at tag N". Until calibrated, tags show their marks but
don't align or create Spaces (`world.tracker` null). Emulator fake camera
`window.__fakeQuestCamera` (known lens/placement/latency) — in tests
calibration recovers f within 1%, camera rotation < 0.4°, offset ≈ 1 cm,
and tags land within ~1 cm. Calibration lives in localStorage
(`stratum.questcam`), telemetry `headset camera calibrated {…}`.

**main v31 phone: tap to use, hold to move, 2026-10-12:** device report:
on the phone the Home switch wanted to move instead of toggling. Phone
touch rules are now simple: a tap is always a tap (apps get it); only a
still **hold of 600 ms** picks anything up (grab handles and selected
objects no longer drag instantly); moving the finger first is a swipe. A
ring fills under the finger while holding (fades in after 120 ms so taps
never flash it) and pops on pickup (`#ov-hold`). New `ctx.device`
('quest' | 'phone'); Home hides its grab tab on phones.

**main v30 Notes app, 2026-10-12:** `apps/notes` (client-only; all
state in the instance config `{ kind, color, text, done }`, so it's saved
with the object and shared). Variants Sticky note / Index card (ruled) /
Label, with chooser previews. New platform mount **'surface'**: flat on
a wall, or lying face-up on a table/floor with its top edge away from
you (`mountFor` in main.js; the Quest path also stopped ignoring wall
mounts when no Space existed yet). New `ctx.instance.fresh` (this device
just placed it): a fresh empty note opens the keyboard / typing box.
Tap = write (keyboard with capitalize), 🎨 cycles 6 colors, ✓ Done
strikes through + check mark. Paper has a curl, small random tilt, soft
shadow; text auto-fits (handwriting font stack, setting "Handwriting").
Handle: a push pin (ownHandle; the default puck stuck out of walls).
Menu page lists "Notes here" (tap = write). Tests: `tests/test_notes.py`.

**main v29 tag marks, 2026-10-12:** printed tags in view get a quiet
mark (`ui/tagmarks.js`): four thin corner brackets on the paper just
outside the tag, snapping in when first seen, breathing slightly, and a
soft ring rippling out every 2.4 s; fades 0.25 s after the tag is lost.
Amber = new tag, blue = belongs to a Space. Pose from the tag's full
6-DoF sighting, smoothed. Normal blending (white paper kills additive
glow). Also: conftest orders tests using any sync Playwright fixture
(page/browser/context/playwright) after the async ones.

**Quest tags, step 1 (2026-10-12): camera feasibility test.** Goal (user
decision): printed tags as the shared anchor on the Quest too (the only way
phone + Quest truly share Spaces; also removes the 8-anchor limit). WebXR
`camera-access` is rejected on Quest; the Quest Browser has a "Headset
cameras" site permission (getUserMedia) and "initial passthrough camera
support" (v38.2). `/questcam` (client/questcam.html, js/questcam.js) asks
for the camera on the 2D page, enters immersive-ar, counts camera frames
during AR, runs the tag worker on them, shows a panel (camera image,
stats, detected corners) and a green square at a guessed tag pose
(HFOV 70°, camera at the head), and logs `questcam: …` telemetry incl. up
to 40 raw samples (corners + head pose) for calibrating the camera offline.
Next, depending on results: solve camera intrinsics/extrinsics from the
samples, then feed Quest sightings into the same TagTracker/World
alignment the phone uses.

**main v28 Quest placing fix, 2026-10-12:** telemetry showed the real
cause: in an **unbounded** session the Quest Browser fails every
`frame.createAnchor` ("Anchor creation failed") and every
`deletePersistentAnchor`, so no Space could be created. Now: roaming is
**off by default** (opt-in `stratum.unbounded = '1'`); anchors that fail
in the unbounded space are retried in local-floor (`world.createAnchor`);
if that fails too, the item still lands (temporary Space) and roaming is
switched off for next time with a note in Settings. Phone: overlay UI
keeps clear of Android's status bar (`--top: max(env(safe-area-inset-top),
34px)`; the fullscreen DOM overlay reports no inset).

**main v27 anchor cleanup, 2026-10-12:** all Spaces cleared on request
(4 Spaces, 53 objects; backup `data/stratum.db.bak-20261012-1450`) via
new `Store.delete_space` (objects incl. its shared layer's, anchors +
bindings, tags, room map, invites, members, shared layer). Likely real
limit found: Quest Browser keeps ≤ 8 persistent anchors per site and we
never deleted any, so leftovers (deleted Spaces, failed restores) could
fill it and new Spaces couldn't persist. Now `world.pruneHeadsetAnchors`
deletes saved anchors no Space here uses at session start; telemetry
`headset anchors {saved, inUse, deleted}`. Note: all Stratum accounts on
one headset share the site's anchors (a second account's would count as
unused).

**main v26 placing fix + tilted palm menu, 2026-10-12:** device report:
with the unbounded space, placing failed ("still locating saved spaces…"
forever). Two fixes: `world.locating` now only holds placing while
anchors restore (≤ 10 s) and for 6 s after (a Space in another room
used to block placing forever, in any reference space); and anchors that
don't resolve against the unbounded space are located through
local-floor (`world.altSpace`; `a.viaAlt`). Telemetry
`anchors after 8 s {anchors, restored, tracked, viaLocalFloor}` tells
which path the Quest needed. Palm menu now tips up 30° off the palm
(pivot: its bottom edge; `PALM_TILT` in ui/menu.js).

**main v25 roam past the boundary, 2026-10-12:** Quest asks for the
optional `unbounded` feature and, when granted, uses an `unbounded`
reference space (`renderer.xr.setReferenceSpace`); otherwise stays on
`local-floor`. Quest menu Settings → "Roam past the boundary" (default
on; `localStorage stratum.unbounded`; applies on re-entering AR; its
note says On / Not available / Exit and re-enter). Quest Browser lists
unbounded as experimental (34.2+); it may need chrome://flags → WebXR
Experiments. Telemetry logs `reference space {unbounded}` per session.
Unverified on device: whether the boundary actually stops showing, and
that saved spaces stay aligned over long walks (anchors should hold).
Tests: `tests/test_roam.py`.

**main v24 place chooser, 2026-10-12:** apps with 2+ variants get one
Place tile (Home row, catalog) that opens a chooser: a card per variant
with a preview and a description; picking one arms it, details come
after placing. Apps draw previews with an optional module export
`preview(THREE, variantKey) → Object3D` (`runtime.preview`). Quest: the
chooser floats 22 mm in front of the menu (page dims), each card with the
live 3D preview hovering and slowly swaying above it; rays/pokes go to
it first. Phone: a dialog with still renders (`ui/preview.js`, one
offscreen renderer, cached). Manifest variants gained `description`.
Home now has variants **Switch / Button / Display** (`config.kind`);
its device picker only offers devices of that kind. Plants export
previews too (the three species). An app's own page still lists its
variants directly. Also: the phone's context bar scrolls instead of
squeezing labels. Tests: `test_home_e2e.py` chooser tests (screens
`home-chooser-{quest,phone}.png`).

**main v23 saved hosts, 2026-10-12:** apps can put their own list on
their menu page: `ctx.menu({ title, empty, items: [{ id, label, sub,
emoji, run, remove }], add: { label, run } })` (null removes it), shown
right under the app's on/off switch on the Quest (5 per page, trash
button per row) and phone (rows with a trash button; tapping a row closes
the sheet). Terminal uses it for **Saved hosts**: per-user list in the
ssh backend (`GET/POST/DELETE /hosts`, 30 max, most recent first); every
successful connect saves the host; "Add host…"; rows show "connected" or
"used 2 h ago". Tapping a host connects the pane you last used if it's
free, else a free pane, else replaces the last one's session (its bar
says "Switched from …"). Fixes: the phone's context bar no longer covers
the open sheet's tabs; Quest menu ray picking tests raised widgets at
their own depth (steep angles missed small buttons).

**main v22 scrolling + copy/paste, 2026-10-12:** one scroll gesture
everywhere (§8.6): phone finger drag (as before), Quest trigger/pinch
drag on content, and the **two-finger hand scroll**. All arrive as the
app's `swipe()`. Clicks on scrollable content now resolve on release
(a click only if it didn't drag; works whatever order the browser fires
select/selectend in). Terminal: 5000 lines of scrollback per pane (pyte
HistoryScreen with absolute line numbers; `screen?scroll=N`), a "lines
back" badge, ⤓ Bottom, typing returns to live; ✂ Select → tap start and
end (or one line) → 📋 Copy; 📋 Paste (also a keyboard chip) with
bracketed paste when the program enables it. **Stratum clipboard**:
`GET/PUT /api/clipboard` (per user, 64 KB, stored in app_state under
`__platform`), `ctx.clipboard.write/read`; read prefers a copy made on
another device in the last 10 min, else the system clipboard, else the
server one. Tests: `tests/test_scroll_copy.py`.

**main v21 SSH terminal, 2026-10-12:** new app `apps/ssh` ("Terminal",
🖥) + backend container `stratum-ssh` (:8006; asyncssh + pyte xterm
emulator). Panes like the browser's: tap the title bar to connect
(`user@host[:port]`, remembered per pane in its config, reconnects on
start), tap the screen for the live keyboard (chips Esc / Tab / sticky
Ctrl / ^C / arrows). Screen = long-polled style runs + cursor drawn into a
canvas texture (themes dark/green/light; sizes 80×24/100×30/120×36).
Auth: a per-user ed25519 key made by the backend (shown in an idle pane;
add it to authorized_keys) or a one-time password prompt (secret field,
never stored). Host keys pinned on first use per user; a changed key
refuses until 🔑 Forget host. Allowlist `SSH_USERS` in `.env` (user
accepted LAN trust with username-only sign-in, 2026-10-12). Sessions
survive looking away (hang up after 4 h unwatched). This machine is
`host.docker.internal` from the container. Also: keyboard
`capitalize` is now opt-in (it was capitalizing hostnames), custom
chip rows (`chips`), `ctx.prompt(label, value, { secret })`, and a fix
for live handles' `open` getter. Tests: `tests/test_ssh.py` with
`tests/fake_sshd.py`.

**main v20 live keyboard, 2026-10-11:** keys can go straight to an
app. `keyboard.openLive()` (Quest) / the phone's live box stream each key
as `{ text }` or `{ key }` (Enter, Backspace, Tab, Escape, arrows; a chip
row has Esc/Tab/arrows, or URL bits for search/url fields). Apps use
`ctx.keyboard.open({ label, kind, secret, onKey, onClose })` →
`{ close(), open }`, `ctx.keyboard.close()`, `ctx.keyboard.onSummon(fn)`.
Phone: edits in the system keyboard are diffed (autocorrect = backspaces
+ text), Done closes. Browser: the backend reports `info.focus`
(`{ kind, label }` of the focused text field, through shadow roots and
iframes) with every info/input reply; a field getting focus brings the
keyboard up (search/url fields get Go + URL chips, password fields echo
dots), focus leaving drops it, ✕ dismisses it until focus moves; keys are
sent one request at a time in order (text merged). **Gesture:** both
index fingers pointing down, tips 18+ cm in front of your head and
10–80 cm below it, for 1.2 s → `runtime.summonKeyboard()` (the selected
instance, else the one last touched, if it registered `onSummon`;
otherwise an empty keyboard that says to tap a pane first). Hands hanging
at your sides don't count. Tests: `tests/test_live_keyboard.py`.

**main v19 Quest keyboard, 2026-10-11:** `client/js/ui/keyboard.js`
(§8.5). `askText()` on the Quest now opens it, so every text prompt
works in the headset: browser URL / Type, Home filter, app text
settings, join code (new row on the Quest Space page), and menu search
(new search button on Apps / Catalog / Layers; live filter, cancel
restores). Tests: `tests/test_keyboard.py` (screens
`test-results/keyboard-*.png`).

**main v18 phone menu v2, 2026-10-11:** the phone sheet now matches
the Quest menu (§8.4): `client/js/ui/phonemenu.js` renders the same
`menuData()` pages and calls the same provider actions as the Quest menu
(plus phone-only bits: room sweep mapping, join by code, per-instance
running rows). Bottom tabs with a sliding indicator, header with back,
search on Apps / Catalog / Layers, chips, tile grids, grouped rows with
switches, segmented / stepper / text controls for app settings. Spring
open, fade close, side-slide page changes; drag the handle up for a tall
sheet, down to shrink or close. Re-renders are skipped when markup is
unchanged and deferred while a finger is down or a field has focus.
Tests: `test_overlay.py::test_sheet_pages_search_app_settings_and_drag`
(screens in `test-results/overlay-sheet-*.png`).

**main v17 menu v2, 2026-10-11:** the §8.3 design, built.
`ui/kit.js`: canvas-faced widgets (glass, row, tile, chip, icon,
primary, header, section, dots, text, card, value) with keyed
reconciliation (`WidgetLayer.render(specs)`: reuse/update/fade out),
exponential-approach motion (position glide, finger lift, fade, toggle
knobs, press flash), own line-icon set, per-size textures. `ui/menu.js`:
tabs Home/Apps/Layers/Space/Settings in a floating pill (12 mm in front;
ray picking tests its own plane), page stack with 2 cm slide
transitions, open/close scale+fade, palm/held/placed modes plus
**Pop out** (×1.8 window in front of you) and Back to hand, fingertip
poke per widget face, pages: Home (selection card + tools + app actions,
Place recents + All, Running here), Apps (category chips, 3×3 paged
grid, running/on badges), App page (on/off, Place, Here, Actions,
Settings, About), Catalog (chips + 3×2 pages), Layers (grouped, paged,
toggles; hidden layers persist in localStorage), Space (members,
invite, share default, room map), Settings (hands, occlusion, menu
size, exit). **App settings**: manifest `settings` schema (toggle /
choice / number / text), validated server-side, `PUT
/api/apps/{id}/settings`, values come with `GET /api/apps`; apps read
`ctx.settings.get/onChange` (plants: time-lapse length, golf:
leaderboard, home: labels, browser: home page + frame rate); the phone
sheet shows them as form controls; text settings are phone-only until
there's a headset keyboard. Manifests got `category` + `color`. The
menu was art-directed from a standalone preview page (straight-on
renders of every page with sample data). 133 passing; one sharing e2e
test was flaky under full-suite load (passes alone; cause not
captured).

**main v8 Quest hand menu, 2026-10-10:** Quest Browser doesn't expose the
≡ menu button to WebXR (reserved for system UI, per the gamepads spec;
IWER's Touch layout ends at thumbrest), so **left Y** toggles a hand menu
(`client/js/ui/handmenu.js`, canvas-drawn): it floats above the left
controller facing the head; the other hand's ray + trigger presses buttons
(hover highlight). Content = phone overlay: status, selected-object edits
(⤓ here / − / + / ⟳ / 🗑 / ✕), running apps' actions, Place (arm one item),
Apps on/off, Exit AR. Quest input now follows the phone rules: trigger on
empty space with nothing armed never creates; grip (hold) grabs and
carries any object (was: delete). If a controller reports more than 7
buttons, telemetry logs it once ("controller buttons"), so a real ≡ button
could be bound later. Reticle is a small blue dot (r 7 mm) everywhere,
plus thin blue pointer rays on Quest. `tests/test_quest.py`. 92 tests.

**main v7 touch model, 2026-10-10:** drags follow the touch's XR
transient input ray (`selectstart` → per-frame `targetRaySpace` → `selectend`),
not rays rebuilt from screen pixels (those didn't match the camera
projection → the jump). App content (pane page/title bar/frame, golf
course) never drags: touches go to the app. Grab handles (instance puck,
pane stand + base) drag immediately; plain objects after a 350 ms hold or
when selected. Overlay blocks the long-press context menu / text selection
(`touch-action: none`, `contextmenu` preventDefault): those cancelled the
touch after ~1 s, and the cancel's (0, 0) position yanked the object up.
DOM pointer events are now only for app swipes. Gesture diagnostics in
telemetry ("drag start/end", "pointercancel"). Emulator: `__touch.start/
move/end/cancel({at | pitchDeg, yawDeg})`. 87 tests.

**main v6 drag = carry, 2026-10-10:** the grabbed point (object-local)
stays under the finger (v5 moved the object's base there, so it jumped by
the grab offset), and the drag updates every frame from the latest finger
position and camera, so holding an object and turning/walking carries it.
It faces the viewer; saved on release. 86 tests.

**main v5 interaction rules, 2026-10-10 (from phone telemetry):**
1. Placement is opt-in: tapping a palette item *arms* it for ONE placement
   (status: "Tap where to put …"); tapping empty space with nothing armed
   never creates anything. (Quest has no palette UI yet: trigger = cube.)
2. Tap an object = select it (edit bar); on app content the app also gets
   the tap (a pane click selects the pane too).
3. Move = press and hold (350 ms) then drag, on anything. Immediate drag
   from grab handles (instance puck, pane title bar/frame) and from a
   selected ordinary object. Content with its own swipe (pane page) keeps
   quick swipes for scrolling even when selected.
Also fixed: proxy truncated large responses (`content.read(n)` = first
chunk) → browser frames didn't decode; failed app starts retried every
frame → 429 storms (now backoff 2 s…60 s); pane cap closes an idle (>15 s)
pane instead of refusing; proxy rate 60/s; browser frames capped ~8/s per
pane; golf physics 120 Hz. 84 tests.

**main v4 fix, 2026-10-10 (from phone telemetry):** nothing placed on the
phone: placement called `e.frame.getViewerPose()` on the tap's event frame,
which Chrome forbids outside requestAnimationFrame (IWER allowed it). Now
uses the last drawn frame's viewer pose. The emulator's fake taps now use a
frame that throws like Chrome's. Also: re-enabling an app resynced the
temporary space from the server (400). 77 tests.
Rule: in input handlers use `e.frame.getPose()` only, never `getViewerPose()`.

**Browser panes, 2026-10-10:** 🌐 Browser app (§6.5) with a Playwright
Chromium backend container (`stratum-browser`, shm 1 GB, mem 3 GB).
Multiple panes = multiple instances (palette → tap; select → 🗑 to delete;
− / + to resize; drag with a finger). 76 tests (`test_browser_backend.py`
with real Chromium against a local test site; `test_browser_e2e.py`: frames
reach the pane texture, tap clicks the page, swipe scrolls it, two panes,
drag saves, delete closes the backend page, temporary space).

**Temporary space, 2026-10-10:** no tag needed to start. A phone tap with
no aligned saved Space creates a session-only *temporary* Space (origin =
this session's world origin, never sent to the server, cleared on exit or
reload). Saved tag Spaces always win for new placements; "Create space
here" still appears when a tag is seen. Apps see
`ctx.instance.temporary`; fishtank passes `?temp=1` and its backend
expires unseen temporary tanks after `FISH_TEMP_TTL_S` (1 h). 67 tests.

**App platform v1 (main v3), 2026-10-10:** see §6. Golf and fish tank
apps with real backends in their own containers (`stratum-golf`,
`stratum-fishtank`, compose, secrets in `.env`). Tests: `test_apps_api.py`
(registry, toggle, signed proxy, broadcast/channel ACL, state, static
jail), `apps/<id>/tests/test_<id>_backend.py` (courses/leaderboard, hunger → death,
feeding, restock, persistence), `test_apps_e2e.py` (golf: instance in app
layer, putt → sink → score → next hole, swipe putts without placing
objects, off/on; fishtank: fish from server, moving, feeding on one device
reaches another). 64 tests passing. Not yet run on the phone.

**Tags (M1b first slice), probe v8:** `js/vision/` = `camera.js` (camera-
access feed: preview + downscaled captures, row 0 = top), `tag-worker.js`
(js-aruco2 AprilTag 36h11 in a Worker; tries the flipped image when
nothing decodes and keeps whichever works), `pose.js` (homography → R,t;
CV↔GL frames; gravity alignment: flat tags take yaw from the tag's x axis,
wall tags from the normal), `tags.js` (TagTracker: world poses, 1.5 s
smoothing with outlier rejection). Probe draws a green outline (raw pose)
and a gold cube (smoothed, gravity-aligned) on each tag; `?tag=<mm>` sets
size. Printable tags at `/tags` (same dictionary as the detector).
`?emulate=phone` is now mono with a fake camera that draws real tags
(`window.__fakeCamera`); `tests/test_tags.py` checks pose math, world
position, upside-down textures, corner order, two tags. 31 tests passing.
Not yet run on the phone.

**2026-10-08: M0 scaffold written.** Server API smoke-tested (login, spaces,
objects, ACL denials, WS push, tombstone deltas, HTTPS). Client JS
syntax-checked only: **not yet run on the Quest.**
M0 goal: tap a surface → a cube appears → exit AR, re-enter (or reload) →
the cube is still in the same physical spot. That proves the one thing the
previous attempt didn't: world locking via persistent anchors.

M1a probe page added at `/probe` (`client/probe.html`, `client/js/probe.js`):
passthrough AR, trigger drops a spinning random-color cube at the controller,
and it opens the camera *inside* the AR session, reporting device labels,
resolution and camera fps vs XR fps on a panel with a live preview. Served
fine; not yet run on the Quest.
Phone placement: tap places a cube on the surface under a screen-center
reticle (hit-test), or 40 cm ahead without one; every tap and script error
is logged on the overlay. `?emulate=phone` (Android identity + fake screen
taps) covers the phone path in tests. Hit-test setup no longer blocks
session start (it previously awaited before wiring input and rendering).
Telemetry added (§11): device errors and probe logs reach the server.
**Phone telemetry 2026-10-08 (probe v5):** taps work (17 taps → 17 cubes
created); camera-access 27 fps; XR 86 fps. Hit-test found a surface only
once in 20 s, so every cube went to the 40 cm fallback. Open question: are
the created cubes *visible*? probe v6 adds an on-device render check
(reads back framebuffer pixels at the view center and at the newest cube)
and hit-test hit-rate stats.
**probe v6 phone result → root cause found:** Chrome Android renders via the
WebXR Layers API (no `baseLayer`). The camera-access GPU copy called
`renderer.resetState()`, which also clears three's current render target,
so everything drew into the hidden page canvas, not the AR view. Fix in v7:
`withRawGL()` restores the target; camera copy runs after rendering; an
on-device check logs an error if the target is ever lost. `?emulate=phone`
now fakes camera-access too, and a regression test fails without the fix.
Hit-test on the phone: surface in 27/303 frames; cubes #4–5 placed on a
surface. Rule for the codebase: any raw GL must go through `withRawGL()`.
24 tests passing. Probe shows a version stamp (`PROBE_VERSION`) so stale cached code is
visible. 17 tests passing.
Automated tests added (`./test.sh`, 13 passing): API + probe under an
emulated Quest 3. Android tap bug fixed: the DOM-overlay root is
fullscreen, and cancelling `beforexrselect` on it swallowed every tap;
now only the bottom box cancels (regression test included).
Probe also supports Android Chrome (ARCore): requests WebXR `camera-access`
there (pose-aligned frames + intrinsics from the projection matrix, logged
on the panel), uses a DOM overlay, and a tap spawns a cube 40 cm ahead.
Phones are a second device class: same server and same Spaces, aligned by
the same markers (M1c). The M0 main page still handles controller input only.
**2026-10-08 Android result:** camera-access works inside immersive-ar
(Chrome, ARCore). Image 855×1920 portrait (screen-cropped view, not full
sensor), fx≈fy≈1370 px, principal point at center. Quest probe still pending.

Next: run M0 on the Quest (see §11), fix whatever breaks, then M1a (camera
probe). 2026-10-08 decision: printed markers + headset camera are the
primary alignment source (§3.6–3.7); anchors are a cache.

---

## 1. Goals and non-goals

**North star (user, 2026-10-12): a global metaverse.** One shared world,
not a set of private rooms. Printed tags indoors are a temporary,
local reference. Over time tags should form *closures* with the world:
each tag tied (directly or through a chain of other tags/anchors) to a
true global frame, so every Space has a place on Earth and Spaces
anywhere line up with each other. Google's Geospatial API (VPS, Earth
anchors) is the likely global source; it may even mint "custom tags"
indoors (a tag's Earth pose recorded once from where VPS works, e.g. by a
window or doorway, then carried inside). A dedicated app may be built
later just to form those closures (walk a chain from outdoors to each
tag). Platform outlook: the Quest is weak outdoors (and has no
Geospatial); Android XR in ~5 years may be the ideal device. Design
choices now should keep that path open: Space frames that can gain a
global pose later, tag poses stored so they can be re-expressed in a
global frame, no assumptions that a Space is only ever local.

Goals
- World-locked content that stays put across sessions and (later) devices.
- Rich objects: static or animated, static or live textures (video screens),
  static or physical/interactive.
- Visibility tiers: private, shared with a group, global.
- Apps as toggleable layers (e.g. a bug-catching game you turn on for a walk).
- Scales in data volume, user count, and content density without a rewrite.
  Every v1 shortcut sits behind an interface with a named replacement (§9).

Non-goals (for now)
- Real auth. A username cookie identifies you. The **ACL model is real from
  day one**; only identity is fake. Swapping in real auth must not change
  any permission logic.
- Server-side physics.
- Running untrusted third-party app code (apps are trusted modules until §6.3
  sandboxing exists).

---

## 2. Concepts (glossary)

| Term | What it is |
|---|---|
| **User** | Identified by a username cookie (v1). |
| **Space** | A rigid local coordinate frame tied to a physical place: "kitchen", "backyard". Y is up (gravity), meters. All persistent object poses are expressed in a Space. |
| **Anchor** | A known pose *inside* a Space that devices can physically find again. |
| **Binding** | "On device D, Anchor A = Quest persistent anchor handle H." Per device. Device-local, never shared. A cache, never the truth. |
| **Marker** | A printed fiducial (AprilTag/ArUco id + physical size) with an *estimated* pose in a Space. Shared by every device and user. May be moved or removed. |
| **Observation** | One measurement linking a device's world frame to a Space: a marker detection, an anchor restore, a dock press. Has a timestamp and an uncertainty. |
| **Layer** | A named bag of objects with one ACL. Private stuff, shared stuff, global stuff and apps are all layers. You toggle layers on/off. |
| **Object** | An entity: id, Space, Layer, pose, plus a dictionary of components (mesh, material, animation, physics, interaction...). |
| **Asset** | Immutable binary (glTF, texture, audio, video), addressed by content hash. |
| **App** | Code + one or more Layers it owns. Turning an app off = hiding its layers and stopping its code. |

The two load-bearing decisions:
1. **Objects never reference device anchors or markers. Objects live in
   Spaces; devices *estimate* where each Space is** from whatever
   observations they have (markers seen by the camera, restored anchors,
   dock presses). The estimate improves and corrects over time, and objects
   may visibly shift when it does. No single reference is trusted: markers
   get moved, anchors get wiped.
2. **ACL lives on Layers, not objects.** "Private / shared / global" is just
   the kind of layer an object is in. Apps are layers too, so toggling a
   game and toggling "my private stuff" is the same mechanism.

---

## 3. Coordinates and world locking (the hard part)

### 3.1 Frame hierarchy

```
Geo (WGS84 lat/lon/alt + heading)        optional, coarse, for discovery only
 └─ Space  (rigid frame, meters, Y up)    e.g. "Living room"
     ├─ Markers   (estimated poses in Space frame, revisioned, shared)
     ├─ Anchors   (poses in Space frame)
     │    └─ Bindings  (per device: Quest persistent-anchor handle; a cache)
     └─ Objects   (poses in Space frame)
```

Rendering: the alignment estimator (§3.6) produces the Space origin in the
headset's current world from every observation it has:

```
SpaceOrigin_world = Estimator(marker detections, anchor restores, dock presses)
Object_world      = SpaceOrigin_world × ObjectPose_inSpace
```

In Three.js this is literally a `Group` (matrix = SpaceOrigin_world) with
objects as children. No per-object math, and a correction moves everything
in the Space at once.

M0 shortcut: the estimator is "use the single anchor" (`world.js` gives
each anchor its own Group). M1 replaces that with one Group per Space
driven by the estimator.

### 3.2 Quest constraints that shape this

- Quest Browser supports `frame.createAnchor()`, `anchor.requestPersistentHandle()`,
  `session.restorePersistentAnchor(handle)`. Restore must be called every session.
- **A site may hold only 8 persistent anchors.** Anchors are scarce. Rule:
  one persistent anchor per Space per device, and an LRU budget manager that
  frees the least-recently-used Space's anchor when the 8th slot is needed
  (that Space then needs re-calibration on next visit, §3.4).
- Persistent anchors die if site data is cleared or in private browsing.
  The server-side Binding is then stale; client detects restore failure and
  drops the binding.
- Persistent anchors are device-local. WebXR has no shared/cloud anchors.
  Cross-device alignment must come from somewhere else (§3.4).
- No GPS on the headset. Browser geolocation is Wi-Fi based (tens of meters
  at best). Geo is for "which Spaces are near me", never for placement.
- The WebXR `camera-access` feature is rejected in Quest Browser
  `immersive-ar`. The passthrough cameras are reportedly exposed through plain
  `getUserMedia` (possibly behind the "Experimental web platform features"
  flag), **without** intrinsics, camera-to-head extrinsics, or frame
  timestamps tied to XR poses. §3.7 covers how we recover those.
  **Unverified on the 3S: first thing M1 tests.**

### 3.3 Reference density within a Space

Tracking error grows with distance from the reference. Big Spaces (a whole
floor, a yard) want several markers spread out; the estimator weights
observations by distance to the content being rendered (later: per-region
sub-fits, so the far end of the house is aligned by the markers near it).
Because of the 8-persistent-anchor cap, extra anchors are **session
anchors** (non-persistent, unlimited), dropped near object clusters after a
good fix to hold alignment between marker sightings.

### 3.4 Observation sources (all feed one estimator, §3.6)

Not a chain where the first success wins. Every source produces
Observations, and the estimator fuses whatever is available:

| Source | Gives | Quality | Availability |
|---|---|---|---|
| **Camera marker detection** (primary) | full 6DoF of a marker, ~2–5 Hz | ~1 cm / ~1° per detection at 1–2 m, better when averaged | whenever a marker is in view |
| **Persistent anchor restore** | Space pose via stored offset | good locally, but can be wiped or silently relocalize wrong | per device, ≤ 8 per site |
| **Dock / touch** | controller resting in a printed outline or 3D-printed cradle = exact marker pose | ~mm | manual fallback, and for calibrating the camera (§3.7) |
| **Room geometry** (later) | floor height + wall yaw | good yaw/height, weak along walls | per device room setup |

Bootstrapping a new Space: print a sheet of markers, put them up, look
around. The first marker seen becomes the Space origin (gravity-aligned:
only its yaw is kept). Every other marker's Space pose is learned from
frames where it's seen together with already-known markers.

### 3.5 Lock modes

Not everything needs centimeter world lock. Each object has a lock mode:

| Mode | Meaning | Example |
|---|---|---|
| `space` | Pose in a Space frame. Persistent. Default. | TV screen on your wall |
| `geo` | Lat/lon ± accuracy. Shown only when coarse is fine. | "Pizza place this way" marker |
| `local` | Ephemeral, in the current session's frame, never persisted. | Bugs spawned around you by a game |

The bug game mostly uses `local` objects spawned around you as you walk,
so it doesn't need anchors at all outdoors.

### 3.6 Markers and the alignment estimator

The estimator's output is one transform per Space per device:
`T_world←space` (+ uncertainty). The Space's root `Group` matrix is that
transform; objects follow automatically.

**4 DoF, not 6.** WebXR's world frame and every Space share gravity, so the
unknowns are yaw + translation. Marker pitch/roll (the noisiest part of a
single-camera pose) are dropped. A yaw error is what pushes far objects
off (1° ≈ 17 cm at 10 m), so yaw comes preferably from the *baseline
between two markers*, not from one marker's orientation.

**Robust fit.** Each update fits `T_world←space` to all recent
observations, weighted by uncertainty and recency, with RANSAC-style
outlier rejection: a marker whose observation disagrees with the consensus
of the others is flagged *suspect* and excluded.

**Moved / removed markers.**
- *Removed:* simply never observed again. Its stored pose ages; the server
  retires it after it hasn't been seen for a long time by anyone.
- *Moved:* it disagrees with the consensus. If it disagrees consistently,
  across several observations and ideally more than one device, its Space
  pose is re-estimated and saved as a new marker revision. A moved marker
  can never drag the Space: re-estimation requires ≥ 2 other agreeing
  references (markers or an anchor). With only one reference visible, the
  device trusts it but marks the fix low-confidence.
- Same rule for anchors: an anchor that restores far from the marker
  consensus is dropped and recreated.

**Map refinement (server).** Devices upload marker-to-marker relative
observations (`marker A seen at X relative to marker B`). The server
periodically re-solves all marker poses in the Space (small least-squares
pose graph, Python/NumPy) and bumps a `markers_rev`. Clients pick up the
refined map; each user's walk-around makes it better for everyone.

**Applying corrections without nausea.**
- Big correction (first fix, or > ~20 cm): apply immediately, with a short
  fade so it doesn't look like a jump.
- Small correction: blend over ~0.5–1 s, preferably while the head is
  rotating (shifts are much less visible during head motion).
- Objects near the user while being held/interacted with are pinned until
  released.

**Persistent anchors become a cache.** After a good marker fix, the device
(re)creates a persistent anchor for the Space and stores the offset. Next
session it gets an instant approximate fix before any marker is seen, and
the marker fix then corrects it.

### 3.7 Camera pipeline (Quest Browser)

```
getUserMedia (one passthrough cam, low res e.g. 640×480)
  → MediaStreamTrackProcessor → VideoFrame → Worker
  → grayscale → AprilTag 36h11 detector (WASM)        ← corners per tag
  → solvePnP with per-device intrinsics + distortion   ← marker pose in camera frame
  → × camera-to-head extrinsic × head pose at capture time (from WebXR pose history)
  → Observation (marker pose in world, uncertainty from reprojection error + distance + angle)
```

- **Tag family:** AprilTag 36h11 over plain ArUco: fewer false positives and
  more robust at low resolution. Detector runs in a Worker so it never
  costs the render loop; target 2–5 Hz, idling to ~0.5 Hz once aligned.
- **Intrinsics:** not exposed. One-time calibration per headset with a
  printed ChArUco board (stored per device id). The 3S cameras are
  identical hardware, so a factory default per model may be good enough.
- **Extrinsics (camera → head):** not exposed. Solved by hand-eye
  calibration: look at a fixed marker from many angles; head poses come
  from WebXR, camera-to-marker from detections → solve AX = XB. Same
  calibration session as intrinsics. The dock (controller-held marker
  pose) gives ground truth to check it.
- **Timing:** frames have no XR timestamp. Keep a ring buffer of head poses
  and estimate the capture latency once (correlate head rotation with tag
  motion in the image). Also gate: only accept detections while head
  angular velocity is low.
- **Markers carry meaning:** printed sheet = a few AprilTags + a QR code
  holding the server URL + Space id (a join link for guests, and an
  invite if access control requires it).

Risk to verify before building this: `getUserMedia` works *during* an
`immersive-ar` session on the 3S, at a usable frame rate, without
breaking passthrough. If it doesn't, the dock + anchors + room geometry
still work; markers then only serve as dock targets.

---

### 3.8 Room map (2026-10-11)
A Space's real surfaces, so wall items hang flat, apps know where walls
and tables are (Home Assistant switches, sticky notes, night outline), and
one device's mapping serves every device and member.
- **Stored** per Space in the Space frame (`surfaces` table): `kind`
  (wall/floor/ceiling/table/shelf/door/window/other), `pose` (plane frame,
  local +Y = normal), `polygon` (outline in the plane's XZ), `source`.
  API: `GET /api/spaces/{id}/surfaces`, `PUT …/surfaces/{sid}`, `POST
  …/surfaces/replace {source, surfaces}`, `DELETE …/surfaces[?id=]`;
  members only; changes push `{"t":"surfaces"}` → clients refetch.
- **Phone: sweep.** "🧱 Map this room" (menu → Space). While on, every
  80 ms the reticle's hit pose (y = normal) is classified by normal and
  height above the local-floor (floor < 0.2 m, table < 1.4, shelf, wall,
  ceiling; slanted skipped) and merged into a same-kind plane within 12°
  and 4 cm (walls reach 3 m, floors/ceilings always merge at one height,
  tables 25 cm), else starts a new one. Outlines are growing rectangles;
  walls get floor-to-2.4 m height at once. Saved (≥ 6 samples, debounced)
  as `source: phone`. Needs a saved Space (aligned by a tag). Whether
  Chrome/ARCore hit-tests vertical planes on the user's phone is unverified.
- **Quest: import.** "🧱 Import room scan" (hand menu → Space) reads WebXR
  `detectedPlanes` (Space Setup) with semantic labels and replaces the
  Space's `source: quest` surfaces. No scan → asks the system to run room
  capture (`initiateRoomCapture`).
- **Use:** palette items with `mount: 'wall'` (pictures, videos, apps whose
  manifest says `"mount": "wall"`) hang flat on the nearest wall along the
  aim ray (mapped wall, or the hit itself when it is vertical), facing
  out, centered on the aim point. Apps: `ctx.surfaces()` (instance frame).
  "▦ Show room map" draws faint colored outlines.
- **Tests:** the emulator takes `window.__fakeRoom = {planes: [...]}`, a
  tiny stand-in for IWER's synthetic environment (hit tests + detected
  planes); `tests/test_roommap_api.py`, `tests/test_roommap_e2e.py`.

### 3.9 Tags on the Quest (headset camera)

Why: printed tags are the only reference both devices see, so a Space made
at a tag lines up on the phone and the headset (anchors are per device,
and capped at 8 per site on the Quest).

The Quest Browser has no WebXR camera-access, but getUserMedia gives the
passthrough camera (site permission "Headset cameras") and keeps running
in immersive-ar. It comes with no intrinsics, no pose relative to the
head, and no exact timestamps, so the Quest calibrates once per headset:
look at one printed tag ~50 cm away and move your head slowly (30+ views,
12°+ of turning). The solver fits corner reprojections for lens (f, cx,
cy), head → camera transform, the tag's pose, and the frame latency. A
capture's camera pose = head pose at (frame time − latency) × head →
camera; its K = the calibrated lens. From there the Quest uses the same
TagTracker → World alignment as the phone (tags align Spaces; new tags
join aligned Spaces; "Create a space at tag N").

Open: real-device accuracy (which camera, lens distortion is not
modelled), and whether the browser gives `captureTime` in
requestVideoFrameCallback metadata (else latency is estimated).

### 3.10 Living world map (2026-10-13; phases 1, 2, 5-ICP built in v35)
Status: built in main v35 (see §0): background capture, voxel fusion,
merged surfaces, change events, per-session ICP corrections, rebuild.
Deferred: phase 3 (`ctx.world` for apps), phase 4 (mesh products), LiDAR
companion, Space-to-Space closures, server-side RTAB-Map.

User's direction: Stratum extends reality, so it must react to reality. Every
device, every user, every session adds to one map per Space that gets more
complete and more correct over time, RTAB-Map style, and apps can see the
map change (a cup put on the counter → golf's ball bounces off it). Not built
yet; this is the plan.

**Layers (by how fast reality changes there):**
1. *Structure*: walls, floor, ceiling. Planes. Rarely change; high
   confidence after a few sightings.
2. *Furniture*: tables, counters, couches, beds, shelves. Planes plus boxes
   (or mesh). Change rarely (moved furniture).
3. *Clutter*: cups, bags, boxes on the counter. Sparse voxels (2–5 cm).
   Change daily; remembered until there's evidence they're gone.
4. *Live*: people, hands, a ball you're holding. Never stored; live depth
   only, this session.

**Map = graph of observations + fused products (RTAB-Map's idea, our
anchors):**
- Nodes are *keyframes*: a pose in the Space frame, a downsampled depth
  image (and optionally gray image), time, device, user, alignment quality
  (tag distance, calibration rms, roaming or not). Spaces/tags are the loop
  closures; the global-metaverse closures (§1) are the same thing one level up.
- The server fuses keyframes into products: a sparse voxel occupancy map
  (log-odds, chunked per 1 m³, ray carving so seen-through space clears old
  voxels), and planes (device planes + planes fit to voxels, merged).
- Every element keeps evidence: count, first/last seen, sources, and a
  decay rate per layer (structure ~never, clutter ~days).
- Map-to-map registration (ICP of a new session's depth against the map)
  refines that session's tag alignment: the map itself becomes a localizer,
  which is what makes merging many users' data sharp instead of blurry.
  Weight each user's observations by their alignment quality.

**Merging planes (first step, also the cheap one):** same kind, normals
within ~10°, offset within ~3 cm, overlapping or touching → one plane:
evidence-weighted pose, unioned outline, Quest room-scan > depth fit >
phone hit samples. Conflicts are resolved by evidence and recency, never by
"last writer wins".

**Sources by device:**
- Quest 3: Space Setup planes + boxes + mesh (`plane-detection`,
  `mesh-detection`), live `depth-sensing`, our headset camera (§3.9).
- Android: ARCore depth (coarse, live), hit tests, planes (Chrome flag).
- iPhone LiDAR: best depth of the three, but no WebXR on iOS; needs a
  native companion (not now).
- Later: server-side RTAB-Map itself on uploaded RGB-D keyframes (the
  device poses are its odometry); runs on the home server, frames never
  leave the LAN.

**Capture in the background:** same scheduler idea as the headset camera
(§3.9, v34): a keyframe when you've moved/turned enough and are steady,
rarely otherwise. Downsample and compress in a worker; upload in the
background. Gray images are optional and stay on the home server
(privacy: depth by default).

**What apps get (`ctx.world`):**
- `surfaces()` (exists), `occupancy(bounds)` (voxels / heightfield),
  `colliders(bounds)` (simplified boxes/hulls ready for Rapier),
  `on('change', region, fn)` (something appeared / moved / disappeared).
- Live and stored together: live depth gives the cup a collider right away
  this session; the stored map remembers it next session until it's seen
  gone.
- Apps choose: ignore, react (golf adds the collider), or warn ("the table
  isn't clear").

**Phases:** (1) background Quest import + phone hit samples + more kinds +
cross-user plane merge (§0 plan of 2026-10-13); (2) depth keyframes →
server voxel fusion with decay + change events; (3) `ctx.world` API, golf
uses colliders; (4) mesh products: night outline, persistent occlusion
(fixes phone occlusion), (5) ICP refinement, RTAB-Map server, LiDAR
companion, Space-to-Space closures.

**Unknowns:** Quest Browser depth access from JS (GPU-only would mean a
GPU readback step); tag alignment error across devices (bounds map
sharpness until ICP); Quest planes under unbounded; storage growth per Space.

## 4. Object model

JSON entity with open-ended components. Unknown components are ignored by
clients (forward compatible: old clients render what they understand).

```json
{
  "id": "0192f1c4-...-uuidv7",
  "space": "<space id>",
  "layer": "<layer id>",
  "pose": {"p": [x, y, z], "q": [x, y, z, w], "s": [1, 1, 1]},
  "rev": 1834,
  "components": {
    "mesh":      {"primitive": "box", "size": [0.15, 0.15, 0.15]}
              |  {"asset": "sha256:…", "lods": ["sha256:…", "sha256:…"]},
    "material":  {"color": "#ff8800",
                  "texture": {"kind": "image",  "asset": "sha256:…"}
                          |  {"kind": "video",  "url": "…", "startedAt": 1730000000000, "loop": true}
                          |  {"kind": "stream", "url": "…(HLS/WebRTC)"}
                          |  {"kind": "app",    "app": "<app id>", "slot": "screen"}},
    "animation": {"clip": "idle", "startedAt": 1730000000000, "speed": 1, "loop": true}
              |  {"kind": "spin", "rpm": 10, "startedAt": 1730000000000},
    "physics":   {"body": "static|kinematic|dynamic", "shape": "box|convex|mesh", "mass": 1},
    "interact":  {"grab": true, "onSelect": "app:<app id>#handler"}
  }
}
```

Rules:
- **IDs are UUIDv7, generated by the client.** Lets clients create objects
  offline/optimistically, and IDs sort by creation time.
- **Animation and video are time-based, not streamed.** The server stores
  `startedAt` (server clock); every client computes the current frame from
  `serverNow - startedAt`. Zero network cost per frame, everyone in sync.
  Clients learn the clock offset from the WebSocket `hello`.
- **Cold vs hot data.** The JSON above is *cold*: changes rarely, versioned
  by `rev`, persisted, cacheable. Per-frame stuff (an object being carried,
  a ball in flight) is *hot*: relayed over the WebSocket, never written to
  the DB per tick; the final pose is written once when it settles.
- **Physics authority.** No server physics. Whoever is interacting with a
  dynamic object takes an ownership lease, simulates it locally (Rapier
  WASM, later), and broadcasts state at ~15 Hz; others interpolate. Static
  bodies never sync. Lease expires if the owner goes quiet.

---

## 5. Visibility: layers and ACLs

```
layer:  id, name, owner, kind ∈ {personal, shared, public, app}, app_id?
layer_members: (layer, user, role ∈ {viewer, editor, admin})
```

- **Personal**: auto-created per user. Only you.
- **Shared**: members list = the "subset of users".
- **Public**: everyone can view. ("World", created at startup.)
- **App**: owned by an app; visibility per app manifest.

To see an object you need **both**: access to its Space (spaces have their
own member list, because a Space pinpoints e.g. your house) **and** view
access to its Layer. All checks happen on the server, including what the
WebSocket fans out.

Layer toggling is a client subscription filter (plus a synced preference).
Hidden layers aren't downloaded, not just not drawn: this is what keeps
dense areas cheap.

**Open:** should one object appear in several layers? Current answer: no,
one layer per object; copy or move instead. Keeps ACL resolution a single join.

### 5.1 Sharing a Space (shared state v1, 2026-10-11)
- **Every Space has one shared layer** (`layers.kind='shared'`,
  `layers.space_id`), created with the Space (or lazily on the next
  `GET /api/spaces` for older Spaces). Its members are exactly the
  Space's members: owner admin, others editor. `GET /api/spaces` returns
  `owner`, `sharedLayer`, `members` (names).
- **Invites:** any member `POST /api/spaces/{id}/invite` → 6-char code
  (no 0/O/1/I/L), valid 24 h, reusable. `POST /api/join {code}` adds the
  user to `space_members` + the shared layer. Link form: `/?join=CODE`
  (joins after sign-in, then cleans the URL). Refused (409) when one of
  the Space's tags is already one of the joiner's own Spaces (a tag names
  one Space per user). `POST /api/spaces/{id}/leave` (not the owner).
  Membership changes push `{"t":"members"}` to the Space's subscribers →
  clients `world.refreshSpaces()`.
- **Placement:** new things go in the Space's shared layer by default
  ("Share new things" switch, `localStorage stratum.placeShared`); off →
  personal layer (apps: their private app layer). Temporary spaces are
  always local. Selected objects get a 👥 Shared / 🔒 Private button
  (`world.setLayer`); moving an object out of a layer pushes a tombstone to
  that layer's viewers, so it disappears for them.
- **Apps in shared layers:** an app's instances hide/stop by app id
  (`world.hiddenApps`), not only by its app layer. Backends already key
  state by instance id, so plants/fish are the same plant/tank for
  everyone; scores stay per pseudonym.
- **Presence** (`client/js/presence.js`): each device sends its head pose
  in the Space frame (`{"t":"pose"}`, 5 Hz, only for aligned Spaces with
  ≥ 2 members); the hub relays it to the Space's other subscribers
  (droppable) with the sender's name and connection id; leaving sends
  `gone`. Others render as a soft colored head + visor + "📱/🥽 name" tag,
  parented to the Space root (world-locked like objects), eased toward
  the latest pose, dropped after 5 s of silence.
- **Live drags** (2026-10-11): while dragging, the client sends `{"t":
  "move", id, space, layer, pose}` at ~15 Hz; the hub relays it (droppable)
  to the Space's subscribers who can see that layer; receivers ease the
  object toward it (`world.remoteMove`, 80 ms smoothing), ignore it for an
  object they are dragging themselves, and settle on the saved pose when
  the PUT on release arrives (or after 1.5 s of silence).
- **Not yet:** leave/members UI beyond the list, roles other than editor,
  conflict handling when two people drag one object (last save wins).

---

## 6. Apps

Implemented (v1, 2026-10-10). An app = **manifest + client module +
optional backend**, in `apps/<id>/`:

```
apps/<id>/manifest.json    id, name, icon, description, entry, permissions, backend
apps/<id>/client/*.js      served at /apps/<id>/ (only this folder is served)
apps/<id>/backend/         its own service + Dockerfile (uses sdk/stratum_backend.py)
```

### 6.1 Instances, layers, on/off
- An app runs per **instance**: an object in a Space with
  `components.app = { app, config }`, placed from the palette like any
  object. It saves, aligns (tags/anchors), moves/rotates/resizes like any
  object; a small grey puck is its handle.
- Each (user, app) gets a private **app layer** (`layers.kind='app'`) on
  first enable; instances live there. Turning an app off (`PUT
  /api/apps/<id>`) hides that layer, stops its code, closes its channels.
  Sharing an instance later = adding members to the layer.
- Apps run concurrently; the runtime calls every running instance's
  `frame()` each XR frame, times it (warns over 4 ms avg via telemetry),
  and stops an instance after 5 frame errors.

### 6.2 Client API (`client/js/apps/runtime.js`)
```js
export default {
  async start(ctx) {}, frame(ctx, dt) {}, select(ctx, hit) {},
  swipe(ctx, { phase: 'move'|'end', dx, dy, w, h, ms }) {}, wantsSwipe(ctx) {},
  async stop(ctx) {},
};
```
`ctx`: `app`, `instance {id, config, space}`, `root` (Group in the
instance frame: y up, meters), `THREE`, `now()` (server clock),
`viewer()`, `toLocal(v)`, `toLocalDir(v)`, `surface()`, `status(text)`,
`actions([{label, run}])` (overlay buttons), `log()`, `spawn(obj3d)`,
`physics()` → initialized Rapier (`physics` permission),
`backend.get/post(path)`, `channel(name, onMsg) → { send }`,
`state.get/set(key)` (`state` permission). Taps on app content go to
`select`; screen swipes go to `swipe` (and suppress the touch's XR select).
v1 runs trusted modules in the page; the Worker sandbox (§6.6) keeps `ctx`.

### 6.3 Outside connections: the proxy
`/apps/<id>/api/<path>` → the app's backend (`manifest.backend`, or env
`STRATUM_APP_BACKEND_<ID>`). Stratum checks the app is on and has
`backend`, rate-limits (20/s, burst 40 per user/app), caps bodies at 1 MB,
never forwards cookies, and adds signed identity:

```
X-Stratum-App, X-Stratum-User (HMAC pseudonym per app+user, stable),
X-Stratum-Name (username, only with 'identity'), X-Stratum-Time (ms),
X-Stratum-Signature = HMAC-SHA256(app secret, app\nuser\nname\ntime\nmethod\npath?query)
```
Backends verify with `sdk/stratum_backend.py` (60 s skew). Secrets:
`.env` (generated, not in git) → `STRATUM_APP_SECRET_<ID>` for Stratum and
`STRATUM_APP_SECRET` for the backend. Backends have no published ports.
Scale path: short-lived signed tokens + direct connections, same `ctx`.

### 6.4 Live channels
Per-instance rooms, key `app:<app>:<channel>`. Clients join through the
WebSocket (`appsub`, only for apps they have on, needs `channel`) and relay
to each other (`app` messages, droppable, sender shown as pseudonym).
Backends push with `POST /api/apps/<id>/broadcast` (`Authorization: Bearer
<app secret>`, body `{channel, msg}`) → SDK `stratum.broadcast()`.
Durable world writes by backends (app service account) are not built yet;
v1 apps keep their own durable state in their backend.

**Hosts and shared state (`ctx.sync`, 2026-10-11).** The hub keeps each
room's members in join order; the first is the room's **host**. Every
membership change sends `{"t":"host", app, channel, host: <conn id>,
peers}` to the room (`hello` now carries `you` = the connection id).
`ctx.sync({onState, onEvent, onHost})` gives an instance a room
`sync-<instance id>`: the host runs the simulation and `room.state(s)`
broadcasts snapshots; anyone's `room.event(e)` reaches every member,
the sender included (locally, at once). Messages carry `by` = sender
connection id (`ctx.me()`). A lone device assumes it hosts until told
otherwise, so single player never waits. When the host leaves, the next
member is promoted and continues from the last snapshot it got. Rooms
are per connection: two tabs of one user are two members.

### 6.5 Shipped apps
- **golf** is shared play since 2026-10-11 (`ctx.sync`): the host
  simulates the one ball and streams snapshots (15 Hz rolling, 1 Hz at
  rest); anyone putts while it rests (a `putt` event the host applies);
  `sunk` → the last putter posts the score; the host moves everyone to the
  next hole (`hole` event). Status shows "N playing".
- **golf** (`⛳ Mini Golf`): backend = 3 tabletop courses + leaderboard
  (SQLite, best per pseudonym). Client builds the course, Rapier ball
  (r 9 mm, CCD, damping), swipe to putt with an aim line (tap the ball =
  medium putt), sinks under 0.35 m/s within 16 mm, out of bounds = +1,
  posts scores, shows a leaderboard panel, announces "sunk" on its channel,
  remembers the hole (`state`).
- **fishtank** (`🐠 Fish Tank`): backend simulates every tank continuously
  (hunger rises over `FISH_HUNGER_HOURS`, starving fish die, plans refresh),
  persists to JSON, and sends **swim plans** (closed Catmull-Rom loop +
  `t0` + period) instead of positions. Client animates fish from
  `ctx.now()`, sways plants, taps on the water feed (`POST
  /tanks/<id>/feed` → backend redirects fish to the food and broadcasts
  `fed` to everyone), hungry fish grey out, dead ones float; Restock action.

- **browser** (`🌐 Browser`): WebXR can't draw web pages into 3D, so each
  pane is a page in **remote Chromium** (Playwright) on the backend. CDP
  screencast → JPEG frames only when the page changes; the client long-polls
  `GET /panes/<id>/frame?after=<seq>` (8 s, seq in `X-App-Seq`, which the
  proxy now passes through as `X-App-*`) into a texture; taps → `click` at
  the hit UV, swipes on the pane → `scroll`, overlay buttons → URL / Type
  (`ctx.prompt`, phones) / Enter / Back / Reload. One browser context per
  player pseudonym (cookies saved under `data/apps/browser/profiles`), ≤ 6
  open panes each, idle pages close after 5 min and reopen at their last
  URL, popups open in the same pane, only http(s). Deleting a pane closes
  its page right away (`stop(ctx, { removed: true })`). **Security:**
  pages load from the server's network (LAN included), and sign-in is still
  username-only, so anyone on the network who opens Stratum can browse from
  this server.
- **plants** (`🪴 Plants`, v1 2026-10-11): manifest **variants** (new: one
  Place tile per variant, each with its own `config`) = succulent, snake
  plant, pothos. Backend keeps each plant's life (`growth`, soil
  `moisture`, `health`, `alive`) and advances it lazily from elapsed time
  in 1 h steps: soil dries over `dry_hours`, dry plants lose health over
  `wilt_hours` and die at 0, soggy soil (> 1.0) hurts slowly, wet plants
  grow toward 1.0 over `grow_days` (scaled by health). Planted at 0.15.
  `PLANTS_TIME_SCALE` speeds time. Client grows the plant procedurally
  from (growth, wilt, seed = instance id + planted): custom leaf geometry
  (bend, V-fold, twist, puffy thickness, heart notch), canvas textures
  (terracotta, soil with perlite, snake bands + yellow margins,
  variegated pothos), merged per material; pothos vines trail over the
  rim and spread across the table. Soil darkens when wet; dead plants
  switch to a plain brown material. Actions: 💧 Water (broadcast → drops
  for everyone), ⏩ Time-lapse (local replay), Replant. Pot + plant are
  grab handles (drag anywhere; tap selects).
- **home** (`🏠 Home`, v1 2026-10-11): Home Assistant controls hung on
  walls (`"mount": "wall"`, `"ownHandle": true`: a grab tab under the
  control replaces the default puck). Backend `stratum-home` holds the HA
  token (`.env` `HA_TOKEN`; HA at `host.docker.internal:8123` = the host's
  localhost:8123; devices never talk to HA directly). One reconnecting HA WebSocket:
  area/device/entity registries + `get_states` + `state_changed`
  subscription + `call_service`. `GET /entities` (picker: allowed domains,
  no hidden/disabled/diagnostic/config entities, grouped by area),
  `GET /states?ids=` (also marks them watched for 10 min), `POST /call`
  (per-domain action allowlist: toggle/turn_on/off for light, switch, fan,
  input_boolean; scenes, scripts, buttons; media play/pause; sensors,
  binary sensors, climate read-only; **no locks, alarms, covers**).
  Watched entities' changes broadcast on channel `e-<entity_id>`. Access:
  `HOME_USERS` usernames only (app has `identity`); Stratum sign-in is
  username-only, so this is not real security yet. Client: instance config
  `{entity}` chosen in an in-world picker (pages, filter, hide
  unavailable) and saved with `ctx.setConfig` (new: stored in the object's
  components; other devices restart the instance with the new config).
  Controls: rocker + status light (light color/brightness), push button,
  readout panel; tap operates (optimistic toggle), context bar: ☀−/☀+
  for lights, ⇄ Change device. Tests use `tests/fake_ha.py`.
- Generic, for every object: select it, then **drag it with a finger** (it
  stays at its grab distance along the finger's ray, turns to face you,
  saves on release).

### 6.6 Not yet
Worker sandbox for third-party apps; install-time permission prompt;
`network` allowlist for external hosts; backend service accounts for
durable world writes; shared instances (layer members); per-app render
budgets enforced (only measured now).

### 6.7 Backlog (ranked by the user, 2026-10-10)
Apps, in build order:
1. **Plants**: realistic virtual plants that grow (user's answer,
   2026-10-10). **v1 shipped 2026-10-11**, see §6.5. More species later.
2. ~~**Jenga**~~ (done, v42): block stacking on Rapier (golf's physics path); two players
   at one table.
3. **Home Assistant**: switches, buttons, sensor readouts placed in the
   room, calling HA's API through an app backend (token in `.env`).
4. ~~**Sticky notes**~~ (done, main v30): notes pinned to walls/surfaces, shareable via a
   shared layer; uses the overlay typing box.
5. ~~**Pinball**~~ (done, v39; classic machine 2026-10-16): tabletop pinball on Rapier (flippers = taps/screen sides).
6. **Board games** (checkers, chess): low priority; live turns between
   devices.

**Jenga plan (2026-10-14; built in v42).** Biggest unknowns are physics
stability and hand interaction, so those go first.
1. Platform: `ctx.hands()` → fingertip / pinch points in the instance frame
   (Quest), so apps can poke with real fingers.
2. Physics prototype: 18 levels × 3 blocks (7.5 × 2.5 × 1.5 cm, real size),
   Rapier solver iterations up, sleeping on, friction ~0.5. Gate: the tower
   stands 60 s untouched with < 1 mm drift (test).
3. Interaction: grab a block with a spring joint to the grab point (phone:
   hold + drag, its `grab` vetoes the host move; Quest: pinch-hold, or poke
   with a fingertip collider). Pulled blocks go on top.
4. Rules: take from below the top full level, place on top, turns; collapse
   (a block other than the held one leaves the tower footprint) ends it.
5. Shared play, physics follows the player (`ctx.sync`):
   - At rest the tower has no physics: every device just draws the saved
     block poses (shared state, rev'd). Nothing runs, nothing streams.
   - Whoever reaches in (hand / ray within ~40 cm of the tower, or their
     turn starts) claims the simulation: a `claim` event with the state rev
     it starts from. Their device wakes the blocks and runs Rapier locally,
     so their touch has zero network latency.
   - While they simulate they stream awake-block poses (~15 Hz, quantized)
     for the others to draw; others can't touch until it's released.
   - When everything sleeps again (or the turn ends), they write the final
     poses as the new resting state and release. A collapse is judged by
     the simulating device and saved the same way.
   - Claim races: the server-ordered first claim wins (room event order);
     the loser drops its local sim and follows. If the simulating device
     drops out, the last streamed poses become the resting state.
   - Needs: a small `ctx.sync` addition for an exclusive, transferable
     "simulator" lease (golf's host is fixed to the room; this moves with
     the player). Pinball could use it too for shared play later.


Added later the same day (not ranked yet; slotted by dependency):
- **Night outline** (Quest only): soft glowing edges where walls meet the
  floor and around obstructions, for walking in the dark. Built on the
  room map (planes/scene mesh) plus Quest depth for things not in the map.
- **Tabletop trains**: track pieces snapped together on a table, trains
  running the loop (switches/stations later).
- ~~**Racing mini cars**~~ (done, v51 "Mini Cars"): RC-style cars on the table/floor (Rapier vehicle
  physics), drive with on-screen thumb controls (phone) or controller
  sticks (Quest); multiplayer races in a shared Space (needs live state
  sync, §5.1 "not yet").
- ~~**Golf v2**~~ (done, v43) (user's design, 2026-10-11): turn-based; physics runs only
  while the ball moves, on the device of whoever hit it (smoothest view for
  the putter; others follow its snapshots), then authority ends at rest.
  Quest: a little putter appears on the controller when it nears the ball;
  swing it to putt.
- **Breakout** (Quest first): paddle on the controller/hand, bricks as a
  wall in the room or on the table; mostly single player.
- ~~**Tabletop tower defense**~~ (done 2026-10-24, `apps/towers`, §0): path across the table, place towers, waves
  walk the path; host simulates waves when shared (ctx.sync).
- **Basketball** (user, 2026-10-18): a hoop on a wall (or a stand on the
  floor) and a ball to shoot. Quest: pick the ball up with a hand and throw
  it (release velocity from hand tracking, like golf's hand club); phone:
  swipe up to shoot. Rapier ball + rim/backboard colliders, net that
  swings. Modes: free shoot, horse / around-the-world spots on the floor,
  timed shootout with a score board. Shared via `ctx.sync` (the shooter
  simulates their shot, like golf/Jenga).
- ~~**SSH terminal**~~ **done in main v21–v23** (§0). Later: host
  nicknames (backend already stores `name`), word/double-tap selection.

Platform features:
- **Location-based reminders** (user: "definitely", 2026-10-12): "when I
  walk into the kitchen, remind me to water the plants". A reminder is a
  note bound to a Space (or a spot in it) plus a trigger: on entering the
  Space (its tag seen / anchor located / you're within N m of the spot),
  optionally only at certain times or once. When it fires: the note
  glows / floats toward you, a soft chime, and on the phone a
  notification-style banner. Snooze / done from there. Builds on Notes
  (main v30), Spaces and presence. Open questions: firing while the app
  isn't open (needs a background path: phone push via the Stratum
  server + HA presence?), and reminders made for someone else in a
  shared Space.
- ~~Persistent keyboard~~ **done in main v20** (live mode, `ctx.keyboard`,
  browser field focus, summon gesture; §8.5). Still open: whether a
  Bluetooth keyboard paired to the Quest delivers key events to the page
  during an immersive session (would be a nice extra input path).

**Direction change (user, 2026-10-11): Quest interaction is hands first,
controllers second; the phone is secondary.** Hands-first backlog:
- **Hand gestures** (recognizer on WebXR hand joints): point to select;
  pinch / finger-gun "shoot" to act; palm-up to open the menu.
- **Act on real things:** finger-gun at a *real* wall switch or at the
  *actual lights* to toggle them. Needs "device anchors": mark where a
  real switch/light is in the room (room map + Space frame) and bind it
  to a Home Assistant entity; gestures ray-test against those anchors.
- **Point to select → direct controls:** a knob or slider appears at the
  selected light to dim it (hand-rotated knob / pinch-drag slider); RGB
  lights also get a color selector (wheel).
- Virtual wall switches stay (useful where there's no real switch).

- **Sky** (user 2026-10-25; building now as `apps/sky`): the ceiling
  becomes a window onto somewhere else. Themes: 🌌 starry night (Milky
  Way, slow turn, shooting stars, crickets), 🌠 aurora, 🌴 jungle canopy
  (parallax leaf layers, sun shafts, vines hanging into the room,
  birdsong), 🐠 under the sea (the surface from below, caustics, light
  rays, fish, bubbles rising from the floor). Drawn as a *portal*: each
  pixel of the ceiling shape looks along your view ray into the theme, so
  it has depth as you move. The ceiling comes from the room map (the
  biggest ceiling), or you set it: pinch each corner (any shape), raise /
  lower the height. Per instance (placed on the floor); theme, brightness
  and sound in its menu. Open: ceiling fans / lamps get drawn over.

**Play areas (user 2026-10-25).** Board games shouldn't be fixed
rectangles: you define the play space, any shape, and the game fits
itself to it. One kit for every app (`js/apps/kit/playarea.js`, built
with Sky):
1. **Define**: pinch (or tap) the corners on the surface: a table, the
   floor, the ceiling; 3+ corners, any polygon (concave ok, not
   self-crossing); ↶ undo, ✓ done; the outline and fill draw as you go.
   Or take the room map's surface outline as it is.
2. **Density** (where the game asks): sparse / normal / dense, or the
   game picks within its own range.
3. Saved in the instance config (shared: everyone plays the same shape);
   "Redo the area" in the app's menu.
Helpers: point-in-polygon, area, inset, grid cells inside, the longest
path through them.

**Tower Defense v2 (on the play-area kit; built v74, see §0).** Setup: define the area on
the table or floor (any shape), then it lays itself out: square cells of
the board size inside the polygon, the road generated through those cells
(randomized DFS maze over the inside cells, longest of N tries, entry and
castle on the outline's far ends), road length within a density band the
game chooses by area (it keeps 40–60 % of cells buildable). Cells cut by
the outline aren't used; the rim follows the shape. Same towers, waves,
host simulation; the seed + polygon are the shared state, so every device
builds the same board. New map: a new seed, same area.

**Factory (idea, user 2026-10-25): a little industry game.** Build up a
tiny factory on a table or the floor.
- *Setup*: define the play space (play-area kit), then the density of
  resources (sparse / normal / rich). It generates a terrain inside the
  shape: resource patches (ore, coal, stone, wood, later oil / water),
  some obstacles (rocks, trees), a starting crate.
- *Resources and a build tree*: mine (drills on patches) → smelt
  (furnaces: ore + coal → plates) → craft (assemblers: plates → gears,
  circuits…) → science packs that unlock the next tier. Tiers: 1 burner
  drills, belts, furnaces; 2 electric (steam engine + poles), assemblers,
  splitters; 3 oil, trains. Each building has a small recipe card.
- *Fun 3D transport*: conveyor belts with items riding them (instanced
  meshes, belts animated by texture scroll), inserters that swing items
  from belt to machine, splitters and underground belts, little trucks
  or a toy train on a loop for longer hauls, drones later. Everything
  visibly moves: you can watch an ore chunk go from the drill to a plate.
- *Hands*: pinch a building in the build palette and pinch the grid to
  place; drag to lay a belt line (direction from the drag); twist to
  rotate; pinch a machine to see its card; Shoo to remove (refund).
- *Simulation*: host runs ticks (like Tower Defense), fixed-step, items
  as counts on belt lanes (not physics); others render snapshots. Saved
  per instance (the factory keeps running while you're away? first:
  paused when nobody's there; later catch-up on return).
- *Goal*: a rocket (or a big machine) at the end of the tree; meanwhile a
  production stat panel (items / min) is the fun.
- Scope: biggest game yet: grid + placement, belts + items, machines +
  recipes, tech tree, power. Build in that order; the first playable
  slice is drills → belts → furnace → a chest filling with plates.

**3D printer (plan, user 2026-10-25): print to the Prusa MINI from the room.**
Take a printable object in AR, set it on a virtual twin of the real printer's
bed, pick a few settings, and send it. Not built.
- *Printer twin*: an app instance placed on the real MINI and lined up with
  its bed (pinch the bed's front-left and back-right corners, or place on the
  bed and rotate). Shows the 180 × 180 × 180 mm build volume as a faint
  wireframe and a status card floating over the printer (state, nozzle / bed
  temps, progress, time left, the file printing), polled from PrusaLink.
- *Objects to print*: STL / 3MF / OBJ uploads (today uploads take .glb only:
  add these, converted to a mesh client-side; keep the original file for the
  slicer) plus a "Printables" shelf of your uploads. Pinch one and drop it on
  the twin's bed: it lays flat (largest flat face down; twist to pick another
  face, or "lay on face" by pinching a face), snaps inside the volume, real
  size (shown in mm); red if it doesn't fit. Several objects arrange
  themselves (auto-arrange), or move each by hand.
- *Settings card* (by the bed): material (PLA / PETG / ASA / TPU, from Prusa's
  MINI profiles), quality (0.10 / 0.15 / 0.20 / 0.25 mm), infill %, supports
  (off / build plate / everywhere), brim, copies, scale. Remembered per object.
- *Slicer backend* (`apps/printer/backend`, its container): PrusaSlicer CLI
  headless with the bundled MINI / MINI+ profiles (`--export-gcode` or
  `--export-binary-gcode` for firmware 5.1+), the object transform from the
  bed placement; returns print time, filament (g / m) and the G-code. A
  layer preview: toolpaths parsed into line segments, drawn on the twin's bed
  with a layer slider (check the first layer and supports before sending).
- *Send*: PrusaLink on the printer (`PRUSALINK_URL`, `PRUSALINK_KEY` in .env,
  `requiresEnv`; the backend only, never the client): upload to the USB
  drive (`PUT /api/v1/files/usb/<name>` with `Print-After-Upload`), then the
  status card follows the job; pause / resume / stop buttons there.
  Confirm before starting ("Bed clear? Filament: PLA loaded?"); refuse when
  the printer isn't idle / ready. Telemetry: sliced (time, grams), sent,
  finished / failed.
- *Steps*: 1 twin + read-only status (PrusaLink), 2 STL upload + drop on the
  bed + lay flat, 3 slicer container + settings + estimates, 4 upload + start
  (with the confirm) + job controls, 5 toolpath preview.
- *Unknowns*: the MINI's firmware / PrusaLink version (needs the network
  module and firmware ≥ 4.4; 5.x has the v1 API and binary G-code), API key
  vs digest auth on this unit, which filament is loaded (the printer doesn't
  know: ask, remember the last).

Platform feature alongside the apps:
- **Room map**: save a Space's surfaces (walls, tables, floor) so wall
  items (clock, picture frame) snap flat onto walls. Sources: Quest plane
  detection / scene mesh; phones sample hit-test planes while you look
  around. Stored per Space in tag frame, reused by placement and apps.

Deferred: WebRTC
video/audio panes (spike done, awaiting go), phone occlusion debug (did
not occlude in v9), Quest typing.

---

## 7. Server

Python, aiohttp (HTTP + WebSocket in one asyncio process), SQLite (WAL).

| Module | Job | Scale replacement |
|---|---|---|
| `store.py` | All SQL. Nothing else touches the DB. | Postgres (+PostGIS for geo) |
| `hub.py`   | Pub/sub keyed by Space; per-connection send queues; ACL filter on fan-out. | Redis/NATS pub/sub across processes |
| `server.py`| HTTP routes, cookie identity, WS protocol, static files. | Same code, N processes behind a load balancer |

### 7.1 REST (cold data)
```
POST   /api/login                {name}              → sets cookie, creates user + personal layer
GET    /api/me                                        → user, visible layers + roles
GET    /api/spaces?device=D                           → my spaces, anchors, this device's bindings
POST   /api/spaces               {id,name,anchor,device}
POST   /api/anchors              {id,space,pose,handle,device}
DELETE /api/anchors/{id}/binding?device=D             → stale handle cleanup
GET    /api/objects?space=S&since=REV                 → objects (+ tombstones) newer than REV
PUT    /api/objects/{id}         {space,layer,pose,components}
DELETE /api/objects/{id}                              → tombstone
POST   /api/markers              {space, marker:{tag,size,pose}}
POST   /api/assets?name=&w=&h=   raw body             → {asset:{hash,kind,mime,size,width,height,name}}
GET    /api/assets                                    → my library
GET    /assets/{sha256}                               → bytes (immutable cache)
POST   /api/telemetry            {ctx, events}        (no sign-in needed)
```

### 7.2 WebSocket (hot data + push)
```
server → client  hello   {serverTime, user}
client → server  sub     {spaces: [...]}
server → client  subbed  {spaces: [...]}              (client then resyncs via REST since=rev)
server → client  obj     {object}                     (upsert, includes tombstones)
client ↔ server  state   {id, pose, vel, t}           (M3: hot relay, not persisted)
```

### 7.3 Sync model
- One global monotonic `rev`. Every write bumps it.
- Client keeps `rev` per Space; on (re)connect it asks `since=rev`. Deletes
  are tombstones so this works. Later the client caches objects in
  IndexedDB, so a reload costs only the delta.
- If a client's send queue overflows, the server closes the socket; client
  reconnects and resyncs. Correct by construction, no partial state.

---

## 8. Client

```
client/
  index.html      login, Enter AR, import map
  js/main.js      boot, XR session, input (hit-test, select, squeeze)
  js/world.js     spaces, anchors, objects → Three.js scene graph
  js/api.js       REST + WebSocket (reconnect, clock offset)
  js/util.js      uuidv7, pose ↔ matrix
  vendor/         three r170 (+ GLTFLoader)
```

**Renderer: Three.js**, kept as a leaf. World state, sync and alignment
live in plain JS modules that don't depend on Three types; a `view/`
module maps entities to Three objects (M0's `world.js` still mixes the
two; split it in M1b). Why Three over the alternatives:
- We own the hard parts (alignment, sync, ACL, entity model) regardless of
  engine; engine XR helpers (anchors, hit-test managers) mostly go unused.
- Smallest runtime, no build step, already vendored. glTF, KTX2,
  VideoTexture, instancing and BatchedMesh cover §4.
- Physics is a separate WASM lib either way (Rapier).
Alternatives considered: **Babylon.js** (more batteries: Havok physics,
3D GUI, strong WebXR feature manager; heavier, and its batteries overlap
what we build anyway). **Meta Immersive Web SDK** (ECS on top of Three,
Quest-tuned interactions and spatial UI; needs an npm/Vite build, which
this box lacks, and it's young). Because IWSDK is Three-based, adopting it
later is incremental, not a rewrite. **A-Frame / PlayCanvas**: fine
engines, no advantage here.

Session features: required `local-floor`; optional `hit-test`, `anchors`,
`plane-detection`, `mesh-detection`, `hand-tracking`.

### 8.1 Platforms: phone and Quest

Same pages, same server, same Spaces. Code branches on *capabilities*
(`session.enabledFeatures`, input `targetRayMode`), not on device names,
except where a request itself must differ (Quest rejects `camera-access`).

| | Android Chrome (ARCore) | Quest 3S (Quest Browser) |
|---|---|---|
| Camera for markers | WebXR `camera-access`: pose-aligned, intrinsics ✔ (verified) | `getUserMedia` only, needs calibration (§3.7), unverified |
| Input | transient `screen` taps | tracked controllers / hands |
| Placement | screen-center reticle via hit-test | at controller, or ray hit-test |
| UI | DOM overlay (`dom-overlay`) | in-world panels (no DOM overlay) |
| Persistent anchors | no | yes (8 per site) |
| Planes / room mesh | via hit-test only | `plane-detection`, `mesh-detection` |

Input is normalized into **intents** (`place`, `select object`, `grab`,
`menu`) with per-platform sources, as `placeIntent()` in `probe.js` does.
App code (§6) only sees intents, never raw input sources. Because phones
have no persistent anchors, markers are the *only* cross-session alignment
there, which is one more reason markers are primary (§3.6).

### 8.2 Quest 3S render budget (enforced by a budget manager, M4)
- 72–90 fps stereo. Aim ≤ 100 draw calls, ≤ 300k triangles visible.
- Instancing for repeated objects, LODs, distance culling per Space.
- KTX2/Basis textures, meshopt/Draco meshes.
- At most 2–3 playing video textures; the rest show a poster frame.
- Hidden layers aren't loaded at all.

---

### 8.3 The menu (Quest, hands first) — design, 2026-10-11
Goal: as clean and calm as the big headset UIs, but organized for what
Stratum is: *places* full of *layers* and *apps*, many of them, each with
its own settings and catalogs. Phone keeps its DOM sheet (§ main v10)
with the same information architecture.

**Two sizes, one UI.**
- **Palm** (default): ~24 cm wide, on the left palm, turning with it.
  For quick things: what's selected, place something, toggle, jump.
- **Window**: the same pages, ×1.8, put down in the room in front of you
  (⤢ in the top bar, or carry it and let go). Browsing catalogs of
  hundreds, app settings, layer lists: anything that needs room. ↩ brings
  it back to the palm.

**Structure: shallow, contextual first.**
- Tab bar (floating pill under the panel): **Home · Apps · Layers ·
  Space · Settings**. Five fixed places; nothing deeper than
  tab → page → detail (one back step).
- **Home**: where you are (space, people here) · the selected object's
  card (its tools + its app's actions + ⚙ configure) · Place: recent
  placeables + More · Running here: one chip per running app (status).
- **Apps**: grid of app tiles (3×3 per page, page dots), category chips
  (All, On, Games, Home, Decor, Tools, Media) from manifest `category`,
  order: running here → enabled → the rest.
- **App page** (free for every app; apps add to it): header (icon,
  name, status, on/off) · Place (variants; more than 6 → Catalog) ·
  Here (instances in this space; locate one) · Actions · **Settings**
  (declarative schema in the manifest: toggle / choice / slider / text /
  action; per user; `ctx.settings`) · About (permissions, backend).
  Answers "where are the browser's settings / SSH's hosts".
- **Catalog** (component): category chips + 2×3 cards per page + page
  dots + count; pops out to Window for big ones (plants with hundreds).
- **Layers**: grouped rows (This space · Mine · Apps · Public), eye
  toggle per row, counts, groups collapse past 6, "show all".
- **Space**: members, invite code, sharing default, room map.
- **Settings**: hands overlay, occlusion, menu hand, menu size, about.
- Instance config lives on the instance: select it → its card → ⚙.

**Look.** Graphite glass panel (dark, translucent, soft top rim light,
24 mm corner radius) · content cards raised 3 mm · controls raised 5 mm
and *lift 3 mm toward a finger* that approaches, sink on press · one
accent (Stratum blue) · consistent line icons (own vector set, not emoji)
· app icons as emoji in colored squircles (manifest `color`) · type in
millimetres: title 9, body 6, caption 4.5 · poke targets ≥ 18 mm.

**Motion (small, quick, never big moves).** Open: 0.92→1 scale + fade,
180 ms, children 15 ms stagger · close: 120 ms · page push/pop: 2 cm
slide + fade, 160 ms · hover lift 80 ms · press: sink + flash · toggles
slide their knob · tab indicator glides.

**Scale rules.** Never scroll by hand-waving: pages with dots (pinch-drag
or poke ‹ › to turn). Lists cap at 6 rows per page. Search (Apps,
Catalog, Layers) opens the keyboard (§8.5) and filters live as you type.

**Built in code, no image assets:** every element is its own mesh (rounded
geometry + canvas text), so layers can float and animate independently;
textures are cached per text/style. `client/js/ui/kit.js` (widgets, text,
icons, tweens), `client/js/ui/menu.js` (pages, navigation, input).

### 8.4 The phone menu

Same information architecture as §8.3 (one `menuData()` model, one set
of provider actions), shaped for a touchscreen: a bottom sheet over the
AR view, opened by the round button bottom center (which turns into its
close ✕). Tabs sit at the bottom of the sheet, in thumb reach. Phones
have a keyboard, so long lists get a search field instead of pages:
Apps (plus category chips), Catalog (chips + search), Layers. App
settings get native-feeling controls: switch, segmented control (≤ 4
choices) or select, stepper, inline text field. The sheet keeps your
place for a minute after closing, then reopens on Home. Selection tools
stay in the context bar above the button (not in the sheet).

### 8.5 The Quest keyboard

A floating keyboard for fingertips first: 24 mm key pitch (21.5 mm caps,
a bit larger than a laptop's, because hand tracking is ~1 cm accurate),
QWERTY + a symbols layer, Shift (tap: one letter; double-tap: caps
lock), backspace that repeats while held, and a text field with the
prompt, the text (its tail when long) and a blinking caret. URL prompts
get a chip row (https:// www. .com .org .net /) and a Go key; others
get Done and start capitalized (and after ". ").

**Placement:** opens 40 cm ahead and 30 cm below your eyes, tilted back
43°, like a keyboard on a desk raised to poke height. Pinch/trigger or
grip its frame to carry it; where you leave it is saved relative to the
way you were facing, so it opens there next time.

**Input:** each index tip is its own pointer (two-finger typing). A key
presses on contact from the front (≤ 4 mm), re-arms 12 mm back; a finger
coming from behind never presses. Hovered keys lift 2 mm toward the
finger and a dot shows where the tip is over the keys. Controllers or a
distant pinch use the ray (with a haptic tick on controllers). Every
press plays a quiet synthesized tick (no haptics on bare hands).

**API:** `keyboard.ask(label, value, { url, onInput, placeholder })` →
the text, or null if cancelled (✕). `onInput` gets every edit (live
search). `keyboard.openLive({ label, kind, secret, onKey, onClose })`:
live typing (each key straight to the app; Enter doesn't close it; ✕ or
the app does). Apps reach both through `ctx.keyboard` (§0 main v20).
**Summon gesture:** both index fingers pointing down, hands out in front
(like hovering over a keyboard), 1.2 s.

### 8.6 Scrolling (every device)

One gesture family, delivered to apps as `swipe(ctx, { phase, dx, dy,
source })` (cumulative, screen-px-like units; finger/hand down = +dy =
content follows it down):

- **Phone:** drag a finger on the content.
- **Quest, controller or pinch:** hold the trigger / pinch on the content
  and move the ray (starts after ~1.7° of travel, so a click's wobble
  stays a click). Hand/ray travel maps at 3000 units per meter.
- **Quest, hands:** the **two-finger scroll**: index and middle out, ring
  and pinky curled (thumb doesn't matter), held 150 ms; the hand's dots
  turn green; move the hand. It scrolls what the two fingers point at,
  else the app you last touched. Relaxing the hand ends it.

### 8.7 Revelio and shoo (hidden things, per device), 2026-10-23

Hiding is per device (Layers toggles, app rows, shoo); Revelio only ever shows what *I* hid here, never other people's layers I can't see (those are server ACL and never reach the client). `client/js/ui/revelio.js` (HandGestures, Revelio, boundsOf); wiring in `main.js` (QuestInput.revelioGestures / onGesture / revelioDown, castRevelio, revealObject, shooObject, myHidden).

- **Cast:** (v65: now a palm-away sideways slide, see §0; the turn below is history) (thresholds as of v62, see §0) an open hand (4 fingers straightness > 0.75, thumb ≥ 5 cm from the index tip, ≥ 25 cm from the head, within 35° of gaze, open ≥ 150 ms first) turned ≥ 80° within 450 ms, the other hand not turning too: right clockwise / left counter-clockwise *as you see it*. The turn is the knuckle line's angle about the eye→hand line, so a forward twist and a "stop" hand turned like a dial both count. 1.2 s cooldown; turns of 30–55° log 'revelio near' (tuning). Also a menu control (Layers: "✨ Reveal hidden"), for controllers and phones.
- **Band:** an open cylinder ringing out from the head (3.5 m/s, to 7 m, chest height). Each hidden thing flashes when it passes (horizontal distance), then glows faintly (since v63 its own frozen shape in one color, `ghostOf` / app `revealMesh`; box if too heavy) for 10 s + 1.5 s fade; aiming at one keeps them up.
- **Select / reveal:** aim (cursor on the glow), fingertips together or a pinch = selected (bright, pulsing); spread the hand (open) = reveal that object only. Controllers: trigger on a glow reveals; phone: tap a glow. Gesture pinches are claimed (`QuestInput.claim`: no click, hold-to-move, or scroll from them).
- **Shoo:** all five fingertips together (within 2.8 cm of their middle) on a visible object (amber outline), then the hand opens while turning ≥ 35° (right clockwise / left counter-clockwise) within 0.9 s → hidden here (a puff). Plain spread = nothing.
- **State (localStorage, this device):** `world.hiddenObjects` (shooed; beats a visible layer), `world.revealedObjects` (beats a hidden layer / muted app, not a turned-off app); both cleared for a layer's objects when that layer (or app row) is next toggled; "Show everything" clears shoos too; Layers shows "Show N shooed". Per-layer "Revealable" (`stratum.unrevealable`): Layers → "Revealable…" switches the toggles to it.

### 8.8 Turntables, 2026-10-24

A turntable (`components.turntable = { radius, items: [object ids], current: id | null }`, built-in placeable "◎ Turntable") holds things in slots; only `current` is drawn, standing on it. *Shared:* the list and current one are saved on the turntable object, so a step changes it for everyone (they aren't part of its look: `sameContent` ignores them, no rebuild). *Single objects:* each slot is one object, which keeps its own layer / ACL; `ttVisible` = slots `world.shownHere` (so others' private things, layers you hid, turned-off apps) — stepping skips the rest; if the shared current one is something you can't see, you see nothing ("Nothing you can see"). *World:* `world.slots` (item → turntable, `indexTurntable` on apply / detach), `slotHidden(id)` (in a slot, not current) → not shown; `shown = !slotHidden && shownHere`. *Apps* in hidden slots don't start / stop (runtime.update). *Display:* `updateTurntables` each frame sets the current item's root matrix: the turntable's position + rotation, lifted so its bounds' bottom rests on the platter, turning slowly (0.35 rad/s, not apps), spinning in (380 ms, ±108°, scale 0.55 → 1) when it changes (here or remotely), turning with a swipe while you drag. Its saved pose isn't touched (it's where it was dropped). *Adding / removing:* `afterDrop` on every drag release: over a turntable in the same space (within 1.15 × radius, up to 45 cm above) → in, current; carried off → out (current → the last visible). Deleting an item takes it out; deleting a turntable frees its items (they stand where they were dropped). *Stepping:* ‹ › arrows (tap / pinch / trigger / fingertip poke within 2 cm), swipes (phone drag, Quest pinch-drag, two-finger) on the turntable or its current thing (unless that's an app that takes swipes): left = next, ≥ 60 px. Label on the front edge: "2 / 5", "Drop things here". Telemetry: turntable step / add / remove. Tests: test_turntable.

## 9. Scaling path

| Concern | v1 (now) | When it hurts | Next |
|---|---|---|---|
| Identity | username cookie | anyone else on the network | passkeys/OAuth; ACL code unchanged |
| DB | SQLite, sync calls in event loop | write contention, multi-process | Postgres; `store.py` only |
| Fan-out | in-process hub | >1 server process | Redis/NATS channels `space:{id}` |
| Sharding | single process | CPU on WS fan-out | shard processes by Space id (Spaces are natural shards) |
| Assets | files on disk, content-hashed | bandwidth | S3 + CDN; immutable cache headers already correct |
| Discovery | list my Spaces | thousands of Spaces | geo cells (S2/H3) on Space geo, query by cell |
| Client load | everything in subscribed Spaces | dense areas | per-Space spatial index + distance-based subscribe |
| Anchors | 1 persistent per Space | >7 Spaces per device | LRU budget manager + calibration re-resolve |

---

## 10. Milestones

| M | Delivers | Proves |
|---|---|---|
| **M0** | Place/delete cubes; persistent anchor per Space; server persistence; live push | World lock survives sessions |
| M1a | Camera probe page: `getUserMedia` inside `immersive-ar` on the 3S, frame rate, which cameras, passthrough unaffected | The camera plan is possible at all |
| M1b | AprilTag detection in a Worker; intrinsics + hand-eye calibration flow; per-Space estimator with smooth corrections; anchors demoted to cache | Markers align a Space |
| M1c | Multi-marker map: learn marker poses, moved/removed detection, server pose-graph refinement; second device aligns from markers alone | Cross-device alignment |
| M2 | Layer panel (toggle), shared layers + invites, glTF assets upload (content-hashed), video texture component | Tiers + rich objects |
| M3 | Grab/move objects, hot `state` relay, ownership leases, Rapier physics | Interaction + physics sync |
| M4 | App runtime + `ctx`; Bug Catch app with `local` lock mode; render budget manager | Apps as layers |
| M5 | Room-geometry auto-alignment; session anchors per cluster; IndexedDB cache | Robustness at scale |

---

## 11. Dev setup

WebXR needs a secure context. Options, easiest first:

0. **Docker (always on).** `./setup.sh` then `docker compose up -d --build`
   runs it on boot on :8930 with `./data` mounted (db + cert, made on the
   host by setup).
1. **HTTPS on the LAN.** `./run.sh` → serves `https://<pc-lan-ip>:8930`.
   With mkcert the cert is signed by mkcert's root CA: install that CA on
   each device once (README → HTTPS) and there's no warning. Without mkcert
   it falls back to self-signed: accept the warning once.
2. **Tailscale** (if the headset has the Tailscale app): `./run.sh --http`
   then `tailscale serve --bg 8000` → `https://<machine>.<tailnet>.ts.net`
   with a real cert.
3. **USB:** `./run.sh --http`, `adb reverse tcp:8000 tcp:8000`, open
   `http://localhost:8000` (localhost counts as secure).

### Telemetry

`client/js/telemetry.js` (no imports, loaded first on every page) captures
uncaught errors, unhandled rejections, `console.error/warn`, and explicit
`telemetry.info/warn/error(msg, data)` calls (the probe sends every log
line). Batched POST to `/api/telemetry` every 2 s (errors immediately),
`sendBeacon` on page hide, retries when offline. Server appends to
`data/telemetry/YYYY-MM-DD.jsonl` (UTC), 14-day retention, caps of 200
events/post, 2 KB/message, 512 KB/body; unhandled server exceptions land in
the same files with tracebacks. No sign-in needed, user attached if known.
Read: `.venv/bin/python server/telemetry.py -n 100 --level warn`.
Scale path: ship the JSONL to Loki/OpenSearch or swap to OpenTelemetry.

### Automated tests

`./test.sh` (pytest). Two layers:
- `tests/test_api.py`: server API in-process (aiohttp test server, temp DB).
- `tests/test_probe.py`: the real server + headless Chromium (Playwright).
  `?emulate=quest3` loads `js/emulate.js`, which installs Meta's **IWER**
  WebXR emulator (`client/vendor/iwer`, v2.5.0). Tests move controllers and
  press buttons via `window.__xrDevice`, and assert on app state the page
  exposes (`window.__probe`). Software WebGL (SwiftShader) and Chromium's
  fake camera make it run without a GPU or webcam.

Covered by emulation: session setup, controllers, select/squeeze,
persistent anchors (IWER stores them in localStorage), getUserMedia.
**Not covered:** WebXR camera-access (Android), screen-tap input, DOM
overlay rendering, real tracking quality. Those still need a device.
Hit-test and planes need IWER's synthetic environment module (`@iwer/sem`),
not vendored yet; add it when testing the M0 main page.

Debugging: Chrome on the PC → `chrome://inspect` with the Quest on USB
(developer mode) gives the Quest Browser console.

---

## 12. Open questions

- **Open:** Space sharing UX: share a Space with a user = add to
  `space_members`. Who can share? (Proposal: Space owner only, v1.)
- **Open:** Should Spaces nest (house → rooms) with transforms between
  them? Useful for "show everything in my house" without resolving each
  room. Schema leaves room (`parent`, `parent_pose`), not built.
- **Open:** Outdoor use. Quest tracking works outdoors but persistent
  anchors in open areas are less reliable, and **never leave the headset
  lenses facing direct sunlight** (it burns the displays). Outdoor
  content is mostly `local` (apps) and `geo` (coarse) until a VPS exists.
