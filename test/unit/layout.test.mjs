// The car park's layout as built in 3D (lot3d.js, built in Node with no renderer): nothing solid stands in the lanes.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {createLot} from 'osd/parking/lot3d.js';
import {buildStalls, DRIVE} from 'osd/parking/layout.js';

test('nothing stands in the driveway: the booth and light poles are clear of the lanes', () => {
  const scene = new THREE.Scene(), lot = createLot({scene, stalls: buildStalls(), schedule() {}});
  scene.updateMatrixWorld(true);
  const gate = scene.getObjectByName('Demo_main_barrier'), blocking = [], v = new THREE.Vector3();
  lot.root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let q = o; q; q = q.parent) if (q === gate) return; // the barrier and its cameras stand at the lane edges
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      // Taller than a kerb, over the driveway's lanes (z 13.6–18.8), west of the building.
      if (v.y > .8 && v.z > DRIVE.north + .5 && v.z < DRIVE.south - .5 && v.x > -58 && v.x < -12) { blocking.push(`${o.name || 'mesh'} at x ${v.x.toFixed(1)} z ${v.z.toFixed(1)}`); return; }
    }
  });
  assert.deepEqual(blocking, []);
});
