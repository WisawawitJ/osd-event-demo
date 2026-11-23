// The panel beside the 3D view at each stop, as markup: what the building reads there, and its buttons. Without a page:
// a stop's panel is a function of what it shows.
import {L, getLang} from 'osd/viewer/texts.js';
import {icon} from 'osd/core/dom.js';
import {MEETING_PEOPLE, SOLAR, WATER} from 'osd/viewer/building.js';

function row(label, value) {
  return `<div class="data-row"><span>${label}</span><strong>${value}</strong></div>`;
}
function metric(label, value, unit, note = '') {
  return `<div><span class="metric-label">${label}</span><div class="metric-value">${value}<small>${unit}</small></div>${note ? `<span class="metric-note">${note}</span>` : ''}</div>`;
}
function system(name, title, desc, value) {
  return `<div class="system-row"><div class="system-icon">${icon(name)}</div><div class="system-copy"><strong>${title}</strong><span>${desc}</span></div><span class="system-value">${value}</span></div>`;
}
// The day's last eight hours of a reading, up to what it reads now (by hand or in a scenario it is not the schedule's).
function chart({values: day, labels}, now, label) {
  const values = [...day.slice(0, -1), now];
  const min = Math.min(...values) - 1,
    max = Math.max(...values) + 1;
  const points = values.map((v, i) => [(i * 280) / (values.length - 1), 74 - ((v - min) / (max - min)) * 60]);
  return `<svg class="chart" viewBox="0 0 280 100" role="img" aria-label="${L('กราฟ', 'Chart:')} ${label}"><path class="chart-grid" d="M0 18h280M0 46h280M0 74h280"/><path d="M${points.map((p) => p.join(',')).join(' L')} L280,82 L0,82Z" fill="#eaf1fb" stroke="none"/><path class="chart-line" d="M${points.map((p) => p.join(',')).join(' L')}"/>${labels.map((l, i) => `<text x="${(i * 280) / (labels.length - 1)}" y="98" text-anchor="${i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}">${l}</text>`).join('')}</svg>`;
}
function events(items) {
  return items.map(([time, text]) => `<div class="event-row"><time>${time}</time><p>${text}</p></div>`).join('');
}
function controls(s) {
  const door = Object.values(s.doors).some(Boolean);
  return `<div class="local-controls"><button data-control="light" aria-pressed="${s.light}">${icon('light')}${L(`ไฟ ${s.light ? 'เปิด' : 'ปิด'}`, `Light ${s.light ? 'on' : 'off'}`)}</button><button data-control="climate" aria-pressed="${s.climate}">${icon('air')}${L(`แอร์ ${s.climate ? 'เปิด' : 'ปิด'}`, `AC ${s.climate ? 'on' : 'off'}`)}</button><button data-control="door" aria-pressed="${door}">${icon('door')}${L(`ประตู ${door ? 'เปิด' : 'ปิด'}`, `Door ${door ? 'open' : 'closed'}`)}</button></div>`;
}

