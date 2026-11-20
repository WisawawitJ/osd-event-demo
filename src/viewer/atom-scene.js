// Scene effects for the ATOM page: x-ray materials, cooling plumes under running
// FCUs, room floors tinted by live temperature (or by people and CO₂), and the energy flow (floors glowing by
// kW, lines from the roof panels and the grid). Animation runs only while a system
// overlay is shown; otherwise the viewer keeps rendering on demand.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {createHeat, peopleRamp, co2Ramp} from 'osd/viewer/atom-heat.js';

const GHOST_EDGES = new Set(['wall', 'glass', 'column', 'facade', 'roof', 'stair', 'door']);

export function createAtomScene({scene, model, floorRoots, rooms, units, stalls = [], schedule, setLitRooms = () => {}}) {
  const originals = new Map(), edges = [];
  const ghost = new THREE.MeshBasicMaterial({color: '#6fd3e0', transparent: true, opacity: .045, depthWrite: false, side: THREE.DoubleSide});
  const plate = new THREE.MeshBasicMaterial({color: '#173845', transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide});
  const edgeMaterial = new THREE.LineBasicMaterial({color: '#6fd3e0', transparent: true, opacity: .3, depthWrite: false});
  let xray = false, system = 'none', live = null, frame = 0;

  function setXray(on) {
    if (on === xray) return;
    xray = on;
    model.traverse(object => {
      if (!object.isMesh) return;
      const type = object.userData.type;
      if (type === 'device' || type === 'solar' || object.userData.atomOverlay) return;
      if (on) {
        originals.set(object, {material: object.material, castShadow: object.castShadow});
        object.material = type === 'floor' ? plate : ghost;
        object.castShadow = false;
        if (type === 'ceiling') object.userData.atomHidden = object.visible, object.visible = false;
        if (GHOST_EDGES.has(type)) {
          if (!object.userData.atomEdges) {
            const line = new THREE.LineSegments(new THREE.EdgesGeometry(object.geometry, 35), edgeMaterial);
            line.userData.atomOverlay = true; line.raycast = () => {};
            object.add(line); object.userData.atomEdges = line; edges.push(line);
          }
          object.userData.atomEdges.visible = true;
        }
      } else {
        const saved = originals.get(object);
        if (saved) { object.material = saved.material; object.castShadow = saved.castShadow; }
        if (object.userData.atomEdges) object.userData.atomEdges.visible = false;
        if (type === 'ceiling' && 'atomHidden' in object.userData) object.visible = object.userData.atomHidden;
      }
    });
    if (!on) originals.clear();
    schedule();
  }

  // Cooling plume: an open cone of light under each running FCU, bands drifting down.
  const plumeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {time: {value: 0}, color: {value: new THREE.Color('#5fd0ff')}},
    vertexShader: 'varying float h; void main(){ h = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform float time; uniform vec3 color; varying float h; void main(){ float d = clamp(-h/1.6,0.,1.); float band = .55 + .45*sin(d*18. + time*4.); gl_FragColor = vec4(color, (1.-d)*(1.-d)*.32*band); }',
  });
  const faultMaterial = new THREE.MeshBasicMaterial({color: '#ff5a5a', transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide});
  const coneGeometry = new THREE.CylinderGeometry(.35, 1.25, 1.6, 32, 1, true).translate(0, -.8, 0);
  const ringGeometry = new THREE.RingGeometry(.55, .7, 40).rotateX(-Math.PI / 2);
  const effects = new Map(units.map(unit => {
    const root = floorRoots[unit.floor - 1], [x, y, z] = unit.position;
    const plume = new THREE.Mesh(coneGeometry, plumeMaterial);
    plume.position.set(x, unit.type === 'wall' ? y - .1 : y - .02, z);
    const ring = new THREE.Mesh(ringGeometry, faultMaterial);
    ring.position.set(x, y - .05, z);
    for (const mesh of [plume, ring]) { mesh.visible = false; mesh.renderOrder = 5; mesh.raycast = () => {}; mesh.userData.atomOverlay = true; root.add(mesh); }
    return [unit.id, {plume, ring}];
  }));

  // Smooth temperature field across each floor (replaces solid per-room tints).
  const heat = createHeat({THREE, floorRoots, units, schedule});
  // The people and air-quality layers: the same field over the room centres, one ramp each.
  const roomPoints = rooms.filter(room => Array.isArray(room.center)).map(room => ({id: room.id, floor: room.floor, position: room.center}));
  const layers = {people: createHeat({THREE, floorRoots, points: roomPoints, ramp: peopleRamp, schedule}),
    air: createHeat({THREE, floorRoots, points: roomPoints, ramp: co2Ramp, schedule})};
  // kind: 'people' (people ÷ capacity) | 'air' (CO₂ ppm) | null; values: {[roomId]: number}.
  function setLayer(kind, values = {}) {
    for (const [key, layer] of Object.entries(layers)) {
      if (key === kind) layer.setValues(new Map(Object.entries(values || {})));
      layer.setVisible(key === kind);
    }
  }

  // Night glow: a small warm haze under each lit room's ceiling light so the lit rooms read
  // from the overview. Depth-tested and at most 2.5 m wide, so walls, floors and the facade
  // hide it: it shows only where the room is seen through glass or an opening.
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const g = glowCanvas.getContext('2d'), gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,178,96,1)'); gradient.addColorStop(1, 'rgba(255,178,96,0)');
  g.fillStyle = gradient; g.fillRect(0, 0, 64, 64);
  const glowMaterial = new THREE.SpriteMaterial({map: new THREE.CanvasTexture(glowCanvas), transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true});
  const glows = new Map(rooms.map(room => {
    const sprite = new THREE.Sprite(glowMaterial), [x, y, z] = room.lightPosition;
    sprite.position.set(x, 1.3, z);
    sprite.scale.setScalar(Math.min(2.5, Math.max(1.5, (room.lightRadius || 2) * 1.1)));
    sprite.visible = false; sprite.raycast = () => {}; sprite.userData.atomOverlay = true;
    floorRoots[room.floor - 1].add(sprite);
    return [room.id, sprite];
  }));

  // Night glass: each floor's glazing takes a warm tint by the share of its rooms with a light
  // that are lit, so the light stays within the glass. One glazing mesh per floor; its own
  // materials (the viewer's cutaway clones) are tinted in place and their day values restored.
  const WARM = new THREE.Color('#ffb466'), GLASS_GLOW = .75;
  const floorGlass = floorRoots.map(root => {
    const out = [];
    root.traverse(object => {
      if (!object.isMesh || object.userData.type !== 'glass') return;
      for (const material of [].concat(object.material)) if (material.emissive) out.push({material, emissive: material.emissive.clone(), intensity: material.emissiveIntensity});
    });
    return out;
  });
  const floorLightRooms = floorRoots.map((_, i) => rooms.filter(room => room.floor === i + 1 && room.capabilities?.light !== false).map(room => room.id));
  function tintGlass(litRoomIds) {
    let tinted = 0;
    floorGlass.forEach((glass, i) => {
      const ids = floorLightRooms[i], share = litRoomIds && ids.length ? ids.filter(id => litRoomIds.has(id)).length / ids.length : 0;
      for (const {material, emissive, intensity} of glass) {
        if (share > 0) { material.emissive.copy(WARM); material.emissiveIntensity = GLASS_GLOW * share; tinted++; }
        else { material.emissive.copy(emissive); material.emissiveIntensity = intensity; }
      }
    });
    return tinted;
  }

  // Energy flow (solar view): each floor glows by its kW, 0..8 kW as opacity 0..1 (additive,
  // a dark amber, so full opacity stays soft), and lines run from the roof panels (sun), from
  // the ground west of the building (grid) and from the battery east of it into each floor,
  // pulses moving along them. The battery line shows only while it charges or discharges
  // (pulses run into the battery when it charges).
  const FLOOR_KEYS = ['1', '2', '3', '4', 'roof'], FULL_KW = 8;
  const glowBoxMaterial = () => new THREE.MeshBasicMaterial({color: '#8a5514', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false});
  const flowMaterial = color => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: {time: {value: 0}, opacity: {value: 0}, direction: {value: 1}, color: {value: new THREE.Color(color)}},
    vertexShader: 'varying float u; void main(){ u = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform float time; uniform float opacity; uniform float direction; uniform vec3 color; varying float u; void main(){ float p = smoothstep(.55,1.,fract(u*5. - time*.7*direction)); gl_FragColor = vec4(color, opacity*(.3 + .7*p)); }',
  });
  const footprint = root => {
    const box = new THREE.Box3();
    root.traverse(object => { if (object.isMesh && object.userData.type === 'floor') box.expandByObject(object); });
    return box.isEmpty() ? new THREE.Box3().setFromObject(root) : box;
  };
  const modelBox = new THREE.Box3().setFromObject(model), panels = model.getObjectByName('Floor_5_solar_modules');
  const sun = panels ? new THREE.Box3().setFromObject(panels).getCenter(new THREE.Vector3()) : new THREE.Vector3(modelBox.getCenter(new THREE.Vector3()).x, modelBox.max.y, modelBox.getCenter(new THREE.Vector3()).z);
  const grid = new THREE.Vector3(modelBox.min.x - 3, modelBox.min.y, modelBox.getCenter(new THREE.Vector3()).z);
  const battery = new THREE.Vector3(modelBox.max.x + 2, modelBox.min.y, modelBox.getCenter(new THREE.Vector3()).z);
  const energy = new Map(FLOOR_KEYS.map((key, index) => {
    const root = floorRoots[index];
    if (!root) return [key, null];
    const box = footprint(root), base = box.min.y, height = Math.min(3.4, Math.max(2.4, new THREE.Box3().setFromObject(root).max.y - base));
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const glow = new THREE.Mesh(new THREE.BoxGeometry(size.x + .3, height, size.z + .3), glowBoxMaterial());
    glow.position.copy(root.worldToLocal(new THREE.Vector3(center.x, base + height / 2, center.z)));
    const target = new THREE.Vector3(center.x, base + height * .45, center.z);
    const tube = (from, color) => {
      const mid = from.clone().lerp(target, .5).add(new THREE.Vector3(0, 1.5, 0));
      const curve = new THREE.QuadraticBezierCurve3(...[from, mid, target].map(v => root.worldToLocal(v.clone())));
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, .09, 6, false), flowMaterial(color));
    };
    const lines = [tube(sun, '#ffc44d'), tube(grid, '#4fb3ff')], store = tube(battery, '#7dffb0');
    for (const mesh of [glow, ...lines, store]) { mesh.visible = false; mesh.renderOrder = 7; mesh.raycast = () => {}; mesh.userData.atomOverlay = true; root.add(mesh); }
    return [key, {glow, lines, store}];
  }));
  const EVEN_LEVEL = .2;
  let floorEnergy = null, batteryDirection = 0, even = false, flowFrame = 0;
  function refreshEnergy() {
    const on = system === 'solar' && floorEnergy !== null;
    for (const [key, parts] of energy) {
      if (!parts) continue;
      const kw = Number(floorEnergy?.[key]), level = even ? EVEN_LEVEL : Number.isFinite(kw) ? Math.min(1, Math.max(0, kw / FULL_KW)) : 0;
      parts.glow.material.opacity = level;
      parts.glow.visible = on && level > 0;
      for (const line of parts.lines) { line.material.uniforms.opacity.value = .35 + .65 * level; line.visible = on && level > 0; }
      parts.store.material.uniforms.opacity.value = .35 + .65 * level;
      // The tube runs battery → floor; charging sends the pulses back into the battery.
      parts.store.material.uniforms.direction.value = batteryDirection > 0 ? -1 : 1;
      parts.store.visible = on && level > 0 && batteryDirection !== 0;
    }
    if (on && !flowFrame) flowFrame = requestAnimationFrame(flowTick);
    if (!on && flowFrame) { cancelAnimationFrame(flowFrame); flowFrame = 0; }
    schedule();
  }
  function flowTick(time) {
    flowFrame = 0;
    for (const parts of energy.values()) for (const line of parts ? [...parts.lines, parts.store] : []) line.material.uniforms.time.value = time / 1000;
    schedule();
    if (system === 'solar' && floorEnergy !== null) flowFrame = requestAnimationFrame(flowTick);
  }
  // floors: {'1'..'4', roof: kW} or null; batteryW: + charging, − discharging (shown past
  // 100 W either way); even: one neutral level for every floor (the replay has no floor
  // history). Returns each floor's glow level (0..1), or null.
  function setFloorEnergy(floors, {batteryW = null, even: evenLevel = false} = {}) {
    floorEnergy = floors || null;
    batteryDirection = Number.isFinite(batteryW) && Math.abs(batteryW) > 100 ? Math.sign(batteryW) : 0;
    even = Boolean(evenLevel);
    refreshEnergy();
    return floorEnergy && Object.fromEntries([...energy].filter(([, parts]) => parts).map(([key, parts]) => [key, Math.round(parts.glow.material.opacity * 100) / 100]));
  }

  function roomTemp(roomId) {
    const values = units.filter(unit => unit.room === roomId).map(unit => live?.units?.[unit.id]?.current).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  function refresh() {
    const air = system === 'air';
    for (const unit of units) {
      const state = live?.units?.[unit.id]?.state, {plume, ring} = effects.get(unit.id);
      plume.visible = air && state === 'cool';
      ring.visible = air && state === 'fault';
    }
    heat.setTemps(new Map(units.map(unit => [unit.id, live?.units?.[unit.id]?.current ?? null])));
    heat.setVisible(air);
    const animate = air && units.some(unit => effects.get(unit.id).plume.visible || effects.get(unit.id).ring.visible);
    if (animate && !frame) frame = requestAnimationFrame(tick);
    schedule();
  }

  function tick(time) {
    frame = 0;
    plumeMaterial.uniforms.time.value = time / 1000;
    faultMaterial.opacity = .45 + .4 * Math.sin(time / 180);
    schedule();
    if (system === 'air') frame = requestAnimationFrame(tick);
  }

  // Parked car blocks on the modelled stalls: min(stalls, round(occupied x stalls / capacity)), from the first stall.
  const carColours = ['#c9ced3', '#2f3a45', '#8b2f2f', '#d9d4c4', '#3b5a78', '#5f6b62'];
  const carBox = new THREE.BoxGeometry(1, 1, 1);
  const cars = stalls.map((stall, i) => {
    const xs = stall.footprint.map(p => p[0]), zs = stall.footprint.map(p => p[1]);
    const mesh = new THREE.Mesh(carBox, new THREE.MeshStandardMaterial({color: carColours[i % carColours.length], roughness: .55, metalness: .25}));
    mesh.scale.set(4.2, 1.35, 1.8);
    mesh.position.set((Math.min(...xs) + Math.max(...xs)) / 2 - .1, .02 + .675, (Math.min(...zs) + Math.max(...zs)) / 2);
    mesh.userData = {type: 'parked_car', atomOverlay: true, parkedCar: stall.id};
    mesh.raycast = () => {};
    mesh.castShadow = true; mesh.visible = false;
    return mesh;
  });
  const lot = cars.length ? floorRoots[0]?.getObjectByName('Parking') : null;
  if (lot) lot.add(...cars);
  function setParking(parking) {
    if (!lot || !Number.isFinite(parking?.capacity) || !Number.isFinite(parking?.occupied) || parking.capacity <= 0) return;
    const shown = Math.min(cars.length, Math.max(0, Math.round(parking.occupied * cars.length / parking.capacity)));
    let changed = false;
    cars.forEach((car, i) => { if (car.visible !== i < shown) { car.visible = i < shown; changed = true; } });
    document.documentElement.dataset.parkedCars = String(shown); // read by the kiosk test
    if (changed) schedule();
  }

  return {
    setXray,
    get xray() { return xray; },
    setSystem(next) { system = next; if (frame && next !== 'air') { cancelAnimationFrame(frame); frame = 0; } refresh(); refreshEnergy(); },
    setLive(next) { live = next; setParking(next?.parking); refresh(); },
    // Night rooms: the building's own room lights (ceiling fixtures, and spot lights in the lit
    // rooms nearest the camera) follow the lit set; null puts back every room with a light.
    setNightRooms(litRoomIds) {
      setLitRooms(litRoomIds);
      const glassTinted = tintGlass(litRoomIds);
      for (const [id, sprite] of glows) sprite.visible = Boolean(litRoomIds?.has(id));
      schedule();
      // Read by the kiosk test: lit rooms, room spot lights on, anything drawn through walls, tinted glass.
      let spots = 0, throughWalls = 0;
      scene.traverseVisible(object => {
        if (object.isSpotLight) spots++;
        if ((object.isMesh || object.isSprite) && [].concat(object.material).some(m => m.depthTest === false)) throughWalls++;
      });
      Object.assign(document.documentElement.dataset, {nightLit: litRoomIds ? String(litRoomIds.size) : '', nightSpots: String(spots), nightThroughWalls: String(throughWalls), glassTinted: String(glassTinted)});
    },
    setFloorEnergy,
    setLayer,
    roomTemp,
  };
}
