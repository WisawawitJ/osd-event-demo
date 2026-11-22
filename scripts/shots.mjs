// Screenshots of every UI state, for reviewing the demo by eye: `node scripts/shots.mjs [words]`.
// Saves PNGs to shots/<time>/ with an index.html contact sheet (grouped, captioned with state, size and language).
// Words limit the run to shots that match all of them, e.g. `node scripts/shots.mjs parking 1920x1080 en`. Names look
// like 1920x1080-en-day-parking-tab-requests: th/en pick the language, day/night the time, digits the size (`1920`
// alone matches the portrait 1080x1920 too), any other word part of the state (parking, story-04, phone, explore).
// One headless browser at a time, on the test harness's default GPU (test/browser.mjs; never the Intel iGPU).
// The booth size (1920×1080) gets every state in Thai and English; the other sizes get each stop, the explore page,
// the visitor's phone and story steps 1, 4, 6 and 7.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {open} from '../test/browser.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const words = process.argv.slice(2).map(w => w.toLowerCase());
const started = Date.now();
const pad = n => String(n).padStart(2, '0');
const now = new Date(), stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
const OUT = join(root, 'shots', stamp);

// Screen sizes: the booth first (it gets the full set).
const BOOTH = [1920, 1080];
const SIZES = [BOOTH, [1080, 1920], [1366, 768], [768, 1024], [390, 844]];
const LANGS = ['th', 'en'];
const sizeName = ([w, h]) => `${w}x${h}`;

// Page states to wait for before each screenshot.
const LOADED = "document.querySelector('#status')?.dataset.state === 'ready'";
const UP = `${LOADED} && !!window.__parking`;
const STILL = "!document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')";
const IDLE = `${UP} && ${STILL}`;
const PARKING = `${IDLE} && __parking.active`;
const NIGHT = `document.documentElement.dataset.night === 'true'`;
const DAY = `document.documentElement.dataset.night === 'false'`;
const VISITOR = 'ชูใจ ใฝ่รู้', UNKNOWN_PLATE = '2ฒษ 9077';
const STORY_REQUEST = `__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)})`;
const STORY_ALERT_OPEN = `__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate===${JSON.stringify(UNKNOWN_PLATE)})`;
const waiting = i => `__parking.story.running && __parking.story.index===${i} && __parking.story.waitingForNext`;
const TIMES = {day: '10:00', night: '20:00'};
const url = (params, hash = '') => `?debug=1&warm=0&${params}${hash}`;

const GROUPS = {
  stops: 'Showcase stops',
  explore: 'Explore page',
  modes: 'Tour, kiosk and timeline',
  console: 'Parking console',
  phone: 'Visitor phone',
  gate: 'Gate alerts and cameras',
  story: 'Parking story, guided (Next by Next)',
  rejected: 'Parking story, request rejected at step 4',
  auto: 'Parking story, auto-advance',
};

// A session is one page load: `steps` run in order, and each step with a `state` is photographed once it has run.
// `p` is the page from test/browser.mjs.
const sessions = [];
const session = (size, lang, tod, path, ready, steps) => sessions.push({size, lang, tod, path, ready, steps});
const step = (group, state, label, run = async () => {}) => ({group, state, label, run});
const move = run => ({run}); // a step that only gets the page somewhere, photographed by none

async function settle(p, ms = 400, {hold = true} = {}) {
  // A pointer move over the 3D view counts as use: the camera's idle orbit (after 20 s) stays off, so every stop is
  // seen from its own pose. (It is not a tap: nothing stops, pauses or is picked.) Not in the tour or the kiosk, whose
  // orbit is part of what they look like.
  if (hold) await p.eval(`document.querySelector('#viewport')?.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,buttons:1}))`).catch(() => {});
  await p.sleep(ms);
  await p.eval('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))').catch(() => {});
}
const at = (p, cond, what, timeout = 30000) => p.until(cond, {timeout, what});
const dock = id => async p => {
  await p.click(`[data-destination="${id}"]`);
  await at(p, `document.body.dataset.tourDestination===${JSON.stringify(id)} && ${STILL}${id === 'parking' ? ' && __parking.active' : ''}`, `landed at ${id}`);
  await settle(p, id === 'overview' ? 400 : 900); // the stop's effects fade in; the car park's layout change animates
};

