import {createCameraFlight} from 'osd/viewer/camera-flight.js';
import {createSecurityPreview} from 'osd/viewer/security-preview.js';
import {createSceneTransition} from 'osd/viewer/scene-transition.js';
import {createShowcase,translatePage,pageString} from 'osd/viewer/showcase.js';
import {getLang} from 'osd/parking/i18n.js';
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
const extraButtons=[servicesButton,parkingButton,arrivalButton,receptionButton,stairsButton,exteriorButton,frontButton,sideButton,liftButton,courtyardButton,officeButton];
let exteriorEnabled=true, cameraSide=false, renderKit, simulation, surfaceTextures, interiorView=null, dayBackground=null, dayGround=null;
const ceilings=[],deviceMeshes=[];
const presentationMeshes=[];
const labels = { all: 'ทั้งอาคาร', 1: 'ชั้น 1', 2: 'ชั้น 2', 3: 'ชั้น 3', 4: 'ชั้น 4', 5: 'ดาดฟ้า' };
const cutTypes = new Set(['wall', 'glass', 'column', 'door', 'stair']);
const abort = new AbortController();
let currentFloor = 'all', exploded = false, cutaway = false;
let renderer, controls, model, resizeObserver, showcase, flight, sceneTransition, securityPreview, parking = null;
const isShowcase=Boolean(document.querySelector('#showcase')),isAtom=Boolean(document.querySelector('#atom'));
// Status texts follow the TH/EN switch on the showcase page only; #explore and the kiosk stay Thai.
const L=(th,en)=>isShowcase&&getLang()==='en'?en:th;
let frame = 0, disposed = false;
const floorRoots = [], basePositions = new Map(), cutMeshes = [], roofs = [];
const ownedMaterials = new Set();

retry.addEventListener('click', () => location.reload());
// The showcase's static texts start in the chosen language (Thai unless English was picked before).
if(isShowcase)translatePage({initial:true});
function fail(message) {
  status.dataset.state = 'error';
  status.textContent = message;
  retry.hidden = false;
  for (const button of [...floorButtons, explodeButton, cutButton, resetButton, ...extraButtons]) button.disabled = true;
}

