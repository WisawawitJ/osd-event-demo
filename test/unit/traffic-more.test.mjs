// More traffic rules on the engine's clock: turning and signalling, the queue, P1, resets, a full car park.
import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {carPark} from './world.mjs';
import {GATE, STREET, ENTRY_TURN} from '../../src/parking/layout.js';

const QUEUE_HEAD = GATE.entryX - ENTRY_TURN - 2.23 - .8 - 2.2, QUEUE_GAP = 6.5;
const live = [];
afterEach(() => { for (const cp of live.splice(0)) cp.dispose(); });
const quiet = (time = '06:00') => { const cp = carPark({time}); cp.traffic.passBy = () => false; live.push(cp); return cp; };
const parked = (cp, v) => cp.sim.state.presence.has(cp.key(v)) && !cp.traffic.isAround(cp.key(v));
const entryAt = (cp, v) => cp.sim.state.events.find(e => e.kind === 'entry' && cp.sim.key(e.plate, e.province) === cp.key(v))?.at;
const blinking = (car, side) => car?.getObjectByName(`Demo_car_blinker_${side}`)?.visible;
// Watches `fn` every tick until `until` holds; returns whether `fn` was ever true.
async function seen(cp, fn, until, ms = 60000) { let hit = false; await cp.until(() => { if (fn()) hit = true; return until(); }, ms); return hit; }

test('a far-lane car waits at its turn signalling right, then turns in across the near lane', async () => {
  const cp = quiet(), v = cp.idle()[0];
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, west: true});
  let far = false, right = false;
  await cp.until(() => { const c = cp.car(v.plate); if (Math.abs(c?.position.z - STREET.laneWest) < .3) far = true; if (blinking(c, 'right')) right = true; return parked(cp, v); }, 90000);
  assert.ok(far, 'it came along the far lane'); assert.ok(right, 'signalling right'); assert.ok(parked(cp, v), 'parked');
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
  assert.ok(await cp.until(() => parked(cp, far) && parked(cp, near), 90000));
  assert.ok(entryAt(cp, near) < entryAt(cp, far), 'the near-lane car went in first');
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
  assert.ok(await cp.until(() => parked(cp, a) && !cp.car('1กก 1111'), 90000), 'the turned-away car backed out and left; the next one in');
  assert.ok(cp.overlaps().length === 0);
});

test('inside the car park a car rolls straight into a clear aisle, without stopping at its mouth', async () => {
  const cp = quiet(), v = cp.idle()[0];
  cp.traffic.arrive({plate: v.plate, province: v.province, color: 1, fromX: -40});
  assert.ok(await cp.until(() => parked(cp, v), 60000));
  assert.ok(!cp.traffic.inspect().mouthStops.includes(v.plate));
});

test('a VIP leaving P1 and one arriving for it at the same time both get through', async () => {
  const cp = quiet('17:00'), vips = cp.sim.state.vehicles.filter(v => v.type === 'vip');
  const leaver = cp.traffic.parkedKeys().find(k => cp.sim.state.presence.get(k)?.type === 'vip');
  const arriving = vips.find(v => !cp.sim.state.presence.has(cp.key(v)));
  assert.ok(leaver && arriving, 'a VIP parked in P1 and another not');
  cp.traffic.leave(leaver, {west: false});
  cp.traffic.arrive({plate: arriving.plate, province: arriving.province, color: 5, fromX: -40});
  assert.ok(await cp.until(() => !cp.traffic.isAround(leaver) && parked(cp, arriving), 120000), JSON.stringify(cp.traffic.inspect()));
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
  assert.ok(await cp.until(() => parked(cp, a) && parked(cp, b), 120000), 'both arrivals parked');
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
  const street = async () => { for (let i = 0; i < 40; i++) { cp.traffic.passBy(); await cp.run(1500); } };
  void street();
  const t0 = cp.now();
  cp.traffic.leave(k, {west: false});
  assert.ok(await cp.until(() => !cp.sim.state.presence.has(k), 60000), 'out');
  assert.ok(cp.now() - t0 < 40000, `out in ${(cp.now() - t0) / 1000} s`);
  assert.ok(await cp.until(() => cp.sim.state.gate === 'closed', 8000), 'the barrier closed again soon after');
});
