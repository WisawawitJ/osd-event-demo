# OSD event demo: building + parking access

A local, fully simulated demo for the OSD group product showcase on 24 November 2026.
It is the interactive 3D OSD building model with a new **Parking** destination that shows what the
ATOM Parking Access app does: the request, the approval, plate-read entry at the barrier, the unknown-car
alert, occupancy, and reports.

Nothing here connects to a real system. Plates, names, emails (`@example.com`, `@osd.example`),
camera images and ATOM, Keycloak and LINE responses are all made up. The page says so once (the header's
"Simulated data" label and the footer's disclosure), not on each item.

## Run

```sh
npm start            # or: node scripts/serve.mjs 8080
```

Open <http://localhost:8080/>. You need Node 18 or newer and no `npm install`. The server listens on localhost only.

Useful URLs:

| URL | What it does |
| --- | --- |
| `/` | Guided building showcase, as before, with the Parking destination added to the dock |
| `/?kiosk=1` | **Unattended** for the booth: the camera follows the day, and the parking story plays in full during the morning arrivals |
| `/?dest=parking` | Opens straight on the car park, for free play |
| `/?dest=parking&story=1` | Opens on the car park and plays the parking story with auto-advance |
| `/?dest=parking&story=1&auto=0` | Same, but the presenter advances each step with **Next** |
| `/?day=10` | Real minutes one simulated day takes (default 20); `?day=0` runs the clock at real speed (tests use this) |
| `/?time=17:00` | Where the world clock starts (default 09:00), e.g. to rehearse the evening rush or the night |
| `/?speed=3` | Runs the demo's timing 3× faster (max 30), for rehearsals and tests |
| `/?warm=0` | Skips the loading screen's shader warm-up (about 2 s per load); the first flights may then stutter. For tests |
| `/?fps=1` | Adds a frames-per-second counter, to check the event laptop (any page; combine with the others) |
| `/?debug=1` | Exposes the scene and the demo's parts on `window` (`__scene`, `__parking`, `__world` …) for the tests and the benchmark |
| `/#explore` | The original free-exploration page, now with the car park, its cars and street traffic (no parking UI, no model download) |

## Testing

```sh
npm run test:quick       # the quick set while you work: 15 short checks, one or two per area, about 10 s
npm test                 # all behaviour checks (190), about 135 s: run before a commit
npm test -- kiosk night  # only checks whose names match (add `quick` for only the quick ones among them)
npm run bench            # frame cost per stop: fps, CPU and GPU ms per frame, draw calls
```

A check joins the quick set with `quick: true` in `test/scenarios.mjs`: keep it to short checks that each guard a
different area (load, language, night, flights, lights, pond, clock, car park, story).

`test/run.mjs` starts its own server on a free port and drives headless Chromium over the DevTools protocol
(`/usr/lib/chromium/chromium` itself where it exists, so the desktop's own Chromium flags and extensions stay out;
`CHROMIUM=` names another binary). Browser profiles go in `$TEST_TMP` (default the system temp folder) under
`osd-demo-test`, named after the runner's process; each is removed once its browser has exited, and at the next start
any whose runner is gone (killed outright) is removed, its browser killed if still running. Each check starts with the page's saved settings (language, idle orbit) and console log cleared; after it the browser goes to a blank page (so a page still running cannot log into the next check) and back to its usual window size. A browser whose page stops answering (90 s) gets no more checks. Every browser runs at low CPU priority. A filter
that matches no check fails. There are no npm dependencies; the tests need Node 22 or newer for its built-in
WebSocket. **It never uses the Intel iGPU by itself**: on this laptop headless Chromium on the iGPU hung it twice (i915
GPU hang, then a failed reset), and since the iGPU drives the display the whole desktop froze. By default it renders on
the NVIDIA GPU (only NVIDIA's EGL library is loaded) with 6 browsers; with 8 the suite, grown to over 100 checks, began failing timing checks under the load.
It closes any hardware browser found holding the iGPU open, falling back to software. Without the NVIDIA driver it
renders in software (SwiftShader, 3 browsers, the 3D view at half resolution with `?render=0.5`):
about 9½ minutes, and some timing-sensitive checks fail at those frame rates. `GPU=nvidia|software|vulkan|egl` forces
one (`egl` is the iGPU: don't).

Pages load with `?debug=1&speed=30` (set in `test/scenarios.mjs`), which runs the simulated clock, cars, story waits
and camera flights 30× faster; checks that time real behaviour use a lower speed or none. `JOBS=n` changes the number
of browsers; `SPEED=n` changes the speed, but many checks' waits assume 30, so other speeds are for exploring only. The `?speed` flag also works by hand for rehearsals, for example `/?dest=parking&story=1&speed=3`. Pages
also load with `?day=0` (the world clock at real speed from 09:00) unless a check sets `day` itself, as the day-cycle
checks do. Checks that do not measure smoothness also skip the shader warm-up (`?warm=0`). The slowest checks start
first, from the times of earlier runs (`test/out/times.json`). Screenshots of failed checks go to a folder of the run's own,
`test/out/shots/<time>-<pid>/` (removed after a day).

`test/bench.mjs` reports the median of 3 windows of 3 s per scene (`BENCH_ROUNDS`, `BENCH_SECONDS`); single windows
vary by up to ~25%, so compare medians from back-to-back runs on the same machine.

## Brand

The page follows the OSD design system: OSD blue `#0055b8` for accents and the active stop, navy `#000334` text, grey
`#55565a` secondary text, the pale tint `#f3f6fc` behind the panels, yellow `#fdaf17` as the one warm accent, the
brand gradient as a bar under the header, 14px card corners with OSD's card shadow, round pills, and Noto Sans Thai
(already the page font). The header carries the **OSD × ATOM** lockup: the OSD wordmark (the vector logo without its
tagline) and the ATOM logo as supplied, white versions at night (`src/brand/`). The 3D view's title card is an
overline (the floor) and the stop's name, uppercase in English as OSD titles are.

## One day, always running

Everything runs on one world clock (`src/parking/clock.js`) on the event date, 24 Nov 2026: a whole day takes about
20 real minutes (the night, 21:00–05:00, a little faster) and then starts again, so visitors see the building through
morning, noon, dusk and night. On the timeline, **Pause** freezes everything (clock, cars and barrier, the story, the tour,
scenarios and the idle orbit; the camera can still be moved) until **Resume**, Follow the day, Start tour or the story's
Play; the **min/day** button makes a day take 10, 20, 40 or 60 real minutes.

- **Koi** swim slow loops in the pond, each sized to keep the fish in the water, waving their tails. The motion is in
  the vertex shader (no per-fish CPU work); the pond redraws at 15 fps only while it is in view, and not when paused.
- **Street lights** stand all along the main road's kerb, 17 m apart (the gap that clears the gate), their arms over
  the road. At night they and the car park's four poles each throw a cone of lit air down to a soft pool on the
  ground, drawn as the meeting room's light (`src/viewer/light-cone.js`).
- **Headlights:** at night cars with the engine on (driving, queuing, at the barrier) have their lamps lit, and the
  light on the road ahead: two soft lobes, one from each lamp, starting at the bumper and meeting ahead of the car
  (also in the plate camera's picture), and their beams in the air: lit air like the meeting room's light cone,
  brightest near the lamps and fading ahead, seen from any side. Both are painted, not real lights, so every car on
  the move has them at no cost to the rest of the scene; parked cars and their plates are dark. The start-up warm-up prepares the night's shaders too, so the first dusk
  does not freeze the view.
- **Sky:** the sun crosses the building, low and warm in the early morning and late afternoon; at night a dim moonlight
  carries on along the same path, so shadows turn smoothly all day and never jump (not at dusk, dawn or midnight). Room lights, car-park lamps
  and the dark page come on after sunset (about 18:05) and go off before sunrise. The night is dark, as a real one:
  the moon and sky only let shapes be made out, and the street lights, lit rooms and headlights carry the scene.
- **Building:** rooms' lights and AC, the meeting room (09:00 meeting, 14:30 empty with the AC still on), the pond (low
  water around 15:00) and the solar panels follow a daily schedule. A switch flipped by hand stays until the schedule next
  changes that room. Readings set by hand (Simulate low water, a meeting) stay until the schedule changes that
  reading itself; temperature and solar, which the schedule moves all the time, stay for an hour of world time.
- **Car park:** cars come and go to match the hour: a morning rush in from 07:00, a dip at lunch, an evening rush out
  from 16:30, two or three cars overnight. Visitors with a pass for the day (ten are booked) drop in between 09:30
  and 15:30, each at most once, stay 45 minutes to three hours, and drive out by themselves. On screen they drive through the barrier as fast as its one lane allows; the
  rest is made up in the bays (with log entries over that time), as it is while the car park is off screen, but only
  in bays out of the camera's view, so no car pops in or out where you can see it (a jump in time changes them all).
- **Timeline** (under the 3D view): the live time. Drag the slider, or press a moment, to move the world on to that
  time (always forward: what happened stays in the logs). **Night** in the header moves it on to 20:00, **Day** to 07:30.
- **Follow the day** (timeline button) moves the camera to what the day is doing: the car park in the rushes, the meeting
  room, the roof at noon, the pond, the overview at night. The parking story plays once a day during the morning arrivals;
  while it plays the clock runs at real speed and the story sets its own times (09:02 to 11:30).
- At 03:00 the day starts again on the 24th: logged times move back a day with it (they read as yesterday's), passes for
  the 24th stay valid, and logs older than two days are dropped.

## At the booth

- **Kiosk mode** (bottom-left checkbox, or `?kiosk=1`) follows the day. When a visitor touches the screen it stops and
  they can explore. After a quiet minute it follows the day again. **Start tour** still plays the fixed tour. While it
  runs the Explore link is hidden and the logo does nothing, so the screen never leaves the showcase.
- On the Parking destination, the bar under the 3D view has **Play the story**, **Auto-advance** and
  **Visitor's phone**. With auto-advance off, the story waits at the approval and the unknown-car steps
  so the presenter or a visitor can click **Approve**, **Open** or **Deny** themselves. **Next** also does it for them.
  Unticking auto-advance mid-step stops right there, at the cue or the step's pause (and ends a Pause, since the bar
  then has Next). On auto-advance, a cue waits while the presenter works the console or the alert (Reject, a reason to
  open with), until 6 s pass untouched. **Pause** stops the phone's typing too. A drag on the 3D view, a view key on
  it (arrows, + −, Page Up/Down, R), Esc or **Exit story** leaves the story.
- **EN / TH** in the header switches the whole showcase page (building and parking) between Thai and English. Names, plates and provinces stay as entered. The `#explore` page opens in the language last chosen (room names included).
- **Night** / **Day** in the header moves the world clock on to 20:00 or 07:30 (showcase and explore).
- **Moving the view**: drag to rotate; Shift-drag (or Ctrl-drag), right-drag, the arrow keys or, on a touchpad, a
  two-finger scroll to pan; the mouse wheel or a pinch to zoom. Panning slides across the ground at the height the
  camera has (up and down on the screen go forward and back); zooming and tilting change the height. Close in,
  zooming in walks forward instead of stalling.
  Panning slows the further the view goes from the site and stops 90 m out (coming back is never slowed), and keeps
  between the ground and 35 m up; orbiting stops just above the horizon, so the camera never goes under the ground. The world
  fades into the background from 65 m to 95 m out from the site's middle, so the ground's edge never shows, and zooming
  out stops a little past the whole-site view. The ground
  is a field of mown grass with light and dark patches (a grass texture sampled twice at different sizes and angles, blended with patches worked out per pixel, so it never repeats).
- **View controls** at the bottom right of the 3D view: zoom in, zoom out, camera up and down (▲ ▼, or Page Up / Page
  Down: the camera rises or drops, still looking at the same point, and stops at the view's limits; panning keeps the
  height), **Reset view** (back to the current stop's camera; the R key does the same) and **Idle orbit**. Idle orbit is on by default: after 20 s without input (a flight to a stop the visitor picked counts as input) the camera slowly circles, and in the tour or loop it circles from the moment each building stop lands. The setting is remembered in the browser.

### The parking story (10 steps, about 2½ minutes on auto)

1. A visitor opens the public request page on her phone, with no sign-in, and fills it in.
2. She snaps the car; the plate fills itself. She adds an optional face photo with consent.
3. The request appears in the staff console at once, with flags and an ATOM plate lookup.
4. Staff approve it: the car and person are registered in ATOM, a QR code is issued and the ticket is emailed.
5. The ticket with QR and a calendar invite lands on her phone.
6. On the day, the entry camera reads the plate and the barrier opens by itself. The car parks in a visitor bay.
7. An unknown car arrives: the barrier stays shut and an alert with the camera snapshot asks staff to Open or Deny.
8. The live overview: occupancy against capacity, entries per hour, and items that need attention.
9. The daily summary, the append-only audit log and the CSV export.
10. She leaves. The exit always opens, and the bay is freed.

### Free play

In the staff console:

- **Gate → Send a car to the barrier**: a staff car, an approved visitor, an unknown car, or a car leaving (off while
  the story plays: a car sent then got into its steps).
- **Gate → Open the barrier manually**: needs a reason, and is audited (off while the story plays, like the test cars).
- **Requests**: approve, reject with a reason, or revoke.
- **Vehicles**: add a staff car, import CSV, disable or enable a plate, retry a failed ATOM sync.
- **Reports**: download the event and audit CSVs. (The capacity is the car park's 50 bays; it is not a setting.)

The visitor's phone form can be filled in by hand. The car photo reads a sample plate. On the emailed ticket,
**Add to calendar** downloads a simulated `.ics` invite for the visit.
Each **Send a car** press shows a toast. Cars that have to wait queue visibly on the street (the first just clear of a car backing out of the entry, the rest a car and 2 m apart), and leaving cars wait in their bay until the one ahead is out.
Cars also come and go by themselves, following the hour (see above). The car park is set back from the street: a
short two-way entrance road links the barrier to the street at a T-junction, so a car waiting at the barrier stands
wholly off the street, and through-traffic drives down the middle of each lane. Lane arrows follow one rule for
traffic that keeps left: a pair side by side on every two-way stretch (the entrance road, the driveway, each aisle's mouth). Through-traffic drives both lanes of the
street whenever it is in view; it keeps to one speed per lane and gives way to cars turning in or pulling out.
About a third of the cars coming in arrive along the far lane: the near lane has right of way, so they wait at the
turn, signalling right, for a gap in it and a clear gate mouth, then turn in across it. About a third of the cars
leaving turn right out to the far lane: at the barrier they signal right and wait for a gap in both lanes and for no car
on its way into the entry. Cars signal from 30 m before their turn off the street (queuing included), while waiting at
the exit barrier or an aisle's mouth, and before every other turn (amber lenses at the four corners). Cars go in in the order they get to the entry,
whichever lane they come along: a near-lane car is there a stopping distance before its place in the queue, a far-lane
car at its turn (not when it appears, 50 m out, or is sent). A queued car drives up to the stop line as soon as the
arm rises for the car ahead, and waits there for its own turn at the barrier. The barrier's one
arm serves both lanes, and each lane takes its own turn at it: a car going in does not wait for one going out. The arm
is up while any car passes under it and stays down while an unknown car waits for staff (cars going out wait too). A
car bound for P1 drives in along the exit lane, so it waits at the barrier while a car is driving out. No car drives
through another: on the street a car keeps its distance to the one ahead, every car brakes for a car on its path, and an
aisle takes cars in or out, not both at once (an arriving car rolls straight into a clear aisle, and stops at its mouth
only when a car is coming out or along the exit lane; a car coming out frees its aisle once it has turned onto the exit
lane, not at the exit barrier) (a check watches every pair of cars in a busy car park).

## Performance

- The 3D view renders at up to 1.5× device pixels and steps down towards 1× by itself when the frame rate stays under
  ~38 fps. It never steps back up, and every step redraws in the same frame, so the picture never pops.
- The frame cost is mostly CPU: three.js's work per draw call. So the scene keeps draw calls and per-draw work down:
  - cars are four draw calls each and share all their geometry; trees, shrubs and bay lights are instanced;
  - the building's ~110 interior partition walls are merged per floor at load time, with the same cutaway clipping;
  - flat glass, door leaves and overlays draw in one pass (three.js draws transparent double-sided materials twice and
    re-checks their shader each time);
  - the pond mirror renders only the part of the view the pond covers, so culling skips the rest of the building
    (about half the mirror's draw calls when the pond is small on screen). It redraws every frame only while the camera
    moves, otherwise at most every 100 ms: each mirror pass also made every material it draws swap shaders twice per
    frame (the mirror's target has another colour space), half the pond view's CPU time;
  - the building and the static car-park parts compose their matrices once, not every frame; only floors (exploded view),
    door hinges and cars update theirs.
- Shadows behave as if baked: the sun's shadow map is drawn once per view change or sun step (every 2 world minutes, about
  once a second), never because the camera moved. At night
  the 6 room lights (1 with shadows) are the selected room and its neighbours (dealt again as soon as another room is
  selected), so moving the camera never swaps lights or shadows. Every room's light fades on and off (~0.35 s), and a
  light moving to another room (a flight changing floors) fades out, moves and fades in.
- The near clipping plane follows the viewing distance, and road paint, bay tints and car shadows use a depth offset,
  so nothing flickers against the surface underneath while the camera moves.
- Dock switches are one continuous camera move of 1.3–1.9 s that speeds up and slows down once (eased on the distance
  covered, not on the curve's own uneven parameter), with no first-visit stall, by day or night. On the way the current
  stop's floors are sliced away from the top down and the next stop's appear from the top down too (the slab over a
  ground-floor view comes last), solid throughout, with the sun's shadows redrawn to follow the cut, using copies of
  the materials that are kept between flights. A stop picked mid-change starts from what is on screen. The car park's
  own layout (wider panel, taller view) changes as a 0.35 s view transition instead of in one frame: the 3D view stays
  live as it resizes, and a second switch waits for the first instead of cutting it short. The pond's reflection fades
  out and back in around a flight.
- The loading screen (about 2 s) prepares every shader a visit can need: each material as it is, its cut copies, by
  day and by night, and the plate snapshot's colour pass. Textures are uploaded and one tiny frame is drawn. At night
  the number of lights never changes with the view (all 6 room lights stay in the scene, unused ones dark), since a
  new light count rebuilt every shader. The meeting-room cutaway moves a permanent clipping plane
  instead of swapping shaders.
- The live plate-camera pop-up is one extra render into a scissored corner of the same canvas, only while it shows.
- The view redraws only when something on screen changes: moving cars redraw it only while the car park is shown.
- Car movement runs in real time at any frame rate. Add `?fps=1` to see the frame rate, or run `npm run bench`.

## What is real and what is imagined

- The building, its 6-bay car park (P1, for VIPs only) and the barrier position come from the OSD building model.
- The open-air lot P2 (44 bays), the street, the driveway, the booth, the plate cameras and the free-space sign
  are invented for the demo, to show a 50-space car park.
- The flows follow the parking app's current features (README of `atom-parking`) and the supplied target
  specification: LPR entry, the unknown-vehicle alert with Open/Deny, occupancy, the daily summary, the audit log and CSV.
  Some of these are not built in the real app yet. The demo shows the intended behaviour, not a delivered system.

## Layout

```
index.html               import map and page shell
src/boot.js              picks the page (#explore or the showcase) and starts the viewer
src/pages/*.html         page markup (from the reference, plus the parking slots)
src/viewer/*.js          the building viewer, split out of the reference file (parking wiring in main.js and showcase.js);
                         daylight.js (sky and sun by time of day), building-day.js (the building's daily schedule)
src/parking/             the parking demo
  index.js               the car park's scene and the parking demo's wiring into the showcase
  sim.js                 in-memory simulation: allowed list, requests, presence, events, alerts, audit, outbox
  layout.js              car-park geometry in world metres
  lot3d.js, cars.js      3D lot, gate, cameras and procedural cars
  traffic.js             car routes (lines and arcs) and the gate sequence
  panel.js               staff console
  phone.js               visitor's phone
  overlays.js            plate-camera feed, alert, captions, toasts
  story.js               the guided story
  i18n.js                Thai and English strings, Bangkok-time formatting
  clock.js, dom.js       the ?speed time scale and the world clock; small UI helpers (icons, CSV, calendar file)
src/styles/              app.css (from the reference), parking.css, night.css (dark page at night)
model/                   building model and data, extracted from the reference
vendor/three/            three.js r186 as shipped in the reference
scripts/serve.mjs        dependency-free static server
test/                    browser.mjs (headless Chromium driver), run.mjs + scenarios.mjs (checks), bench.mjs
reference/               the original standalone HTML (not committed)
```
