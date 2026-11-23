// Low-poly cars and no per-car geometry. What every car has, its body (body + roof, in its paint colour), details
// (glass, wheels and trim, vertex colours) and a soft blob shadow, is drawn for all the cars at once (createCarInstances:
// two draw calls per model and one for the shadows, however many cars). Each car's own object (createCar) holds the
// rest, one draw call each while shown:
//   decals (both plates, the lamps and the blinker lenses, unlit, one small texture per plate), and at night the
//   headlights' light on the road (see headlightPool) and their beams in the air (see headlightBeams), the red glow of
//   the tail lamps, and a blinker on each side (front and rear corners, amber) that the traffic flashes before a turn
//   (setCarBlinker).
// Five models (MODELS), all on the same footprint, 4.46 × 1.72 m, with the plates and lamps in the same places: the
// traffic, the bays and the plate cameras treat every car alike. Front and back differ on each: white lamps, a grille
// and a bonnet under a pale raked windscreen, against tall red lamps joined by a red strip under a dark rear window.
// (Drawn car by car, 34 parked cars cost 136 draw calls a frame.)
// A car faces local +Z and sits on y = 0.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {normalizePlate} from './sim.js';
import {mergeGeometries} from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const CAR_COLORS = ['#f2f1ec', '#b9bec2', '#22262b', '#6d747a', '#2f5d9a', '#b8322e', '#33584a', '#cdbb98', '#1f3150'];
export const CAR = {frontPlateZ: 2.29, plateY: 0.44};

// The lamp rows' heights on the nose and the tail, and how far out the lamps sit: the body's rounded edges (bevel)
// put its nose and tail faces about 2.24 m from the middle at those heights; parts mounted on them stand just proud.
const HEAD_Y = 0.6,
  TAIL_Y = 0.64,
  FACE_Z = 2.255;
// Blinker lenses (one side; mirrored for the other): [x, y, z, width, depth]. Front and rear faces at the outer corners
// (head lamps run .35–.69, tail lamps .39–.69 from the middle) and a strip down each side next to them. The body is
// 1.72 m wide and 4.46 m long over its rounded edges.
const BLINKER_LENSES = [
  [0.76, HEAD_Y, FACE_Z, 0.14, 0.05],
  [0.855, HEAD_Y, 2.06, 0.05, 0.26],
  [0.76, TAIL_Y, -FACE_Z, 0.14, 0.05],
  [0.855, TAIL_Y, -2.06, 0.05, 0.26],
];
// Plate texture layout: the plate fills the top 120 px; a lamp strip (head, blinker amber, tail, in thirds) sits below.
const TEX_W = 256,
  TEX_H = 144,
  PLATE_W = 248,
  PLATE_H = 120;

