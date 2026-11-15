import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBytes } from './lib/http.mjs';
import { pdfToText, pdftotextVersion } from './lib/pdftotext.mjs';
import { discoverRounds, discoverDocuments, resolveGuideDocuments, roundKey, LEVELS } from './rounds.mjs';
import { parseResultsText } from './parse-results.mjs';
import { parseSummaryText } from './parse-summary.mjs';
import { parseProgrammeList, parseAlanList, parseNitelik, parseKadroTable, attachWrappedPrefixes } from './parse-guide.mjs';
import { buildEligibility } from './eligibility.mjs';
import { gateA, gateB, gateC, gateD, gateE, gateF } from './gates.mjs';
import { predictRows, band } from './predict.mjs';
import { backtest, summarize } from './backtest.mjs';
import { log, fail } from './lib/log.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW = join(ROOT, 'data', 'raw');
const ROUNDS = join(ROOT, 'data', 'rounds');
const CENTRAL_ONLY = !process.argv.includes('--all');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length).split(',').filter(Boolean);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// "KPSS-2025/5: Sağlık Bakanlığının Sözleşmeli Sağlık Personeli …" → "Sağlık Bakanlığı".
// Kurum adı sayfanın kanal başlığı olarak kullanılır; eşleşmezse tam başlık kalır.
const channelTitle = (title) => {
  const body = title.replace(/^KPSS-\d{4}\/\d+:\s*/, '').trim();
  const match = body.match(/^(.+?)(?:nın|nin|nun|nün)\s/);
  return match ? match[1] : body;
};

