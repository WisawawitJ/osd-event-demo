// Small DOM helpers shared by the parking UI.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const paths = {
  car: 'M5 17h14M6 17v2m12-2v2M4 13l2-5h12l2 5v4H4ZM7 13h.01M17 13h.01',
  gate: 'M4 21V10h4v11M8 12h13M13 12V7m4 5V7m4 5V7M4 6V3h16v3',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6Z',
  doc: 'M7 3h7l5 5v13H7ZM14 3v5h5M10 13h6m-6 4h6',
  check: 'm5 12 4 4L19 6',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2 20h20ZM12 10v4m0 3h.01',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM11 18h2',
  play: 'm8 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  next: 'm9 6 6 6-6 6',
  restart: 'M4 4v6h6M5 15a8 8 0 1 0 2-9L4 10',
  hand: 'M9 11V5a2 2 0 0 1 4 0v5m0-1a2 2 0 0 1 4 0v2m0-1a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-5a2 2 0 0 1 3-2l2 2',
  download: 'M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 21V9m-5 5 5-5 5 5M5 8V3h14v5',
  retry: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  calendar: 'M4 6h16v15H4ZM4 10h16M8 3v5m8-5v5',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
  arrowIn: 'M12 4v12m-5-5 5 5 5-5M5 20h14',
  arrowOut: 'M12 20V8m-5 5 5-5 5 5M5 4h14',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5',
};
export const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}><path d="${paths[name] || paths.car}"/></svg>`;

// Re-render a container without losing the focused field, its caret or the scroll position.
export function patch(el, html) {
  const active = document.activeElement;
  const focusId = active && el.contains(active) ? active.dataset.focus || active.id : null;
  const sel = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = scroll;
  if (focusId) {
    const next = el.querySelector(`[data-focus="${focusId}"],#${CSS.escape(focusId)}`);
    if (next) { next.focus({preventScroll: true}); if (sel && next.setSelectionRange) try { next.setSelectionRange(...sel); } catch {} }
  }
}

// A deterministic QR-like pattern for the demo ticket (not a scannable code).
export function fakeQr(text, size = 29) {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
  const cells = [];
  const finder = (x, y) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
  const finderOn = (x, y) => { const fx = x >= size - 7 ? x - (size - 7) : x, fy = y >= size - 7 ? y - (size - 7) : y; return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const on = finder(x, y) ? finderOn(x, y) : (x === 7 || y === 7 || x === size - 8 || y === size - 8) ? false : (x === 6 || y === 6) ? (x + y) % 2 === 0 : rand() < .48;
    if (on) cells.push(`M${x} ${y}h1v1h-1z`);
  }
  return `<svg class="qr" viewBox="-2 -2 ${size + 4} ${size + 4}" role="img" aria-label="QR"><rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="#fff"/><path d="${cells.join('')}" fill="#14202b"/></svg>`;
}

export function download(name, rows) {
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  const a = Object.assign(document.createElement('a'), {href: url, download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
