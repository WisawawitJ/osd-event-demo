// Tiny static server for the event demo: no dependencies, local files only.
// Usage: node scripts/serve.mjs [port]   (default 8080)
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root) || /[\\/]\.(git|claude)([\\/]|$)/.test(file)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store'});
    res.end(body);
  } catch {
    res.writeHead(404, {'content-type': 'text/plain'}).end('Not found');
  }
}).on('error', error => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is already in use (maybe the demo is already running: open http://localhost:${port}/).\nTo use another port: node scripts/serve.mjs ${port + 1}`);
  process.exit(1);
}).listen(port, '127.0.0.1', () => console.log(`OSD event demo: http://localhost:${port}/`));
