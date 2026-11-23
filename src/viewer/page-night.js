import {options} from 'osd/core/options.js';
// The page's night look (night.css) switches in one go and cross-fades as a whole (a view transition). Fading each
// element's text and background colours instead took both through the same grey halfway, so text blinked out.
let pageNight = null; // the look the page has or is switching to (the switch applies it a frame or two later)
export function setPageNight(night) {
  const root = document.documentElement,
    value = String(night);
  if (pageNight === value) return;
  const first = pageNight === null;
  pageNight = value;
  // No CSS transitions from now until the new look is in place (the night button's own pressed state included).
  root.classList.add('theme-switch');
  let applied = false;
  const apply = () => {
    applied = true;
    root.dataset.night = pageNight;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switch')));
  };
  // Screenshots (`manual`): at once, as a view transition runs on real time and was caught part way.
  if (
    first ||
    !document.startViewTransition ||
    matchMedia('(prefers-reduced-motion: reduce)').matches ||
    'manual' in options
  ) {
    apply();
    return;
  }
  // A switch made while another is still starting replaces it; the skipped one only rejects its promises.
  const transition = document.startViewTransition(apply);
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
  transition.updateCallbackDone.catch(() => {});
  // The cross-fade starts at the browser's next frame; if that is slow to come (a busy or idle page), the new look
  // goes in without it rather than late.
  setTimeout(() => {
    if (!applied) transition.skipTransition();
  }, 250);
}
