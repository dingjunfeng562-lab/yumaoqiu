import { VersionedCache } from './versioned-cache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('VersionedCache', () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 1_000;
  });

  it('coalesces concurrent gets into a single load', async () => {
    const cache = new VersionedCache<string>(3_000, now);
    const gate = deferred<string>();
    const load = jest.fn(() => gate.promise);

    const results = Promise.all([cache.get(load), cache.get(load), cache.get(load)]);
    gate.resolve('v1');

    await expect(results).resolves.toEqual(['v1', 'v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the cached value within the TTL and reloads after it', async () => {
    const cache = new VersionedCache<number>(3_000, now);
    let n = 0;
    const load = jest.fn(async () => ++n);

    await expect(cache.get(load)).resolves.toBe(1);
    clock += 2_999;
    await expect(cache.get(load)).resolves.toBe(1);
    clock += 1;
    await expect(cache.get(load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads immediately after invalidate, even within the TTL', async () => {
    const cache = new VersionedCache<number>(60_000, now);
    let n = 0;
    const load = jest.fn(async () => ++n);

    await expect(cache.get(load)).resolves.toBe(1);
    cache.invalidate();
    await expect(cache.get(load)).resolves.toBe(2);
    await expect(cache.get(load)).resolves.toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never hands a load started before invalidate to later callers', async () => {
    const cache = new VersionedCache<string>(60_000, now);
    const stale = deferred<string>();
    const fresh = deferred<string>();
    const load = jest.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const early = cache.get(load); // started before the write
    cache.invalidate(); // write committed, clients about to be notified
    const late = cache.get(load); // refetch triggered by the notification

    stale.resolve('before-write');
    fresh.resolve('after-write');

    await expect(early).resolves.toBe('before-write');
    await expect(late).resolves.toBe('after-write');
    // The stale result must not have been cached either.
    await expect(cache.get(load)).resolves.toBe('after-write');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures and retries on the next get', async () => {
    const cache = new VersionedCache<string>(60_000, now);
    const load = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce('ok');

    await expect(cache.get(load)).rejects.toThrow('db down');
    await expect(cache.get(load)).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('turns a synchronous throw in the loader into a rejection', async () => {
    const cache = new VersionedCache<string>(60_000, now);
    const load = jest.fn(() => {
      throw new Error('boom');
    });

    await expect(cache.get(load as unknown as () => Promise<string>)).rejects.toThrow('boom');
  });
});
