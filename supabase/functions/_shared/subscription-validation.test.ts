import { describe, expect, it } from 'vitest';
import { validPushEndpoint, validPushKeys } from './subscription-validation';

const VALID_P256DH = 'BHgKOEf39QDyA76qjvmFAldXrSaBFBVLfoozk-hRWSHf_5MLwYuJ-98VSNFsNpl1Cv4EVi233tZ6x9YY0bRZoUE';
const VALID_AUTH = 'BwcHBwcHBwcHBwcHBwcHBw';

describe('push subscription validation', () => {
  it('allows only known browser push HTTPS origins on the default port', () => {
    expect(validPushEndpoint('https://web.push.apple.com/device/token')).toBe(true);
    expect(validPushEndpoint('https://fcm.googleapis.com/fcm/send/token')).toBe(true);
    expect(validPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/token')).toBe(true);
    expect(validPushEndpoint('https://web.push.apple.com.evil.test/device/token')).toBe(false);
    expect(validPushEndpoint('https://web.push.apple.com:8443/device/token')).toBe(false);
    expect(validPushEndpoint('https://127.0.0.1/push')).toBe(false);
  });

  it('decodes exact Web Push key sizes and verifies the P-256 point', async () => {
    await expect(validPushKeys(VALID_P256DH, VALID_AUTH)).resolves.toBe(true);
    await expect(validPushKeys(`A${VALID_P256DH.slice(1)}`, VALID_AUTH)).resolves.toBe(false);
    await expect(validPushKeys(`B${'A'.repeat(86)}`, VALID_AUTH)).resolves.toBe(false);
    await expect(validPushKeys(VALID_P256DH, 'too-short')).resolves.toBe(false);
    await expect(validPushKeys('*'.repeat(87), VALID_AUTH)).resolves.toBe(false);
  });
});
