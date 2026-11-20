// Demo time scale. `?speed=N` (tests and rehearsals) runs the simulated clock, car motion, story waits
// and camera flights N times faster; without it everything runs at real speed.
const requested = Number(new URLSearchParams(location.search).get('speed'));
export const SPEED = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30) : 1;
export const later = (fn, ms) => setTimeout(fn, ms / SPEED);
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms / SPEED));
