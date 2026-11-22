// Thai (default) and English strings for the parking demo, plus Bangkok-time formatting.
// The language choice is kept in this browser only.

const KEY = 'osd-demo-language';
const listeners = new Set();
let lang = (() => { try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'th'; } catch { return 'th'; } })();

export const getLang = () => lang;
export function setLang(next) {
  lang = next === 'en' ? 'en' : 'th';
  try { localStorage.setItem(KEY, lang); } catch {}
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}
export const onLang = fn => { listeners.add(fn); return () => listeners.delete(fn); };
document.documentElement.lang = lang;

// [thai, english]
const S = {
  // destination + general
  'parking.dock': ['ที่จอดรถ', 'Parking'],
  'parking.panel': ['ระบบที่จอดรถ', 'Parking access'],
  'parking.chip': ['ลานจอด 50 คัน · ไม้กั้นและกล้องอ่านทะเบียน', '50-space car park · barrier and plate cameras'],
  'parking.floor': ['ลานจอดรถ', 'Car park'],
  'sim.data': ['ข้อมูลจำลอง', 'Simulated data'],
  'sim.disclosure': ['ข้อมูลและเหตุการณ์เพื่อสาธิต · ไม่เชื่อมต่ออุปกรณ์จริง', 'Demo data and events · no real devices connected'],
  'back': ['ย้อนกลับ', 'Back'],
  'next': ['ถัดไป', 'Next'],
  'cancel': ['ยกเลิก', 'Cancel'],
  'save': ['บันทึก', 'Save'],
  'search': ['ค้นหาชื่อหรือทะเบียน', 'Search name or plate'],
  'all': ['ทั้งหมด', 'All'],
  'none': ['ไม่มีรายการ', 'Nothing here'],
  'cars': ['คัน', 'cars'],
  'today': ['วันนี้', 'Today'],
  'staff.name': ['เจ้าหน้าที่ อรุณี', 'Staff: Arunee'],
  'staff.guard': ['รปภ. ประตูหลัก', 'Main-gate guard'],

  // tabs
  'tab.overview': ['ภาพรวม', 'Overview'],
  'tab.requests': ['คำขอ', 'Requests'],
  'tab.gate': ['ไม้กั้น', 'Gate'],
  'tab.vehicles': ['ทะเบียนรถ', 'Vehicles'],
  'tab.reports': ['รายงาน', 'Reports'],
  'console.title': ['คอนโซลเจ้าหน้าที่', 'Staff console'],

  // overview
  'ov.occupancy': ['จอดอยู่ตอนนี้', 'Parked now'],
  'ov.free': ['ว่าง', 'Free'],
  'ov.capacity': ['ความจุ', 'Capacity'],
  'ov.entries': ['เข้าวันนี้', 'Entries today'],
  'ov.exits': ['ออกวันนี้', 'Exits today'],
  'ov.pending': ['คำขอรออนุมัติ', 'Pending requests'],
  'ov.unknown': ['รถไม่รู้จักวันนี้', 'Unknown cars today'],
  'ov.hourly': ['รถเข้าออกแต่ละชั่วโมง · วันนี้', 'Entries and exits per hour · today'],
  'ov.attention': ['ต้องดูแล', 'Needs attention'],
  'ov.zones': ['โซนที่จอด', 'Zones'],
  'zone.P1': ['P1 ข้างอาคาร · VIP เท่านั้น', 'P1 by the building · VIP only'],
  'zone.P2': ['P2 ลานกลางแจ้ง · ทั่วไปและผู้มาติดต่อ', 'P2 open-air · general and visitors'],
  'ov.recent': ['เหตุการณ์ล่าสุดที่ไม้กั้น', 'Latest at the barrier'],
  'ov.stale': ['ข้อมูลอัปเดตต่อเนื่อง', 'Live'],
  'ov.lastReset': ['รีเซ็ตยอดคงค้าง 03:00', 'Presence reset at 03:00'],

  // attention items
  'att.sync.failed': ['ส่งทะเบียนไป ATOM ไม่สำเร็จ', 'Sending the plate to ATOM failed'],
  'att.sync.pending': ['รอ ATOM ยืนยันทะเบียน', 'Waiting for ATOM to confirm'],
  'att.alert': ['รถไม่รู้จักรออยู่ที่ไม้กั้น', 'Unknown car waiting at the barrier'],
  'att.pending': ['คำขอใหม่รออนุมัติ', 'New request waiting for approval'],

  // requests
  'req.status.pending': ['รออนุมัติ', 'Pending'],
  'req.status.approved': ['อนุมัติแล้ว', 'Approved'],
  'req.status.rejected': ['ไม่อนุมัติ', 'Rejected'],
  'req.status.expired': ['หมดอายุ', 'Expired'],
  'req.status.revoked': ['ยกเลิกสิทธิ์', 'Revoked'],
  'req.new': ['ใหม่', 'New'],
  'req.visitor': ['ผู้มาติดต่อ', 'Visitor'],
  'req.company': ['บริษัท', 'Company'],
  'req.phone': ['โทรศัพท์', 'Phone'],
  'req.email': ['อีเมลผู้มาติดต่อ', 'Visitor email'],
  'req.contact': ['อีเมลผู้ติดต่อใน OSD', 'OSD contact email'],
  'req.plate': ['ทะเบียนรถ', 'Plate'],
  'req.province': ['จังหวัด', 'Province'],
  'req.dates': ['วันที่เข้า', 'Visit dates'],
  'req.arrival': ['วันที่มาถึง', 'Arrival date'],
  'req.departure': ['วันที่ออก', 'Departure date'],
  'req.notes': ['หมายเหตุ', 'Notes'],
  'req.face': ['ใบหน้า', 'Face'],
  'req.face.yes': ['ยินยอม · ใช้เข้าประตูอาคาร', 'Consented · for building doors'],
  'req.face.no': ['ไม่ให้ใบหน้า · ใช้ QR', 'No face · QR only'],
  'req.receipt': ['เลขอ้างอิง', 'Reference'],
  'req.atom': ['ตรวจใน ATOM', 'ATOM lookup'],
  'req.atom.none': ['ไม่พบทะเบียนนี้ · จะสร้างรายการใหม่', 'Plate not found · a new record will be created'],
  'req.atom.found': ['พบทะเบียนนี้แล้ว · จะเชื่อมรายการเดิม', 'Plate already there · will link the existing record'],
  'req.access': ['สิทธิ์เข้า', 'Access'],
  'req.access.value': ['{from} 00:00 – {to} 24:00', '{from} 00:00 – {to} 24:00'],
  'req.approve': ['อนุมัติ', 'Approve'],
  'req.reject': ['ไม่อนุมัติ', 'Reject'],
  'req.revoke': ['ยกเลิกสิทธิ์', 'Revoke'],
  'req.reject.reason': ['เหตุผล (ส่งให้ผู้มาติดต่อและผู้ติดต่อ)', 'Reason (sent to the visitor and the contact)'],
  'req.reject.default': ['วันที่ขอตรงกับวันปิดซ่อมบำรุงลานจอด กรุณาเลือกวันใหม่', 'The car park is closed for maintenance that day; please choose another date'],
  'req.revoke.confirm': ['ยกเลิกสิทธิ์ทันที และแจ้งทั้งสองฝ่ายทางอีเมล?', 'End access now and email both parties?'],
  'req.revoke.confirmNoMail': ['ยกเลิกสิทธิ์ทันที? (ยังไม่ได้ส่งบัตรจอดทางอีเมล จึงไม่มีอีเมลแจ้ง)', 'End access now? (No ticket was emailed yet, so no email goes out.)'],
  'req.approve.confirm': ['อนุมัติแล้วระบบจะลงทะเบียนรถใน ATOM ออก QR และส่งอีเมลยืนยัน', 'Approving registers the car in ATOM, issues a QR code and emails the ticket'],
  'req.history': ['ประวัติ', 'History'],
  'req.flag.today': ['มาถึงวันนี้', 'Arrives today'],
  'req.flag.staff': ['ทะเบียนนี้เป็นรถพนักงาน', 'Plate is a staff car'],
  'req.flag.overlap': ['ซ้อนกับคำขออื่น', 'Overlaps another request'],
  'req.qr': ['QR สำหรับประตูอาคาร', 'QR for building doors'],
  'req.back': ['กลับไปรายการ', 'Back to list'],
  'req.registered': ['ลงทะเบียนใน ATOM แล้ว', 'Registered in ATOM'],
  'req.registering': ['กำลังลงทะเบียนใน ATOM…', 'Registering in ATOM…'],
  'req.emailSent': ['ส่งอีเมลยืนยันแล้ว', 'Ticket emailed'],
  'req.emailSent.rejected': ['ส่งอีเมลแจ้งผลไม่อนุมัติแล้ว', 'Rejection emailed'],
  'req.emailSent.revoked': ['ส่งอีเมลแจ้งยกเลิกสิทธิ์แล้ว', 'Revocation emailed'],

  // history actions
  'h.submitted': ['ส่งคำขอจากหน้าเว็บสาธารณะ', 'Submitted on the public page'],
  'h.approved': ['อนุมัติ', 'Approved'],
  'h.rejected': ['ไม่อนุมัติ', 'Rejected'],
  'h.revoked': ['ยกเลิกสิทธิ์', 'Revoked'],
  'h.atom': ['ATOM ยืนยันทะเบียนและบุคคล', 'ATOM confirmed the vehicle and person'],
  'h.email': ['ส่งอีเมลถึงผู้มาติดต่อและผู้ติดต่อ', 'Emailed the visitor and contact'],
  'h.expired': ['หมดอายุหลังวันเข้าพบ', 'Expired after the visit date'],

  // gate
  'gate.status': ['สถานะไม้กั้น', 'Barrier status'],
  'gate.closed': ['ปิด', 'Closed'],
  'gate.opening': ['กำลังเปิด', 'Opening'],
  'gate.open': ['เปิด', 'Open'],
  'gate.closing': ['กำลังปิด', 'Closing'],
  'gate.online': ['ออนไลน์', 'Online'],
  'gate.camIn': ['กล้องขาเข้า LPR-IN', 'Entry camera LPR-IN'],
  'gate.camOut': ['กล้องขาออก LPR-OUT', 'Exit camera LPR-OUT'],
  'gate.manual': ['เปิดไม้กั้นด้วยตนเอง', 'Open the barrier manually'],
  'gate.manual.note': ['ต้องระบุเหตุผล · ระบบบันทึกผู้สั่งและเวลา', 'A reason is required · who and when are recorded'],
  'gate.reason': ['เหตุผล', 'Reason'],
  'gate.reason.misread': ['อ่านทะเบียนผิด', 'Plate misread'],
  'gate.reason.delivery': ['รถส่งของ / ผู้รับเหมา', 'Delivery / contractor'],
  'gate.reason.guest': ['แขกที่ยืนยันตัวตนทางโทรศัพท์แล้ว', 'Guest verified by phone'],
  'gate.reason.other': ['อื่น ๆ', 'Other'],
  'gate.manual.alertFirst': ['มีรถไม่รู้จักรออยู่ · ตอบการแจ้งเตือนด้านบนก่อน', 'An unknown car is waiting · answer the alert above first'],
  'gate.full': ['ที่จอดเต็ม · {plate} ถูกแจ้งให้กลับรถ', 'Car park full · {plate} was turned away'],
  'gate.openOnce': ['เปิดหนึ่งครั้ง', 'Open once'],
  'gate.log': ['บันทึกการเข้าออก', 'Entry and exit log'],
  'gate.sim': ['ส่งรถมาที่ไม้กั้น', 'Send a car to the barrier'],
  'gate.sim.registered': ['รถพนักงาน', 'Staff car'],
  'gate.sim.visitor': ['รถผู้มาติดต่อ', 'Approved visitor'],
  'gate.sim.unknown': ['รถไม่รู้จัก', 'Unknown car'],
  'gate.sim.exit': ['รถออก', 'A car leaves'],
  'gate.sim.coming': ['{plate} กำลังขับมาที่ไม้กั้น', '{plate} is driving to the barrier'],
  'gate.sim.leaving': ['{plate} กำลังออกจากที่จอด', '{plate} is leaving its bay'],
  'gate.sim.queued': ['ต่อคิวหลังรถคันก่อน', 'queued behind the car ahead'],
  'gate.sim.noVisitor': ['ไม่มีผู้มาติดต่อที่อนุมัติสำหรับวันนี้และยังไม่มาถึง · ส่งคำขอจากมือถือแล้วกดอนุมัติก่อน', 'No approved visitor is still due today · send a request from the phone and approve it first'],
  'gate.sim.noStaff': ['รถพนักงานทุกคันจอดอยู่แล้ว', 'Every staff car is already parked'],
  'gate.sim.waitingAlert': ['มีรถไม่รู้จักรอการตัดสินใจที่ไม้กั้น · เลือกเปิดหรือไม่ให้เข้าก่อน', 'An unknown car is waiting at the barrier · choose Open or Deny first'],

  // events
  'ev.entry': ['เข้า', 'In'],
  'ev.exit': ['ออก', 'Out'],
  'ev.unknown': ['ไม่รู้จัก · รอตัดสินใจ', 'Unknown · waiting'],
  'ev.denied': ['ไม่ให้เข้า', 'Denied'],
  'ev.manual': ['เปิดด้วยตนเอง', 'Opened manually'],
  'ev.exitNoEntry': ['ออกโดยไม่พบรายการเข้า', 'Exit with no entry'],
  'type.staff': ['พนักงาน', 'Staff'],
  'type.vip': ['VIP', 'VIP'],
  'type.guest': ['ผู้มาติดต่อ', 'Visitor'],
  'type.unknown': ['ไม่รู้จัก', 'Unknown'],

  // alert
  'alert.title': ['รถไม่รู้จักที่ไม้กั้น', 'Unknown car at the barrier'],
  'alert.body': ['ไม่พบทะเบียนในรายการที่อนุญาต · ไม้กั้นยังปิดอยู่', 'Plate is not on the allowed list · the barrier stays closed'],
  'alert.open': ['เปิดให้เข้า', 'Open'],
  'alert.deny': ['ไม่ให้เข้า', 'Deny'],
  'alert.openReason': ['เลือกเหตุผลก่อนเปิด', 'Pick a reason to open'],
  'alert.notify': ['แจ้งเตือนส่งถึง LINE กลุ่ม รปภ.', 'Alert also sent to the guards’ LINE group'],

  // LPR feed
  'lpr.read': ['อ่านทะเบียน', 'Plate read'],
  'lpr.confidence': ['ความมั่นใจ', 'Confidence'],
  'lpr.match': ['อนุญาต', 'Allowed'],
  'lpr.nomatch': ['ไม่อยู่ในรายการ', 'Not on the list'],
  'lpr.exit': ['ขาออก · เปิดอัตโนมัติ', 'Exit · auto-open'],
  'lpr.validUntil': ['สิทธิ์ถึง', 'Valid until'],

  // vehicles
  'veh.sync.synced': ['ซิงก์แล้ว', 'Synced'],
  'veh.sync.pending': ['รอซิงก์', 'Pending'],
  'veh.sync.failed': ['ล้มเหลว', 'Failed'],
  'veh.owner': ['เจ้าของ', 'Owner'],
  'veh.valid': ['ใช้ได้ถึง', 'Valid until'],
  'veh.add': ['เพิ่มรถพนักงาน', 'Add a staff car'],
  'veh.import': ['นำเข้า CSV', 'Import CSV'],
  'veh.import.done': ['นำเข้ารถตัวอย่าง {n} คันแล้ว', 'Imported {n} sample cars'],
  'veh.import.none': ['รถตัวอย่างอยู่ในรายการแล้ว ไม่มีคันใหม่', 'The sample cars are already listed: none added'],
  'veh.added': ['เพิ่มแล้ว · กำลังส่งไป ATOM', 'Added · sending to ATOM'],
  'veh.exists': ['ทะเบียนและจังหวัดนี้อยู่ในรายการแล้ว', 'This plate and province are already listed'],
  'veh.parked': ['จอดอยู่', 'Parked'],
  'veh.retry': ['ส่งใหม่', 'Retry'],
  'veh.disable': ['ปิดสิทธิ์', 'Disable'],
  'veh.enable': ['เปิดสิทธิ์', 'Enable'],
  'veh.disabled': ['ปิดสิทธิ์', 'Disabled'],

  // reports
  'rep.summary': ['สรุปประจำวัน', 'Daily summary'],
  'rep.summary.note': ['ส่งอีเมลถึงกลุ่มผู้ดูแลทุกวัน 08:00', 'Emailed to the admin group daily at 08:00'],
  'rep.yesterday': ['เมื่อวาน', 'Yesterday'],
  'rep.entries': ['รถเข้า', 'Entries'],
  'rep.exits': ['รถออก', 'Exits'],
  'rep.peak': ['สูงสุด', 'Peak'],
  'rep.requests': ['คำขอ ได้รับ / อนุมัติ / ไม่อนุมัติ', 'Requests received / approved / rejected'],
  'rep.unknown': ['รถไม่รู้จัก / เปิดด้วยตนเอง', 'Unknown cars / manual opens'],
  'rep.syncFailed': ['ทะเบียนที่ซิงก์ไม่สำเร็จ', 'Plates that failed to sync'],
  'rep.byType': ['รถเข้าแยกตามประเภท', 'Entries by type'],
  'rep.audit': ['บันทึกการตรวจสอบ', 'Audit log'],
  'rep.audit.note': ['บันทึกแบบเพิ่มอย่างเดียว · แก้ไขหรือลบไม่ได้', 'Append-only · cannot be edited or deleted'],
  'rep.csv.events': ['ดาวน์โหลดเหตุการณ์ CSV', 'Download events CSV'],
  'rep.csv.audit': ['ดาวน์โหลดบันทึก CSV', 'Download audit CSV'],

  // audit actions
  'a.login': ['เข้าสู่ระบบด้วย Keycloak', 'Signed in with Keycloak'],
  'a.approve': ['อนุมัติคำขอ', 'Approved a request'],
  'a.reject': ['ไม่อนุมัติคำขอ', 'Rejected a request'],
  'a.revoke': ['ยกเลิกสิทธิ์', 'Revoked access'],
  'a.manual': ['เปิดไม้กั้นด้วยตนเอง', 'Opened the barrier manually'],
  'a.deny': ['ไม่ให้รถไม่รู้จักเข้า', 'Denied an unknown car'],
  'a.plateAdd': ['เพิ่มทะเบียนรถ', 'Added a plate'],
  'a.plateDisable': ['ปิดสิทธิ์ทะเบียน', 'Disabled a plate'],
  'a.plateEnable': ['เปิดสิทธิ์ทะเบียน', 'Enabled a plate'],
  'a.import': ['นำเข้ารถพนักงานจาก CSV', 'Imported staff cars from CSV'],
  'a.retry': ['ส่งทะเบียนไป ATOM ใหม่', 'Retried an ATOM sync'],

  // phone / visitor
  'ph.label': ['มือถือผู้มาติดต่อ', 'Visitor’s phone'],
  'ph.hide': ['ซ่อนมือถือ', 'Hide phone'],
  'ph.show': ['มือถือผู้มาติดต่อ', 'Visitor’s phone'],
  'ph.site': ['parking.osd.example', 'parking.osd.example'],
  'ph.formTitle': ['ขอสิทธิ์จอดรถ OSD', 'Request OSD parking'],
  'ph.formIntro': ['ไม่ต้องเข้าสู่ระบบ · ใช้เวลาไม่ถึง 1 นาที', 'No sign-in needed · takes under a minute'],
  'ph.name': ['ชื่อ–นามสกุล', 'Full name'],
  'ph.photo': ['ถ่ายรูปรถเพื่อกรอกทะเบียน', 'Snap the car to fill the plate'],
  'ph.photo.reading': ['กำลังอ่านทะเบียนจากรูป…', 'Reading the plate from the photo…'],
  'ph.photo.done': ['อ่านได้ · ตรวจสอบอีกครั้ง', 'Read · please double-check'],
  'ph.facePhoto': ['รูปใบหน้า (ไม่บังคับ)', 'Face photo (optional)'],
  'ph.faceConsent': ['ยินยอมให้ใช้ใบหน้าเพื่อเข้าประตูอาคาร ลบภายใน 30 วันหลังเข้าพบ', 'I agree to use my face for building doors; deleted within 30 days after the visit'],
  'ph.consent': ['รับทราบนโยบายความเป็นส่วนตัว (PDPA)', 'I have read the privacy notice (PDPA)'],
  'ph.submit': ['ส่งคำขอ', 'Send request'],
  'ph.sentTitle': ['ส่งคำขอแล้ว', 'Request sent'],
  'ph.sentBody': ['เจ้าหน้าที่ได้รับข้อมูลแล้ว กรุณารอผลการตรวจสอบ', 'Staff have received it. Please wait for the review.'],
  'ph.sentEmail': ['เราจะแจ้งผลทางอีเมลที่ {email} และส่งสำเนาถึงผู้ติดต่อ OSD', 'We will email the result to {email}, with a copy to your OSD contact.'],
  'ph.receiptNo': ['เลขรับข้อมูล', 'Receipt number'],
  'ph.arrive': ['วันที่เข้าพื้นที่', 'Arrival date'],
  'ph.depart': ['วันที่ออกจากพื้นที่', 'Departure date'],
  'ph.mailApp': ['เมล', 'Mail'],
  'ph.ccNote': ['สำเนาถึง {contact} ไม่มี QR', 'The copy to {contact} has no QR code'],
  'ph.mail.approved': ['ยืนยันสิทธิ์จอดรถ OSD', 'Your OSD parking is confirmed'],
  'ph.mail.rejected': ['คำขอจอดรถยังไม่ได้รับอนุมัติ', 'Your parking request was not approved'],
  'ph.mail.revoked': ['สิทธิ์จอดรถถูกยกเลิก', 'Your parking access was revoked'],
  'ph.namePlaceholder': ['ชื่อ นามสกุล', 'First and last name'],
  // The revocation email's body (it showed the staff's confirm question).
  'ph.mail.revokedBody': ['สิทธิ์จอดรถสำหรับการเข้าพบนี้ถูกยกเลิกแล้ว ไม้กั้นจะไม่เปิดให้ทะเบียนนี้อีก หากยังต้องการเข้าพบ โปรดส่งคำขอใหม่', 'Parking access for this visit has been ended: the barrier will no longer open for this plate. If you still plan to visit, please send a new request.'],
  'ph.ticket': ['บัตรจอดรถ', 'Parking ticket'],
  'ph.ticket.how': ['ขับเข้าทางประตูหลัก กล้องจะอ่านทะเบียนและเปิดไม้กั้นให้อัตโนมัติ · จอดโซน P2 แถว A', 'Drive to the main gate: the camera reads your plate and opens the barrier · park in zone P2, row A'],
  'ph.ticket.qr': ['แสดง QR นี้ที่ประตูอาคาร', 'Show this QR at the building doors'],
  'ph.ticket.cal': ['parking-visit.ics · เตือนวันที่เข้าพื้นที่', 'parking-visit.ics · arrival-day reminder'],
  'ph.newRequest': ['ส่งคำขอใหม่', 'New request'],
  'ph.required': ['กรอกข้อมูลที่จำเป็นให้ครบ', 'Please fill in the required fields'],
  'ph.plateHelp': ['ตัวเลข 0–9 และอักษรไทย เช่น 7กข 4821', 'Digits 0–9 and Thai letters, e.g. 7กข 4821'],

  // story
  'story.play': ['เล่นเรื่องราว', 'Play the story'],
  'story.pause': ['หยุดชั่วคราว', 'Pause'],
  'story.resume': ['เล่นต่อ', 'Resume'],
  'story.restart': ['เริ่มใหม่', 'Restart'],
  'story.exit': ['ออกจากเรื่องราว', 'Exit story'],
  'story.autoAdvance': ['เดินเรื่องอัตโนมัติ', 'Auto-advance'],
  'story.kiosk': ['โหมดจัดแสดง', 'Kiosk mode'],
  'story.step': ['ขั้นที่ {n} / {total}', 'Step {n} / {total}'],
  'story.idle': ['เลือก “เล่นเรื่องราว” เพื่อดูการเดินทางของผู้มาติดต่อ หรือทดลองกดเองได้ทุกส่วน', 'Choose “Play the story” to follow one visitor, or try any part yourself'],
  'story.freeMode': ['ออกจากเรื่องราวแล้ว · ทดลองเองได้ทุกส่วน: แผงเจ้าหน้าที่ มือถือ หรือส่งรถไปที่ไม้กั้น', 'Story stopped · try anything: the staff console, the phone, or send cars to the barrier'],

  'story.hint.approve': ['ลองกด “อนุมัติ” ในคอนโซลเจ้าหน้าที่', 'Try “Approve” in the staff console'],
  'story.hint.alert': ['เลือก “เปิดให้เข้า” หรือ “ไม่ให้เข้า” ได้เลย', 'Choose “Open” or “Deny”'],
  'story.hint.noPass': ['ทะเบียนนี้ไม่มีสิทธิ์จอดที่ใช้ได้ ไม้กั้นจึงไม่เปิด และรถถอยออกไป', 'This plate has no valid pass: the barrier stays shut and the car backs out'],
  's1.t': ['ผู้มาติดต่อขอสิทธิ์จอดล่วงหน้า', 'A visitor asks for parking ahead of time'],
  's1.b': ['คุณชูใจจะมาประชุมที่ OSD เปิดลิงก์บนมือถือ ไม่ต้องเข้าสู่ระบบ กรอกชื่อ อีเมลของตนเองและของผู้ติดต่อใน OSD', 'Chujai is coming to a meeting at OSD. She opens the link on her phone, with no sign-in, and enters her name, her email and her OSD contact’s'],
  's2.t': ['ถ่ายรูปรถ ระบบกรอกทะเบียนให้', 'Snap the car and the plate fills itself'],
  's2.b': ['รูปถูกส่งไปอ่านทะเบียนครั้งเดียวและไม่ถูกเก็บ ใบหน้าเป็นทางเลือก และต้องยินยอมก่อนเสมอ', 'The photo is read once and never stored. A face photo is optional and needs consent'],
  's3.t': ['คำขอเด้งขึ้นที่คอนโซลเจ้าหน้าที่ทันที', 'The request appears in the staff console at once'],
  's3.b': ['เจ้าหน้าที่เห็นรายละเอียด ข้อสังเกต และผลตรวจทะเบียนใน ATOM ก่อนตัดสินใจ', 'Staff see the details, any flags and the ATOM plate lookup before deciding'],
  's4.t': ['อนุมัติด้วยการแตะครั้งเดียว', 'Approve in one tap'],
  's4.b': ['ระบบลงทะเบียนรถและบุคคลใน ATOM ตามวันที่อนุมัติ ออก QR และส่งอีเมลยืนยันพร้อมปฏิทิน', 'The car and person are registered in ATOM for the approved dates, a QR code is issued and a ticket with a calendar invite is emailed'],
  's5.t': ['บัตรจอดรถถึงมือถือ', 'The ticket lands on her phone'],
  's5.b': ['ไม่ต้องพิมพ์ ไม่ต้องแลกบัตร วันนัดแค่ขับรถมาที่ไม้กั้น', 'Nothing to print or exchange. On the day she simply drives up to the barrier'],
  's4r.t': ['คำขอนี้ไม่ได้รับอนุมัติ', 'This request was rejected'],
  's4r.b': ['ไม่มีการลงทะเบียนใน ATOM และไม่ออกสิทธิ์จอด ผู้มาติดต่อจะได้รับอีเมลแจ้งเหตุผล', 'Nothing is registered in ATOM and no pass is issued; the visitor gets an email with the reason'],
  's5v.t': ['สิทธิ์จอดถูกยกเลิก', 'The parking access was revoked'],
  's5v.b': ['ไม้กั้นจะไม่เปิดให้ทะเบียนนี้อีก ถ้าส่งบัตรจอดทางอีเมลไปแล้ว ผู้มาติดต่อจะได้รับอีเมลแจ้งยกเลิก', 'The barrier will no longer open for this plate; if the ticket was already emailed, the visitor is told by email'],
  's5r.t': ['คำขอถูกปฏิเสธ · แจ้งทางอีเมล', 'Rejected: the visitor is told by email'],
  's5r.b': ['อีเมลแจ้งเหตุผลที่เจ้าหน้าที่ระบุ และไม่มีการออกสิทธิ์จอด', 'The email gives the reason staff entered, and no pass is issued'],
  's6r.t': ['วันนัด · ไม่มีสิทธิ์ ไม้กั้นไม่เปิด', 'On the day there is no pass, so the barrier stays shut'],
  's6r.b': ['กล้องอ่านทะเบียนได้ แต่ไม่พบสิทธิ์ที่อนุมัติ รถจึงถอยออกไป และช่องทางเข้าว่างให้คันถัดไป', 'The camera reads the plate but finds no approved pass, so the car backs out and the entry is free for the next one'],
  's6.t': ['วันนัด · กล้องอ่านทะเบียนและเปิดไม้กั้นเอง', 'On the day the camera reads the plate and opens the barrier'],
  's6.b': ['ทะเบียนตรงกับสิทธิ์ที่อนุมัติ ไม้กั้นเปิดให้อัตโนมัติ และนับเข้าที่จอดทันที', 'The plate matches the approved access, so the barrier opens and the car is counted in'],
  's7.t': ['รถไม่รู้จัก · ไม้กั้นไม่เปิด แต่แจ้งเตือนทันที', 'An unknown car: the barrier stays shut and staff are alerted'],
  's7.b': ['เจ้าหน้าที่เห็นภาพจากกล้องและตัดสินใจ เปิดหรือไม่ให้เข้าได้ในแตะเดียว ทุกการเปิดต้องมีเหตุผล', 'Staff see the camera snapshot and decide, Open or Deny, in one tap. Every manual open needs a reason'],
  's8.t': ['เห็นภาพรวมลานจอดแบบสด', 'The whole car park, live'],
  's8.b': ['จำนวนรถที่จอดเทียบกับความจุ รถเข้าออกรายชั่วโมง และสิ่งที่ต้องดูแล', 'Occupancy against capacity, hourly entries and exits, and what needs attention'],
  's9.t': ['รายงานและบันทึกตรวจสอบย้อนหลังได้', 'Reports and an audit trail'],
  's9.b': ['สรุปประจำวันทางอีเมล บันทึกทุกการอนุมัติและการเปิดไม้กั้น ส่งออก CSV ได้', 'A daily summary email, every approval and manual open recorded, and CSV export'],
  's10.t': ['ขาออก · เปิดให้เสมอ', 'On the way out the barrier always opens'],
  's10.b': ['สิทธิ์หมดเวลาก็ไม่ขังรถไว้ ระบบบันทึกเวลาออกและคืนที่จอดว่าง', 'An expired pass never traps a car. The exit is logged and the space is freed'],
};

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
// Every string, for tests (each key: [thai, english]).
export const STRINGS = S;
export function t(key, vars) {
  const entry = S[key];
  if (!entry) return key;
  return fill(entry[lang === 'en' ? 1 : 0], vars);
}
// A pair given inline, for data objects that carry both languages.
export const tx = pair => (Array.isArray(pair) ? pair[lang === 'en' ? 1 : 0] : pair);
// The text in the chosen language, from its Thai and English versions.
export const L = (th, en) => (lang === 'en' ? en : th);

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Demo times are epoch ms, always shown as Bangkok wall-clock time to stay independent of the laptop's zone.
const pad = n => String(n).padStart(2, '0');
function parts(ms) {
  const d = new Date(ms + 7 * 3600e3);
  return {y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(), s: d.getUTCSeconds()};
}
export function fmtDate(ms) {
  const p = parts(ms);
  return lang === 'en' ? `${p.d} ${MONTHS_EN[p.m]} ${p.y}` : `${p.d} ${MONTHS_TH[p.m]} ${p.y + 543}`;
}
export const fmtTime = (ms, seconds = false) => { const p = parts(ms); return `${pad(p.h)}:${pad(p.min)}${seconds ? ':' + pad(p.s) : ''}`; };
export const fmtDateTime = ms => `${fmtDate(ms)} ${fmtTime(ms)}`;
export const fmtShortDate = ms => { const p = parts(ms); return lang === 'en' ? `${p.d} ${MONTHS_EN[p.m]}` : `${p.d} ${MONTHS_TH[p.m]}`; };
// Bangkok wall-clock to epoch ms.
export const bkk = (y, m, d, h = 0, min = 0, s = 0) => Date.UTC(y, m - 1, d, h - 7, min, s);
