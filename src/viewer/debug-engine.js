import {TICK, advance, demoNow, isPaused, world} from 'osd/core/clock.js';

// Screenshots (the `manual` and `debug` options): `__engine.run(cond, ms)` steps simulation time until `cond()` holds
// or `ms` have passed (`cond` omitted: all of `ms`), and resolves whether it held. While the camera flies or the
// showcase is on its way to a stop (real time, with a wait for the page's layout before the flight sets off) it
// waits for the landing instead of stepping, so each state is reached at the same simulation time on every run. Paused,
// it steps nothing. It hands back to the caller after about 5 s of real time (`done: false`).
// `hold(on)`: nothing else draws. `moving()`: the camera is on its way to a stop.
export function createDebugEngine({renderer, draw, schedule, hold, moving}) {
  return {
    now: demoNow,
    // Screenshots: the frame for the picture. The GPU (this laptop's NVIDIA driver) draws the same frame a shade
    // differently now and then (software rendering never does): it is drawn again until two draws in a row agree, and
    // then held (nothing else draws) until the next step.
    settle() {
      const gl = renderer.getContext(),
        w = gl.drawingBufferWidth,
        h = gl.drawingBufferHeight,
        pixels = new Uint8Array(w * h * 4);
      const sum = () => {
        draw();
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let a = 0,
          b = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          a = (a + pixels[i] + pixels[i + 1] * 3 + pixels[i + 2] * 7) | 0;
          b = (b * 31 + pixels[i + 1]) | 0;
        }
        return `${a}:${b}`;
      };
      if (renderer.shadowMap.needsUpdate) draw();
      let last = sum(),
        tries = 1;
      for (let next; tries < 8 && (next = sum()) !== last; tries++) last = next;
      hold(true);
      return tries;
    },
    // The benchmark: draws one frame of the view as it stands (the pond mirror and the LPR inset with it) and waits
    // for the GPU to finish it (a one-pixel read), and says what it cost. A shadow update still pending is drawn
    // first, untimed: the shadows are redrawn only when the sun moves or the view changes, not every frame.
    frame() {
      const gl = renderer.getContext(),
        pixel = new Uint8Array(4);
      if (renderer.shadowMap.needsUpdate) draw();
      renderer.info.reset();
      renderer.info.autoReset = false;
      const start = performance.now();
      try {
        draw();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      } finally {
        renderer.info.autoReset = true;
      }
      return {
        ms: performance.now() - start,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        programs: renderer.info.programs.length,
      };
    },
    async run(cond = () => false, ms = 600000) {
      hold(false);
      const end = demoNow() + ms,
        started = performance.now();
      // The panels repaint on the clock's tick, as they would between frames, and the shadows are drawn again for the
      // moment reached: redrawn only when something asks, they kept the sun of whichever frame happened to be drawn
      // while stepping, a different one each run.
      const out = (result) => {
        world.tick();
        renderer.shadowMap.needsUpdate = true;
        schedule();
        return result;
      };
      for (;;) {
        if (cond()) return out({held: true, done: true});
        if (performance.now() - started > 5000) return out({held: false, done: false, left: end - demoNow()});
        if (moving()) {
          await new Promise((r) => requestAnimationFrame(r));
          continue;
        }
        if (demoNow() >= end || isPaused()) return out({held: false, done: true});
        const second = Math.floor(demoNow() / 1000);
        await advance(TICK);
        // The clock's tick (the panels follow it) every second of simulation time, at the same moments in every run.
        if (Math.floor(demoNow() / 1000) !== second) {
          world.tick();
          await new Promise((r) => requestAnimationFrame(r));
        }
      }
    },
  };
}
