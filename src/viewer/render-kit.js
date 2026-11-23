import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {Reflector} from 'osd/node_modules/three/examples/jsm/objects/Reflector.js';
import {options} from 'osd/core/options.js';

// Locally generated studio sky: no remote HDRI/texture dependencies.
export function createRenderKit(renderer, scene) {
  const sky = document.createElement('canvas');
  sky.width = 512;
  sky.height = 256;
  const c = sky.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#779eae');
  grad.addColorStop(0.42, '#dae4e4');
  grad.addColorStop(0.52, '#fff8e6');
  grad.addColorStop(0.57, '#b9b9a7');
  grad.addColorStop(1, '#666f67');
  c.fillStyle = grad;
  c.fillRect(0, 0, 512, 256);
  const sun = c.createRadialGradient(360, 82, 2, 360, 82, 56);
  sun.addColorStop(0, '#ffffff');
  sun.addColorStop(0.3, '#fffbe9');
  sun.addColorStop(1, '#fffbe900');
  c.fillStyle = sun;
  c.fillRect(300, 20, 120, 124);
  const skyTexture = new THREE.CanvasTexture(sky);
  skyTexture.mapping = THREE.EquirectangularReflectionMapping;
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(skyTexture);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();
  skyTexture.dispose();
  const holes = document.createElement('canvas');
  holes.width = 64;
  holes.height = 64;
  const h = holes.getContext('2d');
  h.fillStyle = 'white';
  h.fillRect(0, 0, 64, 64);
  h.fillStyle = 'black';
  for (const [x, y] of [
    [16, 16],
    [48, 48],
  ]) {
    h.beginPath();
    h.arc(x, y, 13, 0, Math.PI * 2);
    h.fill();
  }
  const perforation = new THREE.CanvasTexture(holes);
  perforation.wrapS = perforation.wrapT = THREE.RepeatWrapping;
  perforation.repeat.set(5, 5);
  perforation.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
  // Screenshots (the `manual` option) take the water as it settles at once: the fade is on real time, which they do not wait out.
  const reflections = [],
    STILL_MS = 100,
    FADE_MS = 'manual' in options ? 0 : 250;
  let reflectionsPaused = false,
    liveView = true;
  // The mirror's share of the water colour (reflectionMix) fades over FADE_MS when the camera sets off or stops,
  // instead of snapping between the reflection and the plain water colour (the whole pond flashed).
  let mixFrom = 1,
    mixTo = 1,
    mixAt = 0;
  const mixNow = () => mixFrom + (mixTo - mixFrom) * (FADE_MS ? Math.min(1, (performance.now() - mixAt) / FADE_MS) : 1);
  // Live while the camera is still on a ground-floor view (where the pond is close enough to be worth the mirror's
  // second pass over the scene); elsewhere the water keeps its stand-in. The water itself is always drawn: hidden
  // outside the ground floor, it appeared and vanished at once as a flight changed floors.
  function retarget() {
    const to = reflectionsPaused || !liveView ? 0 : 1;
    if (to === mixTo) return;
    mixFrom = mixNow();
    mixTo = to;
    mixAt = performance.now();
  }
  // The Reflector draws the mirrored scene through the whole view, though only the pond's few pixels show it. Handing it
  // a projection cropped to the pond's rectangle (in the mirrored camera) keeps its texture mapping consistent (it is
  // built from that projection) and lets frustum culling drop everything the pond cannot show: most of the building.
  const savedProjection = new THREE.Matrix4(),
    cropMatrix = new THREE.Matrix4(),
    mirror = new THREE.PerspectiveCamera();
  const mirrorNormal = new THREE.Vector3(),
    mirrorPoint = new THREE.Vector3(),
    eye = new THREE.Vector3(),
    look = new THREE.Vector3(),
    rotation = new THREE.Matrix4(),
    corner = new THREE.Vector3();
  function pondCrop(reflection, camera) {
    // Same mirrored camera as Reflector.onBeforeRender.
    reflection.updateWorldMatrix(true, false);
    mirrorPoint.setFromMatrixPosition(reflection.matrixWorld);
    eye.setFromMatrixPosition(camera.matrixWorld);
    rotation.extractRotation(reflection.matrixWorld);
    mirrorNormal.set(0, 0, 1).applyMatrix4(rotation);
    if (look.subVectors(mirrorPoint, eye).dot(mirrorNormal) > 0) return null;
    mirror.position.copy(look.reflect(mirrorNormal).negate().add(mirrorPoint));
    rotation.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rotation).add(eye);
    const target = look.subVectors(mirrorPoint, look).reflect(mirrorNormal).negate().add(mirrorPoint);
    mirror.up.set(0, 1, 0).applyMatrix4(rotation).reflect(mirrorNormal);
    mirror.lookAt(target);
    mirror.updateMatrixWorld();
    const box = reflection.geometry.boundingBox;
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y]) {
        corner.set(x, y, 0).applyMatrix4(reflection.matrixWorld).applyMatrix4(mirror.matrixWorldInverse);
        if (corner.z > -camera.near) return null; // a corner behind the eye: keep the full view
        corner.applyMatrix4(camera.projectionMatrix);
        x0 = Math.min(x0, corner.x);
        x1 = Math.max(x1, corner.x);
        y0 = Math.min(y0, corner.y);
        y1 = Math.max(y1, corner.y);
      }
    const m = 0.04;
    x0 = Math.max(-1, x0 - m);
    x1 = Math.min(1, x1 + m);
    y0 = Math.max(-1, y0 - m);
    y1 = Math.min(1, y1 + m); // ripples shift samples slightly
    if (x1 <= x0 || y1 <= y0 || (x1 - x0) * (y1 - y0) > 3.2) return null; // off screen, or most of it: nothing to gain
    const sx = 2 / (x1 - x0),
      sy = 2 / (y1 - y0);
    return cropMatrix.set(sx, 0, 0, -(x1 + x0) / (x1 - x0), 0, sy, 0, -(y1 + y0) / (y1 - y0), 0, 0, 1, 0, 0, 0, 0, 1);
  }
  function addPondReflections(model) {
    const ponds = [];
    model.traverse((o) => {
      if (o.isMesh && o.name.includes('_koi_pond_')) ponds.push(o);
    });
    for (const pond of ponds) {
      const shader = {...Reflector.ReflectorShader};
      shader.vertexShader = shader.vertexShader
        .replace('varying vec4 vUv;', 'varying vec4 vUv; varying vec2 pondPoint;')
        .replace('vUv = textureMatrix', 'pondPoint = position.xy; vUv = textureMatrix');
      // reflectionMix 0 shows, instead of the mirror's picture, a flat colour as bright as that picture on average
      // (plainColor, see onBeforeRender), so the water looks the same while the mirror is paused.
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'varying vec4 vUv;',
          'varying vec4 vUv; varying vec2 pondPoint; uniform float reflectionMix; uniform vec3 plainColor;',
        )
        .replace(
          'vec4 base = texture2DProj( tDiffuse, vUv );',
          `vec4 rippleUv=vUv; rippleUv.xy += vec2(sin(pondPoint.y*18.0+sin(pondPoint.x*11.0)),cos(pondPoint.x*17.0+pondPoint.y*6.0))*.0018*vUv.w; vec4 base=mix(vec4(plainColor,1.),texture2DProj(tDiffuse,rippleUv),reflectionMix);`,
        )
        .replace('base.rgb, color ), 1.0', 'base.rgb, color ), .46');
      const geometry = pond.geometry
        .clone()
        .translate(0, 0.09, 0)
        .rotateX(Math.PI / 2);
      const reflection = new Reflector(geometry, {
        color: '#9bb6ae',
        textureWidth: 512,
        textureHeight: 512,
        multisample: 0,
        clipBias: 0.003,
        shader,
      });
      reflection.name = 'Courtyard_water_reflection';
      reflection.rotation.x = -Math.PI / 2;
      reflection.position.y = -0.078;
      reflection.material.transparent = true;
      reflection.material.depthWrite = false;
      reflection.material.uniforms.reflectionMix = {value: 1};
      reflection.material.uniforms.plainColor = {value: new THREE.Color()};
      reflection.userData = {type: 'water', interiorFeature: true};
      // The mirror re-renders the scene every frame, but not during camera flights (it would cost ~45% more per flight
      // frame). Its last image only fits the camera it was drawn from (and may be from long ago, or empty, when the pond
      // was off screen: the water went dark flying in), so meanwhile the pond fades to its plain water colour (the last
      // image still nearly fits in the flight's first slow moments), and the reflection fades back once the camera stops.
      // Its camera is cropped to the pond's patch of the screen, so culling skips everything else (see pondCrop).
      // With the camera still, the mirror's picture barely changes, while the view may redraw every frame for cars driving
      // past: it is then redrawn at most every STILL_MS (lights, doors), every frame only while the camera moves. Each
      // mirror pass also costs the main pass, as every material drawn in both swaps shader twice (the mirror's target
      // has another colour space and no tone mapping): at the pond that was about half the frame's CPU time.
      geometry.computeBoundingBox();
      const seen = {camera: null, view: new THREE.Matrix4(), projection: new THREE.Matrix4(), at: -Infinity};
      const update = reflection.onBeforeRender;
      reflection.onBeforeRender = function (renderer, scene, camera, ...rest) {
        const mix = this.material.uniforms.reflectionMix;
        mix.value = mixNow();
        // The mirror's picture is mostly sky, so its stand-in follows the sky's colour: 0.3 × it + 0.015 (linear) gives
        // the water, as drawn, the same average colour as the live reflection, morning, noon, dusk and night (within 2 of
        // 255). A fixed mid grey made the paused water too bright, by day and much more at night.
        if (scene.background?.isColor)
          this.material.uniforms.plainColor.value.copy(scene.background).multiplyScalar(0.3).addScalar(0.015);
        if (reflectionsPaused || !liveView) {
          seen.camera = null;
          return;
        }
        const now = performance.now();
        if (
          camera === seen.camera &&
          now - seen.at < STILL_MS &&
          seen.view.equals(camera.matrixWorld) &&
          seen.projection.equals(camera.projectionMatrix)
        )
          return;
        seen.camera = camera;
        seen.view.copy(camera.matrixWorld);
        seen.projection.copy(camera.projectionMatrix);
        seen.at = now;
        const crop = camera.isPerspectiveCamera ? pondCrop(reflection, camera) : null;
        if (!crop) return update.call(this, renderer, scene, camera, ...rest);
        savedProjection.copy(camera.projectionMatrix);
        camera.projectionMatrix.premultiply(crop);
        try {
          update.call(this, renderer, scene, camera, ...rest);
        } finally {
          camera.projectionMatrix.copy(savedProjection);
        }
      };
      pond.parent.add(reflection);
      reflections.push(reflection);
    }
  }
  const ground = createGround();
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.26;
  ground.receiveShadow = true;
  ground.name = 'PresentationGround';
  scene.add(ground);
  // The ground: a field of grass, not a flat pale plane. A grass texture (speckle and faint tufts) gives it close-up
  // detail, sampled twice at different sizes and angles so it does not repeat; light and dark patches from smooth noise
  // make it look mown and worn. Its edge, 100 m out, is lost in the fog (main.js).
  function createGround() {
    const size = 512,
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = canvas.getContext('2d');
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    c.fillStyle = '#7d9257';
    c.fillRect(0, 0, size, size);
    // Drawn three times over, offset by the tile's size, so tufts and blades crossing an edge carry on across it.
    const wrap = (draw) => {
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) draw(dx, dy);
    };
    // Faint: stronger, these tufts repeated with the tile as a visible grid from afar (the shader's patches do not repeat).
    for (let i = 0; i < 70; i++) {
      const x = rand() * size,
        y = rand() * size,
        r = 20 + rand() * 60,
        light = rand() < 0.5,
        g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, light ? 'rgba(160,178,104,.1)' : 'rgba(84,104,52,.1)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      wrap((dx, dy) => {
        c.save();
        c.translate(dx, dy);
        c.fillStyle = g;
        c.fillRect(x - r, y - r, r * 2, r * 2);
        c.restore();
      });
    }
    const greens = ['#5f7a3e', '#6d8a45', '#8aa05f', '#9bb06a', '#a8a46a', '#55703a'];
    for (let i = 0; i < 9000; i++) {
      const x = rand() * size,
        y = rand() * size,
        a = rand() * Math.PI,
        l = 2 + rand() * 4;
      c.strokeStyle = greens[i % greens.length];
      c.globalAlpha = 0.35 + rand() * 0.4;
      c.lineWidth = 1;
      wrap((dx, dy) => {
        c.beginPath();
        c.moveTo(x + dx, y + dy);
        c.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
        c.stroke();
      });
    }
    c.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(25, 25);
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    // Patches: smooth value noise across the ground, three octaves, as a brightness from 0.76 to 1.12, worked out per pixel
    // from the ground position the fog passes on (main.js), so they need no vertex data of their own. (On the test GPU,
    // with the start-up warm-up skipped (the `warm: 0` option), the ground draws as background until its shader is next rebuilt;
    // with the warm-up, as the booth runs, it draws.)
    const material = new THREE.MeshStandardMaterial({map: texture, roughness: 1});
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          'void main() {',
          `float groundHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float groundNoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(groundHash(i),groundHash(i+vec2(1.,0.)),u.x),mix(groundHash(i+vec2(0.,1.)),groundHash(i+vec2(1.,1.)),u.x),u.y);}
void main() {`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_FOG
 // Two samples of the grass, at different sizes and angles, blended by noise: a single 8 m tile repeated across
 // the field showed as a grid.
 {vec2 q=vFogGround;float k=smoothstep(.3,.7,groundNoise(q/9.+vec2(5.,1.)));
  diffuseColor*=mix(texture2D(map,q/8.),texture2D(map,mat2(.8,-.6,.6,.8)*q/11.3+vec2(.37,.71)),k);}
