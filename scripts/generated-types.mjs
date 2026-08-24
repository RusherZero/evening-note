import { existsSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export function cleanGeneratedNextTypes() {
  const workspaceRoot = resolve(process.cwd());
  const generatedTypes = resolve(workspaceRoot, '.next', 'types');
  if (!generatedTypes.startsWith(`${workspaceRoot}${sep}`)) {
    throw new Error('Refusing to clean generated types outside the workspace.');
  }
  if (existsSync(generatedTypes)) {
    rmSync(generatedTypes, { recursive: true, force: true });
  }
}
