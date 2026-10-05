// Additive local migration only; never runs the project's unrelated migration backlog.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const mariadb = require('mariadb');
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This helper only supports the local development database');
  const db = await mariadb.createConnection({ host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) });
  try {
    if (process.argv.includes('--shared-join')) {
      const tables = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='broadcast_join_invite'");
      if (tables.length) { console.log('Shared join table already exists'); return; }
      if (!process.argv.includes('--apply')) { console.log('Shared join migration required'); return; }
      const sql = readFileSync(path.join(__dirname, '../prisma/migrations/20261005_broadcast_shared_join/migration.sql'), 'utf8');
      for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(statement);
      console.log('Applied additive shared join migration');
      return;
    }
    const rows = await db.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='broadcast_session'");
    const columns = rows.map((row) => row.COLUMN_NAME);
    console.log('broadcast columns:', columns.join(', '));
    if (!columns.includes('cameraTokenHash')) throw new Error('Apply the existing camera migration first');
    if (columns.includes('liveRoomName')) { console.log('Multicamera columns already exist'); return; }
    if (!process.argv.includes('--apply')) return;
    const sql = readFileSync(path.join(__dirname, '../prisma/migrations/20261005_broadcast_multicamera/migration.sql'), 'utf8');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await db.query(statement);
    console.log('Applied additive multicamera migration');
  } finally { await db.end(); }
})().catch((e) => { console.error('Local migration check failed:', e.code || e.name); process.exitCode = 1; });
