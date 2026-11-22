// Headless Chromium driven over the DevTools protocol, with no npm dependencies.
// It starts its own static server on a free port; WebGL renders on the NVIDIA GPU when present, else in software.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// WebGL back ends. Never the Intel iGPU unless GPU=egl asks for it outright: on the development laptop, headless
// Chromium on it hung the GPU twice (i915 "GPU HANG … in chromium", then "GuC failed to reset engine" / "Failed to
// reset chip"), and as that iGPU also drives the display, the whole desktop froze until a forced restart.
// The default is the NVIDIA GPU when its driver is installed (it does not drive the display, and is the fastest:
// a check that took 9 s on the iGPU takes 5 s), otherwise software WebGL (SwiftShader, on the CPU). A hardware
// browser that turns out to have opened the iGPU anyway is closed at once and the run falls back to software.
const NVIDIA_EGL = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
const GPU_MODES = {
  software: ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  // The NVIDIA GPU only (it does not drive the display): EGL through NVIDIA's vendor library alone, so Mesa and with it
  // the Intel iGPU are never loaded.
  nvidia: {flags: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'], env: {__EGL_VENDOR_LIBRARY_FILENAMES: NVIDIA_EGL, __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia'}},
  egl: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'],
  vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--ignore-gpu-blocklist'],
};

// Browsers and servers still running when the runner exits or is interrupted are killed: a left-over headless page
// keeps drawing the demo at full speed and slowed (and hung) later runs on the same GPU.
// A browser runs in its own process group, killed whole: its helper processes (GPU, renderers) go with it.
const running = new Set();
const killGroup = child => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
process.on('exit', () => { for (const child of running) killGroup(child); });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(130));

function freePort() {
  return new Promise((ok, fail) => { const s = createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => ok(port)); }); });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port)], {stdio: 'ignore'});
  running.add(child);
  const stop = () => { child.kill(); running.delete(child); };
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return {url: `http://127.0.0.1:${port}/`, stop}; } catch {} await sleep(100); }
  stop();
  throw new Error('test server did not start');
}

// The browser itself, not Arch's `chromium` launcher: that one adds the desktop's own flags from
// ~/.config/chromium-flags.conf (extensions loaded into every test browser, a device scale factor, Wayland).
const CHROMIUM = process.env.CHROMIUM || (existsSync('/usr/lib/chromium/chromium') ? '/usr/lib/chromium/chromium' : 'chromium');

async function startBrowser(mode, profileRoot) {
  const {flags, env = {}} = Array.isArray(mode) ? {flags: mode} : mode;
  const port = await freePort();
  const profile = mkdtempSync(join(profileRoot, 'chrome-'));
  // At low CPU priority: software rendering is CPU work, and the desktop around it should stay responsive.
  const chrome = spawn('nice', ['-n', '10', CHROMIUM, '--headless=new', '--no-sandbox', '--disable-extensions', '--disable-crash-reporter', '--hide-scrollbars', '--window-size=1600,1000', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...flags, 'about:blank'], {stdio: 'ignore', env: {...process.env, ...env}, detached: true});
  running.add(chrome);
  const exited = new Promise(r => chrome.once('exit', r));
  let ws = null;
  // The profile goes once the browser has exited: deleted at once, it was written back by processes still shutting
  // down, and hundreds were left in /tmp (which is memory).
  const close = () => {
    ws?.close(); killGroup(chrome); running.delete(chrome);
    return Promise.race([exited, sleep(3000)]).then(() => sleep(200)).then(() => { try { rmSync(profile, {recursive: true, force: true, maxRetries: 3}); } catch {} });
  };
  try {
    let target;
    for (let i = 0; i < 80 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} if (!target) await sleep(100); }
    if (!target) throw new Error('chromium did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.addEventListener('open', ok); ws.addEventListener('error', fail); });
    let id = 0;
    const pending = new Map(), logs = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id).ok(m); pending.delete(m.id); }
      else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${m.params.type}] ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
      else if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    });
    // A call that gets no answer (a hung page or GPU process) fails the check instead of hanging the whole run.
    // A browser that died fails every call at once (each waited out the 90 s).
    let gone = null;
    ws.addEventListener('close', () => { gone = new Error('the browser closed'); for (const {fail} of pending.values()) fail(gone); pending.clear(); });
    const send = (method, params = {}) => new Promise((ok, fail) => {
      if (gone) return fail(gone);
      const i = ++id, timer = setTimeout(() => { pending.delete(i); fail(new Error(`DevTools ${method} got no answer in 90 s`)); }, 90000);
      pending.set(i, {ok: m => { clearTimeout(timer); ok(m); }, fail: error => { clearTimeout(timer); fail(error); }});
      ws.send(JSON.stringify({id: i, method, params}));
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
    return {send, logs, close, profile, get gone() { return Boolean(gone); }};
  } catch (error) { close(); throw error; } // a browser that started but does not answer is not left running
}

export const DEFAULT_GPU = existsSync('/dev/nvidia0') && existsSync(NVIDIA_EGL) ? 'nvidia' : 'software';
// The iGPU's device nodes (vendor 8086), and whether any process of the browser using `profile` has one open.
const IGPU = (() => { try { return readdirSync('/sys/class/drm').filter(n => /^(card|renderD)\d+$/.test(n) && readFileSync(`/sys/class/drm/${n}/device/vendor`, 'utf8').trim() === '0x8086').map(n => `/dev/dri/${n}`); } catch { return []; } })();
function usesIgpu(profile) {
  for (const pid of readdirSync('/proc').filter(n => /^\d+$/.test(n))) {
    try {
      if (!readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(profile)) continue;
      for (const fd of readdirSync(`/proc/${pid}/fd`)) { try { if (IGPU.includes(readlinkSync(`/proc/${pid}/fd/${fd}`))) return true; } catch {} }
    } catch {}
  }
  return false;
}

