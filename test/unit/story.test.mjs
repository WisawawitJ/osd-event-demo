// The parking story, played on the headless world: every step, both branches, and what a presenter can do mid-way.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {STORY} from 'osd/parking/sim.js';
import {parking} from './world.mjs';

const events = (w, plate) => w.sim.state.events.filter(e => e.plate === plate).map(e => e.kind);
const storyRequest = w => w.sim.state.requests.find(q => q.visitor.name === STORY.visitor.name);

test('the story plays end to end on auto-advance: request, approval, the visitor in and out, the unknown car denied', async () => {
  const w = parking();
  const done = w.playStory({auto: true});
  let result;
  done.then(r => { result = r; });
  assert.ok(await w.until(() => result, 600000), 'the story finished');
  assert.equal(result, 'done');
  assert.equal(storyRequest(w)?.status, 'approved');
  assert.ok(events(w, STORY.plate).includes('entry') && events(w, STORY.plate).includes('exit'), `visitor in and out (${events(w, STORY.plate)})`);
  assert.ok(events(w, STORY.unknown.plate).includes('denied'), 'the unknown car denied');
  w.dispose();
});
