// Parser for ÖSYM "En Küçük ve En Büyük Puanlar" result PDFs.
//
// Input is `pdftotext -table` output, one physical line per table row:
//   301014259  DEVLET DEMİRYOLLARI … / ADIYAMAN / TAŞRA   MEMUR   1  1  0   76,15846  76,15846
//
// Two traps, both verified against the 2026/1 file:
//  1. `-layout` mode wraps rows onto 2–3 lines and drops score cells; `-table`
//     does not. Hence -table.
//  2. `-table` justifies text, so a cell can contain runs of spaces
//     ("VERİ  HAZIRLAMA VE KONTROL İŞLETMENİ" splits at 5+ spaces). The column
//     gap is however much wider, so splitting at 5+ spaces gives 2–3 cells and
//     the job title is re-joined from the tail cells.
//
// Scores always carry a decimal comma or are "--"; quota counts never do, so the
// numeric tail is unambiguous. 0 is never a valid score.

const CODE_LINE = /^\s*(\d{9})\s+(.*)$/;
const SCORE = String.raw`(?:\d{1,3},\d+|--)`;
const SCORES = new RegExp(String.raw`(?:^|\s)(${SCORE})\s+(${SCORE})\s*$`);
const INTS = /(?:^|\s)(\d+)\s+(\d+)\s+(\d+)\s*$/;
const CELL_GAP = /\s{5,}/;

const toScore = (raw) => {
  if (raw === undefined || raw === null || raw === '--') return null;
  const value = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
};

/** "KURUM / İL / TEŞKİLAT" -> {kurum, il, teskilat}; split from the right. */
export function splitKurum(raw) {
  const parts = raw.split('/').map((p) => p.trim()).filter(Boolean);
  let teskilat = null;
  if (parts.length > 1 && /^(MERKEZ|TAŞRA)$/i.test(parts.at(-1))) teskilat = parts.pop().toUpperCase();
  const il = parts.length > 1 ? parts.pop() : null;
  return { kurum: parts.join(' / ') || null, il, teskilat };
}

const isHeader = (line) =>
  /Program Kodu|Sayısı\s+Sayısı|En Küçük\s+En Büyük|^Puan\s+Puan$|^KPSS-\d{4}/i.test(line.trim());

/**
 * @param {string} text pdftotext -table output
 * @returns {{rows: Array<object>, stats: object}}
 */
export function parseResultsText(text) {
  const rows = [];
  const rejected = [];
  let noSeparator = 0;

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\f/g, '');
    if (!line.trim() || isHeader(line)) continue;
    const codeMatch = line.match(CODE_LINE);
    if (!codeMatch) {
      rejected.push(line.trim().slice(0, 160));
      continue;
    }

    let rest = codeMatch[2];
    // scores first: they sit at the end of the line, so the quota integers can
    // only be matched after they are removed
    const scoreMatch = rest.match(SCORES);
    const scores = scoreMatch ? [scoreMatch[1], scoreMatch[2]] : [null, null];
    if (scoreMatch) rest = rest.slice(0, scoreMatch.index);
    const intMatch = rest.match(INTS);
    if (!intMatch) {
      rejected.push(line.trim().slice(0, 160));
      continue;
    }
    const ints = [intMatch[1], intMatch[2], intMatch[3]];
    rest = rest.slice(0, intMatch.index);

    const normalised = rest.replace(/\s*\/\s*/g, ' / ').trim();
    const cells = normalised.split(CELL_GAP).map((c) => c.trim()).filter(Boolean);
    let kurumRaw;
    let unvan;
    if (cells.length >= 2) {
      kurumRaw = cells[0];
      unvan = cells.slice(1).join(' ');
    } else {
      // kurum and job title were closer than the cell gap: cut after the last
      // " / TEŞKİLAT" (or " / İL (İLÇE)") anchor.
      const anchored = normalised.match(/^(.*?\/\s*[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s().-]*(?:\/\s*[A-ZÇĞİÖŞÜ]+)?)\s{2,}(.+)$/);
      if (anchored) {
        kurumRaw = anchored[1];
        unvan = anchored[2].trim();
      } else {
        kurumRaw = normalised;
        unvan = null;
      }
    }
    if (!kurumRaw.includes('/')) noSeparator += 1;

    const { kurum, il, teskilat } = splitKurum(kurumRaw);
    rows.push({
      kod: codeMatch[1],
      kurum,
      il,
      teskilat,
      unvan,
      kontenjan: Number(ints[0]),
      yerlesen: Number(ints[1]),
      bosKalan: Number(ints[2]),
      minPuan: toScore(scores[0]),
      maxPuan: toScore(scores[1]),
    });
  }

  const codes = new Set(rows.map((r) => r.kod));
  return {
    rows,
    stats: {
      parsed: rows.length,
      uniqueCodes: codes.size,
      rejectedLines: rejected.length,
      kurumWithoutSeparator: noSeparator,
      rejectedSample: rejected.slice(0, 5),
    },
  };
}
