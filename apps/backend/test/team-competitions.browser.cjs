const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

exports.run = async ({ base, token, user, competition, batchCompetition, tournamentId, api }) => {
  const frontend = path.resolve(__dirname, '../../frontend');
  const env = require('dotenv').parse(fs.readFileSync(path.join(frontend, '.env.local')));
  const { encode } = await import(pathToFileURL(require.resolve('next-auth/jwt', { paths: [frontend] })).href);
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '../../../.codex-work/photo-access-qa/node_modules/playwright');
  const origin = 'http://localhost:3011';
  const output = path.resolve(__dirname, '../../../outputs/team-audit-20261018');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
    const cookie = 'authjs.session-token';
    const session = await encode({ secret: env.NEXTAUTH_SECRET || env.AUTH_SECRET, salt: cookie, token: {
      sub: user.id, name: user.username, username: user.username, email: user.email, role: user.role,
      permissions: user.permissions, status: 'ACTIVE', accessToken: token, accessTokenExpiresAt: Date.now() + 3600000,
    } });
    await context.addCookies([{ name: cookie, value: session, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    await context.route(`${env.NEXT_PUBLIC_API_URL}/**`, async route => {
      const response = await route.fetch({ url: route.request().url().replace(env.NEXT_PUBLIC_API_URL, base) });
      await route.fulfill({ response });
    });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(120000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/nicaiyixiahh/team-competitions/${competition.id}`);
    await page.getByRole('heading', { name: competition.name, exact: true }).waitFor();
    await page.getByText('每队 5 人（3 男 2 女）', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: '填报名单', exact: true }).first().click();
    let dialog = page.getByRole('dialog').filter({ hasText: '出场名单' });
    const encounter = competition.teamMatches[0];
    const sides = [encounter.team1, encounter.team2].map(side => competition.teams.find(t => t.id === side.id));
    async function choose(index, player) {
      const input = dialog.getByRole('combobox').nth(index);
      await input.click();
      await input.fill(player.name);
      await page.locator('.ant-select-dropdown:visible').getByText(`${player.name}（${player.gender === 'MALE' ? '男' : '女'}）`, { exact: true }).click();
    }
    const firstPlayers = sides.map(team => team.members.find(p => p.gender === 'FEMALE'));
    await choose(0, firstPlayers[0]); await choose(1, firstPlayers[1]);
    await dialog.getByRole('button', { name: '保存并锁定本项名单', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('本项双方名单已锁定', { exact: true }).waitFor();
    await page.getByRole('button', { name: '查看名单', exact: true }).nth(1).click();
    dialog = page.getByRole('dialog').filter({ hasText: '出场名单' });
    assert.equal(await dialog.getByRole('combobox').first().isDisabled(), true);
    await dialog.getByRole('button', { name: '例外换人', exact: true }).click();
    const confirmation = page.getByRole('dialog').filter({ hasText: '确认例外换人？' });
    await confirmation.getByRole('button', { name: /取\s*消/ }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.equal(await dialog.getByRole('combobox').first().isDisabled(), true);
    await dialog.getByRole('button', { name: '例外换人', exact: true }).click();
    await page.getByRole('dialog').filter({ hasText: '确认例外换人？' }).getByRole('button', { name: '确认例外换人', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    const replacement = sides[0].members.filter(p => p.gender === 'FEMALE')[1];
    await choose(0, replacement);
    await dialog.getByRole('button', { name: '保存例外换人', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const updated = await api(`/team-competitions/${competition.id}`);
    assert.equal(updated.teamMatches[0].lineups.find(l => l.teamId === sides[0].id && l.teamCompetitionItemId === competition.items[1].id).player1.id, replacement.id);
    // Both roster exceptions require confirmation, and cancelling leaves data unchanged.
    await page.getByRole('button', { name: '例外补充队员', exact: true }).first().click();
    let rosterDialog = page.getByRole('dialog').filter({ hasText: '例外补充队员 ·' });
    await rosterDialog.getByLabel('队员数据').fill('浏览器临时队员,男,验证');
    await rosterDialog.locator('.ant-modal-footer .ant-btn-primary').click();
    const addConfirm = page.getByRole('dialog').filter({ hasText: '确认临时补充队员？' });
    await addConfirm.waitFor();
    await addConfirm.getByRole('button', { name: /取\s*消/ }).click();
    await addConfirm.waitFor({ state: 'hidden' });
    assert.equal((await api(`/team-competitions/${competition.id}`)).teams[0].memberCount, 5);
    await rosterDialog.locator('.ant-modal-footer .ant-btn-default').click();
    await rosterDialog.waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(output, 'team-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'team-mobile.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: window.innerWidth, documentWidth: document.documentElement.scrollWidth }));
    assert(overflow.documentWidth <= overflow.width + 1, `mobile overflow ${JSON.stringify(overflow)}`);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(`${origin}/nicaiyixiahh/team-competitions/${batchCompetition.id}`);
    await page.getByRole('button', { name: '批量导入团体队员', exact: true }).click();
    const batchDialog = page.getByRole('dialog').filter({ hasText: '批量导入团体队员' });
    const header = '团体名称\t姓名\t性别\t单位\t联系方式';
    const rows = ['浏览器甲队', '浏览器乙队'].flatMap(teamName => [1, 2, 3, 4, 5].map(i => `${teamName}\t队员${i}\t${i <= 3 ? '男' : '女'}\t\t13800000000`));
    await batchDialog.getByRole('textbox', { name: '团体队员数据' }).fill([header, ...rows.slice(0, -1)].join('\n'));
    assert.equal(await batchDialog.getByRole('button', { name: /导入 2 个团体/ }).isDisabled(), true);
    await batchDialog.getByRole('textbox', { name: '团体队员数据' }).fill([header, ...rows].join('\n'));
    await batchDialog.getByRole('button', { name: '导入 2 个团体、10 人', exact: true }).click();
    await batchDialog.waitFor({ state: 'hidden' });
    const batchDetail = await api(`/team-competitions/${batchCompetition.id}`);
    assert.equal(batchDetail.teams.length, 2);
    assert(batchDetail.teams.every(team => team.memberCount === 5));
    await page.screenshot({ path: path.join(output, 'team-batch-import.png'), fullPage: true });
    await page.goto(`${origin}/nicaiyixiahh/competitions/${tournamentId}/players`);
    await page.getByRole('button', { name: /批量新增/ }).click();
    const originalBatch = page.getByRole('dialog').filter({ hasText: '批量新增参赛选手' });
    await originalBatch.getByRole('combobox').click();
    await page.locator('.ant-select-dropdown:visible').getByText(`团体赛 · ${batchCompetition.name}`, { exact: true }).click();
    await originalBatch.getByRole('textbox', { name: '团体队员数据' }).fill([header, ...rows.map(row => row.replace('浏览器', '原入口'))].join('\n'));
    await originalBatch.getByRole('button', { name: '导入 2 个团体、10 人', exact: true }).click();
    await originalBatch.waitFor({ state: 'hidden' });
    assert.equal((await api(`/team-competitions/${batchCompetition.id}`)).teams.length, 4);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: 'passed', tested: ['manual lineup', 'per-item lock', 'override confirm and cancel', 'roster confirm and cancel', 'both batch import entry points', 'invalid roster preview', 'desktop', 'mobile'], errors }));
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true }).catch(() => {});
      console.error('Visible dialogs:', await page.getByRole('dialog').allTextContents());
    }
    throw error;
  } finally { await browser.close(); }
};
