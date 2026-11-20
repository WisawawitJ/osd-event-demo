// Low-poly cars, four draw calls each and no per-car geometry:
//   body (body + roof, one material per paint colour), details (glass + wheels, vertex colours),
//   decals (both plates and the four lamps, unlit, one small texture per plate) and a soft blob shadow.
// A car faces local +Z and sits on y = 0.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const CAR_COLORS = ['#f2f1ec', '#b9bec2', '#22262b', '#6d747a', '#2f5d9a', '#b8322e', '#33584a', '#cdbb98', '#1f3150'];
export const CAR = {length: 4.4, width: 1.8, frontPlateZ: 2.24, plateY: .52};

// Plate texture layout: the plate fills the top 120 px; a lamp strip (head left, tail right) sits below it.
const TEX_W = 256, TEX_H = 144, PLATE_W = 248, PLATE_H = 120;

function profileGeometry(points, depth, bevel) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, {depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4});
  // Shape lies in XY (x = forward); extrusion runs along Z. Turn so forward is +Z and width is X.
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}
const tint = (geo, color) => {
  const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
// Every vertex of a lamp samples one point of the lamp strip.
const lampUv = (geo, u, v) => { const n = geo.attributes.position.count, a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = u; a[i * 2 + 1] = v; } geo.setAttribute('uv', new THREE.BufferAttribute(a, 2)); return geo; };
const strip = (TEX_H - PLATE_H) / 2 / TEX_H;
const flat = g => (g.index ? g.toNonIndexed() : g);

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const body = mergeGeometries([
    profileGeometry([[-2.15, .3], [2.15, .3], [2.17, .7], [1.95, .84], [.8, .94], [-1.5, .96], [-2.1, .9], [-2.17, .7]], 1.66, .06),
    profileGeometry([[-1.27, 1.33], [.02, 1.35], [-.04, 1.44], [-1.2, 1.43]], 1.46, .02),
  ].map(flat));
  const wheel = new THREE.CylinderGeometry(.34, .34, .26, 14).rotateZ(Math.PI / 2);
  const wheelFlat = flat(wheel);
  const details = mergeGeometries([
    tint(flat(profileGeometry([[.82, .9], [-1.55, .92], [-1.32, 1.36], [.05, 1.38]], 1.5, .03)), '#1e2a33'),
    ...[[.82, 1.35], [-.82, 1.35], [.82, -1.38], [-.82, -1.38]].map(([x, z]) => tint(wheelFlat.clone().translate(x, .34, z), '#1b1d20')),
  ]);
  wheel.dispose(); wheelFlat.dispose();
  const plateGeo = new THREE.PlaneGeometry(.62, .3);
  const uv = plateGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PLATE_W / TEX_W, 1 - (1 - uv.getY(i)) * PLATE_H / TEX_H);
  const front = plateGeo.clone().translate(0, CAR.plateY, CAR.frontPlateZ);
  const back = plateGeo.clone().rotateY(Math.PI).translate(0, CAR.plateY, -CAR.frontPlateZ);
  plateGeo.dispose();
  const lamp = (x, z, w, h, u) => lampUv(flat(new THREE.BoxGeometry(w, h, .05)).translate(x, .74, z), u, strip);
  const decals = mergeGeometries([flat(front), flat(back), lamp(.6, 2.19, .34, .1, .25), lamp(-.6, 2.19, .34, .1, .25), lamp(.62, -2.19, .3, .12, .75), lamp(-.62, -2.19, .3, .12, .75)]
    .map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 64;
  const c = blobCanvas.getContext('2d'), g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(20,30,35,.55)'); g.addColorStop(1, 'rgba(20,30,35,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const blobTexture = new THREE.CanvasTexture(blobCanvas);
  const blob = new THREE.PlaneGeometry(2.5, 5.1).rotateX(-Math.PI / 2);
  shared = {
    body, details, decals, blob,
    bodyMaterials: CAR_COLORS.map(color => new THREE.MeshStandardMaterial({color, roughness: .32, metalness: .45})),
    detailMaterial: new THREE.MeshStandardMaterial({vertexColors: true, roughness: .3, metalness: .5}),
    // The soft shadow sits on the road; the depth offset stops it flickering against the asphalt and paint.
    blobMaterial: new THREE.MeshBasicMaterial({map: blobTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12}),
    blobTexture,
  };
  return shared;
}

const plateCache = new Map();
function plateTexture(plate, province) {
  const id = `${plate}|${province}`;
  if (plateCache.has(id)) return plateCache.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W; canvas.height = TEX_H;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fbfbf7'; c.fillRect(0, 0, PLATE_W, PLATE_H);
  c.strokeStyle = '#1d232a'; c.lineWidth = 6; c.strokeRect(5, 5, PLATE_W - 10, PLATE_H - 10);
  c.fillStyle = '#121820'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 54px "OSD Thai", "Noto Sans Thai", sans-serif'; c.fillText(plate, PLATE_W / 2, 48, 220);
  c.font = '500 22px "OSD Thai", "Noto Sans Thai", sans-serif'; c.fillText(province || '', PLATE_W / 2, 94, 220);
  c.fillStyle = '#fff6dc'; c.fillRect(0, PLATE_H, TEX_W / 2, TEX_H - PLATE_H);
  c.fillStyle = '#c62a2e'; c.fillRect(TEX_W / 2, PLATE_H, TEX_W / 2, TEX_H - PLATE_H);
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
  // Parts never move inside the car, and the car's own matrix is set when it is placed.
  car.matrixAutoUpdate = false;
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.matrixAutoUpdate = false; car.add(m); return m; };
  add(p.body, p.bodyMaterials[color % CAR_COLORS.length]);
  add(p.details, p.detailMaterial);
  add(p.decals, plateTexture(plate, province)).receiveShadow = false;
  const blob = add(p.blob, p.blobMaterial);
  blob.position.y = .025; blob.updateMatrix(); blob.renderOrder = -1; blob.receiveShadow = false;
  car.userData = {plate, province};
  return car;
}

export function disposeCars() {
  if (!shared) return;
  for (const k of ['body', 'details', 'decals', 'blob']) shared[k].dispose();
  for (const m of shared.bodyMaterials) m.dispose();
  for (const k of ['detailMaterial', 'blobMaterial', 'blobTexture']) shared[k].dispose();
  for (const m of plateCache.values()) { m.map.dispose(); m.dispose(); }
  plateCache.clear();
  shared = null;
}