// Showcase: every stop (and the explore page) by day and by night.
function stops(size, lang, tod, {extras = false} = {}) {
  const steps = [step('stops', 'stop-overview', 'Overview', async p => settle(p, 600))];
  for (const [id, label] of [['meeting', 'Meeting room'], ['pond', 'Fish pond'], ['energy', 'Energy (rooftop)'], ['parking', 'Car park']]) steps.push(step('stops', `stop-${id}`, label, dock(id)));
  if (extras) {
    steps.push(step('modes', 'timeline-paused', 'Timeline paused (car park)', async p => {
      await p.click('#day-pause');
      await at(p, `document.querySelector('#day-pause').getAttribute('aria-pressed')==='true'`, 'paused');
      await settle(p);
    }));
  }
  session(size, lang, tod, url(`speed=30&time=${TIMES[tod]}`), `${IDLE} && ${tod === 'night' ? NIGHT : DAY}`, steps);
}
function explore(size, lang, tod, {extras = false} = {}) {
  const steps = [step('explore', 'explore', 'Explore page', async p => settle(p, 800))];
  if (extras) {
    steps.push(step('explore', 'explore-details', 'Explore page, simulation details open', async p => { await p.eval(`(()=>{const d=document.querySelector('.simulation-details');if(d)d.open=true})()`); await settle(p); }));
    steps.push(step('explore', 'explore-stairs', 'Explore page, stairs view', async p => { await p.click('#stairs'); await settle(p, 1500); }));
  }
  // `explore=1` (read by nothing) keeps the URL apart from the showcase's: a hash-only change does not reload.
  session(size, lang, tod, url(`explore=1&speed=30&time=${TIMES[tod]}`, '#explore'), `${LOADED} && ${tod === 'night' ? NIGHT : DAY}`, steps);
}

