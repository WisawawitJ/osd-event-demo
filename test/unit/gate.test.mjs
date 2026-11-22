// How fast the barrier moves cars: ten leaving at once, ten arriving at once (simulation time). The full day on screen
// (life.test.mjs) needs about one car every 5 s through it in the rushes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carPark} from './world.mjs';

test('ten cars leaving at once from one row are all out within 80 s (each backs out as the one before it has pulled away)', async () => {
  const cp = carPark({time: '06:00'}); cp.traffic.passBy = () => false;
  const bays = cp.sim.state.stalls.filter(s => s.zone === 'P2' && !s.occupant && !s.reserved).slice(0, 10);
  const leavers = cp.idle().slice(0, 10).map((v, i) => { cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bays[i].id, color: 1}); cp.traffic.appear(cp.key(v)); return cp.key(v); });
  await cp.run(500);
  const t0 = cp.now();
  for (const k of leavers) cp.traffic.leave(k, {west: false});
  assert.ok(await cp.until(() => leavers.every(k => !cp.sim.state.presence.has(k)), 600000));
  const took = (cp.now() - t0) / 1000;
  assert.ok(took < 80, `10 out in ${took.toFixed(0)} s`);
  assert.deepEqual(cp.overlaps(), []);
  cp.dispose();
});

test('ten cars arriving at once are all parked within 75 s (the queue moves up, the arm stays up between them)', async () => {
  const cp = carPark({time: '06:00'}); cp.traffic.passBy = () => false;
  const arrivals = cp.idle().slice(0, 10), t0 = cp.now();
  arrivals.forEach((v, i) => cp.traffic.arrive({plate: v.plate, province: v.province, color: 2, fromX: -70 - i * 3}));
  assert.ok(await cp.until(() => arrivals.every(v => cp.sim.state.presence.has(cp.key(v)) && !cp.traffic.isAround(cp.key(v))), 900000));
  const took = (cp.now() - t0) / 1000;
  assert.ok(took < 75, `10 in in ${took.toFixed(0)} s`);
  assert.deepEqual(cp.overlaps(), []);
  cp.dispose();
});
