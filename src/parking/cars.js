// Low-poly cars, four draw calls each (six with headlights on, three more while a blinker flashes) and no per-car geometry:
//   body (body + roof, one material per paint colour), details (glass + wheels, vertex colours),
//   decals (both plates, the four lamps and the blinker lenses, unlit, one small texture per plate), a soft blob shadow, and at night the
//   headlights' light on the road (see headlightPool) and their beams in the air (see headlightBeams), and a blinker
//   on each side (front and rear corners, amber) that the traffic flashes before a turn (setCarBlinker).
// A car faces local +Z and sits on y = 0.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const CAR_COLORS = ['#f2f1ec', '#b9bec2', '#22262b', '#6d747a', '#2f5d9a', '#b8322e', '#33584a', '#cdbb98', '#1f3150'];
export const CAR = {frontPlateZ: 2.29, plateY: .44};

// The lamp rows' heights on the nose and the tail, and how far out the lamps sit: the body's rounded edges (bevel)
// put its nose and tail faces about 2.24 m from the middle at those heights; parts mounted on them stand just proud.
const HEAD_Y = .6, TAIL_Y = .64, FACE_Z = 2.255;
// Blinker lenses (one side; mirrored for the other): [x, y, z, width, depth]. Front and rear faces at the outer corners
// (head lamps run .37–.67, tail lamps .43–.69 from the middle) and a strip down each side next to them. The body is
// 1.72 m wide and 4.46 m long over its rounded edges.
const BLINKER_LENSES = [[.76, HEAD_Y, FACE_Z, .14, .05], [.855, HEAD_Y, 2.06, .05, .26], [.76, TAIL_Y, -FACE_Z, .14, .05], [.855, TAIL_Y, -2.06, .05, .26]];
// Plate texture layout: the plate fills the top 120 px; a lamp strip (head, blinker amber, tail, in thirds) sits below.
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
  // A sedan, side profiles in (forward, up): a low nose sloping up the bonnet to the windscreen, the cabin's glass over
  // the middle (a raked windscreen and rear window), a painted roof, and a short raised boot deck; bumpers, a grille
  // and mirrors in dark trim. The wheels stand a little proud of the body's sides, so the whole of each shows.
  const body = mergeGeometries([
    profileGeometry([[-2.18, .3], [2.18, .3], [2.22, .48], [2.17, .68], [1.95, .76], [1, .84], [-1.42, .86], [-2, .84], [-2.16, .78], [-2.22, .5]], 1.62, .05),
    profileGeometry([[.27, 1.355], [-.97, 1.335], [-.94, 1.415], [.23, 1.43]], 1.5, .02),
  ].map(flat));
  const wheel = new THREE.CylinderGeometry(.33, .33, .22, 16).rotateZ(Math.PI / 2);
  const wheelFlat = flat(wheel);
  const trim = (w, h, d, x, y, z) => tint(flat(new THREE.BoxGeometry(w, h, d)).translate(x, y, z), '#22262b');
  const details = mergeGeometries([
    tint(flat(profileGeometry([[1.02, .83], [-1.44, .85], [-.97, 1.36], [.26, 1.38]], 1.48, .02)), '#1e2a33'),
    ...[[.8, 1.38], [-.8, 1.38], [.8, -1.38], [-.8, -1.38]].map(([x, z]) => tint(wheelFlat.clone().translate(x, .33, z), '#1b1d20')),
    trim(1.78, .1, .12, 0, .34, 2.21), trim(1.78, .1, .12, 0, .34, -2.21), // bumpers, just behind the plates (in front, they hid the province line)
    trim(.62, .09, .04, 0, .53, FACE_Z), // grille, below the plate's top and between the head lamps
    trim(.08, .09, .16, .9, .93, .86), trim(.08, .09, .16, -.9, .93, .86), // mirrors
  ]);
  wheel.dispose(); wheelFlat.dispose();
  const plateGeo = new THREE.PlaneGeometry(.62, .3);
  const uv = plateGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * PLATE_W / TEX_W, 1 - (1 - uv.getY(i)) * PLATE_H / TEX_H);
  const front = plateGeo.clone().translate(0, CAR.plateY, CAR.frontPlateZ);
  const back = plateGeo.clone().rotateY(Math.PI).translate(0, CAR.plateY, -CAR.frontPlateZ);
  plateGeo.dispose();
  const lamp = (x, y, z, w, h, u) => lampUv(flat(new THREE.BoxGeometry(w, h, .05)).translate(x, y, z), u, strip);
  // Blinker lenses, part of the body: dull amber at each corner, beside the head and tail lamps and wrapping round the
  // side (seen from the side and from above too). BLINKER_LENSES places the lit lenses over them (setCarBlinker).
  const lenses = BLINKER_LENSES.flatMap(([x, y, z, w, d]) => [1, -1].map(side => lampUv(flat(new THREE.BoxGeometry(w, .1, d)).translate(side * x, y, z), .5, strip)));
  const decals = mergeGeometries([flat(front), flat(back), lamp(.52, HEAD_Y, FACE_Z, .3, .1, 1 / 6), lamp(-.52, HEAD_Y, FACE_Z, .3, .1, 1 / 6), lamp(.56, TAIL_Y, -FACE_Z, .26, .12, 5 / 6), lamp(-.56, TAIL_Y, -FACE_Z, .26, .12, 5 / 6), ...lenses]
    .map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 64;
  const c = blobCanvas.getContext('2d'), g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(20,30,35,.55)'); g.addColorStop(1, 'rgba(20,30,35,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const blobTexture = new THREE.CanvasTexture(blobCanvas);
  const blob = new THREE.PlaneGeometry(2.5, 5.1).rotateX(-Math.PI / 2);
  // Blinkers lit: bright lenses a touch larger than the dull ones in the body, a soft amber flare at each corner that
  // always faces the camera (blinkerGlow: the lenses alone were lost from the car park's usual distance), and a soft
  // patch of light on the road beside it (blinkerLight). Local +X is the driver's left (the car faces +Z).
  const blinker = side => mergeGeometries(BLINKER_LENSES.map(([x, y, z, w, d]) => flat(new THREE.BoxGeometry(w + .02, .12, d + .02)).translate(side * x, y, z)));
  shared = {
    body, details, decals, blob, ...headlightPool(), ...headlightBeams(),
    blinkLeft: blinker(1), blinkRight: blinker(-1), blinkMaterial: new THREE.MeshBasicMaterial({color: '#ffa31a', toneMapped: false}),
    glowLeft: blinkerGlow(1), glowRight: blinkerGlow(-1), glowMaterial: blinkerGlowMaterial(),
    ...blinkerLight(),
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
  const third = TEX_W / 3;
  c.fillStyle = '#fff6dc'; c.fillRect(0, PLATE_H, third, TEX_H - PLATE_H);
  c.fillStyle = '#b8741c'; c.fillRect(third, PLATE_H, third, TEX_H - PLATE_H);
  c.fillStyle = '#c62a2e'; c.fillRect(third * 2, PLATE_H, TEX_W - third * 2, TEX_H - PLATE_H);
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
const POOL = {width: 5.4, length: 10, start: 1.6, bumper: 2.2, lampX: .52};
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
  const poolMaterial = new THREE.MeshBasicMaterial({map: poolTexture, color: 0xffe2ad, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16});
  return {pool, poolMaterial, poolTexture};
}

// Headlight beams: the lit air in front of each lamp, as the meeting room's light cone is drawn (tour-effects.js).
// One box ahead of the bumper holds both beams; for each pixel the shader adds up the glow of the two cones along the
// view ray through the box (brightest near the lamps and on each beam's axis, thinning with distance, cut off at
// the road), so the beams read as light in the air from any side, above included.
const BEAM = {lampX: .52, lampY: HEAD_Y, lampZ: 2.28, reach: 8.5, width: 4.6, height: 1.3};
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
        gl_FragColor=vec4(color,1.-exp(-.7*sum*dt));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending,
  });
  return {beam: box, beamMaterial: material};
}

