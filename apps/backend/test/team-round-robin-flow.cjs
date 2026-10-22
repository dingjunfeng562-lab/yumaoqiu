// Local-only end-to-end regression. All created records are removed in finally.
require('dotenv/config');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtService } = require('@nestjs/jwt');
const ExcelJS = require('exceljs');
const db = new PrismaService();
const base = process.env.TEAM_QA_API || 'http://localhost:4011/api';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const lineupOnly = process.env.TEAM_QA_LINEUP_ONLY === '1';
const out = path.resolve(__dirname, '../../../outputs/team-round-robin-verification', lineupOnly ? 'lineup-preservation' : '.');
fs.mkdirSync(out, { recursive: true });
const actorId = randomUUID(), refereeId = randomUUID(), tournamentId = randomUUID();
let competitionId, token, refereeToken, user, referee, browserQA;
let checks = 0;
const stages = [];
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`); };
const stage = name => { stages.push(name); console.log(`STAGE ${name}`); };
async function api(url, method = 'GET', body, expected = 200, auth = token) {
  const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`); checks++;
  return data;
}
const detail = () => api(`/team-competitions/${competitionId}`);
const scheduleSnapshot = () => db.match.findMany({ where: { teamMatch: { teamCompetitionId: competitionId } },
  select: { id: true, teamMatchId: true, venueId: true, scheduledAt: true, durationMinutes: true }, orderBy: { id: 'asc' } });
