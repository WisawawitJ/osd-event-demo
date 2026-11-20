// Car movement and the gate sequence. Routes are built from straight lines and arcs ("turtle" style),
// so turns look like real cornering. Heading h means forward = (sin h, cos h) in (x, z).
import {createCar} from './cars.js';
import {DRIVE, GATE, STREET, groundY} from './layout.js';

const EAST = Math.PI / 2, WEST = -Math.PI / 2, NORTH = Math.PI, SOUTH = 0;
const LANE_IN = 17.6, LANE_OUT = 14.8; // driveway halves: westbound (in) / eastbound (out)
const ABORT = Symbol('abort');

class Route {
  constructor(x, z, h) { this.pts = [{x, z, h}]; this.x = x; this.z = z; this.h = h; }
  push() { this.pts.push({x: this.x, z: this.z, h: this.h}); }
  line(len) {
    if (Math.abs(len) < 1e-3) return this;
    const n = Math.ceil(Math.abs(len) / .25);
    for (let i = 0; i < n; i++) { this.x += Math.sin(this.h) * len / n; this.z += Math.cos(this.h) * len / n; this.push(); }
    return this;
  }
  // Left turns increase h, right turns decrease it.
  arc(r, angle) {
    const n = Math.max(2, Math.ceil(Math.abs(angle) * r / .2)), ds = Math.abs(angle) * r / n, dh = angle / n;
    for (let i = 0; i < n; i++) { this.h += dh / 2; this.x += Math.sin(this.h) * ds; this.z += Math.cos(this.h) * ds; this.h += dh / 2; this.push(); }
    return this;
  }
  toX(x) { return this.line((x - this.x) / Math.sin(this.h)); }
  toZ(z) { return this.line((z - this.z) / Math.cos(this.h)); }
  build() {
    const pts = this.pts; let s = 0;
    pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) { s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); pts[i].s = s; }
    return {pts, length: s};
  }
}

// Routes ----------------------------------------------------------------
// A queued arrival waits on the street at holdX, clear of the turn into the gate.
const streetToHold = (fromX, holdX) => new Route(fromX, STREET.laneEast, EAST).toX(holdX).build();
const streetToGate = (fromX = -95) => new Route(fromX, STREET.laneEast, EAST).toX(GATE.entryX - 2.6).arc(2.6, Math.PI / 2).build();
function gateToStall(stall) {
  const r = new Route(GATE.entryX, GATE.entryStopZ, NORTH);
  if (stall.zone === 'P1') r.toZ(LANE_OUT + 2).arc(2, -Math.PI / 2).toX(stall.aisleX - 2.4).arc(2.4, Math.PI / 2);
  else r.toZ(LANE_IN + 1.8).arc(1.8, Math.PI / 2).toX(stall.aisleX + 3).arc(3, -Math.PI / 2);
  // Into the bay: east-nosed bays are a right turn from a northbound aisle, west-nosed a left turn.
  r.toZ(stall.z + 2).arc(2, stall.nose > 0 ? -Math.PI / 2 : Math.PI / 2).toX(stall.x);
  return r.build();
}
// Backing out: the route follows the car's rear, so the car faces against the route.
function stallBackOut(stall) {
  const r = new Route(stall.x, stall.z, stall.nose > 0 ? WEST : EAST).toX(stall.aisleX - Math.sign(stall.aisleX - stall.x) * 2);
  return r.arc(2, stall.nose > 0 ? -Math.PI / 2 : Math.PI / 2).build();
}
function aisleToExit(stall) {
  const r = new Route(stall.aisleX, stall.z - 2, SOUTH);
  if (stall.zone === 'P1') r.toZ(DRIVE.north - .3).arc(2, -Math.PI / 2).toX(GATE.exitX + 1.8).arc(1.8, Math.PI / 2);
  else r.toZ(LANE_OUT - 2).arc(2, Math.PI / 2).toX(GATE.exitX - 1.8).arc(1.8, -Math.PI / 2);
  return r.toZ(GATE.exitStopZ).build();
}
const exitToStreet = () => new Route(GATE.exitX, GATE.exitStopZ, SOUTH).toZ(STREET.laneEast - 2.6).arc(2.6, Math.PI / 2).toX(98).build();
const gateBackOut = () => new Route(GATE.entryX, GATE.entryStopZ, SOUTH).arc(2.6, -Math.PI / 2).build();
const awayEast = () => new Route(GATE.entryX - 2.6, STREET.laneEast, EAST).toX(98).build();
const passing = dir => (dir > 0 ? new Route(-98, STREET.laneEast, EAST).toX(98) : new Route(98, STREET.laneWest, WEST).toX(-98)).build();

