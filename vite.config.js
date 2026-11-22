// Vite+ (`vp`) for the tools only: lint (Oxlint), format (Oxfmt) and the Node tests (Vitest). The page itself is not
// built or served by Vite: `npm start` serves the files as they are (scripts/serve.mjs).
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite-plus';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
// Not ours, or not code: the vendored three.js, the building model, screenshots, reference material.
const IGNORE = ['vendor/**', 'model/**', 'shots/**', 'reference/**', 'dev/**', 'node_modules/**'];

export default defineConfig({
  // The page's import map (index.html), for the tests: "osd/viewer/…" and "osd/parking/…" are src/, three.js is vendored.
  resolve: {
    alias: [
      {find: /^osd\/viewer\//, replacement: here('./src/viewer/')},
      {find: /^osd\/parking\//, replacement: here('./src/parking/')},
      {find: /^osd\/node_modules\/three\//, replacement: here('./vendor/three/')},
    ],
  },
  test: {
    include: ['test/unit/**/*.test.mjs'],
    setupFiles: ['./test/unit/setup.mjs'],
    environment: 'node',
    // One file at a time, as before (a simulated day per file is CPU-heavy; the laptop stays responsive).
    fileParallelism: false,
    // Some tests run whole simulated days: seconds of real time each.
    testTimeout: 120000,
  },
  lint: {
    ignorePatterns: IGNORE,
    rules: {
      // `for (const x of [...set])` here is on purpose: the loop changes the set it walks (listeners that unsubscribe,
      // cars removed), or walks a live DOM attribute list it edits.
      'unicorn/no-useless-spread': 'off',
      // `await null` yields to the queued microtasks (the engine lets promise chains settle between timers).
      'unicorn/no-unnecessary-await': 'off',
    },
  },
  fmt: {
    ignorePatterns: IGNORE,
    singleQuote: true,
    printWidth: 120,
    bracketSpacing: false,
  },
});
