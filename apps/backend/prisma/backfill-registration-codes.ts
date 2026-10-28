import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { generateRegistrationCode } from '../src/common/registration-code';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function uniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const code = generateRegistrationCode();
    const exists = await prisma.tournament.findFirst({
      where: {
        OR: [
          { schoolRegistrationCode: code },
          { socialRegistrationCode: code },
        ],
      },
      select: { id: true },
    });
    if (!exists) return code;
  }
  throw new Error('报名码生成失败，请重试');
}

async function main() {
  const tournaments = await prisma.tournament.findMany({
    include: { events: { select: { entrantType: true } } },
  });
  let updated = 0;
  for (const tournament of tournaments) {
    const hasSchool = tournament.events.some((event) => event.entrantType === 'SCHOOL');
    const hasSocial = tournament.events.some((event) => event.entrantType === 'SOCIAL');
    const needSchool = hasSchool && !tournament.schoolRegistrationCode;
    const needSocial = hasSocial && !tournament.socialRegistrationCode;
    if (!needSchool && !needSocial) continue;
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: {
        ...(needSchool ? { schoolRegistrationCode: await uniqueCode() } : {}),
        ...(needSocial ? { socialRegistrationCode: await uniqueCode() } : {}),
      },
    });
    updated += 1;
  }
  console.log(`已为 ${updated} 个赛事补充报名码（共 ${tournaments.length} 个赛事）`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