const loadGuideFallback = () => {
  const file = join(ROOT, 'data', 'reference', 'guide-docs.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};

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
    const manifest = {
      round: entry.round,
      landing: entry.url,
      title: entry.title,
      // Kanal: merkezî yerleştirme mi, yoksa tek kurumun sözleşmeli alımı mı?
      // Aynı ilan dönemi numarası iki ayrı kanalı gösterdiği için (2025/2 merkezî,
      // 2025/5 Sağlık Bakanlığı) dönem geçmişi kanal içinde tutulmalı.
      channel: entry.central ? 'merkezi' : 'kurum',
      channelTitle: entry.central ? 'Merkezî yerleştirme (ÖSYM)' : channelTitle(entry.title),
      docs: {},
      guide: {},
    };
    if (summary) manifest.summary = summary;
    const targets = [...Object.entries(levels), ...(summary ? [['summary', summary]] : [])];
    for (const [level, url] of targets) {
      const { bytes } = await fetchBytes(url);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail(`${key}/${level}: not a PDF (${bytes.length} B)`);
      writeFileSync(join(dir, `${level}.pdf`), bytes);
      manifest.docs[level] = { url, bytes: bytes.length, sha256: sha256(bytes) };
      log(`  ${key}/${level}: ${(bytes.length / 1024).toFixed(0)} KB`);
    }

    {
      const resolved = await resolveGuideDocuments(entry);
      let guideLanding = resolved.url;
      let guideDocs = resolved.docs;
      if (Object.keys(guideDocs).length < 3) {
        const fallback = loadGuideFallback()[entry.round];
        if (fallback) {
          guideLanding = `${fallback.base} (fallback map)`;
          guideDocs = Object.fromEntries(Object.entries(fallback.docs).map(([kind, file]) => [kind, fallback.base + file]));
          log(`  ${key}/guide: landing page unusable, using the fallback document map`);
        }
      }
      const kinds = Object.keys(guideDocs);
      if (kinds.length) {
        mkdirSync(join(dir, 'guide'), { recursive: true });
        manifest.guideLanding = guideLanding;
        for (const kind of kinds) {
          const { bytes } = await fetchBytes(guideDocs[kind]);
          if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail(`${key}/guide/${kind}: not a PDF`);
          writeFileSync(join(dir, 'guide', `${kind}.pdf`), bytes);
          manifest.guide[kind] = { url: guideDocs[kind], bytes: bytes.length, sha256: sha256(bytes) };
        }
        log(`  ${key}/guide: ${kinds.length} documents`);
      }
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
    const meta = {
      round: manifest.round,
      landing: manifest.landing,
      parser: 'parse-results@1',
      channel: manifest.channel ?? 'merkezi',
      channelTitle: manifest.channelTitle ?? 'Merkezî yerleştirme (ÖSYM)',
      levels: {},
    };
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

/** Geçmiş dönemlerin kurum/unvan sözlüğü: sarılmış hücreleri tamamlamak için. */
function buildVocabulary(level, currentKey) {
  const unvanVocab = new Set();
  const kurumVocabByIl = new Map();
  for (const other of readdirSync(ROUNDS)) {
    if (other === currentKey || !/^\d{4}-\d$/.test(other)) continue;
    const file = join(ROUNDS, other, `${level}.json`);
    if (!existsSync(file)) continue;
    for (const row of JSON.parse(readFileSync(file, 'utf8')).rows) {
      if (row.unvan) unvanVocab.add(row.unvan);
      if (row.kurum && row.il) {
        if (!kurumVocabByIl.has(row.il)) kurumVocabByIl.set(row.il, new Set());
        kurumVocabByIl.get(row.il).add(row.kurum);
      }
    }
  }
  return { unvanVocab, kurumVocabByIl };
}

const GUIDE_FILES = {
  lisans: { programmes: 'lisans-programlar', nitelik: 'lisans-nitelik', tablo: 'tablo3' },
  onlisans: { programmes: 'onlisans-programlar', nitelik: 'onlisans-nitelik', tablo: 'tablo2' },
  ortaogretim: { programmes: 'ortaogretim-alanlar', nitelik: 'ortaogretim-nitelik', tablo: 'tablo1' },
};

/** Guide package -> programme list, nitelik dictionary, cadre table, eligibility index. */
function cmdGuide() {
  const keys = readdirSync(RAW).filter((k) => existsSync(join(RAW, k, 'guide')));
  if (!keys.length) fail('no guide documents fetched yet — run `node pipeline/run.mjs fetch`');
  for (const key of keys) {
    const guideDir = join(RAW, key, 'guide');
    const out = { round: key.replace('-', '/'), levels: {}, stats: {} };
    const tabloRows = {};
    for (const level of LEVELS) {
      const spec = GUIDE_FILES[level];
      const path = (kind) => join(guideDir, `${kind}.pdf`);
      if (!existsSync(path(spec.programmes)) || !existsSync(path(spec.nitelik)) || !existsSync(path(spec.tablo))) {
        log(`  ${key}/${level}: guide documents incomplete, skipping`);
        continue;
      }
      const programmeText = pdfToText(readFileSync(path(spec.programmes)));
      // ortaöğretim lists alan/dal pairs, the other two list diploma programmes
      const programmes =
        level === 'ortaogretim' ? parseAlanList(programmeText).programmes : parseProgrammeList(programmeText).programmes;
      const nitelikler = parseNitelik(pdfToText(readFileSync(path(spec.nitelik)))).nitelikler;
      const parsedTable = parseKadroTable(pdfToText(readFileSync(path(spec.tablo))));
      // Sarılmış hücre önekleri, geçmiş dönemlerin kurum/unvan sözlüğüyle
      // eşleştirilerek yerine konur (bkz. attachWrappedPrefixes).
      const vocabulary = buildVocabulary(level, key);
      const attached = attachWrappedPrefixes(parsedTable.rows, vocabulary);
      const tablo = { rows: attached.rows, stats: parsedTable.stats };
      if (attached.attached) log(`  ${key}/${level}: ${attached.attached} sarılmış hücre öneki yerine kondu`);
      tabloRows[level] = tablo.rows;
      const index = buildEligibility({ programmes, nitelikler, kadroRows: tablo.rows });
      out.levels[level] = {
        programmes,
        nitelik: [...index.nitelikByCode.values()].map(({ kod, tanim, kind, programKodlari }) => ({ kod, tanim, kind, programKodlari })),
        kadro: Object.fromEntries(tablo.rows.map((row) => [row.kod, row.nitelikKodlari])),
        kadroDetay: Object.fromEntries(
          tablo.rows.map((row) => [
            row.kod,
            { kurum: row.kurum, unvan: row.unvan, il: row.il, teskilat: row.teskilat, kontenjan: row.adet, istihdam: row.istihdam },
          ]),
        ),
      };
      out.stats[level] = { ...index.stats, tablo: tablo.stats };
      log(
        `  ${key}/${level}: ${programmes.length} programmes, ${index.stats.nitelikler} nitelik, ${tablo.rows.length} kadro, ` +
          `${index.stats.programmesWithoutNitelik} programmes without nitelik, ${index.stats.nitelikWithoutProgramme} nitelik without programme`,
      );
    }
    writeFileSync(join(ROUNDS, key, 'guide.json'), JSON.stringify(out, null, 1));
    writeFileSync(join(ROUNDS, key, 'guide-meta.json'), JSON.stringify({ round: out.round, stats: out.stats }, null, 2));
  }
}

async function cmdGate() {
  const keys = readdirSync(ROUNDS).sort();
  const reports = [];
  for (const key of keys) {
    const dir = join(ROUNDS, key);
    const summaryFile = join(dir, 'summary.json');
    const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')).levels : {};
    const guideFile = join(dir, 'guide.json');
    const guide = existsSync(guideFile) ? JSON.parse(readFileSync(guideFile, 'utf8')) : null;
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
      if (guide?.levels[level]) {
        const tabloRows = Object.entries(guide.levels[level].kadro).map(([kod, nitelikKodlari]) => ({ kod, nitelikKodlari }));
        const detail = guide.levels[level].kadroDetay ?? {};
        const enriched = tabloRows.map((row) => ({ ...row, ...(detail[row.kod] ?? {}) }));
        if (Object.keys(detail).length) reports.push(gateF(round, level, enriched, rows));
        const adetTotal = guide.stats[level]?.tablo?.adetTotal ?? null;
        reports.push(gateE(round, level, tabloRows, rows, summary[level], adetTotal));
      }
    }
  }
  writeFileSync(join(ROUNDS, 'gate-report.json'), JSON.stringify(reports, null, 2));
  for (const r of reports.filter((x) => ['A', 'D', 'E', 'F'].includes(x.name))) {
    const detail = r.totals
      ? `kadro=${r.totals.rows} kontenjan=${r.totals.kontenjan} yerleşen=${r.totals.yerlesen} boş=${r.totals.bos}`
      : r.detail ?? '';
    const state = r.ok ? '✓' : '✗';
    const extra = r.skipped ? ` (${r.skipped})` : '';
    const problems = r.problemCount ? ` problems=${r.problemCount}` : '';
    log(`${state} ${r.name} ${r.round} ${r.level} ${detail}${extra}${problems}`);
  }
  const failed = reports.filter((r) => !r.ok);
  if (failed.length) fail(`${failed.length} gate(s) failed — see data/rounds/gate-report.json`);
  log('all gates passed');
}

// Yalnız merkezî yerleştirme dönemleri: kurum alımları (Sağlık Bakanlığı, MEB …) ayrı kanaldır,
// tahmin/geri test modeline karışırsa "geçen dönem aynı kadro" eşleşmesi yanlış puan üretir.
function loadRounds({ channel = 'merkezi' } = {}) {
  const keys = readdirSync(ROUNDS)
    .filter((k) => /^\d{4}-\d+$/.test(k))
    .sort();
  return keys
    .map((key) => {
      const metaFile = join(ROUNDS, key, 'meta.json');
      const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
      return {
        key,
        round: meta.round ?? key.replace('-', '/'),
        channel: meta.channel ?? 'merkezi',
        levels: Object.fromEntries(
          LEVELS.map((level) => {
            const file = join(ROUNDS, key, `${level}.json`);
            return [level, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).rows : null];
          }).filter(([, rows]) => rows),
        ),
      };
    })
    .filter((entry) => channel === 'all' || entry.channel === channel)
    .filter((entry) => Object.keys(entry.levels).length > 0);
}

/** Rolling-origin backtest -> data/rounds/backtest.json (published on /metodoloji). */
function cmdBacktest() {
  const rounds = loadRounds();
  if (rounds.length < 2) fail('need at least two rounds for a backtest');
  const report = backtest(rounds, 2.5);
  const summary = summarize(report);
  // interval sized from the realised residuals: the 80th percentile of |error|
  const sigmaByLevel = {};
  for (const level of LEVELS) {
    const errors = [];
    for (const entry of report.filter((r) => r.level === level)) {
      if (!entry.mae) continue;
      errors.push(entry.mae);
    }
    sigmaByLevel[level] = errors.length ? Number((Math.max(...errors) * 1.6).toFixed(2)) : 6;
  }
  writeFileSync(
    join(ROUNDS, 'backtest.json'),
    JSON.stringify({ generatedFor: rounds.at(-1).round, sigma: sigmaByLevel, summary, report }, null, 2),
  );
  for (const row of summary) log(`  backtest ${row.level}: n=${row.compared} MAE=${row.mae?.toFixed(2)} sigma=±${sigmaByLevel[row.level]}`);
  log(`backtest written for ${rounds.map((r) => r.round).join(' → ')}`);
}

/** Predict the newest round from the older ones (as-if mode) and store it. */
function cmdPredict() {
  const rounds = loadRounds();
  if (rounds.length < 2) fail('need at least two rounds to predict');
  const backtestFile = join(ROUNDS, 'backtest.json');
  const sigma = existsSync(backtestFile) ? JSON.parse(readFileSync(backtestFile, 'utf8')).sigma : {};
  const target = rounds.at(-1);
  const history = rounds.slice(0, -1).reverse();
  const out = { round: target.round, sigma, levels: {} };
  for (const level of LEVELS) {
    const rows = target.levels[level];
    if (!rows) continue;
    const historyRows = history.map((r) => r.levels[level]).filter(Boolean);
    const predictions = predictRows(rows, historyRows, sigma[level] ?? 6);
    out.levels[level] = Object.fromEntries([...predictions]);
    const withEstimate = [...predictions.values()].filter((p) => p.puan !== null).length;
    log(`  predict ${target.round}/${level}: ${withEstimate}/${rows.length} rows with an estimate`);
  }
  writeFileSync(join(ROUNDS, target.key, 'predictions.json'), JSON.stringify(out, null, 2));
}

const command = process.argv[2];
if (command === 'fetch') await cmdFetch();
else if (command === 'parse') cmdParse();
else if (command === 'guide') cmdGuide();
else if (command === 'gate') await cmdGate();
else if (command === 'backtest') cmdBacktest();
else if (command === 'predict') cmdPredict();
else if (command === 'all') {
  await cmdFetch();
  cmdParse();
  cmdGuide();
  await cmdGate();
  cmdBacktest();
  cmdPredict();
} else {
  log('usage: node pipeline/run.mjs <fetch|parse|guide|gate|all> [--all] [--only=2026/1]');
  process.exitCode = 2;
}
