// The visitor's phone: the public request form, the confirmation, and the emailed ticket.
import {t, fmtDate, fmtTime} from './i18n.js';
import {esc, icon, patch, fakeQr} from './dom.js';
import {PROVINCES} from './sim.js';

const blankForm = () => ({name: '', phone: '', email: '', company: '', contact: '', plate: '', province: '', arrival: '2026-11-24', departure: '2026-11-24', notes: '', consent: false, faceConsent: false, face: false, photo: 'idle'});
const dateValue = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d, -7); };

// An illustrated car photo for the plate-reading step (drawn, not captured).
function carPhoto(plate, province, reading) {
  return `<svg viewBox="0 0 240 150" class="ph-photo" role="img" aria-label="car photo"><defs><linearGradient id="phsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9dbe4"/><stop offset="1" stop-color="#eef1ec"/></linearGradient></defs><rect width="240" height="150" fill="url(#phsky)"/><rect y="104" width="240" height="46" fill="#9aa29e"/><path d="M38 108 52 66q4-10 15-10h106q11 0 15 10l14 42Z" fill="#2f5d9a"/><path d="M62 70h116l10 26H52Z" fill="#1f2b35" opacity=".85"/><rect x="30" y="100" width="180" height="30" rx="8" fill="#2a5189"/><rect x="40" y="106" width="26" height="9" rx="3" fill="#ffd9c2"/><rect x="174" y="106" width="26" height="9" rx="3" fill="#ffd9c2"/><rect x="34" y="128" width="30" height="16" rx="4" fill="#20262c"/><rect x="176" y="128" width="30" height="16" rx="4" fill="#20262c"/><g transform="translate(88 110)"><rect width="64" height="30" rx="3" fill="#fbfbf7" stroke="#1d232a" stroke-width="1.5"/><text x="32" y="15" text-anchor="middle" font-size="12" font-weight="700" fill="#121820">${esc(plate)}</text><text x="32" y="26" text-anchor="middle" font-size="6.5" fill="#121820">${esc(province)}</text></g>${reading ? '<rect x="84" y="106" width="72" height="38" rx="4" fill="none" stroke="#38d36b" stroke-width="2.5" stroke-dasharray="6 4" class="ph-scan"/>' : ''}</svg>`;
}
const faceArt = `<svg viewBox="0 0 80 80" class="ph-face" role="img" aria-label="face photo"><rect width="80" height="80" rx="12" fill="#e4ebf3"/><circle cx="40" cy="32" r="15" fill="#c99f80"/><path d="M25 28q2-16 15-16t15 16q-6-7-15-7t-15 7Z" fill="#2b2a2e"/><path d="M14 80q2-24 26-24t26 24Z" fill="#3a6fb0"/><rect x="22" y="14" width="36" height="40" rx="8" fill="none" stroke="#38d36b" stroke-width="2" stroke-dasharray="5 4"/></svg>`;

