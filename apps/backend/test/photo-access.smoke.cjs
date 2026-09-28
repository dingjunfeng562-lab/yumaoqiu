/* Run from apps/backend: node test/photo-access.smoke.cjs
 * Uses isolated local database fixtures and removes them in finally.
 * Start the freshly built backend on localhost:4000 before running.
 */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdir, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
const sharp = require('sharp');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const base = 'http://localhost:4000';
const runId = randomUUID();
const tournamentIds = [randomUUID(), randomUUID(), randomUUID()];
const userIds = [];
const fixtureDirectory = path.resolve('uploads', 'photos', tournamentIds[0]);

async function request(endpoint, options = {}, expected = 200) {
  const response = await fetch(`${base}${endpoint}`, options);
  assert.equal(response.status, expected, `${options.method || 'GET'} ${endpoint.split('?')[0]}`);
  return response;
}

async function main() {
  const headers = {};
  const password = `PhotoQa${randomUUID()}!`;
  const passwordHash = await bcrypt.hash(password, 10);
  let adminEmail;
  for (const role of ['ADMIN', 'ROOT', 'PLAYER', 'REFEREE', 'PHOTOGRAPHER']) {
    const id = randomUUID();
    await prisma.user.create({ data: {
      id, username: `photo-test-${role}-${runId}`, email: `${id}@photo-test.invalid`,
      passwordHash, role,
    } });
    userIds.push(id);
    if (role === 'ADMIN') adminEmail = `${id}@photo-test.invalid`;
    headers[role] = { Authorization: `Bearer ${jwt.sign({ sub: id }, { expiresIn: '5m' })}` };
  }
  for (const id of tournamentIds) {
    await prisma.tournament.create({ data: {
      id, name: `图片访问测试 ${runId} ${tournamentIds.indexOf(id) + 1}`, startDate: new Date(), endDate: new Date(),
      coverImageUrl: '/generated/competition-cover-1.png',
    } });
  }
  const fullPath = `photos/${tournamentIds[0]}/full/fixture.jpg`;
  const thumbnailPath = `photos/${tournamentIds[0]}/thumb/fixture.jpg`;
  const buffer = await sharp({ create: {
    width: 32, height: 32, channels: 3, background: '#1677ff',
  } }).jpeg().toBuffer();
  for (const relative of [fullPath, thumbnailPath]) {
    const filename = path.resolve('uploads', relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, buffer);
  }
  const photo = await prisma.photo.create({ data: {
    tournamentId: tournamentIds[0], uploaderId: userIds[0], category: 'MATCH',
    originalPath: fullPath, fullPath, thumbnailPath, fileSize: buffer.length,
    width: 32, height: 32,
  } });
  const endpoint = `/api/admin/competitions/${tournamentIds[0]}/photo-access`;
  await request(endpoint, { method: 'POST' }, 401);
  for (const role of ['PLAYER', 'REFEREE', 'PHOTOGRAPHER']) {
    await request(endpoint, { method: 'POST', headers: headers[role] }, 403);
  }
  const tokens = [];
  for (const role of ['ADMIN', 'ROOT']) {
    const data = await (await request(endpoint, { method: 'POST', headers: headers[role] }, 201)).json();
    tokens.push(data.accessToken);
    assert.equal(data.path, `/photos/${data.accessToken}`);
  }
  assert.equal(new Set(tokens).size, 1, 'Repeated generation must preserve printed QR codes');
  const accessToken = tokens[0];
  const gallery = await (await request(`/api/photos/access/${accessToken}`)).json();
  assert.equal(gallery.id, tournamentIds[0]);
  assert.equal(gallery.photoCount, 1);
  const list = await (await request(`/api/photos?accessToken=${accessToken}`)).json();
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, photo.id);
  await request(`/api/photos?tournamentId=${tournamentIds[0]}`, {}, 400);
  await request('/api/photos/tournaments', {}, 404);
  await request('/api/photos/access/invalid', {}, 404);
  await request(`/api/photos/access/${'f'.repeat(32)}`, {}, 404);

  const other = await (await request(`/api/admin/competitions/${tournamentIds[1]}/photo-access`, {
    method: 'POST', headers: headers.ADMIN,
  }, 201)).json();
  const empty = await (await request(`/api/photos?accessToken=${other.accessToken}`)).json();
  assert.equal(empty.total, 0);
  for (const action of ['thumb', 'view', 'download']) {
    const url = `/api/photos/${photo.id}/${action}`;
    await request(url, {}, 404);
    await request(`${url}?accessToken=invalid`, {}, 404);
    await request(`${url}?accessToken=${other.accessToken}`, {}, 404);
    await request(`${url}?accessToken=${accessToken}`);
  }
  await request(`/api/uploads/${fullPath}`, {}, 404);
  await request(`/api/uploads/${thumbnailPath}`, {}, 404);
  const adminPage = await (await request(`/api/admin/photos?tournamentId=${tournamentIds[0]}`, {
    headers: headers.ADMIN,
  })).json();
  for (const url of [adminPage.items[0].url, adminPage.items[0].thumbUrl]) {
    await request(url);
    const tampered = new URL(url, base);
    tampered.searchParams.set('expires', '1000000000');
    await request(tampered.pathname + tampered.search, {}, 404);
    tampered.searchParams.set('expires', String(Math.floor(Date.now() / 1000) + 10000));
    await request(tampered.pathname + tampered.search, {}, 404);
  }
  console.log('PASS: admin-only generation, stable addresses, cover metadata, isolated galleries, empty gallery, token-required images/downloads, signed admin previews, blocked legacy routes.');

  await prisma.photo.update({ where: { id: photo.id }, data: {
    viewCount: 10, downloadCount: 10, uploadedAt: new Date('2024-01-01'),
  } });
  const popularPhoto = await prisma.photo.create({ data: {
    ...photo, id: randomUUID(), category: 'PLAYER', viewCount: 100, downloadCount: 1,
    uploadedAt: new Date('2022-01-01'),
  } });
  const downloadedPhoto = await prisma.photo.create({ data: {
    ...photo, id: randomUUID(), category: 'AWARD', viewCount: 1, downloadCount: 100,
    uploadedAt: new Date('2023-01-01'),
  } });
  await prisma.photo.create({ data: {
    ...photo, id: randomUUID(), viewCount: 1000, downloadCount: 1000, deletedAt: new Date(),
  } });
  const sortCases = {
    POPULAR: [popularPhoto.id, photo.id, downloadedPhoto.id],
    DOWNLOADS: [downloadedPhoto.id, photo.id, popularPhoto.id],
    LATEST: [photo.id, downloadedPhoto.id, popularPhoto.id],
  };
  for (const [sort, expectedIds] of Object.entries(sortCases)) {
    const sorted = await (await request(`/api/photos?accessToken=${accessToken}&sort=${sort}`)).json();
    assert.deepEqual(sorted.items.map(item => item.id), expectedIds);
    const secondPage = await (await request(`/api/photos?accessToken=${accessToken}&sort=${sort}&page=2&pageSize=1`)).json();
    assert.equal(secondPage.items[0].id, expectedIds[1]);
    const filtered = await (await request(`/api/photos?accessToken=${accessToken}&sort=${sort}&category=PLAYER`)).json();
    assert.deepEqual(filtered.items.map(item => item.id), [popularPhoto.id]);
  }
  await request(`/api/photos?accessToken=${accessToken}&sort=INVALID`, {}, 400);
  console.log('PASS: popular/download/latest ordering, category filters, pagination, deleted-photo exclusion, invalid sort rejection.');

  if (process.argv.includes('--browser')) {
    const { chromium } = require(process.env.PHOTO_QA_PLAYWRIGHT || '../../../.codex-work/photo-access-qa/node_modules/playwright');
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
      const csrf = await (await context.request.get('http://localhost:3000/api/auth/csrf')).json();
      await context.request.post('http://localhost:3000/api/auth/callback/credentials', {
        form: { csrfToken: csrf.csrfToken, loginType: 'email', identifier: adminEmail,
          password, rememberMe: 'false', callbackUrl: 'http://localhost:3000/admin/competitions' },
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://localhost:3000/admin/competitions');
      const row = page.getByRole('row').filter({ hasText: `图片访问测试 ${runId} 3` });
      await row.getByRole('button', { name: '生成图片二维码' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('canvas').waitFor();
      const qrUrl = await dialog.locator('input').inputValue();
      assert.match(qrUrl, /^http:\/\/localhost:3000\/photos\/[a-f0-9]{32}$/);
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '下载二维码' }).click();
      const download = await downloadPromise;
      assert.ok(download.suggestedFilename().endsWith('.png'));
      const output = path.resolve(process.env.PHOTO_QA_OUTPUT || '../../outputs/photo-access-qa');
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'admin-qr.png') });

      const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const mobile = await guest.newPage();
      mobile.on('pageerror', (error) => errors.push(error.message));
      let galleryRequests = 0;
      mobile.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/photos') galleryRequests++;
      });
      await mobile.goto(`http://localhost:3000/photos/${accessToken}`);
      await mobile.getByRole('button', { name: /进入.*照片墙/ }).waitFor();
      assert.equal(galleryRequests, 0, 'Photos should not load before entering the cover');
      await mobile.screenshot({ path: path.join(output, 'mobile-cover.png') });
      await mobile.mouse.click(15, 15);
      await mobile.locator('.photo-card img').first().waitFor();
      await mobile.waitForFunction(() => [...document.querySelectorAll('.photo-card img')].every((image) => image.complete && image.naturalWidth > 0));
      assert.ok(galleryRequests > 0);
      for (const [label, sort, firstId] of [
        ['下载最多', 'DOWNLOADS', downloadedPhoto.id],
        ['最新上传', 'LATEST', photo.id],
        ['热门排行', 'POPULAR', popularPhoto.id],
      ]) {
        const responsePromise = mobile.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname === '/api/photos' && url.searchParams.get('sort') === sort && url.searchParams.get('page') === '1';
        });
        await mobile.getByText(label, { exact: true }).click();
        await responsePromise;
        await mobile.waitForFunction(id => document.querySelector('.photo-card img')?.getAttribute('src')?.includes(id), firstId);
        const cardPositions = await mobile.locator('.photo-card').evaluateAll(cards => cards.slice(0, 3).map((card) => {
          const rect = card.getBoundingClientRect();
          return { left: Math.round(rect.left), top: Math.round(rect.top) };
        }));
        assert.equal(cardPositions.length, 3);
        assert.ok(Math.abs(cardPositions[0].top - cardPositions[1].top) <= 1, `${sort}: first row must flow left to right`);
        assert.ok(cardPositions[1].left > cardPositions[0].left, `${sort}: second photo must be to the right of the first`);
        assert.ok(cardPositions[2].top > cardPositions[0].top, `${sort}: third photo must continue on the next row`);
        assert.ok(Math.abs(cardPositions[2].left - cardPositions[0].left) <= 1, `${sort}: next row must restart on the left`);
      }
      assert.equal(await mobile.getByRole('tab').count(), 0, 'No cross-tournament tabs');
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.deepEqual(await mobile.locator('h1').evaluate((heading) => ({
        align: getComputedStyle(heading).textAlign,
        size: getComputedStyle(heading).fontSize,
      })), { align: 'center', size: '20px' });
      await mobile.screenshot({ path: path.join(output, 'mobile-gallery.png') });
      await mobile.setViewportSize({ width: 1440, height: 1000 });
      assert.equal(await mobile.locator('h1').evaluate((heading) => getComputedStyle(heading).fontSize), '36px');
      assert.equal(await mobile.locator('h1').evaluate((heading) => getComputedStyle(heading).textAlign), 'center');
      await mobile.setViewportSize({ width: 390, height: 844 });
      await mobile.reload();
      await mobile.getByRole('button', { name: /进入.*照片墙/ }).waitFor();
      await mobile.goto(qrUrl);
      await mobile.getByRole('button', { name: /进入.*照片墙/ }).click();
      await mobile.getByText('该分类下暂无图片', { exact: true }).waitFor();
      await mobile.goto('http://localhost:3000/photos/invalid');
      await mobile.getByText('无法访问赛事图片').waitFor();
      const oldPage = await mobile.goto('http://localhost:3000/photos');
      assert.equal(oldPage.status(), 404);
      await mobile.goto('http://localhost:3000/');
      assert.equal(await mobile.getByRole('link', { name: '赛事图片', exact: true }).count(), 0);
      assert.deepEqual(errors, [], 'Browser page errors');
      console.log('PASS: browser admin QR generation/download, anonymous mobile cover, tap anywhere, real photo load, no cross-event tabs, refresh-to-cover, empty/invalid links, removed homepage entry.');
    } finally {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.tournament.deleteMany({ where: { id: { in: tournamentIds }, name: { startsWith: `图片访问测试 ${runId}` } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  const allowedRoot = path.resolve('uploads', 'photos') + path.sep;
  assert.ok(fixtureDirectory.startsWith(allowedRoot));
  assert.equal(path.basename(fixtureDirectory), tournamentIds[0]);
  await rm(fixtureDirectory, { recursive: true, force: true });
  await prisma.$disconnect();
  console.log('Removed isolated test users, tournaments, and image fixtures.');
});
