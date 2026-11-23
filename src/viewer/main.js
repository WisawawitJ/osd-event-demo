import {createCameraFlight} from 'osd/viewer/camera-flight.js';
import {createSecurityPreview} from 'osd/viewer/security-preview.js';
import {createSceneTransition} from 'osd/viewer/scene-transition.js';
import {createShowcase} from 'osd/viewer/showcase.js';
import {createExplorePage} from 'osd/viewer/explore-page.js';
import {L, t, translatePage} from 'osd/viewer/texts.js';
import {SPEED, world, onTick} from 'osd/core/clock.js';
import {options} from 'osd/core/options.js';
import {createQuality, drawsInSoftware} from 'osd/viewer/quality.js';
import {MEETING_ROOM, NIGHT_AT, DAY_AT} from 'osd/viewer/building.js';
import {stops} from 'osd/viewer/stops.js';
import {viewKey, maxZoomOut} from 'osd/viewer/view-math.js';
import {limitControls} from 'osd/viewer/view-limits.js';
import {createViewControls} from 'osd/viewer/view-controls.js';
import {createNavigation} from 'osd/viewer/navigation.js';
import {applySky, isDark} from 'osd/viewer/daylight.js';
import {createSunLight} from 'osd/viewer/sun-light.js';
import {groundFog} from 'osd/viewer/fog.js';
import {setPageNight} from 'osd/viewer/page-night.js';
import {createFpsMeter} from 'osd/viewer/fps-meter.js';
import {createDebugEngine} from 'osd/viewer/debug-engine.js';
import {warmUp} from 'osd/viewer/warm-up.js';
import {mergeStaticMeshes} from 'osd/viewer/merge-static.js';
import {roomOf, splitRim} from 'osd/viewer/room-devices.js';
import {createRoomSchedule} from 'osd/viewer/building-day.js';
import {createKoi} from 'osd/viewer/koi.js';
import {createRenderKit} from 'osd/viewer/render-kit.js';
import {createSimulation, floorLabel} from 'osd/viewer/simulation.js';
import {createSurfaceTextures} from 'osd/viewer/surface-textures.js';
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {OrbitControls} from 'osd/node_modules/three/examples/jsm/controls/OrbitControls.js';
import {GLTFLoader} from 'osd/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
let renderKit, simulation, surfaceTextures;
// What the model shows: a floor or all, split or cut, its facade and garden; `below`: with a floor, all that is under it; `interior`: the stop or room looked at;
// `devices`: the rooms whose ceiling lights and AC show (null: every room's, unless cut); `side`: from the other side; `close`: the lift or a room's view, which a resize keeps (a phone turned on its side threw
// the visitor out).
const view = {
  floor: 'all',
  below: false,
  exploded: false,
  cutaway: false,
  exterior: true,
  side: false,
  devices: null,
  interior: null,
  close: false,
};
const ceilings = [],
  deviceMeshes = [];
const presentationMeshes = [];
const cutTypes = new Set(['wall', 'glass', 'column', 'door', 'stair']);
const abort = new AbortController();
let renderer,
  controls,
  model,
  resizeObserver,
  showcase,
  flight,
  sceneTransition,
  securityPreview,
  explore = null,
  parking = null;
const isShowcase = Boolean(document.querySelector('#showcase'));
const dayBackground = isShowcase ? '#e6ecee' : '#dce5e5'; // the 3D view's daytime background (the sky darkens it at night)
// The `debug` option (screenshots and the benchmark: scripts/shots.mjs, test/bench.mjs) exposes the scene and the
// car park on window.
const debug = 'debug' in options;
// The car park's code, fetched from the start alongside the WebGL setup and the model (asked for only once the model
// was up, its dozen files came one level of imports at a time, a third of a second after the first frame).
const parkingCode = import('osd/parking/index.js');
let frame = 0,
  disposed = false;
const floorRoots = [],
  floorOf = new Map(), // an object's floor number, for the ones shown and hidden by themselves
  basePositions = new Map(),
  cutMeshes = [],
  roofs = [];
const ownedMaterials = new Set();

retry.addEventListener('click', () => location.reload());
// The page's static texts start in the chosen language (Thai unless English was picked before).
translatePage({initial: true});
function fail(message) {
  status.dataset.state = 'error';
  status.textContent = message;
  retry.hidden = false;
  explore?.enable(false);
}

