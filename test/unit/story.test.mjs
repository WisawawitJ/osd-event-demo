// The parking story, played on the headless world: every step, both branches, and what a presenter can do mid-way.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {STORY} from 'osd/parking/sim.js';
import {world, demoNow} from 'osd/core/clock.js';
import {createDirector} from 'osd/viewer/director.js';
import {parking} from './world.mjs';

const noop = () => {};
// A console that records the button the story cues.
function recordingUi() {
  const seen = {cue: null};
  return {
    seen,
    ui: {
      panel: {
        show: noop,
        setCue: (n) => {
          seen.cue = n;
        },
        reset: noop,
        flash: noop,
      },
    },
  };
}
// Each test's world is disposed after it, passed or failed (a story left running held the world clock for the next).
const live = [];
afterEach(() => {
  for (const w of live.splice(0)) w.dispose();
});
const start = (options = {}) => {
  const r = recordingUi();
  const w = parking({ui: r.ui, ...options});
  live.push(w);
  return {w, seen: r.seen};
};
const events = (w, plate) => w.sim.state.events.filter((e) => e.plate === plate).map((e) => e.kind);
const request = (w) => w.sim.state.requests.find((q) => q.visitor.name === STORY.visitor.name);
// Plays the story; resolves its outcome into `out.result`.
const play = (w, auto = true) => {
  const out = {};
  w.playStory({auto}).then((r) => {
    out.result = r;
  });
  return out;
};

test('the story plays end to end on auto-advance: request, approval, the visitor in and out, the unknown car denied', async () => {
  const {w} = start(),
    out = play(w);
  assert.ok(await w.until(() => out.result, 600000), 'the story finished');
  assert.equal(out.result, 'done');
  assert.equal(request(w)?.status, 'approved');
  assert.deepEqual(
    ['entry', 'exit'].filter((k) => events(w, STORY.plate).includes(k)),
    ['entry', 'exit'],
    'the visitor in and out',
  );
  assert.ok(events(w, STORY.unknown.plate).includes('denied'), 'the unknown car denied');
});

test('rejected at step 4, the story still finishes: the visitor is turned away at the barrier, nothing left open', async () => {
  const {w} = start();
  w.sim.approve = (id) => w.sim.reject(id, 'ไม่มีนัดหมาย');
  const out = play(w);
  assert.ok(await w.until(() => out.result, 600000));
  assert.equal(request(w)?.status, 'rejected');
  const visitor = events(w, STORY.plate);
  assert.ok(!visitor.includes('entry') && visitor.includes('denied'), `turned away, never in (${visitor})`);
  assert.equal(w.sim.state.alerts.filter((a) => a.status === 'open').length, 0);
});

test('guided: Next moves it on, and at a cue does the action for the presenter', async () => {
  const {w, seen} = start(),
    out = play(w, false);
  for (let i = 0; i < 3; i++) {
    assert.ok(await w.until(() => w.story.index === i && w.story.waitingForNext, 120000), `waits at step ${i + 1}`);
    w.story.next();
  }
  assert.ok(await w.until(() => seen.cue === 'approve' && w.story.waitingForNext, 60000), 'the Approve cue, waiting');
  assert.equal(request(w).status, 'pending', 'nothing done for the presenter yet');
  w.story.next();
  await w.run(200);
  assert.equal(request(w).status, 'approved');
  w.story.stop();
  await w.run(100);
  assert.equal(out.result, 'stopped');
});

test('unticking Auto-advance at the Approve cue leaves the approval to the presenter', async () => {
  const {w, seen} = start();
  play(w);
  assert.ok(await w.until(() => seen.cue === 'approve', 120000));
  w.story.setAuto(false);
  await w.run(10000);
  assert.equal(request(w).status, 'pending');
  assert.ok(w.story.waitingForNext);
  w.story.next();
  await w.run(200);
  assert.equal(request(w).status, 'approved');
});

test('a console tap waits a cue out (6 s after the last), but only one during that cue', async () => {
  const {w, seen} = start();
  play(w);
  w.story.touched(); // early, before any cue: must not slow the cues
  assert.ok(await w.until(() => seen.cue === 'approve', 120000));
  let t0 = demoNow();
  assert.ok(await w.until(() => request(w).status === 'approved', 20000));
  assert.ok(demoNow() - t0 < 4000, `approved ${(demoNow() - t0) / 1000} s after the cue (2.6 s normally)`);
  assert.ok(await w.until(() => seen.cue === 'deny', 120000), 'the Deny cue at step 7');
  t0 = demoNow();
  w.story.touched();
  const alertOpen = () => w.sim.state.alerts.some((a) => a.status === 'open' && a.plate === STORY.unknown.plate);
  await w.run(5000);
  assert.ok(alertOpen(), 'still waiting 5 s after a touch during the cue');
  assert.ok(await w.until(() => !alertOpen(), 20000));
});

