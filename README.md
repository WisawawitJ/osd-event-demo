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

Open <http://localhost:8080/>. You need Node 18 or newer to serve it, and no `npm install`. The tools need `npm install` (Vite+, dev only) and Node 22.18 or newer: `npm test`, `npm run lint`, `npm run fmt`, shots and bench. The server listens on localhost only.
The page takes no settings from its address: for the booth, just open it. `/#explore` is the
original free-exploration page, with the car park, staff cars coming and going and street traffic (no parking UI, no
model download).

`npm run single` (after `npm install`) puts the whole demo in one file, `dist/osd-demo.html` (about 4 MB): open it by
double-clicking, with no server and no network. The file is in git: run it again after a change and commit it.

## Testing

```sh
npm test                 # every test, in Node (Vitest, through Vite+): about 6 s, no browser, one file at a time
npm run lint             # Oxlint (vite.config.js has its settings)
npm run fmt              # Oxfmt
npm run shots [words]    # screenshots of every UI state: shots/<commit>/index.html (<commit>+wip with changes)
npm run shots -- --base main [words]   # and what changed since main: shots/compare/<main>..<commit>/index.html
npm run bench            # frame cost per stop: fps, CPU and GPU ms per frame, draw calls
```

**The tests run the demo without a browser.** Its logic is separate from its page:

- `src/core/clock.js`, the engine: simulation time moves only when stepped, in ticks of at most 50 ms; each tick
  fires the timers due in it in order, then the per-tick systems (cars moving, the world clock). The browser steps it
  every frame by the real time elapsed; pausing stops the stepping. Dice come from a seeded generator, so a run can be
  repeated exactly.
- `src/parking/world.js`, the car park without a page: records, traffic, the story, the background life and the
  rules between them. `src/viewer/director.js`: following the day, and back to the start after a quiet minute.
  `src/viewer/building-story.js`: the building's story. `src/viewer/scenarios.js`: what the stops' buttons do.
  `src/viewer/panels.js`: each stop's panel, as markup. `src/viewer/readings.js`: readings set by hand against the
  building's schedule. `src/viewer/view-math.js`: the camera's limits and steps.
- `test/unit/` steps them as fast as it can: a whole parking story takes about 0.2 s, a busy hour of random traffic
  (checked every tick for cars driving through each other) under a second, a whole day of the car park on screen
  (every car through the barrier; the car count checked against the hour every half hour, every pair of cars for
  touching) about a second. `SEEDS=1,2,3 npm test` runs that day with other dice.

How things look is not tested automatically: run the screenshot script and look. With `--base <ref>` (a commit,
branch or tag) it also photographs that version, from a temporary checkout, and writes a comparison page: before,
after and the changed pixels for each state, the most changed first, unchanged ones hidden, a click to swipe between
the two. A commit's shots are kept and reused; `+wip` ones are taken again. Words pick states (`parking 1920 en`: the
car park states at 1920 wide in English; see `scripts/shots.mjs`). The states (`scripts/shots-states.mjs`) look the
same on every run: pages open with the `manual` option, so simulation time moves only when the script steps it
(`window.__engine`, `src/viewer/debug-engine.js`), camera flights are waited out, the dice are seeded and CSS animations
end at once; two runs of one version differ by a few pixels of GPU noise at most. It drives headless Chromium over
the DevTools protocol (`test/browser.mjs`: `/usr/lib/chromium/chromium`, or `CHROMIUM=`), one browser, on the NVIDIA
GPU or in software, **never the Intel iGPU** (it froze this laptop twice; `GPU=nvidia|software|vulkan|egl` forces one).
The page itself takes no settings from its address; the screenshot script hands it test settings (`time`, `dest`,
`story`, `auto`, `speed`, `debug`, `manual`, `seed` …) as `window.__demoOptions` before it loads (`src/core/options.js`).

## Brand

The page follows the OSD design system: OSD blue `#0055b8` for accents and the active stop, navy `#000334` text, grey
`#55565a` secondary text, the pale tint `#f3f6fc` behind the panels, yellow `#fdaf17` as the one warm accent, the
brand gradient as a bar under the header, 14px card corners with OSD's card shadow, round pills, and Noto Sans Thai
(already the page font). The header carries the **OSD × ATOM** lockup: the OSD wordmark (the vector logo without its
tagline) and the ATOM logo as supplied, white versions at night (`src/brand/`). The 3D view's title card is an
overline (the floor) and the stop's name, uppercase in English as OSD titles are.

## One day, always running

