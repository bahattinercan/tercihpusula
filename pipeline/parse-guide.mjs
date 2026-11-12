// Parsers for the ÖSYM tercih kılavuzu package (per placement round):
//   mezunolunan-*prg / ortaogretim-alandal  → diploma programme codes (KODU ADI)
//   *-nitelik                              → nitelik code -> definition + programme codes
//   tablo1/2/3                             → cadre rows and their required nitelik codes
//
// All of them are Excel-exported PDFs read with `pdftotext -table`. Rows wrap and
// cells are justified, so parsing is cell-based (2+ spaces) rather than
// column-offset based.

import { readFileSync } from 'node:fs';

const ENTRY = /^(\d{4})\s{2,}(.*)$/;

// İl eşleşmesi için 81 il listesi: tablo satırlarında ilçe ile ili ayırmanın tek güvenilir yolu.
const PROVINCES = new Set(JSON.parse(readFileSync(new URL('../data/reference/provinces.json', import.meta.url), 'utf8')));
const PROVINCE_ALTERNATION = [...PROVINCES]
  .sort((a, b) => b.length - a.length)
  .map((province) => province.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const PROVINCE_MATCH = new RegExp(`^(${PROVINCE_ALTERNATION})(\\s*\\(.*\\))?$`);
const TRAILING_CODES = /\s{2,}((?:\d{4})(?:\s+\d{4})*)\s*$/;

/** Split "definition text ....  1234  5678" into text and trailing 4-digit codes. */
export function splitTrailingCodes(line) {
  const match = line.replace(/\s+$/, '').match(TRAILING_CODES);
  if (!match) return { text: line.trim(), codes: [] };
  const codes = match[1].split(/\s+/).map(Number);
  return { text: line.slice(0, match.index).trim(), codes };
}

const isHeader = (line) =>
  /Mezun Olunan|NİTELİKLER|Nitelik\s+Kodu|ÖĞRENİM KOŞULU|Mezuniyet\s+Alanı|KODU\s+ADI|Alan Kod|^TABLO-|ÖSYM KODU|^KPSS\s?\d{4}/i.test(
    line.trim(),
  );

/**
 * Diploma programme list of one level.
 * @returns {{programmes: Array<{kod: number, ad: string}>}}
 */
export function parseProgrammeList(text) {
  const programmes = [];
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\f/g, '').trimEnd();
    if (!line.trim() || isHeader(line)) continue;
    const match = line.match(ENTRY);
    if (!match) continue;
    const ad = match[2].replace(/\s{2,}/g, ' ').trim();
    if (!ad) continue;
    programmes.push({ kod: Number(match[1]), ad });
  }
  return { programmes };
}

/**
 * Nitelik dictionary of one level.
 *
 * Two layouts exist in the same package:
 *   lisans / ön lisans — one row per nitelik, up to 15 programme codes in trailing cells
 *   ortaöğretim        — one row per (nitelik, alan/dal) pair, so 2003 appears three
 *                        times and its code sits mid-row: "… Dalı   6001   *   ADALET ALANI…"
 * Both are handled by scanning 2+-space cells for the maximal run of numeric-only
 * cells (4-digit codes, allowing "*" and 1–3 digit dal codes) and merging entries
 * by nitelik code.
 *
 * @returns {{nitelikler: Array<{kod:number, tanim:string, programKodlari:number[], rows:number}>}}
 */
export function parseNitelik(text) {
  const byCode = new Map();
  let current = null;

  const flush = () => {
    if (!current) return;
    const entry = byCode.get(current.kod) ?? { kod: current.kod, tanim: '', programKodlari: [], rows: 0 };
    const tanim = current.parts.join(' ').replace(/\s{2,}/g, ' ').trim();
    if (tanim.length > entry.tanim.length) entry.tanim = tanim;
    for (const kod of current.codes) if (!entry.programKodlari.includes(kod)) entry.programKodlari.push(kod);
    entry.rows += 1;
    byCode.set(current.kod, entry);
    current = null;
  };

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\f/g, '').trimEnd();
    if (!line.trim() || isHeader(line)) continue;
    const entry = line.match(ENTRY);
    if (entry) {
      flush();
      current = { kod: Number(entry[1]), parts: [], codes: [] };
    } else if (!(current && /^\s+\S/.test(line))) {
      continue;
    }

    const body = entry ? entry[2] : line.trim();
    const cells = body.split(/\s{2,}/).filter(Boolean);
    const textCells = [];
    let inRun = false;
    for (const cell of cells) {
      const numeric = /^[\d\s*]+$/.test(cell) && /\d/.test(cell);
      if (numeric) {
        inRun = true;
        for (const token of cell.split(/\s+/)) if (/^\d{4}$/.test(token)) current.codes.push(Number(token));
        continue;
      }
      if (inRun) break; // the code run ended; what follows is the alan-name column
      textCells.push(cell);
    }
    const fragment = textCells.join('  ').trim();
    if (fragment) current.parts.push(fragment);
  }
  flush();

  return { nitelikler: [...byCode.values()] };
}

