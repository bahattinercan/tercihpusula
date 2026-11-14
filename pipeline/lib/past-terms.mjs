// Geçmiş dönem dökümü: bir kadronun önceki dönemlerde kaçla kapandığı.
// Kadro kodları dönem kapsamlıdır (2025/1 → 301…, 2025/2 → 302…), bu yüzden kod eşleşmesi
// yalnız aynı sıra numaralı dönemler arasında tutar. Kod tutmadığında aynı kurum+il+unvan
// grubuna düşülür ve bu, satırda `es: 'grup'` olarak işaretlenir — arayüz ikisini karıştırmaz.
export const MAX_TERMS = 3;

const groupKey = (row) => `${row.kurum ?? ''}|${row.il ?? ''}|${row.unvan ?? ''}`;
const termLabel = (period) => period.replace('-', '/');
// Arayüz üç ondalık basıyor; veri de aynı çözünürlükte tutulur (payload'ı şişirmemek için).
const round3 = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null);

const indexPeriod = (period, rows) => {
  const byKod = new Map();
  const byGroup = new Map();
  for (const row of rows) {
    byKod.set(row.kod, row);
    const key = groupKey(row);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }
  return { period, byKod, byGroup };
};

/**
 * @param {{ current: object[], previous: Array<{ period: string, rows: object[] }> }} input
 *        `previous` newest round first; the current round must not be included.
 * @returns {Map<string, object[]>} cadre code → past-term entries, newest term first
 */
export function buildPastTerms({ current, previous }) {
  const periods = previous.slice(0, MAX_TERMS).map(({ period, rows }) => indexPeriod(period, rows));
  const history = new Map();

  for (const row of current) {
    const entries = [];
    for (const { period, byKod, byGroup } of periods) {
      // Önce kimlik: aynı kadro kodu. Yoksa aynı kurum/il/unvan grubundan ilk kayıt.
      const exact = byKod.get(row.kod);
      const hit = exact ?? byGroup.get(groupKey(row))?.[0];
      if (!hit) continue;
      const filled = (hit.yerlesen ?? 0) > 0;
      entries.push({
        d: termLabel(period),
        es: exact ? 'kod' : 'grup',
        knt: hit.kontenjan ?? null,
        yer: hit.yerlesen ?? 0,
        taban: filled ? round3(hit.minPuan) : null,
        tavan: filled ? round3(hit.maxPuan) : null,
      });
    }
    if (entries.length) history.set(row.kod, entries);
  }
  return history;
}

/** En az bir geçmiş dönemde kontenjanı dolmuş mu? */
export const filledInPast = (entries) => Array.isArray(entries) && entries.some((entry) => (entry.yer ?? 0) > 0);
