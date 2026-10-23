const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.create = async ({ user, token }) => {
  const frontend = path.resolve(__dirname, '../../frontend');
  const env = require('dotenv').parse(fs.readFileSync(path.join(frontend, '.env.local')));
  const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt', { paths: [frontend] })).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../.codex-work/photo-access-qa/node_modules/playwright');
  const origin = process.env.TEAM_QA_FRONTEND || 'http://localhost:3019';
  assert(['localhost', '127.0.0.1'].includes(new URL(origin).hostname));
  const output = path.resolve(__dirname, '../../../outputs/team-official-results-20261024');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
  const cookie = 'authjs.session-token';
  const session = await encode({ secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET, salt: cookie, token: {
    sub: user.id, username: user.username, name: user.username, email: user.email, role: user.role,
    permissions: user.permissions, status: 'ACTIVE', accessToken: token, accessTokenExpiresAt: Date.now() + 3600000,
  } });
  await context.addCookies([{ name: cookie, value: session, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(45000);
  let opened = false;
  return {
    async inspect({ competition, encounter, completed, expectedNet }) {
      if (!opened) {
        await page.goto(`${origin}/nicaiyixiahh/draws`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.getByRole('combobox').nth(0).click();
        await page.locator('.ant-select-dropdown:visible').getByText('团体规则与场地验证', { exact: true }).click();
        const selector = page.locator('.ant-select').filter({ hasText: /选择团体赛|团体赛验证|正式成绩验证/ }).last();
        await selector.click();
        await page.locator('.ant-select-dropdown:visible').getByText(`${competition.name} · 2 队`, { exact: true }).click();
        await page.keyboard.press('Escape');
        opened = true;
      }
      const row = page.locator(`tr[data-row-key="${encounter.id}"]`);
      await row.getByText(completed ? '已结束' : '胜负已定·补打中', { exact: true }).waitFor();
      assert.match(await row.innerText(), /3\s*:\s*0/);
      const standing = page.locator(`tr[data-row-key="${encounter.team1.id}"]`);
      const values = await standing.locator('td').allTextContents();
      assert.deepEqual(values.slice(0, 5), ['1', encounter.team1.name, '1', '3', String(expectedNet)]);
      if (!completed) await row.locator('.ant-table-row-expand-icon').click();
      await page.getByText('补打 · 不计排名', { exact: true }).first().waitFor();
      assert.equal(await page.getByText('补打 · 不计排名', { exact: true }).count(), 2);
      await page.getByText('补打 · 不计排名', { exact: true }).last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, completed ? 'draws-completed.png' : 'draws-supplemental.png'), fullPage: true });
      if (completed) {
        await page.setViewportSize({ width: 390, height: 844 });
        await standing.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, 'draws-mobile.png'), fullPage: true });
        await standing.locator('td').last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, 'draws-mobile-points.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ officialTeamBrowser: 'passed', drawPage: true, pollingRefresh: true, supplementalLabels: 2, pageErrors: 0 }));
      }
    },
    async close() { await browser.close(); },
  };
};