// The parking console in free play: tabs, a request, the visitor's phone and an unknown car at the gate.
// At speed 5: an unknown car waits 45 s of demo time for an answer (9 s here), long enough to photograph.
function parkingFree(size, lang, tod, {full = true, night = false} = {}) {
  const tab = (id, label) => step('console', `parking-tab-${id}`, label, async p => { await p.click(`[data-tab="${id}"]`); await settle(p, 500); });
  const phoneOpen = step('phone', 'parking-phone-form', 'Phone open: the request form', async p => {
    if (!await p.eval('document.body.classList.contains("phone-open")')) await p.click('[data-bar="phone"]');
    await at(p, `!!document.querySelector('#pk-phone .ph-frame')`, 'the phone');
    await settle(p, 500);
  });
  const alert = step('gate', 'parking-unknown-car-alert', 'Unknown car at the barrier: alert pop-up, camera card, Gate tab', async p => {
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await at(p, `__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111') && document.querySelector('[data-pop="open"]') && document.querySelector('.pk-feed:not([hidden])')`, 'the alert and its pop-up');
    await settle(p, 500);
  });
  let steps;
  if (night) steps = [tab('gate', 'Gate tab'), alert, move(async p => { await p.click('[data-pop="deny"]'); }), phoneOpen];
  else if (!full) steps = [phoneOpen];
  else {
    steps = [
      step('console', 'parking-tab-overview', 'Overview tab', async p => settle(p, 500)),
      tab('requests', 'Requests tab'),
      step('console', 'parking-request-detail', 'Request detail (pending: Approve / Reject)', async p => {
        await p.click('[data-req-filter="all"]');
        const id = await p.eval(`(__parking.sim.state.requests.find(q=>q.status==='pending')||__parking.sim.state.requests[0])?.id`);
        if (!id) throw new Error('no request to open');
        await p.click(`[data-request="${id}"]`);
        await at(p, `!!document.querySelector('.pk-detail-head')`, 'the request detail');
        await settle(p);
      }),
      step('console', 'parking-request-reject-form', 'Request detail: Reject with a reason', async p => {
        if (!await p.eval(`!!document.querySelector('[data-act="reject"]')`)) throw new Error('the request is not pending');
        await p.click('[data-act="reject"]');
        await at(p, `!!document.querySelector('.pk-reject textarea')`, 'the reject form');
        await settle(p);
      }),
      step('console', 'parking-request-detail-approved', 'Request detail (approved: QR, Revoke)', async p => {
        await p.click('[data-act="reject-cancel"]').catch(() => {});
        await p.click('[data-act="back"]');
        await p.click('[data-req-filter="approved"]');
        const id = await p.eval(`__parking.sim.state.requests.find(q=>q.status==='approved')?.id`);
        if (!id) throw new Error('no approved request');
        await p.click(`[data-request="${id}"]`);
        await at(p, `!!document.querySelector('.pk-detail-head')`, 'the request detail');
        await settle(p);
      }),
      move(async p => { await p.click('[data-act="back"]'); }),
      tab('vehicles', 'Vehicles tab'),
      tab('gate', 'Gate tab'),
      tab('reports', 'Reports tab'),
      alert,
      move(async p => { await p.click('[data-pop="deny"]'); await at(p, `!__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`, 'the alert answered'); }),
      step('gate', 'parking-camera-card', 'Plate camera card (a registered car at the barrier)', async p => {
        await p.click('[data-tab="gate"]');
        await at(p, `!document.querySelector('.pk-feed:not([hidden])') && __parking.sim.state.gate==='closed'`, 'the barrier quiet', 30000);
        await p.click('[data-sim="registered"]');
        await at(p, `!!document.querySelector('.pk-feed:not([hidden])')`, 'the camera card', 30000);
        await settle(p, 300);
      }),
      phoneOpen,
      step('phone', 'parking-phone-form-error', 'Phone: Send with fields missing', async p => { await p.click('[data-ph="submit"]'); await at(p, `!!document.querySelector('#pk-phone .ph-error')`, 'the error'); await settle(p, 300); }),
      step('phone', 'parking-phone-form-filled', 'Phone: form filled in', async p => {
        await p.eval(`(()=>{const q=n=>document.querySelector('#pk-phone [name='+n+']');
          const set=(n,v)=>{const e=q(n);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
          set('name','สมชาย ใจดี');set('email','somchai@example.com');set('contact','host.demo@osd.example');set('company','บริษัท ตัวอย่าง จำกัด');set('phone','081-234-5678');set('plate','3ขค 5150');
          set('province','กรุงเทพมหานคร');const c=q('consent');c.checked=true;c.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await settle(p, 300);
      }),
      step('phone', 'parking-phone-sent', 'Phone: request sent (confirmation)', async p => {
        await p.click('[data-ph="submit"]');
        await at(p, `document.querySelector('#pk-phone .ph-screen')?.dataset.screen==='sent' && !!document.querySelector('#pk-phone .ph-receipt')`, 'the confirmation');
        await settle(p, 300);
      }),
      step('phone', 'parking-phone-mail-banner', 'Phone: email notification after approval', async p => {
        await p.click('[data-tab="requests"]');
        await p.click('[data-req-filter="all"]');
        const id = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name==='สมชาย ใจดี')?.id`);
        await p.click(`[data-request="${id}"]`);
        await p.click('[data-act="approve"]');
        await at(p, `!!document.querySelector('#pk-phone .ph-banner')`, 'the email banner', 40000);
        await settle(p, 300);
      }),
      step('phone', 'parking-phone-mail-ticket', 'Phone: email with the parking ticket', async p => {
        await p.click('[data-ph="inbox"]');
        await at(p, `!!document.querySelector('#pk-phone .ph-ticket')`, 'the ticket');
        await settle(p, 300);
      }),
    ];
  }
  session(size, lang, tod, url(`dest=parking&speed=5&time=${TIMES[tod]}`), PARKING, steps);
}

