import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeBasePath, normalizeSiteUrl } from './deployment-paths.mjs';
import { cleanGeneratedNextTypes } from './generated-types.mjs';
import { checkPagesArtifact, preparePagesArtifact } from './pages-artifact.mjs';

const basePath = normalizeBasePath(
  process.env.NEXT_PUBLIC_BASE_PATH,
  '/evening-note',
);
const siteUrl = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL || `https://rusherzero.github.io${basePath}`,
  basePath,
);
const cli = fileURLToPath(
  new URL('../node_modules/next/dist/bin/next', import.meta.url),
);
cleanGeneratedNextTypes();
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEPLOY_TARGET: 'github-pages',
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

process.env.NEXT_PUBLIC_BASE_PATH = basePath;
preparePagesArtifact();
checkPagesArtifact();
console.log('GitHub Pages artifact ready at out/.');
