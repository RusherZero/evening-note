import { describe, expect, it, vi } from 'vitest';
import { getInstallationId, shouldRestoreDraft } from './draft';
import type { StoredDraft } from './types';

function storedDraft(content: string, updatedAt: string): StoredDraft {
  return {
    content,
    date: '2026-08-24',
    timezone: 'Europe/Amsterdam',
    updatedAt,
  };
}

describe('shouldRestoreDraft', () => {
  it('restores a local draft only when it is newer than the saved entry', () => {
    expect(shouldRestoreDraft(
      storedDraft('new local text', '2026-08-24T20:00:01.000Z'),
      'saved text',
      '2026-08-24T20:00:00.000Z',
    )).toBe(true);

    expect(shouldRestoreDraft(
      storedDraft('old local text', '2026-08-24T19:59:59.000Z'),
      'saved text',
      '2026-08-24T20:00:00.000Z',
    )).toBe(false);
  });

  it('prefers matching server content and preserves drafts when no server row exists', () => {
    expect(shouldRestoreDraft(storedDraft('same', '2026-08-24T20:00:01.000Z'), 'same')).toBe(false);
    expect(shouldRestoreDraft(storedDraft('first draft', '2026-08-24T20:00:01.000Z'), '')).toBe(true);
    expect(shouldRestoreDraft(null, '')).toBe(false);
  });

  it('keeps a stable device ID when browser storage is unavailable', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage unavailable');
      },
    });

    try {
      const first = getInstallationId();
      expect(getInstallationId()).toBe(first);
      expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
