// Regression guard on the committed snapshots: the parsed totals must equal the
// numbers ÖSYM publishes in the "Sayısal Bilgiler" PDF of the same round.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUNDS = join(dirname(dirname(fileURLToPath(import.meta.url))), 'data', 'rounds');
const EXPECTED = {
  '2026-1': { lisans: 555, onlisans: 410, ortaogretim: 141 },
  '2025-2': { lisans: 990, onlisans: 570, ortaogretim: 248 },
  '2025-1': { lisans: 798, onlisans: 418, ortaogretim: 175 },
};

for (const [key, levels] of Object.entries(EXPECTED)) {
  test(`${key}: parsed totals match the official summary`, (t) => {
    const summaryFile = join(ROUNDS, key, 'summary.json');
    if (!existsSync(summaryFile)) return t.skip('snapshot not present');
    const summary = JSON.parse(readFileSync(summaryFile, 'utf8')).levels;
    for (const [level, count] of Object.entries(levels)) {
      const { rows } = JSON.parse(readFileSync(join(ROUNDS, key, `${level}.json`), 'utf8'));
      assert.equal(rows.length, count, `${key}/${level} row count`);
      const sum = (field) => rows.reduce((acc, row) => acc + row[field], 0);
      assert.equal(sum('kontenjan'), summary[level].kontenjan, `${key}/${level} kontenjan`);
      assert.equal(sum('yerlesen'), summary[level].yerlesen, `${key}/${level} yerleşen`);
      assert.equal(sum('bosKalan'), summary[level].bos, `${key}/${level} boş kalan`);
    }
  });
}