// Opens a browser and server. `gpu` is a GPU_MODES key: DEFAULT_GPU unless GPU= says otherwise (see GPU_MODES).
export async function open({gpu = process.env.GPU || DEFAULT_GPU, shots = join(root, 'test/out')} = {}) {
  if (!GPU_MODES[gpu]) throw new Error(`GPU=${gpu}: use nvidia or software (default here: ${DEFAULT_GPU}), or vulkan / egl to opt in to other hardware (egl is the Intel iGPU: don't)`);
  const profileRoot = join(process.env.TEST_TMP || tmpdir(), 'osd-demo-test');
  mkdirSync(profileRoot, {recursive: true});
  // Profiles left by runs that were killed (older than 30 minutes: a run going on alongside keeps its own).
  // Their browsers too, if a runner killed outright (no exit handler) left them running: each runs in its own process
  // group, so it outlives its runner, drawing the demo on the GPU.
  const stale = readdirSync(profileRoot).filter(name => { try { return name.startsWith('chrome-') && Date.now() - statSync(join(profileRoot, name)).mtimeMs > 30 * 60000; } catch { return false; } });
  if (stale.length) {
    for (const pid of readdirSync('/proc').filter(n => /^\d+$/.test(n))) {
      try { const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (stale.some(name => cmd.includes(join(profileRoot, name)))) process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
    for (const name of stale) try { rmSync(join(profileRoot, name), {recursive: true, force: true}); } catch {}
  }
  mkdirSync(shots, {recursive: true});
  const server = await startServer();
  let browser = null, renderer = '';
  // A browser that fails to start or answer leaves nothing running behind the error.
  try {
    browser = await startBrowser(GPU_MODES[gpu], profileRoot);
    // A hardware browser that opened the iGPU (once WebGL is up, below) is closed before it draws a frame there.
    const probe = async () => (await browser.send('Runtime.evaluate', {expression: `(()=>{const g=document.createElement('canvas').getContext('webgl2');const d=g&&g.getExtension('WEBGL_debug_renderer_info');return g?(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'webgl2'):''})()`, returnByValue: true})).result?.result?.value || '';
    if (gpu !== 'software' && gpu !== 'egl') {
      await probe();
      if (usesIgpu(browser.profile)) { console.error(`GPU=${gpu} opened the Intel iGPU: closed it, using software rendering`); browser.close(); gpu = 'software'; browser = await startBrowser(GPU_MODES.software, profileRoot); }
    }
    renderer = `${gpu}: ${await probe() || 'no WebGL'}`;
  } catch (error) { browser?.close(); server.stop(); throw error; }
  const {send, logs} = browser;
  const gone = () => browser.gone;
  let shot = 0;
  const page = {
    renderer, logs, url: server.url, sleep,
    // Its browser died: the runner stops giving this page checks (each failed at once, and one dead browser failed the
    // rest of the run).
    get gone() { return gone(); },
    cdp: send, // raw DevTools protocol, e.g. for profiling

    // Pages open with the world clock at real speed (`day=0`, from 09:00) unless the path sets `day` itself: checks of
    // one scene then see the morning they expect, and only the day-cycle checks run the time-lapse. In software
    // rendering they also draw the 3D view at half resolution (`render=0.5`), the bulk of the CPU's work.
    async goto(path) {
      logs.length = 0;
      let url = path.replace(/^\//, '');
      const add = (name, value) => { if (new RegExp(`[?&]${name}=`).test(url)) return; const [before, hash = ''] = url.split('#'); url = `${before}${before.includes('?') ? '&' : '?'}${name}=${value}${hash ? '#' + hash : ''}`; };
      add('day', 0);
      if (gpu === 'software') add('render', .5);
      await send('Page.navigate', {url: server.url + url}); await sleep(300);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      // A protocol error (the page navigating away mid-call) is not an answer: read as undefined, it passed checks
      // that expect a falsy value.
      if (r.error) throw new Error(`DevTools: ${r.error.message}`);
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    },
    // Polls a page expression until it is truthy; throws with `what` on timeout. An expression that throws counts as
    // not yet (a page still loading has no document element or app objects); the last error is shown on timeout.
    async until(expression, {timeout = 30000, what = expression} = {}) {
      const end = Date.now() + timeout;
      let error = null;
      while (Date.now() < end) { try { if (await page.eval(expression)) return; error = null; } catch (e) { if (gone()) throw e; error = e; } await sleep(100); }
      throw new Error(`timed out waiting for ${what}${error ? ` (last error: ${error.message.split('\n')[0]})` : ''}`);
    },
    // Like a real tap: pointer events first (the booth's idle timer listens for them), then the click.
    async click(selector) { const r = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const o={bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',{...o,buttons:1}));e.dispatchEvent(new PointerEvent('pointerup',o));e.click();return true})()`); if (!r) throw new Error(`no element ${selector}`); },
    async shot(name) {
      const r = await send('Page.captureScreenshot', {format: 'png'});
      const file = join(shots, `${String(++shot).padStart(2, '0')}-${name}.png`);
      writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
  };
  return {page, close() { server.stop(); return browser.close(); }};
}
