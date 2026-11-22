import { MatchStatus } from '@prisma/client';
import {
  buildEliminationDrafts,
  buildGroupFixtureDrafts,
  planMatchReconcile,
  roundLabelForSlotCount,
  swapPositions,
} from './draw-swap-plan';

function slots(entrants: Array<string | null>) {
  return entrants.map((entrantId) => ({ entrantId, isBye: entrantId === null }));
}

describe('buildEliminationDrafts', () => {
  it('5 人 8 签：3 个轮空所在场次直接判胜，SF 一侧等对手', () => {
    // 1 袁伟 / 2 戴森全 / 3 轮空 / 4 唐靖喆 / 5 轮空 / 6 刘艺菲 / 7 轮空 / 8 赵榆鑫
    const drafts = buildEliminationDrafts(
      slots(['e1', 'e2', null, 'e4', null, 'e6', null, 'e8']),
      { bronze: true },
    ).filter((draft) => draft.round !== 'BRONZE');

    expect(drafts).toHaveLength(7);
    const round1 = drafts.filter((draft) => draft.roundNo === 1);
    expect(round1.map((draft) => [draft.matchNo, draft.side1Id, draft.side2Id, draft.status, draft.winnerSide])).toEqual([
      [1, 'e1', 'e2', MatchStatus.PENDING, null],
      [2, null, 'e4', MatchStatus.COMPLETED, 2],
      [3, null, 'e6', MatchStatus.COMPLETED, 2],
      [4, null, 'e8', MatchStatus.COMPLETED, 2],
    ]);

    const semis = drafts.filter((draft) => draft.roundNo === 2);
    expect(semis.map((draft) => [draft.side1Id, draft.side2Id])).toEqual([
      [null, 'e4'],
      ['e6', 'e8'],
    ]);
    expect(semis[0].side1Id).toBeNull();

    const final = drafts.filter((draft) => draft.roundNo === 3);
    expect(final).toHaveLength(1);
    expect(final[0].side1Id).toBeNull();
  });

  it('换签位后轮空跟着签位走，晋级链随之改变', () => {
    const before = buildEliminationDrafts(slots(['e1', 'e2', null, 'e4', null, 'e6', null, 'e8']));
    // 交换 2 号与 3 号签位：戴森全进轮空位，轮空移到 2 号 → 1 号首轮轮空。
    const after = buildEliminationDrafts(slots(['e1', null, 'e2', 'e4', null, 'e6', null, 'e8']));

    expect(before.find((draft) => draft.roundNo === 1 && draft.matchNo === 1)).toMatchObject({
      side1Id: 'e1',
      side2Id: 'e2',
      status: MatchStatus.PENDING,
      winnerSide: null,
    });
    expect(after.find((draft) => draft.roundNo === 1 && draft.matchNo === 1)).toMatchObject({
      side1Id: 'e1',
      side2Id: null,
      status: MatchStatus.COMPLETED,
      winnerSide: 1,
    });
    // 上半区：1 号轮空进 SF 一侧，另一侧等 2/4 的胜者。
    expect(after.filter((draft) => draft.roundNo === 2)[0]).toMatchObject({ side1Id: 'e1', side2Id: null });
    expect(after.find((draft) => draft.roundNo === 1 && draft.matchNo === 2)).toMatchObject({
      side1Id: 'e2',
      side2Id: 'e4',
      status: MatchStatus.PENDING,
    });
  });

  it('16 人满签：4 轮 15 场 + 季军赛', () => {
    const entrants = Array.from({ length: 16 }, (_, index) => `e${index + 1}`);
    const drafts = buildEliminationDrafts(slots(entrants), { bronze: true });
    expect(drafts.filter((draft) => draft.round !== 'BRONZE')).toHaveLength(15);
    expect(drafts.filter((draft) => draft.round === 'BRONZE')).toHaveLength(1);
    expect(drafts.every((draft) => draft.status === MatchStatus.PENDING)).toBe(true);
  });

  it('2 人两签只有决赛，没有季军赛', () => {
    const drafts = buildEliminationDrafts(slots(['e1', 'e2']), { bronze: true });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ round: 'F', roundNo: 1, matchNo: 1, status: MatchStatus.PENDING });
  });

  it('轮次名与抽签算法保持一致', () => {
    expect(roundLabelForSlotCount(2)).toBe('F');
    expect(roundLabelForSlotCount(4)).toBe('SF');
    expect(roundLabelForSlotCount(8)).toBe('QF');
    expect(roundLabelForSlotCount(16)).toBe('R1');
    expect(roundLabelForSlotCount(32)).toBe('R2');
  });
});

