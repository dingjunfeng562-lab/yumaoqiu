const { PrismaClient } = require("@prisma/client");
const { PrismaMariaDb } = require("@prisma/adapter-mariadb");
const p = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
(async () => {
  const rows = await p.$queryRawUnsafe("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name");
  console.log("tables:", rows.length);
  console.log(rows.map(r => r.t).join(", "));
  await p.$disconnect();
})().catch(e => { console.error(String(e).slice(0, 300)); process.exit(1); });
