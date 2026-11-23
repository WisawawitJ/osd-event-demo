import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {WORLD_CLEAR, WORLD_GONE} from 'osd/viewer/view-math.js';

// Fog of war: the world fades into the background from 65 m to 95 m out from the site's middle, measured across the
// ground rather than from the camera, so the ground's edge (100 m out) and the street's ends never show from any view,
// and cars on the street come out of it. three.js measures fog from the camera; its chunks are swapped for ones that
// measure from the site's middle: the vertex passes on its ground position (the world position from the view-space
// one: the view matrix is a rotation and a move) and each pixel takes its own distance. (The distance passed on per
// vertex blended wrongly across big triangles: the ground and the road, whose corners lie 100 m out, vanished.)
// The fog's colour keeps in step with the sky (daylight.js).
export function groundFog(color) {
  const fogChunk = (name, from, to) => {
    if (!THREE.ShaderChunk[name].includes(from)) throw new Error(`fog chunk ${name} changed`);
    THREE.ShaderChunk[name] = THREE.ShaderChunk[name].replaceAll(from, to);
  };
  fogChunk('fog_pars_vertex', 'varying float vFogDepth;', 'varying vec2 vFogGround;');
  fogChunk(
    'fog_vertex',
    'vFogDepth = - mvPosition.z;',
    'vFogGround = (transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz)).xz;',
  );
  fogChunk('fog_pars_fragment', 'varying float vFogDepth;', 'varying vec2 vFogGround;');
  fogChunk('fog_fragment', 'vFogDepth', 'length(vFogGround)');
  return new THREE.Fog(color, WORLD_CLEAR, WORLD_GONE);
}
