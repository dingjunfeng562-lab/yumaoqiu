import {
  buildKnockoutSkeleton,
  canonicalSeedOrder,
  groupSizesFromGroupMatches,
  knockoutPlaceholderNames,
  knockoutPlaceholderSlots,
  knockoutPlaceholdersOnly,
  knockoutSlotKey,
  placeGroupQualifiers,
  skeletonFromGroupMatches,
  type GroupQualifier,
} from './knockout-skeleton';

type Entrant = { id: string; group: string; rank: number };

const groupCode = (index: number) =>
  index < 26
    ? String.fromCharCode(65 + index)
    : `A${String.fromCharCode(65 + index - 26)}`;

/** 按各组人数和每组出线数造出线名单（id = 组别+名次，如 A1、B2）。 */
function qualifiersFor(groupSizes: number[], perGroup: number) {
  const groups = groupSizes.map((_, index) => groupCode(index));
  const qualifiers: Array<GroupQualifier<Entrant>> = [];
  groups.forEach((group, index) => {
    for (
      let rank = 1;
      rank <= Math.min(perGroup, groupSizes[index]);
      rank += 1
    ) {
      qualifiers.push({
        group,
        rank,
        entrant: { id: `${group}${rank}`, group, rank },
      });
    }
  });
  return { groups, qualifiers };
}

/** 签位 a、b（0 起）最早在第几轮相遇：1 = 首轮。 */
const meetingRound = (a: number, b: number) => 32 - Math.clz32(a ^ b);

function expectFairBracket(groupSizes: number[], perGroup: number) {
  const { groups, qualifiers } = qualifiersFor(groupSizes, perGroup);
  const slots = placeGroupQualifiers(groups, qualifiers);
  const size = slots.length;
  const totalRounds = Math.log2(size);

  // 签表大小是不小于出线人数的 2 的幂，每名出线者恰好入签一次。
  expect(size).toBe(2 ** Math.ceil(Math.log2(qualifiers.length)));
  const placedIds = slots
    .filter((slot): slot is Entrant => Boolean(slot))
    .map((slot) => slot.id)
    .sort();
  expect(placedIds).toEqual(
    qualifiers.map((qualifier) => qualifier.entrant.id).sort(),
  );

  const byeHolders: Entrant[] = [];
  for (let index = 0; index < size; index += 2) {
    const [a, b] = [slots[index], slots[index + 1]];
    // 每场至少一名真实选手：不会有两边都空、或一边永远等不到对手的场次。
    expect(a || b).toBeTruthy();
    // 首轮不同组。
    if (a && b) expect(a.group).not.toBe(b.group);
    if (!a || !b) byeHolders.push((a ?? b)!);
  }
  // 轮空先给小组第 1 名：轮空不够分时只给小组第 1 名；够分时每个小组第 1 名都轮空。
  const winnerIds = qualifiers
    .filter((qualifier) => qualifier.rank === 1)
    .map((qualifier) => qualifier.entrant.id);
  expect(byeHolders).toHaveLength(size - qualifiers.length);
  if (byeHolders.length <= winnerIds.length) {
    expect(byeHolders.every((holder) => holder.rank === 1)).toBe(true);
  } else {
    expect(
      winnerIds.every((id) => byeHolders.some((holder) => holder.id === id)),
    ).toBe(true);
  }

  for (const group of groups) {
    const positions = slots.flatMap((slot, position) =>
      slot?.group === group ? [position] : [],
    );
    const winner = slots.findIndex(
      (slot) => slot?.group === group && slot.rank === 1,
    );
    const runnerUp = slots.findIndex(
      (slot) => slot?.group === group && slot.rank === 2,
    );
    // 同组第 1、2 名分在上下半区：决赛前不会再相遇。
    if (winner >= 0 && runnerUp >= 0)
      expect(meetingRound(winner, runnerUp)).toBe(totalRounds);
    // 同组任意两人（出线 3 人以上时）最早也要到半决赛才相遇。
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        expect(meetingRound(positions[i], positions[j])).toBeGreaterThanOrEqual(
          totalRounds - 1,
        );
      }
    }
  }
  return slots;
}