export function createTraffic({lot, sim, schedule, hooks}) {
  const agents = new Map(); // presence key -> parked (or leaving) agent
  const movers = new Set();
  const ambientCars = new Set();
  let gateQueue = Promise.resolve(), entryLane = Promise.resolve(), exitLane = Promise.resolve();
  let generation = 0, frame = 0, last = 0;
  // Street discipline: through-traffic keeps one speed per lane, yields to cars joining the eastbound lane,
  // and does not spawn into it while a car is driving up to the gate or pulling out.
  let entryPending = 0, streetArrivals = 0, exitingStreet = 0;
  const arriving = new Set(); // presence keys of cars on their way in
  const streetCars = new Set(); // arrival agents currently on the street
  const streetClear = (x0, x1) => ![...streetCars].some(a => a.car.visible && a.car.position.x > x0 && a.car.position.x < x1);
  const LANE_SPEED = {1: 7, [-1]: 9};
  const lastSpawn = {1: 0, [-1]: 0};
  const eastClear = (x0, x1) => ![...ambientCars].some(a => a.dir > 0 && a.car.position.x > x0 && a.car.position.x < x1);

  function place(agent, p, reverse = false) {
    agent.car.position.set(p.x, groundY(p.x, p.z), p.z);
    agent.car.rotation.y = p.h + (reverse ? Math.PI : 0);
  }
  function sample(route, s) {
    const pts = route.pts;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].s < s) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi], f = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 1;
    let dh = b.h - a.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + dh * f};
  }
  // Trapezoidal speed profile: accelerate, cruise, brake to a stop at the end.
  function drive(agent, route, {speed = 6.5, reverse = false, startMoving = false} = {}) {
    const gen = generation;
    return new Promise((resolve, reject) => {
      const accel = reverse ? 1.6 : 2.6, vmax = reverse ? 2.2 : speed;
      const m = {agent, route, s: 0, v: startMoving ? vmax : 0, vmax, accel, reverse, resolve: () => (gen === generation ? resolve() : reject(ABORT))};
      agent.mover = m;
      movers.add(m);
      kick();
    });
  }
  const passed = (agent, distance) => !agent.mover || !movers.has(agent.mover) || agent.mover.s > distance;
  function waitFor(cond) {
    const gen = generation;
    return new Promise((resolve, reject) => {
      const check = () => (gen !== generation ? reject(ABORT) : cond() ? resolve() : setTimeout(check, 60));
      check();
    });
  }
  const wait = ms => waitFor((() => { const end = performance.now() + ms; return () => performance.now() >= end; })());

  function makeAgent({plate, province, type, color}) {
    const car = createCar({plate, province, color});
    lot.root.add(car);
    return {car, plate, province, type, color};
  }
  const removeAgent = agent => agent.car.removeFromParent();
  function guard(agent, fn) {
    return fn().catch(error => { removeAgent(agent); if (error !== ABORT) throw error; return 'aborted'; });
  }

  function refreshBays() {
    lot.setBays(sim.state.stalls);
    lot.drawSign(Math.max(0, sim.state.capacity - sim.state.presence.size), sim.state.capacity);
  }
  // Parked cars follow the simulation's presence (on start and after a reset).
  function syncParked() {
    generation++;
    for (const m of [...movers]) { movers.delete(m); m.resolve(); }
    for (const a of [...agents.values(), ...ambientCars]) removeAgent(a);
    agents.clear(); ambientCars.clear();
    gateQueue = entryLane = exitLane = Promise.resolve();
    entryPending = streetArrivals = exitingStreet = 0;
    arriving.clear(); streetCars.clear();
    lot.setBoom(false); kick();
    for (const [k, p] of sim.state.presence) {
      const stall = sim.state.stalls.find(s => s.id === p.stallId);
      if (!stall) continue;
      const agent = makeAgent(p);
      agent.stall = stall; agent.key = k;
      place(agent, {x: stall.x, z: stall.z, h: stall.nose > 0 ? EAST : WEST});
      agents.set(k, agent);
    }
    refreshBays();
    schedule();
  }

  // One car at a time works the barrier.
  function withGate(fn) { const run = gateQueue.then(fn); gateQueue = run.catch(() => {}); return run; }
  async function openBoom() { sim.setGate('opening'); lot.setBoom(true); kick(); await waitFor(() => !lot.boomMoving); sim.setGate('open'); }
  async function closeBoom() { sim.setGate('closing'); lot.setBoom(false); kick(); await waitFor(() => !lot.boomMoving); sim.setGate('closed'); }

  // Arrival: street → gate → plate read → open (allowed, or a staff decision) → bay.
  function arrive({plate, province, color = 0, fromX = -95}) {
    const agent = makeAgent({plate, province, type: 'unknown', color});
    agent.car.visible = false;
    const k = sim.key(plate, province);
    let resolveLane, released = false, onStreet = false;
    const previous = entryLane;
    entryLane = new Promise(r => { resolveLane = r; });
    const ahead = entryPending++;
    arriving.add(k);
    const releaseLane = () => { if (!released) { released = true; entryPending--; resolveLane(); } };
    const offStreet = () => { if (onStreet) { onStreet = false; streetArrivals--; streetCars.delete(agent); } };
    return guard(agent, async () => {
      try {
        // With cars ahead, this one queues visibly on the street; otherwise it drives straight to the barrier.
        const holdX = -33 - 6.5 * Math.max(0, ahead - 1);
        const queue = ahead > 0 && holdX > fromX + 2;
        if (ahead > 0 && !queue) await previous;
        // Appear only once the spawn point is clear of through-traffic and of the previous arrival.
        await waitFor(() => eastClear(fromX - 14, fromX + 30) && streetClear(fromX - 6, fromX + 9));
        place(agent, {x: fromX, z: STREET.laneEast, h: EAST});
        agent.car.visible = true;
        onStreet = true; streetArrivals++; streetCars.add(agent);
        hooks.onApproach?.(agent);
        if (queue) {
          await drive(agent, streetToHold(fromX, holdX), {startMoving: fromX > -90});
          await previous;
          await drive(agent, streetToGate(holdX));
        } else {
          await previous;
          await drive(agent, streetToGate(fromX), {startMoving: fromX > -90});
        }
        offStreet();
        return await withGate(async () => {
          hooks.onAtGate?.('in', agent);
          const verdict = sim.decide(plate, province);
          await hooks.readPlate?.('in', agent, verdict);
          let manual = null;
          if (!verdict.allow) {
            const alert = sim.raiseAlert({plate, province, snapshot: hooks.snapshot?.('in'), color});
            agent.alertId = alert.id;
            await waitFor(() => alert.status !== 'open');
            if (alert.status === 'denied') {
              hooks.onLeaveGate?.('in', agent, 'denied');
              releaseLane();
              await waitFor(() => eastClear(-70, -12));
              exitingStreet++;
              await drive(agent, gateBackOut(), {reverse: true});
              await drive(agent, awayEast(), {speed: LANE_SPEED[1]});
              exitingStreet--;
              removeAgent(agent);
              return 'denied';
            }
            manual = {by: alert.by, reason: alert.reasonKey};
          }
          const type = verdict.allow ? verdict.type : 'unknown';
          const stall = sim.freeStall(type === 'unknown' ? 'staff' : type);
          Object.assign(agent, {type, stall, key: k});
          await openBoom();
          sim.recordEntry({plate, province, type, stallId: stall?.id, color, manual});
          agents.set(k, agent);
          refreshBays();
          const going = drive(agent, stall ? gateToStall(stall) : exitToStreet(), {speed: 5.5});
          await waitFor(() => passed(agent, 6.5));
          hooks.onLeaveGate?.('in', agent, manual ? 'manual' : 'allowed');
          releaseLane();
          await wait(400);
          await closeBoom();
          await going;
          schedule();
          return manual ? 'manual' : 'allowed';
        });
      } finally { releaseLane(); offStreet(); arriving.delete(k); }
    });
  }

  function leave(k) {
    const agent = agents.get(k);
    if (!agent || agent.leaving || !agent.stall) return Promise.resolve(false);
    agent.leaving = true;
    const stall = agent.stall;
    let releaseLane, joined = false;
    const previous = exitLane;
    exitLane = new Promise(r => { releaseLane = r; });
    return guard(agent, async () => {
      try {
        await drive(agent, stallBackOut(stall), {reverse: true});
        // The next car out waits in its aisle until the one ahead has cleared the exit lane.
        await previous;
        await drive(agent, aisleToExit(stall));
        return await withGate(async () => {
          hooks.onAtGate?.('out', agent);
          await hooks.readPlate?.('out', agent, {allow: true, type: agent.type, exit: true});
          // Wait for a gap in the eastbound lane before lifting the barrier.
          await waitFor(() => eastClear(-68, -12));
          exitingStreet++; joined = true;
          await openBoom();
          sim.recordExit({plate: agent.plate, province: agent.province});
          agents.delete(k);
          refreshBays();
          const going = drive(agent, exitToStreet(), {speed: LANE_SPEED[1]});
          await waitFor(() => passed(agent, 6));
          hooks.onLeaveGate?.('out', agent, 'exit');
          releaseLane();
          await wait(300);
          await closeBoom();
          await going;
          removeAgent(agent);
          return true;
        });
      } finally { releaseLane(); if (joined) { joined = false; exitingStreet--; } }
    });
  }

  // A staff "mark as left" removes the car without a drive-out (a missed exit read).
  function vanish(k) { const a = agents.get(k); if (a) { removeAgent(a); agents.delete(k); refreshBays(); schedule(); } }

  // Cosmetic through-traffic on the street.
  function passBy(preferDir = Math.random() < .5 ? 1 : -1) {
    const now = performance.now();
    const ok = dir => now - lastSpawn[dir] > 4200 && (dir < 0 || (!streetArrivals && !exitingStreet && eastClear(-99, -84)));
    const dir = ok(preferDir) ? preferDir : ok(-preferDir) ? -preferDir : 0;
    if (!dir) return false;
    lastSpawn[dir] = now;
    const agent = makeAgent({plate: '', province: '', type: 'unknown', color: Math.floor(Math.random() * 9)});
    agent.dir = dir;
    ambientCars.add(agent);
    drive(agent, passing(dir), {speed: LANE_SPEED[dir], startMoving: true})
      .catch(() => {}).finally(() => { removeAgent(agent); ambientCars.delete(agent); });
    return true;
  }

  // Frame loop: runs only while something moves.
  function kick() { if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); } }
  function tick(time) {
    frame = 0;
    const dt = Math.min(.1, Math.max(0, (time - last) / 1000)); last = time;
    let active = lot.update(dt);
    for (const m of [...movers]) {
      const remaining = m.route.length - m.s;
      const brake = Math.sqrt(2 * m.accel * Math.max(0, remaining));
      m.v = Math.min(m.vmax, m.v + m.accel * dt, Math.max(.5, brake));
      m.s = Math.min(m.route.length, m.s + m.v * dt);
      place(m.agent, sample(m.route, m.s), m.reverse);
      if (m.s >= m.route.length - 1e-3) { movers.delete(m); m.resolve(); }
      active = true;
    }
    hooks.onFrame?.();
    schedule();
    if (active) kick();
  }

  return {
    syncParked, arrive, leave, vanish, passBy, refreshBays,
    // A manual open with no car read: one pulse, held briefly, then closed.
    pulse(holdMs = 5000) { return withGate(async () => { await openBoom(); await wait(holdMs); await closeBoom(); }).catch(() => {}); },
    parkedKeys: () => [...agents.entries()].filter(([, a]) => !a.leaving && a.stall).map(([k]) => k),
    agentFor: k => agents.get(k),
    get busy() { return movers.size > ambientCars.size; },
    get queued() { return entryPending; },
    isArriving: k => arriving.has(k),
  };
}