// The guided story (Next by Next): each step once it has run and waits for Next; steps 4 and 7 also at their cue.
// `only` limits the photographs to those states (the story still runs through the steps before them).
const STORY_STATES = [
  ['story-01', 'Step 1: the visitor fills in the form', waiting(0)],
  ['story-02', 'Step 2: plate photo read, request sent', waiting(1)],
  ['story-03', 'Step 3: the request in the console', waiting(2)],
  ['story-04a-approve-cue', 'Step 4: Approve cue', `${waiting(3)} && ${STORY_REQUEST}?.status==='pending'`],
  ['story-04b-approved', 'Step 4: approved, ticket emailed', `${waiting(3)} && ${STORY_REQUEST}?.status==='approved'`],
  ['story-05', 'Step 5: the ticket email on the phone', waiting(4)],
  ['story-06', 'Step 6: the visitor\'s car drives in', waiting(5)],
  ['story-07a-alert-cue', 'Step 7: unknown car, Deny cue', `${waiting(6)} && ${STORY_ALERT_OPEN}`],
  ['story-07b-denied', 'Step 7: unknown car denied', `${waiting(6)} && !${STORY_ALERT_OPEN}`],
  ['story-08', 'Step 8: staff cars come and go', waiting(7)],
  ['story-09', 'Step 9: reports and the audit log', waiting(8)],
  ['story-10', 'Step 10: the visitor leaves', waiting(9)],
];
function storyGuided(size, lang, only = null) {
  const steps = [];
  STORY_STATES.forEach(([state, label, cond], i) => {
    const run = async p => {
      if (i > 0) await p.click('[data-bar="next"]');
      await at(p, cond, label, 60000);
      await settle(p, 500);
    };
    steps.push(!only || only.includes(state) ? step('story', state, label, run) : move(run));
  });
  session(size, lang, 'day', url('dest=parking&speed=30&story=1&auto=0'), 'window.__parking && __parking.story.running', steps);
}
function storyRejected(size, lang) {
  const steps = [];
  for (let i = 0; i < 3; i++) steps.push(move(async p => { if (i) await p.click('[data-bar="next"]'); await at(p, waiting(i), `step ${i + 1}`, 60000); }));
  steps.push(
    move(async p => { await p.click('[data-bar="next"]'); await at(p, `${waiting(3)} && !!document.querySelector('[data-act="reject"]')`, 'the approve cue', 60000); }),
    step('rejected', 'story-rejected-04-reject-form', 'Step 4: the presenter rejects (reason form)', async p => {
      await p.click('[data-act="reject"]');
      await at(p, `!!document.querySelector('.pk-reject textarea')`, 'the reject form');
      await settle(p);
    }),
    step('rejected', 'story-rejected-04-rejected', 'Step 4: rejected', async p => {
      await p.click('[data-act="reject-confirm"]');
      await at(p, `${waiting(3)} && ${STORY_REQUEST}?.status==='rejected'`, 'rejected, waiting for Next', 60000);
      await settle(p, 500);
    }),
    step('rejected', 'story-rejected-05-mail', 'Step 5: the rejection email on the phone', async p => { await p.click('[data-bar="next"]'); await at(p, waiting(4), 'step 5', 60000); await settle(p, 500); }),
    step('rejected', 'story-rejected-06-turned-away', 'Step 6: no pass, the car is turned away', async p => { await p.click('[data-bar="next"]'); await at(p, waiting(5), 'step 6', 60000); await settle(p, 500); }),
  );
  session(size, lang, 'day', url('dest=parking&speed=30&story=1&auto=0'), 'window.__parking && __parking.story.running', steps);
}

