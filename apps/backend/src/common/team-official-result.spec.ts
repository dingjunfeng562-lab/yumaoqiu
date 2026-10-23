import { withOfficialTeamResult } from './team-official-result';
import { teamStandings } from './final-rankings';
import { rankTeamRoundRobin } from './team-round-robin-ranking';

function encounter(winners: number[], status = 'COMPLETED') {
  return {
    status, team1Id: 'a', team2Id: 'b', winnerTeamId: 'a',
    // Deliberately emulate the old, uncapped persisted aggregate.
    team1Wins: winners.filter(side => side === 1).length,
    team2Wins: winners.filter(side => side === 2).length,
    matches: winners.map((winnerSide, index) => ({
      id: `child-${index}`, matchNo: index + 1, status: 'COMPLETED', winnerSide,
      games: [{ side1Score: winnerSide === 1 ? 21 : 11, side2Score: winnerSide === 2 ? 21 : 11 }],
    })),
  };
}

describe('official team result cutoff', () => {
  it.each([
    [[1, 1, 1, 2, 2], 3, 0, 2],
    [[1, 1, 1, 1, 1], 3, 0, 2],
    [[1, 2, 1, 1, 1], 3, 1, 1],
    [[1, 2, 1, 2, 1], 3, 2, 0],
    [[2, 2, 2, 1, 1], 0, 3, 2],
  ])('caps %j at the first three wins', (winners, team1Wins, team2Wins, supplemental) => {
    const result = withOfficialTeamResult(encounter(winners as number[]), 3);
    expect(result).toMatchObject({ team1Wins, team2Wins, resultDecided: true });
    expect(result.supplementalMatchIds).toHaveLength(supplemental as number);
    expect(result.matches).toHaveLength(5);
  });

  it('uses referee confirmation order if results were entered out of item order', () => {
    const match = encounter([1, 1, 1, 2, 2]);
    const times = [1, 4, 5, 2, 3];
    const result = withOfficialTeamResult({ ...match, matches: match.matches.map((child, i) => ({
      ...child, finishedAt: new Date(2026, 0, 1, 0, times[i]),
    })) }, 3);
    expect(result).toMatchObject({ team1Wins: 3, team2Wins: 2 });
  });

  it('counts a decided LIVE encounter in rankings and normalizes old scores', () => {
    const match = encounter([1, 1, 1, 2, 2], 'LIVE');
    const rows = teamStandings({ format: 'ROUND_ROBIN', winThreshold: 3,
      teams: ['a', 'b'].map(id => ({ id, name: id, affiliation: '' })), teamMatches: [match] });
    expect(rows[0]).toMatchObject({ id: 'a', wins: 1, matchesWon: 3, gameDiff: 30, rank: 1 });
    expect(rows[1]).toMatchObject({ id: 'b', losses: 1, matchesWon: 0, gameDiff: -30 });
  });

  it('sums every official game including lost games, and excludes all supplemental points', () => {
    const match = encounter([1, 2, 1, 1, 2]);
    match.matches[0].games = [{ side1Score: 21, side2Score: 15 }, { side1Score: 21, side2Score: 18 }]; // +9
    match.matches[1].games = [{ side1Score: 0, side2Score: 21 }, { side1Score: 0, side2Score: 21 }]; // -42
    match.matches[2].games = [{ side1Score: 21, side2Score: 19 }, { side1Score: 18, side2Score: 21 }, { side1Score: 21, side2Score: 19 }]; // +1
    match.matches[3].games = [{ side1Score: 21, side2Score: 19 }, { side1Score: 21, side2Score: 19 }]; // +4
    match.matches[4].games = [{ side1Score: 0, side2Score: 21 }, { side1Score: 0, side2Score: 21 }]; // supplemental, excluded
    const result = withOfficialTeamResult(match, 3);
    expect(result).toMatchObject({ team1Wins: 3, team2Wins: 1, team1PointDiff: -28 });
    const rows = teamStandings({ format: 'ROUND_ROBIN', winThreshold: 3,
      teams: ['a', 'b'].map(id => ({ id, name: id, affiliation: '' })), teamMatches: [match] });
    expect(rows[0]).toMatchObject({ id: 'a', wins: 1, matchesWon: 3, gameDiff: -28, rank: 1 });
    expect(rows[1]).toMatchObject({ id: 'b', gameDiff: 28 });
  });

  it('uses a decided LIVE encounter for a two-team head-to-head tie', () => {
    const result = withOfficialTeamResult(encounter([2, 2, 2], 'LIVE'), 3);
    expect(rankTeamRoundRobin(['a', 'b'].map(id => ({ id, wins: 1, gameDiff: 0 })), [result])
      .map(row => row.id)).toEqual(['b', 'a']);
  });

  it('does not count a winning point before the referee confirms the child', () => {
    const match = encounter([1, 1, 1], 'LIVE');
    match.matches[2].status = 'LIVE';
    expect(withOfficialTeamResult(match, 3)).toMatchObject({ team1Wins: 2, team2Wins: 0, winnerTeamId: null, resultDecided: false });
  });

  it('recomputes the cutoff after a correction and clears it after a reset', () => {
    const match = encounter([1, 1, 1, 2, 2]);
    match.matches[0].winnerSide = 2;
    expect(withOfficialTeamResult(match, 3)).toMatchObject({ team1Wins: 2, team2Wins: 3, winnerTeamId: 'b' });
    match.matches.forEach(child => { child.status = 'PENDING'; });
    expect(withOfficialTeamResult({ ...match, status: 'PENDING' }, 3))
      .toMatchObject({ team1Wins: 0, team2Wins: 0, winnerTeamId: null, resultDecided: false });
  });

  it('retains a bye without child matches and excludes a cancelled encounter', () => {
    expect(withOfficialTeamResult({ ...encounter([]), team2Id: null }, 3).resultDecided).toBe(true);
    expect(withOfficialTeamResult(encounter([1, 1, 1], 'CANCELLED'), 3).resultDecided).toBe(false);
  });
});
