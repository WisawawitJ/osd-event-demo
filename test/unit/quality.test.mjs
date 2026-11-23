// How finely the 3D view is drawn on a slow computer (quality.js).
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createQuality} from 'osd/viewer/quality.js';

const run = (quality, ms, frames = 2000) => {
  const seen = [];
  for (let i = 0; i < frames; i++) if (quality.frame(ms)) seen.push(`${quality.ratio}${quality.light ? ' light' : ''}`);
  return seen;
};

test('a computer that keeps up is left alone, hiccups and all', () => {
  const q = createQuality({devicePixels: 1.5});
  for (let i = 0; i < 5000; i++) assert.equal(q.frame(i % 100 ? 16.7 : 400), false);
  assert.equal(q.ratio, 1.5);
});

test('a slow one steps down to 1×, then light, then below; a 30 Hz screen stays at 1×', () => {
  assert.deepEqual(run(createQuality({devicePixels: 1.5}), 33.4), ['1.25', '1', '1 light']);
  assert.deepEqual(run(createQuality({devicePixels: 1}), 60), ['1 light', '0.8 light', '0.65 light', '0.5 light']);
});

test('at 300 ms a frame the first step comes within three seconds', () => {
  const q = createQuality({devicePixels: 1});
  assert.equal(run(q, 300, 10).length, 1);
});

test('the light page starts light and steps on from there; test pages never step', () => {
  const q = createQuality({devicePixels: 1.25, light: true});
  assert.deepEqual([q.ratio, q.light], [0.85, true]);
  assert.deepEqual(run(q, 60), ['0.8 light', '0.65 light', '0.5 light']);
  assert.deepEqual(run(createQuality({scale: 0.5, fixed: true}), 900), []);
});

test('the flight’s ratio is never above the view’s own', () => {
  for (const devicePixels of [0.5, 1, 1.5])
    for (const light of [false, true]) {
      const q = createQuality({devicePixels, light});
      run(q, 100);
      assert.ok(q.motionRatio <= q.ratio);
    }
});
