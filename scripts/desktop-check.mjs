// Runs the packaged app's self-check and passes its exit code through.
//   node scripts/desktop-check.mjs [--exe <path>] [--report <path>]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : null;
};

const exe = valueOf('--exe') ?? join(ROOT, 'build', 'desktop', 'TercihPusula.exe');
if (!existsSync(exe)) {
  process.stderr.write(`✗ paketlenmiş uygulama yok: ${exe}\n  önce: node scripts/desktop-build.mjs\n`);
  process.exit(2);
}

const report = valueOf('--report');
const extra = report ? ['--report', report] : [];

try {
  const output = execFileSync(exe, ['--self-check', ...extra], { encoding: 'utf8' });
  process.stdout.write(output);
  process.exit(0);
} catch (error) {
  if (error.stdout) process.stdout.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);

  const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  const policyBlocked = /Device Guard|Smart App Control|blocked by your organization|0x800711C7/i.test(combined);
  if (policyBlocked) {
    process.stderr.write(
      [
        '',
        'Smart App Control / Device Guard imzasız exe\'yi engelledi; uygulama hiç çalışmadı.',
        '  Seçenek 1: Ayarlar > Gizlilik ve güvenlik > Windows Güvenliği > Uygulama ve tarayıcı denetimi',
        '             > Smart App Control > Kapalı     (tek yönlü; geri açmak Windows sıfırlaması ister)',
        '  Seçenek 2: exe\'yi kod imzalama sertifikasıyla imzala ve build script\'e signtool adımı ekle',
        '',
      ].join('\n'),
    );
    process.exit(2);
  }

  process.exit(typeof error.status === 'number' ? error.status : 1);
}
