import test from 'node:test';
import assert from 'node:assert/strict';
import { gateA, gateB, gateC } from '../pipeline/gates.mjs';

const row = (over) => ({
  kod: '301014021',
  kurum: 'AFET VE ACİL DURUM YÖNETİMİ BAŞKANLIĞI',
  il: 'AKSARAY',
  teskilat: 'TAŞRA',
  unvan: 'ENFORMASYON MEMURU',
  kontenjan: 1,
  yerlesen: 1,
  bosKalan: 0,
  minPuan: 81.6,
  maxPuan: 87.4,
  ...over,
});

test('gate A reconciles totals against the official summary', () => {
  const rows = [row(), row({ kod: '301014022' })];
  const official = { tercihYapan: 100, kontenjan: 2, yerlesen: 2, bos: 0 };
  assert.equal(gateA('2026/1', 'lisans', rows, official).ok, true);
});

test('gate A fails when the official totals disagree', () => {
  const rows = [row()];
  const official = { tercihYapan: 100, kontenjan: 2, yerlesen: 2, bos: 0 };
  const report = gateA('2026/1', 'lisans', rows, official);
  assert.equal(report.ok, false);
  assert.match(report.problems.join(' '), /official kontenjan 2 != parsed 1/);
});

test('gate A accepts a partially filled cadre but rejects a placed cadre without a score', () => {
  const partial = row({ kontenjan: 2, yerlesen: 1, bosKalan: 1, minPuan: 61.4, maxPuan: 61.4 });
  assert.equal(gateA('2025/2', 'lisans', [partial], null).ok, true);
  const broken = row({ minPuan: null, maxPuan: null });
  assert.equal(gateA('2025/2', 'lisans', [broken], null).ok, false);
});

test('gate B rejects duplicate codes and empty institutions', () => {
  assert.equal(gateB('2026/1', 'lisans', [row(), row()]).ok, false);
  assert.equal(gateB('2026/1', 'lisans', [row({ kurum: null })]).ok, false);
  assert.equal(gateB('2026/1', 'lisans', [row()]).ok, true);
});

test('gate C flags a quota surge for the same job title', () => {
  const before = Array.from({ length: 5 }, (_, i) => row({ kod: `30101402${i}`, unvan: 'MEMUR' }));
  const after = [row({ unvan: 'MEMUR', kontenjan: 20, yerlesen: 20, bosKalan: 0 })];
  const report = gateC('2026/1', 'lisans', after, before);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 1);
});
