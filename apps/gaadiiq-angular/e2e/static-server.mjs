/**
 * Serves the production build for the smoke tests.
 *
 * Not `ng serve`: the dev server compiles each lazy route the first time it is
 * requested, which took long enough that the smoke suite timed out on pages
 * that were working perfectly well. This serves the built artefact instead —
 * faster, and the thing that actually ships.
 *
 * Node's own http module rather than a static-server package, so the smoke
 * tests add no dependency to install and audit.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'dist/gaadiiq-angular/browser';
const port = Number(process.argv[3] ?? 4200);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // normalize + strip leading separators: a request for /../../etc/passwd
  // must not escape the build directory.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, rel);

  if (existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
    return;
  }

  // Anything else is a client-side route: hand back index.html and let the
  // router work it out. Without this every deep link 404s.
  file = join(root, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500).end('Build not found — run `npm run build` first.');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
