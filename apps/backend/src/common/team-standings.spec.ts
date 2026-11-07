import { teamStandings } from './final-rankings';
import { rankTeamGroup } from './team-group-ranking';
import { teamResultsReady } from './tournament-results-ready';

/** 不带子项明细的已结束团体对阵：正式比分直接用 team1Wins / team2Wins。 */
type TieExtra = { stage?: string; groupId?: string; round?: string; roundNo?: number; matchNo?: number };
function tie(team1Id: string, team2Id: string, score1: number, score2: number, extra: TieExtra = {}) {
  return {
    status: 'COMPLETED', team1Id, team2Id, winnerTeamId: score1 > score2 ? team1Id : team2Id,
    team1Wins: score1, team2Wins: score2, matches: [], ...extra,
  };
}
const teams = (...ids: string[]) => ids.map(id => ({ id, name: id, affiliation: '' }));
const ranks = (rows: Array<{ id: string; rank: number | null }>) => rows.map(row => [row.id, row.rank]);

describe('group ranking ties', () => {
  it('breaks a three-way tie by the results among the tied teams only', () => {
    // a、b、c 总胜场、胜次、净胜分完全相同；三队之间 a 胜次 5、c 4、b 3。
    const group = { stage: 'GROUP', groupId: 'g1' };
    const matches = [
      tie('a', 'b', 3, 0, group), tie('b', 'c', 3, 1, group), tie('c', 'a', 3, 2, group),
      tie('d', 'a', 3, 0, group), tie('d', 'b', 3, 2, group), tie('d', 'c', 3, 1, group),
    ];
    const rows = rankTeamGroup(['a', 'b', 'c', 'd'].map(teamId => ({ teamId, teamName: teamId })), matches, { format: 'GROUP_ROUND_ROBIN' });
    const order = [...rows].sort((x, y) => x.groupRank! - y.groupRank!).map(row => row.teamId);
    expect(order).toEqual(['d', 'a', 'c', 'b']);
  });

  it('keeps head-to-head for a two-team tie', () => {
    const group = { stage: 'GROUP', groupId: 'g1' };
    // a、b 各 1 胜，胜次都是 4、净胜分都为 0；a 赢了两队交手。
    const matches = [tie('a', 'b', 3, 1, group), tie('b', 'c', 3, 0, group), tie('c', 'a', 3, 1, group)];
    const rows = rankTeamGroup(['a', 'b', 'c'].map(teamId => ({ teamId, teamName: teamId })), matches, { format: 'GROUP_ROUND_ROBIN' });
    const rankOf = (id: string) => rows.find(row => row.teamId === id)!.groupRank;
    expect(rankOf('a')).toBeLessThan(rankOf('b')!);
  });
});

describe('team final standings for group formats', () => {
  it('ranks multi-group round robin by group placing first, then per-encounter record across groups', () => {
    const g1 = { stage: 'GROUP', groupId: 'g1' };
    const g2 = { stage: 'GROUP', groupId: 'g2' };
    const rows = teamStandings({
      format: 'GROUP_ROUND_ROBIN', teams: teams('a', 'b', 'c', 'd', 'e'),
      teamMatches: [
        tie('a', 'b', 3, 0, g1), tie('a', 'c', 3, 1, g1), tie('b', 'c', 3, 2, g1),
        tie('d', 'e', 3, 1, g2),
      ],
    });
    // 两个小组第一场均战绩相同，并列第 1；b（3 队组第二，胜率 1/2）排在 e（2 队组第二，胜率 0）前。
    expect(ranks(rows)).toEqual([['a', 1], ['d', 1], ['b', 3], ['e', 4], ['c', 5]]);
  });

  it('puts knockout finishers ahead of group-stage exits and orders the exits by group placing', () => {
    const g1 = { stage: 'GROUP', groupId: 'g1' };
    const g2 = { stage: 'GROUP', groupId: 'g2' };
    const ko = (round: string, roundNo: number) => ({ stage: 'KNOCKOUT', round, roundNo });
    const rows = teamStandings({
      format: 'GROUP_PLUS_KNOCKOUT', teams: teams('a', 'b', 'c', 'd', 'e', 'f'),
      teamMatches: [
        tie('a', 'b', 3, 0, g1), tie('a', 'c', 3, 0, g1), tie('b', 'c', 3, 0, g1),
        tie('d', 'e', 3, 0, g2), tie('d', 'f', 3, 0, g2), tie('e', 'f', 3, 0, g2),
        tie('a', 'e', 3, 0, ko('SF', 4)), tie('d', 'b', 3, 0, ko('SF', 4)), tie('a', 'd', 3, 0, ko('F', 5)),
      ],
    });
    const rankOf = (id: string) => rows.find(row => row.id === id)!.rank;
    expect([rankOf('a'), rankOf('d')]).toEqual([1, 2]);
    expect([rankOf('b'), rankOf('e')].sort()).toEqual([3, 4]);
    expect([rankOf('c'), rankOf('f')]).toEqual([5, 5]);
  });
});

describe('team results readiness for group-only formats', () => {
  const group = (status: string, winnerTeamId: string | null) => ({ status, round: 'A组第1轮', winnerTeamId });
  it('is ready once every group encounter has a winner, even without a final', () => {
    expect(teamResultsReady({ format: 'GROUP_ROUND_ROBIN', teams: [{ id: 'a' }, { id: 'b' }],
      teamMatches: [group('COMPLETED', 'a'), group('COMPLETED', 'b')] })).toBe(true);
  });
  it('is not ready while any group encounter is unfinished', () => {
    expect(teamResultsReady({ format: 'GROUP_ROUND_ROBIN', teams: [{ id: 'a' }, { id: 'b' }],
      teamMatches: [group('COMPLETED', 'a'), group('LIVE', null)] })).toBe(false);
  });
});

describe('third place in team knockout', () => {
  const ko = (round: string, roundNo: number, matchNo = 1) => ({ stage: 'KNOCKOUT', round, roundNo, matchNo });
  const bracket = [tie('a', 'b', 3, 1, ko('SF', 1)), tie('c', 'd', 3, 2, ko('SF', 1, 2)), tie('a', 'c', 3, 0, ko('F', 2))];

  it('keeps the old record-based 3rd/4th by default', () => {
    const rows = teamStandings({ format: 'SINGLE_ELIMINATION', teams: teams('a', 'b', 'c', 'd'), teamMatches: bracket });
    expect(rows.map(row => row.rank)).toEqual([1, 2, 3, 4]);
  });

  it('shares 3rd place when configured', () => {
    const rows = teamStandings({ format: 'SINGLE_ELIMINATION', thirdPlaceMode: 'SHARED', teams: teams('a', 'b', 'c', 'd', 'e'),
      teamMatches: [...bracket] });
    const rankOf = (id: string) => rows.find(row => row.id === id)!.rank;
    expect([rankOf('a'), rankOf('c'), rankOf('b'), rankOf('d')]).toEqual([1, 2, 3, 3]);
  });

  it('uses the bronze match result when a playoff is played', () => {
    const rows = teamStandings({ format: 'SINGLE_ELIMINATION', thirdPlaceMode: 'PLAYOFF', teams: teams('a', 'b', 'c', 'd'),
      teamMatches: [...bracket, tie('b', 'd', 1, 3, ko('BRONZE', 2, 2))] });
    expect(ranks(rows)).toEqual([['a', 1], ['c', 2], ['d', 3], ['b', 4]]);
  });
});
