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
const exitToStreet = () => new Route(GATE.exitX, GATE.exitStopZ, SOUTH).toZ(STREET.laneEast - 2.6).arc(2.6, Math.PI / 2).toX(70).build();
const gateBackOut = () => new Route(GATE.entryX, GATE.entryStopZ, SOUTH).arc(2.6, -Math.PI / 2).build();
const awayEast = () => new Route(GATE.entryX - 2.6, STREET.laneEast, EAST).toX(98).build();
const passing = dir => (dir > 0 ? new Route(-98, STREET.laneEast, EAST).toX(98) : new Route(98, STREET.laneWest, WEST).toX(-98)).build();

export function createTraffic({lot, sim, schedule, hooks}) {
  const agents = new Map(); // presence key -> parked (or leaving) agent
  const movers = new Set();
  const ambientCars = new Set();
  let gateQueue = Promise.resolve(), entryLane = Promise.resolve(), exitLane = Promise.resolve();
  let generation = 0, frame = 0, last = 0;

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
    let releaseLane;
    const previous = entryLane;
    entryLane = new Promise(r => { releaseLane = r; });
    return guard(agent, async () => {
      try {
        await previous;
        agent.car.visible = true;
        hooks.onApproach?.(agent);
        await drive(agent, streetToGate(fromX), {startMoving: fromX > -90});
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
              await drive(agent, gateBackOut(), {reverse: true});
              await drive(agent, awayEast(), {speed: 8});
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
      } finally { releaseLane(); }
    });
  }

  function leave(k) {
    const agent = agents.get(k);
    if (!agent || agent.leaving || !agent.stall) return Promise.resolve(false);
    agent.leaving = true;
    const stall = agent.stall;
    let releaseLane;
    const previous = exitLane;
    exitLane = new Promise(r => { releaseLane = r; });
    return guard(agent, async () => {
      try {
        await drive(agent, stallBackOut(stall), {reverse: true});
        await drive(agent, aisleToExit(stall));
        await previous;
        return await withGate(async () => {
          hooks.onAtGate?.('out', agent);
          await hooks.readPlate?.('out', agent, {allow: true, type: agent.type, exit: true});
          await openBoom();
          sim.recordExit({plate: agent.plate, province: agent.province});
          agents.delete(k);
          refreshBays();
          const going = drive(agent, exitToStreet(), {speed: 7});
          await waitFor(() => passed(agent, 6));
          hooks.onLeaveGate?.('out', agent, 'exit');
          releaseLane();
          await wait(300);
          await closeBoom();
          await going;
          removeAgent(agent);
          return true;
        });
      } finally { releaseLane(); }
    });
  }

  // A staff "mark as left" removes the car without a drive-out (a missed exit read).
  function vanish(k) { const a = agents.get(k); if (a) { removeAgent(a); agents.delete(k); refreshBays(); schedule(); } }

  // Cosmetic through-traffic on the street.
  function passBy() {
    const agent = makeAgent({plate: '', province: '', type: 'unknown', color: Math.floor(Math.random() * 9)});
    ambientCars.add(agent);
    drive(agent, passing(Math.random() < .5 ? 1 : -1), {speed: 9 + Math.random() * 3, startMoving: true})
      .catch(() => {}).finally(() => { removeAgent(agent); ambientCars.delete(agent); });
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
  };
}
