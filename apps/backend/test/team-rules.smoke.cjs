const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

exports.run = async ({ db, actorId, api, makeCompetition, teamPayload, selection, lineup, detail, browserSession }) => {
  // Keep scheduling fixtures separate from other tests and all user tournaments.
  const tournamentId = randomUUID();
  await db.tournament.create({ data: { id: tournamentId, name: '团体规则与场地验证', submittedById: actorId,
    startDate: new Date('2026-10-18T00:00:00Z'), endDate: new Date('2026-10-20T12:00:00Z'), breakMinutes: 5 } });
  const create = (n, extra = {}) => makeCompetition(n, { tournamentId, ...extra });
  try {
    const flex = await create(0);
    // Even legacy stored roster counts must not restrict new rosters.
    await db.teamCompetition.update({ where: { id: flex.id }, data: { malePlayerCount: 3, femalePlayerCount: 2 } });
    const small = teamPayload('人数较少队'); small.players = small.players.slice(0, 2);
    const large = teamPayload('人数较多队'); large.players.push({ name: '额外队员', gender: 'FEMALE', affiliation: '验证' });
    await api(`/team-competitions/${flex.id}/teams/import`, 'POST', small, 201);
    await api(`/team-competitions/${flex.id}/teams/import`, 'POST', large, 201);
    const players = [{ teamName: '单人队', name: '单人女队员', gender: 'FEMALE' },
      ...teamPayload('批量人数队').players.slice(0, 3).map(p => ({ ...p, teamName: '批量人数队' }))];
    await api(`/team-competitions/${flex.id}/teams/batch-import`, 'POST', { players }, 201);
    const libraryPlayer = await db.player.create({ data: { ownerId: actorId, name: '选手库单人队员', gender: 'FEMALE', affiliation: '验证' } });
    await api(`/team-competitions/${flex.id}/teams`, 'POST', { name: '选手库单人队', affiliation: '验证', playerIds: [libraryPlayer.id] }, 201);
    assert.deepEqual((await detail(flex.id)).teams.map(team => team.memberCount).sort((a, b) => a - b), [1, 1, 2, 3, 6]);
    await api(`/team-competitions/${flex.id}/draw`, 'POST', {}, 201);

    for (const limit of [1, 2, 0]) {
      let row = await create(2, { maxPlayerAppearances: limit, items: ['MENS_SINGLES', 'MENS_DOUBLES', 'MIXED_DOUBLES'].map((eventType, i) => ({ eventType, sortOrder: i + 1 })) });
      assert.equal(row.maxPlayerAppearances, limit);
      row = await api(`/team-competitions/${row.id}/draw`, 'POST', {}, 201);
      const encounter = row.teamMatches[0];
      await lineup(encounter, selection(row, encounter, 0));
      const doubles = selection(row, encounter, 1);
      await lineup(encounter, doubles.map(s => ({ ...s, player2Id: s.player1Id })), {}, 400);
      await lineup(encounter, doubles, {}, limit === 1 ? 409 : 200);
      if (limit === 1) await lineup(encounter, selection(row, encounter, 1, 1));
      const third = selection(row, encounter, 2);
      await lineup(encounter, third, { overrideConfirmed: true }, limit === 0 ? 200 : 409);
      assert.equal((await detail(row.id)).teamMatches[0].lineups.length, limit === 0 ? 6 : 4);
      await api(`/team-competitions/${row.id}`, 'PATCH', { maxPlayerAppearances: limit === 0 ? 1 : 0 }, 409);
    }

    // Whole-encounter scheduling with multiple courts and no submitted lineups.
    let scheduled = await create(4, { playAllMatches: true });
    scheduled = await api(`/team-competitions/${scheduled.id}/draw`, 'POST', {}, 201);
    const courts = [];
    for (let i = 1; i <= 2; i++) courts.push(await db.venue.create({ data: { tournamentId, name: `团体场地${i}`, sortOrder: i } }));
    const auto = () => api('/scheduling/auto', 'POST', { tournamentId, startAt: '2026-10-18T01:00:00Z', matchMinutes: 10, breakMinutes: 5 }, 201);
    await auto();
    scheduled = await detail(scheduled.id);
    const encounters = scheduled.teamMatches.filter(row => row.matches.length);
    for (const encounter of encounters) {
      assert.equal(new Set(encounter.matches.map(m => m.venue.id)).size, 1);
      encounter.matches.forEach((match, i) => {
        if (i) assert.equal(new Date(match.scheduledAt) - new Date(encounter.matches[i - 1].scheduledAt), 15 * 60000);
      });
    }
    const encounter = encounters[0];
    const otherCourt = courts.find(c => c.id !== encounter.matches[0].venue.id);
    await api(`/matches/${encounter.matches[1].id}/schedule`, 'PATCH', { venueId: otherCourt.id, scheduledAt: '2026-10-19T01:00:00Z', durationMinutes: 20 });
    let updated = (await detail(scheduled.id)).teamMatches.find(row => row.id === encounter.id);
    assert(updated.matches.every(m => m.venue.id === otherCourt.id));
    assert.equal(new Date(updated.matches[1].scheduledAt) - new Date(updated.matches[0].scheduledAt), 15 * 60000);
    assert.equal(new Date(updated.matches[2].scheduledAt) - new Date(updated.matches[1].scheduledAt), 25 * 60000);
    for (let i = 0; i < 2; i++) {
      await lineup(encounter, selection(scheduled, encounter, i));
      await api(`/matches/${encounter.matches[i].id}/score`, 'PATCH', { games: [{ side1Score: 15, side2Score: 0 }] });
    }
    updated = (await detail(scheduled.id)).teamMatches.find(row => row.id === encounter.id);
    assert.equal(updated.status, 'LIVE'); assert.equal(updated.winnerTeamId, encounter.team1.id);
    assert.equal(updated.matches[2].status, 'PENDING');
    const finalBefore = (await detail(scheduled.id)).teamMatches.find(row => row.round === 'F');
    assert(![finalBefore.team1?.id, finalBefore.team2?.id].includes(encounter.team1.id));
    await api(`/matches/${encounter.matches[2].id}/schedule`, 'PATCH', { venueId: courts.find(c => c.id !== otherCourt.id).id }, 409);
    await auto();
    updated = (await detail(scheduled.id)).teamMatches.find(row => row.id === encounter.id);
    assert(updated.matches.every(m => m.venue.id === otherCourt.id));
    await lineup(encounter, selection(scheduled, encounter, 2));
    await api(`/matches/${encounter.matches[2].id}/start`, 'POST', { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 }, 201);
    await api(`/matches/${encounter.matches[2].id}/score`, 'PATCH', { games: [{ side1Score: 0, side2Score: 15 }] });
    updated = (await detail(scheduled.id)).teamMatches.find(row => row.id === encounter.id);
    assert.equal(updated.status, 'COMPLETED'); assert.equal(updated.team1Wins, 2); assert.equal(updated.team2Wins, 0);
    const finalAfter = (await detail(scheduled.id)).teamMatches.find(row => row.round === 'F');
    assert([finalAfter.team1?.id, finalAfter.team2?.id].includes(encounter.team1.id));

    // A low target still means first to the target; later scores cannot change it.
    let low = await create(2, { playAllMatches: true, winThreshold: 1 });
    low = await api(`/team-competitions/${low.id}/draw`, 'POST', {}, 201);
    const lowMatch = low.teamMatches[0];
    for (let i = 0; i < 3; i++) {
      await lineup(lowMatch, selection(low, lowMatch, i));
      await api(`/matches/${lowMatch.matches[i].id}/score`, 'PATCH', { games: [{ side1Score: i ? 15 : 0, side2Score: i ? 0 : 15 }] });
    }
    const result = (await detail(low.id)).teamMatches[0];
    assert.equal(result.winnerTeamId, lowMatch.team2.id); assert.equal(result.status, 'COMPLETED');
    assert.equal(result.team1Wins, 0); assert.equal(result.team2Wins, 1);

    await require('./team-official-results.smoke.cjs').run({ db, create, api, lineup, detail, selection, browserSession });

    // Tournament settings use the same rules and preserve false/zero on edit.
    await api(`/tournaments/${tournamentId}`, 'PATCH', { eventTypes: ['MENS_SINGLES', 'WOMENS_SINGLES', 'MENS_DOUBLES', 'WOMENS_DOUBLES', 'MIXED_DOUBLES'], teamMaxPlayerAppearances: 0, teamPlayAllMatches: true }, 409);
    const settingsTournamentId = randomUUID();
    await db.tournament.create({ data: { id: settingsTournamentId, name: '团体配置验证', submittedById: actorId,
      startDate: new Date('2026-10-18T00:00:00Z'), endDate: new Date('2026-10-20T12:00:00Z') } });
    try {
      const types = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MIXED_DOUBLES'];
      const config = await api(`/tournaments/${settingsTournamentId}`, 'PATCH', { eventTypes: types, includeTeamCompetition: true, teamEventTypes: types, teamWinThreshold: 2, teamMaxPlayerAppearances: 0, teamPlayAllMatches: true });
      assert.equal(config.teamCompetitions[0].maxPlayerAppearances, 0); assert.equal(config.teamCompetitions[0].playAllMatches, true);
      const edit = await api(`/tournaments/${settingsTournamentId}`, 'PATCH', { teamMaxPlayerAppearances: 1, teamPlayAllMatches: false });
      assert.equal(edit.teamCompetitions[0].maxPlayerAppearances, 1); assert.equal(edit.teamCompetitions[0].playAllMatches, false);
    } finally { await db.tournament.delete({ where: { id: settingsTournamentId } }); }
    console.log(JSON.stringify({ teamRules: 'passed', variableRosters: true, appearanceLimits: [1, 2, 0], playAllMatches: true, delayedAdvancement: true, sameCourtAutoAndManual: true }));
  } finally {
    await db.teamMatch.deleteMany({ where: { teamCompetition: { tournamentId } } });
    await db.tournament.delete({ where: { id: tournamentId } });
  }
};
