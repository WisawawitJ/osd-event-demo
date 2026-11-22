// Readings set by hand (a scenario, the pond switch) against the building's schedule, without a page.
// A reading changed by hand keeps its value until the schedule changes that reading itself (the pond's level, a room
// becoming occupied), as a switch flipped by hand does. Readings the schedule moves all the time (temperature,
// solar) are kept for HOLD_MINUTES of world time instead. Sunset ends a sun-returning override (it kept 8.4 kW of
// output into the evening). The day's wrap at 03:00 keeps a held reading's time left.
import {daySnapshot} from 'osd/viewer/building-day.js';
import {world} from 'osd/parking/clock.js';

export const HOLD_MINUTES = 60;
const STEADY = new Set(['pondAlert', 'water', 'occupied']);

export function createReadings(rooms) {
  const held = new Map(); // reading → {base: the schedule's value when set by hand} or {until: world time}
  const offClock = world.subscribe((kind, payload) => {
    if (kind === 'wrap') for (const h of held.values()) if ('until' in h) h.until += payload;
  });
  return {
    hold(keys) {
      const now = world.now(),
        planned = daySnapshot(world.minute(), rooms).telemetry;
      for (const key of keys)
        held.set(key, STEADY.has(key) ? {base: planned[key]} : {until: now + HOLD_MINUTES * 60000});
    },
    // The schedule's readings for now, less those still held by hand (holds that have run out are dropped).
    scheduled(snapshot = daySnapshot(world.minute(), rooms)) {
      const now = world.now(),
        telemetry = {...snapshot.telemetry},
        dark = snapshot.telemetry.solar === 0;
      for (const [key, h] of held) {
        if (
          !(dark && (key === 'solar' || key === 'load')) &&
          ('until' in h ? now < h.until : telemetry[key] === h.base)
        )
          delete telemetry[key];
        else held.delete(key);
      }
      return telemetry;
    },
    held: (key) => held.has(key),
    clear() {
      held.clear();
    },
    dispose() {
      offClock();
    },
  };
}
