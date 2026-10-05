// Real API/DB/browser acceptance for the single room QR and phone recovery.
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Local test database required');
const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const api = process.env.QA_API_URL || 'http://127.0.0.1:4000/api';
const site = process.env.QA_SITE_URL || 'http://localhost:3000';
const ids = { root: randomUUID(), tournament: randomUUID(), device: randomUUID() };
const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: ids.root }, { expiresIn: '20m' });
let browser, page, roomId;
async function call(endpoint, body, credential = token, method = body === undefined ? 'GET' : 'POST', expected = 200) {
  const response = await fetch(api + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  assert.ok(response.status === expected || expected === 200 && response.status === 201, `${endpoint}: ${response.status} ${result.message || ''}`);
  return result;
}
async function openQr(page) {
  await page.getByRole('button', { name: '配对二维码', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '配对手机摄像端' });
  await modal.waitFor();
  await modal.getByText('手机不方便扫码？手动输入').click();
  const code = await modal.getByRole('textbox', { name: '摄像端配对码' }).inputValue();
  assert.ok(code.startsWith('live_room_'));
  assert.equal(await modal.locator('canvas, svg').count() > 0, true);
  await modal.getByRole('button', { name: '手机已连上' }).click();
  await modal.waitFor({ state: 'hidden' });
  return code;
}
async function main() {
  await db.user.create({ data: { id: ids.root, username: `qr-ui-${ids.root}`, email: `${ids.root}@test.invalid`, passwordHash: 'unused', role: 'ROOT' } });
  await db.tournament.create({ data: { id: ids.tournament, name: '统一二维码验收赛事', startDate: new Date(), endDate: new Date(), status: 'ONGOING', approvalStatus: 'APPROVED', isPublished: true, submittedById: ids.root } });
  const created = await call('/broadcasts', { title: '统一二维码验收直播间', tournamentId: ids.tournament });
  roomId = created.id;
  const frontend = path.resolve(__dirname, '../../frontend');
  const localRequire = createRequire(path.join(frontend, 'package.json'));
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'authjs.session-token', url: site, value: await encode({ secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
    salt: 'authjs.session-token', token: { sub: ids.root, name: 'ROOT', role: 'ROOT', status: 'ACTIVE', accessToken: token, accessTokenExpiresAt: Date.now() + 3600000 } }) }]);
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/auth/')) return route.continue();
    return route.continue({ url: api.replace(/\/api$/, '') + url.pathname + url.search });
  });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${site}/admin/broadcasts?tournamentId=${ids.tournament}`);
  await page.getByRole('button', { name: /^配\s*置$/ }).click();
  await page.getByRole('combobox', { name: '机位数量' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成配对码', exact: true }).count(), 0);
  const first = await openQr(page);
  assert.equal((await call(`/broadcasts/${roomId}/live`)).cameras.length, 1);
  assert.equal(await openQr(page), first);
  const joined = await call('/live-camera/redeem', { code: first, deviceId: ids.device }, null);
  assert.equal((await call('/live-camera/redeem', { code: first, deviceId: ids.device }, null)).credential, joined.credential);
  await page.reload();
  await page.getByRole('button', { name: /^配\s*置$/ }).click();
  assert.equal(await openQr(page), first);
  const shots = path.resolve(__dirname, '../../../output/playwright');
  await mkdir(shots, { recursive: true });
  await page.getByRole('button', { name: '配对二维码', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(shots, 'camera-pairing-admin.png'), fullPage: true });
  await page.goto(`${site}/director/${roomId}`);
  assert.equal(await openQr(page), first);
  assert.equal(await page.getByRole('button', { name: /生成配对码|重新配对/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '解除配对', exact: true }).count(), 1);
  await page.getByRole('button', { name: '重置二维码', exact: true }).click();
  await page.getByRole('button', { name: /^重\s*置$/ }).click();
  const modal = page.getByRole('dialog', { name: '配对手机摄像端' });
  await modal.waitFor();
  await modal.getByText('手机不方便扫码？手动输入').click();
  const rotated = await modal.getByRole('textbox', { name: '摄像端配对码' }).inputValue();
  assert.notEqual(rotated, first);
  await modal.getByRole('button', { name: '手机已连上' }).click();
  const recovered = await call('/live-camera/redeem', { code: rotated, deviceId: ids.device }, null);
  assert.equal(recovered.cameraId, joined.cameraId);
  await call('/live-camera/config', undefined, joined.credential, 'GET', 401);
  assert.equal((await call('/live-camera/config', undefined, recovered.credential)).cameraId, joined.cameraId);
  await call('/live-camera/redeem', { code: first, deviceId: randomUUID() }, null, 'POST', 401);
  await page.getByRole('button', { name: '解除配对', exact: true }).click();
  await page.locator('.ant-popconfirm').getByRole('button', { name: '解除配对', exact: true }).click();
  await page.getByText('已释放机位，新手机可扫描直播间二维码接入', { exact: true }).waitFor();
  const replacement = await call('/live-camera/redeem', { code: rotated, deviceId: randomUUID() }, null);
  assert.equal(replacement.cameraId, joined.cameraId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '配对二维码', exact: true }).scrollIntoViewIfNeeded();
  const box = await page.getByRole('button', { name: '配对二维码', exact: true }).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  assert.equal(await openQr(page), rotated);
  await page.screenshot({ path: path.join(shots, 'camera-pairing-phone.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: management/director share one QR across reload, one-camera enable, explicit reset, phone recovery, replacement via same QR, mobile controls, no browser errors');
}
main().catch(async (error) => {
  console.error(error);
  if (page) {
    console.error('Page:', page.url(), (await page.locator('body').innerText()).slice(0, 1600));
    await page.screenshot({ path: path.resolve(__dirname, '../../../output/playwright/camera-pairing-failure.png'), fullPage: true });
  }
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  if (roomId) await call(`/broadcasts/${roomId}`, undefined, token, 'DELETE').catch(() => {});
  await db.tournament.deleteMany({ where: { id: ids.tournament } });
  await db.user.deleteMany({ where: { id: ids.root } });
  await db.$disconnect();
});
