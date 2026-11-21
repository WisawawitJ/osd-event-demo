import * as THREE from 'osd/node_modules/three/build/three.module.js';

// Blend only geometry whose visibility or wall cut changes (no stop changes a material's opacity). No animation loop here:
// the camera route owns timing, cancellation and hidden-tab behavior.
// Geometry that appears or disappears is swept by a level cut, not faded: what leaves is sliced away from the top down
// and what arrives builds up from the bottom, solid all along. Fading it made the building see-through mid-way (every
// floor's inside showing through the others, and transparent surfaces drawn in the wrong order).
export function createSceneTransition({model,schedule,onFinish=()=>{}}) {
 let originals=new Map(),entries=[],sweeps=[],targetVisibility=new Map();
 // The copies of the materials a change cuts are kept from one change to the next (refreshed from the original each
 // time): three.js sets up a new material's shader on its first draw, and the few hundred fresh copies a floor change
 // made each time took a ~30 ms frame in the middle of the flight. One copy per material and cut (leaving, arriving or
 // none), as objects that share a material may be on either side.
 const copies=new Map(),planeCount=new WeakMap();
 function copyOf(base,kind,planes){
  let byKind=copies.get(base);if(!byKind)copies.set(base,byKind={});
  let m=byKind[kind];if(m)m.copy(base);else m=byKind[kind]=base.clone();
  m.clippingPlanes=planes;if(planeCount.get(m)!==planes.length){planeCount.set(m,planes.length);m.needsUpdate=true;}
  return m;
 }
 const effective=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
 function capture(){
  const nodes=new Map(),drawables=new Map();model.updateWorldMatrix(true,true);
  model.traverse(o=>{
   nodes.set(o,o.visible);
   if(o.material)drawables.set(o,{visible:effective(o),materials:[].concat(o.material).map(m=>({planes:(m.clippingPlanes||[]).map(p=>p.clone())}))});
  });return {nodes,drawables};
 }
 function restoreMaterials(){for(const [o,m] of originals)o.material=m;originals.clear();entries=[];sweeps=[];}
 function begin(apply){
  const from=capture();restoreMaterials();
  for(const [o,visible] of targetVisibility)o.visible=visible;targetVisibility.clear();
  apply();const to=capture();targetVisibility=to.nodes;
  // Flatten parent visibility for the bounded blend, preserving effective mesh visibility.
  model.traverse(o=>{if(!o.material&&!o.isLight)o.visible=true;});
  // Keeps what lies below the cut (y <= constant); one cut for everything leaving, one for everything arriving.
  const leaving={plane:new THREE.Plane(new THREE.Vector3(0,-1,0),0),box:new THREE.Box3()},arriving={plane:new THREE.Plane(new THREE.Vector3(0,-1,0),0),box:new THREE.Box3()};
  sweeps=[leaving,arriving];
  for(const [o,end] of to.drawables){
   const start=from.drawables.get(o)||end;
   o.visible=start.visible||end.visible;
   const changed=start.visible!==end.visible||start.materials.some((m,i)=>JSON.stringify(m.planes)!==JSON.stringify(end.materials[i].planes));
   if(!o.visible||!changed)continue;
   originals.set(o,o.material);
   const box=new THREE.Box3().setFromObject(o),high=box.max.y+1,sweep=start.visible===end.visible?null:start.visible?leaving:arriving,kind=!sweep?'none':sweep===leaving?'leaving':'arriving';
   sweep?.box.union(box);
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
  // Leaving: the cut runs from just above the top of what leaves to just below its bottom; arriving, the other way.
  for(const sweep of sweeps){if(sweep.box.isEmpty()){sweep.box.set(new THREE.Vector3(),new THREE.Vector3());}const top=sweep.box.max.y+.05,bottom=sweep.box.min.y-.05;[sweep.from,sweep.to]=sweep===leaving?[top,bottom]:[bottom,top];}
  progress(0);
 }
 // Makes the copies a floor change uses ahead of time and lends them to `use`, one kind at a time (every mesh showing
 // its copy), so the loading screen sets their shaders up instead of the first flight to each stop.
 async function prepare(use){
  const cut=new THREE.Plane(new THREE.Vector3(0,-1,0),1e4),meshes=[];
  model.traverse(o=>{if(o.material)meshes.push([o,o.material]);});
  for(const kind of ['leaving','arriving','none']){
   for(const [o,material] of meshes){
    const list=[].concat(material).map(base=>{const own=(base.clippingPlanes||[]).map(p=>p.clone());return kind==='none'&&!own.length?base:copyOf(base,kind,kind==='none'?own:[...own,cut]);});
    o.material=Array.isArray(material)?list:list[0];
   }
   try{await use();}finally{for(const [o,material] of meshes)o.material=material;}
  }
 }
 function progress(t){const p=Math.max(0,Math.min(1,t)),e=p*p*(3-2*p);for(const planes of entries){for(const plane of planes){plane.current.normal.lerpVectors(plane.from.normal,plane.to.normal,e).normalize();plane.current.constant=THREE.MathUtils.lerp(plane.from.constant,plane.to.constant,e);}}for(const sweep of sweeps)sweep.plane.constant=THREE.MathUtils.lerp(sweep.from,sweep.to,e);schedule();}
 // `settled: false` when another change follows at once (mid-flight): no onFinish (it redraws the sun's shadows).
 function finish({settled=true}={}){restoreMaterials();for(const [o,visible] of targetVisibility)o.visible=visible;targetVisibility.clear();if(settled)onFinish();schedule();}
 return {begin,progress,finish,prepare,dispose(){finish();for(const byKind of copies.values())for(const m of Object.values(byKind))m.dispose();copies.clear();}};
}
