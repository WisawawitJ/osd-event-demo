// Behaviour checks for the demo, run by test/run.mjs. Pages load with ?speed=SPEED (default 30: demo timing 30× faster).
const SPEED = Number(process.env.SPEED) || 30;
// FAST skips the loading screen's shader warm-up; FASTW keeps it, for checks that wait for it or measure smoothness.
const FASTW = `debug=1&speed=${SPEED}`;
const FAST = `${FASTW}&warm=0`;
const parking = (extra = '') => `?dest=parking&${FAST}${extra}`;
const ready = 'window.__parking && window.__parking.active';
// The showcase is up (any stop).
const UP = "document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking";
const VISITOR = 'ชูใจ ใฝ่รู้', STORY_PLATE = '7กข 4821';

export const scenarios = [
  {quick: true, name: 'showcase loads with the parking stop', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
    expect(await p.eval('document.querySelectorAll(".destination-dock [data-destination]").length') === 6, 'dock has 6 stops');
  }},

  {quick: true, name: 'story plays end to end on auto-advance', async run(p, expect) {
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

  {quick: true, name: 'staff car drives in and parks', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // A specific car, so background traffic in the same lot cannot be mistaken for it.
    const key = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province)));void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-50});return __parking.sim.key(v.plate,v.province)})()`);
    await p.until(`__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 30000, what: 'entry recorded'});
    await p.until(`!__parking.traffic.isArriving(${JSON.stringify(key)})`, {timeout: 30000, what: 'car parked'});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const pr=__parking.sim.state.presence.get(${JSON.stringify(key)});return {entry:__parking.sim.state.events.some(e=>e.kind==='entry'&&__parking.sim.key(e.plate,e.province)===${JSON.stringify(key)}),stall:__parking.sim.state.stalls.find(s=>s.id===pr.stallId)?.occupant===${JSON.stringify(key)}}})())`));
    expect(r.entry, 'entry event logged for the car');
    expect(r.stall, 'its bay is marked occupied');
  }},

  {quick: true, name: 'unknown car: Open once disabled while waiting; Open with a reason is audited', async run(p, expect) {
    // speed 10: the guard turns unanswered cars away after 45 s of demo time, 1.5 s of real time at speed 30.
    await p.goto('?dest=parking&debug=1&speed=10');
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='3ฆง 6047')`, {timeout: 30000, what: 'alert'});
    await p.click('[data-tab="gate"]');
    expect(await p.eval(`document.querySelector('[data-act="manual-open"]').disabled`), 'Open once disabled during the alert');
    // This car's own alert card (a background unknown car may have one too).
    await p.click(`[data-alert-open="${await p.eval(`__parking.sim.state.alerts.find(a=>a.status==='open'&&a.plate==='3ฆง 6047').id`)}"]`);
    await p.until(`__parking.sim.state.events.some(e=>e.kind==='manual'&&e.plate==='3ฆง 6047')`, {timeout: 30000, what: 'manual entry'});
    const audit = await p.eval(`__parking.sim.state.audit.find(a=>a.key==='a.manual'&&a.target==='3ฆง 6047')?.reasonKey`);
    expect(audit === 'gate.reason.delivery', `audit has the reason (got ${audit})`);
  }},

  {name: 'a later arrival never blocks the spawn point of an earlier one still waiting for a gap', async run(p, expect) {
    await p.goto('?dest=parking&debug=1&speed=10');
    await p.until(ready, {timeout: 40000});
    // An eastbound through car just short of x=-40: car A (spawning at -40) waits for it to pass; car B, arriving
    // next from -60, gets its gap first. B used to appear first, drive to the queue point at -33 (on A's spawn
    // point) and wait there for A, which waited for B to move.
    await p.until(`(__parking.traffic.passBy(1), !!(window.__thru = __parking.lot.root.children.find(c => c.name === 'Demo_car_' && c.visible && Math.abs(c.position.z - 24.5) < .3 && c.position.x < -60)))`, {timeout: 20000, what: 'an eastbound through car'});
    await p.until(`__thru.position.x > -48`, {timeout: 20000, what: 'the through car near x=-40'});
    await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const [a,b]=__parking.sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province)));
      const before=new Set(__parking.lot.root.children);void __parking.traffic.arrive({plate:a.plate,province:a.province,color:a.color,fromX:-40});const ca=__parking.lot.root.children.find(c=>!before.has(c));
      void __parking.traffic.arrive({plate:b.plate,province:b.province,color:b.color,fromX:-60});window.__pair=[ca,__parking.lot.root.children.find(c=>!before.has(c)&&c!==ca)]})()`);
    await p.until(`__pair.every(c=>c.visible&&c.position.z<15)`, {timeout: 30000, what: 'both cars through the gate (hidden cars have not appeared yet)'});
    expect(true, 'both arrivals reached the car park');
  }},
  {name: 'reset cancels queued traffic', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until('__parking.sim.state.alerts.some(a=>a.status==="open")', {timeout: 30000});
    // Queue two staff cars behind the waiting unknown car and keep hold of their 3D objects; then reset the world.
    // (Checking plates would be unreliable: background traffic may legitimately pick the same car again after the reset.)
    await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const cars=__parking.sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)).slice(0,2);const before=new Set(__parking.lot.root.children);for(const v of cars)void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-60});window.__queuedCars=__parking.lot.root.children.filter(c=>!before.has(c))})()`);
    await p.sleep(300);
    expect(await p.eval('__parking.traffic.queued') >= 2, 'cars queued behind the alert');
    expect(await p.eval('window.__queuedCars.length') === 2, 'both queued cars exist before the reset');
    // story.play resets the world synchronously; read the queue in the same call, before any new traffic can start.
    const afterReset = await p.eval('(()=>{void __parking.story.play({auto:true});const q=__parking.traffic.queued;__parking.story.stop();return q})()');
    expect(afterReset === 0, `queue empty right after reset (got ${afterReset})`);
    await p.sleep(1500);
    expect(await p.eval('window.__queuedCars.every(c=>!c.parent)'), 'cars queued before the reset are gone and never drive in');
  }},

  {quick: true, name: 'full car park turns a car away', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Keep every bay taken: a background car leaving during the check would otherwise free one for our car.
    await p.eval(`(()=>{const fill=()=>__parking.sim.state.stalls.forEach((s,i)=>{if(!s.occupant)s.occupant='filler'+i});fill();__parking.sim.subscribe(fill)})()`);
    // Follow the one car: background cars may still leave during the check, so the total can change.
    const key = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&!inside.has(v.id));window.__fullCar=v;return __parking.sim.key(v.plate,v.province)})()`);
    const result = await p.eval(`__parking.traffic.arrive({plate:__fullCar.plate,province:__fullCar.province,color:2,fromX:-40})`);
    expect(result === 'full', `arrival result is full (got ${result})`);
    expect(!(await p.eval(`__parking.sim.state.presence.has(${JSON.stringify(key)})`)), 'the car was not recorded as parked');
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

  {name: 'calendar invite is an arrival-day reminder', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const ics = await p.eval(`import('/src/parking/dom.js').then(m=>m.visitInvite({ref:'PK-T1',plate:'7กข 4821',province:'กรุงเทพมหานคร',arrival:Date.UTC(2026,10,24,-7),departure:Date.UTC(2026,10,25,-7)}))`);
    // As in the real app: a reminder for the arrival date only, even for a two-day visit.
    expect(ics.includes('DTSTART;VALUE=DATE:20261124') && ics.includes('DTEND;VALUE=DATE:20261125'), 'all-day reminder on the arrival date (24 Nov) only');
    expect(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('END:VEVENT'), 'calendar structure');
  }},

  {quick: true, name: 'English switch leaves only names, plates and provinces in Thai', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('#lang-toggle');
    await p.sleep(300);
    const thai = JSON.parse(await p.eval(`JSON.stringify((()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();const el=n.parentElement;if(!/[\\u0E00-\\u0E7F]/.test(t)||!el||el.offsetParent===null||el.closest('[hidden],#legacy-controls,.pk-plate-chip,.pk-plate-big,.ph-ticket-plate,.pk-feed-plate,option,.pk-attention small,.pk-row-main,.pk-vrow small'))continue;out.add(t.slice(0,40));}return [...out]})())`));
    await p.click('#lang-toggle');
    expect(thai.length === 0, `no stray Thai UI text (found: ${thai.join(' | ')})`);
  }},

  {quick: true, name: 'night: page goes dark, phone text stays dark on white', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.until(`!document.querySelector('#tour-night').disabled`, {what: 'night switch enabled'}); // off during the opening flight
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 10000, what: 'night on'});
    await p.click('[data-bar="phone"]');
    // The page colours fade over .35 s; wait for them to settle rather than guessing a delay.
    // Compare the colour, not the alpha: the fade may still be finishing under load.
    await p.until(`/^rgba?\\(14, 21, 28/.test(getComputedStyle(document.body).backgroundColor)`, {timeout: 8000, what: 'dark page background'});
    const bg = await p.eval(`getComputedStyle(document.body).backgroundColor`);
    const ink = await p.eval(`getComputedStyle(document.querySelector('.ph-field input')).color`);
    expect(/^rgba?\(14, 21, 28/.test(bg), `page background dark (got ${bg})`);
    expect(ink === 'rgb(37, 59, 67)', `phone input text dark (got ${ink})`);
    await p.click('#tour-night');
  }},

  {name: 'explore page shows the car park and a way back', async run(p, expect) {
    await p.goto(`?explore=1&${FAST}#explore`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
    expect(await p.eval(`document.querySelector('.back-link')?.getAttribute('href')`) === '#showcase', 'back link to the showcase');
    expect(await p.eval(`!document.querySelector('a[download]')`), 'no model download link (the demo runs locally)');
  }},

  {name: 'explore page follows the English choice', async run(p, expect) {
    await p.goto(`?explore=1&${FAST}#explore`);
    await p.eval(`localStorage.setItem('osd-demo-language','en')`);
    try {
      await p.eval('location.reload()');
      await p.sleep(300);
      await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
      await p.eval(`document.querySelector('.simulation-details').open=true`);
      // Every visible text, the room list included, is English (the device map's Thai room names are translated).
      const thai = await p.eval(`(()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim(),el=n.parentElement;if(/[\u0E00-\u0E7F]/.test(t)&&el&&(el.offsetParent!==null||el.tagName==='OPTION'))out.add(t.slice(0,40));}
        for(const el of document.querySelectorAll('[aria-label]'))if(/[\u0E00-\u0E7F]/.test(el.getAttribute('aria-label')))out.add('aria: '+el.getAttribute('aria-label').slice(0,40));return [...out].join(' | ')})()`);
      expect(!thai, `no Thai on the English explore page (found: ${thai})`);
    } finally { await p.eval(`localStorage.setItem('osd-demo-language','th')`); }
  }},

  {name: 'static building still moves where it should: exploded floors and swinging door leaves', async run(p, expect) {
    // The building's matrices are composed once at load (main.js); floors and door hinges must still move on screen.
    await p.goto(`?explore=1&${FAST}#explore`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready'", {timeout: 40000, what: 'model ready'});
    const floorY = `(()=>{let m;__scene.getObjectByName('Floor_3').traverse(o=>{if(!m&&o.isMesh)m=o});return m.matrixWorld.elements[13]})()`;
    const y0 = await p.eval(floorY);
    await p.click('#explode'); await p.sleep(300);
    const y1 = await p.eval(floorY);
    expect(Math.abs(y1 - y0 - 5) < .01, `floor 3 drawn 5 m higher when exploded (moved ${(y1 - y0).toFixed(2)} m)`);
    await p.click('#explode'); await p.sleep(300);
    const leaf = `(()=>{let l;__scene.traverse(o=>{if(!l&&o.isMesh&&o.parent?.userData.doorId)l=o});return l.matrixWorld.elements.slice(0,3).map(v=>v.toFixed(3)).join()})()`;
    const before = await p.eval(leaf);
    await p.eval(`(()=>{let h;__scene.traverse(o=>{if(!h&&o.isMesh&&o.parent?.userData.doorId)h=o.parent});h.rotation.y+=1;__controls.dispatchEvent({type:'change'})})()`); // ask for a frame: nothing else may be drawing
    await p.sleep(300);
    expect(await p.eval(leaf) !== before, 'a door leaf turns with its hinge');
  }},

  {name: 'approval follow-ups (ATOM sync, ticket email) are dropped after a revoke or a reset', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const due = 1600 / SPEED + 400; // the follow-ups come ~1.6 s of demo time after the approval
    const kinds = await p.eval(`(async()=>{const s=__parking.sim,q=s.state.requests.find(q=>q.status==='pending');s.approve(q.id);s.revoke(q.id);
      await new Promise(r=>setTimeout(r,${due}));return s.state.emails.filter(m=>m.requestId===q.id).map(m=>m.kind).join()})()`);
    expect(kinds === 'revoked', `a revoked request gets only the revoke email (${kinds})`);
    const late = await p.eval(`(()=>{const q=__parking.sim.state.requests.find(q=>q.status==='revoked');return q.history.map(h=>h.key).join()+' | listed: '+__parking.sim.state.vehicles.some(v=>v.requestId===q.id)})()`);
    expect(!late.includes('h.atom') && late.endsWith('listed: false'), `no ATOM confirmation after the revoke, plate withdrawn (${late})`);
    await p.eval(`(()=>{const s=__parking.sim;s.reset();const q=s.state.requests.find(q=>q.status==='pending');s.approve(q.id);s.reset()})()`);
    await p.sleep(due);
    expect(await p.eval('__parking.sim.state.emails.length') === 0, `no email from before the reset (${await p.eval('__parking.sim.state.emails.length')})`);
  }},

  {name: 'story started during a free-play photo read submits the story plate', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-bar="phone"]');
    await p.click('[data-ph="photo"]'); // free play: reads a sample plate after ~1.5 s
    await p.click('[data-bar="play"]');
    await p.until(`__parking.sim.state.requests.some(q=>q.visitor.name===${JSON.stringify(VISITOR)})`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)}).plate`);
    expect(plate === STORY_PLATE, `story request has the story plate (${plate})`);
  }},

  {name: 'the room-colour bar shows at the meeting room and the pond only', async run(p, expect) {
    await p.goto(`?${FASTW}`);
    await p.until(`document.documentElement.dataset.warm==='done'`, {timeout: 40000, what: 'warm-up done'});
    const shown = () => p.eval(`(()=>{const b=document.querySelector('.insight-toolbar');return !b.hidden&&b.getBoundingClientRect().height>0})()`);
    // Record any moment the bar shows while the camera is still flying (the panel is inert then): it must wait to land.
    await p.eval(`(()=>{window.__barInFlight=false;const bar=document.querySelector('.insight-toolbar'),panel=document.querySelector('#dashboard-content');
      new MutationObserver(()=>{if(!bar.hidden&&panel.inert)window.__barInFlight=true;}).observe(bar,{attributes:true,attributeFilter:['hidden']})})()`);
    const seen = {};
    for (const stop of ['overview', 'meeting', 'parking', 'pond']) { // ends at the pond for the colour check
      await p.click(`[data-destination="${stop}"]`);
      await p.sleep(3500 / SPEED + 300);
      seen[stop] = await shown();
    }
    expect(seen.meeting && seen.pond && !seen.overview && !seen.parking, `bar visible per stop ${JSON.stringify(seen)}`);
    expect(!(await p.eval('window.__barInFlight')), 'bar hidden until the camera lands');
    await p.click('[data-layer="temperature"]'); await p.sleep(200);
    expect(await p.eval(`__scene.getObjectByName('Floor_1').getObjectsByProperty('visible',true).some(o=>o.name.startsWith('Insight_floor_'))`), 'pond rooms coloured');
    await p.click('[data-layer="none"]');
    // Reset view flies the camera too: the bar must not be clickable on the way.
    await p.eval(`(()=>{window.__barInReset=null;const v=document.querySelector('#viewport'),bar=document.querySelector('.insight-toolbar');
      new MutationObserver(()=>{if(v.classList.contains('flying'))window.__barInReset=getComputedStyle(bar).visibility;}).observe(v,{attributes:true,attributeFilter:['class']})})()`);
    await p.click('#view-zoom-out'); await p.sleep(400);
    await p.click('#view-reset');
    await p.until('window.__barInReset!==null', {timeout: 5000, what: 'reset flight'});
    expect(await p.eval('window.__barInReset') === 'hidden', `bar hidden during the Reset view flight (${await p.eval('window.__barInReset')})`);
  }},

  {name: 'a photo tap early in the story (step 1) does not change the story plate', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-bar="play"]');
    await p.until(`!!document.querySelector('[data-ph="photo"]')`, {timeout: 20000, what: 'phone form open'});
    await p.click('[data-ph="photo"]'); // free play: fills the sample plate while the story is still typing
    await p.until(`__parking.sim.state.requests.some(q=>q.visitor.name===${JSON.stringify(VISITOR)})`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)}).plate`);
    expect(plate === STORY_PLATE, `story request has the story plate (${plate})`);
  }},

  {name: 'tapping the cued photo button in the story still reads the story plate', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // The presenter taps the photo button the moment the story cues it (before the story starts its own read).
    // Also watch the phone's car photo: the free-play sample plate must never show in it, not even briefly.
    await p.eval(`(()=>{window.__flash=false;const o=new MutationObserver(()=>{if(document.querySelector('.ph-photo')?.textContent.includes('6กม'))window.__flash=true;
      const b=!window.__tapped&&document.querySelector('[data-ph="photo"][data-cue="true"]');if(b){window.__tapped=true;b.click();}});o.observe(document.body,{subtree:true,childList:true,attributes:true})})()`);
    await p.click('[data-bar="play"]');
    await p.until('window.__tapped', {timeout: 40000, what: 'photo cue tapped'});
    await p.until(`__parking.sim.state.requests.some(q=>q.visitor.name===${JSON.stringify(VISITOR)})`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)}).plate`);
    expect(plate === STORY_PLATE, `story request has the story plate (${plate})`);
    expect(!(await p.eval('window.__flash')), 'the free-play sample plate never flashed in the phone photo');
  }},

  {name: 'pressing the phone photo button during the story read does not stall the story', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Press the photo button the moment the story's read starts (it lasts 1.5 s of demo time).
    await p.eval(`(()=>{const o=new MutationObserver(()=>{if(document.querySelector('.ph-photo-state.reading')){o.disconnect();window.__pressed=true;document.querySelector('[data-ph="photo"]').click();}});o.observe(document.body,{subtree:true,childList:true})})()`);
    await p.click('[data-bar="play"]');
    await p.until('window.__pressed', {timeout: 40000, what: 'photo pressed during the story read'});
    await p.until(`__parking.sim.state.requests.some(q=>q.visitor.name===${JSON.stringify(VISITOR)})`, {timeout: 40000, what: 'story went on and submitted its request'});
    const plate = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)}).plate`);
    expect(plate === STORY_PLATE, `story request keeps the story plate (${plate})`);
  }},

  {name: 'leaving the story during its photo read keeps what the visitor types next', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Leave the story the moment its photo read starts, then type a plate of our own.
    await p.eval(`(()=>{const o=new MutationObserver(()=>{if(document.querySelector('.ph-photo-state.reading')){o.disconnect();document.querySelector('[data-bar="free"]').click();window.__left=true;}});o.observe(document.body,{subtree:true,childList:true})})()`);
    await p.click('[data-bar="play"]');
    await p.until('window.__left', {timeout: 40000, what: 'story left during its photo read'});
    await p.eval(`(()=>{const i=document.querySelector('input[name="plate"]');i.value='9ขข 1234';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await p.sleep(1500 / SPEED + 500);
    const plate = await p.eval(`document.querySelector('input[name="plate"]').value`);
    expect(plate === '9ขข 1234', `typed plate kept after the cancelled read (${plate})`);
    expect(await p.eval(`!document.querySelector('.ph-photo-state.reading')`), 'no "reading plate" left on the phone');
    // Free play: a photo read survives an Auto-advance toggle (only a stopping story cancels reads).
    await p.click('[data-ph="photo"]');
    await p.eval(`document.querySelector('[data-bar="auto"]').click()`);
    await p.until(`!!document.querySelector('.ph-photo-state.done')`, {timeout: 5000, what: 'free-play read finished'});
  }},

  {name: 'Free play at the photo cue leaves the photo button working', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const o=new MutationObserver(()=>{if(document.querySelector('[data-ph="photo"][data-cue="true"]')){o.disconnect();document.querySelector('[data-bar="free"]').click();window.__left=true;}});o.observe(document.body,{subtree:true,childList:true,attributes:true})})()`);
    await p.click('[data-bar="play"]');
    await p.until('window.__left', {timeout: 40000, what: 'story left at the photo cue'});
    expect(await p.eval(`!document.querySelector('[data-ph="photo"][data-cue="true"]')`), 'photo button no longer highlighted');
    await p.click('[data-ph="photo"]');
    await p.until(`!!document.querySelector('.ph-photo-state')`, {timeout: 5000, what: 'free-play photo read after leaving the story'});
    expect(true, 'photo tap reads a plate in free play');
  }},
  {name: 'typing during the tour\'s photo read keeps every keystroke', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000});
    // The first keystroke lands the moment the story's read starts (the read lasts only 50 ms at test speed) and ends
    // the tour and its story; the second is typed after it.
    await p.eval(`(()=>{const o=new MutationObserver(()=>{if(document.querySelector('.ph-photo-state.reading')){o.disconnect();const i=document.querySelector('input[name="plate"]');i.focus();i.value='9';i.setSelectionRange(1,1);i.dispatchEvent(new Event('input',{bubbles:true}));window.__typed=true;}});o.observe(document.body,{subtree:true,childList:true})})()`);
    await p.click('#tour-play');
    await p.until('window.__typed', {timeout: 60000, what: 'a keystroke during the story photo read in the tour'});
    await p.cdp('Input.insertText', {text: '8'});
    await p.sleep(1500 / SPEED + 500);
    const r = JSON.parse(await p.eval(`JSON.stringify({value:document.querySelector('input[name="plate"]').value,story:__parking.story.running})`));
    expect(!r.story, 'typing ended the story');
    expect(r.value === '98', `both keystrokes kept in the plate field (${JSON.stringify(r.value)})`);
  }},
  {name: 'New request during a photo read starts a fresh read', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // A complete form is sent while its photo is still being read; the next request's photo must be its own read.
    await p.click('[data-bar="phone"]');
    await p.eval(`(()=>{const set=(n,v)=>{const e=document.querySelector('#pk-phone [name="'+n+'"]');if(e.type==='checkbox')e.checked=v;else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
      for(const [n,v] of Object.entries({name:'ทดสอบ หนึ่ง',email:'one@example.com',contact:'สมศรี',phone:'0800000000',plate:'1ขค 2345',province:'กรุงเทพมหานคร',consent:true}))set(n,v)})()`);
    // All in one page task: at test speed a read lasts only 50 ms, which a round trip per tap could outlast.
    const reading = await p.eval(`(()=>{const tap=s=>document.querySelector('#pk-phone [data-ph="'+s+'"]').click();tap('photo');tap('submit');tap('new');tap('photo');return !!document.querySelector('.ph-photo-state.reading')})()`);
    expect(reading, 'the new form shows its own "reading plate"');
    await p.until(`!!document.querySelector('.ph-photo-state.done')`, {timeout: 5000, what: 'new photo read done'});
    expect(await p.eval(`document.querySelector('#pk-phone [name="plate"]').value === '6กม 3195'`), 'the new read fills the new form');
  }},
  {name: 'room-colour bar waits for a real landing (also after R); narrow views keep the title beside it', async run(p, expect) {
    await p.cdp('Emulation.setDeviceMetricsOverride', {width: 760, height: 900, deviceScaleFactor: 1, mobile: false});
    try {
      // Real speed: the final approach then lasts ~1.5 s, so the drag below reliably lands inside it.
      await p.goto('?debug=1');
      await p.until(`document.documentElement.dataset.warm==='done'`, {timeout: 40000, what: 'warm-up done'});
      // A drag during the final approach (the stop already switched) stops the camera short: no bar until it lands.
      await p.eval(`(()=>{const o=new MutationObserver(()=>{if(document.body.dataset.tourDestination==='meeting'){o.disconnect();__controls.dispatchEvent({type:'start'});__controls.dispatchEvent({type:'end'});window.__dragged=true;}});o.observe(document.body,{attributes:true,attributeFilter:['data-tour-destination']})})()`);
      await p.click('[data-destination="meeting"]');
      await p.until('window.__dragged', {timeout: 10000, what: 'drag during the approach'});
      await p.sleep(500);
      expect(await p.eval(`document.querySelector('.insight-toolbar').hidden`), 'bar hidden after the flight was cut short');
      // Reset view lands on the stop: the bar shows; during that flight the (narrow) view keeps its title.
      await p.eval(`(()=>{window.__titleInReset=null;const v=document.querySelector('#viewport'),t=document.querySelector('.scene-title');
        new MutationObserver(()=>{if(v.classList.contains('flying'))window.__titleInReset=getComputedStyle(t).display;}).observe(v,{attributes:true,attributeFilter:['class']})})()`);
      await p.click('#view-reset');
      await p.until(`!document.querySelector('.insight-toolbar').hidden`, {timeout: 10000, what: 'bar after Reset view lands'});
      // Landed with the bar showing: the title stays too, beside the bar's column rather than hidden or under it.
      const side = JSON.parse(await p.eval(`JSON.stringify((()=>{const t=document.querySelector('.scene-title'),a=t.getBoundingClientRect(),b=document.querySelector('.scene-top-right').getBoundingClientRect();return {shown:getComputedStyle(t).display!=='none'&&a.width>0,overlap:!(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)}})())`));
      expect(side.shown && !side.overlap, `title shown beside the room-colour bar (${JSON.stringify(side)})`);
      expect(await p.eval('window.__titleInReset') !== 'none', `title shown during the Reset view flight (${await p.eval('window.__titleInReset')})`);
      // A Reset view cut short by a drag leaves the camera short of the stop: the bar stays hidden.
      await p.click('#view-zoom-out'); await p.sleep(400);
      await p.eval(`(()=>{const v=document.querySelector('#viewport'),o=new MutationObserver(()=>{if(v.classList.contains('flying')){o.disconnect();setTimeout(()=>{__controls.dispatchEvent({type:'start'});__controls.dispatchEvent({type:'end'});window.__resetCut=true;},300);}});o.observe(v,{attributes:true,attributeFilter:['class']})})()`);
      await p.click('#view-reset');
      await p.until('window.__resetCut', {timeout: 5000, what: 'drag during Reset view'});
      await p.sleep(500);
      expect(await p.eval(`document.querySelector('.insight-toolbar').hidden`), 'bar hidden after Reset view was cut short');
      // The R key on the 3D view is Reset view too: it lands, the bar comes back.
      await p.eval(`__renderer.domElement.dispatchEvent(new KeyboardEvent('keydown',{key:'r',bubbles:true}))`);
      await p.until(`!document.querySelector('.insight-toolbar').hidden`, {timeout: 10000, what: 'bar after R (Reset view) lands'});
    } finally { await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); }
  }},

  {name: 'koi swim (in the shader, inside the water) and stand still when paused', async run(p, expect) {
    await p.goto(`?dest=pond&${FASTW}`);
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='pond'`, {timeout: 40000});
    const loops = JSON.parse(await p.eval(`JSON.stringify(['Floor_1_koi_ochre','Floor_1_koi_cream'].map(n=>{const a=__scene.getObjectByName(n).geometry.attributes.koiLoop;const r=[];for(let i=0;i<a.count;i+=52)r.push(a.getX(i));return r}).flat())`));
    expect(loops.length === 22 && loops.filter(r => r > 0).length >= 15, `fish with room to swim a loop: ${loops.filter(r => r > 0).length} of ${loops.length}`);
    const a = await p.eval('__koi.time'); await p.sleep(400); const b = await p.eval('__koi.time');
    expect(b > a, 'the fish move');
    await p.eval('__world.setPaused(true)');
    await p.sleep(200);
    const c = await p.eval('__koi.time'); await p.sleep(400); const d = await p.eval('__koi.time');
    expect(c === d, 'paused: the fish stand still');
    await p.eval('__world.setPaused(false)');
  }},
  {name: 'pond reflection: plain water flying in (never a stale, dark mirror), fading out and back in, never snapping', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    const idle = `!document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    // Read each time the pond is actually drawn (the mirror sets the value just before; when the pond is off screen it
    // is not drawn and the value is not used), with whether the camera was flying. The water's material may be a cut
    // copy mid-flight: it must still show the mirror's picture (a copy that lost it drew the pond black).
    await p.eval(`(()=>{window.__mixes=[];window.__blind=0;const w=__scene.getObjectByName('Courtyard_water_reflection'),before=w.onBeforeRender;w.onBeforeRender=function(...a){before.apply(this,a);const u=this.material.uniforms;if(u.reflectionMix.value>0&&!u.tDiffuse.value)__blind++;__mixes.push([document.querySelector('#viewport').classList.contains('flying'),u.reflectionMix.value]);};})()`);
    await p.click('[data-destination="pond"]');
    await p.until(`document.body.dataset.tourDestination==='pond' && ${idle}`, {timeout: 20000, what: 'landed at the pond'});
    await p.sleep(400);
    const flyingIn = (await p.eval('__mixes')).filter(([flying]) => flying).map(([, v]) => v);
    expect(flyingIn.length && flyingIn.every(v => v === 0), `flying in, the pond shows plain water (mix ${[...new Set(flyingIn)].join(', ')})`);
    const landing = (await p.eval('__mixes')).filter(([flying]) => !flying).map(([, v]) => v);
    expect(landing.at(-1) === 1 && landing.some(v => v > 0 && v < 1), `landed: the reflection fades back in (mix ${landing.slice(0, 6).map(v => v.toFixed(2)).join(', ')} … ${landing.at(-1)})`);
    await p.eval('__mixes.length=0');
    await p.click('[data-destination="overview"]');
    await p.until(`document.body.dataset.tourDestination==='overview' && ${idle}`, {timeout: 20000, what: 'landed at the overview'});
    const leaving = (await p.eval('__mixes')).filter(([flying]) => flying).map(([, v]) => v);
    expect(leaving.length > 1 && leaving[0] > .5 && leaving.every((v, i) => !i || v <= leaving[i - 1]), `leaving, the reflection fades out (mix ${leaving.slice(0, 8).map(v => v.toFixed(2)).join(', ')})`);
    expect(await p.eval('__blind') === 0, `the water always had the mirror's picture while showing it (${await p.eval('__blind')} draws without)`);
  }},
  {name: 'flying between stops: one continuous move that speeds up and slows down once, the car park included', async run(p, expect) {
    await p.goto('?debug=1');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // The camera's speed on every frame of each flight. The old route (back out to the overview, turn, then in) came
    // to a near standstill between its legs; a curve run at its own uneven pace crept, then rushed, or lurched halfway.
    // One flight's speed rises to a single peak and falls from it (frame-to-frame jitter of a few % aside).
    for (const [from, to] of [['overview', 'parking'], ['parking', 'meeting'], ['meeting', 'pond'], ['pond', 'parking'], ['parking', 'energy']]) {
      // Each camera move with the time of the frame it was made for (the flight places the camera by that time):
      // sampled on a separate frame callback instead, a late frame could pair one frame's move with another's time.
      await p.eval(`(()=>{window.__speeds=[];const c=__controls.object,last={p:c.position.clone(),t:null};__controls.removeEventListener('change',window.__onMove||(()=>{}));
        window.__onMove=()=>{const t=document.timeline.currentTime;if(last.t!==null&&t>last.t)__speeds.push([c.position.distanceTo(last.p),t-last.t]);if(last.t===null||t>last.t){last.p.copy(c.position);last.t=t;}};
        __controls.addEventListener('change',__onMove);})()`);
      await p.click(`[data-destination="${to}"]`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      await p.eval(`__controls.removeEventListener('change',__onMove)`);
      const raw = await p.eval('__speeds'), steps = raw.slice(raw.findIndex(([d]) => d > 0)), speeds = steps.map(([d, dt]) => d / dt);
      // Distance over time across three frames: around a frame drawn late, one sample can catch the camera half a step
      // behind and the next a step and a half ahead, which is not a change of pace.
      const smooth = steps.map((_, i) => { const w = steps.slice(Math.max(0, i - 1), i + 2); return w.reduce((n, [d]) => n + d, 0) / w.reduce((n, [, dt]) => n + dt, 0); });
      const top = Math.max(...smooth), peak = smooth.indexOf(top);
      // How far the speed sank below its best so far on the way up, and rose above its lowest since the peak on the way down.
      let dip = 0, bump = 0, high = 0, low = top;
      smooth.forEach((v, i) => { if (i <= peak) { high = Math.max(high, v); dip = Math.max(dip, high - v); } else { low = Math.min(low, v); bump = Math.max(bump, v - low); } });
      expect(speeds.length > 10, `${from} → ${to}: frames sampled (${speeds.length})`);
      expect(dip < top * .08 && bump < top * .08, `${from} → ${to}: one rise and one fall (largest dip on the way up ${(dip / top * 100).toFixed(0)}%, rise on the way down ${(bump / top * 100).toFixed(0)}% of top speed)`);
    }
  }},
  {name: 'car park layout: a second stop picked during the layout change still ends in the right layout', async run(p, expect) {
    await p.goto('?debug=1');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    for (const [first, second, parked] of [['parking', 'energy', false], ['pond', 'parking', true]]) {
      await p.eval(`document.querySelector('[data-destination="${first}"]').click()`); await p.sleep(120);
      await p.eval(`document.querySelector('[data-destination="${second}"]').click()`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${second}'`, {timeout: 20000, what: `landed at ${second}`});
      await p.sleep(900); // any layout change still queued has run
      expect(await p.eval(`document.body.classList.contains('parking-active')`) === parked, `${first} then ${second}: the ${parked ? 'car park' : 'building'} layout`);
    }
  }},
  {name: 'no shader is built mid-flight, by day or night: the loading screen prepared them all', async run(p, expect) {
    // A shader built on the spot froze the view mid-flight: 30 ms for the first cut copies of the building's materials,
    // 0.1–0.2 s at night when hiding a floor (its room lights) changed the
    // number of lights.
    for (const time of ['10:00', '20:30']) {
      await p.goto(`?debug=1&time=${time}`);
      const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
      await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
      const before = await p.eval('__renderer.info.programs.length');
      for (const to of ['parking', 'meeting', 'pond', 'energy', 'access', 'overview']) {
        await p.click(`[data-destination="${to}"]`);
        await p.until(`${idle} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      }
      const built = await p.eval(`__renderer.info.programs.slice(${before}).map(x=>x.name)`);
      expect(!built.length, `${time}: no shader built during the flights (${built.join(', ') || 'none'})`);
    }
  }},
  {name: 'idle orbit: scrolling the panel leaves it turning; a wheel on the 3D view stops it', async run(p, expect) {
    await p.goto('?debug=1&dest=energy');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='energy' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the energy stop'});
    const pos = () => p.eval('__controls.object.position.toArray()');
    const turning = async () => { const a = await pos(); await p.sleep(400); const b = await pos(); return Math.hypot(...a.map((v, i) => v - b[i])) > 1e-3; };
    const startIdle = async () => { await p.eval('__idleNow()'); await p.until(`(()=>{const k=__controls.object.position.toArray().join();const r=window.__k!==undefined&&window.__k!==k;window.__k=k;return r;})()`, {timeout: 5000, what: 'idle orbit turning'}); await p.eval('window.__k=undefined'); };
    const box = async sel => JSON.parse(await p.eval(`JSON.stringify(document.querySelector('${sel}').getBoundingClientRect())`));
    const panel = await box('.context-panel'), view = await box('#viewport');
    await startIdle();
    await p.cdp('Input.dispatchMouseEvent', {type: 'mouseWheel', x: panel.x + panel.width / 2, y: panel.y + 200, deltaX: 0, deltaY: 200});
    await p.cdp('Input.synthesizeScrollGesture', {x: Math.round(panel.x + panel.width / 2), y: Math.round(panel.y + 300), yDistance: -200, gestureSourceType: 'touch', speed: 800});
    expect(await turning(), 'scrolling the panel (wheel and touch) leaves the camera turning');
    await p.cdp('Input.dispatchMouseEvent', {type: 'mouseWheel', x: view.x + view.width / 2, y: view.y + view.height / 2, deltaX: 0, deltaY: -100});
    await p.sleep(150);
    expect(!(await turning()), 'a wheel on the 3D view stops it');
  }},
  {name: 'the car park layout changes as one animation (a view transition), not in a single frame', async run(p, expect) {
    await p.goto('?debug=1');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    const watch = `(()=>{window.__vt=new Set();const t0=performance.now();const f=()=>{for(const a of document.getAnimations())if(a.effect?.pseudoElement?.startsWith('::view-transition-group'))__vt.add(a.effect.pseudoElement);if(performance.now()-t0<600)requestAnimationFrame(f);};requestAnimationFrame(f);})()`;
    for (const to of ['parking', 'pond']) {
      await p.eval(watch); await p.click(`[data-destination="${to}"]`); await p.sleep(700);
      const groups = await p.eval('[...__vt]');
      expect(['tour-view', 'tour-dock', 'tour-panel'].every(n => groups.includes(`::view-transition-group(${n})`)), `to ${to}: the 3D view, the dock and the panel move to their new place (${groups.join(', ') || 'no transition'})`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
    }
  }},
  {quick: true, name: 'flying between stops: floors are sliced away and built up solid, never faded see-through', async run(p, expect) {
    await p.goto('?debug=1');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // Every frame of the flights: named building meshes drawn more see-through than they were before (the stop's
    // marker, unnamed, fades on purpose), and frames where geometry is being cut.
    await p.eval(`(()=>{const scene=__scene,before=new Map();scene.traverse(o=>{if(o.isMesh&&o.name)before.set(o,[].concat(o.material).map(m=>({transparent:m.transparent,opacity:m.opacity})));});
      window.__xray=0;window.__cuts=0;const f=()=>{if(document.querySelector('#viewport').classList.contains('flying')){let cut=false;
        for(const [o,was] of before){if(!o.visible)continue;[].concat(o.material).forEach((m,i)=>{if(m.transparent&&m.opacity<.99&&(!was[i].transparent||was[i].opacity-m.opacity>.02))__xray++;if(m.clippingPlanes?.length)cut=true;});}
        if(cut)__cuts++;}requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    for (const stop of ['meeting', 'pond', 'energy']) {
      await p.click(`[data-destination="${stop}"]`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${stop}'`, {timeout: 20000, what: `landed at ${stop}`});
    }
    expect(await p.eval('__cuts') > 5, `floors were cut while changing (${await p.eval('__cuts')} frames)`);
    expect(await p.eval('__xray') === 0, `no floor faded see-through (${await p.eval('__xray')} mesh-frames)`);
  }},
  {name: 'pond: the paused reflection\'s stand-in has the live water\'s colour, by day and by night', async run(p, expect) {
    for (const time of ['10:00', '17:50', '20:30']) {
      await p.goto(`?debug=1&dest=pond&time=${time}`);
      await p.until(`document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='pond' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the pond'});
      await p.sleep(600);
      // The water's average colour as drawn (the pixels that change when it is hidden): live, then with the mirror's
      // picture replaced by its stand-in (as during a flight).
      const [live, plain] = await p.eval(`(()=>{const R=__renderer,gl=R.getContext(),w=__scene.getObjectByName('Courtyard_water_reflection'),V=__camera.position.constructor;
        w.geometry.computeBoundingBox();const bb=w.geometry.boundingBox,pts=[];for(const x of [bb.min.x,bb.max.x])for(const y of [bb.min.y,bb.max.y])pts.push(new V(x,y,0).applyMatrix4(w.matrixWorld).project(__camera));
        const W=gl.drawingBufferWidth,H=gl.drawingBufferHeight,xs=pts.map(q=>Math.round((q.x+1)/2*W)),ys=pts.map(q=>Math.round((q.y+1)/2*H));
        const x0=Math.max(0,Math.min(...xs)),x1=Math.min(W,Math.max(...xs)),y0=Math.max(0,Math.min(...ys)),y1=Math.min(H,Math.max(...ys)),buf=new Uint8Array((x1-x0)*(y1-y0)*4);
        const grab=()=>{gl.readPixels(x0,y0,x1-x0,y1-y0,gl.RGBA,gl.UNSIGNED_BYTE,buf);return buf.slice();};
        w.visible=false;R.render(__scene,__camera);const under=grab();w.visible=true;
        const avg=()=>{const a=grab();const s=[0,0,0];let n=0;for(let i=0;i<a.length;i+=4){if(a[i]===under[i]&&a[i+1]===under[i+1]&&a[i+2]===under[i+2])continue;s[0]+=a[i];s[1]+=a[i+1];s[2]+=a[i+2];n++;}return s.map(v=>v/Math.max(1,n));};
        R.render(__scene,__camera);const live=avg();
        const before=w.onBeforeRender;w.onBeforeRender=function(...a){before.apply(this,a);this.material.uniforms.reflectionMix.value=0;};
        R.render(__scene,__camera);const plain=avg();w.onBeforeRender=before;R.render(__scene,__camera);return [live,plain];})()`);
      const off = Math.max(...live.map((v, i) => Math.abs(v - plain[i])));
      expect(off < 6, `${time}: stand-in ${plain.map(Math.round)} vs live ${live.map(Math.round)} (off by ${off.toFixed(1)} of 255)`);
    }
  }},
  {name: 'pond: the water is drawn on every frame from the overview to the pond and back (it never appears at once)', async run(p, expect) {
    await p.goto('?debug=1');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // Each frame the pond is on screen: whether its water layer was drawn, and how far its mix moved since the last frame.
    await p.eval(`(()=>{const R=__renderer,w=__scene.getObjectByName('Courtyard_water_reflection'),pond=__scene.getObjectByName('Floor_1_koi_pond_0');window.__water={frames:0,missing:0,jump:0};let drawn=false,last=null;
      const ob=w.onBeforeRender;w.onBeforeRender=function(...a){ob.apply(this,a);drawn=true;const m=this.material.uniforms.reflectionMix.value;if(last!==null)__water.jump=Math.max(__water.jump,Math.abs(m-last));last=m;};
      const r=R.render.bind(R);R.render=(s,c)=>{if(R.getRenderTarget()||c!==__camera)return r(s,c);drawn=false;const o=r(s,c);
        pond.geometry.computeBoundingSphere();const q=pond.geometry.boundingSphere.center.clone().applyMatrix4(pond.matrixWorld).project(__camera);
        if(q.z<1&&Math.abs(q.x)<1&&Math.abs(q.y)<1){__water.frames++;if(!drawn)__water.missing++;}return o;};})()`);
    for (const to of ['pond', 'overview']) {
      await p.click(`[data-destination="${to}"]`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      await p.sleep(400);
    }
    const water = await p.eval('__water');
    expect(water.frames > 30 && water.missing === 0, `the water was drawn on every frame the pond was on screen (${water.frames - water.missing} of ${water.frames})`);
    // The fade runs on time (0.25 s): a slow frame under load covers more of it, but never the whole of it at once.
    expect(water.jump < .5, `its reflection fades in and out, never in one step (largest change in a frame ${water.jump.toFixed(2)})`);
  }},
  {name: 'meeting room: its light cone fades in as the camera arrives and out as it leaves (no pop)', async run(p, expect) {
    await p.goto('?debug=1&time=10:00');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // The cone's opacity on every frame (0 while hidden).
    await p.eval(`(()=>{window.__cone=[];const g=__scene.getObjectByName('Demo_meeting');let cone=null;g.traverse(o=>{if(o.geometry?.type==='CylinderGeometry')cone=o;});
      const f=()=>{let shown=true;for(let o=cone;o;o=o.parent)if(!o.visible)shown=false;__cone.push(shown?cone.material.opacity:0);if(__cone.length<600)requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    await p.click('[data-destination="meeting"]'); await p.until(`${idle} && document.body.dataset.tourDestination==='meeting'`, {timeout: 20000, what: 'at the meeting room'}); await p.sleep(500);
    await p.click('[data-destination="pond"]'); await p.until(`${idle} && document.body.dataset.tourDestination==='pond'`, {timeout: 20000, what: 'at the pond'});
    const c = await p.eval('__cone'), top = Math.max(...c);
    let step = 0; for (let i = 1; i < c.length; i++) step = Math.max(step, Math.abs(c[i] - c[i - 1]));
    expect(top > .15 && c.at(-1) === 0, `the cone showed at the meeting room (${top.toFixed(2)}) and is gone at the pond`);
    expect(step < top * .25, `it faded in and out (largest change in one frame ${(step / top * 100).toFixed(0)}% of full)`);
  }},
  {quick: true, name: 'meeting room: its light cone looks the same from every side and from above', async run(p, expect) {
    await p.goto('?debug=1&dest=meeting&time=10:00');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the meeting room'});
    await p.sleep(600);
    const r = await p.eval(`(()=>{
      const g=__scene.getObjectByName('Demo_meeting');let beam=null;g.traverse(o=>{if(o.geometry?.type==='CylinderGeometry')beam=o;});
      const glazing=__scene.getObjectByName('Floor_4_glazing'),V=__camera.position.constructor,axis=beam.getWorldPosition(new V()),cam=__camera.clone();
      // Draw order against the room's glazing, the camera circling the cone.
      let order=[];const hooks=[beam,glazing].map(o=>{const f=o.onBeforeRender;o.onBeforeRender=function(...a){order.push(o);return f.apply(this,a);};return [o,f];});
      const before=[],off=__camera.position.clone().sub(axis);
      for(let a=-90;a<=90;a+=15){cam.position.copy(axis).add(off.clone().applyAxisAngle(new V(0,1,0),a*Math.PI/180));cam.lookAt(axis);cam.updateMatrixWorld();order=[];__renderer.render(__scene,cam);if(order.includes(glazing)&&order.indexOf(beam)<order.indexOf(glazing))before.push(a);}
      for(const [o,f] of hooks)o.onBeforeRender=f;
      // The cone's own light at its axis on screen, alone in a scene: from the side and from straight above.
      const solo=new __scene.constructor(),copy=beam.clone();copy.matrixAutoUpdate=false;copy.matrix.copy(beam.matrixWorld);copy.onBeforeRender=beam.onBeforeRender;
      const gl=__renderer.getContext(),px=new Uint8Array(4);
      const light=(eye)=>{cam.position.copy(axis).add(eye);cam.lookAt(axis);cam.updateMatrixWorld();cam.updateProjectionMatrix();
        const read=()=>{const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;gl.readPixels(w>>1,h>>1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];};
        solo.remove(copy);__renderer.render(solo,cam);const dark=read();solo.add(copy);__renderer.render(solo,cam);return read()-dark;};
      const side=light(new V(5,0,2)),above=light(new V(.01,6,0));solo.remove(copy);
      return {before,side,above};})()`);
    expect(r.before.length === 0, `the cone is drawn after the room's glazing from every side (drawn before it at ${r.before.join(', ') || 'none'}°)`);
    expect(r.side > 30 && r.above > r.side * .5, `seen from straight above, the cone still glows (side ${r.side}, above ${r.above})`);
  }},
  {name: 'room lights fade on and off, every room alike (not only the meeting room)', async run(p, expect) {
    await p.goto('?debug=1&dest=meeting&time=20:30');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the meeting room at night'});
    await p.sleep(600);
    // A room other than the meeting room with one of the night's spot lights: its light is switched on, then off.
    const room = await p.eval(`(()=>{const s=__scene.getObjectsByProperty('isSpotLight',true).find(l=>l.visible&&l.userData.roomId&&l.userData.roomId!=='f4_meeting_2');return s?.userData.roomId||null;})()`);
    expect(room, `a neighbour room with a spot light at night (${room})`);
    if (!room) return;
    const trace = async on => {
      // Its light fittings' glow (the spot lights can be dealt to other rooms when one is switched; the fittings stay).
      await p.eval(`(()=>{window.__fade=[];let fitting=null;__scene.traverse(o=>{if(!fitting&&o.isMesh&&o.userData.roomId==='${room}'&&o.userData.deviceKind==='light'&&o.material.emissive)fitting=o;});
        const f=()=>{__fade.push(fitting.material.emissiveIntensity);if(__fade.length<40)requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
      await p.eval(`__simulationApi.setRoom('${room}',{light:${on}})`);
      await p.sleep(900);
      return p.eval('__fade');
    };
    for (const on of [true, false]) {
      const f = await trace(on), top = Math.max(...f), mid = f.filter(v => v > top * .1 && v < top * .9).length;
      expect(top > 0 && f.at(-1) === (on ? top : 0) && mid >= 5, `switched ${on ? 'on' : 'off'}: the light ${on ? 'rose' : 'fell'} over ${mid} frames, not in one`);
    }
  }},
  {name: 'night: the room lights are dealt around the selected room as soon as it is selected, not at the next switch', async run(p, expect) {
    await p.goto('?debug=1&dest=meeting&time=20:30');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the meeting room at night'});
    await p.sleep(400);
    const dealt = `JSON.stringify(__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.name.startsWith('Simulation_spot')).map(l=>l.userData.roomId))`;
    const before = await p.eval(dealt);
    const other = JSON.parse(before).find(id => id && id !== 'f4_meeting_2');
    await p.eval(`__simulationApi.setRoom('${other}',{light:true})`);
    await p.sleep(100);
    expect(await p.eval(dealt) === before, `switching ${other} moved no light between rooms (${before} → ${await p.eval(dealt)})`);
  }},
  {name: 'night flights: room lights moving between rooms (the floors change) fade out and in, never switch at once', async run(p, expect) {
    await p.goto('?debug=1&time=19:00');
    const idle = `${UP} && !document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')`;
    await p.until(`${idle} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    await p.sleep(600);
    // Each frame: each room spot's brightness as drawn (0 while it or its floor is hidden); a change of more than half
    // of full (105) in one frame is a light switching at once. The fades run on time (0.22 s each way): a slow frame
    // under load covers more of one, but never half of it.
    await p.eval(`(()=>{const spots=__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.name.startsWith('Simulation_spot'));window.__jumps=[];window.__moves=0;let last=null;
      const shown=o=>{for(let x=o;x;x=x.parent)if(!x.visible)return false;return true;};
      const f=()=>{const now=spots.map(l=>({v:shown(l)?l.intensity:0,room:l.userData.roomId}));
        if(last)now.forEach((n,i)=>{if(n.room!==last[i].room)__moves++;const d=Math.abs(n.v-last[i].v);if(d>52)__jumps.push(Math.round(d)+' '+last[i].room+'→'+n.room);});
        last=now;requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    for (const to of ['meeting', 'pond', 'energy', 'overview']) {
      await p.click(`[data-destination="${to}"]`);
      await p.until(`${idle} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      await p.sleep(500);
    }
    expect(await p.eval('__moves') >= 3, `the lights moved between rooms as the floors changed (${await p.eval('__moves')} moves)`);
    const jumps = await p.eval('__jumps');
    expect(!jumps.length, `no light switched at once (${jumps.slice(0, 4).join(', ') || 'none'})`);
  }},
  {name: 'a door\'s shadow follows it as it swings, not only once it is open', async run(p, expect) {
    await p.goto('?debug=1&dest=meeting&time=10:00');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the meeting room'});
    // Shadow redraws while a hinge is turning.
    await p.eval(`(()=>{const R=__renderer,sm=R.shadowMap,orig=sm.render.bind(sm);window.__door={swingFrames:0,shadowed:0};const hinges=[];__scene.traverse(o=>{if(o.userData.deviceKind==='door'&&o.userData.doorId&&!o.isMesh)hinges.push(o);});let last=hinges.map(h=>h.rotation.y);
      sm.render=(...a)=>{const now=hinges.map(h=>h.rotation.y);const turning=now.some((v,i)=>Math.abs(v-last[i])>1e-4);last=now;if(turning){__door.swingFrames++;if(sm.needsUpdate)__door.shadowed++;}return orig(...a);};})()`);
    await p.click('[data-control="door"]');
    await p.sleep(1000);
    const door = await p.eval('__door');
    expect(door.swingFrames >= 5 && door.shadowed >= door.swingFrames - 1, `the shadow was redrawn on the swing's frames (${door.shadowed} of ${door.swingFrames})`);
  }},
  {name: 'opening straight on a stop keeps its scene: the pond mirror on ?dest=pond', async run(p, expect) {
    await p.goto(`?dest=pond&${FASTW}`);
    await p.until(`document.documentElement.dataset.warm==='done'`, {timeout: 40000, what: 'warm-up done'});
    await p.sleep(3000 / SPEED + 500);
    expect(await p.eval(`__scene.getObjectByName('Courtyard_water_reflection').visible`), 'pond mirror visible after the start-up warm-up');
  }},

  {quick: true, name: 'pond mirror: redrawn when the camera moves, at most ~10 times a second while it is still', async run(p, expect) {
    await p.goto(`?dest=pond&${FASTW}`);
    await p.until(`document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='pond' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the pond'});
    await p.until(`__scene.getObjectByName('Courtyard_water_reflection').visible`, {what: 'pond mirror on'});
    // Counts the screen's frames and the mirror's passes (into its own target, through its unnamed camera; the plate
    // cameras' snapshots of passing cars draw into targets too, through named cameras).
    await p.eval(`(()=>{const R=__renderer,render=R.render.bind(R);window.__passes={screen:0,mirror:0};R.render=(s,c)=>{if(!R.getRenderTarget())__passes.screen++;else if(c.isPerspectiveCamera&&!c.name)__passes.mirror++;return render(s,c);};})()`);
    // Still camera, the view kept redrawing (as passing cars do).
    const redraw = `(()=>{let n=0;const f=()=>{__controls.dispatchEvent({type:'change'});if(++n<60)requestAnimationFrame(f);};requestAnimationFrame(f);})()`;
    await p.eval('Object.assign(__passes,{screen:0,mirror:0})'); await p.eval(redraw); await p.sleep(1200);
    const still = await p.eval('({...__passes})');
    expect(still.screen >= 30 && still.mirror <= Math.ceil(still.screen / 4), `still: the mirror is not redrawn every frame (${still.mirror} mirror passes for ${still.screen} frames)`);
    // The camera turns a little: the mirror follows on that same frame.
    // Counted from the move on, in one step: a frame drawn in between (cars passing, the camera still) is not it.
    await p.eval(`(()=>{Object.assign(__passes,{screen:0,mirror:0});const c=__controls.object,t=__controls.target;c.position.sub(t).applyAxisAngle({x:0,y:1,z:0,isVector3:true},.02).add(t);__controls.update();})()`);
    await p.until('__passes.screen >= 1', {what: 'a frame drawn'});
    const moved = await p.eval('({...__passes})');
    expect(moved.mirror >= 1, `moved: the mirror is redrawn with the frame (${moved.mirror} mirror passes for ${moved.screen} frames)`);
  }},

  {name: 'a hidden car park does not redraw the view: cars driving while an upper floor is shown', async run(p, expect) {
    await p.goto(`?dest=meeting&${FASTW}&time=20:00`);
    await p.until(`document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying') && !__scene.getObjectByName('Demo_parking').visible`, {timeout: 40000, what: 'at the meeting room, car park hidden'});
    await p.sleep(500); // the air flow (AC off at 20:00) has faded
    await p.eval(`(()=>{const R=__renderer,render=R.render.bind(R);window.__frames=0;R.render=(s,c)=>{if(!R.getRenderTarget())__frames++;return render(s,c);};})()`);
    await p.until('__parking.traffic.passBy()', {timeout: 10000, what: 'a car sent down the street'});
    await p.eval('__frames=0'); await p.sleep(1000);
    const frames = await p.eval('__frames');
    expect(frames < 15, `the view is not redrawn for unseen cars (${frames} frames in 1 s)`);
  }},

  {name: 'car park life: no car pops in or out of view (a fast evening rush from the overview; a new car never flashes at the origin)', async run(p, expect) {
    // A 4-minute day: the rush outpaces the barrier, and the gap is made up in the bays. On screen, only in bays the
    // camera cannot see (popping in and out of view under the building read as a flicker).
    await p.goto('?debug=1&dest=overview&time=17:00&day=4');
    await p.until(`window.__parking && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='overview' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the overview'});
    await p.eval(`(()=>{const V=__camera.position.constructor,ndc=new V(),seen=new Map();window.__pops=[];
      const inView=pos=>{ndc.copy(pos).project(__camera);return ndc.z<1&&Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1;};
      const cars=()=>__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car_')&&c.visible);
      for(const c of cars())seen.set(c,c.position.clone());
      window.__leaving=0;const f=()=>{__leaving=Math.max(__leaving,__parking.traffic.leaving);const now=new Set(cars());for(const c of now)if(!seen.has(c)&&inView(c.position)&&Math.abs(c.position.x)<90)__pops.push('in '+c.name);
        for(const [c,pos] of seen)if(!now.has(c)&&inView(pos)&&Math.abs(pos.x)<90)__pops.push('out '+c.name);
        seen.clear();for(const c of now)seen.set(c,c.position.clone());requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    await p.sleep(9000);
    const pops = await p.eval('__pops');
    // The rush goes on in view: cars drive out through the barrier instead.
    expect(await p.eval('__leaving') >= 1, `cars leave through the barrier meanwhile (up to ${await p.eval('__leaving')} at once)`);
    expect(!pops.length, `no car appeared or vanished in view (${pops.slice(0, 4).join(', ') || 'none'})`);
  }},

  {name: 'panels update in place: a hovered button stays the same element, still hovered, through a refresh', async run(p, expect) {
    await p.goto('?debug=1&dest=overview&time=10:00&day=4'); // a fast day: the readings change between refreshes
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='overview' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the overview'});
    await p.eval(`document.querySelector('#dashboard-content .panel-action').scrollIntoView({block:'center'})`); await p.sleep(100);
    const b = JSON.parse(await p.eval(`JSON.stringify(document.querySelector('#dashboard-content .panel-action').getBoundingClientRect())`));
    await p.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: b.x + b.width / 2, y: b.y + b.height / 2});
    await p.sleep(100);
    expect(await p.eval(`document.querySelector('#dashboard-content .panel-action').matches(':hover')`), 'hovered before the refresh');
    await p.eval(`(()=>{const el=document.querySelector('#dashboard-content .panel-action');el.__marked=true;window.__html=document.querySelector('#dashboard-content').innerHTML;})()`);
    // The panel redraws at least every 2 s (its readings follow the clock); wait for one that changed something.
    await p.until(`document.querySelector('#dashboard-content').innerHTML!==__html`, {timeout: 8000, what: 'a panel refresh'});
    expect(await p.eval(`document.querySelector('#dashboard-content .panel-action').__marked===true`), 'the button is the same element after the refresh');
    await p.sleep(100);
    expect(await p.eval(`document.querySelector('#dashboard-content .panel-action').matches(':hover')`), 'and still hovered (no flicker)');
  }},

  {name: 'kiosk follows the day: the morning car park plays the story; a touch pauses it', async run(p, expect) {
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until('window.__parking && __parking.story.running', {timeout: 60000, what: 'the morning car park plays the parking story'});
    await p.until('__parking.story.index >= 1', {timeout: 20000, what: 'story step 2'});
    const parked = await p.eval('__parking.sim.state.presence.size');
    expect(parked >= 25, `the story starts from the 09:00 car park, even when it begins at 07:35 (${parked} cars)`);
    await p.eval(`document.querySelector('#viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.sleep(300);
    expect(!(await p.eval('__parking.story.running')), 'touch stopped the story');
  }},

  {name: 'Play the story at once after tapping Parking: the story keeps the car park', async run(p, expect) {
    // Real speed: the flight to the car park is still on its way when Play is tapped, and the story's first camera
    // move ends it.
    await p.goto('?debug=1');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    await p.click('[data-destination="parking"]');
    await p.until('__parking.active', {timeout: 10000});
    await p.click('[data-bar="play"]');
    await p.sleep(2500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,active:__parking.active,dest:document.body.dataset.tourDestination})`));
    expect(r.story && r.active && r.dest === 'parking', `story still playing at the car park (story ${r.story}, car park ${r.active}, stop ${r.dest})`);
  }},
  {name: 'the view controls step aside while the story shows a caption', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const shown = `getComputedStyle(document.querySelector('.view-controls')).visibility==='visible'`;
    expect(await p.eval(shown), 'view controls shown in free play');
    await p.click('[data-bar="play"]');
    await p.until(`!!document.querySelector('.has-caption') && !(${shown})`, {timeout: 20000, what: 'view controls hidden under the story caption'});
    await p.click('[data-bar="free"]');
    await p.until(shown, {timeout: 5000, what: 'view controls back after the story'});
    expect(true, 'hidden during the story, back after it');
  }},
  {name: 'narrow window: both gate cameras show a picture, the story step and the disclosure stay on one line', async run(p, expect) {
    await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1000, height: 900, deviceScaleFactor: 1, mobile: false});
    try {
      await p.goto(parking());
      await p.until(ready, {timeout: 40000});
      await p.click('[data-tab="gate"]');
      await p.until(`[...document.querySelectorAll('.pk-cams figure')].every(f=>f.querySelector('img'))`, {timeout: 5000, what: 'both camera pictures (the exit one before any car has left)'});
      const line = sel => `(e=>{const r=e.getBoundingClientRect(),h=parseFloat(getComputedStyle(e).lineHeight)||parseFloat(getComputedStyle(e).fontSize)*1.6;return r.height<=h*1.3})(document.querySelector(${JSON.stringify(sel)}))`;
      expect(await p.eval(line('.simulation-disclosure')), 'disclosure on one line');
      await p.click('[data-bar="play"]');
      await p.until('__parking.story.index >= 1', {timeout: 30000, what: 'story step 2'});
      expect(await p.eval(line('.pk-bar-progress > span')), `step label on one line (${await p.eval(`document.querySelector('.pk-bar-progress > span').getBoundingClientRect().height`)} px tall)`);
      const rows = await p.eval(`new Set([...document.querySelector('#parking-bar').children].map(e=>Math.round(e.getBoundingClientRect().top/10))).size`);
      expect(rows <= 2, `story bar in at most two rows (${rows})`);
    } finally { await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); }
  }},
  {name: 'metric pairs stay aligned when one label wraps', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(`${UP} && !!document.querySelector('.metric-pair .metric-value')`, {timeout: 40000});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const m=document.querySelector('.metric-pair');m.style.width='260px';m.querySelectorAll('.metric-label')[1].textContent='Sample meeting room on floor 4';
      const top=s=>[...m.querySelectorAll(s)].map(e=>Math.round(e.getBoundingClientRect().top));return {labels:[...m.querySelectorAll('.metric-label')].map(e=>Math.round(e.getBoundingClientRect().height)),values:top('.metric-value'),notes:top('.metric-note')}})())`));
    expect(r.labels[1] > r.labels[0], `the second label wraps (${r.labels.join(' / ')} px)`);
    expect(r.values[0] === r.values[1] && r.notes[0] === r.notes[1], `values and notes stay level (values ${r.values.join('/')}, notes ${r.notes.join('/')})`);
  }},
  {name: 'kiosk recovers from an idle guided story', async run(p, expect) {
    // speed 5, not 30: the 60 s idle timeout becomes 12 s, room for the setup taps and the story's first step under load.
    await p.goto('?kiosk=1&debug=1&speed=5');
    await p.until('window.__parking && document.querySelector("#kiosk-toggle").checked', {timeout: 40000});
    await p.click('#viewport');
    await p.click('[data-destination="parking"]');
    await p.until('__parking.active', {timeout: 30000});
    if (await p.eval(`document.querySelector('[data-bar="auto"]').checked`)) await p.click('[data-bar="auto"]');
    await p.click('[data-bar="play"]');
    await p.until('__parking.story.waitingForNext', {timeout: 30000, what: 'guided story waiting'});
    await p.until(`document.body.dataset.tourDestination !== 'parking' || (__parking.story.running && __parking.story.auto)`, {timeout: 30000, what: 'loop takes over (60 s / 5)'});
    expect(true, 'loop resumed');
  }},
  {name: 'car park keeps living at building stops (staff cars come and go)', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="pond"]');
    await p.sleep(1500);
    const before = await p.eval('__parking.sim.state.events.length');
    // Background lot traffic skips a turn while another car is moving; with four browsers sharing the GPU that can take a while.
    await p.until(`__parking.sim.state.events.length > ${before}`, {timeout: 30000, what: 'an entry or exit while on the pond stop'});
    const kinds = await p.eval(`__parking.sim.state.events.slice(0, __parking.sim.state.events.length - ${before}).map(e=>e.kind+':'+e.type).join(',')`);
    expect(!/unknown/.test(kinds), `no unknown cars away from the parking stop (got ${kinds})`);
  }},

  {name: 'night: the page switches as one cross-fade, no text fades through its own background', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(`${UP} && !document.querySelector('#tour-night').disabled`, {timeout: 40000});
    // Every frame for 1 s from the switch: colour transitions running on any element (the old per-element fades).
    await p.eval(`(()=>{window.__fades=0;const end=performance.now()+1000;(function watch(){window.__fades=Math.max(window.__fades,document.getAnimations().filter(a=>a instanceof CSSTransition&&/color|background/.test(a.transitionProperty)).length);if(performance.now()<end)requestAnimationFrame(watch);})()})()`);
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 10000, what: 'night on'});
    await p.sleep(1100);
    expect(await p.eval('__fades') === 0, `no element fades its own colours during the switch (${await p.eval('__fades')} at most)`);
  }},
  {quick: true, name: 'night: every car on the move lights the road from its bumper and the air ahead with its beams; parked cars are dark', async run(p, expect) {
    await p.goto(parking('&time=20:00'));
    await p.until(`${ready} && document.documentElement.dataset.night === 'true'`, {timeout: 40000});
    const lamps = c => `(c=>c.children[2].material.color.r)(${c})`, pool = c => `${c}.getObjectByName('Demo_car_headlights')`, beams = c => `${c}.getObjectByName('Demo_car_headlight_beams')`;
    await p.eval(`(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');window.__out=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__parking.sim.state.presence.get(k).plate);window.__still=__parking.lot.root.children.find(c=>c.name.startsWith('Demo_car_')&&c!==__out&&c.visible&&__parking.traffic.parkedKeys().some(k=>'Demo_car_'+__parking.sim.state.presence.get(k).plate===c.name));void __parking.traffic.leave(k)})()`);
    await p.until(`${pool('__out')}.visible`, {timeout: 10000, what: 'the leaving car lights the road'});
    expect(await p.eval(lamps('__out')) === 1, 'the leaving car has its lamps on');
    expect(await p.eval(`!!${beams('__out')}?.visible`), 'and its beams in the air');
    expect(await p.eval(`!${pool('__still')}.visible && !${beams('__still')}?.visible`) && await p.eval(lamps('__still')) < .5, 'a parked car is dark, with no light on the road or in the air');
    // The beams are lit air (as the meeting room's cone): they glow seen from the side and from above alike. Drawn
    // alone in a scene, the light they add at a point on a beam's axis 2.5 m ahead of the bumper.
    const glow = await p.eval(`(()=>{const b=${beams('__out')},V=__camera.position.constructor;b.updateWorldMatrix(true,false);
      const solo=new __scene.constructor(),copy=b.clone();copy.matrixAutoUpdate=false;copy.matrix.copy(b.matrixWorld);copy.visible=true;
      const cam=__camera.clone(),gl=__renderer.getContext(),px=new Uint8Array(4),aim=new V(.6,.5,4.7).applyMatrix4(b.matrixWorld);
      const light=local=>{cam.position.copy(new V(...local).applyMatrix4(b.matrixWorld));cam.lookAt(aim);cam.updateMatrixWorld();
        const read=()=>{gl.readPixels(gl.drawingBufferWidth>>1,gl.drawingBufferHeight>>1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];};
        solo.remove(copy);__renderer.render(solo,cam);const dark=read();solo.add(copy);__renderer.render(solo,cam);return read()-dark;};
      return {side:light([7,.6,4.7]),above:light([.61,8,4.7])};})()`);
    expect(glow.side > 25 && glow.above > 25, `the beams glow seen from the side and from above (side ${glow.side}, above ${glow.above})`);
    // The light grows out from under the bumper (the lamps), not metres ahead of it, and is part of the car (it moves
    // with it). Its patch starts under the car's nose, hidden by the body, and the light fades to nothing before every
    // edge of the patch (a light still bright at an edge showed as a straight cut).
    const start = await p.eval(`(()=>{const g=${pool('__out')}.geometry;g.computeBoundingBox();return g.boundingBox.min.z})()`);
    expect(start > 1.2 && start < 2.2, `the light's patch starts under the car's nose (${start.toFixed(2)} m from the car's centre; the bumper is at 2.2 m)`);
    const edges = await p.eval(`(()=>{const c=${pool('__out')}.material.map.image,x=c.getContext('2d'),W=c.width,H=c.height,a=(X,Y,w,h)=>Math.max(...x.getImageData(X,Y,w,h).data.filter((_,i)=>i%4===3));
      return {near:a(0,0,W,1),far:a(0,H-1,W,1),left:a(0,0,1,H),right:a(W-1,0,1,H),peak:a(0,0,W,H)};})()`);
    expect(edges.peak > 200 && Math.max(edges.near, edges.far, edges.left, edges.right) < 4, `soft on every edge (edge alpha near ${edges.near}, far ${edges.far}, sides ${edges.left}/${edges.right}; brightest ${edges.peak})`);
    // Every car on the move has its light: none of them waits for a free light, as the three spot lights made them do.
    await p.until(`(()=>{const moving=__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car_')&&c.visible&&c.children[2].material.color.r===1);return moving.length>=2&&moving.every(c=>c.getObjectByName('Demo_car_headlights').visible&&c.getObjectByName('Demo_car_headlight_beams').visible)})()`, {timeout: 20000, what: 'two or more cars on the move, all with their light and beams'});
    expect(!(await p.eval(`__scene.getObjectsByProperty('isSpotLight',true).some(s=>s.name.startsWith('Demo_headlight'))`)), 'no spot lights for headlights (the light is painted, so it costs the scene nothing)');
    // Daytime: no light on the road, every car drawn as is.
    await p.eval('__world.jumpTo(9*60)');
    await p.until(`document.documentElement.dataset.night === 'false'`, {timeout: 5000, what: 'day'});
    expect(await p.eval(`__parking.lot.root.children.every(c=>!c.getObjectByName('Demo_car_headlights')?.visible&&!c.getObjectByName('Demo_car_headlight_beams')?.visible)`), 'no headlight light or beams in the daytime');
    expect(await p.eval(lamps('__still')) === 1, 'parked car drawn as is in the daytime');
  }},
  {name: 'night: the first dusk does not freeze the view (night shaders ready from the start)', async run(p, expect) {
    // Real speed. The night's lights (the rooms') change the shaders; the warm-up prepares them, so the
    // first switch draws like any frame. Before, it stalled ~1.8 s compiling and linking.
    await p.goto('?debug=1&time=17:00&dest=parking');
    await p.until(`${ready} && document.documentElement.dataset.warm==='done' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 40000});
    await p.sleep(1000);
    const worst = await p.eval(`new Promise(ok=>{let last=performance.now(),worst=0;const end=last+2500;(function f(t){worst=Math.max(worst,t-last);last=t;if(t<end)requestAnimationFrame(f);else ok(Math.round(worst));})(last);__world.jumpTo(20*60);})`);
    expect(await p.eval(`document.documentElement.dataset.night`) === 'true', 'night');
    expect(worst < 700, `longest frame around the first dusk: ${worst} ms`);
  }},
  {quick: true, name: 'night: switching the meeting-room light changes only that room', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="meeting"]');
    await p.until("document.body.dataset.tourDestination === 'meeting' && !document.querySelector('#tour-night').disabled", {timeout: 20000});
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 10000});
    await p.sleep(600); // the rooms' lights fade (~0.35 s) to the night's schedule
    const spots = `JSON.stringify(__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.visible&&l.name.startsWith('Simulation_spot')).map(l=>[l.userData.roomId,l.position.x.toFixed(1),l.position.z.toFixed(1),l.intensity]))`;
    const before = JSON.parse(await p.eval(spots));
    await p.click('[data-control="light"]');
    await p.sleep(600);
    const after = JSON.parse(await p.eval(spots));
    const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
    expect(after.length === before.length && after.every((s, i) => same(s, before[i])), 'the same spots stay assigned to the same rooms');
    const changed = after.filter((s, i) => s[3] !== before[i][3]).map(s => s[0]);
    expect(changed.length > 0 && changed.every(id => id === 'f4_meeting_2'), `only the meeting room's spot changed (changed: ${changed.join(', ') || 'none'})`);
    await p.click('#tour-night');
  }},
  {name: 'a leaving car gets out even with busy street traffic', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Keep the eastbound lane as busy as spacing allows, then send a car out: it must get a gap and leave,
    // not wait at the barrier for good (the bug: through-traffic never left a long enough gap).
    await p.eval('window.__pump=setInterval(()=>__parking.traffic.passBy(1),30)');
    await p.sleep(1500);
    const key = await p.eval(`(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');void __parking.traffic.leave(k);return k})()`);
    try { await p.until(`!__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 12000, what: 'exit through the barrier (6 min of demo time)'}); }
    finally { await p.eval('clearInterval(window.__pump)'); }
    expect(true, 'car left');
  }},

  {name: 'dock: first visit to the meeting room is quick and does not stall', async run(p, expect) {
    // Real speed and no ?debug, as visitors get it.
    await p.goto('?probe=1');
    await p.until(`document.documentElement.dataset.warm === 'done'`, {timeout: 40000, what: 'startup warm-up'});
    await p.eval(`(()=>{window.__gaps=[];let last=performance.now();const f=t=>{window.__gaps.push(t-last);last=t;requestAnimationFrame(f)};requestAnimationFrame(f)})()`);
    const t0 = Date.now();
    await p.click('[data-destination="meeting"]');
    await p.until(`document.body.dataset.tourDestination === 'meeting'`, {timeout: 10000, what: 'arrival'});
    const took = Date.now() - t0, worst = Math.round(Math.max(...await p.eval('window.__gaps')));
    expect(took < 2000, `lands within 2 s (took ${took} ms)`);
    // Alone this measures ~130 ms; four browsers sharing the GPU push it to ~300 ms. The stall it guards against was 700–1,100 ms.
    expect(worst < 450, `no frame longer than 450 ms (worst ${worst} ms)`);
  }},
  {quick: true, name: 'meeting room: effects show after arriving by the dock, and the light switch is visible', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="meeting"]');
    await p.until(`document.body.dataset.tourDestination === 'meeting' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000});
    await p.sleep(300);
    const group = `__scene.getObjectByName('Demo_meeting')`;
    expect(await p.eval(`${group}.visible`), 'meeting effects visible (people, airflow, light)');
    expect(await p.eval(`${group}.children.filter(o=>o.isLine&&o.visible).length`) === 6, 'six airflow lines from the AC unit');
    const lit = () => p.eval(`${group}.children.filter(o=>o.material?.blending===2&&o.visible).length`);
    const on = await lit();
    await p.click('[data-control="light"]'); await p.sleep(600); // the light fades out over ~0.35 s
    const off = await lit();
    expect(on === 2 && off === 0, `light pool and beam follow the switch (on ${on}, off ${off})`);
  }},

  {name: 'pond, energy and entrance cameras aim at the real objects', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    const centre = expr => (p.eval(`JSON.stringify((()=>{const V=__camera.position.constructor,objs=${expr};const min=new V(1e9,1e9,1e9),max=new V(-1e9,-1e9,-1e9);for(const o of objs)o.traverse(m=>{if(!m.geometry)return;m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;for(const x of [g.min.x,g.max.x])for(const y of [g.min.y,g.max.y])for(const z of [g.min.z,g.max.z]){const v=new V(x,y,z).applyMatrix4(m.matrixWorld);min.min(v);max.max(v)}});return min.add(max).multiplyScalar(.5).toArray()})())`)).then(JSON.parse);
    const stops = {pond: `(()=>{const a=[];__scene.traverse(o=>{if(o.isMesh&&o.name.includes('_koi_pond_'))a.push(o)});return a})()`, energy: `[__scene.getObjectByName('Floor_5_solar_modules')]`, access: `[__scene.getObjectByName('Demo_main_barrier')]`};
    for (const [stop, objects] of Object.entries(stops)) {
      await p.click(`[data-destination="${stop}"]`);
      await p.until(`document.body.dataset.tourDestination === '${stop}' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000});
      const c = await centre(objects), t = await p.eval('__controls.target.toArray()');
      const off = Math.hypot(c[0] - t[0], c[2] - t[2]);
      expect(off < 1, `${stop}: camera aims within 1 m of the object (off by ${off.toFixed(1)} m)`);
    }
  }},
  {name: 'one gate on site: the Entrance stop uses the main gate', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    expect(!(await p.eval(`!!__scene.getObjectByName('Demo_barrier_arm')`)), 'no second (original) barrier arm');
    await p.click('[data-destination="access"]');
    await p.until(`document.body.dataset.tourDestination === 'access' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000});
    await p.click('[data-action="access"]');
    await p.until(`__parking.sim.state.gate !== 'closed'`, {timeout: 10000, what: 'the main gate opens for the entrance scenario'});
    expect(true, 'main gate opened');
  }},
  {name: 'a leaving car does not wait long at the barrier', async run(p, expect) {
    // speed 10 and 3 s for street traffic to build up, as in normal use.
    await p.goto('?dest=parking&debug=1&speed=10');
    await p.until(ready, {timeout: 40000});
    await p.sleep(3000);
    const key = await p.eval(`(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');window.__exitCar=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__parking.sim.state.presence.get(k).plate);void __parking.traffic.leave(k);return k})()`);
    // Timed in the page on every frame with the demo clock: from this car stopping at the barrier to it driving
    // through (z past the barrier line), so an arm raised for another car does not end the wait early.
    // Whether another car holds the barrier is read on the frame before this one stops there: once stopped, this car
    // takes the barrier itself within the same frame when it is free.
    await p.eval(`(()=>{const s=__parking.sim,c=window.__exitCar,e=window.__exit={};let busy=false;(function watch(){
      if(e.t0==null&&Math.abs(c.position.z-16.6)<.05&&Math.abs(c.position.x+20.2)<.05){e.t0=s.now();e.busy=busy;}
      if(e.t0==null)busy=__parking.traffic.gateHolders>0||s.state.alerts.some(a=>a.status==='open');
      if(e.t0!=null&&c.position.z>19.8)e.t1=s.now();
      if(e.t1==null)requestAnimationFrame(watch);})()})()`);
    await p.until('window.__exit.t1!=null', {timeout: 30000, what: 'the leaving car through the barrier'});
    // The barrier is shared: a car entering meanwhile goes first, as on site, and an unknown car holds it while staff
    // decide (its alert). Either makes the wait longer; otherwise it must be short.
    // A car already holding the barrier when this one arrives (e.busy) counts as well.
    const {waited, others} = await p.eval(`(()=>{const e=window.__exit;return {waited:(e.t1-e.t0)/1000,others:(e.busy?1:0)+__parking.sim.state.events.filter(v=>v.at>=e.t0&&v.at<=e.t1&&['entry','manual','denied','unknown'].includes(v.kind)).length}})()`);
    const limit = others ? 20 : 8;
    expect(waited < limit, `leaving car through the barrier within ${limit} s of demo time, plate read included (waited ${waited.toFixed(1)} s, ${others} other car(s) at the gate meanwhile)`);
  }},
  {name: 'camera card labels fit and the alert never covers it (narrow window, English)', async run(p, expect) {
    await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1200, height: 900, deviceScaleFactor: 1, mobile: false});
    try {
      await p.goto(parking());
      await p.until(ready, {timeout: 40000});
      await p.click('#lang-toggle');
      const k = await p.eval(`(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');void __parking.traffic.leave(k);return k})()`);
      // The exit camera's card (a background car at the entry may show its own card first).
      await p.until(`!document.querySelector('.pk-feed').hidden && document.querySelector('.pk-feed-head').textContent.includes('LPR-OUT') && document.querySelector('.pk-feed-meta .pk-pill')`, {timeout: 30000, what: 'exit camera card'});
      const fit = JSON.parse(await p.eval(`JSON.stringify((()=>{const card=document.querySelector('.pk-feed').getBoundingClientRect(),plate=document.querySelector('.pk-feed-plate').getBoundingClientRect();return [...document.querySelectorAll('.pk-feed-meta .pk-pill')].map(e=>{const r=e.getBoundingClientRect(),inner=e.scrollWidth<=e.clientWidth+1;return {inCard:r.right<=card.right-4&&r.left>=card.left,clearOfPlate:r.left>=plate.right,inner}})})())`));
      expect(fit.length && fit.every(f => f.inCard && f.clearOfPlate && f.inner), `labels fit beside the plate inside the card (${JSON.stringify(fit)})`);
      await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
      await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open') && !document.querySelector('.pk-feed').hidden`, {timeout: 30000, what: 'alert with camera card'});
      const overlap = await p.eval(`(()=>{const a=document.querySelector('.pk-alert-pop').getBoundingClientRect(),b=document.querySelector('.pk-feed').getBoundingClientRect();return !(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)})()`);
      expect(!overlap, 'alert does not overlap the camera card');
      await p.click('#lang-toggle');
    } finally { await p.cdp('Emulation.setDeviceMetricsOverride', {width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false}); }
  }},
  {name: 'meeting room: the door swings and the AC airflow flows and fades', async run(p, expect) {
    // Real speed: these animations are not scaled.
    await p.goto('?debug=1');
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="meeting"]');
    await p.until(`document.body.dataset.tourDestination === 'meeting' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000});
    await p.eval(`(()=>{const hs=[];__scene.traverse(o=>{if(o.userData.doorId==='meeting-4'&&o.name.startsWith('Door_hinge'))hs.push(o)});window.__hinge=hs[0];window.__air=__scene.getObjectByName('Demo_meeting').children.filter(o=>o.isLine)})()`);
    const from = await p.eval('__hinge.rotation.y');
    await p.click('[data-control="door"]');
    const seen = []; for (let i = 0; i < 8; i++) { seen.push(await p.eval('__hinge.rotation.y')); await p.sleep(70); }
    const to = seen.at(-1), between = seen.filter(a => Math.abs(a - from) > .05 && Math.abs(a - to) > .05);
    expect(Math.abs(to - from) > .3 && between.length > 0, `door passes through in-between angles (${seen.map(a => a.toFixed(2)).join(' ')})`);
    const d0 = await p.eval('__air[0].geometry.attributes.lineDistance.array[3]'); await p.sleep(250);
    expect(d0 !== await p.eval('__air[0].geometry.attributes.lineDistance.array[3]'), 'airflow dashes flow while the AC is on');
    await p.click('[data-control="climate"]'); await p.sleep(120);
    const mid = await p.eval('__air[0].material.opacity');
    await p.sleep(500);
    expect(mid > .02 && mid < .58 && !(await p.eval('__air[0].visible')), `airflow fades out (opacity ${mid.toFixed(2)} after 0.12 s, then hidden)`);
  }},
  {name: 'car park surface: one paving with the building, a ramp instead of a step', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const model=__scene.getObjectByName('Parking_paving').material.color.getHexString();let lot=null;__parking.lot.root.traverse(o=>{if(!lot&&o.isMesh&&o.material?.color&&Math.abs(o.position.y)<1e-6&&o.geometry.attributes.position.count<40)lot=o.material.color.getHexString()});return {model,lot}})())`));
    expect(r.lot === r.model, `lot paving matches the building's (${r.lot} vs ${r.model})`);
    const heights = await p.eval(`import('/src/parking/layout.js').then(m=>[13.0,13.8,14.7].map(z=>m.groundY(-14.16,z)))`);
    expect(heights[0] > heights[1] && heights[1] > heights[2], `cars ride down a ramp at the aisle mouth (${heights.map(h => h.toFixed(2)).join(' > ')})`);
  }},
  {name: 'nothing stands in the driveway: booth and light poles are clear of the lanes', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Solid things taller than kerb height whose footprint overlaps the driveway's lanes (z 13.6..18.8, x -58..-12),
    // except the barrier itself and its plate cameras, which stand at the lane edges by design.
    const blocking = await p.eval(`(()=>{const out=[];const gate=__scene.getObjectByName('Demo_main_barrier');const V=__camera.position.constructor;
      __parking.lot.root.traverse(o=>{if(!o.isMesh||o.isInstancedMesh||o.name.startsWith('Demo_car')||o.parent?.name?.startsWith('Demo_car'))return;
        let inCar=false;for(let q=o;q;q=q.parent)if(q.name?.startsWith('Demo_car'))inCar=true;if(inCar)return;
        o.geometry.computeBoundingBox();const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        if(b.max.y-b.min.y<.5)return;
        let inGate=false;for(let q=o;q;q=q.parent)if(q===gate)inGate=true;
        const lpr=inGate&&(b.max.x-b.min.x)<.5&&(b.max.z-b.min.z)<.6;
        const boom=inGate&&(b.max.x-b.min.x)>4;
        if(lpr||boom)return;
        // Vertex by vertex: several poles share one merged mesh, so the mesh's box alone says nothing.
        const pos=o.geometry.attributes.position,v=new V();
        for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);if(v.y>.8&&v.z>13.6&&v.z<18.8&&v.x>-58&&v.x<-12){out.push((o.name||'mesh')+' at x'+v.x.toFixed(1)+' z'+v.z.toFixed(1));break;}}});return out})()`);
    expect(blocking.length === 0, `no obstacle in the lanes (${blocking.join('; ')})`);
  }},
  {name: 'street lights stand along the main road and light it at night (lit air down to a pool on the road), not by day', async run(p, expect) {
    await p.goto(parking('&time=20:00'));
    await p.until(`${ready} && document.documentElement.dataset.night === 'true'`, {timeout: 40000});
    const lights = await p.eval(`(()=>{const V=__camera.position.constructor;return __parking.lot.root.children.filter(o=>o.name==='Demo_street_light').map(o=>{o.geometry.computeBoundingBox();const b=o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);return {visible:o.visible,cone:o.geometry.type==='CylinderGeometry',z:(b.min.z+b.max.z)/2,x:(b.min.x+b.max.x)/2};});})()`);
    const cones = lights.filter(l => l.cone);
    // The street runs from z 22.5 (the kerb on the site's side) to 29.5; the lamps hang over its near lanes.
    expect(cones.length === 3 && cones.every(c => c.z > 22.5 && c.z < 26), `three street lights over the main road (${cones.map(c => `x${c.x.toFixed(0)} z${c.z.toFixed(1)}`).join(', ')})`);
    expect(lights.length === 4 && lights.every(l => l.visible), 'their cones and the pools on the road show at night');
    // Lit air, as the meeting room's cone: it glows seen from the side and from straight above.
    const glow = await p.eval(`(()=>{const c=__parking.lot.root.children.find(o=>o.name==='Demo_street_light'&&o.geometry.type==='CylinderGeometry'),V=__camera.position.constructor;
      const solo=new __scene.constructor(),copy=c.clone();copy.matrixAutoUpdate=false;copy.matrix.copy(c.matrixWorld);
      const cam=__camera.clone(),gl=__renderer.getContext(),px=new Uint8Array(4),aim=c.getWorldPosition(new V()).add(new V(0,1.5,0));
      const light=off=>{cam.position.copy(aim).add(new V(...off));cam.lookAt(aim);cam.updateMatrixWorld();
        const read=()=>{gl.readPixels(gl.drawingBufferWidth>>1,gl.drawingBufferHeight>>1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];};
        solo.remove(copy);__renderer.render(solo,cam);const dark=read();solo.add(copy);__renderer.render(solo,cam);return read()-dark;};
      return {side:light([9,0,3]),above:light([.01,12,0])};})()`);
    expect(glow.side > 25 && glow.above > 25, `the cone glows seen from the side and from above (side ${glow.side}, above ${glow.above})`);
    await p.eval('__world.jumpTo(10*60)');
    await p.until(`document.documentElement.dataset.night === 'false'`, {timeout: 5000, what: 'day'});
    expect(await p.eval(`__parking.lot.root.children.filter(o=>o.name==='Demo_street_light').every(o=>!o.visible)`), 'no street light by day');
  }},
  {name: 'cars drive at their set speed, also while the page is busy', async run(p, expect) {
    // Real speed. Street cars run at exactly 7 m/s (eastbound) or 9 m/s (westbound).
    await p.goto('?dest=parking&debug=1');
    await p.until("window.__parking && __parking.active && document.documentElement.dataset.warm==='done'", {timeout: 40000});
    await p.until(`[...__parking.lot.root.children].some(c=>c.name==='Demo_car_'&&c.position.x>-60&&c.position.x<20)`, {timeout: 20000, what: 'a street car'});
    // Pick and follow one car in the same frame loop (a car picked earlier may already have left the stretch).
    // Keeps the longest trace (a car may leave the stretch during the window); up to three windows under load.
    let s = [], ticks = 0;
    for (let attempt = 0; attempt < 3 && s.length <= 20; attempt++) {
      await p.until(`[...__parking.lot.root.children].some(c=>c.name==='Demo_car_'&&c.position.x>-60&&c.position.x<20)`, {timeout: 20000, what: 'a street car'});
      await p.eval(`(()=>{let c=null,cur=[];window.__s=[];window.__ticks=0;const f=t=>{__ticks++;if(!c||!c.parent||c.position.x<-60||c.position.x>20){c=[...__parking.lot.root.children].find(c=>c.name==='Demo_car_'&&c.position.x>-60&&c.position.x<20)||null;cur=[];}if(c){cur.push([t,c.position.x]);if(cur.length>__s.length)window.__s=cur;}window.__fr=requestAnimationFrame(f)};window.__fr=requestAnimationFrame(f)})()`);
      // Keep the main thread busy meanwhile, as scrolling or a heavy view does.
      await p.eval(`window.__busy=setInterval(()=>{const end=performance.now()+6;while(performance.now()<end);},16)`);
      await p.sleep(1500);
      s = await p.eval('clearInterval(__busy),cancelAnimationFrame(__fr),__s');
      ticks = await p.eval('__ticks');
    }
    expect(s.length > 20, `followed one car for a while (${s.length} frames of ${ticks})`);
    if (s.length < 2) return;
    const v = Math.abs(s.at(-1)[1] - s[0][1]) / ((s.at(-1)[0] - s[0][0]) / 1000);
    expect(Math.abs(v - 7) < .2 || Math.abs(v - 9) < .2, `street car at 7 or 9 m/s (measured ${v.toFixed(2)})`);
  }},
  {name: 'the barrier closes soon after a car drives out', async run(p, expect) {
    await p.goto('?dest=parking&debug=1&speed=10');
    await p.until(ready, {timeout: 40000});
    const key = await p.eval(`(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');void __parking.traffic.leave(k);return k})()`);
    await p.until(`!__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 20000, what: 'exit recorded'});
    const t0 = Date.now();
    await p.until(`__parking.sim.state.gate === 'closed'`, {timeout: 10000, what: 'barrier closed'});
    const s = (Date.now() - t0) * 10 / 1000;
    expect(s < 6, `arm down within 6 s of demo time after the exit (took ${s.toFixed(1)} s)`);
  }},
  {name: 'leaving the story: a drag, Esc or Exit story ends it; Next mode lets you look around', async run(p, expect) {
    const start = async auto => {
      await p.goto(parking(`&story=1&auto=${auto ? 1 : 0}`));
      // In Next mode the story waits at step 1 for the presenter.
      await p.until(`window.__parking && __parking.story.running && __parking.story.index >= ${auto ? 1 : 0}`, {timeout: 40000, what: 'story playing'});
    };
    const drag = () => p.eval(`(()=>{const c=document.querySelector('#viewport canvas'),b=c.getBoundingClientRect(),o={bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons:1,isPrimary:true,clientX:b.left+200,clientY:b.top+200};c.dispatchEvent(new PointerEvent('pointerdown',o));c.dispatchEvent(new PointerEvent('pointermove',{...o,clientX:o.clientX+80}));window.dispatchEvent(new PointerEvent('pointerup',{...o,buttons:0}))})()`);
    await start(true); await drag(); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'dragging the view ends an auto story');
    await start(true); await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'Esc ends the story');
    await start(false); await drag(); await p.sleep(200);
    expect(await p.eval('__parking.story.running'), 'in Next mode a drag only looks around');
    expect(/Exit story|ออกจากเรื่องราว/.test(await p.eval(`document.querySelector('[data-bar="free"]').textContent`)), 'an Exit story button');
    await p.click('[data-bar="free"]'); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'Exit story ends it');
  }},

  {name: 'leaving a story that is part of the tour ends the tour too', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000});
    await p.click('#tour-play');
    await p.until('__parking.story.running && __parking.story.index >= 1', {timeout: 40000, what: 'tour reaches the parking story'});
    await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await p.sleep(2500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,dest:document.body.dataset.tourDestination,pause:!!document.querySelector('#tour-play svg path[d^="M8 5v14"]')})`));
    expect(!r.story, 'the story stopped');
    expect(r.dest === 'parking' && !r.pause, `the tour stopped at the car park (at ${r.dest}, tour ${r.pause ? 'still running' : 'stopped'})`);
  }},
  {quick: true, name: 'visitor flow as in the real app: a confirmation, then the decision by email only', async run(p, expect) {
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    await p.until('__parking.story.waitingForNext', {timeout: 30000}); await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===1 && __parking.story.waitingForNext', {timeout: 30000, what: 'request sent'});
    const sent = JSON.parse(await p.eval(`JSON.stringify((()=>{const ph=document.querySelector('#pk-phone');return {text:ph.querySelector('.ph-screen').textContent,rows:ph.querySelectorAll('.ph-receipt div').length,spinner:!!ph.querySelector('.ph-wait,[class*="spin"]'),inbox:!!ph.querySelector('[data-ph="inbox"]')}})())`));
    expect(/chujai@example\.com/.test(sent.text) && sent.rows === 4, 'confirmation names the email and lists receipt, plate and both dates');
    expect(!sent.spinner && !sent.inbox, 'no live status and no inbox on the website');
    const statusBar = JSON.parse(await p.eval(`JSON.stringify((()=>{const n=document.querySelector('.ph-notch').getBoundingClientRect();return [...document.querySelectorAll('.ph-status > *')].map(e=>{const r=e.getBoundingClientRect();return r.right<=n.left||r.left>=n.right})})())`));
    expect(statusBar.every(Boolean), 'status bar items clear of the notch');
  }},
  {name: 'LPR pop-up is live: it shows the gate camera and its plate box follows the car', async run(p, expect) {
    await p.goto('?dest=parking&debug=1&speed=5');
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`, {timeout: 30000, what: 'car at the gate'});
    expect(await p.eval(`!!document.querySelector('.pk-feed-img.live')`), 'the pop-up picture is the live camera');
    // Record the box every frame from Open until the feed closes: [left, top, width, height] in %, or null when hidden.
    await p.eval(`(()=>{const log=window.__boxLog=[];(function rec(){const f=document.querySelector('.pk-feed'),b=document.querySelector('.pk-feed-box');if(!f||f.hidden)return;log.push(b&&!b.hidden?[b.style.left,b.style.top,b.style.width,b.style.height].map(parseFloat):null);requestAnimationFrame(rec)})()})()`);
    await p.click(`[data-alert-open="${await p.eval(`__parking.sim.state.alerts.find(a=>a.status==='open'&&a.plate==='1กก 1111').id`)}"]`);
    await p.until(`!document.querySelector('.pk-feed:not([hidden])')`, {timeout: 30000, what: 'feed closed after the car drove in'});
    const log = await p.eval(`window.__boxLog`), shown = log.filter(Boolean);
    expect(new Set(shown.map(String)).size > 1, `plate box moves with the car (${new Set(shown.map(String)).size} positions in ${log.length} frames)`);
    // Once the car drives under the camera the plate is out of view: the box goes, and is never drawn off the picture.
    expect(!shown.some(([x, y, w, h]) => x < -1 || y < -1 || x + w > 101 || y + h > 101), 'plate box never drawn outside the picture');
    expect(log.length > 1 && log.at(-1) === null, 'box cleared before the feed closes (the car has left the frame)');
  }},
  {name: 'no plate uses an unlucky letter pair (ศพ, ชน …)', async run(p, expect) {
    await p.goto('?dest=parking&debug=1');
    await p.until('!!window.__parking', {timeout: 40000});
    const bad = await p.eval(`__parking.sim.state.vehicles.map(v=>v.plate).filter(p=>/ศพ|ชน|ตก|ตด|จม|ยม|รก/.test(p)).join(', ')`);
    expect(!bad, `unlucky plates: ${bad}`);
  }},
  {name: 'LPR pop-up never shows the main view: camera flights redraw the inset too', async run(p, expect) {
    await p.goto('?dest=parking&debug=1&speed=5');
    await p.until(ready, {timeout: 40000});
    // Count main-view draws to the screen while the pop-up is visible that no inset draw follows in the same task.
    await p.eval(`(()=>{const R=__renderer,draw=R.render.bind(R);let pending=false;window.__bare=0;
      R.render=(s,c)=>{draw(s,c);if(R.getRenderTarget())return;
        if(c!==__camera){pending=false;return}
        const hole=document.querySelector('.pk-feed:not([hidden]) .pk-feed-img.live');
        if(!hole||hole.getBoundingClientRect().width<4)return;
        pending=true;setTimeout(()=>{if(pending)__bare++;pending=false},0)}})()`);
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`, {timeout: 30000, what: 'car at the gate'});
    // Each flight starts and ends with a resolution switch that redraws the view at once.
    await p.click('[data-destination="access"]'); await p.sleep(400);
    await p.click('[data-destination="parking"]'); await p.sleep(600);
    expect(await p.eval('__bare') === 0, `frames with the main view in the pop-up: ${await p.eval('__bare')}`);
  }},

  // The day cycle: one world clock, running as a time-lapse (`day=10`: a day in 10 real minutes, × SPEED here).
  {name: 'day cycle: the clock runs by itself; a jump brings the car park to the hour, logged over the skipped time', async run(p, expect) {
    await p.goto(`?${FAST}&day=10&time=08:00`);
    await p.until(UP, {timeout: 40000});
    const m0 = await p.eval('__world.minute()');
    await p.sleep(1000);
    const m1 = await p.eval('__world.minute()');
    expect(m1 - m0 > 20, `world time runs as a time-lapse (${m0.toFixed(0)} → ${m1.toFixed(0)} in 1 s)`);
    // Paused from here, so a slow machine cannot run the clock on past what is checked (jumps still move it).
    await p.eval('__world.setPaused(true)');
    // Evening: the car park empties (it is on screen at the overview, but not watched: made up at once).
    const night = JSON.parse(await p.eval(`JSON.stringify((()=>{const from=__world.now();__world.jumpTo(20*60);const to=__world.now();return {from,to,parked:__parking.sim.state.presence.size,exits:__parking.sim.state.events.filter(e=>e.kind==='exit'&&e.at>from&&e.at<=to).length}})())`));
    expect(night.parked <= 6, `car park nearly empty at 20:00 (${night.parked} cars)`);
    expect(night.exits >= 15, `the evening's exits are logged between the old and new time (${night.exits})`);
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 5000, what: 'night after the jump'});
    // Next day's noon: past the 03:00 wrap, back on the event date, the car park full again.
    const noon = JSON.parse(await p.eval(`JSON.stringify((()=>{__world.jumpTo(12*60);const at=__world.now();return {at,parked:__parking.sim.state.presence.size,newest:__parking.sim.state.events[0].at,day:new Date(at+7*3600e3).getUTCDate()}})())`));
    expect(noon.day === 24, `the day wraps: still 24 Nov after a night (${noon.day} Nov)`);
    expect(noon.parked >= 28, `car park full again at noon (${noon.parked} cars)`);
    expect(noon.newest <= noon.at, 'no logged event is in the future after the wrap');
    await p.until(`document.documentElement.dataset.night === 'false'`, {timeout: 5000, what: 'day after the jump'});
  }},
  {quick: true, name: 'day cycle: Night/Day button, the timeline slider and moments move the world clock', async run(p, expect) {
    // Real speed (a time-lapse of 2 world minutes a second), so the clock is read close to where the jump left it.
    await p.goto('?debug=1&day=10&time=09:00');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && !document.querySelector('#tour-night').disabled`, {timeout: 40000});
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 5000, what: 'night'});
    const m = await p.eval('__world.minute()');
    expect(m >= 20 * 60 && m < 21 * 60, `Night moves the clock on to 20:00 (${m.toFixed(0)})`);
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'false'`, {timeout: 5000, what: 'day'});
    // The slider moves the world to 15:00: the pond's low water shows.
    await p.eval(`(()=>{const r=document.querySelector('#day-time');r.value='900';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await p.until(`!!document.querySelector('[data-incident="pond-low"]')`, {timeout: 5000, what: 'pond alert at 15:00'});
    // A moment button: 09:00, the meeting starts (the clock goes forward to it) and the camera flies there.
    await p.eval(`[...document.querySelectorAll('[data-day-event]')].find(b=>b.textContent.includes('09:00')).click()`);
    await p.until(`document.body.dataset.tourDestination === 'meeting'`, {timeout: 20000, what: 'meeting room after the 09:00 moment'});
    const at = await p.eval('__world.minute()');
    expect(at >= 540 && at < 600, `clock at the meeting (${at.toFixed(0)})`);
  }},
  {name: 'day cycle: a light switched by hand stays until the schedule changes that room', async run(p, expect) {
    await p.goto(`?dest=meeting&debug=1&speed=10&day=10&time=10:00`);
    await p.until(`${UP} && document.body.dataset.tourDestination === 'meeting' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 40000});
    const light = `__simulation().rooms.f4_meeting_2.light`;
    expect(await p.eval(light) === true, 'meeting room light on at 10:00 (schedule)');
    await p.click('[data-control="light"]');
    await p.sleep(1500); // ~30 world minutes of clock ticks
    expect(await p.eval(light) === false, 'switched off by hand, it stays off');
  }},
  {name: 'day cycle: the story holds the clock at real speed and gives it back', async run(p, expect) {
    await p.goto(parking('&day=10&time=08:00'));
    await p.until(ready, {timeout: 40000});
    await p.click('[data-bar="play"]');
    await p.until('__parking.story.running && __parking.story.index >= 1', {timeout: 30000, what: 'story step 2'});
    const a = await p.eval('__world.now()'); await p.sleep(1000); const b = await p.eval('__world.now()');
    expect((b - a) / 1000 < SPEED * 3, `world clock at real speed during the story (${((b - a) / 1000).toFixed(0)} s in 1 s at speed ${SPEED})`);
    await p.click('[data-bar="free"]');
    const c = await p.eval('__world.now()'); await p.sleep(1000); const d = await p.eval('__world.now()');
    expect((d - c) / 60000 > 20, `time-lapse again after the story (${((d - c) / 60000).toFixed(0)} min in 1 s)`);
  }},
  {name: 'day cycle: Follow the day moves the camera to what the day is doing', async run(p, expect) {
    // Speed 5: about 10 world minutes a second. The clock runs while the page loads, so the test sets 11:50 after.
    await p.goto('?debug=1&speed=5&day=10');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    await p.eval('__world.jumpTo(11*60+50)');
    await p.click('#day-play');
    expect(await p.eval(`document.querySelector('#day-play').getAttribute('aria-pressed')`) === 'true', 'following');
    await p.until(`document.body.dataset.tourDestination === 'meeting'`, {timeout: 20000, what: 'meeting room before noon'});
    await p.until(`document.body.dataset.tourDestination === 'energy'`, {timeout: 20000, what: 'the roof at noon'});
    // A drag hands the camera back to the visitor.
    await p.eval(`__controls.dispatchEvent({type:'start'});__controls.dispatchEvent({type:'end'})`);
    expect(await p.eval(`document.querySelector('#day-play').getAttribute('aria-pressed')`) === 'false', 'a drag stops following');
  }},
  {name: 'day cycle: the shadow-casting light moves smoothly all day, midnight and dusk included', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(UP, {timeout: 40000});
    // The sky for every minute of the day (and back round to 00:00), on stand-in lights: how far the light turns
    // from one minute to the next, and how low it gets.
    const r = JSON.parse(await p.eval(`(async()=>{const THREE=await import('osd/node_modules/three/build/three.module.js'),{applySky}=await import('osd/viewer/daylight.js');
      const key=new THREE.DirectionalLight(),parts={scene:{background:new THREE.Color()},renderer:{},hemisphere:new THREE.HemisphereLight(),key,fill:new THREE.DirectionalLight(),dayBackground:'#e6ecee'};
      let prev=null,worst=0,at=0,lowest=90;
      for(let m=0;m<=1440;m+=1){applySky({...parts,minute:m%1440});const d=key.position.clone().normalize();lowest=Math.min(lowest,Math.asin(d.y)*180/Math.PI);
        if(prev){const turn=prev.angleTo(d)*180/Math.PI;if(turn>worst){worst=turn;at=m;}}prev=d;}
      return JSON.stringify({worst,at,lowest});})()`));
    expect(r.worst < 1, `the light turns at most ${r.worst.toFixed(2)}° in a minute (worst at ${Math.floor(r.at / 60)}:${String(r.at % 60).padStart(2, '0')})`);
    expect(r.lowest > 15, `never lower than ${r.lowest.toFixed(1)}° (shadows of a sensible length)`);
  }},
  {name: 'pause: everything stands still (clock, cars, traffic) until resumed; the day can be made longer or shorter', async run(p, expect) {
    await p.goto(`?${FAST}&day=10&time=09:00`);
    await p.until(UP, {timeout: 40000});
    await p.until('__parking.traffic.busy || __parking.lot.root.children.some(c=>c.name==="Demo_car_"&&c.visible)', {timeout: 20000, what: 'a car on the move'});
    const cars = `JSON.stringify(__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car_')&&c.visible).map(c=>c.position.toArray().map(v=>v.toFixed(3))))`;
    // The clock's controls are there at the car park stop too (it runs on the same clock).
    await p.click('[data-destination="parking"]');
    await p.until(`__parking.active && !document.querySelector('[data-destination][aria-busy=true]') && getComputedStyle(document.querySelector('#day-pause')).display !== 'none'`, {timeout: 20000, what: 'clock controls at the car park stop'});
    await p.click('#day-pause');
    await p.sleep(100);
    const a = await p.eval('__world.now()'), carsA = await p.eval(cars); await p.sleep(1000); const b = await p.eval('__world.now()'), carsB = await p.eval(cars);
    expect(a === b, `paused: the clock stands still (${((b - a) / 60000).toFixed(1)} min in 1 s)`);
    expect(carsA === carsB, 'paused: no car moves, appears or leaves');
    expect(await p.eval(`document.querySelector('#day-pause').getAttribute('aria-pressed')`) === 'true', 'pause button pressed');
    await p.click('#day-pause');
    const c = await p.eval('__world.now()'); await p.sleep(800); const d = await p.eval('__world.now()');
    expect(d > c, 'resumed: the clock runs again');
    // The day-length button: 10 → 20 min a day halves the pace.
    await p.click('#day-speed');
    expect(await p.eval('__world.dayLength') === 20, `day length now ${await p.eval('__world.dayLength')} min`);
    // Following the day starts a paused clock again.
    await p.click('#day-pause');
    await p.click('#day-play');
    expect(!(await p.eval('__world.paused')), 'Follow the day resumes the clock');
  }},
  {name: 'day cycle: "low water" set by hand stays while the day runs on, until switched back', async run(p, expect) {
    // Real speed and a 10-minute day (about 2 world minutes a second), as at the booth: the clock's ticks used to write
    // the scheduled level back within a quarter of a second. The schedule keeps the water normal until 14:50.
    await p.goto('?dest=pond&debug=1&day=10&time=10:00');
    await p.until(`${UP} && document.body.dataset.tourDestination === 'pond' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 40000});
    await p.click('[data-action="pond"]');
    await p.until(`!!document.querySelector('[data-incident="pond-low"]')`, {timeout: 3000, what: 'low-water alert'});
    await p.sleep(2500);
    expect(await p.eval(`!!document.querySelector('[data-incident="pond-low"]')`), `still low as the day runs on (now ${await p.eval('Math.floor(__world.minute()/60)')}:${await p.eval('String(Math.floor(__world.minute()%60)).padStart(2,"0")')})`);
    // ... also past the hour a hand-set reading used to be kept for.
    await p.eval('__world.jumpTo(12*60)');
    await p.sleep(600);
    expect(await p.eval(`!!document.querySelector('[data-incident="pond-low"]')`), 'still low at noon (two hours on)');
    await p.click('[data-action="pond"]');
    await p.until(`!document.querySelector('[data-incident="pond-low"]')`, {timeout: 3000, what: 'alert cleared when switched back'});
  }},
  {name: 'meeting room: a simulated meeting can be ended (the room empties, its light and AC go off) and started again', async run(p, expect) {
    await p.goto('?dest=meeting&debug=1&day=10&time=10:00');
    await p.until(`${UP} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='meeting' && !document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'at the meeting room'});
    const room = `__simulation().rooms.f4_meeting_2`;
    if (await p.eval(`!!document.querySelector('[data-action="meeting"]')`)) await p.click('[data-action="meeting"]');
    await p.until(`!!document.querySelector('[data-action="meeting-end"]') && ${room}.light`, {timeout: 3000, what: 'a meeting under way'});
    // The seat markers' opacity on every frame (0 while hidden).
    await p.eval(`(()=>{let dot=null;__scene.getObjectByName('Demo_meeting').traverse(o=>{if(o.geometry?.parameters?.innerRadius===.11)dot=o;});window.__seats=[];
      const f=()=>{let shown=true;for(let o=dot;o;o=o.parent)if(!o.visible)shown=false;__seats.push(shown?dot.material.opacity:0);if(__seats.length<240)requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    await p.click('[data-action="meeting-end"]');
    await p.until(`!!document.querySelector('[data-action="meeting"]')`, {timeout: 3000, what: 'the button offers a meeting again'});
    const ended = await p.eval(`({light:${room}.light,climate:${room}.climate})`);
    expect(!ended.light && !ended.climate, `ending it switches the room's light and AC off (light ${ended.light}, AC ${ended.climate})`);
    await p.sleep(2500); // about 5 world minutes at this day length
    const seats = await p.eval('__seats'), full = Math.max(...seats);
    let step = 0; for (let i = 1; i < seats.length; i++) step = Math.max(step, Math.abs(seats[i] - seats[i - 1]));
    expect(full > .3 && seats.at(-1) === 0, `the seat markers go (from ${full.toFixed(2)} to ${seats.at(-1)})`);
    expect(step < full * .5, `they fade out (largest change in one frame ${(step / full * 100).toFixed(0)}% of full)`);
    expect(await p.eval(`!!document.querySelector('[data-action="meeting"]') && !${room}.light`), 'the room stays empty as the day runs on');
    await p.click('[data-action="meeting"]');
    await p.until(`!!document.querySelector('[data-action="meeting-end"]') && ${room}.light && ${room}.climate`, {timeout: 3000, what: 'a new meeting: light and AC back on'});
  }},
  {name: 'day cycle: the explore page follows the building schedule (offices dark at night), and no solar demo at night', async run(p, expect) {
    const lit = `Object.values(__simulation().rooms).filter(r=>r.light).length`;
    // The page is ready before its car park (and with it the schedule) loads: wait for the rooms to follow.
    await p.goto('?debug=1&time=22:00#explore');
    await p.until(`document.querySelector('#status')?.dataset.state === 'ready' && !!window.__simulation && ${lit} <= 2`, {timeout: 40000, what: 'offices dark at 22:00 on the explore page'});
    await p.goto('?debug=1&time=10:00#explore');
    await p.until(`document.querySelector('#status')?.dataset.state === 'ready' && !!window.__simulation && ${lit} > 10`, {timeout: 40000, what: 'offices lit at 10:00 on the explore page'});
    await p.goto(`?dest=energy&${FAST}&time=22:00`);
    await p.until(`${UP} && document.body.dataset.tourDestination === 'energy' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 40000});
    expect(await p.eval(`document.querySelector('[data-action="energy"]').disabled`), 'the solar demo button is off at night');
  }},
  {name: 'day cycle: visitors with a pass for today drop in during the day, and leave by themselves', async run(p, expect) {
    // Speed 30, 10-minute day: about half an hour of world time a second; visitors come 09:30–15:30.
    await p.goto(parking('&day=10&time=09:30'));
    await p.until(ready, {timeout: 40000});
    const t0 = await p.eval('__world.now()');
    const visitor = `__parking.sim.state.events.find(e=>e.at>=${t0}&&e.kind==='entry'&&e.type==='guest')`;
    await p.until(`!!${visitor}`, {timeout: 20000, what: 'a visitor driving in during the morning'});
    const plate = await p.eval(`${visitor}.plate`);
    await p.until(`__parking.sim.state.events.some(e=>e.at>=${t0}&&e.kind==='exit'&&e.plate===${JSON.stringify(plate)})`, {timeout: 20000, what: `visitor ${plate} leaving after the visit`});
    expect(true, `visitor ${plate} came and went`);
  }},
  {name: 'day cycle: the explore page follows the clock too (night at 20:00)', async run(p, expect) {
    await p.goto('?debug=1&day=10&time=20:00#explore');
    await p.until(`document.querySelector('#status')?.dataset.state === 'ready'`, {timeout: 40000});
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 5000, what: 'night on the explore page'});
    expect(true, 'explore page is dark at 20:00');
  }},
];
