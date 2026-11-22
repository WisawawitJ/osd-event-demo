// Parking access demo inside the OSD building showcase. Everything is simulated locally.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {t, onLang, getLang, setLang, bkk} from './i18n.js';
import {icon, esc} from './dom.js';
import {createParkingSim, STORY} from './sim.js';
import {later, cancelLater, sleep, world, demoNow, minuteOf, rng} from './clock.js';
import {createLot} from './lot3d.js';
import {createTraffic} from './traffic.js';
import {createPanel} from './panel.js';
import {createPhone} from './phone.js';
import {createOverlays} from './overlays.js';
import {createStory} from './story.js';
import {CAR, disposeCars} from './cars.js';

export const PARKING_POSES = {
  lot: {eye: [-4, 30, 52], target: [-33, .5, 3], fov: 42},
  // From across the street: the road, its junction with the entrance road, and the barrier.
  gate: {eye: [-4, 12, 45], target: [-24, 1, 21], fov: 40},
  rowA: {eye: [-14, 13, 24], target: [-30.5, .5, 7], fov: 44},
};
import {STORY_START, storyCar, UNKNOWN_PLATES, pickOne, lotOnScreen, parkedPlate, streetGap, idleCars, fromFarLane, leavingCandidates, startLotLife} from './life.js';

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
      const confidence = .9 + rng() * .09;
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
    storyRunning: () => story.running,
    // A tap on what the story cues (Approve, Deny, the photo button) is the presenter going along with it, not taking
    // over: it ended the building tour or Follow the day the story was part of, and the story with it.
    interact: el => { if (story.running && el?.closest?.('[data-cue="true"]')) return; onInteract(); },
    feedChanged: () => schedule(),
    toast: text => overlays.toast(esc(text)),
    approve(id) { sim.approve(id); },
    resolveAlert(id, decision, reason) { sim.resolveAlert(id, decision === 'open' ? 'open' : 'deny', reason); },
    // While an unknown car's alert holds the barrier, the answer is Open/Deny on that alert, not a blind pulse.
    manualOpen(reason) { if (sim.state.gate !== 'closed' || sim.state.alerts.some(a => a.status === 'open')) return; sim.manualGate(reason); traffic.pulse(5000); },
    // `west`: the car comes along the far lane (by default a third do; the story's own steps keep the near lane).
    simulate(kind, {fromX = -70, quiet = false, west = fromFarLane()} = {}) {
      const presence = sim.state.presence;
      // Every button press says what happens, including when the car has to queue.
      const say = (key, plate) => { if (!quiet) overlays.toast(`${icon('car')}<span>${esc(t(key, {plate}))}${traffic.queued > 1 ? ` · ${esc(t('gate.sim.queued'))}` : ''}</span>`, 'info'); };
      const blocked = () => { if (!quiet && sim.state.alerts.some(a => a.status === 'open')) overlays.toast(`${icon('alert')}<span>${esc(t('gate.sim.waitingAlert'))}</span>`); };
      if (kind === 'exit') {
        // Pressed by hand, any parked car may be the one (a visitor too); the background's own departures are not.
        const keys = leavingCandidates(sim, traffic, {guests: !quiet});
        if (!keys.length) return;
        const k = pickOne(keys);
        traffic.leave(k, {west: fromFarLane()});
        if (!quiet) overlays.toast(`${icon('arrowOut')}<span>${esc(t('gate.sim.leaving', {plate: presence.get(k)?.plate}))}</span>`, 'info');
        blocked();
        return;
      }
      if (kind === 'unknown') {
        const free = UNKNOWN_PLATES.filter(([p, pr]) => !traffic.isAround(sim.key(p, pr)) && !presence.has(sim.key(p, pr)));
        if (!free.length) return;
        const [plate, province] = pickOne(free);
        traffic.arrive({plate, province, color: Math.floor(rng() * 9), fromX, ambient: quiet, west});
        say('gate.sim.coming', plate); blocked();
        return;
      }
      const pool = kind === 'visitor'
        ? sim.state.vehicles.filter(v => v.type === 'guest' && v.enabled && v.sync === 'synced' && !parkedPlate(sim, v) && !traffic.isAround(sim.key(v.plate, v.province)) && v.validFrom <= sim.now() && v.validTo >= sim.now())
        : idleCars(sim, traffic, {staffOnly: !quiet}); // the Staff car button sends a staff car, never a VIP
      // The newest approved visitor drives up first, so a request made on the phone can be followed to the gate.
      const v = kind === 'visitor' ? pool[pool.length - 1] : pickOne(pool);
      if (!v) { if (!quiet) overlays.toast(`${icon('user')}<span>${esc(t(kind === 'visitor' ? 'gate.sim.noVisitor' : 'gate.sim.noStaff'))}</span>`); return; }
      traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX, west});
      say('gate.sim.coming', v.plate); blocked();
    },
  };

  actions.gateShown = () => { for (const which of ['in', 'out']) panel.setSnapshot(which, snap(which)); };
  const panel = createPanel({root: panelRoot, sim, actions});
  const phone = createPhone({root: phoneRoot, sim, actions: {interact: actions.interact, openChanged: () => renderBar()}});
  const overlays = createOverlays({layer: $('#pk-overlays'), sim, actions});
  // A presenter working the console or the alert during the story: a cue on auto-advance waits for them.
  for (const el of [panelRoot, $('#pk-overlays')]) for (const type of ['pointerdown', 'keydown']) el.addEventListener(type, () => { if (story.running) story.touched(); }, {capture: true});

  sim.subscribe((kind, payload) => {
    if (kind === 'request' && payload?.status === 'pending' && payload.history.length === 1) {
      panel.markNew(payload.id);
      overlays.toast(`${icon('inbox')}<span><b>${esc(t('att.pending'))}</b> ${esc(payload.visitor.name)} · ${esc(payload.plate)}</span>`, 'info');
    }
    // A presenter's own unknown car brings up the Gate tab; a background one does not (every few minutes it closed the
    // request or reason being worked on).
    // The story's own cars reaching the barrier after it was left (its unknown car, or its visitor with no pass) are
    // background ones: turned away after 8 s, the console left where it is (they took the 45 s a presenter's own car
    // gets, and switched the console to the Gate tab, for a car nobody had sent).
    if (kind === 'alert' && !story.running && storyCar(payload)) payload.ambient = true;
    if (kind === 'alert') { overlays.showAlert(payload.id); if (!story.running && !payload.ambient) panel.show('gate'); }
    if (kind === 'entry' || kind === 'exit') panel.flash(payload.id);
    if (kind === 'alertReason') overlays.refresh(); // the pop-up shows the card's pick
    // Which email went (a rejection or revocation said "Ticket emailed" too).
    if (kind === 'email') overlays.toast(`${icon('check')}<span>${esc(t(payload.kind === 'approved' ? 'req.emailSent' : `req.emailSent.${payload.kind}`))}</span>`, 'ok');
    panel.render();
  });

  // Story ---------------------------------------------------------------
  let currentHint = null, currentCaption = null;
  const story = createStory({
    sim, panel, phone, overlays, traffic, actions,
    fly: (name, ms) => fly(PARKING_POSES[name], ms),
    cue(name) { panel.setCue(name); overlays.setCue(name); },
    // A hint is a text key, put in the language on show each time (it stayed in the old one after a switch).
    hint(key) { currentHint = key; if (currentCaption) overlays.caption({...currentCaption, hint: key && t(key)}); },
    caption(c) { currentCaption = c; overlays.caption(c ? {...c, hint: currentHint && t(currentHint)} : null); },
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
    // Its unknown car still waiting at the barrier is turned away like a background one (8 s, not a presenter's 45 s:
    // left at step 7, it held the barrier and every car behind it).
    if (storyWasRunning && !story.running) { phone.setCue(null); phone.cancelRead(); for (const a of sim.state.alerts) if (a.status === 'open' && storyCar(a)) a.ambient = true; }
    storyWasRunning = story.running; renderBar(); panel.render(); // the Gate tab's test buttons
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
    // The phone shown or hidden is part of the story's own bar (as in kiosk mode): it ended a tour's story.
    if (what === 'phone') { if (!story.running) onInteract(); phone.setOpen(!phone.isOpen); }
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
    // Nor the plate camera card (it is not the view: a tap on it ended the story). A toast lets taps through to the view
    // under it, so a tap there is one on the view.
    if (event.target.closest?.('#pk-phone, .pk-caption, .pk-alert-pop, .pk-feed, #view-orbit')) return;
    leaveStory();
  };
  viewport.addEventListener('pointerdown', takeOver, {capture: true});
  viewport.addEventListener('wheel', takeOver, {capture: true, passive: true});
  // A view key on the 3D view too (arrows, + −, Page Up/Down, R): the story's next camera move overrode the presenter.
  // As the view reads them: an arrow with any modifier (Ctrl+arrow turns it), the others without, by key place or, from
  // an on-screen keyboard (no key place), by character.
  viewport.addEventListener('keydown', event => {
    if (event.target.tagName !== 'CANVAS') return;
    if (/^Arrow/.test(event.key)) return takeOver(event);
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^Page/.test(event.key) || ['KeyR', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code) || ['r', 'R', '+', '=', '-'].includes(event.key)) takeOver(event);
  }, {capture: true});
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
  // Checked every 250 ms of simulation time (alerts' waits are simulation time too).
  let autoDeny = null;
  const denyLeftAlone = () => {
    if (!story.running) for (const a of sim.state.alerts) if (a.status === 'open' && demoNow() - a.raised > (a.ambient ? 8000 : 45000)) sim.resolveAlert(a.id, 'deny', undefined, 'staff.guard');
    autoDeny = later(denyLeftAlone, 250);
  };
  autoDeny = later(denyLeftAlone, 250);

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
    dispose() { afterRender?.delete(drawLiveFeed); story.stop(); stopLife(); cancelLater(passTimer); cancelLater(autoDeny); lot.dispose(); disposeCars(); },
  };
}

