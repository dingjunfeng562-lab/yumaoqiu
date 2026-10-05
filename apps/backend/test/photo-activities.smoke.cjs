// Build and sync the local test database first.
require('dotenv/config');
require('reflect-metadata');
const assert = require('node:assert/strict');
const { existsSync, readFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const { AppModule } = require('../dist/app.module');
const { ImageModerationService } = require('../dist/image-moderation/image-moderation.service');
const { EmailReminderService } = require('../dist/mail/email-reminder.service');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  assert(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'Only run against a local database');
  const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
  const prefix = `pa${Date.now().toString(36)}`;
  const password = 'QaPass2026Only';
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#1677ff' } }).png().toBuffer();
  const paths = new Set();
  let app;
  let moderationCalls = 0;
  let checks = 0;
  const credentials = (suffix) => ({ username: `${prefix}${suffix}`, email: `${prefix}${suffix}@example.test`, password });
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailReminderService).useValue({})
      .overrideProvider(ImageModerationService).useValue({ assertAllowed: async () => { moderationCalls++; } })
      .compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    const jwt = app.get(JwtService);
    const rootInput = credentials('root');
    const root = await db.user.create({ data: { username: rootInput.username, email: rootInput.email, passwordHash: await bcrypt.hash(password, 4), role: 'ROOT' } });
    const token = (user) => jwt.sign({ sub: user.id, role: user.role });
    const request = async (actor, method, path, body, status = 200) => {
      const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${token(actor)}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => ({}));
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); checks++;
      return data;
    };
    const multipart = async (actor, method, path, fields, status = 201) => {
      const body = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        if (value instanceof Blob) body.append(key, value, `${key}.png`); else body.append(key, String(value));
      }
      const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token(actor)}` }, body });
      const data = await response.json().catch(() => ({}));
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`); checks++;
      return data;
    };
    const admin = await request(root, 'POST', '/auth/users/admin', credentials('admin'), 201);
    const otherAdmin = await request(root, 'POST', '/auth/users/admin', credentials('other'), 201);
    const rootActivity = await multipart(root, 'POST', '/admin/photo-activities', {
      title: `${prefix}超级活动`, dateMode: 'SINGLE', startAt: '2026-10-05T08:09:10.000Z', cover: new Blob([png], { type: 'image/png' }),
    });
    assert.equal(rootActivity.approvalStatus, 'APPROVED');
    assert.equal(new Date(rootActivity.startAt).getUTCMilliseconds(), 0);
    const adminActivity = await multipart(admin, 'POST', '/admin/photo-activities', {
      title: `${prefix}管理员活动`, dateMode: 'RANGE', startAt: '2026-10-06T01:02:03.000Z', endAt: '2026-10-07T04:05:06.000Z', cover: new Blob([png], { type: 'image/png' }),
    });
    assert.equal(adminActivity.approvalStatus, 'PENDING');
    await request(admin, 'POST', `/admin/photo-activities/${adminActivity.id}/photo-access`, {}, 400);
    await request(admin, 'PATCH', `/admin/photo-activities/${adminActivity.id}/approve`, {}, 403);
    await request(otherAdmin, 'GET', `/admin/photo-activities/${adminActivity.id}`, undefined, 404);
    assert.deepEqual((await request(admin, 'GET', '/admin/photo-activities')).map((item) => item.id), [adminActivity.id]);
    assert((await request(root, 'GET', '/admin/photo-activities')).some((item) => item.id === adminActivity.id));
    await request(root, 'PATCH', `/admin/photo-activities/${adminActivity.id}/approve`, {});
    const access = await request(admin, 'POST', `/admin/photo-activities/${adminActivity.id}/photo-access`, {}, 201);
    assert.match(access.accessToken, /^[A-Za-z0-9_-]{32}$/);

    await multipart(admin, 'POST', `/admin/photo-activities/${adminActivity.id}/watermark/logos`, { file: new Blob([png], { type: 'image/png' }) });
    const uploaded = await multipart(admin, 'POST', `/admin/photo-activities/${adminActivity.id}/photos`, { category: 'MATCH', photos: new Blob([png], { type: 'image/png' }) });
    assert.equal(uploaded.uploaded, 1);
    const gallery = await request(null, 'GET', `/photos/access/${access.accessToken}`);
    assert.equal(gallery.scope, 'activity');
    assert.equal(gallery.name, adminActivity.title);
    assert.equal(gallery.photoCount, 1);
    const publicPhotos = await request(null, 'GET', `/photos?accessToken=${access.accessToken}&sort=LATEST`);
    assert.equal(publicPhotos.items.length, 1);
    const adminPhotos = await request(admin, 'GET', `/admin/photos?activityId=${adminActivity.id}`);
    assert.equal(adminPhotos.items.length, 1);
    await request(otherAdmin, 'GET', `/admin/photos?activityId=${adminActivity.id}`, undefined, 200).then((page) => assert.equal(page.items.length, 0));
    await request(otherAdmin, 'DELETE', `/admin/photos/${adminPhotos.items[0].id}`, undefined, 404);
    assert.equal(moderationCalls, 4, 'covers, logo and photo must all use AI moderation');
    if (process.argv.includes('--browser')) {
      const frontend = resolve(__dirname, '../../frontend');
      const env = require('dotenv').parse(readFileSync(join(frontend, '.env.local')));
      const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt', { paths: [frontend] })).href);
      const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
      const browser = await chromium.launch({ channel: 'msedge', headless: true });
      const contexts = [];
      const makePage = async (user, viewport) => {
        const context = await browser.newContext({ viewport }); contexts.push(context);
        const cookie = 'authjs.session-token';
        const session = await encode({ secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET, salt: cookie, token: {
          sub: user.id, name: user.username, username: user.username, email: user.email,
          role: user.role, status: 'ACTIVE', accessToken: token(user), accessTokenExpiresAt: Date.now() + 3600000,
        } });
        await context.addCookies([{ name: cookie, value: session, url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' }]);
        await context.route(`${env.NEXT_PUBLIC_API_URL}/**`, async (route) => {
          const response = await route.fetch({ url: route.request().url().replace(env.NEXT_PUBLIC_API_URL, base) });
          await route.fulfill({ response });
        });
        return context.newPage();
      };
      try {
        const rootPage = await makePage(root, { width: 1440, height: 960 });
        await rootPage.goto('http://localhost:3000/admin/photo-activities');
        await rootPage.getByRole('heading', { name: '活动图片' }).waitFor();
        await rootPage.getByText(rootActivity.title, { exact: true }).waitFor();
        await rootPage.getByText(adminActivity.title, { exact: true }).waitFor();
        await rootPage.getByRole('button', { name: '新建活动' }).click();
        const dialog = rootPage.getByRole('dialog');
        await dialog.getByLabel('活动名称').waitFor();
        await dialog.getByText('指定日期', { exact: true }).waitFor();
        await dialog.getByText('日期范围', { exact: true }).waitFor();
        await dialog.getByText(/图片 AI 审核/).waitFor();
        await rootPage.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });

        const adminPage = await makePage(admin, { width: 390, height: 844 });
        await adminPage.goto('http://localhost:3000/admin/photo-activities');
        await adminPage.getByText(adminActivity.title, { exact: true }).waitFor();
        assert.equal(await adminPage.getByText(rootActivity.title, { exact: true }).count(), 0);
        const row = adminPage.getByRole('row').filter({ hasText: adminActivity.title });
        await row.getByRole('button', { name: '图片管理' }).waitFor();
        await row.getByRole('button', { name: 'Logo 设置' }).waitFor();
        await row.getByRole('button', { name: '查看二维码' }).waitFor();
        await row.getByRole('button', { name: '图片管理' }).click();
        await adminPage.getByRole('heading', { name: `图片管理 · ${adminActivity.title}` }).waitFor();
        await adminPage.getByRole('button', { name: '上传图片' }).waitFor();
        await adminPage.goto('http://localhost:3000/admin/photo-activities');
        const refreshedRow = adminPage.getByRole('row').filter({ hasText: adminActivity.title });
        await refreshedRow.getByRole('button', { name: 'Logo 设置' }).click();
        await adminPage.getByRole('heading', { name: '水印设置' }).waitFor();
        await adminPage.getByText('Logo 列表', { exact: true }).waitFor();
        checks += 16;
      } finally {
        for (const context of contexts) await context.close();
        await browser.close();
      }
    }
    console.log(`PASS: ${checks} activity photo creation, approval, ownership, moderation, QR and gallery checks.`);

    for (const activity of [rootActivity, adminActivity]) {
      const filename = activity.coverImageUrl?.split('/').pop();
      if (filename) paths.add(join(process.cwd(), 'uploads', 'covers', filename));
    }
    const photoRows = await db.photo.findMany({ where: { activityId: { in: [rootActivity.id, adminActivity.id] } } });
    photoRows.forEach((photo) => [photo.originalPath, photo.fullPath, photo.thumbnailPath].forEach((path) => paths.add(join(process.cwd(), 'uploads', path))));
    const watermarks = await db.photoActivityWatermark.findMany({ where: { activityId: { in: [rootActivity.id, adminActivity.id] } } });
    watermarks.forEach((watermark) => Array.isArray(watermark.logos) && watermark.logos.forEach((logo) => paths.add(join(process.cwd(), 'uploads', logo.path))));
  } finally {
    if (app) await app.close();
    const activities = await db.photoActivity.findMany({
      where: { title: { startsWith: prefix } },
      include: { photos: true, watermark: true },
    });
    for (const activity of activities) {
      const cover = activity.coverImageUrl?.split('/').pop();
      if (cover) paths.add(join(process.cwd(), 'uploads', 'covers', cover));
      activity.photos.forEach((photo) => [photo.originalPath, photo.fullPath, photo.thumbnailPath]
        .forEach((path) => paths.add(join(process.cwd(), 'uploads', path))));
      if (Array.isArray(activity.watermark?.logos)) activity.watermark.logos.forEach((logo) => {
        if (logo && typeof logo === 'object' && typeof logo.path === 'string') paths.add(join(process.cwd(), 'uploads', logo.path));
      });
      paths.add(join(process.cwd(), 'uploads', 'photos', activity.id));
    }
    await db.photoActivity.deleteMany({ where: { title: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix } } });
    await db.$disconnect();
    paths.forEach((path) => { if (existsSync(path)) rmSync(path, { recursive: true, force: true }); });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
