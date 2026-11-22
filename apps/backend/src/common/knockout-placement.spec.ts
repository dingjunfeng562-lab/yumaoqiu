import {
  isByeMatch,
  knockoutPlacements,
  type KnockoutMatchLike,
} from './knockout-placement';
import { FIFTH_PLACE_FINAL, knockoutPlacementSources, knockoutPlacementTargets, PLACEMENT_SEMIFINAL, SEVENTH_PLACE_FINAL } from './knockout-placement-playoff';

const match = (
  round: string,
  roundNo: number,
  side1Id: string | null,
  side2Id: string | null,
  winnerSide: number | null,
): KnockoutMatchLike => ({ round, roundNo, side1Id, side2Id, winnerSide });

/** 16 签：R1（1/8）8 场、QF 4 场、SF 2 场、BRONZE 1 场、F 1 场。 */
function draw16(options: {
  rounds: number;
  bronze: boolean;
  winner?: (id: string) => number;
}) {
  const matches: KnockoutMatchLike[] = [];
  // R1：r1-1 vs r1-2 …，胜者进 QF
  const winners = new Map<string, string>();
  for (let i = 1; i <= 8; i += 1) {
    const side1 = `r1-${i}a`;
    const side2 = `r1-${i}b`;
    const done = options.rounds >= 1;
    const side = options.winner ? options.winner(side1) : 1;
    matches.push(match('R1', 1, side1, side2, done ? side : null));
    if (done) winners.set(`r1-${i}`, side === 1 ? side1 : side2);
  }
  for (let i = 1; i <= 4; i += 1) {
    const side1 = winners.get(`r1-${i * 2 - 1}`) ?? null;
    const side2 = winners.get(`r1-${i * 2}`) ?? null;
    const done = options.rounds >= 2;
    matches.push(match('QF', 2, side1, side2, done ? 1 : null));
  }
  for (let i = 1; i <= 2; i += 1) {
    const done = options.rounds >= 3;
    matches.push(match('SF', 3, `sf${i}a`, `sf${i}b`, done ? 1 : null));
  }
  if (options.bronze) {
    matches.push(
      match('BRONZE', 4, 'sf1b', 'sf2b', options.rounds >= 4 ? 1 : null),
    );
  }
  matches.push(match('F', 4, 'sf1a', 'sf2a', options.rounds >= 5 ? 1 : null));
  return matches;
}

