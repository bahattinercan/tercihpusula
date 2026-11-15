// Kurum alımları: merkezî yerleştirme dışındaki ÖSYM yerleştirmeleri (Sağlık Bakanlığı,
// MEB, Çevre ve Şehircilik … sözleşmeli personel dönemleri). Bu dönemlerin kadro satırları
// `data/rounds/<dönem>/<seviye>.json` altında `channel` alanıyla işaretli durur.
//
// Amaç tek ekranda "bu unvan bu kurumda kaç puanla kapandı" sorusunu yanıtlamak:
// unvan × düzey başına kontenjan/yerleşen toplamı, en düşük taban ve en yüksek tavan,
// ayrıca dönem bazında aynı üçlü.

const emptyGroup = (unvan, level) => ({
  unvan,
  level,
  kontenjan: 0,
  yerlesen: 0,
  taban: null,
  tavan: null,
  iller: new Set(),
  rounds: {},
});

const push = (group, round, row) => {
  const filled = (row.yerlesen ?? 0) > 0;
  group.kontenjan += row.kontenjan ?? 0;
  group.yerlesen += row.yerlesen ?? 0;
  if (row.il) group.iller.add(row.il);
  if (filled && row.minPuan !== null && row.minPuan !== undefined) {
    group.taban = group.taban === null ? row.minPuan : Math.min(group.taban, row.minPuan);
  }
  if (filled && row.maxPuan !== null && row.maxPuan !== undefined) {
    group.tavan = group.tavan === null ? row.maxPuan : Math.max(group.tavan, row.maxPuan);
  }
  const bucket = group.rounds[round] ?? (group.rounds[round] = { knt: 0, yer: 0, taban: null, tavan: null });
  bucket.knt += row.kontenjan ?? 0;
  bucket.yer += row.yerlesen ?? 0;
  if (filled && row.minPuan !== null && row.minPuan !== undefined) {
    bucket.taban = bucket.taban === null ? row.minPuan : Math.min(bucket.taban, row.minPuan);
  }
  if (filled && row.maxPuan !== null && row.maxPuan !== undefined) {
    bucket.tavan = bucket.tavan === null ? row.maxPuan : Math.max(bucket.tavan, row.maxPuan);
  }
};

/**
 * @param {Array<{ round: string, channelTitle: string, levels: Record<string, object[]> }>} rounds
 *        `round` is the display label ("2025/5"); newest round first.
 * @returns {{ channels: Array<object> }}
 */
export function summarizeChannels(rounds) {
  const channels = new Map();
  for (const entry of rounds) {
    const channel = channels.get(entry.channelTitle) ?? { title: entry.channelTitle, rounds: [], groups: new Map() };
    channels.set(entry.channelTitle, channel);
    for (const [level, rows] of Object.entries(entry.levels)) {
      if (!rows?.length) continue;
      const totals = rows.reduce(
        (acc, row) => ({ knt: acc.knt + (row.kontenjan ?? 0), yer: acc.yer + (row.yerlesen ?? 0) }),
        { knt: 0, yer: 0 },
      );
      channel.rounds.push({ round: entry.round, level, rows: rows.length, knt: totals.knt, yer: totals.yer });
      for (const row of rows) {
        if (!row.unvan) continue;
        const key = `${level}|${row.unvan}`;
        const group = channel.groups.get(key) ?? emptyGroup(row.unvan, level);
        push(group, entry.round, row);
        channel.groups.set(key, group);
      }
    }
  }

  return {
    channels: [...channels.values()]
      .map((channel) => ({
        title: channel.title,
        rounds: channel.rounds,
        groups: [...channel.groups.values()]
          .map((group) => ({ ...group, iller: group.iller.size }))
          .sort((a, b) => b.kontenjan - a.kontenjan || a.unvan.localeCompare(b.unvan, 'tr')),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'tr')),
  };
}
