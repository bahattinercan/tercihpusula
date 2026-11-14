// Renders the site favicon into a multi-size Windows .ico for the desktop shell.
//   node scripts/make-icon.mjs [--force]
// Uses the installed Chrome/Edge in headless mode over CDP (no npm dependencies) and packs
// the PNG frames into an ICO container by hand. `--window-size` is avoided on purpose:
// Chrome clamps the window to 500 CSS px, which crops small frames.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SVG = join(ROOT, 'dist', 'assets', 'favicon.svg');
const OUT = join(ROOT, 'desktop', 'Resources', 'app.ico');
const SIZES = [16, 32, 48, 64, 128, 256];
const DEBUG_PORT = 9411;

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const force = process.argv.includes('--force');

if (existsSync(OUT) && !force) {
  console.log(`icon already present: ${OUT} (use --force to re-render)`);
  process.exit(0);
}
if (!existsSync(SVG)) {
  console.error(`missing source icon: ${SVG} — run "npm run build" first`);
  process.exit(1);
}
const browserPath = BROWSERS.find((path) => existsSync(path));
if (!browserPath) {
  console.error('Chrome or Edge not found — cannot render the icon');
  process.exit(1);
}

async function targetUrl() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const page = targets.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* browser is still starting */
    }
    await sleep(200);
  }
  throw new Error('CDP target not found');
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
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = async (method, params = {}) => {
    await ready;
    const messageId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      ws.send(JSON.stringify({ id: messageId, method, params }));
    });
  };
  return { send, close: () => ws.close() };
}

const svg = readFileSync(SVG, 'utf8').replace(/<\?xml[^>]*\?>/g, '').trim();
const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block;width:100vw;height:100vh}</style>${svg}`;

const work = mkdtempSync(join(tmpdir(), 'tp-icon-'));
const userData = join(work, 'profile');
const page = join(work, 'icon.html');
writeFileSync(page, html);

const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userData}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  const client = connect(await targetUrl());
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  await client.send('Page.navigate', { url: `file:///${page.replace(/\\/g, '/')}` });
  await sleep(500);

  const frames = [];
  for (const size of SIZES) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: size,
      height: size,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(120);
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const bytes = Buffer.from(shot.data, 'base64');
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${size}px: not a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== size || height !== size) throw new Error(`${size}px: frame is ${width}x${height}`);
    frames.push({ size, bytes });
  }
  client.close();

  // ICO container with PNG payloads (supported since Windows Vista).
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(frames.length, 4);
  const entries = Buffer.alloc(16 * frames.length);
  let offset = header.length + entries.length;
  frames.forEach(({ size, bytes }, index) => {
    const at = index * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt8(0, at + 2); // palette size
    entries.writeUInt8(0, at + 3); // reserved
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(bytes.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.concat([header, entries, ...frames.map((frame) => frame.bytes)]));
  console.log(
    `icon written: ${OUT} (${frames.map((f) => `${f.size}px/${(f.bytes.length / 1024).toFixed(1)}KB`).join(' ')}, total ${(offset / 1024).toFixed(1)} KB)`,
  );
} catch (error) {
  console.error(`icon render failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  browser.kill();
  try {
    execFileSync('cmd', ['/c', 'timeout', '/t', '1', '/nobreak'], { stdio: 'ignore' });
  } catch {
    /* best effort: let Chrome release the profile folder */
  }
  rmSync(work, { recursive: true, force: true });
}
