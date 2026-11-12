// Statik site üretici — bağımlılık yok, Astro yerine düz Node.
// Girdi: data/rounds/<son dönem>/{guide.json,predictions.json,<seviye>.json,summary.json}
//        data/rounds/backtest.json
// Çıktı: dist/ (HTML + JSON + assets), edge cache'e uygun tamamen statik.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(WEB);
const ROUNDS = join(ROOT, 'data', 'rounds');
const DIST = join(ROOT, 'dist');
const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
const LEVEL_LABEL = { lisans: 'Lisans (P3)', onlisans: 'Ön lisans (P93)', ortaogretim: 'Ortaöğretim (P94)' };

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const slugify = (text) =>
  text
    .toLocaleLowerCase('tr')
    .replaceAll('ı', 'i').replaceAll('ş', 's').replaceAll('ğ', 'g').replaceAll('ü', 'u')
    .replaceAll('ö', 'o').replaceAll('ç', 'c').replaceAll('â', 'a').replaceAll('î', 'i')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fmt = (value) => (value === null || value === undefined ? '—' : value.toFixed(3).replace('.', ','));

const NAV = [
  ['/uygulama.html', 'Uygulama'],
  ['/kadrolar/', 'Kadrolar'],
  ['/bos-kalan-kadrolar.html', 'Boş kalan kadrolar'],
  ['/metodoloji.html', 'Metodoloji'],
  ['/veri-kaynaklari.html', 'Veri ve kaynak'],
];

function layout({ title, description, current, body, round }) {
  return `<!doctype html>
<html lang="tr" data-style="telemetry-grid">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="preload" href="/assets/fonts/chakra-petch-600-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0a0f12" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#eef1f4" media="(prefers-color-scheme: light)">
</head>
<body>
<div class="shell">
<aside class="rail">
  <a class="brand" href="/"><span class="mark" aria-hidden="true">TP</span>Tercih Pusulası</a>
  <nav aria-label="Ana menü">
    ${NAV.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('\n    ')}
  </nav>
  <div class="rail-foot">
    <a class="mono" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none" href="/uygulama.html">→ Listeye gir</a>
    <span class="rail-meta">${round ? `KPSS ${escapeHtml(round)}` : 'veri yok'}</span>
  </div>
</aside>
<main class="main">
<div class="wrap">
${body}
<footer class="site-foot">
  <p><strong style="color:var(--ink)">Resmî kaynak değildir.</strong> Tercih Pusulası bağımsız bir karar destek aracıdır; ÖSYM ile bağlantılı değildir.
  Bağlayıcı olan, ilgili dönemin ÖSYM tercih kılavuzu ve <a href="https://ais.osym.gov.tr" rel="noopener">ais.osym.gov.tr</a>'dir.
  Tahminler geçmiş yerleşmelere dayanır, yerleşme garantisi vermez.</p>
  <p class="mono">${round ? `dönem ${escapeHtml(round)} · ` : ''}ölçüm: <a href="/metodoloji.html">metodoloji</a> · <a href="/veri-kaynaklari.html">veri ve kaynak</a></p>
</footer>
</div>
</main>
</div>
${current === '/uygulama.html' ? '<script src="/assets/app.js" defer></script>' : ''}
${body.includes('dizin-filter') ? '<script src="/assets/dizin.js" defer></script>' : ''}
</body>
</html>`;
}

function latestRound() {
  const keys = readdirSync(ROUNDS).filter((entry) => /^\d{4}-\d$/.test(entry)).sort();
  const key = keys.at(-1);
  if (!key) throw new Error('no parsed round found under data/rounds — run the pipeline first');
  return { key, round: key.replace('-', '/') };
}

