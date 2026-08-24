import { describe, expect, it } from 'vitest';
import {
  hasNewerDraftEdits,
  isSameOperationScope,
  isSameReconcileScope,
  LatestSerialRunner,
} from './operation';

describe('operation scope guards', () => {
  it('rejects completions from a prior account session', () => {
    expect(isSameOperationScope(
      { epoch: 3, userId: 'user-a' },
      { epoch: 3, userId: 'user-a' },
    )).toBe(true);
    expect(isSameOperationScope(
      { epoch: 3, userId: 'user-a' },
      { epoch: 4, userId: 'user-a' },
    )).toBe(false);
    expect(isSameOperationScope(
      { epoch: 3, userId: 'user-a' },
      { epoch: 3, userId: 'user-b' },
    )).toBe(false);
  });

  it('also rejects stale timezone reconciliation results', () => {
    expect(isSameReconcileScope(
      { epoch: 1, timezone: 'Europe/Amsterdam', userId: 'user-a' },
      { epoch: 1, timezone: 'America/New_York', userId: 'user-a' },
    )).toBe(false);
  });
});

describe('save revision guard', () => {
  it('detects edits made while a save request is in flight', () => {
    expect(hasNewerDraftEdits(
      { content: 'submitted', revision: 4 },
      { content: 'submitted plus more', revision: 5 },
    )).toBe(true);
    expect(hasNewerDraftEdits(
      { content: 'submitted', revision: 4 },
      { content: 'submitted', revision: 4 },
    )).toBe(false);
  });
});

describe('LatestSerialRunner', () => {
  it('serializes work and coalesces queued inputs to the latest timezone update', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const runner = new LatestSerialRunner<number>();
    const run = async (value: number) => {
      events.push(`start:${value}`);
      if (value === 1) await firstGate;
      events.push(`end:${value}`);
    };

    runner.enqueue(1, run);
    runner.enqueue(2, run);
    runner.enqueue(3, run);
    releaseFirst();
    await runner.whenIdle();

    expect(events).toEqual(['start:1', 'end:1', 'start:3', 'end:3']);
  });
});
