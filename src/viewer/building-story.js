// The building's story: the meeting day of the visitor the car park's story follows, told through the smart-building
// stops. Each step flies to a stop and, at most of them, works one of that stop's own buttons: the caption says what is
// about to happen and cues the button; once pressed (by the presenter, or by itself on auto-advance), what the building
// did. Runs as the car park's story does (Next by Next, or on auto-advance) and without a page, on the engine's clock:
// the page (showcase.js) flies the camera (`select`), sets a step's scene (`prepare`), works the buttons (`act`) and
// draws the bar and the caption (`changed`). Node tests give it stand-ins.
import {world, later, cancelLater} from 'osd/parking/clock.js';

// `hold`: how long the step stays, on auto-advance, after its button is pressed (or after the camera arrives, at a step
// with none), in simulation time. `act`: what the button does; `text`: before it, `done`: after it; `hint`: the cue's.
export const STEPS = [
  {
    stop: 'overview',
    hold: 9000,
    title: ['เช้าวันประชุมที่ OSD', 'The morning of a meeting at OSD'],
    text: [
      'คุณชูใจจอดรถเรียบร้อยและกำลังเดินเข้าอาคาร ทั้งไฟ แอร์ น้ำ และพลังงานของที่นี่ดูได้จากหน้าจอเดียว',
      'Chujai has parked and is walking in. The building’s lights, air, water and power are all on this one screen',
    ],
  },
  {
    stop: 'meeting',
    act: 'meeting',
    hold: 12000,
    title: ['ห้องประชุมเตรียมตัวเอง', 'The room gets itself ready'],
    text: [
      'ห้องยังว่าง ไฟและแอร์ปิดอยู่ คุณชูใจกับทีมรวม 6 คนกำลังจะเข้าห้อง',
      'The room is empty, its lights and AC off. Chujai and five others are about to walk in',
    ],
    done: [
      'เรดาร์นับได้ 6 คน ไฟและแอร์จึงเปิดเอง ห้องเริ่มเย็นลงสู่ 24 °C โดยไม่มีใครแตะสวิตช์',
      'The radar counts six people, so the lights and AC come on and the room heads for 24 °C. Nobody touched a switch',
    ],
    hint: ['ลองกด “จำลองเริ่มประชุม”', 'Try “Simulate a meeting”'],
  },
  {
    stop: 'meeting',
    act: 'meeting-end',
    hold: 7000,
    title: ['เลิกประชุม ไม่มีอะไรเปิดทิ้งไว้', 'The meeting ends and nothing is left on'],
    text: ['ประชุมจบแล้ว ทุกคนเดินออกจากห้อง', 'The meeting is over and everyone is leaving'],
    done: [
      'ห้องรู้ว่าไม่มีคนแล้ว จึงปิดไฟและแอร์ให้ ไม่เปลืองไฟกับห้องว่าง',
      'The room sees it is empty and switches its lights and AC off, so no power goes to an empty room',
    ],
    hint: ['ลองกด “จำลองเลิกประชุม”', 'Try “End the meeting”'],
  },
  {
    stop: 'pond',
    act: 'pond-low',
    hold: 8000,
    title: ['บ่อปลาส่งสัญญาณเตือน', 'The fish pond speaks up'],
    text: ['ชั้นล่าง น้ำในบ่อปลาค่อย ๆ ลดลง ยังไม่มีใครสังเกตเห็น', 'Downstairs the pond is losing water, and nobody has noticed'],
    done: [
      'ระดับน้ำต่ำกว่า 65% ระบบแจ้งเตือนทันที ก่อนที่ปลาจะเดือดร้อน',
      'The level drops below 65% and an alert goes up at once, before the fish are in trouble',
    ],
    hint: ['ลองกด “จำลองระดับน้ำต่ำ”', 'Try “Simulate low water”'],
  },
  {
    stop: 'pond',
    act: 'pond-ok',
    hold: 6000,
    title: ['เติมน้ำ แล้วการแจ้งเตือนหายไป', 'Refilled, and the alert clears'],
    text: ['ผู้ดูแลเห็นการแจ้งเตือนและมาเติมน้ำ', 'Staff see the alert and top the pond up'],
    done: ['ระดับน้ำกลับมาที่ 82% การแจ้งเตือนหายไปเอง ไม่ต้องกดปิด', 'The level is back at 82% and the alert clears by itself'],
    hint: ['ลองกด “คืนค่าระดับน้ำ”', 'Try “Restore water level”'],
  },
  {
    stop: 'energy',
    act: 'cloud',
    hold: 8000,
    title: ['เมฆเคลื่อนมาบังแดด', 'A cloud passes over'],
    text: [
      'บนดาดฟ้า แผงโซลาร์ 24 แผงกำลังช่วยจ่ายไฟให้อาคาร แต่เมฆกำลังเคลื่อนเข้ามา',
      'On the roof, 24 solar panels are helping to power the building, and a cloud is coming in',
    ],
    done: [
      'กำลังผลิตลดลง ไฟจากกริดเข้ามาเสริมให้พอดี ในอาคารไม่มีใครรู้สึกถึงความต่าง',
      'Their output drops and the grid makes up the difference. Inside, nobody notices',
    ],
    hint: ['ลองกด “จำลองเมฆบังแผง”', 'Try “Simulate clouds over the panels”'],
  },
  {
    stop: 'energy',
    act: 'sun',
    hold: 7000,
    title: ['แดดกลับมา', 'The sun is back'],
    text: ['เมฆเคลื่อนผ่านไปแล้ว', 'The cloud has moved on'],
    done: [
      'แผงโซลาร์กลับมาผลิตเต็มที่ อาคารจึงใช้ไฟจากกริดน้อยลง',
      'The panels are back to full output, and the building draws less from the grid',
    ],
    hint: ['ลองกด “จำลองแดดกลับมา”', 'Try “Simulate the sun returning”'],
  },
  {
    stop: 'overview',
    hold: 8000,
    title: ['อาคารที่ดูแลตัวเอง', 'A building that looks after itself'],
    text: [
      'ลองกดเองได้ทุกจุด หรือไปที่ “ที่จอดรถ” เพื่อดูว่าคุณชูใจขอสิทธิ์และเข้าจอดได้อย่างไร',
      'Try any stop yourself, or go to Parking to see how Chujai got her pass and drove in',
    ],
  },
];
// On auto-advance: how long a cue waits for the presenter before the step is done for them, and the tap that shows it.
const CUE_MS = 3600,
  TAP_MS = 250;
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
    index = -1,
    // 'flying' to the stop, 'cue': its button waits to be pressed, 'hold': done here.
    phase = 'flying',
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
  function end({keep = false} = {}) {
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
      end();
      return;
    }
    index = i;
    phase = 'flying';
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
  return {
    get running() {
      return running;
    },
    get auto() {
      return auto;
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
    // The button the step waits for.
    get cue() {
      return running && phase === 'cue' ? step().act : null;
    },
    // [thai, english] each: the step's title, its line as things stand, and the cue's hint.
    get caption() {
      const s = step();
      return running && s
        ? {title: s.title, body: (acted && s.done) || s.text, hint: phase === 'cue' ? s.hint : null}
        : null;
    },
    // From the start. It needs time to pass (a paused day runs again) and daylight; while it plays the clock runs at
    // real speed, so the building's schedule does not take back what a step did.
    play({auto: a = auto} = {}) {
      if (running) end();
      auto = a;
      running = true;
      world.setPaused(false);
      const minute = world.minute();
      if (minute < DAY_FROM || minute >= DAY_TO) world.jumpTo(START);
      release = world.hold();
      void go(0);
    },
    // Presses the cued button, or goes on to the next step (a paused day runs again). Not while the camera flies.
    next() {
      if (!running || phase === 'flying') return;
      world.setPaused(false);
      if (phase === 'cue') press();
      else void go(index + 1);
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
