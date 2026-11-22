// The parking story, played on the headless world: every step, both branches, and what a presenter can do mid-way.
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {STORY} from 'osd/parking/sim.js';
import {world, demoNow} from 'osd/parking/clock.js';
import {parking} from './world.mjs';

const noop = () => {};
// A console that records what the story shows: the cued button, the tab, captions.
function recordingUi() {
  const seen = {cue: null, tab: null, caption: null, flights: []};
  const panel = {show: (tab) => { seen.tab = tab; }, setCue: n => { seen.cue = n; }, reset: noop, render: noop, markNew: noop, flash: noop, setSnapshot: noop};
  const overlays = {setCue: noop, caption: noop, reset: noop, refresh: noop, showAlert: noop, showFeed: noop, updateFeed: noop, hideFeed: noop, toast: noop};
  return {seen, ui: {panel, overlays, caption: c => { seen.caption = c; }, fly: name => seen.flights.push(name)}};
}
// Each test's world is disposed after it, passed or failed (a story left running held the world clock for the next).
const live = [];
afterEach(() => { for (const w of live.splice(0)) w.dispose(); });
const start = (options = {}) => { const r = recordingUi(); const w = parking({ui: r.ui, ...options}); live.push(w); return {w, seen: r.seen}; };
const events = (w, plate) => w.sim.state.events.filter(e => e.plate === plate).map(e => e.kind);
const request = w => w.sim.state.requests.find(q => q.visitor.name === STORY.visitor.name);
// Plays the story; resolves its outcome into `out.result`.
const play = (w, auto = true) => { const out = {}; w.playStory({auto}).then(r => { out.result = r; }); return out; };

test('the story plays end to end on auto-advance: request, approval, the visitor in and out, the unknown car denied', async () => {
  const {w} = start(), out = play(w);
  assert.ok(await w.until(() => out.result, 600000), 'the story finished');
  assert.equal(out.result, 'done');
  assert.equal(request(w)?.status, 'approved');
  assert.deepEqual(['entry', 'exit'].filter(k => events(w, STORY.plate).includes(k)), ['entry', 'exit'], 'the visitor in and out');
  assert.ok(events(w, STORY.unknown.plate).includes('denied'), 'the unknown car denied');
  w.dispose();
});

test('rejected at step 4, the story still finishes: the visitor is turned away at the barrier, nothing left open', async () => {
  const {w} = start();
  w.sim.approve = id => w.sim.reject(id, 'ไม่มีนัดหมาย');
  const out = play(w);
  assert.ok(await w.until(() => out.result, 600000));
  assert.equal(request(w)?.status, 'rejected');
  const visitor = events(w, STORY.plate);
  assert.ok(!visitor.includes('entry') && visitor.includes('denied'), `turned away, never in (${visitor})`);
  assert.equal(w.sim.state.alerts.filter(a => a.status === 'open').length, 0);
  w.dispose();
});

test('guided: Next moves it on, and at a cue does the action for the presenter', async () => {
  const {w, seen} = start(), out = play(w, false);
  for (let i = 0; i < 3; i++) { assert.ok(await w.until(() => w.story.index === i && w.story.waitingForNext, 120000), `waits at step ${i + 1}`); w.story.next(); }
  assert.ok(await w.until(() => seen.cue === 'approve' && w.story.waitingForNext, 60000), 'the Approve cue, waiting');
  assert.equal(request(w).status, 'pending', 'nothing done for the presenter yet');
  w.story.next();
  await w.run(200);
  assert.equal(request(w).status, 'approved');
  w.story.stop(); await w.run(100); assert.equal(out.result, 'stopped');
  w.dispose();
});

test('unticking Auto-advance at the Approve cue leaves the approval to the presenter', async () => {
  const {w, seen} = start(); play(w);
  assert.ok(await w.until(() => seen.cue === 'approve', 120000));
  w.story.setAuto(false);
  await w.run(10000);
  assert.equal(request(w).status, 'pending');
  assert.ok(w.story.waitingForNext);
  w.story.next(); await w.run(200);
  assert.equal(request(w).status, 'approved');
  w.dispose();
});

test('a console tap waits a cue out (6 s after the last), but only one during that cue', async () => {
  const {w, seen} = start(); play(w);
  w.story.touched(); // early, before any cue: must not slow the cues
  assert.ok(await w.until(() => seen.cue === 'approve', 120000));
  let t0 = demoNow();
  assert.ok(await w.until(() => request(w).status === 'approved', 20000));
  assert.ok(demoNow() - t0 < 4000, `approved ${(demoNow() - t0) / 1000} s after the cue (2.6 s normally)`);
  assert.ok(await w.until(() => seen.cue === 'deny', 120000), 'the Deny cue at step 7');
  t0 = demoNow(); w.story.touched();
  const alertOpen = () => w.sim.state.alerts.some(a => a.status === 'open' && a.plate === STORY.unknown.plate);
  await w.run(5000);
  assert.ok(alertOpen(), 'still waiting 5 s after a touch during the cue');
  assert.ok(await w.until(() => !alertOpen(), 20000));
  w.dispose();
});