try {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dce5e5');
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' });
  // The ATOM kiosk renders on an integrated GPU.
  // Resolution adapts to the machine: start at up to 1.5x device pixels (2x only cost frames on laptops)
  // and step down to 1x while continuous rendering stays under ~38 fps, back up when it is comfortably fast.
  const maxPixelRatio = Math.min(devicePixelRatio, isAtom ? 1.25 : 1.5), minPixelRatio = Math.min(1, maxPixelRatio);
  let pixelRatio = maxPixelRatio, slowFrames = 0, fastFrames = 0, lastFrameAt = 0;
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate=false;
  renderKit=createRenderKit(renderer,scene);
  surfaceTextures=createSurfaceTextures(renderer);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'โมเดลอาคาร OSD ลากเพื่อหมุน ใช้ปุ่มลูกศรเพื่อเลื่อน ปุ่มบวกหรือลบเพื่อซูม และ R เพื่อคืนมุมมอง');
  viewport.prepend(canvas);
  if(isShowcase){canvas.dataset.i18nLabel='canvas';canvas.setAttribute('aria-label',pageString('canvas'));}
  controls = new OrbitControls(camera, canvas);
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
  const shadowSize=innerWidth<700?1024:2048;
  key.shadow.mapSize.set(shadowSize,shadowSize);
  Object.assign(key.shadow.camera,{left:-42,right:42,top:38,bottom:-38,near:.5,far:110});
  key.shadow.bias=-.00025;key.shadow.normalBias=.06;key.shadow.radius=3;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc9e2ed, .6);
  fill.position.set(-30, 20, -20);
  scene.add(fill);

  // ?fps=1 shows how many frames per second the 3D view actually draws (for checking the event laptop).
  const fpsMeter = new URLSearchParams(location.search).has('fps') ? (() => {
    const el = Object.assign(document.createElement('div'), {style: 'position:fixed;left:8px;bottom:8px;z-index:99;padding:4px 8px;border-radius:6px;background:#0f1720cc;color:#9ff0b5;font:12px/1.4 ui-monospace,monospace;pointer-events:none'});
    document.body.append(el);
    let frames = 0, since = performance.now();
    return () => { frames++; const now = performance.now(); if (now - since >= 1000) { el.textContent = `${Math.round(frames * 1000 / (now - since))} fps`; frames = 0; since = now; } };
  })() : null;
  function schedule() {
    if (frame || disposed || document.hidden) return;
    frame = requestAnimationFrame(time => {
      frame = 0;
      if (disposed) return;
      renderer.render(scene, camera); fpsMeter?.();
      adaptResolution(time);
    });
  }
  function adaptResolution(time) {
    const gap = time - lastFrameAt; lastFrameAt = time;
    if (gap > 200) return; // an idle pause, not a slow frame
    if (gap > 26) { slowFrames++; fastFrames = 0; } else if (gap < 18.5) { fastFrames++; slowFrames = Math.max(0, slowFrames - 1); }
    const next = slowFrames > 45 ? Math.max(minPixelRatio, pixelRatio - .25) : fastFrames > 900 ? Math.min(maxPixelRatio, pixelRatio + .25) : pixelRatio;
    if (slowFrames > 45 || fastFrames > 900) { slowFrames = fastFrames = 0; }
    if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); renderer.setSize(Math.max(viewport.clientWidth, 1), Math.max(viewport.clientHeight, 1), false); schedule(); }
  }
  controls.addEventListener('change', schedule);
  const readPose=()=>({eye:camera.position.toArray(),target:controls.target.toArray(),fov:camera.fov});
  const writePose=pose=>{camera.position.fromArray(pose.eye);controls.target.fromArray(pose.target);camera.fov=pose.fov;camera.updateProjectionMatrix();controls.update();schedule();};
  flight=createCameraFlight({read:readPose,write:writePose,onState(active){const el=document.querySelector('#flight-status');if(el)el.textContent=active?L('กำลังพาไปยังจุดที่เลือก…','Taking you to the selected spot…'):'';}});
  // An eased turn of the camera around its target (the lights view). It runs its own frame loop
  // only while it turns; stopSpin(), every flight (flight.stop) and a drag on the model end it.
  let spinFrame=0,spinEnd=null;
  function stopSpin(){if(spinFrame)cancelAnimationFrame(spinFrame);spinFrame=0;const end=spinEnd;spinEnd=null;end?.();}
  function spin({degrees=45,seconds=6}={}){
    stopSpin();
    const ms=Math.max(0,Number(seconds)*1000)||0,turn=THREE.MathUtils.degToRad(Number(degrees)||0);
    if(!turn||!ms||disposed||matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve();
    const from=readPose(),target=new THREE.Vector3(...from.target),offset=new THREE.Vector3(...from.eye).sub(target),up=new THREE.Vector3(0,1,0);
    return new Promise(resolve=>{
      let start=null;spinEnd=resolve;
      const tick=time=>{
        start??=time;const t=Math.min(1,(time-start)/ms),eased=t*t*(3-2*t);
        // + degrees turns right, like adjust_view's yaw.
        writePose({eye:target.clone().add(offset.clone().applyAxisAngle(up,-turn*eased)).toArray(),target:from.target,fov:from.fov});
        if(t<1){spinFrame=requestAnimationFrame(tick);return;}
        spinFrame=0;spinEnd=null;resolve();
      };
      spinFrame=requestAnimationFrame(tick);
    });
  }
  {const stopFlight=flight.stop;flight.stop=()=>{stopSpin();stopFlight();};}
  controls.addEventListener('start',stopSpin);
  // The camera's heading around its target in degrees, for the kiosk browser test.
  if(isAtom)window.atomCameraYaw=()=>THREE.MathUtils.radToDeg(Math.atan2(camera.position.x-controls.target.x,camera.position.z-controls.target.z));
  if(isShowcase){scene.background.set('#e6ecee');renderKit.ground.material.color.set('#e6ecee');}
  if(isAtom){scene.background.set('#0b1219');renderKit.ground.material.color.set('#1b2631');}


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
    }
    model.updateWorldMatrix(true, true);
    for (const { root, materials } of cutMeshes) {
      const height = root.getWorldPosition(new THREE.Vector3()).y + 1.2;
      for (const material of materials) {
        material.clippingPlanes = cutaway ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), height)] : [];
        material.needsUpdate = true;
      }
    }
    // Read by the kiosk test: glass meshes whose own materials carry the cut plane.
    if(isAtom){let glass=0,clipped=0;model.traverse(o=>{if(o.isMesh&&o.userData.type==='glass'){glass++;if([].concat(o.material).every(m=>m.clippingPlanes?.length))clipped++;}});document.documentElement.dataset.glassClipped=`${clipped}/${glass}`;}
    const showExterior=exteriorEnabled&&currentFloor==='all'&&!exploded&&!cutaway;
    for(const object of presentationMeshes)object.visible=showExterior;
    for (const roof of roofs) roof.visible = showExterior||(currentFloor==='5'&&!cutaway&&!exploded&&roof.name.endsWith('service_roof_caps'));
    for(const device of deviceMeshes)device.visible=!cutaway;
    for(const ceiling of ceilings)ceiling.visible=!cutaway&&!exploded&&(currentFloor==='all'||ceiling.userData.ceilingScope==='stair'||['courtyard','arrival','reception'].includes(interiorView));
    exteriorButton.disabled=currentFloor!=='all'||exploded||cutaway;
    exteriorButton.setAttribute('aria-pressed',String(showExterior));
    renderKit.ground.visible=currentFloor==='all'||currentFloor==='1';
    if(parking)parking.lot.root.visible=renderKit.ground.visible;
    renderKit.setReflectionVisible(currentFloor==='1'&&!cutaway&&!exploded);
    renderer.shadowMap.needsUpdate=true;
    for (const button of floorButtons) button.setAttribute('aria-pressed', String(button.dataset.floor === currentFloor));
    explodeButton.disabled = currentFloor !== 'all';
    explodeButton.setAttribute('aria-pressed', String(exploded && currentFloor === 'all'));
    cutButton.setAttribute('aria-pressed', String(cutaway));
    document.querySelector('#view-label').textContent = labels[currentFloor];
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
    document.querySelector('#view-label').textContent=`ลิฟต์ · ${labels[currentFloor]}`;
  });
  function interiorCamera(kind){
    interiorView=kind;currentFloor=['office','stairs'].includes(kind)?'2':'1';exploded=false;cutaway=kind==='office';updateView();
    const root=floorRoots[Number(currentFloor)-1];
    const preset=root.userData.arrivalCameras?.[kind];
    const eye=preset?.eye||(kind==='services'?[-13,11,6]:kind==='parking'?[-25,15,25]:kind==='stairs'?[14.1,1.75,-4.85]:kind==='courtyard'?[16.7,2.05,3.2]:[3.7,5.5,17.5]);
    const target=preset?.target||(kind==='services'?[-4,.4,-4]:kind==='parking'?[-13.5,.3,3.5]:kind==='stairs'?[9.4,1.3,-4.85]:kind==='courtyard'?[23.5,1,-2.5]:[3.7,.6,6.6]);
    camera.fov=58;camera.position.copy(root.localToWorld(new THREE.Vector3(...eye)));
    controls.target.copy(root.localToWorld(new THREE.Vector3(...target)));controls.minDistance=.4;
    camera.updateProjectionMatrix();controls.update();simulation?.setView({currentFloor,cutaway,exploded});schedule();
    document.querySelector('#view-label').textContent={services:'ห้องบริการ · ชั้น 1',parking:`ที่จอดรถ · ${root.userData.parking?.count||6} คัน`,courtyard:'บ่อปลา · ชั้น 1',office:'สำนักงาน · ชั้น 2',arrival:'ลานวนรถ · ชั้น 1',reception:'ต้อนรับ · ชั้น 1',stairs:'บันได · ชั้น 2'}[kind];
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
  // A host page may frame the model in part of the screen ({x, y, w, h} in canvas px)
  // while the canvas still fills it: the camera's own frustum covers that rectangle.
  let viewFrame = null;
  function applyAspect() {
    const width = Math.max(viewport.clientWidth, 1), height = Math.max(viewport.clientHeight, 1);
    if (viewFrame) { camera.aspect = viewFrame.w / viewFrame.h; camera.setViewOffset(viewFrame.w, viewFrame.h, -viewFrame.x, -viewFrame.y, width, height); }
    else { camera.aspect = width / height; camera.clearViewOffset(); }
    camera.updateProjectionMatrix();
  }
  resizeObserver = new ResizeObserver(() => {
    const width = Math.max(viewport.clientWidth, 1), height = Math.max(viewport.clientHeight, 1);
    applyAspect();
    renderer.setSize(width, height, false);
    if (model && !isShowcase && Math.abs(lastAspect - camera.aspect) > 0.25) frameVisible();
    lastAspect = camera.aspect;
    schedule();
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
        if (cutTypes.has(object.userData.type)) {
          const clones = materials.map(material => {const m=material.clone();m.clipShadows=true;return m;});
          object.material = Array.isArray(object.material) ? clones : clones[0];
          clones.forEach(material => ownedMaterials.add(material));
          cutMeshes.push({ root, materials: clones });
        }
        if (object.userData.type === 'roof') roofs.push(object);
        if (object.userData.type === 'ceiling') ceilings.push(object);
        if(object.userData.type==='device')deviceMeshes.push(object);
      });
      scene.add(model);
      renderKit.addPondReflections(model);
      // The kiosk (an iGPU) keeps 4 room spot lights at night, 1 casting shadows.
      simulation=await createSimulation({THREE,scene,model,floorRoots,renderer,camera,schedule,...(isAtom?{spotLights:4,shadowSpots:1}:{spotLights:6,shadowSpots:1}),
        onSelectFloor(n){if(currentFloor!==String(n)){currentFloor=String(n);interiorView=null;updateView();}},
        onNightChange(night){
          // A host page may set a gradient day background (setBackground); night always uses a flat colour.
          if(!night&&dayBackground)scene.background=dayBackground;
          else{if(!scene.background?.isColor)scene.background=new THREE.Color();scene.background.set(night?'#182b3c':isAtom?'#0b1219':isShowcase?'#e6ecee':'#dce5e5');}
          // The kiosk's dark day ground turns the light showcase ground at night, so the building reads.
          if(isAtom){if(night){dayGround??=renderKit.ground.material.color.clone();renderKit.ground.material.color.set('#c9d2d8');}else if(dayGround){renderKit.ground.material.color.copy(dayGround);dayGround=null;}
            Object.assign(document.documentElement.dataset,{ground:'#'+renderKit.ground.material.color.getHexString(),sky:scene.background?.isColor?'#'+scene.background.getHexString():'gradient'});} // read by the kiosk test
          scene.environmentIntensity=night?.16:.65;
          hemisphere.intensity=night?.36:1.05;key.intensity=night?.24:3.2;key.color.set(night?0xb7d4ff:0xffe7ba);
          fill.intensity=night?.09:.6;renderer.toneMappingExposure=night?1.05:1;
          document.documentElement.dataset.night=String(night);renderer.shadowMap.needsUpdate=true;schedule();
        }
      });
      status.dataset.state = 'ready';
      status.textContent = L('โมเดลพร้อมแสดง','Model ready');
      for (const button of [...floorButtons, explodeButton, cutButton, resetButton, ...extraButtons]) button.disabled = false;
      updateView();
      if(isShowcase){
       securityPreview=createSecurityPreview({renderer,scene,schedule,fullVisibility:[...floorRoots,...presentationMeshes,...roofs,...ceilings]});
       const meetingRoom=simulation.rooms.find(r=>r.id==='f4_meeting_2'),meetingRoot=model.getObjectByName(`Floor_${meetingRoom.floor}`);
       const meetingTarget=meetingRoot.localToWorld(new THREE.Vector3(meetingRoom.center[0],.8,meetingRoom.center[2]));
       sceneTransition=createSceneTransition({model,schedule,onFinish:()=>{renderer.shadowMap.needsUpdate=true;}});
       const buildingBounds=new THREE.Box3().setFromObject(model),buildingCenter=buildingBounds.getCenter(new THREE.Vector3());
       let navigation=0,lastDestination='overview';
       const markerMaterial=new THREE.MeshBasicMaterial({color:'#27a8b3',transparent:true,opacity:.6,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
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
       parking=parkingModule.createParking({scene,schedule,capture:camera=>securityPreview.capture(camera),fly:(pose,ms=1600)=>{navigation++;return flight.flyPath([{to:pose,duration:ms,onUpdate(){schedule();}}]);}});
       parking.lot.root.visible=renderKit.ground.visible;
       if(new URLSearchParams(location.search).has('debug')){window.__parking=parking;window.__renderer=renderer;window.__scene=scene;window.__camera=camera;window.__controls=controls;}
       simulation.subscribe(()=>parking.setNight(simulation.getState().night));
       showcase=createShowcase({model,simulation,schedule,parking,
        cancelFlight:()=>{navigation++;flight.stop();marker.visible=false;schedule();},
        onUserOrbit:callback=>{controls.addEventListener('start',callback);canvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','r','R','+','=','-'].includes(e.key))callback();},{signal:abort.signal});},
        snapshot:securityCamera=>securityPreview.capture(securityCamera),
        async navigate(id,{instant=false,onPhase=()=>{}}={}){
          flight.stop();const ticket=++navigation,start=readPose();marker.visible=false;markerMaterial.opacity=.6;
          const settings={
            meeting:{eye:meetingTarget.clone().add(new THREE.Vector3(5,7,8)).toArray(),target:meetingTarget.toArray(),fov:43},
            pond:{eye:[33,14,13],target:[22.7,1,-2.5],fov:48},
            energy:{eye:[12,29,23],target:[-1.6,15.6,.8],fov:43},
            access:{eye:[-24,14,29],target:[-10.9,.8,10.5],fov:46},
            parking:parkingModule.PARKING_POSES.lot
          };
          const to=settings[id]||contextPose(),quick=instant||matchMedia('(prefers-reduced-motion: reduce)').matches;
          if(quick){sceneTransition.finish();applyDestination(id);writePose(to);lastDestination=id;return true;}
          const floors={overview:null,meeting:meetingRoom.floor,pond:1,energy:5,access:1,parking:'site'};
          const local=lastDestination!==id&&floors[id]===floors[lastDestination]&&settings[lastDestination]&&new THREE.Vector3(...settings[lastDestination].target).distanceTo(new THREE.Vector3(...to.target))<15;
          const same=id===lastDestination;
          const distance=new THREE.Vector3(...start.eye).distanceTo(new THREE.Vector3(...to.eye));
          if(same&&distance<.1)return true;
          const direction=new THREE.Vector3(...start.eye).sub(new THREE.Vector3(...start.target)).normalize();direction.y=Math.max(.35,direction.y);
          const retreat=local||same?{eye:new THREE.Vector3(...start.target).add(new THREE.Vector3(...start.eye).sub(new THREE.Vector3(...start.target)).multiplyScalar(1.3)).toArray(),target:start.target,fov:start.fov}:contextPose(direction);
          const orient=contextPose();
          const phases=[];
          if(!same&&lastDestination!=='overview')phases.push({to:retreat,duration:local?600:1050,
           onStart(){onPhase(L('ถอยออกจากจุดเดิม','Pulling back'));if(!local)sceneTransition.begin(()=>applyDestination('overview'));},
           onUpdate(t){if(!local)sceneTransition.progress(Math.max(0,(t-.25)/.75));},
           onEnd(){if(!local)sceneTransition.finish();}
          });
          if(!local&&!same)phases.push({to:orient,duration:lastDestination==='overview'?450:750,
           onStart(){onPhase(L('มองตำแหน่งบนอาคาร','Locating it on the building'));marker.position.set(to.target[0],id==='energy'?15.8:id==='meeting'?meetingTarget.y-.6:.2,to.target[2]);marker.visible=id!=='overview';},
           onUpdate(){schedule();}
          });
          phases.push({to,duration:local?1150:same?850:1450,
           onStart(){onPhase(L('กำลังเข้าใกล้จุดหมาย','Approaching'));sceneTransition.begin(()=>applyDestination(id));},
           onUpdate(t){sceneTransition.progress(Math.min(1,t/.75));markerMaterial.opacity=.6*(1-t);},
           onEnd(){sceneTransition.finish();}
          });
          const arrived=await flight.flyPath(phases);
          if(ticket===navigation){marker.visible=false;markerMaterial.opacity=.6;if(arrived)lastDestination=id;schedule();}
          return arrived;
        }
       });
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
       // Idle: 20 s with no input in free use, or 2.5 s into a building stop of the tour/loop. Never while
       // the camera is flying or the parking story is directing it.
       let lastInput=performance.now(),orbitFrame=0;
       const ORBIT_DEG_PER_S=3.5,IDLE_FREE_MS=20000,IDLE_TOUR_MS=2500;
       function stopOrbit(){if(orbitFrame)cancelAnimationFrame(orbitFrame);orbitFrame=0;}
       for(const type of ['pointerdown','wheel','keydown'])document.addEventListener(type,event=>{if(event.target.closest?.('#view-orbit'))return;lastInput=performance.now();stopOrbit();},{capture:true,signal:abort.signal});
       const orbitAllowed=()=>{const st=showcase.getState();if(!orbitEnabled||disposed||document.hidden||flight.running||st.traveling||parking?.story.running)return false;return performance.now()-lastInput>(st.touring?IDLE_TOUR_MS:IDLE_FREE_MS);};
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
      if(!isShowcase&&!isAtom){
       // The exploration page shows the car park too: lot, parked cars and traffic, without the showcase UI.
       const {createParkingScene}=await import('osd/parking/index.js');
       parking=createParkingScene({scene,schedule});
       parking.lot.root.visible=renderKit.ground.visible;
       simulation.subscribe(()=>parking.setNight(simulation.getState().night));
      }
      if(isAtom){
       // The ATOM page (React, web/) takes the scene API through window.atomBoot.
       const boot=typeof window.atomBoot==='function'?window.atomBoot:()=>{};
       const {createAtomScene}=await import('osd/viewer/atom-scene.js');
       sceneTransition=createSceneTransition({model,schedule,onFinish:()=>{renderer.shadowMap.needsUpdate=true;}});
       const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());
       let navigation=0;
       // A pose from `direction` that fits `box` in the current frame's aspect.
       function fitPose(box,direction,fov){
        const mid=box.getCenter(new THREE.Vector3()),right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize(),tan=Math.tan(THREE.MathUtils.degToRad(fov/2));let distance=1;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
         const v=new THREE.Vector3(x,y,z).sub(mid);distance=Math.max(distance,v.dot(direction)+Math.abs(v.dot(right))/(tan*camera.aspect),v.dot(direction)+Math.abs(v.dot(up))/tan);
        }
        return {eye:mid.clone().addScaledVector(direction,distance*1.08).toArray(),target:mid.toArray(),fov};
       }
       // Portrait (a tall canvas) only: a pose moved and scaled so `boxes` fill the frame as seen,
       // not their bounding distance (the site ground and the box corners otherwise leave the
       // building small in a wide upper frame). A few rounds of project, centre and scale.
       const portrait=()=>canvas.clientHeight>canvas.clientWidth;
       // A floor's box as it stands unlifted (the exploded view lifts floor i by i × 2.5 m), measured
       // now: the scene adds to the floors after boot (the car park's stalls, for one).
       // shown: only shown meshes count (the root itself may be hidden while another floor is in
       // view; hidden overlays are larger than the floor). A fitted floor (the camera view, the
       // vehicles tile) keeps the whole box, the one screenBox reports.
       function floorBox(i,shown=true){
        const root=floorRoots[i],box=new THREE.Box3();root.updateWorldMatrix(true,true);
        const walk=o=>{if(o!==root&&!o.visible)return;if((o.isMesh||o.isLine)&&o.geometry){o.geometry.computeBoundingBox();box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}for(const c of o.children)walk(c);};
        if(shown)walk(root);
        if(box.isEmpty())box.setFromObject(root);
        return box.translate(new THREE.Vector3(0,exploded&&currentFloor==='all'?-i*2.5:0,0));
       }
       const floorBoxes=()=>floorRoots.map((_,i)=>floorBox(i));
       function fillPose(pose,boxes,margin=.94){
        const view=new THREE.PerspectiveCamera(pose.fov,camera.aspect,.1,5000),eye=new THREE.Vector3(...pose.eye),target=new THREE.Vector3(...pose.target);
        const points=boxes.flatMap(b=>[b.min.x,b.max.x].flatMap(x=>[b.min.y,b.max.y].flatMap(y=>[b.min.z,b.max.z].map(z=>new THREE.Vector3(x,y,z)))));
        for(let round=0;round<4;round++){
         view.position.copy(eye);view.lookAt(target);view.updateMatrixWorld();
         let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
         for(const p of points){const v=p.clone().project(view);x0=Math.min(x0,v.x);x1=Math.max(x1,v.x);y0=Math.min(y0,v.y);y1=Math.max(y1,v.y);}
         const half=Math.tan(THREE.MathUtils.degToRad(pose.fov/2))*eye.distanceTo(target);
         const shift=new THREE.Vector3().setFromMatrixColumn(view.matrixWorld,0).multiplyScalar((x0+x1)/2*half*view.aspect)
          .add(new THREE.Vector3().setFromMatrixColumn(view.matrixWorld,1).multiplyScalar((y0+y1)/2*half));
         target.add(shift);eye.add(shift);
         eye.sub(target).multiplyScalar(Math.max((x1-x0)/2,(y1-y0)/2)/margin).add(target);
        }
        return {eye:eye.toArray(),target:target.toArray(),fov:pose.fov};
       }
       const overviewPose=()=>{const pose=fitPose(bounds,new THREE.Vector3(.72,.55,1.6).normalize(),38);return portrait()?fillPose(pose,floorBoxes()):pose;};
       const roomTarget=room=>floorRoots[room.floor-1].localToWorld(new THREE.Vector3(room.center[0],.8,room.center[2]));
       function roomPose(room){
        const target=roomTarget(room),reach=Math.max(1,(room.lightRadius||2.5)/2.5);
        const pose={eye:target.clone().add(new THREE.Vector3(6,9,10.5).multiplyScalar(reach)).toArray(),target:target.toArray(),fov:43};
        // Portrait: from the same side, the room's whole floor fills the upper frame (a close-up would run behind the panels).
        return portrait()?fillPose(pose,[floorBox(room.floor-1)]):pose;
       }
       // fit: the whole floor (and its site) inside the frame, from the same direction (the camera view).
       function floorPose(floor,fit=false){
        const box=new THREE.Box3().setFromObject(floorRoots[floor-1]),target=box.getCenter(new THREE.Vector3());
        if(fit||portrait()){const pose=fitPose(box,new THREE.Vector3(14,22,26).normalize(),40);return portrait()?fillPose(pose,[floorBox(floor-1,!fit)]):pose;}
        return {eye:target.clone().add(new THREE.Vector3(14,22,26)).toArray(),target:target.toArray(),fov:40};
       }
       // One camera route at a time; a newer request cancels the older one.
       async function flyTo({floor='all',cut=false,pose,explode=false}){
        const ticket=++navigation;flight.stop();sceneTransition.finish();
        const apply=()=>{currentFloor=String(floor);exploded=explode;cutaway=cut;interiorView=null;exteriorEnabled=true;cameraSide=false;updateView({reframe:false});if(cut)for(const device of deviceMeshes)device.visible=true;controls.minDistance=.4;controls.maxDistance=500;};
        const arrived=await flight.flyPath([{to:pose,duration:1400,
         onStart(){sceneTransition.begin(apply);},
         onUpdate(t){sceneTransition.progress(Math.min(1,t/.7));},
         onEnd(){sceneTransition.finish();}
        }]);
        return arrived&&ticket===navigation;
       }
       const deviceMap=await (await fetch("./model/device-map.json",{signal:abort.signal})).json();
       const parkingLayout=await fetch("./model/parking-layout.json",{signal:abort.signal}).then(r=>r.json(),()=>null).catch(()=>null);
       const atomScene=createAtomScene({scene,model,floorRoots,rooms:simulation.rooms,units:deviceMap.acUnits||[],stalls:parkingLayout?.stalls||[],schedule,setLitRooms:ids=>simulation.setLitRooms(ids)});
       // Exploded overview: floors lifted 2.5 m apart (see updateView), framed a little wider.
       const explodedPose=()=>{const pose=fitPose(bounds,new THREE.Vector3(.72,.55,1.6).normalize(),38),target=new THREE.Vector3(...pose.target).add(new THREE.Vector3(0,5,0)),eye=new THREE.Vector3(...pose.eye).sub(new THREE.Vector3(...pose.target)).multiplyScalar(1.22).add(target);return {eye:eye.toArray(),target:target.toArray(),fov:pose.fov};};
       // Portrait: the lifted floors (2.5 m apart, see updateView) fill the frame.
       const explodedFill=()=>portrait()?fillPose(explodedPose(),floorBoxes().map((b,i)=>b.clone().translate(new THREE.Vector3(0,i*2.5,0)))):explodedPose();
       // Relative camera move for gestures and adjust_view. Clamped so the camera never goes
       // under the floor and the target stays near the building.
       function adjustedPose({yaw=0,pitch=0,panX=0,panY=0,zoom=1}){
        const target=controls.target.clone(),offset=camera.position.clone().sub(target),s=new THREE.Spherical().setFromVector3(offset);
        s.theta-=THREE.MathUtils.degToRad(yaw);s.phi=THREE.MathUtils.clamp(s.phi-THREE.MathUtils.degToRad(pitch),.12,1.45);s.radius=THREE.MathUtils.clamp(s.radius/(zoom||1),2,200);
        const height=2*s.radius*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),width=height*camera.aspect;
        const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
        target.addScaledVector(right,panX*width).addScaledVector(up,panY*height);
        target.x=THREE.MathUtils.clamp(target.x,bounds.min.x-8,bounds.max.x+8);target.z=THREE.MathUtils.clamp(target.z,bounds.min.z-8,bounds.max.z+8);target.y=THREE.MathUtils.clamp(target.y,bounds.min.y-1,bounds.max.y+4);
        return {eye:target.clone().add(new THREE.Vector3().setFromSpherical(s)).toArray(),target:target.toArray(),fov:camera.fov};
       }
       // The koi pond on floor 1: its water meshes, their box (world, unlifted) and a teal glow and rim for the pond view.
       const pondMeshes=[];floorRoots[0]?.traverse(o=>{if(o.isMesh&&o.name.includes('_koi_pond_'))pondMeshes.push(o);});
       const pondBox=()=>{const box=new THREE.Box3();for(const mesh of pondMeshes)box.expandByObject(mesh);return box;};
       const pondHighlight=(()=>{let parts=null;return on=>{
        if(!pondMeshes.length)return;
        if(!parts)parts=pondMeshes.map(mesh=>{
         const material=mesh.material.clone(),opacity=material.opacity;mesh.material=material;
         const rim=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,30),new THREE.LineBasicMaterial({color:'#5ff2e2',transparent:true,opacity:.95}));
         rim.name='Koi_pond_highlight_rim';rim.userData.atomOverlay=true;rim.raycast=()=>{};rim.visible=false;mesh.add(rim);
         return {material,opacity,rim};
        });
        for(const {material,opacity,rim} of parts){material.emissive.set('#2fd8c8');material.emissiveIntensity=on?.85:0;material.opacity=on?Math.max(opacity,.62):opacity;rim.visible=Boolean(on);}
        document.documentElement.dataset.pondHighlight=String(Boolean(on));schedule();
       };})();
       // The pond view's pose: obliquely down at the pond, its courtyard around it in the frame.
       function pondPose(){
        const box=pondBox(),size=box.getSize(new THREE.Vector3()),target=box.getCenter(new THREE.Vector3());
        const pose={eye:target.clone().addScaledVector(new THREE.Vector3(10.3,13,15.5).normalize(),THREE.MathUtils.clamp(Math.max(size.x,size.z)*1.4,14,30)).toArray(),target:target.toArray(),fov:46};
        return portrait()?fillPose(pose,[box.clone().expandByScalar(2)]):pose;
       }
       boot({rooms:simulation.rooms,units:deviceMap.acUnits||[],scene:atomScene,
        overview:({explode=false}={})=>{return flyTo({pose:explode?explodedFill():overviewPose(),explode});},
        room:room=>{return flyTo({floor:room.floor,cut:room.floor<5,pose:roomPose(room)});},
        floor:(floor,{fit=false}={})=>{return floor==='all'?flyTo({pose:overviewPose()}):flyTo({floor,cut:Number(floor)<5,pose:floorPose(Number(floor),fit)});},
        // Floor 1 alone, real walls (no cut, so the water shows its reflection), looking down at the koi pond.
        pond:()=>pondMeshes.length?flyTo({floor:1,pose:pondPose()}):flyTo({floor:1,cut:true,pose:floorPose(1)}),
        setPondHighlight:pondHighlight,
        // The pond's centre in floor-1 coordinates, for its label (see project).
        pondAnchor:()=>{if(!pondMeshes.length)return null;const c=pondBox().getCenter(new THREE.Vector3());return {floor:1,point:floorRoots[0].worldToLocal(c).toArray()};},
        // Screen position of a floor-local point, or null when off screen or behind the camera.
        project(floor,[x,y,z]){
         const root=floorRoots[floor-1];if(!root||!root.visible)return null;
         const p=root.localToWorld(new THREE.Vector3(x,y,z)).project(camera);
         if(p.z>1||Math.abs(p.x)>1.05||Math.abs(p.y)>1.05)return null;
         return {x:(p.x+1)/2*canvas.clientWidth,y:(1-p.y)/2*canvas.clientHeight};
        },
        // Screen box (CSS px) of a floor's bounds, the box floor({fit}) fits to the frame.
        screenBox(floor){
         const box=new THREE.Box3().setFromObject(floorRoots[floor-1]),out={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
         for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          const p=new THREE.Vector3(x,y,z).project(camera),sx=(p.x+1)/2*canvas.clientWidth,sy=(1-p.y)/2*canvas.clientHeight;
          out.left=Math.min(out.left,sx);out.right=Math.max(out.right,sx);out.top=Math.min(out.top,sy);out.bottom=Math.max(out.bottom,sy);
         }
         return out;
        },
        // Frame the model inside a screen rectangle; before the first flight the overview is re-fitted to it.
        setFrame:rect=>{viewFrame=rect&&rect.w>0&&rect.h>0?{...rect}:null;applyAspect();if(!navigation)writePose(overviewPose());schedule();},
        onCamera:callback=>{controls.addEventListener('change',callback);new ResizeObserver(callback).observe(canvas);},
        orbit:({dx=0,dy=0,scale=1})=>{flight.stop();writePose(adjustedPose({yaw:-dx*180,pitch:dy*90,zoom:scale}));},
        // Map-like pan: the scene follows the hand, so the target moves the other way.
        pan:({dx=0,dy=0})=>{flight.stop();writePose(adjustedPose({panX:-dx,panY:dy}));},
        adjust:params=>{stopSpin();return flight.fly(adjustedPose(params),600);},
        spin,stopSpin,
        // Vertical gradient behind the model (and the ground tinted to match), for host pages.
        setBackground:(top,bottom)=>{
         const c=document.createElement('canvas');c.width=4;c.height=256;const g=c.getContext('2d'),grad=g.createLinearGradient(0,0,0,256);
         grad.addColorStop(0,top);grad.addColorStop(1,bottom);g.fillStyle=grad;g.fillRect(0,0,4,256);
         dayBackground=new THREE.CanvasTexture(c);dayBackground.colorSpace=THREE.SRGBColorSpace;
         if(!simulation.getState().night)scene.background=dayBackground;
         if(dayGround)dayGround.set(bottom);else renderKit.ground.material.color.set(bottom);schedule();
        },
        // Night show: dark sky and simulated room lights (existing simulation night mode).
        setNight:value=>{if(simulation.getState().night!==Boolean(value))simulation.setNight(Boolean(value));},
        // Roof panels glow with live output (0..1) in the solar view.
        setPanelGlow:(()=>{const panels=model.getObjectByName('Floor_5_solar_modules');let material=null;return k=>{if(!panels)return;if(!material){material=panels.material.clone();panels.material=material;}material.emissive.set('#ffb02e');material.emissiveIntensity=1.4*k;schedule();};})(),
       });
       writePose(overviewPose());
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
