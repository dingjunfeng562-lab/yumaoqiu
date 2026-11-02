import { CoalescingRunner } from './coalescing-runner';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CoalescingRunner', () => {
  it('runs a single trigger once', async () => {
    const runner = new CoalescingRunner();
    const task = jest.fn(async () => {});

    await runner.trigger('m1', task);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('collapses triggers that arrive mid-run into exactly one rerun', async () => {
    const runner = new CoalescingRunner();
    const gate = deferred();
    const task = jest.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);

    const done = runner.trigger('m1', task);
    void runner.trigger('m1', task);
    void runner.trigger('m1', task);
    void runner.trigger('m1', task);
    gate.resolve();
    await done;

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('never runs the same key concurrently, so results stay in order', async () => {
    const runner = new CoalescingRunner();
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    let n = 0;
    const task = async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      const id = ++n;
      await new Promise((r) => setTimeout(r, 5));
      order.push(`run${id}`);
      running -= 1;
    };

    const done = runner.trigger('m1', task);
    await new Promise((r) => setTimeout(r, 1));
    void runner.trigger('m1', task);
    await done;

    expect(maxRunning).toBe(1);
    expect(order).toEqual(['run1', 'run2']);
  });

  it('runs different keys independently', async () => {
    const runner = new CoalescingRunner();
    const gate = deferred();
    const slow = jest.fn(() => gate.promise);
    const fast = jest.fn(async () => {});

    const a = runner.trigger('m1', slow);
    await runner.trigger('m2', fast);
    expect(fast).toHaveBeenCalledTimes(1);
    gate.resolve();
    await a;
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('reports a failing run and keeps going with the rerun', async () => {
    const onError = jest.fn();
    const runner = new CoalescingRunner(onError);
    const gate = deferred();
    const task = jest
      .fn()
      .mockImplementationOnce(async () => {
        await gate.promise;
        throw new Error('db blip');
      })
      .mockResolvedValue(undefined);

    const done = runner.trigger('m1', task);
    void runner.trigger('m1', task);
    gate.resolve();
    await expect(done).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'm1');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('starts fresh after a key goes idle', async () => {
    const runner = new CoalescingRunner();
    const task = jest.fn(async () => {});

    await runner.trigger('m1', task);
    await runner.trigger('m1', task);

    expect(task).toHaveBeenCalledTimes(2);
  });
});