try {
  const scene = new THREE.Scene();
  // The scene never moves. Left on, its matrix update each frame forced every object below it to recompute too.
  scene.matrixAutoUpdate = false;
  scene.background = new THREE.Color(dayBackground);
  scene.fog = groundFog(dayBackground);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  // The `render: 0.5` option (the test harness sets it): the 3D view at that fraction of its resolution, without antialiasing and
  // with smaller shadow maps, so software WebGL keeps up (test/browser.mjs). The booth never sets it.
  const renderScale = Math.min(1, Math.max(0.25, Number(options.render) || 1));
  // Stepped and half-resolution pages (the test harness's) draw the same whatever the computer.
  const fixed = 'manual' in options || renderScale < 1;
  const light = 'light' in options || (!fixed && drawsInSoftware());
  renderer = new THREE.WebGLRenderer({
    antialias: renderScale === 1 && !light,
    powerPreference: 'high-performance', // on a laptop with two graphics cards, the fast one
  });
  // Resolution adapts to the machine (quality.js): it starts at up to 1.5x device pixels (2x only cost frames on laptops).
  const quality = createQuality({devicePixels: devicePixelRatio, light, scale: renderScale, fixed});
  let warming = false;
  const afterRender = new Set(); // extra views drawn into the same canvas after each frame (the live LPR feed)
  if (debug) Object.assign(window, {__renderer: renderer, __scene: scene, __camera: camera});
  renderer.setPixelRatio(quality.ratio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  // Shader error checks read every program's link log on first use, which blocks on the GPU: with them on,
  // a stop's first visit stalled ~0.4 s. Visitors' pages have them off (the warm-up at load compiles every shader).
  // Screenshot and benchmark pages (`debug`, with no warm-up) keep them: that wait is also what makes a draw wait for
  // a shader still compiling; without it, the first draw with a new shader (night's, the plate camera's) was dropped,
  // and whatever used it was missing from that frame (a booth, the parked cars, the ground came and went in the shots).
  renderer.debug.checkShaderErrors = debug;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is gone from three.js (it fell back to this, warning on every load)
  renderer.shadowMap.autoUpdate = false;
  renderKit = createRenderKit(renderer, scene);
  surfaceTextures = createSurfaceTextures(renderer);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.dataset.i18nLabel = 'canvas';
  canvas.setAttribute('aria-label', t('canvas'));
  viewport.prepend(canvas);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  const {pushForward, heightStep, closeRange} = limitControls({
    controls,
    camera,
    canvas,
    schedule,
    ready: () => Boolean(model),
    signal: abort.signal,
  });
  const {hemisphere, key, fill, fitShadow} = createSunLight(scene, {
    shadowSize: (innerWidth < 700 ? 1024 : 4096) * (renderScale < 1 ? 0.5 : 1),
  });
  // Light: smaller sun shadows, drawn less often (followClock, the flights), no pond mirror, no blur over the 3D view.
  function applyLight() {
    if (!quality.light) return;
    document.documentElement.dataset.light = '';
    key.shadow.mapSize.setScalar(Math.min(2048, key.shadow.mapSize.x));
    key.shadow.map?.dispose();
    key.shadow.map = null;
    renderer.shadowMap.needsUpdate = true;
    renderKit.setReflectionLive(false);
  }
  applyLight();

  const fpsMeter = 'fps' in options ? createFpsMeter() : null;
  // Every draw of the main view also draws the extra views, or the LPR pop-up would show the main scene for a frame.
  function draw() {
    // What moves on the demo's clock (light fades, the tour's effects) is brought to this moment first.
    simulation?.beforeDraw();
    showcase?.beforeDraw();
    renderer.render(scene, camera);
    for (const extra of afterRender) extra();
  }
  // `holdDraws`: a screenshot's frame is on screen (__engine.settle): nothing draws over it until the next step.
  let holdDraws = false;
  let drawnAt = 0;
  // `asked`: the start of the frame it was asked for in (its drawing is part of the wait).
  function schedule() {
    requestDraw(document.timeline.currentTime ?? performance.now());
  }
  function requestDraw(asked) {
    if (frame || disposed || document.hidden || holdDraws) return;
    frame = requestAnimationFrame((time) => {
      frame = 0;
      if (disposed || warming || holdDraws) return;
      // Light: 30 frames a second, evenly, not as many as it can, unevenly.
      if (quality.light && time - drawnAt < 26) return requestDraw(asked);
      drawnAt = time;
      draw();
      fpsMeter?.();
      if (quality.frame(time - asked)) {
        applyLight();
        applyPixelRatio();
      }
    });
  }
  // While the camera flies, draw at ~70% resolution and pause the pond mirror (it would re-render the scene every
  // frame) until the camera stops. Motion hides the softness; full sharpness comes back on the last frame.
  let inMotion = false;
  function applyPixelRatio() {
    renderer.setPixelRatio(inMotion ? quality.motionRatio : quality.ratio);
    renderer.setSize(Math.max(viewport.clientWidth, 1), Math.max(viewport.clientHeight, 1), false);
    draw(); // resizing clears the canvas: redraw at once so no blank frame shows
  }
  function setInMotion(value) {
    if (value === inMotion) return;
    inMotion = value;
    renderKit.setReflectionsPaused(value);
    applyPixelRatio();
    // Landed: keep drawing while the pond's reflection fades back in.
    if (!value) {
      const until = performance.now() + renderKit.fadeMs + 50;
      const pump = () => {
        schedule();
        if (performance.now() < until) requestAnimationFrame(pump);
      };
      requestAnimationFrame(pump);
    }
  }
  controls.addEventListener('change', schedule);
  // Near plane follows the viewing distance. A fixed 1 cm near plane left ~1.5 cm of depth precision at 50 m,
  // so road paint, kerbs and coplanar model surfaces flickered while the camera moved.
  controls.addEventListener('change', () => {
    const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * 0.015, 0.03, 1.2);
    if (Math.abs(near - camera.near) / camera.near > 0.02) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  });
  const readPose = () => ({eye: camera.position.toArray(), target: controls.target.toArray(), fov: camera.fov});
  const writePose = (pose) => {
    camera.position.fromArray(pose.eye);
    controls.target.fromArray(pose.target);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
    controls.update();
    schedule();
  };
  flight = createCameraFlight({
    read: readPose,
    write: writePose,
    onState(active) {
      viewport.classList.toggle('flying', active);
      const el = document.querySelector('#flight-status');
      if (el) el.textContent = active ? L('กำลังพาไปยังจุดที่เลือก…', 'Taking you to the selected spot…') : '';
      setInMotion(active);
    },
  });
  if (debug)
    window.__engine = createDebugEngine({
      renderer,
      draw,
      schedule,
      hold(on) {
        holdDraws = on;
      },
      moving: () => flight.running || showcase?.getState().traveling,
    });
  // The `speed` option (tests, rehearsals) shortens every camera flight like the rest of the demo's timing.
  if (SPEED !== 1) {
    const flyPath = flight.flyPath;
    flight.flyPath = (steps) => flyPath(steps.map((step) => ({...step, duration: (step.duration ?? 1800) / SPEED})));
  }

  function visibleBounds() {
    const bounds = new THREE.Box3();
    model?.updateWorldMatrix(true, true);
    for (const root of floorRoots) {
      if (!root.visible) continue;
      root.traverseVisible((object) => {
        if (!object.isMesh && !object.isLine) return;
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
        if (view.cutaway && cutTypes.has(object.userData.type)) {
          box.max.y = Math.min(box.max.y, root.getWorldPosition(new THREE.Vector3()).y + 1.2);
        }
        if (!box.isEmpty()) bounds.union(box);
      });
    }
    return bounds;
  }

  function frameVisible() {
    if (!model) return;
    // Its label too (Reset view or R from the lift or stairs left theirs up).
    view.close = false;
    explore?.label(floorLabel(view.floor));
    camera.fov = 38;
    camera.updateProjectionMatrix();
    const bounds = visibleBounds();
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const whole = view.floor === 'all' && !view.exploded && !view.cutaway;
    const direction = new THREE.Vector3(view.side ? -1.1 : 0.72, whole ? 0.37 : 0.85, 1.6).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    // Fit actual box corners in the chosen camera orientation. A bounding sphere
    // leaves flat floor plans unnecessarily small in a wide architectural viewport.
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          distance = Math.max(
            distance,
            corner.dot(direction) + Math.abs(corner.dot(right)) / (Math.tan(halfFov) * camera.aspect),
            corner.dot(direction) + Math.abs(corner.dot(up)) / Math.tan(halfFov),
          );
        }
    distance = Math.max(distance * 1.12, 1);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(radius / 200, 0.01);
    camera.far = Math.max(distance * 10, 200);
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.12;
    // Not out to where the world is a disc floating in the sky (as on the showcase).
    controls.maxDistance = maxZoomOut(distance);
    controls.update();
    schedule();
  }

  function updateView({reframe = true} = {}) {
    // Under the floor on show, with `below`: as it is in the whole building.
    const under = (floor) => view.below && floor < Number(view.floor);
    for (const [index, root] of floorRoots.entries()) {
      root.visible = view.floor === 'all' || view.floor === String(index + 1) || under(index + 1);
      root.position.copy(basePositions.get(root));
      if (view.exploded && view.floor === 'all') root.position.y += index * 2.5;
      root.updateMatrix(); // floors do not update their own matrix (see loadModel)
    }
    model.updateWorldMatrix(true, true);
    // Cutaway only moves each floor's clipping plane (far above the model when off). Swapping planes in and
    // out changed every wall's shader and froze the view for ~0.7 s on each switch to or from the meeting room.
    for (const {root, plane} of cutMeshes)
      plane.constant =
        view.cutaway && !under(floorRoots.indexOf(root) + 1) ? root.getWorldPosition(new THREE.Vector3()).y + 1.2 : 1e5;
    const showExterior = view.exterior && view.floor === 'all' && !view.exploded && !view.cutaway;
    for (const object of presentationMeshes) object.visible = showExterior || under(floorOf.get(object));
    for (const roof of roofs)
      roof.visible =
        showExterior ||
        under(floorOf.get(roof)) ||
        (view.floor === '5' && !view.cutaway && !view.exploded && roof.name.endsWith('service_roof_caps'));
    for (const device of deviceMeshes)
      device.visible =
        under(floorOf.get(device)) || (view.devices ? view.devices.includes(roomOf(device)) : !view.cutaway);
    for (const ceiling of ceilings)
      ceiling.visible =
        under(floorOf.get(ceiling)) ||
        (!view.cutaway &&
          !view.exploded &&
          (view.floor === 'all' ||
            ceiling.userData.ceilingScope === 'stair' ||
            ['courtyard', 'arrival', 'reception'].includes(view.interior)));
    explore?.show({showExterior});
    renderKit.ground.visible = floorRoots[0].visible;
    if (parking) parking.lot.root.visible = renderKit.ground.visible;
    renderKit.setReflectionLive(!quality.light && view.floor === '1' && !view.cutaway && !view.exploded);
    renderer.shadowMap.needsUpdate = true;
    if (reframe) frameVisible();
    simulation?.setView({currentFloor: view.floor, cutaway: view.cutaway, exploded: view.exploded});
  }

  if (!isShowcase)
    explore = createExplorePage({
      view,
      camera,
      controls,
      floorRoots,
      model: () => model,
      schedule,
      updateView,
      frameVisible,
    });
  // The view keys (view-math.js viewKey: by the key's place, else by the character).
  canvas.addEventListener('keydown', (event) => {
    if (!model) return;
    // Not with Ctrl, Alt or Cmd: those are the browser's (reload, its own zoom).
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = viewKey(event),
      zoomOut = key === 'out',
      zoomIn = key === 'in';
    if (key === 'reset') {
      if (showcase) showcase.resetView();
      else frameVisible();
    }
    // Its matrix at once too: a zoom toward the cursor before the next frame worked from the view before the step.
    else if (key === 'up' || key === 'down') {
      event.preventDefault();
      camera.position.y += heightStep(key === 'up' ? 1 : -1);
      controls.update();
      camera.updateMatrixWorld();
      schedule();
    } else if (zoomIn || zoomOut) {
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(
        offset.length() * (zoomOut ? 1.15 : 1 / 1.15),
        controls.minDistance,
        controls.maxDistance,
      );
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
      schedule();
    }
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    fail(L('การแสดงผล 3D หยุดทำงาน ลองโหลดหน้านี้ใหม่', '3D rendering stopped. Try reloading this page.'));
  });

  let lastAspect = 0;
  resizeObserver = new ResizeObserver(() => {
    const width = Math.max(viewport.clientWidth, 1),
      height = Math.max(viewport.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (model && !isShowcase && !view.close && Math.abs(lastAspect - camera.aspect) > 0.25) frameVisible();
    lastAspect = camera.aspect;
    // Resizing clears the canvas: redraw before this frame is painted, or the view shows empty for a frame (the car
    // park's layout change resizes it as the flight sets off).
    if (model && !warming && !disposed) draw();
    else schedule();
  });
  resizeObserver.observe(viewport);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else schedule();
    },
    {signal: abort.signal},
  );
  window.addEventListener('pageshow', schedule, {signal: abort.signal});
  window.addEventListener(
    'pagehide',
    (event) => {
      cancelAnimationFrame(frame);
      frame = 0;
      if (event.persisted) return;
      disposed = true;
      abort.abort();
      resizeObserver.disconnect();
      showcase?.dispose();
      parking?.dispose();
      flight?.stop();
      sceneTransition?.dispose();
      securityPreview?.dispose();
      simulation?.dispose();
      controls.dispose();
      model?.traverse((object) => {
        object.geometry?.dispose();
      });
      for (const material of ownedMaterials) material.dispose();
      surfaceTextures?.dispose();
      renderKit?.dispose();
      renderer.dispose();
    },
    {signal: abort.signal},
  );

  async function loadModel() {
    let gltf;
    try {
      const response = await fetch('./model/osd-building.glb', {signal: abort.signal});
      if (!response.ok) throw new Error('model unavailable');
      const buffer = await response.arrayBuffer();
      gltf = await new GLTFLoader().parseAsync(buffer, '');
      if (disposed) {
        gltf.scene.traverse((o) => {
          o.geometry?.dispose();
          for (const m of o.material ? [].concat(o.material) : []) m.dispose();
        });
        return;
      }
      model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      if (bounds.isEmpty()) throw new Error('empty model');
      for (let n = 1; n <= 5; n++) {
        const root = model.getObjectByName(`Floor_${n}`);
        if (!root) throw new Error('floor group missing');
        floorRoots.push(root);
        basePositions.set(root, root.position.clone());
      }
      if (floorRoots[0].userData.receptionSign)
        floorRoots[0].add(renderKit.createReceptionSign(floorRoots[0].userData.receptionSign));
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      surfaceTextures.apply(model);
      // No arrows painted on the ground (noise from the demo's views; the car park draws none either).
      model.getObjectByName('Parking_aisle_direction_arrows')?.removeFromParent();
      mergeStaticMeshes(floorRoots);
      // Preserve all Y coordinates: floor elevations are provisional but meaningful.
      for (const root of floorRoots)
        root.traverse((object) => {
          if (!object.isMesh && !object.isLine) return;
          if (!object.userData.type) {
            for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
              if (parent.userData.type) {
                object.userData.type = parent.userData.type;
                break;
              }
            }
          }
          floorOf.set(object, floorRoots.indexOf(root) + 1);
          if (object.userData.exterior) presentationMeshes.push(object);
          if (object.isMesh) {
            object.castShadow = !['glass', 'water', 'facade_screen'].includes(object.userData.type);
            object.receiveShadow = true;
          }
          if (object.userData.type === 'facade_screen') {
            ownedMaterials.add(object.material);
            object.material = object.material.clone();
            object.material.alphaMap = renderKit.perforation;
            object.material.alphaTest = 0.45;
            object.material.opacity = 1;
            object.material.transparent = false;
            object.material.depthWrite = true;
          }
          const materials = [].concat(object.material || []);
          materials.forEach((material) => ownedMaterials.add(material));
          // Glass panes and door leaves are flat: one pass draws them the same. three.js otherwise draws transparent
          // double-sided materials twice, flagging a shader re-check each time (~70 extra lookups per frame).
          for (const material of materials)
            if (material.transparent && material.side === THREE.DoubleSide) material.forceSinglePass = true;
          if (cutTypes.has(object.userData.type)) {
            let cut = cutMeshes.find((entry) => entry.root === root);
            if (!cut) {
              cut = {root, plane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5)};
              cutMeshes.push(cut);
            }
            const clones = materials.map((material) => {
              const m = material.clone();
              m.clipShadows = true;
              m.clippingPlanes = [cut.plane];
              return m;
            });
            object.material = Array.isArray(object.material) ? clones : clones[0];
            clones.forEach((material) => ownedMaterials.add(material));
          }
          if (object.userData.type === 'roof') roofs.push(object);
          if (object.userData.type === 'ceiling') ceilings.push(object);
          if (object.userData.type === 'device') deviceMeshes.push(object);
        });
      const light = deviceMeshes.find((o) => o.userData.roomId === MEETING_ROOM && o.userData.deviceKind === 'light'),
        rim = deviceMeshes.find((o) => o.parent === light.parent && o.name.endsWith('_device_rim')),
        ownRim = splitRim(rim, light);
      floorOf.set(ownRim, floorOf.get(rim));
      deviceMeshes.push(ownRim);
      // Static building: compose its ~900 matrices once here instead of every frame. Only the floors move (exploded
      // view; updateView recomposes them) and the door hinges swing; objects added later keep three.js's default update.
      model.updateMatrixWorld(true);
      model.traverse((object) => {
        object.matrixAutoUpdate =
          object.userData.deviceKind === 'door' && Boolean(object.userData.doorId) && !object.isMesh;
      });
      scene.add(model);
      renderKit.addPondReflections(model);
      const koi = createKoi({model, camera, schedule});
      abort.signal.addEventListener('abort', () => koi.dispose(), {once: true});
      // Night room lighting: a pool of 6 spot lights, 1 casting shadows, to stay light on laptop GPUs.
      simulation = await createSimulation({
        THREE,
        scene,
        model,
        floorRoots,
        renderer,
        camera,
        schedule,
        spotLights: 6,
        shadowSpots: 1,
        onSelectFloor(n) {
          if (view.floor !== String(n)) {
            view.floor = String(n);
            view.interior = null;
            updateView();
          }
        },
        // Night is the world clock's: the sky follows it (below), and the night button asks it for 20:00 or 07:30.
        onNightChange(night) {
          setPageNight(night);
          renderer.shadowMap.needsUpdate = true;
          schedule();
        },
        onNightRequest(wantNight) {
          world.jumpTo(wantNight ? NIGHT_AT : DAY_AT);
        },
      });
      // The world clock drives the sky (in steps of 6 s of world time, each one redraw and one shadow update: about ten a
      // second in a 20-minute day, so the shadows move smoothly; in 2-minute steps they jumped every 2 s) and
      // switches the rooms' lights on after dusk.
      let skyStep = null;
      const followClock = () => {
        const minute = world.minute(),
          step = Math.round(minute * (quality.light ? 2 : 10));
        if (step !== skyStep) {
          skyStep = step;
          applySky({minute, scene, hemisphere, key, fill, dayBackground});
          fitShadow();
          renderer.shadowMap.needsUpdate = true;
          schedule();
        }
        const dark = isDark(minute);
        if (simulation.getState().night !== dark) simulation.setNight(dark);
        setPageNight(dark);
      };
      followClock();
      const offClock = world.subscribe((kind) => {
        if (kind !== 'wrap') followClock();
      });
      abort.signal.addEventListener('abort', offClock, {once: true});
      // The sun's steps come from the engine's tick (every 50 ms of simulation time): the clock's own events come every
      // 250 ms, 16 s of world time in a 20-minute day, too far apart for 6 s steps.
      const offSun = onTick(() => {
        if (Math.round(world.minute() * 10) !== skyStep) followClock();
      });
      abort.signal.addEventListener('abort', offSun, {once: true});
      status.dataset.state = 'ready';
      status.textContent = L('โมเดลพร้อมแสดง', 'Model ready');
      explore?.enable(true);
      updateView();
      if (isShowcase) {
        securityPreview = createSecurityPreview({
          renderer,
          scene,
          schedule,
          fullVisibility: [...floorRoots, ...presentationMeshes, ...roofs, ...ceilings],
        });
        sceneTransition = createSceneTransition({
          model,
          schedule,
          onFinish: () => {
            renderer.shadowMap.needsUpdate = true;
          },
          onProgress: () => {
            if (!quality.light) renderer.shadowMap.needsUpdate = true;
          },
        });
        // The parking access demo adds its own lot, cars and UI to this scene (src/parking).
        const parkingModule = await parkingCode;
        const navigation = createNavigation({
          scene,
          model,
          camera,
          controls,
          flight,
          readPose,
          writePose,
          sceneTransition,
          meetingRoom: simulation.rooms.find((r) => r.id === MEETING_ROOM),
          parkingPose: parkingModule.PARKING_POSES.lot,
          showStop(id) {
            const stop = stops[id];
            Object.assign(view, {
              floor: stop.view,
              below: stop.below,
              exploded: false,
              cutaway: stop.cutaway,
              interior: id,
              exterior: true,
              side: false,
              devices: stop.devices,
            });
            updateView({reframe: false});
          },
          schedule,
          signal: abort.signal,
        });
        parking = parkingModule.createParking({
          scene,
          schedule,
          camera,
          renderer,
          afterRender,
          capture: (camera) => securityPreview.capture(camera),
          fly: navigation.fly,
        });
        parking.lot.root.visible = renderKit.ground.visible;
        if (debug) window.__parking = parking;
        parking.setNight(simulation.getState().night);
        simulation.subscribe(() => parking.setNight(simulation.getState().night));
        showcase = createShowcase({
          model,
          simulation,
          schedule,
          redrawShadows: () => {
            renderer.shadowMap.needsUpdate = true;
          },
          parking,
          cancelFlight: navigation.cancel,
          onUserOrbit: (callback) => {
            controls.addEventListener('start', callback);
            // Capture: runs before the canvas's own key handler, so R (Reset view) starts after this has cancelled the old flight, as the button does.
            // Arrows move the view with or without a modifier (the controls take Ctrl/Alt+arrow too), so they always count.
            canvas.addEventListener(
              'keydown',
              (e) => {
                const browserKey = e.ctrlKey || e.metaKey || e.altKey;
                if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || (!browserKey && viewKey(e)))
                  callback();
              },
              {capture: true, signal: abort.signal},
            );
          },
          navigate: navigation.navigate,
        });
        // The `warm: 0` option skips it (the screenshots, which do not measure smoothness; it takes over a second of each
        // page load).
        const warmed = () => {
          document.documentElement.dataset.warm = 'done';
        };
        if (options.warm === '0') warmed();
        else {
          // Show the building once, then keep the loading message up while the warm-up runs (about 2 s).
          renderer.render(scene, camera);
          warming = true;
          status.dataset.state = 'loading';
          status.textContent = L('กำลังเตรียมอาคาร…', 'Preparing the building…');
          void warmUp({renderer, scene, camera, sceneTransition, securityPreview}).finally(() => {
            warming = false;
            status.dataset.state = 'ready';
            status.textContent = L('โมเดลพร้อมแสดง', 'Model ready');
            renderer.shadowMap.needsUpdate = true;
            warmed();
            schedule();
          });
        }
        createViewControls({
          camera,
          controls,
          schedule,
          pushForward,
          heightStep,
          closeRange,
          flight,
          navigation,
          showcase,
          storyRunning: () => showcase.getState().story || parking.story.running,
          signal: abort.signal,
        });
      }
      if (!isShowcase) {
        // The exploration page shows the car park too: lot, parked cars and traffic, without the showcase UI.
        const {createParkingScene} = await parkingCode;
        parking = createParkingScene({scene, schedule, camera, renderer});
        // The rooms follow the building's daily schedule here too (the showcase does it in building-insights.js).
        const followRooms = createRoomSchedule(simulation);
        followRooms(world.minute(), {all: true});
        const offRooms = world.subscribe((kind) => {
          if (kind === 'tick') followRooms(world.minute());
          else if (kind === 'jump' || kind === 'set') followRooms(world.minute(), {all: true});
        });
        abort.signal.addEventListener('abort', offRooms, {once: true});
        parking.lot.root.visible = renderKit.ground.visible;
        parking.setNight(simulation.getState().night);
        simulation.subscribe(() => parking.setNight(simulation.getState().night));
      }
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed)
        fail(
          L(
            'โหลดโมเดลไม่สำเร็จ ตรวจสอบไฟล์โมเดล แล้วลองโหลดใหม่',
            'Could not load the model. Check the model file, then reload.',
          ),
        );
    }
  }
  void loadModel();
} catch {
  renderer?.dispose();
  fail(
    L('เปิดมุมมอง 3D ไม่สำเร็จ กรุณาเปิดใช้ WebGL แล้วลองโหลดใหม่', 'Could not open the 3D view. Turn on WebGL, then reload.'),
  );
}
