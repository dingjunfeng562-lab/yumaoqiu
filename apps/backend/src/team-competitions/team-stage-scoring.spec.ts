import { ConflictException } from '@nestjs/common';
import { Prisma, ScoringMode, ScoringRule, TeamCompetitionFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCompetitionsService } from './team-competitions.service';
import { normalizeTeamStageScoringRules, sameTeamStageScoringRules } from './team-stage-scoring';

/**
 * 团体赛分阶段计分：「小组赛 + 淘汰赛」赛制下，小组赛和淘汰赛的子项可以用不同的计分规则，
 * 例如小组赛 21 分 1 局、淘汰赛 15 分 3 局 2 胜。
 */
describe('团体赛分阶段计分：清洗规则', () => {
  const GPK = TeamCompetitionFormat.GROUP_PLUS_KNOCKOUT;

  it('小组赛自定义分数、淘汰赛选预设都能保留；自定义不填局数时按 1 局', () => {
    expect(normalizeTeamStageScoringRules({
      GROUP: { customGamePoint: 21 },
      KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
    }, GPK)).toEqual({
      GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
      KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
    });
  });

  it('其它赛制只有一个阶段，分阶段规则一律清空', () => {
    const rules = { GROUP: { customGamePoint: 21 }, KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 } };
    for (const format of [
      TeamCompetitionFormat.SINGLE_ELIMINATION,
      TeamCompetitionFormat.ROUND_ROBIN,
      TeamCompetitionFormat.GROUP_ROUND_ROBIN,
    ]) {
      expect(normalizeTeamStageScoringRules(rules, format)).toBeNull();
    }
  });

  it('没有预设也没有分数的阶段丢掉；全部为空时等同未配置', () => {
    expect(normalizeTeamStageScoringRules({ GROUP: {}, KNOCKOUT: { customGameCap: 30 } }, GPK)).toBeNull();
    expect(normalizeTeamStageScoringRules(null, GPK)).toBeNull();
    expect(normalizeTeamStageScoringRules({ KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_ONE } }, GPK))
      .toEqual({ KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_ONE } });
  });

  it('封顶分小于每局分数时报错，并指明是哪个阶段', () => {
    expect(() => normalizeTeamStageScoringRules({ KNOCKOUT: { customGamePoint: 21, customGameCap: 20 } }, GPK))
      .toThrow('淘汰赛的封顶分不能小于每局分数');
  });

  it('比较两份规则时与键的顺序无关；null 与未设置相同', () => {
    expect(sameTeamStageScoringRules(
      { GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 }, KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' } },
      { KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' }, GROUP: { customGamesToWin: 1, customGameCap: null, customGamePoint: 21 } },
    )).toBe(true);
    expect(sameTeamStageScoringRules(null, undefined)).toBe(true);
    expect(sameTeamStageScoringRules({ GROUP: { scoringRule: 'FIFTEEN_ONE' } }, null)).toBe(false);
  });

  it('请求里的分阶段规则逐项校验：预设必须是已有规则，分数在 1–999', async () => {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const { UpdateTeamCompetitionDto } = await import('./dto/team-competition.dto');
    const errorsOf = async (stageScoringRules: unknown) =>
      (await validate(plainToInstance(UpdateTeamCompetitionDto, { stageScoringRules })))
        .filter((error) => error.property === 'stageScoringRules');
    expect(await errorsOf({ GROUP: { customGamePoint: 21, customGamesToWin: 1 }, KNOCKOUT: { scoringRule: 'FIFTEEN_BO3' } })).toHaveLength(0);
    expect(await errorsOf(null)).toHaveLength(0);
    expect(await errorsOf({ KNOCKOUT: { scoringRule: 'TEN_POINTS' } })).toHaveLength(1);
    expect(await errorsOf({ GROUP: { customGamePoint: 0 } })).toHaveLength(1);
  });
});

describe('团体赛分阶段计分：保存', () => {
  const stageRules = {
    GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 },
    KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
  };

  function setup(options: { teamMatches?: number; current?: Record<string, unknown> } = {}) {
    const current = {
      id: 'comp1',
      format: TeamCompetitionFormat.GROUP_PLUS_KNOCKOUT,
      groupCount: 2,
      advancePerGroup: 2,
      winThreshold: 3,
      maxPlayerAppearances: 2,
      playAllMatches: false,
      thirdPlaceMode: 'BY_RECORD',
      scoringRule: ScoringRule.TWENTYONE_BO3,
      scoringMode: ScoringMode.CAPPED_30,
      customGamePoint: null,
      customGameCap: null,
      customGamesToWin: null,
      stageScoringRules: stageRules,
      items: ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES']
        .map((eventType, index) => ({ id: `item${index + 1}`, eventType, sortOrder: index + 1 })),
      ...options.current,
    };
    const tx = { teamCompetition: { update: jest.fn().mockResolvedValue({}) } };
    const prisma = {
      teamCompetition: { findUnique: jest.fn().mockResolvedValue(current) },
      teamMatch: { count: jest.fn().mockResolvedValue(options.teamMatches ?? 0) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    };
    const service = new TeamCompetitionsService(prisma as unknown as PrismaService);
    jest.spyOn(service, 'findOne').mockResolvedValue({} as never);
    const savedData = () => tx.teamCompetition.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    return { service, tx, savedData };
  }

  it('已生成对阵后，原样提交（键顺序不同）不算修改，可以正常保存其它设置', async () => {
    const { service, savedData } = setup({ teamMatches: 6 });
    await service.update('comp1', {
      isPublished: true,
      stageScoringRules: {
        KNOCKOUT: { scoringRule: ScoringRule.FIFTEEN_BO3 },
        GROUP: { customGamesToWin: 1, customGamePoint: 21 },
      },
    });
    expect(savedData()).toEqual({ isPublished: true });
  });

  it('已生成对阵后不能改分阶段计分', async () => {
    const { service, tx } = setup({ teamMatches: 6 });
    await expect(service.update('comp1', {
      stageScoringRules: { GROUP: { customGamePoint: 21, customGamesToWin: 1 }, KNOCKOUT: { scoringRule: ScoringRule.TWENTYONE_BO3 } },
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.teamCompetition.update).not.toHaveBeenCalled();
  });

  it('未生成对阵时保存清洗后的规则；全部改回默认时存成 JSON null', async () => {
    const changed = setup({ current: { stageScoringRules: null } });
    await changed.service.update('comp1', { stageScoringRules: { GROUP: { customGamePoint: 21 } } });
    expect(changed.savedData().stageScoringRules).toEqual({ GROUP: { customGamePoint: 21, customGameCap: null, customGamesToWin: 1 } });

    const cleared = setup();
    await cleared.service.update('comp1', { stageScoringRules: null });
    expect(cleared.savedData().stageScoringRules).toBe(Prisma.JsonNull);
  });

  it('改成没有淘汰赛阶段的赛制时，分阶段计分一并清空', async () => {
    const { service, savedData } = setup();
    await service.update('comp1', { format: TeamCompetitionFormat.GROUP_ROUND_ROBIN, advancePerGroup: null });
    expect(savedData()).toMatchObject({ format: TeamCompetitionFormat.GROUP_ROUND_ROBIN, stageScoringRules: Prisma.JsonNull });
  });

  it('请求里没带分阶段计分时保持原样', async () => {
    const { service, savedData } = setup();
    await service.update('comp1', { description: '说明' });
    expect(savedData()).toEqual({ description: '说明' });
  });
});
