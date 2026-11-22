// Screenshots of every UI state, per version of the demo, and what changed between two versions.
//
//   npm run shots [words]                   this checkout → shots/<version>/index.html (a contact sheet)
//   npm run shots -- --base <ref> [words]   the same states of <ref> as well (a commit, branch or tag, from a
//                                           temporary checkout), then shots/compare/<ref>..<version>/index.html:
//                                           before, after and the changed pixels, the most changed first
//
// <version> is the commit (`a1b2c3d`), with `+wip` when the checkout has changes not committed. A commit's shots are
// kept and reused (a state photographed once is not photographed again); `+wip` ones are taken again on every run.
// Words limit the run to states that match all of them, e.g. `npm run shots -- --base main parking 1920 en`: th/en
// pick the language, day/night the time, digits the size (`1920` matches the portrait 1080x1920 too), any other word
// part of the state's name (parking, story-04, phone, explore). The states are in scripts/shots-states.mjs.
//
// The same state looks the same in every run: the pages open with the `manual` option, so simulation time moves only
// when this script steps it (window.__engine, main.js), and camera flights are waited out rather than raced; the
// dice are seeded. Versions older than that are stepped by real time instead, so their cars and clocks differ.
// The NVIDIA GPU now and then draws a frame a shade differently (software rendering never does): each picture's frame
// is drawn until two draws agree (__engine.settle), so two runs of one version differ by a few dozen pixels at most;
// `GPU=software` gives exact pictures, about eight times slower. `SHOTS_DIGEST=1` also saves each state's scene
// (every object's visibility, place, materials and lights) as <name>.scene.json, to find what differs between runs.
// One headless browser at a time, on the test harness's default GPU (test/browser.mjs; never the Intel iGPU).
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open} from '../test/browser.mjs';
import {buildSessions, GROUPS, LANGS, SIZES, sizeName} from './shots-states.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = join(root, 'shots');
const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();

// Arguments.
const args = process.argv.slice(2);
const baseAt = args.indexOf('--base');
const baseRef = baseAt >= 0 ? args[baseAt + 1] : null;
if (baseAt >= 0 && !baseRef) {
  console.error('--base needs a commit, branch or tag');
  process.exit(2);
}
const words = args.filter((a, i) => baseAt < 0 || (i !== baseAt && i !== baseAt + 1)).map((w) => w.toLowerCase());

// The plan: every state the words pick, as page loads.
const sessions = buildSessions();
const shotName = (s, st) => `${sizeName(s.size)}-${s.lang}-${s.tod}-${st.state}`;
// A word is a language (th, en), a time of day (day, night), a size or part of one, or else part of the state's name
// (`en` alone matched "energy" and "sent").
const matches = (s, st, w) =>
  LANGS.includes(w)
    ? s.lang === w
    : w === 'day' || w === 'night'
      ? s.tod === w
      : /^\d+(x\d*)?$/.test(w)
        ? sizeName(s.size).includes(w)
        : st.state.includes(w);
const wanted = new Set(
  sessions.flatMap((s) =>
    s.steps.filter((st) => st.state && words.every((w) => matches(s, st, w))).map((st) => shotName(s, st)),
  ),
);
if (!wanted.size) {
  console.error(`no state matches ${words.join(' ')}`);
  process.exit(2);
}
const stateOrder = new Map();
for (const s of sessions)
  for (const st of s.steps) if (st.state && !stateOrder.has(st.state)) stateOrder.set(st.state, stateOrder.size);

