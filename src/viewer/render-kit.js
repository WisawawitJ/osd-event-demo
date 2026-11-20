import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {Reflector} from 'osd/node_modules/three/examples/jsm/objects/Reflector.js';

// Locally generated studio sky: no remote HDRI/texture dependencies.
export function createRenderKit(renderer, scene) {
 const sky=document.createElement('canvas');sky.width=512;sky.height=256;
 const c=sky.getContext('2d');const grad=c.createLinearGradient(0,0,0,256);
 grad.addColorStop(0,'#779eae');grad.addColorStop(.42,'#dae4e4');grad.addColorStop(.52,'#fff8e6');grad.addColorStop(.57,'#b9b9a7');grad.addColorStop(1,'#666f67');
 c.fillStyle=grad;c.fillRect(0,0,512,256);
 const sun=c.createRadialGradient(360,82,2,360,82,56);sun.addColorStop(0,'#ffffff');sun.addColorStop(.3,'#fffbe9');sun.addColorStop(1,'#fffbe900');c.fillStyle=sun;c.fillRect(300,20,120,124);
 const skyTexture=new THREE.CanvasTexture(sky);skyTexture.mapping=THREE.EquirectangularReflectionMapping;skyTexture.colorSpace=THREE.SRGBColorSpace;
 const pmrem=new THREE.PMREMGenerator(renderer);const environment=pmrem.fromEquirectangular(skyTexture);scene.environment=environment.texture;scene.environmentIntensity=.65;pmrem.dispose();skyTexture.dispose();
 const holes=document.createElement('canvas');holes.width=64;holes.height=64;
 const h=holes.getContext('2d');h.fillStyle='white';h.fillRect(0,0,64,64);h.fillStyle='black';
 for(const [x,y] of [[16,16],[48,48]]){h.beginPath();h.arc(x,y,13,0,Math.PI*2);h.fill();}
 const perforation=new THREE.CanvasTexture(holes);perforation.wrapS=perforation.wrapT=THREE.RepeatWrapping;perforation.repeat.set(5,5);perforation.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);
 const reflections=[];let reflectionsPaused=false;
 function addPondReflections(model){
  const ponds=[];model.traverse(o=>{if(o.isMesh&&o.name.includes('_koi_pond_'))ponds.push(o);});
  for(const pond of ponds){
   const shader={...Reflector.ReflectorShader};
   shader.vertexShader=shader.vertexShader.replace('varying vec4 vUv;','varying vec4 vUv; varying vec2 pondPoint;').replace('vUv = textureMatrix','pondPoint = position.xy; vUv = textureMatrix');
   shader.fragmentShader=shader.fragmentShader.replace('varying vec4 vUv;','varying vec4 vUv; varying vec2 pondPoint;').replace('vec4 base = texture2DProj( tDiffuse, vUv );',`vec4 rippleUv=vUv; rippleUv.xy += vec2(sin(pondPoint.y*18.0+sin(pondPoint.x*11.0)),cos(pondPoint.x*17.0+pondPoint.y*6.0))*.0018*vUv.w; vec4 base=texture2DProj(tDiffuse,rippleUv);`).replace('base.rgb, color ), 1.0','base.rgb, color ), .46');
   const geometry=pond.geometry.clone().translate(0,.09,0).rotateX(Math.PI/2);
   const reflection=new Reflector(geometry,{color:'#9bb6ae',textureWidth:512,textureHeight:512,multisample:0,clipBias:.003,shader});
   reflection.name='Courtyard_water_reflection';reflection.rotation.x=-Math.PI/2;reflection.position.y=-.078;
   reflection.material.transparent=true;reflection.material.depthWrite=false;reflection.userData={type:'water',interiorFeature:true};
   // The mirror re-renders the scene every frame; during camera flights it keeps its last image instead.
   const update=reflection.onBeforeRender;reflection.onBeforeRender=function(...args){if(!reflectionsPaused)update.apply(this,args);};
   pond.parent.add(reflection);reflections.push(reflection);
  }
 }
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#d9ded5',roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=.26;ground.receiveShadow=true;ground.name='PresentationGround';scene.add(ground);
 const receptionCanvas=document.createElement('canvas');receptionCanvas.width=512;receptionCanvas.height=160;
 const logo=receptionCanvas.getContext('2d');logo.font='bold 112px Arial';logo.textAlign='center';logo.textBaseline='middle';logo.strokeStyle='#b9eaff';logo.lineWidth=2;logo.shadowColor='#5caaff';logo.shadowBlur=12;logo.strokeText('OSD',256,82);
 const receptionTexture=new THREE.CanvasTexture(receptionCanvas);receptionTexture.colorSpace=THREE.SRGBColorSpace;
 function createReceptionSign(position){const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.45,.45),new THREE.MeshBasicMaterial({map:receptionTexture,transparent:true,depthWrite:false}));sign.name='OSD_reception_sign';sign.position.fromArray(position);sign.rotation.y=Math.PI;sign.userData={type:'furniture',interiorFeature:true};return sign;}
 return {ground,perforation,createReceptionSign,addPondReflections,setReflectionsPaused(value){reflectionsPaused=value;},setReflectionVisible(value){for(const reflection of reflections)reflection.visible=value;},dispose(){for(const reflection of reflections){reflection.geometry.dispose();reflection.dispose();}environment.dispose();perforation.dispose();receptionTexture.dispose();ground.geometry.dispose();ground.material.dispose();}};
}
