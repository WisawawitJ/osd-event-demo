import * as T from 'osd/node_modules/three/build/three.module.js';

// Deterministic local material tiles. UVs are in metres, not stretched to each mesh.
export function createSurfaceTextures(renderer) {
  const textures = new Map(),
    materials = new Set();
  let seed = 0x4f5344;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  function tile(kind) {
    if (textures.has(kind)) return textures.get(kind);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = kind === 'paving' ? 2048 : 512;
    const c = canvas.getContext('2d');
    if (kind === 'solar') {
      c.fillStyle = '#a2b8cc';
      c.fillRect(0, 0, 512, 512);
      for (let row = 0; row < 12; row++)
        for (let col = 0; col < 6; col++) {
          const x = (col * 512) / 6,
            y = (row * 512) / 12;
          c.fillStyle = (row + col) % 3 ? '#b5c7d5' : '#adbfce';
          c.fillRect(x + 1.4, y + 1.4, 512 / 6 - 2.8, 512 / 12 - 2.8);
          c.fillStyle = '#d9e2e8';
          c.fillRect(x + 512 / 18, y + 2, 0.7, 512 / 12 - 4);
          c.fillRect(x + 1024 / 18, y + 2, 0.7, 512 / 12 - 4);
        }
    } else if (kind === 'timber') {
      for (let board = 0; board < 8; board++) {
        const x = board * 64,
          v = 207 + random() * 22;
        c.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
        c.fillRect(x, 0, 64, 512);
        for (let grain = 0; grain < 38; grain++) {
          const gx = x + random() * 64;
          c.strokeStyle = `rgba(65,55,42,${0.025 + random() * 0.07})`;
          c.lineWidth = 0.5 + random();
          c.beginPath();
          c.moveTo(gx, 0);
          c.bezierCurveTo(gx + random() * 9, 170, gx - random() * 9, 350, gx, 512);
          c.stroke();
        }
        c.fillStyle = 'rgba(60,53,42,.18)';
        c.fillRect(x, 0, 1, 512);
        c.fillRect(x, board % 2 ? 170 : 345, 64, 1);
      }
    } else if (kind === 'paving') {
      c.fillStyle = '#979c97';
      c.fillRect(0, 0, 2048, 2048);
      for (let row = 0; row < 95; row++) {
        const inner = row * 16,
          outer = inner + 15.2,
          steps = Math.max(6, Math.ceil((Math.PI * 2 * (inner + 8)) / 20));
        for (let i = 0; i < steps; i++) {
          const a = ((i + (row % 2) * 0.5) * Math.PI * 2) / steps,
            b = a + (Math.PI * 2) / steps - 0.0005;
          c.beginPath();
          c.arc(1024, 1024, outer, a, b);
          c.arc(1024, 1024, inner + 0.3, b, a, true);
          c.closePath();
          const v = 182 + random() * 30;
          c.fillStyle = `rgb(${v},${v + 2},${v})`;
          c.fill();
        }
      }
    } else if (kind === 'terrazzo') {
      c.fillStyle = '#e2e0d9';
      c.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 9000; i++) {
        const v = 145 + random() * 95;
        c.fillStyle = `rgba(${v},${v},${v - 5},.32)`;
        const x = random() * 512,
          y = random() * 512,
          r = 0.4 + random() * 1.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + r * 1.7, y + 0.2);
        c.lineTo(x + r, y + r);
        c.closePath();
        c.fill();
      }
      c.fillStyle = 'rgba(90,95,90,.12)';
      c.fillRect(0, 0, 512, 1);
      c.fillRect(0, 0, 1, 512);
    } else if (kind === 'brushed') {
      c.fillStyle = '#e2e4e3';
      c.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y++) {
        c.fillStyle = `rgba(80,89,91,${random() * 0.09})`;
        c.fillRect(0, y, 512, 1);
      }
    } else {
      const pixels = c.getImageData(0, 0, 512, 512);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const v = kind === 'carpet' ? 191 + random() * 38 : 211 + random() * 14;
        pixels.data[i] = v;
        pixels.data[i + 1] = v;
        pixels.data[i + 2] = v - 2;
        pixels.data[i + 3] = 255;
      }
      c.putImageData(pixels, 0, 0);
      if (kind === 'concrete')
        for (let i = 0; i < 240; i++) {
          c.fillStyle = 'rgba(70,75,71,.06)';
          c.beginPath();
          c.ellipse(random() * 512, random() * 512, 0.4 + random(), 0.6 + random(), 0, 0, Math.PI * 2);
          c.fill();
        }
    }
    const texture = new T.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = kind === 'paving' ? T.ClampToEdgeWrapping : T.RepeatWrapping;
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    textures.set(kind, texture);
    return texture;
  }
  function classify(object) {
    if (object.userData.surface) return object.userData.surface;
    if (object.name.includes('furniture_wood') || object.name.includes('seminar_stage')) return 'timber';
    if (
      object.name.includes('lift_doors') ||
      object.userData.type === 'facade_screen' ||
      object.name.includes('silver_ribbons')
    )
      return 'brushed';
    if (
      ['wall', 'column', 'stair'].includes(object.userData.type) &&
      !object.name.match(/frame|handrail|guard|edge|trim/i)
    )
      return 'concrete';
    if (object.userData.type === 'floor' && !object.name.match(/pond_bed|room_floor|access/)) return 'concrete';
    return null;
  }
  function apply(model) {
    model.traverse((object) => {
      if (!object.isMesh) return;
      const kind = classify(object);
      if (!kind) return;
      const geometry = object.geometry,
        position = geometry.attributes.position,
        normal = geometry.attributes.normal;
      if (!normal) return;
      const uv = new Float32Array(position.count * 2),
        scale = kind === 'paving' ? 2.5 : kind === 'terrazzo' || kind === 'carpet' ? 0.8 : kind === 'timber' ? 1.7 : 2;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i),
          y = position.getY(i),
          z = position.getZ(i),
          nx = Math.abs(normal.getX(i)),
          ny = Math.abs(normal.getY(i)),
          nz = Math.abs(normal.getZ(i));
        const coords = ny >= nx && ny >= nz ? [x, z] : nx >= nz ? [z, y] : [x, y];
        uv[i * 2] =
          kind === 'solar'
            ? geometry.attributes.uv.getX(i)
            : kind === 'paving'
              ? (x - (object.userData.pavingCenter?.[0] || 0)) / 30 + 0.5
              : coords[0] / scale;
        uv[i * 2 + 1] =
          kind === 'solar'
            ? geometry.attributes.uv.getY(i)
            : kind === 'paving'
              ? (z - (object.userData.pavingCenter?.[1] || 0)) / 30 + 0.5
              : coords[1] / scale;
      }
      geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
      const replacements = [].concat(object.material).map((original) => {
        const material = original.clone();
        material.map = tile(kind);
        if (!['brushed', 'solar'].includes(kind)) {
          material.bumpMap = material.map;
          material.bumpScale = kind === 'paving' ? 0.025 : kind === 'timber' ? 0.004 : 0.006;
        }
        material.roughness =
          kind === 'solar'
            ? 0.28
            : kind === 'terrazzo'
              ? 0.35
              : kind === 'timber'
                ? 0.62
                : kind === 'brushed'
                  ? 0.38
                  : 0.85;
        material.needsUpdate = true;
        materials.add(material);
        return material;
      });
      object.material = Array.isArray(object.material) ? replacements : replacements[0];
    });
  }
  return {
    apply,
    dispose() {
      for (const texture of textures.values()) texture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
