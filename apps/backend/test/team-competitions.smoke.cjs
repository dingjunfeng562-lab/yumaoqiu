// Uses only newly-created fixtures on the local database; always removes them.
// Start the backend on TEAM_QA_API (default :4011), then run from apps/backend.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtService } = require('@nestjs/jwt');
const db = new PrismaService();
const base = process.env.TEAM_QA_API || 'http://localhost:4011/api';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const actorId = randomUUID(), otherId = randomUUID(), rootId = randomUUID(), tournamentId = randomUUID();
const competitionIds = [];
let user, token, checks = 0;
async function api(url, method = 'GET', body, expected = 200) {
  const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`); checks++;
  return data;
}
const start = { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 };
const detail = id => api(`/team-competitions/${id}`);
const teamPayload = label => ({ teamName: label, affiliation: '团体赛验证', players: [
  ...[1, 2, 3].map(i => ({ name: `${label}男${i}`, gender: 'MALE', affiliation: '团体赛验证' })),
  ...[1, 2].map(i => ({ name: `${label}女${i}`, gender: 'FEMALE', affiliation: '团体赛验证' })),
] });
async function makeCompetition(n, overrides = {}) {
  const created = await api('/team-competitions', 'POST', {
    tournamentId, name: `团体赛验证-${n}队`,
    winThreshold: 2, scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
    items: ['MENS_SINGLES', 'WOMENS_SINGLES', 'MIXED_DOUBLES'].map((eventType, i) => ({ eventType, sortOrder: i + 1 })),
    ...overrides,
  }, 201);
  competitionIds.push(created.id);
  for (let i = 0; i < n; i++) await api(`/team-competitions/${created.id}/teams/import`, 'POST', teamPayload(`队${i + 1}`), 201);
  return detail(created.id);
}
function selection(competition, encounter, index, maleIndex = 0) {
  const item = competition.items[index];
  return [encounter.team1, encounter.team2].map(side => {
    const team = competition.teams.find(t => t.id === side.id);
    const males = team.members.filter(p => p.gender === 'MALE');
    const females = team.members.filter(p => p.gender === 'FEMALE');
    return { teamId: team.id, teamCompetitionItemId: item.id,
      player1Id: item.eventType === 'WOMENS_SINGLES' ? females[0].id : males[maleIndex].id,
      ...(item.eventType === 'MIXED_DOUBLES' ? { player2Id: females[1].id } : {}),
      ...(item.eventType === 'MENS_DOUBLES' ? { player2Id: males[maleIndex + 1].id } : {}),
    };
  });
}
const lineup = (encounter, selections, extra = {}, expected = 200) => api(`/team-competitions/team-matches/${encounter.id}/lineups`, 'PUT', { selections, lock: true, ...extra }, expected);

async function main() {
  user = await db.user.create({ data: { id: actorId, username: `team-qa-${actorId}`, email: `${actorId}@team-qa.invalid`, passwordHash: 'test-only-unused', role: 'ADMIN', permissions: ['TEAMS', 'SCORING', 'SCHEDULING', 'TOURNAMENTS'] } });
  await db.user.create({ data: { id: otherId, username: `team-qa-${otherId}`, email: `${otherId}@team-qa.invalid`, passwordHash: 'test-only-unused', role: 'ADMIN' } });
  await db.user.create({ data: { id: rootId, username: `team-root-${rootId}`, email: `${rootId}@team-qa.invalid`, passwordHash: 'test-only-unused', role: 'ROOT' } });
  await db.tournament.create({ data: { id: tournamentId, name: '团体赛隔离验证', startDate: new Date('2026-10-18T00:00:00Z'), endDate: new Date('2026-10-20T12:00:00Z'), submittedById: actorId, isPublished: true, approvalStatus: 'APPROVED' } });
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: actorId }, { expiresIn: '1h' });
  let competition = await makeCompetition(3);
  const c = competition.id;
  await api(`/team-competitions/${c}/teams/import`, 'POST', { ...teamPayload('空名单'), players: [] }, 400);
  await api(`/team-competitions/${c}`, 'PATCH', { winThreshold: 9 }, 400);
  await api(`/team-competitions/${c}`, 'PATCH', { winThreshold: 3 }, 400);
  await api(`/team-competitions/${c}`, 'PATCH', { customGameCap: 1 }, 400);
  for (const invalid of [-1, 3, null, '2']) await api(`/team-competitions/${c}`, 'PATCH', { maxPlayerAppearances: invalid }, 400);
  const available = await api(`/team-competitions/${c}/available-players`);
  assert.equal(available.length, 15);
  await api('/players', 'GET', undefined, 403);
  const foreign = await db.player.create({ data: { name: '其他管理员队员', gender: 'MALE', affiliation: '其他', ownerId: otherId } });
  await api(`/team-competitions/${c}/teams`, 'POST', { name: '越权队', affiliation: '测试', playerIds: [foreign.id, ...available.slice(0, 4).map(p => p.id)] }, 404);
  competition = await api(`/team-competitions/${c}/draw`, 'POST', {}, 201);
  const semifinal = competition.teamMatches.find(m => m.round === 'SF' && m.team1 && m.team2);
  assert(semifinal); assert.equal(competition.teamMatches.find(m => m.round === 'F').status, 'PENDING');
  assert.equal(competition.teamMatches.find(m => m.round === 'F').winnerTeamId, null);
  const m1 = semifinal.matches[0], m2 = semifinal.matches[1], m3 = semifinal.matches[2];
  const first = selection(competition, semifinal, 0);
  await lineup(semifinal, first, { lock: false });
  await api(`/matches/${m1.id}/start`, 'POST', start, 409);
  await lineup(semifinal, first);
  await lineup(semifinal, first, {}, 409);
  await lineup(semifinal, selection(competition, semifinal, 1));
  await api(`/matches/${m2.id}/start`, 'POST', start, 409);
  let score = await api(`/matches/${m1.id}/start`, 'POST', start, 201);
  assert.equal(score.event.scoringRule, 'FIFTEEN_ONE');
  assert.equal((await detail(c)).teamMatches.find(m => m.id === semifinal.id).status, 'LIVE');
  await api(`/matches/${m1.id}/point`, 'POST', { side: 1 }, 201);
  await lineup(semifinal, selection(competition, semifinal, 0, 1), {}, 409);
  await lineup(semifinal, selection(competition, semifinal, 0, 1), { overrideConfirmed: true });
  score = await api(`/matches/${m1.id}/score`);
  assert.equal(score.games[0].side1Score, 1); assert.equal(score.status, 'LIVE');
  assert(score.side1.name.includes('男2'));
  assert.equal(await db.matchEvent.count({ where: { matchId: m1.id, type: 'WARNING' } }), 1);
  // Unstarted later sub-events remain editable while the first one is live.
  await lineup(semifinal, selection(competition, semifinal, 2), { lock: false });
  const firstTeam = competition.teams.find(t => t.id === semifinal.team1.id);
  await api(`/team-competitions/teams/${firstTeam.id}/members`, 'PUT', { playerIds: firstTeam.members.map(p => p.id) }, 409);
  await api(`/team-competitions/teams/${firstTeam.id}/players`, 'POST', { players: [{ name: '临时男队员', gender: 'MALE', affiliation: '测试' }], overrideConfirmed: false }, 409);
  await api(`/team-competitions/teams/${firstTeam.id}/players`, 'POST', { players: [{ name: '临时男队员', gender: 'MALE', affiliation: '测试' }], overrideConfirmed: true }, 201);
  competition = await detail(c);
  const extraPlayer = competition.teams.find(t => t.id === firstTeam.id).members.find(p => p.name === '临时男队员');
  assert(extraPlayer); assert.equal((await db.player.findUnique({ where: { id: extraPlayer.id } })).ownerId, actorId);
  const thirdSelections = selection(competition, semifinal, 2);
  thirdSelections[0].player1Id = extraPlayer.id;
  await lineup(semifinal, thirdSelections);
  // Score through the actual point/finish API: winning points alone do not finish the match.
  for (let i = 1; i < 15; i++) score = await api(`/matches/${m1.id}/point`, 'POST', { side: 1 }, 201);
  assert.equal(score.status, 'LIVE'); assert.equal(score.winnerSide, 1);
  await api(`/matches/${m1.id}/finish`, 'POST', {}, 201);
  const currentMembers = competition.teams.find(t => t.id === firstTeam.id).members;
  const playedPlayer = currentMembers.find(p => p.name.endsWith('男2'));
  await api(`/team-competitions/teams/${firstTeam.id}/members`, 'PUT', { playerIds: currentMembers.filter(p => p.id !== playedPlayer.id).map(p => p.id), overrideConfirmed: true });
  assert((await api(`/matches/${m1.id}/score`)).side1.name.includes('男2'));
  await api(`/team-competitions/teams/${firstTeam.id}/members`, 'PUT', { playerIds: currentMembers.map(p => p.id), overrideConfirmed: true });
  await lineup(semifinal, first, { overrideConfirmed: true }, 409);
  // Simulate a legacy later sub-event already live, to prove clinching cancels it as well.
  await db.match.update({ where: { id: m3.id }, data: { status: 'LIVE', startedAt: new Date() } });
  await db.game.create({ data: { matchId: m3.id, gameNo: 1, side1Score: 3, side2Score: 2 } });
  await api(`/matches/${m2.id}/start`, 'POST', start, 201);
  await api(`/matches/${m2.id}/score`, 'PATCH', { games: [{ side1Score: 15, side2Score: 0 }] });
  competition = await detail(c);
  const finished = competition.teamMatches.find(m => m.id === semifinal.id);
  assert.equal(finished.team1Wins, 2); assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.matches[2].status, 'CANCELLED');
  assert.equal(finished.matches[2].games[0].side1Score, 3);
  await api(`/matches/${m3.id}/point`, 'POST', { side: 1 }, 400);
  await api(`/matches/${m3.id}/start`, 'POST', start, 400);
  await api(`/team-competitions/${c}/draw`, 'POST', { force: true }, 409);
  const final = competition.teamMatches.find(m => m.round === 'F');
  assert(final.team1 && final.team2); assert.equal(final.matches.length, 3);
  assert(final.matches.every(m => m.lineupLocked === false));
  await lineup(final, selection(competition, final, 0, 2));
  const finalState = await api(`/matches/${final.matches[0].id}/score`);
  assert(finalState.side1.name.includes('男3'));
  assert((await api(`/matches/${m1.id}/score`)).side1.name.includes('男2'));
  // A normal 2-0 final cancels an unstarted third match.
  await api(`/matches/${final.matches[0].id}/score`, 'PATCH', { games: [{ side1Score: 15, side2Score: 0 }] });
  await lineup(final, selection(competition, final, 1));
  await api(`/matches/${final.matches[1].id}/score`, 'PATCH', { games: [{ side1Score: 15, side2Score: 0 }] });
  competition = await detail(c);
  assert.equal(competition.teamMatches.find(m => m.round === 'F').matches[2].status, 'CANCELLED');

  // Draw and advancement cases, including non powers of two.
  for (const n of [2, 4, 5, 6, 7, 8, 9]) {
    let row = await makeCompetition(n);
    row = await api(`/team-competitions/${row.id}/draw`, 'POST', {}, 201);
    assert.equal(row.teamMatches.find(m => m.round === 'F').winnerTeamId, null);
    assert.equal(row.teamMatches.filter(m => m.status === 'COMPLETED').length, 2 ** Math.ceil(Math.log2(n)) - n);
  }
  // Custom score and order survive edits, and custom values drive real scoring.
  let custom = await makeCompetition(2, { customGamePoint: 7, customGameCap: 9, customGamesToWin: 1 });
  const customId = custom.id;
  const reordered = [...custom.items].reverse().map((item, i) => ({ eventType: item.eventType, sortOrder: i + 1 }));
  await api(`/team-competitions/${custom.id}`, 'PATCH', { items: reordered });
  custom = await api(`/team-competitions/${custom.id}/draw`, 'POST', {}, 201);
  assert.equal(custom.items[0].eventType, 'MIXED_DOUBLES');
  const encounter = custom.teamMatches[0];
  await lineup(encounter, selection(custom, encounter, 0));
  let state = await api(`/matches/${encounter.matches[0].id}/start`, 'POST', start, 201);
  for (let i = 0; i < 7; i++) state = await api(`/matches/${encounter.matches[0].id}/point`, 'POST', { side: 1 }, 201);
  assert.equal(state.winnerSide, 1); assert.equal(state.games[0].side1Score, 7);
  await api(`/matches/${encounter.matches[0].id}/finish`, 'POST', {}, 201);
  // Scheduling must include team matches and sequence their sub-events.
  const venue = await db.venue.create({ data: { tournamentId, name: '验证场地', sortOrder: 1 } });
  const schedule = await api(`/scheduling?tournamentId=${tournamentId}`);
  assert(schedule.matches.some(m => m.id === encounter.matches[0].id));
  await api(`/matches/${encounter.matches[1].id}/schedule`, 'PATCH', { venueId: venue.id, scheduledAt: '2026-10-19T01:00:00Z' });
  const publicBefore = await api('/public/team-competitions');
  assert(!publicBefore.teamCompetitions.some(c => c.id === customId));
  await api(`/team-competitions/${customId}`, 'PATCH', { isPublished: true });
  await db.tournament.update({ where: { id: tournamentId }, data: { isPublished: false } });
  assert(!(await api('/public/team-competitions')).teamCompetitions.some(c => c.id === customId));
  await db.tournament.update({ where: { id: tournamentId }, data: { isPublished: true } });
  const batch = await makeCompetition(0);
  const batchRows = ['批量甲队', '批量乙队'].flatMap(teamName => teamPayload(teamName).players.map(player => ({ ...player, teamName })));
  const invalid = batchRows.map((row, i) => ({ ...row, name: i === 5 ? ' ' : row.name, lineNumber: i + 2 }));
  const invalidResult = await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: invalid }, 400);
  assert(invalidResult.message.includes('第 7'));
  assert.equal((await detail(batch.id)).teams.length, 0);
  assert.equal(await db.player.count({ where: { ownerId: actorId, name: { startsWith: '批量' } } }), 0);
  const imported = await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: batchRows }, 201);
  assert.deepEqual(imported, { teamCount: 2, playerCount: 10, drawCleared: false });
  assert.equal((await detail(batch.id)).teams.length, 2);
  await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: batchRows }, 409);
  assert.equal(await db.player.count({ where: { ownerId: actorId, name: { startsWith: '批量' } } }), 10);
  const beforeBrowser = await makeCompetition(0, { name: '浏览器批量导入验证' });
  await require('./team-rules.smoke.cjs').run({ db, actorId, api, makeCompetition, teamPayload, selection, lineup, detail,
    browserSession: process.env.TEAM_OFFICIAL_BROWSER === '1' ? {
      user: await db.user.findUniqueOrThrow({ where: { id: rootId } }),
      token: new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: rootId }, { expiresIn: '1h' }),
    } : undefined,
  });
  if (process.env.TEAM_QA_BROWSER === '1') {
    user = await db.user.update({ where: { id: actorId }, data: { permissions: [...user.permissions, 'PLAYERS'] } });
    await require('./team-competitions.browser.cjs').run({ base, token, user, competition: custom, batchCompetition: beforeBrowser, tournamentId, api });
  }
  // 未发布的对阵视为草稿：改名单时自动清空，导入照常成功。
  await api(`/team-competitions/${batch.id}/draw`, 'POST', {}, 201);
  const draftRows = ['草稿后甲队'].flatMap(teamName => teamPayload(teamName).players.map(player => ({ ...player, teamName })));
  const draftImport = await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: draftRows }, 201);
  assert.equal(draftImport.drawCleared, true);
  const afterDraftImport = await detail(batch.id);
  assert.equal(afterDraftImport.teamMatches.length, 0);
  assert.equal(afterDraftImport.teams.length, 3);
  // 发布后名单锁定：导入被拒绝；取消对阵会清空并取消公开，之后可继续导入。
  await api(`/team-competitions/${batch.id}/draw`, 'POST', {}, 201);
  await api(`/team-competitions/${batch.id}`, 'PATCH', { isPublished: true });
  const blockedRows = ['发布后乙队'].flatMap(teamName => teamPayload(teamName).players.map(player => ({ ...player, teamName })));
  await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: blockedRows }, 409);
  const clearedBatch = await api(`/team-competitions/${batch.id}/draw/clear`, 'POST', {}, 201);
  assert.equal(clearedBatch.teamMatches.length, 0);
  assert.equal(clearedBatch.isPublished, false);
  assert.equal(clearedBatch.teams.length, 3);
  await api(`/team-competitions/${batch.id}/teams/batch-import`, 'POST', { players: blockedRows }, 201);
  assert.equal((await detail(batch.id)).teams.length, 4);
  // 已开赛：管理员不能直接取消，须提交申请并由超级管理员审批。
  await api(`/team-competitions/${batch.id}/draw`, 'POST', {}, 201);
  const startedMatch = await db.match.findFirst({ where: { teamMatch: { teamCompetitionId: batch.id } }, orderBy: { matchNo: 'asc' } });
  await db.match.update({ where: { id: startedMatch.id }, data: { status: 'LIVE', startedAt: new Date() } });
  await api(`/team-competitions/${batch.id}/draw/clear`, 'POST', {}, 409);
  const clearRequest = await api(`/team-competitions/${batch.id}/draw/clear-request`, 'POST', { reason: '验证审批' }, 201);
  assert.equal((await api(`/team-competitions/${batch.id}/draw/clear-requests`, 'GET')).filter(request => request.status === 'PENDING').length, 1);
  const adminToken = token;
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: rootId }, { expiresIn: '1h' });
  await api(`/team-competitions/${batch.id}/draw/clear-requests/${clearRequest.id}/approve`, 'POST', {}, 201);
  token = adminToken;
  const afterApproval = await detail(batch.id);
  assert.equal(afterApproval.teamMatches.length, 0);
  assert.equal(afterApproval.isPublished, false);
  console.log(JSON.stringify({ ok: true, httpChecks: checks, fixtures: competitionIds.length, roster: 'variable', perItemLock: true, overrideKeepsScore: true, clinchCancelsPendingAndLive: true, nextRoundLineupsIndependent: true, customScoring: true }));
}
main().finally(async () => {
  await db.teamMatch.deleteMany({ where: { teamCompetitionId: { in: competitionIds } } });
  await db.teamCompetition.deleteMany({ where: { id: { in: competitionIds } } });
  await db.tournament.deleteMany({ where: { id: tournamentId } });
  await db.player.deleteMany({ where: { ownerId: { in: [actorId, otherId] } } });
  await db.teamDrawClearRequest.deleteMany({ where: { requesterId: { in: [actorId, otherId] } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: [actorId, otherId, rootId] } } });
  await db.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
