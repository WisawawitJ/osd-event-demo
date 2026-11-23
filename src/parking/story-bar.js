// What the two stories (the building's, the car park's) look like: the bar under the 3D view, the caption on it, and
// how a visitor takes over from one. Each story has its own element for each; the markup and the styles are the same.
import {t} from './i18n.js';
import {esc, icon} from './dom.js';

// `s`: running, auto, paused, waitingForNext, index, total. `idle`: the line shown before it plays. `more`: what else the
// bar holds. Its controls carry data-bar: play, pause, resume, next, restart, free (exit), auto (the checkbox).
export function storyBar(s, {idle, more = ''}) {
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
