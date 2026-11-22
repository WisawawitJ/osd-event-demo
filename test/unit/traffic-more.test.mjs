// More traffic rules on the engine's clock: turning and signalling, the queue, P1, resets, a full car park.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {carPark} from './world.mjs';
import {GATE, STREET, ENTRY_TURN} from 'osd/parking/layout.js';

const QUEUE_HEAD = GATE.entryX - ENTRY_TURN - 2.23 - .8 - 2.2;
const live = [];
afterEach(() => { for (const cp of live.splice(0)) cp.dispose(); });
const quiet = (time = '06:00') => { const cp = carPark({time, quiet: true}); live.push(cp); return cp; };
const blinking = (car, side) => car?.getObjectByName(`Demo_car_blinker_${side}`)?.visible;
// Watches `fn` every tick until `until` holds; returns whether `fn` was ever true.
async function seen(cp, fn, until, ms = 60000) { let hit = false; await cp.until(() => { if (fn()) hit = true; return until(); }, ms); return hit; }

test('a far-lane car waits at its turn signalling right, then turns in across the near lane', async () => {
  const cp = quiet(), v = cp.idle()[0];
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, west: true});
  let far = false, right = false;
  await cp.until(() => { const c = cp.car(v.plate); if (Math.abs(c?.position.z - STREET.laneWest) < .3) far = true; if (blinking(c, 'right')) right = true; return cp.parked(v); }, 90000);
  assert.ok(far, 'it came along the far lane'); assert.ok(right, 'signalling right'); assert.ok(cp.parked(v), 'parked');
});

test('a car leaving for the far lane signals right and drives off westbound in it', async () => {
  const cp = quiet(), v = cp.idle()[0], bay = cp.sim.state.stalls.find(s => s.row === 'B' && !s.occupant);
  cp.sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: bay.id, color: 2});
  cp.traffic.appear(cp.key(v)); await cp.run(300);
  const k = cp.key(v), plate = v.plate;
  cp.traffic.leave(k, {west: true});
  let right = false, far = false;
  await cp.until(() => { const c = cp.car(plate); if (!c) return true; if (blinking(c, 'right')) right = true; if (Math.abs(c.position.z - STREET.laneWest) < .2 && Math.sin(c.rotation.y) < -.99) far = true; return far && c.position.x < -45; }, 90000);
  assert.ok(right, 'signalled right'); assert.ok(far, 'westbound in the far lane');
});

test('a far-lane car sent first, 110 m further out, does not hold up a near-lane car that gets to the entry first', async () => {
  const cp = quiet(), [far, near] = cp.idle();
  cp.traffic.arrive({plate: far.plate, province: far.province, color: 1, west: true});
  await cp.run(50);
  cp.traffic.arrive({plate: near.plate, province: near.province, color: 2, fromX: -40});
  assert.ok(await cp.until(() => cp.parked(far) && cp.parked(near), 90000));
  assert.ok(cp.entryAt(near) < cp.entryAt(far), 'the near-lane car went in first');
});

test('a near-lane car signals left before turning in, and while it queues', async () => {
  const cp = quiet(), [a] = cp.idle();
  cp.traffic.arrive({plate: '1กก 1111', province: 'กรุงเทพมหานคร', color: 1, fromX: -40}); // held at the barrier for staff
  await cp.run(300);
  cp.traffic.arrive({plate: a.plate, province: a.province, color: 2, fromX: -60});
  assert.ok(await cp.until(() => cp.sim.state.alerts.some(x => x.status === 'open'), 30000));
  cp.sim.state.alerts.find(x => x.status === 'open').raised = Infinity;
  assert.ok(await seen(cp, () => blinking(cp.car(a.plate), 'left'), () => false, 15000), 'signals left while it queues');
  const queued = cp.car(a.plate);
  assert.ok(queued.position.x <= QUEUE_HEAD + .2 && Math.abs(queued.position.z - STREET.laneEast) < .1, `waiting at its queue place (x ${queued.position.x.toFixed(2)})`);
});

test('the queue waits close behind the barrier; a car turned away there backs out past it', async () => {
  const cp = quiet(), [a] = cp.idle();
  cp.traffic.arrive({plate: '1กก 1111', province: 'กรุงเทพมหานคร', color: 1, fromX: -40});
  await cp.run(300);
  cp.traffic.arrive({plate: a.plate, province: a.province, color: 2, fromX: -60});
  assert.ok(await cp.until(() => cp.sim.state.alerts.some(x => x.status === 'open') && Math.abs((cp.car(a.plate)?.position.x ?? 0) - QUEUE_HEAD) < .1, 60000), 'the next car at the queue head');
  const alert = cp.sim.state.alerts.find(x => x.status === 'open');
  cp.sim.resolveAlert(alert.id, 'deny');
  assert.ok(await cp.until(() => cp.parked(a) && !cp.car('1กก 1111'), 90000), 'the turned-away car backed out and left; the next one in');
  assert.ok(cp.overlaps().length === 0);
});

test('a VIP leaving P1 and one arriving for it at the same time both get through', async () => {
  const cp = quiet('17:00'), vips = cp.sim.state.vehicles.filter(v => v.type === 'vip');
  const leaver = cp.traffic.parkedKeys().find(k => cp.sim.state.presence.get(k)?.type === 'vip');
  const arriving = vips.find(v => !cp.sim.state.presence.has(cp.key(v)));
  assert.ok(leaver && arriving, 'a VIP parked in P1 and another not');
  cp.traffic.leave(leaver, {west: false});
  cp.traffic.arrive({plate: arriving.plate, province: arriving.province, color: 5, fromX: -40});
  assert.ok(await cp.until(() => !cp.traffic.isAround(leaver) && cp.parked(arriving), 120000), JSON.stringify(cp.traffic.inspect()));
});

