import {Mesh, MeshBasicMaterial, DoubleSide} from 'osd/node_modules/three/build/three.module.js';
import {AIR} from 'osd/viewer/building.js';
// Reuse the modeled room footprint, including the curved ground-floor rooms.
export function createRoomLayers({model, rooms, schedule}) {
  // Floor meshes carry layout ids; overlays use the public device-map ids.
  const publicIds = new Map(rooms.map((r) => [r.layoutId ?? r.id, r.id])),
    roomFloors = new Map(rooms.map((r) => [r.id, String(r.floor)])),
    overlays = [];
  const floors = [];
  model.traverse((o) => {
    if (o.isMesh && o.userData.type === 'floor' && publicIds.has(o.userData.room)) floors.push(o);
  });
  for (const floor of floors) {
    const material = new MeshBasicMaterial({
      color: '#65bbaa',
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: DoubleSide,
      forceSinglePass: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    const overlay = new Mesh(floor.geometry, material);
    const room = publicIds.get(floor.userData.room);
    overlay.name = `Insight_floor_${room}`;
    overlay.userData.insightRoom = room;
    overlay.position.copy(floor.position);
    overlay.position.y += 0.012;
    overlay.quaternion.copy(floor.quaternion);
    overlay.scale.copy(floor.scale);
    overlay.renderOrder = 2;
    overlay.visible = false;
    overlay.raycast = () => {};
    floor.parent.add(overlay);
    overlays.push(overlay);
  }
  return {
    update({layer, roomData, states, floor, hidden}) {
      for (const mesh of overlays) {
        const id = mesh.userData.insightRoom,
          data = roomData[id];
        mesh.visible = !hidden && roomFloors.get(id) === floor && layer !== 'none' && Boolean(data);
        if (!mesh.visible) continue;
        const color =
          layer === 'temperature'
            ? data.temp < AIR.cool
              ? '#639cd9'
              : data.temp < AIR.warm
                ? '#62b7a4'
                : '#e5a351'
            : layer === 'occupancy'
              ? data.people > 0
                ? '#32aa98'
                : '#a5b4c5'
              : states[id]?.light
                ? '#efbb56'
                : '#91a1b7';
        mesh.material.color.set(color);
      }
      schedule();
    },
    dispose() {
      for (const mesh of overlays) {
        mesh.removeFromParent();
        mesh.material.dispose();
      }
      schedule();
    },
  };
}