// --- Taking a version's shots ---------------------------------------------------------------------------------------
// Photographs the wanted states not in `have` into `out` from the demo served out of `site`. Returns what it took.
async function capture(site, out, have) {
  const todo = new Set([...wanted].filter((n) => !have.has(n)));
  const plan = sessions
    .map((s) => ({s, take: s.steps.map((st) => Boolean(st.state) && todo.has(shotName(s, st)))}))
    .map((x) => ({...x, last: x.take.lastIndexOf(true)}))
    .filter((x) => x.last >= 0);
  const total = plan.reduce((n, x) => n + x.take.filter(Boolean).length, 0);
  const shots = [],
    failures = [],
    time = {load: 0, steps: 0, capture: 0};
  if (!total) return {shots, failures};
  console.log(`${total} states in ${plan.length} page loads → ${relative(root, out)}`);
  mkdirSync(out, {recursive: true});
  let opened = null;
  const page = async () => {
    if (!opened || opened.page.gone) {
      await opened?.close();
      opened = await open({site});
      console.log(`WebGL: ${opened.page.renderer}`);
    }
    return opened.page;
  };
  for (const {s, take, last} of plan) {
    const p = await page();
    const [width, height] = s.size;
    await p.cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: width < 600});
    await p
      .cdp('Storage.clearDataForOrigin', {origin: new URL(p.url).origin, storageTypes: 'local_storage'})
      .catch(() => {});
    // The language is chosen before the page's own scripts run (as a visitor's earlier choice would be). CSS
    // animations and transitions end at once: on real time, a run caught them part way, a different part each time.
    const source = `try{localStorage.setItem('osd-demo-language',${JSON.stringify(s.lang)})}catch{}
      addEventListener('DOMContentLoaded',()=>document.head.append(Object.assign(document.createElement('style'),{textContent:'*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}'})));`;
    const script = (await p.cdp('Page.addScriptToEvaluateOnNewDocument', {source})).result?.identifier;
    p.logs.length = 0;
    let i = 0;
    try {
      let t = Date.now();
      await p.goto(s.path);
      await p.ready(s.ready);
      time.load += Date.now() - t;
      for (; i <= last; i++) {
        const st = s.steps[i];
        t = Date.now();
        await st.run(p);
        time.steps += Date.now() - t;
        if (!take[i]) continue;
        t = Date.now();
        const name = shotName(s, st),
          r = await p.cdp('Page.captureScreenshot', {format: 'png', optimizeForSpeed: true});
        const at = await p.eval('window.__engine?.now()').catch(() => null); // simulation time (ms), stepped pages
        if (process.env.SHOTS_DIGEST)
          writeFileSync(
            join(out, `${name}.scene.json`),
            await p.eval(
              `JSON.stringify((()=>{const out=[];const seen=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true};__scene.traverse(o=>{if(!o.isMesh&&!o.isLight)return;const m=[].concat(o.material||[]);const w=o.getWorldPosition(new o.position.constructor());out.push([o.name||o.type,seen(o),w.x.toFixed(2)+','+w.y.toFixed(2)+','+w.z.toFixed(2),m.map(x=>x&&(x.type+':'+(x.clippingPlanes||[]).length+':'+(x.clippingPlanes||[]).map(p=>p.constant.toFixed(2)).join('/')+':o'+(x.opacity??1).toFixed(3)+':e'+(x.emissiveIntensity??0).toFixed(3))).join(','),o.isLight?(o.intensity.toFixed(3)+':'+o.castShadow):''].join('|'))});return out.sort()})())`,
            ),
          );
        if (!r.result?.data) throw new Error(`no screenshot (${r.error?.message || 'empty'})`);
        writeFileSync(join(out, `${name}.png`), Buffer.from(r.result.data, 'base64'));
        shots.push({
          name,
          file: `${name}.png`,
          at,
          group: st.group,
          state: st.state,
          label: st.label,
          size: sizeName(s.size),
          lang: s.lang,
          tod: s.tod,
        });
        time.capture += Date.now() - t;
        console.log(`✓ ${name}`);
      }
    } catch (error) {
      // The rest of the page's states depend on this one: each is listed as not captured.
      const message = error.message.split('\n')[0];
      for (; i <= last; i++)
        if (take[i]) {
          const name = shotName(s, s.steps[i]);
          failures.push({name, error: message});
          console.log(`✗ ${name}: ${message}`);
        }
    } finally {
      if (script) await p.cdp('Page.removeScriptToEvaluateOnNewDocument', {identifier: script}).catch(() => {});
      await p.cdp('Page.navigate', {url: 'about:blank'}).catch(() => {});
    }
    const errors = p.logs.filter(
      (l) => !/GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils|KHR_parallel_shader_compile/.test(l),
    );
    if (errors.length) console.log(`  console (${s.path}): ${errors.slice(0, 3).join(' | ').slice(0, 300)}`);
  }
  await opened?.close();
  console.log(
    `time: page loads ${(time.load / 1000).toFixed(0)} s, steps ${(time.steps / 1000).toFixed(0)} s, screenshots ${(time.capture / 1000).toFixed(0)} s`,
  );
  return {shots, failures};
}