// A blinker's flare: one quad per lamp (front and rear corner), every vertex at the lamp's centre with a corner
// offset that the vertex shader lays out across the screen, so the quad always faces the camera. Soft round falloff,
// added onto what lies behind it.
function blinkerGlow(side) {
  const geo = new THREE.BufferGeometry(), pos = [], corner = [], index = [];
  [[HEAD_Y, FACE_Z + .03], [TAIL_Y, -FACE_Z - .03]].forEach(([y, z], q) => {
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pos.push(side * .8, y, z); corner.push(u, v); }
    index.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3);
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2));
  geo.setIndex(index);
  return geo;
}
// The blinkers' subtle light: a soft amber patch on the road at each flashing corner (as the headlights' light is
// painted on the road, not cast by a light: a light per car would recompile every material as cars come and go).
function blinkerLight() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const c = canvas.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,160,40,.55)'); g.addColorStop(.5, 'rgba(255,150,30,.18)'); g.addColorStop(1, 'rgba(255,140,20,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const patch = side => mergeGeometries([2.3, -2.3].map(z => flat(new THREE.PlaneGeometry(2.2, 2.2)).rotateX(-Math.PI / 2).translate(side * 1.05, .03, z)));
  return {lightLeft: patch(1), lightRight: patch(-1), lightTexture: texture,
    lightMaterial: new THREE.MeshBasicMaterial({map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8})};
}
function blinkerGlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color('#ffa31a')}, size: {value: .6}},
    vertexShader: `attribute vec2 corner; uniform float size; varying vec2 vCorner;
      void main(){vCorner=corner;vec4 mv=modelViewMatrix*vec4(position,1.);mv.xy+=corner*size;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 color; varying vec2 vCorner;
      void main(){float a=1.-smoothstep(0.,1.,length(vCorner));a*=a;gl_FragColor=vec4(color*a*1.4,a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
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
  const decals = add(p.decals, plateTexture(plate, province));
  decals.receiveShadow = false; decals.name = 'Demo_car_decals';
  const blob = add(p.blob, p.blobMaterial);
  blob.position.y = .025; blob.updateMatrix(); blob.renderOrder = -1; blob.receiveShadow = false;
  const pool = add(p.pool, p.poolMaterial);
  pool.receiveShadow = false; pool.visible = false; pool.name = 'Demo_car_headlights';
  const beams = add(p.beam, p.beamMaterial);
  beams.receiveShadow = false; beams.visible = false; beams.name = 'Demo_car_headlight_beams';
  for (const [side, geo] of [['left', p.blinkLeft], ['right', p.blinkRight]]) {
    const b = add(geo, p.blinkMaterial);
    b.receiveShadow = false; b.visible = false; b.name = `Demo_car_blinker_${side}`;
  }
  for (const [side, geo] of [['left', p.glowLeft], ['right', p.glowRight]]) {
    const g = add(geo, p.glowMaterial);
    // Its quads are spread out in the shader, beyond the bounds three.js would cull by.
    g.receiveShadow = false; g.visible = false; g.renderOrder = 1; g.frustumCulled = false; g.name = `Demo_car_blinker_glow_${side}`;
  }
  for (const [side, geo] of [['left', p.lightLeft], ['right', p.lightRight]]) {
    const l = add(geo, p.lightMaterial);
    l.receiveShadow = false; l.visible = false; l.renderOrder = -1; l.name = `Demo_car_blinker_light_${side}`;
  }
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

// The blinkers (children 6 and 7, their flares 8 and 9, their light on the road 10 and 11): `side` is 'left', 'right'
// or null; `lit` is the flash's on half.
export function setCarBlinker(car, side, lit) {
  car.children.slice(6, 12).forEach((o, i) => { o.visible = side === (i % 2 ? 'right' : 'left') && lit; });
}

export function disposeCars() {
  if (!shared) return;
  for (const k of ['body', 'details', 'decals', 'blob', 'pool', 'beam', 'blinkLeft', 'blinkRight', 'glowLeft', 'glowRight', 'lightLeft', 'lightRight']) shared[k].dispose();
  for (const m of shared.bodyMaterials) m.dispose();
  for (const k of ['detailMaterial', 'blobMaterial', 'blobTexture', 'poolMaterial', 'poolTexture', 'beamMaterial', 'blinkMaterial', 'glowMaterial', 'lightMaterial', 'lightTexture']) shared[k].dispose();
  for (const m of plateCache.values()) { m.map.dispose(); m.dispose(); }
  plateCache.clear();
  shared = null;
}
