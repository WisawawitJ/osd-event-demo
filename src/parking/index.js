// Parking access demo inside the OSD building showcase. Everything is simulated locally.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {t, onLang, getLang, setLang, bkk} from './i18n.js';
import {icon, esc} from './dom.js';
import {createParkingSim, STORY} from './sim.js';
import {SPEED, later, cancelLater, sleep, world, demoNow, minuteOf} from './clock.js';
import {createLot} from './lot3d.js';
import {createTraffic} from './traffic.js';
import {createPanel} from './panel.js';
import {createPhone} from './phone.js';
import {createOverlays} from './overlays.js';
import {createStory} from './story.js';
import {CAR, disposeCars} from './cars.js';

export const PARKING_POSES = {
  lot: {eye: [-4, 30, 52], target: [-33, .5, 3], fov: 42},
  gate: {eye: [-10.5, 7.2, 33.5], target: [-22.4, 1, 18.6], fov: 40},
  rowA: {eye: [-14, 13, 24], target: [-30.5, .5, 7], fov: 44},
};
const STORY_START = bkk(2026, 11, 24, 9, 0);
const UNKNOWN_PLATES = [['4ศย 5150', 'ปทุมธานี'], ['ผต 8812', 'กรุงเทพมหานคร'], ['3ฆง 6047', 'ชลบุรี'], ['ฌธ 2290', 'นครปฐม']];
const pickOne = list => list[Math.floor(Math.random() * list.length)];
const lotOnScreen = lot => lot.root.visible && document.visibilityState === 'visible';
const vehiclesInside = sim => new Set([...sim.state.presence.values()].map(p => p.vehicleId));

// How many cars the car park holds at each time of day (minute, cars): nearly empty at night, the morning rush from
// 07:00, a dip at lunch, the evening rush out from 16:30. The seeded morning (09:00) has 27.
const OCCUPANCY = [[0, 2], [390, 2], [420, 5], [480, 17], [540, 27], [600, 34], [720, 35], [750, 30], [810, 34], [990, 35], [1050, 24], [1110, 9], [1170, 5], [1260, 3], [1440, 2]];
function occupancyAt(minute) {
  for (let i = 1; i < OCCUPANCY.length; i++) {
    const [a, x] = OCCUPANCY[i - 1], [b, y] = OCCUPANCY[i];
    if (minute <= b) return x + (y - x) * (minute - a) / (b - a);
  }
  return OCCUPANCY[0][1];
}
const daytime = minute => minute >= 390 && minute < 1140;
// Through-traffic on the street follows the hour too: closest together in the rushes (07:00–08:45, 16:45–18:30),
// a car now and then at night (22:00–05:30). The delay (ms of demo time) until the next one is offered.
function streetGap(minute) {
  const rush = (minute >= 420 && minute < 525) || (minute >= 1005 && minute < 1110), night = minute < 330 || minute >= 1320;
  return rush ? 1100 + Math.random() * 1500 : night ? 9000 + Math.random() * 9000 : 1800 + Math.random() * 3200;
}
// Cars not in the car park that may drive in: staff, and in the morning the VIPs (the explore page: staff only).
function idleCars(sim, traffic, {staffOnly = false} = {}) {
  const inside = vehiclesInside(sim), m = world.minute();
  const vip = !staffOnly && m >= 420 && m < 660;
  return sim.state.vehicles.filter(v => (v.type === 'staff' || (vip && v.type === 'vip')) && v.enabled && v.sync === 'synced' && !inside.has(v.id) && !traffic.isArriving(sim.key(v.plate, v.province)));
}
// About a third of the cars coming in arrive along the far lane and turn right across the near one (the story's own
// cars keep the near lane, where its camera shots expect them).
const fromFarLane = () => Math.random() < .35;
// Parked cars that may drive out: VIPs only from the late afternoon, visitors' cars never by themselves (their visit
// ends them), only when sent out by hand (`guests`). Unknown cars let in by hand (a delivery) leave too: left out, one
// stayed in its bay until a reset.
function leavingCandidates(sim, traffic, {staffOnly = false, guests = false} = {}) {
  // VIPs leave from the late afternoon on, through the night (a jump past midnight finds them gone).
  const m = world.minute(), vip = !staffOnly && (m >= 990 || m < 420);
  return traffic.parkedKeys().filter(k => { const type = sim.state.presence.get(k)?.type; return type === 'staff' || type === 'unknown' || (vip && type === 'vip') || (guests && type === 'guest'); });
}

