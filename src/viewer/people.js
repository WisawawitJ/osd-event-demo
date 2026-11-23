import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// The people in the meeting room: faceless figures sitting at its table, as many as the radar counts (it does not know
// who they are). Stylised: a body in one piece, and a head that turns.

// A limb from `a` to `b` (radii at each end), rounded at both.
const UP = new THREE.Vector3(0, 1, 0);
function limb(a, b, ra, rb = ra) {
  const from = new THREE.Vector3(...a),
    to = new THREE.Vector3(...b),
    along = to.clone().sub(from);
  const tube = new THREE.CylinderGeometry(rb, ra, along.length(), 14, 1, true);
  tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, along.clone().normalize()));
  tube.translate(...from.clone().add(to).multiplyScalar(0.5).toArray());
  return [ball(a, ra), tube, ball(b, rb)];
}
function ball(at, r, scale = [1, 1, 1]) {
  return new THREE.SphereGeometry(r, 18, 12).scale(...scale).translate(...at);
}
function merge(parts) {
  const all = parts.flat(Infinity),
    merged = mergeGeometries(all);
  for (const g of all) g.dispose();
  return merged;
}
// One tone for these parts (as vertex colours, so a figure is one material).
function tone(color, ...parts) {
  const {r, g, b} = new THREE.Color(color);
  for (const part of parts.flat(Infinity)) {
    const n = part.attributes.position.count,
      values = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) values.set([r, g, b], i * 3);
    part.setAttribute('color', new THREE.BufferAttribute(values, 3));
  }
  return parts;
}
const SKIN = '#b4c0cc',
  HAIR = '#26344a',
  TROUSERS = '#2c3d57';

// Sitting on a chair, in metres: x to the side, z towards the table, the floor at 0. The table's edge is 0.48 ahead of
// the seat's middle, its top at 0.78. `hands`: where each rests.
const NECK = [0, 1.13, 0];
function body({hands, top}) {
  const arm = (side, [x, y, z]) => {
    const shoulder = [0.205 * side, 1.02, -0.03],
      elbow = [0.27 * side, 0.8, 0.14],
      hand = [x * side, y, z];
    return [
      tone(top, limb(shoulder, elbow, 0.074, 0.058), limb(elbow, hand, 0.056, 0.042)),
      tone(SKIN, ball(hand, 0.05)),
    ];
  };
  const leg = (side) =>
    tone(
      TROUSERS,
      limb([0.1 * side, 0.6, -0.05], [0.12 * side, 0.58, 0.36], 0.105, 0.08),
      limb([0.12 * side, 0.58, 0.36], [0.12 * side, 0.1, 0.38], 0.076, 0.054),
      limb([0.12 * side, 0.07, 0.38], [0.12 * side, 0.06, 0.52], 0.052, 0.046),
    );
  // The torso: hips, waist, chest and shoulders, flatter front to back than wide.
  const torso = merge(
    tone(
      top,
      limb([0, 0.6, 0], [0, 0.8, 0], 0.175, 0.155),
      limb([0, 0.8, 0], [0, 0.98, 0], 0.155, 0.19),
      limb([-0.145, 1.02, 0], [0.145, 1.02, 0], 0.092),
      limb([0, 1.04, 0], [0, 1.09, 0.01], 0.11, 0.075),
    ),
  );
  torso.scale(1, 1, 0.72).translate(0, 0, -0.04);
  const neck = tone(SKIN, limb([0, 1.08, -0.025], [0, 1.2, 0.005], 0.052));
  return merge([torso, neck, arm(-1, hands[0]), arm(1, hands[1]), leg(-1), leg(1)]);
}
// About the top of the neck, so it turns there. No face.
const HAIRCUTS = {
  short: () => [ball([0, 0.168, -0.02], 0.112, [0.95, 0.9, 1])],
  long: () => [
    ball([0, 0.166, -0.022], 0.116, [0.98, 0.94, 1]),
    limb([0, 0.12, -0.06], [0, -0.07, -0.09], 0.088, 0.062),
  ],
  bun: () => [ball([0, 0.168, -0.02], 0.113, [0.95, 0.9, 1]), ball([0, 0.23, -0.11], 0.052)],
};
const head = (hair) =>
  merge([tone(SKIN, ball([0, 0.125, 0.02], 0.105, [0.86, 1.14, 0.98])), tone(HAIR, HAIRCUTS[hair]())]);