for (const lang of LANGS) {
  // The booth: everything.
  for (const tod of ['day', 'night']) { stops(BOOTH, lang, tod, {extras: tod === 'day'}); explore(BOOTH, lang, tod, {extras: tod === 'day'}); }
  // The tour goes overview, car park (the whole story on auto-advance), meeting room, pond, energy.
  session(BOOTH, lang, 'day', url('speed=10&time=10:00'), IDLE, [
    step('modes', 'tour-parking-story', 'Tour running: the car park story', async p => {
      await p.click('#tour-play');
      await at(p, '__parking.story.running && __parking.story.index>=1', 'the tour\'s parking story', 60000);
      await settle(p, 300, {hold: false});
    }),
    step('modes', 'tour-meeting', 'Tour running: at the meeting room', async p => {
      await at(p, `document.body.dataset.tourDestination==='meeting' && ${STILL}`, 'the tour at the meeting room', 120000);
      await settle(p, 600, {hold: false});
    }),
  ]);
  session(BOOTH, lang, 'day', url('speed=30&kiosk=1&time=12:00'), `${UP} && document.body.classList.contains('kiosk-on')`, [
    step('modes', 'kiosk-on', 'Kiosk on: following the day', async p => { await at(p, `document.querySelector('#day-play')?.getAttribute('aria-pressed')==='true' && ${STILL}`, 'the kiosk following the day'); await settle(p, 800, {hold: false}); }),
  ]);
  session(BOOTH, lang, 'day', url('speed=30&kiosk=1&time=07:35'), UP, [
    step('modes', 'kiosk-morning-story', 'Kiosk on: the morning parking story plays itself', async p => { await at(p, '__parking.story.running && __parking.story.index>=1', 'the kiosk\'s story', 60000); await settle(p, 300, {hold: false}); }),
  ]);
  session(BOOTH, lang, 'day', url('speed=30&dest=pond&time=15:00'), `${IDLE} && document.body.dataset.tourDestination==='pond'`, [
    step('stops', 'stop-pond-low-water', 'Fish pond at 15:00: low-water alert', async p => { await at(p, `!!document.querySelector('[data-incident="pond-low"]')`, 'the low-water alert'); await settle(p, 900); }),
  ]);
  parkingFree(BOOTH, lang, 'day');
  parkingFree(BOOTH, lang, 'night', {night: true});
  storyGuided(BOOTH, lang);
  storyRejected(BOOTH, lang);
  session(BOOTH, lang, 'day', url('dest=parking&speed=10&story=1'), 'window.__parking && __parking.story.running', [
    step('auto', 'story-auto-paused', 'Auto-advance story, paused at step 2', async p => {
      await at(p, '__parking.story.index>=1', 'step 2', 60000);
      await p.click('[data-bar="pause"]');
      await at(p, '__parking.story.paused', 'paused');
      await settle(p, 500);
    }),
  ]);
  // The other sizes: a representative subset.
  for (const size of SIZES.slice(1)) {
    stops(size, lang, 'day');
    explore(size, lang, 'day');
    parkingFree(size, lang, 'day', {full: false});
    storyGuided(size, lang, ['story-01', 'story-04a-approve-cue', 'story-06', 'story-07a-alert-cue']);
  }
}

// Names (the filter's words match these) and the plan.
const shotName = (s, st) => `${sizeName(s.size)}-${s.lang}-${s.tod}-${st.state}`;
// A word is a language (th, en), a time of day (day, night), a size or part of one (1920 matches 1920x1080 and
// 1080x1920), or else part of the state's name (`en` matched "energy" and "sent").
const matches = (s, st, w) => LANGS.includes(w) ? s.lang === w : w === 'day' || w === 'night' ? s.tod === w : /^\d+(x\d*)?$/.test(w) ? sizeName(s.size).includes(w) : st.state.includes(w);
for (const s of sessions) {
  s.wanted = s.steps.map(st => Boolean(st.state) && words.every(w => matches(s, st, w)));
  s.last = s.wanted.lastIndexOf(true);
}
const plan = sessions.filter(s => s.last >= 0);
const total = plan.reduce((n, s) => n + s.wanted.filter(Boolean).length, 0);
if (!total) { console.error(`no shot matches ${words.join(' ')}`); process.exit(1); }
console.log(`${total} shots in ${plan.length} page loads → ${relative(process.cwd(), OUT) || OUT}`);

