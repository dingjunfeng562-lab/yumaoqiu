import { rankTeamRoundRobin } from './team-round-robin-ranking';
import { rankTeamGroup } from './team-group-ranking';
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

/**
 * 团体赛名次。
 * - 单组循环（ROUND_ROBIN）：按循环赛积分排名，可并列。
 * - 淘汰赛决出的名次：冠亚军看决赛，季军赛决出三、四名；不打季军赛时按设置并列第三或按成绩排定；
 *   其余按被淘汰的轮次，越晚出局越靠前。
 * - 在小组赛阶段结束的队伍：先按小组名次（与小组积分榜同一算法，含相互胜负和同分队小循环），
 *   各组同名次的队伍之间再比较场均胜场、场均胜次、场均净胜分（各组队数可能不同，用场均才公平），完全相同时并列。
 */
export function teamStandings(competition: {
  format?: string | null;
  winThreshold?: number;
  thirdPlaceMode?: string | null;
  teams: Array<{ id: string; name: string; affiliation: string; finalRank?: number | null }>;
  teamMatches: Array<{ status: string; stage?: string | null; groupId?: string | null; round?: string; roundNo?: number; team1Id: string | null; team2Id: string | null; winnerTeamId: string | null; team1Wins: number; team2Wins: number; matches?: TeamResultChild[] }>;
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
  // 小组名次，与小组积分榜同一算法。
  const groupRanks = new Map<string, number>();
  const groupMatches = new Map<string, typeof competition.teamMatches>();
  for (const match of competition.teamMatches) {
    if (match.stage !== 'GROUP' || !match.groupId) continue;
    const list = groupMatches.get(match.groupId) ?? [];
    list.push(match);
    groupMatches.set(match.groupId, list);
  }
  const teamNames = new Map(competition.teams.map(team => [team.id, team.name]));
  for (const matches of groupMatches.values()) {
    const ids = [...new Set(matches.flatMap(match => [match.team1Id, match.team2Id]).filter((id): id is string => Boolean(id)))];
    for (const row of rankTeamGroup(ids.map(teamId => ({ teamId, teamName: teamNames.get(teamId) ?? '' })), matches, competition)) {
      if (row.groupRank != null) groupRanks.set(row.teamId, row.groupRank);
    }
  }

  const fixedRanks = new Map<string, number>();
  const eliminated = new Map<string, number>();
  const semifinalLosers: string[] = [];
  let bronzeDecided = false;
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
    if (match.round === 'BRONZE') bronzeDecided = true;
    if (match.round === 'SF' && loser) semifinalLosers.push(loser);
  }
  // 不打季军赛、设置为并列第三时，两名半决赛负者同列第三，下一名从第五名起。
  if (competition.thirdPlaceMode === 'SHARED' && !bronzeDecided) {
    for (const loser of semifinalLosers) if (!fixedRanks.has(loser)) fixedRanks.set(loser, 3);
  }

  // 名次在小组赛阶段就已确定的队伍：没有淘汰赛成绩、但有小组名次。
  const placedInGroup = (id: string) => !fixedRanks.has(id) && !eliminated.has(id) && groupRanks.has(id);
  const perEncounter = (value: number, played: number) => (played ? value / played : 0);
  const compareGroupPlacement = (a: typeof rows[number], b: typeof rows[number]) => {
    if (!placedInGroup(a.id) || !placedInGroup(b.id)) return 0;
    return groupRanks.get(a.id)! - groupRanks.get(b.id)!
      || perEncounter(b.wins, b.played) - perEncounter(a.wins, a.played)
      || perEncounter(b.matchesWon, b.played) - perEncounter(a.matchesWon, a.played)
      || perEncounter(b.gameDiff, b.played) - perEncounter(a.gameDiff, a.played);
  };
  const sorted = rows.sort((a, b) =>
    (fixedRanks.get(a.id) ?? Infinity) - (fixedRanks.get(b.id) ?? Infinity)
    || (eliminated.get(b.id) ?? 0) - (eliminated.get(a.id) ?? 0)
    || compareGroupPlacement(a, b)
    || b.wins - a.wins || b.matchesWon - a.matchesWon || b.gameDiff - a.gameDiff || a.id.localeCompare(b.id));
  const ranked: Array<typeof rows[number] & { rank: number }> = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tiedWithPrevious = previous && placedInGroup(row.id) && placedInGroup(previous.id)
      && compareGroupPlacement(row, previous) === 0;
    ranked.push({ ...row, rank: fixedRanks.get(row.id) ?? (tiedWithPrevious ? previous.rank : index + 1) });
  });
  return applyFinalRankings(ranked, competition.teams);
}
