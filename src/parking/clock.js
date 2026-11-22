// The simulation engine: one clock for everything that runs by itself (the world clock, the car park's records and
// background life, cars and the barrier, the parking story, tour timers). Like a game engine's fixed step:
// - Simulation time is a number of milliseconds that moves only when the engine is stepped, in ticks of at most
//   TICK. Each tick fires the timers due in it, in order, then runs every per-tick system (cars moving, the world
//   clock).
// - In the browser a driver steps it each animation frame by the real time elapsed × SPEED (a frame's slice, so
//   motion stays smooth at 60 fps); pausing stops the stepping, so everything stops together. In Node (tests)
//   nothing steps it but the test, in whole ticks: runs are instant, and the same seed and inputs give the same
//   result every time.
// - Randomness comes from a seeded generator (rng), so a run can be repeated (the `seed` option in the browser).
// Between ticks the engine lets promise chains settle, so `await` code (the cars' and the story's steps) moves on
// in step with the ticks.

import {options} from './options.js';

// `speed` (tests): simulation time runs N times faster than real time (camera flights too).
const requested = Number(options.speed);
export const SPEED = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30) : 1;
export const TICK = 50; // ms of simulation time per step

// --- Seeded randomness -------------------------------------------------------------------------------------------
// mulberry32: small, fast and good enough for a demo's dice. A generator of its own for a fixed seed (the records'
// sample data), or the engine's `rng`, seeded once per run (`seed`).
export function mulberry32(state) {
  state |= 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let dice = mulberry32(0);
export const rng = () => dice();
export function seed(n) { dice = mulberry32(n); }
seed(Number(options.seed) || Math.floor(Math.random() * 2 ** 31));

// --- Simulation time and timers --------------------------------------------------------------------------------
let simNow = 0, order = 0;
const timers = []; // a binary heap by (due, order)
const before = (a, b) => a.due < b.due || (a.due === b.due && a.order < b.order);
function push(t) {
  timers.push(t);
  for (let i = timers.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!before(timers[i], timers[p])) break; [timers[i], timers[p]] = [timers[p], timers[i]]; i = p; }
}
function pop() {
  const top = timers[0], last = timers.pop();
  if (timers.length) {
    timers[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < timers.length && before(timers[l], timers[m])) m = l;
      if (r < timers.length && before(timers[r], timers[m])) m = r;
      if (m === i) break;
      [timers[i], timers[m]] = [timers[m], timers[i]]; i = m;
    }
  }
  return top;
}
// Simulation time, in ms. (`demoNow` kept as the name everything already reads.)
export const demoNow = () => simNow;
// Real milliseconds that stop while paused: for presentation animations that keep their real pace under the `speed` option
// (the meeting room's airflow, door swings, a scenario's timing).
export const realNow = () => simNow / SPEED;
// A level (a light's brightness, an effect's fade) that runs toward its target at 1 per `ms` of realNow from where it
// stood when the target was set: a function of the clock, so it reads the same however many frames are drawn on the
// way (stepped a frame at a time, with each step capped, a fade went further or less far depending on the frame rate).
export function ramp(ms, initial = 1) {
  let from = initial, to = initial, at = 0;
  const value = (now = realNow()) => { const d = Math.max(0, now - at) / ms; return to > from ? Math.min(to, from + d) : Math.max(to, from - d); };
  return {
    value,
    // Toward `target` from now (or from `now`, a moment already past, as when a fade out ended).
    set(target, now = realNow()) { if (target === to && value(now) === to) return; from = value(now); to = target; at = now; },
    // At once.
    jump(level) { from = to = level; },
    get target() { return to; },
    done: (now = realNow()) => value(now) === to,
    // When it got (or gets) to its target.
    get endsAt() { return at + Math.abs(to - from) * ms; },
  };
}
// Runs `fn` after `ms` of simulation time. Cancel with cancelLater.
export function later(fn, ms) { const t = {due: simNow + Math.max(0, ms || 0), order: order++, fn, live: true}; push(t); return t; }
export const cancelLater = t => { if (t) t.live = false; };
export const sleep = ms => new Promise(resolve => later(resolve, ms));
// A system that runs every tick, given the tick's length in seconds. Returns its removal.
const systems = new Set();
export const onTick = fn => { systems.add(fn); return () => systems.delete(fn); };

