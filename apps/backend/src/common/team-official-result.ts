export type TeamResultChild = {
  id?: string;
  matchNo?: number;
  status: string;
  winnerSide: number | null;
  finishedAt?: Date | string | null;
  games?: Array<{ side1Score: number; side2Score: number }>;
};

export type TeamResult = {
  status: string;
  team1Id: string | null;
  team2Id: string | null;
  winnerTeamId: string | null;
  team1Wins: number;
  team2Wins: number;
  matches?: TeamResultChild[];
};

/** 正式成绩截止于先赢够子项的那一场；补打仍保留原始成绩。 */
export function withOfficialTeamResult<T extends TeamResult>(match: T, winThreshold?: number) {
  const validThreshold = Number.isInteger(winThreshold) && winThreshold! > 0;
  let team1Wins = match.team1Wins;
  let team2Wins = match.team2Wins;
  let winnerTeamId = match.winnerTeamId;
  const countedIds = new Set<string>();
  let officialChildren = (match.matches ?? []).filter(child => child.status === 'COMPLETED'
    && (child.winnerSide === 1 || child.winnerSide === 2));
  if (validThreshold && match.matches?.length && match.team1Id && match.team2Id) {
    team1Wins = 0;
    team2Wins = 0;
    winnerTeamId = null;
    officialChildren = [];
    const finished = match.matches.filter(child => child.status === 'COMPLETED'
      && (child.winnerSide === 1 || child.winnerSide === 2));
    // 裁判确认时间决定先后；旧记录缺少确认时间时沿用子项顺序。
    const hasTimes = finished.every(child => child.finishedAt && Number.isFinite(new Date(child.finishedAt).getTime()));
    finished.sort((a, b) => (hasTimes ? new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime() : 0)
      || (a.matchNo ?? 0) - (b.matchNo ?? 0));
    for (const child of finished) {
      officialChildren.push(child);
      if (child.id) countedIds.add(child.id);
      if (child.winnerSide === 1) team1Wins++;
      else team2Wins++;
      if (team1Wins >= winThreshold! || team2Wins >= winThreshold!) {
        winnerTeamId = team1Wins >= winThreshold! ? match.team1Id : match.team2Id;
        break;
      }
    }
  }
  const resultDecided = Boolean(winnerTeamId && (match.status === 'COMPLETED'
    || (match.status === 'LIVE' && validThreshold && Math.max(team1Wins, team2Wins) >= winThreshold!)));
  const supplementalMatchIds = resultDecided && validThreshold && match.matches?.length
    ? match.matches.filter(child => child.id && child.status !== 'CANCELLED' && !countedIds.has(child.id)).map(child => child.id!)
    : [];
  const team1PointDiff = officialChildren.reduce((total, child) => total
    + (child.games ?? []).reduce((sum, game) => sum + game.side1Score - game.side2Score, 0), 0);
  return { ...match, team1Wins, team2Wins, winnerTeamId, resultDecided, supplementalMatchIds, team1PointDiff };
}

export function hasOfficialTeamResult(match: { status: string; winnerTeamId: string | null; resultDecided?: boolean }) {
  return Boolean(match.winnerTeamId && (match.status === 'COMPLETED' || (match.status === 'LIVE' && match.resultDecided)));
}
