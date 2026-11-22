// In-memory parking simulation: allowed list, visitor requests, presence, gate events,
// alerts, audit and outbox. Nothing here talks to ATOM, Keycloak, mail or cameras.
import {buildStalls} from './layout.js';
import {bkk} from './i18n.js';
import {later, world, demoNow} from './clock.js';

const DAY_START = bkk(2026, 11, 24, 0, 0);

// Reasons a member of staff can give for opening the barrier by hand.
export const GATE_REASONS = ['gate.reason.misread', 'gate.reason.delivery', 'gate.reason.guest', 'gate.reason.other'];

export const PROVINCES = [
  ['กรุงเทพมหานคร', 'Bangkok'], ['นนทบุรี', 'Nonthaburi'], ['ปทุมธานี', 'Pathum Thani'], ['สมุทรปราการ', 'Samut Prakan'],
  ['ชลบุรี', 'Chon Buri'], ['นครปฐม', 'Nakhon Pathom'], ['เชียงใหม่', 'Chiang Mai'], ['ขอนแก่น', 'Khon Kaen'],
];
const CONSONANTS = 'กขคงจฉชฌญฐฒณดตถทธนบปผพภมยรลวศษสหฬอฮ';
// Letter pairs real plates are not issued with because they read as an unlucky or rude word (ศพ = corpse, ชน = crash).
const AVOID = new Set(['ศพ', 'ชน', 'ตก', 'ตด', 'จม', 'ยม', 'รก']);
const FIRST = ['สมศรี', 'วิไล', 'ประเสริฐ', 'อนันต์', 'กมล', 'จันทร์เพ็ญ', 'ธีระ', 'นภา', 'พรทิพย์', 'วรวุฒิ', 'สุดา', 'อำนาจ', 'ศิริพร', 'ชาญ', 'ดวงใจ', 'ภาณุ', 'รัตนา', 'สมบัติ', 'อุไร', 'เกียรติ', 'ปราณี', 'ณัฐ', 'มยุรี', 'ทองดี'];
const LAST = ['ใจงาม', 'ทองคำ', 'ศรีสุข', 'บุญมา', 'แสงทอง', 'มั่นคง', 'วงศ์ดี', 'สายบุญ', 'พูลสุข', 'รุ่งเรือง', 'ชื่นใจ', 'เย็นใจ', 'นาคดี', 'สุขสม'];
// Sample people, plates and companies are invented for the demo.
export const STORY = {
  visitor: {name: 'ชูใจ ใฝ่รู้', phone: '081-234-5678', email: 'chujai@example.com', company: 'บริษัท ตัวอย่างโลจิสติกส์ จำกัด'},
  contact: 'host.demo@osd.example',
  plate: '7กข 4821', province: 'กรุงเทพมหานคร', color: 4, notes: 'ประชุมเรื่องระบบคลังสินค้า 10:00',
  unknown: {plate: '2ฒษ 9077', province: 'ชลบุรี', color: 6},
};

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const normalizePlate = p => String(p || '').replace(/[\s-]/g, '').toUpperCase();
const key = (plate, province) => `${normalizePlate(plate)}|${province || ''}`;
let idCounter = 1;
const uid = prefix => `${prefix}${(idCounter++).toString(36)}`;