// One tick of `ms`: due timers in order (each sees the time it was due), then every system. After each timer, the
// `await`s it resolved carry on before the next timer fires, as when each was its own browser task: code that waits
// for a condition and then claims it at once (one car on the far lane at a time) relies on that. (Run back to back,
// two cars waiting for the far lane both saw it free and appeared on the same spot.)
const microtasks = async () => { for (let i = 0; i < 12; i++) await null; };
async function tickOnce(ms) {
  const end = simNow + ms;
  while (timers.length && timers[0].due <= end) {
    const t = pop();
    if (!t.live) continue;
    simNow = Math.max(simNow, t.due);
    t.fn();
    await microtasks();
  }
  simNow = end;
  for (const fn of [...systems]) fn(ms / 1000);
}
// Advances simulation time by `ms`, in ticks of at most TICK, letting promise chains settle after each. Steps already
// running take the extra time on instead of starting a second loop.
// While paused nothing is owed and a run under way stops at its next tick (it ran on through Pause).
let owed = 0, stepping = null, halted = false;
export function advance(ms) {
  if (halted) return stepping ?? Promise.resolve();
  owed += ms;
  // Started only with time owed: with none (two frames at one timestamp, a step of 0), the loop ended at once, its
  // `finally` cleared `stepping` before the assignment set it, and the clock stood still for good.
  if (!stepping && owed > 1e-6) stepping = (async () => {
    try { while (owed > 1e-6 && !halted) { const d = Math.min(owed, TICK); owed -= d; await tickOnce(d); await defaultSettle(); } } finally { stepping = null; }
  })();
  return stepping ?? Promise.resolve();
}
function halt(on) { halted = on; if (on) owed = 0; }
// Node: a macrotask boundary (every microtask has run); the browser: a message-channel task (as fast, no 4 ms clamp).
const defaultSettle = typeof setImmediate === 'function' ? () => new Promise(r => setImmediate(r))
  : (() => { const ch = new MessageChannel(), queue = []; ch.port1.onmessage = () => queue.shift()?.(); return () => new Promise(r => { queue.push(r); ch.port2.postMessage(0); }); })();
// Tests: runs simulation time on until `cond()` holds (checked every tick) or `ms` have passed; true if it held.
export async function runUntil(cond, ms = 600000) {
  const end = simNow + ms;
  while (!cond()) { if (simNow >= end) return false; await advance(TICK); }
  return true;
}

// --- World clock -----------------------------------------------------------------------------------------------
// One simulated day on the event date (24 Nov 2026, Bangkok time) that runs by itself and loops.
// Everything reads it: the sky, the building's rooms and solar, and the car park's traffic and logs.
// - A day takes `day` (an option, for tests) real minutes (default 20; the timeline's button picks 10, 20, 40 or 60); the night
//   (21:00–05:00) goes 1.5× faster than the daytime. Pausing stops it with everything else.
// - `day: 0` turns the time-lapse off: the clock then runs at real speed, as one scene would (tests use this).
// - `time: 'HH:MM'` sets the start (default 09:00).
// Cars, flights and the story keep real speed: only the clock is sped up. While the parking story plays, it holds
// the clock at real speed too, so its steps keep their own times.
const DAY_MS = 864e5, DAY0 = Date.UTC(2026, 10, 24, -7); // 24 Nov 2026 00:00 in Bangkok
export const minuteOf = ms => (((ms - DAY0) % DAY_MS) + DAY_MS) % DAY_MS / 60000;
const isNightMinute = m => m >= 21 * 60 || m < 5 * 60;
const dayParam = options.day ?? null;
const DAY_REAL = dayParam === null || !Number.isFinite(Number(dayParam)) ? 20 : Math.max(0, Number(dayParam));
// Minutes of world time per real minute in the daytime for a day of `minutes`; the night's 8 hours take 1/1.5 of their share.
const lapseFor = minutes => (minutes > 0 ? (16 * 60 + 8 * 60 / 1.5) / minutes : 0);
const startParam = /^(\d{1,2}):(\d{2})$/.exec(options.time || '');
const START = DAY0 + (startParam ? (Number(startParam[1]) % 24) * 60 + Math.min(59, Number(startParam[2])) : 9 * 60) * 60000;
// The day wraps at 03:00, when the car park is at its emptiest: 03:00 on the 25th becomes 03:00 on the 24th.
const WRAP = DAY0 + DAY_MS + 3 * 3600e3;

