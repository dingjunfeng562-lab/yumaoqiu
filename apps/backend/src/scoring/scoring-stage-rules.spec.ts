import { ScoringMode, ScoringRule } from '@prisma/client';
import { SECOND_STAGE_FORMAL_ROUND_NO_BASE } from '../common/second-stage-bracket';
import { ScoringService } from './scoring.service';

/**
 * 分阶段计分规则：小组赛和淘汰赛可以分开设置。
 * 典型需求：小组循环赛一局 21 分，淘汰赛 15 分三局两胜（包括 16 强、32 强）。
 */
describe('ScoringService 分阶段计分规则', () => {
  const service = new ScoringService({} as any, {} as any, {} as any, {} as any) as any;

  // 默认规则 21 分三局两胜；小组赛一局 21 分；淘汰赛 15 分三局两胜。
  const event = (stageScoringRules: Record<string, unknown> | null) => ({
    scoringRule: ScoringRule.TWENTYONE_BO3,
    scoringMode: ScoringMode.CAPPED_30,
    customGamePoint: null,
    customGameCap: null,
    customGamesToWin: null,
    stageScoringRules,
  });
  const groupAndKnockout = event({
    GROUP: { customGamePoint: 21, customGameCap: 30, customGamesToWin: 1 },
    KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
  });
  const resolve = (match: Record<string, unknown>) => service.resolveMatchScoring(match);

  it('小组赛（roundNo = 0）用小组赛规则：一局 21 分', () => {
    const scoring = resolve({ round: 'A', roundNo: 0, matchNo: 1, event: groupAndKnockout });
    expect(scoring).toMatchObject({ customGamePoint: 21, customGamesToWin: 1, appliedStage: 'GROUP' });
    expect(service.gamesToWinForMatch({ round: 'A', roundNo: 0, matchNo: 1, event: groupAndKnockout })).toBe(1);
  });

  it('16 强、32 强、八强、半决赛、决赛都用淘汰赛规则：15 分三局两胜', () => {
    for (const round of ['R2', 'R1', 'QF', 'SF', 'BRONZE', 'F']) {
      const scoring = resolve({ round, roundNo: 1, matchNo: 1, event: groupAndKnockout });
      expect({ round, rule: scoring.scoringRule, stage: scoring.appliedStage })
        .toEqual({ round, rule: ScoringRule.FIFTEEN_BO3, stage: 'KNOCKOUT' });
      expect(service.gamesToWinForMatch({ round, roundNo: 1, matchNo: 1, event: groupAndKnockout })).toBe(2);
    }
  });

  it('第 6 组「F」的小组赛不会被当成决赛', () => {
    const withFinal = event({ F: { scoringRule: ScoringRule.THIRTYONE_BO3 } });
    expect(resolve({ round: 'F', roundNo: 0, matchNo: 1, event: withFinal }).appliedStage).toBeNull();
    expect(resolve({ round: 'F', roundNo: 3, matchNo: 1, event: withFinal }).appliedStage).toBe('F');
  });

  it('更具体的阶段优先：决赛 → 四强 → 八强 → 淘汰赛 → 默认', () => {
    const layered = event({
      KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
      QF: { scoringRule: ScoringRule.FIFTEEN_ONE },
      TOP4: { scoringRule: ScoringRule.TWENTYONE_BO3 },
      F: { customGamePoint: 31, customGamesToWin: 1 },
    });
    const stageOf = (round: string) => resolve({ round, roundNo: 1, matchNo: 1, event: layered }).appliedStage;
    expect(stageOf('F')).toBe('F');
    expect(stageOf('SF')).toBe('TOP4');
    expect(stageOf('QF')).toBe('QF');
    expect(stageOf('R1')).toBe('KNOCKOUT');
    // 没设小组赛规则时，小组赛仍用默认规则，不会被淘汰赛规则影响。
    expect(resolve({ round: 'A', roundNo: 0, matchNo: 1, event: layered }).appliedStage).toBeNull();
  });

  it('小组出线后的第二阶段正式赛也算淘汰赛', () => {
    const scoring = resolve({ round: 'X', roundNo: SECOND_STAGE_FORMAL_ROUND_NO_BASE, matchNo: 1, event: groupAndKnockout });
    expect(scoring.appliedStage).toBe('KNOCKOUT');
  });

  it('旧的两段配置（BEFORE_TOP4）行为不变', () => {
    const legacy = event({ BEFORE_TOP4: { scoringRule: ScoringRule.FIFTEEN_ONE }, TOP4: { scoringRule: ScoringRule.TWENTYONE_BO3 } });
    expect(resolve({ round: 'A', roundNo: 0, matchNo: 1, event: legacy }).appliedStage).toBe('BEFORE_TOP4');
    expect(resolve({ round: 'R1', roundNo: 1, matchNo: 1, event: legacy }).appliedStage).toBe('BEFORE_TOP4');
    expect(resolve({ round: 'QF', roundNo: 2, matchNo: 1, event: legacy }).appliedStage).toBe('BEFORE_TOP4');
    expect(resolve({ round: 'SF', roundNo: 3, matchNo: 1, event: legacy }).appliedStage).toBe('TOP4');
  });

  it('没有配置分阶段规则时一律用默认规则', () => {
    const scoring = resolve({ round: 'QF', roundNo: 2, matchNo: 1, event: event(null) });
    expect(scoring).toMatchObject({ scoringRule: ScoringRule.TWENTYONE_BO3, appliedStage: null });
  });
});

