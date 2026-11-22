// A simulated car park for Node tests: the records (sim), the traffic on the engine's clock, and a stand-in for the
// 3D car park (only what traffic reads from it: the barrier's arm and where cars are). No browser, no rendering:
// simulation time is stepped by the test, so a minute of traffic takes a fraction of a second, the same every run.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {advance, runUntil, seed, sleep, demoNow, TICK, world} from 'osd/parking/clock.js';
import {createParkingSim} from 'osd/parking/sim.js';
import {createTraffic} from 'osd/parking/traffic.js';
import {createParkingWorld} from 'osd/parking/world.js';
import {createPhone} from 'osd/parking/phone.js';

// The lot as traffic sees it: a group the cars are added to, and the arm, which turns a quarter in about 0.8 s.
export function standInLot() {
  let angle = 0, target = 0;
  return {
    root: new THREE.Group(),
    // The sign's count, for tests.
    free: null, setBays() {}, drawSign(free) { this.free = free; }, setNight() {},
    setBoom(open) { target = open ? Math.PI / 2 * .96 : 0; },
    get boomMoving() { return angle !== target; },
    update(dt) {
      if (angle === target) return false;
      angle = target > angle ? Math.min(target, angle + dt * 2) : Math.max(target, angle - dt * 2);
      return true;
    },
  };
}

export function carPark({seed: s = 1, time} = {}) {
  seed(s);
  if (time) { const [h, m] = time.split(':').map(Number); world.jumpTo(h * 60 + m); }
  const sim = createParkingSim(), lot = standInLot();
  const traffic = createTraffic({lot, sim, schedule() {}, hooks: {
    snapshot: () => '',
    // As the page's: the camera reads the plate (0.9 s), then shows the verdict a moment.
    async readPlate(which, agent, verdict) { await sleep(900); await sleep(verdict.allow ? 500 : 300); },
  }});
  traffic.syncParked();
  const cars = () => lot.root.children.filter(c => c.name.startsWith('Demo_car_') && c.visible);
  const car = plate => lot.root.children.find(c => c.name === `Demo_car_${plate}`);
  const key = v => sim.key(v.plate, v.province);
  // Staff cars not parked or on their way.
  const idle = (type = 'staff') => sim.state.vehicles.filter(v => v.type === type && v.enabled && v.sync === 'synced' && !sim.state.presence.has(key(v)) && !traffic.isAround(key(v)));
  return {
    sim, traffic, lot, cars, car, key, idle,
    now: demoNow,
    run: ms => advance(Math.ceil(ms / TICK) * TICK),
    until: runUntil,
    // Every car's body against every other's (4.46 × 1.72 m), within 0.05 m: pairs that overlap now.
    overlaps() {
      const L = 2.23 - .05, W = .86 - .05, list = cars(), hits = [];
      const corners = c => { const h = c.rotation.y, f = [Math.sin(h), Math.cos(h)], s = [Math.cos(h), -Math.sin(h)], {x, z} = c.position; return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [x + f[0] * L * a + s[0] * W * b, z + f[1] * L * a + s[1] * W * b]); };
      const apart = (A, B) => { for (const P of [A, B]) for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i + 1) % 4], n = [q[1] - p[1], p[0] - q[0]]; const proj = X => X.map(v => v[0] * n[0] + v[1] * n[1]); const a = proj(A), b = proj(B); if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) return true; } return false; };
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 5 && !apart(corners(a), corners(b))) hits.push(`${a.name.slice(9) || 'street'} × ${b.name.slice(9) || 'street'}`);
      }
      return hits;
    },
    // Counters that must all be back at 0 once nothing moves.
    settled() { const s = traffic.inspect(); return !traffic.busy && !traffic.leaving && !s.entryPending && !s.gateHolders && !s.inbound && !s.outWest && !s.outEast && !s.backingOut && !s.crossing && !s.p1In && !s.outbound && sim.state.gate === 'closed'; },
    dispose() { traffic.dispose(); },
  };
}

// The whole parking world without a page: records, traffic, the story, the background life and their rules, with a
// stand-in car park and a phone that draws nothing. `ui` gets what the page would (events, captions, toasts…).
export function parking({seed: s = 1, time, onScreen = true, ui = {}} = {}) {
  seed(s);
  if (time) { const [h, m] = time.split(':').map(Number); world.jumpTo(h * 60 + m); }
  const sim = createParkingSim(), lot = standInLot();
  const phone = createPhone({root: null, sim, actions: {}});
  const w = createParkingWorld({lot, sim, phone, onScreen: () => onScreen, ui});
  const key = v => sim.key(v.plate, v.province);
  return {
    ...w, phone, key, now: demoNow,
    car: plate => lot.root.children.find(c => c.name === `Demo_car_${plate}`),
    run: ms => advance(Math.ceil(ms / TICK) * TICK),
    until: runUntil,
  };
}
