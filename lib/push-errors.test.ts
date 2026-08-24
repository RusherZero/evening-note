import { describe, expect, it } from 'vitest';
import { pushFunctionErrorMessage } from './push-errors';

function functionError(status: number, error: string) {
  return {
    context: new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  };
}

describe('push function errors', () => {
  it('keeps authentication and rate-limit failures actionable', async () => {
    await expect(pushFunctionErrorMessage(
      functionError(401, 'Authentication required'),
      'test',
    )).resolves.toContain('sign-in has expired');
    await expect(pushFunctionErrorMessage(
      functionError(429, 'Wait one minute before sending another test'),
      'test',
    )).resolves.toContain('wait one minute');
  });

  it('distinguishes subscription, provider, and network failures', async () => {
    await expect(pushFunctionErrorMessage(
      functionError(400, 'Invalid subscription'),
      'sync',
    )).resolves.toContain('Turn reminders off and on again');
    await expect(pushFunctionErrorMessage(
      functionError(502, 'Test notification could not be delivered'),
      'test',
    )).resolves.toContain('push service rejected');
    await expect(pushFunctionErrorMessage(new Error('network'), 'test'))
      .resolves.toContain('reach the notification service');
  });
});

