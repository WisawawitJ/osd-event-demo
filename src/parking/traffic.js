// Car movement and the gate sequence. Routes are built from straight lines and arcs ("turtle" style),
// so turns look like real cornering. Heading h means forward = (sin h, cos h) in (x, z).
import {createCar, setCarLamps, setCarBlinker} from './cars.js';
import {DRIVE, GATE, STREET, ENTRY_TURN, FAR_TURN, groundY} from './layout.js';
import {demoNow, later, onTick, rng} from './clock.js';

const EAST = Math.PI / 2,
  WEST = -Math.PI / 2,
  NORTH = Math.PI,
  SOUTH = 0;
const LANE_IN = 17.6,
  LANE_OUT = 14.8; // driveway halves: westbound (in) / eastbound (out)
const ABORT = Symbol('abort');

class Route {
  constructor(x, z, h) {
    this.pts = [{x, z, h}];
    this.x = x;
    this.z = z;
    this.h = h;
  }
  push() {
    this.pts.push({x: this.x, z: this.z, h: this.h});
  }
  line(len) {
    if (Math.abs(len) < 1e-3) return this;
    const n = Math.ceil(Math.abs(len) / 0.25);
    for (let i = 0; i < n; i++) {
      this.x += (Math.sin(this.h) * len) / n;
      this.z += (Math.cos(this.h) * len) / n;
      this.push();
    }
    return this;
  }
  // Left turns increase h, right turns decrease it.
  arc(r, angle) {
    const n = Math.max(2, Math.ceil((Math.abs(angle) * r) / 0.2)),
      ds = (Math.abs(angle) * r) / n,
      dh = angle / n;
    for (let i = 0; i < n; i++) {
      this.h += dh / 2;
      this.x += Math.sin(this.h) * ds;
      this.z += Math.cos(this.h) * ds;
      this.h += dh / 2;
      this.push();
    }
    return this;
  }
  toX(x) {
    return this.line((x - this.x) / Math.sin(this.h));
  }
  toZ(z) {
    return this.line((z - this.z) / Math.cos(this.h));
  }
  build() {
    const pts = this.pts;
    let s = 0;
    pts[0].s = 0;
    for (let i = 1; i < pts.length; i++) {
      s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      pts[i].s = s;
    }
    return {pts, length: s};
  }
}

// Routes ----------------------------------------------------------------
// A queued arrival waits on the street at holdX, clear of the turn into the gate.
const streetToHold = (fromX, holdX) => new Route(fromX, STREET.laneEast, EAST).toX(holdX).build();
// The turn between the near lane and the entry barrier's stop line (and back out of it, for a car turned away).
const ENTRY_R = ENTRY_TURN;
// The queue for the entry on the near lane: its first place is just clear (0.8 m) of a car backing out of the entry,
// turned away, which ends where the turn in starts; the places behind are a car and 2 m apart. (The first place was
// x -33, leaving 7–8 m of empty road behind the car at the barrier.)
const QUEUE_HEAD = GATE.entryX - ENTRY_R - 2.23 - 0.8 - 2.2,
  QUEUE_GAP = 6.5;
// Speed into an aisle and its bay.
const AISLE_SPEED = 4.5;
// How far before its turn off the street a car starts signalling.
const SIGNAL_AHEAD = 30;
// Off the near lane into the entrance road, then up it to the stop line.
const streetToGate = (fromX) =>
  new Route(fromX, STREET.laneEast, EAST)
    .toX(GATE.entryX - ENTRY_R)
    .arc(ENTRY_R, Math.PI / 2)
    .toZ(GATE.entryStopZ)
    .build();
// In two parts: from the barrier to the mouth of the bay's aisle, then (once the aisle has no car coming out of it, see
// the arrival's rollOn) into the aisle and the bay.
function gateToAisle(stall) {
  const r = new Route(GATE.entryX, GATE.entryStopZ, NORTH);
  if (stall.zone === 'P1')
    r.toZ(LANE_OUT + 2)
      .arc(2, -Math.PI / 2)
      .toX(stall.aisleX - 2.4);
  else
    r.toZ(LANE_IN + 1.8)
      .arc(1.8, Math.PI / 2)
      .toX(stall.aisleX + 3);
  return r.build();
}
function aisleToStall(stall) {
  const r =
    stall.zone === 'P1'
      ? new Route(stall.aisleX - 2.4, LANE_OUT, EAST).arc(2.4, Math.PI / 2)
      : new Route(stall.aisleX + 3, LANE_IN, WEST).arc(3, -Math.PI / 2);
  // Into the bay: east-nosed bays are a right turn from a northbound aisle, west-nosed a left turn.
  r.toZ(stall.z + 2)
    .arc(2, stall.nose > 0 ? -Math.PI / 2 : Math.PI / 2)
    .toX(stall.x);
  return r.build();
}
// Backing out: the route follows the car's rear, so the car faces against the route.
function stallBackOut(stall) {
  const r = new Route(stall.x, stall.z, stall.nose > 0 ? WEST : EAST).toX(
    stall.aisleX - Math.sign(stall.aisleX - stall.x) * 2,
  );
  return r.arc(2, stall.nose > 0 ? -Math.PI / 2 : Math.PI / 2).build();
}
// From P1: up its aisle, then west along the driveway to the exit's stop line.
function p1ToExit(stall) {
  const r = new Route(stall.aisleX, stall.z - 2, SOUTH);
  r.toZ(DRIVE.north - 0.3)
    .arc(2, -Math.PI / 2)
    .toX(GATE.exitX + 1.8)
    .arc(1.8, Math.PI / 2);
  return r.toZ(GATE.exitStopZ).build();
}
// From P2 in two parts: down the aisle to where it gives way, its nose short of the exit lane (MOUTH_Z), then out
// along the lane to the exit's stop line.
const MOUTH_Z = LANE_OUT - 5;
// On the exit lane, a leaving car from P2 goes on past this point (its front 2.2 m on, 4.4 m short of where the way
// into P1 turns onto the lane) only with no P1 arrival at the barrier or on that way (`outbound` above).
const OUT_COMMIT_X = -28.5;
const aisleToMouth = (stall) => new Route(stall.aisleX, stall.z - 2, SOUTH).toZ(Math.max(stall.z - 2, MOUTH_Z)).build();
const mouthToExit = (stall) =>
  new Route(stall.aisleX, Math.max(stall.z - 2, MOUTH_Z), SOUTH)
    .toZ(LANE_OUT - 2)
    .arc(2, Math.PI / 2)
    .toX(GATE.exitX - 1.8)
    .arc(1.8, -Math.PI / 2)
    .toZ(GATE.exitStopZ)
    .build();
const exitToStreet = () =>
  new Route(GATE.exitX, GATE.exitStopZ, SOUTH)
    .toZ(STREET.laneEast - 2.6)
    .arc(2.6, Math.PI / 2)
    .toX(98)
    .build();
// Out to the far lane: a right turn across the near lane, wide enough to pass in front of a far-lane car standing at
// its own turn into the barrier (TURN_X below), with about 0.8 m to spare.
const OUT_R = 4;
const exitToFarLane = () =>
  new Route(GATE.exitX, GATE.exitStopZ, SOUTH)
    .toZ(STREET.laneWest - OUT_R)
    .arc(OUT_R, -Math.PI / 2)
    .toX(-98)
    .build();
const gateBackOut = () =>
  new Route(GATE.entryX, GATE.entryStopZ, SOUTH)
    .toZ(STREET.laneEast - ENTRY_R)
    .arc(ENTRY_R, -Math.PI / 2)
    .build();
const awayEast = () => new Route(GATE.entryX - ENTRY_R, STREET.laneEast, EAST).toX(98).build();
// From the far (westbound) lane: up to the turn, then a right turn across the near lane, ending at the barrier's stop
// line like a turn from the near lane (its radius is the far lane's distance from that line).
const TURN_R = FAR_TURN,
  TURN_X = GATE.entryX + TURN_R;
