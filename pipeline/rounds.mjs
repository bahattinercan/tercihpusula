// Round registry.
// Round landing pages are discovered from ÖSYM's KPSS menu instead of being
// hard-coded: the document URLs carry a random suffix per upload
// (…-lsans-24q42vum.pdf), so they cannot be guessed or kept stable.

import { fetchText } from './lib/http.mjs';

const MENU_URL = 'https://osym.gov.tr/SinavGrubu/Menu/341';
const BASE = 'https://www.osym.gov.tr';

export const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];

/** Decode the numeric entities ÖSYM's CMS emits in titles. */
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .trim();

/**
 * All "…Yerleştirme Sonuçlarına İlişkin Sayısal Bilgiler" pages, newest first.
 * The same menu also carries each round's "Tercih Kılavuzu ve Tablolar" page,
 * which is where the nitelik dictionaries and the cadre tables live.
 * @returns {Promise<Array<{round: string, title: string, url: string, guideUrl: string|null, central: boolean}>>}
 */
export async function discoverRounds() {
  const html = await fetchText(MENU_URL);
  const seen = new Map();
  const guides = new Map();
  const re = /<a[^>]*href="(\/kpss[^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const title = decode(match[2]);
    const round = title.match(/KPSS-?(\d{4})\/(\d+)/i);
    if (!round) continue;
    const id = `${round[1]}/${round[2]}`;
    if (/Tercih Kılavuzu ve Tablolar/i.test(title)) {
      if (!guides.has(id)) guides.set(id, BASE + match[1]);
      continue;
    }
    if (!/Sayısal Bilgiler/i.test(title)) continue;
    if (seen.has(id)) continue;
    seen.set(id, {
      round: id,
      title,
      url: BASE + match[1],
      guideUrl: null,
      central: /Bazı Kamu Kurum ve Kuruluşlar/i.test(title),
    });
  }
  return [...seen.values()]
    .map((entry) => ({ ...entry, guideUrl: guides.get(entry.round) ?? deriveGuideUrl(entry.url) }))
    .sort((a, b) => {
      const [ay, an] = a.round.split('/').map(Number);
      const [by, bn] = b.round.split('/').map(Number);
      return by - ay || bn - an;
    });
}

/**
 * The menu does not link each round's "Tercih Kılavuzu ve Tablolar" page, but its
 * slug is a deterministic transform of the results page slug:
 *   …-kuruluslarin-…-yerlestirme-sonuclarina-iliskin-sayisal-bilgiler
 *   → kpss<yyyy><n>-…-kuruluslarinin-…-yerlestirme-yapmak-icin-tercih-kilavuzu-ve-tablolar
 * Verified against 2026/1, 2025/2 and 2025/1 (all 200 + nitelik documents).
 */
export function deriveGuideUrl(resultsUrl) {
  const slug = resultsUrl.replace(BASE, '');
  if (!/-yerlestirme-sonuclarina-iliskin-sayisal-bilgiler$/.test(slug)) return null;
  const derived = slug
    .replace('-yerlestirme-sonuclarina-iliskin-sayisal-bilgiler', '')
    .replace(/^kpss-?(\d{5})/, 'kpss$1')
    .replace('kuruluslarin-', 'kuruluslarinin-');
  return `${BASE}${derived}-yerlestirme-yapmak-icin-tercih-kilavuzu-ve-tablolar`;
}

// Guide package filenames differ per round (2026/1: lisans-nitelik_t1d03072026.pdf,
// mezunolunan-lisansprg_t1d03072026.pdf, tablo3_t1d03072026.pdf).
const GUIDE_PATTERNS = [
  ['lisans-nitelik', /lisans-nitelik/i],
  ['onlisans-nitelik', /onlisans-nitelik/i],
  ['ortaogretim-nitelik', /ortaogretim-nitelik/i],
  ['lisans-programlar', /mezunolunan-lisansprg|lisansprg/i],
  ['onlisans-programlar', /molunan-?onlisansprg|onlisansprg/i],
  ['ortaogretim-alanlar', /ortaogretim-alandal|alanda?l/i],
  ['tablo1', /tablo1/i],
  ['tablo2', /tablo2/i],
  ['tablo3', /tablo3/i],
  ['ozelkosullar', /ozelkosullar/i],
  ['kilavuz', /kilavuz_t/i],
];