/**
 * 团体赛子项：「小组赛 + 淘汰赛」赛制下按所属团体对阵的 stage 选规则。
 * 团体赛小组赛的对阵 roundNo 从 1 开始（第 1 轮、A组第 1 轮…），子项照抄，不能按 roundNo = 0 判断。
 */
describe('ScoringService 团体赛分阶段计分规则', () => {
  const service = new ScoringService({} as any, {} as any, {} as any, {} as any) as any;

  const teamCompetition = (stageScoringRules: Record<string, unknown> | null) => ({
    scoringRule: ScoringRule.TWENTYONE_BO3,
    scoringMode: ScoringMode.STANDARD_GOLDEN,
    customGamePoint: null,
    customGameCap: null,
    customGamesToWin: null,
    stageScoringRules,
  });
  const groupAndKnockout = teamCompetition({
    GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
    KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
  });
  const child = (stage: string | null, round: string, roundNo: number, competition = groupAndKnockout) => ({
    round, roundNo, matchNo: 1, event: null, teamMatch: { stage, teamCompetition: competition },
  });

  it('小组赛子项（roundNo 从 1 开始）用小组赛规则：21 分 1 局', () => {
    for (const [round, roundNo] of [['第1轮', 1], ['A组第3轮', 3]] as const) {
      const scoring = service.resolveMatchScoring(child('GROUP', round, roundNo));
      expect(scoring).toMatchObject({ customGamePoint: 21, customGamesToWin: 1, appliedStage: 'GROUP' });
      expect(service.gamesToWinForMatch(child('GROUP', round, roundNo))).toBe(1);
    }
  });

  it('淘汰赛子项（含半决赛、季军赛、决赛）用淘汰赛规则：15 分 3 局 2 胜', () => {
    for (const round of ['QF', 'SF', 'BRONZE', 'F']) {
      const scoring = service.resolveMatchScoring(child('KNOCKOUT', round, 2));
      expect({ round, rule: scoring.scoringRule, stage: scoring.appliedStage })
        .toEqual({ round, rule: ScoringRule.FIFTEEN_BO3, stage: 'KNOCKOUT' });
      expect(service.gamesToWinForMatch(child('KNOCKOUT', round, 2))).toBe(2);
    }
  });

  it('平分规则（金球 / 封顶）两个阶段都沿用团体赛默认设置', () => {
    expect(service.resolveMatchScoring(child('GROUP', '第1轮', 1)).scoringMode).toBe(ScoringMode.STANDARD_GOLDEN);
    expect(service.resolveMatchScoring(child('KNOCKOUT', 'F', 3)).scoringMode).toBe(ScoringMode.STANDARD_GOLDEN);
  });

  it('只设了一个阶段时，另一个阶段用默认规则；没设或不认识的 stage 也用默认规则', () => {
    const onlyKnockout = teamCompetition({ KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_ONE } });
    expect(service.resolveMatchScoring(child('GROUP', '第1轮', 1, onlyKnockout)))
      .toMatchObject({ scoringRule: ScoringRule.TWENTYONE_BO3, appliedStage: null });
    expect(service.gamesToWinForMatch(child('KNOCKOUT', 'F', 2, onlyKnockout))).toBe(1);
    expect(service.resolveMatchScoring(child(null, 'F', 2)).appliedStage).toBeNull();
    expect(service.resolveMatchScoring(child('GROUP', '第1轮', 1, teamCompetition(null))).appliedStage).toBeNull();
  });

  it('团体赛不认单项的阶段键：设了决赛 F 也不生效', () => {
    const withFinal = teamCompetition({ F: { scoringRule: ScoringRule.THIRTYONE_BO3 } });
    expect(service.resolveMatchScoring(child('KNOCKOUT', 'F', 3, withFinal)).appliedStage).toBeNull();
  });
});
