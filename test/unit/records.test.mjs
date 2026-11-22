// The car park's records (requests, emails, the allowed list, alerts) as the ATOM Parking app keeps them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance, seed} from 'osd/parking/clock.js';
import {createParkingSim} from 'osd/parking/sim.js';

seed(3);
const visitor = (i = 0) => ({visitor: {name: `ทดสอบ ${i}`, phone: '080', email: `v${i}@example.com`, company: '—'}, contact: 'host.demo@osd.example', plate: `9ทส ${1000 + i}`, province: 'กรุงเทพมหานคร'});
const request = (sim, i = 0) => sim.submitRequest({...visitor(i), arrival: sim.now(), departure: sim.now()});
const mails = (sim, req) => sim.state.emails.filter(m => m.requestId === req.id).map(m => m.kind);

test('approving: ATOM confirms the vehicle, then the ticket email goes out', async () => {
  const sim = createParkingSim(), req = request(sim);
  sim.approve(req.id);
  assert.equal(req.status, 'approved');
  assert.deepEqual(mails(sim, req), [], 'no email before ATOM confirms');
  await advance(2000);
  assert.deepEqual(req.history.map(h => h.key).slice(-3), ['h.approved', 'h.atom', 'h.email']);
  assert.deepEqual(mails(sim, req), ['approved']);
});

test('revoking before the ticket email: the pending add is withdrawn and no email goes out', async () => {
  const sim = createParkingSim(), req = request(sim, 1);
  sim.approve(req.id); sim.revoke(req.id);
  await advance(2000);
  assert.equal(req.status, 'revoked');
  assert.deepEqual(mails(sim, req), [], 'the visitor was never told of the approval');
  assert.ok(!sim.state.vehicles.some(v => v.requestId === req.id), 'the vehicle add withdrawn');
});

test('revoking after the ticket email: the plate stays listed, disabled, and a revocation email follows', async () => {
  const sim = createParkingSim(), req = request(sim, 2);
  sim.approve(req.id); await advance(2000); sim.revoke(req.id);
  assert.deepEqual(mails(sim, req), ['revoked', 'approved'], 'newest first');
  assert.equal(sim.state.vehicles.find(v => v.requestId === req.id)?.enabled, false);
});

test('rejecting emails the reason; a repeat of a pending request is the same request', () => {
  const sim = createParkingSim(), req = request(sim, 3), again = request(sim, 3);
  assert.equal(again.id, req.id, 'same email, plate, province and dates: the request it repeats');
  sim.reject(req.id, 'ไม่มีนัดหมาย');
  assert.equal(req.status, 'rejected');
  assert.deepEqual(mails(sim, req), ['rejected']);
});

test('a plate already listed is not added again, by hand or by importing twice', () => {
  const sim = createParkingSim(), v = sim.state.vehicles.find(v => v.type === 'staff'), n = () => sim.state.vehicles.length, before = n();
  assert.equal(sim.addVehicle({plate: v.plate.replace(' ', '-'), province: v.province, owner: 'ซ้ำ'}), null, 'the same plate, written with a hyphen');
  assert.equal(sim.importCsv(), 3); assert.equal(sim.importCsv(), 0);
  assert.equal(n() - before, 3);
});

test('visitor cars get varied colours, unless the request names one', () => {
  const sim = createParkingSim();
  const colours = new Set(Array.from({length: 8}, (_, i) => request(sim, 10 + i).color));
  assert.ok(colours.size > 2 && [...colours].every(Number.isInteger), `colours ${[...colours]}`);
  assert.equal(sim.submitRequest({...visitor(30), arrival: sim.now(), departure: sim.now(), color: 4}).color, 4);
});

test('a car entering a bay frees any bay its plate already held', () => {
  const sim = createParkingSim(), v = sim.state.vehicles.find(v => v.type === 'staff' && !sim.state.presence.has(sim.key(v.plate, v.province)));
  const [a, b] = sim.state.stalls.filter(s => s.zone === 'P2' && !s.occupant && !s.reserved);
  sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: a.id, color: 1});
  sim.recordEntry({plate: v.plate, province: v.province, type: 'staff', stallId: b.id, color: 1});
  assert.equal(a.occupant, null); assert.equal(b.occupant, sim.key(v.plate, v.province));
});

test('an unknown car: an alert, opened with the reason picked, audited', () => {
  const sim = createParkingSim();
  const alert = sim.raiseAlert({plate: '1กก 1111', province: 'กรุงเทพมหานคร'});
  sim.setAlertReason(alert.id, 'gate.reason.misread');
  sim.resolveAlert(alert.id, 'open', alert.openReason);
  assert.equal(alert.status, 'opened');
  assert.equal(sim.state.audit.find(a => a.target === '1กก 1111')?.reasonKey, 'gate.reason.misread');
});