async function lineups(encounter, selections, lock, extra = {}) {
  const before = await scheduleSnapshot();
  const result = await api(`/team-competitions/team-matches/${encounter.id}/lineups`, 'PUT', { selections, lock, ...extra });
  assert.deepEqual(await scheduleSnapshot(), before, '填写或锁定名单不能改变任意已编排场次的场地、时间、时长和对阵归属'); checks++;
  return result;
}
const schedule = adjustTeamVenueCount => api('/scheduling/auto', 'POST', {
  tournamentId, startAt: '2026-10-22T00:00:00Z', startAtLocal: '2026-10-22 08:00', dailyStartTime: '08:00', dailyEndTime: '22:00', matchMinutes: 10, breakMinutes: 0, adjustTeamVenueCount,
}, 201);
async function orderbook(filename) {
  const response = await fetch(`${base}/exports/tournaments/${tournamentId}/orderbook`, { headers: { Authorization: `Bearer ${token}` } });
  check(response.status === 200, '秩序册下载成功');
  const content = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(out, filename), content);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content);
  return workbook;
}
async function main() {
  stage('设置赛制、项目及六队名单');
  user = await db.user.create({ data: { id: actorId, username: `rr-${actorId}`, email: `${actorId}@rr.invalid`, passwordHash: 'unused', role: 'ADMIN', permissions: ['TEAMS', 'SCORING', 'SCHEDULING', 'TOURNAMENTS', 'EVENTS', 'PLAYERS', 'DRAWS', 'DATA_EXPORT', 'ORDERBOOK'] } });
  referee = await db.user.create({ data: { id: refereeId, username: `rr-ref-${refereeId}`, email: `${refereeId}@rr.invalid`, passwordHash: 'unused', role: 'REFEREE', managerId: actorId, permissions: ['REFEREE'] } });
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  token = jwt.sign({ sub: actorId }, { expiresIn: '2h' });
  refereeToken = jwt.sign({ sub: refereeId }, { expiresIn: '2h' });
  await db.tournament.create({ data: { id: tournamentId, name: `六队单组循环验证-${actorId.slice(0, 6)}`, submittedById: actorId, startDate: new Date('2026-10-22T00:00:00Z'), endDate: new Date('2026-10-24T12:00:00Z'), dailyStartTime: '08:00', dailyEndTime: '22:00', isPublished: true, approvalStatus: 'APPROVED' } });
  const created = await api('/team-competitions', 'POST', {
    tournamentId, name: '六队单组循环全流程', format: 'ROUND_ROBIN', groupCount: 3,
    winThreshold: 2, maxPlayerAppearances: 2, playAllMatches: true,
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN', customGamePoint: 3, customGameCap: 3, customGamesToWin: 1,
    items: ['MENS_SINGLES', 'WOMENS_SINGLES', 'MIXED_DOUBLES'].map((eventType, i) => ({ eventType, sortOrder: i + 1 })),
  }, 201);
  competitionId = created.id;
  check(created.groupCount === 1, '单组赛制强制一组');
  for (let i = 1; i <= 6; i++) await api(`/team-competitions/${competitionId}/teams/import`, 'POST', { teamName: `团体${i}`, affiliation: '测试单位', players: [
    { name: `男队员${i}`, gender: 'MALE', affiliation: '测试单位' }, { name: `女队员${i}`, gender: 'FEMALE', affiliation: '测试单位' },
  ] }, 201);
  let comp = await detail();
  const teams = comp.teams;
  const ids = Object.fromEntries(teams.map(t => [Number(t.name.replace('团体', '')), t.id]));
  stage('生成一组五轮十五场对阵');
  comp = await api(`/team-competitions/${competitionId}/draw`, 'POST', {}, 201);
  const groups = await api(`/team-competitions/${competitionId}/groups`);
  check(groups.groups.length === 1 && groups.groups[0].standings.length === 6, '全部六队同组');
  check(comp.teamMatches.length === 15, '15场团体对阵');
  check(new Set(comp.teamMatches.map(m => [m.team1.id, m.team2.id].sort().join(':'))).size === 15, '每两队恰好交手一次');
  for (let round = 1; round <= 5; round++) {
    const matches = comp.teamMatches.filter(m => m.roundNo === round);
    check(matches.length === 3 && new Set(matches.flatMap(m => [m.team1.id, m.team2.id])).size === 6, `第${round}轮三场且队伍无重复`);
  }
  await api(`/team-competitions/${competitionId}/groups/adjust`, 'PATCH', { groups: [{ groupNo: 1, teamIds: teams.slice(0, 3).map(t => t.id) }, { groupNo: 2, teamIds: teams.slice(3).map(t => t.id) }] }, 400);
  for (let i = 1; i <= 5; i++) await api(`/tournaments/${tournamentId}/venues`, 'POST', { name: `${i}号场地`, sortOrder: i }, 201);
  stage('场地超额分支及无名单排程');
  let scheduled = await schedule(false);
  check(scheduled.venues.filter(v => v.isActive).length === 5, '不调整时保留五片场地');
  check(new Set(scheduled.matches.map(m => m.venueId)).size === 3 && scheduled.matches.every(m => m.venueId), '45个子项只排在三片场地，多余场地留空');
  check(scheduled.conflicts.length === 0, '未填名单时无团体或场地冲突');
  for (const encounter of comp.teamMatches) check(new Set(scheduled.matches.filter(m => m.teamMatchId === encounter.id).map(m => m.venueId)).size === 1, '同场团体子项共用一片场地');
  for (let round = 2; round <= 5; round++) {
    const priorEnd = Math.max(...scheduled.matches.filter(m => m.roundNo === round - 1).map(m => Date.parse(m.scheduledAt) + m.durationMinutes * 60000));
    const start = Math.min(...scheduled.matches.filter(m => m.roundNo === round).map(m => Date.parse(m.scheduledAt)));
    check(start >= priorEnd, `第${round}轮等待前一轮结束`);
  }
  const beforeBook = await orderbook('赛前秩序册.xlsx');
  const beforeRanks = beforeBook.getWorksheet('名次汇总');
  const flowTexts = [];
  beforeBook.getWorksheet('流程表').eachRow(row => row.eachCell(cell => { if (cell.value != null) flowTexts.push(cell.text); }));
  check(flowTexts.includes(`${comp.name}第二阶段：`) && flowTexts.includes('单组循环全部结束后确定各队名次，见“名次汇总”。'), '秩序册保留第二阶段占位，实际单循环完赛即确定名次');
  check(beforeRanks.getRows(3, 6).every(row => row.getCell(2).text === '待定' && row.getCell(5).text === '待定'), '赛前秩序册不把临时顺序标为最终名次');
  const orderTexts = [];
  beforeBook.getWorksheet('秩序表').eachRow(row => row.eachCell(cell => { if (cell.value != null) orderTexts.push(cell.text); }));
  check(orderTexts.includes('4号场地') && orderTexts.includes('5号场地'), '保留的多余场地在秩序册预留空栏');
  const reserve = scheduled.venues.find(venue => venue.name === '4号场地');
  const manualEncounter = comp.teamMatches[0];
  const moved = await api(`/matches/${manualEncounter.matches[0].id}/schedule`, 'PATCH', { venueId: reserve.id });
  check(moved.matches.filter(match => match.teamMatchId === manualEncounter.id).every(match => match.venueId === reserve.id), '手工使用预留第四片场地，整场团体子项一起移动');
  check(moved.matches.every(match => match.scheduledAt === scheduled.matches.find(original => original.id === match.id).scheduledAt), '只换场地时保留原时间和自动排程所选间隔');
  check(moved.conflicts.length === 0, '手工换到空闲场地后没有排程冲突');
  // A separate configured competition prevents changing shared tournament courts.
  const other = await db.teamCompetition.create({ data: { tournamentId, name: '共享场地项目' } });
  const shared = await schedule(true);
  check(shared.venues.filter(v => v.isActive).length === 5 && !shared.teamCourtLimits[0].canAdjust, '共享场地不能自动停用，超额场地留空');
  await db.teamCompetition.delete({ where: { id: other.id } });
  if (process.env.TEAM_QA_BROWSER === '1') {
    browserQA = await require('./team-round-robin.browser.cjs').open({ api, base, token, refereeToken, user, referee, comp, tournamentId, out });
    await browserQA.schedule();
  } else {
    scheduled = await schedule(true);
    check(scheduled.venues.filter(v => v.isActive).length === 3, '确认调整后启用场地减为三片');
  }
  scheduled = await api(`/scheduling?tournamentId=${tournamentId}`);
  check(scheduled.venues.filter(v => v.isActive).length === 3, '场地调整持久化');
  const access = await api(`/tournaments/${tournamentId}/referee-access-code`, 'POST', {}, 201);
  await api('/referee/authorize', 'POST', { accessCode: access.path.split('/').pop() }, 201, refereeToken);
  const assigned = comp.teamMatches[0].matches[0];
  await api(`/matches/${assigned.id}/referee`, 'PATCH', { refereeId });
  stage('裁判名单门槛：未填、单方、草稿、锁定');
  const courtsBefore = await api(`/referee/tournaments/${tournamentId}/courts`, 'GET', undefined, 200, refereeToken);
  check(courtsBefore.courts.every(c => c.matchCount === 0) && courtsBefore.unscheduledCount === 0, '场地数量统计隐藏未填报名单比赛');
  check((await api('/referee/matches', 'GET', undefined, 200, refereeToken)).length === 0, '已分配但无名单也不在裁判列表');
  await api(`/matches/${assigned.id}/score`, 'GET', undefined, 404, refereeToken);
  const encounter = comp.teamMatches[0];
  const sub = encounter.matches[0];
  const venueId = scheduled.matches.find(m => m.id === sub.id).venueId;
  const selectionsFor = (e, item) => [e.team1, e.team2].map(side => {
    const team = teams.find(t => t.id === side.id), male = team.members.find(p => p.gender === 'MALE'), female = team.members.find(p => p.gender === 'FEMALE');
    return { teamId: team.id, teamCompetitionItemId: item.id, player1Id: item.eventType === 'WOMENS_SINGLES' ? female.id : male.id, ...(item.eventType === 'MIXED_DOUBLES' ? { player2Id: female.id } : {}) };
  });
  const courtMatches = () => api(`/referee/tournaments/${tournamentId}/courts/${venueId}/matches`, 'GET', undefined, 200, refereeToken);
  const selections = selectionsFor(encounter, comp.items[0]);
  await lineups(encounter, selections.slice(0, 1), false);
  check((await courtMatches()).matches.length === 0, '只填一方名单不可见');
  await lineups(encounter, selections, false);
  check((await courtMatches()).matches.length === 0, '双方名单草稿不可见');
  await api(`/referee/tournaments/${tournamentId}/courts/${venueId}/matches/${sub.id}/claim`, 'POST', {}, 404, refereeToken);
  if (browserQA) await browserQA.refereeHidden(venueId);
  await lineups(encounter, selections, true);
  check((await courtMatches()).matches.length === 1, '锁定后仅该子项显示');
  if (browserQA) await browserQA.refereeVisible();
  await db.match.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });
  check((await courtMatches()).matches.length === 0, '无需再打的取消子项不出现在裁判列表');
  await db.match.update({ where: { id: sub.id }, data: { status: 'PENDING' } });
  if (lineupOnly) {
    stage('逐项填齐并锁定六队所有名单，核对排程保持不变');
    const before = await scheduleSnapshot();
    for (const e of comp.teamMatches) for (let i = 0; i < comp.items.length; i++) {
      if (e.matches[i].id !== sub.id) await lineups(e, selectionsFor(e, comp.items[i]), true);
    }
    assert.deepEqual(await scheduleSnapshot(), before); checks++;
    check(await db.match.count({ where: { teamMatch: { teamCompetitionId: competitionId }, lineupLocked: true } }) === 45, '全部45个子项名单填报锁定，场地、时间、时长和对阵完全不变');
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ok: true, checks, stages, encounters: 15, subMatches: 45, scheduleUnchanged: true, phases: ['单方填报', '双方草稿', '锁定名单', '全部45个子项锁定'] }, null, 2));
    fs.rmSync(path.join(out, 'failure.json'), { force: true });
    console.log(JSON.stringify({ ok: true, checks, output: out }));
    return;
  }
  stage('裁判逐项记分，完成十五场团体对阵');
  const outcomes = [[1,2,1,1],[1,3,1,1],[1,4,1,1],[1,5,1,3],[1,6,6,1],[2,3,3,1],[2,4,2,1],[2,5,2,1],[2,6,6,1],[3,4,3,3],[3,5,5,3],[3,6,3,1],[4,5,4,1],[4,6,6,1],[5,6,5,1]];
  for (const e of comp.teamMatches) {
    const outcome = outcomes.find(o => [e.team1.id, e.team2.id].includes(ids[o[0]]) && [e.team1.id, e.team2.id].includes(ids[o[1]]));
    const winnerSide = e.team1.id === ids[outcome[2]] ? 1 : 2;
    for (let i = 0; i < 3; i++) {
      const m = e.matches[i];
      if (m.id !== sub.id) await lineups(e, selectionsFor(e, comp.items[i]), true);
      const venue = scheduled.matches.find(s => s.id === m.id).venueId;
      await api(`/referee/tournaments/${tournamentId}/courts/${venue}/matches/${m.id}/claim`, 'POST', {}, 201, refereeToken);
      const state = await api(`/matches/${m.id}/start`, 'POST', { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 }, 201, refereeToken);
      check(state.event.customGamePoint === 3, '裁判端使用已配置项目计分规则');
      const side = outcome[3] === 1 && i === 2 ? 3 - winnerSide : winnerSide;
      for (let point = 0; point < 3; point++) await api(`/matches/${m.id}/point`, 'POST', { side }, 201, refereeToken);
      await api(`/matches/${m.id}/finish`, 'POST', {}, 201, refereeToken);
    }
    console.log(`COMPLETED ${e.team1.name} VS ${e.team2.name}`);
  }
  stage('最终排名及前台一致性');
  comp = await detail();
  check(comp.teamMatches.every(m => m.status === 'COMPLETED' && m.matches.every(s => s.status === 'COMPLETED')), '15场团体、45个子项全部经裁判确认完成');
  const finalGroups = await api(`/team-competitions/${competitionId}/groups`);
  const standings = finalGroups.groups[0].standings;
  const expected = [1, 3, 6, 2, 5, 4].map(i => ids[i]);
  assert.deepEqual(standings.map(s => s.teamId), expected); checks++;
  check(standings.every(s => s.wins + s.losses === 5 && s.netMatches === s.matchesWon - s.matchesLost), '每队打五场，净胜分按净胜项');
  await api(`/team-competitions/${competitionId}`, 'PATCH', { isPublished: true });
  const publicRanking = await api(`/public/ranking?tournamentId=${tournamentId}`);
  const findRows = node => { if (!node || typeof node !== 'object') return null; if (node.id === competitionId && node.standings) return node.standings; for (const value of Object.values(node)) { const found = findRows(value); if (found) return found; } return null; };
  const publicRows = findRows(publicRanking);
  assert.ok(publicRows, '前台已公开最终排名');
  assert.deepEqual(publicRows.map(s => s.id), expected); checks++;
  stage('下载最终秩序册并逐队核对全部名次、团体胜场和净胜分');
  const finalBook = await orderbook('完赛秩序册.xlsx');
  const rankSheet = finalBook.getWorksheet('名次汇总');
  const rankRows = rankSheet.getRows(3, 6);
  assert.deepEqual(rankRows.map(row => row.getCell(3).text), [1, 3, 6, 2, 5, 4].map(i => `团体${i}`)); checks++;
  check(rankSheet.rowCount === 8 && rankRows.every((row, index) => row.getCell(2).text === `第${index + 1}名` && row.getCell(5).text === '已确定'), '最终秩序册完整显示第一至第六名，顺序与积分榜一致');
  const groupSheet = finalBook.getWorksheet('分组表');
  for (const standing of standings) {
    let exported;
    groupSheet.eachRow(row => { if (row.getCell(2).text === standing.teamName) exported = row; });
    check(exported && exported.getCell(11).value === standing.wins && exported.getCell(12).value === standing.matchesWon && exported.getCell(13).value === standing.netMatches && exported.getCell(14).value === standing.groupRank, `${standing.teamName}分组表胜场、胜次、净胜分、排名均与积分榜一致`);
  }
  if (browserQA) await browserQA.final();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ok: true, checks, stages, teams: 6, rounds: 5, encounters: 15, subMatches: 45, courts: 3, standings, browser: !!browserQA }, null, 2));
  fs.rmSync(path.join(out, 'failure.json'), { force: true });
  console.log(JSON.stringify({ ok: true, checks, output: out }));
}
main().catch(error => { fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ ok: false, checks, stages, error: error.stack }, null, 2)); throw error; }).finally(async () => {
  await browserQA?.close();
  await db.teamMatch.deleteMany({ where: { teamCompetition: { tournamentId } } });
  await db.teamCompetition.deleteMany({ where: { tournamentId } });
  await db.tournament.deleteMany({ where: { id: tournamentId } });
  await db.player.deleteMany({ where: { ownerId: actorId } });
  await db.user.deleteMany({ where: { id: { in: [actorId, refereeId] } } });
  await db.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