describe('placeGroupQualifiers：小组出线 → 单淘汰签位', () => {
  it('12 组每组 3 人、出线 2 人（24 人进 32 签）：8 个轮空全给小组第 1 名，没有空场', () => {
    const slots = expectFairBracket(Array<number>(12).fill(3), 2);
    expect(slots).toHaveLength(32);
    const firstRound: string[] = [];
    for (let index = 0; index < slots.length; index += 2) {
      firstRound.push(
        `${slots[index]?.id ?? '轮空'}-${slots[index + 1]?.id ?? '轮空'}`,
      );
    }
    expect(firstRound).toEqual([
      'A1-轮空',
      'C2-F2',
      'H1-轮空',
      'I1-K2',
      'D1-轮空',
      'B2-G2',
      'E1-轮空',
      'L1-J2',
      'B1-轮空',
      'D2-E2',
      'G1-轮空',
      'J1-L2',
      'C1-轮空',
      'A2-H2',
      'F1-轮空',
      'K1-I2',
    ]);
  });

  it.each<[string, number[], number]>([
    ['6 组（19 人手动分组 4+3+3+3+3+3）出线 2 人', [4, 3, 3, 3, 3, 3], 2],
    ['6 组每组 3 人出线 2 人', Array<number>(6).fill(3), 2],
    ['38 组每组 3 人出线 2 人（76 人进 128 签）', Array<number>(38).fill(3), 2],
    ['8 组出线 2 人（正好 16 签）', Array<number>(8).fill(4), 2],
    ['5 组出线 2 人（轮空比小组第 1 名多）', Array<number>(5).fill(4), 2],
    ['10 组出线 3 人', Array<number>(10).fill(4), 3],
    ['7 组出线 3 人（21 人进 32 签，11 个轮空）', Array<number>(7).fill(4), 3],
    ['11 组出线 1 人（5 个轮空）', Array<number>(11).fill(4), 1],
    ['某组人数少于出线数', [4, 4, 4, 2, 4, 4], 3],
  ])('%s：每场至少一名真实选手，同组分区', (_label, sizes, perGroup) => {
    expectFairBracket(sizes, perGroup);
  });

  it('每组出线 1 人时与标准种子位一致（各组第 1 名按组别顺序为 1、2、3…号种子）', () => {
    const { groups, qualifiers } = qualifiersFor(Array<number>(10).fill(4), 1);
    const slots = placeGroupQualifiers(groups, qualifiers);
    const expected = canonicalSeedOrder(16).map((seed) =>
      seed <= 10 ? `${groups[seed - 1]}1` : null,
    );
    expect(slots.map((slot) => slot?.id ?? null)).toEqual(expected);
  });

  it('轮空数为单数时上半区多一个：9 人进 16 签、7 个轮空，7、8 号种子（连同对面）对调', () => {
    const { groups, qualifiers } = qualifiersFor(Array<number>(9).fill(4), 1);
    const slots = placeGroupQualifiers(groups, qualifiers);
    const swapped: Record<number, number> = { 7: 8, 8: 7, 9: 10, 10: 9 };
    const expected = canonicalSeedOrder(16).map((seed) => {
      const placed = swapped[seed] ?? seed;
      return placed <= 9 ? `${groups[placed - 1]}1` : null;
    });
    expect(slots.map((slot) => slot?.id ?? null)).toEqual(expected);
    expect(slots.slice(0, 8).filter((slot) => !slot)).toHaveLength(4);
    expect(slots.slice(8).filter((slot) => !slot)).toHaveLength(3);
  });

  it('轮空平均分布：上半区比下半区多 0 或 1 个，同级相邻分区最多差 1 个', () => {
    for (const perGroup of [1, 2, 3]) {
      for (let groupCount = 2; groupCount <= 50; groupCount += 1) {
        const { groups, qualifiers } = qualifiersFor(
          Array<number>(groupCount).fill(4),
          perGroup,
        );
        const slots = placeGroupQualifiers(groups, qualifiers);
        const size = slots.length;
        const byesIn = (from: number, length: number) =>
          slots.slice(from, from + length).filter((slot) => !slot).length;
        const topMinusBottom = byesIn(0, size / 2) - byesIn(size / 2, size / 2);
        expect([groupCount, perGroup, topMinusBottom]).toEqual([
          groupCount,
          perGroup,
          (size - qualifiers.length) % 2,
        ]);
        for (let length = size / 2; length >= 2; length /= 2) {
          for (let from = 0; from < size; from += length * 2) {
            expect(
              Math.abs(byesIn(from, length) - byesIn(from + length, length)),
            ).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('结果确定：输入顺序不同也得到同一张签表', () => {
    const { groups, qualifiers } = qualifiersFor(Array<number>(12).fill(3), 2);
    const shuffled = [...qualifiers].reverse();
    expect(
      placeGroupQualifiers(groups, shuffled).map((slot) => slot?.id ?? null),
    ).toEqual(
      placeGroupQualifiers(groups, qualifiers).map((slot) => slot?.id ?? null),
    );
  });
});

describe('buildKnockoutSkeleton：出线前的对阵骨架与实际生成同一排法', () => {
  it('骨架签位与 placeGroupQualifiers 一致，首轮没有两边都空的场', () => {
    const { groups, qualifiers } = qualifiersFor(Array<number>(12).fill(3), 2);
    const real = placeGroupQualifiers(groups, qualifiers).map((slot) =>
      slot ? `${slot.group}组第${slot.rank}名` : null,
    );
    const skeleton = buildKnockoutSkeleton(groups, 2)!;
    expect(skeleton.bracketSize).toBe(32);
    expect(skeleton.participants.map((p) => (p.isBye ? null : p.name))).toEqual(
      real,
    );
    expect(
      skeleton.matches.filter(
        (m) => m.roundNo === 1 && !m.side1Id && !m.side2Id,
      ),
    ).toHaveLength(0);
    // 轮空场直接晋级，之后的轮次没有被「两边都空」挡住的场次。
    expect(
      skeleton.matches.filter(
        (m) =>
          m.round !== 'BRONZE' && m.status === 'COMPLETED' && !m.winnerSide,
      ),
    ).toHaveLength(0);
  });

  it('按各组实际人数出线：某组人数少于每组出线数时只出该组人数', () => {
    const sizes = new Map([
      ['A', 4],
      ['B', 2],
      ['C', 4],
      ['D', 4],
    ]);
    const skeleton = buildKnockoutSkeleton(['A', 'B', 'C', 'D'], 3, sizes)!;
    const names = skeleton.participants
      .filter((p) => !p.isBye)
      .map((p) => p.name);
    expect(names).toHaveLength(11);
    expect(names).not.toContain('B组第3名');
  });
});

describe('groupSizesFromGroupMatches', () => {
  it('只统计小组赛（roundNo = 0）各组出现过的选手', () => {
    const sizes = groupSizesFromGroupMatches([
      { roundNo: 0, round: 'A', side1Id: 'a1', side2Id: 'a2' },
      { roundNo: 0, round: 'A', side1Id: 'a1', side2Id: 'a3' },
      { roundNo: 0, round: 'B', side1Id: 'b1', side2Id: 'b2' },
      { roundNo: 1, round: 'R1', side1Id: 'a1', side2Id: 'b1' },
    ]);
    expect([...sizes]).toEqual([
      ['A', 3],
      ['B', 2],
    ]);
  });
});

describe('预排淘汰赛空位', () => {
  // 5 组每组 3 人的小组赛场次（roundNo 0，round = 组别），每组出线 2 人 → 10 人进 16 签、6 个轮空。
  const groupMatches = ['A', 'B', 'C', 'D', 'E'].flatMap((group) => [[1, 2], [1, 3], [2, 3]].map(([a, b], k) => ({
    roundNo: 0, round: group, matchNo: k + 1, side1Id: `${group}${a}`, side2Id: `${group}${b}`, status: 'PENDING',
  })));

  it('出线人数和骨架按小组赛场次算；空位不建轮空场，含后面各轮和季军赛', () => {
    const { skeleton, qualifierTotal } = skeletonFromGroupMatches(groupMatches, 2);
    expect(qualifierTotal).toBe(10);
    expect(skeleton?.bracketSize).toBe(16);
    const slots = knockoutPlaceholderSlots(skeleton!);
    // 首轮 8 场里 6 场轮空 → 2 场；1/4 决赛 4、半决赛 2、决赛 1、季军赛 1。
    expect(slots).toHaveLength(10);
    expect(slots.filter((slot) => slot.round === 'R1')).toHaveLength(2);
    expect(slots.filter((slot) => slot.round === 'BRONZE')).toHaveLength(1);
  });

  it('占位名：首轮写「X组第N名」，轮空晋级的一方也写出来，其余「待定」', () => {
    const { skeleton } = skeletonFromGroupMatches(groupMatches, 2);
    const names = knockoutPlaceholderNames(skeleton!);
    const r1 = [...names.entries()].filter(([key]) => key.startsWith('1:'));
    expect(r1).toHaveLength(2);
    expect(r1.every(([, pair]) => pair.every((name) => /^[A-E]组第[12]名$/.test(name)))).toBe(true);
    // 1/4 决赛里一方是轮空晋级的小组第 1 名。
    const qf = [...names.entries()].filter(([key]) => key.endsWith(':QF')).map(([, pair]) => pair);
    expect(qf.some((pair) => /组第1名$/.test(pair[0]) || /组第1名$/.test(pair[1]))).toBe(true);
    expect(names.get(knockoutSlotKey({ roundNo: 4, matchNo: 1, round: 'F' }))).toEqual(['待定', '待定']);
  });

  it('只有双方都空、未开始的淘汰赛场次才算空位；小组赛不算', () => {
    const blank = { roundNo: 1, round: 'R1', side1Id: null, side2Id: null, status: 'PENDING' };
    expect(knockoutPlaceholdersOnly([...groupMatches, blank])).toBe(true);
    expect(knockoutPlaceholdersOnly(groupMatches)).toBe(false);
    expect(knockoutPlaceholdersOnly([...groupMatches, blank, { ...blank, side1Id: 'A1' }])).toBe(false);
    expect(knockoutPlaceholdersOnly([...groupMatches, { ...blank, status: 'COMPLETED' }])).toBe(false);
    // 交叉排位赛（P 开头）不算淘汰赛空位。
    expect(knockoutPlaceholdersOnly([...groupMatches, { ...blank, round: 'P5' }])).toBe(false);
  });
});
