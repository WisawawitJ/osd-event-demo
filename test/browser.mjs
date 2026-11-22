// Headless Chromium driven over the DevTools protocol, with no npm dependencies.
// It starts its own static server on a free port; WebGL renders on the NVIDIA GPU when present, else in software.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync} from 'node:fs';
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

async function startServer(site = root) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), String(port), site], {stdio: 'ignore'});
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
  // Named after the runner's process: a profile whose runner is gone is a leftover (see open).
  const profile = mkdtempSync(join(profileRoot, `chrome-${process.pid}-`));
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
    // A call that gets no answer (a hung page or GPU process) fails instead of hanging the whole run.
    // A browser that died fails every call at once (each waited out the 90 s).
    let gone = null;
    const die = reason => { gone = new Error(reason); for (const {fail} of pending.values()) fail(gone); pending.clear(); };
    ws.addEventListener('close', () => die('the browser closed'));
    // A crashed page, its browser still up, is as good as gone (each call waited out its 90 s).
    ws.addEventListener('message', e => { if (JSON.parse(e.data).method === 'Inspector.targetCrashed') die('the page crashed'); });
    const send = (method, params = {}) => new Promise((ok, fail) => {
      if (gone) return fail(gone);
      // No answer in 90 s: the page is hung (a script in an endless loop), and as good as gone (each later call waited
      // the 90 s too).
      const i = ++id, timer = setTimeout(() => { pending.delete(i); const error = new Error(`DevTools ${method} got no answer in 90 s`); fail(error); die(error.message); }, 90000);
      pending.set(i, {ok: m => { clearTimeout(timer); ok(m); }, fail: error => { clearTimeout(timer); fail(error); }});
      ws.send(JSON.stringify({id: i, method, params}));
    });
    await send('Inspector.enable');
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false});
    return {send, logs, close, profile, get gone() { return Boolean(gone); }};
  } catch (error) { close(); throw error; } // a browser that started but does not answer is not left running
}