export function createPhone({root, sim, actions}) {
  const ui = {open: false, screen: 'form', form: blankForm(), error: '', requestId: null, banner: null, cue: null, typing: null};
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); };
  const req = () => ui.requestId && sim.state.requests.find(q => q.id === ui.requestId);
  const cue = name => (ui.cue === name ? ' data-cue="true"' : '');

  function field(name, label, {type = 'text', placeholder = '', required = true, help = ''} = {}) {
    const v = ui.form[name];
    return `<label class="ph-field${ui.typing === name ? ' typing' : ''}"><span>${label}${required ? ' *' : ''}</span><input name="${name}" data-focus="ph-${name}" type="${type}" value="${esc(v)}" placeholder="${esc(placeholder)}"${type === 'email' ? ' inputmode="email"' : ''}>${help ? `<small>${help}</small>` : ''}</label>`;
  }
  function formScreen() {
    const f = ui.form;
    return `<div class="ph-hero"><strong>${t('ph.formTitle')}</strong><span>${t('ph.formIntro')}</span></div>
    ${field('name', t('ph.name'), {placeholder: 'ชื่อ นามสกุล'})}
    ${field('email', t('req.email'), {type: 'email', placeholder: 'name@example.com'})}
    ${field('contact', t('req.contact'), {type: 'email', placeholder: 'name@osd.example'})}
    ${field('company', t('req.company'), {required: false})}
    ${field('phone', t('req.phone'), {type: 'tel', placeholder: '08x-xxx-xxxx'})}
    <div class="ph-two">${field('arrival', t('req.arrival'), {type: 'date'})}${field('departure', t('req.departure'), {type: 'date'})}</div>
    <div class="ph-card">
      <button type="button" class="ph-photo-btn" data-ph="photo"${cue('photo')}>${icon('camera')}${t('ph.photo')}</button>
      ${f.photo !== 'idle' ? `<div class="ph-photo-wrap">${carPhoto(f.photo === 'idle' ? '' : (ui.photoPlate || f.plate), ui.photoProvince || f.province, f.photo === 'reading')}<span class="ph-photo-state ${f.photo}">${f.photo === 'reading' ? t('ph.photo.reading') : t('ph.photo.done')}</span></div>` : ''}
      <div class="ph-two plate">${field('plate', t('req.plate'), {placeholder: '7กข 4821', help: t('ph.plateHelp')})}<label class="ph-field"><span>${t('req.province')} *</span><select name="province" data-focus="ph-province"><option value=""></option>${PROVINCES.map(([th]) => `<option${f.province === th ? ' selected' : ''}>${th}</option>`).join('')}</select></label></div>
    </div>
    <div class="ph-card"><span class="ph-card-title">${t('ph.facePhoto')}</span>
      <label class="ph-check"><input type="checkbox" name="faceConsent"${f.faceConsent ? ' checked' : ''}${cue('faceConsent')}><span>${t('ph.faceConsent')}</span></label>
      ${f.faceConsent ? `<div class="ph-face-row">${f.face ? faceArt : `<button type="button" class="ph-photo-btn small" data-ph="face">${icon('user')}${t('ph.facePhoto')}</button>`}</div>` : ''}
    </div>
    <label class="ph-check"><input type="checkbox" name="consent"${f.consent ? ' checked' : ''}><span>${t('ph.consent')}</span></label>
    ${ui.error ? `<p class="ph-error">${ui.error}</p>` : ''}
    <button type="button" class="ph-submit" data-ph="submit"${cue('submit')}>${t('ph.submit')}</button>`;
  }
  function sentScreen() {
    const r = req();
    return `<div class="ph-done">${icon('check')}<strong>${t('ph.sentTitle')}</strong><p>${t('ph.sentBody')}</p><div class="ph-ref"><span>${t('req.receipt')}</span><b>${esc(r?.receipt || '')}</b></div><div class="ph-summary"><span>${esc(r?.plate)} · ${esc(r?.province)}</span><span>${r ? fmtDate(r.arrival) : ''}</span></div><p class="ph-wait"><i></i>${t('ph.waiting')}</p><button type="button" class="ph-link" data-ph="new">${t('ph.newRequest')}</button></div>`;
  }
  function mailScreen() {
    const r = req();
    const mail = r && sim.state.emails.find(m => m.requestId === r.id);
    if (!r || !mail) return sentScreen();
    const subject = t(`ph.mail.${mail.kind}`);
    const head = `<div class="ph-mail-head"><span class="ph-avatar">P</span><div><strong>OSD Parking</strong><small>no-reply@osd.example · ${fmtTime(mail.at)}</small></div></div><h4>${subject}</h4><p class="ph-to">${esc(r.visitor.email)}, cc ${esc(r.contact)}</p>`;
    if (mail.kind === 'approved') {
      return `${head}<div class="ph-ticket"><div class="ph-ticket-top"><span>${t('ph.ticket')}</span><b>OSD</b></div><div class="ph-ticket-plate">${esc(r.plate)}<small>${esc(r.province)}</small></div><div class="ph-ticket-rows"><div><span>${t('req.dates')}</span><b>${fmtDate(r.arrival)}${r.departure !== r.arrival ? ` – ${fmtDate(r.departure)}` : ''}</b></div><div><span>${t('req.visitor')}</span><b>${esc(r.visitor.name)}</b></div><div><span>${t('parking.floor')}</span><b>P2 · A</b></div></div><p class="ph-ticket-how">${t('ph.ticket.how')}</p><div class="ph-ticket-qr">${fakeQr(r.qr || r.ref)}<span>${t('ph.ticket.qr')}</span></div><button type="button" class="ph-cal">${icon('calendar')}${t('ph.ticket.cal')}</button></div>`;
    }
    return `${head}<p class="ph-mail-body">${mail.kind === 'rejected' ? esc(r.reason || '') : t('req.revoke.confirm')}</p><button type="button" class="ph-link" data-ph="new">${t('ph.newRequest')}</button>`;
  }

  function render() {
    root.hidden = !ui.open;
    if (!ui.open) return;
    const body = ui.screen === 'form' ? formScreen() : ui.screen === 'sent' ? sentScreen() : mailScreen();
    const inboxCount = req() ? sim.state.emails.filter(m => m.requestId === ui.requestId).length : 0;
    patch(root, `<div class="ph-frame"><div class="ph-notch"></div><div class="ph-status"><span>${fmtTime(sim.now())}</span><span class="ph-sys">5G ▮▮▮ 82%</span></div>
      <div class="ph-url">${icon(ui.screen === 'mail' ? 'inbox' : 'globe')}<span>${ui.screen === 'mail' ? t('ph.inbox') : t('ph.site')}</span>${inboxCount && ui.screen !== 'mail' ? `<button type="button" class="ph-inbox" data-ph="inbox">${icon('inbox')}<i>${inboxCount}</i></button>` : ''}${ui.screen === 'mail' ? `<button type="button" class="ph-inbox" data-ph="site">${icon('globe')}</button>` : ''}</div>
      <div class="ph-screen" data-screen="${ui.screen}">${body}</div>
      ${ui.banner ? `<button type="button" class="ph-banner" data-ph="inbox"${cue('banner')}><span class="ph-avatar">P</span><span><b>OSD Parking</b><small>${esc(ui.banner)}</small></span></button>` : ''}
      <div class="ph-home"></div></div><span class="ph-caption">${icon('phone')}${t('ph.label')}</span>`);
  }

  function submit() {
    const f = ui.form;
    const missing = ['name', 'email', 'contact', 'phone', 'plate', 'province'].some(k => !String(f[k]).trim()) || !f.consent;
    if (missing) { ui.error = t('ph.required'); render(); return null; }
    ui.error = '';
    const arrival = dateValue(f.arrival), departure = Math.max(arrival, dateValue(f.departure));
    const r = sim.submitRequest({visitor: {name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), company: f.company.trim() || '—'}, contact: f.contact.trim(), plate: f.plate.trim(), province: f.province, arrival, departure, notes: f.notes, face: f.faceConsent && f.face, color: ui.color ?? 4});
    ui.requestId = r.id; ui.screen = 'sent';
    actions.submitted?.(r);
    render();
    return r;
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-ph]');
    if (!b) return;
    actions.interact?.();
    const what = b.dataset.ph;
    if (what === 'photo') readPhoto();
    if (what === 'face') { ui.form.face = true; render(); }
    if (what === 'submit') submit();
    if (what === 'inbox') { ui.screen = 'mail'; ui.banner = null; render(); }
    if (what === 'site') { ui.screen = req() ? 'sent' : 'form'; render(); }
    if (what === 'new') { ui.form = blankForm(); ui.screen = 'form'; ui.requestId = null; ui.banner = null; render(); }
  });
  root.addEventListener('input', e => {
    const n = e.target.name;
    if (!n) return;
    actions.interact?.();
    ui.form[n] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') render();
  });

  // The free-play photo picks a made-up plate; the story passes its own.
  let photoTimer = 0;
  function readPhoto(plate = null, province = null) {
    const sample = plate ? {plate, province} : {plate: '6กม 3195', province: 'นนทบุรี'};
    ui.photoPlate = sample.plate; ui.photoProvince = sample.province;
    ui.form.photo = 'reading'; render();
    clearTimeout(photoTimer);
    return new Promise(resolve => {
      photoTimer = setTimeout(() => {
        if (!ui.form.plate) ui.form.plate = sample.plate;
        if (!ui.form.province) ui.form.province = sample.province;
        ui.form.photo = 'done'; render(); resolve();
      }, 1500);
    });
  }

  async function typeInto(name, text, {cps = 28, isCancelled = () => false} = {}) {
    ui.typing = name; ui.form[name] = '';
    for (const ch of text) {
      if (isCancelled()) break;
      ui.form[name] += ch; render();
      await new Promise(r => setTimeout(r, 1000 / cps));
    }
    ui.form[name] = text; ui.typing = null; render();
  }

  sim.subscribe((kind, payload) => {
    if (kind === 'email' && payload.requestId === ui.requestId) { ui.banner = t(`ph.mail.${payload.kind}`); render(); }
    else if (ui.open && (kind === 'request' || kind === 'clock')) schedule();
  });

  return {
    render: schedule,
    get state() { return ui; },
    get isOpen() { return ui.open; },
    setOpen(v) { ui.open = v; document.body.classList.toggle('phone-open', v); render(); actions.openChanged?.(v); },
    reset() { Object.assign(ui, {screen: 'form', form: blankForm(), error: '', requestId: null, banner: null, cue: null, typing: null, photoPlate: null, photoProvince: null}); render(); },
    setForm(values) { Object.assign(ui.form, values); render(); },
    setScreen(s) { ui.screen = s; if (s === 'mail') ui.banner = null; render(); },
    setCue(name) { ui.cue = name; render(); },
    setColor(c) { ui.color = c; },
    typeInto, readPhoto, submit,
  };
}