test('a reset while cars hold the barrier and queue: no barrier holder or queue left counted, far-lane traffic runs', async () => {
  const cp = quiet(), [a, b, c] = cp.idle();
  cp.traffic.arrive({plate: a.plate, province: a.province, color: 1, fromX: -40});
  cp.traffic.arrive({plate: b.plate, province: b.province, color: 2, fromX: -60});
  cp.traffic.arrive({plate: c.plate, province: c.province, color: 3, west: true});
  const k = cp.traffic.parkedKeys().find(k => cp.sim.state.presence.get(k)?.type === 'staff');
  cp.traffic.leave(k, {west: true});
  assert.ok(await cp.until(() => cp.traffic.gateHolders > 0, 60000), 'a car at the barrier');
  cp.sim.reset(); cp.traffic.syncParked();
  await cp.run(2000);
  const s = cp.traffic.inspect();
  assert.deepEqual([cp.traffic.gateHolders, s.entryPending, s.westExitHold, s.westOnStreet, s.inbound], [0, 0, 0, 0, 0]);
});

test('a later arrival never blocks the spawn point of an earlier one waiting for a gap', async () => {
  const cp = carPark({time: '06:00'}); live.push(cp);
  const [a, b] = cp.idle();
  assert.ok(await cp.until(() => cp.cars().some(c => c.name === 'Demo_car_' && Math.abs(c.position.z - STREET.laneEast) < .3 && c.position.x > -48 && c.position.x < -44) || (cp.traffic.passBy(1), false), 60000), 'a through car just short of x -40');
  cp.traffic.passBy = () => false;
  cp.traffic.arrive({plate: a.plate, province: a.province, color: 1, fromX: -40});
  cp.traffic.arrive({plate: b.plate, province: b.province, color: 2, fromX: -60});
  assert.ok(await cp.until(() => cp.parked(a) && cp.parked(b), 120000), 'both arrivals parked');
});

test('a full car park turns a car away at the barrier', async () => {
  const cp = quiet(), v = cp.idle()[0];
  const free = cp.sim.state.stalls.filter(s => !s.occupant && s.reserved !== 'vip');
  free.forEach((s, i) => { s.occupant = `X|${i}`; });
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, fromX: -40});
  assert.ok(await cp.until(() => !cp.traffic.isAround(cp.key(v)), 90000), 'it drove off again');
  assert.ok(!cp.sim.state.presence.has(cp.key(v)), 'never parked');
});

test('a car still driving to its bay is not sent out again; an unknown car let in by hand can leave', async () => {
  const cp = quiet(), v = cp.idle()[0];
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, fromX: -40});
  assert.ok(await cp.until(() => cp.sim.state.presence.has(cp.key(v)), 60000), 'entry recorded');
  assert.ok(!cp.traffic.parkedKeys().includes(cp.key(v)), 'not leavable while still driving to its bay');
  cp.traffic.arrive({plate: '1กก 1111', province: 'กรุงเทพมหานคร', color: 4, fromX: -40});
  assert.ok(await cp.until(() => cp.sim.state.alerts.some(a => a.status === 'open'), 60000));
  cp.sim.resolveAlert(cp.sim.state.alerts.find(a => a.status === 'open').id, 'open', 'gate.reason.delivery');
  const k = cp.sim.key('1กก 1111', 'กรุงเทพมหานคร');
  assert.ok(await cp.until(() => cp.traffic.parkedKeys().includes(k), 90000), 'parked');
  cp.traffic.leave(k);
  assert.ok(await cp.until(() => !cp.sim.state.presence.has(k), 90000), 'and left');
});

test('a leaving car gets out quickly even with busy street traffic, and the barrier closes soon after', async () => {
  const cp = carPark({time: '08:00'}); live.push(cp);
  const k = cp.traffic.parkedKeys().find(k => cp.sim.state.presence.get(k)?.type === 'staff');
  // Stopped when the test ends (left running, it kept moving the shared clock in 1.5 s steps through the next test).
  let busy = true;
  const street = (async () => { for (let i = 0; i < 40 && busy; i++) { cp.traffic.passBy(); await cp.run(1500); } })();
  try {
    const t0 = cp.now();
    cp.traffic.leave(k, {west: false});
    assert.ok(await cp.until(() => !cp.sim.state.presence.has(k), 60000), 'out');
    assert.ok(cp.now() - t0 < 40000, `out in ${(cp.now() - t0) / 1000} s`);
    assert.ok(await cp.until(() => cp.sim.state.gate === 'closed', 8000), 'the barrier closed again soon after');
  } finally { busy = false; await street; }
});

test('a reset takes every car away at once, one still on its way in included (it stood at the barrier into the new run), and lowers an arm caught rising', async () => {
  const cp = carPark({time: '06:00', quiet: true});
  const [v] = cp.idle();
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 2, fromX: -40});
  // At the barrier, read, the arm rising for it.
  assert.ok(await cp.until(() => { const c = cp.car(v.plate); return c?.visible && c.position.z < STREET.north && cp.sim.state.gate === 'opening'; }, 30000));
  const t0 = cp.now();
  cp.traffic.syncParked();
  assert.equal(cp.car(v.plate), undefined, 'gone at the reset');
  // On past the read's end (1.4 s): it does not come back, and the new run's counters stay at 0.
  await cp.run(3000);
  assert.ok(cp.now() - t0 >= 3000);
  assert.equal(cp.car(v.plate), undefined, 'still gone after its read would have ended');
  assert.ok(cp.settled(), JSON.stringify({...cp.traffic.inspect(), gate: cp.sim.state.gate}));
  assert.equal(cp.lot.armAngle, 0, 'the arm down');
  cp.dispose();
});
