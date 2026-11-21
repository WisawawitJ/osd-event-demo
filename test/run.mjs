// Runs the behaviour checks in headless Chromium: `npm test`, or `npm test -- kiosk night` to run matching ones.
// WebGL renders on the NVIDIA GPU when present, else in software; never on the Intel iGPU (see browser.mjs for why).
// JOBS=n runs n browsers side by side (default 4 on NVIDIA, 3 in software, which is CPU work); SPEED=n sets the demo
// time scale (default 30).
import {open, DEFAULT_GPU} from './browser.mjs';
import {scenarios} from './scenarios.mjs';

const filters = process.argv.slice(2).map(f => f.toLowerCase());
const chosen = scenarios.filter(s => !filters.length || filters.some(f => s.name.toLowerCase().includes(f)));
const jobs = Math.max(1, Math.min(Number(process.env.JOBS) || ((process.env.GPU || DEFAULT_GPU) === 'software' ? 3 : 4), chosen.length));
// Rendering noise the demo cannot avoid; anything else in the console fails the check.
// (SwiftShader has no parallel shader compiling; three.js warns and compiles normally.)
const NOISE = /GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils: Textures of render targets|KHR_parallel_shader_compile extension not supported/;

const started = Date.now();
const results = new Array(chosen.length);
let next = 0, renderer = '';
async function worker() {
  const {page, close} = await open();
  renderer ||= page.renderer;
  try {
    while (next < chosen.length) {
      const index = next++, scenario = chosen[index], t0 = Date.now(), problems = [];
      const expect = (ok, message) => { if (!ok) problems.push(message); };
      try { await scenario.run(page, expect); } catch (error) { problems.push(error.message); }
      problems.push(...page.logs.filter(line => !NOISE.test(line)));
      const shot = problems.length ? await page.shot(scenario.name.replace(/\W+/g, '-')).catch(() => '') : '';
      results[index] = {name: scenario.name, problems, shot, time: (Date.now() - t0) / 1000};
      const r = results[index];
      console.log(`${r.problems.length ? '✗' : '✓'} ${r.name} (${r.time.toFixed(1)} s)${r.problems.length ? `\n    ${r.problems.join('\n    ')}${r.shot ? `\n    screenshot: ${r.shot}` : ''}` : ''}`);
    }
  } finally { close(); }
}
await Promise.all(Array.from({length: jobs}, worker));
const failed = results.filter(r => r.problems.length).length;
console.log(`\nWebGL: ${renderer} · ${jobs} browser${jobs > 1 ? 's' : ''} · speed ${Number(process.env.SPEED) || 30}`);
console.log(`${chosen.length - failed}/${chosen.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
