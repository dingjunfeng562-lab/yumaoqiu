// Real MySQL + Nest + Next + browser test. No mock routes or fabricated sessions.
// Requires the isolated services described in docs/match-check-in.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const bcrypt = require('bcryptjs');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(root, '.codex-work/node_modules/playwright'));
const dbUrl = process.env.DATABASE_URL;
assert.ok(dbUrl, 'Explicit DATABASE_URL is required; do not load the application .env');
const db = new URL(dbUrl);
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.port, '3317');
assert.equal(db.pathname, '/check_in_e2e_20261109');
const api = 'http://127.0.0.1:4117/api';
const site = 'http://127.0.0.1:3117';
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(dbUrl) });
const run = randomUUID().slice(0, 8);
const out = path.join(root, 'outputs/check-in-live', run);
fs.mkdirSync(out, { recursive: true });
const password = `CheckIn-${run}-Local!`;
const report = { run, database: `${db.hostname}:${db.port}${db.pathname}`, api, site, checks: [], sync: [], errors: [], requests: [] };
let browser;
function pass(name) { report.checks.push(name); console.log(`PASS ${name}`); }
async function request(endpoint, token, method = 'GET', body, status = 200) {
  const res = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await res.json();
  assert.equal(res.status, status, `${method} ${endpoint}: ${JSON.stringify(value)}`);
  return value;
}
async function loginApi(user) {
  const result = await request('/auth/login', null, 'POST', { loginType: 'username', identifier: user.username, password }, 201);
  assert.equal(result.user.id, user.id);
  return result.access_token;
}
async function seed() {
  const hash = await bcrypt.hash(password, 10);
  const users = {};
  for (const [key, role, permissions] of [['staff', 'ADMIN', ['SCHEDULING', 'SCORING']], ['other', 'ADMIN', ['SCHEDULING']], ['denied', 'ADMIN', []], ['referee', 'REFEREE'], ['player', 'PLAYER']]) {
    users[key] = await prisma.user.create({ data: { username: `qa_${key}_${run}`, email: `${key}-${run}@example.invalid`, passwordHash: hash, role, ...(permissions ? { permissions } : {}) } });
  }
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const tournament = await prisma.tournament.create({ data: { name: `签到真实验收 ${run}`, startDate: new Date(`${date}T09:00:00+08:00`), endDate: new Date(`${date}T18:00:00+08:00`), approvalStatus: 'APPROVED', isPublished: true, submittedById: users.staff.id, status: 'ONGOING' } });
  const group = await prisma.tournamentGroup.create({ data: { tournamentId: tournament.id, name: '验收组' } });
  const venues = [];
  for (let i = 1; i <= 6; i++) venues.push(await prisma.venue.create({ data: { tournamentId: tournament.id, name: `${i}号场`, sortOrder: i } }));
  const events = [];
  for (const type of ['MENS_SINGLES', 'MENS_DOUBLES']) events.push(await prisma.event.create({ data: { tournamentId: tournament.id, groupId: group.id, type, format: 'ROUND_ROBIN', scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN', drawPublished: true } }));
  const players = [];
  for (const name of ['测试甲一', '测试乙一', '测试甲二', '测试乙二', '测试替补']) players.push(await prisma.player.create({ data: { name, affiliation: '独立验收数据', gender: 'MALE', contact: 'PRIVATE-CONTACT', ownerId: users.staff.id } }));
  const registrations = [];
  for (let i = 0; i < 4; i++) registrations.push(await prisma.registration.create({ data: { eventId: events[i < 2 ? 0 : 1].id, player1Id: players[i % 2].id, ...(i >= 2 ? { player2Id: players[i].id } : {}) } }));
  const matches = [];
  for (let i = 0; i < 4; i++) matches.push(await prisma.match.create({ data: { eventId: events[i === 3 ? 1 : 0].id, round: '验收小组赛', roundNo: 1, matchNo: i + 1, side1Id: registrations[i === 3 ? 2 : 0].id, side2Id: registrations[i === 3 ? 3 : 1].id, venueId: venues[i].id, scheduledAt: new Date(`${date}T09:00:00+08:00`) } }));
  report.fixtures = { tournamentId: tournament.id, matchIds: matches.map(m => m.id), usernames: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.username])) };
  fs.writeFileSync(path.join(out, 'local-credentials.json'), JSON.stringify({ users: report.fixtures.usernames, password }, null, 2));
  return { users, tournament, venues, events, players, registrations, matches };
}
async function loginBrowser(user, destination) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  observe(page);
  await page.goto(`${site}/login?redirect=${encodeURIComponent(destination)}`, { timeout: 120000 });
  await page.getByPlaceholder('请输入用户名', { exact: true }).fill(user.username);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(url => url.pathname === destination.split('?')[0], { timeout: 120000 });
  const session = await page.evaluate(() => fetch('/api/auth/session').then(r => r.json()));
  assert.equal(session.user.id, user.id);
  assert.equal(session.user.role, user.role);
  pass(`Real browser password login: ${user.role}`);
  return { context, page, token: session.user.accessToken };
}
function observe(page) {
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('response', res => {
    const url = new URL(res.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/session')) report.requests.push({ method: res.request().method(), path: url.pathname, status: res.status() });
  });
}
async function state(page, id, expected, timeout = 8000) {
  await page.waitForFunction(({ id, expected }) => document.querySelector(`[data-match-id="${id}"]`)?.getAttribute('data-state') === expected, { id, expected }, { timeout });
}
async function uiMutation(page, url, action) {
  const pending = page.waitForResponse(res => res.url() === api + url && ['POST', 'PUT'].includes(res.request().method()));
  await action();
  const response = await pending;
  assert.ok(response.ok(), `${url}: ${response.status()} ${await response.text()}`);
}
async function main() {
  await request('/health');
  const f = await seed();
  pass('Fixtures created only in guarded independent local MySQL database');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const staff = await loginBrowser(f.users.staff, `/nicaiyixiahh/check-in?tournamentId=${f.tournament.id}`);
  const spectatorContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const spectator = await spectatorContext.newPage(); observe(spectator);
  const frames = [];
  spectator.on('websocket', ws => ws.on('framereceived', event => frames.push(String(event.payload))));
  await spectator.goto(`${site}/match-check-in/${f.tournament.id}`, { timeout: 120000 });
  const main = f.matches[0];
  await state(spectator, main.id, 'waiting', 60000);
  await state(staff.page, main.id, 'waiting', 60000);
  assert.equal(await spectator.locator('button[data-match-id]').count(), 0);
  assert.equal(await spectator.locator('article[data-match-id]').count(), 4);
  const publicBoard = await request(`/public/tournaments/${f.tournament.id}/check-in`);
  assert.ok(!JSON.stringify(publicBoard).includes('PRIVATE-CONTACT'));
  assert.ok(!JSON.stringify(publicBoard).includes('actorId'));
  pass('Anonymous spectator loads real board, read-only, no contact or operator data');
  const board = () => request(`/check-in/tournaments/${f.tournament.id}`, staff.token);
  const payload = (m, side = 'both', checked = true) => ({ side, checked, side1Key: m.side1.key, side2Key: m.side2.key });
  const initial = (await board()).matches.find(m => m.id === main.id);
  await request(`/check-in/matches/${main.id}`, null, 'PUT', payload(initial), 401);
  for (const role of ['player', 'denied', 'other']) {
    const token = await loginApi(f.users[role]);
    await request(`/check-in/matches/${main.id}`, token, 'PUT', payload(initial), role === 'other' ? 404 : 403);
  }
  pass('Unauthenticated, player, missing permission and cross-tournament writes rejected');
  await staff.page.locator(`[data-match-id="${main.id}"]`).click();
  const drawer = staff.page.getByRole('dialog');
  let started = Date.now();
  await uiMutation(staff.page, `/check-in/matches/${main.id}`, () => drawer.getByRole('button', { name: '甲方签到', exact: true }).click());
  await state(spectator, main.id, 'partial');
  report.sync.push({ state: 'partial', ms: Date.now() - started });
  await spectator.screenshot({ path: path.join(out, '01-partial.png'), fullPage: true });
  pass('Side A UI check-in persists and spectator synchronizes without reload');
  started = Date.now();
  await uiMutation(staff.page, `/check-in/matches/${main.id}`, () => drawer.getByRole('button', { name: '乙方签到', exact: true }).click());
  await state(spectator, main.id, 'ready');
  report.sync.push({ state: 'ready', ms: Date.now() - started });
  assert.equal((await prisma.match.findUnique({ where: { id: main.id } })).status, 'PENDING');
  const stored = await prisma.matchCheckIn.findMany({ where: { matchId: main.id }, orderBy: { side: 'asc' } });
  assert.equal(stored.length, 2);
  assert.ok(stored.every(row => row.actorId === f.users.staff.id));
  const logCount = await prisma.matchCheckInLog.count({ where: { matchId: main.id } });
  await request(`/check-in/matches/${main.id}`, staff.token, 'PUT', payload(initial));
  assert.deepEqual(await prisma.matchCheckIn.findMany({ where: { matchId: main.id }, orderBy: { side: 'asc' } }), stored);
  assert.equal(await prisma.matchCheckInLog.count({ where: { matchId: main.id } }), logCount);
  pass('Both sides ready; check-in does not start match; retry preserves timestamps and audit count');
  await drawer.getByRole('button', { name: '撤销签到', exact: true }).first().click();
  await uiMutation(staff.page, `/check-in/matches/${main.id}`, () => staff.page.getByRole('button', { name: /^(确 定|确定|OK)$/ }).click());
  await state(spectator, main.id, 'partial');
  await uiMutation(staff.page, `/check-in/matches/${main.id}`, () => drawer.getByRole('button', { name: '双方签到', exact: true }).click());
  await state(spectator, main.id, 'ready');
  await spectator.screenshot({ path: path.join(out, '02-ready.png'), fullPage: true });
  pass('Confirmed undo and both-sides UI check-in synchronize');
  const referee = await loginBrowser(f.users.referee, '/referee/my-matches');
  const access = await request(`/tournaments/${f.tournament.id}/referee-access-code`, staff.token, 'POST', {}, 201);
  await request('/referee/authorize', referee.token, 'POST', { accessCode: access.path.split('/').at(-1) }, 201);
  await request(`/referee/tournaments/${f.tournament.id}/courts/${f.venues[0].id}/matches/${main.id}/claim`, referee.token, 'POST', {}, 201);
  await referee.page.goto(`${site}/referee/matches/${main.id}`, { timeout: 120000 });
  await referee.page.getByRole('button', { name: '赛前设置', exact: true }).click();
  await referee.page.getByRole('dialog').getByRole('button', { name: '测试甲一', exact: true }).click();
  await referee.page.getByRole('button', { name: '保存设置', exact: true }).click();
  await uiMutation(referee.page, `/matches/${main.id}/warmup`, () => referee.page.getByRole('button', { name: '开始练球', exact: true }).click());
  started = Date.now();
  await uiMutation(referee.page, `/matches/${main.id}/start`, () => referee.page.getByRole('button', { name: '开始比赛', exact: true }).click());
  await state(spectator, main.id, 'live'); await state(staff.page, main.id, 'live');
  report.sync.push({ state: 'live', ms: Date.now() - started });
  assert.ok(await drawer.getByRole('button', { name: '双方签到', exact: true }).isDisabled());
  await request(`/check-in/matches/${main.id}`, staff.token, 'PUT', payload(initial, 'both', false), 400);
  pass('Authorized referee claims match, configures serve, warms up and starts via UI; check-in locked');
  for (let i = 1; i <= 15; i++) {
    await uiMutation(referee.page, `/matches/${main.id}/point`, () => referee.page.getByRole('button', { name: 'A方 +1 得分', exact: true }).click());
    if (i === 3) {
      await spectator.waitForFunction(id => document.querySelector(`[data-match-id="${id}"]`)?.textContent.includes('3 : 0'), main.id, { timeout: 8000 });
      await spectator.screenshot({ path: path.join(out, '03-live-score.png'), fullPage: true });
      pass('Live 3:0 score reaches spectator over real backend events');
    }
  }
  assert.equal((await prisma.match.findUnique({ where: { id: main.id } })).status, 'LIVE');
  await uiMutation(referee.page, `/matches/${main.id}/finish`, () => referee.page.getByRole('dialog', { name: '确认结束比赛' }).getByRole('button', { name: '确认结束', exact: true }).click());
  await state(spectator, main.id, 'finished'); await state(staff.page, main.id, 'finished');
  const result = await prisma.match.findUnique({ where: { id: main.id }, include: { games: true } });
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.winnerSide, 1);
  assert.equal(result.games[0].side1Score, 15); assert.equal(result.games[0].side2Score, 0);
  assert.ok(result.startedAt && result.finishedAt);
  await request(`/check-in/matches/${main.id}`, staff.token, 'PUT', payload(initial, 'both', false), 400);
  await spectator.screenshot({ path: path.join(out, '04-finished.png'), fullPage: true });
  await referee.page.screenshot({ path: path.join(out, '05-referee-finished.png'), fullPage: true });
  pass('15:0 winner confirmed via referee UI; both boards show finished; DB result and timestamps persist');
  await spectator.reload(); await state(spectator, main.id, 'finished', 30000);
  pass('Finished state survives fresh spectator reload');
  const extra = (await board()).matches.find(m => m.id === f.matches[1].id);
  assert.equal(extra.side1.checkedAt, null); assert.equal(extra.side2.checkedAt, null);
  await Promise.all(Array.from({ length: 6 }, () => request(`/check-in/matches/${extra.id}`, staff.token, 'PUT', payload(extra))));
  assert.equal(await prisma.matchCheckIn.count({ where: { matchId: extra.id } }), 2);
  assert.equal(await prisma.matchCheckInLog.count({ where: { matchId: extra.id } }), 2);
  pass('Same players in another match remain unchecked; six concurrent retries create only two records/logs');
  await prisma.registration.update({ where: { id: f.registrations[0].id }, data: { player1Id: f.players[4].id } });
  const changed = (await board()).matches.find(m => m.id === extra.id);
  assert.equal(changed.side1.checkedAt, null);
  await request(`/check-in/matches/${extra.id}`, staff.token, 'PUT', payload(extra), 409);
  pass('Real participant replacement invalidates old check-in and rejects stale drawer with 409');
  const doubles = (await board()).matches.find(m => m.id === f.matches[3].id);
  assert.ok(doubles.side1.name.includes('测试甲二') && doubles.side2.name.includes('测试乙二'));
  await request(`/check-in/matches/${doubles.id}`, staff.token, 'PUT', payload(doubles));
  await state(spectator, doubles.id, 'ready');
  pass('Doubles whole-side check-in persists and reaches spectator');
  await prisma.event.update({ where: { id: f.events[1].id }, data: { drawPublished: false } });
  assert.ok(!(await request(`/public/tournaments/${f.tournament.id}/check-in`)).matches.some(m => m.id === doubles.id));
  await prisma.event.update({ where: { id: f.events[1].id }, data: { drawPublished: true } });
  for (const data of [{ isPublished: false }, { isPublished: true, approvalStatus: 'PENDING' }, { approvalStatus: 'APPROVED', isArchived: true }]) {
    await prisma.tournament.update({ where: { id: f.tournament.id }, data });
    await request(`/public/tournaments/${f.tournament.id}/check-in`, null, 'GET', null, 404);
  }
  await prisma.tournament.update({ where: { id: f.tournament.id }, data: { isArchived: false } });
  pass('Unpublished draws and unpublished/unapproved/archived tournaments hidden publicly');
  report.socketEvents = { checkIn: frames.filter(x => x.includes('check-in:update')).length, score: frames.filter(x => x.includes('scoreboard:update')).length, bracket: frames.filter(x => x.includes('bracket:update')).length };
  assert.ok(report.socketEvents.checkIn > 0 && report.socketEvents.score > 0 && report.socketEvents.bracket > 0);
  assert.deepEqual(report.errors, []);
  pass('Real spectator WebSocket check-in/score/bracket frames captured; no browser page errors');
  report.result = 'PASS';
}
main().catch(async error => {
  report.result = 'FAIL'; report.failure = error.stack; console.error(error);
  if (browser) for (const [i, page] of browser.contexts().flatMap(c => c.pages()).entries()) {
    await page.screenshot({ path: path.join(out, `failure-${i}.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(out, `failure-${i}.txt`), await page.locator('body').innerText().catch(() => ''));
  }
  process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.join(out, 'report.json')}`);
  await browser?.close(); await prisma.$disconnect();
});
