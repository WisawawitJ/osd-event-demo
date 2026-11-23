// Back to the start after a quiet minute (director.js) on the engine's clock, with a stand-in camera flight and the
// headless parking world.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {world, sleep} from 'osd/parking/clock.js';
import {createDirector, IDLE_MS} from 'osd/viewer/director.js';
import {parking} from './world.mjs';

const live = [];
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
  world.setPaused(false);
});

// A showcase without a page: flights take `flightMs` of simulation time. `timer`: the idle timer by hand instead of
// the engine's clock (the page runs it on real time, which a paused day does not stop).
function showcase({
  time,
  flightMs = 3000,
  timer = null,
  hidden = () => false,
  landed = () => true,
  followFromStart = false,
} = {}) {
  const w = parking({time});
  const log = {stops: [], stopped: 0, cancelled: 0};
  let at = 'overview';
  async function select(id) {
    await sleep(flightMs);
    at = id;
    log.stops.push(id);
    return true;
  }
  const d = createDirector({
    select,
    parking: w,
    current: () => at,
    hidden,
    landed,
    cancelFlight: () => log.cancelled++,
    followFromStart,
    ui: {stopScenario: () => log.stopped++},
    ...(timer && {
      after: (fn) => {
        timer.fn = fn;
        return fn;
      },
      cancel: () => {
        timer.fn = null;
      },
    }),
  });
  live.push({
    dispose() {
      d.dispose();
      w.dispose();
    },
  });
  return {
    w,
    d,
    log,
    go: (id) => {
      at = id;
    },
  };
}

test('left alone for a minute at another stop, it flies back to the overview; each touch starts the minute again', async () => {
  const {w, d, log, go} = showcase({time: '10:00'});
  go('pond');
  await w.run(IDLE_MS - 5000);
  d.touch();
  await w.run(IDLE_MS - 5000);
  assert.deepEqual(log.stops, [], 'not before a quiet minute');
  assert.ok(await w.until(() => log.stops.length === 1, 20000), 'back after a quiet minute');
  assert.deepEqual(log.stops, ['overview']);
  assert.ok(log.stopped > 0, 'a scenario left playing stops');
});

test('at the overview already, a quiet minute only stops what plays', async () => {
  const {w, log} = showcase({time: '10:00'});
  await w.run(IDLE_MS + 5000);
  assert.deepEqual(log.stops, []);
  assert.ok(log.stopped > 0);
});

test('a story playing by itself on auto-advance is left to finish; one left waiting for Next is abandoned', async () => {
  {
    const {w, log, go} = showcase({time: '10:00'});
    go('parking');
    void w.playStory({auto: true});
    await w.run(IDLE_MS + 5000);
    assert.ok(w.story.running && log.stops.length === 0, 'still playing after the minute');
    assert.ok(await w.until(() => !w.story.running, 900000), 'it ran its course');
    assert.ok(await w.until(() => log.stops.includes('overview'), IDLE_MS + 10000), 'then back to the overview');
  }
  {
    const {w, d, log, go} = showcase({time: '10:00'});
    go('parking');
    void w.playStory({auto: false});
    assert.ok(await w.until(() => w.story.waitingForNext, 60000), 'a guided story waiting');
    d.touch();
    assert.ok(await w.until(() => log.stops.includes('overview'), IDLE_MS + 10000), 'abandoned: back to the overview');
    assert.ok(!w.story.running);
  }
});

test('a day left paused runs again', async () => {
  const timer = {fn: null};
  const {w, log, go} = showcase({time: '10:00', timer});
  go('energy');
  world.setPaused(true);
  timer.fn(); // the quiet minute, on real time
  assert.ok(!world.paused, 'running again');
  assert.ok(await w.until(() => log.stops.includes('overview'), 10000));
});

test('out of sight (another tab), it waits until the page shows again', async () => {
  let hidden = true;
  const {w, log, go} = showcase({time: '10:00', hidden: () => hidden});
  go('meeting');
  await w.run(IDLE_MS * 2 + 5000);
  assert.deepEqual(log.stops, []);
  hidden = false;
  assert.ok(await w.until(() => log.stops.length === 1, IDLE_MS + 10000));
});

test('a jump in time or Night/Day stops a parking story played on its own', async () => {
  const {w, d} = showcase({time: '10:00'});
  void w.playStory({auto: true});
  assert.ok(await w.until(() => w.story.index >= 1, 60000));
  d.stopActivity();
  assert.ok(!w.story.running);
});

