// 团体赛小组赛 + 小组出线淘汰 全流程验证（仅使用新建临时数据，结束时全部删除）
require('dotenv/config');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { TeamCompetitionsService } = require('../dist/team-competitions/team-competitions.service');
const { ExportsService } = require('../dist/exports/exports.service');

const db = new PrismaService();
const svc = new TeamCompetitionsService(db);
const exportsSvc = new ExportsService(db);
const tag = randomUUID().slice(0, 8);
const actorId = randomUUID();
const tournamentId = randomUUID();
const competitionId = randomUUID();
const outDir = path.join(__dirname, '..', '..', '..', 'outputs', 'team-group-verification');
let checks = 0;
const ok = (cond, label, extra) => { assert.ok(cond, `${label} ${extra ? JSON.stringify(extra) : ''}`); checks++; console.log(`  ✓ ${label}`); };

async function completeSubMatch(matchId, winnerSide, { doubleAggregate = false } = {}) {
  await db.match.update({ where: { id: matchId }, data: { status: 'COMPLETED', winnerSide } });
  await svc.updateTeamMatchAggregate(db, matchId);
  if (doubleAggregate) await svc.updateTeamMatchAggregate(db, matchId); // 重复汇总不应重复积分
}

async function fixtures() {
  await db.user.create({ data: { id: actorId, username: `grp-${tag}`, email: `${tag}@grp.invalid`, passwordHash: 'x', role: 'ADMIN' } });
  await db.tournament.create({ data: {
    id: tournamentId, name: `团体小组验证-${tag}`, startDate: new Date('2026-10-18T00:00:00Z'),
    endDate: new Date('2026-10-20T00:00:00Z'), submittedById: actorId, isPublished: false, approvalStatus: 'APPROVED',
  } });
  await db.teamCompetition.create({ data: {
    id: competitionId, tournamentId, name: `6队两组小组赛+淘汰-${tag}`,
    format: 'GROUP_PLUS_KNOCKOUT', groupCount: 2, advancePerGroup: 2,
    winThreshold: 2, maxPlayerAppearances: 2, playAllMatches: false,
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN', isPublished: false,
  } });
  const eventTypes = ['MENS_SINGLES', 'WOMENS_SINGLES', 'MIXED_DOUBLES'];
  for (let i = 0; i < eventTypes.length; i++) {
    await db.teamCompetitionItem.create({ data: { teamCompetitionId: competitionId, eventType: eventTypes[i], sortOrder: i + 1 } });
  }
  const teamIds = [];
  for (let t = 1; t <= 6; t++) {
    const team = await db.team.create({ data: { teamCompetitionId: competitionId, name: `队伍${t}`, affiliation: `单位${t}` } });
    teamIds.push(team.id);
    for (const [name, gender] of [[`队${t}男1`, 'MALE'], [`队${t}男2`, 'MALE'], [`队${t}女1`, 'FEMALE'], [`队${t}女2`, 'FEMALE']]) {
      const player = await db.player.create({ data: { name: `${name}-${tag}`, gender, affiliation: `单位${t}`, ownerId: actorId } });
      await db.teamMember.create({ data: { teamId: team.id, playerId: player.id } });
    }
  }
  return teamIds;
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
}

