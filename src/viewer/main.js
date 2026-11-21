import {createCameraFlight} from 'osd/viewer/camera-flight.js';
import {createSecurityPreview} from 'osd/viewer/security-preview.js';
import {createSceneTransition} from 'osd/viewer/scene-transition.js';
import {createShowcase,translatePage,pageString} from 'osd/viewer/showcase.js';
import {L} from 'osd/parking/i18n.js';
import {SPEED, world, isPaused} from 'osd/parking/clock.js';
import {applySky, isDark} from 'osd/viewer/daylight.js';
import {createRoomSchedule} from 'osd/viewer/building-day.js';
import {createKoi} from 'osd/viewer/koi.js';
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import { OrbitControls } from 'osd/node_modules/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'osd/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'osd/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRenderKit } from 'osd/viewer/render-kit.js';
import { createSimulation } from 'osd/viewer/simulation.js';
import { createSurfaceTextures } from 'osd/viewer/surface-textures.js';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const retry = document.querySelector('#retry');
const floorButtons = [...document.querySelectorAll('[data-floor]')];
const explodeButton = document.querySelector('#explode');
const cutButton = document.querySelector('#cutaway');
const resetButton = document.querySelector('#reset');
const exteriorButton=document.querySelector('#exterior');
const frontButton=document.querySelector('#camera-front');
const sideButton=document.querySelector('#camera-side');
const liftButton=document.querySelector('#lift');
const courtyardButton=document.querySelector('#courtyard'),officeButton=document.querySelector('#office');
const arrivalButton=document.querySelector('#arrival'),receptionButton=document.querySelector('#reception'),stairsButton=document.querySelector('#stairs');
const parkingButton=document.querySelector('#parking'),servicesButton=document.querySelector('#services');
const viewButtons=[...floorButtons,explodeButton,cutButton,resetButton,servicesButton,parkingButton,arrivalButton,receptionButton,stairsButton,exteriorButton,frontButton,sideButton,liftButton,courtyardButton,officeButton];
let exteriorEnabled=true, cameraSide=false, renderKit, simulation, surfaceTextures, interiorView=null;
const ceilings=[],deviceMeshes=[];
const presentationMeshes=[];
const floorLabel = floor => floor === 'all' ? L('ทั้งอาคาร', 'Whole building') : floor === '5' ? L('ดาดฟ้า', 'Rooftop') : L(`ชั้น ${floor}`, `Floor ${floor}`);
const cutTypes = new Set(['wall', 'glass', 'column', 'door', 'stair']);
const abort = new AbortController();
let currentFloor = 'all', exploded = false, cutaway = false;
let renderer, controls, model, resizeObserver, showcase, flight, sceneTransition, securityPreview, parking = null;
const isShowcase=Boolean(document.querySelector('#showcase'));
const dayBackground=isShowcase?'#e6ecee':'#dce5e5'; // the 3D view's daytime background (the sky darkens it at night)
// ?debug=1 (tests, the benchmark: test/) exposes the scene and the demo's parts on window.
const params=new URLSearchParams(location.search),debug=params.has('debug');
// The page's night look (night.css) switches in one go and cross-fades as a whole (a view transition). Fading each
// element's text and background colours instead took both through the same grey halfway, so text blinked out.
let pageNight=null; // the look the page has or is switching to (the switch applies it a frame or two later)
function setPageNight(night){
  const root=document.documentElement,value=String(night);
  if(pageNight===value)return;
  const first=pageNight===null;pageNight=value;
  // No CSS transitions from now until the new look is in place (the night button's own pressed state included).
  root.classList.add('theme-switch');
  let applied=false;
  const apply=()=>{applied=true;root.dataset.night=pageNight;requestAnimationFrame(()=>requestAnimationFrame(()=>root.classList.remove('theme-switch')));};
  if(first||!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){apply();return;}
  // A switch made while another is still starting replaces it; the skipped one only rejects its promises.
  const transition=document.startViewTransition(apply);transition.ready.catch(()=>{});transition.finished.catch(()=>{});transition.updateCallbackDone.catch(()=>{});
  // The cross-fade starts at the browser's next frame; if that is slow to come (a busy or idle page), the new look
  // goes in without it rather than late.
  setTimeout(()=>{if(!applied)transition.skipTransition();},250);
}
let frame = 0, disposed = false;
const floorRoots = [], basePositions = new Map(), cutMeshes = [], roofs = [];
const ownedMaterials = new Set();

retry.addEventListener('click', () => location.reload());
// The page's static texts start in the chosen language (Thai unless English was picked before).
translatePage({initial:true});
function fail(message) {
  status.dataset.state = 'error';
  status.textContent = message;
  retry.hidden = false;
  for (const button of viewButtons) button.disabled = true;
}

