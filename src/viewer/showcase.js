import {createBuildingInsights} from 'osd/viewer/building-insights.js';
import {createTourEffects} from 'osd/viewer/tour-effects.js';
import {t, onLang, getLang, L, translatePage} from 'osd/viewer/texts.js';
import {later, world} from 'osd/core/clock.js';
import {options} from 'osd/core/options.js';
import {createParkingLayout} from 'osd/viewer/parking-layout.js';
import {placeCornerCard} from 'osd/viewer/corner-card.js';
import {panels} from 'osd/viewer/panels.js';
import {createScenarios} from 'osd/viewer/scenarios.js';
import {stops} from 'osd/viewer/stops.js';
import {MEETING_ROOM, NIGHT_AT, DAY_AT} from 'osd/viewer/building.js';
import {createDirector, onTouch} from 'osd/viewer/director.js';
import {createBuildingStory} from 'osd/viewer/building-story.js';
import {morph} from 'osd/core/dom.js';
import {wireStoryBar, storyCaption, onViewTaken, tapCues} from 'osd/core/story-bar.js';
export function createShowcase({
  model,
  simulation,
  navigate,
  cancelFlight,
  schedule,
  redrawShadows,
  onUserOrbit,
  parking = null,
}) {
  const abort = new AbortController(),
    signal = abort.signal,
    effects = createTourEffects({
      model,
      schedule,
      redrawShadows,
      meetingRoom: simulation.rooms.find((r) => r.id === MEETING_ROOM),
    });
  const $ = (s) => document.querySelector(s),
    content = $('#dashboard-content');
  let story = null,
    insights = null,
    flightStopped = false,
    resetAfterFlight = false;
  // landed: the camera reached the current stop's view (a flight cut short leaves it false until a stop or Reset view lands).
  let traveling = false,
    landed = false;
  let destination = 'overview',
    disposed = false,
    sequence = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const listen = (el, event, fn, options) => el.addEventListener(event, fn, {...options, signal});
  const actual = () => simulation.getState().rooms[MEETING_ROOM];
  const scenarios = createScenarios({
    simulation,
    hold: (keys) => insights?.hold(keys),
    changed: () => render(),
    running: () => !disposed && !document.hidden,
    animate(elapsed, time) {
      if (reduced.matches || time - lastVisual < 50) return;
      effects.animate(elapsed);
      effects.update({...state, climate: actual().climate, light: actual().light});
      lastVisual = time;
    },
  });
  const {state} = scenarios,
    stopScenario = scenarios.stop;
  let lastVisual = 0;
  // What a stop's panel shows (panels.js).
  const shown = {state, history: (key) => insights.history(key), timeLabel: () => insights?.timeLabel() ?? ''};
  const setParkingLayout = createParkingLayout({
    parking,
    // Screenshots (`manual`): at once, as a view transition runs on real time and was caught part way.
    instant: () => reduced.matches || document.hidden || 'manual' in options,
    disposed: () => disposed,
  });
  function render() {
    if (disposed) return;
    const s = actual(),
      sim = simulation.getState(),
      d = stops[destination];
    const focused = document.activeElement?.dataset?.control || document.activeElement?.dataset?.action;
    effects.update({...state, climate: s.climate, light: s.light});
    $('#panel-title').textContent = d.panel;
    $('#panel-status').textContent =
      destination === 'pond' && state.pondAlert
        ? L('ควรตรวจสอบ', 'Check needed')
        : destination === 'meeting'
          ? state.occupied
            ? L('มีคนใช้งาน', 'In use')
            : L('ห้องว่าง', 'Vacant')
          : L('ปกติ', 'Normal'); // simulated data is said once, in the header
    $('#panel-status').classList.toggle('attention', destination === 'pond' && state.pondAlert);
    // Updated in place (morph), not rebuilt: a rebuilt button under the pointer lost its hover on every refresh.
    const next = document.createElement('template');
    next.innerHTML = panels[destination]?.({...shown, sim, room: s}) ?? '';
    const action = next.content.querySelector('.panel-action'),
      section = next.content.querySelector('.dashboard-section');
    if (destination !== 'overview' && action && section) section.before(action);
    if (action && story?.cue) action.dataset.cue = 'true';
    morph(content, next.content);
    if (focused)
      content.querySelector(`[data-control="${focused}"],[data-action="${focused}"]`)?.focus({preventScroll: true});
    $('#tour-night').setAttribute('aria-pressed', String(sim.night));
    $('#tour-night span').textContent = sim.night ? L('กลางวัน', 'Day') : L('กลางคืน', 'Night');
    content.inert = traveling;
    content.setAttribute('aria-busy', String(traveling));
    $('#tour-night').disabled = traveling;
    if (traveling) $('#panel-status').textContent = L('กำลังเดินทาง', 'On the way');
    else
      $('#scene-chip').textContent = flightStopped
        ? L('หยุดเคลื่อนกล้องแล้ว · เลือกจุดที่ต้องการชมต่อ', 'Flight stopped · orbit to explore or pick the next spot')
        : d.chip;
    insights?.update({destination, traveling, landed, state, sim});
  }
  async function select(id, {guided = false, instant = false} = {}) {
    if (!stops[id] || disposed) return false;
    // A visitor's own pick: the story ends, and a paused day runs again.
    if (!guided) {
      story.stop();
      if (world.paused) world.setPaused(false);
    }
    stopScenario();
    const ticket = ++sequence,
      d = stops[id];
    // The car park changes the page layout: switch it as the flight sets off, so the view is its final size while the
    // camera moves instead of jumping at the end.
    setParkingLayout(id === 'parking');
    traveling = true;
    landed = false;
    flightStopped = resetAfterFlight = false;
    effects.select(null);
    render();
    document.querySelectorAll('[data-destination]').forEach((b) => {
      b.setAttribute('aria-busy', String(b.dataset.destination === id));
      b.setAttribute('aria-pressed', String(b.dataset.destination === id));
    });
    // The stop's title, panel and scene state arrive as the final approach begins, not after the camera settles.
    let committed = false;
    const commit = () => {
      if (committed || disposed || ticket !== sequence) return;
      committed = true;
      destination = id;
      document.body.dataset.tourDestination = id;
      $('#scene-heading').textContent = d.panel;
      $('#scene-floor').textContent = d.floor;
      $('#scene-chip').textContent = d.chip;
      effects.select(id);
      // The meeting stop's controls act on its room: select it on arrival, so night lighting is laid out around it
      // from the start and its switch only changes that room.
      if (id === 'meeting') simulation.selectRoom(MEETING_ROOM);
      render();
    };
    const arrived = await navigate(id, {
      instant,
      onApproach: commit,
      onPhase(phase) {
        if (ticket === sequence) {
          $('#scene-chip').textContent = `${phase} → ${d.floor} · ${d.panel}`;
          $('#flight-status').textContent = L(`กำลังไป ${d.floor} · ${d.panel}`, `Heading to ${d.floor} · ${d.panel}`);
        }
      },
    });
    if (disposed || ticket !== sequence) return false;
    // The parking story started on the way (its camera move ends this flight): the car park is the stop all the same
    // (committed first, so the dock shows it).
    if (!arrived && !committed && id === 'parking' && parking?.story.running) commit();
    traveling = false;
    landed = Boolean(arrived);
    document.querySelectorAll('[data-destination]').forEach((b) => {
      b.removeAttribute('aria-busy');
      b.setAttribute('aria-pressed', String(b.dataset.destination === (arrived || committed ? id : destination)));
    });
    // Reset view pressed during the flight: it flies back to the stop on show once this flight has ended.
    if (resetAfterFlight) {
      resetAfterFlight = false;
      queueMicrotask(resetView);
    }
    if (!arrived && !committed) {
      // Shown until the next flight (render() wrote over it at once, so it never showed).
      flightStopped = true;
      effects.select(destination);
      setParkingLayout(destination === 'parking');
      render();
      return false;
    }
    // The floor transition ends by restoring the visibility it captured when it began; re-apply this stop's effects.
    commit();
    effects.select(id);
    render();
    return true;
  }

  // The building's story (building-story.js): it flies the camera with select, and works each stop's own buttons.
  const storySet = scenarios.story.set;
  story = createBuildingStory({
    select,
    prepare: scenarios.story.prepare,
    act: scenarios.story.act,
    restore() {
      if (disposed) return;
      stopScenario();
      insights?.backToSchedule(storySet, storySet.has('occupied') ? MEETING_ROOM : null);
    },
    tap: tapCues,
    changed() {
      if (!story.running) storySet.clear();
      renderStory();
      render();
    },
  });
  // Its bar under the timeline and its caption on the 3D view: the car park's story's (story-bar.js).
  const stage = $('#viewport'),
    storyBarEl = $('#story-bar'),
    caption = $('#story-caption');
  const renderBar = wireStoryBar(storyBarEl, {
    story,
    idle: () => t('story.idleBuilding'),
    leave: () => story.stop(),
    caption,
    signal,
  });
  function renderStory() {
    renderBar();
    const c = story.caption;
    caption.hidden = !c;
    stage.classList.toggle('building-story', Boolean(c));
    caption.innerHTML = c
      ? storyCaption({
          step: t('story.step', {n: story.index + 1, total: story.total}),
          title: L(...c.title),
          body: L(...c.body),
          hint: c.hint && L(...c.hint),
        })
      : '';
  }
  // The visitor takes over, as from the car park's: the 3D view (on auto-advance; Next by Next, the presenter may look
  // around between steps), or Esc. Taking the view, they go on from what they see (the press may be on a device: put
  // back to the schedule under it, the light they saw off was on, and their tap switched it off).
  onViewTaken(
    stage,
    (event) => {
      if (story.running && story.auto && !event.target.closest?.('.pk-caption, #view-orbit')) story.stop({keep: true});
    },
    {signal},
  );
  signal.addEventListener('abort', () => story.stop(), {once: true});
  // Free play, the parking story, and back to the start after a quiet minute: the director's (director.js). Its minute
  // runs on real time (a paused day stops the engine's clock); not on stepped pages (`manual`, the screenshots), whose
  // real time has nothing to do with what they show.
  const director = createDirector({
    select,
    cancelFlight,
    parking,
    building: story,
    current: () => destination,
    landed: () => landed,
    hidden: () => document.hidden,
    // Not on stepped pages, nor a page opened at a stop (rehearsals).
    followFromStart: !('manual' in options) && !options.dest,
    ui: {stopScenario, render, followChanged: () => insights?.paint()},
    after: (fn, ms) => ('manual' in options ? null : setTimeout(fn, ms)),
    cancel: (handle) => clearTimeout(handle),
  });
  signal.addEventListener('abort', () => director.dispose(), {once: true});
  // A press anywhere in the panel: its buttons stay as they are until it is let go. Enter held down presses once (its
  // repeats went on to press what the button had become).
  for (const type of ['pointerdown', 'keydown'])
    listen($('.context-panel'), type, (event) => {
      story.pressing();
      if (event.repeat && event.key === 'Enter' && event.target.closest('[data-action]')) event.preventDefault();
    });
  listen(content, 'click', (event) => {
    const control = event.target.closest('[data-control]'),
      action = event.target.closest('[data-action]');
    // The button the story waits for: pressed for it. Any other is the visitor's own.
    if (action && story.cue) {
      story.press();
      return;
    }
    if (control || action) story.stop({keep: true});
    if (control) {
      stopScenario();
      const s = actual(),
        key = control.dataset.control;
      simulation.selectRoom(MEETING_ROOM);
      if (key === 'door')
        simulation.setRoom(MEETING_ROOM, {
          doors: Object.fromEntries(Object.entries(s.doors).map(([id, value]) => [id, !value])),
        });
      else simulation.setRoom(MEETING_ROOM, {[key]: !s[key]});
      render();
    }
    if (action && !traveling) scenarios.start(action.dataset.action);
  });
  document.querySelectorAll('[data-destination]').forEach((b) => {
    b.disabled = false;
    listen(b, 'click', () => void select(b.dataset.destination));
  });
  $('#tour-night').disabled = false;
  // Night and day are the world clock's: the button moves it on to 20:00, or to 07:30.
  listen($('#tour-night'), 'click', () => {
    story.stop();
    if (parking?.story.running) parking.stopStory();
    insights?.jumpTo(simulation.getState().night ? DAY_AT : NIGHT_AT);
  });
  const unsubscribe = simulation.subscribe(() => render());
  placeCornerCard({stage, corner: $('.scene-top-right'), titleCard: $('.scene-title'), signal});
  // A device tapped in the 3D view is the visitor's own, as the panel's switches are: it ends the story and a scenario
  // under way (the room went on cooling with its AC switched off).
  simulation.setInteractionFilter((room) => {
    const allowed = !traveling && destination === 'meeting' && room.id === MEETING_ROOM;
    if (allowed) {
      story.stop({keep: true});
      stopScenario();
    }
    return allowed;
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) director.hiddenPage();
  });
  // Dragging or zooming the 3D view takes it from a flight under way.
  onUserOrbit(() => cancelFlight());
  insights = createBuildingInsights({
    model,
    simulation,
    schedule,
    read: () => state,
    write: (value) => {
      Object.assign(state, structuredClone(value));
    },
    render,
    navigate: (id) => select(id, {guided: true}),
    // A parking story played on its own (the `story` option, the bar's Play) stops too: it holds the clock, and set a jump back.
    stopActivity: (options) => director.stopActivity(options),
    followState: () => director.follow,
    toggleFollow: () => director.toggleFollow(),
  });
  // Every touch on the page starts the quiet minute again. Outside the 3D view, one that presses or types into nothing is
  // only reading (the page scrolled by a wheel, a finger or the keys), not taking over: a press counts at its click,
  // which a finger that scrolls never gets to; the slider's at once.
  const CONTROL = 'button, a, input, select, textarea, label, summary, [data-request]';
  onTouch(
    (event) => {
      const on = (selector) => Boolean(event.target.closest?.(selector)),
        uses = on('#viewport, #day-time') || (on(CONTROL) && ['click', 'keydown'].includes(event.type));
      director.touch({
        own: !uses || on('#day-follow, #day-pause, #day-speed, #lang-toggle'),
        land: on('.parking-bar'),
      });
    },
    {signal},
  );
  // Runs on every TH/EN switch: static markup, then everything the showcase draws itself.
  function applyLanguage() {
    const en = getLang() === 'en';
    $('#lang-toggle span').textContent = en ? 'TH' : 'EN';
    translatePage();
    const d = stops[destination];
    $('#scene-heading').textContent = d.panel;
    $('#scene-floor').textContent = d.floor;
    insights?.relabel();
    renderStory();
    render();
  }
  listen($('#lang-toggle'), 'click', () => parking?.toggleLang());
  const offLang = onLang(applyLanguage);
  signal.addEventListener('abort', offLang, {once: true});
  applyLanguage();
  void select('overview', {instant: true});
  // Options (rehearsals, screenshots): on the engine's clock, so a stepped page (`manual`) starts them at the same moment.
  const dest = options.dest;
  if (dest && stops[dest])
    later(async () => {
      const arrived = await select(dest);
      if (arrived && dest === 'parking' && options.story === '1') void parking?.playStory({auto: options.auto !== '0'});
    }, 300);
  // Back to the current stop's own camera pose (the view controls and the R key use this).
  // During a flight it stops the flight, then flies to the stop on show (the flight's own stop once its approach has
  // begun): it only stopped the camera mid-air, as the flight had not yet ended when it looked.
  function resetView() {
    if (disposed) return;
    if (traveling) {
      resetAfterFlight = true;
      cancelFlight();
      return;
    }
    cancelFlight();
    landed = false;
    flightStopped = false;
    render();
    void navigate(destination).then((arrived) => {
      if (arrived && !disposed && !traveling) {
        landed = true;
        render();
      }
    });
  }
  return {
    resetView,
    beforeDraw: () => effects.beforeDraw(),
    dispose() {
      disposed = true;
      sequence++;
      insights?.dispose();
      stopScenario();
      unsubscribe();
      simulation.setInteractionFilter(() => true);
      abort.abort();
      effects.dispose();
    },
    getState() {
      return {traveling, story: story.running};
    },
  };
}
