// What the showcase does by itself, without a page: the building tour, "Follow the day", and the kiosk that follows
// the day when left alone and hands over at a touch. It decides what plays next and when to stop; the page
// (showcase.js) flies the camera, draws the panels and reports the visitor's touches. Runs on the engine's clock, so
// Node tests drive it with a stand-in flight and the headless parking world.
import {world, later, cancelLater} from 'osd/parking/clock.js';
import {L} from 'osd/parking/i18n.js';
import {dayEvents} from 'osd/viewer/building-day.js';

export const ORDER = ['overview', 'parking', 'meeting', 'pond', 'energy'];
export const PICK_SPOT = ['เลือกจุดที่สนใจ หรือให้เราพาชม', 'Pick a spot, or let us show you around'];
// The kiosk hands back to the day after this long without a touch (simulation time).
export const IDLE_MS = 60000;

// `select(id, {guided})`: flies to a stop; resolves whether it got there. `flight()`: {traveling, landed} of the last.
// `cancelFlight()`, `parking` (playStory/stopStory/story), `stopName(id)`: a stop's name for the progress line.
// `ui`: progress(message: [th, en] or a function), touring(on), kiosk(on), scenario(id), stopScenario(), render(),
// followChanged() — all optional. `hidden()`: the page is out of sight (another tab).
export function createDirector({select, flight = () => ({traveling: false, landed: true}), cancelFlight = () => {}, parking = null, stopName = id => id, ui = {}, hidden = () => false}) {
  let touring = false, tourGeneration = 0, tourTimer = null, disposed = false;
  let following = false, followed = null, day = 0, storyDay = -1, followTicket = 0;
  let kiosk = false, idleTimer = null;
  const progress = message => ui.progress?.(message);

  // Resolves once the clock runs: at once, or on Resume after a Pause tapped on the way to the car park (its story,
  // started over the Pause, set the clock going again).
  const running = () => !world.paused ? Promise.resolve() : new Promise(done => { const off = world.subscribe(kind => { if (kind === 'rate' && !world.paused) { off(); done(); } }); });

  // `keepStory`: the visitor's touch is on the story's own bar (Exit, Restart): its click, not this, decides the story.
  function stopTour(message = ['หยุดพาชมแล้ว · เลือกจุดต่อไปได้เอง', 'Tour stopped · pick the next spot yourself'], {keepStory = false} = {}) {
    if (touring && !keepStory) parking?.stopStory();
    tourGeneration++; cancelLater(tourTimer); tourTimer = null; touring = false;
    ui.touring?.(false); progress(message);
  }
  async function startTour() {
    stopFollowing();
    if (touring) { stopTour(); cancelFlight(); ui.stopScenario?.(); ui.render?.(); return; }
    world.setPaused(false); // the tour needs time to pass
    const generation = ++tourGeneration; touring = true; ui.touring?.(true);
    let step = 0;
    const current = () => touring && !disposed && generation === tourGeneration;
    async function next() {
      if (!current()) return;
      const id = ORDER[step], at = step + 1;
      progress(() => L(`กำลังพาชม ${at} / ${ORDER.length} · ${stopName(id)}`, `Touring ${at} / ${ORDER.length} · ${stopName(id)}`));
      const arrived = await select(id, {guided: true});
      if (!arrived || !current()) return;
      const advance = () => {
        if (generation !== tourGeneration) return;
        if (step < ORDER.length) { void next(); return; }
        stopTour(['พาชมครบแล้ว · เลือกสำรวจต่อได้ทุกจุด', 'Tour complete · explore any spot you like']); ui.stopScenario?.(); ui.render?.();
        if (kiosk) tourTimer = later(() => { if (kiosk && !touring) startFollowing(); }, 2500);
      };
      // The car park stop plays the whole parking story, then the tour carries on.
      if (id === 'parking' && parking) {
        await running(); if (!current()) return;
        await parking.playStory({auto: true}); if (!current()) return;
        step++; tourTimer = later(advance, 1200); return;
      }
      if (id !== 'overview') { await running(); if (!current()) return; ui.scenario?.(id); }
      step++; tourTimer = later(advance, id === 'meeting' ? 14000 : 11000);
    }
    void next();
  }

  // "Follow the day": the camera goes to what the day is doing (its moments, dayEvents) and stays at the stop that fits
  // the hour until the next one. The kiosk does this when left alone. The car park's morning moment plays the guided
  // story, once a day: it holds the clock at real speed and sets its own times (09:02 … 11:30).
  const PLAN = [[0, 'overview'], ...dayEvents.map(e => [e.minute, e.destination])];
  function startFollowing() {
    if (disposed) return;
    stopTour(['กำลังตามวันในอาคาร', 'Following the day in the building']);
    world.setPaused(false); following = true; followed = null; ui.followChanged?.(); follow();
  }
  // A scenario running while following is Follow's (any touch stops Follow first): it stops too, however Follow stops.
  function stopFollowing(message = null, {keepStory = false} = {}) {
    if (!following) return;
    following = false; followTicket++; followed = null;
    if (parking?.story.running && !keepStory) parking.stopStory();
    ui.stopScenario?.();
    if (message) progress(message);
    ui.followChanged?.();
  }
  function follow() {
    // Hidden (another tab): the moment waits for the page to show again.
    if (!following || disposed || flight().traveling || hidden() || parking?.story.running) return;
    const minute = world.minute(), at = PLAN.findLast(([start]) => minute >= start), key = `${day}:${at[0]}`;
    if (followed === key) return;
    followed = key;
    const id = at[1], event = dayEvents.find(e => e.minute === at[0]);
    progress(() => `${L('ตามวันในอาคาร', 'Following the day')} · ${event ? event.title : L('กลางคืน อาคารพักผ่อน', 'Night, the building rests')}`);
    // Each go has its ticket: a story waiting for Resume belongs to it, not to a later go to the same moment.
    const ticket = ++followTicket;
    void select(id, {guided: true}).then(arrived => {
      // A flight cut short (the page hidden on the way) leaves the moment to be gone to again, not marked as seen.
      // (`landed`: a flight cancelled on its final approach still counts as the stop for select, not as being there.)
      if (!arrived || !flight().landed) { if (followed === key && ticket === followTicket) followed = null; return; }
      if (!following || followed !== key) return;
      const mine = () => following && followed === key && ticket === followTicket;
      if (id === 'parking' && parking && event && event.minute < 720 && storyDay !== day) void running().then(() => { if (mine() && storyDay !== day) { storyDay = day; void parking.playStory({auto: true}); } });
      else if (event && id === 'meeting' && event.layer === 'occupancy') void running().then(() => { if (mine()) ui.scenario?.(id); });
    });
  }
  // It looks at the hour every second of simulation time (and at once after a jump), on the engine's clock: the same
  // in the browser and in tests.
  const offClock = world.subscribe(kind => { if (kind === 'wrap') day++; if (kind === 'jump' || kind === 'set') follow(); });
  let lookTimer = null;
  const look = () => { follow(); lookTimer = later(look, 1000); };
  lookTimer = later(look, 1000);

  // The kiosk: left alone it follows the day (a paused screen stays paused). A parking story playing on auto-advance is
  // left to finish; one waiting for Next or paused is abandoned like any idle screen.
  function armIdle() {
    cancelLater(idleTimer); idleTimer = null;
    if (!kiosk) return;
    idleTimer = later(() => {
      const s = parking?.story, playing = s?.running && s.auto && !s.paused;
      if (kiosk && !touring && !following && !playing && !world.paused) { s?.stop(); startFollowing(); } else armIdle();
    }, IDLE_MS);
  }
  function setKiosk(on) {
    kiosk = on; ui.kiosk?.(on);
    if (on) { if (!touring && !following) startFollowing(); armIdle(); return; }
    cancelLater(idleTimer); idleTimer = null;
    // Switched off mid-flight: the guided flight stops too.
    const guided = touring || following;
    if (touring) stopTour();
    stopFollowing();
    if (guided) cancelFlight();
  }

  return {
    get touring() { return touring; }, get following() { return following; }, get kiosk() { return kiosk; },
    startTour, stopTour, startFollowing, stopFollowing, follow, setKiosk,
    // A stop picked by hand (the dock): the visitor takes over from the tour and Follow.
    picked() { stopFollowing(); stopTour(PICK_SPOT); },
    // A touch anywhere in kiosk mode. `own`: on a control that handles the loop itself (the tour and Follow buttons,
    // Pause, the story's Pause, Next and Auto); `bar`: on the parking story's bar (Exit, Restart decide the story).
    touch({own = false, bar = false} = {}) {
      if (!kiosk) return;
      if ((touring || following) && !own) {
        stopFollowing(null, {keepStory: bar});
        stopTour(['หยุดโหมดจัดแสดงชั่วคราว · ทดลองได้เลย', 'Paused the showcase loop · explore freely'], {keepStory: bar});
        if (!bar) cancelFlight();
      }
      armIdle();
    },
    // The visitor working the building or parking controls (outside kiosk mode).
    tryingIt() { if (kiosk) return; stopFollowing(); if (touring) stopTour(['กำลังทดลองด้วยตัวเอง', 'Trying it yourself']); },
    // Dragging or zooming the 3D view.
    exploring() { stopFollowing(); stopTour(['กำลังสำรวจด้วยตัวเอง', 'Exploring on your own']); cancelFlight(); },
    // Another tab: the tour pauses (and its flight stops).
    hiddenPage() { stopTour(['พักการพาชมเมื่อออกจากหน้านี้', 'Tour paused while you were away']); ui.stopScenario?.(); cancelFlight(); ui.render?.(); },
    // A jump in time or Night/Day: everything that plays by itself stops (a parking story played on its own too).
    stopActivity() { stopFollowing(); stopTour(['กำลังสำรวจด้วยตัวเอง', 'Exploring on your own']); if (parking?.story.running) parking.stopStory(); ui.stopScenario?.(); cancelFlight(); },
    // The timeline's Follow the day button.
    setFollowing(on) { if (on) { startFollowing(); return; } stopFollowing(['หยุดตามวันแล้ว · เลือกจุดต่อไปได้เอง', 'Stopped following · pick the next spot yourself']); cancelFlight(); },
    dispose() { disposed = true; cancelLater(idleTimer); cancelLater(lookTimer); offClock(); stopTour(); },
  };
}
