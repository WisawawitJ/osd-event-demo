// Frame-cost benchmark: `npm run bench`, or `npm run bench -- parking night` to run matching scenes.
// Each scene runs in headless Chromium on this machine's GPU and reports the median of BENCH_ROUNDS (default 3) windows
// of BENCH_SECONDS (default 3): frames drawn per second, main-thread busy time, and per drawn frame the CPU and GPU
// time, draw calls and triangles (main view, pond mirror and any inset together).
// GPU time needs EXT_disjoint_timer_query_webgl2; it shows "–" where the driver does not offer it.
import {open} from './browser.mjs';

const SECONDS = Number(process.env.BENCH_SECONDS) || 3, ROUNDS = Number(process.env.BENCH_ROUNDS) || 3;
// `check` must hold before measuring, so a scene that did not reach its state fails instead of measuring something else.
let flightStop = 0; // the flight route carries on across windows, so every window flies a different leg
const SCENES = [
  {name: 'overview', path: '?dest=overview'},
  {name: 'meeting room', path: '?dest=meeting'},
  {name: 'fish pond', path: '?dest=pond', check: `__scene.getObjectByName('Courtyard_water_reflection').visible`},
  {name: 'energy', path: '?dest=energy'},
  {name: 'entrance', path: '?dest=access'},
  {name: 'parking (traffic)', path: '?dest=parking'},
  // The unknown car waits for staff for 45 s of demo time, then is turned away and the pop-up closes: keep runs shorter.
  {name: 'parking + LPR pop-up', path: '?dest=parking', check: `!!document.querySelector('.pk-feed:not([hidden]) .pk-feed-img.live')`, async setup(p) {
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`, {timeout: 30000, what: 'car at the gate'});
  }},
  {name: 'parking at night', path: '?dest=parking', check: `document.documentElement.dataset.night==='true'`, async setup(p) {
    await p.until(`!document.querySelector('#tour-night').disabled`, {what: 'night switch enabled'}); // off during the opening flight
    await p.click('#tour-night'); await p.sleep(800);
  }},
  {name: 'flights between stops', path: '?dest=overview', async during(p, end) {
    const stops = ['pond', 'parking', 'meeting', 'energy', 'access', 'overview'];
    // Each flight runs to its end (some take ~2 s) before the next click, so final approaches are measured too.
    while (Date.now() < end) {
      await p.click(`[data-destination="${stops[flightStop++ % stops.length]}"]`); await p.sleep(100);
      // A flight still going at the deadline finishes inside this window (up to 5 s), so the next window never cuts it.
      for (const stop = Date.now() + 5000; Date.now() < stop && await p.eval(`document.querySelector('#viewport').classList.contains('flying')`);) await p.sleep(100);
      await p.sleep(Math.max(0, Math.min(300, end - Date.now())));
    }
  }},
  {name: 'explore page', path: '?#explore'},
];

// Wraps the renderer: for each top-level draw to the screen, its CPU time, its draw calls and triangles (info is not
// reset inside it, so the pond mirror's nested render adds to the count instead of wiping it), and its GPU time when the
// timer extension exists. A window's GPU queries are all read before the window closes (see b.settle).
const INSTRUMENT = `(()=>{
  const R=__renderer,gl=R.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),render=R.render.bind(R);
  const b=window.__bench={draws:0,cpu:0,gpu:0,calls:0,tris:0,gpuOK:!!ext,disjoint:false,on:false,pending:[]};
  let depth=0;
  R.render=(s,c)=>{
    if(depth||!b.on||R.getRenderTarget())return render(s,c);
    depth++;let q=null;if(ext){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);}
    R.info.reset();R.info.autoReset=false;
    const t=performance.now();try{render(s,c);}finally{R.info.autoReset=true;}b.cpu+=performance.now()-t;
    if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);b.pending.push(q);}
    b.calls+=R.info.render.calls;b.tris+=R.info.render.triangles;if(c===__camera)b.draws++;
    depth--;
  };
  b.read=()=>{while(b.pending.length&&gl.getQueryParameter(b.pending[0],gl.QUERY_RESULT_AVAILABLE)){
    const q=b.pending.shift();if(gl.getParameter(ext.GPU_DISJOINT_EXT))b.disjoint=true;else b.gpu+=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);}};
  // Queries still unanswered after 2 s are dropped (that window reports no GPU time) so they cannot count in the next one.
  b.settle=()=>new Promise(ok=>{const end=performance.now()+2000;(function poll(){b.read();if(b.pending.length&&performance.now()<=end)return requestAnimationFrame(poll);
    const lost=b.pending.length;for(const q of b.pending)gl.deleteQuery(q);b.pending=[];ok({...b,lost});})();});
})()`;

const filters = process.argv.slice(2).map(f => f.toLowerCase());
const chosen = SCENES.filter(s => !filters.length || filters.some(f => s.name.toLowerCase().includes(f)));
const {page: p, close} = await open();
const metric = async () => Object.fromEntries((await p.cdp('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value]));
const rows = [];
try {
  await p.cdp('Performance.enable');
  for (const scene of chosen) {
    const [path, hash = ''] = scene.path.split('#');
    await p.goto(`${path || '?'}${path.includes('=') ? '&' : ''}debug=1${hash ? '#' + hash : ''}`);
    await p.until(`!!window.__renderer && document.querySelector('#status')?.dataset.state==='ready' && (document.documentElement.dataset.warm==='done' || !document.querySelector('#showcase'))`, {timeout: 60000, what: 'scene ready'});
    await p.eval(INSTRUMENT);
    await scene.setup?.(p);
    if (process.env.BENCH_EVAL) await p.eval(process.env.BENCH_EVAL); // ad-hoc experiments, e.g. hide an object
    await p.sleep(1500); // let flights and fades settle
    // ROUNDS windows of SECONDS each; the median window is reported (single windows varied by ~25%).
    const windows = [];
    for (let round = 0; round < ROUNDS; round++) {
      // Checked before every window, so a scene that drifts out of its state stops the run instead of measuring something else.
      if (scene.check && !(await p.eval(scene.check))) throw new Error(`${scene.name}: not in the scene's state before window ${round + 1} (${scene.check})`);
      const before = await metric();
      await p.eval('Object.assign(__bench,{draws:0,cpu:0,gpu:0,calls:0,tris:0,disjoint:false,on:true})');
      const t0 = Date.now(), end = t0 + SECONDS * 1000;
      if (scene.during) await scene.during(p, end);
      await p.sleep(Math.max(0, end - Date.now()));
      await p.eval('__bench.on=false');
      if (scene.check && !(await p.eval(scene.check))) throw new Error(`${scene.name}: left the scene's state during window ${round + 1} (${scene.check})`);
      const after = await metric(), secs = (Date.now() - t0) / 1000;
      const b = await p.eval('__bench.settle()');
      windows.push({
        fps: b.draws / secs,
        busy: (after.TaskDuration - before.TaskDuration) / secs * 100, script: (after.ScriptDuration - before.ScriptDuration) / secs * 100,
        // Per-frame figures need frames: a window that drew none (an idle stop) has no sample for them.
        cpu: b.draws ? b.cpu / b.draws : NaN, gpu: b.draws && b.gpuOK && !b.disjoint && !b.lost ? b.gpu / b.draws : NaN,
        calls: b.draws ? b.calls / b.draws : NaN, tris: b.draws ? b.tris / b.draws / 1000 : NaN, heap: after.JSHeapUsedSize / 1048576,
      });
    }
    const median = key => { const v = windows.map(w => w[key]).filter(x => !Number.isNaN(x)).sort((x, y) => x - y), m = v.length >> 1; return !v.length ? NaN : v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const fixed = (key, digits = 0) => Number.isNaN(median(key)) ? '–' : median(key).toFixed(digits);
    rows.push({
      scene: scene.name, fps: fixed('fps'), 'busy %': fixed('busy'), 'script %': fixed('script'),
      'cpu ms/frame': fixed('cpu', 2), 'gpu ms/frame': fixed('gpu', 2), calls: fixed('calls'), 'k tris': fixed('tris'), 'heap MB': fixed('heap'),
    });
    console.log(`${scene.name}: done`);
  }
} finally { close(); }
console.log(`\nWebGL: ${p.renderer} · median of ${ROUNDS} × ${SECONDS} s per scene`);
console.table(rows);