const DEFAULT_GPU = existsSync('/dev/nvidia0') && existsSync(NVIDIA_EGL) ? 'nvidia' : 'software';
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
// `site`: the folder to serve (default this checkout).
export async function open({gpu = process.env.GPU || DEFAULT_GPU, site = root} = {}) {
  if (!GPU_MODES[gpu]) throw new Error(`GPU=${gpu}: use nvidia or software (default here: ${DEFAULT_GPU}), or vulkan / egl to opt in to other hardware (egl is the Intel iGPU: don't)`);
  const profileRoot = join(tmpdir(), 'osd-demo-test');
  mkdirSync(profileRoot, {recursive: true});
  // Profiles left by runners that are gone (killed outright, with no exit handler), and their browsers: each runs in
  // its own process group, so it outlives its runner, drawing the demo on the GPU. A profile's runner is in its name;
  // one without (older runs) counts as left over after 30 minutes. (By age alone, a long run's live browser was killed:
  // its profile folder stops changing after the first minute.)
  const runnerGone = name => { const pid = /^chrome-(\d+)-/.exec(name)?.[1]; return pid ? !existsSync(`/proc/${pid}`) : Date.now() - statSync(join(profileRoot, name)).mtimeMs > 30 * 60000; };
  const stale = readdirSync(profileRoot).filter(name => { try { return name.startsWith('chrome-') && runnerGone(name); } catch { return false; } });
  if (stale.length) {
    for (const pid of readdirSync('/proc').filter(n => /^\d+$/.test(n))) {
      // Only a browser started with that profile (a `du` or `rm -r` of the folder had it in its arguments too). Chromium
      // rewrites its command line as one space-joined string, so this is a search, not a match of whole arguments.
      try { const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (stale.some(name => cmd.includes(`--user-data-dir=${join(profileRoot, name)}`))) process.kill(Number(pid), 'SIGKILL'); } catch {}
    }
    for (const name of stale) try { rmSync(join(profileRoot, name), {recursive: true, force: true}); } catch {}
  }
  const server = await startServer(site);
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
  const stepped = () => page.eval('typeof window.__engine === "object"').catch(() => false);
  let optionsScript = null;
  const page = {
    renderer, logs, url: server.url, sleep,
    // Its browser died (scripts/shots.mjs then opens a new one).
    get gone() { return gone(); },
    cdp: send, // raw DevTools protocol, e.g. for profiling

    // Pages open with the world clock at real speed (`day=0`, from 09:00) unless the path sets `day` itself. In
    // software rendering they also draw the 3D view at half resolution (`render=0.5`), the bulk of the CPU's work.
    // The console log (`logs`) is the caller's to read and clear.
    async goto(path) {
      let url = path.replace(/^\//, '');
      const add = (name, value) => { if (new RegExp(`[?&]${name}=`).test(url)) return; const [before, hash = ''] = url.split('#'); url = `${before}${before.includes('?') ? '&' : '?'}${name}=${value}${hash ? '#' + hash : ''}`; };
      add('day', 0);
      if (gpu === 'software') add('render', .5);
      // The page reads no settings from its address (the booth just opens it): the query's are handed to it as
      // window.__demoOptions before it loads. (The address keeps them: a different one still loads a fresh page.)
      const query = new URLSearchParams(url.split('#')[0].split('?')[1] || '');
      if (optionsScript) await send('Page.removeScriptToEvaluateOnNewDocument', {identifier: optionsScript});
      optionsScript = (await send('Page.addScriptToEvaluateOnNewDocument', {source: `window.__demoOptions = ${JSON.stringify(Object.fromEntries(query))};`})).result?.identifier;
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
    // Stepping (pages opened with the `manual` and `debug` options: window.__engine in src/viewer/main.js). On a version
    // of the demo with no stepping hook they wait in real time instead.
    // reach(cond, what, ms): steps simulation time until the expression `cond` holds (at most `ms` of it), camera
    // flights waited out; throws with `what` if it never does.
    async reach(cond, what, ms = 1800000) {
      if (!await stepped()) return page.until(cond, {timeout: 60000, what});
      for (let left = ms; ;) {
        const r = await page.eval(`__engine.run(() => (${cond}), ${left})`);
        if (r.held) return;
        if (r.done) throw new Error(`never reached: ${what}`);
        left = r.left;
      }
    },
    // step(ms, {hold}): `ms` of simulation time on, then two frames drawn (CSS animations end at once and the water
    // settles at once on stepped pages, as the screenshots open them). With no stepping, real time passes, and `hold`
    // (default) moves the pointer over the 3D view first so the camera's idle orbit stays off.
    async step(ms, {hold = true} = {}) {
      const frames = () => page.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))').catch(() => {});
      if (await stepped()) {
        for (let left = ms; left > 0;) { const r = await page.eval(`__engine.run(undefined, ${left})`); if (r.done) break; left = r.left; }
        // The frames asked for on the way drawn, then the picture's own frame (drawn until the GPU agrees with itself,
        // then held: see __engine.settle), the page's DOM settled with it.
        await frames();
        if (await page.eval('typeof __engine.settle === "function"')) await page.eval('__engine.settle()');
        await frames();
        return;
      }
      if (hold) await page.eval(`document.querySelector('#viewport')?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1}))`).catch(() => {});
      await sleep(ms + 350);
      await frames();
    },
    // ready(cond): real time while the page loads (the showcase's car park too), then stepped until `cond`. (Stepped
    // during the load, a run took as many ticks as the load took, and its cars and plates came out different.)
    async ready(cond) {
      await page.until("document.querySelector('#status')?.dataset.state === 'ready' && (location.hash === '#explore' || !!window.__parking)", {timeout: 90000, what: 'the page loaded'});
      if (await stepped()) await page.reach(cond, 'the page ready', 120000);
      else await page.until(cond, {timeout: 60000, what: 'the page ready'});
    },
    // Like a real tap: pointer events first (the booth's idle timer listens for them), then the click.
    async click(selector) { const r = await page.eval(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const o={bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true};e.dispatchEvent(new PointerEvent('pointerdown',{...o,buttons:1}));e.dispatchEvent(new PointerEvent('pointerup',o));e.click();return true})()`); if (!r) throw new Error(`no element ${selector}`); },
  };
  return {page, close() { server.stop(); return browser.close(); }};
}
