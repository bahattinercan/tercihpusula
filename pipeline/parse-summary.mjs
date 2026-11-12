// Parser for ÖSYM "…Yerleştirme Sonuçlarına İlişkin Sayısal Bilgiler" PDFs.
//
// The table is the arithmetic ground truth used by Gate A:
//   LİSANS        104.148   977   976   1
//   ÖN LİSANS      70.990   828   828   0
//   ORTAÖĞRETİM    74.159   278   278   0
//   TOPLAM        249.297 2.083 2.082   1
//
// The text layer is justified, so words are split by stray spaces
// ("Boş Kalan Kontenj  an  Sayısı"); matching on the numbers avoids that noise.

const LEVELS = [
  ['lisans', /^L\s*İ\s*S\s*A\s*N\s*S\b/i],
  ['onlisans', /^Ö\s*N\s*L\s*İ\s*S\s*A\s*N\s*S\b/i],
  ['ortaogretim', /^O\s*R\s*T\s*A\s*Ö\s*Ğ\s*R\s*E\s*T\s*İ\s*M\b/i],
  ['toplam', /^T\s*O\s*P\s*L\s*A\s*M\b/i],
];

const num = (raw) => Number(String(raw).replace(/\./g, '').replace(',', '.'));

/**
 * @param {string} text pdftotext -table output
 * @returns {{levels: Record<string, {tercihYapan: number, kontenjan: number, yerlesen: number, bos: number}>}}
 */
export function parseSummaryText(text) {
  const levels = {};
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const flat = line.replace(/\f/g, '').trim();
    if (!flat) continue;
    const key = LEVELS.find(([, re]) => re.test(flat));
    if (!key) continue;
    const numbers = flat.match(/\d{1,3}(?:\.\d{3})+|\d+/g);
    if (!numbers || numbers.length < 4) continue;
    const [tercihYapan, kontenjan, yerlesen, bos] = numbers.slice(-4).map(num);
    levels[key[0]] = { tercihYapan, kontenjan, yerlesen, bos };
  }
  return { levels };
}
