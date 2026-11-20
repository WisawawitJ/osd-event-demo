// Behaviour checks for the demo, run by test/run.mjs. Pages load with ?speed=SPEED (default 30: demo timing 30× faster).
const SPEED = Number(process.env.SPEED) || 30;
const FAST = `debug=1&speed=${SPEED}`;
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
    // A specific car, so background traffic in the same lot cannot be mistaken for it.
    const key = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province)));void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-50});return __parking.sim.key(v.plate,v.province)})()`);
    await p.until(`__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 30000, what: 'entry recorded'});
    await p.until(`!__parking.traffic.isArriving(${JSON.stringify(key)})`, {timeout: 30000, what: 'car parked'});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const pr=__parking.sim.state.presence.get(${JSON.stringify(key)});return {entry:__parking.sim.state.events.some(e=>e.kind==='entry'&&__parking.sim.key(e.plate,e.province)===${JSON.stringify(key)}),stall:__parking.sim.state.stalls.find(s=>s.id===pr.stallId)?.occupant===${JSON.stringify(key)}}})())`));
    expect(r.entry, 'entry event logged for the car');
    expect(r.stall, 'its bay is marked occupied');
  }},

  {name: 'unknown car: Open once disabled while waiting; Open with a reason is audited', async run(p, expect) {
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

  {name: 'full car park turns a car away', async run(p, expect) {
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
  }},

  {name: 'kiosk loop runs the parking story; a touch pauses it', async run(p, expect) {
    await p.goto(`?kiosk=1&${FAST}`);
    await p.until('window.__parking && __parking.story.running', {timeout: 60000, what: 'loop reaches the parking story'});
    await p.eval(`document.querySelector('#viewport').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.sleep(300);
    expect(!(await p.eval('__parking.story.running')), 'touch stopped the story');
  }},

  {name: 'kiosk recovers from an idle guided story', async run(p, expect) {
    // speed 10, not 30: the 60 s idle timeout becomes 6 s, enough room for the setup taps below under load.
    await p.goto('?kiosk=1&debug=1&speed=10');
    await p.until('window.__parking && document.querySelector("#kiosk-toggle").checked', {timeout: 40000});
    await p.click('#viewport');
    await p.click('[data-destination="parking"]');
    await p.until('__parking.active', {timeout: 30000});
    if (await p.eval(`document.querySelector('[data-bar="auto"]').checked`)) await p.click('[data-bar="auto"]');
    await p.click('[data-bar="play"]');
    await p.until('__parking.story.waitingForNext', {timeout: 30000, what: 'guided story waiting'});
    await p.until(`document.body.dataset.tourDestination !== 'parking' || (__parking.story.running && __parking.story.auto)`, {timeout: 20000, what: 'loop takes over (60 s / 10)'});
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

  {name: 'night: switching the meeting-room light changes only that room', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until("document.querySelector('#status')?.dataset.state === 'ready' && !!window.__parking", {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="meeting"]');
    await p.until("document.body.dataset.tourDestination === 'meeting'", {timeout: 20000});
    await p.click('#tour-night');
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 10000});
    const spots = `JSON.stringify(__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.visible).map(l=>[l.userData.roomId,l.position.x.toFixed(1),l.position.z.toFixed(1),l.intensity]))`;
    const before = JSON.parse(await p.eval(spots));
    await p.click('[data-control="light"]');
    await p.sleep(300);
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
  {name: 'meeting room: effects show after arriving by the dock, and the light switch is visible', async run(p, expect) {
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
    await p.until(`Math.abs(window.__exitCar.position.z-16.6)<.05&&Math.abs(window.__exitCar.position.x+20.2)<.05`, {timeout: 15000, what: 'car at the exit barrier'});
    const t0 = Date.now();
    await p.until(`__parking.sim.state.gate !== 'closed' || !__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 15000, what: 'barrier opening'});
    const waited = (Date.now() - t0) * 10 / 1000;
    expect(waited < 8, `barrier opens within 8 s of demo time, plate read included (waited ${waited.toFixed(1)} s)`);
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
  {name: 'visitor flow as in the real app: a confirmation, then the decision by email only', async run(p, expect) {
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
];
