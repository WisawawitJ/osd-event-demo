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
  const log = {stops: [], acts: [], prepared: [], restored: 0, changes: 0};
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
  const story = createBuildingStory({
    select,
    prepare: (kind) => log.prepared.push(kind),
    act: (kind) => log.acts.push(kind),
    restore: () => log.restored++,
    changed: () => log.changes++,
  });
  live.push({
    dispose() {
      story.stop();
      w.dispose();
    },
  });
  return {w, story, log, f, select};
}
const ACTS = ['meeting', 'meeting-end', 'pond-low', 'pond-ok', 'cloud', 'sun'];

test('on auto-advance it plays every step in order, setting each scene and working its button, then lets the clock go', async () => {
  const {story, log} = page(),
    t0 = demoNow();
  story.play();
  assert.ok(story.running && world.held, 'playing, the clock at real speed');
  assert.ok(await runUntil(() => !story.running, 300000), 'it ended');
  assert.deepEqual(
    log.stops,
    STEPS.map((s) => s.stop),
  );
  assert.deepEqual(log.acts, ACTS);
  assert.deepEqual(log.prepared, ['meeting', ...ACTS]);
  assert.ok(!world.held, "the clock runs at the day's speed again");
  const took = (demoNow() - t0) / 1000;
  assert.ok(took > 80 && took < 130, `about ${took.toFixed(0)} s`);
});

test('Next by Next it waits at each cue and after it; the line tells what is about to happen, then what did', async () => {
  const {story, log} = page();
  story.play({auto: false});
  assert.ok(await runUntil(() => story.waitingForNext, 10000));
  await advance(60000);
  assert.equal(story.index, 0, 'it waits for Next');
  story.next();
  assert.equal(story.index, 1);
  story.next();
  assert.equal(story.index, 1, 'not while the camera flies');
  assert.ok(await runUntil(() => story.cue === 'meeting', 10000));
  assert.deepEqual(log.acts, []);
  const before = story.caption;
  assert.ok(before.hint);
  story.next();
  assert.deepEqual(log.acts, ['meeting'], 'Next presses the button');
  assert.ok(story.index === 1 && !story.cue && !story.caption.hint);
  assert.notDeepEqual(story.caption.body, before.body);
  await advance(60000);
  assert.equal(story.index, 1);
  story.setAuto(true);
  assert.ok(await runUntil(() => story.index === 2, 20000), 'Auto-advance takes it on from there');
});

test('the presenter presses the cued button; auto-advance then goes on without pressing it again', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => story.cue === 'meeting', 30000));
  story.press();
  assert.ok(await runUntil(() => story.index === 2, 20000));
  assert.deepEqual(log.acts, ['meeting']);
});

test('Auto-advance turned off at a cue leaves it to the presenter', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => story.cue === 'meeting', 30000));
  story.setAuto(false);
  await advance(60000);
  assert.ok(story.cue === 'meeting' && !log.acts.length && story.waitingForNext);
  // Turned on and off while the day is paused, the day stays paused.
  world.setPaused(true);
  story.setAuto(true);
  story.setAuto(false);
  assert.ok(world.paused);
});

test("started at night, or near the day's own changes in the afternoon, the day moves on to 10:00 first", async () => {
  for (const time of ['20:00', '14:45', '13:00', '08:30']) {
    const {story} = page({time});
    story.play();
    assert.equal(Math.floor(world.minute()), 600, time);
    story.stop();
  }
  const {story} = page({time: '12:30'});
  story.play();
  assert.equal(Math.floor(world.minute()), 750, 'in between it stays');
});

test('Pause (the day paused) holds it; Next runs the day again; Exit stops it', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => log.acts.includes('meeting'), 60000));
  world.setPaused(true);
  await advance(30000); // paused: the engine takes no time on
  assert.equal(story.index, 1);
  story.next();
  assert.ok(!world.paused && story.index === 2, 'Next runs the day again');
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
  story.play({auto: false});
  timer.fn();
  assert.ok(!story.running, 'waiting for Next: abandoned');
});

test('stopped at a cue and played again, it has no cue before its first step (the page redraws as the day moves on)', async () => {
  const {story} = page();
  story.play({auto: false});
  assert.ok(await runUntil(() => story.waitingForNext, 10000));
  story.next();
  assert.ok(await runUntil(() => story.cue, 10000));
  story.stop();
  world.jumpTo(20 * 60);
  const seen = [];
  const off = world.subscribe((kind) => kind === 'jump' && seen.push(story.cue));
  story.play();
  off();
  assert.deepEqual(seen, [null]);
});

test('however it ends, what it set goes back to the schedule; not when the visitor works on from what they see', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => !story.running, 300000));
  assert.equal(log.restored, 1, 'finished');
  story.play();
  story.stop();
  assert.equal(log.restored, 2, 'Exit');
  story.play();
  story.stop({keep: true});
  assert.equal(log.restored, 2, 'kept');
});

test('a press in the panel: auto-advance waits on, and does nothing in between, at a cue or after it', async () => {
  const {story, log} = page();
  story.play();
  assert.ok(await runUntil(() => story.cue === 'meeting', 30000));
  await advance(3500);
  story.pressing();
  await advance(3000);
  assert.deepEqual(log.acts, []);
  assert.ok(await runUntil(() => log.acts.length === 1, 5000), 'left, it is done for them after all');
  const {hold} = STEPS[1];
  await advance(hold - 100);
  story.pressing();
  await advance(hold - 100);
  assert.equal(story.index, 1);
});
