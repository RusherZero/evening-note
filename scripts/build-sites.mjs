import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanGeneratedNextTypes } from './generated-types.mjs';
import { prepareServiceWorkerArtifact } from './service-worker-artifact.mjs';

const cli = fileURLToPath(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
);
cleanGeneratedNextTypes();
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

prepareServiceWorkerArtifact(join(process.cwd(), 'dist', 'client'));
console.log('Sites artifact service worker precache is ready.');
