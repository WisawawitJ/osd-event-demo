// What the two stories (the building's, the car park's) look like: the bar under the 3D view, the caption on it, and
// how a visitor takes over from one. Each story has its own element for each; the markup and the styles are the same.
import {t} from './texts.js';
import {esc, icon, morph} from './dom.js';
import {world} from './clock.js';

// `s`: running, auto, paused, waitingForNext, index, total. `idle`: the line shown before it plays. `more`: what else the
// bar holds. Its controls carry data-bar: play, pause, resume, next, restart, free (exit), auto (the checkbox).
function storyBar(s, {idle, more = ''}) {
  const dots = Array.from(
    {length: s.total},
    (_, i) => `<i class="${i < s.index ? 'done' : i === s.index ? 'now' : ''}"></i>`,
  ).join('');
  const main = !s.running
    ? `<button class="primary-button" data-bar="play">${icon('play')}<span>${t('story.play')}</span></button>`
    : s.auto
      ? `<button class="primary-button" data-bar="${s.paused ? 'resume' : 'pause'}">${icon(s.paused ? 'play' : 'pause')}<span>${t(s.paused ? 'story.resume' : 'story.pause')}</span></button>`
      : `<button class="primary-button" data-bar="next"${s.waitingForNext ? ' data-cue="true"' : ''}>${icon('next')}<span>${t('next')}</span></button>`;
  return `<div class="pk-bar-main">${main}${s.running ? `<button data-bar="restart">${icon('restart')}<span>${t('story.restart')}</span></button><button data-bar="free" class="pk-exit-story" title="Esc">${icon('x')}<span>${t('story.exit')}</span></button>` : ''}
      <label class="pk-switch"><input type="checkbox" data-bar="auto"${s.auto ? ' checked' : ''}><span>${t('story.autoAdvance')}</span></label></div>
      <div class="pk-bar-progress">${s.running ? `<span>${t('story.step', {n: s.index + 1, total: s.total})}</span><div class="pk-dots">${dots}</div>` : `<span class="pk-bar-idle">${idle}</span>`}</div>${more}`;
}

// Whether a click is of the button its press began on: the bar is drawn in place, so a story that ended under a finger
// had turned Pause into Play by the release, which played it again. `kind`: the pointer's presses and the keyboard's are
// kept apart. A click whose press was not seen (a screen reader's, after a cancelled touch) counts.
export function createPress() {
  const began = new Map();
  return {
    down: (kind, what) => began.set(kind, what),
    cancel: (kind) => began.delete(kind),
    isClickOf(kind, what) {
      const same = !began.has(kind) || began.get(kind) === what;
      began.delete(kind);
      return same;
    },
  };
}

// A story's bar, working: `el`, its `story`, `idle()` and `more()` (texts and buttons as above, drawn each time), `leave()`
// (Exit and Esc), `buttons` (what `more`'s own data-bar buttons do). Returns its redraw. Pause and Resume are the day's
// (the timeline's Pause too): everything stands still with the story. Playing or going on needs time to pass: it runs a
// paused day again (a story that ends does too, by itself).
export function wireStoryBar(el, {story, idle, more = () => '', leave, buttons = {}, signal}) {
  // In place (morph): rebuilt, the button just pressed lost its focus at every step, and a press under way its target.
  const render = () => {
    morph(el, storyBar(story, {idle: idle(), more: more()}));
  };
  const act = {
    play: () => void story.play({auto: story.auto}),
    restart: () => void story.play({auto: story.auto}),
    pause: () => world.setPaused(true),
    resume: () => world.setPaused(false),
    next: () => story.next(),
    free: leave,
    ...buttons,
  };
  const listen = (target, event, fn) => target.addEventListener(event, fn, {signal});
  const press = createPress(),
    buttonOf = (event) => event.target.closest('[data-bar]'),
    // What a button does as it stands (the phone's shows or hides by its state).
    actionOf = (button) => `${button?.dataset.bar} ${button?.getAttribute('aria-pressed')}`;
  listen(el, 'pointerdown', (event) => press.down('pointer', actionOf(buttonOf(event))));
  listen(el, 'pointercancel', () => press.cancel('pointer'));
  listen(el, 'focusout', () => press.cancel('key'));
  listen(el, 'click', (event) => {
    const button = buttonOf(event),
      what = button?.dataset.bar;
    if (!press.isClickOf(event.detail ? 'pointer' : 'key', actionOf(button)) || !act[what]) return;
    if (['play', 'restart', 'next'].includes(what)) world.setPaused(false);
    act[what]();
    render();
  });
  listen(el, 'change', (event) => {
    if (event.target.dataset.bar === 'auto') story.setAuto(event.target.checked);
  });
  // Enter held down presses once (its repeats went on to press what the button had become).
  listen(el, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!event.repeat) press.down('key', actionOf(buttonOf(event)));
    else if (event.key === 'Enter') event.preventDefault();
  });
  listen(document, 'keydown', (event) => {
    if (event.key === 'Escape' && story.running) leave();
  });
  const offRate = world.subscribe((kind) => {
    if (kind === 'rate') render();
  });
  signal?.addEventListener('abort', offRate, {once: true});
  return render;
}

export const storyCaption = ({step, title, body, hint}) =>
  `<span class="pk-caption-step">${esc(step)}</span><strong>${esc(title)}</strong><p>${esc(body)}</p>${hint ? `<span class="pk-caption-hint">${icon('hand')}${esc(hint)}</span>` : ''}`;

// The cued buttons' tap, as if pressed.
export function tapCues() {
  for (const el of document.querySelectorAll('[data-cue="true"]')) {
    el.classList.remove('pk-tapped');
    void el.offsetWidth;
    el.classList.add('pk-tapped');
  }
}

// The visitor takes the 3D view (a drag, the wheel, a view key) from a story that moves its camera: `takeOver(event)`.
export function onViewTaken(viewport, takeOver, options = {}) {
  viewport.addEventListener('pointerdown', takeOver, {capture: true, ...options});
  viewport.addEventListener('wheel', takeOver, {capture: true, passive: true, ...options});
  // A view key on the 3D view too (arrows, + −, Page Up/Down, R): the story's next camera move overrode the presenter.
  // As the view reads them: an arrow with any modifier (Ctrl+arrow turns it), the others without, by key place or, from
  // an on-screen keyboard (no key place), by character.
  viewport.addEventListener(
    'keydown',
    (event) => {
      if (event.target.tagName !== 'CANVAS') return;
      if (event.key.startsWith('Arrow')) return takeOver(event);
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.key.startsWith('Page') ||
        ['KeyR', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code) ||
        ['r', 'R', '+', '=', '-'].includes(event.key)
      )
        takeOver(event);
    },
    {capture: true, ...options},
  );
}
