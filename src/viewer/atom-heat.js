// Smooth per-floor value field: the air view's temperatures, and the people and air-quality
// layers. The field is computed on a small texture by inverse-distance weighting of point
// values (FCU room temperatures, or room values at the room centres) and shaded onto copies
// of the floor meshes, so it follows the real floor shape.
const BLUE = [0x3a, 0x7b, 0xff], GREEN = [0x5f, 0xd3, 0x6b], AMBER = [0xf5, 0xb9, 0x42], RED = [0xef, 0x5a, 0x3c];

// A colour ramp from [value, [r, g, b]] stops, clamped at both ends.
export function makeRamp(stops) {
  return t => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [t1, c1] = stops[i], [t0, c0] = stops[i - 1];
      if (t <= t1) { const k = (t - t0) / (t1 - t0); return c0.map((v, j) => Math.round(v + (c1[j] - v) * k)); }
    }
    return stops.at(-1)[1];
  };
}

// Room temperature, °C (the air view).
export const rampColor = makeRamp([[22, BLUE], [24, [0x35, 0xd0, 0xe0]], [26, GREEN], [28, [0xf2, 0xd0, 0x4b]], [30, RED]]);
// People ÷ capacity: blue when quiet, amber when busy, red when full.
export const peopleRamp = makeRamp([[0, BLUE], [.8, AMBER], [1.2, RED]]);
// CO₂ ppm: green under 800, amber 800–1000, red over 1000 (short blends at the edges).
export const co2Ramp = makeRamp([[780, GREEN], [820, AMBER], [980, AMBER], [1020, RED]]);

// points: [{x, z, t}] in floor-local metres. Alpha fades to 0 at `reach` metres from the nearest sensor.
export function heatField(points, bounds, [width, height] = [96, 72], power = 2, reach = 6, ramp = rampColor) {
  const usable = points.filter(p => Number.isFinite(p.t) && Number.isFinite(p.x) && Number.isFinite(p.z));
  const data = new Uint8Array(width * height * 4);
  if (!usable.length) return {data, width, height};
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const x = bounds.minX + (i + .5) / width * (bounds.maxX - bounds.minX), z = bounds.minZ + (j + .5) / height * (bounds.maxZ - bounds.minZ);
    let sum = 0, weights = 0, nearest = Infinity;
    for (const p of usable) {
      const d = Math.max(.3, Math.hypot(p.x - x, p.z - z)), w = 1 / d ** power;
      sum += w * p.t; weights += w; nearest = Math.min(nearest, d);
    }
    const [r, g, b] = ramp(sum / weights), k = (j * width + i) * 4;
    data[k] = r; data[k + 1] = g; data[k + 2] = b;
    data[k + 3] = Math.round(255 * .6 * Math.max(0, Math.min(1, 1 - nearest / reach)));
  }
  return {data, width, height};
}

// THREE is passed in so the pure functions above stay importable in Node tests.
// points: [{id, floor, position: [x, y, z]}] in floor-local metres (default: the FCUs).
export function createHeat({THREE, floorRoots, units, points = units, schedule, ramp = rampColor}) {
  const floors = floorRoots.map((root, index) => {
    root.updateWorldMatrix(true, true);
    const toFloor = new THREE.Matrix4().copy(root.matrixWorld).invert(), meshes = [];
    root.traverse(object => { if (object.isMesh && object.userData.type === 'floor' && !object.userData.atomOverlay) meshes.push(object); });
    const box = new THREE.Box3();
    for (const mesh of meshes) box.union(new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(new THREE.Matrix4().multiplyMatrices(toFloor, mesh.matrixWorld)));
    const bounds = {minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z};
    const empty = heatField([], bounds);
    const texture = new THREE.DataTexture(empty.data, empty.width, empty.height, THREE.RGBAFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {field: {value: texture}, bounds: {value: new THREE.Vector4(bounds.minX, bounds.minZ, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)}, toFloor: {value: new THREE.Matrix4()}},
      vertexShader: 'uniform mat4 toFloor; varying vec2 vXZ; void main(){ vec4 p = toFloor * vec4(position,1.); vXZ = p.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform sampler2D field; uniform vec4 bounds; varying vec2 vXZ; void main(){ vec4 c = texture2D(field, (vXZ - bounds.xy) / bounds.zw); if (c.a < .01) discard; gl_FragColor = c; }',
    });
    const overlays = meshes.map(mesh => {
      const overlay = new THREE.Mesh(mesh.geometry, material.clone());
      overlay.material.uniforms.field = material.uniforms.field;
      overlay.material.uniforms.toFloor.value.multiplyMatrices(toFloor, mesh.matrixWorld);
      overlay.position.copy(mesh.position); overlay.quaternion.copy(mesh.quaternion); overlay.scale.copy(mesh.scale);
      overlay.position.y += .02; overlay.renderOrder = 3; overlay.visible = false; overlay.raycast = () => {};
      overlay.userData.atomOverlay = true;
      mesh.parent.add(overlay);
      return overlay;
    });
    return {floor: index + 1, bounds, texture, overlays, points: points.filter(point => point.floor === index + 1)};
  });

  // values: Map<pointId, number|null>; points without a number leave their area untinted.
  function setValues(values) {
    for (const f of floors) {
      const field = heatField(f.points.map(point => ({x: point.position[0], z: point.position[2], t: values.get(point.id)})), f.bounds, undefined, undefined, undefined, ramp);
      f.texture.image.data.set(field.data);
      f.texture.needsUpdate = true;
    }
    schedule();
  }
  return {
    setVisible(on) { for (const f of floors) for (const o of f.overlays) o.visible = on; schedule(); },
    // temps: Map<unitId, number|null>; any unit reporting a room temperature counts, running or not.
    setTemps: setValues,
    setValues,
  };
}
