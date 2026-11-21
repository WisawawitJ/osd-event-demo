// The guided parking story: one visitor from request to exit, plus an unknown car.
// Auto mode advances by itself; guided mode waits for Next or for the presenter to click the cued button.
import {t, bkk} from './i18n.js';
import {STORY} from './sim.js';
import {SPEED, demoNow, isPaused} from './clock.js';

const ABORT = Symbol('story-abort');
const at = (h, m) => bkk(2026, 11, 24, h, m);

export function createStory(ctx) {
  let token = 0, index = -1, auto = true, paused = false, running = false, nextWaiter = null, requestId = null;
  const listeners = new Set();
  const emit = () => { for (const fn of listeners) fn(); };

  function api(my) {
    const alive = () => { if (my !== token) throw ABORT; };
    const wait = ms => new Promise((resolve, reject) => {
      let left = ms, last = demoNow();
      const tick = () => {
        if (my !== token) return reject(ABORT);
        const now = demoNow();
        if (!paused) left -= (now - last) * SPEED;
        last = now;
        if (left <= 0) resolve(); else setTimeout(tick, 50);
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
      if (auto) {
        await Promise.race([wait(delay), until(done)]);
        alive();
        if (!done()) { ctx.tap(cue); await wait(250); perform(); }
      } else {
        // Next performs the action for the presenter; stopping the story (token bumped first) must not.
        await Promise.race([until(done, 1e9), new Promise(r => { nextWaiter = () => { if (my === token && !done()) perform(); r(); }; })]);
        nextWaiter = null;
      }
      ctx.cue(null); ctx.hint(null);
      alive();
    }
    return {alive, wait, until, userAction};
  }

  const steps = [
    {key: 's1', cam: 'lot', async run(s) {
      ctx.panel.show('overview');
      ctx.phone.setOpen(true);
      ctx.sim.setNow(at(9, 2));
      await s.wait(500);
      const v = STORY.visitor, opts = {cps: 26, isCancelled: () => !running};
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
      ctx.phone.setColor(STORY.color);
      const r = ctx.phone.submit();
      requestId = r?.id;
    }, hold: 1800},
    {key: 's3', cam: 'lot', async run(s) {
      ctx.panel.show('requests');
      await s.wait(1600);
      ctx.panel.show('requests', {request: requestId});
    }, hold: 4500},
    {key: 's4', cam: 'lot', async run(s) {
      const req = () => ctx.sim.state.requests.find(q => q.id === requestId);
      ctx.panel.show('requests', {request: requestId});
      await s.userAction({cue: 'approve', hint: t('story.hint.approve'), done: () => req()?.status !== 'pending', perform: () => ctx.actions.approve(requestId)});
      await s.until(() => req()?.history.some(h => h.key === 'h.email'), 8000);
    }, hold: 2500},
    {key: 's5', cam: 'lot', async run(s) {
      ctx.phone.setOpen(true);
      ctx.phone.setCue('banner');
      await s.wait(1300);
      ctx.phone.setCue(null);
      ctx.phone.setScreen('mail');
    }, hold: 5500},
    {key: 's6', cam: 'gate', async run(s) {
      ctx.phone.setOpen(false);
      ctx.sim.setNow(at(9, 41));
      ctx.panel.show('gate');
      const arrival = ctx.traffic.arrive({plate: STORY.plate, province: STORY.province, color: STORY.color, fromX: -52});
      await s.until(() => ctx.sim.state.gate === 'open', 40000);
      await s.wait(1200);
      ctx.fly('rowA', 2600);
      await arrival; s.alive();
      ctx.panel.show('overview');
    }, hold: 2500},
    {key: 's7', cam: 'gate', async run(s) {
      ctx.panel.show('gate');
      ctx.sim.setNow(at(9, 52));
      let alertId = null;
      const off = ctx.sim.subscribe((kind, a) => { if (kind === 'alert') alertId = a.id; });
      const arrival = ctx.traffic.arrive({plate: STORY.unknown.plate, province: STORY.unknown.province, color: STORY.unknown.color, fromX: -52});
      try {
        await s.until(() => alertId, 40000);
      } finally { off(); }
      const alert = () => ctx.sim.state.alerts.find(a => a.id === alertId);
      await s.wait(900);
      await s.userAction({cue: 'deny', hint: t('story.hint.alert'), done: () => alert()?.status !== 'open', perform: () => ctx.actions.resolveAlert(alertId, 'deny'), delay: 3200});
      await Promise.race([arrival, s.wait(4500)]); s.alive();
    }, hold: 1500},
    {key: 's8', cam: 'lot', async run(s) {
      ctx.panel.show('overview');
      ctx.sim.setNow(at(10, 15));
      const k = ctx.traffic.parkedKeys().find(key => ctx.sim.state.presence.get(key)?.type === 'staff' && ctx.sim.state.presence.get(key)?.stallId?.startsWith('C'));
      if (k) ctx.traffic.leave(k);
      await s.wait(1500);
      ctx.actions.simulate('registered', {fromX: -60, quiet: true});
    }, hold: 6500},
    {key: 's9', cam: 'lot', async run(s) {
      ctx.panel.show('reports');
      await s.wait(600);
      ctx.panel.flash(ctx.sim.state.audit[0]);
    }, hold: 7000},
    {key: 's10', cam: 'rowA', async run(s) {
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

  async function run(from = 0) {
    const my = ++token;
    running = true; paused = false;
    emit();
    try {
      if (from === 0) await ctx.resetWorld();
      for (index = from; index < steps.length; index++) {
        const step = steps[index], s = api(my);
        ctx.caption({step: t('story.step', {n: index + 1, total: steps.length}), title: t(`${step.key}.t`), body: t(`${step.key}.b`)});
        emit();
        ctx.fly(step.cam, 1600);
        await step.run(s);
        s.alive();
        if (auto) await s.wait(step.hold);
        else { await new Promise(r => { nextWaiter = r; }); nextWaiter = null; s.alive(); }
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
    play({auto: a = true} = {}) { auto = a; return run(0); },
    setAuto(a) { auto = a; if (a && nextWaiter) nextWaiter(); emit(); },
    pause() { paused = true; emit(); },
    resume() { paused = false; emit(); },
    next() { if (nextWaiter) nextWaiter(); },
    stop() { token++; running = false; paused = false; index = -1; if (nextWaiter) nextWaiter(); nextWaiter = null; ctx.caption(null); ctx.cue(null); ctx.hint(null); emit(); },
    refreshCaption() {
      if (!running || index < 0) return;
      const step = steps[index];
      ctx.caption({step: t('story.step', {n: index + 1, total: steps.length}), title: t(`${step.key}.t`), body: t(`${step.key}.b`)});
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
