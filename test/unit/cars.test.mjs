// The car models (cars.js): the traffic, the bays and the plate cameras treat every car alike, so each model has to
// keep to the same footprint.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {carModel, createCar, createCarInstances} from 'osd/parking/cars.js';

test('every model keeps to 4.46 × 1.72 m, its trim a few cm proud of it', () => {
  const scene = new THREE.Scene(),
    root = new THREE.Group();
  scene.add(root);
  const instances = createCarInstances(root, 4);
  const bodies = root.children.filter((m) => m.name.startsWith('Demo_cars_body_'));
  assert.ok(bodies.length >= 5);
  for (const mesh of root.children.filter((m) => /Demo_cars_(body|details)_/.test(m.name))) {
    mesh.geometry.computeBoundingBox();
    const {min, max} = mesh.geometry.boundingBox,
      slack = mesh.name.includes('body') ? 0.09 : 0.18;
    assert.ok(max.x - min.x <= 1.72 + slack + 0.01, `${mesh.name} ${(max.x - min.x).toFixed(2)} m wide`);
    assert.ok(max.z - min.z <= 4.46 + slack + 0.01, `${mesh.name} ${(max.z - min.z).toFixed(2)} m long`);
    assert.ok(min.y >= -0.01, `${mesh.name} above the road`);
  }
  instances.dispose();
});

test('a plate is always the same model, and the car park sees every model', () => {
  assert.equal(carModel('1กก 1111'), carModel('1กก 1111', 7));
  assert.equal(carModel('4ศย 5150'), carModel('4ศย5150'), 'as the gate reads it, spaces or not');
  assert.equal(createCar({plate: '1กก 1111'}).userData.model, carModel('1กก 1111'));
  assert.equal(new Set(Array.from({length: 60}, (_, i) => carModel(`2ขข ${1000 + i}`))).size, 5);
  assert.ok(new Set(Array.from({length: 9}, (_, i) => carModel('', i))).size >= 3, 'through-traffic varies by colour');
});
