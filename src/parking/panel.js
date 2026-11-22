// The staff console shown in the side panel: overview, requests, gate, vehicles and reports.
import {t, tx, fmtTime, fmtDate, fmtShortDate, fmtDateTime, getLang} from './i18n.js';
import {esc, icon, patch, fakeQr, download} from './dom.js';
import {PROVINCES, normalizePlate, GATE_REASONS as REASONS} from './sim.js';

const TABS = [['overview', 'chart'], ['requests', 'inbox'], ['gate', 'gate'], ['vehicles', 'car'], ['reports', 'doc']];
const KIND_KEY = {entry: 'ev.entry', exit: 'ev.exit', unknown: 'ev.unknown', denied: 'ev.denied', manual: 'ev.manual', exitNoEntry: 'ev.exitNoEntry'};
const VEHICLE_RANK = {vip: 0, guest: 1, staff: 2};

export function createPanel({root, sim, actions}) {
  let shownTab = null;
  const ui = {tab: 'overview', reqFilter: 'pending', reqSearch: '', selected: null, rejecting: false, rejectText: '', vehFilter: 'all', vehSearch: '', add: {plate: '', province: PROVINCES[0][0], owner: ''}, manualReason: REASONS[0], alertReason: {}, newIds: new Set(), cue: null, flash: null, snapshots: {in: '', out: ''}};
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); };

  const pill = (text, tone = '') => `<span class="pk-pill ${tone}">${esc(text)}</span>`;
  const statusTone = {pending: 'warn', approved: 'ok', rejected: 'bad', expired: 'mute', revoked: 'bad'};
  const syncTone = {synced: 'ok', pending: 'warn', failed: 'bad'};
  const cue = name => (ui.cue === name ? ' data-cue="true"' : '');
  const typeLabel = type => t(`type.${type || 'unknown'}`);
  const plate = (p, province) => `<span class="pk-plate-chip"><b>${esc(p)}</b>${province ? `<small>${esc(province)}</small>` : ''}</span>`;

  function tabs() {
    const pending = sim.state.requests.filter(q => q.status === 'pending').length;
    const alerts = sim.state.alerts.filter(a => a.status === 'open').length;
    return `<nav class="pk-tabs" role="tablist">${TABS.map(([id, ic]) => `<button role="tab" data-tab="${id}" aria-selected="${ui.tab === id}"${cue(`tab:${id}`)}>${icon(ic)}<span>${t(`tab.${id}`)}</span>${id === 'requests' && pending ? `<i class="pk-badge">${pending}</i>` : ''}${id === 'gate' && alerts ? `<i class="pk-badge bad">${alerts}</i>` : ''}</button>`).join('')}</nav>`;
  }

  // Overview -------------------------------------------------------------
  function donut(used, total) {
    const r = 46, c = 2 * Math.PI * r, f = total ? Math.min(1, used / total) : 0;
    const tone = f > .9 ? '#d9534a' : f > .75 ? '#e0a33a' : '#0055b8';
    return `<svg class="pk-donut" viewBox="0 0 120 120" role="img" aria-label="${used} / ${total}"><circle cx="60" cy="60" r="${r}" fill="none" stroke="#e8edf5" stroke-width="13"/><circle cx="60" cy="60" r="${r}" fill="none" stroke="${tone}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 60 60)"/><text x="60" y="58" text-anchor="middle" class="pk-donut-main">${used}</text><text x="60" y="78" text-anchor="middle" class="pk-donut-sub">/ ${total}</text></svg>`;
  }
  function hourlyChart(hourly) {
    const max = Math.max(4, ...hourly.map(h => Math.max(h.in || 0, h.out || 0))); // an evening hour's exits can outnumber any hour's entries
    const w = 300, hgt = 92, bw = w / hourly.length;
    const bars = hourly.map((h, i) => {
      const x = i * bw + 3, ih = h.in == null ? 0 : (h.in / max) * (hgt - 18), oh = h.out == null ? 0 : (h.out / max) * (hgt - 18);
      return `<rect x="${x}" y="${hgt - ih}" width="${bw / 2 - 2}" height="${ih}" rx="2" class="in"/><rect x="${x + bw / 2 - 1}" y="${hgt - oh}" width="${bw / 2 - 2}" height="${oh}" rx="2" class="out"/>${i % 4 === 2 ? `<text x="${x + bw / 2 - 2}" y="${hgt + 13}" text-anchor="middle">${String(h.h).padStart(2, '0')}:00</text>` : ''}`;
    }).join('');
    return `<svg class="pk-bars" viewBox="0 0 ${w} ${hgt + 16}" role="img" aria-label="${t('ov.hourly')}"><path d="M0 ${hgt}h${w}" class="axis"/>${bars}</svg><div class="pk-legend"><span><i class="in"></i>${t('ev.entry')}</span><span><i class="out"></i>${t('ev.exit')}</span></div>`;
  }
  function eventRow(e) {
    const tone = {entry: 'ok', exit: 'mute', unknown: 'bad', denied: 'bad', manual: 'warn', exitNoEntry: 'warn'}[e.kind];
    return `<div class="pk-event${ui.flash === e.id ? ' flash' : ''}"><time>${fmtTime(e.at)}</time>${icon(e.kind === 'exit' || e.kind === 'exitNoEntry' ? 'arrowOut' : 'arrowIn')}<div>${plate(e.plate, e.province)}<small>${typeLabel(e.type)}${e.reason ? ` · ${t(e.reason)}` : ''}${e.by ? ` · ${t(e.by)}` : ''}</small></div>${pill(t(KIND_KEY[e.kind]), tone)}</div>`;
  }
  function overview() {
    const s = sim.stats();
    const free = Math.max(0, s.capacity - s.parked);
    const att = sim.attention();
    return `<section class="pk-occupancy">${donut(s.parked, s.capacity)}<div><span class="metric-label">${t('ov.occupancy')}</span><div class="metric-value">${s.parked}<small>${t('cars')}</small></div><span class="metric-note">${t('ov.free')} ${free} · ${t('ov.capacity')} ${s.capacity}</span><span class="pk-live"><i></i>${t('ov.stale')} · ${fmtTime(sim.now())}</span></div></section>
    <div class="pk-kpis"><div><span>${t('ov.entries')}</span><strong>${s.entries}</strong></div><div><span>${t('ov.exits')}</span><strong>${s.exits}</strong></div><div><span>${t('ov.pending')}</span><strong>${s.pending}</strong></div><div><span>${t('ov.unknown')}</span><strong>${s.unknown}</strong></div></div>
    ${att.length ? `<div class="dashboard-section"><h3>${t('ov.attention')} <span class="pk-count">${att.length}</span></h3>${att.map(a => `<button class="pk-attention ${a.kind}" data-key="${esc(a.kind + ':' + a.id)}" data-goto="${a.kind}" data-id="${a.id}">${icon(a.kind === 'alert' ? 'alert' : a.kind === 'request' ? 'inbox' : 'sync')}<span><strong>${t(a.key)}</strong><small>${esc(a.target)}</small></span>${icon('next')}</button>`).join('')}</div>` : ''}
    <div class="dashboard-section"><h3>${t('ov.hourly')}</h3>${hourlyChart(s.hourly)}</div>
    <div class="dashboard-section"><h3>${t('ov.zones')}</h3>${['P1', 'P2'].map(z => `<div class="pk-zone"><div><span>${t(`zone.${z}`)}</span><strong>${s.zones[z].used} / ${s.zones[z].total}</strong></div><i><b style="width:${(s.zones[z].used / s.zones[z].total) * 100}%"></b></i></div>`).join('')}</div>
    <div class="dashboard-section"><h3>${t('ov.recent')}</h3>${sim.state.events.slice(0, 5).map(eventRow).join('')}</div>
    <p class="scenario-note">${t('ov.lastReset')} · ${t('sim.data')}</p>`;
  }

  // Requests -------------------------------------------------------------
  function requestList() {
    const q = ui.reqSearch.trim().toLowerCase(), np = normalizePlate(ui.reqSearch);
    const list = sim.state.requests.filter(r => (ui.reqFilter === 'all' || r.status === ui.reqFilter) && (!q || r.visitor.name.toLowerCase().includes(q) || normalizePlate(r.plate).includes(np))).sort((a, b) => b.createdAt - a.createdAt);
    const chips = ['pending', 'approved', 'rejected', 'all'].map(f => `<button data-req-filter="${f}" aria-pressed="${ui.reqFilter === f}">${f === 'all' ? t('all') : t(`req.status.${f}`)}</button>`).join('');
    return `<div class="pk-toolbar"><div class="pk-chips">${chips}</div><input type="search" data-focus="req-search" placeholder="${t('search')}" value="${esc(ui.reqSearch)}"></div>
    <div class="pk-list">${list.length ? list.map(r => `<button class="pk-row${ui.newIds.has(r.id) ? ' is-new' : ''}" data-key="${esc(r.id)}" data-request="${r.id}"${cue(`request:${r.id}`)}><span class="pk-row-main"><strong>${esc(r.visitor.name)}${ui.newIds.has(r.id) ? ` <i class="pk-new">${t('req.new')}</i>` : ''}</strong><small>${esc(r.visitor.company)} · ${fmtShortDate(r.arrival)}${r.departure !== r.arrival ? `–${fmtShortDate(r.departure)}` : ''}</small></span>${plate(r.plate, r.province)}${pill(t(`req.status.${r.status}`), statusTone[r.status])}</button>`).join('') : `<p class="pk-empty">${t('none')}</p>`}</div>`;
  }
  function requestDetail(r) {
    const flags = sim.flagsFor(r);
    const existing = sim.findVehicle(r.plate, r.province).filter(v => v.requestId !== r.id);
    const field = (label, value) => `<div class="data-row"><span>${label}</span><strong>${value}</strong></div>`;
    const actionsHtml = r.status === 'pending'
      ? (ui.rejecting
        ? `<div class="pk-reject"><label>${t('req.reject.reason')}<textarea data-focus="reject-text" rows="3">${esc(ui.rejectText)}</textarea></label><div class="pk-actions"><button class="pk-btn" data-act="reject-cancel">${t('cancel')}</button><button class="pk-btn danger" data-act="reject-confirm"${ui.rejectText.trim() ? '' : ' disabled'}>${t('req.reject')}</button></div></div>`
        : `<p class="pk-hint">${t('req.approve.confirm')}</p><div class="pk-actions"><button class="pk-btn" data-act="reject"${cue('reject')}>${icon('x')}${t('req.reject')}</button><button class="pk-btn primary" data-act="approve"${cue('approve')}>${icon('check')}${t('req.approve')}</button></div>`)
      : r.status === 'approved' ? `<div class="pk-actions"><button class="pk-btn danger ghost" data-act="revoke">${t('req.revoke')}</button></div>` : '';
    return `<button class="pk-back" data-act="back">${icon('next', 'flip')}${t('req.back')}</button>
    <div class="pk-detail-head"><div><h3>${esc(r.visitor.name)}</h3><small>${t('req.receipt')} ${esc(r.ref)}</small></div>${pill(t(`req.status.${r.status}`), statusTone[r.status])}</div>
    <div class="pk-plate-big">${esc(r.plate)}<small>${esc(r.province)}</small></div>
    ${flags.length && r.status === 'pending' ? `<div class="pk-flags">${flags.map(f => pill(t(f), f === 'req.flag.today' ? 'info' : 'warn')).join('')}</div>` : ''}
    ${r.status === 'pending' ? `<div class="pk-atom">${icon('shield')}<div><strong>${t('req.atom')} · ${t('sim')}</strong><span>${existing.length ? t('req.atom.found') : t('req.atom.none')}</span></div></div>` : ''}
    ${r.status === 'approved' ? `<div class="pk-atom ok">${icon(r.syncing ? 'sync' : 'check')}<div><strong>${r.syncing ? t('req.registering') : t('req.registered')}</strong><span>${r.history.some(h => h.key === 'h.email') ? t('req.emailSent') : '…'}</span></div></div>` : ''}
    ${actionsHtml}
    <div class="dashboard-section">
      ${field(t('req.dates'), `${fmtDate(r.arrival)}${r.departure !== r.arrival ? ` – ${fmtDate(r.departure)}` : ''}`)}
      ${field(t('req.access'), t('req.access.value', {from: fmtShortDate(r.arrival), to: fmtShortDate(r.departure)}))}
      ${field(t('req.company'), esc(r.visitor.company))}
      ${field(t('req.phone'), esc(r.visitor.phone))}
      ${field(t('req.email'), esc(r.visitor.email))}
      ${field(t('req.contact'), esc(r.contact))}
      ${field(t('req.face'), r.face ? t('req.face.yes') : t('req.face.no'))}
      ${r.notes ? field(t('req.notes'), esc(r.notes)) : ''}
      ${r.reason ? field(t('req.reject.reason'), esc(r.reason)) : ''}
    </div>
    ${r.status === 'approved' && r.qr ? `<div class="dashboard-section pk-qr-row">${fakeQr(r.qr)}<div><strong>${t('req.qr')}</strong><small>${esc(r.qr)} · ${t('sim')}</small></div></div>` : ''}
    <div class="dashboard-section"><h3>${t('req.history')}</h3>${[...r.history].reverse().map(h => `<div class="event-row"><time>${fmtDateTime(h.at)}</time><p>${t(h.key)}${h.by ? ` · ${t(h.by)}` : ''}</p></div>`).join('')}</div>`;
  }

  // Gate -----------------------------------------------------------------
  function gate() {
    const g = sim.state.gate;
    const tone = g === 'open' ? 'ok' : g === 'closed' ? 'mute' : 'warn';
    const open = sim.state.alerts.filter(a => a.status === 'open');
    return `${open.map(a => alertCard(a)).join('')}
    <div class="pk-gate-status ${g}"><div class="pk-gate-icon">${icon('gate')}</div><div><span class="metric-label">${t('gate.status')}</span><strong>${t(`gate.${g}`)}</strong><small><i class="pk-dot"></i>${t('gate.online')}</small></div>${pill(t(`gate.${g}`), tone)}</div>
    <div class="pk-cams">${['in', 'out'].map(k => `<figure>${ui.snapshots[k] ? `<img src="${ui.snapshots[k]}" alt="">` : `<div class="pk-cam-empty">${icon('camera')}</div>`}<figcaption>${t(k === 'in' ? 'gate.camIn' : 'gate.camOut')}</figcaption></figure>`).join('')}</div>
    <div class="dashboard-section"><h3>${t('gate.manual')}</h3><p class="pk-hint">${t('gate.manual.note')}</p><div class="pk-manual"><select data-focus="manual-reason" aria-label="${t('gate.reason')}">${REASONS.map(r => `<option value="${r}"${ui.manualReason === r ? ' selected' : ''}>${t(r)}</option>`).join('')}</select><button class="pk-btn primary" data-act="manual-open"${g !== 'closed' || open.length ? ' disabled' : ''}>${t('gate.openOnce')}</button></div>${open.length ? `<p class="pk-hint">${t('gate.manual.alertFirst')}</p>` : ''}</div>
    <div class="dashboard-section"><h3>${t('gate.sim')} · ${t('sim')}</h3><div class="pk-sim-grid">${[['registered', 'car'], ['visitor', 'user'], ['unknown', 'alert'], ['exit', 'arrowOut']].map(([k, ic]) => `<button class="pk-btn" data-sim="${k}"${cue(`sim:${k}`)}${actions.storyRunning?.() ? ' disabled' : ''}>${icon(ic)}${t(`gate.sim.${k}`)}</button>`).join('')}</div></div>
    <div class="dashboard-section"><h3>${t('gate.log')}</h3>${sim.state.events.slice(0, 14).map(eventRow).join('')}</div>`;
  }
  function alertCard(a) {
    const reason = ui.alertReason[a.id] || REASONS[1];
    return `<div class="pk-alert-card" data-alert="${a.id}"><div class="pk-alert-head">${icon('alert')}<div><strong>${t('alert.title')}</strong><small>${fmtTime(a.at, true)} · ${t('gate.camIn')}</small></div></div>
    ${a.snapshot ? `<img src="${a.snapshot}" alt="">` : ''}<div class="pk-plate-big small">${esc(a.plate)}<small>${esc(a.province)}</small></div><p>${t('alert.body')}</p>
    <label class="pk-inline">${t('alert.openReason')}<select data-alert-reason="${a.id}">${REASONS.map(r => `<option value="${r}"${reason === r ? ' selected' : ''}>${t(r)}</option>`).join('')}</select></label>
    <div class="pk-actions"><button class="pk-btn danger" data-alert-deny="${a.id}"${cue('deny')}>${icon('x')}${t('alert.deny')}</button><button class="pk-btn primary" data-alert-open="${a.id}"${cue('open')}>${icon('check')}${t('alert.open')}</button></div><small class="pk-hint">${t('alert.notify')}</small></div>`;
  }

  // Vehicles -------------------------------------------------------------
  function vehicles() {
    const q = ui.vehSearch.trim().toLowerCase(), np = normalizePlate(ui.vehSearch);
    // Parked by plate, as presence is kept: a plate listed twice (a staff car also given a visitor pass) showed as parked
    // on one row only.
    const parked = new Set(sim.state.presence.keys());
    const list = sim.state.vehicles.filter(v => (ui.vehFilter === 'all' || v.type === ui.vehFilter) && (!q || (v.owner || '').toLowerCase().includes(q) || normalizePlate(v.plate).includes(np)))
      .sort((a, b) => (a.sync === 'synced') - (b.sync === 'synced') || VEHICLE_RANK[a.type] - VEHICLE_RANK[b.type]);
    const counts = {all: sim.state.vehicles.length, staff: 0, vip: 0, guest: 0};
    for (const v of sim.state.vehicles) counts[v.type]++;
    return `<div class="pk-toolbar"><div class="pk-chips">${['all', 'staff', 'vip', 'guest'].map(f => `<button data-veh-filter="${f}" aria-pressed="${ui.vehFilter === f}">${f === 'all' ? t('all') : t(`type.${f}`)} <small>${counts[f]}</small></button>`).join('')}</div><input type="search" data-focus="veh-search" placeholder="${t('search')}" value="${esc(ui.vehSearch)}"></div>
    <details class="pk-add"${ui.addOpen ? ' open' : ''}><summary>${icon('plus')}${t('veh.add')}</summary><form data-form="add"><input data-focus="add-plate" name="plate" placeholder="${t('req.plate')} · 1กข 2345" value="${esc(ui.add.plate)}" required><select name="province">${PROVINCES.map(([th]) => `<option${ui.add.province === th ? ' selected' : ''}>${th}</option>`).join('')}</select><input data-focus="add-owner" name="owner" placeholder="${t('veh.owner')}" value="${esc(ui.add.owner)}"><button class="pk-btn primary" type="submit">${t('save')}</button></form><button class="pk-btn" data-act="import">${icon('upload')}${t('veh.import')}</button></details>
    <div class="pk-list">${list.map(v => `<div class="pk-vrow${v.enabled ? '' : ' disabled'}" data-key="${esc(v.id)}"><span class="pk-row-main">${plate(v.plate, v.province)}<small>${esc(v.owner || '—')} · ${typeLabel(v.type)}${v.validTo ? ` · ${t('veh.valid')} ${fmtShortDate(v.validTo)}` : ''}${parked.has(sim.key(v.plate, v.province)) ? ` · <b class="pk-parked">${t('veh.parked')}</b>` : ''}</small>${v.sync === 'failed' && v.syncError ? `<small class="pk-error">${esc(tx(v.syncError))}</small>` : ''}</span><span class="pk-vrow-side">${pill(v.enabled ? t(`veh.sync.${v.sync}`) : t('veh.disabled'), v.enabled ? syncTone[v.sync] : 'mute')}${v.sync === 'failed' ? `<button class="pk-link" data-retry="${v.id}">${t('veh.retry')}</button>` : `<button class="pk-link" data-toggle="${v.id}">${v.enabled ? t('veh.disable') : t('veh.enable')}</button>`}</span></div>`).join('')}</div>`;
  }

  // Reports --------------------------------------------------------------
  function reports() {
    const s = sim.stats(), y = sim.state.yesterday;
    const col = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
    const typeBar = (k) => { const total = Math.max(1, s.entries); return `<div class="pk-zone"><div><span>${typeLabel(k)}</span><strong>${s.byType[k] || 0}</strong></div><i><b class="${k}" style="width:${((s.byType[k] || 0) / total) * 100}%"></b></i></div>`; };
    return `<div class="dashboard-section pk-first"><h3>${t('rep.summary')}</h3><p class="pk-hint">${t('rep.summary.note')}</p>
    <table class="pk-table"><thead><tr><th></th><th>${t('rep.yesterday')}</th><th>${t('today')} · ${fmtTime(sim.now())}</th></tr></thead><tbody>
    ${col(t('rep.entries'), y.entries, s.entries)}${col(t('rep.exits'), y.exits, s.exits)}${col(t('rep.peak'), `${y.peak} · ${y.peakAt}`, s.peakAt ? `${s.peak} · ${fmtTime(s.peakAt)}` : '—')}
    ${col(t('rep.requests'), `${y.received} / ${y.approved} / ${y.rejected}`, `${s.received} / ${s.approved} / ${s.rejected}`)}${col(t('rep.unknown'), `${y.unknown} / ${y.manual}`, `${s.unknown} / ${s.manual}`)}${col(t('rep.syncFailed'), y.syncFailed, s.syncFailed)}
    </tbody></table></div>
    <div class="dashboard-section"><h3>${t('rep.byType')}</h3>${['staff', 'vip', 'guest', 'unknown'].map(typeBar).join('')}</div>
    <div class="pk-actions wrap"><button class="pk-btn" data-act="csv-events">${icon('download')}${t('rep.csv.events')}</button><button class="pk-btn" data-act="csv-audit">${icon('download')}${t('rep.csv.audit')}</button></div>
    <div class="dashboard-section"><h3>${t('rep.audit')}</h3><p class="pk-hint">${t('rep.audit.note')}</p>${sim.state.audit.slice(0, 16).map(a => `<div class="pk-audit${ui.flash === a ? ' flash' : ''}"><time>${fmtShortDate(a.at)} ${fmtTime(a.at)}</time><div><strong>${t(a.key)}</strong><small>${t(a.actor)}${a.target ? ` · ${esc(a.target)}` : ''}${a.reasonKey ? ` · ${t(a.reasonKey)}` : ''}</small></div></div>`).join('')}</div>
    `;
  }

  function render() {
    let body;
    if (ui.tab === 'requests') {
      const r = ui.selected && sim.state.requests.find(q => q.id === ui.selected);
      body = r ? requestDetail(r) : requestList();
    } else body = {overview, gate, vehicles, reports}[ui.tab]();
    patch(root, `<div class="pk-console-head"><span>${icon('shield')}${t('console.title')}</span><small>ATOM Parking Access · ${t('sim')}</small></div>${tabs()}<div class="pk-tab-body" data-tab-body="${ui.tab}">${body}</div>`);
    // Opening the Gate tab takes fresh pictures from both cameras: the exit camera has none until a car leaves.
    if (ui.tab === 'gate' && shownTab !== 'gate') actions.gateShown?.();
    shownTab = ui.tab;
  }

  // Events
  root.addEventListener('click', e => {
    if (e.target.closest('summary')) { e.preventDefault(); ui.addOpen = !ui.addOpen; render(); return; }
    const el = e.target.closest('button,[data-request]');
    if (!el || el.disabled) return;
    actions.interact?.();
    const d = el.dataset;
    if (d.tab) { ui.tab = d.tab; ui.selected = null; ui.rejecting = false; render(); root.scrollTop = 0; return; }
    if (d.reqFilter) { ui.reqFilter = d.reqFilter; render(); return; }
    if (d.vehFilter) { ui.vehFilter = d.vehFilter; render(); return; }
    if (d.request) { ui.selected = d.request; ui.newIds.delete(d.request); ui.rejecting = false; render(); root.scrollTop = 0; return; }
    if (d.goto) {
      if (d.goto === 'alert') ui.tab = 'gate';
      else if (d.goto === 'request') { ui.tab = 'requests'; ui.selected = d.id; }
      else { ui.tab = 'vehicles'; ui.vehFilter = 'all'; ui.vehSearch = ''; }
      render(); root.scrollTop = 0; return;
    }
    if (d.alertOpen) { actions.resolveAlert(d.alertOpen, 'open', ui.alertReason[d.alertOpen] || REASONS[1]); return; }
    if (d.alertDeny) { actions.resolveAlert(d.alertDeny, 'deny'); return; }
    // Not while the story plays: a car sent then got into its steps (the visitor's car denied in the stray's place).
    if (d.sim) { if (!actions.storyRunning?.()) actions.simulate(d.sim); return; }
    if (d.retry) { sim.retrySync(d.retry); return; }
    if (d.toggle) { const v = sim.state.vehicles.find(v => v.id === d.toggle); if (v) sim.setEnabled(v.id, !v.enabled); return; }
    switch (d.act) {
      case 'back': ui.selected = null; ui.rejecting = false; render(); break;
      case 'approve': actions.approve(ui.selected); break;
      case 'reject': ui.rejecting = true; ui.rejectText = t('req.reject.default'); render(); break;
      case 'reject-cancel': ui.rejecting = false; render(); break;
      case 'reject-confirm': sim.reject(ui.selected, ui.rejectText.trim()); ui.rejecting = false; break;
      // Says whether an email goes: only once the ticket has been emailed (as in the real app).
      case 'revoke': if (confirm(t(sim.state.requests.find(q => q.id === ui.selected)?.history.some(h => h.key === 'h.email') ? 'req.revoke.confirm' : 'req.revoke.confirmNoMail'))) sim.revoke(ui.selected); break;
      case 'manual-open': actions.manualOpen(ui.manualReason); break;
      case 'import': { const n = sim.importCsv(); actions.toast?.(n ? t('veh.import.done', {n}) : t('veh.import.none')); break; }
      case 'csv-events': download(`osd-parking-events-${getLang()}.csv`, [['time', 'kind', 'plate', 'province', 'type', 'camera', 'by', 'reason'], ...sim.state.events.map(e => [fmtDateTime(e.at), t(KIND_KEY[e.kind]), e.plate, e.province, typeLabel(e.type), e.camera, e.by ? t(e.by) : '', e.reason ? t(e.reason) : ''])]); break;
      case 'csv-audit': download(`osd-parking-audit-${getLang()}.csv`, [['time', 'actor', 'action', 'target', 'reason'], ...sim.state.audit.map(a => [fmtDateTime(a.at), t(a.actor), t(a.key), a.target || '', a.reasonKey ? t(a.reasonKey) : ''])]); break;
    }
  });
  root.addEventListener('input', e => {
    const f = e.target.dataset.focus;
    if (f === 'req-search') { ui.reqSearch = e.target.value; render(); }
    else if (f === 'veh-search') { ui.vehSearch = e.target.value; render(); }
    else if (f === 'reject-text') { ui.rejectText = e.target.value; root.querySelector('[data-act="reject-confirm"]').disabled = !ui.rejectText.trim(); }
    else if (e.target.name && e.target.closest('[data-form="add"]')) ui.add[e.target.name] = e.target.value;
  });
  root.addEventListener('change', e => {
    if (e.target.dataset.focus === 'manual-reason') ui.manualReason = e.target.value;
    if (e.target.dataset.alertReason) ui.alertReason[e.target.dataset.alertReason] = e.target.value;
    if (e.target.name === 'province') ui.add.province = e.target.value;
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    actions.interact?.();
    if (!ui.add.plate.trim()) return;
    const added = sim.addVehicle({plate: ui.add.plate.trim(), province: ui.add.province, owner: ui.add.owner.trim() || '—'});
    actions.toast?.(t(added ? 'veh.added' : 'veh.exists'));
    if (!added) return;
    ui.add = {plate: '', province: ui.add.province, owner: ''};
    ui.vehFilter = 'all'; ui.vehSearch = '';
    render();
  });

  return {
    render: schedule,
    show(tab, {request = null} = {}) { ui.tab = tab; ui.selected = request; ui.rejecting = false; render(); root.scrollTop = 0; },
    markNew(id) { ui.newIds.add(id); schedule(); },
    setCue(name) { ui.cue = name; render(); },
    flash(id) { ui.flash = id; schedule(); setTimeout(() => { if (ui.flash === id) { ui.flash = null; schedule(); } }, 2400); },
    setSnapshot(which, url) { ui.snapshots[which] = url; if (ui.tab === 'gate') schedule(); },
    // Alert reasons go too: ids start again after a reset, and a new alert showed an old one's reason.
    reset() { Object.assign(ui, {tab: 'overview', reqFilter: 'pending', reqSearch: '', selected: null, rejecting: false, vehFilter: 'all', vehSearch: '', cue: null, flash: null, snapshots: {in: '', out: ''}, alertReason: {}}); ui.newIds.clear(); render(); },
  };
}
