export type PushOutcome = 'sent' | 'retry' | 'expired' | 'failed';

export function classifyPushFailure(status: number | null): Exclude<PushOutcome, 'sent'> {
  if (status === 404 || status === 410) return 'expired';
  if (status === null || status === 429 || (status >= 500 && status <= 599)) return 'retry';
  return 'failed';
}

export function remainingTtlSeconds(
  scheduledFor: string,
  nowMs = Date.now(),
): number {
  const cutoff = new Date(scheduledFor).getTime() + 15 * 60 * 1000;
  return Math.floor((cutoff - nowMs) / 1000);
}
