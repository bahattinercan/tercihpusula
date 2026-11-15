// Kurum alımları özeti: committed Sağlık Bakanlığı dönemlerinden üretilen sayılar,
// resmî "Sayısal Bilgiler" toplamlarıyla birebir eşleşmeli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeChannels } from '../pipeline/lib/kurum-summary.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROUNDS = join(ROOT, 'data', 'rounds');
const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const institutional = ['2025-5', '2025-4'].map((key) => {
  const meta = readJson(join(ROUNDS, key, 'meta.json'));
  const levels = {};
  for (const level of LEVELS) {
    const file = join(ROUNDS, key, `${level}.json`);
    if (existsSync(file)) levels[level] = readJson(file).rows;
  }
  return { key, round: meta.round, channelTitle: meta.channelTitle, levels };
});

const summary = summarizeChannels(institutional);
const channel = summary.channels.find((entry) => entry.title === 'Sağlık Bakanlığı');

test('institutional rounds are grouped under their channel', () => {
  assert.ok(channel, 'Sağlık Bakanlığı channel must exist');
  const rounds = [...new Set(channel.rounds.map((entry) => entry.round))];
  assert.deepEqual(rounds.sort(), ['2025/4', '2025/5']);
  assert.ok(channel.groups.length > 50, `${channel.groups.length} unvan-düzey grubu`);
});

test('HEMŞİRE lisans: kontenjan and closing-score range match the two rounds', () => {
  const hem = channel.groups.find((group) => group.unvan === 'HEMŞİRE' && group.level === 'lisans');
  assert.ok(hem, 'HEMŞİRE lisans group must exist');
  assert.equal(hem.kontenjan, 12226);
  assert.equal(hem.yerlesen, 12226);
  assert.equal(hem.iller, 81);
  assert.equal(hem.taban, 73.87994);
  assert.equal(hem.tavan, 95.25329);
  assert.equal(hem.rounds['2025/5'].knt, 5598);
  assert.equal(hem.rounds['2025/4'].knt, 6628);
});

test('EBE is present (the exact gap that started this work)', () => {
  const ebe = channel.groups.find((group) => group.unvan === 'EBE' && group.level === 'lisans');
  assert.ok(ebe, 'EBE group must exist for Sağlık Bakanlığı');
  assert.equal(ebe.kontenjan, 2085);
  assert.ok(ebe.taban > 60 && ebe.tavan <= 100);
});

test('per-round group sums equal the official summary totals', () => {
  for (const entry of institutional) {
    const totals = readJson(join(ROUNDS, entry.key, 'summary.json')).levels;
    for (const level of LEVELS) {
      const groups = channel.groups.filter((group) => group.level === level);
      const sum = groups.reduce((acc, group) => acc + (group.rounds[entry.round]?.knt ?? 0), 0);
      assert.equal(sum, totals[level].kontenjan, `${entry.round} ${level}: ${sum} ≠ ${totals[level].kontenjan}`);
    }
  }
});

test('no group claims a score for a cadre that closed empty', () => {
  for (const group of channel.groups) {
    if (group.yerlesen === 0) {
      assert.equal(group.taban, null, `${group.unvan}/${group.level}: boş kadroya taban yazılmış`);
      continue;
    }
    assert.ok(group.taban === null || group.tavan >= group.taban, `${group.unvan}: tavan < taban`);
  }
});