// Each takes `state` (the readings on show), `room` (the meeting room's light, climate and doors), `sim` (the building:
// night, every room's light and climate), `history(key)` (a reading's last eight hours) and `timeLabel()`.
export const panels = {
  overview({state, sim, timeLabel}) {
    const lights = Object.values(sim.rooms).filter((r) => r.light).length,
      ac = Object.values(sim.rooms).filter((r) => r.climate).length;
    return `<p class="dashboard-intro">${L('ดูสถานะทั้งอาคาร และเลือกไปยังจุดที่สนใจ', 'See the status of the whole building and pick a spot to visit')}</p><div class="metric-pair">${metric(L('พลังงานจากโซลาร์', 'Solar power'), state.solar.toFixed(1), 'kW', timeLabel())}${metric(L('ห้องประชุม', 'Meeting room'), state.occupied ? L('ใช้งาน', 'In use') : L('ว่าง', 'Free'), '', L('จากเซนเซอร์เรดาร์', 'From the radar'))}</div><div class="dashboard-section"><h3>${L('ระบบในอาคาร', 'Building systems')}</h3>${system('light', L('แสงสว่าง', 'Lighting'), L('จำนวนไฟที่เปิด', 'Lights that are on'), L(`${lights} เปิด`, `${lights} on`))}${system('air', L('เครื่องปรับอากาศ', 'Air conditioning'), L('จำนวนแอร์ที่เปิด', 'AC units that are on'), L(`${ac} เปิด`, `${ac} on`))}${system('drop', L('บ่อปลา', 'Fish pond'), state.pondAlert ? L('ระดับน้ำต่ำกว่าค่าที่ตั้ง', 'Water below the set level') : L('ระดับน้ำปกติ', 'Water within the set range'), state.water + '%')}</div><div class="dashboard-section"><h3>${L('จุดที่น่าสนใจ', 'Places to visit')}</h3>${events(
      getLang() === 'en'
        ? [
            ['Meeting room', 'Lights and AC follow how the room is used'],
            ['Rooftop', 'See the power the solar panels make'],
            ['Car park', 'Watch plates read at the barrier and cars find their bays'],
          ]
        : [
            ['ห้องประชุม', 'ไฟและแอร์ทำงานตามการใช้ห้อง'],
            ['ดาดฟ้า', 'ดูการผลิตไฟจากแผงโซลาร์'],
            ['ลานจอดรถ', 'ดูการอ่านทะเบียนที่ไม้กั้นและรถเข้าช่องจอด'],
          ],
    )}</div>`;
  },
  meeting({state, room, history, timeLabel}) {
    return `<p class="dashboard-intro">${L('ห้องประชุมย่อย 2 ชั้น 4 · ควบคุมไฟและแอร์ตามการใช้งาน', 'Meeting room 2, floor 4 · lights and AC follow how the room is used')}</p><div class="metric-pair">${metric(L('อุณหภูมิห้อง', 'Room temperature'), state.temp.toFixed(1), '°C')}${metric(L('ตั้งอุณหภูมิ', 'Set point'), state.target, '°C')}</div><div class="dashboard-section">${row(L('การใช้งาน', 'Occupancy'), state.occupied ? L(`มีคนอยู่ · ${MEETING_PEOPLE} คน`, `Occupied · ${MEETING_PEOPLE} people`) : L('ไม่มีคน', 'Empty'))}${row(L('แอร์', 'AC'), room.climate ? L('เปิดโหมดเย็น', 'Cooling') : L('ปิด', 'Off'))}${row(L('ประตู', 'Door'), Object.values(room.doors).some(Boolean) ? L('เปิด', 'Open') : L('ปิด', 'Closed'))}</div>${controls(room)}<div class="dashboard-section"><h3>${L('แนวโน้มอุณหภูมิ', 'Temperature trend')}</h3>${chart(history('temp'), state.temp, L('อุณหภูมิ', 'temperature'))}<div class="chart-caption"><span>${timeLabel()}</span><span>${L('เป้าหมาย', 'Target')} ${state.target} °C</span></div></div><button class="panel-action" data-action="${state.occupied ? 'meeting-end' : 'meeting'}">${state.occupied ? icon('leave') + L('จำลองเลิกประชุม', 'End the meeting') : icon('play') + L('จำลองเริ่มประชุม', 'Simulate a meeting')}</button><p class="scenario-note">${state.scenario === 'meeting' ? L('กำลังจำลองการทำความเย็น · เร่งเวลาเพื่อสาธิต', 'Simulating cooling · time sped up for the demo') : L('รูปคนในห้องเป็นภาพจำลอง ไม่ได้ติดตามบุคคลจริง', 'The figures in the room are simulated; no real people are tracked')}</p>`;
  },
  pond({state, history}) {
    return `<p class="dashboard-intro">${L('คุณภาพน้ำและระดับน้ำในบ่อปลา', 'Water quality and water level in the fish pond')}</p><div class="metric-pair">${metric(L('ระดับน้ำ', 'Water level'), state.water, '%')}${metric(L('อุณหภูมิน้ำ', 'Water temperature'), '27.1', '°C')}</div><div class="water-level ${state.pondAlert ? 'warning' : ''}" role="img" aria-label="${L('ระดับน้ำ', 'Water level')} ${state.water}%">${Array.from({length: 12}, (_, i) => `<i class="${i < Math.round((state.water / 100) * 12) ? 'filled' : ''}"></i>`).join('')}</div>${state.pondAlert ? `<div class="alert-strip">${L('ระดับน้ำต่ำ · ตรวจสอบบ่อและระบบเติมน้ำ', 'Low water · check the pond and the refill system')}</div>` : ''}<div class="dashboard-section">${row(L('ความเป็นกรด–ด่าง', 'Acidity'), 'pH 7.2')}${row(L('ออกซิเจนละลายน้ำ', 'Dissolved oxygen'), '6.4 mg/L')}${row(L('สถานะปั๊ม', 'Pump status'), L('ทำงาน', 'Running'))}${row(L('เกณฑ์ระดับน้ำในเดโม', 'Demo water threshold'), L(`เตือนเมื่อ < ${WATER.alert}%`, `Alert below ${WATER.alert}%`))}</div><div class="dashboard-section"><h3>${L('ระดับน้ำย้อนหลัง 8 ชั่วโมง', 'Water level, last 8 hours')}</h3>${chart(history('water'), state.water, L('ระดับน้ำ', 'water level'))}</div><button class="panel-action" data-action="pond">${icon(state.pondAlert ? 'check' : 'drop')}${state.pondAlert ? L('คืนค่าระดับน้ำ', 'Restore water level') : L('จำลองระดับน้ำต่ำ', 'Simulate low water')}</button>`;
  },
  energy({state, sim, history, timeLabel}) {
    return `<p class="dashboard-intro">${L('แผงโซลาร์ 24 แผง · ผลิตไฟฟ้าใช้ภายในอาคาร', '24 solar panels · power used in the building')}</p><div class="metric-pair">${metric(L('ผลิตอยู่ตอนนี้', 'Producing now'), state.solar.toFixed(1), 'kW')}${metric(L('ผลิตสะสมวันนี้', 'Produced today'), state.energy.toFixed(1), 'kWh')}</div><div class="energy-flow"><div class="energy-node">${icon('solar')}<strong>${state.solar.toFixed(1)} kW</strong><span>${L('โซลาร์', 'Solar')}</span></div><span class="flow-arrow">${icon('arrow')}</span><div class="energy-node">${icon('building')}<strong>${state.load.toFixed(1)} kW</strong><span>${L('อาคาร', 'Building')}</span></div></div>${row(L('รับไฟจากกริด', 'From the grid'), Math.max(0, state.load - state.solar).toFixed(1) + ' kW')}${row(L('สัดส่วนไฟจากโซลาร์', 'Solar share'), Math.min(100, Math.round((state.solar / state.load) * 100)) + '%')}<div class="dashboard-section"><h3>${L('กำลังผลิตย้อนหลัง 8 ชั่วโมง', 'Output, last 8 hours')}</h3>${chart(history('solar'), state.solar, L('กำลังผลิตโซลาร์', 'solar output'))}<div class="chart-caption"><span>${timeLabel()}</span><span>kW</span></div></div><button class="panel-action" data-action="energy"${sim.night ? ' disabled' : ''}>${icon('solar')}${sim.night ? L('กลางคืน ไม่มีการผลิตไฟ', 'Night · no sun to make power') : state.solar < SOLAR.low ? L('จำลองแดดกลับมา', 'Simulate the sun returning') : L('จำลองเมฆบังแผง', 'Simulate clouds over the panels')}</button>`;
  },
};