// How each sits, one per seat: hair, height, shirt, and where the hands rest (on the table but for a gesture).
const REST = [0.14, 0.82, 0.53];
const LOOKS = [
  {hair: 'short', height: 1.03, top: '#3f74b5', hands: [REST, REST]},
  {hair: 'long', height: 0.97, top: '#7d9cc0', hands: [REST, [0.2, 0.82, 0.55]]},
  {hair: 'bun', height: 0.98, top: '#4f8f9a', hands: [[0.1, 0.82, 0.5], REST]},
  {
    hair: 'short',
    height: 1,
    top: '#5a7396',
    hands: [
      [0.03, 0.83, 0.5],
      [0.05, 0.82, 0.48],
    ],
  },
  {
    hair: 'short',
    height: 1.04,
    top: '#345f9c',
    hands: [
      [0.16, 0.82, 0.55],
      [0.14, 1.02, 0.36],
    ],
  },
  {hair: 'long', height: 0.98, top: '#6a88ae', hands: [REST, REST]},
];

// A soft dark patch, for the floor under each.
function patchTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d'),
    fade = c.createRadialGradient(64, 64, 6, 64, 64, 64);
  fade.addColorStop(0, 'rgba(255,255,255,1)');
  fade.addColorStop(0.5, 'rgba(255,255,255,.55)');
  fade.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = fade;
  c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// `seats`: {x, z, yaw} in the floor's space, one per person. Drawn before the building's glass, so it shows through it.
export function createPeople({seats}) {
  const materials = [],
    geometries = [],
    patchMap = patchTexture();
  const figures = seats.map(({x, z, yaw}, i) => {
    const {hair, height, top, hands} = LOOKS[i % LOOKS.length];
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      emissive: '#1d3350', // seen in a dark room too
      emissiveIntensity: 0.5,
      transparent: true,
    });
    materials.push(material);
    const figure = new THREE.Group(),
      neck = new THREE.Group(),
      meshes = [];
    const part = (geometry, parent) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = -1;
      meshes.push(mesh);
      mesh.raycast = () => {}; // a tap goes through to the devices behind
      geometries.push(geometry);
      parent.add(mesh);
    };
    part(body({hands, top}), figure);
    neck.position.set(...NECK);
    part(head(hair), neck);
    figure.add(neck);
    // Drawn after the room light's pool, which washes out the shadows of the sun.
    const patchMaterial = new THREE.MeshBasicMaterial({
      color: '#0c1626',
      map: patchMap,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    materials.push(patchMaterial);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.2).rotateX(-Math.PI / 2), patchMaterial);
    geometries.push(patch.geometry);
    patch.position.set(0, 0.07, 0.1);
    patch.renderOrder = 2;
    patch.raycast = () => {};
    figure.add(patch);
    figure.position.set(x, 0, z);
    figure.rotation.y = yaw;
    figure.scale.setScalar(height);
    return {figure, neck, materials: [material, patchMaterial], meshes};
  });
  return {
    figures,
    // Whether this one throws a shadow (all or nothing: a shadow does not fade); true if that changed.
    castShadow({meshes}, on) {
      if (meshes[0].castShadow === on) return false;
      for (const mesh of meshes) mesh.castShadow = on;
      return true;
    },
    // Each looks about, slowly: towards one another and down at the table, on the demo's clock (`seconds`).
    pose(seconds) {
      figures.forEach(({neck}, i) => {
        const t = seconds * 0.55 + i * 2.1;
        neck.rotation.y = 0.42 * Math.sin(t) * Math.sin(t * 0.37 + i);
        neck.rotation.x = 0.1 + 0.09 * Math.sin(t * 0.8 + i * 1.3);
      });
    },
    dispose() {
      for (const {figure} of figures) figure.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      patchMap.dispose();
    },
  };
}
