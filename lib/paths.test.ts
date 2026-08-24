import { describe, expect, it } from 'vitest';
import { isPathInsideBasePath, normalizeBasePath, withBasePath } from './paths';

describe('deployment paths', () => {
  it('normalizes root and project-site base paths', () => {
    expect(normalizeBasePath(undefined)).toBe('');
    expect(normalizeBasePath('/')).toBe('');
    expect(normalizeBasePath(' evening-note/ ')).toBe('/evening-note');
  });

  it('prefixes public assets without changing root deployments', () => {
    expect(withBasePath('/sw.js')).toBe('/sw.js');
    expect(withBasePath('sw.js', '/evening-note/')).toBe('/evening-note/sw.js');
    expect(withBasePath('/', '/evening-note')).toBe('/evening-note/');
  });

  it('rejects same-origin paths outside a project-site scope', () => {
    expect(isPathInsideBasePath('/evening-note/', '/evening-note')).toBe(true);
    expect(isPathInsideBasePath('/evening-note/history', '/evening-note')).toBe(true);
    expect(isPathInsideBasePath('/another-project/', '/evening-note')).toBe(false);
    expect(isPathInsideBasePath('/evening-notes/', '/evening-note')).toBe(false);
  });
});
