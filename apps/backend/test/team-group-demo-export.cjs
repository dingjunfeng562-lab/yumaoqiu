// 生成一份用于查看的团体赛秩序册示例（临时数据，导出后立即删除）
require('dotenv/config');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { TeamCompetitionsService } = require('../dist/team-competitions/team-competitions.service');
const { ExportsService } = require('../dist/exports/exports.service');

const db = new PrismaService();
const svc = new TeamCompetitionsService(db);
const exportsSvc = new ExportsService(db);
const actorId = randomUUID();
const tournamentId = randomUUID();
const competitionId = randomUUID();
const outDir = path.join(__dirname, '..', '..', '..', 'outputs', 'team-group-verification');

const TEAMS = [
  ['市第一中学', '市第一中学', [['陈昊', 'MALE'], ['李承泽', 'MALE'], ['周雨桐', 'FEMALE'], ['林书瑶', 'FEMALE']]],
  ['实验中学', '实验中学', [['王子航', 'MALE'], ['赵一鸣', 'MALE'], ['孙嘉怡', 'FEMALE'], ['吴思彤', 'FEMALE']]],
  ['外国语学校', '外国语学校', [['郑浩然', 'MALE'], ['黄子轩', 'MALE'], ['何静怡', 'FEMALE'], ['徐若曦', 'FEMALE']]],
  ['育才中学', '育才中学', [['马天佑', 'MALE'], ['高远', 'MALE'], ['冯雨欣', 'FEMALE'], ['蒋梦琪', 'FEMALE']]],
];

