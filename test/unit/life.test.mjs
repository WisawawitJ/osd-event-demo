// The car park's background life over a whole world day, on screen (every car through the barrier, none made up in
// the bays): the number of cars follows the hour, and no two cars ever touch.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {world} from 'osd/core/clock.js';
import {occupancyAt} from 'osd/parking/life.js';
import {parking, overlaps} from './world.mjs';

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
// More seeds: SEEDS=1,2,3 npm test.
const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number) : [11, 4];

for (const seed of SEEDS)
  test(`a day of the car park on screen: the car count follows the hour, no car touches another (seed ${seed})`, async () => {
    const w = parking({time: '06:00', seed});
    const off = [],
      touched = new Set();
    // Every world half hour from 06:30 round to 05:30 the next morning; bodies checked every 0.25 s.
    for (let i = 1; i < 48; i++) {
      const target = (360 + i * 30) % 1440;
      let n = 0;
      assert.ok(
        await w.until(() => {
          if (++n % 5 === 0) for (const hit of overlaps(w.lot)) touched.add(hit);
          return Math.abs(world.minute() - target) < 1;
        }, 3600000),
      );
      const cars = w.sim.state.presence.size,
        want = occupancyAt(world.minute());
      if (Math.abs(cars - want) > 5) off.push(`${hhmm(world.minute())}: ${cars} cars, ${want.toFixed(0)} expected`);
    }
    w.dispose();
    assert.deepEqual(off, [], "within 5 cars of the hour's count all day");
    assert.deepEqual([...touched], [], 'no two cars touch');
  });
