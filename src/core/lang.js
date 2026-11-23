// Thai (default) or English: the choice (kept in this browser only), the texts, and Bangkok-time formatting.
// Texts come two ways, both in the language on show when they are drawn: `t(key)`, from the tables the pages register
// (addTexts: parking/texts.js, viewer/texts.js), for what the markup or several places use; and `L(th, en)` in place,
// for a text that belongs to one piece of markup.

const KEY = 'osd-demo-language';
const listeners = new Set();
let lang = (() => {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
})();

export const getLang = () => lang;
export function setLang(next) {
  lang = next === 'en' ? 'en' : 'th';
  try {
    localStorage.setItem(KEY, lang);
  } catch {}
  document.documentElement.lang = lang;
  for (const fn of listeners) fn(lang);
}
export const onLang = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
document.documentElement.lang = lang;

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
// key → [thai, english]
const S = {};
// A key is registered once (two tables giving the same one would show whichever loaded last).
export function addTexts(table) {
  for (const key of Object.keys(table)) if (key in S) throw new Error(`text ${key} registered twice`);
  Object.assign(S, table);
}
// Every text, for tests.
export const STRINGS = S;
export function t(key, vars) {
  const entry = S[key];
  if (!entry) return key;
  return fill(entry[lang === 'en' ? 1 : 0], vars);
}
// A pair given inline, for data objects that carry both languages.
export const tx = (pair) => (Array.isArray(pair) ? pair[lang === 'en' ? 1 : 0] : pair);
// The text in the chosen language, from its Thai and English versions.
export const L = (th, en) => (lang === 'en' ? en : th);

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Demo times are epoch ms, always shown as Bangkok wall-clock time to stay independent of the laptop's zone.
const pad = (n) => String(n).padStart(2, '0');
function parts(ms) {
  const d = new Date(ms + 7 * 3600e3);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}
export function fmtDate(ms) {
  const p = parts(ms);
  return lang === 'en' ? `${p.d} ${MONTHS_EN[p.m]} ${p.y}` : `${p.d} ${MONTHS_TH[p.m]} ${p.y + 543}`;
}
export const fmtTime = (ms, seconds = false) => {
  const p = parts(ms);
  return `${pad(p.h)}:${pad(p.min)}${seconds ? ':' + pad(p.s) : ''}`;
};
export const fmtDateTime = (ms) => `${fmtDate(ms)} ${fmtTime(ms)}`;
export const fmtShortDate = (ms) => {
  const p = parts(ms);
  return lang === 'en' ? `${p.d} ${MONTHS_EN[p.m]}` : `${p.d} ${MONTHS_TH[p.m]}`;
};
// Bangkok wall-clock to epoch ms.
export const bkk = (y, m, d, h = 0, min = 0, s = 0) => Date.UTC(y, m - 1, d, h - 7, min, s);
