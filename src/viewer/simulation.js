// This module is deliberately local: device state never leaves this page.
// spotLights / shadowSpots: the night room light pool and how many of it cast shadows.
export async function createSimulation({ THREE, scene, model, floorRoots, renderer, camera, schedule,
  onSelectFloor = () => {}, onNightChange = () => {}, spotLights = 8, shadowSpots = 2 }) {
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
  const listen = (element, event, handler, options = {}) => element.addEventListener(event, handler, { ...options, signal: abort.signal });

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
  panel.setAttribute('aria-label', 'ทดลองควบคุมอุปกรณ์');
  panel.innerHTML = `
    <div class="simulation-bar">
      <p class="simulation-mode">จำลอง · ไม่เชื่อมต่อ Home Assistant</p>
      <button type="button" class="simulation-night" aria-pressed="false">กลางคืน</button>
    </div>
    <details class="simulation-details">
      <summary>ทดลองอุปกรณ์ <span class="simulation-room-summary"></span></summary>
      <div class="simulation-content">
        <label class="simulation-room-label">ห้อง / พื้นที่<select class="simulation-room"></select></label>
        <div class="simulation-devices" role="group" aria-label="อุปกรณ์จำลอง"></div>
        <p class="simulation-hint">คลิกโคมไฟ แอร์ หรือบานประตูในโมเดลเพื่อทดลอง · สถานะจะเริ่มใหม่เมื่อโหลดหน้า</p>
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
  const floorLabel = floor => String(floor) === '5' ? 'ดาดฟ้า' : `ชั้น ${floor}`;
  for (const room of rooms) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = `${floorLabel(room.floor)} · ${room.label}`;
    roomSelect.append(option);
  }

  // A fixed pool bounds lighting/shadow cost even when the map grows.
  const SPOT_INTENSITY = 105;
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
    return light;
  });
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
    lights.forEach((light, index) => {
      const emitter = candidates[index];
      light.visible = Boolean(emitter);
      light.castShadow = Boolean(emitter) && index < shadowSpots;
      if (!emitter) return;
      const { room, position } = emitter;
      const root = floors.get(String(room.floor));
      root.add(light, light.target);
      light.position.fromArray(position);
      light.position.y -= .12; // Emit below the modeled diffuser, without self-occlusion.
      light.angle = Math.min(1.16, Math.max(.68, Math.atan((room.lightRadius || 3.7) / Math.max(light.position.y, 1))));
      light.target.position.set(position[0], .05, position[2]);
      light.userData.roomId = room.id;
      light.intensity = states.get(room.id).light ? SPOT_INTENSITY : 0;
    });
  }
  // Doors swing to their new angle over ~0.6 s (eased) instead of snapping; shadows follow when they settle.
  const swinging = new Map();
  let swingFrame = 0;
  function swingDoor(hinge, angle) {
    if (Math.abs(hinge.rotation.y - angle) < 1e-4) { swinging.delete(hinge); return; }
    if (disposed || matchMedia('(prefers-reduced-motion: reduce)').matches) { hinge.rotation.y = angle; return; }
    swinging.set(hinge, {from: hinge.rotation.y, to: angle, start: performance.now()});
    if (!swingFrame) swingFrame = requestAnimationFrame(swingStep);
  }
  function swingStep(time) {
    swingFrame = 0;
    for (const [hinge, s] of swinging) {
      const t = Math.min(1, (time - s.start) / 600), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      hinge.rotation.y = s.from + (s.to - s.from) * e;
      if (t === 1) swinging.delete(hinge);
    }
    if (swinging.size) swingFrame = requestAnimationFrame(swingStep);
    else renderer.shadowMap.needsUpdate = true;
    schedule();
  }
  function updateModel() {
    for (const room of rooms) {
      const state = states.get(room.id);
      for (const object of fixtures.get(room.id)) {
        const isLight = object.userData.deviceKind === 'light';
        if (!isLight && !object.userData.deviceIndicator) continue;
        const enabled = isLight ? state.light : state.climate;
        for (const material of [].concat(object.material)) {
          if (!material.emissive) continue;
          material.emissive.set(isLight ? 0xffdc9b : 0x59c4b8);
          material.emissiveIntensity = enabled ? (isLight ? (night ? 2.1 : .6) : 1.4) : 0;
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
    summary.textContent = `${room.label} · ${floorLabel(room.floor)}`;
    devices.replaceChildren();
    const add = (kind, label, enabled, id) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'simulation-device';
      button.dataset.device = kind;
      if (id) button.dataset.door = id;
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', `${label} ${enabled ? 'เปิดอยู่' : 'ปิดอยู่'}`);
      const title = document.createElement('span');
      title.textContent = label;
      const value = document.createElement('strong');
      value.textContent = enabled ? 'เปิด' : 'ปิด';
      button.append(title, value);
      devices.append(button);
    };
    if (room.capabilities?.light !== false) add('light', 'ไฟ', state.light);
    if (room.capabilities?.climate !== false) add('climate', 'แอร์', state.climate);
    if (room.capabilities?.door !== false) (room.doorIds || []).forEach((id, index, all) => add('door', all.length > 1 ? `ประตู ${index + 1}` : 'ประตู', state.doors[id], id));
  }
  function toggle(kind, doorId) {
    const state = states.get(selectedId), room = byId.get(selectedId);
    if (room.capabilities?.[kind] === false) return;
    let enabled;
    if (kind === 'door') {
      if (!Object.hasOwn(state.doors, doorId)) return;
      enabled = state.doors[doorId] = !state.doors[doorId];
      // A shared doorway must have a single pose across adjacent rooms.
      for (const other of states.values()) if (Object.hasOwn(other.doors, doorId)) other.doors[doorId] = enabled;
    } else if (kind === 'light' || kind === 'climate') enabled = state[kind] = !state[kind];
    else return;
    renderControls();
    updateModel();
    feedback.textContent = `${room.label} · ${kind === 'light' ? 'ไฟ' : kind === 'climate' ? 'แอร์' : 'ประตู'}${enabled ? 'เปิด' : 'ปิด'}แล้ว (จำลอง)`;
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
    renderControls();
    onSelectFloor(byId.get(selectedId).floor);
    updateModel();
  });
  listen(nightButton, 'click', () => {
    night = !night;
    nightButton.setAttribute('aria-pressed', String(night));
    nightButton.textContent = night ? 'กลางคืน · เปิดอยู่' : 'กลางคืน';
    onNightChange(night);
    updateModel();
  });

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
  // Camera moves no longer re-pick the night lights (see updateLighting), so nothing to do on wheel.
  renderControls();
  updateModel();

  return {
    rooms,
    setInteractionFilter(filter){interactionFilter=filter;},
    reset(){for(const room of rooms){const state=states.get(room.id);state.light=room.capabilities?.light!==false;state.climate=false;for(const id of Object.keys(state.doors))state.doors[id]=false;}renderControls();updateModel();},
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    applySnapshot(snapshot){
      if(disposed)return;
      for(const [id,patch] of Object.entries(snapshot.rooms||{})){
        const room=byId.get(id),state=states.get(id);if(!room)continue;
        for(const key of ['light','climate'])if(typeof patch[key]==='boolean'&&room.capabilities?.[key]!==false)state[key]=patch[key];
        for(const [door,value] of Object.entries(patch.doors||{}))if(typeof value==='boolean'&&Object.hasOwn(state.doors,door))for(const other of states.values())if(Object.hasOwn(other.doors,door))other.doors[door]=value;
      }
      if(byId.has(snapshot.selectedRoom))selectedId=snapshot.selectedRoom;
      if(typeof snapshot.night==='boolean'&&night!==snapshot.night){night=snapshot.night;nightButton.setAttribute('aria-pressed',String(night));nightButton.textContent=night?'กลางคืน · เปิดอยู่':'กลางคืน';onNightChange(night);}
      renderControls();updateModel();
    },
    selectRoom(id){if(!byId.has(id))return;selectedId=id;renderControls();},
    setRoom(id,patch){
      const room=byId.get(id),state=states.get(id);if(!room)return;
      for(const key of ['light','climate'])if(typeof patch[key]==='boolean'&&room.capabilities?.[key]!==false)state[key]=patch[key];
      for(const [door,value] of Object.entries(patch.doors||{}))if(typeof value==='boolean'&&Object.hasOwn(state.doors,door))for(const other of states.values())if(Object.hasOwn(other.doors,door))other.doors[door]=value;
      renderControls();updateModel();
    },
    // The lit rooms (a Set of room ids), e.g. the kiosk's night set; null puts back every room with a light.
    setLitRooms(ids){for(const room of rooms)states.get(room.id).light=room.capabilities?.light!==false&&(!ids||ids.has(room.id));renderControls();updateModel();},
    setNight(value){night=Boolean(value);nightButton.setAttribute('aria-pressed',String(night));nightButton.textContent=night?'กลางคืน · เปิดอยู่':'กลางคืน';onNightChange(night);updateModel();},
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
