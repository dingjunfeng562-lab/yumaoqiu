// 本机开发库迁移工具：预检、备份相关表、执行迁移、核对行数与关联。
// 生产环境通过正常发布流程执行 migration.sql；此工具拒绝远程数据库。
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
    const existing = await db.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME='TournamentGroup'", [database]);
    if (existing.length) {
      const index = await db.query("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME='Event' AND INDEX_NAME='Event_tournamentId_groupId_type_key'", [database]);
      const columns = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='TeamMember' AND COLUMN_NAME='eligibility'", [database]);
      if (!index.length || !columns.length) throw new Error('发现不完整迁移，请从本地备份核对恢复，不自动跳过');
      console.log('本机自定义组别迁移已存在'); return;
    }
    const collision = await db.query(`SELECT code,COUNT(*) n FROM (
      SELECT schoolRegistrationCode code FROM Tournament WHERE schoolRegistrationCode IS NOT NULL
      UNION ALL SELECT socialRegistrationCode code FROM Tournament WHERE socialRegistrationCode IS NOT NULL
    ) c GROUP BY code HAVING COUNT(*)>1`);
    if (collision.length) throw new Error('历史报名码跨组重复，请先处理后再迁移');
    const tables = ['Tournament','Event','TeamCompetition','TournamentPaymentSetting','Player','CompetitionRegistration','CompetitionRegistrationEventItem','Registration','TeamMember'];
    const backup = { database, createdAt: new Date().toISOString(), tables: {} };
    for (const table of tables) {
      const definition = await db.query(`SHOW CREATE TABLE \`${table}\``);
      backup.tables[table] = { definition: definition[0]['Create Table'], rows: await db.query(`SELECT * FROM \`${table}\``) };
    }
    const root = path.resolve(__dirname, '../../..');
    const directory = path.join(root, '.tmp', 'age-group-backups');
    fs.mkdirSync(directory, { recursive: true });
    const backupFile = path.join(directory, `before-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    console.log(`已备份${tables.length}张相关表至工作区 .tmp/age-group-backups`);
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/20261106_custom_registration_groups/migration.sql'), 'utf8');
    const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    for (let i=0;i<statements.length;i++) {
      try { await db.query(statements[i]); }
      catch (error) { throw new Error(`迁移第${i+1}条失败（${error.code ?? '未知错误'}），备份已保留。请勿直接重试部分迁移。`); }
    }
    for (const table of tables) {
      const rows = await db.query(`SELECT COUNT(*) n FROM \`${table}\``);
      if (Number(rows[0].n) !== backup.tables[table].rows.length) throw new Error(`${table}行数不一致`);
    }
    for (const table of ['Event','TeamCompetition','TournamentPaymentSetting','CompetitionRegistration']) {
      const rows = await db.query(`SELECT COUNT(*) n FROM \`${table}\` r LEFT JOIN TournamentGroup g ON g.id=r.groupId WHERE g.id IS NULL`);
      if (Number(rows[0].n)) throw new Error(`${table}存在未关联组别`);
    }
    console.log('迁移完成；旧数据行数、组别回填检查通过。');
  } finally { await db.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
