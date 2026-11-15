// WAF köprüsü: dokuman.osym.gov.tr düz fetch/curl isteklerini 2,7 KB'lık
// "Erişim Engellendi" HTML'i ile yanıtlıyor. Gerçek bir tarayıcı oturumu (çerez + TLS
// parmak izi) ile aynı PDF sorunsuz iniyor. Bu betik yerel operasyon içindir; CI hattı
// normal `pipeline/run.mjs fetch` kullanır.
//
// Kullanım:
//   node scripts/waf-fetch-pdfs.mjs --only=2024/5,2024/6
//   node scripts/waf-fetch-pdfs.mjs --only=2024/5 --from-raw   # yalnız manifest tazele
//
// Yaptığı: dönem → data/raw/<key>/{level}.pdf + manifest.json (url, bytes, sha256, channel).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { discoverRounds, discoverDocuments } from '../pipeline/rounds.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RAW = join(ROOT, 'data', 'raw');
const LEVELS = ['lisans', 'onlisans', 'ortaogretim'];
const CHANNEL_CUT = /\s(?:nın|nin|nun|nün)\s|\sSözleşmeli\s|\sKadrolarına\s|\sPozisyonlarına\s|\sYerleştirme\s/i;
const channelTitle = (title) => {
  const body = title.replace(/^KPSS-\d{4}\/\d+:?\s*/, '').trim();
  return body.split(CHANNEL_CUT)[0].trim() || body;
};
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '')
  .slice('--only='.length)
  .split(',')
  .filter(Boolean);

/** Chrome CDP istemcisi: sayfa gezinmesiyle PDF gövdesini yakalar. */
async function openBrowser() {
  const port = 9340 + Math.floor(Date.now() % 100);
  const path = BROWSERS.find((p) => existsSync(p));
  if (!path) throw new Error('Chrome/Edge bulunamadı');
  const child = spawn(path, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${join(tmpdir(), 'tp-waf-fetch')}`,
    '--no-first-run',
    '--disable-gpu',
    'https://www.osym.gov.tr/',
  ], { stdio: 'ignore' });

  let target;
  for (let i = 0; i < 120 && !target; i += 1) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      target = list[0];
    } catch {
      /* bekle */
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('CDP hedefi bulunamadı');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const messageId = ++id;
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });

  await send('Page.enable');
  await send('Network.enable');
  await sleep(2500); // çerezler otursun

  /** PDF'i indirir (base64 gövde). */
  const download = async (url) => {
    const requestId = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(onMessage);
        reject(new Error(`zaman aşımı: ${url}`));
      }, 120_000);
      const onMessage = (message) => {
        if (message.method === 'Network.responseReceived' && message.params.response.url === url) {
          clearTimeout(timer);
          listeners.delete(onMessage);
          resolve(message.params.requestId);
        }
      };
      listeners.add(onMessage);
      send('Page.navigate', { url }).catch(reject);
    });
    // gövde hazır olana kadar bekle
    await new Promise((resolve) => {
      const onMessage = (message) => {
        if (message.method === 'Network.loadingFinished' && message.params.requestId === requestId) {
          listeners.delete(onMessage);
          resolve();
        }
      };
      listeners.add(onMessage);
      setTimeout(() => {
        listeners.delete(onMessage);
        resolve();
      }, 120_000);
    });
    const body = await send('Network.getResponseBody', { requestId });
    return Buffer.from(body.base64Encoded ? body.body : Buffer.from(body.body, 'binary').toString('base64'), 'base64');
  };

  return { download, close: () => { child.kill(); ws.close(); } };
}

const rounds = await discoverRounds();
const targets = rounds.filter((round) => (only.length ? only.includes(round.round) : !round.central));
if (!targets.length) {
  console.error(`eşleşen dönem yok (--only=${only.join(',') || 'yok'})`);
  process.exit(1);
}
console.log(`${targets.length} dönem indirilecek: ${targets.map((t) => t.round).join(', ')}`);

const browser = await openBrowser();
try {
  for (const entry of targets) {
    const key = entry.round.replace('/', '-');
    const dir = join(RAW, key);
    mkdirSync(dir, { recursive: true });
    const { summary, levels } = await discoverDocuments(entry.url);
    const manifest = {
      round: entry.round,
      landing: entry.url,
      title: entry.title,
      channel: entry.central ? 'merkezi' : 'kurum',
      channelTitle: entry.central ? 'Merkezî yerleştirme (ÖSYM)' : channelTitle(entry.title),
      docs: {},
      guide: {},
      source: 'browser (WAF bridge)',
    };
    const wanted = [...Object.entries(levels), ...(summary ? [['summary', summary]] : [])];
    if (!wanted.length) {
      console.log(`  ${key}: düzey belgesi bulunamadı, atlandı`);
      continue;
    }
    for (const [level, url] of wanted) {
      const bytes = await browser.download(url);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
        console.log(`  ${key}/${level}: PDF değil (${bytes.length} B), atlandı`);
        continue;
      }
      writeFileSync(join(dir, `${level}.pdf`), bytes);
      manifest.docs[level] = {
        url,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      console.log(`  ${key}/${level}: ${(bytes.length / 1024).toFixed(0)} KB`);
    }
    if (Object.keys(manifest.docs).length) {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const metaFile = join(ROOT, 'data', 'rounds', key, 'meta.json');
      if (existsSync(metaFile)) {
        const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
        meta.channel = manifest.channel;
        meta.channelTitle = manifest.channelTitle;
        writeFileSync(metaFile, JSON.stringify(meta, null, 2));
      }
    }
  }
} finally {
  browser.close();
}
