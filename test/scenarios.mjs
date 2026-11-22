// Behaviour checks for the demo, run by test/run.mjs. Pages load with ?speed=SPEED (default 30: demo timing 30× faster).
import {STREET, GATE, ENTRY_TURN} from '../src/parking/layout.js';
const SPEED = Number(process.env.SPEED) || 30;
// The first queue place on the near lane (as traffic.js: clear of a car backing out of the entrance road), 6.5 m apart.
const QUEUE_HEAD = GATE.entryX - ENTRY_TURN - 2.23 - .8 - 2.2;
// FAST skips the loading screen's shader warm-up; FASTW keeps it, for checks that wait for it or measure smoothness.
const FASTW = `debug=1&speed=${SPEED}`;
const FAST = `${FASTW}&warm=0`;
const parking = (extra = '') => `?dest=parking&${FAST}${extra}`;
// The explore page. `explore=1` (read by nothing) makes the URL differ from the showcase's `?${FAST}` by more than
// the hash: a hash-only change is a same-page navigation, and boot.js picks the page only when it loads.
const EXPLORE = `?explore=1&${FAST}#explore`;
const ready = 'window.__parking && window.__parking.active';
// The model is loaded (either page); the showcase is up (any stop); no stop is loading and the camera is not flying.
const LOADED = "document.querySelector('#status')?.dataset.state === 'ready'";
const UP = `${LOADED} && !!window.__parking`;
const STILL = "!document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')";
const IDLE = `${UP} && ${STILL}`;
const VISITOR = 'ชูใจ ใฝ่รู้', STORY_PLATE = '7กข 4821';
const STORY_REQUEST = `__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)})`;
// Sends a parked staff car out; returns its key.
// (With none parked it threw nothing and returned undefined, and checks waiting for that key to leave passed at once.)
const LEAVE_STAFF = `(()=>{const k=__parking.traffic.parkedKeys().find(k=>__parking.sim.state.presence.get(k)?.type==='staff');if(!k)throw new Error('no staff car parked');void __parking.traffic.leave(k);return k})()`;
// The car park's own comings and goings stopped, and the gate quiet, so a check's cars are the only ones (at 06:00 a
// background far-lane car could still turn in first, as it should, and spoil the timing). `plates`: those let in.
const ONLY = plates => `(async()=>{const t=__parking.traffic,arrive=t.arrive,ok=new Set(${JSON.stringify(plates)});t.passBy=()=>false;t.__leave=t.leave;t.leave=()=>Promise.resolve();
  t.arrive=o=>ok.has(o.plate)?arrive(o):Promise.resolve('blocked');
  for(let i=0;i<400;i++){const s=t.inspect();if(!s.entryPending&&!s.westOnStreet&&!s.outbound&&!s.gateHolders&&!t.leaving&&__parking.sim.state.gate==='closed')return true;await new Promise(r=>setTimeout(r,50))}return false})()`;
// The ground point under a cursor 60% down the view: how far it slides on screen with four wheel notches toward it.
const DRIFT = `(()=>{__camera.updateMatrixWorld();const c=document.querySelector('#viewport canvas'),r=c.getBoundingClientRect(),V=__camera.position.constructor,nx=0,ny=-.6;
      const ground=()=>{const a=new V(nx,ny,.5).unproject(__camera),d=a.sub(__camera.position).normalize(),t=-__camera.position.y/d.y;return __camera.position.clone().addScaledVector(d,t)};
      const p0=ground();for(let i=0;i<4;i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width*(nx+1)/2,clientY:r.top+r.height*(1-ny)/2,deltaY:-100,deltaMode:0}));
      __controls.update();__camera.updateMatrixWorld();const q=p0.clone().project(__camera);return Math.hypot((q.x-nx)*r.width/2,(q.y-ny)*r.height/2)})()`;
const viewport = (p, width = 1600, height = 1000) => p.cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});

