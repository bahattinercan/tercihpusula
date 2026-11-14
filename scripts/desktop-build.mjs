// Packages the published site into a portable Windows app.
//   node scripts/desktop-build.mjs [--skip-web] [--self-contained] [--no-zip]
//
// 1. (optional) rebuilds dist/ with web/build.mjs
// 2. renders the app icon if missing
// 3. zips dist/ into desktop/Resources/dist.zip (embedded in the exe)
// 4. publishes desktop/ with dotnet (single file)
// 5. writes build/TercihPusula-win-x64-<round>.zip and prints sizes + sha256
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const DESKTOP = join(ROOT, 'desktop');
const RESOURCES = join(DESKTOP, 'Resources');
const OUT = join(ROOT, 'build');
const PUBLISH = join(OUT, 'desktop');

const args = process.argv.slice(2);
const skipWeb = args.includes('--skip-web');
const selfContained = args.includes('--self-contained');
const noZip = args.includes('--no-zip');

const log = (message) => process.stderr.write(`[desktop] ${message}\n`);
const fail = (message) => {
  process.stderr.write(`\n✗ ${message}\n`);
  process.exit(1);
};

const run = (command, commandArgs, note) => {
  log(note);
  try {
    execFileSync(command, commandArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (error) {
    const output = String(error.stdout ?? '') + String(error.stderr ?? '');
    const lines = output.split(/\r?\n/).filter((line) => /error|hata/i.test(line));
    fail(`${note} başarısız\n  ${lines.slice(0, 5).join('\n  ') || error.message}`);
  }
};

const size = (path) => (statSync(path).size / 1024 / 1024).toFixed(2);
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const powershell = (script) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

// ---------- 1. web build ----------
if (skipWeb) log('web build skipped (--skip-web)');
else run(process.execPath, [join(ROOT, 'web', 'build.mjs')], 'building dist/');
if (!existsSync(join(DIST, 'index.html'))) fail('dist/index.html yok — önce "npm run build"');

// ---------- 2. icon ----------
if (!existsSync(join(RESOURCES, 'app.ico'))) run(process.execPath, [join(ROOT, 'scripts', 'make-icon.mjs')], 'rendering app.ico');
if (!existsSync(join(RESOURCES, 'app.ico'))) fail('desktop/Resources/app.ico üretilemedi');

// ---------- 3. bundle zip ----------
mkdirSync(RESOURCES, { recursive: true });
const bundleZip = join(RESOURCES, 'dist.zip');
if (existsSync(bundleZip)) rmSync(bundleZip);
log(`zipping dist/ (${walk(DIST).length} files)`);
powershell(
  `Compress-Archive -Path '${join(DIST, '*')}' -DestinationPath '${bundleZip}' -CompressionLevel Optimal -Force`,
);
if (!existsSync(bundleZip)) fail('dist.zip oluşmadı');
log(`dist.zip: ${size(bundleZip)} MB`);

// ---------- 4. publish ----------
if (existsSync(PUBLISH)) rmSync(PUBLISH, { recursive: true, force: true });
run(
  'dotnet',
  [
    'publish',
    join(DESKTOP, 'TercihPusula.Desktop.csproj'),
    '-c',
    'Release',
    '-r',
    'win-x64',
    `--self-contained`,
    selfContained ? 'true' : 'false',
    '-p:PublishSingleFile=true',
    '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:DebugType=None',
    '-p:DebugSymbols=false',
    '-o',
    PUBLISH,
  ],
  `publishing (${selfContained ? 'self-contained' : 'framework-dependent'})`,
);

const exe = join(PUBLISH, 'TercihPusula.exe');
if (!existsSync(exe)) fail('TercihPusula.exe üretilemedi');

// Single-file publish still leaves package documentation behind; keep the folder minimal.
for (const file of readdirSync(PUBLISH)) {
  if (file === 'TercihPusula.exe' || file === 'README.txt') continue;
  rmSync(join(PUBLISH, file), { recursive: true, force: true });
}

const round = (() => {
  try {
    return JSON.parse(readFileSync(join(DIST, 'data', 'lisans.json'), 'utf8')).round;
  } catch {
    return 'veri';
  }
})();
const roundTag = round.replace('/', '-');
const appVersion =
  readFileSync(join(DESKTOP, 'TercihPusula.Desktop.csproj'), 'utf8').match(/<Version>([^<]+)<\/Version>/)?.[1] ?? '—';

writeFileSync(
  join(PUBLISH, 'README.txt'),
  `Tercih Pusulası — taşınabilir Windows uygulaması

Veri dönemi: ${round}
Sürüm      : ${appVersion}

Kullanım
  1. TercihPusula.exe dosyasına çift tıklayın. Kurulum gerekmez.
  2. Veriler uygulamanın içindedir; internet bağlantısı kullanılmaz.
  3. Tercih listeniz bilgisayarınızda saklanır (yerel profil).

Gereksinim
  ${selfContained ? 'Yok — çalışma zamanı pakete gömülü.' : 'Microsoft .NET 11 Desktop Runtime ve WebView2 (Windows 10/11 ile birlikte gelir).'}
  Yoksa: https://dotnet.microsoft.com/download/dotnet/11.0

Yeni dönem verisi
  Web build çıktısını (dist klasörünün içeriği) exe'nin yanına "data-override"
  adıyla koyun; uygulama gömülü veri yerine onu kullanır.

Doğrulama
  TercihPusula.exe --self-check

Resmî olmayan karar destek aracıdır. Bağlayıcı kaynak ÖSYM tercih kılavuzudur.
`,
);

log(`exe: ${size(exe)} MB`);

// ---------- 5. portable zip ----------
const zipPath = join(OUT, `TercihPusula-win-x64-${roundTag}.zip`);
if (!noZip) {
  if (existsSync(zipPath)) rmSync(zipPath);
  powershell(
    `Compress-Archive -Path '${join(PUBLISH, '*')}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
  );
  log(`zip: ${size(zipPath)} MB → ${relative(ROOT, zipPath)}`);
}

console.log('');
console.log(`exe     : ${relative(ROOT, exe)} (${size(exe)} MB)`);
console.log(`sha256  : ${sha256(exe)}`);
if (!noZip) {
  console.log(`zip     : ${relative(ROOT, zipPath)} (${size(zipPath)} MB)`);
  console.log(`sha256  : ${sha256(zipPath)}`);
}
console.log(`mod     : ${selfContained ? 'self-contained' : 'framework-dependent'} · veri ${round}`);