describe('knockoutPlacements 淘汰赛名次折算', () => {
  it('没有任何淘汰赛场次时返回空结果', () => {
    const result = knockoutPlacements([match('A', 0, 'a', 'b', 1)]);
    expect(result).toEqual({ rows: [], decided: false });
  });

  it('16 签全部打完（含季军赛）：1、2、3、4 名 + 并列第5 + 并列第9', () => {
    const { rows, decided } = knockoutPlacements(
      draw16({ rounds: 5, bronze: true }),
    );
    expect(decided).toBe(true);
    expect(
      rows.filter((row) => row.rank === 1).map((row) => row.label),
    ).toEqual(['第1名']);
    expect(
      rows.filter((row) => row.rank === 2).map((row) => row.label),
    ).toEqual(['第2名']);
    expect(
      rows.filter((row) => row.rank === 3).map((row) => row.label),
    ).toEqual(['第3名']);
    expect(
      rows.filter((row) => row.rank === 4).map((row) => row.label),
    ).toEqual(['第4名']);
    expect(rows.filter((row) => row.label === '并列第5名')).toHaveLength(4);
    expect(rows.filter((row) => row.label === '并列第9名')).toHaveLength(8);
    expect(new Set(rows.map((row) => row.entrantId)).size).toBe(rows.length);
  });

  it('只打完 1/8 决赛：8 人并列第9，1/4 决赛双方列「第5-8名」待定', () => {
    const { rows, decided } = knockoutPlacements(
      draw16({ rounds: 1, bronze: false }),
    );
    expect(decided).toBe(true);
    expect(
      rows.filter(
        (row) => row.label === '并列第9名' && row.status === '已确定',
      ),
    ).toHaveLength(8);
    expect(
      rows.filter((row) => row.label === '第5-8名' && row.status === '待定'),
    ).toHaveLength(8);
    expect(rows.some((row) => row.label === '第1名')).toBe(false);
  });

  it('有季军赛、半决赛还没打：四强先列「第3-4名」待定，不会从名次表里消失', () => {
    const { rows } = knockoutPlacements([
      match('QF', 1, 'a', 'b', 1),
      match('QF', 1, 'c', 'd', 1),
      match('QF', 1, 'e', 'f', 1),
      match('QF', 1, 'g', 'h', 1),
      match('SF', 2, 'a', 'c', null),
      match('SF', 2, 'e', 'g', null),
      match('BRONZE', 3, null, null, null),
      match('F', 3, null, null, null),
    ]);
    expect(
      rows
        .filter((row) => row.label === '第3-4名' && row.status === '待定')
        .map((row) => row.entrantId)
        .sort(),
    ).toEqual(['a', 'c', 'e', 'g']);
    expect(rows.filter((row) => row.label === '并列第5名')).toHaveLength(4);
  });

  it('没有季军赛时分出四强：两场半决赛负者并列第3名', () => {
    const { rows } = knockoutPlacements(draw16({ rounds: 3, bronze: false }));
    expect(rows.filter((row) => row.label === '并列第3名')).toHaveLength(2);
    expect(
      rows.filter((row) => row.label === '第1-2名' && row.status === '待定'),
    ).toHaveLength(2);
  });

  it('没有季军赛且决赛已打完：冠亚军确定，两场半决赛负者并列第3名', () => {
    const { rows } = knockoutPlacements(draw16({ rounds: 5, bronze: false }));
    expect(rows.filter((row) => row.label === '第1名')).toHaveLength(1);
    expect(rows.filter((row) => row.label === '第2名')).toHaveLength(1);
    expect(
      rows.filter(
        (row) => row.label === '并列第3名' && row.status === '已确定',
      ),
    ).toHaveLength(2);
    expect(
      rows.filter((row) => row.status === '已确定' && row.rank <= 3),
    ).toHaveLength(4);
  });

  it('32 签：1/16 决赛负者并列第17名', () => {
    const matches: KnockoutMatchLike[] = [];
    for (let i = 1; i <= 16; i += 1)
      matches.push(match('R2', 2, `r2-${i}a`, `r2-${i}b`, 1));
    const { rows } = knockoutPlacements(matches);
    expect(rows.filter((row) => row.label === '并列第17名')).toHaveLength(16);
  });

  it('128 签：1/64 决赛负者并列第65名、1/32 决赛负者并列第33名，轮空场不产生名次', () => {
    const matches: KnockoutMatchLike[] = [];
    // 1/64 决赛 64 场：前 52 场轮空（只有一方、已结束），后 12 场真打。
    for (let i = 1; i <= 64; i += 1) {
      matches.push(
        i <= 52
          ? match('R4', 1, `r4-${i}a`, null, 1)
          : match('R4', 1, `r4-${i}a`, `r4-${i}b`, 1),
      );
    }
    for (let i = 1; i <= 32; i += 1)
      matches.push(match('R3', 2, `r3-${i}a`, `r3-${i}b`, 1));
    const { rows } = knockoutPlacements(matches);
    expect(rows.filter((row) => row.label === '并列第65名')).toHaveLength(12);
    expect(rows.filter((row) => row.label === '并列第33名')).toHaveLength(32);
    expect(rows.some((row) => row.entrantId === null)).toBe(false);
  });

  it('未打完的 1/64 决赛列「第65-128名」待定', () => {
    const { rows } = knockoutPlacements([match('R4', 1, 'a', 'b', null)]);
    expect(rows.map((row) => [row.label, row.status])).toEqual([
      ['第65-128名', '待定'],
      ['第65-128名', '待定'],
    ]);
  });

  it('排位赛（P 开头轮次）与第二阶段（roundNo ≥ 100）不参与折算', () => {
    const { rows, decided } = knockoutPlacements([
      match('P5', 5, 'a', 'b', 1),
      match('决赛', 101, 'c', 'd', 1),
    ]);
    expect(rows).toEqual([]);
    expect(decided).toBe(false);
  });

  it('八强负者通过排位赛分别取得第 5、6、7、8 名', () => {
    const contenders = draw16({ rounds: 5, bronze: true });
    const first = contenders.find((row) => row.round === 'QF')!;
    const losing = contenders.filter((row) => row.round === 'QF').map(row => row.side2Id!);
    const { rows } = knockoutPlacements([
      ...contenders,
      match(PLACEMENT_SEMIFINAL, 3, losing[0], losing[1], 1),
      match(PLACEMENT_SEMIFINAL, 3, losing[2], losing[3], 1),
      match(FIFTH_PLACE_FINAL, 4, losing[0], losing[2], 2),
      match(SEVENTH_PLACE_FINAL, 4, losing[1], losing[3], 1),
    ]);
    expect(first.winnerSide).toBe(1);
    expect(rows.filter((row) => row.rank >= 5 && row.rank <= 8).map((row) => [row.rank, row.entrantId, row.status])).toEqual([
      [5, losing[2], '已确定'], [6, losing[0], '已确定'], [7, losing[1], '已确定'], [8, losing[3], '已确定'],
    ]);
  });

  it('排位半决赛连接八强负者，五六名和七八名赛分别接胜负者', () => {
    expect(knockoutPlacementTargets({ round: 'QF', roundNo: 2, matchNo: 4 })).toEqual([
      { round: PLACEMENT_SEMIFINAL, roundNo: 3, matchNo: 4, side: 'side2Id', outcome: 'loser' },
    ]);
    expect(knockoutPlacementTargets({ round: PLACEMENT_SEMIFINAL, roundNo: 3, matchNo: 3 })).toEqual([
      { round: FIFTH_PLACE_FINAL, roundNo: 4, matchNo: 3, side: 'side1Id', outcome: 'winner' },
      { round: SEVENTH_PLACE_FINAL, roundNo: 4, matchNo: 4, side: 'side1Id', outcome: 'loser' },
    ]);
    expect(knockoutPlacementSources({ round: SEVENTH_PLACE_FINAL, roundNo: 4, matchNo: 4 }).map(source => source.matchNo)).toEqual([3, 4]);
  });
});

describe('isByeMatch 轮空场', () => {
  it('已结束且只有一方有人才算轮空', () => {
    const bye = {
      status: 'COMPLETED',
      winnerSide: 1,
      side1Id: 'a',
      side2Id: null,
    };
    expect(isByeMatch(bye)).toBe(true);
    expect(
      isByeMatch({ ...bye, side1Id: null, side2Id: 'b', winnerSide: 2 }),
    ).toBe(true);
    expect(isByeMatch({ ...bye, status: 'PENDING', winnerSide: null })).toBe(
      false,
    );
    expect(isByeMatch({ ...bye, side2Id: 'b' })).toBe(false);
    expect(isByeMatch({ ...bye, side1Id: null })).toBe(false);
  });
});