#else
#include <map_fragment>
#endif
#ifdef USE_FOG
 {float n=.5*groundNoise(vFogGround/38.)+.3*groundNoise(vFogGround/13.+vec2(9.,4.))+.2*groundNoise(vFogGround/4.5+vec2(2.,7.)),b=.76+.36*n;
  diffuseColor.rgb*=vec3(b*(.97+.06*groundNoise(vFogGround/25.+vec2(3.,0.))),b,b*.96);}
#endif`,
        );
    };
    return new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material);
  }
  const receptionCanvas = document.createElement('canvas');
  receptionCanvas.width = 512;
  receptionCanvas.height = 160;
  const logo = receptionCanvas.getContext('2d');
  logo.font = 'bold 112px Arial';
  logo.textAlign = 'center';
  logo.textBaseline = 'middle';
  logo.strokeStyle = '#b9eaff';
  logo.lineWidth = 2;
  logo.shadowColor = '#5caaff';
  logo.shadowBlur = 12;
  logo.strokeText('OSD', 256, 82);
  const receptionTexture = new THREE.CanvasTexture(receptionCanvas);
  receptionTexture.colorSpace = THREE.SRGBColorSpace;
  function createReceptionSign(position) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.45, 0.45),
      new THREE.MeshBasicMaterial({map: receptionTexture, transparent: true, depthWrite: false}),
    );
    sign.name = 'OSD_reception_sign';
    sign.position.fromArray(position);
    sign.rotation.y = Math.PI;
    sign.userData = {type: 'furniture', interiorFeature: true};
    return sign;
  }
  return {
    ground,
    perforation,
    createReceptionSign,
    addPondReflections,
    setReflectionsPaused(value) {
      reflectionsPaused = value;
      retarget();
    },
    fadeMs: FADE_MS,
    setReflectionLive(value) {
      liveView = value;
      retarget();
    },
    dispose() {
      for (const reflection of reflections) {
        reflection.geometry.dispose();
        reflection.dispose();
      }
      environment.dispose();
      perforation.dispose();
      receptionTexture.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
    },
  };
}
