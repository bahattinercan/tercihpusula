// T0 predictor: a transparent historical anchor.
//
// For a cadre row in round N the best available signal is the same cadre code in
// round N-1 (many rows survive between rounds), then the same job title in the
// same province, then the same job title nationally. The estimate is nudged by
// the quota change: a bigger quota pulls the closing score down.
//
// No machine learning here on purpose. The value of the product is a calibrated
// number with a published error, not an unexplainable one.

export const MIN_PUAN = 40;
export const MAX_PUAN = 100;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** Index one round's rows by code, and build the two fallback medians. */
export function indexRound(rows) {
  const byKod = new Map();
  const byUnvanIl = new Map();
  const byUnvan = new Map();
  for (const row of rows) {
    if (row.minPuan === null) continue;
    byKod.set(row.kod, row);
    const keyIl = `${row.unvan}|${row.il}`;
    if (!byUnvanIl.has(keyIl)) byUnvanIl.set(keyIl, []);
    byUnvanIl.get(keyIl).push(row.minPuan);
    if (!byUnvan.has(row.unvan)) byUnvan.set(row.unvan, []);
    byUnvan.get(row.unvan).push(row.minPuan);
  }
  const medians = (map) => new Map([...map].map(([key, values]) => [key, median(values)]));
  return { byKod, unvanIl: medians(byUnvanIl), unvan: medians(byUnvan) };
}

/**
 * @param {Array<object>} targetRows cadre rows of the round being predicted
 * @param {Array<Array<object>>} historyRows previous rounds, newest first
 * @param {number} sigma half-width of the published interval
 */
export function predictRows(targetRows, historyRows, sigma = 2.5) {
  const indexes = historyRows.map(indexRound);
  const predictions = new Map();

  for (const row of targetRows) {
    let estimate = null;
    let source = 'none';
    let previous = null;

    // Order validated by backtest: the same title in the same province beats the
    // same cadre code from last round (a re-announced cadre often changes its
    // nitelik codes and therefore its candidate pool).
    for (const index of indexes) {
      const hit = index.unvanIl.get(`${row.unvan}|${row.il}`);
      if (hit !== undefined) {
        estimate = hit;
        source = 'unvan_il';
        break;
      }
    }
    for (const index of indexes) {
      const hit = index.byKod.get(row.kod);
      if (hit) {
        if (estimate === null) {
          estimate = hit.minPuan;
          source = 'same_kod';
        }
        previous = hit;
        break;
      }
    }
    if (estimate === null) {
      for (const index of indexes) {
        const hit = index.unvan.get(row.unvan);
        if (hit !== undefined) {
          estimate = hit;
          source = 'unvan';
          break;
        }
      }
    }

    let adjustment = 0;
    if (estimate !== null && previous && previous.kontenjan > 0 && row.kontenjan > 0) {
      const ratio = row.kontenjan / previous.kontenjan;
      if (ratio !== 1) adjustment = clamp(-1.5, 1.5, -3 * Math.log2(ratio));
    }
    const puan = estimate === null ? null : clamp(MIN_PUAN, MAX_PUAN, estimate + adjustment);

    predictions.set(row.kod, {
      puan: puan === null ? null : Number(puan.toFixed(5)),
      alt: puan === null ? null : Number(clamp(MIN_PUAN, MAX_PUAN, puan - sigma).toFixed(5)),
      ust: puan === null ? null : Number(clamp(MIN_PUAN, MAX_PUAN, puan + sigma).toFixed(5)),
      source,
      adjustment: Number(adjustment.toFixed(3)),
    });
  }
  return predictions;
}

/** Band of a candidate score against one prediction. */
export function band(score, prediction) {
  if (!prediction || prediction.puan === null) return 'bilinmiyor';
  if (score >= prediction.ust) return 'garanti';
  if (score >= prediction.puan) return 'hedef';
  if (score >= prediction.alt) return 'riskli';
  return 'uzak';
}