// A version's folder: its manifest (what it holds) and contact sheet. A commit's shots are reused; `+wip` starts over.
async function version(label, {commit, site, wip}) {
  const out = join(SHOTS, label),
    manifestFile = join(out, 'manifest.json');
  if (wip) rmSync(out, {recursive: true, force: true});
  const manifest = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : {label, commit, shots: [], failures: []};
  const have = new Set(manifest.shots.map((s) => s.name));
  const {shots, failures} = await capture(site, out, have);
  const taken = new Set(shots.map((s) => s.name));
  manifest.shots = [...manifest.shots.filter((s) => !taken.has(s.name)), ...shots];
  manifest.failures = [
    ...manifest.failures.filter((f) => !taken.has(f.name) && !failures.some((g) => g.name === f.name)),
    ...failures,
  ];
  manifest.date = new Date().toISOString();
  mkdirSync(out, {recursive: true});
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  writeFileSync(join(out, 'index.html'), contactSheet(manifest));
  return manifest;
}

// --- Pages --------------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const LANG_NAME = {th: 'ไทย (TH)', en: 'English (EN)'};
const sizeOrder = SIZES.map(sizeName);
const byState = (a, b) =>
  (stateOrder.get(a.state) ?? 1e9) - (stateOrder.get(b.state) ?? 1e9) ||
  sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size) ||
  LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang) ||
  a.tod.localeCompare(b.tod);
const STYLE = `:root{--bg:#f4f5f2;--card:#fff;--ink:#1d2a30;--mute:#61707a;--line:#d9dedb;--accent:#0f7b6c;--bad:#b3261e;--warn:#a15c00}
@media (prefers-color-scheme:dark){:root{--bg:#12181c;--card:#1b2328;--ink:#e3e9ec;--mute:#93a2ab;--line:#2c373e;--accent:#4fc1ad;--bad:#f2b8b5;--warn:#f0b96b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,"Noto Sans Thai",sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
h1{font-size:18px;margin:0 12px 0 0}header p{margin:0;color:var(--mute)}.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips label{border:1px solid var(--line);border-radius:999px;padding:2px 10px;cursor:pointer;user-select:none;background:var(--card)}
.chips input{margin:0 6px 0 0;accent-color:var(--accent)}input[type=search]{padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);min-width:200px}
main{padding:8px 16px 40px}h2{font-size:16px;margin:26px 0 10px}h2 small{color:var(--mute);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
.pics{display:grid;grid-template-columns:repeat(var(--n,1),1fr);gap:2px;background:#0b0f12}.pics a{display:flex;align-items:center;justify-content:center;height:200px;position:relative}
.pics img{max-width:100%;max-height:200px;display:block}.pics a span{position:absolute;left:4px;top:4px;font-size:11px;background:#000a;color:#fff;padding:0 5px;border-radius:4px}
figcaption{padding:8px 10px;display:flex;flex-direction:column;gap:2px}figcaption span{color:var(--mute)}figcaption code{font-size:11px;color:var(--mute);word-break:break-all}
.pct{font-weight:600}.pct.same{color:var(--mute);font-weight:400}.pct.changed{color:var(--warn)}.pct.new,.pct.gone{color:var(--bad)}
.failed{border:1px solid var(--bad);border-radius:8px;padding:8px 12px;margin-top:14px}.failed h2{color:var(--bad);margin:0 0 6px}.failed li{font-family:monospace;font-size:12px}
.hide{display:none}dialog{max-width:96vw;max-height:96vh;padding:0;border:0;background:var(--card);color:var(--ink);border-radius:8px}
dialog .bar{display:flex;gap:8px;align-items:center;padding:8px 10px;flex-wrap:wrap}dialog .bar button{padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);cursor:pointer}
dialog .bar button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}dialog .view{position:relative;line-height:0}dialog .view img{max-width:94vw;max-height:84vh;display:block}
dialog .view .top{position:absolute;inset:0}dialog .view .top img{width:100%;height:100%}`;
const filters = (items, extra = '') =>
  `${['size', 'lang', 'tod']
    .map((key) => {
      const values = key === 'size' ? sizeOrder : key === 'lang' ? LANGS : ['day', 'night'];
      const label = (v) => (key === 'size' ? v.replace('x', '×') : key === 'lang' ? v.toUpperCase() : v);
      return `<span class="chips" data-key="${key}">${values
        .filter((v) => items.some((s) => s[key] === v))
        .map((v) => `<label><input type="checkbox" value="${esc(v)}" checked>${esc(label(v))}</label>`)
        .join('')}</span>`;
    })
    .join('')}${extra}<input type="search" placeholder="Filter by name…" aria-label="Filter by name">`;
