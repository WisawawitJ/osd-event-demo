// The car park's background life: cars come and go to follow the hour, visitors drop in, through-traffic on the street.
// No page and no rendering here (the camera, when given, only says which bays are out of view), so it runs in Node
// tests on the engine's clock as it does in the browser.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {bkk} from './i18n.js';
import {STORY} from './sim.js';
import {later, cancelLater, world, minuteOf, rng} from './clock.js';

export const STORY_START = bkk(2026, 11, 24, 9, 0);
// The story's own cars: its visitor and its unknown car (neither can come from the Gate tab's test buttons).
export const storyCar = a => a.plate === STORY.plate || a.plate === STORY.unknown.plate;
export const UNKNOWN_PLATES = [['4ศย 5150', 'ปทุมธานี'], ['ผต 8812', 'กรุงเทพมหานคร'], ['3ฆง 6047', 'ชลบุรี'], ['ฌธ 2290', 'นครปฐม']];
export const pickOne = list => list[Math.floor(rng() * list.length)];
export const lotOnScreen = lot => lot.root.visible && globalThis.document?.visibilityState !== 'hidden';
// In the car park, by plate (presence is kept by plate, with one vehicle's id: a second listing of the same plate, after
// importing the sample list twice say, looked idle, drove in again, and left its first bay taken for good).
export const parkedPlate = (sim, v) => sim.state.presence.has(sim.key(v.plate, v.province));

// How many cars the car park holds at each time of day (minute, cars): nearly empty at night, the morning rush from
// 07:00, a dip at lunch, the evening rush out from 16:30. The seeded morning (09:00) has 27.
const OCCUPANCY = [[0, 2], [390, 2], [420, 5], [480, 17], [540, 27], [600, 34], [720, 35], [750, 30], [810, 34], [990, 35], [1050, 24], [1110, 9], [1170, 5], [1260, 3], [1440, 2]];
export function occupancyAt(minute) {
  for (let i = 1; i < OCCUPANCY.length; i++) {
    const [a, x] = OCCUPANCY[i - 1], [b, y] = OCCUPANCY[i];
    if (minute <= b) return x + (y - x) * (minute - a) / (b - a);
  }
  return OCCUPANCY[0][1];
}
export const daytime = minute => minute >= 390 && minute < 1140;
// Through-traffic on the street follows the hour too: closest together in the rushes (07:00–08:45, 16:45–18:30),
// a car now and then at night (22:00–05:30). The delay (ms of demo time) until the next one is offered.
export function streetGap(minute) {
  const rush = (minute >= 420 && minute < 525) || (minute >= 1005 && minute < 1110), night = minute < 330 || minute >= 1320;
  return rush ? 1100 + rng() * 1500 : night ? 9000 + rng() * 9000 : 1800 + rng() * 3200;
}
// Cars not in the car park that may drive in: staff, and in the morning the VIPs (the explore page: staff only).
export function idleCars(sim, traffic, {staffOnly = false} = {}) {
  const m = world.minute();
  const vip = !staffOnly && m >= 420 && m < 660;
  return sim.state.vehicles.filter(v => (v.type === 'staff' || (vip && v.type === 'vip')) && v.enabled && v.sync === 'synced' && !parkedPlate(sim, v) && !traffic.isAround(sim.key(v.plate, v.province)));
}
// About a third of the cars coming in arrive along the far lane and turn right across the near one (the story's own
// cars keep the near lane, where its camera shots expect them).
export const fromFarLane = () => rng() < .35;
// Parked cars that may drive out: VIPs only from the late afternoon, visitors' cars never by themselves (their visit
// ends them), only when sent out by hand (`guests`). Unknown cars let in by hand (a delivery) leave too: left out, one
// stayed in its bay until a reset.
export function leavingCandidates(sim, traffic, {staffOnly = false, guests = false} = {}) {
  // VIPs leave from the late afternoon on, through the night (a jump past midnight finds them gone).
  const m = world.minute(), vip = !staffOnly && (m >= 990 || m < 420);
  return traffic.parkedKeys().filter(k => { const type = sim.state.presence.get(k)?.type; return type === 'staff' || type === 'unknown' || (vip && type === 'vip') || (guests && type === 'guest'); });
}