/**
 * Ortaöğretim alan/dal list: `Alan Kod | Alan Adı | Dal Kod | Dal Adı`
 * (Dal Kod is "-" when the alan has no branches).
 * @returns {{programmes: Array<{kod:number, ad:string, dallar:Array<{kod:number|null, ad:string}>}>}}
 */
export function parseAlanList(text) {
  const byCode = new Map();
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\f/g, '').trimEnd();
    if (!line.trim() || isHeader(line)) continue;
    const match = line.match(/^(\d{4})\s{2,}(.+)$/);
    if (!match) continue;
    const cells = match[2].split(/\s{2,}/).filter(Boolean);
    if (!cells.length) continue;
    const kod = Number(match[1]);
    const entry = byCode.get(kod) ?? { kod, ad: cells[0], dallar: [] };
    if (cells.length >= 3) {
      const dalKod = /^\d+$/.test(cells[1]) ? Number(cells[1]) : null;
      entry.dallar.push({ kod: dalKod, ad: cells.slice(2).join(' ') });
    }
    byCode.set(kod, entry);
  }
  return { programmes: [...byCode.values()] };
}

/**
 * Cadre table (Tablo-1/2/3). Only the fields the product needs are extracted;
 * kontenjan/kurum/unvan/il come from the result documents, which are already
 * gated, and are reconciled against this table by Gate E.
 *
 * Wrapped rows are the norm (252 of 555 in 2026/1): Excel spills a cell's first
 * words onto the next physical line, while the nitelik codes and quota numbers
 * stay on the first line. The tail is therefore taken from the first physical
 * line that yields a code run, never from the last line.
 * @returns {{rows: Array<object>, stats: object}}
 */

/**
 * Kalan hücrelerden kurum/unvan/il/teşkilat çıkarır. Hücreler sağdan çapalanır:
 * teşkilat (MERKEZ/TAŞRA), sonra 81 il listesine uyan il, sonra unvan, istihdam
 * şekli ve kurum. Boş hücreler metin modunda kaybolduğu için tek güvenilir yol
 * ili tanımak; bulunamazsa satır "elle kontrol" olarak işaretlenir.
 */
const norm = (value) => (value === null || value === undefined ? null : String(value).replace(/\s+/g, ' ').trim() || null);

function splitCadreCells(cells) {
  const work = [...cells];
  let teskilat = null;
  if (work.length && /^(MERKEZ|TAŞRA)$/i.test(work.at(-1))) teskilat = work.pop().toUpperCase();
  let ilIndex = -1;
  for (let i = work.length - 1; i >= 1; i -= 1) {
    if (PROVINCE_MATCH.test(work[i])) {
      ilIndex = i;
      break;
    }
  }
  if (ilIndex < 3) {
    return { kurum: null, istihdam: null, unvan: null, il: null, ilce: null, teskilat, cells: work.length, parsed: false };
  }
  const il = work[ilIndex];
  const ilce = work.slice(ilIndex + 1).join(' ') || null;
  const unvan = work[ilIndex - 1] ?? null;

  // İstihdam şekli bir veya iki hücreye bölünür: "MEMUR" ya da
  // "SÖZLEŞMELİ" + "PERSONEL" / "KİT SÖZLEŞMELİ" + "PERSONEL".
  let cursor = ilIndex - 2;
  let istihdam = null;
  if (cursor >= 1 && /^PERSONEL$/.test(work[cursor]) && /SÖZLEŞMELİ$/.test(work[cursor - 1] ?? '')) {
    istihdam = `${work[cursor - 1]} PERSONEL`;
    cursor -= 1;
  } else if (cursor >= 1) {
    istihdam = work[cursor];
  }
  const kurum = work.slice(1, cursor).join(' / ') || null;
  return { kurum: norm(kurum), istihdam: norm(istihdam), unvan: norm(unvan), il: norm(il), ilce: norm(ilce), teskilat, cells: work.length, parsed: true };
}

