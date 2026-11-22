// Traffic rules, run on the engine's clock in Node: no rendering, the same result every run.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {carPark} from './world.mjs';
import {GATE, STREET} from 'osd/parking/layout.js';


test('a staff car drives in from the near lane, through the barrier, and parks', async () => {
  const cp = carPark({time: '06:00'});
  const v = cp.idle()[0];
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, fromX: -40});
  assert.ok(await cp.until(() => cp.parked(v), 60000), 'parked within a minute');
  assert.ok(!cp.traffic.inspect().mouthStops.includes(v.plate), 'rolled straight into its clear aisle, without stopping at the mouth');
  assert.ok(await cp.until(() => cp.settled(), 20000), 'the gate quiet again, every counter back at 0');
  cp.dispose();
});

test('a far-lane car nearly at its turn goes in before a near-lane car further back', async () => {
  // A near-lane car took its turn as it appeared, 50 m out, ahead of a far-lane car already at its turn.
  const cp = carPark({time: '06:00', quiet: true});
  const [far, near] = cp.idle();
  cp.traffic.arrive({plate: far.plate, province: far.province, color: 1, west: true});
  assert.ok(await cp.until(() => (cp.car(far.plate)?.position.x ?? 99) < -0.9, 60000), 'the far-lane car 16 m from its turn');
  cp.traffic.arrive({plate: near.plate, province: near.province, color: 2, fromX: -70});
  assert.ok(await cp.until(() => cp.parked(far) && cp.parked(near), 90000), 'both parked');
  assert.ok(cp.entryAt(far) < cp.entryAt(near), 'the far-lane car went in first');
  cp.dispose();
});

test('a queued car sets off as the arm rises for the car ahead, not once it is past', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const b = cp.idle()[0];
  cp.traffic.arrive({plate: '1กก 1111', province: 'กรุงเทพมหานคร', color: 1, fromX: -40});
  await cp.run(300);
  cp.traffic.arrive({plate: b.plate, province: b.province, color: 2, fromX: -50});
  const alert = () => cp.sim.state.alerts.find(a => a.status === 'open' && a.plate === '1กก 1111');
  assert.ok(await cp.until(() => alert(), 30000), 'the car ahead held at the barrier for staff');
  alert().raised = Infinity; // nobody turns it away meanwhile
  assert.ok(await cp.until(() => cp.car(b.plate)?.position.z > STREET.north && cp.traffic.inspect().entryPending === 2 && !cp.traffic.inspect().inbound, 30000), 'the car behind waiting in the queue');
  const x0 = cp.car(b.plate).position.x;
  cp.sim.resolveAlert(alert().id, 'open', 'gate.reason.delivery');
  assert.ok(await cp.until(() => Math.abs(cp.car(b.plate).position.x - x0) > .05, 20000), 'the car behind sets off');
  assert.ok(cp.car('1กก 1111').position.z > 18.6, `the car ahead still at the barrier (z ${cp.car('1กก 1111').position.z.toFixed(1)})`);
  cp.dispose();
});

test('a car leaving, a VIP behind it and two queued cars with far-lane traffic all get through (no gridlock)', async () => {
  const cp = carPark({time: '03:00'});
  const pass = cp.traffic.passBy;
  cp.traffic.passBy = () => false;
  const lv = cp.idle()[0], st = cp.sim.state.stalls.find(s => s.row === 'A' && !s.occupant && s.z > 5);
  cp.sim.recordEntry({plate: lv.plate, province: lv.province, type: 'staff', stallId: st.id, color: 2});
  cp.traffic.appear(cp.key(lv));
  await cp.run(300);
  const vip = cp.idle('vip')[0], [c2, c3] = cp.idle();
  cp.traffic.leave(cp.key(lv), {west: true});
  let farTraffic = true;
  const spawn = async () => { while (farTraffic) { pass(-1); await cp.run(4400); } };
  void spawn();
  cp.traffic.arrive({plate: vip.plate, province: vip.province, color: 5, fromX: -45}); await cp.run(1500);
  cp.traffic.arrive({plate: c2.plate, province: c2.province, color: 3, fromX: -60}); await cp.run(1500);
  cp.traffic.arrive({plate: c3.plate, province: c3.province, color: 7, fromX: -70});
  await cp.until(() => cp.traffic.inspect().westExitHold, 60000);
  farTraffic = false;
  assert.ok(await cp.until(() => !cp.traffic.isAround(cp.key(lv)) && [vip, c2, c3].every(v => cp.parked(v)), 120000), `all through (counters ${JSON.stringify(cp.traffic.inspect())})`);
  cp.dispose();
});

test('a car leaving an aisle frees it once on the exit lane, not at the barrier', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const v = cp.idle()[0], bay = cp.sim.state.stalls.find(s => s.row === 'B' && !s.occupant);
  cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bay.id, color: 2});
  cp.traffic.appear(cp.key(v));
  await cp.run(300);
  cp.traffic.leave(cp.key(v), {west: false});
  let held = false, freedAt = null;
  await cp.until(() => {
    const out = cp.traffic.inspect().aisles[String(bay.aisleX)]?.out ?? 0, c = cp.car(v.plate);
    if (out > 0) held = true; else if (held && freedAt === null) freedAt = c.position.z;
    return freedAt !== null || (Math.abs(c.position.z - GATE.exitStopZ) < .3 && c.position.x > -21);
  }, 60000);
  assert.ok(freedAt !== null && freedAt > 13.8 && freedAt < 15.5, `freed on the exit lane (z ${freedAt})`);
  cp.dispose();
});

test('a busy hour of random traffic: no car drives through another, nothing stuck, everything settles', async () => {
  // Arrivals from both lanes, unknown cars denied, cars leaving both ways, through-traffic: checked every tick.
  const cp = carPark({time: '08:00', seed: 7});
  const rnd = (() => { let s = 99; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const hits = new Set();
  let sent = 0;
  for (let t = 0; t < 600000; t += 4000) {
    const r = rnd();
    if (r < .35 && cp.traffic.queued < 3) { const v = cp.idle()[0]; if (v) { cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, fromX: -60 - rnd() * 30, west: rnd() < .35}); sent++; } }
    else if (r < .55) { const k = cp.traffic.parkedKeys().find(k => cp.sim.state.presence.get(k)?.type === 'staff'); if (k && cp.traffic.leaving < 2) cp.traffic.leave(k, {west: rnd() < .35}); }
    else if (r < .62 && cp.traffic.queued < 3) cp.traffic.arrive({plate: `9ทส ${1000 + sent}`, province: 'กรุงเทพมหานคร', color: 3, fromX: -60, west: rnd() < .35});
    else cp.traffic.passBy();
    for (let i = 0; i < 80; i++) { await cp.run(50); for (const h of cp.overlaps()) hits.add(h); for (const a of cp.sim.state.alerts) if (a.status === 'open' && cp.now() - a.raised > 3000) cp.sim.resolveAlert(a.id, 'deny'); }
  }
  assert.deepEqual([...hits], [], 'no two cars overlapped');
  // Settling: unknown cars still at the barrier are turned away as before (this car park has no guard of its own).
  const deny = () => { for (const a of cp.sim.state.alerts) if (a.status === 'open' && cp.now() - a.raised > 3000) cp.sim.resolveAlert(a.id, 'deny'); return cp.settled(); };
  assert.ok(await cp.until(deny, 180000), `everything settles (${JSON.stringify(cp.traffic.inspect())})`);
  cp.dispose();
});
