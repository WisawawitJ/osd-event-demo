// Koi that swim. The model's 22 fish (two merged meshes, every fish the same 52-vertex shape, alike at both ends) each
// circle slowly near where they were placed, turning as they go and waving their tail. All of it is done in the
// vertex shader from one time uniform, so moving them costs no per-fish work on the CPU, only redraws: those run at
// FPS (not the screen's rate), and only while the pond is in view, the page is visible and the demo is not paused.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {demoNow, isPaused} from 'osd/parking/clock.js';

const FISH_VERTICES = 52, FPS = 15, NEAR = 45; // redraws a second; the pond counts as in view within NEAR metres
// Per fish: where it was placed (x, z), its body direction and its loop (radius, direction, speed, phase).
// Each fish gets the widest loop (and the turning direction) that keeps its whole body in the water all the way
// round, tested against the pond's water surface (`inWater`); a fish without room just waves its tail in place.
const LOOPS = [.45, .36, .28, .2, .12], HALF = .27; // loop radii to try (m); half a fish's length (m)
function loopFits(cx, cz, heading, radius, turn, inWater) {
  const ax = Math.cos(heading), az = Math.sin(heading), sx = -az * turn, sz = ax * turn;
  const ox = cx + sx * radius, oz = cz + sz * radius; // the loop's centre
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * 2 * Math.PI * turn, k = Math.cos(a), s = Math.sin(a);
    for (const b of [-HALF, 0, HALF]) {
      const x = cx - ox + ax * b, z = cz - oz + az * b; // same turn as the shader's: x' = k x - s z, z' = s x + k z
      if (!inWater(ox + k * x - s * z, oz + s * x + k * z)) return false;
    }
  }
  return true;
}
function fishAttributes(geometry, random, inWater) {
  const p = geometry.attributes.position, count = p.count / FISH_VERTICES;
  const home = new Float32Array(p.count * 4), loop = new Float32Array(p.count * 4);
  for (let f = 0; f < count; f++) {
    let cx = 0, cz = 0, sxx = 0, szz = 0, sxz = 0;
    for (let i = f * FISH_VERTICES; i < (f + 1) * FISH_VERTICES; i++) { cx += p.getX(i); cz += p.getZ(i); }
    cx /= FISH_VERTICES; cz /= FISH_VERTICES;
    for (let i = f * FISH_VERTICES; i < (f + 1) * FISH_VERTICES; i++) { const x = p.getX(i) - cx, z = p.getZ(i) - cz; sxx += x * x; szz += z * z; sxz += x * z; }
    const heading = .5 * Math.atan2(2 * sxz, sxx - szz); // the body's long axis
    const first = random() < .5 ? -1 : 1;
    let radius = 0, turn = first;
    for (const r of LOOPS) { const t = [first, -first].find(t => loopFits(cx, cz, heading, r, t, inWater)); if (t) { radius = r; turn = t; break; } }
    const speed = radius ? (.1 + random() * .08) / radius : 0, phase = random() * 6.283;
    for (let i = f * FISH_VERTICES; i < (f + 1) * FISH_VERTICES; i++) { home.set([cx, cz, heading, 0], i * 4); loop.set([radius, turn, speed, phase], i * 4); }
  }
  geometry.setAttribute('koiHome', new THREE.BufferAttribute(home, 4));
  geometry.setAttribute('koiLoop', new THREE.BufferAttribute(loop, 4));
  // A fish may swim up to a loop's width from where it was placed: keep it from being culled at the edge of the view.
  geometry.computeBoundingSphere(); geometry.boundingSphere.radius += 1;
}

const SWIM = /* glsl */`
  {
    vec2 c = koiHome.xy; float heading = koiHome.z;
    float radius = koiLoop.x, turn = koiLoop.y, angle = koiTime * koiLoop.z * turn;
    vec2 ahead = vec2(cos(heading), sin(heading)), side = vec2(-ahead.y, ahead.x) * turn;
    vec2 rel = transformed.xz - c;
    // The tail half sways from side to side, more towards its tip.
    float along = dot(rel, ahead);
    rel += side * sin(koiTime * 5.5 + koiLoop.w * 3.0 + along * 10.0) * .045 * smoothstep(.02, .26, -along);
    // Round a circle that passes through where the fish was placed, heading along its body; the fish turns with it.
    float s = sin(angle), k = cos(angle);
    mat2 spin = mat2(k, s, -s, k);
    vec2 centre = c + side * radius;
    transformed.xz = centre + spin * (c - centre) + spin * rel;
  }
`;

export function createKoi({model, camera, schedule}) {
  const time = {value: 0};
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const fish = [];
  // The water surface, in the pond floor's own space (the pond and fish meshes sit at the floor's origin).
  const water = model.getObjectByName('Floor_1_koi_pond_0'), ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  model.updateMatrixWorld(true);
  const inWater = (x, z) => {
    if (!water) return true;
    ray.set(water.parent.localToWorld(from.set(x, 5, z)), down);
    return ray.intersectObject(water, false).length > 0;
  };
  model.traverse(object => {
    if (!object.isMesh || !/_koi_(?!pond)/.test(object.name)) return;
    fishAttributes(object.geometry, random, inWater);
    // Own material (the original may be shared with other meshes, which have no fish attributes).
    const material = object.material.clone();
    material.onBeforeCompile = shader => {
      shader.uniforms.koiTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 koiHome;\nattribute vec4 koiLoop;\nuniform float koiTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWIM}`);
    };
    material.customProgramCacheKey = () => 'koi';
    object.material = material;
    object.castShadow = false; // a shadow drawn from the unmoved shape would not follow the fish
    fish.push(object);
  });
  if (!fish.length) return {dispose() {}};
  // The pond's extent in its floor's own space (the fish meshes sit at the floor's origin); the floor can move.
  const pond = new THREE.Box3();
  for (const object of fish) { object.geometry.computeBoundingBox(); pond.union(object.geometry.boundingBox); }
  pond.expandByScalar(1);
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), centre = new THREE.Vector3();
  const shown = object => { for (let o = object; o; o = o.parent) if (!o.visible) return false; return true; };
  function inView() {
    if (document.hidden || isPaused() || !shown(fish[0])) return false;
    fish[0].parent.updateWorldMatrix(true, false);
    const box = pond.clone().applyMatrix4(fish[0].parent.matrixWorld);
    if (box.getCenter(centre).distanceTo(camera.position) > NEAR) return false;
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return frustum.intersectsBox(box);
  }
  let frame = 0, last = 0;
  const tick = now => {
    frame = requestAnimationFrame(tick);
    if (now - last < 1000 / FPS - 2) return;
    last = now;
    if (inView()) schedule();
  };
  // Their swim is read from the clock as they are drawn (simulation time: they stop when the demo is paused), so a frame
  // shows them where they are at that moment, not where they were at the last of their own (throttled) frames.
  for (const object of fish) object.onBeforeRender = () => { time.value = demoNow() / 1000; };
  frame = requestAnimationFrame(tick);
  return {dispose() { cancelAnimationFrame(frame); for (const object of fish) object.material.dispose(); }};
}
