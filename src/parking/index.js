// Parking access demo inside the OSD building showcase. Everything is simulated locally.
import * as THREE from 'osd/node_modules/three/build/three.module.js';
import {t, onLang, getLang, setLang} from './texts.js';
import {icon, esc} from 'osd/core/dom.js';
import {createParkingSim} from './sim.js';
import {createLot} from './lot3d.js';
import {createPanel} from './panel.js';
import {createPhone} from './phone.js';
import {createOverlays} from './overlays.js';
import {wireStoryBar, onViewTaken, tapCues} from 'osd/core/story-bar.js';
import {createParkingWorld} from './world.js';
import {CAR, disposeCars} from './cars.js';

export const PARKING_POSES = {
  lot: {eye: [-4, 30, 52], target: [-33, 0.5, 3], fov: 42},
  // From across the street: the road, its junction with the entrance road, and the barrier.
  gate: {eye: [-4, 12, 45], target: [-24, 1, 21], fov: 40},
  rowA: {eye: [-14, 13, 24], target: [-30.5, 0.5, 7], fov: 44},
};

export function createParking({scene, schedule, camera = null, renderer, afterRender, capture, fly}) {
  const $ = (s) => document.querySelector(s);
  const layer = $('#parking-layer'),
    panelRoot = $('#parking-panel'),
    phoneRoot = $('#pk-phone'),
    bar = $('#parking-bar');
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule, renderer});
  let active = false;
  const abort = new AbortController();

  // Plate camera: snapshot plus where the plate sits in the frame, or null when the camera cannot read it: the plate
  // faces away, is behind the lens (projected corners would flip into the frame), or is not wholly in the picture.
  const corner = new THREE.Vector3(),
    plateNormal = new THREE.Vector3(),
    toCamera = new THREE.Vector3();
  function plateBox(camera, agent) {
    agent.car.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    agent.car.localToWorld(corner.set(0, CAR.plateY, CAR.frontPlateZ));
    camera.getWorldPosition(toCamera).sub(corner);
    plateNormal.set(0, 0, 1).transformDirection(agent.car.matrixWorld);
    if (plateNormal.dot(toCamera) <= 0) return null;
    let x0 = 1,
      y0 = 1,
      x1 = 0,
      y1 = 0;
    for (const [dx, dy] of [
      [-0.31, -0.15],
      [0.31, -0.15],
      [0.31, 0.15],
      [-0.31, 0.15],
    ]) {
      corner.set(dx, CAR.plateY + dy, CAR.frontPlateZ + 0.02);
      agent.car.localToWorld(corner).project(camera);
      if (corner.z < -1 || corner.z > 1) return null;
      const x = (corner.x + 1) / 2,
        y = (1 - corner.y) / 2;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const pad = 0.02;
    return {x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2};
  }
  const snap = (which) => capture(lot.cameras[which]);
  // The car each plate camera is reading.
  const reading = {in: null, out: null};

  // Live LPR feed: after each 3D frame, draw the gate camera into the pop-up's picture area of the same canvas
  // (a scissored viewport), and place the plate box from that camera. Costs one extra render while it shows.
  let live = null;
  const liveSize = new THREE.Vector2(),
    liveViewport = new THREE.Vector4(),
    liveScissor = new THREE.Vector4();
  function drawLiveFeed() {
    const area = active && live ? overlays.feedView() : null;
    if (!area) return;
    const canvas = renderer.domElement,
      c = canvas.getBoundingClientRect(),
      r = area.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const x = r.left - c.left,
      y = c.bottom - r.bottom; // three.js viewports count from the bottom, in CSS pixels
    const {camera, agent} = live;
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    renderer.getViewport(liveViewport);
    renderer.getScissor(liveScissor);
    renderer.getSize(liveSize);
    const scissorTest = renderer.getScissorTest();
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    renderer.setViewport(liveViewport);
    renderer.setScissor(liveScissor);
    renderer.setScissorTest(scissorTest);
    overlays.setFeedBox(agent.car.parent ? plateBox(camera, agent) : null);
  }
  afterRender.add(drawLiveFeed);

  // The console, the pop-ups and the phone call `actions`: the world's, plus the page's own (filled in below).
  const actions = {};
  const panel = createPanel({root: panelRoot, sim, actions});
  const phone = createPhone({root: phoneRoot, sim, actions: {openChanged: () => renderBar()}});
  const overlays = createOverlays({layer: $('#pk-overlays'), sim, actions});
  const say = (ic, key, vars, tone, queued) =>
    overlays.toast(
      `${icon(ic)}<span>${esc(t(key, vars))}${queued ? ` · ${esc(t('gate.sim.queued'))}` : ''}</span>`,
      tone,
    );

  const parking = createParkingWorld({
    lot,
    sim,
    camera,
    phone,
    watched: () => active,
    ui: {
      panel,
      overlays,
      schedule,
      snapshot: snap,
      fly: (name, ms) => fly(PARKING_POSES[name], ms),
      caption(c, hint) {
        overlays.caption(c ? {...c, hint: hint && t(hint)} : null);
      },
      tap: tapCues,
      toast: say,
      // The plate camera reads: the pop-up shows the gate camera live (the 3D view draws it into its picture area).
      plateRead(which, agent, verdict, confidence) {
        reading[which] = agent;
        live = {camera: lot.cameras[which], agent};
        overlays.showFeed({which, phase: 'reading', plate: agent.plate, province: agent.province, verdict, confidence});
        schedule();
      },
      // Read: the Gate tab's picture from that camera is this capture, the car at the line with its plate in view, kept
      // until the next car (as a plate camera shows its last capture). Taken as the read began, the car was still rolling
      // up, half out of the picture; retaken after each car had gone, it showed an empty road or the arm mid-swing.
      // Not of a car no longer there (a reset during the read removes every car at once: its capture landed in the new
      // run, of a car from the old one), nor with the car park hidden (another floor shown during the read: the camera saw
      // only grass); the last capture stays then.
      plateDone(which) {
        if (reading[which]?.car.parent === lot.root && lot.root.visible) panel.setSnapshot(which, snap(which));
        reading[which] = null;
        overlays.updateFeed({phase: 'done'});
      },
      full(plate) {
        say('alert', 'gate.full', {plate});
      },
      leftGate() {
        overlays.hideFeed(3200);
      },
      event(kind, payload) {
        if (kind === 'request' && payload?.status === 'pending' && payload.history.length === 1) {
          panel.markNew(payload.id);
          overlays.toast(
            `${icon('inbox')}<span><b>${esc(t('att.pending'))}</b> ${esc(payload.visitor.name)} · ${esc(payload.plate)}</span>`,
            'info',
          );
        }
        // A presenter's own unknown car brings up the Gate tab; a background one does not (every few minutes it closed
        // the request or reason being worked on).
        if (kind === 'alert') {
          overlays.showAlert(payload.id);
          if (!story.running && !payload.ambient) panel.show('gate');
        }
        if (kind === 'entry' || kind === 'exit') panel.flash(payload.id);
        if (kind === 'alertReason') overlays.refresh(); // the pop-up shows the card's pick
        // Which email went (a rejection or revocation said "Ticket emailed" too).
        if (kind === 'email')
          overlays.toast(
            `${icon('check')}<span>${esc(t(payload.kind === 'approved' ? 'req.emailSent' : `req.emailSent.${payload.kind}`))}</span>`,
            'ok',
          );
        panel.render();
      },
      storyChanged() {
        renderBar();
        panel.render();
      }, // the Gate tab's test buttons too
    },
  });
  const {traffic, story} = parking;
  Object.assign(actions, parking.actions, {
    feedChanged: () => schedule(),
    toast: (text) => overlays.toast(esc(text)),
    // A camera with no car read yet shows what it sees now; one that has read a car keeps that capture.
    gateShown() {
      for (const which of ['in', 'out']) if (!panel.hasSnapshot(which)) panel.setSnapshot(which, snap(which));
    },
  });
  // A presenter working the console or the alert during the story: a cue on auto-advance waits for them.
  for (const el of [panelRoot, $('#pk-overlays')])
    for (const type of ['pointerdown', 'keydown'])
      el.addEventListener(
        type,
        () => {
          if (story.running) story.touched();
        },
        {capture: true},
      );

  // Story bar below the viewport -----------------------------------------
  const renderBar = wireStoryBar(bar, {
    story,
    idle: () => t('story.idle'),
    more: () =>
      `<button class="pk-phone-toggle" data-bar="phone" aria-pressed="${phone.isOpen}">${icon('phone')}<span>${phone.isOpen ? t('ph.hide') : t('ph.show')}</span></button>`,
    leave: leaveStory,
    buttons: {phone: () => phone.setOpen(!phone.isOpen)},
    caption: $('#pk-overlays .pk-caption'),
    signal: abort.signal,
  });

  // Leaving the story. A playing story also ends as soon as the visitor takes over:
  // dragging or zooming the 3D view, or picking a console tab (on auto-advance; in Next mode the presenter may
  // look around between steps). Esc always ends it. Cued buttons, the phone and the story bar are part of it.
  function leaveStory() {
    if (!story.running) return;
    story.stop();
    panel.show('gate');
    overlays.toast(esc(t('story.freeMode')));
    renderBar();
  }
  const viewport = $('#viewport');
  const takeOver = (event) => {
    if (!active || !story.running || !story.auto) return;
    // Nor the plate camera card (it is not the view: a tap on it ended the story). A toast lets taps through to the view
    // under it, so a tap there is one on the view.
    if (event.target.closest?.('#pk-phone, .pk-caption, .pk-alert-pop, .pk-feed, #view-orbit')) return;
    leaveStory();
  };
  onViewTaken(viewport, takeOver, {signal: abort.signal});
  panelRoot.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-tab]')) takeOver(event);
    },
    {capture: true},
  );
  onLang(() => {
    panel.render();
    phone.render();
    overlays.refresh();
    story.refreshCaption();
    renderBar();
  });
  renderBar();
  panel.render();

  return {
    sim,
    story,
    lot,
    traffic,
    enter() {
      active = true;
      document.body.classList.add('parking-active');
      layer.hidden = false;
      panelRoot.hidden = false;
      bar.hidden = false;
      panel.render();
      renderBar();
    },
    exit() {
      active = false;
      story.stop();
      document.body.classList.remove('parking-active');
      layer.hidden = true;
      panelRoot.hidden = true;
      bar.hidden = true;
      phone.setOpen(false);
    },
    get active() {
      return active;
    },
    // Runs the story once (the `story` option) and resolves when it ends or stops.
    playStory(options) {
      return parking.playStory(options);
    },
    stopStory() {
      story.stop();
    },
    setNight(night) {
      lot.setNight(night);
      traffic.setNight(night);
    },
    toggleLang() {
      setLang(getLang() === 'en' ? 'th' : 'en');
    },
    dispose() {
      abort.abort();
      afterRender.delete(drawLiveFeed);
      parking.dispose();
      lot.dispose();
      disposeCars();
    },
  };
}

// The car park without any UI, for the free-exploration page (#explore): the lot, parked cars, through-traffic, and
// staff cars coming and going through the barrier (the parking world, staff only).
export function createParkingScene({scene, schedule, camera = null, renderer = null}) {
  const sim = createParkingSim();
  const lot = createLot({scene, stalls: sim.state.stalls, schedule, renderer});
  const w = createParkingWorld({lot, sim, camera, staffOnly: true, ui: {schedule}});
  return {
    lot,
    setNight(night) {
      lot.setNight(night);
      w.traffic.setNight(night);
    },
    dispose() {
      w.dispose();
      lot.dispose();
      disposeCars();
    },
  };
}
