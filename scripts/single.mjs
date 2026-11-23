// The whole demo as one HTML file (dist/osd-demo.html): opened by double-clicking it, with no server and no network.
// Everything the page loads is put inside it: code, styles, font, logos, page markup, the device map and the model
// (gzipped). It fails if the code no longer loads something the way replaced here.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {rolldown} from 'rolldown';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = (path) => join(root, path);
const text = (path) => readFileSync(file(path), 'utf8');
const TYPES = {'.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf'};
const dataUrl = (path) => `data:${TYPES[extname(path)]};base64,${readFileSync(file(path)).toString('base64')}`;

function swap(source, from, to) {
  if (!source.includes(from)) throw new Error(`Not found, so it cannot be put in the single file: ${from}`);
  return source.replaceAll(from, () => to);
}

const page = (path) => text(path).replace(/src\/brand\/[\w.-]+/g, dataUrl);
const pages = {
  './pages/showcase.html': page('src/pages/showcase.html'),
  './pages/explore.html': page('src/pages/explore.html'),
};
const SWAPS = {
  'src/boot.js': [
    ['await (await fetch(new URL(page.file, import.meta.url))).text()', `(${JSON.stringify(pages)})[page.file]`],
  ],
  'src/viewer/simulation.js': [
    ["await fetch('./model/device-map.json')", `new Response(${JSON.stringify(text('model/device-map.json'))})`],
  ],
  'src/viewer/main.js': [
    [
      "await fetch('./model/osd-building.glb', {signal: abort.signal})",
      `new Response(new Blob([Uint8Array.from(atob(document.getElementById('model').textContent), (c) => c.charCodeAt(0))])
        .stream().pipeThrough(new DecompressionStream('gzip')))`,
    ],
  ],
};

const bundle = await rolldown({
  input: file('src/boot.js'),
  plugins: [
    {
      name: 'osd-single',
      resolveId(id) {
        const own = id.match(/^osd\/(core|viewer|parking)\/(.+)$/);
        if (own) return file(`src/${own[1]}/${own[2]}`);
        if (id.startsWith('osd/node_modules/three/')) return id.replace('osd/node_modules/three', file('vendor/three'));
        return null;
      },
      transform(code, id) {
        const swaps = SWAPS[id.slice(root.length + 1)];
        return swaps ? swaps.reduce((all, [from, to]) => swap(all, from, to), code) : null;
      },
    },
  ],
});
const {output} = await bundle.generate({format: 'esm', minify: true, codeSplitting: false});
if (output.length !== 1) throw new Error(`Expected one chunk, got ${output.map((o) => o.fileName).join(', ')}`);
// Neither ends the script element early nor starts a comment in it.
const script = output[0].code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

let html = text('index.html');
html = html.replace(/<link rel="stylesheet" href="\.\/([^"]+)" \/>/g, (_, path) => {
  const css = text(path).replace(/url\('\.\.\/([^']+)'\)/g, (_all, asset) => `url('${dataUrl(`src/${asset}`)}')`);
  return `<style>\n${css}\n</style>`;
});
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
const model = gzipSync(readFileSync(file('model/osd-building.glb')), {level: 9}).toString('base64');
html = swap(
  html,
  '<script type="module" src="./src/boot.js"></script>',
  `<script type="text/plain" id="model">${model}</script>\n<script type="module">${script}</script>`,
);
mkdirSync(file('dist'), {recursive: true});
// And one for a laptop with weak graphics (quality.js).
const light = swap(
  html,
  '<script type="module">',
  '<script>window.__demoOptions = {light: ""};</script>\n<script type="module">',
);
for (const [name, content] of [
  ['osd-demo', html],
  ['osd-demo-light', light],
]) {
  writeFileSync(file(`dist/${name}.html`), content);
  console.log(`dist/${name}.html, ${(Buffer.byteLength(content) / 1e6).toFixed(1)} MB`);
}