function buildLevelData(key, level, guide, predictions, sigma, previousByKod) {
  const results = existsSync(join(ROUNDS, key, `${level}.json`)) ? readJson(join(ROUNDS, key, `${level}.json`)).rows : [];
  const levelGuide = guide.levels[level];
  if (!levelGuide) return null;
  const resultByKod = new Map(results.map((row) => [row.kod, row]));

  const programmeToNitelik = {};
  for (const entry of levelGuide.nitelik) {
    for (const kod of entry.programKodlari) {
      programmeToNitelik[kod] ??= [];
      programmeToNitelik[kod].push(entry.kod);
    }
  }

  // Yeni dönemde henüz sonuç dosyası olmaz: o zaman kadro bilgisi tablodan,
  // sarılmış hücreler yüzünden eksikse aynı kadro kodunun geçmiş dönem
  // kaydından tamamlanır. Kaynak her satırda işaretlenir.
  const rows = Object.entries(levelGuide.kadro).map(([kod, nit]) => {
    const result = resultByKod.get(kod);
    const detail = levelGuide.kadroDetay?.[kod] ?? {};
    const previous = previousByKod.get(kod);
    const pick = (field) => result?.[field] ?? previous?.[field] ?? detail[field] ?? null;
    return {
      kod,
      kurum: pick('kurum'),
      il: pick('il'),
      tes: result?.teskilat ?? previous?.teskilat ?? detail.teskilat ?? null,
      unvan: pick('unvan'),
      knt: result?.kontenjan ?? detail.kontenjan ?? null,
      nit,
      taban: result?.minPuan ?? null,
      bos: result ? result.yerlesen === 0 : false,
      tahmin: predictions.levels?.[level]?.[kod] ?? null,
      kaynak: result ? 'sonuc' : previous ? 'gecmis' : 'tablo',
    };
  });

  return {
    round: key.replace('-', '/'),
    level,
    sigma,
    programmes: levelGuide.programmes.map((p) => ({ k: p.kod, a: p.ad })),
    nitelik: Object.fromEntries(levelGuide.nitelik.map((n) => [n.kod, { t: n.tanim, k: n.kind, c: n.programKodlari }])),
    programNitelik: programmeToNitelik,
    rows,
  };
}

