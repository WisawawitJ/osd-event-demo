import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {MAX_POLAR, heightStep as stepHeight, easedPanStep, settlePivot, screenPlaneZoom} from 'osd/viewer/view-math.js';

// How the 3D view moves under the visitor's hands: three.js's orbit controls, with the demo's own pans, zooms and limits
// (view-math.js). `ready()`: the model is up. Returns what the view's buttons and keys use.
export function limitControls({controls, camera, canvas, schedule, ready, signal}) {
  // Panning slides the view across the ground at the height it has (two fingers, a touchpad scroll, Shift-drag, the
  // arrow keys): up and down on the screen go forward and back, not up and down in the air. Set for each pan (in _pan
  // below). The same setting also picks how three.js zooms toward the cursor, so for zooms it follows the view's tilt:
  // off (the pivot slides along the ground under the cursor) when the view looks down by 20° or more, on (the pivot
  // straight ahead) when flatter, where off turned the building some 16° a pinch (the overview). On everywhere, a zoom
  // toward the lower screen at the car park or the pond took the pivot under the ground, and the limit lifting it back
  // slid the picture from under the fingers.
  const viewDir = new THREE.Vector3();
  const baseUpdate = controls.update.bind(controls);
  controls.update = (...args) => {
    controls.screenSpacePanning = screenPlaneZoom(camera.getWorldDirection(viewDir).y);
    return baseUpdate(...args);
  };
  controls.zoomToCursor = true;
  controls.listenToKeyEvents(canvas);
  // OrbitControls zooms by a percentage of the distance to its pivot, so steps shrink as you close in and
  // you can never pass the pivot. Close in, a zoom-in step instead moves the camera and the pivot forward
  // together (toward the cursor, or the view centre for the + button), at a steady pace.
  const pushRay = new THREE.Raycaster(),
    pushNdc = new THREE.Vector2();
  // Below ~20 m a 5% step is under a metre; from there on, steps stay about a metre long.
  const closeRange = () => Math.max(controls.minDistance * 2.5, 20);
  controls.zoomSpeed = 1.4;
  // Camera up / down (the ▲ ▼ buttons, Page Up / Page Down): view-math.js heightStep.
  const heightStep = (sign) =>
    stepHeight(
      {
        camera: camera.position,
        target: controls.target,
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        maxPolarAngle: controls.maxPolarAngle,
      },
      sign,
    );
  function pushForward(metres, clientX = null, clientY = null) {
    const rect = canvas.getBoundingClientRect();
    pushNdc.set(
      clientX == null ? 0 : ((clientX - rect.left) / rect.width) * 2 - 1,
      clientY == null ? 0 : (-(clientY - rect.top) / rect.height) * 2 + 1,
    );
    pushRay.setFromCamera(pushNdc, camera);
    const dir = pushRay.ray.direction;
    // Stop at the ground rather than dive through it.
    if (dir.y < 0) metres = Math.min(metres, Math.max(0, (camera.position.y - 0.9) / -dir.y));
    if (metres <= 0.01) return false;
    camera.position.addScaledVector(dir, metres);
    controls.target.addScaledVector(dir, metres);
    controls.update();
    schedule();
    return true;
  }
  // Touchpads: two fingers scroll to pan, as in maps (holding the right button, the other way to pan, is awkward on a
  // touchpad); a pinch still zooms (it arrives as a wheel with ctrlKey), and so does a mouse wheel. Shift- or Ctrl-drag
  // pans too. A touchpad's scroll comes as a stream of small steps (a few px, often with a sideways part); a wheel notch
  // moves 50 px or more at once (53⅓ in Chromium on Linux, 100 on Windows). (wheelDelta did not tell them apart on
  // Linux.) Once a scroll pans, the rest of its stream does too, so a fast flick's bigger steps do not turn into zooms.
  // Runs before the close zoom below, which would take a scroll up as a step forward.
  let panningUntil = 0;
  const touchpadScroll = (event) => {
    if (event.ctrlKey || event.deltaMode !== 0) return false;
    const now = performance.now(),
      pad = now < panningUntil || event.deltaX !== 0 || Math.abs(event.deltaY) < 50;
    if (pad) panningUntil = now + 200;
    return pad;
  };
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!ready() || !controls.enabled || !controls.enablePan || !touchpadScroll(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      controls.dispatchEvent({type: 'start'});
      controls._pan(-event.deltaX, -event.deltaY);
      controls.update();
      controls.dispatchEvent({type: 'end'});
      schedule();
    },
    {capture: true, passive: false, signal},
  );
  // Panning slows the further the view's pivot goes from the site's middle: free within PAN_FREE, then slower and
  // slower to a stop at PAN_LIMIT, so a touchpad scroll cannot carry the view off into the fog (it went on without
  // end). Only the outward part of a step is slowed: coming back is never. Every pan, by mouse, keys, touch or
  // touchpad, goes through _pan; the hard limits below catch every other way the view moves.
  const basePan = controls._pan.bind(controls),
    panBefore = new THREE.Vector3(),
    panStep = new THREE.Vector3();
  controls._pan = (deltaX, deltaY) => {
    panBefore.copy(controls._panOffset);
    const zoomSetting = controls.screenSpacePanning;
    controls.screenSpacePanning = false;
    basePan(deltaX, deltaY);
    controls.screenSpacePanning = zoomSetting;
    panStep.subVectors(controls._panOffset, panBefore);
    const eased = easedPanStep(controls.target, panStep);
    controls._panOffset.copy(panBefore).add(panStep.set(eased.x, panStep.y, eased.z));
  };
  // Hard limits, after every move of the view (pans, zoom toward the cursor, the close zoom below, keys, the idle
  // orbit): the pivot stays within PAN_LIMIT of the site's middle and between the ground and PAN_TOP, the camera moving
  // with it, and the camera stays above the grass. (Zooming toward the sky took the pivot 129 m under the ground, and
  // the camera after it.) Orbiting stops just above the horizon.
  controls.maxPolarAngle = MAX_POLAR;
  controls.addEventListener('change', () => {
    // A pivot a zoom took under the ground (toward the lower screen in a flat view, or the close zoom's walk forward)
    // slides back along the line of sight to the ground: the camera stays, so the picture does too. (Lifted below
    // with the camera, it threw the picture hundreds of pixels, two ▼ presses into a stop.)
    if (settlePivot(camera.position, controls.target)) camera.lookAt(controls.target);
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (!ready() || event.deltaY >= 0 || !controls.enabled || !controls.enableZoom) return;
      if (camera.position.distanceTo(controls.target) > closeRange()) return;
      // At the ground there is nowhere further to go; let the normal zoom have the event. A pinch (a wheel with ctrlKey)
      // comes as dozens of small steps: each moves by its size, without a mouse notch's 0.5 m floor (one pinch went
      // through walls).
      const step = event.ctrlKey ? Math.abs(event.deltaY) / 40 : 0.5 + Math.abs(event.deltaY) / 200;
      if (!pushForward(Math.min(2.4, step), event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      controls.dispatchEvent({type: 'start'});
      controls.dispatchEvent({type: 'end'});
    },
    {capture: true, passive: false, signal},
  );
  return {pushForward, heightStep, closeRange};
}