test("Pause (the day's) stops the story with everything else; it goes on with the day", async () => {
  const {w} = start();
  play(w);
  assert.ok(await w.until(() => w.phone.form.name.length > 2, 60000), 'typing the name');
  world.setPaused(true);
  assert.ok(w.story.paused);
  const typed = () => ['name', 'email', 'contact', 'company', 'phone'].reduce((n, f) => n + w.phone.form[f].length, 0);
  const a = typed();
  await w.run(5000);
  const b = typed();
  assert.equal(a, b, 'no typing while paused');
  world.setPaused(false);
  await w.run(1000);
  assert.ok(!w.story.paused && typed() > b, 'it types on');
  world.setPaused(true);
  w.story.stop();
  assert.ok(!world.paused, 'a story ended runs the day again');
  world.setPaused(true);
  w.story.stop();
  assert.ok(world.paused, 'with none playing, the day stays as it was');
  world.setPaused(false);
});

test("left at step 7, the story's unknown car is a background one: turned away after 8 s, not 45", async () => {
  const {w} = start();
  play(w);
  const alert = () => w.sim.state.alerts.find((a) => a.plate === STORY.unknown.plate);
  assert.ok(await w.until(() => alert()?.status === 'open', 300000), "step 7's alert");
  w.story.stop();
  await w.run(10000);
  assert.equal(alert().status, 'denied');
});

test('left before its unknown car reaches the barrier: that car comes as a background one', async () => {
  const {w} = start();
  play(w);
  assert.ok(await w.until(() => w.story.index === 6, 300000), 'step 7');
  w.story.stop();
  const alert = () => w.sim.state.alerts.find((a) => a.plate === STORY.unknown.plate);
  assert.ok(await w.until(() => alert(), 60000), 'its car at the barrier');
  assert.equal(alert().ambient, true);
  assert.ok(await w.until(() => alert().status === 'denied', 10000), 'turned away within 8 s');
});

test('the story holds the world clock at real speed and gives it back', async () => {
  const {w} = start();
  play(w);
  assert.ok(await w.until(() => w.story.index === 2, 120000));
  const a = world.now();
  await w.run(1000);
  const b = world.now();
  assert.ok(b - a < 1500, `real speed during the story (${b - a} ms in 1 s)`);
  w.story.stop();
  const c = world.now();
  await w.run(1000);
  const d = world.now();
  assert.ok(d - c > 20000, `time-lapse again after (${d - c} ms in 1 s)`);
});

test('a story whose visitor cleared a field before Send still sends its request', async () => {
  const {w} = start();
  play(w, false);
  assert.ok(await w.until(() => w.story.waitingForNext, 120000), 'step 1 typed');
  w.phone.setForm({email: ''});
  w.story.next();
  assert.ok(await w.until(() => w.story.index === 1 && w.story.waitingForNext, 60000));
  assert.ok(request(w), 'the request was sent');
});

test('pausing the demo stops everything: no simulation time passes, nothing moves', async () => {
  const {w} = start({time: '08:00'});
  await w.run(5000);
  world.setPaused(true);
  const t = demoNow(),
    clock = world.now();
  await w.run(5000);
  assert.equal(demoNow(), t);
  assert.equal(world.now(), clock);
  world.setPaused(false);
  await w.run(1000);
  assert.ok(demoNow() > t);
});

test("a free-play photo read under way when the story starts does not put its plate in the story's form", async () => {
  const {w} = start();
  w.phone.readPhoto(); // free play: a sample plate in ~1.5 s
  play(w);
  const plates = new Set();
  await w.until(() => {
    const p = w.phone.form.plate;
    if (p) plates.add(p);
    return Boolean(request(w));
  }, 120000);
  assert.equal(request(w).plate, STORY.plate);
  assert.deepEqual([...plates], [STORY.plate], 'only the story plate ever in its form');
});

test("a photo read pressed during the story's own read does not stall it, and the story plate wins", async () => {
  const {w} = start();
  play(w);
  assert.ok(await w.until(() => w.phone.form.photo === 'reading', 120000), "the story's read");
  w.phone.readPhoto();
  assert.ok(await w.until(() => Boolean(request(w)), 60000), 'the story went on and sent its request');
  assert.equal(request(w).plate, STORY.plate);
});

test('leaving the story during its photo read: what the visitor types next stays', async () => {
  const {w} = start();
  play(w);
  assert.ok(await w.until(() => w.phone.form.photo === 'reading', 120000));
  w.story.stop();
  w.phone.setForm({plate: '5กข 1234'});
  await w.run(3000);
  assert.equal(w.phone.form.plate, '5กข 1234');
});

test('a story left after its visitor parked lets that car leave once its visit is over', async () => {
  const {w} = start({onScreen: false});
  play(w);
  const k = w.sim.key(STORY.plate, STORY.province);
  assert.ok(await w.until(() => w.sim.state.presence.has(k) && !w.traffic.isAround(k), 300000), 'the visitor parked');
  w.story.stop();
  world.jumpTo(world.minute() + 240);
  assert.ok(await w.until(() => !w.sim.state.presence.has(k), 30000), 'gone after its visit');
});