const westToTurn = (fromX) => new Route(fromX, STREET.laneWest, WEST).toX(TURN_X).build();
const westTurnIn = () =>
  new Route(TURN_X, STREET.laneWest, WEST)
    .arc(TURN_R, -Math.PI / 2)
    .toZ(GATE.entryStopZ)
    .build();
const passing = (dir) =>
  (dir > 0 ? new Route(-98, STREET.laneEast, EAST).toX(98) : new Route(98, STREET.laneWest, WEST).toX(-98)).build();

export function createTraffic({lot, sim, schedule, hooks}) {
  const agents = new Map(); // presence key -> parked (or leaving) agent
  const movers = new Set();
  const ambientCars = new Set();
  // The entry's order: the last car to have taken its turn (`done` once it is through the barrier, or gone).
  let entryLast = {done: true, promise: Promise.resolve()},
    entryShown = Promise.resolve();
  let gateLanes = {in: Promise.resolve(), out: Promise.resolve()},
    plateReads = Promise.resolve();
  let generation = 0;
  // Street discipline: through-traffic keeps one speed per lane, yields to cars joining the eastbound lane,
  // and does not spawn into it while a car is driving up to the gate or pulling out.
  let entryPending = 0,
    exitingStreet = 0,
    eastHold = 0;
  // The far lane: one arrival at a time on it (no through-traffic behind it while it waits to turn), and `crossing`
  // while it turns across the near lane and the gate's mouth (exits wait meanwhile).
  // `westHold`: a far-lane arrival waiting to appear holds back new far-lane through-traffic, so its gap comes.
  let westOnStreet = 0,
    crossing = 0,
    westHold = 0;
  // A car leaving for the far lane: `outWest` while it crosses the near lane (near-lane arrivals do not start their
  // last stretch to the barrier, nor far-lane ones their turn, nor turned-away cars their back-out), and `westExitHold`
  // while it waits at the barrier for its gap (no new far-lane through-traffic). `inbound`: near-lane arrivals on their
  // last stretch to the barrier, whose turn-in an exit would meet (either way: both wait for it).
  let outWest = 0,
    westExitHold = 0,
    inbound = 0;
  // `outEast`: a car leaving with a left turn onto the near lane, while it turns: its rear swings out over the entry's
  // curve, so a near-lane arrival's last stretch and a turned-away car's back-out wait (it touched one of them).
  let outEast = 0;
  // `backingOut`: a car turned away at the entry, from the moment it is refused until it has backed out onto the
  // street: an exit waiting for the arm set off at the same moment (the reversing car still too near the barrier for
  // movingNear to see).
  let backingOut = 0;
  // The exit lane's end, by the barrier, is the way into P1 too: a car bound for P1 turns onto it from the entry and
  // drives along it to P1's aisle, across the turn of cars leaving to the exit's stop line (it met one head-on at its
  // aisle's mouth, and crossed the path of one coming from P2; each stopped for the other for good). Never both:
  // - `outbound`: leaving cars past the point of no return, until they are through the exit barrier: from P1 from
  //   their bay on (P1's aisle is the arrival's way too), from P2 from OUT_COMMIT_X on the exit lane;
  // - `p1Waiting`: P1 arrivals at the entry barrier, from the plate read until their way is free of those. New leavers
  //   wait meanwhile (at that point, or in a P1 bay), so the wait is only for the cars already past it: counting every
  //   car on its way out, a VIP waited 20 s and more at the barrier, and the queue behind it, as one car after another
  //   set off;
  // - `p1OnLane`: P1 arrivals from the barrier until they turn off the exit lane into P1's aisle (leavers from P2 then
  //   go on), `p1In` until they are in their bay (leavers from P1 then go on).
  let outbound = 0,
    p1Waiting = 0,
    p1OnLane = 0,
    p1In = 0;
  const arriving = new Set(); // presence keys of cars on their way in
  const departing = new Set(); // presence keys of cars out through the exit, still driving off
  const streetCars = new Set(); // arrival agents currently on the street
  const LANE_SPEED = {1: 7, [-1]: 9};
  const lastSpawn = {1: 0, [-1]: 0};
  const eastClear = (x0, x1) =>
    ![...ambientCars].some((a) => a.dir > 0 && a.car.position.x > x0 && a.car.position.x < x1);
  const westClear = (x0, x1 = Infinity) =>
    ![...ambientCars].some((a) => a.dir < 0 && a.car.position.x > x0 && a.car.position.x < x1);
  const laneCars = (lane) => [...streetCars].filter((a) => a.lane === lane && a.car.visible);
  // An aisle is one lane: cars go in or come out of it, not both at once (they met head-on in it). Same-way cars
  // keep their distance by pathCap below.
  const aisles = new Map();
  const mouthStops = []; // plates of the last cars that had to stop at their aisle's mouth (for tests and probes)
  const aisleOf = (x) => {
    if (!aisles.has(x)) aisles.set(x, {in: 0, out: 0});
    return aisles.get(x);
  };
  const leaveAisle = (x, way, gen) => {
    if (gen === generation) aisleOf(x)[way]--;
  };
  const exitLaneClear = (x) =>
    ![...live].some(
      (a) =>
        a.car.visible &&
        Math.abs(a.car.position.z - LANE_OUT) < 0.7 &&
        Math.sin(a.car.rotation.y) > 0.7 &&
        a.car.position.x > x - 14 &&
        a.car.position.x < x + 3,
    );
  // In front of the gate: another car on the move between the near lane and the road's edge (cars standing there are
  // not in the way of one driving out). Not one already past the entry's stop line, on its way in: reaching back to
  // the arm, it counted a car stopped behind one bound for P1, which waited for the car going out to go (each waited
  // for the next, for good). Nor a queued car rolling up to its place (x -31.43 and on): reaching back to x -36, it
  // left an exit no gap between arrivals for up to 16 s. A car backing out of the entry stays east of x -26.2.
  const movingNear = (self) =>
    [...live].some(
      (a) =>
        a !== self &&
        a.car.visible &&
        movers.has(a.mover) &&
        a.car.position.x > GATE.entryX - 6 &&
        a.car.position.x < GATE.exitX + 4 &&
        a.car.position.z > STREET.north - 0.3 &&
        a.car.position.z < STREET.laneEast + 1.3,
    );
  // The gate's mouth (the barrier's two lanes out to the near lane) holds no other car.
  const mouthClear = (self) =>
    ![...live].some(
      (a) =>
        a !== self &&
        a.car.visible &&
        a.car.position.x > GATE.entryX - 5 &&
        a.car.position.x < GATE.exitX + 8.2 &&
        a.car.position.z > LANE_OUT + 0.7 &&
        a.car.position.z < STREET.laneEast + 1.1,
    );

  function place(agent, p, reverse = false) {
    agent.car.position.set(p.x, groundY(p.x, p.z), p.z);
    agent.car.rotation.y = p.h + (reverse ? Math.PI : 0);
    agent.car.updateMatrix();
    if (!agent.placed) {
      agent.placed = true;
      agent.car.visible = true;
    }
  }
  function sample(route, s) {
    const pts = route.pts;
    let lo = 0,
      hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s < s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo],
      b = pts[hi],
      f = b.s > a.s ? Math.min(1, Math.max(0, (s - a.s) / (b.s - a.s))) : 1;
    let dh = b.h - a.h;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    return {x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h + dh * f};
  }
  // Trapezoidal speed profile: accelerate, cruise, brake to a stop at the end.
  // Every flow passes the generation it started in: after a reset (syncParked) its awaits reject with ABORT,
  // even ones that only begin later, so traffic from a previous run never carries on into the new one.
  // `endSpeed(remaining)`: the speed to arrive at instead of stopping (a car rolling on into its next stretch, see
  // the turn into an aisle); `startSpeed`: the speed it starts at (its speed at the end of the last stretch).
  // `hold`: {s, go}: the car stops at distance `s` along the route unless `go()` (asked from its braking distance
  // on, until it says yes) lets it on.
  function drive(
    agent,
    route,
    {speed = 6.5, reverse = false, startMoving = false, endSpeed = null, startSpeed = null, hold = null} = {},
    gen = generation,
  ) {
    if (gen !== generation) return Promise.reject(ABORT);
    return new Promise((resolve, reject) => {
      const accel = reverse ? 1.6 : 2.6,
        vmax = reverse ? 2.2 : speed;
      const m = {
        agent,
        route,
        s: 0,
        v: startSpeed ?? (startMoving ? vmax : 0),
        vmax,
        accel,
        reverse,
        endSpeed,
        hold,
        resolve: () => (gen === generation ? resolve() : reject(ABORT)),
        abort: () => reject(ABORT),
      };
      agent.mover = m;
      movers.add(m);
    });
  }
  const passed = (agent, distance) => !agent.mover || !movers.has(agent.mover) || agent.mover.s > distance;
  // A car that needs a gap in the eastbound lane (pulling out, backing out, appearing) holds back new eastbound
  // through-traffic while it waits, so a gap always comes within a few seconds instead of possibly never.
  // `also`: anything else it waits for meanwhile.
  async function eastGap(x0, x1, gen, also = () => true) {
    eastHold++;
    try {
      await waitFor(() => eastClear(x0, x1) && also(), gen);
    } finally {
      if (gen === generation) eastHold--;
    }
  }
  function waitFor(cond, gen = generation) {
    return new Promise((resolve, reject) => {
      const check = () => (gen !== generation ? reject(ABORT) : cond() ? resolve() : later(check, 60));
      check();
    });
  }
  const wait = (ms, gen) => {
    const end = demoNow() + ms;
    return waitFor(() => demoNow() >= end, gen);
  };

  // A new car stays hidden until it is first placed: drawn before that, it stood for a frame at the scene's origin,
  // in the middle of the building (a car flashing up under it).
  function makeAgent({plate, province, type, color}) {
    const car = createCar({plate, province, color});
    car.visible = false;
    lot.root.add(car);
    // `lit` unknown at first, so the first lamp update sets its plate for the time of day too (shared plate materials
    // kept their last brightness: a car appearing in a bay at night could show a bright plate).
    const agent = {car, plate, province, type, color, lit: undefined};
    live.add(agent);
    updateLamps();
    return agent;
  }
  // Its drive ends with it, cut short (a flow failing while its car still drove, the plate read during the approach, left
  // the car park busy for good; dropped unsettled, a drive's own clean-up, freeing its aisle, never ran).
  const removeAgent = (agent) => {
    agent.car.removeFromParent();
    live.delete(agent);
    if (agent.mover && movers.delete(agent.mover)) agent.mover.abort();
  };

  // Headlights. At night every car with its engine running (on the move, queuing or waiting at the barrier) has its
  // lamps on and their light on the road ahead (painted, see cars.js); parked cars are dark.
  const live = new Set();
  let night = false;
  // Parked: standing in its bay (inBay), not merely given one (a car on its way, or waiting at its aisle's mouth).
  const parked = (a) => Boolean(a.inBay) && !a.leaving && !movers.has(a.mover);
  // Returns whether any car's lamps changed.
  function updateLamps() {
    let changed = false;
    for (const a of live) {
      const on = night && a.car.visible && !parked(a);
      if (on !== a.lit) {
        a.lit = on;
        setCarLamps(a.car, on, night);
        changed = true;
      }
    }
    return changed;
  }
  function setNight(value) {
    night = Boolean(value);
    // Parked cars' plates and lamps dim at night even though their lamps stay off.
    for (const a of live) {
      a.lit = night && a.car.visible && !parked(a);
      setCarLamps(a.car, a.lit, night);
    }
    schedule();
  }
  function guard(agent, fn) {
    return fn().catch((error) => {
      removeAgent(agent);
      if (error !== ABORT) throw error;
      return 'aborted';
    });
  }

  function refreshBays() {
    lot.setBays(sim.state.stalls);
    lot.drawSign(Math.max(0, sim.state.capacity - sim.state.presence.size), sim.state.capacity);
  }
  // Parked cars follow the simulation's presence (on start and after a reset).
  function syncParked() {
    generation++;
    for (const m of [...movers]) {
      movers.delete(m);
      m.resolve();
    }
    // Every car goes at once, those still on their way in too (left until their flow next looked, one stood at the
    // barrier through its plate read into the new run, and the Gate tab's camera captured it there).
    for (const a of [...live]) removeAgent(a);
    agents.clear();
    ambientCars.clear();
    entryShown = plateReads = Promise.resolve();
    entryLast = {done: true, promise: Promise.resolve()};
    gateLanes = {in: Promise.resolve(), out: Promise.resolve()};
    entryPending =
      exitingStreet =
      eastHold =
      gateHolders =
      under =
      armHeld =
      westOnStreet =
      crossing =
      westHold =
      outWest =
      outEast =
      backingOut =
      westExitHold =
      inbound =
      outbound =
      p1Waiting =
      p1OnLane =
      p1In =
        0;
    aisles.clear();
    mouthStops.length = 0;
    boomCommand++;
    arriving.clear();
    departing.clear();
    streetCars.clear();
    // Down, the records told so too (lowered on the lot alone, an arm caught rising stayed "opening" for good).
    void closeBoom(generation).catch(() => {});
    for (const k of sim.state.presence.keys()) parkCar(k);
    refreshBays();
    updateLamps();
    schedule();
  }
  function parkCar(k) {
    const p = sim.state.presence.get(k),
      stall = p && sim.state.stalls.find((s) => s.id === p.stallId);
    if (!stall || agents.has(k)) return;
    const agent = makeAgent(p);
    agent.stall = stall;
    agent.key = k;
    agent.inBay = true;
    place(agent, {x: stall.x, z: stall.z, h: stall.nose > 0 ? EAST : WEST});
    agents.set(k, agent);
  }
  // The car park catching up on time it did not show: a car is simply there in its bay, or gone, without driving.
  // Only for cars standing in their bays (never one on the move), and without stopping cars on the move.
  function appear(k) {
    parkCar(k);
    refreshBays();
    schedule();
  }
  // `gone` records the departure before the bays and the sign are redrawn (drawn first, they showed the car still there).
  function vanish(k, gone) {
    const agent = agents.get(k);
    if (!agent || agent.leaving || !agent.inBay || movers.has(agent.mover)) return false; // only a car standing in its bay
    removeAgent(agent);
    agents.delete(k);
    gone();
    refreshBays();
    schedule();
    return true;
  }

  // The barrier: one arm over both lanes, as on site, but each lane takes its own turn at it: a car going in no longer
  // waits for one going out (a leaving car waiting for a gap in the traffic kept an arriving one waiting behind it, two
  // cars stuck at the gate). The arm is up while any car passes under it (`under`, a manual open too) and comes down
  // once none does. It stays down while an unknown car waits for staff (`armHeld`): a car going out waits meanwhile.
  let gateHolders = 0,
    under = 0,
    armHeld = 0;
  function withGate(lane, fn) {
    // Counted for the run it began in: a reset sets the count to 0, and the old holder ending later took it to -1.
    const run = gateLanes[lane].then(async () => {
      const gen = generation;
      gateHolders++;
      try {
        return await fn();
      } finally {
        if (gen === generation) gateHolders--;
      }
    });
    gateLanes[lane] = run.catch(() => {});
    return run;
  }
  // Plate reads take turns: the camera card shows one car at a time. One still waiting its turn at a reset is skipped
  // (it showed a removed car's card after the restart, and its flow, ended, never hid it). Done for the car once its
  // plate is recognised (the hook's `recognised`): the card shows the verdict a moment longer, as the arm rises
  // (gate.js has the timing).
  function readPlate(...args) {
    const gen = generation;
    let recognised;
    const seen = new Promise((r) => {
      recognised = r;
    });
    const run = plateReads.then(() => (gen === generation ? hooks.readPlate?.(...args, recognised) : undefined));
    plateReads = run.catch(() => {});
    return Promise.race([seen, run]);
  }
  // Up for a car passing under the arm until `passedUnder`, after which it comes down `ms` later unless another car is
  // under it by then: down after every car, as on site (it stayed up for the next car in a queue, which drove under it
  // without a stop). The next car's plate is read as it rolls up, and the arm rises again as soon as it is read.
  async function raiseFor(gen) {
    if (gen !== generation) throw ABORT;
    under++;
    await openBoom(gen);
  }
  function passedUnder(gen, ms) {
    if (gen !== generation) return;
    under--;
    void wait(ms, gen)
      .then(() => lowerIfUp(gen))
      .catch(() => {});
  }
  // The arm can be told to rise again while it is still coming down; only the latest command reports its end state.
  let boomCommand = 0;
  async function moveBoom(open, gen) {
    const c = ++boomCommand;
    sim.setGate(open ? 'opening' : 'closing');
    lot.setBoom(open);
    await waitFor(() => !lot.boomMoving || c !== boomCommand, gen);
    if (c === boomCommand) sim.setGate(open ? 'open' : 'closed');
  }
  const openBoom = (gen) => moveBoom(true, gen),
    closeBoom = (gen) => moveBoom(false, gen);
  // A car that is not going through now (unknown, lot full, or waiting for a gap) lowers an arm left up, unless another
  // car is passing under it.
  const lowerIfUp = (gen) =>
    !under && ['open', 'opening'].includes(sim.state.gate) ? closeBoom(gen) : Promise.resolve();

  // Arrival: street → gate → plate read → open (allowed, or a staff decision) → bay.
  // A car with nowhere to park (the lot is full) is turned away at the barrier, like a denied one.
  // `west`: from the far lane (spawning at its east end), turning right across the near lane into the barrier.
  function arrive({plate, province, color = 0, fromX = -95, ambient = false, west = false}) {
    const gen = generation,
      alive = () => {
        if (gen !== generation) throw ABORT;
      };
    const agent = makeAgent({plate, province, type: 'unknown', color});
    const k = sim.key(plate, province);
    let resolveLane,
      resolveShown,
      released = false,
      onStreet = false,
      joined = false,
      westing = false,
      turning = false,
      coming = false,
      toP1 = false,
      backing = false;
    const startBacking = () => {
      if (!backing) {
        backing = true;
        backingOut++;
      }
    };
    const endBacking = () => {
      if (backing) {
        backing = false;
        if (gen === generation) backingOut--;
      }
    };
    // Bound for P1: `p1Waiting` from its read until its way is free, then `p1OnLane` until it turns into P1's aisle and
    // `p1In` until it is in its bay.
    let holdingP1 = false,
      onLane = false;
    const waitP1 = () => {
      if (!holdingP1) {
        holdingP1 = true;
        p1Waiting++;
      }
    };
    const endWaitP1 = () => {
      if (holdingP1) {
        holdingP1 = false;
        if (gen === generation) p1Waiting--;
      }
    };
    const offLane = () => {
      if (onLane) {
        onLane = false;
        if (gen === generation) p1OnLane--;
      }
    };
    const endP1 = () => {
      endWaitP1();
      offLane();
      if (toP1) {
        toP1 = false;
        if (gen === generation) p1In--;
      }
    };
    // Its turn at the entry is taken when it gets there (a near-lane car a stopping distance short of its place in the
    // queue, a far-lane one at its turn), not when it is sent or appears: a far-lane car sent first, 110 m further out,
    // kept a near-lane car that got there first waiting until it had driven up and turned in, and a near-lane car taking
    // its turn as it appeared, 50 m out, did the same to a far-lane car already waiting at its turn.
    let earlier = null;
    const takeTurn = () => {
      earlier = entryLast;
      const turn = {done: false};
      turn.promise = new Promise((r) => {
        resolveLane = () => {
          turn.done = true;
          r();
        };
      });
      entryLast = turn;
    };
    const previous = () => earlier.promise,
      ready = () => earlier.done;
    // Near-lane cars appear in the order they were sent: a later car holding at the queue point could otherwise stand
    // on the spawn point of an earlier one still waiting for a gap, and each would wait for the other.
    const previousShown = west ? Promise.resolve() : entryShown;
    resolveShown = () => {};
    if (!west)
      entryShown = new Promise((r) => {
        resolveShown = r;
      });
    entryPending++;
    arriving.add(k);
    // Counters belong to the run that raised them: after a reset they start from zero and must stay there.
    const releaseLane = () => {
      if (!released) {
        released = true;
        if (gen === generation) entryPending--;
        resolveLane?.();
      }
    };
    const offStreet = () => {
      if (onStreet) {
        onStreet = false;
        if (gen === generation) streetCars.delete(agent);
      }
    };
    // Its last stretch to the barrier starts once no car is turning out across the entry's mouth (to either lane), and
    // keeps one from starting (claimed in the same look: checked apart, both could set off in one tick).
    const comeIn = () =>
      waitFor(() => {
        if (outWest || outEast) return false;
        inbound++;
        coming = true;
        return true;
      }, gen);
    const arrived = () => {
      if (coming) {
        coming = false;
        if (gen === generation) inbound--;
      }
    };
    const beyondArmClear = () =>
      ![...live].some(
        (a) =>
          a !== agent &&
          a.car.visible &&
          !parked(a) &&
          a.car.position.z < GATE.z &&
          a.car.position.z > LANE_OUT - 3 &&
          a.car.position.x > GATE.entryX - 8 &&
          a.car.position.x < GATE.exitX + 8,
      );
    // Up to the stop line, done with once 3 m short of it: the camera reads its plate as it rolls up that last stretch
    // (as at the exit), and the barrier is its from there, so the arm rises as soon as it is read (read once it stood
    // there, then the arm raised, each car stood 2 s at the barrier).
    // `stopped`: the drive's end, before the car moves on. The verdict stands from the read on, as a real reader's does:
    // a jump in time during the 1–2 s read (a guest's pass expiring meanwhile) does not reverse it.
    let verdict = null,
      reading = null,
      stopped = null;
    const approach = async (route, options) => {
      stopped = drive(agent, route, options, gen);
      stopped.catch(() => {}); // awaited later; a reset meanwhile rejects it first
      await waitFor(() => passed(agent, route.length - 3), gen);
      verdict = sim.decide(plate, province);
      reading = readPlate('in', agent, verdict);
    };
    const onto = (lane) => {
      agent.lane = lane;
      onStreet = true;
      streetCars.add(agent);
      agent.car.visible = true;
      resolveShown();
    };
    // The car keeps its turn at the barrier until it has backed out onto the street: released before, the next car
    // drove up behind it while it still waited for a gap there, and could block its way out.
    const turnAway = async () => {
      await stopped;
      hooks.onLeaveGate?.('in');
      await eastGap(-70, -12, gen, () => !outWest && !outEast);
      exitingStreet++;
      joined = true;
      await drive(agent, gateBackOut(), {reverse: true}, gen);
      endBacking();
      releaseLane();
      await drive(agent, awayEast(), {speed: LANE_SPEED[1]}, gen);
      removeAgent(agent);
    };
    return guard(agent, async () => {
      try {
        await previousShown;
        alive();
        if (west) {
          // One at a time on the far lane, with no through-traffic behind it there (it stops to turn).
          westHold++;
          // Claimed in the same look as the check: two waiting together both found the lane free, and appeared in one
          // spot, one through the other.
          try {
            await waitFor(() => {
              if (westOnStreet || !westClear(70)) return false;
              westOnStreet++;
              westing = true;
              return true;
            }, gen);
          } finally {
            if (gen === generation) westHold--;
          }
          place(agent, {x: 95, z: STREET.laneWest, h: WEST});
          onto(-1);
          agent.signal = 'right';
          agent.signalFrom = TURN_X + SIGNAL_AHEAD; // from 30 m before its turn
          await drive(agent, westToTurn(95), {speed: 8, startMoving: true}, gen);
          takeTurn();
          await previous();
          alive();
          // The near lane has right of way: the car waits, signalling, for a gap in it (the stretch near-lane traffic
          // covers in about 5 s) and for the gate's mouth to be clear. It holds back new near-lane through-traffic
          // meanwhile, so the gap comes within seconds: in the rushes, with a car every two seconds, it waited a minute
          // or more, and the near-lane queue behind its turn with it. Exits wait while it turns.
          await eastGap(TURN_X - 34, TURN_X + 4, gen, () => {
            if (!mouthClear(agent) || outWest) return false;
            crossing++;
            turning = true;
            return true;
          });
          await approach(westTurnIn(), {speed: 4.5});
          crossing--;
          turning = false;
          westOnStreet--;
          westing = false;
          agent.signal = null;
        } else {
          // Appear with no through-traffic behind (it would run into a car queuing) and every earlier arrival ahead.
          const spawnClear = () => eastClear(-99, fromX + 30) && !laneCars(1).some((a) => a.car.position.x < fromX + 9);
          // Its place in the queue, from `x`: behind the last car ahead of it on the street (one driving up to the barrier
          // counts as at it). Counted from the cars there, not from a running total: that gave a new car the place of one
          // still in it. Only those ahead: cars that appeared behind it since do not push it back.
          const holdBehind = (x) =>
            Math.min(
              QUEUE_HEAD,
              ...laneCars(1)
                .filter((a) => a !== agent && a.car.position.x > x)
                .map((a) => (a.holdX ?? QUEUE_HEAD + QUEUE_GAP) - QUEUE_GAP),
            );
          await eastGap(-99, fromX + 30, gen);
          // Not onto a queue reaching back to where it appears.
          await waitFor(() => spawnClear() && holdBehind(fromX) > fromX + 2, gen);
          agent.holdX = holdBehind(fromX);
          place(agent, {x: fromX, z: STREET.laneEast, h: EAST});
          onto(1);
          // Into the car park: signalling from 30 m before the turn, queuing included (it flashed all the way from
          // the edge of the map).
          agent.signal = 'left';
          agent.signalFrom = GATE.entryX - ENTRY_R - SIGNAL_AHEAD;
          // Its turn at the entry is taken on getting there: a stopping distance short of its place in the queue. (Taken
          // as it appeared, 50 m out, a far-lane car already at its turn waited for it to drive up and go in first.)
          const decideX = agent.holdX - 9;
          let x = fromX;
          if (fromX < decideX) {
            await drive(agent, streetToHold(fromX, decideX), {startMoving: fromX > -90, endSpeed: () => 6.5}, gen);
            x = decideX;
          }
          takeTurn();
          if (ready() && !outWest && !outEast) {
            // The entry is free: on without stopping.
            await comeIn();
            agent.holdX = undefined;
            await approach(streetToGate(x), {startSpeed: x === fromX ? (fromX > -90 ? 6.5 : 0) : agent.speed});
          } else {
            // Its place again (the car ahead may have gone in meanwhile), then wait there for its turn.
            let holdX = (agent.holdX = Math.max(x, holdBehind(x)));
            await drive(
              agent,
              streetToHold(x, holdX),
              {startSpeed: x === fromX ? (fromX > -90 ? 6.5 : 0) : agent.speed},
              gen,
            );
            // It moves up the queue as the cars ahead do, until its turn: left where it first stopped, the tenth car
            // drove the whole 60 m from there when its turn came (each car slower to the barrier than the last).
            while (!ready()) {
              await waitFor(() => ready() || holdBehind(holdX) > holdX + 1, gen);
              if (ready()) break;
              const to = (agent.holdX = holdBehind(holdX));
              await drive(agent, streetToHold(holdX, to), {}, gen);
              holdX = to;
            }
            await previous();
            alive();
            await comeIn();
            agent.holdX = undefined;
            await approach(streetToGate(holdX));
          }
          arrived();
        }
        offStreet();
        agent.signal = agent.signalFrom = null;
        // The barrier is held only while this car is at it: from its last 3 m to the stop line until it is through.
        const passage = await withGate('in', async () => {
          alive();
          // A car allowed in has its bay from the read on (a jump in time meanwhile gave it to a car made up in it
          // too). Bound for P1, it holds back new leavers across its way from then on (`p1Waiting`).
          let stall = verdict.allow ? sim.freeStall(verdict.type) : null;
          if (stall) stall.occupant = k;
          if (stall?.zone === 'P1') waitP1();
          try {
            await reading;
            alive();
          } catch (error) {
            if (stall?.occupant === k) stall.occupant = null;
            throw error;
          }
          let manual = null;
          if (!verdict.allow) {
            armHeld++;
            try {
              await lowerIfUp(gen);
              const alert = sim.raiseAlert({plate, province, snapshot: hooks.snapshot?.('in'), color, ambient});
              await waitFor(() => alert.status !== 'open', gen);
              // Counted as backing out before the arm's hold ends (finally, below): an exit waits for it.
              if (alert.status === 'denied') {
                startBacking();
                return 'denied';
              }
              manual = {by: alert.by, reason: alert.reasonKey};
            } finally {
              if (gen === generation) armHeld--;
            }
          }
          const type = verdict.allow ? verdict.type : 'unknown';
          stall ??= sim.freeStall(type === 'unknown' ? 'staff' : type);
          if (!stall) {
            startBacking();
            hooks.onFull?.(plate);
            await lowerIfUp(gen);
            return 'full';
          }
          // The bay is the car's from now on: a jump in time while the arm rises gave it to a car made up in it too.
          stall.occupant = k;
          try {
            if (stall.zone === 'P1') {
              waitP1();
              if (outbound) await lowerIfUp(gen);
              await waitFor(() => !outbound, gen);
              p1In++;
              toP1 = true;
              p1OnLane++;
              onLane = true;
              endWaitP1();
            }
            await raiseFor(gen);
            await stopped;
            alive();
          } catch (error) {
            if (stall.occupant === k) stall.occupant = null;
            throw error;
          }
          // Given its bay (so parked, lamps off, once it stops) only now: given before the arm rose, it went dark at the barrier.
          Object.assign(agent, {type, stall, key: k});
          sim.recordEntry({plate, province, type, stallId: stall.id, color, manual});
          agents.set(k, agent);
          refreshBays();
          const going = (async () => {
            // Into the aisle: no car coming out of it, and into a P2 aisle, which the car turns into across the exit
            // lane, no car on that lane coming up to it (they met crosswise, each in the other's way, and both stopped
            // for good). Clear as it comes up to the aisle's mouth, it takes the aisle there and rolls straight on into
            // the turn; else it stops at the mouth and waits, signalling (every car stopped there, with nothing coming).
            const aisle = aisleOf(stall.aisleX),
              clear = () => aisle.out === 0 && (stall.zone === 'P1' || exitLaneClear(stall.aisleX));
            let taken = false;
            // Taken early, on the way (up to 9 m before the mouth, which for the nearest aisle is just past the barrier),
            // it also needs no car coming out of an aisle further west: that car may reach the exit lane at the mouth as
            // this one turns across it, and each stopped for the other for good. Waiting at the mouth, `clear` will do.
            const westAislesClear = () =>
              stall.zone === 'P1' || [...aisles].every(([x, a]) => x >= stall.aisleX || !a.out);
            // Rolling on, it signals the turn in as it comes up to the mouth (the turn is in its next stretch).
            const side = stall.zone === 'P1' ? 'left' : 'right';
            const rollOn = (remaining) => {
              if (!taken && remaining < 9 && clear() && westAislesClear()) {
                aisle.in++;
                taken = true;
                agent.signal = side;
              }
              return taken ? AISLE_SPEED : 0;
            };
            try {
              await drive(agent, gateToAisle(stall), {speed: 5.5, endSpeed: rollOn}, gen);
              offLane();
              const rolling = taken;
              if (!taken) {
                mouthStops.push(plate);
                if (mouthStops.length > 20) mouthStops.shift();
                agent.signal = side;
                await waitFor(clear, gen);
                aisle.in++;
                taken = true;
              }
              agent.signal = null;
              // From standstill after a wait at the mouth (it set off at the 0.5 m/s it had crawled in at).
              await drive(agent, aisleToStall(stall), {speed: AISLE_SPEED, startSpeed: rolling ? agent.speed : 0}, gen);
              agent.inBay = true;
            } finally {
              if (taken) leaveAisle(stall.aisleX, 'in', gen);
            }
          })().finally(endP1);
          going.catch(() => {}); // awaited later; if a reset cancels the drive before that, its rejection is expected
          // The next car sets off for the stop line as it sees this one drive off (0.3 m over the line: about half a
          // second after it started, a driver's reaction; at 1.5 m, over a second, it looked slow), with the driveway
          // beyond the arm clear, so that this one will not stop under the arm. It waits
          // at the line for its own turn at the barrier. (Let go during this one's plate read, it drove up while this
          // one still stood there, as if it knew the way would be clear.) Not with a car standing beyond the arm (one
          // at the exit barrier, one bound for P1 behind it): this one could stop under the arm, the next one's
          // approach (`inbound`) then held the car at the exit barrier, and each waited for the next for good. Then
          // it waits until this one is past the arm (below).
          waitFor(() => passed(agent, 0.3), gen).then(
            () => {
              if (beyondArmClear()) releaseLane();
            },
            () => {},
          );
          // The barrier is done with once the whole car is past its arm (or 6.5 m on): a car bound for the row by the
          // building then turns across the exit lane, and held the barrier while it waited for a car leaving there,
          // which waited for the barrier.
          const pastArm = () =>
            footprint(agent.car.position.x, agent.car.position.z, agent.car.rotation.y).every(([, z]) => z < GATE.z);
          await waitFor(() => pastArm() || passed(agent, 6.5), gen);
          passedUnder(gen, 400);
          hooks.onLeaveGate?.('in');
          releaseLane();
          return {going, result: manual ? 'manual' : 'allowed'};
        });
        // Denied or full: the car reverses out and drives away, without holding the barrier.
        if (typeof passage === 'string') {
          await turnAway();
          return passage;
        }
        await passage.going;
        schedule();
        return passage.result;
      } finally {
        resolveShown();
        releaseLane();
        offStreet();
        arrived();
        endP1();
        endBacking();
        agent.signal = null;
        if (gen === generation) {
          arriving.delete(k);
          if (joined) exitingStreet--;
          if (westing) westOnStreet--;
          if (turning) crossing--;
        }
      }
    });
  }

  // `west`: out to the far lane, turning right across the near lane.
  function leave(k, {west = false} = {}) {
    const agent = agents.get(k);
    // Not while it is still driving in (a jump sent a visitor home on its way to the bay: two routes moved one car).
    if (!agent || agent.leaving || !agent.stall || arriving.has(k)) return Promise.resolve(false);
    const gen = generation,
      alive = () => {
        if (gen !== generation) throw ABORT;
      };
    agent.leaving = true;
    const stall = agent.stall;
    let joined = false,
      holding = false,
      outing = false,
      driving = false;
    // Past the point of no return (`outbound`): from P1 on pulling out, from P2 at OUT_COMMIT_X.
    const commit = () => {
      outbound++;
      driving = true;
    };
    const endDrive = () => {
      if (driving) {
        driving = false;
        if (gen === generation) outbound--;
      }
    };
    const endStreet = () => {
      if (gen === generation) {
        if (joined) exitingStreet--;
        if (holding) eastHold--;
      }
      joined = holding = false;
      endWestHold();
    };
    // To the far lane: new far-lane through-traffic is held back from the moment it pulls out of its bay as well (held
    // back only once it stood at the barrier, it waited there 10 s and more in the rushes for the cars already on
    // that lane to pass: it needs some 50 m of it clear).
    let westHolding = false;
    const endWestHold = () => {
      if (westHolding) {
        westHolding = false;
        if (gen === generation) westExitHold--;
      }
    };
    const endOut = () => {
      if (outing) {
        outing = false;
        if (gen === generation) {
          if (west) outWest--;
          else outEast--;
        }
      }
    };
    return guard(agent, async () => {
      try {
        // It pulls out of its bay once its way is clear of the other cars on their way out (those waiting in their
        // bays do not count):
        // - from P2, of any further up its aisle, backing out of a bay opposite or less than two bays down (backing out
        //   in front of one, each stopped for the other for good). Cars on the exit lane it gives way to at its aisle's
        //   mouth (below);
        // - between P1 and P2, of any at all until it is through the barrier: their ways meet head-on at its stop line;
        // - of a car coming into its aisle (`in`); from P1, of a car on its way into P1 (`p1In`, `p1Waiting`).
        // Sent out one after the other, each waiting until the one ahead was through the barrier, cars left one every
        // 16 s, too slow for the evening rush in the time-lapse.
        const aisle = aisleOf(stall.aisleX);
        const inTheWay = (a) => {
          if (a === agent || !a.leaving || !a.car.visible || a.inBay || a.car.position.z >= GATE.z) return false;
          if (stall.zone === 'P1' || a.stall.zone === 'P1') return true;
          const {x, z} = a.car.position;
          // Up the aisle, or less than two bays down it: backing out together, the two cars' ends met.
          return Math.abs(x - stall.aisleX) < 6.5 && z < stall.z + 6.5;
        };
        // Claimed in the same look as the check: ten cars sent out at once all found the way clear at the same moment.
        await waitFor(() => {
          if ((stall.zone === 'P1' && (p1In || p1Waiting)) || aisle.in || [...live].some(inTheWay)) return false;
          aisle.out++;
          agent.inBay = false;
          if (stall.zone === 'P1') commit();
          return true;
        }, gen);
        // Hold back new eastbound through-traffic from the moment the car pulls out of its bay, so the street has
        // cleared by the time it reaches the barrier (it used to wait there 15–20 s for a gap).
        eastHold++;
        holding = true;
        if (west) {
          westExitHold++;
          westHolding = true;
        }
        let inAisle = true,
          toExit = null;
        const outOfAisle = () => {
          if (inAisle) {
            inAisle = false;
            leaveAisle(stall.aisleX, 'out', gen);
          }
        };
        try {
          await drive(agent, stallBackOut(stall), {reverse: true}, gen);
          let route = stall.zone === 'P1' ? p1ToExit(stall) : null,
            rolling = false;
          // No other car moving on the exit lane from 22 m short of its aisle to just past it, nor about to turn onto it
          // there from an aisle further back (counted only once on the lane, one turned onto it as this one turned out).
          const laneClear = () =>
            ![...live].some(
              (a) =>
                a !== agent &&
                a.car.visible &&
                !(a.inBay && !movers.has(a.mover)) &&
                a.car.position.z > MOUTH_Z - 4 &&
                a.car.position.z < LANE_OUT + 2.5 &&
                a.car.position.x > stall.aisleX - 22 &&
                a.car.position.x < stall.aisleX + 3,
            );
          if (stall.zone !== 'P1') {
            // At its aisle's mouth it gives way to cars on the exit lane coming up to it: clear as it comes up, it rolls
            // straight on; else it stops, short of the lane, signalling its left turn, until they have passed.
            const rollOn = (remaining) => {
              if (!rolling && remaining < 6 && laneClear()) rolling = true;
              return rolling ? 4 : 0;
            };
            await drive(agent, aisleToMouth(stall), {endSpeed: rollOn}, gen);
            if (!rolling) {
              agent.signal = 'left';
              await waitFor(laneClear, gen);
              agent.signal = null;
            }
            route = mouthToExit(stall);
          }
          // From P2, it goes on past OUT_COMMIT_X with no P1 arrival at the barrier or on its way (else it stops there).
          const hold =
            stall.zone === 'P1'
              ? null
              : {
                  s: LANE_OUT - 2 - Math.max(stall.z - 2, MOUTH_Z) + Math.PI + OUT_COMMIT_X - (stall.aisleX + 2),
                  go: () => {
                    if (p1Waiting || p1OnLane) return false;
                    commit();
                    return true;
                  },
                };
          toExit = drive(agent, route, {startSpeed: rolling ? agent.speed : 0, hold}, gen);
          toExit.catch(() => {}); // awaited below; a reset meanwhile rejects it first
          // Out of a P2 aisle once it has turned onto the exit lane: a car waiting to go in may then (it waited until
          // this one stood at the exit barrier). The exit lane past the mouth it still keeps clear (exitLaneClear).
          if (stall.zone !== 'P1') {
            await waitFor(() => passed(agent, LANE_OUT - 2 - Math.max(stall.z - 2, MOUTH_Z) + Math.PI), gen);
            outOfAisle();
          }
          // Its last 3 m to the stop line: the camera reads its plate as it rolls up (read once it stood there, each car
          // out took 1.4 s longer at the barrier).
          await waitFor(() => passed(agent, route.length - 3), gen);
        } finally {
          outOfAisle();
        }
        const {going} = await withGate('out', async () => {
          alive();
          // Signalling its turn from the stop line on, through the plate read (it lit only after the read).
          agent.signal = west ? 'right' : 'left';
          await readPlate('out', agent, {allow: true, type: agent.type, exit: true});
          // The read's pauses do not stop at a reset: without this, a car caught in it carried on into the new run and
          // left its hold on far-lane traffic (westExitHold) counted there for good.
          alive();
          // Read, it waits for a gap in the eastbound lane before lifting the barrier (still rolling up to the stop line,
          // or standing at it): the stretch a car covers in ~4 s; for a
          // car turning in from the far lane to be through the mouth; for no other car moving in front of the gate
          // (one turning in to the entry: a car turning out swings its rear into it; one just out); for no car turned
          // away backing out (`backingOut`) and no near-lane arrival on its last stretch (`inbound`: still out of
          // movingNear's reach, one came up under a left-turning car's swinging rear); and for no unknown car at the
          // entry waiting for staff with the arm down. Signalling its turn meanwhile. To the far lane it also needs a
          // gap there (about 5 s of it).
          const exitClear = () =>
            eastClear(GATE.exitX - 28, GATE.exitX + 5) &&
            !crossing &&
            !movingNear(agent) &&
            !armHeld &&
            !inbound &&
            !backingOut &&
            (!west || westClear(GATE.exitX - 7, GATE.exitX + 45));
          // Claimed in the same look as the check (an arrival's last stretch or turn-in checks these the other way).
          try {
            await waitFor(() => {
              if (!exitClear()) return false;
              if (west) outWest++;
              else outEast++;
              outing = true;
              return true;
            }, gen);
          } finally {
            endWestHold();
          }
          exitingStreet++;
          joined = true;
          await raiseFor(gen);
          await toExit;
          alive();
          sim.recordExit({plate: agent.plate, province: agent.province});
          agents.delete(k);
          departing.add(k);
          refreshBays();
          const going = drive(agent, west ? exitToFarLane() : exitToStreet(), {speed: LANE_SPEED[west ? -1 : 1]}, gen);
          going.catch(() => {}); // awaited later; if a reset cancels the drive before that, its rejection is expected
          // Across once its whole body is in the far lane (the turn ends ~13 m on).
          // Its hold on the near lane's through-traffic ends then too: it is not on that lane at all.
          // Its signal stays on until then (it went dark while the arm rose).
          if (west)
            waitFor(() => passed(agent, 15), gen).then(
              () => {
                endOut();
                endStreet();
                agent.signal = null;
              },
              () => {},
            );
          // Turning left onto the near lane: done with the turn (and its rear's swing) about 10 m on.
          else
            waitFor(() => passed(agent, 12), gen).then(
              () => {
                endOut();
                agent.signal = null;
              },
              () => {},
            );
          await waitFor(() => passed(agent, 6), gen);
          // Out of the way into P1 too (standing at the stop line, it was across it).
          endDrive();
          passedUnder(gen, 300);
          hooks.onLeaveGate?.('out');
          // Wrapped: returning the promise itself from this async function would make the barrier wait until the
          // car had driven off the map (the arm stayed up ~15 s after every exit).
          return {going};
        });
        await going;
        removeAgent(agent);
        return true;
      } finally {
        endOut();
        endDrive();
        if (gen === generation) departing.delete(k);
        endStreet();
      }
    });
  }

  // Cosmetic through-traffic on the street.
  function passBy(preferDir = rng() < 0.5 ? 1 : -1) {
    const now = demoNow();
    // Spacing is in simulation time, so the `speed` option keeps the same traffic density the visitors see.
    const ok = (dir) =>
      now - lastSpawn[dir] > 4200 &&
      (dir < 0
        ? !westOnStreet && !westHold && !westExitHold
        : !laneCars(1).length && !exitingStreet && !eastHold && eastClear(-99, -84));
    const dir = ok(preferDir) ? preferDir : ok(-preferDir) ? -preferDir : 0;
    if (!dir) return false;
    lastSpawn[dir] = now;
    const agent = makeAgent({plate: '', province: '', type: 'unknown', color: Math.floor(rng() * 9)});
    agent.dir = dir;
    // Placed at once: unplaced, it stood at the origin, and the lanes' clear-behind checks did not see it coming.
    const route = passing(dir);
    place(agent, route.pts[0]);
    ambientCars.add(agent);
    drive(agent, route, {speed: LANE_SPEED[dir], startMoving: true})
      .catch(() => {})
      .finally(() => {
        removeAgent(agent);
        ambientCars.delete(agent);
      });
    return true;
  }

  // On the street, a car keeps its distance to the car ahead in its lane, braking in time to stop 1.6 m behind it:
  // whatever the flows decide, no car drives into another there.
  const laneOf = (c) =>
    Math.abs(c.position.z - STREET.laneEast) < 0.6 ? 1 : Math.abs(c.position.z - STREET.laneWest) < 0.6 ? -1 : 0;
  function followCap(m) {
    const c = m.agent.car,
      lane = laneOf(c),
      dir = Math.sin(c.rotation.y);
    if (m.reverse || !lane || Math.abs(dir) < 0.9) return Infinity;
    let gap = Infinity;
    for (const a of live) {
      const o = a.car;
      if (a === m.agent || !o.visible || laneOf(o) !== lane) continue;
      const dx = (o.position.x - c.position.x) * Math.sign(dir);
      if (dx > 0 && dx < gap) gap = dx;
    }
    return gap === Infinity ? Infinity : Math.sqrt(2 * m.accel * Math.max(0, gap - 6));
  }
  // Anywhere: a car brakes for any other car (not one parked in its bay) on its own path ahead, the stretch it needs
  // to stop plus a little, and stops short of it. Footprints are the cars' rectangles (separating-axis test).
  // The car's body is 4.46 × 1.72 m over its rounded edges (cars.js): other cars count as 4.4 × 1.72, the braking car's
  // path as 4.48 × 1.76, so two never come closer than the bodies' own size.
  const footprint = (x, z, h, half = [2.2, 0.86]) => {
    const f = [Math.sin(h), Math.cos(h)],
      sd = [Math.cos(h), -Math.sin(h)];
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([a, b]) => [x + f[0] * half[0] * a + sd[0] * half[1] * b, z + f[1] * half[0] * a + sd[1] * half[1] * b]);
  };
  function overlap(A, B) {
    for (const P of [A, B])
      for (let i = 0; i < 4; i++) {
        const p = P[i],
          q = P[(i + 1) % 4],
          n = [q[1] - p[1], p[0] - q[0]];
        let a0 = Infinity,
          a1 = -Infinity,
          b0 = Infinity,
          b1 = -Infinity;
        for (const v of A) {
          const d = v[0] * n[0] + v[1] * n[1];
          a0 = Math.min(a0, d);
          a1 = Math.max(a1, d);
        }
        for (const v of B) {
          const d = v[0] * n[0] + v[1] * n[1];
          b0 = Math.min(b0, d);
          b1 = Math.max(b1, d);
        }
        if (a1 < b0 || b1 < a0) return false;
      }
    return true;
  }
  function pathCap(m) {
    const c = m.agent.car,
      reach = Math.min(m.route.length - m.s, (m.vmax * m.vmax) / (2 * m.accel) + 1.5);
    if (reach <= 0.05) return Infinity;
    // Not a car standing in its bay (parked, or leaving but not yet backing out): routes into bays pass close by them.
    // Nor one behind: braking for it does not help, that car stops for this one (two cars already touching stopped
    // each other for good).
    const way = sample(m.route, m.s).h,
      ahead = (o) => (o.x - c.position.x) * Math.sin(way) + (o.z - c.position.z) * Math.cos(way) > 0;
    const near = [...live]
      .filter(
        (a) =>
          a !== m.agent &&
          a.car.visible &&
          !(a.inBay && !movers.has(a.mover)) &&
          ahead(a.car.position) &&
          Math.hypot(a.car.position.x - c.position.x, a.car.position.z - c.position.z) < reach + 5,
      )
      .map((a) => footprint(a.car.position.x, a.car.position.z, a.car.rotation.y));
    if (!near.length) return Infinity;
    for (let d = 0.4; d <= reach; d += 0.4) {
      const p = sample(m.route, m.s + d),
        A = footprint(p.x, p.z, p.h, [2.24, 0.88]);
      if (near.some((B) => overlap(A, B))) return Math.sqrt(2 * m.accel * Math.max(0, d - 0.6));
    }
    return Infinity;
  }
  // A drive's `hold`: from the distance the car needs to stop there at its speed (plus a little), asked each tick until
  // it goes (asked from the distance at full speed, a slower car committed some 5 m earlier than it had to).
  function holdCap(m) {
    const h = m.hold;
    if (!h || h.passed) return Infinity;
    const left = h.s - m.s;
    if (left < (m.v * m.v) / (2 * m.accel) + 1 && h.go()) {
      h.passed = true;
      return Infinity;
    }
    return Math.sqrt(2 * m.accel * Math.max(0, left));
  }
  // Blinkers: a car on the move flashes the side of the turn coming up on its route (within 14 m); one about to turn
  // (on the street within SIGNAL_AHEAD of it, `signalFrom` on its lane; waiting at the exit barrier or an aisle's
  // mouth) flashes its `signal`. On demo time, so they hold while paused.
  const signalling = (a) =>
    a.signal && (a.signalFrom == null || (a.car.position.x - a.signalFrom) * Math.sin(a.car.rotation.y) >= 0)
      ? a.signal
      : null;
  function turnAhead(m) {
    if (m.reverse) return null;
    const here = sample(m.route, m.s).h;
    for (let d = 2; d <= 14 && m.s + d <= m.route.length; d += 2) {
      let dh = sample(m.route, m.s + d).h - here;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (Math.abs(dh) > 0.35) return dh > 0 ? 'left' : 'right';
    }
    return null;
  }
  // Returns whether any car is signalling (the frame loop keeps going to flash it) and whether a lamp changed (only
  // then is there something new to draw: a car waiting with its blinker on redrew the scene every frame).
  function updateBlinkers() {
    const lit = Math.floor(demoNow() / 380) % 2 === 0;
    let any = false,
      changed = false;
    for (const a of live) {
      const side = (movers.has(a.mover) && turnAhead(a.mover)) || signalling(a);
      if (side) any = true;
      if (side !== a.blink || (side && lit !== a.blinkLit)) {
        a.blink = side;
        a.blinkLit = lit;
        setCarBlinker(a.car, side, lit);
        changed = true;
      }
    }
    return {any, changed};
  }
  // Movement: a system on the engine's tick (every 50 ms of simulation time), so cars move the same whatever the
  // frame rate or the `speed` option, and tests can drive them without a browser.
  const offTick = onTick((dt) => {
    let active = lot.update(dt);
    const caps = new Map([...movers].map((m) => [m, Math.min(followCap(m), pathCap(m), holdCap(m))]));
    for (const m of [...movers]) {
      const remaining = m.route.length - m.s;
      const end = m.endSpeed?.(remaining) || 0,
        brake = Math.sqrt(end * end + 2 * m.accel * Math.max(0, remaining));
      m.v = Math.min(m.vmax, m.v + m.accel * dt, Math.max(0.5, brake), caps.get(m) ?? Infinity);
      m.s = Math.min(m.route.length, m.s + m.v * dt);
      if (m.s >= m.route.length - 1e-3) {
        movers.delete(m);
        m.agent.speed = m.v;
        place(m.agent, sample(m.route, m.s), m.reverse);
        m.resolve();
      }
      active = true;
    }
    for (const m of movers) place(m.agent, sample(m.route, m.s), m.reverse);
    const lamps = night && updateLamps(),
      blinkers = updateBlinkers();
    // A hidden car park (a view of an upper floor) has nothing to redraw: the cars still move, unseen.
    if (lot.root.visible && (active || lamps || blinkers.changed)) schedule();
  });

  return {
    syncParked,
    arrive,
    leave,
    passBy,
    setNight,
    dispose: offTick,
    // A manual open with no car read: one pulse, held briefly, then closed.
    pulse(holdMs = 5000) {
      const gen = generation;
      return (async () => {
        await raiseFor(gen);
        await wait(holdMs, gen);
        passedUnder(gen, 0);
      })().catch(() => {});
    },
    // Parked: in its bay (one still driving in from the barrier is not, and cannot be sent out yet).
    parkedKeys: () =>
      [...agents.entries()].filter(([k, a]) => !a.leaving && a.stall && !arriving.has(k)).map(([k]) => k),
    get busy() {
      return movers.size > ambientCars.size;
    },
    get queued() {
      return entryPending;
    },
    get leaving() {
      let n = 0;
      for (const a of agents.values()) if (a.leaving) n++;
      return n;
    },
    appear,
    vanish,
    get gateHolders() {
      return gateHolders;
    },
    // On its way in, or out through the exit and still driving off: not to be sent in again yet (two cars with one plate
    // were on screen).
    isAround: (k) => arriving.has(k) || departing.has(k),
    // For tests and probes: the flows' shared state.
    inspect: () => ({
      aisles: Object.fromEntries(aisles),
      crossing,
      westOnStreet,
      westHold,
      exitingStreet,
      eastHold,
      gateHolders,
      under,
      armHeld,
      entryPending,
      outWest,
      outEast,
      backingOut,
      westExitHold,
      inbound,
      outbound,
      p1Waiting,
      p1OnLane,
      p1In,
      mouthStops: [...mouthStops],
    }),
  };
}
