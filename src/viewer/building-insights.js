import {
  daySnapshot,
  dayEvents,
  dayHistory,
  formatTime,
  incidentsFor,
  createRoomSchedule,
} from 'osd/viewer/building-day.js';
import {createRoomLayers} from 'osd/viewer/room-layers.js';
import {L} from 'osd/parking/i18n.js';
import {world, realNow} from 'osd/parking/clock.js';
import {morph, icon} from 'osd/parking/dom.js';
import {createReadings} from 'osd/viewer/readings.js';
const legends = {
  none: () => '',
  temperature: () =>
    L(
      '<i class="legend-cool"></i>ต่ำกว่า 25° <i class="legend-teal"></i>25–27° <i class="legend-warm"></i>27° ขึ้นไป',
      '<i class="legend-cool"></i>Below 25° <i class="legend-teal"></i>25–27° <i class="legend-warm"></i>27° and up',
    ),
  occupancy: () =>
    L(
      '<i class="legend-teal"></i>มีคน <i class="legend-muted"></i>ห้องว่าง',
      '<i class="legend-teal"></i>Occupied <i class="legend-muted"></i>Empty',
    ),
  lights: () =>
    L(
      '<i class="legend-warm"></i>ไฟเปิด <i class="legend-muted"></i>ไฟปิด',
      '<i class="legend-warm"></i>Lights on <i class="legend-muted"></i>Lights off',
    ),
};
// Readings set by hand against the schedule: readings.js.
// The moments' icons, by the stop they show.
const EVENT_ICONS = {parking: 'car', meeting: 'users', energy: 'sun', pond: 'drop', overview: 'moon'};
// Real minutes a simulated day can take; the timeline's button steps through them.
const DAY_LENGTHS = [10, 20, 40, 60];
// The building follows the world clock (src/parking/clock.js) through its daily schedule (building-day.js):
// - readings (temperature, solar, water …) follow it continuously, except ones changed by hand for a while;
// - rooms' lights, AC and doors change when the schedule changes them, so a switch flipped by hand stays until then.
// The timeline shows the live time; its slider and moment buttons move the whole world forward to that time.
export function createBuildingInsights({
  model,
  simulation,
  schedule,
  read,
  write,
  render,
  navigate,
  stopActivity,
  followState,
  toggleFollow,
}) {
  const $ = (s) => document.querySelector(s),
    abort = new AbortController(),
    layers = createRoomLayers({model, rooms: simulation.rooms, schedule});
  const listen = (el, event, fn) => el.addEventListener(event, fn, {signal: abort.signal});
  let layer = 'none',
    disposed = false,
    lastContext = null,
    dragging = false,
    lastRender = 0,
    lastShown = '';
  const followRooms = createRoomSchedule(simulation);
  const readings = createReadings(simulation.rooms);
  const events = $('#day-events'),
    incidentList = $('#incident-list'),
    range = $('#day-time');
  // Rebuilt on a language switch (relabel); paint() then restores aria-current.
  function relabel() {
    events.innerHTML = dayEvents
      .map(
        (e, i) =>
          `<button data-day-event="${i}" title="${e.title} · ${e.detail}">${icon(EVENT_ICONS[e.destination])}<span><time>${formatTime(e.minute)}</time><b>${e.title}</b></span></button>`,
      )
      .join('');
    $('#day-marks').innerHTML = dayEvents.map((e) => `<i style="--at:${e.minute / 1439}"></i>`).join('');
  }
  relabel();
  // An icon and a label, rewritten only when they change (a press under way keeps its target).
  function button(el, name, label) {
    if (el.dataset.shown === `${name}|${label}`) return;
    el.dataset.shown = `${name}|${label}`;
    el.innerHTML = `${icon(name)}<span>${label}</span>`;
  }
  function paint() {
    const minute = dragging ? Number(range.value) : world.minute();
    $('#replay-time').textContent = formatTime(minute);
    if (!dragging) range.value = String(Math.floor(minute));
    range.setAttribute(
      'aria-valuetext',
      L(`${formatTime(minute)} นาฬิกา · เวลาจำลอง`, `${formatTime(minute)} · simulated time`),
    );
    $('#replay-mode').textContent = world.held
      ? L('กำลังสาธิต', 'Real time · story playing')
      : world.paused
        ? L('หยุดชั่วคราว', 'Paused · everything stands still')
        : {
            on: L('เปลี่ยนมุมกล้องตามช่วงเวลา', 'The camera follows the day'),
            waiting: L('จะตามวันต่อเองหลังไม่มีการแตะ 1 นาที', 'Follows the day again after a quiet minute'),
            off: L('เวลาจำลอง', 'Simulated time · always running'),
          }[followState()];
    const following = followState() === 'on';
    button(
      $('#day-follow'),
      following ? 'x' : 'camera',
      following ? L('หยุดกล้องตามวัน', 'Stop following') : L('กล้องตามวัน', 'Follow the day'),
    );
    $('#day-follow').setAttribute('aria-pressed', String(following));
    button($('#day-pause'), world.paused ? 'play' : 'pause', world.paused ? L('เล่นต่อ', 'Resume') : L('หยุด', 'Pause'));
    $('#day-pause').setAttribute('aria-pressed', String(world.paused));
    button(
      $('#day-speed'),
      'clock',
      world.dayLength ? L(`${world.dayLength} นาที/วัน`, `${world.dayLength} min/day`) : L('เวลาจริง', 'Real time'),
    );
    document
      .querySelectorAll('[data-layer]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === layer)));
    $('#layer-legend').innerHTML = legends[layer]();
    $('#layer-legend').hidden = layer === 'none';
    const current = dayEvents.findLastIndex((e) => e.minute <= minute);
    events.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', String(i === current)));
    document.querySelectorAll('#day-marks i').forEach((m, i) => m.classList.toggle('past', i <= current));
    // Where the strip is too narrow for titles, the one it is on is written under it.
    const now = dayEvents[current];
    $('#day-now').textContent = now ? `${formatTime(now.minute)} · ${now.title}` : '';
  }
  // Brings the building to the clock's time of day. `all` re-applies every room (a jump in time, or a reset).
  function sync({all = false} = {}) {
    if (disposed) return;
    const snapshot = daySnapshot(world.minute(), simulation.rooms),
      state = read();
    // A running scenario (the meeting room cooling, the sun returning) owns the readings until it ends.
    if (!state.scenario) {
      write(readings.scheduled(snapshot));
    }
    // The panels redraw when something they show as a state changes, otherwise every 2 s: no need to on every tick
    // (they are updated in place, see morph). A room change redraws them through the simulation.
    const shown = JSON.stringify([state.occupied, state.pondAlert, state.water]);
    // At most every 2 s of the demo's real pace when only the time moved (on its clock: the same in every run).
    if (followRooms(snapshot.minute, {all})) {
      lastRender = realNow();
      lastShown = shown;
    } else if (all || shown !== lastShown || realNow() - lastRender > 2000) {
      lastRender = realNow();
      lastShown = shown;
      render();
    }
    paint();
  }
  function setLayer(value) {
    layer = value;
    paint();
    if (lastContext) update(lastContext);
  }
  // Moves the world forward to `minute` (today's or tomorrow's) and shows it.
  function jumpTo(minute) {
    readings.clear();
    world.jumpTo(minute);
    sync({all: true});
  }
  async function visit(event) {
    stopActivity();
    setLayer(event.layer);
    jumpTo(event.minute);
    await navigate(event.destination);
  }
  function update(context) {
    lastContext = context;
    const {destination, traveling, landed, state, sim} = context;
    paint();
    const roomData = state.roomData || daySnapshot(world.minute(), simulation.rooms).telemetry.roomData;
    // The meeting room also supports manual local experiments.
    const data = {...roomData, f4_meeting_2: {temp: state.temp, people: state.occupied ? 6 : 0}};
    // Room colours belong to the stops that look into rooms: the meeting room (floor 4) and the pond's floor-1 rooms.
    // Their bar (in the view's corner) shows only there, once the camera has landed (a click mid-flight stopped it).
    const floor = destination === 'meeting' ? '4' : destination === 'pond' ? '1' : null;
    $('.insight-toolbar').hidden = !floor || traveling || !landed;
    layers.update({
      layer,
      roomData: data,
      states: sim.rooms,
      floor,
      hidden: traveling || floor !== sim.view.currentFloor,
    });
    const incidents = incidentsFor(state, sim.rooms);
    $('#incident-count').textContent = String(incidents.length);
    const html = incidents.length
      ? incidents
          .map(
            (i) =>
              `<button class="incident-item" data-key="${i.id}" data-incident="${i.id}" data-target="${i.destination}" data-insight-layer="${i.layer}"><span class="incident-mark" aria-hidden="true">!</span><span><strong>${i.title}</strong><small>${i.detail}</small><small>${i.hint}</small></span><span aria-hidden="true">↗</span></button>`,
          )
          .join('')
      : `<p class="incident-clear"><span aria-hidden="true">✓</span> ${L('ไม่พบความผิดปกติ', 'Readings are within normal range')}</p>`;
    morph(incidentList, html);
    $('#insight-room').hidden = layer === 'none' || destination !== 'meeting';
    $('#insight-room').textContent =
      `${L('ห้องประชุมย่อย 2 ชั้น 4', 'Meeting room 2, floor 4')} · ${layer === 'temperature' ? state.temp.toFixed(1) + ' °C' : layer === 'occupancy' ? (state.occupied ? L('มีคน 6 คน', '6 people') : L('ไม่มีคน', 'Empty')) : sim.rooms['f4_meeting_2'].light ? L('ไฟเปิด', 'Lights on') : L('ไฟปิด', 'Lights off')}`;
  }
  // The slider previews a time while dragged and moves the world there when let go.
  listen(range, 'input', () => {
    dragging = true;
    paint();
  });
  // A drag let go where it began sends no change: the slider stayed on its preview and its clock froze. After the
  // release (a change, if any, comes first), a drag still open is dropped and the slider follows the clock again.
  for (const type of ['pointerup', 'pointercancel', 'blur'])
    listen(range, type, () =>
      setTimeout(() => {
        if (dragging && !disposed) {
          dragging = false;
          paint();
        }
      }, 0),
    );
  // The value is read first: stopping Follow repaints the slider with the live time.
  listen(range, 'change', () => {
    const minute = Number(range.value);
    dragging = false;
    stopActivity();
    jumpTo(minute);
  });
  listen($('#day-pause'), 'click', () => {
    world.setPaused(!world.paused);
    paint();
  });
  listen($('#day-follow'), 'click', toggleFollow);
  listen($('#day-speed'), 'click', () => {
    const next = DAY_LENGTHS.find((n) => n > world.dayLength) ?? DAY_LENGTHS[0];
    world.setDayLength(next);
    paint();
  });
  listen(events, 'click', (e) => {
    const button = e.target.closest('[data-day-event]');
    if (button) void visit(dayEvents[Number(button.dataset.dayEvent)]);
  });
  listen(incidentList, 'click', (e) => {
    const b = e.target.closest('[data-incident]');
    if (!b) return;
    stopActivity({keep: true}); // the incident is in what the story set
    setLayer(b.dataset.insightLayer);
    void navigate(b.dataset.target);
  });
  document.querySelectorAll('[data-layer]').forEach((b) => {
    b.disabled = false;
    listen(b, 'click', () => {
      stopActivity({keep: true});
      setLayer(b.dataset.layer);
    });
  });
  for (const selector of ['#day-follow', '#day-pause', '#day-speed', '#day-time']) $(selector).disabled = false;
  const offClock = world.subscribe((kind) => {
    if (kind === 'tick') sync();
    else if (kind === 'jump' || kind === 'set') sync({all: true});
    else if (kind === 'rate') paint();
  });
  sync({all: true});
  return {
    update,
    hold: readings.hold,
    // These readings, and this room's light and AC if any, set by hand, go back to the day's schedule.
    backToSchedule(keys, roomId = null) {
      readings.release(keys);
      if (roomId) {
        const {light, climate} = daySnapshot(world.minute(), simulation.rooms).rooms[roomId];
        simulation.setRoom(roomId, {light, climate});
      }
      sync();
    },
    jumpTo,
    relabel,
    paint,
    history: (key) => dayHistory(world.minute(), simulation.rooms, key),
    timeLabel: () => L(`ข้อมูล ณ เวลา ${formatTime(world.minute())}`, `Data at ${formatTime(world.minute())}`),
    dispose() {
      disposed = true;
      offClock();
      readings.dispose();
      abort.abort();
      layers.dispose();
    },
  };
}
