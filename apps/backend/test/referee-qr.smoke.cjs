// Run from apps/backend: node --env-file=.env test/referee-qr.smoke.cjs [--browser]
// Creates only uniquely named fixtures and removes those exact records in finally.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { mkdir } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const site = process.env.QA_SITE_URL || 'http://localhost:3000';
const run = randomUUID();
const tournamentIds = [randomUUID(), randomUUID()];
const userIds = [];
const playerIds = [];
const users = {};
const tokens = {};

async function request(endpoint, role, method = 'GET', body, expected = 200) {
  const res = await fetch(`${api}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  assert.equal(res.status, expected, `${method} ${endpoint}: ${JSON.stringify(data)}`);
  return data;
}

async function browserChecks(tournament, courts, uiMatch, codePath) {
  const frontend = path.resolve(__dirname, '../../frontend');
  const localRequire = createRequire(path.join(frontend, 'package.json'));
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  const { parseRefereeEntry } = await import(pathToFileURL(path.join(frontend, 'lib/referee-entry.ts')).href);
  assert.equal(parseRefereeEntry(`${site}${codePath}`, site), codePath);
  for (const value of ['javascript:alert(1)', 'https://example.com/referee/tournaments/test', '/admin', '//example.com/referee/tournaments/test', `/referee/tournaments/${tournament.id}`]) {
    assert.throws(() => parseRefereeEntry(value, site));
  }
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const output = path.resolve(__dirname, '../../../outputs/referee-qr-qa');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  async function contextFor(role, mobile = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
    const name = 'authjs.session-token';
    const value = await encode({
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: name,
      token: { sub: users[role].id, name: users[role].username, role: users[role].role, status: 'ACTIVE', accessToken: tokens[role], accessTokenExpiresAt: Date.now() + 3600000 },
    });
    await context.addCookies([{ name, value, url: site }]);
    return context;
  }
  try {
    const admin = await contextFor('ADMIN');
    const adminPage = await admin.newPage();
    adminPage.on('pageerror', (error) => errors.push(error.message));
    await adminPage.goto(`${site}/admin/scoring`);
    await adminPage.locator('.ant-select').first().click();
    await adminPage.getByText(tournament.name, { exact: true }).last().click();
    await adminPage.getByText('赛事执裁二维码', { exact: true }).waitFor();
    await adminPage.getByText(tournament.name, { exact: true }).last().waitFor();
    const qrImage = await adminPage.locator('.ant-qrcode').screenshot({ path: path.join(output, 'tournament-qr.png') });
    await adminPage.screenshot({ path: path.join(output, 'admin-qr.png'), fullPage: true });

    const anon = await browser.newPage();
    await anon.goto(`${site}${codePath}`);
    assert.ok(anon.url().includes('/login?redirect='), 'Unauthenticated scan preserves login return URL');
    assert.equal(new URL(anon.url()).searchParams.get('redirect'), codePath);
    const player = await (await contextFor('PLAYER')).newPage();
    await player.goto(`${site}${codePath}`);
    assert.ok(player.url().includes('/forbidden'), 'Player cannot open tournament QR');

    const context = await contextFor('REFEREE_A', true);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await prisma.refereeTournamentGrant.deleteMany({ where: { userId: users.REFEREE_A.id, tournamentId: tournament.id } });
    await page.goto(`${site}/referee/my-matches`);
    await page.getByText('尚未获得赛事授权，请先扫描该赛事二维码', { exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 0);
    await page.screenshot({ path: path.join(output, 'mobile-before-authorization.png'), fullPage: true });
    await page.goto(`${site}/referee/tournaments/${tournament.id}`);
    await page.getByText('尚未获得该赛事授权，请先扫描该赛事二维码', { exact: true }).waitFor();
    assert.equal(await page.getByRole('region', { name: '赛事场地' }).count(), 0);
    await page.goto(`${site}/referee/my-matches`);
    await page.getByRole('link', { name: '扫码执裁' }).click();
    await page.getByRole('heading', { name: '扫码执裁' }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: 'tournament-qr.png', mimeType: 'image/png', buffer: qrImage });
    await page.waitForURL(`**/referee/tournaments/${tournament.id}`);
    await page.getByRole('heading', { name: tournament.name }).waitFor();
    const courtList = page.getByRole('region', { name: '赛事场地' });
    await courtList.waitFor();
    assert.equal(await courtList.getByRole('link').count(), 5);
    assert.deepEqual(await courtList.locator('a > span:first-child').allTextContents(), ['1', '2', '3', '4', '5']);
    assert.equal(await page.locator('article').count(), 0, 'No match details before selecting a court');
    await page.screenshot({ path: path.join(output, 'mobile-five-courts.png'), fullPage: true });
    await page.reload();
    await courtList.waitFor();
    await page.getByRole('link', { name: new RegExp(courts[1].name) }).click();
    await page.getByText('此场地暂无比赛，请等待赛程安排或刷新').waitFor();
    await page.getByRole('link', { name: '返回场地列表' }).click();
    await page.getByRole('link', { name: new RegExp(courts[0].name) }).click();
    await page.getByRole('button', { name: '执裁此场比赛', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Mobile page should not overflow');
    assert.equal(await page.locator('main').evaluate((element) => getComputedStyle(element).paddingLeft), '16px');
    assert.equal(await page.locator('article').first().evaluate((element) => getComputedStyle(element).paddingLeft), '20px');
    await page.screenshot({ path: path.join(output, 'mobile-court-matches.png'), fullPage: true });
    await page.getByRole('button', { name: '执裁此场比赛', exact: true }).click();
    await page.waitForURL(`**/referee/matches/${uiMatch.id}`);
    await page.getByText('LIVE SCORING', { exact: true }).waitFor();
    await page.getByRole('link', { name: '返回场次' }).click();
    await page.getByRole('heading', { name: `${courts[0].name} · 比赛列表` }).waitFor();
    await page.goto(`${site}/referee/scan`);
    await page.getByRole('button', { name: '打开摄像头扫码' }).click();
    await page.getByText(/摄像头权限未开启|摄像头启动失败|Requested device not found|Could not start video source/).waitFor();
    await page.screenshot({ path: path.join(output, 'mobile-scanner.png'), fullPage: true });
    // Exercise the actual video -> canvas -> jsQR loop with a synthetic camera.
    await page.evaluate(async (dataUrl) => {
      const picture = new Image();
      picture.src = dataUrl;
      await picture.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(picture, 0, 0, 512, 512);
      const stream = canvas.captureStream(10);
      window.qaCameraStream = stream;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => stream });
    }, `data:image/png;base64,${qrImage.toString('base64')}`);
    await page.getByRole('button', { name: '打开摄像头扫码' }).click();
    await page.waitForURL(`**/referee/tournaments/${tournament.id}`);
    assert.equal(await page.evaluate(() => window.qaCameraStream.getTracks().every((track) => track.readyState === 'ended')), true, 'Camera tracks stop after decoding');
    assert.deepEqual(errors, []);
    console.log('PASS browser: admin QR -> image scan -> courts -> claim -> score -> return, role redirects, camera fallback, synthetic camera decode and cleanup, mobile layout');
  } finally { await browser.close(); }
}

async function main() {
  for (const name of ['ADMIN', 'SUPER_ADMIN', 'ROOT', 'PLAYER', 'PHOTOGRAPHER', 'REFEREE_A', 'REFEREE_B']) {
    const id = randomUUID();
    const role = name.startsWith('REFEREE') ? 'REFEREE' : name;
    const user = await prisma.user.create({ data: { id, role, username: `qr-${name}-${run}`, email: `${id}@qr-test.invalid`, passwordHash: 'test-no-login' } });
    userIds.push(id); users[name] = user;
    tokens[name] = jwt.sign({ sub: id }, { expiresIn: '20m' });
  }
  for (const id of tournamentIds) await prisma.tournament.create({ data: {
    id, name: `扫码执裁测试-${id}`, startDate: new Date(), endDate: new Date(),
  } });
  const tournament = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentIds[0] } });
  const courts = [];
  for (let i = 0; i < 6; i++) courts.push(await prisma.venue.create({ data: {
    tournamentId: tournament.id, name: `${i + 1}号场地`, sortOrder: i, isActive: i !== 5,
  } }));
  const otherCourt = await prisma.venue.create({ data: { tournamentId: tournamentIds[1], name: '其他赛事场地' } });
  const event = await prisma.event.create({ data: {
    tournamentId: tournament.id, type: 'MENS_SINGLES', format: 'SINGLE_ELIMINATION', scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  } });
  const sides = [];
  for (const name of ['测试选手甲', '测试选手乙']) {
    const player = await prisma.player.create({ data: { name, gender: 'MALE', affiliation: run } });
    playerIds.push(player.id);
    sides.push(await prisma.registration.create({ data: { eventId: event.id, player1Id: player.id } }));
  }
  async function match(extra = {}) {
    return prisma.match.create({ data: {
      eventId: event.id, venueId: courts[0].id, round: 'F', roundNo: 1, matchNo: 1,
      side1Id: sides[0].id, side2Id: sides[1].id, ...extra,
    } });
  }
  const target = await match();
  const assigned = await match({ matchNo: 2, refereeId: users.REFEREE_B.id });
  const pending = await match({ matchNo: 3, side2Id: null });
  const finished = await match({ matchNo: 4, status: 'COMPLETED' });
  const unscheduled = await match({ matchNo: 5, venueId: null });
  const uiMatch = await match({ matchNo: 6 });
  const team = await prisma.teamCompetition.create({ data: { tournamentId: tournament.id, name: '团体赛测试' } });
  const item = await prisma.teamCompetitionItem.create({ data: { teamCompetitionId: team.id, eventType: 'MENS_SINGLES', sortOrder: 0 } });
  const teamMatch = await prisma.teamMatch.create({ data: { teamCompetitionId: team.id, round: 'F', roundNo: 1, matchNo: 1 } });
  const teamGame = await match({ eventId: null, teamMatchId: teamMatch.id, teamCompetitionItemId: item.id, side1Id: null, side2Id: null });
  const base = `/referee/tournaments/${tournament.id}/courts`;
  const listUrl = `${base}/${courts[0].id}/matches`;
  const claim = (id) => `${listUrl}/${id}/claim`;
  await request(base, null, 'GET', null, 401);
  for (const role of ['ADMIN', 'SUPER_ADMIN', 'ROOT']) {
    assert.ok((await request('/scoring/referees', role)).some((user) => user.id === users.REFEREE_A.id));
  }
  await request('/scoring/referees', 'PLAYER', 'GET', null, 403);
  const codeEndpoint = `/tournaments/${tournament.id}/referee-access-code`;
  await request(codeEndpoint, 'REFEREE_A', 'POST', null, 403);
  const codes = await Promise.all(['ADMIN', 'SUPER_ADMIN', 'ROOT'].map((role) => request(codeEndpoint, role, 'POST', null, 201)));
  assert.equal(new Set(codes.map((code) => code.path)).size, 1, 'Concurrent generation preserves one QR per tournament');
  const otherCode = await request(`/tournaments/${tournamentIds[1]}/referee-access-code`, 'ADMIN', 'POST', null, 201);
  assert.notEqual(otherCode.path, codes[0].path, 'Every tournament has a different QR');
  const accessCode = codes[0].path.split('/').at(-1);
  assert.match(accessCode, /^[a-f0-9]{64}$/);
  await request('/referee/authorize', null, 'POST', { accessCode }, 401);
  for (const role of ['ADMIN', 'SUPER_ADMIN', 'ROOT', 'PLAYER', 'PHOTOGRAPHER']) {
    await request(base, role, 'GET', null, 403);
    await request(listUrl, role, 'GET', null, 403);
    await request(claim(target.id), role, 'POST', null, 403);
    await request('/referee/authorize', role, 'POST', { accessCode }, 403);
  }
  assert.deepEqual(await request('/referee/tournaments', 'REFEREE_A'), []);
  assert.deepEqual(await request('/referee/matches', 'REFEREE_B'), [], 'Manual assignment does not bypass scan authorization');
  await request(`/matches/${assigned.id}/score`, 'REFEREE_B', 'GET', null, 403);
  await request(`/matches/${assigned.id}/start`, 'REFEREE_B', 'POST', { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 }, 403);
  await request(base, 'REFEREE_A', 'GET', null, 403);
  await request(listUrl, 'REFEREE_A', 'GET', null, 403);
  await request(claim(target.id), 'REFEREE_A', 'POST', null, 403);
  await request('/referee/authorize', 'REFEREE_A', 'POST', { accessCode: 'invalid' }, 400);
  await request('/referee/authorize', 'REFEREE_A', 'POST', { accessCode: 'f'.repeat(64) }, 404);
  await Promise.all([1, 2].map(() => request('/referee/authorize', 'REFEREE_A', 'POST', { accessCode }, 201)));
  assert.equal(await prisma.refereeTournamentGrant.count({ where: { userId: users.REFEREE_A.id } }), 1);
  await request(base, 'REFEREE_B', 'GET', null, 403, 'One referee scan does not authorize another');
  await request(`/referee/tournaments/${tournamentIds[1]}/courts`, 'REFEREE_A', 'GET', null, 403);
  tokens.REFEREE_A = jwt.sign({ sub: users.REFEREE_A.id }, { expiresIn: '20m' });
  assert.equal((await request('/referee/tournaments', 'REFEREE_A'))[0].id, tournament.id, 'Authorization persists across logins');
  await request('/referee/authorize', 'REFEREE_B', 'POST', { accessCode }, 201);
  const listing = await request(base, 'REFEREE_A');
  assert.equal(listing.courts.length, 5);
  assert.deepEqual(listing.courts.map((court) => court.courtNumber), [1, 2, 3, 4, 5]);
  assert.equal(listing.courts[0].matchCount, 6);
  assert.equal(listing.unscheduledCount, 1);
  const matches = (await request(listUrl, 'REFEREE_A')).matches;
  assert.ok(matches.some((m) => m.id === teamGame.id), 'Includes team competition matches');
  assert.ok(!matches.some((m) => m.id === unscheduled.id));
  assert.equal((await request(`${base}/${courts[1].id}/matches`, 'REFEREE_A')).matches.length, 0);
  await request(`${base}/${otherCourt.id}/matches`, 'REFEREE_A', 'GET', null, 404);
  await request(`${base}/${courts[5].id}/matches`, 'REFEREE_A', 'GET', null, 404);
  await request(`${base}/${courts[1].id}/matches/${target.id}/claim`, 'REFEREE_A', 'POST', null, 404);
  await request(`/matches/${target.id}/score`, 'REFEREE_A', 'GET', null, 403);
  await request(claim(assigned.id), 'REFEREE_A', 'POST', null, 409);
  await request(claim(pending.id), 'REFEREE_A', 'POST', null, 400);
  await request(claim(finished.id), 'REFEREE_A', 'POST', null, 409);
  const attempts = await Promise.all(['REFEREE_A', 'REFEREE_B'].map((role) => fetch(`${api}${claim(target.id)}`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens[role]}` },
  })));
  assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409], 'Exactly one concurrent referee wins');
  const winner = attempts[0].status === 201 ? 'REFEREE_A' : 'REFEREE_B';
  const loser = winner === 'REFEREE_A' ? 'REFEREE_B' : 'REFEREE_A';
  await request(claim(target.id), winner, 'POST', null, 201);
  await request(`/matches/${target.id}/score`, loser, 'GET', null, 403);
  await request(`/matches/${target.id}/start`, winner, 'POST', { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 }, 201);
  const score = await request(`/matches/${target.id}/point`, winner, 'POST', { side: 1 }, 201);
  assert.equal(score.currentGame.side1Score, 1);
  assert.ok((await request('/referee/matches', winner)).some((m) => m.id === target.id));
  await request(`/matches/${target.id}/point`, loser, 'POST', { side: 1 }, 403);
  await request(`/matches/${assigned.id}/referee`, 'ADMIN', 'PATCH', { refereeId: users.REFEREE_A.id });
  await request(`/matches/${assigned.id}/score`, 'REFEREE_A');
  await prisma.tournament.update({ where: { id: tournament.id }, data: { isArchived: true } });
  await request(base, 'REFEREE_A', 'GET', null, 404);
  await request(claim(uiMatch.id), 'REFEREE_A', 'POST', null, 404);
  await request('/referee/authorize', 'REFEREE_A', 'POST', { accessCode }, 404);
  await prisma.tournament.update({ where: { id: tournament.id }, data: { isArchived: false } });
  await prisma.user.update({ where: { id: users.REFEREE_B.id }, data: { status: 'DISABLED' } });
  await request(base, 'REFEREE_B', 'GET', null, 403);
  console.log('PASS API: strict referee roles, court filtering, team matches, invalid courts, existing assignments, concurrent claim, live scoring, manual assignment, archived tournament, disabled account');
  if (process.argv.includes('--browser')) await browserChecks(tournament, courts, uiMatch, codes[0].path);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Exact UUIDs generated by this test only; deleting tournaments cascades fixture matches.
  await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
  console.log('Removed temporary referee QR test fixtures.');
});
