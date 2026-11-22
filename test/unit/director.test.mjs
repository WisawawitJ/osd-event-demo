// Back to the start after a quiet minute (director.js) on the engine's clock, with a stand-in camera flight and the
// headless parking world.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {world, sleep} from 'osd/parking/clock.js';
import {createDirector, IDLE_MS} from 'osd/viewer/director.js';
import {parking} from './world.mjs';

const live = [];
afterEach(() => { for (const x of live.splice(0)) x.dispose(); world.setPaused(false); });

// A showcase without a page: flights take `flightMs` of simulation time. `timer`: the idle timer by hand instead of
// the engine's clock (the page runs it on real time, which a paused day does not stop).
function showcase({time, flightMs = 3000, timer = null, hidden = () => false} = {}) {
  const w = parking({time});
  const log = {stops: [], stopped: 0};
  let at = 'overview';
  async function select(id) {
    await sleep(flightMs);
    at = id; log.stops.push(id); return true;
  }
  const d = createDirector({select, parking: w, current: () => at, hidden, ui: {stopScenario: () => log.stopped++},
    ...timer && {after: fn => { timer.fn = fn; return fn; }, cancel: () => { timer.fn = null; }}});
  live.push({dispose() { d.dispose(); w.dispose(); }});
  return {w, d, log, go: id => { at = id; }};
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
