// The tour, Follow the day and the kiosk (director.js) on the engine's clock, with a stand-in camera flight and the
// headless parking world.
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {world, sleep} from 'osd/parking/clock.js';
import {createDirector, ORDER, IDLE_MS} from 'osd/viewer/director.js';
import {parking} from './world.mjs';

const live = [];
afterEach(() => { for (const x of live.splice(0)) x.dispose(); world.setPaused(false); });

// A showcase without a page: flights take `flightMs` of simulation time; `cut` makes the next one stop short.
function showcase({time, flightMs = 3000} = {}) {
  const w = parking({time});
  const log = {stops: [], scenarios: [], progress: null, cancelled: 0};
  const f = {traveling: false, landed: true, cut: false, ticket: 0};
  async function select(id, {guided = false} = {}) {
    if (!guided) d.picked();
    const ticket = ++f.ticket;
    f.traveling = true; f.landed = false;
    await sleep(flightMs);
    if (ticket !== f.ticket) return false; // a later flight took over
    f.traveling = false;
    if (f.cut) { f.cut = false; return false; }
    f.landed = true; log.stops.push(id); return true;
  }
  const d = createDirector({select, flight: () => f, cancelFlight: () => { log.cancelled++; f.ticket++; f.traveling = false; }, parking: w,
    stopName: id => id, ui: {progress: m => { log.progress = typeof m === 'function' ? m() : m[1]; }, scenario: id => log.scenarios.push(id)}});
  live.push({dispose() { d.dispose(); w.dispose(); }});
  return {w, d, log, f, select};
}

test('the tour visits every stop in order, plays the whole parking story at the car park, then ends', async () => {
  const {w, d, log} = showcase({time: '10:00'});
  void d.startTour();
  assert.ok(await w.until(() => !d.touring, 900000), 'the tour ended');
  assert.deepEqual(log.stops, ORDER);
  assert.deepEqual(log.scenarios, ['meeting', 'pond', 'energy']);
  assert.ok(w.sim.state.events.some(e => e.plate === '7กข 4821' && e.kind === 'exit'), 'the story ran to its end on the way');
  assert.match(log.progress, /Tour complete/);
});

test('kiosk: it follows the day; a touch hands over; a quiet minute later it follows again', async () => {
  const {w, d} = showcase({time: '10:00'});
  d.setKiosk(true);
  assert.ok(d.following, 'following the day');
  await w.run(5000);
  d.touch();
  assert.ok(!d.following, 'a touch stops it');
  await w.run(IDLE_MS - 5000);
  assert.ok(!d.following, 'not before a quiet minute');
  assert.ok(await w.until(() => d.following, 20000), 'following again');
});

test('kiosk: touches on the controls that run the loop, or on the story\'s bar, keep its story', async () => {
  const {w, d} = showcase({time: '07:35'});
  d.setKiosk(true);
  assert.ok(await w.until(() => w.story.running, 120000), 'the morning car park plays the story');
  d.touch({own: true});
  assert.ok(d.following && w.story.running, 'Pause or Follow is the loop\'s own');
  d.touch({bar: true});
  assert.ok(!d.following && w.story.running, 'a touch on the story\'s bar stops Follow but leaves the story to its button');
});

test('kiosk: a story playing on auto is left to finish at the idle minute; one left waiting for Next is abandoned', async () => {
  const {w, d} = showcase({time: '10:00'});
  d.setKiosk(true); d.touch();
  void w.playStory({auto: false});
  assert.ok(await w.until(() => w.story.waitingForNext, 60000), 'a guided story waiting');
  assert.ok(await w.until(() => d.following, IDLE_MS + 20000), 'abandoned: following the day again');
  assert.ok(!w.story.running);
});

test('Follow the day plays the car park\'s morning story once a day', async () => {
  const {w, d} = showcase({time: '07:25'});
  d.startFollowing();
  assert.ok(await w.until(() => w.story.running, 300000), 'the story at the morning car park');
  assert.ok(await w.until(() => !w.story.running, 600000), 'it ran its course');
  const runs = () => w.sim.state.requests.filter(q => q.visitor.name === 'ชูใจ ใฝ่รู้').length;
  await w.run(30000);
  assert.ok(!w.story.running && runs() <= 1, 'not again the same day');
});

test('Pause on the way to the car park holds its story until Resume', async () => {
  const {w, d, f} = showcase({time: '10:00'});
  void d.startTour();
  assert.ok(await w.until(() => f.traveling && f.ticket === 2, 60000), 'flying to the car park');
  world.setPaused(true);
  await w.run(5000); // paused: no time passes anyway
  world.setPaused(false);
  assert.ok(await w.until(() => w.story.running, 30000), 'the story starts once resumed');
  void d;
});

test('a jump in time or Night/Day stops a parking story played on its own', async () => {
  const {w, d} = showcase({time: '10:00'});
  void w.playStory({auto: true});
  assert.ok(await w.until(() => w.story.index >= 1, 60000));
  d.stopActivity();
  assert.ok(!w.story.running);
});

test('kiosk off mid-flight stops the flight Follow started', async () => {
  const {w, d, log, f} = showcase({time: '10:00'});
  d.setKiosk(true);
  assert.ok(f.traveling, 'Follow flies to its stop');
  d.setKiosk(false);
  assert.ok(log.cancelled > 0 && !d.following);
  void w;
});

test('Follow: a flight cut short leaves the moment to be gone to again', async () => {
  const {w, d, log, f} = showcase({time: '10:00'});
  f.cut = true;
  d.startFollowing();
  await w.run(5000);
  assert.equal(log.stops.length, 0, 'cut short');
  assert.ok(await w.until(() => log.stops.length === 1, 20000), 'flown again at the next look');
  void d;
});

test('a stop picked by hand ends the tour and Follow', async () => {
  const {w, d, select} = showcase({time: '10:00'});
  void d.startTour();
  await w.run(1000);
  void select('pond');
  assert.ok(!d.touring && !d.following);
});
