// Low-poly cars built from shared geometry: one body shape, glass, wheels, lights, two plates.
// A car faces local +Z and sits on y = 0.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

export const CAR_COLORS = ['#f2f1ec', '#b9bec2', '#22262b', '#6d747a', '#2f5d9a', '#b8322e', '#33584a', '#cdbb98', '#1f3150'];
export const CAR = {length: 4.4, width: 1.8, frontPlateZ: 2.24, plateY: .52};

function profileGeometry(points, depth, bevel) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4});
  // Shape lies in XY (x = forward); extrusion runs along Z. Turn so forward is +Z and width is X.
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const body = profileGeometry([[-2.15, .3], [2.15, .3], [2.17, .7], [1.95, .84], [.8, .94], [-1.5, .96], [-2.1, .9], [-2.17, .7]], 1.66, .06);
  const glass = profileGeometry([[.82, .9], [-1.55, .92], [-1.32, 1.36], [.05, 1.38]], 1.5, .03);
  const roof = profileGeometry([[-1.27, 1.33], [.02, 1.35], [-.04, 1.44], [-1.2, 1.43]], 1.46, .02);
  const wheel = new THREE.CylinderGeometry(.34, .34, .26, 16).rotateZ(Math.PI / 2);
  const wheels = mergeGeometries([[.82, 1.35], [-.82, 1.35], [.82, -1.38], [-.82, -1.38]].map(([x, z]) => wheel.clone().translate(x, .34, z)));
  wheel.dispose();
  const lamp = (x, z, w = .34, h = .1) => new THREE.BoxGeometry(w, h, .05).translate(x, .74, z);
  const head = mergeGeometries([lamp(.6, 2.19), lamp(-.6, 2.19)]);
  const tail = mergeGeometries([lamp(.62, -2.19, .3, .12), lamp(-.62, -2.19, .3, .12)]);
  const plate = new THREE.PlaneGeometry(.62, .3);
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 64;
  const c = blobCanvas.getContext('2d'), g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(20,30,35,.55)'); g.addColorStop(1, 'rgba(20,30,35,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const blobTexture = new THREE.CanvasTexture(blobCanvas);
  const blob = new THREE.PlaneGeometry(2.5, 5.1).rotateX(-Math.PI / 2);
  shared = {
    body, glass, roof, wheels, head, tail, plate, blob,
    bodyMaterials: CAR_COLORS.map(color => new THREE.MeshStandardMaterial({color, roughness: .32, metalness: .45})),
    glassMaterial: new THREE.MeshStandardMaterial({color: '#1e2a33', roughness: .12, metalness: .6}),
    wheelMaterial: new THREE.MeshStandardMaterial({color: '#1b1d20', roughness: .85}),
    headMaterial: new THREE.MeshStandardMaterial({color: '#fff8e0', emissive: '#fff3c4', emissiveIntensity: .35}),
    tailMaterial: new THREE.MeshStandardMaterial({color: '#a3191c', emissive: '#d1262b', emissiveIntensity: .25}),
    blobMaterial: new THREE.MeshBasicMaterial({map: blobTexture, transparent: true, depthWrite: false}),
    blobTexture,
  };
  return shared;
}

const plateCache = new Map();
export function plateTexture(plate, province) {
  const id = `${plate}|${province}`;
  if (plateCache.has(id)) return plateCache.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = 248; canvas.height = 120;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fbfbf7'; c.fillRect(0, 0, 248, 120);
  c.strokeStyle = '#1d232a'; c.lineWidth = 6; c.strokeRect(5, 5, 238, 110);
  c.fillStyle = '#121820'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 54px "OSD Thai", "Noto Sans Thai", sans-serif'; c.fillText(plate, 124, 48, 220);
  c.font = '500 22px "OSD Thai", "Noto Sans Thai", sans-serif'; c.fillText(province || '', 124, 94, 220);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({map: texture, toneMapped: false});
  plateCache.set(id, material);
  return material;
}

export function createCar({plate, province, color = 0}) {
  const p = sharedParts();
  const car = new THREE.Group();
  car.name = `Demo_car_${plate}`;
  const add = (geo, mat, cast = false) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = cast; car.add(m); return m; };
  add(p.body, p.bodyMaterials[color % CAR_COLORS.length]);
  add(p.roof, p.bodyMaterials[color % CAR_COLORS.length]);
  add(p.glass, p.glassMaterial);
  add(p.wheels, p.wheelMaterial);
  add(p.head, p.headMaterial);
  add(p.tail, p.tailMaterial);
  const plateMaterial = plateTexture(plate, province);
  const front = add(p.plate, plateMaterial); front.position.set(0, CAR.plateY, CAR.frontPlateZ);
  const back = add(p.plate, plateMaterial); back.position.set(0, CAR.plateY, -CAR.frontPlateZ); back.rotation.y = Math.PI;
  const blob = new THREE.Mesh(p.blob, p.blobMaterial); blob.position.y = .015; blob.renderOrder = -1; car.add(blob);
  car.userData = {plate, province, frontPlate: front};
  return car;
}

// Head and tail lamps glow after dark.
export function setCarLights(night) {
  const p = sharedParts();
  p.headMaterial.emissiveIntensity = night ? 2.4 : .35;
  p.tailMaterial.emissiveIntensity = night ? 1.6 : .25;
}

export function disposeCars() {
  if (!shared) return;
  for (const k of ['body', 'glass', 'roof', 'wheels', 'head', 'tail', 'plate', 'blob']) shared[k].dispose();
  for (const m of shared.bodyMaterials) m.dispose();
  for (const k of ['glassMaterial', 'wheelMaterial', 'headMaterial', 'tailMaterial', 'blobMaterial', 'blobTexture']) shared[k].dispose();
  for (const m of plateCache.values()) { m.map.dispose(); m.dispose(); }
  plateCache.clear();
  shared = null;
}