Everything runs on one world clock (`src/core/clock.js`) on the event date, 24 Nov 2026: a whole day takes about
20 real minutes (the night, 21:00–05:00, a little faster) and then starts again, so visitors see the building through
morning, noon, dusk and night. On the timeline, **Pause** (a story's bar has the same one) freezes everything (clock, cars and barrier, the story,
scenarios and the idle orbit; the camera can still be moved) until **Resume**, a stop picked on the
dock, a story's Play or Next (or its end), Follow the day, or a quiet minute; the **min/day** button makes a day take 10, 20, 40 or 60 real minutes.

- **Koi** swim slow loops in the pond, each sized to keep the fish in the water, waving their tails. The motion is in
  the vertex shader (no per-fish CPU work); the pond redraws at 15 fps only while it is in view, and not when paused.
- **Street lights** stand all along the main road's kerb, 17 m apart (the gap that clears the gate), their arms over
  the road. At night they and the car park's four poles each throw a cone of lit air down to a soft pool on the
  ground, drawn as the meeting room's light (`src/core/light-cone.js`).
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
- **People:** while the meeting room is in use, six faceless figures sit on its chairs (`src/viewer/people.js`), as many as
  the radar counts; they come and go one after another, look about a little, and throw shadows by sun and lamp.
- **Car park:** cars come and go to match the hour: a long, gentle morning rush in from 05:45, a dip at lunch, an
  evening rush out from 16:00, two or three cars overnight. Visitors with a pass for the day (ten are booked) drop in between 09:30
  and 15:30, each at most once, stay 45 minutes to three hours, and drive out by themselves. On screen every car drives
  through the barrier, which keeps up with the rushes of a 20-minute day (at most a car every 7 s each way; it can take
  one every 6.5 s): cars set off
  for the hour it will be when they get through (half an hour of the time-lapse ahead), as many at once as the car park
  is short or over. That look ahead builds up over a minute from when the barrier takes over (the page opening, a jump
  in time, the car park back on screen, the story over), so the first cars come one after another, not four at once. What the barrier cannot bring in or out (a shorter day, a jump in time) is made up in the bays
  (with log entries over that time), as it is while the car park is off screen, but only in bays out of the camera's
  view, so no car pops in or out where you can see it (a jump in time changes them all).
- **Timeline** (under the 3D view): the live time. Drag the slider, or press a moment, to move the world on to that
  time (always forward: what happened stays in the logs). **Night** in the header moves it on to 20:00, **Day** to 07:30.
- While the parking story plays, the clock runs at real speed and the story sets its own times (09:02 to 11:30).
- At 03:00 the day starts again on the 24th: logged times move back a day with it (they read as yesterday's), passes for
  the 24th stay valid, and logs older than two days are dropped.

## At the booth

- Two ways to use it. **Free play**: the day always runs; visitors pick a stop on the dock, move the 3D view and try
  each stop's own buttons (a meeting, the pond's water, the energy flow, the Gate tab's test cars). **The stories**:
  each stop outside the car park has a bar under the timeline like the car park's: **Play the story**,
  **Auto-advance**, **Loop**, and while it plays Next (or Pause), Restart, Exit and the step (its segment fills as it
  goes, on auto-advance, and so does a line at the foot of the text box; pressing a segment goes to that step). The
  building's story is the meeting day of the visitor the parking story follows (about 1¾ minutes on auto): the room
  getting ready for six people and switching off after them, the pond running low and refilled, a cloud over the solar
  panels and the sun back. At each of those the stop's own button is cued (in the panel): pressed by the presenter, by
  Next, or by itself on auto-advance; the line on the 3D view says what is about to happen, then what did. It sets
  each step's scene first, and outside 09:00–13:00 moves the day on to 10:00 (for the sun, and clear of the day's own
  changes). Picking a stop, any other of a stop's buttons, a device tapped in the 3D view, a jump in time, Night, Esc,
  Exit, or (on auto-advance) taking the 3D view ends it. What it set then goes back to the day's schedule, unless the
  visitor took over there, by the 3D view or one of the stop's controls (they go on from what they see). The parking
  story is on the Parking stop (below).
