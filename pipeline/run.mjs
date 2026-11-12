import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBytes } from './lib/http.mjs';
import { pdfToText, pdftotextVersion } from './lib/pdftotext.mjs';
import { discoverRounds, discoverDocuments, roundKey, LEVELS } from './rounds.mjs';
import { parseResultsText } from './parse-results.mjs';
import { parseSummaryText } from './parse-summary.mjs';
import { gateA, gateB, gateC, gateD } from './gates.mjs';
import { log, fail } from './lib/log.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW = join(ROOT, 'data', 'raw');
const ROUNDS = join(ROOT, 'data', 'rounds');
const CENTRAL_ONLY = !process.argv.includes('--all');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length).split(',').filter(Boolean);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function selectRounds() {
  const all = await discoverRounds();
  const scoped = ONLY.length ? all.filter((r) => ONLY.includes(r.round)) : all;
  const chosen = CENTRAL_ONLY ? scoped.filter((r) => r.central) : scoped;
  log(`discovered ${all.length} rounds, using ${chosen.length} (${CENTRAL_ONLY ? 'central only' : 'all'})`);
  return chosen;
}

async function cmdFetch() {
  const rounds = await selectRounds();
  for (const entry of rounds) {
    const key = roundKey(entry.round);
    const dir = join(RAW, key);
    mkdirSync(dir, { recursive: true });
    const { summary, levels } = await discoverDocuments(entry.url);
    if (!Object.keys(levels).length) {
      log(`  ${key}: no level documents found, skipping`);
      continue;
    }
    const manifest = { round: entry.round, landing: entry.url, title: entry.title, docs: {} };
    if (summary) manifest.summary = summary;
    const targets = [...Object.entries(levels), ...(summary ? [['summary', summary]] : [])];
    for (const [level, url] of targets) {
      const { bytes } = await fetchBytes(url);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        fail(`${key}/${level}: not a PDF (${bytes.length} B)`);
      }
      writeFileSync(join(dir, `${level}.pdf`), bytes);
      manifest.docs[level] = { url, bytes: bytes.length, sha256: sha256(bytes) };
      log(`  ${key}/${level}: ${(bytes.length / 1024).toFixed(0)} KB`);
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
}

function cmdParse() {
  if (!pdftotextVersion()) fail('pdftotext missing');
  const keys = readdirSync(RAW).filter((k) => existsSync(join(RAW, k, 'manifest.json')));
  for (const key of keys) {
    const manifest = JSON.parse(readFileSync(join(RAW, key, 'manifest.json'), 'utf8'));
    const outDir = join(ROUNDS, key);
    mkdirSync(outDir, { recursive: true });
    const meta = { round: manifest.round, landing: manifest.landing, parser: 'parse-results@1', levels: {} };
    for (const level of LEVELS) {
      const pdfPath = join(RAW, key, `${level}.pdf`);
      if (!existsSync(pdfPath)) continue;
      const { rows, stats } = parseResultsText(pdfToText(readFileSync(pdfPath)));
      writeFileSync(join(outDir, `${level}.json`), JSON.stringify({ round: manifest.round, level, rows }, null, 2));
      meta.levels[level] = {
        ...stats,
        rows: rows.length,
        kontenjan: rows.reduce((sum, row) => sum + row.kontenjan, 0),
        yerlesen: rows.reduce((sum, row) => sum + row.yerlesen, 0),
        bosKalan: rows.reduce((sum, row) => sum + row.bosKalan, 0),
      };
      log(`  ${key}/${level}: ${rows.length} rows, ${stats.uniqueCodes} codes, ${stats.rejectedLines} rejected lines`);
    }
    const summaryPath = join(RAW, key, 'summary.pdf');
    if (existsSync(summaryPath)) {
      const { levels } = parseSummaryText(pdfToText(readFileSync(summaryPath)));
      writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ round: manifest.round, levels }, null, 2));
      log(`  ${key}/summary: ${Object.keys(levels).join(', ')}`);
    }
    writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
  }
}

async function cmdGate() {
  const keys = readdirSync(ROUNDS).sort();
  const reports = [];
  for (const key of keys) {
    const dir = join(ROUNDS, key);
    const summaryFile = join(dir, 'summary.json');
    const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')).levels : {};
    for (const level of LEVELS) {
      const file = join(dir, `${level}.json`);
      if (!existsSync(file)) continue;
      const { round, rows } = JSON.parse(readFileSync(file, 'utf8'));
      const previousKey = keys[keys.indexOf(key) - 1];
      let previous = null;
      if (previousKey) {
        const prevFile = join(ROUNDS, previousKey, `${level}.json`);
        if (existsSync(prevFile)) previous = JSON.parse(readFileSync(prevFile, 'utf8')).rows;
      }
      reports.push(gateA(round, level, rows, summary[level]));
      reports.push(gateB(round, level, rows));
      reports.push(gateC(round, level, rows, previous));
      reports.push(await gateD(round, level, rows));
    }
  }
  writeFileSync(join(ROUNDS, 'gate-report.json'), JSON.stringify(reports, null, 2));
  for (const r of reports.filter((x) => x.name === 'A' || x.name === 'D')) {
    const detail = r.totals
      ? `kadro=${r.totals.rows} kontenjan=${r.totals.kontenjan} yerleşen=${r.totals.yerlesen} boş=${r.totals.bos}`
      : '';
    const state = r.ok ? '✓' : '✗';
    const extra = r.skipped ? ` (${r.skipped})` : '';
    const problems = r.problemCount ? ` problems=${r.problemCount}` : '';
    log(`${state} ${r.name} ${r.round} ${r.level} ${detail}${extra}${problems}`);
  }
  const failed = reports.filter((r) => !r.ok);
  if (failed.length) fail(`${failed.length} gate(s) failed — see data/rounds/gate-report.json`);
  log('all gates passed');
}

const command = process.argv[2];
if (command === 'fetch') await cmdFetch();
else if (command === 'parse') cmdParse();
else if (command === 'gate') await cmdGate();
else if (command === 'all') {
  await cmdFetch();
  cmdParse();
  await cmdGate();
} else {
  log('usage: node pipeline/run.mjs <fetch|parse|gate|all> [--all]');
  process.exitCode = 2;
}
