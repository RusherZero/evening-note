import { describe, expect, it } from 'vitest';
import { safeNotificationTarget, urlBase64ToUint8Array } from './pwa';

describe('PWA helpers', () => {
  it('decodes VAPID base64url values', () => {
    expect(Array.from(urlBase64ToUint8Array('AQIDBA'))).toEqual([1, 2, 3, 4]);
  });

  it('keeps notification navigation on the app origin', () => {
    const origin = 'https://evening-note.example';
    expect(safeNotificationTarget('/?view=history', origin)).toBe(
      'https://evening-note.example/?view=history',
    );
    expect(safeNotificationTarget('https://attacker.example/', origin)).toBe(
      'https://evening-note.example/?view=today',
    );
  });
});
