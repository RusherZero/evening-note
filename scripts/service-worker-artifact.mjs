import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { normalizeBasePath } from './deployment-paths.mjs';

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

export function prepareServiceWorkerArtifact(outputDirectory, basePathValue = '') {
  const basePath = normalizeBasePath(basePathValue);
  const workerPath = join(outputDirectory, 'sw.js');
  if (!existsSync(workerPath)) {
    throw new Error(`Missing generated service worker: ${workerPath}`);
  }

  const generatedAssets = filesBelow(join(outputDirectory, '_next', 'static'))
    .map((path) => relative(outputDirectory, path).split(sep).join('/'))
    .filter((path) => /\.(?:css|js|woff2?)$/.test(path))
    .sort()
    .map((path) => `${basePath}/${path}`);
  if (generatedAssets.length === 0) {
    throw new Error('No generated client assets were found for offline precaching.');
  }

  const fingerprint = createHash('sha256')
    .update(JSON.stringify(generatedAssets))
    .digest('hex')
    .slice(0, 12);
  const source = readFileSync(workerPath, 'utf8');
  const prepared = source
    .replace('__EVENING_NOTE_BUILD__', fingerprint)
    .replace(
      '/* __EVENING_NOTE_PRECACHE__ */ []',
      JSON.stringify(generatedAssets),
    );
  if (prepared === source || prepared.includes('__EVENING_NOTE_PRECACHE__')) {
    throw new Error('The generated service worker precache markers were not replaced.');
  }
  writeFileSync(workerPath, prepared);
}
