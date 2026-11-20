import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {OutputShader} from 'osd/node_modules/three/examples/jsm/shaders/OutputShader.js';

// A bounded offscreen render from the installed camera, independent of the orbit camera.
export function createSecurityPreview({renderer,scene,fullVisibility=[],schedule=()=>{}}){
 const width=512,height=288,target=new THREE.WebGLRenderTarget(width,height,{depthBuffer:true,type:THREE.HalfFloatType}),output=new THREE.WebGLRenderTarget(width,height,{depthBuffer:false});
 const outputMaterial=new THREE.RawShaderMaterial({...OutputShader,uniforms:THREE.UniformsUtils.clone(OutputShader.uniforms),defines:{ACES_FILMIC_TONE_MAPPING:'',SRGB_TRANSFER:''},depthTest:false,depthWrite:false});
 outputMaterial.uniforms.tDiffuse.value=target.texture;
 const outputScene=new THREE.Scene(),outputCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,2),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),outputMaterial);outputCamera.position.z=1;outputScene.add(quad);
 const pixels=new Uint8Array(width*height*4),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d'),image=context.createImageData(width,height),viewport=new THREE.Vector4(),scissor=new THREE.Vector4();
 function capture(camera){
  if(!camera?.isPerspectiveCamera)return '';
  let changed=false;const previousTarget=renderer.getRenderTarget(),scissorTest=renderer.getScissorTest(),visibility=fullVisibility.map(o=>[o,o.visible]);
  renderer.getViewport(viewport);renderer.getScissor(scissor);
  try{
   // The security camera sees the complete building even when the orbit view isolates a floor.
   // Shadows only need redrawing when the capture really shows more of the building than the view does.
   changed=visibility.some(([,visible])=>!visible);
   for(const [o] of visibility)o.visible=true;
   scene.updateMatrixWorld(true);camera.updateWorldMatrix(true,false);
   renderer.setRenderTarget(target);renderer.setScissorTest(false);
   if(changed)renderer.shadowMap.needsUpdate=true;
   renderer.render(scene,camera);
   outputMaterial.uniforms.toneMappingExposure.value=renderer.toneMappingExposure;
   renderer.setRenderTarget(output);renderer.render(outputScene,outputCamera);renderer.readRenderTargetPixels(output,0,0,width,height,pixels);
   const stride=width*4;for(let y=0;y<height;y++)image.data.set(pixels.subarray((height-y-1)*stride,(height-y)*stride),y*stride);
   context.putImageData(image,0,0);return canvas.toDataURL('image/jpeg',.85);
  }finally{
   for(const [o,visible] of visibility)o.visible=visible;
   renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
   if(changed)renderer.shadowMap.needsUpdate=true;schedule();
  }
 }
 return {capture,dispose(){target.dispose();output.dispose();quad.geometry.dispose();outputMaterial.dispose();}};
}
