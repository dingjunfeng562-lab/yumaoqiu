import { RecognitionRateLimiter } from './recognition-rate-limit';

describe('报名表识别限频', () => {
  function setup() {
    let now = 0;
    const limiter = new RecognitionRateLimiter({ windowMs: 10 * 60_000, perUserMax: 3, globalConcurrent: 2 }, () => now);
    return { limiter, advance: (ms: number) => { now += ms; } };
  }

  it('同一账号同一时间只能识别一个文件；结束后可以继续', () => {
    const { limiter } = setup();
    const release = limiter.acquire('a');
    expect(() => limiter.acquire('a')).toThrow('上一份文件还在识别');
    release();
    release(); // 重复归还不会多放名额
    expect(() => limiter.acquire('a')).not.toThrow();
  });

  it('10 分钟内超过次数返回 429，并提示还要等几分钟；窗口过后恢复', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) { limiter.acquire('a')(); advance(60_000); }
    let error: unknown;
    try { limiter.acquire('a'); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ status: 429, message: expect.stringContaining('请 7 分钟后再试') });
    expect(() => limiter.acquire('b')).not.toThrow(); // 别的账号不受影响
    advance(8 * 60_000);
    expect(() => limiter.acquire('a')).not.toThrow();
  });

  it('全站同时识别的文件数有上限', () => {
    const { limiter } = setup();
    const releaseA = limiter.acquire('a');
    limiter.acquire('b');
    expect(() => limiter.acquire('c')).toThrow('同时识别的人较多');
    releaseA();
    expect(() => limiter.acquire('c')).not.toThrow();
  });
});