function profileGeometry(points, depth, bevel) {
  const shape = new THREE.Shape(points.map(([u, v]) => new THREE.Vector2(u, v)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // Shape lies in XY (x = forward); extrusion runs along Z. Turn so forward is +Z and width is X.
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}
const tint = (geo, color) => {
  const c = new THREE.Color(color),
    n = geo.attributes.position.count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};
// Every vertex of a lamp samples one point of the lamp strip.
const lampUv = (geo, u, v) => {
  const n = geo.attributes.position.count,
    a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = u;
    a[i * 2 + 1] = v;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return geo;
};
const strip = (TEX_H - PLATE_H) / 2 / TEX_H;
const flat = (g) => (g.index ? g.toNonIndexed() : g);

const TRIM = '#22262b',
  TYRE = '#1b1d20',
  GLASS = '#18222a',
  WINDSCREEN = '#6f8fa3',
  CHROME = '#c9ced2';
const box = (w, h, d, x, y, z) => flat(new THREE.BoxGeometry(w, h, d)).translate(x, y, z);
const trim = (w, h, d, x, y, z, color = TRIM) => tint(box(w, h, d, x, y, z), color);
// A cabin's glass: the windscreen (the faces looking ahead) pale, the sides and the rear window dark.
function glass(points, width = 1.48) {
  const geo = tint(flat(profileGeometry(points, width, 0.02)), GLASS),
    pale = new THREE.Color(WINDSCREEN),
    {normal, color} = geo.attributes;
  for (let i = 0; i < normal.count; i++) if (normal.getZ(i) > 0.4) pale.toArray(color.array, i * 3);
  return geo;
}
// Side profiles are in (forward, up). Each model: its painted parts (`body`), its own glass and trim (`details`), its
// wheels' radius and its mirrors' height. Every nose and tail face stands about 2.24 m from the middle at the lamps' heights.
const MODELS = {
  // A low nose sloping up the bonnet, the cabin over the middle, a short raised boot deck.
  sedan: {
    wheel: 0.33,
    mirror: 0.95,
    body: () => [
      profileGeometry(
        [
          [-2.18, 0.3],
          [2.18, 0.3],
          [2.22, 0.48],
          [2.17, 0.68],
          [1.95, 0.76],
          [1, 0.84],
          [-1.42, 0.86],
          [-2, 0.84],
          [-2.16, 0.78],
          [-2.22, 0.5],
        ],
        1.62,
        0.05,
      ),
      profileGeometry(
        [
          [0.27, 1.355],
          [-0.97, 1.335],
          [-0.94, 1.415],
          [0.23, 1.43],
        ],
        1.5,
        0.02,
      ),
    ],
    details: () => [
      glass([
        [1.02, 0.83],
        [-1.44, 0.85],
        [-0.97, 1.36],
        [0.26, 1.38],
      ]),
    ],
  },
  // The cabin runs to the tail: no boot, an upright rear window under a small roof spoiler.
  hatchback: {
    wheel: 0.33,
    mirror: 1.02,
    body: () => [
      profileGeometry(
        [
          [-2.18, 0.3],
          [2.18, 0.3],
          [2.22, 0.48],
          [2.17, 0.7],
          [1.9, 0.82],
          [1.15, 0.92],
          [-2.08, 0.98],
          [-2.2, 0.84],
          [-2.22, 0.5],
        ],
        1.62,
        0.05,
      ),
      profileGeometry(
        [
          [0.36, 1.45],
          [-1.78, 1.41],
          [-1.96, 1.43],
          [-1.9, 1.49],
          [0.32, 1.53],
        ],
        1.5,
        0.02,
      ),
    ],
    details: () => [
      glass([
        [1.2, 0.9],
        [-2.04, 0.96],
        [-1.74, 1.44],
        [0.36, 1.48],
      ]),
    ],
  },
  // Tall and square, on bigger wheels, with dark cladding along the sills and rails on the roof.
  suv: {
    wheel: 0.38,
    mirror: 1.15,
    body: () => [
      profileGeometry(
        [
          [-2.16, 0.38],
          [2.16, 0.38],
          [2.22, 0.5],
          [2.2, 0.86],
          [1.98, 0.99],
          [1.05, 1.06],
          [-2.12, 1.08],
          [-2.22, 0.92],
          [-2.22, 0.5],
        ],
        1.62,
        0.05,
      ),
      profileGeometry(
        [
          [0.36, 1.66],
          [-1.9, 1.64],
          [-1.86, 1.74],
          [0.28, 1.76],
        ],
        1.5,
        0.02,
      ),
    ],
    details: () => [
      glass([
        [1.02, 1.05],
        [-2.1, 1.07],
        [-1.88, 1.68],
        [0.34, 1.7],
      ]),
      ...[1, -1].flatMap((side) => [
        trim(0.05, 0.12, 1.9, side * 0.865, 0.42, 0),
        trim(0.05, 0.05, 1.7, side * 0.62, 1.81, -0.78),
      ]),
    ],
  },
  // A short cabin ahead of an open bed with a tailgate.
  pickup: {
    wheel: 0.38,
    mirror: 1.12,
    body: () => [
      profileGeometry(
        [
          [-2.16, 0.36],
          [2.16, 0.36],
          [2.22, 0.5],
          [2.2, 0.82],
          [2, 0.95],
          [1.2, 1.02],
          [-0.5, 1.02],
          [-0.52, 0.66],
          [-2.2, 0.66],
          [-2.22, 0.5],
        ],
        1.62,
        0.05,
      ),
      profileGeometry(
        [
          [0.5, 1.58],
          [-0.36, 1.57],
          [-0.34, 1.67],
          [0.44, 1.68],
        ],
        1.5,
        0.02,
      ),
      box(0.1, 0.36, 1.72, 0.81, 0.84, -1.38),
      box(0.1, 0.36, 1.72, -0.81, 0.84, -1.38),
      box(1.72, 0.36, 0.1, 0, 0.84, -2.2),
    ],
    details: () => [
      glass([
        [1.18, 1.01],
        [-0.5, 1.01],
        [-0.36, 1.6],
        [0.48, 1.62],
      ]),
      trim(1.5, 0.02, 1.58, 0, 0.72, -1.34),
    ],
  },
  // A short sloping nose, the windscreen right above it, and a closed box to the tail.
  van: {
    wheel: 0.34,
    mirror: 1.2,
    body: () => [
      profileGeometry(
        [
          [-2.2, 0.32],
          [2.18, 0.32],
          [2.22, 0.5],
          [2.18, 0.84],
          [1.72, 1.06],
          [-2.2, 1.08],
          [-2.22, 0.5],
        ],
        1.62,
        0.05,
      ),
      profileGeometry(
        [
          [0.5, 1.06],
          [-2.18, 1.06],
          [-2.12, 1.86],
          [0.5, 1.9],
        ],
        1.54,
        0.04,
      ),
      profileGeometry(
        [
          [0.98, 1.8],
          [0.45, 1.8],
          [0.45, 1.93],
          [0.86, 1.9],
        ],
        1.54,
        0.02,
      ),
    ],
    details: () => [
      glass(
        [
          [1.74, 1.05],
          [0.4, 1.05],
          [0.4, 1.82],
          [0.96, 1.82],
        ],
        1.52,
      ),
      trim(1.1, 0.36, 0.06, 0, 1.45, -2.19, GLASS),
    ],
  },
};
// How common each is, out of ten: an office's car park.
const SHARES = {sedan: 3, hatchback: 2, suv: 3, pickup: 1, van: 1};
const MIX = Object.entries(SHARES).flatMap(([name, n]) => Array(n).fill(name));
// A plate's car is always the same model; through-traffic (no plate) goes by its colour.
export function carModel(plate, color = 0) {
  let h = 2166136261;
  for (const ch of normalizePlate(plate) || `#${color}`) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  h ^= h >>> 15;
  return MIX[(h >>> 0) % MIX.length];
}
function modelParts({wheel, mirror, body, details}) {
  const tyre = flat(new THREE.CylinderGeometry(wheel, wheel, 0.22, 16).rotateZ(Math.PI / 2)),
    hub = flat(new THREE.CylinderGeometry(wheel * 0.55, wheel * 0.55, 0.23, 10).rotateZ(Math.PI / 2));
  return {
    body: mergeGeometries(body().map(flat)),
    // The wheels stand a little proud of the body's sides, so the whole of each shows.
    details: mergeGeometries([
      ...details(),
      ...[
        [0.8, 1.38],
        [-0.8, 1.38],
        [0.8, -1.38],
        [-0.8, -1.38],
      ].flatMap(([x, z]) => [
        tint(tyre.clone().translate(x, wheel, z), TYRE),
        tint(hub.clone().translate(x, wheel, z), '#9aa1a6'),
      ]),
      trim(1.78, 0.1, 0.12, 0, 0.34, 2.21),
      trim(1.78, 0.1, 0.12, 0, 0.34, -2.21), // bumpers, just behind the plates (in front, they hid the province line)
      trim(0.64, 0.14, 0.06, 0, 0.65, FACE_Z - 0.01), // grille, above the plate and between the head lamps
      trim(0.64, 0.025, 0.07, 0, 0.73, FACE_Z - 0.02, CHROME),
      // Mirrors, on an arm from the cabin's side (glass, 0.76 m out).
      ...[1, -1].map((side) => trim(0.22, 0.1, 0.16, side * 0.83, mirror, 0.8)),
    ]),
  };
}

let shared = null;
function sharedParts() {
  if (shared) return shared;
  const models = Object.fromEntries(Object.entries(MODELS).map(([name, model]) => [name, modelParts(model)]));
  const plateGeo = new THREE.PlaneGeometry(0.62, 0.3);
  const uv = plateGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * PLATE_W) / TEX_W, 1 - ((1 - uv.getY(i)) * PLATE_H) / TEX_H);
  const front = plateGeo.clone().translate(0, CAR.plateY, CAR.frontPlateZ);
  const back = plateGeo.clone().rotateY(Math.PI).translate(0, CAR.plateY, -CAR.frontPlateZ);
  plateGeo.dispose();
  const lamp = (x, y, z, w, h, u) => lampUv(flat(new THREE.BoxGeometry(w, h, 0.05)).translate(x, y, z), u, strip);
  // Blinker lenses, part of the body: dull amber at each corner, beside the head and tail lamps and wrapping round the
  // side (seen from the side and from above too). BLINKER_LENSES places the lit lenses over them (setCarBlinker).
  const lenses = BLINKER_LENSES.flatMap(([x, y, z, w, d]) =>
    [1, -1].map((side) => lampUv(flat(new THREE.BoxGeometry(w, 0.1, d)).translate(side * x, y, z), 0.5, strip)),
  );
  const decals = mergeGeometries(
    [
      flat(front),
      flat(back),
      ...[1, -1].flatMap((side) => [
        lamp(side * 0.52, HEAD_Y + 0.02, FACE_Z, 0.34, 0.15, 1 / 6),
        lamp(side * 0.54, TAIL_Y + 0.02, -FACE_Z, 0.3, 0.2, 5 / 6),
        // The tail lamps wrap round the sides, over the blinkers.
        lampUv(
          flat(new THREE.BoxGeometry(0.05, 0.1, 0.34)).translate(side * 0.858, TAIL_Y + 0.11, -2.02),
          5 / 6,
          strip,
        ),
      ]),
      lamp(0, TAIL_Y + 0.1, -FACE_Z, 0.8, 0.045, 5 / 6), // the red strip between them
      ...lenses,
    ].map((g) => {
      for (const k of Object.keys(g.attributes)) if (!['position', 'uv'].includes(k)) g.deleteAttribute(k);
      return g;
    }),
  );
  const blobCanvas = document.createElement('canvas');
  blobCanvas.width = blobCanvas.height = 64;
  const c = blobCanvas.getContext('2d'),
    g = c.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(20,30,35,.55)');
  g.addColorStop(1, 'rgba(20,30,35,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const blobTexture = new THREE.CanvasTexture(blobCanvas);
  const blob = new THREE.PlaneGeometry(2.5, 5.1).rotateX(-Math.PI / 2);
  // Blinkers lit: bright lenses a touch larger than the dull ones in the body, a soft amber flare at each corner that
  // always faces the camera (blinkerGlow: the lenses alone were lost from the car park's usual distance), and a soft
  // patch of light on the road beside it (blinkerLight). Local +X is the driver's left (the car faces +Z).
  const blinker = (side) =>
    mergeGeometries(
      BLINKER_LENSES.map(([x, y, z, w, d]) =>
        flat(new THREE.BoxGeometry(w + 0.02, 0.12, d + 0.02)).translate(side * x, y, z),
      ),
    );
  shared = {
    models,
    decals,
    blob,
    ...headlightPool(),
    ...headlightBeams(),
    blinkLeft: blinker(1),
    blinkRight: blinker(-1),
    blinkMaterial: new THREE.MeshBasicMaterial({color: '#ffa31a', toneMapped: false}),
    glowLeft: blinkerGlow(1),
    glowRight: blinkerGlow(-1),
    glowMaterial: glowMaterial('#ffa31a', 0.6),
    tailGlow: cornerFlares([
      [0.54, TAIL_Y, -FACE_Z - 0.03],
      [-0.54, TAIL_Y, -FACE_Z - 0.03],
    ]),
    tailGlowMaterial: glowMaterial('#ff2a24', 0.5),
    ...blinkerLight(),
    detailMaterial: new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.3, metalness: 0.5}),
    // The soft shadow sits on the road; the depth offset stops it flickering against the asphalt and paint.
    blobMaterial: new THREE.MeshBasicMaterial({
      map: blobTexture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -12,
    }),
    blobTexture,
  };
  return shared;
}

