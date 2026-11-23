import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// The building is about 900 small meshes, most of which nothing addresses one by one: each floor's static meshes of
// the same look (and type, shadow casting and exterior flag) become one mesh in the floor's own space. Fewer draw
// calls (the building was ~600 a frame), the same picture, the same cutaway clipping and exploded view. Left as they
// are: anything the page finds or changes by itself (devices, doors and what swings with them, rooms, the pond, the
// lift doors, the solar panels, roofs and ceilings), meshes with children, several materials or morph targets.
const KEEP_NAMES = /koi_pond|Courtyard_water|lift_doors|solar_modules/;
// (A door's frame carries its door's id but stays put: only what hangs from its hinge, `deviceKind`, swings.)
const KEEP_DATA = [
  'deviceKind',
  'roomId',
  'room',
  'deviceIndicator',
  'insightRoom',
  'simulation',
  'ceilingScope',
  'arrivalCameras',
  'parking',
  'receptionSign',
];
const KEEP_TYPES = new Set(['roof', 'ceiling', 'device', 'water']);
export function mergeStaticMeshes(floors) {
  const look = (m) =>
    [
      m.type,
      m.color?.getHexString(),
      m.emissive?.getHexString(),
      m.emissiveIntensity,
      m.map?.uuid,
      m.bumpMap?.uuid,
      m.bumpScale,
      m.alphaMap?.uuid,
      m.roughness,
      m.metalness,
      m.transparent,
      m.opacity,
      m.side,
      m.alphaTest,
      m.depthWrite,
      m.vertexColors,
      m.flatShading,
      m.polygonOffset,
      m.polygonOffsetFactor,
      m.polygonOffsetUnits,
    ].join('|');
  const toFloor = new THREE.Matrix4();
  for (const root of floors) {
    root.updateMatrixWorld(true);
    toFloor.copy(root.matrixWorld).invert();
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh || o === root) return;
      // Its type, as the loading below works it out (its own, or its nearest typed parent's).
      let type = o.userData.type,
        held = false;
      for (let p = o; p && p !== root; p = p.parent) {
        if (KEEP_DATA.some((k) => p.userData[k] != null) || KEEP_NAMES.test(p.name)) held = true;
        if (!type && p.userData.type) type = p.userData.type;
      }
      if (
        held ||
        KEEP_TYPES.has(type) ||
        o.children.length ||
        Array.isArray(o.material) ||
        Object.keys(o.geometry.morphAttributes).length
      )
        return;
      const g = o.geometry,
        key = [
          look(o.material),
          type,
          Boolean(o.userData.exterior),
          o.castShadow,
          o.receiveShadow,
          o.renderOrder,
          o.visible,
          Object.keys(g.attributes).sort().join(),
          Boolean(g.index),
        ].join('#');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({o, type});
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const parts = list.map(({o}) =>
        o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toFloor, o.matrixWorld)),
      );
      const merged = mergeGeometries(parts);
      for (const g of parts) g.dispose();
      if (!merged) continue;
      const first = list[0].o,
        mesh = new THREE.Mesh(merged, first.material);
      mesh.name = `${root.name}_static_${list[0].type || 'part'}`;
      mesh.userData = {type: list[0].type, merged: list.length, ...(first.userData.exterior ? {exterior: true} : {})};
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      for (const {o} of list) {
        o.removeFromParent();
        o.geometry.dispose();
      }
      root.add(mesh);
    }
  }
}