/** @returns {string|null} */
export function classifyGuideDocument(url) {
  const hit = GUIDE_PATTERNS.find(([, re]) => re.test(url));
  return hit ? hit[0] : null;
}

/**
 * Guide package links of one round.
 * @returns {Promise<Record<string, string>>}
 */
export async function discoverGuideDocuments(guideUrl) {
  const html = await fetchText(guideUrl);
  const docs = {};
  for (const match of html.matchAll(/href="(https:\/\/dokuman\.osym\.gov\.tr\/[^"]+\.pdf)"/gi)) {
    const url = match[1];
    const kind = classifyGuideDocument(url);
    if (kind && !docs[kind]) docs[kind] = url;
  }
  return docs;
}

// ÖSYM uses two naming schemes over the years:
//   2026/1: …-en-kucuk-ve-en-buyuk-puanlar-lsans-24q42vum.pdf
//   2025/2: …/TERCIH2/minmaxlisans07012026.pdf  (also minmaxonl…, minmaxort…, sayisalbil…)
// The on-lisans / ortaöğretim patterns must be tested before the lisans one,
// because "minmaxlisans" contains "lisans" as a substring.
// Level detection. Both filename families must be covered, and the i of
// "lisans" is dropped by ÖSYM's ASCII folding in the newer scheme:
//   2026/1: …puanlar-lsans-24q42vum.pdf, …puanlar-on-lsans-…, …puanlar-ortaogretm-…
//   2025/2: …/TERCIH2/minmaxlisans07012026.pdf, minmaxonl…, minmaxort…
// on-lisans / ortaöğretim are tested first because "minmaxlisans" contains "lisans".
const LEVEL_PATTERNS = [
  ['onlisans', /(minmaxonl|on-l[ıi]?sans|onlisans)/i],
  ['ortaogretim', /(minmaxort|ortaogretm|ortaogretim)/i],
  ['lisans', /(minmaxlisans|l[ıi]?sans)/i],
];

/** @returns {'summary'|'lisans'|'onlisans'|'ortaogretim'|null} */
export function classifyDocumentUrl(url) {
  if (/sayisal/i.test(url)) return 'summary';
  const hit = LEVEL_PATTERNS.find(([, re]) => re.test(url));
  return hit ? hit[0] : null;
}

/**
 * Document links of one round landing page.
 * @returns {Promise<{summary?: string, levels: Record<string, string>}>}
 */
export async function discoverDocuments(landingUrl) {
  const html = await fetchText(landingUrl);
  const docs = {};
  let summary;
  for (const match of html.matchAll(/href="(https:\/\/dokuman\.osym\.gov\.tr\/[^"]+\.pdf)"/gi)) {
    const url = match[1];
    const kind = classifyDocumentUrl(url);
    if (kind === 'summary') summary = url;
    else if (kind) docs[kind] = url;
  }
  return { summary, levels: docs };
}

export const roundKey = (round) => round.replace('/', '-');

/**
 * The menu links a guide page whose slug is not the canonical one (it carries a
 * hyphen after "kpss" and redirects to a generic document listing), so the
 * derived slug is tried as well and the first page that actually yields nitelik
 * documents wins.
 * @returns {Promise<{url: string, docs: Record<string, string>}>}
 */
export async function resolveGuideDocuments(entry) {
  const candidates = [...new Set([entry.guideUrl, deriveGuideUrl(entry.url)].filter(Boolean))];
  for (const url of candidates) {
    const docs = await discoverGuideDocuments(url);
    if (Object.keys(docs).length >= 3) return { url, docs };
  }
  return { url: candidates[0] ?? null, docs: {} };
}
