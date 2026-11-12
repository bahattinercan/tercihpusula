const stamp = () => new Date().toISOString().slice(11, 19);

// ÖSYM belgelerinden gelen metin doğrudan stderr'e yazılıyor. Bir PDF/HTML içine
// gömülü ANSI/OSC dizisi terminali temizleyip gerçek çıktıyı gizleyebilir
// (ör. düşen bir kapıyı "geçti" gibi göstermek), bu yüzden kontrol karakterleri
// yazımdan önce atılır. Sekme ve satır sonu korunur.
const clean = (value) =>
  String(value)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');

export const log = (...args) => process.stderr.write(`[${stamp()}] ${args.map(clean).join(' ')}\n`);
export const fail = (message) => {
  process.stderr.write(`\n✗ ${clean(message)}\n`);
  process.exitCode = 1;
  throw new Error(message);
};
