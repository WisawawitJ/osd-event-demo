// This module is deliberately local: device state never leaves this page.
// spotLights / shadowSpots: the night room light pool and how many of it cast shadows.
import {L} from 'osd/parking/i18n.js';
import {demoNow} from 'osd/parking/clock.js';

// Texts follow the saved TH/EN choice. The device map names rooms in Thai; English names are kept here by room id.
const ROOM_EN = {
  f1_meeting_1: 'Small meeting room 1', f1_meeting_2: 'Small meeting room 2', f1_guest: 'Guest lounge', f1_lobby: 'Waiting lobby', f1_billing: 'Billing and cheques',
  f2_admin_manager: 'Admin manager', f2_admin: 'Administration', f2_sales: 'Sales', f2_sales_manager_1: 'Sales manager 1', f2_sales_manager_2: 'Sales manager 2',
  f2_customer: 'Customer relations', f2_executive_1: 'Executive office 1', f2_executive_2: 'Executive office 2', f2_guest_meeting: 'Guest and small meetings',
  f2_documents: 'Document store', f2_secretary: 'Secretary', f3_rnd: 'R&D', f3_monitor: 'Monitor room', f3_server: 'Server room', f3_engineering: 'Engineering',
  f3_tech_manager_1: 'Engineering manager 1', f3_tech_manager_2: 'Engineering manager 2', f3_lab: 'Equipment test lab', f3_tech_manager_3: 'Engineering manager 3',
  f3_director: 'Director, floor 3', f3_meeting: 'Meeting room, floor 3', f4_seminar: 'Seminar room', f4_accounting: 'Accounting',
  f4_accounting_manager_2: 'Accounting manager 2', f4_accounting_manager_1: 'Accounting manager 1', f4_director: 'Director, floor 4', f4_meeting_2: 'Meeting room 2',
  f4_recreation: 'Recreation area', f4_kids: "Children's room", roof_stair: 'Stair hall', roof_gym: 'Gym',
};
const roomName = room => L(room.label, ROOM_EN[room.id] || room.label);
const deviceName = {light: () => L('ไฟ', 'Light'), climate: () => L('แอร์', 'AC'), door: () => L('ประตู', 'Door')};
const nightText = night => night ? L('กลางคืน · เปิดอยู่', 'Night · on') : L('กลางคืน', 'Night');