const FILTER_SCRIPT = `const apply=()=>{const on=k=>new Set([...document.querySelectorAll('.chips[data-key="'+k+'"] input:checked')].map(i=>i.value));const s=on('size'),l=on('lang'),t=on('tod'),q=document.querySelector('input[type=search]').value.toLowerCase().split(/\\s+/).filter(Boolean);const same=document.querySelector('#show-same');
for(const f of document.querySelectorAll('figure'))f.classList.toggle('hide',!(s.has(f.dataset.size)&&l.has(f.dataset.lang)&&t.has(f.dataset.tod)&&q.every(w=>f.dataset.name.includes(w))&&(!same||same.checked||f.dataset.kind!=='same')));
for(const sec of document.querySelectorAll('section'))sec.classList.toggle('hide',!sec.querySelector('figure:not(.hide)'));};
document.addEventListener('input',apply);apply();`;
const failed = (list) =>
  list.length
    ? `<div class="failed"><h2>Not captured</h2><ul>${list.map((f) => `<li>${esc(f.name)}: ${esc(f.error)}</li>`).join('')}</ul></div>`
    : '';
const figureData = (s) => `data-size="${s.size}" data-lang="${s.lang}" data-tod="${s.tod}" data-name="${esc(s.name)}"`;
const caption = (s) =>
  `<b>${esc(s.label)}</b><span>${s.size.replace('x', '×')} · ${esc(LANG_NAME[s.lang])} · ${s.tod}</span>`;