async function main() {
  const teamIds = await fixtures();

  console.log('\n[1] 生成小组对阵');
  const view = await svc.generateGroupDraw(competitionId, {});
  ok(view && Array.isArray(view.teamMatches), '生成后返回对阵视图');
  const groupData = await svc.getGroups(competitionId);
  ok(groupData.groups.length === 2, '分为 2 个小组', groupData.groups.map(g => g.groupName));
  ok(groupData.groups.every(g => g.standings.length === 3), '每组 3 支队伍');
  const groupMatches = await db.teamMatch.findMany({ where: { teamCompetitionId: competitionId }, orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }] });
  ok(groupMatches.length === 6, '共 6 场小组对阵（两组各 C(3,2)=3）', groupMatches.length);
  ok(groupMatches.every(m => m.stage === 'GROUP' && m.groupId), '全部标记为小组赛并归属小组');
  const keys = new Set(groupMatches.map(m => `${m.roundNo}-${m.matchNo}`));
  ok(keys.size === 6, '(轮次, 场次) 全局唯一，未被唯一约束拒绝', [...keys]);
  const subCount = await db.match.count({ where: { teamMatch: { teamCompetitionId: competitionId } } });
  ok(subCount === 18, '每场对阵 3 个子项，共 18 场', subCount);
  const scoredRounds = new Set(groupMatches.map(m => m.roundNo));
  ok(scoredRounds.size === 3, '小组单循环共 3 轮', [...scoredRounds]);

  console.log('\n[2] 管理员手动调整分组（抽签编排）');
  const beforeGroups = groupData.groups.map(g => ({ no: g.groupNo, ids: g.standings.map(s => s.teamId) }));
  const moved = beforeGroups[0].ids[2];
  const adjusted = [{ groupNo: 1, teamIds: [beforeGroups[0].ids[0], beforeGroups[0].ids[1], beforeGroups[1].ids[0]] },
    { groupNo: 2, teamIds: [beforeGroups[1].ids[1], beforeGroups[1].ids[2], moved] }];
  await svc.adjustGroups(competitionId, { groups: adjusted });
  const afterAdjust = await svc.getGroups(competitionId);
  const movedGroup = afterAdjust.groups.find(g => g.standings.some(s => s.teamId === moved));
  ok(movedGroup.groupNo === 2, '被移动的队伍进入指定的 B 组');
  ok((await db.teamMatch.count({ where: { teamCompetitionId: competitionId } })) === 6, '调整后重新生成 6 场对阵');

  console.log('\n[3] 录入小组赛结果并核对积分');
  const played = await db.teamMatch.findMany({ where: { teamCompetitionId: competitionId, stage: 'GROUP' }, include: { matches: { orderBy: { matchNo: 'asc' } } } });
  for (const [index, encounter] of played.entries()) {
    // 每场由 team1 赢 2 项，第一次调用重复汇总以验证幂等
    await completeSubMatch(encounter.matches[0].id, 1, { doubleAggregate: index === 0 });
    await completeSubMatch(encounter.matches[1].id, 1);
  }
  const standings = await svc.getGroups(competitionId);
  for (const group of standings.groups) {
    const wins = group.standings.reduce((sum, s) => sum + s.wins, 0);
    const losses = group.standings.reduce((sum, s) => sum + s.losses, 0);
    const net = group.standings.reduce((sum, s) => sum + s.netMatches, 0);
    ok(wins === 3 && losses === 3, `${group.groupName} 胜场合计=3、负场合计=3`, { wins, losses });
    ok(net === 0, `${group.groupName} 净胜项合计为 0`, net);
    ok(group.standings.every(s => s.groupRank), `${group.groupName} 已排出名次`);
    const ranks = group.standings.map(s => s.groupRank).sort((a, b) => a - b);
    ok(JSON.stringify(ranks) === '[1,2,3]', `${group.groupName} 名次连续 1..3`, ranks);
    const ordered = [...group.standings].sort((a, b) => a.groupRank - b.groupRank);
    ok(ordered.every((s, i) => i === 0 || ordered[i - 1].wins > s.wins || (ordered[i - 1].wins === s.wins && ordered[i - 1].netMatches >= s.netMatches)), `${group.groupName} 按胜场、净胜项排序`);
  }
  const allStandings = standings.groups.flatMap(g => g.standings);
  const maxNet = Math.max(...allStandings.map(s => s.matchesWon - s.matchesLost));
  ok(maxNet === Math.max(...allStandings.map(s => s.netMatches)), '净胜项与子项净胜一致（幂等未重复累计）', maxNet);

  console.log('\n[4] 小组出线生成淘汰赛');
  const knockoutView = await svc.generateKnockoutFromGroups(competitionId, {});
  ok(knockoutView && Array.isArray(knockoutView.teamMatches), '生成淘汰赛后返回视图');
  const ko = await db.teamMatch.findMany({ where: { teamCompetitionId: competitionId, stage: 'KNOCKOUT' }, orderBy: [{ roundNo: 'asc' }, { matchNo: 'asc' }] });
  ok(ko.length === 3, '4 队出线生成 3 场淘汰赛（2 半决赛 + 1 决赛）', ko.length);
  const firstRound = ko.filter(m => m.team1Id && m.team2Id);
  ok(firstRound.length === 2, '半决赛两场均有对阵');
  const groupOf = new Map(allStandings.map(s => [s.teamId, standings.groups.find(g => g.standings.some(x => x.teamId === s.teamId)).groupNo]));
  ok(firstRound.every(m => groupOf.get(m.team1Id) !== groupOf.get(m.team2Id)), '半决赛双方来自不同小组（A1/B2 交叉）', firstRound.map(m => [groupOf.get(m.team1Id), groupOf.get(m.team2Id)]));
  const groupMaxRound = Math.max(...played.map(m => m.roundNo));
  ok(ko.every(m => m.roundNo > groupMaxRound), '淘汰赛轮次编号接在小组赛之后', { groupMaxRound, knockoutRounds: [...new Set(ko.map(m => m.roundNo))] });
  const advanced = await db.teamGroupMember.findMany({ where: { group: { teamCompetitionId: competitionId }, advanced: true } });
  ok(advanced.length === 4, '每组前 2 名共 4 队标记为晋级', advanced.length);

  console.log('\n[5] 淘汰赛胜者自动晋级');
  const semi = firstRound[0];
  const semiSubs = await db.match.findMany({ where: { teamMatchId: semi.id }, orderBy: { matchNo: 'asc' } });
  await completeSubMatch(semiSubs[0].id, 1);
  await completeSubMatch(semiSubs[1].id, 1);
  const finalEncounter = ko.find(m => m.id !== semi.id && m.id !== firstRound[1].id) ?? ko.find(m => m.roundNo === Math.max(...ko.map(x => x.roundNo)));
  const finalAfter = await db.teamMatch.findUnique({ where: { id: finalEncounter.id } });
  ok([finalAfter.team1Id, finalAfter.team2Id].includes(semi.team1Id), '半决赛胜者已进入决赛签位', { final: [finalAfter.team1Id, finalAfter.team2Id], winner: semi.team1Id });

  console.log('\n[6] 出场名单展示');
  const lineupEncounter = firstRound[1]; // 另一场半决赛尚未开赛，用于验证名单填报与展示
  const lineupSubs = await db.match.findMany({ where: { teamMatchId: lineupEncounter.id }, orderBy: { matchNo: 'asc' } });
  const team1 = await db.team.findUnique({ where: { id: lineupEncounter.team1Id }, include: { members: { include: { player: true } } } });
  const team2 = await db.team.findUnique({ where: { id: lineupEncounter.team2Id }, include: { members: { include: { player: true } } } });
  const pick = (team, gender) => team.members.map(m => m.player).find(p => p.gender === gender);
  const items = await db.teamCompetitionItem.findMany({ where: { teamCompetitionId: competitionId }, orderBy: { sortOrder: 'asc' } });
  const selections = [team1, team2].map(team => ({
    teamId: team.id, teamCompetitionItemId: items[0].id, player1Id: pick(team, 'MALE').id,
  }));
  await svc.setTeamLineups(lineupEncounter.id, { selections, lock: true, overrideConfirmed: true });
  const lineupView = await svc.findOne(competitionId);
  const shown = lineupView.teamMatches.find(m => m.id === lineupEncounter.id);
  ok(shown.lineups.length === 2, '双方出场名单均已记录并可同时查看', shown.lineups.map(l => l.name));
  ok(shown.lineups.every(l => l.name && l.name !== '待填报'), '名单显示具体选手姓名');

  console.log('\n[7] 秩序册导出（团体对阵 + 出场顺序）');
  fs.mkdirSync(outDir, { recursive: true });
  const exported = await exportsSvc.exportTournament(tournamentId, 'orderbook');
  const filePath = path.join(outDir, `团体赛秩序册-${tag}.xlsx`);
  fs.writeFileSync(filePath, exported.content);
  ok(exported.content.length > 5000, '已导出真实 .xlsx 文件', { bytes: exported.content.length });
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet('团体对阵');
  ok(Boolean(sheet), '包含「团体对阵」页', wb.worksheets.map(w => w.name));
  const rows = [];
  sheet.eachRow((row, n) => rows.push({ n, values: row.values.slice(1) }));
  ok(rows.length > 1, '团体对阵页有数据行', rows.length - 1);
  const lineupSheet = wb.getWorksheet('团体出场顺序');
  ok(Boolean(lineupSheet), '包含「团体出场顺序」页');
  const lineupText = [];
  lineupSheet.eachRow(row => lineupText.push(row.values.slice(1).join('|')));
  const lockedRows = lineupText.filter(text => text.includes('队') && !text.includes('待提交出场名单'));
  ok(lockedRows.some(text => text.includes('队1男1') || text.includes('男1')), '已锁定名单显示具体选手', lockedRows.slice(0, 2));
  ok(lineupText.some(text => text.includes('待提交出场名单')), '未提交名单的场次仅显示占位，不泄露选手');
  console.log(`  文件：${filePath}`);
}

main()
  .then(async () => { await cleanup(); console.log(`\n全部通过：${checks} 项检查`); })
  .catch(async error => { await cleanup(); console.error('\n失败：', error.message); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
