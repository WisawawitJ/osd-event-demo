// Demo time scale. `?speed=N` (tests and rehearsals) runs the simulated clock, car motion, story waits
// and camera flights N times faster; without it everything runs at real speed.
const params = new URLSearchParams(location.search);
const requested = Number(params.get('speed'));
export const SPEED = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30) : 1;
export const later = (fn, ms) => setTimeout(fn, ms / SPEED);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / SPEED));

// World clock: one simulated day on the event date (24 Nov 2026, Bangkok time) that runs by itself and loops.
// Everything reads it: the sky, the building's rooms and solar, and the car park's traffic and logs.
// - A day takes `?day=N` real minutes (default 10); the night (21:00–05:00) goes 1.5× faster than the daytime.
// - `?day=0` turns the time-lapse off: the clock then runs at real speed, as one scene would (tests use this).
// - `?time=HH:MM` sets the start (default 09:00).
// Cars, flights and the story keep real speed: only the clock is sped up. While the parking story plays, it holds
// the clock at real speed too, so its steps keep their own times.
const DAY_MS = 864e5, DAY0 = Date.UTC(2026, 10, 24, -7); // 24 Nov 2026 00:00 in Bangkok
export const minuteOf = ms => (((ms - DAY0) % DAY_MS) + DAY_MS) % DAY_MS / 60000;
export const isNightMinute = m => m >= 21 * 60 || m < 5 * 60;
const dayParam = params.get('day');
const DAY_REAL = dayParam === null || !Number.isFinite(Number(dayParam)) ? 10 : Math.max(0, Number(dayParam));
// Minutes of world time per real minute in the daytime; the night's 8 hours take 1/1.5 of their share.
const LAPSE = DAY_REAL > 0 ? (16 * 60 + 8 * 60 / 1.5) / DAY_REAL : 0;
const startParam = /^(\d{1,2}):(\d{2})$/.exec(params.get('time') || '');
const START = DAY0 + (startParam ? (Number(startParam[1]) % 24) * 60 + Math.min(59, Number(startParam[2])) : 9 * 60) * 60000;
// The day wraps at 03:00, when the car park is at its emptiest: 03:00 on the 25th becomes 03:00 on the 24th.
const WRAP = DAY0 + DAY_MS + 3 * 3600e3;

function createWorldClock() {
  const listeners = new Set();
  let time = START, last = performance.now(), holds = 0;
  const emit = (kind, payload) => { for (const fn of [...listeners]) fn(kind, payload); };
  const rate = () => SPEED * (!LAPSE || holds ? 1 : LAPSE * (isNightMinute(minuteOf(time)) ? 1.5 : 1));
  function advance() {
    const t = performance.now(), dt = t - last;
    last = t;
    if (dt > 0) time += dt * rate();
    if (time >= WRAP) { time -= DAY_MS; emit('wrap', -DAY_MS); }
  }
  setInterval(() => { advance(); emit('tick'); }, 250);
  return {
    // True when the day runs as a time-lapse (the default); false with `?day=0`.
    lapse: LAPSE > 0,
    now() { advance(); return Math.round(time); },
    minute() { advance(); return minuteOf(time); },
    get night() { return isNightMinute(this.minute()); },
    // Sets the time outright (a reset or a story step). Listeners get the old and new time.
    set(ms) { advance(); const from = time; time = ms >= WRAP ? ms - DAY_MS : ms; emit('set', {from, to: time}); },
    // Moves forward to the next time of day `minute` (a jump never goes back: what happened stays in the past).
    // A jump past 03:00 wraps the day first, so listeners get the old and new time on the same (wrapped) day and
    // whatever they log for the skipped hours lands before the new time.
    jumpTo(minute) {
      advance();
      const ahead = (((minute - minuteOf(time)) % 1440) + 1440) % 1440;
      if (ahead < 1) return;
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
export const START_TIME = START;
