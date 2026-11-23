// The stops' panels as markup (panels.js), and what their buttons do (scenarios.js), without a page.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {advance} from 'osd/core/clock.js';
import {panels} from 'osd/viewer/panels.js';
import {createScenarios} from 'osd/viewer/scenarios.js';
import {dayHistory, daySnapshot, dayEvents} from 'osd/viewer/building-day.js';
import {MEETING_ROOM, WATER, COOLING, SOLAR} from 'osd/viewer/building.js';
import {stops} from 'osd/viewer/stops.js';

const rooms = [{id: MEETING_ROOM, doorIds: ['d1']}];
function building({night = false} = {}) {
  const room = {light: false, climate: false, doors: {d1: false}},
    held = [],
    frames = [];
  const simulation = {
    rooms,
    selectRoom() {},
    setRoom: (id, patch) => Object.assign(room, patch),
    getState: () => ({night, rooms: {[MEETING_ROOM]: room}}),
  };
  const scenarios = createScenarios({
    simulation,
    hold: (keys) => held.push(...keys),
    frame: (fn) => frames.push(fn),
    cancelFrame: () => (frames.length = 0),
  });
  const html = (id) =>
    panels[id]({
      state: scenarios.state,
      room,
      sim: simulation.getState(),
      history: (key) => dayHistory(10 * 60 + 30, rooms, key),
      timeLabel: () => '',
    });
  // Frames for `seconds` of the demo's pace.
  async function run(seconds) {
    for (let t = 0; t < seconds; t += 0.5) {
      await advance(500);
      for (const fn of frames.splice(0)) fn(t * 1000);
    }
  }
  return {scenarios, state: scenarios.state, room, held, html, run};
}
// The height of a chart's last point.
const lastPoint = (html) => Number(/chart-line" d="M([^"]+)"/.exec(html)[1].split(',').at(-1));

test('a chart ends at what the panel reads now, not at the schedule (58% over a line at 82%)', () => {
  const b = building();
  Object.assign(b.state, daySnapshot(630, rooms).telemetry);
  const flat = lastPoint(b.html('pond'));
  b.scenarios.start('pond');
  assert.equal(b.state.water, WATER.low);
  assert.ok(lastPoint(b.html('pond')) > flat, 'lower on the chart');
  const sunny = lastPoint(b.html('energy'));
  b.state.solar = SOLAR.clear;
  b.scenarios.start('energy');
  assert.equal(b.state.solar, SOLAR.cloudy);
  assert.ok(lastPoint(b.html('energy')) > sunny);
});

test('every stop has its texts, and a panel, but for the car park (its console is its own)', () => {
  const b = building();
  for (const [id, stop] of Object.entries(stops)) {
    for (const key of ['panel', 'floor', 'chip'])
      assert.ok(stop[key] && !stop[key].startsWith('stop.'), `${id} ${key}`);
    if (id !== 'parking') assert.match(b.html(id), /dashboard-section/);
  }
  for (const e of dayEvents) assert.ok(stops[e.destination].icon);
});

test('a meeting cools the room over its time, on the demo clock; ending it switches its light and AC off', async () => {
  const b = building();
  b.scenarios.start('meeting');
  assert.ok(b.state.occupied && b.room.light && b.room.climate);
  assert.equal(b.state.temp, COOLING.from);
  await b.run(COOLING.seconds + 2);
  assert.ok(Math.abs(b.state.temp - COOLING.to) < 1e-6 && b.state.scenario === null);
  b.scenarios.start('meeting-end');
  assert.ok(!b.state.occupied && !b.room.light && !b.room.climate);
  assert.deepEqual([...new Set(b.held)].sort(), ['occupied', 'temp']);
});

test('a scenario stopped half-way runs no further', async () => {
  const b = building();
  b.scenarios.start('meeting');
  await b.run(3);
  const at = b.state.temp;
  b.scenarios.stop();
  await b.run(5);
  assert.ok(b.state.temp === at && at < COOLING.from && b.state.scenario === null);
});

test('at night the energy button does nothing', () => {
  const b = building({night: true}),
    before = {...b.state};
  b.scenarios.start('energy');
  assert.deepEqual(b.state, before);
});

test("the story sets each step's scene before its button, whatever was there, and its button does the step", () => {
  const b = building();
  const {prepare, act, set} = b.scenarios.story;
  for (const low of [true, false]) {
    b.scenarios.state.pondAlert = low;
    prepare('pond-low');
    assert.equal(b.state.water, WATER.normal);
    act('pond-low');
    assert.ok(b.state.pondAlert && b.state.water === WATER.low);
    prepare('pond-ok');
    act('pond-ok');
    assert.ok(!b.state.pondAlert && b.state.water === WATER.normal);
  }
  for (const solar of [0, 3, 9.4]) {
    b.state.solar = solar;
    prepare('cloud');
    act('cloud');
    assert.equal(b.state.solar, SOLAR.cloudy);
    prepare('sun');
    act('sun');
    assert.equal(b.state.solar, SOLAR.clear);
    assert.ok(b.state.load > b.state.solar);
  }
  assert.deepEqual([...set].sort(), ['load', 'pondAlert', 'solar', 'water']);
});
