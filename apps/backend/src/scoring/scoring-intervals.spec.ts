import { ScoringService } from './scoring.service';

/**
 * 间歇与赛前练球。
 *
 * 裁判端已取消自动技术暂停与局间休息：11 分（或 15 分制的 8 分）不再停表、不再写
 * TECHNICAL_PAUSE / INTERVAL_REST 事件，只有裁判手动按下的暂停才算暂停。
 * 赛前练球记成 WARMUP:START:<秒> / WARMUP:END，只给裁判端倒计时用，不算比赛暂停。
 */
describe('ScoringService 间歇与赛前练球', () => {
  function setup() {
    return new ScoringService({} as any, {} as any, {} as any, {} as any) as any;
  }

  const at = (iso: string) => new Date(`2026-10-29T${iso}Z`);

  describe('暂停只认手动暂停', () => {
    it('旧的 11 分技术暂停 / 局间休息事件不再判为暂停', () => {
      const service = setup();
      const pause = service.computePauseState([
        { note: 'TECHNICAL_PAUSE:START:1', createdAt: at('08:00:00') },
        { note: 'INTERVAL_REST:START:2', createdAt: at('08:10:00') },
      ]);
      expect(pause.paused).toBe(false);
      expect(pause.pauseKind).toBeNull();
    });

    it('手动暂停开始与结束成对计算', () => {
      const service = setup();
      const paused = service.computePauseState([
        { note: 'MATCH_PAUSE:START:医疗', createdAt: at('08:00:00') },
      ]);
      expect(paused.paused).toBe(true);
      expect(paused.pauseKind).toBe('manual');
      expect(paused.pauseReason).toBe('医疗');

      const resumed = service.computePauseState([
        { note: 'MATCH_PAUSE:START', createdAt: at('08:00:00') },
        { note: 'MATCH_PAUSE:END', createdAt: at('08:01:00') },
      ]);
      expect(resumed.paused).toBe(false);
      expect(resumed.pausedDurationMs).toBe(60_000);
    });
  });

  describe('赛前练球', () => {
    it('开始后返回开始时间和时长', () => {
      const service = setup();
      const state = service.computeWarmupState([{ note: 'WARMUP:START:180', createdAt: at('08:00:00') }]);
      expect(state).toEqual({ startedAt: at('08:00:00'), seconds: 180 });
    });

    it('重新开始按最新的时长算，结束后没有练球', () => {
      const service = setup();
      const restarted = service.computeWarmupState([
        { note: 'WARMUP:START:180', createdAt: at('08:00:00') },
        { note: 'WARMUP:START:120', createdAt: at('08:01:00') },
      ]);
      expect(restarted).toEqual({ startedAt: at('08:01:00'), seconds: 120 });

      const ended = service.computeWarmupState([
        { note: 'WARMUP:START:180', createdAt: at('08:00:00') },
        { note: 'WARMUP:END', createdAt: at('08:02:00') },
      ]);
      expect(ended).toBeNull();
    });

    it('比赛开始过之前的练球不再显示', () => {
      const service = setup();
      const state = service.computeWarmupState(
        [{ note: 'WARMUP:START:180', createdAt: at('08:00:00') }],
        at('08:05:00'),
      );
      expect(state).toBeNull();
    });

    it('练球不算比赛暂停', () => {
      const service = setup();
      const pause = service.computePauseState([{ note: 'WARMUP:START:180', createdAt: at('08:00:00') }]);
      expect(pause.paused).toBe(false);
    });
  });
});
