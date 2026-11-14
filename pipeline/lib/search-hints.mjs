// Boş sonuç teşhisi indeksi: arama hiçbir satır bulamadığında tarayıcı "bu unvan/il bu dönemde
// kaç kadroydu, hangi düzeyde, geçmiş dönemlerde ne durumdaydı" sorusunu buradan yanıtlar.
// Anahtarlar foldTr ile katlanır (HEMŞİRE → hemsire), etiket orijinal yazım kalır.
// foldTr'ın tek hali web/assets/fold.js'te durur: tarayıcı onu yükler, Node da buradan alır.
import { foldTr } from '../../web/assets/fold.js';

const CURRENT = 'buDonem';

/**
 * @param {{ current: Array<{ level: string, round: string, rows: object[] }>,
 *           history: Array<{ period: string, level: string, rows: object[] }> }} input
 * @returns {{ round: string|null, unvan: object, il: object }}
 */
export function buildSearchHints({ current, history }) {
  const hints = { round: null, unvan: {}, il: {} };

  const add = (period, level, rows) => {
    for (const row of rows) {
      for (const field of ['unvan', 'il']) {
        const value = row[field];
        if (!value) continue;
        const key = foldTr(value);
        const bucket = hints[field][key] ?? (hints[field][key] = { label: value, counts: {} });
        const byLevel = bucket.counts[period] ?? (bucket.counts[period] = {});
        byLevel[level] = (byLevel[level] ?? 0) + 1;
      }
    }
  };

  for (const { level, round, rows } of current) {
    hints.round = round;
    add(CURRENT, level, rows);
  }
  for (const { period, level, rows } of history) add(period, level, rows);
  return hints;
}

export { CURRENT as HINT_CURRENT_PERIOD };