// Background life of the car park, shared by the showcase and the explore page: cars come and go so that the car
// park follows OCCUPANCY at the world clock's hour. On screen they drive through the barrier, as fast as its one lane
// allows (two arriving and two leaving at a time); the rest of a gap the barrier cannot close (a rush in time-lapse,
// a jump in time, or time spent off screen) is made up in the bays directly, logged at times spread over that gap.
// Between rushes a car comes or goes now and then. `paused()` (the story playing) stops all of it.
function startLotLife({sim, traffic, lot, camera = null, staffOnly = false, paused = () => false, watched = () => true, arrive, leave, unknown = null}) {
  const onScreen = () => lotOnScreen(lot);
  // Cars made up in the bays appear or vanish on the spot, so while the car park is on screen only in bays the camera
  // cannot see: popping in and out of view (the building's covered bays, at rush hour on a short day) read as a flicker.
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4(), bay = new THREE.Sphere(new THREE.Vector3(), 3.2);
  const stallsById = new Map(sim.state.stalls.map(s => [s.id, s]));
  function unseenBays() {
    if (!onScreen()) return () => true;
    if (!camera) return () => false;
    camera.updateMatrixWorld();
    frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return stall => !frustum.intersectsSphere(bay.set(bay.center.set(stall.x, stall.y, stall.z), 3.2));
  }
  const expected = () => sim.state.presence.size + traffic.queued - traffic.leaving;
  const gap = () => Math.round(occupancyAt(world.minute())) - expected();
  function park(at, unseen) {
    const v = pickOne(idleCars(sim, traffic, {staffOnly})), stall = v && sim.freeStall(v.type, unseen);
    if (!stall) return;
    sim.recordEntry({plate: v.plate, province: v.province, type: v.type, stallId: stall.id, color: v.color, at});
    traffic.appear(sim.key(v.plate, v.province));
  }
  function unpark(at, unseen) {
    for (const k of leavingCandidates(sim, traffic, {staffOnly}).sort(() => Math.random() - .5)) {
      const p = sim.state.presence.get(k), stall = stallsById.get(p.stallId);
      if (stall && !unseen(stall)) continue;
      if (traffic.vanish(k, () => sim.recordExit({plate: p.plate, province: p.province, at}))) return;
    }
  }
  // A log time between `from` and `to` for a car coming in (or leaving): when the car park was filling (or emptying)
  // most, so a jump over the evening logs its departures in the evening rush, not spread over the afternoon.
  function when(arriving, from, to) {
    for (let i = 0; i < 40; i++) {
      const t = from + Math.random() * Math.max(0, to - from), m = minuteOf(t);
      const change = occupancyAt((m + 10) % 1440) - occupancyAt(m); // cars per 10 minutes
      if (Math.random() < Math.max(0, arriving ? change : -change) / 4) return t;
    }
    return from + Math.random() * Math.max(0, to - from);
  }
  // Closes the gap down to `keep` cars, oldest log time first.
  // `anywhere`: a jump in time, which changes the whole car park at once anyway.
  function catchUp(keep, from, to, {anywhere = false} = {}) {
    let g = gap();
    const moves = [], unseen = anywhere ? () => true : unseenBays();
    for (; g > keep; g--) moves.push([park, when(true, from, to)]);
    for (; g < -keep; g++) moves.push([unpark, when(false, from, to)]);
    moves.sort((a, b) => a[1] - b[1]).forEach(([move, t]) => move(Math.round(t), unseen));
  }
  // Visitors: someone with a pass for today drops in now and then between 09:30 and 15:30 (each at most once a day;
  // the story's visitor is the story's), stays 45 minutes to three hours of world time, then leaves by themselves.
  const TODAY = bkk(2026, 11, 24);
  const stayOf = plate => (45 + [...plate].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 7) % 136) * 60000;
  function visitorsDue() {
    const now = world.now(), inside = vehiclesInside(sim);
    const came = new Set(sim.state.events.filter(e => e.at >= TODAY && (e.kind === 'entry' || e.kind === 'manual') && e.type === 'guest').map(e => sim.key(e.plate, e.province)));
    return sim.state.vehicles.filter(v => v.type === 'guest' && v.plate !== STORY.plate && v.enabled && v.sync === 'synced' && (!v.validFrom || v.validFrom <= now) && (!v.validTo || v.validTo >= now)
      && !inside.has(v.id) && !came.has(sim.key(v.plate, v.province)) && !traffic.isArriving(sim.key(v.plate, v.province)));
  }
  // `from`…`now`: the world time since the last look; on average a visitor arrives every 35 minutes of it.
  function visits(from, now) {
    const m = world.minute();
    // Whose visit is over: one at a time, through the barrier when the car park is on screen.
    for (const [k, p] of sim.state.presence) {
      if (p.type !== 'guest' || p.plate === STORY.plate || now - p.since < stayOf(p.plate)) continue;
      if (onScreen()) { if (traffic.leaving < 2) traffic.leave(k); }
      else traffic.vanish(k, () => sim.recordExit({plate: p.plate, province: p.province}));
      break;
    }
    if (m < 570 || m >= 930 || Math.random() > (now - from) / 60000 / 35) return;
    const v = pickOne(visitorsDue());
    if (!v) return;
    if (onScreen()) { if (traffic.queued < 2) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70, west: fromFarLane()}); return; }
    const stall = sim.freeStall('guest');
    if (stall) { sim.recordEntry({plate: v.plate, province: v.province, type: 'guest', stallId: stall.id, color: v.color}); traffic.appear(sim.key(v.plate, v.province)); }
  }
  let last = world.now(), timer = 0;
  // Opened later than the seeded 09:00 (a page at ?time=23:00): the car park is that hour's at once, its log spread
  // over the hours since, not the morning's cars left to drive out through the barrier one by one.
  if (last > STORY_START && !paused()) catchUp(0, STORY_START, last, {anywhere: true});
  function tick() {
    const now = world.now(), from = last;
    last = now;
    if (!paused()) {
      // Off screen everything is made up at once; on screen a few cars are left for the barrier to bring in or out.
      catchUp(!onScreen() ? 0 : watched() ? 6 : 2, from, now);
      if (!staffOnly) visits(from, now);
      const g = gap(), m = world.minute();
      if (onScreen()) {
        // A gap of one car is the everyday coming and going below, not a rush: one car leaving does not send another in.
        if (g >= 2 && traffic.queued < 2) arrive();
        else if (g <= -2 && traffic.leaving < 2) leave();
        else if (!traffic.busy && Math.random() < (daytime(m) ? .07 : .01)) {
          if (unknown && daytime(m) && Math.random() < .12) unknown();
          else if (g >= 0) arrive(); else leave();
        }
      }
    }
    timer = later(tick, 1500);
  }
  // A jump in time: the car park is as it would be by then (the log spread over the skipped hours), on screen too.
  // The day's wrap at 03:00 moves the log back a day: the last look moves with it (left behind, the next catch-up
  // logged its cars a day ahead).
  const off = world.subscribe((kind, p) => { if (kind === 'wrap') last += p; if (kind === 'jump' && !paused()) { catchUp(onScreen() && watched() ? 3 : 0, p.from, p.to, {anywhere: true}); last = world.now(); } });
  timer = later(tick, 1500);
  return () => { cancelLater(timer); off(); };
}

