// Runs the behaviour checks in headless Chromium: `npm test`, or `npm test -- kiosk night` to run matching ones.
// `npm run test:quick` (or `quick` among the words) runs only the quick set: one or two short checks per area, about
// 10 s, for while you work; the full run is the check before a commit.
// WebGL renders on the NVIDIA GPU when present, else in software; never on the Intel iGPU (see browser.mjs for why).
// JOBS=n runs n browsers side by side (default 1); SPEED=n sets the demo
// time scale (default 30).
import {readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
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
// One browser unless JOBS=n says otherwise: the browser checks are few now (the simulation is tested in Node), and one
// browser keeps the laptop free.
const jobs = Math.max(1, Math.min(Number(process.env.JOBS) || 1, chosen.length));
// Rendering noise the demo cannot avoid; anything else in the console fails the check.
// (SwiftShader has no parallel shader compiling; three.js warns and compiles normally.)
const NOISE = /GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils: Textures of render targets|KHR_parallel_shader_compile extension not supported/;

// Screenshots of failures go in a folder of this run's own (test/out/shots/<time>-<pid>): in one shared folder an old
// failure looked like this run's, and clearing it at the start deleted a run alongside's evidence. Older than a day,
// they go (and loose ones from before).
const SHOTS = fileURLToPath(new URL('out/shots/', import.meta.url));
try {
  mkdirSync(SHOTS, {recursive: true});
  for (const f of readdirSync(SHOTS)) if (Date.now() - statSync(SHOTS + f).mtimeMs > 864e5) rmSync(SHOTS + f, {recursive: true, force: true});
  for (const f of readdirSync(new URL('out/', import.meta.url))) if (f.endsWith('.png')) rmSync(new URL(`out/${f}`, import.meta.url));
} catch {}
const runShots = `${SHOTS}${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}-${process.pid}`;

const started = Date.now();
const results = new Array(chosen.length);
let next = 0, renderer = '';
async function worker() {
  // A browser that does not start leaves the checks to the others (it ended the whole run, without a summary).
  let opened;
  try { opened = await open({shots: runShots}); } catch (error) { console.error(`a browser did not start: ${error.message}`); return; }
  const {page, close} = opened;
  renderer ||= page.renderer;
  const origin = new URL(page.url).origin;
  try {
    while (next < chosen.length && !page.gone) {
      const index = next++, scenario = chosen[index], t0 = Date.now(), problems = [];
      const expect = (ok, message) => { if (!ok) problems.push(message); };
      // Each check starts with nothing saved in the page's storage (a check that failed with English on, or the idle
      // orbit off, left it so for the next one).
      await page.cdp('Storage.clearDataForOrigin', {origin, storageTypes: 'local_storage'}).catch(() => {});
      page.logs.length = 0;
      try { await scenario.run(page, expect); } catch (error) { problems.push(error.message); }
      // A screenshot for a console error too (read from the log below, after the page has gone).
      const errors = () => page.logs.filter(line => !NOISE.test(line));
      const shot = problems.length || errors().length ? await page.shot(scenario.name.replace(/\W+/g, '-')).catch(() => '') : '';
      // Its page is left for a blank one before its log is read: still running (story and traffic timers), it logged
      // into the next check's, which then failed for it. The window goes back to its usual size too (a check that
      // failed before setting it back left the next ones on a phone-sized page).
      await page.cdp('Page.navigate', {url: 'about:blank'}).catch(() => {});
      await page.cdp('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}).catch(() => {});
      problems.push(...errors());
      // A check cut short by its browser dying keeps no time (a near-0 s time made it look short to the next run).
      const r = results[index] = {name: scenario.name, problems, shot, time: page.gone ? 0 : (Date.now() - t0) / 1000};
      console.log(`${r.problems.length ? '✗' : '✓'} ${r.name} (${r.time.toFixed(1)} s)${r.problems.length ? `\n    ${r.problems.join('\n    ')}${r.shot ? `\n    screenshot: ${r.shot}` : ''}` : ''}`);
      // Its browser died: the checks left go to the other browsers (this one failed each of them at once).
      if (page.gone) { console.error('a browser died; its remaining checks go to the others'); break; }
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
