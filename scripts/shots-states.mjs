// The UI states scripts/shots.mjs photographs: which page loads, what each does, and the state to photograph after
// each step. A step's `run(p)` gets the page from test/browser.mjs, with its stepping helpers: `p.reach(cond, what)`
// steps the demo's simulation time until the page expression `cond` holds, `p.step(ms)` steps `ms` of it.

// Screen sizes: the booth first (it gets the full set).
export const BOOTH = [1920, 1080];
export const SIZES = [BOOTH, [1080, 1920], [1366, 768], [768, 1024], [390, 844]];
export const LANGS = ['th', 'en'];
export const sizeName = ([w, h]) => `${w}x${h}`;

export const GROUPS = {
  stops: 'Showcase stops',
  explore: 'Explore page',
  modes: 'Timeline and building story',
  console: 'Parking console',
  phone: 'Visitor phone',
  gate: 'Gate alerts and cameras',
  story: 'Parking story, guided (Next by Next)',
  rejected: 'Parking story, request rejected at step 4',
  auto: 'Parking story, auto-advance',
};

// Page states.
const LOADED = "document.querySelector('#status')?.dataset.state === 'ready'";
const UP = `${LOADED} && !!window.__parking`;
const STILL =
  "!document.querySelector('[data-destination][aria-busy=true]') && !document.querySelector('#viewport').classList.contains('flying')";
const IDLE = `${UP} && ${STILL}`;
const PARKING = `${IDLE} && __parking.active`;
const NIGHT = `document.documentElement.dataset.night === 'true'`;
const DAY = `document.documentElement.dataset.night === 'false'`;
const VISITOR = 'ชูใจ ใฝ่รู้',
  UNKNOWN_PLATE = '2ฒษ 9077';
const STORY_REQUEST = `__parking.sim.state.requests.find(q=>q.visitor.name===${JSON.stringify(VISITOR)})`;
const STORY_ALERT_OPEN = `__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate===${JSON.stringify(UNKNOWN_PLATE)})`;
const waiting = (i) => `__parking.story.running && __parking.story.index===${i} && __parking.story.waitingForNext`;
const TIMES = {day: '10:00', night: '20:00'};
// Every page: debug hooks, no shader warm-up, the engine stepped only by the runner (`manual`), the same dice.
const url = (params, hash = '') => `?debug=1&warm=0&manual=1&seed=1&${params}${hash}`;

