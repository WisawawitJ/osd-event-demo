// The guided parking story: one visitor from request to exit, plus an unknown car.
// Auto mode advances by itself; guided mode waits for Next or for the presenter to click the cued button.
import {t, bkk} from './i18n.js';
import {STORY} from './sim.js';
import {SPEED, demoNow, isPaused} from './clock.js';

const ABORT = Symbol('story-abort');
const at = (h, m) => bkk(2026, 11, 24, h, m);

export function createStory(ctx) {
  let shownVariant, token = 0, index = -1, auto = true, paused = false, running = false, nextWaiter = null, requestId = null, touches = 0;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  function api(my) {
    const alive = () => { if (my !== token) throw ABORT; };
    // `stopIf`: ends the wait early (Auto-advance turned off during a hold).
    const wait = (ms, stopIf = () => false) => new Promise((resolve, reject) => {
      let left = ms, last = demoNow();
      const tick = () => {
        if (my !== token) return reject(ABORT);
        const now = demoNow();
        if (!paused) left -= (now - last) * SPEED;
        last = now;
        if (left <= 0 || stopIf()) resolve(); else setTimeout(tick, 50);
      };
      tick();
    });
    const until = (cond, timeout = 60000) => new Promise((resolve, reject) => {
      const start = demoNow();
      const tick = () => { if (my !== token) return reject(ABORT); if (cond() || (!isPaused() && demoNow() - start > timeout)) resolve(); else setTimeout(tick, 80); };
      tick();
    });
    // A step the presenter can do by hand. In auto mode it is done for them after a pause.
    async function userAction({cue, hint, done, perform, delay = 2600}) {
      ctx.cue(cue);
      ctx.hint(hint);
      // Auto-advance turned off while it waits: the presenter takes the step over (it was done for them anyway).
      // A touch on the console or the alert meanwhile (Reject, a reason to open with) waits on: done for them anyway,
      // the presenter's own choice was overridden. Until 6 s pass with no touch.
      if (auto) {
        // Touches since this cue went up only (any earlier one made every later cue wait the 6 s).
        const before = touches;
        let seen;
        do {
          seen = touches;
          // `done` with no time limit: the wait does the timing, and story Pause stops it (until's own 60 s ran on
          // through a Pause, and the action fired the moment the story resumed).
          await Promise.race([wait(seen !== before ? Math.max(delay, 6000) : delay, () => !auto || touches !== seen), until(done, Infinity)]);
          alive();
        } while (auto && !done() && touches !== seen);
        if (auto && !done()) { ctx.tap(cue); await wait(250); perform(); }
      }
      if (!auto && !done()) {
        // Next performs the action for the presenter; stopping the story (token bumped first) must not.
        await Promise.race([until(done, 1e9), new Promise(r => { nextWaiter = () => { if (my === token && !done()) perform(); r(); }; emit(); })]);
        nextWaiter = null; emit();
      }
      ctx.cue(null); ctx.hint(null);
      alive();
    }
    return {alive, wait, until, userAction, cancelled: () => my !== token};
  }

  // A step's `variant` picks other captions (the visitor's request rejected: no ticket, no pass).
  const captionFor = (i, variant = steps[i].variant?.() || '') => { const key = steps[i].key + variant; return {step: t('story.step', {n: i + 1, total: steps.length}), title: t(`${key}.t`), body: t(`${key}.b`)}; };
  const noPass = () => ctx.sim.state.requests.find(q => q.id === requestId)?.status !== 'approved';
  const steps = [
    {key: 's1', cam: 'lot', async run(s) {
      ctx.panel.show('overview');
      ctx.phone.setOpen(true);
      ctx.sim.setNow(at(9, 2));
      await s.wait(500);
      // Typing stops with this run (Restart starts a new one without stopping: it typed on into the new run's form).
      // And it pauses with the story (it typed on through Pause).
      const v = STORY.visitor, opts = {cps: 26, isCancelled: s.cancelled, isPaused: () => paused};
      await ctx.phone.typeInto('name', v.name, opts); s.alive();
      await ctx.phone.typeInto('email', v.email, opts); s.alive();
      await ctx.phone.typeInto('contact', STORY.contact, opts); s.alive();
      await ctx.phone.typeInto('company', v.company, {...opts, cps: 40}); s.alive();
      await ctx.phone.typeInto('phone', v.phone, opts); s.alive();
    }, hold: 1500},
    {key: 's2', cam: 'lot', async run(s) {
      ctx.phone.setCue('photo'); await s.wait(700); ctx.phone.setCue(null);
      await ctx.phone.readPhoto(STORY.plate, STORY.province); s.alive();
      await s.wait(900);
      ctx.phone.setForm({faceConsent: true}); await s.wait(800);
      ctx.phone.setForm({face: true}); await s.wait(700);
      ctx.phone.setForm({consent: true, notes: STORY.notes}); await s.wait(500);
      ctx.phone.setCue('submit'); await s.wait(900); ctx.phone.setCue(null);
      // Its own details again before sending: a visitor clearing a field or the consent box meanwhile left the request
      // unsent, and the rest of the story told of one that never was.
      const v = STORY.visitor;
      ctx.phone.setForm({name: v.name, email: v.email, contact: STORY.contact, company: v.company, phone: v.phone, plate: STORY.plate, province: STORY.province, consent: true});
      ctx.phone.setColor(STORY.color);
      const r = ctx.phone.submit();
      requestId = r?.id;
    }, hold: 1800},
    {key: 's3', cam: 'lot', async run(s) {
      ctx.panel.show('requests');
      await s.wait(1600);
      ctx.panel.show('requests', {request: requestId});
    }, hold: 4500},
    // Rejected already (at step 3, its Reject on screen there), or now: the rejected captions.
    {key: 's4', cam: 'lot', variant: () => (ctx.sim.state.requests.find(q => q.id === requestId)?.status === 'rejected' ? 'r' : ''), async run(s) {
      const req = () => ctx.sim.state.requests.find(q => q.id === requestId);
      ctx.panel.show('requests', {request: requestId});
      await s.userAction({cue: 'approve', hint: 'story.hint.approve', done: () => req()?.status !== 'pending', perform: () => ctx.actions.approve(requestId)});
      if (req()?.status === 'rejected' && shownVariant !== 'r') { shownVariant = 'r'; ctx.caption(captionFor(index, 'r')); }
      // Rejected, no ticket email follows (it waited 8 s for one).
      if (req()?.status === 'approved') await s.until(() => req()?.history.some(h => h.key === 'h.email'), 8000);
    }, hold: 2500},
    {key: 's5', cam: 'lot', variant: () => (!noPass() ? '' : ctx.sim.state.requests.find(q => q.id === requestId)?.status === 'revoked' ? 'v' : 'r'), async run(s) {
      ctx.phone.setOpen(true);
      // On the story's request (a tap on the phone's New request since then left it on an empty form).
      ctx.phone.follow(requestId);
      ctx.phone.setCue('banner');
      await s.wait(1300);
      ctx.phone.setCue(null);
      ctx.phone.setScreen('mail');
    }, hold: 5500},
    {key: 's6', cam: 'gate', variant: () => (noPass() ? 'r' : ''), async run(s) {
      ctx.phone.setOpen(false);
      ctx.sim.setNow(at(9, 41));
      ctx.panel.show('gate');
      // No pass (rejected at step 4, or disabled or revoked since): the barrier stays shut, the car is turned away and
      // backs out, leaving the entry free. (It waited at the barrier for an alert nobody answered, and the story stalled.)
      const approved = !noPass();
      let alertId = null;
      const off = ctx.sim.subscribe((kind, a) => { if (kind === 'alert' && a.plate === STORY.plate) alertId = a.id; });
      const arrival = ctx.traffic.arrive({plate: STORY.plate, province: STORY.province, color: STORY.color, fromX: -52});
      // In: its own entry, not the barrier being open (Open once sent the camera on while the car was still on the street).
      const key = ctx.sim.key(STORY.plate, STORY.province);
      try { await s.until(() => alertId || (approved && ctx.sim.state.presence.has(key)), 40000); } finally { off(); }
      if (alertId) {
        // The no-pass captions too (the pass may have stopped working after the step began, under the other ones).
        shownVariant = 'r'; ctx.caption(captionFor(index, 'r'));
        ctx.hint('story.hint.noPass');
        await s.wait(1800);
        if (ctx.sim.state.alerts.find(a => a.id === alertId)?.status === 'open') ctx.actions.resolveAlert(alertId, 'deny');
        // Not until it has driven off the map (some 20 s).
        await Promise.race([arrival, s.wait(4500)]); s.alive();
        ctx.hint(null);
        ctx.panel.show('overview');
        return;
      }
      await s.wait(1200);
      ctx.fly('rowA', 2600);
      await arrival; s.alive();
      ctx.panel.show('overview');
    }, hold: 2500},
    {key: 's7', cam: 'gate', async run(s) {
      ctx.panel.show('gate');
      ctx.sim.setNow(at(9, 52));
      let alertId = null;
      // Its own car's alert only (an Unknown car sent from the Gate tab meanwhile had the visitor's car denied).
      const off = ctx.sim.subscribe((kind, a) => { if (kind === 'alert' && a.plate === STORY.unknown.plate) alertId = a.id; });
      const arrival = ctx.traffic.arrive({plate: STORY.unknown.plate, province: STORY.unknown.province, color: STORY.unknown.color, fromX: -52});
      try {
        await s.until(() => alertId, 40000);
      } finally { off(); }
      const alert = () => ctx.sim.state.alerts.find(a => a.id === alertId);
      await s.wait(900);
      await s.userAction({cue: 'deny', hint: 'story.hint.alert', done: () => alert()?.status !== 'open', perform: () => ctx.actions.resolveAlert(alertId, 'deny'), delay: 3200});
      await Promise.race([arrival, s.wait(4500)]); s.alive();
    }, hold: 1500},
    {key: 's8', cam: 'lot', async run(s) {
      ctx.panel.show('overview');
      ctx.sim.setNow(at(10, 15));
      const k = ctx.traffic.parkedKeys().find(key => ctx.sim.state.presence.get(key)?.type === 'staff' && ctx.sim.state.presence.get(key)?.stallId?.startsWith('C'));
      if (k) ctx.traffic.leave(k);
      await s.wait(1500);
      ctx.actions.simulate('registered', {fromX: -60, quiet: true, west: false});
    }, hold: 6500},
    {key: 's9', cam: 'lot', async run(s) {
      ctx.panel.show('reports');
      await s.wait(600);
      ctx.panel.flash(ctx.sim.state.audit[0]);
    }, hold: 7000},
    // Skipped when the visitor never parked (turned away at step 6): nothing to drive out.
    {key: 's10', cam: 'rowA', skip: () => !ctx.sim.state.presence.has(ctx.sim.key(STORY.plate, STORY.province)), async run(s) {
      ctx.panel.show('gate');
      ctx.sim.setNow(at(11, 30));
      const k = ctx.sim.key(STORY.plate, STORY.province);
      ctx.traffic.leave(k);
      await s.wait(4200);
      ctx.fly('gate', 2400);
      // Done once the exit is logged and the barrier is down again; the car drives off in the background.
      await s.until(() => !ctx.sim.state.presence.has(k) && ctx.sim.state.gate === 'closed', 60000); s.alive();
      ctx.panel.show('overview');
    }, hold: 3000},
  ];

  async function run() {
    const my = ++token;
    // A run restarted while it waited for Next lets that wait go (its Next pulsed on, and it never settled).
    if (nextWaiter) { const waiting = nextWaiter; nextWaiter = null; waiting(); }
    running = true; paused = false;
    emit();
    try {
      await ctx.resetWorld();
      for (index = 0; index < steps.length; index++) {
        // Stopped meanwhile (while the world reset, or a step's hold): no further step, which would set the clock.
        const step = steps[index], s = api(my);
        s.alive();
        if (step.skip?.()) continue;
        shownVariant = undefined; ctx.caption(captionFor(index));
        emit();
        ctx.fly(step.cam, 1600);
        await step.run(s);
        s.alive();
        // Auto-advance turned off during the hold: it waits for Next from there (it went on to the next step).
        if (auto) await s.wait(step.hold, () => !auto);
        // The bar redrawn as Next starts and stops waiting: its pulse showed only while the next step ran.
        if (!auto) { await new Promise(r => { nextWaiter = r; emit(); }); nextWaiter = null; emit(); s.alive(); }
      }
      running = false; index = -1;
      ctx.caption(null);
      emit();
      return 'done';
    } catch (error) {
      if (error !== ABORT) { console.error(error); }
      if (my === token) { running = false; index = -1; ctx.caption(null); emit(); }
      return 'stopped';
    } finally {
      ctx.cue(null); ctx.hint(null);
    }
  }

  return {
    get running() { return running; },
    get auto() { return auto; },
    get paused() { return paused; },
    get index() { return index; },
    get total() { return steps.length; },
    get waitingForNext() { return Boolean(nextWaiter); },
    play({auto: a = true} = {}) { auto = a; return run(); },
    // Off while paused: unpaused too (with Auto-advance off the bar has Next, no Resume, and the step stood still).
    setAuto(a) { auto = a; if (!a) paused = false; if (a && nextWaiter) nextWaiter(); emit(); },
    pause() { paused = true; emit(); },
    resume() { paused = false; emit(); },
    next() { paused = false; if (nextWaiter) nextWaiter(); emit(); },
    // The presenter touched the console or the alert: a cue waiting on auto-advance waits on.
    touched() { touches++; },
    stop() { token++; running = false; paused = false; index = -1; if (nextWaiter) nextWaiter(); nextWaiter = null; ctx.caption(null); ctx.cue(null); ctx.hint(null); emit(); },
    // In the variant on show (a language switch went back to the step's first pick after step 6 switched to no-pass).
    refreshCaption() { if (running && index >= 0) ctx.caption(captionFor(index, shownVariant)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
