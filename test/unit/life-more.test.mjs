// The car park's life across the day and its records: jumps in time, the 03:00 wrap, reports, the Gate tab's buttons.
import {test, afterEach} from 'vitest';
import assert from 'node:assert/strict';
import {world} from 'osd/parking/clock.js';
import {STORY} from 'osd/parking/sim.js';
import {occupancyAt, UNKNOWN_PLATES} from 'osd/parking/life.js';
import {visitInvite} from 'osd/parking/dom.js';
import {parking} from './world.mjs';

const live = [];
afterEach(() => {
  for (const w of live.splice(0)) w.dispose();
});
const open = (options = {}) => {
  const w = parking({onScreen: false, ...options});
  live.push(w);
  return w;
};
const vipsParked = (w) => [...w.sim.state.presence.values()].filter((p) => p.type === 'vip').length;

test('a jump past midnight finds the VIPs gone home', async () => {
  const w = open({time: '10:00'});
  await w.run(500);
  const before = vipsParked(w);
  world.jumpTo(60);
  await w.run(500);
  assert.ok(before > 0 && vipsParked(w) < before, `VIPs ${before} → ${vipsParked(w)}`);
});

test('a jump brings the car park to the hour, its log spread over the skipped time (today, never ahead)', async () => {
  const w = open({time: '09:00'});
  await w.run(500);
  const from = world.now();
  world.jumpTo(14 * 60);
  await w.run(500);
  const want = occupancyAt(world.minute()),
    cars = w.sim.state.presence.size;
  assert.ok(Math.abs(cars - want) <= 3, `${cars} cars at 14:00, ${want.toFixed(0)} expected`);
  const logged = w.sim.state.events.filter((e) => e.at > from);
  assert.ok(logged.length > 3 && logged.every((e) => e.at <= world.now()), 'logged over the skipped time, none ahead');
  assert.equal(w.lot.free, w.sim.state.capacity - w.sim.state.presence.size, 'the sign counts the cars there');
});

test('the catch-up across the 03:00 wrap logs today, not tomorrow', async () => {
  const w = open({time: '22:00'});
  await w.run(500);
  world.jumpTo(5 * 60);
  await w.run(500);
  assert.ok(
    w.sim.state.events.every((e) => e.at <= world.now()),
    'nothing logged ahead of the clock',
  );
});

test('after midnight the report adds up: the hourly chart counts what the totals count, the peak counts cars there overnight', async () => {
  const w = open({time: '20:00'});
  await w.run(500);
  world.jumpTo(60);
  await w.run(500);
  const s = w.sim.stats();
  const charted = s.hourly.reduce((n, h) => n + (h.in ?? 0), 0);
  assert.equal(charted, s.entries, "the chart's entries add up to the total");
  assert.ok(s.peak >= s.parked, `peak ${s.peak} ≥ cars there now ${s.parked}`);
});

test("opened late in the day, the car park is that hour's at once", async () => {
  world.jumpTo(18 * 60);
  const w = open();
  await w.run(500);
  const want = occupancyAt(world.minute());
  assert.ok(
    Math.abs(w.sim.state.presence.size - want) <= 3,
    `${w.sim.state.presence.size} cars, ${want.toFixed(0)} expected`,
  );
});