test('Pause stops the phone typing; Auto-advance off while paused unpauses (the bar has Next, no Resume)', async () => {
  const {w} = start(); play(w);
  assert.ok(await w.until(() => w.phone.form.name.length > 2, 60000), 'typing the name');
  w.story.pause();
  const typed = () => ['name', 'email', 'contact', 'company', 'phone'].reduce((n, f) => n + w.phone.form[f].length, 0);
  const a = typed(); await w.run(5000); const b = typed();
  assert.equal(a, b, 'no typing while paused');
  w.story.setAuto(false);
  assert.equal(w.story.paused, false);
  w.dispose();
});

test('left at step 7, the story\'s unknown car is a background one: turned away after 8 s, not 45', async () => {
  const {w} = start(); play(w);
  const alert = () => w.sim.state.alerts.find(a => a.plate === STORY.unknown.plate);
  assert.ok(await w.until(() => alert()?.status === 'open', 300000), 'step 7\'s alert');
  w.story.stop();
  await w.run(10000);
  assert.equal(alert().status, 'denied');
  w.dispose();
});

test('left before its unknown car reaches the barrier: that car comes as a background one', async () => {
  const {w} = start(); play(w);
  assert.ok(await w.until(() => w.story.index === 6, 300000), 'step 7');
  w.story.stop();
  const alert = () => w.sim.state.alerts.find(a => a.plate === STORY.unknown.plate);
  assert.ok(await w.until(() => alert(), 60000), 'its car at the barrier');
  assert.equal(alert().ambient, true);
  assert.ok(await w.until(() => alert().status === 'denied', 10000), 'turned away within 8 s');
  w.dispose();
});

test('the story holds the world clock at real speed and gives it back', async () => {
  const {w} = start(); play(w);
  assert.ok(await w.until(() => w.story.index === 2, 120000));
  const a = world.now(); await w.run(1000); const b = world.now();
  assert.ok(b - a < 1500, `real speed during the story (${b - a} ms in 1 s)`);
  w.story.stop();
  const c = world.now(); await w.run(1000); const d = world.now();
  assert.ok(d - c > 20000, `time-lapse again after (${d - c} ms in 1 s)`);
  w.dispose();
});

test('a story whose visitor cleared a field before Send still sends its request', async () => {
  const {w} = start(); play(w, false);
  assert.ok(await w.until(() => w.story.waitingForNext, 120000), 'step 1 typed');
  w.phone.setForm({email: ''});
  w.story.next();
  assert.ok(await w.until(() => w.story.index === 1 && w.story.waitingForNext, 60000));
  assert.ok(request(w), 'the request was sent');
  w.dispose();
});

test('pausing the demo stops everything: no simulation time passes, nothing moves', async () => {
  const {w} = start({time: '08:00'});
  await w.run(5000);
  world.setPaused(true);
  const t = demoNow(), clock = world.now();
  await w.run(5000);
  assert.equal(demoNow(), t); assert.equal(world.now(), clock);
  world.setPaused(false);
  await w.run(1000);
  assert.ok(demoNow() > t);
  w.dispose();
});

test('a free-play photo read under way when the story starts does not put its plate in the story\'s form', async () => {
  const {w} = start();
  w.phone.readPhoto(); // free play: a sample plate in ~1.5 s
  const out = play(w), plates = new Set();
  await w.until(() => { const p = w.phone.form.plate; if (p) plates.add(p); return Boolean(request(w)); }, 120000);
  assert.equal(request(w).plate, STORY.plate);
  assert.deepEqual([...plates], [STORY.plate], 'only the story plate ever in its form');
  void out;
});

test('a photo read pressed during the story\'s own read does not stall it, and the story plate wins', async () => {
  const {w, seen} = start(); play(w);
  assert.ok(await w.until(() => w.phone.form.photo === 'reading', 120000), 'the story\'s read');
  w.phone.readPhoto();
  assert.ok(await w.until(() => Boolean(request(w)), 60000), 'the story went on and sent its request');
  assert.equal(request(w).plate, STORY.plate);
  void seen;
});

test('leaving the story during its photo read: what the visitor types next stays', async () => {
  const {w} = start(); play(w);
  assert.ok(await w.until(() => w.phone.form.photo === 'reading', 120000));
  w.story.stop();
  w.phone.setForm({plate: '5กข 1234'});
  await w.run(3000);
  assert.equal(w.phone.form.plate, '5กข 1234');
});
