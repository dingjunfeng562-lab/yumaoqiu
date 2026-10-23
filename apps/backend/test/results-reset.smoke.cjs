// Real HTTP/DB/browser checks. Every write is scoped to newly-created fixtures.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const bcrypt = require('bcryptjs');
const { AppModule } = require('../dist/app.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { TeamCompetitionsService } = require('../dist/team-competitions/team-competitions.service');
assert(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const reportDir = path.resolve(__dirname, '../../../outputs/results-reset-20261023');
fs.mkdirSync(reportDir, { recursive: true });
const prefix = `reset-qa-${randomUUID().slice(0, 8)}`;
const adminId = randomUUID(), rootId = randomUUID(), tournamentId = randomUUID();
const password = `QA-${randomUUID()}`;
const report = { fixture: prefix, checks: [], apiRequests: 0, browser: [], cleaned: false };
const base = 'http://127.0.0.1:4017/api';
let app, db, adminToken, rootToken, venue;
const check = (label) => { report.checks.push(label); console.log(`PASS ${label}`); };
async function api(url, method = 'GET', body, token = adminToken, expected = method === 'POST' ? 201 : 200) {
  const response = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); report.apiRequests++;
  assert.equal(response.status, expected, `${method} ${url}: ${JSON.stringify(data)}`);
  return data;
}
const detail = id => api(`/team-competitions/${id}`);
const rows = where => db.match.findMany({ where, orderBy: { id: 'asc' } });
const schedule = data => data.map(m => [m.id, m.teamMatchId, m.eventId, m.round, m.roundNo, m.matchNo, m.venueId, m.scheduledAt?.toISOString(), m.durationMinutes, m.refereeId]);
async function scheduleAll(where) {
  for (const [i, match] of (await rows(where)).entries()) await db.match.update({ where: { id: match.id }, data: { venueId: venue.id, scheduledAt: new Date(Date.UTC(2026, 10, 1, 0, i * 45)), durationMinutes: 45 } });
}
async function score(id, winner = 1) {
  return api(`/matches/${id}/score`, 'PATCH', { games: [{ side1Score: winner === 1 ? 15 : 4, side2Score: winner === 2 ? 15 : 4 }] });
}
async function seedResult(match, winner = 1) {
  await db.game.upsert({ where: { matchId_gameNo: { matchId: match.id, gameNo: 1 } },
    create: { matchId: match.id, gameNo: 1, side1Score: winner === 1 ? 15 : 4, side2Score: winner === 2 ? 15 : 4, winnerSide: winner },
    update: { side1Score: winner === 1 ? 15 : 4, side2Score: winner === 2 ? 15 : 4, winnerSide: winner } });
  await db.match.update({ where: { id: match.id }, data: { status: 'COMPLETED', winnerSide: winner, startedAt: new Date(), finishedAt: new Date() } });
}
async function ensureEmpty(where) {
  assert.equal(await db.game.count({ where: { match: where } }), 0);
  assert.equal(await db.matchEvent.count({ where: { match: where } }), 0);
  for (const m of await rows(where)) {
    assert.equal(m.startedAt, null); assert.equal(m.finishedAt, null); assert.equal(m.forfeitedSide, null); assert.equal(m.forfeitReason, null);
  }
}
async function makeTeam(format, count = 4) {
  const c = await api('/team-competitions', 'POST', { tournamentId, name: `${prefix}-${format}`, format, groupCount: format === 'ROUND_ROBIN' ? 1 : 2,
    advancePerGroup: format === 'GROUP_PLUS_KNOCKOUT' ? 2 : undefined, winThreshold: 1, maxPlayerAppearances: 0, playAllMatches: true,
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN', items: [{ eventType: 'MENS_SINGLES', sortOrder: 1 }] });
  for (let i = 0; i < count; i++) await api(`/team-competitions/${c.id}/teams/import`, 'POST', {
    teamName: `${prefix}队${i + 1}`, affiliation: '清分验证', players: [{ name: `${prefix}队员${i + 1}`, gender: 'MALE', affiliation: '清分验证' }],
  });
  await api(`/team-competitions/${c.id}/draw`, 'POST', {});
  return detail(c.id);
}
async function teamLineup(c, encounter) {
  if (!encounter.matches.length) return;
  if (encounter.matches.every(match => match.lineupLocked)) return;
  await api(`/team-competitions/team-matches/${encounter.id}/lineups`, 'PUT', { lock: true, selections: [encounter.team1, encounter.team2].map(team => ({
    teamId: team.id, teamCompetitionItemId: c.items[0].id, player1Id: c.teams.find(row => row.id === team.id).members[0].id,
  })) });
}
async function finishTeamGroups(c, winner = 1) {
  for (const m of c.teamMatches.filter(row => row.stage === 'GROUP')) { await teamLineup(c, m); await score(m.matches[0].id, winner); }
  return detail(c.id);
}
async function makeEvent(format, n = 6, options = {}) {
  const event = await db.event.create({ data: { tournamentId, type: 'MENS_SINGLES', format, scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN', ...options } });
  for (let i = 0; i < n; i++) {
    const player = await db.player.create({ data: { name: `${prefix}-${format}-${i}`, gender: 'MALE', affiliation: '清分验证', ownerId: adminId } });
    await db.registration.create({ data: { eventId: event.id, player1Id: player.id, status: 'APPROVED' } });
  }
  await api(`/events/${event.id}/draw`, 'POST', {});
  return event;
}
async function finishEventGroups(event) {
  const groups = await db.match.findMany({ where: { eventId: event.id, roundNo: 0 }, orderBy: { id: 'asc' } });
  for (const match of groups.slice(0, -1)) await seedResult(match);
  await score(groups.at(-1).id);
}
async function security() {
  const a = await makeTeam('ROUND_ROBIN', 2), b = await makeTeam('ROUND_ROBIN', 2);
  await seedResult(a.teamMatches[0].matches[0]);
  await api(`/team-competitions/${a.id}/draw/clear`, 'POST', {}, adminToken, 409);
  const requests = await Promise.all([1, 2].map(() => fetch(`${base}/team-competitions/${a.id}/draw/clear-request`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '隔离验证' }),
  })));
  assert.deepEqual(requests.map(r => r.status).sort(), [201, 409]);
  const request = (await api(`/team-competitions/${a.id}/draw/clear-requests`))[0];
  for (const action of ['approve', 'reject']) {
    await api(`/team-competitions/${a.id}/draw/clear-requests/${request.id}/${action}`, 'POST', {}, adminToken, 403);
    await api(`/team-competitions/${b.id}/draw/clear-requests/${request.id}/${action}`, 'POST', {}, rootToken, 404);
  }
  await api(`/team-competitions/${b.id}/draw/clear-requests/${request.id}/cancel`, 'POST', {}, adminToken, 404);
  assert.equal((await detail(a.id)).teamMatches.length, 1);
  await api(`/team-competitions/${a.id}/draw/clear-requests/${request.id}/approve`, 'POST', { reason: '已核对并批准' }, rootToken);
  assert.equal((await db.teamDrawClearRequest.findUnique({ where: { id: request.id } })).decisionRemark, '已核对并批准');
  assert.equal((await detail(a.id)).teamMatches.length, 0);
  await api(`/team-competitions/${a.id}/draw/clear-requests/${request.id}/reject`, 'POST', {}, rootToken, 409);
  await api(`/team-competitions/${b.id}/results/clear`, 'POST', { confirm: true }, adminToken, 403);
  await api(`/team-competitions/${b.id}/results/clear`, 'POST', {}, rootToken, 400);
  check('审批角色限制、赛事/申请绑定、并发重复申请、重复处理、清分权限与确认校验');
}
async function teamCases() {
  for (const format of ['ROUND_ROBIN', 'GROUP_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_PLUS_KNOCKOUT']) {
    let c = await makeTeam(format, format === 'SINGLE_ELIMINATION' ? 6 : 4);
    if (format === 'GROUP_PLUS_KNOCKOUT') {
      c = await finishTeamGroups(c);
      await api(`/team-competitions/${c.id}/knockout`, 'POST', {}); c = await detail(c.id);
    }
    const playable = c.teamMatches.find(m => m.team1 && m.team2 && m.matches.length && (format !== 'GROUP_PLUS_KNOCKOUT' || m.stage === 'KNOCKOUT'));
    await teamLineup(c, playable); await score(playable.matches[0].id);
    const where = { teamMatch: { teamCompetitionId: c.id } };
    await scheduleAll(where);
    await db.teamCompetition.update({ where: { id: c.id }, data: { isPublished: true } });
    const before = await rows(where), groups = await db.teamGroup.findMany({ where: { teamCompetitionId: c.id }, orderBy: { id: 'asc' } });
    const stale = await db.match.findUnique({ where: { id: playable.matches[0].id } });
    let socket, liveUpdate;
    if (format === 'ROUND_ROBIN') {
      const { io } = require(path.resolve(__dirname, '../../frontend/node_modules/socket.io-client'));
      socket = io('http://127.0.0.1:4017/scores', { transports: ['websocket'] });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      await new Promise(resolve => socket.emit('joinMatch', { matchId: stale.id }, resolve));
      liveUpdate = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('reset websocket notification missing')), 8000);
        socket.once('match:update', state => { clearTimeout(timer); resolve(state); });
      });
    }
    await api(`/team-competitions/${c.id}/results/clear`, 'POST', { confirm: true }, rootToken);
    if (socket) { const state = await liveUpdate; assert.equal(state.status, 'PENDING'); assert.equal(state.games.length, 0); socket.disconnect(); check('清分通过 WebSocket 通知执裁页面，旧比分立即消失'); }
    assert.deepEqual(schedule(await rows(where)), schedule(before)); await ensureEmpty(where);
    assert.equal((await db.teamCompetition.findUnique({ where: { id: c.id } })).isPublished, true);
    assert.deepEqual((await db.teamGroup.findMany({ where: { teamCompetitionId: c.id }, orderBy: { id: 'asc' } })).map(g => g.id), groups.map(g => g.id));
    const standings = await db.teamGroupMember.findMany({ where: { group: { teamCompetitionId: c.id } } });
    for (const s of standings) assert.deepEqual([s.wins, s.losses, s.matchesWon, s.matchesLost, s.netMatches, s.groupRank, s.advanced], [0, 0, 0, 0, 0, null, false]);
    await assert.rejects(() => db.$transaction(tx => app.get(TeamCompetitionsService).prepareScoring(tx, stale.id, { expectedUpdatedAt: stale.updatedAt })), /状态已变化/);
    if (format === 'GROUP_PLUS_KNOCKOUT') {
      c = await detail(c.id); assert(c.teamMatches.filter(m => m.stage === 'KNOCKOUT').every(m => !m.team1 && !m.team2));
      c = await finishTeamGroups(c, 2); await api(`/team-competitions/${c.id}/knockout`, 'POST', {});
      assert.deepEqual(schedule(await rows(where)), schedule(before));
      c = await detail(c.id); const replay = c.teamMatches.find(m => m.stage === 'KNOCKOUT' && m.team1 && m.team2 && m.matches.length);
      await teamLineup(c, replay); await score(replay.matches[0].id);
    } else {
      if (format !== 'SINGLE_ELIMINATION') assert((await rows(where)).every(m => m.status === 'PENDING'));
      await score(playable.matches[0].id);
    }
    check(`团体 ${format}：清除结果与积分、保留场次/排程、拒绝过期记分、重赛及晋级恢复`);
  }
}
async function eventCases() {
  for (const format of ['ROUND_ROBIN', 'SINGLE_ELIMINATION', 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING', 'GROUP_PLUS_PLAYOFF', 'GROUP_PLUS_KNOCKOUT_STD']) {
    const event = await makeEvent(format, format === 'GROUP_PLUS_KNOCKOUT_STD' ? 20 : format === 'GROUP_PLUS_PLAYOFF' ? 8 : 6,
      format === 'GROUP_PLUS_KNOCKOUT_STD' ? { groupCount: 5, groupSize: 4, qualifiersPerGroup: 2 } : format === 'GROUP_PLUS_PLAYOFF' ? { groupCount: 2, groupSize: 4 } : {});
    if (format.startsWith('GROUP')) await finishEventGroups(event);
    const where = { eventId: event.id };
    const played = (await rows(where)).find(m => m.side1Id && m.side2Id && (format.startsWith('GROUP') ? m.roundNo > 0 : true));
    await score(played.id); await scheduleAll(where);
    const before = await rows(where);
    await db.event.update({ where: { id: event.id }, data: { drawPublished: true, drawLocked: true } });
    const draw = await db.drawBracket.findFirst({ where: { eventItemId: event.id, isCurrent: true }, include: { slots: true, groups: { include: { members: true } } } });
    await api(`/events/${event.id}/results/clear`, 'POST', { confirm: true }, adminToken, 403);
    await api(`/events/${event.id}/results/clear`, 'POST', { confirm: true }, rootToken);
    await ensureEmpty(where); assert.deepEqual(schedule(await rows(where)), schedule(before));
    assert.equal((await db.event.findUnique({ where: { id: event.id } })).drawPublished, true);
    assert.equal((await db.drawBracket.findFirst({ where: { eventItemId: event.id, isCurrent: true } })).id, draw.id);
    if (format.startsWith('GROUP')) {
      assert((await rows({ eventId: event.id, roundNo: { gt: 0 } })).every(m => !m.side1Id && !m.side2Id && m.status === 'PENDING'));
      await finishEventGroups(event); assert.deepEqual(schedule(await rows(where)), schedule(before));
      assert((await rows({ eventId: event.id, roundNo: 1 })).some(m => m.side1Id && m.side2Id));
    } else await score(played.id);
    check(`单项 ${format}：保留签表/分组/发布与排程，撤销旧结果并可重新晋级`);
  }
  const event = await makeEvent('GROUP_PLUS_KNOCKOUT_STD', 8, { groupCount: 2, groupSize: 4, qualifiersPerGroup: 2 });
  await finishEventGroups(event);
  await api(`/events/${event.id}/second-stage/confirm`, 'POST', { slots: [], rankingMode: 'TOP_8' });
  await scheduleAll({ eventId: event.id });
  const before = await rows({ eventId: event.id });
  const stage = await db.secondStage.findUnique({ where: { eventId: event.id } });
  await api(`/events/${event.id}/results/clear`, 'POST', { confirm: true }, rootToken);
  const resetStage = await db.secondStage.findUnique({ where: { eventId: event.id } });
  assert.equal(resetStage.id, stage.id); assert.equal(resetStage.status, 'NOT_STARTED');
  assert.equal(await db.secondStageRanking.count({ where: { secondStageId: stage.id } }), 0);
  assert((await db.secondStageSlot.findMany({ where: { secondStageId: stage.id } })).every(s => !s.entrantId));
  await finishEventGroups(event);
  await api(`/events/${event.id}/second-stage/confirm`, 'POST', { slots: [], rankingMode: 'TOP_8' });
  assert.deepEqual(schedule(await rows({ eventId: event.id })), schedule(before));
  check('单项 A-H 第二阶段：撤销签位与名次，重新确认后保留原正式比赛 ID 和排程');
}
async function browserCases() {
  const { chromium } = require(path.resolve(__dirname, '../../../.codex-work/photo-access-qa/node_modules/playwright'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const c = await makeTeam('ROUND_ROBIN', 2);
  await api(`/team-competitions/${c.id}`, 'PATCH', { name: `${prefix}-浏览器团体` });
  await teamLineup(c, c.teamMatches[0]); await score(c.teamMatches[0].matches[0].id);
  const event = await makeEvent('SINGLE_ELIMINATION', 4);
  const errors = [];
  async function login(role) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(60000);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const csrf = await context.request.get('http://127.0.0.1:3017/api/auth/csrf', { timeout: 120000 });
    const { csrfToken } = await csrf.json();
    await context.request.post('http://127.0.0.1:3017/api/auth/callback/credentials', { form: {
      csrfToken, identifier: `${role === 'root' ? rootId : adminId}@qa.invalid`, password, loginType: 'email', callbackUrl: '/nicaiyixiahh/draws',
    }, timeout: 120000 });
    const session = await (await context.request.get('http://127.0.0.1:3017/api/auth/session')).json();
    assert.equal(session.user?.role, role.toUpperCase(), 'test account login must succeed before browser checks');
    return { context, page };
  }
  try {
    const { context, page } = await login('admin');
    await page.goto(`http://127.0.0.1:3017/nicaiyixiahh/team-competitions/${c.id}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('button', { name: /申请取消对阵/ }).waitFor();
    assert(await page.getByRole('button', { name: /清除比分，保留对阵/ }).isDisabled());
    await page.getByRole('button', { name: /申请取消对阵/ }).click();
    await page.getByRole('textbox', { name: '取消原因' }).fill('浏览器取消申请验证');
    await page.getByRole('button', { name: '提交申请', exact: true }).click();
    await page.getByText('取消对阵申请待超级管理员审批', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(reportDir, 'admin-request.png'), fullPage: true });
    await context.close(); report.browser.push('普通管理员：清分按钮禁用，详情页可申请取消');

    const root = await login('root');
    await root.page.goto('http://127.0.0.1:3017/nicaiyixiahh/draws', { waitUntil: 'networkidle', timeout: 120000 });
    await root.page.getByRole('combobox').nth(0).click();
    await root.page.getByText(`${prefix} 隔离验证`, { exact: true }).click();
    await root.page.getByRole('combobox').nth(1).click();
    await root.page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '单淘汰' }).last().click();
    const teamSelect = root.page.getByRole('combobox').nth(2);
    await teamSelect.click();
    // Names can repeat across scenarios; choose the unique newly created fixture by its 2-team count and last position.
    await root.page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: `${prefix}-浏览器团体` }).click();
    await root.page.getByRole('button', { name: '通过并清空', exact: true }).waitFor();
    const button = root.page.getByRole('button', { name: /清除比分，保留对阵/ }).last();
    await button.hover(); await root.page.getByRole('tooltip').filter({ hasText: '丢弃当前项目' }).waitFor();
    await root.page.screenshot({ path: path.join(reportDir, 'draws-tooltip.png'), fullPage: true });
    await button.click();
    await root.page.getByRole('button', { name: '丢弃全部成绩', exact: true }).click();
    await root.page.getByText('全部成绩已作废，已撤回晋级；分组、对阵和排程已保留', { exact: true }).waitFor();
    assert.equal(await db.game.count({ where: { match: { teamMatch: { teamCompetitionId: c.id } } } }), 0);
    assert.equal((await db.teamDrawClearRequest.findFirst({ where: { teamCompetitionId: c.id } })).status, 'CANCELLED');
    await root.page.getByRole('button', { name: /清除比分，保留对阵/ }).first().click();
    const singleResult = root.page.waitForResponse(response => /\/events\/[^/]+\/results\/clear$/.test(response.url()) && response.request().method() === 'POST');
    await root.page.getByRole('button', { name: '丢弃全部成绩', exact: true }).click();
    assert.equal((await singleResult).status(), 201);
    await root.page.screenshot({ path: path.join(reportDir, 'draws-reset-done.png'), fullPage: true });
    await root.page.getByRole('button', { name: /清除比分，保留对阵/ }).first().waitFor({ state: 'visible' });
    await root.page.setViewportSize({ width: 390, height: 844 });
    await root.page.waitForFunction(() => !document.querySelector('.ant-message-notice'));
    const mobileTitle = root.page.getByText('小组分组与积分榜', { exact: true });
    await mobileTitle.scrollIntoViewIfNeeded();
    const titleBox = await mobileTitle.boundingBox();
    assert(titleBox && titleBox.width > 100 && titleBox.x >= 0 && titleBox.x + titleBox.width <= 390);
    await root.page.screenshot({ path: path.join(reportDir, 'draws-mobile.png') });
    await root.context.close(); report.browser.push('超级管理员：抽签编排页审批入口、Tooltip、团体与单项清分实际点击');
    assert.deepEqual(errors, []); check('浏览器真实页面验证通过');
  } catch (error) {
    for (const [index, context] of browser.contexts().entries()) {
      const page = context.pages()[0];
      if (page) await page.screenshot({ path: path.join(reportDir, `browser-failure-${index}.png`), fullPage: true, timeout: 15000 }).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); }
}
async function main() {
  app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: true, credentials: true });
  await app.listen(4017, '127.0.0.1'); db = app.get(PrismaService);
  // Disable background reconciliation in this test app; only explicit fixture operations should run.
  app.get(require('../dist/broadcasts/multicamera.service').MulticameraService).onModuleDestroy();
  const hash = await bcrypt.hash(password, 4);
  for (const [id, role] of [[adminId, 'ADMIN'], [rootId, 'ROOT']]) await db.user.create({ data: { id, username: `${prefix}-${role.toLowerCase()}`, email: `${id}@qa.invalid`, passwordHash: hash, role, permissions: ['TEAMS', 'DRAWS', 'SCORING', 'EVENTS', 'TOURNAMENTS', 'SCHEDULING'], mustChangePassword: false } });
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  adminToken = jwt.sign({ sub: adminId }, { expiresIn: '1h' }); rootToken = jwt.sign({ sub: rootId }, { expiresIn: '1h' });
  await db.tournament.create({ data: { id: tournamentId, name: `${prefix} 隔离验证`, startDate: new Date('2026-11-01'), endDate: new Date('2026-11-02'), submittedById: adminId, isPublished: true, approvalStatus: 'APPROVED' } });
  venue = await db.venue.create({ data: { tournamentId, name: '保留排程验证场地' } });
  if (process.env.RUN_LEGACY_SMOKE === '1') {
    const { promisify } = require('node:util');
    const { execFile } = require('node:child_process');
    const legacy = await promisify(execFile)(process.execPath, [path.join(__dirname, 'team-competitions.smoke.cjs')], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, TEAM_QA_API: base }, timeout: 120000 });
    report.teamRegression = JSON.parse(legacy.stdout.trim().split('\n').at(-1));
    check(`原团体赛流程回归：${report.teamRegression.httpChecks} 次 HTTP 校验通过`);
  }
  await security(); await teamCases(); await eventCases();
  if (process.env.RUN_BROWSER === '1') await browserCases();
  report.ok = true;
}
main().catch(error => { report.ok = false; report.error = error.stack; console.error(error); process.exitCode = 1; })
  .finally(async () => {
    if (db) {
      await db.teamMatch.deleteMany({ where: { teamCompetition: { tournamentId } } });
      await db.teamGroup.deleteMany({ where: { teamCompetition: { tournamentId } } });
      await db.tournament.deleteMany({ where: { id: tournamentId } });
      await db.player.deleteMany({ where: { ownerId: adminId } });
      await db.user.deleteMany({ where: { id: { in: [adminId, rootId] } } });
      report.cleaned = await db.tournament.count({ where: { id: tournamentId } }) === 0 && await db.user.count({ where: { id: { in: [adminId, rootId] } } }) === 0;
    }
    if (app) await app.close();
    fs.writeFileSync(path.join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: report.ok, apiRequests: report.apiRequests, cases: report.checks.length, browser: report.browser, cleaned: report.cleaned }));
  });
