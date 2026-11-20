# OSD event demo: building + parking access

A local, fully simulated demo for the OSD group product showcase on 24 November 2026.
It is the interactive 3D OSD building model with a new **Parking** destination that shows what the
ATOM Parking Access app does: the request, the approval, plate-read entry at the barrier, the unknown-car
alert, occupancy, and reports.

Nothing here connects to a real system. Plates, names, emails (`@example.com`, `@osd.example`),
camera images and ATOM, Keycloak and LINE responses are all made up and labelled as simulated.

## Run

```sh
npm start            # or: node scripts/serve.mjs 8080
```

Open <http://localhost:8080/>. You need Node 18 or newer and no `npm install`. The server listens on localhost only.

Useful URLs:

| URL | What it does |
| --- | --- |
| `/` | Guided building showcase, as before, with the Parking destination added to the dock |
| `/?kiosk=1` | **Unattended loop** for the booth: the tour repeats, and the parking story plays in full at the car-park stop |
| `/?dest=parking` | Opens straight on the car park, for free play |
| `/?dest=parking&story=1` | Opens on the car park and plays the parking story with auto-advance |
| `/?dest=parking&story=1&auto=0` | Same, but the presenter advances each step with **Next** |
| `/#explore` | The original free-exploration page, unchanged |

## At the booth

- **Auto loop** (bottom-left checkbox, or `?kiosk=1`) runs the tour on repeat. When a visitor touches the screen
  the loop pauses and they can explore. After a quiet minute the loop starts again from the beginning.
- On the Parking destination, the bar under the 3D view has **Play the story**, **Auto-advance** and
  **Visitor's phone**. With auto-advance off, the story waits at the approval and the unknown-car steps
  so the presenter or a visitor can click **Approve**, **Open** or **Deny** themselves. **Next** also does it for them.
- **EN / TH** in the header switches the parking demo between Thai and English. The building's own panels stay in Thai.
- **Night** in the header switches the whole scene, car park lamps included.

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

- **Gate → Send a car to the barrier**: a staff car, an approved visitor, an unknown car, or a car leaving.
- **Gate → Open the barrier manually**: needs a reason, and is audited.
- **Requests**: approve, reject with a reason, or revoke.
- **Vehicles**: add a staff car, import CSV, disable or enable a plate, retry a failed ATOM sync.
- **Reports**: download the event and audit CSVs, or set the capacity.

The visitor's phone form can be filled in by hand. The car photo reads a sample plate.
Staff and visitor cars also come and go by themselves while the car park is on screen.

## What is real and what is imagined

- The building, its 6-bay car park (P1) and the barrier position come from the OSD building model.
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
src/viewer/*.js          the building viewer, split out of the reference file (parking wiring in main.js and showcase.js)
src/parking/             the parking demo
  sim.js                 in-memory simulation: allowed list, requests, presence, events, alerts, audit, outbox
  layout.js              car-park geometry in world metres
  lot3d.js, cars.js      3D lot, gate, cameras and procedural cars
  traffic.js             car routes (lines and arcs) and the gate sequence
  panel.js               staff console
  phone.js               visitor's phone
  overlays.js            plate-camera feed, alert, captions, toasts
  story.js               the guided story
  i18n.js                Thai and English strings, Bangkok-time formatting
src/styles/              app.css (from the reference) and parking.css
model/                   building model and data, extracted from the reference
vendor/three/            three.js r186 as shipped in the reference
scripts/serve.mjs        dependency-free static server
reference/               the original standalone HTML (not committed)
```
