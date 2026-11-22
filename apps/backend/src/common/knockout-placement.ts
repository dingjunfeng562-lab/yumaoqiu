/**
 * 淘汰赛名次折算：把 R1 → QF → SF → F（含季军赛）的胜负，折成「第1名 / 第2名 / 并列第5名…」。
 *
 * 导出（秩序册名次汇总、成绩表名次汇总）原来只按小组赛胜场排，纯淘汰赛赛事没有
 * roundNo=0 的场次，于是所有人都是「抽签签位 / 待定」，1/4 决赛、半决赛、决赛打完了也不出名次。
 */

import { FIFTH_PLACE_FINAL, isKnockoutWalkover, knockoutPlacementPlayoff, PLACEMENT_SEMIFINAL, SEVENTH_PLACE_FINAL } from './knockout-placement-playoff';

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

const FIXED_RANGES: Record<string, [number, number]> = {
  F: [1, 2],
  BRONZE: [3, 4],
  SF: [3, 4],
  QF: [5, 8],
};

/**
 * 轮次 → 该轮负者的名次区间（同一轮出局的并列，取区间起点）。
 * R1=1/8 决赛 9-16，R2=1/16 决赛 17-32，R3=1/32 决赛 33-64，R4=1/64 决赛（128 签首轮）65-128……
 */
function roundRange(round: string): [number, number] | null {
  if (round in FIXED_RANGES) return FIXED_RANGES[round];
  const matched = /^R(\d+)$/.exec(round);
  const level = matched ? Number(matched[1]) : 0;
  if (level < 1 || level > 10) return null;
  return [2 ** (level + 2) + 1, 2 ** (level + 3)];
}

function roundKey(match: KnockoutMatchLike): string | null {
  const roundNo = match.roundNo ?? 0;
  const round = typeof match.round === 'string' ? match.round : '';
  if (roundNo < 1 || roundNo >= 100) return null;
  return roundRange(round) ? round : null;
}

/**
 * 轮空场：已结束、只有一方有人（另一方是空签位）。显示时空的一方写「轮空」而不是「待定」；
 * 名次折算里轮空场没有负者，本来就不计。
 */
export function isByeMatch(match: {
  status?: string | null;
  winnerSide: number | null;
  side1Id: string | null;
  side2Id: string | null;
}) {
  return (
    match.status === 'COMPLETED' &&
    Boolean(match.winnerSide) &&
    !match.side1Id !== !match.side2Id
  );
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
    // 半决赛还没打完时季军赛双方未定，半决赛双方先列「第3-4名」待定（否则名次表里缺这几个人）。
    for (const match of semis) {
      if (match.winnerSide) continue;
      push('第3-4名', 3, match.side1Id, '待定');
      push('第3-4名', 3, match.side2Id, '待定');
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

  const fifthFinal = matches.find(match => match.round === FIFTH_PLACE_FINAL);
  const seventhFinal = matches.find(match => match.round === SEVENTH_PLACE_FINAL);
  const placementEntrants = new Set<string>();
  if (fifthFinal && seventhFinal) {
    const addPlacement = (rank: number, label: string, id: string | null, status: '已确定' | '待定') => {
      if (!id || placementEntrants.has(id)) return;
      placementEntrants.add(id);
      push(label, rank, id, status);
    };
    for (const [rank, match] of [[5, fifthFinal], [7, seventhFinal]] as const) {
      if (match.winnerSide) {
        decided = true;
        addPlacement(rank, `第${rank}名`, winnerId(match), '已确定');
        addPlacement(rank + 1, `第${rank + 1}名`, loserId(match), '已确定');
      } else {
        addPlacement(rank, `第${rank}-${rank + 1}名`, match.side1Id, '待定');
        addPlacement(rank, `第${rank}-${rank + 1}名`, match.side2Id, '待定');
      }
    }
    for (const match of matches.filter(match => match.round === PLACEMENT_SEMIFINAL)) {
      addPlacement(5, '第5-8名', match.side1Id, '待定');
      addPlacement(5, '第5-8名', match.side2Id, '待定');
    }
  }

  const lowerRounds = [...grouped.keys()]
    .filter((round) => !['F', 'BRONZE', 'SF'].includes(round))
    .sort((a, b) => roundRange(a)![0] - roundRange(b)![0]);
  for (const round of lowerRounds) {
    const list = grouped.get(round) ?? [];
    const [start, end] = roundRange(round)!;
    for (const match of list) {
      if (match.winnerSide) {
        decided = true;
        const loser = loserId(match);
        if (round === 'QF' && fifthFinal && seventhFinal) {
          if (loser && !placementEntrants.has(loser)) push('第5-8名', 5, loser, '待定');
        } else {
          push(`并列第${start}名`, start, loser, '已确定');
        }
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

export function knockoutPlacementPlayoffView(
  matches: readonly (KnockoutMatchLike & {
    id: string;
    matchNo: number;
    status: string;
    games?: { side1Score: number; side2Score: number }[];
    forfeitReason?: string | null;
    scheduledAt?: Date | null;
    venue?: { name: string } | null;
  })[],
  nameFor: (id: string) => string,
  rankingLimit = 8,
) {
  const quarterfinal = matches.find(match => match.round === 'QF');
  if (!quarterfinal?.roundNo) return null;
  const playoff = knockoutPlacementPlayoff(quarterfinal.roundNo).flatMap(template => {
    const match = matches.find(row => row.round === template.round && row.roundNo === template.roundNo && row.matchNo === template.matchNo);
    if (!match) return [];
    const winner = winnerId(match);
    const walkover = isKnockoutWalkover(match);
    return [{
      id: match.id,
      matchNo: template.number,
      roundName: walkover && template.round === SEVENTH_PLACE_FINAL
        ? '第7名确认'
        : rankingLimit === 7 && template.round === PLACEMENT_SEMIFINAL ? '5–7名排位赛' : template.round,
      area: `5-${rankingLimit}名争夺区`,
      source1: template.sources[0].label,
      source2: template.sources[1].label,
      player1Id: match.side1Id,
      player2Id: match.side2Id,
      player1Name: match.side1Id ? nameFor(match.side1Id) : null,
      player2Name: match.side2Id ? nameFor(match.side2Id) : null,
      winnerId: winner,
      winnerName: winner ? nameFor(winner) : null,
      winnerSide: match.winnerSide,
      status: match.status === 'COMPLETED' ? 'FINISHED' : match.status,
      score: walkover ? '轮空' : match.games?.map(game => `${game.side1Score}:${game.side2Score}`).join(' / ') || null,
      walkover,
      scheduledAt: match.scheduledAt?.toISOString() ?? null,
      venueName: match.venue?.name ?? null,
    }];
  });
  if (playoff.length !== 4) return null;

  const status = playoff.every(match => match.status === 'FINISHED' || match.status === 'CANCELLED') ? 'FINISHED' : 'CONFIRMED';
  const rankings = knockoutPlacements([...matches]).rows.flatMap(row =>
    row.rank >= 5 && row.rank <= rankingLimit && row.entrantId && row.status === '已确定'
      ? [{ rank: row.rank, playerId: row.entrantId, playerName: nameFor(row.entrantId) }]
      : [],
  );
  return {
    status,
    kind: 'KNOCKOUT_PLACEMENT' as const,
    secondStageStatus: status,
    rankingMode: 'TOP_8',
    rankingLimit,
    modeText: rankingLimit === 7 ? '混双决出前7名，空签按轮空推进' : '1/4决赛负者参加第5–8名排位',
    slotSourceText: '按1/4决赛签位自动推进',
    slots: [],
    matches: playoff,
    rankings,
  };
}