export const scenarios = [
  {name: 'a story left after its visitor parked lets that car leave once its visit is over', async run(p, expect) {
    // Left between steps 6 and 10, the story's visitor stayed parked for the rest of free play.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    const key = `__parking.sim.key(${JSON.stringify(STORY_PLATE)},${STORY_REQUEST}?.province)`;
    await p.until(`__parking.sim.state.presence.has(${key}) && !__parking.traffic.isArriving(${key})`, {timeout: 60000, what: 'the story visitor parked'});
    await p.eval(`(()=>{window.__k=${key};__parking.story.stop();__world.jumpTo(__world.minute()+240)})()`);
    await p.until('!__parking.sim.state.presence.has(__k)', {timeout: 30000, what: 'the visitor gone after its visit'});
    expect(true, 'the story visitor left');
  }},
  {quick: true, name: 'story plays end to end on auto-advance', async run(p, expect) {
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    await p.until('!__parking.story.running', {timeout: 90000, what: 'story end'});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const s=__parking.sim.state;const ev=s.events.filter(e=>e.plate===${JSON.stringify(STORY_PLATE)});return {status:${STORY_REQUEST}?.status,entry:ev.some(e=>e.kind==='entry'),exit:ev.some(e=>e.kind==='exit'),denied:s.events.some(e=>e.kind==='denied'&&e.plate==='2ฒษ 9077')}})())`));
    expect(r.status === 'approved', `visitor request approved (got ${r.status})`);
    expect(r.entry && r.exit, 'visitor car entered and left');
    expect(r.denied, 'unknown car was denied');
  }},

  {name: 'the Gate tab\'s test cars are off while the story plays, on again after', async run(p, expect) {
    // An Unknown car sent during the story got into its steps: step 7 denied the visitor's car in the stray's place, and
    // the story's own unknown car then held the barrier unanswered.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    await p.until(`__parking.story.index===5 && document.querySelector('[data-sim="unknown"]')`, {timeout: 60000, what: 'step 6 with the Gate tab'});
    const off = await p.eval(`[...document.querySelectorAll('[data-sim]')].every(b=>b.disabled)`);
    const alerts = await p.eval('__parking.sim.state.alerts.length');
    await p.eval(`document.querySelector('[data-sim="unknown"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    await p.sleep(1500);
    const strays = await p.eval(`__parking.sim.state.alerts.filter(a=>a.plate!==${JSON.stringify(STORY_PLATE)}&&a.plate!=='2ฒษ 9077').length`);
    expect(off && strays === 0, `test cars off during the story (disabled ${off}, ${strays} stray alerts of ${alerts})`);
    await p.click('[data-bar="free"]');
    await p.until(`!__parking.story.running`, {timeout: 5000, what: 'free play'});
    await p.click('[data-tab="gate"]');
    expect(await p.eval(`[...document.querySelectorAll('[data-sim]')].every(b=>!b.disabled)`), 'on again in free play');
  }},
  {name: 'story: unticking Auto-advance at the Approve cue leaves the approval to the presenter', async run(p, expect) {
    // It approved anyway some 2.6 s later: Auto was read once, when the cue went up.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    // At once when the cue lights (at speed 30 the auto pause is under 0.1 s).
    await p.eval(`new MutationObserver((m,o)=>{if(document.querySelector('[data-act="approve"][data-cue="true"]')){__parking.story.setAuto(false);o.disconnect()}}).observe(document.body,{subtree:true,childList:true,attributes:true})`);
    await p.until('!__parking.story.auto', {timeout: 60000, what: 'the approve cue'});
    await p.sleep(1500);
    const before = await p.eval(`${STORY_REQUEST}?.status`);
    expect(before === 'pending' && await p.eval('__parking.story.waitingForNext'), `still pending, waiting for Next (${before})`);
    await p.click('[data-bar="next"]');
    await p.until(`${STORY_REQUEST}?.status==='approved'`, {timeout: 5000, what: 'Next approving'});
  }},
  {name: 'guided story: a tap on the cued Send, New request on the phone and a language switch keep the story whole', async run(p, expect) {
    // The cued Send sent the request twice (a new receipt, a random colour); New request left step 5's ticket caption
    // over an empty form; the step 4 hint stayed in Thai after a switch to English.
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    // Sends of the visitor's request (a repeat merges into the first, so the list alone shows one either way).
    await p.eval(`(()=>{window.__sends=0;__parking.sim.subscribe((k,q)=>{if(k==='request'&&q?.visitor?.name===${JSON.stringify(VISITOR)}&&q.status==='pending')__sends++})})()`);
    await p.until('__parking.story.waitingForNext', {timeout: 30000, what: 'step 1'}); await p.click('[data-bar="next"]');
    // Tapped the moment it lights (it is lit for 0.9 s, some 30 ms at speed 30).
    await p.eval(`new MutationObserver((m,o)=>{const b=document.querySelector('[data-ph="submit"][data-cue="true"]');if(b){o.disconnect();window.__tapped=true;b.click()}}).observe(document.body,{subtree:true,childList:true,attributes:true})`);
    await p.until('window.__tapped', {timeout: 30000, what: 'the Send cue'});
    await p.until('__parking.story.index===1 && __parking.story.waitingForNext', {timeout: 30000, what: 'request sent'});
    const sent = JSON.parse(await p.eval(`JSON.stringify(__parking.sim.state.requests.filter(q=>q.visitor.name===${JSON.stringify(VISITOR)}).map(q=>q.color))`));
    const sends = await p.eval('__sends');
    expect(sent.length === 1 && sent[0] === 4 && sends === 1, `sent once, in the story's colour (${sends} sends, colours ${JSON.stringify(sent)})`);
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===2 && __parking.story.waitingForNext', {timeout: 30000, what: 'step 3'});
    await p.click('[data-ph="new"]');
    await p.click('[data-bar="next"]');
    await p.until(`document.querySelector('.pk-caption-hint')`, {timeout: 30000, what: 'the step 4 hint'});
    await p.click('#lang-toggle');
    await p.until(`document.documentElement.lang==='en'`, {timeout: 3000, what: 'the page in English'});
    const hint = await p.eval(`document.querySelector('.pk-caption-hint')?.textContent`);
    expect(/Approve/.test(hint), `the hint in English too (${hint})`);
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===3 && __parking.story.waitingForNext', {timeout: 30000, what: 'approved'});
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===4 && __parking.story.waitingForNext', {timeout: 30000, what: 'step 5'});
    expect(await p.eval(`!!document.querySelector('#pk-phone .ph-ticket')`), 'the phone shows the ticket at step 5');
    const toasts = await p.eval(`[...document.querySelectorAll('.pk-toast')].map(t=>t.textContent).join(' | ')`);
    expect(/Ticket emailed/.test(toasts), `the ticket email's toast (${toasts})`);
  }},
  {name: 'story Pause stops the phone typing; unticking Auto-advance while paused leaves Next working', async run(p, expect) {
    // Paused, the phone typed on; with Auto-advance then off, the bar had Next but no Resume and the step stood still.
    await p.goto(parking('&story=1'));
    await p.until(`window.__parking && __parking.story.running && document.querySelector('#pk-phone input[name=name]')?.value.length>2`, {timeout: 40000, what: 'step 1 typing'});
    await p.click('[data-bar="pause"]');
    const typed = () => p.eval(`['name','email','contact','company','phone'].reduce((n,f)=>n+(document.querySelector('#pk-phone input[name='+f+']')?.value.length||0),0)`);
    const a = await typed(); await p.sleep(800); const b = await typed();
    expect(b - a <= 1, `no typing while paused (${a} -> ${b} characters)`);
    await p.eval('__parking.story.setAuto(false)');
    expect(!await p.eval('__parking.story.paused'), 'unpaused with Auto-advance off (no Resume on the bar then)');
    await p.until('__parking.story.index===0 && __parking.story.waitingForNext', {timeout: 30000, what: 'step 1 done, waiting for Next'});
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===1', {timeout: 5000, what: 'Next moving on'});
  }},
  {name: 'story on auto-advance: a console tap early on does not slow the later cues', async run(p, expect) {
    // Touches were counted for the whole page: one tap at step 1 made every later cue wait 6 s, not 2.6.
    await p.goto('?dest=parking&debug=1&speed=5&warm=0&story=1');
    await p.until('window.__parking && __parking.story.running && __parking.story.index===0', {timeout: 40000});
    await p.eval(`document.querySelector('#parking-panel').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.eval(`new MutationObserver((m,o)=>{if(document.querySelector('[data-act="approve"][data-cue="true"]')){o.disconnect();window.__cueAt=performance.now()}}).observe(document.body,{subtree:true,childList:true,attributes:true})`);
    await p.eval(`__parking.sim.subscribe((k,q)=>{if(k==='request'&&q?.status==='approved'&&!window.__approvedAt)window.__approvedAt=performance.now()})`);
    await p.until('window.__cueAt', {timeout: 60000, what: 'the Approve cue'});
    await p.until('window.__approvedAt', {timeout: 10000, what: 'approved'});
    const after = await p.eval('(__approvedAt-__cueAt)*5/1000');
    expect(after < 4.5, `approved ${after.toFixed(1)} s (demo) after the cue, not the 6 s a touch during it gives`);
  }},
  {name: 'a story left at step 7 lets its unknown car go like a background one, not after 45 s', async run(p, expect) {
    // Its car stood at the barrier for the 45 s a presenter's own car gets, holding up every car behind it.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='2ฒษ 9077')`, {timeout: 90000, what: 'step 7\'s alert'});
    await p.click('[data-bar="free"]');
    await p.sleep(800); // 24 s of demo time
    const status = await p.eval(`__parking.sim.state.alerts.find(a=>a.plate==='2ฒษ 9077')?.status`);
    expect(status === 'denied', `its alert answered within the background car's 8 s (${status})`);
  }},
  {name: 'a story left before its unknown car reaches the barrier: that car is a background one (8 s, console left alone)', async run(p, expect) {
    // Its alert came after the story had stopped: it got a presenter's 45 s and switched the console to the Gate tab.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running && __parking.story.index===6 && !__parking.sim.state.alerts.some(a=>a.plate===\'2ฒษ 9077\')', {timeout: 90000, what: 'step 7, its car on the way'});
    await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await p.click('[data-tab="vehicles"]');
    await p.until(`__parking.sim.state.alerts.some(a=>a.plate==='2ฒษ 9077')`, {timeout: 20000, what: 'its car at the barrier'});
    const r = JSON.parse(await p.eval(`JSON.stringify({ambient:__parking.sim.state.alerts.find(a=>a.plate==='2ฒษ 9077').ambient,tab:document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab})`));
    expect(r.ambient === true && r.tab === 'vehicles', `a background car, the console left on its tab (ambient ${r.ambient}, tab ${r.tab})`);
  }},
  {name: 'guided story: Free play at the approve cue does not approve', async run(p, expect) {
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    for (let i = 0; i < 3; i++) { await p.until('__parking.story.waitingForNext', {timeout: 30000, what: `Next #${i + 1}`}); await p.click('[data-bar="next"]'); }
    await p.until(`document.querySelector('[data-act="approve"][data-cue="true"]')`, {timeout: 30000, what: 'approve cue'});
    await p.click('[data-bar="free"]');
    await p.sleep(300);
    const status = await p.eval(`${STORY_REQUEST}?.status`);
    expect(status === 'pending', `request stays pending (got ${status})`);
  }},

  {name: 'the car park\'s catch-up after the 03:00 wrap logs today, not tomorrow', async run(p, expect) {
    // The wrap moved the log back a day but not the car park's last look: the next catch-up spread its departures
    // between that (a day ahead) and now, logging them a day in the future.
    // At the meeting room: the car park is hidden, so its catch-up does the coming and going.
    await p.goto(`?dest=meeting&${FAST}&time=23:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting' && !__parking.lot.root.visible`, {timeout: 40000, what: 'at the meeting room, the car park hidden'});
    // Extra cars in the hidden car park as the day wraps, for the first look after it to take away.
    await p.eval(`(()=>{window.__wrapped=-1;const off=__world.subscribe(kind=>{if(kind!=='wrap')return;off();const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));
      for(const v of sim.state.vehicles.filter(v=>v.type==='staff'&&!inside.has(v.id)).slice(0,8)){const s=sim.freeStall('staff');if(!s)break;sim.recordEntry({plate:v.plate,province:v.province,type:'staff',stallId:s.id,color:v.color});__parking.traffic.appear(sim.key(v.plate,v.province));}
      window.__wrapped=sim.state.events.filter(e=>e.kind==='exit').length;});__world.jumpTo(2*60+59);})()`);
    const exits = `__parking.sim.state.events.filter(e=>e.kind==='exit')`;
    await p.until(`__wrapped>=0 && ${exits}.length>__wrapped`, {timeout: 20000, what: 'departures logged after the wrap'});
    const ahead = await p.eval(`${exits}.filter(e=>e.at>__world.now()+60e3).length`);
    expect(ahead === 0, `no departure logged in the future (${ahead})`);
  }},
  {name: 'opened before 09:00, the car park holds the cars its log says are in', async run(p, expect) {
    // The seeded morning is 09:00's. Opened earlier, the log lost the later exits but the car park still lacked the
    // cars that made them: at 08:00 the log said 14 in and none out with 10 parked.
    await p.goto(`?dest=meeting&${FAST}&time=08:00`);
    await p.until(UP, {timeout: 40000, what: 'model ready'});
    await p.eval('__world.setPaused(true)');
    const r = JSON.parse(await p.eval(`(()=>{const s=__parking.sim.state,n=k=>s.events.filter(e=>e.kind===k).length;return JSON.stringify({entries:n('entry'),exits:n('exit'),parked:s.presence.size,bays:s.stalls.filter(b=>b.occupant).length});})()`));
    expect(r.parked === r.entries - r.exits && r.bays === r.parked, `${r.entries} in, ${r.exits} out: ${r.parked} parked in ${r.bays} bays`);
  }},
  {name: 'opened before 08:31, the seeded visitor request is not in yet', async run(p, expect) {
    // The seeded morning's pending request is made at 08:31; opened earlier it was already waiting, and approving it
    // logged a decision before the request.
    await p.goto(parking('&time=07:40'));
    await p.until(ready, {timeout: 40000});
    const early = await p.eval(`__parking.sim.state.requests.filter(q=>q.createdAt>__world.now()).length`);
    expect(early === 0, `no request from the future (${early})`);
  }},
  {name: 'after midnight, the hourly chart counts what the totals count', async run(p, expect) {
    // Until the day wraps at 03:00, entries after midnight counted in the totals but had no hour in the chart.
    await p.goto(parking('&time=23:00'));
    await p.until(ready, {timeout: 40000});
    await p.eval('__world.setPaused(true)');
    await p.eval('__world.jumpTo(40)');
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&!inside.has(v.id));const s=sim.freeStall('staff');sim.recordEntry({plate:v.plate,province:v.province,type:'staff',stallId:s.id,color:v.color});})()`);
    const r = JSON.parse(await p.eval(`(()=>{const s=__parking.sim.stats();return JSON.stringify({entries:s.entries,charted:s.hourly.reduce((n,h)=>n+(h.in||0),0)});})()`));
    expect(r.charted === r.entries, `${r.charted} charted of ${r.entries} entries`);
  }},
  {name: 'a jump past midnight finds the VIPs gone home', async run(p, expect) {
    // VIPs could leave only from 16:30 by the hour reached: a jump from 10:00 to 01:00 left all three parked all night.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting' && !__parking.lot.root.visible`, {timeout: 40000, what: 'at the meeting room, the car park hidden'});
    const vips = `[...__parking.sim.state.presence.values()].filter(p=>p.type==='vip').length`;
    const before = await p.eval(vips);
    await p.eval('__world.jumpTo(60)');
    const after = await p.eval(vips);
    // Not always none: a VIP still driving in at the jump parks after it.
    expect(before > 0 && after < before, `VIPs parked ${before} -> ${after} after the night`);
  }},
  {name: 'the report\'s peak counts the cars parked overnight', async run(p, expect) {
    // The 03:00 wrap moves the night's entries into yesterday while their cars stay: the peak, counted from zero
    // through today's entries and exits, came out blank or too low.
    await p.goto(parking('&time=23:00'));
    await p.until(ready, {timeout: 40000});
    await p.eval('__world.setPaused(true)');
    await p.eval('__world.jumpTo(3*60+5)');
    const s = JSON.parse(await p.eval(`JSON.stringify((({parked,peak,peakAt})=>({parked,peak,peakAt}))(__parking.sim.stats()))`));
    expect(s.parked > 0 && s.peak >= s.parked && s.peakAt, `peak ${s.peak} (at ${s.peakAt}) with ${s.parked} cars parked`);
  }},
  {name: 'a car still driving to its bay is not sent out again', async run(p, expect) {
    // A jump made a just-arrived visitor's stay look over while it was still on its way to its bay: its exit set off
    // from the bay at once, and two routes moved the same car.
    await p.goto(parking('&time=10:00'));
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(sim.key(v.plate,v.province)));
      window.__k=sim.key(v.plate,v.province);void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-40});})()`);
    await p.until(`__parking.sim.state.presence.has(__k) && __parking.traffic.isArriving(__k)`, {timeout: 30000, what: 'the car through the barrier, on its way to its bay'});
    expect(await p.eval('__parking.traffic.leave(__k)') === false, 'leave() turns it down while it drives in');
    expect(!(await p.eval('__parking.traffic.parkedKeys().includes(__k)')), 'nor is it offered as parked (to Exit)');
    await p.until('!__parking.traffic.isArriving(__k)', {timeout: 30000, what: 'parked'});
    expect(await p.eval('__parking.traffic.leave(__k).then(()=>true)') === true, 'and sends it once parked');
  }},
  {name: 'Vehicles: a row keeps its vehicle when the list reorders', async run(p, expect) {
    // Rows were reused by position: when a retried vehicle synced and moved down the list, the row (and a focused
    // button in it) went on to stand for another vehicle; pressing Disable there disabled that one.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="vehicles"]');
    await p.until(`!!document.querySelector('.pk-vrow [data-retry]')`, {timeout: 5000, what: 'a vehicle whose sync failed'});
    const who = `r.querySelector('.pk-row-main').firstElementChild.textContent`;
    await p.eval(`document.querySelectorAll('.pk-vrow').forEach(r=>r.__id=${who})`);
    // A button in a row below the retried one (which moves up as that one moves down) has the focus.
    await p.eval(`(()=>{const rows=[...document.querySelectorAll('.pk-vrow')],i=rows.findIndex(r=>r.querySelector('[data-retry]'));window.__f=rows.slice(i+1).map(r=>r.querySelector('button')).find(Boolean);__f.focus();})()`);
    await p.click('.pk-vrow [data-retry]');
    await p.until(`!document.querySelector('.pk-vrow [data-retry]')`, {timeout: 5000, what: 'the retried vehicle synced'});
    await p.sleep(300);
    const moved = await p.eval(`[...document.querySelectorAll('.pk-vrow')].filter(r=>r.__id&&r.__id!==${who}).length`);
    expect(moved === 0, `every kept row still stands for its vehicle (${moved} switched)`);
    expect(await p.eval('document.activeElement===__f'), 'the focused button keeps the focus as its row moves');
  }},
  {name: 'an unknown car let in by hand can leave', async run(p, expect) {
    // Only staff (and late VIP) cars were picked to leave: a delivery let in through an unknown-plate alert stayed
    // parked for good, and with only it parked, Exit did nothing.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="gate"]');
    const left = await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic;
      for(const k of t.parkedKeys()){const q=sim.state.presence.get(k);t.vanish(k,()=>sim.recordExit({plate:q.plate,province:q.province}));}
      const s=sim.freeStall('staff');sim.recordEntry({plate:'3ฆง 6047',province:'ชลบุรี',type:'unknown',stallId:s.id,color:6,manual:{by:'staff.guard',reason:'gate.reason.delivery'}});
      const k=sim.key('3ฆง 6047','ชลบุรี');t.appear(k);const listed=t.parkedKeys().includes(k);document.querySelector('[data-sim="exit"]').click();return listed&&!t.parkedKeys().includes(k);})()`);
    expect(left, 'Exit sent the only parked car, the unknown one (parked first), on its way out');
  }},
  {name: 'the timeline\'s current minute is now, not a day ahead', async run(p, expect) {
    // At 15:00:20 the 15:00 moment counted as a day ahead: the jump ran the logs through a whole day.
    await p.goto(parking('&time=15:00'));
    await p.until(ready, {timeout: 40000});
    // (The clock reads the same either way: a day ahead wraps back at 03:00. The jump itself is the harm.)
    const seen = await p.eval(`(()=>{const seen=[],off=__world.subscribe(k=>{if(k!=='tick')seen.push(k);});__world.jumpTo(Math.floor(__world.minute()));off();return seen.join(',');})()`);
    expect(!seen, `jumping to the minute it is changed nothing (${seen || 'no events'})`);
    // The next minute is a few seconds on, not out of reach (the slider's Arrow Right step snapped back).
    const next = await p.eval(`(()=>{const m=Math.floor(__world.minute())+1;__world.jumpTo(m);return Math.floor(__world.minute())-m;})()`);
    expect(next === 0, `jumping to the next minute got there (${next} min off)`);
  }},
  {name: 'the plate camera\'s picture stays up while paused', async run(p, expect) {
    // Its dismissal ran on wall-clock time: paused as a car cleared the barrier, the picture went anyway.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Only this car (another closing the barrier first paused the world at the wrong moment).
    const plate = await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));return __parking.sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province))).plate})()`);
    expect(await p.eval(ONLY([plate])), 'the car park quiet first');
    await p.eval(`(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province)));
      window.__k=__parking.sim.key(v.plate,v.province);void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-40});})()`);
    // Paused as the arm starts down behind the car: past the gate, so the picture's dismissal is already counting.
    await p.eval(`(()=>{const sim=__parking.sim,set=sim.setGate;sim.setGate=g=>{set(g);if(g==='closing'&&sim.state.presence.has(__k)){sim.setGate=set;__world.setPaused(true);window.__feedUp=!document.querySelector('.pk-feed').hidden;}};})()`);
    await p.until('__world.paused', {timeout: 30000, what: 'the car past the barrier'});
    expect(await p.eval('__feedUp'), 'the camera picture was up as the car went through');
    await p.sleep(4000);
    expect(!(await p.eval(`document.querySelector('.pk-feed').hidden`)), 'still up after 4 s paused');
    await p.eval('__world.setPaused(false)');
  }},
  {name: 'Car leaving sends out a parked visitor too', async run(p, expect) {
    // The button shared the background's choice of leavers, which never takes visitors: with only a visitor parked,
    // it did nothing, and a request's visit could not be ended by hand.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="gate"]');
    const left = await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic;
      for(const k of t.parkedKeys()){const q=sim.state.presence.get(k);t.vanish(k,()=>sim.recordExit({plate:q.plate,province:q.province}));}
      const v=sim.state.vehicles.find(v=>v.type==='guest'&&!sim.state.presence.has(sim.key(v.plate,v.province)));const s=sim.freeStall('guest');
      sim.recordEntry({plate:v.plate,province:v.province,type:'guest',stallId:s.id,color:v.color});const k=sim.key(v.plate,v.province);t.appear(k);
      const listed=t.parkedKeys().includes(k);document.querySelector('[data-sim="exit"]').click();return listed&&!t.parkedKeys().includes(k);})()`);
    expect(left, 'Car leaving sent the only parked car, a visitor\'s (parked first), on its way out');
  }},
  {name: 'opened late in the day, the car park is that hour\'s at once', async run(p, expect) {
    // Every start after 09:00 began from the seeded morning: at 23:00, 27 cars stood in the bays and drove out
    // through the barrier one by one.
    await p.goto(parking('&time=23:00'));
    await p.until(ready, {timeout: 40000});
    const parked = await p.eval('__parking.sim.state.presence.size');
    expect(parked <= 6, `${parked} cars parked at 23:00 (the evening's few)`);
  }},
  {name: 'Staff car sends a staff car, never a VIP', async run(p, expect) {
    // The button shared the background's pool of arrivals, which takes VIPs in the morning.
    await p.goto(parking('&time=09:00'));
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="gate"]');
    // No staff car free to come: the button has nobody to send (a VIP would have been sent instead).
    // Counted before and after the press: background traffic may already be bringing a VIP in.
    const sent = await p.eval(`(()=>{const sim=__parking.sim;for(const v of sim.state.vehicles)if(v.type==='staff')v.enabled=false;
      const vips=()=>sim.state.vehicles.filter(v=>v.type==='vip'&&__parking.traffic.isArriving(sim.key(v.plate,v.province))).length,before=vips();
      document.querySelector('[data-sim="registered"]').click();return vips()-before;})()`);
    expect(sent === 0, `no VIP sent for Staff car (${sent})`);
  }},
  {name: 'Vehicles lists every vehicle', async run(p, expect) {
    // It showed the first 60 only, without saying so: a staff car added by hand dropped out once it synced.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="vehicles"]');
    const r = JSON.parse(await p.eval(`JSON.stringify({rows:document.querySelectorAll('.pk-vrow').length,all:__parking.sim.state.vehicles.length})`));
    expect(r.rows === r.all, `${r.rows} rows for ${r.all} vehicles`);
  }},
  {name: 'a car from the far lane waits to turn, signalling right, and turns in across the near lane', async run(p, expect) {
    // Every car used to come along the near lane; none turned in from the far one.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      window.__k=sim.key(v.plate,v.province);window.__plate=v.plate;window.__right=false;window.__farLane=false;window.__early=null;
      const t=setInterval(()=>{const c=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__plate);if(!c)return;if(Math.abs(c.position.z-${STREET.laneWest})<.3)__farLane=true;if(c.getObjectByName('Demo_car_blinker_right')?.visible){__right=true;if(c.position.x>20)__early=c.position.x;}if(__parking.sim.state.presence.has(__k))clearInterval(t);},20);
      void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,west:true});})()`);
    await p.until('__parking.sim.state.presence.has(__k)', {timeout: 30000, what: 'the far-lane car through the barrier'});
    expect(await p.eval('__farLane'), 'it came along the far lane');
    expect(await p.eval('__right'), 'its right blinker flashed before the turn');
    expect(await p.eval('__early') === null, `not while still far from the turn (lit at x ${await p.eval('__early')})`);
  }},
  {name: 'a car leaving for the far lane signals right and turns out across the near lane', async run(p, expect) {
    // Every car left along the near lane; none turned out to the far one.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic,k=t.parkedKeys().find(k=>sim.state.presence.get(k)?.type==='staff');window.__k=k;
      const c=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+sim.state.presence.get(k).plate);window.__o={right:false,far:false,west:false};
      const iv=setInterval(()=>{if(c.getObjectByName('Demo_car_blinker_right')?.visible&&c.position.z<20)__o.right=true;if(Math.abs(c.position.z-${STREET.laneWest})<.2&&Math.sin(c.rotation.y)<-.99)__o.far=true;if(c.position.x<-45)__o.west=true;if(!c.parent)clearInterval(iv);},20);
      void t.leave(k,{west:true});})()`);
    await p.until('!__parking.sim.state.presence.has(__k) && __o.west', {timeout: 30000, what: 'the car out along the far lane'});
    const o = JSON.parse(await p.eval('JSON.stringify(__o)'));
    expect(o.right, 'its right blinker flashed at the barrier');
    expect(o.far, 'it drove off westbound in the far lane');
  }},
  {name: 'the car that gets to the entry first goes in first, whichever lane it came along', async run(p, expect) {
    // The order was fixed when cars were sent: a far-lane car sent first, starting 110 m further out, kept a near-lane
    // car that reached the barrier first waiting until it had driven up and turned in.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    const [far, near] = JSON.parse(await p.eval(`JSON.stringify((()=>{const sim=__parking.sim,t=__parking.traffic,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));
      const [a,b]=sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      void t.arrive({plate:a.plate,province:a.province,color:a.color,west:true});
      setTimeout(()=>void t.arrive({plate:b.plate,province:b.province,color:b.color,fromX:-40}),50);
      return [sim.key(a.plate,a.province),sim.key(b.plate,b.province)]})())`));
    await p.until(`[${JSON.stringify(far)},${JSON.stringify(near)}].every(k=>__parking.sim.state.presence.has(k))`, {timeout: 40000, what: 'both cars in'});
    // Entry times (the log lists the newest first).
    const [nearAt, farAt] = await p.eval(`(()=>{const e=__parking.sim.state.events.filter(e=>e.kind==='entry');const at=k=>e.find(v=>__parking.sim.key(v.plate,v.province)===k)?.at;return [at(${JSON.stringify(near)}),at(${JSON.stringify(far)})]})()`);
    expect(nearAt < farAt, `the near-lane car, there first, went in first (${((farAt - nearAt) / 1000).toFixed(0)} s of demo time before the far-lane one)`);
  }},
  {name: 'a car from the near lane signals left before turning in', async run(p, expect) {
    // speed 10: at 30 a flash lasts 13 ms and the car is on the street for ~170 ms, so the samples could miss them all.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      window.__k=sim.key(v.plate,v.province);window.__plate=v.plate;window.__left=false;window.__early=null;
      const t=setInterval(()=>{const c=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__plate);const lit=c?.getObjectByName('Demo_car_blinker_left')?.visible;
        if(lit&&c.position.z>24){__left=true;if(c.position.x<-60)__early=c.position.x;}if(__parking.sim.state.presence.has(__k))clearInterval(t);},20);
      void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color});})()`);
    await p.until('__parking.sim.state.presence.has(__k)', {timeout: 30000, what: 'the car through the barrier'});
    expect(await p.eval('__left'), 'its left blinker flashed on the street before the turn');
    // It flashed all the way from the edge of the map; now from 30 m before the turn (x -56).
    expect(await p.eval('__early') === null, `not while still far from the turn (lit at x ${await p.eval('__early')})`);
  }},
  {name: 'the queue waits close behind the barrier, and a car turned away there still backs out past it', async run(p, expect) {
    // The first car in the queue waited at x -33, 7–8 m of empty road behind the car at the barrier. Closer up, it
    // must still leave room for that car to back out if it is refused (else each waits for the other for good).
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='3ฆง 6047')`, {timeout: 30000, what: 'the unknown car held at the barrier'});
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));
      window.__q=sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)).slice(0,2);
      for(const v of __q)void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-60});
      const L=4.46/2,W=1.72/2,corners=c=>{const h=c.rotation.y,f=[Math.sin(h),Math.cos(h)],s=[Math.cos(h),-Math.sin(h)];return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>[c.position.x+f[0]*L*a+s[0]*W*b,c.position.z+f[1]*L*a+s[1]*W*b]);};
      const sep=(A,B)=>{for(const P of [A,B])for(let i=0;i<4;i++){const p=P[i],q=P[(i+1)%4],n=[q[1]-p[1],p[0]-q[0]];let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;for(const v of A){const d=v[0]*n[0]+v[1]*n[1];a0=Math.min(a0,d);a1=Math.max(a1,d);}for(const v of B){const d=v[0]*n[0]+v[1]*n[1];b0=Math.min(b0,d);b1=Math.max(b1,d);}if(a1<b0||b1<a0)return true;}return false;};
      window.__hit=null;const f=()=>{const cars=__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car')&&c.visible&&c.position.z>20);
        for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++)if(!__hit&&!sep(corners(cars[i]),corners(cars[j])))__hit=cars[i].name+' x '+cars[j].name;requestAnimationFrame(f)};requestAnimationFrame(f);})()`);
    // At a queue place: the first at QUEUE_HEAD, the next 6.5 m apart (a background car may have queued first).
    await p.until(`__parking.lot.root.children.some(c=>c.visible&&c.name==='Demo_car_'+__q[0].plate&&c.position.x<${QUEUE_HEAD + .5}&&Math.abs(c.position.z-${STREET.laneEast})<.1&&Math.abs(((c.position.x-(${QUEUE_HEAD}))%6.5+6.5)%6.5-3.25)>3.1)`, {timeout: 30000, what: 'the first queued car at its place'});
    await p.eval(`(()=>{const a=__parking.sim.state.alerts.find(a=>a.status==='open'&&a.plate==='3ฆง 6047');__parking.sim.resolveAlert(a.id,'deny')})()`);
    await p.until(`__q.every(v=>__parking.sim.state.presence.has(__parking.sim.key(v.plate,v.province)))`, {timeout: 40000, what: 'the turned-away car out and both queued cars in'});
    expect(await p.eval('__hit') === null, `no car drove into another (${await p.eval('__hit')})`);
  }},
  {name: 'inside the car park a car rolls straight into a clear aisle, without stopping at its mouth', async run(p, expect) {
    // Every car stopped at its aisle's mouth (its drive from the barrier ended there), with nothing coming.
    // 06:00: the car park is quiet, no one leaving to wait for.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0&time=06:00');
    await p.until(ready, {timeout: 40000});
    const plate = await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      window.__k=sim.key(v.plate,v.province);void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-40});return v.plate})()`);
    await p.until(`__parking.sim.state.presence.has(__k) && !__parking.traffic.isArriving(__k)`, {timeout: 30000, what: 'the car in its bay'});
    const stops = await p.eval('__parking.traffic.inspect().mouthStops');
    expect(Array.isArray(stops) && !stops.includes(plate), `it did not stop at its aisle's mouth (cars that did: ${JSON.stringify(stops)})`);
  }},
  {name: 'a near-lane car queuing for the barrier signals left while it waits', async run(p, expect) {
    // In the queue it showed no blinker, so it was not clear it was waiting to turn in.
    // speed 10: an unknown car holds the barrier for its alert (45 s of demo time) while the next car queues.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='3ฆง 6047')`, {timeout: 30000, what: 'the unknown car holding the barrier'});
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));const v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      window.__plate=v.plate;void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-60});})()`);
    const car = `__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__plate)`;
    // At a queue place: the first at QUEUE_HEAD, the next 6.5 m apart (a background car may have queued first).
    await p.until(`(c=>!!c&&c.visible&&c.position.x<${QUEUE_HEAD + .5}&&Math.abs(c.position.z-${STREET.laneEast})<.1&&Math.abs(((c.position.x-(${QUEUE_HEAD}))%6.5+6.5)%6.5-3.25)>2.95)(${car})`, {timeout: 20000, what: 'the car at its queue place'});
    const seen = await p.eval(`new Promise(done=>{let left=false;const t=setInterval(()=>{if(${car}.getObjectByName('Demo_car_blinker_left')?.visible)left=true;},15);setTimeout(()=>{clearInterval(t);done(left);},600);})`);
    expect(seen, 'its left blinker flashed while it queued');
  }},
  {name: 'a VIP leaving P1 and one arriving for it at the same time both get through', async run(p, expect) {
    // The way into P1 is the exit lane: the arrival waited at its aisle's mouth on the leaving car's path, and each
    // stopped for the other for good (two runs in three). One VIP in P1, then two rounds: it leaves as the next arrives
    // (the mock has three VIPs).
    await p.goto('?dest=parking&debug=1&speed=10&warm=0&time=13:00');
    await p.until(ready, {timeout: 40000});
    const ok = await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic,p1=sim.state.stalls.filter(s=>s.zone==='P1');
      for(const k of t.parkedKeys()){const q=sim.state.presence.get(k);if(p1.some(s=>s.id===q.stallId))t.vanish(k,()=>sim.recordExit({plate:q.plate,province:q.province}));}
      window.__vips=sim.state.vehicles.filter(v=>v.type==='vip'&&v.enabled&&v.sync==='synced'&&!sim.state.presence.has(sim.key(v.plate,v.province)));
      const a=__vips.shift();if(!a||__vips.length<2)return false;
      sim.recordEntry({plate:a.plate,province:a.province,type:'vip',stallId:p1[0].id,color:a.color});window.__out=sim.key(a.plate,a.province);t.appear(__out);return true;})()`);
    expect(ok, 'a VIP parked in P1 and two more to come');
    for (let round = 1; round <= 2; round++) {
      await p.eval(`(()=>{const t=__parking.traffic,v=__vips.shift();void t.leave(__out);void t.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-40});window.__in=__parking.sim.key(v.plate,v.province);})()`);
      await p.until(`!__parking.sim.state.presence.has(__out) && __parking.sim.state.presence.has(__in) && !__parking.traffic.isArriving(__in)`, {timeout: 20000, what: `round ${round}: the leaving VIP out and the arriving one in its bay`});
      await p.eval('window.__out=window.__in');
    }
    expect(true, 'two rounds, no car stuck');
  }},
  {name: 'a reset while a car holds the barrier leaves no barrier holder counted', async run(p, expect) {
    // The aborted holder's own count-down came after the reset had set the count to 0, leaving it at -1: with the next
    // car at the barrier the gate read as free, and the arm was lowered between back-to-back cars.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='3ฆง 6047') && __parking.traffic.gateHolders>=1`, {timeout: 30000, what: 'the unknown car holding the barrier'});
    await p.eval('__parking.traffic.syncParked()');
    await p.sleep(500); // the old flow's next poll finds it aborted
    // Not below 0 (the bug); a background car may already hold the barrier again in the new run.
    // The lowest over 2 s: one read could catch a new-run car holding the barrier on top of a stale -1.
    const lowest = await p.eval(`new Promise(done=>{let low=Infinity;const end=performance.now()+2000;(function f(){low=Math.min(low,__parking.traffic.gateHolders);if(performance.now()<end)requestAnimationFrame(f);else done(low);})()})`);
    expect(lowest >= 0, `no holder counted after the reset (lowest ${lowest})`);
  }},
  {name: 'a reset while a car leaving for the far lane reads its plate leaves far-lane traffic running', async run(p, expect) {
    // The leaving car carried on after the reset and left its hold on new far-lane traffic counted for good.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic,k=t.parkedKeys().find(k=>sim.state.presence.get(k)?.type==='staff');
      window.__car=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+sim.state.presence.get(k).plate);void t.leave(k,{west:true});})()`);
    await p.until(`Math.abs(__car.position.z-16.6)<.05 && Math.abs(__car.position.x+20.2)<.05 && __parking.traffic.gateHolders>0`, {timeout: 30000, what: 'the leaving car reading its plate at the exit'});
    await p.eval('__parking.traffic.syncParked()');
    await p.sleep(1500); // past the read's pauses
    // A hold is left only by a car of the new run waiting at the exit (it holds the exit's turn there, counted in
    // gateHolders); the stale one held it with no car there.
    // A real hold ends once its car has gone; a stale one never does.
    const cleared = await p.until('__parking.traffic.inspect().westExitHold === 0', {timeout: 20000, what: 'no hold on far-lane traffic'}).then(() => true, () => false);
    expect(cleared, `no hold on far-lane traffic left (${await p.eval('__parking.traffic.inspect().westExitHold')})`);
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
    // next from -60, gets its gap first. B used to appear first, drive to the queue's first place (then -33, now
    // -31.43: still within 9 m of A's spawn point) and wait there for A, which waited for B to move.
    await p.until(`(__parking.traffic.passBy(1), !!(window.__thru = __parking.lot.root.children.find(c => c.name === 'Demo_car_' && c.visible && Math.abs(c.position.z - ${STREET.laneEast}) < .3 && c.position.x < -60)))`, {timeout: 20000, what: 'an eastbound through car'});
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
    // Counted before the presses: the background traffic may already have this plate on its way to the gate.
    const cars = `__parking.lot.root.children.filter(c=>c.name==='Demo_car_4ศย 5150').length`, before = await p.eval(cars);
    for (let i = 0; i < 10; i++) await p.click('[data-sim="unknown"]');
    await p.sleep(300);
    expect(await p.eval(cars) === before, `parked unknown plate not sent again (${before} → ${await p.eval(cars)} cars)`);
  }},

  {name: 'calendar invite is an arrival-day reminder', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const ics = await p.eval(`import('/src/parking/dom.js').then(m=>m.visitInvite({ref:'PK-T1',plate:'7กข 4821',province:'กรุงเทพมหานคร',arrival:Date.UTC(2026,10,24,-7),departure:Date.UTC(2026,10,25,-7)}))`);
    // As in the real app: a reminder for the arrival date only, even for a two-day visit.
    expect(ics.includes('DTSTART;VALUE=DATE:20261124') && ics.includes('DTEND;VALUE=DATE:20261125'), 'all-day reminder on the arrival date (24 Nov) only');
    expect(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('END:VEVENT'), 'calendar structure');
  }},

  {name: 'explore page follows the English choice', async run(p, expect) {
    await p.goto(EXPLORE);
    await p.eval(`localStorage.setItem('osd-demo-language','en')`);
    try {
      await p.eval('location.reload()');
      await p.sleep(300);
      await p.until(LOADED, {timeout: 40000, what: 'model ready'});
      await p.eval(`document.querySelector('.simulation-details').open=true`);
      // Every visible text, the room list included, is English (the device map's Thai room names are translated).
      const thai = await p.eval(`(()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim(),el=n.parentElement;if(/[\u0E00-\u0E7F]/.test(t)&&el&&(el.offsetParent!==null||el.tagName==='OPTION'))out.add(t.slice(0,40));}
        for(const el of document.querySelectorAll('[aria-label]'))if(/[\u0E00-\u0E7F]/.test(el.getAttribute('aria-label')))out.add('aria: '+el.getAttribute('aria-label').slice(0,40));return [...out].join(' | ')})()`);
      expect(!thai, `no Thai on the English explore page (found: ${thai})`);
    } finally { await p.eval(`localStorage.setItem('osd-demo-language','th')`); }
  }},

  {name: 'static building still moves where it should: exploded floors and swinging door leaves', async run(p, expect) {
    // The building's matrices are composed once at load (main.js); floors and door hinges must still move on screen.
    await p.goto(EXPLORE);
    await p.until(LOADED, {timeout: 40000, what: 'model ready'});
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

  {name: 'story started during a free-play photo read submits the story plate', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-bar="phone"]');
    await p.click('[data-ph="photo"]'); // free play: reads a sample plate after ~1.5 s
    // Nor does the free-play read land in the story's form on the way (step 2's own read wrote over it after).
    await p.eval(`(()=>{window.__plates=new Set();const t=setInterval(()=>{const v=document.querySelector('#pk-phone input[name=plate]')?.value;if(v)__plates.add(v);if(${STORY_REQUEST})clearInterval(t)},20)})()`);
    await p.click('[data-bar="play"]');
    await p.until(`!!${STORY_REQUEST}`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`${STORY_REQUEST}.plate`), seen = await p.eval('[...__plates]');
    expect(plate === STORY_PLATE, `story request has the story plate (${plate})`);
    expect(seen.every(v => v === STORY_PLATE), `only the story plate in its form (${seen.join(', ')})`);
  }},

  {name: 'a photo tap early in the story (step 1) does not change the story plate', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-bar="play"]');
    await p.until(`!!document.querySelector('[data-ph="photo"]')`, {timeout: 20000, what: 'phone form open'});
    await p.click('[data-ph="photo"]'); // free play: fills the sample plate while the story is still typing
    await p.until(`!!${STORY_REQUEST}`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`${STORY_REQUEST}.plate`);
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
    await p.until(`!!${STORY_REQUEST}`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`${STORY_REQUEST}.plate`);
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
    await p.until(`!!${STORY_REQUEST}`, {timeout: 40000, what: 'story went on and submitted its request'});
    const plate = await p.eval(`${STORY_REQUEST}.plate`);
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
    await p.until(UP, {timeout: 40000});
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
  {name: 'flying between stops: one continuous move that speeds up and slows down once, the car park included', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
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
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
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
  {name: 'idle orbit: a stop the visitor picks counts as use (no orbit the moment it lands); zooming out stops past the whole site', async run(p, expect) {
    // The dock is outside the 3D view: after 20 s without touching the view, the camera circled as soon as it landed.
    // And zooming out went on to 500 m, the world a disc floating in the sky.
    await p.goto(`?debug=1&dest=energy`);
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done' && document.body.dataset.tourDestination==='energy'`, {timeout: 40000, what: 'at the energy stop'});
    await p.eval('__idleNow()');
    await p.click('[data-destination="pond"]');
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='pond'`, {timeout: 20000, what: 'landed at the pond'});
    await p.sleep(300);
    const a = await p.eval('__controls.object.position.toArray()'); await p.sleep(1500); const b = await p.eval('__controls.object.position.toArray()');
    expect(Math.hypot(...a.map((v, i) => v - b[i])) < 1e-3, 'still after landing');
    await p.click('[data-destination="overview"]');
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='overview'`, {timeout: 20000, what: 'landed at the overview'});
    const r = JSON.parse(await p.eval(`JSON.stringify({d:__camera.position.distanceTo(__controls.target),max:__controls.maxDistance})`));
    expect(r.max >= r.d * 1.15 && r.max <= Math.max(140, r.d * 1.3), `zoom out stops a little past the overview (${r.d.toFixed(0)} m, max ${r.max.toFixed(0)} m)`);
  }},
  {name: 'zooming toward a point at the overview does not turn the view', async run(p, expect) {
    // With ground-level panning set for good, three.js's zoom toward the cursor turned the building some 16° a pinch at
    // views under 20° below the horizon (the overview), and slid it from under the fingers.
    await p.goto(`?${FAST}`);
    await p.until(IDLE, {timeout: 40000, what: 'the overview'});
    const yaw = () => p.eval(`(()=>{const d=__camera.getWorldDirection(new __camera.position.constructor());return Math.atan2(d.x,d.z)*180/Math.PI})()`);
    const a = await yaw();
    await p.eval(`(()=>{const c=document.querySelector('#viewport canvas'),r=c.getBoundingClientRect();for(let i=0;i<3;i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width*.25,clientY:r.top+r.height*.55,deltaY:-100,deltaMode:0}))})()`);
    await p.sleep(300);
    const b = await yaw();
    expect(Math.abs(b - a) < 1, `the view kept its heading (${a.toFixed(1)}° -> ${b.toFixed(1)}°)`);
  }},
  {name: 'zooming toward the lower screen at the car park keeps the point under the cursor in place', async run(p, expect) {
    // The pivot went under the ground with the zoom, and the limit lifting it back slid the picture (some 200 px).
    await p.goto(parking());
    await p.until(`${ready} && ${STILL} && document.body.dataset.tourDestination==='parking'`, {timeout: 40000, what: 'at the car park'});
    await p.sleep(300);
    const drift = await p.eval(DRIFT);
    expect(drift < 8, `the ground point under the cursor stays put (${drift.toFixed(1)} px)`);
    // Two ▼ flatten the view under 20° below the horizon: it threw the picture hundreds of pixels there.
    // A fresh page (the wait for one could pass on the old page, already zoomed, before the reload took).
    await p.eval('window.__old = 1');
    await p.goto(parking());
    await p.until(`!window.__old && ${ready} && ${STILL} && document.body.dataset.tourDestination==='parking'`, {timeout: 40000, what: 'at the car park again'});
    await p.sleep(1000);
    await p.eval(`(()=>{const c=document.querySelector('#viewport canvas');for(let i=0;i<2;i++)c.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown',code:'PageDown',bubbles:true,cancelable:true}))})()`);
    const low = await p.eval(DRIFT);
    expect(low < 8, `after ▼▼ too (${low.toFixed(1)} px)`);
  }},
  {name: 'camera up and down: the ▲ ▼ buttons and Page Up / Page Down change the height, still looking at the same point', async run(p, expect) {
    // Panning keeps the height, so the height has its own control.
    await p.goto(`?${FAST}&dest=energy`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='energy'`, {timeout: 40000, what: 'at the energy stop'});
    const pose = async () => JSON.parse(await p.eval(`JSON.stringify({y:__camera.position.y,t:__controls.target.toArray()})`));
    const a = await pose();
    await p.click('#view-up'); await p.sleep(450);
    const b = await pose();
    await p.click('#view-down'); await p.sleep(450); await p.click('#view-down'); await p.sleep(450);
    const c = await pose();
    await p.eval(`document.querySelector('#viewport canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',code:'PageUp',bubbles:true,cancelable:true}))`);
    const d = await pose();
    const same = (u, v) => u.t.every((x, i) => Math.abs(x - v.t[i]) < 1e-6);
    expect(b.y > a.y + .9 && c.y < b.y - 1 && d.y > c.y + .9, `the height goes up, down and up with Page Up (${[a, b, c, d].map(x => x.y.toFixed(1)).join(' → ')} m)`);
    expect(same(a, b) && same(b, c) && same(c, d), 'still looking at the same point');
    // At its limits a press does nothing (it swung overhead at the zoom-out limit, then dropped into the building).
    const limits = JSON.parse(await p.eval(`(()=>{const c=document.querySelector('#viewport canvas'),key=k=>c.dispatchEvent(new KeyboardEvent('keydown',{key:k,code:k,bubbles:true,cancelable:true})),st=()=>({y:__camera.position.y,d:__camera.position.distanceTo(__controls.target),r:Math.hypot(__camera.position.x-__controls.target.x,__camera.position.z-__controls.target.z)});
      const r0=st().r;for(let i=0;i<30;i++)key('PageUp');const up=st();for(let i=0;i<60;i++)key('PageDown');const down=st();return JSON.stringify({r0,up,down,max:__controls.maxDistance})})()`));
    expect(Math.abs(limits.up.r - limits.r0) < .01 && limits.up.d <= limits.max + .01, `up to the zoom-out limit, no further and not overhead (${limits.up.d.toFixed(1)} of ${limits.max.toFixed(0)} m, ${limits.r0.toFixed(1)} -> ${limits.up.r.toFixed(1)} m out)`);
    expect(Math.abs(limits.down.r - limits.r0) < .01 && limits.down.y > .7, `down to just above the point it looks at, not backing away (${limits.r0.toFixed(1)} -> ${limits.down.r.toFixed(1)} m out, ${limits.down.y.toFixed(1)} m up)`);
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
  {quick: true, name: 'flying between stops: floors are sliced away and built up solid, never faded see-through', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // Every frame of the flights: named building meshes drawn more see-through than they were before (the stop's
    // marker, unnamed, fades on purpose), and frames where geometry is being cut.
    await p.eval(`(()=>{const scene=__scene,before=new Map();scene.traverse(o=>{if(o.isMesh&&o.name)before.set(o,[].concat(o.material).map(m=>({transparent:m.transparent,opacity:m.opacity})));});
      window.__xray=0;window.__cuts=0;const f=()=>{if(document.querySelector('#viewport').classList.contains('flying')){let cut=false;
        for(const [o,was] of before){if(!o.visible)continue;[].concat(o.material).forEach((m,i)=>{if(m.transparent&&m.opacity<.99&&(!was[i].transparent||was[i].opacity-m.opacity>.02))__xray++;if(m.clippingPlanes?.length)cut=true;});}
        if(cut)__cuts++;}requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    for (const stop of ['meeting', 'pond', 'energy']) {
      await p.click(`[data-destination="${stop}"]`);
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${stop}'`, {timeout: 20000, what: `landed at ${stop}`});
    }
    expect(await p.eval('__cuts') > 5, `floors were cut while changing (${await p.eval('__cuts')} frames)`);
    expect(await p.eval('__xray') === 0, `no floor faded see-through (${await p.eval('__xray')} mesh-frames)`);
  }},
  {name: 'meeting room: its light cone fades in as the camera arrives and out as it leaves (no pop)', async run(p, expect) {
    await p.goto('?debug=1&time=10:00');
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // The cone's opacity on every frame (0 while hidden).
    await p.eval(`(()=>{window.__cone=[];const g=__scene.getObjectByName('Demo_meeting');let cone=null;g.traverse(o=>{if(o.geometry?.type==='CylinderGeometry')cone=o;});
      const f=()=>{let shown=true;for(let o=cone;o;o=o.parent)if(!o.visible)shown=false;__cone.push(shown?cone.material.opacity:0);if(__cone.length<600)requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    await p.click('[data-destination="meeting"]'); await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 20000, what: 'at the meeting room'}); await p.sleep(500);
    await p.click('[data-destination="pond"]'); await p.until(`${IDLE} && document.body.dataset.tourDestination==='pond'`, {timeout: 20000, what: 'at the pond'});
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
  {name: 'a flight that starts during the warm-up leaves the real materials behind', async run(p, expect) {
    // The warm-up lends every mesh a copy of its material while shaders compile (sceneTransition.prepare); a ?dest=
    // flight can set off meanwhile, and once it ended after the lend it put those copies back as the meshes' own. Here
    // a flight sets off inside a lend on purpose, rather than hoping the load's timing lines up.
    // Real speed: a flight at ?speed=30 is over within a frame or two.
    await p.goto('?debug=1&warm=0&time=10:00');
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    // The lend lasts until the flight's second change has begun (the approach, partway through the flight; the first
    // is at take-off), and the flight outlasts it.
    await p.eval(`__transition.prepare(async()=>{if(window.__flown)return;window.__flown=true;
      const begun=new Promise(r=>{const begin=__transition.begin;let n=0;__transition.begin=(...a)=>{begin(...a);if(++n===2){__transition.begin=begin;r();}};});
      document.querySelector('[data-destination="meeting"]').click();await begun;})`);
    expect(await p.eval(`document.querySelector('#viewport').classList.contains('flying')`), 'the flight outlasts the lend');
    await p.until(`document.body.dataset.tourDestination==='meeting' && ${STILL}`, {timeout: 20000, what: 'at the meeting room'});
    const kept = await p.eval(`(()=>{let n=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))n++;});return n;})()`);
    expect(kept === 0, `no mesh keeps a lent copy once both are over (${kept})`);
  }},
  {name: 'a warm-up that starts during a flight leaves the flight\'s materials alone', async run(p, expect) {
    // The other way round: the flight's floor change is under way when a lend begins. It used to take the change's
    // copies for the meshes' own (and put them back for good), and remake copies the change was drawing with.
    await p.goto('?debug=1&warm=0&time=10:00');
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    const kept = await p.eval(`(async()=>{let n=0;const begin=__transition.begin;
      await new Promise(r=>{__transition.begin=(...a)=>{begin(...a);if(++n===2){__transition.begin=begin;r();}};document.querySelector('[data-destination="meeting"]').click();});
      await __transition.prepare(()=>new Promise(r=>{const t=setInterval(()=>{if(!document.querySelector('#viewport').classList.contains('flying')){clearInterval(t);r();}},20);}));
      let k=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))k++;});return k;})()`);
    expect(kept === 0, `no mesh keeps a copy once both are over (${kept})`);
  }},
  {name: 'a spot light\'s shadow follows it to another room', async run(p, expect) {
    // A new selection deals the night's spot lights again; each fades out, then moves. The shadow redraw came with the
    // selection, before the move, so a shadow-casting light lit its new room with the old room's shadows.
    // On the explore page with the clock at real time (?day=0): the showcase's car park and a fast clock's sky steps
    // redraw the shadows often enough to hide it. (Paused, the lights would not move at all.)
    await p.goto(`?explore=1&debug=1&warm=0&time=22:00&day=0#explore`);
    await p.until(`${LOADED} && !!window.__simulationApi`, {timeout: 40000, what: 'explore page ready'});
    await p.sleep(800);
    const spots = `JSON.stringify(__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.castShadow&&l.name.startsWith('Simulation_spot')).map(l=>l.getWorldPosition(l.position.clone()).toArray().map(v=>v.toFixed(2))))`;
    await p.eval(`(()=>{const sm=__renderer.shadowMap,render=sm.render.bind(sm);sm.render=(...a)=>{if(sm.needsUpdate)window.__shadowFor=${spots};return render(...a);};})()`);
    const before = await p.eval(spots);
    await p.eval(`__simulationApi.selectRoom('f1_lobby')`);
    await p.until(`${spots}!==${JSON.stringify(before)}`, {timeout: 5000, what: 'a shadow-casting spot light moved'});
    await p.sleep(1500);
    const now = await p.eval(spots), drawn = await p.eval('window.__shadowFor');
    expect(drawn === now, `the last shadow redraw saw the lights where they are (${drawn} vs ${now})`);
  }},
  {name: 'a door stops mid-swing while paused', async run(p, expect) {
    // The swing ran on frame time: paused as a door began to open, it carried on to the end with everything else still.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    const hinges = `(()=>{const h=[];__scene.traverse(o=>{if(o.userData.deviceKind==='door'&&o.userData.doorId&&!o.isMesh)h.push(o.rotation.y.toFixed(4));});return h.join(',');})()`;
    await p.click('[data-control="door"]');
    await p.eval('__world.setPaused(true)');
    // A frame already on its way draws the door where it was at the moment of the pause; from then on it stands still.
    await p.sleep(150);
    const at = await p.eval(hinges);
    await p.sleep(900);
    expect(await p.eval(hinges) === at, 'the door did not move while paused');
    // Nor are the shadows redrawn meanwhile: a still door's shadow has nothing new to show (the room's air keeps
    // the view itself drawing).
    const draws = await p.eval(`new Promise(done=>{const R=__renderer,render=R.render.bind(R);let n=0;R.render=(...a)=>{if(!R.getRenderTarget()&&R.shadowMap.needsUpdate)n++;return render(...a);};setTimeout(()=>{R.render=render;done(n);},600);})`);
    expect(draws <= 2, `no shadow redraws while it stands paused (${draws} in 0.6 s)`);
    await p.eval('__world.setPaused(false)');
    await p.sleep(900);
    expect(await p.eval(hinges) !== at, 'and finished its swing on Resume');
  }},
  {name: 'the meeting room\'s fittings and air hold their fades while paused', async run(p, expect) {
    // The fittings' glow and the AC's airflow faded on frame time: switched off and paused at once, both went out.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    await p.sleep(800);
    const read = `JSON.stringify((()=>{let glow=0,air=0;__scene.traverse(o=>{if(o.userData.roomId==='f4_meeting_2'&&o.userData.deviceKind==='light')for(const m of [].concat(o.material))glow+=m.emissiveIntensity||0;});
      __scene.getObjectByName('Demo_meeting').traverse(o=>{if(o.material?.isLineDashedMaterial)air+=o.material.opacity*(o.visible?1:0);});return {glow:+glow.toFixed(3),air:+air.toFixed(3)};})())`;
    await p.click('[data-control="light"]');
    await p.click('[data-control="climate"]');
    await p.eval('__world.setPaused(true)');
    await p.sleep(150);
    const at = JSON.parse(await p.eval(read));
    await p.sleep(600);
    const later = JSON.parse(await p.eval(read));
    expect(at.glow > 0 && at.air > 0 && later.glow === at.glow && later.air === at.air, `held (glow ${at.glow} → ${later.glow}, air ${at.air} → ${later.air})`);
    await p.eval('__world.setPaused(false)');
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
  {name: 'kiosk: a wheel step the view keeps for itself still counts as a touch', async run(p, expect) {
    // The close zoom stops its wheel steps at the canvas (stopImmediatePropagation, capture phase); the kiosk's activity
    // listener has to see them before that, or scrolling in close never paused the loop or put off its return.
    await p.goto(`?kiosk=1&${FAST}&time=12:00`);
    await p.until(`${UP} && document.querySelector('#kiosk-toggle').checked`, {timeout: 40000, what: 'the kiosk following the day'});
    await p.eval(`(()=>{const c=document.querySelector('#viewport canvas');c.addEventListener('wheel',e=>e.stopImmediatePropagation(),{capture:true,once:true});c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));})()`);
    await p.sleep(300);
    const progress = await p.eval(`document.querySelector('#tour-progress').textContent`);
    expect(/หยุดโหมดจัดแสดงชั่วคราว|Paused the showcase loop/.test(progress), `the wheel step paused the loop (progress: ${progress})`);
  }},

  {name: 'kiosk: Stop following stops following', async run(p, expect) {
    // The kiosk's activity listener stopped following on the button's pointerdown; its click then started it again.
    await p.goto(`?kiosk=1&${FAST}&time=12:00`);
    await p.until(`${UP} && document.querySelector('#day-play')?.getAttribute('aria-pressed')==='true'`, {timeout: 40000, what: 'the kiosk following the day'});
    await p.click('#day-play');
    await p.sleep(300);
    expect(await p.eval(`document.querySelector('#day-play').getAttribute('aria-pressed')`) === 'false', 'the button shows following stopped');
  }},
  {name: 'kiosk: Stop tour stops the tour, Pause pauses the parking story', async run(p, expect) {
    // Like Stop following: the activity listener stopped the tour on pointerdown and the click started it again; and
    // Pause ended the kiosk's morning parking story instead of pausing it.
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until('window.__parking && __parking.story.running', {timeout: 60000, what: 'the morning car park plays the parking story'});
    await p.click('#day-pause');
    await p.sleep(300);
    expect(await p.eval('__world.paused') && await p.eval('__parking.story.running'), `Pause paused the story (clock paused ${await p.eval('__world.paused')}, story running ${await p.eval('__parking.story.running')})`);
    await p.click('#day-pause');
    const label = `document.querySelector('#tour-play span').textContent`;
    await p.click('#tour-play');
    await p.until(`/หยุดพาชม|Stop tour/.test(${label})`, {timeout: 5000, what: 'the tour started'});
    await p.click('#tour-play');
    await p.sleep(300);
    expect(/เริ่มพาชม|Start tour/.test(await p.eval(label)), `Stop tour stopped it (button: ${await p.eval(label)})`);
  }},
  {name: 'kiosk: Pause on the way to the car park holds the story until Resume', async run(p, expect) {
    // Following the day, the kiosk flies to the car park and starts the morning story on landing; starting, the story
    // set the clock going, so a Pause tapped on the way lasted only until the camera landed.
    // Real speed: at ?speed=30 the flight is over before it can be tapped.
    await p.goto('?kiosk=1&debug=1&warm=0&time=07:50');
    await p.until(`${UP} && document.body.dataset.tourDestination==='parking' && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk flying to the car park'});
    await p.click('#day-pause');
    await p.until(STILL, {timeout: 10000, what: 'landed'});
    await p.sleep(500);
    const paused = JSON.parse(await p.eval(`JSON.stringify({paused:__world.paused,story:__parking.story.running})`));
    expect(paused.paused && !paused.story, `still paused after landing, no story yet (paused ${paused.paused}, story ${paused.story})`);
    await p.click('#day-pause');
    await p.until('__parking.story.running', {timeout: 5000, what: 'the story starting on Resume'});
    expect(true, 'the story started on Resume');
  }},
  {name: 'tour: Pause on the way to the car park holds the story until Resume', async run(p, expect) {
    // As for the kiosk: the tour's car park stop started the story on landing, which set a paused clock going again.
    // The Pause comes the moment the tour sets off for the car park (at ?speed=30 the flight is too short to tap).
    await p.goto(`?${FAST}`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    await p.eval(`new MutationObserver((_,o)=>{if(document.body.dataset.tourDestination==='parking'){o.disconnect();__world.setPaused(true);}}).observe(document.body,{attributes:true,attributeFilter:['data-tour-destination']})`);
    await p.click('#tour-play');
    await p.until(`document.body.dataset.tourDestination==='parking' && ${STILL}`, {timeout: 20000, what: 'the tour at the car park'});
    await p.sleep(500);
    const r = JSON.parse(await p.eval(`JSON.stringify({paused:__world.paused,story:__parking.story.running})`));
    expect(r.paused && !r.story, `still paused after landing, no story yet (paused ${r.paused}, story ${r.story})`);
    await p.click('#day-pause');
    await p.until('__parking.story.running', {timeout: 5000, what: 'the story starting on Resume'});
    expect(true, 'the story started on Resume');
  }},
  {name: 'Follow the day again: a story left waiting for Resume does not start mid-flight', async run(p, expect) {
    // Paused on the way to the car park, the story waits for Resume. Following stopped, then started again, the old
    // wait still held: Follow's Resume started the story at once, while the camera was still on its way.
    await p.goto(`?${FAST}&time=07:50`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    await p.eval(`new MutationObserver((_,o)=>{if(document.body.dataset.tourDestination==='parking'){o.disconnect();__world.setPaused(true);}}).observe(document.body,{attributes:true,attributeFilter:['data-tour-destination']})`);
    await p.click('#day-play');
    await p.until(`document.body.dataset.tourDestination==='parking' && ${STILL}`, {timeout: 20000, what: 'following, paused at the car park'});
    await p.click('#day-play');
    await p.click('[data-destination="pond"]');
    await p.until(`document.body.dataset.tourDestination==='pond' && ${STILL}`, {timeout: 20000, what: 'at the pond'});
    // Where the camera is when the story is started (once there, the story moves the camera itself).
    await p.eval(`(()=>{const play=__parking.playStory;__parking.playStory=(...a)=>{window.__early=document.querySelector('#viewport').classList.contains('flying')||document.body.dataset.tourDestination!=='parking';return play(...a);};})()`);
    await p.click('#day-play');
    await p.until(`__parking.story.running`, {timeout: 20000, what: 'the story at the car park'});
    expect(!(await p.eval('__early')), 'the story started only once the camera was at the car park');
  }},
  {name: 'timeline: a time picked while following the day is the one gone to', async run(p, expect) {
    // Let go, the slider stopped Follow first, which put the slider back to the live time before its value was read.
    await p.goto(`?${FAST}&time=12:00`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    await p.click('#day-play');
    await p.eval(`(()=>{const r=document.querySelector('#day-time');r.value='900';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    const m = await p.eval('Math.floor(__world.minute())');
    expect(m >= 900 && m < 910, `the clock went to 15:00 (minute ${m})`);
  }},
  {name: 'timeline: a jump stops a parking story played on its own', async run(p, expect) {
    // The story holds the clock and sets it at each step: left running, it put a jump to 20:00 back to the morning.
    await p.goto(parking('&story=1'));
    await p.until('__parking.story.running', {timeout: 40000, what: 'the story playing'});
    await p.eval(`(()=>{const r=document.querySelector('#day-time');r.value='1200';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await p.sleep(1500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,m:Math.floor(__world.minute())})`));
    expect(!r.story && r.m >= 1200 && r.m < 1320, `the story stopped and the clock stayed in the evening (story ${r.story}, minute ${r.m})`);
  }},
  {name: 'a parking story stopped while it resets the world sets no clock after', async run(p, expect) {
    // Stopped during its reset (the first 50 ms), the story still went on into its first step, which sets the clock
    // to 09:02: a timeline jump made then was undone.
    await p.goto(parking('&time=20:00'));
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const sim=__parking.sim,set=sim.setNow;window.__late=[];void __parking.playStory();__parking.stopStory();sim.setNow=ms=>{__late.push(ms);return set(ms);};})()`);
    await p.sleep(400);
    const late = await p.eval('__late.length');
    expect(late === 0 && !(await p.eval('__parking.story.running')), `no step ran after the stop (${late} clock settings)`);
  }},
  {name: 'Follow the day: Pause on the way to the meeting holds its scenario until Resume', async run(p, expect) {
    // Like the car park's story: the meeting's cooling scenario started on landing, over a Pause.
    await p.goto(`?${FAST}&time=09:05`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    await p.eval(`new MutationObserver((_,o)=>{if(document.body.dataset.tourDestination==='meeting'){o.disconnect();__world.setPaused(true);}}).observe(document.body,{attributes:true,attributeFilter:['data-tour-destination']})`);
    await p.click('#day-play');
    await p.until(`document.body.dataset.tourDestination==='meeting' && ${STILL}`, {timeout: 20000, what: 'following, paused at the meeting room'});
    await p.sleep(500);
    const temp = `+document.querySelector('#dashboard-content .metric-value').firstChild.textContent`;
    const paused = await p.eval(temp);
    const note = await p.eval(`!!document.querySelector('.scenario-note')?.textContent.includes('กำลังจำลองการทำความเย็น')`);
    expect(paused !== 27.4 && !note, `no scenario while paused (room at ${paused} °C, the scenario's start is 27.4; its note ${note ? 'shown' : 'not shown'})`);
    await p.click('#day-pause');
    // The scenario's own note (the room cools by its schedule anyway, and a falling reading passed without it).
    await p.until(`document.querySelector('.scenario-note')?.textContent.includes('กำลังจำลองการทำความเย็น')`, {timeout: 5000, what: 'the scenario on Resume'});
    expect(true, 'the scenario started on Resume');
  }},
  {name: 'kiosk: a flight cut short by leaving the page is flown again on return', async run(p, expect) {
    // The moment was marked as gone to before its flight: hidden on the way (another tab), the kiosk came back to
    // the overview and stayed there until the next moment.
    // Real speed: at ?speed=30 the flight is over before the page can be hidden.
    await p.goto('?kiosk=1&debug=1&warm=0&time=12:05');
    await p.until(`${UP} && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk on its way'});
    // Where it is going: the dock's pressed stop (the page's stop changes only on landing).
    const to = await p.eval(`document.querySelector('[data-destination][aria-pressed=true]').dataset.destination`);
    const hide = on => `(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>${on}});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'${on ? 'hidden' : 'visible'}'});document.dispatchEvent(new Event('visibilitychange'));})()`;
    await p.eval(hide(true));
    await p.sleep(400);
    await p.eval(hide(false));
    await p.until(`document.body.dataset.tourDestination===${JSON.stringify(to)} && ${STILL}`, {timeout: 15000, what: `the kiosk back on its way to ${to}`});
    expect(true, `flew to ${to} again`);
  }},
  {name: 'Night stops a parking story played on its own', async run(p, expect) {
    // Like the timeline: the header's Night jumped to 20:00, and the story's next step set the morning again.
    await p.goto(parking('&story=1'));
    await p.until('__parking.story.running', {timeout: 40000, what: 'the story playing'});
    await p.click('#tour-night');
    await p.sleep(1500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,m:Math.floor(__world.minute())})`));
    expect(!r.story && r.m >= 1200 && r.m < 1320, `the story stopped and it stayed night (story ${r.story}, minute ${r.m})`);
  }},
  {name: 'kiosk: a flight cut short on its final approach is flown again too', async run(p, expect) {
    // On the final approach the stop counts as reached (its title shows), though the camera is still on its way:
    // hidden then, the kiosk took the moment as seen and never finished the flight.
    await p.goto('?kiosk=1&debug=1&warm=0&time=12:05');
    await p.until(`${UP} && document.body.dataset.tourDestination==='energy' && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk on its final approach to the energy stop'});
    const hide = on => `(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>${on}});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'${on ? 'hidden' : 'visible'}'});document.dispatchEvent(new Event('visibilitychange'));})()`;
    await p.eval(hide(true));
    await p.sleep(400);
    await p.eval(hide(false));
    await p.until(`document.querySelector('#viewport').classList.contains('flying')`, {timeout: 10000, what: 'the flight to the energy stop again'});
    expect(true, 'flown again');
  }},
  {name: 'kiosk: the parking story\'s own Pause pauses it', async run(p, expect) {
    // The kiosk's activity listener stopped the story on the bar's pointerdown, before its Pause got the click.
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until('window.__parking && __parking.story.running && !!document.querySelector(\'[data-bar="pause"]\')', {timeout: 60000, what: 'the morning story with its Pause'});
    await p.click('[data-bar="pause"]');
    await p.sleep(300);
    const r = JSON.parse(await p.eval(`JSON.stringify({running:__parking.story.running,paused:__parking.story.paused,following:document.querySelector('#day-play').getAttribute('aria-pressed')})`));
    expect(r.running && r.paused, `the story paused, not ended (running ${r.running}, paused ${r.paused})`);
    expect(r.following === 'true', `the kiosk still following the day (${r.following})`);
  }},
  {name: 'kiosk: Stop following stops the flight under way too', async run(p, expect) {
    // It turned Follow off but left the flight Follow had started to land, and the panel moved on to its stop.
    // Real speed: at ?speed=30 the flight is over before it can be tapped.
    await p.goto('?kiosk=1&debug=1&warm=0&time=12:05');
    await p.until(`${UP} && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk on its way'});
    await p.click('#day-play');
    await p.sleep(2500);
    const r = JSON.parse(await p.eval(`JSON.stringify({flying:document.querySelector('#viewport').classList.contains('flying'),dest:document.body.dataset.tourDestination})`));
    expect(!r.flying && r.dest === 'overview', `the flight stopped where it was (flying ${r.flying}, stop ${r.dest})`);
  }},
  {name: 'kiosk: Exit story hands the screen to the visitor', async run(p, expect) {
    // The whole story bar was left out of the kiosk's touches, so Exit ended the story and the loop flew straight on.
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until('window.__parking && __parking.story.running && !!document.querySelector(\'[data-bar="free"]\')', {timeout: 60000, what: 'the morning story with its Exit'});
    await p.click('[data-bar="free"]');
    await p.sleep(1500);
    const r = JSON.parse(await p.eval(`JSON.stringify({following:document.querySelector('#day-play').getAttribute('aria-pressed'),dest:document.body.dataset.tourDestination,flying:document.querySelector('#viewport').classList.contains('flying')})`));
    expect(r.following === 'false' && r.dest === 'parking' && !r.flying, `the visitor has the car park (following ${r.following}, stop ${r.dest}, flying ${r.flying})`);
    // And Exit did its own work too (the touch must not end the story before Exit's click): the console's Gate.
    expect(await p.eval(`document.querySelector('[data-tab="gate"]').getAttribute('aria-selected')`) === 'true', 'Exit opened the Gate tab');
  }},
  {name: 'kiosk: Restart story restarts it for the visitor', async run(p, expect) {
    // The touch ended the story (and its bar) before Restart's click arrived: nothing restarted.
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until('window.__parking && __parking.story.running && __parking.story.index >= 1 && !!document.querySelector(\'[data-bar="restart"]\')', {timeout: 60000, what: 'the morning story past its first step'});
    await p.click('[data-bar="restart"]');
    await p.sleep(400);
    const r = JSON.parse(await p.eval(`JSON.stringify({running:__parking.story.running,index:__parking.story.index,following:document.querySelector('#day-play').getAttribute('aria-pressed')})`));
    expect(r.running && r.index <= 0 && r.following === 'false', `the story started again, the visitor's (running ${r.running}, step ${r.index + 1}, following ${r.following})`);
  }},
  {name: 'a flight stopped before its approach leaves the stop it left on show', async run(p, expect) {
    // Stopped early, the flight settled the floors on the whole building while the dock and panel stayed on the
    // meeting room (and Reset view, already at its pose, left it so).
    // Real speed: at ?speed=30 the flight is over before it can be stopped.
    await p.goto('?debug=1&warm=0&time=10:00&dest=meeting');
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    const floor = await p.eval('__simulation().view.currentFloor');
    await p.click('[data-destination="pond"]');
    await p.until(`document.querySelector('#viewport').classList.contains('flying')`, {timeout: 5000, what: 'on its way to the pond'});
    await p.sleep(150);
    await p.eval(`(()=>{__controls.dispatchEvent({type:'start'});__controls.dispatchEvent({type:'end'});})()`); // the visitor takes the view
    await p.sleep(300);
    const r = JSON.parse(await p.eval(`JSON.stringify({floor:__simulation().view.currentFloor,pressed:document.querySelector('[data-destination][aria-pressed=true]')?.dataset.destination,kept:(()=>{let n=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))n++;});return n;})()})`));
    expect(r.pressed === 'meeting' && r.floor === floor && r.kept === 0, `the meeting room's floor ${floor} on show with its stop (floor ${r.floor}, stop ${r.pressed}, ${r.kept} meshes mid-cut)`);
  }},
  {name: 'tapping the stop again on its final approach ends its floors\' change', async run(p, expect) {
    // There already (within 0.1 m), the repeat tap stopped the flight and returned, leaving the change mid-cut.
    await p.goto('?debug=1&warm=0&time=10:00&dest=meeting');
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    const pose = await p.eval('JSON.stringify({eye:__camera.position.toArray(),target:__controls.target.toArray()})');
    await p.click('[data-destination="overview"]');
    await p.until(`document.body.dataset.tourDestination==='overview' && ${STILL}`, {timeout: 20000, what: 'at the overview'});
    await p.click('[data-destination="meeting"]');
    await p.until(`document.body.dataset.tourDestination==='meeting' && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 10000, what: 'on the final approach'});
    // The camera at the stop's pose (as at the approach's very end), and the stop tapped again.
    await p.eval(`(()=>{const p=${pose};__camera.position.fromArray(p.eye);__controls.target.fromArray(p.target);__camera.updateProjectionMatrix();document.querySelector('[data-destination="meeting"]').click();})()`);
    await p.sleep(500);
    const kept = await p.eval(`(()=>{let n=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))n++;});return n;})()`);
    expect(kept === 0, `no floor left mid-cut (${kept} meshes)`);
  }},
  {name: 'kiosk: switching kiosk mode off stops the flight under way', async run(p, expect) {
    // Follow went off at once, but the camera flew on and the panel moved to its stop.
    // Real speed: at ?speed=30 the flight is over before it can be tapped.
    await p.goto('?kiosk=1&debug=1&warm=0&time=12:05');
    await p.until(`${UP} && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk on its way'});
    await p.click('#kiosk-toggle');
    await p.sleep(2500);
    const r = JSON.parse(await p.eval(`JSON.stringify({flying:document.querySelector('#viewport').classList.contains('flying'),dest:document.body.dataset.tourDestination,kiosk:document.querySelector('#kiosk-toggle').checked})`));
    expect(!r.kiosk && !r.flying && r.dest === 'overview', `kiosk off, the flight stopped where it was (flying ${r.flying}, stop ${r.dest})`);
  }},
  {name: 'energy: the sun returning keeps the power figures sensible', async run(p, expect) {
    // 8.4 kW of sun against a 4.3 kW building: -4.1 kW from the grid and a 195 % solar share.
    await p.goto(`?dest=energy&${FAST}&time=07:30`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='energy'`, {timeout: 40000, what: 'at the energy stop'});
    await p.click('[data-action="energy"]');
    await p.sleep(300);
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const t=document.querySelector('#dashboard-content').textContent;return {negative:/-\\d+(\\.\\d)? kW/.test(t),share:Math.max(0,...[...t.matchAll(/(\\d+)%/g)].map(m=>+m[1]))};})())`));
    expect(!r.negative && r.share <= 100, `no negative power, a share of at most 100 % (negative ${r.negative}, largest ${r.share} %)`);
  }},
  {name: 'energy: a sun-returning override ends at sunset', async run(p, expect) {
    // Held for an hour, it kept 8.4 kW of output after the sun had set, beside a button saying there was no sun.
    await p.goto(`?dest=energy&${FAST}&time=17:40`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='energy'`, {timeout: 40000, what: 'at the energy stop'});
    await p.click('[data-action="energy"]');
    await p.sleep(5500); // the scenario owns the readings for its 5 s; then its override holds them
    await p.eval('__world.jumpTo(18*60+20)');
    await p.sleep(300);
    const now = await p.eval(`+document.querySelector('#dashboard-content .metric-value').firstChild.textContent`);
    expect(now === 0, `producing ${now} kW after sunset`);
  }},
  {name: 'the parking chart has room for an hour of many departures', async run(p, expect) {
    // Scaled to entries alone, an evening hour's exits drew taller than the chart.
    await p.goto(parking('&time=19:00'));
    await p.until(ready, {timeout: 40000});
    // 35 cars logged in over the eight hours before and all out this hour: one hour's exits far above any hour's entries.
    await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId)),now=__world.now();let i=0;
      for(const v of sim.state.vehicles.filter(v=>v.type==='staff'&&!inside.has(v.id)).slice(0,35)){const s=sim.freeStall('staff');if(!s)break;sim.recordEntry({plate:v.plate,province:v.province,type:'staff',stallId:s.id,color:v.color,at:now-(1+i++%8)*3600e3});sim.recordExit({plate:v.plate,province:v.province});}})()`);
    await p.click('[data-tab="overview"]');
    await p.sleep(300);
    const over = await p.eval(`[...document.querySelectorAll('.pk-bars rect')].filter(r=>+r.getAttribute('y')<0).length`);
    expect(over === 0, `no bar taller than the chart (${over})`);
  }},
  {name: 'timeline: the readout shows the minute the slider does', async run(p, expect) {
    // The readout rounded, the slider floored: at 23:59:45 one said 00:00, the other 23:59.
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000, what: 'model ready'});
    expect(await p.eval(`import('osd/viewer/building-day.js').then(m=>m.formatTime(23*60+59.75))`) === '23:59', '23:59:45 reads 23:59');
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
  {name: 'touchpad: two fingers pan, a pinch and a mouse wheel zoom', async run(p, expect) {
    // Panning needed the right button held down, awkward on a touchpad: a two-finger scroll zoomed instead.
    await p.goto(`?${FAST}`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    const wheel = init => p.eval(`(()=>{const c=__camera,t=__controls.target,d0=c.position.distanceTo(t),t0=t.clone();
      document.querySelector('#viewport canvas').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:400,clientY:300,...${JSON.stringify(init)}}));
      return JSON.stringify({moved:+t.distanceTo(t0).toFixed(3),zoom:+(c.position.distanceTo(t)-d0).toFixed(3)});})()`).then(JSON.parse);
    const scroll = await wheel({deltaX: 30, deltaY: 20});
    expect(scroll.moved > 0 && Math.abs(scroll.zoom) < .01, `two-finger scroll pans (target moved ${scroll.moved}, distance ${scroll.zoom})`);
    // Straight up or down too, small steps as a touchpad sends them (in Chromium on Linux nothing else tells them apart).
    const vertical = await wheel({deltaY: -8});
    expect(vertical.moved > 0 && Math.abs(vertical.zoom) < .01, `a straight two-finger scroll pans (target moved ${vertical.moved}, distance ${vertical.zoom})`);
    await p.sleep(300); // the scroll's stream over
    const pinch = await wheel({deltaY: 20, ctrlKey: true});
    expect(pinch.zoom > 0, `pinch zooms (distance ${pinch.zoom})`);
    const mouse = await wheel({deltaY: 100});
    expect(mouse.zoom > 0, `a mouse wheel notch zooms (distance ${mouse.zoom})`);
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
  {name: 'the car park sign counts the cars that left in a jump in time', async run(p, expect) {
    // Cars that vanish from their bays (a jump in time, departures off screen) used to redraw the sign and the bay
    // lights before their exit was recorded: the last one still counted as parked.
    await p.goto(`?${FAST}&time=12:00`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    await p.eval(`(()=>{const lot=__parking.lot,draw=lot.drawSign;lot.drawSign=(free,capacity)=>{window.__signFree=free;return draw(free,capacity);};})()`);
    // Read at once: the next traffic update redraws it anyway.
    const r = JSON.parse(await p.eval(`(()=>{__world.jumpTo(20*60);return JSON.stringify({sign:window.__signFree,free:__parking.sim.state.capacity-__parking.sim.state.presence.size});})()`));
    expect(r.sign === r.free, `the sign shows ${r.sign} free, the car park has ${r.free}`);
  }},
  {name: 'a reading set by hand goes back to the schedule after the 03:00 wrap too', async run(p, expect) {
    // A meeting's temperature is held for an hour of world time; started just before the day wraps at 03:00 (back to
    // the same morning), its deadline stayed on the next day and the reading never went back to the schedule.
    // (02:50 the next morning: a page opened at 02:50 starts before the day it wraps.)
    await p.goto(`?dest=meeting&${FAST}&time=23:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    await p.eval('__world.jumpTo(2*60+50)');
    await p.sleep(300);
    await p.click('[data-action="meeting"]');
    await p.sleep(800);
    await p.click('[data-action="meeting-end"]');
    const shown = `+document.querySelector('#dashboard-content .metric-value').firstChild.textContent`;
    const r = JSON.parse(await p.eval(`(async()=>{const {daySnapshot}=await import('osd/viewer/building-day.js');__world.jumpTo(3*60+10);__world.jumpTo(4*60+10);
      await new Promise(r=>setTimeout(r,300));return JSON.stringify({shown:${shown},planned:daySnapshot(4*60+10,new Map()).telemetry.temp});})()`));
    expect(r.shown === r.planned, `at 04:10 the room shows the schedule's ${r.planned} °C (shows ${r.shown} °C)`);
  }},
  {name: 'car park keeps living at building stops (staff cars come and go)', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000, what: 'model ready'});
    await p.click('[data-destination="pond"]');
    await p.sleep(1500);
    const before = await p.eval('__parking.sim.state.events.length');
    // Background lot traffic skips a turn while another car is moving; with several browsers sharing the GPU that can take a while.
    await p.until(`__parking.sim.state.events.length > ${before}`, {timeout: 30000, what: 'an entry or exit while on the pond stop'});
    const kinds = await p.eval(`__parking.sim.state.events.slice(0, __parking.sim.state.events.length - ${before}).map(e=>e.kind+':'+e.type).join(',')`);
    expect(!/unknown/.test(kinds), `no unknown cars away from the parking stop (got ${kinds})`);
  }},

  {name: 'a leaving car gets out even with busy street traffic', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    // Keep the eastbound lane as busy as spacing allows, then send a car out: it must get a gap and leave,
    // not wait at the barrier for good (the bug: through-traffic never left a long enough gap).
    await p.eval('window.__pump=setInterval(()=>__parking.traffic.passBy(1),30)');
    await p.sleep(1500);
    const key = await p.eval(LEAVE_STAFF);
    try { await p.until(`!__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 12000, what: 'exit through the barrier (6 min of demo time)'}); }
    finally { await p.eval('clearInterval(window.__pump)'); }
    expect(true, 'car left');
  }},

  {name: 'dock: first visit to the meeting room is quick and does not stall', async run(p, expect) {
    // Real speed and no ?debug, as visitors get it.
    await p.goto('/');
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
    await p.until(UP, {timeout: 40000, what: 'model ready'});
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

  {name: 'pond and energy cameras aim at the real objects', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000, what: 'model ready'});
    const centre = expr => (p.eval(`JSON.stringify((()=>{const V=__camera.position.constructor,objs=${expr};const min=new V(1e9,1e9,1e9),max=new V(-1e9,-1e9,-1e9);for(const o of objs)o.traverse(m=>{if(!m.geometry)return;m.geometry.computeBoundingBox();const g=m.geometry.boundingBox;for(const x of [g.min.x,g.max.x])for(const y of [g.min.y,g.max.y])for(const z of [g.min.z,g.max.z]){const v=new V(x,y,z).applyMatrix4(m.matrixWorld);min.min(v);max.max(v)}});return min.add(max).multiplyScalar(.5).toArray()})())`)).then(JSON.parse);
    const stops = {pond: `(()=>{const a=[];__scene.traverse(o=>{if(o.isMesh&&o.name.includes('_koi_pond_'))a.push(o)});return a})()`, energy: `[__scene.getObjectByName('Floor_5_solar_modules')]`};
    for (const [stop, objects] of Object.entries(stops)) {
      await p.click(`[data-destination="${stop}"]`);
      await p.until(`document.body.dataset.tourDestination === '${stop}' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000});
      const c = await centre(objects), t = await p.eval('__controls.target.toArray()');
      const off = Math.hypot(c[0] - t[0], c[2] - t[2]);
      expect(off < 1, `${stop}: camera aims within 1 m of the object (off by ${off.toFixed(1)} m)`);
    }
  }},
  {name: 'one gate on site: the car park\'s main gate', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000, what: 'model ready'});
    expect(!(await p.eval(`!!__scene.getObjectByName('Demo_barrier_arm')`)), 'no second (original) barrier arm');
    expect(await p.eval(`!!__scene.getObjectByName('Demo_main_barrier')`), 'the main gate');
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
  {name: 'meeting room: the door swings and the AC airflow flows and fades', async run(p, expect) {
    // Real speed: these animations are not scaled.
    await p.goto('?debug=1');
    await p.until(UP, {timeout: 40000, what: 'model ready'});
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
    const key = await p.eval(LEAVE_STAFF);
    await p.until(`!__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 20000, what: 'exit recorded'});
    const t0 = Date.now();
    // Another car going through meanwhile rightly keeps the arm up (background traffic: it failed now and then).
    await p.eval(`(()=>{window.__other=false;const sim=__parking.sim,from=sim.now(),f=()=>{if(__parking.traffic.inspect().under>1||sim.state.events.some(e=>e.at>from&&['entry','manual','exit'].includes(e.kind)))__other=true;if(sim.state.gate!=='closed')requestAnimationFrame(f);};f();})()`);
    await p.until(`__parking.sim.state.gate === 'closed'`, {timeout: 30000, what: 'barrier closed'});
    const s = (Date.now() - t0) * 10 / 1000, other = await p.eval('__other'), limit = other ? 20 : 6;
    expect(s < limit, `arm down within ${limit} s of demo time after the exit (took ${s.toFixed(1)} s${other ? ', another car went through meanwhile' : ''})`);
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
    // A view key on the 3D view too (the story's next camera move overrode the presenter's).
    await start(true); await p.eval(`document.querySelector('#viewport canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',code:'PageUp',bubbles:true,cancelable:true}))`); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'a view key on the 3D view ends an auto story');
    await start(true); await p.eval(`document.querySelector('#viewport canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',code:'ArrowLeft',ctrlKey:true,bubbles:true,cancelable:true}))`); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'Ctrl+arrow (it turns the view) ends it too');
    await start(false); await drag(); await p.sleep(200);
    expect(await p.eval('__parking.story.running'), 'in Next mode a drag only looks around');
    expect(/Exit story|ออกจากเรื่องราว/.test(await p.eval(`document.querySelector('[data-bar="free"]').textContent`)), 'an Exit story button');
    await p.click('[data-bar="free"]'); await p.sleep(200);
    expect(!(await p.eval('__parking.story.running')), 'Exit story ends it');
  }},

  {name: 'in the tour, tapping what the story cues (Approve) goes along with it: the tour and story play on', async run(p, expect) {
    // The tap counted as the visitor taking over: it ended the tour and its story, with no word why.
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000});
    await p.click('#tour-play');
    await p.until('__parking.story.running', {timeout: 40000, what: 'the tour reaches the parking story'});
    await p.eval(`new MutationObserver((m,o)=>{const b=document.querySelector('[data-act="approve"][data-cue="true"]');if(b){o.disconnect();b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.click();window.__tapped=1}}).observe(document.body,{subtree:true,childList:true,attributes:true})`);
    await p.until('window.__tapped', {timeout: 60000, what: 'the Approve cue'});
    await p.sleep(500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,touring:!!document.querySelector('#tour-play svg path[d^="M8 5v14"]'),status:${STORY_REQUEST}?.status})`));
    expect(r.story && r.touring && r.status === 'approved', `approved, and the story and tour play on (story ${r.story}, tour ${r.touring}, ${r.status})`);
  }},
  {name: 'step 6: Open once is off during the story; the camera moves on only once the visitor\'s car is in', async run(p, expect) {
    // Open once was there to press at step 6: the camera flew on to row A while the car was still on the street.
    await p.goto(parking('&story=1'));
    await p.until(`window.__parking && __parking.story.index===5 && document.querySelector('[data-act="manual-open"]')`, {timeout: 60000, what: 'step 6 on the Gate tab'});
    expect(await p.eval(`document.querySelector('[data-act="manual-open"]').disabled`), 'Open once is off while the story plays');
  }},
  {name: 'a story whose visitor cleared a field before Send still sends its request', async run(p, expect) {
    // The send failed (a required field empty) and the story went on about a request that never was.
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.waitingForNext', {timeout: 40000, what: 'step 1 typed'});
    await p.eval(`(()=>{const i=document.querySelector('#pk-phone input[name=email]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===1 && __parking.story.waitingForNext', {timeout: 30000, what: 'step 2 done'});
    expect(await p.eval(`!!${STORY_REQUEST}`), 'the story\'s request was sent');
  }},
  {name: 'leaving a story that is part of the tour ends the tour too', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(UP, {timeout: 40000});
    await p.click('#tour-play');
    await p.until('__parking.story.running && __parking.story.index >= 1', {timeout: 40000, what: 'tour reaches the parking story'});
    await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    await p.sleep(2500);
    const r = JSON.parse(await p.eval(`JSON.stringify({story:__parking.story.running,dest:document.body.dataset.tourDestination,pause:!!document.querySelector('#tour-play svg path[d^="M8 5v14"]')})`));
    expect(!r.story, 'the story stopped');
    expect(r.dest === 'parking' && !r.pause, `the tour stopped at the car park (at ${r.dest}, tour ${r.pause ? 'still running' : 'stopped'})`);
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
    // A sample within one step: a step that sets the story's time (09:41) jumps the clock by itself.
    let a, b;
    for (let i = 0; i < 10; i++) {
      const s0 = await p.eval('__parking.story.index'); a = await p.eval('__world.now()'); await p.sleep(500); b = await p.eval('__world.now()');
      if (await p.eval('__parking.story.index') === s0) break;
    }
    expect((b - a) / 1000 < SPEED * 1.5, `world clock at real speed during the story (${((b - a) / 1000).toFixed(0)} s in 0.5 s at speed ${SPEED})`);
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
    await p.until(LOADED, {timeout: 40000});
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 5000, what: 'night on the explore page'});
    expect(true, 'explore page is dark at 20:00');
  }},
];
