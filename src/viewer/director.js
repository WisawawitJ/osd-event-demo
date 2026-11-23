// What the showcase does by itself, without a page. There are two ways to use it: free play (the simulated day always
// runs; the visitor goes where they like and tries each stop's buttons) and the stories (the building's and the car
// park's). In free play the camera can follow the day (the timeline's button): it goes to the stop of the moment
// (dayEvents) and on to the next one's when its time comes, and does nothing else there. Any touch hands over to the
// visitor. Left alone for a minute, the screen goes back to the start: whatever was left playing stops (a story playing
// by itself is left to finish: either's on auto-advance, unless paused), a paused day runs again, and the camera follows
// the day again if it was following, or flies back to the overview.
// The page (showcase.js) flies the camera, draws the panels and reports the visitor's touches. Node tests drive it
// with a stand-in flight and the headless parking world.
import {world, later, cancelLater} from 'osd/parking/clock.js';
import {dayEvents} from 'osd/viewer/building-day.js';

// A quiet minute (real time on the page: a paused day still counts down).
export const IDLE_MS = 60000;
const OPENING_MS = 8000;

// `select(id, {guided})`: flies to a stop. `cancelFlight()`. `parking`: playStory/stopStory/story. `building`: the
// building's story (running, auto, stop). `current()`: the stop on show. `ui`: stopScenario(), render(),
// followChanged(), all optional. `landed()`: the last flight got all the way there. `hidden()`: the page is out of
// sight (another tab). `followFromStart`: the day is followed from the page's opening, once the overview has been seen
// a moment (OPENING_MS).
// `after(fn, ms)` / `cancel(handle)`: the idle timer (default the engine's clock; the page gives it real time, as a
// paused day stops the engine's).
export function createDirector({
  select,
  cancelFlight = () => {},
  parking = null,
  building = null,
  current = () => 'overview',
  landed = () => true,
  ui = {},
  hidden = () => false,
  followFromStart = false,
  after = later,
  cancel = cancelLater,
}) {
  let idleTimer = null,
    disposed = false;
  // `wanted`: the button is on. `following`: and no visitor has taken over since. `fresh`: fly even to the stop on show
  // (the view of it may have been moved).
  let wanted = followFromStart,
    following = followFromStart,
    fresh = false,
    flying = false,
    lookTimer = null;
  const PLAN = [[0, 'overview'], ...dayEvents.map((e) => [e.minute, e.destination])];

  // `land`: a flight under way is left to land.
  function setFollowing(on, {land = false} = {}) {
    if (following === on) return;
    following = fresh = on;
    if (on) {
      world.setPaused(false);
      follow();
    } else if (flying && !land) cancelFlight();
    ui.followChanged?.();
  }
  function follow() {
    // Nor while a story plays, one started without a touch (the `story` option) too: it flies the camera itself.
    if (!following || disposed || flying || hidden() || building?.running || parking?.story.running) return;
    const id = PLAN.findLast(([from]) => world.minute() >= from)[1];
    if (!fresh && current() === id) return;
    fresh = false;
    flying = true;
    void Promise.resolve(select(id, {guided: true})).finally(() => {
      flying = false;
      // Cut short on its final approach (the page hidden), it counts as the stop on show.
      if (!landed()) fresh = true;
    });
  }
  // Looked at every second, on the engine's clock: the same in the browser and in tests. A flight cut short (the page
  // hidden on the way) is flown again.
  function look() {
    follow();
    lookTimer = later(look, 1000);
  }

  // Back to the start: what plays stops, the day runs, the camera goes to the overview.
  function rest() {
    idleTimer = null;
    if (disposed) return;
    const s = parking?.story;
    if (hidden() || (s?.running && s.auto && !s.paused) || (building?.running && building.auto && !world.paused)) {
      arm();
      return;
    }
    if (s?.running) parking.stopStory();
    building?.stop();
    ui.stopScenario?.();
    if (world.paused) world.setPaused(false);
    if (wanted) {
      setFollowing(true);
      arm();
    } else if (current() !== 'overview') void select('overview', {guided: true});
    ui.render?.();
  }
  function arm() {
    cancel(idleTimer);
    idleTimer = disposed ? null : after(rest, IDLE_MS);
  }
  arm();
  lookTimer = later(look, followFromStart ? OPENING_MS : 1000);

  return {
    // Any touch, key or wheel on the page: the visitor takes over from the day, and the quiet minute starts again.
    // `own`: on a control that goes with following (the button itself, Pause, the day's length, the language).
    // `land`: on a story's bar (stopped on its way to the car park, the bar under the finger went away with the layout).
    touch({own = false, land = false} = {}) {
      if (!own) setFollowing(false, {land});
      arm();
    },
    // The timeline's button: off for good, or on at once (after a visitor took over too, over a story or a paused day).
    toggleFollow() {
      wanted = !following;
      if (wanted) {
        building?.stop();
        if (parking?.story.running) parking.stopStory();
      }
      setFollowing(wanted);
      arm();
    },
    // 'on', 'waiting' (a visitor has taken over: it follows again after a quiet minute) or 'off'.
    get follow() {
      return following ? 'on' : wanted ? 'waiting' : 'off';
    },
    // A jump in time or Night/Day: what plays by itself stops (the stories too: they hold the clock). `options`: the
    // building's story's, for its stop.
    stopActivity(options) {
      building?.stop(options);
      if (parking?.story.running) parking.stopStory();
      ui.stopScenario?.();
      cancelFlight();
    },
    // Another tab: a scenario stops (its flight too).
    hiddenPage() {
      ui.stopScenario?.();
      cancelFlight();
      ui.render?.();
    },
    dispose() {
      disposed = true;
      cancel(idleTimer);
      idleTimer = null;
      cancelLater(lookTimer);
    },
  };
}
