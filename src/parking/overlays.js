// Overlays on the 3D view: the plate-camera feed, the unknown-car alert, story captions and toasts.
import {t, fmtTime} from './i18n.js';
import {esc, icon} from './dom.js';
import {GATE_REASONS as REASONS} from './sim.js';

export function createOverlays({layer, sim, actions}) {
  layer.innerHTML = `<div class="pk-feed" hidden></div><div class="pk-alert-pop" hidden></div><div class="pk-caption" hidden></div><div class="pk-toasts" aria-live="polite"></div>`;
  const feed = layer.querySelector('.pk-feed'), alertPop = layer.querySelector('.pk-alert-pop'), caption = layer.querySelector('.pk-caption'), toasts = layer.querySelector('.pk-toasts');
  const state = {feed: null, box: null, alertId: null, reason: REASONS[1], caption: null, cue: null};
  let hideTimer = 0;

  function renderFeed() {
    const f = state.feed;
    if (feed.hidden !== !f) actions.feedChanged?.(); // the 3D view redraws so a live picture appears or clears
    feed.hidden = !f;
    if (!f) return;
    const v = f.verdict;
    const verdict = f.phase === 'reading' ? '' : v.exit ? `<span class="pk-pill info">${t('lpr.exit')}</span>` : v.allow ? `<span class="pk-pill ok">${t('lpr.match')} · ${t(`type.${v.type}`)}</span>` : `<span class="pk-pill bad">${t('lpr.nomatch')}</span>`;
    // Live: the box is placed each frame and keeps its last place when the card redraws (no blink); a still keeps its fixed box.
    const b = f.live ? state.box : f.box, place = b ? ` style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"` : '';
    const box = f.live || f.box ? `<i class="pk-feed-box ${f.phase}"${place}${b ? '' : ' hidden'}></i>` : '';
    feed.innerHTML = `<div class="pk-feed-head"><span><i class="pk-rec"></i>${f.which === 'in' ? 'LPR-IN' : 'LPR-OUT'} · ${t('sim')}</span><time>${fmtTime(sim.now(), true)}</time></div>
      <div class="pk-feed-img${f.live ? ' live' : ''}">${!f.live && f.snapshot ? `<img src="${f.snapshot}" alt="">` : ''}${box}</div>
      <div class="pk-feed-result"><div class="pk-feed-plate${f.phase === 'reading' ? ' reading' : ''}"><b>${f.phase === 'reading' ? '· · ·' : esc(f.plate)}</b><small>${f.phase === 'reading' ? t('lpr.read') + '…' : esc(f.province)}</small></div><div class="pk-feed-meta">${f.phase === 'reading' ? '' : `<small>${t('lpr.confidence')} ${Math.round(f.confidence * 100)}%</small>`}${verdict}${v.vehicle?.validTo && f.phase !== 'reading' && !v.exit ? `<small>${t('lpr.validUntil')} ${fmtTime(v.vehicle.validTo)}</small>` : ''}</div></div>`;
  }

  function renderAlert() {
    const a = state.alertId && sim.state.alerts.find(x => x.id === state.alertId);
    alertPop.hidden = !a || a.status !== 'open';
    if (alertPop.hidden) return;
    alertPop.innerHTML = `<div class="pk-alert-pop-head">${icon('alert')}<div><strong>${t('alert.title')}</strong><small>${fmtTime(a.at, true)} · LPR-IN</small></div></div>
      <div class="pk-alert-pop-body">${a.snapshot ? `<img src="${a.snapshot}" alt="">` : ''}<div><div class="pk-plate-big small">${esc(a.plate)}<small>${esc(a.province)}</small></div><p>${t('alert.body')}</p></div></div>
      <label class="pk-inline">${t('alert.openReason')}<select data-pop-reason>${REASONS.map(r => `<option value="${r}"${state.reason === r ? ' selected' : ''}>${t(r)}</option>`).join('')}</select></label>
      <div class="pk-actions"><button class="pk-btn danger" data-pop="deny"${state.cue === 'deny' ? ' data-cue="true"' : ''}>${icon('x')}${t('alert.deny')}</button><button class="pk-btn primary" data-pop="open"${state.cue === 'open' ? ' data-cue="true"' : ''}>${icon('check')}${t('alert.open')}</button></div>`;
  }
  alertPop.addEventListener('click', e => {
    const b = e.target.closest('[data-pop]');
    if (!b || !state.alertId) return;
    actions.interact?.();
    actions.resolveAlert(state.alertId, b.dataset.pop, state.reason);
  });
  alertPop.addEventListener('change', e => { if (e.target.matches('[data-pop-reason]')) state.reason = e.target.value; });

  function renderCaption() {
    const c = state.caption;
    caption.hidden = !c;
    layer.classList.toggle('has-caption', Boolean(c));
    if (!c) return;
    caption.innerHTML = `<span class="pk-caption-step">${esc(c.step)}</span><strong>${esc(c.title)}</strong><p>${esc(c.body)}</p>${c.hint ? `<span class="pk-caption-hint">${icon('hand')}${esc(c.hint)}</span>` : ''}`;
  }

  sim.subscribe(kind => {
    if (kind === 'alert' || kind === 'alertResolved' || kind === 'reset') { if (kind === 'reset') state.alertId = null; renderAlert(); }
  });

  return {
    showFeed(f) { clearTimeout(hideTimer); state.feed = f; state.box = null; renderFeed(); },
    updateFeed(patch) { if (state.feed) { Object.assign(state.feed, patch); renderFeed(); } },
    // The live picture area and its plate box, for the canvas inset drawn each frame (index.js).
    feedView() { return state.feed?.live && !feed.hidden ? feed.querySelector('.pk-feed-img') : null; },
    setFeedBox(box) {
      const el = feed.querySelector('.pk-feed-box');
      if (!el) return;
      // null once the camera can no longer read the plate (index.js plateBox).
      state.box = box;
      el.hidden = !box;
      if (box) Object.assign(el.style, {left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`});
    },
    hideFeed(delay = 3500) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { state.feed = null; renderFeed(); }, delay); },
    showAlert(id) { state.alertId = id; state.reason = REASONS[1]; renderAlert(); },
    setCue(name) { state.cue = name; renderAlert(); },
    caption(c) { state.caption = c; renderCaption(); },
    toast(text, tone = '') {
      const el = document.createElement('div');
      el.className = `pk-toast ${tone}`; el.innerHTML = text;
      toasts.append(el);
      setTimeout(() => el.classList.add('out'), 3800);
      setTimeout(() => el.remove(), 4300);
    },
    refresh() { renderFeed(); renderAlert(); renderCaption(); },
    reset() { state.feed = null; state.alertId = null; state.caption = null; state.cue = null; toasts.innerHTML = ''; renderFeed(); renderAlert(); renderCaption(); },
  };
}
