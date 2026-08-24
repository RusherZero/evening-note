import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeBasePath } from './deployment-paths.mjs';
import { prepareServiceWorkerArtifact } from './service-worker-artifact.mjs';

export const clientDirectory = join(process.cwd(), 'out');

function filesBelow(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...filesBelow(path));
    else files.push(path);
  }
  return files;
}

function flattenBasePathAssets(basePath) {
  if (!basePath) return;
  const nestedRoot = join(clientDirectory, ...basePath.slice(1).split('/'));
  const nestedAssets = join(nestedRoot, '_next');
  const rootAssets = join(clientDirectory, '_next');
  if (!existsSync(nestedAssets)) return;
  if (existsSync(rootAssets)) {
    throw new Error('Both nested and root _next asset directories exist.');
  }

  renameSync(nestedAssets, rootAssets);
  let directory = nestedRoot;
  while (directory !== clientDirectory && readdirSync(directory).length === 0) {
    rmdirSync(directory);
    directory = dirname(directory);
  }
}

export function preparePagesArtifact() {
  const basePath = normalizeBasePath(
    process.env.NEXT_PUBLIC_BASE_PATH,
    '/evening-note',
  );
  flattenBasePathAssets(basePath);
  prepareServiceWorkerArtifact(clientDirectory, basePath);
  writeFileSync(join(clientDirectory, '.nojekyll'), '');
}

export function checkPagesArtifact() {
  const basePath = normalizeBasePath(
    process.env.NEXT_PUBLIC_BASE_PATH,
    '/evening-note',
  );
  const required = [
    '.nojekyll',
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    'offline.html',
    'icon-192.png',
    'icon-512.png',
    'apple-touch-icon.png',
  ];
  const missing = required.filter((path) => !existsSync(join(clientDirectory, path)));
  if (missing.length > 0) {
    throw new Error(`Pages artifact is missing: ${missing.join(', ')}`);
  }
  if (basePath && existsSync(join(clientDirectory, basePath.slice(1), '_next'))) {
    throw new Error('Pages artifact contains a duplicated base-path asset directory.');
  }

  const html = readFileSync(join(clientDirectory, 'index.html'), 'utf8');
  if (!html.includes(`${basePath}/_next/`)) {
    throw new Error(`index.html does not reference assets under ${basePath}/_next/.`);
  }
  if (/(?:src|href)=["']\/(?:_next|manifest\.webmanifest|sw\.js)/.test(html)) {
    throw new Error('index.html contains a host-rooted app asset URL.');
  }

  const generatedCss = filesBelow(join(clientDirectory, '_next', 'static'))
    .filter((path) => path.endsWith('.css'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  if (!generatedCss.includes('.min-h-screen')) {
    throw new Error('Pages artifact is missing generated Tailwind utility styles.');
  }

  const manifest = JSON.parse(
    readFileSync(join(clientDirectory, 'manifest.webmanifest'), 'utf8'),
  );
  const manifestUrl = new URL(
    `https://pages.example${basePath}/manifest.webmanifest`,
  );
  const expectedScope = `${basePath}/`;
  for (const field of ['id', 'scope', 'start_url']) {
    if (new URL(manifest[field], manifestUrl).pathname !== expectedScope) {
      throw new Error(`Manifest ${field} escapes ${expectedScope}.`);
    }
  }
  for (const icon of manifest.icons) {
    if (!new URL(icon.src, manifestUrl).pathname.startsWith(expectedScope)) {
      throw new Error(`Manifest icon escapes ${expectedScope}: ${icon.src}`);
    }
  }

  const worker = readFileSync(join(clientDirectory, 'sw.js'), 'utf8');
  if (worker.includes('__EVENING_NOTE_BUILD__') || worker.includes('__EVENING_NOTE_PRECACHE__')) {
    throw new Error('The service worker still contains unprepared build markers.');
  }
}