test('following the day, the camera goes to the stop of the moment, and on when the next one comes', async () => {
  const {w, d, log} = showcase({time: '08:50'});
  d.toggleFollow();
  assert.equal(d.follow, 'on');
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  assert.deepEqual(log.stops, ['parking'], 'the morning arrivals');
  assert.ok(await w.until(() => log.stops.length === 2, 60000), 'on at 09:00');
  assert.deepEqual(log.stops, ['parking', 'meeting']);
  await w.run(20000);
  assert.equal(log.stops.length, 2, 'it stays there');
});

test('following: a touch hands over, a quiet minute later it follows again; its own controls do not stop it', async () => {
  const {w, d, log, go} = showcase({time: '10:00'});
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  d.touch({own: true});
  assert.equal(d.follow, 'on');
  d.touch();
  assert.equal(d.follow, 'waiting');
  go('pond');
  await w.run(IDLE_MS - 5000);
  assert.equal(log.stops.length, 1, 'the visitor has it');
  assert.ok(await w.until(() => d.follow === 'on' && log.stops.length === 2, 20000));
  assert.ok(!log.stops.includes('overview'), 'back to the day, not to the overview');
});

test('following again goes to the stop even if it is the one on show (its view may have been moved)', async () => {
  const {w, d, log} = showcase({time: '10:00'});
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  d.touch();
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 2, 10000));
  assert.deepEqual(log.stops, ['meeting', 'meeting']);
});

test('turned off, it stays off: a quiet minute goes back to the overview', async () => {
  const {w, d, log} = showcase({time: '10:00'});
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  d.toggleFollow();
  assert.equal(d.follow, 'off');
  assert.ok(await w.until(() => log.stops.length === 2, IDLE_MS + 10000));
  assert.equal(log.stops[1], 'overview');
});

test('a paused day left alone runs again, and is followed again', async () => {
  const timer = {fn: null};
  const {w, d} = showcase({time: '10:00', timer});
  d.toggleFollow();
  await w.run(5000);
  world.setPaused(true);
  timer.fn();
  assert.ok(!world.paused && d.follow === 'on');
  assert.ok(timer.fn, 'the next quiet minute is counted');
});

test('followed from the start: the overview a moment, then the day; a touch before that hands over', async () => {
  {
    const {w, d, log} = showcase({time: '10:00', followFromStart: true});
    assert.equal(d.follow, 'on');
    await w.run(5000);
    assert.deepEqual(log.stops, [], 'the overview first');
    assert.ok(await w.until(() => log.stops.length === 1, 10000));
    assert.deepEqual(log.stops, ['meeting']);
  }
  {
    const {w, d, log} = showcase({time: '10:00', followFromStart: true});
    d.touch();
    await w.run(30000);
    assert.deepEqual(log.stops, []);
    assert.equal(d.follow, 'waiting');
  }
});

test('following waits while a story plays (started without a touch)', async () => {
  const {w, d, log} = showcase({time: '08:50'});
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  void w.playStory({auto: true});
  await w.until(() => w.story.index === 5, 300000); // well past 09:00 on its own clock
  assert.deepEqual(log.stops, ['parking']);
});

test('a touch, or Stop following, on the way stops the flight; at the stop there is none to stop', async () => {
  for (const stop of ['touch', 'toggleFollow']) {
    const {w, d, log} = showcase({time: '10:00'});
    d.toggleFollow();
    await w.run(1000);
    d[stop]();
    assert.equal(log.cancelled, 1, stop);
  }
  const {w, d, log} = showcase({time: '10:00'});
  d.toggleFollow();
  await w.run(5000);
  d.touch();
  assert.equal(log.cancelled, 0);
});

test("a touch on a story's bar hands over, but lets the flight land", async () => {
  const {w, d, log} = showcase({time: '08:00'});
  d.toggleFollow();
  await w.run(1000);
  d.touch({land: true});
  assert.equal(d.follow, 'waiting');
  assert.equal(log.cancelled, 0);
});

test('a flight cut short on its final approach is flown again', async () => {
  let there = false;
  const {w, d, log} = showcase({time: '10:00', landed: () => there});
  d.toggleFollow();
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
  there = true;
  assert.ok(await w.until(() => log.stops.length === 2, 10000), 'again, though the stop is the one on show');
  await w.run(10000);
  assert.equal(log.stops.length, 2);
});

test('turned on during a story, following ends the story', async () => {
  const {w, d, log} = showcase({time: '10:00'});
  void w.playStory({auto: true});
  await w.run(3000);
  d.toggleFollow();
  assert.ok(!w.story.running);
  assert.ok(await w.until(() => log.stops.length === 1, 10000));
});
