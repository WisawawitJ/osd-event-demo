// A simulated car park for Node tests: the records (sim), the traffic on the engine's clock, and a stand-in for the
// 3D car park (only what traffic reads from it: the barrier's arm and where cars are). No browser, no rendering:
// simulation time is stepped by the test, so a minute of traffic takes a fraction of a second, the same every run.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {advance, runUntil, seed, demoNow, TICK, world} from 'osd/parking/clock.js';
import {createParkingSim} from 'osd/parking/sim.js';
import {createBoom, plateRead} from 'osd/parking/gate.js';
import {createTraffic} from 'osd/parking/traffic.js';
import {createParkingWorld} from 'osd/parking/world.js';
import {createPhone} from 'osd/parking/phone.js';

// The lot as traffic sees it: a group the cars are added to, and the arm (gate.js's own).
function standInLot() {
  const arm = createBoom();
  return {
    root: new THREE.Group(),
    // The sign's count, for tests.
    free: null,
    setBays() {},
    drawSign(free) {
      this.free = free;
    },
    setBoom: arm.set,
    get boomMoving() {
      return arm.moving;
    },
    get armAngle() {
      return arm.angle;
    },
    update: arm.update,
  };
}

// Every car's body against every other's (4.46 × 1.72 m), within 0.05 m: pairs that overlap now.
export function overlaps(lot) {
  const L = 2.23 - 0.05,
    W = 0.86 - 0.05,
    hits = [];
  const list = lot.root.children.filter((c) => c.name.startsWith('Demo_car_') && c.visible);
  const corners = (c) => {
    const h = c.rotation.y,
      f = [Math.sin(h), Math.cos(h)],
      s = [Math.cos(h), -Math.sin(h)],
      {x, z} = c.position;
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([a, b]) => [x + f[0] * L * a + s[0] * W * b, z + f[1] * L * a + s[1] * W * b]);
  };
  const apart = (A, B) => {
    for (const P of [A, B])
      for (let i = 0; i < 4; i++) {
        const p = P[i],
          q = P[(i + 1) % 4],
          n = [q[1] - p[1], p[0] - q[0]];
        const proj = (X) => X.map((v) => v[0] * n[0] + v[1] * n[1]);
        const a = proj(A),
          b = proj(B);
        if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return true;
      }
    return false;
  };
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i],
        b = list[j];
      if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 5 && !apart(corners(a), corners(b)))
        hits.push(`${a.name.slice(9) || 'street'} × ${b.name.slice(9) || 'street'}`);
    }
  return hits;
}

// A fresh run: the dice seeded, the world clock moved on to `time` ('HH:MM').
function begin(s, time) {
  seed(s);
  if (time) {
    const [h, m] = time.split(':').map(Number);
    world.jumpTo(h * 60 + m);
  }
}
// Simulation time on by `ms`, in whole ticks.
const run = (ms) => advance(Math.ceil(ms / TICK) * TICK);

// `quiet`: no through-traffic on the street.
export function carPark({seed: s = 1, time, quiet = false} = {}) {
  begin(s, time);
  const sim = createParkingSim(),
    lot = standInLot();
  const traffic = createTraffic({
    lot,
    sim,
    schedule() {},
    hooks: {
      snapshot: () => '',
      readPlate: (which, agent, verdict, recognised) => plateRead({recognised}),
    },
  });
  traffic.syncParked();
  if (quiet) traffic.passBy = () => false;
  const cars = () => lot.root.children.filter((c) => c.name.startsWith('Demo_car_') && c.visible);
  const car = (plate) => lot.root.children.find((c) => c.name === `Demo_car_${plate}`);
  const key = (v) => sim.key(v.plate, v.province);
  // Staff cars not parked or on their way.
  const idle = (type = 'staff') =>
    sim.state.vehicles.filter(
      (v) =>
        v.type === type &&
        v.enabled &&
        v.sync === 'synced' &&
        !sim.state.presence.has(key(v)) &&
        !traffic.isAround(key(v)),
    );
  return {
    sim,
    traffic,
    lot,
    cars,
    car,
    key,
    idle,
    // In its bay, done driving; when its entry was logged.
    parked: (v) => sim.state.presence.has(key(v)) && !traffic.isAround(key(v)),
    entryAt: (v) => sim.state.events.find((e) => e.kind === 'entry' && sim.key(e.plate, e.province) === key(v))?.at,
    now: demoNow,
    run,
    until: runUntil,
    overlaps: () => overlaps(lot),
    // Counters that must all be back at 0 once nothing moves.
    settled() {
      const s = traffic.inspect();
      return (
        !traffic.busy &&
        !traffic.leaving &&
        !s.entryPending &&
        !s.gateHolders &&
        !s.inbound &&
        !s.outWest &&
        !s.outEast &&
        !s.backingOut &&
        !s.crossing &&
        !s.p1In &&
        !s.p1Waiting &&
        !s.p1OnLane &&
        !s.outbound &&
        sim.state.gate === 'closed'
      );
    },
    dispose() {
      traffic.dispose();
    },
  };
}

// The whole parking world without a page: records, traffic, the story, the background life and their rules, with a
// stand-in car park and a phone that draws nothing. `ui` gets what the page would (events, captions, toasts…).
export function parking({seed: s = 1, time, onScreen = true, ui = {}} = {}) {
  begin(s, time);
  const sim = createParkingSim(),
    lot = standInLot();
  const phone = createPhone({root: null, sim, actions: {}});
  const w = createParkingWorld({lot, sim, phone, onScreen: () => onScreen, ui});
  const key = (v) => sim.key(v.plate, v.province);
  return {
    ...w,
    phone,
    key,
    now: demoNow,
    car: (plate) => lot.root.children.find((c) => c.name === `Demo_car_${plate}`),
    run,
    until: runUntil,
  };
}
