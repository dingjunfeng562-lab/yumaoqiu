/* Run from apps/backend: node test/image-moderation.smoke.cjs [--browser]
 * Uses disposable users; never changes saved moderation settings.
 * A configured key is tested with one synthetic image (normal provider billing).
 */
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdir, rm } = require('node:fs/promises');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const { JwtService } = require('@nestjs/jwt');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const jwt = new JwtService({ secret: process.env.JWT_SECRET });
const base = 'http://localhost:4000/api/admin/image-moderation';
const userIds = [];
const runId = randomUUID();
const tournamentIds = [];
const coverFiles = [];

async function main() {
  const password = `ModerationQa${randomUUID()}!`;
  const passwordHash = await bcrypt.hash(password, 10);
  const accounts = {};
  for (const role of ['ROOT', 'ADMIN', 'PHOTOGRAPHER', 'PLAYER', 'REFEREE']) {
    const id = randomUUID();
    const email = `${id}@moderation-test.invalid`;
    await prisma.user.create({ data: { id, username: `moderation-${role}-${runId}`, email, passwordHash, role } });
    userIds.push(id);
    accounts[role] = { email, headers: { Authorization: `Bearer ${jwt.sign({ sub: id }, { expiresIn: '10m' })}` } };
  }
  assert.equal((await fetch(base)).status, 401);
  for (const role of ['ADMIN', 'PHOTOGRAPHER', 'PLAYER', 'REFEREE']) {
    for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['POST', '/test']]) {
      const res = await fetch(base + suffix, {
        method, headers: { ...accounts[role].headers, 'Content-Type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{}' }),
      });
      assert.equal(res.status, 403, `${role} must not access ${method} ${suffix}`);
    }
  }
  const rootResponse = await fetch(base, { headers: accounts.ROOT.headers });
  assert.equal(rootResponse.status, 200);
  const config = await rootResponse.json();
  assert.equal('apiKey' in config, false);
  assert.equal(config.modelName, 'deepseek-flash');
  const invalid = await fetch(base, {
    method: 'PATCH', headers: { ...accounts.ROOT.headers, 'Content-Type': 'application/json' }, body: '{"enabled":"false"}',
  });
  assert.equal(invalid.status, 400);
  console.log('PASS: real JWT authentication, ROOT-only read/write/test, configuration validation, no key in responses.');

  if (process.argv.includes('--strict-qr')) {
    assert.equal(config.enabled, true, 'Enable moderation before running strict-QR checks');
    const matrix = require('./fixtures/qr-matrix.json');
    const blocks = matrix.flatMap((row, y) => [...row].map((cell, x) => cell === '1'
      ? `<rect x="${(x + 4) * 8}" y="${(y + 4) * 8}" width="8" height="8"/>` : '')).join('');
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="328" height="328"><rect width="328" height="328" fill="white"/><g fill="#934fa3">${blocks}</g></svg>`)).png().toBuffer();
    const tournamentId = randomUUID();
    await prisma.tournament.create({ data: { id: tournamentId, name: `二维码拦截测试 ${runId}`, startDate: new Date(), endDate: new Date() } });
    tournamentIds.push(tournamentId);
    for (const role of ['ROOT', 'PHOTOGRAPHER']) {
      const form = new FormData();
      form.append('photos', new Blob([png], { type: 'image/png' }), 'synthetic-qr.png');
      form.append('category', 'MATCH');
      form.append('tournamentId', tournamentId);
      const url = role === 'ROOT' ? `/admin/tournaments/${tournamentId}/photos` : '/photographer/upload';
      const response = await fetch(`http://localhost:4000/api${url}`, { method: 'POST', headers: accounts[role].headers, body: form });
      const result = await response.json();
      assert.equal(result.uploaded, 0, `${role} QR must not be saved`);
      assert.match(result.failed?.[0]?.reason || '', /二维码/);
    }
    for (const url of [`/admin/tournaments/${tournamentId}/watermark/logos`, '/tournaments/upload-cover']) {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic-qr.png');
      const response = await fetch(`http://localhost:4000/api${url}`, { method: 'POST', headers: accounts.ROOT.headers, body: form });
      const result = await response.json();
      if (url.endsWith('upload-cover') && result.filename && /^[a-zA-Z0-9.-]+$/.test(result.filename)) coverFiles.push(result.filename);
      assert.equal(response.status, 400, `${url} must reject QR`);
      assert.match(result.message, /二维码/);
    }
    assert.equal(await prisma.photo.count({ where: { tournamentId } }), 0);
    console.log('PASS: actual admin + photographer uploads, logo + cover endpoints all reject QR; no photo rows saved.');
  }

  if (config.hasApiKey && !process.argv.includes('--skip-live')) {
    const response = await fetch(`${base}/test`, {
      method: 'POST', headers: { ...accounts.ROOT.headers, 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(45_000),
    });
    const result = await response.json();
    if (response.ok && result.success) console.log(`PASS: live DeepSeek image + JSON connection (${result.latencyMs}ms).`);
    else {
      console.log(`UNVERIFIED: live DeepSeek test returned HTTP ${response.status}; ${result.message || 'test failed'}`);
      process.exitCode = 1;
    }
  } else console.log('SKIPPED: live DeepSeek call; no key configured or --skip-live requested.');

  if (process.argv.includes('--browser')) {
    const { chromium } = require('../../../.codex-work/photo-access-qa/node_modules/playwright');
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
      async function login(role, viewport) {
        const context = await browser.newContext({ viewport });
        const csrf = await (await context.request.get('http://localhost:3000/api/auth/csrf')).json();
        await context.request.post('http://localhost:3000/api/auth/callback/credentials', {
          form: { csrfToken: csrf.csrfToken, loginType: 'email', identifier: accounts[role].email,
            password, rememberMe: 'false', callbackUrl: 'http://localhost:3000/admin' },
        });
        return context;
      }
      const context = await login('ROOT', { width: 1440, height: 1100 });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('http://localhost:3000/admin');
      await page.getByRole('button', { name: '图片审核设置' }).click();
      await page.getByRole('switch').waitFor();
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), String(config.enabled));
      assert.equal(await page.getByLabel('DeepSeek API Key').inputValue(), '');

      // Exercise save/toggle UX with a browser-local response: never disable the running service.
      const requested = [];
      await page.route('**/api/admin/image-moderation', async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        const body = route.request().postDataJSON();
        requested.push(body);
        await route.fulfill({ json: { ...config, enabled: body.enabled } });
      });
      await page.getByRole('switch').click();
      if (!config.enabled && !config.hasApiKey) await page.getByLabel('DeepSeek API Key').fill('sk-ui-test-not-saved');
      await page.getByText('有未保存的修改', { exact: true }).waitFor();
      await page.getByRole('button', { name: '保存设置' }).click();
      await page.getByText('有未保存的修改', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal(requested.length, 1);
      assert.equal(requested[0].enabled, !config.enabled);
      await page.unroute('**/api/admin/image-moderation');
      await page.reload();
      await page.getByRole('switch').waitFor();
      assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), String(config.enabled));
      const output = path.resolve('../../outputs/image-moderation-qa');
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: '打开后台菜单' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      const restricted = await login('ADMIN', { width: 1440, height: 1000 });
      const deniedPage = await restricted.newPage();
      await deniedPage.goto('http://localhost:3000/admin/image-moderation');
      await deniedPage.getByText('仅超级管理员可设置图片审核', { exact: true }).waitFor();
      assert.equal(await deniedPage.getByRole('menuitem', { name: '图片审核', exact: true }).count(), 0);
      assert.deepEqual(errors, [], 'Browser runtime errors');
      console.log('PASS: ROOT dashboard button + settings page, toggle/save UX, saved-state reload, hidden key, mobile layout, denied ADMIN page.');
    } finally { await browser.close(); }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  for (const id of tournamentIds) {
    await prisma.tournament.deleteMany({ where: { id, name: `二维码拦截测试 ${runId}` } });
    const fixture = path.resolve('uploads/photos', id);
    assert.equal(path.dirname(fixture), path.resolve('uploads/photos'));
    assert.equal(path.basename(fixture), id);
    await rm(fixture, { recursive: true, force: true });
  }
  for (const filename of coverFiles) {
    const fixture = path.resolve('uploads/covers', filename);
    assert.equal(path.dirname(fixture), path.resolve('uploads/covers'));
    await rm(fixture, { force: true });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds }, email: { endsWith: '@moderation-test.invalid' } } });
  await prisma.$disconnect();
  console.log('Removed only disposable moderation test users; saved moderation settings were not changed.');
});
