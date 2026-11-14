// Past-term history builder: the numbers here were counted by hand from
// data/rounds on 2026-11-14 and are pinned so a silent regression cannot pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPastTerms, filledInPast, MAX_TERMS } from '../pipeline/lib/past-terms.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rowsOf = (period, level) =>
  JSON.parse(readFileSync(join(ROOT, 'data', 'rounds', period, `${level}.json`), 'utf8')).rows;

const previous = [
  { period: '2025-2', rows: rowsOf('2025-2', 'lisans') },
  { period: '2025-1', rows: rowsOf('2025-1', 'lisans') },
];
const current = rowsOf('2026-1', 'lisans');
const history = buildPastTerms({ current, previous });

test('every entry is well formed and terms are newest first', () => {
  assert.ok(history.size > 0);
  for (const [kod, entries] of history) {
    assert.ok(kod, 'entry must belong to a cadre code');
    assert.ok(entries.length >= 1 && entries.length <= MAX_TERMS, `${kod}: ${entries.length} terms`);
    for (const entry of entries) {
      assert.match(entry.d, /^\d{4}\/\d$/, `term label ${entry.d}`);
      assert.ok(entry.es === 'kod' || entry.es === 'grup');
      assert.equal(typeof entry.yer, 'number');
      if (entry.taban !== null) assert.ok(entry.tavan >= entry.taban, `${kod} ${entry.d}: tavan < taban`);
      if (entry.yer === 0) assert.equal(entry.taban, null, 'an unfilled term must not carry a score');
    }
    const terms = entries.map((entry) => entry.d);
    assert.deepEqual(terms, [...terms].sort().reverse(), `${kod}: ${terms.join(',')} not newest-first`);
  }
});

test('code matches are preferred over group matches', () => {
  // 2026/1 and 2025/1 share the same code family, so the 2025/1 hit must be `kod`.
  const codeMatched = [...history.values()].filter((entries) => entries.some((entry) => entry.d === '2025/1' && entry.es === 'kod'));
  assert.equal(codeMatched.length, 321, 'lisans rows matched by code against 2025/1');
  // 2025/2 uses a different code family: only the kurum|il|unvan group survives.
  const groupMatched = [...history.values()].filter((entries) => entries.some((entry) => entry.d === '2025/2' && entry.es === 'grup'));
  assert.equal(groupMatched.length, 200, 'lisans rows matched by group against 2025/2');
});

test('filledInPast agrees with the published yerlesen counts', () => {
  const filled = [...history.values()].filter((entries) => filledInPast(entries));
  assert.equal(filled.length, 459, 'lisans rows with at least one filled past term');
  assert.equal(filledInPast([]), false);
  assert.equal(filledInPast([{ yer: 0, taban: null }]), false);
  assert.equal(filledInPast([{ yer: 3, taban: 70 }]), true);
});

test('scores are rounded to the three decimals the UI prints', () => {
  for (const entries of history.values()) {
    for (const entry of entries) {
      if (entry.taban === null) continue;
      assert.equal(Number(entry.taban.toFixed(3)), entry.taban, `${entry.d} taban precision`);
      assert.equal(Number(entry.tavan.toFixed(3)), entry.tavan, `${entry.d} tavan precision`);
    }
  }
});
