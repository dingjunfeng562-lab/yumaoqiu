import { calculateGroupStandings, type HeadToHeadRecord } from '../team-competitions/group-standings';
import { hasOfficialTeamResult, withOfficialTeamResult, type TeamResult } from './team-official-result';
import { rankTeamRoundRobin } from './team-round-robin-ranking';

/**
 * 一个小组的积分与名次。小组积分榜、淘汰赛出线和最终名次都用这一个函数，保证三处口径一致。
 * 只统计已确定正式胜负的对阵（补打不计）；还没有任何结果时名次为空。
 */
export function rankTeamGroup(
  members: Array<{ teamId: string; teamName: string }>,
  matches: TeamResult[],
  competition: { format?: string | null; winThreshold?: number },
) {
  const encounters = matches.map(match => withOfficialTeamResult(match, competition.winThreshold)).filter(hasOfficialTeamResult);

  const stats = new Map(members.map(m => [m.teamId, {
    teamId: m.teamId, teamName: m.teamName, wins: 0, losses: 0, matchesWon: 0, matchesLost: 0, netMatches: 0,
  }]));
  const h2h = new Map<string, HeadToHeadRecord>();
  const record = (teamId: string, opponentId: string, won: boolean, forCount: number, againstCount: number, pointDiff: number) => {
    const row = stats.get(teamId);
    if (row) {
      row.wins += won ? 1 : 0;
      row.losses += won ? 0 : 1;
      row.matchesWon += forCount;
      row.matchesLost += againstCount;
      row.netMatches += pointDiff;
    }
    const key = `${teamId}:${opponentId}`;
    const pair = h2h.get(key) ?? { teamId, opponentId, wins: 0, losses: 0, matchesWon: 0, matchesLost: 0, netMatches: 0 };
    pair.wins += won ? 1 : 0;
    pair.losses += won ? 0 : 1;
    pair.matchesWon += forCount;
    pair.matchesLost += againstCount;
    pair.netMatches += pointDiff;
    h2h.set(key, pair);
  };
  for (const e of encounters) {
    if (!e.team1Id || !e.team2Id) continue;
    record(e.team1Id, e.team2Id, e.winnerTeamId === e.team1Id, e.team1Wins, e.team2Wins, e.team1PointDiff);
    record(e.team2Id, e.team1Id, e.winnerTeamId === e.team2Id, e.team2Wins, e.team1Wins, -e.team1PointDiff);
  }

  const ranked = competition.format === 'ROUND_ROBIN'
    ? rankTeamRoundRobin([...stats.values()].map(row => ({ ...row, id: row.teamId, gameDiff: row.netMatches })), encounters)
      .map(row => ({ ...row, groupRank: row.rank }))
    : calculateGroupStandings([...stats.values()], [...h2h.values()]);
  const hasResults = encounters.length > 0;
  return ranked.map(row => ({ ...row, groupRank: hasResults ? row.groupRank : null }));
}
