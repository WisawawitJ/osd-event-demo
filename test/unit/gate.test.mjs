// How fast the barrier moves cars: ten leaving at once, ten arriving at once (simulation time). The full day on screen
// (life.test.mjs) needs about one car every 7 s through it in the rushes.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {carPark} from './world.mjs';

test('ten cars leaving at once from one row are all out within 80 s (each backs out as the one before it has pulled away)', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const bays = cp.sim.state.stalls.filter((s) => s.zone === 'P2' && !s.occupant && !s.reserved).slice(0, 10);
  const leavers = cp
    .idle()
    .slice(0, 10)
    .map((v, i) => {
      cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bays[i].id, color: 1});
      cp.traffic.appear(cp.key(v));
      return cp.key(v);
    });
  await cp.run(500);
  const t0 = cp.now();
  for (const k of leavers) cp.traffic.leave(k, {west: false});
  assert.ok(await cp.until(() => leavers.every((k) => !cp.sim.state.presence.has(k)), 600000));
  const took = (cp.now() - t0) / 1000;
  assert.ok(took < 80, `10 out in ${took.toFixed(0)} s`);
  assert.deepEqual(cp.overlaps(), []);
  cp.dispose();
});

test('ten cars arriving at once are all parked within 85 s (the queue moves up, each car sets off as the one ahead drives off)', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const arrivals = cp.idle().slice(0, 10),
    t0 = cp.now();
  arrivals.forEach((v, i) => cp.traffic.arrive({plate: v.plate, province: v.province, color: 2, fromX: -70 - i * 3}));
  assert.ok(await cp.until(() => arrivals.every(cp.parked), 900000));
  const took = (cp.now() - t0) / 1000;
  // About 74 s (the rushes need a car every 7 s).
  assert.ok(took < 85, `10 in in ${took.toFixed(0)} s`);
  assert.deepEqual(cp.overlaps(), []);
  cp.dispose();
});

test('a VIP waits at the barrier only for cars already turning out by it, not for every car on its way out', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const [vip] = cp.idle('vip'),
    [behind, ...out] = cp.idle().slice(0, 4);
  const bays = cp.sim.state.stalls.filter((s) => s.row === 'D' && !s.occupant).slice(0, out.length);
  out.forEach((v, i) => {
    cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bays[i].id, color: 1});
    cp.traffic.appear(cp.key(v));
  });
  await cp.run(500);
  // One sets off 10 s before the VIP comes, and is past the point of no return as the VIP is read; the others set off
  // while the VIP is at the barrier.
  cp.traffic.leave(cp.key(out[0]));
  await cp.run(10000);
  const t0 = cp.now();
  cp.traffic.arrive({plate: vip.plate, province: vip.province, color: 2, fromX: -50});
  cp.traffic.arrive({plate: behind.plate, province: behind.province, color: 2, fromX: -59});
  await cp.run(3000);
  for (const v of out.slice(1)) cp.traffic.leave(cp.key(v));
  let waited = 0,
    vipIn = 0;
  const touched = new Set();
  assert.ok(
    await cp.until(() => {
      const s = cp.traffic.inspect();
      if (s.p1Waiting && s.outbound) waited++;
      if (!vipIn && cp.parked(vip)) vipIn = (cp.now() - t0) / 1000;
      for (const hit of cp.overlaps()) touched.add(hit);
      return vipIn && cp.parked(behind) && out.every((v) => !cp.sim.state.presence.has(cp.key(v)));
    }, 120000),
  );
  const allDone = (cp.now() - t0) / 1000;
  // It waited about 3.8 s (76 ticks) for the first; it was in its bay after about 18 s, all after about 26 s.
  // (Waiting for every car on its way out, it stood at the barrier some 20 s longer.)
  assert.ok(waited > 20, `waited ${waited} ticks for the car already turning out`);
  assert.ok(vipIn < 22, `VIP in its bay after ${vipIn.toFixed(0)} s`);
  assert.ok(allDone < 32, `all in and out after ${allDone.toFixed(0)} s`);
  assert.deepEqual([...touched], []);
  assert.ok(await cp.until(cp.settled, 30000));
  cp.dispose();
});

test('a car leaving P2 stops short of the way into P1 while a VIP crosses it, then goes on; no car touches another', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const [vip] = cp.idle('vip'),
    [v] = cp.idle();
  const bay = cp.sim.state.stalls.find((s) => s.row === 'B' && !s.occupant && s.z > 0);
  cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bay.id, color: 1});
  cp.traffic.appear(cp.key(v));
  await cp.run(500);
  // Timed so that it comes up the exit lane as the VIP is read at the barrier and crosses.
  cp.traffic.leave(cp.key(v));
  await cp.run(3500);
  cp.traffic.arrive({plate: vip.plate, province: vip.province, color: 2, fromX: -40});
  let held = 0;
  const touched = new Set();
  assert.ok(
    await cp.until(() => {
      const c = cp.car(v.plate),
        s = cp.traffic.inspect();
      // Standing on the exit lane at its holding point (OUT_COMMIT_X, -28.5), a VIP at the barrier or on its way.
      if (
        c?.visible &&
        Math.abs(c.position.z - 14.8) < 0.3 &&
        c.position.x > -31 &&
        c.position.x < -28 &&
        (s.p1Waiting || s.p1OnLane)
      )
        held++;
      for (const hit of cp.overlaps()) touched.add(hit);
      return cp.parked(vip) && !cp.sim.state.presence.has(cp.key(v));
    }, 60000),
  );
  // About 2.3 s (46 ticks); without the hold it only braked there for the VIP, under half a second.
  assert.ok(held > 30, `held at the point for ${held} ticks`);
  assert.deepEqual([...touched], []);
  assert.ok(await cp.until(cp.settled, 30000));
  cp.dispose();
});
