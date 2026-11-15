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

## 5. Yayına alma

İki hedef var, ikisi de aynı `dist/` çıktısını kullanır.

**GitHub Pages (şu an canlı):** `master`'a push yeterli — `.github/workflows/pages.yml` build alır,
`npm test` koşar ve yayınlar: https://bahattinercan.github.io/tercihpusula/

```bash
git push origin master
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

- Proje sitesi `/tercihpusula/` altından servis edildiği için workflow build'i `TP_BASE` ile üretir;
  yerelde aynı çıktıyı denemek için: `MSYS_NO_PATHCONV=1 TP_BASE=/tercihpusula node web/build.mjs`
  ve duman testi `MSYS_NO_PATHCONV=1 TP_SMOKE_BASE=/tercihpusula npm run smoke`.
- GitHub Pages `dist/_headers` dosyasını okumaz; CSP `TP_META_CSP=1` ile `<meta>` olarak gömülür
  (`frame-ancestors` meta ile ifade edilemez, o direktif platform işi olarak kalır).

**Cloudflare Pages (kök alan adı):**

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

## 7b. Kurum alımlarını (merkezî olmayan dönemleri) ekleme

ÖSYM menüsünde 100'den fazla dönem var: `2025/5` Sağlık Bakanlığı, `2025/3` Çevre ve
Şehircilik, `2024/6` MEB gibi sözleşmeli personel yerleştirmeleri. Bunlar merkezî yerleştirme
değildir, bu yüzden ana uygulamanın geçmişine karışmaz (`meta.json` → `channel: kurum`);
`/kurum-alimlari.html` sayfasında unvan bazında kapanış puanı olarak listelenir.

```bash
node pipeline/run.mjs fetch  --all --only=2025/5,2025/4   # PDF'ler data/raw/<dönem>/
node pipeline/run.mjs parse  --all --only=2025/5,2025/4   # JSON'lar data/rounds/<dönem>/
npm run build                                            # /kurum-alimlari.html + data/kurum.json
npm run gate
```

Notlar:

- `--all` şart: varsayılan yalnız `Bazı Kamu Kurum ve Kuruluşlar` (merkezî) dönemlerini seçer.
- Kılavuz (nitelik tabloları) bu dönemlerin çoğunda yok; `parse` yalnız sonuç belgesini okur,
  uygunluk motoru bu dönemler için çalışmaz — kapanış puanı ve kontenjan gösterilir.
- Dönem başına ~0,6 MB JSON eklenir (3 düzey). Havuzu şişirmemek için kanal başına son 2 dönem
  tutulur; daha eskisini eklerken `data/rounds/` altındakini silmek yeterlidir.
- Sayı doğrulaması: `data/rounds/<dönem>/summary.json` (resmî "Sayısal Bilgiler") ile
  `meta.json` toplamları eşleşmeli; `tests/kurum-summary.test.mjs` bunu kilitler.
4. Boş kalan kadrolar sayfası yeni dönemin fırsatlarını gösterir.

## 8. Masaüstü sürümü (Windows uygulaması)

Web yayınından sonra, aynı veriyle taşınabilir exe'yi üret:

```bash
npm run desktop:build     # dist.zip → ikon → dotnet publish → build/desktop + zip
npm run desktop:check     # 14 kontrollük kabuk doğrulaması (çıkış 0/1)
```

Beklenen: `build/desktop/TercihPusula.exe` (~2,2 MB) ve `build/TercihPusula-win-x64-<dönem>.zip`
(~1,3 MB). Zip'i paylaş; kurulum adımı yok, .NET 11 Desktop Runtime ve WebView2 gerekir
(Windows 10/11'de WebView2 hazır gelir).

Kapı düşerse:

| Belirti | İlk bakılacak |
|---|---|
| `page-load` / `data-fetch` düşük | `dist/data/*.json` gömülü mü (`desktop:build` `dist.zip` üretti mi) |
| `dir-redirect` düşük | `/kadrolar/` → `index.html` yönlendirmesi (`Shell.OnNavigationStarting`) |
| `page-timings` 800 ms üstü | yerel sunucu (`LoopbackServer`) veya sayfaya eklenen yeni bir bağımlılık |
| `shell-budget` 5000 ms üstü | soğuk açılış makine yavaşlığı; `--self-check` raporundaki `kabuk` ve `ilk boyama` süreleri |
| `list-persist` düşük | WebView2 profili (`%LOCALAPPDATA%\TercihPusula\WebView2`) bozulmuş olabilir, sil |

Veri güncellemesini exe yayımlamadan yapmak için: `npm run build` çıktısını (`dist/` içeriği)
exe yanına `data-override\` olarak kopyala. Ayrıntı: [`docs/desktop-app.md`](docs/desktop-app.md).

## 9. Bilinen tuzaklar

- `dokuman.osym.gov.tr` düz isteğe **HTTP 200 + "Erişim Engellendi"** döner; referer ve
  `%PDF` sihirli bayt kontrolü olmadan indirme "başarılı" görünür.
- Dosya adları dönemden döneme değişir: 2026/1 `…puanlar-lsans-<hash>.pdf`,
  2025/2 `…/TERCIH2/minmaxlisans<date>.pdf`. Hash tahmin edilemez.
- `pdftotext -layout` bu tablolarda veri kaybettirir; **`-table`** kullanılır.
- Ön lisans sonuç dosyalarında teşkilat bileşeni `DÖNER SERMAYE` olabilir; `MERKEZ/TAŞRA`
  dışındaki değerler il sanılırsa il/ilçe kayması olur.
- Tablo PDF'inde uzun kurum adları alt satıra taşar; kurum metni %30–60 doğrulukla okunur,
  bu yüzden geçmiş dönem kaydıyla tamamlanır. Satır kimliği her zaman kadro kodudur.
- WebView2 sanal host'u **dizin URL'sini çözmez**: `https://tercihpusula.local/kadrolar/`
  "navigation failed" ile düşer. Kabuk bunu çalışma anında `index.html`'e yönlendirir;
  bu yüzden web çıktısındaki `href="/kadrolar/"` bağlantıları değiştirilmez.
- Masaüstü kabuğunun kaynak adı (`DistBundle.Host`) **sabittir**: değiştirilirse her kullanıcının
  kayıtlı tercih listesi sıfırlanır (localStorage origin'e bağlıdır).
