// The building's readings set by hand against its daily schedule (readings.js), on the world clock.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {world} from 'osd/core/clock.js';
import {daySnapshot} from 'osd/viewer/building-day.js';
import {createReadings, HOLD_MINUTES} from 'osd/viewer/readings.js';

const rooms = JSON.parse(readFileSync(new URL('../../model/device-map.json', import.meta.url))).rooms;
const at = (minute) => {
  world.jumpTo(minute);
};
const plan = () => daySnapshot(world.minute(), rooms).telemetry;

test('a temperature set by hand stays an hour of world time, then the schedule takes it back', () => {
  at(10 * 60);
  const r = createReadings(rooms);
  r.hold(['temp']);
  assert.ok(!('temp' in r.scheduled()), 'held: the schedule does not write it');
  at(10 * 60 + HOLD_MINUTES - 5);
  assert.ok(!('temp' in r.scheduled()), 'still held after 55 minutes');
  at(10 * 60 + HOLD_MINUTES + 5);
  assert.equal(r.scheduled().temp, plan().temp, "the schedule's again after the hour");
  r.dispose();
});

test('a reading held across the 03:00 wrap keeps its time left', () => {
  at(2 * 60 + 30);
  const r = createReadings(rooms);
  r.hold(['temp']);
  at(3 * 60 + 10); // past the wrap: the clock went back a day
  assert.ok(r.held('temp') && !('temp' in r.scheduled()), 'still held 40 minutes on');
  at(3 * 60 + 40);
  assert.ok('temp' in r.scheduled(), 'back to the schedule after its hour');
  r.dispose();
});

test('"low water" set by hand stays while the day runs on, until the schedule changes the level itself', () => {
  at(10 * 60);
  const r = createReadings(rooms);
  r.hold(['pondAlert', 'water']);
  at(13 * 60);
  assert.ok(!('water' in r.scheduled()), "still the hand-set level at 13:00 (the schedule's unchanged)");
  at(15 * 60); // the schedule's own low water (14:50–16:00)
  assert.equal(r.scheduled().water, plan().water, "the schedule's own change takes over");
  r.dispose();
});

test('a sun-returning override ends at sunset', () => {
  at(12 * 60);
  const r = createReadings(rooms);
  r.hold(['solar', 'load']);
  assert.ok(!('solar' in r.scheduled()), 'held while the sun is up');
  at(19 * 60);
  assert.equal(plan().solar, 0, 'dark by 19:00');
  assert.equal(r.scheduled().solar, 0, 'the override ended with the sun');
  r.dispose();
});

test("released, a reading is the schedule's again at once; the others stay held", () => {
  at(10 * 60);
  const r = createReadings(rooms);
  r.hold(['temp', 'occupied', 'solar']);
  r.release(['temp', 'occupied']);
  const now = r.scheduled();
  assert.equal(now.temp, plan().temp);
  assert.equal(now.occupied, plan().occupied);
  assert.ok(!('solar' in now));
  r.dispose();
});
