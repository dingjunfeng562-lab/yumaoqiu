// Additive migration for the local development database only.
require('dotenv').config({ path: require('node:path').join(__dirname, '../.env'), quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');

async function main() {
  const u = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) throw new Error('仅支持本机开发数据库');
  const database = u.pathname.slice(1);
  const db = await mariadb.createConnection({ host: u.hostname, port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database, dateStrings: true });
  try {
    const columns = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='Event' AND COLUMN_NAME='venueRule'", [database]);
    const tables = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='EventVenue'", [database]);
    if (columns.length === 1 && tables.length === 1) { console.log('单项场地迁移已应用'); return; }
    if (columns.length || tables.length) throw new Error('发现部分迁移，请核对后再执行；不会重复执行 DDL');
    const backup = { createdAt: new Date().toISOString(), definitions: {},
      events: await db.query('SELECT id,tournamentId,groupId,type FROM `Event`'),
      matches: await db.query('SELECT id,eventId,venueId,scheduledAt,status FROM `Match`') };
    for (const table of ['Event']) backup.definitions[table] = (await db.query(`SHOW CREATE TABLE \`${table}\``))[0]['Create Table'];
    const directory = path.resolve(__dirname, '../../../.tmp/event-venue-backups');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `before-${Date.now()}.json`), JSON.stringify(backup));
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261108_event_venue_rules/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
    // 新列默认 INHERIT，存量赛事继续沿用组别规则；两表行数必须保持不变。
    const eventCount = Number((await db.query('SELECT COUNT(*) n FROM `Event`'))[0].n);
    const matchCount = Number((await db.query('SELECT COUNT(*) n FROM `Match`'))[0].n);
    if (eventCount !== backup.events.length || matchCount !== backup.matches.length) throw new Error('单项或比赛行数发生变化，请核对备份');
    const inherited = Number((await db.query("SELECT COUNT(*) n FROM `Event` WHERE `venueRule`='INHERIT'"))[0].n);
    if (inherited !== eventCount) throw new Error('存在非 INHERIT 的单项，请核对默认值');
    console.log('单项场地迁移完成；存量单项全部 INHERIT（沿用组别），行数不变，快照已备份至 .tmp/event-venue-backups');
  } finally { await db.end(); }
}
main().catch(e => { console.error(e.code ?? e.name, e.message, e.errors?.map(item => item.code)); process.exitCode = 1; });
