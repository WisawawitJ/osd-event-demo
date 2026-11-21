// Car movement and the gate sequence. Routes are built from straight lines and arcs ("turtle" style),
// so turns look like real cornering. Heading h means forward = (sin h, cos h) in (x, z).
import {createCar, setCarLamps} from './cars.js';
import {DRIVE, GATE, STREET, groundY} from './layout.js';
import {SPEED, demoNow, isPaused} from './clock.js';

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
  let gateQueue = Promise.resolve(), entryLane = Promise.resolve(), entryShown = Promise.resolve(), exitLane = Promise.resolve();
  let generation = 0, frame = 0, last = 0;
  // Street discipline: through-traffic keeps one speed per lane, yields to cars joining the eastbound lane,
  // and does not spawn into it while a car is driving up to the gate or pulling out.
  let entryPending = 0, streetArrivals = 0, exitingStreet = 0, eastHold = 0;
  const arriving = new Set(); // presence keys of cars on their way in
  const streetCars = new Set(); // arrival agents currently on the street
  const streetClear = (x0, x1) => ![...streetCars].some(a => a.car.visible && a.car.position.x > x0 && a.car.position.x < x1);
  const LANE_SPEED = {1: 7, [-1]: 9};
  const lastSpawn = {1: 0, [-1]: 0};
  const eastClear = (x0, x1) => ![...ambientCars].some(a => a.dir > 0 && a.car.position.x > x0 && a.car.position.x < x1);

  function place(agent, p, reverse = false) {
    agent.car.position.set(p.x, groundY(p.x, p.z), p.z);
    agent.car.rotation.y = p.h + (reverse ? Math.PI : 0);
    agent.car.updateMatrix();
    if (!agent.placed) { agent.placed = true; agent.car.visible = true; }
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
  // Every flow passes the generation it started in: after a reset (syncParked) its awaits reject with ABORT,
  // even ones that only begin later, so traffic from a previous run never carries on into the new one.
  function drive(agent, route, {speed = 6.5, reverse = false, startMoving = false} = {}, gen = generation) {
    if (gen !== generation) return Promise.reject(ABORT);
    return new Promise((resolve, reject) => {
      const accel = reverse ? 1.6 : 2.6, vmax = reverse ? 2.2 : speed;
      const m = {agent, route, s: 0, v: startMoving ? vmax : 0, vmax, accel, reverse, resolve: () => (gen === generation ? resolve() : reject(ABORT))};
      agent.mover = m;
      movers.add(m);
      kick();
    });
  }
  const passed = (agent, distance) => !agent.mover || !movers.has(agent.mover) || agent.mover.s > distance;
  // A car that needs a gap in the eastbound lane (pulling out, backing out, appearing) holds back new eastbound
  // through-traffic while it waits, so a gap always comes within a few seconds instead of possibly never.
  async function eastGap(x0, x1, gen) { eastHold++; try { await waitFor(() => eastClear(x0, x1), gen); } finally { if (gen === generation) eastHold--; } }
  function waitFor(cond, gen = generation) {
    return new Promise((resolve, reject) => {
      const check = () => (gen !== generation ? reject(ABORT) : cond() ? resolve() : setTimeout(check, 60));
      check();
    });
  }
  const wait = (ms, gen) => { const end = demoNow() + ms / SPEED; return waitFor(() => demoNow() >= end, gen); };

  // A new car stays hidden until it is first placed: drawn before that, it stood for a frame at the scene's origin,
  // in the middle of the building (a car flashing up under it).
  function makeAgent({plate, province, type, color}) {
    const car = createCar({plate, province, color});
    car.visible = false;
    lot.root.add(car);
    const agent = {car, plate, province, type, color, lit: false};
    live.add(agent); updateLamps();
    return agent;
  }
  const removeAgent = agent => { agent.car.removeFromParent(); live.delete(agent); };

  // Headlights. At night every car with its engine running (on the move, queuing or waiting at the barrier) has its
  // lamps on and their light on the road ahead (painted, see cars.js); parked cars are dark.
  const live = new Set();
  let night = false;
  const parked = a => Boolean(a.stall) && !a.leaving && !movers.has(a.mover);
  function updateLamps() {
    for (const a of live) {
      const on = night && a.car.visible && !parked(a);
      if (on !== a.lit) { a.lit = on; setCarLamps(a.car, on, night); }
    }
  }
  function setNight(value) {
    night = Boolean(value);
    // Parked cars' plates and lamps dim at night even though their lamps stay off.
    for (const a of live) { a.lit = night && a.car.visible && !parked(a); setCarLamps(a.car, a.lit, night); }
    updateLamps(); schedule();
  }
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
    gateQueue = entryLane = entryShown = exitLane = Promise.resolve();
    entryPending = streetArrivals = exitingStreet = eastHold = gateHolders = 0;
    boomCommand++;
    arriving.clear(); streetCars.clear();
    lot.setBoom(false); kick();
    for (const k of sim.state.presence.keys()) parkCar(k);
    refreshBays(); updateLamps();
    schedule();
  }
  function parkCar(k) {
    const p = sim.state.presence.get(k), stall = p && sim.state.stalls.find(s => s.id === p.stallId);
    if (!stall || agents.has(k)) return;
    const agent = makeAgent(p);
    agent.stall = stall; agent.key = k;
    place(agent, {x: stall.x, z: stall.z, h: stall.nose > 0 ? EAST : WEST});
    agents.set(k, agent);
  }
  // The car park catching up on time it did not show: a car is simply there in its bay, or gone, without driving.
  // Only for cars standing in their bays (never one on the move), and without stopping cars on the move.
  function appear(k) { parkCar(k); refreshBays(); schedule(); }
  function vanish(k) {
    const agent = agents.get(k);
    if (!agent || agent.leaving || movers.has(agent.mover)) return false;
    removeAgent(agent); agents.delete(k); refreshBays(); schedule();
    return true;
  }

  // One car at a time works the barrier.
  let gateHolders = 0;
  const gateQueueBusy = () => gateHolders > 0;
  function withGate(fn) {
    const run = gateQueue.then(async () => { gateHolders++; try { return await fn(); } finally { gateHolders--; } });
    gateQueue = run.catch(() => {});
    return run;
  }
  // The arm can be told to rise again while it is still coming down; only the latest command reports its end state.
  let boomCommand = 0;
  async function openBoom(gen) { const c = ++boomCommand; sim.setGate('opening'); lot.setBoom(true); kick(); await waitFor(() => !lot.boomMoving || c !== boomCommand, gen); if (c === boomCommand) sim.setGate('open'); }
  // A car that is not going through now (unknown, lot full, or waiting for a gap) lowers an arm left up.
  const lowerIfUp = gen => (['open', 'opening'].includes(sim.state.gate) ? closeBoom(gen) : Promise.resolve());
  async function closeBoom(gen) { const c = ++boomCommand; sim.setGate('closing'); lot.setBoom(false); kick(); await waitFor(() => !lot.boomMoving || c !== boomCommand, gen); if (c === boomCommand) sim.setGate('closed'); }

  // Arrival: street → gate → plate read → open (allowed, or a staff decision) → bay.
  // A car with nowhere to park (the lot is full) is turned away at the barrier, like a denied one.
  function arrive({plate, province, color = 0, fromX = -95, ambient = false}) {
    const gen = generation, alive = () => { if (gen !== generation) throw ABORT; };
    const agent = makeAgent({plate, province, type: 'unknown', color});
    const k = sim.key(plate, province);
    let resolveLane, resolveShown, released = false, onStreet = false, joined = false;
    const previous = entryLane, previousShown = entryShown;
    entryLane = new Promise(r => { resolveLane = r; });
    // Cars appear in arrival order: a later car holding at the queue point could otherwise stand on the spawn point
    // of an earlier one still waiting for a gap, and each would wait for the other.
    entryShown = new Promise(r => { resolveShown = r; });
    const ahead = entryPending++;
    arriving.add(k);
    // Counters belong to the run that raised them: after a reset they start from zero and must stay there.
    const releaseLane = () => { if (!released) { released = true; if (gen === generation) entryPending--; resolveLane(); } };
    const offStreet = () => { if (onStreet) { onStreet = false; if (gen === generation) { streetArrivals--; streetCars.delete(agent); } } };
    const turnAway = async () => {
      hooks.onLeaveGate?.('in');
      releaseLane();
      await eastGap(-70, -12, gen);
      exitingStreet++; joined = true;
      await drive(agent, gateBackOut(), {reverse: true}, gen);
      await drive(agent, awayEast(), {speed: LANE_SPEED[1]}, gen);
      removeAgent(agent);
    };
    return guard(agent, async () => {
      try {
        // With cars ahead, this one queues visibly on the street; otherwise it drives straight to the barrier.
        const holdX = -33 - 6.5 * Math.max(0, ahead - 1);
        const queue = ahead > 0 && holdX > fromX + 2;
        if (ahead > 0 && !queue) { await previous; alive(); }
        await previousShown; alive();
        // Appear only once the spawn point is clear of through-traffic and of the previous arrival.
        await eastGap(fromX - 14, fromX + 30, gen);
        await waitFor(() => eastClear(fromX - 14, fromX + 30) && streetClear(fromX - 6, fromX + 9), gen);
        place(agent, {x: fromX, z: STREET.laneEast, h: EAST});
        agent.car.visible = true; resolveShown();
        onStreet = true; streetArrivals++; streetCars.add(agent);
        if (queue) {
          await drive(agent, streetToHold(fromX, holdX), {startMoving: fromX > -90}, gen);
          await previous; alive();
          await drive(agent, streetToGate(holdX), {}, gen);
        } else {
          await previous; alive();
          await drive(agent, streetToGate(fromX), {startMoving: fromX > -90}, gen);
        }
        offStreet();
        // The barrier is held only while this car is at it: from the plate read until the car is through.
        const passage = await withGate(async () => {
          alive();
          const verdict = sim.decide(plate, province);
          await hooks.readPlate?.('in', agent, verdict);
          alive();
          let manual = null;
          if (!verdict.allow) {
            await lowerIfUp(gen);
            const alert = sim.raiseAlert({plate, province, snapshot: hooks.snapshot?.('in'), color, ambient});
            await waitFor(() => alert.status !== 'open', gen);
            if (alert.status === 'denied') return 'denied';
            manual = {by: alert.by, reason: alert.reasonKey};
          }
          const type = verdict.allow ? verdict.type : 'unknown';
          const stall = sim.freeStall(type === 'unknown' ? 'staff' : type);
          if (!stall) { hooks.onFull?.(plate); await lowerIfUp(gen); return 'full'; }
          Object.assign(agent, {type, stall, key: k});
          await openBoom(gen);
          sim.recordEntry({plate, province, type, stallId: stall.id, color, manual});
          agents.set(k, agent);
          refreshBays();
          const going = drive(agent, gateToStall(stall), {speed: 5.5}, gen);
          going.catch(() => {}); // awaited later; if a reset cancels the drive before that, its rejection is expected
          await waitFor(() => passed(agent, 6.5), gen);
          hooks.onLeaveGate?.('in');
          releaseLane();
          return {going, result: manual ? 'manual' : 'allowed'};
        });
        // Through: the next car may already read its plate while the arm comes down (it rises again if allowed).
        if (typeof passage !== 'string') void wait(400, gen).then(() => { if (!gateQueueBusy()) return closeBoom(gen); }).catch(() => {});
        // Denied or full: the car reverses out and drives away, without holding the barrier.
        if (typeof passage === 'string') { await turnAway(); return passage; }
        await passage.going;
        schedule();
        return passage.result;
      } finally {
        resolveShown(); releaseLane(); offStreet();
        if (gen === generation) { arriving.delete(k); if (joined) exitingStreet--; }
      }
    });
  }

  function leave(k) {
    const agent = agents.get(k);
    if (!agent || agent.leaving || !agent.stall) return Promise.resolve(false);
    const gen = generation, alive = () => { if (gen !== generation) throw ABORT; };
    agent.leaving = true;
    const stall = agent.stall;
    let releaseLane, joined = false, holding = false;
    const previous = exitLane;
    exitLane = new Promise(r => { releaseLane = r; });
    return guard(agent, async () => {
      try {
        // Hold back new eastbound through-traffic from the moment the car pulls out of its bay, so the street has
        // cleared by the time it reaches the barrier (it used to wait there 15–20 s for a gap).
        eastHold++; holding = true;
        await drive(agent, stallBackOut(stall), {reverse: true}, gen);
        // The next car out waits in its aisle until the one ahead has cleared the exit lane.
        await previous; alive();
        await drive(agent, aisleToExit(stall), {}, gen);
        const {going} = await withGate(async () => {
          alive();
          await hooks.readPlate?.('out', agent, {allow: true, type: agent.type, exit: true});
          // Wait for a gap in the eastbound lane before lifting the barrier: the stretch a car covers in ~4 s.
          if (!eastClear(GATE.exitX - 28, GATE.exitX + 5)) await lowerIfUp(gen);
          await waitFor(() => eastClear(GATE.exitX - 28, GATE.exitX + 5), gen);
          exitingStreet++; joined = true;
          await openBoom(gen);
          sim.recordExit({plate: agent.plate, province: agent.province});
          agents.delete(k);
          refreshBays();
          const going = drive(agent, exitToStreet(), {speed: LANE_SPEED[1]}, gen);
          going.catch(() => {}); // awaited later; if a reset cancels the drive before that, its rejection is expected
          await waitFor(() => passed(agent, 6), gen);
          hooks.onLeaveGate?.('out');
          releaseLane();
          // Wrapped: returning the promise itself from this async function would make the barrier wait until the
          // car had driven off the map (the arm stayed up ~15 s after every exit).
          return {going};
        });
        void wait(300, gen).then(() => { if (!gateQueueBusy()) return closeBoom(gen); }).catch(() => {});
        await going;
        removeAgent(agent);
        return true;
      } finally {
        releaseLane();
        if (gen === generation) { if (joined) exitingStreet--; if (holding) eastHold--; }
      }
    });
  }

  // Cosmetic through-traffic on the street.
  function passBy(preferDir = Math.random() < .5 ? 1 : -1) {
    const now = demoNow();
    // Spacing is in demo time, so ?speed keeps the same traffic density the visitors see.
    const ok = dir => now - lastSpawn[dir] > 4200 / SPEED && (dir < 0 || (!streetArrivals && !exitingStreet && !eastHold && eastClear(-99, -84)));
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
    // Paused: nothing moves; the loop keeps watching so cars carry on from where they stood.
    if (isPaused()) { last = time; frame = requestAnimationFrame(tick); return; }
    // Cars move in real time whatever the frame rate: a slow frame (a heavy zoomed-out view) is
    // stepped in 50 ms slices. Only a stall longer than half a second (tab switch, debugger) is dropped.
    const elapsed = Math.min(.5, Math.max(0, (time - last) / 1000)) * SPEED; last = time;
    const steps = Math.max(1, Math.ceil(elapsed / .05)), dt = elapsed / steps;
    let active = false;
    for (let i = 0; i < steps; i++) {
      if (lot.update(dt)) active = true;
      for (const m of [...movers]) {
        const remaining = m.route.length - m.s;
        const brake = Math.sqrt(2 * m.accel * Math.max(0, remaining));
        m.v = Math.min(m.vmax, m.v + m.accel * dt, Math.max(.5, brake));
        m.s = Math.min(m.route.length, m.s + m.v * dt);
        if (m.s >= m.route.length - 1e-3) { movers.delete(m); place(m.agent, sample(m.route, m.s), m.reverse); m.resolve(); }
        active = true;
      }
    }
    for (const m of movers) place(m.agent, sample(m.route, m.s), m.reverse);
    if (night) updateLamps();
    // A hidden car park (a view of an upper floor) has nothing to redraw: the cars still move, unseen.
    if (lot.root.visible) schedule();
    // Chain straight to the next frame: going through kick() reset `last` to now and lost the time spent in this
    // frame, so cars moved only ~75% as fast, and slower still whenever the page was busy (scrolling, zooming out).
    if (active) frame = requestAnimationFrame(tick);
  }

  return {
    syncParked, arrive, leave, passBy, refreshBays, setNight,
    // A manual open with no car read: one pulse, held briefly, then closed.
    pulse(holdMs = 5000) { const gen = generation; return withGate(async () => { await openBoom(gen); await wait(holdMs, gen); await closeBoom(gen); }).catch(() => {}); },
    parkedKeys: () => [...agents.entries()].filter(([, a]) => !a.leaving && a.stall).map(([k]) => k),
    get busy() { return movers.size > ambientCars.size; },
    get queued() { return entryPending; },
    get leaving() { let n = 0; for (const a of agents.values()) if (a.leaving) n++; return n; },
    appear, vanish,
    get gateHolders() { return gateHolders; },
    isArriving: k => arriving.has(k),
  };
}