export function createParking({scene, schedule, camera = null, renderer, afterRender, capture, fly}) {
  let interactHandler = () => {};
  const onInteract = () => interactHandler();
  const $ = s => document.querySelector(s);
  const layer = $('#parking-layer'), panelRoot = $('#parking-panel'), phoneRoot = $('#pk-phone'), bar = $('#parking-bar');
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  let active = false, passTimer = 0, quietAmbient = false;

  // Plate camera: snapshot plus where the plate sits in the frame, or null when the camera cannot read it: the plate
  // faces away, is behind the lens (projected corners would flip into the frame), or is not wholly in the picture.
  const corner = new THREE.Vector3(), plateNormal = new THREE.Vector3(), toCamera = new THREE.Vector3();
  function plateBox(camera, agent) {
    agent.car.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
    agent.car.localToWorld(corner.set(0, CAR.plateY, CAR.frontPlateZ));
    camera.getWorldPosition(toCamera).sub(corner);
    plateNormal.set(0, 0, 1).transformDirection(agent.car.matrixWorld);
    if (plateNormal.dot(toCamera) <= 0) return null;
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const [dx, dy] of [[-.31, -.15], [.31, -.15], [.31, .15], [-.31, .15]]) {
      corner.set(dx, CAR.plateY + dy, CAR.frontPlateZ + .02);
      agent.car.localToWorld(corner).project(camera);
      if (corner.z < -1 || corner.z > 1) return null;
      const x = (corner.x + 1) / 2, y = (1 - corner.y) / 2;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const pad = .02;
    return {x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2};
  }
  const snap = which => capture(lot.cameras[which]);

  // Live LPR feed: after each 3D frame, draw the gate camera into the pop-up's picture area of the same canvas
  // (a scissored viewport), and place the plate box from that camera. Costs one extra render while it shows.
  let live = null;
  const liveSize = new THREE.Vector2(), liveViewport = new THREE.Vector4(), liveScissor = new THREE.Vector4();
  function drawLiveFeed() {
    const area = active && live ? overlays.feedView() : null;
    if (!area) return;
    const canvas = renderer.domElement, c = canvas.getBoundingClientRect(), r = area.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const x = r.left - c.left, y = c.bottom - r.bottom; // three.js viewports count from the bottom, in CSS pixels
    const {camera, agent} = live;
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    renderer.getViewport(liveViewport); renderer.getScissor(liveScissor); renderer.getSize(liveSize);
    const scissorTest = renderer.getScissorTest();
    renderer.setViewport(x, y, r.width, r.height); renderer.setScissor(x, y, r.width, r.height); renderer.setScissorTest(true);
    renderer.render(scene, camera);
    renderer.setViewport(liveViewport); renderer.setScissor(liveScissor); renderer.setScissorTest(scissorTest);
    overlays.setFeedBox(agent.car.parent ? plateBox(camera, agent) : null);
  }
  afterRender?.add(drawLiveFeed);

  const traffic = createTraffic({lot, sim, schedule, hooks: {
    snapshot: snap,
    async readPlate(which, agent, verdict) {
      const camera = lot.cameras[which];
      const confidence = .9 + Math.random() * .09;
      const shot = snap(which);
      // The pop-up shows the gate camera live: the 3D view draws this camera into its picture area every frame.
      live = {camera, agent};
      overlays.showFeed({which, snapshot: shot, live: Boolean(renderer && afterRender), phase: 'reading', plate: agent.plate, province: agent.province, verdict, confidence});
      panel.setSnapshot(which, shot);
      schedule();
      await sleep(900);
      overlays.updateFeed({phase: 'done'});
      await sleep(verdict.allow ? 500 : 300);
    },
    onFull(plate) { overlays.toast(`${icon('alert')}<span>${esc(t('gate.full', {plate}))}</span>`); },
    onLeaveGate(which) {
      later(() => panel.setSnapshot(which, snap(which)), 700);
      overlays.hideFeed(3200);
    },
  }});

  const actions = {
    interact: () => onInteract(),
    feedChanged: () => schedule(),
    toast: text => overlays.toast(esc(text)),
    approve(id) { sim.approve(id); },
    resolveAlert(id, decision, reason) { sim.resolveAlert(id, decision === 'open' ? 'open' : 'deny', reason); },
    // While an unknown car's alert holds the barrier, the answer is Open/Deny on that alert, not a blind pulse.
    manualOpen(reason) { if (sim.state.gate !== 'closed' || sim.state.alerts.some(a => a.status === 'open')) return; sim.manualGate('open', reason); traffic.pulse(5000); },
    simulate(kind, {fromX = -70, quiet = false} = {}) {
      const presence = sim.state.presence;
      // Every button press says what happens, including when the car has to queue.
      const say = (key, plate) => { if (!quiet) overlays.toast(`${icon('car')}<span>${esc(t(key, {plate}))}${traffic.queued > 1 ? ` · ${esc(t('gate.sim.queued'))}` : ''}</span>`, 'info'); };
      const blocked = () => { if (!quiet && sim.state.alerts.some(a => a.status === 'open')) overlays.toast(`${icon('alert')}<span>${esc(t('gate.sim.waitingAlert'))}</span>`); };
      if (kind === 'exit') {
        // Pressed by hand, any parked car may be the one (a visitor too); the background's own departures are not.
        const keys = leavingCandidates(sim, traffic, {guests: !quiet});
        if (!keys.length) return;
        const k = pickOne(keys);
        traffic.leave(k);
        if (!quiet) overlays.toast(`${icon('arrowOut')}<span>${esc(t('gate.sim.leaving', {plate: presence.get(k)?.plate}))}</span>`, 'info');
        blocked();
        return;
      }
      if (kind === 'unknown') {
        const free = UNKNOWN_PLATES.filter(([p, pr]) => !traffic.isArriving(sim.key(p, pr)) && !presence.has(sim.key(p, pr)));
        if (!free.length) return;
        const [plate, province] = pickOne(free);
        traffic.arrive({plate, province, color: Math.floor(Math.random() * 9), fromX, ambient: quiet, west: fromFarLane()});
        say('gate.sim.coming', plate); blocked();
        return;
      }
      const inside = vehiclesInside(sim);
      const pool = kind === 'visitor'
        ? sim.state.vehicles.filter(v => v.type === 'guest' && v.enabled && v.sync === 'synced' && !inside.has(v.id) && !traffic.isArriving(sim.key(v.plate, v.province)) && v.validFrom <= sim.now() && v.validTo >= sim.now())
        : idleCars(sim, traffic, {staffOnly: !quiet}); // the Staff car button sends a staff car, never a VIP
      // The newest approved visitor drives up first, so a request made on the phone can be followed to the gate.
      const v = kind === 'visitor' ? pool[pool.length - 1] : pickOne(pool);
      if (!v) { if (!quiet) overlays.toast(`${icon('user')}<span>${esc(t(kind === 'visitor' ? 'gate.sim.noVisitor' : 'gate.sim.noStaff'))}</span>`); return; }
      traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX, west: fromFarLane()});
      say('gate.sim.coming', v.plate); blocked();
    },
  };

  actions.gateShown = () => { for (const which of ['in', 'out']) panel.setSnapshot(which, snap(which)); };
  const panel = createPanel({root: panelRoot, sim, actions});
  const phone = createPhone({root: phoneRoot, sim, actions: {interact: actions.interact, openChanged: () => renderBar()}});
  const overlays = createOverlays({layer: $('#pk-overlays'), sim, actions});

  sim.subscribe((kind, payload) => {
    if (kind === 'request' && payload?.status === 'pending' && payload.history.length === 1) {
      panel.markNew(payload.id);
      overlays.toast(`${icon('inbox')}<span><b>${esc(t('att.pending'))}</b> ${esc(payload.visitor.name)} · ${esc(payload.plate)}</span>`, 'info');
    }
    if (kind === 'alert') { overlays.showAlert(payload.id); if (!story.running) panel.show('gate'); }
    if (kind === 'entry' || kind === 'exit') panel.flash(payload.id);
    if (kind === 'email') overlays.toast(`${icon('check')}<span>${esc(t('req.emailSent'))}</span>`, 'ok');
    if (kind === 'capacity') traffic.refreshBays();
    panel.render();
  });

  // Story ---------------------------------------------------------------
  let currentHint = null, currentCaption = null;
  const story = createStory({
    sim, panel, phone, overlays, traffic, actions,
    fly: (name, ms) => fly(PARKING_POSES[name], ms),
    cue(name) { panel.setCue(name); overlays.setCue(name); },
    hint(text) { currentHint = text; if (currentCaption) overlays.caption({...currentCaption, hint: text}); },
    caption(c) { currentCaption = c; overlays.caption(c ? {...c, hint: currentHint} : null); },
    tap() { for (const el of document.querySelectorAll('[data-cue="true"]')) { el.classList.remove('pk-tapped'); void el.offsetWidth; el.classList.add('pk-tapped'); } },
    // The story starts from the seeded 09:00 car park, so the clock goes to 09:00 first (the seed would otherwise
    // leave out whatever lies after an earlier time).
    async resetWorld() {
      quietAmbient = true;
      sim.setNow(STORY_START);
      sim.reset(); traffic.syncParked(); panel.reset(); phone.reset(); overlays.reset();
      await sleep(50);
    },
  });
  // Only when the story stops (not on every story update, e.g. Auto-advance in free play) are its phone cue and
  // photo read cleared: a cue left on would keep the photo button doing nothing in free play.
  // While the story plays, the world clock runs at real speed: its steps set their own times (09:02 … 11:30).
  let storyWasRunning = false, releaseClock = null;
  story.subscribe(() => {
    quietAmbient = story.running;
    if (story.running && !releaseClock) releaseClock = world.hold();
    if (!story.running && releaseClock) { releaseClock(); releaseClock = null; }
    if (storyWasRunning && !story.running) { phone.setCue(null); phone.cancelRead(); }
    storyWasRunning = story.running; renderBar();
  });

  // Story bar below the viewport -----------------------------------------
  function renderBar() {
    const s = story;
    const dots = Array.from({length: s.total}, (_, i) => `<i class="${i < s.index ? 'done' : i === s.index ? 'now' : ''}"></i>`).join('');
    const main = !s.running
      ? `<button class="primary-button" data-bar="play">${icon('play')}<span>${t('story.play')}</span></button>`
      : s.auto
        ? `<button class="primary-button" data-bar="${s.paused ? 'resume' : 'pause'}">${icon(s.paused ? 'play' : 'pause')}<span>${t(s.paused ? 'story.resume' : 'story.pause')}</span></button>`
        : `<button class="primary-button" data-bar="next"${s.waitingForNext ? ' data-cue="true"' : ''}>${icon('next')}<span>${t('next')}</span></button>`;
    bar.innerHTML = `<div class="pk-bar-main">${main}${s.running ? `<button data-bar="restart">${icon('restart')}<span>${t('story.restart')}</span></button><button data-bar="free" class="pk-exit-story" title="Esc">${icon('x')}<span>${t('story.exit')}</span></button>` : ''}
      <label class="pk-switch"><input type="checkbox" data-bar="auto"${s.auto ? ' checked' : ''}><span>${t('story.autoAdvance')}</span></label></div>
      <div class="pk-bar-progress">${s.running ? `<span>${t('story.step', {n: s.index + 1, total: s.total})}</span><div class="pk-dots">${dots}</div>` : `<span class="pk-bar-idle">${t('story.idle')}</span>`}</div>
      <button class="pk-phone-toggle" data-bar="phone" aria-pressed="${phone.isOpen}">${icon('phone')}<span>${phone.isOpen ? t('ph.hide') : t('ph.show')}</span></button>`;
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-bar]');
    if (!b || b.dataset.bar === 'auto') return;
    const what = b.dataset.bar;
    // Playing or moving the story on needs time to pass: it resumes a paused demo.
    if (['play', 'restart', 'resume', 'next'].includes(what)) world.setPaused(false);
    if (what === 'play' || what === 'restart') { onInteract(); story.play({auto: story.auto}); }
    if (what === 'pause') story.pause();
    if (what === 'resume') story.resume();
    if (what === 'next') story.next();
    if (what === 'free') leaveStory();
    if (what === 'phone') { onInteract(); phone.setOpen(!phone.isOpen); }
    renderBar();
  });
  bar.addEventListener('change', e => { if (e.target.dataset.bar === 'auto') story.setAuto(e.target.checked); });

  // Leaving the story. Like the building tour, a playing story also ends as soon as the visitor takes over:
  // dragging or zooming the 3D view, or picking a console tab (on auto-advance; in Next mode the presenter may
  // look around between steps). Esc always ends it. Cued buttons, the phone and the story bar are part of it.
  function leaveStory() {
    if (!story.running) return;
    onInteract(); // also ends a building tour the story was part of, instead of moving on to the next stop
    story.stop();
    panel.show('gate');
    overlays.toast(esc(t('story.freeMode')));
    renderBar();
  }
  const viewport = $('#viewport');
  const takeOver = event => {
    if (!active || !story.running || !story.auto) return;
    if (event.target.closest?.('#pk-phone, .pk-caption, .pk-alert-pop, #view-orbit')) return;
    leaveStory();
  };
  viewport.addEventListener('pointerdown', takeOver, {capture: true});
  viewport.addEventListener('wheel', takeOver, {capture: true, passive: true});
  panelRoot.addEventListener('click', event => { if (event.target.closest('[data-tab]')) takeOver(event); }, {capture: true});
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active && story.running) leaveStory(); });

  // Background life of the car park. Unknown cars only on the parking stop, where their alert can be answered.
  // The parked cars are placed first: a late start's first catch-up takes cars away from the bays.
  traffic.syncParked();
  const stopLife = startLotLife({sim, traffic, lot, camera, paused: () => quietAmbient, watched: () => active,
    arrive: () => actions.simulate('registered', {quiet: true}), leave: () => actions.simulate('exit', {quiet: true}),
    unknown: () => { if (active) actions.simulate('unknown', {quiet: true}); }});
  function schedulePass() {
    cancelLater(passTimer);
    // Through-traffic runs whenever the street is on screen (overview and car park), not only in the parking stop.
    passTimer = later(() => { if (lotOnScreen(lot)) traffic.passBy(); schedulePass(); }, streetGap(world.minute()));
  }
  // Unknown cars that nobody answers are turned away after a while in free play.
  // The single barrier serves entry and exit, so a waiting unknown car blocks cars leaving too. Background ones
  // are turned away after 8 s (demo time); ones a presenter sends wait 45 s for an answer.
  const autoDeny = setInterval(() => {
    if (story.running) return;
    for (const a of sim.state.alerts) if (a.status === 'open' && (demoNow() - a.raised) * SPEED > (a.ambient ? 8000 : 45000)) sim.resolveAlert(a.id, 'deny', undefined, 'staff.guard');
  }, 250);

  onLang(() => { panel.render(); phone.render(); overlays.refresh(); story.refreshCaption(); renderBar(); });
  schedulePass();
  renderBar();
  panel.render();

  return {
    sim, story, lot, traffic,
    enter() {
      active = true;
      document.body.classList.add('parking-active');
      layer.hidden = false; panelRoot.hidden = false; bar.hidden = false;
      panel.render(); renderBar();
    },
    exit() {
      active = false;
      story.stop();
      document.body.classList.remove('parking-active');
      layer.hidden = true; panelRoot.hidden = true; bar.hidden = true;
      phone.setOpen(false);
    },
    get active() { return active; },
    // Runs the story once (the showcase loop calls this) and resolves when it ends or stops.
    playStory({auto = true} = {}) { world.setPaused(false); story.setAuto(auto); return story.play({auto}); },
    stopStory() { story.stop(); },
    setNight(night) { lot.setNight(night); traffic.setNight(night); },
    toggleLang() { setLang(getLang() === 'en' ? 'th' : 'en'); },
    setInteractHandler(fn) { interactHandler = fn; },
    dispose() { afterRender?.delete(drawLiveFeed); story.stop(); stopLife(); cancelLater(passTimer); clearInterval(autoDeny); lot.dispose(); disposeCars(); },
  };
}

// The car park without any UI, for the free-exploration page (#explore): the lot, parked cars,
// through-traffic, and staff cars coming and going through the barrier.
export function createParkingScene({scene, schedule, camera = null}) {
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  const traffic = createTraffic({lot, sim, schedule, hooks: {}});
  const timers = {};
  const loop = (name, fn, gap) => { const run = () => { fn(); timers[name] = later(run, gap()); }; timers[name] = later(run, gap() * Math.random()); };
  loop('street', () => { if (lotOnScreen(lot)) traffic.passBy(); }, () => streetGap(world.minute()));
  traffic.syncParked();
  const stopLife = startLotLife({sim, traffic, lot, camera, staffOnly: true,
    arrive() { const v = pickOne(idleCars(sim, traffic, {staffOnly: true})); if (v) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70, west: fromFarLane()}); },
    leave() { const keys = leavingCandidates(sim, traffic, {staffOnly: true}); if (keys.length) traffic.leave(pickOne(keys)); }});
  return {
    lot, sim, traffic,
    setNight(night) { lot.setNight(night); traffic.setNight(night); },
    dispose() { stopLife(); for (const handle of Object.values(timers)) cancelLater(handle); lot.dispose(); disposeCars(); },
  };
}
