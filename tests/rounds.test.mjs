// Level detection must cover both ÖSYM filename families. It silently dropped
// lisans/ön lisans documents for 2026/1 once, so it is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocumentUrl } from '../pipeline/rounds.mjs';

const cases = [
  ['https://dokuman.osym.gov.tr/web/2026/7/kpss-20261-yerlestirme-sonuclarina-liskin-en-kucuk-ve-en-buyuk-puanlar-lsans-24q42vum.pdf', 'lisans'],
  ['https://dokuman.osym.gov.tr/web/2026/7/kpss-20261-yerlestirme-sonuclarina-liskin-en-kucuk-ve-en-buyuk-puanlar-on-lsans-24zbk8tg.pdf', 'onlisans'],
  ['https://dokuman.osym.gov.tr/web/2026/7/kpss-20261-yerlestirme-sonuclarina-liskin-en-kucuk-ve-en-buyuk-puanlar-ortaogretm-2477sk0t.pdf', 'ortaogretim'],
  ['https://dokuman.osym.gov.tr/web/2026/7/kpss-20261-yerlestirme-sonuclarina-liskin-sayisal-bilgiler-24vo0pj5.pdf', 'summary'],
  ['https://dokuman.osym.gov.tr/pdfdokuman/2025/KPSS/TERCIH2/minmaxlisans07012026.pdf', 'lisans'],
  ['https://dokuman.osym.gov.tr/pdfdokuman/2025/KPSS/TERCIH2/minmaxonl07012026.pdf', 'onlisans'],
  ['https://dokuman.osym.gov.tr/pdfdokuman/2025/KPSS/TERCIH2/minmaxort07012025.pdf', 'ortaogretim'],
  ['https://dokuman.osym.gov.tr/pdfdokuman/2025/KPSS/TERCIH2/sayisalbil07012026.pdf', 'summary'],
  ['https://dokuman.osym.gov.tr/pdfdokuman/yasakli-ve-izinli-belgeler.pdf', null],
];

for (const [url, expected] of cases) {
  test(`classifies ${url.split('/').pop()}`, () => {
    assert.equal(classifyDocumentUrl(url), expected);
  });
}