function createWorldClock() {
  const listeners = new Set();
  let time = START, holds = 0, dayLength = DAY_REAL, paused = false;
  const emit = (kind, payload) => { for (const fn of [...listeners]) fn(kind, payload); };
  // World ms per simulation ms: the time-lapse (faster at night), or 1 while held or with the lapse off.
  const rate = () => { const lapse = lapseFor(dayLength); return holds || !lapse ? 1 : lapse * (isNightMinute(minuteOf(time)) ? 1.5 : 1); };
  onTick(dt => {
    time += dt * 1000 * rate();
    if (time >= WRAP) { time -= DAY_MS; emit('wrap', -DAY_MS); }
  });
  return {
    // Real minutes a day takes (0: real speed, as with `day: 0`), and whether the clock is paused.
    get dayLength() { return dayLength; },
    // World ms per simulation ms now.
    get rate() { return rate(); },
    setDayLength(minutes) { dayLength = minutes; emit('rate'); },
    get paused() { return paused; },
    // Pauses (or resumes) everything, not only the clock: the engine stops stepping (see the driver below).
    setPaused(value) { paused = Boolean(value); halt(paused); emit('rate'); },
    now() { return Math.round(time); },
    minute() { return minuteOf(time); },
    // Sets the time outright (a reset or a story step). Listeners get the old and new time.
    set(ms) { const from = time; time = ms >= WRAP ? ms - DAY_MS : ms; emit('set', {from, to: time}); },
    // Moves forward to the next time of day `minute` (a jump never goes back: what happened stays in the past).
    // A jump past 03:00 wraps the day first, so listeners get the old and new time on the same (wrapped) day and
    // whatever they log for the skipped hours lands before the new time.
    jumpTo(minute) {
      // The minute it is already (at 15:00:20, the 15:00 moment) is now, not a day ahead; the next one is a few seconds on.
      const current = minuteOf(time), target = ((minute % 1440) + 1440) % 1440;
      if (Math.floor(current) === Math.floor(target)) return;
      const ahead = (((target - current) % 1440) + 1440) % 1440;
      let from = time;
      if (time + ahead * 60000 >= WRAP) { time -= DAY_MS; from -= DAY_MS; emit('wrap', -DAY_MS); }
      time = from + ahead * 60000;
      emit('jump', {from, to: time});
    },
    // Real speed until the returned function is called (the story holds the clock while it plays).
    hold() { holds++; let held = true; return () => { if (held) { held = false; holds--; } }; },
    get held() { return holds > 0; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // For the driver: tells listeners the time moved on (they repaint at most a few times a second, not every tick).
    tick() { emit('tick'); },
  };
}
export const world = createWorldClock();
export const isPaused = () => world.paused;

// --- The browser's driver ----------------------------------------------------------------------------------------
// Each animation frame steps the engine by the real time since the last (× SPEED), unless paused. A stall longer
// than half a second (a background tab, the debugger) is dropped rather than caught up. The world clock's 'tick'
// goes out about four times a second of real time.
// The `manual` option (screenshots): the driver steps nothing; only the page's debug hook does (main.js,
// window.__engine), so a state is reached at the same simulation time on every run and in every version.
const manual = 'manual' in options;
if (typeof requestAnimationFrame === 'function') {
  let last = null, lastTick = 0;
  const frame = time => {
    // Behind (a busy page): at most one frame's worth is owed; the rest is dropped, so the simulation slows down
    // rather than running on in a backlog.
    if (!manual && last !== null && !world.paused && owed < 500 * SPEED) advance(Math.min(500, Math.max(0, time - last)) * SPEED);
    last = time;
    // (Stepped pages tick from the stepping hook: ticked on real time, a room's schedule switched its lights at a
    // different moment of the stepped run each time.)
    if (!manual && time - lastTick >= 250) { lastTick = time; world.tick(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
