# Runbook — yeni dönem yayına alma

Hedef: ÖSYM yeni tercih dönemini yayımladığı gün (ör. **KPSS-2026/2, 17 Aralık 2026**)
siteyi **6 saat içinde** yeni veriyle canlıya almak.

## 0. Ön koşullar

- `pdftotext` erişilebilir (`PDFTOTEXT_BIN` gerekirse).
- `data/reference/provinces.json` güncel (81 il).
- `data/reference/guide-docs.json` içinde yeni dönem yoksa 2. adımı uygula.

## 1. Dönemin yayımlandığını doğrula

```bash
node pipeline/run.mjs fetch --only=2026/2
```

Beklenen çıktı: dört sonuç belgesi (`lisans`, `onlisans`, `ortaogretim`, `summary`).
`no level documents found` derse dönem henüz yayımlanmamış ya da slug değişmiş demektir.

## 2. Kılavuz belgeleri (en sık takılan adım)

Kılavuz açılış sayfası yoğun otomatik istekte jenerik bir belge listesi döndürebiliyor
(gözlemlendi: 132 alakasız PDF). Sıra:

1. `fetch` çıktısında `guide: N documents` satırı varsa sorun yok.
2. Yoksa kılavuz sayfasını tarayıcıda aç, `tablo1/2/3`, `*-nitelik`, `*-programlar`,
   `ozelkosullar` dosyalarının adlarını al ve `data/reference/guide-docs.json`
   içine yeni dönem bloğu olarak ekle (`base` + dosya adları).
3. `fetch` tekrar çalıştır: `guide: landing page unusable, using the fallback document map`
   mesajı beklenen davranıştır.

## 3. Hattı çalıştır

```bash
node pipeline/run.mjs parse     # sonuç PDF'leri -> JSON
node pipeline/run.mjs guide     # nitelik/program/tablo -> uygunluk grafiği
node pipeline/run.mjs gate      # A/B/C/D/E/F kapıları
node pipeline/run.mjs backtest  # yeni dönem eklendiyse hata payı güncellenir
node pipeline/run.mjs predict   # en yeni dönem için tahminler
npm run build                   # dist/ (statik site)
npm run smoke                   # headless tarayıcı kontrolü
```

Tek komut: `npm run gate` (test + tüm hat + build + smoke).

## 4. Kapı düşerse

| Kapı | Anlamı | İlk bakılacak |
|---|---|---|
| A | Satır aritmetiği / resmî özet uyuşmazlığı | `data/rounds/<dönem>/summary.json` ile toplamlar |
| B | Şema: kod tekrarı, boş kurum/il, puan aralığı | parse çıktısındaki `rejectedLines` |
| C | Önceki döneme göre %30+ sıçrama | gerçek mi, parser kayması mı |
| D | Çapraz kaynak (kpssden) | eksik satır fail, fazla satır warn |
| E | Tablo ↔ sonuç kadro kümesi/kontenjan | `tablo=... sonuç=...` sayıları |
| F | Tablo alan doğruluğu | il/kontenjan %99,5 altındaysa **yayımlama** |

Kapı düşerse **veri yayımlanmaz**; `data/rounds/<dönem>` commit edilmez.

## 5. Yayına alma (Cloudflare Pages)

```bash
npx wrangler pages deploy dist --project-name tercihpusula
```

- Önce `--branch preview` ile dene, smoke'u preview URL'inde tekrarla.
- Prod deploy sonrası `sitemap.xml` ve `/uygulama.html` için cache purge.
- Rollback: Cloudflare panelinden önceki deployment'ı "Rollback" ile seç, ya da
  `git revert` + yeniden deploy. Site tamamen statik, veri kaybı riski yok.

## 6. Tercih penceresi boyunca (8 gün)

- Günlük: `npm run gate` yeşil mi, `dist/data/*.json` boyutu değişmiş mi.
- Kılavuzda düzeltme/ek ilan olursa: `fetch --only=<dönem>` + `parse` + `guide` + `gate` + `build`.
- Kullanıcı bildirimi gelirse: kadro kodu ile `data/rounds/<dönem>/<seviye>.json` içinde ara,
  hata parser kaynaklıysa `tests/` içine fixture ekle, sonra düzelt.

## 7. Sonuçlar açıklandıktan sonra

1. Sonuç dönemini `data/rounds/` altına ekle (aynı `fetch`/`parse`/`gate`).
2. `backtest` ve `predict` yeniden çalışır: hata payı yeni dönemle güncellenir.
3. `/metodoloji` sayfasındaki tablo kendiliğinden güncellenir (build çıktısı).
4. Boş kalan kadrolar sayfası yeni dönemin fırsatlarını gösterir.

## 8. Bilinen tuzaklar

- `dokuman.osym.gov.tr` düz isteğe **HTTP 200 + "Erişim Engellendi"** döner; referer ve
  `%PDF` sihirli bayt kontrolü olmadan indirme "başarılı" görünür.
- Dosya adları dönemden döneme değişir: 2026/1 `…puanlar-lsans-<hash>.pdf`,
  2025/2 `…/TERCIH2/minmaxlisans<date>.pdf`. Hash tahmin edilemez.
- `pdftotext -layout` bu tablolarda veri kaybettirir; **`-table`** kullanılır.
- Ön lisans sonuç dosyalarında teşkilat bileşeni `DÖNER SERMAYE` olabilir; `MERKEZ/TAŞRA`
  dışındaki değerler il sanılırsa il/ilçe kayması olur.
- Tablo PDF'inde uzun kurum adları alt satıra taşar; kurum metni %30–60 doğrulukla okunur,
  bu yüzden geçmiş dönem kaydıyla tamamlanır. Satır kimliği her zaman kadro kodudur.
