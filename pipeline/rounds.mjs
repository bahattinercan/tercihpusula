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
 * @returns {Promise<Array<{round: string, title: string, url: string, central: boolean}>>}
 */
export async function discoverRounds() {
  const html = await fetchText(MENU_URL);
  const seen = new Map();
  const re = /<a[^>]*href="(\/kpss[^"]*)"[^>]*title="([^"]*)"[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const title = decode(match[2]);
    if (!/Sayısal Bilgiler/i.test(title)) continue;
    const round = title.match(/KPSS-?(\d{4})\/(\d+)/i);
    if (!round) continue;
    const id = `${round[1]}/${round[2]}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      round: id,
      title,
      url: BASE + match[1],
      central: /Bazı Kamu Kurum ve Kuruluşlar/i.test(title),
    });
  }
  return [...seen.values()].sort((a, b) => {
    const [ay, an] = a.round.split('/').map(Number);
    const [by, bn] = b.round.split('/').map(Number);
    return by - ay || bn - an;
  });
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
