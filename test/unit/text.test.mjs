// The parking demo's text: every string in both languages, every key the code asks for there, no stray tags.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {STRINGS} from 'osd/parking/i18n.js';

const src = new URL('../../src/parking/', import.meta.url);
const code = readdirSync(src).filter(f => f.endsWith('.js')).map(f => readFileSync(new URL(f, src), 'utf8')).join('\n');

test('every string has Thai and English', () => {
  const missing = Object.entries(STRINGS).filter(([, v]) => !Array.isArray(v) || v.length !== 2 || !v[0] || !v[1]).map(([k]) => k);
  assert.deepEqual(missing, []);
});

test("every key the code asks for exists (t('…'))", () => {
  const used = new Set([...code.matchAll(/\bt\('([a-z][\w.]*)'/g)].map(m => m[1]));
  const missing = [...used].filter(k => !(k in STRINGS));
  assert.deepEqual(missing, []);
});

test('no "simulated" tags on items: the page says so once, in the header and the footer', () => {
  const tagged = Object.entries(STRINGS).filter(([k, [th, en]]) => k !== 'sim.data' && (/\((จำลอง|ตัวอย่าง)\)|· จำลอง/.test(th) || /\((simulated|sample)\)|· simulated/i.test(en))).map(([k]) => k);
  assert.deepEqual(tagged, []);
});
