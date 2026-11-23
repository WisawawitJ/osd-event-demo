import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {isPaused} from 'osd/core/clock.js';
import {options} from 'osd/core/options.js';

// The buttons on the 3D view (zoom, camera up and down, back to the stop's own view) and the idle orbit.
export function createViewControls({
  camera,
  controls,
  schedule,
  pushForward,
  heightStep,
  closeRange,
  flight,
  navigation,
  showcase,
  storyRunning,
  signal,
}) {
  const userMove = () => {
    controls.dispatchEvent({type: 'start'});
    controls.dispatchEvent({type: 'end'});
  };
  function zoomBy(factor) {
    userMove();
    navigation.stopMove();
    if (factor < 1 && camera.position.distanceTo(controls.target) <= closeRange()) {
      pushForward(1.5);
      return;
    }
    const offset = camera.position.clone().sub(controls.target),
      from = offset.length(),
      to = THREE.MathUtils.clamp(from * factor, controls.minDistance, controls.maxDistance);
    navigation.move((e) => {
      camera.position.copy(controls.target).add(offset.setLength(from + (to - from) * e));
    });
  }
  document.querySelector('#view-zoom-in').addEventListener('click', () => zoomBy(1 / 1.3), {signal});
  document.querySelector('#view-zoom-out').addEventListener('click', () => zoomBy(1.3), {signal});
  function liftBy(sign) {
    userMove();
    const from = camera.position.y,
      to = from + heightStep(sign);
    navigation.move((e) => {
      camera.position.y = from + (to - from) * e;
    });
  }
  document.querySelector('#view-up').addEventListener('click', () => liftBy(1), {signal});
  document.querySelector('#view-down').addEventListener('click', () => liftBy(-1), {signal});
  document.querySelector('#view-reset').addEventListener(
    'click',
    () => {
      userMove();
      showcase.resetView();
    },
    {signal},
  );
  const orbitButton = document.querySelector('#view-orbit');
  let orbitEnabled = true;
  try {
    orbitEnabled = localStorage.getItem('osd-demo-orbit') !== 'off';
  } catch {}
  orbitButton.setAttribute('aria-pressed', String(orbitEnabled));
  orbitButton.addEventListener(
    'click',
    () => {
      orbitEnabled = !orbitEnabled;
      orbitButton.setAttribute('aria-pressed', String(orbitEnabled));
      try {
        localStorage.setItem('osd-demo-orbit', orbitEnabled ? 'on' : 'off');
      } catch {}
      if (!orbitEnabled) stopOrbit();
    },
    {signal},
  );
  // Idle: 20 s with no input on the 3D view. Never while the camera is flying or a story is directing it. Only the 3D
  // view's own input counts (the canvas and its view controls): scrolling or tapping the panel, the page or the phone
  // mock-up leaves the camera turning.
  let lastInput = performance.now(),
    orbitFrame = 0;
  const ORBIT_DEG_PER_S = 3.5,
    IDLE_FREE_MS = 20000;
  function stopOrbit() {
    if (orbitFrame) cancelAnimationFrame(orbitFrame);
    orbitFrame = 0;
  }
  const onView = (target) => Boolean(target.closest?.('#viewport')) && !target.closest('#view-orbit, #parking-layer');
  // A drag counts all along (one longer than 20 s had the orbit start under the finger).
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown'])
    document.addEventListener(
      type,
      (event) => {
        if (!onView(event.target) || (type === 'pointermove' && !event.buttons)) return;
        lastInput = performance.now();
        stopOrbit();
      },
      {capture: true, signal},
    );
  const orbitAllowed = () => {
    if (
      !orbitEnabled ||
      'manual' in options ||
      document.hidden ||
      isPaused() ||
      flight.running ||
      showcase.getState().traveling ||
      storyRunning()
    )
      return false;
    return performance.now() - lastInput > IDLE_FREE_MS;
  };
  let flightWasRunning = false;
  const orbitWatch = setInterval(() => {
    // Idle counts from the moment a flight lands: the visitor's own (a dock tap, outside the
    // view, is use too: it orbited the moment it landed).
    if (flight.running) {
      flightWasRunning = true;
      return;
    }
    if (flightWasRunning) {
      flightWasRunning = false;
      lastInput = performance.now();
    }
    if (orbitFrame || !orbitAllowed()) return;
    let last = performance.now();
    const up = new THREE.Vector3(0, 1, 0);
    const tick = (time) => {
      if (!orbitAllowed()) {
        orbitFrame = 0;
        return;
      }
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      camera.position
        .sub(controls.target)
        .applyAxisAngle(up, -THREE.MathUtils.degToRad(ORBIT_DEG_PER_S) * dt)
        .add(controls.target);
      controls.update();
      schedule();
      orbitFrame = requestAnimationFrame(tick);
    };
    orbitFrame = requestAnimationFrame(tick);
  }, 500);
  signal.addEventListener(
    'abort',
    () => {
      clearInterval(orbitWatch);
      stopOrbit();
    },
    {once: true},
  );
}
