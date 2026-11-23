// What a stop's own buttons do, and what the building's story sets up and works through them, without a page: the
// readings (`state`) and the meeting room's light and AC. A scenario that takes time (the meeting room cooling, the
// energy flow) runs on the demo's pace, a frame at a time.
import {realNow} from 'osd/core/clock.js';
import {COOLING, MEETING_ROOM, SOLAR, WATER, loadFor} from 'osd/viewer/building.js';

const FLOW_SECONDS = 5;
// The story's steps (building-story.js `act`), by the button that does them.
const BUTTON = {'pond-low': 'pond', 'pond-ok': 'pond', cloud: 'energy', sun: 'energy'};

// The readings as the page opens; the day's schedule takes them over at once.
const initial = () => ({
  occupied: true,
  temp: 25.6,
  target: 24,
  pondAlert: false,
  water: WATER.normal,
  solar: SOLAR.clear,
  load: 12.6,
  energy: 37.8,
  scenario: null,
});

// `hold(keys)`: these readings were set by hand (readings.js). `changed()`: draw them again. `animate(seconds)`: a
// running scenario's motion, each frame. `running()`: false once nobody sees it (the page gone or hidden). `frame`,
// `cancelFrame`: animation frames.
export function createScenarios({
  simulation,
  hold = () => {},
  changed = () => {},
  animate = () => {},
  running = () => true,
  frame = (fn) => requestAnimationFrame(fn),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
}) {
  const state = initial();
  let handle = 0;
  const room = (on) => simulation.setRoom(MEETING_ROOM, {light: on, climate: on});
  function setPond(low) {
    state.pondAlert = low;
    state.water = low ? WATER.low : WATER.normal;
  }
  function setSolar(kw) {
    state.solar = kw;
    state.load = loadFor(state.load, kw); // as in the day's schedule
  }
  function stop() {
    cancelFrame(handle);
    handle = 0;
    state.scenario = null;
  }
  // Until `seconds` have passed (the demo's pace): `step(elapsed)` each frame, drawn twice a second.
  function run(seconds, step = () => {}) {
    const start = realNow();
    let drawn = -1;
    const tick = (time) => {
      if (!running()) return;
      const elapsed = (realNow() - start) / 1000;
      step(elapsed);
      animate(elapsed, time);
      if (Math.floor(elapsed * 2) !== drawn) {
        drawn = Math.floor(elapsed * 2);
        changed();
      }
      if (elapsed < seconds) handle = frame(tick);
      else {
        stop();
        changed();
      }
    };
    handle = frame(tick);
  }
  // What was changed by hand stays a while before the building's schedule takes it back (hold).
  const actions = {
    meeting() {
      state.scenario = 'meeting';
      state.occupied = true;
      state.temp = COOLING.from;
      simulation.selectRoom(MEETING_ROOM);
      room(true);
      hold(['temp', 'occupied']);
      changed();
      run(COOLING.seconds, (elapsed) => {
        state.temp = COOLING.from + (COOLING.to - COOLING.from) * Math.min(1, elapsed / COOLING.seconds);
      });
    },
    // Ending it by hand: the room empties and its light and AC go off, until the building's schedule next changes them.
    'meeting-end'() {
      state.occupied = false;
      simulation.selectRoom(MEETING_ROOM);
      room(false);
      hold(['occupied']);
      changed();
    },
    pond() {
      setPond(!state.pondAlert);
      hold(['pondAlert', 'water']);
      changed();
    },
    energy() {
      if (simulation.getState().night) return; // no sun to bring back
      state.scenario = 'energy';
      setSolar(state.solar < SOLAR.low ? SOLAR.clear : SOLAR.cloudy);
      hold(['solar', 'load']);
      changed();
      run(FLOW_SECONDS);
    },
  };
  function start(kind) {
    stop();
    actions[BUTTON[kind] ?? kind]?.();
  }
  // The readings this run of the story has set.
  const storySet = new Set();
  function storyHold(...keys) {
    for (const key of keys) storySet.add(key);
    hold(keys);
  }
  return {
    state,
    stop,
    // A stop's button, or a step of the story that presses it.
    start,
    story: {
      act: start,
      // The scene as it stands before a step's button, whatever the day or a visitor made of it: the room empty (by the
      // day's schedule it is in use at 10:00, and its meeting started with people already in it), and so on.
      prepare(kind) {
        if (kind === 'meeting') {
          Object.assign(state, {occupied: false, temp: COOLING.from});
          room(false);
          storyHold('occupied', 'temp');
        } else if (kind === 'meeting-end') {
          state.occupied = true;
          room(true);
          storyHold('occupied');
        } else if (kind === 'pond-low' || kind === 'pond-ok') {
          setPond(kind === 'pond-ok');
          storyHold('pondAlert', 'water');
        } else {
          setSolar(kind === 'sun' ? SOLAR.cloudy : Math.max(state.solar, SOLAR.low));
          storyHold('solar', 'load');
        }
        changed();
      },
      set: storySet,
    },
  };
}
