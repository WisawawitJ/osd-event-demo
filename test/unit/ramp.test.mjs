// The clock (clock.js): its fades (ramp), a function of the time whatever the frames, and its stepping.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ramp, advance, realNow, demoNow} from 'osd/parking/clock.js';

test('a ramp runs toward its target at 1 per `ms`, from where it stood, and reads the same at the same moment', async () => {
  const r = ramp(400, 0), t0 = realNow();
  r.set(1);
  await advance(100);
  assert.equal(r.value(), (realNow() - t0) / 400);
  r.set(0); // halfway back from where it stood
  const at = realNow(), from = r.value();
  await advance(50);
  assert.equal(r.value(), from - (realNow() - at) / 400);
  await advance(400);
  assert.ok(r.done() && r.value() === 0);
  assert.equal(r.endsAt, at + from * 400);
});

test('a ramp set again toward the same target does not restart', async () => {
  const r = ramp(400, 0);
  r.set(1); await advance(200); const v = r.value();
  r.set(1);
  assert.equal(r.value(), v);
});

test('a step of no time leaves the clock running (it stood still for good after one)', async () => {
  await advance(0);
  const t0 = demoNow();
  await advance(100);
  assert.equal(demoNow(), t0 + 100);
});
