// The empty-state index must reproduce the numbers we verified by hand against the
// raw ÖSYM PDFs: 2026/1 has a single HEMŞİRE row (lisans) and no EBE row at all,
// while 2025/2 had 8 lisans + 2 lise hemşire and 1 EBE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSearchHints } from '../pipeline/lib/search-hints.mjs';
import { foldTr } from '../web/assets/fold.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
const rowsOf = (period, level) =>
  JSON.parse(readFileSync(join(ROOT, 'data', 'rounds', period, `${level}.json`), 'utf8')).rows;

const hints = buildSearchHints({
  current: LEVELS.map((level) => ({ level, round: '2026/1', rows: rowsOf('2026-1', level) })),
  history: ['2025-1', '2025-2'].flatMap((period) => LEVELS.map((level) => ({ period, level, rows: rowsOf(period, level) }))),
});

test('keys are folded, labels keep the official spelling', () => {
  assert.ok(!Object.keys(hints.unvan).some((key) => /[ŞĞÜÖÇİIı]/.test(key)), 'unvan keys must be ASCII-folded');
  assert.equal(hints.unvan.hemsire.label, 'HEMŞİRE');
});

test('HEMŞİRE: this term is a single lisans row, earlier terms had more', () => {
  const hem = hints.unvan[foldTr('hemşire')];
  assert.deepEqual(hem.counts.buDonem, { lisans: 1 });
  assert.equal(hem.counts['2025-2'].lisans, 8);
  assert.equal(hem.counts['2025-2'].ortaogretim, 2);
  assert.equal(hem.counts['2025-1'].lisans, 7);
  assert.equal(hem.counts['2025-1'].ortaogretim, 2);
  assert.equal(hem.counts['2025-1'].onlisans, undefined);
});

test('EBE: absent this term, present once in 2025/2', () => {
  const ebe = hints.unvan[foldTr('ebe')];
  assert.equal(ebe.counts.buDonem, undefined);
  assert.equal(ebe.counts['2025-2'].lisans, 1);
});

test('province keys are folded too, so Iğdır is found as igdir', () => {
  assert.ok(hints.il.igdir, 'igdir must be a key');
  assert.equal(hints.il.igdir.label, 'IĞDIR');
  assert.ok(hints.il.igdir.counts.buDonem);
});