const shots = [], failures = [];
let opened = null, count = 0;
async function browser() {
  if (!opened || opened.page.gone) { await opened?.close(); opened = await open({shots: OUT}); console.log(`WebGL: ${opened.page.renderer}`); }
  return opened.page;
}
mkdirSync(OUT, {recursive: true});
for (const s of plan) {
  const p = await browser();
  const origin = new URL(p.url).origin;
  const [width, height] = s.size;
  await p.cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: width < 600});
  await p.cdp('Storage.clearDataForOrigin', {origin, storageTypes: 'local_storage'}).catch(() => {});
  // The language is chosen before the page's own scripts run (as a visitor's earlier choice would be).
  const script = (await p.cdp('Page.addScriptToEvaluateOnNewDocument', {source: `try{localStorage.setItem('osd-demo-language',${JSON.stringify(s.lang)})}catch{}`})).result?.identifier;
  p.logs.length = 0;
  let i = 0;
  try {
    await p.goto(s.path);
    await p.until(s.ready, {timeout: 60000, what: 'the page ready'});
    for (; i <= s.last; i++) {
      const st = s.steps[i];
      await st.run(p);
      if (!s.wanted[i]) continue;
      const name = shotName(s, st), file = `${String(++count).padStart(3, '0')}-${name}.png`;
      const r = await p.cdp('Page.captureScreenshot', {format: 'png'});
      if (!r.result?.data) throw new Error(`no screenshot (${r.error?.message || 'empty'})`);
      writeFileSync(join(OUT, file), Buffer.from(r.result.data, 'base64'));
      shots.push({file, name, group: st.group, state: st.state, label: st.label, size: sizeName(s.size), lang: s.lang, tod: s.tod});
      console.log(`✓ ${file}`);
    }
  } catch (error) {
    // The rest of the page's states depend on this one: each is listed as not captured.
    for (; i <= s.last; i++) if (s.wanted[i]) { const name = shotName(s, s.steps[i]); failures.push({name, error: error.message.split('\n')[0]}); console.log(`✗ ${name}: ${error.message.split('\n')[0]}`); }
  } finally {
    if (script) await p.cdp('Page.removeScriptToEvaluateOnNewDocument', {identifier: script}).catch(() => {});
    await p.cdp('Page.navigate', {url: 'about:blank'}).catch(() => {});
  }
  const errors = p.logs.filter(l => !/GL_INVALID_OPERATION|PCFSoftShadowMap|UniformsUtils|KHR_parallel_shader_compile/.test(l));
  if (errors.length) console.log(`  console (${s.path}): ${errors.slice(0, 3).join(' | ').slice(0, 300)}`);
}
await opened?.close();
const seconds = (Date.now() - started) / 1000;