// The car park without any UI, for the free-exploration page (#explore): the lot, parked cars,
// through-traffic, and staff cars coming and going through the barrier.
export function createParkingScene({scene, schedule, camera = null}) {
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule});
  const traffic = createTraffic({lot, sim, schedule, hooks: {}});
  const timers = {};
  const loop = (name, fn, gap) => { const run = () => { fn(); timers[name] = later(run, gap()); }; timers[name] = later(run, gap() * rng()); };
  loop('street', () => { if (lotOnScreen(lot)) traffic.passBy(); }, () => streetGap(world.minute()));
  traffic.syncParked();
  const stopLife = startLotLife({sim, traffic, lot, camera, staffOnly: true,
    arrive() { const v = pickOne(idleCars(sim, traffic, {staffOnly: true})); if (v) traffic.arrive({plate: v.plate, province: v.province, color: v.color, fromX: -70, west: fromFarLane()}); },
    leave() { const keys = leavingCandidates(sim, traffic, {staffOnly: true}); if (keys.length) traffic.leave(pickOne(keys), {west: fromFarLane()}); }});
  return {
    lot, sim, traffic,
    setNight(night) { lot.setNight(night); traffic.setNight(night); },
    dispose() { stopLife(); for (const handle of Object.values(timers)) cancelLater(handle); lot.dispose(); disposeCars(); },
  };
}
