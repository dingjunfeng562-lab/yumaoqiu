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
    const columns = await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND ((TABLE_NAME='TournamentGroup' AND COLUMN_NAME='restrictVenues') OR (TABLE_NAME='Tournament' AND COLUMN_NAME='schedulingSettings') OR (TABLE_NAME='Match' AND COLUMN_NAME IN ('scheduleLocked','scheduleOverride','unscheduledReason')))", [database]);
    const tables = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN ('GroupVenue','ScheduleOperationLog')", [database]);
    if (columns.length === 5 && tables.length === 2) { console.log('组别场地迁移已应用'); return; }
    if (columns.length || tables.length) throw new Error('发现部分迁移，请核对后再执行；不会重复执行 DDL');
    const backup = { createdAt: new Date().toISOString(), definitions: {}, matches: await db.query('SELECT id,venueId,scheduledAt,durationMinutes,status FROM `Match`') };
    for (const table of ['TournamentGroup', 'Tournament', 'Match']) {
      backup.definitions[table] = (await db.query(`SHOW CREATE TABLE \`${table}\``))[0]['Create Table'];
    }
    const directory = path.resolve(__dirname, '../../../.tmp/group-venue-backups');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `before-${Date.now()}.json`), JSON.stringify(backup));
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261106_group_venue_scheduling/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
    const count = Number((await db.query('SELECT COUNT(*) n FROM `Match`'))[0].n);
    if (count !== backup.matches.length) throw new Error('比赛行数发生变化，请核对备份');
    console.log('组别场地迁移完成；原比赛行数保持不变，排程快照已备份至 .tmp/group-venue-backups');
  } finally { await db.end(); }
}
main().catch(e => { console.error(e.code ?? e.name, e.message, e.errors?.map(item => item.code)); process.exitCode = 1; });