export function createParkingSim() {
  const listeners = new Set();
  let state;

  function emit(kind, payload) { for (const fn of listeners) fn(kind, payload); }
  // A delayed follow-up (ATOM sync, the ticket email) belongs to the state it was made in. After a reset ids start
  // again from 1, so a stale one could otherwise land on a new request with the same id.
  const current = (fn, ms) => { const made = state; later(() => { if (state === made) fn(); }, ms); };
  // Time is the world clock's (src/parking/clock.js), shared with the building and the sky.
  const now = () => world.now();
  const setNow = ms => world.set(ms);
  world.subscribe((kind, payload) => {
    if (kind === 'wrap') shiftDay(payload);
    if (kind !== 'tick') emit('clock', {kind, ...payload});
  });
  // The day wraps (03:00 on the 25th becomes 03:00 on the 24th): every logged time moves back with it, so the night's
  // events read as yesterday's. Pass and visit dates stay, so passes for the 24th keep working every day. Logs older
  // than two days are dropped, which keeps an all-day kiosk's memory flat.
  function shiftDay(delta) {
    const keepFrom = DAY_START - 2 * 864e5;
    const move = list => list.filter(x => (x.at += delta) >= keepFrom);
    state.events = move(state.events); state.audit = move(state.audit); state.emails = move(state.emails);
    for (const a of state.alerts) { a.at += delta; if (a.resolvedAt) a.resolvedAt += delta; }
    state.alerts = state.alerts.filter(a => a.status === 'open' || a.at >= keepFrom);
    for (const p of state.presence.values()) p.since += delta;
    for (const q of state.requests) {
      q.createdAt += delta; if (q.decidedAt) q.decidedAt += delta;
      for (const h of q.history) h.at += delta;
    }
  }

  function seed() {
    const r = rng(2411);
    const pick = list => list[Math.floor(r() * list.length)];
    const plate = () => {
      const c = () => CONSONANTS[Math.floor(r() * CONSONANTS.length)];
      let letters;
      do letters = c() + c(); while (AVOID.has(letters));
      const num = String(1000 + Math.floor(r() * 9000));
      return r() < .55 ? `${1 + Math.floor(r() * 9)}${letters} ${num}` : `${letters} ${num}`;
    };
    const province = () => (r() < .62 ? PROVINCES[0][0] : pick(PROVINCES.slice(1, 6))[0]);
    const person = () => `${pick(FIRST)} ${pick(LAST)}`;
    const stalls = buildStalls().map(s => ({...s, occupant: null}));
    const vehicles = [];
    const addVehicle = v => { const rec = {id: uid('v'), enabled: true, sync: 'synced', validFrom: null, validTo: null, color: Math.floor(r() * 9), ...v}; vehicles.push(rec); return rec; };
    for (let i = 0; i < 3; i++) addVehicle({plate: plate(), province: PROVINCES[0][0], type: 'vip', owner: ['ผู้บริหาร A', 'ผู้บริหาร B', 'ผู้บริหาร C'][i], color: [0, 1, 0][i]});
    for (let i = 0; i < 48; i++) addVehicle({plate: plate(), province: province(), type: 'staff', owner: person()});
    vehicles[9].sync = 'failed'; vehicles[9].syncError = ['ATOM ตอบกลับ 503 · ลองใหม่อัตโนมัติทุก 5 นาที', 'ATOM answered 503 · retried every 5 minutes'];
    vehicles[17].sync = 'pending';

    const requests = [];
    const t = (h, m) => bkk(2026, 11, 24, h, m);
    const addRequest = (o) => {
      const rec = {id: uid('r'), ref: `PK-${(0x4A21 + requests.length * 37).toString(36).toUpperCase()}${String(41 + requests.length).padStart(3, '0')}`, face: false, notes: '', history: [], ...o};
      requests.push(rec); return rec;
    };
    const guestA = addRequest({status: 'approved', visitor: {name: 'วีระ กล้าหาญ', phone: '089-111-2222', email: 'weera@example.com', company: 'บริษัท ตัวอย่างเทค จำกัด'}, contact: 'host.demo@osd.example', plate: '3กพ 1150', province: 'นนทบุรี', arrival: DAY_START, departure: DAY_START, createdAt: bkk(2026, 11, 20, 14, 12), face: true, color: 2,
      history: [{at: bkk(2026, 11, 20, 14, 12), key: 'h.submitted'}, {at: bkk(2026, 11, 20, 15, 3), key: 'h.approved', by: 'staff.name'}, {at: bkk(2026, 11, 20, 15, 3), key: 'h.atom'}, {at: bkk(2026, 11, 20, 15, 4), key: 'h.email'}]});
    addRequest({status: 'approved', visitor: {name: 'มานะ อดทน', phone: '086-555-0101', email: 'mana@example.com', company: 'ห้างหุ้นส่วน ตัวอย่างการช่าง'}, contact: 'facility.demo@osd.example', plate: 'ฎณ 7302', province: 'ปทุมธานี', arrival: DAY_START, departure: bkk(2026, 11, 25), createdAt: bkk(2026, 11, 21, 9, 40), color: 7,
      history: [{at: bkk(2026, 11, 21, 9, 40), key: 'h.submitted'}, {at: bkk(2026, 11, 21, 10, 2), key: 'h.approved', by: 'staff.name'}, {at: bkk(2026, 11, 21, 10, 2), key: 'h.atom'}, {at: bkk(2026, 11, 21, 10, 3), key: 'h.email'}]});
    addRequest({status: 'approved', visitor: {name: 'สมใจ นึก', phone: '084-020-3030', email: 'somjai@example.com', company: 'บริษัท ตัวอย่างพลังงาน จำกัด'}, contact: 'host.demo@osd.example', plate: '1ขค 6620', province: 'ชลบุรี', arrival: bkk(2026, 11, 25), departure: bkk(2026, 11, 25), createdAt: bkk(2026, 11, 23, 11, 5), color: 5,
      history: [{at: bkk(2026, 11, 23, 11, 5), key: 'h.submitted'}, {at: bkk(2026, 11, 23, 13, 20), key: 'h.approved', by: 'staff.name'}, {at: bkk(2026, 11, 23, 13, 20), key: 'h.atom'}, {at: bkk(2026, 11, 23, 13, 21), key: 'h.email'}]});
    addRequest({status: 'pending', visitor: {name: 'ปิติ ยินดี', phone: '082-777-4545', email: 'piti@example.com', company: 'บริษัท ตัวอย่างดีไซน์ จำกัด'}, contact: 'design.demo@osd.example', plate: '9กษ 3388', province: 'สมุทรปราการ', arrival: bkk(2026, 11, 27), departure: bkk(2026, 11, 27), createdAt: bkk(2026, 11, 24, 8, 31), color: 3,
      history: [{at: bkk(2026, 11, 24, 8, 31), key: 'h.submitted'}]});
    addRequest({status: 'rejected', visitor: {name: 'ดวงดาว ส่องแสง', phone: '083-909-1212', email: 'duangdao@example.com', company: 'บริษัท ตัวอย่างอีเวนต์ จำกัด'}, contact: 'host.demo@osd.example', plate: 'งจ 4410', province: 'กรุงเทพมหานคร', arrival: bkk(2026, 11, 23), departure: bkk(2026, 11, 23), createdAt: bkk(2026, 11, 22, 17, 2), color: 8, reason: 'วันที่ขอตรงกับวันปิดซ่อมบำรุงลานจอด กรุณาเลือกวันใหม่',
      history: [{at: bkk(2026, 11, 22, 17, 2), key: 'h.submitted'}, {at: bkk(2026, 11, 23, 8, 15), key: 'h.rejected', by: 'staff.name'}]});
    addRequest({status: 'expired', visitor: {name: 'ใจดี มีสุข', phone: '085-121-3434', email: 'jaidee@example.com', company: '—'}, contact: 'host.demo@osd.example', plate: '5ฮม 2001', province: 'นครปฐม', arrival: bkk(2026, 11, 22), departure: bkk(2026, 11, 22), createdAt: bkk(2026, 11, 21, 20, 44), color: 1,
      history: [{at: bkk(2026, 11, 21, 20, 44), key: 'h.submitted'}, {at: bkk(2026, 11, 23, 0, 1), key: 'h.expired'}]});
    // Visitors booked for the event day, approved earlier in the week: they drop in at random during the day (index.js).
    // Their own random sequence, so the seeded morning above stays as it was.
    {
      const v = rng(7310), vpick = list => list[Math.floor(v() * list.length)];
      const COMPANIES = ['บริษัท ตัวอย่างโลจิสติกส์ จำกัด', 'บริษัท ตัวอย่างการแพทย์ จำกัด', 'บริษัท ตัวอย่างก่อสร้าง จำกัด', 'ห้างหุ้นส่วน ตัวอย่างบริการ', 'บริษัท ตัวอย่างการเงิน จำกัด', 'บริษัท ตัวอย่างอาหาร จำกัด', '—'];
      for (let i = 0; i < 8; i++) {
        let letters;
        do letters = CONSONANTS[Math.floor(v() * CONSONANTS.length)] + CONSONANTS[Math.floor(v() * CONSONANTS.length)]; while (AVOID.has(letters));
        const plateText = `${v() < .5 ? 1 + Math.floor(v() * 9) : ''}${letters} ${1000 + Math.floor(v() * 9000)}`;
        const day = 20 + Math.floor(v() * 4), h = 9 + Math.floor(v() * 8), m = Math.floor(v() * 60), made = bkk(2026, 11, day, h, m), ok = made + (20 + Math.floor(v() * 90)) * 60e3;
        addRequest({status: 'approved', visitor: {name: `${vpick(FIRST)} ${vpick(LAST)}`, phone: `08${Math.floor(v() * 10)}-${String(100 + Math.floor(v() * 900))}-${String(1000 + Math.floor(v() * 9000))}`, email: `visitor${i + 1}@example.com`, company: vpick(COMPANIES)},
          contact: 'host.demo@osd.example', plate: plateText, province: v() < .6 ? PROVINCES[0][0] : vpick(PROVINCES.slice(1, 6))[0], arrival: DAY_START, departure: DAY_START, createdAt: made, color: Math.floor(v() * 9),
          history: [{at: made, key: 'h.submitted'}, {at: ok, key: 'h.approved', by: 'staff.name'}, {at: ok, key: 'h.atom'}, {at: ok + 60e3, key: 'h.email'}]});
      }
    }
    for (const req of requests.filter(q => q.status === 'approved')) {
      req.vehicleId = addVehicle({plate: req.plate, province: req.province, type: 'guest', owner: req.visitor.name, validFrom: req.arrival, validTo: req.departure + 86399e3, requestId: req.id, color: req.color}).id;
      req.qr = req.ref;
    }

    // Today so far: presence was reset at 03:00; staff arrived from 06:50.
    const events = [], audit = [];
    const presence = new Map();
    const staff = vehicles.filter(v => v.type === 'staff' && v.sync === 'synced');
    const order = [...staff].sort(() => r() - .5);
    const arrivals = [];
    for (let i = 0; i < 27; i++) {
      const minute = 6 * 60 + 50 + Math.round(Math.pow(i / 27, .8) * 125 + r() * 4);
      arrivals.push({v: order[i], at: bkk(2026, 11, 24, 0, minute)});
    }
    arrivals.push({v: vehicles.find(v => v.type === 'vip'), at: t(8, 22)});
    arrivals.push({v: vehicles.find(v => v.requestId === guestA.id), at: t(8, 41)});
    arrivals.push({v: vehicles.filter(v => v.type === 'vip')[1], at: t(8, 55)});
    arrivals.sort((a, b) => a.at - b.at);
    const freeFor = type => stalls.find(s => !s.occupant && (type === 'vip' ? s.zone === 'P1' : type === 'guest' ? s.reserved === 'guest' : s.zone === 'P2' && s.reserved !== 'guest' && r() < .55))
      || stalls.find(s => !s.occupant && s.zone === 'P2' && (type === 'guest' || s.reserved !== 'guest'));
    for (const {v, at} of arrivals) {
      const stall = freeFor(v.type);
      stall.occupant = key(v.plate, v.province);
      presence.set(stall.occupant, {plate: v.plate, province: v.province, type: v.type, stallId: stall.id, since: at, color: v.color, vehicleId: v.id});
      events.push({id: uid('e'), at, kind: 'entry', plate: v.plate, province: v.province, type: v.type, camera: 'LPR-IN', confidence: .93 + r() * .06});
    }
    // Three early leavers: a courier run and two others (coming back later is not modelled).
    for (const at of [t(8, 5), t(8, 38), t(8, 57)]) {
      const [k, p] = [...presence.entries()].find(([, p]) => p.type === 'staff' && p.since < at - 20 * 60e3) || [];
      if (!k) continue;
      presence.delete(k); stalls.find(s => s.id === p.stallId).occupant = null;
      events.push({id: uid('e'), at, kind: 'exit', plate: p.plate, province: p.province, type: p.type, camera: 'LPR-OUT', confidence: .96});
    }
    events.push({id: uid('e'), at: t(8, 47), kind: 'denied', plate: '4ศย 5150', province: 'ปทุมธานี', type: 'unknown', camera: 'LPR-IN', confidence: .9, by: 'staff.guard'});
    events.push({id: uid('e'), at: t(7, 52), kind: 'manual', plate: 'ผต 8812', province: 'กรุงเทพมหานคร', type: 'unknown', camera: 'LPR-IN', confidence: .88, by: 'staff.guard', reason: 'gate.reason.delivery', left: true});
    events.push({id: uid('e'), at: t(8, 9), kind: 'exit', plate: 'ผต 8812', province: 'กรุงเทพมหานคร', type: 'unknown', camera: 'LPR-OUT', confidence: .95});
    events.sort((a, b) => b.at - a.at);
    audit.push({at: t(7, 46), actor: 'staff.guard', key: 'a.login'});
    audit.push({at: t(7, 52), actor: 'staff.guard', key: 'a.manual', target: 'ผต 8812', reasonKey: 'gate.reason.delivery'});
    audit.push({at: t(8, 2), actor: 'staff.name', key: 'a.login'});
    audit.push({at: t(8, 47), actor: 'staff.guard', key: 'a.deny', target: '4ศย 5150'});
    audit.push({at: bkk(2026, 11, 23, 8, 15), actor: 'staff.name', key: 'a.reject', target: 'งจ 4410'});
    audit.push({at: bkk(2026, 11, 23, 13, 20), actor: 'staff.name', key: 'a.approve', target: '1ขค 6620'});
    audit.push({at: bkk(2026, 11, 21, 10, 2), actor: 'staff.name', key: 'a.approve', target: 'ฎณ 7302'});
    audit.sort((a, b) => b.at - a.at);

    return {stalls, vehicles, requests, events, audit, presence, alerts: [], emails: [], capacity: stalls.length, gate: 'closed', yesterday: {entries: 41, exits: 40, peak: 37, peakAt: '10:40', received: 5, approved: 4, rejected: 1, unknown: 3, manual: 2, syncFailed: 1, byType: {staff: 34, vip: 3, guest: 3, unknown: 1}}};
  }

  // The seeded morning is the car park at 09:00. Started at another time of day, whatever lies in its future is left
  // out (the traffic then brings the car park to the level for that hour): cars that came later, the leaving of those
  // that left later (who are then still in, back in a free bay), and requests made later.
  function reset() {
    idCounter = 1;
    state = seed();
    const at = now();
    if (at < bkk(2026, 11, 24, 9, 0)) {
      const leftLater = state.events.filter(e => e.at > at && e.kind === 'exit');
      state.events = state.events.filter(e => e.at <= at);
      state.audit = state.audit.filter(a => a.at <= at);
      state.requests = state.requests.filter(q => q.status !== 'pending' || q.createdAt <= at); // not sent yet
      for (const [k, p] of state.presence) if (p.since > at) { state.presence.delete(k); state.stalls.find(s => s.id === p.stallId).occupant = null; }
      for (const e of leftLater) {
        const k = key(e.plate, e.province), entry = state.events.find(x => x.kind === 'entry' && key(x.plate, x.province) === k);
        const stall = entry && !state.presence.has(k) && freeStall(e.type);
        if (!stall) continue;
        const v = findVehicle(e.plate, e.province)[0];
        stall.occupant = k;
        state.presence.set(k, {plate: e.plate, province: e.province, type: e.type, stallId: stall.id, since: entry.at, color: v?.color ?? 0, vehicleId: v?.id});
      }
    }
    emit('reset');
  }

  const findVehicle = (plate, province) => {
    const p = normalizePlate(plate);
    const list = state.vehicles.filter(v => normalizePlate(v.plate) === p && (!province || !v.province || v.province === province));
    const rank = {vip: 0, staff: 1, guest: 2};
    return list.sort((a, b) => rank[a.type] - rank[b.type]);
  };

  function decide(plate, province) {
    const at = now();
    for (const v of findVehicle(plate, province)) {
      const valid = v.enabled && v.sync === 'synced' && (!v.validFrom || at >= v.validFrom) && (!v.validTo || at <= v.validTo);
      if (valid) return {allow: true, type: v.type, vehicle: v};
    }
    return {allow: false, type: 'unknown'};
  }

  function audit(actor, keyName, extra = {}) { state.audit.unshift({at: now(), actor, key: keyName, ...extra}); emit('audit'); }

  // `allow`: only bays it accepts (the background life keeps cars from popping into bays on screen).
  function freeStall(type, allow = () => true) {
    const free = state.stalls.filter(s => !s.occupant && allow(s));
    const prefer = type === 'vip' ? free.filter(s => s.zone === 'P1') : type === 'guest' ? free.filter(s => s.reserved === 'guest') : free.filter(s => s.zone === 'P2' && s.reserved !== 'guest');
    const pool = prefer.length ? prefer : free.filter(s => s.zone === 'P2');
    if (!pool.length) return null;
    // Visitors get the first free visitor bay nearest the driveway; others spread through the lot.
    if (type === 'guest') return pool.sort((a, b) => b.z - a.z)[0];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // `at` is for the car park catching up on time it did not show (a jump, or while off screen); calls go oldest first.
  function recordEntry({plate, province, type, stallId, color, manual = null, confidence = .97, at = now()}) {
    const k = key(plate, province);
    // A plate already in (a second listing of it let in) gives up the bay it held: it kept it taken for good.
    const held = state.presence.get(k), before = held && state.stalls.find(s => s.id === held.stallId && s.occupant === k);
    if (before && before.id !== stallId) before.occupant = null;
    const stall = state.stalls.find(s => s.id === stallId);
    if (stall) stall.occupant = k;
    const vehicle = findVehicle(plate, province)[0];
    state.presence.set(k, {plate, province, type, stallId, since: at, color, vehicleId: vehicle?.id});
    const event = {id: uid('e'), at, kind: manual ? 'manual' : 'entry', plate, province, type, camera: 'LPR-IN', confidence, ...(manual || {})};
    state.events.unshift(event);
    emit('entry', event);
    return event;
  }
  function recordExit({plate, province, at = now()}) {
    const k = key(plate, province);
    const p = state.presence.get(k);
    if (p) { state.presence.delete(k); const s = state.stalls.find(s => s.id === p.stallId); if (s) s.occupant = null; }
    const event = {id: uid('e'), at, kind: p ? 'exit' : 'exitNoEntry', plate, province, type: p?.type || findVehicle(plate, province)[0]?.type || 'unknown', camera: 'LPR-OUT', confidence: .96};
    state.events.unshift(event);
    emit('exit', event);
    return event;
  }

  function raiseAlert({plate, province, snapshot, color, ambient = false}) {
    // `raised` is demo time (demoNow): how long a car has waited is not world-clock time, which may run fast.
    const alert = {id: uid('a'), at: now(), raised: demoNow(), plate, province, snapshot, color, status: 'open', ambient};
    state.alerts.unshift(alert);
    state.events.unshift({id: uid('e'), at: now(), kind: 'unknown', plate, province, type: 'unknown', camera: 'LPR-IN', confidence: .91, alertId: alert.id});
    emit('alert', alert);
    return alert;
  }
  function resolveAlert(id, decision, reasonKey = 'gate.reason.other', actor = 'staff.name') {
    const alert = state.alerts.find(a => a.id === id);
    if (!alert || alert.status !== 'open') return null;
    alert.status = decision === 'open' ? 'opened' : 'denied';
    alert.by = actor; alert.reasonKey = reasonKey; alert.resolvedAt = now();
    const ev = state.events.find(e => e.alertId === id);
    if (ev && decision === 'deny') { ev.kind = 'denied'; ev.by = actor; }
    if (ev && decision === 'open') state.events.splice(state.events.indexOf(ev), 1);
    if (decision === 'open') audit(actor, 'a.manual', {target: alert.plate, reasonKey});
    else audit(actor, 'a.deny', {target: alert.plate});
    emit('alertResolved', alert);
    return alert;
  }

  function setGate(value) { if (state.gate !== value) { state.gate = value; emit('gate', value); } }
  function manualGate(command, reasonKey) {
    audit('staff.name', 'a.manual', {target: '—', reasonKey});
    emit('manualGate', {command, reasonKey});
  }

  // Visitor requests
  function submitRequest(data) {
    const at = now();
    const dup = state.requests.find(q => ['pending', 'approved'].includes(q.status) && normalizePlate(q.plate) === normalizePlate(data.plate) && q.arrival === data.arrival && q.visitor.email === data.visitor.email);
    const req = dup || {id: uid('r'), ref: `PK-${Math.random().toString(36).slice(2, 6).toUpperCase()}${String(state.requests.length + 41).padStart(3, '0')}`, status: 'pending', createdAt: at, history: [{at, key: 'h.submitted'}], color: data.color ?? Math.floor(Math.random() * 9), ...data};
    if (!dup) state.requests.unshift(req);
    req.receipt = `RC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    emit('request', req);
    return req;
  }
  function flagsFor(req) {
    const flags = [];
    if (req.arrival <= now() && req.departure + 86399e3 >= now()) flags.push('req.flag.today');
    if (findVehicle(req.plate, req.province).some(v => v.type === 'staff' || v.type === 'vip')) flags.push('req.flag.staff');
    if (state.requests.some(q => q !== req && q.status === 'approved' && normalizePlate(q.plate) === normalizePlate(req.plate))) flags.push('req.flag.overlap');
    return flags;
  }
  function approve(id) {
    const req = state.requests.find(q => q.id === id);
    if (!req || req.status !== 'pending') return;
    req.status = 'approved'; req.decidedAt = now(); req.syncing = true;
    req.history.push({at: now(), key: 'h.approved', by: 'staff.name'});
    const vehicle = {id: uid('v'), plate: req.plate, province: req.province, type: 'guest', owner: req.visitor.name, validFrom: req.arrival, validTo: req.departure + 86399e3, requestId: req.id, enabled: true, sync: 'pending', color: req.color};
    state.vehicles.push(vehicle);
    req.vehicleId = vehicle.id;
    req.qr = req.ref;
    audit('staff.name', 'a.approve', {target: req.plate});
    emit('request', req);
    // Simulated ATOM confirms the vehicle and person, then the ticket goes out (not if revoked in the meantime).
    current(() => {
      if (req.status !== 'approved') return; // revoked before ATOM confirmed: the add was withdrawn (see revoke)
      vehicle.sync = 'synced'; req.syncing = false;
      req.history.push({at: now(), key: 'h.atom'});
      emit('vehicle', vehicle);
      current(() => {
        if (req.status !== 'approved') return;
        req.history.push({at: now(), key: 'h.email'});
        sendEmail(req, 'approved');
        emit('request', req);
      }, 500);
    }, 1100);
  }
  function reject(id, reason) {
    const req = state.requests.find(q => q.id === id);
    if (!req || req.status !== 'pending') return;
    req.status = 'rejected'; req.reason = reason; req.decidedAt = now();
    req.history.push({at: now(), key: 'h.rejected', by: 'staff.name'});
    audit('staff.name', 'a.reject', {target: req.plate});
    sendEmail(req, 'rejected');
    emit('request', req);
  }
  function revoke(id) {
    const req = state.requests.find(q => q.id === id);
    if (!req || req.status !== 'approved') return;
    req.status = 'revoked';
    req.history.push({at: now(), key: 'h.revoked', by: 'staff.name'});
    const v = state.vehicles.find(v => v.id === req.vehicleId);
    // Not yet confirmed by ATOM: the pending add is withdrawn; otherwise the plate stays listed, disabled.
    const unconfirmed = Boolean(v && v.sync === 'pending');
    if (unconfirmed) { state.vehicles.splice(state.vehicles.indexOf(v), 1); req.vehicleId = null; req.syncing = false; }
    else if (v) v.enabled = false;
    audit('staff.name', 'a.revoke', {target: req.plate});
    // As in the ATOM Parking app: the visitor hears of an approval only once ATOM confirms it, so one revoked before that
    // is not told its access was revoked (it was told it had none to lose).
    if (!unconfirmed) sendEmail(req, 'revoked');
    emit('request', req);
  }
  function sendEmail(req, kind) {
    const mail = {id: uid('m'), at: now(), kind, requestId: req.id, to: [req.visitor.email, req.contact]};
    state.emails.unshift(mail);
    emit('email', mail);
  }

  // Allowed list
  function addVehicle({plate, province, owner, type = 'staff'}) {
    const v = {id: uid('v'), plate, province, owner, type, enabled: true, sync: 'pending', color: Math.floor(Math.random() * 9)};
    state.vehicles.push(v);
    audit('staff.name', 'a.plateAdd', {target: plate});
    emit('vehicle', v);
    current(() => { v.sync = 'synced'; emit('vehicle', v); }, 1400);
    return v;
  }
  function importCsv() {
    const samples = [['6กฉ 2207', 'กรุงเทพมหานคร', 'อารี ทองคำ'], ['ขธ 5519', 'นนทบุรี', 'สุนทร ศรีสุข'], ['8กร 7340', 'กรุงเทพมหานคร', 'พิมพ์ใจ บุญมา']];
    // Imported again, the same plates are not listed twice.
    const listed = new Set(state.vehicles.map(v => key(v.plate, v.province)));
    const added = samples.filter(([plate, province]) => !listed.has(key(plate, province))).map(([plate, province, owner]) => ({id: uid('v'), plate, province, owner, type: 'staff', enabled: true, sync: 'pending', color: Math.floor(Math.random() * 9)}));
    state.vehicles.push(...added);
    audit('staff.name', 'a.import', {target: String(added.length)});
    emit('vehicle');
    current(() => { for (const v of added) v.sync = 'synced'; emit('vehicle'); }, 1600);
  }
  function setEnabled(id, enabled) {
    const v = state.vehicles.find(v => v.id === id);
    if (!v) return;
    v.enabled = enabled;
    audit('staff.name', enabled ? 'a.plateEnable' : 'a.plateDisable', {target: v.plate});
    emit('vehicle', v);
  }
  function retrySync(id) {
    const v = state.vehicles.find(v => v.id === id);
    if (!v) return;
    v.sync = 'pending'; v.syncError = null;
    audit('staff.name', 'a.retry', {target: v.plate});
    emit('vehicle', v);
    current(() => { v.sync = 'synced'; emit('vehicle', v); }, 1300);
  }

  function stats() {
    const at = now();
    const today = state.events.filter(e => e.at >= DAY_START && e.at <= at);
    const entries = today.filter(e => e.kind === 'entry' || e.kind === 'manual');
    const exits = today.filter(e => e.kind === 'exit' || e.kind === 'exitNoEntry');
    const hourly = [];
    // The whole day (the car park is open round the clock), counted from the day's start, so the small hours after
    // midnight (before the day wraps at 03:00) still show the evening behind them.
    // After midnight, until the day wraps at 03:00, the small hours are charted on after 23:00 (they count in the totals).
    const nowHour = Math.floor((at - DAY_START) / 3600e3);
    for (let h = 0; h < Math.min(27, Math.max(24, nowHour + 1)); h++) {
      const from = DAY_START + h * 3600e3, to = from + 3600e3;
      hourly.push({h: h % 24, in: h > nowHour ? null : entries.filter(e => e.at >= from && e.at < to).length, out: h > nowHour ? null : exits.filter(e => e.at >= from && e.at < to).length});
    }
    const byType = {staff: 0, vip: 0, guest: 0, unknown: 0};
    for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
    // Cars parked since before the day began (overnight: the 03:00 wrap moved their entries into yesterday) count from
    // its start: today's in and out, taken back from the cars there now.
    const wentOut = today.filter(e => e.kind === 'exit').length;
    let level = Math.max(0, state.presence.size - entries.length + wentOut), peak = level, peakAt = level ? DAY_START : null;
    for (const e of [...today].sort((a, b) => a.at - b.at)) {
      if (e.kind === 'entry' || e.kind === 'manual') level++; else if (e.kind === 'exit') level = Math.max(0, level - 1);
      if (level > peak) { peak = level; peakAt = e.at; }
    }
    const zones = {P1: {used: 0, total: 0}, P2: {used: 0, total: 0}};
    for (const s of state.stalls) { zones[s.zone].total++; if (s.occupant) zones[s.zone].used++; }
    const todayReq = state.requests.filter(q => q.createdAt >= DAY_START);
    return {
      parked: state.presence.size, capacity: state.capacity, entries: entries.length, exits: exits.length,
      pending: state.requests.filter(q => q.status === 'pending').length,
      unknown: today.filter(e => ['unknown', 'denied', 'manual'].includes(e.kind) && e.type === 'unknown').length,
      manual: today.filter(e => e.kind === 'manual').length,
      hourly, byType, peak, peakAt, zones,
      received: todayReq.length, approved: state.requests.filter(q => q.decidedAt >= DAY_START && q.status !== 'rejected').length,
      rejected: state.requests.filter(q => q.decidedAt >= DAY_START && q.status === 'rejected').length,
      syncFailed: state.vehicles.filter(v => v.sync === 'failed').length,
    };
  }

  function attention() {
    const items = [];
    for (const a of state.alerts.filter(a => a.status === 'open')) items.push({kind: 'alert', key: 'att.alert', target: a.plate, id: a.id, at: a.at});
    for (const q of state.requests.filter(q => q.status === 'pending')) items.push({kind: 'request', key: 'att.pending', target: `${q.visitor.name} · ${q.plate}`, id: q.id, at: q.createdAt});
    for (const v of state.vehicles.filter(v => v.sync === 'failed' || v.sync === 'pending')) items.push({kind: 'vehicle', key: v.sync === 'failed' ? 'att.sync.failed' : 'att.sync.pending', target: v.plate, id: v.id, at: 0});
    return items.slice(0, 8);
  }

  reset();
  return {
    get state() { return state; }, now, setNow, reset, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    decide, freeStall, recordEntry, recordExit, raiseAlert, resolveAlert, setGate, manualGate,
    submitRequest, approve, reject, revoke, flagsFor, addVehicle, importCsv, setEnabled, retrySync,
    stats, attention, findVehicle, key,
  };
}
