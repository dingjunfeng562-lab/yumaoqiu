const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.open = async ({ api, base, token, refereeToken, user, referee, comp, tournamentId, out }) => {
  const frontend = path.resolve(__dirname, '../../frontend');
  const env = require('dotenv').parse(fs.readFileSync(path.join(frontend, '.env.local')));
  const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt', { paths: [frontend] })).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../.codex-work/photo-access-qa/node_modules/playwright');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = process.env.TEAM_QA_FRONTEND || 'http://localhost:3000';
  const errors = [];
  async function contextFor(actor, accessToken) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const cookie = 'authjs.session-token';
    const session = await encode({ secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET, salt: cookie, token: {
      sub: actor.id, name: actor.username, username: actor.username, email: actor.email, role: actor.role,
      permissions: actor.permissions, status: 'ACTIVE', accessToken, accessTokenExpiresAt: Date.now() + 3600000,
    } });
    await context.addCookies([{ name: cookie, value: session, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(120000);
    page.on('pageerror', error => errors.push(error.message));
    return page;
  }
  const page = await contextFor(user, token);
  let refPage;
  return {
    async schedule() {
      await page.goto(`${origin}/nicaiyixiahh/team-competitions/${comp.id}`);
      await page.getByRole('heading', { name: comp.name, exact: true }).waitFor();
      await page.getByRole('button', { name: /团体赛设置/ }).click();
      const settings = page.getByRole('dialog').filter({ hasText: '团体赛设置' });
      await settings.getByText('全部团体同组，每两队交手一次', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(out, '01-format.png'), fullPage: true });
      await settings.getByRole('button', { name: /取\s*消/ }).click();
      await page.goto(`${origin}/nicaiyixiahh/scheduling`);
      await page.getByRole('button', { name: '自动排程', exact: true }).waitFor();
      // Only the isolated tournament is owned by this QA administrator.
      await page.getByRole('button', { name: '自动排程', exact: true }).click();
      let dialog = page.getByRole('dialog').filter({ hasText: '首日开始时间' });
      await dialog.getByLabel('单场预估时长（分钟）').fill('10');
      await dialog.getByLabel('场间间隔（分钟）').fill('0');
      await dialog.getByRole('button', { name: /确\s*定|OK/ }).click();
      let warning = page.getByRole('dialog').filter({ hasText: '场地数量超过团体循环赛所需' });
      await warning.waitFor();
      await warning.screenshot({ path: path.join(out, '02-court-warning.png'), animations: 'disabled' });
      await warning.getByRole('button', { name: '保留场地，多余留空', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      let data = await api(`/scheduling?tournamentId=${tournamentId}`);
      assert.equal(data.venues.filter(v => v.isActive).length, 5);
      assert.equal(new Set(data.matches.map(m => m.venueId)).size, 3);
      await page.goto(`${origin}/nicaiyixiahh/draws`);
      await page.getByText('全部队伍在同一组，每两队交手一次。自动排程后', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: '手动调整分组', exact: true }).count(), 0);
      await page.getByRole('button', { name: '调整场地与时间', exact: true }).first().click();
      const manual = page.getByRole('dialog').filter({ hasText: '调整团体对阵场地与时间' });
      await manual.getByLabel('场地', { exact: true }).click();
      await page.getByTitle('4号场地', { exact: true }).click();
      await manual.getByRole('button', { name: '保存排程', exact: true }).click();
      await manual.waitFor({ state: 'hidden' });
      await page.getByRole('cell', { name: '4号场地', exact: true }).waitFor();
      await page.getByRole('cell', { name: '4号场地', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, '07-manual-reserve-court.png'), fullPage: true });
      data = await api(`/scheduling?tournamentId=${tournamentId}`);
      const reserveId = data.venues.find(venue => venue.name === '4号场地').id;
      assert.equal(data.matches.filter(match => match.venueId === reserveId).length, 3);
      assert.equal(data.conflicts.length, 0);
      console.log('BROWSER 抽签编排手工使用预留场地，整场三个子项一起移动通过');
      await page.goto(`${origin}/nicaiyixiahh/scheduling`);
      await page.getByRole('button', { name: '自动排程', exact: true }).click();
      dialog = page.getByRole('dialog').filter({ hasText: '首日开始时间' });
      await dialog.getByRole('button', { name: /确\s*定|OK/ }).click();
      warning = page.getByRole('dialog').filter({ hasText: '场地数量超过团体循环赛所需' });
      await warning.getByRole('button', { name: '调整为 3 片并排程', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      data = await api(`/scheduling?tournamentId=${tournamentId}`);
      assert.equal(data.venues.filter(v => v.isActive).length, 3);
      await page.screenshot({ path: path.join(out, '03-scheduled.png'), fullPage: true });
      console.log('BROWSER 赛制说明及场地确认两个分支通过');
    },
    async refereeHidden(venueId) {
      refPage = await contextFor(referee, refereeToken);
      await refPage.goto(`${origin}/referee/tournaments/${tournamentId}/courts/${venueId}`);
      await refPage.getByText('此场地暂无可执裁比赛。', { exact: false }).waitFor();
      assert.equal(await refPage.locator('article').count(), 0);
      await refPage.screenshot({ path: path.join(out, '04-referee-hidden.png'), fullPage: true });
    },
    async refereeVisible() {
      await refPage.getByRole('button', { name: /刷\s*新/ }).click();
      await refPage.locator('article').waitFor();
      assert.equal(await refPage.locator('article').count(), 1);
      assert.ok((await refPage.locator('article').innerText()).includes('男队员'));
      await refPage.screenshot({ path: path.join(out, '05-referee-ready.png'), fullPage: true });
      console.log('BROWSER 名单填报前隐藏、锁定后显示通过');
    },
    async final() {
      await page.goto(`${origin}/nicaiyixiahh/team-competitions/${comp.id}`);
      await page.getByRole('heading', { name: comp.name, exact: true }).waitFor();
      await page.getByRole('columnheader', { name: '净胜分', exact: true }).waitFor();
      await page.getByRole('columnheader', { name: '净胜分', exact: true }).scrollIntoViewIfNeeded();
      for (const name of ['胜场', '胜次', '净胜分']) assert.equal(await page.getByRole('columnheader', { name, exact: true }).count(), 1);
      for (const name of ['负场', '胜项', '负项']) assert.equal(await page.getByRole('columnheader', { name, exact: true }).count(), 0);
      await page.screenshot({ path: path.join(out, '06-final-standings.png'), fullPage: true });
      assert.deepEqual(errors, []);
      console.log('BROWSER 最终积分榜和页面错误检查通过');
    },
    async close() {
      if (refPage) {
        fs.writeFileSync(path.join(out, 'referee-last-page.txt'), `${refPage.url()}\n${await refPage.locator('body').innerText()}`);
        await refPage.screenshot({ path: path.join(out, 'referee-last-page.png'), fullPage: true });
      }
      await browser.close();
    },
  };
};
