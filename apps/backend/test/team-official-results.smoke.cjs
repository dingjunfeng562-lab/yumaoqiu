const assert = require('node:assert/strict');

exports.run = async ({ db, create, api, lineup, detail, selection, browserSession }) => {
  const browser = browserSession ? await require('./team-official-results.browser.cjs').create(browserSession) : null;
  try {
  const cases = [
    { winners: [1, 1, 1, 2, 2], cutoff: 3, score: [3, 0] },
    { winners: [1, 1, 1, 1, 1], cutoff: 3, score: [3, 0] },
    { winners: [1, 2, 1, 1, 1], cutoff: 4, score: [3, 1] },
    { winners: [1, 2, 1, 2, 1], cutoff: 5, score: [3, 2] },
    { winners: [1, 2, 1, 1, 2], cutoff: 4, score: [3, 1], expectedNet: -28, games: [
      [[21, 15], [21, 18]], [[0, 21], [0, 21]], [[21, 19], [18, 21], [21, 19]],
      [[21, 19], [21, 19]], [[0, 21], [0, 21]],
    ] },
  ];
  const types = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'];
  for (const [caseNo, scenario] of cases.entries()) {
    const expectedNet = scenario.expectedNet ?? (scenario.score[0] - scenario.score[1]) * 15;
    let competition = await create(2, { name: `正式成绩验证-${caseNo}`, format: 'ROUND_ROBIN', winThreshold: 3,
      maxPlayerAppearances: 0, playAllMatches: true, ...(scenario.games ? { scoringRule: 'TWENTYONE_BO3' } : {}),
      items: types.map((eventType, i) => ({ eventType, sortOrder: i + 1 })) });
    competition = await api(`/team-competitions/${competition.id}/draw`, 'POST', {}, 201);
    const encounter = competition.teamMatches[0];
    for (const [index, side] of scenario.winners.entries()) {
      let players = selection(competition, encounter, index);
      if (types[index] === 'WOMENS_DOUBLES') {
        players = [encounter.team1, encounter.team2].map(team => {
          const women = competition.teams.find(row => row.id === team.id).members.filter(p => p.gender === 'FEMALE');
          return { teamId: team.id, teamCompetitionItemId: competition.items[index].id, player1Id: women[0].id, player2Id: women[1].id };
        });
      }
      await lineup(encounter, players);
      await api(`/matches/${encounter.matches[index].id}/score`, 'PATCH', {
        games: scenario.games ? scenario.games[index].map(([side1Score, side2Score]) => ({ side1Score, side2Score }))
          : [{ side1Score: side === 1 ? 15 : 0, side2Score: side === 2 ? 15 : 0 }],
      });
      const group = (await api(`/team-competitions/${competition.id}/groups`)).groups[0];
      const standing = group.standings.find(row => row.teamId === encounter.team1.id);
      if (index + 1 < scenario.cutoff) assert.equal(standing.wins, 0);
      else {
        assert.equal(standing.wins, 1);
        assert.equal(standing.matchesWon, scenario.score[0]);
        assert.equal(standing.netMatches, expectedNet);
        assert.equal(standing.groupRank, 1);
        assert.equal(group.matches[0].resultDecided, true);
        assert.equal(group.matches[0].status, index === 4 ? 'COMPLETED' : 'LIVE');
        assert.deepEqual([group.matches[0].team1Wins, group.matches[0].team2Wins], scenario.score);
      }
      if (browser && caseNo === 0 && (index + 1 === scenario.cutoff || index === 4)) {
        await browser.inspect({ competition, encounter, completed: index === 4, expectedNet });
      }
    }
    const final = (await detail(competition.id)).teamMatches[0];
    assert.deepEqual([final.team1Wins, final.team2Wins], scenario.score);
    assert.equal(final.matches.filter(child => child.isSupplemental).length, 5 - scenario.cutoff);
    assert(final.matches.every((child, index) => child.status === 'COMPLETED'
      && child.games.length === (scenario.games?.[index].length ?? 1)));
    // Simulate data saved before the fix. Reads must correct the presentation without touching raw child scores.
    await db.teamMatch.update({ where: { id: encounter.id }, data: {
      team1Wins: scenario.winners.filter(side => side === 1).length,
      team2Wins: scenario.winners.filter(side => side === 2).length,
    } });
    const group = (await api(`/team-competitions/${competition.id}/groups`)).groups[0];
    await db.teamGroupMember.updateMany({ where: { groupId: group.id }, data: { netMatches: 99, wins: 99, groupRank: 99 } });
    const direct = await api(`/team-competitions/${competition.id}/groups/${group.id}/standings`);
    assert.equal(direct.standings.find(row => row.teamId === encounter.team1.id).netMatches, expectedNet);
    const refreshed = (await api(`/team-competitions/${competition.id}/groups`)).groups[0];
    assert.equal(refreshed.standings.find(row => row.teamId === encounter.team1.id).wins, 1);
    const legacyDetail = (await detail(competition.id)).teamMatches[0];
    assert.deepEqual([legacyDetail.team1Wins, legacyDetail.team2Wins], scenario.score);
  }
  console.log(JSON.stringify({ officialTeamResults: 'passed', scenarios: cases.length, immediateGroupRankings: true,
    supplementalLineupsAndScores: true, legacyDataReads: true }));
  } finally {
    if (browser) await browser.close();
  }
};
