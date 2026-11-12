// Smoke test: dist/ dosyalarını servis edip headless tarayıcıda gerçekten çalışıyor mu diye bakar.
// Bağımlılık yok: Node 22'nin global WebSocket'i + CDP.
//
//   node web/smoke.mjs            # uygulama sayfasını test eder, dist/.shots/ altına ekran görüntüsü alır
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const WEB = dirname(fileURLToPath(import.meta.url));
const DIST = join(dirname(WEB), 'dist');
const SHOTS = join(DIST, '.shots');
const PORT = 4173;
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
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
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
      '--user-data-dir=' + join(tmpdir(), 'tercihpusula-smoke-profile'),
      '--no-first-run',
      '--disable-gpu',
      '--window-size=1280,1000',
      `http://127.0.0.1:${PORT}/uygulama.html?seviye=lisans&puan=85&program=3342`,
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
        "JSON.stringify({error: document.querySelector('#error').textContent, hidden: document.querySelector('#error').hidden, count: document.querySelector('#count').textContent, options: document.querySelector('#program').options.length})",
      );
      process.stderr.write(`  tanı: ${diag}
`);
    }
    check('tablo satırları render edildi', rowCount > 0, `${rowCount} satır`);

    const onlyWritable = await evaluate(client, "document.querySelector('#onlyWritable').checked");
    check('“sadece yazabileceklerim” varsayılan açık', onlyWritable === true);

    // ilk satırı listeye ekle
    await evaluate(client, "document.querySelector('#rows button[data-add]').click()");
    await sleep(150);
    const listCount = await evaluate(client, "document.querySelectorAll('#list li').length");
    check('listeye ekleme çalışıyor', listCount === 1, `${listCount} öğe`);

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

    // program seçimi yazılabilirlik sayısını daraltmalı
    await evaluate(client, "document.querySelector('#il').value=''; document.querySelector('#il').dispatchEvent(new Event('change'))");
    const allRows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    check('program filtresi uygulanıyor', allRows < 555, `${allRows} satır (program 3342)`);

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

    // kadro dizini: liste + tarayıcı içi süzgeç
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/kadrolar/` });
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
    const counter = await evaluate(client, "document.querySelector('#unvan-count').textContent");
    check('süzgeç sayacı güncellendi', counter.includes('/'), counter);
    const indexListShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'kadrolar.png'), Buffer.from(indexListShot.data, 'base64'));

    // bir unvan sayfası
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/kadrolar/unvan-tekniker.html` });
    await sleep(400);
    const unvanPageRows = await evaluate(client, "document.querySelectorAll('main tbody tr').length");
    check('unvan sayfası satırları var', unvanPageRows > 0, `${unvanPageRows} satır`);
    const unvanShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'kadrolar-unvan.png'), Buffer.from(unvanShot.data, 'base64'));

    // dizinden gelen derin bağlantı: unvan önceden seçili ve satırlar süzülmüş olmalı
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/uygulama.html?unvan=TEKN%C4%B0KER&puan=85` });
    await sleep(700);
    const deepRows = await evaluate(client, "document.querySelectorAll('#rows tr').length");
    const deepSelect = await evaluate(client, "document.querySelector('#unvan').value");
    check('derin bağlantı unvanı seçiyor', deepSelect === 'TEKNİKER', deepSelect || '(boş)');
    check('derin bağlantı satırları süzüyor', deepRows > 0 && deepRows < 400, `${deepRows} satır`);

    // ana sayfa görüntüsü
    await client.send('Emulation.clearDeviceMetricsOverride');
    await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(500);
    const indexShot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, 'ana-sayfa.png'), Buffer.from(indexShot.data, 'base64'));

    // ana sayfa + metodoloji dumanı
    for (const path of ['/', '/metodoloji.html', '/veri-kaynaklari.html', '/bos-kalan-kadrolar.html', '/kadrolar/']) {
      await client.send('Emulation.clearDeviceMetricsOverride');
      await client.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` });
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
