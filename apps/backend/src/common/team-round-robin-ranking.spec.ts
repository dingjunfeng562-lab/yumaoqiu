import { rankTeamRoundRobin } from './team-round-robin-ranking';
import { teamStandings } from './final-rankings';
import { tournamentResultsReady } from './tournament-results-ready';

describe('single-group team rankings', () => {
  it('publishes only after every round-robin encounter is confirmed, without a final', () => {
    const competition = { format: 'ROUND_ROBIN', teams: ['a', 'b', 'c'].map(id => ({ id })),
      teamMatches: [1, 2, 3].map(round => ({ round: `第${round}轮`, status: 'COMPLETED', winnerTeamId: 'a' })) };
    const tournament = { status: 'ONGOING', events: [], teamCompetitions: [competition] };
    expect(tournamentResultsReady(tournament)).toBe(true);
    competition.teamMatches[2].status = 'LIVE';
    expect(tournamentResultsReady(tournament)).toBe(false);
    competition.teamMatches.pop();
    expect(tournamentResultsReady(tournament)).toBe(false);
  });
  it('uses wins before net items, then the two tied teams encounter', () => {
    const rows = [
      { id: 'a', wins: 2, gameDiff: 1 }, { id: 'b', wins: 2, gameDiff: 1 },
      { id: 'c', wins: 3, gameDiff: -1 }, { id: 'd', wins: 2, gameDiff: 3 },
    ];
    const matches = [{ status: 'COMPLETED', team1Id: 'a', team2Id: 'b', winnerTeamId: 'b' }];
    expect(rankTeamRoundRobin(rows, matches).map(row => [row.id, row.rank]))
      .toEqual([['c', 1], ['d', 2], ['b', 3], ['a', 4]]);
  });

  it('keeps an unresolved three-team cycle tied and skips occupied places', () => {
    const rows = ['a', 'b', 'c'].map(id => ({ id, wins: 1, gameDiff: 0 }));
    const matches = [['a', 'b'], ['b', 'c'], ['c', 'a']].map(([winner, loser]) => ({ status: 'COMPLETED', team1Id: winner, team2Id: loser, winnerTeamId: winner }));
    expect(rankTeamRoundRobin([...rows, { id: 'd', wins: 0, gameDiff: -3 }], matches).map(row => row.rank)).toEqual([1, 1, 1, 4]);
  });

  it('does not resolve a tie from an unconfirmed encounter', () => {
    const rows = ['a', 'b'].map(id => ({ id, wins: 0, gameDiff: 0 }));
    expect(rankTeamRoundRobin(rows, [{ status: 'LIVE', team1Id: 'a', team2Id: 'b', winnerTeamId: 'b' }]).map(r => r.rank)).toEqual([1, 1]);
  });

  it('preserves explicitly assigned final placements', () => {
    const result = teamStandings({ format: 'ROUND_ROBIN', teams: [
      { id: 'a', name: 'A', affiliation: '', finalRank: 2 }, { id: 'b', name: 'B', affiliation: '', finalRank: 1 },
    ], teamMatches: [] });
    expect(result.map(r => [r.id, r.rank])).toEqual([['b', 1], ['a', 2]]);
  });
});
