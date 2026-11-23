// Overlays on the 3D view: the plate-camera feed, the unknown-car alert, story captions and toasts.
import {t, fmtTime, fmtShortDate} from './i18n.js';
import {esc, icon} from './dom.js';
import {storyCaption} from './story-bar.js';
import {later, cancelLater} from './clock.js';
import {GATE_REASONS as REASONS, openReasonOf as reasonOf} from './sim.js';

// A pass that ends on a later day shows its date too ("valid until 23:59" read as today for a two-day pass).
const validUntil = (ms, now) =>
  fmtShortDate(ms) === fmtShortDate(now) ? fmtTime(ms) : `${fmtShortDate(ms)} ${fmtTime(ms)}`;

export function createOverlays({layer, sim, actions}) {
  layer.innerHTML = `<div class="pk-feed" hidden></div><div class="pk-alert-pop" hidden></div><div class="pk-caption" hidden></div><div class="pk-toasts" aria-live="polite"></div>`;
  const feed = layer.querySelector('.pk-feed'),
    alertPop = layer.querySelector('.pk-alert-pop'),
    caption = layer.querySelector('.pk-caption'),
    toasts = layer.querySelector('.pk-toasts');
  const state = {feed: null, box: null, alertId: null, caption: null, cue: null};
  let hideTimer = 0;

  function renderFeed() {
    const f = state.feed;
    if (feed.hidden !== !f) actions.feedChanged?.(); // the 3D view redraws so a live picture appears or clears
    feed.hidden = !f;
    if (!f) return;
    const v = f.verdict;
    const verdict =
      f.phase === 'reading'
        ? ''
        : v.exit
          ? `<span class="pk-pill info">${t('lpr.exit')}</span>`
          : v.allow
            ? `<span class="pk-pill ok">${t('lpr.match')} · ${t(`type.${v.type}`)}</span>`
            : `<span class="pk-pill bad">${t('lpr.nomatch')}</span>`;
    // Live: the box is placed each frame and keeps its last place when the card redraws (no blink).
    const b = state.box,
      place = b ? ` style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"` : '';
    const box = `<i class="pk-feed-box ${f.phase}"${place}${b ? '' : ' hidden'}></i>`;
    feed.innerHTML = `<div class="pk-feed-head"><span><i class="pk-rec"></i>${f.which === 'in' ? 'LPR-IN' : 'LPR-OUT'}</span><time>${fmtTime(sim.now(), true)}</time></div>
      <div class="pk-feed-img live">${box}</div>
      <div class="pk-feed-result"><div class="pk-feed-plate${f.phase === 'reading' ? ' reading' : ''}"><b>${f.phase === 'reading' ? '· · ·' : esc(f.plate)}</b><small>${f.phase === 'reading' ? t('lpr.read') + '…' : esc(f.province)}</small></div><div class="pk-feed-meta">${f.phase === 'reading' ? '' : `<small>${t('lpr.confidence')} ${Math.round(f.confidence * 100)}%</small>`}${verdict}${v.vehicle?.validTo && f.phase !== 'reading' && !v.exit ? `<small>${t('lpr.validUntil')} ${validUntil(v.vehicle.validTo, sim.now())}</small>` : ''}</div></div>`;
  }

  function renderAlert() {
    const a = state.alertId && sim.state.alerts.find((x) => x.id === state.alertId);
    alertPop.hidden = !a || a.status !== 'open';
    if (alertPop.hidden) return;
    alertPop.innerHTML = `<div class="pk-alert-pop-head">${icon('alert')}<div><strong>${t('alert.title')}</strong><small>${fmtTime(a.at, true)} · LPR-IN</small></div></div>
      <div class="pk-alert-pop-body">${a.snapshot ? `<img src="${a.snapshot}" alt="">` : ''}<div><div class="pk-plate-big small">${esc(a.plate)}<small>${esc(a.province)}</small></div><p>${t('alert.body')}</p></div></div>
      <label class="pk-inline">${t('alert.openReason')}<select data-pop-reason>${REASONS.map((r) => `<option value="${r}"${reasonOf(a) === r ? ' selected' : ''}>${t(r)}</option>`).join('')}</select></label>
      <div class="pk-actions"><button class="pk-btn danger" data-pop="deny"${state.cue === 'deny' ? ' data-cue="true"' : ''}>${icon('x')}${t('alert.deny')}</button><button class="pk-btn primary" data-pop="open">${icon('check')}${t('alert.open')}</button></div>`;
  }
  alertPop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop]');
    if (!b || !state.alertId) return;
    actions.resolveAlert(state.alertId, b.dataset.pop, reasonOf(sim.state.alerts.find((x) => x.id === state.alertId)));
  });
  alertPop.addEventListener('change', (e) => {
    if (e.target.matches('[data-pop-reason]') && state.alertId) sim.setAlertReason(state.alertId, e.target.value);
  });

  function renderCaption() {
    const c = state.caption;
    caption.hidden = !c;
    layer.classList.toggle('has-caption', Boolean(c));
    if (!c) return;
    caption.innerHTML = storyCaption(c);
  }

  sim.subscribe((kind) => {
    if (kind === 'alert' || kind === 'alertResolved' || kind === 'reset') {
      if (kind === 'reset') state.alertId = null;
      renderAlert();
    }
  });

  return {
    showFeed(f) {
      cancelLater(hideTimer);
      state.feed = f;
      state.box = null;
      renderFeed();
    },
    updateFeed(patch) {
      if (state.feed) {
        Object.assign(state.feed, patch);
        renderFeed();
      }
    },
    // The live picture area and its plate box, for the canvas inset drawn each frame (index.js).
    feedView() {
      return state.feed && !feed.hidden ? feed.querySelector('.pk-feed-img') : null;
    },
    setFeedBox(box) {
      const el = feed.querySelector('.pk-feed-box');
      if (!el) return;
      // null once the camera can no longer read the plate (index.js plateBox).
      state.box = box;
      el.hidden = !box;
      if (box)
        Object.assign(el.style, {
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.w * 100}%`,
          height: `${box.h * 100}%`,
        });
    },
    // On demo time (later): it stays up while paused, like the car it shows.
    hideFeed(delay = 3500) {
      cancelLater(hideTimer);
      hideTimer = later(() => {
        state.feed = null;
        renderFeed();
      }, delay);
    },
    showAlert(id) {
      state.alertId = id;
      renderAlert();
    },
    setCue(name) {
      state.cue = name;
      renderAlert();
    },
    caption(c) {
      state.caption = c;
      renderCaption();
    },
    toast(text, tone = '') {
      const el = document.createElement('div');
      el.className = `pk-toast ${tone}`;
      el.innerHTML = text;
      toasts.append(el);
      // On the engine's clock: it holds while paused, and keeps step with the story whatever the `speed` option.
      later(() => el.classList.add('out'), 3800);
      later(() => el.remove(), 4300);
    },
    refresh() {
      renderFeed();
      renderAlert();
      renderCaption();
    },
    reset() {
      state.feed = null;
      state.alertId = null;
      state.caption = null;
      state.cue = null;
      toasts.innerHTML = '';
      renderFeed();
      renderAlert();
      renderCaption();
    },
  };
}
