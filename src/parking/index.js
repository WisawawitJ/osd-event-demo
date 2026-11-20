// Parking access demo inside the OSD building showcase. Everything is simulated locally.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {t, onLang, getLang, setLang} from './i18n.js';
import {icon, esc} from './dom.js';
import {createParkingSim, STORY} from './sim.js';
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

export function createParking({scene, schedule, capture, fly, onStoryChange = () => {}}) {
  let interactHandler = () => {};
  const onInteract = () => interactHandler();
  const $ = s => document.querySelector(s);
  const layer = $('#parking-layer'), panelRoot = $('#parking-panel'), phoneRoot = $('#pk-phone'), bar = $('#parking-bar');
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  let active = false, ambientTimer = 0, passTimer = 0, quietAmbient = false;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Plate camera: snapshot plus where the plate sits in the frame.
  const corner = new THREE.Vector3();
  function plateBox(camera, agent) {
    agent.car.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const [dx, dy] of [[-.31, -.15], [.31, -.15], [.31, .15], [-.31, .15]]) {
      corner.set(dx, CAR.plateY + dy, CAR.frontPlateZ + .02);
      agent.car.localToWorld(corner).project(camera);
      const x = (corner.x + 1) / 2, y = (1 - corner.y) / 2;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const pad = .02;
    return {x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2};
  }
  const snap = which => capture(lot.cameras[which]);

  const traffic = createTraffic({lot, sim, schedule, hooks: {
    snapshot: snap,
    async readPlate(which, agent, verdict) {
      const camera = lot.cameras[which];
      const confidence = .9 + Math.random() * .09;
      const shot = snap(which);
      overlays.showFeed({which, snapshot: shot, box: plateBox(camera, agent), phase: 'reading', plate: agent.plate, province: agent.province, verdict, confidence});
      panel.setSnapshot(which, shot);
      await sleep(1100);
      overlays.updateFeed({phase: 'done'});
      await sleep(verdict.allow ? 650 : 350);
    },
    onLeaveGate(which) {
      const refresh = () => { const shot = snap(which); panel.setSnapshot(which, shot); overlays.updateFeed({snapshot: shot, box: null}); };
      setTimeout(refresh, 700);
      overlays.hideFeed(3200);
    },
  }});

  const actions = {
    interact: () => onInteract(),
    toast: text => overlays.toast(esc(text)),
    approve(id) { sim.approve(id); },
    resolveAlert(id, decision, reason) { sim.resolveAlert(id, decision === 'open' ? 'open' : 'deny', reason); },
    manualOpen(reason) { if (sim.state.gate !== 'closed') return; sim.manualGate('open', reason); traffic.pulse(5000); },
    simulate(kind, {fromX = -70, quiet = false} = {}) {
      const presence = sim.state.presence;
      const parkedIds = new Set([...presence.values()].map(p => p.vehicleId));
      const pickOne = list => list[Math.floor(Math.random() * list.length)];
      // Every button press says what happens, including when the car has to queue.
      const say = (key, plate) => { if (!quiet) overlays.toast(`${icon('car')}<span>${esc(t(key, {plate}))}${traffic.queued > 1 ? ` · ${esc(t('gate.sim.queued'))}` : ''}</span>`, 'info'); };
      const blocked = () => { if (!quiet && sim.state.alerts.some(a => a.status === 'open')) overlays.toast(`${icon('alert')}<span>${esc(t('gate.sim.waitingAlert'))}</span>`); };
      if (kind === 'exit') {
        const keys = traffic.parkedKeys().filter(k => presence.get(k)?.type !== 'vip');
        if (!keys.length) return;
        const k = pickOne(keys);
        traffic.leave(k);
        if (!quiet) overlays.toast(`${icon('arrowOut')}<span>${esc(t('gate.sim.leaving', {plate: presence.get(k)?.plate}))}</span>`, 'info');
        blocked();
        return;
      }
      if (kind === 'unknown') {
        const free = UNKNOWN_PLATES.filter(([p, pr]) => !traffic.isArriving(sim.key(p, pr)));
        if (!free.length) return;
        const [plate, province] = pickOne(free);
        traffic.arrive({plate, province, color: Math.floor(Math.random() * 9), fromX});
        say('gate.sim.coming', plate); blocked();
        return;
      }
      const pool = sim.state.vehicles.filter(v => v.enabled && v.sync === 'synced' && !parkedIds.has(v.id) && !traffic.isArriving(sim.key(v.plate, v.province)) && (kind === 'visitor' ? v.type === 'guest' && v.validFrom <= sim.now() && v.validTo >= sim.now() : v.type === 'staff'));
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
    if (kind === 'markLeft') traffic.vanish(sim.key(payload.plate, payload.province));
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
  story.subscribe(() => { quietAmbient = story.running; renderBar(); onStoryChange(story); });

  // Story bar below the viewport -----------------------------------------
  function renderBar() {
    const s = story;
    const dots = Array.from({length: s.total}, (_, i) => `<i class="${i < s.index ? 'done' : i === s.index ? 'now' : ''}"></i>`).join('');
    const main = !s.running
      ? `<button class="primary-button" data-bar="play">${icon('play')}<span>${t('story.play')}</span></button>`
      : s.auto
        ? `<button class="primary-button" data-bar="${s.paused ? 'resume' : 'pause'}">${icon(s.paused ? 'play' : 'pause')}<span>${t(s.paused ? 'story.resume' : 'story.pause')}</span></button>`
        : `<button class="primary-button" data-bar="next"${s.waitingForNext ? ' data-cue="true"' : ''}>${icon('next')}<span>${t('next')}</span></button>`;
    bar.innerHTML = `<div class="pk-bar-main">${main}${s.running ? `<button data-bar="restart">${icon('restart')}<span>${t('story.restart')}</span></button><button data-bar="free">${icon('hand')}<span>${t('story.free')}</span></button>` : ''}
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
    if (what === 'restart') story.play({auto: story.auto});
    if (what === 'free') { story.stop(); panel.show('gate'); overlays.toast(esc(t('story.freeMode'))); }
    if (what === 'phone') { onInteract(); phone.setOpen(!phone.isOpen); }
    renderBar();
  });
  bar.addEventListener('change', e => { if (e.target.dataset.bar === 'auto') story.setAuto(e.target.checked); });

  // Ambient life while the car park is on screen
  function scheduleAmbient() {
    clearTimeout(ambientTimer);
    ambientTimer = setTimeout(() => {
      if (active && !quietAmbient && !traffic.busy && document.visibilityState === 'visible') {
        const s = sim.stats();
        if (s.parked > 40 || (s.parked > 22 && Math.random() < .45)) actions.simulate('exit');
        else if (Math.random() < .12) actions.simulate('unknown', {quiet: true});
        else actions.simulate('registered', {quiet: true});
      }
      scheduleAmbient();
    }, 16000 + Math.random() * 12000);
  }
  function schedulePass() {
    clearTimeout(passTimer);
    // Through-traffic runs whenever the street is on screen (overview and car park), not only in the parking stop.
    passTimer = setTimeout(() => { if (lot.root.visible && document.visibilityState === 'visible') traffic.passBy(); schedulePass(); }, 1800 + Math.random() * 3200);
  }
  // Unknown cars that nobody answers are turned away after a while in free play.
  setInterval(() => {
    if (story.running) return;
    for (const a of sim.state.alerts) if (a.status === 'open' && sim.now() - a.at > 45000) sim.resolveAlert(a.id, 'deny', undefined, 'staff.guard');
  }, 5000);

  onLang(() => { panel.render(); phone.render(); overlays.refresh(); story.refreshCaption(); renderBar(); });
  traffic.syncParked();
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
      scheduleAmbient();
    },
    exit() {
      active = false;
      story.stop();
      document.body.classList.remove('parking-active');
      layer.hidden = true; panelRoot.hidden = true; bar.hidden = true;
      phone.setOpen(false);
      clearTimeout(ambientTimer);
    },
    get active() { return active; },
    // Runs the story once (the showcase loop calls this) and resolves when it ends or stops.
    playStory({auto = true} = {}) { story.setAuto(auto); return story.play({auto}); },
    stopStory() { story.stop(); },
    setNight(night) { lot.setNight(night); },
    toggleLang() { setLang(getLang() === 'en' ? 'th' : 'en'); },
    setInteractHandler(fn) { interactHandler = fn; },
    dispose() { story.stop(); clearTimeout(ambientTimer); clearTimeout(passTimer); lot.dispose(); disposeCars(); },
  };
}
