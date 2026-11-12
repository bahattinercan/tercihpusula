// Yerel önizleme sunucusu: dist/ klasörünü servis eder.
//   node web/serve.mjs [port]      (varsayılan 4174)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(dirname(fileURLToPath(import.meta.url))), 'dist');
const PORT = Number(process.argv[2] ?? 4174);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  if (path.endsWith('/')) path += 'index.html';
  const file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    const notFound = await readFile(join(DIST, '404.html')).catch(() => Buffer.from('404'));
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(notFound);
  }
}).listen(PORT, '127.0.0.1', () => {
  process.stderr.write(`Tercih Pusulası: http://127.0.0.1:${PORT}/  (durdurmak için Ctrl+C)\n`);
});
