// Parking access demo inside the OSD building showcase. Everything is simulated locally.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {t, onLang, getLang, setLang} from './i18n.js';
import {icon, esc} from './dom.js';
import {createParkingSim} from './sim.js';
import {later, sleep} from './clock.js';
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
const UNKNOWN_PLATES = [['4ศย 5150', 'ปทุมธานี'], ['ผต 8812', 'กรุงเทพมหานคร'], ['3ฆง 6047', 'ชลบุรี'], ['ฌธ 2290', 'นครปฐม']];
const pickOne = list => list[Math.floor(Math.random() * list.length)];

// Shared by the showcase and the explore page: background comings and goings keep the lot between ~22 and ~40 cars.
const wantsExit = parked => parked > 40 || (parked > 22 && Math.random() < .45);
function idleStaffCars(sim, traffic) {
  const inside = new Set([...sim.state.presence.values()].map(p => p.vehicleId));
  return sim.state.vehicles.filter(v => v.type === 'staff' && v.enabled && v.sync === 'synced' && !inside.has(v.id) && !traffic.isArriving(sim.key(v.plate, v.province)));
}
// Parked cars that may drive out; VIPs stay. The explore page, which only brings staff cars back, passes staffOnly.
const leavingCandidates = (sim, traffic, {staffOnly = false} = {}) => traffic.parkedKeys().filter(k => { const type = sim.state.presence.get(k)?.type; return staffOnly ? type === 'staff' : type !== 'vip'; });

export function createParking({scene, schedule, renderer, afterRender, capture, fly}) {
  let interactHandler = () => {};
  const onInteract = () => interactHandler();
  const $ = s => document.querySelector(s);
  const layer = $('#parking-layer'), panelRoot = $('#parking-panel'), phoneRoot = $('#pk-phone'), bar = $('#parking-bar');
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  let active = false, ambientTimer = 0, passTimer = 0, quietAmbient = false;

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
      const refresh = () => { const shot = snap(which); panel.setSnapshot(which, shot); };
      later(refresh, 700);
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
        const keys = leavingCandidates(sim, traffic);
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
        traffic.arrive({plate, province, color: Math.floor(Math.random() * 9), fromX, ambient: quiet});
        say('gate.sim.coming', plate); blocked();
        return;
      }
      const inside = new Set([...presence.values()].map(p => p.vehicleId));
      const pool = kind === 'visitor'
        ? sim.state.vehicles.filter(v => v.type === 'guest' && v.enabled && v.sync === 'synced' && !inside.has(v.id) && !traffic.isArriving(sim.key(v.plate, v.province)) && v.validFrom <= sim.now() && v.validTo >= sim.now())
        : idleStaffCars(sim, traffic);
      // The newest approved visitor drives up first, so a request made on the phone can be followed to the gate.
      const v = kind === 'visitor' ? pool[pool.length - 1] : pickOne(pool);
      if (!v) { if (!quiet) overlays.toast(`${icon('user')}<span>${esc(t(kind === 'visitor' ? 'gate.sim.noVisitor' : 'gate.sim.noStaff'))}</span>`); return; }
      traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX});
      say('gate.sim.coming', v.plate); blocked();
    },
  };

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
    async resetWorld() {
      quietAmbient = true;
      sim.reset(); traffic.syncParked(); panel.reset(); phone.reset(); overlays.reset();
      await sleep(50);
    },
  });
  story.subscribe(() => { quietAmbient = story.running; renderBar(); });

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
    if (what === 'play') { onInteract(); story.play({auto: story.auto}); }
    if (what === 'pause') story.pause();
    if (what === 'resume') story.resume();
    if (what === 'next') story.next();
    if (what === 'restart') { onInteract(); story.play({auto: story.auto}); }
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

  // Ambient life while the car park is on screen
  function scheduleAmbient() {
    clearTimeout(ambientTimer);
    ambientTimer = later(() => {
      // Staff cars come and go whenever the car park is on screen. Unknown cars only on the parking stop,
      // where their alert can be answered.
      if (lot.root.visible && !quietAmbient && !traffic.busy && document.visibilityState === 'visible') {
        if (wantsExit(sim.state.presence.size)) actions.simulate('exit', {quiet: true});
        else if (active && Math.random() < .12) actions.simulate('unknown', {quiet: true});
        else actions.simulate('registered', {quiet: true});
      }
      scheduleAmbient();
    }, 16000 + Math.random() * 12000);
  }
  function schedulePass() {
    clearTimeout(passTimer);
    // Through-traffic runs whenever the street is on screen (overview and car park), not only in the parking stop.
    passTimer = later(() => { if (lot.root.visible && document.visibilityState === 'visible') traffic.passBy(); schedulePass(); }, 1800 + Math.random() * 3200);
  }
  // Unknown cars that nobody answers are turned away after a while in free play.
  // The single barrier serves entry and exit, so a waiting unknown car blocks cars leaving too. Background ones
  // are turned away after 8 s (demo time); ones a presenter sends wait 45 s for an answer.
  const autoDeny = setInterval(() => {
    if (story.running) return;
    for (const a of sim.state.alerts) if (a.status === 'open' && sim.now() - a.at > (a.ambient ? 8000 : 45000)) sim.resolveAlert(a.id, 'deny', undefined, 'staff.guard');
  }, 250);

  onLang(() => { panel.render(); phone.render(); overlays.refresh(); story.refreshCaption(); renderBar(); });
  traffic.syncParked();
  schedulePass();
  scheduleAmbient();
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
    playStory({auto = true} = {}) { story.setAuto(auto); return story.play({auto}); },
    stopStory() { story.stop(); },
    setNight(night) { lot.setNight(night); },
    toggleLang() { setLang(getLang() === 'en' ? 'th' : 'en'); },
    setInteractHandler(fn) { interactHandler = fn; },
    dispose() { afterRender?.delete(drawLiveFeed); story.stop(); clearTimeout(ambientTimer); clearTimeout(passTimer); clearInterval(autoDeny); lot.dispose(); disposeCars(); },
  };
}

// The car park without any UI, for the free-exploration page (#explore): the lot, parked cars,
// through-traffic, and staff cars coming and going through the barrier.
export function createParkingScene({scene, schedule}) {
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  const traffic = createTraffic({lot, sim, schedule, hooks: {}});
  const timers = {};
  const loop = (name, fn, min, spread) => { const run = () => { fn(); timers[name] = later(run, min + Math.random() * spread); }; timers[name] = later(run, min * Math.random()); };
  const onScreen = () => lot.root.visible && document.visibilityState === 'visible';
  loop('street', () => { if (onScreen()) traffic.passBy(); }, 1800, 3200);
  loop('lot', () => {
    if (!onScreen() || traffic.busy) return;
    if (wantsExit(sim.state.presence.size)) { const keys = leavingCandidates(sim, traffic, {staffOnly: true}); if (keys.length) traffic.leave(pickOne(keys)); return; }
    const v = pickOne(idleStaffCars(sim, traffic));
    if (v) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70});
  }, 14000, 12000);
  traffic.syncParked();
  return {
    lot, sim, traffic,
    setNight(night) { lot.setNight(night); },
    dispose() { for (const id of Object.values(timers)) clearTimeout(id); lot.dispose(); disposeCars(); },
  };
}
