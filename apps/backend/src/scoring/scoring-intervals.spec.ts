import { ScoringRule } from '@prisma/client';
import { ScoringService } from './scoring.service';

/**
 * 间歇与赛前练球。
 *
 * 每局领先方先到 11 分时间歇 60 秒（TECHNICAL_PAUSE），局与局之间休息 120 秒（INTERVAL_REST）；
 * 赛前练球记成 WARMUP:START:<秒> / WARMUP:END，只给裁判端倒计时用，不算比赛暂停。
 */
describe('ScoringService 间歇与赛前练球', () => {
  function setup() {
    return new ScoringService({} as any, {} as any, {} as any, {} as any) as any;
  }

  const at = (iso: string) => new Date(`2026-10-29T${iso}Z`);

  describe('11 分间歇', () => {
    it('21 分、15 分、31 分制每一局都有', () => {
      const service = setup();
      for (const rule of [ScoringRule.TWENTYONE_BO3, ScoringRule.FIFTEEN_BO3, ScoringRule.FIFTEEN_ONE, ScoringRule.THIRTYONE_BO3]) {
        expect(service.shouldUseTechnicalPauseInGame(1, rule)).toBe(true);
        expect(service.shouldUseTechnicalPauseInGame(2, rule)).toBe(true);
      }
    });

    it('打到 11 分就结束的自定义局制没有', () => {
      const service = setup();
      expect(service.shouldUseTechnicalPauseInGame(1, ScoringRule.TWENTYONE_BO3, { customGamePoint: 11 })).toBe(false);
    });

    it('有一方到 11 分时触发', () => {
      const service = setup();
      expect(service.shouldTriggerTechnicalPause(1, 11, 7, ScoringRule.TWENTYONE_BO3)).toBe(true);
      expect(service.shouldTriggerTechnicalPause(2, 6, 11, ScoringRule.TWENTYONE_BO3)).toBe(true);
      expect(service.shouldTriggerTechnicalPause(1, 10, 7, ScoringRule.TWENTYONE_BO3)).toBe(false);
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
