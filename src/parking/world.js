// The parking world without a page: the records, the traffic, the story, the car park's background life and the rules
// that tie them together (who answers an unknown car, how long one waits, what the story's own cars do once it stops).
// The page (index.js) adds the 3D car park, the console, the phone and the pop-ups as `ui`; Node tests give it a
// stand-in car park and no UI, and step the engine's clock.
import {createParkingSim, STORY_START} from './sim.js';
import {createTraffic} from './traffic.js';
import {plateRead} from './gate.js';
import {createStory} from './story.js';
import {later, cancelLater, sleep, world, demoNow, rng} from './clock.js';
import {
  storyCar,
  UNKNOWN_PLATES,
  pickOne,
  lotOnScreen,
  available,
  streetGap,
  idleCars,
  fromFarLane,
  leavingCandidates,
  startLotLife,
} from './life.js';

const noop = () => {};
// What the story needs from the UI when there is none.
const NO_PANEL = {show: noop, setCue: noop, reset: noop, flash: noop};
const NO_OVERLAYS = {setCue: noop, reset: noop};

// `lot`: the car park traffic drives in (3D, or a stand-in). `phone`: the visitor's phone (the story drives it).
// `ui` (all optional):
// - panel, overlays: the console and the pop-ups (the story drives them);
// - fly(pose, ms): the camera; tap(): the cued button's tap; caption(caption, hintKey): the story's caption;
// - toast(icon, key, vars, tone, queued): a short message (`queued`: the car waits behind others);
// - snapshot(which): a plate camera's picture; plateRead(which, agent, verdict, confidence): the plate camera starts
//   reading (the page shows its feed); plateDone(which);
// - leftGate(which): a car is through the barrier; full(plate): turned away, the car park full;
// - event(kind, payload): every records change, after the world's own rules have run;
// - storyChanged(): the story started, stopped or moved on;
// - schedule(): something to redraw.
// `onScreen()`: whether the car park is in view (the background life and through-traffic only drive cars then).
// `staffOnly`: the explore page's car park: staff cars come and go, no VIPs, visitors or unknown cars.
export function createParkingWorld({
  lot,
  sim = createParkingSim(),
  camera = null,
  ui = {},
  onScreen = () => lotOnScreen(lot),
  watched = () => true,
  phone,
  staffOnly = false,
}) {
  const panel = ui.panel ?? NO_PANEL,
    overlays = ui.overlays ?? NO_OVERLAYS,
    schedule = ui.schedule ?? noop;
  const toast = (...args) => ui.toast?.(...args);
  let quietAmbient = false;

  const traffic = createTraffic({
    lot,
    sim,
    schedule,
    hooks: {
      snapshot: ui.snapshot ?? (() => ''),
      // gate.js's pace: read, the verdict on the card, then the barrier.
      async readPlate(which, agent, verdict, recognised) {
        ui.plateRead?.(which, agent, verdict, 0.9 + rng() * 0.09);
        await plateRead({read: () => ui.plateDone?.(which), recognised});
      },
      onFull(plate) {
        ui.full?.(plate);
      },
      onLeaveGate(which) {
        ui.leftGate?.(which);
      },
    },
  });

  let story = null;
  const actions = {
    storyRunning: () => story.running,
    approve(id) {
      sim.approve(id);
    },
    resolveAlert(id, decision, reason) {
      sim.resolveAlert(id, decision === 'open' ? 'open' : 'deny', reason);
    },
    // While an unknown car's alert holds the barrier, the answer is Open/Deny on that alert, not a blind pulse.
    manualOpen(reason) {
      if (sim.state.gate !== 'closed' || sim.state.alerts.some((a) => a.status === 'open')) return;
      sim.manualGate(reason);
      traffic.pulse(5000);
    },
    // Sends a car: `registered` (staff), `visitor`, `unknown` or `exit`. `quiet`: the background life's own (no
    // message, any idle car incl. VIPs). `west`: along the far lane (by default a third do; the story's keep the near lane).
    simulate(kind, {fromX = -70, quiet = false, west = fromFarLane(traffic.queued > 1)} = {}) {
      const presence = sim.state.presence;
      // Every button press says what happens, including when the car has to queue.
      const say = (key, plate) => {
        if (!quiet) toast('car', key, {plate}, 'info', traffic.queued > 1);
      };
      const blocked = () => {
        if (!quiet && sim.state.alerts.some((a) => a.status === 'open')) toast('alert', 'gate.sim.waitingAlert');
      };
      if (kind === 'exit') {
        // Pressed by hand, any parked car may be the one (a visitor too); the background's own departures are not.
        const keys = leavingCandidates(sim, traffic, {guests: !quiet, staffOnly});
        if (!keys.length) return;
        const k = pickOne(keys);
        traffic.leave(k, {west: fromFarLane(traffic.leaving > 1)});
        if (!quiet) toast('arrowOut', 'gate.sim.leaving', {plate: presence.get(k)?.plate}, 'info');
        blocked();
        return;
      }
      if (kind === 'unknown') {
        const free = UNKNOWN_PLATES.filter(
          ([p, pr]) => !traffic.isAround(sim.key(p, pr)) && !presence.has(sim.key(p, pr)),
        );
        if (!free.length) return;
        const [plate, province] = pickOne(free);
        traffic.arrive({plate, province, color: Math.floor(rng() * 9), fromX, ambient: quiet, west});
        say('gate.sim.coming', plate);
        blocked();
        return;
      }
      const pool =
        kind === 'visitor'
          ? sim.state.vehicles.filter(
              (v) =>
                v.type === 'guest' && available(sim, traffic, v) && v.validFrom <= sim.now() && v.validTo >= sim.now(),
            )
          : idleCars(sim, traffic, {staffOnly: staffOnly || !quiet}); // the Staff car button sends a staff car, never a VIP
      // The newest approved visitor drives up first, so a request made on the phone can be followed to the gate.
      const v = kind === 'visitor' ? pool[pool.length - 1] : pickOne(pool);
      if (!v) {
        if (!quiet) toast('user', kind === 'visitor' ? 'gate.sim.noVisitor' : 'gate.sim.noStaff');
        return;
      }
      traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX, west});
      say('gate.sim.coming', v.plate);
      blocked();
    },
  };

  sim.subscribe((kind, payload) => {
    // The story's own cars reaching the barrier after it was left (its unknown car, or its visitor with no pass) are
    // background ones: turned away after 8 s, the console left where it is (they took the 45 s a presenter's own car
    // gets, and switched the console to the Gate tab, for a car nobody had sent).
    if (kind === 'alert' && !story.running && storyCar(payload)) payload.ambient = true;
    ui.event?.(kind, payload);
  });

  // The story: its steps drive the console, the phone, the camera and the cars.
  let hintKey = null,
    caption = null;
  story = createStory({
    sim,
    panel,
    phone,
    traffic,
    actions,
    fly: (name, ms) => ui.fly?.(name, ms),
    cue(name) {
      panel.setCue(name);
      overlays.setCue(name);
    },
    // A hint is a text key, put in the language on show each time (it stayed in the old one after a switch).
    hint(key) {
      hintKey = key;
      ui.caption?.(caption, hintKey);
    },
    caption(c) {
      caption = c;
      ui.caption?.(caption, hintKey);
    },
    tap() {
      ui.tap?.();
    },
    // The story starts from the seeded 09:00 car park, so the clock goes to 09:00 first (the seed would otherwise
    // leave out whatever lies after an earlier time).
    async resetWorld() {
      sim.setNow(STORY_START);
      sim.reset();
      traffic.syncParked();
      panel.reset();
      phone?.reset();
      overlays.reset();
      await sleep(50);
    },
  });
  // While the story plays, the world clock runs at real speed (its steps set their own times, 09:02 … 11:30) and the
  // background life holds still. When it stops, its unknown car still at the barrier is a background one (8 s, not a
  // presenter's 45 s: left at step 7, it held the barrier and every car behind it).
  let storyWasRunning = false,
    releaseClock = null;
  story.subscribe(() => {
    quietAmbient = story.running;
    if (story.running && !releaseClock) releaseClock = world.hold();
    if (!story.running && releaseClock) {
      releaseClock();
      releaseClock = null;
    }
    if (storyWasRunning && !story.running) {
      phone?.setCue(null);
      phone?.cancelRead();
      for (const a of sim.state.alerts) if (a.status === 'open' && storyCar(a)) a.ambient = true;
    }
    storyWasRunning = story.running;
    ui.storyChanged?.();
  });

  // Background life: cars follow the hour. Unknown cars only while the car park is the stop on show (`watched`),
  // where their alert can be answered. The parked cars are placed first: a late start's catch-up takes cars away.
  traffic.syncParked();
  const stopLife = startLotLife({
    sim,
    traffic,
    camera,
    staffOnly,
    paused: () => quietAmbient,
    watched,
    onScreen,
    arrive: () => actions.simulate('registered', {quiet: true}),
    leave: () => actions.simulate('exit', {quiet: true}),
    unknown: staffOnly
      ? null
      : () => {
          if (watched()) actions.simulate('unknown', {quiet: true});
        },
  });
  // Through-traffic whenever the street is in view (overview and car park), not only at the parking stop.
  let passTimer = null;
  const schedulePass = () => {
    passTimer = later(() => {
      if (onScreen()) traffic.passBy();
      schedulePass();
    }, streetGap(world.minute()));
  };
  schedulePass();
  // Unknown cars nobody answers are turned away: the single barrier serves entry and exit, so one waiting blocks cars
  // leaving too. Background ones after 8 s, ones a presenter sends after 45 s (simulation time), checked every 250 ms.
  let autoDeny = null;
  const denyLeftAlone = () => {
    if (!story.running)
      for (const a of sim.state.alerts)
        if (a.status === 'open' && demoNow() - a.raised > (a.ambient ? 8000 : 45000))
          sim.resolveAlert(a.id, 'deny', undefined, 'staff.guard');
    autoDeny = later(denyLeftAlone, 250);
  };
  autoDeny = later(denyLeftAlone, 250);

  return {
    sim,
    traffic,
    story,
    actions,
    lot,
    // Runs the story once and resolves when it ends or stops (resumes a paused demo: the story needs time to pass).
    playStory({auto = true} = {}) {
      world.setPaused(false);
      story.setAuto(auto);
      return story.play({auto});
    },
    stopStory() {
      story.stop();
    },
    dispose() {
      story.stop();
      stopLife();
      cancelLater(passTimer);
      cancelLater(autoDeny);
      traffic.dispose();
    },
  };
}
