// Derin test: tercih listesi sayfası (/uygulama.html). Smoke'tan farkı — tek tek davranış
// ölçmek yerine sayfayı bir kullanıcı gibi uçtan uca sürer ve ölçümleri raporlar:
// veri bütünlüğü, filtre matrisi, combobox klavyesi, geçmiş dökümü, liste yönetimi,
// kalıcılık, olasılık, erişilebilirlik, performans, yerleşim ve XSS.
//
// Kullanım: npm run test:uygulama      (headless Chrome/Edge gerekir)
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const WEB = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(WEB);
const DIST = join(ROOT, 'dist');
const PORT = 8137;
const DEBUG = 9351;
const ROOT_URL = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (area, name, ok, detail = '') => {
  results.push({ area, name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} [${area}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, ROOT_URL);
  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = await readFileSafe(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('nope');
  }
});
const readFileSafe = async (file) => (await import('node:fs/promises')).readFile(file);
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = spawn(BROWSERS.find((p) => existsSync(p)), [
  '--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${join(tmpdir(), `tp-deep-${Date.now()}`)}`,
  '--no-first-run', '--disable-gpu', '--window-size=1440,1000', `${ROOT_URL}/uygulama.html`,
], { stdio: 'ignore' });

let target;
for (let i = 0; i < 120 && !target; i += 1) {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    target = list.find((t) => /uygulama/.test(t.url)) ?? list[0];
  } catch { /* bekle */ }
  if (!target) await sleep(250);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const jsErrors = [];
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') jsErrors.push(message.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'error');
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') jsErrors.push(message.params.entry.text);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const messageId = ++id;
  pending.set(messageId, { resolve, reject });
  ws.send(JSON.stringify({ id: messageId, method, params }));
});
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] ?? 'JS error');
  return result.result.value;
};
const key = async (name, code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, windowsVirtualKeyCode: code });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, windowsVirtualKeyCode: code });
};
const waitRows = async () => {
  for (let i = 0; i < 80; i += 1) {
    if (await evaluate("document.querySelectorAll('#rows tr').length > 0")) return true;
    await sleep(200);
  }
  return false;
};
const reload = async (query = '') => {
  await send('Page.navigate', { url: `${ROOT_URL}/uygulama.html${query}` });
  await sleep(400);
  return waitRows();
};
const rowCount = () => evaluate("document.querySelectorAll('#rows tr:not(.histo)').length");
const setQuery = async (value) => {
  await evaluate(`(() => { const i = document.querySelector('#query'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input')); })()`);
  await sleep(120);
  return rowCount();
};
const resetFilters = async () => {
  await evaluate("(() => { for (const id of ['#il','#unvan','#kurum']) { const s = document.querySelector(id); s.value = ''; s.dispatchEvent(new Event('change')); } const q = document.querySelector('#query'); q.value = ''; q.dispatchEvent(new Event('input')); const p = document.querySelector('#programSearch'); p.value = ''; p.dispatchEvent(new Event('input')); p.blur(); for (const id of ['#onlyWritable','#onlyEmpty','#onlyFilled']) { const c = document.querySelector(id); c.checked = false; c.dispatchEvent(new Event('change')); } })()");
  await sleep(150);
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
if (!(await waitRows())) {
  console.error('sayfa satır üretmedi — test durduruldu');
  process.exit(1);
}

// ---------- 1. veri bütünlüğü
const lisans = JSON.parse(readFileSync(join(DIST, 'data', 'lisans.json'), 'utf8'));
const integrity = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('#rows tr:not(.histo)').length,
  countText: document.querySelector('#count').textContent,
  unvanMissing: [...document.querySelectorAll('#rows tr:not(.histo)')].filter((tr) => !tr.querySelector('td strong')?.textContent.trim()).length,
  codes: [...document.querySelectorAll('#rows tr:not(.histo) [data-add]')].map((b) => b.dataset.add).length,
  tableHeaderCells: document.querySelectorAll('main table thead th').length,
  h1: document.querySelectorAll('h1').length,
})`);
const data = JSON.parse(integrity);
check('veri', 'tüm lisans satırları render edildi', data.rows === lisans.rows.length, `${data.rows}/${lisans.rows.length}`);
check('veri', 'her satırda unvan var', data.unvanMissing === 0, `${data.unvanMissing} eksik`);
check('veri', 'her satırın bir kadro kodu ve ekle düğmesi var', data.codes === lisans.rows.length, `${data.codes} düğme`);
check('veri', 'tablo başlık hücreleri tam', data.tableHeaderCells === 7, `${data.tableHeaderCells} sütun`);
check('veri', 'sayfada tek h1', data.h1 === 1, `${data.h1}`);

// kontenjan toplamı resmî sayıyla
const kontenjan = await evaluate("[...document.querySelectorAll('#rows tr:not(.histo)')].reduce((s, tr) => s + (Number(tr.children[1].textContent.trim()) || 0), 0)");
const official = lisans.rows.reduce((sum, row) => sum + (row.knt ?? 0), 0);
check('veri', 'görünen kontenjan toplamı = veri toplamı', kontenjan === official, `${kontenjan} / ${official}`);

// ---------- 2. filtre matrisi
await reload();
const baseline = await rowCount();
check('filtre', 'başlangıç: 555 satır', baseline === 555, `${baseline}`);

for (const [level, expected] of [['onlisans', 410], ['ortaogretim', 141], ['lisans', 555]]) {
  await evaluate(`(() => { const s = document.querySelector('#level'); s.value = '${level}'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  await waitRows();
  const rows = await rowCount();
  check('filtre', `düzey ${level} → ${expected} satır`, rows === expected, `${rows}`);
}

const folding = [
  ['hemsire', 1], ['HEMŞİRE', 1], ['muhendis', 211], ['MÜHENDİS', 211], ['avukat', 57], ['yok-boyle-bir-sey', 0],
];
await resetFilters();
for (const [query, expected] of folding) {
  const rows = await setQuery(query);
  check('filtre', `arama "${query}" → ${expected}`, rows === expected, `${rows}`);
}

await resetFilters();
const ilOptions = await evaluate("document.querySelectorAll('#il option').length - 1");
const ilPick = await evaluate(`(() => { const s = document.querySelector('#il'); const value = [...s.options].find((o, i) => i > 0).value; s.value = value; s.dispatchEvent(new Event('change')); return value; })()`);
await sleep(150);
const ilRows = await rowCount();
check('filtre', 'il seçimi daraltıyor', ilRows > 0 && ilRows < baseline, `${ilPick}: ${ilRows} satır (${ilOptions} il)`);

await resetFilters();
const unvanRows = await evaluate(`(() => { const s = document.querySelector('#unvan'); s.value = 'MEMUR'; s.dispatchEvent(new Event('change')); return document.querySelectorAll('#rows tr:not(.histo)').length; })()`);
check('filtre', 'unvan=MEMUR daraltıyor', unvanRows > 0 && unvanRows < baseline, `${unvanRows} satır`);

await resetFilters();
await evaluate("(() => { const c = document.querySelector('#onlyWritable'); c.checked = true; c.dispatchEvent(new Event('change')); })()");
await sleep(150);
const writableAll = await rowCount();
check('filtre', 'program seçmeden "yazabileceklerim" tüm satırları bırakır', writableAll === baseline, `${writableAll}`);

// ---------- 3. combobox (tek dropdown + arama)
await resetFilters();
const combo = await evaluate(`(() => {
  const input = document.querySelector('#programSearch');
  input.focus();
  input.value = 'hemsire';
  input.dispatchEvent(new Event('input'));
  return JSON.stringify({ expanded: input.getAttribute('aria-expanded'), controls: input.getAttribute('aria-controls'), options: document.querySelectorAll('#programList [role="option"]').length, first: document.querySelector('#programList [role="option"]')?.textContent.trim() });
})()`);
const comboState = JSON.parse(combo);
check('combobox', 'yazınca liste açılıyor ve ARIA doğru', comboState.expanded === 'true' && comboState.controls === 'programList', JSON.stringify(comboState));
check('combobox', '"hemsire" yalnız hemşirelik programlarını getiriyor', comboState.options === 2 && comboState.first === 'HEMŞİRELİK', `${comboState.options} · ${comboState.first}`);

const activeId = await evaluate("document.querySelector('#programSearch').getAttribute('aria-activedescendant')");
check('combobox', 'liste açılınca ilk seçenek işaretli', activeId === 'program-option-0', String(activeId));
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', windowsVirtualKeyCode: 40 });
const secondId = await evaluate("document.querySelector('#programSearch').getAttribute('aria-activedescendant')");
const secondText = await evaluate("document.getElementById(document.querySelector('#programSearch').getAttribute('aria-activedescendant')).textContent.trim()");
check('combobox', 'ok tuşu ikinci seçeneğe geçiyor', secondId === 'program-option-1', secondId + ' · ' + secondText);
await key('Enter', 13);
await sleep(250);
const afterEnter = await evaluate("JSON.stringify({ value: document.querySelector('#programSearch').value, open: !document.querySelector('#programList').hidden, rows: document.querySelectorAll('#rows tr:not(.histo)').length, note: document.querySelector('#programNote').textContent })");
const enterState = JSON.parse(afterEnter);
check('combobox', 'Enter aktif seçeneği yazıp listeyi kapatıyor', enterState.value === secondText && enterState.open === false, JSON.stringify(enterState));
await evaluate("(() => { const c = document.querySelector('#onlyWritable'); c.checked = true; c.dispatchEvent(new Event('change')); })()");
await sleep(200);
const scopedRows = await rowCount();
check('combobox', '"yazabileceklerim" ile program satırları daraltıyor', scopedRows > 0 && scopedRows < baseline, `${scopedRows} satır`);

await evaluate("(() => { const i = document.querySelector('#programSearch'); i.focus(); i.value = 'muh'; i.dispatchEvent(new Event('input')); })()");
await sleep(200);
await key('Escape', 27);
const afterEscape = await evaluate("!document.querySelector('#programList').hidden");
check('combobox', 'Esc kapatıyor', afterEscape === false);

await resetFilters();
const scope = await evaluate(`(() => {
  const input = document.querySelector('#programSearch');
  input.focus(); input.value = 'hemsire'; input.dispatchEvent(new Event('input'));
  const option = document.querySelector('#programList [role="option"]');
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  const c = document.querySelector('#onlyFilled');
  c.checked = true; c.dispatchEvent(new Event('change'));
  return JSON.stringify({ unvan: [...new Set([...document.querySelectorAll('#rows tr:not(.histo) td:first-child strong')].map((e) => e.textContent.trim()))], unvanOptions: [...document.querySelectorAll('#unvan option')].map((o) => o.value).filter(Boolean), note: document.querySelector('#programNote').textContent });
})()`);
const scopeState = JSON.parse(scope);
check('kapsam', 'hemşirelik + dolanlar yalnız HEMŞİRE getiriyor', scopeState.unvan.length === 1 && scopeState.unvan[0] === 'HEMŞİRE', scopeState.unvan.join(', ') || 'satır yok');
check('kapsam', 'ünvan listesi programa göre daralıyor', scopeState.unvanOptions.length === 1 && scopeState.unvanOptions[0] === 'HEMŞİRE', scopeState.unvanOptions.join(', '));
check('kapsam', 'not alanla sınırı söylüyor', /yalnız bu alanla sınırlı/.test(scopeState.note), scopeState.note.slice(0, 80));

// ---------- 4. geçmiş dökümü
await resetFilters();
await evaluate("(() => { const c = document.querySelector('#onlyFilled'); c.checked = true; c.dispatchEvent(new Event('change')); })()");
await sleep(200);
const historyState = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('#rows tr:not(.histo)').length,
  withPair: [...document.querySelectorAll('#rows tr td[title]')].filter((td) => /\\d+,\\d+–\\d+,\\d+/.test(td.textContent)).length,
  terms: [...new Set([...document.querySelectorAll('#rows tr td[title]')].flatMap((td) => (td.title.match(/\\d{4}\\/\\d/g) ?? [])))],
})`);
const history = JSON.parse(historyState);
check('geçmiş', 'dolanlar filtresi satırları süzüyor', history.rows > 0 && history.rows < baseline, `${history.rows} satır`);
check('geçmiş', 'taban–tavan çifti render edildi', history.withPair > 0, `${history.withPair} hücre`);
check('geçmiş', 'geçmiş yalnız merkezî dönemlerden (kurum alımları karışmıyor)', !history.terms.includes('2025/5') && !history.terms.includes('2024/5'), history.terms.join(','));

const drill = await evaluate(`(() => {
  document.querySelector('[data-histo]').click();
  const open = document.querySelectorAll('#rows tr.histo').length;
  const cells = document.querySelector('#rows tr.histo table.mini tbody tr')?.children.length ?? 0;
  const expanded = document.querySelector('[data-histo][aria-expanded="true"]') !== null;
  document.querySelector('[data-histo][aria-expanded="true"]').click();
  return JSON.stringify({ open, cells, expanded, closed: document.querySelectorAll('#rows tr.histo').length });
})()`);
const drillState = JSON.parse(drill);
check('geçmiş', 'döküm açılıyor, 7 alan taşıyor, kapanıyor', drillState.open === 1 && drillState.cells === 7 && drillState.expanded === true && drillState.closed === 0, JSON.stringify(drillState));

// ---------- 5. tercih listesi
await reload('?seviye=lisans&puan=85');
await evaluate('localStorage.clear()');
await send('Page.reload');
await sleep(700);
await waitRows();
const list = await evaluate(`(() => {
  for (let i = 0; i < 3; i += 1) document.querySelector('#rows button[data-add]:not([disabled])').click();
  const afterAdd = document.querySelectorAll('#list li:not(.empty)').length;
  const up = document.querySelector('#list [data-up]');
  const down = document.querySelector('#list [data-down]');
  const orderBefore = [...document.querySelectorAll('#list li strong')].map((s) => s.textContent.trim());
  document.querySelector('#list [data-down]').click();
  const orderAfter = [...document.querySelectorAll('#list li strong')].map((s) => s.textContent.trim());
  document.querySelector('#list [data-remove]').click();
  const afterRemove = document.querySelectorAll('#list li:not(.empty)').length;
  return JSON.stringify({ afterAdd, orderBefore, orderAfter, afterRemove, meta: document.querySelector('#listMeta').textContent, share: document.querySelector('#share').value });
})()`);
const listState = JSON.parse(list);
check('liste', 'üç satır eklendi', listState.afterAdd === 3, `${listState.afterAdd}`);
check('liste', 'sıra aşağı taşıma çalışıyor', listState.orderBefore[0] === listState.orderAfter[1], `${listState.orderBefore[0]} → ${listState.orderAfter[1]}`);
check('liste', 'çıkarma listeyi küçültüyor', listState.afterRemove === 2, `${listState.afterRemove}`);
check('liste', 'sayaç 30 sınırını gösteriyor', /\/\d+$/.test(listState.meta.trim()), listState.meta);
check('liste', 'paylaşım bağlantısı ?l= taşıyor', listState.share.includes('l='), listState.share.slice(-40));

const persisted = await evaluate(`(() => { const raw = localStorage.getItem('tp:list:lisans'); return raw ? JSON.parse(raw).length : 0; })()`);
check('liste', 'liste localStorage’a yazıldı', persisted === 2, `${persisted} kod`);

await send('Page.reload');
await sleep(700);
await waitRows();
const afterReload = await evaluate("document.querySelectorAll('#list li:not(.empty)').length");
check('liste', 'yenilemeden sonra liste korunuyor', afterReload === 2, `${afterReload}`);

const cap = await evaluate(`(() => {
  localStorage.clear();
  return 'cleared';
})()`);
await send('Page.reload');
await sleep(700);
await waitRows();
const capState = await evaluate(`(() => {
  for (let i = 0; i < 40; i += 1) {
    const next = [...document.querySelectorAll('#rows button[data-add]')].find((b) => !b.disabled);
    if (!next) break;
    next.click();
  }
  return JSON.stringify({ count: document.querySelectorAll('#list li:not(.empty)').length, meta: document.querySelector('#listMeta').textContent, disabled: [...document.querySelectorAll('#rows button[data-add]')].every((b) => b.disabled || b.textContent.trim() === 'listede') });
})()`);
const capped = JSON.parse(capState);
check('liste', '30 tercih sınırı aşılmıyor', capped.count === 30, `${capped.count} · ${capped.meta}`);

// ---------- 6. olasılık
const probability = await evaluate(`(() => {
  const input = document.querySelector('#puan');
  input.value = '85';
  input.dispatchEvent(new Event('input'));
  return JSON.stringify({ value: document.querySelector('#probabilityValue').textContent, note: document.querySelector('#probability').textContent });
})()`);
const probState = JSON.parse(probability);
check('olasılık', 'liste + puan ile olasılık hesaplanıyor', /^%\d+$/.test(probState.value.trim()), JSON.stringify(probState));
const badScore = await evaluate(`(() => {
  const input = document.querySelector('#puan');
  input.value = 'abc';
  input.dispatchEvent(new Event('input'));
  return JSON.stringify({ value: document.querySelector('#probabilityValue').textContent, error: document.querySelector('#error').hidden });
})()`);
const badState = JSON.parse(badScore);
check('olasılık', 'geçersiz puan çökmüyor', badState.value === '—' && badState.error === true, JSON.stringify(badState));

// ---------- 7. erişilebilirlik
const a11y = await evaluate(`JSON.stringify({
  labelled: [...document.querySelectorAll('.filters input, .filters select')].filter((el) => document.querySelector('label[for="' + el.id + '"]') || el.getAttribute('aria-label')).length,
  fields: document.querySelectorAll('.filters input, .filters select').length,
  comboRole: document.querySelector('#programSearch').getAttribute('role'),
  listRole: document.querySelector('#programList').getAttribute('role'),
  buttonsNamed: [...document.querySelectorAll('button')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label')).length,
  th: document.querySelectorAll('main table thead th').length,
  focusableSkip: [...document.querySelectorAll('#rows button')].filter((b) => b.tabIndex < 0).length,
})`);
const a11yState = JSON.parse(a11y);
check('erişilebilirlik', 'tüm filtre alanları etiketli', a11yState.labelled === a11yState.fields, `${a11yState.labelled}/${a11yState.fields}`);
check('erişilebilirlik', 'combobox rolü doğru', a11yState.comboRole === 'combobox' && a11yState.listRole === 'listbox', `${a11yState.comboRole}/${a11yState.listRole}`);
check('erişilebilirlik', 'metinsiz düğme yok', a11yState.buttonsNamed === 0, `${a11yState.buttonsNamed}`);
check('erişilebilirlik', 'tablo başlıkları var', a11yState.th === 7, `${a11yState.th}`);

// ---------- 8. performans
const perf = await evaluate(`(() => {
  const t0 = performance.now();
  const input = document.querySelector('#query');
  input.value = '';
  input.dispatchEvent(new Event('input'));
  const t1 = performance.now();
  input.value = 'm';
  input.dispatchEvent(new Event('input'));
  const t2 = performance.now();
  return JSON.stringify({ reset: +(t1 - t0).toFixed(1), filter: +(t2 - t1).toFixed(1), rows: document.querySelectorAll('#rows tr').length });
})()`);
const perfState = JSON.parse(perf);
check('performans', 'filtre yeniden çizimi 120 ms altı', perfState.filter < 120, `${perfState.filter} ms (${perfState.rows} satır)`);

// ---------- 9. yerleşim
await resetFilters();
for (const [width, label] of [[1440, 'masaüstü'], [1024, 'dizüstü'], [768, 'tablet'], [390, 'mobil']]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
  await sleep(250);
  const overflow = await evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  check('yerleşim', `${label} (${width}px) yatay taşma yok`, overflow <= 0, `${overflow}px`);
}
await send('Emulation.clearDeviceMetricsOverride');

// ---------- 10. XSS ve güvenlik
await send('Page.navigate', { url: `${ROOT_URL}/uygulama.html?l=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&program=%22%3E%3Cscript%3E` });
await sleep(700);
await waitRows();
const xss = await evaluate(`JSON.stringify({ title: document.title, injected: document.querySelectorAll('img[onerror], script:not([src])').length, list: document.querySelectorAll('#list li:not(.empty)').length })`);
const xssState = JSON.parse(xss);
check('güvenlik', 'bozuk ?l= ve ?program= enjeksiyonu işlemiyor', xssState.injected === 0 && xssState.list === 0, JSON.stringify(xssState));

const inlineHandlers = await evaluate("document.querySelectorAll('[onclick],[onerror],[onload],[oninput],[onchange],[onsubmit]').length");
check('güvenlik', 'satır içi on* niteliği yok', inlineHandlers === 0, String(inlineHandlers) + ' nitelik');

// ---------- özet
const failed = results.filter((r) => !r.ok);
const byArea = new Map();
for (const r of results) {
  const stat = byArea.get(r.area) ?? { pass: 0, fail: 0 };
  r.ok ? (stat.pass += 1) : (stat.fail += 1);
  byArea.set(r.area, stat);
}
console.log('\n=== özet ===');
for (const [area, stat] of byArea) console.log(`${area.padEnd(16)} ${stat.pass}/${stat.pass + stat.fail}${stat.fail ? `  ✗ ${stat.fail}` : ''}`);
console.log(`toplam ${results.length - failed.length}/${results.length} · JS hatası ${jsErrors.length}`);
if (jsErrors.length) console.log('JS hataları:', jsErrors.slice(0, 5).join(' | '));

browser.kill();
server.close();
ws.close();
process.exit(failed.length || jsErrors.length ? 1 : 0);