test('guided: Free play at the Approve cue does not approve', async () => {
  const {w, seen} = start();
  play(w, false);
  for (let i = 0; i < 3; i++) {
    assert.ok(await w.until(() => w.story.index === i && w.story.waitingForNext, 120000));
    w.story.next();
  }
  assert.ok(await w.until(() => seen.cue === 'approve', 60000));
  w.story.stop();
  await w.run(10000);
  assert.equal(request(w).status, 'pending');
});

test('a story stopped while it resets the world does not go on into its first step', async () => {
  const {w} = start();
  play(w);
  w.story.stop();
  await w.run(5000);
  assert.equal(w.story.index, -1);
  assert.equal(w.phone.isOpen, false, 'step 1 never opened the phone');
});

test('looping, it plays from the start again, the car park as it was then; Loop off, it ends', async () => {
  const {w} = start();
  w.story.setLoop(true);
  void w.playStory({auto: true});
  for (let n = 0; n < 2; n++) {
    assert.ok(await w.until(() => w.story.index === 9, 300000), 'the last step');
    assert.ok(await w.until(() => w.story.index === 0, 120000), 'and round');
    assert.ok(request(w) === undefined && w.sim.state.alerts.every((a) => a.status !== 'open'), 'afresh');
  }
  w.story.setLoop(false);
  assert.ok(await w.until(() => !w.story.running, 400000));
  assert.ok(!world.held);
});

test('a looping parking story left by a visitor plays again after a quiet minute, at the car park', async () => {
  const {w} = start();
  const stops = [];
  const d = createDirector({
    select: async (id) => {
      stops.push(id);
      return true;
    },
    parking: w,
    current: () => stops.at(-1) ?? 'parking',
  });
  live.push(d);
  w.story.setLoop(true);
  void w.playStory({auto: true});
  await w.until(() => w.story.index === 2, 60000);
  d.touch();
  w.stopStory();
  assert.ok(await w.until(() => w.story.running, 70000));
  assert.deepEqual(stops, ['parking']);
});

test("the step's progress, on auto-advance: from 0 up, to near 1 as it ends; none on Next", async () => {
  const {w} = start();
  void w.playStory({auto: true});
  await w.until(() => w.story.index === 0, 5000);
  let index = 0,
    last = 0;
  while (w.story.running) {
    if (w.story.index !== index) {
      assert.ok(last > 0.7, `step ${index + 1} ended at ${last}`);
      index = w.story.index;
      last = 0;
    }
    assert.ok(w.story.progress >= last && w.story.progress <= 1);
    last = w.story.progress;
    await w.run(200);
  }
  void w.playStory({auto: false});
  await w.until(() => w.story.index === 0, 5000);
  assert.equal(w.story.progress, null);
});

test('a step clicked: the story goes on from there, the steps before it done (request, approval, car parked, car denied)', async () => {
  for (let i = 0; i < 10; i++) {
    const {w} = start();
    void w.playStory({auto: true});
    await w.until(() => w.story.index === 0, 5000);
    await w.run(1500);
    w.story.goTo(i);
    assert.ok(await w.until(() => w.story.index === i, 5000), `at step ${i + 1}`);
    await w.run(100);
    const q = request(w),
      parked = [...w.sim.state.presence.values()].some((p) => p.plate === STORY.plate);
    assert.equal(q?.status, i < 2 ? undefined : i < 4 ? 'pending' : 'approved', `step ${i + 1}: the request`);
    assert.equal(parked, i >= 6, `step ${i + 1}: the car`);
    assert.equal(events(w, STORY.unknown.plate).includes('denied'), i >= 7, `step ${i + 1}: the unknown car`);
    if (i >= 6 && i < 9) assert.ok(w.traffic.parkedKeys().some((k) => k === w.sim.key(STORY.plate, STORY.province)));
    const steps = new Set();
    assert.ok(
      await w.until(() => {
        steps.add(w.story.index);
        return !w.story.running;
      }, 400000),
      `from step ${i + 1} to the end`,
    );
    steps.delete(-1);
    assert.deepEqual(
      [...steps],
      Array.from({length: 10 - i}, (_, k) => i + k),
    );
    assert.deepEqual(events(w, STORY.plate), ['exit', 'entry'], 'in and out, once');
  }
});

test('a step clicked during a cue: the cue is the new step’s', async () => {
  const {w, seen} = start();
  void w.playStory({auto: true});
  assert.ok(await w.until(() => seen.cue === 'approve', 60000));
  w.story.goTo(8);
  await w.until(() => w.story.index === 8, 5000);
  await w.run(300);
  assert.equal(seen.cue, null);
  w.story.goTo(3);
  assert.ok(await w.until(() => seen.cue === 'approve', 2000));
  await w.run(1000);
  assert.equal(seen.cue, 'approve', 'not cleared by the run it replaced');
});
