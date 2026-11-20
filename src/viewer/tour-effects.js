import * as T from 'osd/node_modules/three/build/three.module.js';
// Presentation-only objects. No bindings to hardware or Home Assistant.
export function createTourEffects({model,schedule,meetingRoom}){
 const groups={},owned=[],materials=[];let current='overview';
 const root=n=>model.getObjectByName(`Floor_${n}`);
 const group=(id,n)=>{const g=new T.Group();g.name=`Demo_${id}`;g.userData={simulation:true};root(n).add(g);groups[id]=g;return g;};
 const mat=(color,opacity=1)=>{const m=new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1,side:T.DoubleSide});materials.push(m);return m;};
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
 const pond=group('pond',1),pondMaterial=mat('#1b9caa',.8),pondRing=mesh(pond,new T.TorusGeometry(.23,.028,8,36),pondMaterial,[23.2,.32,0]);pondRing.rotation.x=-Math.PI/2;
 mesh(pond,new T.CylinderGeometry(.045,.045,.45,12),mat('#3f6975'),[23.2,.3,0]);
 const energy=group('energy',5),energyMaterial=mat('#21a790',.75);
 const path=new T.BufferGeometry().setFromPoints([new T.Vector3(-1.4,.16,-5.9),new T.Vector3(-1.4,.16,6.1),new T.Vector3(4,.16,6.1)]);owned.push(path);const lm=new T.LineDashedMaterial({color:'#239b87',dashSize:.22,gapSize:.18});materials.push(lm);const flow=new T.Line(path,lm);flow.computeLineDistances();energy.add(flow);
 const packet=mesh(energy,new T.SphereGeometry(.09,10,8),energyMaterial,[-1.4,.2,1]);
 const access=group('access',1),body=mat('#4b5d6b'),white=mat('#fffdf5'),red=mat('#e37753');
 // Parking aisle: x -13.9 .. -7.9; south site edge z 15.96644.
 // One shared boom spans both arrow-marked directions, just inside that edge.
 const gateX=-13.65,gateZ=15.7,boomLength=5.45,cameraX=-8.1,cameraZ=15.6;
 mesh(access,new T.BoxGeometry(.42,1.18,.45),body,[gateX,.59,gateZ]);
 const boom=new T.Group();boom.position.set(gateX,1.12,gateZ);boom.name='Demo_barrier_arm';access.add(boom);
 mesh(boom,new T.BoxGeometry(boomLength,.12,.14),white,[boomLength/2,0,0]);for(let i=0;i<8;i++)mesh(boom,new T.BoxGeometry(.20,.125,.145),red,[.4+i*.65,0,0]);
 // Optical axis and the physical housing share one transform: local -Z looks into the aisle.
 const cameraHeight=1.6,head=new T.Group();head.name='Demo_security_camera_mount';head.position.set(cameraX,cameraHeight,cameraZ);access.add(head);
 const aim=new T.Vector3(-10.9,.7,8).sub(head.position).normalize();head.quaternion.setFromUnitVectors(new T.Vector3(0,0,-1),aim);
 mesh(head,new T.BoxGeometry(.28,.19,.42),body,[0,0,0]);
 mesh(access,new T.CylinderGeometry(.055,.055,cameraHeight,10),body,[cameraX,cameraHeight/2,cameraZ]);
 const lens=mesh(head,new T.CylinderGeometry(.055,.055,.05,12),mat('#2a3544'),[0,0,-.235]);lens.rotation.x=Math.PI/2;
 const securityCamera=new T.PerspectiveCamera(68,16/9,.05,160);securityCamera.name='Demo_security_camera';securityCamera.position.z=-.27;head.add(securityCamera);

 function select(id){current=id;for(const [name,g] of Object.entries(groups))g.visible=name===id;schedule();}
 function update(state){people.forEach(o=>o.visible=state.occupied);air.forEach(o=>o.visible=state.climate);pondMaterial.color.set(state.pondAlert?'#d58c26':'#1b9caa');boom.rotation.z=state.barrierAngle||0;packet.visible=state.solar>0;energyMaterial.opacity=state.solar>5?.8:.35;schedule();}
 function animate(t){if(current==='meeting')air.forEach((o,i)=>{o.material.dashSize=.12+.035*Math.sin(t*2+i);});if(current==='energy'){packet.position.z=-5.9+((t*.9)%12);packet.position.x=-1.4;}schedule();}
 select('overview');return {securityCamera,select,update,animate,dispose(){for(const g of Object.values(groups))g.removeFromParent();for(const g of owned)g.dispose();for(const m of materials)m.dispose();}};
}
