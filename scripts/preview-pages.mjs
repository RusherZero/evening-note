import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { normalizeBasePath } from './deployment-paths.mjs';

const root = resolve(process.cwd(), 'out');
const basePath = normalizeBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH,
  '/evening-note',
);
const port = Number(process.env.PAGES_PREVIEW_PORT || 4173);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === basePath) {
    response.writeHead(308, { Location: `${basePath}/${url.search}` });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(`${basePath}/`)) {
    response.writeHead(404).end('Not found');
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(url.pathname.slice(basePath.length + 1));
  } catch {
    response.writeHead(400).end('Bad path');
    return;
  }
  const requested = resolve(root, relativePath || 'index.html');
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let file = requested;
  if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, '404.html');
  response.writeHead(file.endsWith('404.html') ? 404 : 200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(file)] || 'application/octet-stream',
  });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Pages preview: http://127.0.0.1:${port}${basePath}/`);
});
