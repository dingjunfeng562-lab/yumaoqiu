import { DrawAlgorithmService } from './draw-algorithm.service';
import {
  drawnGroupSettingsSnapshot,
  groupPlanDrift,
  readDrawnGroupSettings,
} from './group-plan-drift';

const algorithm = new DrawAlgorithmService();
const plan = (entrantCount: number, groupSize: number | null, groupCount: number | null = null) =>
  algorithm.planGroups({ entrantCount, groupSize, groupCount, qualifiersPerGroup: 1 });

describe('groupPlanDrift 签表与分组设置是否一致', () => {
  it('抽签后把「手动 5 组」改成「每组 5 人」：提示 5 组 → 3 组', () => {
    const drift = groupPlanDrift({
      plan: plan(11, 5),
      currentSizes: [3, 2, 2, 2, 2],
      event: { groupSize: 5, groupCount: null, drawPublished: false },
      drawnWith: { groupSize: null, groupCount: 5, qualifiersPerGroup: 1 },
      playedMatches: 0,
    });
    expect(drift).toEqual({
      currentGroupCount: 5,
      currentSizes: [3, 2, 2, 2, 2],
      planGroupCount: 3,
      planSizes: [4, 4, 3],
      settingsChangedAfterDraw: true,
    });
  });

  it('抽签后改了设置，即使已发布、已开赛也提示', () => {
    const drift = groupPlanDrift({
      plan: plan(11, 5),
      currentSizes: [3, 2, 2, 2, 2],
      event: { groupSize: 5, groupCount: null, drawPublished: true },
      drawnWith: { groupSize: null, groupCount: 5, qualifiersPerGroup: 1 },
      playedMatches: 4,
    });
    expect(drift?.settingsChangedAfterDraw).toBe(true);
  });

  it('分组一致（不计组的顺序）时不提示', () => {
    expect(
      groupPlanDrift({
        plan: plan(11, 5),
        currentSizes: [3, 4, 4],
        event: { groupSize: 5, groupCount: null, drawPublished: false },
        drawnWith: { groupSize: 4, groupCount: null, qualifiersPerGroup: 1 },
        playedMatches: 0,
      }),
    ).toBeNull();
  });

  it('旧签表（无快照）已发布或已开赛：不提示，避免诱导重抽进行中的比赛', () => {
    const base = {
      plan: plan(38, null),
      currentSizes: Array.from({ length: 16 }, (_, index) => (index < 6 ? 3 : 2)),
      event: { groupSize: null, groupCount: null, drawPublished: true },
      drawnWith: null,
      playedMatches: 0,
    };
    expect(groupPlanDrift(base)).toBeNull();
    expect(
      groupPlanDrift({ ...base, event: { ...base.event, drawPublished: false }, playedMatches: 3 }),
    ).toBeNull();
  });

  it('旧签表（无快照）未发布、也没打过：提示，且标记为不是改设置导致', () => {
    const drift = groupPlanDrift({
      plan: plan(12, null),
      currentSizes: [3, 3, 3, 3],
      event: { groupSize: null, groupCount: null, drawPublished: false },
      drawnWith: null,
      playedMatches: 0,
    });
    expect(drift?.planSizes).toEqual([4, 4, 4]);
    expect(drift?.settingsChangedAfterDraw).toBe(false);
  });

  it('设置没改、只是签表已发布：不提示', () => {
    expect(
      groupPlanDrift({
        plan: plan(13, 4),
        currentSizes: [4, 4, 4],
        event: { groupSize: 4, groupCount: null, drawPublished: true },
        drawnWith: { groupSize: 4, groupCount: null, qualifiersPerGroup: 1 },
        playedMatches: 0,
      }),
    ).toBeNull();
  });

  it('分组计划本身有错时不重复提示', () => {
    expect(
      groupPlanDrift({
        plan: plan(11, null, 8),
        currentSizes: [3, 3, 3, 2],
        event: { groupSize: null, groupCount: 8, drawPublished: false },
        drawnWith: { groupSize: null, groupCount: 4, qualifiersPerGroup: 1 },
        playedMatches: 0,
      }),
    ).toBeNull();
  });

  it('没有签表分组（如淘汰赛）时不提示', () => {
    expect(
      groupPlanDrift({
        plan: null,
        currentSizes: [],
        event: { groupSize: null, groupCount: null, drawPublished: false },
        drawnWith: null,
        playedMatches: 0,
      }),
    ).toBeNull();
  });
});

describe('抽签时的分组设置快照', () => {
  it('写入与读回一致', () => {
    const snapshot = drawnGroupSettingsSnapshot({ groupSize: 5, groupCount: null, qualifiersPerGroup: 1 });
    expect(readDrawnGroupSettings({ drawId: 'd1', version: 2, groupSettings: snapshot })).toEqual({
      groupSize: 5,
      groupCount: null,
      qualifiersPerGroup: 1,
    });
  });

  it('旧日志没有快照时返回 null', () => {
    expect(readDrawnGroupSettings({ drawId: 'd1', version: 1, format: 'group_then_elim' })).toBeNull();
    expect(readDrawnGroupSettings(null)).toBeNull();
    expect(readDrawnGroupSettings([1, 2])).toBeNull();
  });
});
