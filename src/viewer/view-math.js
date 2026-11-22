// The camera's rules as plain maths (positions as {x, y, z}), so tests check them without a page or WebGL; main.js
// applies them to the three.js camera and OrbitControls.
// The world (measured across the ground from the site's middle) is clear to WORLD_CLEAR metres out and gone in the fog
// by WORLD_GONE; panning is free while the view's pivot stays within PAN_FREE and slows to a stop at PAN_LIMIT. The
// pivot stays between the ground and PAN_TOP (the roof is about 20 m up); the camera keeps CAMERA_FLOOR metres up.
export const WORLD_CLEAR = 65,
  WORLD_GONE = 95,
  PAN_FREE = 55,
  PAN_LIMIT = 90,
  PAN_TOP = 35,
  CAMERA_FLOOR = 0.8;
// Orbiting stops just above the horizon.
export const MAX_POLAR = Math.PI * 0.49;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Camera up / down (▲ ▼, Page Up / Page Down): how far the camera alone rises (+) or drops (−), still looking at the
// same point. A step is a third of the height above that point (at least a metre); ▼ undoes ▲ (× 4/3 up, × 3/4 down).
// Clamped to the view's limits, so a press at one does nothing (OrbitControls put the camera back along another line:
// ▲ at the zoom-out limit swung it overhead, and ▼ there backed it away or dropped it into the building).
export function heightStep(
  {camera, target, minDistance, maxDistance, maxPolarAngle = MAX_POLAR, floor = CAMERA_FLOOR},
  sign,
) {
  const h = camera.y - target.y,
    r = Math.hypot(camera.x - target.x, camera.z - target.z);
  const top = Math.sqrt(Math.max(0, maxDistance ** 2 - r * r));
  const bottom = Math.max(
    r * Math.tan(Math.PI / 2 - maxPolarAngle) + 0.01,
    Math.sqrt(Math.max(0, minDistance ** 2 - r * r)),
    floor - target.y,
  );
  const to = sign > 0 ? Math.min(h + Math.max(1, h / 3), top) : Math.max(h <= 4 ? h - 1 : (h * 3) / 4, bottom);
  return sign > 0 ? Math.max(0, to - h) : Math.min(0, to - h);
}

// A pan step from pivot `target`: slowed the further out it lands, free within PAN_FREE, stopping at PAN_LIMIT; only the
// outward part (coming back is never slowed). Measured on where it lands, so a pan round the site cannot creep out.
// Returns the step to take ({x, z}).
export function easedPanStep(target, step) {
  const x = target.x + step.x,
    z = target.z + step.z,
    r = Math.hypot(target.x, target.z),
    landed = Math.hypot(x, z);
  if (landed <= r || landed <= PAN_FREE) return {x: step.x, z: step.z};
  const ease = (1 - clamp((r - PAN_FREE) / (PAN_LIMIT - PAN_FREE), 0, 1)) ** 2;
  const scale = Math.max(r, Math.min(r + (landed - r) * ease, PAN_LIMIT)) / landed;
  return {x: x * scale - target.x, z: z * scale - target.z};
}

// The hard limits after any move of the view. A pivot a zoom took under the ground slides back along the line of
// sight to the ground (the camera stays, so the picture does too); then the pivot stays within PAN_LIMIT and between
// the ground and PAN_TOP, the camera moving with it, and the camera stays above the grass. Changes `camera` and
// `target` in place; returns whether the camera was lifted to its floor (it then has to look at the pivot again).
export function settlePivot(camera, target) {
  if (target.y < 0 && camera.y > 0) {
    const f = camera.y / (camera.y - target.y);
    target.x = camera.x + (target.x - camera.x) * f;
    target.z = camera.z + (target.z - camera.z) * f;
    target.y = 0;
  }
  const r = Math.hypot(target.x, target.z),
    out = r > PAN_LIMIT ? PAN_LIMIT / r - 1 : 0;
  const shift = {x: target.x * out, y: clamp(target.y, 0, PAN_TOP) - target.y, z: target.z * out};
  for (const k of ['x', 'y', 'z']) {
    target[k] += shift[k];
    camera[k] += shift[k];
  }
  if (camera.y < CAMERA_FLOOR) {
    camera.y = CAMERA_FLOOR;
    return true;
  }
  return false;
}

// Zoom toward the cursor in three.js: along the screen (the pivot straight ahead) for views flatter than 20° below the
// horizon, along the ground otherwise (where the screen plane turned the building some 16° a pinch at the overview).
// `viewY`: the view direction's height part (−1 straight down).
export const screenPlaneZoom = (viewY) => Math.abs(viewY) < Math.cos((70 * Math.PI) / 180);

// The view keys, by the key's place (the Thai layout types other characters on them), else by the character (an
// on-screen keyboard sends no place).
const VIEW_KEYS = {
  KeyR: 'reset',
  Equal: 'in',
  NumpadAdd: 'in',
  Minus: 'out',
  NumpadSubtract: 'out',
  PageUp: 'up',
  PageDown: 'down',
};
const VIEW_CHARS = {r: 'reset', R: 'reset', '+': 'in', '=': 'in', '-': 'out', PageUp: 'up', PageDown: 'down'};
export const viewKey = (event) => VIEW_KEYS[event.code] ?? VIEW_CHARS[event.key];

// How far out zooming goes: a little past the whole-site view (at 500 m the world was a disc floating in the sky).
export const maxZoomOut = (siteDistance) => Math.max(130, 1.2 * siteDistance);