export function parseKadroTable(text) {
  const rows = [];
  const rejected = [];
  let current = null;

  const extract = (line) => {
    const cells = line.trim().split(/\s{2,}/).filter(Boolean);
    const nitelikKodlari = [];
    // a cell can hold several codes separated by a single space ("4502 4505 6225"),
    // so match the run, not just a single token
    while (cells.length && /^\d{4}(\s+\d{4})*$/.test(cells.at(-1))) {
      nitelikKodlari.unshift(...cells.pop().split(/\s+/).map(Number));
    }
    const adet = cells.length && /^\d+$/.test(cells.at(-1)) ? Number(cells.pop()) : null;
    const derece = cells.length && /^\d+$/.test(cells.at(-1)) ? Number(cells.pop()) : null;
    const hizmetSinifi = cells.length && /^[A-ZÇĞİÖŞÜ]{2,4}$/.test(cells.at(-1)) ? cells.pop() : null;
    const meta = splitCadreCells(cells);
    return { nitelikKodlari, adet, derece, hizmetSinifi, rest: cells, ...meta };
  };

  const flush = () => {
    if (!current) return;
    const extractions = current.lines.map(extract);
    const chosen =
      extractions.find((e) => e.nitelikKodlari.length > 0) ?? extractions.find((e) => e.adet !== null) ?? extractions[0];
    rows.push({
      kod: current.kod,
      nitelikKodlari: chosen.nitelikKodlari,
      adet: chosen.adet,
      hizmetSinifi: chosen.hizmetSinifi,
      derece: chosen.derece,
      kurum: chosen.kurum,
      istihdam: chosen.istihdam,
      unvan: chosen.unvan,
      il: chosen.il,
      ilce: chosen.ilce,
      teskilat: chosen.teskilat,
      parsed: chosen.parsed,
      // satırdan sonra gelen fiziksel devam satırları: bir SONRAKİ satırın
      // sarılmış hücre metnidir (Excel taşan metni üstteki satıra yazar)
      trailing: current.lines.slice(1).map((line) => line.trim()),
    });
    current = null;
  };

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.replace(/\f/g, '').trimEnd();
    if (!line.trim() || isHeader(line)) continue;
    const start = line.match(/^\s*(\d{9})\s+(.*)$/);
    if (start) {
      flush();
      current = { kod: start[1], lines: [start[2]] };
      continue;
    }
    if (current && /^\s+\S/.test(line)) current.lines.push(line.trim());
    else if (line.trim()) rejected.push(line.trim().slice(0, 120));
  }
  flush();

  const withNitelik = rows.filter((r) => r.nitelikKodlari.length > 0).length;
  return {
    rows,
    stats: {
      parsed: rows.length,
      withNitelik,
      withoutNitelik: rows.length - withNitelik,
      adetTotal: rows.reduce((sum, r) => sum + (r.adet ?? 0), 0),
      rejectedLines: rejected.length,
      rejectedSample: rejected.slice(0, 5),
    },
  };
}

/**
 * Sarılmış (wrap) hücre metinleri, ait oldukları satırın BİR ÖNCEKİ fiziksel
 * satırında durur; bu yüzden ham metin satırla birlikte saklanır.
 * @returns {{rows: Array<object>, stats: object}}
 */
export function attachWrappedPrefixes(rows, { unvanVocab, kurumVocabByIl }) {
  let attached = 0;
  let ambiguous = 0;
  const out = rows.map((row, index) => {
    const previous = rows[index - 1];
    const prefix = (previous?.trailing ?? []).join(' ').trim();
    if (!prefix || !row.parsed) return row;
    const asKurum = row.kurum ? `${prefix} ${row.kurum}` : null;
    const asUnvan = row.unvan ? `${prefix} ${row.unvan}` : null;
    const kurumOk = asKurum !== null && kurumVocabByIl.get(row.il)?.has(asKurum);
    const unvanOk = asUnvan !== null && unvanVocab.has(asUnvan);
    if (kurumOk && !unvanOk) {
      attached += 1;
      return { ...row, kurum: asKurum };
    }
    if (unvanOk && !kurumOk) {
      attached += 1;
      return { ...row, unvan: asUnvan };
    }
    if (kurumOk && unvanOk) ambiguous += 1;
    return row;
  });
  return { rows: out, attached, ambiguous };
}
