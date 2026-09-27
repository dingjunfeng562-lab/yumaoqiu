const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/baishuwan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// Only synthetic data in an isolated browser; all business API requests are mocked.
async function main() {
  const frontend = path.resolve(__dirname, '../..');
  const localRequire = createRequire(path.join(frontend, 'package.json'));
  createRequire(localRequire.resolve('next/package.json'))('@next/env').loadEnvConfig(frontend);
  const { encode } = await import(pathToFileURL(localRequire.resolve('next-auth/jwt')).href);
  const cookieName = 'authjs.session-token';
  const cookie = await encode({
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET, salt: cookieName,
    token: { sub: 'layout-preview', name: '排版预览', role: 'ADMIN', accessToken: 'layout-fixture', accessTokenExpiresAt: Date.now() + 3600000 },
  });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: cookieName, value: cookie, url: 'http://localhost:3000' }]);
    const fixture = Array.from({ length: 3 }, (_, i) => ({
      id: `layout-${i}`, title: ['2026 年秋季校园羽毛球公开赛暨新生友谊邀请赛', '院系羽毛球联赛', '夏季羽毛球双打邀请赛'][i],
      startDate: '2026-09-26', endDate: '2026-10-02', location: i === 0 ? '大学城综合体育中心一号馆及室外训练场' : '学校体育馆',
      events: i === 0 ? ['男子单打', '女子单打', '男子双打', '女子双打', '混合双打'] : ['男子单打', '女子单打'],
      isPublished: i === 0, isArchived: i === 2, approvalStatus: i === 1 ? 'PENDING' : 'APPROVED',
      statusLabel: '进行中', registrationStatus: i === 2 ? '报名结束' : '报名中', photoAccessEnabled: i === 0,
      counts: { all: 1300, pending: 12, approved: 1280, rejected: 8, removed: 0 },
    }));
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/session') return route.continue();
      if (url.pathname === '/api/admin/competitions') return route.fulfill({ json: fixture });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { role: 'ADMIN' } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [label, width, height] of [['desktop', 1440, 1000], ['laptop', 1280, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.goto('http://localhost:3000/admin/competitions');
      await page.getByText(fixture[0].title, { exact: true }).waitFor();
      await page.screenshot({ path: path.join(__dirname, `${label}.png`), fullPage: true });
      console.log(label, await page.evaluate(() => {
        const content = document.querySelector('.ant-layout-content');
        const table = document.querySelector('.ant-table-content');
        return { contentWidth: content.clientWidth, contentScrollWidth: content.scrollWidth, tableWidth: table.clientWidth, tableScrollWidth: table.scrollWidth };
      }));
      if (label === 'mobile') {
        await page.locator('.ant-table-content').evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await page.screenshot({ path: path.join(__dirname, 'mobile-actions.png'), fullPage: true });
      }
    }
    console.log('browserErrors', errors);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