test("the Gate tab's buttons: Staff car sends staff (never a VIP), Car leaving may send a visitor, Unknown car skips a parked plate", async () => {
  const w = open({time: '10:00'});
  const sent = [];
  const arrive = w.traffic.arrive,
    leave = w.traffic.leave;
  w.traffic.arrive = (o) => {
    sent.push(o.plate);
    return Promise.resolve();
  };
  w.traffic.leave = (k) => {
    sent.push(k);
    return Promise.resolve();
  };
  for (let i = 0; i < 12; i++) w.actions.simulate('registered');
  const types = sent.map((p) => w.sim.state.vehicles.find((v) => v.plate === p)?.type);
  assert.ok(types.length && types.every((t) => t === 'staff'), `staff only (${[...new Set(types)]})`);
  // A visitor parked: Car leaving, pressed by hand, may pick it.
  const guest = w.sim.state.vehicles.find((v) => v.type === 'guest' && v.enabled && v.plate !== STORY.plate);
  const bay = w.sim.state.stalls.find((s) => !s.occupant && s.zone === 'P2');
  w.sim.recordEntry({plate: guest.plate, province: guest.province, type: 'guest', stallId: bay.id, color: 1});
  w.traffic.appear(w.sim.key(guest.plate, guest.province));
  sent.length = 0;
  for (let i = 0; i < 60; i++) w.actions.simulate('exit');
  assert.ok(sent.includes(w.sim.key(guest.plate, guest.province)), 'the visitor sent out too');
  // An unknown plate already parked is not sent again.
  const [p, pr] = UNKNOWN_PLATES[0],
    bay2 = w.sim.state.stalls.find((s) => !s.occupant && s.zone === 'P2');
  w.sim.recordEntry({plate: p, province: pr, type: 'unknown', stallId: bay2.id, color: 1});
  sent.length = 0;
  for (let i = 0; i < 20; i++) w.actions.simulate('unknown');
  assert.ok(!sent.includes(p), 'the parked unknown plate not sent');
  w.traffic.arrive = arrive;
  w.traffic.leave = leave;
});

test('visitors with a pass for today drop in during the day, and leave by themselves', async () => {
  const w = open({time: '09:30'});
  const guests = () => w.sim.state.events.filter((e) => e.type === 'guest' && e.plate !== STORY.plate);
  const before = guests().length;
  world.setDayLength(2); // a fast day: the afternoon in a minute or so
  await w.until(() => world.minute() > 17 * 60, 600000);
  world.setDayLength(20);
  const visits = guests().slice(0, guests().length - before);
  assert.ok(
    visits.some((e) => e.kind === 'entry'),
    'a visitor came',
  );
  assert.ok(
    visits.some((e) => e.kind === 'exit'),
    'and one left by themselves',
  );
});

test('no plate uses an unlucky letter pair (ศพ, ชน …)', () => {
  const w = open();
  const AVOID = ['ศพ', 'ชน', 'ตก', 'ตด', 'จม', 'ยม', 'รก'];
  const plates = [
    ...w.sim.state.vehicles.map((v) => v.plate),
    ...UNKNOWN_PLATES.map(([p]) => p),
    STORY.plate,
    STORY.unknown.plate,
  ];
  assert.deepEqual(
    plates.filter((p) => AVOID.some((a) => p.replace(/[\s\d]/g, '').includes(a))),
    [],
  );
});

test('the calendar invite is a reminder on the arrival day', () => {
  const w = open();
  const r = w.sim.state.requests.find((q) => q.status === 'approved');
  const ics = visitInvite(r);
  const day = new Date(r.arrival + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const next = new Date(r.arrival + 7 * 3600e3 + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  assert.match(ics, new RegExp(`DTSTART;VALUE=DATE:${day}`), 'all day on the arrival day');
  assert.match(ics, new RegExp(`DTEND;VALUE=DATE:${next}`));
});

test('opened at 08:00, the car park holds the cars its log says are in; at 07:40 no request from later yet', async () => {
  world.jumpTo(7 * 60 + 40);
  let w = open();
  assert.equal(w.sim.state.requests.filter((q) => q.createdAt > world.now()).length, 0, 'no request from the future');
  w.dispose();
  live.length = 0;
  world.jumpTo(8 * 60);
  w = open();
  const s = w.sim.state,
    n = (k) => s.events.filter((e) => e.kind === k).length;
  assert.equal(s.presence.size, n('entry') - n('exit'), 'parked = in − out');
  assert.equal(s.stalls.filter((b) => b.occupant).length, s.presence.size, 'one bay each');
});

test('the car park keeps living while the camera is elsewhere: cars come and go', async () => {
  const w = open({time: '07:00'});
  const before = new Set(w.sim.state.presence.keys());
  await w.run(60000);
  const after = new Set(w.sim.state.presence.keys());
  assert.ok(
    [...after].some((k) => !before.has(k)),
    'cars came in',
  );
});
