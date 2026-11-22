// Frame cost: `npm run bench`, `npm run bench -- parking night` for the scenes whose names match, `GPU=software` for
// software WebGL (SwiftShader on the CPU: the slow case, never the Intel iGPU, see browser.mjs).
//
// Each scene opens stepped (the `manual` option, as the screenshots do: the same moment every run), reaches its state,
// then draws single frames: FRAMES of them (default 12, after 3 that compile shaders and fill caches), each after
// 100 ms of simulation time so the cars move between them, each timed from the draw call until the GPU has finished
// it. Reported per frame: the median and the slowest time, draw calls, triangles, and the shader programs built so
// far. Single frames, not a frame rate: a page that draws only when something changes has no steady rate to measure,
// and software rendering needs no minutes of it.
import {open} from './browser.mjs';

const FRAMES = Number(process.env.FRAMES) || 12,
  WARM = 3;
const page = (params, speed = 30) => `?debug=1&warm=0&manual=1&seed=1&speed=${speed}&${params}`;
const STILL =
  "!document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')";
const AT = (id) => `document.body.dataset.tourDestination===${JSON.stringify(id)} && ${STILL}`;
const SCENES = [
  {name: 'overview', path: page('time=10:00'), ready: AT('overview')},
  {name: 'meeting room', path: page('dest=meeting&time=10:00'), ready: AT('meeting')},
  {
    name: 'fish pond',
    path: page('dest=pond&time=10:00'),
    ready: `${AT('pond')} && __scene.getObjectByName('Courtyard_water_reflection').visible`,
  },
  {name: 'energy', path: page('dest=energy&time=10:00'), ready: AT('energy')},
  // The morning rush: the most cars on the move.
  {name: 'parking at the rush', path: page('dest=parking&time=08:00'), ready: `${AT('parking')} && __parking.active`},
  {
    name: 'parking + LPR pop-up',
    path: page('dest=parking&time=10:00'),
    ready: `${AT('parking')} && __parking.active`,
    async setup(p) {
      await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
      await p.reach(
        `!!document.querySelector('.pk-feed:not([hidden])') && __parking.sim.state.alerts.some(a=>a.status==='open')`,
        'the car at the gate, its camera card up',
      );
    },
  },
  {
    name: 'parking at night',
    path: page('dest=parking&time=20:00'),
    ready: `${AT('parking')} && __parking.active && document.documentElement.dataset.night==='true'`,
  },
  {name: 'explore page', path: page('time=10:00#explore'), ready: 'true'},
  // A flight: frames drawn at points along one, from the overview to the car park (real time, the camera's own).
  {name: 'flight to the car park', path: page('time=10:00', 1), ready: AT('overview'), flight: 'parking'},
];

const filters = process.argv.slice(2).map((f) => f.toLowerCase());
const chosen = SCENES.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
if (!chosen.length) {
  console.error(`no scene matches ${filters.join(' ')}`);
  process.exit(2);
}
const {page: p, close} = await open();
await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false});
const rows = [];
try {
  for (const scene of chosen) {
    await p.goto(scene.path);
    await p.ready(scene.ready);
    await scene.setup?.(p);
    await p.step(2000);
    const frames = [];
    if (scene.flight) {
      await p.click(`[data-destination="${scene.flight}"]`);
      // While it flies, one timed frame each animation frame.
      while (await p.eval(`document.querySelector('#viewport').classList.contains('flying')`))
        frames.push(await p.eval('__engine.frame()'));
    } else {
      for (let i = 0; i < WARM + FRAMES; i++) {
        const f = await p.eval('__engine.frame()');
        if (i >= WARM) frames.push(f);
        await p.eval('__engine.run(undefined, 100)');
      }
    }
    const ms = frames.map((f) => f.ms).sort((a, b) => a - b),
      last = frames[frames.length - 1] ?? {};
    const median = ms.length ? ms[ms.length >> 1] : NaN;
    rows.push({
      scene: scene.name,
      'ms median': median.toFixed(1),
      'ms slowest': (ms[ms.length - 1] ?? NaN).toFixed(1),
      frames: frames.length,
      'draw calls': Math.round(frames.reduce((n, f) => n + f.calls, 0) / frames.length),
      'k triangles': Math.round(frames.reduce((n, f) => n + f.triangles, 0) / frames.length / 1000),
      programs: last.programs,
    });
    console.log(`${scene.name}: done`);
  }
} finally {
  await close();
}
console.log(`\nWebGL: ${p.renderer} · 1920×1080 · single frames, until the GPU is done`);
console.table(rows);
