// The building's story: a short walk through the smart-building stops that plays by itself, each step a stop and one
// of that stop's own buttons (a meeting starting and ending, the pond running low and refilled, a cloud over the solar
// panels), with a line saying what the building did. Runs without a page on the engine's clock: the page (showcase.js)
// flies the camera (`select`), works the stop's buttons (`act`) and draws the bar (`changed`). Node tests give it
// stand-ins.
import {world, later, cancelLater} from 'osd/parking/clock.js';

// `ms`: how long the step stays after the camera arrives (simulation time). `act`: what the page does there.
export const STEPS = [
  {
    stop: 'overview',
    ms: 9000,
    title: ['อาคารทั้งหลังในหน้าจอเดียว', 'The whole building on one screen'],
    text: ['ไฟ แอร์ น้ำ และพลังงาน ดูได้จากที่เดียว', 'Lights, air, water and power, all in one place'],
  },
  {
    stop: 'meeting',
    act: 'meeting',
    ms: 13000,
    title: ['เริ่มประชุม', 'A meeting starts'],
    text: [
      'เรดาร์นับได้ 6 คน ไฟและแอร์เปิดเอง ห้องเย็นลงสู่ 24 °C',
      'The radar counts 6 people; the lights and AC come on and the room cools toward 24 °C',
    ],
  },
  {
    stop: 'meeting',
    act: 'meeting-end',
    ms: 7000,
    title: ['เลิกประชุม', 'The meeting ends'],
    text: ['ห้องรู้ว่าไม่มีคนแล้ว จึงปิดไฟและแอร์เอง', 'The room sees it is empty and switches its lights and AC off'],
  },
  {
    stop: 'pond',
    act: 'pond-low',
    ms: 8000,
    title: ['น้ำในบ่อลดลง', 'The pond runs low'],
    text: ['ระดับน้ำต่ำกว่า 65% ระบบแจ้งเตือนทันที', 'The water drops below 65%, and an alert goes up at once'],
  },
  {
    stop: 'pond',
    act: 'pond-ok',
    ms: 6000,
    title: ['เติมน้ำแล้ว', 'Refilled'],
    text: ['ระดับน้ำกลับสู่ช่วงปกติ การแจ้งเตือนหายไป', 'The level is back in range and the alert clears'],
  },
  {
    stop: 'energy',
    act: 'cloud',
    ms: 8000,
    title: ['เมฆบังแผงโซลาร์', 'A cloud over the solar panels'],
    text: ['กำลังผลิตลดลง อาคารดึงไฟจากกริดมาเสริม', 'Output falls, and the grid makes up the rest'],
  },
  {
    stop: 'energy',
    act: 'sun',
    ms: 7000,
    title: ['แดดกลับมา', 'The sun is back'],
    text: ['โซลาร์กลับมาจ่ายไฟส่วนใหญ่ให้อาคาร', 'The panels carry most of the building again'],
  },
  {
    stop: 'overview',
    ms: 8000,
    title: ['ลองเองได้เลย', 'Try it yourself'],
    text: ['เลือกจุดใดก็ได้เพื่อทดลอง หรือดูเรื่องเล่าที่ลานจอดรถ', 'Pick any stop to try it, or play the car park’s story'],
  },
];
// Daylight for the solar panels: a story started outside these hours moves the day on to START first.
const DAY_FROM = 8 * 60,
  DAY_TO = 15 * 60,
  START = 10 * 60;

// `select(id, {guided})` resolves whether the camera got there. `act(kind)`. `changed()`: it started, moved on a step or
// ended (Pause is the day's: the page watches the clock for that).
export function createBuildingStory({select, act = () => {}, changed = () => {}}) {
  let running = false,
    index = -1,
    generation = 0,
    timer = null,
    release = null;
  function end() {
    running = false;
    index = -1;
    generation++;
    cancelLater(timer);
    timer = null;
    release?.();
    release = null;
    changed();
  }
  async function go(i) {
    const mine = ++generation;
    cancelLater(timer);
    timer = null;
    if (i >= STEPS.length) {
      end();
      return;
    }
    index = i;
    changed();
    const step = STEPS[i];
    const arrived = await select(step.stop, {guided: true});
    if (!running || mine !== generation) return;
    // The flight cut short (the visitor took the view): the visitor has taken over.
    if (!arrived) {
      end();
      return;
    }
    if (step.act) act(step.act);
    timer = later(() => {
      if (running && mine === generation) void go(i + 1);
    }, step.ms);
  }
  return {
    get running() {
      return running;
    },
    get index() {
      return index;
    },
    get total() {
      return STEPS.length;
    },
    get step() {
      return STEPS[index] ?? null;
    },
    // From the start. It needs time to pass (a paused day runs again) and daylight; while it plays the clock runs at
    // real speed, so the building's schedule does not take back what a step did.
    play() {
      if (running) end();
      running = true;
      world.setPaused(false);
      const minute = world.minute();
      if (minute < DAY_FROM || minute >= DAY_TO) world.jumpTo(START);
      release = world.hold();
      void go(0);
    },
    // On to the next step now (a paused day runs again).
    next() {
      if (!running) return;
      world.setPaused(false);
      void go(index + 1);
    },
    stop() {
      if (running) end();
    },
  };
}
