// Run against local backend :4000 and frontend :3000 after build/migration.
// Creates isolated fixtures and removes them in finally; no existing results are changed.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtService } = require('@nestjs/jwt');
const ExcelJS = require('exceljs');
const { tournamentResultsReady, eventResultsReady } = require('../dist/common/tournament-results-ready');
const { teamStandings } = require('../dist/common/final-rankings');
const { PublicService } = require('../dist/public/public.service');
const db = new PrismaService();
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const ids = { tournament: randomUUID(), other: randomUUID(), auto: randomUUID(), admin: randomUUID(), player: randomUUID(), referee: randomUUID() };
const playerIds = [];
const headers = (id = ids.admin) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: id }, { expiresIn: '15m' })}` });
const endpoint = `/admin/competitions/${ids.tournament}/rankings`;
let checks = 0;

async function api(url, options = {}, status = 200) {
  const response = await fetch(`http://localhost:4000/api${url}`, { headers: headers(), ...options });
  assert.equal(response.status, status, `${options.method ?? 'GET'} ${url}: ${response.status}`);
  checks++;
  return response;
}

async function main() {
  const groupMatch = { status: 'COMPLETED', round: 'A', roundNo: 0, side1Id: 'a', side2Id: 'b', winnerSide: 1 };
  const groupEvent = { format: 'GROUP_PLUS_KNOCKOUT_STD', registrations: [{ id: 'a' }, { id: 'b' }], matches: [groupMatch] };
  assert.equal(eventResultsReady(groupEvent), false, 'group stage alone must not publish final ranks');
  assert.equal(eventResultsReady({ ...groupEvent, format: 'SINGLE_ELIMINATION_PLUS_GROUP_RANKING', matches: [{ ...groupMatch, round: 'F' }] }), false, 'missing second stage stays hidden');
  const completeEvent = { ...groupEvent, matches: [groupMatch, { ...groupMatch, round: 'F', roundNo: 1 }] };
  assert.equal(eventResultsReady(completeEvent), true);
  const registrationRows = ['a', 'b'].map((id) => ({ id, player1: { name: id, affiliation: '' }, player2: null }));
  const groupKnockoutRanks = new PublicService({}, {}, {}).calculatedEventStandings({
    format: 'GROUP_PLUS_KNOCKOUT', registrations: registrationRows,
    matches: [groupMatch, { ...groupMatch, round: 'F', roundNo: 1, winnerSide: 2 }],
  }, new Map(registrationRows.map((row) => [row.id, row])));
  assert.deepEqual(groupKnockoutRanks.map((row) => [row.id, row.rank]), [['b', 1], ['a', 2]], 'final winner outranks group-stage winner');
  assert.equal(eventResultsReady({ ...completeEvent, matches: completeEvent.matches.map((m) => ({ ...m, status: 'CANCELLED' })) }), false);
  assert.equal(eventResultsReady({ ...completeEvent, secondStage: { matches: [{ status: 'PENDING' }], rankings: [{ rank: 1, entrantId: 'a' }] } }), false);
  assert.equal(eventResultsReady({ ...completeEvent, secondStage: { matches: [{ status: 'COMPLETED' }, { status: 'CANCELLED' }], rankings: [{ rank: 1, entrantId: 'a' }] } }), true);
  assert.equal(tournamentResultsReady({ status: 'FINISHED', events: [{ ...completeEvent, matches: [{ ...groupMatch, round: 'F', status: 'LIVE' }] }], teamCompetitions: [] }), false, 'manual status cannot publish an unfinished scheduled match');
  assert.equal(tournamentResultsReady({ status: 'ONGOING', events: [completeEvent, { ...groupEvent, matches: [] }], teamCompetitions: [] }), false, 'an undrawn active event still blocks completion');
  const teamRows = teamStandings({ teams: ['a', 'b', 'c'].map((id) => ({ id, name: id, affiliation: '' })), teamMatches: [
    { round: 'SF', roundNo: 1, status: 'COMPLETED', team1Id: 'b', team2Id: 'c', winnerTeamId: 'b', team1Wins: 3, team2Wins: 0 },
    { round: 'F', roundNo: 2, status: 'COMPLETED', team1Id: 'a', team2Id: 'b', winnerTeamId: 'a', team1Wins: 3, team2Wins: 2 },
  ] });
  assert.deepEqual(teamRows.map((row) => [row.id, row.rank]), [['a', 1], ['b', 2], ['c', 3]]);
  for (const [id, role] of [[ids.admin, 'ADMIN'], [ids.player, 'PLAYER'], [ids.referee, 'REFEREE']]) {
    await db.user.create({ data: { id, username: `rank-test-${id}`, email: `${id}@rank-test.invalid`, passwordHash: 'unused-test-account', role } });
  }
  for (const id of [ids.tournament, ids.other, ids.auto]) {
    await db.tournament.create({ data: { id, name: `排名验证-${id}`, status: 'FINISHED', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-02'), isPublished: true, approvalStatus: 'APPROVED' } });
  }
  const makeEvent = (tournamentId, type) => db.event.create({ data: { tournamentId, type, format: 'ROUND_ROBIN', scoringRule: 'FIFTEEN_ONE', scoringMode: 'CAPPED_30' } });
  const singles = await makeEvent(ids.tournament, 'MENS_SINGLES');
  const doubles = await makeEvent(ids.tournament, 'MENS_DOUBLES');
  const other = await makeEvent(ids.other, 'MENS_SINGLES');
  async function entrant(event, name, partner = false, status = 'APPROVED') {
    const p1 = await db.player.create({ data: { name, gender: 'MALE', affiliation: '测试学院' } }); playerIds.push(p1.id);
    let p2;
    if (partner) { p2 = await db.player.create({ data: { name: `${name}搭档`, gender: 'MALE', affiliation: '测试学院' } }); playerIds.push(p2.id); }
    return db.registration.create({ data: { eventId: event.id, player1Id: p1.id, player2Id: p2?.id, status } });
  }
  const a = await entrant(singles, '测试甲');
  const b = await entrant(singles, '测试乙');
  const c = await entrant(singles, '测试丙');
  const pending = await entrant(singles, '未审核选手', false, 'PENDING');
  const pair = await entrant(doubles, '测试双打', true);
  const foreign = await entrant(other, '其他赛事选手');
  await db.tournament.update({ where: { id: ids.auto }, data: { status: 'ONGOING' } });
  const autoEvent = await makeEvent(ids.auto, 'MENS_SINGLES');
  const autoOther = await makeEvent(ids.auto, 'MENS_DOUBLES');
  for (const event of [autoEvent, autoOther]) {
    await db.event.update({ where: { id: event.id }, data: { format: 'SINGLE_ELIMINATION', customGamePoint: 3, customGameCap: 3, customGamesToWin: 1, rankingLimit: 2 } });
  }
  const autoA = await entrant(autoEvent, '自动冠军甲');
  const autoB = await entrant(autoEvent, '自动亚军乙');
  const autoC = await entrant(autoOther, '自动双打亚军', true);
  const autoD = await entrant(autoOther, '自动双打冠军', true);
  await db.match.create({ data: { eventId: autoEvent.id, round: 'F', roundNo: 1, matchNo: 1, side1Id: autoA.id, side2Id: autoB.id, status: 'COMPLETED', winnerSide: 1 } });
  const lastMatch = await db.match.create({ data: { eventId: autoOther.id, round: 'F', roundNo: 1, matchNo: 1, side1Id: autoC.id, side2Id: autoD.id, refereeId: ids.referee } });
  await db.refereeTournamentGrant.create({ data: { tournamentId: ids.auto, userId: ids.referee } });
  const autoRankings = async () => (await (await api(`/public/ranking?tournamentId=${ids.auto}`)).json()).tournaments[0];
  const refereePost = (action, body) => api(`/matches/${lastMatch.id}/${action}`, { method: 'POST', headers: headers(ids.referee), body: JSON.stringify(body ?? {}) }, 201);
  assert.equal((await autoRankings()).rankingsAvailable, false, 'one completed event is insufficient');
  await refereePost('start', { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 });
  for (let point = 0; point < 3; point++) await refereePost('point', { side: 2 });
  assert.equal((await autoRankings()).rankingsAvailable, false, 'winning score alone must await referee confirmation');
  async function confirmAutomaticResults() {
    await refereePost('finish');
    const auto = await autoRankings();
    assert.equal(auto.rankingsAvailable, true);
    assert.equal(auto.events.find((event) => event.id === autoEvent.id).standings[0].id, autoA.id);
    assert.equal(auto.events.find((event) => event.id === autoOther.id).standings[0].id, autoD.id);
    assert.equal((await db.tournament.findUnique({ where: { id: ids.auto } })).status, 'ONGOING', 'no manual status change is needed');
    assert.equal((await db.registration.findUnique({ where: { id: autoD.id } })).finalRank, null, 'calculated ranks need no manual entry');
  }
  const teamCompetition = await db.teamCompetition.create({ data: { tournamentId: ids.tournament, name: '测试团体赛', isPublished: true } });
  const team = await db.team.create({ data: { teamCompetitionId: teamCompetition.id, name: '测试队伍', affiliation: '测试学院' } });
  const patch = (entries, groupId = singles.id, kind = 'event', rankingLimit) => ({ method: 'PATCH', body: JSON.stringify({ kind, groupId, entries, rankingLimit }) });
  await api(endpoint, { headers: {} }, 401);
  await api(endpoint, { headers: headers(ids.player) }, 403);
  await api(endpoint, { ...patch([{ id: a.id, rank: 1 }]), headers: headers(ids.player) }, 403);
  const initial = await (await api(endpoint)).json();
  assert.equal(initial.groups.find((g) => g.id === singles.id).entries.length, 3);
  for (const rank of [0, -1, 1.5, 10000, '1', undefined]) await api(endpoint, patch([{ id: a.id, rank }]), 400);
  await api(endpoint, patch([{ id: a.id, rank: 1 }, { id: a.id, rank: 2 }]), 400);
  for (const invalid of [foreign, pair, pending]) {
    await api(endpoint, patch([{ id: a.id, rank: 1 }, { id: invalid.id, rank: 2 }]), 400);
    assert.equal((await db.registration.findUnique({ where: { id: a.id } })).finalRank, null, 'transaction rolls back earlier updates');
  }
  await api(endpoint, patch([{ id: a.id, rank: 3 }, { id: b.id, rank: 3 }, { id: c.id, rank: null }]));
  await api(endpoint, patch([{ id: pair.id, rank: 1 }], doubles.id));
  await api(endpoint, patch([{ id: team.id, rank: 2 }], teamCompetition.id, 'team'));
  const options = await (await api('/public/ranking')).json();
  assert.ok(options.tournaments.some((t) => t.id === ids.tournament));
  assert.ok(options.tournaments.every((t) => !('events' in t)), 'initial request returns options only');
  const rankedTournament = async () => {
    const result = await (await api(`/public/ranking?tournamentId=${ids.tournament}`)).json();
    assert.equal(result.tournaments.length, 1, 'selected tournament is isolated');
    return result.tournaments[0];
  };
  let ranked = await rankedTournament();
  assert.deepEqual(ranked.events.find((e) => e.id === singles.id).standings.map((row) => row.rank), [3, 3]);
  assert.equal(ranked.events.find((e) => e.id === doubles.id).standings[0].rank, 1);
  assert.equal(ranked.events.find((e) => e.id === teamCompetition.id).standings[0].rank, 2);
  for (const status of ['REGISTRATION_NOT_STARTED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ONGOING']) {
    await db.tournament.update({ where: { id: ids.tournament }, data: { status } });
    const hidden = await rankedTournament();
    assert.equal(hidden.rankingsAvailable, false);
    assert.deepEqual(hidden.events, []);
    assert.ok(!JSON.stringify(hidden).includes('测试甲') && !JSON.stringify(hidden).includes('测试队伍'));
  }
  assert.equal((await (await api(endpoint)).json()).groups.find((g) => g.id === singles.id).entries.find((e) => e.id === a.id).rank, 3, 'admin can prepare ranks before finish');
  await db.tournament.update({ where: { id: ids.tournament }, data: { status: 'FINISHED' } });
  const xml = await (await api(`/exports/tournaments/${ids.tournament}/results`)).text();
  assert.ok(xml.includes('未设置') && xml.includes('测试队伍'));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await (await api(`/exports/tournaments/${ids.tournament}/orderbook`)).arrayBuffer()));
  const summary = workbook.getWorksheet('名次汇总');
  const values = summary.getSheetValues().flat(2);
  assert.equal(values.filter((value) => value === '第3名').length, 2);
  assert.ok(values.includes('测试队伍') && values.includes('未设置'));
  for (const limit of [0, -1, 1.5, 10000, '8']) await api(endpoint, patch([], singles.id, 'event', limit), 400);
  await api(endpoint, patch([], other.id, 'event', 8), 400);
  await api(endpoint, patch([{ id: a.id, rank: 8 }, { id: b.id, rank: 8 }, { id: c.id, rank: 9 }], singles.id, 'event', 8));
  ranked = await rankedTournament();
  assert.deepEqual(ranked.events.find((e) => e.id === singles.id).standings.map((row) => row.rank), [8, 8], 'keep ties at cutoff, exclude ninth');
  assert.equal((await db.registration.findUnique({ where: { id: c.id } })).finalRank, 9, 'hidden ranks are preserved');
  await api(endpoint, patch([], teamCompetition.id, 'team', 1));
  ranked = await rankedTournament();
  assert.equal(ranked.events.find((e) => e.id === teamCompetition.id).standings.length, 0);
  await api(endpoint, patch([], teamCompetition.id, 'team', null));
  await api(endpoint, patch([], singles.id, 'event', null));
  assert.equal((await rankedTournament()).events.find((e) => e.id === singles.id).standings.length, 3);
  await api(endpoint, patch([{ id: a.id, rank: null }, { id: b.id, rank: null }, { id: c.id, rank: null }]));
  ranked = await rankedTournament();
  assert.deepEqual(ranked.events.find((e) => e.id === singles.id).standings.map((row) => row.rank), [1, 2, 3]);

  if (process.argv.includes('--browser')) {
    const { chromium } = require('C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    const frontend = path.resolve('../frontend');
    const localRequire = createRequire(path.join(frontend, 'package.json'));
    createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
    const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
    const cookieName = 'authjs.session-token';
    const cookie = await encode({ secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: cookieName,
      token: { sub: ids.admin, name: '排名测试管理员', role: 'ADMIN', accessToken: jwt.sign({ sub: ids.admin }, { expiresIn: '15m' }), accessTokenExpiresAt: Date.now() + 900000 } });
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await context.addCookies([{ name: cookieName, value: cookie, url: 'http://localhost:3000' }]);
      const page = await context.newPage();
      const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://localhost:3000/admin/competitions');
      const row = page.getByRole('row').filter({ hasText: `排名验证-${ids.tournament}` });
      await row.getByRole('button', { name: '设置排名' }).click();
      const dialog = page.getByRole('dialog').filter({ hasText: '设置排名' });
      const input = dialog.getByRole('spinbutton', { name: '测试甲的最终名次', exact: true });
      await dialog.getByLabel('搜索参赛选手或队伍', { exact: true }).fill('测试甲');
      assert.equal(await dialog.getByRole('spinbutton', { name: '测试乙的最终名次', exact: true }).count(), 0);
      await dialog.getByRole('button', { name: '前 8 名', exact: true }).click();
      await input.fill('2');
      await dialog.getByRole('button', { name: '保存名次' }).click();
      await page.getByText('最终名次已保存', { exact: true }).waitFor();
      assert.equal((await db.registration.findUnique({ where: { id: a.id } })).finalRank, 2);
      assert.equal((await db.event.findUnique({ where: { id: singles.id } })).rankingLimit, 8);
      await page.reload();
      await row.getByRole('button', { name: '设置排名' }).click();
      await input.waitFor();
      assert.equal(await input.inputValue(), '2');
      assert.equal(await dialog.getByRole('spinbutton', { name: '取前几名', exact: true }).inputValue(), '8');
      await input.fill('4');
      await dialog.getByRole('button', { name: /^关\s*闭$/ }).click();
      await page.getByRole('button', { name: '继续编辑', exact: true }).click();
      assert.equal(await input.inputValue(), '4');
      await page.getByText('有尚未保存的名次，是否放弃修改？', { exact: true }).first().waitFor({ state: 'hidden' });
      const screenshotDirectory = path.resolve('test/rankings-qa');
      await require('node:fs/promises').mkdir(screenshotDirectory, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDirectory, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => {
        const input = document.querySelector('[aria-label="测试甲的最终名次"]');
        const bounds = input?.getBoundingClientRect();
        return bounds && bounds.left >= 0 && bounds.right <= window.innerWidth;
      });
      await page.screenshot({ path: path.join(screenshotDirectory, 'mobile.png'), fullPage: true });
      await dialog.getByRole('button', { name: '清空本项目名次' }).click();
      await dialog.getByRole('button', { name: '保存名次' }).click();
      await page.getByText('最终名次已保存', { exact: true }).waitFor();
      assert.equal((await db.registration.findUnique({ where: { id: a.id } })).finalRank, null);
      await api(endpoint, patch([{ id: a.id, rank: 1 }, { id: b.id, rank: 8 }, { id: c.id, rank: 9 }], singles.id, 'event', 8));
      await db.tournament.update({ where: { id: ids.tournament }, data: { status: 'ONGOING' } });
      await page.goto('http://localhost:3000/ranking');
      await page.getByText('请先选择赛事，再查看最终名次', { exact: true }).waitFor();
      assert.equal(await page.locator('article').count(), 0);
      await page.getByRole('combobox', { name: '选择赛事', exact: true }).selectOption(ids.tournament);
      const publicCard = page.locator('article').filter({ hasText: `排名验证-${ids.tournament}` });
      await publicCard.getByText('比赛尚未结束，结束后公布最终名次', { exact: true }).waitFor();
      assert.equal(await publicCard.getByRole('table').count(), 0);
      assert.equal(await page.getByRole('searchbox', { name: '搜索选手或队伍', exact: true }).isDisabled(), true);
      await db.tournament.update({ where: { id: ids.tournament }, data: { status: 'FINISHED' } });
      await publicCard.getByRole('button', { name: '刷新排名' }).click();
      await publicCard.getByText('测试队伍', { exact: true }).waitFor();
      assert.equal(await publicCard.getByText('测试丙', { exact: true }).count(), 0);
      assert.ok((await publicCard.getByRole('columnheader').allTextContents()).every((text) => ['最终名次', '参赛选手／队伍'].includes(text)));
      const search = page.getByRole('searchbox', { name: '搜索选手或队伍', exact: true });
      await search.fill('测试乙');
      await publicCard.getByText('测试乙', { exact: true }).waitFor();
      assert.equal(await publicCard.getByText('测试甲', { exact: true }).count(), 0);
      assert.equal(await publicCard.getByText('第8名', { exact: true }).count(), 1);
      await search.fill('测试丙');
      await publicCard.getByText('没有找到匹配的选手或队伍', { exact: true }).waitFor();
      await search.fill('');
      await page.screenshot({ path: path.join(screenshotDirectory, 'public-mobile.png'), fullPage: true });
      await page.getByRole('combobox', { name: '选择赛事', exact: true }).selectOption(ids.other);
      await page.locator('article').getByText('其他赛事选手', { exact: true }).waitFor();
      assert.equal(await page.locator('article').getByText('测试甲', { exact: true }).count(), 0);
      await page.getByRole('combobox', { name: '选择赛事', exact: true }).selectOption('');
      await page.getByText('请先选择赛事，再查看最终名次', { exact: true }).waitFor();
      await page.getByRole('combobox', { name: '选择赛事', exact: true }).selectOption(ids.auto);
      await page.getByText('比赛尚未结束，结束后公布最终名次', { exact: true }).waitFor();
      await confirmAutomaticResults();
      // No reload or refresh click: the real referee finish broadcast updates this page.
      await page.getByRole('cell', { name: '自动双打冠军 / 自动双打冠军搭档', exact: true }).waitFor({ timeout: 10000 });
      await page.getByRole('cell', { name: '自动冠军甲', exact: true }).waitFor();
      await page.screenshot({ path: path.join(screenshotDirectory, 'automatic-results-mobile.png'), fullPage: true });
      assert.deepEqual(errors, []);
      console.log('PASS: browser search/edit, cutoff, event isolation, mobile, and live automatic results after the referee confirms the last match.');
    } finally { await browser.close(); }
  } else { await confirmAutomaticResults(); }
  console.log(`PASS: ${checks} HTTP checks, transaction rollback, tied ranks, doubles/teams, reset and both exports.`);
}
main().finally(async () => {
  await db.tournament.deleteMany({ where: { id: { in: [ids.tournament, ids.other, ids.auto] } } });
  await db.player.deleteMany({ where: { id: { in: playerIds } } });
  await db.user.deleteMany({ where: { id: { in: [ids.admin, ids.player, ids.referee] } } });
  await db.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
