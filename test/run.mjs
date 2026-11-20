// Runs the behaviour checks in headless Chromium: `npm test`, or `npm test -- kiosk night` to run matching ones.
// GPU=egl|vulkan|software picks the WebGL back end (default: first hardware one that works).
import {open} from './browser.mjs';
import {scenarios} from './scenarios.mjs';

const filters = process.argv.slice(2).map(f => f.toLowerCase());
const chosen = scenarios.filter(s => !filters.length || filters.some(f => s.name.toLowerCase().includes(f)));
// Software-rendering noise the demo cannot avoid; anything else in the console fails the check.
const NOISE = /GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils: Textures of render targets/;

const started = Date.now();
const {page, close} = await open();
console.log(`WebGL: ${page.renderer}\n`);
let failed = 0;
try {
  for (const scenario of chosen) {
    const t0 = Date.now(), problems = [];
    const expect = (ok, message) => { if (!ok) problems.push(message); };
    try { await scenario.run(page, expect); } catch (error) { problems.push(error.message); }
    problems.push(...page.logs.filter(line => !NOISE.test(line)));
    const time = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    if (problems.length) {
      failed++;
      const shot = await page.shot(scenario.name.replace(/\W+/g, '-')).catch(() => '');
      console.log(`✗ ${scenario.name} (${time})\n    ${problems.join('\n    ')}${shot ? `\n    screenshot: ${shot}` : ''}`);
    } else console.log(`✓ ${scenario.name} (${time})`);
  }
} finally { close(); }
console.log(`\n${chosen.length - failed}/${chosen.length} passed in ${((Date.now() - started) / 1000).toFixed(0)} s`);
process.exit(failed ? 1 : 0);