async function main() {
  await db.user.create({ data: { id: actorId, username: `demo-${actorId.slice(0, 8)}`, email: `${actorId}@demo.invalid`, passwordHash: 'x', role: 'ADMIN' } });
  await db.tournament.create({ data: {
    id: tournamentId, name: '2026 市青少年羽毛球团体赛', startDate: new Date('2026-10-18T00:00:00Z'),
    endDate: new Date('2026-10-20T00:00:00Z'), submittedById: actorId, isPublished: false, approvalStatus: 'APPROVED',
  } });
  await db.teamCompetition.create({ data: {
    id: competitionId, tournamentId, name: '高中组团体赛',
    format: 'GROUP_PLUS_KNOCKOUT', groupCount: 2, advancePerGroup: 1,
    winThreshold: 2, maxPlayerAppearances: 2, playAllMatches: false,
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
  } });
  for (const [i, eventType] of ['MENS_SINGLES', 'WOMENS_SINGLES', 'MIXED_DOUBLES'].entries()) {
    await db.teamCompetitionItem.create({ data: { teamCompetitionId: competitionId, eventType, sortOrder: i + 1 } });
  }
  for (const [name, affiliation, roster] of TEAMS) {
    const team = await db.team.create({ data: { teamCompetitionId: competitionId, name, affiliation } });
    // 选手姓名只写姓名：单位由秩序表的“单位”行体现，不拼进姓名。
    for (const [playerName, gender] of roster) {
      const player = await db.player.create({ data: { name: playerName, gender, affiliation, ownerId: actorId } });
      await db.teamMember.create({ data: { teamId: team.id, playerId: player.id } });
    }
  }

  await svc.generateGroupDraw(competitionId, {});
  const items = await db.teamCompetitionItem.findMany({ where: { teamCompetitionId: competitionId }, orderBy: { sortOrder: 'asc' } });

  // 打完小组赛：每组由 team1 全胜
  const groupMatches = await db.teamMatch.findMany({
    where: { teamCompetitionId: competitionId, stage: 'GROUP' },
    include: { matches: { orderBy: { matchNo: 'asc' } } },
  });
  for (const encounter of groupMatches) {
    for (const sub of encounter.matches.slice(0, 2)) {
      await db.match.update({ where: { id: sub.id }, data: { status: 'COMPLETED', winnerSide: 1 } });
      await svc.updateTeamMatchAggregate(db, sub.id);
    }
  }
  await svc.generateKnockoutFromGroups(competitionId, {});

  // 排场：让日程表/秩序表有真实内容
  const venue1 = await db.venue.create({ data: { tournamentId, name: '1号场', sortOrder: 1 } });
  const venue2 = await db.venue.create({ data: { tournamentId, name: '2号场', sortOrder: 2 } });
  const schedule = async (encounterId, venueId, startHour) => {
    const children = await db.match.findMany({ where: { teamMatchId: encounterId }, orderBy: { matchNo: 'asc' } });
    for (const [i, child] of children.entries()) {
      await db.match.update({
        where: { id: child.id },
        data: { venueId, scheduledAt: new Date(`2026-10-19T${String(startHour + i).padStart(2, '0')}:00:00+08:00`) },
      });
    }
  };
  const groupEncounters = await db.teamMatch.findMany({ where: { teamCompetitionId: competitionId, stage: 'GROUP' }, orderBy: [{ groupId: 'asc' }, { matchNo: 'asc' }] });
  for (const [i, encounter] of groupEncounters.entries()) {
    await schedule(encounter.id, i % 2 === 0 ? venue1.id : venue2.id, 9 + Math.floor(i / 2) * 2);
  }
  const finalEncounter = await db.teamMatch.findFirst({ where: { teamCompetitionId: competitionId, stage: 'KNOCKOUT' }, orderBy: { roundNo: 'desc' } });
  if (finalEncounter) await schedule(finalEncounter.id, venue1.id, 15);

  // 只给决赛锁定名单（小组赛均已结束），其余场次保持待提交
  const first = await db.teamMatch.findFirst({ where: { teamCompetitionId: competitionId, stage: 'KNOCKOUT', team1Id: { not: null }, team2Id: { not: null } } });
  const firstFull = await db.teamMatch.findUnique({ where: { id: first.id } });
  const pick = async (teamId, gender, skip = 0) => {
    const members = await db.teamMember.findMany({ where: { teamId }, include: { player: true }, orderBy: { player: { name: 'asc' } } });
    return members.map(m => m.player).filter(p => p.gender === gender)[skip].id;
  };
  const selections = [];
  for (const teamId of [firstFull.team1Id, firstFull.team2Id]) {
    selections.push({ teamId, teamCompetitionItemId: items[0].id, player1Id: await pick(teamId, 'MALE', 0) });
    selections.push({ teamId, teamCompetitionItemId: items[1].id, player1Id: await pick(teamId, 'FEMALE', 0) });
    selections.push({ teamId, teamCompetitionItemId: items[2].id, player1Id: await pick(teamId, 'MALE', 1), player2Id: await pick(teamId, 'FEMALE', 1) });
  }
  await svc.setTeamLineups(first.id, { selections, lock: true, overrideConfirmed: true });

  fs.mkdirSync(outDir, { recursive: true });
  const exported = await exportsSvc.exportTournament(tournamentId, 'orderbook');
  const file = path.join(outDir, '团体赛秩序册示例.xlsx');
  fs.writeFileSync(file, exported.content);
  console.log(file);
}

async function cleanup() {
  const matches = await db.match.findMany({ where: { teamMatch: { teamCompetitionId: competitionId } }, select: { id: true } });
  await db.game.deleteMany({ where: { matchId: { in: matches.map(m => m.id) } } });
  await db.match.deleteMany({ where: { teamMatch: { teamCompetitionId: competitionId } } });
  await db.teamLineup.deleteMany({ where: { teamMatch: { teamCompetitionId: competitionId } } });
  await db.teamMatch.deleteMany({ where: { teamCompetitionId: competitionId } });
  await db.teamGroup.deleteMany({ where: { teamCompetitionId: competitionId } });
  await db.teamMember.deleteMany({ where: { team: { teamCompetitionId: competitionId } } });
  await db.team.deleteMany({ where: { teamCompetitionId: competitionId } });
  await db.teamCompetitionItem.deleteMany({ where: { teamCompetitionId: competitionId } });
  await db.teamCompetition.deleteMany({ where: { id: competitionId } });
  await db.player.deleteMany({ where: { ownerId: actorId } });
  await db.tournament.deleteMany({ where: { id: tournamentId } });
  await db.user.deleteMany({ where: { id: actorId } });
  console.log('临时数据已清理');
}

main()
  .then(cleanup)
  .catch(async error => { console.error(error); await cleanup(); process.exitCode = 1; })
  .finally(() => db.$disconnect());