- **Follow the day** (timeline button, on from the page's opening, after 8 s on the overview) moves the camera to the
  stop of the day's latest moment (07:30 car park, 09:00 meeting room, 12:00 roof, 14:30 meeting room, 15:00 pond,
  17:00 car park, 18:00 overview until 07:30), 25 s to 2½ minutes apart in a 20-minute day, with about 11 minutes on
  the overview overnight. It only moves the camera. Turned on during a story, it ends the story. Touching the 3D view
  or pressing a control (but for the button itself, Pause, the day's length and the language; scrolling the page is
  neither) hands over and stops its flight (a touch on a story's bar lets it land); after a quiet minute it follows
  again, until turned off with **Stop following** (a reload turns it on again, and so does coming back from the
  `#explore` page).
- **A 9:16 portrait screen** (at least 761 × 1500 CSS px, e.g. 1080×1920) has a layout of its own that fills it without
  scrolling: the 3D view across the top, then the dock, the timeline and the story bar, and the panel along the bottom
  in two columns (the car park's console scrolls). Nothing to set: turn the screen.
- **Left alone for a minute** (no touch, key or wheel), the screen goes back to the start: what was playing stops (a
  story playing by itself is left to finish first: either's on auto-advance, unless paused), a paused day runs again,
  and a story played with **Loop** on plays again (for an unattended screen: tick Loop and Play), or the camera
  follows the day again, if it was, or flies back to the overview, where the idle orbit takes over. The `#explore`
  page, left alone for a minute, goes back to the showcase.
- On the Parking destination, the bar under the 3D view has **Play the story**, **Auto-advance**,
  **Loop** and **Visitor's phone**. With auto-advance off, the story waits at the approval and the unknown-car steps
  so the presenter or a visitor can click **Approve**, **Open** or **Deny** themselves. **Next** also does it for them.
  Unticking auto-advance mid-step stops right there, at the cue or the step's pause. On auto-advance, a cue waits while the presenter works the console or the alert (Reject, a reason to
  open with), until 6 s pass untouched. **Pause** is the day's: the cars and
  the phone's typing stop with the story. A drag on the 3D view, a view key on
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
  height), **Reset view** (back to the current stop's camera; the R key does the same) and **Idle orbit**. Idle orbit is on by default: after 20 s without input (a flight to a stop the visitor picked counts as input) the camera slowly circles. The setting is remembered in the browser.

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
wholly off the street, and through-traffic drives down the middle of each lane. No arrows are painted on the ground
(the model's own in P1's aisle are left out too): they read as noise from the demo's views. The main road's centre line
is yellow, as on Thai roads; the driveway and the entrance road have none. Through-traffic drives both lanes of the
street whenever it is in view; it keeps to one speed per lane and gives way to cars turning in or pulling out.
About a third of the cars coming in arrive along the far lane: the near lane has right of way, so they wait at the
turn, signalling right, for a gap in it and a clear gate mouth, then turn in across it. About a third of the cars
leaving turn right out to the far lane: at the barrier they signal right and wait for a gap in both lanes and for no car
on its way into the entry. Cars signal from 30 m before their turn off the street (queuing included), while waiting at
the exit barrier or an aisle's mouth, and before every other turn (amber lenses at the four corners). Cars go in in the order they get to the entry,
whichever lane they come along: a near-lane car is there a stopping distance before its place in the queue, a far-lane
car at its turn (not when it appears, 50 m out, or is sent). The queue moves up as the cars ahead go in, and the next
car sets off for the stop line as it sees the car ahead drive off. Going in and out, the camera reads a plate as the car
rolls up to the stop line and the arm rises as soon as it is read. The arm comes down after every car (unless a car in
the other lane is passing under it: one arm spans both). Going out, cars from different aisles pull out at the same time,
each giving way where its aisle meets the exit lane. The barrier's one
arm serves both lanes, and each lane takes its own turn at it: a car going in does not wait for one going out. The arm
is up while any car passes under it and stays down while an unknown car waits for staff (cars going out wait too). A
car bound for P1 drives in along the exit lane's end: from its plate read on, cars leaving P2 stop short of its way
until it has turned off into P1's aisle, and it waits at the barrier only for those already past that point. No car drives
through another: on the street a car keeps its distance to the one ahead, every car brakes for a car on its path, and an
aisle takes cars in or out, not both at once (an arriving car rolls straight into a clear aisle, and stops at its mouth
only when a car is coming out or along the exit lane; a car coming out frees its aisle once it has turned onto the exit
lane, not at the exit barrier) (a check watches every pair of cars in a busy car park).

## Performance

- The 3D view renders at up to 1.5× device pixels and steps down towards 1× by itself when the frame rate stays under
  ~38 fps. It never steps back up, and every step redraws in the same frame, so the picture never pops.
- The frame cost is mostly CPU: three.js's work per draw call. So the scene keeps draw calls and per-draw work down:
  - cars come in five models: two instanced draw calls per model, however many cars, and one for each car's plates and
    lamps (a few more while its lights are on); trees, shrubs and bay lights are instanced;
  - the building's ~110 interior partition walls are merged per floor at load time, with the same cutaway clipping;
  - flat glass, door leaves and overlays draw in one pass (three.js draws transparent double-sided materials twice and
    re-checks their shader each time);
  - the pond mirror renders only the part of the view the pond covers, so culling skips the rest of the building
    (about half the mirror's draw calls when the pond is small on screen). It redraws every frame only while the camera
    moves, otherwise at most every 100 ms: each mirror pass also made every material it draws swap shaders twice per
    frame (the mirror's target has another colour space), half the pond view's CPU time;
  - the building and the static car-park parts compose their matrices once, not every frame; only floors (exploded view),
    door hinges and cars update theirs.
- Shadows behave as if baked: the sun's shadow map (4096 texels square on a desktop, about 2 cm a texel, so the
  barrier's arm and the posts keep theirs; fitted around the whole site, the car park's west end included, in the sun's
  view at each sun step) is drawn once per view change, sun step (every 6 s of world time, about
  ten a second in a 20-minute day, so shadows move smoothly; about 1 ms each) or move of the barrier's arm, never because
  the camera moved. At night
  the 6 room lights (1 with shadows) are the selected room and its neighbours (dealt again as soon as another room is
  selected), so moving the camera never swaps lights or shadows. Every room's light fades on and off (~0.35 s), and a
  light moving to another room (a flight changing floors) fades out, moves and fades in.
- The near clipping plane follows the viewing distance, and road paint, bay tints and car shadows use a depth offset,
  so nothing flickers against the surface underneath while the camera moves.
- Dock switches are one continuous camera move of 1.3–1.9 s that speeds up and slows down once (eased on the distance
  covered, not on the curve's own uneven parameter), with no first-visit stall, by day or night. On the way the current
  stop's floors are sliced away from the top down and the next stop's appear from the top down too (the slab over a
  ground-floor view comes last; at the meeting room everything below floor 4 and the
  site stay, so nothing under it comes or goes), solid throughout, with the sun's shadows redrawn to follow the cut, using copies of
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
- Car movement runs in real time at any frame rate. `npm run bench` measures the frame rate (the `fps` option, from the test driver, shows a meter).

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
src/core/                what both halves use (nothing here knows the building or the car park)
  clock.js               the simulation engine and the world clock
  options.js             settings for tests (never from the address bar)
  lang.js, texts.js      the language, text lookup and Bangkok-time formatting; the texts both halves share
  story-bar.js           both stories' bar (working) and caption
  dom.js, light-cone.js  small UI helpers (icons, morph, CSV, calendar file); lit air under a lamp
src/viewer/              the building and the page
  main.js                puts the 3D view and the page together: renderer, model, night, what the model shows
  stops.js, building.js  the tour's stops, and the building's facts, each in one place
  texts.js               the pages' texts
  showcase.js            the showcase: going to a stop, the building's story on the page, what visitors do
  panels.js, scenarios.js, readings.js, building-day.js, building-insights.js
                         the stops' panels; their buttons; readings set by hand; the day's schedule; the timeline,
                         room colours and incidents
  building-story.js, director.js   the building's story; Follow the day and the quiet minute
  navigation.js, camera-flight.js, scene-transition.js   flights between stops, and the floors' change on the way
  view-limits.js, view-controls.js, view-math.js   how the view moves by hand; its buttons and the idle orbit
  parking-layout.js, corner-card.js, page-night.js   the car park's layout, the plate card's place, the night look
  explore-page.js        the #explore page's own buttons
  sun-light.js, daylight.js, fog.js, render-kit.js, warm-up.js, merge-static.js, debug-engine.js …   the 3D view's parts
src/parking/             the parking demo
  index.js               the page's side of the car park: 3D lot, console, phone, pop-ups, story bar
  world.js               the car park without a page: traffic, actions, story, background life and their rules
  life.js                background life: cars following the hour, visitors, who may come or leave
  sim.js                 in-memory simulation: allowed list, requests, presence, events, alerts, audit, outbox
  layout.js              car-park geometry in world metres
  lot3d.js, cars.js      3D lot, gate, cameras and procedural cars
  traffic.js             car routes (lines and arcs) and the gate sequence
  gate.js                the barrier's pace: plate read and arm
  panel.js               staff console
  phone.js               visitor's phone
  overlays.js            plate-camera feed, alert, captions, toasts
  story.js               the guided story
  texts.js               the car park's texts
src/styles/              colors.css (colours that change at night, day and night together), app.css (from the reference),
                         parking.css, night.css (the rest of the dark page)
model/                   building model and data, extracted from the reference
vendor/three/            three.js r186 as shipped in the reference
scripts/serve.mjs        dependency-free static server
scripts/shots.mjs        screenshots per version and the before/after comparison; shots-states.mjs: the states
test/unit/               the tests, in Node (setup.mjs; world.mjs: the car park and parking world without a page)
test/                    browser.mjs (headless Chromium driver for the screenshots), bench.mjs
reference/               the original standalone HTML (not committed)
```