const plateCache = new Map();
function plateTexture(plate, province) {
  const id = `${plate}|${province}`;
  if (plateCache.has(id)) return plateCache.get(id);
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fbfbf7';
  c.fillRect(0, 0, PLATE_W, PLATE_H);
  c.strokeStyle = '#1d232a';
  c.lineWidth = 6;
  c.strokeRect(5, 5, PLATE_W - 10, PLATE_H - 10);
  c.fillStyle = '#121820';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '700 54px "OSD Thai", "Noto Sans Thai", sans-serif';
  c.fillText(plate, PLATE_W / 2, 48, 220);
  c.font = '500 22px "OSD Thai", "Noto Sans Thai", sans-serif';
  c.fillText(province || '', PLATE_W / 2, 94, 220);
  const third = TEX_W / 3;
  c.fillStyle = '#fff6dc';
  c.fillRect(0, PLATE_H, third, TEX_H - PLATE_H);
  c.fillStyle = '#b8741c';
  c.fillRect(third, PLATE_H, third, TEX_H - PLATE_H);
  c.fillStyle = '#c62a2e';
  c.fillRect(third * 2, PLATE_H, TEX_W - third * 2, TEX_H - PLATE_H);
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
const POOL = {width: 5.4, length: 10, start: 1.6, bumper: 2.2, lampX: 0.52};
function headlightPool() {
  const W = 128,
    H = 256,
    canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d'),
    image = c.createImageData(W, H),
    smooth = (t) => {
      t = Math.min(1, Math.max(0, t));
      return t * t * (3 - 2 * t);
    };
  for (let row = 0; row < H; row++) {
    const z = ((row + 0.5) / H) * POOL.length,
      d = Math.max(0, z - (POOL.bumper - POOL.start)); // d: metres ahead of the bumper
    const spread = 0.2 + d * 0.14;
    // Rises from nothing under the nose to full just past the bumper, then thins out with distance and is gone by the far edge.
    const reach =
      (smooth(z / (POOL.bumper - POOL.start + 0.45)) / (1 + (d / 3.4) ** 2)) *
      (1 - smooth((z - (POOL.length - 3)) / 3));
    for (let col = 0; col < W; col++) {
      const u = (col + 0.5) / W,
        x = (u - 0.5) * POOL.width;
      let v = 0;
      for (const side of [-1, 1]) {
        const axis = side * POOL.lampX * (1 - 0.45 * Math.min(1, d / 8));
        v += Math.exp(-(((x - axis) / spread) ** 2));
      }
      const sides = smooth(Math.min(u, 1 - u) / 0.2); // and gone before the side edges
      const a = Math.min(1, v * reach * sides),
        i = (row * W + col) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(a * 255);
    }
  }
  c.putImageData(image, 0, 0);
  const poolTexture = new THREE.CanvasTexture(canvas);
  // Flat on the road; the texture's top edge under the car's nose.
  const pool = new THREE.PlaneGeometry(POOL.width, POOL.length)
    .rotateX(-Math.PI / 2)
    .translate(0, 0.035, POOL.start + POOL.length / 2);
  const poolMaterial = new THREE.MeshBasicMaterial({
    map: poolTexture,
    color: 0xffe2ad,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -8,
    polygonOffsetUnits: -16,
  });
  return {pool, poolMaterial, poolTexture};
}

// Headlight beams: the lit air in front of each lamp, as the meeting room's light cone is drawn (light-cone.js).
// One box ahead of the bumper holds both beams; for each pixel the shader adds up the glow of the two cones along the
// view ray through the box (brightest near the lamps and on each beam's axis, thinning with distance, cut off at
// the road), so the beams read as light in the air from any side, above included.
const BEAM = {lampX: 0.52, lampY: HEAD_Y, lampZ: 2.28, reach: 8.5, width: 4.6, height: 1.3};
function headlightBeams() {
  const box = new THREE.BoxGeometry(BEAM.width, BEAM.height, BEAM.reach).translate(
    0,
    BEAM.height / 2,
    BEAM.lampZ + BEAM.reach / 2,
  );
  const material = new THREE.ShaderMaterial({
    uniforms: {
      color: {value: new THREE.Color(0xffe6b8)},
      lamp: {value: new THREE.Vector3(BEAM.lampX, BEAM.lampY, BEAM.lampZ)},
      size: {value: new THREE.Vector3(BEAM.width / 2, BEAM.height, BEAM.reach)},
    },
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
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
  });
  return {beam: box, beamMaterial: material};
}

// A lamp's flare (blinkers, tail lamps): one quad per lamp, every vertex at the lamp's centre with a corner
// offset that the vertex shader lays out across the screen, so the quad always faces the camera. Soft round falloff,
// added onto what lies behind it.
const blinkerGlow = (side) =>
  cornerFlares([
    [side * 0.8, HEAD_Y, FACE_Z + 0.03],
    [side * 0.8, TAIL_Y, -FACE_Z - 0.03],
  ]);
function cornerFlares(lamps) {
  const geo = new THREE.BufferGeometry(),
    pos = [],
    corner = [],
    index = [];
  lamps.forEach((at, q) => {
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pos.push(...at);
      corner.push(u, v);
    }
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
  const c = canvas.getContext('2d'),
    g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,160,40,.55)');
  g.addColorStop(0.5, 'rgba(255,150,30,.18)');
  g.addColorStop(1, 'rgba(255,140,20,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const patch = (side) =>
    mergeGeometries(
      [2.3, -2.3].map((z) =>
        flat(new THREE.PlaneGeometry(2.2, 2.2))
          .rotateX(-Math.PI / 2)
          .translate(side * 1.05, 0.03, z),
      ),
    );
  return {
    lightLeft: patch(1),
    lightRight: patch(-1),
    lightTexture: texture,
    lightMaterial: new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    }),
  };
}
function glowMaterial(color, size) {
  return new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color(color)}, size: {value: size}},
    vertexShader: `attribute vec2 corner; uniform float size; varying vec2 vCorner;
      void main(){vCorner=corner;vec4 mv=modelViewMatrix*vec4(position,1.);mv.xy+=corner*size;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 color; varying vec2 vCorner;
      void main(){float a=1.-smoothstep(0.,1.,length(vCorner));a*=a;gl_FragColor=vec4(color*a*1.4,a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// Every car made and not yet taken out of its car park: createCarInstances draws their common parts.
const cars = new Set();
export function createCar({plate, province, color = 0}) {
  const p = sharedParts();
  const car = new THREE.Group();
  car.name = `Demo_car_${plate}`;
  car.userData.model = carModel(plate, color);
  car.userData.paint = CAR_COLORS[color % CAR_COLORS.length];
  // Parts never move inside the car, and the car's own matrix is set when it is placed.
  car.matrixAutoUpdate = false;
  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = false;
    m.matrixAutoUpdate = false;
    car.add(m);
    return m;
  };
  const decals = add(p.decals, plateTexture(plate, province));
  decals.name = 'Demo_car_decals';
  const pool = add(p.pool, p.poolMaterial);
  pool.receiveShadow = false;
  pool.visible = false;
  pool.name = 'Demo_car_headlights';
  const beams = add(p.beam, p.beamMaterial);
  beams.receiveShadow = false;
  beams.visible = false;
  beams.name = 'Demo_car_headlight_beams';
  for (const [side, geo] of [
    ['left', p.blinkLeft],
    ['right', p.blinkRight],
  ]) {
    const b = add(geo, p.blinkMaterial);
    b.receiveShadow = false;
    b.visible = false;
    b.name = `Demo_car_blinker_${side}`;
  }
  for (const [side, geo] of [
    ['left', p.glowLeft],
    ['right', p.glowRight],
  ]) {
    const g = add(geo, p.glowMaterial);
    // Its quads are spread out in the shader, beyond the bounds three.js would cull by.
    g.receiveShadow = false;
    g.visible = false;
    g.renderOrder = 1;
    g.frustumCulled = false;
    g.name = `Demo_car_blinker_glow_${side}`;
  }
  for (const [side, geo] of [
    ['left', p.lightLeft],
    ['right', p.lightRight],
  ]) {
    const l = add(geo, p.lightMaterial);
    l.visible = false;
    l.renderOrder = -1;
    l.name = `Demo_car_blinker_light_${side}`;
  }
  const tail = add(p.tailGlow, p.tailGlowMaterial);
  tail.visible = false;
  tail.renderOrder = 1;
  tail.frustumCulled = false; // as the blinkers' flares
  tail.name = 'Demo_car_tail_glow';
  cars.add(car);
  return car;
}

// The common parts of every car in `root` (a car park's, already in its scene), drawn as instanced meshes, a body and
// details per model and the shadows together: the body in each car's paint (instance colours on a white material, the same shading), the details, and the blob shadow
// under it. Brought up to date at the start of every draw of the scene (the scene's onBeforeRender, before three.js
// uploads instance data: synced from the meshes' own, the data reached the GPU a draw late, and the first draw had no
// colours at all), from the cars as they stand: a car moved, added, hidden or taken away needs nothing else.
// `capacity`: the most cars shown at once.
export function createCarInstances(root, capacity = 160) {
  const p = sharedParts();
  const paint = new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.32, metalness: 0.45});
  const models = new Map();
  for (const [name, parts] of Object.entries(p.models)) {
    const body = new THREE.InstancedMesh(parts.body, paint, capacity),
      details = new THREE.InstancedMesh(parts.details, p.detailMaterial, capacity);
    body.name = `Demo_cars_body_${name}`;
    details.name = `Demo_cars_details_${name}`;
    body.receiveShadow = details.receiveShadow = true;
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    models.set(name, {body, details});
  }
  const blob = new THREE.InstancedMesh(p.blob, p.blobMaterial, capacity);
  blob.name = 'Demo_cars_blob';
  blob.renderOrder = -1;
  const meshes = [...[...models.values()].flatMap(({body, details}) => [body, details]), blob];
  const colour = new THREE.Color(),
    lift = new THREE.Matrix4().makeTranslation(0, 0.025, 0),
    under = new THREE.Matrix4();
  for (const mesh of meshes) {
    // The cars move every frame, beyond any bounds worked out once.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    root.add(mesh);
  }
  const scene = root.parent,
    before = scene.onBeforeRender;
  scene.onBeforeRender = function (...args) {
    before.apply(this, args);
    sync();
  };
  function sync() {
    for (const mesh of meshes) mesh.count = 0;
    for (const car of cars) {
      if (!car.parent) {
        cars.delete(car);
        continue;
      }
      if (car.parent !== root || !car.visible || blob.count >= capacity) continue;
      const {body, details} = models.get(car.userData.model),
        n = body.count;
      body.setMatrixAt(n, car.matrix);
      details.setMatrixAt(n, car.matrix);
      body.setColorAt(n, colour.set(car.userData.paint));
      blob.setMatrixAt(blob.count, under.multiplyMatrices(car.matrix, lift));
      body.count = details.count = n + 1;
      blob.count++;
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
    for (const {body} of models.values()) body.instanceColor.needsUpdate = true;
  }
  return {
    dispose() {
      scene.onBeforeRender = before;
      for (const mesh of meshes) {
        mesh.removeFromParent();
        mesh.dispose();
      }
      paint.dispose();
    },
  };
}

// Lamps and plate at night: a car with its engine on shows its lamps (and plate) bright; a parked one at night is
// dim, as unlit paint would be. In daytime both look as drawn. Each car's plate material is its own (one per plate;
// through-traffic shares one, and it is always on the move).
export function setCarLamps(car, on, night) {
  const [decals, pool, beams] = car.children;
  decals.material.color.setScalar(!night || on ? 1 : 0.3);
  pool.visible = beams.visible = car.children[9].visible = night && on;
}

// The blinkers (children 3 and 4, their flares 5 and 6, their light on the road 7 and 8; 9 is the tail lamps' glow): `side` is 'left', 'right'
// or null; `lit` is the flash's on half.
export function setCarBlinker(car, side, lit) {
  car.children.slice(3, 9).forEach((o, i) => {
    o.visible = side === (i % 2 ? 'right' : 'left') && lit;
  });
}

export function disposeCars() {
  if (!shared) return;
  for (const {body, details} of Object.values(shared.models)) {
    body.dispose();
    details.dispose();
  }
  for (const k of [
    'decals',
    'blob',
    'pool',
    'beam',
    'blinkLeft',
    'blinkRight',
    'glowLeft',
    'glowRight',
    'lightLeft',
    'lightRight',
    'tailGlow',
  ])
    shared[k].dispose();
  for (const k of [
    'detailMaterial',
    'blobMaterial',
    'blobTexture',
    'poolMaterial',
    'poolTexture',
    'beamMaterial',
    'blinkMaterial',
    'glowMaterial',
    'tailGlowMaterial',
    'lightMaterial',
    'lightTexture',
  ])
    shared[k].dispose();
  for (const m of plateCache.values()) {
    m.map.dispose();
    m.dispose();
  }
  plateCache.clear();
  shared = null;
}