const page = (
  title,
  head,
  body,
  script = '',
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body>
<header>${head}</header><main>${body}</main><script>${FILTER_SCRIPT}${script}</script></body></html>\n`;

function contactSheet(m) {
  const shots = [...m.shots].sort(byState);
  const sections = Object.entries(GROUPS)
    .map(([g, title]) => {
      const items = shots.filter((s) => s.group === g);
      return items.length
        ? `<section><h2>${esc(title)} <small>${items.length}</small></h2><div class="grid">${items
            .map(
              (s) => `
  <figure ${figureData(s)}><div class="pics"><a href="${esc(s.file)}" target="_blank"><img src="${esc(s.file)}" loading="lazy" alt="${esc(s.label)}"></a></div>
    <figcaption>${caption(s)}<code>${esc(s.file)}</code></figcaption></figure>`,
            )
            .join('')}</div></section>`
        : '';
    })
    .join('');
  return page(
    `Screenshots ${m.label}`,
    `<h1>Screenshots · ${esc(m.label)}</h1><p>${shots.length} states${m.failures.length ? ` · ${m.failures.length} not captured` : ''} · ${esc(m.date ?? '')}</p>${filters(shots)}`,
    failed(m.failures) + sections,
  );
}

// Before / after: the changed pixels worked out in the browser (a canvas), the most changed first.
const DIFF_PAGE = `async (before, after) => {
  const load = src => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('cannot load ' + src)); i.src = src; });
  const [a, b] = await Promise.all([load(before), load(after)]);
  if (a.width !== b.width || a.height !== b.height) return {changed: 1, pixels: Math.max(a.width * a.height, b.width * b.height)};
  const w = a.width, h = a.height, c = new OffscreenCanvas(w, h), g = c.getContext('2d', {willReadFrequently: true});
  g.drawImage(a, 0, 0); const pa = g.getImageData(0, 0, w, h).data;
  g.drawImage(b, 0, 0); const pb = g.getImageData(0, 0, w, h).data;
  const out = g.createImageData(w, h), o = out.data;
  let n = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    if (d > 24) { n++; o[i] = 230; o[i + 1] = 30; o[i + 2] = 60; o[i + 3] = 255; }
    else { const y = (pb[i] * .3 + pb[i + 1] * .59 + pb[i + 2] * .11) * .3 + 178; o[i] = o[i + 1] = o[i + 2] = y; o[i + 3] = 255; }
  }
  if (!n) return {changed: 0, pixels: 0};
  g.putImageData(out, 0, 0);
  const blob = await c.convertToBlob({type: 'image/png'});
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return {changed: n / (w * h), pixels: n, png: btoa(s)};
}`;
async function compare(before, after) {
  const out = join(SHOTS, 'compare', `${before.label}..${after.label}`);
  rmSync(out, {recursive: true, force: true});
  mkdirSync(out, {recursive: true});
  const rel = (m, s) => `../../${m.label}/${s.file}`;
  const was = new Map(before.shots.filter((s) => wanted.has(s.name)).map((s) => [s.name, s]));
  const now = new Map(after.shots.filter((s) => wanted.has(s.name)).map((s) => [s.name, s]));
  const items = [];
  console.log(`comparing ${was.size} before with ${now.size} after`);
  const opened = await open();
  try {
    const p = opened.page;
    await p.goto('shots/');
    for (const name of new Set([...was.keys(), ...now.keys()])) {
      const a = was.get(name),
        b = now.get(name),
        s = b ?? a;
      const item = {
        ...s,
        before: a && rel(before, a),
        after: b && rel(after, b),
        kind: !a ? 'new' : !b ? 'gone' : 'same',
        changed: 0,
      };
      if (a && b) {
        const r = await p.eval(
          `(${DIFF_PAGE})(${JSON.stringify(`/shots/${before.label}/${a.file}`)}, ${JSON.stringify(`/shots/${after.label}/${b.file}`)})`,
        );
        item.changed = r.changed;
        item.pixels = r.pixels;
        if (r.changed) {
          item.kind = 'changed';
          item.diff = `${name}.diff.png`;
          if (r.png) writeFileSync(join(out, item.diff), Buffer.from(r.png, 'base64'));
        }
      }
      items.push(item);
    }
  } finally {
    await opened.close();
  }
  const rank = {gone: 0, new: 1, changed: 2, same: 3};
  items.sort((x, y) => rank[x.kind] - rank[y.kind] || y.changed - x.changed || byState(x, y));
  const count = (k) => items.filter((i) => i.kind === k).length;
  const pct = (i) =>
    i.kind === 'new'
      ? 'new'
      : i.kind === 'gone'
        ? 'gone'
        : i.kind === 'same'
          ? 'no change'
          : i.changed < 0.001
            ? `${i.pixels} pixels changed`
            : `${(i.changed * 100).toFixed(i.changed < 0.01 ? 2 : 1)}% of pixels changed`;
  const pic = (src, tag) =>
    src
      ? `<a href="${esc(src)}" data-${tag}="${esc(src)}"><img src="${esc(src)}" loading="lazy" alt=""><span>${tag}</span></a>`
      : `<a><span>${tag}: none</span></a>`;
  const body = `${failed([...after.failures, ...before.failures.map((f) => ({...f, name: `${f.name} (before)`}))].filter((f) => wanted.has(f.name.replace(' (before)', ''))))}
<section><div class="grid">${items
    .map(
      (i) => `
  <figure ${figureData(i)} data-kind="${i.kind}" data-before="${esc(i.before ?? '')}" data-after="${esc(i.after ?? '')}" data-diff="${esc(i.diff ?? '')}">
    <div class="pics" style="--n:${i.diff ? 3 : 2}">${pic(i.before, 'before')}${pic(i.after, 'after')}${i.diff ? pic(i.diff, 'diff') : ''}</div>
    <figcaption><span class="pct ${i.kind}">${pct(i)}</span>${caption(i)}<code>${esc(i.name)}</code></figcaption></figure>`,
    )
    .join('')}</div></section>
<dialog><div class="bar"><b></b><button data-mode="before">Before</button><button data-mode="after">After</button><button data-mode="diff">Changed pixels</button><button data-mode="swipe">Swipe</button><input type="range" min="0" max="100" value="50" aria-label="Swipe"><button data-close>Close (Esc)</button></div><div class="view"></div></dialog>`;
  const script = `
