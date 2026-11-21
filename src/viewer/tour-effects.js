import * as T from 'osd/node_modules/three/build/three.module.js';
import {demoNow} from 'osd/parking/clock.js';
// Presentation-only objects. No bindings to hardware or Home Assistant.
export function createTourEffects({model,schedule,meetingRoom,ownBarrier=true}){
 const groups={},owned=[],materials=[];let current='overview';
 const root=n=>model.getObjectByName(`Floor_${n}`);
 const group=(id,n)=>{const g=new T.Group();g.name=`Demo_${id}`;g.userData={simulation:true};root(n).add(g);groups[id]=g;return g;};
 const mat=(color,opacity=1)=>{const m=new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1,side:T.DoubleSide,forceSinglePass:true});materials.push(m);return m;};
 const mesh=(g,geometry,material,position)=>{const o=new T.Mesh(geometry,material);if(position)o.position.set(...position);g.add(o);owned.push(geometry);return o;};
 const meeting=group('meeting',meetingRoom.floor),teal=mat('#299c94',.85),room=[meetingRoom.center[0],meetingRoom.center[2]];
 const people=[];
 for(let i=0;i<6;i++){const x=room[0]+(i<3?-1.1:1.1),z=room[1]+(i%3-1)*.8;const dot=mesh(meeting,new T.RingGeometry(.11,.16,28),teal,[x,.12,z]);dot.rotation.x=-Math.PI/2;people.push(dot);}
 // Air from the room's own AC unit (a two-way ceiling cassette, FCU 4-3 here): dashed curves leave both long
 // slots and fall outward. The unit is found in the model, so the air starts where the AC actually is.
 const air=[];
 {
  const floorRoot=root(meetingRoom.floor);let unit=null;
  floorRoot.traverse(o=>{if(!unit&&o.userData.deviceKind==='climate'&&o.userData.roomId===meetingRoom.id&&!o.name.includes('_led_'))unit=o;});
  const box=unit?new T.Box3().setFromObject(unit):null;
  if(box){floorRoot.worldToLocal(box.min);floorRoot.worldToLocal(box.max);}
  const center=box?box.getCenter(new T.Vector3()):new T.Vector3(room[0]+.92,2.65,room[1]),size=box?box.getSize(new T.Vector3()):new T.Vector3(.9,.2,.9);
  // Slots run along the unit's long side; air leaves across it, on both sides.
  const across=size.x<size.z?new T.Vector3(1,0,0):new T.Vector3(0,0,1),along=across.x?new T.Vector3(0,0,1):new T.Vector3(1,0,0);
  const half=(across.x?size.x:size.z)/2,length=Math.max(.5,(along.x?size.x:size.z)*.7),top=box?box.min.y:center.y-.05;
  for(const side of [-1,1])for(let i=0;i<3;i++){
   const offset=along.clone().multiplyScalar((i-1)*length/2),out=across.clone().multiplyScalar(side);
   const start=center.clone().add(offset).addScaledVector(out,half);start.y=top;
   const points=[start,start.clone().addScaledVector(out,.45).setY(top-.45),start.clone().addScaledVector(out,.95).setY(top-1.05)];
   const geom=new T.BufferGeometry().setFromPoints(new T.QuadraticBezierCurve3(...points).getPoints(24));owned.push(geom);
   const m=new T.LineDashedMaterial({color:'#4eabc5',dashSize:.14,gapSize:.12,transparent:true,opacity:.6});materials.push(m);
   const line=new T.Line(geom,m);line.computeLineDistances();meeting.add(line);air.push(line);
  }
 }
 // The room light, visible by day too: a soft downlight cone and a warm pool on the floor while it is on.
 const lamp=[];
 {
  const glow=document.createElement('canvas');glow.width=glow.height=128;
  const c=glow.getContext('2d'),g=c.createRadialGradient(64,64,4,64,64,64);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.55,'rgba(255,255,255,.45)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(0,0,128,128);
  const glowMap=new T.CanvasTexture(glow);
  const [lx,ly,lz]=meetingRoom.lightPosition||[room[0],2.65,room[1]];
  const poolMaterial=new T.MeshBasicMaterial({color:'#ffcf73',map:glowMap,transparent:true,opacity:.75,depthWrite:false,blending:T.AdditiveBlending});materials.push(poolMaterial);
  poolMaterial.userData.glowMap=glowMap;
  const pool=mesh(meeting,new T.CircleGeometry(1.9,40),poolMaterial,[lx,.06,lz]);pool.rotation.x=-Math.PI/2;lamp.push(pool);
  const fade=document.createElement('canvas');fade.width=4;fade.height=64;
  const f=fade.getContext('2d'),v=f.createLinearGradient(0,0,0,64);v.addColorStop(0,'#fff');v.addColorStop(1,'#000');f.fillStyle=v;f.fillRect(0,0,4,64);
  const fadeMap=new T.CanvasTexture(fade);
  const beamMaterial=new T.MeshBasicMaterial({color:'#ffd88a',alphaMap:fadeMap,transparent:true,opacity:.22,depthWrite:false,side:T.DoubleSide,forceSinglePass:true,blending:T.AdditiveBlending});materials.push(beamMaterial);
  beamMaterial.userData.glowMap=fadeMap;
  const beam=mesh(meeting,new T.CylinderGeometry(.45,1.7,ly-.1,32,1,true),beamMaterial,[lx,(ly-.1)/2+.05,lz]);lamp.push(beam);
 }
 const pond=group('pond',1),pondMaterial=mat('#1b9caa',.8),pondRing=mesh(pond,new T.TorusGeometry(.23,.028,8,36),pondMaterial,[23.2,.32,0]);pondRing.rotation.x=-Math.PI/2;
 mesh(pond,new T.CylinderGeometry(.045,.045,.45,12),mat('#3f6975'),[23.2,.3,0]);
 const energy=group('energy',5),energyMaterial=mat('#21a790',.75);
 const path=new T.BufferGeometry().setFromPoints([new T.Vector3(-1.4,.16,-5.9),new T.Vector3(-1.4,.16,6.1),new T.Vector3(4,.16,6.1)]);owned.push(path);const lm=new T.LineDashedMaterial({color:'#239b87',dashSize:.22,gapSize:.18});materials.push(lm);const flow=new T.Line(path,lm);flow.computeLineDistances();energy.add(flow);
 const packet=mesh(energy,new T.SphereGeometry(.09,10,8),energyMaterial,[-1.4,.2,1]);
 const access=group('access',1),body=mat('#4b5d6b'),white=mat('#fffdf5'),red=mat('#e37753');
 // The original demo's barrier and camera at the P1 aisle mouth. With the car park's main gate present
 // (src/parking) there is one gate only: this one is not built, and the Entrance stop uses the main gate.
 let boom=null,securityCamera=null;
 if(ownBarrier){
  // Parking aisle: x -13.9 .. -7.9; south site edge z 15.96644.
  // One shared boom spans both arrow-marked directions, just inside that edge.
  const gateX=-13.65,gateZ=15.7,boomLength=5.45,cameraX=-8.1,cameraZ=15.6;
  mesh(access,new T.BoxGeometry(.42,1.18,.45),body,[gateX,.59,gateZ]);
  boom=new T.Group();boom.position.set(gateX,1.12,gateZ);boom.name='Demo_barrier_arm';access.add(boom);
  mesh(boom,new T.BoxGeometry(boomLength,.12,.14),white,[boomLength/2,0,0]);for(let i=0;i<8;i++)mesh(boom,new T.BoxGeometry(.20,.125,.145),red,[.4+i*.65,0,0]);
  // Optical axis and the physical housing share one transform: local -Z looks into the aisle.
  const cameraHeight=1.6,head=new T.Group();head.name='Demo_security_camera_mount';head.position.set(cameraX,cameraHeight,cameraZ);access.add(head);
  const aim=new T.Vector3(-10.9,.7,8).sub(head.position).normalize();head.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),aim);
  mesh(head,new T.BoxGeometry(.28,.19,.42),body,[0,0,0]);
  mesh(access,new T.CylinderGeometry(.055,.055,cameraHeight,10),body,[cameraX,cameraHeight/2,cameraZ]);
  const lens=mesh(head,new T.CylinderGeometry(.055,.055,.05,12),mat('#2a3544'),[0,0,-.235]);lens.rotation.x=Math.PI/2;
  securityCamera=new T.PerspectiveCamera(68,16/9,.05,160);securityCamera.name='Demo_security_camera';securityCamera.position.z=-.27;head.add(securityCamera);
 }

 // Each stop's effects fade in as the camera arrives and out as it leaves (~0.45 s), like the room's own light: switched
 // on in one frame, the meeting room's light cone and pool popped up while the room light came on smoothly. A
 // material's opacity is what its effect wants (the lamp's and the air's own fades, the solar flow's strength) times
 // its stop's level.
 // Every effect material is drawn as transparent from the start (an opaque one turned transparent for a fade would
 // need another shader, built on the spot).
 const level={},goal={},own=new Map(),stopOf=new Map();
 for(const [id,g] of Object.entries(groups)){level[id]=goal[id]=0;g.traverse(o=>{for(const m of [].concat(o.material||[])){stopOf.set(m,id);own.set(m,m.opacity);m.transparent=true;}});}
 function paint(){
  for(const [m,opacity] of own)m.opacity=opacity*level[stopOf.get(m)];
  for(const [id,g] of Object.entries(groups))g.visible=level[id]>.001;
  schedule();
 }
 let stopFrame=0;
 function fadeStops(instant=false){
  cancelAnimationFrame(stopFrame);stopFrame=0;
  if(instant){for(const id of Object.keys(groups))level[id]=goal[id];paint();return;}
  let last=performance.now();
  const step=time=>{const d=Math.max(0,time-last)/450;last=time;let moving=false;
   for(const id of Object.keys(groups)){const g=goal[id];level[id]=g>level[id]?Math.min(g,level[id]+d):Math.max(g,level[id]-d);if(level[id]!==g)moving=true;}
   paint();stopFrame=moving?requestAnimationFrame(step):0;};
  stopFrame=requestAnimationFrame(step);
 }

 // The AC's air: fades in and out with the switch, and while it is on the dashes flow down from the unit.
 let airLevel=1,airTarget=1,airFrame=0,airLast=0;
 const airBase=air.map(o=>o.material.opacity);
 for(const line of air)line.userData.distances=Float32Array.from(line.geometry.attributes.lineDistance.array);
 const setAir=()=>{air.forEach((o,i)=>{o.visible=airLevel>.001;own.set(o.material,airBase[i]*airLevel);});paint();};
 function airStep(time){
  airFrame=0;const dt=Math.min(.1,(time-(airLast||time))/1000);airLast=time;
  airLevel=airTarget>airLevel?Math.min(airTarget,airLevel+dt/.35):Math.max(airTarget,airLevel-dt/.35);
  const shift=(demoNow()/1000*.35)%.26; // demo time: the air stands still while paused
  for(const o of air){const d=o.geometry.attributes.lineDistance,base=o.userData.distances;for(let j=0;j<base.length;j++)d.array[j]=base[j]-shift;d.needsUpdate=true;}
  setAir();
  if(current==='meeting'&&(airLevel>0||airTarget>0)&&!document.hidden)airFrame=requestAnimationFrame(airStep);else airLast=0;
 }
 function fadeAir(on){airTarget=on?1:0;if(!airFrame&&current==='meeting')airFrame=requestAnimationFrame(airStep);if(current!=='meeting'){airLevel=airTarget;setAir();}}
 // The room light's pool and beam fade in and out (~0.35 s) instead of snapping.
 let lampLevel=1,lampTarget=1,lampFrame=0;
 const lampBase=lamp.map(o=>o.material.opacity);
 function drawLamp(){lamp.forEach((o,i)=>{own.set(o.material,lampBase[i]*lampLevel);o.visible=lampLevel>.001;});paint();}
 function fadeLamp(on){
  lampTarget=on?1:0;if(lampFrame||lampLevel===lampTarget)return;
  let last=performance.now();
  const step=time=>{lampLevel=lampTarget>lampLevel?Math.min(lampTarget,lampLevel+(time-last)/350):Math.max(lampTarget,lampLevel-(time-last)/350);last=time;drawLamp();lampFrame=lampLevel===lampTarget?0:requestAnimationFrame(step);};
  lampFrame=requestAnimationFrame(step);
 }
 let started=false;
 function select(id){current=id;if(id==='meeting'&&!airFrame&&airTarget>0)airFrame=requestAnimationFrame(airStep);for(const name of Object.keys(groups))goal[name]=name===id?1:0;fadeStops(!started);started=true;}
 function update(state){people.forEach(o=>o.visible=state.occupied);fadeLamp(state.light!==false);fadeAir(state.climate);pondMaterial.color.set(state.pondAlert?'#d58c26':'#1b9caa');if(boom)boom.rotation.z=state.barrierAngle||0;packet.visible=state.solar>0;own.set(energyMaterial,state.solar>5?.8:.35);paint();}
 function animate(t){if(current==='meeting')air.forEach((o,i)=>{o.material.dashSize=.12+.035*Math.sin(t*2+i);});if(current==='energy'){packet.position.z=-5.9+((t*.9)%12);packet.position.x=-1.4;}schedule();}
 select('overview');return {securityCamera,select,update,animate,dispose(){cancelAnimationFrame(lampFrame);cancelAnimationFrame(airFrame);cancelAnimationFrame(stopFrame);for(const g of Object.values(groups))g.removeFromParent();for(const g of owned)g.dispose();for(const m of materials){m.userData.glowMap?.dispose();m.dispose();}}};
}