// The contact sheet.
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const LANG_NAME = {th: 'ไทย (TH)', en: 'English (EN)'};
const sizeOrder = SIZES.map(sizeName);
const stateOrder = new Map();
for (const s of sessions) for (const st of s.steps) if (st.state && !stateOrder.has(st.state)) stateOrder.set(st.state, stateOrder.size);
const sorted = [...shots].sort((a, b) => stateOrder.get(a.state) - stateOrder.get(b.state) || sizeOrder.indexOf(a.size) - sizeOrder.indexOf(b.size) || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang) || a.tod.localeCompare(b.tod));
const chips = (key, values, label = v => v) => `<span class="chips" data-key="${key}">${values.map(v => `<label><input type="checkbox" value="${esc(v)}" checked>${esc(label(v))}</label>`).join('')}</span>`;
const sections = Object.entries(GROUPS).map(([g, title]) => {
  const items = sorted.filter(s => s.group === g);
  if (!items.length) return '';
  return `<section><h2>${esc(title)} <small>${items.length}</small></h2><div class="grid">${items.map(s => `
  <figure data-size="${s.size}" data-lang="${s.lang}" data-tod="${s.tod}" data-name="${esc(s.name)}">
    <a href="${esc(s.file)}" target="_blank"><img src="${esc(s.file)}" loading="lazy" alt="${esc(s.label)}"></a>
    <figcaption><b>${esc(s.label)}</b><span>${s.size.replace('x', '×')} · ${esc(LANG_NAME[s.lang])} · ${s.tod}</span><code>${esc(s.file)}</code></figcaption>
  </figure>`).join('')}</div></section>`;
}).join('');
writeFileSync(join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OSD demo screenshots</title><style>
:root{--bg:#f4f5f2;--card:#fff;--ink:#1d2a30;--mute:#61707a;--line:#d9dedb;--accent:#0f7b6c;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#12181c;--card:#1b2328;--ink:#e3e9ec;--mute:#93a2ab;--line:#2c373e;--accent:#4fc1ad;--bad:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,"Noto Sans Thai",sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center}
h1{font-size:18px;margin:0 12px 0 0}header p{margin:0;color:var(--mute)}.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips label{border:1px solid var(--line);border-radius:999px;padding:2px 10px;cursor:pointer;user-select:none;background:var(--card)}
.chips input{margin:0 6px 0 0;accent-color:var(--accent)}input[type=search]{padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);min-width:200px}
main{padding:8px 16px 40px}h2{font-size:16px;margin:26px 0 10px}h2 small{color:var(--mute);font-weight:400}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
figure a{display:flex;align-items:center;justify-content:center;height:220px;background:#0b0f12}
figure img{max-width:100%;max-height:220px;display:block}figcaption{padding:8px 10px;display:flex;flex-direction:column;gap:2px}
figcaption span{color:var(--mute)}figcaption code{font-size:11px;color:var(--mute);word-break:break-all}
.failed{border:1px solid var(--bad);border-radius:8px;padding:8px 12px;margin-top:14px}.failed h2{color:var(--bad);margin:0 0 6px}.failed li{font-family:monospace;font-size:12px}
.hide{display:none}
</style></head><body>
<header><h1>OSD demo screenshots</h1><p>${esc(stamp)} · ${shots.length} shots${failures.length ? ` · ${failures.length} not captured` : ''} · ${Math.round(seconds)} s${words.length ? ` · filter: ${esc(words.join(' '))}` : ''}</p>
${chips('size', sizeOrder.filter(v => shots.some(s => s.size === v)), v => v.replace('x', '×'))}${chips('lang', LANGS.filter(v => shots.some(s => s.lang === v)), v => v.toUpperCase())}${chips('tod', ['day', 'night'].filter(v => shots.some(s => s.tod === v)))}
<input type="search" placeholder="Filter by name…" aria-label="Filter by name"></header>
<main>${failures.length ? `<div class="failed"><h2>Not captured</h2><ul>${failures.map(f => `<li>${esc(f.name)}: ${esc(f.error)}</li>`).join('')}</ul></div>` : ''}${sections}</main>
<script>
const apply=()=>{const on=k=>new Set([...document.querySelectorAll('.chips[data-key="'+k+'"] input:checked')].map(i=>i.value));const s=on('size'),l=on('lang'),t=on('tod'),q=document.querySelector('input[type=search]').value.toLowerCase().split(/\\s+/).filter(Boolean);
for(const f of document.querySelectorAll('figure'))f.classList.toggle('hide',!(s.has(f.dataset.size)&&l.has(f.dataset.lang)&&t.has(f.dataset.tod)&&q.every(w=>f.dataset.name.includes(w))));
for(const sec of document.querySelectorAll('section'))sec.classList.toggle('hide',!sec.querySelector('figure:not(.hide)'));};
document.addEventListener('input',apply);
</script></body></html>
`);
console.log(`\n${shots.length}/${total} shots in ${seconds.toFixed(0)} s${failures.length ? `, ${failures.length} not captured` : ''}\n${join(OUT, 'index.html')}`);
process.exit(failures.length ? 1 : 0);
