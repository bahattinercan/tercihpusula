// Data gates. Nothing is published unless every gate passes.
//   A arithmetic   — quota maths must close, score cells must agree with placement counts
//   B schema       — shape, uniqueness, ranges
//   C diff         — a round must not swing wildly against the previous one (parser regression alarm)
//   D cross-source — row-by-row equality against an independent CC BY 4.0 dataset

const GATE_D_ROUNDS = new Set(['2025/1', '2025/2', '2026/1']);
const KPSSDEN = 'https://kpssden.com/api/veri/atama';
const KPSSDEN_LEVEL = { lisans: 'lisans', onlisans: 'onlisans', ortaogretim: 'ortaogretim' };

export function gateA(round, level, rows, official) {
  const problems = [];
  let kontenjan = 0;
  let yerlesen = 0;
  let bos = 0;
  for (const row of rows) {
    kontenjan += row.kontenjan;
    yerlesen += row.yerlesen;
    bos += row.bosKalan;
    if (row.kontenjan !== row.yerlesen + row.bosKalan) {
      problems.push(`${row.kod}: kontenjan ${row.kontenjan} != yerleşen ${row.yerlesen} + boş ${row.bosKalan}`);
    }
    // A row with nobody placed has no score. A row with a partial placement does
    // have one (kontenjan 2, yerleşen 1, boş 1) — so the rule keys on yerleşen,
    // not on boş.
    if (row.yerlesen === 0 && row.minPuan !== null) {
      problems.push(`${row.kod}: yerleşen 0 ama puan dolu (${row.minPuan})`);
    }
    if (row.yerlesen > 0 && row.minPuan === null) {
      problems.push(`${row.kod}: ${row.yerlesen} yerleşen var ama puan yok`);
    }
    if (row.minPuan !== null && row.maxPuan !== null && row.minPuan > row.maxPuan) {
      problems.push(`${row.kod}: en küçük puan ${row.minPuan} > en büyük puan ${row.maxPuan}`);
    }
  }
  if (official) {
    for (const [field, mine] of [['kontenjan', kontenjan], ['yerlesen', yerlesen], ['bos', bos]]) {
      if (official[field] !== mine) {
        problems.push(`official ${field} ${official[field]} != parsed ${mine}`);
      }
    }
  }
  return {
    name: 'A',
    round,
    level,
    ok: problems.length === 0,
    totals: { kontenjan, yerlesen, bos, rows: rows.length },
    official: official ?? null,
    problems,
  };
}

export function gateB(round, level, rows) {
  const problems = [];
  const seen = new Set();
  for (const row of rows) {
    if (!/^\d{9}$/.test(row.kod)) problems.push(`bad code: ${row.kod}`);
    if (seen.has(row.kod)) problems.push(`duplicate code: ${row.kod}`);
    seen.add(row.kod);
    if (!row.kurum) problems.push(`${row.kod}: kurum boş`);
    if (!row.il) problems.push(`${row.kod}: il boş`);
    if (!row.unvan) problems.push(`${row.kod}: unvan boş`);
    if (!(row.kontenjan >= 1)) problems.push(`${row.kod}: kontenjan ${row.kontenjan}`);
    if (row.yerlesen > row.kontenjan) problems.push(`${row.kod}: yerleşen > kontenjan`);
    if (row.minPuan !== null && (row.minPuan < 40 || row.minPuan > 100)) problems.push(`${row.kod}: puan aralığı dışı ${row.minPuan}`);
  }
  return { name: 'B', round, level, ok: problems.length === 0, problems };
}

export function gateC(round, level, rows, previous) {
  if (!previous) return { name: 'C', round, level, ok: true, skipped: 'no previous round', warnings: [] };
  const bucket = (list) => {
    const map = new Map();
    for (const row of list) map.set(row.unvan, (map.get(row.unvan) ?? 0) + row.kontenjan);
    return map;
  };
  const now = bucket(rows);
  const before = bucket(previous);
  const warnings = [];
  for (const [unvan, quota] of now) {
    const prev = before.get(unvan) ?? 0;
    if (prev >= 5 && quota > prev * 1.3) warnings.push(`${unvan}: kontenjan ${prev} → ${quota}`);
  }
  return { name: 'C', round, level, ok: true, warnings };
}

export async function gateD(round, level, rows) {
  if (!GATE_D_ROUNDS.has(round)) return { name: 'D', round, level, ok: true, skipped: 'round not covered by cross-source' };
  const url = `${KPSSDEN}?donem=${encodeURIComponent(round)}&duzey=${KPSSDEN_LEVEL[level]}&limit=20000`;
  const res = await fetch(url, { headers: { 'User-Agent': 'tercihpusula/0.1 (data gate)' } });
  if (!res.ok) return { name: 'D', round, level, ok: false, problems: [`cross-source HTTP ${res.status}`] };
  const payload = await res.json();
  const external = new Map(payload.kayitlar.map((r) => [r.program_kodu, r]));
  const problems = [];
  const warnings = [];
  const local = new Map(rows.map((r) => [r.kod, r]));

  // The cross-source dataset lags ÖSYM: for 2026/1 lisans it is missing one
  // cadre row (301017843) even though ÖSYM's own summary confirms our totals.
  // Missing rows are therefore a failure, extra rows only a warning.
  for (const kod of external.keys()) if (!local.has(kod)) problems.push(`missing locally: ${kod}`);
  for (const kod of local.keys()) if (!external.has(kod)) warnings.push(`not in cross-source: ${kod}`);
  for (const [kod, row] of local) {
    const ext = external.get(kod);
    if (!ext) continue;
    if (row.kontenjan !== ext.kontenjan) problems.push(`${kod}: kontenjan ${row.kontenjan} vs ${ext.kontenjan}`);
    if (row.yerlesen !== ext.yerlesen) problems.push(`${kod}: yerleşen ${row.yerlesen} vs ${ext.yerlesen}`);
    if (row.bosKalan !== ext.bos_kalan) problems.push(`${kod}: boş ${row.bosKalan} vs ${ext.bos_kalan}`);
    for (const key of ['en_kucuk_puan', 'en_buyuk_puan']) {
      const mine = key === 'en_kucuk_puan' ? row.minPuan : row.maxPuan;
      const theirs = ext[key];
      if (mine === null && theirs === null) continue;
      if (mine === null || theirs === null || Math.abs(mine - theirs) > 1e-5) {
        problems.push(`${kod}: ${key} ${mine} vs ${theirs}`);
      }
    }
  }
  return { name: 'D', round, level, ok: problems.length === 0, compared: external.size, warnings: warnings.slice(0, 10), problems: problems.slice(0, 25), problemCount: problems.length };
}
