// Smoke test: dist/ dosyalarını servis edip headless tarayıcıda gerçekten çalışıyor mu diye bakar.
// Bağımlılık yok: Node 22'nin global WebSocket'i + CDP.
//
//   node web/smoke.mjs            # uygulama sayfasını test eder, <repo>/.shots/ altına ekran görüntüsü alır
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
const DIST = join(dirname(WEB), 'dist');
// dist dışında: dağıtım klasörüne test çıktısı girmesin
const SHOTS = join(dirname(WEB), '.shots');
const PORT = 4173;
// Build TP_BASE ile üretildiyse aynı ön eki sunucuya da ver (ör. TP_SMOKE_BASE=/tercihpusula)
const BASE = (process.env.TP_SMOKE_BASE || '').replace(/\/$/, '');
const ROOT_URL = `http://127.0.0.1:${PORT}${BASE}`;
const DEBUG_PORT = 9333;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `${ROOT_URL}`);
    let path = url.pathname;
    // Build bir ön ek altında üretildiyse isteği o ön ekten soy (Pages proje sitesi).
    if (BASE) {
      if (path === BASE) path = '/';
      else if (path.startsWith(`${BASE}/`)) path = path.slice(BASE.length);
      else {
        res.writeHead(404).end('outside base');
        return;
      }
    }
    if (path === '/') path = '/index.html';
    if (path.endsWith('/')) path += 'index.html';
    const file = join(DIST, path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function cdpTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* tarayıcı henüz açılmadı */
    }
    await sleep(250);
  }
  throw new Error('CDP hedefi bulunamadı');
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params?.exceptionDetails;
      process.stderr.write(`  ! sayfa hatası: ${detail?.exception?.description ?? detail?.text ?? 'bilinmiyor'}
`);
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      process.stderr.write(`  ! konsol: ${message.params.entry.text}
`);
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const send = async (method, params = {}) => {
    await ready;
    const messageId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  };
  return { send, close: () => ws.close(), ready };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'JS hatası');
  return result.result.value;
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('dist/ yok — önce node web/build.mjs');
  mkdirSync(SHOTS, { recursive: true });
  const browserPath = BROWSERS.find((p) => existsSync(p));
  if (!browserPath) throw new Error('Edge/Chrome bulunamadı');

  const server = await serve();
  const browser = spawn(
    browserPath,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--user-data-dir=' + join(tmpdir(), `tercihpusula-smoke-${Date.now()}`),
      '--no-first-run',
      '--disable-gpu',
      '--window-size=1280,1000',
      `${ROOT_URL}/uygulama.html?seviye=lisans&puan=85&program=3342`,
    ],
    { stdio: 'ignore' },
  );

  const failures = [];
  const check = (name, ok, detail = '') => {
    process.stderr.write(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}\n`);
    if (!ok) failures.push(name);
  };

  try {
    const target = await cdpTarget();
    const client = connect(target.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Log.enable');

    // veri yüklenene kadar bekle
    for (let i = 0; i < 40; i += 1) {
      const rows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
      if (rows > 0) break;
      await sleep(250);
    }

    const rowCount = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    if (rowCount === 0) {
      const diag = await evaluate(
        client,
        "JSON.stringify({error: document.querySelector('#error').textContent, hidden: document.querySelector('#error').hidden, count: document.querySelector('#count').textContent, programmeOptions: document.querySelectorAll('#programList [role=option]').length})",
      );
      process.stderr.write(`  tanı: ${diag}
`);
    }
    check('tablo satırları render edildi', rowCount > 0, `${rowCount} satır`);

    const onlyWritable = await evaluate(client, "document.querySelector('#onlyWritable').checked");
    check('“sadece yazabileceklerim” varsayılan açık', onlyWritable === true);

    // ilk satırı listeye ekle: temiz URL + boş localStorage (önceki kontroller
    // ?l= ile liste kurmuş olabilir, sıra bağımsızlığı için sıfırlanır)
    await client.send('Page.navigate', { url: `${ROOT_URL}/uygulama.html?seviye=lisans&puan=85` });
    await sleep(600);
    await evaluate(client, "localStorage.clear()");
    await client.send('Page.reload');
    await sleep(800);
    const beforeAdd = await evaluate(client, "document.querySelectorAll('#list li:not(.empty)').length");
    await evaluate(client, "document.querySelector('#rows button[data-add]').click()");
    await sleep(150);
    const listCount = await evaluate(client, "document.querySelectorAll('#list li:not(.empty)').length");
    check('listeye ekleme çalışıyor', listCount === beforeAdd + 1, `${beforeAdd} → ${listCount} öğe`);

    const probability = await evaluate(client, "document.querySelector('#probabilityValue').textContent.trim()");
    check('yerleşme olasılığı hesaplandı', probability.includes('%'), JSON.stringify(probability));

    const shareUrl = await evaluate(client, "document.querySelector('#share').value");
    check('paylaşılabilir bağlantı üretildi', shareUrl.includes('l='), shareUrl.slice(0, 80));

    // filtre: il seçimi satır sayısını değiştirmeli
    const before = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    await evaluate(
      client,
      `(() => {
        const select = document.querySelector('#il');
        const cell = document.querySelector('#rows tr td div[style]');
        const visible = cell ? cell.textContent.split('·')[1]?.trim().split('/')[0].trim() : '';
        const option = [...select.options].find(o => o.value && visible.startsWith(o.value));
        select.value = option ? option.value : '';
        select.dispatchEvent(new Event('change'));
      })()`,
    );
    await sleep(150);
    const after = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    check('il filtresi satırları daraltıyor', after > 0 && after <= before, `${before} → ${after}`);

    // program seçimi yazılabilirlik sayısını daraltmalı (tek dropdown, içinde arama)
    await evaluate(client, "document.querySelector('#il').value=''; document.querySelector('#il').dispatchEvent(new Event('change'))");
    const totalRows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    const programLabel = await evaluate(client, `(() => {
      const input = document.querySelector('#programSearch');
      input.focus();
      input.value = 'mühendis';
      input.dispatchEvent(new Event('input'));
      const first = document.querySelector('#programList [role="option"]');
      if (!first) return null;
      const label = first.textContent.trim();
      first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return label;
    })()`);
    await sleep(200);
    const programRows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    const programChosen = await evaluate(client, "document.querySelector('#programSearch').value");
    check(
      'program filtresi uygulanıyor',
      programLabel !== null && programRows > 0 && programRows < totalRows && programChosen === programLabel,
      `${totalRows} → ${programRows} satır · ${programLabel ?? 'program seçilemedi'}`,
    );

    // --- arama aksan duyarsızlığı: `hemsire` HEMŞİRE'yi, `muhendis` MÜHENDİS'i bulmalı.
    // Sayaçların yorumlanabilir olması için görünmez filtreler sıfırlanır.
    const setQuery = (value) =>
      evaluate(client, `(() => { const i = document.querySelector('#query'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')); })()`);
    const clearAllFilters = async () => {
      await evaluate(
        client,
        "(() => { const q = document.querySelector('#query'); q.value = ''; q.dispatchEvent(new Event('input')); for (const id of ['#il', '#unvan', '#kurum']) { const s = document.querySelector(id); s.value = ''; s.dispatchEvent(new Event('change')); } const p = document.querySelector('#programSearch'); p.value = ''; p.dispatchEvent(new Event('input')); p.blur(); const w = document.querySelector('#onlyWritable'); w.checked = false; w.dispatchEvent(new Event('change')); })()",
      );
      await sleep(200);
    };
    const gotoLevel = async (level) => {
      await evaluate(client, `(() => { const s = document.querySelector('#level'); s.value = ${JSON.stringify(level)}; s.dispatchEvent(new Event('change')); })()`);
      for (let i = 0; i < 40; i += 1) {
        const ready = await evaluate(client, "document.querySelectorAll('#rows tr').length > 0");
        if (ready) break;
        await sleep(250);
      }
      await clearAllFilters();
    };
    const visibleRows = () => evaluate(client, "document.querySelectorAll('#rows tr').length");

    await gotoLevel('lisans');
    await setQuery('mühendis');
    await sleep(150);
    const turkceMuhendis = await visibleRows();
    await setQuery('muhendis');
    await sleep(150);
    const asciiMuhendis = await visibleRows();
    check('aksansız arama (muhendis) mühendis satırlarını buluyor', turkceMuhendis > 0 && asciiMuhendis === turkceMuhendis, `mühendis ${turkceMuhendis} · muhendis ${asciiMuhendis}`);

    await setQuery('hemsire');
    await sleep(150);
    const hemsireRows = await visibleRows();
    check('hemsire yazımı HEMŞİRE kadrosunu buluyor (2026/1: 1 satır)', hemsireRows === 1, `${hemsireRows} satır`);

    await gotoLevel('ortaogretim');
    await setQuery('hemşire');
    await sleep(400);
    const bosSatir = await visibleRows();
    const notMetni = await evaluate(client, "(() => { const n = document.querySelector('#emptyNote'); return n && !n.hidden ? n.textContent.replace(/\\s+/g, ' ').trim() : ''; })()");
    check(
      'boş tabloda teşhis var: diğer düzey + geçmiş dönem sayıları',
      bosSatir === 0 && notMetni.includes('HEMŞİRE') && notMetni.includes('2025/2') && notMetni.includes('lisans 8'),
      notMetni.slice(0, 150) || 'boş not yok',
    );
    const switchButton = await evaluate(client, "document.querySelector('#emptyNote [data-switch-level=\"lisans\"]') !== null");
    check('teşhis, kadronun olduğu düzeye geçme düğmesi veriyor', switchButton === true);

    await gotoLevel('onlisans');
    await setQuery('saglik');
    await sleep(150);
    const saglikRows = await visibleRows();
    check('saglik yazımı SAĞLIK MEMURU / SAĞLIK TEKNİKERİ satırlarını buluyor', saglikRows > 0, `${saglikRows} satır`);

    await gotoLevel('lisans');
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#programSearch'); i.focus(); i.value = 'hemsire'; i.dispatchEvent(new Event('input')); })()",
    );
    await sleep(250);
    const programFound = await evaluate(
      client,
      `(() => {
        const options = [...document.querySelectorAll('#programList [role="option"]')];
        const hit = options.find((o) => o.textContent.trim() === 'HEMŞİRELİK');
        const note = document.querySelector('#programList .combo-note')?.textContent ?? '';
        const expanded = document.querySelector('#programSearch').getAttribute('aria-expanded');
        if (hit) hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        return JSON.stringify({ kod: hit ? hit.dataset.kod : null, options: options.length, note, expanded, chosen: document.querySelector('#programSearch').value, rows: document.querySelectorAll('#rows tr').length });
      })()`,
    );
    const parsedProgram = JSON.parse(programFound);
    check(
      'program arama HEMŞİRELİK seçeneğini bulup seçiyor (arama dropdown içinde)',
      parsedProgram.kod === '3204' && parsedProgram.options < 20 && parsedProgram.options > 0 && parsedProgram.expanded === 'true' && parsedProgram.chosen === 'HEMŞİRELİK' && parsedProgram.rows > 0,
      `${parsedProgram.note || 'not yok'} · seçenek ${parsedProgram.options} · kod ${parsedProgram.kod} · ${parsedProgram.rows} satır`,
    );
    const comboClosed = await evaluate(client, "document.querySelector('#programList').hidden");
    check('seçimden sonra liste kapanıyor', comboClosed === true);
    await clearAllFilters();

    // --- geçmiş dönem dökümü: "geçmiş dönemde dolanlar" + taban–tavan hücresi + döküm satırı
    const baseline = await visibleRows();
    const filterState = await evaluate(
      client,
      "(() => { const c = document.querySelector('#onlyFilled'); return c ? JSON.stringify({ exists: true, checked: c.checked }) : JSON.stringify({ exists: false }); })()",
    );
    const parsedFilter = JSON.parse(filterState);
    check('“geçmiş dönemde dolanlar” var ve varsayılan kapalı', parsedFilter.exists === true && parsedFilter.checked === false, filterState);

    const toggleFilled = (on) =>
      evaluate(
        client,
        `(() => { const c = document.querySelector('#onlyFilled'); c.checked = ${on}; c.dispatchEvent(new Event('change')); })()`,
      );
    await toggleFilled(true);
    await sleep(150);
    const filledRows = await visibleRows();
    check(
      'geçmiş filtresi yalnız geçmişte dolan kadroları bırakıyor',
      filledRows > 0 && filledRows < baseline,
      `${baseline} → ${filledRows} satır`,
    );

    const historyPair = await evaluate(
      client,
      "(() => { const cell = [...document.querySelectorAll('#rows tr td[title]')].find((td) => td.title.includes('aynı') && /\\d/.test(td.textContent)); return cell ? cell.textContent.replace(/\\s+/g, ' ').trim() : ''; })()",
    );
    check(
      'satırda geçmiş taban–tavan çifti görünüyor',
      /\d+,\d+–\d+,\d+/.test(historyPair) && /\d{4}\/\d/.test(historyPair),
      historyPair.slice(0, 60) || 'hücre boş',
    );

    await evaluate(client, "(() => { document.querySelector('[data-histo]').click(); })()");
    await sleep(150);
    const drill = await evaluate(
      client,
      "JSON.stringify({ open: document.querySelectorAll('#rows tr.histo').length, lines: document.querySelectorAll('#rows tr.histo table.mini tbody tr').length, expanded: document.querySelectorAll('[data-histo][aria-expanded=\"true\"]').length, hasScore: /\\d+,\\d+/.test(document.querySelector('#rows tr.histo')?.textContent ?? '') })",
    );
    const parsedDrill = JSON.parse(drill);
    check(
      '“döküm” satırı dönem başına taban/tavan açıyor',
      parsedDrill.open === 1 && parsedDrill.lines >= 1 && parsedDrill.expanded === 1 && parsedDrill.hasScore === true,
      drill,
    );
    await evaluate(client, "(() => { document.querySelector('[data-histo][aria-expanded=\"true\"]').click(); })()");
    await sleep(150);
    const collapsed = await evaluate(client, "document.querySelectorAll('#rows tr.histo').length");
    check('döküm ikinci tıklamada kapanıyor', collapsed === 0, `${collapsed} döküm satırı`);

    await toggleFilled(false);
    await sleep(150);
    const restored = await visibleRows();
    check('geçmiş filtresi kaldırılınca satırlar geri geliyor', restored === baseline, `${filledRows} → ${restored}`);

    // --- program seçiliyken "dolanlar" filtresi adayın kendi alanına daralır
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#programSearch'); i.focus(); i.value = 'hemsire'; i.dispatchEvent(new Event('input')); })()",
    );
    await sleep(250);
    await evaluate(client, "document.querySelector('#programList [role=\"option\"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))");
    await sleep(200);
    const withoutFilled = await visibleRows();
    check(
      'program seçimi tek başına satırları daraltmıyor',
      withoutFilled === baseline,
      `${withoutFilled} satır (program: ${await evaluate(client, "document.querySelector('#programSearch').value")})`,
    );

    await toggleFilled(true);
    await sleep(200);
    const scopedRows = await visibleRows();
    const scopedUnvans = await evaluate(
      client,
      "JSON.stringify([...new Set([...document.querySelectorAll('#rows tr:not(.histo) td:first-child strong')].map((el) => el.textContent.trim()))])",
    );
    check(
      'dolanlar + program: yalnız seçilen alanın kadroları geliyor',
      scopedRows > 0 && scopedRows < filledRows,
      `${filledRows} → ${scopedRows} satır · unvan ${scopedUnvans}`,
    );
    const scopeParsed = JSON.parse(scopedUnvans);
    check(
      'program alanı HEMŞİRELİK kadrolarıyla sınırlı',
      scopeParsed.length === 1 && scopeParsed[0] === 'HEMŞİRE',
      scopeParsed.join(', ') || 'satır yok',
    );
    const scopeNote = await evaluate(client, "document.querySelector('#programNote').textContent");
    check('not, filtrenin alanla sınırlı olduğunu söylüyor', /yalnız bu alanla sınırlı/.test(scopeNote), scopeNote);

    // ünvan/kurum/il listeleri de seçilen programa göre daralmalı
    const optionLists = await evaluate(
      client,
      "JSON.stringify({ unvan: [...document.querySelectorAll('#unvan option')].map((o) => o.value).filter(Boolean), kurum: [...document.querySelectorAll('#kurum option')].map((o) => o.value).filter(Boolean), il: [...document.querySelectorAll('#il option')].map((o) => o.value).filter(Boolean) })",
    );
    const parsedOptions = JSON.parse(optionLists);
    check(
      'ünvan listesi programa göre değişiyor',
      parsedOptions.unvan.length === 1 && parsedOptions.unvan[0] === 'HEMŞİRE',
      `unvan: ${parsedOptions.unvan.join(', ') || 'boş'}`,
    );
    check(
      'kurum ve il listeleri de programa göre daralıyor',
      parsedOptions.kurum.length === 1 && parsedOptions.il.length === 1 && parsedOptions.il[0] === 'ESKİŞEHİR',
      `kurum: ${parsedOptions.kurum.join(', ') || 'boş'} · il: ${parsedOptions.il.join(', ') || 'boş'}`,
    );

    await toggleFilled(false);
    await sleep(150);
    const unscoped = await visibleRows();
    check('dolanlar kaldırılınca program süzgeci de kalkıyor', unscoped === baseline, `${scopedRows} → ${unscoped}`);
    await clearAllFilters();

    const overflow = await evaluate(
      client,
      "(() => { const d = document.documentElement; return d.scrollWidth - d.clientWidth; })()",
    );
    check('yatay taşma yok (1280px)', overflow <= 0, `${overflow}px`);

    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'uygulama.png'), Buffer.from(shot.data, 'base64'));

    // mobil genişlik
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(300);
    const mobileOverflow = await evaluate(
      client,
      "(() => { const d = document.documentElement; return d.scrollWidth - d.clientWidth; })()",
    );
    check('yatay taşma yok (390px)', mobileOverflow <= 0, `${mobileOverflow}px`);
    const mobileShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'uygulama-mobil.png'), Buffer.from(mobileShot.data, 'base64'));

    // açık tema
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await sleep(300);
    const lightShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'uygulama-acik-tema.png'), Buffer.from(lightShot.data, 'base64'));
    await client.send('Emulation.setEmulatedMedia', { features: [] });

    // her seviyede: tabloda görünen kontenjan toplamı = dist/data toplamı = resmî ÖSYM toplamı
    for (const [level, officialKontenjan] of [['lisans', 977], ['onlisans', 828], ['ortaogretim', 278]]) {
      await client.send('Page.navigate', { url: `${ROOT_URL}/uygulama.html?seviye=${level}&puan=85` });
      // ilk yükleme soğuk olabilir (modül + iki JSON); satır gelene kadar bekle
      for (let i = 0; i < 40; i += 1) {
        const ready = await evaluate(client, "document.querySelectorAll('#rows tr').length > 0");
        if (ready) break;
        await sleep(250);
      }
      await sleep(150);
      const sumShown = await evaluate(
        client,
        "[...document.querySelectorAll('#rows tr')].reduce((s, tr) => s + (Number(tr.querySelectorAll('td')[1].textContent.trim()) || 0), 0)",
      );
      const dataRows = JSON.parse(readFileSync(join(DIST, 'data', `${level}.json`), 'utf8')).rows;
      const sumData = dataRows.reduce((s, row) => s + row.knt, 0);
      const shownCount = await evaluate(client, "document.querySelectorAll('#rows tr').length");
      check(
        `${level}: görünen kontenjan = resmî toplam`,
        sumShown === officialKontenjan && sumData === officialKontenjan && shownCount === dataRows.length,
        `ekran ${sumShown} · veri ${sumData} · ÖSYM ${officialKontenjan} · ${shownCount}/${dataRows.length} satır`,
      );
    }

    await client.send('Page.navigate', { url: `${ROOT_URL}/kurum-alimlari.html` });
    await sleep(500);
    const kurumChannels = await evaluate(client, "document.querySelectorAll('[data-channel]').length");
    check('kurum alımları: kanal bölümleri var', kurumChannels >= 1, `${kurumChannels} kanal`);
    const kurumRows = await evaluate(client, "document.querySelectorAll('#kurum-tables [data-name]').length");
    check('kurum alımları: unvan satırları render edildi', kurumRows > 0, `${kurumRows} satır`);
    const kurumCounter = await evaluate(client, "document.querySelector('#kurum-count').textContent");
    check('kurum alımları: sayaç dolu', /\d/.test(kurumCounter), kurumCounter);
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#kurum-filter'); i.value = 'hemsire'; i.dispatchEvent(new Event('input')); })()",
    );
    await sleep(150);
    const kurumFiltered = await evaluate(client, "document.querySelectorAll('#kurum-tables [data-name]:not([hidden])').length");
    const kurumNames = await evaluate(
      client,
      "JSON.stringify([...document.querySelectorAll('#kurum-tables [data-name]:not([hidden])')].slice(0, 3).map((row) => row.dataset.name))",
    );
    check(
      'kurum alımları: aksansız arama hemşire satırlarını buluyor',
      kurumFiltered > 0 && kurumFiltered < kurumRows && /HEMŞİRE/.test(kurumNames),
      `${kurumRows} → ${kurumFiltered} · ${kurumNames.slice(0, 110)}`,
    );
    await evaluate(client, "(() => { const i = document.querySelector('#kurum-filter'); i.value = ''; i.dispatchEvent(new Event('input')); })()");

    // boş kalan kadrolar: 3 dönem tablosu + unvan kırılımı
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `${ROOT_URL}/bos-kalan-kadrolar.html` });
    await sleep(500);
    const roundRows = await evaluate(client, "document.querySelectorAll('main table')[0].querySelectorAll('tbody tr').length");
    check('boş kalan: dönem tablosu dolu', roundRows >= 2, `${roundRows} dönem`);
    const unvanBosRows = await evaluate(client, "document.querySelectorAll('main table')[2]?.querySelectorAll('tbody tr').length ?? 0");
    check('boş kalan: unvan kırılımı var', unvanBosRows > 0, `${unvanBosRows} unvan`);
    const bosShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'bos-kalan.png'), Buffer.from(bosShot.data, 'base64'));

    // kadro dizini: liste + tarayıcı içi süzgeç
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `${ROOT_URL}/kadrolar/` });
    await sleep(500);
    const unvanRows = await evaluate(client, "document.querySelectorAll('#unvan-rows tr[data-name]').length");
    check('kadro dizini satırları render edildi', unvanRows > 0, `${unvanRows} unvan`);
    const ilRows = await evaluate(client, "document.querySelectorAll('#il-rows tr[data-name]').length");
    check('il listesi render edildi', ilRows > 0, `${ilRows} il`);
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#unvan-filter'); i.value = 'tekniker'; i.dispatchEvent(new Event('input')); })()",
    );
    await sleep(150);
    const filtered = await evaluate(client, "document.querySelectorAll('#unvan-rows tr[data-name]:not([hidden])').length");
    check('unvan süzgeci daraltıyor', filtered > 0 && filtered < unvanRows, `${unvanRows} → ${filtered}`);
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#unvan-filter'); i.value = 'muhendis'; i.dispatchEvent(new Event('input')); })()",
    );
    await sleep(150);
    const foldedFilter = await evaluate(client, "document.querySelectorAll('#unvan-rows tr[data-name]:not([hidden])').length");
    check('unvan süzgeci aksansız yazımı da buluyor (muhendis → MÜHENDİS)', foldedFilter > 0, `${foldedFilter} unvan`);
    const counter = await evaluate(client, "document.querySelector('#unvan-count').textContent");
    check('süzgeç sayacı güncellendi', counter.includes('/'), counter);
    await evaluate(
      client,
      "(() => { const i = document.querySelector('#unvan-filter'); i.value = ''; i.dispatchEvent(new Event('input')); })()",
    );
    const indexListShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'kadrolar.png'), Buffer.from(indexListShot.data, 'base64'));

    // bir unvan sayfası
    await client.send('Page.navigate', { url: `${ROOT_URL}/kadrolar/unvan-tekniker.html` });
    await sleep(400);
    const unvanPageRows = await evaluate(client, "document.querySelectorAll('main tbody tr').length");
    check('unvan sayfası satırları var', unvanPageRows > 0, `${unvanPageRows} satır`);
    const unvanShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'kadrolar-unvan.png'), Buffer.from(unvanShot.data, 'base64'));

    // güvenlik: paylaşım bağlantısındaki ?l= değeri DOM'a ham yazılmamalı (XSS)
    const xssPayload = `<img src=x onerror="document.title='XSS'">`;
    await client.send('Page.navigate', {
      url: `${ROOT_URL}/uygulama.html?seviye=lisans&puan=85&l=${encodeURIComponent(xssPayload)}`,
    });
    await sleep(800);
    const xssTitle = await evaluate(client, 'document.title');
    const xssNodes = await evaluate(client, "document.querySelectorAll('#list img, #list script').length");
    check('?l= yükü çalışmıyor (XSS yok)', xssTitle !== 'XSS' && xssNodes === 0, `title=${JSON.stringify(xssTitle)} · enjekte düğüm=${xssNodes}`);

    // meşru paylaşım bağlantısı hâlâ çalışıyor mu (aşırı filtreleme kontrolü)
    const realKods = JSON.parse(readFileSync(join(DIST, 'data', 'lisans.json'), 'utf8')).rows.slice(0, 3).map((r) => r.kod);
    await client.send('Page.navigate', {
      url: `${ROOT_URL}/uygulama.html?seviye=lisans&puan=85&l=${realKods.join(',')}`,
    });
    await sleep(800);
    const sharedItems = await evaluate(client, "document.querySelectorAll('#list li:not(.empty)').length");
    check('geçerli ?l= bağlantısı listeyi kuruyor', sharedItems === realKods.length, `${sharedItems}/${realKods.length} öğe`);

    // dağıtım hijyeni: dist kökünde yalnız yayımlanması gerekenler olmalı
    const ALLOWED_ROOT = new Set([
      'assets', 'data', 'kadrolar', '_headers', 'index.html', 'uygulama.html', 'tanitim.html',
      'metodoloji.html', 'veri-kaynaklari.html', 'bos-kalan-kadrolar.html', 'kurum-alimlari.html',
      '404.html', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml', '.nojekyll',
    ]);
    const rootEntries = readdirSync(DIST);
    const stray = rootEntries.filter((name) => !ALLOWED_ROOT.has(name));
    check('dist kökünde yabancı dosya yok', stray.length === 0, stray.length ? `fazla: ${stray.join(', ')}` : `${rootEntries.length} giriş`);

    // güvenlik başlıkları dist kökünde mi
    const headersFile = join(DIST, '_headers');
    const headersText = existsSync(headersFile) ? readFileSync(headersFile, 'utf8') : '';
    check(
      'güvenlik başlıkları (_headers) üretildi',
      /Content-Security-Policy/.test(headersText) && /X-Content-Type-Options/.test(headersText),
      existsSync(headersFile) ? 'dist/_headers var' : 'dist/_headers YOK',
    );

    // dizinden gelen derin bağlantı: unvan önceden seçili ve satırlar süzülmüş olmalı
    await client.send('Page.navigate', { url: `${ROOT_URL}/uygulama.html?unvan=TEKN%C4%B0KER&puan=85` });
    await sleep(700);
    const deepRows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    const deepSelect = await evaluate(client, "document.querySelector('#unvan').value");
    check('derin bağlantı unvanı seçiyor', deepSelect === 'TEKNİKER', deepSelect || '(boş)');
    check('derin bağlantı satırları süzüyor', deepRows > 0 && deepRows < 400, `${deepRows} satır`);

    // metodoloji ve kaynak sayfaları: tile şeridi + tablo
    for (const [path, shot] of [['/metodoloji.html', 'metodoloji.png'], ['/veri-kaynaklari.html', 'veri-kaynaklari.png']]) {
      await client.send('Page.navigate', { url: `${ROOT_URL}${path}` });
      await sleep(400);
      const tiles = await evaluate(client, "document.querySelectorAll('.tiles .tile').length");
      check(`${path}: tile şeridi var`, tiles >= 3, `${tiles} tile`);
      const png = await client.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(SHOTS, shot), Buffer.from(png.data, 'base64'));
    }

    // ana sayfa görüntüsü
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `${ROOT_URL}/` });
    await sleep(500);
    const indexShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'ana-sayfa.png'), Buffer.from(indexShot.data, 'base64'));

    // tanıtım sayfası: ürün iddiaları, indirme kartı, dış kaynak yok
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `${ROOT_URL}/tanitim.html` });
    await sleep(500);
    const intro = JSON.parse(
      await evaluate(
        client,
        "JSON.stringify({h1: document.querySelector('h1')?.textContent.trim() ?? '', ctas: document.querySelectorAll('.cta-row a').length, dl: document.querySelectorAll('.dl-card dd').length, faq: document.querySelectorAll('details.faq').length, shots: document.querySelectorAll('figure.shot img').length})",
      ),
    );
    check(
      'tanıtım: başlık + çağrı düğmeleri',
      intro.h1.length > 0 && intro.ctas >= 3 && intro.faq >= 4 && intro.shots >= 3,
      `${intro.ctas} cta · ${intro.faq} sss · ${intro.shots} görsel`,
    );
    const dlCard = JSON.parse(
      await evaluate(
        client,
        "JSON.stringify({fields: document.querySelectorAll('.dl-card dd').length, href: [...document.querySelectorAll('.dl-card a')].map(a => a.href).find(h => h.startsWith('http')) ?? ''})",
      ),
    );
    check('tanıtım: indirme kartı künyesi dolu', dlCard.fields >= 5 && /github\.com|\/indir\//.test(dlCard.href), `${dlCard.fields} alan · ${dlCard.href.slice(0, 48)}`);
    const foreign = await evaluate(
      client,
      "performance.getEntriesByType('resource').filter(r => new URL(r.name).origin !== location.origin).map(r => r.name).length",
    );
    check('tanıtım: dış kaynak isteği yok', foreign === 0, `${foreign} dış istek`);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(220);
    const introOverflow = await evaluate(client, 'document.documentElement.scrollWidth - document.documentElement.clientWidth');
    check('tanıtım: yatay taşma yok (390px)', introOverflow <= 0, `${introOverflow}px`);
    const introMobileShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'tanitim-mobil.png'), Buffer.from(introMobileShot.data, 'base64'));
    await client.send('Emulation.clearDeviceMetricsOverride');
    await sleep(200);
    const introShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'tanitim.png'), Buffer.from(introShot.data, 'base64'));

    // ana sayfa + metodoloji dumanı
    for (const path of ['/', '/tanitim.html', '/metodoloji.html', '/veri-kaynaklari.html', '/bos-kalan-kadrolar.html', '/kurum-alimlari.html', '/kadrolar/']) {
      await client.send('Emulation.clearDeviceMetricsOverride');
      await client.send('Page.navigate', { url: `${ROOT_URL}${path}` });
      await sleep(400);
      const title = await evaluate(client, 'document.title');
      check(`sayfa açılıyor ${path}`, Boolean(title), title);
    }

    client.close();
  } finally {
    browser.kill();
    server.close();
  }

  if (failures.length) {
    process.stderr.write(`\n${failures.length} kontrol başarısız\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write('\ntüm kontroller geçti\n');
  }
}

main().catch((error) => {
  process.stderr.write(`✗ smoke hatası: ${error.message}\n`);
  process.exitCode = 1;
});
