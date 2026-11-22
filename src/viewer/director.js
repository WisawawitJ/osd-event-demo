// What the showcase does by itself, without a page. There are two ways to use it: free play (the simulated day always
// runs; the visitor goes where they like and tries each stop's buttons) and the stories (the building's and the car
// park's). Left alone for a minute, the screen goes back to the start: whatever was left playing stops (a story playing
// by itself is left to finish: the building's unless paused, the car park's on auto-advance), a paused day runs
// again, and the camera flies back to the overview.
// The page (showcase.js) flies the camera, draws the panels and reports the visitor's touches. Node tests drive it
// with a stand-in flight and the headless parking world.
import {world, later, cancelLater} from 'osd/parking/clock.js';

// A quiet minute (real time on the page: a paused day still counts down).
export const IDLE_MS = 60000;

// `select(id, {guided})`: flies to a stop. `cancelFlight()`. `parking`: playStory/stopStory/story. `building`: the
// building's story (running, stop). `current()`: the stop on show. `ui`: stopScenario(), render(), both optional.
// `hidden()`: the page is out of sight (another tab).
// `after(fn, ms)` / `cancel(handle)`: the idle timer (default the engine's clock; the page gives it real time, as a
// paused day stops the engine's).
export function createDirector({select, cancelFlight = () => {}, parking = null, building = null, current = () => 'overview', ui = {}, hidden = () => false, after = later, cancel = cancelLater}) {
  let idleTimer = null, disposed = false;

  // Back to the start: what plays stops, the day runs, the camera goes to the overview.
  function rest() {
    idleTimer = null;
    if (disposed) return;
    const s = parking?.story;
    if (hidden() || (s?.running && s.auto && !s.paused) || (building?.running && !world.paused)) { arm(); return; }
    if (s?.running) parking.stopStory();
    building?.stop();
    ui.stopScenario?.();
    if (world.paused) world.setPaused(false);
    if (current() !== 'overview') void select('overview', {guided: true});
    ui.render?.();
  }
  function arm() { cancel(idleTimer); idleTimer = disposed ? null : after(rest, IDLE_MS); }
  arm();

  return {
    // Any touch, key or wheel on the page: the quiet minute starts again.
    touch: arm,
    // A jump in time or Night/Day: what plays by itself stops (the stories too: they hold the clock).
    stopActivity() { building?.stop(); if (parking?.story.running) parking.stopStory(); ui.stopScenario?.(); cancelFlight(); },
    // Another tab: a scenario stops (its flight too).
    hiddenPage() { ui.stopScenario?.(); cancelFlight(); ui.render?.(); },
    dispose() { disposed = true; cancel(idleTimer); idleTimer = null; },
  };
}
