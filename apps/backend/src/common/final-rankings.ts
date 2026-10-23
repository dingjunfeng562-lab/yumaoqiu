import { rankTeamRoundRobin } from './team-round-robin-ranking';
import { hasOfficialTeamResult, withOfficialTeamResult, type TeamResultChild } from './team-official-result';

export function limitRankings<T extends { rank: number | null }>(rows: T[], limit?: number | null): T[] {
  return rows.filter((row) => row.rank != null && (limit == null || row.rank <= limit));
}

// Once any final rank is assigned, unassigned entrants remain explicitly unranked.
// Clearing every final rank restores the existing calculated standings.
export function applyFinalRankings<T extends { id: string; rank: number | null }>(
  rows: T[],
  entrants: Array<{ id: string; finalRank?: number | null }>,
): Array<Omit<T, 'rank'> & { rank: number | null }> {
  if (!entrants.some((entrant) => entrant.finalRank != null)) return rows;
  const ranks = new Map(entrants.map((entrant) => [entrant.id, entrant.finalRank ?? null]));
  return rows.map((row) => ({ ...row, rank: ranks.get(row.id) ?? null }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
}

export function teamStandings(competition: {
  format?: string | null;
  winThreshold?: number;
  teams: Array<{ id: string; name: string; affiliation: string; finalRank?: number | null }>;
  teamMatches: Array<{ status: string; stage?: string | null; round?: string; roundNo?: number; team1Id: string | null; team2Id: string | null; winnerTeamId: string | null; team1Wins: number; team2Wins: number; matches?: TeamResultChild[] }>;
}) {
  const encounters = competition.teamMatches.map(match => withOfficialTeamResult(match, competition.winThreshold));
  const rows = competition.teams.map((team) => ({
    id: team.id, name: team.name, affiliation: team.affiliation, groupName: null,
    played: 0, wins: 0, losses: 0, matchesWon: 0, gameDiff: 0,
  }));
  for (const match of encounters) {
    if (!hasOfficialTeamResult(match)) continue;
    for (const row of rows) {
      if (row.id !== match.team1Id && row.id !== match.team2Id) continue;
      row.played++;
      if (row.id === match.winnerTeamId) row.wins++;
      else row.losses++;
      row.matchesWon += row.id === match.team1Id ? match.team1Wins : match.team2Wins;
      row.gameDiff += row.id === match.team1Id ? match.team1PointDiff : -match.team1PointDiff;
    }
  }
  if (competition.format === 'ROUND_ROBIN') {
    return applyFinalRankings(rankTeamRoundRobin(rows, encounters), competition.teams);
  }
  const fixedRanks = new Map<string, number>();
  const eliminated = new Map<string, number>();
  for (const match of encounters) {
    // 小组循环赛的负场不代表被淘汰，只按淘汰赛场次计算淘汰轮次
    if (match.status !== 'COMPLETED' || !match.winnerTeamId || match.stage === 'GROUP') continue;
    const loser = match.winnerTeamId === match.team1Id ? match.team2Id : match.team1Id;
    if (loser) eliminated.set(loser, Math.max(eliminated.get(loser) ?? 0, match.roundNo ?? 0));
    if (match.round === 'F' || match.round === 'BRONZE') {
      const rank = match.round === 'F' ? 1 : 3;
      fixedRanks.set(match.winnerTeamId, rank);
      if (loser) fixedRanks.set(loser, rank + 1);
    }
  }
  const sorted = rows.sort((a, b) =>
    (fixedRanks.get(a.id) ?? Infinity) - (fixedRanks.get(b.id) ?? Infinity)
    || (eliminated.get(b.id) ?? 0) - (eliminated.get(a.id) ?? 0)
    || b.wins - a.wins || b.matchesWon - a.matchesWon || b.gameDiff - a.gameDiff || a.id.localeCompare(b.id));
  return applyFinalRankings(sorted.map((row, index) => ({ ...row, rank: fixedRanks.get(row.id) ?? index + 1 })), competition.teams);
}
