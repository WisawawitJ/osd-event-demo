import * as THREE from 'osd/node_modules/three/build/three.module.js';

// Light in the air under a lamp: a cone of lit air from the lamp down to the floor or road, drawn on a closed
// cylinder (`createLightCone`). It is lit air, not a surface: each pixel adds up the glow along its view ray through
// the cone (brightest under the lamp and on the axis, fading towards the floor and the edge). Drawn as the cone's
// hollow shell, it looked right only from the side: from above, the view passed through the narrow top to the floor
// and saw no glow at all, a dark disc under the lamp.
// The eye is found per object in the vertex shader, so one material serves any number of cones (a uniform set per
// object is not sent again for the next object with the same material). The material's `opacity` scales the glow,
// so an owner can fade it as for any other material.
const vertexShader = `varying vec3 local; varying vec3 eye;
 void main(){local=position;eye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader = `uniform vec3 color,shape; uniform float opacity,strength; varying vec3 local; varying vec3 eye;
 float glow(vec3 p){float h=(p.y+shape.x)/(2.*shape.x);if(h<0.||h>1.)return 0.;float q=length(p.xz)/mix(shape.z,shape.y,h);return q<1.?(1.-q*q)*h*h:0.;}
 void main(){
  // Entered here (a front face), or from the eye when it is inside the cone (then only the back faces draw).
  float hEye=(eye.y+shape.x)/(2.*shape.x);bool inside=hEye>0.&&hEye<1.&&length(eye.xz)<mix(shape.z,shape.y,hEye);
  if(gl_FrontFacing==inside)discard;
  vec3 d=normalize(local-eye);float t0=inside?0.:distance(local,eye);
  // Leaves the cone's bounding cylinder (the wide bottom's radius) or its top or bottom.
  float a=dot(d.xz,d.xz),b=dot(eye.xz,d.xz),c=dot(eye.xz,eye.xz)-shape.z*shape.z;
  float t1=a>1e-6?(-b+sqrt(max(0.,b*b-a*c)))/a:1e4;
  if(abs(d.y)>1e-6)t1=min(t1,((d.y>0.?shape.x:-shape.x)-eye.y)/d.y);
  float dt=max(0.,t1-t0)/24.,jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))),sum=0.;
  for(int i=0;i<24;i++)sum+=glow(eye+d*(t0+(float(i)+jitter)*dt));
  gl_FragColor=vec4(color,(1.-exp(-strength*sum*dt))*opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
 }`;

// A material for cones `height` tall, `top` wide in radius at the lamp and `bottom` at the floor.
export function createLightConeMaterial({color, height, top, bottom, strength = 1.1}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color(color)}, opacity: {value: 1}, strength: {value: strength}, shape: {value: new THREE.Vector3(height / 2, top, bottom)}},
    vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.AdditiveBlending,
  });
  // The fade: `opacity`, read once per frame (uniforms go to the GPU at the material's first draw in a frame).
  material.onBeforeRender = () => { material.uniforms.opacity.value = material.opacity; };
  return material;
}

// The cone's mesh, centred on its axis: place its top at the lamp with `position.y = lampY - height / 2`.
export const createLightConeGeometry = ({height, top, bottom}) => new THREE.CylinderGeometry(top, bottom, height, 32, 1, false);
