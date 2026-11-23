// The barrier's pace: a car in every 6.5 s from a queue (gate.test.mjs), and the rushes of a 20-minute day bring one
// every 7 s, so there is little room to slow it. Shared by the 3D car park (lot3d.js), the parking world (world.js) and
// the Node tests' stand-ins.
import {sleep} from 'osd/core/clock.js';

// The arm: eased in and out, a quarter turn in BOOM_SECONDS (at one speed throughout, and faster, it snapped up).
const BOOM_SECONDS = 1.3,
  UP = (Math.PI / 2) * 0.96;
export function createBoom() {
  // 0 down … 1 up.
  let at = 0,
    target = 0;
  return {
    set(open) {
      target = open ? 1 : 0;
    },
    get moving() {
      return at !== target;
    },
    get angle() {
      return at * at * (3 - 2 * at) * UP;
    },
    // Returns whether it moved.
    update(dt) {
      if (at === target) return false;
      const step = dt / BOOM_SECONDS;
      at = target > at ? Math.min(target, at + step) : Math.max(target, at - step);
      return true;
    },
  };
}

// A plate read: the camera reads, the verdict shows (`read`), and a moment later the barrier acts on it (`recognised`),
// so the arm is seen to answer the read (rising at once, it seemed to open by itself). The card stays a little longer.
export async function plateRead({read, recognised}) {
  await sleep(1000);
  read?.();
  await sleep(300);
  recognised();
  await sleep(200);
}
