import { createHash } from 'node:crypto';
import { calculateGroupStandings, type HeadToHeadRecord } from '../team-competitions/group-standings';
import { hasOfficialTeamResult, withOfficialTeamResult, type TeamResult } from './team-official-result';
import { rankTeamRoundRobin } from './team-round-robin-ranking';

type GroupRow = Omit<HeadToHeadRecord, 'opponentId'> & { teamName: string };

function rankStandardGroup(rows: GroupRow[], headToHead: Map<string, HeadToHeadRecord>, gameDiffs: Map<string, number>) {
  const pool = rows.map(row => row.teamId).sort().join(':');
  const lots = new Map(rows.map(row => [row.teamId, createHash('sha256').update(`${pool}/${row.teamId}`).digest('hex')]));
  const criteria = [
    (row: GroupRow) => row.wins,
    (row: GroupRow) => row.wins - row.losses,
    (row: GroupRow) => row.matchesWon - row.matchesLost,
    (row: GroupRow) => gameDiffs.get(row.teamId) ?? 0,
    (row: GroupRow) => row.netMatches,
  ];

  function rankBucket(bucket: GroupRow[], criterion: number): GroupRow[] {
    if (bucket.length < 2) return bucket;
    // 每次分出仅两队同分的层级时，优先看两队的交手胜负。
    if (criterion > 0 && bucket.length === 2) {
      const [first, second] = bucket;
      const meeting = headToHead.get(`${first.teamId}:${second.teamId}`);
      if (meeting && meeting.wins !== meeting.losses) return meeting.wins > meeting.losses ? bucket : [second, first];
    }
    const value = criteria[criterion];
    if (!value) {
      // 由固定的签位成员产生抽签顺序，让积分榜和淘汰赛生成使用同一次抽签结果。
      return bucket.sort((a, b) => lots.get(a.teamId)!.localeCompare(lots.get(b.teamId)!));
    }
    const byValue = new Map<number, GroupRow[]>();
    for (const row of bucket) {
      const score = value(row);
      const equal = byValue.get(score) ?? [];
      equal.push(row);
      byValue.set(score, equal);
    }
    return [...byValue.entries()].sort(([a], [b]) => b - a).flatMap(([, equal]) => rankBucket(equal, criterion + 1));
  }

  return rankBucket(rows, 0).map((row, index) => ({ ...row, groupRank: index + 1 }));
}

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
  const gameDiffs = new Map<string, number>();
  const standard = competition.format === 'GROUP_PLUS_KNOCKOUT_STD';
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
    if (standard) {
      gameDiffs.set(e.team1Id, (gameDiffs.get(e.team1Id) ?? 0) + e.team1GameDiff);
      gameDiffs.set(e.team2Id, (gameDiffs.get(e.team2Id) ?? 0) - e.team1GameDiff);
    }
  }

  const hasResults = encounters.length > 0;
  const ranked = competition.format === 'ROUND_ROBIN'
    ? rankTeamRoundRobin([...stats.values()].map(row => ({ ...row, id: row.teamId, gameDiff: row.netMatches })), encounters)
      .map(row => ({ ...row, groupRank: row.rank }))
    : standard && hasResults
      ? rankStandardGroup([...stats.values()], h2h, gameDiffs)
      : calculateGroupStandings([...stats.values()], [...h2h.values()]);
  return ranked.map(row => ({ ...row, groupRank: hasResults ? row.groupRank : null }));
}
