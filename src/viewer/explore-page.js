import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {L, t} from 'osd/viewer/texts.js';
import {floorLabel} from 'osd/viewer/simulation.js';

// The close-up views: the floor, whether its walls are cut, and the camera in the floor's own space.
const SPOTS = {
  services: {floor: '1', eye: [-13, 11, 6], target: [-4, 0.4, -4]},
  parking: {floor: '1', eye: [-25, 15, 25], target: [-13.5, 0.3, 3.5]},
  stairs: {floor: '2', eye: [14.1, 1.75, -4.85], target: [9.4, 1.3, -4.85]},
  courtyard: {floor: '1', eye: [16.7, 2.05, 3.2], target: [23.5, 1, -2.5]},
  office: {floor: '2', cut: true, eye: [3.7, 5.5, 17.5], target: [3.7, 0.6, 6.6]},
  arrival: {floor: '1'}, // the model's own camera
  reception: {floor: '1'}, // the model's own camera
};

// The exploration page's own controls (src/pages/explore.html): floors, split and cut views, and camera views. They work
// on `view` (main.js) and show it with `updateView`. `model()`: the building, once loaded.
export function createExplorePage({view, camera, controls, floorRoots, model, schedule, updateView, frameVisible}) {
  const $ = (s) => document.querySelector(s);
  const floorButtons = [...document.querySelectorAll('[data-floor]')],
    explodeButton = $('#explode'),
    cutButton = $('#cutaway'),
    exteriorButton = $('#exterior'),
    viewLabel = $('#view-label');
  const on = (id, fn) => $(id).addEventListener('click', fn);
  for (const button of floorButtons)
    button.addEventListener('click', () => {
      view.floor = button.dataset.floor;
      view.interior = null;
      updateView();
    });
  on('#explode', () => {
    view.exploded = !view.exploded;
    updateView();
  });
  on('#cutaway', () => {
    view.cutaway = !view.cutaway;
    updateView();
  });
  on('#reset', frameVisible);
  on('#exterior', () => {
    view.exterior = !view.exterior;
    updateView();
  });
  function exteriorCamera(side) {
    view.interior = null;
    view.side = side;
    view.floor = 'all';
    view.exploded = false;
    view.cutaway = false;
    view.exterior = true;
    updateView();
  }
  on('#camera-front', () => exteriorCamera(false));
  on('#camera-side', () => exteriorCamera(true));
  on('#lift', () => {
    if (view.floor === 'all') view.floor = '2';
    view.cutaway = false;
    updateView();
    const door = model().getObjectByName(`Floor_${view.floor}_lift_doors`);
    if (!door) return;
    const b = new THREE.Box3().setFromObject(door),
      target = b.getCenter(new THREE.Vector3());
    camera.fov = 50;
    camera.updateProjectionMatrix();
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0.1, 0.4, 3.1));
    controls.minDistance = 0.5;
    controls.update();
    schedule();
    view.close = true;
    viewLabel.textContent = `${L('ลิฟต์', 'Lift')} · ${floorLabel(view.floor)}`;
  });
  // A room or a spot close up, in its floor's own space (the model's own camera for it, if it has one).
  function interiorCamera(kind) {
    const spot = SPOTS[kind];
    view.interior = kind;
    view.floor = spot.floor;
    view.exploded = false;
    view.cutaway = Boolean(spot.cut);
    updateView();
    const root = floorRoots[Number(view.floor) - 1];
    const {eye, target} = root.userData.arrivalCameras?.[kind] ?? spot;
    camera.fov = 58;
    camera.position.copy(root.localToWorld(new THREE.Vector3(...eye)));
    controls.target.copy(root.localToWorld(new THREE.Vector3(...target)));
    controls.minDistance = 0.4;
    camera.updateProjectionMatrix();
    controls.update();
    schedule();
    view.close = true;
    const cars = root.userData.parking?.count || 6;
    viewLabel.textContent =
      kind === 'parking'
        ? L(`ที่จอดรถ · ${cars} คัน`, `Parking · ${cars} spaces`)
        : `${t(`x.${kind}`)} · ${floorLabel(view.floor)}`;
  }
  for (const kind of Object.keys(SPOTS)) on(`#${kind}`, () => interiorCamera(kind));
  return {
    // The buttons as the view stands.
    show({showExterior}) {
      exteriorButton.disabled = view.floor !== 'all' || view.exploded || view.cutaway;
      exteriorButton.setAttribute('aria-pressed', String(showExterior));
      for (const button of floorButtons)
        button.setAttribute('aria-pressed', String(button.dataset.floor === view.floor));
      explodeButton.disabled = view.floor !== 'all';
      explodeButton.setAttribute('aria-pressed', String(view.exploded && view.floor === 'all'));
      cutButton.setAttribute('aria-pressed', String(view.cutaway));
      viewLabel.textContent = floorLabel(view.floor);
    },
    label(text) {
      viewLabel.textContent = text;
    },
    enable(on) {
      for (const button of document.querySelectorAll('.toolbar button, .camera-presets button')) button.disabled = !on;
    },
  };
}
