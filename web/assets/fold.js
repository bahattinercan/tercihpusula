// Türkçe katlama: arama ve dizin anahtarları aksan/büyüklükten bağımsız olmalı.
// `hemsire` → HEMŞİRE, `muhendis` → MÜHENDİS, `saglik` → SAĞLIK MEMURU bulmanın tek yolu.
// Sıra önemli: önce Türkçe locale ile küçült (İ → i), sonra birleşik aksanları ayır ve at,
// en son noktasız ı'yı i'ye çevir (NFD'nin çözmediği tek harf).
export function foldTr(value) {
  return String(value ?? '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('ı', 'i');
}
