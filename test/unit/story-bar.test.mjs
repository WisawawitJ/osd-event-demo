// A press on a story's bar (story-bar.js), without a page.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {createPress} from 'osd/core/story-bar.js';

test('a button that changed under the finger is not pressed (Pause had become Play: the story played again)', () => {
  const press = createPress();
  press.down('pointer', 'pause');
  assert.ok(!press.isClickOf('pointer', 'play'));
  press.down('pointer', 'play');
  assert.ok(press.isClickOf('pointer', 'play'));
  press.down('key', 'pause');
  assert.ok(!press.isClickOf('key', 'play'));
  press.down('pointer', 'pause');
  press.down('key', 'pause');
  assert.ok(press.isClickOf('key', 'pause'));
  assert.ok(!press.isClickOf('pointer', 'resume'), 'the keyboard used under a finger leaves its press');
});

test('a click whose own press was not seen counts (a screen reader, after a touch that was cancelled or dragged off)', () => {
  const press = createPress();
  assert.ok(press.isClickOf('key', 'next'));
  press.down('pointer', 'pause');
  assert.ok(press.isClickOf('key', 'next'));
  press.down('pointer', 'pause');
  press.cancel('key');
  assert.ok(!press.isClickOf('pointer', 'next'), 'the focus moving as a finger lands leaves its press');
  press.down('pointer', 'pause');
  press.cancel('pointer');
  assert.ok(press.isClickOf('pointer', 'next'));
});