const dlg=document.querySelector('dialog'),view=dlg.querySelector('.view'),range=dlg.querySelector('input[type=range]');let cur=null;
const show=mode=>{const f=cur.dataset,src=m=>f[m]||'';dlg.querySelectorAll('[data-mode]').forEach(b=>{b.disabled=!(b.dataset.mode==='swipe'?src('before')&&src('after'):src(b.dataset.mode));b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});
range.hidden=mode!=='swipe';
view.innerHTML=mode==='swipe'?'<img src="'+src('before')+'"><div class="top" style="clip-path:inset(0 0 0 '+range.value+'%)"><img src="'+src('after')+'"></div>':'<img src="'+(src(mode)||src('after')||src('before'))+'">';dlg.dataset.mode=mode;};
document.querySelectorAll('figure').forEach(f=>f.querySelector('.pics').addEventListener('click',e=>{e.preventDefault();cur=f;dlg.querySelector('b').textContent=f.querySelector('figcaption b').textContent+' · '+f.querySelector('.pct').textContent;dlg.showModal();show(e.target.closest('[data-diff]')?'diff':f.dataset.diff?'swipe':'after');}));
dlg.addEventListener('click',e=>{const b=e.target.closest('[data-mode]');if(b)show(b.dataset.mode);if(e.target.closest('[data-close]'))dlg.close();});
range.addEventListener('input',()=>{const t=view.querySelector('.top');if(t)t.style.clipPath='inset(0 0 0 '+range.value+'%)';});`;
  const title = `${before.label} → ${after.label}`;
  const unstepped = [before, after]
    .filter((m) => m.shots.length && m.shots.every((s) => s.at == null))
    .map((m) => m.label);
  const note = unstepped.length
    ? `<p><b>${esc(unstepped.join(', '))}</b> ran on real time (older than the stepped screenshots): its cars, clocks and plates differ anyway.</p>`
    : '';
  const head = `<h1>${esc(title)}</h1>${note}<p>${count('changed')} changed · ${count('same')} the same${count('new') ? ` · ${count('new')} new` : ''}${count('gone') ? ` · ${count('gone')} gone` : ''} · click a picture to swipe between them</p>${filters(items, '<span class="chips"><label><input type="checkbox" id="show-same">show unchanged</label></span>')}`;
  writeFileSync(join(out, 'index.html'), page(title, head, body, script));
  return join(out, 'index.html');
}

// --- Main ---------------------------------------------------------------------------------------------------------
const started = Date.now();
const short = (ref) => git('rev-parse', '--short', `${ref}^{commit}`);
const head = short('HEAD'),
  wip = git('status', '--porcelain', '--', '.', ':!shots').length > 0;
const afterLabel = wip ? `${head}+wip` : head;
let before = null;
const kept = (label) =>
  existsSync(join(SHOTS, label, 'manifest.json'))
    ? JSON.parse(readFileSync(join(SHOTS, label, 'manifest.json'), 'utf8'))
    : null;
const isCommit = (ref) => {
  try {
    short(ref);
    return true;
  } catch {
    return false;
  }
};
if (baseRef && !isCommit(baseRef)) {
  // Not a commit: a folder of shots/ (a `+wip` run, or one kept under another name), compared as it is.
  before = kept(baseRef);
  if (!before) {
    console.error(`--base ${baseRef}: no such commit, or folder in shots/`);
    process.exit(2);
  }
  if (baseRef === afterLabel) {
    console.error(`--base ${baseRef}: this run takes it again; keep it under another name first`);
    process.exit(2);
  }
  before.label = baseRef;
} else if (baseRef) {
  const commit = short(baseRef),
    cached = kept(commit);
  console.log(`\nbefore: ${baseRef} (${commit})`);
  if (cached && [...wanted].every((n) => cached.shots.some((s) => s.name === n))) before = cached;
  else if (commit === head && !wip) before = await version(commit, {commit, site: root});
  else {
    // The older version from a checkout of its own, served on its own (its pages, scripts and model).
    const site = join(tmpdir(), `osd-demo-shots-${commit}`);
    rmSync(site, {recursive: true, force: true});
    git('worktree', 'add', '--detach', site, commit);
    try {
      before = await version(commit, {commit, site});
    } finally {
      git('worktree', 'remove', '--force', site);
    }
  }
}
console.log(`\nafter: this checkout (${head}${wip ? ', with changes not committed' : ''})`);
const after = await version(afterLabel, {commit: head, site: root, wip});
const seconds = Math.round((Date.now() - started) / 1000);
console.log(
  `\n${after.shots.filter((s) => wanted.has(s.name)).length}/${wanted.size} states in ${seconds} s\n${join(SHOTS, after.label, 'index.html')}`,
);
if (before) console.log(await compare(before, after));
process.exit(after.failures.some((f) => wanted.has(f.name)) ? 1 : 0);
