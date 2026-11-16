import {
  knockoutPlacements,
  type KnockoutMatchLike,
} from './knockout-placement';

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

  it('排位赛（P 开头轮次）与第二阶段（roundNo ≥ 100）不参与折算', () => {
    const { rows, decided } = knockoutPlacements([
      match('P5', 5, 'a', 'b', 1),
      match('决赛', 101, 'c', 'd', 1),
    ]);
    expect(rows).toEqual([]);
    expect(decided).toBe(false);
  });
});
