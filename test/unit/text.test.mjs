// The parking demo's text: every string in both languages, every key the code asks for there, no stray tags.
import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {STRINGS} from 'osd/parking/texts.js';
import 'osd/viewer/texts.js';

const read = (dir, ext) => {
  const at = new URL(`../../src/${dir}/`, import.meta.url);
  return readdirSync(at)
    .filter((f) => f.endsWith(ext))
    .map((f) => readFileSync(new URL(f, at), 'utf8'))
    .join('\n');
};
const code = ['core', 'parking', 'viewer'].map((dir) => read(dir, '.js')).join('\n');

test('every string has Thai and English', () => {
  const missing = Object.entries(STRINGS)
    .filter(([, v]) => !Array.isArray(v) || v.length !== 2 || !v[0] || !v[1])
    .map(([k]) => k);
  assert.deepEqual(missing, []);
});

test("every key the code asks for exists (t('…'))", () => {
  const used = new Set([...code.matchAll(/\b(?:p?t)\('([a-z][\w.]*)'/g)].map((m) => m[1]));
  const missing = [...used].filter((k) => !(k in STRINGS));
  assert.deepEqual(missing, []);
});

test('every key the markup asks for exists (data-i18n…)', () => {
  const used = [...read('pages', '.html').matchAll(/data-i18n(?:-\w+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 50);
  assert.deepEqual(
    used.filter((k) => !(k in STRINGS)),
    [],
  );
});

// (But for the header's own label, and the timeline, named after its clock.)
// (But for the header's own label, and the timeline, named after its clock.)
test('no "simulated" tags on items: the page says so once, in the header and the footer', () => {
  const tagged = Object.entries(STRINGS)
    .filter(
      ([k, [th, en]]) =>
        !['demo', 'timeline'].includes(k) &&
        (/\((จำลอง|ตัวอย่าง)\)|· จำลอง/.test(th) || /\((simulated|sample)\)|· simulated/i.test(en)),
    )
    .map(([k]) => k);
  assert.deepEqual(tagged, []);
});
