const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

exports.browserChecks = async ({ base, token, adminA, rootPeer, root, ta, tb, request }) => {
  const frontend = path.resolve(__dirname, '../../frontend');
  const env = require('dotenv').parse(fs.readFileSync(path.join(frontend, '.env.local')));
  const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt', { paths: [frontend] })).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const output = path.resolve(__dirname, '../test-output/admin-permissions-qa');
  fs.mkdirSync(output, { recursive: true });
  const contexts = [];
  const origin = process.env.FRONTEND_QA_URL || 'http://localhost:3000';
  const makePage = async (user) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    contexts.push(context);
    const cookie = 'authjs.session-token';
    const session = await encode({ secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET, salt: cookie, token: {
      sub: user.id, name: user.username, username: user.username, email: user.email,
      role: user.role, status: 'ACTIVE', accessToken: token(user), accessTokenExpiresAt: Date.now() + 3600000,
    } });
    await context.addCookies([{ name: cookie, value: session, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    // Only transport is redirected; every API response comes from the real
    // application and local database used by the smoke suite.
    await context.route(`${env.NEXT_PUBLIC_API_URL}/**`, async (route) => {
      const target = route.request().url().replace(env.NEXT_PUBLIC_API_URL, base);
      const response = await route.fetch({ url: target });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`Browser page error: ${error.message}`));
    page.on('response', (response) => {
      if (/\/auth\/me$|\/tournaments$/.test(response.url())) console.log(`Browser API: ${response.status()} ${response.url()}`);
    });
    page.setDefaultTimeout(20000);
    return page;
  };
  try {
    const adminPage = await makePage(adminA);
    await adminPage.goto(`${origin}/admin/tournaments`);
    await adminPage.waitForLoadState('domcontentloaded');
    if (await adminPage.getByRole('cell', { name: ta.name, exact: true }).count() === 0) {
      await adminPage.screenshot({ path: path.join(output, 'admin-tournaments-diagnostic.png'), fullPage: true });
      console.log(`Browser diagnostic URL: ${adminPage.url()}`);
    }
    try {
      await adminPage.getByRole('cell', { name: ta.name, exact: true }).waitFor();
    } catch (error) {
      console.log(`Browser final URL: ${adminPage.url()}`);
      console.log((await adminPage.locator('body').innerText()).slice(0, 2000));
      await adminPage.screenshot({ path: path.join(output, 'admin-tournaments-diagnostic.png'), fullPage: true });
      throw error;
    }
    assert.equal(await adminPage.getByRole('cell', { name: tb.name, exact: true }).count(), 0);
    const menu = await adminPage.locator('.admin-navigation-panel').first().innerText();
    for (const item of ['AI 助手配置', '公告管理', '图片审核', '抽签编排', '裁判分配', '邮件通知设置']) assert(!menu.includes(item));
    for (const item of ['用户管理', '邀请码管理', '选手管理']) assert(menu.includes(item));
    await adminPage.screenshot({ path: path.join(output, 'admin-tournaments.png'), fullPage: true });
    await adminPage.goto(`${origin}/admin/invite-codes`);
    await adminPage.getByText('裁判 / 图片员共享名额', { exact: true }).waitFor();
    await adminPage.getByText(/累计已使用 5/).waitFor();
    await adminPage.screenshot({ path: path.join(output, 'admin-quota.png'), fullPage: true });
    await adminPage.goto(`${origin}/admin/exports`);
    await adminPage.getByRole('button', { name: '导出 秩序册' }).waitFor();
    assert.equal(await adminPage.getByRole('button', { name: '导出 成绩册' }).count(), 0);
    await adminPage.goto(`${origin}/admin/ai-config`);
    await adminPage.waitForURL('**/forbidden');
    await adminPage.goto(`${origin}/competitions`);
    await adminPage.getByText(ta.name, { exact: true }).first().waitFor();
    await adminPage.getByText(tb.name, { exact: true }).first().waitFor();

    const rootPage = await makePage(rootPeer);
    await rootPage.goto(`${origin}/admin/users`);
    const row = rootPage.getByRole('row').filter({ hasText: adminA.username });
    await row.getByRole('button', { name: '分配名额' }).click();
    const dialog = rootPage.getByRole('dialog');
    await dialog.getByRole('spinbutton').fill('7');
    const quotaSaved = superPage.waitForResponse((res) => res.url().includes('/invite-quota') && res.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: /确.*定|OK/ }).click();
    assert.equal((await quotaSaved).status(), 200);
    await dialog.waitFor({ state: 'hidden' });
    assert.equal((await request(adminA, 'GET', '/auth/invite-quota')).limit, 7);
    await rootPage.screenshot({ path: path.join(output, 'super-admin-quota-allocation.png'), fullPage: true });

    await row.getByRole('button', { name: '功能权限' }).click();
    const permissionsDialog = rootPage.getByRole('dialog');
    await permissionsDialog.getByRole('switch').click();
    await permissionsDialog.getByRole('checkbox', { name: 'AI 助手配置' }).check();
    const permissionSaved = rootPage.waitForResponse((res) => res.url().includes(`/users/${adminA.id}/permissions`) && res.request().method() === 'PATCH');
    await permissionsDialog.getByRole('button', { name: '保存权限' }).click();
    assert.equal((await permissionSaved).status(), 200);
    await permissionsDialog.waitFor({ state: 'hidden' });
    await adminPage.goto(`${origin}/admin/ai-config`);
    await adminPage.getByText('AI 助手配置', { exact: true }).first().waitFor();
    await adminPage.screenshot({ path: path.join(output, 'admin-custom-ai-permission.png'), fullPage: true });
    await request(rootPeer, 'PATCH', `/auth/users/${adminA.id}/permissions`, { permissions: null });

    await rootPage.goto(`${origin}/admin/image-moderation`);
    await rootPage.getByRole('button', { name: '保存设置' }).waitFor();
    assert.equal(await rootPage.getByRole('button', { name: '保存设置' }).isDisabled(), false);
    const primaryRootPage = await makePage(root);
    await primaryRootPage.goto(`${origin}/admin/users`);
    await primaryRootPage.getByRole('row').filter({ hasText: adminA.username }).getByRole('button', { name: '功能权限' }).waitFor();
    return 19;
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
};