try {
  const scene = new THREE.Scene();
  // The scene never moves. Left on, its matrix update each frame forced every object below it to recompute too.
  scene.matrixAutoUpdate = false;
  scene.background = new THREE.Color(dayBackground);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  // ?render=0.5 (the test harness sets it): the 3D view at that fraction of its resolution, without antialiasing and
  // with smaller shadow maps, so software WebGL keeps up (test/browser.mjs). The booth never sets it.
  const renderScale = Math.min(1, Math.max(.25, Number(params.get('render')) || 1));
  renderer = new THREE.WebGLRenderer({ antialias: renderScale === 1, powerPreference: 'default' });
  // Resolution adapts to the machine: start at up to 1.5x device pixels (2x only cost frames on laptops)
  // and step down (never back up) towards 1x while continuous rendering stays under ~38 fps.
  const maxPixelRatio = Math.min(devicePixelRatio, 1.5) * renderScale, minPixelRatio = Math.min(renderScale, maxPixelRatio);
  let pixelRatio = maxPixelRatio, slowFrames = 0, lastFrameAt = 0;
  let warming = false;
  const afterRender = new Set(); // extra views drawn into the same canvas after each frame (the live LPR feed)
  if (debug) Object.assign(window, {__renderer: renderer, __scene: scene, __camera: camera, __world: world});
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  // Shader error checks read every program's link log on first use, which blocks on the GPU: with them on,
  // a stop's first visit stalled ~0.4 s. Keep them for ?debug (tests), skip them for visitors.
  renderer.debug.checkShaderErrors = debug;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;
  renderKit=createRenderKit(renderer,scene);
  surfaceTextures=createSurfaceTextures(renderer);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.dataset.i18nLabel = 'canvas';
  canvas.setAttribute('aria-label', pageString('canvas'));
  viewport.prepend(canvas);
  controls = new OrbitControls(camera, canvas);
  if (debug) window.__controls = controls;
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.listenToKeyEvents(canvas);
  // OrbitControls zooms by a percentage of the distance to its pivot, so steps shrink as you close in and
  // you can never pass the pivot. Close in, a zoom-in step instead moves the camera and the pivot forward
  // together (toward the cursor, or the view centre for the + button), at a steady pace.
  const pushRay = new THREE.Raycaster(), pushNdc = new THREE.Vector2();
  // Below ~20 m a 5% step is under a metre; from there on, steps stay about a metre long.
  const closeRange = () => Math.max(controls.minDistance * 2.5, 20);
  controls.zoomSpeed = 1.4;
  function pushForward(metres, clientX = null, clientY = null) {
    const rect = canvas.getBoundingClientRect();
    pushNdc.set(clientX == null ? 0 : (clientX - rect.left) / rect.width * 2 - 1, clientY == null ? 0 : -(clientY - rect.top) / rect.height * 2 + 1);
    pushRay.setFromCamera(pushNdc, camera);
    const dir = pushRay.ray.direction;
    // Stop at the ground rather than dive through it.
    if (dir.y < 0) metres = Math.min(metres, Math.max(0, (camera.position.y - .9) / -dir.y));
    if (metres <= .01) return false;
    camera.position.addScaledVector(dir, metres);
    controls.target.addScaledVector(dir, metres);
    controls.update(); schedule();
    return true;
  }
  // Touchpads: two fingers scroll to pan, as in maps (holding the right button, the other way to pan, is awkward on a
  // touchpad); a pinch still zooms (it arrives as a wheel with ctrlKey), and so does a mouse wheel. Shift- or Ctrl-drag
  // pans too. A touchpad's scroll comes as a stream of small steps (a few px, often with a sideways part); a wheel notch
  // moves 50 px or more at once (53⅓ in Chromium on Linux, 100 on Windows). (wheelDelta did not tell them apart on
  // Linux.) Once a scroll pans, the rest of its stream does too, so a fast flick's bigger steps do not turn into zooms.
  // Runs before the close zoom below, which would take a scroll up as a step forward.
  let panningUntil = 0;
  const touchpadScroll = event => {
    if (event.ctrlKey || event.deltaMode !== 0) return false;
    const now = performance.now(), pad = now < panningUntil || event.deltaX !== 0 || Math.abs(event.deltaY) < 50;
    if (pad) panningUntil = now + 200;
    return pad;
  };
  canvas.addEventListener('wheel', event => {
    if (!model || !controls.enabled || !controls.enablePan || !touchpadScroll(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    controls.dispatchEvent({type: 'start'});
    controls._pan(-event.deltaX, -event.deltaY); controls.update();
    controls.dispatchEvent({type: 'end'}); schedule();
  }, {capture: true, passive: false, signal: abort.signal});
  canvas.addEventListener('wheel', event => {
    if (!model || event.deltaY >= 0 || !controls.enabled || !controls.enableZoom) return;
    if (camera.position.distanceTo(controls.target) > closeRange()) return;
    // At the ground there is nowhere further to go; let the normal zoom have the event.
    if (!pushForward(Math.min(2.4, .5 + Math.abs(event.deltaY) / 200), event.clientX, event.clientY)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    controls.dispatchEvent({type: 'start'}); controls.dispatchEvent({type: 'end'});
  }, {capture: true, passive: false, signal: abort.signal});
  const hemisphere=new THREE.HemisphereLight(0xebf6ff, 0x7b8066, 1.05);scene.add(hemisphere);
  const key = new THREE.DirectionalLight(0xffe7ba, 3.2);
  key.position.set(-18, 35, 28);
  key.castShadow=true;
  const shadowSize=(innerWidth<700?1024:2048)*(renderScale<1?.5:1);
  key.shadow.mapSize.set(shadowSize,shadowSize);
  Object.assign(key.shadow.camera,{left:-42,right:42,top:38,bottom:-38,near:.5,far:110});
  key.shadow.bias=-.00025;key.shadow.normalBias=.06;key.shadow.radius=3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9e2ed, .6);
  fill.position.set(-30, 20, -20);
  scene.add(fill);

  // ?fps=1 shows how many frames per second the 3D view actually draws (for checking the event laptop).
  const fpsMeter = params.has('fps') ? (() => {
    const el = Object.assign(document.createElement('div'), {style: 'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;border-radius:6px;background:#0f1720cc;color:#9ff0b5;font:12px/1.4 ui-monospace,monospace;pointer-events:none'});
    document.body.append(el);
    let frames = 0, since = performance.now();
    return () => { frames++; const now = performance.now(); if (now - since >= 1000) { el.textContent = `${Math.round(frames * 1000 / (now - since))} fps`; frames = 0; since = now; } };
  })() : null;
  // Every draw of the main view also draws the extra views, or the LPR pop-up would show the main scene for a frame.
  function draw() {
    renderer.render(scene, camera);
    for (const extra of afterRender) extra();
  }
  function schedule() {
    if (frame || disposed || document.hidden) return;
    frame = requestAnimationFrame(time => {
      frame = 0;
      if (disposed || warming) return;
      draw();
      fpsMeter?.();
      adaptResolution(time);
    });
  }
  // While the camera flies, draw at ~70% resolution and pause the pond mirror (it would re-render the scene every
  // frame) until the camera stops. Motion hides the softness; full sharpness comes back on the last frame.
  let inMotion = false;
  function applyPixelRatio() {
    renderer.setPixelRatio(inMotion ? Math.max(.6 * renderScale, pixelRatio * .7) : pixelRatio);
    renderer.setSize(Math.max(viewport.clientWidth, 1), Math.max(viewport.clientHeight, 1), false);
    draw(); // resizing clears the canvas: redraw at once so no blank frame shows
  }
  function setInMotion(value) {
    if (value === inMotion) return;
    inMotion = value;
    renderKit.setReflectionsPaused(value);
    applyPixelRatio();
    // Landed: keep drawing while the pond's reflection fades back in.
    if (!value) { const until = performance.now() + renderKit.fadeMs + 50; const pump = () => { schedule(); if (performance.now() < until) requestAnimationFrame(pump); }; requestAnimationFrame(pump); }
  }
  function adaptResolution(time) {
    const gap = time - lastFrameAt; lastFrameAt = time;
    if (gap > 200) return; // an idle pause, not a slow frame
    if (gap > 26) slowFrames++; else if (gap < 18.5) slowFrames = Math.max(0, slowFrames - 1);
    // Only ever step down: stepping back up made the picture go sharp and soft while orbiting.
    if (slowFrames <= 45) return;
    slowFrames = 0;
    const next = Math.max(minPixelRatio, pixelRatio - .25);
    if (next === pixelRatio) return;
    pixelRatio = next;
    applyPixelRatio();
  }
  controls.addEventListener('change', schedule);
  // Near plane follows the viewing distance. A fixed 1 cm near plane left ~1.5 cm of depth precision at 50 m,
  // so road paint, kerbs and coplanar model surfaces flickered while the camera moved.
  controls.addEventListener('change', () => {
    const near = THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) * .015, .03, 1.2);
    if (Math.abs(near - camera.near) / camera.near > .02) { camera.near = near; camera.updateProjectionMatrix(); }
  });
  const readPose=()=>({eye:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov});
  const writePose=pose=>{camera.position.fromArray(pose.eye);controls.target.fromArray(pose.target);camera.fov=pose.fov;camera.updateProjectionMatrix();controls.update();schedule();};
  flight=createCameraFlight({read:readPose,write:writePose,onState(active){viewport.classList.toggle('flying',active);const el=document.querySelector('#flight-status');if(el)el.textContent=active?L('กำลังพาไปยังจุดที่เลือก…','Taking you to the selected spot…'):'';setInMotion(active);}});
  // ?speed=N (tests, rehearsals) shortens every camera flight like the rest of the demo's timing.
  if (SPEED !== 1) { const flyPath = flight.flyPath; flight.flyPath = steps => flyPath(steps.map(step => ({...step, duration: (step.duration ?? 1800) / SPEED}))); }
  if(isShowcase)renderKit.ground.material.color.set(dayBackground);

  function visibleBounds() {
    const bounds = new THREE.Box3();
    model?.updateWorldMatrix(true, true);
    for (const root of floorRoots) {
      if (!root.visible) continue;
      root.traverseVisible(object => {
        if (!object.isMesh && !object.isLine) return;
        object.geometry.computeBoundingBox();
        const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
        if (cutaway && cutTypes.has(object.userData.type)) {
          box.max.y = Math.min(box.max.y, root.getWorldPosition(new THREE.Vector3()).y + 1.2);
        }
        if (!box.isEmpty()) bounds.union(box);
      });
    }
    return bounds;
  }

  function frameVisible() {
    if (!model) return;
    camera.fov=38;camera.updateProjectionMatrix();
    const bounds = visibleBounds();
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const whole=currentFloor==='all'&&!exploded&&!cutaway;
    const direction = new THREE.Vector3(cameraSide?-1.1:.72, whole?.37:.85, 1.6).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    // Fit actual box corners in the chosen camera orientation. A bounding sphere
    // leaves flat floor plans unnecessarily small in a wide architectural viewport.
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const corner = new THREE.Vector3(x, y, z).sub(center);
      distance = Math.max(distance,
        corner.dot(direction) + Math.abs(corner.dot(right)) / (Math.tan(halfFov) * camera.aspect),
        corner.dot(direction) + Math.abs(corner.dot(up)) / Math.tan(halfFov));
    }
    distance = Math.max(distance * 1.12, 1);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(radius / 200, 0.01);
    camera.far = Math.max(distance * 10, 200);
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.12;
    controls.maxDistance = distance * 4;
    controls.update();
    schedule();
  }

  function updateView({reframe=true}={}) {
    for (const [index, root] of floorRoots.entries()) {
      root.visible = currentFloor === 'all' || currentFloor === String(index + 1);
      root.position.copy(basePositions.get(root));
      if (exploded && currentFloor === 'all') root.position.y += index * 2.5;
      root.updateMatrix(); // floors do not update their own matrix (see loadModel)
    }
    model.updateWorldMatrix(true, true);
    // Cutaway only moves each floor's clipping plane (far above the model when off). Swapping planes in and
    // out changed every wall's shader and froze the view for ~0.7 s on each switch to or from the meeting room.
    for (const { root, plane } of cutMeshes) plane.constant = cutaway ? root.getWorldPosition(new THREE.Vector3()).y + 1.2 : 1e5;
    const showExterior=exteriorEnabled&&currentFloor==='all'&&!exploded&&!cutaway;
    for(const object of presentationMeshes)object.visible=showExterior;
    for (const roof of roofs) roof.visible = showExterior||(currentFloor==='5'&&!cutaway&&!exploded&&roof.name.endsWith('service_roof_caps'));
    for(const device of deviceMeshes)device.visible=!cutaway;
    for(const ceiling of ceilings)ceiling.visible=!cutaway&&!exploded&&(currentFloor==='all'||ceiling.userData.ceilingScope==='stair'||['courtyard','arrival','reception'].includes(interiorView));
    exteriorButton.disabled=currentFloor!=='all'||exploded||cutaway;
    exteriorButton.setAttribute('aria-pressed',String(showExterior));
    renderKit.ground.visible=currentFloor==='all'||currentFloor==='1';
    if(parking)parking.lot.root.visible=renderKit.ground.visible;
    renderKit.setReflectionLive(currentFloor==='1'&&!cutaway&&!exploded);
    renderer.shadowMap.needsUpdate=true;
    for (const button of floorButtons) button.setAttribute('aria-pressed', String(button.dataset.floor === currentFloor));
    explodeButton.disabled = currentFloor !== 'all';
    explodeButton.setAttribute('aria-pressed', String(exploded && currentFloor === 'all'));
    cutButton.setAttribute('aria-pressed', String(cutaway));
    document.querySelector('#view-label').textContent = floorLabel(currentFloor);
    if(reframe)frameVisible();
    simulation?.setView({currentFloor,cutaway,exploded});
  }

  for (const button of floorButtons) button.addEventListener('click', () => { currentFloor = button.dataset.floor; interiorView=null; updateView(); });
  explodeButton.addEventListener('click', () => { exploded = !exploded; updateView(); });
  cutButton.addEventListener('click', () => { cutaway = !cutaway; updateView(); });
  resetButton.addEventListener('click', frameVisible);
  exteriorButton.addEventListener('click',()=>{exteriorEnabled=!exteriorEnabled;updateView();});
  function exteriorCamera(side){interiorView=null;cameraSide=side;currentFloor='all';exploded=false;cutaway=false;exteriorEnabled=true;updateView();}
  frontButton.addEventListener('click',()=>exteriorCamera(false));
  sideButton.addEventListener('click',()=>exteriorCamera(true));
  liftButton.addEventListener('click',()=>{
    if(currentFloor==='all')currentFloor='2';cutaway=false;updateView();
    const door=model.getObjectByName(`Floor_${currentFloor}_lift_doors`);
    if(!door)return;
    const b=new THREE.Box3().setFromObject(door),target=b.getCenter(new THREE.Vector3());
    camera.fov=50;camera.updateProjectionMatrix();
    controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(.1,.4,3.1));
    controls.minDistance=.5;controls.update();schedule();
    document.querySelector('#view-label').textContent=`${L('ลิฟต์','Lift')} · ${floorLabel(currentFloor)}`;
  });
  function interiorCamera(kind){
    interiorView=kind;currentFloor=['office','stairs'].includes(kind)?'2':'1';exploded=false;cutaway=kind==='office';updateView();
    const root=floorRoots[Number(currentFloor)-1];
    const preset=root.userData.arrivalCameras?.[kind];
    const eye=preset?.eye||(kind==='services'?[-13,11,6]:kind==='parking'?[-25,15,25]:kind==='stairs'?[14.1,1.75,-4.85]:kind==='courtyard'?[16.7,2.05,3.2]:[3.7,5.5,17.5]);
    const target=preset?.target||(kind==='services'?[-4,.4,-4]:kind==='parking'?[-13.5,.3,3.5]:kind==='stairs'?[9.4,1.3,-4.85]:kind==='courtyard'?[23.5,1,-2.5]:[3.7,.6,6.6]);
    camera.fov=58;camera.position.copy(root.localToWorld(new THREE.Vector3(...eye)));
    controls.target.copy(root.localToWorld(new THREE.Vector3(...target)));controls.minDistance=.4;
    camera.updateProjectionMatrix();controls.update();schedule();
    document.querySelector('#view-label').textContent={services:L('ห้องบริการ','Service rooms'),parking:L(`ที่จอดรถ · ${root.userData.parking?.count||6} คัน`,`Parking · ${root.userData.parking?.count||6} spaces`),courtyard:L('บ่อปลา','Fish pond'),office:L('สำนักงาน','Offices'),arrival:L('ลานวนรถ','Drop-off'),reception:L('ต้อนรับ','Reception'),stairs:L('บันได','Stairs')}[kind]+(kind==='parking'?'':` · ${floorLabel(currentFloor)}`);
  }
  courtyardButton.addEventListener('click',()=>interiorCamera('courtyard'));
  officeButton.addEventListener('click',()=>interiorCamera('office'));
  arrivalButton.addEventListener('click',()=>interiorCamera('arrival'));
  receptionButton.addEventListener('click',()=>interiorCamera('reception'));
  servicesButton.addEventListener('click',()=>interiorCamera('services'));
  parkingButton.addEventListener('click',()=>interiorCamera('parking'));
  stairsButton.addEventListener('click',()=>interiorCamera('stairs'));
  canvas.addEventListener('keydown', event => {
    if (!model) return;
    if (event.key.toLowerCase() === 'r') { if (showcase) showcase.resetView(); else frameVisible(); }
    else if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(offset.length() * (event.key === '-' ? 1.15 : 1 / 1.15), controls.minDistance, controls.maxDistance);
      camera.position.copy(controls.target).add(offset.setLength(distance));
      controls.update();
      schedule();
    }
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    fail(L('การแสดงผล 3D หยุดทำงาน ลองโหลดหน้านี้ใหม่','3D rendering stopped. Try reloading this page.'));
  });

  let lastAspect = 0;
  resizeObserver = new ResizeObserver(() => {
    const width = Math.max(viewport.clientWidth, 1), height = Math.max(viewport.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (model && !isShowcase && Math.abs(lastAspect - camera.aspect) > 0.25) frameVisible();
    lastAspect = camera.aspect;
    // Resizing clears the canvas: redraw before this frame is painted, or the view shows empty for a frame (the car
    // park's layout change resizes it as the flight sets off).
    if (model && !warming && !disposed) draw(); else schedule();
  });
  resizeObserver.observe(viewport);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else schedule();
  }, { signal: abort.signal });
  window.addEventListener('pageshow', schedule, { signal: abort.signal });
  window.addEventListener('pagehide', event => {
    cancelAnimationFrame(frame); frame = 0;
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
    model?.traverse(object => { object.geometry?.dispose(); });
    for (const material of ownedMaterials) material.dispose();
    surfaceTextures?.dispose();
    renderKit?.dispose();
    renderer.dispose();
  }, { signal: abort.signal });

  // Interior partition walls are many small static meshes that nothing addresses one by one: merge each
  // floor's walls of the same look into one mesh. Fewer draw calls, same picture, same cutaway clipping.
  function mergeStaticPartitions(root) {
    const groups = new Map();
    const look = m => [m.type, m.color?.getHexString(), m.map?.uuid, m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.alphaTest].join('|');
    root.traverse(o => {
      if (!o.isMesh || !/interior_partition/.test(o.name) || o.children.length || Array.isArray(o.material)) return;
      const key = [o.parent.uuid, o.userData.type, look(o.material), Object.keys(o.geometry.attributes).sort().join(), Boolean(o.geometry.index)].join('#');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    });
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const parent = list[0].parent;
      const parts = list.map(o => { o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); });
      const merged = mergeGeometries(parts);
      for (const g of parts) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.name = `${parent.name}_interior_partitions`;
      mesh.userData = {type: list[0].userData.type, merged: list.length};
      for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
      parent.add(mesh);
    }
  }

  async function loadModel() {
    let gltf;
    try {
      const response = await fetch("./model/osd-building.glb", { signal: abort.signal });
      if (!response.ok) throw new Error('model unavailable');
      const buffer = await response.arrayBuffer();
      gltf = await new GLTFLoader().parseAsync(buffer, '');
      if (disposed) {
        gltf.scene.traverse(o => { o.geometry?.dispose(); for (const m of o.material ? [].concat(o.material) : []) m.dispose(); });
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
      if(floorRoots[0].userData.receptionSign)floorRoots[0].add(renderKit.createReceptionSign(floorRoots[0].userData.receptionSign));
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.x -= center.x;
      model.position.z -= center.z;
      surfaceTextures.apply(model);
      mergeStaticPartitions(model);
      // Preserve all Y coordinates: floor elevations are provisional but meaningful.
      for (const root of floorRoots) root.traverse(object => {
        if (!object.isMesh && !object.isLine) return;
        if (!object.userData.type) {
          for (let parent = object.parent; parent && parent !== root; parent = parent.parent) {
            if (parent.userData.type) { object.userData.type = parent.userData.type; break; }
          }
        }
        if(object.userData.exterior)presentationMeshes.push(object);
        if(object.isMesh){object.castShadow=!['glass','water','facade_screen'].includes(object.userData.type);object.receiveShadow=true;}
        if(object.userData.type==='facade_screen'){
          ownedMaterials.add(object.material);
          object.material=object.material.clone();object.material.alphaMap=renderKit.perforation;
          object.material.alphaTest=.45;object.material.opacity=1;object.material.transparent=false;object.material.depthWrite=true;
        }
        const materials = [].concat(object.material || []);
        materials.forEach(material => ownedMaterials.add(material));
        // Glass panes and door leaves are flat: one pass draws them the same. three.js otherwise draws transparent
        // double-sided materials twice, flagging a shader re-check each time (~70 extra lookups per frame).
        for (const material of materials) if (material.transparent && material.side === THREE.DoubleSide) material.forceSinglePass = true;
        if (cutTypes.has(object.userData.type)) {
          let cut = cutMeshes.find(entry => entry.root === root);
          if (!cut) { cut = { root, plane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5) }; cutMeshes.push(cut); }
          const clones = materials.map(material => {const m=material.clone();m.clipShadows=true;m.clippingPlanes=[cut.plane];return m;});
          object.material = Array.isArray(object.material) ? clones : clones[0];
          clones.forEach(material => ownedMaterials.add(material));
        }
        if (object.userData.type === 'roof') roofs.push(object);
        if (object.userData.type === 'ceiling') ceilings.push(object);
        if(object.userData.type==='device')deviceMeshes.push(object);
      });
      // Static building: compose its ~900 matrices once here instead of every frame. Only the floors move (exploded
      // view; updateView recomposes them) and the door hinges swing; objects added later keep three.js's default update.
      model.updateMatrixWorld(true);
      model.traverse(object => { object.matrixAutoUpdate = object.userData.deviceKind === 'door' && Boolean(object.userData.doorId) && !object.isMesh; });
      scene.add(model);
      renderKit.addPondReflections(model);
      const koi=createKoi({model,camera,schedule});abort.signal.addEventListener('abort',()=>koi.dispose(),{once:true});
      if(debug)window.__koi=koi;
      // Night room lighting: a pool of 6 spot lights, 1 casting shadows, to stay light on laptop GPUs.
      simulation=await createSimulation({THREE,scene,model,floorRoots,renderer,camera,schedule,spotLights:6,shadowSpots:1,
        onSelectFloor(n){if(currentFloor!==String(n)){currentFloor=String(n);interiorView=null;updateView();}},
        // Night is the world clock's: the sky follows it (below), and the night button asks it for 20:00 or 07:30.
        onNightChange(night){setPageNight(night);renderer.shadowMap.needsUpdate=true;schedule();},
        onNightRequest(wantNight){world.jumpTo(wantNight?20*60:7*60+30);}
      });
      // The world clock drives the sky (in 2-minute steps of world time, each one redraw and one shadow update) and
      // switches the rooms' lights on after dusk.
      let skyStep=null;
      const followClock=()=>{
        const minute=world.minute(),step=Math.round(minute/2);
        if(step!==skyStep){skyStep=step;applySky({minute,scene,renderer,hemisphere,key,fill,dayBackground});renderer.shadowMap.needsUpdate=true;schedule();}
        if(simulation.getState().night!==isDark(minute))simulation.setNight(isDark(minute));
        setPageNight(isDark(minute));
      };
      followClock();
      if(debug)Object.assign(window,{__simulation:()=>simulation.getState(),__simulationApi:simulation});
      const offClock=world.subscribe(kind=>{if(kind!=='wrap')followClock();});abort.signal.addEventListener('abort',offClock,{once:true});
      status.dataset.state = 'ready';
      status.textContent = L('โมเดลพร้อมแสดง','Model ready');
      for (const button of viewButtons) button.disabled = false;
      updateView();
      if(isShowcase){
       securityPreview=createSecurityPreview({renderer,scene,schedule,fullVisibility:[...floorRoots,...presentationMeshes,...roofs,...ceilings]});
       const meetingRoom=simulation.rooms.find(r=>r.id==='f4_meeting_2'),meetingRoot=model.getObjectByName(`Floor_${meetingRoom.floor}`);
       const meetingTarget=meetingRoot.localToWorld(new THREE.Vector3(meetingRoom.center[0],.8,meetingRoom.center[2]));
       sceneTransition=createSceneTransition({model,schedule,onFinish:()=>{renderer.shadowMap.needsUpdate=true;},onProgress:()=>{renderer.shadowMap.needsUpdate=true;}});
       if(debug)window.__transition=sceneTransition;
       const buildingBounds=new THREE.Box3().setFromObject(model),buildingCenter=buildingBounds.getCenter(new THREE.Vector3());
       let navigation=0,lastDestination='overview',stopPoses=null,docking=false;
       const markerMaterial=new THREE.MeshBasicMaterial({color:'#27a8b3',transparent:true,opacity:.6,depthTest:false,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true});
       const marker=new THREE.Mesh(new THREE.RingGeometry(1.05,1.2,48),markerMaterial);marker.rotation.x=-Math.PI/2;marker.renderOrder=100;marker.visible=false;scene.add(marker);
       abort.signal.addEventListener('abort',()=>{marker.removeFromParent();marker.geometry.dispose();markerMaterial.dispose();},{once:true});
       function contextPose(direction=new THREE.Vector3(.72,.55,1.6)){
        direction=direction.clone().normalize();const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize(),fov=38,tan=Math.tan(THREE.MathUtils.degToRad(fov/2));let distance=1;
        for(const x of [buildingBounds.min.x,buildingBounds.max.x])for(const y of [buildingBounds.min.y,buildingBounds.max.y])for(const z of [buildingBounds.min.z,buildingBounds.max.z]){
         const v=new THREE.Vector3(x,y,z).sub(buildingCenter);distance=Math.max(distance,v.dot(direction)+Math.abs(v.dot(right))/(tan*camera.aspect),v.dot(direction)+Math.abs(v.dot(up))/tan);
        }
        return {eye:buildingCenter.clone().addScaledVector(direction,distance*1.13).toArray(),target:buildingCenter.toArray(),fov};
       }
       function applyDestination(id){
        currentFloor=['overview','energy','parking'].includes(id)?'all':id==='meeting'?String(meetingRoom.floor):'1';exploded=false;cutaway=id==='meeting';interiorView=id;exteriorEnabled=true;cameraSide=false;
        updateView({reframe:false});if(id==='meeting')for(const device of deviceMeshes)device.visible=true;
        renderKit.ground.visible=true;controls.minDistance=.4;controls.maxDistance=500;
       }
       // The parking access demo adds its own lot, cars and UI to this scene (src/parking).
       const parkingModule=await import('osd/parking/index.js');
       // A flight's floors settled at once on a stop's scene: one cut short (see cancelFlight), or taken over.
       function settle(id){sceneTransition.finish();applyDestination(id);lastDestination=id;}
       // The story's camera moves; one that takes over a flight to the car park (Play tapped on the way) settles it there.
       parking=parkingModule.createParking({scene,schedule,camera,renderer,afterRender,capture:camera=>securityPreview.capture(camera),fly:(pose,ms=1600)=>{if(docking){docking=false;settle('parking');}navigation++;return flight.flyPath([{to:pose,duration:ms,onUpdate(){schedule();}}]);}});
       parking.lot.root.visible=renderKit.ground.visible;
       if(debug)window.__parking=parking;
       parking.setNight(simulation.getState().night);simulation.subscribe(()=>parking.setNight(simulation.getState().night));
       // Camera poses aimed at the real objects: the pond, the roof's solar panels and the entrance barrier. The
       // original hard-coded targets sat 4–5 m off them; the viewing angles and distances are kept.
       function objectPoses(){
         if(stopPoses)return stopPoses;
         const ponds=[];model.traverse(o=>{if(o.isMesh&&o.name.includes('_koi_pond_'))ponds.push(o);});
         const aim=(objects,eye,target,fov)=>{
           const box=new THREE.Box3();for(const o of objects)if(o)box.expandByObject(o);
           if(box.isEmpty())return {eye,target,fov};
           const centre=box.getCenter(new THREE.Vector3()),offset=new THREE.Vector3(...eye).sub(new THREE.Vector3(...target));
           return {eye:centre.clone().add(offset).toArray(),target:centre.toArray(),fov};
         };
         stopPoses={
           pond:aim(ponds,[33,14,13],[22.7,1,-2.5],48),
           energy:aim([model.getObjectByName('Floor_5_solar_modules')],[12,29,23],[-1.6,15.6,.8],43),
         };
         return stopPoses;
       }
       showcase=createShowcase({model,simulation,schedule,parking,
        // The floors' change ends with the flight (left mid-cut, the building stayed half cut away where it stopped).
        // The floors' change ends with the flight (left mid-cut, the building stayed half cut away where it stopped), on the
        // scene of the stop on show: the new one once its approach has begun, else the one the flight left.
        cancelFlight:()=>{const flying=flight.running;navigation++;flight.stop();if(flying)settle(lastDestination);marker.visible=false;schedule();},
        onUserOrbit:callback=>{controls.addEventListener('start',callback);
         // Capture: runs before the canvas's own key handler, so R (Reset view) starts its flight after this has cancelled the old one, as the button does.
         canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','r','R','+','=','-'].includes(e.key))callback();},{capture:true,signal:abort.signal});},
        async navigate(id,{instant=false,onPhase=()=>{},onApproach=()=>{}}={}){
          flight.stop();const ticket=++navigation,start=readPose();marker.visible=false;markerMaterial.opacity=.6;
          const settings={
            meeting:{eye:meetingTarget.clone().add(new THREE.Vector3(5,7,8)).toArray(),target:meetingTarget.toArray(),fov:43},
            ...objectPoses(),
            parking:parkingModule.PARKING_POSES.lot
          };
          const to=settings[id]||contextPose(),quick=instant||matchMedia('(prefers-reduced-motion: reduce)').matches;
          if(quick){sceneTransition.finish();applyDestination(id);writePose(to);lastDestination=id;return true;}
          const floors={overview:null,meeting:meetingRoom.floor,pond:1,energy:5,parking:'site'};
          const local=lastDestination!==id&&floors[id]===floors[lastDestination]&&settings[lastDestination]&&new THREE.Vector3(...settings[lastDestination].target).distanceTo(new THREE.Vector3(...to.target))<15;
          const same=id===lastDestination;
          const distance=new THREE.Vector3(...start.eye).distanceTo(new THREE.Vector3(...to.eye));
          if(same&&distance<.1){sceneTransition.finish();return true;} // there already (a repeat tap mid-approach): its change ends
          const phases=[];
          if(local||same){
           // A nearby spot on the same floor (or this stop again): a short step back, then in.
           const retreat={eye:new THREE.Vector3(...start.target).add(new THREE.Vector3(...start.eye).sub(new THREE.Vector3(...start.target)).multiplyScalar(1.3)).toArray(),target:start.target,fov:start.fov};
           if(!same)phases.push({to:retreat,duration:400,onStart(){onPhase(L('ถอยออกจากจุดเดิม','Pulling back'));}});
           phases.push({to,duration:local?750:550,
            onStart(){onPhase(L('กำลังเข้าใกล้จุดหมาย','Approaching'));lastDestination=id;sceneTransition.begin(()=>applyDestination(id));onApproach();},
            onUpdate(t){sceneTransition.progress(Math.min(1,t/.75));},
            onEnd(){sceneTransition.finish();}
           });
          }else{
           // Another stop: one continuous flight that swings out far enough to show where the next stop sits on the
           // building, without first returning to the overview. The curve bends towards the whole-building view from
           // between the two stops' viewing directions. The floors change in two fades, as the camera swings out and as
           // it comes in: the whole building first, then the new stop's cut. One fade straight from one cut to the other
           // showed both half-faded at once (floor 4's furniture over floor 1, a see-through ghost of the building).
           const facing=pose=>new THREE.Vector3(...pose.eye).sub(new THREE.Vector3(...pose.target)).normalize();
           const direction=facing(start).add(facing(to));if(direction.lengthSq()<.01)direction.copy(facing(start));
           direction.normalize();direction.y=Math.max(.35,direction.y);
           const via=contextPose(direction),span=new THREE.Vector3(...start.eye).distanceTo(new THREE.Vector3(...to.eye));
           marker.position.set(to.target[0],id==='energy'?15.8:id==='meeting'?meetingTarget.y-.6:.2,to.target[2]);marker.visible=id!=='overview';
           const SPLIT=.45;let approached=false;
           // The stop's title and panel arrive as the camera starts its descent onto it, with its floors' fade.
           // From here the scene is the new stop's (lastDestination: a cancelled flight settles on it).
           const approach=()=>{approached=true;lastDestination=id;sceneTransition.finish({settled:false});onPhase(L('กำลังเข้าใกล้จุดหมาย','Approaching'));sceneTransition.begin(()=>applyDestination(id));onApproach();};
           phases.push({to,via,duration:Math.round(THREE.MathUtils.clamp(1100+span*12,1300,1900)),
            onStart(){onPhase(L('กำลังเดินทาง','On the way'));sceneTransition.begin(()=>applyDestination('overview'));},
            onUpdate(t){
             if(!approached&&t>=SPLIT)approach();
             sceneTransition.progress(approached?THREE.MathUtils.clamp((t-SPLIT)/(.95-SPLIT),0,1):t/SPLIT);
             markerMaterial.opacity=.6*Math.min(1,t*4)*(1-t);
            },
            onEnd(){if(!approached)approach();sceneTransition.finish();}
           });
          }
          docking=true;
          const arrived=await flight.flyPath(phases);
          if(ticket===navigation)docking=false;
          if(ticket===navigation){marker.visible=false;markerMaterial.opacity=.6;if(arrived)lastDestination=id;schedule();}
          return arrived;
        }
       });
       // Warm-up: a stop's first visit stalled 0.3–0.7 s, compiling and linking shader variants on the spot: the flight's
       // floor change cuts geometry with one more clipping plane (scene-transition.js), and the night's lights change
       // the number of lights. Compile every material each way at load, draw one tiny off-screen frame each way
       // (shadows included), and upload every texture, before anyone clicks. `?warm=0` skips it (tests that do not
       // measure smoothness; it takes over a second of each page load).
       if(params.get('warm')==='0')document.documentElement.dataset.warm='done';
       else{
        const hidden=[];
        // Show the building once, then keep the loading message up while the warm-up runs (about 2 s).
        renderer.render(scene,camera);
        warming=true;
        status.dataset.state='loading';status.textContent=L('กำลังเตรียมอาคาร…','Preparing the building…');
        // Hidden objects are drawn too, so their shaders compile: they read as visible only inside the warm-up's own
        // compile and draw calls (where writes, such as the pond mirror hiding itself for its pass, stay inside too).
        // Everywhere else the app reads and sets their real visibility, which a ?dest= stop may change meanwhile.
        let forcing=0;const forced=fn=>{forcing++;try{return fn();}finally{forcing--;}};
        // The object's `visible` then reads and writes `state.forced` inside forced(), `state.wanted` everywhere else.
        const split=(object,state)=>{Object.defineProperty(object,'visible',{configurable:true,enumerable:true,get:()=>forcing?state.forced:state.wanted,set:value=>{if(forcing)state.forced=value;else state.wanted=value;}});return [object,state];};
        scene.traverse(object=>{if(!object.visible&&!object.isLight)hidden.push(split(object,{wanted:false,forced:true}));});
        // The night's lights (the rooms' spot lights) change the number of lights, so the
        // shaders for the other half of the day are compiled here too: the first dusk (or dawn) then does not freeze
        // the view for a second and a half. They keep their current state, and swap only for the last compile.
        const nightLights=[];
        scene.traverse(object=>{if(object.isSpotLight&&/^Simulation_spot_/.test(object.name))nightLights.push(split(object,{wanted:object.visible,forced:object.visible}));});
        const target=new THREE.WebGLRenderTarget(16,16);
        const drawPixel=()=>forced(()=>{renderer.shadowMap.needsUpdate=true;renderer.setScissorTest(true);renderer.setScissor(0,0,1,1);try{renderer.render(scene,camera);}finally{renderer.setScissorTest(false);}});
        const drawOffscreen=()=>forced(()=>{const previous=renderer.getRenderTarget();renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.setRenderTarget(previous);});
        (async()=>{
         await forced(()=>renderer.compileAsync(scene,camera));
         scene.traverse(object=>{for(const material of [].concat(object.material||[]))for(const value of Object.values(material))if(value?.isTexture)renderer.initTexture(value);});
         drawOffscreen();
         // The flight's floor change draws copies of the building's materials with one more clipping plane: make them
         // now and set them up for the canvas (compiled, then first used in a one-pixel frame, as below), by day and by
         // night (the first night flight to the meeting room froze for 0.2 s).
         const prepareCopies=()=>sceneTransition.prepare(async()=>{await forced(()=>renderer.compileAsync(scene,camera));drawPixel();});
         await prepareCopies();
         securityPreview.prepare();
         for(const [,state] of nightLights)state.forced=!state.wanted;
         await forced(()=>renderer.compileAsync(scene,camera));
         drawOffscreen();
         await prepareCopies();
         // Off-screen frames use other shader variants (linear colour, no tone mapping) than the canvas: the canvas's
         // own are first used, and finish linking, in one frame drawn to the screen clipped to a single pixel, which
         // the next real frame covers.
         drawPixel();
        })().catch(()=>{}).finally(()=>{
         for(const [object,state] of [...hidden,...nightLights])Object.defineProperty(object,'visible',{configurable:true,enumerable:true,writable:true,value:state.wanted});
         warming=false;
         status.dataset.state='ready';status.textContent=L('โมเดลพร้อมแสดง','Model ready');
         target.dispose();renderer.shadowMap.needsUpdate=true;document.documentElement.dataset.warm='done';schedule();
        });
       }
       // View controls: zoom, back to the stop's own view, and a slow orbit when nobody is using the screen.
       const userMove=()=>{controls.dispatchEvent({type:'start'});controls.dispatchEvent({type:'end'});};
       let zoomFrame=0;
       function zoomBy(factor){
        userMove();cancelAnimationFrame(zoomFrame);
        if(factor<1&&camera.position.distanceTo(controls.target)<=closeRange()){pushForward(1.5);return;}
        const offset=camera.position.clone().sub(controls.target),from=offset.length(),to=THREE.MathUtils.clamp(from*factor,controls.minDistance,controls.maxDistance),start=performance.now();
        const step=time=>{const t=Math.min(1,(time-start)/260),e=t*(2-t);camera.position.copy(controls.target).add(offset.setLength(from+(to-from)*e));controls.update();schedule();if(t<1)zoomFrame=requestAnimationFrame(step);};
        zoomFrame=requestAnimationFrame(step);
       }
       document.querySelector('#view-zoom-in').addEventListener('click',()=>zoomBy(1/1.3),{signal:abort.signal});
       document.querySelector('#view-zoom-out').addEventListener('click',()=>zoomBy(1.3),{signal:abort.signal});
       document.querySelector('#view-reset').addEventListener('click',()=>{userMove();showcase.resetView();},{signal:abort.signal});
       const orbitButton=document.querySelector('#view-orbit');
       let orbitEnabled=true;try{orbitEnabled=localStorage.getItem('osd-demo-orbit')!=='off';}catch{}
       orbitButton.setAttribute('aria-pressed',String(orbitEnabled));
       orbitButton.addEventListener('click',()=>{orbitEnabled=!orbitEnabled;orbitButton.setAttribute('aria-pressed',String(orbitEnabled));try{localStorage.setItem('osd-demo-orbit',orbitEnabled?'on':'off');}catch{}if(!orbitEnabled)stopOrbit();},{signal:abort.signal});
       // Idle: 20 s with no input on the 3D view in free use, or 2.5 s into a building stop of the tour/loop. Never while
       // the camera is flying or the parking story is directing it. Only the 3D view's own input counts (the canvas and
       // its view controls): scrolling or tapping the panel, the page or the phone mock-up leaves the camera turning.
       let lastInput=performance.now(),orbitFrame=0;
       const ORBIT_DEG_PER_S=3.5,IDLE_FREE_MS=20000,IDLE_TOUR_MS=2500;
       function stopOrbit(){if(orbitFrame)cancelAnimationFrame(orbitFrame);orbitFrame=0;}
       const onView=target=>Boolean(target.closest?.('#viewport'))&&!target.closest('#view-orbit, #parking-layer');
       for(const type of ['pointerdown','wheel','keydown'])document.addEventListener(type,event=>{if(!onView(event.target))return;lastInput=performance.now();stopOrbit();},{capture:true,signal:abort.signal});
       if(debug)window.__idleNow=()=>{lastInput=-Infinity;}; // tests: idle from now on, without waiting 20 s
       const orbitAllowed=()=>{const st=showcase.getState();if(!orbitEnabled||disposed||document.hidden||isPaused()||flight.running||st.traveling||parking?.story.running)return false;return performance.now()-lastInput>(st.touring?IDLE_TOUR_MS:IDLE_FREE_MS);};
       let flightWasRunning=false;
       const orbitWatch=setInterval(()=>{
        // A tour stop counts as idle only from the moment its flight lands.
        if(flight.running){flightWasRunning=true;return;}
        if(flightWasRunning){flightWasRunning=false;if(showcase.getState().touring)lastInput=performance.now();}
        if(orbitFrame||!orbitAllowed())return;
        let last=performance.now();const up=new THREE.Vector3(0,1,0);
        const tick=time=>{
         if(!orbitAllowed()){orbitFrame=0;return;}
         const dt=Math.min(.1,(time-last)/1000);last=time;
         camera.position.sub(controls.target).applyAxisAngle(up,-THREE.MathUtils.degToRad(ORBIT_DEG_PER_S)*dt).add(controls.target);
         controls.update();schedule();orbitFrame=requestAnimationFrame(tick);
        };
        orbitFrame=requestAnimationFrame(tick);
       },500);
       abort.signal.addEventListener('abort',()=>{clearInterval(orbitWatch);stopOrbit();},{once:true});
      }
      if(!isShowcase){
       // The exploration page shows the car park too: lot, parked cars and traffic, without the showcase UI.
       const {createParkingScene}=await import('osd/parking/index.js');
       parking=createParkingScene({scene,schedule,camera});
       // The rooms follow the building's daily schedule here too (the showcase does it in building-insights.js).
       const followRooms=createRoomSchedule(simulation);followRooms(world.minute(),{all:true});
       const offRooms=world.subscribe(kind=>{if(kind==='tick')followRooms(world.minute());else if(kind==='jump'||kind==='set')followRooms(world.minute(),{all:true});});
       abort.signal.addEventListener('abort',offRooms,{once:true});
       parking.lot.root.visible=renderKit.ground.visible;
       parking.setNight(simulation.getState().night);simulation.subscribe(()=>parking.setNight(simulation.getState().night));
      }
    } catch (error) {
      if (error.name !== 'AbortError' && !disposed) fail(L('โหลดโมเดลไม่สำเร็จ ตรวจสอบไฟล์โมเดล แล้วลองโหลดใหม่','Could not load the model. Check the model file, then reload.'));
    }
  }
  void loadModel();
} catch {
  renderer?.dispose();
  fail(L('เปิดมุมมอง 3D ไม่สำเร็จ กรุณาเปิดใช้ WebGL แล้วลองโหลดใหม่','Could not open the 3D view. Turn on WebGL, then reload.'));
}
