// The imagined surroundings of the OSD car park: street, driveway, open-air lot P2, the main
// barrier with two plate cameras, a guard booth, a free-space sign and per-bay indicator lights.
// Presentation only: nothing here is bound to hardware.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries, mergeVertices} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import {DRIVE, GATE, STREET, SITE, Y} from './layout.js';

export function createLot({scene, stalls, schedule}) {
  const root = new THREE.Group();
  root.name = 'Demo_parking';
  scene.add(root);
  const owned = [], materials = [], textures = [];
  const mat = (o) => { const m = new THREE.MeshStandardMaterial({roughness: .9, ...o}); materials.push(m); return m; };
  const basic = (o) => { const m = new THREE.MeshBasicMaterial(o); materials.push(m); return m; };
  const put = (geo, material, {x = 0, y = 0, z = 0, ry = 0, shadow = false, parent = root} = {}) => {
    owned.push(geo);
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = shadow;
    parent.add(m);
    return m;
  };
  const flat = (w, d) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const rect = (x0, x1, z0, z1, y) => flat(x1 - x0, z1 - z0).translate((x0 + x1) / 2, y, (z0 + z1) / 2);

  // Surfaces
  const asphalt = mat({color: '#8d9592'}), street = mat({color: '#6f7774'}), kerb = mat({color: '#cfd3cc'}), paint = basic({color: '#f4f6f2'}), yellow = basic({color: '#e7c34a'});
  const LOT = {west: -60, east: SITE.west - .7, north: -16, south: DRIVE.north};
  put(mergeGeometries([
    rect(LOT.west, LOT.east, LOT.north, LOT.south, Y.road),
    rect(DRIVE.west - 2, DRIVE.east, DRIVE.north - .01, DRIVE.south, Y.road),
    rect(GATE.west - .3, GATE.east + .3, DRIVE.south - .01, STREET.north + .2, Y.road),
  ]), asphalt);
  put(rect(-100, 100, STREET.north, STREET.south, Y.road - .015), street);
  // Pavement either side of the gate mouth
  const pavementY = Y.road + .05;
  put(mergeGeometries([
    new THREE.BoxGeometry(GATE.west - (-100), .1, STREET.north - DRIVE.south).translate((-100 + GATE.west) / 2, pavementY - .05, (DRIVE.south + STREET.north) / 2),
    new THREE.BoxGeometry(100 - GATE.east, .1, STREET.north - DRIVE.south).translate((GATE.east + 100) / 2, pavementY - .05, (DRIVE.south + STREET.north) / 2),
    new THREE.BoxGeometry(200, .1, 1.6).translate(0, pavementY - .05, STREET.south + .8),
  ]), kerb);

  // Line marking: bay separators, street centre dashes, driveway arrows, stop lines and the gate loops.
  const lines = [];
  const line = (x0, z0, x1, z1, w = .12, y = Y.road + .012) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    lines.push(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).rotateY(Math.atan2(x1 - x0, z1 - z0)).translate((x0 + x1) / 2, y, (z0 + z1) / 2));
  };
  for (const s of stalls.filter(s => s.zone === 'P2')) {
    const back = s.x + s.nose * 2.5, front = s.x - s.nose * 2.5;
    line(front, s.z - 1.25, back, s.z - 1.25);
    line(front, s.z + 1.25, back, s.z + 1.25);
    line(back, s.z - 1.25, back, s.z + 1.25);
  }
  for (let x = -96; x < 96; x += 6) line(x, (STREET.north + STREET.south) / 2, x + 3, (STREET.north + STREET.south) / 2, .14, Y.road - .003);
  line(GATE.west, GATE.z - .6, GATE.east, GATE.z - .6, .3);
  line(GATE.west + .1, GATE.z + 1.1, (GATE.entryX + GATE.exitX) / 2, GATE.z + 1.1, .3);
  put(mergeGeometries(lines), paint);
  for (const g of lines) g.dispose();
  // Arrow decals on the driveway
  const arrowShape = new THREE.Shape([[0, 1.3], [.55, .35], [.2, .35], [.2, -1.1], [-.2, -1.1], [-.2, .35], [-.55, .35]].map(([x, y]) => new THREE.Vector2(x, y)));
  const arrow = new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2);
  const arrows = [];
  const placeArrow = (x, z, heading) => arrows.push(arrow.clone().rotateY(heading).translate(x, Y.road + .014, z));
  // Shape points toward -Z before turning; heading follows the route convention (0 = +Z).
  for (const x of [-30, -42, -54]) { placeArrow(x, 17.6, -Math.PI / 2 + Math.PI); placeArrow(x + 4, 14.8, Math.PI / 2 + Math.PI); }
  placeArrow(GATE.entryX, 23.6 - 2.5, 0); placeArrow(GATE.exitX, 16.6 - 2.2, Math.PI);
  put(mergeGeometries(arrows), paint);
  for (const g of arrows) g.dispose();
  arrow.dispose();
  // Detector loops under the barrier
  const loops = [];
  for (const x of [GATE.entryX, GATE.exitX]) for (const z of [GATE.z + 1.6, GATE.z - 1.8]) {
    loops.push(new THREE.RingGeometry(.92, 1.0, 4, 1).rotateZ(Math.PI / 4).scale(1, 1.4, 1).rotateX(-Math.PI / 2).translate(x, Y.road + .013, z));
  }
  put(mergeGeometries(loops), basic({color: '#2b3236'}));
  for (const g of loops) g.dispose();
  // Visitor bays in row A are tinted and labelled.
  const visitorFill = basic({color: '#3d8fb0', transparent: true, opacity: .22, depthWrite: false});
  put(mergeGeometries(stalls.filter(s => s.reserved === 'guest').map(s => rect(s.x - 2.4, s.x + 2.4, s.z - 1.15, s.z + 1.15, Y.road + .011))), visitorFill);
  const vipFill = basic({color: '#7a5bb5', transparent: true, opacity: .2, depthWrite: false});
  put(mergeGeometries(stalls.filter(s => s.reserved === 'vip').map(s => rect(s.x - 2.4, s.x + 2.4, s.z - 1.15, s.z + 1.15, Y.site + .013))), vipFill);

  // Planting in the building model's own style: tall slim trunks under rounded multi-blob canopies in three
  // greens, and hedges as rows of rounded shrubs. All instanced, so the extra greenery costs five draw calls.
  const GREENS = ['#47634b', '#607c4f', '#7d9057'];
  const leafMats = GREENS.map(color => mat({color, roughness: .65}));
  const trunkMat = mat({color: '#776c56', roughness: .65});
  // A smooth low-poly blob, like the model's leaves.
  const blobGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  blobGeo.computeVertexNormals();
  const trunkGeo = new THREE.CylinderGeometry(.08, .12, 1, 7).translate(0, .5, 0);
  owned.push(blobGeo, trunkGeo);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blobs = GREENS.map(() => []), trunkList = [];
  const treeSpots = [[-36.8, -17.6], [-45, -17.6], [-52.4, -17.6], [-28.4, -17.6], [-62, 7], [-62, -5], [-62, 16], [-42, 20.7], [-54, 20.7], [-33.5, 20.7]];
  for (const [x, z] of treeSpots) {
    const h = 3.3 + rand() * .8, r = 1.25 + rand() * .35;
    trunkList.push(m4.compose(v.set(x, Y.road, z), q.identity(), sc.set(1, h + .4, 1)).clone());
    // Five or six overlapping blobs around the crown, cycling through the three greens.
    const n = 5 + Math.round(rand());
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rand(), d = i === 0 ? 0 : r * (.45 + rand() * .3), s0 = r * (i === 0 ? .95 : .62 + rand() * .25);
      blobs[i % 3].push(m4.compose(v.set(x + Math.cos(a) * d, Y.road + h + (i === 0 ? .35 : rand() * .7 - .1), z + Math.sin(a) * d), q.setFromEuler(e.set(rand(), rand() * 6, rand())), sc.set(s0, s0 * .82, s0)).clone());
    }
  }
  // Hedges: shrub rows along the lot's north and west edges and beside the driveway.
  const hedgeRow = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.round(len / .62));
    for (let i = 0; i <= n; i++) {
      const t = i / n, s0 = .44 + rand() * .08;
      blobs[1 + (i % 2)].push(m4.compose(v.set(x0 + (x1 - x0) * t, Y.road + .42, z0 + (z1 - z0) * t), q.setFromEuler(e.set(0, rand() * 6, 0)), sc.set(s0, s0 * 1.15, s0)).clone());
    }
  };
  hedgeRow(LOT.west - .9, LOT.north - .9, LOT.east + .6, LOT.north - .9);
  hedgeRow(LOT.west - .9, LOT.north - .9, LOT.west - .9, DRIVE.south);
  hedgeRow(LOT.west - .9, DRIVE.south + .1, GATE.west - 4.4, DRIVE.south + .1);
  hedgeRow(LOT.east + .45, DRIVE.north - 10, LOT.east + .45, DRIVE.north - 1.8);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trunkList.length);
  trunkList.forEach((mm, i) => trunks.setMatrixAt(i, mm));
  const leaves = blobs.map((list, k) => { const im = new THREE.InstancedMesh(blobGeo, leafMats[k], list.length); list.forEach((mm, i) => im.setMatrixAt(i, mm)); return im; });
  for (const m of [trunks, ...leaves]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); root.add(m); }

  // Light poles along the driveway
  const poleMat = mat({color: '#59636b', metalness: .4, roughness: .5});
  const lampMat = new THREE.MeshStandardMaterial({color: '#f6f1df', emissive: '#ffe7a6', emissiveIntensity: 0});
  materials.push(lampMat);
  const poles = [], lamps = [];
  for (const [x, z] of [[-31.2, -4], [-31.2, 8], [-47.4, -4], [-47.4, 8], [-40, 18.8], [-52, 18.8], [-28, 18.8]]) {
    poles.push(new THREE.CylinderGeometry(.07, .09, 6, 8).translate(x, Y.road + 3, z));
    lamps.push(new THREE.BoxGeometry(.9, .14, .34).translate(x + .35, Y.road + 6, z));
  }
  put(mergeGeometries(poles), poleMat);
  put(mergeGeometries(lamps), lampMat);
  for (const g of [...poles, ...lamps]) g.dispose();

  // Barrier: cabinet, boom, status lamp
  const gate = new THREE.Group(); gate.name = 'Demo_main_barrier'; root.add(gate);
  const cabinetMat = mat({color: '#e0b43a', roughness: .5});
  put(new THREE.BoxGeometry(.44, 1.1, .5), cabinetMat, {x: GATE.west - .25, y: Y.road + .6, z: GATE.z, shadow: true, parent: gate});
  const lampOn = new THREE.MeshStandardMaterial({color: '#c03d32', emissive: '#ff3b2f', emissiveIntensity: 1.2});
  materials.push(lampOn);
  put(new THREE.SphereGeometry(.09, 12, 8), lampOn, {x: GATE.west - .25, y: Y.road + 1.24, z: GATE.z, parent: gate});
  const boom = new THREE.Group(); boom.position.set(GATE.west - .25, Y.road + 1.02, GATE.z); boom.name = 'Demo_main_barrier_arm'; gate.add(boom);
  const boomLength = GATE.east - GATE.west + .4;
  const white = mat({color: '#fbfaf3', roughness: .4}), red = mat({color: '#d4483a', roughness: .5});
  put(new THREE.BoxGeometry(boomLength, .11, .12).translate(boomLength / 2, 0, 0), white, {parent: boom, shadow: true});
  put(mergeGeometries(Array.from({length: 9}, (_, i) => new THREE.BoxGeometry(.24, .115, .125).translate(.45 + i * .68, 0, 0))), red, {parent: boom});
  // Rest post on the far side
  put(new THREE.BoxGeometry(.12, .95, .12), mat({color: '#4b5560'}), {x: GATE.east + .2, y: Y.road + .48, z: GATE.z, parent: gate});

  // Plate cameras: LPR-IN watches arriving fronts from inside; LPR-OUT watches leaving fronts from outside.
  const camBody = mat({color: '#e9edf0', roughness: .35}), camDark = mat({color: '#28323b'});
  function lprCamera(name, pole, aim) {
    const height = 2.2;
    put(new THREE.CylinderGeometry(.06, .07, height, 8), poleMat, {x: pole[0], y: Y.road + height / 2, z: pole[1], parent: gate});
    const head = new THREE.Group(); head.position.set(pole[0], Y.road + height, pole[1]); gate.add(head);
    // Matrix4.lookAt keeps the horizon level (local -Z toward the target, +Y up).
    head.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(head.position, new THREE.Vector3(...aim), new THREE.Vector3(0, 1, 0)));
    put(new THREE.BoxGeometry(.22, .18, .46), camBody, {parent: head, shadow: true});
    put(new THREE.BoxGeometry(.26, .03, .52), camDark, {y: .105, parent: head});
    const lens = put(new THREE.CylinderGeometry(.06, .06, .04, 14).rotateX(Math.PI / 2), camDark, {z: -.24, parent: head});
    lens.name = `${name}_lens`;
    const camera = new THREE.PerspectiveCamera(30, 16 / 9, .1, 120);
    camera.name = name; camera.position.z = -.27; head.add(camera);
    return camera;
  }
  // Each looks at a stopped car's front plate from about 4.4 m, 27° off its axis, clear of the driving lines.
  const camIn = lprCamera('LPR-IN', [GATE.west, 16.0], [GATE.entryX, Y.road + .55, GATE.entryStopZ - 2.2]);
  const camOut = lprCamera('LPR-OUT', [GATE.exitX + 1.9, 22.3], [GATE.exitX, Y.road + .55, GATE.exitStopZ + 2.2]);

  // Guard booth
  const booth = new THREE.Group(); booth.position.set(GATE.west - 2.6, Y.road, GATE.z - 1.5); gate.add(booth);
  put(new THREE.BoxGeometry(2, .9, 2).translate(0, .45, 0), mat({color: '#dfe3df'}), {parent: booth, shadow: true});
  put(new THREE.BoxGeometry(2, 1.2, 2).translate(0, 1.5, 0), mat({color: '#7fa3b5', roughness: .1, metalness: .3, transparent: true, opacity: .55}), {parent: booth});
  put(new THREE.BoxGeometry(2.5, .16, 2.5).translate(0, 2.18, 0), mat({color: '#465560'}), {parent: booth, shadow: true});

  // Free-space sign at the gate, facing the street.
  const signCanvas = document.createElement('canvas'); signCanvas.width = 512; signCanvas.height = 256;
  const signTexture = new THREE.CanvasTexture(signCanvas); signTexture.colorSpace = THREE.SRGBColorSpace; textures.push(signTexture);
  const sign = new THREE.Group(); sign.position.set(GATE.west - 4.6, Y.road, STREET.north - .6); gate.add(sign);
  put(mergeGeometries([new THREE.BoxGeometry(.1, 2.3, .1).translate(-.95, 1.15, 0), new THREE.BoxGeometry(.1, 2.3, .1).translate(.95, 1.15, 0)]), poleMat, {parent: sign});
  put(new THREE.BoxGeometry(2.3, 1.2, .14).translate(0, 2.55, 0), mat({color: '#24323f'}), {parent: sign, shadow: true});
  put(new THREE.PlaneGeometry(2.16, 1.08).translate(0, 2.55, .072), basic({map: signTexture, toneMapped: false}), {parent: sign});
  function drawSign(free, capacity) {
    const c = signCanvas.getContext('2d');
    c.fillStyle = '#0f1a24'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#2d6fe0'; c.fillRect(24, 28, 92, 92);
    c.fillStyle = '#fff'; c.font = '700 76px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('P', 70, 78);
    c.textAlign = 'left'; c.font = '700 40px Arial'; c.fillStyle = '#e8eef4'; c.fillText('OSD PARKING', 136, 58);
    c.font = '500 26px "OSD Thai", Arial'; c.fillStyle = '#9fb3c4'; c.fillText('ที่จอดว่าง · FREE', 136, 102);
    c.font = '700 96px Arial'; c.fillStyle = free > 0 ? '#5df08a' : '#ff6a5c'; c.textAlign = 'left'; c.fillText(String(free).padStart(2, '0'), 36, 196);
    c.font = '500 34px Arial'; c.fillStyle = '#9fb3c4'; c.fillText(`/ ${capacity}`, 170, 206);
    c.font = '600 28px "OSD Thai", Arial'; c.fillStyle = free > 0 ? '#5df08a' : '#ff6a5c'; c.textAlign = 'right'; c.fillText(free > 0 ? 'เปิด · OPEN' : 'เต็ม · FULL', 488, 206);
    signTexture.needsUpdate = true;
  }

  // Bay indicator lights: a short post at the head of every bay.
  const ledGeo = new THREE.SphereGeometry(.13, 10, 8), postGeo = new THREE.CylinderGeometry(.035, .035, 1.1, 6);
  owned.push(ledGeo, postGeo);
  const ledMat = new THREE.MeshBasicMaterial({color: '#ffffff', toneMapped: false}); materials.push(ledMat);
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, stalls.length), posts = new THREE.InstancedMesh(postGeo, poleMat, stalls.length);
  stalls.forEach((s, i) => {
    const hx = s.x + s.nose * 2.62;
    posts.setMatrixAt(i, m4.makeTranslation(hx, s.y + .55, s.z));
    leds.setMatrixAt(i, m4.makeTranslation(hx, s.y + 1.16, s.z));
  });
  root.add(leds, posts);
  const ledColors = {free: new THREE.Color('#38d36b'), guest: new THREE.Color('#3aa7e8'), vip: new THREE.Color('#a77bf0'), used: new THREE.Color('#ff4b3e')};
  function setBays(list) {
    list.forEach((s, i) => leds.setColorAt(i, s.occupant ? ledColors.used : s.reserved === 'guest' ? ledColors.guest : s.reserved === 'vip' ? ledColors.vip : ledColors.free));
    leds.instanceColor.needsUpdate = true;
    const free = list.filter(s => !s.occupant).length;
    return free;
  }

  // Boom motion
  let boomAngle = 0, boomTarget = 0;
  function setBoom(open) { boomTarget = open ? Math.PI / 2 * .96 : 0; }
  function update(dt) {
    if (boomAngle === boomTarget) return false;
    const step = dt * 1.25;
    boomAngle = boomTarget > boomAngle ? Math.min(boomTarget, boomAngle + step) : Math.max(boomTarget, boomAngle - step);
    boom.rotation.z = boomAngle;
    const open = boomAngle > .05;
    lampOn.color.set(open ? '#2f9e57' : '#c03d32'); lampOn.emissive.set(open ? '#3dff7a' : '#ff3b2f');
    return true;
  }
  const boomState = () => (boomAngle === boomTarget ? (boomAngle > 0 ? 'open' : 'closed') : boomTarget > boomAngle ? 'opening' : 'closing');

  function setNight(night) {
    lampMat.emissiveIntensity = night ? 2.2 : 0;
    schedule();
  }

  // Everything here is static except the boom: skip the per-frame matrix work for the rest.
  root.traverse(o => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  boom.matrixAutoUpdate = true;

  return {
    root, cameras: {in: camIn, out: camOut}, setBays, drawSign, setBoom, update, boomState, setNight,
    get boomMoving() { return boomAngle !== boomTarget; },
    dispose() {
      root.removeFromParent();
      for (const g of owned) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      leds.dispose(); posts.dispose(); trunks.dispose(); for (const l of leaves) l.dispose();
    },
  };
}
