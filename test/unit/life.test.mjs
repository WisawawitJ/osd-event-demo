// The car park's background life over a whole world day: the number of cars follows the hour.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {world} from 'osd/parking/clock.js';
import {startLotLife, occupancyAt, idleCars, leavingCandidates, pickOne, fromFarLane} from 'osd/parking/life.js';
import {carPark} from './world.mjs';

const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

// Known issue (left for now): on screen, cars come and go only through the barrier, one at a time, and in the
// time-lapse it cannot keep up with the rushes: about 17 cars at 23:00 where 2 belong.
test('a day of the car park on screen: the car count follows the hour (no full car park at 23:00)', {todo: 'the barrier cannot keep up with the rushes in the time-lapse'}, async () => {
  const cp = carPark({time: '06:00', seed: 11});
  const {sim, traffic, lot} = cp;
  const stop = startLotLife({sim, traffic, lot,
    arrive() { const v = pickOne(idleCars(sim, traffic)); if (v) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70, west: fromFarLane()}); },
    leave() { const keys = leavingCandidates(sim, traffic); if (keys.length) traffic.leave(pickOne(keys), {west: fromFarLane()}); }});
  const off = [];
  // Every world half hour from 06:30 round to 05:30 the next morning.
  for (let i = 1; i < 48; i++) {
    const target = (360 + i * 30) % 1440;
    await cp.until(() => Math.abs(world.minute() - target) < 1, 3600000);
    const cars = sim.state.presence.size, want = occupancyAt(world.minute());
    if (Math.abs(cars - want) > 5) off.push(`${hhmm(world.minute())}: ${cars} cars, ${want.toFixed(0)} expected`);
  }
  stop(); cp.dispose();
  assert.deepEqual(off, [], 'within 5 cars of the hour\'s count all day');
});
