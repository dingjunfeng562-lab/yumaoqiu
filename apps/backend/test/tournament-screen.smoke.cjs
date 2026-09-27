// Run with backend and frontend running: node --env-file=.env test/tournament-screen.smoke.cjs
// All writes target UUID fixtures and are cleaned up in finally.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const site = process.env.QA_SITE_URL || 'http://localhost:3000';
const tournamentIds = [randomUUID(), randomUUID()];
const playerIds = [];
const userId = randomUUID();
let browser;
let token;

async function request(endpoint, body, expected = 200) {
  const response = await fetch(`${api}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(body ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result));
  return result;
}

async function main() {
  const admin = await prisma.user.create({ data: {
    id: userId, username: `screen-qa-${userId}`, email: `${userId}@screen.invalid`, passwordHash: 'unused', role: 'ADMIN',
  } });
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: userId }, { expiresIn: '20m' });
  for (const [index, id] of tournamentIds.entries()) await prisma.tournament.create({ data: {
    id, name: index ? '隔离赛事' : '2026 秋季羽毛球邀请赛 · 大屏验收',
    startDate: new Date(), endDate: new Date(Date.now() + 86400000),
    status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true,
  } });
  const courts = [];
  for (let i = 0; i < 7; i++) courts.push(await prisma.venue.create({ data: {
    tournamentId: tournamentIds[0], name: `${i + 1} 号场地`, sortOrder: i, isActive: i < 6,
  } }));
  const event = await prisma.event.create({ data: {
    tournamentId: tournamentIds[0], type: 'MENS_DOUBLES', format: 'ROUND_ROBIN',
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
  } });
  const otherEvent = await prisma.event.create({ data: {
    tournamentId: tournamentIds[1], type: 'MENS_SINGLES', format: 'ROUND_ROBIN',
    scoringRule: 'FIFTEEN_ONE', scoringMode: 'STANDARD_GOLDEN',
  } });
  const players = [];
  for (const [index, name] of ['林一', '陈二', '王三', '李四', '周五', '赵六', '孙七', '吴八'].entries()) {
    const player = await prisma.player.create({ data: {
      name, gender: 'MALE', affiliation: index < 2 ? '信息工程学院' : index < 4 ? '经济管理学院' : '体育学院',
      contact: 'PRIVATE-CONTACT', notes: 'PRIVATE-NOTES',
    } });
    players.push(player); playerIds.push(player.id);
  }
  const registrations = [];
  for (let i = 0; i < 4; i++) registrations.push(await prisma.registration.create({ data: {
    eventId: event.id, player1Id: players[i * 2].id, player2Id: players[i * 2 + 1].id,
  } }));
  const match = async (venueId, matchNo, extra = {}) => prisma.match.create({ data: {
    eventId: event.id, venueId, round: '小组赛', roundNo: 1, matchNo,
    side1Id: registrations[0].id, side2Id: registrations[1].id,
    ...extra,
  } });
  const live = await match(courts[0].id, 1, { status: 'LIVE', startedAt: new Date(),
    games: { create: { gameNo: 1, side1Score: 7, side2Score: 5, server: 1 } } });
  const next = await match(courts[0].id, 2, { scheduledAt: new Date(Date.now() + 3600000),
    side1Id: registrations[2].id, side2Id: registrations[3].id });
  await match(courts[0].id, 3); // No time: must sort AFTER the scheduled next match.
  await match(courts[0].id, 4, { status: 'COMPLETED', winnerSide: 1 });
  await match(courts[1].id, 5, { status: 'CANCELLED' });
  await match(courts[2].id, 6);
  await match(courts[3].id, 7, { status: 'LIVE', games: { create: [
    { gameNo: 1, side1Score: 15, side2Score: 10, winnerSide: 1 },
    { gameNo: 2, side1Score: 3, side2Score: 8 },
  ] } });
  await match(courts[6].id, 8, { status: 'LIVE' });
  await match(courts[4].id, 9, { eventId: otherEvent.id, status: 'LIVE' });

  const endpoint = `/public/tournaments/${tournamentIds[0]}/screen`;
  let screen = await request(endpoint);
  assert.equal(screen.courts.length, 6);
  assert.deepEqual(screen.courts.map(court => court.id), courts.slice(0, 6).map(court => court.id));
  assert.equal(screen.courts[0].match.id, live.id);
  assert.equal(screen.courts[1].match, null);
  assert.equal(screen.courts[2].match.status, 'PENDING');
  assert.equal(screen.courts[3].match.currentGame.gameNo, 2);
  assert.equal(screen.courts[4].match, null, 'Cross-tournament match excluded');
  assert.equal(screen.courts[0].match.side1.players.length, 2);
  assert.ok(!JSON.stringify(screen).includes('PRIVATE-'));
  assert.deepEqual((await request(`/public/tournaments/${tournamentIds[1]}/screen`)).courts, []);
  await request('/public/tournaments/missing-screen-fixture/screen', undefined, 404);
  for (const update of [{ isPublished: false }, { isArchived: true }, { approvalStatus: 'PENDING' }]) {
    await prisma.tournament.update({ where: { id: tournamentIds[0] }, data: update });
    await request(endpoint, undefined, 404);
    await prisma.tournament.update({ where: { id: tournamentIds[0] }, data: { isPublished: true, isArchived: false, approvalStatus: 'APPROVED' } });
  }

  const frontend = path.resolve(__dirname, '../../frontend');
  const localRequire = createRequire(path.join(frontend, 'package.json'));
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const name = 'authjs.session-token';
  await context.addCookies([{ name, url: site, value: await encode({
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: name,
    token: { sub: admin.id, name: admin.username, role: 'ADMIN', status: 'ACTIVE', accessToken: token, accessTokenExpiresAt: Date.now() + 3600000 },
  }) }]);
  const adminPage = await context.newPage();
  const errors = [];
  adminPage.on('pageerror', error => errors.push(error.message));
  await adminPage.goto(`${site}/admin/competitions`);
  const row = adminPage.getByRole('row').filter({ hasText: '2026 秋季羽毛球邀请赛 · 大屏验收' });
  await row.getByRole('button', { name: '赛事大屏' }).click();
  const dialog = adminPage.getByRole('dialog');
  assert.equal(await dialog.getByLabel('赛事大屏链接').inputValue(), `${site}/live-screen/${tournamentIds[0]}`);
  await dialog.getByRole('button', { name: '复制链接' }).click();
  assert.equal(await adminPage.evaluate(() => navigator.clipboard.readText()), `${site}/live-screen/${tournamentIds[0]}`);
  const [opened] = await Promise.all([context.waitForEvent('page'), dialog.getByRole('link', { name: '打开大屏' }).click()]);
  await opened.waitForURL(`${site}/live-screen/${tournamentIds[0]}`);
  opened.on('pageerror', error => errors.push(error.message));
  await opened.getByRole('heading', { name: '2026 秋季羽毛球邀请赛 · 大屏验收' }).waitFor();
  const settingsTrigger = opened.getByRole('button', { name: '打开大屏设置', exact: true });
  assert.equal(await settingsTrigger.evaluate(el => getComputedStyle(el).opacity), '0', 'Settings hidden before hovering');
  await opened.mouse.move(1890, 1050);
  await settingsTrigger.click();
  const settingsPanel = opened.getByRole('dialog', { name: '赛事大屏设置' });
  await settingsPanel.getByRole('spinbutton', { name: '赛事名称字号' }).fill('80');
  assert.equal(await opened.locator('h1').evaluate(el => getComputedStyle(el).fontSize), '80px', 'Unsaved title changes preview immediately');
  await settingsPanel.getByRole('button', { name: '关闭大屏设置' }).click();
  assert.notEqual(await opened.locator('h1').evaluate(el => getComputedStyle(el).fontSize), '80px', 'Close discards unsaved preview');
  await opened.mouse.move(20, 20);
  await opened.waitForTimeout(220);
  assert.equal(await settingsTrigger.evaluate(el => getComputedStyle(el).opacity), '0', 'Settings hide when pointer leaves corner');
  await opened.mouse.move(1890, 1050);
  await settingsTrigger.click();

  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site}/live-screen/${tournamentIds[0]}`);
  await page.getByRole('heading', { name: '2026 秋季羽毛球邀请赛 · 大屏验收' }).waitFor();
  await page.getByText('● 实时同步').waitFor();
  assert.equal(await page.locator('[data-court-id]').count(), 6);
  const boxes = await page.locator('[data-court-id]').evaluateAll(nodes => nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
  }));
  const output = path.join(require('node:os').tmpdir(), 'tournament-screen-qa');
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'six-courts.png'), fullPage: true });
  console.log('Court layout:', boxes);
  assert.equal(boxes[0].y, boxes[2].y); assert.equal(boxes[3].y, boxes[5].y);
  assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x);
  assert.equal(boxes[0].x, boxes[3].x); assert.ok(boxes[3].y > boxes[0].y);
  assert.ok(boxes[5].y + boxes[5].height <= 1080, 'All six courts fit in display');
  const court = page.locator(`[data-court-id="${courts[0].id}"]`);
  await request(`/matches/${live.id}/point`, { side: 1 }, 201);
  await court.locator('strong').filter({ hasText: /^8$/ }).waitFor({ timeout: 4000 });
  await request(`/matches/${live.id}/forfeit`, { side: 2, reason: 'isolated screen fixture' }, 201);
  await court.getByText('周五', { exact: true }).waitFor({ timeout: 4000 });
  await court.getByText('待开始', { exact: true }).waitFor();
  assert.equal(await court.locator('strong').filter({ hasText: /^0$/ }).count(), 2, 'Pending scores start at zero');
  assert.equal((await request(endpoint)).courts[0].match.id, next.id);
  await request(`/matches/${next.id}/start`, { servingSide: 1, serverPlayerIndex: 1, receiverPlayerIndex: 1 }, 201);
  await court.getByText('进行中', { exact: true }).waitFor({ timeout: 4000 });
  await page.getByRole('button', { name: '全屏显示' }).click();
  await page.getByRole('button', { name: '退出全屏' }).waitFor();
  assert.ok(await page.evaluate(() => Boolean(document.fullscreenElement)));
  await page.getByRole('button', { name: '退出全屏' }).click();

  // Settings persist per tournament and reach an already-open anonymous screen.
  async function saveSettings(columns, rows, scale, titleFontSize, cardWidth = 560, cardHeight = 360, boundaryPadding = 28, cardFontScale = 100) {
    for (const [label, value] of [
      ['每行最多场地数', columns], ['期望显示行数', rows],
      ['整体缩放', scale], ['赛事名称字号', titleFontSize],
      ['卡片宽度', cardWidth], ['卡片高度', cardHeight],
      ['四周边界留白', boundaryPadding],
      ['卡片内字体大小', cardFontScale],
    ]) await settingsPanel.getByRole('spinbutton', { name: label, exact: true }).fill(String(value));
    assert.equal(await opened.locator('h1').evaluate(el => getComputedStyle(el).fontSize), `${titleFontSize}px`);
    const saved = opened.waitForResponse(response => response.url().endsWith('/screen-settings') && response.request().method() === 'PATCH');
    await settingsPanel.getByRole('button', { name: '保存大屏设置' }).click();
    assert.equal((await saved).status(), 200);
    assert.deepEqual(await opened.locator('[data-court-id]').first().evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight })), { width: cardWidth, height: cardHeight });
    await page.waitForFunction(({ columns, rows, titleFontSize, scale }) => {
      const grid = document.querySelector('[aria-label="场地比分"]');
      const heading = document.querySelector('h1');
      return grid?.style.getPropertyValue('--columns') === String(columns)
        && grid?.style.getPropertyValue('--rows') === String(rows)
        && getComputedStyle(heading).fontSize === `${titleFontSize}px`
        && grid.dataset.requestedScale === String(scale);
    }, { columns, rows: Math.max(rows, Math.ceil(6 / columns)), titleFontSize, scale }, { timeout: 15000 });
    await page.waitForTimeout(100); // ResizeObserver applies the final fit on the next frame.
    const bounds = await page.locator('[data-court-id]').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, bottom: rect.bottom };
    }));
    assert.equal(bounds.length, 6);
    assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= 1921 && rect.bottom <= 1081), 'Every court remains on the same screen');
    assert.ok(await page.evaluate(() => {
      const boundary = document.querySelector('[data-screen-boundary]').getBoundingClientRect();
      const grid = document.querySelector('[aria-label="场地比分"]').getBoundingClientRect();
      return Math.abs((grid.left + grid.right - boundary.left - boundary.right) / 2) <= 1
        && Math.abs((grid.top + grid.bottom - boundary.top - boundary.bottom) / 2) <= 1
        && grid.left >= boundary.left - 1 && grid.right <= boundary.right + 1
        && grid.top >= boundary.top - 1 && grid.bottom <= boundary.bottom + 1;
    }), 'Court board stays centered within all four boundaries');
  }
  await saveSettings(2, 3, 50, 72);
  const smallName = await court.getByText('周五', { exact: true }).boundingBox();
  await saveSettings(2, 3, 100, 72);
  const largeName = await court.getByText('周五', { exact: true }).boundingBox();
  assert.ok(largeName.height > smallName.height, 'Scale changes rendered content size');
  await saveSettings(1, 1, 200, 32); // Configured capacity smaller than six courts: auto-shrink all six.
  await saveSettings(3, 2, 100, 48, 420, 260, 80);
  assert.equal((await request(endpoint)).settings.cardWidth, 420);
  assert.equal((await request(endpoint)).settings.cardHeight, 260);
  assert.equal((await request(endpoint)).settings.boundaryPadding, 80);
  await saveSettings(3, 2, 100, 48, 560, 360, 28, 140);
  assert.equal((await request(endpoint)).settings.cardFontScale, 140);
  // Even the minimum supported card size must keep the entire content inside.
  await saveSettings(3, 2, 100, 48, 240, 160);
  await opened.waitForTimeout(150);
  assert.ok(await opened.locator('[data-court-id]').evaluateAll(cards => cards.every(card => {
    const bounds = card.getBoundingClientRect();
    const content = card.firstElementChild.firstElementChild.getBoundingClientRect();
    return content.left >= bounds.left && content.right <= bounds.right + 1 && content.bottom <= bounds.bottom + 1;
  })), 'Card content fits fixed width and height');
  await saveSettings(3, 2, 100, 48);
  await opened.screenshot({ path: path.join(output, 'corner-settings.png'), fullPage: true });
  await settingsPanel.getByRole('button', { name: '关闭大屏设置' }).click();
  await opened.reload();
  await opened.getByRole('heading', { name: '2026 秋季羽毛球邀请赛 · 大屏验收' }).waitFor();
  await opened.mouse.move(1890, 1050);
  await settingsTrigger.click();
  assert.equal(await settingsPanel.getByRole('spinbutton', { name: '每行最多场地数' }).inputValue(), '3');
  assert.equal(await settingsPanel.getByRole('spinbutton', { name: '赛事名称字号' }).inputValue(), '48');

  // Standalone displays can tune their local view without altering the tournament.
  await page.mouse.move(1890, 1050);
  await page.getByRole('button', { name: '打开大屏设置' }).click();
  const localPanel = page.getByRole('dialog', { name: '赛事大屏设置' });
  await localPanel.getByRole('spinbutton', { name: '赛事名称字号' }).fill('64');
  await localPanel.getByRole('button', { name: '保存大屏设置' }).click();
  await localPanel.getByText('已保存在当前浏览器', { exact: true }).waitFor();
  assert.equal((await request(endpoint)).settings.titleFontSize, 48);
  await page.reload();
  await page.getByRole('heading', { name: '2026 秋季羽毛球邀请赛 · 大屏验收' }).waitFor();
  assert.equal(await page.locator('h1').evaluate(el => getComputedStyle(el).fontSize), '64px');
  await page.evaluate(id => localStorage.removeItem(`tournament-screen:${id}`), tournamentIds[0]);
  await page.reload();
  await page.getByRole('heading', { name: '2026 秋季羽毛球邀请赛 · 大屏验收' }).waitFor();
  const settingsEndpoint = `${api}/tournaments/${tournamentIds[0]}/screen-settings`;
  assert.equal((await fetch(settingsEndpoint)).status, 401, 'Settings require authentication');
  for (const invalid of [{ columns: 0 }, { rows: 9 }, { scale: 201 }, { titleFontSize: 19 }, { scale: 50.5 }, { cardWidth: 239 }, { cardHeight: 901 }, { boundaryPadding: -1 }, { cardFontScale: 49 }, { cardFontScale: 161 }]) {
    const response = await fetch(settingsEndpoint, { method: 'PATCH', headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
    }, body: JSON.stringify({ columns: 3, rows: 2, scale: 100, titleFontSize: 48, ...invalid }) });
    assert.equal(response.status, 400);
  }
  assert.equal((await request(`/public/tournaments/${tournamentIds[1]}/screen`)).settings, null, 'Other tournament settings unchanged');
  await page.setViewportSize({ width: 1366, height: 768 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), 'Laptop fits six courts');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.route('**/public/tournaments/*/screen', route => route.abort());
  await page.getByRole('status').filter({ hasText: '连接中断' }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-court-id]').count(), 6, 'Keep last data on transient failure');
  await page.unroute('**/public/tournaments/*/screen');
  await page.getByRole('status').filter({ hasText: '实时同步' }).waitFor({ timeout: 15000 });
  await prisma.tournament.update({ where: { id: tournamentIds[0] }, data: { isPublished: false } });
  await page.getByRole('heading', { name: '赛事大屏暂不可用' }).waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-court-id]').count(), 0, 'Clear data after unpublishing');
  assert.deepEqual(errors, []);
  console.log('PASS: public scope, ordering, privacy, admin link/copy/open, live score, next match, fullscreen, persisted settings, live layout/scale/title updates, auto-fit all courts, validation/auth, mobile, recovery and unpublish');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  // Cross-event fixture references the first tournament court: remove matches first.
  await prisma.match.deleteMany({ where: { OR: [
    { event: { tournamentId: { in: tournamentIds } } },
    { venue: { tournamentId: { in: tournamentIds } } },
  ] } });
  await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds } } });
  await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
