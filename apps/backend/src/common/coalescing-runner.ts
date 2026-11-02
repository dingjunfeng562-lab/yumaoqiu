/**
 * Runs at most one task per key at a time and collapses bursts.
 *
 * `trigger(key, task)` while a task for that key is already running doesn't
 * start a second one in parallel. It marks the key dirty, and the task runs
 * exactly once more after the current run finishes. So:
 * - results for one key are produced strictly in order (no older result can
 *   overtake a newer one), and
 * - a burst of N triggers costs at most two runs.
 *
 * Tasks must read fresh state when they start; the rerun is what picks up
 * changes that landed while the previous run was in flight.
 */
export class CoalescingRunner {
  private readonly active = new Map<string, { rerun: boolean; done: Promise<void> }>();

  constructor(private readonly onError: (error: unknown, key: string) => void = () => {}) {}

  trigger(key: string, task: () => Promise<void>): Promise<void> {
    const current = this.active.get(key);
    if (current) {
      current.rerun = true;
      return current.done;
    }

    const entry = { rerun: false, done: Promise.resolve() };
    entry.done = (async () => {
      try {
        do {
          entry.rerun = false;
          try {
            await task();
          } catch (error) {
            this.onError(error, key);
          }
        } while (entry.rerun);
      } finally {
        this.active.delete(key);
      }
    })();
    this.active.set(key, entry);
    return entry.done;
  }
}
