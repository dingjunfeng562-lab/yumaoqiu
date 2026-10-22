/** 单组循环：胜场、净胜项；恰好两队仍同分时比较交手胜负，其余并列。 */
export function rankTeamRoundRobin<T extends { id: string; wins: number; gameDiff: number }>(
  rows: T[],
  encounters: Array<{ status: string; team1Id: string | null; team2Id: string | null; winnerTeamId: string | null }>,
): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => b.wins - a.wins || b.gameDiff - a.gameDiff);
  const result: Array<T & { rank: number }> = [];
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].wins === sorted[i].wins && sorted[end].gameDiff === sorted[i].gameDiff) end++;
    const tied = sorted.slice(i, end);
    const encounter = tied.length === 2 ? encounters.find(m => m.status === 'COMPLETED' && m.winnerTeamId
      && [m.team1Id, m.team2Id].includes(tied[0].id) && [m.team1Id, m.team2Id].includes(tied[1].id)) : undefined;
    if (encounter) tied.sort((a, b) => Number(b.id === encounter.winnerTeamId) - Number(a.id === encounter.winnerTeamId));
    tied.forEach((row, offset) => result.push({ ...row, rank: i + 1 + (encounter ? offset : 0) }));
    i = end;
  }
  return result;
}
