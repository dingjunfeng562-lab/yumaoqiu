import { HttpException, HttpStatus } from '@nestjs/common';

export type RecognitionRateLimitOptions = {
  /** 每人统计次数的时间窗口。 */
  windowMs: number;
  /** 每人在时间窗口内最多识别的文件数（含失败的）。 */
  perUserMax: number;
  /** 全站同时识别的文件数，防止多人同时上传大 PDF 把单进程后端压垮。 */
  globalConcurrent: number;
};

export const DEFAULT_RECOGNITION_LIMITS: RecognitionRateLimitOptions = {
  windowMs: 10 * 60_000,
  perUserMax: 30,
  globalConcurrent: 4,
};

const tooMany = (message: string) => new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);

/**
 * 报名表识别限频（进程内计数；后端是单进程部署）：
 * - 同一账号同一时间只识别一个文件（导入弹窗本来就是逐个文件识别）
 * - 同一账号 10 分钟最多 30 个文件，失败的也算，避免反复重试刷费用
 * - 全站同时最多 4 个文件在识别
 */
export class RecognitionRateLimiter {
  private readonly active = new Set<string>();
  private readonly history = new Map<string, number[]>();
  private running = 0;

  constructor(
    private readonly options: RecognitionRateLimitOptions = DEFAULT_RECOGNITION_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** 占一个名额；返回的函数在识别结束（成功或失败）后调用以归还。 */
  acquire(userId: string): () => void {
    const now = this.now();
    const recent = (this.history.get(userId) ?? []).filter((time) => now - time < this.options.windowMs);
    if (this.active.has(userId)) {
      throw tooMany('上一份文件还在识别，请等它完成后再上传');
    }
    if (recent.length >= this.options.perUserMax) {
      const minutes = Math.max(1, Math.ceil((this.options.windowMs - (now - recent[0])) / 60_000));
      throw tooMany(`识别次数太多，请 ${minutes} 分钟后再试；名单较多时建议改用 Excel 导入`);
    }
    if (this.running >= this.options.globalConcurrent) {
      throw tooMany('当前同时识别的人较多，请稍等一分钟再试');
    }
    recent.push(now);
    this.history.set(userId, recent);
    this.active.add(userId);
    this.running += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active.delete(userId);
      this.running -= 1;
      this.prune();
    };
  }

  /** 清掉窗口外的记录，避免账号多了以后 Map 一直变大。 */
  private prune() {
    const now = this.now();
    for (const [userId, times] of this.history) {
      const recent = times.filter((time) => now - time < this.options.windowMs);
      if (recent.length) this.history.set(userId, recent);
      else this.history.delete(userId);
    }
  }
}