function writePage(path, html) {
  const file = join(DIST, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

function main() {
  const { key, round } = latestRound();
  const guide = readJson(join(ROUNDS, key, 'guide.json'));
  const predictions = existsSync(join(ROUNDS, key, 'predictions.json')) ? readJson(join(ROUNDS, key, 'predictions.json')) : { levels: {} };
  const backtest = existsSync(join(ROUNDS, 'backtest.json')) ? readJson(join(ROUNDS, 'backtest.json')) : null;
  const sigmaByLevel = backtest?.sigma ?? {};
  const summary = existsSync(join(ROUNDS, key, 'summary.json')) ? readJson(join(ROUNDS, key, 'summary.json')).levels : {};

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, 'data'), { recursive: true });
  cpSync(join(WEB, 'assets'), join(DIST, 'assets'), { recursive: true });

  const olderKeys = readdirSync(ROUNDS).filter((entry) => /^\d{4}-\d$/.test(entry) && entry < key).sort();
  const previousByLevel = {};
  for (const level of LEVELS) {
    const map = new Map();
    for (const older of olderKeys) {
      const file = join(ROUNDS, older, `${level}.json`);
      if (!existsSync(file)) continue;
      for (const row of readJson(file).rows) map.set(row.kod, row);
    }
    previousByLevel[level] = map;
  }

  const levels = {};
  for (const level of LEVELS) {
    const data = buildLevelData(key, level, guide, predictions, sigmaByLevel[level] ?? 6, previousByLevel[level]);
    if (!data) continue;
    levels[level] = data;
    writeFileSync(join(DIST, 'data', `${level}.json`), JSON.stringify(data));
  }

  const totals = Object.values(levels).reduce(
    (acc, data) => ({
      rows: acc.rows + data.rows.length,
      kontenjan: acc.kontenjan + data.rows.reduce((sum, row) => sum + (row.knt ?? 0), 0),
      empty: acc.empty + data.rows.filter((row) => row.bos).length,
    }),
    { rows: 0, kontenjan: 0, empty: 0 },
  );

  const backtestRows = (backtest?.summary ?? [])
    .map(
      (entry) => `<tr><td>${LEVEL_LABEL[entry.level]}</td><td class="num">${entry.compared}</td>
      <td class="num">${entry.mae?.toFixed(2) ?? '—'}</td><td class="num">±${(backtest.sigma[entry.level] ?? 0).toFixed(2)}</td>
      <td class="num">${entry.coverage ? `%${Math.round(entry.coverage * 100)}` : '—'}</td></tr>`,
    )
    .join('');

  // ---- ana sayfa
  writePage(
    'index.html',
    layout({
      title: 'Tercih Pusulası — KPSS tercih listesi karar desteği',
      description:
        'KPSS merkezî yerleştirme için yazılabilir kadroları gör, 30 tercihli listeyi kur, tahmini taban puan ve yerleşme olasılığıyla riskini ölç.',
      current: '/',
      round,
      body: `<p class="kicker">KPSS ${escapeHtml(round)} · ${totals.rows} kadro satırı · ${totals.kontenjan} kontenjan</p>
<h1>Puanını değil,<br>listeyi planla.</h1>
<p class="lede">KPSS tercihinde hata puan hesabında değil, listeyi kurarken çıkıyor: mezuniyetinize kapalı bir kadroyu yazmak, 30. sıradaki “garanti” satırla puanınızı yakmak, geçen dönem boş kalan kadroyu hiç görmemek.</p>
<div class="tiles">
  <div class="tile"><span class="label">kadro satırı</span><span class="value">${totals.rows}</span><span class="unit">3 seviye</span></div>
  <div class="tile"><span class="label">kontenjan</span><span class="value">${totals.kontenjan}</span><span class="unit">toplam adet</span></div>
  <div class="tile"><span class="label">boş kalan</span><span class="value">${totals.empty}</span><span class="unit">geçen dönem</span></div>
  <div class="tile muted"><span class="label">program / alan</span><span class="value">${Object.values(levels).reduce((sum, d) => sum + d.programmes.length, 0)}</span><span class="unit">eşleşme sözlüğü</span></div>
</div>
<h2>Ne yapıyor</h2>
<div class="tiles">
  <div class="tile"><span class="label">01 · uygunluk</span><h3 style="margin:4px 0 0">Yazılabilir satırları ayıklar</h3><p>Kılavuzun nitelik kodları ile mezun olduğunuz programı eşleştirir. Sertifika ve özel şart içeren satırlar “kontrol et” olarak işaretlenir, sessizce geçmez.</p></div>
  <div class="tile"><span class="label">02 · tahmin</span><h3 style="margin:4px 0 0">Satır bazında kapanış puanı</h3><p>Geçen dönemlerin gerçek taban puanlarından hareketle tahmini kapanış puanı ve ± aralığı. Hata payı <a href="/metodoloji.html">metodoloji</a> sayfasında yayımlanır.</p></div>
  <div class="tile"><span class="label">03 · liste</span><h3 style="margin:4px 0 0">30 tercihli listeyi kurar</h3><p>Sıralama, paylaşılabilir bağlantı ve liste düzeyinde yerleşme olasılığı. Liste tarayıcınızda kalır.</p></div>
  <div class="tile"><span class="label">04 · fırsat</span><h3 style="margin:4px 0 0">Boş kalan kadroları gösterir</h3><p>Geçen dönem kimsenin yerleşmediği ${totals.empty} satır. Bu dönemin en yüksek fırsat adayları.</p></div>
</div>
<h2>Başla</h2>
<p style="display:flex;flex-wrap:wrap;gap:8px;margin-block:16px 24px">
  <a class="btn" href="/uygulama.html">Tercih listesi kur →</a>
  <a class="btn ghost" href="/bos-kalan-kadrolar.html">Boş kalan kadrolar</a>
  <a class="btn ghost" href="/kadrolar/">Kadro dizini</a>
</p>
<div class="note"><strong>Uyarı:</strong> Bu araç resmî değildir ve yerleşme garantisi vermez. Tahminlerin hata payı <a href="/metodoloji.html">metodoloji</a> sayfasında açıkça yayımlanır. Bağlayıcı kaynak ÖSYM tercih kılavuzudur.</div>
`,
    }),
  );

  // ---- uygulama
  writePage(
    'uygulama.html',
    layout({
      title: 'Tercih listesi kur — Tercih Pusulası',
      description: 'Puanınızı ve mezuniyet programınızı girin; yazılabilir kadroları filtreleyin, 30 tercihli listeyi kurun.',
      current: '/uygulama.html',
      round,
      body: `<p class="kicker">KPSS <span id="round">${escapeHtml(round)}</span> · merkezî yerleştirme</p>
<h1>Tercih listesi</h1>
<p class="lede">Puan → program → filtre → liste. Liste tarayıcınızda saklanır, sunucuya gönderilmez.</p>
<div id="error" class="note" hidden></div>
<form class="filters" onsubmit="return false">
  <div class="full"><label for="program">mezun olduğunuz program</label>
    <select id="program"></select>
    <div id="programNote" class="hint" style="margin-top:4px"></div></div>
  <div><label for="level">öğrenim düzeyi</label>
    <select id="level"><option value="lisans">${LEVEL_LABEL.lisans}</option><option value="onlisans">${LEVEL_LABEL.onlisans}</option><option value="ortaogretim">${LEVEL_LABEL.ortaogretim}</option></select></div>
  <div><label for="puan">KPSS puanı</label>
    <input id="puan" type="number" inputmode="decimal" step="0.00001" min="40" max="100" placeholder="82,45678"></div>
  <div><label for="il">il</label><select id="il"></select></div>
  <div><label for="unvan">unvan</label><select id="unvan"></select></div>
  <div><label for="kurum">kurum</label><select id="kurum"></select></div>
</form>
<div class="toolbar">
  <label><input type="checkbox" id="onlyWritable" checked> sadece yazabileceklerim</label>
  <label><input type="checkbox" id="onlyEmpty"> geçen dönem boş kalanlar</label>
  <input id="query" type="search" placeholder="kurum, unvan, il veya kadro kodu ara" style="max-width:20rem">
  <span class="count" id="count"></span>
</div>
<div class="grid-2">
  <div class="table-wrap">
    <table>
      <thead><tr><th>kadro</th><th class="num">kont.</th><th class="num">geçen taban</th><th class="num">tahmin</th><th>durum</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <aside class="card">
    <div class="panel-title"><h3>Tercih listem</h3><span class="stamp" id="listMeta"></span></div>
    <ul class="list" id="list"></ul>
    <div class="metric"><span class="value" id="probabilityValue"></span><span class="label">yerleşme olasılığı</span></div>
    <p id="probability" class="count" style="min-height:1.3em"></p>
    <div style="display:flex;gap:8px;margin-block:12px">
      <button class="ghost small" id="clear" type="button">listeyi temizle</button>
      <button class="ghost small" type="button" onclick="window.print()">yazdır</button>
    </div>
    <label for="share">paylaşılabilir bağlantı</label>
    <input id="share" type="text" readonly onclick="this.select()">
    <p style="font-size:12px;margin-top:8px">Sıralama listeyi yukarıdan aşağıya okur; en çok istediğinizi 1. sıraya yazmanın riski yoktur. Olasılık satır olasılıklarının birleşimidir ve tahmindir.</p>
  </aside>
</div>`,

    }),
  );

  const gateReport = existsSync(join(ROUNDS, 'gate-report.json')) ? readJson(join(ROUNDS, 'gate-report.json')) : [];
  const gateFRows = ['lisans', 'onlisans', 'ortaogretim']
    .map((level) => {
      const entry = gateReport.find((r) => r.name === 'F' && r.level === level);
      if (!entry?.rates) return '';
      const pct = (value) => (value === null || value === undefined ? '—' : `%${(value * 100).toFixed(1)}`);
      return `<tr><td>${LEVEL_LABEL[level]}</td><td class="num">${pct(entry.rates.il)}</td><td class="num">${pct(entry.rates.kontenjan)}</td><td class="num">${pct(entry.rates.unvan)}</td><td class="num">${pct(entry.rates.kurum)}</td></tr>`;
    })
    .join('');

  // ---- metodoloji
  writePage(
    'metodoloji.html',
    layout({
      title: 'Metodoloji ve hata payı — Tercih Pusulası',
      description: 'Tahmini taban puan nasıl hesaplanır, geçmiş dönemlerde ne kadar hata yaptı, bantlar ne anlama gelir.',
      current: '/metodoloji.html',
      round,
      body: `<h1>Metodoloji</h1>
<p class="lede">Bu sayfa, üründeki her sayının nereden geldiğini ve ne kadar yanılabileceğini açıklar. Gizli model yok.</p>
<h2>Tahmini taban puan</h2>
<p>Bir kadro satırı için sırayla şu üç çapa denenir: <strong>(1)</strong> aynı unvan + aynı ildeki satırların geçen dönem taban puanlarının ortancası, <strong>(2)</strong> aynı kadro kodunun geçen dönem taban puanı, <strong>(3)</strong> aynı unvanın ülke genelindeki ortancası. Bulunan değer, kontenjan değişimine göre küçük bir düzeltme alır (kontenjan artarsa kapanış puanı aşağı).</p>
<p>Çapa sırası tahmin değil, ölçüm sonucudur: iki dönem çifti üzerinde yapılan geri testte “aynı unvan + il” çapası, “aynı kadro kodu” çapasından daha düşük hata verdi (aynı kadro kodu yeniden ilan edildiğinde nitelikleri ve dolayısıyla aday havuzu değişebiliyor).</p>
<h2>Bantlar</h2>
<table class="table-wrap"><thead><tr><th>Bant</th><th>Anlamı</th></tr></thead><tbody>
<tr><td><span class="chip garanti">garanti</span></td><td>Puanınız tahminin üst sınırının üzerinde.</td></tr>
<tr><td><span class="chip hedef">hedef</span></td><td>Puanınız tahminin üzerinde ama aralığın içinde.</td></tr>
<tr><td><span class="chip riskli">riskli</span></td><td>Puanınız tahminin altında, aralığın içinde.</td></tr>
<tr><td><span class="chip uzak">uzak</span></td><td>Puanınız tahminin alt sınırının altında.</td></tr>
</tbody></table>
<h2>Geri test (yayımlanmış hata)</h2>
<p>Aynı yöntemle geçmiş dönemler tahmin edilip gerçekleşen taban puanlarla karşılaştırıldı. Ölçü: ortalama mutlak hata (puan) ve ± aralığın isabet oranı.</p>
<div class="table-wrap"><table><thead><tr><th>Düzey</th><th class="num">Karşılaştırma</th><th class="num">Ortalama hata</th><th class="num">Aralık</th><th class="num">Aralık isabeti</th></tr></thead><tbody>${backtestRows || '<tr><td colspan="5">Geri test verisi yok.</td></tr>'}</tbody></table></div>
<p style="font-size:.9rem;color:var(--ink-muted)">Aralık isabeti, gerçekleşen taban puanın ± aralık içinde kalma oranıdır. Bantlar bu aralıktan türetilir; yani “garanti” etiketi %100 değil, aralık dışına taşma olasılığının düşük olduğu anlamına gelir.</p>
<h2>Yerleşme olasılığı</h2>
<p>Satır olasılığı, puanınızın tahmin etrafındaki dağılımda nerede durduğuna bağlı lojistik bir eğridir. Liste olasılığı, satırların bağımsız olmadığı varsayımıyla <code>1 − Π(1 − pᵢ)</code> olarak birleştirilir; bu üst sınır eğilimli bir yaklaşımdır ve tercih sırasını hesaba katmaz. Bu yüzden ekranda “≈” ile gösterilir.</p>
<h2>Veri kalitesi (tablo ↔ sonuç)</h2>
<p>Kadro tablosu PDF'inde uzun hücreler alt satıra taşıyor. Aynı dönemin sonuç belgeleriyle karşılaştırıldığında alan bazında eşleşme oranı şöyle:</p>
<div class="table-wrap"><table><thead><tr><th>Düzey</th><th class="num">İl</th><th class="num">Kontenjan</th><th class="num">Unvan</th><th class="num">Kurum</th></tr></thead><tbody>${gateFRows}</tbody></table></div>
<p style="font-size:.9rem;color:var(--ink-muted)">İl ve kontenjan kimlik taşıdığı için %99,5 altına düşerse veri yayımlanmaz; unvan ve kurum metni ise taşan hücrelerden etkilenir ve geçmiş dönem kaydıyla tamamlanır. Satır kimliği her zaman ÖSYM kadro kodudur.</p>
<h2>Yazılabilirlik</h2>
<p>Kılavuzun nitelik kodları, mezun olunan programla eşleştirilir. Sertifika, ehliyet veya “Bakınız Başvurma Özel Şartları” içeren kodlar otomatik olarak geçmiş sayılmaz; satır “kontrol et” etiketiyle gösterilir. Nihai doğrulama her zaman ÖSYM tercih ekranında ve kılavuzda yapılmalıdır.</p>`,
    }),
  );

  // ---- veri kaynakları
  writePage(
    'veri-kaynaklari.html',
    layout({
      title: 'Veri kaynakları — Tercih Pusulası',
      description: 'Kadro tabloları, taban puanlar ve nitelik kodları hangi ÖSYM belgelerinden üretildi.',
      current: '/veri-kaynaklari.html',
      round,
      body: `<h1>Veri ve kaynak</h1>
<p class="lede">Tüm sayılar ÖSYM'nin kamuya açık belgelerinden üretilir; her dönem değişmez bir anlık görüntü olarak saklanır.</p>
<div class="table-wrap"><table><thead><tr><th>Veri</th><th>Kaynak</th></tr></thead><tbody>
<tr><td>Kadro tabloları ve aranan nitelik kodları</td><td>ÖSYM tercih kılavuzu Tablo-1/2/3</td></tr>
<tr><td>Nitelik kodu sözlüğü</td><td>ÖSYM nitelik kodları ekleri (düzey başına ayrı dosya)</td></tr>
<tr><td>Mezun olunan program / alan listesi</td><td>ÖSYM mezun olunan alan listeleri</td></tr>
<tr><td>Gerçekleşen en küçük–en büyük puanlar</td><td>ÖSYM yerleştirme sonuçları (düzey başına ayrı dosya)</td></tr>
<tr><td>Kontenjan / yerleşen / boş toplamları</td><td>ÖSYM “Yerleştirme Sonuçlarına İlişkin Sayısal Bilgiler”</td></tr>
<tr><td>Çapraz doğrulama</td><td>kpssden.com açık veri seti (CC BY 4.0)</td></tr>
</tbody></table></div>
<h2>Veri kapıları</h2>
<p>Yayımlanan her dönem şu kapılardan geçer: <strong>A)</strong> satır toplamları ÖSYM'nin kendi özet sayılarıyla birebir eşleşmeli, <strong>B)</strong> şema ve aralık kontrolleri, <strong>C)</strong> önceki döneme göre ani sıçrama uyarısı, <strong>D)</strong> bağımsız veri setiyle satır satır karşılaştırma, <strong>E)</strong> kadro tablosu ile sonuç belgelerinin aynı kadro kümesini ve aynı kontenjan toplamını vermesi. Kapılardan biri düşerse veri yayımlanmaz.</p>
<h2>Kişisel veri</h2>
<p>Bu sürümde hesap yoktur: girdiğiniz puan, program ve liste yalnızca tarayıcınızda (<code>localStorage</code>) tutulur, sunucuya gönderilmez. Bağlantı paylaştığınızda liste URL'in içinde taşınır.</p>
<h2>Atıf</h2>
<p>Veri ÖSYM'nin kamuya açık belgelerinden türetilmiştir. Çapraz doğrulama için kpssden.com veri seti (CC BY 4.0) kullanılmıştır: “KPSSDEN (kpssden.com), ÖSYM verilerinden derlenmiştir.”</p>`,
    }),
  );

  // ---- boş kalan kadrolar
  const emptyRows = Object.values(levels).flatMap((data) =>
    data.rows.filter((row) => row.bos).map((row) => ({ ...row, level: data.level })),
  );
  writePage(
    'bos-kalan-kadrolar.html',
    layout({
      title: 'Geçen dönem boş kalan kadrolar — Tercih Pusulası',
      description: 'KPSS son yerleştirmede kimsenin yerleşmediği kadro satırları: bu dönemin en yüksek fırsat adayları.',
      current: '/bos-kalan-kadrolar.html',
      round,
      body: `<h1>Boş kalan kadrolar</h1>
<p class="lede">${escapeHtml(round)} yerleştirmesinde kontenjanı dolmayan ${emptyRows.length} satır. Boş kalması “kolay kapanır” demek değildir; ama adayların bu satırları hiç görmediğinin en somut kanıtıdır.</p>
${
  emptyRows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Düzey</th><th>Unvan</th><th>Kurum</th><th>İl</th><th class="num">Kont.</th></tr></thead><tbody>${emptyRows
        .map(
          (row) =>
            `<tr><td>${LEVEL_LABEL[row.level]}</td><td>${escapeHtml(row.unvan)}</td><td>${escapeHtml(row.kurum)}</td><td>${escapeHtml(row.il)}</td><td class="num">${row.knt}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p>Bu dönemde boş kalan satır yok.</p>'
}`,
    }),
  );

  // ---- SEO: unvan ve il sayfaları
  const groupStats = (rows) => {
    const tabans = rows.map((row) => row.taban).filter((value) => value !== null && value !== undefined);
    return {
      rows: rows.length,
      kontenjan: rows.reduce((sum, row) => sum + (row.knt ?? 0), 0),
      bos: rows.filter((row) => row.bos).length,
      minTaban: tabans.length ? Math.min(...tabans) : null,
      maxTaban: tabans.length ? Math.max(...tabans) : null,
    };
  };
  const rangeText = (stats) => (stats.minTaban === null ? '—' : `${fmt(stats.minTaban)} – ${fmt(stats.maxTaban)}`);
  // dar sütunlar için tek ondalıklı kısa aralık
  const rangeShort = (stats) =>
    stats.minTaban === null
      ? '—'
      : `${stats.minTaban.toFixed(1).replace('.', ',')} – ${stats.maxTaban.toFixed(1).replace('.', ',')}`;

  const statTiles = (stats, extra = '') => `<div class="tiles">
  <div class="tile"><span class="label">kadro satırı</span><span class="value">${stats.rows}</span><span class="unit">bu grupta</span></div>
  <div class="tile"><span class="label">kontenjan</span><span class="value">${stats.kontenjan}</span><span class="unit">toplam adet</span></div>
  <div class="tile"><span class="label">taban puan</span><span class="value" style="font-size:20px">${rangeText(stats)}</span><span class="unit">geçen dönem aralığı</span></div>
  <div class="tile muted"><span class="label">boş kalan</span><span class="value">${stats.bos}</span><span class="unit">${extra || 'satır'}</span></div>
</div>`;

  const unvanIndex = new Map();
  const ilIndex = new Map();
  for (const data of Object.values(levels)) {
    for (const row of data.rows) {
      if (!row.unvan || !row.il) continue;
      if (!unvanIndex.has(row.unvan)) unvanIndex.set(row.unvan, []);
      unvanIndex.get(row.unvan).push({ ...row, level: data.level });
      if (!ilIndex.has(row.il)) ilIndex.set(row.il, []);
      ilIndex.get(row.il).push({ ...row, level: data.level });
    }
  }

  const renderRowTable = (rows, withLevel = true) =>
    `<div class="table-wrap"><table><thead><tr>${withLevel ? '<th>düzey</th>' : ''}<th>unvan</th><th>kurum</th><th>il</th><th class="num">kont.</th><th class="num">geçen taban</th><th class="num">tahmin</th></tr></thead><tbody>${rows
      .slice(0, 300)
      .map(
        (row) =>
          `<tr>${withLevel ? `<td class="mono" style="font-size:11px;letter-spacing:.06em;color:var(--ink-soft)">${row.level.slice(0, 3)}</td>` : ''}<td><strong>${escapeHtml(row.unvan)}</strong></td><td><div class="sub">${escapeHtml(row.kurum)}</div></td><td>${escapeHtml(row.il)}</td><td class="num">${row.knt ?? '—'}</td><td class="num dim">${fmt(row.taban)}</td><td class="num">${fmt(row.tahmin?.puan)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;

  const unvanLinks = [];
  for (const [unvan, rows] of unvanIndex) {
    const slug = `unvan-${slugify(unvan)}`;
    const stats = groupStats(rows);
    unvanLinks.push({ href: `/kadrolar/${slug}.html`, label: unvan, stats });
    const sorted = [...rows].sort((a, b) => (a.taban ?? 101) - (b.taban ?? 101));
    const byIl = new Map();
    for (const row of rows) {
      if (!byIl.has(row.il)) byIl.set(row.il, []);
      byIl.get(row.il).push(row);
    }
    const ilRows = [...byIl]
      .map(([il, group]) => ({ il, stats: groupStats(group) }))
      .sort((a, b) => b.stats.kontenjan - a.stats.kontenjan)
      .slice(0, 12);
    writePage(
      `kadrolar/${slug}.html`,
      layout({
        title: `${unvan} kadroları, taban puanlar ve kontenjan — Tercih Pusulası`,
        description: `${unvan} unvanıyla açılan ${stats.rows} kadro satırı: kurum, il, kontenjan, geçen dönem taban puanı ve tahmini kapanış puanı.`,
        current: '/kadrolar/',
        round,
        body: `<p class="kicker">kadro dizini · unvan</p>
<h1>${escapeHtml(unvan)}</h1>
<p class="lede">KPSS ${escapeHtml(round)} döneminde bu unvanla ${stats.rows} satır açıldı; toplam kontenjan ${stats.kontenjan}. Taban puan aralığı ${rangeText(stats)}.</p>
${statTiles(stats)}
<p style="margin-block:16px 8px"><a class="btn" href="/uygulama.html?unvan=${encodeURIComponent(unvan)}">Bu unvanı uygulamada filtrele →</a></p>
<h2>İl dağılımı</h2>
<div class="table-wrap"><table><thead><tr><th>il</th><th class="num">satır</th><th class="num">kontenjan</th><th class="num">taban aralığı</th><th class="num">boş</th></tr></thead><tbody>${ilRows
          .map(
            (entry) =>
              `<tr><td><a href="/kadrolar/il-${slugify(entry.il)}.html">${escapeHtml(entry.il)}</a></td><td class="num">${entry.stats.rows}</td><td class="num">${entry.stats.kontenjan}</td><td class="num dim">${rangeShort(entry.stats)}</td><td class="num">${entry.stats.bos}</td></tr>`,
          )
          .join('')}</tbody></table></div>
<h2>Satırlar</h2>
<p class="count" style="margin-block-end:8px">geçen dönem taban puanına göre artan</p>
${renderRowTable(sorted)}`,
      }),
    );
  }

  const ilLinks = [];
  for (const [il, rows] of ilIndex) {
    const slug = `il-${slugify(il)}`;
    const stats = groupStats(rows);
    ilLinks.push({ href: `/kadrolar/${slug}.html`, label: il, stats });
    const sorted = [...rows].sort((a, b) => (a.taban ?? 101) - (b.taban ?? 101));
    writePage(
      `kadrolar/${slug}.html`,
      layout({
        title: `${il} KPSS kadroları ve taban puanlar — Tercih Pusulası`,
        description: `${il} ilinde ${escapeHtml(round)} döneminde açılan ${stats.rows} kadro: kurum, unvan, kontenjan ve taban puanlar.`,
        current: '/kadrolar/',
        round,
        body: `<p class="kicker">kadro dizini · il</p>
<h1>${escapeHtml(il)}</h1>
<p class="lede">${il} ilinde açılan ${stats.rows} satır; toplam kontenjan ${stats.kontenjan}. Taban puan aralığı ${rangeText(stats)}.</p>
${statTiles(stats)}
<p style="margin-block:16px 8px"><a class="btn" href="/uygulama.html?il=${encodeURIComponent(il)}">Bu ili uygulamada filtrele →</a></p>
<h2>Satırlar</h2>
<p class="count" style="margin-block-end:8px">geçen dönem taban puanına göre artan</p>
${renderRowTable(sorted)}`,
      }),
    );
  }

  const totalUnvanRows = unvanLinks.reduce((sum, link) => sum + link.stats.rows, 0);
  const indexRows = (links) =>
    links
      .map(
        (link) =>
          `<tr data-name="${escapeHtml(link.label)}"><td><a href="${link.href}">${escapeHtml(link.label)}</a></td><td class="num">${link.stats.rows}</td><td class="num">${link.stats.kontenjan}</td><td class="num dim">${rangeShort(link.stats)}</td><td class="num">${link.stats.bos}</td></tr>`,
      )
      .join('');

  writePage(
    'kadrolar/index.html',
    layout({
      title: 'Kadrolar: unvan ve il dizini — Tercih Pusulası',
      description: 'Unvan ve il bazında KPSS kadro listeleri, kontenjanlar, taban puanlar ve boş kalan kadrolar.',
      current: '/kadrolar/',
      round,
      body: `<p class="kicker">KPSS ${escapeHtml(round)} · kadro dizini</p>
<h1>Kadro dizini</h1>
<p class="lede">${unvanLinks.length} unvan ve ${ilLinks.length} il. Her satır bir grubun toplam kontenjanını, geçen dönem taban puanı aralığını ve boş kalan kadro sayısını taşır.</p>
<div class="tiles">
  <div class="tile"><span class="label">unvan</span><span class="value">${unvanLinks.length}</span><span class="unit">grup</span></div>
  <div class="tile"><span class="label">il</span><span class="value">${ilLinks.length}</span><span class="unit">grup</span></div>
  <div class="tile"><span class="label">kadro satırı</span><span class="value">${totalUnvanRows}</span><span class="unit">3 seviye</span></div>
  <div class="tile muted"><span class="label">kontenjan</span><span class="value">${totals.kontenjan}</span><span class="unit">toplam adet</span></div>
</div>
<div class="dizin-grid">
  <section class="card">
    <div class="panel-title"><h3>Unvana göre</h3><span class="stamp" id="unvan-count">${unvanLinks.length}</span></div>
    <label for="unvan-filter">unvan ara</label>
    <input id="unvan-filter" class="dizin-filter" data-target="unvan-rows" data-count="unvan-count" type="search" placeholder="ör. tekniker, memur, mühendis">
    <div class="table-wrap" style="margin-block-start:12px;border:0">
      <table><thead><tr><th>unvan</th><th class="num">satır</th><th class="num">kont.</th><th class="num">taban aralığı</th><th class="num">boş</th></tr></thead>
      <tbody id="unvan-rows">${indexRows([...unvanLinks].sort((a, b) => b.stats.rows - a.stats.rows))}</tbody></table>
    </div>
  </section>
  <section class="card">
    <div class="panel-title"><h3>İle göre</h3><span class="stamp" id="il-count">${ilLinks.length}</span></div>
    <label for="il-filter">il ara</label>
    <input id="il-filter" class="dizin-filter" data-target="il-rows" data-count="il-count" type="search" placeholder="ör. ankara, istanbul, izmir">
    <div class="table-wrap" style="margin-block-start:12px;border:0">
      <table><thead><tr><th>il</th><th class="num">satır</th><th class="num">kont.</th><th class="num">taban aralığı</th><th class="num">boş</th></tr></thead>
      <tbody id="il-rows">${indexRows([...ilLinks].sort((a, b) => a.label.localeCompare(b.label, 'tr')))}</tbody></table>
    </div>
  </section>
</div>`,
    }),
  );

  // ---- PWA + robots + sitemap
  writeFileSync(
    join(DIST, 'manifest.webmanifest'),
    JSON.stringify(
      {
        name: 'Tercih Pusulası',
        short_name: 'Pusula',
        start_url: '/uygulama.html',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1a5fd0',
        lang: 'tr',
        icons: [{ src: '/assets/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(DIST, 'assets', 'favicon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a5fd0"/><path d="M32 12 44 32 32 52 20 32Z" fill="#fff"/><circle cx="32" cy="32" r="4" fill="#1a5fd0"/></svg>',
  );
  const urls = ['/', '/uygulama.html', '/metodoloji.html', '/veri-kaynaklari.html', '/bos-kalan-kadrolar.html', '/kadrolar/', ...unvanLinks.map((l) => l.href), ...ilLinks.map((l) => l.href)];
  writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>https://tercihpusula.com${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: https://tercihpusula.com/sitemap.xml\n');

  const pages = urls.length + 1;
  process.stderr.write(
    `[build] ${round}: ${pages} sayfa, ${Object.keys(levels).length} seviye, ` +
      `${Object.values(levels).reduce((sum, d) => sum + d.rows.length, 0)} kadro satırı, ${summary.lisans?.kontenjan ?? '?'} lisans kontenjanı\n`,
  );
}

main();
