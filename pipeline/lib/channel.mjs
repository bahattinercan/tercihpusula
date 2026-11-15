// Kanal adı: dönem başlığından kurum adını çıkarır. Sayfada aynı kurumun farklı yıllardaki
// dönemleri tek başlık altında toplanmalı:
//   "KPSS-2025/5: Sağlık Bakanlığının Sözleşmeli Sağlık Personeli Pozisyonlarına Yerleştirme…"
//   "KPSS-2010/5: Sağlık Bakanlığı Sözleşmeli Pozisyonlarına Yerleştirme Sonuçlarına İlişkin…"
// → ikisi de "Sağlık Bakanlığı".
const CUT = /\s(?:nın|nin|nun|nün)\s|\sSözleşmeli\s|\sKadrolarına\s|\sPozisyonlarına\s|\sYerleştirme\s/i;
// Kalıp sözcüğünde kesilen ad iyelik ekiyle bitiyor ("… Bakanlığının"); onu da at.
const POSSESSIVE = /(nın|nin|nun|nün)$/i;

export function channelTitle(title) {
  const body = String(title ?? '').replace(/^KPSS-\d{4}\/\d+:?\s*/, '').trim();
  const cut = body.split(CUT)[0].trim() || body;
  return cut.replace(POSSESSIVE, '');
}
