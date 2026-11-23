import * as THREE from 'osd/node_modules/three/build/three.module.js';

// Whose a ceiling device (a light, an AC unit) is: its room's id, or undefined.
export function roomOf(object) {
  for (let o = object; o; o = o.parent) if (o.userData.roomId) return o.userData.roomId;
}

// A floor's lights share one mesh of rims: the one around `light` becomes a mesh of its own, its room's, beside it. (With
// the room's lamp shown alone, the other rooms' rims hung in the air with it.)
export function splitRim(rim, light) {
  const middle = new THREE.Box3().setFromObject(light).getCenter(new THREE.Vector3()),
    {index, attributes} = rim.geometry,
    point = new THREE.Vector3(),
    own = [],
    rest = [];
  for (let i = 0; i < index.count; i += 3) {
    point.fromBufferAttribute(attributes.position, index.getX(i)).applyMatrix4(rim.matrixWorld);
    const near = Math.hypot(point.x - middle.x, point.z - middle.z) < 1.5;
    (near ? own : rest).push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  const geometry = rim.geometry.clone();
  geometry.setIndex(own);
  rim.geometry.setIndex(rest);
  const part = new THREE.Mesh(geometry, rim.material);
  part.name = `${rim.name}_${light.userData.roomId}`;
  part.userData = {...rim.userData, roomId: light.userData.roomId};
  part.castShadow = rim.castShadow;
  part.receiveShadow = rim.receiveShadow;
  part.position.copy(rim.position);
  part.quaternion.copy(rim.quaternion);
  part.scale.copy(rim.scale);
  rim.parent.add(part);
  return part;
}
