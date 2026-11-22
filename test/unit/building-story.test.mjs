// The building's story (building-story.js) on the engine's clock, with a stand-in camera flight.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {world, sleep, runUntil, advance, demoNow} from 'osd/parking/clock.js';
import {createBuildingStory, STEPS} from 'osd/viewer/building-story.js';
import {parking} from './world.mjs';
import {createDirector} from 'osd/viewer/director.js';

const live = [];
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
  world.setPaused(false);
});

// A page without a page: flights take `flightMs`; `cut` makes the next one stop short (the visitor took the view).
function page({time = '10:00', flightMs = 3000} = {}) {
  const w = parking({time});
  const log = {stops: [], acts: [], changes: 0};
  const f = {cut: false};
  async function select(id) {
    await sleep(flightMs);
    if (f.cut) {
      f.cut = false;
      return false;
    }
    log.stops.push(id);
    return true;
  }
  const story = createBuildingStory({select, act: (kind) => log.acts.push(kind), changed: () => log.changes++});
  live.push({
    dispose() {
      story.stop();
      w.dispose();
    },
  });
  return {w, story, log, f, select};
}

test("it plays every step in order, working each stop's buttons, then ends and lets the clock go", async () => {
  const {story, log} = page(),
    t0 = demoNow();
  story.play();
  assert.ok(story.running && world.held, 'playing, the clock at real speed');
  assert.ok(await runUntil(() => !story.running, 300000), 'it ended');
  assert.deepEqual(
    log.stops,
    STEPS.map((s) => s.stop),
  );
  assert.deepEqual(log.acts, ['meeting', 'meeting-end', 'pond-low', 'pond-ok', 'cloud', 'sun']);
  assert.ok(!world.held, "the clock runs at the day's speed again");
  const took = (demoNow() - t0) / 1000;
  assert.ok(took > 60 && took < 100, `about ${took.toFixed(0)} s`);
});

test('started at night, the day moves on to 10:00 first (the solar steps need the sun)', async () => {
  const {story} = page({time: '20:00'});
  story.play();
  assert.equal(Math.floor(world.minute()), 600);
});

test('Next goes on at once; Pause (the day paused) holds it; Exit stops it', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => log.stops.length === 1, 10000));
  story.next();
  assert.equal(story.index, 1);
  assert.ok(await runUntil(() => log.acts.includes('meeting'), 10000));
  world.setPaused(true);
  const at = story.index;
  await advance(30000); // paused: the engine takes no time on
  assert.equal(story.index, at);
  story.next();
  assert.ok(!world.paused && story.index === at + 1, 'Next runs the day again');
  story.stop();
  assert.ok(!story.running && !world.held);
});

test('a flight cut short (the visitor took the view) ends it', async () => {
  const {story, f} = page();
  f.cut = true;
  story.play();
  assert.ok(await runUntil(() => !story.running, 10000));
});

test('left alone, a playing story is left to finish; a paused one is abandoned at the quiet minute', async () => {
  const {w, story, select} = page();
  const timer = {fn: null};
  const d = createDirector({
    select,
    parking: w,
    building: story,
    after: (fn) => {
      timer.fn = fn;
      return fn;
    },
    cancel: () => {},
  });
  live.push({dispose: () => d.dispose()});
  story.play();
  timer.fn();
  assert.ok(story.running, 'playing: left to finish');
  world.setPaused(true);
  timer.fn();
  assert.ok(!story.running && !world.paused, 'paused: abandoned, the day running again');
});
