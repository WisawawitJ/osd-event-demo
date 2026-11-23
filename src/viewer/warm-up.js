import * as THREE from 'osd/node_modules/three/build/three.module.js';

// Warm-up: a stop's first visit stalled 0.3–0.7 s, compiling and linking shader variants on the spot: the flight's
// floor change cuts geometry with one more clipping plane (scene-transition.js), and the night's lights change
// the number of lights. Compile every material each way at load, draw one tiny off-screen frame each way
// (shadows included), and upload every texture, before anyone clicks.
export async function warmUp({renderer, scene, camera, sceneTransition, securityPreview}) {
  const hidden = [];
  // Hidden objects are drawn too, so their shaders compile: they read as visible only inside the warm-up's own
  // compile and draw calls (where writes, such as the pond mirror hiding itself for its pass, stay inside too).
  // Everywhere else the app reads and sets their real visibility, which a `dest` option's stop may change meanwhile.
  let forcing = 0;
  const forced = (fn) => {
    forcing++;
    try {
      return fn();
    } finally {
      forcing--;
    }
  };
  // The object's `visible` then reads and writes `state.forced` inside forced(), `state.wanted` everywhere else.
  const split = (object, state) => {
    Object.defineProperty(object, 'visible', {
      configurable: true,
      enumerable: true,
      get: () => (forcing ? state.forced : state.wanted),
      set: (value) => {
        if (forcing) state.forced = value;
        else state.wanted = value;
      },
    });
    return [object, state];
  };
  scene.traverse((object) => {
    if (!object.visible && !object.isLight) hidden.push(split(object, {wanted: false, forced: true}));
  });
  // The night's lights (the rooms' spot lights) change the number of lights, so the shaders for the other half of the
  // day are compiled here too: the first dusk (or dawn) then does not freeze the view for a second and a half. They
  // keep their current state, and swap only for the last compile.
  const nightLights = [];
  scene.traverse((object) => {
    if (object.isSpotLight && object.name.startsWith('Simulation_spot_'))
      nightLights.push(split(object, {wanted: object.visible, forced: object.visible}));
  });
  const target = new THREE.WebGLRenderTarget(16, 16);
  const drawPixel = () =>
    forced(() => {
      renderer.shadowMap.needsUpdate = true;
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, 1, 1);
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.setScissorTest(false);
      }
    });
  const drawOffscreen = () =>
    forced(() => {
      const previous = renderer.getRenderTarget();
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previous);
    });
  try {
    await forced(() => renderer.compileAsync(scene, camera));
    scene.traverse((object) => {
      for (const material of [].concat(object.material || []))
        for (const value of Object.values(material)) if (value?.isTexture) renderer.initTexture(value);
    });
    drawOffscreen();
    // The flight's floor change draws copies of the building's materials with one more clipping plane: make them
    // now and set them up for the canvas (compiled, then first used in a one-pixel frame, as below), by day and by
    // night (the first night flight to the meeting room froze for 0.2 s).
    const prepareCopies = () =>
      sceneTransition.prepare(async () => {
        await forced(() => renderer.compileAsync(scene, camera));
        drawPixel();
      });
    await prepareCopies();
    securityPreview.prepare();
    for (const [, state] of nightLights) state.forced = !state.wanted;
    await forced(() => renderer.compileAsync(scene, camera));
    drawOffscreen();
    await prepareCopies();
    // Off-screen frames use other shader variants (linear colour, no tone mapping) than the canvas: the canvas's
    // own are first used, and finish linking, in one frame drawn to the screen clipped to a single pixel, which
    // the next real frame covers.
    drawPixel();
  } catch {
    // Compiled at first use instead.
  } finally {
    for (const [object, state] of [...hidden, ...nightLights])
      Object.defineProperty(object, 'visible', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: state.wanted,
      });
    target.dispose();
  }
}
