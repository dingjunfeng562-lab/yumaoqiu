import { DrawAlgorithmService } from './draw-algorithm.service';

const svc = new DrawAlgorithmService();

function entrants(n: number) {
  return Array.from({ length: n }, (_, index) => ({ id: `e${index + 1}`, name: `选手${index + 1}` }));
}

function groupMatches(sizes: number[]) {
  return sizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
}

describe('DrawAlgorithmService.planGroups', () => {
  it('40 人按每组 4 人分成 10 组，出线 10 人走自动淘汰赛', () => {
    const plan = svc.planGroups({ entrantCount: 40, qualifiersPerGroup: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.groupCount).toBe(10);
    expect(plan.sizes).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
    expect(plan.qualifiersTotal).toBe(10);
    expect(plan.secondStage).toBe('AUTO');
  });

  it('39 人手动 8 组时按 5+5+5+5+5+5+5+4 均分，出线 8 人进 A-H', () => {
    const plan = svc.planGroups({ entrantCount: 39, groupCount: 8, qualifiersPerGroup: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.manualGroupCount).toBe(true);
    expect(plan.groupCount).toBe(8);
    expect(plan.sizes).toEqual([5, 5, 5, 5, 5, 5, 5, 4]);
    expect(plan.qualifiersTotal).toBe(8);
    expect(plan.secondStage).toBe('AH');
  });

  it('20 人按每组 4 人分成 5 组，不再被凑成 8 组', () => {
    const plan = svc.planGroups({ entrantCount: 20, groupSize: 4, qualifiersPerGroup: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.sizes).toEqual([4, 4, 4, 4, 4]);
    expect(plan.qualifiersTotal).toBe(10);
  });

  it('11 人按每组 4 人分成 4+4+3 三组', () => {
    const plan = svc.planGroups({ entrantCount: 11, groupSize: 4, qualifiersPerGroup: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.sizes).toEqual([4, 4, 3]);
    expect(plan.qualifiersTotal).toBe(6);
    expect(plan.secondStage).toBe('AH');
  });

  it('4 人只分 1 组，不会出现 4 个 1 人组', () => {
    const plan = svc.planGroups({ entrantCount: 4, qualifiersPerGroup: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.sizes).toEqual([4]);
  });

  it('6 人按每组 4 人分成 3+3 两组', () => {
    const plan = svc.planGroups({ entrantCount: 6, groupSize: 4, qualifiersPerGroup: 2 });
    expect(plan.errors).toEqual([]);
    expect(plan.sizes).toEqual([3, 3]);
  });

  it('每组 2 人且人数为奇数时宁可少分一组也不产生 1 人组', () => {
    const plan = svc.planGroups({ entrantCount: 3, groupSize: 2, qualifiersPerGroup: 1 });
    expect(plan.errors).toEqual([]);
    expect(plan.sizes).toEqual([3]);
  });

  it('按每组 4 人要 30 组时超过 26 组上限并报错', () => {
    const plan = svc.planGroups({ entrantCount: 120, groupSize: 4, qualifiersPerGroup: 1 });
    expect(plan.errors.join()).toContain('26 组上限');
    expect(plan.groupCount).toBe(26);
  });

  it('手动组数会导致 1 人组时报错', () => {
    const plan = svc.planGroups({ entrantCount: 6, groupCount: 8, qualifiersPerGroup: 1 });
    expect(plan.errors.join()).toContain('1 人组');
  });

  it('每组出线数超过最小组人数时报错', () => {
    // 41 人 / 每组 4 人 = 11 组，最小组 3 人，出线 4 人放不下
    const plan = svc.planGroups({ entrantCount: 41, groupSize: 4, qualifiersPerGroup: 4 });
    expect(plan.errors.join()).toContain('最小组只有 3 人');
  });

  it('每组人数、出线数超范围时报错', () => {
    expect(svc.planGroups({ entrantCount: 20, groupSize: 9 }).errors.join()).toContain('每组人数');
    expect(svc.planGroups({ entrantCount: 20, qualifiersPerGroup: 9 }).errors.join()).toContain('每组出线数');
    expect(svc.planGroups({ entrantCount: 1 }).errors.join()).toContain('至少需要 2 个报名');
  });
});

describe('DrawAlgorithmService.buildGroups', () => {
  it('严格按 sizes 建组，所有人各进一组且组内人数与计划一致', () => {
    const plan = svc.planGroups({ entrantCount: 39, groupCount: 8, qualifiersPerGroup: 1 });
    const groups = svc.buildGroups(entrants(39), [], plan.sizes);
    expect(groups.map((group) => group.groupCode)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(groups.map((group) => group.members.length)).toEqual([5, 5, 5, 5, 5, 5, 5, 4]);
    const ids = groups.flatMap((group) => group.members.map((member) => member.entrantId));
    expect(new Set(ids).size).toBe(39);
  });

  it('种子按蛇形分到各组，其余选手补齐空位', () => {
    const seeds = Array.from({ length: 8 }, (_, index) => ({ entrantId: `e${index + 1}`, seedNo: index + 1 }));
    const groups = svc.buildGroups(entrants(16), seeds, [4, 4, 4, 4]);
    // 蛇形：1–4 号种子落在 A–D，5–8 号种子折返落在 D–A。
    expect(groups.map((group) => group.members[0]?.seedNoSnapshot)).toEqual([1, 2, 3, 4]);
    expect(groups.map((group) => group.members[1]?.seedNoSnapshot)).toEqual([8, 7, 6, 5]);
    expect(groups.map((group) => group.members.length)).toEqual([4, 4, 4, 4]);
  });

  it('组代码超过 Z 时继续用 AA，不再出现 [ 或反引号', () => {
    const sizes = Array.from({ length: 27 }, () => 2);
    const groups = svc.buildGroups(entrants(54), [], sizes);
    expect(groups[25].groupCode).toBe('Z');
    expect(groups[26].groupCode).toBe('AA');
  });

  it('回归：40 人 / 每组 4 人 / 出线 1 人 = 10 组 60 场', () => {
    const plan = svc.planGroups({ entrantCount: 40, qualifiersPerGroup: 1 });
    expect(groupMatches(plan.sizes)).toBe(60);
  });
});