export async function createSimulation({ THREE, scene, model, floorRoots, renderer, camera, schedule,
  onSelectFloor = () => {}, onNightChange = () => {}, onNightRequest = null, spotLights = 8, shadowSpots = 2 }) {
  const response = await fetch("./model/device-map.json");
  if (!response.ok) throw new Error('Simulation map unavailable');
  const map = await response.json();
  if (map.mode !== 'simulation' || !Array.isArray(map.rooms) || !map.rooms.length) {
    throw new Error('Invalid simulation map');
  }
  const rooms = map.rooms;
  const listeners=new Set();let interactionFilter=()=>true;
  const byId = new Map(rooms.map(room => [room.id, room]));
  const states = new Map(rooms.map(room => [room.id, {
    light: room.capabilities?.light !== false, climate: false,
    doors: Object.fromEntries((room.doorIds || []).map(id => [id, false]))
  }]));
  const floors = new Map(floorRoots.map((root, index) => [String(root.userData.floor || root.name.match(/Floor_(\d+)/)?.[1] || index + 1), root]));
  const fixtures = new Map(rooms.map(room => [room.id, []]));
  const hinges = new Map();
  const originals = new Map();
  const ownedMaterials = new Set();
  const initialAngles = new Map();
  let selectedId = rooms[0].id, night = false, disposed = false;
  let view = { currentFloor: 'all', cutaway: false, exploded: false };
  const abort = new AbortController();
  const listen = (element, event, handler) => element.addEventListener(event, handler, { signal: abort.signal });

  model.traverse(object => {
    const data = object.userData;
    if (data.deviceKind === 'door' && data.doorId && !object.isMesh) {
      if (!hinges.has(data.doorId)) hinges.set(data.doorId, []);
      hinges.get(data.doorId).push(object);
      initialAngles.set(object, object.rotation.y);
    }
    if (!object.isMesh || !fixtures.has(data.roomId) || !['light', 'climate'].includes(data.deviceKind)) return;
    originals.set(object, object.material);
    const materials = [].concat(object.material).map(material => {
      const clone = material.clone();
      ownedMaterials.add(clone);
      return clone;
    });
    object.material = Array.isArray(object.material) ? materials : materials[0];
    fixtures.get(data.roomId).push(object);
  });

  const panel = document.createElement('section');
  panel.className = 'simulation';
  panel.setAttribute('aria-label', L('ทดลองควบคุมอุปกรณ์', 'Try the devices'));
  panel.innerHTML = `
    <div class="simulation-bar">
      <p class="simulation-mode">${L('จำลอง · ไม่เชื่อมต่อ Home Assistant', 'Simulated · not connected to Home Assistant')}</p>
      <button type="button" class="simulation-night" aria-pressed="false">${nightText(false)}</button>
    </div>
    <details class="simulation-details">
      <summary>${L('ทดลองอุปกรณ์', 'Try the devices')} <span class="simulation-room-summary"></span></summary>
      <div class="simulation-content">
        <label class="simulation-room-label">${L('ห้อง / พื้นที่', 'Room / area')}<select class="simulation-room"></select></label>
        <div class="simulation-devices" role="group" aria-label="${L('อุปกรณ์จำลอง', 'Simulated devices')}"></div>
        <p class="simulation-hint">${L('คลิกโคมไฟ แอร์ หรือบานประตูในโมเดลเพื่อทดลอง · สถานะจะเริ่มใหม่เมื่อโหลดหน้า', 'Click a lamp, an AC unit or a door in the model to try it · everything resets when the page reloads')}</p>
        <p class="simulation-feedback" role="status" aria-live="polite"></p>
      </div>
    </details>`;
  const main = document.querySelector('main');
  if (!main) throw new Error('Simulation requires a main element');
  const stage=main.querySelector('#viewport');stage.parentElement.insertBefore(panel,stage);
  const roomSelect = panel.querySelector('select');
  const devices = panel.querySelector('.simulation-devices');
  const summary = panel.querySelector('.simulation-room-summary');
  const feedback = panel.querySelector('.simulation-feedback');
  const nightButton = panel.querySelector('.simulation-night');
  const floorLabel = floor => String(floor) === '5' ? L('ดาดฟ้า', 'Rooftop') : L(`ชั้น ${floor}`, `Floor ${floor}`);
  for (const room of rooms) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = `${floorLabel(room.floor)} · ${roomName(room)}`;
    roomSelect.append(option);
  }

  // A fixed pool bounds lighting/shadow cost even when the map grows.
  const SPOT_INTENSITY = 135;
  // Every room's light fades on and off (~0.35 s, as the meeting room's light cone does) instead of switching in one
  // frame: its fittings' glow and its spot light follow `lightLevel` (0 off … 1 on), which runs toward the switch.
  const lightLevel = new Map(rooms.map(room => [room.id, states.get(room.id).light ? 1 : 0]));
  const LIGHT_FADE_MS = 350;
  let lightFrame = 0, lightLast = 0, dealLast = 0;
  function paintLights() {
    for (const room of rooms) {
      const level = lightLevel.get(room.id);
      for (const object of fixtures.get(room.id)) {
        if (object.userData.deviceKind !== 'light') continue;
        for (const material of [].concat(object.material)) if (material.emissive) { material.emissive.set(0xffdc9b); material.emissiveIntensity = (night ? 2.7 : .6) * level; }
      }
    }
    lights.forEach((light, i) => { const d = dealt[i]; light.intensity = d.at ? SPOT_INTENSITY * lightLevel.get(d.at.room.id) * d.presence : 0; });
    schedule();
  }
  function relight() { updateLighting(); renderer.shadowMap.needsUpdate = true; schedule(); }
  // On demo time: paused, the lights' fades and moves hold where they are.
  function lightStep() {
    const time = demoNow();
    lightFrame = 0;
    const fade = Math.max(0, time - (lightLast || time)) / LIGHT_FADE_MS; lightLast = time;
    let moving = false;
    const dd = Math.max(0, time - (dealLast || time)) / DEAL_MS; dealLast = time;
    // Paused (no demo time passed): nothing to repaint; keep watching for Resume.
    if (fade === 0 && dd === 0 && lightLast && !disposed) { lightFrame = requestAnimationFrame(lightStep); return; }
    lights.forEach((light, i) => {
      const d = dealt[i];
      if (d.next !== undefined) {
        d.presence = Math.max(0, d.presence - dd);
        if (d.presence === 0) { place(light, d, d.next); d.next = undefined; }
        moving = true; return;
      }
      const to = d.at ? 1 : 0;
      if (d.presence !== to) { d.presence = to > d.presence ? Math.min(to, d.presence + dd) : Math.max(to, d.presence - dd); if (d.presence !== to) moving = true; }
    });
    for (const room of rooms) {
      const to = states.get(room.id).light ? 1 : 0, from = lightLevel.get(room.id);
      if (from === to) continue;
      lightLevel.set(room.id, to > from ? Math.min(to, from + fade) : Math.max(to, from - fade));
      if (lightLevel.get(room.id) !== to) moving = true;
    }
    paintLights();
    if (moving && !disposed) lightFrame = requestAnimationFrame(lightStep); else lightLast = dealLast = 0;
  }
  function fadeLights() {
    if (disposed) return;
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const room of rooms) lightLevel.set(room.id, states.get(room.id).light ? 1 : 0);
      lights.forEach((light, i) => { const d = dealt[i]; if (d.next !== undefined) { place(light, d, d.next); d.next = undefined; } d.presence = d.at ? 1 : 0; });
      paintLights(); return;
    }
    if (!lightFrame) lightFrame = requestAnimationFrame(lightStep);
  }
  const lights = Array.from({ length: spotLights }, (_, index) => {
    const light = new THREE.SpotLight(0xffdda0, SPOT_INTENSITY, 14, Math.PI * .31, .8, 2);
    light.name = `Simulation_spot_${index + 1}`;
    light.visible = false;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = .15;
    light.shadow.camera.far = 15;
    light.shadow.bias = -.0004;
    light.shadow.normalBias = .025;
    light.shadow.radius = 4;
    // In the scene from the start (hidden until night), with its shadow setting fixed: the viewer's warm-up can then
    // compile the night's shaders before anyone sees the first dusk (main.js).
    light.castShadow = index < shadowSpots;
    scene.add(light, light.target);
    return light;
  });
  const DEAL_MS = 220, dealt = lights.map(() => ({ presence: 0, at: null, next: undefined }));
  let dealtOnce = false;
  const worldPoint = new THREE.Vector3();
  function isVisible(object) {
    for (let item = object; item; item = item.parent) if (!item.visible) return false;
    return true;
  }
  function updateLighting() {
    model.updateWorldMatrix(true, true);
    // Spots go to rooms whether or not their light is on; a switched-off room keeps its spot at zero intensity.
    // Toggling one room's light then changes only that room, instead of the pool re-dealing spots to other rooms,
    // and the number of active lights stays the same (no shader recompile on every switch).
    const visibleRooms = night ? rooms.filter(room =>
      room.capabilities?.light !== false && floors.has(String(room.floor)) &&
      isVisible(floors.get(String(room.floor))) &&
      (view.currentFloor === 'all' || String(room.floor) === String(view.currentFloor))) : [];
    const selected = byId.get(selectedId), selectedRoot = selected && floors.get(String(selected.floor));
    const anchor = selected && selectedRoot ? selectedRoot.localToWorld(new THREE.Vector3(selected.center[0], 2, selected.center[2])) : new THREE.Vector3();
    const candidates = visibleRooms.flatMap(room => {
      const root = floors.get(String(room.floor));
      const positions = room.lightPositions?.length ? room.lightPositions :
        [room.lightPosition || [room.center[0], 2.65, room.center[2]]];
      return positions.map(position => {
        worldPoint.fromArray(position);
        root.localToWorld(worldPoint);
        // Rank by distance from the selected room, not from the camera: the set (and its shadows) then stays
        // put while the camera moves, instead of lights hopping between rooms on every drag or zoom.
        return { room, position, distance: worldPoint.distanceToSquared(anchor) };
      });
    });
    candidates.sort((a, b) => Number(b.room.id === selectedId) - Number(a.room.id === selectedId) || a.distance - b.distance);
    // At night every spot of the pool is in the scene, unused ones dark at the scene's root: the number of lights stays
    // the same whatever the view shows (fewer rooms on one floor, a floor hidden), and with it every shader. A change
    // in that count rebuilt them all, a freeze of 0.1–0.2 s on the first night flight to a stop.
    // A spot dealt to another room (the view changed floors, another room was selected) fades out where it is, moves,
    // and fades in at its new room (DEAL_MS each way): moved at once, rooms lit up and went dark in one frame.
    lights.forEach((light, index) => {
      const emitter = candidates[index] || null, d = dealt[index];
      light.visible = night;
      const same = d.at === emitter || (d.at && emitter && d.at.room === emitter.room && d.at.position.every((v, k) => v === emitter.position[k]));
      if (same) { d.next = undefined; return; }
      d.next = emitter;
      if (d.presence === 0 || !dealtOnce || !night) { place(light, d, emitter); d.next = undefined; d.presence = dealtOnce && night ? 0 : emitter ? 1 : 0; }
    });
    dealtOnce = true;
    paintLights(); fadeLights();
  }
  function place(light, d, emitter) {
    d.at = emitter;
    if (!emitter) { if (light.parent !== scene) scene.add(light, light.target); light.userData.roomId = null; return; }
    const { room, position } = emitter;
    floors.get(String(room.floor)).add(light, light.target);
    light.position.fromArray(position);
    light.position.y -= .12; // Emit below the modeled diffuser, without self-occlusion.
    light.angle = Math.min(1.16, Math.max(.68, Math.atan((room.lightRadius || 3.7) / Math.max(light.position.y, 1))));
    light.target.position.set(position[0], .05, position[2]);
    light.userData.roomId = room.id;
    // Moved once it has faded out, long after the selection asked for its shadows: they follow it here.
    if (light.castShadow) renderer.shadowMap.needsUpdate = true;
  }
  // Doors swing to their new angle over ~0.6 s (eased) instead of snapping, their shadows redrawn on every frame of the
  // swing (redrawn only once settled, the closed door's shadow stayed until the door was fully open, then jumped).
  const swinging = new Map();
  let swingFrame = 0;
  function swingDoor(hinge, angle) {
    if (Math.abs(hinge.rotation.y - angle) < 1e-4) { swinging.delete(hinge); return; }
    if (disposed || matchMedia('(prefers-reduced-motion: reduce)').matches) { hinge.rotation.y = angle; return; }
    // On demo time: a swing stands still while the demo is paused, like everything else.
    swinging.set(hinge, {from: hinge.rotation.y, to: angle, start: demoNow()});
    if (!swingFrame) swingFrame = requestAnimationFrame(swingStep);
  }
  function swingStep() {
    swingFrame = 0;
    const time = demoNow();
    let moved = false;
    for (const [hinge, s] of swinging) {
      const t = Math.min(1, (time - s.start) / 600), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, angle = s.from + (s.to - s.from) * e;
      if (angle !== hinge.rotation.y) { hinge.rotation.y = angle; moved = true; }
      if (t === 1) swinging.delete(hinge);
    }
    if (swinging.size) swingFrame = requestAnimationFrame(swingStep);
    // Paused mid-swing, the door stands still: no redraw (its shadow neither) until it moves again.
    if (!moved) return;
    renderer.shadowMap.needsUpdate = true;
    schedule();
  }
  function updateModel() {
    for (const room of rooms) {
      const state = states.get(room.id);
      // The AC's indicator switches at once; the lights fade (paintLights, fadeLights).
      for (const object of fixtures.get(room.id)) {
        if (object.userData.deviceKind === 'light' || !object.userData.deviceIndicator) continue;
        for (const material of [].concat(object.material)) {
          if (!material.emissive) continue;
          material.emissive.set(0x59c4b8);
          material.emissiveIntensity = state.climate ? 1.4 : 0;
        }
      }
      for (const [id, open] of Object.entries(state.doors)) {
        for (const hinge of hinges.get(id) || []) {
          swingDoor(hinge, open ? (hinge.userData.openAngle ?? Math.PI / 2) : (hinge.userData.closedAngle ?? 0));
        }
      }
    }
    updateLighting();
    renderer.shadowMap.needsUpdate = true;
    schedule();
    for(const listener of listeners)listener();
  }
  function renderControls() {
    const room = byId.get(selectedId), state = states.get(selectedId);
    roomSelect.value = selectedId;
    summary.textContent = `${roomName(room)} · ${floorLabel(room.floor)}`;
    devices.replaceChildren();
    const add = (kind, label, enabled, id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'simulation-device';
      button.dataset.device = kind;
      if (id) button.dataset.door = id;
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', `${label} ${enabled ? L('เปิดอยู่', 'on') : L('ปิดอยู่', 'off')}`);
      const title = document.createElement('span');
      title.textContent = label;
      const value = document.createElement('strong');
      value.textContent = enabled ? L('เปิด', 'On') : L('ปิด', 'Off');
      button.append(title, value);
      devices.append(button);
    };
    if (room.capabilities?.light !== false) add('light', deviceName.light(), state.light);
    if (room.capabilities?.climate !== false) add('climate', deviceName.climate(), state.climate);
    if (room.capabilities?.door !== false) (room.doorIds || []).forEach((id, index, all) => add('door', all.length > 1 ? `${deviceName.door()} ${index + 1}` : deviceName.door(), state.doors[id], id));
  }
  function toggle(kind, doorId) {
    const state = states.get(selectedId), room = byId.get(selectedId);
    if (room.capabilities?.[kind] === false) return;
    let enabled;
    if (kind === 'door') {
      if (!Object.hasOwn(state.doors, doorId)) return;
      enabled = !state.doors[doorId];
      patchRoom(selectedId, {doors: {[doorId]: enabled}});
    } else if (kind === 'light' || kind === 'climate') enabled = state[kind] = !state[kind];
    else return;
    renderControls();
    updateModel();
    feedback.textContent = L(`${room.label} · ${deviceName[kind]()}${enabled ? 'เปิด' : 'ปิด'}แล้ว (จำลอง)`, `${roomName(room)} · ${deviceName[kind]()} turned ${enabled ? 'on' : 'off'} (simulated)`);
  }
  listen(devices, 'click', event => {
    const button = event.target.closest('button[data-device]');
    if (!button) return;
    const kind = button.dataset.device, door = button.dataset.door;
    toggle(kind, door);
    // Preserve keyboard focus when state labels are refreshed.
    [...devices.children].find(item => item.dataset.device === kind && item.dataset.door === door)?.focus({ preventScroll: true });
  });
  listen(roomSelect, 'change', () => {
    selectedId = roomSelect.value;
    feedback.textContent = '';
    renderControls(); relight();
    onSelectFloor(byId.get(selectedId).floor);
    updateModel();
  });
  // With a clock to follow (onNightRequest), the button asks it for night or day; night then follows the clock.
  listen(nightButton, 'click', () => {
    if (onNightRequest) onNightRequest(!night); else setNight(!night);
  });
  function setNight(value) {
    night = Boolean(value);
    nightButton.setAttribute('aria-pressed', String(night));
    nightButton.textContent = nightText(night);
    onNightChange(night);
    updateModel();
  }
  // A light/climate/door patch for one room. A shared doorway keeps a single pose across the rooms it opens into.
  function patchRoom(id, patch) {
    const room = byId.get(id), state = states.get(id);
    for (const key of ['light', 'climate']) if (typeof patch[key] === 'boolean' && room.capabilities?.[key] !== false) state[key] = patch[key];
    for (const [door, value] of Object.entries(patch.doors || {})) if (typeof value === 'boolean' && Object.hasOwn(state.doors, door)) for (const other of states.values()) if (Object.hasOwn(other.doors, door)) other.doors[door] = value;
  }

  // Ray picking only follows a short, stationary, single-pointer gesture.
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const canvas = renderer.domElement;
  let press = null;
  const pointers = new Set();
  listen(canvas, 'pointerdown', event => {
    pointers.add(event.pointerId);
    if (pointers.size !== 1 || event.button !== 0) { press = null; return; }
    press = { x: event.clientX, y: event.clientY, id: event.pointerId, time: performance.now(), moved: false };
  });
  listen(canvas, 'pointermove', event => {
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press.moved = true;
  });
  const release = event => { pointers.delete(event.pointerId); press = null; };
  listen(canvas, 'pointercancel', release);
  listen(window, 'pointerup', event => {
    const start = press;
    pointers.delete(event.pointerId);
    press = null;
    if (event.target !== canvas || !start || start.id !== event.pointerId || start.moved || performance.now() - start.time > 500 ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    model.updateWorldMatrix(true, true);
    raycaster.setFromCamera(pointer, camera);
    // Respect occlusion and cut planes: never operate a device through an opaque wall.
    const hit = raycaster.intersectObject(model, true).find(item => {
      if (!isVisible(item.object) || !item.object.isMesh) return false;
      const materials = [].concat(item.object.material || []);
      const material = materials[item.face?.materialIndex || 0];
      return material && material.visible && !(material.transparent && material.opacity < .3) &&
        !(material.clippingPlanes || []).some(plane => plane.distanceToPoint(item.point) < 0);
    });
    if (!hit) return;
    let device = hit.object;
    while (device && !device.userData.deviceKind) device = device.parent;
    if (!device) return;
    const data = device.userData;
    const room = byId.get(data.roomId) || rooms.find(item => item.doorIds?.includes(data.doorId));
    if (!room||!interactionFilter(room)) return;
    selectedId = room.id;
    panel.querySelector('details').open = true;
    toggle(data.deviceKind, data.doorId);
  });
  renderControls();
  updateModel();

  return {
    rooms,
    setInteractionFilter(filter){interactionFilter=filter;},
    reset(){for(const room of rooms){const state=states.get(room.id);state.light=room.capabilities?.light!==false;state.climate=false;for(const id of Object.keys(state.doors))state.doors[id]=false;}renderControls();updateModel();},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    applySnapshot(snapshot){
      if(disposed)return;
      for(const [id,patch] of Object.entries(snapshot.rooms||{}))if(byId.has(id))patchRoom(id,patch);
      renderControls();updateModel();
    },
    // The night's spot lights are dealt around the selected room: deal them again now, not at the next switch (that
    // moved several of them between rooms at once, long after the selection).
    selectRoom(id){if(!byId.has(id))return;const changed=selectedId!==id;selectedId=id;renderControls();if(changed)relight();},
    setRoom(id,patch){
      if(!byId.has(id))return;
      patchRoom(id,patch);
      renderControls();updateModel();
    },
    setNight,
    setView(next) {
      if (disposed) return;
      view = { ...view, ...next, currentFloor: String(next.currentFloor ?? view.currentFloor) };
      if (view.currentFloor !== 'all' && String(byId.get(selectedId).floor) !== view.currentFloor) {
        const room = rooms.find(item => String(item.floor) === view.currentFloor);
        if (room) selectedId = room.id;
      }
      feedback.textContent = '';
      renderControls();
      updateModel();
    },
    getState() {
      return { mode: 'simulation', night, selectedRoom: selectedId, view: { ...view },
        rooms: Object.fromEntries([...states].map(([id, state]) => [id, { ...state, doors: { ...state.doors } }])) };
    },
    dispose() {
      cancelAnimationFrame(lightFrame);
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(swingFrame);
      abort.abort();
      listeners.clear();
      panel.remove();
      for (const light of lights) { light.removeFromParent(); light.target.removeFromParent(); light.dispose(); }
      for (const [object, material] of originals) object.material = material;
      for (const material of ownedMaterials) material.dispose();
      for (const [object, angle] of initialAngles) object.rotation.y = angle;
      renderer.shadowMap.needsUpdate = true;
      schedule();
    }
  };
}
