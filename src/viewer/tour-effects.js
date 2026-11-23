import * as T from 'osd/node_modules/three/build/three.module.js';
import {realNow, ramp} from 'osd/core/clock.js';
import {createLightConeMaterial, createLightConeGeometry} from 'osd/core/light-cone.js';
import {SEATS} from 'osd/viewer/building.js';
import {createPeople} from 'osd/viewer/people.js';
// Presentation-only objects. No bindings to hardware or Home Assistant.
// `redrawShadows()`: what throws a shadow has changed.
export function createTourEffects({model, schedule, meetingRoom, redrawShadows = () => {}}) {
  const groups = {},
    owned = [],
    materials = [];
  let current = 'overview';
  const root = (n) => model.getObjectByName(`Floor_${n}`);
  const group = (id, n) => {
    const g = new T.Group();
    g.name = `Demo_${id}`;
    g.userData = {tourEffect: true};
    root(n).add(g);
    groups[id] = g;
    return g;
  };
  const mat = (color, opacity = 1) => {
    const m = new T.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
      side: T.DoubleSide,
      forceSinglePass: true,
    });
    materials.push(m);
    return m;
  };
  const mesh = (g, geometry, material, position) => {
    const o = new T.Mesh(geometry, material);
    if (position) o.position.set(...position);
    g.add(o);
    owned.push(geometry);
    return o;
  };
  const meeting = group('meeting', meetingRoom.floor),
    room = [meetingRoom.center[0], meetingRoom.center[2]];
  const people = createPeople({seats: SEATS});
  for (const {figure} of people.figures) meeting.add(figure);
  // Air from the room's own AC unit (a two-way ceiling cassette, FCU 4-3 here): dashed curves leave both long
  // slots and fall outward. The unit is found in the model, so the air starts where the AC actually is.
  const air = [];
  {
    const floorRoot = root(meetingRoom.floor);
    let unit = null;
    floorRoot.traverse((o) => {
      if (
        !unit &&
        o.userData.deviceKind === 'climate' &&
        o.userData.roomId === meetingRoom.id &&
        !o.name.includes('_led_')
      )
        unit = o;
    });
    const box = unit ? new T.Box3().setFromObject(unit) : null;
    if (box) {
      floorRoot.worldToLocal(box.min);
      floorRoot.worldToLocal(box.max);
    }
    const center = box ? box.getCenter(new T.Vector3()) : new T.Vector3(room[0] + 0.92, 2.65, room[1]),
      size = box ? box.getSize(new T.Vector3()) : new T.Vector3(0.9, 0.2, 0.9);
    // Slots run along the unit's long side; air leaves across it, on both sides.
    const across = size.x < size.z ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, 1),
      along = across.x ? new T.Vector3(0, 0, 1) : new T.Vector3(1, 0, 0);
    const half = (across.x ? size.x : size.z) / 2,
      length = Math.max(0.5, (along.x ? size.x : size.z) * 0.7),
      top = box ? box.min.y : center.y - 0.05;
    for (const side of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const offset = along.clone().multiplyScalar(((i - 1) * length) / 2),
          out = across.clone().multiplyScalar(side);
        const start = center.clone().add(offset).addScaledVector(out, half);
        start.y = top;
        const points = [
          start,
          start
            .clone()
            .addScaledVector(out, 0.45)
            .setY(top - 0.45),
          start
            .clone()
            .addScaledVector(out, 0.95)
            .setY(top - 1.05),
        ];
        const geom = new T.BufferGeometry().setFromPoints(new T.QuadraticBezierCurve3(...points).getPoints(24));
        owned.push(geom);
        const m = new T.LineDashedMaterial({
          color: '#4eabc5',
          dashSize: 0.14,
          gapSize: 0.12,
          transparent: true,
          opacity: 0.6,
        });
        materials.push(m);
        const line = new T.Line(geom, m);
        line.computeLineDistances();
        meeting.add(line);
        air.push(line);
      }
  }
  // The room light, visible by day too: a soft downlight cone and a warm pool on the floor while it is on.
  const lamp = [];
  {
    const glow = document.createElement('canvas');
    glow.width = glow.height = 128;
    const c = glow.getContext('2d'),
      g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    const glowMap = new T.CanvasTexture(glow);
    const [lx, ly, lz] = meetingRoom.lightPosition || [room[0], 2.65, room[1]];
    const poolMaterial = new T.MeshBasicMaterial({
      color: '#ffcf73',
      map: glowMap,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    materials.push(poolMaterial);
    poolMaterial.userData.glowMap = glowMap;
    const pool = mesh(meeting, new T.CircleGeometry(1.9, 40), poolMaterial, [lx, 0.06, lz]);
    pool.rotation.x = -Math.PI / 2;
    lamp.push(pool);
    // The cone of lit air under the lamp (light-cone.js).
    const cone = {height: ly - 0.1, top: 0.45, bottom: 1.7},
      beamMaterial = createLightConeMaterial({color: '#ffd88a', ...cone, strength: 1.3});
    materials.push(beamMaterial);
    const beam = mesh(meeting, createLightConeGeometry(cone), beamMaterial, [lx, cone.height / 2 + 0.05, lz]);
    lamp.push(beam);
  }
  const pond = group('pond', 1),
    pondMaterial = mat('#1b9caa', 0.8),
    pondRing = mesh(pond, new T.TorusGeometry(0.23, 0.028, 8, 36), pondMaterial, [23.2, 0.32, 0]);
  pondRing.rotation.x = -Math.PI / 2;
  mesh(pond, new T.CylinderGeometry(0.045, 0.045, 0.45, 12), mat('#3f6975'), [23.2, 0.3, 0]);
  const energy = group('energy', 5),
    energyMaterial = mat('#21a790', 0.75);
  const path = new T.BufferGeometry().setFromPoints([
    new T.Vector3(-1.4, 0.16, -5.9),
    new T.Vector3(-1.4, 0.16, 6.1),
    new T.Vector3(4, 0.16, 6.1),
  ]);
  owned.push(path);
  const lm = new T.LineDashedMaterial({color: '#239b87', dashSize: 0.22, gapSize: 0.18});
  materials.push(lm);
  const flow = new T.Line(path, lm);
  flow.computeLineDistances();
  energy.add(flow);
  const packet = mesh(energy, new T.SphereGeometry(0.09, 10, 8), energyMaterial, [-1.4, 0.2, 1]);

  // Each stop's effects fade in as the camera arrives and out as it leaves (~0.45 s), like the room's own light: switched
  // on in one frame, the meeting room's light cone and pool popped up while the room light came on smoothly. A
  // material's opacity is what its effect wants (the lamp's and the air's own fades, the solar flow's strength) times
  // its stop's level.
  // Every effect material is drawn as transparent from the start (an opaque one turned transparent for a fade would
  // need another shader, built on the spot). They are drawn after the building's own see-through surfaces: sorted
  // with them by distance, the meeting room's glazing (one mesh around the room, its centre near the light's) was
  // drawn after the light cone from some sides and over it from others, so the cone's top turned bright or faint as
  // the camera turned.
  // Every fade here is on the demo's clock (clock.js ramp): a function of the time, the same at the same moment however
  // many frames are drawn (stepped frame by frame, with each step capped, a fade got further or less far with the frame
  // rate); paused, it holds. `sync` brings everything to the moment, before each draw too (beforeDraw).
  const stops = {},
    own = new Map(),
    stopOf = new Map();
  for (const [id, g] of Object.entries(groups)) {
    stops[id] = ramp(450, 0);
    g.traverse((o) => {
      o.renderOrder ||= 1; // (the people's is their own)
      for (const m of [].concat(o.material || [])) {
        stopOf.set(m, id);
        own.set(m, m.opacity);
        m.transparent = true;
      }
    });
  }
  // The AC's air: fades in and out with the switch, and while it is on the dashes flow down from the unit. The room
  // light's pool and beam fade in and out (~0.35 s), and the people come and go one after another (the meeting starting
  // or ending).
  const air_ = ramp(350, 1),
    lampFade = ramp(350, 1),
    peopleFade = ramp(1100, 1);
  const airBase = air.map((o) => o.material.opacity),
    lampBase = lamp.map((o) => own.get(o.material)),
    peopleBase = people.figures.map((p) => p.materials.map((m) => own.get(m)));
  for (const line of air) line.userData.distances = Float32Array.from(line.geometry.attributes.lineDistance.array);
  let airShift = -1;
  function sync(now = realNow()) {
    const airLevel = air_.value(now),
      lampLevel = lampFade.value(now),
      peopleLevel = peopleFade.value(now);
    const shift = ((now / 1000) * 0.35) % 0.26; // demo time: the air stands still while paused
    if (shift !== airShift) {
      airShift = shift;
      for (const o of air) {
        const d = o.geometry.attributes.lineDistance,
          base = o.userData.distances;
        for (let j = 0; j < base.length; j++) d.array[j] = base[j] - shift;
        d.needsUpdate = true;
      }
    }
    air.forEach((o, i) => {
      o.visible = airLevel > 0.001;
      own.set(o.material, airBase[i] * airLevel);
    });
    lamp.forEach((o, i) => {
      own.set(o.material, lampBase[i] * lampLevel);
      o.visible = lampLevel > 0.001;
    });
    const meetingLevel = stops.meeting.value(now);
    people.figures.forEach((person, i) => {
      const level = Math.min(1, Math.max(0, peopleLevel * 2 - i * 0.2)); // one after another
      person.figure.visible = level > 0.001;
      person.materials.forEach((m, k) => own.set(m, peopleBase[i][k] * level));
      if (people.castShadow(person, level * meetingLevel > 0.5)) redrawShadows();
    });
    people.pose(now / 1000);
    for (const [m, opacity] of own) m.opacity = opacity * stops[stopOf.get(m)].value(now);
    for (const [id, g] of Object.entries(groups)) g.visible = stops[id].value(now) > 0.001;
  }
  // Frames keep coming while a fade runs, and while the meeting room's air flows or its people move.
  let frame = 0;
  const busy = (now) =>
    [...Object.values(stops), air_, lampFade, peopleFade].some((r) => !r.done(now)) ||
    (current === 'meeting' && (air_.value(now) > 0 || peopleFade.value(now) > 0) && !document.hidden);
  function step() {
    frame = 0;
    const now = realNow();
    sync(now);
    schedule();
    if (busy(now)) frame = requestAnimationFrame(step);
  }
  const run = () => {
    if (!frame) frame = requestAnimationFrame(step);
  };
  let started = false;
  function select(id) {
    current = id;
    for (const name of Object.keys(groups)) {
      if (started) stops[name].set(name === id ? 1 : 0);
      else stops[name].jump(name === id ? 1 : 0);
    }
    started = true;
    sync();
    schedule();
    run();
  }
  function update(state) {
    peopleFade.set(state.occupied ? 1 : 0);
    lampFade.set(state.light !== false ? 1 : 0);
    air_.set(state.climate ? 1 : 0);
    if (current !== 'meeting') {
      air_.jump(state.climate ? 1 : 0);
      peopleFade.jump(state.occupied ? 1 : 0);
    }
    pondMaterial.color.set(state.pondAlert ? '#d58c26' : '#1b9caa');
    packet.visible = state.solar > 0;
    own.set(energyMaterial, state.solar > 5 ? 0.8 : 0.35);
    sync();
    schedule();
    run();
  }
  function animate(t) {
    if (current === 'meeting')
      air.forEach((o, i) => {
        o.material.dashSize = 0.12 + 0.035 * Math.sin(t * 2 + i);
      });
    if (current === 'energy') packet.position.z = -5.9 + ((t * 0.9) % 12);
    schedule();
  }
  select('overview');
  return {
    select,
    update,
    animate,
    beforeDraw: () => sync(),
    dispose() {
      cancelAnimationFrame(frame);
      for (const g of Object.values(groups)) g.removeFromParent();
      people.dispose();
      for (const g of owned) g.dispose();
      for (const m of materials) {
        m.userData.glowMap?.dispose();
        m.dispose();
      }
    },
  };
}