// A session is one page load: `steps` run in order, and each step with a `state` is photographed once it has run.
export function buildSessions() {
  const sessions = [];
  const session = (size, lang, tod, path, ready, steps) => sessions.push({size, lang, tod, path, ready, steps});
  const step = (group, state, label, run = async () => {}) => ({group, state, label, run});
  const move = (run) => ({run}); // a step that only gets the page somewhere, photographed by none
  const dock = (id) => async (p) => {
    await p.click(`[data-destination="${id}"]`);
    await p.reach(
      `document.body.dataset.tourDestination===${JSON.stringify(id)} && ${STILL}${id === 'parking' ? ' && __parking.active' : ''}`,
      `landed at ${id}`,
    );
    await p.step(id === 'overview' ? 400 : 900); // the stop's effects fade in; the car park's layout change animates
  };

  // Showcase: every stop (and the explore page) by day and by night.
  function stops(size, lang, tod, {extras = false} = {}) {
    const steps = [step('stops', 'stop-overview', 'Overview', async (p) => p.step(600))];
    for (const [id, label] of [
      ['meeting', 'Meeting room'],
      ['pond', 'Fish pond'],
      ['energy', 'Energy (rooftop)'],
      ['parking', 'Car park'],
    ])
      steps.push(step('stops', `stop-${id}`, label, dock(id)));
    if (extras) {
      steps.push(
        step('modes', 'timeline-paused', 'Timeline paused (car park)', async (p) => {
          await p.click('#day-pause');
          await p.reach(`document.querySelector('#day-pause').getAttribute('aria-pressed')==='true'`, 'paused');
          await p.step(400);
        }),
      );
    }
    session(size, lang, tod, url(`speed=30&time=${TIMES[tod]}`), `${IDLE} && ${tod === 'night' ? NIGHT : DAY}`, steps);
  }
  function explore(size, lang, tod, {extras = false} = {}) {
    const steps = [step('explore', 'explore', 'Explore page', async (p) => p.step(800))];
    if (extras) {
      steps.push(
        step('explore', 'explore-details', 'Explore page, simulation details open', async (p) => {
          await p.eval(`(()=>{const d=document.querySelector('.simulation-details');if(d)d.open=true})()`);
          await p.step(400);
        }),
      );
      steps.push(
        step('explore', 'explore-stairs', 'Explore page, stairs view', async (p) => {
          await p.click('#stairs');
          await p.step(1500);
        }),
      );
    }
    // `explore=1` (read by nothing) keeps the address apart from the showcase's: a change of hash alone does not reload.
    session(
      size,
      lang,
      tod,
      url(`explore=1&speed=30&time=${TIMES[tod]}`, '#explore'),
      `${LOADED} && ${tod === 'night' ? NIGHT : DAY}`,
      steps,
    );
  }

  // The parking console in free play: tabs, a request, the visitor's phone and an unknown car at the gate.
  function parkingFree(size, lang, tod, {full = true, night = false} = {}) {
    const tab = (id, label) =>
      step('console', `parking-tab-${id}`, label, async (p) => {
        await p.click(`[data-tab="${id}"]`);
        await p.step(500);
      });
    const phoneOpen = step('phone', 'parking-phone-form', 'Phone open: the request form', async (p) => {
      if (!(await p.eval('document.body.classList.contains("phone-open")'))) await p.click('[data-bar="phone"]');
      await p.reach(`!!document.querySelector('#pk-phone .ph-frame')`, 'the phone');
      await p.step(500);
    });
    const alert = step(
      'gate',
      'parking-unknown-car-alert',
      'Unknown car at the barrier: alert pop-up, camera card, Gate tab',
      async (p) => {
        await p.eval(`void __parking.traffic.arrive({plate:'1กก 1111',province:'กรุงเทพมหานคร',color:5,fromX:-40})`);
        await p.reach(
          `__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111') && document.querySelector('[data-pop="open"]') && document.querySelector('.pk-feed:not([hidden])')`,
          'the alert and its pop-up',
        );
        await p.step(500);
      },
    );
    let steps;
    if (night)
      steps = [
        tab('gate', 'Gate tab'),
        alert,
        move(async (p) => {
          await p.click('[data-pop="deny"]');
        }),
        phoneOpen,
      ];
    else if (!full) steps = [phoneOpen];
    else {
      const openRequest = async (p, which) => {
        const id = await p.eval(which);
        if (!id) throw new Error('no such request');
        await p.click(`[data-request="${id}"]`);
        await p.reach(`!!document.querySelector('.pk-detail-head')`, 'the request detail');
        await p.step(400);
      };
      steps = [
        step('console', 'parking-tab-overview', 'Overview tab', async (p) => p.step(500)),
        tab('requests', 'Requests tab'),
        step('console', 'parking-request-detail', 'Request detail (pending: Approve / Reject)', async (p) => {
          await p.click('[data-req-filter="all"]');
          await openRequest(
            p,
            `(__parking.sim.state.requests.find(q=>q.status==='pending')||__parking.sim.state.requests[0])?.id`,
          );
        }),
        step('console', 'parking-request-reject-form', 'Request detail: Reject with a reason', async (p) => {
          if (!(await p.eval(`!!document.querySelector('[data-act="reject"]')`)))
            throw new Error('the request is not pending');
          await p.click('[data-act="reject"]');
          await p.reach(`!!document.querySelector('.pk-reject textarea')`, 'the reject form');
          await p.step(400);
        }),
        step('console', 'parking-request-detail-approved', 'Request detail (approved: QR, Revoke)', async (p) => {
          await p.click('[data-act="reject-cancel"]').catch(() => {});
          await p.click('[data-act="back"]');
          await p.click('[data-req-filter="approved"]');
          await openRequest(p, `__parking.sim.state.requests.find(q=>q.status==='approved')?.id`);
        }),
        move(async (p) => {
          await p.click('[data-act="back"]');
        }),
        tab('vehicles', 'Vehicles tab'),
        tab('gate', 'Gate tab'),
        tab('reports', 'Reports tab'),
        alert,
        move(async (p) => {
          await p.click('[data-pop="deny"]');
          await p.reach(
            `!__parking.sim.state.alerts.some(a=>a.status==='open'&&a.plate==='1กก 1111')`,
            'the alert answered',
          );
        }),
        step('gate', 'parking-camera-card', 'Plate camera card (a registered car at the barrier)', async (p) => {
          await p.click('[data-tab="gate"]');
          await p.reach(
            `!document.querySelector('.pk-feed:not([hidden])') && __parking.sim.state.gate==='closed'`,
            'the barrier quiet',
          );
          await p.click('[data-sim="registered"]');
          await p.reach(`!!document.querySelector('.pk-feed:not([hidden])')`, 'the camera card');
          await p.step(300);
        }),
        phoneOpen,
        step('phone', 'parking-phone-form-error', 'Phone: Send with fields missing', async (p) => {
          await p.click('[data-ph="submit"]');
          await p.reach(`!!document.querySelector('#pk-phone .ph-error')`, 'the error');
          await p.step(300);
        }),
        step('phone', 'parking-phone-form-filled', 'Phone: form filled in', async (p) => {
          await p.eval(`(()=>{const q=n=>document.querySelector('#pk-phone [name='+n+']');
            const set=(n,v)=>{const e=q(n);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))};
            set('name','สมชาย ใจดี');set('email','somchai@example.com');set('contact','host.demo@osd.example');set('company','บริษัท ตัวอย่าง จำกัด');set('phone','081-234-5678');set('plate','3ขค 5150');
            set('province','กรุงเทพมหานคร');const c=q('consent');c.checked=true;c.dispatchEvent(new Event('input',{bubbles:true}))})()`);
          await p.step(300);
        }),
        step('phone', 'parking-phone-sent', 'Phone: request sent (confirmation)', async (p) => {
          await p.click('[data-ph="submit"]');
          await p.reach(
            `document.querySelector('#pk-phone .ph-screen')?.dataset.screen==='sent' && !!document.querySelector('#pk-phone .ph-receipt')`,
            'the confirmation',
          );
          await p.step(300);
        }),
        step('phone', 'parking-phone-mail-banner', 'Phone: email notification after approval', async (p) => {
          await p.click('[data-tab="requests"]');
          await p.click('[data-req-filter="all"]');
          const id = await p.eval(`__parking.sim.state.requests.find(q=>q.visitor.name==='สมชาย ใจดี')?.id`);
          await p.click(`[data-request="${id}"]`);
          await p.click('[data-act="approve"]');
          await p.reach(`!!document.querySelector('#pk-phone .ph-banner')`, 'the email banner');
          await p.step(300);
        }),
        step('phone', 'parking-phone-mail-ticket', 'Phone: email with the parking ticket', async (p) => {
          await p.click('[data-ph="inbox"]');
          await p.reach(`!!document.querySelector('#pk-phone .ph-ticket')`, 'the ticket');
          await p.step(300);
        }),
      ];
    }
    session(size, lang, tod, url(`dest=parking&speed=30&time=${TIMES[tod]}`), PARKING, steps);
  }

  // The guided story (Next by Next): each step once it has run and waits for Next; steps 4 and 7 also at their cue.
  // `only` limits the photographs to those states (the story still runs through the steps before them).
  const STORY_STATES = [
    ['story-01', 'Step 1: the visitor fills in the form', waiting(0)],
    ['story-02', 'Step 2: plate photo read, request sent', waiting(1)],
    ['story-03', 'Step 3: the request in the console', waiting(2)],
    ['story-04a-approve-cue', 'Step 4: Approve cue', `${waiting(3)} && ${STORY_REQUEST}?.status==='pending'`],
    [
      'story-04b-approved',
      'Step 4: approved, ticket emailed',
      `${waiting(3)} && ${STORY_REQUEST}?.status==='approved'`,
    ],
    ['story-05', 'Step 5: the ticket email on the phone', waiting(4)],
    ['story-06', "Step 6: the visitor's car drives in", waiting(5)],
    ['story-07a-alert-cue', 'Step 7: unknown car, Deny cue', `${waiting(6)} && ${STORY_ALERT_OPEN}`],
    ['story-07b-denied', 'Step 7: unknown car denied', `${waiting(6)} && !${STORY_ALERT_OPEN}`],
    ['story-08', 'Step 8: staff cars come and go', waiting(7)],
    ['story-09', 'Step 9: reports and the audit log', waiting(8)],
    ['story-10', 'Step 10: the visitor leaves', waiting(9)],
  ];
  const STORY_URL = url('dest=parking&speed=30&story=1&auto=0'),
    STORY_READY = 'window.__parking && __parking.story.running';
  function storyGuided(size, lang, only = null) {
    const steps = STORY_STATES.map(([state, label, cond], i) => {
      const run = async (p) => {
        if (i > 0) await p.click('[data-bar="next"]');
        await p.reach(cond, label);
        await p.step(500);
      };
      return !only || only.includes(state) ? step('story', state, label, run) : move(run);
    });
    session(size, lang, 'day', STORY_URL, STORY_READY, steps);
  }
  function storyRejected(size, lang) {
    const next = async (p, i, label = `step ${i + 1}`) => {
      await p.click('[data-bar="next"]');
      await p.reach(waiting(i), label);
    };
    const steps = [
      move(async (p) => p.reach(waiting(0), 'step 1')),
      move(async (p) => next(p, 1)),
      move(async (p) => next(p, 2)),
      move(async (p) => {
        await p.click('[data-bar="next"]');
        await p.reach(`${waiting(3)} && !!document.querySelector('[data-act="reject"]')`, 'the approve cue');
      }),
      step('rejected', 'story-rejected-04-reject-form', 'Step 4: the presenter rejects (reason form)', async (p) => {
        await p.click('[data-act="reject"]');
        await p.reach(`!!document.querySelector('.pk-reject textarea')`, 'the reject form');
        await p.step(400);
      }),
      step('rejected', 'story-rejected-04-rejected', 'Step 4: rejected', async (p) => {
        await p.click('[data-act="reject-confirm"]');
        await p.reach(`${waiting(3)} && ${STORY_REQUEST}?.status==='rejected'`, 'rejected, waiting for Next');
        await p.step(500);
      }),
      step('rejected', 'story-rejected-05-mail', 'Step 5: the rejection email on the phone', async (p) => {
        await next(p, 4);
        await p.step(500);
      }),
      step('rejected', 'story-rejected-06-turned-away', 'Step 6: no pass, the car is turned away', async (p) => {
        await next(p, 5);
        await p.step(500);
      }),
    ];
    session(size, lang, 'day', STORY_URL, STORY_READY, steps);
  }

  for (const lang of LANGS) {
    // The booth: everything.
    for (const tod of ['day', 'night']) {
      stops(BOOTH, lang, tod, {extras: tod === 'day'});
      explore(BOOTH, lang, tod, {extras: tod === 'day'});
    }
    // The building's story: the meeting step (the room cooling) and the pond running low.
    const storyStep = (n) =>
      `document.querySelector('#story-caption .pk-caption-step')?.textContent.includes('${n}/8') && ${STILL}`;
    session(BOOTH, lang, 'day', url('speed=30&time=10:00'), IDLE, [
      step('modes', 'building-story-meeting', 'Building story: a meeting starts', async (p) => {
        await p.click('#story-play');
        await p.reach(storyStep(2), 'the meeting step');
        await p.step(6000, {hold: false});
      }),
      step('modes', 'building-story-pond', 'Building story: the pond runs low', async (p) => {
        await p.reach(storyStep(4), 'the pond step');
        await p.step(1500, {hold: false});
      }),
    ]);
    session(
      BOOTH,
      lang,
      'day',
      url('speed=30&dest=pond&time=15:00'),
      `${IDLE} && document.body.dataset.tourDestination==='pond'`,
      [
        step('stops', 'stop-pond-low-water', 'Fish pond at 15:00: low-water alert', async (p) => {
          await p.reach(`!!document.querySelector('[data-incident="pond-low"]')`, 'the low-water alert');
          await p.step(900);
        }),
      ],
    );
    parkingFree(BOOTH, lang, 'day');
    parkingFree(BOOTH, lang, 'night', {night: true});
    storyGuided(BOOTH, lang);
    storyRejected(BOOTH, lang);
    session(BOOTH, lang, 'day', url('dest=parking&speed=30&story=1'), STORY_READY, [
      step('auto', 'story-auto-paused', 'Auto-advance story, paused at step 2', async (p) => {
        await p.reach('__parking.story.index>=1', 'step 2');
        await p.click('[data-bar="pause"]');
        await p.reach('__parking.story.paused', 'paused');
        await p.step(500);
      }),
    ]);
    // The other sizes: a representative subset.
    for (const size of SIZES.slice(1)) {
      stops(size, lang, 'day');
      explore(size, lang, 'day');
      parkingFree(size, lang, 'day', {full: false});
      storyGuided(size, lang, ['story-01', 'story-04a-approve-cue', 'story-06', 'story-07a-alert-cue']);
    }
  }
  return sessions;
}
