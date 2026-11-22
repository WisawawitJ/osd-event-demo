// The camera's rules (view-math.js): height steps, panning far out, the hard limits, zoom planes, keys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heightStep, easedPanStep, settlePivot, screenPlaneZoom, viewKey, maxZoomOut, PAN_FREE, PAN_LIMIT, PAN_TOP, CAMERA_FLOOR, MAX_POLAR} from 'osd/viewer/view-math.js';

const view = (camera, target = {x: 0, y: 0, z: 0}) => ({camera, target, minDistance: .4, maxDistance: 130, maxPolarAngle: MAX_POLAR});

test('▲ then ▼ come back to the same height, at any height', () => {
  // Heights inside the limits (the camera at least 0.8 m up, above the horizon): 3 m out from the point it looks at.
  for (const h of [1, 2.5, 3, 3.5, 4, 6, 20]) {
    const v = view({x: 3, y: h, z: 0});
    const up = heightStep(v, 1); v.camera.y += up;
    const down = heightStep(v, -1);
    assert.ok(Math.abs(up + down) < 1e-9, `from ${h} m: +${up.toFixed(2)} then ${down.toFixed(2)}`);
  }
});

test('▲ stops at the zoom-out limit without swinging overhead; ▼ stops just above the horizon without backing away', () => {
  const v = view({x: 60, y: 10, z: 0});
  for (let i = 0; i < 40; i++) v.camera.y += heightStep(v, 1);
  assert.ok(Math.abs(Math.hypot(v.camera.x, v.camera.y) - 130) < 1e-6 && v.camera.x === 60, `at the limit (${Math.hypot(60, v.camera.y).toFixed(1)} m), still 60 m out`);
  assert.equal(heightStep(v, 1), 0, 'a press at the limit does nothing');
  for (let i = 0; i < 80; i++) v.camera.y += heightStep(v, -1);
  const tilt = Math.atan2(v.camera.y, 60) * 180 / Math.PI;
  assert.ok(tilt > 1 && tilt < 2.5 && v.camera.x === 60, `just above the horizon (${tilt.toFixed(2)}°), not backed away`);
  assert.equal(heightStep(v, -1), 0);
});

test('panning is free near the site, slows far out, stops at the limit; coming back is never slowed', () => {
  assert.deepEqual(easedPanStep({x: 10, y: 0, z: 0}, {x: 5, z: 0}), {x: 5, z: 0}, 'free near the site');
  const near = easedPanStep({x: 60, y: 0, z: 0}, {x: 5, z: 0}).x, far = easedPanStep({x: 85, y: 0, z: 0}, {x: 5, z: 0}).x;
  assert.ok(near < 5 && far < near * .5, `slower further out (${near.toFixed(2)} at 60 m, ${far.toFixed(2)} at 85 m)`);
  assert.ok(85 + easedPanStep({x: 85, y: 0, z: 0}, {x: 50, z: 0}).x <= PAN_LIMIT + 1e-9, 'never past the limit');
  assert.deepEqual(easedPanStep({x: 85, y: 0, z: 0}, {x: -5, z: 0}), {x: -5, z: 0}, 'back at full speed');
  let t = {x: 89, y: 0, z: 0};
  for (let i = 0; i < 200; i++) { const s = easedPanStep(t, {x: 0, z: 3}); t = {x: t.x + s.x, y: 0, z: t.z + s.z}; }
  assert.ok(Math.hypot(t.x, t.z) <= PAN_LIMIT + 1e-6, 'a pan round the site does not creep out');
  void PAN_FREE;
});

test('a pivot taken under the ground slides back along the line of sight: the camera, and so the picture, stays', () => {
  const camera = {x: 0, y: 10, z: 20}, target = {x: 0, y: -2, z: 0};
  const before = {...camera}, dir = {x: target.x - camera.x, y: target.y - camera.y, z: target.z - camera.z};
  settlePivot(camera, target);
  assert.deepEqual(camera, before, 'the camera did not move');
  assert.ok(Math.abs(target.y) < 1e-9, 'the pivot on the ground');
  const k = (target.z - camera.z) / dir.z;
  assert.ok(Math.abs((target.y - camera.y) - dir.y * k) < 1e-9, 'on the same line of sight');
});

test('the limits: the pivot within 90 m and 35 m up, the camera moving with it; the camera above the grass', () => {
  let camera = {x: 120, y: 20, z: 0}, target = {x: 100, y: 50, z: 0};
  settlePivot(camera, target);
  assert.ok(Math.abs(Math.hypot(target.x, target.z) - PAN_LIMIT) < 1e-9 && target.y === PAN_TOP);
  assert.ok(Math.abs(camera.x - target.x - 20) < 1e-9, 'the camera moved with it');
  camera = {x: 5, y: .2, z: 5}; target = {x: 0, y: 1, z: 0};
  assert.equal(settlePivot(camera, target), true);
  assert.equal(camera.y, CAMERA_FLOOR);
});

test('zoom toward the cursor: along the ground when the view looks down by 20° or more, along the screen when flatter', () => {
  const down = deg => -Math.sin(deg * Math.PI / 180);
  assert.equal(screenPlaneZoom(down(17)), true, 'the overview, 17° down');
  assert.equal(screenPlaneZoom(down(27)), false, 'the car park, 27° down');
});

test('view keys by key place (Thai layout) or by character (on-screen keyboards, German +/−)', () => {
  assert.equal(viewKey({code: 'KeyR', key: 'พ'}), 'reset');
  assert.equal(viewKey({code: 'Slash', key: '-'}), 'out');
  assert.equal(viewKey({code: '', key: '+'}), 'in');
  assert.equal(viewKey({code: 'PageDown', key: 'PageDown'}), 'down');
  assert.equal(viewKey({code: 'KeyA', key: 'a'}), undefined);
});

test('zooming out stops a little past the whole-site view', () => {
  assert.equal(maxZoomOut(70), 130);
  assert.equal(maxZoomOut(135), 162);
});
