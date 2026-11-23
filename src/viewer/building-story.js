// The building's story: the meeting day of the visitor the car park's story follows, told through the smart-building
// stops. Each step flies to a stop and, at most of them, works one of that stop's own buttons: the caption says what is
// about to happen and cues the button; once pressed (by the presenter, or by itself on auto-advance), what the building
// did. Runs as the car park's story does (Next by Next, or on auto-advance) and without a page, on the engine's clock:
// the page (showcase.js) flies the camera (`select`), sets a step's scene (`prepare`), works the buttons (`act`) and
// draws the bar and the caption (`changed`). Node tests give it stand-ins.
import {world, later, cancelLater, demoNow} from 'osd/core/clock.js';

// `hold`: how long the step stays, on auto-advance, after its button is pressed (or after the camera arrives, at a step
// with none), in simulation time. `act`: what the button does; `text`: before it, `done`: after it; `hint`: the cue's.
export const STEPS = [
  {
    stop: 'overview',
    hold: 9000,
    title: ['เช้าวันประชุมที่ OSD', 'The morning of a meeting at OSD'],
    text: [
      'คุณชูใจจอดรถแล้วและกำลังเข้าอาคาร ไฟ แอร์ น้ำ และพลังงานทั้งอาคารดูได้จากหน้าจอเดียว',
      'Chujai has parked and is walking in. The building’s lights, air, water and power are all on this one screen',
    ],
  },
  {
    stop: 'meeting',
    act: 'meeting',
    hold: 12000,
    title: ['ไฟและแอร์เปิดเองเมื่อมีคนเข้าห้อง', 'Lights and AC come on when people enter'],
    text: [
      'ห้องยังว่าง ไฟและแอร์ปิดอยู่ คุณชูใจและทีมรวม 6 คนกำลังจะเข้าประชุม',
      'The room is empty, its lights and AC off. Chujai and five others are about to walk in',
    ],
    done: [
      'เรดาร์ตรวจพบ 6 คน ระบบเปิดไฟและแอร์ให้อัตโนมัติ และทำความเย็นลงสู่ 24 °C',
      'The radar detects six people. The lights and AC come on automatically and the room cools towards 24 °C',
    ],
    hint: ['กด “จำลองเริ่มประชุม”', 'Press “Simulate a meeting”'],
  },
  {
    stop: 'meeting',
    act: 'meeting-end',
    hold: 7000,
    title: ['ประชุมเสร็จ ไฟและแอร์ปิดเอง', 'Meeting over, lights and AC switch off'],
    text: ['ประชุมเสร็จแล้ว ทุกคนกำลังออกจากห้อง', 'The meeting is over and everyone is leaving'],
    done: [
      'เมื่อไม่มีคนในห้อง ระบบปิดไฟและแอร์ให้อัตโนมัติ ช่วยประหยัดพลังงาน',
      'With nobody in the room, the lights and AC switch off automatically, saving energy',
    ],
    hint: ['กด “จำลองเลิกประชุม”', 'Press “End the meeting”'],
  },
  {
    stop: 'pond',
    act: 'pond-low',
    hold: 8000,
    title: ['บ่อปลาส่งสัญญาณเตือน', 'The fish pond raises an alert'],
    text: ['ระดับน้ำในบ่อปลาชั้น 1 ค่อย ๆ ลดลง', 'The water level in the floor 1 pond is slowly dropping'],
    done: ['ระดับน้ำต่ำกว่า 65% ระบบแจ้งเตือนทันที', 'The level falls below 65% and the system raises an alert at once'],
    hint: ['กด “จำลองระดับน้ำต่ำ”', 'Press “Simulate low water”'],
  },
  {
    stop: 'pond',
    act: 'pond-ok',
    hold: 6000,
    title: ['ระดับน้ำกลับสู่ปกติ', 'The water level is back to normal'],
    text: ['ผู้ดูแลเห็นการแจ้งเตือนและเติมน้ำเข้าบ่อ', 'Staff see the alert and refill the pond'],
    done: [
      'ระดับน้ำกลับมาที่ 82% ระบบยกเลิกการแจ้งเตือนให้อัตโนมัติ',
      'The level is back at 82% and the alert clears automatically',
    ],
    hint: ['กด “คืนค่าระดับน้ำ”', 'Press “Restore water level”'],
  },
  {
    stop: 'energy',
    act: 'cloud',
    hold: 8000,
    title: ['แดดน้อยลง ใช้ไฟจากกริดเสริม', 'Less sun, more power from the grid'],
    text: [
      'แผงโซลาร์ 24 แผงบนดาดฟ้ากำลังผลิตไฟให้อาคาร แต่เริ่มมีเมฆบัง',
      'On the roof, 24 solar panels are powering the building, but clouds are moving in',
    ],
    done: [
      'กำลังผลิตลดลง อาคารใช้ไฟจากกริดเสริมโดยไม่สะดุด',
      'Solar output drops and the grid makes up the difference without interruption',
    ],
    hint: ['กด “จำลองเมฆบังแผง”', 'Press “Simulate clouds over the panels”'],
  },
  {
    stop: 'energy',
    act: 'sun',
    hold: 7000,
    title: ['แดดกลับมาแรง ใช้ไฟจากกริดน้อยลง', 'The sun is back, less power from the grid'],
    text: ['เมฆผ่านไปแล้ว', 'The clouds have passed'],
    done: [
      'แผงโซลาร์กลับมาผลิตไฟได้มากขึ้น อาคารใช้ไฟจากกริดน้อยลง',
      'The panels produce more again, and the building uses less from the grid',
    ],
    hint: ['กด “จำลองแดดกลับมา”', 'Press “Simulate the sun returning”'],
  },
  {
    stop: 'overview',
    hold: 8000,
    title: ['ระบบอาคารทำงานร่วมกันตลอดวัน', 'The building’s systems, working together all day'],
    text: [
      'เปิดปิดไฟและแอร์ตามการใช้งาน แจ้งเตือนเมื่อมีสิ่งผิดปกติ และใช้ไฟจากแสงอาทิตย์',
      'Lights and AC follow how rooms are used, alerts go up when something is wrong, and the sun supplies power',
    ],
  },
];
// On auto-advance: how long a cue waits for the presenter before the step is done for them, and the tap that shows it.
const CUE_MS = 3600,
  TAP_MS = 250,
  FLIGHT_MS = 2000; // about how long the camera takes to a stop
