// Behaviour checks for the demo, run by test/run.mjs. Each runs at ?speed=10 (demo timing ten times faster).
const FAST = 'debug=1&speed=10';
const parking = (extra = '') => `?dest=parking&${FAST}${extra}`;
const ready = 'window.__parking && window.__parking.active';
const VISITOR = 'ชูใจ ใฝ่รู้', STORY_PLATE = '7กข 4821';

export const scenarios = [
  {name: 'showcase loads with the parking stop', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
    expect(await p.eval('document.querySelectorAll(".destination-dock [data-destination]").length') === 6, 'dock has 6 stops');
  }},

  {name: 'story plays end to end on auto-advance', async run(p, expect) {
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    await p.until('!__parking.story.running', {timeout: 90000, what: 'story end'});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const s=__parking.sim.state;const ev=s.events.filter(e=>e.plate===${JSON.stringify(STORY_PLATE)});return {status:s.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)})?.status,entry:ev.some(e=>e.kind==='entry'),exit:ev.some(e=>e.kind==='exit'),denied:s.events.some(e=>e.kind==='denied'&&e.plate==='2ฒษ 9077')}})())`));
    expect(r.status === 'approved', `visitor request approved (got ${r.status})`);
    expect(r.entry && r.exit, 'visitor car entered and left');
    expect(r.denied, 'unknown car was denied');
  }},

  {name: 'guided story: Free play at the approve cue does not approve', async run(p, expect) {
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    for (let i = 0; i < 3; i++) { await p.until('__parking.story.waitingForNext', {timeout: 30000, what: `Next #${i + 1}`}); await p.click('[data-bar="next"]'); }
    await p.until(`document.querySelector('[data-act="approve"][data-cue="true"]')`, {timeout: 30000, what: 'approve cue'});
    await p.click('[data-bar="free"]');
    await p.sleep(300);
    const status = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)})?.status`);
    expect(status === 'pending', `request stays pending (got ${status})`);
  }},

  {name: 'staff car drives in and parks', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const before = await p.eval('__parking.sim.state.presence.size');
    await p.click('[data-tab="gate"]');
    await p.click('[data-sim="registered"]');
    await p.until(`__parking.sim.state.presence.size === ${before + 1}`, {timeout: 30000, what: 'entry recorded'});
    await p.until(`__parking.sim.state.gate === 'closed' && !__parking.traffic.busy`, {timeout: 30000, what: 'car parked, barrier down'});
    expect(await p.eval('__parking.sim.state.events[0].kind') === 'entry', 'latest event is an entry');
  }},

  {name: 'unknown car: Open once disabled while waiting; Open with a reason is audited', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until('__parking.sim.state.alerts.some(a=>a.status==="open")', {timeout: 30000, what: 'alert'});
    await p.click('[data-tab="gate"]');
    expect(await p.eval(`document.querySelector('[data-act="manual-open"]').disabled`), 'Open once disabled during the alert');
    await p.click('[data-pop="open"]');
    await p.until(`__parking.sim.state.events.some(e=>e.kind==='manual'&&e.plate==='3ฆง 6047')`, {timeout: 30000, what: 'manual entry'});
    const audit = await p.eval(`__parking.sim.state.audit.find(a=>a.key==='a.manual'&&a.target==='3ฆง 6047')?.reasonKey`);
    expect(audit === 'gate.reason.delivery', `audit has the reason (got ${audit})`);
  }},

  {name: 'reset cancels queued traffic', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until('__parking.sim.state.alerts.some(a=>a.status==="open")', {timeout: 30000});
    // Queue two known staff cars behind the waiting unknown car, then reset the world.
    const queued = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const cars=__parking.sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)).slice(0,2);for(const v of cars)void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-60});return cars.map(v=>__parking.sim.key(v.plate,v.province))})()`);
    await p.sleep(300);
    expect(await p.eval('__parking.traffic.queued') >= 2, 'cars queued behind the alert');
    await p.eval('void __parking.story.play({auto:true})'); await p.sleep(100); await p.eval('__parking.story.stop()');
    expect(await p.eval('__parking.traffic.queued') === 0, 'queue empty right after reset');
    await p.sleep(3000);
    const back = await p.eval(`${JSON.stringify(queued)}.filter(k=>__parking.sim.state.presence.has(k)||__parking.traffic.isArriving(k))`);
    expect(back.length === 0, `queued cars from before the reset never arrive (found ${back.join(', ')})`);
  }},

  {name: 'full car park turns a car away', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`__parking.sim.state.stalls.forEach((s,i)=>{if(!s.occupant)s.occupant='filler'+i})`);
    const before = await p.eval('__parking.sim.state.presence.size');
    const result = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&!inside.has(v.id));return __parking.traffic.arrive({plate:v.plate,province:v.province,color:2,fromX:-40})})()`);
    expect(result === 'full', `arrival result is full (got ${result})`);
    expect(await p.eval('__parking.sim.state.presence.size') === before, 'occupancy unchanged');
  }},

  {name: 'unknown-car dispatch skips a plate already parked', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const s=__parking.sim;s.recordEntry({plate:'4ศย 5150',province:'ปทุมธานี',type:'unknown',stallId:s.freeStall('staff').id,color:1,manual:{by:'staff.name',reason:'gate.reason.delivery'}})})()`);
    await p.click('[data-tab="gate"]');
    for (let i = 0; i < 10; i++) await p.click('[data-sim="unknown"]');
    await p.sleep(300);
    expect(await p.eval(`__parking.lot.root.children.filter(c=>c.name==='Demo_car_4ศย 5150').length`) === 0, 'parked unknown plate not sent again');
  }},

  {name: 'calendar invite is a valid all-day event', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const ics = await p.eval(`import('/src/parking/dom.js').then(m=>m.visitInvite({ref:'PK-T1',plate:'7กข 4821',province:'กรุงเทพมหานคร',arrival:Date.UTC(2026,10,24,-7),departure:Date.UTC(2026,10,25,-7)}))`);
    expect(ics.includes('DTSTART;VALUE=DATE:20261124') && ics.includes('DTEND;VALUE=DATE:20261126'), 'dates cover 24–25 Nov');
    expect(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('END:VEVENT'), 'calendar structure');
  }},

  {name: 'English switch leaves only names, plates and provinces in Thai', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('#lang-toggle');
    await p.sleep(300);
    const thai = JSON.parse(await p.eval(`JSON.stringify((()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();const el=n.parentElement;if(!/[\\u0E00-\\u0E7F]/.test(t)||!el||el.offsetParent===null||el.closest('[hidden],#legacy-controls,.pk-plate-chip,.pk-plate-big,.ph-ticket-plate,.pk-feed-plate,option,.pk-attention small,.pk-row-main,.pk-vrow small'))continue;out.add(t.slice(0,40));}return [...out]})())`));
    await p.click('#lang-toggle');
    expect(thai.length === 0, `no stray Thai UI text (found: ${thai.join(' | ')})`);
  }},

  {name: 'night: page goes dark, phone text stays dark on white', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 10000, what: 'night on'});
    await p.click('[data-bar="phone"]');
    // The page colours fade over .35 s; wait for them to settle rather than guessing a delay.
    await p.until(`getComputedStyle(document.body).backgroundColor === 'rgb(14, 21, 28)'`, {timeout: 3000, what: 'dark page background'}).catch(() => {});
    const bg = await p.eval(`getComputedStyle(document.body).backgroundColor`);
    const ink = await p.eval(`getComputedStyle(document.querySelector('.ph-field input')).color`);
    expect(bg === 'rgb(14, 21, 28)', `page background dark (got ${bg})`);
    expect(ink === 'rgb(37, 59, 67)', `phone input text dark (got ${ink})`);
    await p.click('#tour-night');
  }},

  {name: 'explore page shows the car park and a way back', async run(p, expect) {
    await p.goto(`?explore=1&${FAST}#explore`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
    expect(await p.eval(`document.querySelector('.back-link')?.getAttribute('href')`) === '#showcase', 'back link to the showcase');
  }},

  {name: 'kiosk loop runs the parking story; a touch pauses it', async run(p, expect) {
    await p.goto(`?kiosk=1&${FAST}`);
    await p.until('window.__parking && __parking.story.running', {timeout: 60000, what: 'loop reaches the parking story'});
    await p.eval(`document.querySelector('#viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.sleep(300);
    expect(!(await p.eval('__parking.story.running')), 'touch stopped the story');
  }},

  {name: 'kiosk recovers from an idle guided story', async run(p, expect) {
    await p.goto(`?kiosk=1&debug=1&speed=20`);
    await p.until('window.__parking && document.querySelector("#kiosk-toggle").checked', {timeout: 40000});
    await p.eval(`document.querySelector('#viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.click('[data-destination="parking"]');
    await p.until('__parking.active', {timeout: 30000});
    await p.eval(`(()=>{const c=document.querySelector('[data-bar="auto"]');if(c.checked)c.click()})()`);
    await p.click('[data-bar="play"]');
    await p.until('__parking.story.waitingForNext', {timeout: 30000, what: 'guided story waiting'});
    await p.until(`document.body.dataset.tourDestination !== 'parking' || (__parking.story.running && __parking.story.auto)`, {timeout: 20000, what: 'loop takes over (60 s / speed)'});
    expect(true, 'loop resumed');
  }},
];