// Background life of the car park, shared by the showcase and the explore page: cars come and go so that the car
// park follows OCCUPANCY at the world clock's hour. On screen they drive through the barrier, as fast as its lanes
// allow (two arriving and two leaving at a time); the rest of a gap the barrier cannot close (a rush in time-lapse,
// a jump in time, or time spent off screen) is made up in the bays directly, logged at times spread over that gap.
// Between rushes a car comes or goes now and then. `paused()` (the story playing) stops all of it.
// `onScreen()`: the car park is in view (cars then drive through the barrier; out of view they are made up in the bays).
export function startLotLife({sim, traffic, lot, camera = null, staffOnly = false, paused = () => false, watched = () => true, onScreen = () => lotOnScreen(lot), arrive, leave, unknown = null}) {
  // Cars made up in the bays appear or vanish on the spot, so while the car park is on screen only in bays the camera
  // cannot see: popping in and out of view (the building's covered bays, at rush hour on a short day) read as a flicker.
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), bay = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const stallsById = new Map(sim.state.stalls.map(s => [s.id, s]));
  function unseenBays() {
    if (!onScreen()) return () => true;
    if (!camera) return () => false;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return stall => !frustum.intersectsSphere(bay.set(bay.center.set(stall.x, stall.y, stall.z), 3.2));
  }
  const expected = () => sim.state.presence.size + traffic.queued - traffic.leaving;
  const gap = () => Math.round(occupancyAt(world.minute())) - expected();
  function park(at, unseen) {
    const v = pickOne(idleCars(sim, traffic, {staffOnly})), stall = v && sim.freeStall(v.type, unseen);
    if (!stall) return;
    sim.recordEntry({plate: v.plate, province: v.province, type: v.type, stallId: stall.id, color: v.color, at});
    traffic.appear(sim.key(v.plate, v.province));
  }
  function unpark(at, unseen) {
    for (const k of leavingCandidates(sim, traffic, {staffOnly}).sort(() => rng() - .5)) {
      const p = sim.state.presence.get(k), stall = stallsById.get(p.stallId);
      if (stall && !unseen(stall)) continue;
      if (traffic.vanish(k, () => sim.recordExit({plate: p.plate, province: p.province, at}))) return;
    }
  }
  // A log time between `from` and `to` for a car coming in (or leaving): when the car park was filling (or emptying)
  // most, so a jump over the evening logs its departures in the evening rush, not spread over the afternoon.
  function when(arriving, from, to) {
    for (let i = 0; i < 40; i++) {
      const t = from + rng() * Math.max(0, to - from), m = minuteOf(t);
      const change = occupancyAt((m + 10) % 1440) - occupancyAt(m); // cars per 10 minutes
      if (rng() < Math.max(0, arriving ? change : -change) / 4) return t;
    }
    return from + rng() * Math.max(0, to - from);
  }
  // Closes the gap down to `keep` cars, oldest log time first.
  // `anywhere`: a jump in time, which changes the whole car park at once anyway.
  function catchUp(keep, from, to, {anywhere = false} = {}) {
    let g = gap();
    const moves = [], unseen = anywhere ? () => true : unseenBays();
    for (; g > keep; g--) moves.push([park, when(true, from, to)]);
    for (; g < -keep; g++) moves.push([unpark, when(false, from, to)]);
    moves.sort((a, b) => a[1] - b[1]).forEach(([move, t]) => move(Math.round(t), unseen));
  }
  // Visitors: someone with a pass for today drops in now and then between 09:30 and 15:30 (each at most once a day;
  // the story's visitor is the story's), stays 45 minutes to three hours of world time, then leaves by themselves.
  const TODAY = bkk(2026, 11, 24);
  const stayOf = plate => (45 + [...plate].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 136) * 60000;
  function visitorsDue() {
    const now = world.now();
    const came = new Set(sim.state.events.filter(e => e.at >= TODAY && (e.kind === 'entry' || e.kind === 'manual') && e.type === 'guest').map(e => sim.key(e.plate, e.province)));
    return sim.state.vehicles.filter(v => v.type === 'guest' && v.plate !== STORY.plate && v.enabled && v.sync === 'synced' && (!v.validFrom || v.validFrom <= now) && (!v.validTo || v.validTo >= now)
      && !parkedPlate(sim, v) && !came.has(sim.key(v.plate, v.province)) && !traffic.isAround(sim.key(v.plate, v.province)));
  }
  // `from`…`now`: the world time since the last look; on average a visitor arrives every 35 minutes of it.
  function visits(from, now) {
    const m = world.minute();
    // Whose visit is over: one at a time, through the barrier when the car park is on screen.
    for (const [k, p] of sim.state.presence) {
      // The story's visitor too, once the story is left before its exit step (it stayed parked for good). While the
      // story runs, none of this does (`paused()`), and the story drives it out itself.
      if (p.type !== 'guest' || now - p.since < stayOf(p.plate)) continue;
      if (onScreen()) { if (traffic.leaving < 2) traffic.leave(k, {west: fromFarLane()}); }
      else traffic.vanish(k, () => sim.recordExit({plate: p.plate, province: p.province}));
      break;
    }
    if (m < 570 || m >= 930 || rng() > (now - from) / 60000 / 35) return;
    const v = pickOne(visitorsDue());
    if (!v) return;
    if (onScreen()) { if (traffic.queued < 2) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70, west: fromFarLane()}); return; }
    const stall = sim.freeStall('guest');
    if (stall) { sim.recordEntry({plate: v.plate, province: v.province, type: 'guest', stallId: stall.id, color: v.color}); traffic.appear(sim.key(v.plate, v.province)); }
  }
  let last = world.now(), timer = 0;
  // Opened later than the seeded 09:00 (a page at ?time=23:00): the car park is that hour's at once, its log spread
  // over the hours since, not the morning's cars left to drive out through the barrier one by one.
  if (last > STORY_START && !paused()) catchUp(0, STORY_START, last, {anywhere: true});
  function tick() {
    const now = world.now(), from = last;
    last = now;
    if (!paused()) {
      // Off screen everything is made up at once; on screen a few cars are left for the barrier to bring in or out.
      catchUp(!onScreen() ? 0 : watched() ? 6 : 2, from, now);
      if (!staffOnly) visits(from, now);
      const g = gap(), m = world.minute();
      if (onScreen()) {
        // A gap of one car is the everyday coming and going below, not a rush: one car leaving does not send another in.
        // The further behind the hour, the more at once (up to 4 coming, 5 going; those going wait in their bays and
        // queue on the exit lane): two at a time, the barrier sat idle while the car park fell behind the rushes.
        if (g >= 2 && traffic.queued < Math.min(4, 1 + Math.ceil(g / 3))) arrive();
        else if (g <= -2 && traffic.leaving < Math.min(5, 1 + Math.ceil(-g / 3))) leave();
        else if (!traffic.busy && rng() < (daytime(m) ? .07 : .01)) {
          if (unknown && daytime(m) && rng() < .12) unknown();
          else if (g >= 0) arrive(); else leave();
        }
      }
    }
    timer = later(tick, 1500);
  }
  // A jump in time: the car park is as it would be by then (the log spread over the skipped hours), on screen too.
  // The day's wrap at 03:00 moves the log back a day: the last look moves with it (left behind, the next catch-up
  // logged its cars a day ahead).
  const off = world.subscribe((kind, p) => { if (kind === 'wrap') last += p; if (kind === 'jump' && !paused()) { catchUp(onScreen() && watched() ? 3 : 0, p.from, p.to, {anywhere: true}); last = world.now(); } });
  timer = later(tick, 1500);
  return () => { cancelLater(timer); off(); };
}
