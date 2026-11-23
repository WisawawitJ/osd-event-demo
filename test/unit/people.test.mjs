// The meeting room's people (people.js): one on each chair, sitting on the floor's level, under the ceiling.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {createPeople} from 'osd/viewer/people.js';
import {MEETING_PEOPLE, SEATS} from 'osd/viewer/building.js';

test('as many as the radar counts, each on a chair, facing the table, feet on the floor', () => {
  const people = createPeople({seats: SEATS});
  assert.equal(people.figures.length, MEETING_PEOPLE);
  people.pose(12.3);
  people.figures.forEach(({figure}, i) => {
    figure.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(figure),
      ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(figure.quaternion);
    assert.ok(
      Math.abs(box.min.y) < 0.03 && box.max.y > 1.25 && box.max.y < 1.5,
      `seat ${i}: ${box.min.y}..${box.max.y}`,
    );
    assert.ok(ahead.x * (-4 - SEATS[i].x) > 0.9, 'towards the table');
    for (const other of people.figures.slice(i + 1))
      assert.ok(figure.position.distanceTo(other.figure.position) > 1, 'a chair each');
  });
  people.dispose();
});
