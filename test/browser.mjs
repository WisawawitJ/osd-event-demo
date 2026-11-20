// Headless Chromium driven over the DevTools protocol, with no npm dependencies.
// It starts its own static server on a free port and prefers the machine's GPU: software WebGL
// (SwiftShader) draws this scene at 3–5 fps, which made every check slow.
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// GPU back ends to try, best first. `software` is the always-available fallback.
const GPU_MODES = {
  egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'],
  vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--ignore-gpu-blocklist'],
  software: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
};

function freePort() {
  return new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); }); });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], {stdio: 'ignore'});
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return {url: `http://127.0.0.1:${port}/`, stop: () => child.kill()}; } catch {} await sleep(100); }
  child.kill();
  throw new Error('test server did not start');
}

async function startBrowser(flags, profileRoot) {
  const port = await freePort();
  const profile = mkdtempSync(join(profileRoot, 'chrome-'));
  const chrome = spawn(process.env.CHROMIUM || 'chromium', ['--headless=new', '--no-sandbox', '--hide-scrollbars', '--window-size=1600,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...flags, 'about:blank'], {stdio: 'ignore'});
  let target;
  for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(100); }
  if (!target) { chrome.kill('SIGKILL'); throw new Error('chromium did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.addEventListener('open', ok); ws.addEventListener('error', fail); });
  let id = 0;
  const pending = new Map(), logs = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${m.params.type}] ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  });
  const send = (method, params = {}) => new Promise(ok => { const i = ++id; pending.set(i, ok); ws.send(JSON.stringify({id: i, method, params})); });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
  return {send, logs, close() { ws.close(); chrome.kill('SIGKILL'); try { rmSync(profile, {recursive: true, force: true}); } catch {} }};
}

// Opens a browser and server. `gpu` is a GPU_MODES key or 'auto' (first mode that gives hardware WebGL).
export async function open({gpu = process.env.GPU || 'auto', shots = join(root, 'test/out')} = {}) {
  const profileRoot = join(process.env.TEST_TMP || tmpdir(), 'osd-demo-test');
  mkdirSync(profileRoot, {recursive: true});
  mkdirSync(shots, {recursive: true});
  const server = await startServer();
  const modes = gpu === 'auto' ? Object.keys(GPU_MODES) : [gpu];
  let browser, renderer = '';
  for (const mode of modes) {
    browser = await startBrowser(GPU_MODES[mode], profileRoot);
    renderer = (await browser.send('Runtime.evaluate', {expression: `(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return g?(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'webgl2'):''})()`, returnByValue: true})).result?.result?.value || '';
    const hardware = renderer && !/swiftshader|llvmpipe|software/i.test(renderer);
    if (hardware || mode === 'software' || gpu !== 'auto') { renderer = `${mode}: ${renderer || 'no WebGL'}`; break; }
    browser.close();
  }
  const {send, logs} = browser;
  let shot = 0;
  const page = {
    renderer, logs, url: server.url, sleep,
    cdp: send, // raw DevTools protocol, e.g. for profiling

    async goto(path) { logs.length = 0; await send('Page.navigate', {url: server.url + path.replace(/^\//, '')}); await sleep(300); },
    async eval(expression) {
      const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    // Polls a page expression until it is truthy; throws with `what` on timeout.
    async until(expression, {timeout = 30000, what = expression} = {}) {
      const end = Date.now() + timeout;
      while (Date.now() < end) { if (await page.eval(expression)) return; await sleep(100); }
      throw new Error(`timed out waiting for ${what}`);
    },
    async click(selector) { const r = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`); if (!r) throw new Error(`no element ${selector}`); },
    async shot(name) {
      const r = await send('Page.captureScreenshot', {format: 'png'});
      const file = join(shots, `${String(++shot).padStart(2, '0')}-${name}.png`);
      writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
  };
  return {page, close() { browser.close(); server.stop(); }};
}