// A story started outside these hours moves the day on to START first: there is daylight for the solar panels, and an
// hour (the clock runs at real speed) before the day's schedule next touches the rooms or the pond (14:00, 14:50; a cue
// left waiting as it did had its button turn into the opposite one).
const DAY_FROM = 9 * 60,
  DAY_TO = 13 * 60,
  START = 10 * 60;

// `select(id, {guided})` resolves whether the camera got there. `prepare(act)`: the scene as it stands before that
// button. `act(act)`. `restore()`: it ended, and what it set goes back to the day's schedule. `tap()`: the cued button's
// tap is shown. `changed()`: anything the bar or the caption shows
// changed (Pause is the day's: the page watches the clock for that).
export function createBuildingStory({
  select,
  prepare = () => {},
  act = () => {},
  restore = () => {},
  tap = () => {},
  changed = () => {},
}) {
  let running = false,
    auto = true,
    loop = false,
    index = -1,
    // 'flying' to the stop, 'cue': its button waits to be pressed, 'hold': done here.
    phase = 'flying',
    since = 0,
    acted = false,
    generation = 0,
    timer = null,
    release = null;
  const step = () => STEPS[index] ?? null;
  // What comes next by itself; on Next, it waits.
  function after(fn, ms) {
    cancelLater(timer);
    const mine = generation;
    timer = later(() => {
      if (running && mine === generation) fn();
    }, ms);
  }
  // `keep`: what it set stays (the visitor works on from what they see).
  // The day it was paused on runs again (the visitor left with everything standing still took it for broken).
  function end({keep = false} = {}) {
    if (world.paused) world.setPaused(false);
    running = false;
    index = -1;
    phase = 'flying';
    generation++;
    cancelLater(timer);
    timer = null;
    release?.();
    release = null;
    if (!keep) restore();
    changed();
  }
  async function go(i) {
    const mine = ++generation;
    cancelLater(timer);
    if (i >= STEPS.length) {
      if (loop) play();
      else end();
      return;
    }
    index = i;
    phase = 'flying';
    since = demoNow();
    acted = false;
    changed();
    const {stop, act: kind} = STEPS[i];
    // The first step sets the first button's scene already (its panel shows the meeting room).
    const scene = kind ?? (i === 0 ? STEPS[1].act : null);
    if (scene) prepare(scene);
    const arrived = await select(stop, {guided: true});
    if (!running || mine !== generation) return;
    // The flight cut short (the visitor took the view): the visitor has taken over.
    if (!arrived) {
      end();
      return;
    }
    phase = kind ? 'cue' : 'hold';
    wait();
    changed();
  }
  function wait() {
    cancelLater(timer);
    since = demoNow();
    if (!auto) return;
    if (phase === 'hold') after(() => void go(index + 1), step().hold);
    else if (phase === 'cue')
      after(() => {
        tap();
        after(press, TAP_MS);
      }, CUE_MS);
  }
  function press() {
    if (!running || phase !== 'cue') return;
    phase = 'hold';
    acted = true;
    act(step().act);
    wait();
    changed();
  }
  // From the start. It needs time to pass (a paused day runs again) and daylight; while it plays the clock runs at
  // real speed, so the building's schedule does not take back what a step did.
  function play({auto: a = auto} = {}) {
    if (running) end();
    auto = a;
    running = true;
    world.setPaused(false);
    const minute = world.minute();
    if (minute < DAY_FROM || minute >= DAY_TO) world.jumpTo(START);
    release = world.hold();
    void go(0);
  }
  return {
    get running() {
      return running;
    },
    get auto() {
      return auto;
    },
    // At the end it plays again from the start.
    get loop() {
      return loop;
    },
    setLoop(on) {
      loop = on;
      changed();
    },
    get paused() {
      return world.paused;
    },
    get index() {
      return index;
    },
    get total() {
      return STEPS.length;
    },
    get waitingForNext() {
      return running && !auto && phase !== 'flying';
    },
    // How far the step is, 0 to 1, on auto-advance (near the end it waits for what takes longer), else null.
    get progress() {
      if (!running || !auto || !step()) return null;
      const cue = step().act ? CUE_MS + TAP_MS : 0,
        parts = {flying: [0, FLIGHT_MS], cue: [FLIGHT_MS, cue], hold: [FLIGHT_MS + cue, step().hold]},
        [before, length] = parts[phase];
      return (before + Math.min(demoNow() - since, length)) / (FLIGHT_MS + cue + step().hold);
    },
    // The button the step waits for.
    get cue() {
      return running && phase === 'cue' ? step().act : null;
    },
    // [thai, english] each: the step's title, its line as things stand, and the cue's hint (on Next:
    // on auto-advance it is pressed by itself).
    get caption() {
      const s = step();
      return running && s
        ? {title: s.title, body: (acted && s.done) || s.text, hint: phase === 'cue' && !auto ? s.hint : null}
        : null;
    },
    play,
    // Presses the cued button, or goes on to the next step (a paused day runs again). Not while the camera flies.
    next() {
      if (!running || phase === 'flying') return;
      world.setPaused(false);
      if (phase === 'cue') press();
      else void go(index + 1);
    },
    // Straight to a step: what the one on show set goes back to the day's schedule first (each sets its own scene).
    goTo(i) {
      if (!running || !STEPS[i]) return;
      world.setPaused(false);
      restore();
      void go(i);
    },
    // The presenter pressed the cued button.
    press,
    // The presenter is pressing something in the panel: auto-advance starts its wait again (going on between press and
    // release, it left the release on the opposite button, or on one that had gone).
    pressing() {
      if (running) wait();
    },
    setAuto(a) {
      auto = a;
      if (running) wait();
      changed();
    },
    stop(options) {
      if (running) end(options);
    },
  };
}