describe('planMatchReconcile', () => {
  it('同轮次同场号原地更新，场次 id 不变，不会产生删除', () => {
    const existing = [
      { id: 'm-qf-1', roundNo: 1, matchNo: 1 },
      { id: 'm-qf-2', roundNo: 1, matchNo: 2 },
      { id: 'm-sf-1', roundNo: 2, matchNo: 1 },
    ];
    const drafts = buildEliminationDrafts(slots(['e1', 'e2', null, 'e4']));
    const plan = planMatchReconcile(existing, drafts);

    expect(plan.deletes).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((item) => item.id)).toEqual(['m-qf-1', 'm-qf-2', 'm-sf-1']);
  });

  it('签表变大时补建缺少的场次', () => {
    const existing = [{ id: 'm-qf-1', roundNo: 1, matchNo: 1 }];
    const drafts = buildEliminationDrafts(slots(['e1', 'e2', null, 'e4']));
    const plan = planMatchReconcile(existing, drafts);
    expect(plan.updates.map((item) => item.id)).toEqual(['m-qf-1']);
    expect(plan.creates.map((item) => `${item.roundNo}#${item.matchNo}`)).toEqual(['1#2', '2#1']);
  });

  it('签表变小时删除多出来的场次', () => {
    const existing = [
      { id: 'm1', roundNo: 1, matchNo: 1 },
      { id: 'm2', roundNo: 1, matchNo: 2 },
      { id: 'm3', roundNo: 2, matchNo: 1 },
    ];
    const plan = planMatchReconcile(existing, buildEliminationDrafts(slots(['e1', 'e2'])));
    expect(plan.updates.map((item) => item.id)).toEqual(['m1']);
    expect(plan.deletes.sort()).toEqual(['m2', 'm3']);
  });
});

describe('buildGroupFixtureDrafts', () => {
  it('4 人小组 6 场，顺序与抽签生成一致', () => {
    const drafts = buildGroupFixtureDrafts(['a', 'b', 'c', 'd']);
    expect(drafts).toEqual([
      { matchNo: 1, side1Id: 'a', side2Id: 'b' },
      { matchNo: 2, side1Id: 'a', side2Id: 'c' },
      { matchNo: 3, side1Id: 'a', side2Id: 'd' },
      { matchNo: 4, side1Id: 'b', side2Id: 'c' },
      { matchNo: 5, side1Id: 'b', side2Id: 'd' },
      { matchNo: 6, side1Id: 'c', side2Id: 'd' },
    ]);
  });

  it('组间换人后场次数不变，仍按场号原地更新', () => {
    const before = buildGroupFixtureDrafts(['a', 'b', 'c', 'd']);
    const after = buildGroupFixtureDrafts(['a', 'x', 'c', 'd']);
    expect(after).toHaveLength(before.length);
    expect(after.map((draft) => draft.matchNo)).toEqual(before.map((draft) => draft.matchNo));
    expect(after[1]).toEqual({ matchNo: 2, side1Id: 'a', side2Id: 'c' });
    expect(after[3]).toEqual({ matchNo: 4, side1Id: 'x', side2Id: 'c' });
  });
});

describe('swapPositions', () => {
  it('交换两个签位，位置越界或相同时返回 null', () => {
    expect(swapPositions(['a', 'b', 'c'], 1, 3)).toEqual(['c', 'b', 'a']);
    expect(swapPositions(['a', 'b', 'c'], 2, 2)).toBeNull();
    expect(swapPositions(['a', 'b'], 1, 5)).toBeNull();
  });
});
