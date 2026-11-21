// Low-poly cars, four draw calls each (six with headlights on) and no per-car geometry:
//   body (body + roof, one material per paint colour), details (glass + wheels, vertex colours),
//   decals (both plates and the four lamps, unlit, one small texture per plate), a soft blob shadow, and at night the
//   headlights' light on the road (see headlightPool) and their beams in the air (see headlightBeams).
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
    body, details, decals, blob, ...headlightPool(), ...headlightBeams(),
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

// Headlights: the light they throw on the road ahead, painted rather than lit. Two lobes, one from each lamp, grow out
// from under the bumper (brightest just ahead of it, so the light visibly comes from the lamps), widen, lean inwards and
// overlap ahead, then fade out about 8 m on. One soft texture on a flat quad under every car with its engine running,
// added onto the road (and seen by the plate cameras). It fades to nothing well inside every edge of its quad, which
// starts under the car's nose (hidden by the body): a light already bright at the quad's edges showed as straight cuts.
// Real spot lights cost every lit pixel of the scene, so only three cars had them, and their pools began metres ahead.
const POOL = {width: 5.4, length: 10, start: 1.6, bumper: 2.2, lampX: .6};
function headlightPool() {
  const W = 128, H = 256, canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d'), image = c.createImageData(W, H), smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  for (let row = 0; row < H; row++) {
    const z = (row + .5) / H * POOL.length, d = Math.max(0, z - (POOL.bumper - POOL.start)); // d: metres ahead of the bumper
    const spread = .2 + d * .14;
    // Rises from nothing under the nose to full just past the bumper, then thins out with distance and is gone by the far edge.
    const reach = smooth(z / (POOL.bumper - POOL.start + .45)) / (1 + (d / 3.4) ** 2) * (1 - smooth((z - (POOL.length - 3)) / 3));
    for (let col = 0; col < W; col++) {
      const u = (col + .5) / W, x = (u - .5) * POOL.width;
      let v = 0;
      for (const side of [-1, 1]) { const axis = side * POOL.lampX * (1 - .45 * Math.min(1, d / 8)); v += Math.exp(-(((x - axis) / spread) ** 2)); }
      const sides = smooth(Math.min(u, 1 - u) / .2); // and gone before the side edges
      const a = Math.min(1, v * reach * sides), i = (row * W + col) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255; image.data[i + 3] = Math.round(a * 255);
    }
  }
  c.putImageData(image, 0, 0);
  const poolTexture = new THREE.CanvasTexture(canvas);
  // Flat on the road; the texture's top edge under the car's nose.
  const pool = new THREE.PlaneGeometry(POOL.width, POOL.length).rotateX(-Math.PI / 2).translate(0, .035, POOL.start + POOL.length / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({map: poolTexture, color: 0xffe2ad, transparent: true, opacity: .62, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16});
  return {pool, poolMaterial, poolTexture};
}

// Headlight beams: the lit air in front of each lamp, as the meeting room's light cone is drawn (tour-effects.js).
// One box ahead of the bumper holds both beams; for each pixel the shader adds up the glow of the two cones along the
// view ray through the box (brightest near the lamps and on each beam's axis, thinning with distance, cut off at
// the road), so the beams read as light in the air from any side, above included.
const BEAM = {lampX: .6, lampY: .74, lampZ: 2.24, reach: 8.5, width: 4.6, height: 1.3};
function headlightBeams() {
  const box = new THREE.BoxGeometry(BEAM.width, BEAM.height, BEAM.reach).translate(0, BEAM.height / 2, BEAM.lampZ + BEAM.reach / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color(0xffe6b8)}, lamp: {value: new THREE.Vector3(BEAM.lampX, BEAM.lampY, BEAM.lampZ)}, size: {value: new THREE.Vector3(BEAM.width / 2, BEAM.height, BEAM.reach)}},
    vertexShader: `varying vec3 local; varying vec3 eye;
      void main(){local=position;eye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform vec3 color,lamp,size; varying vec3 local; varying vec3 eye;
      // One lamp's beam: a cone from the lamp, aimed ahead and down to meet the road ~6.5 m out, leaning slightly in.
      float beam(vec3 p,float side){
        vec3 apex=vec3(side*lamp.x,lamp.y,lamp.z),axis=normalize(vec3(-side*.035,-.112,1.));
        vec3 v=p-apex;float t=dot(v,axis);if(t<=0.)return 0.;
        float q=length(v-axis*t)/(.09+t*.2);if(q>=1.)return 0.;
        return (1.-q*q)*smoothstep(0.,.35,t)/(1.+t*t/6.)*(1.-smoothstep(size.z-2.5,size.z-.3,t));
      }
      float glow(vec3 p){return p.y<.03?0.:beam(p,1.)+beam(p,-1.);}
      void main(){
        // Entered here (a front face), or from the eye when it is inside the box (then only the back faces draw).
        vec3 lo=vec3(-size.x,0.,lamp.z),hi=vec3(size.x,size.y,lamp.z+size.z);
        bool inside=all(greaterThan(eye,lo))&&all(lessThan(eye,hi));
        if(gl_FrontFacing==inside)discard;
        vec3 d=normalize(local-eye);float t0=inside?0.:distance(local,eye);
        vec3 inv=1./d,far=max((lo-eye)*inv,(hi-eye)*inv);float t1=min(min(far.x,far.y),far.z);
        float dt=max(0.,t1-t0)/32.,jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))),sum=0.;
        for(int i=0;i<32;i++)sum+=glow(eye+d*(t0+(float(i)+jitter)*dt));
        gl_FragColor=vec4(color,1.-exp(-.55*sum*dt));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending,
  });
  return {beam: box, beamMaterial: material};
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
  const pool = add(p.pool, p.poolMaterial);
  pool.receiveShadow = false; pool.visible = false; pool.name = 'Demo_car_headlights';
  const beams = add(p.beam, p.beamMaterial);
  beams.receiveShadow = false; beams.visible = false; beams.name = 'Demo_car_headlight_beams';
  car.userData = {plate, province};
  return car;
}

// Lamps and plate at night: a car with its engine on shows its lamps (and plate) bright; a parked one at night is
// dim, as unlit paint would be. In daytime both look as drawn. Each car's plate material is its own (one per plate;
// through-traffic shares one, and it is always on the move).
export function setCarLamps(car, on, night) {
  const decals = car.children[2], pool = car.children[4], beams = car.children[5];
  if (decals) decals.material.color.setScalar(!night || on ? 1 : .3);
  if (pool) pool.visible = night && on;
  if (beams) beams.visible = night && on;
}

export function disposeCars() {
  if (!shared) return;
  for (const k of ['body', 'details', 'decals', 'blob', 'pool', 'beam']) shared[k].dispose();
  for (const m of shared.bodyMaterials) m.dispose();
  for (const k of ['detailMaterial', 'blobMaterial', 'blobTexture', 'poolMaterial', 'poolTexture', 'beamMaterial']) shared[k].dispose();
  for (const m of plateCache.values()) { m.map.dispose(); m.dispose(); }
  plateCache.clear();
  shared = null;
}
