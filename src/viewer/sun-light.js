import * as THREE from 'osd/node_modules/three/build/three.module.js';

// The sun and the sky's light, and the sun's shadows (daylight.js moves them with the hour).
export function createSunLight(scene, {shadowSize}) {
  const hemisphere = new THREE.HemisphereLight(0xebf6ff, 0x7b8066, 1.05);
  scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffe7ba, 3.2);
  key.position.set(-18, 35, 28);
  key.castShadow = true;
  // `shadowSize` 4096 (a desktop): about 2 cm a texel over the site, so a thin thing (the barrier's 11 cm arm, a post)
  // keeps its shadow; at 2048 with a wider blur and offset, those washed out to a faint smudge or nothing.
  key.shadow.mapSize.set(shadowSize, shadowSize);
  Object.assign(key.shadow.camera, {left: -42, right: 42, top: 38, bottom: -38, near: 0.5, far: 110});
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 1.5;
  scene.add(key);
  // The sun's shadows cover the site: the building, the car park out to its west hedge and trees, and the street beside
  // them (not the street lamps far along it, which would thin the map out). A fixed box around the building's centre
  // left the west half of the car park without shadows. Fitted around the site in the sun's own view at each sun step
  // (after applySky, which points the light from the origin), so whatever the sun's angle every shadow the site casts
  // is on the map; deep enough for the longest (low sun), the bias kept at about 2.7 cm whatever the depth.
  // Up to 32 m: the explore page's exploded view raises the top floor about 10 m above the roof's 19 m.
  const SHADOW_SITE = new THREE.Box3(new THREE.Vector3(-66, 0, -22), new THREE.Vector3(26, 32, 31)),
    siteCentre = SHADOW_SITE.getCenter(new THREE.Vector3());
  const corner = new THREE.Vector3();
  const fitShadow = () => {
    const cam = key.shadow.camera;
    key.target.position.copy(siteCentre);
    key.target.updateMatrixWorld();
    // Out along the same direction, far enough that the whole site is in front of the shadow camera.
    key.position.normalize().multiplyScalar(150).add(siteCentre);
    key.updateMatrixWorld();
    cam.position.copy(key.position);
    cam.lookAt(siteCentre);
    cam.updateMatrixWorld();
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner
        .set(
          i & 1 ? SHADOW_SITE.max.x : SHADOW_SITE.min.x,
          i & 2 ? SHADOW_SITE.max.y : SHADOW_SITE.min.y,
          i & 4 ? SHADOW_SITE.max.z : SHADOW_SITE.min.z,
        )
        .applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, corner.x);
      x1 = Math.max(x1, corner.x);
      y0 = Math.min(y0, corner.y);
      y1 = Math.max(y1, corner.y);
      z0 = Math.min(z0, corner.z);
      z1 = Math.max(z1, corner.z);
    }
    const sinElevation = Math.max(0.1, (key.position.y - siteCentre.y) / key.position.distanceTo(siteCentre));
    Object.assign(cam, {
      left: x0,
      right: x1,
      bottom: y0,
      top: y1,
      near: Math.max(0.5, -z1 - 1),
      far: -z0 + SHADOW_SITE.max.y / sinElevation + 1,
    });
    cam.updateProjectionMatrix();
    key.shadow.bias = -0.027 / (cam.far - cam.near);
  };
  const fill = new THREE.DirectionalLight(0xc9e2ed, 0.6);
  fill.position.set(-30, 20, -20);
  scene.add(fill);
  return {hemisphere, key, fill, fitShadow};
}
