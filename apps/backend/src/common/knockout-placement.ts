/**
 * 淘汰赛名次折算：把 R1 → QF → SF → F（含季军赛）的胜负，折成「第1名 / 第2名 / 并列第5名…」。
 *
 * 导出（秩序册名次汇总、成绩表名次汇总）原来只按小组赛胜场排，纯淘汰赛赛事没有
 * roundNo=0 的场次，于是所有人都是「抽签签位 / 待定」，1/4 决赛、半决赛、决赛打完了也不出名次。
 */

export type KnockoutMatchLike = {
  round: string | number | null;
  roundNo: number | null;
  side1Id: string | null;
  side2Id: string | null;
  winnerSide: number | null;
};

export type KnockoutPlacement = {
  /** 展示用名称：第1名 / 并列第5名 / 第5-8名（未打完）。 */
  label: string;
  /** 名次起始值，用于排序。 */
  rank: number;
  entrantId: string | null;
  status: '已确定' | '待定';
};

/** 轮次 → 该轮负者的名次区间。R3=1/32 决赛，R2=1/16，R1=1/8。 */
const ROUND_RANGES: Record<string, [number, number]> = {
  F: [1, 2],
  BRONZE: [3, 4],
  SF: [3, 4],
  QF: [5, 8],
  R1: [9, 16],
  R2: [17, 32],
  R3: [33, 64],
};

const LOWER_ROUNDS = ['QF', 'R1', 'R2', 'R3'] as const;

function roundKey(match: KnockoutMatchLike): string | null {
  const roundNo = match.roundNo ?? 0;
  const round = typeof match.round === 'string' ? match.round : '';
  if (roundNo < 1 || roundNo >= 100) return null;
  return round in ROUND_RANGES ? round : null;
}

function winnerId(match: KnockoutMatchLike) {
  return match.winnerSide === 1
    ? match.side1Id
    : match.winnerSide === 2
      ? match.side2Id
      : null;
}

function loserId(match: KnockoutMatchLike) {
  return match.winnerSide === 1
    ? match.side2Id
    : match.winnerSide === 2
      ? match.side1Id
      : null;
}

/**
 * @returns rows：名次明细（含未打完的「待定」占位）；decided：是否已有任何一场淘汰赛打完。
 * 没有任何淘汰赛场次时返回空结果，调用方继续用小组赛口径。
 */
export function knockoutPlacements(matches: KnockoutMatchLike[]): {
  rows: KnockoutPlacement[];
  decided: boolean;
} {
  const grouped = new Map<string, KnockoutMatchLike[]>();
  for (const match of matches) {
    const key = roundKey(match);
    if (!key) continue;
    const list = grouped.get(key);
    if (list) list.push(match);
    else grouped.set(key, [match]);
  }
  if (!grouped.size) return { rows: [], decided: false };

  const rows: KnockoutPlacement[] = [];
  const seen = new Set<string>();
  const push = (
    label: string,
    rank: number,
    entrantId: string | null,
    status: '已确定' | '待定',
  ) => {
    if (!entrantId) return;
    const key = `${label}:${entrantId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ label, rank, entrantId, status });
  };
  let decided = false;

  const finalMatch = (grouped.get('F') ?? [])[0];
  if (finalMatch) {
    if (finalMatch.winnerSide) {
      decided = true;
      push('第1名', 1, winnerId(finalMatch), '已确定');
      push('第2名', 2, loserId(finalMatch), '已确定');
    } else {
      push('第1-2名', 1, finalMatch.side1Id, '待定');
      push('第1-2名', 1, finalMatch.side2Id, '待定');
    }
  }

  const bronze = (grouped.get('BRONZE') ?? [])[0];
  const semis = grouped.get('SF') ?? [];
  if (bronze) {
    if (bronze.winnerSide) {
      decided = true;
      push('第3名', 3, winnerId(bronze), '已确定');
      push('第4名', 4, loserId(bronze), '已确定');
    } else {
      push('第3-4名', 3, bronze.side1Id, '待定');
      push('第3-4名', 3, bronze.side2Id, '待定');
    }
  } else if (semis.length) {
    // 没有季军赛：两场半决赛的负者并列第3名。
    if (semis.length === 2 && semis.every((match) => match.winnerSide)) {
      decided = true;
      for (const match of semis) push('并列第3名', 3, loserId(match), '已确定');
    } else {
      for (const match of semis) {
        push('第3-4名', 3, match.side1Id, '待定');
        push('第3-4名', 3, match.side2Id, '待定');
      }
    }
  }

  for (const round of LOWER_ROUNDS) {
    const list = grouped.get(round) ?? [];
    if (!list.length) continue;
    const [start, end] = ROUND_RANGES[round];
    for (const match of list) {
      if (match.winnerSide) {
        decided = true;
        push(`并列第${start}名`, start, loserId(match), '已确定');
      } else {
        push(`第${start}-${end}名`, start, match.side1Id, '待定');
        push(`第${start}-${end}名`, start, match.side2Id, '待定');
      }
    }
  }

  rows.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.status === b.status ? 0 : a.status === '已确定' ? -1 : 1),
  );
  return { rows, decided };
}
