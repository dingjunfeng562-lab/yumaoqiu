/**
 * Single-value cache that coalesces concurrent loads and can be invalidated
 * by a version bump.
 *
 * Built for read-heavy public endpoints that every open page refetches at the
 * same moment (e.g. on a `scoreboard:update` broadcast). Without it, N viewers
 * trigger N identical expensive loads; with it they share one.
 *
 * Freshness rules:
 * - `invalidate()` makes every later `get()` load fresh data. Call it after the
 *   write has committed and BEFORE notifying clients, so their refetch can
 *   never be answered with pre-write data.
 * - A load that started before an invalidation still resolves for the callers
 *   already waiting on it, but is never cached or handed to later callers.
 * - `ttlMs` bounds staleness for writes that don't call `invalidate()`.
 * - Failed loads are not cached; the next `get()` retries.
 */
export class VersionedCache<T> {
  private version = 0;
  private cached: { version: number; loadedAt: number; value: T } | null = null;
  private inflight: { version: number; promise: Promise<T> } | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {
    this.version += 1;
    this.cached = null;
  }

  get(load: () => Promise<T>): Promise<T> {
    const version = this.version;
    const cached = this.cached;
    if (cached && cached.version === version && this.now() - cached.loadedAt < this.ttlMs) {
      return Promise.resolve(cached.value);
    }
    if (this.inflight && this.inflight.version === version) {
      return this.inflight.promise;
    }

    // TTL counts from when the load started, so data is never older than ttlMs.
    const loadedAt = this.now();
    const promise: Promise<T> = (async () => load())()
      .then((value) => {
        if (this.version === version) {
          this.cached = { version, loadedAt, value };
        }
        return value;
      })
      .finally(() => {
        if (this.inflight?.promise === promise) this.inflight = null;
      });
    this.inflight = { version, promise };
    return promise;
  }
}
