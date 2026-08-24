export type OperationScope = {
  epoch: number;
  userId: string;
};

export function isSameOperationScope(
  snapshot: OperationScope,
  current: OperationScope,
): boolean {
  return snapshot.epoch === current.epoch && snapshot.userId === current.userId;
}

export function isSameReconcileScope(
  snapshot: OperationScope & { timezone: string },
  current: OperationScope & { timezone: string },
): boolean {
  return isSameOperationScope(snapshot, current) && snapshot.timezone === current.timezone;
}

export function hasNewerDraftEdits(
  snapshot: { content: string; revision: number },
  current: { content: string; revision: number },
): boolean {
  return snapshot.revision !== current.revision || snapshot.content !== current.content;
}

type SerialTask<T> = {
  input: T;
  run: (input: T) => Promise<void>;
};

export class LatestSerialRunner<T> {
  private idleWaiters: Array<() => void> = [];
  private pending: SerialTask<T> | null = null;
  private running = false;

  enqueue(input: T, run: (input: T) => Promise<void>): void {
    this.pending = { input, run };
    if (!this.running) void this.drain();
  }

  whenIdle(): Promise<void> {
    if (!this.running && !this.pending) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (this.pending) {
        const task = this.pending;
        this.pending = null;
        try {
          await task.run(task.input);
        } catch {
          // Each consumer owns its error UI; keep later queued work available.
        }
      }
    } finally {
      this.running = false;
      if (this.pending) {
        void this.drain();
      } else {
        this.idleWaiters.splice(0).forEach((resolve) => resolve());
      }
    }
  }
}
