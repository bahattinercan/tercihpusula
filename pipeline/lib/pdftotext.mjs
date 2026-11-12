import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let versionCache;

// On Windows this machine has pdftotext only inside Git's MSYS2 tree
// (C:\Program Files\Git\ucrt64\bin\pdftotext.exe), which is on Git-Bash's PATH
// but not on the PATH Node inherits. Resolve it explicitly.
const CANDIDATES = [
  process.env.PDFTOTEXT_BIN,
  'pdftotext',
  'C:\\Program Files\\Git\\ucrt64\\bin\\pdftotext.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe',
  'C:\\msys64\\ucrt64\\bin\\pdftotext.exe',
  'C:\\Program Files\\xpdf\\bin64\\pdftotext.exe',
].filter(Boolean);

function resolveBinary() {
  for (const candidate of CANDIDATES) {
    const res = spawnSync(candidate, ['-v'], { encoding: 'utf8' });
    if (!res.error) return candidate;
  }
  return null;
}

export function pdftotextBinary() {
  if (versionCache === undefined) versionCache = resolveBinary();
  return versionCache;
}

export function pdftotextVersion() {
  const bin = pdftotextBinary();
  if (!bin) return null;
  const res = spawnSync(bin, ['-v'], { encoding: 'utf8' });
  const line = `${res.stderr ?? ''}${res.stdout ?? ''}`.split('\n').find((l) => /pdftotext version/i.test(l));
  return line?.trim() ?? bin;
}

/**
 * Extract the text layer of a PDF with layout preserved.
 * `pdftotext` (xpdf 4.06) is already installed on this machine; using it keeps
 * the pipeline free of npm dependencies.
 * @param {Buffer} pdf
 * @returns {string}
 */
export function pdfToText(pdf) {
  const bin = pdftotextBinary();
  if (!bin) {
    throw new Error('pdftotext not found (set PDFTOTEXT_BIN). The pipeline intentionally has no npm PDF dependency.');
  }
  const dir = mkdtempSync(join(tmpdir(), 'tercihpusula-'));
  const pdfPath = join(dir, 'in.pdf');
  try {
    writeFileSync(pdfPath, pdf);
    const res = spawnSync(bin, ['-table', '-enc', 'UTF-8', pdfPath, '-'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.status !== 0) {
      throw new Error(`pdftotext exited ${res.status}: ${res.stderr?.toString('utf8').trim()}`);
    }
    return res.stdout.toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
