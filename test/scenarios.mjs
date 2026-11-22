// Behaviour checks for the demo, run by test/run.mjs. Pages load with ?speed=SPEED (default 30: demo timing 30× faster).
const SPEED = Number(process.env.SPEED) || 30;
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
const viewport = (p, width = 1600, height = 1000) => p.cdp('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});

export const scenarios = [
  {quick: true, name: 'showcase loads with the parking stop', async run(p, expect) {
    await p.goto(`?${FAST}`);
    await p.until(LOADED, {timeout: 40000, what: 'model ready'});
    expect(await p.eval('document.querySelectorAll(".destination-dock [data-destination]").length') === 5, 'dock has 5 stops');
    // One column per stop: a grid with a column to spare left an empty slot after the last stop.
    const gap = await p.eval(`(()=>{const d=document.querySelector('.destination-dock'),b=[...d.querySelectorAll('[data-destination]')].at(-1);return Math.round(d.getBoundingClientRect().right-b.getBoundingClientRect().right);})()`);
    expect(gap < 16, `the stops fill the dock (${gap} px after the last)`);
  }},

  {name: 'a story whose request is rejected still finishes: the visitor is turned away at the barrier', async run(p, expect) {
    // Rejected at step 4, the visitor's car waited at the barrier for an alert nobody answered, and the story stalled.
    // The presenter's Reject stands in for the story's own approval here.
    await p.goto(parking('&story=1'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000, what: 'story start'});
    await p.eval(`(()=>{const sim=__parking.sim;sim.approve=id=>sim.reject(id,'ไม่มีนัดหมาย')})()`);
    await p.until('!__parking.story.running', {timeout: 90000, what: 'story end'});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const s=__parking.sim.state,k=s.requests.length&&__parking.sim.key(${JSON.stringify(STORY_PLATE)},${STORY_REQUEST}?.province);const ev=s.events.filter(e=>e.plate===${JSON.stringify(STORY_PLATE)});
      return {status:${STORY_REQUEST}?.status,entered:ev.some(e=>e.kind==='entry'),denied:ev.some(e=>e.kind==='denied'),parked:s.presence.has(k),open:s.alerts.filter(a=>a.status==='open').length,index:__parking.story.index}})())`));
    expect(r.status === 'rejected', `the visitor's request rejected (got ${r.status})`);
    expect(!r.entered && !r.parked && r.denied, `the visitor's car turned away at the barrier, never parked (entered ${r.entered}, parked ${r.parked}, denied ${r.denied})`);
    expect(r.index === -1 && r.open === 0, `the story ran to its end with no alert left open (step ${r.index}, ${r.open} open)`);
  }},
  {name: 'a plate already listed is not added again, by hand or by importing twice; visitor cars get their own colours', async run(p, expect) {
    // A second listing of a plate looked idle, drove in again and kept a bay; and every free-play visitor car came out
    // the story car's blue, then (a later slip) white.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const s=__parking.sim,v=s.state.vehicles.find(v=>v.type==='staff'),n=()=>s.state.vehicles.length,before=n();
      const again=s.addVehicle({plate:v.plate.replace(' ','-'),province:v.province,owner:'ซ้ำ'});const first=s.importCsv(),mid=n(),second=s.importCsv();
      const colours=new Set(Array.from({length:8},(_,i)=>s.submitRequest({visitor:{name:'ทดสอบ '+i,phone:'080',email:'c'+i+'@example.com',company:'—'},contact:'host.demo@osd.example',plate:'9ทส '+(1000+i),province:'กรุงเทพมหานคร',arrival:s.now(),departure:s.now(),color:undefined}).color));
      return {again,first,second,added:mid-before,after:n()-mid,colours:[...colours]}})())`));
    expect(r.again === null, `the same plate (written with a hyphen) is refused (${JSON.stringify(r.again)})`);
    expect(r.first === 3 && r.second === 0 && r.added === 3 && r.after === 0, `the sample list adds 3 once, then none (${r.first}, ${r.second})`);
    expect(r.colours.length > 2 && r.colours.every(c => Number.isInteger(c)), `visitor cars get varied colours (${r.colours.join(', ')})`);
  }},
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
  {name: 'email toasts say which email went: a rejection is not "ticket emailed"', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const q=__parking.sim.state.requests.find(q=>q.status==='pending');__parking.sim.reject(q.id,'ทดสอบ')})()`);
    await p.until(`document.querySelector('.pk-toast')`, {timeout: 3000, what: 'a toast'});
    const toasts = await p.eval(`[...document.querySelectorAll('.pk-toast')].map(t=>t.textContent).join(' | ')`);
    expect(/ไม่อนุมัติ/.test(toasts) && !/ยืนยัน/.test(toasts), `the rejection's toast (${toasts})`);
  }},
  {name: 'guided story: Next pulses while the story waits for it; rejected at step 3, step 4 says so', async run(p, expect) {
    // The bar was not redrawn as Next began waiting: its pulse showed only while the next step ran. And step 4 said
    // "Approve in one tap" over a request rejected at step 3.
    await p.goto(parking('&story=1&auto=0'));
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    await p.until('__parking.story.waitingForNext', {timeout: 30000, what: 'step 1 waiting'});
    await p.sleep(200);
    expect(await p.eval(`!!document.querySelector('[data-bar="next"][data-cue="true"]')`), 'Next pulses while the story waits');
    for (let i = 0; i < 2; i++) { await p.click('[data-bar="next"]'); await p.until(`__parking.story.index===${i + 1} && __parking.story.waitingForNext`, {timeout: 30000, what: `step ${i + 2}`}); }
    await p.eval(`__parking.sim.reject(${STORY_REQUEST}.id,'ทดสอบ')`);
    await p.click('[data-bar="next"]');
    await p.until('__parking.story.index===3 && __parking.story.waitingForNext', {timeout: 30000, what: 'step 4'});
    const title = await p.eval(`document.querySelector('.pk-caption strong')?.textContent`);
    expect(title === 'คำขอนี้ไม่ได้รับอนุมัติ', `step 4's rejected caption (${title})`);
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
  {name: 'story on auto-advance: a Reject tapped at the Approve cue is not overridden', async run(p, expect) {
    // The story approved 2.6 s after the cue whatever the presenter had started: the reject form vanished under them.
    await p.goto('?dest=parking&debug=1&speed=5&warm=0&story=1');
    await p.until('window.__parking && __parking.story.running', {timeout: 40000});
    await p.eval(`new MutationObserver((m,o)=>{const b=document.querySelector('[data-act="approve"][data-cue="true"]')&&document.querySelector('[data-act="reject"]');if(b){o.disconnect();b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.click();window.__tapped=performance.now()}}).observe(document.body,{subtree:true,childList:true,attributes:true})`);
    await p.until('window.__tapped', {timeout: 60000, what: 'the Approve cue'});
    await p.sleep(800); // 4 s of demo time: past the 2.6 s the story waited
    const r = JSON.parse(await p.eval(`JSON.stringify({status:${STORY_REQUEST}?.status,form:!!document.querySelector('.pk-reject textarea')})`));
    expect(r.status === 'pending' && r.form, `still pending with the reject form open (${r.status}, form ${r.form})`);
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
  {name: 'an unknown car\'s Open reason is one choice, in the console card and the pop-up alike', async run(p, expect) {
    // Each kept its own: the card's "plate misread", then Open in the pop-up, logged the pop-up's default.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111') && document.querySelector('[data-alert-reason]') && document.querySelector('[data-pop="open"]')`, {timeout: 30000, what: 'the alert in the card and the pop-up'});
    await p.eval(`(()=>{const s=document.querySelector('[data-alert-reason]');s.value='gate.reason.misread';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    const pop = await p.eval(`document.querySelector('[data-pop-reason]').value`);
    await p.click('[data-pop="open"]');
    const logged = await p.eval(`__parking.sim.state.audit.find(a=>a.target==='1กก 1111')?.reasonKey`);
    expect(pop === 'gate.reason.misread' && logged === 'gate.reason.misread', `the pop-up shows and opens with the card's reason (shown ${pop}, logged ${logged})`);
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
  {name: 'a tap on the plate camera card or a toast leaves an auto story playing', async run(p, expect) {
    // Neither is the 3D view, but a tap on either ended the story (toasts caught taps meant for the view under them).
    await p.goto(parking('&story=1'));
    await p.until(`window.__parking && __parking.story.running && document.querySelector('.pk-feed:not([hidden])')`, {timeout: 90000, what: 'the plate camera card in the story'});
    await p.eval(`document.querySelector('.pk-feed').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await p.sleep(200);
    expect(await p.eval('__parking.story.running'), 'the story plays on after a tap on the camera card');
    expect(await p.eval(`getComputedStyle(document.querySelector('.pk-toasts')).pointerEvents`) === 'none', 'toasts let taps through');
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

  {name: 'a car at the barrier keeps its bay through a jump in time, and its lamps on while the arm rises', async run(p, expect) {
    // It picked its bay before the arm rose but took it only after: a jump meanwhile made up another car in the same
    // bay. And with its bay given, it counted as parked, lamps off, while still waiting at the barrier.
    await p.goto(parking('&time=07:00'));
    await p.until(ready, {timeout: 40000});
    const pick = `(()=>{const inside=new Set([...__parking.sim.state.presence.values()].map(p=>p.vehicleId));const v=__parking.sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)&&!__parking.traffic.isArriving(__parking.sim.key(v.plate,v.province)));
      window.__plate=v.plate;void __parking.traffic.arrive({plate:v.plate,province:v.province,color:v.color,fromX:-40});return __parking.sim.key(v.plate,v.province)})()`;
    // Acts the moment the arm starts up for this car (at ?speed=30 it is up within a few frames: polling missed it).
    const car = `__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__plate)`;
    // (Before the car is picked, __plate is not set yet: a background car opening the barrier then threw in the app.)
    const atGate = act => `(()=>{const sim=__parking.sim,set=sim.setGate;sim.setGate=g=>{set(g);const c=typeof __plate==='string'?${car}:null;if(g==='opening'&&c&&Math.hypot(c.position.x+23,c.position.z-21.9)<2.5){sim.setGate=set;${act}}};})()`;
    await p.eval(atGate(`__world.jumpTo(12*60);window.__acted=true;`));
    const key = await p.eval(pick);
    await p.until('window.__acted', {timeout: 30000, what: 'the arm rising for the car'});
    await p.until(`__parking.sim.state.presence.has(${JSON.stringify(key)})`, {timeout: 30000, what: 'entry recorded'});
    const shared = await p.eval(`(()=>{const seen=new Map();for(const [k,p] of __parking.sim.state.presence){if(seen.has(p.stallId))return p.stallId+': '+seen.get(p.stallId)+' & '+k;seen.set(p.stallId,k);}return '';})()`);
    expect(!shared, `every bay holds one car (${shared || 'none shared'})`);
    // Night: the waiting car's lamps while the arm rises (read two frames on, once the lamps have followed).
    await p.goto(parking('&time=21:00'));
    await p.until(ready, {timeout: 40000});
    await p.eval(atGate(`requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__lamps=${car}.getObjectByName('Demo_car_headlight_beams').visible;}));`));
    await p.eval(pick);
    await p.until(`window.__lamps!==undefined`, {timeout: 30000, what: 'the arm rising for the car'});
    const lamps = await p.eval('__lamps');
    expect(lamps === true, `the car's headlights stay on while the arm rises (${lamps})`);
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
  {name: 'Requests: a focused row keeps its request when a new one comes in', async run(p, expect) {
    // Rows were reused by position: a request arriving at the top moved every row's content down one, so a focused
    // row (Enter opens it) went on to stand for another request.
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    await p.click('[data-tab="requests"]');
    await p.click('[data-req-filter="all"]');
    await p.eval(`(()=>{const b=document.querySelectorAll('[data-request]')[1];window.__id=b.dataset.request;window.__b=b;b.focus();})()`);
    await p.eval(`__parking.sim.submitRequest({visitor:{name:'ทดสอบ ใหม่',phone:'080-000-0000',email:'new@example.com',company:'—'},contact:'host.demo@osd.example',plate:'1กก 1234',province:'กรุงเทพมหานคร',arrival:__world.now(),departure:__world.now()})`);
    await p.until(`document.querySelectorAll('[data-request]')[0].dataset.request!==document.querySelectorAll('[data-request]')[1].dataset.request && [...document.querySelectorAll('[data-request]')].some(b=>b.textContent.includes('ทดสอบ'))`, {timeout: 5000, what: 'the new request listed'});
    const r = JSON.parse(await p.eval(`JSON.stringify({id:document.activeElement?.dataset?.request,same:document.activeElement===__b})`));
    expect(r.id === await p.eval('__id') && r.same, `the focused row still stands for its request (${r.id} vs ${await p.eval('__id')}, same element ${r.same})`);
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
      const t=setInterval(()=>{const c=__parking.lot.root.children.find(c=>c.name==='Demo_car_'+__plate);if(!c)return;if(Math.abs(c.position.z-28)<.3)__farLane=true;if(c.getObjectByName('Demo_car_blinker_right')?.visible){__right=true;if(c.position.x>20)__early=c.position.x;}if(__parking.sim.state.presence.has(__k))clearInterval(t);},20);
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
      const iv=setInterval(()=>{if(c.getObjectByName('Demo_car_blinker_right')?.visible&&c.position.z<20)__o.right=true;if(Math.abs(c.position.z-28)<.2&&Math.sin(c.rotation.y)<-.99)__o.far=true;if(c.position.x<-45)__o.west=true;if(!c.parent)clearInterval(iv);},20);
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
  {name: 'a far-lane car nearly at its turn goes in before a near-lane car that appears further back', async run(p, expect) {
    // A near-lane car took its turn as it appeared, 50 m out: a far-lane car reaching its turn first stood there
    // signalling while the near-lane one drove up and went in.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0');
    await p.until(ready, {timeout: 40000});
    const [far, near] = JSON.parse(await p.eval(`JSON.stringify((()=>{const sim=__parking.sim,t=__parking.traffic,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));
      t.passBy=()=>false;
      const [a,b]=sim.state.vehicles.filter(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id));
      void t.arrive({plate:a.plate,province:a.province,color:a.color,west:true});
      // Sent as the far-lane car comes within 16 m of its turn (x -16.9): the near-lane one then has some 30 m to drive
      // to its decision point. By position, not a timer (a late timer could let the old order pass).
      const go=()=>{const c=__scene.getObjectByName('Demo_car_'+a.plate);if(!c||!c.visible||c.position.x>-0.9)return setTimeout(go,10);void t.arrive({plate:b.plate,province:b.province,color:b.color,fromX:-70})};go();
      return [sim.key(a.plate,a.province),sim.key(b.plate,b.province)]})())`));
    await p.until(`[${JSON.stringify(far)},${JSON.stringify(near)}].every(k=>__parking.sim.state.presence.has(k))`, {timeout: 40000, what: 'both cars in'});
    const [nearAt, farAt] = await p.eval(`(()=>{const e=__parking.sim.state.events.filter(e=>e.kind==='entry');const at=k=>e.find(v=>__parking.sim.key(v.plate,v.province)===k)?.at;return [at(${JSON.stringify(near)}),at(${JSON.stringify(far)})]})()`);
    expect(farAt < nearAt, `the far-lane car, at the entry first, went in first (${((nearAt - farAt) / 1000).toFixed(0)} s of demo time before the near-lane one)`);
  }},
  {name: 'a queued car drives up to the stop line as the arm rises for the car ahead', async run(p, expect) {
    // It set off only once the car ahead was wholly past the arm, and reached the stop line as that car got to its aisle.
    // The car ahead is an unknown one, held at the barrier until it is let in: the one behind is surely queued by then.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0&time=06:00');
    await p.until(ready, {timeout: 40000});
    const b0 = await p.eval(`(()=>{const sim=__parking.sim,inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId));return sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)).plate})()`);
    expect(await p.eval(ONLY(['1กก 1111', b0])), 'the car park quiet first');
    const plate = await p.eval(`(()=>{const sim=__parking.sim,t=__parking.traffic;
      const b=sim.state.vehicles.find(v=>v.plate===${JSON.stringify(b0)});
      void t.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:1,fromX:-40});setTimeout(()=>void t.arrive({plate:b.plate,province:b.province,color:2,fromX:-50}),300);return b.plate})()`);
    const B = `__scene.getObjectByName('Demo_car_'+${JSON.stringify(plate)})`;
    await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`, {timeout: 20000, what: 'the car ahead held at the barrier'});
    await p.until(`(()=>{const b=${B};if(!b||!b.visible||b.position.z<24)return false;const x=b.position.x,r=window.__bx===x;window.__bx=x;return r})()`, {timeout: 20000, what: 'the car behind standing in the queue'});
    const z = await p.eval(`(async()=>{const a=__parking.sim.state.alerts.find(a=>a.status==='open'&&a.plate==='1กก 1111');__parking.sim.resolveAlert(a.id,'open','gate.reason.delivery');
      const b=${B},x0=b.position.x,A=__scene.getObjectByName('Demo_car_1กก 1111');for(let i=0;i<1000;i++){await new Promise(r=>setTimeout(r,10));if(Math.abs(b.position.x-x0)>.05)return A.position.z;}return null})()`);
    expect(z !== null && z > 18.6, `the car behind set off with the one ahead still at the barrier (its z ${z?.toFixed?.(1)}; past the arm is under 17.7)`);
  }},
  {name: 'a car leaving, a VIP behind it and two cars queued with far-lane traffic all get through (no gridlock)', async run(p, expect) {
    // The next queued car set off as the arm rose for one that then stopped under it behind a VIP waiting for the car
    // at the exit barrier; that car waited for the approaching one (`inbound`): each waited for the next, for good.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0&time=03:00');
    await p.until(ready, {timeout: 40000});
    const r = JSON.parse(await p.eval(`(async()=>{const S=10,T=__parking.traffic,sim=__parking.sim,sleep=ms=>new Promise(r=>setTimeout(r,ms/S));
      const pass=T.passBy;T.passBy=()=>false;
      const quiet=()=>{const i=T.inspect();return !T.busy&&!i.gateHolders&&!i.entryPending&&!T.leaving};
      for(let i=0;i<200&&!quiet();i++)await sleep(200);
      const free=type=>sim.state.vehicles.filter(v=>v.type===type&&v.enabled&&v.sync==='synced'&&!sim.state.presence.has(sim.key(v.plate,v.province))&&!T.isAround(sim.key(v.plate,v.province)));
      const lv=free('staff')[0],st=sim.state.stalls.find(s=>s.row==='A'&&!s.occupant&&s.z>5);
      sim.recordEntry({plate:lv.plate,province:lv.province,type:'staff',stallId:st.id,color:2});const kL=sim.key(lv.plate,lv.province);T.appear(kL);await sleep(300);
      const vip=free('vip')[0],[c2,c3]=free('staff');
      void T.leave(kL,{west:true});
      let far=setInterval(()=>pass(-1),4400/S);
      void T.arrive({plate:vip.plate,province:vip.province,color:5,fromX:-45});await sleep(1500);
      void T.arrive({plate:c2.plate,province:c2.province,color:3,fromX:-60});await sleep(1500);
      void T.arrive({plate:c3.plate,province:c3.province,color:7,fromX:-70});
      const t0=performance.now();
      while((performance.now()-t0)*S<120000){await sleep(500);if(far&&T.inspect().westExitHold){clearInterval(far);far=null}if(quiet()&&!T.isAround(kL))break}
      if(far)clearInterval(far);
      const keys=[vip,c2,c3].map(v=>sim.key(v.plate,v.province));
      return JSON.stringify({done:quiet()&&!T.isAround(kL),parked:keys.filter(k=>sim.state.presence.has(k)&&!T.isAround(k)).length,s:T.inspect()})})()`));
    expect(r.done && r.parked === 3, `all through: the leaver gone, 3 cars parked (${r.parked}; inbound ${r.s.inbound}, gate holders ${r.s.gateHolders}, waiting ${r.s.entryPending})`);
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
    // At a queue place: the first at x -31.43, the next 6.5 m apart (a background car may have queued first).
    await p.until(`__parking.lot.root.children.some(c=>c.visible&&c.name==='Demo_car_'+__q[0].plate&&c.position.x<-31&&Math.abs(c.position.z-25.1)<.1&&Math.abs(((c.position.x+31.43)%6.5+6.5)%6.5-3.25)>3.1)`, {timeout: 30000, what: 'the first queued car at its place'});
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
  {name: 'a car leaving an aisle frees it once it has turned out, not at the exit barrier', async run(p, expect) {
    // It held its aisle until it stood at the exit barrier: a car waiting to go in waited all that time.
    await p.goto('?dest=parking&debug=1&speed=10&warm=0&time=06:00');
    await p.until(ready, {timeout: 40000});
    expect(await p.eval(ONLY([])), 'the car park quiet first');
    const r = JSON.parse(await p.eval(`(async()=>{const sim=__parking.sim,t=__parking.traffic;
      // A staff car put in a free bay of row B (the quiet car park may have none parked).
      const inside=new Set([...sim.state.presence.values()].map(p=>p.vehicleId)),v=sim.state.vehicles.find(v=>v.type==='staff'&&v.sync==='synced'&&!inside.has(v.id)),bay=sim.state.stalls.find(s=>s.row==='B'&&!s.occupant);
      sim.recordEntry({plate:v.plate,province:v.province,type:'staff',stallId:bay.id,color:2});const k=sim.key(v.plate,v.province);t.appear(k);await new Promise(r=>setTimeout(r,300));
      const stall=sim.state.stalls.find(s=>s.id===sim.state.presence.get(k).stallId),plate=sim.state.presence.get(k).plate,ax=String(stall.aisleX);
      void t.__leave(k,{west:false});
      const car=()=>__scene.getObjectByName('Demo_car_'+plate);let freedAt=null,held=false; // freed: the aisle taken, then let go
      for(let i=0;i<600;i++){await new Promise(r=>setTimeout(r,20));const c=car();if(!c)break;const out=t.inspect().aisles[ax]?.out??0;
        if(out>0)held=true;else if(held&&freedAt===null)freedAt=c.position.z;if(Math.abs(c.position.z-${19.3 - 2.7})<.3&&c.position.x>-21)break;}
      return JSON.stringify({freedAt,aisle:ax})})()`));
    // Not before it is out of the aisle either: on the exit lane (z 14.8), past the turn out of the aisle.
    expect(r.freedAt !== null && r.freedAt > 13.8 && r.freedAt < 15.5, `the aisle (${r.aisle}) freed once the car was on the exit lane, before the barrier (at z ${r.freedAt?.toFixed?.(1)})`);
  }},
  {name: 'the ground is grass, on the real start-up path (shaders warmed up)', async run(p, expect) {
    // A flat pale plane; and on the test GPU the grass drew as background when its shader came from the first frame.
    await p.goto('?dest=overview&debug=1&speed=30');
    await p.until(`window.__scene && document.documentElement.dataset.warm === 'done'`, {timeout: 60000, what: 'warm-up done'});
    const px = JSON.parse(await p.eval(`JSON.stringify((()=>{__controls.target.set(30,0,45);__camera.position.set(30,30,75);__controls.update();
      const r=__renderer,gl=r.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;r.render(__scene,__camera);
      const v=new __camera.position.constructor(30,.3,45).project(__camera),b=new Uint8Array(4);gl.readPixels(Math.round((v.x+1)/2*w),Math.round((v.y+1)/2*h),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b].slice(0,3)})())`));
    expect(px[1] > px[0] + 10 && px[1] > px[2] + 20, `a ground pixel 54 m out is grass green (${px})`);
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
    // At a queue place: the first at x -31.43, the next 6.5 m apart (a background car may have queued first).
    await p.until(`(c=>!!c&&c.visible&&c.position.x<-31&&Math.abs(c.position.z-25.1)<.1&&Math.abs(((c.position.x+31.43)%6.5+6.5)%6.5-3.25)>2.95)(${car})`, {timeout: 20000, what: 'the car at its queue place'});
    const seen = await p.eval(`new Promise(done=>{let left=false;const t=setInterval(()=>{if(${car}.getObjectByName('Demo_car_blinker_left')?.visible)left=true;},15);setTimeout(()=>{clearInterval(t);done(left);},600);})`);
    expect(seen, 'its left blinker flashed while it queued');
  }},
  {name: 'a busy car park: no car drives through another', async run(p, expect) {
    // Cars queuing at the barrier ran into each other (a new car was given the queue place of one still in it), met
    // head-on in the aisles, and crossed at the aisle mouths; through-traffic drove through a car waiting at the
    // barrier, whose rear reached into the near lane. Every pair of cars, every frame, as rotated rectangles.
    await p.goto('?dest=parking&debug=1&speed=20&warm=0&time=08:00');
    await p.until(ready, {timeout: 40000});
    await p.eval(`(()=>{const L=4.46/2,W=1.72/2;window.__hits=[];window.__frames=0;
 const corners=c=>{const h=c.rotation.y,f=[Math.sin(h),Math.cos(h)],s=[Math.cos(h),-Math.sin(h)],x=c.position.x,z=c.position.z;return [[1,1],[1,-1],[-1,-1],[-1,1]].map(([a,b])=>[x+f[0]*L*a+s[0]*W*b,z+f[1]*L*a+s[1]*W*b]);};
 const sep=(A,B)=>{for(const P of [A,B])for(let i=0;i<4;i++){const p=P[i],q=P[(i+1)%4],n=[q[1]-p[1],p[0]-q[0]];let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;for(const v of A){const d=v[0]*n[0]+v[1]*n[1];a0=Math.min(a0,d);a1=Math.max(a1,d);}for(const v of B){const d=v[0]*n[0]+v[1]*n[1];b0=Math.min(b0,d);b1=Math.max(b1,d);}if(a1<b0||b1<a0)return true;}return false;};
 const last=new Map();
 const f=()=>{__frames++;const cars=__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car')&&c.visible);
  const moved=new Set();for(const c of cars){const k=c.position.x+','+c.position.z+','+c.rotation.y;if(last.get(c)!==k)moved.add(c);last.set(c,k);}
  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){const a=cars[i],b=cars[j];if(!moved.has(a)&&!moved.has(b))continue;
   if(Math.hypot(a.position.x-b.position.x,a.position.z-b.position.z)>5)continue;
   if(!sep(corners(a),corners(b))&&__hits.length<400)__hits.push(\`\${a.name.slice(9)||'street'}@\${a.position.x.toFixed(1)},\${a.position.z.toFixed(1)} x \${b.name.slice(9)||'street'}@\${b.position.x.toFixed(1)},\${b.position.z.toFixed(1)} t\${__world.minute().toFixed(0)}\`);}
  window.__holders=Math.max(window.__holders||0,__parking.traffic.gateHolders);
  requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    await p.click('[data-tab="gate"]');
    // The morning rush at twice the usual pace: a car in or out every 0.7 s, and through-traffic both ways.
    for (let i = 0; i < 22; i++) {
      await p.eval(`document.querySelector('[data-sim="${['registered', 'exit', 'visitor', 'registered', 'exit'][i % 5]}"]')?.click();__parking.traffic.passBy(1);__parking.traffic.passBy(-1)`);
      await p.sleep(700);
    }
    const hits = await p.eval('__hits');
    expect(hits.length === 0, `no overlapping cars in ${await p.eval('__frames')} frames (${hits.slice(0, 3).join(' | ') || 'none'})`);
    // One car at a time worked the barrier, so an arriving car waited behind a leaving one waiting for a gap.
    expect(await p.eval('__holders') === 2, `a car going in and one going out at the barrier at once (most at a time: ${await p.eval('__holders')})`);
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
    await p.until(`(__parking.traffic.passBy(1), !!(window.__thru = __parking.lot.root.children.find(c => c.name === 'Demo_car_' && c.visible && Math.abs(c.position.z - 25.1) < .3 && c.position.x < -60)))`, {timeout: 20000, what: 'an eastbound through car'});
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

  {quick: true, name: 'English switch leaves only names, plates and provinces in Thai', async run(p, expect) {
    await p.goto(parking());
    // The whole showcase up, not only the car park: a switch clicked before its button is wired does nothing.
    await p.until(`${ready} && ${UP}`, {timeout: 40000});
    await p.click('#lang-toggle');
    await p.until(`document.documentElement.lang==='en'`, {timeout: 3000, what: 'the page in English'});
    await p.sleep(300);
    const scan = `JSON.stringify((()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const t=n.textContent.trim();const el=n.parentElement;if(!/[\\u0E00-\\u0E7F]/.test(t.replace(/\\d?[\\u0E01-\\u0E2E]{1,3} \\d{1,4}/g,''))||!el||el.offsetParent===null||el.closest('[hidden],#legacy-controls,.pk-plate-chip,.pk-plate-big,.ph-ticket-plate,.pk-feed-plate,[name=province] option,.pk-attention small,.pk-name'))continue;out.add(t.slice(0,40));}
      for(const o of document.querySelectorAll('select:not([name=province]) option'))if(o.closest('select').offsetParent&&/[\\u0E00-\\u0E7F]/.test(o.text))out.add('option: '+o.text.slice(0,40));return [...out]})())`;
    // Every tab of the console and the phone, not only the overview on show.
    const thai = new Set(JSON.parse(await p.eval(scan)));
    await p.click('[data-bar="phone"]');
    for (const tab of ['requests', 'vehicles', 'gate', 'reports']) {
      await p.click(`[data-tab="${tab}"]`); await p.sleep(150);
      for (const t of JSON.parse(await p.eval(scan))) thai.add(`${tab}: ${t}`);
    }
    await p.click('#lang-toggle');
    expect(thai.size === 0, `no stray Thai UI text (found: ${[...thai].join(' | ')})`);
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
    await p.goto(EXPLORE);
    await p.until(LOADED, {timeout: 40000, what: 'model ready'});
    expect(await p.eval(`document.querySelector('.back-link')?.getAttribute('href')`) === '#showcase', 'back link to the showcase');
    expect(await p.eval(`!document.querySelector('a[download]')`), 'no model download link (the demo runs locally)');
  }},

  {name: 'explore page: Reset view from the stairs puts back the floor\'s label; turning the screen keeps the stairs view', async run(p, expect) {
    // Reset view (or R) framed the floor under the stairs' label; a turned phone threw the visitor out of the stairs.
    await p.goto(EXPLORE);
    await p.until(LOADED, {timeout: 40000, what: 'model ready'});
    await p.click('#stairs');
    const stairs = await p.eval(`document.querySelector('#view-label').textContent`);
    await viewport(p, 1000, 1600);
    await p.sleep(400);
    expect(await p.eval(`document.querySelector('#view-label').textContent`) === stairs && await p.eval('__camera.fov') !== 38, `the stairs view kept on a turned screen (${stairs})`);
    await viewport(p);
    await p.click('#reset');
    const label = await p.eval(`document.querySelector('#view-label').textContent`);
    expect(label !== stairs && !/บันได|Stairs/.test(label), `the floor's label after Reset view (${stairs} -> ${label})`);
  }},
  {name: 'browser Back from the explore page shows the showcase again; the kiosk keeps the showcase', async run(p, expect) {
    // Back changed only the hash and left the explore page on screen; in the kiosk, Explore left for a page with no kiosk.
    await p.goto(`?${FAST}`);
    await p.until(LOADED, {timeout: 40000, what: 'showcase'});
    await p.click('.explore-link');
    await p.until(`location.hash==='#explore' && !!document.querySelector('#view-label') && ${LOADED}`, {timeout: 40000, what: 'the explore page'});
    await p.eval('history.back()');
    await p.until(`document.body.classList.contains('showcase-page') && ${LOADED}`, {timeout: 40000, what: 'the showcase after Back'});
    await p.goto(`?kiosk=1&${FAST}`);
    await p.until(`${LOADED} && document.body.classList.contains('kiosk-on')`, {timeout: 40000, what: 'the kiosk'});
    expect(await p.eval(`!document.querySelector('.explore-link').offsetParent`), 'no Explore link in the kiosk');
    await p.eval(`window.__stay=1;document.querySelector('.tour-brand').click()`);
    await p.sleep(500);
    expect(await p.eval(`window.__stay===1 && document.body.classList.contains('kiosk-on')`), 'the logo does nothing in the kiosk (no reload)');
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

  {name: 'approval follow-ups (ATOM sync, ticket email) are dropped after a revoke or a reset', async run(p, expect) {
    await p.goto(parking());
    await p.until(ready, {timeout: 40000});
    const due = 1600 / SPEED + 400; // the follow-ups come ~1.6 s of demo time after the approval
    const kinds = await p.eval(`(async()=>{const s=__parking.sim,q=s.state.requests.find(q=>q.status==='pending');window.__unconfirmed=q.id;s.approve(q.id);s.revoke(q.id);
      await new Promise(r=>setTimeout(r,${due}));return s.state.emails.filter(m=>m.requestId===q.id).map(m=>m.kind).join()})()`);
    // Revoked before ATOM confirmed it: the visitor was never told of the approval, so gets no email at all (as in the
    // ATOM Parking app); revoked once confirmed, the revocation email goes out.
    expect(kinds === '', `a request revoked before ATOM confirmed it sends no email (${kinds})`);
    const confirmed = await p.eval(`(async()=>{const s=__parking.sim,day=s.now();
      const q=s.submitRequest({visitor:{name:'ทดสอบ ระบบ',phone:'080-000-0000',email:'test@example.com',company:'—'},contact:'host.demo@osd.example',plate:'1ทด 1111',province:'กรุงเทพมหานคร',arrival:day,departure:day});s.approve(q.id);
      await new Promise(r=>setTimeout(r,${due}));s.revoke(q.id);return s.state.emails.filter(m=>m.requestId===q.id).map(m=>m.kind).reverse().join()})()`);
    expect(confirmed === 'approved,revoked', `a request revoked after ATOM confirmed it gets the revocation email after its ticket (${confirmed})`);
    const late = await p.eval(`(()=>{const q=__parking.sim.state.requests.find(q=>q.id===__unconfirmed);return q.history.map(h=>h.key).join()+' | listed: '+__parking.sim.state.vehicles.some(v=>v.requestId===q.id)})()`);
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
    // Nor does the free-play read land in the story's form on the way (step 2's own read wrote over it after).
    await p.eval(`(()=>{window.__plates=new Set();const t=setInterval(()=>{const v=document.querySelector('#pk-phone input[name=plate]')?.value;if(v)__plates.add(v);if(${STORY_REQUEST})clearInterval(t)},20)})()`);
    await p.click('[data-bar="play"]');
    await p.until(`!!${STORY_REQUEST}`, {timeout: 40000, what: 'story request submitted'});
    const plate = await p.eval(`${STORY_REQUEST}.plate`), seen = await p.eval('[...__plates]');
    expect(plate === STORY_PLATE, `story request has the story plate (${plate})`);
    expect(seen.every(v => v === STORY_PLATE), `only the story plate in its form (${seen.join(', ')})`);
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
      // Landed (a fixed wait read the bar early under load), then the layout's 0.35 s change.
      await p.until(`document.body.dataset.tourDestination === '${stop}' && !document.querySelector('[data-destination][aria-busy=true]')`, {timeout: 20000, what: `landing at ${stop}`});
      await p.sleep(450);
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
  {name: 'room-colour bar waits for a real landing (also after R); narrow views keep the title beside it', async run(p, expect) {
    await viewport(p, 760, 900);
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
    } finally { await viewport(p); }
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
    // Read each time the pond is actually drawn (the mirror sets the value just before; when the pond is off screen it
    // is not drawn and the value is not used), with whether the camera was flying. The water's material may be a cut
    // copy mid-flight: it must still show the mirror's picture (a copy that lost it drew the pond black).
    await p.eval(`(()=>{window.__mixes=[];window.__blind=0;const w=__scene.getObjectByName('Courtyard_water_reflection'),before=w.onBeforeRender;w.onBeforeRender=function(...a){before.apply(this,a);const u=this.material.uniforms;if(u.reflectionMix.value>0&&!u.tDiffuse.value)__blind++;__mixes.push([document.querySelector('#viewport').classList.contains('flying'),u.reflectionMix.value]);};})()`);
    await p.click('[data-destination="pond"]');
    await p.until(`document.body.dataset.tourDestination==='pond' && ${STILL}`, {timeout: 20000, what: 'landed at the pond'});
    await p.sleep(400);
    const flyingIn = (await p.eval('__mixes')).filter(([flying]) => flying).map(([, v]) => v);
    expect(flyingIn.length && flyingIn.every(v => v === 0), `flying in, the pond shows plain water (mix ${[...new Set(flyingIn)].join(', ')})`);
    const landing = (await p.eval('__mixes')).filter(([flying]) => !flying).map(([, v]) => v);
    expect(landing.at(-1) === 1 && landing.some(v => v > 0 && v < 1), `landed: the reflection fades back in (mix ${landing.slice(0, 6).map(v => v.toFixed(2)).join(', ')} … ${landing.at(-1)})`);
    await p.eval('__mixes.length=0');
    await p.click('[data-destination="overview"]');
    await p.until(`document.body.dataset.tourDestination==='overview' && ${STILL}`, {timeout: 20000, what: 'landed at the overview'});
    const leaving = (await p.eval('__mixes')).filter(([flying]) => flying).map(([, v]) => v);
    expect(leaving.length > 1 && leaving[0] > .5 && leaving.every((v, i) => !i || v <= leaving[i - 1]), `leaving, the reflection fades out (mix ${leaving.slice(0, 8).map(v => v.toFixed(2)).join(', ')})`);
    expect(await p.eval('__blind') === 0, `the water always had the mirror's picture while showing it (${await p.eval('__blind')} draws without)`);
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
  {name: 'car park layout: a second stop picked during the layout change still ends in the right layout', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    for (const [first, second, parked] of [['parking', 'energy', false], ['pond', 'parking', true]]) {
      await p.eval(`document.querySelector('[data-destination="${first}"]').click()`); await p.sleep(120);
      await p.eval(`document.querySelector('[data-destination="${second}"]').click()`);
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${second}'`, {timeout: 20000, what: `landed at ${second}`});
      await p.sleep(900); // any layout change still queued has run
      expect(await p.eval(`document.body.classList.contains('parking-active')`) === parked, `${first} then ${second}: the ${parked ? 'car park' : 'building'} layout`);
    }
  }},
  {name: 'no shader is built mid-flight, by day or night: the loading screen prepared them all', async run(p, expect) {
    // A shader built on the spot froze the view mid-flight: 30 ms for the first cut copies of the building's materials,
    // 0.1–0.2 s at night when hiding a floor (its room lights) changed the number of lights.
    for (const time of ['10:00', '20:30']) {
      await p.goto(`?debug=1&time=${time}`);
      await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
      const before = await p.eval('__renderer.info.programs.length');
      for (const to of ['parking', 'meeting', 'pond', 'energy', 'overview']) {
        await p.click(`[data-destination="${to}"]`);
        await p.until(`${IDLE} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      }
      const built = await p.eval(`__renderer.info.programs.slice(${before}).map(x=>x.name)`);
      expect(!built.length, `${time}: no shader built during the flights (${built.join(', ') || 'none'})`);
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
  {name: 'narrow screens: the story caption stays readable with the visitor\'s phone open', async run(p, expect) {
    // Beside the phone it had a 40–66 px column on phones and upright tablets: one word a line, cut off at the top.
    for (const [w, h] of [[390, 844], [768, 1024]]) {
      await viewport(p, w, h);
      await p.goto(parking('&story=1&auto=0'));
      await p.until('window.__parking && __parking.story.running', {timeout: 40000});
      await p.until(`__parking.story.waitingForNext && document.body.classList.contains('phone-open') && document.querySelector('.pk-caption:not([hidden])')`, {timeout: 30000, what: 'step 1 with the phone'});
      const r = JSON.parse(await p.eval(`JSON.stringify((()=>{const c=document.querySelector('.pk-caption').getBoundingClientRect(),v=document.querySelector('#viewport').getBoundingClientRect();return {w:c.width,vw:v.width,top:c.top-v.top,bottom:v.bottom-c.bottom}})())`));
      expect(r.w > r.vw * .8 && r.top >= 0 && r.bottom >= 0, `${w}×${h}: the caption across the view (${Math.round(r.w)} of ${Math.round(r.vw)} px), inside it`);
    }
    await viewport(p);
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
    await p.until(`${ready} && ${STILL}`, {timeout: 40000, what: 'at the car park'});
    const drift = await p.eval(`(()=>{const c=document.querySelector('#viewport canvas'),r=c.getBoundingClientRect(),V=__camera.position.constructor,nx=0,ny=-.6;
      const ground=()=>{const a=new V(nx,ny,.5).unproject(__camera),d=a.sub(__camera.position).normalize(),t=-__camera.position.y/d.y;return __camera.position.clone().addScaledVector(d,t)};
      const p0=ground();for(let i=0;i<4;i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:r.left+r.width*(nx+1)/2,clientY:r.top+r.height*(1-ny)/2,deltaY:-100,deltaMode:0}));
      __controls.update();const q=p0.clone().project(__camera);return Math.hypot((q.x-nx)*r.width/2,(q.y-ny)*r.height/2)})()`);
    expect(drift < 8, `the ground point under the cursor stays put (${drift.toFixed(1)} px)`);
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
  {name: 'the car park layout changes as one animation (a view transition), not in a single frame', async run(p, expect) {
    await p.goto('?debug=1');
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    const watch = `(()=>{window.__vt=new Set();const t0=performance.now();const f=()=>{for(const a of document.getAnimations())if(a.effect?.pseudoElement?.startsWith('::view-transition-group'))__vt.add(a.effect.pseudoElement);if(performance.now()-t0<600)requestAnimationFrame(f);};requestAnimationFrame(f);})()`;
    for (const to of ['parking', 'pond']) {
      await p.eval(watch); await p.click(`[data-destination="${to}"]`); await p.sleep(700);
      const groups = await p.eval('[...__vt]');
      expect(['tour-view', 'tour-dock', 'tour-panel'].every(n => groups.includes(`::view-transition-group(${n})`)), `to ${to}: the 3D view, the dock and the panel move to their new place (${groups.join(', ') || 'no transition'})`);
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
    }
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
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    // Each frame the pond is on screen: whether its water layer was drawn, and how far its mix moved since the last frame.
    await p.eval(`(()=>{const R=__renderer,w=__scene.getObjectByName('Courtyard_water_reflection'),pond=__scene.getObjectByName('Floor_1_koi_pond_0');window.__water={frames:0,missing:0,jump:0};let drawn=false,last=null;
      const ob=w.onBeforeRender;w.onBeforeRender=function(...a){ob.apply(this,a);drawn=true;const m=this.material.uniforms.reflectionMix.value;if(last!==null)__water.jump=Math.max(__water.jump,Math.abs(m-last));last=m;};
      const r=R.render.bind(R);R.render=(s,c)=>{if(R.getRenderTarget()||c!==__camera)return r(s,c);drawn=false;const o=r(s,c);
        pond.geometry.computeBoundingSphere();const q=pond.geometry.boundingSphere.center.clone().applyMatrix4(pond.matrixWorld).project(__camera);
        if(q.z<1&&Math.abs(q.x)<1&&Math.abs(q.y)<1){__water.frames++;if(!drawn)__water.missing++;}return o;};})()`);
    for (const to of ['pond', 'overview']) {
      await p.click(`[data-destination="${to}"]`);
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      await p.sleep(400);
    }
    const water = await p.eval('__water');
    expect(water.frames > 30 && water.missing === 0, `the water was drawn on every frame the pond was on screen (${water.frames - water.missing} of ${water.frames})`);
    // The fade runs on time (0.25 s): a slow frame under load covers more of it, but never the whole of it at once.
    expect(water.jump < .5, `its reflection fades in and out, never in one step (largest change in a frame ${water.jump.toFixed(2)})`);
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
    await p.until(`${IDLE} && document.documentElement.dataset.warm==='done'`, {timeout: 40000});
    await p.sleep(600);
    // Each frame: each room spot's brightness as drawn (0 while it or its floor is hidden); a change of more than half
    // of full (the brightest seen) in one frame is a light switching at once. The fades run on time (0.22 s each way): a slow frame
    // under load covers more of one, but never half of it.
    await p.eval(`(()=>{const spots=__scene.getObjectsByProperty('isSpotLight',true).filter(l=>l.name.startsWith('Simulation_spot'));window.__jumps=[];window.__moves=0;window.__full=0;let last=null;
      const shown=o=>{for(let x=o;x;x=x.parent)if(!x.visible)return false;return true;};
      const f=()=>{const now=spots.map(l=>({v:shown(l)?l.intensity:0,room:l.userData.roomId}));
        if(last)now.forEach((n,i)=>{if(n.room!==last[i].room)__moves++;__full=Math.max(__full,n.v);const d=Math.abs(n.v-last[i].v);if(d>30)__jumps.push({d,text:Math.round(d)+' '+last[i].room+'→'+n.room});});
        last=now;requestAnimationFrame(f);};requestAnimationFrame(f);})()`);
    for (const to of ['meeting', 'pond', 'energy', 'overview']) {
      await p.click(`[data-destination="${to}"]`);
      await p.until(`${IDLE} && document.body.dataset.tourDestination==='${to}'`, {timeout: 20000, what: `landed at ${to}`});
      await p.sleep(500);
    }
    expect(await p.eval('__moves') >= 3, `the lights moved between rooms as the floors changed (${await p.eval('__moves')} moves)`);
    const full = await p.eval('__full'), jumps = (await p.eval('__jumps')).filter(j => j.d > full / 2).map(j => j.text);
    expect(!jumps.length, `no light switched at once (${jumps.slice(0, 4).join(', ') || 'none'})`);
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
  {name: 'the koi keep swimming while a flight cuts their floor', async run(p, expect) {
    // The cut's material copies dropped the koi's shader hook (copy() leaves it out): the fish jumped back to their
    // modelled places for the length of the flight.
    await p.goto('?debug=1&warm=0&time=10:00');
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    const r = JSON.parse(await p.eval(`(async()=>{let n=0;const begin=__transition.begin;
      await new Promise(r=>{__transition.begin=(...a)=>{begin(...a);if(++n===2){__transition.begin=begin;r();}};document.querySelector('[data-destination="meeting"]').click();});
      const fish=[];__scene.traverse(o=>{if(o.isMesh&&/_koi_(?!pond)/.test(o.name))fish.push(o);});
      return JSON.stringify({fish:fish.length,cut:fish.filter(o=>__transition.isCopy(o.material)).length,swimming:fish.filter(o=>o.material.customProgramCacheKey()==='koi').length});})()`));
    expect(r.fish > 0 && r.cut > 0, `the flight cuts the koi (${r.cut} of ${r.fish} drawn through copies)`);
    expect(r.swimming === r.fish, `every koi keeps its swimming shader (${r.swimming} of ${r.fish})`);
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
  {name: 'the meeting room\'s light fade holds while paused', async run(p, expect) {
    // The lamp's fade ran on frame time: switched off and paused at once, the cone still faded out.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    const cone = `(()=>{let c=null;__scene.getObjectByName('Demo_meeting').traverse(o=>{if(o.geometry?.type==='CylinderGeometry')c=o;});return c.material.opacity;})()`;
    await p.sleep(800); // the stop's own fade-in on arrival (on frame time, like the flight) is over
    await p.click('[data-control="light"]');
    await p.eval('__world.setPaused(true)');
    await p.sleep(150);
    const at = await p.eval(cone);
    await p.sleep(600);
    const later = await p.eval(cone);
    expect(at > .05 && later === at, `the fade held (opacity ${at.toFixed(2)} → ${later.toFixed(2)})`);
    await p.eval('__world.setPaused(false)');
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
  {name: 'the meeting room\'s air draws nothing while paused', async run(p, expect) {
    // The airflow stood still while paused but went on uploading its lines and redrawing the scene on every frame.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    await p.sleep(800);
    await p.eval('__world.setPaused(true)');
    await p.sleep(300);
    const draws = await p.eval(`new Promise(done=>{const R=__renderer,render=R.render.bind(R);let n=0;R.render=(...a)=>{if(!R.getRenderTarget())n++;return render(...a);};setTimeout(()=>{R.render=render;done(n);},1000);})`);
    expect(draws <= 3, `${draws} redraws in a paused second`);
    await p.eval('__world.setPaused(false)');
  }},
  {name: 'a room light paused mid-fade draws nothing', async run(p, expect) {
    // The fade held while paused but repainted and redrew the scene on every frame.
    await p.goto(`?dest=meeting&${FAST}&time=10:00`);
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    await p.sleep(800);
    await p.click('[data-control="light"]');
    await p.eval('__world.setPaused(true)');
    await p.sleep(200);
    const draws = await p.eval(`new Promise(done=>{const R=__renderer,render=R.render.bind(R);let n=0;R.render=(...a)=>{if(!R.getRenderTarget())n++;return render(...a);};setTimeout(()=>{R.render=render;done(n);},750);})`);
    expect(draws <= 3, `${draws} redraws in 0.75 s paused`);
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
    // Its limit is time, not frames (one pass per 100 ms, render-kit STILL_MS): at under 10 frames a second, as with
    // eight software-rendering browsers, it may rightly redraw on every frame.
    const redraw = `new Promise(done=>{let n=0;const t0=performance.now();const f=()=>{__controls.dispatchEvent({type:'change'});if(++n<60)requestAnimationFrame(f);else requestAnimationFrame(()=>done(performance.now()-t0));};requestAnimationFrame(f);})`;
    await p.eval('Object.assign(__passes,{screen:0,mirror:0})'); const ms = await p.eval(redraw);
    const still = await p.eval('({...__passes})'), limit = Math.ceil(ms / 100) + 1;
    expect(still.screen >= 30 && still.mirror <= limit, `still: the mirror is redrawn at most every 100 ms (${still.mirror} mirror passes for ${still.screen} frames in ${Math.round(ms)} ms; at most ${limit})`);
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
  {name: 'kiosk: Stop following on the final approach leaves no floor half cut', async run(p, expect) {
    // Cancelling the flight stopped the camera but not the floors' change: the building stayed half cut away.
    // Real speed: at ?speed=30 the flight is over before it can be tapped.
    await p.goto('?kiosk=1&debug=1&warm=0&time=14:45');
    await p.until(`${UP} && document.body.dataset.tourDestination==='meeting' && document.querySelector('#viewport').classList.contains('flying')`, {timeout: 40000, what: 'the kiosk on its final approach to the meeting room'});
    await p.click('#day-play');
    await p.sleep(800);
    const kept = await p.eval(`(()=>{let n=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))n++;});return n;})()`);
    expect(kept === 0, `no mesh left mid-cut (${kept})`);
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
  {name: 'the parking story taking over a flight to the car park leaves no floor half cut', async run(p, expect) {
    // Its first camera move ended the dock's flight, whose floors' change was left mid-cut until the next flight.
    // Real speed: at ?speed=30 the flight is over before the story can take it over.
    await p.goto('?debug=1&warm=0&time=10:00&dest=meeting');
    await p.until(`${IDLE} && document.body.dataset.tourDestination==='meeting'`, {timeout: 40000, what: 'at the meeting room'});
    await p.click('[data-destination="parking"]');
    await p.until(`document.querySelector('#viewport').classList.contains('flying')`, {timeout: 5000, what: 'on its way to the car park'});
    await p.sleep(150);
    await p.eval('void __parking.playStory()');
    await p.sleep(1500);
    const kept = await p.eval(`(()=>{let n=0;__scene.traverse(o=>{if(o.isMesh&&[].concat(o.material).some(m=>__transition.isCopy(m)))n++;});return n;})()`);
    expect(await p.eval('__parking.story.running') && kept === 0, `the story at the car park, no floor mid-cut (${kept} meshes)`);
    // And the dock shows the car park (it marked its stop before the story's takeover made the car park the stop).
    expect(await p.eval(`document.querySelector('[data-destination][aria-pressed=true]')?.dataset.destination`) === 'parking', 'the dock shows the car park');
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
  {name: 'kiosk: tapping Auto-advance (its label) keeps the loop going', async run(p, expect) {
    // The checkbox was left to the story, its label not: one tap toggled Auto-advance and also turned Follow off.
    await p.goto(`?kiosk=1&${FAST}&time=07:35`);
    await p.until(`window.__parking && __parking.story.running && !!document.querySelector('#parking-bar .pk-switch span')`, {timeout: 60000, what: 'the morning story'});
    await p.click('#parking-bar .pk-switch span');
    await p.sleep(300);
    const r = JSON.parse(await p.eval(`JSON.stringify({following:document.querySelector('#day-play').getAttribute('aria-pressed'),story:__parking.story.running})`));
    expect(r.following === 'true' && r.story, `Follow and the story carry on (following ${r.following}, story ${r.story})`);
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
  {name: 'narrow window: both gate cameras show a picture, the story step and the disclosure stay on one line', async run(p, expect) {
    await viewport(p, 1000, 900);
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
    } finally { await viewport(p); }
  }},
  {name: 'phone widths: the header\'s buttons stay on screen', async run(p, expect) {
    // The two logos and the buttons need about 450 px in one row: at 390 px, Explore started off the screen.
    try {
      for (const width of [390, 320]) {
        await viewport(p, width, 800);
        await p.goto(`?${FAST}`);
        await p.until(LOADED, {timeout: 40000, what: 'model ready'});
        const out = await p.eval(`[...document.querySelectorAll('.header-actions > *')].filter(e=>getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().right>innerWidth+1).map(e=>e.id||e.className).join(', ')`);
        expect(!out, `at ${width} px every header button is on screen (${out || 'all'})`);
      }
    } finally { await viewport(p); }
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
  {name: 'keys: R works on the Thai layout, and Ctrl+arrow, which moves the view, stops the tour', async run(p, expect) {
    // The keys were read by character (R types พ on the Thai layout); and after Ctrl/Alt keys were left to the browser,
    // Ctrl+arrow still turned the view (the controls take it) but no longer stopped the tour.
    await p.goto(`?${FAST}`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    const key = (k, code, extra = {}) => p.eval(`document.querySelector('#viewport canvas').dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:${JSON.stringify(k)},code:${JSON.stringify(code)},...${JSON.stringify(extra)}}))`);
    const pose = `JSON.stringify(__camera.position.toArray().map(v=>+v.toFixed(1)))`, home = await p.eval(pose);
    await p.eval(`(()=>{__camera.position.x+=15;__controls.update()})()`);
    await key('พ', 'KeyR');
    await p.until(`${pose} === ${JSON.stringify(home)}`, {timeout: 10000, what: 'the view back at the stop after R on the Thai layout'});
    const label = `document.querySelector('#tour-play span').textContent`;
    await p.click('#tour-play');
    await p.until(`/หยุดพาชม|Stop tour/.test(${label})`, {timeout: 5000, what: 'the tour started'});
    await key('ArrowLeft', 'ArrowLeft', {ctrlKey: true});
    await p.sleep(300);
    expect(/เริ่มพาชม|Start tour/.test(await p.eval(label)), `Ctrl+Left stopped the tour (button: ${await p.eval(label)})`);
  }},
  {name: 'panning slows far from the site and comes back at full speed; the ground\'s edge is in the fog', async run(p, expect) {
    // A touchpad scroll carried the view off without limit, past the end of the ground.
    await p.goto(`?${FAST}`);
    await p.until(IDLE, {timeout: 40000, what: 'showcase ready'});
    const scroll = (deltaX, n) => p.eval(`(()=>{const c=document.querySelector('#viewport canvas');for(let i=0;i<${n};i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:400,clientY:300,deltaX:${deltaX},deltaY:0}));
      const t=__controls.target;return Math.hypot(t.x,t.z);})()`);
    const start = await scroll(0, 0);
    const far = await scroll(40, 400);
    expect(far <= 91, `400 big sideways scrolls leave the view's pivot ${far.toFixed(0)} m from the site's middle (started ${start.toFixed(0)} m)`);
    const back = await scroll(-40, 40);
    await scroll(40, 400);
    const round = await p.eval(`(()=>{const c=document.querySelector('#viewport canvas');for(let i=0;i<200;i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:400,clientY:300,deltaX:0,deltaY:-8}));const t=__controls.target;return Math.hypot(t.x,t.z);})()`);
    expect(round <= 91, `scrolling the other way round the site does not creep out either (${round.toFixed(0)} m)`);
    // Slower further out: one sideways scroll's outward step at 30 m and at 80 m from the site's middle (the hard 90 m
    // limit alone would pass the checks above).
    const outward = r => p.eval(`(()=>{const c=document.querySelector('#viewport canvas'),t=__controls.target,step=dx=>{t.set(${r},0,0);__camera.position.set(${r},20,60);__controls.update();
      c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:400,clientY:300,deltaX:dx,deltaY:0}));return Math.hypot(t.x,t.z)-${r}};return Math.max(step(40),step(-40))})()`);
    const [near, far2] = [await outward(30), await outward(80)];
    expect(near > 0 && far2 < near * .5, `an outward scroll moves the view ${near.toFixed(2)} m at 30 m out, ${far2.toFixed(2)} m at 80 m`);
    expect(back < far - 20, `scrolling back is not slowed (${far.toFixed(0)} m to ${back.toFixed(0)} m in 40 scrolls)`);
    // Up and down on the screen slide the view forward and back at the height it has (it went up into the air, or
    // under the ground).
    const vertical = JSON.parse(await p.eval(`JSON.stringify((()=>{__controls.target.set(0,5,0);__camera.position.set(0,8,60);__controls.update();
      const c=document.querySelector('#viewport canvas'),go=d=>{for(let i=0;i<30;i++)c.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,clientX:400,clientY:300,deltaX:0,deltaY:d}));return {pivot:+__controls.target.y.toFixed(2),camera:+__camera.position.y.toFixed(2),z:+__controls.target.z.toFixed(1)}};
      return {down:go(40),up:go(-40)}})())`));
    expect(vertical.down.pivot === 5 && vertical.down.camera === 8 && vertical.up.pivot === 5 && vertical.up.camera === 8, `panning keeps the height (pivot ${vertical.down.pivot}/${vertical.up.pivot} m, camera ${vertical.down.camera}/${vertical.up.camera} m)`);
    expect(vertical.down.z !== vertical.up.z, `up and down on the screen go forward and back (${vertical.down.z} / ${vertical.up.z})`);
    // Orbiting down to below the horizon: the camera stays above its pivot.
    const orbit = await p.eval(`(()=>{__controls.target.set(0,2,0);__camera.position.set(0,-20,40);__controls.update();return +(__camera.position.y-__controls.target.y).toFixed(2)})()`);
    expect(orbit > 0, `the camera cannot orbit under the ground (${orbit} m above its pivot)`);
    const fog = JSON.parse(await p.eval(`JSON.stringify({far:__scene.fog?.far,ground:__scene.getObjectByName('PresentationGround').geometry.parameters.width/2})`));
    expect(fog.far < fog.ground, `the world is gone in the fog (${fog.far} m) before the ground ends (${fog.ground} m)`);
    // Pixels: the road by the gate shows, its far end has faded into the sky. (Fog worked out per vertex blended
    // across the road's few big triangles, whose corners lie 100 m out: the whole road and ground vanished.)
    // From further out than zooming goes (the fog's whole width in view).
    const px = JSON.parse(await p.eval(`JSON.stringify((()=>{__controls.maxDistance=500;__controls.target.set(0,0,0);__camera.position.set(60,90,140);__controls.update();
      const r=__renderer,gl=r.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;r.render(__scene,__camera);
      const at=(x,z)=>{const v=new __camera.position.constructor(x,.3,z).project(__camera),b=new Uint8Array(4);gl.readPixels(Math.round((v.x+1)/2*w),Math.round((v.y+1)/2*h),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);return [...b].slice(0,3)};
      const sky=new Uint8Array(4);gl.readPixels(2,h-3,1,1,gl.RGBA,gl.UNSIGNED_BYTE,sky);
      return {near:at(-10,24),far:at(98,24),sky:[...sky].slice(0,3)}})())`));
    const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    expect(diff(px.near, px.sky) > 25, `the road by the gate shows (${px.near} against the sky ${px.sky})`);
    expect(diff(px.far, px.sky) < 10, `the road's far end has faded into the sky (${px.far} against ${px.sky})`);
  }},
  {name: 'the plate camera card sits up in the corner, below the corner\'s text only when there is some', async run(p, expect) {
    // It always left room for the corner's room-colours bar and flight status, so at the car park, where both are
    // usually empty, it hung below an empty gap.
    await p.goto(parking());
    await p.until(`${ready} && ${STILL}`, {timeout: 40000});
    await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
    await p.until(`!!document.querySelector('.pk-feed:not([hidden])')`, {timeout: 30000, what: 'the plate camera card'});
    await p.eval('__world.setPaused(true)');
    const top = sel => `Math.round(document.querySelector('${sel}').getBoundingClientRect().top)`;
    expect(Math.abs(await p.eval(top('.pk-feed')) - await p.eval(top('.scene-title'))) <= 1, 'level with the stop\'s title card when the corner is empty');
    await p.eval(`document.querySelector('#flight-status').textContent='Heading to the car park'`);
    await p.sleep(300);
    const r = JSON.parse(await p.eval(`JSON.stringify({feed:document.querySelector('.pk-feed').getBoundingClientRect().top,text:document.querySelector('#flight-status').getBoundingClientRect().bottom})`));
    expect(r.feed >= r.text, `below the corner's text when there is some (card ${Math.round(r.feed)}, text ends ${Math.round(r.text)})`);
    await p.eval(`document.querySelector('#flight-status').textContent=''`);
    // On a phone the two do not fit side by side: level with the title, the card covered it.
    await viewport(p, 390, 844);
    try {
      await p.sleep(300);
      const n = JSON.parse(await p.eval(`JSON.stringify({feed:document.querySelector('.pk-feed').getBoundingClientRect().top,title:document.querySelector('.scene-title').getBoundingClientRect().bottom})`));
      expect(n.feed >= n.title, `below the title on a phone (card ${Math.round(n.feed)}, title ends ${Math.round(n.title)})`);
      // With the visitor's phone open the title is hidden: the card goes up into the corner (it stayed below the
      // hidden title, half-way down the view).
      await p.click('[data-bar="phone"]');
      await p.sleep(300);
      const o = JSON.parse(await p.eval(`JSON.stringify({feed:document.querySelector('.pk-feed').getBoundingClientRect().top,title:document.querySelector('.scene-title').getBoundingClientRect().top})`));
      expect(Math.abs(o.feed - o.title) <= 1, `up in the corner with the phone open (card ${Math.round(o.feed)}, the hidden title's top ${Math.round(o.title)})`);
    } finally { await viewport(p); await p.eval('__world.setPaused(false)'); }
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
    const lamps = c => `(c=>c.getObjectByName('Demo_car_decals').material.color.r)(${c})`, pool = c => `${c}.getObjectByName('Demo_car_headlights')`, beams = c => `${c}.getObjectByName('Demo_car_headlight_beams')`;
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
    await p.until(`(()=>{const moving=__parking.lot.root.children.filter(c=>c.name.startsWith('Demo_car_')&&c.visible&&c.getObjectByName('Demo_car_decals').material.color.r===1);return moving.length>=2&&moving.every(c=>c.getObjectByName('Demo_car_headlights').visible&&c.getObjectByName('Demo_car_headlight_beams').visible)})()`, {timeout: 20000, what: 'two or more cars on the move, all with their light and beams'});
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
    await p.until(UP, {timeout: 40000, what: 'model ready'});
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
  {name: 'camera card labels fit and the alert never covers it (narrow window, English)', async run(p, expect) {
    await viewport(p, 1200, 900);
    try {
      await p.goto(parking());
      await p.until(ready, {timeout: 40000});
      await p.click('#lang-toggle');
      const k = await p.eval(LEAVE_STAFF);
      // The exit camera's card (a background car at the entry may show its own card first).
      await p.until(`!document.querySelector('.pk-feed').hidden && document.querySelector('.pk-feed-head').textContent.includes('LPR-OUT') && document.querySelector('.pk-feed-meta .pk-pill')`, {timeout: 30000, what: 'exit camera card'});
      const fit = JSON.parse(await p.eval(`JSON.stringify((()=>{const card=document.querySelector('.pk-feed').getBoundingClientRect(),plate=document.querySelector('.pk-feed-plate').getBoundingClientRect();return [...document.querySelectorAll('.pk-feed-meta .pk-pill')].map(e=>{const r=e.getBoundingClientRect(),inner=e.scrollWidth<=e.clientWidth+1;return {inCard:r.right<=card.right-4&&r.left>=card.left,clearOfPlate:r.left>=plate.right,inner}})})())`));
      expect(fit.length && fit.every(f => f.inCard && f.clearOfPlate && f.inner), `labels fit beside the plate inside the card (${JSON.stringify(fit)})`);
      await p.eval(`void __parking.traffic.arrive({plate:'3ฆง 6047',province:'ชลบุรี',color:6,fromX:-40})`);
      await p.until(`__parking.sim.state.alerts.some(a=>a.status==='open') && !document.querySelector('.pk-feed').hidden`, {timeout: 30000, what: 'alert with camera card'});
      const overlap = await p.eval(`(()=>{const a=document.querySelector('.pk-alert-pop').getBoundingClientRect(),b=document.querySelector('.pk-feed').getBoundingClientRect();return !(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top)})()`);
      expect(!overlap, 'alert does not overlap the camera card');
      await p.click('#lang-toggle');
    } finally { await viewport(p); }
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
  {name: 'street lights stand evenly all along the main road; they and the car park\'s poles light the ground at night (lit air down to a pool), not by day', async run(p, expect) {
    await p.goto(parking('&time=20:00'));
    await p.until(`${ready} && document.documentElement.dataset.night === 'true'`, {timeout: 40000});
    const light = `__parking.lot.root.children.filter(o=>o.name==='Demo_lamp_light')`;
    const cones = await p.eval(`${light}.filter(o=>o.geometry.type==='CylinderGeometry').map(o=>({x:o.position.x,z:o.position.z,visible:o.visible}))`);
    // The street runs from z 22.5 (the kerb on the site's side) to 29.5; the lamps hang over its near lanes.
    const street = cones.filter(c => c.z > 22.5 && c.z < 26).sort((a, b) => a.x - b.x), lot = cones.filter(c => c.z < 13);
    const gaps = street.slice(1).map((c, i) => c.x - street[i].x);
    expect(street.length >= 10 && street[0].x < -70 && street.at(-1).x > 70, `street lights all along the road (${street.length}, x ${street[0]?.x} … ${street.at(-1)?.x})`);
    expect(gaps.every(g => Math.abs(g - gaps[0]) < .01), `evenly spaced (${[...new Set(gaps.map(g => g.toFixed(1)))].join(', ')} m apart)`);
    expect(!street.some(c => c.x > -26 && c.x < -17), 'none in the gate mouth');
    expect(lot.length === 4, `the car park's four poles light it too (${lot.length})`);
    expect(await p.eval(`${light}.every(o=>o.visible)`), 'every cone and the pools show at night');
    // Lit air, as the meeting room's cone: it glows seen from the side and from straight above.
    const glow = await p.eval(`(()=>{const c=${light}.find(o=>o.geometry.type==='CylinderGeometry'),V=__camera.position.constructor;
      const solo=new __scene.constructor(),copy=c.clone();copy.matrixAutoUpdate=false;copy.matrix.copy(c.matrixWorld);
      const cam=__camera.clone(),gl=__renderer.getContext(),px=new Uint8Array(4),aim=c.getWorldPosition(new V()).add(new V(0,1.5,0));
      const light=off=>{cam.position.copy(aim).add(new V(...off));cam.lookAt(aim);cam.updateMatrixWorld();
        const read=()=>{gl.readPixels(gl.drawingBufferWidth>>1,gl.drawingBufferHeight>>1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);return px[0]+px[1]+px[2];};
        solo.remove(copy);__renderer.render(solo,cam);const dark=read();solo.add(copy);__renderer.render(solo,cam);return read()-dark;};
      return {side:light([12,0,4]),above:light([.01,14,0])};})()`);
    expect(glow.side > 25 && glow.above > 25, `the cone glows seen from the side and from above (side ${glow.side}, above ${glow.above})`);
    await p.eval('__world.jumpTo(10*60)');
    await p.until(`document.documentElement.dataset.night === 'false'`, {timeout: 5000, what: 'day'});
    expect(await p.eval(`${light}.every(o=>!o.visible)`), 'no lamp light by day');
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
    await p.click('[data-destination="overview"]'); await p.sleep(400);
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
    await p.until(`${LOADED} && !!window.__simulation && ${lit} <= 2`, {timeout: 40000, what: 'offices dark at 22:00 on the explore page'});
    await p.goto('?debug=1&time=10:00#explore');
    await p.until(`${LOADED} && !!window.__simulation && ${lit} > 10`, {timeout: 40000, what: 'offices lit at 10:00 on the explore page'});
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
    await p.until(LOADED, {timeout: 40000});
    await p.until(`document.documentElement.dataset.night === 'true'`, {timeout: 5000, what: 'night on the explore page'});
    expect(true, 'explore page is dark at 20:00');
  }},
];
