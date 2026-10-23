import { hasOfficialTeamResult } from './team-official-result';

/** 单组循环：胜场、胜次、正式子项逐局净胜分；两队仍同分时比较交手胜负，其余并列。 */
export function rankTeamRoundRobin<T extends { id: string; wins: number; matchesWon?: number; gameDiff: number }>(
  rows: T[],
  encounters: Array<{ status: string; team1Id: string | null; team2Id: string | null; winnerTeamId: string | null; resultDecided?: boolean }>,
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || (b.matchesWon ?? 0) - (a.matchesWon ?? 0) || b.gameDiff - a.gameDiff);
  const result: Array<T & { rank: number }> = [];
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].wins === sorted[i].wins
      && (sorted[end].matchesWon ?? 0) === (sorted[i].matchesWon ?? 0) && sorted[end].gameDiff === sorted[i].gameDiff) end++;
    const tied = sorted.slice(i, end);
    const encounter = tied.length === 2 ? encounters.find(m => hasOfficialTeamResult(m)
      && [m.team1Id, m.team2Id].includes(tied[0].id) && [m.team1Id, m.team2Id].includes(tied[1].id)) : undefined;
    if (encounter) tied.sort((a, b) => Number(b.id === encounter.winnerTeamId) - Number(a.id === encounter.winnerTeamId));
    tied.forEach((row, offset) => result.push({ ...row, rank: i + 1 + (encounter ? offset : 0) }));
    i = end;
  }
  return result;
}
