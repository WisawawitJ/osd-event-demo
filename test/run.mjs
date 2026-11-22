// Runs the behaviour checks in headless Chromium: `npm test`, or `npm test -- kiosk night` to run matching ones.
// `npm run test:quick` (or `quick` among the words) runs only the quick set: one or two short checks per area, about
// 10 s, for while you work; the full run is the check before a commit.
// WebGL renders on the NVIDIA GPU when present, else in software; never on the Intel iGPU (see browser.mjs for why).
// JOBS=n runs n browsers side by side (default 6 on NVIDIA, 3 in software, which is CPU work); SPEED=n sets the demo
// time scale (default 30).
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {open, DEFAULT_GPU} from './browser.mjs';
import {scenarios} from './scenarios.mjs';

const words = process.argv.slice(2).map(f => f.toLowerCase()), quick = words.includes('quick'), filters = words.filter(f => f !== 'quick');
const chosen = scenarios.filter(s => (!quick || s.quick) && (!filters.length || filters.some(f => s.name.toLowerCase().includes(f))));
// A mistyped filter ran nothing and passed.
if (!chosen.length) { console.error(`no check matches ${words.join(' ') || '(none)'}`); process.exit(1); }
// The slowest checks start first (times from earlier runs, kept in test/out): the run then ends on short ones instead
// of one long check left running alone. A check without a time yet counts as an average one.
const TIMES = new URL('out/times.json', import.meta.url);
let times = {};
try { times = JSON.parse(readFileSync(TIMES, 'utf8')); } catch {}
chosen.sort((a, b) => (times[b.name] ?? 6) - (times[a.name] ?? 6));
const jobs = Math.max(1, Math.min(Number(process.env.JOBS) || ((process.env.GPU || DEFAULT_GPU) === 'software' ? 3 : 6), chosen.length));
// Rendering noise the demo cannot avoid; anything else in the console fails the check.
// (SwiftShader has no parallel shader compiling; three.js warns and compiles normally.)
const NOISE = /GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils: Textures of render targets|KHR_parallel_shader_compile extension not supported/;

const started = Date.now();
const results = new Array(chosen.length);
let next = 0, renderer = '';
async function worker() {
  // A browser that does not start leaves the checks to the others (it ended the whole run, without a summary).
  let opened;
  try { opened = await open(); } catch (error) { console.error(`a browser did not start: ${error.message}`); return; }
  const {page, close} = opened;
  renderer ||= page.renderer;
  const origin = new URL(page.url).origin;
  try {
    while (next < chosen.length) {
      const index = next++, scenario = chosen[index], t0 = Date.now(), problems = [];
      const expect = (ok, message) => { if (!ok) problems.push(message); };
      // Each check starts with nothing saved in the page's storage (a check that failed with English on, or the idle
      // orbit off, left it so for the next one).
      await page.cdp('Storage.clearDataForOrigin', {origin, storageTypes: 'local_storage'}).catch(() => {});
      try { await scenario.run(page, expect); } catch (error) { problems.push(error.message); }
      problems.push(...page.logs.filter(line => !NOISE.test(line)));
      const shot = problems.length ? await page.shot(scenario.name.replace(/\W+/g, '-')).catch(() => '') : '';
      const r = results[index] = {name: scenario.name, problems, shot, time: (Date.now() - t0) / 1000};
      console.log(`${r.problems.length ? '✗' : '✓'} ${r.name} (${r.time.toFixed(1)} s)${r.problems.length ? `\n    ${r.problems.join('\n    ')}${r.shot ? `\n    screenshot: ${r.shot}` : ''}` : ''}`);
    }
  } finally { await close(); }
}
await Promise.all(Array.from({length: jobs}, worker));
// Checks no browser ran count as failed.
chosen.forEach((s, i) => { if (!results[i]) { results[i] = {name: s.name, problems: ['not run: no browser'], time: 0}; console.log(`✗ ${s.name} (not run: no browser)`); } });
const failed = results.filter(r => r.problems.length).length;
for (const r of results) if (r.time) times[r.name] = r.time;
// Times of checks that no longer exist go.
const names = new Set(scenarios.map(s => s.name));
for (const name of Object.keys(times)) if (!names.has(name)) delete times[name];
try { mkdirSync(new URL('out/', import.meta.url), {recursive: true}); writeFileSync(TIMES, JSON.stringify(times, null, 1)); } catch {}
console.log(`\nWebGL: ${renderer} · ${jobs} browser${jobs > 1 ? 's' : ''} · speed ${Number(process.env.SPEED) || 30}`);
console.log(`${chosen.length - failed}/${chosen.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
