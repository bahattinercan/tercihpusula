// Rolling-origin backtest for the T0 predictor.
//
// For every consecutive pair of rounds we predict the later one from the earlier
// ones and compare with what actually happened. Two numbers matter and both are
// published on /metodoloji:
//   MAE          — mean absolute error of the predicted closing score
//   band hit rate — how often the realised score fell inside the ±sigma interval
import { predictRows, band } from './predict.mjs';

const mae = (pairs) => (pairs.length ? pairs.reduce((sum, p) => sum + Math.abs(p.predicted - p.actual), 0) / pairs.length : null);

/**
 * @param {Array<{round: string, levels: Record<string, Array<object>>}>} rounds oldest first
 * @param {number} sigma
 */
export function backtest(rounds, sigma = 2.5) {
  const results = [];
  for (let i = 1; i < rounds.length; i += 1) {
    const target = rounds[i];
    const history = rounds.slice(0, i).reverse();
    for (const level of Object.keys(target.levels)) {
      const historyRows = history.map((r) => r.levels[level]).filter(Boolean);
      if (!historyRows.length) continue;
      const predictions = predictRows(target.levels[level], historyRows, sigma);
      const pairs = [];
      const bySource = new Map();
      for (const row of target.levels[level]) {
        const prediction = predictions.get(row.kod);
        if (!prediction || prediction.puan === null || row.minPuan === null) continue;
        const pair = { kod: row.kod, predicted: prediction.puan, actual: row.minPuan, source: prediction.source };
        pairs.push(pair);
        const bucket = bySource.get(prediction.source) ?? [];
        bucket.push(pair);
        bySource.set(prediction.source, bucket);
      }
      const covered = pairs.filter((p) => Math.abs(p.actual - p.predicted) <= sigma).length;
      const bandHits = pairs.map((p) => band(p.actual, { puan: p.predicted, alt: p.predicted - sigma, ust: p.predicted + sigma }));
      results.push({
        from: history[0].round,
        to: target.round,
        level,
        compared: pairs.length,
        mae: mae(pairs),
        coverage: pairs.length ? covered / pairs.length : null,
        bySource: [...bySource].map(([source, list]) => ({ source, compared: list.length, mae: mae(list) })),
        bandDistribution: bandHits.reduce((acc, b) => ({ ...acc, [b]: (acc[b] ?? 0) + 1 }), {}),
      });
    }
  }
  return results;
}

/** Aggregate MAE and coverage per level, used to size the published interval. */
export function summarize(report) {
  const byLevel = new Map();
  for (const entry of report) {
    const bucket = byLevel.get(entry.level) ?? { level: entry.level, compared: 0, absError: 0, covered: 0, rounds: 0 };
    bucket.compared += entry.compared;
    bucket.absError += (entry.mae ?? 0) * entry.compared;
    bucket.covered += (entry.coverage ?? 0) * entry.compared;
    bucket.rounds += 1;
    byLevel.set(entry.level, bucket);
  }
  return [...byLevel.values()].map((bucket) => ({
    level: bucket.level,
    rounds: bucket.rounds,
    compared: bucket.compared,
    mae: bucket.compared ? bucket.absError / bucket.compared : null,
    coverage: bucket.compared ? bucket.covered / bucket.compared : null,
  }));
}
