// HTTP access to ÖSYM hosts.
// dokuman.osym.gov.tr answers plain requests with a 2.7 KB "Erişim Engellendi"
// HTML page while still returning HTTP 200, so status codes prove nothing here:
// every download is validated by magic bytes instead.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REFERER = 'https://www.osym.gov.tr/';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ölçülen davranış (2026-11-15): dokuman.osym.gov.tr'nin HTTPS ucu bir noktadan sonra
 * 2,7 KB'lık "Erişim Engellendi" HTML'i döndürürken aynı dosya HTTP (80) üzerinden
 * 200 application/pdf geliyor. Engellendiğini görürsek protokolü bir kez düşürüp
 * aynı yolu tekrar deneriz.
 */
const downgradeProtocol = (url) => (url.startsWith('https://') ? `http://${url.slice('https://'.length)}` : null);

/**
 * @returns {Promise<{bytes: Buffer, contentType: string, url: string}>}
 */
export async function fetchBytes(url, { referer = REFERER, tries = 3, delayMs = 1500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Referer: referer,
          Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8',
          'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),
      });
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (looksBlocked(bytes, contentType)) throw new Error(`blocked by ÖSYM WAF (${bytes.length} B html) for ${url}`);
      return { bytes, contentType, url };
    } catch (error) {
      lastError = error;
      const fallback = downgradeProtocol(url);
      if (fallback && /blocked by ÖSYM WAF/.test(error.message)) {
        try {
          const res = await fetch(fallback, {
            headers: {
              'User-Agent': UA,
              Referer: referer,
              Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.8',
              'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(90_000),
          });
          const bytes = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers.get('content-type') ?? '';
          if (res.ok && !looksBlocked(bytes, contentType) && isPdf(bytes)) {
            return { bytes, contentType, url: fallback };
          }
        } catch {
          /* aşağıdaki bekleme + yeniden deneme devreye girer */
        }
      }
      if (attempt < tries) await sleep(delayMs * attempt);
    }
  }
  throw new Error(`fetch failed after ${tries} tries: ${lastError?.message}`);
}

export async function fetchText(url, options) {
  const { bytes } = await fetchBytes(url, options);
  return bytes.toString('utf8');
}

export function looksBlocked(bytes, contentType) {
  if (contentType.includes('pdf')) return !isPdf(bytes);
  const head = bytes.subarray(0, 400).toString('utf8');
  return /Erişim Engellendi|Access Denied/i.test(head);
}

export const isPdf = (bytes) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';
