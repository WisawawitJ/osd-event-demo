// Demo time scale. `?speed=N` (tests and rehearsals) runs the simulated clock, car motion, story waits
// and camera flights N times faster; without it everything runs at real speed.
const params = new URLSearchParams(location.search);
const requested = Number(params.get('speed'));
export const SPEED = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30) : 1;

// Pause: the timeline's pause button stops everything that runs by itself (the world clock, cars and the barrier,
// the story, scenarios, the tour and the idle orbit); the visitor can still move the camera. Demo time is real
// time minus the paused spans: whatever waits or moves reads it (demoNow), or waits with later/sleep.
let pausedAt = null, pausedFor = 0;
export const demoNow = () => (pausedAt ?? performance.now()) - pausedFor;
export const isPaused = () => pausedAt !== null;
// Runs `fn` after `ms` of demo time (scaled by ?speed, stopped while paused). Cancel with cancelLater.
export function later(fn, ms) {
  const handle = {id: 0, due: demoNow() + ms / SPEED};
  const check = () => {
    const left = handle.due - demoNow();
    if (isPaused() || left > 1) { handle.id = setTimeout(check, isPaused() ? 100 : left); return; }
    handle.id = 0; fn();
  };
  handle.id = setTimeout(check, ms / SPEED);
  return handle;
}
export const cancelLater = handle => { if (handle) clearTimeout(handle.id); };
export const sleep = ms => new Promise(resolve => later(resolve, ms));

// World clock: one simulated day on the event date (24 Nov 2026, Bangkok time) that runs by itself and loops.
// Everything reads it: the sky, the building's rooms and solar, and the car park's traffic and logs.
// - A day takes `?day=N` real minutes (default 20; the timeline's button picks 10, 20, 40 or 60); the night
//   (21:00–05:00) goes 1.5× faster than the daytime. Pausing (above) stops it with everything else.
// - `?day=0` turns the time-lapse off: the clock then runs at real speed, as one scene would (tests use this).
// - `?time=HH:MM` sets the start (default 09:00).
// Cars, flights and the story keep real speed: only the clock is sped up. While the parking story plays, it holds
// the clock at real speed too, so its steps keep their own times.
const DAY_MS = 864e5, DAY0 = Date.UTC(2026, 10, 24, -7); // 24 Nov 2026 00:00 in Bangkok
export const minuteOf = ms => (((ms - DAY0) % DAY_MS) + DAY_MS) % DAY_MS / 60000;
const isNightMinute = m => m >= 21 * 60 || m < 5 * 60;
const dayParam = params.get('day');
const DAY_REAL = dayParam === null || !Number.isFinite(Number(dayParam)) ? 20 : Math.max(0, Number(dayParam));
// Minutes of world time per real minute in the daytime for a day of `minutes`; the night's 8 hours take 1/1.5 of their share.
const lapseFor = minutes => (minutes > 0 ? (16 * 60 + 8 * 60 / 1.5) / minutes : 0);
const startParam = /^(\d{1,2}):(\d{2})$/.exec(params.get('time') || '');
const START = DAY0 + (startParam ? (Number(startParam[1]) % 24) * 60 + Math.min(59, Number(startParam[2])) : 9 * 60) * 60000;
// The day wraps at 03:00, when the car park is at its emptiest: 03:00 on the 25th becomes 03:00 on the 24th.
const WRAP = DAY0 + DAY_MS + 3 * 3600e3;

function createWorldClock() {
  const listeners = new Set();
  let time = START, last = performance.now(), holds = 0, dayLength = DAY_REAL, paused = false;
  const emit = (kind, payload) => { for (const fn of [...listeners]) fn(kind, payload); };
  const rate = () => { const lapse = lapseFor(dayLength); return paused ? 0 : holds ? SPEED : SPEED * (!lapse ? 1 : lapse * (isNightMinute(minuteOf(time)) ? 1.5 : 1)); };
  function advance() {
    const t = performance.now(), dt = t - last;
    last = t;
    if (dt > 0) time += dt * rate();
    if (time >= WRAP) { time -= DAY_MS; emit('wrap', -DAY_MS); }
  }
  setInterval(() => { advance(); emit('tick'); }, 250);
  return {
    // Real minutes a day takes (0: real speed, as with `?day=0`), and whether the clock is paused.
    get dayLength() { return dayLength; },
    setDayLength(minutes) { advance(); dayLength = minutes; emit('rate'); },
    get paused() { return paused; },
    // Pauses (or resumes) everything, not only the clock: see isPaused.
    setPaused(value) {
      advance(); paused = Boolean(value);
      if (paused && pausedAt === null) pausedAt = performance.now();
      if (!paused && pausedAt !== null) { pausedFor += performance.now() - pausedAt; pausedAt = null; }
      emit('rate');
    },
    now() { advance(); return Math.round(time); },
    minute() { advance(); return minuteOf(time); },
    // Sets the time outright (a reset or a story step). Listeners get the old and new time.
    set(ms) { advance(); const from = time; time = ms >= WRAP ? ms - DAY_MS : ms; emit('set', {from, to: time}); },
    // Moves forward to the next time of day `minute` (a jump never goes back: what happened stays in the past).
    // A jump past 03:00 wraps the day first, so listeners get the old and new time on the same (wrapped) day and
    // whatever they log for the skipped hours lands before the new time.
    jumpTo(minute) {
      advance();
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
    hold() { advance(); holds++; let held = true; return () => { if (held) { held = false; advance(); holds--; } }; },
    get held() { return holds > 0; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export const world = createWorldClock();
