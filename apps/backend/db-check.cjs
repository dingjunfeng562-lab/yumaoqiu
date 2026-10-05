const { readFileSync } = require("node:fs");
const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
(async () => {
  const sql = readFileSync("prisma/migrations/20261004_broadcast_session/migration.sql", "utf8");
  for (const stmt of sql.split(/;\s*\r?\n/).map(s => s.trim()).filter(Boolean)) {
    await p.$executeRawUnsafe(stmt);
  }
  const cols = await p.$queryRawUnsafe("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'broadcast_session' ORDER BY ordinal_position");
  console.log("broadcast_session columns:", cols.map(r => r.c).join(", "));
  await p.$disconnect();
})().catch(e => { console.error(String(e).slice(0, 400)); process.exit(1); });
