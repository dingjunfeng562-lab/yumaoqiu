// Browser acceptance for the broadcast pages.
// Run with backend (4000) and frontend (3000) running:
//   node --env-file=.env test/broadcast-ui.smoke.cjs
// Screenshots go to ../../output/playwright/broadcast-*.png. Fixtures are cleaned up.
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://localhost:4000/api';
const site = process.env.QA_SITE_URL || 'http://localhost:3000';
const shots = path.resolve(__dirname, '../../../output/playwright');
const ids = { root: randomUUID(), admin: randomUUID(), tournament: randomUUID() };
const playerIds = [];
let browser;

async function call(endpoint, token, { method = 'GET', body } = {}) {
  const response = await fetch(`${api}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${endpoint} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  await mkdir(shots, { recursive: true });
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  for (const [id, role] of [[ids.root, 'ROOT'], [ids.admin, 'ADMIN']]) {
    await prisma.user.create({ data: {
      id, username: `bc-ui-${role}-${id}`, email: `${id}@broadcast.invalid`, passwordHash: 'unused', role,
    } });
  }
  const tokens = {
    ROOT: jwt.sign({ sub: ids.root }, { expiresIn: '20m' }),
    ADMIN: jwt.sign({ sub: ids.admin }, { expiresIn: '20m' }),
  };

  await prisma.tournament.create({ data: {
    id: ids.tournament, name: '2026 秋季羽毛球邀请赛 · 直播验收', startDate: new Date(),
    endDate: new Date(Date.now() + 86400000), status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true,
    submittedById: ids.root,
  } });
  const court = await prisma.venue.create({ data: { tournamentId: ids.tournament, name: '1 号场地', sortOrder: 0 } });
  const event = await prisma.event.create({ data: {
    tournamentId: ids.tournament, type: 'MIXED_DOUBLES', format: 'ROUND_ROBIN',
    scoringRule: 'TWENTYONE_BO3', scoringMode: 'CAPPED_30',
  } });
  const players = [];
  for (const [name, gender, affiliation] of [
    ['林嘉豪', 'MALE', '信息工程学院'], ['陈思琪', 'FEMALE', '信息工程学院'],
    ['王子轩', 'MALE', '经济管理学院'], ['李雨桐', 'FEMALE', '经济管理学院'],
  ]) {
    const player = await prisma.player.create({ data: { name, gender, affiliation } });
    players.push(player); playerIds.push(player.id);
  }
  const reg1 = await prisma.registration.create({ data: { eventId: event.id, player1Id: players[0].id, player2Id: players[1].id } });
  const reg2 = await prisma.registration.create({ data: { eventId: event.id, player1Id: players[2].id, player2Id: players[3].id } });
  const match = await prisma.match.create({ data: {
    eventId: event.id, venueId: court.id, round: '半决赛', roundNo: 1, matchNo: 1,
    side1Id: reg1.id, side2Id: reg2.id, status: 'LIVE', startedAt: new Date(),
    games: { create: [
      { gameNo: 1, side1Score: 21, side2Score: 17, winnerSide: 1 },
      { gameNo: 2, side1Score: 9, side2Score: 11, server: 2 },
    ] },
  } });

  const created = await call('/broadcasts', tokens.ROOT, {
    method: 'POST', body: { title: '1 号场地直播', tournamentId: ids.tournament, venueId: court.id },
  });
  await call(`/broadcasts/${created.id}`, tokens.ROOT, {
    method: 'PATCH',
    body: {
      configVersion: created.configVersion, currentMatchId: match.id, isPublic: true, status: 'LIVE',
      playbackUrl: 'https://live.example.invalid/live/qa.m3u8',
    },
  });

  const frontend = path.resolve(__dirname, '../../frontend');
  const localRequire = createRequire(path.join(frontend, 'package.json'));
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE
    || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  const sessionContext = async (role, userId) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const name = 'authjs.session-token';
    await context.addCookies([{ name, url: site, value: await encode({
      secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: name,
      token: {
        sub: userId, name: role, role, status: 'ACTIVE',
        accessToken: tokens[role], accessTokenExpiresAt: Date.now() + 3600000,
      },
    }) }]);
    return context;
  };

  // --- OBS overlay: transparent, no global modal, renders the live match ----
  const obs = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const overlayPage = await obs.newPage();
  const overlayErrors = [];
  overlayPage.on('pageerror', (error) => overlayErrors.push(error.message));
  await overlayPage.goto(`${site}/broadcast/overlay/${created.overlayToken}`, { waitUntil: 'domcontentloaded' });
  await overlayPage.getByText('林嘉豪').waitFor({ timeout: 15000 });
  const look = await overlayPage.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundImage,
    bodyColor: getComputedStyle(document.body).backgroundColor,
    scrollX: document.documentElement.scrollWidth > window.innerWidth,
    scrollY: document.documentElement.scrollHeight > window.innerHeight,
    modal: Boolean(document.querySelector('.ant-modal, .global-announcement-modal')),
    path: location.pathname,
  }));
  assert.equal(look.html, 'rgba(0, 0, 0, 0)', 'html 透明');
  assert.equal(look.bodyColor, 'rgba(0, 0, 0, 0)', 'body 透明');
  assert.equal(look.bodyBg, 'none', 'body 无渐变背景');
  assert.equal(look.scrollX || look.scrollY, false, '无滚动条');
  assert.equal(look.modal, false, '无全局公告弹窗');
  assert.ok(look.path.startsWith('/broadcast/overlay/'), '未跳转登录');
  for (const text of ['陈思琪', '王子轩', '李雨桐', '信息工程学院']) await overlayPage.getByText(text).first().waitFor();
  await overlayPage.screenshot({ path: path.join(shots, 'broadcast-overlay.png'), omitBackground: true });

  // Layout: anchored at the default top-left offset, inside the frame, and the
  // two rows' columns line up even though the names differ in width.
  const layout = await overlayPage.evaluate(() => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const board = document.querySelector('[class*="board"]');
    const rows = [...document.querySelectorAll('[class*="row"]')].filter((node) => /(^|_)row(_|$)/.test(node.className.split(' ')[0]));
    const cell = (row, name) => [...row.children].find((child) => child.className.includes(name));
    return {
      board: rect(board),
      rows: rows.map((row) => ({
        score: rect(cell(row, 'score')),
        wins: rect(cell(row, 'gameWins')),
        overflow: [...row.querySelectorAll('[class*="playerName"]')].some((n) => n.scrollWidth > n.clientWidth),
      })),
    };
  });
  assert.equal(layout.rows.length, 2, '两行（双方）');
  assert.equal(Math.round(layout.board.x), 48, '水平偏移 48px');
  assert.equal(Math.round(layout.board.y), 40, '垂直偏移 40px');
  assert.ok(layout.board.x + layout.board.w <= 1920 && layout.board.y + layout.board.h <= 1080, '记分牌在画面内');
  assert.equal(Math.round(layout.rows[0].score.x), Math.round(layout.rows[1].score.x), '比分列对齐');
  assert.equal(Math.round(layout.rows[0].score.w), Math.round(layout.rows[1].score.w), '比分列等宽');
  assert.equal(Math.round(layout.rows[0].wins.x), Math.round(layout.rows[1].wins.x), '局分列对齐');
  assert.ok(layout.rows.every((row) => !row.overflow), '姓名未被截断');
  console.log('overlay layout:', JSON.stringify({ board: layout.board, score: layout.rows.map((r) => r.score) }));

  // Live score push reaches the open overlay board.
  await call(`/matches/${match.id}/score`, tokens.ROOT, {
    method: 'PATCH', body: { games: [{ side1Score: 21, side2Score: 17 }, { side1Score: 10, side2Score: 11 }] },
  });
  await overlayPage.locator('[data-broadcast-overlay="live"]').getByText('10', { exact: true }).first()
    .waitFor({ timeout: 8000 });

  // Rotating the token clears the open board to fully transparent.
  const rotated = await call(`/broadcasts/${created.id}/rotate-overlay-token`, tokens.ROOT, { method: 'POST' });
  await overlayPage.getByText('林嘉豪').waitFor({ state: 'detached', timeout: 10000 });
  assert.equal((await overlayPage.locator('[data-broadcast-overlay]').innerText()).trim(), '', '令牌失效后画面全透明');

  // Disable -> re-enable with the new link: the board clears, then comes back.
  const fresh = await obs.newPage();
  fresh.on('pageerror', (error) => overlayErrors.push(error.message));
  await fresh.goto(`${site}/broadcast/overlay/${rotated.overlayToken}`, { waitUntil: 'domcontentloaded' });
  await fresh.getByText('林嘉豪').waitFor({ timeout: 10000 });
  let state = await call(`/broadcasts/${created.id}`, tokens.ROOT);
  state = await call(`/broadcasts/${created.id}`, tokens.ROOT, {
    method: 'PATCH', body: { configVersion: state.configVersion, enabled: false },
  });
  await fresh.getByText('林嘉豪').waitFor({ state: 'detached', timeout: 10000 });
  await call(`/broadcasts/${created.id}`, tokens.ROOT, {
    method: 'PATCH', body: { configVersion: state.configVersion, enabled: true },
  });
  await fresh.getByText('林嘉豪').waitFor({ timeout: 12000 });
  assert.deepEqual(overlayErrors, []);

  // --- Viewer page: public, no login, scorecard drawn over the video --------
  const viewer = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const viewerPage = await viewer.newPage();
  const viewerErrors = [];
  viewerPage.on('pageerror', (error) => viewerErrors.push(error.message));
  await viewerPage.goto(`${site}/live/${created.id}`, { waitUntil: 'domcontentloaded' });
  await viewerPage.getByText('1 号场地直播').first().waitFor({ timeout: 15000 });
  await viewerPage.getByText('直播中').first().waitFor();
  await viewerPage.getByText('林嘉豪 / 陈思琪').first().waitFor();
  assert.equal(await viewerPage.locator('video').count(), 1);
  assert.ok(viewerPage.url().includes(`/live/${created.id}`), '观众页无需登录');

  const scoreboard = viewerPage.locator('[data-broadcast-overlay="viewer"]');
  await scoreboard.getByText('林嘉豪').waitFor({ timeout: 10000 });
  await scoreboard.getByText('信息工程学院').first().waitFor();
  // The board must fill the video box and be scaled down to fit it.
  const box = await viewerPage.evaluate(() => {
    const board = document.querySelector('[data-broadcast-overlay="viewer"]');
    const frame = board?.parentElement;
    if (!board || !frame) return null;
    const b = board.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(board).transform);
    const video = frame.querySelector('video')?.getBoundingClientRect();
    return {
      scale: matrix.a,
      board: { w: Math.round(b.width), h: Math.round(b.height) },
      frame: { w: Math.round(f.width), h: Math.round(f.height) },
      fitted: Math.abs(b.width - f.width) <= 2 && Math.abs(b.height - f.height) <= 2,
      videoInside: Boolean(video) && video.width <= f.width + 1,
    };
  });
  console.log('viewer overlay:', JSON.stringify(box));
  assert.ok(box, '观众页存在记分牌叠层');
  assert.ok(box.scale > 0 && box.scale < 1, `按视频框缩放（${box.scale}）`);
  assert.equal(box.fitted, true, '记分牌与视频框等大');
  await viewerPage.screenshot({ path: path.join(shots, 'broadcast-viewer.png') });

  // Referee scoring reaches the viewer page without a reload.
  await call(`/matches/${match.id}/score`, tokens.ROOT, {
    method: 'PATCH', body: { games: [{ side1Score: 21, side2Score: 17 }, { side1Score: 12, side2Score: 11 }] },
  });
  await scoreboard.getByText('12', { exact: true }).first().waitFor({ timeout: 10000 });

  // Unpublishing the tournament clears the board for viewers too.
  await prisma.tournament.update({ where: { id: ids.tournament }, data: { isPublished: false } });
  await scoreboard.getByText('林嘉豪').waitFor({ state: 'detached', timeout: 12000 });
  await prisma.tournament.update({ where: { id: ids.tournament }, data: { isPublished: true } });
  assert.deepEqual(viewerErrors, []);

  // Phone-sized viewer: the board still fits inside the video box.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phonePage = await phone.newPage();
  await phonePage.goto(`${site}/live/${created.id}`, { waitUntil: 'domcontentloaded' });
  await phonePage.locator('[data-broadcast-overlay="viewer"]').getByText('林嘉豪').waitFor({ timeout: 15000 });
  const phoneBox = await phonePage.evaluate(() => {
    const board = document.querySelector('[data-broadcast-overlay="viewer"]');
    const f = board.parentElement.getBoundingClientRect();
    const inner = board.querySelector('[class*="board"]').getBoundingClientRect();
    const name = board.querySelector('[class*="playerName"]').getBoundingClientRect();
    return {
      frameW: f.width, right: inner.right - f.left, bottom: inner.bottom - f.top, frameH: f.height,
      nameHeight: name.height,
    };
  });
  console.log('phone viewer:', JSON.stringify(phoneBox));
  assert.ok(phoneBox.nameHeight >= 9, `手机上姓名可读（字高 ${phoneBox.nameHeight}px）`);
  assert.ok(phoneBox.right <= phoneBox.frameW + 1 && phoneBox.bottom <= phoneBox.frameH + 1, '手机上记分牌不超出画面');
  await phonePage.screenshot({ path: path.join(shots, 'broadcast-viewer-phone.png') });

  // --- Admin page: ROOT can use, ADMIN cannot -------------------------------
  const rootContext = await sessionContext('ROOT', ids.root);
  const adminPage = await rootContext.newPage();
  const adminErrors = [];
  adminPage.on('pageerror', (error) => adminErrors.push(error.message));
  await adminPage.goto(`${site}/admin/broadcasts?tournamentId=${ids.tournament}`, { waitUntil: 'domcontentloaded' });
  await adminPage.getByRole('heading', { name: '直播管理' }).waitFor({ timeout: 15000 });
  await adminPage.getByRole('menuitem', { name: /直播管理/ }).waitFor();
  await adminPage.getByText('1 号场地直播').first().click();
  await adminPage.getByText('1 号场地直播 · 直播间配置').waitFor({ timeout: 10000 });
  await adminPage.getByText('记分牌预览').waitFor();
  await adminPage.locator('[data-broadcast-overlay="preview"]').getByText('林嘉豪').waitFor({ timeout: 10000 });
  await adminPage.screenshot({ path: path.join(shots, 'broadcast-admin.png'), fullPage: true });
  assert.deepEqual(adminErrors, []);

  const adminContext = await sessionContext('ADMIN', ids.admin);
  const deniedPage = await adminContext.newPage();
  await deniedPage.goto(`${site}/admin/broadcasts`, { waitUntil: 'domcontentloaded' });
  await deniedPage.waitForTimeout(1500);
  const deniedPath = new URL(deniedPage.url()).pathname;
  const deniedHasEditor = await deniedPage.getByText('新建直播间').count();
  assert.ok(deniedPath !== '/admin/broadcasts' || deniedHasEditor === 0, `普通管理员不可进入直播管理（停在 ${deniedPath}）`);
  assert.equal(await deniedPage.getByRole('menuitem', { name: /直播管理/ }).count(), 0, '普通管理员菜单不显示直播管理');

  console.log(`broadcast ui: OK (screenshots in ${shots})`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    await browser?.close();
    await prisma.broadcastSession.deleteMany({ where: { tournamentId: ids.tournament } });
    await prisma.tournament.deleteMany({ where: { id: ids.tournament } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.root, ids.admin] } } });
    await prisma.$disconnect();
  });
