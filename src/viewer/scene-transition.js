import * as THREE from 'osd/node_modules/three/build/three.module.js';

// Blend only geometry whose visibility or wall cut changes (no stop changes a material's opacity). No animation loop here:
// the camera route owns timing, cancellation and hidden-tab behavior.
// Geometry that appears or disappears is swept by a level cut, not faded, solid all along (fading made the building
// see-through mid-way, every floor's inside showing through the others). Both cuts run from the top down: what leaves
// is sliced away from its top, and what arrives appears from its top, so the slab just above a ground-floor view comes
// last, once the camera has pulled out (built from the bottom, it covered the whole view as the flight set off).
// A change that starts while another is under way (a stop picked mid-flight) starts from what is on screen: what was
// arriving counts as shown once its cut has passed its middle, what was leaving until then.
export function createSceneTransition({model,schedule,onFinish=()=>{},onProgress=()=>{}}) {
 let originals=new Map(),entries=[],sweeps=[],swept=new Map(),targetVisibility=new Map();
 // The copies of the materials a change cuts are kept from one change to the next (refreshed from the original each
 // time): three.js sets up a new material's shader on its first draw, and the few hundred fresh copies a floor change
 // made each time took a ~30 ms frame in the middle of the flight. One copy per material and cut (leaving, arriving or
 // none), as objects that share a material may be on either side.
 const copies=new Map(),planeCount=new WeakMap();
 function copyOf(base,kind,planes){
  let byKind=copies.get(base);if(!byKind)copies.set(base,byKind={});
  let m=byKind[kind];if(m)m.copy(base);else m=byKind[kind]=base.clone();
  m.clipShadows=true; // shadows follow the cut (drawn without it, the whole building's shadow fell at once)
  // A shader material's copy shares the original's uniforms: copying them drops a render target's texture (the pond's
  // reflection went black mid-flight) and would freeze values the app keeps changing (the reflection's mix).
  if(base.isShaderMaterial)m.uniforms=base.uniforms;
  m.clippingPlanes=planes;if(planeCount.get(m)!==planes.length){planeCount.set(m,planes.length);m.needsUpdate=true;}
  return m;
 }
 const effective=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
 // A stop's presentation effects (tour-effects.js, userData.simulation) fade themselves in and out as the camera
 // arrives and leaves: the change leaves them alone (drawn through its copies, their fade did not show, and the
 // meeting room's light cone popped up when the change ended).
 const effect=o=>{for(let p=o;p&&p!==model;p=p.parent)if(p.userData?.simulation)return true;return false;};
 // What is on screen: mid-change, an object being swept counts as shown while its cut keeps its middle, and its
 // materials' own planes are read without the sweep's.
 function capture(){
  const nodes=new Map(),drawables=new Map(),cuts=new Set(sweeps.map(s=>s.plane));model.updateWorldMatrix(true,true);
  model.traverse(o=>{
   if(effect(o))return;
   nodes.set(o,o.visible);
   const sweep=swept.get(o);
   if(o.material)drawables.set(o,{visible:sweep?sweep.plane.normal.y*sweep.middle+sweep.plane.constant>=0:effective(o),materials:[].concat(o.material).map(m=>({planes:(m.clippingPlanes||[]).filter(p=>!cuts.has(p)).map(p=>p.clone())}))});
  });return {nodes,drawables};
 }
 function restoreMaterials(){for(const [o,m] of originals)o.material=m;originals.clear();entries=[];sweeps=[];swept.clear();}
 function begin(apply){
  const from=capture();restoreMaterials();
  for(const [o,visible] of targetVisibility)o.visible=visible;targetVisibility.clear();
  apply();const to=capture();targetVisibility=to.nodes;
  // Flatten parent visibility for the bounded blend, preserving effective mesh visibility.
  model.traverse(o=>{if(!o.material&&!o.isLight&&!effect(o))o.visible=true;});
  // One cut for everything leaving (keeps what lies below it) and one for everything arriving (keeps what lies above).
  const leaving={plane:new THREE.Plane(new THREE.Vector3(0,-1,0),0),box:new THREE.Box3()},arriving={plane:new THREE.Plane(new THREE.Vector3(0,1,0),0),box:new THREE.Box3()};
  sweeps=[leaving,arriving];
  for(const [o,end] of to.drawables){
   const start=from.drawables.get(o)||end;
   o.visible=start.visible||end.visible;
   const changed=start.visible!==end.visible||start.materials.some((m,i)=>JSON.stringify(m.planes)!==JSON.stringify(end.materials[i].planes));
   if(!o.visible||!changed)continue;
   originals.set(o,o.material);
   const box=new THREE.Box3().setFromObject(o),high=box.max.y+1,sweep=start.visible===end.visible?null:start.visible?leaving:arriving,kind=!sweep?'none':sweep===leaving?'leaving':'arriving';
   if(sweep){sweep.box.union(box);swept.set(o,{plane:sweep.plane,middle:(box.min.y+box.max.y)/2});}
   const clones=[].concat(o.material).map((base,i)=>{
    const a=start.materials[i],b=end.materials[i];
    const count=Math.max(a.planes.length,b.planes.length),planes=[];
    for(let j=0;j<count;j++){
     const pa=a.planes[j]||new THREE.Plane(new THREE.Vector3(0,-1,0),high),pb=b.planes[j]||new THREE.Plane(new THREE.Vector3(0,-1,0),high);
     planes.push({from:pa,to:pb,current:pa.clone()});
    }
    const m=copyOf(base,kind,[...planes.map(p=>p.current),...(sweep?[sweep.plane]:[])]);
    entries.push(planes);return m;
   });o.material=Array.isArray(o.material)?clones:clones[0];
  }
  // Both cuts run from just above the top of what they sweep to just below its bottom (plane constants: y <= c leaving,
  // y >= c arriving).
  for(const sweep of sweeps){if(sweep.box.isEmpty()){sweep.box.set(new THREE.Vector3(),new THREE.Vector3());}const top=sweep.box.max.y+.05,bottom=sweep.box.min.y-.05;[sweep.from,sweep.to]=sweep===leaving?[top,bottom]:[-top,-bottom];}
  progress(0);
 }
 // Makes the copies a floor change uses ahead of time and lends them to `use`, one kind at a time (every mesh showing
 // its copy), so the loading screen sets their shaders up instead of the first flight to each stop.
 async function prepare(use){
  const cut=new THREE.Plane(new THREE.Vector3(0,-1,0),1e4),meshes=[];
  model.traverse(o=>{if(o.material&&!effect(o))meshes.push([o,o.material]);});
  for(const kind of ['leaving','arriving','none']){
   for(const [o,material] of meshes){
    const list=[].concat(material).map(base=>{const own=(base.clippingPlanes||[]).map(p=>p.clone());return kind==='none'&&!own.length?base:copyOf(base,kind,kind==='none'?own:[...own,cut]);});
    o.material=Array.isArray(material)?list:list[0];
   }
   try{await use();}finally{for(const [o,material] of meshes)o.material=material;}
  }
 }
 function progress(t){const p=Math.max(0,Math.min(1,t)),e=p*p*(3-2*p);for(const planes of entries){for(const plane of planes){plane.current.normal.lerpVectors(plane.from.normal,plane.to.normal,e).normalize();plane.current.constant=THREE.MathUtils.lerp(plane.from.constant,plane.to.constant,e);}}for(const sweep of sweeps)sweep.plane.constant=THREE.MathUtils.lerp(sweep.from,sweep.to,e);onProgress();schedule();}
 // `settled: false` when another change follows at once (mid-flight): no onFinish (it redraws the sun's shadows).
 function finish({settled=true}={}){restoreMaterials();for(const [o,visible] of targetVisibility)o.visible=visible;targetVisibility.clear();if(settled)onFinish();schedule();}
 return {begin,progress,finish,prepare,dispose(){finish();for(const byKind of copies.values())for(const m of Object.values(byKind))m.dispose();copies.clear();}};
}
